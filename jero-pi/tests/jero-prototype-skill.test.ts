import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const ROOT = join(import.meta.dirname, "..");

test("jero-prototype skill carries the prototype contract", () => {
	const skill = readFileSync(join(ROOT, "skills/jero-prototype/SKILL.md"), "utf8");
	assert.match(skill, /^name: jero-prototype$/m);
	// 一次性纪律：答案回流，本体归档，绝不进 main。
	assert.match(skill, /唯一产出是答案/);
	assert.match(skill, /prototype\/<name>` 分支/);
	assert.match(skill, /绝不进 main/);
	assert.match(skill, /默认无持久化/);
	assert.match(skill, /零打磨/);
	// 分支二选一与渐进披露：细则在 references，正文只留判定表。
	assert.match(skill, /references\/LOGIC\.md/);
	assert.match(skill, /references\/UI\.md/);
	// 不是 SDD 阶段：不进状态权威、不改依赖图。
	assert.match(skill, /不是 SDD 阶段/);
	assert.match(skill, /jero-ai\.sdd-status\/v2/);
});

test("jero-prototype references carry the branch playbooks", () => {
	const logic = readFileSync(join(ROOT, "skills/jero-prototype/references/LOGIC.md"), "utf8");
	assert.match(logic, /可整体吊走的纯模块/);
	assert.match(logic, /无 DOM、无 `document`/);
	assert.match(logic, /想法里的 bug/);
	const ui = readFileSync(join(ROOT, "skills/jero-prototype/references/UI.md"), "utf8");
	assert.match(ui, /\?variant=/);
	assert.match(ui, /结构必须迥异/);
	assert.match(ui, /生产构建隐藏/);
});

test("router and reference name jero-prototype (router must not lie)", () => {
	const router = readFileSync(join(ROOT, "skills/jero-skills/SKILL.md"), "utf8");
	assert.match(router, /jero-prototype/);
	const reference = readFileSync(join(ROOT, "docs/jero-reference.md"), "utf8");
	assert.match(reference, /jero-prototype/);
});

test("package gate lists every jero-prototype file", () => {
	const gate = readFileSync(join(ROOT, "scripts/verify-package-files.mjs"), "utf8");
	for (const path of [
		"skills/jero-prototype/SKILL.md",
		"skills/jero-prototype/references/LOGIC.md",
		"skills/jero-prototype/references/UI.md",
	]) {
		assert.ok(gate.includes(`"${path}"`), `verify-package-files must list ${path}`);
	}
});
