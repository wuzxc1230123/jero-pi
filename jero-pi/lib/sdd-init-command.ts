// sdd-init 命令编排——栈探测与写盘的业务逻辑，从扩展下沉至此以便测试：
// 预检经 deps 注入（真宿主装真实现，测试装 stub），与 module-verify-pipeline
// 同法。探测引擎本体在 lib/sdd-project-detect.ts。

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { CONFIG_REL_PATH, detectProject, ensureOpenSpecDirs, renderConfig } from "./sdd-project-detect.ts";

export interface SddInitCtx {
	readonly cwd: string;
	readonly hasUI: boolean;
	readonly ui: { notify: (message: string, level: "info" | "warning") => void };
}

export interface SddInitPrefs {
	readonly artifactStore: "openspec" | "engram" | "hybrid" | "none";
}

export interface SddInitDeps {
	/** 会话预检（真宿主实现：资产安装 + 模型应用 + 确认仪式）。 */
	readonly ensureSddPreflight: (ctx: SddInitCtx) => Promise<SddInitPrefs>;
}

/**
 * 命令主体。RPC/headless 宿主（hasUI=false）只做检测与写盘，绝不对
 * noOp ui 发通知。
 */
export async function runSddInitCommand(ctx: SddInitCtx, deps: SddInitDeps): Promise<void> {
	const notify = (message: string, level: "info" | "warning"): void => {
		if (ctx.hasUI) ctx.ui.notify(message, level);
	};
	const prefs = await deps.ensureSddPreflight(ctx);

	const detection = detectProject(ctx.cwd);
	const testSummary = detection.testCommand
		? `strict TDD enabled with \`${detection.testCommand}\``
		: "strict TDD disabled because no test runner was detected";
	const layerSummary = `unit: ${detection.commands.unit.length}, integration: ${detection.commands.integration.length}, e2e: ${detection.commands.e2e.length}`;

	const shouldCreateOpenSpec =
		prefs.artifactStore === "openspec" ||
		prefs.artifactStore === "hybrid";
	if (!shouldCreateOpenSpec) {
		notify(
			`SDD initialized for ${prefs.artifactStore}: detected ${detection.stack.join(", ") || "project"}; ${testSummary}; tests found: ${layerSummary}.`,
			"info",
		);
		return;
	}

	const configPath = join(ctx.cwd, CONFIG_REL_PATH);
	if (existsSync(configPath)) {
		notify(
			`${CONFIG_REL_PATH} already exists. Edit it manually or remove it before re-running /jero-sdd-init.`,
			"warning",
		);
		return;
	}

	ensureOpenSpecDirs(ctx.cwd);
	mkdirSync(dirname(configPath), { recursive: true });
	writeFileSync(configPath, renderConfig(detection));

	notify(
		`Wrote ${CONFIG_REL_PATH}: detected ${detection.stack.join(", ") || "project"}; ${testSummary}; tests found: ${layerSummary}.`,
		"info",
	);
}
