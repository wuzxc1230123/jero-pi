#!/usr/bin/env node
// 局部快速回路（迭代用）：按改动路径映射到最小相关测试集并只跑它们。
// 全量 pnpm test 仍是 prepack 的唯一权威回路——本脚本的取舍刻意保守
// （宁多跑不漏跑），映射表外的一律回落到提示跑全量。映射表自身必须
// 健康：任何在 tests/ 下展开为空的模式都是陈旧引用，硬失败退出——
// 选择层静默漏测比测试失败更危险（曾经的真实形态：顶层文件缺 tests/
// 前缀导致全部顶层 glob 落空、除 authority 域外一概选中 0 个且 exit 0）。
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

// 路径前缀 → 测试文件模式。"tests/authority" 特指该目录下全部 .test.ts
// （含 conformance 子目录，与 pnpm test 的收集面同构）；通配模式按
// 前缀+后缀在 tests/ 递归清单上展开。
const RULES = [
	[/^jero-pi\/lib\/authority\//, ["tests/authority"]],
	[/^lib\/authority\//, ["tests/authority"]],
	[/^(?:jero-pi\/)?(?:lib|extensions)\/(?:review|jero-ai)/, ["tests/review-*.test.ts", "tests/jero-ai*.test.ts", "tests/runtime-harness.part1.mjs"]],
	[/^(?:jero-pi\/)?(?:lib|extensions)\/module-/, ["tests/module-*.test.ts", "tests/module-library-content.test.ts"]],
	[/^(?:jero-pi\/)?(?:lib\/(?:agents-|jero-agents-|shell-)|extensions\/(?:jero-agents|jero-shell))/, ["tests/agents-*.test.ts", "tests/jero-agents*.test.ts", "tests/shell-*.test.ts", "tests/orchestrator-*.test.ts", "tests/background-subagents.test.ts"]],
	[/^(?:jero-pi\/)?(?:extensions\/jero-memory|lib\/memory)/, ["tests/jero-memory.test.ts"]],
	[/^(?:jero-pi\/)?(?:lib\/sdd-|extensions\/sdd-init)/, ["tests/sdd-*.test.ts"]],
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

// tests/ 下全部测试文件的递归清单，统一带 tests/ 前缀——顶层文件与子
// 目录文件同构，映射模式才能一致匹配（曾经的缺陷形态：顶层文件无前缀
// 而全部顶层 glob 落空）。只收 .test.ts 与 .mjs，fixtures 不参与选择。
function listTestFiles(dir, prefix) {
	return readdirSync(join(packageRoot, dir), { withFileTypes: true }).flatMap((entry) => {
		const rel = `${prefix}${entry.name}`;
		if (entry.isDirectory()) return listTestFiles(`${dir}/${entry.name}`, `${rel}/`);
		return /\.(?:test\.ts|mjs)$/.test(rel) ? [rel] : [];
	});
}

function expandPattern(pattern, allTestFiles) {
	if (!pattern.includes("*")) return allTestFiles.includes(pattern) ? [pattern] : [];
	const prefix = pattern.slice(0, pattern.indexOf("*"));
	const suffix = pattern.slice(pattern.lastIndexOf("*") + 1);
	return allTestFiles.filter((file) => file.startsWith(prefix) && file.endsWith(suffix));
}

const changes = changedFiles().map((change) => change.replace(/\\/g, "/"));
if (changes.length === 0) {
	console.error("没有可映射的改动（工作树净且未传路径/--since）。直接跑 pnpm test。");
	process.exit(0);
}
const allTestFiles = listTestFiles("tests", "tests/");
const selected = new Set();
const unmatched = [];
const stale = new Set();
for (const change of changes) {
	const patterns = RULES.filter(([pattern]) => pattern.test(change)).flatMap(([, patterns]) => patterns);
	if (patterns.length === 0) {
		unmatched.push(change);
		continue;
	}
	for (const pattern of patterns) {
		const files = pattern === "tests/authority"
			? allTestFiles.filter((file) => file.startsWith("tests/authority/") && file.endsWith(".test.ts"))
			: expandPattern(pattern, allTestFiles);
		if (files.length === 0) stale.add(pattern);
		for (const file of files) selected.add(file);
	}
}
if (stale.size > 0) {
	console.error(`映射表陈旧引用（在 tests/ 下展开为空，修 RULES 或补对应测试）：${[...stale].join(", ")}`);
	process.exit(1);
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
