import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { applySavedModelConfig } from "../lib/jero-ai-model-routing-apply.ts";
import { ensureSddPreflight, installPackageAssets } from "../lib/sdd-preflight.ts";
import { CONFIG_REL_PATH, detectProject, ensureOpenSpecDirs, renderConfig } from "../lib/sdd-project-detect.ts";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

// jero-sdd-init 扩展：栈探测引擎在 lib/sdd-project-detect.ts，
// 这里只做命令注册与预检/写盘编排。

export default function (pi: ExtensionAPI) {
	pi.registerCommand("jero-sdd-init", {
		description:
			"Auto-detect project stack and bootstrap openspec/config.yaml for SDD.",
		handler: async (_args: string, ctx: ExtensionContext) => {
			// 命令可在 RPC/headless 宿主中运行：无 UI 时只做检测与写盘，
			// 绝不对 noOp ui 上下文发通知。
			const notify = (message: string, level: "info" | "warning"): void => {
				if (ctx.hasUI) ctx.ui.notify(message, level);
			};
			const prefs = await ensureSddPreflight(ctx, { pi, installAssets: (cwd) => installPackageAssets(cwd, true, ["sdd"]), applyModelConfig: () => applySavedModelConfig(ctx) }, { promptFields: [] });

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
		},
	});
}
