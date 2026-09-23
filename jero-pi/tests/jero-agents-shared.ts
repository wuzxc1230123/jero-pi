// jero-agents 测试共享夹具与助手：自 jero-agents.test.ts 机械平移（语义零改动）。

import { default as assert } from "node:assert/strict";
import {
	appendFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync,
	rmSync, writeFileSync
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { join, relative, resolve, sep } from "node:path";
import { pendingReviewMutation, REVIEW_REMINDER_RECEIPT } from "../lib/review-reminder-receipt.ts";
import { SESSION_WORKTREE_CHANGED, SESSION_WORKTREE_ENTRY } from "../lib/session-worktree-registry.ts";
import { after, default as test, mock } from "node:test";
import { type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { type TuiMouseEvent, visibleWidth } from "@earendil-works/pi-tui";
import {
	agentRuntimePaths, agentsCollapseKey, type AgentsDeps, agentsEnabled, agentsStopKey,
	agentsViewKey, answerThroughUi, completionText, default as gentleAgents,
	legacySubagentsInstalled
} from "../extensions/jero-agents.ts";
import { historyDir, loadHistory, saveTask } from "../lib/agents-history.ts";
import { STALE_COMPLETION_MS } from "../lib/agents-completion-delivery.ts";
import { applyTaskEvent, emptyThread, TASK_EVENT, TASK_STATUS, type TaskRecord, TaskStore } from "../lib/agents-protocol.ts";
import { NativePointerScope } from "../lib/native-pointer-region.ts";
import { listPresence, PresenceCursor, PresencePublisher, readActivity } from "../lib/orchestrator-presence.ts";
import { stripAnsi } from "../lib/terminal-theme.ts";
import { fakeChild, type FakeChild } from "./agents-fake-child.ts";
import { AgentRunner } from "../lib/agents-runner.ts";
import { type NativeReviewCli } from "../lib/authority/client-contract.ts";
import { CHILD_METRICS_EVENT } from "../lib/runtime-metrics-children.ts";
import { renderSddPreflightPrompt } from "../lib/sdd-preflight.ts";
import { eventually, liveInstance, liveOverlay, liveProfile, shutdownAndRestoreNativeSpawn, tick } from "./jero-agents.test.ts";


// Gentle Agents extension: the subagent_* tools drive isolated pi children,
// the card above the editor follows the store, and dialogs reach the host UI.

export type Handler = (event: unknown, ctx: ExtensionContext) => unknown;
export interface Registered {
	parameters: { properties: Record<string, unknown> };
	renderShell?: string;
	name: string;
	execute(id: string, params: unknown, signal: AbortSignal | undefined, onUpdate: undefined, ctx: ExtensionContext): Promise<{ content: Array<{ text: string }>; details: Record<string, unknown> }>;
	renderCall(args: unknown, theme: unknown): { render(width: number): string[] };
}

export const plainTheme = { fg: (_color: string, text: string) => text };
export const fakeTui = { requestRender() {} };
export const PARENT_CONFIRMED_SDD_CONTEXT = renderSddPreflightPrompt({
	executionMode: "auto",
	artifactStore: "openspec",
	chainedPrStrategy: "ask-on-risk",
	reviewBudgetLines: 400,
	engramAvailable: false,
	prompted: true,
});

export type Overlay = {
	render(width: number): string[];
	handleInput(data: string): void;
	handleMouse?(event: TuiMouseEvent): unknown;
};

export function mouse(
	type: TuiMouseEvent["type"],
	button: TuiMouseEvent["button"],
	x: number,
	y: number,
	width: number,
	height: number,
): TuiMouseEvent {
	return { type, button, x, y, screenX: x, screenY: y, width, height, shift: false, alt: false, ctrl: false };
}
export const root = mkdtempSync(join(tmpdir(), "gentle-agents-ext-"));
after(() => rmSync(root, { recursive: true, force: true }));
export const home = join(root, "home");
export const cwd = join(root, "project");
export const nonGitCwd = join(root, "non-git-project");
mkdirSync(join(home, ".pi", "agent", "agents"), { recursive: true });
mkdirSync(cwd, { recursive: true });
mkdirSync(nonGitCwd, { recursive: true });
writeFileSync(join(home, ".pi", "agent", "agents", "explore.md"), "---\ndescription: maps things\nmodel: openai-codex/gpt-5.6-terra\nthinking: high\ntools: [read, grep]\n---\nYou map things.");
writeFileSync(join(home, ".pi", "agent", "subagents.json"), JSON.stringify({ max_concurrency: 2, model_profiles: { explore: { effort: "low" } } }));

export function fakePi() {
	const handlers = new Map<string, Handler[]>();
	const tools = new Map<string, Registered>();
	const shortcuts = new Map<string, { description: string; handler(ctx: ExtensionContext): Promise<void> }>();
	const commands = new Map<string, { handler(args: string, ctx: ExtensionContext): Promise<void> }>();
	const sent: Array<{ message: Record<string, unknown>; options: Record<string, unknown> }> = [];
	const renderers = new Map<string, (message: unknown, options: { expanded: boolean }, theme: unknown) => { render(width: number): string[] }>();
	const entryRenderers = new Map<string, (entry: { type: string; customType: string; data: unknown }, options: { expanded: boolean }, theme: unknown) => { render(width: number): string[] }>();
	const entries: Array<{ type: string; customType: string; data: unknown }> = [];
	const events: Array<{ name: string; data: unknown }> = [];
	const listeners = new Map<string, Set<(data: unknown) => void>>();
	const pi = {
		appendEntry: (customType: string, data: unknown) => entries.push({ type: "custom", customType, data }),
		events: {
			emit: (name: string, data: unknown) => { events.push({ name, data }); for (const listener of listeners.get(name) ?? []) listener(data); },
			on: (name: string, listener: (data: unknown) => void) => {
				const set = listeners.get(name) ?? new Set(); listeners.set(name, set); set.add(listener);
				return () => { set.delete(listener); };
			},
		},
		sendMessage: (message: Record<string, unknown>, options: Record<string, unknown>) => sent.push({ message, options }),
		registerMessageRenderer: (type: string, renderer: (message: unknown, options: { expanded: boolean }, theme: unknown) => { render(width: number): string[] }) => renderers.set(type, renderer),
		registerEntryRenderer: (type: string, renderer: (entry: { type: string; customType: string; data: unknown }, options: { expanded: boolean }, theme: unknown) => { render(width: number): string[] }) => entryRenderers.set(type, renderer),
		on: (event: string, handler: Handler) => handlers.set(event, [...(handlers.get(event) ?? []), handler]),
		registerTool: (tool: Registered) => tools.set(tool.name, tool),
		registerShortcut: (key: string, registration: { description: string; handler(ctx: ExtensionContext): Promise<void> }) => shortcuts.set(key, registration),
		registerCommand: (name: string, registration: { handler(args: string, ctx: ExtensionContext): Promise<void> }) => commands.set(name, registration),
	} as unknown as ExtensionAPI;
	const fire = async (event: string, ctx: ExtensionContext, payload: unknown = {}) => {
		for (const handler of handlers.get(event) ?? []) await handler(payload, ctx);
	};
	return { pi, tools, shortcuts, commands, fire, sent, renderers, entryRenderers, entries, events, listeners };
}

export function fakeContext(tui: { requestRender(): void } = fakeTui, confirmResult: (title: string, message: string) => Promise<boolean> = async () => true, inputResult: (title: string, placeholder: string | undefined) => Promise<string | undefined> = async () => undefined, overlayTui: { terminal: { rows: number }; requestRender(): void } = { terminal: { rows: 30 }, requestRender() {} }) {
	const widgets = new Map<string, (tui: unknown, theme: unknown) => { render(width: number): string[] }>();
	const dialogs: string[] = [];
	const overlays: Overlay[] = [];
	const customCompletions: unknown[] = [];
	const customOptions: unknown[] = [];
	const ctx = {
		cwd,
		hasUI: true,
		mode: "tui",
		sessionManager: { getSessionId: () => "s1", getCwd: () => cwd, getEntries: () => [] },
		ui: {
			notify: (message: string) => dialogs.push(`notify:${message}`),
			custom: (factory: (tui: unknown, theme: unknown, keybindings: unknown, done: (value: unknown) => void) => Overlay, options: unknown) =>
				new Promise((resolve) => {
					customOptions.push(options);
					const done = (value: unknown) => {
						customCompletions.push(value);
						resolve(value);
					};
					const component = factory(overlayTui, plainTheme, {}, done);
					overlays.push(component);
				}),
			setWidget(key: string, content: ((tui: unknown, theme: unknown) => { render(width: number): string[] }) | undefined) {
				if (content === undefined) widgets.delete(key);
				else widgets.set(key, content);
			},
			select: async (title: string, options: string[]) => {
				dialogs.push(`select:${title}:${options.join("|")}`);
				return options[0];
			},
			confirm: async (title: string, message: string) => {
				dialogs.push(`confirm:${title}:${message}`);
				return confirmResult(title, message);
			},
			input: async (title: string, placeholder: string | undefined) => {
				dialogs.push(`input:${title}`);
				return inputResult(title, placeholder);
			},
			editor: async () => "edited",
		},
	} as unknown as ExtensionContext;
	const widget = () => {
		const factory = widgets.get("gentle-agents");
		return factory ? factory(tui, plainTheme).render(72).map(stripAnsi) : undefined;
	};
	return { ctx, widget, dialogs, overlays, customCompletions, customOptions };
}

export function deps(): { deps: Partial<AgentsDeps>; children: FakeChild[]; spawned: string[][] } {
	const children: FakeChild[] = [];
	const spawned: string[][] = [];
	let clock = 1000;
	return {
		children,
		spawned,
		deps: {
			spawn: (command, args) => {
				spawned.push([command, ...args]);
				const child = fakeChild();
				children.push(child);
				return child.child;
			},
			now: () => (clock += 500),
			schedule: () => () => {},
			pi: { command: "pi", args: [] },
			home,
			resolveWorktree: (path, base) => ({ root: resolve(base, path), commonDir: "/fixture/common" }),
			env: { PATH: "/bin" },
		},
	};
}

