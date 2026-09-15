import assert from "node:assert/strict";
import test from "node:test";
import runtimeMetrics from "../extensions/runtime-metrics.ts";

// Delivery is removed from the extension: aggregates stay local and never
// leave the machine. What remains observable is the environment gate — an
// opted-out environment must not register any hook at all, while an allowing
// environment still wires the local accounting handlers.
function harness(env: NodeJS.ProcessEnv = {}) {
	const handlers = new Map<string, Function>();
	const listeners = new Map<string, Function>();
	const session = "first";
	const ctx: any = { cwd: "/fixture", mode: "tui" as const, model: { provider: "openai", id: "gpt-4o" },
		sessionManager: { getSessionId: () => session } };
	const pi: any = { on: (name: string, handler: Function) => handlers.set(name, handler),
		getThinkingLevel: () => "high", registerCommand() {},
		events: { on: (name: string, handler: Function) => { listeners.set(name, handler); return () => listeners.delete(name); } } };
	runtimeMetrics(pi, env, { now: () => 0 });
	return { handlers, listeners, ctx, emit: (name: string, event: any = {}) => handlers.get(name)?.(event, ctx) };
}

const final = (input = 7) => ({ role: "assistant", provider: "openai", model: "gpt-4o", responseModel: "gpt-4o",
	providerThinkingLevel: "low", stopReason: "stop", usage: { input, output: 3, cacheRead: 0 },
	content: [{ text: "private response" }], errorMessage: "private error", path: "/private" });

test("an allowing environment registers the local accounting hooks", async () => {
	const h = harness();
	await h.emit("session_start");
	h.emit("turn_start"); h.emit("before_provider_request");
	h.emit("message_end", { message: final() });
	// Local accounting only: nothing is delivered anywhere, and no hook throws
	// its way out of the provider path on a fully valid response.
	assert.ok(h.handlers.size > 0);
	assert.ok(h.listeners.size > 0);
	h.emit("session_shutdown");
});

for (const env of [{ DO_NOT_TRACK: "1" }, { GENTLE_AI_TELEMETRY: "0" }, { CI: "true" }, { GENTLE_PI_AGENTS_CHILD: "1" }]) {
	test(`opt-out suppresses all hooks: ${Object.keys(env)[0]}`, async () => {
		const h = harness(env);
		assert.equal(h.handlers.size, 0);
		assert.equal(h.listeners.size, 0);
	});
}
