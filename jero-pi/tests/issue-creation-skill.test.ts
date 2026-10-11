import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const repoRoot = join(import.meta.dirname, "..");
// 技能正文按渐进披露拆分后，契约的承载面是 SKILL.md 与 references/ 的并集。
const skill = [
	readFileSync(join(repoRoot, "skills", "issue-creation", "SKILL.md"), "utf8"),
	readFileSync(join(repoRoot, "skills", "issue-creation", "references", "yaml-forms.md"), "utf8"),
	readFileSync(join(repoRoot, "skills", "issue-creation", "references", "private-body-files.md"), "utf8"),
].join("\n\n");

test("preserves the prefixed skill identity and complete Issue Form metadata", () => {
	assert.match(skill, /^name: jero-issue-creation$/m);
	assert.match(skill, /^description: ".+"$/m);
	assert.match(skill, /^  version: "1\.5"$/m);
});

test("makes YAML Issue Forms the deterministic automated format authority", () => {
	assert.match(skill, /以 YAML Issue 表单（YAML Issue Forms）为格式权威/);
	assert.match(skill, /`input`、`textarea`、`dropdown` 与 `checkboxes`/);
	assert.match(skill, /declared order/i);
	assert.match(skill, /保留可见标签与选项/);
	assert.match(skill, /多选按声明选项顺序保留所选/);
	assert.match(skill, /可选 dropdown[\s\S]{0,180}_No response_/i);
	assert.match(skill, /Markdown 控件是非作答指引/);
	assert.match(skill, /相邻答案[\s\S]{0,180}可见指示/);
	assert.match(skill, /不把它们渲染为回答小节/);
	assert.match(skill, /逐项强制必填复选框/);
	assert.match(skill, /显式的第一人称确认/);
	assert.match(skill, /textarea\.attributes\.render/);
	assert.match(skill, /用声明的语言为答案加栅栏/);
});

test("fails closed before publication for invalid required Issue Form data", () => {
	assert.match(skill, /在变更前保守失败/);
	assert.match(skill, /畸形、不支持、缺失或歧义的必需结构或答案/);
	assert.match(skill, /畸形的 schema[\s\S]{0,200}不打开浏览器/);
	assert.match(skill, /绝不虚构答案、选择、确认或标签/);
});

function assertCheckboxAttestationContract(candidate: string) {
	assert.match(candidate, /代理必须主动完成查重搜索.*保留.*证据/);
	assert.match(candidate, /代理必须.*确切正文.*隐私扫描\/脱敏.*保留/);
	assert.match(candidate, /只能显式证明自己有证据支撑的工作.*绝不把其行动归到用户名下/);
	assert.match(candidate, /个人事实、同意、法律声明.*显式的用户确认/);
	assert.match(candidate, /绝不批量勾选复选框/);
	assert.match(candidate, /发布请求不确认任何复选框/);
}

test("attests only agent-verifiable checkbox work and preserves human declarations", () => {
	assertCheckboxAttestationContract(skill);

	const missingEvidence = skill.replace(/保留/g, "跳过");
	assert.throws(() => assertCheckboxAttestationContract(missingEvidence));

	const userOnlyDeclaration = skill.replace(
		/个人事实、同意、法律声明.*显式的用户确认/,
		"个人事实、同意、法律声明可以从发布请求中推断",
	);
	assert.throws(() => assertCheckboxAttestationContract(userOnlyDeclaration));
});

test("publishes reviewed Issue Form bodies through a private body file", () => {
	assert.match(skill, /private `BODY_FILE`/);
	assert.match(skill, /gh issue create --repo "\$TARGET" --title "\$TITLE" --body-file "\$BODY_FILE"/);
	assert.match(skill, /target verification/i);
	assert.match(skill, /duplicate search/i);
	assert.match(skill, /对已确认重复项评论之前[\s\S]{0,250}确切评论正文[\s\S]{0,250}隐私扫描\/脱敏/);
	assert.match(skill, /privacy scan/i);
	assert.match(skill, /permitted labels/i);
	assert.match(skill, /one mutation attempt/i);
	assert.match(skill, /target-host read-back/i);
});

function assertBrowserContract(candidate: string) {
	assert.match(candidate, /gh issue create --repo "\$TARGET" --title "\$TITLE" --body-file "\$BODY_FILE"/);
	assert.match(
		candidate,
		/用户显式要求浏览器补全[\s\S]{0,350}无法被自动化路径安全\/忠实地表示/,
	);
	assert.match(candidate, /畸形的 schema[\s\S]{0,200}不打开浏览器/);
	assert.match(candidate, /缺失\/歧义的必需答案[\s\S]{0,200}保守失败[\s\S]{0,200}不打开浏览器/);
	assert.match(candidate, /browser handoff[\s\S]{0,160}绝不构成发布证明/);
	assert.doesNotMatch(candidate, /Do not parse or render[\s\S]{0,300}stop for human completion/i);
	assert.doesNotMatch(candidate, /(?:always|must|only)\s+(?:open|use|route to)\s+(?:the )?browser(?:\s+for)?\s+(?:Issue Forms?|YAML)/i);
	assert.doesNotMatch(candidate, /YAML Issue Forms require human completion in the web issue chooser\./i);
	assert.doesNotMatch(candidate, /Always route Issue Forms to the browser\./i);
	assert.doesNotMatch(
		candidate,
		/\bfor\s+(?:YAML\s+)?Issue\s+Forms?\b[\s\S]{0,160}\b(?:open|use|route to|go to)\b[\s\S]{0,100}\b(?:browser|web issue chooser|web)\b/i,
	);
}

test("keeps automated and conditional browser Issue Form paths distinct", () => {
	assertBrowserContract(skill);

	const unsafeMutations = [
		"For YAML Issue Forms, open the web issue chooser and stop for human completion.",
		"YAML Issue Forms require human completion in the web issue chooser.",
		"Always route Issue Forms to the browser.",
	];
	for (const mutation of unsafeMutations) {
		assert.throws(() => assertBrowserContract(`${skill}\n\n${mutation}`), mutation);
	}
});

test("discovers support routing and keeps all issue files private until cleanup", () => {
	assert.match(skill, /README\.md/);
	assert.match(skill, /\.github\/ISSUE_TEMPLATE\/config\.yml/);
	assert.match(skill, /Discussions\/contact routing/i);
	assert.match(skill, /questions\/support[\s\S]{0,250}Discussions[\s\S]{0,250}否则询问或停止/);
	assert.doesNotMatch(skill, /TMP_DIR="\$\(mktemp -d\)"/);
	assert.match(skill, /TMPDIR=\/tmp mktemp -d/);
	assert.match(skill, /REPO_ROOT="\$\(git rev-parse --show-toplevel\)"/);
	assert.match(skill, /REPO_ROOT="\$\(cd "\$REPO_ROOT" && pwd -P\)"/);
	assert.match(skill, /if \[ "\$REPO_ROOT" = "\/" \]/);
	assert.match(skill, /trap 'rm -rf -- "\$TMP_DIR"' EXIT/);
	assert.match(skill, /TMP_DIR_REAL="\$\(cd "\$TMP_DIR" && pwd -P\)"/);
	assert.match(skill, /case "\$TMP_DIR_REAL\/" in[\s\S]{0,200}"\$REPO_ROOT\/"\*/);
	assert.match(skill, /if \[ "\$REPO_ROOT" = "\/" \][\s\S]{0,200}Temporary directory is inside the repository/);
	assert.match(skill, /REPO_ROOT="\$\(cd "\$REPO_ROOT" && pwd -P\)"[\s\S]{0,200}TMPDIR=\/tmp mktemp -d/);
	assert.match(skill, /TMPDIR=\/tmp mktemp -d[\s\S]{0,200}trap 'rm -rf -- "\$TMP_DIR"' EXIT/);
	assert.match(skill, /chmod 700 "\$TMP_DIR_REAL"/);
	assert.match(skill, /umask 077/);
	assert.match(skill, /BODY_FILE="\$TMP_DIR_REAL\//);
	assert.match(skill, /READBACK_FILE="\$TMP_DIR_REAL\//);
	assert.doesNotMatch(skill, /TMP_DIR="\$\(cd "\$TMP_DIR" && pwd -P\)"/);
});
