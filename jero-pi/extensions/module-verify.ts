import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { existsSync, watch, type FSWatcher } from "node:fs";
import { join } from "node:path";
import { ensureAtlIgnored } from "../lib/skill-registry-engine.ts";
import {
	anyModuleRootExists,
	runModuleVerifyPipeline,
	type VerifyPipelineResult,
} from "../lib/module-verify-pipeline.ts";
import {
	agentMcpJsonPath,
	bundleModulesRoot,
	discoverBundles,
	installBundle,
	readModuleInstalls,
	resolveInstallPlan,
} from "../lib/module-installer.ts";

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
			? "未发现能力模块（项目 .pi/modules/ 无 module.json）；已清理残留覆盖层"
			: "未发现能力模块（项目 .pi/modules/ 无 module.json）——可装模块用 /jero:module-list 查看；松散技能/代理仍按 legacy 路径工作";
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

// 仅监听已存在的根；根的出现要等下次会话/命令（与发现语义一致）。
// 模块只装在项目内（无全局根可监听）。
function moduleRootsForWatch(cwd: string): string[] {
	return [join(cwd, ".pi", "modules")].filter((root) => existsSync(root));
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

	// 模块安装的受支持入口：包内模块库（assets/modules）→ 项目 .pi/，依赖
	// 闭包自动先装。域逻辑在 lib/module-installer.ts，这里只做装配与汇总。
	pi.registerCommand("jero:install-module", {
		description: "Install package module bundle(s) into this project (.pi/modules, .pi/agents, .pi/skills) with automatic dependency resolution. Usage: /jero:install-module <token>... [--force].",
		handler: async (args, ctx) => {
			try {
				const raw = typeof args === "string" ? args : "";
				const force = raw.includes("--force");
				const tokens = raw.split(/\s+/).filter((part) => part.length > 0 && part !== "--force");
				if (tokens.length === 0) {
					ctx.ui.notify("用法：/jero:install-module <词元>... [--force]（可装模块用 /jero:module-list 查看）", "warning");
					return;
				}
				const { bundles, broken } = discoverBundles(bundleModulesRoot());
				const byToken = new Map(bundles.map((bundle) => [bundle.token, bundle]));
				const installs = readModuleInstalls(ctx.cwd);
				const installedVersions = new Map(
					Object.entries(installs.modules).map(([token, record]) => [token, record.version]),
				);
				const plan = resolveInstallPlan(bundles, tokens, installedVersions);
				if (!plan.ok) {
					ctx.ui.notify(`安装计划失败（${plan.reason}）：${plan.detail}`, "warning");
					return;
				}
				const lines: string[] = [];
				let anyInstalled = false;
				for (const step of plan.steps) {
					const bundle = byToken.get(step.token);
					if (bundle === undefined) continue;
					// 声明了 mcp 的束在此合并写入 Pi agent mcp.json（幂等、同名用户档不覆盖）。
					const outcome = installBundle(ctx.cwd, bundle, { force, agentMcpJson: agentMcpJsonPath() });
					if (outcome.kind === "installed") {
						anyInstalled = true;
						lines.push(`+ ${outcome.detail}`);
					} else {
						lines.push(`= ${outcome.token}：${outcome.detail}`);
					}
				}
				if (anyInstalled || broken.length > 0) {
					await ensureAtlIgnored(ctx.cwd);
					const result = runModuleVerifyPipeline(ctx.cwd);
					lines.push("", ...summarize(result).split("\n"));
				}
				ctx.ui.notify(lines.join("\n"), "info");
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				ctx.ui.notify(`Module install failed: ${message}`, "warning");
			}
		},
	});

	pi.registerCommand("jero:module-list", {
		description: "List installable module bundles in the package library with versions, dependencies and project install status.",
		handler: async (_args, ctx) => {
			try {
				const { bundles, broken } = discoverBundles(bundleModulesRoot());
				if (bundles.length === 0 && broken.length === 0) {
					ctx.ui.notify("包内模块库为空（assets/modules/）", "info");
					return;
				}
				const installs = readModuleInstalls(ctx.cwd);
				const lines = ["可安装模块（装到项目 .pi/，依赖自动先装）："];
				for (const bundle of [...bundles].toSorted((left, right) => left.token.localeCompare(right.token))) {
					const record = installs.modules[bundle.token];
					const dirExists = existsSync(join(ctx.cwd, ".pi", "modules", bundle.token));
					const status = record !== undefined
						? `已装 ${record.version}`
						: dirExists
							? "目录存在但无安装记录（手工安装）"
							: "未安装";
					const deps = bundle.dependencies.length > 0 ? bundle.dependencies.join("、") : "无";
					// MCP 档披露按账本分层：未装=装时自动并入；已装且来源账本在录=已并入；
					// 已装但账本缺（装在特性前的旧装）=提示重跑补档（文件在否状态归 doctor）。
					const mcpServers = bundle.manifest.mcp?.servers ?? [];
					let mcpLabel = "";
					if (mcpServers.length > 0) {
						const names = mcpServers.map((server) => server.name).join("、");
						if (record === undefined) {
							mcpLabel = `｜MCP：${names}（装时自动并入）`;
						} else {
							const ledger = record.mcpWritten ?? [];
							const allLedgered = mcpServers.every((server) => ledger.some((item) => item.name === server.name));
							mcpLabel = `｜MCP：${names}（${allLedgered ? "已并入，账本在录" : "未入账本——重跑安装补档"}）`;
						}
					}
					lines.push(`- ${bundle.token}@${bundle.version}｜${status}｜依赖：${deps}${mcpLabel}｜${bundle.description ?? ""}`);
				}
				for (const item of broken) {
					lines.push(`✗ ${item.dirName}：清单解析失败——${item.issues.map((issue) => issue.message).join("；")}`);
				}
				lines.push("安装：/jero:install-module <词元>（依赖自动先装；--force 强制重装）");
				ctx.ui.notify(lines.join("\n"), broken.length > 0 ? "warning" : "info");
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				ctx.ui.notify(`Module list failed: ${message}`, "warning");
			}
		},
	});
}
