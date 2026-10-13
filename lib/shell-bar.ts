import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { GAUGE_CELLS, gaugeTone, paintGauge, renderGauge, type GaugeTone } from "./shell-gauge.ts";
import { renderUsageBar, type ProviderUsage } from "./shell-usage.ts";
import { sanitizeTerminalText } from "./terminal-theme.ts";
import { CARD_TONE, cardInnerWidth, renderCard } from "./shell-card.ts";

export { gaugeTone, renderGauge, type GaugeTone };

// Jero Shell 状态栏：一行分段，替代 pi 内建的三行页脚。这里的一切
// 都是纯函数，无需活动 TUI 即可渲染和验证。

export interface ShellBarModel {
	profile?: string;
	cwd: string;
	branch: string | null;
	dirty: number | undefined;
	sessionName: string | undefined;
	modelId: string;
	effort: string | undefined;
	contextPercent: number | null;
	contextWindow: number;
	costTotal: number;
	subscription: boolean;
	usage: ProviderUsage | undefined;
	statuses: string[];
}

export interface ShellBarTheme {
	fg(color: string, text: string): string;
	bold(text: string): string;
}

// 状态栏绘制所用的主题角色。键是 pi 主题颜色；Gentle 主题将它们映射
// 到玫瑰调色板（accent = 玫瑰，syntaxFunction = 粉蓝）。
const ROLE = {
	BRAND: "accent",
	SEPARATOR: "dim",
	PATH: "muted",
	BRANCH: "text",
	DIRTY: "warning",
	MODEL: "text",
	EFFORT: "syntaxFunction",
	LABEL: "muted",
	VALUE: "text",
	STATUS: "muted",
	SESSION: "dim",
} as const;

export const SHELL_BAR_BRAND = "✿ jero-pi";
export const SHELL_BAR_SEPARATOR = "⟡";
export const SHELL_BAR_GAUGE_CELLS = GAUGE_CELLS;
const RIGHT_PADDING = 2;
const COMPACT_BRANCH_WIDTH = 15;

export function shellEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
	if (env.JERO_PI_AGENTS_CHILD === "1") return false;
	const value = env.JERO_PI_SHELL?.trim().toLowerCase();
	return !(value === "0" || value === "false" || value === "off");
}

export function formatTokens(count: number): string {
	if (count < 1000) return count.toString();
	if (count < 10_000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1_000_000) return `${Math.round(count / 1000)}k`;
	if (count < 10_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
	return `${Math.round(count / 1_000_000)}M`;
}

export function formatCost(total: number, subscription: boolean): string {
	const amount = total >= 1 ? total.toFixed(2) : total.toFixed(3);
	return subscription ? `$${amount} sub` : `$${amount}`;
}

// 扩展可能自行绘制其状态（pi-mcp-adapter 就这么做）；调色板归状态栏
// 所有，因此它们的转义序列被剥离，文本改用 status 角色。
function sanitizeStatus(text: string): string {
	return sanitizeTerminalText(text.replace(/[\r\n\t]/g, " ")).replace(/ +/g, " ").trim();
}

function buildSegments(model: ShellBarModel, theme: ShellBarTheme): string[] {
	const dirty = model.dirty ? ` ${theme.fg(ROLE.DIRTY, `±${model.dirty}`)}` : "";
	const location = model.branch
		? `${theme.fg(ROLE.PATH, model.cwd)} ${theme.fg(ROLE.BRANCH, model.branch)}${dirty}`
		: theme.fg(ROLE.PATH, model.cwd) + dirty;
	const modelSegment = model.effort
		? `${theme.fg(ROLE.MODEL, model.modelId)} ${theme.fg(ROLE.LABEL, "·")} ${theme.fg(ROLE.EFFORT, model.effort)}`
		: theme.fg(ROLE.MODEL, model.modelId);
	const percentText = model.contextPercent === null ? "?%" : `${Math.round(model.contextPercent)}%`;
	const context = `${theme.fg(ROLE.LABEL, "ctx")} ${paintGauge(model.contextPercent, theme)} ${theme.fg(ROLE.VALUE, percentText)}`;
	const cost = theme.fg(ROLE.VALUE, formatCost(model.costTotal, model.subscription));
	const usage = model.usage ? renderUsageBar(model.usage, theme) : undefined;
	const statuses = model.statuses.map((status) => theme.fg(ROLE.STATUS, sanitizeStatus(status)));
	return [theme.fg(ROLE.BRAND, SHELL_BAR_BRAND), location, modelSegment, context, cost, ...(usage ? [usage] : []), ...statuses];
}

// 行溢出时先让位位置信息：路径收缩到最后一段，长分支名被裁剪，
// 使尾部的状态（MCP 服务器、扩展通知）在普通终端宽度下仍能幸存。
export function compactModel(model: ShellBarModel): ShellBarModel {
	const cwd = model.cwd.split(/[\\/]/).filter((part) => part.length > 0).pop() ?? model.cwd;
	const branch = model.branch && visibleWidth(model.branch) > COMPACT_BRANCH_WIDTH ? clipText(model.branch, COMPACT_BRANCH_WIDTH) : model.branch;
	return { ...model, cwd, branch };
}

// 普通裁剪：pi 的 truncateToWidth 会用重置序列包裹结果，那会落进
// 已着色的分段内部。
function clipText(text: string, max: number): string {
	let clipped = "";
	for (const char of text) {
		if (visibleWidth(clipped + char) > max - 1) break;
		clipped += char;
	}
	return `${clipped}…`;
}

function joinSegments(segments: string[], theme: ShellBarTheme): string {
	return segments.join(` ${theme.fg(ROLE.SEPARATOR, SHELL_BAR_SEPARATOR)} `);
}

// 侧栏分组使用结构化字段，绝不使用按位置排列的紧凑栏分段，
// 也绝不从含义不明的扩展状态字符串推断语义。
export function renderShellSidebarBar(model: ShellBarModel, theme: ShellBarTheme, width: number): string[] {
	const value = (text: string) => theme.fg(ROLE.VALUE, theme.bold(text));
	const label = (text: string) => theme.fg(ROLE.LABEL, text);
	const dirty = model.dirty ? theme.fg(ROLE.DIRTY, `±${model.dirty}`) : "";
	const branch = model.branch ? `${label("Branch")} ${value(model.branch)}` : "";
	const percent = model.contextPercent === null ? "?%" : `${Math.round(model.contextPercent)}%`;
	const capacity = label(`${formatTokens(model.contextWindow)} tokens`);
	const usage = model.usage ? renderUsageBar(model.usage, theme) : undefined;
	const groups: Array<{ title: string; lines: string[] }> = [
		{
			title: "Project",
			lines: [
				value(model.cwd),
				...((branch || dirty) ? [[branch, dirty].filter(Boolean).join(" ")] : []),
				...(model.sessionName ? [`${label("Session")} ${value(model.sessionName)}`] : []),
			],
		},
		{
			title: "Model",
			lines: [
				value(model.modelId),
				...(model.effort ? [`${label("Effort")} ${theme.fg(ROLE.EFFORT, model.effort)}`] : []),
				...(model.profile ? [`${label("Profile")} ${value(sanitizeStatus(model.profile))}`] : []),
			],
		},
		{
			title: "Context",
			lines: [`${paintGauge(model.contextPercent, theme)} ${value(percent)}  ${capacity}`],
		},
		{
			title: "Usage",
			lines: [`${label("Cost")} ${value(formatCost(model.costTotal, model.subscription))}`, ...(usage ? [usage] : [])],
		},
		...(model.statuses.length ? [{ title: "Integrations", lines: model.statuses.map((status) => theme.fg(ROLE.STATUS, sanitizeStatus(status))) }] : []),
	];
	// 先换行再缩进，使 Unicode/ANSI 的续行保持相同的缩进，
	// 且不吞掉卡片的右边框。
	const innerWidth = cardInnerWidth(width);
	const inset = Math.min(1, innerWidth - 1);
	const body = groups.flatMap((group, index) => [
		...(index ? [""] : []),
		label(group.title),
		...group.lines.flatMap((line) => wrapTextWithAnsi(line, innerWidth - inset).map((part) => " ".repeat(inset) + part)),
	]);
	return renderCard({ title: "Status", body, tone: CARD_TONE.INFO }, theme, width, { expanded: true });
}

export function renderShellBar(model: ShellBarModel, theme: ShellBarTheme, width: number): string[] {
	let segments = buildSegments(model, theme);
	const right = model.sessionName ? theme.fg(ROLE.SESSION, model.sessionName) : undefined;

	let left = joinSegments(segments, theme);
	if (right && visibleWidth(left) + RIGHT_PADDING + visibleWidth(right) <= width) {
		const padding = " ".repeat(width - visibleWidth(left) - visibleWidth(right));
		return [left + padding + right];
	}

	if (visibleWidth(left) > width) {
		segments = buildSegments(compactModel(model), theme);
		left = joinSegments(segments, theme);
	}
	while (segments.length > 1 && visibleWidth(left) > width) {
		segments.pop();
		left = joinSegments(segments, theme);
	}
	return [truncateToWidth(left, width, "…")];
}
