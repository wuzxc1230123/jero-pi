#!/usr/bin/env node
// 局部快速回路（迭代用）：按改动路径映射到最小相关测试集并只跑它们。
// 全量 pnpm test 仍是 prepack 的唯一权威回路——本脚本的取舍刻意保守
// （宁多跑不漏跑），映射表外的一律回落到提示跑全量。
//
// 用法（包目录内）：
//   pnpm run test:fast                    # 工作树未提交改动 → 相关套件
//   pnpm run test:fast -- lib/authority/mode.ts extensions/jero-ai.ts
//   node scripts/test-fast.mjs --since=HEAD~1   # 某提交以来的改动
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const packageRoot = join(fileURLToPath(new URL("..", import.meta.url)));

// 路径前缀 → 测试文件模式（tests/ 下，支持 *.test.ts 后缀通配）。
const RULES = [
	[/^jero-pi\/lib\/authority\//, ["tests/authority"]],
	[/^lib\/authority\//, ["tests/authority"]],
	[/^(?:jero-pi\/)?(?:lib|extensions)\/(?:review|jero-ai)/, ["tests/review-*.test.ts", "tests/jero-ai*.test.ts", "tests/runtime-harness.part1.mjs"]],
	[/^(?:jero-pi\/)?(?:lib|extensions)\/module-/, ["tests/module-*.test.ts", "tests/module-library-content.test.ts"]],
	[/^(?:jero-pi\/)?extensions\/jero-agents|^extensions\/jero-shell/, ["tests/agents-*.test.ts", "tests/orchestrator-*.test.ts", "tests/background-subagents.test.ts"]],
	[/^(?:jero-pi\/)?(?:extensions\/jero-memory|lib\/memory)/, ["tests/jero-memory.test.ts", "tests/memory-*.test.ts"]],
	[/^(?:jero-pi\/)?lib\/sdd-|^extensions\/sdd-init/, ["tests/sdd-*.test.ts"]],
	[/^(?:jero-pi\/)?(?:skills|assets|prompts)\//, ["tests/artifact-language.test.ts", "tests/jero-prototype-skill.test.ts", "tests/module-library-content.test.ts", "tests/skill-*.test.ts", "tests/issue-creation-skill.test.ts"]],
];

function changedFiles() {
	const args = process.argv.slice(2);
	const since = args.find((argument) => argument.startsWith("--since="));
	if (since !== undefined) {
		return spawnSync("git", ["diff", "--name-only", since.slice("--since=".length)], { cwd: packageRoot, encoding: "utf8" })
			.stdout.split(/\r?\n/).filter((line) => line.length > 0);
	}
	const positional = args.filter((argument) => !argument.startsWith("--"));
	if (positional.length > 0) return positional;
	const tracked = spawnSync("git", ["diff", "--name-only", "HEAD"], { cwd: packageRoot, encoding: "utf8" });
	const untracked = spawnSync("git", ["ls-files", "--others", "--exclude-standard"], { cwd: packageRoot, encoding: "utf8" });
	return [...tracked.stdout.split(/\r?\n/), ...untracked.stdout.split(/\r?\n/)].filter((line) => line.length > 0);
}

function expandPattern(pattern, allTestFiles) {
	if (!pattern.includes("*")) {
		return allTestFiles.includes(pattern) ? [pattern] : pattern.endsWith(".mjs") ? [] : [pattern];
	}
	const prefix = pattern.slice(0, pattern.indexOf("*"));
	const suffix = pattern.slice(pattern.lastIndexOf("*") + 1);
	return allTestFiles.filter((file) => file.startsWith(prefix) && file.endsWith(suffix));
}

const changes = changedFiles();
if (changes.length === 0) {
	console.error("没有可映射的改动（工作树净且未传路径/--since）。直接跑 pnpm test。");
	process.exit(0);
}
const allTestFiles = [...readdirSync(join(packageRoot, "tests"), { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? readdirSync(join(packageRoot, "tests", entry.name)).map((name) => `tests/${entry.name}/${name}`) : [entry.name]))];
const selected = new Set();
const unmatched = [];
for (const change of changes) {
	const rules = RULES.filter(([pattern]) => pattern.test(change)).flatMap(([, patterns]) => patterns);
	if (rules.length === 0) {
		unmatched.push(change);
		continue;
	}
	for (const pattern of rules) {
		if (pattern === "tests/authority") {
			for (const file of allTestFiles.filter((file) => file.startsWith("tests/authority/") && file.endsWith(".test.ts"))) selected.add(file);
			continue;
		}
		for (const file of expandPattern(pattern, allTestFiles)) selected.add(file);
	}
}
if (selected.size === 0) {
	console.log(`改动面无映射套件（${unmatched.join(", ")}）——跑对应质量门或全量：pnpm test`);
	process.exit(0);
}
console.log(`改动 ${changes.length} 项 → 选中 ${selected.size} 个测试文件：`);
for (const file of selected) console.log(`  ${file}`);
if (unmatched.length > 0) console.log(`未映射（走门/全量兜底）：${unmatched.join(", ")}`);
console.log("——局部回路不替代全量，prepack 前仍须 pnpm test——\n");
const result = spawnSync(process.execPath, [
	"--require", "./scripts/test-env.cjs",
	"--experimental-strip-types", "--test", "--test-concurrency=12", "--test-timeout=300000",
	...selected,
], { cwd: packageRoot, stdio: "inherit" });
process.exit(result.status ?? 1);
