import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { reviewStatusV1 } from "../../lib/authority/status.ts";
import { reviewStartV1 } from "../../lib/authority/start.ts";
import { reviewFinalizeV1 } from "../../lib/authority/finalize.ts";
import { JeroLineageStoreV1, JERO_LINEAGE_STATE_FILENAME } from "../../lib/authority/lineage-store.ts";
import { repository, reviewHarness } from "./fixtures.ts";

// Spec §C: STATUS applicability quadruple, receipt status, action and
// replayability, the frozen block, candidate listing, and corrupted records.

test("unrelated: a repository with no matching lineage reports not_applicable receipt and a start action", (t) => {
	const harness = reviewHarness(t, "medium", 0);
	// Empty the workspace change so the live candidate matches no lineage.
	writeFileSync(join(harness.repo, "src", "app.ts"), "");
	const status = reviewStatusV1(harness.context, { cwd: harness.repo });
	assert.equal(status.kind, "status");
	if (status.kind === "status") {
		assert.equal(status.applicability, "unrelated");
		assert.deepEqual(status.receipt, { status: "not_applicable" });
		assert.equal(status.action, "start");
		assert.equal(status.replayability, "not_replayable");
		assert.equal(status.authority, undefined);
		assert.equal(status.frozen, undefined);
	}
});

test("current_target: a started lineage reports authority, frozen block, expected_missing receipt", (t) => {
	const harness = reviewHarness(t, "medium", 4);
	const start = reviewStartV1(harness.context, { cwd: harness.repo }, { consent: "granted" });
	assert.equal(start.kind, "created");
	const status = reviewStatusV1(harness.context, { cwd: harness.repo });
	assert.equal(status.kind, "status");
	if (status.kind !== "status" || start.kind !== "created") return;
	assert.equal(status.applicability, "current_target");
	assert.deepEqual(status.receipt, { status: "expected_missing" });
	assert.equal(status.authority?.version, "jero-authority/v1");
	assert.equal(status.authority?.lineage_id, start.lineage_id);
	assert.equal(status.authority?.state, "reviewing");
	assert.equal(status.authority?.generation, 1);
	assert.equal(status.authority?.revision, start.revision);
	assert.equal(status.authority?.consumed, undefined);
	assert.equal(status.frozen?.tier, "medium");
	assert.equal(status.frozen?.original_changed_lines, 4);
	assert.equal(status.frozen?.correction_budget, 2);
	// With no lens results admitted yet the transition collects reviewer results.
	assert.equal(status.next_transition.kind, "collect");
	assert.equal(status.next_transition.reason_code, "reviewer_results_required");
	assert.equal(status.forecast?.horizon, "partial");
});

test("action reaches finalize once every selected lens result is admitted", (t) => {
	const harness = reviewHarness(t, "medium", 4);
	const start = reviewStartV1(harness.context, { cwd: harness.repo }, { consent: "granted" });
	if (start.kind !== "created") throw new Error("start failed");
	const frozen = reviewFinalizeV1(harness.context, {
		cwd: harness.repo,
		lineageId: start.lineage_id,
		reviewer_run_acknowledged: true,
		review_result: { lens_results: [{ lens: "review-readability", findings: [], evidence: ["complete candidate reviewed"] }] },
	});
	assert.equal(frozen.kind, "frozen");
	const status = reviewStatusV1(harness.context, { cwd: harness.repo });
	if (status.kind !== "status") throw new Error("status failed");
	assert.equal(status.authority?.state, "findings_frozen");
	assert.equal(status.action, "finalize");
	assert.equal(status.next_transition.kind, "collect");
	assert.equal(status.next_transition.reason_code, "evidence_classification_required");
});

test("ambiguous: two live lineages for one target list candidates with select_lineage", (t) => {
	const harness = reviewHarness(t, "medium", 4);
	const start = reviewStartV1(harness.context, { cwd: harness.repo }, { consent: "granted" });
	if (start.kind !== "created") throw new Error("start failed");
	const store = JeroLineageStoreV1.forStore(harness.context.store.store_root);
	const loaded = store.load(start.lineage_id);
	if (loaded.kind !== "ok") throw new Error("load failed");
	// A second lineage directory carrying the SAME frozen target identity.
	const twinId = `review-${"abcdef0123456789".slice(0, 16)}`;
	const twinState = { ...loaded.record.state, lineage_id: twinId };
	store.save(twinId, { state: twinState, request_journal: [] }, { expectedRevision: null });
	const status = reviewStatusV1(harness.context, { cwd: harness.repo });
	assert.equal(status.kind, "status");
	if (status.kind === "status") {
		assert.equal(status.applicability, "ambiguous");
		assert.equal(status.action, "select_lineage");
		assert.deepEqual(status.candidates, [twinId, start.lineage_id].toSorted());
		assert.equal(status.replayability, "manual_action_required");
	}
});

test("corrupted: an undecodable lineage record fails closed with repair_authority", (t) => {
	const harness = reviewHarness(t, "medium", 4);
	const start = reviewStartV1(harness.context, { cwd: harness.repo }, { consent: "granted" });
	if (start.kind !== "created") throw new Error("start failed");
	writeFileSync(join(harness.context.store.store_root, "lineages", start.lineage_id, JERO_LINEAGE_STATE_FILENAME), "{not json");
	const status = reviewStatusV1(harness.context, { cwd: harness.repo, lineageId: start.lineage_id });
	assert.equal(status.kind, "status");
	if (status.kind === "status") {
		assert.equal(status.applicability, "corrupted");
		assert.equal(status.action, "repair_authority");
		assert.equal(status.replayability, "manual_action_required");
		assert.match(status.corrupted_detail ?? "", /.+/);
	}
	// Mutating operations refuse to touch the corrupted record.
	const finalize = reviewFinalizeV1(harness.context, { cwd: harness.repo, lineageId: start.lineage_id, reviewer_run_acknowledged: true, review_result: { lens_results: [] } });
	assert.equal(finalize.kind, "refused");
	if (finalize.kind === "refused") assert.equal(finalize.code, "corrupted");
});

test("receipt status becomes present once FINALIZE approves the lineage", (t) => {
	const harness = reviewHarness(t, "medium", 4);
	const start = reviewStartV1(harness.context, { cwd: harness.repo }, { consent: "granted" });
	if (start.kind !== "created") throw new Error("start failed");
	reviewFinalizeV1(harness.context, {
		cwd: harness.repo, lineageId: start.lineage_id, reviewer_run_acknowledged: true,
		review_result: { lens_results: [{ lens: "review-readability", findings: [], evidence: ["clean"] }] },
	});
	reviewFinalizeV1(harness.context, { cwd: harness.repo, lineageId: start.lineage_id, classifications: [] });
	const approved = reviewFinalizeV1(harness.context, {
		cwd: harness.repo, lineageId: start.lineage_id,
		final_evidence: "final verification output", final_verification_passed: true,
	});
	assert.equal(approved.kind, "terminal");
	if (approved.kind !== "terminal") return;
	const status = reviewStatusV1(harness.context, { cwd: harness.repo });
	assert.equal(status.kind, "status");
	if (status.kind !== "status") return;
	assert.deepEqual(status.receipt, { status: "present" });
	assert.equal(status.authority?.state, "approved");
	assert.equal(status.action, "stop");
	assert.equal(status.next_transition.operation, "review.acknowledge-approved");
});

test("pairing rules fail closed exactly like START", (t) => {
	const harness = reviewHarness(t, "medium", 4);
	const refused = reviewStatusV1(harness.context, { cwd: harness.repo, baseRef: "HEAD" });
	assert.equal(refused.kind, "refused");
	const staged = reviewStatusV1(harness.context, { cwd: harness.repo, projection: "staged" as never });
	assert.equal(staged.kind, "refused");
	const malformed = reviewStatusV1(harness.context, { cwd: harness.repo, lineageId: "not-a-lineage" });
	assert.equal(malformed.kind, "refused");
	if (malformed.kind === "refused") assert.equal(malformed.code, "invalid-request");
	const missing = reviewStatusV1(harness.context, { cwd: harness.repo, lineageId: "review-1111111111111111" });
	assert.equal(missing.kind, "refused");
	if (missing.kind === "refused") assert.equal(missing.code, "lineage-missing");
});

test("F7: an explicitly named lineage whose identity drifted from the workspace is unrelated — never a mixed frozen block", (t) => {
	const harness = reviewHarness(t, "medium", 4);
	const start = reviewStartV1(harness.context, { cwd: harness.repo }, { consent: "granted" });
	if (start.kind !== "created") throw new Error("start failed");
	// Drift the workspace: the live candidate now freezes a different identity
	// than the lineage's frozen snapshot.
	writeFileSync(join(harness.repo, "src", "app.ts"), `${"export const drifted = true;\n".repeat(4)}`);
	const status = reviewStatusV1(harness.context, { cwd: harness.repo, lineageId: start.lineage_id });
	assert.equal(status.kind, "status");
	if (status.kind !== "status") return;
	// The explicit path matches by identity exactly like the listing path:
	// a drifted workspace is unrelated to the named lineage, and unrelated
	// statuses never expose authority/frozen (schema §C.1).
	assert.equal(status.applicability, "unrelated");
	assert.equal(status.authority, undefined);
	assert.equal(status.frozen, undefined);
	assert.equal(status.action, "start");
	// The undrifted explicit query still resolves as the current target.
	writeFileSync(join(harness.repo, "src", "app.ts"), `${"export const placeholder = 0;\n".repeat(4)}`);
	const current = reviewStatusV1(harness.context, { cwd: harness.repo, lineageId: start.lineage_id });
	if (current.kind !== "status") throw new Error("undrifted status failed");
	assert.equal(current.applicability, "current_target");
	assert.equal(current.authority?.lineage_id, start.lineage_id);
	assert.equal(current.authority?.state, "reviewing");
});
