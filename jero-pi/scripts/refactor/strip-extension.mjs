// 阶段1收尾：从 extensions/jero-ai.ts 移除已迁往 lib/jero-ai-*.ts 的块，
// 并在原 import 区末尾追加指向新模块的 import 行。字节级精确移除。
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const SRC = join(root, "extensions", "jero-ai.ts");
const usage = JSON.parse(readFileSync(join(here, "usage-map.json"), "utf8"));
const extImports = JSON.parse(readFileSync(join(here, "stage1-extension-imports.json"), "utf8"));

const REGIONS = [
	{ from: 223, to: 321 }, { from: 326, to: 550 }, { from: 551, to: 939 },
	{ from: 940, to: 1235 }, { from: 1236, to: 1360 }, { from: 1361, to: 1633 },
	{ from: 1634, to: 1653 }, { from: 1654, to: 1903 }, { from: 1904, to: 2008 },
	{ from: 2010, to: 2070 }, { from: 2071, to: 2660 }, { from: 2661, to: 2864 },
	{ from: 2865, to: 3508 }, { from: 3509, to: 4257 }, { from: 4258, to: 4278 },
];

const lines = readFileSync(SRC, "utf8").split("\n");

// 与 split 脚本相同的块回溯逻辑，拿到每个被移走声明的完整块（含前导注释）
const declLines = Object.values(usage).map((u) => u.line).sort((a, b) => a - b);
const nameAtLine = new Map(Object.entries(usage).map(([n, u]) => [u.line, n]));
const removed = []; // [start,end] 1-based inclusive
for (const r of REGIONS) {
	const inRegion = declLines.filter((l) => l >= r.from && l <= r.to);
	for (let i = 0; i < inRegion.length; i++) {
		const line = inRegion[i];
		const prevDecl = i > 0 ? inRegion[i - 1] : (() => {
			const allPrev = declLines.filter((l) => l < line);
			return allPrev.length ? allPrev[allPrev.length - 1] : 222;
		})();
		let start = i > 0 ? line : r.from;
		if (i > 0) {
			while (start - 1 > prevDecl) {
				const above = lines[start - 2];
				if (above === undefined) break;
				const t = above.trim();
				if (t === "" || t.startsWith("//") || t.startsWith("*") || t.startsWith("/*") || t.startsWith("*/")) start -= 1;
				else break;
			}
		}
		const end = usage[nameAtLine.get(line)].endLine;
		removed.push([start, end]);
	}
}
removed.sort((a, b) => a[0] - b[0]);
const merged = [];
for (const [s, e] of removed) {
	if (merged.length && s <= merged[merged.length - 1][1] + 1) merged[merged.length - 1][1] = Math.max(merged[merged.length - 1][1], e);
	else merged.push([s, e]);
}
for (let i = merged.length - 1; i >= 0; i--) {
	const [s, e] = merged[i];
	lines.splice(s - 1, e - s + 1);
}
const compacted = [];
for (const l of lines) {
	if (l.trim() === "" && compacted.length && compacted[compacted.length - 1].trim() === "") continue;
	compacted.push(l);
}

let lastImport = -1;
for (let i = 0; i < compacted.length; i++) {
	if (/^} from "|^import /.test(compacted[i])) lastImport = i;
}
const add = [];
for (const { from, names } of extImports) {
	add.push(`import { ${names.join(", ")} } from "../lib/${from}.ts";`);
}
compacted.splice(lastImport + 1, 0, ...add);
writeFileSync(SRC, compacted.join("\n"));
console.log(`removed ${merged.length} ranges; extension now ${compacted.length} lines; added ${add.length} import lines`);
