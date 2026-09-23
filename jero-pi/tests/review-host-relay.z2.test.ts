// review-host-relay 测试第 2 段（共 2 段；夹具在 review-host-relay-shared.ts）。
// 机械平移自原 review-host-relay.test.ts，语义零改动。

import { default as assert } from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { default as test } from "node:test";
import { createNodeExecFileAdapter } from "../lib/authority/client-contract.ts";
import {
	classifyReviewHostRelayRefusal, prepareReviewHostRelaySlot, resolveReviewHostRelayPiTimeoutMs,
	resolveReviewHostRelaySubmission, REVIEW_HOST_RELAY_FAILURE, REVIEW_HOST_RELAY_PI_ARGV,
	REVIEW_HOST_RELAY_PI_TIMEOUT_ENV, REVIEW_HOST_RELAY_PI_TIMEOUT_FLOOR_MS,
	REVIEW_HOST_RELAY_PI_TIMEOUT_MAX_MS, REVIEW_HOST_RELAY_PI_TIMEOUT_PER_MEBIBYTE_MS,
	REVIEW_HOST_RELAY_SUBMISSION_MISSING_MESSAGE, REVIEW_HOST_RELAY_UNAVAILABLE_MESSAGE,
	ReviewHostRelayError, type ReviewHostRelayPreparedResult, type ReviewHostRelayRequest,
	reviewHostRelaySlots, reviewHostRelayUnachievableDetail, reviewHostRelayUnachievableReason,
	runReviewHostRelayReviewerGroup, runReviewHostRelaySlot, submitReviewHostRelayPreparedResult
} from "../lib/review-host-relay.ts";
import { decodeReviewNextTransitionV3, type ReviewCaptureSubmissionV1, type ReviewCollectInputV3 } from "../lib/authority/wire-contract.ts";
import {
	BINDING_TOKENS, CAPTURE_TOKENS, FAKE_GENTLE_AI, FAKE_PI, harness, PI_OUTPUT_BYTES, PROMPT_BYTES,
	readLog, rejectsWithRelayError, type RelayHarness, relayRequest, REVIEWER_GROUP_LENSES,
	reviewerGroupRequests, SUBMISSION, waitFor
} from "./review-host-relay-shared.ts";

test("a crashed reviewer stays distinguishable from a killed one and still carries its measurements", async (t) => {
	const fixture = harness(t, { RELAY_FAKE_PI_MODE: "fail" });
	const error = await rejectsWithRelayError(runReviewHostRelaySlot(relayRequest(fixture, { piTimeoutMs: 30_000 })), REVIEW_HOST_RELAY_FAILURE.PI_FAILED, "pi");
	assert.equal(error.timedOut, false);
	assert.equal(error.exitCode, 4);
	assert.equal(error.timeoutMs, 30_000);
	assert.ok(error.elapsedMs !== null && error.elapsedMs >= 0);
});

test("submission refusal is a typed error whose outcome is unknown pending STATUS", async (t) => {
	const fixture = harness(t, { RELAY_FAKE_SUBMIT_MODE: "refuse" });
	const error = await rejectsWithRelayError(runReviewHostRelaySlot(relayRequest(fixture)), REVIEW_HOST_RELAY_FAILURE.SUBMISSION_REFUSED, "submit");
	assert.equal(error.mutationOutcome, "unknown");
	assert.match(error.stderr, /capture binding does not match/);
	assert.equal(readLog(fixture.logPath).length, 2);
});

// gentle-pi#522 / #524: Go refuses a reviewer submission at admission with a
// typed [invalid_request] refusal and states that the lens slot was not
// consumed. That is a proven non-mutation, not an unknown outcome, and the
// refusal text is the only thing that tells the host what to change.
export function admittingRequest(fixture: RelayHarness, reviewerOutput: Buffer) {
	return relayRequest(fixture, {
		environment: {
			...fixture.environment,
			RELAY_FAKE_PROMPT_B64: PROMPT_BYTES.toString("base64"),
			RELAY_FAKE_PI_OUTPUT_B64: reviewerOutput.toString("base64"),
		},
	});
}

test("a reviewer printing garbage is refused at admission as a proven non-mutation carrying Go's refusal", async (t) => {
	const fixture = harness(t, { RELAY_FAKE_SUBMIT_MODE: "admit", RELAY_FAKE_EXPECTED_SUBJECT: `sha256:${"a".repeat(64)}` });
	const error = await rejectsWithRelayError(
		runReviewHostRelaySlot(admittingRequest(fixture, Buffer.from("not json at all", "utf8"))),
		REVIEW_HOST_RELAY_FAILURE.SUBMISSION_REFUSED,
		"submit",
	);
	assert.equal(error.mutationOutcome, "none");
	assert.equal(error.exitCode, 1);
	assert.equal(error.timedOut, false);
	assert.match(error.stderr, /reviewer payload contains no complete JSON object/);
	assert.match(error.stderr, /\[invalid_request\]/);
	assert.match(error.message, /reviewer payload contains no complete JSON object/);
	assert.equal(readLog(fixture.logPath).length, 2, "the refusal must not be retried by the relay");
});

test("a reviewer echoing a different subject is refused at admission as a proven non-mutation carrying Go's continuation", async (t) => {
	const fixture = harness(t, { RELAY_FAKE_SUBMIT_MODE: "admit", RELAY_FAKE_EXPECTED_SUBJECT: `sha256:${"a".repeat(64)}` });
	const wrongSubject = Buffer.from(JSON.stringify({ subject_hash: `sha256:${"0".repeat(64)}`, inspection: { status: "completed", paths: [] }, findings: [], evidence: ["x"] }), "utf8");
	const error = await rejectsWithRelayError(
		runReviewHostRelaySlot(admittingRequest(fixture, wrongSubject)),
		REVIEW_HOST_RELAY_FAILURE.SUBMISSION_REFUSED,
		"submit",
	);
	assert.equal(error.mutationOutcome, "none");
	assert.equal(error.exitCode, 1);
	assert.match(error.stderr, /binding_mismatch/);
	assert.match(error.stderr, /did not consume the lens slot/);
	assert.match(error.stderr, /\[invalid_request\]/);
	assert.match(error.message, /did not consume the lens slot/);
	assert.equal(readLog(fixture.logPath).length, 2, "the refusal must not be retried by the relay");
});

test("a submission the fake admits with the expected subject still completes", async (t) => {
	const fixture = harness(t, { RELAY_FAKE_SUBMIT_MODE: "admit", RELAY_FAKE_EXPECTED_SUBJECT: `sha256:${"a".repeat(64)}` });
	const result = await runReviewHostRelaySlot(admittingRequest(fixture, Buffer.from(JSON.stringify({ subject_hash: `sha256:${"a".repeat(64)}`, inspection: { status: "completed", paths: [] }, findings: [], evidence: ["x"] }), "utf8")));
	assert.equal(JSON.parse(result.submission).admission_decision, "completed");
});

test("submission refusal preserves its primary evidence when result staging cleanup also fails", async (t) => {
	const fixture = harness(t, { RELAY_FAKE_SUBMIT_MODE: "refuse-cleanup-fail" });
	const scratchParent = realpathSync(mkdtempSync(join(tmpdir(), "gentle-pi-relay-primary-failure-")));
	const originalTmpdir = process.env.TMPDIR;
	process.env.TMPDIR = scratchParent;
	try {
		const error = await rejectsWithRelayError(
			runReviewHostRelaySlot(relayRequest(fixture)),
			REVIEW_HOST_RELAY_FAILURE.SUBMISSION_REFUSED,
			"submit",
		);
		assert.equal(error.exitCode, 1);
		assert.equal(error.timedOut, false);
		assert.equal(error.timeoutMs, 30_000);
		assert.ok(error.elapsedMs !== null && error.elapsedMs >= 0);
		assert.match(error.stderr, /capture binding does not match/);
		assert.doesNotMatch(error.message, /staging cleanup/i);
	} finally {
		if (originalTmpdir === undefined) delete process.env.TMPDIR;
		else process.env.TMPDIR = originalTmpdir;
		chmodSync(scratchParent, 0o700);
		rmSync(scratchParent, { recursive: true, force: true });
	}
});

test("relay scratch and staging directories are removed after failures too", async (t) => {
	const fixture = harness(t, { RELAY_FAKE_PI_MODE: "fail" });
	await rejectsWithRelayError(runReviewHostRelaySlot(relayRequest(fixture)), REVIEW_HOST_RELAY_FAILURE.PI_FAILED, "pi");
	const piCalls = readLog(fixture.piLogPath);
	assert.equal(piCalls.length, 1);
	assert.equal(existsSync(piCalls[0]!.cwd!), false);
});

test("a result staging cleanup failure remains a typed submit failure", async (t) => {
	const fixture = harness(t, { RELAY_FAKE_SUBMIT_MODE: "cleanup-fail" });
	const scratchParent = realpathSync(mkdtempSync(join(tmpdir(), "gentle-pi-relay-cleanup-")));
	// Windows 的 os.tmpdir() 读取 TEMP/TMP 而非 TMPDIR；三个都设才能让
	// 生产侧的暂存父目录跨平台落进本夹具目录。
	const originals = { TMPDIR: process.env.TMPDIR, TEMP: process.env.TEMP, TMP: process.env.TMP };
	process.env.TMPDIR = scratchParent;
	if (process.platform === "win32") { process.env.TEMP = scratchParent; process.env.TMP = scratchParent; }
	try {
		const error = await rejectsWithRelayError(
			runReviewHostRelaySlot(relayRequest(fixture)),
			REVIEW_HOST_RELAY_FAILURE.SUBMISSION_REFUSED,
			"submit",
		);
		assert.equal(error.mutationOutcome, "unknown");
		assert.match(error.message, /staging cleanup/i);
	} finally {
		for (const [name, value] of Object.entries(originals)) {
			if (value === undefined) delete process.env[name];
			else process.env[name] = value;
		}
		chmodSync(scratchParent, 0o700);
		// win32 锁持进程监视 kill 旗标并退出；轮询直到暂存父目录可清理。
		try {
			writeFileSync(join(scratchParent, "kill-holders"), "stop");
		} catch { /* 目录已不可写或已消失时直接尝试清理。 */ }
		for (let attempt = 0; attempt < 30; attempt++) {
			try {
				rmSync(scratchParent, { recursive: true, force: true });
				break;
			} catch {
				await new Promise((resolve) => setTimeout(resolve, 100));
			}
		}
	}
});

// ---------------------------------------------------------------------------
// Capability detection — typed refusal classes, no version sniffing.
// ---------------------------------------------------------------------------

test("an old binary's unknown-flag refusal classifies as relay-unavailable with the exact report", async (t) => {
	const fixture = harness(t, { RELAY_FAKE_MATERIALIZE_MODE: "unknown-flag" });
	const error = await rejectsWithRelayError(runReviewHostRelaySlot(relayRequest(fixture)), REVIEW_HOST_RELAY_FAILURE.RELAY_UNAVAILABLE, "materialize");
	assert.equal(error.message, REVIEW_HOST_RELAY_UNAVAILABLE_MESSAGE);
	assert.match(error.stderr, /flag provided but not defined: -materialize/);
	assert.equal(readLog(fixture.piLogPath).length, 0);
	assert.equal(existsSync(fixture.submitCapturePath), false);
});

test("refusal classification distinguishes unknown-flag and other (the handshake class is deleted, design 8)", () => {
	assert.equal(classifyReviewHostRelayRefusal("flag provided but not defined: -materialize\nUsage:"), "unknown-flag");
	assert.equal(classifyReviewHostRelayRefusal("flag provided but not defined: -agent"), "unknown-flag");

	assert.equal(classifyReviewHostRelayRefusal("some unrelated explosion"), "other");
});

// gentle-pi#638: only a reviewer killed by the scaled relay bound is proven
// deterministic for this exact slot. Generic admission refusals are repairable
// by a fresh reviewer and retain the ordinary exact-reoffer behavior.
test("the unachievable predicate names only deterministic slot failures", () => {
	const killed = new ReviewHostRelayError(REVIEW_HOST_RELAY_FAILURE.PI_TIMED_OUT, "pi", "pi reviewer subprocess exceeded the relay bound", { timedOut: true, elapsedMs: 2_256_004, timeoutMs: 2_256_000 });
	assert.equal(reviewHostRelayUnachievableReason(killed), "relay_transport_bound_exceeded");
	assert.equal(reviewHostRelayUnachievableDetail(killed), "killed after 2256004ms against a 2256000ms relay bound");

	for (const refusal of ["reviewer payload contains no complete JSON object", "reviewer artifact admission binding_mismatch"]) {
		const admitted = new ReviewHostRelayError(REVIEW_HOST_RELAY_FAILURE.SUBMISSION_REFUSED, "submit", `${refusal} [invalid_request]`, { exitCode: 1, mutationOutcome: "none" });
		assert.equal(reviewHostRelayUnachievableReason(admitted), undefined, `${refusal} is repairable by a fresh reviewer`);
		assert.equal(reviewHostRelayUnachievableDetail(admitted), undefined);
	}

	const unknownOutcome = new ReviewHostRelayError(REVIEW_HOST_RELAY_FAILURE.SUBMISSION_REFUSED, "submit", "gentle-ai capture submission exceeded its bound", { timedOut: true });
	assert.equal(reviewHostRelayUnachievableReason(unknownOutcome), undefined, "an unknown mutation outcome is never deterministic");
	assert.equal(reviewHostRelayUnachievableDetail(unknownOutcome), undefined);

	for (const kind of [REVIEW_HOST_RELAY_FAILURE.PI_FAILED, REVIEW_HOST_RELAY_FAILURE.PI_LAUNCH_FAILED, REVIEW_HOST_RELAY_FAILURE.PI_EMPTY_OUTPUT, REVIEW_HOST_RELAY_FAILURE.MATERIALIZE_FAILED, REVIEW_HOST_RELAY_FAILURE.EMPTY_PROMPT, REVIEW_HOST_RELAY_FAILURE.RELAY_UNAVAILABLE, REVIEW_HOST_RELAY_FAILURE.SUBMISSION_CONTRACT_MISMATCH]) {
		assert.equal(reviewHostRelayUnachievableReason(new ReviewHostRelayError(kind, "pi", "transient")), undefined, `${kind} stays transient`);
	}

	const unmeasured = new ReviewHostRelayError(REVIEW_HOST_RELAY_FAILURE.PI_TIMED_OUT, "pi", "killed at the bound");
	assert.equal(reviewHostRelayUnachievableReason(unmeasured), "relay_transport_bound_exceeded");
	assert.equal(reviewHostRelayUnachievableDetail(unmeasured), undefined, "no measurements means no detail, never a fabricated one");
});

// ---------------------------------------------------------------------------
// Slot detection — the provider decides; nothing is inferred.
// ---------------------------------------------------------------------------

export function collectInput(overrides: Partial<{ captureOperation: string; arguments: ReviewCollectInputV3["arguments"]; submission: ReviewCaptureSubmissionV1 | undefined }> = {}): ReviewCollectInputV3 {
	const argumentsList: ReviewCollectInputV3["arguments"] = overrides.arguments ?? [
		{ name: "lineage", value: "review-1d5aadacc600e167", token: "--lineage=review-1d5aadacc600e167" },
		{ name: "expected-revision", value: `sha256:${"c".repeat(64)}`, token: `--expected-revision=sha256:${"c".repeat(64)}` },
		{ name: "target", value: `sha256:${"d".repeat(64)}`, token: `--target=sha256:${"d".repeat(64)}` },
		{ name: "repository-context", value: `rctx1_${"e".repeat(64)}`, token: `--repository-context=rctx1_${"e".repeat(64)}` },
		{ name: "lens", value: "review-reliability", token: "--lens=review-reliability" },
		{ name: "order", value: "0", token: "--order=0" },
		{ name: "subject-hash", value: `sha256:${"a".repeat(64)}`, token: `--subject-hash=sha256:${"a".repeat(64)}` },
		{ name: "agent", value: "pi", token: "--agent=pi" },
		{ name: "materialize", value: "true", token: "--materialize=true" },
	];
	return {
		name: "reviewer_result",
		schema: "https://gentle-ai.dev/schema/review/reviewer/v1",
		captureOperation: overrides.captureOperation ?? "review.capture-result",
		arguments: argumentsList,
		...("submission" in overrides ? (overrides.submission === undefined ? {} : { submission: overrides.submission }) : { submission: SUBMISSION }),
	};
}

test("only provider-issued pi --materialize capture-result inputs become relay slots", () => {
	const slots = reviewHostRelaySlots([collectInput()]);
	assert.equal(slots.length, 1);
	assert.deepEqual(slots[0]!.captureArgumentTokens, [...CAPTURE_TOKENS]);
	// The provider-owned completing form passes through verbatim.
	assert.deepEqual(slots[0]!.submission, SUBMISSION);
	assert.equal(slots[0]!.lens, "review-reliability");
	assert.equal(slots[0]!.order, "0");

	// A materialize slot whose provider omitted the submission still becomes
	// a slot (the provider decided the route); the relay then fails closed.
	const missingSubmission = reviewHostRelaySlots([collectInput({ submission: undefined })]);
	assert.equal(missingSubmission.length, 1);
	assert.equal(missingSubmission[0]!.submission, undefined);

	const withoutMaterialize = collectInput({ arguments: collectInput().arguments.filter((argument) => argument.name !== "materialize") });
	assert.deepEqual(reviewHostRelaySlots([withoutMaterialize]), []);

	const withoutAgent = collectInput({ arguments: collectInput().arguments.filter((argument) => argument.name !== "agent") });
	assert.deepEqual(reviewHostRelaySlots([withoutAgent]), []);

	const foreignAgent = collectInput({ arguments: collectInput().arguments.map((argument) => argument.name === "agent" ? { ...argument, value: "codex", token: "--agent=codex" } : argument) });
	assert.deepEqual(reviewHostRelaySlots([foreignAgent]), []);

	const evidence = collectInput({ captureOperation: "review.capture-evidence" });
	assert.deepEqual(reviewHostRelaySlots([evidence]), []);
});

test("relay input validation rejects empty or malformed inputs before any process launches", async () => {
	await assert.rejects(runReviewHostRelaySlot({ captureArgumentTokens: [], submission: SUBMISSION }), TypeError);
	await assert.rejects(runReviewHostRelaySlot({ captureArgumentTokens: [""], submission: SUBMISSION }), TypeError);
	await assert.rejects(runReviewHostRelaySlot({ captureArgumentTokens: CAPTURE_TOKENS, submission: SUBMISSION, gentleAiExecutable: "gentle-ai" }), TypeError);
});

// ---------------------------------------------------------------------------
// Provider-owned submission form — consumed verbatim, never synthesized.
// ---------------------------------------------------------------------------

test("a materialize slot without a provider submission fails closed before any process launches", async (t) => {
	const fixture = harness(t);
	const error = await rejectsWithRelayError(
		runReviewHostRelaySlot(relayRequest(fixture, { submission: undefined })),
		REVIEW_HOST_RELAY_FAILURE.SUBMISSION_CONTRACT_MISMATCH,
		"binding",
	);
	assert.equal(error.message, REVIEW_HOST_RELAY_SUBMISSION_MISSING_MESSAGE);
	assert.equal(error.mutationOutcome, "none");
	assert.equal(readLog(fixture.logPath).length, 0, "no gentle-ai invocation was launched");
	assert.equal(readLog(fixture.piLogPath).length, 0, "no pi subprocess was launched");
	assert.equal(existsSync(fixture.submitCapturePath), false);
});

test("a submission form the relay cannot bind is a typed contract mismatch, never a repaired invocation", async (t) => {
	const fixture = harness(t);
	const twoValues: ReviewCaptureSubmissionV1 = {
		...SUBMISSION,
		values: [...SUBMISSION.values, { slot: "extra", domain: "artifact_path_or_stdin", substitutionLocation: 0 }],
	};
	await rejectsWithRelayError(runReviewHostRelaySlot(relayRequest(fixture, { submission: twoValues })), REVIEW_HOST_RELAY_FAILURE.SUBMISSION_CONTRACT_MISMATCH, "binding");
	const noSlot: ReviewCaptureSubmissionV1 = {
		...SUBMISSION,
		argumentTokens: [...BINDING_TOKENS, "--input=/etc/somewhere"],
	};
	await rejectsWithRelayError(runReviewHostRelaySlot(relayRequest(fixture, { submission: noSlot })), REVIEW_HOST_RELAY_FAILURE.SUBMISSION_CONTRACT_MISMATCH, "binding");
	const outOfBounds: ReviewCaptureSubmissionV1 = {
		...SUBMISSION,
		values: [{ slot: "reviewer_result", domain: "artifact_path_or_stdin", substitutionLocation: SUBMISSION.argumentTokens.length }],
	};
	await rejectsWithRelayError(runReviewHostRelaySlot(relayRequest(fixture, { submission: outOfBounds })), REVIEW_HOST_RELAY_FAILURE.SUBMISSION_CONTRACT_MISMATCH, "binding");
	assert.equal(readLog(fixture.logPath).length, 0);
	assert.equal(readLog(fixture.piLogPath).length, 0);
});

test("resolveReviewHostRelaySubmission returns the provider binding untouched", () => {
	const binding = resolveReviewHostRelaySubmission(SUBMISSION);
	assert.equal(binding.operationToken, "capture-result");
	assert.deepEqual(binding.argumentTokens, SUBMISSION.argumentTokens);
	assert.equal(binding.substitutionLocation, BINDING_TOKENS.length);
	assert.throws(() => resolveReviewHostRelaySubmission(undefined), (error: unknown) =>
		error instanceof ReviewHostRelayError && error.kind === REVIEW_HOST_RELAY_FAILURE.SUBMISSION_CONTRACT_MISMATCH && error.message === REVIEW_HOST_RELAY_SUBMISSION_MISSING_MESSAGE);
});

test("the negotiated decoder carries the provider submission through the capture-result collect input", () => {
	const lineageId = "review-1d5aadacc600e167";
	const sha = `sha256:${"c".repeat(64)}`;
	const tree = "3".repeat(40);
	const rawSubmission = {
		operation_token: "capture-result",
		argument_tokens: [...BINDING_TOKENS, "--input={{value}}"],
		values: [{ slot: "reviewer_result", domain: "artifact_path_or_stdin", substitution_location: BINDING_TOKENS.length }],
	};
	const rawInput = {
		name: "reviewer_result",
		schema: "https://gentle-ai.dev/schema/review/reviewer/v1",
		capture_operation: "review.capture-result",
		arguments: [
			{ name: "lineage", value: lineageId, token: `--lineage=${lineageId}` },
			{ name: "agent", value: "pi", token: "--agent=pi" },
			{ name: "materialize", value: "true", token: "--materialize=true" },
		],
		artifact_subject: {
			schema: "gentle-ai.review-artifact-subject/v2",
			subject_hash: sha,
			lineage_id: lineageId,
			authority_revision: sha,
			target_identity: sha,
			base_tree: tree,
			candidate_tree: tree,
			changed_path_manifest_sha256: sha,
			lens: "review-reliability",
			selected_order: 0,
		},
		base_tree: tree,
		candidate_tree: tree,
		changed_path_manifest: [{ path: "app.ts", status: "M", old_mode: "100644", new_mode: "100644", deleted: false, type_changed: false, mode_only: false, intended_untracked: false }],
		submission: rawSubmission,
	};
	const decoded = decodeReviewNextTransitionV3({ kind: "collect", reason_code: "reviewer_results_required", collect: { inputs: [rawInput] } });
	assert.equal(decoded.collect!.inputs[0]!.submission!.operationToken, "capture-result");
	assert.deepEqual(decoded.collect!.inputs[0]!.submission!.argumentTokens, rawSubmission.argument_tokens);
	assert.deepEqual(decoded.collect!.inputs[0]!.submission!.values, [{ slot: "reviewer_result", domain: "artifact_path_or_stdin", substitutionLocation: BINDING_TOKENS.length }]);

	// Strict rejections: submission outside capture-result, and a
	// substitution location outside its own argument tokens.
	assert.throws(() => decodeReviewNextTransitionV3({ kind: "collect", reason_code: "verification_evidence_required", collect: { inputs: [{
		name: "verification_evidence",
		schema: "gentle-ai.review-verification-evidence/v2",
		capture_operation: "review.capture-evidence",
		arguments: [{ name: "lineage", value: lineageId }],
		submission: rawSubmission,
	}] } }), /submission is only valid for review\.capture-result/);
	assert.throws(() => decodeReviewNextTransitionV3({ kind: "collect", reason_code: "reviewer_results_required", collect: { inputs: [{
		...rawInput,
		submission: { ...rawSubmission, values: [{ slot: "reviewer_result", domain: "artifact_path_or_stdin", substitution_location: rawSubmission.argument_tokens.length }] },
	}] } }), /substitution_location/);
});

test("jero-pi M3 fail-closed defaults: the exact relay-unavailable messages without injected seams", async (t) => {
	const fixture = harness(t);
	// Materialize with NO render seam and NO executable: the default fails
	// closed with the pinned M3 message and never launches anything.
	const prepareError = await rejectsWithRelayError(
		prepareReviewHostRelaySlot(relayRequest(fixture, { gentleAiExecutable: undefined })),
		REVIEW_HOST_RELAY_FAILURE.RELAY_UNAVAILABLE,
		"materialize",
	);
	assert.equal(prepareError.message, "authority-unavailable: no in-process renderSlot seam was injected and no binary transport exists (jero-pi M3)");
	assert.equal(prepareError.mutationOutcome, "none");
	assert.equal(readLog(fixture.logPath).length, 0, "no binary was spawned");
	// Submit with NO admit seam and NO executable: prepared through the
	// injected render/reviewer seams (no spawn), then the default submit
	// fails closed with its own pinned message.
	const prepared = await prepareReviewHostRelaySlot(
		relayRequest(fixture, { gentleAiExecutable: undefined }),
		async () => ({ stdout: Buffer.from(PI_OUTPUT_BYTES), promptByteLength: PROMPT_BYTES.length, stdoutByteLength: PI_OUTPUT_BYTES.length }),
		async () => ({ promptBytes: Buffer.from(PROMPT_BYTES) }),
	);
	const submitError = await rejectsWithRelayError(
		submitReviewHostRelayPreparedResult(prepared),
		REVIEW_HOST_RELAY_FAILURE.RELAY_UNAVAILABLE,
		"submit",
	);
	assert.equal(submitError.message, "authority-unavailable: no in-process admitResult seam was injected and no binary transport exists (jero-pi M3)");
	assert.equal(readLog(fixture.logPath).length, 0, "still no binary was spawned");
});

