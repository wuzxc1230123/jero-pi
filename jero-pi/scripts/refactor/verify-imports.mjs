// 核验 stage1-extension-imports.json 里每个名字在目标模块中确实被 export。
// 坑：源文件含 CRLF，且经 heredoc 写入时 `\s` 会被吞成 `s` —— 本文件用
// String.raw 保持正则原样。锚定行首用 (?:^|\r?\n)，不要用裸 ^（无 m 标志时
// ^ 只匹配串首）也不要用 [\r\n]（会把 \r 与 \n 当两个分隔符而漏配）。
import { readFileSync, existsSync } from "node:fs";

const plan = JSON.parse(readFileSync("scripts/refactor/stage1-extension-imports.json", "utf8"));
let ok = 0;
const bad = [];
for (const entry of plan) {
	const path = `lib/${entry.from}.ts`;
	if (!existsSync(path)) {
		bad.push(`缺失模块 ${entry.from}`);
		continue;
	}
	const code = readFileSync(path, "utf8");
	for (const name of entry.names) {
		const pattern = String.raw`(?:^|\r?\n)export\s+(?:async\s+)?(?:function|const|class|type|interface|let)\s+` + name + String.raw`\b`;
		if (new RegExp(pattern).test(code)) ok += 1;
		else bad.push(`${entry.from} 未导出 ${name}`);
	}
}
console.log(`存在 ${ok} / 缺失 ${bad.length}`);
for (const entry of bad) console.log("  " + entry);
process.exit(bad.length === 0 ? 0 : 1);
