// 候选视图 git 层：git 探测/树解析/变更清单/基解析/检出与安全断言。
// 自 lib/review-candidate-view.ts 拆分（机械平移，语义零改动）。

import {
	execFileSync,
	type ExecFileSyncOptions
} from "node:child_process";
import {
	createHash
} from "node:crypto";
import {
	chmodSync,
	existsSync,
	lstatSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	readlinkSync,
	realpathSync
} from "node:fs";
import {
	dirname,
	isAbsolute,
	join,
	relative,
	resolve,
	sep
} from "node:path";
import {
	type ZlibOptions
} from "node:zlib";
import {
	type CandidateViewOwner,
	prepareCandidateOwnerParent
} from "./review-candidate-view-owner.ts";
import {
	materializeCandidateView
} from "./review-candidate-view-materialize.ts";
export const REVIEW_LENS = ["review-risk", "review-resilience", "review-readability", "review-reliability"] as const;
export type ReviewLens = (typeof REVIEW_LENS)[number];
const CANDIDATE_GIT_TIMEOUT_MS = 10_000;
const CANDIDATE_GIT_TIMEOUT_MAX_MS = 120_000;
const CANDIDATE_GIT_TIMEOUT_ENV = "JERO_PI_CANDIDATE_GIT_TIMEOUT_MS";
const CANDIDATE_GIT_MAX_BUFFER_BYTES = 64 * 1024 * 1024;
// 保持拷贝的索引比其来源至少落后一个时间戳刻度。两秒的
// 目标值也能覆盖 mtime 粒度为秒或更粗的文件系统，
// 同时避免无谓地赋予一个任意的历史时间戳。
export const PRIVATE_INDEX_RACY_SAFETY_NS = 1_000_000_000n;
export const PRIVATE_INDEX_RACY_BACKDATE_NS = 2_000_000_000n;

// 候选视图可能物化完整仓库树。大型仓库可以调高
// 这个有界期限，而不会产生无界子进程。
function resolveCandidateGitTimeoutMs(environment: NodeJS.ProcessEnv = process.env): number {
	const value = environment[CANDIDATE_GIT_TIMEOUT_ENV];
	if (value === undefined || !/^[1-9]\d*$/.test(value)) return CANDIDATE_GIT_TIMEOUT_MS;
	const parsed = Number(value);
	return Number.isSafeInteger(parsed) && parsed <= CANDIDATE_GIT_TIMEOUT_MAX_MS
		? parsed
		: CANDIDATE_GIT_TIMEOUT_MS;
}

function isCandidateGitTimeoutMs(value: number): boolean {
	return Number.isSafeInteger(value) && value > 0 && value <= CANDIDATE_GIT_TIMEOUT_MAX_MS;
}
const CANDIDATE_VIEW_DIAGNOSTIC_PHASE = "candidate-view";
const CANDIDATE_VIEW_GIT_FAILURE_CATEGORY = {
	TIMEOUT: "timeout",
	OUTPUT_LIMIT: "output-limit",
	GIT_FAILURE: "git-failure",
} as const;
export type CandidateViewGitFailureCategory = (typeof CANDIDATE_VIEW_GIT_FAILURE_CATEGORY)[keyof typeof CANDIDATE_VIEW_GIT_FAILURE_CATEGORY];
const CANDIDATE_GIT_SUBCOMMAND = {
	ADD: "add",
	CHECKOUT_INDEX: "checkout-index",
	DIFF: "diff",
	FOR_EACH_REF: "for-each-ref",
	LOG: "log",
	LS_FILES: "ls-files",
	LS_TREE: "ls-tree",
	READ_TREE: "read-tree",
	REV_PARSE: "rev-parse",
	WORKTREE: "worktree",
	WRITE_TREE: "write-tree",
	OTHER: "other",
} as const;
type CandidateGitSubcommand = (typeof CANDIDATE_GIT_SUBCOMMAND)[keyof typeof CANDIDATE_GIT_SUBCOMMAND];

export type CandidateGitExecutor = (file: string, arguments_: readonly string[], options: ExecFileSyncOptions) => string | Buffer;
export const defaultCandidateGitExecutor: CandidateGitExecutor = (file, arguments_, options) => execFileSync(file, arguments_, options);

export const CONTROLLER_CANDIDATE_VIEW_HEADING = "## Controller-owned candidate view";
export const MAX_SUBAGENT_TASK_LENGTH = 16_384;
export const MAX_SUBAGENT_CONTEXT_LENGTH = 4_096;
export const MAX_CANDIDATE_CONTEXT_LENGTH = 4_096;
export const MAX_CANDIDATE_CONTEXT_MANIFEST_BYTES = 1024 * 1024;
// Node 的 gzip 运行时接受 mtime 选项，但 @types/node 的 ZlibOptions 未收录；
// 固定 mtime=0 使规范化输出确定性可复现。测试复用同一常量构造传输编码。
export const CANONICAL_GZIP_OPTIONS: ZlibOptions = { mtime: 0 } as ZlibOptions & { mtime: number };
export const MAX_CANDIDATE_SCOPE_PAGE_BYTES = 16 * 1024;
export const MAX_CANDIDATE_SCOPE_PAGE_ENTRIES = 128;
export const CANDIDATE_CONTEXT_MANIFEST = {
	VERSION: 1,
} as const;
export const CANDIDATE_CONTEXT_MODE = {
	REGULAR: "100644",
	EXECUTABLE: "100755",
	SYMLINK: "120000",
	GITLINK: "160000",
	DELETED: "deleted",
} as const;
export type CandidateContextMode = (typeof CANDIDATE_CONTEXT_MODE)[keyof typeof CANDIDATE_CONTEXT_MODE];
export const SUBAGENT_RUN_KEYS = new Set(["agent", "agents", "task", "context", "mode"]);

interface CandidateTreeEntry {
	path: string;
	mode: string;
	objectId: string;
}

interface CandidateViewEntry extends CandidateTreeEntry {
	contentHash: string;
}

interface CandidateGitlink extends CandidateTreeEntry { mode: "160000"; }
interface ParsedCandidateTree { entries: CandidateTreeEntry[]; gitlinks: CandidateGitlink[]; }

interface CandidateViewScope {
	paths: readonly string[];
	modes: Readonly<Record<string, string>>;
	gitlinks: Readonly<Record<string, string>>;
	deletedPaths: readonly string[];
}

export interface CandidateViewRecord {
	owner: CandidateViewOwner;
	token: string;
	root: string;
	parent: string;
	contributorRoot: string;
	commonDir: string;
	baseCommit: string;
	baseTree: string;
	candidateTree: string;
	committedOnly: boolean;
	intendedUntracked?: readonly string[];
	entries: readonly CandidateViewEntry[];
	gitlinks: readonly CandidateGitlink[];
	scope: CandidateViewScope;
	lineageId?: string;
	selectedLenses?: readonly ReviewLens[];
	gitExecutor: CandidateGitExecutor;
}

export interface CandidateView {
	token: string;
	root: string;
	contributorRoot: string;
	baseCommit: string;
	baseTree: string;
	candidateTree: string;
	committedOnly: boolean;
	intendedUntracked?: readonly string[];
	paths: readonly string[];
	modes: Readonly<Record<string, string>>;
	gitlinks: Readonly<Record<string, string>>;
	deletedPaths: readonly string[];
	verify(): void;
	cleanup(): void;
}

export interface CandidateContextManifest {
	version: typeof CANDIDATE_CONTEXT_MANIFEST.VERSION;
	scopeByMode: Readonly<Record<string, readonly string[]>>;
	gitlinks: Readonly<Record<string, string>>;
}

export interface DecodedCandidateContextManifest {
	manifest: CandidateContextManifest;
	bytes: Buffer;
	sha256: string;
}

export interface CandidateContextPageEntry {
	path: string;
	mode: CandidateContextMode;
	gitlinkObjectId?: string;
}

export interface CandidateContextPage {
	version: typeof CANDIDATE_CONTEXT_MANIFEST.VERSION;
	sha256: string;
	cursor: number;
	totalPaths: number;
	entries: readonly CandidateContextPageEntry[];
	nextCursor?: number;
}

export interface FrozenCandidateProjection {
	contributorRoot: string;
	baseCommit: string;
	baseTree: string;
	candidateTree: string;
	committedOnly: boolean;
	intendedUntracked?: readonly string[];
	paths: readonly string[];
	modes: Readonly<Record<string, string>>;
	gitlinks: Readonly<Record<string, string>>;
	deletedPaths: readonly string[];
}

export interface CreateCandidateViewRequest {
	contributorRoot: string;
	baseRef?: string;
	committedOnly?: boolean;
	/** undefined 保留旧的全量未跟踪捕获；[] 排除未跟踪文件。 */
	intendedUntracked?: readonly string[];
	replayKey?: string;
}

export interface BindCandidateViewRequest {
	token: string;
	lineageId: string;
	selectedLenses: readonly string[];
}

export interface AuthoritativeReviewingCandidateState {
	lineageId: string;
	contributorRoot: string;
	baseCommit: string;
	baseTree: string;
	candidateTree: string;
	committedOnly?: boolean;
	intendedUntracked?: readonly string[];
	paths: readonly string[];
	modes: Readonly<Record<string, string>>;
	gitlinks?: Readonly<Record<string, string>>;
	deletedPaths: readonly string[];
	selectedLenses: readonly string[];
}

export interface NativeCandidateProjectionDescriptor {
	baseTree: string;
	currentCandidateTree: string;
	paths: readonly string[];
	intendedUntracked: readonly string[];
	projection: "workspace" | "staged";
	// 设为可选以保持 Phase 3 只做增量：既有调用方保持旧的
	// 排序路径行为，直到 v2 切换提供 manifest。
	manifest?: readonly ChangedPathEntry[];
	// 提供方产物主体的 `changed_path_manifest_sha256` 声明。
	// 生产调用方会跨所有 collect 输入及其产物主体校验
	// 该字段；手工构造的描述符仍可用 Pi 的本地摘要
	// 做自洽检查。
	manifestSha256?: string;
	// 仅由生产状态适配器在逐一检查每个提供方签发的
	// collect 输入与产物主体并得到同一个哈希后设置。
	// 刻意不在这里重新实现提供方的规范化。
	providerManifestHashVerified?: true;
}

export interface CandidateViewDiagnostic {
	phase: typeof CANDIDATE_VIEW_DIAGNOSTIC_PHASE;
	category: CandidateViewGitFailureCategory;
	git_subcommand: CandidateGitSubcommand;
	timeout_ms: number;
	max_buffer_bytes: number;
	message: string;
}

export class CandidateViewError extends Error {
	readonly reason: string;
	readonly diagnostics?: CandidateViewDiagnostic;
	constructor(message: string, reason = "candidate-view-invalid", diagnostics?: CandidateViewDiagnostic, options?: ErrorOptions) {
		super(message, options);
		this.name = "CandidateViewError";
		this.reason = reason;
		this.diagnostics = diagnostics === undefined ? undefined : sanitizeCandidateViewDiagnostic(diagnostics);
	}
}

function candidateGitSubcommand(arguments_: readonly string[]): CandidateGitSubcommand {
	switch (arguments_[0]) {
		case CANDIDATE_GIT_SUBCOMMAND.ADD: return CANDIDATE_GIT_SUBCOMMAND.ADD;
		case CANDIDATE_GIT_SUBCOMMAND.CHECKOUT_INDEX: return CANDIDATE_GIT_SUBCOMMAND.CHECKOUT_INDEX;
		case CANDIDATE_GIT_SUBCOMMAND.DIFF: return CANDIDATE_GIT_SUBCOMMAND.DIFF;
		case CANDIDATE_GIT_SUBCOMMAND.FOR_EACH_REF: return CANDIDATE_GIT_SUBCOMMAND.FOR_EACH_REF;
		case CANDIDATE_GIT_SUBCOMMAND.LOG: return CANDIDATE_GIT_SUBCOMMAND.LOG;
		case CANDIDATE_GIT_SUBCOMMAND.LS_FILES: return CANDIDATE_GIT_SUBCOMMAND.LS_FILES;
		case CANDIDATE_GIT_SUBCOMMAND.LS_TREE: return CANDIDATE_GIT_SUBCOMMAND.LS_TREE;
		case CANDIDATE_GIT_SUBCOMMAND.READ_TREE: return CANDIDATE_GIT_SUBCOMMAND.READ_TREE;
		case CANDIDATE_GIT_SUBCOMMAND.REV_PARSE: return CANDIDATE_GIT_SUBCOMMAND.REV_PARSE;
		case CANDIDATE_GIT_SUBCOMMAND.WORKTREE: return CANDIDATE_GIT_SUBCOMMAND.WORKTREE;
		case CANDIDATE_GIT_SUBCOMMAND.WRITE_TREE: return CANDIDATE_GIT_SUBCOMMAND.WRITE_TREE;
		default: return CANDIDATE_GIT_SUBCOMMAND.OTHER;
	}
}

function candidateGitDiagnosticMessage(category: CandidateViewGitFailureCategory, subcommand: CandidateGitSubcommand, timeoutMs: number): string {
	if (category === CANDIDATE_VIEW_GIT_FAILURE_CATEGORY.TIMEOUT) return `candidate-view Git command ${subcommand} timed out after ${timeoutMs}ms; inspect the candidate state before any new START`;
	if (category === CANDIDATE_VIEW_GIT_FAILURE_CATEGORY.OUTPUT_LIMIT) return `candidate-view Git command ${subcommand} exceeded the ${CANDIDATE_GIT_MAX_BUFFER_BYTES}-byte output limit; inspect the candidate state before any new START`;
	return `candidate-view Git command ${subcommand} failed; inspect the candidate state before any new START`;
}

function candidateGitDiagnostic(category: CandidateViewGitFailureCategory, arguments_: readonly string[], timeoutMs: number): CandidateViewDiagnostic {
	const git_subcommand = candidateGitSubcommand(arguments_);
	return Object.freeze({
		phase: CANDIDATE_VIEW_DIAGNOSTIC_PHASE,
		category,
		git_subcommand,
		timeout_ms: timeoutMs,
		max_buffer_bytes: CANDIDATE_GIT_MAX_BUFFER_BYTES,
		message: candidateGitDiagnosticMessage(category, git_subcommand, timeoutMs),
	});
}

function sanitizeCandidateViewDiagnostic(diagnostics: CandidateViewDiagnostic): CandidateViewDiagnostic | undefined {
	const { phase, category, git_subcommand, timeout_ms, max_buffer_bytes, message } = diagnostics;
	if (
		phase !== CANDIDATE_VIEW_DIAGNOSTIC_PHASE ||
		!Object.values(CANDIDATE_VIEW_GIT_FAILURE_CATEGORY).includes(category) ||
		!Object.values(CANDIDATE_GIT_SUBCOMMAND).includes(git_subcommand) ||
		!isCandidateGitTimeoutMs(timeout_ms) ||
		max_buffer_bytes !== CANDIDATE_GIT_MAX_BUFFER_BYTES ||
		message !== candidateGitDiagnosticMessage(category, git_subcommand, timeout_ms)
	) return undefined;
	return Object.freeze({ phase, category, git_subcommand, timeout_ms, max_buffer_bytes, message });
}

function candidateGitFailure(category: CandidateViewGitFailureCategory, arguments_: readonly string[], timeoutMs: number): CandidateViewError {
	const diagnostics = candidateGitDiagnostic(category, arguments_, timeoutMs);
	return new CandidateViewError(diagnostics.message, `candidate-view-${category}`, diagnostics);
}

function candidateGit(cwd: string, arguments_: readonly string[], env: NodeJS.ProcessEnv, encoding: "utf8" | "buffer", executor: CandidateGitExecutor): string | Buffer {
	const timeoutMs = resolveCandidateGitTimeoutMs(env);
	// 候选视图必须字节精确：冻结树进、冻结树出。宿主的全局
	// core.autocrlf（Windows 常见 autocrlf=true）会在 add 与 checkout
	// 两侧改写字节，物化读回即与冻结内容不一致。配置经 GIT_CONFIG_*
	// 环境变量注入——不改动参数列表，executor 的参数断言不受影响。
	const canonicalEnv: NodeJS.ProcessEnv = {
		...env,
		GIT_CONFIG_COUNT: "3",
		GIT_CONFIG_KEY_0: "core.autocrlf",
		GIT_CONFIG_VALUE_0: "false",
		GIT_CONFIG_KEY_1: "core.eol",
		GIT_CONFIG_VALUE_1: "lf",
		// 候选 worktree 位于 .git/jero-review/candidate-views/<uuid> 之下，
		// 叠加长文件名后轻易超过 Windows MAX_PATH；git 默认 core.longpaths=false
		// 会在 checkout 阶段拒绝。Node 侧已支持长路径，这里对齐。
		GIT_CONFIG_KEY_2: "core.longpaths",
		GIT_CONFIG_VALUE_2: "true",
	};
	try {
		return executor("git", arguments_, {
			cwd,
			encoding,
			env: canonicalEnv,
			stdio: ["ignore", "pipe", "pipe"],
			timeout: timeoutMs,
			maxBuffer: CANDIDATE_GIT_MAX_BUFFER_BYTES,
			windowsHide: true,
		});
	} catch (error) {
		const detail = error as NodeJS.ErrnoException & { killed?: boolean };
		if (detail.code === "ENOBUFS" || detail.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") throw candidateGitFailure(CANDIDATE_VIEW_GIT_FAILURE_CATEGORY.OUTPUT_LIMIT, arguments_, timeoutMs);
		if (detail.code === "ETIMEDOUT" || detail.killed === true) throw candidateGitFailure(CANDIDATE_VIEW_GIT_FAILURE_CATEGORY.TIMEOUT, arguments_, timeoutMs);
		throw candidateGitFailure(CANDIDATE_VIEW_GIT_FAILURE_CATEGORY.GIT_FAILURE, arguments_, timeoutMs);
	}
}

export function git(cwd: string, arguments_: readonly string[], env: NodeJS.ProcessEnv = process.env, executor: CandidateGitExecutor = defaultCandidateGitExecutor): string {
	return (candidateGit(cwd, arguments_, env, "utf8", executor) as string).trim();
}

export function isWithin(parent: string, path: string): boolean {
	const value = relative(parent, path);
	return value !== "" && value !== ".." && !value.startsWith(`..${sep}`) && !isAbsolute(value);
}

export function isSafeCandidatePath(path: string): boolean {
	return path.length > 0
		&& !isAbsolute(path)
		&& !path.includes("\\")
		&& !/[\u0000-\u001f\u007f]/.test(path)
		&& path.split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

function isMaterializedCandidateMode(mode: string): boolean {
	return mode === "100644" || mode === "100755" || mode === "120000";
}

export function hasExpectedExecutableBits(filesystemMode: number, gitMode: string, platform: NodeJS.Platform = process.platform): boolean {
	return gitMode === "100755" && platform === "win32"
		|| (filesystemMode & 0o111) === (gitMode === "100755" ? 0o111 : 0);
}

export function isCanonicalObjectId(objectId: string): boolean { return /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(objectId); }
export function gitlinkMapsEqual(left: Readonly<Record<string, string>>, right: Readonly<Record<string, string>>): boolean {
	const entries = Object.entries(left);
	return entries.length === Object.keys(right).length && entries.every(([path, objectId]) => right[path] === objectId);
}

// 两个物化候选视图在其基线、候选树、提交状态与变更范围
// 全部一致时，描述的是完全相同的可评审内容。
// 正因如此，重试的原生 START 新鲜物化出的重复视图可以
// 安全丢弃，让位于已绑定的那个（gentle-pi
// candidate-view 重绑缺陷，ga#4085 / ga#4050）：该比较从不
// 信任调用方提供的声明，只信任 materializeCandidateView 已为
// 两条记录算出的 Git 派生身份。
export function candidateRecordsShareIdentity(left: CandidateViewRecord, right: CandidateViewRecord): boolean {
	return left.contributorRoot === right.contributorRoot &&
		left.baseCommit === right.baseCommit &&
		left.baseTree === right.baseTree &&
		left.candidateTree === right.candidateTree &&
		left.committedOnly === right.committedOnly &&
		JSON.stringify(left.intendedUntracked ?? null) === JSON.stringify(right.intendedUntracked ?? null) &&
		JSON.stringify(left.scope.paths) === JSON.stringify(right.scope.paths) &&
		JSON.stringify(left.scope.modes) === JSON.stringify(right.scope.modes) &&
		gitlinkMapsEqual(left.scope.gitlinks, right.scope.gitlinks) &&
		JSON.stringify(left.scope.deletedPaths) === JSON.stringify(right.scope.deletedPaths);
}

function decodeCanonicalPath(value: Buffer): string {
	const path = value.toString("utf8");
	if (!Buffer.from(path, "utf8").equals(value) || !isSafeCandidatePath(path)) {
		throw new CandidateViewError("candidate tree contains an unsafe or noncanonical path");
	}
	return path;
}

function assertSafeSymlinkTarget(root: string, entryPath: string, value: Buffer): void {
	const raw = value.toString("utf8");
	// Windows 的 readlink 会把相对 target 的分隔符规范化为反斜杠；
	// 安全检查在正斜杠规范形上进行（内容哈希仍取原始字节）。
	const target = process.platform === "win32" ? raw.replaceAll("\\", "/") : raw;
	if (
		!Buffer.from(raw, "utf8").equals(value) ||
		target.length === 0 ||
		isAbsolute(target) ||
		/^[A-Za-z]:\//.test(target) ||
		target.includes("\\") ||
		/[\u0000-\u001f\u007f]/.test(target) ||
		target.split("/").some((segment) => segment.length === 0 || segment === ".")
	) {
		throw new CandidateViewError("candidate view symlink target is unsafe");
	}
	const resolvedTarget = resolve(dirname(join(root, entryPath)), target);
	const metadata = join(root, ".git");
	if (!isWithin(root, resolvedTarget) || resolvedTarget === metadata || isWithin(metadata, resolvedTarget)) {
		throw new CandidateViewError("candidate view symlink target escapes its frozen root or enters metadata");
	}
}

function splitNulTerminated(raw: Buffer, errorMessage: string): Buffer[] {
	if (raw.length === 0) return [];
	if (raw.at(-1) !== 0) throw new CandidateViewError(errorMessage);
	const tokens: Buffer[] = [];
	let start = 0;
	for (let index = 0; index < raw.length; index += 1) {
		if (raw[index] === 0) {
			tokens.push(raw.subarray(start, index));
			start = index + 1;
		}
	}
	return tokens;
}

export function parseTree(cwd: string, tree: string, executor: CandidateGitExecutor): ParsedCandidateTree {
	const raw = candidateGit(cwd, ["ls-tree", "-r", "-z", tree], process.env, "buffer", executor) as Buffer;
	const entries: CandidateTreeEntry[] = [];
	const gitlinks: CandidateGitlink[] = [];
	const paths = new Set<string>();
	for (const row of splitNulTerminated(raw, "candidate tree output is not NUL-terminated")) {
		const separator = row.indexOf(0x09);
		if (separator < 0) throw new CandidateViewError("candidate tree contains an unsafe entry");
		const match = /^(100644|100755|120000) blob ([0-9a-f]{40}|[0-9a-f]{64})$|^(160000) commit ([0-9a-f]{40}|[0-9a-f]{64})$/.exec(row.subarray(0, separator).toString("ascii"));
		const path = decodeCanonicalPath(row.subarray(separator + 1));
		if (!match || paths.has(path)) throw new CandidateViewError("candidate tree contains an unsafe entry");
		paths.add(path);
		const mode = match[1] ?? match[3]!;
		const objectId = match[2] ?? match[4]!;
		if (mode === "160000") gitlinks.push({ path, mode, objectId });
		else if (isMaterializedCandidateMode(mode)) entries.push({ path, mode, objectId });
	}
	const compare = (left: CandidateTreeEntry, right: CandidateTreeEntry): number => left.path.localeCompare(right.path);
	entries.sort(compare); gitlinks.sort(compare);
	return { entries, gitlinks };
}

export function gitPathTokens(cwd: string, arguments_: readonly string[], executor: CandidateGitExecutor): Buffer[] {
	const raw = candidateGit(cwd, arguments_, process.env, "buffer", executor) as Buffer;
	return splitNulTerminated(raw, "candidate scope Git output is not NUL-terminated");
}

// 每个变更路径一条 manifest 条目，承载 v2 在
// `changed_path_manifest` 中交付的状态契约。`deriveChangedScope`
// 产不出它：它跑的是 `--name-status`，只报告状态与路径、
// 从不报告旧模式，因此仅模式或类型变更对它不可见。`--raw`
// 携带两个模式与两个 blob id，这才让 `modeOnly` 可判定。
export interface ChangedPathEntry {
	readonly path: string;
	readonly status: string;
	readonly oldMode: string;
	readonly newMode: string;
	readonly deleted: boolean;
	readonly typeChanged: boolean;
	readonly modeOnly: boolean;
}

//
// gentle-pi#518：两处推导都用 `--no-renames` 做 diff，与原生
// 提供方完全一致。重命名因此是源删除加目的
// 新增，各占一条路径，所以 Pi 冻结的投影身份
// 即原生 STATUS 投影的身份。这里的重命名检测此前
// 只保留目的地，导致精确的暂存重命名在被原生
// 准入之前就以 candidate-target-projection-drift 被拒绝。
export function deriveChangedPathManifest(cwd: string, baseTree: string, candidateTree: string, executor: CandidateGitExecutor = defaultCandidateGitExecutor): readonly ChangedPathEntry[] {
	const tokens = gitPathTokens(cwd, ["diff", "--raw", "-z", "--abbrev=40", "--no-ext-diff", "--no-renames", baseTree, candidateTree], executor);
	const entries: ChangedPathEntry[] = [];
	for (let index = 0; index < tokens.length;) {
		const header = tokens[index++]?.toString("ascii");
		if (header === undefined) break;
		// `:<old_mode> <new_mode> <old_sha> <new_sha> <status>`；关闭重命名
		// 检测后，Git 绝不会在这里输出双路径的 R 或 C 记录。
		const match = /^:([0-7]{6}) ([0-7]{6}) ([0-9a-f]{7,64}) ([0-9a-f]{7,64}) ([AMDT])$/.exec(header);
		if (match === null) throw new CandidateViewError("candidate manifest Git output contains an unsafe raw header", "manifest-derivation-invalid");
		const [, oldMode, newMode, oldSha, newSha, status] = match;
		const rawPath = tokens[index++];
		if (rawPath === undefined) throw new CandidateViewError("candidate manifest Git output is incomplete", "manifest-derivation-invalid");
		const path = decodeCanonicalPath(rawPath);
		entries.push(Object.freeze({
			path,
			status,
			oldMode,
			newMode,
			deleted: status === "D",
			typeChanged: status === "T",
			// 两侧 blob 相同而模式不同，正是排序路径
			// 比较永远看不到的情形。
			modeOnly: oldSha === newSha && oldMode !== newMode,
		}));
	}
	return Object.freeze([...entries].sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0)));
}

// Pi 自己的变更路径 manifest 权威摘要：按路径排序，使用
// v2 `changed_path` schema 的 wire（snake_case）字段名。这
// 刻意不是要逐字节复现提供方未公开的
// `changed_path_manifest_sha256` 规范化（design.md 的
// 开放问题）。它是 Pi 自己的自洽检查：描述符携带的
// manifest 是否摘要出与描述符所声明一致的值？提供
// manifest 与所声明摘要彼此矛盾的调用方（或被篡改的
// 传输）在这里被抓住，独立于且先于
// 与实时 Git 内容的任何比较。
export function digestChangedPathManifest(manifest: readonly ChangedPathEntry[]): string {
	const canonical = [...manifest]
		.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0))
		.map((entry) => ({
			path: entry.path,
			status: entry.status,
			old_mode: entry.oldMode,
			new_mode: entry.newMode,
			deleted: entry.deleted,
			type_changed: entry.typeChanged,
			mode_only: entry.modeOnly,
		}));
	return `sha256:${createHash("sha256").update(JSON.stringify(canonical)).digest("hex")}`;
}

export function assertManifestMatchesGit(descriptor: NativeCandidateProjectionDescriptor, derived: readonly ChangedPathEntry[]): void {
	const claimed = descriptor.manifest;
	if (claimed === undefined) return;

	// 自洽性：manifest 是否摘要出主体为其声明的
	// 值？先于任何 Git 比较检查，与 input-divergence 一样。
	if (descriptor.manifestSha256 !== undefined && descriptor.providerManifestHashVerified !== true && digestChangedPathManifest(claimed) !== descriptor.manifestSha256) {
		throw new CandidateViewError("native manifest does not digest to its own artifact-subject claim", "manifest-subject-drift");
	}

	// 第一步：提供方自身的输入是否自洽？一个不
	// 描述描述符路径的 manifest 不是漂移观测，而是
	// 格式错误的输入；单独说明这一点能让诊断保持诚实。
	const claimedPaths = [...claimed.map((entry) => entry.path)].sort();
	if (JSON.stringify(claimedPaths) !== JSON.stringify([...descriptor.paths].sort())) {
		throw new CandidateViewError("native manifest does not describe the same paths as its own projection", "manifest-input-divergence");
	}

	const derivedByPath = new Map(derived.map((entry) => [entry.path, entry]));
	if (JSON.stringify(claimedPaths) !== JSON.stringify(derived.map((entry) => entry.path))) {
		throw new CandidateViewError("native manifest paths do not match Git content", "manifest-path-set-drift");
	}

	for (const entry of claimed) {
		const actual = derivedByPath.get(entry.path);
		if (actual === undefined) throw new CandidateViewError("native manifest paths do not match Git content", "manifest-path-set-drift");
		if (entry.status !== actual.status || entry.deleted !== actual.deleted) {
			throw new CandidateViewError(`native manifest status for ${entry.path} does not match Git content`, "manifest-status-drift");
		}
		if (entry.oldMode !== actual.oldMode || entry.newMode !== actual.newMode || entry.modeOnly !== actual.modeOnly || entry.typeChanged !== actual.typeChanged) {
			throw new CandidateViewError(`native manifest mode state for ${entry.path} does not match Git content`, "manifest-mode-drift");
		}
	}
}

export function deriveChangedScope(cwd: string, baseTree: string, candidateTree: string, entries: readonly CandidateTreeEntry[], executor: CandidateGitExecutor): CandidateViewScope {
	const present = new Map(entries.map((entry) => [entry.path, entry]));
	const paths = new Set<string>();
	const deleted = new Set<string>();
	// `--no-renames` 镜像原生投影：重命名是一条删除
	// 路径加一条新增路径（gentle-pi#518），且每条记录
	// 恰好携带一条路径。
	const tokens = gitPathTokens(cwd, ["diff", "--name-status", "-z", "--no-ext-diff", "--no-renames", baseTree, candidateTree], executor);
	for (let index = 0; index < tokens.length;) {
		const status = tokens[index++]?.toString("ascii");
		if (status === undefined || !/^[AMDT]$/.test(status)) throw new CandidateViewError("candidate scope Git output contains an unsafe status");
		const rawPath = tokens[index++];
		if (rawPath === undefined) throw new CandidateViewError("candidate scope Git output is incomplete");
		const path = decodeCanonicalPath(rawPath);
		if (paths.has(path) || deleted.has(path)) throw new CandidateViewError("candidate scope Git output contains duplicate paths");
		if (status === "D") {
			if (present.has(path)) throw new CandidateViewError("candidate scope deletion is present in the candidate tree");
			deleted.add(path);
		} else {
			if (!present.has(path)) throw new CandidateViewError("candidate scope path is absent from the candidate tree");
			paths.add(path);
		}
	}
	const presentPaths = [...paths].sort();
	const deletedPaths = [...deleted].sort();
	const allPaths = [...presentPaths, ...deletedPaths].sort();
	return {
		paths: allPaths,
		modes: Object.fromEntries(presentPaths.map((path) => [path, present.get(path)!.mode])),
		gitlinks: Object.fromEntries(presentPaths.flatMap((path) => {
			const entry = present.get(path)!;
			return entry.mode === "160000" ? [[path, entry.objectId]] : [];
		})),
		deletedPaths,
	};
}

export function entryContentHash(root: string, entry: CandidateTreeEntry): string {
	const path = join(root, entry.path);
	const item = lstatSync(path);
	if (entry.mode === "120000") {
		if (!item.isSymbolicLink()) throw new CandidateViewError("candidate view symlink does not match its frozen tree");
		const target = readlinkSync(path, "buffer");
		const bytes = Buffer.isBuffer(target) ? target : Buffer.from(target);
		assertSafeSymlinkTarget(root, entry.path, bytes);
		return createHash("sha256").update(bytes).digest("hex");
	}
	if (!item.isFile() || item.isSymbolicLink()) throw new CandidateViewError("candidate view entry does not match its frozen tree");
	return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function candidateDirectories(root: string, entries: readonly CandidateViewEntry[]): string[] {
	const directories = new Set([root]);
	for (const entry of entries) {
		for (let path = dirname(join(root, entry.path)); isWithin(root, path) || path === root; path = dirname(path)) {
			directories.add(path);
			if (path === root) break;
		}
	}
	return [...directories].sort((left, right) => right.length - left.length);
}

export function makeReadonly(root: string, entries: readonly CandidateViewEntry[]): void {
	for (const entry of entries) {
		if (entry.mode !== "120000") chmodSync(join(root, entry.path), entry.mode === "100755" ? 0o555 : 0o444);
	}
	const gitFile = join(root, ".git");
	const metadata = lstatSync(gitFile);
	if (!metadata.isFile() || metadata.isSymbolicLink()) throw new CandidateViewError("candidate worktree metadata is unsafe");
	chmodSync(gitFile, 0o444);
	for (const directory of candidateDirectories(root, entries)) chmodSync(directory, 0o555);
}

export function makeWritableForCleanup(path: string): void {
	const entry = lstatSync(path, { throwIfNoEntry: false });
	if (!entry || entry.isSymbolicLink()) return;
	if (entry.isDirectory()) {
		for (const child of readdirSync(path)) makeWritableForCleanup(join(path, child));
		chmodSync(path, 0o755);
		return;
	}
	chmodSync(path, 0o644);
}

export function candidateViewParent(commonDir: string, platform: NodeJS.Platform): string {
	const control = join(commonDir, "jero-review");
	mkdirSync(control, { recursive: true, mode: 0o700 });
	const controlStat = lstatSync(control);
	if (!controlStat.isDirectory() || controlStat.isSymbolicLink() || realpathSync(control) !== control) throw new CandidateViewError("candidate view ancestor is unsafe");
	const parent = join(control, "candidate-views");
	mkdirSync(parent, { recursive: true, mode: 0o700 });
	const stat = lstatSync(parent);
	if (!stat.isDirectory() || stat.isSymbolicLink()) throw new CandidateViewError("candidate view parent is unsafe");
	try {
		return prepareCandidateOwnerParent(commonDir, platform);
	} catch (error) {
		throw new CandidateViewError("candidate view owner preparation failed", "candidate-owner-preparation-failed", undefined, { cause: error });
	}
}

export interface ResolvedCandidateBase {
	commit: string;
	tree: string;
}

export function isFullCommitId(selector: string): boolean {
	return /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(selector);
}

function explicitBaseRefCandidates(cwd: string, selector: string, env: NodeJS.ProcessEnv, executor: CandidateGitExecutor): string[] {
	if (selector === "HEAD" || isFullCommitId(selector)) return [selector];
	const refs = new Set(git(cwd, ["for-each-ref", "--format=%(refname)"], env, executor).split("\n").filter((ref) => ref.length > 0));
	const candidates = selector.startsWith("refs/")
		? [selector]
		: [
			`refs/${selector}`,
			`refs/tags/${selector}`,
			`refs/heads/${selector}`,
			`refs/remotes/${selector}`,
			`refs/remotes/${selector}/HEAD`,
		];
	return [...new Set(candidates)].filter((candidate) => refs.has(candidate));
}

// 运行一个可能以非零退出作为预期信号（引用
// 不存在、分离 HEAD）的探测命令。返回退出状态与裁剪过的 stdout。
// 超时、输出超限与意外的 Git 失败以经过净化的
// CandidateViewError 诊断传播，与 candidateGit 相同。
function probeCandidateGit(cwd: string, arguments_: readonly string[], env: NodeJS.ProcessEnv, executor: CandidateGitExecutor): { status: number; stdout: string } {
	const timeoutMs = resolveCandidateGitTimeoutMs(env);
	try {
		const stdout = executor("git", arguments_, {
			cwd, encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"],
			timeout: timeoutMs, maxBuffer: CANDIDATE_GIT_MAX_BUFFER_BYTES, windowsHide: true,
		}) as string;
		return { status: 0, stdout: stdout.trim() };
	} catch (error) {
		const detail = error as NodeJS.ErrnoException & { killed?: boolean; status?: number; stdout?: string | Buffer };
		if (detail.code === "ENOBUFS" || detail.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") throw candidateGitFailure(CANDIDATE_VIEW_GIT_FAILURE_CATEGORY.OUTPUT_LIMIT, arguments_, timeoutMs);
		if (detail.code === "ETIMEDOUT" || detail.killed === true) throw candidateGitFailure(CANDIDATE_VIEW_GIT_FAILURE_CATEGORY.TIMEOUT, arguments_, timeoutMs);
		if (typeof detail.status === "number") return { status: detail.status, stdout: typeof detail.stdout === "string" ? detail.stdout.trim() : "" };
		throw candidateGitFailure(CANDIDATE_VIEW_GIT_FAILURE_CATEGORY.GIT_FAILURE, arguments_, timeoutMs);
	}
}

// 未诞生仓库的 HEAD 是指向无提交分支的符号引用。
// `symbolic-ref --quiet HEAD` 对分离 HEAD（非未诞生）以非零退出。
// `rev-parse --verify --quiet <ref>` 区分合法的未诞生（状态 1、
// 引用不存在）与损坏的符号引用（退出 0，即使对象
// 缺失也存在引用 OID 文本）。任何其他状态（128 等）都表示
// 损坏或 I/O 失败，因此保守失败而不是
// 伪装成未诞生仓库。
function isUnbornSymbolicHead(cwd: string, env: NodeJS.ProcessEnv, executor: CandidateGitExecutor): boolean {
	const symbolic = probeCandidateGit(cwd, ["symbolic-ref", "--quiet", "HEAD"], env, executor);
	if (symbolic.status !== 0) return false;
	const refProbeArguments = ["rev-parse", "--verify", "--quiet", symbolic.stdout];
	const refProbe = probeCandidateGit(cwd, refProbeArguments, env, executor);
	if (refProbe.status === 1) return true;
	if (refProbe.status === 0) return false;
	throw candidateGitFailure(CANDIDATE_VIEW_GIT_FAILURE_CATEGORY.GIT_FAILURE, refProbeArguments, resolveCandidateGitTimeoutMs(env));
}

// 推导 Git 仓库原生的空树而不硬编码 SHA-1 id，
// 使 sha256 仓库推导自己的空树对象 id。忽略 stdin 的
// `mktree` 读入空输入并写出空树对象。
function resolveEmptyTree(cwd: string, env: NodeJS.ProcessEnv, executor: CandidateGitExecutor): string {
	return git(cwd, ["mktree"], env, executor);
}

export function resolveCandidateBase(cwd: string, baseRef: string | undefined, env: NodeJS.ProcessEnv, executor: CandidateGitExecutor): ResolvedCandidateBase {
	const selector = baseRef ?? "HEAD";
	// 未诞生仓库的 HEAD 符号指向尚无提交的分支。其
	// 评审基线是 Git 仓库原生的空树，而不是缺失
	// 或格式错误的提交。只有默认/HEAD 选择器有资格使用
	// 空树基线；指向缺失提交的分离 HEAD 保持保守失败。
	if (selector === "HEAD" && isUnbornSymbolicHead(cwd, env, executor)) {
		return { commit: "HEAD", tree: resolveEmptyTree(cwd, env, executor) };
	}
	try {
		if (baseRef !== undefined) {
			const candidates = explicitBaseRefCandidates(cwd, selector, env, executor);
			if (candidates.length > 1) throw new CandidateViewError("candidate base reference is ambiguous", "base-ref-ambiguous");
			if (candidates.length === 0) throw new CandidateViewError("candidate base reference is unresolvable", "base-ref-unresolvable");
		}
		const firstCommit = git(cwd, ["rev-parse", "--verify", "--end-of-options", `${selector}^{commit}`], env, executor);
		const tree = git(cwd, ["rev-parse", "--verify", "--end-of-options", `${firstCommit}^{tree}`], env, executor);
		const confirmedCommit = git(cwd, ["rev-parse", "--verify", "--end-of-options", `${selector}^{commit}`], env, executor);
		if (firstCommit !== confirmedCommit) throw new CandidateViewError("candidate base reference moved during resolution", "base-ref-moved");
		const confirmedTree = git(cwd, ["rev-parse", "--verify", "--end-of-options", `${confirmedCommit}^{tree}`], env, executor);
		if (tree !== confirmedTree) throw new CandidateViewError("candidate base tree changed during resolution", "base-ref-moved");
		return { commit: confirmedCommit, tree: confirmedTree };
	} catch (error) {
		if (error instanceof CandidateViewError && (error.diagnostics !== undefined || error.reason === "base-ref-ambiguous" || error.reason === "base-ref-moved" || error.reason === "base-ref-unresolvable")) throw error;
		throw new CandidateViewError("candidate base reference is unresolvable", "base-ref-unresolvable");
	}
}

export function resolveCandidateBaseTree(cwd: string, baseTree: string, executor: CandidateGitExecutor): ResolvedCandidateBase {
	const row = git(cwd, ["log", "--format=%H%x09%T", "HEAD"], process.env, executor)
		.split("\n")
		.find((entry) => entry.endsWith(`\t${baseTree}`));
	if (row === undefined) throw new CandidateViewError("native projection base is not reachable from HEAD");
	const base = resolveCandidateBase(cwd, row.slice(0, row.indexOf("\t")), process.env, executor);
	if (base.tree !== baseTree) throw new CandidateViewError("native projection base tree is inconsistent");
	return base;
}

export function resolveCanonicalCandidateBase(contributorRoot: string, baseRef: string): ResolvedCandidateBase {
	return resolveCandidateBase(realpathSync(contributorRoot), baseRef, process.env, defaultCandidateGitExecutor);
}

export function checkoutMaterializedEntries(root: string, entries: readonly CandidateTreeEntry[], executor: CandidateGitExecutor): void {
	let batch: string[] = [];
	let bytes = 0;
	const flush = (): void => {
		if (batch.length === 0) return;
		// core.symlinks=true：冻结树里的 120000 条目必须物化为真符号链接。
		// Windows 默认 core.symlinks=false 会把链接写成"目标文本"普通文件，
		// 随后的 entryContentHash 一致性校验即失败；平台确实无链接权限时
		// git 自行报错、视图创建保守失败，语义不变。
		git(root, ["-c", "core.symlinks=true", "checkout-index", "-f", "--", ...batch], process.env, executor);
		batch = []; bytes = 0;
	};
	for (const entry of entries) {
		const size = Buffer.byteLength(entry.path, "utf8") + 1;
		if (batch.length > 0 && bytes + size > 16_384) flush();
		batch.push(entry.path); bytes += size;
	}
	flush();
}

// 创建未诞生工作树（HEAD 符号指向无提交的分支、
// 不写引用、无幻影提交）。Git 2.42+ 直接支持
// --orphan；更老的 Git 没有该标志并报告
// unsupported-option 用法错误（退出状态 129）。只有该精确
// 状态才触发回退：先由临时空树提交种子一个分离的
// --no-checkout 工作树，再用 symbolic-ref 重写使 HEAD
// 未诞生。临时提交不被任何引用引用、可被
// GC，因此不是幻影提交。回退在拷贝的
// 环境中使用确定性的作者/提交者身份与时间戳，
// 因而不依赖 user.name/user.email 或
// 当前日期。贡献者的 HEAD、分支、引用与索引绝不被触碰。
export function addUnbornWorktree(cwd: string, root: string, branch: string, env: NodeJS.ProcessEnv, executor: CandidateGitExecutor): void {
	const primary = probeCandidateGit(cwd, ["worktree", "add", "--orphan", "-b", branch, root], env, executor);
	if (primary.status === 0) return;
	// 只有 unsupported-option 用法状态（129，缺 --orphan 的
	// 2.42 之前 Git）才触发回退。其他状态一律作为 git-failure 传播。
	if (primary.status !== 129 || existsSync(root)) throw candidateGitFailure(CANDIDATE_VIEW_GIT_FAILURE_CATEGORY.GIT_FAILURE, ["worktree", "add", "--orphan", "-b", branch, root], resolveCandidateGitTimeoutMs(env));
	const fallbackEnv = {
		...env,
		GIT_AUTHOR_NAME: "jero-candidate",
		GIT_AUTHOR_EMAIL: "jero-candidate@example.invalid",
		GIT_AUTHOR_DATE: "2000-01-01T00:00:00Z",
		GIT_COMMITTER_NAME: "jero-candidate",
		GIT_COMMITTER_EMAIL: "jero-candidate@example.invalid",
		GIT_COMMITTER_DATE: "2000-01-01T00:00:00Z",
	};
	const emptyTree = git(cwd, ["mktree"], fallbackEnv, executor);
	const tempCommit = git(cwd, ["commit-tree", "-m", "jero-candidate", emptyTree], fallbackEnv, executor);
	git(cwd, ["worktree", "add", "--no-checkout", "--detach", root, tempCommit], env, executor);
	git(root, ["symbolic-ref", "HEAD", `refs/heads/${branch}`], env, executor);
}

