// 测试文件机械拆分器：把超长 .test.ts 拆成 <base>-shared.ts（夹具/助手）+
// 原文件保留第 1 段 + <base>.z2.test.ts … <base>.zN.test.ts（后续段）。
// 命名保证 glob 字母序 = 原执行顺序："<base>.test.ts" 与 "<base>.zN.test.ts"
// 在 base 后第一个字符分叉（'t' < 'z'），z2 < z3 < … 依次在后。
//
// 识别与导入策略：
//   - 全文件先经长度保持掩码（字符串/注释/模板内文剔除、插值体保留、
//     换行与列对齐保持），声明与 import 的探测都在掩码上进行——夹具里
//     常见的"巨型模板字面量写假脚本"不会伪装成顶层声明；
//   - 导入采用超集：每段导入全部外部依赖 + shared 全部导出 + 对侧段
//     全部导出。未使用的命名导入既非类型错误也非运行时错误。
// 用法：node split-test.mjs <test-file.ts> [每段目标行数，默认 900]
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const target = process.argv[2];
if (!target || !target.endsWith(".test.ts")) throw new Error("usage: split-test.mjs <file.test.ts> [chunk-lines]");
const chunkLines = Number(process.argv[3] || "900");
const sourcePath = join(here, "..", "..", target);
const sourceDir = dirname(sourcePath);
const source = readFileSync(sourcePath, "utf8");
const lines = source.split("\n");

// ---- 长度保持掩码 ------------------------------------------------------------
// 注释/字符串字面量的内文、模板字面量的非插值内文 → 空格；插值体保留为
// 代码；换行原样保留。输出与输入等长，任何在掩码上的匹配下标可直接
// 用于原文。
const maskBody = (body) => {
	const out = body.split("");
	let i = 0;
	const n = body.length;
	const blank = (from, to) => {
		for (let k = from; k < Math.min(to, n); k++) {
			if (out[k] !== "\n") out[k] = " ";
		}
	};
	// 正则字面量判定：按前驱有效字符。前一字符是这些（或行首）时 "/"
	// 开启正则，否则按除法处理。测试代码常见 /...`.../ 这类含反引号的
	// 正则，不识别会破坏后续模板配对。
	const regexPrecededBy = () => {
		for (let k = i - 1; k >= 0; k--) {
			const c = out[k];
			if (c === " " || c === "\n" || c === "\t") continue;
			return "({[,;=:!&|?+-*%<>~^".includes(c);
		}
		return true;
	};
	while (i < n) {
		const ch = body[i];
		const next = body[i + 1];
		if (ch === "/" && next === "/") {
			const start = i;
			while (i < n && body[i] !== "\n") i += 1;
			blank(start, i);
			continue;
		}
		if (ch === "/" && next === "*") {
			const start = i;
			i += 2;
			while (i < n && !(body[i] === "*" && body[i + 1] === "/")) i += 1;
			i += 2;
			blank(start, i);
			continue;
		}
		if (ch === "/" && regexPrecededBy()) {
			// 正则字面量：跳到闭合 "/"（越过转义与字符类），整体置空
			const start = i;
			i += 1;
			let inClass = false;
			while (i < n) {
				const c = body[i];
				if (c === "\\") {
					i += 2;
					continue;
				}
				if (c === "[") inClass = true;
				else if (c === "]") inClass = false;
				else if (c === "/" && !inClass) break;
				else if (c === "\n") break; // 跨行即非正则，止损
				i += 1;
			}
			i += 1;
			blank(start, i);
			continue;
		}
		if (ch === '"' || ch === "'") {
			const start = i;
			i += 1;
			while (i < n && body[i] !== ch && body[i] !== "\n") i += body[i] === "\\" ? 2 : 1;
			i += 1;
			blank(start, i);
			continue;
		}
		if (ch === "`") {
			i += 1;
			while (i < n && body[i] !== "`") {
				if (body[i] === "\\") {
					out[i] = " ";
					if (i + 1 < n && out[i + 1] !== "\n") out[i + 1] = " ";
					i += 2;
					continue;
				}
				if (body[i] === "$" && body[i + 1] === "{") {
					// 插值体是代码：跳过整段（保留原字符）
					let depth = 0;
					let j = i + 1;
					while (j < n) {
						if (body[j] === "{") depth += 1;
						else if (body[j] === "}") {
							depth -= 1;
							if (depth === 0) break;
						} else if (body[j] === '"' || body[j] === "'" || body[j] === "`") {
							const q = body[j];
							j += 1;
							while (j < n && body[j] !== q && body[j] !== "\n") j += body[j] === "\\" ? 2 : 1;
						}
						j += 1;
					}
					i = j + 1;
					continue;
				}
				if (out[i] !== "\n") out[i] = " ";
				i += 1;
			}
			if (i < n) out[i] = " ";
			i += 1;
			continue;
		}
		i += 1;
	}
	return out.join("");
};

const masked = maskBody(source);
const maskedLines = masked.split("\n");

// ---- 区段探测（匹配用掩码行，内容用原行）-------------------------------------
const testStartRe = /^(?:await\s+)?test(?:\.(?:skip|todo))?\(/;
let testStart = -1;
const declRe = /^(export\s+)?(?:async\s+)?(function|class|const|let|interface|type|enum)\s+([A-Za-z_$][\w$]*)/;
const decls = new Map(); // name -> { kind, exported, line, home }
const externals = new Map(); // name -> { module, kind, reexport, default, namespace, orig }
const importRanges = []; // 头部 import 语句的 [起,止] 行区间（1-based）
{
	let i = 0;
	while (i < lines.length) {
		const mLine = maskedLines[i];
		const trimmed = mLine.trim();
		if (trimmed.startsWith("import ") || /^export\s*\{/.test(trimmed) || /^export\s+type\s*\{/.test(trimmed)) {
			const startLine = i + 1;
			let j = i;
			let maskedStmt = mLine;
			while (!/(^|[^{])\}\s*from\s*"[^"]+";?\s*$/.test(maskedStmt) && !/;\s*$/.test(maskedStmt) && j + 1 < lines.length) {
				j += 1;
				maskedStmt += "\n" + maskedLines[j];
			}
			const stmt = lines.slice(i, j + 1).join("\n");
			const fromMatch = stmt.match(/from\s+"([^"]+)"/);
			if (fromMatch) {
				const isReexport = /^export/.test(trimmed);
				const stmtLevelType = /^import\s+type\s+\{/.test(stmt);
				if (stmt.includes("{")) {
					const leadingDefault = stmt.match(/^import\s+([A-Za-z_$][\w$]*)\s*,\s*\{/);
					if (leadingDefault) externals.set(leadingDefault[1], { module: fromMatch[1], kind: "value", reexport: false, default: true });
					const specifiers = stmt.slice(stmt.indexOf("{") + 1, stmt.lastIndexOf("}"));
					for (const raw of specifiers.split(",")) {
						const spec = raw.trim();
						if (!spec) continue;
						const typeMatch = spec.match(/^type\s+([A-Za-z_$][\w$]*)$/);
						const valueMatch = spec.match(/^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/);
						const name = typeMatch ? typeMatch[1] : valueMatch ? (valueMatch[2] || valueMatch[1]) : null;
						if (name && !externals.get(name)?.reexport) {
							externals.set(name, { module: fromMatch[1], kind: typeMatch || stmtLevelType ? "type" : "value", reexport: isReexport, default: false, orig: valueMatch && valueMatch[2] ? valueMatch[1] : undefined });
						}
					}
				} else {
					const defaultMatch = stmt.match(/^import\s+([A-Za-z_$][\w$]*)\s+from/m);
					const namespaceMatch = stmt.match(/^import\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from/m);
					if (namespaceMatch) externals.set(namespaceMatch[1], { module: fromMatch[1], kind: "value", reexport: false, default: false, namespace: true });
					else if (defaultMatch) externals.set(defaultMatch[1], { module: fromMatch[1], kind: "value", reexport: false, default: true });
				}
				if (testStart < 0) importRanges.push([startLine, j + 1]);
			}
			i = j;
			i += 1;
			continue;
		}
		if (testStartRe.test(mLine) && testStart < 0) testStart = i + 1;
		const m = mLine.match(declRe);
		if (m) {
			const [, exported, keyword, name] = m;
			decls.set(name, { kind: keyword === "interface" || keyword === "type" ? "type" : "value", exported: Boolean(exported), line: i + 1, home: undefined });
		}
		i += 1;
	}
}
if (testStart < 0) throw new Error("找不到 test( 块起点");

// ---- 分段计划 ----------------------------------------------------------------
const base = target.replace(/\.test\.ts$/, "").split("/").pop();
const sharedName = `${base}-shared.ts`;
const partName = (index) => (index === 0 ? `${base}.test.ts` : `${base}.z${index + 1}.test.ts`);

const fileEnd = lines.length;
const testBlockStarts = [];
for (let i = testStart - 1; i < lines.length; i++) {
	if (testStartRe.test(maskedLines[i])) testBlockStarts.push(i + 1);
}
const partCount = Math.max(2, Math.ceil((fileEnd - testStart + 1) / chunkLines));
const boundaries = [testStart];
for (let p = 1; p < partCount; p++) {
	const want = testStart + Math.floor(((fileEnd - testStart) * p) / partCount);
	let best = boundaries[p - 1];
	for (const start of testBlockStarts) {
		if (start <= boundaries[p - 1]) continue;
		if (Math.abs(start - want) < Math.abs(best - want)) best = start;
	}
	if (best <= boundaries[p - 1]) best = testBlockStarts.find((s) => s > boundaries[p - 1]) ?? fileEnd + 1;
	boundaries.push(best);
}
boundaries.push(fileEnd + 1);

const partBodies = [];
for (let p = 0; p < partCount; p++) {
	partBodies.push(lines.slice(boundaries[p] - 1, boundaries[p + 1] - 1).join("\n"));
}
// shared 区 = [1, testStart) 剥离 import 语句：交错的顶层声明/注释保留
const inImportRange = (line) => importRanges.some(([a, b]) => line >= a && line <= b);
const helperLines = [];
for (let i = 1; i < testStart; i++) {
	if (inImportRange(i)) continue;
	helperLines.push(lines[i - 1]);
}
const helperBody = helperLines.join("\n");

for (const [name, info] of decls) {
	if (info.line < testStart) info.home = "shared";
	else {
		for (let p = 0; p < partCount; p++) {
			if (info.line >= boundaries[p] && info.line < boundaries[p + 1]) info.home = p;
		}
	}
}

// ---- 超集导入 ----------------------------------------------------------------
const formatGroup = (entries) => {
	const items = entries
		.map((e) => {
			if (e.default) return `default as ${e.name}`;
			const spec = e.orig ? `${e.orig} as ${e.name}` : e.name;
			return e.kind === "type" ? `type ${spec}` : spec;
		})
		.sort((a, b) => a.replace(/^(type )/, "").localeCompare(b.replace(/^(type )/, "")));
	const single = items.join(", ");
	if (`import { ${single} } from`.length <= 120) return single;
	const out = [];
	let current = "";
	for (const item of items) {
		const candidate = current ? `${current}, ${item}` : item;
		if (candidate.length > 96 && current) {
			out.push(current + ",");
			current = item;
		} else current = candidate;
	}
	if (current) out.push(current);
	return out.join("\n\t");
};

const emitSupersetImports = (self, body) => {
	const byModule = new Map();
	const record = (moduleName, entry) => {
		if (!byModule.has(moduleName)) byModule.set(moduleName, []);
		byModule.get(moduleName).push(entry);
	};
	for (const [symbol, info] of externals) {
		if (info.reexport) continue;
		record(info.module, { name: symbol, kind: info.kind, default: info.default, namespace: info.namespace, orig: info.orig });
	}
	// shared 与外部依赖走超集（无重复注册风险）；其他 part 是测试文件，
	// 超集导入会在本进程重复注册对侧用例——改为掩码使用检测，只导入
	// 真正引用的对侧顶层夹具。
	const bodyMask = body === undefined ? "" : maskBody(body);
	for (const [symbol, info] of decls) {
		if (info.home === undefined || info.home === self) continue;
		if (info.home === "shared") {
			record(`./${sharedName}`, { name: symbol, kind: info.kind, default: false, orig: undefined });
			continue;
		}
		if (body !== undefined && new RegExp(`\\b${symbol}\\b`).test(bodyMask)) {
			if (process.env.SPLIT_TEST_DEBUG === symbol) console.error(`[dbg] detected ${symbol} home=${info.home} self=${self}`);
			record(`./${partName(info.home)}`, { name: symbol, kind: info.kind, default: false, orig: undefined });
		}
	}
	const namespaces = [];
	const named = [];
	for (const [moduleName, entries] of byModule) {
		const nsEntry = entries.find((e) => e.namespace);
		const others = entries.filter((e) => !e.namespace);
		if (nsEntry) namespaces.push(`import * as ${nsEntry.name} from "${moduleName}";`);
		if (others.length === 0) continue;
		const group = formatGroup(others);
		named.push(group.includes("\n") ? `import {\n\t${group}\n} from "${moduleName}";` : `import { ${group} } from "${moduleName}";`);
	}
	return [...namespaces, ...named].join("\n");
};

// ---- 掩码上的导出提升（下标直接适用于原文）------------------------------------
const promoteExport = (raw, mask, symbol) => {
	const re = new RegExp(`(^|\\n)(?:async\\s+)?(const|function|interface|class|let|type) ${symbol}\\b`);
	const match = mask.match(re);
	if (!match) return false;
	const at = match.index + match[1].length;
	return raw.slice(0, at) + "export " + raw.slice(at);
};

// ---- shared 模块：夹具全部导出 ------------------------------------------------
let sharedSource = helperBody;
let sharedMask = maskBody(sharedSource);
for (const [name, info] of decls) {
	if (info.home !== "shared" || info.exported) continue;
	const next = promoteExport(sharedSource, sharedMask, name);
	if (next === false) throw new Error(`无法提升导出：shared/${name}`);
	sharedSource = next;
	sharedMask = maskBody(sharedSource);
}
writeFileSync(join(sourceDir, sharedName), `// ${base} 测试共享夹具与助手：自 ${base}.test.ts 机械平移（语义零改动）。\n\n${emitSupersetImports("shared")}\n\n${sharedSource}\n`, "utf8");

// ---- 各段：全量导出本段顶层声明 + 超集导入 + 写盘 ------------------------------
const derived = partBodies.map((body) => ({ body, mask: maskBody(body) }));
for (const part of derived) {
	for (const [name, info] of decls) {
		if (typeof info.home !== "number" || info.exported) continue;
		const next = promoteExport(part.body, part.mask, name);
		if (next === false) continue;
		part.body = next;
		part.mask = maskBody(part.body);
		info.exported = true;
	}
}
derived.forEach((part, index) => {
	const label = index === 0 ? "第 1 段（留守原文件名）" : `第 ${index + 1} 段`;
	const note = `（共 ${partCount} 段；夹具在 ${sharedName}）`;
	const dest = index === 0 ? sourcePath : join(sourceDir, partName(index));
	writeFileSync(dest, `// ${base} 测试${label}${note}。\n// 机械平移自原 ${base}.test.ts，语义零改动。\n\n${emitSupersetImports(index, part.body)}\n\n${part.body}\n`, "utf8");
});
process.stdout.write(`${sharedName}: ${sharedSource.split("\n").length} 行夹具；共 ${partCount} 段：${derived.map((p, i) => `${partName(i)}=${p.body.split("\n").length}`).join(" ")}\n`);
