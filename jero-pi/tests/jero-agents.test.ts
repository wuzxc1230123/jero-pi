// jero-agents 测试第 1 段（留守原文件名）（共 3 段；夹具在 jero-agents-shared.ts）。
// 机械平移自原 jero-agents.test.ts，语义零改动。

import { default as assert } from "node:assert/strict";
import {
	appendFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync,
	rmSync, writeFileSync
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { join, relative, resolve, sep } from "node:path";
import { pendingReviewMutation, REVIEW_REMINDER_RECEIPT } from "../lib/review-reminder-receipt.ts";
import { SESSION_WORKTREE_CHANGED, SESSION_WORKTREE_ENTRY } from "../lib/session-worktree-registry.ts";
import { after, default as test, mock } from "node:test";
import { type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { type TuiMouseEvent, visibleWidth } from "@earendil-works/pi-tui";
import {
	agentRuntimePaths, agentsCollapseKey, type AgentsDeps, agentsEnabled, agentsStopKey,
	agentsViewKey, answerThroughUi, completionText, default as gentleAgents,
	legacySubagentsInstalled
} from "../extensions/jero-agents.ts";
import { historyDir, loadHistory, saveTask } from "../lib/agents-history.ts";
import { STALE_COMPLETION_MS } from "../lib/agents-completion-delivery.ts";
import { applyTaskEvent, emptyThread, TASK_EVENT, TASK_STATUS, type TaskRecord, TaskStore } from "../lib/agents-protocol.ts";
import { NativePointerScope } from "../lib/native-pointer-region.ts";
import { listPresence, PresenceCursor, PresencePublisher, readActivity } from "../lib/orchestrator-presence.ts";
import { stripAnsi } from "../lib/terminal-theme.ts";
import { fakeChild, type FakeChild } from "./agents-fake-child.ts";
import { AgentRunner } from "../lib/agents-runner.ts";
import { type NativeReviewCli } from "../lib/authority/client-contract.ts";
import { CHILD_METRICS_EVENT } from "../lib/runtime-metrics-children.ts";
import { renderSddPreflightPrompt } from "../lib/sdd-preflight.ts";
import {
	cwd, deps, fakeContext, fakePi, fakeTui, type Handler, home, mouse, nonGitCwd, type Overlay,
	PARENT_CONFIRMED_SDD_CONTEXT, plainTheme, type Registered, root
} from "./jero-agents-shared.ts";

test("all ten subagent registrations own their transcript shell", () => {
	const { pi, tools } = fakePi();
	gentleAgents(pi, {}, deps().deps);
	assert.equal(tools.size, 10);
	assert.deepEqual(tools.get("subagent_reconcile")?.parameters, { type: "object", additionalProperties: false, required: ["task_id"], properties: { task_id: { type: "string" } } });
	for (const tool of tools.values()) assert.equal(tool.renderShell, "self", tool.name);
});

test("host query delivery exposes correlation and accepts one current-session reply", async () => {
	const { pi, tools, fire, sent } = fakePi();
	const harness = deps();
	gentleAgents(pi, {}, harness.deps);
	const { ctx } = fakeContext();
	await fire("session_start", ctx);
	const started = await tools.get("subagent_run")!.execute("query", { agent: "explore", task: "Ask once", mode: "background" }, undefined, undefined, ctx);
	const taskId = (started.details.gentleAgents as { taskId: string }).taskId;
	await tick();
	harness.children[0].message({ id: "q1", kind: "query", message: "Which file?" });
	await tick();
	assert.match(String(sent.at(-1)?.message.content), new RegExp(`Task ID: ${taskId}\\nRequest ID: q1`));
	assert.equal(sent.at(-1)?.message.display, true, "an explicit child query remains visible");
	(ctx.sessionManager as { getSessionId(): string }).getSessionId = () => "s2";
	assert.match((await tools.get("subagent_reply")!.execute("stale", { task_id: taskId, request_id: "q1", message: "wrong" }, undefined, undefined, ctx)).content[0].text, /unavailable/);
	(ctx.sessionManager as { getSessionId(): string }).getSessionId = () => "s1";
	assert.equal((await tools.get("subagent_reply")!.execute("reply", { task_id: taskId, request_id: "q1", message: "src/a.ts" }, undefined, undefined, ctx)).content[0].text, "Reply accepted for delivery.");
	assert.deepEqual(harness.children[0].sent.at(-1), { id: "q1", kind: "reply", message: "src/a.ts" });
	assert.match((await tools.get("subagent_reply")!.execute("duplicate", { task_id: taskId, request_id: "q1", message: "again" }, undefined, undefined, ctx)).content[0].text, /unavailable/);
});

test("first foreground query yields while its child runs and delivers one completion", async () => {
	const { pi, tools, fire, sent } = fakePi();
	const harness = deps();
	gentleAgents(pi, {}, harness.deps);
	const { ctx } = fakeContext();
	await fire("session_start", ctx);
	const pending = tools.get("subagent_run")!.execute("foreground", { agent: "explore", task: "Ask then finish" }, undefined, undefined, ctx);
	await tick();
	harness.children[0].message({ id: "q1", kind: "query", message: "Which file?" });
	const yielded = await pending;
	const taskId = (yielded.details.gentleAgents as { taskId: string }).taskId;
	assert.equal((yielded as { terminate?: boolean }).terminate, true);
	assert.deepEqual(harness.children[0].killed, []);
	await tools.get("subagent_reply")!.execute("reply", { task_id: taskId, request_id: "q1", message: "src/a.ts" }, undefined, undefined, ctx);
	harness.children[0].emit({ type: "agent_end", messages: [{ role: "assistant", content: [{ type: "text", text: "done" }], stopReason: "stop" }] });
	harness.children[0].emit({ type: "agent_settled" });
	await tick();
	assert.equal(sent.filter((entry) => entry.message.customType === "gentle-agents.result").length, 1);
});

test("cancelling a yielded foreground task prevents completion follow-up", async () => {
	const { pi, tools, fire, sent } = fakePi();
	const harness = deps();
	gentleAgents(pi, {}, harness.deps);
	const { ctx } = fakeContext();
	await fire("session_start", ctx);
	const pending = tools.get("subagent_run")!.execute("cancel", { agent: "explore", task: "cancel after query" }, undefined, undefined, ctx);
	await tick();
	harness.children[0].message({ id: "q1", kind: "query", message: "q" });
	const yielded = await pending;
	const taskId = (yielded.details.gentleAgents as { taskId: string }).taskId;
	assert.match((await tools.get("subagent_cancel")!.execute("stop", { task_id: taskId }, undefined, undefined, ctx)).content[0].text, /Cancelled task/);
	await tick();
	harness.children[0].emit({ type: "agent_end", messages: [{ role: "assistant", content: [{ type: "text", text: "late" }], stopReason: "stop" }] });
	harness.children[0].emit({ type: "agent_settled" });
	await tick();
	assert.equal(sent.filter((entry) => entry.message.customType === "gentle-agents.result").length, 0);
});

test("yielded foreground completion is suppressed after session replacement or cancellation", async () => {
	const { pi, tools, fire, sent } = fakePi();
	const harness = deps();
	gentleAgents(pi, {}, harness.deps);
	const { ctx } = fakeContext();
	await fire("session_start", ctx);
	const pending = tools.get("subagent_run")!.execute("switch", { agent: "explore", task: "switch session" }, undefined, undefined, ctx);
	await tick();
	harness.children[0].message({ id: "q1", kind: "query", message: "q" });
	const yielded = await pending;
	const taskId = (yielded.details.gentleAgents as { taskId: string }).taskId;
	(ctx.sessionManager as { getSessionId(): string }).getSessionId = () => "s2";
	harness.children[0].emit({ type: "agent_end", messages: [{ role: "assistant", content: [{ type: "text", text: "done" }], stopReason: "stop" }] });
	harness.children[0].emit({ type: "agent_settled" });
	await tick();
	assert.equal(sent.filter((entry) => entry.message.customType === "gentle-agents.result").length, 0);
	(ctx.sessionManager as { getSessionId(): string }).getSessionId = () => "s1";
	assert.match((await tools.get("subagent_cancel")!.execute("cancel", { task_id: taskId }, undefined, undefined, ctx)).content[0].text, /not running/);
});

test("first handoff failure keeps ordinary completion, later failure retains yielded completion", async () => {
	const first = fakePi();
	const firstHarness = deps();
	gentleAgents(first.pi, {}, firstHarness.deps);
	const firstContext = fakeContext();
	await first.fire("session_start", firstContext.ctx);
	(first.pi as unknown as { sendMessage(): void }).sendMessage = () => { throw new Error("host unavailable"); };
	const ordinary = first.tools.get("subagent_run")!.execute("first", { agent: "explore", task: "fail handoff" }, undefined, undefined, firstContext.ctx);
	await tick();
	firstHarness.children[0].message({ id: "q1", kind: "query", message: "q" });
	firstHarness.children[0].emit({ type: "agent_end", messages: [{ role: "assistant", content: [{ type: "text", text: "ordinary" }], stopReason: "stop" }] });
	firstHarness.children[0].emit({ type: "agent_settled" });
	assert.equal((await ordinary).content[0].text, "ordinary");

	const second = fakePi();
	const secondHarness = deps();
	gentleAgents(second.pi, {}, secondHarness.deps);
	const secondContext = fakeContext();
	await second.fire("session_start", secondContext.ctx);
	let sends = 0;
	(second.pi as unknown as { sendMessage(message: Record<string, unknown>, options: Record<string, unknown>): void }).sendMessage = (message, options) => {
		sends += 1;
		if (sends === 2) throw new Error("second unavailable");
		second.sent.push({ message, options });
	};
	const pending = second.tools.get("subagent_run")!.execute("second", { agent: "explore", task: "two queries" }, undefined, undefined, secondContext.ctx);
	await tick();
	secondHarness.children[0].message({ id: "q1", kind: "query", message: "first" });
	await pending;
	secondHarness.children[0].message({ id: "q2", kind: "query", message: "second" });
	secondHarness.children[0].emit({ type: "agent_end", messages: [{ role: "assistant", content: [{ type: "text", text: "done" }], stopReason: "stop" }] });
	secondHarness.children[0].emit({ type: "agent_settled" });
	await tick();
	assert.equal(second.sent.filter((entry) => entry.message.customType === "gentle-agents.result").length, 1);
});

test("foreground handoff survives settlement before its original await resumes", async () => {
	const { pi, tools, fire, sent } = fakePi();
	const harness = deps();
	gentleAgents(pi, {}, harness.deps);
	const { ctx } = fakeContext();
	await fire("session_start", ctx);
	const pending = tools.get("subagent_run")!.execute("race", { agent: "explore", task: "query then settle" }, undefined, undefined, ctx);
	await tick();
	harness.children[0].message({ id: "q1", kind: "query", message: "q" });
	harness.children[0].emit({ type: "agent_end", messages: [{ role: "assistant", content: [{ type: "text", text: "race result" }], stopReason: "stop" }] });
	harness.children[0].emit({ type: "agent_settled" });
	assert.equal((await pending as { terminate?: boolean }).terminate, true);
	assert.equal(sent.filter((entry) => entry.message.customType === "gentle-agents.result").length, 1);
});

export const tick = () => new Promise((resolve) => setImmediate(resolve));

test("child parent-message tooling admits notifications and the active parent preserves raw model text", async () => {
	const child = fakePi();
	const listeners = new Map<string, Array<(value: Record<string, unknown>) => void>>();
	const frames: Array<Record<string, unknown>> = [];
	gentleAgents(child.pi, { JERO_PI_AGENTS_CHILD: "1", JERO_PI_AGENTS_OWNED_IPC: "fixture" }, {
		childIpc: {
			send: (frame: Record<string, unknown>) => { frames.push(frame); return true; },
			on: (event: string, listener: (value: Record<string, unknown>) => void) => listeners.set(event, [...(listeners.get(event) ?? []), listener]),
		},
	});
	assert.deepEqual([...child.tools.keys()], ["subagent_parent_message"]);
	const pending = child.tools.get("subagent_parent_message")!.execute("message", { message: "raw\u001B[2J text" }, undefined, undefined, {} as ExtensionContext);
	assert.deepEqual(frames, [{ id: "n1", kind: "notification", message: "raw\u001B[2J text" }]);
	for (const listener of listeners.get("message") ?? []) listener({ id: "n1", kind: "ack", accepted: true });
	assert.equal((await pending).content[0].text, "Notification accepted by the parent.");

	const parent = fakePi();
	const runtime = deps();
	gentleAgents(parent.pi, {}, runtime.deps);
	const { ctx } = fakeContext();
	await parent.fire("session_start", ctx);
	await parent.tools.get("subagent_run")!.execute("run", { agent: "explore", task: "notify", mode: "background" }, undefined, undefined, ctx);
	await tick();
	runtime.children[0].message({ id: "n1", kind: "notification", message: "raw\u001B[2J text" });
	await tick();
	assert.equal(parent.sent[0]?.message.content, "raw\u001B[2J text");
	assert.equal(parent.sent[0]?.message.display, false, "ordinary child notifications remain model-visible but do not render in the transcript");
	assert.deepEqual(parent.sent[0]?.options, { deliverAs: "followUp", triggerTurn: true });
	const rendered = parent.renderers.get("gentle-agents.message")!(parent.sent[0]?.message, { expanded: true }, plainTheme).render(80).join("\n");
	assert.match(rendered, /raw\\x1B\[2J text/);
	(ctx.sessionManager as unknown as { getSessionId(): string }).getSessionId = () => "s2";
	await parent.fire("session_start", ctx, { type: "session_start", reason: "new" });
	runtime.children[0].message({ id: "n2", kind: "notification", message: "must not reach a replacement session" });
	await tick();
	assert.equal(parent.sent.length, 1, "a child from the prior session delivers no notification after session replacement");
	assert.deepEqual(runtime.children[0].sent, [{ id: "n1", kind: "ack", accepted: true }, { id: "n2", kind: "ack", accepted: false, error: "task parent is not the active host session" }]);
	await parent.fire("session_shutdown", ctx);
});
for (const boundary of ["allowed", "env", "session", "replacement", "bus-throws", "no-spawn", "long-running"] as const) {
	test(`local child composition through real extensions and RPC runner: ${boundary}`, async (t) => {
		const discarded: number[] = [];
		const discard = AgentRunner.prototype.discardResponseObservations;
		t.mock.method(AgentRunner.prototype, "discardResponseObservations", function (this: AgentRunner, id: string) {
			const live = Reflect.get(this, "live").get(id);
			discarded.push(live?.observations?.responses.length ?? 0);
			discard.call(this, id);
			assert.equal(live?.observations, undefined, "buffer gone synchronously, without another RPC");
		});
		const h = fakePi();
		const runtime = deps();
		const context = fakeContext();
		const spawn = runtime.deps.spawn!;
		runtime.deps.spawn = (...args) => {
			const child = spawn(...args);
			const on = child.on.bind(child);
			child.on = ((event: string, listener: (...args: any[]) => void) => {
				if (event === "spawn" && boundary !== "no-spawn") queueMicrotask(() => listener());
				return on(event as any, listener);
			}) as typeof child.on;
			return child;
		};
		let clock = 1;
		const renewalTimers = new Map<number, () => void>();
		const metricsSchedule = (fn: () => void, ms: number) => {
			const at = clock + ms; renewalTimers.set(at, fn); return () => { renewalTimers.delete(at); };
		};
		const env: NodeJS.ProcessEnv = {};
		const profile = join(root, `metrics-${boundary}`);
		mkdirSync(join(profile, "agents"), { recursive: true });
		writeFileSync(join(profile, "agents", "jero-worker.md"), readFileSync(new URL("../assets/agents/jero-worker.md", import.meta.url)));
		writeFileSync(join(profile, "subagents.json"), JSON.stringify({ model_profiles: { "jero-worker": { model: "openai/gpt-4o", effort: "high" } } }));
		gentleAgents(h.pi, env, { ...runtime.deps, env, agentHome: profile, metricsNow: () => clock, metricsSchedule });
		const listenerCounts = () => [...h.listeners].map(([name, set]) => [name, set.size]);
		const initialListeners = listenerCounts();
		await h.fire("session_start", context.ctx);
		const result = h.tools.get("subagent_run")!.execute("call", { agent: "jero-worker", task: "private task", mode: "task" }, undefined, undefined, context.ctx);
		await tick();
		assert.equal(runtime.children.length, 1);
		const child = runtime.children[0];
		for (let i = 0; i < 10; i++) child.emit({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "private streamed text" } });
		if (boundary === "long-running") {
			for (let i = 0; i < 6; i++) {
				clock += 20_000;
				for (const [at, fn] of [...renewalTimers]) if (at <= clock) { renewalTimers.delete(at); fn(); }
				await tick();
				child.emit({ type: "message_end", message: { role: "assistant", model: "gpt-4o", provider: "openai",
					providerThinkingLevel: "low", stopReason: "stop", usage: { input: 7, output: 3 } } });
			}
			assert.equal(renewalTimers.size, 0, "child telemetry never schedules a lease timer");
		}
		// jero-pi: env vetoes were send-path gates; local accounting ignores them.
		if (boundary === "env") env.DO_NOT_TRACK = "yes";
		if (boundary === "session" || boundary === "replacement") {
			child.emit({ type: "message_end", message: { role: "assistant", model: "gpt-4o", provider: "openai",
				stopReason: "stop", usage: { input: 7, output: 3 } } });
			if (boundary === "replacement") {
				Object.assign(context.ctx.sessionManager, { getSessionId: () => "replacement" });
				await h.fire("session_start", context.ctx);
			} else await h.fire("session_shutdown", context.ctx);
			assert.deepEqual(discarded, [1], "idle buffered response discarded at lifecycle boundary");
			assert.equal(renewalTimers.size, 0);
			if (boundary === "session") {
				assert.ok([...h.listeners.values()].every(set => set.size === 0), "old bus subscriptions removed");
				const fresh = fakePi();
				Object.assign(fresh.pi, { events: h.pi.events });
				gentleAgents(fresh.pi, env, { ...runtime.deps, env, metricsSchedule });
				await fresh.fire("session_start", context.ctx);
				assert.deepEqual(listenerCounts(), initialListeners, "fresh instance installs one subscription set");
				await fresh.fire("session_shutdown", context.ctx);
				assert.ok([...h.listeners.values()].every(set => set.size === 0));
				assert.equal(renewalTimers.size, 0);
			}
		}
		if (boundary === "bus-throws") h.pi.events.on(CHILD_METRICS_EVENT, () => { throw new Error("private bus error"); });
		for (const model of ["gpt-4o", "gpt-4o-mini"]) child.emit({ type: "message_end", message: {
			role: "assistant", model, provider: "openai", providerThinkingLevel: "low", stopReason: "stop", usage: { input: 7, output: 3 } } });
		child.emit({ type: "agent_end", messages: [{ role: "assistant", content: [{ type: "text", text: "done" }] }] });
		child.emit({ type: "agent_settled" });
		assert.match((await result).content[0].text, boundary === "session" ? /cancelled/ : /done/);
		await tick(); await tick();
		const events = h.events.filter(event => event.name === CHILD_METRICS_EVENT);
		const admitted = boundary === "allowed" || boundary === "env" || boundary === "bus-throws" || boundary === "long-running";
		assert.equal(events.length, Number(admitted));
		if (admitted) {
			assert.ok(!JSON.stringify(events).includes("private"));
			const event = events[0].data as import("../lib/runtime-metrics-children.ts").ChildMetricsEvent;
			assert.equal(event.launch.agentClass, "worker");
			assert.equal(event.launch.selectedEffort, "high");
			assert.equal(event.responses.length, boundary === "long-running" ? 8 : 2);
			assert.ok(event.responses.every(row => row.agentClass === "worker" && row.effort === "high"
				&& row.selectedProvider === "openai" && row.selectedModelId === "gpt-4o"));
			assert.equal(event.agentSettled, true);
			child.emit({ type: "agent_settled" });
			await tick();
			assert.equal(h.events.filter(event => event.name === CHILD_METRICS_EVENT).length, 1, "completion consumed once, even after bus failure");
		}
		assert.ok(!JSON.stringify(h.entries).includes("telemetry-policy"), "no policy envelope ever reaches the bus");
		assert.equal(renewalTimers.size, 0, "no renewal timer after the last task finishes");
		assert.ok(!JSON.stringify(h.entries).includes("launch_configuration"));
		await h.fire("session_shutdown", context.ctx);
	});
}

export async function eventually(check: () => boolean, message: string): Promise<void> {
	for (let attempt = 0; attempt < 120; attempt++) {
		if (check()) return;
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
	assert.fail(message);
}

export function liveProfile(name: string): string {
	const profile = join(realpathSync(root), name);
	mkdirSync(join(profile, "agents"), { recursive: true });
	for (const agent of ["local", "peer"]) {
		writeFileSync(join(profile, "agents", `${agent}.md`), `---\ndescription: ${agent}\n---\nFixture agent.`);
	}
	return profile;
}

export function liveInstance(t: test.TestContext, profile: string, sessionId: string) {
	const h = fakePi();
	const runtime = deps();
	const context = fakeContext();
	Object.assign(context.ctx.sessionManager, {
		getSessionId: () => sessionId,
		getSessionName: () => sessionId,
		getCwd: () => join(realpathSync(root), sessionId),
	});
	runtime.deps.schedule = (fn, ms) => {
		const timer = setTimeout(fn, ms);
		timer.unref();
		return () => clearTimeout(timer);
	};
	gentleAgents(h.pi, {}, { ...runtime.deps, agentHome: profile });
	t.after(async () => {
		for (const overlay of context.overlays) overlay.handleInput("q");
		await h.fire("session_shutdown", context.ctx, { reason: "quit" });
	});
	return { ...h, ...context, ...runtime };
}

export async function liveOverlay(instance: ReturnType<typeof liveInstance>) {
	const opened = instance.commands.get("jero:agents")!.handler("", instance.ctx);
	await eventually(() => instance.overlays.length > 0, "overlay must mount without waiting for an unbounded directory scan");
	const overlay = instance.overlays.at(-1)!;
	const frame = () => overlay.render(160).map(stripAnsi).join("\n");
	return { overlay, frame, opened };
}

test("live-only extension instances discover same-profile peers across cwd boundaries without importing their tasks", async (t) => {
	const profile = liveProfile("live-peer-profile");
	const local = liveInstance(t, profile, "local-live");
	const peer = liveInstance(t, profile, "peer-live");
	assert.equal(listPresence(profile).entries.length, 0, "factory construction starts no presence resources");
	await local.fire("session_start", local.ctx, { reason: "startup" });
	await peer.fire("session_start", peer.ctx, { reason: "startup" });
	assert.equal(listPresence(profile).entries.length, 2, "idle open orchestrators publish empty activity");
	for (const header of listPresence(profile).entries) assert.deepEqual(readActivity(profile, header).activity?.tasks, []);
	const panel = await liveOverlay(local);
	panel.overlay.handleInput("a");
	await eventually(() => /peer-live/.test(panel.frame()), "an idle peer with zero children must be discoverable");
	const run = async (instance: typeof local, agent: string) => {
		const result = await instance.tools.get("subagent_run")!.execute(agent, { agent, task: agent, mode: "background" }, undefined, undefined, instance.ctx);
		return (result.details.gentleAgents as { taskId: string }).taskId;
	};
	await run(local, "local");
	const peerId = await run(peer, "peer");
	await tick();
	peer.children[0].emit({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "peer streamed text" } });
	await eventually(() => listPresence(profile).entries.some((header) => readActivity(profile, header).activity?.tasks.some((row) => row.summary.id === peerId && row.thread.items.some((item) => item.text === "peer streamed text"))), "task deltas, not just status changes, must publish peer activity");
	await eventually(() => /Subagent peer/.test(panel.frame()), "open directory refreshes peer children without reopening");
	const peerPanel = await liveOverlay(peer);
	peerPanel.overlay.handleInput("a");
	await eventually(() => /Subagent local/.test(peerPanel.frame()), "discovery is symmetric across extension instances");
	const lines = panel.overlay.render(160).map(stripAnsi);
	const y = lines.findIndex((line) => line.includes("Subagent peer"));
	assert.ok(y > 0);
	panel.overlay.handleMouse?.(mouse("click", "left", 4, y, 160, lines.length));
	assert.match(panel.frame(), /peer streamed text/, "remote inspection reads the peer's pinned activity, not a local thread");
	for (const key of ["s", "c", "o", "\r"]) panel.overlay.handleInput(key);
	assert.deepEqual(local.customCompletions, [], "remote rows never route Open into the local editor");
	assert.deepEqual(local.children[0].killed, [], "remote Stop never cancels the local child");
	assert.deepEqual(peer.children[0].killed, [], "peer rows provide no remote control channel");
	assert.doesNotMatch((await local.tools.get("subagent_list_tasks")!.execute("list", {}, undefined, undefined, local.ctx)).content[0].text, /· peer ·/);
	assert.match((await local.tools.get("subagent_status")!.execute("status", { task_id: peerId }, undefined, undefined, local.ctx)).content[0].text, /no task/, "peer discovery must never restore into local TaskStore");
	panel.overlay.handleInput("a");
	assert.doesNotMatch(panel.frame(), /Subagent peer|peer-live|Current orchestrator/);
	assert.match(panel.frame(), /Subagent local/);
	panel.overlay.handleInput("a");
	await peer.fire("session_shutdown", peer.ctx, { reason: "resume" });
	await eventually(() => !/peer-live|Subagent peer/.test(panel.frame()), "shutdown removes the peer from an already-open directory");
	assert.equal(listPresence(profile).entries.length, 1);
	panel.overlay.handleInput("q");
	peerPanel.overlay.handleInput("q");
	await Promise.all([panel.opened, peerPanel.opened]);
});

test("manual agents command warns once in RPC mode and stays quiet without UI", async (t) => {
	const local = liveInstance(t, liveProfile("live-non-tui"), "non-tui");
	Object.assign(local.ctx, { mode: "rpc" });
	const notify = t.mock.method(local.ctx.ui, "notify");
	await local.commands.get("jero:agents")!.handler("", local.ctx);
	assert.equal(notify.mock.callCount(), 1);
	assert.equal(notify.mock.calls[0].arguments[1], "warning");
	assert.deepEqual(local.overlays, []);
	Object.assign(local.ctx, { hasUI: false });
	await local.commands.get("jero:agents")!.handler("", local.ctx);
	assert.equal(notify.mock.callCount(), 1, "headless invocation adds no notification");
	assert.deepEqual(local.overlays, []);
});

for (const scenario of ["recover", "shutdown", "replacement"] as const) {
	test(`live presence after owned-target publication failure: ${scenario}`, async (t) => {
		const profile = liveProfile(`live-io-${scenario}`);
		const local = liveInstance(t, profile, "io-original");
		await local.fire("session_start", local.ctx);
		const original = listPresence(profile).entries[0]!;
		const peer = scenario === "recover" ? liveInstance(t, profile, "io-original") : undefined;
		if (peer) await peer.fire("session_start", peer.ctx);
		const panel = peer ? await liveOverlay(local) : undefined;
		if (panel) {
			panel.overlay.handleInput("a");
			await eventually(() => /io-original/.test(panel.frame()), "same-session peer is visible before publication failure");
		}
		const target = join(profile, "gentle-agents", "presence", `${original.sessionHash}.${original.incarnation}.activity.json`);
		const fs = createRequire(import.meta.url)("node:fs") as typeof import("node:fs");
		const rename = fs.renameSync;
		let failures = 0;
		const fault = t.mock.method(fs, "renameSync", (from, to) => {
			if (to === target) {
				failures++;
				throw Object.assign(new Error("fixture publication failure"), { code: "EIO" });
			}
			return rename(from, to);
		});
		syncBuiltinESMExports();
		try {
			await local.tools.get("subagent_run")!.execute("io", { agent: "local", task: "Recover activity", mode: "background" }, undefined, undefined, local.ctx);
			await eventually(() => failures > 0 && !listPresence(profile).entries.some((header) => header.incarnation === original.incarnation), "guarded flush failure must dispose the owned publication");
		} finally {
			fault.mock.restore();
			syncBuiltinESMExports();
		}
		if (scenario === "shutdown") await local.fire("session_shutdown", local.ctx);
		if (scenario === "replacement") {
			const next = fakeContext().ctx;
			next.sessionManager.getSessionId = () => "io-replacement";
			await local.fire("session_start", next);
		}
		const replacement = listPresence(profile).entries[0];
		local.children[0].emit({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "activity after IO recovery" } });
		await tick();
		if (scenario === "recover") {
			await eventually(() => listPresence(profile).entries.some((header) => readActivity(profile, header).activity?.tasks.some((row) => row.thread.items.some((item) => item.text === "activity after IO recovery"))), "ordinary task delta must recreate presence with current activity");
			const recovered = listPresence(profile).entries;
			assert.equal(recovered.length, 2, "recovery preserves the distinct same-session peer");
			assert.ok(recovered.every((header) => header.sessionHash === original.sessionHash));
			assert.ok(recovered.every((header) => header.incarnation !== original.incarnation));
			const scans = t.mock.method(PresenceCursor.prototype, "next");
			await peer!.tools.get("subagent_run")!.execute("peer", { agent: "peer", task: "Peer after recovery", mode: "background" }, undefined, undefined, peer!.ctx);
			// The second scan starts only after the first post-recovery traversal is displayed.
			await eventually(() => scans.mock.callCount() >= 2 && /Subagent peer/.test(panel!.frame()), "same-session peer remains visible after recovery without reopening");
			assert.equal((panel!.frame().match(/Subagent local/g) ?? []).length, 1, "recovered local activity appears once, never as a read-only peer duplicate");
			assert.equal((panel!.frame().match(/Subagent peer/g) ?? []).length, 1, "the actual same-session peer remains independently visible");
		} else if (scenario === "shutdown") {
			assert.deepEqual(listPresence(profile).entries, [], "shutdown and late child events never recreate presence");
		} else {
			const headers = listPresence(profile).entries;
			assert.equal(headers.length, 1, "late old-session activity cannot resurrect its publisher");
			assert.notEqual(headers[0].sessionHash, original.sessionHash);
			assert.equal(headers[0].incarnation, replacement!.incarnation);
			assert.deepEqual(readActivity(profile, headers[0]).activity?.tasks, [], "replacement must not publish old-session tasks");
		}
	});
}

test("live-only instances sharing a session ID remain distinct and withdraw only their own incarnation", async (t) => {
	const profile = liveProfile("live-incarnation-profile");
	const local = liveInstance(t, profile, "same-live");
	const peer = liveInstance(t, profile, "same-live");
	peer.ctx.sessionManager.getCwd = () => join(realpathSync(root), "peer-cwd");
	for (const [instance, agent] of [[local, "local"], [peer, "peer"]] as const) {
		await instance.fire("session_start", instance.ctx, { reason: "startup" });
		await instance.tools.get("subagent_run")!.execute(agent, { agent, task: agent, mode: "background" }, undefined, undefined, instance.ctx);
	}
	const headers = listPresence(profile).entries;
	assert.equal(headers.length, 2);
	assert.equal(headers[0].sessionHash, headers[1].sessionHash);
	assert.notEqual(headers[0].incarnation, headers[1].incarnation);
	const panel = await liveOverlay(local);
	panel.overlay.handleInput("a");
	await eventually(() => /Subagent peer/.test(panel.frame()), "same-session peers remain independently visible");
	assert.equal((panel.frame().match(/Subagent local/g) ?? []).length, 1, "own publication is not duplicated as a peer");
	await local.fire("session_shutdown", local.ctx, { reason: "quit" });
	await panel.opened;
	assert.equal(listPresence(profile).entries.length, 1, "shutdown removes only this activation");
	assert.deepEqual(peer.children[0].killed, []);
});

test("live-only directory traverses presence overflow, excludes expired and other-profile peers, and replaces sessions", async (t) => {
	const profile = liveProfile("live-paged-profile");
	const now = Date.now();
	const oldClock = mock.method(Date, "now", () => now - 16_000);
	let expired: PresencePublisher;
	try {
		expired = PresencePublisher.start({ profile, sessionId: "expired", label: "Expired peer", activity: [] });
	} finally {
		oldClock.mock.restore();
	}
	// Simulate an abruptly closed publisher: retained files, but no renewing heartbeat.
	const stem = join(profile, "gentle-agents", "presence", `${expired.target.sessionHash}.${expired.target.incarnation}`);
	const staleFiles = ["header", "activity"].map((kind) => ({ path: `${stem}.${kind}.json`, bytes: readFileSync(`${stem}.${kind}.json`) }));
	expired.dispose();
	for (const { path, bytes } of staleFiles) writeFileSync(path, bytes, { mode: 0o600 });
	const isolated = PresencePublisher.start({ profile: liveProfile("live-isolated-profile"), sessionId: "isolated", label: "Isolated peer", activity: [] });
	t.after(() => isolated.dispose());
	for (let index = 0; index < 130; index++) {
		const publisher = PresencePublisher.start({ profile, sessionId: `idle-${index}`, label: `Idle peer ${index}`, activity: [] });
		t.after(() => publisher.dispose());
	}
	assert.equal(listPresence(profile).overflow, true, "fixture exceeds the foundation's first-page budget");
	let pageReadThisTurn = false;
	const next = PresenceCursor.prototype.next;
	const pages = t.mock.method(PresenceCursor.prototype, "next", function (this: PresenceCursor, ...args: Parameters<PresenceCursor["next"]>) {
		assert.equal(pageReadThisTurn, false, "directory pages must yield instead of blocking the UI with an unbounded loop");
		pageReadThisTurn = true;
		setImmediate(() => { pageReadThisTurn = false; });
		return next.apply(this, args);
	});
	const local = liveInstance(t, profile, "directory-local");
	await local.fire("session_start", local.ctx, { reason: "startup" });
	const panel = await liveOverlay(local);
	panel.overlay.handleInput("a");
	const seen = new Set<string>();
	await eventually(() => {
		for (let step = 0; step < 140; step++) {
			const frame = panel.frame();
			assert.doesNotMatch(frame, /Expired peer|Isolated peer/);
			for (const match of frame.matchAll(/Idle peer (\d+)/g)) seen.add(match[1]);
			panel.overlay.handleInput("j");
		}
		for (let step = 0; step < 140; step++) panel.overlay.handleInput("k");
		return seen.size === 130;
	}, "every idle orchestrator beyond the 128-entry page must eventually be reachable");
	assert.ok(pages.mock.callCount() >= 3, "the directory traversed all three fixture pages");
	panel.overlay.handleInput("q");
	await panel.opened;
	const readsAtClose = pages.mock.callCount();
	await new Promise((resolve) => setTimeout(resolve, 1100));
	assert.equal(pages.mock.callCount(), readsAtClose, "closing the overlay cancels future directory scans");
	pages.mock.restore();
	await local.fire("session_shutdown", local.ctx, { reason: "new" });
	const replacement = liveInstance(t, profile, "replacement-live");
	await replacement.fire("session_start", replacement.ctx, { reason: "new" });
	const cursor = new PresenceCursor(profile);
	const labels: string[] = [];
	try {
		let page;
		do {
			page = cursor.next();
			labels.push(...page.entries.map((entry) => entry.label));
		} while (page.overflow);
	} finally {
		cursor.close();
	}
	assert.ok(labels.some((label) => label.includes("replacement-live")));
	assert.ok(labels.every((label) => !label.includes("directory-local")), "session replacement withdraws the old activation");
	panel.overlay.handleInput("q");
	await panel.opened;
});

test("research launch transports selected grants and only matching existing extensions", async () => {
	const fixtureHome = join(root, "research-home");
	mkdirSync(join(fixtureHome, ".pi", "agent", "agents"), { recursive: true });
	writeFileSync(join(fixtureHome, ".pi", "agent", "agents", "sdd-research.md"), "---\nname: sdd-research\ntools: [read, write, fetch_content, web_search, source_check, mcp, bash]\n---\nCollect research.");
	const fake = fakePi(), runtime = deps(), { ctx } = fakeContext();
	fake.pi.getActiveTools = () => ["fetch_content", "web_search", "mcp", "bash"];
	fake.pi.getAllTools = () => fake.pi.getActiveTools().map(name => ({ name, sourceInfo: { source: "extension", path: "/installed/web.ts" } })) as never;
	const selection = { documentation: { tools: ["fetch_content"], extensions: { fetch_content: "/installed/web.ts" } } };
	const artifact = { store: "openspec", worktree: cwd, changeName: "demo", retainedIntent: "preserve denied documentation questions", locators: [{ artifact: "research", path: join(cwd, "openspec/changes/demo/research.md"), revision: 1, digest: "a".repeat(64) }] };
	let childEnv: NodeJS.ProcessEnv = {};
	gentleAgents(fake.pi, {}, { ...runtime.deps, home: fixtureHome, spawn: (command, args, options) => {
		childEnv = options.env!;
		return runtime.deps.spawn!(command, args, options);
	} });
	const result = await fake.tools.get("subagent_run")!.execute("research", { agent: "sdd-research", task: "Research docs", context: PARENT_CONFIRMED_SDD_CONTEXT, mode: "background", research_selection: selection, research_artifact: artifact }, undefined, undefined, ctx);
	await tick();
	const argv = runtime.spawned[0];
	assert.equal(argv[argv.indexOf("--tools") + 1], "read,write,fetch_content,subagent_parent_message");
	assert.equal(argv[argv.indexOf("--extension") + 1], "/installed/web.ts");
	assert.deepEqual(JSON.parse(childEnv.JERO_PI_RESEARCH_SELECTION!), selection);
	assert.deepEqual(JSON.parse(childEnv.JERO_PI_RESEARCH_ARTIFACT!), artifact);
	assert.ok(fake.tools.get("subagent_continue")!.parameters.properties.research_artifact);
	assert.ok(fake.tools.get("subagent_continue")!.parameters.properties.research_selection, "fresh selection must be expressible on continuation");
	assert.ok(JSON.parse(childEnv.JERO_PI_RESEARCH_TOOLS!).includes("subagent_parent_message"));
	assert.match(argv[argv.indexOf("--append-system-prompt") + 1], /documentation: available/);
	assert.match(argv[argv.indexOf("--append-system-prompt") + 1], /open-web: blocked/, "two reachable tools cannot admit open-web");
	runtime.children[0].emit({ type: "agent_settled" });
	await tick();
	const taskId = (result.details.gentleAgents as { taskId: string }).taskId;
	const rejected = await fake.tools.get("subagent_continue")!.execute("broaden", { task_id: taskId, prompt: "Inspect", mode: "background", research_artifact: { ...artifact, store: "none", locators: [] } }, undefined, undefined, ctx);
	assert.match(rejected.content[0].text, /scope/);
	assert.equal(runtime.spawned.length, 1);
	await fake.tools.get("subagent_continue")!.execute("resume", { task_id: taskId, prompt: "Inspect", mode: "background", research_artifact: artifact }, undefined, undefined, ctx);
	await tick();
	assert.equal(runtime.spawned.length, 2);
	assert.ok(!runtime.spawned[1].includes("--extension"), "no inherited research selection");
	assert.equal(runtime.spawned[1][runtime.spawned[1].indexOf("--tools") + 1], "read,write,subagent_parent_message");
	assert.equal(JSON.parse(childEnv.JERO_PI_RESEARCH_SELECTION!), null);
	assert.deepEqual(JSON.parse(childEnv.JERO_PI_RESEARCH_ARTIFACT!), artifact, "denial intent and exact store/path survive re-entry");
	fake.pi.getActiveTools = () => ["web_search"];
	runtime.children[1].emit({ type: "agent_settled" });
	await tick();
	const denied = await fake.tools.get("subagent_continue")!.execute("missing-tool", { task_id: taskId, prompt: "Retry same scope", mode: "background", research_selection: selection, research_artifact: artifact }, undefined, undefined, ctx);
	await tick();
	assert.ok(!runtime.spawned[2].includes("--extension"));
	runtime.children[2].emit({ type: "agent_settled" });
	await tick();
	fake.pi.getActiveTools = () => ["fetch_content", "web_search"];
	await fake.tools.get("subagent_continue")!.execute("corrected", { task_id: (denied.details.gentleAgents as { taskId: string }).taskId, prompt: "Retry same scope", mode: "background", research_selection: selection, research_artifact: artifact }, undefined, undefined, ctx);
	await tick();
	assert.equal(runtime.spawned[3][runtime.spawned[3].indexOf("--extension") + 1], "/installed/web.ts");
	assert.deepEqual(JSON.parse(childEnv.JERO_PI_RESEARCH_ARTIFACT!), artifact);
	await fake.fire("session_shutdown", ctx);
});

test("research child inventory requires every canonical open-web tool", () => {
	const required = ["web_search", "source_check", "fetch_content", "get_search_content"];
	for (const missing of [undefined, ...required]) {
		const hooks = new Map<string, (event: any) => any>();
		const active = required.filter(name => name !== missing);
		const pi = { on: (name: string, handler: (event: any) => any) => hooks.set(name, handler), getActiveTools: () => active, getAllTools: () => required.map(name => ({ name, sourceInfo: { source: "extension", path: "/installed/web.ts" } })) } as never;
		gentleAgents(pi, { JERO_PI_AGENTS_CHILD: "1", JERO_PI_RESEARCH_TOOLS: JSON.stringify(required), JERO_PI_RESEARCH_SELECTION: JSON.stringify({ documentation: { tools: ["fetch_content"], extensions: { fetch_content: "/installed/web.ts" } }, "open-web": { tools: required, extensions: Object.fromEntries(required.map(name => [name, "/installed/web.ts"])) } }) });
		const prompt = hooks.get("before_agent_start")!({ systemPrompt: "research" }).systemPrompt;
		assert.match(prompt, new RegExp(`open-web: ${missing === undefined ? "available" : "blocked"}`));
		assert.match(prompt, new RegExp(`documentation: ${missing === "fetch_content" ? "blocked" : "available"}`));
		assert.match(prompt, /Availability is not evidence/);
	}
});

test("research child rechecks local inventory and blocks gateway calls", async () => {
	const hooks = new Map<string, (event: any) => any>();
	const pi = { on: (name: string, handler: (event: any) => any) => hooks.set(name, handler), getActiveTools: () => ["read", "mcp"], getAllTools: () => [{ name: "read" }, { name: "mcp" }] } as never;
	gentleAgents(pi, { JERO_PI_AGENTS_CHILD: "1", JERO_PI_RESEARCH_TOOLS: '["read","fetch_content"]' });
	assert.match(hooks.get("before_agent_start")!({ systemPrompt: "research" }).systemPrompt, /documentation: blocked/);
	assert.equal(hooks.get("tool_call")!({ toolName: "mcp" }).block, true);
	assert.equal(hooks.get("tool_call")!({ toolName: "fetch_content" }).block, true);
	assert.equal(hooks.get("tool_call")!({ toolName: "read" }).block, true, "missing artifact scope cannot authorize a read");
});

export async function shutdownAndRestoreNativeSpawn(
	childProcess: typeof import("node:child_process"),
	originalSpawn: typeof import("node:child_process").spawn,
	shutdown: () => Promise<unknown>,
): Promise<void> {
	try {
		await shutdown();
	} finally {
		childProcess.spawn = originalSpawn;
		syncBuiltinESMExports();
	}
}

for (const matching of [true, false]) {
 test("owned child diff relay validates the exact file independently of review bookkeeping: "+matching, async () => {
  const h=fakePi(), d=deps(), {ctx}=fakeContext();
  const target=realpathSync(cwd);
  (ctx as any).cwd=target;
  ctx.sessionManager.getCwd=()=>target;
  ctx.sessionManager.getEntries=(()=>h.entries) as any;
  ctx.sessionManager.getBranch=(()=>h.entries) as any;
  d.deps.resolveWorktree=(path,base)=>{
   const full=resolve(base,path);
   return full===target||full.startsWith(target+sep)?{root:target,commonDir:"/fixture/common"}:undefined;
  };
  const spawn=d.deps.spawn!;
  d.deps.spawn=(...args)=>{
   const child=spawn(...args),on=child.on.bind(child);
   child.on=((event,listener)=>{if(event==="spawn")queueMicrotask(listener);return on(event,listener);}) as any;
   return child;
  };
  gentleAgents(h.pi,{},d.deps);
  await h.fire("session_start",ctx);
  await h.tools.get("subagent_run")!.execute("diff",{agent:"explore",task:"Write",mode:"background",workspace_root:target},undefined,undefined,ctx);
  await tick();
  writeFileSync(join(target,"session-diff-test.ts"),"agent\n");
  const evidence={id:"write",root:target,path:matching?"session-diff-test.ts":"different.ts",before:{kind:"text",text:"original\n"},after:{kind:"text",text:"agent\n"}};
  d.children[0].emit({type:"tool_execution_start",toolCallId:"write",toolName:"write",args:{path:"session-diff-test.ts"}});
  d.children[0].emit({type:"tool_execution_end",toolCallId:"write",isError:false,result:{content:[],details:{gentleSessionChange:evidence}}});
  const relays=h.events.filter(event=>event.name==="gentle-pi:child-session-change");
  assert.equal(relays.length,matching?1:0);
  if(matching) assert.match((relays[0].data as any).evidence.id,/:write$/);
  assert.equal(h.entries.filter(entry=>entry.customType===REVIEW_REMINDER_RECEIPT).length,1);
  await h.fire("session_shutdown",ctx); await tick();
 });
}

for (const scenario of ["own", "other-root", "escaped", "sibling", "session-switch", "shutdown", "unregistered"] as const) {
	test(`child mutation attribution through registered subagent_run: ${scenario}`, async () => {
		const h = fakePi();
		const d = deps();
		const { ctx } = fakeContext();
		let sessionId = "s1";
		const sibling = join(root, "sibling");
		const childRoot = scenario === "other-root" ? sibling : cwd;
		ctx.sessionManager.getSessionId = () => sessionId;
		ctx.sessionManager.getEntries = (() => h.entries) as typeof ctx.sessionManager.getEntries;
		ctx.sessionManager.getBranch = (() => h.entries) as typeof ctx.sessionManager.getBranch;
		d.deps.resolveWorktree = (path, base) => {
			const absolute = resolve(base, path);
			const worktree = [cwd, sibling].find((candidate) => absolute === candidate || absolute.startsWith(candidate + sep));
			return worktree ? { root: worktree, commonDir: "/fixture/common" } : undefined;
		};
		const spawn = d.deps.spawn!;
		d.deps.spawn = (...args) => {
			const child = spawn(...args);
			const on = child.on.bind(child);
			child.on = ((event: string, listener: () => void) => {
				if (event === "spawn" && scenario !== "unregistered") queueMicrotask(listener);
				return on(event as "spawn", listener);
			}) as typeof child.on;
			return child;
		};
		gentleAgents(h.pi, {}, d.deps);
		await h.fire("session_start", ctx);
		await h.tools.get("subagent_run")!.execute("mutation", { agent: "explore", task: "Write", mode: "background", workspace_root: childRoot }, undefined, undefined, ctx);
		await tick();
		assert.equal(h.entries.filter((entry) => entry.customType === REVIEW_REMINDER_RECEIPT).length, 0, "spawn alone is not ownership");
		if (scenario === "session-switch") sessionId = "s2";
		if (scenario === "shutdown") await h.fire("session_shutdown", ctx);
		const path = scenario === "escaped" ? "../../outside.ts" : scenario === "sibling" ? join(sibling, "file.ts") : "file.ts";
		d.children[0].emit({ type: "tool_execution_start", toolCallId: "write", toolName: "write", args: { path } });
		d.children[0].emit({ type: "tool_execution_end", toolCallId: "write", isError: false, result: { content: [] } });
		const accepted = scenario === "own" || scenario === "other-root";
		assert.equal(h.entries.filter((entry) => entry.customType === REVIEW_REMINDER_RECEIPT).length, accepted ? 1 : 0);
		assert.equal(Boolean(pendingReviewMutation(ctx.sessionManager, cwd)), scenario === "own", "another registered root never authorizes current-root STATUS");
		if (scenario === "other-root") assert.ok(pendingReviewMutation(ctx.sessionManager, sibling));
		await h.fire("session_shutdown", ctx);
		await tick();
	});
}

