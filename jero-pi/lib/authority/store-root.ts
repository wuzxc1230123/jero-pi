import { execFileSync } from "node:child_process";
import { closeSync, fsyncSync, linkSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, realpathSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";
import { canonicalJsonV1, parseCanonicalJsonV1 } from "../review-canonical.ts";
import { assertManagedStorePathV1, reviewGitEnvironment } from "../review-repository.ts";
import { JERO_REPOSITORY_IDENTITY_SCHEMA, jeroDomainHash } from "./canonical.ts";

// jero-authority store root resolution (design §5.1.2, §5.1.6).
//
// The jero authority store lives at `<git-common-dir>/jero-review/`. The Git
// environment discipline (GIT_* refusal set, canonical probe flags) and the
// symlink-refusing managed-path walk are reused from lib/review-repository.ts
// via its exported helpers; only the root constants and the identity domain
// are jero-specific. Internal probe helpers throw a private typed error and
// the single exported resolver converts every failure into a discriminated
// refusal — never a raw throw and never a silent best-effort path.

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

// Upstream gentle-ai authority data that marks a repository as carrying a
// FOREIGN authority store. Any hit refuses START fail-closed with no
// migration (design §5.1.6): `gentle-ai/reviews` is the TS graph-v1 store
// (its published roots are probed by name), `gentle-ai/review-transactions`
// is the Go compact store (any content, including `v2/LOCK`, is a hit).
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

// No-follow probes (lstat, never stat/exists-through-symlink): a symlink
// planted at any foreign-authority name counts as data, and any path that
// cannot be conclusively shown absent counts as a hit (fail-closed).
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
			// The root itself is already a hit; unreadable content stays fail-closed.
		}
		// Named probe for the published compact-store lock: any content counts,
		// but LOCK is the canonical marker and is reported by name.
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
	// The store root walk reuses the upstream symlink-refusing discipline
	// (RESL managed-path check) against the jero directory name.
	let storeRoot: string;
	try {
		storeRoot = assertManagedStorePathV1(canonicalCommonDirectory, join(canonicalCommonDirectory, JERO_STORE_DIRECTORY_NAME));
	} catch (error) {
		throw new JeroAuthorityProbeError("authority-unavailable", boundedDetail(error));
	}
	return { commonDirectory: canonicalCommonDirectory, storeRoot, objectFormat: objectFormat as "sha1" | "sha256", liveAnchors };
}

// ---------------------------------------------------------------------------
// Pinned repository identity (jero namespace).
//
// Mirrors the upstream IDENTITY discipline from review-repository.ts
// (wx-temp + fsync + link + EEXIST-read-back, bounded parse retry, pinned
// root-commit subset validation) re-implemented locally because the upstream
// read-back validates the `gentle-ai.review-repository/v1` schema and would
// reject a jero identity body. The identity domain hash is jero's own, so
// jero repository ids are never upstream ids.
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
 * Resolves the jero authority store for a working directory. Foreign
 * upstream authority data (`gentle-ai/reviews`, `gentle-ai/review-transactions`)
 * is detected BEFORE any jero state is written and refuses resolution
 * fail-closed with no migration. The pinned root-commit identity is written
 * once and reused, with the upstream subset-validation semantics (orphan
 * roots tolerated, removed pinned roots refused).
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

/** Standalone foreign-authority inventory over a Git common directory. */
export function jeroForeignAuthorityStoreCheck(commonDirectory: string): readonly string[] {
	return foreignHits(commonDirectory);
}
