import { execFileSync, type ExecFileSyncOptions } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, isAbsolute, join, resolve, sep } from "node:path";
import { reviewGitEnvironment } from "../review-repository.ts";
import { deriveChangedPathManifest, digestChangedPathManifest, type ChangedPathEntry } from "../review-candidate-view.ts";
import { buildDiffEvidence, REVIEW_EVENT, REVIEW_ROUTE, type DiffEvidence, type ReviewLens, type ReviewRoute } from "../review-triggers.ts";
import { classifyReviewRisk, isGeneratedGoldenPath, type ReviewDiffStat, type ReviewRiskClassification, type ReviewRiskTier } from "../review-risk.ts";
import { jeroDomainHash } from "./canonical.ts";

// 叠在 lib/review-snapshot.ts 之上的快照根重定向接缝（spec §I.10，
// M1 顺延的 E.6 项）。
//
// 移植的 `captureReviewSnapshot` 不能用于 jero 存储：其私有的
// `snapshotsRoot` 把 `gentle-ai/reviews/snapshots` 硬编码在 Git 目录下，
// 而 `resolveJeroAuthorityStoreV1` 把 `gentle-ai/reviews/*` 之下的任何
// 命中都当作外来权威存储——因此一次上游捕获就会永久毒化该仓库对
// jero 的可用性（保守失败，无迁移）。与其编辑字节完全相同的移植，本
// 模块就是调用边界：它复用移植版导出的、与根无关的机制
// （`classifyReviewRisk`、`buildDiffEvidence`、
// `discoverReviewUntrackedPaths`、`deriveChangedPathManifest`、
// `digestChangedPathManifest`），只重新实现约 80 行捕获编排，使每个
// 字节都落在 `<store>/jero-review/snapshots/` 之下（0o700 临时暂存 +
// 重命名、隔离对象存储、元数据记录——与上游相同的形态和纪律）。
// 快照身份经 jero 域哈希（`jero.authority.snapshot`），因此 jero 的
// 目标身份绝不与上游 Go 域的冲突。

export class JeroSnapshotError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "JeroSnapshotError";
	}
}

export const JERO_REVIEW_SNAPSHOT_SCHEMA = "jero.authority.review-snapshot/v1";
export const JERO_REVIEW_SNAPSHOT_IDENTITY_SCHEMA = "jero.authority.review-snapshot-identity/v1";

export type JeroSnapshotModeName = "ordinary" | "judgment-day";

export interface JeroSnapshotProjectionV1 {
	kind: "complete" | "intended-commit";
	tree?: string;
}

export interface JeroSnapshotObjectStoreV1 {
	snapshot_directory: string;
	object_directory: string;
	alternate_object_directory: string;
	metadata_path: string;
	sensitivity: "workspace-content";
}

export interface JeroReviewSnapshotRecordV1 {
	schema: typeof JERO_REVIEW_SNAPSHOT_SCHEMA;
	mode: JeroSnapshotModeName;
	repository_root: string;
	base_tree: string;
	complete_snapshot_tree: string;
	review_projection: JeroSnapshotProjectionV1;
	initial_review_tree: string;
	genesis_paths: string[];
	intended_untracked: string[];
	diff_evidence: DiffEvidence;
	route: ReviewRoute;
	lenses: ReviewLens[];
	risk_tier: ReviewRiskTier;
	original_changed_lines: number;
	correction_budget: number;
	policy_hash: string;
	object_store: JeroSnapshotObjectStoreV1;
}

export interface JeroSnapshotDerivationV1 {
	readonly record: Omit<JeroReviewSnapshotRecordV1, "object_store">;
	/** `sha256:` 身份——对身份正文的 jero 域哈希（spec §B.3）。 */
	readonly target_identity: string;
	/** 身份哈希的裸十六进制；持久化快照的目录名。 */
	readonly snapshot_id: string;
	readonly risk: ReviewRiskClassification;
	/** 冻结的 numstat 视图（每路径的新增/删除/二进制/仅模式）。 */
	readonly numstat: readonly ReviewDiffStat[];
	readonly changed_path_manifest: readonly ChangedPathEntry[];
	readonly changed_path_manifest_sha256: string;
	/** 派生存续期间的隔离对象目录（工作区捕获）。 */
	readonly object_directory?: string;
	readonly alternate_object_directory: string;
}

const OBJECT_ID = /^[0-9a-f]{40,64}$/;

/** 按模式稳定的策略哈希：身份所绑定的冻结评审策略。 */
export function jeroReviewPolicyHashV1(mode: JeroSnapshotModeName): string {
	return jeroDomainHash("policy", { owner: "jero-pi", mode, version: 1 });
}

function runGit(cwd: string, args: readonly string[], environment: NodeJS.ProcessEnv = {}): string {
	const env = reviewGitEnvironment();
	if (environment.GIT_INDEX_FILE) env.GIT_INDEX_FILE = environment.GIT_INDEX_FILE;
	if (environment.GIT_OBJECT_DIRECTORY) env.GIT_OBJECT_DIRECTORY = environment.GIT_OBJECT_DIRECTORY;
	if (environment.GIT_ALTERNATE_OBJECT_DIRECTORIES) env.GIT_ALTERNATE_OBJECT_DIRECTORIES = environment.GIT_ALTERNATE_OBJECT_DIRECTORIES;
	return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env }).trim();
}

function repositoryRoot(cwd: string): string {
	// `--show-toplevel` 在 Windows 上打印正斜杠；原生拼写让记录下来的
	// 仓库根目录可与 path.join 的输入相互比较。
	return realpathSync.native(runGit(cwd, ["rev-parse", "--show-toplevel"]));
}

function repositoryObjectDirectory(root: string): string {
	const path = runGit(root, ["rev-parse", "--git-path", "objects"]);
	return isAbsolute(path) ? path : resolve(root, path);
}

function resolveBaseTree(root: string, baseRef?: string): string {
	if (baseRef !== undefined) return runGit(root, ["rev-parse", "--verify", `${baseRef}^{tree}`]);
	try {
		return runGit(root, ["rev-parse", "--verify", "HEAD^{tree}"]);
	} catch {
		return runGit(root, ["mktree"]);
	}
}

function resolveTree(root: string, value: string): string {
	if (!OBJECT_ID.test(value)) throw new JeroSnapshotError("Review projection tree must be a resolved Git object ID");
	try {
		return runGit(root, ["rev-parse", "--verify", `${value}^{tree}`]);
	} catch {
		throw new JeroSnapshotError("Review projection tree cannot be resolved");
	}
}

function parseNumstat(value: string): { changedPaths: string[]; stats: ReviewDiffStat[] } {
	const stats: ReviewDiffStat[] = [];
	for (const line of value.split(/\r?\n/)) {
		if (line.length === 0) continue;
		const [added, deleted, path] = line.split("\t");
		if (path === undefined) continue;
		const binary = added === "-" || deleted === "-";
		const additions = binary ? 0 : Number.parseInt(added ?? "", 10);
		const deletions = binary ? 0 : Number.parseInt(deleted ?? "", 10);
		if (!Number.isSafeInteger(additions) || !Number.isSafeInteger(deletions)) {
			throw new JeroSnapshotError(`Git returned an invalid numstat for ${path}`);
		}
		stats.push({ path, additions, deletions, binary, mode_only: additions + deletions === 0 });
	}
	return { changedPaths: stats.map(({ path }) => path), stats };
}

function canonicalPaths(value: string): string[] {
	const paths = value.split("\0").filter(Boolean);
	for (const path of paths) {
		if (path.startsWith("/") || path.split("/").some((part) => part === "" || part === "." || part === "..")) {
			throw new JeroSnapshotError("Git returned a non-canonical repository-relative path");
		}
	}
	return [...new Set(paths)].toSorted();
}

/** 只对未跟踪路径“名称”做摘要——清点时不读取也不哈希任何内容（spec §B.2）。 */
export function jeroUntrackedInventoryDigestV1(names: readonly string[]): string {
	return `sha256:${jeroDomainHash("untracked-inventory", [...names].toSorted())}`;
}

/** 对快照的权威变更路径列表做摘要。 */
export function jeroPathsDigestV1(paths: readonly string[]): string {
	return `sha256:${jeroDomainHash("paths", [...paths].toSorted())}`;
}

export interface JeroSnapshotDeriveOptionsV1 {
	readonly cwd: string;
	readonly mode: JeroSnapshotModeName;
	/**
	 * `complete` 评审活动工作区（含未跟踪）；base diff 评审已提交范围
	 * baseRef..HEAD；`staged`（M3，§G）从 Git INDEX——即将提交的内容
	 * ——冻结候选，经临时 GIT_INDEX_FILE 副本完成，绝不触碰真实索引。
	 */
	readonly candidate: { kind: "workspace" } | { kind: "base-diff"; baseRef: string } | { kind: "staged" };
	readonly policyHash: string;
	readonly projection?: JeroSnapshotProjectionV1;
}

function identityBody(record: Omit<JeroReviewSnapshotRecordV1, "object_store">): unknown {
	return {
		schema: JERO_REVIEW_SNAPSHOT_IDENTITY_SCHEMA,
		mode: record.mode,
		repository_root: record.repository_root,
		base_tree: record.base_tree,
		complete_snapshot_tree: record.complete_snapshot_tree,
		review_projection: record.review_projection,
		initial_review_tree: record.initial_review_tree,
		genesis_paths: record.genesis_paths,
		intended_untracked: record.intended_untracked,
		diff_evidence: record.diff_evidence,
		route: record.route,
		lenses: record.lenses,
		risk_tier: record.risk_tier,
		original_changed_lines: record.original_changed_lines,
		correction_budget: record.correction_budget,
		policy_hash: record.policy_hash,
	};
}

/**
 * 不持久化任何内容地派生完整快照事实：树、风险分类、diff 证据、
 * 路由/评审视角计划、genesis 路径、未跟踪清单、变更路径清单，以及
 * jero 域目标身份。工作区捕获通过临时索引 + 隔离对象目录暂存候选树，
 * 调用方可保留（捕获）或丢弃（状态）。
 *
 * 注意：不要在此处加"HEAD + porcelain 未变 ⇒ 派生可复用"的 memo——
 * porcelain 是路径级指纹（同路径不同内容的两次未提交修改产生完全相同
 * 的输出），会把漂移前的冻结身份错误地当作缓存命中（F7 回归已证实）；
 * 而内容级指纹（逐脏文件 hash-object）的代价恰好等于被优化的全量冻结
 * 本身。STATUS 的每次全量派生是语义要求，不是实现浪费。
 */
export function deriveJeroReviewSnapshotV1(options: JeroSnapshotDeriveOptionsV1 & { readonly keepIsolatedStore?: string }): JeroSnapshotDerivationV1 {
	return deriveJeroReviewSnapshotUncachedV1(options);
}

function deriveJeroReviewSnapshotUncachedV1(options: JeroSnapshotDeriveOptionsV1 & { readonly keepIsolatedStore?: string }): JeroSnapshotDerivationV1 {
	if (options.mode !== "ordinary" && options.mode !== "judgment-day") throw new JeroSnapshotError("Unsupported review mode");
	if (!/^[0-9a-f]{64}$/.test(options.policyHash)) throw new JeroSnapshotError("Review policy hash must be a SHA-256 digest");
	const root = repositoryRoot(options.cwd);
	const alternateObjectDirectory = repositoryObjectDirectory(root);
	let stagingDirectory: string | undefined;
	let objectDirectory: string | undefined;
	try {
		let baseTree: string;
		let completeSnapshotTree: string;
		let intendedUntracked: string[];
		let environment: NodeJS.ProcessEnv = {};
		if (options.candidate.kind === "base-diff") {
			baseTree = resolveBaseTree(root, options.candidate.baseRef);
			completeSnapshotTree = resolveTree(root, runGit(root, ["rev-parse", "--verify", "HEAD^{tree}"]));
			intendedUntracked = [];
		} else if (options.candidate.kind === "staged") {
				// M3（spec G）：从 Git INDEX 冻结候选。真实索引被“复制”到
				// 临时 GIT_INDEX_FILE，且每次写入（树对象）都落在隔离对象
				// 目录中，因此调用方的真实索引绝不被打开写入。
				stagingDirectory = options.keepIsolatedStore ?? mkdtempSync(join(tmpdir(), "jero-snapshot-"));
				mkdirSync(stagingDirectory, { recursive: true, mode: 0o700 });
				chmodSync(stagingDirectory, 0o700);
				const temporaryIndex = join(stagingDirectory, "index");
				objectDirectory = join(stagingDirectory, "objects");
				mkdirSync(objectDirectory, { mode: 0o700 });
				environment = { GIT_INDEX_FILE: temporaryIndex, GIT_OBJECT_DIRECTORY: objectDirectory, GIT_ALTERNATE_OBJECT_DIRECTORIES: alternateObjectDirectory };
				baseTree = resolveBaseTree(root);
				const realIndex = runGit(root, ["rev-parse", "--path-format=absolute", "--git-path", "index"]);
				if (existsSync(realIndex)) copyFileSync(realIndex, temporaryIndex);
				else runGit(root, ["read-tree", "HEAD"], environment);
				completeSnapshotTree = runGit(root, ["write-tree"], environment);
				intendedUntracked = canonicalPaths(runGit(root, ["ls-files", "--others", "--exclude-standard", "-z"]));
		} else {
			stagingDirectory = options.keepIsolatedStore ?? mkdtempSync(join(tmpdir(), "jero-snapshot-"));
			mkdirSync(stagingDirectory, { recursive: true, mode: 0o700 });
			chmodSync(stagingDirectory, 0o700);
			const temporaryIndex = join(stagingDirectory, "index");
			objectDirectory = join(stagingDirectory, "objects");
			mkdirSync(objectDirectory, { mode: 0o700 });
			environment = { GIT_INDEX_FILE: temporaryIndex, GIT_OBJECT_DIRECTORY: objectDirectory, GIT_ALTERNATE_OBJECT_DIRECTORIES: alternateObjectDirectory };
			baseTree = resolveBaseTree(root);
			runGit(root, ["read-tree", baseTree], environment);
			runGit(root, ["add", "-A", "--", "."], environment);
			completeSnapshotTree = runGit(root, ["write-tree"], environment);
			intendedUntracked = canonicalPaths(runGit(root, ["ls-files", "--others", "--exclude-standard", "-z"]));
		}
		const diffEnvironment = objectDirectory === undefined
			? {}
			: { GIT_ALTERNATE_OBJECT_DIRECTORIES: `${objectDirectory}${delimiter}${alternateObjectDirectory}` };
		const projection: JeroSnapshotProjectionV1 = options.projection === undefined || options.projection.kind === "complete"
			? { kind: "complete" }
			: { kind: "intended-commit", tree: resolveTree(root, options.projection.tree ?? completeSnapshotTree) };
		const initialReviewTree = projection.kind === "complete" ? completeSnapshotTree : projection.tree!;
		const diff = parseNumstat(runGit(root, ["diff", "--numstat", "--no-renames", baseTree, completeSnapshotTree], diffEnvironment));
		const risk = classifyReviewRisk(diff.stats);
		const authoredPaths = diff.stats
			.filter((stat) => !isGeneratedGoldenPath(stat.path) && !stat.binary && !stat.mode_only)
			.map(({ path }) => path);
		const diffEvidence = buildDiffEvidence(REVIEW_EVENT.ORDINARY_START, {
			changedPaths: authoredPaths,
			changedLines: risk.original_changed_lines,
		});
		const genesisPaths = canonicalPaths(runGit(root, ["diff", "--no-renames", "--name-only", "-z", baseTree, initialReviewTree], diffEnvironment));
		// Judgment Day 捕获非平凡范围，“不”做普通评审视角分类（spec §G）。
		const plan = options.mode === "ordinary"
			? {
				route: risk.tier === "low" ? REVIEW_ROUTE.TRIVIAL : risk.tier === "high" ? REVIEW_ROUTE.FULL_4R : REVIEW_ROUTE.STANDARD,
				lenses: [...risk.selected_lenses] as ReviewLens[],
			}
			: { route: REVIEW_ROUTE.TRIVIAL, lenses: [] as ReviewLens[] };
		const record: Omit<JeroReviewSnapshotRecordV1, "object_store"> = {
			schema: JERO_REVIEW_SNAPSHOT_SCHEMA,
			mode: options.mode,
			repository_root: root,
			base_tree: baseTree,
			complete_snapshot_tree: completeSnapshotTree,
			review_projection: projection,
			initial_review_tree: initialReviewTree,
			genesis_paths: genesisPaths,
			intended_untracked: intendedUntracked,
			diff_evidence: diffEvidence,
			route: plan.route,
			lenses: plan.lenses,
			risk_tier: risk.tier,
			original_changed_lines: risk.original_changed_lines,
			correction_budget: risk.correction_budget,
			policy_hash: options.policyHash,
		};
		const identityHash = jeroDomainHash("snapshot", identityBody(record));
		const manifestExecutor = (file: string, args: readonly string[], execOptions: ExecFileSyncOptions) =>
			execFileSync(file, args, { ...execOptions, env: { ...reviewGitEnvironment(), ...(diffEnvironment as NodeJS.ProcessEnv) }, encoding: "buffer" });
		const manifest = deriveChangedPathManifest(root, baseTree, completeSnapshotTree, manifestExecutor);
		return {
			record,
			target_identity: `sha256:${identityHash}`,
			snapshot_id: identityHash,
			risk,
			numstat: diff.stats,
			changed_path_manifest: manifest,
			changed_path_manifest_sha256: digestChangedPathManifest(manifest),
			...(objectDirectory === undefined ? {} : { object_directory: objectDirectory }),
			alternate_object_directory: alternateObjectDirectory,
		};
	} finally {
		if (stagingDirectory !== undefined && options.keepIsolatedStore === undefined) {
			rmSync(stagingDirectory, { recursive: true, force: true });
		}
	}
}

export function jeroSnapshotsRootV1(storeRoot: string): string {
	return join(storeRoot, "snapshots");
}

export interface JeroSnapshotCaptureOptionsV1 extends JeroSnapshotDeriveOptionsV1 {
	readonly storeRoot: string;
}

/**
 * 派生并持久安装评审快照到
 * `<storeRoot>/snapshots/<snapshot-id>/`：0o700 的隔离 git 对象存储
 * （能在 `git gc` 中幸存）、元数据记录、原子的暂存→最终重命名。已
 * 存在的相同快照被复用；冲突的快照保守失败。
 */
export function captureJeroReviewSnapshotV1(options: JeroSnapshotCaptureOptionsV1): JeroSnapshotDerivationV1 & { readonly record: JeroReviewSnapshotRecordV1 } {
	const root = jeroSnapshotsRootV1(options.storeRoot);
	mkdirSync(root, { recursive: true, mode: 0o700 });
	chmodSync(root, 0o700);
	// 把隔离对象存储直接暂存到它最终的归宿目录：快照 id 只有在树存在
	// 之后才可知，因此先捕获进快照根下带点前缀的暂存目录，再重命名为
	// `<id>`（与上游 captureReviewSnapshot 相同的纪律）。
	const staging = mkdtempSync(join(root, ".capture-"));
	chmodSync(staging, 0o700);
	try {
		const derivation = deriveJeroReviewSnapshotV1({ ...options, keepIsolatedStore: staging });
		// 隔离对象从 `<staging>/objects` 布局移入：派生把 index+objects
		// 写进了暂存目录本身。
		const finalDirectory = join(root, derivation.snapshot_id);
		const record: JeroReviewSnapshotRecordV1 = {
			...derivation.record,
			object_store: {
				snapshot_directory: finalDirectory,
				object_directory: join(finalDirectory, "objects"),
				alternate_object_directory: derivation.alternate_object_directory,
				metadata_path: join(finalDirectory, "snapshot.json"),
				sensitivity: "workspace-content",
			},
		};
		writeFileSync(join(staging, "snapshot.json"), `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
		chmodSync(join(staging, "snapshot.json"), 0o600);
		rmSync(join(staging, "index"), { force: true });
		if (existsSync(finalDirectory)) {
			const existing = JSON.parse(readFileSync(join(finalDirectory, "snapshot.json"), "utf8")) as JeroReviewSnapshotRecordV1;
			if (jeroDomainHash("snapshot", identityBody(existing)) !== derivation.snapshot_id) {
				throw new JeroSnapshotError("Existing review snapshot metadata does not match its identity");
			}
			rmSync(staging, { recursive: true, force: true });
			return { ...derivation, record: { ...derivation.record, object_store: existing.object_store } };
		}
		renameSync(staging, finalDirectory);
		return { ...derivation, record };
	} catch (error) {
		rmSync(staging, { recursive: true, force: true });
		throw error;
	}
}

/** 移除血脉终局快照的隔离对象存储（cleanupReviewSnapshot 的 jero 根孪生）。 */
export function cleanupJeroReviewSnapshotV1(storeRoot: string, snapshotDirectory: string): void {
	const expectedRoot = resolve(jeroSnapshotsRootV1(storeRoot));
	const directory = resolve(snapshotDirectory);
	if (!directory.startsWith(`${expectedRoot}${sep}`)) {
		throw new JeroSnapshotError("Review snapshot cleanup path is outside the jero snapshot store");
	}
	rmSync(directory, { recursive: true, force: true });
}

/** 读取冻结目标身份的持久化快照记录；记录会对照其自身身份哈希重新校验。 */
export function readJeroSnapshotRecordV1(storeRoot: string, targetIdentity: string): JeroReviewSnapshotRecordV1 {
	if (!/^sha256:[0-9a-f]{64}$/.test(targetIdentity)) throw new JeroSnapshotError("Target identity is not a canonical sha256 identity");
	const directory = join(jeroSnapshotsRootV1(storeRoot), targetIdentity.slice("sha256:".length));
	let record: JeroReviewSnapshotRecordV1;
	try {
		record = JSON.parse(readFileSync(join(directory, "snapshot.json"), "utf8")) as JeroReviewSnapshotRecordV1;
	} catch (error) {
		throw new JeroSnapshotError(`Review snapshot record is unreadable: ${error instanceof Error ? error.message : String(error)}`);
	}
	if (jeroDomainHash("snapshot", identityBody(record)) !== targetIdentity.slice("sha256:".length)) {
		throw new JeroSnapshotError("Review snapshot metadata does not match its identity");
	}
	return record;
}

export interface JeroCorrectionDerivationV1 {
	/** 按 genesis 路径求和的实际修正行数（新增 + 删除）。 */
	readonly lines: number;
	/** 声明的候选树携带的、落在冻结 genesis 范围之外的 diff 路径。 */
	readonly touchedNonGenesisPaths: readonly string[];
}

/**
 * 对照血脉的隔离快照对象存储，重新派生声明的候选树所携带的实际修正
 * （发现 F5，§9.2 参与者输出不可信）：两棵树都必须可解析
 * （`git cat-file -t` = tree），行数来自对 genesis 路径的
 * `git diff --numstat`——绝不来自调用方声明的数字。任何无法解析、快照
 * 不可读、或（二进制的）genesis 行不可计数都抛出 JeroSnapshotError。
 */
export function deriveJeroCorrectionLinesV1(options: {
	readonly storeRoot: string;
	readonly targetIdentity: string;
	readonly initialTree: string;
	readonly candidateTree: string;
	readonly genesisPaths: readonly string[];
}): JeroCorrectionDerivationV1 {
	const record = readJeroSnapshotRecordV1(options.storeRoot, options.targetIdentity);
	const root = record.repository_root;
	// 与上面 manifestExecutor 相同的 GIT_* 纪律：快照的隔离对象目录作为
	// 仓库存储的备用目录搭载。
	const diffEnvironment: NodeJS.ProcessEnv = {
		GIT_ALTERNATE_OBJECT_DIRECTORIES: `${record.object_store.object_directory}${delimiter}${record.object_store.alternate_object_directory}`,
	};
	const run = (args: readonly string[]): string => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...reviewGitEnvironment(), ...diffEnvironment } }).trim();
	for (const tree of [options.initialTree, options.candidateTree]) {
		if (!OBJECT_ID.test(tree)) throw new JeroSnapshotError("Correction tree is not a Git object ID");
		let kind: string;
		try {
			kind = run(["cat-file", "-t", tree]);
		} catch {
			throw new JeroSnapshotError(`Correction tree ${tree} does not resolve in the snapshot object store`);
		}
		if (kind !== "tree") throw new JeroSnapshotError(`Correction object ${tree} is a ${kind}, not a tree`);
	}
	const genesis = new Set(options.genesisPaths);
	const { stats } = parseNumstat(run(["diff", "--numstat", "--no-renames", options.initialTree, options.candidateTree]));
	let lines = 0;
	const touchedNonGenesisPaths: string[] = [];
	for (const stat of stats) {
		if (!genesis.has(stat.path)) {
			touchedNonGenesisPaths.push(stat.path);
			continue;
		}
		if (stat.binary) throw new JeroSnapshotError(`Correction introduces a binary change in ${stat.path}; its line count cannot be verified`);
		lines += stat.additions + stat.deletions;
	}
	return { lines, touchedNonGenesisPaths: [...new Set(touchedNonGenesisPaths)].toSorted() };
}
