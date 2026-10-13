import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import test from "node:test";

import { createJeroAiExtension } from "../extensions/jero-ai.ts";
import {
	applySpecIndex,
	buildSpecIndex,
	JERO_SPEC_INDEX_MARKER,
	messageContainsSpecIndex,
	renderSpecIndexText,
	specIndexEnabled,
} from "../lib/jero-ai-spec-index.ts";

// ---------------------------------------------------------------------------
// 纯逻辑：索引构建与摘要提取
// ---------------------------------------------------------------------------

function tempRepo(prefix = "jero-spec-index-"): string {
	return mkdtempSync(join(tmpdir(), prefix));
}

function seedSpec(root: string, domain: string, body: string): void {
	mkdirSync(join(root, "openspec", "specs", ...domain.split("/")), { recursive: true });
	writeFileSync(join(root, "openspec", "specs", ...domain.split("/"), "spec.md"), body);
}

test("an empty spec tree yields no index text", () => {
	const root = tempRepo();
	try {
		const index = buildSpecIndex(root);
		assert.equal(index.entries.length, 0);
		assert.equal(index.truncated, false);
		assert.equal(renderSpecIndexText(index), undefined);
		assert.equal(applySpecIndex([], undefined), undefined);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("domains are discovered recursively, summarized from Purpose, and sorted", () => {
	const root = tempRepo();
	seedSpec(root, "auth", "# Auth\n\n## Purpose\n\nHandles authentication.\n\n## Requirements\n");
	seedSpec(root, "billing/invoice", "## Purpose\nInvoice issuance and totals.\n");
	seedSpec(root, "z-last", "## Purpose\nzzz\n");
	try {
		const index = buildSpecIndex(root);
		assert.deepEqual(
			index.entries.map((entry) => entry.domain),
			["auth", "billing/invoice", "z-last"],
		);
		assert.equal(index.entries[0]!.purpose, "Handles authentication.");
		assert.equal(index.entries[1]!.purpose, "Invoice issuance and totals.");
		const text = renderSpecIndexText(index)!;
		assert.ok(text.includes(JERO_SPEC_INDEX_MARKER));
		assert.ok(text.includes("- billing/invoice — Invoice issuance and totals."));
		assert.ok(text.includes("内容以 spec.md 为准"));
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("a spec without a Purpose section falls back to the first non-heading line", () => {
	const root = tempRepo();
	seedSpec(root, "bare", "# Bare Spec\n\nFirst prose line wins.\n");
	seedSpec(root, "empty-purpose", "## Purpose\n\n## Requirements\n- only requirements\n");
	try {
		const entries = buildSpecIndex(root).entries;
		assert.equal(entries[0]!.domain, "bare");
		assert.equal(entries[0]!.purpose, "First prose line wins.");
		assert.ok(entries[1]!.purpose.includes("无 Purpose 段"), "an empty Purpose section must degrade, not leak requirement bullets");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("the index truncates beyond the entry cap and caps purpose length", () => {
	const root = tempRepo();
	const long = "x".repeat(400);
	seedSpec(root, "domain-000", `## Purpose\n${long}\n`);
	for (let i = 1; i <= 40; i += 1) seedSpec(root, `domain-${String(i).padStart(3, "0")}`, "## Purpose\np\n");
	try {
		const index = buildSpecIndex(root);
		assert.equal(index.entries.length, 40);
		assert.equal(index.truncated, true);
		assert.equal(index.entries[0]!.purpose.length, 160, "purpose is capped at 160 chars");
		const text = renderSpecIndexText(index)!;
		assert.ok(text.includes("……（域数超过上限"), "truncation must be visible in the rendered index");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("JERO_PI_SPEC_INDEX=0|false|off disables the index, default on", () => {
	assert.equal(specIndexEnabled({}), true);
	for (const off of ["0", "false", "off"]) {
		assert.equal(specIndexEnabled({ JERO_PI_SPEC_INDEX: off }), false, `${off} must disable`);
	}
	assert.equal(specIndexEnabled({ JERO_PI_SPEC_INDEX: "1" }), true);
});

// ---------------------------------------------------------------------------
// 纯逻辑：注入点与去重
// ---------------------------------------------------------------------------

const INDEX_TEXT = `${JERO_SPEC_INDEX_MARKER}\n\n已确立规范索引（openspec/specs/，1 个域）：\n- auth — Handles authentication.`;

test("the index lands after leading compaction summaries", () => {
	const history = [
		{ role: "compactionSummary", content: "summary-a" },
		{ role: "user", content: "real turn" },
	];
	const messages = applySpecIndex(history, INDEX_TEXT, () => 1234)!;
	assert.equal(messages.length, 3);
	const injected = messages[1] as { role: string; timestamp: number; content: Array<{ type: string; text: string }> };
	assert.ok(messageContainsSpecIndex(injected));
	assert.equal(injected.role, "user");
	assert.equal(injected.timestamp, 1234);
	assert.equal(injected.content[0]!.type, "text");
	assert.equal(injected.content[0]!.text, INDEX_TEXT);
	assert.equal((messages[2] as { content: string }).content, "real turn");
});

test("an existing index message blocks re-injection within the window", () => {
	const carrying = [{ role: "user", content: [{ type: "text", text: INDEX_TEXT }] }];
	assert.equal(applySpecIndex(carrying, INDEX_TEXT), undefined);
	assert.equal(messageContainsSpecIndex({ role: "user", content: `x\n${JERO_SPEC_INDEX_MARKER}\ny` }), true);
	assert.equal(messageContainsSpecIndex({ role: "user", content: "plain" }), false);
});

// ---------------------------------------------------------------------------
// 扩展接线：窗口、门控
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

function makeCtx(cwd: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return { cwd, hasUI: false, mode: "tui", ui: { notify() {}, setStatus() {} }, ...overrides };
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

test("the index injects inside the armed window and stays out otherwise", () => {
	const root = tempRepo("jero-spec-index-wire-");
	seedSpec(root, "auth", "## Purpose\nHandles authentication.\n");
	const fake = makeFakePi();
	const context = fake.handlers.get("context")!;
	const compact = fake.handlers.get("session_compact")!;
	const end = fake.handlers.get("agent_end")!;
	const ctx = makeCtx(root);
	try {
		const unarmed = context({ type: "context", messages: [] }, ctx) as { messages: unknown[] } | undefined;
		assert.equal(unarmed, undefined, "no injection before the window is armed");

		compact({}, ctx);
		const armed = context({ type: "context", messages: [] }, ctx) as { messages: unknown[] };
		assert.ok(armed.messages.some(messageContainsSpecIndex), "session_compact must arm the index injection");
		assert.ok(armed.messages.some((message) => messageText(message).includes("- auth — Handles authentication.")));

		end({}, ctx);
		assert.equal(context({ type: "context", messages: [] }, ctx), undefined, "agent_end must stop further injections");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("rpc children, package children, and the env kill switch never see the index", () => {
	const root = tempRepo("jero-spec-index-gate-");
	seedSpec(root, "auth", "## Purpose\nHandles authentication.\n");
	try {
		const rpc = makeFakePi();
		rpc.handlers.get("session_compact")!({}, makeCtx(root, { mode: "rpc" }));
		assert.equal(rpc.handlers.get("context")!({ type: "context", messages: [] }, makeCtx(root, { mode: "rpc" })), undefined);

		const child = makeFakePi({ JERO_PI_AGENTS_CHILD: "1" });
		child.handlers.get("session_compact")!({}, makeCtx(root));
		assert.equal(child.handlers.get("context")!({ type: "context", messages: [] }, makeCtx(root)), undefined);

		const off = makeFakePi({ JERO_PI_SPEC_INDEX: "0" });
		const ctx = makeCtx(root);
		off.handlers.get("session_compact")!({}, ctx);
		const result = off.handlers.get("context")!({ type: "context", messages: [] }, ctx) as { messages: unknown[] };
		assert.equal(result.messages.some(messageContainsSpecIndex), false, "JERO_PI_SPEC_INDEX=0 must suppress the index");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
