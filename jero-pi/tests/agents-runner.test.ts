// agents-runner 测试第 1 段（留守原文件名）（共 2 段；夹具在 agents-runner-shared.ts）。
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

test("stall before any child response records the last completed stage as starting, with the stderr tail", async () => {
	const h = silentHarness(FOUR_MIN_MS);
	const task = h.runner.run(request());
	await tick();
	(h.child().child.stderr as unknown as PassThrough).write("Error:   cannot bind\nprovider socket\n");
	await tick();
	const stall = h.timers.filter((timer) => timer.ms === FOUR_MIN_MS && !timer.cancelled).at(-1);
	assert.ok(stall);
	stall!.fn();
	await tick();
	assert.equal(h.store.get(task.id)?.status, TASK_STATUS.TIMED_OUT);
	assert.equal(h.store.get(task.id)?.error, "stalled for 4 min after: starting; stderr: Error: cannot bind provider socket");
});

test("stall after get_state and prompt responses records the prompt accepted stage", async () => {
	const h = harness({ stallTimeoutMs: FOUR_MIN_MS });
	const task = h.runner.run(request());
	await tick();
	assert.deepEqual(h.children[0].written.map((command) => command.type), ["get_state", "prompt"]);
	assert.equal(h.store.get(task.id)?.lastStep, "prompt accepted");
	const stall = h.timers.filter((timer) => timer.ms === FOUR_MIN_MS && !timer.cancelled).at(-1);
	assert.ok(stall);
	stall!.fn();
	await tick();
	assert.equal(h.store.get(task.id)?.error, "stalled for 4 min after: prompt accepted");
});

test("stderr tail bounds the child's raw output to 512 characters before stripping ANSI escapes", async () => {
	const h = silentHarness(FOUR_MIN_MS);
	const task = h.runner.run(request());
	await tick();
	const filler = "x".repeat(508);
	(h.child().child.stderr as unknown as PassThrough).write(`${filler}[31mOK[0m`);
	await tick();
	const stall = h.timers.filter((timer) => timer.ms === FOUR_MIN_MS && !timer.cancelled).at(-1)!;
	stall.fn();
	await tick();
	const expectedTail = `${"x".repeat(501)}OK`;
	assert.equal(h.store.get(task.id)?.error, `stalled for 4 min after: starting; stderr: ${expectedTail}`);
});

test("child exit before agent_settled includes the stderr tail; a completed task never carries stderr", async () => {
	const h = harness({ maxConcurrency: 2 });
	const crashing = h.runner.run(request());
	const completing = h.runner.run(request({ prompt: "finish clean" }));
	await tick();
	const crashChild = h.children[0];
	const doneChild = h.children[1];
	(crashChild.child.stderr as unknown as PassThrough).write("panic: provider unavailable");
	await tick();
	crashChild.exit(1);
	await tick();
	assert.equal(h.store.get(crashing.id)?.status, TASK_STATUS.FAILED);
	assert.equal(h.store.get(crashing.id)?.error, "pi exited with code 1 before agent_settled; stderr: panic: provider unavailable");

	(doneChild.child.stderr as unknown as PassThrough).write("noisy but irrelevant");
	await tick();
	doneChild.emit({ type: "agent_end", messages: [{ role: "assistant", content: [{ type: "text", text: "final report" }], stopReason: "stop" }] });
	doneChild.emit({ type: "agent_settled" });
	await h.runner.waitFor(completing.id);
	assert.equal(h.store.get(completing.id)?.status, TASK_STATUS.COMPLETED);
	assert.equal(h.store.get(completing.id)?.error, null);
});

test("cancel(id, reason) records the given reason for a live and a queued task; cancelAll(reason) threads it", async () => {
	const h = harness({ maxConcurrency: 1 });
	const running = h.runner.run(request());
	const queued = h.runner.run(request({ prompt: "queued work" }));
	await tick();
	assert.equal(h.store.get(queued.id)?.status, TASK_STATUS.QUEUED);
	assert.equal(h.runner.cancel(queued.id, "stopped from the agents panel"), true);
	assert.equal(h.store.get(queued.id)?.status, TASK_STATUS.CANCELLED);
	assert.equal(h.store.get(queued.id)?.error, "stopped from the agents panel before start");
	assert.equal(h.runner.cancel(running.id, "stopped from the agents panel"), true);
	await tick();
	assert.equal(h.store.get(running.id)?.status, TASK_STATUS.CANCELLED);
	assert.equal(h.store.get(running.id)?.error, "stopped from the agents panel");

	const h2 = harness({ maxConcurrency: 1 });
	const runningTwo = h2.runner.run(request());
	const queuedTwo = h2.runner.run(request({ prompt: "queued work" }));
	await tick();
	assert.equal(h2.runner.cancelAll("cancelled: parent session shut down"), 2);
	await tick();
	assert.equal(h2.store.get(runningTwo.id)?.error, "cancelled: parent session shut down");
	assert.equal(h2.store.get(queuedTwo.id)?.error, "cancelled: parent session shut down before start");
});

test("earlier get_state and prompt responses cannot regress lastStep past a later child event", async () => {
	const store = new TaskStore();
	const timers: Array<{ fn: () => void; ms: number; cancelled: boolean }> = [];
	let clock = 1000;
	const fake = fakeChild();
	fake.child.stdin.removeAllListeners("data"); // respond to get_state/prompt manually, out of order
	const written: Array<Record<string, unknown>> = [];
	fake.child.stdin.on("data", (chunk: Buffer) => written.push(JSON.parse(chunk.toString())));
	const runner = new AgentRunner(store, { maxConcurrency: 1, stallTimeoutMs: FOUR_MIN_MS }, {
		spawn: () => fake.child,
		now: () => (clock += 1),
		schedule: (fn, ms) => {
			const timer = { fn, ms, cancelled: false };
			timers.push(timer);
			return () => {
				timer.cancelled = true;
			};
		},
		pi: { command: "pi", args: [] },
	}, { askUser: async () => ({ cancelled: true }) });
	const task = runner.run(request());
	await tick();
	assert.deepEqual(written.map((command) => command.type), ["get_state", "prompt"]);
	// A later child event (a tool call) advances lastStep before either launch reply arrives.
	fake.emit({ type: "tool_execution_start", toolCallId: "c1", toolName: "bash", args: {} });
	await tick();
	assert.equal(store.get(task.id)?.lastStep, "bash");
	// The get_state and prompt responses arrive late; they must not regress the stage.
	fake.emit({ type: "response", id: written[0]?.id, command: "get_state", success: true, data: { sessionFile: "/sessions/child.jsonl" } });
	fake.emit({ type: "response", id: written[1]?.id, command: "prompt", success: true });
	await tick();
	assert.equal(store.get(task.id)?.lastStep, "bash", "a late get_state/prompt reply must not regress lastStep");
});

test("synchronous cancellation before dequeue never invokes the policy callback", async () => {
	const h = harness(); let checks = 0;
	const task = h.runner.run(request({ prepareResponseObservations: async () => { checks++; return true; } }));
	h.runner.cancel(task.id);
	await tick();
	assert.equal(checks, 0);
	assert.equal(h.children.length, 0);
});

test("hanging preparation never blocks spawn or queued core work; late grants are dropped", async () => {
	const h = harness({ maxConcurrency: 1 });
	let grant!: (value: boolean) => void;
	let checks = 0;
	const first = h.runner.run(request({ prepareResponseObservations: () => { checks++; return new Promise(resolve => { grant = resolve; }); } }));
	const second = h.runner.run(request());
	await tick();
	assert.equal(checks, 1);
	assert.equal(h.children.length, 1);
	assert.equal(h.store.get(second.id)?.status, TASK_STATUS.QUEUED);
	assert.equal(h.runner.cancel(first.id), true);
	await tick();
	assert.equal(h.children.length, 2);
	grant(true);
	await tick();
	assert.equal(h.children.length, 2);
	assert.equal((await h.runner.waitFor(first.id)).status, TASK_STATUS.CANCELLED);
	h.runner.cancel(second.id);
});

for (const outcome of ["ready", "late", "reject", "throw"] as const) {
	test(`parallel preparation ${outcome} cannot delay execution or revive dropped observations`, async () => {
		const snapshots: Parameters<NonNullable<RunnerHooks["onFinish"]>>[1][] = [];
		const h = harness({ onFinish: (_task, snapshot) => snapshots.push(snapshot) });
		let grant!: (value: boolean) => void;
		const task = h.runner.run(request({ prepareResponseObservations: () => {
			if (outcome === "throw") throw new Error("preparation failed");
			if (outcome === "reject") return Promise.reject(new Error("preparation failed"));
			return new Promise(resolve => { grant = resolve; });
		} }));
		await tick();
		assert.equal(h.children.length, 1);
		if (outcome === "ready") { grant(true); await tick(); }
		const message = { type: "message_end", message: { role: "assistant", provider: "openai", model: "gpt-4o", stopReason: "stop", content: [{ type: "text", text: "done" }] } };
		h.children[0].emit(message);
		if (outcome === "late") { grant(true); await tick(); }
		h.children[0].emit(message);
		h.children[0].emit({ type: "agent_end" });
		h.children[0].emit({ type: "agent_settled" });
		await h.runner.waitFor(task.id);
		assert.equal(snapshots.length, 1);
		assert.equal(snapshots[0]?.responses.length, outcome === "ready" ? 2 : undefined);
	});
}

for (const checkpoint of ["launch", "stream", "finish", "throw"] as const) {
	test(`child observation guard discards permanently at ${checkpoint} without changing task execution`, async () => {
		let allowed = checkpoint !== "launch";
		let calls = 0;
		const snapshots: Parameters<NonNullable<RunnerHooks["onFinish"]>>[1][] = [];
		const h = harness({ onFinish: (_task, snapshot) => snapshots.push(snapshot) });
		const task = h.runner.run(request({ collectResponseObservations: true,
			canCollectResponseObservations: () => {
				calls++;
				if (checkpoint === "throw") throw new Error("private policy failure");
				return allowed;
			} }));
		await tick();
		const child = h.children[0];
		const response = { type: "message_end", message: { role: "assistant", stopReason: "stop", usage: { input: 3 } } };
		child.emit(response);
		if (checkpoint === "stream") {
			allowed = false;
			child.emit({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "progress" } });
			allowed = true;
			child.emit(response);
		}
		if (checkpoint === "finish") allowed = false;
		h.runner.cancel(task.id);
		await tick();
		assert.equal((await h.runner.waitFor(task.id)).status, TASK_STATUS.CANCELLED);
		assert.deepEqual(snapshots, [undefined]);
		assert.ok(calls > 0);
	});
}

test("child observation guard is never consulted when collection is default-off", async () => {
	let calls = 0;
	const h = harness();
	const task = h.runner.run(request({ canCollectResponseObservations: () => { calls++; return true; } }));
	await tick();
	h.children[0].emit({ type: "message_end", message: { role: "assistant", stopReason: "stop" } });
	h.runner.cancel(task.id);
	await tick();
	assert.equal(calls, 0);
});

test("child session diff evidence travels only with a paired successful tool outcome", async () => {
 const observed: any[] = [];
 const h = harness({ onSuccessfulMutation: (_task, tool) => { observed.push(tool); } });
 const task = h.runner.run(request()); await tick();
 const child = h.children[0];
 const evidence = {id:"w",root:"/repo",path:"src/file.ts",before:{kind:"absent"},after:{kind:"text",text:"agent\n"}};
 child.emit({type:"tool_execution_start",toolCallId:"w",toolName:"write",args:{path:"src/file.ts"}});
 child.emit({type:"tool_execution_end",toolCallId:"w",isError:false,result:{content:[],details:{jeroSessionChange:evidence}}});
 assert.deepEqual(observed[0].evidence,evidence);
 child.emit({type:"tool_execution_end",toolCallId:"w",isError:false,result:{content:[],details:{jeroSessionChange:evidence}}});
 assert.equal(observed.length,1);
 h.runner.cancel(task.id); await tick();
});

for (const ending of ["cancel", "failure", "hook-error", "hook-async-error"] as const) {
	test(`successful child mutations require paired RPC events and survive ${ending}`, async () => {
		const mutations: unknown[] = [];
		const h = harness({ onSuccessfulMutation: (task, tool) => {
			mutations.push({ taskId: task.id, parent: task.parentSessionId, ...tool });
			if (ending === "hook-error") throw new Error("receipt append unavailable");
			if (ending === "hook-async-error") return Promise.reject(new Error("async receipt append unavailable"));
		} });
		const task = h.runner.run(request());
		await tick();
		const child = h.children[0];
		const start = (id: string, toolName: string) => child.emit({ type: "tool_execution_start", toolCallId: id, toolName, args: { path: "src/file.ts" } });
		const end = (id: string, isError: unknown = false) => child.emit({ type: "tool_execution_end", toolCallId: id, isError, result: { content: [] } });
		assert.deepEqual(mutations, [], "spawn is not mutation evidence");
		end("missing");
		for (const name of ["read", "bash", "subagent_run"]) { start(name, name); end(name); }
		start("failed", "write"); end("failed", true);
		start("unknown", "edit"); end("unknown", null);
		child.emit({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "I edited files" } });
		assert.deepEqual(mutations, []);
		for (const name of ["write", "edit"]) { start(name, name); end(name); end(name); }
		assert.deepEqual(mutations, ["write", "edit"].map((toolName) => ({ taskId: task.id, parent: "s1", toolName, toolCallId: toolName, path: "src/file.ts" })));
		start("unfinished", "write");
		if (ending === "failure") child.fail("later failure");
		else h.runner.cancel(task.id);
		await tick();
		end("unfinished"); start("late", "write"); end("late");
		assert.equal(mutations.length, 2, "terminal cleanup rejects late events without retracting successful writes");
	});
}

test("launch registration waits for actual spawn, including queued launches, and ignores failed spawns", async () => {
	const launches: string[] = [];
	const spawns: Array<() => void> = [];
	const children: FakeChild[] = [];
	const cwds: string[] = [];
	const store = new TaskStore();
	const runner = new AgentRunner(store, { maxConcurrency: 1, stallTimeoutMs: 1000 }, {
		spawn: (_command, _args, options) => {
			cwds.push(options.cwd);
			if (options.cwd === "/throws") throw new Error("missing executable");
			const fake = fakeChild();
			const on = fake.child.on.bind(fake.child);
			fake.child.on = ((event: string, listener: () => void) => {
				if (event === "spawn") spawns.push(listener);
				else on(event as "exit", listener);
				return fake.child;
			}) as typeof fake.child.on;
			children.push(fake);
			return fake.child;
		},
		now: () => 1000, schedule: () => () => {}, pi: { command: "pi", args: [] },
	}, { askUser: async () => ({ cancelled: true }) });
	const first = runner.run(request({ cwd: "/child", onLaunch: () => launches.push("s1:/child") }));
	const second = runner.run(request({ cwd: "/queued", onLaunch: () => launches.push("s1:/queued") }));
	assert.deepEqual(launches, []);
	await tick();
	assert.deepEqual(launches, [], "returning a child handle is not successful spawn");
	assert.equal(typeof spawns[0], "function");
	spawns[0]();
	assert.deepEqual(launches, ["s1:/child"]);
	runner.cancel(first.id);
	await tick();
	assert.equal(store.get(second.id)?.cwd, "/queued");
	spawns[1]();
	assert.deepEqual(launches, ["s1:/child", "s1:/queued"]);
	runner.cancel(second.id);
	await tick();
	const failed = runner.run(request({ cwd: "/missing", onLaunch: () => launches.push("bad") }));
	await tick();
	children[2].fail("ENOENT");
	await tick();
	assert.equal(store.get(failed.id)?.status, TASK_STATUS.FAILED);
	const thrown = runner.run(request({ cwd: "/throws", onLaunch: () => launches.push("bad") }));
	await tick();
	assert.equal(store.get(thrown.id)?.status, TASK_STATUS.FAILED);
	assert.deepEqual(launches, ["s1:/child", "s1:/queued"]);
	assert.deepEqual(cwds, ["/child", "/queued", "/missing", "/throws"]);
});

test("runner captures resolved model and effort, retaining omitted launch values", async () => {
	for (const scenario of [
		{ state: { model: { provider: "anthropic", id: "resolved-model" }, thinkingLevel: "off" }, model: "anthropic/resolved-model", thinking: "off" },
		{ state: { thinkingLevel: "max" }, model: "openai-codex/gpt-5.6-terra", thinking: "max" },
		{ state: {}, model: "openai-codex/gpt-5.6-terra", thinking: "high" },
		{ state: { model: null }, model: "default", thinking: "high" },
		{ state: { model: { id: 7 }, thinkingLevel: 7 }, model: "openai-codex/gpt-5.6-terra", thinking: "high" },
	]) {
		const h = harness({ state: scenario.state });
		const task = h.runner.run(request());
		await tick();
		assert.equal(h.store.get(task.id)?.model, scenario.model);
		assert.equal(h.store.get(task.id)?.thinking, scenario.thinking);
		h.runner.cancel(task.id);
	}
	const h = harness({ state: { model: { provider: "wrong", id: "wrong" }, thinkingLevel: "low" }, stateSuccess: false });
	const task = h.runner.run(request({ model: undefined, thinking: undefined }));
	await tick();
	assert.equal(h.store.get(task.id)?.model, "default");
	assert.equal(h.store.get(task.id)?.thinking, undefined);
	h.runner.cancel(task.id);
});

test("runner delivers each response combination once at finish, never attributing launch selection", async () => {
	const snapshots: NonNullable<Parameters<NonNullable<RunnerHooks["onFinish"]>>[1]>[] = [];
	const h = harness({ exitOnKill: false, state: { model: { provider: "anthropic", id: "launch" }, thinkingLevel: "max" },
		onFinish: (_task, snapshot) => { assert.ok(snapshot); snapshots.push(snapshot); } });
	const task = h.runner.run(request({ collectResponseObservations: true }));
	await tick();
	const child = h.children[0];
	const responses = [
		{ provider: "openai", model: "gpt-4o", providerThinkingLevel: "low", stopReason: "error" },
		{ provider: "anthropic", model: "claude-sonnet-4", providerThinkingLevel: "high", stopReason: "toolUse" },
		{ provider: "openai", model: "gpt-4o", providerThinkingLevel: "high", stopReason: "stop" },
	];
	for (const response of responses) {
		const message = { role: "assistant", ...response, usage: { input: 10, totalTokens: 10, cost: { total: 0.1 } }, content: [{ type: "text", text: "private report" }] };
		child.emit({ type: "message_start", message });
		child.emit({ type: "message_end", message });
		child.emit({ type: "turn_end", message });
		child.emit({ type: "agent_end", messages: [message] });
	}
	assert.deepEqual(snapshots, [], "agent_end is not settlement");
	child.emit({ type: "agent_settled" });
	assert.deepEqual(snapshots, [], "settlement still waits for process cleanup");
	child.exit(0);
	await tick();
	assert.equal(snapshots.length, 1);
	const snapshot = snapshots[0];
	assert.equal(snapshot.agentSettled, true);
	assert.equal(snapshot.droppedResponses, 0);
	assert.equal(snapshot.coverage, "final_assistant_messages_only");
	assert.deepEqual(snapshot.responses.map((response) => [response.provider, response.model, response.providerThinkingLevel]),
		responses.map((response) => [response.provider, response.model, response.providerThinkingLevel].map((value) => ({ state: "observed", value }))));
	assert.ok(snapshot.responses.every((response) => Object.values(response.selected).every((field) => field.state === "unavailable")));
	assert.equal(h.store.get(task.id)?.tokens, 30);
	assert.equal(h.store.get(task.id)?.cost, 0.1 + 0.1 + 0.1);
	assert.equal(h.store.get(task.id)?.model, "anthropic/launch");
	assert.deepEqual(child.written.map((command) => command.type), ["get_state", "prompt"]);
	assert.doesNotMatch(JSON.stringify(snapshot), /private|launch|s1|modelVersion/);
	assert.ok(Object.isFrozen(snapshot) && Object.isFrozen(snapshot.responses) && Object.isFrozen(snapshot.responses[0].tokens.input));
	child.emit({ type: "agent_settled" }); child.exit(0);
	assert.equal(snapshots.length, 1);
});

for (const ending of ["cancel", "exit", "error", "timeout", "settled-error"] as const) test(`bounded response coverage survives ${ending} honestly`, async () => {
	let snapshot: Parameters<NonNullable<RunnerHooks["onFinish"]>>[1];
	const h = harness({ onFinish: (_task, observations) => { snapshot = observations; } });
	const task = h.runner.run(request({ collectResponseObservations: true }));
	await tick();
	const child = h.children[0];
	for (let index = 0; index < 130; index++) child.emit({ type: "message_end", message: {
		role: "assistant", model: `model-${index}`, stopReason: "error", usage: { totalTokens: 1 } } });
	if (ending === "cancel") h.runner.cancel(task.id);
	else if (ending === "exit") child.exit(1);
	else if (ending === "error") child.fail("private process error");
	else if (ending === "timeout") h.timers.filter((timer) => !timer.cancelled && timer.ms === 10_000).at(-1)!.fn();
	else { child.emit({ type: "agent_end", messages: [{ role: "assistant", stopReason: "error" }] }); child.emit({ type: "agent_settled" }); }
	await h.runner.waitFor(task.id);
	assert.ok(snapshot);
	assert.equal(snapshot.responses.length, 128);
	assert.equal(snapshot.droppedResponses, 2);
	assert.equal(snapshot.agentSettled, ending === "settled-error");
	assert.equal(h.store.get(task.id)?.tokens, 130, "buffer cap never caps existing UI totals");
	assert.notEqual(h.store.get(task.id)?.status, TASK_STATUS.COMPLETED);
	child.emit({ type: "message_end", message: { role: "assistant", stopReason: "stop" } });
	assert.equal(snapshot.responses.length, 128);
	assert.equal(h.finishes.length, 1);
});

test("response buffering is disabled by default and absent for tasks cancelled before launch", async () => {
	const snapshots: unknown[] = [];
	const h = harness({ maxConcurrency: 1, onFinish: (_task, snapshot) => snapshots.push(snapshot) });
	const task = h.runner.run(request());
	const queued = h.runner.run(request({ collectResponseObservations: true }));
	await tick();
	h.children[0].emit({ type: "message_end", message: { role: "assistant", stopReason: "stop", usage: { totalTokens: 7 } } });
	h.runner.cancel(queued.id); h.runner.cancel(task.id);
	await tick();
	assert.deepEqual(snapshots, [undefined, undefined]);
	assert.equal(h.store.get(task.id)?.tokens, 7);
});

test("childArguments builds an rpc launch with model, thinking, tools, session dir, and instructions", () => {
	const args = childArguments(request());
	assert.deepEqual(args.slice(0, 2), ["--mode", "rpc"]);
	assert.ok(args.includes("--session-dir") && args[args.indexOf("--session-dir") + 1] === "/sessions");
	assert.equal(args[args.indexOf("--model") + 1], "openai-codex/gpt-5.6-terra:high");
	assert.equal(args[args.indexOf("--tools") + 1], "read,grep,subagent_parent_message");
	assert.equal(args[args.indexOf("--append-system-prompt") + 1], "You map things.");
	assert.ok(!args.includes("--session"));
	const resumed = childArguments(request({ resumeSessionPath: "/sessions/old.jsonl", model: undefined, thinking: undefined, agent: { ...explorer, tools: [] } }));
	assert.equal(resumed[resumed.indexOf("--session") + 1], "/sessions/old.jsonl");
	assert.ok(!resumed.includes("--model") && !resumed.includes("--tools"));
});

test("childArguments preserves a max profile instead of the definition's medium effort", () => {
	const agent: AgentDefinition = { ...explorer, name: "worker", thinking: "medium" };
	const config = parseAgentsConfig({ model_profiles: { worker: { model: "openai-codex/gpt-5.6-luna", effort: "max" } } }, undefined);
	const profile = resolveAgentProfile(agent, config);
	const args = childArguments(request({ agent, model: profile.model, thinking: profile.thinking }));
	assert.equal(args[args.indexOf("--model") + 1], "openai-codex/gpt-5.6-luna:max");
});

test("childArguments preserves a max default without a selected model", () => {
	const profile = resolveAgentProfile(explorer, parseAgentsConfig({ default_effort: "max" }, undefined));
	const args = childArguments(request({ model: profile.model, thinking: profile.thinking }));
	assert.ok(!args.includes("--model"));
	assert.equal(args[args.indexOf("--thinking") + 1], "max");
});

test("childArguments grants every child the notification-only parent message tool", () => {
	const args = childArguments(request());
	assert.equal(args[args.indexOf("--tools") + 1], "read,grep,subagent_parent_message");
});

test("AgentRunner admits strict live notifications once and closes IPC before Stop", async () => {
	const notifications: string[] = [];
	const { runner, children, spawnOptions } = harness({ onNotification: (task, message) => task.parentSessionId === "s1" && (notifications.push(message), true) });
	const task = runner.run(request());
	await tick();
	children[0].message({ id: "n1", kind: "notification", message: "checkpoint" });
	children[0].message({ id: "n1", kind: "notification", message: "checkpoint" });
	children[0].message({ id: "n2", kind: "notification", message: "x".repeat(8 * 1024 + 1) });
	children[0].message({ id: "q3", kind: "query", message: "unsupported" });
	children[0].message({ id: "n4", kind: "notification", message: "\uD800" });
	children[0].message({ id: "n5", kind: "notification", message: "forged field", sender: "forged" });
	children[0].message({ id: "n0", kind: "notification", message: "invalid correlation" });
	children[0].message({ id: `n${"1".repeat(1_000)}`, kind: "notification", message: "invalid correlation" });
	await tick();
	assert.deepEqual(spawnOptions[0]?.stdio, ["pipe", "pipe", "pipe", "ipc"]);
	assert.deepEqual(notifications, ["checkpoint"]);
	assert.deepEqual(children[0].sent, [
		{ id: "n1", kind: "ack", accepted: true },
		{ id: "n2", kind: "ack", accepted: false, error: "invalid child IPC message" },
		{ id: "q3", kind: "reply", error: "task parent cannot accept queries" },
		{ id: "n4", kind: "ack", accepted: false, error: "invalid child IPC message" },
		{ id: "n5", kind: "ack", accepted: false, error: "invalid child IPC frame" },
	]);
	runner.cancel(task.id);
	children[0].message({ id: "after-stop", kind: "notification", message: "ignored" });
	await tick();
	assert.equal(children[0].sent.length, 5);
	assert.ok(children[0].disconnects > 0);
});

test("AgentRunner rejects notifications from an inactive parent session with a static acknowledgement", async () => {
	const { runner, children } = harness({ onNotification: () => false });
	runner.run(request());
	await tick();
	children[0].message({ id: "n1", kind: "notification", message: "not active" });
	await tick();
	assert.deepEqual(children[0].sent, [{ id: "n1", kind: "ack", accepted: false, error: "task parent is not the active host session" }]);
});

test("AgentRunner retains only a 64-notification duplicate window", async () => {
	const notifications: string[] = [];
	const { runner, children } = harness({ onNotification: (_task, message) => { notifications.push(message); } });
	runner.run(request());
	await tick();
	for (let index = 1; index <= 65; index += 1) children[0].message({ id: `n${index}`, kind: "notification", message: `message ${index}` });
	children[0].message({ id: "n1", kind: "notification", message: "message 1 again" });
	await tick();
	assert.equal(notifications.length, 66, "an ID evicted from the recent 64-ack window can be admitted again");
});

test("piCommand reuses the running pi entry point and honors the override", () => {
	assert.deepEqual(piCommand({ execPath: "/bin/node", argv: ["/bin/node", "/x/dist/cli.js"], env: {} }), { command: "/bin/node", args: ["/x/dist/cli.js"] });
	assert.deepEqual(piCommand({ execPath: "/bin/node", argv: ["/bin/node", "/x/other.js"], env: {} }), { command: "pi", args: [] });
	assert.deepEqual(piCommand({ execPath: "/bin/node", argv: [], env: { JERO_PI_AGENTS_PI: "/opt/pi --flag" } }), { command: "/opt/pi", args: ["--flag"] });
	assert.deepEqual(piCommand({ execPath: "/bin/node", argv: [], env: { JERO_PI_AGENTS_PI: '"C:\\Program Files\\pi\\pi.exe" --mode rpc --cwd "D:\\work dir"' } }), { command: "C:\\Program Files\\pi\\pi.exe", args: ["--mode", "rpc", "--cwd", "D:\\work dir"] });
});

test("JsonLines splits on LF only, tolerates CRLF, and skips lines that are not JSON", () => {
	const seen: unknown[] = [];
	const lines = new JsonLines((value) => seen.push(value));
	lines.push('{"a":1}\r\n{"b":"x y"}\nnot json\n{"c":');
	lines.push("3}\n");
	assert.deepEqual(seen, [{ a: 1 }, { b: "x y" }, { c: 3 }]);
});

test("win32 cancellation terminates the process tree; POSIX uses the process group", async () => {
	const runOnce = async (platform: NodeJS.Platform) => {
		const children: FakeChild[] = [];
		const treeKills: number[] = [];
		const groupKills: number[] = [];
		const store = new TaskStore();
		const runner = new AgentRunner(store, { maxConcurrency: 1, stallTimeoutMs: 10_000 }, {
			spawn: () => {
				const fake = fakeChild({ pid: 4242, exitOnKill: false });
				children.push(fake);
				return fake.child;
			},
			now: () => 1000,
			schedule: () => () => {},
			pi: { command: "pi", args: [] },
			process: {
				platform,
				kill: (pid) => { groupKills.push(pid); },
				killTree: (pid) => { treeKills.push(pid); return true; },
			},
		}, { askUser: async () => ({ value: "yes" }) });
		const task = runner.run(request());
		await tick();
		assert.equal(runner.cancel(task.id), true, "the task must be live before cancellation");
		return { children, treeKills, groupKills };
	};
	const windows = await runOnce("win32");
	assert.deepEqual(windows.treeKills, [4242], "cancellation must taskkill the tree rooted at the direct child pid");
	assert.deepEqual(windows.groupKills, [], "win32 never falls back to process-group signaling");
	const posix = await runOnce("linux");
	assert.deepEqual(posix.groupKills, [-4242], "POSIX cancels the detached process group");
	assert.deepEqual(posix.treeKills, [], "POSIX never uses the Windows tree kill");
});

