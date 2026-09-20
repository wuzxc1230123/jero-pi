import { execFileSync } from "node:child_process";
import { closeSync, fsyncSync, linkSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, realpathSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";
import { canonicalJsonV1, parseCanonicalJsonV1 } from "../review-canonical.ts";
import { assertManagedStorePathV1, reviewGitEnvironment } from "../review-repository.ts";
import { JERO_REPOSITORY_IDENTITY_SCHEMA, jeroDomainHash } from "./canonical.ts";

// jero-authority 存储根解析（设计 §5.1.2、§5.1.6）。
//
// jero 权威存储位于 `<git-common-dir>/jero-review/`。Git 环境纪律
// （GIT_* 拒绝集、权威探测标志）与拒绝符号链接的管理路径遍历通过其
// 导出的辅助函数从 lib/review-repository.ts 复用；只有根常量与身份域
// 是 jero 专属。内部探测辅助函数抛出私有的类型化错误，唯一的导出
// 解析器把每种失败转换为可辨识拒绝——绝不裸抛，也绝不静默尽力而为。

export class JeroAuthorityStoreError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "JeroAuthorityStoreError";
	}
}

class JeroAuthorityProbeError extends Error {
	readonly kind: JeroAuthorityStoreResolutionFailureKind;
	readonly detail: string;

	constructor(kind: JeroAuthorityStoreResolutionFailureKind, detail: string) {
		super(detail);
		this.name = "JeroAuthorityProbeError";
		this.kind = kind;
		this.detail = detail;
	}
}

export interface JeroRepositoryIdentityBodyV1 {
	schema: typeof JERO_REPOSITORY_IDENTITY_SCHEMA;
	object_format: "sha1" | "sha256";
	root_commit_ids: string[];
}

export interface JeroAuthorityStoreV1 {
	readonly common_directory: string;
	readonly store_root: string;
	readonly repository_identity: JeroRepositoryIdentityBodyV1;
	readonly repository_id: string;
	readonly authority_id: string;
}

export type JeroAuthorityStoreResolutionFailureKind = "not-a-git-repository" | "git-unavailable" | "authority-unavailable";

export type JeroAuthorityStoreResolutionV1 =
	| ({ readonly kind: "ok" } & JeroAuthorityStoreV1)
	| { readonly kind: "foreign-authority-store"; readonly hits: readonly string[] }
	| { readonly kind: JeroAuthorityStoreResolutionFailureKind; readonly detail: string };

export const JERO_STORE_DIRECTORY_NAME = "jero-review";
export const JERO_IDENTITY_FILENAME = "IDENTITY";

const OBJECT_FORMAT = /^(sha1|sha256)$/;
const OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const DETAIL_LIMIT = 400;

// 标记仓库携带“外来”权威存储的上游 gentle-ai 权威数据。任何命中都
// 以保守失败拒绝 START，且无迁移（设计 §5.1.6）：
// `gentle-ai/reviews` 是 TS graph-v1 存储（其公开的根目录按名探测），
// `gentle-ai/review-transactions` 是 Go 紧凑存储（任何内容——包括
// `v2/LOCK`——都算命中）。
const FOREIGN_REVIEW_STORE_CHILDREN = ["IDENTITY", "graph-v1", "control", "snapshots", "lineages", "locks"] as const;
const FOREIGN_TRANSACTION_STORE = ["gentle-ai", "review-transactions"] as const;
const FOREIGN_REVIEW_STORE = ["gentle-ai", "reviews"] as const;

function boundedDetail(value: unknown): string {
	const text = typeof value === "string" ? value : value instanceof Error ? value.message : String(value);
	const flattened = text.replace(/\s+/g, " ").trim();
	return flattened.length <= DETAIL_LIMIT ? flattened : `${flattened.slice(0, DETAIL_LIMIT)}…`;
}

function gitLines(cwd: string, args: readonly string[]): string[] {
	let output: string;
	try {
		output = execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], shell: false, env: reviewGitEnvironment() });
	} catch (error) {
		const failure = error as NodeJS.ErrnoException & { stderr?: string };
		if (failure.code === "ENOENT") throw new JeroAuthorityProbeError("git-unavailable", "The Git executable is unavailable");
		const stderr = typeof failure.stderr === "string" ? failure.stderr : "";
		if (/not a git repository/i.test(stderr)) throw new JeroAuthorityProbeError("not-a-git-repository", boundedDetail(stderr));
		throw new JeroAuthorityProbeError("git-unavailable", boundedDetail(stderr || failure.message));
	}
	if (output.includes("\0")) throw new JeroAuthorityProbeError("git-unavailable", "Git authority probe returned malformed output");
	return output.split("\n").filter(Boolean);
}

function oneGitLine(cwd: string, args: readonly string[]): string {
	const lines = gitLines(cwd, args);
	if (lines.length !== 1) throw new JeroAuthorityProbeError("authority-unavailable", "Git authority probe returned an ambiguous value");
	return lines[0]!;
}

// 不跟随的探测（lstat，绝不用 stat/exists 穿透符号链接）：植入在任何
// 外来权威名称上的符号链接都算数据，且任何无法确证不存在的路径都算
// 命中（保守失败）。
function foreignHits(commonDirectory: string): string[] {
	const hits: string[] = [];
	const reviewRoot = join(commonDirectory, ...FOREIGN_REVIEW_STORE);
	for (const child of FOREIGN_REVIEW_STORE_CHILDREN) {
		const path = join(reviewRoot, child);
		try {
			lstatSync(path);
			hits.push([...FOREIGN_REVIEW_STORE, child].join("/"));
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") hits.push([...FOREIGN_REVIEW_STORE, child].join("/"));
		}
	}
	const transactionRoot = join(commonDirectory, ...FOREIGN_TRANSACTION_STORE);
	try {
		lstatSync(transactionRoot);
		hits.push(FOREIGN_TRANSACTION_STORE.join("/"));
		try {
			for (const entry of readdirSync(transactionRoot).toSorted()) hits.push([...FOREIGN_TRANSACTION_STORE, entry].join("/"));
		} catch {
			// 根目录本身已是命中；不可读的内容保持保守失败。
		}
		// 对公开的紧凑存储锁的点名探测：任何内容都算命中，
		// 但 LOCK 是权威标记并按名上报。
		const compactLock = [...FOREIGN_TRANSACTION_STORE, "v2", "LOCK"].join("/");
		try {
			lstatSync(join(commonDirectory, ...FOREIGN_TRANSACTION_STORE, "v2", "LOCK"));
			hits.push(compactLock);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") hits.push(compactLock);
		}
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") hits.push(FOREIGN_TRANSACTION_STORE.join("/"));
	}
	return hits;
}

interface LiveRepositoryProbe {
	commonDirectory: string;
	storeRoot: string;
	objectFormat: "sha1" | "sha256";
	liveAnchors: string[];
}

function probeLiveRepository(cwd: string): LiveRepositoryProbe {
	const commonDirectory = oneGitLine(cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
	if (!isAbsolute(commonDirectory)) throw new JeroAuthorityProbeError("authority-unavailable", "Git common directory is not absolute");
	let canonicalCommonDirectory: string;
	try {
		canonicalCommonDirectory = realpathSync(commonDirectory);
		if (!statSync(canonicalCommonDirectory).isDirectory()) throw new Error("not a directory");
	} catch {
		throw new JeroAuthorityProbeError("authority-unavailable", "Git common directory is unavailable");
	}
	const objectFormat = oneGitLine(cwd, ["rev-parse", "--show-object-format"]);
	if (!OBJECT_FORMAT.test(objectFormat)) throw new JeroAuthorityProbeError("authority-unavailable", "Git object format is unsupported");
	if (oneGitLine(cwd, ["rev-parse", "--is-shallow-repository"]) !== "false") {
		throw new JeroAuthorityProbeError("authority-unavailable", "Shallow repositories cannot establish review authority");
	}
	const liveAnchors = gitLines(cwd, ["rev-list", "--max-parents=0", "--all"]).toSorted();
	if (liveAnchors.length === 0) throw new JeroAuthorityProbeError("authority-unavailable", "Repository root commit anchors are required");
	if (new Set(liveAnchors).size !== liveAnchors.length || liveAnchors.some((anchor) => !OBJECT_ID.test(anchor))) {
		throw new JeroAuthorityProbeError("authority-unavailable", "Repository root commit anchors are invalid");
	}
	// 存储根遍历对 jero 目录名复用上游的拒绝符号链接纪律
	// （RESL 管理路径检查）。
	let storeRoot: string;
	try {
		storeRoot = assertManagedStorePathV1(canonicalCommonDirectory, join(canonicalCommonDirectory, JERO_STORE_DIRECTORY_NAME));
	} catch (error) {
		throw new JeroAuthorityProbeError("authority-unavailable", boundedDetail(error));
	}
	return { commonDirectory: canonicalCommonDirectory, storeRoot, objectFormat: objectFormat as "sha1" | "sha256", liveAnchors };
}

// ---------------------------------------------------------------------------
// 钉住的仓库身份（jero 命名空间）。
//
// 镜像 review-repository.ts 的上游 IDENTITY 纪律（wx 临时文件 + fsync
// + link + EEXIST 读回、有界解析重试、钉住根提交子集校验），但因上游
// 读回校验的是 `gentle-ai.review-repository/v1` schema、会拒绝 jero
// 身份正文而在本地重新实现。身份域哈希是 jero 自己的，因此 jero
// 仓库 id 绝不是上游 id。
// ---------------------------------------------------------------------------

function isValidJeroRepositoryIdentityBody(value: unknown): value is JeroRepositoryIdentityBodyV1 {
	if (typeof value !== "object" || value === null) return false;
	const candidate = value as JeroRepositoryIdentityBodyV1;
	return (
		candidate.schema === JERO_REPOSITORY_IDENTITY_SCHEMA &&
		OBJECT_FORMAT.test(candidate.object_format) &&
		Array.isArray(candidate.root_commit_ids) &&
		candidate.root_commit_ids.length > 0 &&
		new Set(candidate.root_commit_ids).size === candidate.root_commit_ids.length &&
		candidate.root_commit_ids.every((anchor) => typeof anchor === "string" && OBJECT_ID.test(anchor))
	);
}

const IDENTITY_READ_RETRY_ATTEMPTS = 5;
const IDENTITY_READ_RETRY_DELAY_MS = 4;

function sleepSyncMs(milliseconds: number): void {
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function identityPath(storeRoot: string): string {
	return join(storeRoot, JERO_IDENTITY_FILENAME);
}

function readPinnedIdentity(storeRoot: string): JeroRepositoryIdentityBodyV1 | undefined {
	for (let attempt = 1; attempt <= IDENTITY_READ_RETRY_ATTEMPTS; attempt += 1) {
		let bytes: Buffer;
		try {
			bytes = readFileSync(identityPath(storeRoot));
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
			throw new JeroAuthorityProbeError("authority-unavailable", "Pinned repository identity is unavailable");
		}
		let parsed: unknown;
		try {
			parsed = parseCanonicalJsonV1(bytes);
		} catch {
			if (attempt < IDENTITY_READ_RETRY_ATTEMPTS) {
				sleepSyncMs(IDENTITY_READ_RETRY_DELAY_MS);
				continue;
			}
			throw new JeroAuthorityProbeError("authority-unavailable", "Pinned repository identity is malformed");
		}
		if (!isValidJeroRepositoryIdentityBody(parsed)) throw new JeroAuthorityProbeError("authority-unavailable", "Pinned repository identity is invalid");
		return parsed;
	}
	throw new JeroAuthorityProbeError("authority-unavailable", "Pinned repository identity is malformed");
}

function writePinnedIdentity(storeRoot: string, identity: JeroRepositoryIdentityBodyV1): JeroRepositoryIdentityBodyV1 {
	mkdirSync(storeRoot, { recursive: true, mode: 0o700 });
	const path = identityPath(storeRoot);
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
		throw new JeroAuthorityProbeError("authority-unavailable", "Unable to persist pinned repository identity");
	} finally {
		try {
			unlinkSync(temporary);
		} catch {}
	}
	if (!installed) return readPinnedIdentity(storeRoot) ?? identity;
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

/**
 * 为某个工作目录解析 jero 权威存储。外来的上游权威数据
 * （`gentle-ai/reviews`、`gentle-ai/review-transactions`）在任何 jero
 * 状态被写入“之前”检测，并以无迁移的保守失败拒绝解析。钉住的根提交
 * 身份写入一次并被复用，采用上游的子集校验语义（容忍孤立根，拒绝被
 * 移除的钉住根）。
 */
export function resolveJeroAuthorityStoreV1(cwd: string): JeroAuthorityStoreResolutionV1 {
	try {
		const probe = probeLiveRepository(cwd);
		const hits = foreignHits(probe.commonDirectory);
		if (hits.length > 0) return { kind: "foreign-authority-store", hits };
		const pinned = readPinnedIdentity(probe.storeRoot);
		let repository_identity: JeroRepositoryIdentityBodyV1;
		if (pinned) {
			if (pinned.object_format !== probe.objectFormat) {
				throw new JeroAuthorityProbeError("authority-unavailable", "Pinned repository identity object format no longer matches this repository");
			}
			const live = new Set(probe.liveAnchors);
			if (!pinned.root_commit_ids.every((anchor) => live.has(anchor))) {
				throw new JeroAuthorityProbeError("authority-unavailable", "Repository root commit authority no longer matches the pinned store identity");
			}
			repository_identity = pinned;
		} else {
			repository_identity = writePinnedIdentity(probe.storeRoot, {
				schema: JERO_REPOSITORY_IDENTITY_SCHEMA,
				object_format: probe.objectFormat,
				root_commit_ids: probe.liveAnchors,
			});
		}
		const repository_id = jeroDomainHash("repository", repository_identity);
		return Object.freeze({
			kind: "ok",
			common_directory: probe.commonDirectory,
			store_root: probe.storeRoot,
			repository_identity,
			repository_id,
			authority_id: jeroDomainHash("authority", { repository_id, store_format: "jero-review" }),
		}) as JeroAuthorityStoreResolutionV1;
	} catch (error) {
		if (error instanceof JeroAuthorityProbeError) return { kind: error.kind, detail: error.detail };
		return { kind: "authority-unavailable", detail: boundedDetail(error) };
	}
}

const JERO_LINEAGE_ID = /^review-[0-9a-f]{16}$/;

export function isJeroLineageId(lineageId: string): boolean {
	return JERO_LINEAGE_ID.test(lineageId);
}

export function jeroLineageDirectory(storeRoot: string, lineageId: string): string {
	if (!isJeroLineageId(lineageId)) throw new JeroAuthorityStoreError("Lineage ID is invalid");
	const lineageDirectory = join(storeRoot, "lineages", lineageId);
	if (relative(storeRoot, lineageDirectory).startsWith(`..${sep}`)) throw new JeroAuthorityStoreError("Lineage directory escapes the jero authority store");
	return lineageDirectory;
}

/** 对 Git common directory 的独立外来权威清点。 */
export function jeroForeignAuthorityStoreCheck(commonDirectory: string): readonly string[] {
	return foreignHits(commonDirectory);
}
