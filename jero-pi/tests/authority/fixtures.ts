import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { JeroLineageDraftV1 } from "../../lib/authority/lineage-store.ts";
import { JERO_REVIEW_TRANSACTION_SCHEMA } from "../../lib/authority/canonical.ts";
import { admitJeroReviewerResultV1 } from "../../lib/authority/result-artifacts.ts";
import { jeroArtifactSubjectForRecordV1 } from "../../lib/authority/collect-inputs.ts";
import type { JeroRequestJournalEntryV1, JeroReviewTransactionStateV1 } from "../../lib/authority/protocol.ts";

export function tempRoot(prefix: string): string {
	return mkdtempSync(join(tmpdir(), prefix));
}

export function git(cwd: string, ...args: string[]): string {
	return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

/** Mirrors the repository fixture from tests/review-repository.test.ts. */
export function repository(t: { after: (callback: () => void) => void }, prefix = "jero-authority-repo-"): string {
	const parent = mkdtempSync(join(tmpdir(), prefix));
	const root = join(parent, "repo");
	mkdirSync(root);
	git(root, "init", "-b", "main");
	git(root, "config", "user.email", "tests@example.com");
	git(root, "config", "user.name", "Tests");
	writeFileSync(join(root, "README.md"), "test\n");
	git(root, "add", "README.md");
	git(root, "commit", "-m", "initial");
	t.after(() => rmSync(parent, { recursive: true, force: true }));
	return root;
}

export const LINEAGE_ID = "review-0123456789abcdef";

/** Full valid lineage state record matching the analysis report section C field model. */
export function testTransactionState(lineageId = LINEAGE_ID): JeroReviewTransactionStateV1 {
	return {
		schema: JERO_REVIEW_TRANSACTION_SCHEMA,
		lineage_id: lineageId,
		mode: "ordinary_4r",
		generation: 3,
		state: "evidence_classified",
		snapshot: {
			kind: "current-changes",
			base_tree: "b".repeat(40),
			candidate_tree: "c".repeat(40),
			paths_digest: "d".repeat(64),
			intended_untracked: [],
			intended_untracked_proof: "e".repeat(64),
			paths: ["src/app.ts"],
			identity: "f".repeat(64),
			ledger_ids: ["1".repeat(64)],
		},
		base_tree: "b".repeat(40),
		paths_digest: "d".repeat(64),
		initial_review_tree: "2".repeat(40),
		final_candidate_tree: "3".repeat(40),
		fix_delta_hash: "4".repeat(64),
		policy_hash: "5".repeat(64),
		ledger_hash: "6".repeat(64),
		ledger_findings_hash: "7".repeat(64),
		evidence_hash: "8".repeat(64),
		judge_proofs: [
			{ judge_id: "judge-1", execution_hash: "9".repeat(64), result_hash: "a".repeat(64), blind: true, confirmed: true },
		],
		counters: {
			full_reviews: 1,
			refuter_batches: 2,
			fix_batches: 0,
			scoped_fix_validations: 0,
			final_verifications: 0,
			fix_rounds: 0,
			scoped_rejudgments: 0,
			judge_executions: 1,
			risk_executions: 1,
		},
		findings: [
			{ id: "finding-1", lens: "risk", location: "src/app.ts:10", severity: "BLOCKER", claim: "unsafe retry loop", proof_refs: ["proof-1"] },
		],
		classifications: {
			"finding-1": { finding_id: "finding-1", class: "deterministic", proof: "proof-1", causal_disposition: "introduced" },
		},
		outcomes: { "finding-1": "corroborated" },
		fix_finding_ids: ["finding-1"],
		pending_refuter_ids: [],
		fix_caused_findings: [],
		follow_ups: [{ observation: "pre-existing behavior noted", proof_refs: ["proof-2"] }],
		risk_level: "medium",
		selected_lenses: ["review-risk"],
		lens_results: [{ lens: "review-risk", findings: [], evidence: ["evidence-1"], result_hash: "0".repeat(64) }],
		original_changed_lines: 40,
		correction_budget: 20,
	};
}

export function startJournalEntry(lineageId = LINEAGE_ID): JeroRequestJournalEntryV1 {
	return {
		operation: "start",
		idempotency_key: "start-a",
		request_hash: "a".repeat(64),
		status: "completed",
		canonical_result: { lineage_id: lineageId, state: "reviewing" },
	};
}

export function initialDraft(lineageId = LINEAGE_ID): JeroLineageDraftV1 {
	const state = testTransactionState(lineageId);
	state.state = "reviewing";
	return { state, request_journal: [startJournalEntry(lineageId)] };
}

// ---------------------------------------------------------------------------
// M2 state-machine helpers: one fixture repository per test file, reused
// across tests (each capture is pure Git — no candidate-view registry, so no
// PowerShell SID/DACL cost).
// ---------------------------------------------------------------------------

import assert from "node:assert/strict";
import type { JeroAuthorityContextV1, } from "../../lib/authority/review.ts";
import { resolveJeroAuthorityContextV1 } from "../../lib/authority/review.ts";
import type { JeroReviewStartResultV1, JeroReviewStartSelectionV1 } from "../../lib/authority/start.ts";
import { reviewStartV1 } from "../../lib/authority/start.ts";
import { JeroLineageStoreV1 } from "../../lib/authority/lineage-store.ts";
import { readJeroSnapshotRecordV1 } from "../../lib/authority/snapshots.ts";
import { jeroDomainHash } from "../../lib/authority/canonical.ts";
import { reviewGitEnvironment } from "../../lib/review-repository.ts";
import { delimiter } from "node:path";

export type FixtureRisk = "low" | "medium" | "high";

/** Applies a workspace change of the requested risk class to a committed fixture repo. */
export function applyRiskChange(repo: string, risk: FixtureRisk, lines = 4): void {
	if (risk === "low") {
		writeFileSync(join(repo, "README.md"), `base\n${"documentation line\n".repeat(lines)}`);
		return;
	}
	mkdirSync(join(repo, "src"), { recursive: true });
	if (risk === "medium") {
		writeFileSync(join(repo, "src", "app.ts"), `${"export const placeholder = 0;\n".repeat(lines)}`);
		return;
	}
	mkdirSync(join(repo, "src", "auth"), { recursive: true });
	writeFileSync(join(repo, "src", "auth", "token.ts"), `${"export const secret = 1;\n".repeat(lines)}`);
}

export interface ReviewHarnessV1 {
	repo: string;
	context: JeroAuthorityContextV1;
	git: (...args: string[]) => string;
}

export function reviewHarness(t: { after: (callback: () => void) => void }, risk: FixtureRisk = "medium", lines = 4): ReviewHarnessV1 {
	const repo = repository(t);
	applyRiskChange(repo, risk, lines);
	const resolution = resolveJeroAuthorityContextV1(repo);
	if (resolution.kind !== "ok") throw new Error(`fixture store resolution failed: ${resolution.code}: ${resolution.detail ?? ""}`);
	return { repo, context: resolution.context, git: (...args: string[]) => git(repo, ...args) };
}

/** Starts an ordinary review and asserts the created/closed variant; fails the test on any refusal. */
export function startCreatedReview(t: { after: (callback: () => void) => void }, risk: FixtureRisk = "medium", lines = 4, selection: JeroReviewStartSelectionV1 = {}): ReviewHarnessV1 & { start: Extract<JeroReviewStartResultV1, { kind: "created" | "closed" }> } {
	const harness = reviewHarness(t, risk, lines);
	// Reviews default ON (F4), so a medium/high creation start answers the
	// §B.5 consent question granted unless the test overrides the answer.
	const start = reviewStartV1(harness.context, { cwd: harness.repo }, { consent: "granted", ...selection });
	assert.ok(start.kind === "created" || start.kind === "closed", `expected created/closed, got ${JSON.stringify(start)}`);
	return { ...harness, start: start as Extract<JeroReviewStartResultV1, { kind: "created" | "closed" }> };
}

export interface FixtureFixApplicationV1 {
	candidate_tree: string;
	fix_delta_hash: string;
	correction_paths: string[];
	actual_correction_lines: number;
}

/** Captures the worktree byte state (minus .git) so a fixture fix can restore it after tree staging. */
function snapshotWorktree(repo: string): Map<string, Buffer> {
	const files = new Map<string, Buffer>();
	const walk = (directory: string): void => {
		for (const entry of readdirSync(directory, { withFileTypes: true })) {
			if (entry.name === ".git") continue;
			const full = join(directory, entry.name);
			if (entry.isDirectory()) walk(full);
			else if (entry.isFile()) files.set(full, readFileSync(full));
		}
	};
	walk(repo);
	return files;
}

function restoreWorktree(repo: string, files: Map<string, Buffer>): void {
	const walk = (directory: string): string[] => {
		const paths: string[] = [];
		for (const entry of readdirSync(directory, { withFileTypes: true })) {
			if (entry.name === ".git") continue;
			const full = join(directory, entry.name);
			if (entry.isDirectory()) paths.push(...walk(full));
			else paths.push(full);
		}
		return paths;
	};
	for (const current of walk(repo)) {
		if (files.has(current)) writeFileSync(current, files.get(current)!);
		else rmSync(current, { force: true });
	}
	for (const [path, bytes] of files) {
		if (!existsSync(path)) {
			mkdirSync(dirname(path), { recursive: true });
			writeFileSync(path, bytes);
		}
	}
}

/**
 * Applies a REAL workspace edit as the correction and derives a verifiable
 * `fix_application` (F5 fixtures): the fixed candidate tree is written into
 * the lineage's isolated snapshot object store (the same GIT_* discipline as
 * the snapshot capture), and the declared line count is the actual
 * `git diff --numstat` derivation over the changed paths — never a lie.
 * The fix API is tree-based, so after staging the tree the worktree is
 * restored to the reviewed candidate (STATUS identity stays frozen).
 */
export function applyFixtureFix(harness: ReviewHarnessV1, lineageId: string, mutate: (repo: string) => void): FixtureFixApplicationV1 {
	const store = JeroLineageStoreV1.forStore(harness.context.store.store_root);
	const loaded = store.load(lineageId);
	if (loaded.kind !== "ok") throw new Error(`fixture lineage load failed: ${loaded.kind}`);
	const state = loaded.record.state;
	const record = readJeroSnapshotRecordV1(harness.context.store.store_root, state.snapshot.identity);
	const staging = mkdtempSync(join(tmpdir(), "jero-fixture-fix-"));
	const run = (args: string[], environment: Record<string, string>): string =>
		execFileSync("git", args, { cwd: harness.repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...reviewGitEnvironment(), ...environment } }).trim();
	const worktree = snapshotWorktree(harness.repo);
	try {
		// The correction is authored against the ORIGINAL review tree: the fix
		// tree's budget is charged relative to the reviewed candidate (F5).
		const indexEnvironment = {
			GIT_INDEX_FILE: join(staging, "index"),
			GIT_OBJECT_DIRECTORY: record.object_store.object_directory,
			GIT_ALTERNATE_OBJECT_DIRECTORIES: record.object_store.alternate_object_directory,
		};
		run(["read-tree", state.initial_review_tree], indexEnvironment);
		mutate(harness.repo);
		run(["add", "-A", "--", "."], indexEnvironment);
		const tree = run(["write-tree"], indexEnvironment);
		const diffEnvironment = { GIT_ALTERNATE_OBJECT_DIRECTORIES: `${record.object_store.object_directory}${delimiter}${record.object_store.alternate_object_directory}` };
		const numstat = run(["diff", "--numstat", "--no-renames", state.initial_review_tree, tree], diffEnvironment);
		let lines = 0;
		const paths: string[] = [];
		for (const line of numstat.split(/\r?\n/).filter(Boolean)) {
			const [added, deleted, path] = line.split("\t");
			lines += Number.parseInt(added ?? "0", 10) + Number.parseInt(deleted ?? "0", 10);
			if (path !== undefined) paths.push(path);
		}
		return { candidate_tree: tree, fix_delta_hash: jeroDomainHash("fixture-fix-delta", { base: state.initial_review_tree, tree }), correction_paths: paths, actual_correction_lines: lines };
	} finally {
		restoreWorktree(harness.repo, worktree);
		rmSync(staging, { recursive: true, force: true });
	}
}

/**
 * MA4 (review): freeze-ledger requires the captured reviewer artifacts to be
 * complete on disk, so every fixture that freezes via a hand-built
 * review_result first admits one artifact per selected lens through the real
 * admission path (result-artifacts.ts) — mapping the finalize submission rows
 * onto full compact-v2 envelope rows with the evidence vocabulary filled in.
 */
export function admitFixtureReviewerResults(
	harness: ReviewHarnessV1,
	lineageId: string,
	reviewResult: { readonly lens_results: readonly { readonly lens: import("../../lib/authority/protocol.ts").JeroLensName; readonly findings?: readonly { readonly id?: string; readonly severity?: "BLOCKER" | "CRITICAL" | "WARNING" | "SUGGESTION"; readonly claim?: string }[]; readonly evidence?: readonly string[] }[] },
): void {
	const loaded = JeroLineageStoreV1.forStore(harness.context.store.store_root).load(lineageId);
	if (loaded.kind !== "ok") throw new Error(`fixture lineage load failed: ${loaded.kind}`);
	const record = loaded.record;
	const selected = record.state.selected_lenses ?? [];
	for (const submitted of reviewResult.lens_results) {
		const order = selected.indexOf(submitted.lens);
		if (order < 0) throw new Error(`fixture lens ${submitted.lens} is not in the selected set`);
		const subject = jeroArtifactSubjectForRecordV1(harness.context.store.store_root, record, submitted.lens, order);
		const envelope = Buffer.from(JSON.stringify({
			review_result: { lens_results: [{
				lens: submitted.lens,
				findings: (submitted.findings ?? []).map((finding, index) => ({
					id: finding.id ?? `${submitted.lens}-${index}`,
					lens: submitted.lens,
					location: "src/app.ts:1",
					severity: finding.severity ?? "WARNING",
					claim: finding.claim ?? "fixture finding",
					evidence_class: "deterministic",
					causal_disposition: "introduced",
					proof_refs: ["changed-hunk:src/app.ts:1"],
				})),
				evidence: submitted.evidence !== undefined && submitted.evidence.length > 0 ? [...submitted.evidence] : [`scope-reviewed evidence for ${submitted.lens}`],
			}] },
		}));
		const admitted = admitJeroReviewerResultV1(harness.context, {
			lineageId, lens: submitted.lens, selectedOrder: order,
			subjectHash: subject.subject_hash, rawResultBytes: envelope, locator: "path",
		});
		if (admitted.kind !== "admitted") throw new Error(`fixture artifact admission failed: ${JSON.stringify(admitted)}`);
	}
}
