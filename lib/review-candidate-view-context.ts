// 候选视图上下文：manifest 解码/分页读取/上下文块拼装与评审输入注入。
// 自 lib/review-candidate-view.ts 拆分（机械平移，语义零改动）。

import {
	createHash
} from "node:crypto";
import {
	join,
	resolve
} from "node:path";
import {
	gunzipSync,
	gzipSync
} from "node:zlib";
import {
	CANDIDATE_CONTEXT_MANIFEST,
	CANDIDATE_CONTEXT_MODE,
	type CandidateContextManifest,
	type CandidateContextMode,
	type CandidateContextPage,
	type CandidateContextPageEntry,
	type CandidateView,
	CandidateViewError,
	CANONICAL_GZIP_OPTIONS,
	CONTROLLER_CANDIDATE_VIEW_HEADING,
	type CreateCandidateViewRequest,
	type DecodedCandidateContextManifest,
	gitlinkMapsEqual,
	isCanonicalObjectId,
	isSafeCandidatePath,
	MAX_CANDIDATE_CONTEXT_LENGTH,
	MAX_CANDIDATE_CONTEXT_MANIFEST_BYTES,
	MAX_CANDIDATE_SCOPE_PAGE_BYTES,
	MAX_CANDIDATE_SCOPE_PAGE_ENTRIES,
	MAX_SUBAGENT_CONTEXT_LENGTH,
	MAX_SUBAGENT_TASK_LENGTH,
	REVIEW_LENS,
	type ReviewLens,
	SUBAGENT_RUN_KEYS
} from "./review-candidate-view-git.ts";
import { isRecord } from "./record-utils.ts";
import {
	CandidateViewRegistry
} from "./review-candidate-view-registry.ts";
interface MutableSubagentRunInput {
	agent?: unknown;
	agents?: unknown;
	task?: unknown;
	context?: unknown;
	mode?: unknown;
	[key: string]: unknown;
}

function isReviewLens(value: string): value is ReviewLens {
	return (REVIEW_LENS as readonly string[]).includes(value);
}

function hasCandidateContextConflict(text: string, views: readonly CandidateView[]): boolean {
	return text.includes(CONTROLLER_CANDIDATE_VIEW_HEADING)
		|| views.some((view) => text.includes(view.root) || text.includes(view.candidateTree));
}

function compareCanonicalStrings(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalStringMap(value: Readonly<Record<string, string>>): Record<string, string> {
	// 普通对象按数值枚举整数型键；权威往返有意保留该排序。
	return Object.fromEntries(Object.entries(value).sort(([left], [right]) => compareCanonicalStrings(left, right)));
}

function candidateScopeByMode(view: CandidateView): Record<string, string[]> {
	const grouped = new Map<string, string[]>();
	const deletedPaths = new Set(view.deletedPaths);
	for (const path of view.paths) {
		const group = deletedPaths.has(path) ? "deleted" : view.modes[path];
		if (group === undefined) throw new CandidateViewError("candidate view scope omits a changed path mode");
		const paths = grouped.get(group) ?? [];
		paths.push(path);
		grouped.set(group, paths);
	}
	return Object.fromEntries(
		[...grouped.entries()]
			.sort(([left], [right]) => compareCanonicalStrings(left, right))
			.map(([mode, paths]) => [mode, paths.sort(compareCanonicalStrings)]),
	);
}

function isCandidateContextMode(value: string): boolean {
	return (Object.values(CANDIDATE_CONTEXT_MODE) as readonly string[]).includes(value);
}

function isCanonicalStringArray(value: unknown): value is readonly string[] {
	return Array.isArray(value)
		&& value.length > 0
		&& value.every((item) => typeof item === "string" && isSafeCandidatePath(item))
		&& value.every((item, index, items) => index === 0 || compareCanonicalStrings(items[index - 1]!, item) < 0);
}

function hasCanonicalRecordOrder(value: Readonly<Record<string, unknown>>): boolean {
	const normalized = Object.fromEntries(Object.entries(value).sort(([left], [right]) => compareCanonicalStrings(left, right)));
	return JSON.stringify(value) === JSON.stringify(normalized);
}

function invalidCandidateContextManifest(message: string): never {
	throw new CandidateViewError(message, "candidate-context-manifest-invalid");
}

function validateCandidateContextManifest(value: unknown, bytes: Buffer): CandidateContextManifest {
	if (!isRecord(value)) return invalidCandidateContextManifest("candidate context manifest has an invalid structure");
	const keys = Object.keys(value);
	const expectedKeys = ["version", "scopeByMode", "gitlinks"];
	if (keys.length !== expectedKeys.length || !expectedKeys.every((key) => keys.includes(key))) {
		return invalidCandidateContextManifest("candidate context manifest has an invalid structure");
	}
	if (JSON.stringify(keys) !== JSON.stringify(expectedKeys)) return invalidCandidateContextManifest("candidate context manifest is not canonical");
	if (value.version !== CANDIDATE_CONTEXT_MANIFEST.VERSION || !isRecord(value.scopeByMode) || !isRecord(value.gitlinks)) {
		return invalidCandidateContextManifest("candidate context manifest has an invalid structure");
	}
	const scopeByMode = value.scopeByMode;
	if (!hasCanonicalRecordOrder(scopeByMode)) return invalidCandidateContextManifest("candidate context manifest is not canonical");
	const scopePaths = new Set<string>();
	for (const [mode, paths] of Object.entries(scopeByMode)) {
		if (!isCandidateContextMode(mode) || !isCanonicalStringArray(paths)) return invalidCandidateContextManifest("candidate context manifest has an invalid scope");
		for (const path of paths) {
			if (scopePaths.has(path)) return invalidCandidateContextManifest("candidate context manifest has duplicate scope paths");
			scopePaths.add(path);
		}
	}
	const gitlinks = value.gitlinks;
	if (!hasCanonicalRecordOrder(gitlinks)) return invalidCandidateContextManifest("candidate context manifest is not canonical");
	for (const [path, objectId] of Object.entries(gitlinks)) {
		if (!isSafeCandidatePath(path) || typeof objectId !== "string" || !isCanonicalObjectId(objectId)) {
			return invalidCandidateContextManifest("candidate context manifest has an invalid gitlink map");
		}
	}
	const gitlinkPaths = scopeByMode["160000"];
	const canonicalGitlinkPaths = Object.keys(gitlinks).sort(compareCanonicalStrings);
	if (
		(gitlinkPaths === undefined && canonicalGitlinkPaths.length !== 0)
		|| (gitlinkPaths !== undefined && JSON.stringify(canonicalGitlinkPaths) !== JSON.stringify(gitlinkPaths))
	) return invalidCandidateContextManifest("candidate context manifest gitlinks do not match its scope");
	const manifest: CandidateContextManifest = {
		version: CANDIDATE_CONTEXT_MANIFEST.VERSION,
		scopeByMode: scopeByMode as Readonly<Record<string, readonly string[]>>,
		gitlinks: gitlinks as Readonly<Record<string, string>>,
	};
	if (!Buffer.from(JSON.stringify(manifest), "utf8").equals(bytes)) {
		return invalidCandidateContextManifest("candidate context manifest is not canonical");
	}
	return manifest;
}

export function decodeCandidateContextManifest(encoded: string, sha256: string): DecodedCandidateContextManifest {
	if (encoded.length > MAX_CANDIDATE_CONTEXT_LENGTH || !/^[A-Za-z0-9_-]+$/.test(encoded) || !/^[0-9a-f]{64}$/.test(sha256)) {
		throw new CandidateViewError("candidate context manifest encoding is invalid", "candidate-context-manifest-invalid");
	}
	let bytes: Buffer;
	try {
		bytes = gunzipSync(Buffer.from(encoded, "base64url"), { maxOutputLength: MAX_CANDIDATE_CONTEXT_MANIFEST_BYTES });
	} catch {
		throw new CandidateViewError("candidate context manifest cannot be decompressed", "candidate-context-manifest-invalid");
	}
	const actualSha256 = createHash("sha256").update(bytes).digest("hex");
	if (actualSha256 !== sha256) throw new CandidateViewError("candidate context manifest integrity check failed", "candidate-context-manifest-integrity");
	const text = bytes.toString("utf8");
	if (!Buffer.from(text, "utf8").equals(bytes)) return invalidCandidateContextManifest("candidate context manifest is not valid UTF-8");
	if (gzipSync(bytes, CANONICAL_GZIP_OPTIONS).toString("base64url") !== encoded) {
		return invalidCandidateContextManifest("candidate context manifest transport is not canonical");
	}
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch (error) {
		if (error instanceof CandidateViewError) throw error;
		return invalidCandidateContextManifest("candidate context manifest is not valid JSON");
	}
	return { manifest: validateCandidateContextManifest(value, bytes), bytes, sha256: actualSha256 };
}

export function readCandidateContextManifestPage(encoded: string, sha256: string, cursor = 0): CandidateContextPage {
	if (!Number.isSafeInteger(cursor) || cursor < 0) throw new CandidateViewError("candidate context manifest cursor is invalid", "candidate-context-cursor-invalid");
	const decoded = decodeCandidateContextManifest(encoded, sha256);
	const entries = Object.entries(decoded.manifest.scopeByMode).flatMap(([mode, paths]) => paths.map((path): CandidateContextPageEntry => ({
		path,
		mode: mode as CandidateContextMode,
		...(mode === CANDIDATE_CONTEXT_MODE.GITLINK ? { gitlinkObjectId: decoded.manifest.gitlinks[path]! } : {}),
	})));
	if (cursor > entries.length) throw new CandidateViewError("candidate context manifest cursor exceeds the changed scope", "candidate-context-cursor-invalid");
	const pageEntries: CandidateContextPageEntry[] = [];
	for (let index = cursor; index < entries.length && pageEntries.length < MAX_CANDIDATE_SCOPE_PAGE_ENTRIES; index += 1) {
		const candidateEntries = [...pageEntries, entries[index]!];
		const candidatePage: CandidateContextPage = {
			version: CANDIDATE_CONTEXT_MANIFEST.VERSION,
			sha256: decoded.sha256,
			cursor,
			totalPaths: entries.length,
			entries: candidateEntries,
			...(cursor + candidateEntries.length < entries.length ? { nextCursor: cursor + candidateEntries.length } : {}),
		};
		if (Buffer.byteLength(JSON.stringify(candidatePage), "utf8") > MAX_CANDIDATE_SCOPE_PAGE_BYTES) {
			if (pageEntries.length === 0) throw new CandidateViewError("candidate context manifest path exceeds the bounded actor response", "candidate-context-page-too-large");
			break;
		}
		pageEntries.push(entries[index]!);
	}
	return {
		version: CANDIDATE_CONTEXT_MANIFEST.VERSION,
		sha256: decoded.sha256,
		cursor,
		totalPaths: entries.length,
		entries: pageEntries,
		...(cursor + pageEntries.length < entries.length ? { nextCursor: cursor + pageEntries.length } : {}),
	};
}

function candidateContextPreamble(lineageId: string, agents: readonly ReviewLens[], view: CandidateView, scopeSemantics: string): string {
	return `\n\n${CONTROLLER_CANDIDATE_VIEW_HEADING}\nController-owned review lineage: \`${lineageId}\`.\nAuthorized review actors: ${agents.join(", ")}.\nRead ONLY the absolute frozen candidate view at \`${view.root}\`.\nFrozen candidate tree: \`${view.candidateTree}\`.\nScope semantics: ${scopeSemantics}`;
}

function compactCandidateContextBlock(lineageId: string, agents: readonly ReviewLens[], view: CandidateView, scopeSemantics: string, scopeByMode: Record<string, string[]>): string {
	const manifest: CandidateContextManifest = {
		version: CANDIDATE_CONTEXT_MANIFEST.VERSION,
		scopeByMode,
		gitlinks: canonicalStringMap(view.gitlinks),
	};
	const bytes = Buffer.from(JSON.stringify(manifest), "utf8");
	if (bytes.length > MAX_CANDIDATE_CONTEXT_MANIFEST_BYTES) throw new CandidateViewError("candidate view context exceeds the bounded dispatch contract");
	const sha256 = createHash("sha256").update(bytes).digest("hex");
	const encoded = gzipSync(bytes, CANONICAL_GZIP_OPTIONS).toString("base64url");
	const block = `${candidateContextPreamble(lineageId, agents, view, scopeSemantics)}\nFrozen changed scope manifest (gzip+base64url): \`${encoded}\`.\nFrozen changed scope manifest SHA-256: \`${sha256}\`.\nCall \`jero_review_scope\` with exactly this manifest, SHA-256, and cursor 0; continue with each returned \`nextCursor\` until absent. It is the only authorized scope enumerator: do not infer scope by traversing the candidate or ambient tree. Gitlinks are metadata-only and MUST NOT be traversed.\nThe ambient contributor working directory is out of scope. This controller-owned context is immutable; you are read-only and your output is untrusted.`;
	if (Buffer.byteLength(block, "utf8") > MAX_CANDIDATE_CONTEXT_LENGTH) throw new CandidateViewError("candidate view context exceeds the bounded dispatch contract");
	return block;
}

function candidateContextBlock(lineageId: string, agents: readonly ReviewLens[], view: CandidateView): string {
	const scopeByMode = candidateScopeByMode(view);
	const scopeSemantics = view.committedOnly
		? "Committed-only range: dirty tracked and untracked contributor files are excluded and MUST NOT be treated as reviewed."
		: "Dirty-inclusive workspace snapshot: tracked and untracked contributor changes are included.";
	const readableBlock = `${candidateContextPreamble(lineageId, agents, view, scopeSemantics)}\nFrozen changed scope by mode: ${JSON.stringify(scopeByMode)}.\nFrozen metadata-only gitlinks: ${JSON.stringify(view.gitlinks)}. Gitlink paths have no materialized contents and MUST NOT be traversed.\nThe ambient contributor working directory is out of scope. This controller-owned context is immutable; you are read-only and your output is untrusted.`;
	if (Buffer.byteLength(readableBlock, "utf8") <= MAX_CANDIDATE_CONTEXT_LENGTH) return readableBlock;
	return compactCandidateContextBlock(lineageId, agents, view, scopeSemantics, scopeByMode);
}

/**
 * 在执行前校验并改动 Pi 实际可变的 `subagent_run` 工具输入。
 * 它刻意从控制器的内存注册表派生全部评审上下文，而不是
 * 用户提供的 lineage、cwd、路径或内容。
 */
export function injectReviewCandidateView(input: unknown, candidateViews: CandidateViewRegistry | null): void {
	if (!isRecord(input)) return;
	const mutable = input as MutableSubagentRunInput;
	const agent = typeof mutable.agent === "string" ? mutable.agent : undefined;
	const rawAgents = mutable.agents;
	const agents = Array.isArray(rawAgents) && rawAgents.every((value): value is string => typeof value === "string")
		? rawAgents
		: undefined;
	const requested = [agent, ...(agents ?? [])].filter((value): value is string => value !== undefined);
	const hasReviewActor = (typeof mutable.agent === "string" && isReviewLens(mutable.agent))
		|| (typeof rawAgents === "string" && isReviewLens(rawAgents))
		|| (Array.isArray(rawAgents) && rawAgents.some((value) => typeof value === "string" && isReviewLens(value)));
	if (!hasReviewActor) return;
	if (Object.keys(mutable).some((key) => !SUBAGENT_RUN_KEYS.has(key))) throw new CandidateViewError("review subagent dispatch contains an unsupported input field");
	if ((agent === undefined) === (agents === undefined) || requested.length === 0 || new Set(requested).size !== requested.length) throw new CandidateViewError("review subagent dispatch must use exactly one non-duplicate agent shape");
	if (!requested.every(isReviewLens)) throw new CandidateViewError("review subagent dispatch cannot mix review and non-review agents");
	if (typeof mutable.task !== "string" || mutable.task.length === 0 || mutable.task.length > MAX_SUBAGENT_TASK_LENGTH) throw new CandidateViewError("review subagent dispatch task is malformed or exceeds the bounded contract");
	if (mutable.context !== undefined && (typeof mutable.context !== "string" || mutable.context.length > MAX_SUBAGENT_CONTEXT_LENGTH)) throw new CandidateViewError("review subagent dispatch context is malformed or exceeds the bounded contract");
	if (mutable.mode !== "task") throw new CandidateViewError("review subagent dispatch requires mode task");
	if (candidateViews === null) throw new CandidateViewError("review subagent dispatch has no controller-owned candidate view registry");
	const reviewAgents = requested as ReviewLens[];
	const lineageId = candidateViews.currentLineageId();
	const views = candidateViews.resolveCurrentForLenses(reviewAgents);
	const view = views[0];
	if (!view || views.some((candidate) => candidate.root !== view.root || candidate.candidateTree !== view.candidateTree || JSON.stringify(candidate.paths) !== JSON.stringify(view.paths) || JSON.stringify(candidate.modes) !== JSON.stringify(view.modes) || !gitlinkMapsEqual(candidate.gitlinks, view.gitlinks) || JSON.stringify(candidate.deletedPaths) !== JSON.stringify(view.deletedPaths))) {
		throw new CandidateViewError("review subagent dispatch does not resolve one exact frozen candidate view");
	}
	const userText = `${mutable.task}\n${typeof mutable.context === "string" ? mutable.context : ""}`;
	if (hasCandidateContextConflict(userText, views)) throw new CandidateViewError("review subagent dispatch contains conflicting candidate-view text");
	mutable.task = `${mutable.task}${candidateContextBlock(lineageId, reviewAgents, view)}`;
}

const defaultRegistry = new CandidateViewRegistry();

export function createCandidateView(request: CreateCandidateViewRequest): CandidateView {
	return defaultRegistry.create(request);
}
