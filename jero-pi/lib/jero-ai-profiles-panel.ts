// 档案面板 TUI：/jero:profiles 的全屏交互面板（ProfilesPanel）与档案动作执行。
// 自 extensions/jero-ai.ts 拆分（机械平移，语义零改动）。

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { Key, isKeyRelease, matchesKey, truncateToWidth, type KeybindingsManager, type TuiMouseEvent, type TuiMouseEventResult } from "@earendil-works/pi-tui";
import { normalizeModelConfig, type AgentModelConfig } from "./model-routing-authority.ts";
import { bootstrapProfilesFile, buildProfileListItems, createProfile, deleteProfile, duplicateProfile, formatOrchestratorSelection, formatRoutingRow, parseProfileExportTextWithDrops, PROFILE_ORCHESTRATOR_KEY, profileExportPath, profileRoutingRows, profilesFilePath, readProfileOrchestrator, readProfilesFileResult, renameProfile, routingColumnWidths, serializeProfileExport, setActiveProfile, updateProfile, writeProfilesFileSync, type AgentProfilesFile, type ProfileListItem, type ProfileRoutingRow, type ProfilesParseDrops } from "./agent-profiles.ts";
import { applyOrchestratorSettings, readOrchestratorSettings, restoreOrchestratorSettings, type OrchestratorSettingsReadResult } from "./profiles-orchestrator.ts";
import { measureAgentsViewLayout, type AgentsViewLayout } from "./agents-view-layout.ts";
import { NativeChoiceList } from "./native-choice-list.ts";
import { createNativeFullscreenInteraction } from "./native-fullscreen-interaction.ts";
import { sanitizeTerminalText, stripAnsi } from "./terminal-theme.ts";

import { cloneModelConfig, orchestratorSettingsPath, readEffectiveModelConfig, readEffectiveModelConfigAsync, withOmittedAgentsClearedAsync, writeModelConfigAsync } from "./jero-ai-model-config.ts";
import { OverlayComponent, PANEL_TONE_COLOR, PanelTone } from "./jero-ai-model-panel.ts";
import { applyModelConfigAsync } from "./jero-ai-model-routing-apply.ts";
import { gentleAiConfigHome, modelConfigPath } from "./jero-ai-persona-config.ts";


type ProfilesPanelResult =
	| { type: "apply"; name: string }
	| { type: "create" }
	| { type: "update"; name: string }
	| { type: "duplicate"; name: string }
	| { type: "rename"; name: string }
	| { type: "delete"; name: string }
	| { type: "export"; name: string }
	| { type: "import" }
	| { type: "close" };



type ProfilesSnapshotHandler = (name: string) => AgentProfilesFile;



const PROFILES_PANEL_MIN_BODY_ROWS = 6;



type ProfilesPanelPointerLayout = AgentsViewLayout & { listTop: number };



function hasOwnProfile(profiles: Record<string, unknown>, name: string): boolean {
	return Object.prototype.hasOwnProperty.call(profiles, name);
}



function profilesErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/** 将详情面板的滚动偏移限制在其自身内容的边界之内。 */


/** 将详情面板的滚动偏移限制在其自身内容的边界之内。 */
function clampDetailScroll(offset: number, lineCount: number, bodyRows: number): number {
	return Math.max(0, Math.min(offset, Math.max(0, lineCount - bodyRows)));
}

// 左侧 profile 列表，右侧详情面板。渲染与指针路由共享
// 同一份测量布局；列表行通过 NativeChoiceList 保留原生键盘、悬停、
// 按下、点击与滚轮处理。外框占满整个
// overlay，因此其高度与 AgentsView 一样跟随终端行数。


// 左侧 profile 列表，右侧详情面板。渲染与指针路由共享
// 同一份测量布局；列表行通过 NativeChoiceList 保留原生键盘、悬停、
// 按下、点击与滚轮处理。外框占满整个
// overlay，因此其高度与 AgentsView 一样跟随终端行数。
class ProfilesPanel implements OverlayComponent {
	private completed = false;
	private pointerLayout: ProfilesPanelPointerLayout | undefined;
	private detailScroll = 0;
	private lastDetailLineCount = 0;
	private lastDetailRows = 0;
	private lastSelectedId: string | undefined;
	private feedback: string | undefined;
	readonly list: NativeChoiceList<ProfileListItem>;
	private file: AgentProfilesFile;
	private readonly currentConfig: AgentModelConfig;
	private readonly done: (result: ProfilesPanelResult) => void;
	private readonly saveSnapshot: ProfilesSnapshotHandler;
	private readonly requestRender: () => void;
	private readonly listItems: ProfileListItem[];
	private readonly theme: Theme | undefined;
	private readonly rows: () => number;
	private readonly orchestratorSettings: OrchestratorSettingsReadResult;

	constructor(
		file: AgentProfilesFile,
		currentConfig: AgentModelConfig,
		done: (result: ProfilesPanelResult) => void,
		keybindings: KeybindingsManager | undefined,
		theme: Theme | undefined,
		selectedName: string | undefined,
		rows: () => number,
		orchestratorSettings: OrchestratorSettingsReadResult,
		saveSnapshot: ProfilesSnapshotHandler,
		requestRender: () => void,
	) {
		this.file = file;
		this.currentConfig = currentConfig;
		this.done = done;
		this.saveSnapshot = saveSnapshot;
		this.requestRender = requestRender;
		this.theme = theme;
		this.rows = rows;
		this.orchestratorSettings = orchestratorSettings;
		const items = buildProfileListItems(file);
		this.listItems = items;
		this.list = new NativeChoiceList<ProfileListItem>(
			items,
			{
				selectedPrefix: (text) => this.renderText(text, "accent"),
				selectedText: (text) => this.renderText(text, "accent"),
				description: (text) => this.renderText(text, "muted"),
				hoverBackground: (text) => (this.theme ? this.theme.bg("toolPendingBg", text) : text),
			},
			keybindings,
		);
		this.list.onSelect = (item) => this.finish({ type: "apply", name: item.id });
		this.list.onCancel = () => this.finish({ type: "close" });
		const selected = selectedName ? items.findIndex((item) => item.id === selectedName) : -1;
		if (selected >= 0) this.list.setSelectedIndex(selected);
	}

	invalidate(): void {
		this.pointerLayout = undefined;
		this.list.invalidate();
	}

	handleInput(data: string): void {
		if (isKeyRelease(data)) return;
		if (matchesKey(data, "ctrl+c") || matchesKey(data, "escape")) {
			this.finish({ type: "close" });
			return;
		}
		const name = this.list.getSelectedItem()?.id;
		if (matchesKey(data, Key.pageDown) || matchesKey(data, Key.ctrl("j"))) {
			this.scrollDetail(this.pageRows());
			return;
		}
		if (matchesKey(data, Key.pageUp) || matchesKey(data, Key.ctrl("k"))) {
			this.scrollDetail(-this.pageRows());
			return;
		}
		// Agents 式逐行滚动：j/k 每次移动一行路由详情。
		// 方向键仍归属 profile 列表，正如下方的字母键
		// 仍归属 profile 操作。
		if (data === "j") {
			this.scrollDetail(1);
			return;
		}
		if (data === "k") {
			this.scrollDetail(-1);
			return;
		}
		if (data === "c") return this.finish({ type: "create" });
		if (data === "i") return this.finish({ type: "import" });
		if (!name) return this.list.handleInput(data);
		if (data === "s") {
			try {
				this.file = this.saveSnapshot(name);
				this.refreshListItems();
				this.feedback = `Snapshot saved; live routing unchanged. Profile "${name}" saved from current routing.`;
			} catch (error) {
				this.feedback = `Snapshot failed; live routing unchanged. Profile "${name}" was not saved from current routing: ${profilesErrorMessage(error)}`;
			}
			this.requestRender();
			return;
		}
		if (data === "d") return this.finish({ type: "duplicate", name });
		if (data === "r") return this.finish({ type: "rename", name });
		if (data === "x") return this.finish({ type: "delete", name });
		if (data === "e") return this.finish({ type: "export", name });
		this.list.handleInput(data);
	}

	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		const layout = this.pointerLayout;
		if (!layout) return undefined;
		const inBody = event.y >= layout.listTop && event.y < layout.listTop + layout.bodyRows;
		if (
			inBody &&
			event.type === "wheel" &&
			event.wheelDelta &&
			layout.mode === "panes" &&
			event.x >= layout.threadX &&
			event.x < layout.threadX + layout.threadWidth
		) {
			this.scrollDetail(event.wheelDelta);
			return { handled: true, render: true };
		}
		if (!inBody) return undefined;
		if (event.x < layout.listX || event.x >= layout.listX + layout.listWidth) return undefined;
		return this.list.handleMouse({
			...event,
			x: event.x - layout.listX,
			y: event.y - layout.listTop,
			width: layout.listWidth,
			height: layout.bodyRows,
		});
	}

	render(width: number): string[] {
		const safeWidth = Math.max(1, width);
		const listWidth = measureAgentsViewLayout(safeWidth, PROFILES_PANEL_MIN_BODY_ROWS + 3).listWidth;
		const listLines = this.list.render(listWidth);
		// 外框填满 overlay，而 overlay 填满终端，因此
		// 主体高度取决于终端行数而非内容本身。
		const rows = Math.max(PROFILES_PANEL_MIN_BODY_ROWS + 3, Math.floor(this.rows()));
		const layout = measureAgentsViewLayout(safeWidth, rows);
		if (layout.mode === "fallback" || layout.width === 0) {
			this.pointerLayout = undefined;
			return [];
		}
		const selectedId = this.list.getSelectedItem()?.id;
		if (selectedId !== this.lastSelectedId) {
			this.lastSelectedId = selectedId;
			this.detailScroll = 0;
		}
		const detailLines = this.renderDetailLines(layout.threadWidth, layout.mode === "panes");
		this.lastDetailLineCount = detailLines.length;
		this.lastDetailRows = layout.bodyRows;
		this.detailScroll = clampDetailScroll(this.detailScroll, detailLines.length, layout.bodyRows);
		this.pointerLayout = { ...layout, listTop: 1 };
		const rule = "─".repeat(Math.max(0, layout.width - 2));
		const lines: string[] = [this.renderText(`╭${rule}╮`, "border")];
		for (let row = 0; row < layout.bodyRows; row += 1) {
			lines.push(this.renderBodyRow(row, layout, listLines, detailLines));
		}
		lines.push(this.renderFooterRow(layout.width));
		lines.push(this.renderText(`╰${rule}╯`, "border"));
		return lines;
	}

	private scrollDetail(delta: number): void {
		this.detailScroll = clampDetailScroll(
			this.detailScroll + Math.trunc(delta),
			this.lastDetailLineCount,
			this.lastDetailRows,
		);
	}

	private refreshListItems(): void {
		// 在刷新 NativeChoiceList 已按引用持有的可变 item 记录时，
		// 保持列表实例（及其指针观察者）存活。
		for (const item of buildProfileListItems(this.file)) {
			const current = this.listItems.find((candidate) => candidate.id === item.id);
			if (current) Object.assign(current, item);
		}
		this.list.refreshItems();
	}

	private pageRows(): number {
		return Math.max(1, this.lastDetailRows - 1);
	}

	private finish(result: ProfilesPanelResult): void {
		if (this.completed) return;
		this.completed = true;
		this.list.setDisabled(true);
		this.done(result);
	}

	private renderBodyRow(
		row: number,
		layout: AgentsViewLayout,
		listLines: string[],
		detailLines: string[],
	): string {
		if (layout.mode === "panes") {
			return [
				this.renderText("│", "border"),
				" ",
				this.fitPaneLine(listLines[row] ?? "", layout.listWidth),
				" ",
				this.renderText("│", "border"),
				" ",
				this.fitPaneLine(detailLines[this.detailScroll + row] ?? "", layout.threadWidth),
				this.renderText("│", "border"),
			].join("");
		}
		return [
			this.renderText("│", "border"),
			" ",
			this.fitPaneLine(listLines[row] ?? "", layout.listWidth),
			" ",
			this.renderText("│", "border"),
		].join("");
	}

	private renderFooterRow(width: number): string {
		const hints =
			"enter apply · c create · s snapshot · d duplicate · r rename · x delete · e export · i import · j/k line · ctrl+j/k page · esc close";
		const text = this.feedback ?? hints;
		return [
			this.renderText("│", "border"),
			" ",
			this.fitPaneLine(this.renderText(text, this.feedback ? "status" : "muted"), width - 4),
			" ",
			this.renderText("│", "border"),
		].join("");
	}

	private renderDetailLines(width: number, showDetail: boolean): string[] {
		if (!showDetail) return [];
		const name = this.list.getSelectedItem()?.id;
		if (!name || !hasOwnProfile(this.file.profiles, name)) {
			return [this.renderLine("No profile selected.", width, "muted")];
		}
		const config = this.file.profiles[name];
		const profileRows = profileRoutingRows(config);
		const currentRows = profileRoutingRows(this.currentConfig);
		// 两张表共享同一次列宽测量，这样同一个代理无论来自
		// profile 还是 models.json，都落在同一列。
		const widths = routingColumnWidths(profileRows, currentRows);
		return [
			this.renderLine(name === this.file.active ? `${name} (active)` : name, width, "title"),
			this.renderLine(
				`orchestrator  ${formatOrchestratorSelection(readProfileOrchestrator(config))}`,
				width,
				"text",
			),
			this.renderLine(`now           ${this.effectiveOrchestratorLabel()}`, width, "muted"),
			"",
			this.renderLine("Profile routing", width, "accent"),
			...this.indentLines(this.routingLines(profileRows, widths), width),
			"",
			this.renderLine("Current routing (effective)", width, "accent"),
			...this.indentLines(this.routingLines(currentRows, widths), width),
		];
	}

	private effectiveOrchestratorLabel(): string {
		const settings = this.orchestratorSettings;
		if (settings.status === "invalid") {
			return `unreadable (${sanitizeTerminalText(settings.reason)})`;
		}
		return formatOrchestratorSelection(settings.status === "valid" ? settings.entry : undefined);
	}

	private routingLines(
		rows: ProfileRoutingRow[],
		widths: { agent: number; model: number },
	): string[] {
		if (rows.length === 0) {
			return ["No routing entries — every agent inherits its default model."];
		}
		return rows.map((row) => formatRoutingRow(row, widths));
	}

	private indentLines(lines: string[], width: number): string[] {
		return lines.map((line) => this.renderLine(`  ${line}`, width, "text"));
	}

	private fitPaneLine(line: string, width: number): string {
		const visible = stripAnsi(line);
		if (visible.length > width) {
			return truncateToWidth(visible, Math.max(1, width), "…", true);
		}
		return `${line}${" ".repeat(Math.max(0, width - visible.length))}`;
	}

	private renderLine(text: string, width: number, tone?: PanelTone): string {
		const safe = truncateToWidth(
			sanitizeTerminalText(text),
			Math.max(1, width),
			"…",
			true,
		);
		return tone ? this.renderText(safe, tone) : safe;
	}

	private renderText(text: string, tone: PanelTone): string {
		const safe = sanitizeTerminalText(text);
		if (!this.theme) return safe;
		return this.theme.fg(PANEL_TONE_COLOR[tone], safe);
	}
}



async function showProfilesPanel(
	ctx: ExtensionContext,
	file: AgentProfilesFile,
	currentConfig: AgentModelConfig,
	selectedName: string | undefined,
	saveSnapshot: ProfilesSnapshotHandler,
): Promise<ProfilesPanelResult> {
	// 面板生命周期内只读取一次。显示为 "now" 的编排器是
	// 面板打开时的状态，而不是面板中途会变化的值。
	const orchestratorSettings = readOrchestratorSettings(orchestratorSettingsPath());
	return ctx.ui.custom<ProfilesPanelResult>(
		(tui, theme, keybindings, done) => {
			const panel = new ProfilesPanel(
				file,
				currentConfig,
				done,
				keybindings,
				theme,
				selectedName,
				() => Math.max(0, tui.terminal.rows),
				orchestratorSettings,
				saveSnapshot,
				() => tui.requestRender(),
			);
			const container = createNativeFullscreenInteraction({
				keyboardTarget: panel,
				requestRender: () => tui.requestRender(),
				mouseObserver: panel.list.createMouseObserver(() => tui.requestRender()),
			});
			container.addChild(panel);
			return container;
		},
		{
			overlay: true,
			overlayOptions: {
				anchor: "center",
				width: "100%",
				maxHeight: "100%",
				margin: 0,
			},
		},
	);
}



function reportProfilesDrops(ctx: ExtensionContext, path: string, drops: ProfilesParseDrops): void {
	// 被丢弃的名字按定义就是校验失败的那些，因此它们是
	// 到达终端的不可信输入，必须像任何其他
	// 外部提供的文本一样做清洗。
	const parts: string[] = [];
	if (drops.droppedProfiles.length > 0) {
		parts.push(`profile：${drops.droppedProfiles.map((name) => sanitizeTerminalText(name)).join(", ")}`);
	}
	if (drops.droppedAgents.length > 0) {
		parts.push(
			`路由条目：${drops.droppedAgents.map(({ profile, agent }) => `${sanitizeTerminalText(profile)}/${sanitizeTerminalText(agent)}`).join(", ")}`,
		);
	}
	if (drops.droppedActive !== undefined) {
		parts.push(`active 标记：${sanitizeTerminalText(drops.droppedActive)}`);
	}
	if (parts.length > 0) {
		ctx.ui.notify(
			`el Jero 在加载 ${sanitizeTerminalText(path)} 时丢弃了无效条目 —— ${parts.join("；")}。`,
			"warning",
		);
	}
}



function profileSnapshotFrom(
	current: AgentModelConfig,
	settings: OrchestratorSettingsReadResult,
): AgentModelConfig {
	const snapshot = cloneModelConfig(current);
	if (settings.status === "valid" && settings.entry !== undefined) {
		snapshot[PROFILE_ORCHESTRATOR_KEY] = { ...settings.entry };
	}
	return snapshot;
}



async function runProfilesPanelAction(
	ctx: ExtensionContext,
	path: string,
	file: AgentProfilesFile,
	result: Exclude<ProfilesPanelResult, { type: "close" }>,
): Promise<AgentProfilesFile> {
	switch (result.type) {
		case "apply": {
			if (!hasOwnProfile(file.profiles, result.name)) return file;
			const normalized = normalizeModelConfig(file.profiles[result.name]) ?? {};
			const orchestratorEntry = readProfileOrchestrator(normalized);
			// 应用横跨三个文件——存储、models.json 与 Pi 的全局
			// settings.json——且不存在跨文件改名，所以按让存储
			// 保持真实、失败时补偿的顺序写入：先在存储中认领
			// profile，再物化路由，最后是编排器。认领失败
			// 则路由原封不动；认领之后的任何失败都会恢复
			// 之前的认领，且在已知先前活跃 profile 时，
			// 恢复该 profile 所隐含的路由。
			const claimed = setActiveProfile(file, result.name);
			try {
				writeProfilesFileSync(path, claimed);
			} catch (error) {
				ctx.ui.notify(
					`el Jero 无法更新 ${sanitizeTerminalText(path)}：${profilesErrorMessage(error)}`,
					"warning",
				);
				return file;
			}
			const previousActiveConfig =
				file.active !== undefined && hasOwnProfile(file.profiles, file.active)
					? normalizeModelConfig(file.profiles[file.active]) ?? {}
					: undefined;
			// 仅在编排器写入成功后设置，让回退逻辑知道有东西
			// 需要撤销。使用回滚闭包（而非先前的字节值）是因为
			// “该文件此前不存在”是一种真实状态，必须通过删除
			// 文件来恢复，而 `undefined` 字节无法承载这一区别。
			let orchestratorRollback: (() => void) | undefined;
			const revertClaim = async (routingWritten: boolean): Promise<AgentProfilesFile> => {
				let restored = previousActiveConfig === undefined ? "" : "路由";
				if (routingWritten && previousActiveConfig !== undefined) {
					try {
						await writeModelConfigAsync(ctx.cwd, previousActiveConfig);
						// 以相同的替换语义再次物化先前的
						// profile，让失败 profile 的路由不会
						// 残留在 subagents.json 或代理 frontmatter 中。
						await applyModelConfigAsync(
							ctx.cwd,
							await withOmittedAgentsClearedAsync(ctx.cwd, previousActiveConfig),
						);
					} catch {
						restored = "";
					}
				}
				if (orchestratorRollback) {
					try {
						orchestratorRollback();
						restored = restored === "" ? "settings" : `${restored}与 settings`;
					} catch {
						restored = restored === "" ? "" : restored;
					}
				}
				try {
					writeProfilesFileSync(path, file);
					restored = restored === "" ? "active 标记" : `${restored}与 active 标记`;
				} catch {
					restored = restored === "" ? "无" : restored;
				}
				const unresolved =
					routingWritten && previousActiveConfig === undefined
						? ` ${sanitizeTerminalText(modelConfigPath(ctx.cwd))} 仍保留该 profile 的路由，因为没有记录先前活跃的 profile 可供恢复。`
						: "";
				ctx.ui.notify(
					`el Jero 无法应用 profile "${result.name}"。已恢复：${restored}。${unresolved}`,
					"warning",
				);
				return file;
			};
			try {
				await writeModelConfigAsync(ctx.cwd, normalized);
			} catch (error) {
				ctx.ui.notify(
					`el Jero 无法写入 ${sanitizeTerminalText(modelConfigPath(ctx.cwd))}：${profilesErrorMessage(error)}`,
					"warning",
				);
				return revertClaim(false);
			}
			// models.json 保存 profile 原样写入的内容；用清空条目
			// 补齐只是为了驱动物化，这样 profile 未提及的代理
			// 回到 inherit，而不是保留先前物化的路由。
			let applyResult: { updated: number; skipped: number };
			try {
				applyResult = await applyModelConfigAsync(
					ctx.cwd,
					await withOmittedAgentsClearedAsync(ctx.cwd, normalized),
				);
			} catch (error) {
				ctx.ui.notify(
					`el Jero 无法物化 profile "${result.name}"：${profilesErrorMessage(error)}`,
					"warning",
				);
				return revertClaim(true);
			}
			let orchestratorNote = "";
			if (orchestratorEntry !== undefined) {
				const settingsPath = orchestratorSettingsPath();
				const written = applyOrchestratorSettings(settingsPath, orchestratorEntry);
				if (written.status === "invalid") {
					ctx.ui.notify(
						`el Jero 无法根据 profile "${result.name}" 设置编排器：${sanitizeTerminalText(written.reason)}。${sanitizeTerminalText(settingsPath)} 保持不变。`,
						"warning",
					);
					return revertClaim(true);
				}
				if (written.status === "written") {
					const previous = written.previous;
					orchestratorRollback = () => restoreOrchestratorSettings(settingsPath, previous);
					orchestratorNote = `\n已在 ${sanitizeTerminalText(settingsPath)} 中将编排器设为 ${formatOrchestratorSelection(orchestratorEntry)}。`;
				}
			}
			ctx.ui.notify(
				[
					`el Jero 已应用 profile "${result.name}" —— 更新了 ${applyResult.updated} 个代理。`,
					"新路由将在下一次子代理启动时生效。",
				].join("\n") + orchestratorNote,
				"info",
			);
			return claimed;
		}
		case "create": {
			const name = await ctx.ui.input("New profile name", "e.g. deep-work");
			if (name === undefined) return file;
			try {
				const next = createProfile(file, name.trim(), {});
				writeProfilesFileSync(path, next);
				return next;
			} catch (error) {
				ctx.ui.notify(`未能创建 profile：${profilesErrorMessage(error)}`, "warning");
				return file;
			}
		}
		case "update": {
			// profile 是完整快照，因此捕获当前路由的同时也
			// 捕获了路由运行所处的编排器。无法读取的 settings 文件
			// 会让快照不含编排器条目，
			// 而不是凭空编造一个。
			const snapshot = profileSnapshotFrom(
				await readEffectiveModelConfigAsync(ctx.cwd),
				readOrchestratorSettings(orchestratorSettingsPath()),
			);
			try {
				const next = updateProfile(file, result.name, snapshot);
				writeProfilesFileSync(path, next);
				ctx.ui.notify(
					`el Jero 已根据 ${modelConfigPath(ctx.cwd)} 中的当前路由更新 profile "${result.name}"。`,
					"info",
				);
				return next;
			} catch (error) {
				ctx.ui.notify(`未能更新 profile：${profilesErrorMessage(error)}`, "warning");
				return file;
			}
		}
		case "duplicate": {
			const name = await ctx.ui.input(`Duplicate profile "${result.name}" as`, `${result.name}-copy`);
			if (name === undefined) return file;
			try {
				const next = duplicateProfile(file, result.name, name.trim());
				writeProfilesFileSync(path, next);
				return next;
			} catch (error) {
				ctx.ui.notify(`未能复制 profile：${profilesErrorMessage(error)}`, "warning");
				return file;
			}
		}
		case "rename": {
			const name = await ctx.ui.input(`Rename profile "${result.name}" to`, result.name);
			if (name === undefined) return file;
			try {
				const next = renameProfile(file, result.name, name.trim());
				writeProfilesFileSync(path, next);
				return next;
			} catch (error) {
				ctx.ui.notify(`未能重命名 profile：${profilesErrorMessage(error)}`, "warning");
				return file;
			}
		}
		case "delete": {
			const approved = await ctx.ui.confirm(
				"Delete profile?",
				`Delete profile "${result.name}" from ${path}? The routing in ${modelConfigPath(ctx.cwd)} is not changed.`,
			);
			if (!approved) return file;
			try {
				const next = deleteProfile(file, result.name);
				writeProfilesFileSync(path, next);
				return next;
			} catch (error) {
				ctx.ui.notify(`未能删除 profile：${profilesErrorMessage(error)}`, "warning");
				return file;
			}
		}
		case "export": {
			if (!hasOwnProfile(file.profiles, result.name)) return file;
			const exportPath = profileExportPath(gentleAiConfigHome());
			try {
				const text = serializeProfileExport(result.name, file.profiles[result.name]);
				await mkdir(dirname(exportPath), { recursive: true });
				await writeFile(exportPath, text);
				ctx.ui.notify(`el Jero 已将 profile "${result.name}" 导出到 ${exportPath}。`, "info");
			} catch (error) {
				ctx.ui.notify(`profile 导出失败：${profilesErrorMessage(error)}`, "warning");
			}
			return file;
		}
		case "import": {
			const importPath = profileExportPath(gentleAiConfigHome());
			let text: string;
			try {
				text = await readFile(importPath, "utf8");
			} catch {
				ctx.ui.notify(`profile 导入失败：${importPath} 缺失或无法读取。`, "warning");
				return file;
			}
			const parsed = parseProfileExportTextWithDrops(text);
			if (!parsed) {
				ctx.ui.notify(
					`profile 导入失败：${importPath} 不是合法的代理模型 profile 导出文件。`,
					"warning",
				);
				return file;
			}
			if (parsed.droppedAgents.length > 0) {
				ctx.ui.notify(
					`el Jero 在导入 profile "${parsed.name}" 时丢弃了无效路由条目：${parsed.droppedAgents.join(", ")}。`,
					"warning",
				);
			}
			if (hasOwnProfile(file.profiles, parsed.name)) {
				const approved = await ctx.ui.confirm(
					"Replace existing profile?",
					`Profile "${parsed.name}" already exists in ${path}. Replace its routing with the import?`,
				);
				if (!approved) return file;
			}
			try {
				const next = hasOwnProfile(file.profiles, parsed.name)
					? updateProfile(file, parsed.name, parsed.config)
					: createProfile(file, parsed.name, parsed.config);
				writeProfilesFileSync(path, next);
				const entries = Object.keys(parsed.config).length;
				ctx.ui.notify(
					`el Jero 已从 ${importPath} 导入 profile "${parsed.name}"（${entries} 条路由）。`,
					"info",
				);
				return next;
			} catch (error) {
				ctx.ui.notify(`profile 导入失败：${profilesErrorMessage(error)}`, "warning");
				return file;
			}
		}
	}
}



export async function handleProfilesCommand(ctx: ExtensionContext): Promise<void> {
	const path = profilesFilePath(gentleAiConfigHome());
	const read = readProfilesFileResult(path);
	if (read.status === "invalid") {
		ctx.ui.notify(
			`el Jero 无法打开代理 profiles：${path} 不是合法的 JSON 或不是 profiles 文件。请修复或删除该文件，然后重新运行 /jero:profiles。`,
			"warning",
		);
		return;
	}
	let file: AgentProfilesFile;
	if (read.status === "missing") {
		file = bootstrapProfilesFile(await readEffectiveModelConfigAsync(ctx.cwd));
		try {
			writeProfilesFileSync(path, file);
		} catch (error) {
			ctx.ui.notify(
				`el Jero 无法创建 ${path}：${profilesErrorMessage(error)}`,
				"warning",
			);
			return;
		}
		ctx.ui.notify(`el Jero 已根据当前生效的路由在 ${path} 中播种 "current" profile。`, "info");
	} else {
		file = read.file;
		reportProfilesDrops(ctx, path, read.drops);
	}
	const saveSnapshot: ProfilesSnapshotHandler = (name) => {
		const next = updateProfile(
			file,
			name,
			profileSnapshotFrom(
				readEffectiveModelConfig(ctx.cwd),
				readOrchestratorSettings(orchestratorSettingsPath()),
			),
		);
		writeProfilesFileSync(path, next);
		file = next;
		return next;
	};
	let selectedName: string | undefined;
	let result = await showProfilesPanel(
		ctx,
		file,
		await readEffectiveModelConfigAsync(ctx.cwd),
		selectedName,
		saveSnapshot,
	);
	while (result.type !== "close") {
		selectedName = "name" in result ? result.name : undefined;
		file = await runProfilesPanelAction(ctx, path, file, result);
		result = await showProfilesPanel(
			ctx,
			file,
			await readEffectiveModelConfigAsync(ctx.cwd),
			selectedName,
			saveSnapshot,
		);
	}
}

