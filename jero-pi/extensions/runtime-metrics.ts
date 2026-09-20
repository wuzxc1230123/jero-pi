import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { EFFORTS, ORCHESTRATOR_AGENT_CLASS, RuntimeMetrics, UNKNOWN_AGENT_CLASS, type FinalResponse, type RuntimeMetricBucket, type TokenMeasurement } from "../lib/runtime-metrics.ts";
import { CHILD_METRICS_EVENT, CHILD_METRICS_REVOKED, snapshotChildEvent } from "../lib/runtime-metrics-children.ts";

/** 仅测试用的接缝：活动会话的本地记账快照（若有）。 */
export let liveSessionMetrics: () => { id: string; snapshot: readonly RuntimeMetricBucket[] } | undefined = () => undefined;

/** 仅本地的运行时指标宿主（jero-pi 设计 §5.4）。
 * 原生投递路径——一次延迟发送尝试、打印模式停机
 * 汇合、DO_NOT_TRACK/CI 策略门控——已随 gentle-ai
 * 二进制一同删除：jero-pi 不保留任何外发遥测。剩下的
 * 是进程内记账：助手用量行与 CHILD_METRICS_EVENT
 * 聚合到每会话的 RuntimeMetrics 快照，仅保存在内存
 * 中。需要按任务用量的视图直接读取子事件流
 * （Agents 视图）。
 */
export default function runtimeMetrics(pi: ExtensionAPI, env = process.env, now: () => number = () => performance.now()): void {
	if (env.JERO_PI_AGENTS_CHILD === "1") return;
	type Selection = Pick<FinalResponse, "selectedModelId" | "selectedProvider" | "effort">;
	let selection: Selection | undefined;
	let active = false;
	let requestSeen = false;
	let ambiguous = false;
	let live: { id: string; ctx: ExtensionContext; started: number; metrics: RuntimeMetrics; seen: WeakSet<object>; children: Set<string>; recorded: number } | undefined;
	// 仅测试用的接缝：本地快照本是私有状态。
	liveSessionMetrics = () => (live ? { id: live.id, snapshot: live.metrics.snapshot() } : undefined);
	const missing = { state: "unavailable" } as const;
	function invalidate() { selection = undefined; ambiguous = true; }
	function dispose() { live = undefined; invalidate(); }
	function current(ctx: ExtensionContext) {
		if (live?.id !== ctx.sessionManager.getSessionId()) dispose();
		return live;
	}
	function record(owner: NonNullable<typeof live>, responses: FinalResponse[]): void {
		if (!responses.length) return;
		// 仅限事件本地的临时记账；来源 ID 绝不进入这些
		// 数据行。会话生命期的记录器拥有整个去重 id 空间：
		// 每一行都拿到全新 id，与任何来源 responseId 无关
		// （上游曾按投递批次重新生成该空间，现已移除）。
		for (const row of responses) {
			owner.metrics.record({ ...row, responseId: String(owner.recorded++) });
		}
	}
	const offChild = pi.events.on(CHILD_METRICS_EVENT, value => {
		try {
			const owner = live && current(live.ctx);
			const event = snapshotChildEvent(value);
			if (!owner || !event || event.parentSessionId !== owner.id
				|| event.launchedAt < owner.started || owner.children.has(event.taskId)) return;
			owner.children.add(event.taskId); // 忙碌/失败的完成通知保持已消费状态。
			record(owner, event.responses);
		} catch { /* 任何指标错误都不进入共享事件总线。 */ }
	});
	const offRevoke = pi.events.on(CHILD_METRICS_REVOKED, id => {
		if (live?.id === id) dispose();
	});
	pi.on("session_start", (_event, ctx) => {
		dispose();
		live = { id: ctx.sessionManager.getSessionId(), ctx, started: now(),
			metrics: new RuntimeMetrics(), seen: new WeakSet<object>(), children: new Set(), recorded: 0 };
	});
	pi.on("session_shutdown", () => { dispose(); offChild(); offRevoke(); });
	pi.on("turn_start", () => { ambiguous = active; active = true; requestSeen = false; selection = undefined; });
	pi.on("turn_end", () => { active = false; invalidate(); });
	pi.on("agent_end", () => { active = false; invalidate(); });
	pi.on("session_before_compact", invalidate);
	pi.on("session_before_tree", invalidate);
	pi.on("before_provider_request", (_event, ctx) => {
		if (!current(ctx)) return;
		if (requestSeen) invalidate();
		requestSeen = true;
		if (!active || ambiguous) return;
		let effort: FinalResponse["effort"] = "unavailable";
		try { const value = pi.getThinkingLevel(); if (EFFORTS.includes(value)) effort = value; } catch { /* 无证据。 */ }
		selection = { selectedProvider: typeof ctx.model?.provider === "string" && ctx.model.provider.length <= 128 ? ctx.model.provider : undefined,
			selectedModelId: typeof ctx.model?.id === "string" && ctx.model.id.length <= 128 ? ctx.model.id : undefined, effort };
	});
	function token(value: unknown): TokenMeasurement {
		return typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= 1_000_000_000
			? { state: "reported", value } : missing;
	}
	pi.on("message_end", (event, ctx) => {
		try {
			const owner = current(ctx);
			const message = event.message;
			if (!owner || message.role !== "assistant" || message.stopReason === "pending" || message.stopReason === "deferred"
				|| owner.seen.has(message)) return;
			owner.seen.add(message);
			const selected = active && !ambiguous ? selection : undefined;
			record(owner, [{ kind: "final_assistant_response", responseId: "",
				selectedProvider: selected?.selectedProvider ?? "unknown", selectedModelId: selected?.selectedModelId,
				effort: selected?.effort ?? "unavailable",
				executor: env.JERO_PI_AGENTS_CHILD === undefined ? "orchestrator" : "unknown",
				agentClass: env.JERO_PI_AGENTS_CHILD === undefined ? ORCHESTRATOR_AGENT_CLASS : UNKNOWN_AGENT_CLASS,
				observedModelId: message.model, responseModelId: message.responseModel,
				providerThinkingLevel: EFFORTS.includes(message.providerThinkingLevel as FinalResponse["effort"])
					? message.providerThinkingLevel as FinalResponse["effort"] : "unavailable",
				provider: message.provider as FinalResponse["provider"], modelFamily: "unknown",
				error: message.stopReason === "aborted" ? "aborted" : message.stopReason === "error" ? "unknown" : "none",
				tokens: { input: token(message.usage?.input), output: token(message.usage?.output), cacheRead: token(message.usage?.cacheRead),
					cacheWrite: token(message.usage?.cacheWrite), reasoning: token(message.usage?.reasoning), totalTokens: token(message.usage?.totalTokens) },
				responseHeadersMs: missing, fullResponseMs: missing }]);
			invalidate();
		} catch { /* 提供方钩子绝不暴露指标失败。 */ }
	});
}
