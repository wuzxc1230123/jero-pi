import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { existsSync, watch, type FSWatcher } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { ensureAtlIgnored } from "../lib/skill-registry-engine.ts";
import {
	anyModuleRootExists,
	runModuleVerifyPipeline,
	type VerifyPipelineResult,
} from "../lib/module-verify-pipeline.ts";

// module-verify 扩展：管线（发现/八查/覆盖层落盘与清理）在
// lib/module-verify-pipeline.ts，这里只做生命周期装配与 UI 汇总。
// 重活（全仓扫描）一律 setImmediate 延后——会话启动绝不等待仓库扫描。

// 首载守卫（进程级，本扩展私有）：同进程只装配一次，防止项目本地副本与
// 包副本双装配导致监视器/命令重复注册。刻意不用 skill-registry 的守卫——
// 那条"项目本地 skill-registry 胜出"规则会把无关扩展一并跳过。
declare global {
	// eslint-disable-next-line no-var
	var jeroPiModuleVerifyAssembledSource: string | undefined;
}

function shouldSkipAssembly(): boolean {
	if (globalThis.jeroPiModuleVerifyAssembledSource !== undefined) return true;
	globalThis.jeroPiModuleVerifyAssembledSource = import.meta.url;
	return false;
}

const WATCH_DEBOUNCE_MS = 500;

function summarize(result: VerifyPipelineResult): string {
	const lines: string[] = [];
	if (result.reports.length === 0 && result.brokenModules.length === 0) {
		return result.overlayRemoved
			? "未发现能力模块（项目 .pi/modules/ 与全局 ~/.pi/agent/modules/ 均无 module.json）；已清理残留覆盖层"
			: "未发现能力模块（项目 .pi/modules/ 与全局 ~/.pi/agent/modules/ 均无 module.json）——松散技能/代理仍按 legacy 路径工作";
	}
	for (const report of result.reports) {
		const failed = report.checks.filter((item) => item.status === "fail");
		lines.push(
			failed.length === 0
				? `✓ ${report.token}：${report.checks.filter((item) => item.status === "pass").length} 项通过`
				: `✗ ${report.token}：${failed.map((item) => `${item.id}（${item.detail}）`).join("；")}`,
		);
	}
	for (const broken of result.brokenModules) {
		lines.push(`✗ ${broken.dirName}：清单解析失败——${broken.issues.map((item) => item.message).join("；")}`);
	}
	if (result.overlayWritten) lines.push("覆盖层已写入 .atl/module-overlay.md");
	if (result.walkTruncated) lines.push("⚠ 仓库文件扫描已截断，触发判定可能假阴性");
	return lines.join("\n");
}

// 模块根变更监视（尽力而为）：防抖后延后重编译覆盖层。不支持 recursive
// watch 的环境自动退回 session_start / 手动命令刷新。
const overlayWatchers: FSWatcher[] = [];
let overlayWatchTimer: ReturnType<typeof setTimeout> | undefined;

function scheduleOverlayRefresh(cwd: string, notify: (message: string) => void): void {
	if (overlayWatchTimer) clearTimeout(overlayWatchTimer);
	overlayWatchTimer = setTimeout(() => {
		setImmediate(() => {
			try {
				const result = runModuleVerifyPipeline(cwd);
				notify(result.walkTruncated ? "Module overlay refreshed (scan truncated)" : "Module overlay refreshed");
			} catch (error) {
				// 监视器保持尽力而为；手动命令会呈现详细失败。
				notify(`Module overlay refresh failed: ${error instanceof Error ? error.message : String(error)}`);
			}
		});
	}, WATCH_DEBOUNCE_MS);
}

function startOverlayWatcher(cwd: string, notify: (message: string) => void): void {
	for (const root of moduleRootsForWatch(cwd)) {
		try {
			overlayWatchers.push(
				watch(root, { recursive: true }, () => {
					scheduleOverlayRefresh(cwd, notify);
				}),
			);
		} catch {
			// 该根不可监视（权限/平台）：其余根继续。
		}
	}
}

function closeOverlayWatchers(): void {
	for (const watcher of overlayWatchers) watcher.close();
	overlayWatchers.length = 0;
	if (overlayWatchTimer) clearTimeout(overlayWatchTimer);
}

// 仅监听已存在的根；缺省的根出现要等下次会话/命令（与发现语义一致）。
function moduleRootsForWatch(cwd: string): string[] {
	return [join(cwd, ".pi", "modules"), join(homedir(), ".pi", "agent", "modules")].filter((root) =>
		existsSync(root),
	);
}

export default function (pi: ExtensionAPI) {
	if (shouldSkipAssembly()) return;

	pi.on("session_shutdown", () => {
		closeOverlayWatchers();
	});

	pi.on("session_start", async (_event, ctx) => {
		if (!anyModuleRootExists(ctx.cwd)) {
			// 无模块根也可能是"刚删光"：清残留覆盖层是廉价同步操作。
			setImmediate(() => {
				try {
					runModuleVerifyPipeline(ctx.cwd);
				} catch {
					// 清理尽力而为；命令会呈现详细失败。
				}
			});
			return;
		}
		try {
			await ensureAtlIgnored(ctx.cwd);
			if (ctx.hasUI) {
				startOverlayWatcher(ctx.cwd, (message) => ctx.ui.notify(message, "info"));
			}
			// 覆盖层缺失（首次运行/被清理）时同步编译——启动后第一次委托
			// 绝不能读到"无覆盖层"的空档；已有覆盖层时才延后刷新（陈旧窗口
			// 由审计协议的 name-unresolved 纠正步兜底）。
			const overlayMissing = !existsSync(join(ctx.cwd, ".atl", "module-overlay.md"));
			const refresh = () => {
				try {
					runModuleVerifyPipeline(ctx.cwd);
				} catch (error) {
					if (ctx.hasUI) {
						const message = error instanceof Error ? error.message : String(error);
						ctx.ui.notify(`Module overlay refresh failed: ${message}`, "warning");
					}
				}
			};
			if (overlayMissing) {
				// 同步路径：一次全仓扫描（≤2 万文件）值得换取首委托的正确性。
				refresh();
			} else {
				// 刷新延后：会话启动绝不等待仓库扫描（与 Shell 层同纪律）。
				setImmediate(refresh);
			}
		} catch (error) {
			// 启动路径尽力而为：覆盖层缺失时编排器按 legacy 路径工作，不阻断会话。
			if (ctx.hasUI) {
				const message = error instanceof Error ? error.message : String(error);
				ctx.ui.notify(`Module overlay refresh failed: ${message}`, "warning");
			}
		}
	});

	pi.registerCommand("jero-module-verify", {
		description: "Verify .pi/modules capability manifests and regenerate .atl/module-overlay.md.",
		handler: async (_args, ctx) => {
			try {
				await ensureAtlIgnored(ctx.cwd);
				const result = runModuleVerifyPipeline(ctx.cwd);
				ctx.ui.notify(summarize(result), result.reports.some((report) => !report.ok) || result.brokenModules.length > 0 ? "warning" : "info");
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				ctx.ui.notify(`Module verify failed: ${message}`, "warning");
			}
		},
	});
}
