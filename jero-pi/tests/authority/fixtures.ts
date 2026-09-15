import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { JeroLineageDraftV1 } from "../../lib/authority/lineage-store.ts";
import { JERO_REVIEW_TRANSACTION_SCHEMA } from "../../lib/authority/canonical.ts";
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
