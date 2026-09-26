import assert from "node:assert/strict";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { acquireJeroSddAttemptV1, settleJeroSddAttemptV1 } from "../../lib/authority/sdd-attempt.ts";
import { resolveJeroAuthorityContextV1, type JeroAuthorityContextV1 } from "../../lib/authority/review.ts";
import { tempRoot } from "./fixtures.ts";

function harness(t: { after(fn: () => void): void }): { repo: string; context: JeroAuthorityContextV1 } {
	const parent = tempRoot("jero-sdd-attempt-");
	const repo = join(parent, "repo");
	mkdirSync(repo, { recursive: true });
	const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, stdio: "ignore" });
	git("init", "-b", "main");
	writeFileSync(join(repo, "README.md"), "x\n");
	git("add", ".");
	git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-m", "init");
	mkdirSync(join(repo, "openspec", "changes", "add-login"), { recursive: true });
	t.after(() => rmSync(parent, { recursive: true, force: true }));
	const resolution = resolveJeroAuthorityContextV1(repo);
	if (resolution.kind !== "ok") throw new Error(`resolve refused: ${resolution.code}`);
	return { repo, context: resolution.context };
}

const EVIDENCE = `sha256:${"a".repeat(64)}`;
const acquireBase = { changeName: "add-login", workUnit: "implement login", evidenceGoal: "tests pass" };
const settleBase = { changeName: "add-login", diagnosis: "tests failed", harnessDisposition: "reused" as const, cleanupEvidence: "clean", processEvidence: "ran" };

test("acquire validates the upstream field matrix fail-closed", (t) => {
	const { repo, context } = harness(t);
	const cases: Array<[string, Record<string, unknown>]> = [
		["requestId regex", { requestId: "Bad ID!" }],
		["requestId length", { requestId: "a".repeat(129) }],
		["workUnit bound", { requestId: "r1", workUnit: "w".repeat(161) }],
		["evidenceGoal bound", { requestId: "r1", workUnit: "w", evidenceGoal: "g".repeat(241) }],
		["maxAttempts low", { requestId: "r1", workUnit: "w", evidenceGoal: "g", maxAttempts: 0 }],
		["maxAttempts high", { requestId: "r1", workUnit: "w", evidenceGoal: "g", maxAttempts: 101 }],
		["maxChangedLines high", { requestId: "r1", workUnit: "w", evidenceGoal: "g", maxChangedLines: 1_000_001 }],
		["expectedRevision format", { requestId: "r1", workUnit: "w", evidenceGoal: "g", expectedRevision: "not-a-sha" }],
		["relative workspaceRoot", { workspaceRoot: "relative/path", requestId: "r1", workUnit: "w", evidenceGoal: "g" }],
		["exclude with paths", { requestId: "r1", workUnit: "w", evidenceGoal: "g", untrackedScope: "exclude", intendedUntracked: ["a"] }],
		["escaping untracked path", { requestId: "r1", workUnit: "w", evidenceGoal: "g", untrackedScope: "select", intendedUntracked: ["../escape"] }],
		["duplicate untracked paths", { requestId: "r1", workUnit: "w", evidenceGoal: "g", untrackedScope: "select", intendedUntracked: ["a", "a"] }],
	];
	for (const [label, override] of cases) {
		const refused = acquireJeroSddAttemptV1(context, { workspaceRoot: repo, ...acquireBase, ...override } as never);
		assert.equal(refused.kind, "refused", label);
		if (refused.kind === "refused") assert.equal(refused.code, "invalid-request", label);
	}
});

test("acquire proceeds once, blocks with the live identity, and replays by request id and token", (t) => {
	const { repo, context } = harness(t);
	const first = acquireJeroSddAttemptV1(context, { workspaceRoot: repo, ...acquireBase, requestId: "acq-1", expectedRevision: "" });
	assert.equal(first.kind, "result");
	if (first.kind !== "result") return;
	assert.equal(first.state, "proceed");
	assert.match(first.token ?? "", /^jero-attempt-/);
	const blocked = acquireJeroSddAttemptV1(context, { workspaceRoot: repo, ...acquireBase, requestId: "acq-2" });
	assert.deepEqual(
		blocked.kind === "result" ? { state: blocked.state, reason: blocked.reason, existing: blocked.existing } : blocked,
		{ state: "blocked", reason: "managed-actor-live", existing: { requestId: "acq-1", workUnit: "implement login" } },
	);
	const idReplay = acquireJeroSddAttemptV1(context, { workspaceRoot: repo, ...acquireBase, requestId: "acq-1", expectedRevision: "" });
	assert.equal(idReplay.kind === "result" && idReplay.state, "proceed");
	const tokenReplay = acquireJeroSddAttemptV1(context, { workspaceRoot: repo, ...acquireBase, requestId: "acq-3", token: first.token });
	assert.equal(tokenReplay.kind === "result" && tokenReplay.state, "proceed");
	const tokenUnknown = acquireJeroSddAttemptV1(context, { workspaceRoot: repo, ...acquireBase, requestId: "acq-4", token: "bogus-token" });
	assert.equal(tokenUnknown.kind === "refused" && tokenUnknown.code, "token-unknown");
});

test("expectedRevision pins the ledger revision fail-closed", (t) => {
	const { repo, context } = harness(t);
	const refused = acquireJeroSddAttemptV1(context, { workspaceRoot: repo, ...acquireBase, requestId: "r", expectedRevision: EVIDENCE });
	assert.equal(refused.kind, "refused");
	if (refused.kind === "refused") assert.equal(refused.code, "stale-expected-revision");
});

test("settle enforces the upstream evidence pairing and single finalization, retaining untracked scope verbatim", (t) => {
	const { repo, context } = harness(t);
	const acquired = acquireJeroSddAttemptV1(context, {
		workspaceRoot: repo, ...acquireBase, requestId: "acq-1", expectedRevision: "",
		untrackedScope: "select", intendedUntracked: ["notes/draft.md", "tmp/scratch.txt"],
	});
	if (acquired.kind !== "result" || acquired.state !== "proceed") throw new Error("acquire did not proceed");
	const token = acquired.token!;
	const pairing: Array<[string, Record<string, unknown>]> = [
		["interrupted with evidence", { outcome: "interrupted", evidenceRevision: EVIDENCE }],
		["interrupted with remediation evidence", { outcome: "interrupted", remediationEvidence: "re" }],
		["failed without evidence", { outcome: "failed" }],
		["passed without any evidence", { outcome: "passed" }],
		["bad harness disposition", { outcome: "failed", evidenceRevision: EVIDENCE, harnessDisposition: "lost" }],
	];
	for (const [label, override] of pairing) {
		const refused = settleJeroSddAttemptV1(context, { workspaceRoot: repo, ...settleBase, requestId: "s-0", token, untrackedScope: "select", intendedUntracked: ["notes/draft.md", "tmp/scratch.txt"], ...override } as never);
		assert.equal(refused.kind, "refused", label);
		if (refused.kind === "refused") assert.equal(refused.code, "invalid-request", label);
	}
	const wrongToken = settleJeroSddAttemptV1(context, { workspaceRoot: repo, ...settleBase, requestId: "s-2", token: "bogus", outcome: "interrupted", untrackedScope: "select", intendedUntracked: ["notes/draft.md", "tmp/scratch.txt"] });
	assert.equal(wrongToken.kind === "refused" && wrongToken.code, "token-mismatch");
	// R4 漂移：settle 声明必须逐字重放 acquire 冻结的三元组。
	const drifted = settleJeroSddAttemptV1(context, { workspaceRoot: repo, ...settleBase, requestId: "s-3", token, outcome: "failed", evidenceRevision: EVIDENCE, untrackedScope: "select", intendedUntracked: ["other/path.md"] });
	assert.equal(drifted.kind === "refused" && drifted.code, "untracked-scope-drift");
	const omitted = settleJeroSddAttemptV1(context, { workspaceRoot: repo, ...settleBase, requestId: "s-4", token, outcome: "failed", evidenceRevision: EVIDENCE });
	assert.equal(omitted.kind === "refused" && omitted.code, "untracked-scope-drift");
	const settled = settleJeroSddAttemptV1(context, {
		workspaceRoot: repo, ...settleBase, requestId: "s-1", token,
		outcome: "failed", evidenceRevision: EVIDENCE,
		untrackedScope: "select", intendedUntracked: ["notes/draft.md", "tmp/scratch.txt"],
	});
	assert.equal(settled.kind === "result" && settled.state, "proceed");
	const replay = settleJeroSddAttemptV1(context, { workspaceRoot: repo, ...settleBase, requestId: "s-1", token, outcome: "failed", evidenceRevision: EVIDENCE, untrackedScope: "select", intendedUntracked: ["notes/draft.md", "tmp/scratch.txt"] });
	assert.deepEqual(replay.kind === "result" ? { state: replay.state, reason: replay.reason } : replay, { state: "complete", reason: "attempt already settled failed" });
	// R4 + R2 on disk: verbatim scope, no plaintext token.
	const attemptsDir = join(repo, ".git", "jero-review", "sdd-attempts");
	const ledgerFile = readdirSync(attemptsDir).find((name) => name.endsWith(".json"))!;
	const ledger = JSON.parse(readFileSync(join(attemptsDir, ledgerFile), "utf8"));
	assert.deepEqual(ledger.attempts[0].settlement.settled_untracked, ["notes/draft.md", "tmp/scratch.txt"]);
	assert.equal(JSON.stringify(ledger).includes(token), false, "the plaintext token must never persist");
	assert.equal(ledger.attempts[0].token_hash.length, 64);
});

test("passed settle accepts remediation evidence alone and an envelope whose evidence_revision matches", (t) => {
	const { repo, context } = harness(t);
	const acquired = acquireJeroSddAttemptV1(context, { workspaceRoot: repo, ...acquireBase, requestId: "acq-1", expectedRevision: "" });
	if (acquired.kind !== "result" || acquired.state !== "proceed") throw new Error("acquire did not proceed");
	const viaRemediation = settleJeroSddAttemptV1(context, { workspaceRoot: repo, ...settleBase, requestId: "s-1", token: acquired.token, outcome: "passed", remediationEvidence: "remediated via focused tests" });
	assert.equal(viaRemediation.kind === "result" && viaRemediation.state, "proceed");
	const acquired2 = acquireJeroSddAttemptV1(context, { workspaceRoot: repo, ...acquireBase, requestId: "acq-2" });
	if (acquired2.kind !== "result" || acquired2.state !== "proceed") throw new Error("second acquire did not proceed");
	const envelope: import("../../lib/authority/protocol.ts").JeroVerifyResultV1 = {
		schema: "jero.verify-result/v1", evidence_revision: EVIDENCE, verdict: "pass", blockers: 0, critical_findings: 0,
		requirements: "4/4", scenarios: "2/2", test_command: "pnpm test", test_exit_code: 0, test_output_hash: EVIDENCE,
		build_command: "pnpm build", build_exit_code: 0, build_output_hash: EVIDENCE,
	};
	const mismatch = settleJeroSddAttemptV1(context, { workspaceRoot: repo, ...settleBase, requestId: "s-2", token: acquired2.token, outcome: "passed", evidenceRevision: `sha256:${"b".repeat(64)}`, verifyResult: envelope });
	assert.equal(mismatch.kind, "refused");
	if (mismatch.kind === "refused") assert.match(mismatch.detail, /evidence_revision/);
	const matched = settleJeroSddAttemptV1(context, { workspaceRoot: repo, ...settleBase, requestId: "s-3", token: acquired2.token, outcome: "passed", evidenceRevision: EVIDENCE, verifyResult: envelope });
	assert.equal(matched.kind === "result" && matched.state, "proceed");
});

test("the attempt budget exhausts to complete, never silently", (t) => {
	const { repo, context } = harness(t);
	const first = acquireJeroSddAttemptV1(context, { workspaceRoot: repo, ...acquireBase, requestId: "a1", expectedRevision: "", maxAttempts: 1 });
	if (first.kind !== "result" || first.state !== "proceed") throw new Error("first acquire did not proceed");
	const settled = settleJeroSddAttemptV1(context, { workspaceRoot: repo, ...settleBase, requestId: "s1", token: first.token, outcome: "failed", evidenceRevision: EVIDENCE });
	assert.deepEqual(settled.kind === "result" ? { state: settled.state, reason: settled.reason } : settled, { state: "complete", reason: "attempt budget exhausted" });
	const exhausted = acquireJeroSddAttemptV1(context, { workspaceRoot: repo, ...acquireBase, requestId: "a2", maxAttempts: 1 });
	assert.deepEqual(exhausted.kind === "result" ? { state: exhausted.state, reason: exhausted.reason } : exhausted, { state: "complete", reason: "attempt budget exhausted" });
});

test("a corrupted ledger refuses fail-closed", (t) => {
	const { repo, context } = harness(t);
	acquireJeroSddAttemptV1(context, { workspaceRoot: repo, ...acquireBase, requestId: "a1", expectedRevision: "" });
	const attemptsDir = join(repo, ".git", "jero-review", "sdd-attempts");
	const ledgerFile = join(attemptsDir, readdirSync(attemptsDir).find((name) => name.endsWith(".json"))!);
	writeFileSync(ledgerFile, "{ broken", { mode: 0o600 });
	const refused = acquireJeroSddAttemptV1(context, { workspaceRoot: repo, ...acquireBase, requestId: "a2" });
	assert.equal(refused.kind, "refused");
	if (refused.kind === "refused") assert.equal(refused.code, "ledger-corrupted");
});
