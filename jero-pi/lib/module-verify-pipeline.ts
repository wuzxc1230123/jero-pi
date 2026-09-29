// 模块验证管线——发现（项目 + 全局双根）→ 安装验证（八查）→ 编译覆盖层
// → 落盘/清理。扩展（extensions/module-verify.ts）只做生命周期装配，本模块
// 承载全部可测业务逻辑。
//
// 陈旧覆盖层纪律：任一模块根存在就**总是**重写覆盖层（含零模块的空态）；
// 模块根全部消失时删除残留覆盖层——编排器绝不能消费过期的接线数据。

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { verifyModule, type ModuleManifest, type ModuleVerifyReport } from "./module-contract.ts";
import {
	compileDispatchOverlay,
	discoverModules,
	renderOverlayMarkdown,
	walkRepoFiles,
	type DiscoveredModule,
} from "./module-trigger-compiler.ts";

export const MODULES_REL_DIR = join(".pi", "modules");
export const GLOBAL_MODULES_REL_DIR = join(".pi", "agent", "modules");
export const OVERLAY_REL_PATH = join(".atl", "module-overlay.md");

export function projectModulesRoot(cwd: string): string {
	return join(cwd, MODULES_REL_DIR);
}

export function globalModulesRoot(): string {
	return join(homedir(), GLOBAL_MODULES_REL_DIR);
}

export function moduleRoots(cwd: string): string[] {
	return [projectModulesRoot(cwd), globalModulesRoot()];
}

export function anyModuleRootExists(cwd: string): boolean {
	return moduleRoots(cwd).some((root) => existsSync(root));
}

// 项目 .pi/skills/ 下的松散技能名——no-loose-duplicate 查的数据源。
export function looseSkillTokens(cwd: string): string[] | undefined {
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

export interface BrokenModule {
	readonly dirName: string;
	readonly issues: readonly { readonly code: string; readonly message: string }[];
}

export interface VerifyPipelineResult {
	readonly reports: readonly ModuleVerifyReport[];
	readonly brokenModules: readonly BrokenModule[];
	/** 本次是否写出了覆盖层（含空态）。 */
	readonly overlayWritten: boolean;
	/** 模块根全部消失时是否清掉了残留覆盖层。 */
	readonly overlayRemoved: boolean;
	/** 仓库扫描是否触到上限截断（触发判定可能是假阴性）。 */
	readonly walkTruncated: boolean;
}

function overlayPath(cwd: string): string {
	return join(cwd, OVERLAY_REL_PATH);
}

function removeStaleOverlay(cwd: string): boolean {
	try {
		rmSync(overlayPath(cwd), { force: true });
		return true;
	} catch {
		// 删除失败（占用/权限）：命令会另行报告；残留最多导致一次陈旧读取。
		return false;
	}
}

function readEntryText(root: string, dirName: string, manifest: ModuleManifest): string | undefined {
	try {
		return readFileSync(join(root, dirName, manifest.knowledge.entry), "utf8");
	} catch {
		return undefined;
	}
}

export interface VerifyPipelineOptions {
	/** 覆盖模块根（测试注入用）；缺省 = 项目 + 全局双根。 */
	readonly roots?: readonly string[];
}

/**
 * 全流程。无模块根时短路（只清理残留覆盖层，不扫仓库）；有根时总是重写
 * 覆盖层——零模块写空态，坏清单不进编译但报给用户，绝不留陈旧接线。
 */
export function runModuleVerifyPipeline(cwd: string, options: VerifyPipelineOptions = {}): VerifyPipelineResult {
	const roots = options.roots ?? moduleRoots(cwd);
	const anyRoot = roots.some((root) => existsSync(root));
	if (!anyRoot) {
		const overlayRemoved = existsSync(overlayPath(cwd)) ? removeStaleOverlay(cwd) : false;
		return { reports: [], brokenModules: [], overlayWritten: false, overlayRemoved, walkTruncated: false };
	}

	const discovered: { root: string; found: DiscoveredModule }[] = [];
	for (const root of roots) {
		for (const found of discoverModules(root)) discovered.push({ root, found });
	}
	const walked = walkRepoFiles(cwd);
	const loose = looseSkillTokens(cwd);
	const reports: ModuleVerifyReport[] = [];
	const brokenModules: BrokenModule[] = [];
	const manifests: ModuleManifest[] = [];
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
		reports.push(
			verifyModule({
				manifest,
				entryText: needsEntry ? readEntryText(root, found.dirName, manifest) : undefined,
				repoFiles: walked.files,
				repoFilesTruncated: walked.truncated,
				otherTokens: allTokens.filter((token) => token !== manifest.token),
				looseSkillTokens: loose,
			}),
		);
		manifests.push(manifest);
	}

	const overlay = compileDispatchOverlay(manifests, walked.files);
	mkdirSync(join(cwd, ".atl"), { recursive: true });
	writeFileSync(
		overlayPath(cwd),
		renderOverlayMarkdown(overlay, { repoFilesTruncated: walked.truncated }),
		"utf8",
	);
	return { reports, brokenModules, overlayWritten: true, overlayRemoved: false, walkTruncated: walked.truncated };
}
