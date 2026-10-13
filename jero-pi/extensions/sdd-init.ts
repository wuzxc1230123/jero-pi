import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { applySavedModelConfig } from "../lib/jero-ai-model-routing-apply.ts";
import { readSddPreflightFromDisk } from "../lib/sdd-preflight.ts";
import { ensureSddPreflight, installPackageAssets } from "../lib/sdd-preflight.ts";
import { runSddAutoInit, runSddInitCommand, type SddInitCtx, type SddInitDeps, type SddInitPrefs } from "../lib/sdd-init-command.ts";

// jero-sdd-init 扩展：编排与断言在 lib/sdd-init-command.ts（预检注入可测），
// 这里只做命令注册、会话启动强制初始化接线与真宿主依赖装配。

function makeDeps(pi: ExtensionAPI): SddInitDeps {
	return {
		ensureSddPreflight: (commandCtx) =>
			ensureSddPreflight(
				commandCtx as never,
				{
					pi,
					installAssets: (cwd: string) => installPackageAssets(cwd, true, ["sdd"]),
					applyModelConfig: () => applySavedModelConfig(commandCtx as never),
				},
				{ promptFields: [] },
			) as Promise<SddInitPrefs>,
	};
}

export default function (pi: ExtensionAPI) {
	pi.registerCommand("jero-sdd-init", {
		description:
			"Auto-detect project stack and bootstrap openspec/config.yaml for SDD.",
		handler: async (_args: string, ctx: SddInitCtx & { cwd: string }) => {
			await runSddInitCommand(ctx, makeDeps(pi));
		},
	});

	// SDD 强制档（脚手架专用面）：项目首次会话自动落 openspec/config.yaml
	// + specs/ 脚手架（缺席才执行，幂等；已就位零成本）。SDD 管理资产保持
	// 懒加载不变量（新会话不预装——首次 SDD 使用经预检安装，SDK 懒发现
	// 测试钉住的行为），因此此处只做文件系统操作：在 session_start 内同步
	// await、绝不延后触碰会话 ctx（SDK 会话替换后延后闭包访问 stale ctx
	// 会崩溃——全量测试实证）。JERO_PI_SDD_AUTOINIT=0 显式退出（清单见
	// jero-reference「契约与环境」）。
	pi.on("session_start", async (_event, ctx) => {
		if (process.env.JERO_PI_SDD_AUTOINIT === "0") return;
		try {
			await runSddAutoInit(
				ctx,
				{ readArtifactStore: (cwd) => readSddPreflightFromDisk(cwd)?.artifactStore ?? "openspec" },
				true,
			);
		} catch (error) {
			if (ctx.hasUI) {
				ctx.ui.notify(
					`SDD 自动初始化失败（可用 /jero-sdd-init 手动重试）：${error instanceof Error ? error.message : String(error)}`,
					"warning",
				);
			}
		}
	});
}

