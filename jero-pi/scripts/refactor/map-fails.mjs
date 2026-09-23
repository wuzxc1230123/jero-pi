// 临时诊断：把全量日志中的失败用例映射回测试文件。
// 日志形态：`test at tests\x.test.ts:行:列` 的下一行是 `✖ 用例名 (...)`。
import { readFileSync } from "node:fs";

const log = readFileSync("D:/jero-pi-after-fixes.log", "utf8");
let cur = null;
const mapping = new Map();
for (const line of log.split("\n")) {
	const at = line.match(/^test at (tests.[\w.-]+\.test\.ts):/);
	if (at) {
		cur = at[1];
		continue;
	}
	if (line.startsWith("✖") && cur) {
		const name = line.slice(2).replace(/ \([\d.]+ms\).*/, "");
		if (!mapping.has(cur)) mapping.set(cur, new Set());
		mapping.get(cur).add(name);
	}
}
const rows = [...mapping.entries()].sort((a, b) => b[1].size - a[1].size);
for (const [f, names] of rows) console.log(names.size, f);
console.log("total unique:", rows.reduce((s, [, n]) => s + n.size, 0));
