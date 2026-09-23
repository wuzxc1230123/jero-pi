import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { createJeroAuthoritySddCli } from "../../lib/jero-authority-cli.ts";
import { decodeNativeSddStatusV2 } from "../../lib/authority/client-contract.ts";
import { tempRoot } from "./fixtures.ts";

// P4c: the extension's default NativeReviewCli now serves the SDD projection
// methods in-process. The contract that matters is decodeNativeSddStatusV2
// compatibility — the extension's command paths (selection transport,
// /jero-sdd-status, the consent-gated continue) consume the record through
// that decoder unchanged.

function harness(t: { after(fn: () => void): void }): { repo: string; cli: ReturnType<typeof createJeroAuthoritySddCli> } {
	const parent = tempRoot("jero-sdd-cli-");
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
	return { repo, cli: createJeroAuthoritySddCli() };
}

test("the authority SDD adapter serves decodeNativeSddStatusV2-compatible records", async (t) => {
	const { repo, cli } = harness(t);
	const request = { workspaceRoot: repo, changeName: "add-login" };
	const status = decodeNativeSddStatusV2(await cli.sddStatus(request), request);
	assert.equal(status.changeName, "add-login");
	assert.equal(status.artifactStore, "openspec");
	assert.deepEqual(Object.keys(status.phaseInstructions ?? {}), ["apply", "verify", "remediate", "archive"]);
	const continued = decodeNativeSddStatusV2(await cli.sddContinue(request), request);
	assert.equal(continued.changeName, "add-login");
});

test("the adapter refuses typed: unknown changes, missing selection, non-repos", async (t) => {
	const { repo, cli } = harness(t);
	await assert.rejects(cli.sddContinue({ workspaceRoot: repo, changeName: "missing-change" }), /unsupported-transition/);
	await assert.rejects(cli.sddContinue({ workspaceRoot: repo }), /exact selected change/);
	await assert.rejects(cli.sddStatus({ workspaceRoot: join(repo, "not-a-repo") }), /refused to resolve/);
});
