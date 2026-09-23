// 全量拆分计划 v3：严格无环（函数级叶子，循环成员按入边最多者归宿主）。
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const usage = JSON.parse(readFileSync(join(here, "usage-map.json"), "utf8"));

// 叶子（按序匹配）——评审域全部细分为函数级叶子
const LEAVES = [
	["jero-ai-package-assets", 223, 321],
	["jero-ai-background-subagents", 326, 550],
	["jero-ai-writer-scope", 551, 939],
	["jero-ai-rdd-status", 940, 1235],
	["jero-ai-prompts", 1236, 1360],
	["jero-ai-guardrails", 1361, 1633],
	["jero-ai-path-guard", 1634, 1653],
	["jero-ai-sdd-startup", 1654, 1903],
	["jero-ai-herdr-confirm", 1904, 2008],
	["jero-ai-model-config", 2010, 2864],
	["jero-ai-model-panel", 2865, 3508],
	["jero-ai-profiles-panel", 3509, 4257],
	["jero-ai-persona-command", 4258, 4278],
	["jero-ai-review-schema", 4283, 4283],
	["jero-ai-review-schema", 4304, 4442],
	["jero-ai-review-schema", 4500, 4516],
	["jero-ai-review-parse", 4443, 4499],
	["jero-ai-review-parse", 4517, 4774],
	["jero-ai-review-misc", 4774, 4785],     // isGraphV1JudgmentDayLineage 孤儿
	["jero-ai-review-mode-gate", 4786, 4954],
	["jero-ai-review-maintenance", 4955, 5192],
	["jero-ai-review-start", 5193, 5358],
	["jero-ai-review-consent", 5359, 5675],
	["jero-ai-review-native-start", 5676, 5926],
	["jero-ai-review-workspace", 5927, 6102],
	["jero-ai-review-relay", 6103, 6443],
	["jero-ai-review-provider-vector", 6444, 6552],
	["jero-ai-review-transport", 6553, 6665],
	["jero-ai-review-binding", 6666, 6873],
	["jero-ai-review-capture", 6874, 7125],
	["jero-ai-review-controller", 7126, 8063],
	["EXTENSION", 8064, 9042],
];
const leafOf = (line) => { const l = LEAVES.find(([, a, b]) => line >= a && line <= b); return l ? l[0] : "EXTENSION"; };

const names = Object.keys(usage);
const ownerOfRef = new Map();
for (const n of names) for (let l = usage[n].line; l <= usage[n].endLine; l++) ownerOfRef.set(l, n);

const consumers = new Map();
for (const n of names) {
	const set = new Map(); // consumerModule -> count
	for (const rl of usage[n].refsOutsideOwnRange) {
		const owner = ownerOfRef.get(rl);
		const c = owner ? leafOf(usage[owner].line) : leafOf(rl);
		set.set(c, (set.get(c) ?? 0) + 1);
	}
	consumers.set(n, set);
}

// 手工提升（防环 + 语义归属）
const HOIST = {
	pathExists: "jero-ai-model-config",
	PersonaMode: "jero-ai-model-config",
	PERSONA_OPTIONS: "jero-ai-model-config",
};

const plan = {};
for (const n of names) {
	const home = leafOf(usage[n].line);
	if (HOIST[n]) { plan[n] = HOIST[n]; continue; }
	if (home === "EXTENSION") { plan[n] = "EXTENSION"; continue; }
	plan[n] = home;
}

// 迭代破环：计算模块图，若有环，把环上"被引用入边最多集中在他域"的声明迁移到其主要消费域
for (let round = 0; round < 8; round++) {
	const mods = [...new Set(Object.values(plan).filter((m) => m !== "EXTENSION"))];
	const edges = new Map(); // home -> Set<consumer>
	for (const n of names) {
		const home = plan[n];
		if (home === "EXTENSION") continue;
		for (const [c] of consumers.get(n)) {
			if (c !== home && c !== "EXTENSION") {
				if (!edges.get(home)) edges.set(home, new Set());
				edges.get(home).add(c);
			}
		}
	}
	const indeg = Object.fromEntries(mods.map((m) => [m, 0]));
	const adj = new Map();
	for (const [home, cs] of edges) for (const c of cs) { if (!adj.get(home)) adj.set(home, new Set()); if (!adj.get(home).has(c)) { adj.get(home).add(c); indeg[c]++; } }
	const q = mods.filter((m) => indeg[m] === 0); const seen = new Set(); const order = [];
	while (q.length) { const m = q.shift(); if (seen.has(m)) continue; seen.add(m); order.push(m); for (const c of adj.get(m) ?? []) { indeg[c]--; if (indeg[c] === 0) q.push(c); } }
	if (order.length === mods.length) {
		console.log(`DAG OK after ${round} round(s). Build order:`);
		console.log(order.join("\n"));
		break;
	}
	const cyclic = mods.filter((m) => !seen.has(m));
	console.log(`round ${round}: cycle among [${cyclic.join(", ")}]`);
	// 找环上最强的矛盾边：声明 n 在 home，但其消费者主要在 consumer 模块，且 home<->consumer 双向
	let moved = 0;
	for (const n of names) {
		const home = plan[n];
		if (home === "EXTENSION" || !cyclic.includes(home)) continue;
		const cons = consumers.get(n);
		for (const [c] of cons) {
			if (c === "EXTENSION" || c === home || !cyclic.includes(c)) continue;
			// home 被 c 依赖；若 c 也被 home 依赖（双向），且 n 的主要消费者是 c → 把 n 迁到 c
			const back = [...(edges.get(c) ?? [])].includes(home);
			if (!back) continue;
			const total = [...cons.entries()].filter(([cc]) => cc !== "EXTENSION").reduce((s, [, k]) => s + k, 0);
			const toC = cons.get(c) ?? 0;
			if (toC >= Math.max(1, Math.floor(total / 2))) {
				plan[n] = c;
				console.log(`  move ${n}: ${home} -> ${c} (refs ${toC}/${total})`);
				moved++;
				break;
			}
		}
		if (moved) break; // 一轮移一个，保持可解释
	}
	if (!moved) {
		console.log("  no single-decl move found; dumping cyclic edges:");
		for (const m of cyclic) console.log(`  ${m} <- ${[...(edges.get(m) ?? [])].filter((c) => cyclic.includes(c)).join(", ")}`);
		break;
	}
}
writeFileSync(join(here, "full-plan.json"), JSON.stringify(plan, null, 2));
const stats = {};
for (const [n, m] of Object.entries(plan)) { stats[m] ??= 0; stats[m] += usage[n].endLine - usage[n].line + 1; }
console.log("\nestimated lines:"); for (const [m, l] of Object.entries(stats).sort((a, b) => b[1] - a[1])) console.log(`  ${m}: ~${l}`);
