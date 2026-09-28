// pi-pretty（工具输出渲染）与 pi-hashline-edit-pro（哈希锚定 read/grep/edit）
// 都会注册 read/grep，宿主对扩展间同名工具是硬冲突——两者共存时会话无法启
// 动。jero-pi 同时发布这两个插件，因此在其装配层（extensions/jero-ai.ts 模
// 块顶层，先于 node_modules 插件加载）把这两个名字合并进 pi-pretty 自有的
// 跳过名单 PRETTY_DISABLE_TOOLS，让哈希锚定版本独占（防错位语义是编辑契
// 约的一部分，见 docs/dependency-exit-plan.md 对应行）。

export const PRETTY_CONFLICTING_TOOLS: readonly string[] = ["read", "grep"];

// 纯合并：保留操作者已有的跳过项并去重；环境写入由调用方负责，本模块不触
// process.env。
export function mergePrettyDisableTools(existing: string | undefined): string {
	const names = new Set(existing?.split(",").map(name => name.trim()).filter(Boolean) ?? []);
	for (const tool of PRETTY_CONFLICTING_TOOLS) names.add(tool);
	return [...names].join(",");
}
