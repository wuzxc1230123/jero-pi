#!/usr/bin/env node
/** 校验 jero-pi 内所有 .ts/.mjs 的相对导入目标文件确实存在 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, posix } from "node:path";

const root = join(import.meta.dirname, "..", "jero-pi");
const importRe = /((?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)["'])(\.{1,2}\/[^"']+)(["'])/g;
const broken = [];
let files = 0, specs = 0;

(function walk(dir) {
	for (const e of readdirSync(dir, { withFileTypes: true })) {
		if (e.name === "node_modules" || e.name === ".git") continue;
		const full = join(dir, e.name);
		if (e.isDirectory()) { walk(full); continue; }
		if (!/\.(ts|mjs)$/.test(e.name) || e.name.endsWith(".d.ts")) continue;
		files++;
		const relDir = posix.join(...full.slice(root.length + 1).split(/[\\/]/), "..");
		for (const m of readFileSync(full, "utf8").matchAll(importRe)) {
			const spec = m[2];
			specs++;
			const candidates = [spec, spec.replace(/\.js$/, ".mjs"), spec.replace(/\.mjs$/, ".ts"), spec + ".ts", spec + "/index.ts"];
			if (!candidates.some((c) => existsSync(join(root, posix.normalize(posix.join(relDir, c)))))) {
				broken.push(`${relDir}/${e.name}: ${spec}`);
			}
		}
	}
})(root);

console.log(`checked ${files} files, ${specs} relative imports, ${broken.length} broken`);
for (const b of broken.slice(0, 40)) console.log("  " + b);
