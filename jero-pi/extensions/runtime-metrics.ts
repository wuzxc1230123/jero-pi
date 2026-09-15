import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { EFFORTS, ORCHESTRATOR_AGENT_CLASS, RuntimeMetrics, UNKNOWN_AGENT_CLASS, type FinalResponse, type TokenMeasurement } from "../lib/runtime-metrics.ts";
import { CHILD_METRICS_EVENT, CHILD_METRICS_REVOKED, snapshotChildEvent } from "../lib/runtime-metrics-children.ts";

/** Local-only runtime metrics host (jero-pi design §5.4).
 * The native delivery path — one deferred send attempt, print-mode shutdown
 * join, DO_NOT_TRACK/CI policy gates — was deleted together with the
 * gentle-ai binary: jero-pi keeps no outbound telemetry. What remains is
 * in-process accounting: assistant usage rows and CHILD_METRICS_EVENT
 * aggregation into a per-session RuntimeMetrics snapshot, held in memory
 * only. Views that want per-task usage read the child-event stream directly
 * (Agents view).
 */
export default function runtimeMetrics(pi: ExtensionAPI, env = process.env): void {
	if (env.GENTLE_PI_AGENTS_CHILD === "1") return;
	type Selection = Pick<FinalResponse, "selectedModelId" | "selectedProvider" | "effort">;
	let selection: Selection | undefined;
	let active = false;
	let requestSeen = false;
	let ambiguous = false;
	let live: { id: string; ctx: ExtensionContext; metrics: RuntimeMetrics; seen: WeakSet<object> } | undefined;
	const missing = { state: "unavailable" } as const;
	function invalidate() { selection = undefined; ambiguous = true; }
	function dispose() { live = undefined; invalidate(); }
	function current(ctx: ExtensionContext) {
		if (live?.id !== ctx.sessionManager.getSessionId()) dispose();
		return live;
	}
	function record(owner: NonNullable<typeof live>, responses: FinalResponse[]): void {
		if (!responses.length) return;
		// Ephemeral event-local accounting only; source IDs never enter these rows.
		for (const [index, row] of responses.entries()) owner.metrics.record({ ...row, responseId: String(index) });
	}
	const offChild = pi.events.on(CHILD_METRICS_EVENT, value => {
		try {
			const owner = live && current(live.ctx);
			const event = snapshotChildEvent(value);
			if (!owner || !event || event.parentSessionId !== owner.id) return;
			record(owner, event.responses);
		} catch { /* No metrics error enters the shared event bus. */ }
	});
	const offRevoke = pi.events.on(CHILD_METRICS_REVOKED, id => {
		if (live?.id === id) dispose();
	});
	pi.on("session_start", (_event, ctx) => {
		dispose();
		live = { id: ctx.sessionManager.getSessionId(), ctx, metrics: new RuntimeMetrics(), seen: new WeakSet<object>() };
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
		try { const value = pi.getThinkingLevel(); if (EFFORTS.includes(value)) effort = value; } catch { /* No evidence. */ }
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
			record(owner, [{ kind: "final_assistant_response", responseId: "0",
				selectedProvider: selected?.selectedProvider ?? "unknown", selectedModelId: selected?.selectedModelId,
				effort: selected?.effort ?? "unavailable",
				executor: env.GENTLE_PI_AGENTS_CHILD === undefined ? "orchestrator" : "unknown",
				agentClass: env.GENTLE_PI_AGENTS_CHILD === undefined ? ORCHESTRATOR_AGENT_CLASS : UNKNOWN_AGENT_CLASS,
				observedModelId: message.model, responseModelId: message.responseModel,
				providerThinkingLevel: EFFORTS.includes(message.providerThinkingLevel as FinalResponse["effort"])
					? message.providerThinkingLevel as FinalResponse["effort"] : "unavailable",
				provider: message.provider as FinalResponse["provider"], modelFamily: "unknown",
				error: message.stopReason === "aborted" ? "aborted" : message.stopReason === "error" ? "unknown" : "none",
				tokens: { input: token(message.usage?.input), output: token(message.usage?.output), cacheRead: token(message.usage?.cacheRead),
					cacheWrite: token(message.usage?.cacheWrite), reasoning: token(message.usage?.reasoning), totalTokens: token(message.usage?.totalTokens) },
				responseHeadersMs: missing, fullResponseMs: missing }]);
			invalidate();
		} catch { /* Provider hooks never expose metrics failures. */ }
	});
}
