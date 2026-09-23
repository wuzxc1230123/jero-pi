// agents-runner 测试共享夹具与助手：自 agents-runner.test.ts 机械平移（语义零改动）。

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


// Gentle Agents runner: every subagent is a child `pi --mode rpc` process.
// The host only parses JSON lines, applies deltas to the store, answers
// dialogs, and enforces its inactivity watchdog. These tests drive a fake child.

export const explorer: AgentDefinition = { name: "explore", description: "maps", filePath: "/a/explore.md", scope: "global", instructions: "You map things.", model: undefined, thinking: undefined, mode: undefined, tools: ["read", "grep"] };

export function request(overrides: Partial<TaskRequest> = {}): TaskRequest {
	return { agent: explorer, prompt: "Map the repo", label: undefined, context: undefined, mode: AGENT_MODE.TASK, cwd: "/repo", parentSessionId: "s1", model: { provider: "openai-codex", id: "gpt-5.6-terra" }, thinking: "high", sessionDir: "/sessions", resumeSessionPath: undefined, env: {}, ...overrides };
}

export interface Harness {
	store: TaskStore;
	runner: AgentRunner;
	children: FakeChild[];
	timers: Array<{ fn: () => void; ms: number; cancelled: boolean }>;
	asks: Array<{ taskId: string; method: string }>;
	finishes: string[];
	spawnOptions: Array<{ env: NodeJS.ProcessEnv; stdio?: string[] }>;
}

export function harness(options: { pid?: number; maxConcurrency?: number; stallTimeoutMs?: number; answer?: Record<string, unknown>; exitOnKill?: boolean; state?: Record<string, unknown>; stateSuccess?: boolean; onNotification?: RunnerHooks["onNotification"]; onSuccessfulMutation?: RunnerHooks["onSuccessfulMutation"]; onFinish?: RunnerHooks["onFinish"] } = {}): Harness {
	const children: FakeChild[] = [];
	const timers: Harness["timers"] = [];
	const asks: Harness["asks"] = [];
	const finishes: string[] = [];
	const spawnOptions: Harness["spawnOptions"] = [];
	let clock = 1000;
	const deps: RunnerDeps = {
		spawn: (_command, _args, launchOptions) => {
			spawnOptions.push({ env: launchOptions.env, stdio: launchOptions.stdio });
			const fake = fakeChild({ exitOnKill: options.exitOnKill, pid: options.pid });
			if (options.state !== undefined) {
				fake.child.stdin.removeAllListeners("data");
				fake.child.stdin.on("data", (chunk) => {
					const command = JSON.parse(String(chunk));
					fake.written.push(command);
					fake.emit({ type: "response", id: command.id, success: command.type !== "get_state" || options.stateSuccess !== false,
						data: command.type === "get_state" ? options.state : undefined });
				});
			}
			children.push(fake);
			return fake.child;
		},
		now: () => (clock += 1),
		schedule: (fn, ms) => {
			const timer = { fn, ms, cancelled: false };
			timers.push(timer);
			return () => {
				timer.cancelled = true;
			};
		},
		pi: { command: "pi", args: [] },
	};
	const store = new TaskStore();
	const runner = new AgentRunner(store, { maxConcurrency: options.maxConcurrency ?? 2, stallTimeoutMs: options.stallTimeoutMs ?? 10_000 }, deps, {
		askUser: async (taskId, ask) => {
			asks.push({ taskId, method: ask.method });
			return options.answer ?? { value: "yes" };
		},
		onFinish: (task, observations) => { finishes.push(task.id); options.onFinish?.(task, observations); },
		onNotification: options.onNotification,
		onSuccessfulMutation: options.onSuccessfulMutation,
	});
	return { store, runner, children, timers, asks, finishes, spawnOptions };
}

export const tick = () => new Promise((resolve) => setImmediate(resolve));

export const FOUR_MIN_MS = 4 * 60_000;

// A child that never answers the launch RPC commands (get_state, prompt), so
// the task's lastStep never leaves its initial "starting" stage. Used to
// exercise the stall watchdog before any child response arrives.
export function silentHarness(stallTimeoutMs: number): { store: TaskStore; runner: AgentRunner; timers: Array<{ fn: () => void; ms: number; cancelled: boolean }>; child: () => FakeChild } {
	const timers: Array<{ fn: () => void; ms: number; cancelled: boolean }> = [];
	let clock = 1000;
	let created: FakeChild | undefined;
	const store = new TaskStore();
	const runner = new AgentRunner(store, { maxConcurrency: 1, stallTimeoutMs }, {
		spawn: () => {
			created = fakeChild();
			created.child.stdin.removeAllListeners("data");
			return created.child;
		},
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
	return { store, runner, timers, child: () => created! };
}

