import assert from "node:assert/strict";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { parseCanonicalJsonV1, canonicalBytesV1, sha256Hex } from "../../lib/review-canonical.ts";
import { reviewStartV1 } from "../../lib/authority/start.ts";
import { reviewFinalizeV1 } from "../../lib/authority/finalize.ts";
import { assertJeroReceiptIntegrityV1, jeroReceiptPathV1 } from "../../lib/authority/receipts.ts";
import { JERO_RECEIPT_BODY_SCHEMA } from "../../lib/authority/canonical.ts";
import type { JeroReceiptEnvelopeV1 } from "../../lib/authority/protocol.ts";
import type { JeroAuthorityContextV1 } from "../../lib/authority/review.ts";
import { JeroLineageStoreV1 } from "../../lib/authority/lineage-store.ts";
import { JeroObjectCasV1 } from "../../lib/authority/object-cas.ts";
import { JeroAuthorityLocksV1 } from "../../lib/authority/locks.ts";
import { applyFixtureFix, reviewHarness, tempRoot, testTransactionState, LINEAGE_ID } from "./fixtures.ts";

// Spec §D: FINALIZE — lens admission, evidence classification/refutation,
// severe-only correction admission, follow-ups, malformed→escalated triggers,
// budget enforcement, outcome computation, and §D.8 receipt persistence.

function freezeWith(t: { after: (callback: () => void) => void}, findings: { id?: string; severity?: "BLOCKER" | "CRITICAL" | "WARNING" | "SUGGESTION"; claim?: string }[], evidence = ["complete candidate reviewed"]) {
	const harness = reviewHarness(t, "medium", 4);
	const start = reviewStartV1(harness.context, { cwd: harness.repo }, { consent: "granted" });
	if (start.kind !== "created") throw new Error(JSON.stringify(start));
	const frozen = reviewFinalizeV1(harness.context, {
		cwd: harness.repo, lineageId: start.lineage_id, reviewer_run_acknowledged: true,
		review_result: { lens_results: [{ lens: "review-readability", findings, evidence }] },
	});
	if (frozen.kind !== "frozen") throw new Error(JSON.stringify(frozen));
	return { harness, start, frozen };
}

test("forecast-only FINALIZE spends nothing: no state change, no journal entry", (t) => {
	const harness = reviewHarness(t, "medium", 4);
	const start = reviewStartV1(harness.context, { cwd: harness.repo }, { consent: "granted" });
	if (start.kind !== "created") throw new Error("start failed");
	const forecast = reviewFinalizeV1(harness.context, {
		cwd: harness.repo, lineageId: start.lineage_id,
		review_result: { lens_results: [{ lens: "review-readability", findings: [], evidence: ["x"] }] },
	});
	assert.equal(forecast.kind, "forecast");
	const loaded = JeroLineageStoreV1.forStore(harness.context.store.store_root).load(start.lineage_id);
	if (loaded.kind !== "ok") throw new Error("load failed");
	assert.equal(loaded.record.state.state, "reviewing");
	assert.equal(loaded.record.state.findings.length, 0);
	// Only the START journal entry exists — the forecast charged nothing.
	assert.equal(loaded.record.request_journal.length, 1);
});

test("happy approve: clean lens results resolve to final verification and an approved receipt", (t) => {
	const harness = reviewHarness(t, "medium", 4);
	const start = reviewStartV1(harness.context, { cwd: harness.repo }, { consent: "granted" });
	if (start.kind !== "created") throw new Error("start failed");
	const frozen = reviewFinalizeV1(harness.context, {
		cwd: harness.repo, lineageId: start.lineage_id, reviewer_run_acknowledged: true,
		review_result: { lens_results: [{ lens: "review-readability", findings: [], evidence: ["complete candidate reviewed"] }] },
	});
	assert.equal(frozen.kind, "frozen");
	if (frozen.kind !== "frozen") return;
	assert.equal(frozen.state, "findings_frozen");
	assert.deepEqual(frozen.findings, []);
	assert.match(frozen.ledger_findings_hash, /^sha256:[0-9a-f]{64}$/);
	// Native ID assignment and canonicalization are authority-owned.
	const resolved = reviewFinalizeV1(harness.context, { cwd: harness.repo, lineageId: start.lineage_id, classifications: [] });
	assert.equal(resolved.kind, "evidence_resolved");
	if (resolved.kind !== "evidence_resolved") return;
	assert.equal(resolved.state, "validating");
	assert.deepEqual(resolved.fix_finding_ids, []);
	const approved = reviewFinalizeV1(harness.context, {
		cwd: harness.repo, lineageId: start.lineage_id,
		final_evidence: "final verification output", final_verification_passed: true,
	});
	assert.equal(approved.kind, "terminal");
	if (approved.kind !== "terminal") return;
	assert.equal(approved.state, "approved");
	assert.match(approved.receipt_hash, /^sha256:[0-9a-f]{64}$/);
	// §D.8: the receipt envelope persists at lineages/<id>/review-receipt.json
	// and re-asserts its integrity on read (receipts.ts).
	const envelope = parseCanonicalJsonV1(readFileSync(jeroReceiptPathV1(harness.context.store.store_root, start.lineage_id)));
	assert.doesNotThrow(() => assertJeroReceiptIntegrityV1(envelope as JeroReceiptEnvelopeV1));
	// ...and the body is installed in the CAS (content hash over canonical bytes).
	const cas = JeroObjectCasV1.forStore(harness.context.store.store_root);
	const casId = sha256Hex(canonicalBytesV1((envelope as { body: unknown }).body));
	const body = cas.get(casId, (value) => value);
	assert.equal((body as { schema: string }).schema, JERO_RECEIPT_BODY_SCHEMA);
});

test("severe candidate-caused findings enter fix_finding_ids; pre-existing/base-only become follow-ups", (t) => {
	const { harness, start } = freezeWith(t, [
		{ id: "severe-1", severity: "BLOCKER", claim: "introduced blocker" },
		{ id: "severe-2", severity: "CRITICAL", claim: "pre-existing critical" },
		{ id: "warn-1", severity: "WARNING", claim: "informational" },
	]);
	const resolved = reviewFinalizeV1(harness.context, {
		cwd: harness.repo, lineageId: start.lineage_id,
		classifications: [
			{ finding_id: "severe-1", class: "deterministic", proof: "changed hunk proof", causal_disposition: "introduced" },
			{ finding_id: "severe-2", class: "deterministic", proof: "diff test proof", causal_disposition: "pre-existing" },
			{ finding_id: "warn-1", class: "deterministic", proof: "hunk proof", causal_disposition: "worsened" },
		],
	});
	assert.equal(resolved.kind, "evidence_resolved");
	if (resolved.kind !== "evidence_resolved") return;
	assert.equal(resolved.state, "correction_required");
	assert.deepEqual(resolved.fix_finding_ids, ["severe-1"]);
	// The pre-existing severe row becomes an inert follow-up observation.
	assert.equal(resolved.follow_ups.some((followUp) => followUp.observation.startsWith("severe-2: pre-existing")), true);
});

test("malformed or inconclusive severe claims escalate terminally", (t) => {
	const unknownCausality = (() => {
		const { harness, start } = freezeWith(t, [{ id: "s-unknown", severity: "BLOCKER" }]);
		return reviewFinalizeV1(harness.context, {
			cwd: harness.repo, lineageId: start.lineage_id,
			classifications: [{ finding_id: "s-unknown", class: "deterministic", proof: "proof", causal_disposition: "unknown" }],
		});
	})();
	assert.equal(unknownCausality.kind, "terminal");
	if (unknownCausality.kind === "terminal") {
		assert.equal(unknownCausality.state, "escalated");
		assert.equal(unknownCausality.escalation?.cause, "unknown_causality");
	}
	const insufficient = (() => {
		const { harness, start } = freezeWith(t, [{ id: "s-insufficient", severity: "CRITICAL" }]);
		return reviewFinalizeV1(harness.context, {
			cwd: harness.repo, lineageId: start.lineage_id,
			classifications: [{ finding_id: "s-insufficient", class: "insufficient", proof: "no concrete proof", causal_disposition: "introduced" }],
		});
	})();
	assert.equal(insufficient.kind, "terminal");
	if (insufficient.kind === "terminal") assert.equal(insufficient.escalation?.cause, "insufficient_evidence");
	const unclassified = (() => {
		const { harness, start } = freezeWith(t, [{ id: "s-missing", severity: "BLOCKER" }]);
		return reviewFinalizeV1(harness.context, { cwd: harness.repo, lineageId: start.lineage_id, classifications: [] });
	})();
	assert.equal(unclassified.kind, "terminal");
	const unknownRow = (() => {
		const { harness, start } = freezeWith(t, []);
		return reviewFinalizeV1(harness.context, {
			cwd: harness.repo, lineageId: start.lineage_id,
			classifications: [{ finding_id: "does-not-exist", class: "deterministic", proof: "p" }],
		});
	})();
	assert.equal(unknownRow.kind, "terminal");
	if (unknownRow.kind === "terminal") assert.equal(unknownRow.escalation?.cause, "insufficient_evidence");
});

test("inferential severe: first FINALIZE returns canonical rows + request hash; the bound second resolves", (t) => {
	const { harness, start } = freezeWith(t, [{ id: "infer-1", severity: "BLOCKER" }]);
	const first = reviewFinalizeV1(harness.context, {
		cwd: harness.repo, lineageId: start.lineage_id,
		classifications: [{ finding_id: "infer-1", class: "inferential", proof: "reasoned proof", causal_disposition: "introduced" }],
	});
	assert.equal(first.kind, "refuter_required");
	if (first.kind !== "refuter_required") return;
	assert.deepEqual(first.canonical_rows.map(({ id }) => id), ["infer-1"]);
	assert.match(first.refuter_request_hash, /^sha256:[0-9a-f]{64}$/);
	// The state is unchanged while the refuter is pending.
	const pending = JeroLineageStoreV1.forStore(harness.context.store.store_root).load(start.lineage_id);
	if (pending.kind === "ok") assert.equal(pending.record.state.state, "findings_frozen");
	// An unbound refuter batch (wrong request hash) is refused.
	const unbound = reviewFinalizeV1(harness.context, {
		cwd: harness.repo, lineageId: start.lineage_id,
		classifications: [{ finding_id: "infer-1", class: "inferential", proof: "reasoned proof", causal_disposition: "introduced" }],
		refuter_batch: { request_hash: `sha256:${"0".repeat(64)}`, resolutions: [{ finding_id: "infer-1", outcome: "corroborated", proof: "reproduction" }] },
	});
	assert.equal(unbound.kind, "refused");
	// The bound corroborating batch admits the correction ID.
	const second = reviewFinalizeV1(harness.context, {
		cwd: harness.repo, lineageId: start.lineage_id,
		classifications: [{ finding_id: "infer-1", class: "inferential", proof: "reasoned proof", causal_disposition: "introduced" }],
		refuter_batch: { request_hash: first.refuter_request_hash, resolutions: [{ finding_id: "infer-1", outcome: "corroborated", proof: "independent reproduction" }] },
	});
	assert.equal(second.kind, "evidence_resolved");
	if (second.kind === "evidence_resolved") {
		assert.deepEqual(second.fix_finding_ids, ["infer-1"]);
		// refuter_batches counted exactly one.
		const loaded = JeroLineageStoreV1.forStore(harness.context.store.store_root).load(start.lineage_id);
		if (loaded.kind === "ok") assert.equal(loaded.record.state.counters.refuter_batches, 1);
	}
});

test("an inconclusive refuter escalates WITHOUT a replacement batch (readme:293)", (t) => {
	const { harness, start } = freezeWith(t, [{ id: "infer-x", severity: "BLOCKER" }]);
	const first = reviewFinalizeV1(harness.context, {
		cwd: harness.repo, lineageId: start.lineage_id,
		classifications: [{ finding_id: "infer-x", class: "inferential", proof: "proof", causal_disposition: "worsened" }],
	});
	if (first.kind !== "refuter_required") throw new Error(JSON.stringify(first));
	const second = reviewFinalizeV1(harness.context, {
		cwd: harness.repo, lineageId: start.lineage_id,
		classifications: [{ finding_id: "infer-x", class: "inferential", proof: "proof", causal_disposition: "worsened" }],
		refuter_batch: { request_hash: first.refuter_request_hash, resolutions: [{ finding_id: "infer-x", outcome: "inconclusive", proof: "could not reproduce or refute" }] },
	});
	assert.equal(second.kind, "terminal");
	if (second.kind === "terminal") {
		assert.equal(second.state, "escalated");
		assert.equal(second.escalation?.cause, "unresolved_severe_findings");
	}
	// A malformed refuter batch (unknown finding) escalates the same way.
	const { harness: h2, start: s2 } = freezeWith(t, [{ id: "infer-y", severity: "CRITICAL" }]);
	const first2 = reviewFinalizeV1(h2.context, {
		cwd: h2.repo, lineageId: s2.lineage_id,
		classifications: [{ finding_id: "infer-y", class: "inferential", proof: "proof", causal_disposition: "introduced" }],
	});
	if (first2.kind !== "refuter_required") throw new Error(JSON.stringify(first2));
	const malformed = reviewFinalizeV1(h2.context, {
		cwd: h2.repo, lineageId: s2.lineage_id,
		classifications: [{ finding_id: "infer-y", class: "inferential", proof: "proof", causal_disposition: "introduced" }],
		refuter_batch: { request_hash: first2.refuter_request_hash, resolutions: [{ finding_id: "not-a-finding", outcome: "corroborated", proof: "p" }] },
	});
	assert.equal(malformed.kind, "terminal");
	if (malformed.kind === "terminal") assert.equal(malformed.escalation?.cause, "missing_refuter_outcome");
});

test("correction-plan forecast is bounded to positive integers in 1..200", (t) => {
	const { harness, start } = freezeWith(t, [{ id: "sev", severity: "BLOCKER" }]);
	const resolved = reviewFinalizeV1(harness.context, {
		cwd: harness.repo, lineageId: start.lineage_id,
		classifications: [{ finding_id: "sev", class: "deterministic", proof: "p", causal_disposition: "introduced" }],
	});
	assert.equal(resolved.kind, "evidence_resolved");
	for (const forecast of [0, -1, 201, 1.5, Number.NaN]) {
		const refused = reviewFinalizeV1(harness.context, { cwd: harness.repo, lineageId: start.lineage_id, correction_line_forecast: forecast });
		assert.equal(refused.kind, "refused", `forecast ${forecast}`);
		if (refused.kind === "refused") assert.equal(refused.code, "invalid-request");
	}
	const authorized = reviewFinalizeV1(harness.context, { cwd: harness.repo, lineageId: start.lineage_id, correction_line_forecast: 2 });
	assert.equal(authorized.kind, "fix_authorized");
	if (authorized.kind === "fix_authorized") {
		assert.equal(authorized.state, "correction_required");
		assert.equal(authorized.proposed_correction_lines, 2);
	}
});

test("budget overrun on the applied fix escalates and never reopens correction", (t) => {
	const { harness, start } = freezeWith(t, [{ id: "sev", severity: "BLOCKER" }]);
	reviewFinalizeV1(harness.context, {
		cwd: harness.repo, lineageId: start.lineage_id,
		classifications: [{ finding_id: "sev", class: "deterministic", proof: "p", causal_disposition: "introduced" }],
	});
	reviewFinalizeV1(harness.context, { cwd: harness.repo, lineageId: start.lineage_id, correction_line_forecast: 4 });
	// The frozen budget is min(200, ceil(4/2)) = 2; a REAL 4-line fix (two
	// rewritten lines = 2 additions + 2 deletions) exceeds it. The numbers are
	// derived from the isolated snapshot object store, not caller-declared (F5).
	const overrunFix = applyFixtureFix(harness, start.lineage_id, (repo) => {
		writeFileSync(join(repo, "src", "app.ts"), "export const fixed = 1;\nexport const hardened = true;\nexport const placeholder = 0;\nexport const placeholder = 0;\n");
	});
	assert.ok(overrunFix.actual_correction_lines > 2, `fixture fix must exceed the budget 2, derived ${overrunFix.actual_correction_lines}`);
	const overrun = reviewFinalizeV1(harness.context, {
		cwd: harness.repo, lineageId: start.lineage_id,
		fix_application: { ...overrunFix, actual_correction_lines: overrunFix.actual_correction_lines },
	});
	assert.equal(overrun.kind, "terminal");
	if (overrun.kind === "terminal") {
		assert.equal(overrun.state, "escalated");
		assert.equal(overrun.escalation?.cause, "correction_budget_exceeded");
	}
	// F14: the escalation is journaled under the apply-time operation, not the
	// plan-admission one.
	const escalatedRecord = JeroLineageStoreV1.forStore(harness.context.store.store_root).load(start.lineage_id);
	if (escalatedRecord.kind !== "ok") throw new Error("load failed");
	assert.equal(escalatedRecord.record.request_journal.at(-1)?.operation, "apply-fix");
	// The escalated lineage is terminal: no further mutation.
	const after = reviewFinalizeV1(harness.context, {
		cwd: harness.repo, lineageId: start.lineage_id,
		fix_application: { ...overrunFix, actual_correction_lines: 1 },
	});
	assert.equal(after.kind, "refused");
	if (after.kind === "refused") assert.equal(after.code, "terminal-immutable");
});

test("F5: a lying caller is refused — declared lines must equal the derived numstat over the snapshot object store", (t) => {
	const { harness, start } = freezeWith(t, [{ id: "sev", severity: "BLOCKER" }]);
	reviewFinalizeV1(harness.context, {
		cwd: harness.repo, lineageId: start.lineage_id,
		classifications: [{ finding_id: "sev", class: "deterministic", proof: "p", causal_disposition: "introduced" }],
	});
	reviewFinalizeV1(harness.context, { cwd: harness.repo, lineageId: start.lineage_id, correction_line_forecast: 2 });
	const realFix = applyFixtureFix(harness, start.lineage_id, (repo) => {
		writeFileSync(join(repo, "src", "app.ts"), "export const placeholder = 1;\nexport const placeholder = 0;\nexport const placeholder = 0;\nexport const placeholder = 0;\n");
	});
	assert.equal(realFix.actual_correction_lines, 2);
	// The tree is real but the declared count lies (understates, the budget
	// attack vector): refused, and the lineage stays in `fixing`.
	const lying = reviewFinalizeV1(harness.context, {
		cwd: harness.repo, lineageId: start.lineage_id,
		fix_application: { ...realFix, actual_correction_lines: 0 },
	});
	assert.equal(lying.kind, "refused");
	if (lying.kind === "refused") {
		assert.equal(lying.code, "fix-verification-failed");
		assert.match(lying.detail ?? "", /derives 2/);
	}
	const afterLie = JeroLineageStoreV1.forStore(harness.context.store.store_root).load(start.lineage_id);
	if (afterLie.kind !== "ok") throw new Error("load failed");
	assert.equal(afterLie.record.state.state, "fixing");
	// Consistent numbers proceed: the verified tree advances to fix_validating.
	const honest = reviewFinalizeV1(harness.context, {
		cwd: harness.repo, lineageId: start.lineage_id,
		fix_application: realFix,
	});
	assert.equal(honest.kind, "fix_applied");
	if (honest.kind === "fix_applied") {
		assert.equal(honest.actual_correction_lines, 2);
		const applied = JeroLineageStoreV1.forStore(harness.context.store.store_root).load(start.lineage_id);
		if (applied.kind !== "ok") throw new Error("load failed");
		assert.equal(applied.record.state.state, "fix_validating");
		assert.equal(applied.record.state.final_candidate_tree, realFix.candidate_tree);
	}
});

test("F5: an unresolvable declared tree and an out-of-scope tree both fail verification", (t) => {
	const { harness, start } = freezeWith(t, [{ id: "sev", severity: "BLOCKER" }]);
	reviewFinalizeV1(harness.context, {
		cwd: harness.repo, lineageId: start.lineage_id,
		classifications: [{ finding_id: "sev", class: "deterministic", proof: "p", causal_disposition: "introduced" }],
	});
	reviewFinalizeV1(harness.context, { cwd: harness.repo, lineageId: start.lineage_id, correction_line_forecast: 2 });
	// A well-formed 40-hex tree that resolves NOWHERE: the derivation refuses.
	const unresolvable = reviewFinalizeV1(harness.context, {
		cwd: harness.repo, lineageId: start.lineage_id,
		fix_application: { candidate_tree: "d".repeat(40), fix_delta_hash: "b".repeat(64), correction_paths: ["src/app.ts"], actual_correction_lines: 1 },
	});
	assert.equal(unresolvable.kind, "refused");
	if (unresolvable.kind === "refused") {
		assert.equal(unresolvable.code, "fix-verification-failed");
		assert.match(unresolvable.detail ?? "", /does not resolve/);
	}
	// A REAL tree whose diff also touches a path outside genesis while the
	// declared correction_paths stay silent about it: derived scope refusal.
	const sneaky = applyFixtureFix(harness, start.lineage_id, (repo) => {
		writeFileSync(join(repo, "src", "app.ts"), "export const placeholder = 1;\nexport const placeholder = 0;\nexport const placeholder = 0;\nexport const placeholder = 0;\n");
		writeFileSync(join(repo, "README.md"), "test\nsneaky out-of-scope edit\n");
	});
	const scoped = reviewFinalizeV1(harness.context, {
		cwd: harness.repo, lineageId: start.lineage_id,
		fix_application: { ...sneaky, correction_paths: ["src/app.ts"] },
	});
	assert.equal(scoped.kind, "refused");
	if (scoped.kind === "refused") {
		assert.equal(scoped.code, "non-genesis-path");
		assert.match(scoped.detail ?? "", /README\.md/);
	}
});

test("a fix touching a non-genesis path fails closed", (t) => {
	const { harness, start } = freezeWith(t, [{ id: "sev", severity: "BLOCKER" }]);
	reviewFinalizeV1(harness.context, {
		cwd: harness.repo, lineageId: start.lineage_id,
		classifications: [{ finding_id: "sev", class: "deterministic", proof: "p", causal_disposition: "introduced" }],
	});
	reviewFinalizeV1(harness.context, { cwd: harness.repo, lineageId: start.lineage_id, correction_line_forecast: 2 });
	const refused = reviewFinalizeV1(harness.context, {
		cwd: harness.repo, lineageId: start.lineage_id,
		fix_application: { candidate_tree: "a".repeat(40), fix_delta_hash: "b".repeat(64), correction_paths: ["src/outside-genesis.ts"], actual_correction_lines: 1 },
	});
	assert.equal(refused.kind, "refused");
	if (refused.kind === "refused") assert.equal(refused.code, "non-genesis-path");
});

test("lenses run exactly once: a second freeze attempt from findings_frozen is refused", (t) => {
	const { harness, start } = freezeWith(t, []);
	const again = reviewFinalizeV1(harness.context, {
		cwd: harness.repo, lineageId: start.lineage_id, reviewer_run_acknowledged: true,
		review_result: { lens_results: [{ lens: "review-readability", findings: [], evidence: ["again"] }] },
	});
	assert.equal(again.kind, "refused");
	if (again.kind === "refused") assert.equal(again.code, "invalid-state");
});

test("terminal lineages refuse every finalize mutation (zero-lens close included)", (t) => {
	const harness = reviewHarness(t, "low", 2);
	const start = reviewStartV1(harness.context, { cwd: harness.repo }, { consent: "granted" });
	if (start.kind !== "closed") throw new Error(JSON.stringify(start));
	const any = reviewFinalizeV1(harness.context, {
		cwd: harness.repo, lineageId: start.lineage_id, reviewer_run_acknowledged: true,
		review_result: { lens_results: [] },
	});
	assert.equal(any.kind, "refused");
	if (any.kind === "refused") assert.equal(any.code, "terminal-immutable");
});

test("a Judgment Day lineage refuses the ordinary lens admission while preserving counters", (t) => {
	const storeRoot = tempRoot("jero-authority-jd-");
	t.after(() => rmSync(storeRoot, { recursive: true, force: true }));
	const store = JeroLineageStoreV1.forStore(storeRoot);
	const state = testTransactionState(LINEAGE_ID);
	state.mode = "judgment_day";
	state.state = "reviewing";
	state.selected_lenses = [];
	store.save(LINEAGE_ID, { state, request_journal: [] }, { expectedRevision: null });
	const context = {
		store: { common_directory: storeRoot, store_root: storeRoot, repository_identity: { schema: "jero.authority.repository/v1", object_format: "sha1", root_commit_ids: ["1".repeat(40)] }, repository_id: "2".repeat(64), authority_id: "3".repeat(64) },
		lineages: store,
		cas: JeroObjectCasV1.forStore(storeRoot),
		locks: new JeroAuthorityLocksV1(storeRoot, "2".repeat(64), "3".repeat(64)),
	} as unknown as JeroAuthorityContextV1;
	const refused = reviewFinalizeV1(context, {
		cwd: storeRoot, lineageId: LINEAGE_ID, reviewer_run_acknowledged: true,
		review_result: { lens_results: [] },
	});
	assert.equal(refused.kind, "refused");
	if (refused.kind === "refused") assert.equal(refused.code, "cross-mode-operation-refused");
	// The refusal preserved the JD counters untouched.
	const loaded = store.load(LINEAGE_ID);
	if (loaded.kind !== "ok") throw new Error("load failed");
	assert.equal(loaded.record.state.counters.judge_executions, 1);
	assert.equal(loaded.record.state.counters.full_reviews, 1);
});

test("final verification outcome escalation: failed verification never approves", (t) => {
	const harness = reviewHarness(t, "medium", 4);
	const start = reviewStartV1(harness.context, { cwd: harness.repo }, { consent: "granted" });
	if (start.kind !== "created") throw new Error("start failed");
	reviewFinalizeV1(harness.context, {
		cwd: harness.repo, lineageId: start.lineage_id, reviewer_run_acknowledged: true,
		review_result: { lens_results: [{ lens: "review-readability", findings: [], evidence: ["clean"] }] },
	});
	reviewFinalizeV1(harness.context, { cwd: harness.repo, lineageId: start.lineage_id, classifications: [] });
	const escalated = reviewFinalizeV1(harness.context, {
		cwd: harness.repo, lineageId: start.lineage_id,
		final_evidence: "verification failed output", final_verification_passed: false,
	});
	assert.equal(escalated.kind, "terminal");
	if (escalated.kind === "terminal") assert.equal(escalated.state, "escalated");
});

test("wrapper contract failures surface as invalid-request refusals with the ported area/code", (t) => {
	const harness = reviewHarness(t, "medium", 4);
	const start = reviewStartV1(harness.context, { cwd: harness.repo }, { consent: "granted" });
	if (start.kind !== "created") throw new Error("start failed");
	// final_evidence without exactly one verification result (field-pair).
	const paired = reviewFinalizeV1(harness.context, { cwd: harness.repo, lineageId: start.lineage_id, final_evidence: "x", final_verification_passed: true, final_verification_outcome: "passed" });
	assert.equal(paired.kind, "refused");
	if (paired.kind === "refused") assert.match(paired.detail ?? "", /field-pair/);
	// Out-of-enum final outcome.
	const badEnum = reviewFinalizeV1(harness.context, { cwd: harness.repo, lineageId: start.lineage_id, final_evidence: "x", final_verification_outcome: "exploded" as never });
	assert.equal(badEnum.kind, "refused");
	if (badEnum.kind === "refused") assert.match(badEnum.detail ?? "", /enum/);
	// Unknown M2 extension key.
	const unknown = reviewFinalizeV1(harness.context, { cwd: harness.repo, lineageId: start.lineage_id, extra: 1 } as never);
	assert.equal(unknown.kind, "refused");
	if (unknown.kind === "refused") assert.match(unknown.detail ?? "", /unknown field/);
	// Validation documents are admitted through authority.review.validate.
	const misrouted = reviewFinalizeV1(harness.context, { cwd: harness.repo, lineageId: start.lineage_id, validation: {} } as never);
	assert.equal(misrouted.kind, "refused");
	if (misrouted.kind === "refused") assert.equal(misrouted.code, "validation-belongs-to-validate");
});

test("exact finalize replay returns the stored canonical result", (t) => {
	const harness = reviewHarness(t, "medium", 4);
	const start = reviewStartV1(harness.context, { cwd: harness.repo }, { consent: "granted" });
	if (start.kind !== "created") throw new Error("start failed");
	const input = {
		cwd: harness.repo, lineageId: start.lineage_id, reviewer_run_acknowledged: true,
		review_result: { lens_results: [{ lens: "review-readability" as const, findings: [], evidence: ["clean"] }] },
		idempotencyKey: "freeze-key",
	};
	const first = reviewFinalizeV1(harness.context, input);
	assert.equal(first.kind, "frozen");
	const replay = reviewFinalizeV1(harness.context, input);
	assert.equal(replay.kind, "frozen");
	// Key reuse with a different request payload fails closed.
	const divergent = reviewFinalizeV1(harness.context, { ...input, review_result: { lens_results: [{ lens: "review-readability", findings: [{ id: "f", severity: "WARNING" }], evidence: ["clean"] }] } });
	assert.equal(divergent.kind, "refused");
	if (divergent.kind === "refused") assert.match(divergent.detail ?? "", /reused with a different request/);
});
