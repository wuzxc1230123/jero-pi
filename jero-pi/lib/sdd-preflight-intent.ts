// SDD 预检意图：启动触发识别、偏好收集交互、父级确认上下文、提示渲染与会话预检。
// 自 lib/sdd-preflight.ts 拆分（机械平移，语义零改动）。

import { join } from "node:path";
import { type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	DEFAULT_SDD_PREFLIGHT, isRecord, normalizedSelections, normalizeSddChainedPrStrategy,
	readSddPreflightFromDisk, SDD_PREFLIGHT_FIELDS, sddPreflightBySession,
	type SddPreflightCallbacks, type SddPreflightField, sddPreflightInFlight,
	type SddPreflightPreferences, type SddPreflightResolutionOptions, writeSddPreflightToDisk
} from "./sdd-preflight-preferences.ts";
import { installPackageAssets } from "./sdd-preflight-assets.ts";
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

function hasWritableMemoryTool(pi: ExtensionAPI): boolean {
	try {
		const getActiveTools = (pi as unknown as { getActiveTools?: () => unknown[] })
			.getActiveTools;
		if (typeof getActiveTools !== "function") return false;
		const tools = getActiveTools.call(pi);
		return tools.some((tool) => {
			const name =
				typeof tool === "string"
					? tool
					: isRecord(tool) && typeof tool.name === "string"
						? tool.name
						: "";
			return name === "mem_save" || name.endsWith(".mem_save");
		});
	} catch {
		return false;
	}
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
	return /^## SDD Session Preflight\n(?:These SDD preferences are explicit current-session choices\. Reuse them unless the user explicitly changes them\.|These SDD preferences are canonical defaults or persisted choices\. Treat them as authoritative; do not revisit dependent decisions unless a genuine human-control gate is reached\.)\n- Execution mode: (?:interactive|auto)\n- Artifact store: (?:openspec|engram|hybrid|none)(?: \(Engram unavailable in this session\))?\n- Delivery strategy: (?:ask-on-risk|auto-chain|single-pr|exception-ok)\n- Delivery strategy domain: `ask-on-risk` \| `auto-chain` \| `single-pr` \| `exception-ok`\n- Review budget: [1-9]\d* changed lines \(400 is the canonical threshold unless explicitly changed\)\n- Chain strategy: deferred until chaining is selected\./.test(context);
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
		? "These SDD preferences are explicit current-session choices. Reuse them unless the user explicitly changes them."
		: "These SDD preferences are canonical defaults or persisted choices. Treat them as authoritative; do not revisit dependent decisions unless a genuine human-control gate is reached.";
	const interactiveRules =
		prefs.executionMode === "interactive"
			? [
					"- Interactive phase gate: complete only the current SDD phase. Do not start the next SDD phase unless the current user turn explicitly approves that next phase.",
					"- In interactive mode, words like `continue`, `dale`, or `go on` approve only the immediate next phase, not all remaining phases.",
					"- Before writing an SDD proposal in interactive mode, offer the user a proposal question round to improve the PRD/proposal by uncovering business rules, implications, impact, edge cases, product tradeoffs, and decision gaps. Prefer 3–5 concrete product questions per round, then summarize assumptions and ask whether the user wants corrections or a second question round. Do not ask about test commands, PR shape, changed-line budget, or other harness mechanics at proposal time unless the user explicitly asks to discuss delivery.",
				]
			: [
					"- Auto mode: phases may run back-to-back only because the user chose speed and trusts the flow.",
				];
	return [
		"## SDD Session Preflight",
		sourceLine,
		`- Execution mode: ${prefs.executionMode}`,
		`- Artifact store: ${prefs.artifactStore}${prefs.engramAvailable ? "" : " (Engram unavailable in this session)"}`,
		`- Delivery strategy: ${deliveryStrategy}`,
		"- Delivery strategy domain: `ask-on-risk` | `auto-chain` | `single-pr` | `exception-ok`",
		`- Review budget: ${prefs.reviewBudgetLines} changed lines (400 is the canonical threshold unless explicitly changed)`,
		"- Chain strategy: deferred until chaining is selected.",
		"- `exception-ok` is never inferred; it requires explicit acceptance of `size:exception`.",
		...interactiveRules,
		"- Preserve human-controlled consent, authorization, security, destructive/publishing, ambiguous-scope, and `size:exception` gates.",
		"- When review-budget risk requires a delivery decision, use `ask-on-risk` to pause and ask; do not invent a chain strategy or an exception.",
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
			installPackageAssets(ctx.cwd, false, ["sdd"]);
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
		writeSddPreflightToDisk(ctx.cwd, prefs);
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
