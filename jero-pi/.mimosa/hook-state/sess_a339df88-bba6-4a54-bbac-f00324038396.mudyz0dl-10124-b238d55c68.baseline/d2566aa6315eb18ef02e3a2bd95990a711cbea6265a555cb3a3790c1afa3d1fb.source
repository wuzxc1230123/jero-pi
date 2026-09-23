import { execFileSync } from "node:child_process";
import { closeSync, linkSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, statSync, unlinkSync, writeFileSync, fsyncSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { canonicalJsonV1, domainHashV1, parseCanonicalJsonV1 } from "./review-canonical.ts";

const OBJECT_FORMAT = /^(sha1|sha256)$/;
const OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

export class ReviewRepositoryError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ReviewRepositoryError";
	}
}

export interface ReviewRepositoryIdentityBodyV1 {
	schema: "gentle-ai.review-repository/v1";
	object_format: "sha1" | "sha256";
	root_commit_ids: string[];
}

export interface RepositoryAuthorityV1 {
	readonly common_directory: string;
	readonly store_root: string;
	readonly repository_identity: ReviewRepositoryIdentityBodyV1;
	readonly repository_id: string;
	readonly authority_id: string;
}

const UNSAFE_GIT_ENVIRONMENT = new Set([
	"GIT_DIR", "GIT_WORK_TREE", "GIT_COMMON_DIR", "GIT_INDEX_FILE", "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES", "GIT_NAMESPACE", "GIT_QUARANTINE_PATH", "GIT_PREFIX", "GIT_SUPER_PREFIX", "GIT_CEILING_DIRECTORIES", "GIT_DISCOVERY_ACROSS_FILESYSTEM", "GIT_CONFIG", "GIT_CONFIG_GLOBAL", "GIT_CONFIG_SYSTEM", "GIT_CONFIG_NOSYSTEM", "GIT_CONFIG_COUNT", "GIT_REPLACE_REF_BASE", "GIT_NO_REPLACE_OBJECTS", "GIT_SHALLOW_FILE", "GIT_GRAFT_FILE",
]);

const UNSAFE_PUBLICATION_GIT_ENVIRONMENT = new Set([
	...UNSAFE_GIT_ENVIRONMENT,
	"GIT_EXEC_PATH", "GIT_TEMPLATE_DIR", "GIT_CONFIG_PARAMETERS", "GIT_SSH", "GIT_SSH_COMMAND", "GIT_SSH_VARIANT", "GIT_PROXY_COMMAND",
]);

export function inheritedUnsafeGitEnvironmentKeys(
	environment: NodeJS.ProcessEnv = process.env,
): string[] {
	return Object.keys(environment)
		.filter((key) => {
			const normalizedKey = key.toUpperCase();
			return UNSAFE_PUBLICATION_GIT_ENVIRONMENT.has(normalizedKey) || /^GIT_CONFIG_(?:KEY|VALUE)_/.test(normalizedKey);
		})
		.toSorted();
}

export function reviewGitEnvironment(): NodeJS.ProcessEnv {
	for (const key of Object.keys(process.env)) {
		const normalizedKey = key.toUpperCase();
		if (UNSAFE_GIT_ENVIRONMENT.has(normalizedKey) || /^GIT_CONFIG_(?:KEY|VALUE)_/.test(normalizedKey)) throw new ReviewRepositoryError("REVIEW_GIT_ENV_UNSAFE: inherited Git routing/configuration override is present");
	}
	const environment: NodeJS.ProcessEnv = {};
	for (const [key, value] of Object.entries(process.env)) if (!key.startsWith("GIT_")) environment[key] = value;
	environment.GIT_CONFIG_NOSYSTEM = "1";
	environment.GIT_CONFIG_GLOBAL = "/dev/null";
	environment.GIT_CONFIG_SYSTEM = "/dev/null";
	environment.GIT_OPTIONAL_LOCKS = "0";
	environment.LC_ALL = "C";
	environment.LANG = "C";
	return environment;
}

export function publicationProbeGitEnvironment(): NodeJS.ProcessEnv {
	const environment: NodeJS.ProcessEnv = { ...process.env };
	for (const key of inheritedUnsafeGitEnvironmentKeys(environment)) delete environment[key];
	environment.GIT_OPTIONAL_LOCKS = "0";
	environment.LC_ALL = "C";
	environment.LANG = "C";
	return environment;
}

function gitLines(cwd: string, args: string[]): string[] {
	let output: string;
	try {
		output = execFileSync("git", ["-C", resolve(cwd), ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], shell: false, env: reviewGitEnvironment() });
	} catch (error) {
		if (error instanceof ReviewRepositoryError) throw error;
		throw new ReviewRepositoryError("Unable to resolve Git repository authority");
	}
	if (output.includes("\0")) throw new ReviewRepositoryError("Git authority probe returned malformed output");
	return output.split("\n").filter(Boolean);
}

function oneGitLine(cwd: string, args: string[]): string {
	const lines = gitLines(cwd, args);
	if (lines.length !== 1) throw new ReviewRepositoryError("Git authority probe returned an ambiguous value");
	return lines[0]!;
}

export function assertManagedStorePathV1(commonDirectory: string, path: string): string {
	const canonicalCommonDirectory = realpathSync(commonDirectory);
	const resolved = resolve(path);
	if (relative(canonicalCommonDirectory, resolved).startsWith(`..${sep}`) || relative(canonicalCommonDirectory, resolved) === "..") throw new ReviewRepositoryError("Review store path escapes the Git common directory");
	let current = canonicalCommonDirectory;
	for (const part of relative(canonicalCommonDirectory, resolved).split(sep).filter(Boolean)) {
		current = join(current, part);
		try {
			const entry = lstatSync(current);
			if (entry.isSymbolicLink()) throw new ReviewRepositoryError("Review store path contains a symlink or reparse-point redirect");
		} catch (error) {
			if (error instanceof ReviewRepositoryError) throw error;
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new ReviewRepositoryError("Review store path cannot be safely inspected");
		}
	}
	return resolved;
}

// 钉住的根集身份（解决 RESL-001）：仓库/权威身份派生自一个只计算一次
// 的根提交集合——第一次解析该仓库的评审存储时计算，随后作为
// `IDENTITY` 持久化在存储旁边。此后的每次解析都复用该钉住集合来
// 生成 `repository_id`/`authority_id`，而不是从 git 的实时根提交集合
// 重新计算身份，因此事后加入的无关孤立分支或子树合并无法改变身份、
// 使存储成为孤儿。实时根提交集合在每次调用时仍会重新计算，但只是
// 为了校验钉住集合仍是它的子集——孤立分支增加根（子集仍成立，
// 存储继续可用）；存储被移植到无关仓库、或移除了某个钉住根提交的
// 历史重写会破坏子集关系，并以与从前相同的权威不匹配语义保守失败。
export const IDENTITY_FILENAME = "IDENTITY";

function pinnedIdentityPathV1(storeRoot: string): string {
	return join(storeRoot, IDENTITY_FILENAME);
}

function isValidRepositoryIdentityBodyV1(value: unknown): value is ReviewRepositoryIdentityBodyV1 {
	if (typeof value !== "object" || value === null) return false;
	const candidate = value as ReviewRepositoryIdentityBodyV1;
	return (
		candidate.schema === "gentle-ai.review-repository/v1" &&
		OBJECT_FORMAT.test(candidate.object_format) &&
		Array.isArray(candidate.root_commit_ids) &&
		candidate.root_commit_ids.length > 0 &&
		new Set(candidate.root_commit_ids).size === candidate.root_commit_ids.length &&
		candidate.root_commit_ids.every((anchor) => typeof anchor === "string" && OBJECT_ID.test(anchor))
	);
}

// RESL2-002 修复：首次写入 IDENTITY 在 `O_CREAT|O_EXCL`（`{ flag: "wx" }`）
// 下存在竞态，因为文件在创建那一刻就对其余读者可见，而内容尚未写入。
// 下面的安装方式从结构上关闭了该窗口：内容先写入进程唯一的临时文件，
// fsync，然后才硬链接到最终的 IDENTITY 路径——因此最终路径要么尚不
// 存在，要么已持有完整写入的字节，绝不出现部分写入。有界重试额外
// 覆盖仍可能在该路径上观察到瞬时不完整文件的读取（例如由早于本
// 安装模式的进程外写入者产生），同时不掩盖真正的损坏：重试只适用于
// 解析失败，绝不适用于格式完好但内容无效的正文。
let identityReadRetryHookForTesting: (() => void) | undefined;
export function setReviewRepositoryIdentityRetryHookForTesting(hook: (() => void) | undefined): void {
	identityReadRetryHookForTesting = hook;
}
const IDENTITY_READ_RETRY_ATTEMPTS = 5;
const IDENTITY_READ_RETRY_DELAY_MS = 4;

function sleepSyncMs(milliseconds: number): void {
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function readPinnedRepositoryIdentityV1(storeRoot: string): ReviewRepositoryIdentityBodyV1 | undefined {
	for (let attempt = 1; attempt <= IDENTITY_READ_RETRY_ATTEMPTS; attempt += 1) {
		let bytes: Buffer;
		try {
			bytes = readFileSync(pinnedIdentityPathV1(storeRoot));
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
			throw new ReviewRepositoryError("Pinned repository identity is unavailable");
		}
		let parsed: unknown;
		try {
			parsed = parseCanonicalJsonV1(bytes);
		} catch {
			if (attempt < IDENTITY_READ_RETRY_ATTEMPTS) {
				identityReadRetryHookForTesting?.();
				sleepSyncMs(IDENTITY_READ_RETRY_DELAY_MS);
				continue;
			}
			throw new ReviewRepositoryError("Pinned repository identity is malformed");
		}
		if (!isValidRepositoryIdentityBodyV1(parsed)) throw new ReviewRepositoryError("Pinned repository identity is invalid");
		return parsed;
	}
	throw new ReviewRepositoryError("Pinned repository identity is malformed");
}

// 在首次权威解析时钉住仓库 IDENTITY，并在显式的损坏身份恢复期间
// 重新钉住新的 IDENTITY。除这些流程外不供普通使用。
export function writePinnedRepositoryIdentityV1(storeRoot: string, identity: ReviewRepositoryIdentityBodyV1): ReviewRepositoryIdentityBodyV1 {
	mkdirSync(storeRoot, { recursive: true, mode: 0o700 });
	const path = pinnedIdentityPathV1(storeRoot);
	const temporary = `${path}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
	let installed = false;
	try {
		writeFileSync(temporary, canonicalJsonV1(identity), { flag: "wx", mode: 0o600 });
		const temporaryFile = openSync(temporary, "r+");
		try {
			fsyncSync(temporaryFile);
		} finally {
			closeSync(temporaryFile);
		}
		try {
			linkSync(temporary, path);
			installed = true;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
		}
	} catch {
		throw new ReviewRepositoryError("Unable to persist pinned repository identity");
	} finally {
		try {
			unlinkSync(temporary);
		} catch {}
	}
	if (!installed) return readPinnedRepositoryIdentityV1(storeRoot) ?? identity;
	const file = openSync(path, "r+");
	try {
		fsyncSync(file);
	} finally {
		closeSync(file);
	}
	if (process.platform !== "win32") {
		const directory = openSync(storeRoot, "r");
		try {
			fsyncSync(directory);
		} finally {
			closeSync(directory);
		}
	}
	return identity;
}

interface LiveRepositoryProbeV1 {
	canonicalCommonDirectory: string;
	storeRoot: string;
	objectFormat: "sha1" | "sha256";
	liveAnchors: string[];
}

function probeLiveRepositoryV1(cwd: string): LiveRepositoryProbeV1 {
	const commonDirectory = oneGitLine(cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
	if (!isAbsolute(commonDirectory)) throw new ReviewRepositoryError("Git common directory is not absolute");
	let canonicalCommonDirectory: string;
	try {
		canonicalCommonDirectory = realpathSync(commonDirectory);
		if (!statSync(canonicalCommonDirectory).isDirectory()) throw new Error("not a directory");
	} catch {
		throw new ReviewRepositoryError("Git common directory is unavailable");
	}
	const objectFormat = oneGitLine(cwd, ["rev-parse", "--show-object-format"]);
	if (!OBJECT_FORMAT.test(objectFormat)) throw new ReviewRepositoryError("Git object format is unsupported");
	if (oneGitLine(cwd, ["rev-parse", "--is-shallow-repository"]) !== "false") {
		throw new ReviewRepositoryError("Shallow repositories cannot establish review authority");
	}
	const storeRoot = assertManagedStorePathV1(canonicalCommonDirectory, join(canonicalCommonDirectory, "gentle-ai", "reviews"));
	const liveAnchors = gitLines(cwd, ["rev-list", "--max-parents=0", "--all"]).toSorted();
	if (liveAnchors.length === 0) throw new ReviewRepositoryError("Repository root commit anchors are required");
	if (new Set(liveAnchors).size !== liveAnchors.length || liveAnchors.some((anchor) => !OBJECT_ID.test(anchor))) {
		throw new ReviewRepositoryError("Repository root commit anchors are invalid");
	}
	return { canonicalCommonDirectory, storeRoot, objectFormat: objectFormat as "sha1" | "sha256", liveAnchors };
}

export function resolveRepositoryAuthorityV1(cwd: string): RepositoryAuthorityV1 {
	const probe = probeLiveRepositoryV1(cwd);
	const pinned = readPinnedRepositoryIdentityV1(probe.storeRoot);
	let repository_identity: ReviewRepositoryIdentityBodyV1;
	if (pinned) {
		if (pinned.object_format !== probe.objectFormat) {
			throw new ReviewRepositoryError("Pinned repository identity object format no longer matches this repository");
		}
		const live = new Set(probe.liveAnchors);
		if (!pinned.root_commit_ids.every((anchor) => live.has(anchor))) {
			throw new ReviewRepositoryError("Repository root commit authority no longer matches the pinned store identity");
		}
		repository_identity = pinned;
	} else {
		repository_identity = writePinnedRepositoryIdentityV1(probe.storeRoot, {
			schema: "gentle-ai.review-repository/v1",
			object_format: probe.objectFormat,
			root_commit_ids: probe.liveAnchors,
		});
	}
	const repository_id = domainHashV1("repository", repository_identity);
	return Object.freeze({
		common_directory: probe.canonicalCommonDirectory,
		store_root: probe.storeRoot,
		repository_identity,
		repository_id,
		authority_id: domainHashV1("authority", { repository_id, graph_format: "graph-v1" }),
	});
}

export interface RepositoryAuthorityRecoveryV1 extends RepositoryAuthorityV1 {
	readonly identity_broken: boolean;
}

// RESL2-001 / RELY2-001 修复：普通的历史重写（例如对孤立根执行
// `git branch -D`）移除了某个钉住的根提交后，`resolveRepositoryAuthorityV1`
// 中的子集校验会永久失败。这对普通访问而言是正确的保守失败行为——
// 但恢复检查若把同一个保守失败的解析器放在第一行，就根本无法开始。
// 这个宽松变体运行完全相同的实时探测，但在子集破坏时绝不抛错：
// 当钉住不再成立时，它报告 `identity_broken: true`，并改为从“当前的”
// 实时根提交集合计算一个尚未持久化的新身份，让显式恢复检查能够
// 发现并呈现这一破坏。普通读取/变更路径绝不使用本函数——只有
// 显式恢复检查路径（遗留权威探测）使用。
export function resolveRepositoryAuthorityForRecoveryV1(cwd: string): RepositoryAuthorityRecoveryV1 {
	const probe = probeLiveRepositoryV1(cwd);
	const pinned = readPinnedRepositoryIdentityV1(probe.storeRoot);
	let repository_identity: ReviewRepositoryIdentityBodyV1;
	let identity_broken = false;
	if (pinned) {
		const live = new Set(probe.liveAnchors);
		const subsetHolds = pinned.object_format === probe.objectFormat && pinned.root_commit_ids.every((anchor) => live.has(anchor));
		if (subsetHolds) {
			repository_identity = pinned;
		} else {
			identity_broken = true;
			repository_identity = { schema: "gentle-ai.review-repository/v1", object_format: probe.objectFormat, root_commit_ids: probe.liveAnchors };
		}
	} else {
		repository_identity = { schema: "gentle-ai.review-repository/v1", object_format: probe.objectFormat, root_commit_ids: probe.liveAnchors };
	}
	const repository_id = domainHashV1("repository", repository_identity);
	return Object.freeze({
		common_directory: probe.canonicalCommonDirectory,
		store_root: probe.storeRoot,
		repository_identity,
		repository_id,
		authority_id: domainHashV1("authority", { repository_id, graph_format: "graph-v1" }),
		identity_broken,
	});
}

export function reviewStoreRootForRepositoryV1(cwd: string): string {
	return resolve(resolveRepositoryAuthorityV1(cwd).store_root);
}
