// 通用机械拆分器：把单个 TS 模块按声明区间切成多个子模块 + 兼容 barrel。
// 用法：node split-module.mjs <config.json>
// 配置：{ source, barrel: bool, modules: [{ name, file, header, ranges: [[a,b],...] }] }
// 规则：
//   - 块按行区间整体平移，语义零改动；
//   - 自动解析源文件 import 区（外部依赖）与顶层声明（含 export 标记）；
//   - 每个子模块的 import 由"标识符在正文中出现"推导，纯类型名带 type 前缀
//     （node strip-types 运行时不允许悬空的纯类型具名导入）；
//   - 被跨模块引用的内部声明自动补 export。
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const configPath = process.argv[2];
if (!configPath) throw new Error("usage: split-module.mjs <config.json>");
const config = JSON.parse(readFileSync(configPath, "utf8"));
const here = dirname(fileURLToPath(import.meta.url));

const resolvePath = (p) => (p.isAbsolute ? p : join(here, "..", "..", p));
const sourcePath = resolvePath(config.source);
const lines = readFileSync(sourcePath, "utf8").split("\n");

// ---- 解析 import 区与顶层声明 ------------------------------------------------
const externals = new Map(); // name -> { module, kind }
const declRe = /^(export\s+)?(?:async\s+)?(function|class|const|let|interface|type|enum)\s+([A-Za-z_$][\w$]*)/;
const decls = new Map(); // name -> { kind, exported, line }
let importEnd = 0;
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
	// import 语句（单行或多行）
	if (trimmed.startsWith("import ") || trimmed.startsWith("export {") || /^export\s+\{/.test(trimmed)) {
		// 收集到语句结束（分号且括号平衡）
		let stmt = line;
		let j = i;
		while (!/(^|[^{])\}\s*from\s+"[^"]+";?\s*$/.test(stmt) && !/;\s*$/.test(stmt) && j + 1 < lines.length) {
			j += 1;
			stmt += "\n" + lines[j];
		}
		const fromMatch = stmt.match(/from\s+"([^"]+)"/);
		if (fromMatch && stmt.includes("{")) {
			const specifiers = stmt.slice(stmt.indexOf("{") + 1, stmt.lastIndexOf("}"));
			for (const raw of specifiers.split(",")) {
				const spec = raw.trim();
				if (!spec) continue;
				const typeMatch = spec.match(/^type\s+([A-Za-z_$][\w$]*)$/);
				const valueMatch = spec.match(/^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/);
				const name = typeMatch ? typeMatch[1] : valueMatch ? (valueMatch[2] || valueMatch[1]) : null;
				if (name) externals.set(name, { module: fromMatch[1], kind: typeMatch ? "type" : "value", reexport: /^export/.test(trimmed) });
			}
		}
		importEnd = j + 1;
		i = j;
		continue;
	}
	if (trimmed === "" || trimmed.startsWith("//")) continue;
	const m = line.match(declRe);
	if (m) {
		const [, exported, keyword, name] = m;
		decls.set(name, {
			kind: keyword === "interface" || keyword === "type" ? "type" : "value",
			exported: Boolean(exported),
			line: i + 1,
		});
	}
}
if (importEnd === 0) importEnd = 0;

// ---- 切片并推导依赖 ----------------------------------------------------------
const bodies = {};
const moduleFile = {};
for (const mod of config.modules) {
	moduleFile[mod.name] = `./${mod.file.replace(/\.ts$/, "")}.ts`;
	bodies[mod.name] = mod.ranges
		.map(([a, b]) => lines.slice(a - 1, b).join("\n"))
		.join("\n\n");
}

const usedIn = (body, name) => new RegExp(`\\b${name}\\b`).test(body);
const declHome = new Map();
for (const mod of config.modules) {
	for (const [name, info] of decls) {
		if (info.line >= mod.ranges[0][0] && info.line <= mod.ranges[mod.ranges.length - 1][1]) {
			if (declHome.has(name) && declHome.get(name) !== mod.name) {
				throw new Error(`声明 ${name} 的行 ${info.line} 落入多个模块区间`);
			}
			declHome.set(name, mod.name);
		}
	}
}

const promote = new Map();
const output = {};
for (const mod of config.modules) {
	const body = bodies[mod.name];
	const extByModule = new Map();
	const crossByModule = new Map();
	const recordImport = (map, moduleName, entry) => {
		if (!map.has(moduleName)) map.set(moduleName, []);
		map.get(moduleName).push(entry);
	};
	for (const [symbol, info] of externals) {
		if (info.reexport) continue;
		if (usedIn(body, symbol)) recordImport(extByModule, info.module, { name: symbol, kind: info.kind });
	}
	for (const [symbol, info] of decls) {
		const home = declHome.get(symbol);
		if (!home || home === mod.name) continue;
		if (usedIn(body, symbol)) {
			recordImport(crossByModule, moduleFile[home], { name: symbol, kind: info.kind });
			if (!info.exported) {
				if (!promote.has(home)) promote.set(home, new Set());
				promote.get(home).add(symbol);
			}
		}
	}
	const formatGroup = (entries) =>
		entries
			.map((e) => (e.kind === "type" ? `type ${e.name}` : e.name))
			.sort((a, b) => a.replace(/^type /, "").localeCompare(b.replace(/^type /, "")))
			.join(",\n\t");
	const imports = [];
	for (const [moduleName, entries] of [...extByModule, ...crossByModule]) {
		imports.push(`import {\n\t${formatGroup(entries)}\n} from "${moduleName}";`);
	}
	output[mod.name] = `${mod.header}\n${imports.length > 0 ? `\n${imports.join("\n")}\n` : "\n"}${body}\n`;
}

// ---- 内部符号导出提升 ---------------------------------------------------------
for (const [home, names] of promote) {
	let body = output[home];
	for (const symbol of names) {
		const re = new RegExp(`(^|\\n)(const|function|interface|class|let|type) ${symbol}\\b`);
		const match = body.match(re);
		if (!match) throw new Error(`无法提升导出：${home}/${symbol}`);
		const at = match.index + match[1].length;
		body = body.slice(0, at) + "export " + body.slice(at);
	}
	output[home] = body;
}

for (const mod of config.modules) {
	const dest = join(dirname(sourcePath), mod.file);
	writeFileSync(dest, output[mod.name], "utf8");
	process.stdout.write(`${mod.file}: ${output[mod.name].split("\n").length} 行\n`);
}

if (config.barrel) {
	const reexports = [];
	for (const [symbol, info] of externals) {
		if (info.reexport) reexports.push(`${info.kind === "type" ? "type " : ""}${symbol}`);
	}
	const parts = [];
	if (reexports.length > 0) parts.push(`export { ${reexports.join(", ")} } from "${externals.get([...externals.keys()].find((k) => externals.get(k).reexport))?.module}";`);
	for (const mod of config.modules) parts.push(`export * from "./${mod.file.replace(/\.ts$/, "")}.ts";`);
	const barrel = `${config.barrelHeader || "// 兼容门面：拆分后统一再导出，消费方 import 路径不变。"}\n${parts.join("\n")}\n`;
	writeFileSync(sourcePath, barrel, "utf8");
	process.stdout.write(`${config.source}: barrel ${barrel.split("\n").length} 行\n`);
}
