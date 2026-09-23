import type { Component, TUI } from "@earendil-works/pi-tui";

// 存储挂在终端上而非模块单例：扩展加载器可能隔离模块，而 Pi 在普通/
// 全屏切换之间保留同一终端。
const STATE = Symbol.for("gentle-pi.experimental-sidebar.state");
export interface SidebarState {
	active: boolean;
	ownsHost?: () => boolean;
	parts: Map<string, SidebarRail>;
}

/** 全屏侧栏中的一个侧轨槽位。 */
export interface SidebarRail extends Component {
	/**
	 * 该侧栏所绘活动状态的廉价摘要。全屏布局的记忆化只在摘要变化时
	 * 重渲染部件，因此读取会话数据（模型、思考层级、上下文、成本、
	 * 扩展状态）的侧栏必须声明摘要；离散的状态变化仍用显式的
	 * invalidateSidebar()。
	 */
	digest?(): string;
}
export function sidebarState(tui: TUI): SidebarState {
	const terminal = tui.terminal as unknown as Record<symbol, SidebarState>;
	return terminal[STATE] ??= { active: false, parts: new Map() };
}

/** 保持原有底部组件挂载，只抑制其绘制。 */
export function sidebarPart<T extends Component & { dispose?(): void }>(tui: TUI, key: string, bottom: T, rail: SidebarRail = bottom): T & { dispose?(): void } {
	// 最小化扩展宿主无法共享终端持有的布局状态。
	if (!tui.terminal) return bottom;
	const state = sidebarState(tui);
	state.parts.set(key, rail);
	return {
		...bottom,
		render: (width: number) => state.active && state.ownsHost?.() ? [] : bottom.render(width),
		dispose() {
			if (state.parts.get(key) === rail) state.parts.delete(key);
			bottom.dispose?.();
		},
	};
}
