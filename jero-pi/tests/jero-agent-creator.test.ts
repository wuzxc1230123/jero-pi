import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const repoRoot = join(import.meta.dirname, "..");
const skillDir = join(repoRoot, "skills", "jero-agent-creator");
// 技能契约的承载面是 SKILL.md 与 assets/ 模板的并集（渐进披露）。
const skill = readFileSync(join(skillDir, "SKILL.md"), "utf8");
const reviewerTemplate = readFileSync(join(skillDir, "assets", "reviewer.template.md"), "utf8");
const designerTemplate = readFileSync(join(skillDir, "assets", "designer.template.md"), "utf8");

test("keeps the jero- prefixed identity matching its directory", () => {
	assert.match(skill, /^name: jero-agent-creator$/m);
	assert.match(skill, /^description: "触发词：/m);
});

test("role differentiation is the gate for creating an agent at all", () => {
	assert.match(skill, /代理的价值在\*\*角色与权限面不同\*\*，不在语言知识/);
	assert.match(skill, /与 `jero-worker` 同角色、只多领域知识的"执行代理"一律不做/);
	assert.match(skill, /知识进技能（`jero-skill-creator`）/);
});

test("naming discipline names every package prefix family it must not collide with", () => {
	assert.match(skill, /`jero-\*`、`review-\*`、`sdd-\*`、`jd-\*`/);
	assert.match(skill, /同名会静默遮蔽包内代理，是唯一能破坏流程的错误/);
});

test("chains and managed assets stay out of scope for zero-code creation", () => {
	assert.match(skill, /不创建、不修改任何 `\*\.chain\.md` 与包内受管资产/);
	assert.match(skill, /需进包加链（`ASSET_OWNER_BY_KEY`）/);
});

test("reviewer template is read-only and keeps the ledger output contract", () => {
	assert.match(reviewerTemplate, /^name: \{domain\}-reviewer$/m);
	assert.match(reviewerTemplate, /^  - "\*": false$/m);
	assert.match(reviewerTemplate, /jero_review_scope/);
	assert.match(reviewerTemplate, /只读评审者/);
	assert.match(reviewerTemplate, /`severity: BLOCKER \| CRITICAL \| WARNING \| SUGGESTION`/);
	assert.match(reviewerTemplate, /返回空的发现台账（零行的台账记录）——绝不跳过台账/);
});

test("designer template is read-only and proposes instead of writing code", () => {
	assert.match(designerTemplate, /^name: \{domain\}-designer$/m);
	assert.match(designerTemplate, /^  - "\*": false$/m);
	assert.match(designerTemplate, /不写实现代码/);
	assert.match(designerTemplate, /返回结构化提案：目标、方案选项（每个含取舍）、推荐与理由、风险与开放问题/);
	assert.match(designerTemplate, /不修改任何文件/);
});
