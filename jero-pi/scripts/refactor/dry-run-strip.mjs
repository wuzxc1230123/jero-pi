// 干跑：模拟 strip-extension.mjs 的移除逻辑，报告移除后扩展里仍被引用的"已迁走符号"
// （这些是必须改为 import 新模块的位置）。
import { readFileSync } from "node:fs";

const usage = JSON.parse(readFileSync("scripts/refactor/usage-map.json", "utf8"));
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

const nameHome = new Map();
const removedLines = new Set();
for (const [name, u] of Object.entries(usage)) {
	const r = REGIONS.find((rg) => u.line >= rg.from && u.line <= rg.to);
	if (r) {
		nameHome.set(name, r.module);
		for (let l = u.line; l <= u.endLine; l += 1) removedLines.add(l);
	}
}

const lines = readFileSync("extensions/jero-ai.ts", "utf8").split("\n");
const remaining = lines.filter((_, i) => !removedLines.has(i + 1));
const remainingText = remaining.join("\n");

// 在移除后的文本里找每个已迁走符号的引用
const hits = new Map(); // module -> Map(name -> [lineNumbers])
for (const [name, module] of nameHome) {
	const re = new RegExp(String.raw`\b` + name + String.raw`\b`, "g");
	let m;
	let count = 0;
	while ((m = re.exec(remainingText)) !== null) count += 1;
	if (count > 0) {
		if (!hits.has(module)) hits.set(module, []);
		hits.get(module).push(`${name}×${count}`);
	}
}

let total = 0;
for (const [module, names] of [...hits].sort()) {
	total += names.length;
	console.log(`\n[${module}] ${names.length} 个符号仍被引用:`);
	for (const n of names) console.log("  " + n);
}
console.log(`\n=== 移除后仍被引用的已迁走符号总数: ${total}（分布在 ${hits.size} 个模块）===`);
console.log(`=== 移除后扩展行数: ${remaining.length}（原 ${lines.length}）===`);
