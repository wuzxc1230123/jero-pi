// review-host-relay 测试共享夹具与助手：自 review-host-relay.test.ts 机械平移（语义零改动）。

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


// ---------------------------------------------------------------------------
// Fake binaries. Following the repo's fake-executable idiom (shell/git
// wrappers in related review tests), these are
// shebang scripts written into a scratch directory; node scripts are used so
// binary-unsafe bytes survive verbatim.
// ---------------------------------------------------------------------------

export const FAKE_GENTLE_AI = `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const argv = process.argv.slice(2);
if (process.env.RELAY_FAKE_LOG) fs.appendFileSync(process.env.RELAY_FAKE_LOG, JSON.stringify({ argv, cwd: process.cwd(), contract: process.env.JERO_PI_REVIEW_RELAY_CONTRACT ?? null }) + "\\n");
if (argv.some((token) => token === "--materialize" || token.startsWith("--materialize="))) {
	const mode = process.env.RELAY_FAKE_MATERIALIZE_MODE || "ok";
	if (mode === "ok") { process.stdout.write(Buffer.from(process.env.RELAY_FAKE_PROMPT_B64 || "", "base64")); process.exit(0); }
	if (mode === "empty") process.exit(0);
	if (mode === "unknown-flag") { process.stderr.write("flag provided but not defined: -materialize\\nUsage of gentle-ai review capture-result:\\n"); process.exit(2); }
	process.stderr.write("materialize exploded\\n"); process.exit(3);
}
const inputToken = argv.find((token) => token === "--input" || token.startsWith("--input="));
if (inputToken !== undefined) {
	const mode = process.env.RELAY_FAKE_SUBMIT_MODE || "ok";
	const inputPath = inputToken.startsWith("--input=") ? inputToken.slice("--input=".length) : argv[argv.indexOf("--input") + 1];
	const submitDelayMs = Number(process.env.RELAY_FAKE_SUBMIT_DELAY_MS || "0");
	if (Number.isSafeInteger(submitDelayMs) && submitDelayMs > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, submitDelayMs);
	if (mode === "ok" || mode === "cleanup-fail") {
		const bytes = fs.readFileSync(inputPath);
		if (process.env.RELAY_FAKE_SUBMIT_CAPTURE) fs.writeFileSync(process.env.RELAY_FAKE_SUBMIT_CAPTURE, bytes);
		const accepted = JSON.stringify({ schema: "gentle-ai.review-result-artifact/v2", admission_decision: "completed" });
		if (mode === "cleanup-fail") {
			// Windows 忽略目录只读位（rmdir 照常成功）；改用分离锁持进程：
			// 在暂存目录内保持一个打开句柄使 rm 失败。等锁持方就绪后再退出，
			// 消除父方立即清理的竞态。POSIX 保留 chmod 语义。
			if (process.platform === "win32") {
				// Windows 忽略目录只读位，且打开的文件句柄不阻塞 POSIX 语义
				// 的 rm；唯一可靠的占位是让一个分离进程把工作目录设进被清理
				// 的暂存目录（inputPath 的直接父目录），rm 以 EPERM 失败。
				// 锁持方监视暂存父目录里的 kill 旗标以协作退出，避免泄漏。
				const lockDir = path.dirname(inputPath);
				const ready = inputPath + ".holder-ready";
				const killFlag = path.join(path.dirname(path.dirname(inputPath)), "kill-holders");
				require("node:child_process").spawn(process.execPath, ["-e", "process.chdir(process.argv[1]); require('node:fs').writeFileSync(process.argv[2], 'ready'); setInterval(() => { if (require('node:fs').existsSync(process.argv[3])) process.exit(0); }, 100);", lockDir, ready, killFlag], { detached: true, stdio: "ignore" }).unref();
				const deadline = Date.now() + 5000;
				while (!fs.existsSync(ready) && Date.now() < deadline) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
			} else {
				fs.chmodSync(path.dirname(path.dirname(inputPath)), 0o500);
			}
			process.stdout.write(accepted);
			process.exit(0);
		}
		process.stdout.write(accepted);
		process.exit(0);
	}
	if (mode === "refuse-cleanup-fail") fs.chmodSync(path.dirname(path.dirname(inputPath)), 0o500);
	if (mode === "admit") {
		// Go's admission refusal shape: a schema-bounded failure/v2 envelope on
		// stdout, the operator line with the typed code suffix on stderr, exit 1.
		const bytes = fs.readFileSync(inputPath);
		let parsed;
		try { parsed = JSON.parse(bytes.toString("utf8")); } catch { parsed = undefined; }
		const refuse = (cause) => {
			process.stdout.write(JSON.stringify({ schema: "gentle-ai.review-integration.failure/v2", contract: "gentle-ai.review-integration/v2", operation: "review.capture-result", phase: "preflight", code: "invalid_request", message: "The negotiated review request is invalid.", mutation_outcome: "not_started", authority_applicability: "not_evaluated", retry_safe: true, replayability: "not_replayable", required_inputs: [], next_action: "correct_request", cause }));
			process.stderr.write("Error: " + cause + " [invalid_request]\\n");
			process.exit(1);
		};
		if (parsed === undefined || typeof parsed !== "object") refuse("lens provider result admission incomplete: reviewer payload contains no complete JSON object: no object start was found in " + bytes.length + " bytes; the rejected reviewer payload was preserved at " + inputPath + ".rejected");
		if (parsed.subject_hash !== process.env.RELAY_FAKE_EXPECTED_SUBJECT) refuse("reviewer artifact admission binding_mismatch: reviewer result echoed a different artifact subject: the rejected admission did not consume the lens slot, so re-run the lens and invoke gentle-ai review capture-result again on the same lineage with a result that echoes the binding's top-level subject_hash, which is " + process.env.RELAY_FAKE_EXPECTED_SUBJECT);
		process.stdout.write(JSON.stringify({ schema: "gentle-ai.review-result-artifact/v2", admission_decision: "completed" }));
		process.exit(0);
	}
	process.stderr.write("capture binding does not match the current reviewing authority\\n");
	process.exit(1);
}
process.stderr.write("unexpected fake gentle-ai invocation\\n");
process.exit(9);
`;

export const FAKE_PI = `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const argv = process.argv.slice(2);
if (process.env.RELAY_FAKE_PI_LOG) fs.appendFileSync(process.env.RELAY_FAKE_PI_LOG, JSON.stringify({ argv, cwd: process.cwd(), entries: fs.readdirSync(process.cwd()), contract: process.env.JERO_PI_REVIEW_RELAY_CONTRACT ?? null }) + "\\n");
const chunks = [];
process.stdin.on("data", (chunk) => chunks.push(chunk));
process.stdin.on("end", () => {
	const stdin = Buffer.concat(chunks);
	if (process.env.RELAY_FAKE_PI_STDIN_CAPTURE) fs.writeFileSync(process.env.RELAY_FAKE_PI_STDIN_CAPTURE, stdin);
	const finish = () => {
		const mode = process.env.RELAY_FAKE_PI_MODE || "ok";
		if (process.env.RELAY_FAKE_PI_BREAK_CLEANUP === "true") fs.chmodSync(path.dirname(process.cwd()), 0o500);
		if (mode === "ok") { process.stdout.write(Buffer.from(process.env.RELAY_FAKE_PI_OUTPUT_B64 || "", "base64")); process.exit(0); }
		if (mode === "empty") process.exit(0);
		if (mode === "hang") { setTimeout(() => process.exit(0), 10_000); return; }
		process.stderr.write("pi exploded\\n");
		process.exit(4);
	};
	const barrierDirectory = process.env.RELAY_FAKE_PI_BARRIER_DIR;
	if (barrierDirectory === undefined) { finish(); return; }
	fs.mkdirSync(barrierDirectory, { recursive: true });
	fs.writeFileSync(path.join(barrierDirectory, String(process.pid)), "started");
	const expected = Number(process.env.RELAY_FAKE_PI_BARRIER_COUNT || "4");
	const deadline = Date.now() + 1_000;
	const releaseFile = process.env.RELAY_FAKE_PI_RELEASE_FILE;
	const waitForGroup = () => {
		if (fs.readdirSync(barrierDirectory).length < expected) {
			if (Date.now() >= deadline) { process.stderr.write("reviewer barrier timed out\\n"); process.exit(5); return; }
			setTimeout(waitForGroup, 10);
			return;
		}
		if (releaseFile !== undefined && !fs.existsSync(releaseFile)) { setTimeout(waitForGroup, 10); return; }
		finish();
	};
	waitForGroup();
});
`;

export interface RelayHarness {
	directory: string;
	gentleAi: string;
	pi: string;
	logPath: string;
	piLogPath: string;
	stdinCapturePath: string;
	submitCapturePath: string;
	targetCwd: string;
	environment: NodeJS.ProcessEnv;
}

export function harness(t: test.TestContext, overrides: Record<string, string> = {}): RelayHarness {
	const directory = realpathSync(mkdtempSync(join(tmpdir(), "gentle-pi-relay-harness-")));
	// Windows 上被 abort 杀掉的子进程（其 cwd 即本目录）句柄释放可能滞后
	// 于 close 事件，立即 rmSync 偶发 EPERM；以退避重试收敛。
	t.after(async () => {
		for (let attempt = 0; attempt < 20; attempt++) {
			try {
				rmSync(directory, { recursive: true, force: true });
				return;
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "EPERM" || attempt === 19) throw error;
				await new Promise((resolve) => setTimeout(resolve, 50));
			}
		}
	});
	const gentleAi = join(directory, "gentle-ai");
	const pi = join(directory, "pi");
	writeFileSync(gentleAi, FAKE_GENTLE_AI);
	chmodSync(gentleAi, 0o755);
	writeFileSync(pi, FAKE_PI);
	chmodSync(pi, 0o755);
	const logPath = join(directory, "gentle-ai.log");
	const piLogPath = join(directory, "pi.log");
	const stdinCapturePath = join(directory, "pi-stdin.bin");
	const submitCapturePath = join(directory, "submitted.bin");
	const targetCwd = join(directory, "target-worktree");
	mkdirSync(targetCwd);
	const environment: NodeJS.ProcessEnv = {
		...process.env,
		RELAY_FAKE_LOG: logPath,
		RELAY_FAKE_PI_LOG: piLogPath,
		RELAY_FAKE_PI_STDIN_CAPTURE: stdinCapturePath,
		RELAY_FAKE_SUBMIT_CAPTURE: submitCapturePath,
		...overrides,
	};
	// jero-pi M3 (design 8): the relay handshake env is deleted — the base
	// environment never carries it and the relay never injects it.
	delete environment.JERO_PI_REVIEW_RELAY_CONTRACT;
	return { directory, gentleAi, pi, logPath, piLogPath, stdinCapturePath, submitCapturePath, targetCwd, environment };
}

export function readLog(path: string): Array<{ argv: string[]; contract: string | null; cwd?: string; entries?: string[] }> {
	if (!existsSync(path)) return [];
	return readFileSync(path, "utf8").split("\n").filter((line) => line.length > 0).map((line) => JSON.parse(line));
}

export async function waitFor(condition: () => boolean, message: string): Promise<void> {
	for (let attempt = 0; attempt < 100; attempt += 1) {
		if (condition()) return;
		await new Promise<void>((resolve) => setTimeout(resolve, 10));
	}
	throw new Error(message);
}

export const BINDING_TOKENS = Object.freeze([
	"--lineage=review-1d5aadacc600e167",
	`--expected-revision=sha256:${"c".repeat(64)}`,
	`--target=sha256:${"d".repeat(64)}`,
	`--repository-context=rctx1_${"e".repeat(64)}`,
	"--lens=review-reliability",
	"--order=0",
	`--subject-hash=sha256:${"a".repeat(64)}`,
]);
export const CAPTURE_TOKENS = Object.freeze([...BINDING_TOKENS, "--agent=pi", "--materialize=true"]);
export const REVIEWER_GROUP_LENSES = ["review-risk", "review-resilience", "review-readability", "review-reliability"] as const;

// The provider-owned completing form: exact operation and argument tokens
// with one declared {{value}} substitution slot for the artifact path.
export const SUBMISSION: ReviewCaptureSubmissionV1 = Object.freeze({
	operationToken: "capture-result",
	argumentTokens: Object.freeze([...BINDING_TOKENS, "--input={{value}}"]),
	values: Object.freeze([{ slot: "reviewer_result", domain: "artifact_path_or_stdin", substitutionLocation: BINDING_TOKENS.length }]),
});

// Prompt and result bytes deliberately include binary-unsafe content: NUL,
// control bytes, quotes, backslashes, CRLF, multi-byte UTF-8, and bytes that
// are not valid UTF-8 at all. The relay must move them verbatim.
export const PROMPT_BYTES = Buffer.concat([
	Buffer.from('GENTLE_AI_REVIEW_BINDING {"lineage":"review-1d5aadacc600e167"}\n"quotes" \\backslash\r\n\u00e9\u{1F3A9}\n', "utf8"),
	Buffer.from([0x00, 0x01, 0x07, 0xff, 0xfe, 0x00]),
]);
export const PI_OUTPUT_BYTES = Buffer.concat([
	Buffer.from(`{"subject_hash":"sha256:${"a".repeat(64)}","findings":[]}\n`, "utf8"),
	Buffer.from([0x00, 0xf0, 0x9f, 0x8e, 0xa9, 0xff, 0x0d, 0x0a]),
]);

export function relayRequest(fixture: RelayHarness, overrides: Record<string, unknown> = {}) {
	return {
		captureArgumentTokens: CAPTURE_TOKENS,
		submission: SUBMISSION,
		gentleAiExecutable: fixture.gentleAi,
		piExecutable: fixture.pi,
		targetCwd: fixture.targetCwd,
		environment: {
			...fixture.environment,
			RELAY_FAKE_PROMPT_B64: PROMPT_BYTES.toString("base64"),
			RELAY_FAKE_PI_OUTPUT_B64: PI_OUTPUT_BYTES.toString("base64"),
		},
		gentleAiTimeoutMs: 30_000,
		piTimeoutMs: 30_000,
		...overrides,
	};
}

export function reviewerGroupRequests(fixture: RelayHarness): ReviewHostRelayRequest[] {
	return REVIEWER_GROUP_LENSES.map((lens, order) => relayRequest(fixture, {
		captureArgumentTokens: CAPTURE_TOKENS.map((token) => token === "--lens=review-reliability"
			? `--lens=${lens}`
			: token === "--order=0" ? `--order=${order}` : token),
		environment: {
			...fixture.environment,
			RELAY_FAKE_PROMPT_B64: PROMPT_BYTES.toString("base64"),
			RELAY_FAKE_PI_OUTPUT_B64: PI_OUTPUT_BYTES.toString("base64"),
		},
	}));
}


export async function rejectsWithRelayError(promise: Promise<unknown>, kind: string, stage: string): Promise<ReviewHostRelayError> {
	let caught: ReviewHostRelayError | undefined;
	await assert.rejects(promise, (error: unknown) => {
		assert.ok(error instanceof ReviewHostRelayError, `expected ReviewHostRelayError, received ${String(error)}`);
		caught = error;
		return error.name === "ReviewHostRelayError" && error.kind === kind && error.stage === stage;
	});
	return caught!;
}

// ---------------------------------------------------------------------------
// Handshake — every gentle-ai CLI spawn carries the compiled declaration.
// ---------------------------------------------------------------------------

