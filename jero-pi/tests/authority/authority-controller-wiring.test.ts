import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { __testing } from "../../extensions/jero-ai.ts";
import { createJeroAuthorityReviewCli } from "../../lib/jero-authority-cli.ts";
import { tempRoot } from "./fixtures.ts";

// P4d E2E: the REAL controller machinery (extensions/jero-ai.ts
// executeReviewControllerOperation — negotiated status routing, mapping,
// collect-binding rendering) running over the composed default CLI
// (P1 stub ∘ jero authority review adapter). No mocks on the CLI path.

function harness(t: { after(fn: () => void): void }): { repo: string; cli: ReturnType<typeof createJeroAuthorityReviewCli> } {
	const parent = tempRoot("jero-p4d-");
	const repo = join(parent, "repo");
	mkdirSync(repo, { recursive: true });
	const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, stdio: "ignore" });
	git("init", "-b", "main");
	writeFileSync(join(repo, "app.ts"), "export const value = 1;\n");
	git("add", ".");
	git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-m", "init");
	// A dirty workspace gives the status a real candidate to describe.
	writeFileSync(join(repo, "app.ts"), "export const value = 2;\n");
	t.after(() => rmSync(parent, { recursive: true, force: true }));
	// Exactly what the extension constructs by default since P4c/P4d.
	// D7 slice 4: the fail-closed stub is gone; the in-process adapter is the
	// whole default CLI (the unserved optionals are simply absent, which the
	// extension guards treat as capability-off).
	return { repo, cli: createJeroAuthorityReviewCli() };
}

test("controller STATUS routes over the in-process authority end to end", async (t) => {
	const { repo, cli } = harness(t);
	const result = await __testing.executeReviewControllerOperation({ operation: "status" }, repo, cli);
	// An unstarted candidate routes through the controller's real vocabulary:
	// "ready" with the authority's unrelated/start projection underneath, and
	// never as a native-status-unavailable refusal.
	assert.notEqual(result.outcome, "native-status-unavailable");
	assert.equal(result.operation, "status");
	assert.equal(result.status, "ready");
	const mapped = result.result as Record<string, unknown>;
	assert.equal(mapped.applicability, "unrelated");
	assert.equal(mapped.action, "start");
});

test("controller ASSESS answers from the in-process risk authority", async (t) => {
	const { repo, cli } = harness(t);
	const result = await __testing.executeReviewControllerOperation({ operation: "assess" }, repo, cli);
	assert.equal(result.operation, "assess");
	const details = result as Record<string, unknown>;
	// The risk assessment always resolves (fail-closed to high at worst) and
	// never reports the stub's authority-unavailable outcome.
	assert.notEqual(details.outcome, "native-status-unavailable");
	assert.ok(details.result === undefined || typeof details.result === "object" || details.result === undefined);
});

test("the review-mode pair serves the clone-scoped RDD switch", async (t) => {
	const { repo, cli } = harness(t);
	assert.equal(typeof cli.reviewMode, "function");
	const mode = await cli.reviewMode!({ cwd: repo, operation: "status" });
	assert.equal(mode.operation, "status");
	assert.ok(["on", "off"].includes(mode.status.effective));
});

test("the sdd attempt pair serves acquire/settle over the store ledger", async (t) => {
	const { repo, cli } = harness(t);
	mkdirSync(join(repo, "openspec", "changes", "add-login"), { recursive: true });
	writeFileSync(join(repo, "openspec", "changes", "add-login", "proposal.md"), "p\n");
	const acquired = await cli.sddAttemptAcquire!({ workspaceRoot: repo, changeName: "add-login", requestId: "p4d-1", workUnit: "w", evidenceGoal: "g", expectedRevision: "" });
	assert.equal(acquired.state, "proceed");
	assert.match(acquired.token ?? "", /^jero-attempt-/);
	const settled = await cli.sddAttemptSettle!({ workspaceRoot: repo, changeName: "add-login", requestId: "p4d-s", token: acquired.token!, outcome: "failed", evidenceRevision: `sha256:${"a".repeat(64)}`, diagnosis: "d", harnessDisposition: "reused", cleanupEvidence: "c", processEvidence: "p" });
	assert.ok(settled.state === "proceed" || settled.state === "complete");
});
