import { keyHint, type AgentToolResult } from "@earendil-works/pi-coding-agent";
import { wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { CARD_TONE, cardBottom, cardInnerWidth, cardLine, cardTop, type Card, type CardTheme, type CardTone } from "./shell-card.ts";
import { sanitizeTerminalText } from "./terminal-theme.ts";

// Jero 工具卡片：每次调用 gentle-ai 二进制和每个 jero_review 工具
// 都绘制与其他 Gentle 通知相同的卡片。调用组件拥有顶框线；
// 结果组件负责闭合框架。

export interface GentleAiRenderTheme extends CardTheme {
	bg?(color: string, text: string): string;
}

export interface GentleAiRenderState {
	lifecycleComponent?: boolean;
	genericLocked?: boolean;
	/** 一旦存在最终结果即由结果渲染器设置，使被重放的调用
	 * （pi 从不将其标记为已启动）仍能显示其结局。 */
	finished?: boolean;
	failed?: boolean;
}

export interface JeroRenderContext {
	argsComplete?: boolean;
	executionStarted?: boolean;
	isPartial?: boolean;
	isError?: boolean;
	expanded?: boolean;
	lastComponent?: unknown;
	state?: unknown;
	invalidate?: () => void;
}

const LIFECYCLE_STATUS = {
	PREPARING: "preparing",
	RUNNING: "running",
	COMPLETED: "completed",
	FAILED: "failed",
} as const;

type LifecycleStatus = (typeof LIFECYCLE_STATUS)[keyof typeof LIFECYCLE_STATUS];

const STATUS_TONE: Record<LifecycleStatus, CardTone> = {
	[LIFECYCLE_STATUS.PREPARING]: CARD_TONE.WARNING,
	[LIFECYCLE_STATUS.RUNNING]: CARD_TONE.WARNING,
	[LIFECYCLE_STATUS.COMPLETED]: CARD_TONE.SUCCESS,
	[LIFECYCLE_STATUS.FAILED]: CARD_TONE.ERROR,
};

const CARD_TITLE = "Jero";
// 二进制保留玫瑰；Gentle Shell 通知保留花朵。
const CARD_GLYPH = "\u{1F339}\uFE0E";
const DETAIL_ROLE = "dim";
const HIDDEN_ROLE = "dim";
const passthroughTheme: CardTheme = { fg: (_color, text) => text };

export function getGentleAiRenderState(state: unknown): GentleAiRenderState | undefined {
	if (!state || typeof state !== "object" || Array.isArray(state)) return undefined;
	const rowState = state as Record<string, unknown>, existing = rowState.gentleAiRender;
	if (existing && typeof existing === "object" && !Array.isArray(existing)) return existing as GentleAiRenderState;
	return (rowState.gentleAiRender = {} as GentleAiRenderState);
}

// 调用行：顶框线，工具结束后在其右端显示展开键，展开时显示命令。
// pi 将结果组件渲染在它正下方，由结果组件闭合框架。
// 调用卡片拥有顶框线。执行仍在运行时它还负责闭合框架，因为尚无
// 结果行；一旦最终结果就绪，改由结果卡片闭合。
export class GentleAiCallCard {
	private card: Card = { title: CARD_TITLE, body: [], tone: CARD_TONE.WARNING };
	private theme: GentleAiRenderTheme = passthroughTheme;
	private detail: string | undefined;
	private hint: string | undefined;
	private open = true;

	update(status: LifecycleStatus, operationPath: string, theme: GentleAiRenderTheme, detail?: string, hint?: string): void {
		this.card = { title: CARD_TITLE, subtitle: `${status} · ${operationPath}`, body: [], tone: STATUS_TONE[status], glyph: CARD_GLYPH };
		this.theme = theme;
		this.detail = detail;
		this.hint = hint;
		this.open = status === LIFECYCLE_STATUS.RUNNING || status === LIFECYCLE_STATUS.PREPARING;
	}

	render(width: number): string[] {
		const lines = [cardTop(this.card, this.theme, width, this.hint)];
		if (this.detail) lines.push(cardLine(this.theme.fg(DETAIL_ROLE, this.detail), this.card.tone, this.theme, width));
		if (this.open) lines.push(cardBottom(this.card.tone, this.theme, width));
		return lines;
	}

	invalidate(): void {}
}

// 结果行：展开时显示正文，折叠时只显示行数（调用卡片持有展开键，
// 文本保持隐藏），并始终包含闭合框架的底框线。侧轨随结局变化：
// 部分结果为琥珀色，完成为绿色，出错为红色。
export class GentleAiResultCard {
	private readonly text: string;
	private readonly expanded: boolean;
	private readonly tone: CardTone;
	private readonly theme: GentleAiRenderTheme;
	private readonly partial: boolean;

	constructor(text: string, expanded: boolean, tone: CardTone, theme: GentleAiRenderTheme, partial = false) {
		this.text = text;
		this.expanded = expanded;
		this.tone = tone;
		this.theme = theme;
		this.partial = partial;
	}

	render(width: number): string[] {
		const lines: string[] = [];
		if (this.text.length > 0) {
			if (this.expanded) {
				const innerWidth = cardInnerWidth(width);
				for (const raw of this.text.split("\n")) {
					for (const line of raw === "" ? [""] : wrapTextWithAnsi(raw, innerWidth)) lines.push(cardLine(line, this.tone, this.theme, width));
				}
			} else {
				const count = this.text.split("\n").length;
				lines.push(cardLine(this.theme.fg(HIDDEN_ROLE, `${count} ${count === 1 ? "line" : "lines"}`), this.tone, this.theme, width));
			}
		}
		// 部分结果位于仍在运行的调用卡片之下，框架仍由调用卡片闭合。
		if (!this.partial) lines.push(cardBottom(this.tone, this.theme, width));
		return lines;
	}

	invalidate(): void {}
}

export interface GentleAiResultRenderOptions {
	expanded?: boolean;
	isPartial?: boolean;
	isError?: boolean;
}

export function renderJeroResult(
	result: AgentToolResult<unknown>,
	options: GentleAiResultRenderOptions,
	theme: GentleAiRenderTheme = passthroughTheme,
	context?: JeroRenderContext,
): GentleAiResultCard {
	const textItems = result.content.flatMap((content) => (content.type === "text" ? [sanitizeTerminalText(content.text)] : []));
	const text = textItems.some((item) => item.length > 0) ? textItems.join("\n") : "";
	const tone = options.isError ? CARD_TONE.ERROR : options.isPartial ? CARD_TONE.WARNING : CARD_TONE.SUCCESS;
	const state = getGentleAiRenderState(context?.state);
	if (state && options.isPartial !== true) {
		const changed = state.finished !== true || state.failed !== (options.isError === true);
		state.finished = true;
		state.failed = options.isError === true;
		// pi 的 invalidate 会同步重跑工具显示；从本渲染内部调用会把第二对
		// 调用+结果嵌套进同一容器。推迟执行可保证每次执行只有一帧。
		if (changed) queueMicrotask(() => context?.invalidate?.());
	}
	return new GentleAiResultCard(text, options.expanded === true, tone, theme, options.isPartial === true);
}

export function renderJeroLifecycleCall(
	operationPath: string,
	theme: GentleAiRenderTheme,
	context?: JeroRenderContext,
	detail?: string,
): GentleAiCallCard {
	// 已结束的执行即使在 pi 未带 argsComplete 重放它时（会话重载）也视为
	// 已完成；准备中只适用于启动之前。
	const state = getGentleAiRenderState(context?.state);
	const finished = (context?.executionStarted === true && context.isPartial !== true) || state?.finished === true;
	const failed = context?.isError === true || state?.failed === true;
	const status: LifecycleStatus = failed
		? LIFECYCLE_STATUS.FAILED
		: finished
			? LIFECYCLE_STATUS.COMPLETED
			: context?.argsComplete === false
				? LIFECYCLE_STATUS.PREPARING
				: LIFECYCLE_STATUS.RUNNING;
	const component = context?.lastComponent instanceof GentleAiCallCard && (!state || state.lifecycleComponent === true)
		? context.lastComponent
		: new GentleAiCallCard();
	if (state) state.lifecycleComponent = true;
	const hint = finished ? keyHint("app.tools.expand", context?.expanded ? "to collapse" : "to expand") : undefined;
	component.update(status, operationPath, theme, detail ? sanitizeTerminalText(detail) : undefined, hint);
	return component;
}
