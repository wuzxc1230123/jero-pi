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

/** 递归收集仓库相对路径（正斜杠），忽略依赖/VCS 目录，超限截断。结果按 cwd 做 TTL 缓存；自定义忽略集不缓存（缓存键不含忽略集，避免串味）。 */
export function walkRepoFiles(cwd: string, ignoredDirs: Set<string> = OVERLAY_IGNORED_DIRS): WalkedRepo {
	const cacheable = ignoredDirs === OVERLAY_IGNORED_DIRS;
	const cached = cacheable ? repoWalkCache.get(cwd) : undefined;
	if (cached !== undefined && Date.now() - cached.at < REPO_WALK_CACHE_TTL_MS) {
		repoWalkStats.hits += 1;
		return cached.walked;
	}
	if (cacheable) repoWalkStats.misses += 1;
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
	if (cacheable) repoWalkCache.set(cwd, { walked, at: Date.now() });
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

export interface RoutingRuleRow {
	/** 稳定规则 ID：`{token}#{manifest 内序号}`——module_resolution 审计的机器锚点。 */
	readonly id: string;
	readonly token: string;
	readonly action: string;
	readonly target: string;
	/** 条件的人类可读形式（surface=… 或 slip=…）。 */
	readonly condition: string;
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
	/** 全部活动模块的路由规则平表（带稳定 ID，供审计验证器消费）。 */
	readonly routingTable: readonly RoutingRuleRow[];
	readonly issues: readonly string[];
}

// 输入序即优先序：管线保证项目根模块先于全局根、同根内按 token 字典序。
// 覆盖层的面注入顺序、追加角色去重（先见者胜）与路由表顺序全部继承它。
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

	const appendRoleOwners = new Map<string, string>();
	const surfaces: SurfaceInjection[] = [];
	for (const surface of BINDING_SURFACES) {
		const entries = [];
		for (const module of active) {
			const binding = module.manifest.bindings[surface];
			if (binding === undefined) continue;
			for (const role of binding.appendRoles) {
				if (!module.manifest.roles.some((candidate) => candidate.name === role)) {
					issues.push(`模块 ${module.token} 在 ${surface} 面追加的角色 ${role} 未在本模块声明`);
					continue;
				}
				const owner = appendRoleOwners.get(`${surface}:${role}`);
				if (owner !== undefined) {
					issues.push(`角色 ${role} 在 ${surface} 面被模块 ${owner} 与 ${module.token} 同时追加，取 ${owner}（项目根优先于全局根）`);
				} else {
					appendRoleOwners.set(`${surface}:${role}`, module.token);
				}
			}
			entries.push({ token: module.token, inject: binding.inject, appendRoles: binding.appendRoles });
		}
		if (entries.length > 0) surfaces.push({ surface, entries });
	}

	// 路由平表 + delegate 冲突检测：同面不同目标的 delegate 规则告警，先见者胜。
	const routingTable: RoutingRuleRow[] = [];
	const delegateBySurface = new Map<string, { token: string; target: string }>();
	for (const module of active) {
		for (const [index, rule] of module.manifest.routing.entries()) {
			const condition = rule.when.surface !== undefined
				? `surface=${rule.when.surface}`
				: `slip=${JSON.stringify(rule.when.slip)}`;
			routingTable.push({
				id: `${module.token}#${index}`,
				token: module.token,
				action: rule.action,
				target: rule.target,
				condition,
			});
			if (rule.when.surface !== undefined && rule.action === "delegate-role") {
				const existing = delegateBySurface.get(rule.when.surface);
				if (existing !== undefined && existing.target !== rule.target) {
					issues.push(`面 ${rule.when.surface} 上模块 ${existing.token}（→${existing.target}）与 ${module.token}（→${rule.target}）的 delegate 规则冲突，取 ${existing.token}（先见者胜，项目根优先）`);
				} else if (existing === undefined) {
					delegateBySurface.set(rule.when.surface, { token: module.token, target: rule.target });
				}
			}
		}
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
		routingTable,
		issues,
	};
}

/** 面上生效的追加角色（跨模块去重，先见者胜 = 项目根优先于全局根）。 */
export function effectiveSurfaceRoles(overlay: DispatchOverlay, surface: BindingSurface): readonly string[] {
	const roles: string[] = [];
	for (const entry of overlay.surfaces.find((candidate) => candidate.surface === surface)?.entries ?? []) {
		for (const role of entry.appendRoles) {
			if (!roles.includes(role)) roles.push(role);
		}
	}
	return roles;
}

export interface ModuleResolutionVerdict {
	readonly ok: boolean;
	readonly kind: "none" | "paths-injected" | "delegated" | "skipped" | "name-unresolved" | "invalid";
	readonly detail: string;
}

const DELEGATED_REPORT_PATTERN = /^delegated:([a-z][a-z0-9-]*)(?:@([a-z][a-z0-9-]*#[0-9]+))?$/;

/**
 * module_resolution 审计报告的机器验证 v1——把"约定回报"变成"可校验回报"：
 * 子代理按结果契约回报字符串，本函数对照覆盖层校验其真实性（角色存在、
 * 规则 ID 存在且目标一致）。`name-unresolved` 视为编排缺口（ok:false）。
 */
export function validateModuleResolutionReport(
	report: string,
	overlay: DispatchOverlay,
): ModuleResolutionVerdict {
	const value = report.trim();
	if (value === "none") return { ok: true, kind: "none", detail: "无活动模块或该面未接线" };
	if (value === "paths-injected") return { ok: true, kind: "paths-injected", detail: "按覆盖层档位注入" };
	if (value.startsWith("skipped:")) {
		return { ok: true, kind: "skipped", detail: value.slice("skipped:".length) };
	}
	if (value === "name-unresolved") {
		return { ok: false, kind: "name-unresolved", detail: "路由目标不可解析——按编排缺口纠正" };
	}
	const delegated = value.match(DELEGATED_REPORT_PATTERN);
	if (delegated === null) {
		return { ok: false, kind: "invalid", detail: `无法识别的 module_resolution 报告：${value}` };
	}
	const role = delegated[1] as string;
	const ruleId = delegated[2];
	const roleKnown = overlay.activeModules.some((module) =>
		module.manifest.roles.some((candidate) => candidate.name === role),
	);
	if (!roleKnown) {
		return { ok: false, kind: "invalid", detail: `报告的角色 ${role} 不在任何活动模块的 roles 中` };
	}
	if (ruleId !== undefined) {
		const rule = overlay.routingTable.find((candidate) => candidate.id === ruleId);
		if (rule === undefined) {
			return { ok: false, kind: "invalid", detail: `规则 ID ${ruleId} 不在覆盖层路由表中` };
		}
		if (rule.target !== role) {
			return { ok: false, kind: "invalid", detail: `规则 ${ruleId} 的目标是 ${rule.target}，与报告的角色 ${role} 不一致` };
		}
	}
	return { ok: true, kind: "delegated", detail: ruleId === undefined ? `委派 ${role}（未带规则 ID）` : `委派 ${role}（规则 ${ruleId}）` };
}

// markdown 表格单元格转义：值里的 | 会撕开表格列。
function mdCell(text: string): string {
	return text.replaceAll("|", "\\|");
}

export interface RenderOverlayOptions {
	/** 仓库扫描是否截断；截断时在覆盖层明示触发判定可能假阴性。 */
	readonly repoFilesTruncated?: boolean;
}

/** 渲染 .atl/module-overlay.md（自动生成物）。编排器与子代理按面消费此表。 */
export function renderOverlayMarkdown(
	overlay: DispatchOverlay,
	options: RenderOverlayOptions = {},
): string {
	const lines: string[] = [];
	lines.push("# 模块派发覆盖层（自动生成物，勿手改）");
	lines.push("");
	lines.push(`契约：\`${MODULE_OVERLAY_ID}\`。由静态触发器对仓库文件树确定性编译（\`/jero-module-verify\` 刷新）。`);
	lines.push("知识注入按面执行：\`manifest-only\` = 只暴露存在与触发词；\`entry\` = 注入 entry 正文；深度知识一律在 references 由子代理按需读。");
	if (options.repoFilesTruncated) {
		lines.push("");
		lines.push("**注意**：仓库文件扫描已触及上限截断——本覆盖层的触发判定可能假阴性（截掉的部分未参与匹配），超大仓库请人工复核。");
	}
	lines.push("");

	lines.push("## 活动模块");
	if (overlay.activeModules.length === 0) {
		lines.push("（无——本仓库没有命中任何模块的静态触发器）");
	} else {
		for (const module of overlay.activeModules) {
			lines.push(`- \`${mdCell(module.token)}\`：命中 ${module.matchedBy.map((glob) => `\`${mdCell(glob)}\``).join("、")}`);
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
					`| ${mdCell(surface.surface)} | ${mdCell(entry.token)} | ${mdCell(entry.inject)} | ${mdCell(entry.appendRoles.join(", ")) || "—"} |`,
				);
			}
		}
	}
	lines.push("");

	lines.push("## Strict TDD 命令");
	if (overlay.strictTdd.command === undefined) {
		lines.push("（无模块钉测试命令，SDD 走 config.yaml → 探测兜底）");
	} else {
		lines.push(`\`${mdCell(overlay.strictTdd.command)}\`（来自模块 \`${mdCell(overlay.strictTdd.fromToken ?? "")}\`）——sdd-apply / sdd-verify 启动提示优先携带此命令。`);
		if (overlay.strictTdd.conflicts.length > 0) {
			lines.push(`冲突：${overlay.strictTdd.conflicts.map(mdCell).join("、")} 钉了不同命令，须人工消解。`);
		}
	}
	lines.push("");

	if (overlay.declaredGates.length > 0) {
		lines.push("## 硬门声明（C 级）");
		for (const gate of overlay.declaredGates) {
			lines.push(`- 模块 \`${mdCell(gate.token)}\` 要求机制性必跑：\`${mdCell(gate.gate)}\`。硬保证唯一路径是进包加链；未安装时编排器**不得静默跳过**——每次该场景都应报告缺席。`);
		}
		lines.push("");
	}

	lines.push("## 角色委派路由（供编排器按路由单求值）");
	if (overlay.routingTable.length === 0) {
		lines.push("（无）");
	} else {
		lines.push("| 规则 ID | 模块 | 条件 | 动作 | 目标角色 |");
		lines.push("| --- | --- | --- | --- | --- |");
		for (const row of overlay.routingTable) {
			lines.push(`| ${mdCell(row.id)} | ${mdCell(row.token)} | ${mdCell(row.condition)} | ${mdCell(row.action)} | ${mdCell(row.target)} |`);
		}
		lines.push("");
		lines.push("动作语义：`suggest-role` = 提示层建议（审计留痕）；`delegate-role` = 编排器应尝试委派并在结果封套回报 `module_resolution`。条件命中前都必须有本模块静态触发命中。");
		lines.push("回报格式：`none` / `paths-injected` / `delegated:{角色}` / `delegated:{角色}@{规则 ID}` / `skipped:{原因}` / `name-unresolved`；带规则 ID 的回报可被机器校验（对照上表角色与目标）。");
		lines.push("优先序：项目根模块先于全局根、同根内按 token 字典序；同面追加角色与 delegate 冲突取先见者，冲突已在编译告警列出。");
	}
	lines.push("");

	if (overlay.inactiveTokens.length > 0) {
		lines.push("## 已声明但未触发");
		for (const token of overlay.inactiveTokens) {
			lines.push(`- \`${mdCell(token)}\`：静态触发器在本仓库零命中，不参与任何编排面。`);
		}
		lines.push("");
	}

	if (overlay.issues.length > 0) {
		lines.push("## 编译告警");
		for (const message of overlay.issues) {
			lines.push(`- ${mdCell(message)}`);
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
