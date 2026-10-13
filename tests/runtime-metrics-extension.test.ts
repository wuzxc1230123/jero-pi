import assert from "node:assert/strict";
import test from "node:test";
import runtimeMetrics, { liveSessionMetrics } from "../extensions/runtime-metrics.ts";
import { parseAgentClass } from "../lib/runtime-metrics.ts";
import { CHILD_METRICS_EVENT, childEvent } from "../lib/runtime-metrics-children.ts";
import { normalizeRpcEvent, TASK_EVENT } from "../lib/agents-protocol.ts";

const tick = () => new Promise<void>(resolve => setImmediate(resolve));
function harness(env: NodeJS.ProcessEnv = {}, mode: "tui" | "print" = "tui", model: unknown = { provider: "openai", id: "gpt-4o" }) {
	const handlers = new Map<string, Function>();
	const listeners = new Map<string, Function>();
	let session = "first";
	const ctx: any = { cwd: "/fixture", mode, model,
		sessionManager: { getSessionId: () => session, getEntries: () => assert.fail("no reconstruction") } };
	const pi: any = { on: (name: string, handler: Function) => handlers.set(name, handler),
		getThinkingLevel: () => "high", registerCommand() {},
		appendEntry: () => assert.fail("no metrics persistence"),
		events: { on: (name: string, handler: Function) => { listeners.set(name, handler); return () => listeners.delete(name); } } };
	runtimeMetrics(pi, env, () => 0);
	return { ctx, handlers,
		emit: (name: string, event: any = {}) => handlers.get(name)?.(event, ctx),
		bus: (event: unknown) => listeners.get(CHILD_METRICS_EVENT)?.(event),
		replace: () => { session = "second"; } };
}
const final = (input = 7) => ({ role: "assistant", provider: "openai", model: "gpt-4o", responseModel: "gpt-4o",
	providerThinkingLevel: "low", stopReason: "stop", usage: { input, output: 3, cacheRead: 0 },
	content: [{ text: "private response" }], errorMessage: "private error", path: "/private" });

test("a generic open-weight selection is recorded by name; no catalog probe or gate", async () => {
	const h = harness({}, "tui", { provider: "nan", id: "deepseek-v4-flash" });
	await h.emit("session_start");
	h.emit("turn_start"); h.emit("before_provider_request");
	h.emit("message_end", { message: { role: "assistant", provider: "nan", model: "deepseek-v4-flash",
		providerThinkingLevel: "low", stopReason: "stop", usage: { input: 3, output: 2 } } });
	await tick();
	const live = liveSessionMetrics();
	assert.ok(live);
	assert.equal(live.snapshot.length, 1);
	assert.equal(live.snapshot[0].selectedProvider, "nan");
	assert.equal(live.snapshot[0].selectedModelId, "deepseek-v4-flash");
	h.emit("session_shutdown");
});

test("an ambiguous turn with no captured selection still records the observed model", async () => {
	const h = harness({}, "tui", { provider: "nan", id: "deepseek-v4-flash" });
	await h.emit("session_start");
	// No turn_start/before_provider_request: the turn is ambiguous, so no
	// selection was captured for this response.
	h.emit("message_end", { message: { role: "assistant", provider: "nan", model: "glm5.3",
		providerThinkingLevel: "low", stopReason: "stop", usage: { input: 3, output: 2 } } });
	await tick();
	const live = liveSessionMetrics();
	assert.ok(live);
	assert.equal(live.snapshot[0].selectedModelId, "unknown");
	assert.equal(live.snapshot[0].observedModelId, "glm5.3");
	h.emit("session_shutdown");
});

test("message consumption rules: synchronous record, duplicates and non-final messages drop", async () => {
	const h = harness(); await h.emit("session_start");
	h.emit("turn_start"); h.emit("before_provider_request");
	const message = final();
	assert.equal(h.emit("message_end", { message }), undefined);
	h.emit("message_end", { message });
	await tick();
	let live = liveSessionMetrics();
	assert.ok(live);
	assert.equal(live.snapshot.length, 1);
	assert.equal(live.snapshot[0].responses, 1);
	assert.equal(live.snapshot[0].tokens.input.sum, 7);
	assert.equal(live.snapshot[0].effort, "high");
	assert.equal(live.snapshot[0].providerThinkingLevel, "low");
	assert.ok(!JSON.stringify(live.snapshot).includes("private"), "private response fields never enter rows");
	// A post-invalidate response loses its captured selection, so it lands in
	// its own dimension bucket — event usage, never a cumulative total.
	h.emit("message_end", { message: final(2) }); await tick();
	live = liveSessionMetrics();
	assert.ok(live);
	assert.equal(live.snapshot.length, 2);
	assert.equal(live.snapshot[1].responses, 1);
	assert.equal(live.snapshot[1].tokens.input.sum, 2);
	assert.equal(live.snapshot[1].selectedModelId, "unknown");
	h.emit("session_shutdown");
});

test("session replacement discards stale accounting; shutdown never awaits anything", async () => {
	const h = harness(); await h.emit("session_start");
	h.emit("message_end", { message: final() });
	h.replace(); await h.emit("session_start"); await tick();
	assert.equal(liveSessionMetrics()?.snapshot.length, 0);
	h.emit("message_end", { message: final() }); await tick();
	assert.equal(liveSessionMetrics()?.snapshot.length, 1);
	// No delivery exists to join or abort: interactive and print shutdowns
	// both return synchronously.
	assert.equal(h.emit("session_shutdown"), undefined);
	const print = harness({}, "print", 5 as never);
	await print.emit("session_start");
	print.emit("message_end", { message: final() });
	assert.equal(print.emit("session_shutdown"), undefined);
});

test("policy gates are gone: local accounting stays on in CI-style environments", async () => {
	for (const env of [{ DO_NOT_TRACK: "1" }, { GENTLE_AI_TELEMETRY: "0" }, { CI: "true" }]) {
		const h = harness(env); await h.emit("session_start");
		assert.ok(h.handlers.size > 0, "hooks stay registered without outbound telemetry");
		h.emit("message_end", { message: final() }); await tick();
		assert.equal(liveSessionMetrics()?.snapshot.length, 1, Object.keys(env)[0]);
		h.emit("session_shutdown");
	}
});

test("child-marker processes opt out entirely", async () => {
	const h = harness({ JERO_PI_AGENTS_CHILD: "1" });
	await h.emit("session_start");
	assert.equal(h.handlers.size, 0);
	h.emit("message_end", { message: final() }); await tick();
	assert.equal(liveSessionMetrics(), undefined);
});

test("tool and partial assistant messages are not consumed as primary usage", async () => {
	const h = harness(); await h.emit("session_start");
	for (const message of [{ ...final(), role: "toolResult" }, { ...final(), stopReason: "pending" }, { ...final(), stopReason: "deferred" }]) h.emit("message_end", { message });
	await tick(); assert.equal(liveSessionMetrics()?.snapshot.length, 0); h.emit("session_shutdown");
});

test("child completion recorded once, busy children drop, and primary usage stays separate", async () => {
	const h = harness(); await h.emit("session_start");
	const observation = normalizeRpcEvent({ type: "message_end", message: final() }, { observeResponses: true })
		.find(event => event.type === TASK_EVENT.RESPONSE_OBSERVATION);
	assert.ok(observation?.type === TASK_EVENT.RESPONSE_OBSERVATION);
	const event = (taskId: string) => childEvent("first", taskId,
		{ agentClass: parseAgentClass("verify")!, selectedProvider: "openai", selectedModelId: "gpt-4o", selectedEffort: "high" }, "completed",
		{ coverage: "final_assistant_messages_only", agentSettled: true, droppedResponses: 0, responses: [observation.observation] }, 0)!;
	h.bus(event("one")); h.bus(event("one")); h.bus(event("busy"));
	await tick();
	let live = liveSessionMetrics();
	assert.ok(live);
	assert.equal(live.snapshot.length, 1);
	assert.equal(live.snapshot[0].agentClass, "verify");
	// Local accounting has no delivery queue to hide a second completed
	// observation behind (upstream's serialization artifact): a completion
	// for a NEW taskId records; the duplicate taskId drops.
	assert.equal(live.snapshot[0].responses, 2);
	assert.equal(live.snapshot[0].effort, "high", "child response retains launch selection separately from response evidence");
	assert.equal(live.snapshot[0].providerThinkingLevel, "low");
	h.bus(event("busy")); await tick();
	live = liveSessionMetrics();
	assert.ok(live);
	assert.equal(live.snapshot[0].responses, 2, "replayed completion stays consumed");
	h.emit("message_end", { message: final(2) }); await tick();
	live = liveSessionMetrics();
	assert.ok(live);
	const orchestrator = live.snapshot.find(row => row.agentClass === "orchestrator");
	assert.ok(orchestrator);
	assert.equal(orchestrator.tokens.input.sum, 2);
	h.emit("session_shutdown");
});
