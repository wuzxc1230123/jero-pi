import assert from "node:assert/strict";
import test from "node:test";
import { createJeroAuthorityReviewCli } from "../../lib/jero-authority-cli.ts";
import { reviewStartV1 } from "../../lib/authority/start.ts";
import { reviewStatusV1 } from "../../lib/authority/status.ts";
import { reviewFinalizeV1 } from "../../lib/authority/finalize.ts";
import { jeroAbandonAuthorizationV1 } from "../../lib/authority/maintenance.ts";
import { JeroLineageStoreV1 } from "../../lib/authority/lineage-store.ts";
import { startCreatedReview, admitFixtureReviewerResults, type ReviewHarnessV1 } from "./fixtures.ts";

// P4d-g: the maintenance quartet, the acknowledge burn, and the
// correction-plan capture over the in-process adapter. The contracts that
// matter: the burn vector rides the approved STATUS execute transition with
// exactly the five arguments the extension's shape validator demands; the
// correction-plan submission keeps the {{value}} substitution discipline;
// maintenance refusals surface as typed authority-unavailable errors.

type Harness = ReviewHarnessV1 & { start: Extract<ReturnType<typeof reviewStartV1>, { kind: "created" | "closed" }> };

function cliHarness(t: { after(fn: () => void): void }): { harness: Harness; cli: ReturnType<typeof createJeroAuthorityReviewCli> } {
	const harness = startCreatedReview(t, "medium", 4);
	return { harness, cli: createJeroAuthorityReviewCli() };
}

function driveToApproved(harness: Harness): void {
	const approvedResult = { lens_results: [{ lens: "review-readability" as const, findings: [], evidence: ["clean"] }] };
	admitFixtureReviewerResults(harness, harness.start.lineage_id, approvedResult);
	reviewFinalizeV1(harness.context, { cwd: harness.repo, lineageId: harness.start.lineage_id, reviewer_run_acknowledged: true, review_result: approvedResult });
	reviewFinalizeV1(harness.context, { cwd: harness.repo, lineageId: harness.start.lineage_id, classifications: [] });
	const approved = reviewFinalizeV1(harness.context, { cwd: harness.repo, lineageId: harness.start.lineage_id, final_evidence: "final verification output", final_verification_passed: true });
	if (approved.kind !== "terminal") throw new Error(JSON.stringify(approved));
}

function driveToCorrection(t: { after(fn: () => void): void }): { harness: Harness; cli: ReturnType<typeof createJeroAuthorityReviewCli> } {
	const { harness, cli } = cliHarness(t);
	const severe = { lens_results: [{ lens: "review-readability" as const, findings: [{ id: "READ-001", severity: "BLOCKER" as const, claim: "opaque claim" }], evidence: ["scope-reviewed evidence"] }] };
	admitFixtureReviewerResults(harness, harness.start.lineage_id, severe);
	const frozen = reviewFinalizeV1(harness.context, { cwd: harness.repo, lineageId: harness.start.lineage_id, reviewer_run_acknowledged: true, review_result: severe });
	if (frozen.kind !== "frozen") throw new Error(JSON.stringify(frozen));
	const resolved = reviewFinalizeV1(harness.context, { cwd: harness.repo, lineageId: harness.start.lineage_id, classifications: [{ finding_id: "READ-001", class: "deterministic", proof: "deterministic proof", causal_disposition: "introduced" }] });
	if (resolved.kind !== "evidence_resolved") throw new Error(JSON.stringify(resolved));
	return { harness, cli };
}

test("the approved STATUS carries the five-argument burn vector and the adapter burns idempotently", async (t) => {
	const { harness, cli } = cliHarness(t);
	driveToApproved(harness);
	const wireStatus = await cli.targetStatus({ cwd: harness.repo });
	const execute = wireStatus.nextTransition?.execute;
	if (execute === undefined || execute.operation !== "review.acknowledge-approved") throw new Error(`expected the burn execute, got ${JSON.stringify(wireStatus.nextTransition)}`);
	assert.equal(execute.command?.startsWith("gentle-ai review acknowledge-approved "), true);
	assert.deepEqual(execute.arguments.map(({ name }) => name), ["cwd", "lineage", "target", "expected-revision", "token"]);
	assert.equal(execute.binding.targetIdentity, wireStatus.targetIdentity);
	assert.equal(execute.binding.lineageId, harness.start.lineage_id);
	const tokens = execute.arguments.map(({ token }) => token!);
	const burned = await cli.acknowledgeApproved!({ argumentTokens: tokens, cwd: harness.repo });
	if (burned === undefined) throw new Error("the typed burn envelope is required");
	assert.equal(burned.authority, "burned");
	assert.equal(burned.consumedRevision, execute.binding.revision);
	const replay = await cli.acknowledgeApproved!({ argumentTokens: tokens, cwd: harness.repo });
	assert.equal(replay?.consumedRevision, burned.consumedRevision);
});

test("a drifted burn vector fails closed on the binding", async (t) => {
	const { harness, cli } = cliHarness(t);
	driveToApproved(harness);
	const wireStatus = await cli.targetStatus({ cwd: harness.repo });
	const tokens = wireStatus.nextTransition?.execute?.arguments.map(({ token }) => token!) ?? [];
	const drifted = tokens.map((token) => token.startsWith("--target=") ? `--target=sha256:${"f".repeat(64)}` : token);
	await assert.rejects(cli.acknowledgeApproved!({ argumentTokens: drifted, cwd: harness.repo }), /binding-mismatch/);
});

test("the correction-plan capture substitutes the {{value}} token and returns a wire closure", async (t) => {
	const { harness, cli } = driveToCorrection(t);
	const status = reviewStatusV1(harness.context, { cwd: harness.repo, lineageId: harness.start.lineage_id });
	if (status.kind !== "status") throw new Error("status failed");
	const planInput = status.next_transition?.collect?.inputs.find((input) => input.capture_operation === "review.capture-correction-plan");
	const submission = planInput?.submission;
	if (submission === undefined) throw new Error("the correction-phase STATUS must offer the plan capture input");
	const closure = await cli.captureCorrectionPlan!({ argumentTokens: submission.argument_tokens, correctionLines: 2, cwd: harness.repo });
	assert.equal(closure.operation, "review.capture-correction-plan");
	assert.equal(closure.lineageId, harness.start.lineage_id);
	assert.equal(closure.state, "correction_required");
	assert.equal(closure.correctionLines, 2);
	assert.match(closure.requestHash ?? "", /^sha256:[0-9a-f]{64}$/);
	await assert.rejects(cli.captureCorrectionPlan!({ argumentTokens: ["--lineage=x"], correctionLines: 2, cwd: harness.repo }), TypeError);
	await assert.rejects(cli.captureCorrectionPlan!({ argumentTokens: submission.argument_tokens, correctionLines: 500, cwd: harness.repo }), TypeError);
});

test("abandon consumes the lineage with the exact authorization string and refuses afterwards", async (t) => {
	const { harness, cli } = cliHarness(t);
	const loaded = JeroLineageStoreV1.forStore(harness.context.store.store_root).load(harness.start.lineage_id);
	if (loaded.kind !== "ok") throw new Error("load failed");
	const record = loaded.record;
	const base = {
		lineage: harness.start.lineage_id,
		expectedRevision: record.revision,
		snapshotIdentity: record.state.snapshot.identity,
		capturedLensResults: [] as readonly string[],
		findingsPresent: false,
		actor: "jero",
		reason: "maintenance test",
	};
	const result = await cli.abandon!({ cwd: harness.repo, ...base, maintainerAuthorization: jeroAbandonAuthorizationV1(base) });
	assert.ok(typeof result.record === "object" && result.record !== null);
	await assert.rejects(cli.abandon!({ cwd: harness.repo, ...base, maintainerAuthorization: "forged" }), /refused/);
});

test("reclaim quarantines destructively and refuses a second reclaim; recover with an unknown predecessor refuses typed", async (t) => {
	const { harness, cli } = cliHarness(t);
	const reclaimed = await cli.reclaim!({ cwd: harness.repo, lineage: harness.start.lineage_id, actor: "jero", reason: "stuck authority" });
	assert.ok(typeof reclaimed.record === "object" && reclaimed.record !== null);
	await assert.rejects(cli.reclaim!({ cwd: harness.repo, lineage: harness.start.lineage_id, actor: "jero", reason: "already reclaimed" }), /refused/);
	await assert.rejects(cli.recover!({ cwd: harness.repo, predecessorLineage: `review-${"0".repeat(16)}`, expectedPredecessorRevision: `sha256:${"0".repeat(64)}`, successorLineage: harness.start.lineage_id, disposition: "scope_changed", actor: "jero", reason: "unknown predecessor" }), /refused/);
});
