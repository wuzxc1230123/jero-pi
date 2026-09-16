import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { jeroSddStatusV1 } from "../../lib/authority/sdd-status.ts";
import { jeroSddContinueV1 } from "../../lib/authority/sdd-continue.ts";
import { resolveJeroAuthorityContextV1, type JeroAuthorityContextV1 } from "../../lib/authority/review.ts";
import { tempRoot } from "./fixtures.ts";

function openspecHarness(t: { after(fn: () => void): void }): { repo: string; context: JeroAuthorityContextV1 } {
	const parent = tempRoot("jero-sdd-status-");
	const repo = join(parent, "repo");
	mkdirSync(repo, { recursive: true });
	const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, stdio: "ignore" });
	git("init", "-b", "main");
	writeFileSync(join(repo, "README.md"), "x\n");
	git("add", ".");
	git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-m", "init");
	const change = join(repo, "openspec", "changes", "add-login");
	mkdirSync(change, { recursive: true });
	writeFileSync(join(change, "proposal.md"), "# Proposal\n");
	t.after(() => rmSync(parent, { recursive: true, force: true }));
	const resolution = resolveJeroAuthorityContextV1(repo);
	if (resolution.kind !== "ok") throw new Error(`resolve refused: ${resolution.code}`);
	return { repo, context: resolution.context };
}

test("sdd status projects the openspec tree into the v2 wire shape with self-checks green", (t) => {
	const { repo, context } = openspecHarness(t);
	const result = jeroSddStatusV1(context, { workspaceRoot: repo, changeName: "add-login" });
	assert.equal(result.kind, "ok");
	if (result.kind !== "ok") return;
	const { status } = result;
	assert.equal(status.schemaName, "gentle-ai.sdd-status");
	assert.equal(status.schemaVersion, 2);
	assert.equal(status.changeName, "add-login");
	assert.equal(status.artifactStore, "openspec");
	assert.equal(status.planningHome.mode, "repo-local");
	assert.equal(status.planningHome.path, join(repo, "openspec"));
	assert.equal(status.actionContext.workspaceRoot, repo);
	assert.ok(status.actionContext.allowedEditRoots.includes(repo));
	assert.deepEqual(Object.keys(status.dependencies), ["proposal", "specs", "design", "tasks", "apply", "verify", "archive"]);
	assert.equal(typeof status.nextRecommended, "string");
	// The legacy `instructions` channel must never appear on the projected record.
	assert.equal("instructions" in status, false);
});

test("sdd status without an openspec tree stays non-authoritative with the engram planning home rule honored", (t) => {
	const parent = tempRoot("jero-sdd-status-none-");
	const repo = join(parent, "repo");
	mkdirSync(repo, { recursive: true });
	const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, stdio: "ignore" });
	git("init", "-b", "main");
	writeFileSync(join(repo, "README.md"), "x\n");
	git("add", ".");
	git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-m", "init");
	t.after(() => rmSync(parent, { recursive: true, force: true }));
	const resolution = resolveJeroAuthorityContextV1(repo);
	if (resolution.kind !== "ok") throw new Error("resolve refused");
	const result = jeroSddStatusV1(resolution.context, { workspaceRoot: repo });
	assert.equal(result.kind, "ok");
	if (result.kind !== "ok") return;
	assert.equal(result.isNonAuthoritative, true);
	// store none: the planning home is still the openspec join (the literal
	// "engram:sdd" is reserved for engram/hybrid stores).
	assert.equal(result.status.planningHome.path, join(repo, "openspec"));
});

test("sdd status refuses a relative workspaceRoot typed", (t) => {
	const { context } = openspecHarness(t);
	const refused = jeroSddStatusV1(context, { workspaceRoot: "relative/path" });
	assert.equal(refused.kind, "refused");
	if (refused.kind === "refused") assert.equal(refused.code, "invalid-request");
});

test("sdd continue requires an exact change and refuses archived or unknown changes", (t) => {
	const { repo, context } = openspecHarness(t);
	const ok = jeroSddContinueV1(context, { workspaceRoot: repo, changeName: "add-login" });
	assert.equal(ok.kind, "ok");
	const unknown = jeroSddContinueV1(context, { workspaceRoot: repo, changeName: "not-a-change" });
	assert.equal(unknown.kind, "refused");
	if (unknown.kind === "refused") assert.equal(unknown.code, "unsupported-transition");
	const blank = jeroSddContinueV1(context, { workspaceRoot: repo, changeName: " padded " });
	assert.equal(blank.kind, "refused");
	if (blank.kind === "refused") assert.equal(blank.code, "invalid-request");
});
