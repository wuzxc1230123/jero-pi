// agents-runner 测试第 2 段（共 2 段；夹具在 agents-runner-shared.ts）。
// 机械平移自原 agents-runner.test.ts，语义零改动。

import { default as assert } from "node:assert/strict";
import { default as test } from "node:test";
import { PassThrough } from "node:stream";
import { AGENT_MODE, type AgentDefinition, parseAgentsConfig, resolveAgentProfile } from "../lib/agents-config.ts";
import { type RemediationTaskState, TASK_STATUS, type TaskRecord, TaskStore } from "../lib/agents-protocol.ts";
import {
	abortReasonText, AgentRunner, childArguments, JsonLines, piCommand, type RemediationPlan,
	type RemediationTerminalFacts, type RunnerDeps, type RunnerHooks, type TaskRequest
} from "../lib/agents-runner.ts";
import { fakeChild, type FakeChild } from "./agents-fake-child.ts";
import { explorer, FOUR_MIN_MS, harness, type Harness, request, silentHarness, tick } from "./agents-runner-shared.ts";

test("AgentRunner runs a task end to end: prompt, deltas into the store, completion with the last answer", async () => {
	const { store, runner, children } = harness();
	const task = runner.run(request());
	assert.equal(task.status, TASK_STATUS.QUEUED);
	await tick();
	assert.equal(store.get(task.id)?.status, TASK_STATUS.RUNNING);
	const [child] = children;
	await tick();
	assert.deepEqual(children[0].written.map((command) => command.type), ["get_state", "prompt"]);
	assert.equal(children[0].written[1].message, "Map the repo");
	child.emit({ type: "tool_execution_start", toolCallId: "c1", toolName: "grep", args: {} });
	child.emit({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "Found it" } });
	child.emit({ type: "agent_end", messages: [{ role: "assistant", content: [{ type: "text", text: "Found it" }] }] });
	await tick();
	assert.equal(store.get(task.id)?.status, TASK_STATUS.RUNNING, "agent_end retains the latest answer while queued follow-up may still run");
	assert.equal(children[0].killed.length, 0, "the child remains available until Pi reports settlement");
	child.emit({ type: "agent_settled" });
	await tick();
	const finished = store.get(task.id);
	assert.equal(finished?.status, TASK_STATUS.COMPLETED);
	assert.equal(finished?.result, "Found it");
	assert.equal(finished?.toolCalls, 1);
	assert.equal(finished?.sessionPath, "/sessions/child.jsonl");
	assert.equal(finished?.label, "Map the repo");
	assert.ok(children[0].killed.length > 0, "the child is stopped once the answer is in");
	assert.equal(store.thread(task.id).items.length, 2);
	assert.equal((await runner.waitFor(task.id)).status, TASK_STATUS.COMPLETED);
});

test("AgentRunner waits for child exit after settlement before releasing its queue slot or finishing twice", async () => {
	const { store, runner, children, finishes } = harness({ maxConcurrency: 1, exitOnKill: false });
	const first = runner.run(request());
	const second = runner.run(request({ prompt: "Second" }));
	await tick();
	assert.equal(children.length, 1);
	children[0].emit({ type: "agent_end", messages: [{ role: "assistant", content: [{ type: "text", text: "Answer" }] }] });
	await tick();
	assert.equal(store.get(first.id)?.status, TASK_STATUS.RUNNING, "agent_end ends one run, not the session");
	assert.equal(store.get(first.id)?.result, "Answer", "agent_end retains the final run output");
	assert.equal(store.get(second.id)?.status, TASK_STATUS.QUEUED, "the slot stays occupied until settlement");
	assert.deepEqual(finishes, []);
	children[0].emit({ type: "agent_settled" });
	await tick();
	assert.equal(store.get(first.id)?.status, TASK_STATUS.RUNNING, "terminal RPC state does not release a live process");
	assert.equal(store.get(second.id)?.status, TASK_STATUS.QUEUED);
	children[0].exit(0);
	await tick();
	await tick();
	assert.equal(store.get(first.id)?.status, TASK_STATUS.COMPLETED);
	assert.deepEqual(finishes, [first.id], "settlement delivers completion once");
	assert.equal(children.length, 2, "child exit releases the queue slot");
	children[0].emit({ type: "agent_settled" });
	await tick();
	assert.deepEqual(finishes, [first.id], "duplicate terminal events do not finalize twice");
});

test("AgentRunner queues beyond max concurrency and starts the next task when one finishes", async () => {
	const { store, runner, children } = harness({ maxConcurrency: 1 });
	const first = runner.run(request());
	const second = runner.run(request({ prompt: "Second" }));
	await tick();
	assert.equal(children.length, 1);
	assert.equal(store.get(second.id)?.status, TASK_STATUS.QUEUED);
	children[0].emit({ type: "agent_end", messages: [{ role: "assistant", content: [{ type: "text", text: "First complete." }], stopReason: "stop" }] });
	await tick();
	assert.equal(store.get(first.id)?.status, TASK_STATUS.RUNNING, "the concurrency slot remains held through a queued follow-up");
	children[0].emit({ type: "agent_settled" });
	await tick();
	await tick();
	assert.equal(store.get(first.id)?.status, TASK_STATUS.COMPLETED);
	assert.equal(children.length, 2);
	assert.equal(store.get(second.id)?.status, TASK_STATUS.RUNNING);
});

test("AgentRunner classifies terminal assistant outcomes only after settlement", async () => {
	const scenarios = [
		{ name: "error", messages: [{ role: "assistant", content: [], stopReason: "error", errorMessage: "WebSocket error: secret=never-copy" }], status: TASK_STATUS.FAILED, error: /assistant reported an error/ },
		{ name: "aborted", messages: [{ role: "assistant", content: [], stopReason: "aborted" }], status: TASK_STATUS.FAILED, error: /assistant aborted/ },
		{ name: "empty", messages: [{ role: "assistant", content: [], stopReason: "stop" }], status: TASK_STATUS.FAILED, error: /no final report/ },
		{ name: "success", messages: [{ role: "assistant", content: [{ type: "text", text: "final report" }], stopReason: "stop" }], status: TASK_STATUS.COMPLETED, error: null },
	] as const;
	for (const scenario of scenarios) {
		const { store, runner, children } = harness();
		const task = runner.run(request());
		await tick();
		children[0].emit({ type: "agent_end", messages: scenario.messages });
		assert.equal(store.get(task.id)?.status, TASK_STATUS.RUNNING, `${scenario.name} stays running until settlement`);
		children[0].emit({ type: "agent_settled" });
		const finished = await runner.waitFor(task.id);
		assert.equal(finished.status, scenario.status, scenario.name);
		if (scenario.error) assert.match(finished.error ?? "", scenario.error);
		else assert.equal(finished.result, "final report");
	}
});

test("AgentRunner clears an earlier answer after a later error, but permits a successful retry before settlement", async () => {
	const first = harness();
	const failedTask = first.runner.run(request());
	await tick();
	first.children[0].emit({ type: "agent_end", messages: [{ role: "assistant", content: [{ type: "text", text: "stale success" }], stopReason: "stop" }] });
	first.children[0].emit({ type: "agent_end", messages: [{ role: "assistant", content: [], stopReason: "error", errorMessage: "provider detail must not persist" }] });
	first.children[0].emit({ type: "agent_settled" });
	const failed = await first.runner.waitFor(failedTask.id);
	assert.equal(failed.status, TASK_STATUS.FAILED);
	assert.equal(failed.result, null, "a later error must not report stale successful text");

	const retry = harness();
	const retryTask = retry.runner.run(request());
	await tick();
	retry.children[0].emit({ type: "agent_end", messages: [{ role: "assistant", content: [], stopReason: "error" }] });
	retry.children[0].emit({ type: "agent_end", messages: [{ role: "assistant", content: [{ type: "text", text: "retry report" }], stopReason: "stop" }] });
	retry.children[0].emit({ type: "agent_settled" });
	const recovered = await retry.runner.waitFor(retryTask.id);
	assert.equal(recovered.status, TASK_STATUS.COMPLETED);
	assert.equal(recovered.result, "retry report");
});

test("AgentRunner fails if the child exits after agent_end but before agent_settled", async () => {
	const { store, runner, children } = harness();
	const task = runner.run(request());
	await tick();
	children[0].emit({ type: "agent_end", messages: [{ role: "assistant", content: [{ type: "text", text: "partial answer" }] }] });
	await tick();
	children[0].exit(0);
	await tick();
	assert.equal(store.get(task.id)?.status, TASK_STATUS.FAILED);
	assert.match(store.get(task.id)?.error ?? "", /before agent_settled/);
	assert.equal(store.get(task.id)?.result, "partial answer", "the final observed answer remains available for diagnostics");
});

for (const [platform, detached] of [["win32", false], ["linux", true]] as const) test(`AgentRunner selects detached=${detached} for ${platform} without changing the launch contract`, async () => {
	const store = new TaskStore();
	const launches: Array<{ command: string; args: string[]; options: Parameters<RunnerDeps["spawn"]>[2] }> = [];
	const child = fakeChild();
	const runner = new AgentRunner(store, { maxConcurrency: 1, stallTimeoutMs: 1_000 }, {
		spawn: (command, args, options) => {
			launches.push({ command, args, options });
			return child.child;
		},
		now: () => 1,
		schedule: () => () => {},
		pi: { command: "pi-fixture", args: ["--from-host"] },
		process: { platform, kill: () => {} },
	}, { askUser: async () => ({ cancelled: true }) });
	const task = runner.run(request({ env: { PATH: "/fixture", KEEP: "yes" } }));
	await tick();
	const ownedIpc = launches[0]?.options.env.JERO_PI_AGENTS_OWNED_IPC;
	assert.match(ownedIpc ?? "", /^\d+-[a-z0-9]+$/, "the runner creates an opaque owned-IPC marker");
	assert.deepEqual(launches, [{
		command: "pi-fixture",
		args: ["--from-host", "--mode", "rpc", "--session-dir", "/sessions", "--model", "openai-codex/gpt-5.6-terra:high", "--tools", "read,grep,subagent_parent_message", "--append-system-prompt", "You map things."],
		options: { cwd: "/repo", env: { PATH: "/fixture", KEEP: "yes", JERO_PI_AGENTS_CHILD: "1", JERO_PI_AGENTS_OWNED_IPC: ownedIpc }, detached, stdio: ["pipe", "pipe", "pipe", "ipc"] },
	}]);
	child.emit({ type: "agent_end", messages: [{ role: "assistant", content: [{ type: "text", text: "platform checked" }], stopReason: "stop" }] });
	child.emit({ type: "agent_settled" });
	assert.equal((await runner.waitFor(task.id)).status, TASK_STATUS.COMPLETED);
});

test("AgentRunner retains permission broker fd3 and assigns messaging IPC to fd4", async () => {
	const { runner, children, spawnOptions } = harness();
	const task = runner.run(request({ authorizeParentStandingReviewPermission: () => true }));
	await tick();
	const launch = spawnOptions[0];
	assert.match(launch?.env.JERO_PI_AGENTS_OWNED_IPC ?? "", /^\d+-[a-z0-9]+$/, "the owned-IPC marker has the runner's opaque shape");
	assert.deepEqual(launch?.env, { JERO_PI_AGENTS_CHILD: "1", JERO_PI_AGENTS_OWNED_IPC: launch?.env.JERO_PI_AGENTS_OWNED_IPC, JERO_PI_AGENTS_PARENT_PERMISSION_FD: "3" });
	assert.deepEqual(launch?.stdio, ["pipe", "pipe", "pipe", "pipe", "ipc"]);
	assert.equal(launch?.stdio?.length, 5);
	children[0].emit({ type: "agent_end", messages: [{ role: "assistant", content: [{ type: "text", text: "channel checked" }], stopReason: "stop" }] });
	children[0].emit({ type: "agent_settled" });
	assert.equal((await runner.waitFor(task.id)).status, TASK_STATUS.COMPLETED);
});

test("AgentRunner answers dialogs through askUser in task mode and cancels them in background mode", async () => {
	const { store, runner, children, asks } = harness({ answer: { confirmed: true } });
	const task = runner.run(request());
	const background = runner.run(request({ mode: AGENT_MODE.BACKGROUND }));
	await tick();
	children[0].emit({ type: "extension_ui_request", id: "u1", method: "confirm", title: "Delete?" });
	children[1].emit({ type: "extension_ui_request", id: "u2", method: "select", title: "Pick", options: ["a"] });
	children[1].emit({ type: "extension_ui_request", id: "u3", method: "notify", message: "hi" });
	await tick();
	await tick();
	assert.deepEqual(asks, [{ taskId: task.id, method: "confirm" }]);
	assert.deepEqual(children[0].written.at(-1), { type: "extension_ui_response", id: "u1", confirmed: true });
	assert.deepEqual(children[1].written.at(-1), { type: "extension_ui_response", id: "u2", cancelled: true });
	assert.equal(store.get(background.id)?.status, TASK_STATUS.RUNNING);
	assert.equal(store.get(task.id)?.status, TASK_STATUS.RUNNING, "answered questions do not leave the task waiting");
});

test("AgentRunner cancels and fails when the child exits early", async () => {
	const { store, runner, children } = harness({ maxConcurrency: 3 });
	const cancelled = runner.run(request());
	const crashed = runner.run(request());
	await tick();
	runner.cancel(cancelled.id);
	await tick();
	assert.equal(store.get(cancelled.id)?.status, TASK_STATUS.CANCELLED);
	assert.ok(children[0].written.some((command) => command.type === "abort"));
	children[1].exit(1);
	await tick();
	assert.equal(store.get(crashed.id)?.status, TASK_STATUS.FAILED);
	assert.match(store.get(crashed.id)?.error ?? "", /exited with code 1/);
	assert.ok(runner.steer(cancelled.id, "x") === false, "a finished task cannot be steered");
});

test("AgentRunner has no total-duration watchdog but keeps active work alive and times out true silence", async () => {
	const { store, runner, children, timers } = harness();
	const task = runner.run(request({ mode: AGENT_MODE.BACKGROUND }));
	await tick();
	assert.deepEqual(timers.filter((timer) => !timer.cancelled).map((timer) => timer.ms), [10_000], "only the inactivity watchdog is scheduled");
	const initialStall = timers[0];
	children[0].emit({ type: "response", id: "r1", success: true });
	await tick();
	assert.equal(initialStall.cancelled, true, "every child RPC event, including a response, re-arms the inactivity watchdog");
	children[0].emit({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "still working" } });
	await tick();
	assert.equal(store.get(task.id)?.status, TASK_STATUS.RUNNING, "ongoing RPC activity keeps a long-running task active");
	const stall = timers.filter((timer) => timer.ms === 10_000 && !timer.cancelled).at(-1);
	assert.ok(stall);
	stall.fn();
	await tick();
	assert.equal(store.get(task.id)?.status, TASK_STATUS.TIMED_OUT);
	assert.match(store.get(task.id)?.error ?? "", /stalled/);
});

test("AgentRunner.cancelAll stops every queued and running task", async () => {
	const { store, runner, children } = harness({ maxConcurrency: 1 });
	const running = runner.run(request());
	const queued = runner.run(request());
	await tick();
	assert.equal(runner.cancelAll(), 2);
	await tick();
	assert.equal(store.get(running.id)?.status, TASK_STATUS.CANCELLED);
	assert.equal(store.get(queued.id)?.status, TASK_STATUS.CANCELLED);
	assert.deepEqual(children[0].killed, ["SIGTERM"]);
	assert.equal(children.length, 1, "nothing else starts after cancelAll");
});

test("AgentRunner fails only the task when the child cannot start, and the queue moves on", async () => {
	const { store, runner, children, timers } = harness({ maxConcurrency: 1 });
	const broken = runner.run(request());
	const next = runner.run(request({ prompt: "After" }));
	await tick();
	children[0].fail("spawn pi ENOENT");
	await tick();
	assert.equal(store.get(broken.id)?.status, TASK_STATUS.FAILED);
	assert.match(store.get(broken.id)?.error ?? "", /could not start pi: spawn pi ENOENT/);
	assert.equal((await runner.waitFor(broken.id)).status, TASK_STATUS.FAILED, "waiters settle");
	await tick();
	assert.equal(children.length, 2, "the next queued task starts");
	assert.equal(store.get(next.id)?.status, TASK_STATUS.RUNNING);
	assert.ok(timers.filter((timer) => timer.ms === 10_000).some((timer) => timer.cancelled), "the failed task's inactivity watchdog is cancelled");
});

test("AgentRunner turns a synchronous spawn exception into a failed task", async () => {
	const store = new TaskStore();
	const runner = new AgentRunner(store, { maxConcurrency: 1, stallTimeoutMs: 1000 }, {
		spawn: () => {
			throw new Error("ENOENT: pi not found");
		},
		now: () => 1,
		schedule: () => () => {},
		pi: { command: "missing-pi", args: [] },
	}, { askUser: async () => ({ cancelled: true }) });
	const task = runner.run(request());
	const finished = await runner.waitFor(task.id);
	assert.equal(finished.status, TASK_STATUS.FAILED);
	assert.match(finished.error ?? "", /could not start pi: ENOENT/);
});

for (const lateEvents of [false, true]) test(`AgentRunner releases quarantined capacity only on proven exit (late events: ${lateEvents})`, async () => {
	const store = new TaskStore();
	const timers: Array<{ fn: () => void; ms: number; cancelled: boolean }> = [];
	let now = 0;
	let groupGone = false;
	let launches = 0;
	let asks = 0;
	const finishes: string[] = [];
	const observations: Parameters<NonNullable<RunnerHooks["onFinish"]>>[1][] = [];
	let resolveAnswer!: (answer: { value: string }) => void;
	const answer = new Promise<{ value: string }>((resolve) => { resolveAnswer = resolve; });
	const child = fakeChild({ exitOnKill: false, pid: 71 });
	const runner = new AgentRunner(store, { maxConcurrency: 1, stallTimeoutMs: 10_000 }, {
		spawn: () => { launches += 1; return launches === 1 ? child.child : fakeChild().child; },
		now: () => now,
		schedule: (fn, ms) => {
			const timer = { fn, ms, cancelled: false };
			timers.push(timer);
			return () => { timer.cancelled = true; };
		},
		pi: { command: "pi", args: [] },
		process: { platform: "linux", kill: (_pid, signal) => {
			if (signal === 0) throw Object.assign(new Error("group probe"), { code: groupGone ? "ESRCH" : "EPERM" });
		} },
	}, { askUser: async () => { asks += 1; return answer; }, onFinish: (task, snapshot) => { finishes.push(task.id); observations.push(snapshot); } });
	const first = runner.run(request({ collectResponseObservations: true }));
	const second = runner.run(request({ prompt: "queued" }));
	await tick();
	const waiter = runner.waitFor(first.id);
	child.emit({ type: "message_end", message: { role: "assistant", stopReason: "aborted", usage: { input: 3 } } });
	if (lateEvents) child.emit({ type: "extension_ui_request", id: "early", method: "input", title: "Pending?" });
	runner.cancel(first.id);
	const grace = timers.find((timer) => timer.ms === 250);
	assert.ok(grace);
	grace.fn();
	now = 2_000;
	const check = timers.filter((timer) => timer.ms === 25).at(-1);
	assert.ok(check);
	check.fn();
	await tick();
	assert.equal(store.get(first.id)?.status, TASK_STATUS.FAILED);
	assert.equal((await waiter).status, TASK_STATUS.FAILED);
	assert.match(store.get(first.id)?.error ?? "", /cleanup unconfirmed/);
	assert.equal(observations.length, 1);
	assert.equal(observations[0]?.agentSettled, false);
	assert.equal(observations[0]?.responses.length, 1);
	assert.equal(store.get(second.id)?.status, TASK_STATUS.QUEUED, "the unconfirmed group retains its capacity");
	assert.equal(timers.filter((timer) => timer.ms === 25 && !timer.cancelled).length, 0, "confirmation polling stops at its deadline");
	const finished = structuredClone(store.get(first.id));
	if (lateEvents) {
		const thread = structuredClone(store.thread(first.id));
		const timerCount = timers.length;
		const writes = child.written.length;
		resolveAnswer({ value: "too late" });
		await tick();
		child.emit({ type: "extension_ui_request", id: "late", method: "input", title: "Reopen?" });
		child.emit({ type: "agent_end", messages: [{ role: "assistant", content: [{ type: "text", text: "late result" }] }] });
		child.emit({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "late" } });
		child.emit({ type: "agent_settled" });
		await tick();
		assert.equal(asks, 1, "late dialogs must not reopen");
		assert.equal(child.written.length, writes, "pending answers must not reach a terminal child");
		assert.equal(timers.length, timerCount, "late activity must not rearm the stall watchdog");
		assert.deepEqual(store.get(first.id), finished);
		assert.deepEqual(store.thread(first.id), thread);
		assert.equal(launches, 1, "late events are not process-exit proof");
	}
	groupGone = true;
	child.exit(0);
	await tick();
	assert.equal(launches, 2, "proven late exit must pump queued work");
	assert.equal(store.get(second.id)?.status, TASK_STATUS.RUNNING);
	child.exit(0);
	await tick();
	assert.deepEqual(finishes, [first.id], "cleanup must not finish the quarantined task twice");
	assert.equal(observations.length, 1, "late cleanup does not redeliver observations");
	assert.deepEqual(store.get(first.id), finished);
});

test("a confirmed-gone group completes the exit and frees its slot without an observed exit", async () => {
	// The group probe reports ESRCH (the group is gone) while the child never emits
	// its exit event. Returning without finishing left the task terminal in memory
	// with no record and no retry; finishing without releasing the live entry would
	// keep the concurrency slot occupied and never pump queued work.
	const store = new TaskStore();
	const timers: Array<{ fn: () => void; ms: number; cancelled: boolean }> = [];
	const finishes: string[] = [];
	let now = 1_000;
	let launches = 0;
	const runner = new AgentRunner(store, { maxConcurrency: 1, stallTimeoutMs: 10_000 }, {
		spawn: () => fakeChild({ exitOnKill: false, pid: 90 + (launches += 1) }).child,
		now: () => now,
		schedule: (fn, ms) => {
			const timer = { fn, ms, cancelled: false };
			timers.push(timer);
			return () => { timer.cancelled = true; };
		},
		pi: { command: "pi", args: [] },
		process: { platform: "linux", kill: (_pid, signal) => {
			if (signal === 0) throw Object.assign(new Error("group probe"), { code: "ESRCH" });
		} },
	}, { askUser: async () => ({ value: "yes" }), onFinish: (task) => { finishes.push(task.id); } });
	const first = runner.run(request());
	const second = runner.run(request({ prompt: "queued" }));
	await tick();
	const waiter = runner.waitFor(first.id);
	runner.cancel(first.id);
	const grace = timers.find((timer) => timer.ms === 250);
	assert.ok(grace, "termination grace is scheduled");
	grace.fn();
	await tick();
	assert.equal(store.get(first.id)?.status, TASK_STATUS.CANCELLED);
	assert.equal((await waiter).status, TASK_STATUS.CANCELLED, "the waiter receives the recorded outcome");
	assert.equal(finishes.length, 1, "the run is recorded exactly once");
	assert.equal(store.get(second.id)?.status, TASK_STATUS.RUNNING, "the freed slot starts queued work");
});

test("an unprobeable process group quarantines at its deadline and still records the run", async () => {
	// On win32 the child is not detached, so there is no process group to probe and
	// an observed exit is the only confirmation available. With no exit event the
	// run must still be recorded at the deadline, and its slot must be retained
	// rather than freed on an unproven assumption.
	const store = new TaskStore();
	const timers: Array<{ fn: () => void; ms: number; cancelled: boolean }> = [];
	const finishes: string[] = [];
	let now = 1_000;
	let launches = 0;
	const runner = new AgentRunner(store, { maxConcurrency: 1, stallTimeoutMs: 10_000 }, {
		spawn: () => fakeChild({ exitOnKill: false, pid: 90 + (launches += 1) }).child,		now: () => now,
		schedule: (fn, ms) => {
			const timer = { fn, ms, cancelled: false };
			timers.push(timer);
			return () => { timer.cancelled = true; };
		},
		pi: { command: "pi", args: [] },
		process: { platform: "win32", kill: () => {} },
	}, { askUser: async () => ({ value: "yes" }), onFinish: (task) => { finishes.push(task.id); } });
	const first = runner.run(request());
	const second = runner.run(request({ prompt: "queued" }));
	await tick();
	runner.cancel(first.id);
	const grace = timers.find((timer) => timer.ms === 250);
	assert.ok(grace, "termination grace is scheduled");
	grace.fn();
	now = 5_000;
	const check = timers.filter((timer) => timer.ms === 25).at(-1);
	assert.ok(check, "an unprobeable group must keep polling instead of stopping silently");
	check.fn();
	await tick();
	assert.equal(store.get(first.id)?.status, TASK_STATUS.FAILED);
	assert.match(store.get(first.id)?.error ?? "", /capacity quarantined/);
	assert.equal(finishes.length, 1, "the run is recorded exactly once");
	assert.equal(store.get(second.id)?.status, TASK_STATUS.QUEUED, "an unconfirmed exit retains its capacity");
	assert.equal(launches, 1, "no further launch happens while the slot is quarantined");
});

test("abortReasonText renders an Error, a string, and nothing for unknown reasons", () => {
	assert.equal(abortReasonText(undefined), "");
	assert.equal(abortReasonText(new Error("interrupted by user")), " (interrupted by user)");
	assert.equal(abortReasonText("host timeout"), " (host timeout)");
	assert.equal(abortReasonText(new Error("")), "");
	assert.equal(abortReasonText(42), "");
});

test("research narrowing transport keeps exact argv paths and replaces inherited selection", async () => {
 const h = harness();
 const selection = { documentation: { tools: ["fetch_content"], extensions: { fetch_content: "/installed/docs tools.ts" } } };
 for (const researchSelection of [selection, undefined]) {
  const artifact = { store: "none" as const, worktree: "/work", changeName: "demo", retainedIntent: "denied questions", locators: [] };
  const expected = structuredClone(artifact);
  const launch = request({ researchSelection, researchArtifact: artifact, extensionPaths: researchSelection ? ["/installed/docs tools.ts"] : [],
   env: { PATH: "/bin", JERO_PI_RESEARCH_SELECTION: "stale broad selection", JERO_PI_RESEARCH_ARTIFACT: "stale broader scope" } });
  const argv = childArguments(launch);
  assert.deepEqual(argv.filter((_, i) => argv[i - 1] === "--extension"), launch.extensionPaths);
  const task = h.runner.run(launch);
  artifact.worktree = "/wrong";
  await tick();
  assert.deepEqual(JSON.parse(h.spawnOptions.at(-1)!.env.JERO_PI_RESEARCH_ARTIFACT!), expected);
  assert.deepEqual("researchArtifact" in task ? task.researchArtifact : undefined, expected);
  assert.deepEqual(JSON.parse(h.spawnOptions.at(-1)!.env.JERO_PI_RESEARCH_SELECTION!), researchSelection ?? null);
  assert.equal(h.spawnOptions.at(-1)!.env.PATH, "/bin");
  h.runner.cancel(task.id);
  assert.equal((await h.runner.waitFor(task.id)).status, TASK_STATUS.CANCELLED);
 }
});


test("runner retains remediation observations and awaits terminal settlement", async () => {
	const h = harness({ pid: 123 });
	let finalized: { record: TaskRecord; facts: RemediationTerminalFacts } | undefined;
	let release: () => void;
	const gate = new Promise<void>(resolve => { release = resolve; });
	const remediationPlan: RemediationPlan = { cwd: "/repo", commands: ["pnpm test"], runtimeHarness: { naReason: "Not applicable because the fixture has no runtime boundary." }, rollback: { boundary: "Revert fixture", command: "git diff --check" } };
	const remediation: RemediationTaskState = { failedEvidenceRevision: `sha256:${"a".repeat(64)}`, plan: remediationPlan, pending: {}, observations: [], invalid: false, token: "opaque", acquire: { workspaceRoot: "/repo", changeName: "demo", requestId: "fixture", workUnit: "correct", evidenceGoal: "Observed correction" } };
	const task = h.runner.run(request({ sddRemediation: remediation, finalizeRemediation: async (record, facts) => { finalized = { record, facts }; await gate; } }));
	await tick();
	for (const command of ["pnpm test", "git diff --check"]) {
		h.children[0].emit({ type: "tool_execution_start", toolName: "bash", toolCallId: command, args: { command } });
		h.children[0].emit({ type: "tool_execution_end", toolName: "bash", toolCallId: command, isError: false, result: { content: [{ type: "text", text: "command output" }], details: { remediationCommand: { command, toolCallId: command, cwd: "/repo", exitCode: 0 } } } });
	}
	h.children[0].emit({ type: "agent_end", messages: [{ role: "assistant", content: [{ type: "text", text: "done" }], stopReason: "stop" }] });
	h.children[0].emit({ type: "agent_settled" });
	await tick();
	assert.ok(finalized);
	assert.equal(finalized.record.sddRemediation?.observations.length, 2);
	const prompt = h.children[0].written.find(value => value.type === "prompt").message;
	assert.ok(typeof prompt === "string");
	assert.match(prompt, /pnpm test/);
	assert.doesNotMatch(prompt, /opaque/);
	assert.equal(finalized.facts.cleanupConfirmed, true);
	assert.equal(h.finishes.length, 0);
	release(); await h.runner.waitFor(task.id);
	assert.equal(h.finishes.length, 1);
	assert.equal(remediation.observations.length, 0);
});


test("admitted no-PID failure settles interrupted before sending a prompt", async () => {
	const h = harness(); let facts;
	const task = h.runner.run(request({ sddRemediation: { plan: {} } as unknown as RemediationTaskState, finalizeRemediation: async (_task, observed) => { facts = observed; } }));
	await tick();
	assert.equal(h.children[0].written.some(value => value.type === "prompt"), false);
	await h.runner.waitFor(task.id);
	assert.equal(facts.spawned, false);
	assert.equal(facts.exited, false);
	assert.equal(facts.cleanupConfirmed, false);
});


test("admitted synchronous spawn failure finalizes without launching another actor", async () => {
	let spawns = 0, facts;
	const store = new TaskStore();
	const runner = new AgentRunner(store, { maxConcurrency: 1, stallTimeoutMs: 100 }, { spawn: () => { spawns++; throw new Error("spawn refused"); }, pi: { command: "pi", args: [] }, now: () => 1, schedule: () => () => {} }, { askUser: async () => ({}) });
	const task = runner.run(request({ sddRemediation: { plan: {} } as unknown as RemediationTaskState, finalizeRemediation: async (_task, value) => { facts = value; } }));
	await runner.waitFor(task.id);
	assert.deepEqual(facts, { spawned: false, exited: false, cleanupConfirmed: true });
	assert.equal(spawns, 1);
});

