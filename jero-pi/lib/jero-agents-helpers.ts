// jero-agents 的装配助手：键位/开关环境解析、AgentsDeps 默认值、任务文本渲染、
// UI 问答桥与研究工件 schema。
// 自 extensions/jero-agents.ts 拆分（机械平移，语义零改动）。

import os from "node:os";
import { SHIPPED_SDD_AGENT_NAMES } from "./sdd-preflight.ts";
import { type NativeReviewCli } from "./authority/client-contract.ts";
import { spawn } from "node:child_process";
import { resolveSessionWorktree, type WorktreeResolver } from "./session-worktree-registry.ts";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type ExtensionAPI, type ExtensionContext, keyHint } from "@earendil-works/pi-coding-agent";
import { type AskRequest, type TaskRecord } from "./agents-protocol.ts";
import { type AskAnswer, piCommand, type RunnerDeps } from "./agents-runner.ts";
import { ChildMessenger, type IpcEndpoint } from "./agents-messaging.ts";
import { AGENTS_GLYPH } from "./agents-widget.ts";
import { type ResearchWriteIdentity } from "./sdd-research-capabilities.ts";
export const AGENTS_WIDGET_KEY = "gentle-agents";
export const AGENTS_COMMAND_NAME = "jero:agents";
export const AGENTS_RESULT_TYPE = "gentle-agents.result";
export const AGENTS_MESSAGE_TYPE = "gentle-agents.message";
export const AGENTS_STALE_RESULT_TYPE = "gentle-agents.stale-result";
const COLLAPSE_KEY_DEFAULT = "ctrl+shift+a";
const VIEW_KEY_DEFAULT = "alt+a";
const STOP_KEY_DEFAULT = "alt+s";
export const RENDER_COALESCE_MS = 400;
export const CLOCK_TICK_MS = 1000;
export const TOOL_PREFIX = "subagent_";
export const SHIPPED_SDD_AGENT_NAME_SET = new Set(SHIPPED_SDD_AGENT_NAMES);


export interface AgentsDeps extends RunnerDeps {
	nativeSdd?: NativeReviewCli;
	home: string;
	agentHome?: string;
	childIpc?: IpcEndpoint;
	env: NodeJS.ProcessEnv;
	resolveWorktree: WorktreeResolver;
	metricsNow?: () => number;
	metricsSchedule?: RunnerDeps["schedule"];
}

export function agentRuntimePaths(home: string, agentHome = join(home, ".pi", "agent")): { sessions: string; transcripts: string } {
	const root = join(agentHome, "gentle-agents");
	return { sessions: join(root, "sessions"), transcripts: join(root, "transcripts") };
}

export interface ToolText {
	content: Array<{ type: "text"; text: string }>;
	details: Record<string, unknown>;
	terminate?: boolean;
}

export const defaultDeps = (env: NodeJS.ProcessEnv): AgentsDeps => ({
	spawn: (command, args, options) => spawn(command, args, { cwd: options.cwd, env: options.env, stdio: options.stdio ?? ["pipe", "pipe", "pipe"], windowsHide: true, detached: options.detached }),
	now: () => Date.now(),
	schedule: (fn, ms) => {
		const timer = setTimeout(fn, ms);
		timer.unref?.();
		return () => clearTimeout(timer);
	},
	pi: piCommand(),
	home: os.homedir(),
	resolveWorktree: resolveSessionWorktree,
	env,
});

export function agentsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
	if (env.JERO_PI_AGENTS_CHILD === "1") return false;
	const value = env.JERO_PI_AGENTS?.trim().toLowerCase();
	return !(value === "0" || value === "false" || value === "off");
}

// 已退役的 pi-subagents 包注册了相同的工具名。只要它
// 仍被安装，我们就主动避让并说明如何切换。
export const LEGACY_SUBAGENTS_PACKAGE = "pi-subagents-j0k3r";

export function legacySubagentsInstalled(home: string): boolean {
	return legacySubagentsInstalledAt(join(home, ".pi", "agent"));
}

export function legacySubagentsInstalledAt(agentHome: string): boolean {
	const settingsPath = join(agentHome, "settings.json");
	if (!existsSync(settingsPath)) return false;
	try {
		const settings = JSON.parse(readFileSync(settingsPath, "utf8")) as { packages?: unknown };
		return Array.isArray(settings.packages) && settings.packages.some((entry) => typeof entry === "string" && entry.includes(LEGACY_SUBAGENTS_PACKAGE));
	} catch {
		return false;
	}
}

export function agentsViewKey(env: NodeJS.ProcessEnv = process.env): string | undefined {
	const value = env.JERO_PI_AGENTS_VIEW_KEY?.trim();
	if (value === undefined) return VIEW_KEY_DEFAULT;
	return value === "" || value.toLowerCase() === "off" ? undefined : value;
}

export function agentsCollapseKey(env: NodeJS.ProcessEnv = process.env): string | undefined {
	const value = env.JERO_PI_AGENTS_KEY?.trim();
	if (value === undefined) return COLLAPSE_KEY_DEFAULT;
	return value === "" || value.toLowerCase() === "off" ? undefined : value;
}

export function agentsStopKey(env: NodeJS.ProcessEnv = process.env): string | undefined {
	const value = env.JERO_PI_AGENTS_STOP_KEY?.trim();
	if (value === undefined) return STOP_KEY_DEFAULT;
	return value === "" || value.toLowerCase() === "off" ? undefined : value;
}

export function sanitizeTerminalText(value: string): string {
	return value.replace(/[\x00-\x08\x0B-\x1F\x7F-\x9F]/g, (control) => `\\x${control.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`);
}

export function messageText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content.map((part) => part && typeof part === "object" && (part as { type?: unknown }).type === "text" && typeof (part as { text?: unknown }).text === "string" ? (part as { text: string }).text : "").join("\n");
}

export function ownedChildIpc(env: NodeJS.ProcessEnv, candidate: IpcEndpoint | undefined): IpcEndpoint | undefined {
	if (env.JERO_PI_AGENTS_CHILD !== "1" || !env.JERO_PI_AGENTS_OWNED_IPC || !candidate || typeof candidate.send !== "function" || typeof candidate.on !== "function") return undefined;
	return candidate;
}

export function registerChildMessaging(pi: ExtensionAPI, ipc: IpcEndpoint): void {
	const messenger = new ChildMessenger(ipc);
	pi.registerTool({
		name: "subagent_parent_message",
		label: "Agent parent message",
		description: "Send a bounded notification or correlated query to this subagent's parent.",
		parameters: { type: "object", additionalProperties: false, required: ["message"], properties: { kind: { type: "string", enum: ["notification", "query"] }, message: { type: "string" } } } as never,
		async execute(_id, params): Promise<ToolText> {
			const input = params as { kind?: unknown; message?: unknown };
			if (typeof input.message !== "string") throw new Error("parent messages require text");
			if (input.kind === undefined || input.kind === "notification") {
				await messenger.notify(input.message);
				return { content: [{ type: "text", text: "Notification accepted by the parent." }], details: {} };
			}
			if (input.kind !== "query") throw new Error("parent messages require notification or query kind");
			const reply = await messenger.query(input.message);
			return { content: [{ type: "text", text: reply }], details: { reply } };
		},
	});
}

export function text(value: string, details: Record<string, unknown> = {}, terminate = false): ToolText {
	return { content: [{ type: "text", text: value }], details, ...(terminate ? { terminate: true } : {}) };
}

export function taskDetails(task: TaskRecord): Record<string, unknown> {
	return { gentleAgents: { taskId: task.id, agent: task.agent, status: task.status, mode: task.mode, cwd: task.cwd } };
}

export function describeTask(task: TaskRecord): string {
	const head = `${task.id} · ${task.agent} · ${task.status} · ${task.mode}`;
	const detail = task.error ? `\n${task.error}` : "";
	return `${head} · cwd: ${task.cwd} · ${task.turns} turns · ${task.toolCalls} tool calls · last: ${task.lastStep}${detail}`;
}

export function finishedText(task: TaskRecord): string {
	if (task.status === "completed") return task.result ?? "(the subagent returned no text)";
	return `Subagent ${task.agent} ${task.status}${task.error ? `: ${task.error}` : ""}${task.result ? `\n\nLast answer:\n${task.result}` : ""}`;
}

// pi 的按键提示需要可用的实时主题；在没有主题的场景（测试、无头
// 模式）下，纯文字仍能告诉读者该键的作用。
export function expandHint(expanded: boolean): string {
	try {
		return keyHint("app.tools.expand", expanded ? "collapse" : "expand");
	} catch {
		return expanded ? "collapse" : "expand";
	}
}

// 后台任务结束时模型读到的内容：先看结果状态，再看
// 答案本身。卡片渲染器显示同样的文本。
export function completionText(task: TaskRecord): string {
	const outcome = task.status === "completed" ? "finished" : task.status.replace("_", " ");
	return `Subagent ${task.agent} (task ${task.id}, "${task.label}") ${outcome}.\n\n${finishedText(task)}`;
}

// 宿主端对子进程对话框的应答：使用人类已在用的同一个
// ctx.ui，因此子代理的提问看起来与其他任何 pi 对话框一样。
export async function answerThroughUi(ui: ExtensionContext["ui"] | undefined, ask: AskRequest, raw: Record<string, unknown>): Promise<AskAnswer> {
	if (!ui) return { cancelled: true };
	const title = `${AGENTS_GLYPH} ${ask.title}`;
	switch (ask.method) {
		case "select": {
			const options = Array.isArray(raw.options) ? raw.options.map(String) : [];
			const value = await ui.select(title, options);
			return value === undefined ? { cancelled: true } : { value };
		}
		case "confirm":
			return { confirmed: await ui.confirm(title, typeof raw.message === "string" ? raw.message : "") };
		case "input": {
			const value = await ui.input(title, typeof raw.placeholder === "string" ? raw.placeholder : undefined);
			return value === undefined ? { cancelled: true } : { value };
		}
		case "editor": {
			const value = await ui.editor(title, typeof raw.prefill === "string" ? raw.prefill : undefined);
			return value === undefined ? { cancelled: true } : { value };
		}
		default:
			return { cancelled: true };
	}
}

export interface ResearchArtifactCallObservation {
	index: number;
	desired?: ResearchWriteIdentity;
}
export const RESEARCH_ARTIFACT_SCHEMA = {
	type: "object", description: "Untrusted exact artifact intent, never authorization or readback. Same bounds required on continuation.",
	required: ["store", "worktree", "changeName", "retainedIntent", "locators"],
	properties: {
		store: { type: "string", enum: ["openspec", "engram", "both", "none"] }, worktree: { type: "string" }, changeName: { type: "string" }, retainedIntent: { type: "string" },
		locators: { type: "array", maxItems: 3, items: { type: "object", required: ["artifact", "revision", "digest"], properties: {
			artifact: { type: "string", enum: ["research", "preproposal", "explore"] }, revision: { type: "integer", minimum: 1 }, digest: { type: "string", pattern: "^[a-f0-9]{64}$" }, path: { type: "string" },
			engram: { type: "object", required: ["topic_key"], properties: { topic_key: { type: "string" } } },
		} } },
	},
};
export const RESEARCH_SELECTION_SCHEMA = {
	type: "object",
	additionalProperties: false,
	description: "Untrusted narrowing intent for sdd-research; exact tools and existing sourceInfo.path per tool. Never grants permissions or installs extensions.",
	properties: Object.fromEntries(["documentation", "open-web"].map(kind => [kind, {
		type: "object", additionalProperties: false, required: ["tools", "extensions"],
		properties: {
			tools: { type: "array", items: { type: "string" } },
			extensions: { type: "object", additionalProperties: { type: "string" } },
		},
	}])),
};

