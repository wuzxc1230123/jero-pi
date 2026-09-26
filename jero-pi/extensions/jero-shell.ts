import { CustomEditor, keyHint, type ExtensionAPI, type ExtensionContext, type KeybindingsManager } from "@earendil-works/pi-coding-agent";
import type { EditorTheme, TUI } from "@earendil-works/pi-tui";
import { execFile, spawnSync } from "node:child_process";
import { statSync } from "node:fs";
import { profilesFilePath, readProfilesFileResult } from "../lib/agent-profiles.ts";
import * as os from "node:os";
import { join } from "node:path";
import { renderShellBar, renderShellSidebarBar, shellEnabled, type ShellBarModel, type ShellBarTheme } from "../lib/shell-bar.ts";
import { CHANGE_STATUS, renderChangesWidget, type ChangedFile, type ChangesModel, type GitRunner, type WorktreeChanges } from "../lib/shell-changes.ts";
import { WorktreeChangesView } from "../lib/shell-changes-view.ts";
import { SessionWorktreeRegistry, resolveSessionWorktree, worktreeGitEnvironment, type WorktreeResolver } from "../lib/session-worktree-registry.ts";
import { CARD_TONE, renderCard, type Card, type CardTheme } from "../lib/shell-card.ts";
import { framePromptLines, PROMPT_HINT, PROMPT_STATE, withPromptHint, type PromptState } from "../lib/shell-prompt.ts";
import { accountIdFromToken, CODEX_PROVIDER, CODEX_USAGE_URL, parseCodexUsage, parseUsageHeaders, UsageStore, type ProviderUsage } from "../lib/shell-usage.ts";
import { UsageView } from "../lib/shell-usage-view.ts";
import { sidebarPart } from "../lib/shell-sidebar.ts";
import { installSidebar, invalidateSidebar } from "../lib/shell-sidebar-layout.ts";
import { SessionChanges, SESSION_CHANGE_EVENT } from "../lib/session-changes.ts";
import { installSessionChangeCapture } from "../lib/session-change-capture.ts";

// Jero Shell：gentle-pi 叠加在 pi 之上的视觉层。它安装
// 状态栏、花瓣提示符、工作树变更挂件与覆盖层、
// 订阅用量视图，以及绘制 Jero 通知所用的卡片。

export interface ShellFooterData {
	getGitBranch(): string | null;
	getExtensionStatuses(): ReadonlyMap<string, string>;
	getAvailableProviderCount(): number;
	onBranchChange(callback: () => void): () => void;
}

interface ShellRenderHost {
	requestRender(): void;
	invalidateSidebar?(): void;
}

interface ShellBarComponent {
	render(width: number): string[];
	invalidate(): void;
	dispose(): void;
}

interface BuildOptions {
	profile?: string;
	home?: string;
	dirty?: number;
	usage?: ProviderUsage;
}

export type DevBinaryNotice = { state: "active"; path: string; sha256: string } | { state: "invalid"; reason: string };

export interface ShellDeps {
	activeProfile(): string | undefined;
	fetch: typeof fetch;
	now(): number;
	devBinary(): DevBinaryNotice | undefined;
	resolveWorktree: WorktreeResolver;
	gitRunner(cwd: string): GitRunner;
}

// 侧栏摘要每帧运行。按文件身份与元数据缓存解析结果，
// 而不只靠 mtime：profile 写入是原子替换整个存储。缓存
// 保持在当前 shell 实例本地，面板编辑后在下一帧重新检查。
export function createActiveProfileReader(env: NodeJS.ProcessEnv = process.env): () => string | undefined {
	const path = profilesFilePath(env.JERO_PI_CONFIG_HOME ?? join(os.homedir(), ".pi", "jero"));
	let fingerprint: string | undefined;
	let name: string | undefined;
	return () => {
		try {
			const stat = statSync(path, { bigint: true });
			const next = `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
			if (next !== fingerprint) {
				const result = readProfilesFileResult(path);
				name = result.status === "valid" ? result.file.active : undefined;
				fingerprint = next;
			}
			return name;
		} catch {
			fingerprint = undefined;
			name = undefined;
			return undefined;
		}
	};
}

// jero-pi：随打包二进制一起，开发版二进制覆盖通道已移除。
function ambientDevBinary(): DevBinaryNotice | undefined {
	return undefined;
}

const defaultShellDeps: Omit<ShellDeps, "activeProfile"> = { fetch: (input, init) => globalThis.fetch(input, init), now: () => Date.now(), devBinary: ambientDevBinary, resolveWorktree: resolveSessionWorktree, gitRunner: shellGitRunner };

interface AssistantUsageEntry {
	type: string;
	message?: {
		role?: string;
		usage?: {
			cost?: { total?: number };
		};
	};
}

function shortenHome(cwd: string, home: string | undefined): string {
	if (home && cwd.startsWith(home)) return `~${cwd.slice(home.length)}`;
	return cwd;
}

function sessionCost(ctx: ExtensionContext): number {
	let total = 0;
	for (const entry of ctx.sessionManager.getEntries() as AssistantUsageEntry[]) {
		if (entry.type !== "message" || entry.message?.role !== "assistant") continue;
		total += entry.message.usage?.cost?.total ?? 0;
	}
	return total;
}

export function buildShellBarModel(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	footerData: ShellFooterData,
	options: BuildOptions = {},
): ShellBarModel {
	const home = options.home ?? os.homedir();
	const usage = ctx.getContextUsage();
	const model = ctx.model;
	const statuses = Array.from(footerData.getExtensionStatuses().entries())
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([, text]) => text);
	return {
		cwd: shortenHome(ctx.sessionManager.getCwd(), home),
		profile: options.profile,
		branch: footerData.getGitBranch(),
		dirty: options.dirty,
		sessionName: ctx.sessionManager.getSessionName(),
		modelId: model?.id ?? "no-model",
		effort: model?.reasoning ? pi.getThinkingLevel() : undefined,
		contextPercent: usage?.percent ?? null,
		contextWindow: usage?.contextWindow ?? model?.contextWindow ?? 0,
		costTotal: sessionCost(ctx),
		subscription: model ? ctx.modelRegistry.isUsingOAuth(model) : false,
		usage: options.usage,
		statuses,
	};
}

export function createShellBarComponent(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	host: ShellRenderHost,
	theme: ShellBarTheme,
	footerData: ShellFooterData,
	dirty: () => number | undefined = () => undefined,
	usage: () => ProviderUsage | undefined = () => undefined,
): ShellBarComponent {
	const unsubscribe = footerData.onBranchChange(() => {
		host.invalidateSidebar?.();
		host.requestRender();
	});
	return {
		render(width: number) {
			return renderShellBar(buildShellBarModel(pi, ctx, footerData, { dirty: dirty(), usage: usage() }), theme, width);
		},
		invalidate() {},
		dispose() {
			unsubscribe();
		},
	};
}

interface PromptEditorDeps {
	fg: (color: string, text: string) => string;
	bold: (text: string) => string;
	requestRender(): void;
	pending(): boolean;
}

const PROMPT_FRAME_ROLE = "border";

const PETAL_PULSE_MS = 160;

export class JeroPromptEditor extends CustomEditor {
	private promptState: PromptState = PROMPT_STATE.IDLE;
	private tick = 0;
	private pulse: NodeJS.Timeout | undefined;
	private readonly deps: PromptEditorDeps;

	constructor(tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager, deps: PromptEditorDeps) {
		super(tui, theme, keybindings);
		this.deps = deps;
	}

	setWorking(working: boolean): void {
		this.promptState = working ? PROMPT_STATE.WORKING : PROMPT_STATE.IDLE;
		this.stopPulse();
		if (working) {
			this.pulse = setInterval(() => {
				this.tick += 1;
				this.deps.requestRender();
			}, PETAL_PULSE_MS);
			this.pulse.unref();
		}
		this.deps.requestRender();
	}

	render(width: number): string[] {
		const lines = super.render(Math.max(1, width - 2));
		if (this.getText() === "" && lines.length === 3) lines[1] = withPromptHint(lines[1], PROMPT_HINT, this.deps.fg);
		const state = this.promptState === PROMPT_STATE.WORKING && this.deps.pending() ? PROMPT_STATE.QUEUED : this.promptState;
		// 边框保持主题的边框色而非 pi 的思考级别
		// 颜色，让提示符与周围卡片读起来像一个整体面板。
		return framePromptLines(lines, width, {
			state,
			tick: this.tick,
			borderColor: (text) => this.deps.fg(PROMPT_FRAME_ROLE, text),
			fg: this.deps.fg,
			bold: this.deps.bold,
		});
	}

	dispose(): void {
		this.stopPulse();
	}

	private stopPulse(): void {
		if (this.pulse) clearInterval(this.pulse);
		this.pulse = undefined;
		this.tick = 0;
	}
}

function installPrompt(ctx: ExtensionContext, onCreated: (prompt: JeroPromptEditor) => void): void {
	if (ctx.ui.getEditorComponent()) return;
	ctx.ui.setEditorComponent((tui, theme, keybindings) => {
		const prompt = new JeroPromptEditor(tui, theme, keybindings, {
			fg: (color, text) => ctx.ui.theme.fg(color as Parameters<typeof ctx.ui.theme.fg>[0], text),
			bold: (text) => ctx.ui.theme.bold(text),
			requestRender: () => tui.requestRender(),
			pending: () => ctx.hasPendingMessages(),
		});
		onCreated(prompt);
		return prompt;
	});
}

const CHANGES_WIDGET_KEY = "jero-shell-changes";
const CHANGES_COMMAND_NAME = "jero:changes";
const CHANGES_SHORTCUT_DEFAULT = "alt+g";
const CHANGES_POLL_DEFAULT_MS = 2000;
const GIT_TIMEOUT_MS = 5000;
const OVERLAY_HEIGHT_RATIO = 0.8;
const OVERLAY_MIN_ROWS = 8;

export function shellGitRunner(cwd: string, env: NodeJS.ProcessEnv = process.env, run: typeof execFile = execFile): GitRunner {
	// Pi exec 无法替换继承的环境变量。直接使用 argv，并为
	// 发现、状态与惰性 diff 提供完整净化过的环境。
	const childEnv = worktreeGitEnvironment(env);
	return (args) => new Promise((resolve) => {
		run("git", ["-C", cwd, ...args], {
			env: childEnv,
			encoding: "utf8",
			shell: false,
			windowsHide: true,
			timeout: GIT_TIMEOUT_MS,
			// Pi exec 累积输出而不设 maxBuffer 上限。尤其是，
			// 大的 porcelain 清单绝不能变成残缺的成功扫描。
			maxBuffer: Infinity,
		}, (error, stdout) => {
			resolve({ stdout, code: error ? typeof error.code === "number" ? error.code : 1 : 0 });
		});
	});
}

export async function loadFileDiff(git: GitRunner, file: ChangedFile): Promise<string> {
	const args = file.status === CHANGE_STATUS.UNTRACKED ? ["diff", "--no-index", "--", "/dev/null", file.path] : ["diff", "HEAD", "--", file.path];
	const result = await git(args);
	return result.code === 0 || result.code === 1 ? result.stdout : "";
}

export interface ExternalEditorHost {
	stop(): void;
	start(): void;
	requestRender(force?: boolean): void;
}

export function openInExternalEditor(host: ExternalEditorHost, path: string, env: NodeJS.ProcessEnv = process.env, spawn: typeof spawnSync = spawnSync, cwd?: string, platform: NodeJS.Platform = process.platform): boolean {
	const command = env.VISUAL || env.EDITOR;
	if (!command) return false;
	const [editor, ...editorArgs] = command.split(" ");
	const useShell = platform === "win32";
	host.stop();
	try {
		// 使用 `shell: true` 时，Node 交给 cmd.exe 的是按空格拼接的原始
		// 命令行，因此任何含空格的参数（带空格的用户目录下的转录文件、
		// 编辑器标志路径）都会被拆成幻影参数。为 cmd
		// 给每个参数加引号；双写引号是 cmd 的引号内转义。
		const argv = [...editorArgs, path].map((arg) => (useShell && /\s/.test(arg) ? `"${arg.replace(/"/g, '""')}"` : arg));
		spawn(editor, argv, { cwd, stdio: "inherit", shell: useShell });
	} finally {
		host.start();
		host.requestRender(true);
	}
	return true;
}

export function changesShortcut(env: NodeJS.ProcessEnv = process.env): string | undefined {
	const value = env.JERO_PI_SHELL_CHANGES_KEY?.trim();
	if (value === undefined) return CHANGES_SHORTCUT_DEFAULT;
	return value === "" || value.toLowerCase() === "off" ? undefined : value;
}

function positiveMs(value: string | undefined, fallback: number): number {
	const parsed = Number.parseInt(value ?? "", 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function changesPollMs(env: NodeJS.ProcessEnv): number {
	return positiveMs(env.JERO_PI_SHELL_CHANGES_POLL_MS, CHANGES_POLL_DEFAULT_MS);
}

function changesFingerprint(model: ChangesModel): string {
	return model.files.map((file) => `${file.path}:${file.status}:${file.added}:${file.deleted}:${file.diffRevision ?? ""}:${file.countsUnavailable ?? ""}`).join("|");
}

interface OverlayDeps {
	loadDiff(root: string, file: ChangedFile): string;
	worktrees(): WorktreeChanges[];
	refresh(): Promise<ChangesModel>;
	apply(ctx: ExtensionContext, model: ChangesModel): void;
	pollMs: number;
}

// 只刷新捕获到的会话模型。此处绝不读取实时文件或 Git。
async function showChangesOverlay(ctx: ExtensionContext, deps: OverlayDeps): Promise<void> {
	let host: ExternalEditorHost | undefined;
	let view: WorktreeChangesView | undefined;
	const refresh = async () => {
		const latest = await deps.refresh();
		view?.update(deps.worktrees());
		deps.apply(ctx, latest);
	};
	// 轮询拒绝不得逃逸成 unhandledRejection（Node 15+ 默认致命）；
	// 保底捕获后保留上次数据，用户可再触发刷新。
	const poll = setInterval(() => { void refresh().catch(() => {}); }, deps.pollMs);
	poll.unref();
	try {
		const chosen = await ctx.ui.custom<{ root: string; file: ChangedFile } | null>(
			(tui, theme, _keybindings, done) => {
				host = tui;
				view = new WorktreeChangesView(deps.worktrees(), {
					theme,
					rows: () => Math.max(OVERLAY_MIN_ROWS, Math.floor(tui.terminal.rows * OVERLAY_HEIGHT_RATIO)),
					loadDiff: (root, file) => Promise.resolve(deps.loadDiff(root, file)),
					onOpen: (root, file) => done({ root, file }),
					onRefresh: () => { void refresh().catch(() => {}); },
					onClose: () => done(null),
					requestRender: () => tui.requestRender(),
				});
				return view;
			},
			{ overlay: true, overlayOptions: { width: "92%", anchor: "center" } },
		);
		if (!chosen || !host) return;
		if (!openInExternalEditor(host, chosen.file.path, process.env, spawnSync, chosen.root)) ctx.ui.notify("No editor configured. Set $VISUAL or $EDITOR.", "warning");
	} finally {
		clearInterval(poll);
		view?.dispose();
		view = undefined;
	}
}

function showChanges(ctx: ExtensionContext, model: ChangesModel): void {
	if (model.files.length === 0) {
		ctx.ui.setWidget(CHANGES_WIDGET_KEY, undefined);
		return;
	}
	ctx.ui.setWidget(
		CHANGES_WIDGET_KEY,
		(tui, theme) => sidebarPart(tui, "changes", {
			render(width: number) {
				return renderChangesWidget(model, theme, width);
			},
			invalidate() {},
		}, {
			render(width: number) {
				const noun = model.files.length === 1 ? "file" : "files";
				return renderCard({
					title: "Changes",
					tone: CARD_TONE.INFO,
					body: [
						`${model.files.length} ${noun} · ${theme.fg("success", `+${model.added}`)} ${theme.fg("error", `−${model.deleted}`)}`,
						"",
						theme.fg("muted", `/${CHANGES_COMMAND_NAME}`),
					],
				}, theme, width, { expanded: true });
			},
			invalidate() {},
		}),
		{ placement: "belowEditor" },
	);
}

const USAGE_COMMAND_NAME = "jero:usage";
const REVIEW_PREFLIGHT_TYPE = "jero.review-preflight";
const DEV_BINARY_WIDGET_KEY = "gentle-shell-dev-binary";
const SHA_PREFIX_LENGTH = 16;

function messageText(content: string | Array<{ type: string; text?: string }>): string {
	if (typeof content === "string") return content;
	return content.map((part) => (part.type === "text" ? (part.text ?? "") : "")).join("\n");
}

interface CardComponentOptions {
	expanded: boolean;
	hint?: string;
}

function cardComponent(card: Card, theme: CardTheme, options: CardComponentOptions) {
	return {
		render(width: number) {
			return renderCard(card, theme, width, options);
		},
		invalidate() {},
	};
}

// 编辑器上方的挂件紧贴提示符边框；卡片后面的一个空行
// 使两个边框保持间隔。
function spaced(component: { render(width: number): string[]; invalidate(): void }) {
	return {
		render(width: number) {
			return [...component.render(width), ""];
		},
		invalidate() {},
	};
}

export function devBinaryCard(notice: DevBinaryNotice): Card {
	if (notice.state === "invalid") {
		return { title: "Jero", subtitle: "dev binary override invalid", body: [notice.reason], tone: CARD_TONE.ERROR };
	}
	return {
		title: "Jero",
		subtitle: "dev binary override · field-test only",
		body: [`${notice.path} · sha256:${notice.sha256.slice(0, SHA_PREFIX_LENGTH)}`],
		tone: CARD_TONE.WARNING,
	};
}

const USAGE_REFRESH_MS = 5 * 60_000;

// Codex 用量端点正是 Codex CLI 自己读取的那个。pi 已持有的
// OAuth 令牌携带账号 id；不发送其他任何东西。
export async function fetchCodexUsage(token: string | undefined, fetchFn: typeof fetch, now: number): Promise<ProviderUsage | undefined> {
	if (!token) return undefined;
	const accountId = accountIdFromToken(token);
	if (!accountId) return undefined;
	try {
		const response = await fetchFn(CODEX_USAGE_URL, {
			headers: { Authorization: `Bearer ${token}`, "chatgpt-account-id": accountId, originator: "pi", "User-Agent": "jero-pi" },
		});
		if (!response.ok) return undefined;
		return parseCodexUsage(await response.json(), now);
	} catch {
		return undefined;
	}
}

export default function jeroShell(pi: ExtensionAPI, env: NodeJS.ProcessEnv = process.env, overrides: Partial<ShellDeps> = {}): void {
	installSessionChangeCapture(pi, env, overrides.resolveWorktree ?? resolveSessionWorktree);
	if (!shellEnabled(env)) return;
	const deps: ShellDeps = { ...defaultShellDeps, activeProfile: createActiveProfileReader(env), ...overrides };
	const usage = new UsageStore();
	let renderHost: ShellRenderHost | undefined;
	let usageFetchedAt = 0;
	const refreshUsage = async (ctx: ExtensionContext, force: boolean) => {
		const provider = ctx.model?.provider;
		if (provider !== CODEX_PROVIDER) return;
		const now = deps.now();
		if (!force && now - usageFetchedAt < USAGE_REFRESH_MS) return;
		usageFetchedAt = now;
		const token = await ctx.modelRegistry.getApiKeyForProvider(CODEX_PROVIDER).catch(() => undefined);
		const fetched = await fetchCodexUsage(token, deps.fetch, deps.now());
		if (!fetched) return;
		usage.record(fetched);
		renderHost?.invalidateSidebar?.();
		renderHost?.requestRender();
	};
	pi.on("after_provider_response", (event) => {
		const parsed = parseUsageHeaders(event.headers, deps.now());
		if (!parsed) return;
		usage.record(parsed);
		renderHost?.invalidateSidebar?.();
		renderHost?.requestRender();
	});
	pi.registerMessageRenderer(REVIEW_PREFLIGHT_TYPE, (message, options, theme) => {
		const body = messageText(message.content as string | Array<{ type: string; text?: string }>).split("\n");
		const hint = keyHint("app.tools.expand", options.expanded ? "collapse" : "expand");
		return cardComponent({ title: "Jero", subtitle: "review preflight", body, tone: CARD_TONE.INFO }, theme, { expanded: options.expanded, hint });
	});
	pi.registerCommand(USAGE_COMMAND_NAME, {
		description: "Show subscription usage windows for the connected providers. Press r to refetch.",
		handler: async (_args, ctx) => {
			await refreshUsage(ctx, true);
			await ctx.ui.custom<null>(
				(tui, theme, _keybindings, done) =>
					new UsageView(usage, {
						theme,
						now: () => deps.now(),
						active: () => (ctx.model ? { provider: ctx.model.provider } : undefined),
						onRefresh: () => refreshUsage(ctx, true),
						onClose: () => done(null),
						requestRender: () => tui.requestRender(),
					}),
				{ overlay: true, overlayOptions: { width: "70%", minWidth: 60, anchor: "center" } },
			);
		},
	});
	let prompt: JeroPromptEditor | undefined;
	let changes: SessionChanges | undefined;
	let registry: SessionWorktreeRegistry | undefined;
	let currentContext: ExtensionContext | undefined;
	let shown = "";
	const applyChanges = (ctx: ExtensionContext, model: ChangesModel) => {
		const fingerprint = changesFingerprint(model);
		if (fingerprint === shown) return;
		shown = fingerprint;
		showChanges(ctx, model);
	};
	const refreshChanges = async (ctx: ExtensionContext) => {
		const tracker = changes;
		if (!tracker || !ctx.hasUI || registry?.sessionId !== ctx.sessionManager.getSessionId()) return;
		tracker.restore(ctx.sessionManager.getEntries());
		const model = await tracker.refresh();
		if (changes === tracker) applyChanges(ctx, model);
	};
	const unsubscribeWorktrees = pi.events.on(SESSION_CHANGE_EVENT, (data) => {
		if (!currentContext || !registry || (data as { sessionId?: string } | undefined)?.sessionId !== registry.sessionId) return;
		if ((data as { notice?: string }).notice) currentContext.ui.notify((data as { notice: string }).notice, "warning");
		void refreshChanges(currentContext);
	});
	pi.registerTool({
		name: "session_worktree_register",
		renderShell: "self",
		label: "Register session worktree",
		description: "Register a worktree in the same Git clone for session coordination. Registration does not attribute file changes; Changes shows captured write/edit operations only.",
		parameters: { type: "object", required: ["path"], additionalProperties: false, properties: { path: { type: "string", description: "Worktree path to include in this session." } } } as never,
		async execute(_id, params, _signal, _onUpdate, ctx) {
			if (!registry || registry.sessionId !== ctx.sessionManager.getSessionId()) throw new Error("No active session worktree registry.");
			const root = registry.register((params as { path: string }).path, "explicit");
			await refreshChanges(ctx);
			return { content: [{ type: "text", text: `Registered session worktree: ${root}` }], details: { root, sessionId: registry.sessionId } };
		},
	});
	pi.on("session_start", async (_event, ctx) => {
		registry?.close();
		currentContext = ctx;
		changes = undefined;
		registry = new SessionWorktreeRegistry(pi, ctx.sessionManager, ctx.cwd, deps.resolveWorktree);
		registry.start();
		if (!ctx.hasUI) return;
		changes = new SessionChanges(ctx.sessionManager.getSessionId(), ctx.sessionManager.getEntries());
		const tracker = changes;
		ctx.ui.setFooter((tui, theme, footerData) => {
			renderHost = { requestRender: () => tui.requestRender(), invalidateSidebar: () => invalidateSidebar(tui) };
			const bottom = createShellBarComponent(pi, ctx, renderHost, theme, footerData, () => tracker.model.files.length, () => usage.get(ctx.model?.provider ?? ""));
			// 状态卡片绘制的是没有任何事件会为之重新注册部件的实时会话
			// 状态：模型、思考力度、上下文、成本、会话名称与扩展
			// 状态。摘要是让全屏备忘保持忠实的关键，它
			// 每帧都像底部窄栏一样精确重建模型。
			const footerModel = () => buildShellBarModel(pi, ctx, footerData, { dirty: tracker.model.files.length, usage: usage.get(ctx.model?.provider ?? ""), profile: deps.activeProfile() });
			const part = sidebarPart(tui, "footer", bottom, {
				digest: () => JSON.stringify(footerModel()),
				render: (width) => renderShellSidebarBar(footerModel(), theme, width),
				invalidate() {},
			});
			const uninstall = installSidebar(tui, theme);
			return { ...part, dispose() { uninstall(); part.dispose(); } };
		});
		void refreshUsage(ctx, true);
		installPrompt(ctx, (created) => {
			prompt = created;
		});
		// 花瓣已表明代理正在工作；pi 自带的 "Working" 行会把它说两遍。
		ctx.ui.setWorkingVisible(false);
		const notice = deps.devBinary();
		ctx.ui.setWidget(
			DEV_BINARY_WIDGET_KEY,
			notice
				? (_tui, theme) => spaced(cardComponent(devBinaryCard(notice), theme, { expanded: true }))
				: undefined,
		);
		if (changes !== tracker) return;
		shown = "";
		applyChanges(ctx, tracker.model);
	});
	pi.on("session_shutdown", (event) => {
		registry?.close();
		registry = undefined;
		changes = undefined;
		currentContext = undefined;
		// SESSION_CHANGE_EVENT 订阅是 setup 期的一次性注册：pi 在 /new、
		// /resume、/fork 复用扩展实例且不重跑 setup，会话替换不得退订，
		// 否则子代理变更中继在此后永久失效。
		const reason = (event as { reason?: unknown }).reason;
		if (reason !== "new" && reason !== "resume" && reason !== "fork") unsubscribeWorktrees();
	});
	const openChanges = async (ctx: ExtensionContext) => {
		if (!changes) return;
		const tracker = changes;
		const model = await tracker.refresh();
		if (model.files.length === 0) {
			ctx.ui.notify("No captured agent changes. Only successful write/edit operations from this session and its subagents are shown; shell changes are not attributed.", "info");
			return;
		}
		await showChangesOverlay(ctx, { loadDiff: (root, file) => tracker.loadDiff(root, file), worktrees: () => tracker.worktrees, refresh: () => tracker.refresh(), apply: applyChanges, pollMs: changesPollMs(env) });
	};
	pi.registerCommand(CHANGES_COMMAND_NAME, {
		description: "Browse captured write/edit changes from this agent session and its subagents, excluding preexisting and external edits. Shell changes are not attributed. Press o to open $EDITOR.",
		handler: async (_args, ctx) => openChanges(ctx),
	});
	const shortcut = changesShortcut(env);
	if (shortcut) {
		pi.registerShortcut(shortcut as Parameters<ExtensionAPI["registerShortcut"]>[0], {
			description: "Open captured agent session changes",
			handler: async (ctx) => openChanges(ctx),
		});
	}
	pi.on("agent_start", (_event, ctx) => {
		prompt?.setWorking(true);
		// 开发版二进制卡片是启动通知：随第一条提示一起离场。
		if (ctx.hasUI) ctx.ui.setWidget(DEV_BINARY_WIDGET_KEY, undefined);
	});
	pi.on("agent_end", async (_event, ctx) => {
		prompt?.setWorking(false);
		await refreshChanges(ctx);
		void refreshUsage(ctx, false);
	});
}
