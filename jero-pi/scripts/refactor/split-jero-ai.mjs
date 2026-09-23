// jero-ai.ts 机械拆分器（阶段1：守卫/配置/panel 域）。
// 原则：块按声明边界整体移动；被跨域引用的名字由 usage-map 决定归属，
// 未导出的被引用名字自动加 export；消费文件自动补 import。不做语义改动。
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const SRC = join(root, "extensions", "jero-ai.ts");
const src = readFileSync(SRC, "utf8");
const lines = src.split("\n");
const usage = JSON.parse(readFileSync(join(here, "usage-map.json"), "utf8"));

// ---- 声明边界：块 = [上一个声明结束后, 下一个声明开始前) -------------------
// usage-map 给出了每个声明的起始行与"下一个声明-1"的结束行。但前一个声明
// 结束到下一个声明开始之间可能隔着注释/分隔线——这些头注归属于下一个声明。
// 策略：块起始 = 声明行向上回溯，吞掉紧邻的注释/空行/分隔线，但绝不超过上一个块的结束。
const declNames = Object.keys(usage);
const declByLine = new Map(); // line -> name
for (const n of declNames) declByLine.set(usage[n].line, n);

// 每个声明的"块"：start = 声明行向上吸收前导注释/空行（不越过上一声明行）
function computeBlocks() {
	const declLines = [...declByLine.keys()].sort((a, b) => a - b);
	const blocks = new Map(); // name -> {start, end}
	for (let i = 0; i < declLines.length; i++) {
		const line = declLines[i];
		const name = declByLine.get(line);
		const prevDeclLine = i > 0 ? declLines[i - 1] : 222; // 222 = import 区结束
		let start = line;
		while (start - 1 > prevDeclLine) {
			const above = lines[start - 2]; // 1-based -> 0-based
			if (above === undefined) break;
			const t = above.trim();
			if (t === "" || t.startsWith("//") || t.startsWith("*") || t.startsWith("/*") || t.startsWith("*/") || /^\/\*.*\*\/$/.test(t)) {
				start -= 1;
				continue;
			}
			break;
		}
		const end = usage[name].endLine; // 下一个声明行 - 1（含本声明体；头注已被下一个声明吸走的情况除外）
		blocks.set(name, { start, end });
	}
	return blocks;
}
const blocks = computeBlocks();

// ---- 阶段1 区域计划：名字集合（从 usage-map 按行号归属） -------------------
// 目标模块（lib/，平铺，jero-ai- 前缀）
const REGIONS = [
	{ module: "jero-ai-package-assets", from: 223, to: 321, header: "包资产审计：安装/陈旧/覆盖计数与 doctor 诊断行。纯只读检查，绝不写盘。" },
	{ module: "jero-ai-background-subagents", from: 326, to: 550, header: "后台子代理策略：on/off 配置的解析、决议与渲染。唯一写入者是用户命令，自动化绝不触碰。" },
	{ module: "jero-ai-writer-scope", from: 551,  to: 939, header: "委托派发放行：SDD 代理名、有界 writer 的编辑面校验、Judgment Day 修复代理的规范块校验，以及子代理能力探测。" },
	{ module: "jero-ai-rdd-status", from: 940, to: 1235, header: "RDD 状态与编排器提示词：状态行渲染（保守失败、记忆化）、原生评审结果备忘、评审计划解析、编排器提示词装载。" },
	{ module: "jero-ai-prompts", from: 1236, to: 1360, header: "提示词构建：persona 模板、评审执行契约镜像片段装载、gentle 提示词组装。" },
	{ module: "jero-ai-guardrails", from: 1361, to: 1633, header: "危险命令护栏：bash 命令分类（block/confirm/allow）、配置文件解析、确认标题与预览。安全策略独立且权威。" },
	{ module: "jero-ai-path-guard", from: 1634, to: 1653, header: "敏感路径护栏：read/write/edit 工具的路径输入收集与拒绝。与命令护栏同级、互不依赖。" },
	{ module: "jero-ai-sdd-startup", from: 1654, to: 1903, header: "SDD 启动解析：代理启动事件识别、SDD 变更选择与启动状态解析、内存工具探测。" },
	{ module: "jero-ai-herdr-confirm", from: 1904, to: 2008, header: "护栏确认生命周期与 bash 确认编排：权限事件配对、阻塞标签、交互确认流程。" },
	{ module: "jero-ai-persona-config", from: 2010, to: 2070, header: "persona 与配置主目录：配置路径解析、persona 文件读写。被提示词构建与 persona 命令共用。" },
	{ module: "jero-ai-model-config", from: 2071, to: 2660, header: "模型路由配置：models.json 的读写/导出/导入、frontmatter 路由、子代理 profile 物化、代理发现。" },
	{ module: "jero-ai-model-routing-apply", from: 2661, to: 2864, header: "模型路由应用：provider 评审角色、默认标签、旧项目覆盖迁移、applyModelConfig 系列。" },
	{ module: "jero-ai-model-panel", from: 2865, to: 3508, header: "模型面板 TUI：/jero:models 的全屏交互面板（SddModelPanel）。" },
	{ module: "jero-ai-profiles-panel", from: 3509, to: 4257, header: "档案面板 TUI：/jero:profiles 的全屏交互面板（ProfilesPanel）与档案动作执行。" },
	{ module: "jero-ai-persona-command", from: 4258, to: 4278, header: "persona 命令处理器：/jero:persona。" },
	// 评审域（4283-8063）与运行时装配（8064+）在阶段2/3。
];

// 区域归属：decl 行 ∈ [from,to] 的进入该模块；其余留在 extensions/jero-ai.ts
const regionOfLine = (l) => REGIONS.findIndex((r) => l >= r.from && l <= r.to);
const members = new Map(REGIONS.map((r) => [r.module, []]));
for (const n of declNames) {
	const u = usage[n];
	const ri = regionOfLine(u.line);
	if (ri >= 0) members.get(REGIONS[ri].module).push(n);
}

// ---- 跨模块引用：谁要 export、谁要 import --------------------------------
// 名字 N 归属模块 M；若 N 被行号落在 M 之外的代码引用，则 N 必须 export。
const nameRegion = new Map();
for (const n of declNames) {
	const ri = regionOfLine(usage[n].line);
	if (ri >= 0) nameRegion.set(n, REGIONS[ri].module);
}
const needsExport = new Map(REGIONS.map((r) => [r.module, new Set()])); // module -> names
const extensionNeeds = new Set(); // 扩展需要从新模块 import 的名字
const moduleNeeds = new Map(REGIONS.map((r) => [r.module, new Map()])); // module -> (homeModule -> names)

for (const n of declNames) {
	const u = usage[n];
	const home = nameRegion.get(n);
	if (home === undefined) continue; // 留在扩展里的名字不导出
	for (const refLine of u.refsOutsideOwnRange) {
		const ri = regionOfLine(refLine);
		const refHome = ri >= 0 ? REGIONS[ri].module : "EXTENSION";
		if (refHome === home) continue;
		needsExport.get(home).add(n);
		if (refHome === "EXTENSION") extensionNeeds.add(n);
		else {
			const m = moduleNeeds.get(refHome);
			if (!m.get(home)) m.set(home, []);
			m.get(home).push(n);
		}
	}
}

// ---- 生成新模块 ------------------------------------------------------------
const written = [];
for (const r of REGIONS) {
	const names = members.get(r.module);
	if (names.length === 0) continue;
	const exports = needsExport.get(r.module);
	const imports = moduleNeeds.get(r.module);
	const out = [];
	out.push(...headerBlock(r.header, imports));
	// import 行：从其他新模块
	for (const [home, names2] of [...imports.entries()].sort()) {
		const uniq = [...new Set(names2)].sort();
		out.push(`import { ${uniq.join(", ")} } from "./${home}.ts";`);
	}
	if (imports.size > 0) out.push("");
	// 块按原顺序
	const ordered = names.sort((a, b) => usage[a].line - usage[b].line);
	for (const n of ordered) {
		const b = blocks.get(n);
		const chunk = lines.slice(b.start - 1, b.end); // 1-based inclusive
		// 若需导出且原本无 export，给声明头加 export
		if (exports.has(n) && !usage[n].exported) {
			for (let i = 0; i < chunk.length; i++) {
				const line = chunk[i];
				if (/^(async )?(function|const|class|interface|type|enum|let) /.test(line)) {
					chunk[i] = line.replace(/^(async )?/, (m) => `export ${m}`);
					break;
				}
			}
		}
		out.push(...chunk);
		out.push("");
	}
	const path = join(root, "lib", `${r.module}.ts`);
	writeFileSync(path, out.join("\n").replace(/\n{3,}/g, "\n\n"));
	written.push(path);
	console.log(`wrote lib/${r.module}.ts (${out.join("\n").split("\n").length} lines, ${names.length} decls, exports ${exports.size})`);
}

function headerBlock(title, imports) {
	// 新模块的外部 import 由阶段2统一补齐（现在先占位 TODO 会编译失败——
	// 所以这里直接从原文件 import 区推导本模块用到的外部符号）。
	return [
		`// ${title}`,
		`// 自 extensions/jero-ai.ts 拆分（机械平移，语义零改动）。`,
		``,
	];
}

console.log("\nextension needs imports from new modules:");
const byHome = new Map();
for (const n of extensionNeeds) {
	const home = nameRegion.get(n);
	if (!byHome.get(home)) byHome.set(home, []);
	byHome.get(home).push(n);
}
for (const [home, names] of [...byHome.entries()].sort()) {
	console.log(`  from ./${home}: ${names.sort().join(", ")}`);
}
writeFileSync(join(here, "stage1-extension-imports.json"), JSON.stringify([...byHome.entries()].map(([h, ns]) => ({ from: h, names: ns.sort() })), null, 2));
