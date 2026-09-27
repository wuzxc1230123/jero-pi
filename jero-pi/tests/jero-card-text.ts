import { stripAnsi } from "../lib/terminal-theme.ts";

// 仅测试用的卡片读取器：顶栏内的标题文本、其两侧的语气标签（配合带标签
// 的假主题），以及去掉边框后两栏之间的正文。同时接受纯文本与带标签输出。

const TAG = /<\/?[a-zA-Z]+>/g;
const EDGE_LEFT = /^(?:<[a-zA-Z]+>)?│(?:<\/[a-zA-Z]+>)? ?/;
const EDGE_RIGHT = / ?(?:<[a-zA-Z]+>)?│(?:<\/[a-zA-Z]+>)?$/;

function plain(line: string): string {
	return stripAnsi(line).replace(TAG, "");
}

export function cardTitle(rendered: string): string {
	const first = rendered.split("\n")[0] ?? "";
	return plain(first).replace(/^╭─ /, "").replace(/ ─+(?: .* )?╮$/, "").trim();
}

export function cardTone(rendered: string): string | undefined {
	return (rendered.split("\n")[0] ?? "").match(/<([a-zA-Z]+)>(?:✿|🌹︎) Jero<\//)?.[1];
}

export function cardBody(rendered: string): string {
	return rendered
		.split("\n")
		.filter((line) => !/^[╭╰]/.test(plain(line)))
		.map((line) => line.replace(EDGE_LEFT, "").replace(EDGE_RIGHT, "").trimEnd())
		.join("\n");
}

export function cardHint(rendered: string): string | undefined {
	const first = rendered.split("\n")[0] ?? "";
	return plain(first).match(/ ─+ (.+) ╮$/)?.[1];
}
