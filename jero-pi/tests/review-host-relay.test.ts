// review-host-relay 测试第 1 段（留守原文件名）（共 2 段；夹具在 review-host-relay-shared.ts）。
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
import { admittingRequest, collectInput } from "./review-host-relay.z2.test.ts";

test("the central native CLI runner no longer declares any relay contract on gentle-ai spawns (design 8)", async (t) => {
	const fixture = harness(t);
	const probe = join(fixture.directory, "env-probe");
	writeFileSync(probe, `#!/usr/bin/env node\nprocess.stdout.write(JSON.stringify({ contract: process.env.JERO_PI_REVIEW_RELAY_CONTRACT ?? null }));\n`);
	chmodSync(probe, 0o755);
	const hadContract = Object.prototype.hasOwnProperty.call(process.env, "JERO_PI_REVIEW_RELAY_CONTRACT");
	const previous = process.env.JERO_PI_REVIEW_RELAY_CONTRACT;
	delete process.env.JERO_PI_REVIEW_RELAY_CONTRACT;
	t.after(() => {
		if (hadContract) process.env.JERO_PI_REVIEW_RELAY_CONTRACT = previous;
	});
	const adapter = createNodeExecFileAdapter();
	for (const argv of [["version"], ["review", "status", "--cwd", fixture.directory]]) {
		const result = await adapter({ file: probe, arguments: argv, cwd: fixture.directory, timeoutMs: 10_000, maxBufferBytes: 1024 * 1024 });
		assert.equal(result.exitCode, 0);
		assert.deepEqual(JSON.parse(result.stdout), { contract: null });
	}
});

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

test("relay happy path moves prompt and result bytes verbatim through a fresh empty scratch pi subprocess", async (t) => {
	const fixture = harness(t);
	const result = await runReviewHostRelaySlot(relayRequest(fixture));

	assert.equal(result.promptByteLength, PROMPT_BYTES.length);
	assert.equal(result.resultByteLength, PI_OUTPUT_BYTES.length);
	assert.equal(JSON.parse(result.submission).admission_decision, "completed");

	// Prompt bytes reached pi stdin verbatim.
	assert.deepEqual(readFileSync(fixture.stdinCapturePath), PROMPT_BYTES);
	// Submission --input file bytes are EXACTLY the pi stdout bytes.
	assert.deepEqual(readFileSync(fixture.submitCapturePath), PI_OUTPUT_BYTES);

	const gentleAiCalls = readLog(fixture.logPath);
	assert.equal(gentleAiCalls.length, 2);
	// (a) exact provider tokens, verbatim, in provider order.
	assert.deepEqual(gentleAiCalls[0]!.argv, ["review", "capture-result", ...CAPTURE_TOKENS]);
	// (d) the provider-owned submission form, verbatim: its exact operation
	// and argument tokens with only the artifact path substituted into the
	// declared {{value}} slot. No agent/materialize, nothing synthesized.
	assert.deepEqual(gentleAiCalls[1]!.argv.slice(0, 2 + BINDING_TOKENS.length), ["review", SUBMISSION.operationToken, ...BINDING_TOKENS]);
	const substituted = gentleAiCalls[1]!.argv.at(-1)!;
	assert.match(substituted, /^--input=\S+$/);
	assert.equal(substituted.includes("{{value}}"), false);
	assert.equal(existsSync(substituted.slice("--input=".length)), false, "the coordinator removes its temporary result file after provider submission");
	assert.equal(gentleAiCalls[1]!.argv.length, 2 + SUBMISSION.argumentTokens.length);
	assert.equal(gentleAiCalls[1]!.argv.some((token) => token.includes("--agent") || token.includes("--materialize")), false);
	// No handshake env on either gentle-ai invocation (design 8: the
	// protocol string is deleted).
	assert.deepEqual(gentleAiCalls.map((call) => call.contract), [null, null]);
	assert.deepEqual(gentleAiCalls.map((call) => call.cwd), [fixture.targetCwd, fixture.targetCwd]);

	const piCalls = readLog(fixture.piLogPath);
	assert.equal(piCalls.length, 1);
	// The pi environment stays untouched: no relay handshake is injected.
	assert.equal(piCalls[0]!.contract, null);
	// Fresh EMPTY scratch cwd, removed after the run.
	assert.deepEqual(piCalls[0]!.entries, []);
	assert.notEqual(piCalls[0]!.cwd, process.cwd());
	assert.equal(existsSync(piCalls[0]!.cwd!), false);
});

test("the pi lockdown argv is pinned exactly with no model or provider selection", async (t) => {
	const fixture = harness(t);
	await runReviewHostRelaySlot(relayRequest(fixture));
	const piCalls = readLog(fixture.piLogPath);
	const expected = [
		"--print",
		"--mode", "text",
		"--no-session",
		"--no-tools",
		"--no-extensions",
		"--no-skills",
		"--no-prompt-templates",
		"--no-themes",
		"--no-context-files",
		"--no-approve",
	];
	assert.deepEqual([...REVIEW_HOST_RELAY_PI_ARGV], expected);
	assert.deepEqual(piCalls[0]!.argv, expected);
	assert.equal(piCalls[0]!.argv.some((token) => token.startsWith("--model") || token.startsWith("--provider") || token.startsWith("--profile")), false);
});

test("preparation snapshots mutable submission tokens and values before materialization", async (t) => {
	const fixture = harness(t);
	// M3: fully in-process through the render/admit seams, so the snapshot
	// discipline is exercised without any spawn (the reviewer barrier is an
	// injected async gate instead of a fake pi child).
	let releaseReviewer: (() => void) | undefined;
	const reviewerReachedBarrier = new Promise<void>((resolve) => {
		releaseReviewer = resolve;
	});
	let admittedBytes: Buffer | undefined;
	const request = relayRequest(fixture, { gentleAiExecutable: undefined });
	const mutableSubmission: ReviewCaptureSubmissionV1 = {
		...SUBMISSION,
		argumentTokens: [...SUBMISSION.argumentTokens],
		values: SUBMISSION.values.map((value) => ({ ...value })),
	};
	(request as { submission?: ReviewCaptureSubmissionV1 }).submission = mutableSubmission;
	const prepared = prepareReviewHostRelaySlot(
		request,
		async () => {
			await reviewerReachedBarrier;
			return { stdout: Buffer.from(PI_OUTPUT_BYTES), promptByteLength: PROMPT_BYTES.length, stdoutByteLength: PI_OUTPUT_BYTES.length };
		},
		async () => ({ promptBytes: Buffer.from(PROMPT_BYTES) }),
	);
	await new Promise<void>((resolve) => setImmediate(resolve));
	(mutableSubmission.argumentTokens as string[])[mutableSubmission.argumentTokens.length - 1] = "--input=mutated";
	(mutableSubmission.values as unknown as { slot: string }[])[0]!.slot = "mutated";
	releaseReviewer!();

	const result = await prepared;
	assert.deepEqual(result.request.submission, SUBMISSION);
	await submitReviewHostRelayPreparedResult(result, async (_request, _operationToken, tokens, resultFile) => {
		admittedBytes = readFileSync(resultFile);
		assert.equal(tokens.some((token) => token.startsWith("--input=")), true);
		assert.equal(tokens.some((token) => token.includes("{{value}}")), false, "the value slot is substituted with the staged file path");
		return JSON.stringify({ schema: "jero.authority.review-result-artifact/v1", admission_decision: "completed" });
	});
	assert.deepEqual(admittedBytes, PI_OUTPUT_BYTES, "the staged result file carries the reviewer bytes verbatim");
});

test("preparation keeps reviewer bytes private through deferred submission", async (t) => {
	const fixture = harness(t);
	const reviewerBytes = Buffer.from(PI_OUTPUT_BYTES);
	const prepared = await prepareReviewHostRelaySlot(
		relayRequest(fixture, { gentleAiExecutable: undefined }),
		async () => ({
			stdout: reviewerBytes,
			promptByteLength: PROMPT_BYTES.length,
			stdoutByteLength: reviewerBytes.length,
		}),
		async () => ({ promptBytes: Buffer.from(PROMPT_BYTES) }),
	);
	reviewerBytes.fill(0);
	const mutablePrepared = prepared as unknown as { resultBytes?: Buffer };
	mutablePrepared.resultBytes?.fill(0);
	assert.throws(() => { mutablePrepared.resultBytes = Buffer.from("fabricated"); }, TypeError);
	let admittedBytes: Buffer | undefined;
	await submitReviewHostRelayPreparedResult(prepared, async (_request, _operationToken, _tokens, resultFile) => {
		admittedBytes = readFileSync(resultFile);
		return '{"admission_decision":"completed"}';
	});
	assert.deepEqual(admittedBytes, PI_OUTPUT_BYTES);

	const fabricated = { ...prepared, resultBytes: Buffer.from("fabricated") } as unknown as ReviewHostRelayPreparedResult;
	await assert.rejects(submitReviewHostRelayPreparedResult(fabricated), /recognized prepared result/);
});


test("the supplied AbortSignal stays live through deferred submission", async (t) => {
	// 延迟必须远超 waitFor 轮询在高负载下的完成时间：否则提交可能在
	// abort 前自然结束，测试以"缺失拒绝"偶发失败。
	const fixture = harness(t, { RELAY_FAKE_SUBMIT_DELAY_MS: "20000" });
	const controller = new AbortController();
	const prepared = await prepareReviewHostRelaySlot(relayRequest(fixture, { signal: controller.signal }));
	const submission = submitReviewHostRelayPreparedResult(prepared);
	await waitFor(() => readLog(fixture.logPath).length === 2, "submission did not start");
	controller.abort();
	await rejectsWithRelayError(submission, REVIEW_HOST_RELAY_FAILURE.SUBMISSION_REFUSED, "submit");
});

test("four reviewers cross a shared barrier before any result submission can begin", async (t) => {
	const fixture = harness(t);
	const barrierDirectory = join(fixture.directory, "reviewer-barrier");
	const requests = reviewerGroupRequests(fixture).map((request) => ({
		...request,
		environment: {
			...request.environment,
			RELAY_FAKE_PI_BARRIER_DIR: barrierDirectory,
			RELAY_FAKE_PI_BARRIER_COUNT: String(REVIEWER_GROUP_LENSES.length),
		},
	}));

	const prepared = await runReviewHostRelayReviewerGroup(requests);

	assert.equal(prepared.length, REVIEWER_GROUP_LENSES.length);
	assert.ok(prepared.every((result) => result.resultByteLength === PI_OUTPUT_BYTES.length));
	assert.equal(readLog(fixture.piLogPath).length, REVIEWER_GROUP_LENSES.length);
	assert.equal(readLog(fixture.logPath).length, REVIEWER_GROUP_LENSES.length, "preparation materializes only; it does not submit");
});

test("four reviewer results retain provider order when their preparation resolves in reverse", async (t) => {
	const requests = reviewerGroupRequests(harness(t));
	const started: number[] = [];
	const complete: Array<() => void> = [];
	const group = runReviewHostRelayReviewerGroup(requests, (request) => new Promise<ReviewHostRelayPreparedResult>((resolve) => {
		const index = requests.indexOf(request);
		assert.notEqual(index, -1);
		started.push(index);
		complete.push(() => resolve({
			request,
			promptByteLength: index + 1,
			resultByteLength: index + 1,
		}));
	}));

	assert.deepEqual(started, [0, 1, 2, 3], "every reviewer starts before the group waits");
	for (const finish of [...complete].reverse()) finish();
	const prepared = await group;

	assert.deepEqual(prepared.map((result) => result.resultByteLength), [1, 2, 3, 4]);
});

test("partial reviewer failures wait for a later pending transport and report the first provider-ordered error", async (t) => {
	const requests = reviewerGroupRequests(harness(t));
	const started: number[] = [];
	let groupSettled = false;
	let releaseLaterReviewer: (() => void) | undefined, rejectFirstProvider: ((reason?: unknown) => void) | undefined;
	const firstProviderError = new ReviewHostRelayError(REVIEW_HOST_RELAY_FAILURE.PI_FAILED, "pi", "first provider error");

	const group = runReviewHostRelayReviewerGroup(requests, (request) => {
		const index = requests.indexOf(request);
		assert.notEqual(index, -1);
		started.push(index);
		if (index === 1) return new Promise<ReviewHostRelayPreparedResult>((_resolve, reject) => { rejectFirstProvider = reject; });
		if (index === 2) return Promise.reject(new ReviewHostRelayError(REVIEW_HOST_RELAY_FAILURE.PI_FAILED, "pi", "later provider error"));
		if (index === 3) {
			return new Promise<ReviewHostRelayPreparedResult>((resolve) => {
				releaseLaterReviewer = () => resolve({
					request,
					promptByteLength: index + 1,
					resultByteLength: index + 1,
				});
			});
		}
		return Promise.resolve({
			request,
			promptByteLength: index + 1,
			resultByteLength: index + 1,
		});
	});
	void group.then(() => { groupSettled = true; }, () => { groupSettled = true; });

	await new Promise<void>((resolve) => setImmediate(resolve));
	assert.deepEqual(started, [0, 1, 2, 3], "one failed reviewer does not prevent later reviewers from starting");
	rejectFirstProvider!(firstProviderError); await new Promise<void>((resolve) => setImmediate(resolve));
	assert.equal(groupSettled, false, "the group must remain pending until the later reviewer settles");
	releaseLaterReviewer!();
	await assert.rejects(group, (error: unknown) => error === firstProviderError);
});

// ---------------------------------------------------------------------------
// Fail-closed legs — a typed transport error and NO submission.
// ---------------------------------------------------------------------------

test("materialize nonzero exit fails closed with a typed error and never launches pi or submits", async (t) => {
	const fixture = harness(t, { RELAY_FAKE_MATERIALIZE_MODE: "fail" });
	const error = await rejectsWithRelayError(runReviewHostRelaySlot(relayRequest(fixture)), REVIEW_HOST_RELAY_FAILURE.MATERIALIZE_FAILED, "materialize");
	assert.equal(error.exitCode, 3);
	assert.equal(error.mutationOutcome, "none");
	assert.equal(readLog(fixture.logPath).length, 1);
	assert.equal(readLog(fixture.piLogPath).length, 0);
	assert.equal(existsSync(fixture.submitCapturePath), false);
});

test("an empty materialized prompt fails closed before pi launches", async (t) => {
	const fixture = harness(t, { RELAY_FAKE_MATERIALIZE_MODE: "empty" });
	await rejectsWithRelayError(runReviewHostRelaySlot(relayRequest(fixture)), REVIEW_HOST_RELAY_FAILURE.EMPTY_PROMPT, "materialize");
	assert.equal(readLog(fixture.piLogPath).length, 0);
	assert.equal(existsSync(fixture.submitCapturePath), false);
});

test("pi nonzero exit fails closed with a typed error and no submission", async (t) => {
	const fixture = harness(t, { RELAY_FAKE_PI_MODE: "fail" });
	const error = await rejectsWithRelayError(runReviewHostRelaySlot(relayRequest(fixture)), REVIEW_HOST_RELAY_FAILURE.PI_FAILED, "pi");
	assert.equal(error.exitCode, 4);
	assert.equal(error.mutationOutcome, "none");
	assert.equal(readLog(fixture.logPath).length, 1, "no submission invocation after pi failure");
	assert.equal(existsSync(fixture.submitCapturePath), false);
});

test("empty pi stdout fails closed with a typed error and no submission", async (t) => {
	const fixture = harness(t, { RELAY_FAKE_PI_MODE: "empty" });
	await rejectsWithRelayError(runReviewHostRelaySlot(relayRequest(fixture)), REVIEW_HOST_RELAY_FAILURE.PI_EMPTY_OUTPUT, "pi");
	assert.equal(readLog(fixture.logPath).length, 1);
	assert.equal(existsSync(fixture.submitCapturePath), false);
});

test("pi timeout fails closed with a typed error and no submission", async (t) => {
	const fixture = harness(t, { RELAY_FAKE_PI_MODE: "hang" });
	const error = await rejectsWithRelayError(runReviewHostRelaySlot(relayRequest(fixture, { piTimeoutMs: 300 })), REVIEW_HOST_RELAY_FAILURE.PI_TIMED_OUT, "pi");
	assert.equal(error.timedOut, true);
	assert.equal(readLog(fixture.logPath).length, 1);
	assert.equal(existsSync(fixture.submitCapturePath), false);
});

// ---------------------------------------------------------------------------
// gentle-pi#367 — the reviewer bound is reachable from production, and a
// reviewer killed by it says so with both measurements.
// ---------------------------------------------------------------------------

test("the reviewer bound scales with materialized prompt bytes instead of one fixed number", () => {
	const empty: NodeJS.ProcessEnv = {};
	// A tiny prompt still gets the model-latency floor.
	assert.equal(resolveReviewHostRelayPiTimeoutMs(0, empty), REVIEW_HOST_RELAY_PI_TIMEOUT_FLOOR_MS);
	assert.equal(resolveReviewHostRelayPiTimeoutMs(1, empty), REVIEW_HOST_RELAY_PI_TIMEOUT_FLOOR_MS + 1);
	// One mebibyte of prompt buys exactly one linear allowance.
	assert.equal(
		resolveReviewHostRelayPiTimeoutMs(1024 * 1024, empty),
		REVIEW_HOST_RELAY_PI_TIMEOUT_FLOOR_MS + REVIEW_HOST_RELAY_PI_TIMEOUT_PER_MEBIBYTE_MS,
	);
	// The reported field candidate: ~1.58 MB of prompt, whose reviewer needed
	// 478s and was killed by the old fixed 600s bound. The derived bound must
	// clear that measurement with real margin.
	const reported = resolveReviewHostRelayPiTimeoutMs(1_580_000, empty);
	assert.ok(reported > 600_000, `derived bound ${reported} must exceed the old fixed 600000ms bound`);
	assert.ok(reported > 478_000 * 3, `derived bound ${reported} must keep real margin over the measured 478000ms reviewer run`);
	// Never unbounded, however large the prompt gets.
	assert.equal(resolveReviewHostRelayPiTimeoutMs(Number.MAX_SAFE_INTEGER, empty), REVIEW_HOST_RELAY_PI_TIMEOUT_MAX_MS);
});

test("the reviewer bound honours the environment override and ignores malformed values", () => {
	const bytes = 4 * 1024 * 1024;
	assert.equal(resolveReviewHostRelayPiTimeoutMs(bytes, { [REVIEW_HOST_RELAY_PI_TIMEOUT_ENV]: "1234" }), 1234);
	// The override is clamped by the same hard ceiling as the derived bound.
	assert.equal(resolveReviewHostRelayPiTimeoutMs(bytes, { [REVIEW_HOST_RELAY_PI_TIMEOUT_ENV]: "999999999" }), REVIEW_HOST_RELAY_PI_TIMEOUT_MAX_MS);
	const derived = resolveReviewHostRelayPiTimeoutMs(bytes, {});
	for (const malformed of ["", "0", "-1", "12.5", "abc", " 600000", "1e6"]) {
		assert.equal(resolveReviewHostRelayPiTimeoutMs(bytes, { [REVIEW_HOST_RELAY_PI_TIMEOUT_ENV]: malformed }), derived, `malformed ${JSON.stringify(malformed)} must fall back to the derived bound`);
	}
});

test("the production relay path resolves the reviewer bound from the environment, with no injected timeout", async (t) => {
	// The regression: piTimeoutMs was reachable only through the test seam, so
	// production always ran against the fixed 600s bound. This request injects
	// no timeout at all — the override must reach the real spawn.
	const fixture = harness(t, { RELAY_FAKE_PI_MODE: "hang", [REVIEW_HOST_RELAY_PI_TIMEOUT_ENV]: "300" });
	const error = await rejectsWithRelayError(
		runReviewHostRelaySlot(relayRequest(fixture, { piTimeoutMs: undefined })),
		REVIEW_HOST_RELAY_FAILURE.PI_TIMED_OUT,
		"pi",
	);
	assert.equal(error.timeoutMs, 300);
	assert.equal(error.timedOut, true);
	assert.equal(readLog(fixture.logPath).length, 1, "no submission after a reviewer timeout");
	assert.equal(existsSync(fixture.submitCapturePath), false);
});

test("a relay Pi timeout keeps its typed mapping and timing evidence when opaque scratch cleanup also fails", async (t) => {
	const fixture = harness(t, { RELAY_FAKE_PI_MODE: "hang", RELAY_FAKE_PI_BREAK_CLEANUP: "true" });
	const scratchParent = realpathSync(mkdtempSync(join(tmpdir(), "gentle-pi-relay-pi-primary-failure-")));
	const originalTmpdir = process.env.TMPDIR;
	process.env.TMPDIR = scratchParent;
	try {
		const error = await rejectsWithRelayError(
			runReviewHostRelaySlot(relayRequest(fixture, { piTimeoutMs: 300 })),
			REVIEW_HOST_RELAY_FAILURE.PI_TIMED_OUT,
			"pi",
		);
		assert.equal(error.timedOut, true);
		assert.equal(error.timeoutMs, 300);
		assert.ok(error.elapsedMs !== null && error.elapsedMs >= 250);
	} finally {
		if (originalTmpdir === undefined) delete process.env.TMPDIR;
		else process.env.TMPDIR = originalTmpdir;
		chmodSync(scratchParent, 0o700);
		rmSync(scratchParent, { recursive: true, force: true });
	}
});

test("a killed reviewer reports elapsed, limit, and what to change instead of an opaque transport failure", async (t) => {
	const fixture = harness(t, { RELAY_FAKE_PI_MODE: "hang" });
	const error = await rejectsWithRelayError(runReviewHostRelaySlot(relayRequest(fixture, { piTimeoutMs: 300 })), REVIEW_HOST_RELAY_FAILURE.PI_TIMED_OUT, "pi");
	assert.equal(error.timeoutMs, 300);
	assert.ok(error.elapsedMs !== null && error.elapsedMs >= 250, `elapsed ${error.elapsedMs} must record the real wall time`);
	assert.ok(error.elapsedMs! < 10_000, "the reviewer was killed at the bound, not left to finish");
	assert.match(error.message, /exceeded the relay bound/);
	assert.match(error.message, new RegExp(String(error.elapsedMs)));
	assert.match(error.message, /limit for a \d+-byte materialized prompt/);
	assert.match(error.message, new RegExp(REVIEW_HOST_RELAY_PI_TIMEOUT_ENV));
	assert.equal(error.mutationOutcome, "none");
});

