// 通用机械拆分器：把单个 TS 模块按声明区间切成多个子模块。
// 用法：node split-module.mjs <config.json>
// 配置：{ source, modules: [{ name, file, dir, header, ranges }],
//        barrel: bool | remainder: { header, ranges } }（barrel 与 remainder 二选一）
// 规则：
//   - 块按行区间整体平移，语义零改动；
//   - 自动解析源文件 import 区（具名/默认/纯类型 re-export）与顶层声明；
//   - 每个子模块的 import 由"标识符在正文中的出现"推导；使用检测剥离
//     注释与字符串字面量，`typeof X` 视为类型位置使用；
//   - 跨模块引用的内部声明自动补 export；
//   - barrel：源文件替换为纯再导出门面；remainder：源文件保留指定区间
//     （如默认导出装配函数），追加迁移模块的 import 与 re-export。
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const configPath = process.argv[2];
if (!configPath) throw new Error("usage: split-module.mjs <config.json>");
const config = JSON.parse(readFileSync(configPath, "utf8"));
const here = dirname(fileURLToPath(import.meta.url));

const resolvePath = (p) => (p.isAbsolute ? p : join(here, "..", "..", p));
const sourcePath = resolvePath(config.source);
const sourceDir = dirname(sourcePath);
const lines = readFileSync(sourcePath, "utf8").split("\n");

// ---- 解析 import 区与顶层声明 ------------------------------------------------
const externals = new Map(); // name -> { module, kind: "value"|"type", reexport, default }
const declRe = /^(export\s+)?(?:async\s+)?(function|class|const|let|interface|type|enum)\s+([A-Za-z_$][\w$]*)/;
const decls = new Map(); // name -> { kind, exported, line }
let importEnd = 0; // 头部连续 import 区末行（1-based）
let sawDecl = false; // 首个顶层声明之后不再扩展 import 区
let inBlockComment = false;
for (let i = 0; i < lines.length; i++) {
	const line = lines[i];
	const trimmed = line.trim();
	if (inBlockComment) {
		if (trimmed.includes("*/")) inBlockComment = false;
		continue;
	}
	if (trimmed.startsWith("/*") && !trimmed.includes("*/")) {
		inBlockComment = true;
		continue;
	}
	if (trimmed.startsWith("import ") || /^export\s+\{/.test(trimmed) || /^export\s+type\s+\{/.test(trimmed)) {
		let stmt = line;
		let j = i;
		while (!/(^|[^{])\}\s*from\s+"[^"]+";?\s*$/.test(stmt) && !/;\s*$/.test(stmt) && j + 1 < lines.length) {
			j += 1;
			stmt += "\n" + lines[j];
		}
		const fromMatch = stmt.match(/from\s+"([^"]+)"/);
		if (fromMatch) {
			const isReexport = /^export/.test(trimmed);
			const stmtLevelType = /^import\s+type\s+\{/.test(stmt);
			if (stmt.includes("{")) {
				const specifiers = stmt.slice(stmt.indexOf("{") + 1, stmt.lastIndexOf("}"));
				for (const raw of specifiers.split(",")) {
					const spec = raw.trim();
					if (!spec) continue;
					const typeMatch = spec.match(/^type\s+([A-Za-z_$][\w$]*)$/);
					const valueMatch = spec.match(/^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/);
					const name = typeMatch ? typeMatch[1] : valueMatch ? (valueMatch[2] || valueMatch[1]) : null;
					if (name) {
						const existing = externals.get(name);
						// 同名既出现在头部 import 又出现在尾部 re-export 时，保留头部
						// 事实（reexport=false）：装配区仍需按名导入；尾部 re-export
						// 语句本身随留守区间原样保留，不受此处影响。
						if (!existing || existing.reexport || !isReexport) {
							externals.set(name, { module: fromMatch[1], kind: typeMatch || stmtLevelType ? "type" : "value", reexport: isReexport, default: false, orig: valueMatch && valueMatch[2] ? valueMatch[1] : undefined });
						}
					}
				}
			} else {
				const defaultMatch = stmt.match(/^import\s+([A-Za-z_$][\w$]*)\s+from/m);
				const namespaceMatch = stmt.match(/^import\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from/m);
				if (namespaceMatch) externals.set(namespaceMatch[1], { module: fromMatch[1], kind: "value", reexport: false, default: false, namespace: true });
				else if (defaultMatch) externals.set(defaultMatch[1], { module: fromMatch[1], kind: "value", reexport: false, default: true });
			}
			// import 区 = 文件头部、首个顶层声明之前的连续 import/re-export 语句；
			// 文件尾部补写的 re-export（如 stage1 的兼容再导出）不属于 import 区。
			if (!sawDecl) importEnd = j + 1;
		}
		i = j;
		continue;
	}
	if (trimmed === "" || trimmed.startsWith("//")) continue;
	const m = line.match(declRe);
	if (m) {
		sawDecl = true;
		const [, exported, keyword, name] = m;
		decls.set(name, {
			kind: keyword === "interface" || keyword === "type" ? "type" : "value",
			exported: Boolean(exported),
			line: i + 1,
		});
	}
}

// ---- 切片、模块目标与路径工具 -------------------------------------------------
const bodies = {};
const moduleFile = {};
const moduleDest = {}; // name -> 目标路径（模块可落在源文件之外的同包目录）
for (const mod of config.modules) {
	moduleFile[mod.name] = `./${mod.file.replace(/\.ts$/, "")}.ts`;
	moduleDest[mod.name] = join(sourceDir, mod.dir || ".", mod.file);
	bodies[mod.name] = mod.ranges
		.map(([a, b]) => lines.slice(a - 1, b).join("\n"))
		.join("\n\n");
}
// 外部依赖的 import 说明符以源文件位置为基准；落到其他目录的模块需重定根。
const rerootSpec = (spec, fromDir) => {
	if (!spec.startsWith(".")) return spec;
	const absolute = resolve(sourceDir, spec);
	const rel = relative(fromDir, absolute).split("\\").join("/");
	return rel.startsWith(".") ? rel : `./${rel}`;
};
const importSpecTo = (fromDir, destPath) => {
	const rel = relative(fromDir, destPath.replace(/\.ts$/, "")).split("\\").join("/");
	return (rel.startsWith(".") ? rel : `./${rel}`) + ".ts";
};

// ---- 使用检测：剥离注释与字符串字面量，保留模板插值内容 ----------------------
const scanBody = (body) =>
	body
		.replace(/\/\*[\s\S]*?\*\//g, " ")
		.replace(/\/\/[^\n]*/g, " ")
		// 模板先于字符串：模板可内嵌引号，插值内容保留为可执行代码
		.replace(/`(?:[^`\\]|\\.)*`/g, (tpl) => (tpl.match(/\$\{[^}]*\}/g) || []).map((part) => part.slice(2, -1)).join(" ") || ' "" ')
		.replace(/"(?:[^"\\\n]|\\.)*"/g, ' "" ')
		.replace(/'(?:[^'\\\n]|\\.)*'/g, " '' ");

const usedIn = (body, name) => new RegExp(`\\b${name}\\b`).test(scanBody(body));
const usedAsValueIn = (body, name) => new RegExp(`(?<!typeof\\s)\\b${name}\\b`).test(scanBody(body));

const declHome = new Map();
for (const mod of config.modules) {
	for (const [name, info] of decls) {
		const inModule = mod.ranges.some(([a, b]) => info.line >= a && info.line <= b);
		if (!inModule) continue;
		if (declHome.has(name) && declHome.get(name) !== mod.name) {
			throw new Error(`声明 ${name} 的行 ${info.line} 落入多个模块区间`);
		}
		declHome.set(name, mod.name);
	}
}
const remainderRanges = config.remainder ? config.remainder.ranges : [];
const declInRemainder = (info) => remainderRanges.some(([a, b]) => info.line >= a && info.line <= b);

// ---- 依赖推导：为一段正文生成 import 语句 ------------------------------------
const promote = new Map(); // home -> Set<name>（需要补 export 的内部符号）
const promoteAsType = new Map(); // home -> Set<name>（仅类型使用，type 导入即可）
const recordPromote = (home, symbol, asType) => {
	if (!promote.has(home)) promote.set(home, new Set());
	promote.get(home).add(symbol);
	if (asType) {
		if (!promoteAsType.has(home)) promoteAsType.set(home, new Set());
		promoteAsType.get(home).add(symbol);
	}
};

const deriveImports = (body, fromDir, opts) => {
	const { skipExternals = false, crossFilter = null } = opts || {};
	const byModule = new Map();
	const recordImport = (moduleName, entry) => {
		if (!byModule.has(moduleName)) byModule.set(moduleName, []);
		byModule.get(moduleName).push(entry);
	};
	if (!skipExternals) {
		for (const [symbol, info] of externals) {
			if (info.reexport) continue;
			if (usedIn(body, symbol)) recordImport(rerootSpec(info.module, fromDir), { name: symbol, kind: info.kind, default: info.default, namespace: info.namespace, orig: info.orig });
		}
	}
	for (const [symbol, info] of decls) {
		const home = declHome.get(symbol);
		if (!home) continue;
		if (crossFilter && !crossFilter(home)) continue;
		if (usedIn(body, symbol)) {
			const kind = info.kind === "type" || !usedAsValueIn(body, symbol) ? "type" : "value";
			recordImport(importSpecTo(fromDir, moduleDest[home]), { name: symbol, kind, default: false });
			if (!info.exported) recordPromote(home, symbol, kind === "type");
		}
	}
	// 紧凑导入格式：短列表单行，长列表按 100 列折行（节省行数预算）
	const formatGroup = (entries) => {
		const items = entries
			.map((e) => {
				if (e.default) return `${e.name} as default`;
				const spec = e.orig ? `${e.orig} as ${e.name}` : e.name;
				return e.kind === "type" ? `type ${spec}` : spec;
			})
			.sort((a, b) => a.replace(/^(type )/, "").localeCompare(b.replace(/^(type )/, "")));
		const single = items.join(", ");
		const specifier = `import { ${single} } from`;
		if (specifier.length <= 120) return single;
		const out = [];
		let current = "";
		for (const item of items) {
			const candidate = current ? `${current}, ${item}` : item;
			if (candidate.length > 96 && current) {
				out.push(current + ",");
				current = item;
			} else {
				current = candidate;
			}
		}
		if (current) out.push(current);
		return out.join("\n\t");
	};
	const defaults = [];
	const namespaces = [];
	const named = [];
	for (const [moduleName, entries] of byModule) {
		const nsEntry = entries.find((e) => e.namespace);
		const others = entries.filter((e) => !e.namespace);
		if (nsEntry) namespaces.push(`import * as ${nsEntry.name} from "${moduleName}";`);
		if (others.length === 0) continue;
		const group = formatGroup(others);
		const stmt = group.includes("\n")
			? `import {\n\t${group}\n} from "${moduleName}";`
			: `import { ${group} } from "${moduleName}";`;
		if (others.some((e) => e.default)) {
			const def = others.find((e) => e.default);
			defaults.push(`import ${def.name} from "${moduleName}";`);
			if (others.some((e) => !e.default)) named.push(stmt);
		} else {
			named.push(stmt);
		}
	}
	return [...namespaces, ...defaults, ...named].join("\n");
};

// ---- 生成各模块 ----------------------------------------------------------------
const output = {};
for (const mod of config.modules) {
	const body = bodies[mod.name];
	const modDir = dirname(moduleDest[mod.name]);
	const imports = deriveImports(body, modDir, { crossFilter: (home) => home !== mod.name });
	output[mod.name] = `${mod.header}\n${imports ? `\n${imports}\n` : "\n"}${body}\n`;
}

// remainder：源文件保留区间 + 新模块 import + re-export -------------------------
let remainderSource = null;
if (config.remainder) {
	const kept = config.remainder.ranges
		.map(([a, b]) => lines.slice(a - 1, b).join("\n"))
		.join("\n\n");
	// 留守区间若保留了原 import 块，外部依赖不再重推导（避免重复标识符）；
	// 若留守区间不含 import 区（如仅保留装配函数），则按使用重推导并压缩。
	const keepsImportBlock = config.remainder.ranges.some(([a, b]) => a <= importEnd && b >= 1);
	if (process.env.SPLIT_DEBUG) console.error(`[split] importEnd=${importEnd} keepsImportBlock=${keepsImportBlock} externals=${externals.size}`);
	const imports = deriveImports(kept, sourceDir, { skipExternals: keepsImportBlock, crossFilter: () => true });
	// 迁移模块若引用留守声明，留守侧需要提升导出
	for (const [symbol, info] of decls) {
		if (declHome.get(symbol) || !declInRemainder(info)) continue;
		for (const mod of config.modules) {
			if (usedIn(bodies[mod.name], symbol) && !info.exported) {
				recordPromote("__remainder__", symbol, false);
				break;
			}
		}
	}
	const reexports = config.modules.map((mod) => `export * from "${importSpecTo(sourceDir, moduleDest[mod.name])}";`).join("\n");
	const headerBlock = config.remainder.header ? `${config.remainder.header}\n` : "";
	remainderSource = `${headerBlock}${kept}\n\n${imports}\n\n${reexports}\n`;
}

// ---- 内部符号导出提升（所有正文定稿后统一应用）-------------------------------
const applyPromote = (body, home) => {
	const names = promote.get(home);
	if (!names) return body;
	for (const symbol of names) {
		const re = new RegExp(`(^|\\n)(?:async\\s+)?(const|function|interface|class|let|type) ${symbol}\\b`);
		const match = body.match(re);
		if (!match) throw new Error(`无法提升导出：${home}/${symbol}`);
		const at = match.index + match[1].length;
		body = body.slice(0, at) + "export " + body.slice(at);
	}
	return body;
};

for (const mod of config.modules) {
	const final = applyPromote(output[mod.name], mod.name);
	writeFileSync(moduleDest[mod.name], final, "utf8");
	process.stdout.write(`${mod.dir ? mod.dir + "/" : ""}${mod.file}: ${final.split("\n").length} 行\n`);
}

if (remainderSource) {
	const final = applyPromote(remainderSource, "__remainder__");
	writeFileSync(sourcePath, final, "utf8");
	process.stdout.write(`${config.source}: remainder ${final.split("\n").length} 行\n`);
}

if (config.barrel) {
	const reexports = [];
	let reexportModule = null;
	for (const [symbol, info] of externals) {
		if (!info.reexport) continue;
		reexports.push(`${info.kind === "type" ? "type " : ""}${symbol}`);
		reexportModule = info.module;
	}
	const parts = [];
	if (reexports.length > 0) parts.push(`export { ${reexports.join(", ")} } from "${reexportModule}";`);
	for (const mod of config.modules) parts.push(`export * from "${importSpecTo(sourceDir, moduleDest[mod.name])}";`);
	for (const extra of config.barrelExtras || []) parts.push(extra);
	const barrel = `${config.barrelHeader || "// 兼容门面：拆分后统一再导出，消费方 import 路径不变。"}\n${parts.join("\n")}\n`;
	writeFileSync(sourcePath, barrel, "utf8");
	process.stdout.write(`${config.source}: barrel ${barrel.split("\n").length} 行\n`);
}
