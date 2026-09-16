import { execFileSync, type ExecFileSyncOptions } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, isAbsolute, join, resolve, sep } from "node:path";
import { reviewGitEnvironment } from "../review-repository.ts";
import { deriveChangedPathManifest, digestChangedPathManifest, type ChangedPathEntry } from "../review-candidate-view.ts";
import { buildDiffEvidence, REVIEW_EVENT, REVIEW_ROUTE, type DiffEvidence, type ReviewLens, type ReviewRoute } from "../review-triggers.ts";
import { classifyReviewRisk, isGeneratedGoldenPath, type ReviewDiffStat, type ReviewRiskClassification, type ReviewRiskTier } from "../review-risk.ts";
import { jeroDomainHash } from "./canonical.ts";

// Snapshot-root redirect seam over lib/review-snapshot.ts (spec §I.10, the
// M1-deferred E.6 item).
//
// The ported `captureReviewSnapshot` cannot be used for jero stores: its
// private `snapshotsRoot` hard-codes `gentle-ai/reviews/snapshots` under the
// Git directory, and `resolveJeroAuthorityStoreV1` treats ANY hit under
// `gentle-ai/reviews/*` as a foreign authority store — so a single upstream
// capture would permanently poison the repository for jero (fail-closed, no
// migration). Rather than editing the byte-identical port, this module is the
// call boundary: it re-uses the port's exported, root-independent machinery
// (`classifyReviewRisk`, `buildDiffEvidence`, `discoverReviewUntrackedPaths`,
// `deriveChangedPathManifest`, `digestChangedPathManifest`) and re-implements
// only the ~80 lines of capture orchestration so that every byte lands under
// `<store>/jero-review/snapshots/` (temp 0o700 staging + rename, isolated
// object store, metadata record — the same shape and discipline as upstream).
// The snapshot identity is jero-domain hashed (`jero.authority.snapshot`), so
// jero target identities can never collide with upstream Go-domain ones.

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
	/** `sha256:` identity — jero domain hash over the identity body (spec §B.3). */
	readonly target_identity: string;
	/** Bare hex of the identity hash; the persisted snapshot directory name. */
	readonly snapshot_id: string;
	readonly risk: ReviewRiskClassification;
	/** The freeze numstat view (per-path additions/deletions/binary/mode-only). */
	readonly numstat: readonly ReviewDiffStat[];
	readonly changed_path_manifest: readonly ChangedPathEntry[];
	readonly changed_path_manifest_sha256: string;
	/** Isolated object directory while the derivation is live (workspace captures). */
	readonly object_directory?: string;
	readonly alternate_object_directory: string;
}

const OBJECT_ID = /^[0-9a-f]{40,64}$/;

/** Stable per-mode policy hash: the frozen review policy the identity binds. */
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
	return runGit(cwd, ["rev-parse", "--show-toplevel"]);
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

/** Digest over untracked path NAMES only — nothing is read or hashed at inventory time (spec §B.2). */
export function jeroUntrackedInventoryDigestV1(names: readonly string[]): string {
	return `sha256:${jeroDomainHash("untracked-inventory", [...names].toSorted())}`;
}

/** Digest over the snapshot's canonical changed-path list. */
export function jeroPathsDigestV1(paths: readonly string[]): string {
	return `sha256:${jeroDomainHash("paths", [...paths].toSorted())}`;
}

export interface JeroSnapshotDeriveOptionsV1 {
	readonly cwd: string;
	readonly mode: JeroSnapshotModeName;
	/**
	 * `complete` reviews the live workspace (incl. untracked); a base diff
	 * reviews the committed range baseRef..HEAD; `staged` (M3, §G) freezes
	 * the candidate from the Git INDEX — what is about to be committed — via
	 * a temporary GIT_INDEX_FILE copy, never touching the real index.
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
 * Derives the full snapshot facts without persisting anything: trees, risk
 * classification, diff evidence, route/lens plan, genesis paths, untracked
 * inventory, changed-path manifest, and the jero-domain target identity.
 * Workspace captures stage the candidate tree through a temp index + isolated
 * object directory that the caller may keep (capture) or discard (status).
 */
export function deriveJeroReviewSnapshotV1(options: JeroSnapshotDeriveOptionsV1 & { readonly keepIsolatedStore?: string }): JeroSnapshotDerivationV1 {
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
				// M3 (spec G): freeze the candidate from the Git INDEX. The real
				// index is COPIED into a temporary GIT_INDEX_FILE and every write
				// (the tree object) lands in the isolated object directory, so the
				// caller's real index is never opened for writing.
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
		// Judgment Day captures non-trivial scope WITHOUT ordinary lens classification (spec §G).
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
 * Derives and durably installs a review snapshot under
 * `<storeRoot>/snapshots/<snapshot-id>/`: isolated git object store 0o700
 * (survives `git gc`), metadata record, atomic staging→final rename. An
 * existing identical snapshot is reused; a conflicting one fails closed.
 */
export function captureJeroReviewSnapshotV1(options: JeroSnapshotCaptureOptionsV1): JeroSnapshotDerivationV1 & { readonly record: JeroReviewSnapshotRecordV1 } {
	const root = jeroSnapshotsRootV1(options.storeRoot);
	mkdirSync(root, { recursive: true, mode: 0o700 });
	chmodSync(root, 0o700);
	// Stage the isolated object store directly in its final resting directory:
	// the snapshot id is only known after the trees exist, so capture first
	// into a dot-prefixed staging directory under the snapshots root, then
	// rename it to `<id>` (the same discipline as upstream captureReviewSnapshot).
	const staging = mkdtempSync(join(root, ".capture-"));
	chmodSync(staging, 0o700);
	try {
		const derivation = deriveJeroReviewSnapshotV1({ ...options, keepIsolatedStore: staging });
		// Move the isolated objects from `<staging>/objects` layout: derivation
		// wrote index+objects into the staging directory itself.
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

/** Removes a lineage-terminal snapshot's isolated object store (jero-rooted twin of cleanupReviewSnapshot). */
export function cleanupJeroReviewSnapshotV1(storeRoot: string, snapshotDirectory: string): void {
	const expectedRoot = resolve(jeroSnapshotsRootV1(storeRoot));
	const directory = resolve(snapshotDirectory);
	if (!directory.startsWith(`${expectedRoot}${sep}`)) {
		throw new JeroSnapshotError("Review snapshot cleanup path is outside the jero snapshot store");
	}
	rmSync(directory, { recursive: true, force: true });
}

/** Reads the persisted snapshot record for a frozen target identity; the record re-verifies against its own identity hash. */
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
	/** Actual correction lines summed over genesis paths (additions + deletions). */
	readonly lines: number;
	/** Diff paths outside the frozen genesis scope the declared candidate tree carries. */
	readonly touchedNonGenesisPaths: readonly string[];
}

/**
 * Re-derives the actual correction a declared candidate tree carries, against
 * the lineage's isolated snapshot object store (findings F5, §9.2 actor output
 * is untrusted): both trees must resolve (`git cat-file -t` = tree) and the
 * line count comes from `git diff --numstat` over the genesis paths — never
 * from caller-declared numbers. Any non-resolution, unreadable snapshot, or
 * uncountable (binary) genesis row throws JeroSnapshotError.
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
	// Same GIT_* discipline as the manifestExecutor above: the snapshot's
	// isolated object directory rides as an alternate of the repository store.
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
