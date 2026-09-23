// 为阶段1新模块补齐外部 import（按 AST 词法使用分析），并处理保留在扩展里的
// 代码。保守策略：value 与 type 都保留（runtime strip-types 会把未使用的 type 擦除；
// typecheck 若有 unused 警告再说——tsconfig 通常不把它设为错误）。
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import ts from "typescript";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const extImports = JSON.parse(readFileSync(join(here, "ext-imports.json"), "utf8"));
const usage = JSON.parse(readFileSync(join(here, "usage-map.json"), "utf8"));
const srcLines = readFileSync(join(root, "extensions", "jero-ai.ts"), "utf8").split("\n");

const REGIONS = [
	{ module: "jero-ai-package-assets", from: 223, to: 321 },
	{ module: "jero-ai-background-subagents", from: 326, to: 550 },
	{ module: "jero-ai-writer-scope", from: 551, to: 939 },
	{ module: "jero-ai-rdd-status", from: 940, to: 1235 },
	{ module: "jero-ai-prompts", from: 1236, to: 1360 },
	{ module: "jero-ai-guardrails", from: 1361, to: 1633 },
	{ module: "jero-ai-path-guard", from: 1634, to: 1653 },
	{ module: "jero-ai-sdd-startup", from: 1654, to: 1903 },
	{ module: "jero-ai-herdr-confirm", from: 1904, to: 2008 },
	{ module: "jero-ai-persona-config", from: 2010, to: 2070 },
	{ module: "jero-ai-model-config", from: 2071, to: 2660 },
	{ module: "jero-ai-model-routing-apply", from: 2661, to: 2864 },
	{ module: "jero-ai-model-panel", from: 2865, to: 3508 },
	{ module: "jero-ai-profiles-panel", from: 3509, to: 4257 },
	{ module: "jero-ai-persona-command", from: 4258, to: 4278 },
];

// 名字 → 归属模块（阶段1 移出的名字）
const nameHome = new Map();
for (const [n, u] of Object.entries(usage)) {
	const r = REGIONS.find((rg) => u.line >= rg.from && u.line <= rg.to);
	if (r) nameHome.set(n, r.module);
}

// 每个模块的词法使用集合（含 type 位置）
function usedNamesOf(filePath) {
	const code = readFileSync(filePath, "utf8");
	const sf = ts.createSourceFile(filePath, code, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
	const used = new Set();
	const visit = (node) => {
		if (ts.isIdentifier(node)) used.add(node.text);
		ts.forEachChild(node, visit);
	};
	visit(sf);
	return { used, code };
}

for (const r of REGIONS) {
	const p = join(root, "lib", `${r.module}.ts`);
	const { used, code } = usedNamesOf(p);
	const blocks = [];
	for (const imp of extImports) {
		const wanted = imp.names.filter((n) => used.has(n.replace(/^type /, "")));
		if (wanted.length === 0) continue;
		// 原 import 是否整体 typeOnly
		const kw = imp.typeOnly ? "import type" : "import";
		const spec = imp.mod.startsWith("../lib/") ? imp.mod.replace("../lib/", "./") : imp.mod;
		blocks.push(`${kw} { ${wanted.join(", ")} } from "${spec}";`);
	}
	if (blocks.length === 0) continue;
	// 插在头部注释之后、第一条 import（若有）之前
	const lines = code.split("\n");
	let insertAt = 0;
	while (insertAt < lines.length && (lines[insertAt].startsWith("//") || lines[insertAt].trim() === "")) insertAt++;
	lines.splice(insertAt, 0, ...blocks, "");
	writeFileSync(p, lines.join("\n"));
	console.log(`${r.module}: +${blocks.length} import lines`);
}
