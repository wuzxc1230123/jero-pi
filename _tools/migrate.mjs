#!/usr/bin/env node
/**
 * jero-pi 模块重组迁移脚本（一次性工具，运行后删除）
 *
 * 1. lib/ 平铺 79 文件 → 7 个域目录（agents/review/shell/metrics/sdd/native/core）
 * 2. extensions/gentle-*.ts → jero-*.ts（4 个自有扩展；gentle-ai 外部二进制集成不动）
 * 3. docs/gentle-shell.md → docs/jero-shell.md
 * 4. 相对导入路径重写（按旧布局解析 → 新布局重新相对化）
 * 5. 硬编码路径字符串重写（lib/x.ts、extensions/gentle-ai.ts 等）
 * 6. 品牌替换：
 *    - gentle: → jero:            （全部为斜杠命令，已核实）
 *    - gentle-pi → jero-pi        （排除上游 URL/路径行：Gentle-Programming /
 *                                  gentle-ai-mirror / gentle-pi-installer / jsdelivr）
 *    - gentle-shell → jero-shell  （全部）
 *    排除文件：LICENSE、TRADEMARKS.md（上游法律文本）、pnpm-lock.yaml
 */
import { readdirSync, readFileSync, renameSync, mkdirSync, writeFileSync, statSync } from "node:fs";
import { dirname, join, posix } from "node:path";

const root = join(import.meta.dirname, "..", "jero-pi");

// ---------------------------------------------------------------------------
// 1. 移动映射
// ---------------------------------------------------------------------------
const libDomains = {
	agents: [
		"agent-home", "agent-profiles", "agents-completion-delivery", "agents-config",
		"agents-history", "agents-messaging", "agents-protocol", "agents-runner",
		"agents-thread-view", "agents-transcript", "agents-view-layout", "agents-view", "agents-widget",
	],
	review: [
		"opaque-pi-reviewer-adapter",
		"review-candidate-view-owner", "review-candidate-view", "review-canonical",
		"review-compact-contract", "review-consent-component", "review-consent-latch",
		"review-consent-ui", "review-correction-lifecycle", "review-graph-schema",
		"review-host-relay", "review-integration-v2", "review-last-event-controller",
		"review-legacy-detector", "review-lock", "review-object-store",
		"review-policy-judgment-day", "review-policy-ordinary", "review-publication-gate",
		"review-relay-contract", "review-reminder-receipt", "review-repository",
		"review-risk-assessment", "review-risk", "review-session-standing-permission-ipc",
		"review-session-standing-permission", "review-snapshot", "review-transaction", "review-triggers",
	],
	shell: [
		"shell-bar", "shell-card", "shell-changes-view", "shell-changes", "shell-gauge",
		"shell-prompt", "shell-sidebar-banner", "shell-sidebar-layout", "shell-sidebar",
		"shell-todo", "shell-usage-view", "shell-usage",
	],
	metrics: [
		"runtime-metrics", "runtime-metrics-children", "runtime-metrics-delivery",
		"runtime-metrics-native", "runtime-metrics-policy",
	],
	sdd: [
		"openspec-deltas", "openspec-guardrails", "sdd-preflight",
		"sdd-research-capabilities", "sdd-status",
	],
	native: [
		"native-choice-list", "native-fullscreen-interaction", "native-pointer-region",
		"native-review-authority-quarantine", "native-review-cli",
	],
	core: [
		"gentle-ai-binary", "gentle-ai-renderer", "model-routing-authority",
		"orchestrator-presence", "profiles-orchestrator", "provider-contract-bundle",
		"quiet-tools-config", "session-worktree-registry", "telemetry-trigger", "terminal-theme",
	],
};

/** @type {Map<string, string>} 旧仓库相对路径(正斜杠) → 新路径 */
const moveMap = new Map();
for (const [dir, names] of Object.entries(libDomains)) {
	for (const n of names) moveMap.set(`lib/${n}.ts`, `lib/${dir}/${n}.ts`);
}
const extRenames = [
	["extensions/gentle-ai.ts", "extensions/jero-ai.ts"],
	["extensions/gentle-agents.ts", "extensions/jero-agents.ts"],
	["extensions/gentle-shell.ts", "extensions/jero-shell.ts"],
	["extensions/gentle-todo.ts", "extensions/jero-todo.ts"],
	["docs/gentle-shell.md", "docs/jero-shell.md"],
	// 测试文件与扩展同源改名（纯对称性，glob 仍然匹配）
	["tests/gentle-ai.test.ts", "tests/jero-ai.test.ts"],
	["tests/gentle-agents.test.ts", "tests/jero-agents.test.ts"],
	["tests/gentle-shell.test.ts", "tests/jero-shell.test.ts"],
	["tests/gentle-todo.test.ts", "tests/jero-todo.test.ts"],
];
for (const [o, n] of extRenames) moveMap.set(o, n);

// ---------------------------------------------------------------------------
// 执行移动
// ---------------------------------------------------------------------------
let moved = 0;
for (const [oldRel, newRel] of moveMap) {
	const from = join(root, oldRel);
	const to = join(root, newRel);
	try { statSync(from); } catch { console.error(`MISS: ${oldRel}`); process.exitCode = 1; continue; }
	mkdirSync(dirname(to), { recursive: true });
	renameSync(from, to);
	moved++;
}
console.log(`moved: ${moved}/${moveMap.size}`);

// ---------------------------------------------------------------------------
// 遍历代码/文本文件
// ---------------------------------------------------------------------------
const codeExts = new Set([".ts", ".mjs"]);
const textExts = new Set([".ts", ".mjs", ".md", ".json", ".yml", ".yaml"]);
const brandExcluded = new Set(["LICENSE", "TRADEMARKS.md", "pnpm-lock.yaml"]);
const upstreamLine = /Gentle-Programming|gentle-ai-mirror|gentle-pi-installer|jsdelivr/;

/** @type {string[]} */
const allFiles = [];
(function walk(dir) {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (entry.name === "node_modules" || entry.name === ".git") continue;
		const full = join(dir, entry.name);
		if (entry.isDirectory()) { walk(full); continue; }
		const rel = posix.normalize(posix.join(...full.slice(root.length + 1).split(/[\\/]/)));
		const dot = entry.name.lastIndexOf(".");
		const ext = dot >= 0 ? entry.name.slice(dot) : "";
		if (textExts.has(ext) && !brandExcluded.has(entry.name)) allFiles.push(rel);
	}
})(root);

const relTo = (fromDir, target) => {
	let r = posix.relative(fromDir, posix.dirname(target));
	if (r === "") r = ".";
	const spec = `${r === "." ? "." : r.startsWith("..") ? r : "./" + r}/${posix.basename(target)}`;
	return spec;
};

// ---------------------------------------------------------------------------
// 4. 相对导入重写 + 5. 路径字符串重写 + 6. 品牌替换
// ---------------------------------------------------------------------------
const importRe = /((?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)["'])(\.{1,2}\/[^"']+)(["'])/g;
let filesTouched = 0;
for (const rel of allFiles) {
	const abs = join(root, rel);
	let text = readFileSync(abs, "utf8");
	const orig = text;
	const newImporter = moveMap.get(rel) ?? rel;
	const oldDir = posix.dirname(rel);
	const newDir = posix.dirname(newImporter);

	// 相对导入说明符：按旧布局解析 → 若目标被移动 → 相对化到导入方新位置
	text = text.replace(importRe, (m, pre, spec, post) => {
		const resolved = posix.normalize(posix.join(oldDir, spec));
		const mapped = moveMap.get(resolved);
		if (!mapped) return m;
		return pre + relTo(newDir, mapped) + post;
	});

	// 硬编码仓库相对路径字符串（scripts/tests/docs 中的 lib/…、extensions/… 字面量）
	for (const [o, n] of moveMap) {
		if (text.includes(o)) text = text.split(o).join(n);
	}

	// 品牌替换（逐行过滤上游引用行）
	const lines = text.split("\n");
	for (let i = 0; i < lines.length; i++) {
		if (upstreamLine.test(lines[i])) continue;
		if (!lines[i].includes("gentle")) continue;
		lines[i] = lines[i]
			.replace(/gentle:/g, "jero:")
			.replace(/gentle-pi/g, "jero-pi")
			.replace(/gentle-shell/g, "jero-shell");
	}
	text = lines.join("\n");

	if (text !== orig) { writeFileSync(abs, text); filesTouched++; }
}
console.log(`files rewritten: ${filesTouched}/${allFiles.length}`);

// 残留检查：除排除行外不应再有 gentle: / gentle-pi / gentle-shell
const leftovers = [];
for (const rel of allFiles) {
	const text = readFileSync(join(root, rel), "utf8");
	for (const [i, line] of text.split("\n").entries()) {
		if (upstreamLine.test(line)) continue;
		if (/gentle:|gentle-pi|gentle-shell/.test(line)) leftovers.push(`${rel}:${i + 1}: ${line.trim().slice(0, 100)}`);
	}
}
console.log(`brand leftovers: ${leftovers.length}`);
for (const l of leftovers.slice(0, 20)) console.log("  " + l);
