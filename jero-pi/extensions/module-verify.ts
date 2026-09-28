import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { existsSync, mkdirSync, readFileSync, readdirSync, watch, writeFileSync, type FSWatcher } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
	ensureAtlIgnored,
	shouldSkipDuplicateExtensionLoad,
} from "../lib/skill-registry-engine.ts";
import {
	compileDispatchOverlay,
	discoverModules,
	renderOverlayMarkdown,
	walkRepoFiles,
	type DiscoveredModule,
} from "../lib/module-trigger-compiler.ts";
import { verifyModule, type ModuleVerifyReport } from "../lib/module-contract.ts";

// module-verify 扩展：契约与编译器在 lib/（module-contract /
// module-trigger-compiler），这里只做生命周期装配——发现项目 + 全局模块根，
// 安装验证（八查），编译派发覆盖层到 .atl/module-overlay.md（自动生成物），
// 并对模块根做尽力而为的变更监视。

const MODULES_REL_DIR = join(".pi", "modules");
const GLOBAL_MODULES_REL_DIR = join(".pi", "agent", "modules");
const OVERLAY_REL_PATH = join(".atl", "module-overlay.md");
const WATCH_DEBOUNCE_MS = 500;

interface ModuleRunResult {
	readonly reports: readonly ModuleVerifyReport[];
	readonly overlayWritten: boolean;
	readonly brokenModules: readonly {
		readonly dirName: string;
		readonly issues: readonly { readonly code: string; readonly message: string }[];
	}[];
}

function moduleRoots(cwd: string): string[] {
	return [join(cwd, MODULES_REL_DIR), join(homedir(), GLOBAL_MODULES_REL_DIR)];
}

function anyModuleRootExists(cwd: string): boolean {
	return moduleRoots(cwd).some((root) => existsSync(root));
}

// 项目 .pi/skills/ 下的松散技能名——no-loose-duplicate 查的数据源。
function looseSkillTokens(cwd: string): string[] | undefined {
	const skillsDir = join(cwd, ".pi", "skills");
	try {
		return readdirSync(skillsDir, { withFileTypes: true })
			.filter((entry) => entry.isDirectory())
			.map((entry) => entry.name);
	} catch {
		// 无松散技能目录是正常态；该检查以 skip 呈现。
		return undefined;
	}
}

// 全流程：发现（项目 + 全局双根）→ 逐模块安装验证（含 entry 行数门与双轨
// 查）→ 编译覆盖层 → 落盘。结构解析失败的模块不进覆盖层（fail-loud 转给
// 用户），但不阻断其余模块。
function runModulePipeline(cwd: string): ModuleRunResult {
	const roots = moduleRoots(cwd);
	const discovered: { root: string; found: DiscoveredModule }[] = [];
	for (const root of roots) {
		for (const found of discoverModules(root)) discovered.push({ root, found });
	}
	const walked = walkRepoFiles(cwd);
	const loose = looseSkillTokens(cwd);
	const reports: ModuleVerifyReport[] = [];
	const brokenModules: {
		readonly dirName: string;
		readonly issues: readonly { readonly code: string; readonly message: string }[];
	}[] = [];
	const manifests = [];
	const allTokens = discovered
		.map((item) => item.found.manifest?.token)
		.filter((token): token is string => token !== undefined);

	for (const { root, found } of discovered) {
		if (found.manifest === undefined) {
			brokenModules.push({ dirName: found.dirName, issues: found.issues });
			continue;
		}
		const manifest = found.manifest;
		const needsEntry = Object.values(manifest.bindings).some((binding) => binding?.inject === "entry");
		let entryText: string | undefined;
		if (needsEntry) {
			try {
				entryText = readFileSync(join(root, found.dirName, manifest.knowledge.entry), "utf8");
			} catch {
				entryText = undefined;
			}
		}
		reports.push(
			verifyModule({
				manifest,
				entryText,
				repoFiles: walked.files,
				otherTokens: allTokens.filter((token) => token !== manifest.token),
				looseSkillTokens: loose,
			}),
		);
		manifests.push(manifest);
	}

	const overlay = compileDispatchOverlay(manifests, walked.files);
	let overlayWritten = false;
	if (manifests.length > 0) {
		const atlDir = join(cwd, ".atl");
		mkdirSync(atlDir, { recursive: true });
		writeFileSync(join(cwd, OVERLAY_REL_PATH), renderOverlayMarkdown(overlay), "utf8");
		overlayWritten = true;
	}
	return { reports, overlayWritten, brokenModules };
}

function summarize(result: ModuleRunResult): string {
	const lines: string[] = [];
	if (result.reports.length === 0 && result.brokenModules.length === 0) {
		return `未发现能力模块（项目 .pi/modules/ 与全局 ~/.pi/agent/modules/ 均无 module.json）——松散技能/代理仍按 legacy 路径工作`;
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
	if (result.overlayWritten) lines.push(`覆盖层已写入 ${OVERLAY_REL_PATH}`);
	return lines.join("\n");
}

// 模块根变更监视（尽力而为）：防抖后重编译覆盖层。不支持 watch 的环境退回
// session_start / 手动命令刷新。
const overlayWatchers: FSWatcher[] = [];
let overlayWatchTimer: ReturnType<typeof setTimeout> | undefined;

function startOverlayWatcher(cwd: string, notify: (message: string) => void): void {
	for (const root of moduleRoots(cwd)) {
		if (!existsSync(root)) continue;
		try {
			overlayWatchers.push(
				watch(root, { recursive: true }, () => {
					if (overlayWatchTimer) clearTimeout(overlayWatchTimer);
					overlayWatchTimer = setTimeout(() => {
						try {
							runModulePipeline(cwd);
							notify("Module overlay refreshed");
						} catch (error) {
							// 监视器保持尽力而为；手动命令会呈现详细失败。
							notify(`Module overlay refresh failed: ${error instanceof Error ? error.message : String(error)}`);
						}
					}, WATCH_DEBOUNCE_MS);
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

export default function (pi: ExtensionAPI) {
	if (shouldSkipDuplicateExtensionLoad(import.meta.url)) return;

	pi.on("session_shutdown", () => {
		closeOverlayWatchers();
	});

	pi.on("session_start", async (_event, ctx) => {
		if (!anyModuleRootExists(ctx.cwd)) return;
		try {
			await ensureAtlIgnored(ctx.cwd);
			runModulePipeline(ctx.cwd);
			if (ctx.hasUI) {
				startOverlayWatcher(ctx.cwd, (message) => ctx.ui.notify(message, "info"));
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
				const result = runModulePipeline(ctx.cwd);
				ctx.ui.notify(summarize(result), result.reports.some((report) => !report.ok) || result.brokenModules.length > 0 ? "warning" : "info");
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				ctx.ui.notify(`Module verify failed: ${message}`, "warning");
			}
		},
	});
}
