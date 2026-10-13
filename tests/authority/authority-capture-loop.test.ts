import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { resolveJeroAuthorityContextV1 } from "../../lib/authority/review.ts";
import { reviewStartV1 } from "../../lib/authority/start.ts";
import { reviewStatusV1 } from "../../lib/authority/status.ts";
import { reviewFinalizeV1 } from "../../lib/authority/finalize.ts";
import { reviewValidateV1 } from "../../lib/authority/validate.ts";
import { reviewAcknowledgeV1 } from "../../lib/authority/acknowledge.ts";
import { renderJeroCaptureBindingV1, nextJeroCaptureSlotsV1 } from "../../lib/authority/capture.ts";
import { admitJeroReviewerResultV1, listJeroResultArtifactsV1 } from "../../lib/authority/result-artifacts.ts";
import { buildJeroLastEventClosureV1 } from "../../lib/authority/closures.ts";
import { jeroReviewerResultsDirectoryV1 } from "../../lib/authority/result-artifacts.ts";
import { JeroLineageStoreV1 } from "../../lib/authority/lineage-store.ts";
import { admitFixtureReviewerResults, reviewHarness, applyFixtureFix, repository, git } from "./fixtures.ts";

// Spec §J.3: the ordinary full loop with IN-PROCESS render + admit — the
// reviewer is simulated by constructing the expected output contract from
// the rendered slot (no real pi spawn) and feeding it through the admission
// path. Asserts reviewer-results files, CAS objects, and collect inputs at
// every STATUS, plus the §G lineage-bound projection and staged projection.

function reviewerEnvelopeFor(lens: string, findings: unknown[] = []): Buffer {
	// The output contract the rendered prompt demands (§A.1 #3): one lens
	// result, findings rows with the full evidence vocabulary, non-empty
	// evidence. Clean => empty findings + non-empty evidence.
	return Buffer.from(JSON.stringify({
		review_result: { lens_results: [{ lens, findings, evidence: [`scope-reviewed evidence for ${lens}`] }] },
	}));
}

test("J.3 ordinary full loop: START → render → admit → FINALIZE → correction → validation → closure → acknowledge", (t) => {
	const harness = reviewHarness(t, "medium", 4);
	const context = harness.context;

	// --- START: collect inputs for the missing lens, repository_context on the status. ---
	const start = reviewStartV1(context, { cwd: harness.repo }, { consent: "granted" });
	assert.equal(start.kind, "created");
	if (start.kind !== "created") return;
	assert.ok(start.repository_context?.event_id && start.repository_context.outcome === "applied");

	const statusReviewing = reviewStatusV1(context, { cwd: harness.repo });
	assert.equal(statusReviewing.kind, "status");
	if (statusReviewing.kind !== "status") return;
	assert.equal(statusReviewing.applicability, "current_target");
	assert.ok(statusReviewing.repository_context?.handle);
	const collect = statusReviewing.next_transition.collect!;
	assert.ok(collect !== undefined, "reviewing STATUS offers the reviewer collect input");
	const collectInput = collect.inputs[0]!;
	assert.equal(collectInput.capture_operation, "review.capture-result");

	// --- render (in-process, no spawn) ---
	const slots = nextJeroCaptureSlotsV1(context, start.lineage_id);
	assert.equal(slots.kind, "ok");
	if (slots.kind !== "ok") return;
	assert.equal(slots.slots.length, 1);
	const rendered = renderJeroCaptureBindingV1(slots.slots[0]!);
	assert.equal(rendered.kind, "rendered");
	if (rendered.kind !== "rendered") return;
	// The rendered slot's submission is exactly the STATUS collect input's.
	assert.deepEqual(rendered.submission, collectInput.submission);

	// --- simulate the reviewer per the expected output contract, then admit ---
	const rawResult = reviewerEnvelopeFor("review-readability", [{
		id: "READ-001", lens: "review-readability", location: "src/app.ts:1", severity: "BLOCKER",
		claim: "opaque claim", evidence_class: "deterministic", causal_disposition: "introduced",
		proof_refs: ["changed-hunk:src/app.ts:1"],
	}]);
	const subjectHash = collectInput.artifact_subject!.subject_hash;
	const admission = admitJeroReviewerResultV1(context, {
		lineageId: start.lineage_id, lens: "review-readability", selectedOrder: 0,
		subjectHash, rawResultBytes: rawResult, locator: "path",
	});
	assert.equal(admission.kind, "admitted");
	if (admission.kind !== "admitted") return;
	// The reviewer-results file and the discovery manifest exist on disk.
	const resultsDirectory = jeroReviewerResultsDirectoryV1(context.store.store_root, start.lineage_id);
	assert.deepEqual(readFileSync(join(resultsDirectory, "00-review-readability.json")), rawResult);
	assert.equal(listJeroResultArtifactsV1(context, start.lineage_id).length, 1);

	// --- STATUS now offers the finalize execute with the admitted artifact ---
	const statusReady = reviewStatusV1(context, { cwd: harness.repo });
	assert.equal(statusReady.kind, "status");
	if (statusReady.kind !== "status") return;
	assert.equal(statusReady.next_transition.kind, "execute");
	const execute = statusReady.next_transition.execute!;
	assert.ok(execute !== undefined);
	assert.equal(execute.operation, "review.finalize");
	assert.deepEqual(execute.preconditions, [{ name: "state", value: "reviewing" }, { name: "captured_artifacts", value: "complete" }]);
	assert.equal(execute.artifacts!.length, 1);
	assert.equal(execute.artifacts![0]!.subject_hash, subjectHash);
	assert.match(execute.binding.repository_context ?? "", /^rctx1_[0-9a-f]{64}$/);

	// --- FINALIZE freeze-ledger over the admitted result ---
	const frozen = reviewFinalizeV1(context, {
		cwd: harness.repo, lineageId: start.lineage_id, reviewer_run_acknowledged: true,
		review_result: { lens_results: [{ lens: "review-readability", findings: [{ id: "READ-001", severity: "BLOCKER", claim: "opaque claim" }], evidence: ["scope-reviewed evidence for review-readability"] }] },
	});
	assert.equal(frozen.kind, "frozen");

	// --- classification → severe candidate-caused → correction ---
	const resolved = reviewFinalizeV1(context, {
		cwd: harness.repo, lineageId: start.lineage_id,
		classifications: [{ finding_id: "READ-001", class: "deterministic", proof: "deterministic proof", causal_disposition: "introduced" }],
	});
	assert.equal(resolved.kind, "evidence_resolved");

	// --- STATUS in the correction phase: lineage-bound, collect input for the plan ---
	const statusFixRequired = reviewStatusV1(context, { cwd: harness.repo, lineageId: start.lineage_id });
	assert.equal(statusFixRequired.kind, "status");
	if (statusFixRequired.kind !== "status") return;
	assert.equal(statusFixRequired.applicability, "current_target", "the named correction-phase lineage never re-derives identity from the workspace");
	assert.equal(statusFixRequired.target_identity, start.target_identity);
	assert.ok(statusFixRequired.frozen?.changed_path_manifest_sha256, "the frozen block comes from the record");
	const planCollect = statusFixRequired.next_transition.collect!;
	assert.equal(statusFixRequired.next_transition.reason_code, "correction_plan_required");
	assert.ok(planCollect?.inputs[0]!.submission?.value.minimum === 1);

	// --- render the correction-plan slot; the forecast admits in-process ---
	const planSlot = renderJeroCaptureBindingV1({ kind: "correction-plan-request", context, lineageId: start.lineage_id });
	assert.equal(planSlot.kind, "rendered");
	const authorized = reviewFinalizeV1(context, { cwd: harness.repo, lineageId: start.lineage_id, correction_line_forecast: 2 });
	assert.equal(authorized.kind, "fix_authorized");

	// --- apply a real bounded edit ---
	const fix = applyFixtureFix(harness, start.lineage_id, (repo) => {
		const path = join(repo, "src", "app.ts");
		writeFileSync(path, readFileSync(path, "utf8").replace("export const placeholder = 0;", "export const placeholder = 42;"));
	});
	const applied = reviewFinalizeV1(context, { cwd: harness.repo, lineageId: start.lineage_id, fix_application: fix });
	assert.equal(applied.kind, "fix_applied");

	// --- §G drift: corrupt the workspace; the lineage-bound STATUS stays current ---
	writeFileSync(join(harness.repo, "DRIFT.md"), "mid-correction drift\n");
	const statusValidating = reviewStatusV1(context, { cwd: harness.repo, lineageId: start.lineage_id });
	assert.equal(statusValidating.kind, "status");
	if (statusValidating.kind !== "status") return;
	assert.equal(statusValidating.applicability, "current_target");
	assert.equal(statusValidating.target_identity, start.target_identity, "frozen identity, not a live re-freeze");
	assert.ok(statusValidating.repository_context);
	// The validator vector rides the transition (§A.4).
	assert.ok(statusValidating.next_transition.collect?.inputs[0]!.validation_request !== undefined);

	// --- render the validator vector; answer per the contract; VALIDATE ---
	const validatorRendered = renderJeroCaptureBindingV1({ kind: "validator-vector", context, lineageId: start.lineage_id });
	assert.equal(validatorRendered.kind, "rendered");
	if (validatorRendered.kind !== "rendered") return;
	const request = validatorRendered.requestDocuments.targetedValidation!;
	const validated = reviewValidateV1(context, {
		cwd: harness.repo,
		lineageId: start.lineage_id,
		evidence: { outcome: "passed", evidenceIdentity: "capture-loop-evidence-1", recordDigest: "capture-loop-digest-1" },
		validation: {
			request_hash: request.request_hash.slice("sha256:".length),
			correction_ids: [...request.fix_finding_ids],
			original_criteria: { passed: true, evidence: ["original criteria verified"] },
			correction_regression: { passed: true, evidence: ["READ-001 resolved by the correction"] },
			fix_caused_findings: [],
			follow_ups: [],
		},
	});
	assert.equal(validated.kind, "validated");

	// --- final verification → approved; the capture-validation closure ---
	const approved = reviewFinalizeV1(context, { cwd: harness.repo, lineageId: start.lineage_id, final_evidence: "final verification output", final_verification_passed: true });
	assert.equal(approved.kind, "terminal");
	if (approved.kind !== "terminal") return;
	assert.equal(approved.state, "approved");
	const loaded = JeroLineageStoreV1.forStore(context.store.store_root).load(start.lineage_id);
	if (loaded.kind !== "ok") throw new Error("load failed");
	const closure = buildJeroLastEventClosureV1({ operation: "review.capture-validation", record: loaded.record, state: "approved", cwd: harness.repo });
	assert.equal(closure.state, "approved");
	assert.match(closure.action ?? "", /burned; delivery follows ordinary repository policy/);

	// --- acknowledge on the held binding (the drifted workspace no longer
	// identity-matches the approved lineage — M2 semantics: the burn binding
	// comes from the caller's held authority facts, not a live re-freeze). ---
	const approvedRecord = JeroLineageStoreV1.forStore(context.store.store_root).load(start.lineage_id);
	if (approvedRecord.kind !== "ok") throw new Error("load failed");
	const acknowledged = reviewAcknowledgeV1(context, {
		cwd: harness.repo, lineageId: start.lineage_id,
		targetIdentity: approvedRecord.record.state.snapshot.identity,
		expectedRevision: approvedRecord.record.revision,
		token: "capture-loop-burn",
	});
	assert.equal(acknowledged.kind, "acknowledged");
	// The consumed lineage is excluded from live matching: a fresh START is
	// offered (acknowledge.ts — the burn is what offers it).
	const statusConsumed = reviewStatusV1(context, { cwd: harness.repo });
	assert.equal(statusConsumed.kind, "status");
	if (statusConsumed.kind !== "status") return;
	assert.equal(statusConsumed.applicability, "unrelated");
	assert.equal(statusConsumed.action, "start");
	assert.equal(statusConsumed.next_transition.reason_code, "empty_candidate_start_required");
});

test("§G staged projection freezes the INDEX, not the worktree, and never touches the real index", (t) => {
	const repo = repository(t, "jero-staged-projection-");
	writeFileSync(join(repo, "staged-only.txt"), "staged content\n");
	writeFileSync(join(repo, "unstaged-only.txt"), "unstaged content\n");
	git(repo, "add", "staged-only.txt");
	const indexBefore = readFileSync(join(git(repo, "rev-parse", "--absolute-git-dir"), "index"));
	const resolution = resolveJeroAuthorityContextV1(repo);
	assert.equal(resolution.kind, "ok");
	if (resolution.kind !== "ok") return;
	const context = resolution.context;
	const started = reviewStartV1(context, { cwd: repo, projection: "staged" }, { consent: "granted" });
	assert.equal(started.kind, "created");
	if (started.kind !== "created") return;
	// The staged candidate covers ONLY the staged file; the unstaged file is
	// not part of the frozen scope.
	const loaded = JeroLineageStoreV1.forStore(context.store.store_root).load(started.lineage_id);
	if (loaded.kind !== "ok") throw new Error("load failed");
	assert.deepEqual(loaded.record.state.snapshot.paths, ["staged-only.txt"]);
	// The real index is byte-identical after the freeze.
	const indexAfter = readFileSync(join(git(repo, "rev-parse", "--absolute-git-dir"), "index"));
	assert.deepEqual(indexAfter, indexBefore);
	// A workspace projection over the same repo freezes a DIFFERENT identity.
	const workspaceResolution = reviewStatusV1(context, { cwd: repo });
	assert.equal(workspaceResolution.kind, "status");
	if (workspaceResolution.kind !== "status") return;
	assert.equal(workspaceResolution.applicability, "unrelated", "the workspace candidate (unstaged file included) is not the staged lineage");
});

test("§G auto-match: a drifted workspace still resolves the single correction-phase lineage as current", (t) => {
	const harness = reviewHarness(t, "medium", 4);
	const start = reviewStartV1(harness.context, { cwd: harness.repo }, { consent: "granted" });
	if (start.kind !== "created") throw new Error("start failed");
	const autoMatchResult = { lens_results: [{ lens: "review-readability" as const, findings: [{ id: "F-1", severity: "BLOCKER" as const, claim: "c" }], evidence: ["e"] }] };
	admitFixtureReviewerResults(harness, start.lineage_id, autoMatchResult);
	reviewFinalizeV1(harness.context, {
		cwd: harness.repo, lineageId: start.lineage_id, reviewer_run_acknowledged: true,
		review_result: autoMatchResult,
	});
	reviewFinalizeV1(harness.context, {
		cwd: harness.repo, lineageId: start.lineage_id,
		classifications: [{ finding_id: "F-1", class: "deterministic", proof: "p", causal_disposition: "introduced" }],
	});
	reviewFinalizeV1(harness.context, { cwd: harness.repo, lineageId: start.lineage_id, correction_line_forecast: 2 });
	// Drift the workspace beyond recognition: the listing pass must still
	// resolve the one live correction-phase lineage as the current target.
	writeFileSync(join(harness.repo, "src", "app.ts"), "totally different content\nexport const x = 1;\n");
	const status = reviewStatusV1(harness.context, { cwd: harness.repo });
	assert.equal(status.kind, "status");
	if (status.kind !== "status") return;
	assert.equal(status.applicability, "current_target");
	assert.equal(status.authority?.lineage_id, start.lineage_id);
	assert.equal(status.target_identity, start.target_identity);
	assert.equal(status.frozen?.changed_path_manifest_sha256 !== undefined, true, "record-sourced manifest digest, not a live derivation");
	assert.ok(existsSync(join(harness.repo, "src", "app.ts")));
});
