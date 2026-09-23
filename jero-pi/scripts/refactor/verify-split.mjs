import { readFileSync, readdirSync, existsSync } from "node:fs";

const src = readFileSync("extensions/jero-ai.ts", "utf8");
const symDefs = new Set();
for (const m of src.matchAll(/^(?:export\s+)?(?:async\s+)?(?:function|const|class)\s+([A-Za-z_$][\w$]*)/gm)) symDefs.add(m[1]);

const mods = readdirSync("lib").filter((f) => /^jero-ai-.*\.ts$/.test(f) && f !== "jero-ai-renderer.ts").map((f) => f.replace(".ts", ""));
const dup = [], missing = [];
const EXPORT_RE = (n) => new RegExp("^export\\s+(?:async\\s+)?(?:function|const|class|type|interface)\\s+" + n.replace(/[$]/g, "\\$") + "\\b", "m");

for (const mod of mods) {
	const code = readFileSync("lib/" + mod + ".ts", "utf8");
	for (const m of code.matchAll(/^export\s+(?:async\s+)?(?:function|const|class|type|interface)\s+([A-Za-z_$][\w$]*)/gm)) {
		if (symDefs.has(m[1])) dup.push(mod + ":" + m[1]);
	}
	for (const m of code.matchAll(/^import\s*\{([^}]+)\}\s*from\s*"(\.\/jero-ai[^"]+)"/gm)) {
		const names = m[1].split(",").map((s) => s.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0]).filter(Boolean);
		const target = m[2].replace("./", "").replace(".ts", "");
		if (!existsSync("lib/" + target + ".ts")) { missing.push(mod + " -> 缺失模块 " + target); continue; }
		const tcode = readFileSync("lib/" + target + ".ts", "utf8");
		for (const n of names) if (!EXPORT_RE(n).test(tcode)) missing.push(mod + ' 导入 "' + n + '" 但 ' + target + " 未导出");
	}
}
console.log("=== 重复符号(扩展与新模块各定义一份):", dup.length);
console.log("=== 悬空导入:", missing.length);
missing.slice(0, 25).forEach((m) => console.log("  MISS", m));

// 循环依赖
const graph = {};
for (const mod of mods) {
	const code = readFileSync("lib/" + mod + ".ts", "utf8");
	graph[mod] = [...code.matchAll(/from\s*"\.\/(jero-ai-[^"]+)\.ts"/g)].map((m) => m[1]);
}
const visited = {}, stack = [], cycles = [];
function dfs(n) {
	visited[n] = 1; stack.push(n);
	for (const d of graph[n] || []) {
		if (visited[d] === 1) cycles.push(stack.slice(stack.indexOf(d)).concat(d).join(" -> "));
		else if (!visited[d]) dfs(d);
	}
	stack.pop(); visited[n] = 2;
}
for (const n of Object.keys(graph)) if (!visited[n]) dfs(n);
console.log("=== 循环依赖:", cycles.length ? cycles.slice(0, 10) : "无");

// 外部 node 内置 / 包 import 是否缺失（新模块从扩展平移后 fix-imports 应已补齐）
console.log("=== 各新模块未解析的裸标识符抽检（top）===");
