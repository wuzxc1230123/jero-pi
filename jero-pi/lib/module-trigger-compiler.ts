// 派发覆盖层编译器——静态触发器对仓库文件树的确定性匹配。
//
// 这是“添加即生效”的机制核心：模块是否适用由 glob 对文件树判定，
// 不经模型阅读理解。session_start / /jero-module-verify 调用本模块，
// 产出各编排面的注入计划；编排器与子代理消费 .atl/module-overlay.md
// （自动生成物，勿手改——与 .atl/skill-registry.md 同纪律）。

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
	BINDING_SURFACES,
	globToRegExp,
	parseModuleManifest,
	type BindingSurface,
	type InjectLevel,
	type ModuleManifest,
} from "./module-contract.ts";

export const MODULE_OVERLAY_ID = "jero.module-overlay/v1";

// 仓库文件扫描的忽略目录：依赖安装与 VCS 内部目录对触发判定是噪音。
export const OVERLAY_IGNORED_DIRS = new Set(["node_modules", ".git"]);

// 扫描上限：与 sdd-project-detect 的两万文件预算同量级，防超大仓库拖垮启动。
export const MAX_REPO_FILES = 20000;

export interface WalkedRepo {
	readonly files: readonly string[];
	readonly truncated: boolean;
}

// 仓库扫描 TTL 缓存：会话内 verify 命令与监视器刷新频繁复用同一份文件
// 树。30 秒上限把陈旧窗口钉死在"一次模块编辑的粒度"内——超时宁可重扫。
export const REPO_WALK_CACHE_TTL_MS = 30_000;

const repoWalkCache = new Map<string, { walked: WalkedRepo; at: number }>();
const repoWalkStats = { hits: 0, misses: 0 };

export function repoWalkCacheStats(): { readonly hits: number; readonly misses: number } {
	return { ...repoWalkStats };
}

export function clearRepoWalkCache(): void {
	repoWalkCache.clear();
}

/** 递归收集仓库相对路径（正斜杠），忽略依赖/VCS 目录，超限截断。结果按 cwd 做 TTL 缓存。 */
export function walkRepoFiles(cwd: string, ignoredDirs: Set<string> = OVERLAY_IGNORED_DIRS): WalkedRepo {
	const cached = repoWalkCache.get(cwd);
	if (cached !== undefined && Date.now() - cached.at < REPO_WALK_CACHE_TTL_MS) {
		repoWalkStats.hits += 1;
		return cached.walked;
	}
	repoWalkStats.misses += 1;
	const files: string[] = [];
	let truncated = false;
	const visit = (dir: string, prefix: string): void => {
		if (files.length >= MAX_REPO_FILES) {
			truncated = true;
			return;
		}
		let entries;
		try {
			entries = readdirSync(dir, { withFileTypes: true });
		} catch {
			// 不可读目录（权限/竞态）对触发判定是盲区而非失败，跳过。
			return;
		}
		for (const entry of entries) {
			if (files.length >= MAX_REPO_FILES) {
				truncated = true;
				return;
			}
			const rel = prefix.length === 0 ? entry.name : `${prefix}/${entry.name}`;
			if (entry.isDirectory()) {
				if (!ignoredDirs.has(entry.name)) visit(join(dir, entry.name), rel);
			} else if (entry.isFile()) {
				files.push(rel);
			}
		}
	};
	visit(cwd, "");
	const walked: WalkedRepo = { files, truncated };
	repoWalkCache.set(cwd, { walked, at: Date.now() });
	return walked;
}

export interface ActiveModule {
	readonly token: string;
	readonly matchedBy: readonly string[];
	readonly manifest: ModuleManifest;
}

export interface SurfaceInjection {
	readonly surface: BindingSurface;
	readonly entries: readonly {
		readonly token: string;
		readonly inject: InjectLevel;
		readonly appendRoles: readonly string[];
	}[];
}

export interface DispatchOverlay {
	readonly contract: typeof MODULE_OVERLAY_ID;
	readonly activeModules: readonly ActiveModule[];
	readonly inactiveTokens: readonly string[];
	readonly surfaces: readonly SurfaceInjection[];
	readonly strictTdd: {
		readonly command?: string;
		readonly fromToken?: string;
		readonly conflicts: readonly string[];
	};
	/** 活动模块声明的 C 级硬门（响亮的缺席：渲染明示，缺席不静默）。 */
	readonly declaredGates: readonly { readonly token: string; readonly gate: string }[];
	readonly issues: readonly string[];
}

/** 静态触发判定 + 各面注入计划编译。routing 的 slip 条件留给编排器按路由单求值。 */
export function compileDispatchOverlay(
	manifests: readonly ModuleManifest[],
	repoFiles: readonly string[],
): DispatchOverlay {
	const active: ActiveModule[] = [];
	const inactive: string[] = [];
	const issues: string[] = [];

	for (const manifest of manifests) {
		const matchedBy: string[] = [];
		for (const glob of manifest.triggers.files) {
			const re = globToRegExp(glob);
			if (repoFiles.some((file) => re.test(file))) matchedBy.push(glob);
		}
		if (matchedBy.length > 0) active.push({ token: manifest.token, matchedBy, manifest });
		else inactive.push(manifest.token);
	}

	const surfaces: SurfaceInjection[] = [];
	for (const surface of BINDING_SURFACES) {
		const entries = [];
		for (const module of active) {
			const binding = module.manifest.bindings[surface];
			if (binding === undefined) continue;
			for (const role of binding.appendRoles) {
				if (!module.manifest.roles.some((candidate) => candidate.name === role)) {
					issues.push(`模块 ${module.token} 在 ${surface} 面追加的角色 ${role} 未在本模块声明`);
				}
			}
			entries.push({ token: module.token, inject: binding.inject, appendRoles: binding.appendRoles });
		}
		if (entries.length > 0) surfaces.push({ surface, entries });
	}

	const testCommandSources = active
		.filter((module) => module.manifest.config?.testCommand !== undefined)
		.map((module) => ({ token: module.token, command: module.manifest.config?.testCommand as string }));
	const first = testCommandSources[0];
	const conflicts = testCommandSources
		.filter((source) => source.command !== first?.command)
		.map((source) => source.token);
	if (testCommandSources.length > 1 && conflicts.length > 0) {
		issues.push(
			`多个活动模块钉了不同测试命令（${testCommandSources.map((source) => `${source.token}: ${source.command}`).join("; ")}），Strict TDD 转发取 ${first?.token} 的值，请人工消解`,
		);
	}

	const declaredGates = active
		.filter((module) => module.manifest.pipeline !== undefined)
		.map((module) => ({ token: module.token, gate: module.manifest.pipeline?.gate as string }));

	return {
		contract: MODULE_OVERLAY_ID,
		activeModules: active,
		inactiveTokens: inactive,
		surfaces,
		strictTdd: {
			command: first?.command,
			fromToken: first?.token,
			conflicts,
		},
		declaredGates,
		issues,
	};
}

/** 渲染 .atl/module-overlay.md（自动生成物）。编排器与子代理按面消费此表。 */
export function renderOverlayMarkdown(overlay: DispatchOverlay): string {
	const lines: string[] = [];
	lines.push("# 模块派发覆盖层（自动生成物，勿手改）");
	lines.push("");
	lines.push(`契约：\`${MODULE_OVERLAY_ID}\`。由静态触发器对仓库文件树确定性编译（\`/jero-module-verify\` 刷新）。`);
	lines.push("知识注入按面执行：\`manifest-only\` = 只暴露存在与触发词；\`entry\` = 注入 entry 正文；深度知识一律在 references 由子代理按需读。");
	lines.push("");

	lines.push("## 活动模块");
	if (overlay.activeModules.length === 0) {
		lines.push("（无——本仓库没有命中任何模块的静态触发器）");
	} else {
		for (const module of overlay.activeModules) {
			lines.push(`- \`${module.token}\`：命中 ${module.matchedBy.map((glob) => `\`${glob}\``).join("、")}`);
		}
	}
	lines.push("");

	lines.push("## 各编排面注入计划");
	if (overlay.surfaces.length === 0) {
		lines.push("（无接线）");
	} else {
		lines.push("| 编排面 | 模块 | 注入档位 | 追加角色 |");
		lines.push("| --- | --- | --- | --- |");
		for (const surface of overlay.surfaces) {
			for (const entry of surface.entries) {
				lines.push(
					`| ${surface.surface} | ${entry.token} | ${entry.inject} | ${entry.appendRoles.join(", ") || "—"} |`,
				);
			}
		}
	}
	lines.push("");

	lines.push("## Strict TDD 命令");
	if (overlay.strictTdd.command === undefined) {
		lines.push("（无模块钉测试命令，SDD 走 config.yaml → 探测兜底）");
	} else {
		lines.push(`\`${overlay.strictTdd.command}\`（来自模块 \`${overlay.strictTdd.fromToken}\`）——sdd-apply / sdd-verify 启动提示优先携带此命令。`);
		if (overlay.strictTdd.conflicts.length > 0) {
			lines.push(`冲突：${overlay.strictTdd.conflicts.join("、")} 钉了不同命令，须人工消解。`);
		}
	}
	lines.push("");

	if (overlay.declaredGates.length > 0) {
		lines.push("## 硬门声明（C 级）");
		for (const gate of overlay.declaredGates) {
			lines.push(`- 模块 \`${gate.token}\` 要求机制性必跑：\`${gate.gate}\`。硬保证唯一路径是进包加链；未安装时编排器**不得静默跳过**——每次该场景都应报告缺席。`);
		}
		lines.push("");
	}

	lines.push("## 角色委派路由（供编排器按路由单求值）");
	const routingRows = overlay.activeModules.flatMap((module) =>
		module.manifest.routing.map((rule) => ({ token: module.token, rule })),
	);
	if (routingRows.length === 0) {
		lines.push("（无）");
	} else {
		lines.push("| 模块 | 条件 | 动作 | 目标角色 |");
		lines.push("| --- | --- | --- | --- |");
		for (const row of routingRows) {
			const condition = row.rule.when.surface !== undefined
				? `surface=${row.rule.when.surface}`
				: `slip=${JSON.stringify(row.rule.when.slip)}`;
			lines.push(`| ${row.token} | ${condition} | ${row.rule.action} | ${row.rule.target} |`);
		}
		lines.push("");
		lines.push("动作语义：`suggest-role` = 提示层建议（审计留痕）；`delegate-role` = 编排器应尝试委派并在结果封套回报 `module_resolution.delegation`。条件命中前都必须有本模块静态触发命中。");
	}
	lines.push("");

	if (overlay.inactiveTokens.length > 0) {
		lines.push("## 已声明但未触发");
		for (const token of overlay.inactiveTokens) {
			lines.push(`- \`${token}\`：静态触发器在本仓库零命中，不参与任何编排面。`);
		}
		lines.push("");
	}

	if (overlay.issues.length > 0) {
		lines.push("## 编译告警");
		for (const message of overlay.issues) {
			lines.push(`- ${message}`);
		}
		lines.push("");
	}

	return lines.join("\n");
}

export interface DiscoveredModule {
	readonly dirName: string;
	readonly manifest?: ModuleManifest;
	/** 解析失败时的结构问题（原样转给用户，安装期显式失败）。 */
	readonly issues: readonly { readonly code: string; readonly message: string }[];
}

/** 发现约定目录下的模块：`{modulesRoot}/{token}/module.json`；接受多根（项目 + 全局）。 */
export function discoverModules(modulesRoot: string | readonly string[]): DiscoveredModule[] {
	const roots = Array.isArray(modulesRoot) ? modulesRoot : [modulesRoot];
	const discovered: DiscoveredModule[] = [];
	for (const root of roots) {
		let entries;
		try {
			entries = readdirSync(root, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const entry of entries) {
			if (!entry.isDirectory()) continue;
			const manifestPath = join(root, entry.name, "module.json");
			let raw: string;
			try {
				raw = readFileSync(manifestPath, "utf8");
			} catch {
				// 目录存在但无 module.json：不是模块目录（允许放 references 等辅助目录）。
				continue;
			}
			const parsed = parseModuleManifest(raw);
			discovered.push({
				dirName: entry.name,
				manifest: parsed.manifest,
				issues: parsed.issues.map((item) => ({ code: item.code, message: `${item.path}: ${item.message}` })),
			});
		}
	}
	return discovered;
}
