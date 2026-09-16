import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { reviewStartV1 } from "../../lib/authority/start.ts";
import { reviewFinalizeV1 } from "../../lib/authority/finalize.ts";
import { reviewValidateV1, expectedJeroTargetedValidationRequestHashV1, type JeroReviewValidateInputV1 } from "../../lib/authority/validate.ts";
import { JeroLineageStoreV1 } from "../../lib/authority/lineage-store.ts";
import { admitFixtureReviewerResults, applyFixtureFix, reviewHarness } from "./fixtures.ts";

// Spec §E: VALIDATE — evidence-first ordering, the request_hash binding, the
// 1:1 correction-scope pairing, fix-caused findings, regression escalation,
// and the verification_failed reopen that charges nothing.

interface CorrectionFixture {
	harness: ReturnType<typeof reviewHarness>;
	lineageId: string;
	requestHash: string;
}

/** A real 2-line correction rewrite of the fixture candidate (within the frozen budget of 2). */
function fixMutation(changedLine = 1): (repo: string) => void {
	return (repo) => {
		const lines = ["export const placeholder = 0;\n", "export const placeholder = 0;\n", "export const placeholder = 0;\n", "export const placeholder = 0;\n"];
		lines[changedLine - 1] = `export const fixed = ${changedLine};\n`;
		writeFileSync(join(repo, "src", "app.ts"), lines.join(""));
	};
}

/** Drives a lineage into fix_validating with one admitted severe correction finding. */
function driveToFixValidating(t: { after: (callback: () => void) => void }): CorrectionFixture {
	const harness = reviewHarness(t, "medium", 4);
	const start = reviewStartV1(harness.context, { cwd: harness.repo }, { consent: "granted" });
	if (start.kind !== "created") throw new Error(JSON.stringify(start));
	const driveResult = { lens_results: [{ lens: "review-readability" as const, findings: [{ id: "sev-1", severity: "BLOCKER" as const, claim: "introduced blocker" }], evidence: ["hunk"] }] };
	admitFixtureReviewerResults(harness, start.lineage_id, driveResult);
	reviewFinalizeV1(harness.context, {
		cwd: harness.repo, lineageId: start.lineage_id, reviewer_run_acknowledged: true,
		review_result: driveResult,
	});
	reviewFinalizeV1(harness.context, {
		cwd: harness.repo, lineageId: start.lineage_id,
		classifications: [{ finding_id: "sev-1", class: "deterministic", proof: "changed-hunk proof", causal_disposition: "introduced" }],
	});
	reviewFinalizeV1(harness.context, { cwd: harness.repo, lineageId: start.lineage_id, correction_line_forecast: 2 });
	// F5: the applied fix carries a REAL tree plus the derived line count.
	const fix = applyFixtureFix(harness, start.lineage_id, fixMutation(1));
	assert.equal(fix.actual_correction_lines, 2);
	reviewFinalizeV1(harness.context, {
		cwd: harness.repo, lineageId: start.lineage_id,
		fix_application: fix,
	});
	const loaded = JeroLineageStoreV1.forStore(harness.context.store.store_root).load(start.lineage_id);
	if (loaded.kind !== "ok") throw new Error("load failed");
	assert.equal(loaded.record.state.state, "fix_validating");
	return { harness, lineageId: start.lineage_id, requestHash: expectedJeroTargetedValidationRequestHashV1(loaded.record.state) };
}

function passingValidation(requestHash: string): JeroReviewValidateInputV1["validation"] {
	return {
		request_hash: requestHash,
		correction_ids: ["sev-1"],
		original_criteria: { passed: true, evidence: ["original acceptance suite passed"] },
		correction_regression: { passed: true, evidence: ["regression proof for sev-1"] },
		fix_caused_findings: [],
		follow_ups: [],
	};
}

test("evidence-first ordering: targeted validation before recorded correction evidence fails closed", (t) => {
	const { harness, lineageId, requestHash } = driveToFixValidating(t);
	// Even a perfect answer document is refused while fix_validating has no
	// correction evidence outcome recorded — §E's evidence-first ordering is
	// enforced by resolveCorrectionStep through the ported lifecycle machine.
	const refused = reviewValidateV1(harness.context, {
		cwd: harness.repo, lineageId,
		evidence: { outcome: "verification_failed", evidenceIdentity: "cap-1", recordDigest: "e".repeat(64) },
		validation: passingValidation(requestHash),
	});
	// verification_failed maps to recapture, not validation — the answer document never ran.
	assert.equal(refused.kind, "recapture_required");
});

test("happy targeted validation: passed evidence + bound answer document advances to final verification", (t) => {
	const { harness, lineageId, requestHash } = driveToFixValidating(t);
	const validated = reviewValidateV1(harness.context, {
		cwd: harness.repo, lineageId,
		evidence: { outcome: "passed", evidenceIdentity: "cap-1", recordDigest: "e".repeat(64), candidateTree: "c".repeat(40) },
		validation: passingValidation(requestHash),
	});
	assert.equal(validated.kind, "validated");
	if (validated.kind !== "validated") return;
	assert.equal(validated.state, "validating");
	assert.deepEqual(validated.validated_finding_ids, ["sev-1"]);
	const loaded = JeroLineageStoreV1.forStore(harness.context.store.store_root).load(lineageId);
	if (loaded.kind !== "ok") throw new Error("load failed");
	assert.equal(loaded.record.state.state, "ready_final_verification");
	assert.equal(loaded.record.state.counters.scoped_fix_validations, 1);
	assert.equal(loaded.record.state.original_criteria?.passed, true);
	assert.equal(loaded.record.state.correction_regression?.passed, true);
	// The passed correction evidence is persisted (evidence-first ordering).
	assert.equal(loaded.record.state.correction_evidence?.outcome, "passed");
});

test("request_hash binding: an answer document for a different scope is refused", (t) => {
	const { harness, lineageId } = driveToFixValidating(t);
	const refused = reviewValidateV1(harness.context, {
		cwd: harness.repo, lineageId,
		evidence: { outcome: "passed", evidenceIdentity: "cap-1", recordDigest: "e".repeat(64) },
		validation: passingValidation("f".repeat(64)),
	});
	assert.equal(refused.kind, "refused");
	if (refused.kind === "refused") assert.equal(refused.code, "request-hash-mismatch");
});

test("correction_ids must pair 1:1 with the frozen fix_finding_ids", (t) => {
	const { harness, lineageId, requestHash } = driveToFixValidating(t);
	const omitted = reviewValidateV1(harness.context, {
		cwd: harness.repo, lineageId,
		evidence: { outcome: "passed", evidenceIdentity: "cap-1", recordDigest: "e".repeat(64) },
		validation: { ...passingValidation(requestHash), correction_ids: [] },
	});
	assert.equal(omitted.kind, "refused");
	if (omitted.kind === "refused") assert.equal(omitted.code, "correction-scope-mismatch");
	const added = reviewValidateV1(harness.context, {
		cwd: harness.repo, lineageId,
		evidence: { outcome: "passed", evidenceIdentity: "cap-1", recordDigest: "e".repeat(64) },
		validation: { ...passingValidation(requestHash), correction_ids: ["sev-1", "sev-2"] },
	});
	assert.equal(added.kind, "refused");
	if (added.kind === "refused") assert.equal(added.code, "correction-scope-mismatch");
});

test("fix-caused findings escalate terminally: the validator cannot add findings", (t) => {
	const { harness, lineageId, requestHash } = driveToFixValidating(t);
	const escalated = reviewValidateV1(harness.context, {
		cwd: harness.repo, lineageId,
		evidence: { outcome: "passed", evidenceIdentity: "cap-1", recordDigest: "e".repeat(64) },
		validation: passingValidation(requestHash),
		fix_caused_result: [{ id: "new-1", severity: "BLOCKER", claim: "the fix broke retry handling" }],
	});
	assert.equal(escalated.kind, "terminal");
	if (escalated.kind === "terminal") {
		assert.equal(escalated.state, "escalated");
		assert.equal(escalated.escalation?.cause, "targeted_validator_rejected");
	}
	// The wrapper's fix_caused_findings answer must be an explicitly empty array.
	const malformed = reviewValidateV1(harness.context, {
		cwd: harness.repo, lineageId,
		evidence: { outcome: "passed", evidenceIdentity: "cap-1", recordDigest: "e".repeat(64) },
		validation: { ...passingValidation(requestHash), fix_caused_findings: [{ any: "row" }] } as never,
	});
	assert.equal(malformed.kind, "refused");
	if (malformed.kind === "refused") assert.match(malformed.detail ?? "", /scope/);
});

test("failed original criteria and failed regressions escalate; validation never reopens correction", (t) => {
	const failing = (t2: { after: (cb: () => void) => void }, field: "original_criteria" | "correction_regression") => {
		const { harness, lineageId, requestHash } = driveToFixValidating(t2);
		return reviewValidateV1(harness.context, {
			cwd: harness.repo, lineageId,
			evidence: { outcome: "passed", evidenceIdentity: "cap-1", recordDigest: "e".repeat(64) },
			validation: { ...passingValidation(requestHash), [field]: { passed: false, evidence: ["failure output"] } },
		});
	};
	const criteria = failing(t, "original_criteria");
	assert.equal(criteria.kind, "terminal");
	const regression = failing(t, "correction_regression");
	assert.equal(regression.kind, "terminal");
	if (regression.kind === "terminal") assert.equal(regression.escalation?.cause, "targeted_validator_rejected");
});

test("verification_failed reopens the correction charging nothing; recapture must be distinct", (t) => {
	const { harness, lineageId, requestHash } = driveToFixValidating(t);
	const recapture = reviewValidateV1(harness.context, {
		cwd: harness.repo, lineageId,
		evidence: { outcome: "verification_failed", evidenceIdentity: "cap-1", recordDigest: "e".repeat(64) },
		validation: passingValidation(requestHash),
	});
	assert.equal(recapture.kind, "recapture_required");
	if (recapture.kind !== "recapture_required") return;
	assert.equal(recapture.state, "correction_required");
	assert.equal(recapture.supersedes, "cap-1");
	// Nothing was charged: the counters and budget are unchanged.
	const reopened = JeroLineageStoreV1.forStore(harness.context.store.store_root).load(lineageId);
	if (reopened.kind !== "ok") throw new Error("load failed");
	assert.equal(reopened.record.state.state, "fixing");
	assert.equal(reopened.record.state.counters.fix_batches, 1);
	assert.equal(reopened.record.state.actual_correction_lines, 2);
	// The corrected fix is applied again (a REAL tree with a NEW delta), then a
	// NEW evidence identity validates.
	const secondFix = applyFixtureFix(harness, lineageId, fixMutation(2));
	assert.equal(secondFix.actual_correction_lines, 2);
	reviewFinalizeV1(harness.context, {
		cwd: harness.repo, lineageId,
		fix_application: secondFix,
	});
	// The new fix delta re-binds the request hash (§E binding is over the fix delta too).
	const reopenedState = JeroLineageStoreV1.forStore(harness.context.store.store_root).load(lineageId);
	if (reopenedState.kind !== "ok") throw new Error("load failed");
	const reboundHash = expectedJeroTargetedValidationRequestHashV1(reopenedState.record.state);
	assert.notEqual(reboundHash, requestHash);
	const validated = reviewValidateV1(harness.context, {
		cwd: harness.repo, lineageId,
		evidence: { outcome: "passed", evidenceIdentity: "cap-2", recordDigest: "2".repeat(64) },
		validation: passingValidation(reboundHash),
	});
	assert.equal(validated.kind, "validated");
	// Reusing the prior evidence identity after a failed capture fails closed
	// (F3): the reopen cleared the recorded evidence, so distinctness is judged
	// against the FAILED revision's identity — the same directory can never be
	// re-presented as a fresh capture.
	const { harness: h2, lineageId: l2, requestHash: r2 } = driveToFixValidating(t);
	const reused = reviewValidateV1(h2.context, {
		cwd: h2.repo, lineageId: l2,
		evidence: { outcome: "verification_failed", evidenceIdentity: "cap-x", recordDigest: "3".repeat(64) },
		validation: passingValidation(r2),
	});
	assert.equal(reused.kind, "recapture_required");
	const retryFix = applyFixtureFix(h2, l2, fixMutation(2));
	reviewFinalizeV1(h2.context, {
		cwd: h2.repo, lineageId: l2,
		fix_application: retryFix,
	});
	const sameIdentity = reviewValidateV1(h2.context, {
		cwd: h2.repo, lineageId: l2,
		evidence: { outcome: "passed", evidenceIdentity: "cap-x", recordDigest: "3".repeat(64) },
		validation: passingValidation(r2),
	});
	assert.equal(sameIdentity.kind, "refused");
	if (sameIdentity.kind === "refused") {
		assert.equal(sameIdentity.code, "evidence-replaced");
		assert.match(sameIdentity.detail ?? "", /cap-x/);
	}
	// A genuinely distinct identity proceeds on the same reopened lineage.
	const reloaded = JeroLineageStoreV1.forStore(h2.context.store.store_root).load(l2);
	if (reloaded.kind !== "ok") throw new Error("load failed");
	const retryHash = expectedJeroTargetedValidationRequestHashV1(reloaded.record.state);
	const distinct = reviewValidateV1(h2.context, {
		cwd: h2.repo, lineageId: l2,
		evidence: { outcome: "passed", evidenceIdentity: "cap-fresh", recordDigest: "4".repeat(64) },
		validation: passingValidation(retryHash),
	});
	assert.equal(distinct.kind, "validated");
});

test("procedural_tooling_failed is a terminal escalation before any retry", (t) => {
	const { harness, lineageId, requestHash } = driveToFixValidating(t);
	const escalated = reviewValidateV1(harness.context, {
		cwd: harness.repo, lineageId,
		evidence: { outcome: "procedural_tooling_failed", evidenceIdentity: "cap-1", recordDigest: "e".repeat(64) },
		validation: passingValidation(requestHash),
	});
	assert.equal(escalated.kind, "terminal");
	if (escalated.kind === "terminal") assert.equal(escalated.escalation?.cause, "targeted_validator_rejected");
	// The lineage is terminal: a retry attempt is refused.
	const retry = reviewValidateV1(harness.context, {
		cwd: harness.repo, lineageId,
		evidence: { outcome: "passed", evidenceIdentity: "cap-2", recordDigest: "2".repeat(64) },
		validation: passingValidation(requestHash),
	});
	assert.equal(retry.kind, "refused");
	if (retry.kind === "refused") assert.equal(retry.code, "terminal-immutable");
});
