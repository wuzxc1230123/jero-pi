// 用法图：解析 extensions/jero-ai.ts 的顶层声明，统计每个声明在文件其余部分
// 的引用次数（含声明行本身），输出 usage-map.json 供拆分脚本消费。
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const srcPath = join(root, "extensions", "jero-ai.ts");
const src = readFileSync(srcPath, "utf8");
const lines = src.split("\n");

// 顶层声明头正则（必须与文件中真实风格一致；列 0 起始）
const DECL = /^(export )?(?:async )?(function|const|class|interface|type|enum) ([A-Za-z_$][A-Za-z0-9_$]*)/;
const LET_DECL = /^(let) ([A-Za-z_$][A-Za-z0-9_$]*)/;

// 声明头可能跨行（泛型参数等），用括号平衡与开括号 `{`/`=` 找结束
function findDeclEnd(startIdx) {
	// 对 const X = ... 箭头/对象：找到顶层 `;` 不易；改为找下一个列0声明或文件尾，取上一行。
	// 由于我们是机械平移，安全策略：声明体 = 到下一个列0声明（或 export/注释保持附着）之前的行。
	return startIdx; // 占位，主体逻辑在 split 脚本里做
}

const decls = [];
for (let i = 0; i < lines.length; i++) {
	const m = lines[i].match(DECL) || lines[i].match(LET_DECL);
	if (m) decls.push({ name: m[3] ?? m[2], kind: m[2] ?? m[1], line: i + 1, exported: m[0].startsWith("export") });
}

// 每个声明的结束行 = 下一个声明行 - 1（尾部归属下一个声明的头部注释/分隔线由 split 脚本处理）
for (let i = 0; i < decls.length; i++) {
	decls[i].endLine = i + 1 < decls.length ? decls[i + 1].line - 1 : lines.length;
}

// 去掉标识符中的关键词误报：统计引用（整词）出现行号
const identifiers = new Map(decls.map((d) => [d.name, { ...d, refs: [] }]));
const wordRe = (name) => new RegExp(`(?<![A-Za-z0-9_$])${name.replace(/[$]/g, "\$")}(?![A-Za-z0-9_$])`, "g");
for (const [name, entry] of identifiers) {
	const re = wordRe(name);
	for (let i = 0; i < lines.length; i++) {
		re.lastIndex = 0;
		if (re.test(lines[i])) entry.refs.push(i + 1);
	}
}

const out = {};
for (const [name, entry] of identifiers) {
	out[name] = {
		kind: entry.kind, line: entry.line, endLine: entry.endLine, exported: entry.exported,
		refCount: entry.refs.length,
		refsOutsideOwnRange: entry.refs.filter((l) => l < entry.line || l > entry.endLine),
	};
}
writeFileSync(join(here, "usage-map.json"), JSON.stringify(out, null, 2));
console.log(`decls=${decls.length}`);
// 汇总：哪些声明从未在自身范围外被引用（候选可随首个使用者一起走）
const orphans = Object.entries(out).filter(([, v]) => v.refsOutsideOwnRange.length === 0);
console.log(`never-referenced-elsewhere=${orphans.length}`);
for (const [n] of orphans.slice(0, 20)) console.log("  orphan:", n);
