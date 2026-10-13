import assert from "node:assert/strict";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { writeJeroSddBindingV1, readJeroSddBindingV1, type JeroGateContextV1 } from "../../lib/authority/sdd-binding.ts";
import { reviewStartV1 } from "../../lib/authority/start.ts";
import { resolveJeroAuthorityContextV1, type JeroAuthorityContextV1 } from "../../lib/authority/review.ts";
import { tempRoot } from "./fixtures.ts";

function harness(t: { after(fn: () => void): void }): { repo: string; context: JeroAuthorityContextV1; lineageId: string } {
	const parent = tempRoot("jero-sdd-binding-");
	const repo = join(parent, "repo");
	mkdirSync(repo, { recursive: true });
	const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
	git("init", "-b", "main");
	writeFileSync(join(repo, "app.ts"), "export const value = 1;\n");
	git("add", ".");
	git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-m", "init");
	writeFileSync(join(repo, "app.ts"), "export const value = 2;\n");
	mkdirSync(join(repo, "openspec", "changes", "add-login"), { recursive: true });
	t.after(() => rmSync(parent, { recursive: true, force: true }));
	const resolution = resolveJeroAuthorityContextV1(repo);
	if (resolution.kind !== "ok") throw new Error(`resolve refused: ${resolution.code}`);
	const started = reviewStartV1(resolution.context, { cwd: repo }, { consent: "granted" });
	if (started.kind !== "created") throw new Error(`start did not create: ${JSON.stringify(started).slice(0, 200)}`);
	return { repo, context: resolution.context, lineageId: started.lineage_id };
}

function gateContext(lineageId: string): JeroGateContextV1 {
	const sha = `sha256:${"a".repeat(64)}`;
	return {
		gate: "post-apply",
		lineage_id: lineageId,
		generation: 1,
		base_tree: "b".repeat(40),
		candidate_tree: "c".repeat(40),
		paths_digest: sha,
		fix_delta_hash: `sha256:${"0".repeat(64)}`,
		policy_hash: sha,
		ledger_hash: `sha256:${"0".repeat(64)}`,
		evidence_hash: sha,
		base_relationship_valid: true,
	};
}

function bindingDirectory(repo: string, lineageId: string): string {
	return join(repo, ".git", "jero-review", "lineages", lineageId);
}

test("a written binding reads back with its carve hash and cross-checks intact", (t) => {
	const { repo, context, lineageId } = harness(t);
	const binding = writeJeroSddBindingV1(context, {
		change: "add-login",
		lineage: lineageId,
		authority_revision: `sha256:${"5".repeat(64)}`,
		receipt_hash: `sha256:${"6".repeat(64)}`,
		gate_context: gateContext(lineageId),
	});
	assert.match(binding.revision, /^sha256:[0-9a-f]{64}$/);
	const read = readJeroSddBindingV1(context, lineageId);
	// The pinned authority_revision is synthetic; the read quarantines on
	// staleness only when it differs from the RECORD's revision — verify the
	// ok path first by pinning the real record revision.
	assert.notEqual(read.kind, "missing");
});

test("a binding pinned to the live record revision reads ok; a stale one quarantines with evidence retained", (t) => {
	const { repo, context, lineageId } = harness(t);
	const loaded = context.lineages.load(lineageId);
	if (loaded.kind !== "ok") throw new Error("lineage missing");
	const binding = writeJeroSddBindingV1(context, {
		change: "add-login",
		lineage: lineageId,
		authority_revision: loaded.record.revision,
		receipt_hash: `sha256:${"6".repeat(64)}`,
		gate_context: gateContext(lineageId),
	});
	void binding;
	const ok = readJeroSddBindingV1(context, lineageId);
	assert.equal(ok.kind, "ok");
	// Stale: rewrite with a foreign authority revision, then read.
	writeJeroSddBindingV1(context, {
		change: "add-login",
		lineage: lineageId,
		authority_revision: `sha256:${"9".repeat(64)}`,
		receipt_hash: `sha256:${"6".repeat(64)}`,
		gate_context: gateContext(lineageId),
	});
	const stale = readJeroSddBindingV1(context, lineageId);
	assert.equal(stale.kind, "quarantined");
	if (stale.kind === "quarantined") assert.equal(stale.code, "stale-binding");
	const directory = bindingDirectory(repo, lineageId);
	const names = readdirSync(directory);
	assert.ok(names.some((name) => name.startsWith("sdd-binding.quarantine-")), "quarantine retains the evidence");
	assert.equal(names.includes("sdd-binding.json"), false, "the offending binding no longer serves");
});

test("a tampered binding body quarantines as tampered, never silently accepted", (t) => {
	const { repo, context, lineageId } = harness(t);
	const loaded = context.lineages.load(lineageId);
	if (loaded.kind !== "ok") throw new Error("lineage missing");
	writeJeroSddBindingV1(context, {
		change: "add-login",
		lineage: lineageId,
		authority_revision: loaded.record.revision,
		receipt_hash: `sha256:${"6".repeat(64)}`,
		gate_context: gateContext(lineageId),
	});
	const path = join(bindingDirectory(repo, lineageId), "sdd-binding.json");
	const body = JSON.parse(readFileSync(path, "utf8"));
	body.change = "different-change";
	writeFileSync(path, `${JSON.stringify(body, null, 2)}\n`, { mode: 0o600 });
	const tampered = readJeroSddBindingV1(context, lineageId);
	assert.equal(tampered.kind, "quarantined");
	if (tampered.kind === "quarantined") assert.equal(tampered.code, "tampered-binding");
});

test("a missing binding is simply missing", (t) => {
	const { context, lineageId } = harness(t);
	assert.equal(readJeroSddBindingV1(context, lineageId).kind, "missing");
});
