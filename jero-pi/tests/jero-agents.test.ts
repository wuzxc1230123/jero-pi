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
	agentsViewKey, answerThroughUi, completionText, default as jeroAgents,
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
	PARENT_CONFIRMED_SDD_CONTEXT, plainTheme, type Registered, root,
	tick, eventually, liveInstance, liveOverlay, liveProfile,
} from "./jero-agents-shared.ts";

test("all ten subagent registrations own their transcript shell", () => {
	const { pi, tools } = fakePi();
	jeroAgents(pi, {}, deps().deps);
	assert.equal(tools.size, 10);
	assert.deepEqual(tools.get("subagent_reconcile")?.parameters, { type: "object", additionalProperties: false, required: ["task_id"], properties: { task_id: { type: "string" } } });
	for (const tool of tools.values()) assert.equal(tool.renderShell, "self", tool.name);
});

test("host query delivery exposes correlation and accepts one current-session reply", async () => {
	const { pi, tools, fire, sent } = fakePi();
	const harness = deps();
	jeroAgents(pi, {}, harness.deps);
	const { ctx } = fakeContext();
	await fire("session_start", ctx);
	const started = await tools.get("subagent_run")!.execute("query", { agent: "explore", task: "Ask once", mode: "background" }, undefined, undefined, ctx);
	const taskId = (started.details.jeroAgents as { taskId: string }).taskId;
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
	jeroAgents(pi, {}, harness.deps);
	const { ctx } = fakeContext();
	await fire("session_start", ctx);
	const pending = tools.get("subagent_run")!.execute("foreground", { agent: "explore", task: "Ask then finish" }, undefined, undefined, ctx);
	await tick();
	harness.children[0].message({ id: "q1", kind: "query", message: "Which file?" });
	const yielded = await pending;
	const taskId = (yielded.details.jeroAgents as { taskId: string }).taskId;
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
	jeroAgents(pi, {}, harness.deps);
	const { ctx } = fakeContext();
	await fire("session_start", ctx);
	const pending = tools.get("subagent_run")!.execute("cancel", { agent: "explore", task: "cancel after query" }, undefined, undefined, ctx);
	await tick();
	harness.children[0].message({ id: "q1", kind: "query", message: "q" });
	const yielded = await pending;
	const taskId = (yielded.details.jeroAgents as { taskId: string }).taskId;
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
	jeroAgents(pi, {}, harness.deps);
	const { ctx } = fakeContext();
	await fire("session_start", ctx);
	const pending = tools.get("subagent_run")!.execute("switch", { agent: "explore", task: "switch session" }, undefined, undefined, ctx);
	await tick();
	harness.children[0].message({ id: "q1", kind: "query", message: "q" });
	const yielded = await pending;
	const taskId = (yielded.details.jeroAgents as { taskId: string }).taskId;
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
	jeroAgents(first.pi, {}, firstHarness.deps);
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
	jeroAgents(second.pi, {}, secondHarness.deps);
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
	jeroAgents(pi, {}, harness.deps);
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



test("child parent-message tooling admits notifications and the active parent preserves raw model text", async () => {
	const child = fakePi();
	const listeners = new Map<string, Array<(value: Record<string, unknown>) => void>>();
	const frames: Array<Record<string, unknown>> = [];
	jeroAgents(child.pi, { JERO_PI_AGENTS_CHILD: "1", JERO_PI_AGENTS_OWNED_IPC: "fixture" }, {
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
	jeroAgents(parent.pi, {}, runtime.deps);
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
		jeroAgents(h.pi, env, { ...runtime.deps, env, agentHome: profile, metricsNow: () => clock, metricsSchedule });
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
				jeroAgents(fresh.pi, env, { ...runtime.deps, env, metricsSchedule });
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
		return (result.details.jeroAgents as { taskId: string }).taskId;
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

test("session replacement (new/resume/fork) keeps one-shot registrations and live tasks; quit tears down", async () => {
	const h = fakePi();
	const runtime = deps();
	jeroAgents(h.pi, {}, runtime.deps);
	const { ctx } = fakeContext();
	await h.fire("session_start", ctx);
	await h.tools.get("subagent_run")!.execute("run", { agent: "explore", task: "survive replacement", mode: "background" }, undefined, undefined, ctx);
	await tick();
	assert.equal(runtime.children.length, 1);
	for (const reason of ["new", "resume", "fork"] as const) {
		await h.fire("session_shutdown", ctx, { reason });
		assert.deepEqual(runtime.children[0].killed, [], `session replacement (${reason}) must not kill tasks that survive with their session`);
	}
	assert.ok([...h.listeners.values()].every((set) => set.size > 0), "one-shot bus subscriptions survive session replacement");
	await h.fire("session_shutdown", ctx, { reason: "quit" });
	assert.ok(runtime.children[0].killed.length > 0, "quit still tears down live tasks");
	assert.ok([...h.listeners.values()].every((set) => set.size === 0), "quit still removes one-shot subscriptions");
	await tick();
});
