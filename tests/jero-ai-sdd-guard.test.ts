import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
	collectSddArtifactPaths,
	evaluateSddArtifactShrink,
	readSddArtifactGuardLedger,
	recordSddArtifactWatermarks,
	renderSddShrinkReport,
	SDD_ARTIFACT_GUARD_FILE,
	SDD_ARTIFACT_GUARD_SCHEMA,
} from "../lib/jero-ai-sdd-guard.ts";

function changeRoot(t: test.TestContext): string {
	const root = mkdtempSync(join(tmpdir(), "jero-sdd-guard-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	writeFileSync(join(root, "proposal.md"), "# Proposal\n\nKeep the delta flow.\n");
	mkdirSync(join(root, "specs", "auth"), { recursive: true });
	writeFileSync(join(root, "specs", "auth", "spec.md"), "# Spec\n\nPurpose.\n");
	writeFileSync(join(root, "tasks.md"), ["## 1. Implementation", ...Array.from({ length: 16 }, (_, index) => `- [x] task ${index + 1}`), ""].join("\n"));
	return root;
}

test("watermarks cover nested artifacts deterministically and evaluate clean", (t) => {
	const root = changeRoot(t);
	assert.deepEqual(collectSddArtifactPaths(root), ["proposal.md", "specs/auth/spec.md", "tasks.md"]);
	recordSddArtifactWatermarks(root, "2026-09-25T00:00:00.000Z");
	const evaluation = evaluateSddArtifactShrink(root);
	assert.deepEqual(evaluation.shrunk, []);
	assert.equal(evaluation.evaluated, 3);

	const ledger = readSddArtifactGuardLedger(root)!;
	assert.equal(ledger.schema, SDD_ARTIFACT_GUARD_SCHEMA);
	assert.equal(ledger.recorded_at, "2026-09-25T00:00:00.000Z");
	assert.equal(ledger.artifacts["tasks.md"]!.lines, 17);
});

test("a truncated or missing watermarked artifact is flagged with exact counts", (t) => {
	const root = changeRoot(t);
	recordSddArtifactWatermarks(root);
	writeFileSync(join(root, "tasks.md"), "- [x] task 1\n- [x] task 2\n");
	rmSync(join(root, "specs", "auth", "spec.md"));
	const evaluation = evaluateSddArtifactShrink(root);
	assert.equal(evaluation.evaluated, 3);
	const byPath = new Map(evaluation.shrunk.map((finding) => [finding.path, finding]));
	assert.deepEqual(byPath.get("tasks.md"), { path: "tasks.md", watermark_lines: 17, current_lines: 2, disposition: "truncated" });
	assert.deepEqual(byPath.get("specs/auth/spec.md"), { path: "specs/auth/spec.md", watermark_lines: 3, current_lines: 0, disposition: "missing" }, "a vanished artifact is missing regardless of the watermark floor");

	const report = renderSddShrinkReport(evaluation.shrunk);
	assert.match(report, /truncated: tasks\.md — watermark 17 lines, now 2/);
	assert.match(report, /missing: specs\/auth\/spec\.md/);
	assert.match(report, /deliberate descope/);
});

test("watermarks below the minimum line floor never flag, and re-recording adopts a confirmed shrink", (t) => {
	const root = changeRoot(t);
	recordSddArtifactWatermarks(root);
	writeFileSync(join(root, "proposal.md"), "# P\n"); // watermark is 3 lines, below the floor
	let evaluation = evaluateSddArtifactShrink(root);
	assert.deepEqual(evaluation.shrunk, [], "small watermarks must not produce false positives");
	assert.equal(evaluation.evaluated, 3);

	// 用户确认收缩后的继续会重录水位：新的"最后 seen-good"是收缩后状态。
	writeFileSync(join(root, "tasks.md"), "- done\n");
	evaluation = evaluateSddArtifactShrink(root);
	assert.equal(evaluation.shrunk.length, 1, "the tall artifact shrinking to one line is exactly the catastrophic case");
	recordSddArtifactWatermarks(root);
	evaluation = evaluateSddArtifactShrink(root);
	assert.deepEqual(evaluation.shrunk, []);
	assert.equal(readSddArtifactGuardLedger(root)!.artifacts["tasks.md"]!.lines, 1);
});

test("a corrupt or foreign ledger is treated as absent, never fatal", (t) => {
	const root = changeRoot(t);
	for (const content of ["{ not json", "", JSON.stringify({ schema: "other/v9", version: 1, artifacts: {} }), JSON.stringify({ schema: SDD_ARTIFACT_GUARD_SCHEMA, version: 1, artifacts: { "tasks.md": { sha256: 1 } } })]) {
		writeFileSync(join(root, SDD_ARTIFACT_GUARD_FILE), content, "utf8");
		const evaluation = evaluateSddArtifactShrink(root);
		assert.deepEqual(evaluation.shrunk, []);
	}
	assert.equal(readSddArtifactGuardLedger(join(root, "nonexistent-root")), undefined);
	assert.equal(existsSync(join(root, SDD_ARTIFACT_GUARD_FILE)), true);
	assert.match(readFileSync(join(root, SDD_ARTIFACT_GUARD_FILE), "utf8"), /^\{/, "the last write is well-formed JSON");
});
