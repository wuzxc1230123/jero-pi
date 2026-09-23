// SDD 启动解析：代理启动事件识别、SDD 变更选择与启动状态解析、内存工具探测。
// 自 extensions/jero-ai.ts 拆分（机械平移，语义零改动）。

import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ToolCallEventResult } from "@earendil-works/pi-coding-agent";
import { SHIPPED_SDD_AGENT_NAMES } from "./sdd-preflight.ts";
import { THINKING_LEVELS, type ThinkingLevel } from "./model-routing-authority.ts";
import { resolveSddStatus, type SddPhase } from "./sdd-status.ts";
import { sanitizeTerminalText } from "./terminal-theme.ts";
import { decodeNativeSddStatusV2, type NativeReviewCli, type NativeSddStatusV2 } from "./authority/client-contract.ts";

import { PATH_GUARDED_TOOL_NAMES, PATH_INPUT_KEYS, SENSITIVE_PATH_PATTERNS } from "./jero-ai-path-guard.ts";
import { isRecord } from "./jero-ai-persona-config.ts";


export const SDD_AGENT_NAME_SET = new Set<string>(SHIPPED_SDD_AGENT_NAMES);

export const SDD_CHANGE_FLAG = "jero-sdd-change";

const SDD_CHANGE_KEYS = ["changeName", "phase", "workspaceRoot"] as const;



const JUDGMENT_DAY_AGENT_NAMES = [
	"jd-judge-a",
	"jd-judge-b",
	"jd-fix-agent",
] as const;



export const CORE_MODEL_AGENT_NAMES = [
	...SHIPPED_SDD_AGENT_NAMES,
	...JUDGMENT_DAY_AGENT_NAMES,
] as const;

export const CORE_MODEL_AGENT_NAME_SET = new Set<string>(CORE_MODEL_AGENT_NAMES);



export type AgentSource = "project" | "user" | "builtin";



export interface AgentEntry {
	name: string;
	source: AgentSource;
	filePath?: string;
}



export const KEEP_CURRENT = "Keep current";

export const INHERIT_MODEL = "Inherit active/default model";

export const CUSTOM_MODEL = "Custom model id";

export const INHERIT_THINKING = "Inherit effort";

export const THINKING_OPTIONS: (ThinkingLevel | typeof INHERIT_THINKING)[] = [
	INHERIT_THINKING,
	...THINKING_LEVELS,
];



export const MODEL_CONTROL_OPTIONS = [
	KEEP_CURRENT,
	INHERIT_MODEL,
	CUSTOM_MODEL,
] as const;

const MODEL_PANEL_MAX_RENDER_ROWS = 20;

export const AGENT_LIST_MAX_VISIBLE_ROWS = MODEL_PANEL_MAX_RENDER_ROWS - 13;

export const MODEL_LIST_MAX_VISIBLE_ROWS = 12;



function readStringPath(value: unknown, path: string[]): string | undefined {
	let current = value;
	for (const key of path) {
		if (!isRecord(current)) return undefined;
		current = current[key];
	}
	return typeof current === "string" ? current : undefined;
}



export function isSddAgentStartEvent(event: unknown): boolean {
	const candidates = readAgentStartNames(event);
	if (candidates.some((value) => SDD_AGENT_NAME_SET.has(value)) || sddPhaseFromAgentStartEvent(event) !== undefined) return true;

	const systemPrompt = readStringPath(event, ["systemPrompt"]) ?? "";
	return SHIPPED_SDD_AGENT_NAMES.some((name) => {
		const phase = name.replace(/^sdd-/, "");
		return new RegExp(`\\bSDD ${phase} executor\\b`, "i").test(systemPrompt);
	});
}



function readAgentStartNames(event: unknown): string[] {
	return [
		readStringPath(event, ["agentName"]),
		readStringPath(event, ["agent"]),
		readStringPath(event, ["name"]),
		readStringPath(event, ["agent", "name"]),
		readStringPath(event, ["subagent", "name"]),
	]
		.filter((value): value is string => value !== undefined)
		.map((value) => value.trim())
		.filter((value) => value.length > 0);
}



export function isNamedAgentStartEvent(event: unknown): boolean {
	return readAgentStartNames(event).length > 0;
}



export function sddPhaseFromAgentStartEvent(event: unknown): SddPhase | "remediate" | undefined {
	const phases = ["apply", "verify", "sync", "archive", "remediate"] as const;
	const names = readAgentStartNames(event);
	const systemPrompt = readStringPath(event, ["systemPrompt"]) ?? "";
	const promptPhases = phases.filter((phase) => new RegExp(`\\bSDD ${phase} executor\\b`, "i").test(systemPrompt));
	if (promptPhases.length > 1) return undefined;
	if (names.length === 0) return promptPhases[0];
	return phases.find((phase) => names.every((name) => name === `sdd-${phase}`) &&
		(promptPhases.length === 0 || promptPhases[0] === phase));
}



function resolveSddChangeSelection(serialized: unknown, cwd: string, agentName: string) {
	if (typeof serialized !== "string") throw new Error("SDD selection must be a JSON string.");
	let value: unknown;
	try {
		value = JSON.parse(serialized);
	} catch {
		throw new Error("SDD selection is malformed.");
	}
	if (!isRecord(value) || Object.keys(value).sort().join(",") !== (value.phase === "remediate" ? "changeName,failedEvidenceRevision,phase,workspaceRoot" : SDD_CHANGE_KEYS.join(","))) {
		throw new Error("SDD selection must contain only changeName, workspaceRoot, and phase.");
	}
	const { changeName, workspaceRoot } = value;
	const phase = value.phase;
	if (typeof changeName !== "string" || changeName.length === 0 ||
		typeof workspaceRoot !== "string" || workspaceRoot.length === 0) {
		throw new Error("SDD selection has an invalid identity.");
	}
	// phase 的判别单独成句，让字面量联合收窄在深嵌套复合条件下不退化为 string。
	if (phase !== "apply" && phase !== "verify" && phase !== "sync" && phase !== "archive" && phase !== "remediate") {
		throw new Error("SDD selection has an invalid identity.");
	}
	if (agentName !== `sdd-${phase}`) throw new Error("SDD selection phase does not match the child agent.");
	let canonicalCwd: string;
	let canonicalSelectionRoot: string;
	try {
		canonicalCwd = realpathSync(cwd);
		canonicalSelectionRoot = realpathSync(workspaceRoot);
	} catch {
		throw new Error("SDD selection workspaceRoot cannot be resolved.");
	}
	if (canonicalCwd !== canonicalSelectionRoot || workspaceRoot !== canonicalSelectionRoot) {
		throw new Error("SDD selection workspaceRoot does not match the canonical child root.");
	}
	if (phase === "remediate" && (typeof value.failedEvidenceRevision !== "string" || !/^sha256:[0-9a-f]{64}$/.test(value.failedEvidenceRevision))) throw new Error("Invalid remediation revision");
	// 判别收窄得到的字面量联合在对象属性位置会拓宽为 string；显式收窄回声明的相位联合。
	return { changeName, workspaceRoot: canonicalCwd, phase: phase as SddPhase | "remediate", ...(phase === "remediate" ? { failedEvidenceRevision: value.failedEvidenceRevision as string } : {}) };
}



export function resolveSddChangeStartup(
	serialized: unknown,
	cwd: string,
	agentName: string,
	resolver: (options: Parameters<typeof resolveSddStatus>[0]) => ReturnType<typeof resolveSddStatus> = resolveSddStatus,
) {
	const selection = resolveSddChangeSelection(serialized, cwd, agentName);
	const status = resolver({ cwd: selection.workspaceRoot, workspaceRoot: selection.workspaceRoot, changeName: selection.changeName, includeInstructions: true });
	if (status.actionContext.workspaceRoot !== selection.workspaceRoot || status.changeName !== selection.changeName) {
		throw new Error("SDD selection resolver returned a mismatched status.");
	}
	return { selection, status };
}



export async function resolveSelectedNativeSddChangeStartup(
	serialized: unknown,
	cwd: string,
	agentName: string,
	native: Pick<NativeReviewCli, "sddStatus"> | null | undefined,
	localResolver: (options: Parameters<typeof resolveSddStatus>[0]) => ReturnType<typeof resolveSddStatus> = resolveSddStatus,
): Promise<{ selection: { changeName: string; workspaceRoot: string; phase: SddPhase | "remediate"; failedEvidenceRevision?: string }; status: NativeSddStatusV2 | ReturnType<typeof resolveSddStatus> }> {
	const selection = resolveSddChangeSelection(serialized, cwd, agentName);
	if (selection.phase === "sync") {
		const status = localResolver({ cwd: selection.workspaceRoot, workspaceRoot: selection.workspaceRoot, changeName: selection.changeName, includeInstructions: true });
		if (status.actionContext.workspaceRoot !== selection.workspaceRoot || status.changeName !== selection.changeName) {
			throw new Error("SDD selection resolver returned a mismatched status.");
		}
		return { selection, status };
	}
	if (native?.sddStatus === undefined) throw new Error("SDD selection native status is unavailable.");
	let status: NativeSddStatusV2;
	try {
		status = decodeNativeSddStatusV2(
			await native.sddStatus({ changeName: selection.changeName, workspaceRoot: selection.workspaceRoot }),
			{ changeName: selection.changeName, workspaceRoot: selection.workspaceRoot },
		);
	} catch (error) {
		throw new Error(`SDD selection native status is blocked: ${error instanceof Error ? error.message : String(error)}`);
	}
	if ((selection.phase !== "remediate" && !(selection.phase in status.dependencies)) || status.phaseInstructions === undefined || !(selection.phase in status.phaseInstructions)) {
		throw new Error(`SDD selection native status cannot represent phase ${selection.phase}.`);
	}
	if (selection.phase === "remediate") {
		if (status.nextRecommended !== "remediate" || status.remediationState?.failedEvidenceRevision !== selection.failedEvidenceRevision) throw new Error("Stale remediation selection");
	} else if (status.nextRecommended !== selection.phase || status.dependencies[selection.phase] !== "ready" || (status.blockedReasons.length > 0 && selection.phase !== "verify")) {
		// 原生契约要求 `blockedReasons` 非空时阻止 terminal、archive 和
		// apply 工作，但刻意保持 `verify` 路线可运行，因为阻塞原因可以
		// 指明证据刷新这一自身解药（“失败的验证证据不完整；
		// 重新运行 SDD 验证”，gentle-ai#3538）。否决该路线会让
		// 原生推荐的阶段不可达（gentle-pi#972）。其他阶段仍然
		// 保守失败，且每个阻塞原因都保留在注入的
		// status 中供上报。
		throw new Error(`SDD selection native status blocks phase ${selection.phase}; it cannot execute.`);
	}
	return { selection, status };
}



export function readSddChangeFlag(pi: ExtensionAPI): unknown {
	try {
		const value = (pi as unknown as { getFlag?: (name: string) => unknown }).getFlag?.(SDD_CHANGE_FLAG);
		return value === false ? undefined : value;
	} catch {
		return null;
	}
}



function normalizePolicyPath(value: string): string {
	return value.trim().replace(/^~(?=\/|$)/, homedir()).replace(/\\/g, "/").toLowerCase();
}



function isSensitivePath(value: string): boolean {
	const normalized = normalizePolicyPath(value);
	return SENSITIVE_PATH_PATTERNS.some((pattern) => pattern.test(normalized));
}



function collectPathInputs(value: unknown, key?: string): string[] {
	if (typeof value === "string") return key && PATH_INPUT_KEYS.has(key) ? [value] : [];
	if (Array.isArray(value)) return value.flatMap((item) => collectPathInputs(item, key));
	if (!isRecord(value)) return [];
	return Object.entries(value).flatMap(([entryKey, entryValue]) =>
		collectPathInputs(entryValue, entryKey),
	);
}



export function hasWritableMemoryTool(pi: ExtensionAPI): boolean {
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



export function evaluateSensitivePathTool(
	toolName: string,
	input: unknown,
): ToolCallEventResult | undefined {
	if (!PATH_GUARDED_TOOL_NAMES.has(toolName)) return undefined;
	const sensitivePath = collectPathInputs(input).find(isSensitivePath);
	if (!sensitivePath) return undefined;
	return {
		block: true,
		reason: `Jero safety policy blocked access to sensitive path: ${sanitizeTerminalText(sensitivePath)}. Ask the user for an explicit safer plan.`,
	};
}

// D6（design §5.3，rpiv 行）：`rpiv:ask-user:blocked` 监听器与
// choice/questionnaire 阻塞标签已删除——由于
// @juicesharp/rpiv-ask-user-question 是硬依赖，插件自管其
// 阻塞 UX。这里剩下的是受守卫命令的确认
// 生命周期（评审同意 UI，设计上是独立组件）。
