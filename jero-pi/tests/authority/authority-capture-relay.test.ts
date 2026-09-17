import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { prepareReviewHostRelaySlot, submitReviewHostRelayPreparedResult, type ReviewHostRelayRequest } from "../../lib/review-host-relay.ts";
import { renderJeroCaptureSlotForRelayV1, admitJeroCaptureResultForRelayV1 } from "../../lib/authority/capture-relay.ts";
import { reviewStartV1 } from "../../lib/authority/start.ts";
import { reviewStatusV1 } from "../../lib/authority/status.ts";
import { listJeroResultArtifactsV1, jeroReviewerResultsDirectoryV1 } from "../../lib/authority/result-artifacts.ts";
import { reviewHarness } from "./fixtures.ts";

// P4b end-to-end composition: the production relay path with the REAL
// authority seams — renderJeroCaptureSlotForRelayV1 (in-process prompt bytes
// from the lineage record) and admitJeroCaptureResultForRelayV1 (in-process
// admission over the staged 0o600 result file) — with only the locked pi
// child faked per the expected output contract. This is the wiring
// extensions/gentle-ai.ts now runs by default (runJeroAuthorityRelaySlot).

function reviewerEnvelope(lens: string): Buffer {
	return Buffer.from(JSON.stringify({
		review_result: { lens_results: [{ lens, findings: [], evidence: [`scope-reviewed evidence for ${lens}`] }] },
	}));
}

function relayRequestFromCollectInput(collectInput: {
	arguments: readonly { token: string }[];
	submission?: { operation_token: string; argument_tokens: readonly string[]; value: { slot: string; domain: string; substitution_location: number; schema?: string } };
}, cwd: string): ReviewHostRelayRequest {
	const submission = collectInput.submission;
	if (submission === undefined) throw new Error("collect input carries no submission descriptor");
	return {
		captureArgumentTokens: collectInput.arguments.map(({ token }) => token),
		targetCwd: cwd,
		submission: {
			operationToken: submission.operation_token,
			argumentTokens: submission.argument_tokens,
			values: [{ slot: submission.value.slot, domain: submission.value.domain, substitutionLocation: submission.value.substitution_location }],
		},
	};
}

test("P4b: the relay composes renderBinding + in-process admission end to end", async (t) => {
	const harness = reviewHarness(t, "medium", 4);
	const context = harness.context;
	const start = reviewStartV1(context, { cwd: harness.repo }, { consent: "granted" });
	assert.equal(start.kind, "created");
	if (start.kind !== "created") return;

	const status = reviewStatusV1(context, { cwd: harness.repo });
	assert.equal(status.kind, "status");
	if (status.kind !== "status") return;
	const collectInput = status.next_transition.collect?.inputs[0];
	assert.ok(collectInput !== undefined, "reviewing STATUS offers the reviewer collect input");
	assert.equal(collectInput.capture_operation, "review.capture-result");

	const request = relayRequestFromCollectInput(collectInput, harness.repo);
	const rawResult = reviewerEnvelope("review-readability");

	const fakeReviewer = async (promptBytes: Buffer) => {
		// The prompt is the authority-rendered binding — real bytes, no spawn.
		assert.ok(promptBytes.length > 0);
		assert.match(promptBytes.toString("utf8"), /review-readability/);
		return { stdout: rawResult, promptByteLength: promptBytes.length, stdoutByteLength: rawResult.length };
	};

	const prepared = await prepareReviewHostRelaySlot(request, fakeReviewer, renderJeroCaptureSlotForRelayV1);
	assert.equal(prepared.promptByteLength, (await renderJeroCaptureSlotForRelayV1(request)).promptBytes.length);

	const result = await submitReviewHostRelayPreparedResult(prepared, admitJeroCaptureResultForRelayV1);
	assert.equal(result.promptByteLength, prepared.promptByteLength);
	assert.equal(result.resultByteLength, rawResult.length);
	// The submission string is the admitted artifact's canonical JSON.
	// Q-A2: a clean single-lens artifact set closes the review inside the
	// admission (the old binary's atomic capture-result boundary), so the
	// submission is now the approved last-event closure; the artifact trail
	// below still proves the admission itself.
	const admitted = JSON.parse(result.submission) as { schema?: string; state?: string; operation?: string };
	assert.equal(admitted.schema, "gentle-ai.review-last-event-closure/v1");
	assert.equal(admitted.state, "approved");
	assert.equal(admitted.operation, "review/capture-result");
	// The artifact trail exists on disk: the verbatim reviewer bytes plus the
	// discovery manifest entry.
	assert.deepEqual(readFileSync(join(jeroReviewerResultsDirectoryV1(context.store.store_root, start.lineage_id), "00-review-readability.json")), rawResult);
	assert.equal(listJeroResultArtifactsV1(context, start.lineage_id).length, 1);
});

test("P4b: a stale binding revision refuses [invalid_request] before any reviewer runs", async (t) => {
	const harness = reviewHarness(t, "medium", 4);
	const context = harness.context;
	const start = reviewStartV1(context, { cwd: harness.repo }, { consent: "granted" });
	if (start.kind !== "created") return;
	const status = reviewStatusV1(context, { cwd: harness.repo });
	if (status.kind !== "status") return;
	const collectInput = status.next_transition.collect?.inputs[0];
	if (collectInput === undefined) throw new Error("no collect input");
	const request = relayRequestFromCollectInput(collectInput, harness.repo);
	const stale = {
		...request,
		captureArgumentTokens: request.captureArgumentTokens.map((token) => token.startsWith("--expected-revision=") ? `--expected-revision=sha256:${"f".repeat(64)}` : token),
	};
	let reviewerRan = false;
	await assert.rejects(
		prepareReviewHostRelaySlot(stale, async (promptBytes: Buffer) => { reviewerRan = true; return { stdout: Buffer.from(""), promptByteLength: promptBytes.length, stdoutByteLength: 0 }; }, renderJeroCaptureSlotForRelayV1),
		/invalid_request.*drifted/,
	);
	assert.equal(reviewerRan, false, "a drifted binding never reaches a reviewer process");
});
