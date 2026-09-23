// tests/runtime-harness.mjs 专用拆分器：
//   support 模块（常量+助手）+ 入口（setup 与顺序 part 调用）+ N 个 part 模块。
// run() 顶层语句（掩码括号深度=1、缩进 1 tab）按目标行数分组进各 part；
// part 间状态经 env 对象往返：
//   - part 开头解构 env 中此前全部名字（setup 常量 + 更早 part 的中途 const）
//   - part 结尾 Object.assign 把本段中途 const 写回 env
// 执行顺序 = setup → part1 → … → partN，语义零改动。
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const sourcePath = join(here, "..", "..", "tests", "runtime-harness.mjs");
const sourceDir = dirname(sourcePath);
const raw = readFileSync(sourcePath, "utf8").split("\n");
const L = (line) => line.replace(/\r$/, "");

// 掩码：字符串/注释/模板内文置空（保留换行与长度结构），括号深度统计用
const maskAll = (text) =>
	text
		.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
		.replace(/\/\/[^\n]*/g, (m) => m.replace(/\S/g, " "))
		.replace(/"(?:[^"\\\n]|\\.)*"/g, (m) => m.replace(/\S/g, " "))
		.replace(/'(?:[^'\\\n]|\\.)*'/g, (m) => m.replace(/\S/g, " "))
		.replace(/`(?:[^`\\]|\\.)*`/g, (m) => m.replace(/\S/g, " "));
const maskLines = maskAll(raw.map(L).join("\n")).split("\n");

// ---- 区段 ---------------------------------------------------------------------
const runStart = raw.findIndex((l, i) => maskLines[i] === "async function run() {") + 1;
if (runStart === 0) throw new Error("找不到 async function run()");
// runClose 必须在掩码上找：夹具模板字面量里有列 0 的 "}"
const runClose = maskLines.findIndex((l, i) => i + 1 > runStart && l === "}") + 1;
const tailStart = runClose + 1; // run().catch(...)
const supportEnd = runStart - 1;

// run() 内顶层语句边界：行首缩进恰好 1 tab 且语句开始时深度为 1
const blockStarts = [];
{
	let depth = 0;
	for (let i = runStart; i <= runClose; i++) {
		const line = maskLines[i - 1] ?? "";
		const opens = (line.match(/\{/g) || []).length;
		const closes = (line.match(/\}/g) || []).length;
		if (depth === 1 && /^\t[^\s]/.test(L(raw[i - 1] ?? ""))) blockStarts.push(i);
		depth += opens - closes;
	}
	if (blockStarts.length === 0) throw new Error("run() 内未找到顶层语句边界");
}
// setup 固定为 run() 头部到 `await loadExtensions(pi);`（含）；
// 其后的全部顶层语句进入 part。
const loadLine = raw.findIndex((l) => L(l) === "\tawait loadExtensions(pi);") + 1;
if (loadLine === 0) throw new Error("找不到 loadExtensions(pi) setup 终点");
const setupEnd = loadLine;
const bodyStart = blockStarts.find((s) => s > setupEnd) ?? runClose;
const bodyEnd = runClose - 1;

// ---- part 划分 ----------------------------------------------------------------
const partCount = Math.max(2, Math.ceil((bodyEnd - bodyStart + 1) / 800));
const boundaries = [bodyStart];
for (let p = 1; p < partCount; p++) {
	const want = bodyStart + Math.floor(((bodyEnd - bodyStart + 1) * p) / partCount);
	let best = boundaries[p - 1];
	for (const s of blockStarts) {
		if (s <= boundaries[p - 1]) continue;
		if (Math.abs(s - want) < Math.abs(best - want)) best = s;
	}
	boundaries.push(best);
}
boundaries.push(bodyEnd + 1);

// setup 名字（const 与解构）
const setupNames = [];
for (let i = runStart; i <= setupEnd; i++) {
	const text = L(raw[i - 1]);
	const m1 = text.match(/^\tconst \{ ([^}]+) \} = /);
	if (m1) for (const part of m1[1].split(",")) setupNames.push(part.trim());
	const m2 = text.match(/^\tconst ([A-Za-z_$][\w$]*) = /);
	if (m2) setupNames.push(m2[1]);
}

// 各段中途 const 名
const midNames = [];
for (let p = 0; p < partCount; p++) {
	const names = [];
	for (let i = boundaries[p]; i < boundaries[p + 1]; i++) {
		const m = L(raw[i - 1]).match(/^\tconst ([A-Za-z_$][\w$]*) = /);
		if (m) names.push(m[1]);
	}
	midNames.push(names);
}

// ---- support 模块 -------------------------------------------------------------
const supportNames = [];
{
	const declRe = /^(?:export )?(?:async )?(function|class|const|let)\s+([A-Za-z_$][\w$]*)/;
	for (let i = 16; i <= supportEnd; i++) {
		const text = L(raw[i - 1]);
		const m = text.match(declRe);
		if (m) {
			supportNames.push(m[2]);
			continue;
		}
		// 顶层解构 const（如动态 import 的具名解构）：每个绑定名都导出
		const d = text.match(/^const \{ ([^}]+) \} = /);
		if (d) for (const partSpec of d[1].split(",")) supportNames.push(partSpec.trim());
	}
}
let supportBody = raw.slice(15, supportEnd).join("\n");
const exportedLines = new Set();
for (const name of [...supportNames].reverse()) {
	const re = new RegExp(`(^|\\n)((?:async )?(?:function|class|const|let)) ${name}\\b`);
	let match = supportBody.match(re);
	let at;
	if (match) {
		at = match.index + match[1].length;
	} else {
		// 解构 const：定位包含该绑定名的整行，只提升一次
		const lines2 = supportBody.split("\n");
		const li = lines2.findIndex((l) => new RegExp(`^const \\{[^}]*\\b${name}\\b`).test(l));
		if (li < 0) throw new Error(`无法提升导出：support/${name}`);
		const lineStart = lines2.slice(0, li).join("\n").length + (li > 0 ? 1 : 0);
		if (exportedLines.has(lineStart)) continue;
		exportedLines.add(lineStart);
		at = lineStart;
	}
	supportBody = supportBody.slice(0, at) + "export " + supportBody.slice(at);
}
writeFileSync(
	join(sourceDir, "runtime-harness-support.mjs"),
	`// runtime-harness 共享常量与助手：自 runtime-harness.mjs 机械平移（语义零改动）。\n${raw.slice(1, 15).join("\n")}\n\n${supportBody}\n`,
	"utf8",
);

// ---- part 文件 ----------------------------------------------------------------
const earlier = [...setupNames];
const supportImport = `import {\n\t${[...new Set(supportNames)].sort().join(",\n\t")},\n} from "./runtime-harness-support.mjs";`;
for (let p = 0; p < partCount; p++) {
	const body = raw.slice(boundaries[p] - 1, boundaries[p + 1] - 1).join("\n");
	const destructure = earlier.length > 0 ? `\tconst { ${[...new Set(earlier)].join(", ")} } = env;\n\n` : "";
	const writeBack = midNames[p].length > 0 ? `\n\tObject.assign(env, { ${midNames[p].join(", ")} });\n` : "";
	const file = `runtime-harness.part${p + 1}.mjs`;
	writeFileSync(
		join(sourceDir, file),
		`// runtime-harness 场景第 ${p + 1}/${partCount} 段：自 run() 机械平移（语义零改动）。\n${raw.slice(1, 15).join("\n")}\n${supportImport}\n\nexport async function part${p + 1}(env) {\n${destructure}${body}${writeBack}}\n`,
		"utf8",
	);
	for (const n of midNames[p]) earlier.push(n);
}

// ---- 入口 ---------------------------------------------------------------------
const setupBody = raw.slice(runStart, setupEnd).join("\n");
const tail = raw.slice(tailStart - 1).join("\n");
const entrySupportImport = `import { ${[...new Set(supportNames)].sort().join(", ")} } from "./runtime-harness-support.mjs";`;
const partImports = Array.from({ length: partCount }, (_, p) => `import { part${p + 1} } from "./runtime-harness.part${p + 1}.mjs";`).join("\n");
const envNames = [...new Set(setupNames)].join(", ");
writeFileSync(
	sourcePath,
	`// runtime-harness 入口：环境 setup 与场景段的顺序编排。\n// 常量/助手在 runtime-harness-support.mjs；场景段在 runtime-harness.partN.mjs。\n${raw.slice(1, 15).join("\n")}\n${entrySupportImport}\n${partImports}\n\nasync function run() {\n${setupBody}\n\tconst env = { ${envNames} };\n${Array.from({ length: partCount }, (_, p) => `\tawait part${p + 1}(env);`).join("\n")}\n}\n\n${tail}\n`,
	"utf8",
);
process.stdout.write(`runtime-harness.mjs 入口与 ${partCount} 个 part + support 生成完毕；段行数：${Array.from({ length: partCount }, (_, p) => boundaries[p + 1] - boundaries[p]).join(" ")}\n`);
