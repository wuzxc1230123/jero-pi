#!/usr/bin/env node
/** pass3：修复 join() 分段式路径引用（pass1 只处理了完整路径字符串与相对导入） */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

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
const extRenames = { "gentle-ai.ts": "jero-ai.ts", "gentle-agents.ts": "jero-agents.ts", "gentle-shell.ts": "jero-shell.ts", "gentle-todo.ts": "jero-todo.ts" };

const rules = [];
for (const [dir, names] of Object.entries(libDomains)) {
	for (const n of names) rules.push([`"lib", "${n}.ts"`, `"lib", "${dir}", "${n}.ts"`]);
}
for (const [o, n] of Object.entries(extRenames)) rules.push([`"extensions", "${o}"`, `"extensions", "${n}"`]);
// 反斜杠形式（少数字符串拼接）
for (const [dir, names] of Object.entries(libDomains)) {
	for (const n of names) rules.push([`"lib\\\\", "${n}.ts"`, `"lib\\\\", "${dir}\\\\", "${n}.ts"`]);
}

let touched = 0;
const hits = [];
(function walk(dir) {
	for (const e of readdirSync(dir, { withFileTypes: true })) {
		if (e.name === "node_modules" || e.name === ".git") continue;
		const full = join(dir, e.name);
		if (e.isDirectory()) { walk(full); continue; }
		if (!/\.(ts|mjs)$/.test(e.name)) continue;
		let text = readFileSync(full, "utf8");
		const orig = text;
		for (const [o, n] of rules) if (text.includes(o)) { text = text.split(o).join(n); hits.push(`${full.slice(root.length + 1)}: ${o}`); }
		if (text !== orig) { writeFileSync(full, text); touched++; }
	}
})(root);
console.log(`pass3: ${touched} files, ${hits.length} segment refs fixed`);
for (const h of [...new Set(hits)]) console.log("  " + h);
