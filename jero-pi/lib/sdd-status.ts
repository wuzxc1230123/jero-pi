import { existsSync, lstatSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import type { NativeSddStatusV2 } from "./authority/client-contract.ts";
import {
	detectActiveDomainCollisions,
	detectLegacyFlatSpec,
	type DomainCollision,
} from "./openspec-guardrails.ts";

// 权威命名与 gentle-ai 一致，该契约归 gentle-ai 所有。双存储
// 模式在此处曾名为 "both"；"hybrid" 是提供方对同一事物的命名，
// normalizeSddArtifactStore 保证已持久化的 "both" 仍可加载。
export type SddArtifactStore = "openspec" | "engram" | "hybrid" | "none";
export type ArtifactState = "missing" | "done" | "partial";
export type DependencyState = "blocked" | "ready" | "all_done" | "not_applicable";
export type ApplyState = "blocked" | "ready" | "all_done" | "not_applicable";
export type SddPhase = "apply" | "verify" | "sync" | "archive";
export type SddNextRecommended =
	| `sdd-${"propose" | "spec" | "design" | "tasks" | SddPhase}`
	| "fix-task-ownership-marker"
	| "archived"
	| "resolve-via-engram"
	| "blocked";

export interface SddArtifactPaths {
	proposal: string[];
	specs: string[];
	design: string[];
	tasks: string[];
	applyProgress: string[];
	verifyReport: string[];
	syncReport: string[];
}

export interface SddTaskProgress {
	total: number;
	complete: number;
	remaining: number;
	unchecked: string[];
}

const SDD_TASK_OWNER = {
	IMPLEMENTATION: "implementation",
	PARENT: "parent",
} as const;

type SddTaskOwner = (typeof SDD_TASK_OWNER)[keyof typeof SDD_TASK_OWNER];

interface SddTaskAccounting {
	implementation: SddTaskProgress;
	parent: SddTaskProgress;
	errors: string[];
}

const EMPTY_TASK_PROGRESS: SddTaskProgress = {
	total: 0,
	complete: 0,
	remaining: 0,
	unchecked: [],
};

export interface SddActionContext {
	mode: "repo-local";
	workspaceRoot: string;
	allowedEditRoots: string[];
	warnings: string[];
}

export interface SddDomainCollisionReport {
	domain: string;
	changes: DomainCollision[];
}

export interface SddPhaseInstructions {
	apply: string[];
	verify: string[];
	sync: string[];
	archive: string[];
}

export interface SddRelationships {
	dependsOn: string[];
	supersedes: string[];
	amends: string[];
	conflictsWith: string[];
	sameDomainActiveChanges: SddDomainCollisionReport[];
}

export interface SddStatus {
	schemaName: "gentle-pi.sdd-status";
	schemaVersion: 1;
	changeName: string | null;
	artifactStore: SddArtifactStore;
	planningHome: { root: string; changesDir: string };
	changeRoot: string | null;
	/**
	 * 轻量 change（P1.1）：changeRoot 下存在规范常规文件 `.jero-lightweight`
	 * 时为 true——proposal + tasks 即可 apply-ready，specs/design 显式豁免；
	 * 无 delta specs 时 sync 阶段 not_applicable（archive 不再要求
	 * sync-report）。可选字段：仅权威解析且标记在场时携带，既有消费者
	 * 不受影响（gentle-pi.sdd-status@1 的向后兼容扩展）。
	 */
	lightweight?: boolean;
	artifactPaths: SddArtifactPaths;
	contextFiles: SddArtifactPaths;
	artifacts: Record<keyof SddArtifactPaths, ArtifactState>;
	/** 实现侧拥有的进度；格式错误的标记在此保持未解决。 */
	taskProgress: SddTaskProgress;
	/** 父级/编排器可见的生命周期动作，不计入 apply 完成度。 */
	deferredParentActions: SddTaskProgress;
	/** 针对格式错误的所有权标记的稳定诊断。 */
	taskArtifactErrors: string[];
	applyState: ApplyState;
	dependencies: Record<SddPhase, DependencyState>;
	actionContext: SddActionContext;
	relationships: SddRelationships;
	collisions: SddDomainCollisionReport[];
	legacyFlatSpec?: { path: string; hasDomainSpecs: boolean };
	/**
	 * 正向终态投影：该变更已归档。`path` 是仓库相对路径的
	 * 归档目录 (openspec/changes/archive/YYYY-MM-DD-<change>)。
	 * 设置后 `nextRecommended` 为 "archived"，且不再推荐任何后续阶段。
	 */
	archived?: { path: string };
	nextRecommended: SddNextRecommended;
	instructions?: SddPhaseInstructions;
	blockedReasons: string[];
	/**
	 * 当原生状态引擎对所选产物存储（engram、none，或没有 openspec/ 目录的
	 * both）不具备权威性时为 true。为 true 时，`dependencies`、`applyState`
	 * 与 `blockedReasons` 不得被视为真实阻塞 —— 应改为从 Engram 解析就绪状态。
	 * 在所有权威路径（openspec / 带磁盘的 both）上默认为 false。
	 */
	isNonAuthoritative: boolean;
}

export interface ResolveSddStatusOptions {
	cwd: string;
	changeName?: string;
	includeInstructions?: boolean;
	workspaceRoot?: string;
	artifactStore?: SddArtifactStore;
}

const EMPTY_PATHS: SddArtifactPaths = {
	proposal: [],
	specs: [],
	design: [],
	tasks: [],
	applyProgress: [],
	verifyReport: [],
	syncReport: [],
};

function safeDirectories(path: string): string[] {
	try {
		return readdirSync(path)
			.filter((entry) => {
				try {
					return statSync(join(path, entry)).isDirectory();
				} catch {
					return false;
				}
			})
			.sort();
	} catch {
		return [];
	}
}

function safeRead(path: string): string {
	try {
		return readFileSync(path, "utf8");
	} catch {
		return "";
	}
}

function hasContent(path: string): boolean {
	return existsSync(path) && safeRead(path).trim().length > 0;
}

function singleFileState(paths: string[]): ArtifactState {
	if (paths.length === 0) return "missing";
	return paths.some((path) => !hasContent(path)) ? "partial" : "done";
}

function multiFileState(paths: string[], partial = false): ArtifactState {
	if (paths.length === 0) return partial ? "partial" : "missing";
	return paths.some((path) => !hasContent(path)) || partial ? "partial" : "done";
}

function findSpecFiles(specsDir: string): string[] {
	const files: string[] = [];
	function walk(dir: string): void {
		for (const entry of safeDirectories(dir)) {
			const path = join(dir, entry);
			const specPath = join(path, "spec.md");
			if (existsSync(specPath)) files.push(specPath);
			walk(path);
		}
	}
	walk(specsDir);
	return files.sort();
}

function domainFromSpecPath(changeRoot: string, specPath: string): string | undefined {
	const rel = relative(join(changeRoot, "specs"), specPath).split(/[\\/]/);
	return rel.length >= 2 && rel.at(-1) === "spec.md" ? rel.slice(0, -1).join("/") : undefined;
}

function taskProgress(lines: string[]): SddTaskProgress {
	const unchecked = lines.filter((line) => !/^\s*- \[[xX]\]/.test(line));
	return {
		total: lines.length,
		complete: lines.length - unchecked.length,
		remaining: unchecked.length,
		unchecked: unchecked.map((line) => line.trim()),
	};
}

function countTasks(tasksPath: string | undefined): SddTaskAccounting {
	if (!tasksPath || !existsSync(tasksPath)) {
		return { implementation: { ...EMPTY_TASK_PROGRESS }, parent: { ...EMPTY_TASK_PROGRESS }, errors: [] };
	}
	const implementation: string[] = [];
	const malformed: string[] = [];
	const parent: string[] = [];
	const errors: string[] = [];
	for (const rawLine of safeRead(tasksPath).split(/\r?\n/)) {
		const line = rawLine.trimEnd();
		if (!/^\s*- \[(?: |x|X)\]/.test(line)) continue;
		const markers = line.match(/<!--\s*sdd-owner\s*:[\s\S]*?-->/gi) ?? [];
		const hasOwnerToken = /sdd-owner/i.test(line);
		const canonical = /<!-- sdd-owner: (implementation|parent) -->\s*$/.exec(line);
		const owner: SddTaskOwner | undefined = canonical?.[1] as SddTaskOwner | undefined;
		if (!hasOwnerToken) {
			implementation.push(line);
		} else if (markers.length === 1 && canonical && canonical[0] === markers[0]) {
			(owner === SDD_TASK_OWNER.PARENT ? parent : implementation).push(line);
		} else {
			malformed.push(line);
			errors.push(`Malformed task ownership marker: ${line.trim()}`);
		}
	}
	const implementationProgress = taskProgress(implementation);
	return {
		implementation: {
			total: implementationProgress.total + malformed.length,
			complete: implementationProgress.complete,
			remaining: implementationProgress.remaining + malformed.length,
			unchecked: [...implementationProgress.unchecked, ...malformed.map((line) => line.trim())],
		},
		parent: taskProgress(parent),
		errors,
	};
}

function reportIsClearlyPassing(path: string | undefined): boolean {
	if (!path || !hasContent(path)) return false;
	const text = safeRead(path);
	const hasBlocker = /(^|\b)(FAIL|FAILED|BLOCKED|CRITICAL|PENDING|TODO)(\b|:)|verification blockers?|not\s+(?:pass|passed|passing|successful|complete|completed)|(?:pass|passed|success|successful|complete|completed)\s*:\s*no\b/i.test(text);
	const hasPassSignal = text
		.split(/\r?\n/)
		.map((line) => line.trim())
		.some((line) =>
			/^(?:(?:status|verdict|result|verification|sync|final(?:\s+verdict)?)\s*:\s*)?(?:PASS|PASSED|SUCCESS|SUCCESSFUL)$/i.test(line) ||
			/^all checks passed\.?$/i.test(line) ||
			/^ready for archive\.?$/i.test(line) ||
			/^sync completed?\.?$/i.test(line),
		);
	return hasPassSignal && !hasBlocker;
}

// 规划路由修复第一个未完成的前置条件；诊断保持独立。轻量 change 跳过
// specs/design 横档——它们已被显式豁免，推荐链直达 tasks。
function planningRecommendation(artifacts: SddStatus["artifacts"], taskTotal: number, lightweight: boolean): SddNextRecommended {
	if (artifacts.proposal !== "done") return "sdd-propose";
	if (!lightweight && artifacts.specs !== "done") return "sdd-spec";
	if (!lightweight && artifacts.design !== "done") return "sdd-design";
	if (artifacts.tasks !== "done" || taskTotal === 0) return "sdd-tasks";
	return "blocked";
}

// 轻量声明是 changeRoot 下的一个规范常规文件（与 .jero-instance 同形纪律：
// 目录、符号链接等非规范形状保守视为未声明）。存在即显式豁免，绝不猜测。
function hasLightweightMarker(changeRoot: string): boolean {
	try {
		return lstatSync(join(changeRoot, ".jero-lightweight")).isFile();
	} catch {
		return false;
	}
}

function emptyStatus(cwd: string, changeName: string | null, blockedReasons: string[], artifactStore: SddArtifactStore = "openspec", isNonAuthoritative = false): SddStatus {
	const root = resolve(cwd);
	const changesDir = join(root, "openspec", "changes");
	const actionContext: SddActionContext = {
		mode: "repo-local",
		workspaceRoot: root,
		allowedEditRoots: [root],
		warnings: [],
	};
	return {
		schemaName: "gentle-pi.sdd-status",
		schemaVersion: 1,
		changeName,
		artifactStore,
		planningHome: { root, changesDir },
		changeRoot: null,
		artifactPaths: { ...EMPTY_PATHS },
		contextFiles: { ...EMPTY_PATHS },
		artifacts: {
			proposal: "missing",
			specs: "missing",
			design: "missing",
			tasks: "missing",
			applyProgress: "missing",
			verifyReport: "missing",
			syncReport: "missing",
		},
		taskProgress: { ...EMPTY_TASK_PROGRESS },
		deferredParentActions: { ...EMPTY_TASK_PROGRESS },
		taskArtifactErrors: [],
		applyState: "blocked",
		dependencies: { apply: "blocked", verify: "blocked", sync: "blocked", archive: "blocked" },
		actionContext,
		relationships: {
			dependsOn: [],
			supersedes: [],
			amends: [],
			conflictsWith: [],
			sameDomainActiveChanges: [],
		},
		collisions: [],
		nextRecommended: "blocked",
		blockedReasons,
		isNonAuthoritative,
	};
}

/**
 * 查找某个变更的最新归档条目。归档目录命名为
 * `YYYY-MM-DD-<change>`；只有完整日期前缀之后紧跟精确 `-<change>` 后缀才匹配
 * （变更 "foo-bar" 永远不会匹配 "2026-01-01-foo-bar-baz"）。
 * safeDirectories 按字典序排序，因此最后一个匹配项即为最新日期。
 */
function findArchivedChangeEntry(root: string, changeName: string): string | undefined {
	return safeDirectories(join(root, "openspec", "changes", "archive"))
		.filter(
			(entry) =>
				/^\d{4}-\d{2}-\d{2}-$/.test(entry.slice(0, 11)) && entry.slice(11) === changeName,
		)
		.at(-1);
}

/** 针对目录已移入归档的变更的正向终态投影。 */
function archivedStatus(cwd: string, changeName: string, archiveEntry: string, artifactStore: SddArtifactStore): SddStatus {
	const status = emptyStatus(cwd, changeName, [], artifactStore);
	status.applyState = "all_done";
	status.dependencies = { apply: "all_done", verify: "all_done", sync: "all_done", archive: "all_done" };
	status.archived = { path: join("openspec", "changes", "archive", archiveEntry) };
	status.nextRecommended = "archived";
	return status;
}

export function listActiveOpenSpecChanges(cwd: string): string[] {
	return safeDirectories(join(cwd, "openspec", "changes")).filter(
		(change) => change !== "archive",
	);
}

export function renderPhaseInstructions(status: SddStatus): SddPhaseInstructions {
	const change = status.changeName ?? "<unresolved>";
	if (status.applyState === "not_applicable") {
		return {
			apply: ["Readiness is resolved from Engram; per-phase instructions not applicable."],
			verify: ["Readiness is resolved from Engram; per-phase instructions not applicable."],
			sync: ["Readiness is resolved from Engram; per-phase instructions not applicable."],
			archive: ["Readiness is resolved from Engram; per-phase instructions not applicable."],
		};
	}
	return {
		apply: [
			`Change: ${change}`,
			`State: ${status.dependencies.apply}`,
			status.applyState === "all_done"
				? "All implementation tasks are checked complete; do not edit."
				: "Implement only unchecked implementation-owned tasks from the tasks artifact.",
			`Implementation tasks: ${status.taskProgress.complete}/${status.taskProgress.total} complete`,
			"Update persisted task checkboxes for implementation-owned tasks immediately after completing each task.",
			...status.taskProgress.unchecked.map((line) => `Remaining implementation task: ${line}`),
			`Deferred parent lifecycle actions: ${status.deferredParentActions.complete}/${status.deferredParentActions.total} complete`,
			...status.deferredParentActions.unchecked.map((line) => `Deferred parent action: ${line}`),
			...status.taskArtifactErrors.map((error) => `Task artifact error: ${error}`),
		],
		verify: [
			`Change: ${change}`,
			`State: ${status.dependencies.verify}`,
			"Verify task completion, spec coverage, implementation correctness, design coherence, and tests when available.",
			"Unchecked implementation tasks are CRITICAL archive blockers.",
			...status.taskProgress.unchecked.map((line) => `Unchecked blocker: ${line}`),
		],
		sync: [
			`Change: ${change}`,
			`State: ${status.dependencies.sync}`,
			"Sync delta specs into openspec/specs only after verification is clean.",
			...status.artifactPaths.specs.map((path) => `Delta spec: ${path}`),
			...status.collisions.flatMap((collision) =>
				collision.changes.map((item) =>
					`Same-domain collision: ${collision.domain} also touched by ${item.change} (${item.path})`,
				),
			),
		],
		archive: [
			`Change: ${change}`,
			`State: ${status.dependencies.archive}`,
			"Archive only after clean verify, completed sync, and zero unchecked implementation tasks.",
			"CRITICAL verification issues have no override.",
			status.changeRoot
				? `Archive target: ${join(status.planningHome.changesDir, "archive", `YYYY-MM-DD-${change}`)}`
				: "Archive target unavailable until change is resolved.",
		],
	};
}

/**
 * 构建非权威 SddStatus 的唯一权威构造函数。
 * 所有非权威返回点必须调用此函数，而不是手工构造。
 */
function nonAuthoritativeStatus(cwd: string, changeName: string | null, store: SddArtifactStore, includeInstructions?: boolean): SddStatus {
	const root = resolve(cwd);
	const actionContext: SddActionContext = {
		mode: "repo-local",
		workspaceRoot: root,
		allowedEditRoots: [root],
		warnings: [],
	};
	const status: SddStatus = {
		schemaName: "gentle-pi.sdd-status",
		schemaVersion: 1,
		changeName,
		artifactStore: store,
		planningHome: { root, changesDir: "" },
		changeRoot: null,
		artifactPaths: { ...EMPTY_PATHS },
		contextFiles: { ...EMPTY_PATHS },
		artifacts: {
			proposal: "missing",
			specs: "missing",
			design: "missing",
			tasks: "missing",
			applyProgress: "missing",
			verifyReport: "missing",
			syncReport: "missing",
		},
		taskProgress: { ...EMPTY_TASK_PROGRESS },
		deferredParentActions: { ...EMPTY_TASK_PROGRESS },
		taskArtifactErrors: [],
		applyState: "not_applicable",
		dependencies: { apply: "not_applicable", verify: "not_applicable", sync: "not_applicable", archive: "not_applicable" },
		actionContext,
		relationships: {
			dependsOn: [],
			supersedes: [],
			amends: [],
			conflictsWith: [],
			sameDomainActiveChanges: [],
		},
		collisions: [],
		nextRecommended: "resolve-via-engram",
		blockedReasons: [],
		isNonAuthoritative: true,
	};
	if (includeInstructions) status.instructions = renderPhaseInstructions(status);
	return status;
}

export function resolveSddStatus(options: ResolveSddStatusOptions): SddStatus {
	// 安全网：当存储未知（undefined）且磁盘上没有 openspec/ 目录时，
	// 不要输出 openspec 的 "no changes / blocked" 状态 —— 那对尚未被识别的
	// engram 或 none 会话会是误报阻塞。改为
	// 按非权威处理。真正的 openspec 会话必然有该目录。
	const hasOpenSpecDir = existsSync(join(resolve(options.cwd), "openspec"));
	const store: SddArtifactStore =
		options.artifactStore ?? (hasOpenSpecDir ? "openspec" : "none");

	// 单一决策点：磁盘引擎无法权威解析时即为非权威。
	// 情形：
	//   - store 为 engram 或 none：始终非权威（无磁盘后备）
	//   - store 为 both 且无 openspec/ 目录：非权威（无磁盘可扫描）
	// both 且有 openspec 的情形在下方列出活跃变更后再处理。
	if (store === "engram" || store === "none" || (store === "hybrid" && !hasOpenSpecDir)) {
		const changeName = options.changeName?.trim() || null;
		return nonAuthoritativeStatus(options.cwd, changeName, store, options.includeInstructions);
	}

	const root = resolve(options.cwd);
	const changesDir = join(root, "openspec", "changes");
	const activeChanges = listActiveOpenSpecChanges(root);
	let changeName = options.changeName?.trim() || "";
	const blockedReasons: string[] = [];

	if (!changeName) {
		if (activeChanges.length === 1) {
			changeName = activeChanges[0];
		} else if (activeChanges.length === 0) {
			// store 为 both + openspec/ 存在 + 零个活跃变更 + 无 changeName：
			// 该变更可能只存在于 Engram —— 非权威，而非误报阻塞。
			// 纯 openspec 且零个变更是真实阻塞（运行 sdd-new）。
			if (store === "hybrid") {
				return nonAuthoritativeStatus(options.cwd, null, store, options.includeInstructions);
			}
			return emptyStatus(root, null, ["No active SDD changes found."], store);
		} else {
			// 多个活跃变更且无 changeName：合法的选择提示（变更确实存在于
			// 磁盘）。对两种存储都保持既有的权威歧义选择行为。
			return emptyStatus(root, null, [
				`Change selection is ambiguous: ${activeChanges.join(", ")}.`,
			], store);
		}
	}

	if (!activeChanges.includes(changeName)) {
		// store 为 both + openspec/ 存在 + 指名变更未在磁盘上找到：
		// 该变更可能只存在于 Engram —— 非权威。
		// 纯 openspec 仍然阻塞（合法的 "run sdd-new"）。
		if (store === "hybrid") {
			return nonAuthoritativeStatus(options.cwd, changeName, store, options.includeInstructions);
		}
		// Issue #535：活跃目录缺失可能意味着该变更已归档。
		// 投影出明确的完成状态，而不是误报 "run sdd-new" 阻塞。
		const archiveEntry = findArchivedChangeEntry(root, changeName);
		if (archiveEntry) {
			return archivedStatus(root, changeName, archiveEntry, store);
		}
		return emptyStatus(root, changeName, [`Active change not found: ${changeName}.`], store);
	}

	const changeRoot = join(changesDir, changeName);
	const lightweight = hasLightweightMarker(changeRoot);
	const proposal = join(changeRoot, "proposal.md");
	const design = join(changeRoot, "design.md");
	const tasks = join(changeRoot, "tasks.md");
	const applyProgress = join(changeRoot, "apply-progress.md");
	const verifyReport = join(changeRoot, "verify-report.md");
	const syncReport = join(changeRoot, "sync-report.md");
	const specFiles = findSpecFiles(join(changeRoot, "specs"));
	const legacyFlatSpec = detectLegacyFlatSpec(root, changeName);
	const flatOnly = Boolean(legacyFlatSpec && specFiles.length === 0);

	const artifactPaths: SddArtifactPaths = {
		proposal: existsSync(proposal) ? [proposal] : [],
		specs: specFiles,
		design: existsSync(design) ? [design] : [],
		tasks: existsSync(tasks) ? [tasks] : [],
		applyProgress: existsSync(applyProgress) ? [applyProgress] : [],
		verifyReport: existsSync(verifyReport) ? [verifyReport] : [],
		syncReport: existsSync(syncReport) ? [syncReport] : [],
	};
	const artifacts = {
		proposal: singleFileState(artifactPaths.proposal),
		specs: multiFileState(artifactPaths.specs, flatOnly),
		design: singleFileState(artifactPaths.design),
		tasks: singleFileState(artifactPaths.tasks),
		applyProgress: singleFileState(artifactPaths.applyProgress),
		verifyReport: singleFileState(artifactPaths.verifyReport),
		syncReport: singleFileState(artifactPaths.syncReport),
	} satisfies SddStatus["artifacts"];
	const taskAccounting = countTasks(artifactPaths.tasks[0]);
	const taskProgress = taskAccounting.implementation;
	const actionContext: SddActionContext = {
		mode: "repo-local",
		workspaceRoot: options.workspaceRoot ? resolve(options.workspaceRoot) : root,
		allowedEditRoots: [options.workspaceRoot ? resolve(options.workspaceRoot) : root],
		warnings: [],
	};

	const collisions = specFiles
		.map((path) => domainFromSpecPath(changeRoot, path))
		.filter((domain): domain is string => Boolean(domain))
		.map((domain) => ({
			domain,
			changes: detectActiveDomainCollisions(root, changeName, domain).sort((a, b) =>
				a.change.localeCompare(b.change),
			),
		}))
		.filter((collision) => collision.changes.length > 0);

	if (artifacts.proposal === "missing") blockedReasons.push("proposal.md is missing.");
	if (artifacts.proposal === "partial") blockedReasons.push("proposal.md is empty or partial.");
	if (!lightweight && artifacts.specs !== "done") blockedReasons.push("domain specs are missing or partial.");
	if (!lightweight && artifacts.design === "missing") blockedReasons.push("design.md is missing.");
	if (!lightweight && artifacts.design === "partial") blockedReasons.push("design.md is empty or partial.");
	if (artifacts.tasks === "missing") blockedReasons.push("tasks.md is missing.");
	if (artifacts.tasks === "partial") blockedReasons.push("tasks.md is empty or partial.");
	if (artifacts.tasks === "done" && taskProgress.total === 0) {
		blockedReasons.push("tasks.md has no implementation task checkboxes.");
	}
	blockedReasons.push(...taskAccounting.errors);
	if (!lightweight && flatOnly && legacyFlatSpec) {
		blockedReasons.push(`Legacy flat spec is present without domain specs: ${legacyFlatSpec.path}.`);
	}

	// 轻量 change 的就绪门：proposal + tasks 即可；specs/design 被标记
	// 显式豁免（在场时仍作为上下文与 sync 对象，绝不当作阻塞）。
	const coreArtifactsReady = artifacts.proposal === "done" && artifacts.tasks === "done" && taskProgress.total > 0
		&& (lightweight || (artifacts.specs === "done" && artifacts.design === "done" && !flatOnly));
	const taskArtifactBlocked = taskAccounting.errors.length > 0;
	const applyState: ApplyState = !coreArtifactsReady || taskArtifactBlocked
		? "blocked"
		: taskProgress.remaining === 0
			? "all_done"
			: "ready";
	const verifyClean = reportIsClearlyPassing(artifactPaths.verifyReport[0]);
	const syncClean = reportIsClearlyPassing(artifactPaths.syncReport[0]);
	// 轻量且零 delta specs：sync 无对象，阶段 not_applicable（archive 相应
	// 不要求 sync-report）；轻量但写了 specs 的 change 走正常 sync。
	const noSpecsToSync = lightweight && specFiles.length === 0;
	const syncPrerequisitesReady = coreArtifactsReady && verifyClean && collisions.length === 0 && (lightweight || !flatOnly);
	const syncState: DependencyState = noSpecsToSync
		? "not_applicable"
		: syncPrerequisitesReady
			? syncClean
				? "all_done"
				: "ready"
			: "blocked";
	const verifyState: DependencyState = verifyClean
		? "all_done"
		: artifacts.tasks === "done" && taskProgress.total > 0 && (artifacts.applyProgress === "done" || applyState === "all_done")
			? "ready"
			: "blocked";
	const dependencies: SddStatus["dependencies"] = {
		apply: applyState === "blocked" ? "blocked" : applyState,
		verify: verifyState,
		sync: syncState,
		archive: coreArtifactsReady && verifyClean && (noSpecsToSync || syncClean) && taskProgress.remaining === 0 && !taskArtifactBlocked ? "ready" : "blocked",
	};
	const archiveReady = dependencies.archive === "ready";
	const nextRecommended: SddNextRecommended = taskArtifactBlocked
		? "fix-task-ownership-marker"
		: dependencies.apply === "ready"
			? "sdd-apply"
			: dependencies.verify === "ready"
				? "sdd-verify"
				: dependencies.sync === "ready"
					? "sdd-sync"
					: archiveReady
						? "sdd-archive"
						: planningRecommendation(artifacts, taskProgress.total, lightweight);

	const status: SddStatus = {
		schemaName: "gentle-pi.sdd-status",
		schemaVersion: 1,
		changeName,
		artifactStore: store,
		...(lightweight ? { lightweight: true } : {}),
		planningHome: { root, changesDir },
		changeRoot,
		artifactPaths,
		contextFiles: artifactPaths,
		artifacts,
		taskProgress,
		deferredParentActions: taskAccounting.parent,
		taskArtifactErrors: taskAccounting.errors,
		applyState,
		dependencies,
		actionContext,
		relationships: {
			dependsOn: [],
			supersedes: [],
			amends: [],
			conflictsWith: [],
			sameDomainActiveChanges: collisions,
		},
		collisions,
		legacyFlatSpec: legacyFlatSpec
			? { path: legacyFlatSpec.path, hasDomainSpecs: specFiles.length > 0 }
			: undefined,
		nextRecommended,
		blockedReasons,
		isNonAuthoritative: false,
	};
	if (options.includeInstructions) status.instructions = renderPhaseInstructions(status);
	return status;
}

export function isNonAuthoritativeStatus(status: SddStatus): boolean {
	return status.isNonAuthoritative;
}

export function renderNativeSddPhasePrompt(status: SddStatus | NativeSddStatusV2, phase?: SddPhase | "remediate"): string {
	const native = status.schemaName === "gentle-ai.sdd-status";
	let selectedInstructions: readonly string[] | undefined;
	if (phase) {
		selectedInstructions = native
			? phase === "sync" ? undefined : status.phaseInstructions?.[phase]
			: phase === "remediate" ? undefined : status.instructions?.[phase];
	}
	const isNonAuthoritative = !native && isNonAuthoritativeStatus(status);
	const authorityLine = isNonAuthoritative
		? `This status is non-authoritative (artifact store: ${status.artifactStore}). The orchestrator must resolve readiness from Engram instead.`
		: "The parent/orchestrator resolved this status deterministically. Treat it as authoritative over prompt inference.";
	const blockLine = isNonAuthoritative
		? `Do not block phase work based on this status — resolve readiness from Engram using the injected Engram memory read tools on the change topic keys (sdd/{change}/proposal, sdd/{change}/spec, sdd/{change}/design, sdd/{change}/tasks, etc.) instead.`
		: "Do not run phase work when this status marks the phase blocked; return the blockers instead.";
	return [
		"## Native SDD Status Engine",
		authorityLine,
		blockLine,
		...(phase && selectedInstructions
			? ["", `### ${phase} instructions`, ...selectedInstructions.map((line) => `- ${line}`)]
			: []),
		"",
		"```json",
		JSON.stringify(status, null, 2),
		"```",
	].join("\n");
}

export function renderSddDispatcherMarkdown(status: SddStatus): string {
	const isNonAuthoritative = isNonAuthoritativeStatus(status);
	const statusSection = isNonAuthoritative
		? [
				"### Non-authoritative store — resolve via Engram",
				`This status is non-authoritative (artifact store: ${status.artifactStore}).`,
				"Resolve readiness directly from Engram using the injected Engram memory read tools on the change topic keys:",
				`- sdd/${status.changeName ?? "<change>"}/proposal`,
				`- sdd/${status.changeName ?? "<change>"}/spec`,
				`- sdd/${status.changeName ?? "<change>"}/design`,
				`- sdd/${status.changeName ?? "<change>"}/tasks`,
				`- sdd/${status.changeName ?? "<change>"}/apply-progress (if present)`,
				`- sdd/${status.changeName ?? "<change>"}/verify-report (if present)`,
				"Do not treat blockedReasons or dependency states from this status as real blockers.",
			].join("\n")
		: status.blockedReasons.length > 0
			? ["### Blocked", ...status.blockedReasons.map((reason) => `- ${reason}`)].join("\n")
			: "### Ready\nThe next phase may be delegated with the attached status JSON and phase instructions.";
	// 对非权威状态，跳过对 nextRecommended 的不安全 SddPhase 类型断言
	const instructionsSection = isNonAuthoritative
		? []
		: (status.instructions?.[status.nextRecommended.replace(/^sdd-/, "") as SddPhase] ?? []).map(
				(line) => `- ${line}`,
			);
	return [
		`## Native SDD Dispatcher: ${status.changeName ?? "unresolved"}`,
		"",
		`nextPhase: ${status.nextRecommended}`,
		`apply: ${status.dependencies.apply}`,
		`verify: ${status.dependencies.verify}`,
		`sync: ${status.dependencies.sync}`,
		`archive: ${status.dependencies.archive}`,
		"",
		statusSection,
		"",
		...(instructionsSection.length > 0
			? ["### Instructions for next phase", ...instructionsSection, ""]
			: []),
		"### Status JSON",
		"```json",
		JSON.stringify(status, null, 2),
		"```",
	].join("\n");
}

export function renderSddStatusMarkdown(status: SddStatus): string {
	const title = status.changeName ?? "unresolved";
	const lines = [
		`## SDD Status: ${title}`,
		"",
		`schema: ${status.schemaName}@${status.schemaVersion}`,
		`store: ${status.artifactStore}`,
		`root: ${status.planningHome.root}`,
		`next: ${status.nextRecommended}`,
		"",
		"### Implementation tasks",
		`- complete: ${status.taskProgress.complete}/${status.taskProgress.total}`,
		`- remaining: ${status.taskProgress.remaining}`,
		...status.taskProgress.unchecked.map((line) => `- unchecked: ${line}`),
		"",
		"### Deferred parent lifecycle actions",
		`- complete: ${status.deferredParentActions.complete}/${status.deferredParentActions.total}`,
		`- remaining: ${status.deferredParentActions.remaining}`,
		...status.deferredParentActions.unchecked.map((line) => `- deferred: ${line}`),
		...status.taskArtifactErrors.map((error) => `- task artifact error: ${error}`),
		"",
		"### Dependencies",
		...Object.entries(status.dependencies).map(([phase, state]) => `- ${phase}: ${state}`),
	];
	if (status.collisions.length > 0) {
		lines.push("", "### Same-domain active changes");
		for (const collision of status.collisions) {
			lines.push(
				`- ${collision.domain}: ${collision.changes.map((item) => item.change).join(", ")}`,
			);
		}
	}
	if (status.blockedReasons.length > 0) {
		lines.push("", "### Blockers", ...status.blockedReasons.map((reason) => `- ${reason}`));
	}
	lines.push("", "### JSON", "```json", JSON.stringify(status, null, 2), "```");
	return lines.join("\n");
}

export function parseSddStatusCommandArgs(args: string): { changeName?: string; json: boolean } {
	const parts = args.trim().split(/\s+/).filter(Boolean);
	const json = parts.includes("--json");
	const changeName = parts.find((part) => part !== "--json");
	return { changeName, json };
}

export function sddStatusSeverity(status: SddStatus): "info" | "warning" {
	// 非权威状态没有真实阻塞 —— 始终为 info
	if (isNonAuthoritativeStatus(status)) return "info";
	return status.blockedReasons.length > 0 || Object.values(status.dependencies).includes("blocked")
		? "warning"
		: "info";
}

export function summarizeSddStatusForTitle(status: SddStatus): string {
	return `${status.changeName ?? "unresolved"}: ${status.nextRecommended} (${status.taskProgress.complete}/${status.taskProgress.total} tasks)`;
}

export function activeChangeLabel(cwd: string): string {
	return basename(resolve(cwd));
}
