import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const repoRoot = join(import.meta.dirname, "..");
const skillDir = join(repoRoot, "skills", "jero-module-creator");
// 技能契约的承载面是 SKILL.md 与 assets/ 的并集（渐进披露）。
const skill = readFileSync(join(skillDir, "SKILL.md"), "utf8");
const interview = readFileSync(join(skillDir, "assets", "interview.md"), "utf8");
const skillTemplate = readFileSync(join(skillDir, "assets", "module-skill.template.md"), "utf8");
const configPins = readFileSync(join(skillDir, "assets", "config-pins.template.yaml"), "utf8");
const pack = [skill, interview, skillTemplate, configPins].join("\n\n");

test("keeps the jero- prefixed identity matching its directory", () => {
	assert.match(skill, /^name: jero-module-creator$/m);
	assert.match(skill, /^description: "触发词：/m);
});

test("pins the zero-code boundary and the no-execution-agent rule", () => {
	assert.match(skill, /产出全部落在目标项目 `\.pi\/`/);
	assert.match(skill, /零代码、不碰包内受管资产与任何 `\*\.chain\.md`/);
	assert.match(skill, /\*\*不建语言执行代理\*\*/);
	assert.match(skill, /执行用包内 `jero-worker`/);
	assert.match(skill, /评审必建、设计按需/);
});

test("gating discipline requires exact marker files and mutual exclusion", () => {
	assert.match(skill, /门控词用\*\*精确文件名\*\*（`project\.godot`、`pom\.xml`、`\*\.csproj`）/);
	assert.match(skill, /与既有模块的门控集合互斥/);
});

test("config pins only real openspec keys and commands must be verified", () => {
	assert.match(skill, /`rules\.apply\.test_command`、`rules\.verify\.test_command`、`testing\.runner\.command\/framework`、`quality\.lint\/typecheck\/format`/);
	assert.match(skill, /提示先跑 `\/jero-sdd-init`，不凭空生成整份/);
	assert.match(skill, /钉进 config 前先在目标项目实际跑通一次/);
	for (const key of ["rules:", "  apply:", "    test_command: {test_command}", "  verify:", "testing:", "  runner:", "    framework: {framework}", "quality:", "  lint: {lint_command}", "  typecheck: {typecheck_command}", "  format: {format_command}"]) {
		assert.ok(configPins.includes(key), `config-pins template must contain "${key}"`);
	}
});

test("smoke checklist stays five steps and ends with the name-collision check", () => {
	assert.match(skill, /技能计数 \+1 → `\.atl\/skill-registry\.md` 在列且 Trigger 含门控词 → 仓库技术栈问答能触发注入 → 点名委派新代理可达 → 与包内前缀族无重名/);
});

test("naming follows one domain token across skill and agents", () => {
	assert.match(interview, /定一个领域词元（一个词：`godot`、`java`、`cs`）/);
	assert.match(interview, /技能名 = 词元（`\.pi\/skills\/godot\/`），代理名 = `词元-角色`（`godot-reviewer`、`godot-designer`）/);
	assert.match(interview, /禁用近义词干/);
	assert.match(skillTemplate, /^name: \{domain\}$/m);
	assert.match(skillTemplate, /委派 `\{domain\}-designer` 产出提案/);
	assert.match(skillTemplate, /追加委派 `\{domain\}-reviewer`/);
	assert.match(skillTemplate, /不建语言执行代理/);
});

test("no mixed-stem regression inside the module-creator pack", () => {
	assert.doesNotMatch(pack, /game-designer|godot-cs|jero-unity/);
});

test("skill-creator hands module and agent requests off to the creators", () => {
	const skillCreator = readFileSync(join(repoRoot, "skills", "skill-creator", "SKILL.md"), "utf8");
	assert.match(skillCreator, /整套领域模块（技能 \+ 子代理 \+ 命令钉住）\s*\|\s*转交 `jero-module-creator`（`\/module-creation`）/);
	assert.match(skillCreator, /单个项目级子代理\s*\|\s*转交 `jero-agent-creator`（`\/agent-creation`）/);
});
