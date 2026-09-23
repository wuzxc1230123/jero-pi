import assert from "node:assert/strict";
import test from "node:test";
import { prepareReviewHostRelaySlot, submitReviewHostRelayPreparedResult, type ReviewHostRelayRequest } from "../../lib/review-host-relay.ts";
import { renderJeroCaptureSlotForRelayV1, admitJeroCaptureResultForRelayV1 } from "../../lib/authority/capture-relay.ts";
import { reviewStatusV1 } from "../../lib/authority/status.ts";
import { createJeroAuthorityReviewCli } from "../../lib/jero-authority-cli.ts";
import { startCreatedReview, type ReviewHarnessV1 } from "./fixtures.ts";
import type { ReviewStatusV3 } from "../../lib/authority/wire-contract.ts";
import { decodeReviewLastEventClosureV1 } from "../../lib/authority/wire-contract.ts";

// Q-A: the artifact-set completion composition rides the relay admit seam —
// the last admitted lens artifact atomically freezes findings and classifies
// evidence from the sworn envelope rows, exactly the boundary the old binary
// owned. Severe candidate-caused findings then leave the lineage on the
// correction-plan collect input, which the P4d-g adapter consumes; clean
// findings stop at the documented final-verification seam (Q-A2).

type Harness = ReviewHarnessV1 & { start: Extract<import("../../lib/authority/start.ts").JeroReviewStartResultV1, { kind: "created" | "closed" }> };

function envelopeFor(lens: string, findings: unknown[]): Buffer {
	return Buffer.from(JSON.stringify({ review_result: { lens_results: [{ lens, findings, evidence: findings.length === 0 ? ["scope-reviewed evidence"] : [`scope-reviewed evidence for ${lens}`] }] } }));
}

async function admitThroughRelayRaw(harness: Harness, rawResult: Buffer): Promise<{ submission: string }> {
	const wireStatus = await createJeroAuthorityReviewCli().targetStatus({ cwd: harness.repo });
	const collectInput = wireStatus.nextTransition?.kind === "collect" ? wireStatus.nextTransition.collect?.inputs[0] : undefined;
	if (collectInput?.submission === undefined) throw new Error("STATUS offers no reviewer collect input");
	const request: ReviewHostRelayRequest = {
		captureArgumentTokens: collectInput.arguments.map(({ token }) => token),
		targetCwd: harness.repo,
		submission: collectInput.submission as ReviewHostRelayRequest["submission"],
	};
	const fakeReviewer = async (promptBytes: Buffer) => ({ stdout: rawResult, promptByteLength: promptBytes.length, stdoutByteLength: rawResult.length });
	const prepared = await prepareReviewHostRelaySlot(request, fakeReviewer, renderJeroCaptureSlotForRelayV1);
	const result = await submitReviewHostRelayPreparedResult(prepared, admitJeroCaptureResultForRelayV1);
	return { submission: result.submission };
}

async function admitThroughRelay(harness: Harness, rawResult: Buffer): Promise<{ manifest: Record<string, unknown>; wireStatus: ReviewStatusV3 }> {
	const cli = createJeroAuthorityReviewCli();
	const wireStatus = await cli.targetStatus({ cwd: harness.repo });
	const collectInput = wireStatus.nextTransition?.kind === "collect" ? wireStatus.nextTransition.collect?.inputs[0] : undefined;
	if (collectInput === undefined || collectInput.submission === undefined) throw new Error("STATUS offers no reviewer collect input");
	const request: ReviewHostRelayRequest = {
		captureArgumentTokens: collectInput.arguments.map(({ token }) => token),
		targetCwd: harness.repo,
		submission: collectInput.submission as ReviewHostRelayRequest["submission"],
	};
	const fakeReviewer = async (promptBytes: Buffer) => ({ stdout: rawResult, promptByteLength: promptBytes.length, stdoutByteLength: rawResult.length });
	const prepared = await prepareReviewHostRelaySlot(request, fakeReviewer, renderJeroCaptureSlotForRelayV1);
	const result = await submitReviewHostRelayPreparedResult(prepared, admitJeroCaptureResultForRelayV1);
	return { manifest: JSON.parse(result.submission) as Record<string, unknown>, wireStatus };
}

test("admitting the last artifact freezes and classifies atomically; severe findings reach the correction plan", async (t) => {
	const harness = startCreatedReview(t, "medium", 4);
	const severe = envelopeFor("review-readability", [{ id: "READ-001", lens: "review-readability", location: "src/app.ts:1", severity: "BLOCKER", claim: "opaque claim", evidence_class: "deterministic", causal_disposition: "introduced", proof_refs: ["changed-hunk:src/app.ts:1"] }]);
	const { manifest } = await admitThroughRelay(harness, severe);
	assert.equal(manifest.lens, "review-readability");
	const composition = manifest.finalize_composition as Record<string, unknown>;
	assert.equal(composition.kind, "composed");
	assert.deepEqual(composition.fix_finding_ids, ["READ-001"]);
	const after = reviewStatusV1(harness.context, { cwd: harness.repo, lineageId: harness.start.lineage_id });
	if (after.kind !== "status") throw new Error("status failed");
	assert.equal(after.next_transition?.reason_code, "correction_plan_required");
	// Close the loop: the offered plan capture feeds the P4d-g adapter.
	const planInput = after.next_transition?.collect?.inputs.find((input) => input.capture_operation === "review.capture-correction-plan");
	if (planInput?.submission === undefined) throw new Error("no correction-plan input offered");
	const closure = await createJeroAuthorityReviewCli().captureCorrectionPlan!({ argumentTokens: planInput.submission.argument_tokens, correctionLines: 2, cwd: harness.repo });
	assert.equal(closure.state, "correction_required");
});

test("clean findings close to an approved last-event closure riding the submission", async (t) => {
	const harness = startCreatedReview(t, "medium", 4);
	const clean = envelopeFor("review-readability", []);
	const { submission } = await admitThroughRelayRaw(harness, clean);
	const body = JSON.parse(submission) as Record<string, unknown>;
	assert.equal(body.schema, "gentle-ai.review-last-event-closure/v1");
	assert.equal(body.operation, "review/capture-result");
	assert.equal(body.state, "approved");
	assert.match(String(body.action ?? ""), /burned; delivery follows ordinary repository policy/);
	// The extension decodes exactly this body (decodeRelayLastEventClosure).
	const decoded = decodeReviewLastEventClosureV1(body);
	assert.equal(decoded.lineageId, harness.start.lineage_id);
	assert.equal(decoded.state, "approved");
	const after = reviewStatusV1(harness.context, { cwd: harness.repo, lineageId: harness.start.lineage_id });
	if (after.kind !== "status") throw new Error("status failed");
	assert.equal(after.next_transition?.reason_code, "approved_awaiting_acknowledgement");
});
