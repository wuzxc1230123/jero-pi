import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import test from "node:test";

import { createJeroAiExtension } from "../extensions/jero-ai.ts";
import {
	CONTEXT_COMPACT_RECOVERY_MESSAGE,
	CONTEXT_MONITOR_THRESHOLDS,
	contextMonitorEnabled,
	evaluateContextMonitor,
	type ContextMonitorState,
	type ContextUsageSnapshot,
} from "../lib/jero-ai-context-monitor.ts";

// ---------------------------------------------------------------------------
// 纯逻辑：逐档评估与迟滞
// ---------------------------------------------------------------------------

function usage(percent: number | null, tokens: number | null = null, contextWindow = 200_000): ContextUsageSnapshot {
	return { tokens, contextWindow, percent };
}

test("usage below the notice threshold stays ok and never escalates", () => {
	const state: ContextMonitorState = { lastLevel: "ok" };
	const verdict = evaluateContextMonitor(usage(50), state);
	assert.equal(verdict.level, "ok");
	assert.equal(verdict.escalated, false);
	assert.equal(verdict.message, undefined);
	assert.equal(evaluateContextMonitor(usage(CONTEXT_MONITOR_THRESHOLDS.notice - 1), state).level, "ok");
});

test("crossing each threshold escalates exactly once with the matching message", () => {
	let state: ContextMonitorState = { lastLevel: "ok" };
	const notice = evaluateContextMonitor(usage(CONTEXT_MONITOR_THRESHOLDS.notice), state);
	assert.equal(notice.level, "notice");
	assert.equal(notice.escalated, true);
	assert.equal(notice.notifyType, "warning");
	assert.match(notice.message!, new RegExp(`已用 ${CONTEXT_MONITOR_THRESHOLDS.notice}%`));
	state = { lastLevel: notice.level };

	const repeat = evaluateContextMonitor(usage(75), state);
	assert.equal(repeat.level, "notice");
	assert.equal(repeat.escalated, false);
	assert.equal(repeat.message, undefined);

	const warning = evaluateContextMonitor(usage(CONTEXT_MONITOR_THRESHOLDS.warning), state);
	assert.equal(warning.level, "warning");
	assert.equal(warning.escalated, true);
	state = { lastLevel: warning.level };

	const critical = evaluateContextMonitor(usage(CONTEXT_MONITOR_THRESHOLDS.critical), state);
	assert.equal(critical.level, "critical");
	assert.equal(critical.escalated, true);
	assert.equal(critical.notifyType, "error");
	assert.match(critical.message!, new RegExp(`仅余 ${100 - CONTEXT_MONITOR_THRESHOLDS.critical}%`));
});

test("usage drops are silent de-escalations and re-escalation works again afterwards", () => {
	let state: ContextMonitorState = { lastLevel: "critical" };
	const dropped = evaluateContextMonitor(usage(20), state);
	assert.equal(dropped.level, "ok");
	assert.equal(dropped.escalated, false);
	state = { lastLevel: dropped.level };
	const again = evaluateContextMonitor(usage(CONTEXT_MONITOR_THRESHOLDS.warning), state);
	assert.equal(again.escalated, true);
	assert.equal(again.level, "warning");
});

test("unknown usage keeps the monitor quiet", () => {
	const state: ContextMonitorState = { lastLevel: "warning" };
	for (const candidate of [usage(null), usage(null, null, 0)]) {
		const verdict = evaluateContextMonitor(candidate, state);
		assert.equal(verdict.level, "ok");
		assert.equal(verdict.escalated, false);
	}
});

test("percent is derived from tokens over the window when percent is missing", () => {
	const state: ContextMonitorState = { lastLevel: "ok" };
	const verdict = evaluateContextMonitor(usage(null, 190_000, 200_000), state);
	assert.equal(verdict.level, "critical");
	assert.equal(verdict.escalated, true);
	const mid = evaluateContextMonitor(usage(null, 170_000, 200_000), { lastLevel: "ok" });
	assert.equal(mid.level, "warning");
});

test("percent values are clamped into 0-100 before grading", () => {
	const state: ContextMonitorState = { lastLevel: "ok" };
	const verdict = evaluateContextMonitor(usage(140), state);
	assert.equal(verdict.level, "critical");
	assert.match(verdict.message!, /仅余 0%/);
});

test("contextMonitorEnabled honors the JERO_PI_CONTEXT_MONITOR opt-out", () => {
	assert.equal(contextMonitorEnabled({}), true);
	assert.equal(contextMonitorEnabled({ JERO_PI_CONTEXT_MONITOR: "0" }), false);
	assert.equal(contextMonitorEnabled({ JERO_PI_CONTEXT_MONITOR: "off" }), false);
	assert.equal(contextMonitorEnabled({ JERO_PI_CONTEXT_MONITOR: "1" }), true);
});

// ---------------------------------------------------------------------------
// 扩展接线：agent_settled 告警与 session_compact 复位
// ---------------------------------------------------------------------------

interface MonitorFakePi {
	handlers: Map<string, (event: unknown, ctx: unknown) => unknown>;
}

function makeFakePi(env: Record<string, string | undefined> = {}): MonitorFakePi {
	const fake: MonitorFakePi = { handlers: new Map() };
	const pi = {
		on(name: string, handler: (event: unknown, ctx: unknown) => unknown) {
			fake.handlers.set(name, handler);
		},
		registerCommand() {},
		registerTool() {},
		registerFlag() {},
		appendEntry() {},
		getActiveTools: () => [],
		getAllTools: () => [],
	} as unknown as ExtensionAPI;
	createJeroAiExtension({ nativeReviewCli: null, processEnv: env })(pi);
	return fake;
}

interface Notification {
	message: string;
	type: string;
}

function makeCtx(usagePercent: number | null, overrides: Record<string, unknown> = {}): { ctx: Record<string, unknown>; notifications: Notification[] } {
	const notifications: Notification[] = [];
	const ctx = {
		cwd: mkdtempSync(join(tmpdir(), "jero-context-monitor-")),
		hasUI: true,
		mode: "tui",
		ui: {
			notify(message: string, type: string) {
				notifications.push({ message, type });
			},
		},
		getContextUsage: () => ({ tokens: null, contextWindow: 200_000, percent: usagePercent }),
		...overrides,
	};
	return { ctx, notifications };
}

test("agent_settled notifies once per escalation and session_compact resets the level", () => {
	const fake = makeFakePi();
	const settled = fake.handlers.get("agent_settled");
	const compact = fake.handlers.get("session_compact");
	assert.ok(settled && compact, "the extension must register both monitor handlers");

	const first = makeCtx(CONTEXT_MONITOR_THRESHOLDS.notice);
	settled({}, first.ctx);
	assert.equal(first.notifications.length, 1);
	assert.equal(first.notifications[0]!.type, "warning");

	const repeat = makeCtx(75);
	settled({}, repeat.ctx);
	assert.equal(repeat.notifications.length, 0);

	const critical = makeCtx(CONTEXT_MONITOR_THRESHOLDS.critical);
	settled({}, critical.ctx);
	assert.equal(critical.notifications.length, 1);
	assert.equal(critical.notifications[0]!.type, "error");

	compact({}, makeCtx(null).ctx);

	const afterCompact = makeCtx(CONTEXT_MONITOR_THRESHOLDS.notice);
	settled({}, afterCompact.ctx);
	assert.equal(afterCompact.notifications.length, 1, "after compaction the threshold must warn again");
});

test("session_compact surfaces the memory-recovery hint", () => {
	const fake = makeFakePi();
	const notifications: Notification[] = [];
	fake.handlers.get("session_compact")!({}, {
		cwd: mkdtempSync(join(tmpdir(), "jero-context-monitor-")),
		hasUI: true,
		mode: "tui",
		ui: { notify(message: string, type: string) { notifications.push({ message, type }); } },
	});
	assert.equal(notifications.length, 1);
	assert.equal(notifications[0]!.message, CONTEXT_COMPACT_RECOVERY_MESSAGE);
	assert.equal(notifications[0]!.type, "info");
});

test("rpc child processes, headless hosts and the opt-out stay silent", () => {
	const rpc = makeCtx(99, { mode: "rpc" });
	makeFakePi().handlers.get("agent_settled")!({}, rpc.ctx);
	assert.equal(rpc.notifications.length, 0);

	const headless = makeCtx(99, { hasUI: false });
	makeFakePi().handlers.get("agent_settled")!({}, headless.ctx);
	assert.equal(headless.notifications.length, 0);

	const disabled = makeCtx(99);
	makeFakePi({ JERO_PI_CONTEXT_MONITOR: "0" }).handlers.get("agent_settled")!({}, disabled.ctx);
	assert.equal(disabled.notifications.length, 0);
});

test("a host without getContextUsage never breaks the settled path", () => {
	const notifications: Notification[] = [];
	const ctx = {
		cwd: mkdtempSync(join(tmpdir(), "jero-context-monitor-")),
		hasUI: true,
		mode: "tui",
		ui: { notify(message: string, type: string) { notifications.push({ message, type }); } },
	};
	assert.doesNotThrow(() => makeFakePi().handlers.get("agent_settled")!({}, ctx));
	assert.equal(notifications.length, 0);
});
