#!/usr/bin/env node
/** 死代码分析：从入口集合沿相对导入图遍历，报告 lib/ 下不可达文件 */
import { readdirSync, readFileSync } from "node:fs";
import { join, posix } from "node:path";

const root = join(import.meta.dirname, "..", "jero-pi");
const importRe = /((?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)["'])(\.{1,2}\/[^"']+)(["'])/g;

// 收集所有源文件（仓库相对路径，正斜杠）
const all = [];
(function walk(dir) {
	for (const e of readdirSync(dir, { withFileTypes: true })) {
		if (e.name === "node_modules" || e.name === ".git") continue;
		const full = join(dir, e.name);
		if (e.isDirectory()) { walk(full); continue; }
		if (/\.(ts|mjs)$/.test(e.name)) all.push(posix.join(...full.slice(root.length + 1).split(/[\\/]/)));
	}
})(root);

// 解析每个文件的相对导入目标
const deps = new Map();
for (const f of all) {
	const set = new Set();
	const dir = posix.dirname(f);
	for (const m of readFileSync(join(root, f), "utf8").matchAll(importRe)) {
		const t = posix.normalize(posix.join(dir, m[2]));
		if (all.includes(t)) set.add(t);
	}
	deps.set(f, set);
}

// 入口：全部扩展（pi 加载目录）、scripts、tests、runtime 生成物引用的 lib 源
const entries = all.filter((f) => f.startsWith("extensions/") || f.startsWith("scripts/") || f.startsWith("tests/"));
// runtime/*.mjs 由 lib 六源生成：显式计入
const runtimeSources = ["lib/core/gentle-ai-binary.ts", "lib/review/review-relay-contract.ts", "lib/review/review-integration-v2.ts", "lib/review/review-risk-assessment.ts", "lib/native/native-review-cli.ts", "lib/core/telemetry-trigger.ts"];
for (const s of runtimeSources) entries.push(s);

const seen = new Set();
const queue = [...entries];
while (queue.length) {
	const f = queue.pop();
	if (seen.has(f)) continue;
	seen.add(f);
	for (const d of deps.get(f) ?? []) if (!seen.has(d)) queue.push(d);
}

const dead = all.filter((f) => f.startsWith("lib/") && !seen.has(f));
console.log(`lib files: ${all.filter((f) => f.startsWith("lib/")).length}, reachable: ${seen.size}, dead: ${dead.length}`);
for (const d of dead) console.log("  DEAD: " + d);

// 二次信号：死文件名在其他文本（md/json）中是否被提及
for (const d of dead) {
	const base = posix.basename(d);
	let hits = 0;
	(function scan(dir) {
		for (const e of readdirSync(dir, { withFileTypes: true })) {
			if (e.name === "node_modules" || e.name === ".git") continue;
			const full = join(dir, e.name);
			if (e.isDirectory()) { scan(full); continue; }
			if (!/\.(md|json|yaml|yml)$/.test(e.name)) continue;
			if (readFileSync(full, "utf8").includes(base)) { hits++; console.log(`  referenced by: ${full.slice(root.length + 1)}`); }
		}
	})(root);
	if (hits === 0) console.log(`  (no text references: ${base})`);
}
