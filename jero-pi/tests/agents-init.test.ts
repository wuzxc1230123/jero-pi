import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PROMPT_PATH = "prompts/agents-init.md";

function readPackageFile(relativePath: string): string {
	return readFileSync(join(PACKAGE_ROOT, relativePath), "utf8");
}

test("agents-init prompt is a required package resource under its own name", () => {
	assert.equal(existsSync(join(PACKAGE_ROOT, PROMPT_PATH)), true);
	const source = readPackageFile("scripts/verify-package-files.mjs");
	assert.match(source, /"prompts\/agents-init\.md"/);
	assert.doesNotMatch(source, /agents-md/);
});

test("agents-init prompt keeps frontmatter contract and argument passthrough", () => {
	const prompt = readPackageFile(PROMPT_PATH);
	const frontmatter = prompt.slice(0, prompt.indexOf("---", 3));
	assert.match(frontmatter, /^description: .+AGENTS\.md/m);
	assert.match(frontmatter, /^argument-hint: "/m);
	assert.match(prompt, /\$ARGUMENTS/);
});

test("template follows agents.md-spec section priority with deep-read sections", () => {
	const prompt = readPackageFile(PROMPT_PATH);
	const sections = [
		"## 项目概览",
		"## 常用命令",
		"## 代码架构",
		"## 代码风格",
		"## 测试指引",
		"## 提交与 PR",
		"## 常见错误对照",
		"## 注意事项",
		"## 指针",
	].map((section) => prompt.indexOf(section));
	assert.ok(sections.every((index) => index >= 0), "every template section must be present");
	assert.deepEqual(sections, [...sections].sort((left, right) => left - right), "sections must appear in spec priority order");
});

test("workflow requires a two-pass read with file:line evidence", () => {
	const prompt = readPackageFile(PROMPT_PATH);
	assert.match(prompt, /第一轮 · 环境证据/);
	assert.match(prompt, /第二轮 · 代码深读/);
	assert.match(prompt, /模式采样/);
	assert.match(prompt, /`文件:行号`/);
});

test("workflow enforces the latest prompting-practice discipline", () => {
	const prompt = readPackageFile(PROMPT_PATH);
	assert.match(prompt, /环境即真理/);
	assert.match(prompt, /示例优于抽象规则/);
	assert.match(prompt, /关键约束前置/);
	assert.match(prompt, /正面表述优先/);
	assert.match(prompt, /逐字复制自来源/);
	assert.match(prompt, /单一事实源/);
});

test("evidence gathering stays local, budgeted, and layered", () => {
	const prompt = readPackageFile(PROMPT_PATH);
	assert.match(prompt, /只读本地、不联网/);
	assert.match(prompt, /总文件预算 ≤18 个/);
	assert.match(prompt, /≤80 行/);
	assert.match(prompt, /就近原则生效/);
});

test("prompts directory stays pinned to the two registered templates", () => {
	const promptsDir = join(PACKAGE_ROOT, "prompts");
	const names = readdirSync(promptsDir).sort();
	assert.deepEqual(names, ["agents-init.md", "skill-creation.md"]);
});

test("frontmatter stays single-line and parseable", () => {
	const prompt = readPackageFile(PROMPT_PATH);
	const closingFence = prompt.indexOf("---", 3);
	assert.ok(closingFence > 0, "frontmatter fence must close");
	const frontmatter = prompt.slice(4, closingFence);
	const description = frontmatter.match(/^description: (.+)$/m);
	assert.ok(description, "description key must exist");
	assert.ok(!description[1].includes("\n"), "description must stay on one line");
	assert.ok(description[1].length <= 200, "description must stay terse for the command picker");
	assert.match(frontmatter, /^argument-hint: ".*"$/m);
});

test("prompt keeps a lean context budget and a purely local evidence posture", () => {
	const prompt = readPackageFile(PROMPT_PATH);
	assert.ok(prompt.split("\n").length <= 90, "prompt itself must stay lean; it loads as command context");
	assert.doesNotMatch(prompt, /https?:\/\//, "prompt must not instruct any network fetch");
});

function assertAuditBeforeCreateContract(candidate: string) {
	assert.match(candidate, /已存在则审计修订，不存在则按模板生成/);
	assert.match(candidate, /保留用户手写内容/);
	assert.match(candidate, /仅修正过时命令、补缺失章节/);
}

test("audit-or-create branch preserves user-authored content", () => {
	const prompt = readPackageFile(PROMPT_PATH);
	assertAuditBeforeCreateContract(prompt);

	const rewriteMutation = prompt.replace(/已存在则审计修订，不存在则按模板生成/, "已存在则推倒重写");
	assert.throws(() => assertAuditBeforeCreateContract(rewriteMutation));
});

function assertCommandProvenanceContract(candidate: string) {
	assert.match(candidate, /- 构建：`<逐字命令>`（来源：<文件>；在 <目录> 运行）/);
	assert.match(candidate, /命令与代码示例逐字复制自来源，禁止手写改写/);
	assert.match(candidate, /每条命令的来源文件/);
}

test("every emitted command carries verbatim sourcing and provenance reporting", () => {
	const prompt = readPackageFile(PROMPT_PATH);
	assertCommandProvenanceContract(prompt);

	const unprovenanced = prompt.replace(/（来源：<文件>；在 <目录> 运行）/, "");
	assert.throws(() => assertCommandProvenanceContract(unprovenanced));
});

test("chinese-output contract is explicit and byte-level", () => {
	const prompt = readPackageFile(PROMPT_PATH);
	assert.match(prompt, /全文中文/);
	assert.match(prompt, /命令、路径、代码标识符逐字保留/);
});

test("report contract closes the loop on budgets and omissions", () => {
	const prompt = readPackageFile(PROMPT_PATH);
	const report = prompt.slice(prompt.indexOf("## 汇报"));
	assert.match(report, /代码采样清单/);
	assert.match(report, /显式省略的章节及原因/);
	assert.match(report, /最终行数与预算余量/);
});

test("npm files allowlist ships the prompts directory", () => {
	const manifest = JSON.parse(readPackageFile("package.json"));
	assert.ok(Array.isArray(manifest.files), "package.json must declare a files allowlist");
	assert.ok(manifest.files.includes("prompts/"), "the files allowlist must ship prompts/");
});

test("prose cross-references resolve to template sections", () => {
	const prompt = readPackageFile(PROMPT_PATH);
	const template = prompt.slice(prompt.indexOf("```text"), prompt.indexOf("```", prompt.indexOf("```text") + 7));
	for (const referenced of ["注意事项", "常见错误对照", "指针"]) {
		assert.match(template, new RegExp(`## ${referenced}`), `template must define the referenced section: ${referenced}`);
	}
});
