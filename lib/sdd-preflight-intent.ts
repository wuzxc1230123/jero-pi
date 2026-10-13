// SDD 预检意图：启动触发识别、偏好收集交互、父级确认上下文、提示渲染与会话预检。
// 自 lib/sdd-preflight.ts 拆分（机械平移，语义零改动）。

import { join } from "node:path";
import { type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	DEFAULT_SDD_PREFLIGHT, isRecord, normalizedSelections, normalizeSddChainedPrStrategy,
	readSddPreflightFromDisk, SDD_PREFLIGHT_FIELDS, sddPreflightBySession,
	type SddPreflightCallbacks, type SddPreflightField, sddPreflightInFlight,
	type SddPreflightPreferences, type SddPreflightResolutionOptions, sddPreflightDiskPath, writeSddPreflightToDisk
} from "./sdd-preflight-preferences.ts";
import { installPackageAssets } from "./sdd-preflight-assets.ts";
import { hasWritableMemoryTool } from "./jero-ai-sdd-startup.ts";
function hasAffirmativeSddIntent(text: string): boolean {
	// 自然语言路由不得依赖封闭的完整短语列表。SDD 提及只有在
	// 出现祈使、请求或第一人称意图标记时才成为调用；
	// 诸如 "I use SDD sometimes" 的中性陈述仍是普通对话。
	if (!/\bsdd\b/i.test(text)) return false;
	return /(?:\bplease\b|请|麻烦|帮我|\b(?:want|need|would\s+like|let'?s)\b|我想|我要|我们要|我们需要|需要|想要|让我们|来用|^(?:use|run|start|build|create|implement|handle|make)\b|^(?:用|使用|运行|启动|开始|构建|创建|实现|处理|做))/i.test(text);
}

export function isSddPreflightTrigger(text: string): boolean {
	const trimmed = text.trim();
	if (/^\/(?:jero-)?sdd(?:[-:][^\s]*)?(?:\s|$)/i.test(trimmed)) return true;
	if (/[?？]\s*$/.test(trimmed)) return false;
	if (
		/(?:\b(?:don't|do\s+not|never)\b|\bnot\s+(?:want|need|plan(?:ning)?|intend|use|using)\b)[^.!?\n]{0,80}\bsdd\b/i.test(trimmed) ||
		/(?:别用|不要用|不用|不想|不需要|不打算|没(?:打算|计划))[^.!?\n]{0,80}\bsdd\b/i.test(trimmed)
	) {
		return false;
	}
	return hasAffirmativeSddIntent(trimmed);
}

export function sddPreflightSessionKey(ctx: ExtensionContext): string {
	const manager = (ctx as unknown as { sessionManager?: unknown }).sessionManager;
	if (isRecord(manager)) {
		const getSessionFile = manager.getSessionFile;
		if (typeof getSessionFile === "function") {
			const value = getSessionFile.call(manager);
			if (typeof value === "string" && value.length > 0) return value;
		}
		const getSessionId = manager.getSessionId;
		if (typeof getSessionId === "function") {
			const value = getSessionId.call(manager);
			if (typeof value === "string" && value.length > 0) return value;
		}
	}
	return ctx.cwd;
}

export async function collectSddPreflightPreferences(
	ctx: ExtensionContext,
	engramAvailable: boolean,
	options: SddPreflightResolutionOptions = {},
): Promise<SddPreflightPreferences> {
	// 磁盘偏好只是建议值；它们绝不携带当前会话的同意。
	const allowExceptionOk = options.acceptSizeException === true;
	const persisted = normalizedSelections(options.persisted, engramAvailable, allowExceptionOk);
	const resolved: Partial<Record<SddPreflightField, unknown>> = { ...persisted };
	let prompted = false;
	let sizeExceptionAccepted = allowExceptionOk && persisted.chainedPrStrategy === "exception-ok";
	const promptFields = new Set(options.promptFields ?? []);
	// RPC 是无头的，尽管 Pi 在那里暴露了可用的对话框方法。
	if (ctx.hasUI && ctx.mode !== "rpc" && promptFields.size === 0) {
		const suggestions = { ...DEFAULT_SDD_PREFLIGHT, ...persisted };
		ctx.ui.notify(`SDD session suggestions: mode=${suggestions.executionMode}; artifacts=${suggestions.artifactStore}; delivery=${suggestions.chainedPrStrategy}; budget=${suggestions.reviewBudgetLines}. Saved preferences are not session consent.`, "info");
		if (typeof ctx.ui.select !== "function") throw new Error("SDD preflight confirmation UI unavailable; no session consent recorded.");
		const answer = await ctx.ui.select("Confirm SDD session preflight", ["Confirm", "Change choices"]);
		if (answer === "Confirm") prompted = true;
		else if (answer === "Change choices") for (const field of SDD_PREFLIGHT_FIELDS) promptFields.add(field);
		else throw new Error("SDD preflight cancelled; no session consent recorded.");
	}

	const usePromptedValue = (
		field: SddPreflightField,
		value: unknown,
	): void => {
		const candidate = normalizedSelections({ [field]: value }, engramAvailable, allowExceptionOk);
		if (candidate[field] !== undefined) {
			resolved[field] = candidate[field];
			if (field === "chainedPrStrategy" && candidate[field] === "exception-ok") sizeExceptionAccepted = true;
			prompted = true;
		}
	};

	const promptField = async (
		field: SddPreflightField,
		read: () => Promise<unknown>,
		enabled = true,
	): Promise<void> => {
		if (ctx.hasUI && ctx.mode !== "rpc" && enabled && promptFields.has(field)) {
			const value = await read();
			if (normalizedSelections({ [field]: value }, engramAvailable, allowExceptionOk)[field] === undefined) {
				throw new Error("SDD preflight cancelled or invalid; no session consent recorded.");
			}
			usePromptedValue(field, value);
		}
	};
	const artifactOptions = engramAvailable ? ["openspec", "engram", "hybrid"] : ["openspec"];
	const suggestedFirst = (field: SddPreflightField, values: string[]): string[] => {
		const suggested = String(resolved[field] ?? DEFAULT_SDD_PREFLIGHT[field]);
		return values.includes(suggested) ? [suggested, ...values.filter(value => value !== suggested)] : values;
	};
	await promptField("executionMode", () => ctx.ui.select("SDD execution mode", suggestedFirst("executionMode", ["interactive", "auto"])));
	await promptField("artifactStore", () => ctx.ui.select("SDD artifact store", suggestedFirst("artifactStore", artifactOptions)), artifactOptions.length > 1);
	await promptField("chainedPrStrategy", () => ctx.ui.select("SDD delivery strategy", suggestedFirst("chainedPrStrategy", ["ask-on-risk", "auto-chain", "single-pr"])));
	await promptField("reviewBudgetLines", () => ctx.ui.input("SDD review budget lines", String(resolved.reviewBudgetLines ?? DEFAULT_SDD_PREFLIGHT.reviewBudgetLines)));

	const resolvedValue = <T>(field: SddPreflightField, fallback: T): T =>
		(resolved[field] as T | undefined) ?? fallback;
	return {
		executionMode: resolvedValue("executionMode", DEFAULT_SDD_PREFLIGHT.executionMode),
		artifactStore: resolvedValue("artifactStore", DEFAULT_SDD_PREFLIGHT.artifactStore),
		chainedPrStrategy: resolvedValue("chainedPrStrategy", DEFAULT_SDD_PREFLIGHT.chainedPrStrategy),
		reviewBudgetLines: resolvedValue("reviewBudgetLines", DEFAULT_SDD_PREFLIGHT.reviewBudgetLines),
		engramAvailable,
		prompted,
		...(sizeExceptionAccepted ? { sizeExceptionAccepted: true as const } : {}),
	};
}

export function isParentConfirmedSddPreflightContext(context: unknown): context is string {
	if (typeof context !== "string") return false;
	return /^## SDD 会话预检\n(?:这些 SDD 偏好是本次会话的显式选择。除非用户明确变更，直接复用。|这些 SDD 偏好是规范默认值或已持久化的选择。视其为权威；除非到达真正的人工控制门，不要重开关联决策。)\n- 执行模式：(?:interactive|auto)\n- 产物存储：(?:openspec|engram|hybrid|none)（本会话 Engram 不可用）?\n- 交付策略：(?:ask-on-risk|auto-chain|single-pr|exception-ok)\n- 交付策略域：`ask-on-risk` \| `auto-chain` \| `single-pr` \| `exception-ok`\n- 评审预算：[1-9]\d* 变更行（400 为规范阈值，除非显式变更）\n- 链式策略：延迟至选择链式时再定。/.test(context);
}

/** 探测文本是否含预检块头部行（含仿制品）。派发门用它拒绝调用方
 * 拼写的任何预flight载荷——头部格式必须与上方权威正则同步演进，
 * 因此钉在同一个文件里。 */
export function containsSddPreflightBlockHeader(text: string): boolean {
	return /^## SDD 会话预检[ \t]*$/m.test(text);
}

export function extractParentConfirmedSddPreflightContext(context: unknown): string | undefined {
	if (!isParentConfirmedSddPreflightContext(context)) return undefined;
	return context.split("\n\n", 1)[0];
}

export function renderSddPreflightPrompt(prefs: SddPreflightPreferences): string {
	const deliveryStrategy = normalizeSddChainedPrStrategy(
		prefs.chainedPrStrategy,
		prefs.sizeExceptionAccepted === true,
	);
	const sourceLine = prefs.prompted
		? "这些 SDD 偏好是本次会话的显式选择。除非用户明确变更，直接复用。"
		: "这些 SDD 偏好是规范默认值或已持久化的选择。视其为权威；除非到达真正的人工控制门，不要重开关联决策。";
	const interactiveRules =
		prefs.executionMode === "interactive"
			? [
					"- 交互阶段门：只完成当前 SDD 阶段。除非当前用户轮次明确批准下一阶段，不得开始下一阶段。",
					"- 交互模式下，`continue`、`dale`、`go on` 这类词只批准紧邻的下一阶段，不是全部剩余阶段。",
					"- 交互模式下撰写 SDD 提案前，先向用户提供一轮提案问题，通过挖掘业务规则、隐含影响、波及面、边界情况、产品取舍与决策空白来改进 PRD/提案。每轮以 explore/research 证据与用户此前的回答为基础，优先提出 3–5 个具体的产品问题，聚焦会改变提案走向的开放分支；随后总结假设（已闭合与仍开放的分支）并询问用户是要修正还是再来一轮——用户持续作答就持续追问，直到用户停止或不再存在会改变提案的开放分支。提案阶段不主动询问测试命令、PR 形态、变更行预算等 harness 机制问题，除非用户明确要求讨论交付。",
				]
			: [
					"- 自动模式：阶段可以连续执行，唯一依据是用户选择了速度并信任此流程。",
				];
	return [
		"## SDD 会话预检",
		sourceLine,
		`- 执行模式：${prefs.executionMode}`,
		`- 产物存储：${prefs.artifactStore}${prefs.engramAvailable ? "" : "（本会话 Engram 不可用）"}`,
		`- 交付策略：${deliveryStrategy}`,
		"- 交付策略域：`ask-on-risk` | `auto-chain` | `single-pr` | `exception-ok`",
		`- 评审预算：${prefs.reviewBudgetLines} 变更行（400 为规范阈值，除非显式变更）`,
		"- 链式策略：延迟至选择链式时再定。",
		"- `exception-ok` 绝不由推断得出；它要求对 `size:exception` 的显式接受。",
		...interactiveRules,
		"- 保留人工控制的同意、授权、安全、破坏性/发布、歧义范围与 `size:exception` 门。",
		"- 当评审预算风险需要交付决策时，用 `ask-on-risk` 暂停并询问；不得发明链式策略或例外。",
	].join("\n");
}

export async function ensureSddPreflight(
	ctx: ExtensionContext,
	callbacks: SddPreflightCallbacks,
	resolutionOptions: SddPreflightResolutionOptions = {},
): Promise<SddPreflightPreferences> {
	// `collectSddPreflightPreferences` 对需要渲染选项的调用方
	// 保持为纯粹的建议解析器。持久化或提升这些选项
	// 只属于父级：RPC 子进程必须消费传输过来的已渲染块。
	if (ctx.mode === "rpc") {
		throw new Error("SDD preflight must be resolved by the parent; an RPC child cannot originate or persist defaults.");
	}
	const sessionKey = sddPreflightSessionKey(ctx);
	const existing = sddPreflightBySession.get(sessionKey);
	if (existing && !(resolutionOptions.promptFields?.length ?? 0)) return existing;
	const inFlight = sddPreflightInFlight.get(sessionKey);
	if (inFlight && !(resolutionOptions.promptFields?.length ?? 0)) return inFlight;
	const promise = (async () => {
		const engramAvailable = hasWritableMemoryTool(callbacks.pi);
		const persisted = resolutionOptions.persisted ?? readSddPreflightFromDisk(ctx.cwd);
		const prefs = await collectSddPreflightPreferences(ctx, engramAvailable, {
			...resolutionOptions,
			persisted,
		});
		const result =
			(await callbacks.installAssets?.(ctx.cwd)) ??
			(await installPackageAssets(ctx.cwd, false, ["sdd"]));
		const modelResult = (await callbacks.applyModelConfig?.(ctx.cwd)) ?? {
			updated: 0,
			skipped: 0,
		};
		if (ctx.hasUI) {
			const modelRoutingLine = modelResult.invalidPath
				? `Model routing skipped: ${modelResult.invalidPath} is invalid JSON or not an object.`
				: `Model-routed agents updated: ${modelResult.updated}`;
			ctx.ui.notify(
				[
					"Jero SDD preflight complete.",
					`Mode: ${prefs.executionMode}`,
					`Artifacts: ${prefs.artifactStore}`,
					`Delivery strategy: ${prefs.chainedPrStrategy}`,
					`Review budget: ${prefs.reviewBudgetLines} changed lines`,
					`Preference source: ${prefs.prompted ? "explicit session choice" : "canonical default or persisted preference"}`,
					`Global SDD assets ready: ${result.agents} agent(s), ${result.chains} chain(s), ${result.support} support file(s), ${result.skipped} already present.`,
					modelRoutingLine,
				].join("\n"),
				modelResult.invalidPath ? "warning" : "info",
			);
		}
		sddPreflightBySession.set(sessionKey, prefs);
		// 写盘失败不阻断预检（内存缓存是主存储），但要明确告知用户
		// 本次选择只在会话内生效，而不是静默丢失（审计 P2-17）。
		if (!writeSddPreflightToDisk(ctx.cwd, prefs)) {
			ctx.ui.notify?.(`SDD 预检偏好未写入磁盘（本次会话内仍生效）：${sddPreflightDiskPath(ctx.cwd)}`, "warning");
		}
		return prefs;
	})();
	sddPreflightInFlight.set(sessionKey, promise);
	try {
		return await promise;
	} finally {
		sddPreflightInFlight.delete(sessionKey);
	}
}

export function getSddPreflightPreferences(
	ctx: ExtensionContext,
): SddPreflightPreferences | undefined {
	const sessionKey = sddPreflightSessionKey(ctx);
	const cached = sddPreflightBySession.get(sessionKey);
	if (cached) return cached;
	// 只有 ensureSddPreflight 可以把磁盘建议提升为已解析的会话选择。
	return undefined;
}
