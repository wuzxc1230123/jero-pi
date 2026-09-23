// 模型面板 TUI：/jero:models 的全屏交互面板（SddModelPanel）。
// 自 extensions/jero-ai.ts 拆分（机械平移，语义零改动）。

import { join } from "node:path";
import type { ExtensionContext, Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import { matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import { normalizeModelId, readSavedModelConfigAsync as readModelRoutingAuthorityAsync, type AgentModelConfig, type ThinkingLevel } from "./model-routing-authority.ts";
import { sanitizeTerminalText, stripAnsi } from "./terminal-theme.ts";

import { cloneModelConfig, exportSavedModelConfig, readModelExport, writeModelConfig, writeModelConfigAsync } from "./jero-ai-model-config.ts";
import { applyModelConfigAsync, describeModelConfig, isProviderReviewRole, migrateLegacyProjectModelOverrides, modelAssignmentNames, routingDefaultLabel } from "./jero-ai-model-routing-apply.ts";
import { legacyProjectModelConfigPath, modelConfigPath, modelExportPath } from "./jero-ai-persona-config.ts";
import { AGENT_LIST_MAX_VISIBLE_ROWS, CUSTOM_MODEL, INHERIT_MODEL, INHERIT_THINKING, KEEP_CURRENT, MODEL_CONTROL_OPTIONS, MODEL_LIST_MAX_VISIBLE_ROWS, THINKING_OPTIONS } from "./jero-ai-sdd-startup.ts";


async function getPiModelOptions(ctx: ExtensionContext): Promise<string[]> {
	const models = await ctx.modelRegistry.getAvailable();
	const modelIds = models
		.map((model) => normalizeModelId(`${model.provider}/${model.id}`))
		.filter((model): model is string => model !== undefined)
		.sort((left, right) => left.localeCompare(right));
	return [...MODEL_CONTROL_OPTIONS, ...modelIds];
}



export interface OverlayComponent {
	render(width: number): string[];
	handleInput(data: string): void;
	invalidate(): void;
}



type ModelPanelResult =
	| { type: "save"; config: AgentModelConfig }
	| { type: "custom"; agent: string | "all"; config: AgentModelConfig }
	| { type: "export"; config: AgentModelConfig }
	| { type: "restore"; config: AgentModelConfig }
	| { type: "cancel" };



const SET_ALL_AGENTS = "Set all agents";



const PANEL_TONE = {
	BORDER: "border",
	MUTED: "muted",
	TEXT: "text",
	TITLE: "title",
	ACCENT: "accent",
	STATUS: "status",
} as const;



export type PanelTone = (typeof PANEL_TONE)[keyof typeof PANEL_TONE];



export const PANEL_TONE_COLOR: Record<PanelTone, ThemeColor> = {
	border: "border",
	muted: "muted",
	text: "text",
	title: "accent",
	accent: "accent",
	status: "thinkingHigh",
};



class SddModelPanel implements OverlayComponent {
	private cursor = 0;
	private mode: "agents" | "models" | "effort" = "agents";
	private selectedRow = SET_ALL_AGENTS;
	private modelCursor = 0;
	private effortCursor = 0;
	private query = "";
	private readonly draft: AgentModelConfig;
	private readonly rows: string[];
	private readonly modelOptions: string[];
	private readonly done: (result: ModelPanelResult) => void;
	private readonly theme: Theme | undefined;

	constructor(
		initialConfig: AgentModelConfig,
		modelOptions: string[],
		agents: string[],
		done: (result: ModelPanelResult) => void,
		theme?: Theme,
	) {
		this.draft = cloneModelConfig(initialConfig);
		this.rows = [SET_ALL_AGENTS, ...agents];
		this.modelOptions = modelOptions;
		this.done = done;
		this.theme = theme;
	}

	invalidate(): void {}

	handleInput(data: string): void {
		if (this.mode === "models") {
			this.handleModelInput(data);
			return;
		}
		if (this.mode === "effort") {
			this.handleEffortInput(data);
			return;
		}
		this.handleAgentInput(data);
	}

	render(width: number): string[] {
		const innerWidth = Math.max(1, width - 4);
		const lines =
			this.mode === "models"
				? this.renderModelPicker(innerWidth)
				: this.mode === "effort"
					? this.renderEffortPicker(innerWidth)
					: this.renderAgentList(innerWidth);
		return this.renderCard(lines, width);
	}

	private renderCard(lines: string[], width: number): string[] {
		const innerWidth = Math.max(1, width - 4);
		const horizontal = "─".repeat(innerWidth + 2);
		const border = (text: string) => this.renderText(text, "border");
		return [
			border(`╭${horizontal}╮`),
			...lines.map(
				(line) =>
					`${border("│")} ${this.fitStyledLine(line, innerWidth)} ${border("│")}`,
			),
			border(`╰${horizontal}╯`),
		];
	}

	private fitStyledLine(line: string, width: number): string {
		const visible = stripAnsi(line);
		if (visible.length > width) {
			return truncateToWidth(visible, Math.max(1, width), "…", true);
		}
		return `${line}${" ".repeat(Math.max(0, width - visible.length))}`;
	}

	private renderLine(text = "", width: number, tone?: PanelTone): string {
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

	private renderCursor(focused: boolean): string {
		return focused ? this.renderText("▸", "accent") : " ";
	}

	private handleAgentInput(data: string): void {
		const maxCursor = this.rows.length + 1;
		if (matchesKey(data, "ctrl+c") || matchesKey(data, "escape")) {
			this.done({ type: "cancel" });
			return;
		}
		if (matchesKey(data, "ctrl+s")) {
			this.done({ type: "save", config: this.draft });
			return;
		}
		if (matchesKey(data, "down") || matchesKey(data, "j")) {
			this.cursor = Math.min(maxCursor, this.cursor + 1);
			return;
		}
		if (matchesKey(data, "up") || matchesKey(data, "k")) {
			this.cursor = Math.max(0, this.cursor - 1);
			return;
		}
		if (matchesKey(data, "g")) {
			this.cursor = 0;
			return;
		}
		if (data === "G") {
			this.cursor = maxCursor;
			return;
		}
		if (matchesKey(data, "i")) {
			this.applyInherit();
			return;
		}
		if (matchesKey(data, "e")) {
			this.selectedRow = this.rows[this.cursor] ?? SET_ALL_AGENTS;
			this.mode = "effort";
			this.effortCursor = 0;
			return;
		}
		if (matchesKey(data, "x")) {
			this.done({ type: "export", config: this.draft });
			return;
		}
		if (matchesKey(data, "r")) {
			this.done({ type: "restore", config: this.draft });
			return;
		}
		if (matchesKey(data, "c")) {
			const row = this.rows[this.cursor];
			if (row === SET_ALL_AGENTS)
				this.done({ type: "custom", agent: "all", config: this.draft });
			else if (row)
				this.done({ type: "custom", agent: row, config: this.draft });
			return;
		}
		if (!matchesKey(data, "return")) return;
		if (this.cursor === this.rows.length) {
			this.done({ type: "save", config: this.draft });
			return;
		}
		if (this.cursor === this.rows.length + 1) {
			this.done({ type: "cancel" });
			return;
		}
		this.selectedRow = this.rows[this.cursor] ?? SET_ALL_AGENTS;
		this.mode = "models";
		this.modelCursor = 0;
		this.query = "";
	}

	private handleModelInput(data: string): void {
		const options = this.filteredModelOptions();
		if (matchesKey(data, "ctrl+c")) {
			this.done({ type: "cancel" });
			return;
		}
		if (matchesKey(data, "escape")) {
			this.mode = "agents";
			this.query = "";
			return;
		}
		if (matchesKey(data, "backspace")) {
			this.query = this.query.slice(0, -1);
			this.modelCursor = Math.min(
				this.modelCursor,
				Math.max(0, this.filteredModelOptions().length - 1),
			);
			return;
		}
		if (matchesKey(data, "down") || matchesKey(data, "j")) {
			this.modelCursor = Math.min(
				Math.max(0, options.length - 1),
				this.modelCursor + 1,
			);
			return;
		}
		if (matchesKey(data, "up") || matchesKey(data, "k")) {
			this.modelCursor = Math.max(0, this.modelCursor - 1);
			return;
		}
		if (matchesKey(data, "return")) {
			const selected = options[this.modelCursor];
			if (!selected) return;
			if (selected === CUSTOM_MODEL) {
				this.done({
					type: "custom",
					agent: this.selectedRow === SET_ALL_AGENTS ? "all" : this.selectedRow,
					config: this.draft,
				});
				return;
			}
			if (selected === KEEP_CURRENT) {
				this.mode = "agents";
				return;
			}
			this.applyModelSelection(
				selected === INHERIT_MODEL ? undefined : selected,
			);
			this.mode = "agents";
			return;
		}
		if (data.length === 1 && data.charCodeAt(0) >= 32) {
			this.query += data;
			this.modelCursor = 0;
		}
	}

	private applyModelSelection(model: string | undefined): void {
		const row = this.rows[this.cursor];
		if (row === SET_ALL_AGENTS) {
			for (const name of this.rows.slice(1)) this.setModel(name, model);
			return;
		}
		if (!row) return;
		this.setModel(row, model);
	}

	private applyThinkingSelection(thinking: ThinkingLevel | undefined): void {
		const row = this.selectedRow;
		if (row === SET_ALL_AGENTS) {
			for (const name of this.rows.slice(1)) this.setThinking(name, thinking);
			return;
		}
		this.setThinking(row, thinking);
	}

	private applyInherit(): void {
		const row = this.rows[this.cursor];
		if (row === SET_ALL_AGENTS) {
			for (const name of this.rows.slice(1)) this.clearEntry(name);
			return;
		}
		if (row) this.clearEntry(row);
	}

	private setModel(name: string, model: string | undefined): void {
		const current = this.draft[name] ?? {};
		if (model === undefined) delete current.model;
		else current.model = model;
		if (!current.model && !current.thinking) this.draft[name] = {};
		else this.draft[name] = current;
	}

	private setThinking(name: string, thinking: ThinkingLevel | undefined): void {
		const current = this.draft[name] ?? {};
		if (thinking === undefined) delete current.thinking;
		else current.thinking = thinking;
		if (!current.model && !current.thinking) this.draft[name] = {};
		else this.draft[name] = current;
	}

	private clearEntry(name: string): void {
		this.draft[name] = {};
	}

	private filteredModelOptions(): string[] {
		const query = this.query.trim().toLowerCase();
		if (!query) return this.modelOptions;
		return this.modelOptions.filter((option) =>
			option.toLowerCase().includes(query),
		);
	}

	private renderAgentList(width: number): string[] {
		const lines: string[] = [];
		const line = (text = "", tone?: PanelTone) =>
			this.renderLine(text, width, tone);
		lines.push(line("Assign Models and Effort to Agents", "title"));
		lines.push("");
		lines.push(line("Current assignments:", "muted"));
		lines.push("");
		const visibleRows = Math.min(AGENT_LIST_MAX_VISIBLE_ROWS, this.rows.length);
		const listCursor = Math.min(this.cursor, this.rows.length - 1);
		const start = Math.max(
			0,
			Math.min(
				listCursor - Math.floor(visibleRows / 2),
				Math.max(0, this.rows.length - visibleRows),
			),
		);
		const end = Math.min(this.rows.length, start + visibleRows);
		if (start > 0) lines.push(line(`  ↑ ${start} more agent(s)`, "muted"));
		for (let i = start; i < end; i++) {
			const row = this.rows[i] ?? SET_ALL_AGENTS;
			const focused = i === this.cursor;
			const label =
				row === SET_ALL_AGENTS
					? this.renderSetAllLabel(row)
					: this.renderAgentLabel(row);
			lines.push(`${this.renderCursor(focused)} ${label}`);
		}
		if (end < this.rows.length)
			lines.push(line(`  ↓ ${this.rows.length - end} more agent(s)`, "muted"));
		lines.push("");
		lines.push(
			`${this.renderCursor(this.cursor === this.rows.length)} ${this.renderText(
				"Continue",
				this.cursor === this.rows.length ? "accent" : "text",
			)}`,
		);
		lines.push(
			`${this.renderCursor(this.cursor === this.rows.length + 1)} ${this.renderText(
				"← Back",
				this.cursor === this.rows.length + 1 ? "accent" : "text",
			)}`,
		);
		lines.push("");
		lines.push(
			line(
				`j/k scroll • enter model/save • e effort • i ${isProviderReviewRole(this.rows[this.cursor] ?? "") ? "Pi persisted defaults" : "inherit"} • c custom • x export • r restore • ctrl+s save • esc back`,
				"muted",
			),
		);
		return lines;
	}

	private renderModelPicker(width: number): string[] {
		const lines: string[] = [];
		const options = this.filteredModelOptions();
		const line = (text = "", tone?: PanelTone) =>
			this.renderLine(text, width, tone);
		lines.push(
			line(`Select model for ${sanitizeTerminalText(this.selectedRow)}`, "title"),
		);
		lines.push("");
		lines.push(
			`${this.renderText("◎", "accent")} ${this.renderText(this.query || "search...", "muted")}`,
		);
		lines.push("");
		const start = Math.max(
			0,
			Math.min(
				this.modelCursor - Math.floor(MODEL_LIST_MAX_VISIBLE_ROWS / 2),
				Math.max(0, options.length - MODEL_LIST_MAX_VISIBLE_ROWS),
			),
		);
		const end = Math.min(options.length, start + MODEL_LIST_MAX_VISIBLE_ROWS);
		for (let i = start; i < end; i++) {
			const focused = i === this.modelCursor;
			lines.push(
				`${this.renderCursor(focused)} ${this.renderText(
					options[i] === INHERIT_MODEL && isProviderReviewRole(this.selectedRow)
						? routingDefaultLabel(this.selectedRow, "model")
						: (options[i] ?? ""),
					focused ? "status" : "text",
				)}`,
			);
		}
		if (options.length === 0) lines.push(line("  No matching models", "muted"));
		lines.push("");
		lines.push(
			line("j/k: navigate • type: search • enter: select • esc: back", "muted"),
		);
		return lines;
	}

	private handleEffortInput(data: string): void {
		if (matchesKey(data, "ctrl+c")) {
			this.done({ type: "cancel" });
			return;
		}
		if (matchesKey(data, "escape")) {
			this.mode = "agents";
			return;
		}
		if (matchesKey(data, "down") || matchesKey(data, "j")) {
			this.effortCursor = Math.min(
				Math.max(0, THINKING_OPTIONS.length - 1),
				this.effortCursor + 1,
			);
			return;
		}
		if (matchesKey(data, "up") || matchesKey(data, "k")) {
			this.effortCursor = Math.max(0, this.effortCursor - 1);
			return;
		}
		if (!matchesKey(data, "return")) return;
		const selected = THINKING_OPTIONS[this.effortCursor];
		if (selected === INHERIT_THINKING) this.applyThinkingSelection(undefined);
		else this.applyThinkingSelection(selected);
		this.mode = "agents";
	}

	private renderEffortPicker(width: number): string[] {
		const lines: string[] = [];
		const line = (text = "", tone?: PanelTone) =>
			this.renderLine(text, width, tone);
		lines.push(
			line(`Select effort for ${sanitizeTerminalText(this.selectedRow)}`, "title"),
		);
		lines.push("");
		for (let i = 0; i < THINKING_OPTIONS.length; i++) {
			const focused = i === this.effortCursor;
			lines.push(
				`${this.renderCursor(focused)} ${this.renderText(
					THINKING_OPTIONS[i] === INHERIT_THINKING && isProviderReviewRole(this.selectedRow)
						? routingDefaultLabel(this.selectedRow, "effort")
						: (THINKING_OPTIONS[i] ?? ""),
					focused ? "status" : "text",
				)}`,
			);
		}
		lines.push("");
		lines.push(line("j/k: navigate • enter: select • esc: back", "muted"));
		return lines;
	}

	private renderSetAllLabel(row: string): string {
		const models = this.rows
			.slice(1)
			.map((name) => this.draft[name]?.model ?? routingDefaultLabel(name, "model"));
		const efforts = this.rows
			.slice(1)
			.map((name) => this.draft[name]?.thinking ?? routingDefaultLabel(name, "effort"));
		const firstModel = models[0] ?? "inherit";
		const firstEffort = efforts[0] ?? "inherit";
		const modelLabel = models.every((value) => value === firstModel)
			? firstModel
			: "mixed";
		const effortLabel = efforts.every((value) => value === firstEffort)
			? firstEffort
			: "mixed";
		return `${this.renderText(sanitizeTerminalText(row).padEnd(20), "text")} ${this.renderText("model=", "muted")}${this.renderText(modelLabel, "status")}${this.renderText(
			", effort=",
			"muted",
		)}${this.renderText(effortLabel, "status")}`;
	}

	private renderAgentLabel(row: string): string {
		const model = this.draft[row]?.model ?? routingDefaultLabel(row, "model");
		const effort = this.draft[row]?.thinking ?? routingDefaultLabel(row, "effort");
		return `${this.renderText(sanitizeTerminalText(row).padEnd(20), "text")} ${this.renderText("model=", "muted")}${this.renderText(model, "status")}${this.renderText(
			", effort=",
			"muted",
		)}${this.renderText(effort, "status")}`;
	}
}



export function renderSddModelPanelForTesting(
	initialConfig: AgentModelConfig,
	modelOptions: string[],
	agents: string[],
	width: number,
	theme?: Theme,
): string[] {
	return new SddModelPanel(initialConfig, modelOptions, agents, () => {}, theme).render(
		width,
	);
}



async function showSddModelPanel(
	ctx: ExtensionContext,
	config: AgentModelConfig,
): Promise<ModelPanelResult> {
	const modelOptions = await getPiModelOptions(ctx);
	const agents = modelAssignmentNames(ctx.cwd);
	return ctx.ui.custom<ModelPanelResult>(
		(_tui, theme, _keybindings, done) =>
			new SddModelPanel(config, modelOptions, agents, done, theme),
		{
			overlay: true,
			overlayOptions: {
				anchor: "center",
				width: "70%",
				minWidth: 72,
				maxHeight: "85%",
			},
		},
	);
}



export async function handleModelsCommand(ctx: ExtensionContext): Promise<void> {
	migrateLegacyProjectModelOverrides(ctx.cwd);
	const savedConfig = await readModelRoutingAuthorityAsync(
		modelConfigPath(ctx.cwd),
		legacyProjectModelConfigPath(ctx.cwd),
	);
	if (savedConfig.status === "invalid") {
		ctx.ui.notify(
			`el Jero 无法打开模型配置：${savedConfig.path} 不是合法的 JSON 或不是对象。请修复或删除该文件，然后重新运行 /jero:models。`,
			"warning",
		);
		return;
	}
	let config = savedConfig.status === "valid" ? savedConfig.config : {};
	let result = await showSddModelPanel(ctx, config);
	while (result.type === "custom" || result.type === "export" || result.type === "restore") {
		config = cloneModelConfig(result.config);
		if (result.type === "export") {
			try {
				const count = await exportSavedModelConfig(ctx);
				ctx.ui.notify(`el Jero 已将 ${count} 条已保存的模型路由条目导出到 ${modelExportPath(ctx.cwd)}。`, "info");
			} catch (error) {
				ctx.ui.notify(`模型路由导出失败：${error instanceof Error ? error.message : String(error)}`, "warning");
			}
			result = await showSddModelPanel(ctx, config);
			continue;
		}
		if (result.type === "restore") {
			const restored = await readModelExport(ctx);
			if (!restored) {
				ctx.ui.notify(`模型路由恢复失败：${modelExportPath(ctx.cwd)} 缺失或无效。`, "warning");
				result = await showSddModelPanel(ctx, config);
				continue;
			}
			const approved = await ctx.ui.confirm("Restore saved model routing?", `Replace ${modelConfigPath(ctx.cwd)} with ${modelExportPath(ctx.cwd)}`);
			if (approved) {
				try {
					await writeModelConfigAsync(ctx.cwd, restored);
				} catch (error) {
					ctx.ui.notify(`模型路由恢复失败（尚未写入配置）：${error instanceof Error ? error.message : String(error)}`, "warning");
					result = await showSddModelPanel(ctx, config);
					continue;
				}
				config = restored;
				try {
					const applyResult = await applyModelConfigAsync(ctx.cwd, restored);
					ctx.ui.notify([
						"el Jero 已恢复全局模型配置。",
						`导入文件：${modelExportPath(ctx.cwd)}`,
						`全局配置：${modelConfigPath(ctx.cwd)}`,
						`已更新代理数：${applyResult.updated}`,
					].join("\n"), "info");
				} catch (error) {
					ctx.ui.notify([
						"el Jero 已恢复全局模型配置，但将其应用到代理时失败。",
						`全局配置：${modelConfigPath(ctx.cwd)}`,
						`应用错误：${error instanceof Error ? error.message : String(error)}`,
					].join("\n"), "warning");
				}
			}
			result = await showSddModelPanel(ctx, config);
			continue;
		}
		const current =
			result.agent === "all"
				? "inherit"
				: (config[result.agent]?.model ?? "inherit");
		const custom = await ctx.ui.input(
			`${result.agent === "all" ? "all agents" : sanitizeTerminalText(result.agent)} custom model id`,
			current === "inherit" ? "provider/model" : sanitizeTerminalText(current),
		);
		if (custom === undefined) return;
		const trimmed = custom.trim();
		if (trimmed.length > 0) {
			const model = normalizeModelId(trimmed);
			if (!model) {
				ctx.ui.notify(
					"自定义模型 id 必须是单行的 provider/model 标识符，只能使用字母、数字以及 '.'、'-'、'_'、'~'、':'、'@'、'/'、'+'、'%' 这些字符。",
					"warning",
				);
				result = await showSddModelPanel(ctx, config);
				continue;
			}
			if (result.agent === "all") {
				const next: AgentModelConfig = { ...config };
				for (const name of modelAssignmentNames(ctx.cwd)) {
					next[name] = {
						...(next[name] ?? {}),
						model,
					};
				}
				config = next;
			} else {
				config = {
					...config,
					[result.agent]: {
						...(config[result.agent] ?? {}),
						model,
					},
				};
			}
		}
		result = await showSddModelPanel(ctx, config);
	}
	if (result.type !== "save") return;
	writeModelConfig(ctx.cwd, result.config);
	const applyResult = await applyModelConfigAsync(ctx.cwd, result.config);
	ctx.ui.notify(
		[
			"el Jero 全局模型配置已保存。",
			`全局配置：${modelConfigPath(ctx.cwd)}`,
			`已更新代理数：${applyResult.updated}`,
			...describeModelConfig(ctx.cwd, result.config),
		].join("\n"),
		"info",
	);
}

