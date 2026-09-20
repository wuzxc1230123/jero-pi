import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const guidancePaths = [
	"assets/support/sdd-status-contract.md",
	"assets/sdd-orchestrator-workflow.md",
	"assets/agents/sdd-status.md",
	"assets/agents/sdd-verify.md",
	"assets/agents/sdd-archive.md",
];

for (const path of guidancePaths) {
	test(`${path}: native v2 status remains read-only and authoritative`, () => {
		const guidance = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
		assert.match(guidance, /native.*(?:status|v2)|gentle-ai\.sdd-status/i);
		assert.match(guidance, /只读/);
		assert.doesNotMatch(guidance, /resolve-via-engram/i);
		assert.doesNotMatch(guidance, /local SDD status engine|manual (?:fallback )?status|reconstruct(?:ing)? (?:native )?status/i);
	});
}

test("workflow preserves explicit continuation and the manual sync resolver", () => {
	const workflow = readFileSync(new URL("../assets/sdd-orchestrator-workflow.md", import.meta.url), "utf8");
	assert.match(workflow, /仅显式授权的 `\/jero-sdd-continue` 可以解析延续/);
	assert.match(workflow, /手工 sdd-sync/);
	assert.doesNotMatch(workflow, /sdd-(?:apply|verify|archive).*local|local.*sdd-(?:apply|verify|archive)/i);
});
