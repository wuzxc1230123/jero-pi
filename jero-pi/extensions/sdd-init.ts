import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { applySavedModelConfig } from "../lib/jero-ai-model-routing-apply.ts";
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

	// SDD 强制档：每个项目的首次会话自动初始化（openspec/config.yaml
	// 缺席即跑完整 init：预检资产安装 + 技术栈探测 + 写盘）；已就位时
	// 零成本跳过，幂等。JERO_PI_SDD_AUTOINIT=0 显式退出（清单见
	// jero-reference「契约与环境」）。延后执行（setImmediate）——启动
	// 绝不等待仓库扫描，与模块覆盖层的 session_start 刷新同纪律。
	pi.on("session_start", async (_event, ctx) => {
		if (process.env.JERO_PI_SDD_AUTOINIT === "0") return;
		setImmediate(() => {
			runSddAutoInit(ctx, makeDeps(pi), true).catch((error) => {
				if (ctx.hasUI) {
					ctx.ui.notify(
						`SDD 自动初始化失败（可用 /jero-sdd-init 手动重试）：${error instanceof Error ? error.message : String(error)}`,
						"warning",
					);
				}
			});
		});
	});
}
