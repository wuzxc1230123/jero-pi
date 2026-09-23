// persona 命令处理器：/jero:persona。
// 自 extensions/jero-ai.ts 拆分（机械平移，语义零改动）。

import { join } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { personaConfigPath, projectPersonaConfigPath, readPersonaMode, writePersonaMode } from "./jero-ai-persona-config.ts";
import { PERSONA_OPTIONS } from "./jero-ai-prompts.ts";


export async function handlePersonaCommand(ctx: ExtensionContext): Promise<void> {
	const current = readPersonaMode(ctx.cwd);
	const selected = await ctx.ui.select(
		`el Jero persona (current: ${current})`,
		[...PERSONA_OPTIONS],
	);
	if (selected !== "gentleman" && selected !== "neutral") return;
	const writtenPaths = writePersonaMode(ctx.cwd, selected);
	ctx.ui.notify(
		[
			`el Jero 人格模式已设为：${selected}`,
			`全局配置：${personaConfigPath(ctx.cwd)}`,
			...(writtenPaths.length > 1
				? [`项目覆盖已更新：${projectPersonaConfigPath(ctx.cwd)}`]
				: []),
			"运行 /reload 或开启新的 Pi 会话，让已注入的提示词刷新。",
		].join("\n"),
		"info",
	);
}

// ---------------------------------------------------------------------------
// 评审门辅助函数 —— 纯函数，经 __testing 导出供单元测试使用
// ---------------------------------------------------------------------------

