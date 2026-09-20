import { visibleWidth } from "@earendil-works/pi-tui";
import type { ShellBarTheme } from "./shell-bar.ts";

export function renderSidebarBanner(theme: ShellBarTheme, width: number): string[] {
	const label = "✿ Gentle-Pi ✿";
	const space = width - visibleWidth(label);
	if (space < 0) return [];
	// Gentleman 主题的强调色是粉色；卡片标题使用单独的香槟色角色。
	const title = theme.fg("accent", "✿") + " " + theme.fg("text", "Gentle-Pi") + " " + theme.fg("accent", "✿");
	return [" ".repeat(Math.floor(space / 2)) + title + " ".repeat(Math.ceil(space / 2))];
}
