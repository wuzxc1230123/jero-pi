import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { auditBundleContent } from "../lib/module-bundle-content.ts";
import { readBundleTexts } from "../lib/module-verify-pipeline.ts";
import type { ModuleManifest } from "../lib/module-contract.ts";

// 包内模块库（assets/modules/*）的内容纪律机检。判定体在 lib
// （module-bundle-content.ts 的 auditBundleContent——安装验证 bundle-content
// 检查项与 CI 库门三方共用），本文件只做库级断言：两束零发现、全中文、
// golang 束清单钉住。手工模块走 /jero-module-verify 时由管线吃同一判定体。

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const LIBRARY_ROOT = join(ROOT, "assets", "modules");

interface Bundle {
	token: string;
	dir: string;
	manifest: ModuleManifest;
	skills: string[];
	references: string[];
}

function loadBundles(): Bundle[] {
	const bundles: Bundle[] = [];
	for (const dirEntry of readdirSync(LIBRARY_ROOT, { withFileTypes: true })) {
		if (!dirEntry.isDirectory()) continue;
		const dir = join(LIBRARY_ROOT, dirEntry.name);
		const manifest = JSON.parse(readFileSync(join(dir, "module.json"), "utf8")) as ModuleManifest;
		const skillsDir = join(dir, "skills");
		bundles.push({
			token: manifest.token,
			dir,
			manifest,
			skills: existsSync(skillsDir) ? readdirSync(skillsDir).sort() : [],
			references: readdirSync(join(dir, "references")).map((f) => f.replace(/\.md$/, "")).sort(),
		});
	}
	return bundles.sort((left, right) => left.token.localeCompare(right.token));
}

test("lib 判定体对两束零发现：交接指针/骨架同名/孤儿 reference/手写计数全部干净", () => {
	const problems: string[] = [];
	for (const bundle of loadBundles()) {
		const entryText = readFileSync(join(bundle.dir, bundle.manifest.knowledge.entry), "utf8");
		const findings = auditBundleContent({
			manifest: bundle.manifest,
			entryText,
			...readBundleTexts(bundle.dir, bundle.manifest),
		});
		for (const finding of findings) problems.push(`${bundle.token}/${finding.file}：${finding.message}`);
	}
	assert.deepEqual(problems, [], problems.join("\n"));
});

test("golang 束清单钉住：触发器含 go.mod、Strict TDD 命令、三角色、零依赖零 MCP", () => {
	const bundle = loadBundles().find((item) => item.token === "golang");
	assert.ok(bundle !== undefined, "包内模块库必须含 golang 束");
	const { manifest } = bundle;
	assert.equal(manifest.triggers.files.includes("go.mod"), true, "静态触发心脏：go.mod 字面量触发（库门据此确定性命中）");
	assert.equal(manifest.triggers.files.includes("**/*.go"), true);
	assert.equal(manifest.config?.testCommand, "go test ./...", "Strict TDD 转发取值链第一级钉住值");
	assert.deepEqual(manifest.roles.map((role) => role.name).sort(), ["golang-architect", "golang-reviewer", "golang-tester"]);
	assert.deepEqual(manifest.dependencies, [], "v1 版无依赖承诺：库内自足");
	assert.equal(manifest.mcp, undefined, "供应链策略决策：不声明 MCP 档（uvx/npx 钉版面装不下 gopls 形态）");
	// gopls MCP 走"接线技能"形态：模块不声明档，用户按技能指引手工接项目级 .pi/mcp.json。
	assert.ok(bundle.skills.includes("golang-mcp"), "gopls MCP 接线技能必须在束（官方 MCP 存在但供应链门外的补偿面）");
	// 知识入口 ≤60 行由安装验证钉住，这里双保险（入口膨胀即档位失效）。
	const entryLines = readFileSync(join(bundle.dir, manifest.knowledge.entry), "utf8").split("\n").length;
	assert.ok(entryLines <= 60, `知识入口 ${entryLines} 行，超 60 行上限`);
});

test("束内文本纪律：技能 frontmatter 名 = 目录名，束内 .md 全中文", () => {
	const problems: string[] = [];
	for (const bundle of loadBundles()) {
		for (const skill of bundle.skills) {
			const text = readFileSync(join(bundle.dir, "skills", skill, "SKILL.md"), "utf8");
			const name = /^name:\s*(.+)$/m.exec(text)?.[1]?.trim();
			if (name !== skill) problems.push(`${bundle.token}/${skill}：frontmatter name「${name}」≠ 目录名`);
		}
		for (const file of readdirSync(join(bundle.dir, "references"), { withFileTypes: true })) {
			if (!file.isFile() || !file.name.endsWith(".md")) continue;
			const text = readFileSync(join(bundle.dir, "references", file.name), "utf8");
			if (!/\p{Script=Han}/u.test(text)) problems.push(`${bundle.token}/references/${file.name}：无中文（全中文模块纪律）`);
		}
		for (const role of bundle.manifest.roles) {
			const text = readFileSync(join(bundle.dir, "agents", `${role.name}.md`), "utf8");
			if (!/\p{Script=Han}/u.test(text)) problems.push(`${bundle.token}/agents/${role.name}.md：无中文`);
		}
	}
	assert.deepEqual(problems, [], problems.join("\n"));
});
