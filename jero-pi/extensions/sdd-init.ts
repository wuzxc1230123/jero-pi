import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { applySavedModelConfig } from "../lib/jero-ai-model-routing-apply.ts";
import { ensureSddPreflight, installPackageAssets } from "../lib/sdd-preflight.ts";
import { runSddInitCommand, type SddInitCtx, type SddInitPrefs } from "../lib/sdd-init-command.ts";

// jero-sdd-init 扩展：编排与断言在 lib/sdd-init-command.ts（预检注入可测），
// 这里只做命令注册与真宿主依赖装配。

export default function (pi: ExtensionAPI) {
	pi.registerCommand("jero-sdd-init", {
		description:
			"Auto-detect project stack and bootstrap openspec/config.yaml for SDD.",
		handler: async (_args: string, ctx: SddInitCtx & { cwd: string }) => {
			await runSddInitCommand(ctx, {
				ensureSddPreflight: (commandCtx) =>
					ensureSddPreflight(
						commandCtx as never,
						{
							pi,
							installAssets: (cwd: string) => installPackageAssets(cwd, true, ["sdd"]),
							applyModelConfig: () => applySavedModelConfig(ctx as never),
						},
						{ promptFields: [] },
					) as Promise<SddInitPrefs>,
			});
		},
	});
}
