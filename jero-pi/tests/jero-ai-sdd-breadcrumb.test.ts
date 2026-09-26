import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import test from "node:test";

import { createJeroAiExtension } from "../extensions/jero-ai.ts";
import {
	applySddBreadcrumb,
	JERO_SDD_BREADCRUMB_MARKER,
	messageContainsSddBreadcrumb,
	renderSddBreadcrumb,
	sddBreadcrumbEnabled,
} from "../lib/jero-ai-sdd-breadcrumb.ts";
import { resolveSddStatus } from "../lib/sdd-status.ts";

// ---------------------------------------------------------------------------
// 纯逻辑：渲染门控与指纹
// ---------------------------------------------------------------------------

function tempRepo(prefix = "jero-sdd-crumb-"): string {
	return mkdtempSync(join(tmpdir(), prefix));
}

function seedActiveChange(root: string, name = "demo"): void {
	mkdirSync(join(root, "openspec", "changes", name, "specs", "core"), { recursive: true });
	writeFileSync(join(root, "openspec", "changes", name, "proposal.md"), "## Why\nredo the thing\n");
	writeFileSync(join(root, "openspec", "changes", name, "specs", "core", "spec.md"), "## Purpose\nkeep core stable\n");
	writeFileSync(join(root, "openspec", "changes", name, "design.md"), "## Context\nsmall change\n");
	writeFileSync(join(root, "openspec", "changes", name, "tasks.md"), "- [ ] implement core\n");
}

test("no breadcrumb without an openspec store or an active change", () => {
	const root = tempRepo();
	try {
		assert.equal(resolveSddStatus({ cwd: root }).isNonAuthoritative, true);
		assert.equal(renderSddBreadcrumb(resolveSddStatus({ cwd: root })), undefined);
		assert.equal(applySddBreadcrumb([], undefined), undefined, "no crumb and no stale message leaves the context untouched");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("an archived change renders no breadcrumb", () => {
	const root = tempRepo();
	mkdirSync(join(root, "openspec", "changes", "archive", "2026-01-01-demo"), { recursive: true });
	try {
		const status = resolveSddStatus({ cwd: root, changeName: "demo" });
		assert.ok(status.archived, "fixture must project the archived terminal state");
		assert.equal(renderSddBreadcrumb(status), undefined);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("an active change renders marker, fingerprint, change, next phase and task progress", () => {
	const root = tempRepo();
	seedActiveChange(root);
	try {
		const status = resolveSddStatus({ cwd: root });
		assert.equal(status.changeName, "demo");
		assert.equal(status.nextRecommended, "sdd-apply");
		const crumb = renderSddBreadcrumb(status)!;
		assert.ok(crumb.text.startsWith(`${JERO_SDD_BREADCRUMB_MARKER} ${crumb.fingerprint}`));
		assert.match(crumb.fingerprint, /^[0-9a-f]{16}$/);
		assert.ok(crumb.text.includes("- 变更: demo"));
		assert.ok(crumb.text.includes("- 下一步: sdd-apply"));
		assert.ok(crumb.text.includes("- 任务: 0/1 完成，剩余 1"));
		assert.ok(!crumb.text.includes("首个阻塞"), "a ready change has no blocker line");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("fingerprint follows the fields the breadcrumb shows", () => {
	const root = tempRepo();
	seedActiveChange(root);
	try {
		const base = resolveSddStatus({ cwd: root });
		const before = renderSddBreadcrumb(base)!.fingerprint;
		const afterProgress = renderSddBreadcrumb({
			...base,
			taskProgress: { ...base.taskProgress, complete: 1, remaining: 0 },
		})!.fingerprint;
		assert.notEqual(before, afterProgress, "task progress must move the fingerprint");
		const afterBlocker = renderSddBreadcrumb({
			...base,
			blockedReasons: ["proposal.md is missing."],
		})!.fingerprint;
		assert.notEqual(before, afterBlocker, "a new first blocker must move the fingerprint");
		const sameState = renderSddBreadcrumb({ ...base, planningHome: { ...base.planningHome } })!.fingerprint;
		assert.equal(before, sameState, "unshown fields must not move the fingerprint");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("JERO_PI_SDD_BREADCRUMB=0|false|off disables the breadcrumb, default on", () => {
	assert.equal(sddBreadcrumbEnabled({}), true);
	assert.equal(sddBreadcrumbEnabled({ JERO_PI_SDD_BREADCRUMB: undefined }), true);
	for (const off of ["0", "false", "off"]) {
		assert.equal(sddBreadcrumbEnabled({ JERO_PI_SDD_BREADCRUMB: off }), false, `${off} must disable`);
	}
	assert.equal(sddBreadcrumbEnabled({ JERO_PI_SDD_BREADCRUMB: "1" }), true);
});

// ---------------------------------------------------------------------------
// 纯逻辑：注入点、去重与陈旧替换
// ---------------------------------------------------------------------------

const CRUMB_A = { fingerprint: "aaaa1111aaaa1111", text: `${JERO_SDD_BREADCRUMB_MARKER} aaaa1111aaaa1111\n\n- 变更: demo` };
const CRUMB_B = { fingerprint: "bbbb2222bbbb2222", text: `${JERO_SDD_BREADCRUMB_MARKER} bbbb2222bbbb2222\n\n- 变更: demo` };

test("breadcrumb lands after leading compaction summaries", () => {
	const history = [
		{ role: "compactionSummary", content: "summary-a" },
		{ role: "user", content: "real turn" },
	];
	const messages = applySddBreadcrumb(history, CRUMB_A, () => 1234)!;
	assert.equal(messages.length, 3);
	assert.ok(messageContainsSddBreadcrumb(messages[1]), "breadcrumb must sit directly after the summaries");
	assert.equal((messages[2] as { content: string }).content, "real turn");
	const injected = messages[1] as { role: string; timestamp: number; content: Array<{ type: string; text: string }> };
	assert.equal(injected.role, "user");
	assert.equal(injected.timestamp, 1234);
	assert.equal(injected.content[0]!.type, "text");
	assert.equal(injected.content[0]!.text, CRUMB_A.text);
});

test("an in-place breadcrumb with the same fingerprint blocks re-injection", () => {
	const carrying = [{ role: "user", content: CRUMB_A.text }];
	assert.equal(applySddBreadcrumb(carrying, CRUMB_A), undefined);
});

test("a stale breadcrumb is replaced by the fresh one, not stacked", () => {
	const carrying = [{ role: "user", content: CRUMB_B.text }, { role: "user", content: "work" }];
	const messages = applySddBreadcrumb(carrying, CRUMB_A, () => 5678)!;
	assert.equal(messages.length, 2, "exactly one breadcrumb survives");
	assert.ok(messageContainsSddBreadcrumb(messages[0]));
	assert.equal((messages[0] as { content: Array<{ text: string }> }).content[0]!.text, CRUMB_A.text);
	assert.equal((messages[1] as { content: string }).content, "work");
});

test("with no crumb to render, a stale breadcrumb is still cleaned up", () => {
	const carrying = [{ role: "user", content: CRUMB_B.text }];
	const messages = applySddBreadcrumb(carrying, undefined)!;
	assert.equal(messages.length, 0);
});

test("string and segmented content forms are both recognized", () => {
	assert.ok(messageContainsSddBreadcrumb({ role: "user", content: `x\n${JERO_SDD_BREADCRUMB_MARKER} y\nz` }));
	assert.ok(messageContainsSddBreadcrumb({ role: "user", content: [{ type: "text", text: CRUMB_A.text }] }));
	assert.equal(messageContainsSddBreadcrumb({ role: "user", content: "plain" }), false);
	assert.equal(messageContainsSddBreadcrumb({ role: "user", content: [{ type: "image", source: {} }] }), false);
});

// ---------------------------------------------------------------------------
// 扩展接线：每回合刷新、门控与状态跟随
// ---------------------------------------------------------------------------

interface FakePi {
	handlers: Map<string, (event: unknown, ctx: unknown) => unknown>;
}

function makeFakePi(env: Record<string, string | undefined> = {}): FakePi {
	const fake: FakePi = { handlers: new Map() };
	const pi = {
		on(name: string, handler: (event: unknown, ctx: unknown) => unknown) {
			fake.handlers.set(name, handler);
		},
		registerCommand() {},
		registerTool() {},
		registerFlag() {},
		appendEntry() {},
		sendMessage() {},
		getActiveTools: () => [],
		getAllTools: () => [],
	} as unknown as ExtensionAPI;
	createJeroAiExtension({ nativeReviewCli: null, processEnv: env })(pi);
	return fake;
}

function makeCtx(cwd: string): Record<string, unknown> {
	return { cwd, hasUI: false, mode: "tui", ui: { notify() {}, setStatus() {} } };
}

test("extension injects a fresh breadcrumb on every context event while a change is active", () => {
	const root = tempRepo("jero-sdd-crumb-wire-");
	seedActiveChange(root);
	const fake = makeFakePi();
	const context = fake.handlers.get("context")!;
	const ctx = makeCtx(root);
	try {
		const first = context({ type: "context", messages: [] }, ctx) as { messages: unknown[] };
		assert.ok(first.messages.some(messageContainsSddBreadcrumb), "the breadcrumb needs no armed window");
		assert.ok(first.messages.some((message) => messageText(message).includes("- 下一步: sdd-apply")));

		writeFileSync(join(root, "openspec", "changes", "demo", "tasks.md"), "- [x] implement core\n");
		const second = context({ type: "context", messages: [] }, ctx) as { messages: unknown[] };
		assert.ok(second.messages.some((message) => messageText(message).includes("- 下一步: sdd-verify")), "task completion must advance the breadcrumb on the next request");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("breadcrumb follows rpc/child gates and the env kill switch", () => {
	const root = tempRepo("jero-sdd-crumb-gate-");
	seedActiveChange(root);
	try {
		const rpc = makeFakePi();
		assert.equal(rpc.handlers.get("context")!({ type: "context", messages: [] }, makeCtxWith(root, { mode: "rpc" })), undefined);

		const child = makeFakePi({ JERO_PI_AGENTS_CHILD: "1" });
		assert.equal(child.handlers.get("context")!({ type: "context", messages: [] }, makeCtx(root)), undefined);

		const off = makeFakePi({ JERO_PI_SDD_BREADCRUMB: "0" });
		const armed = off.handlers.get("session_compact")!;
		const ctx = makeCtx(root);
		armed({}, ctx);
		const result = off.handlers.get("context")!({ type: "context", messages: [] }, ctx) as { messages: unknown[] };
		assert.equal(result.messages.some(messageContainsSddBreadcrumb), false, "JERO_PI_SDD_BREADCRUMB=0 must suppress the breadcrumb");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

function makeCtxWith(cwd: string, overrides: Record<string, unknown>): Record<string, unknown> {
	return { ...makeCtx(cwd), ...overrides };
}

function messageText(message: unknown): string {
	const content = (message as { content?: unknown } | undefined)?.content;
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((part) =>
			typeof part === "object" && part !== null &&
			(part as { type?: unknown }).type === "text" &&
			typeof (part as { text?: unknown }).text === "string",
		)
		.map((part) => (part as { text: string }).text)
		.join("\n");
}
