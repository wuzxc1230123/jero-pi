import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import test from "node:test";

import { createJeroAiExtension } from "../extensions/jero-ai.ts";
import {
	applyJeroBootstrap,
	JERO_BOOTSTRAP_MARKER,
	JERO_BOOTSTRAP_TEXT,
	messageContainsJeroBootstrap,
} from "../lib/jero-ai-bootstrap.ts";

// ---------------------------------------------------------------------------
// 纯逻辑：注入点、去重与消息形状
// ---------------------------------------------------------------------------

test("bootstrap injects one user message carrying the marker into empty context", () => {
	const messages = applyJeroBootstrap([], () => 1234);
	assert.ok(Array.isArray(messages));
	assert.equal(messages.length, 1);
	const injected = messages[0] as { role: string; timestamp: number; content: Array<{ type: string; text: string }> };
	assert.equal(injected.role, "user");
	assert.equal(injected.timestamp, 1234);
	assert.equal(injected.content.length, 1);
	assert.equal(injected.content[0]!.type, "text");
	assert.ok(injected.content[0]!.text.includes(JERO_BOOTSTRAP_MARKER));
	assert.ok(
		injected.content[0]!.text.length > JERO_BOOTSTRAP_MARKER.length + 300,
		"the bootstrap must carry substantive discipline, not just its marker",
	);
});

test("bootstrap lands after leading compaction summaries and before real history", () => {
	const history = [
		{ role: "compactionSummary", content: "summary-a" },
		{ role: "compactionSummary", content: "summary-b" },
		{ role: "user", content: "real turn" },
	];
	const messages = applyJeroBootstrap(history)!;
	assert.equal(messages.length, 4);
	assert.ok(messageContainsJeroBootstrap(messages[2]), "bootstrap must sit directly after the summaries");
	assert.equal((messages[3] as { content: string }).content, "real turn");
	assert.equal((messages[0] as { role: string }).role, "compactionSummary", "summaries stay in front");
	assert.equal((messages[1] as { role: string }).role, "compactionSummary");
});

test("bootstrap without compaction summaries goes in front of the history", () => {
	const messages = applyJeroBootstrap([{ role: "user", content: "hello" }])!;
	assert.equal(messages.length, 2);
	assert.ok(messageContainsJeroBootstrap(messages[0]));
	assert.equal((messages[1] as { content: string }).content, "hello");
});

test("an existing bootstrap message (string or segmented content) blocks re-injection", () => {
	const asString = [{ role: "user", content: `preamble\n${JERO_BOOTSTRAP_MARKER}\nrest` }];
	assert.equal(applyJeroBootstrap(asString), undefined);
	const asSegments = [{ role: "user", content: [{ type: "text", text: JERO_BOOTSTRAP_TEXT }] }];
	assert.equal(applyJeroBootstrap(asSegments), undefined);
	const unrelated = [{ role: "user", content: [{ type: "image", source: {} }] }];
	assert.ok(Array.isArray(applyJeroBootstrap(unrelated)), "unrelated history must still be injectable");
});

// ---------------------------------------------------------------------------
// 扩展接线：置位/复位窗口与模式门控
// ---------------------------------------------------------------------------

interface BootstrapFakePi {
	handlers: Map<string, (event: unknown, ctx: unknown) => unknown>;
}

function makeFakePi(env: Record<string, string | undefined> = {}): BootstrapFakePi {
	const fake: BootstrapFakePi = { handlers: new Map() };
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

function makeCtx(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		cwd: mkdtempSync(join(tmpdir(), "jero-bootstrap-")),
		hasUI: false,
		mode: "tui",
		ui: { notify() {}, setStatus() {} },
		...overrides,
	};
}

test("session_start arms one bootstrap injection and agent_end disarms it", async () => {
	const fake = makeFakePi();
	const context = fake.handlers.get("context");
	const start = fake.handlers.get("session_start");
	const end = fake.handlers.get("agent_end");
	assert.ok(context && start && end, "the extension must register the bootstrap handlers");

	const configHome = mkdtempSync(join(tmpdir(), "jero-bootstrap-config-"));
	const previousConfigHome = process.env.JERO_PI_CONFIG_HOME;
	process.env.JERO_PI_CONFIG_HOME = configHome;
	const ctx = makeCtx();
	try {
		assert.equal(context({ type: "context", messages: [] }, ctx), undefined, "no injection before session_start");
		await start({ reason: "startup" }, ctx);
		const armed = context({ type: "context", messages: [] }, ctx) as { messages: unknown[] } | undefined;
		assert.ok(Array.isArray(armed?.messages), "session_start must arm exactly the next agent loop");
		assert.ok(messageContainsJeroBootstrap(armed!.messages[0]));

		end({}, ctx);
		assert.equal(context({ type: "context", messages: [] }, ctx), undefined, "agent_end must stop further injections");
	} finally {
		if (previousConfigHome === undefined) delete process.env.JERO_PI_CONFIG_HOME;
		else process.env.JERO_PI_CONFIG_HOME = previousConfigHome;
		rmSync(ctx.cwd as string, { recursive: true, force: true });
		rmSync(configHome, { recursive: true, force: true });
	}
});

test("session_compact re-arms the injection after agent_end cleared it", () => {
	const fake = makeFakePi();
	const context = fake.handlers.get("context")!;
	const compact = fake.handlers.get("session_compact")!;
	const end = fake.handlers.get("agent_end")!;
	const ctx = makeCtx();
	try {
		compact({}, ctx);
		const armed = context({ type: "context", messages: [{ role: "compactionSummary", content: "s" }] }, ctx) as { messages: unknown[] };
		assert.ok(messageContainsJeroBootstrap(armed.messages[1]), "post-compact injection follows the summary");

		end({}, ctx);
		assert.equal(context({ type: "context", messages: [] }, ctx), undefined);
		compact({}, ctx);
		const rearmed = context({ type: "context", messages: [] }, ctx) as { messages: unknown[] };
		assert.ok(Array.isArray(rearmed.messages) && messageContainsJeroBootstrap(rearmed.messages[0]));
	} finally {
		rmSync(ctx.cwd as string, { recursive: true, force: true });
	}
});

test("rpc children and package child processes never receive the bootstrap", () => {
	const rpcCtx = makeCtx({ mode: "rpc" });
	const rpc = makeFakePi();
	try {
		rpc.handlers.get("session_compact")!({}, rpcCtx);
		assert.equal(rpc.handlers.get("context")!({ type: "context", messages: [] }, rpcCtx), undefined);
	} finally {
		rmSync(rpcCtx.cwd as string, { recursive: true, force: true });
	}

	const childCtx = makeCtx();
	const child = makeFakePi({ JERO_PI_AGENTS_CHILD: "1" });
	try {
		child.handlers.get("session_compact")!({}, childCtx);
		assert.equal(child.handlers.get("context")!({ type: "context", messages: [] }, childCtx), undefined);
	} finally {
		rmSync(childCtx.cwd as string, { recursive: true, force: true });
	}
});

test("session_shutdown disarms a pending injection", () => {
	const fake = makeFakePi();
	const context = fake.handlers.get("context")!;
	const compact = fake.handlers.get("session_compact")!;
	const shutdown = fake.handlers.get("session_shutdown")!;
	const ctx = makeCtx();
	try {
		compact({}, ctx);
		shutdown({ reason: "quit" }, ctx);
		assert.equal(context({ type: "context", messages: [] }, ctx), undefined);
	} finally {
		rmSync(ctx.cwd as string, { recursive: true, force: true });
	}
});
