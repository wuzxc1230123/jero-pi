#!/usr/bin/env node
/**
 * 迁移补丁 pass2：被移动文件内部的相对导入仍以旧目录为基准书写，
 * pass1 按新目录解析导致漏改。此脚本按导入方【旧位置】重新解析并重写。
 * 规则：oldTarget = join(dirname(旧路径), spec)
 *      newTarget = moveMap[oldTarget] ?? (文件存在则 oldTarget) ?? null
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, posix } from "node:path";

const root = join(import.meta.dirname, "..", "jero-pi");

const libDomains = {
	agents: ["agent-home", "agent-profiles", "agents-completion-delivery", "agents-config", "agents-history", "agents-messaging", "agents-protocol", "agents-runner", "agents-thread-view", "agents-transcript", "agents-view-layout", "agents-view", "agents-widget"],
	review: ["opaque-pi-reviewer-adapter", "review-candidate-view-owner", "review-candidate-view", "review-canonical", "review-compact-contract", "review-consent-component", "review-consent-latch", "review-consent-ui", "review-correction-lifecycle", "review-graph-schema", "review-host-relay", "review-integration-v2", "review-last-event-controller", "review-legacy-detector", "review-lock", "review-object-store", "review-policy-judgment-day", "review-policy-ordinary", "review-publication-gate", "review-relay-contract", "review-reminder-receipt", "review-repository", "review-risk-assessment", "review-risk", "review-session-standing-permission-ipc", "review-session-standing-permission", "review-snapshot", "review-transaction", "review-triggers"],
	shell: ["shell-bar", "shell-card", "shell-changes-view", "shell-changes", "shell-gauge", "shell-prompt", "shell-sidebar-banner", "shell-sidebar-layout", "shell-sidebar", "shell-todo", "shell-usage-view", "shell-usage"],
	metrics: ["runtime-metrics", "runtime-metrics-children", "runtime-metrics-delivery", "runtime-metrics-native", "runtime-metrics-policy"],
	sdd: ["openspec-deltas", "openspec-guardrails", "sdd-preflight", "sdd-research-capabilities", "sdd-status"],
	native: ["native-choice-list", "native-fullscreen-interaction", "native-pointer-region", "native-review-authority-quarantine", "native-review-cli"],
	core: ["gentle-ai-binary", "gentle-ai-renderer", "model-routing-authority", "orchestrator-presence", "profiles-orchestrator", "provider-contract-bundle", "quiet-tools-config", "session-worktree-registry", "telemetry-trigger", "terminal-theme"],
};
const moveMap = new Map();
for (const [dir, names] of Object.entries(libDomains)) for (const n of names) moveMap.set(`lib/${n}.ts`, `lib/${dir}/${n}.ts`);
for (const [o, n] of [
	["extensions/gentle-ai.ts", "extensions/jero-ai.ts"],
	["extensions/gentle-agents.ts", "extensions/jero-agents.ts"],
	["extensions/gentle-shell.ts", "extensions/jero-shell.ts"],
	["extensions/gentle-todo.ts", "extensions/jero-todo.ts"],
	["tests/gentle-ai.test.ts", "tests/jero-ai.test.ts"],
	["tests/gentle-agents.test.ts", "tests/jero-agents.test.ts"],
	["tests/gentle-shell.test.ts", "tests/jero-shell.test.ts"],
	["tests/gentle-todo.test.ts", "tests/jero-todo.test.ts"],
]) moveMap.set(o, n);
const inverse = new Map([...moveMap].map(([o, n]) => [n, o]));

const importRe = /((?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)["'])(\.{1,2}\/[^"']+)(["'])/g;
const relTo = (fromDir, target) => {
	let r = posix.relative(fromDir, posix.dirname(target));
	if (r === "") r = ".";
	return `${r === "." ? "." : r.startsWith("..") ? r : "./" + r}/${posix.basename(target)}`;
};

let fixed = 0, checked = 0;
const report = [];
for (const [newRel] of moveMap) {
	// newRel 这里遍历的是键（旧路径）——我们要处理的是【新路径】文件
}
for (const newRel of moveMap.values()) {
	const abs = join(root, newRel);
	if (!existsSync(abs)) { console.error(`missing ${newRel}`); process.exitCode = 1; continue; }
	const oldRel = inverse.get(newRel);
	let text = readFileSync(abs, "utf8");
	const orig = text;
	const oldDir = posix.dirname(oldRel);
	const newDir = posix.dirname(newRel);
	text = text.replace(importRe, (m, pre, spec, post) => {
		const oldTarget = posix.normalize(posix.join(oldDir, spec));
		const mapped = moveMap.get(oldTarget) ?? (existsSync(join(root, oldTarget)) ? oldTarget : null);
		if (!mapped) return m;
		const newSpec = relTo(newDir, mapped);
		if (newSpec === spec) return m;
		report.push(`${newRel}: ${spec} -> ${newSpec}`);
		return pre + newSpec + post;
	});
	checked++;
	if (text !== orig) { writeFileSync(abs, text); fixed++; }
}
console.log(`pass2: checked ${checked} moved files, fixed ${fixed}`);
for (const r of report.slice(0, 15)) console.log("  " + r);
console.log(`  ... total ${report.length} spec rewrites`);
