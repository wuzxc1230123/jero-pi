// jero-ai 测试第 2 段（共 2 段；夹具在 jero-ai-shared.ts）。
// 机械平移自原 jero-ai.test.ts，语义零改动。

import { default as assert } from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { default as test } from "node:test";
import { gzipSync } from "node:zlib";
import { type ExtensionAPI, type ExtensionContext, initTheme, keyHint, type Theme, type ToolCallEventResult } from "@earendil-works/pi-coding-agent";
import { __testing, applyModelConfig, applyModelConfigAsync, createJeroAiExtension } from "../extensions/jero-ai.ts";
import { PROFILES_KIND, PROFILES_VERSION } from "../lib/agent-profiles.ts";
import { NATIVE_REVIEW_ERROR_CODE, type NativeReviewCli, NativeReviewCliError } from "../lib/authority/client-contract.ts";
import { CandidateViewError, type CandidateViewRegistry, CANONICAL_GZIP_OPTIONS } from "../lib/review-candidate-view.ts";
import { installPackageAssets } from "../lib/sdd-preflight.ts";
import { type ReviewCollectInputV3, type ReviewStatusV3 } from "../lib/authority/wire-contract.ts";
import { stripAnsi } from "../lib/terminal-theme.ts";
import { cardBody, cardHint, cardTitle, cardTone } from "./gentle-card-text.ts";
import {
	cleanWorkspaceStatus, lifecycleContext, lifecycleTheme, offeredCommittedRangeStatus,
	registeredJeroTools, renderComponent, reviewRepository, type ReviewStartRepository,
	startedReviewResult, writeMarkdown
} from "./jero-ai-shared.ts";
import { routingConsumerFixture, type RoutingConsumerPanel } from "./jero-ai-shared.ts";

test("agent model discovery prioritizes SDD and Judgment Day agents", (t) => {
	const root = mkdtempSync(join(tmpdir(), "gentle-pi-model-agents-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	writeMarkdown(join(root, "zeta.md"), "name: zeta\n");
	writeMarkdown(join(root, "jd-fix-agent.md"), "name: jd-fix-agent\n");
	writeMarkdown(join(root, "sdd-apply.md"), "name: sdd-apply\n");
	writeMarkdown(join(root, "alpha.md"), "name: alpha\n");
	writeMarkdown(join(root, "jd-judge-b.md"), "name: jd-judge-b\n");
	writeMarkdown(join(root, "sdd-init.md"), "name: sdd-init\n");
	writeMarkdown(join(root, "jd-judge-a.md"), "name: jd-judge-a\n");

	const discovered = __testing.listAgentsFromDir(root, "user");
	const ordered = __testing.orderDiscoverableAgents(discovered);

	assert.deepEqual(
		ordered.map((agent) => agent.name),
		[
			"sdd-init",
			"sdd-apply",
			"jd-judge-a",
			"jd-judge-b",
			"jd-fix-agent",
			"alpha",
			"zeta",
		],
	);
});

test("discoverable model agents include installed Judgment Day agents", (t) => {
	const root = mkdtempSync(join(tmpdir(), "gentle-pi-installed-agents-"));
	const previousHome = process.env.JERO_PI_AGENT_HOME;
	process.env.JERO_PI_AGENT_HOME = root;
	t.after(() => {
		if (previousHome === undefined) delete process.env.JERO_PI_AGENT_HOME;
		else process.env.JERO_PI_AGENT_HOME = previousHome;
		rmSync(root, { recursive: true, force: true });
	});
	writeMarkdown(join(root, "agents", "jd-judge-a.md"), "name: jd-judge-a\n");
	writeMarkdown(join(root, "agents", "jd-judge-b.md"), "name: jd-judge-b\n");
	writeMarkdown(join(root, "agents", "jd-fix-agent.md"), "name: jd-fix-agent\n");

	const discovered = __testing.listDiscoverableAgents(root).map((agent) => agent.name);

	assert.deepEqual(
		discovered.filter((name) => name.startsWith("jd-")),
		["jd-judge-a", "jd-judge-b", "jd-fix-agent"],
	);
});

test("model panel render does not auto-apply the Gentle theme and sanitizes agent labels", () => {
	const lines = __testing.renderSddModelPanel(
		{},
		["openai/gpt-5.5"],
		["safe-agent\x1b[31m"],
		72,
	);
	const rendered = lines.join("\n");
	const plain = stripAnsi(rendered);

	assert.doesNotMatch(cardBody(rendered), /\x1b\[38;2;71;85;105m/);
	assert.doesNotMatch(cardBody(rendered), /\x1b\[38;2;125;211;252m/);
	assert.match(plain, /Assign Models and Effort to Agents/);
	assert.match(plain, /safe-agent\s+model=inherit, effort=inherit/);
	assert.doesNotMatch(plain, /\[31m/);
});

test("model panel render uses the Pi-provided current theme when supplied", () => {
	const currentTheme = {
		fg(_color: string, text: string): string {
			return `\x1b[35m${text}\x1b[39m`;
		},
	} as unknown as Theme;

	const rendered = __testing
		.renderSddModelPanel({}, ["openai/gpt-5.5"], ["safe-agent"], 72, currentTheme)
		.join("\n");

	assert.match(rendered, /\x1b\[35m/);
	assert.match(stripAnsi(rendered), /Assign Models and Effort to Agents/);
});

test("delivery commands bypass RDD under every mode outcome while command safety remains independent", async () => {
	type ToolCallHandler = (
		event: { toolName: string; input: unknown },
		ctx: ExtensionContext,
	) => Promise<ToolCallEventResult | undefined>;
	const commands = [
		"git commit -m relay",
		"git push origin feature/relay",
		"gh pr create --base main --head feature/relay",
		"gh release create v1.2.3",
		"git status && git commit -m relay",
		"env SAFE=1 git push origin feature/relay",
		"sh -c 'gh pr create --base main --head feature/relay'",
		"sh -c 'gh release create v1.2.3'",
	] as const;
	const modes = [
		{ label: "no native CLI", nativeReviewCli: null },
		{ label: "RDD off", nativeReviewCli: { reviewMode: async () => ({ status: { effective: "off" } }) } },
		{ label: "RDD on", nativeReviewCli: { reviewMode: async () => ({ status: { effective: "on" } }) } },
		{ label: "mode failure", nativeReviewCli: { reviewMode: async () => { throw new Error("mode unavailable"); } } },
	] as const;

	for (const mode of modes) {
		const handlers = new Map<string, ToolCallHandler>();
		const pi = {
			on(name: string, handler: ToolCallHandler) {
				handlers.set(name, handler);
			},
			events: { emit() {} },
			registerCommand() {},
			registerTool() {},
		} as unknown as ExtensionAPI;
		createJeroAiExtension({ nativeReviewCli: mode.nativeReviewCli as never })(pi);
		const toolCall = handlers.get("tool_call");
		assert.equal(typeof toolCall, "function", mode.label);
		const ctx = {
			cwd: process.cwd(),
			hasUI: true,
			ui: { confirm: async () => true },
		} as unknown as ExtensionContext;

		for (const command of commands) {
			const result = await toolCall!({ toolName: "bash", input: { command } }, ctx);
			assert.equal(result, undefined, `${mode.label}: ${command}`);
		}
	}
});

test("guarded command confirmation emits a generic correlated permission lifecycle", async () => {
	type ToolCallHandler = (
		event: { toolName: string; input: unknown },
		ctx: ExtensionContext,
	) => Promise<ToolCallEventResult | undefined>;
	type PermissionEvent = {
		channel: string;
		data: {
			requestId: string;
			state: "waiting" | "approved" | "denied";
			source: "tool_call";
			message: string;
			toolName: "bash";
		};
	};
	type HerdrBlockedEvent = {
		channel: "herdr:blocked";
		data: { active: boolean; label?: string };
	};
	type EmittedEvent = PermissionEvent | HerdrBlockedEvent;
	const handlers = new Map<string, ToolCallHandler>();
	const emitted: EmittedEvent[] = [];
	const sequence: string[] = [];
	let confirm!: () => Promise<boolean>;
	const pi = {
		on(name: string, handler: ToolCallHandler) {
			handlers.set(name, handler);
		},
		events: {
			emit(channel: string, data: EmittedEvent["data"]) {
				const state = "state" in data ? data.state : undefined;
				sequence.push(
					channel === "herdr:blocked"
						? `herdr:${"active" in data && data.active ? "active" : "inactive"}`
						: `event:${state}`,
				);
				emitted.push({ channel, data } as EmittedEvent);
			},
		},
		registerCommand() {},
		registerTool() {},
	} as unknown as ExtensionAPI;
	createJeroAiExtension({ nativeReviewCli: null })(pi);
	const toolCall = handlers.get("tool_call");
	assert.equal(typeof toolCall, "function");
	const cwd = mkdtempSync(join(tmpdir(), "gentle-pi-permission-request-"));
	try {
		const ctx = {
			cwd,
			hasUI: true,
			ui: {
				confirm: async () => {
					sequence.push("confirm");
					return confirm();
				},
			},
		} as unknown as ExtensionContext;
		let resolveConfirmation!: (approved: boolean) => void;
		confirm = () => new Promise<boolean>((resolve) => { resolveConfirmation = resolve; });
		const denied = toolCall!({
			toolName: "bash",
			input: { command: "git rebase main --secret-command-content" },
		}, ctx);

		await Promise.resolve();
		assert.equal(emitted[0].channel, "pi-permission-system:permission-request");
		assert.equal(emitted[0].data.state, "waiting");
		assert.deepEqual(emitted[1], {
			channel: "herdr:blocked",
			data: { active: true, label: "Guarded command confirmation" },
		});
		assert.deepEqual(sequence, ["event:waiting", "herdr:active", "confirm"]);
		const deniedRequestId = emitted[0].data.requestId;
		assert.match(deniedRequestId, /^[0-9a-f-]{36}$/);
		assert.deepEqual(emitted[0].data, {
			requestId: deniedRequestId,
			state: "waiting",
			source: "tool_call",
			message: "Jero safety policy requires confirmation for this tool call.",
			toolName: "bash",
		});
		assert.equal(Object.keys(emitted[0].data).includes("command"), false);
		assert.equal(Object.keys(emitted[0].data).includes("preview"), false);
		assert.doesNotMatch(JSON.stringify(emitted), /secret-command-content|git rebase/);

		resolveConfirmation(false);
		assert.deepEqual(await denied, {
			block: true,
			reason: "Jero safety policy blocked the command because it was not confirmed.",
		});
		assert.deepEqual(emitted[2], {
			channel: "pi-permission-system:permission-request",
			data: {
				requestId: deniedRequestId,
				state: "denied",
				source: "tool_call",
				message: "Jero safety policy requires confirmation for this tool call.",
				toolName: "bash",
			},
		});
		assert.deepEqual(emitted[3], {
			channel: "herdr:blocked",
			data: { active: false },
		});
		assert.deepEqual(sequence, ["event:waiting", "herdr:active", "confirm", "event:denied", "herdr:inactive"]);

		emitted.length = 0;
		sequence.length = 0;
		confirm = async () => true;
		assert.equal(await toolCall!({ toolName: "bash", input: { command: "git rebase main" } }, ctx), undefined);
		assert.equal(emitted.length, 4);
		assert.equal(emitted[0].data.state, "waiting");
		assert.deepEqual(emitted[1], {
			channel: "herdr:blocked",
			data: { active: true, label: "Guarded command confirmation" },
		});
		assert.equal(emitted[2].data.state, "approved");
		assert.equal(emitted[0].data.requestId, emitted[2].data.requestId);
		assert.notEqual(emitted[0].data.requestId, deniedRequestId);
		assert.deepEqual(emitted[3], {
			channel: "herdr:blocked",
			data: { active: false },
		});
		assert.deepEqual(sequence, ["event:waiting", "herdr:active", "confirm", "event:approved", "herdr:inactive"]);

		emitted.length = 0;
		sequence.length = 0;
		const confirmationError = new Error("confirmation unavailable");
		confirm = async () => { throw confirmationError; };
		await assert.rejects(
			toolCall!({ toolName: "bash", input: { command: "git rebase main" } }, ctx),
			(error) => error === confirmationError,
		);
		assert.equal(emitted.length, 4);
		assert.equal(emitted[0].data.state, "waiting");
		assert.deepEqual(emitted[1], {
			channel: "herdr:blocked",
			data: { active: true, label: "Guarded command confirmation" },
		});
		assert.equal(emitted[2].data.state, "denied");
		assert.equal(emitted[0].data.requestId, emitted[2].data.requestId);
		assert.deepEqual(emitted[3], {
			channel: "herdr:blocked",
			data: { active: false },
		});
		assert.deepEqual(sequence, ["event:waiting", "herdr:active", "confirm", "event:denied", "herdr:inactive"]);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("concurrent guarded confirmations coalesce the Herdr lifecycle per extension instance", async () => {
	type ToolCallHandler = (
		event: { toolName: string; input: unknown },
		ctx: ExtensionContext,
	) => Promise<ToolCallEventResult | undefined>;
	type EmittedEvent = {
		channel: string;
		data: {
			requestId?: string;
			state?: "waiting" | "approved" | "denied";
			active?: boolean;
			label?: string;
		};
	};
	const createHarness = () => {
		const handlers = new Map<string, ToolCallHandler>();
		const emitted: EmittedEvent[] = [];
		const confirmations: Array<(approved: boolean) => void> = [];
		const pi = {
			on(name: string, handler: ToolCallHandler) {
				handlers.set(name, handler);
			},
			events: { emit(channel: string, data: EmittedEvent["data"]) { emitted.push({ channel, data }); } },
			registerCommand() {},
			registerTool() {},
		} as unknown as ExtensionAPI;
		createJeroAiExtension({ nativeReviewCli: null })(pi);
		return { handlers, emitted, confirmations };
	};
	const first = createHarness();
	const second = createHarness();
	const cwd = mkdtempSync(join(tmpdir(), "gentle-pi-permission-concurrent-"));
	try {
		const context = (confirmations: Array<(approved: boolean) => void>) => ({
			cwd,
			hasUI: true,
			ui: {
				confirm: async () => new Promise<boolean>((resolve) => { confirmations.push(resolve); }),
			},
		} as unknown as ExtensionContext);
		const firstRequest = first.handlers.get("tool_call")!({ toolName: "bash", input: { command: "git rebase main" } }, context(first.confirmations));
		const secondRequest = first.handlers.get("tool_call")!({ toolName: "bash", input: { command: "git rebase main --another-command" } }, context(first.confirmations));
		await Promise.resolve();
		assert.deepEqual(first.emitted.map(({ channel, data }) => ({ channel, state: data.state, active: data.active })), [
			{ channel: "pi-permission-system:permission-request", state: "waiting", active: undefined },
			{ channel: "herdr:blocked", state: undefined, active: true },
			{ channel: "pi-permission-system:permission-request", state: "waiting", active: undefined },
		]);
		assert.equal(first.confirmations.length, 2);
		const waitingEvents = first.emitted.filter(({ channel, data }) => channel === "pi-permission-system:permission-request" && data.state === "waiting");
		assert.notEqual(waitingEvents[0]?.data.requestId, waitingEvents[1]?.data.requestId);

		first.confirmations[0]!(false);
		assert.deepEqual(await firstRequest, {
			block: true,
			reason: "Jero safety policy blocked the command because it was not confirmed.",
		});
		assert.deepEqual(first.emitted.map(({ channel, data }) => ({ channel, state: data.state, active: data.active })), [
			{ channel: "pi-permission-system:permission-request", state: "waiting", active: undefined },
			{ channel: "herdr:blocked", state: undefined, active: true },
			{ channel: "pi-permission-system:permission-request", state: "waiting", active: undefined },
			{ channel: "pi-permission-system:permission-request", state: "denied", active: undefined },
		]);

		const independentRequest = second.handlers.get("tool_call")!({ toolName: "bash", input: { command: "git rebase main --independent-command" } }, context(second.confirmations));
		await Promise.resolve();
		assert.equal(second.emitted.filter(({ channel }) => channel === "herdr:blocked").length, 1);
		assert.equal(second.emitted.find(({ channel }) => channel === "herdr:blocked")?.data.active, true);
		assert.equal(second.confirmations.length, 1);

		first.confirmations[1]!(true);
		assert.equal(await secondRequest, undefined);
		assert.equal(first.emitted.filter(({ channel, data }) => channel === "herdr:blocked" && data.active === false).length, 1);
		second.confirmations[0]!(true);
		assert.equal(await independentRequest, undefined);
		assert.deepEqual(second.emitted.map(({ channel, data }) => ({ channel, state: data.state, active: data.active })), [
			{ channel: "pi-permission-system:permission-request", state: "waiting", active: undefined },
			{ channel: "herdr:blocked", state: undefined, active: true },
			{ channel: "pi-permission-system:permission-request", state: "approved", active: undefined },
			{ channel: "herdr:blocked", state: undefined, active: false },
		]);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});



test("permission lifecycle is inactive for unguarded and headless commands", async () => {
	type ToolCallHandler = (
		event: { toolName: string; input: unknown },
		ctx: ExtensionContext,
	) => Promise<ToolCallEventResult | undefined>;
	const handlers = new Map<string, ToolCallHandler>();
	const emitted: unknown[] = [];
	let confirmations = 0;
	const pi = {
		on(name: string, handler: ToolCallHandler) {
			handlers.set(name, handler);
		},
		events: { emit(_channel: string, data: unknown) { emitted.push(data); } },
		registerCommand() {},
		registerTool() {},
	} as unknown as ExtensionAPI;
	createJeroAiExtension({ nativeReviewCli: null })(pi);
	const toolCall = handlers.get("tool_call");
	assert.equal(typeof toolCall, "function");
	const cwd = mkdtempSync(join(tmpdir(), "gentle-pi-permission-headless-"));
	try {
		const confirm = async () => {
			confirmations += 1;
			return true;
		};
		assert.equal(await toolCall!({ toolName: "bash", input: { command: "echo safe --secret-command-content" } }, {
			cwd,
			hasUI: false,
			ui: { confirm },
		} as unknown as ExtensionContext), undefined);
		assert.deepEqual(await toolCall!({ toolName: "bash", input: { command: "git rebase main" } }, {
			cwd,
			hasUI: false,
			ui: { confirm },
		} as unknown as ExtensionContext), {
			block: true,
			reason: "Jero safety policy requires interactive confirmation before this command.",
		});
		assert.equal(confirmations, 0);
		assert.deepEqual(emitted, []);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});
test("registered Jero Review capture tools name the lens they run", () => {
	const tools = registeredJeroTools();
	const binding = (lens: string) => JSON.stringify({ name: "reviewer_result", captureOperation: "review.capture-result", arguments: [], artifactSubject: { lens } });
	const single = tools.get("jero_review_capture")!.renderCall({ lineageId: "l", collectBinding: binding("review-risk") }, lifecycleTheme, lifecycleContext({ executionStarted: true }));
	assert.equal(cardTitle(renderComponent(single)), "🌹︎ Jero · running · review capture · risk");
	const bare = tools.get("jero_review_capture")!.renderCall({ lineageId: "l", collectBinding: "{not json" }, lifecycleTheme, lifecycleContext({ executionStarted: true }));
	assert.equal(cardTitle(renderComponent(bare)), "🌹︎ Jero · running · review capture");
	const group = tools.get("jero_review_capture_group")!.renderCall(
		{ lineageId: "l", collectBindings: [binding("review-risk"), binding("review-resilience"), binding("review-readability"), binding("review-reliability")] },
		lifecycleTheme,
		lifecycleContext({ executionStarted: true }),
	);
	assert.equal(cardTitle(renderComponent(group)), "🌹︎ Jero · running · review capture group · risk · resilience · readability · reliability");
});

test("bash tool_call confirms a late guarded npm publish and denies on non-approval", async () => {
	type ToolCallHandler = (
		event: { toolName: string; input: unknown },
		ctx: ExtensionContext,
	) => Promise<ToolCallEventResult | undefined>;

	const confirmArgs: Array<[string, string]> = [];
	const handlers = new Map<string, ToolCallHandler>();
	const pi = {
		on(name: string, handler: ToolCallHandler) {
			handlers.set(name, handler);
		},
		events: { emit() {} },
		registerCommand() {},
		registerTool() {},
	} as unknown as ExtensionAPI;
	createJeroAiExtension({ nativeReviewCli: null })(pi);
	const toolCall = handlers.get("tool_call");
	assert.equal(typeof toolCall, "function");

	const configHome = mkdtempSync(join(tmpdir(), "gentle-pi-guard-confirm-"));
	const ctx = {
		cwd: process.cwd(),
		hasUI: true,
		ui: {
			confirm: async (title: string, message: string) => {
				confirmArgs.push([title, message]);
				return false;
			},
		},
	} as unknown as ExtensionContext;

	const prefix = "noise ".repeat(80);
	const command = `${prefix}npm publish --tag beta`;
	const previousConfigHome = process.env.JERO_PI_CONFIG_HOME;
	process.env.JERO_PI_CONFIG_HOME = configHome;
	try {
		const result = await toolCall!({ toolName: "bash", input: { command } }, ctx);
		assert.deepEqual(result, {
			block: true,
			reason:
				"Jero safety policy blocked the command because it was not confirmed.",
		});
	} finally {
		if (previousConfigHome === undefined) delete process.env.JERO_PI_CONFIG_HOME;
		else process.env.JERO_PI_CONFIG_HOME = previousConfigHome;
		rmSync(configHome, { recursive: true, force: true });
	}

	assert.equal(confirmArgs.length, 1, "guard asks exactly one confirmation before denying");
	const [title, preview] = confirmArgs[0];
	assert.equal(title, "Allow guarded npm publish?");
	assert.match(preview, /npm publish --tag beta/);
	assert.ok(preview.startsWith("…"), "preview elides leading context near a late match");
});

test("bash tool_call confirms every compound action and centers a long git -C push", async () => {
	type ToolCallHandler = (
		event: { toolName: string; input: unknown },
		ctx: ExtensionContext,
	) => Promise<ToolCallEventResult | undefined>;
	const confirmArgs: Array<[string, string]> = [];
	const handlers = new Map<string, ToolCallHandler>();
	const pi = {
		on(name: string, handler: ToolCallHandler) { handlers.set(name, handler); },
		events: { emit() {} },
		registerCommand() {},
		registerTool() {},
	} as unknown as ExtensionAPI;
	createJeroAiExtension({ nativeReviewCli: null })(pi);
	const toolCall = handlers.get("tool_call");
	assert.equal(typeof toolCall, "function");

	const configHome = mkdtempSync(join(tmpdir(), "gentle-pi-guard-compound-"));
	const previousConfigHome = process.env.JERO_PI_CONFIG_HOME;
	process.env.JERO_PI_CONFIG_HOME = configHome;
	try {
		const command = `git -C /${"very-long-path/".repeat(30)} push origin main && npm publish --tag beta`;
		const result = await toolCall!({ toolName: "bash", input: { command } }, {
			cwd: process.cwd(),
			hasUI: true,
			ui: { confirm: async (title: string, message: string) => (confirmArgs.push([title, message]), false) },
		} as unknown as ExtensionContext);
		assert.deepEqual(result, {
			block: true,
			reason: "Jero safety policy blocked the command because it was not confirmed.",
		});
	} finally {
		if (previousConfigHome === undefined) delete process.env.JERO_PI_CONFIG_HOME;
		else process.env.JERO_PI_CONFIG_HOME = previousConfigHome;
		rmSync(configHome, { recursive: true, force: true });
	}

	assert.equal(confirmArgs.length, 1);
	const [title, preview] = confirmArgs[0];
	assert.equal(title, "Allow guarded actions: git push; npm publish?");
	assert.match(preview, /push origin main && npm publish --tag beta/);
	assert.ok(preview.startsWith("…"));
});
// /jero:profiles reopens its panel after actions that finish the interaction,
// so a test that applies once must confirm on the first visit and close on the
// next, or the panel and the action loop feed each other forever.
export function applyOnce(
	fixture: { onInput(action: (panel: { handleInput(data: string): void }) => void): void },
): void {
	let visits = 0;
	fixture.onInput((panel) => {
		visits += 1;
		panel.handleInput(visits === 1 ? "\r" : "\x1b");
	});
}

export function profilesStoreFixture(t: test.TestContext) {
	const fixture = routingConsumerFixture(t, ["worker"]);
	const storePath = join(fixture.configHome, "profiles.json");
	const settingsPath = join(fixture.agentHome, "settings.json");
	const writeStore = (profiles: Record<string, unknown>, active?: string) => {
		mkdirSync(fixture.configHome, { recursive: true });
		const store: Record<string, unknown> = { kind: PROFILES_KIND, version: PROFILES_VERSION, profiles };
		if (active !== undefined) store.active = active;
		writeFileSync(storePath, `${JSON.stringify(store, null, 2)}\n`);
	};
	const writeSettings = (extra: Record<string, unknown> = {}) => {
		const settings = {
			packages: ["npm:pi-mcp-adapter"],
			theme: "Gentleman-Cute",
			defaultProvider: "nan",
			defaultModel: "deepseek-v4-flash",
			defaultThinkingLevel: "high",
			...extra,
		};
		writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
		return settings;
	};
	return { fixture, storePath, settingsPath, writeStore, writeSettings };
}

test("applying a profile persists its orchestrator and never leaks the key into agent routing", async (t) => {
	const { fixture, settingsPath, writeStore, writeSettings } = profilesStoreFixture(t);
	const before = writeSettings();
	writeStore({
		team: {
			orchestrator: { model: "nan/glm5.3", thinking: "max" },
			worker: { model: "openai/alpha" },
		},
	});
	applyOnce(fixture);
	await fixture.run("jero:profiles");

	const after = JSON.parse(readFileSync(settingsPath, "utf8"));
	assert.equal(after.defaultProvider, "nan");
	assert.equal(after.defaultModel, "glm5.3");
	assert.equal(after.defaultThinkingLevel, "max");
	assert.deepEqual(after.packages, before.packages, "unrelated settings keys survive");
	assert.equal(after.theme, before.theme, "unrelated settings keys survive");

	// The reserved key is routing, not an agent: it must never reach the
	// subagent profile store or the agent frontmatter.
	const projectProfiles = JSON.parse(readFileSync(join(fixture.root, ".pi", "subagents.json"), "utf8"));
	assert.equal("orchestrator" in projectProfiles.model_profiles, false);
	assert.equal(readFileSync(join(fixture.root, ".pi", "agents", "worker.md"), "utf8"), readFileSync(join(fixture.root, ".pi", "agents", "worker.md"), "utf8"));
	assert.match(readFileSync(join(fixture.root, ".pi", "agents", "worker.md"), "utf8"), /model: openai\/alpha/);
	const applied = fixture.notifications.at(-1)?.message ?? "";
	assert.match(applied, /将编排器设为 nan\/glm5\.3 · max/);
});

test("applying a profile without an orchestrator entry leaves settings.json untouched", async (t) => {
	const { fixture, settingsPath, writeStore, writeSettings } = profilesStoreFixture(t);
	writeSettings();
	writeStore({ team: { worker: { model: "openai/alpha" } } });
	applyOnce(fixture);
	await fixture.run("jero:profiles");

	const after = JSON.parse(readFileSync(settingsPath, "utf8"));
	assert.equal(after.defaultProvider, "nan");
	assert.equal(after.defaultModel, "deepseek-v4-flash");
	assert.equal(after.defaultThinkingLevel, "high");
	const applied = fixture.notifications.at(-1)?.message ?? "";
	assert.doesNotMatch(applied, /Orchestrator set to/);
});

test("a profile store entry with only the orchestrator key counts zero roles", async (t) => {
	const { fixture, writeStore } = profilesStoreFixture(t);
	writeStore({ team: { orchestrator: { model: "nan/glm5.3", thinking: "high" } } }, "team");
	applyOnce(fixture);
	await fixture.run("jero:profiles");
	const applied = fixture.notifications.at(-1)?.message ?? "";
	assert.match(applied, /更新了 0 个代理/);
	assert.match(applied, /将编排器设为 nan\/glm5\.3 · high/);
});

test("applying a profile replaces materialized routing for agents the profile omits", async (t) => {
	const { fixture, writeStore, writeSettings } = profilesStoreFixture(t);
	writeSettings();
	// Routing materialized earlier (a previous profile, /jero:models, or a
	// migration) for an agent the new profile does not mention.
	const helperPath = join(fixture.root, ".pi", "agents", "helper.md");
	writeMarkdown(helperPath, "---\nname: helper\ndescription: Helper\nmodel: openai/beta\nthinking: high\n---\nbody\n");
	const subagentsPath = join(fixture.root, ".pi", "subagents.json");
	writeFileSync(subagentsPath, `${JSON.stringify({ model_profiles: { helper: { model: "openai/beta", effort: "high" } } }, null, 2)}\n`);
	writeStore({ team: { worker: { model: "openai/alpha" } } });
	applyOnce(fixture);
	await fixture.run("jero:profiles");

	const profiles = JSON.parse(readFileSync(subagentsPath, "utf8"));
	assert.deepEqual(profiles.model_profiles, { worker: { model: "openai/alpha" } }, "omitted agents lose their materialized route");
	const helper = readFileSync(helperPath, "utf8");
	assert.doesNotMatch(helper, /^model:/m);
	assert.doesNotMatch(helper, /^thinking:/m);
	assert.match(readFileSync(join(fixture.root, ".pi", "agents", "worker.md"), "utf8"), /model: openai\/alpha/);
	// models.json stays the profile itself, not a padded copy.
	assert.deepEqual(JSON.parse(readFileSync(fixture.globalPath, "utf8")), { worker: { model: "openai/alpha" } });
	const applied = fixture.notifications.at(-1)?.message ?? "";
	assert.match(applied, /已应用 profile "team"/);
});

test("a failed apply restores the previous profile's routing with the same replacement semantics", async (t) => {
	const { fixture, settingsPath, writeStore } = profilesStoreFixture(t);
	// An unreadable settings.json makes the orchestrator write fail after the
	// routing was already materialized, which triggers the rollback path.
	writeFileSync(settingsPath, "{ not json\n");
	const helperPath = join(fixture.root, ".pi", "agents", "helper.md");
	writeMarkdown(helperPath, "---\nname: helper\ndescription: Helper\nmodel: openai/beta\n---\nbody\n");
	const subagentsPath = join(fixture.root, ".pi", "subagents.json");
	writeFileSync(subagentsPath, `${JSON.stringify({ model_profiles: { helper: { model: "openai/beta" } } }, null, 2)}\n`);
	mkdirSync(fixture.configHome, { recursive: true });
	writeFileSync(fixture.globalPath, `${JSON.stringify({ helper: { model: "openai/beta" } }, null, 2)}\n`);
	// "team" is listed first, so Enter applies it while "old" stays the active one.
	writeStore({
		team: { orchestrator: { model: "nan/glm5.3" }, worker: { model: "openai/alpha" } },
		old: { helper: { model: "openai/beta" } },
	}, "old");
	applyOnce(fixture);
	await fixture.run("jero:profiles");

	const warning = fixture.notifications.find((entry) => /无法应用 profile "team"/.test(entry.message));
	assert.ok(warning, "the failed apply is reported");
	assert.deepEqual(JSON.parse(readFileSync(fixture.globalPath, "utf8")), { helper: { model: "openai/beta" } });
	const profiles = JSON.parse(readFileSync(subagentsPath, "utf8"));
	assert.deepEqual(profiles.model_profiles, { helper: { model: "openai/beta" } }, "the previous routing is materialized again and the failed profile's routes are cleared");
	assert.match(readFileSync(helperPath, "utf8"), /model: openai\/beta/);
	assert.doesNotMatch(readFileSync(join(fixture.root, ".pi", "agents", "worker.md"), "utf8"), /^model:/m);
	const store = JSON.parse(readFileSync(join(fixture.configHome, "profiles.json"), "utf8"));
	assert.equal(store.active, "old");
});

test("s snapshots current routing in place without applying or reopening the profiles panel", async (t) => {
	const { fixture, settingsPath, writeStore, writeSettings } = profilesStoreFixture(t);
	writeSettings();
	mkdirSync(fixture.configHome, { recursive: true });
	writeFileSync(fixture.globalPath, `${JSON.stringify({ worker: { model: "openai/alpha", thinking: "minimal" } }, null, 2)}\n`);
	const subagentsPath = join(fixture.root, ".pi", "subagents.json");
	writeFileSync(subagentsPath, `${JSON.stringify({ model_profiles: { worker: { model: "openai/beta", effort: "high" } } }, null, 2)}\n`);
	const workerPath = join(fixture.root, ".pi", "agents", "worker.md");
	const before = {
		models: readFileSync(fixture.globalPath, "utf8"),
		subagents: readFileSync(subagentsPath, "utf8"),
		worker: readFileSync(workerPath, "utf8"),
		settings: readFileSync(settingsPath, "utf8"),
	};
	writeStore({
		"a-target": {},
		"z-active": { worker: { model: "openai/beta" } },
	}, "z-active");

	let firstPanel: RoutingConsumerPanel | undefined;
	fixture.onInput((panel) => {
		if (firstPanel === undefined) {
			firstPanel = panel;
			panel.handleInput("s");
			panel.handleInput("\x1b");
		} else {
			panel.handleInput("\x1b");
		}
	});
	await fixture.run("jero:profiles");

	const store = JSON.parse(readFileSync(join(fixture.configHome, "profiles.json"), "utf8"));
	assert.deepEqual(store.profiles["a-target"], {
		worker: { model: "openai/alpha", thinking: "minimal" },
		orchestrator: { model: "nan/deepseek-v4-flash", thinking: "high" },
	});
	assert.deepEqual(store.profiles["z-active"], { worker: { model: "openai/beta" } });
	assert.equal(store.active, "z-active");
	assert.match(fixture.panels[0] ?? "", /enter apply · c create · s snapshot/);
	assert.equal(readFileSync(fixture.globalPath, "utf8"), before.models);
	assert.equal(readFileSync(subagentsPath, "utf8"), before.subagents);
	assert.equal(readFileSync(workerPath, "utf8"), before.worker);
	assert.equal(readFileSync(settingsPath, "utf8"), before.settings);
	assert.equal(fixture.panelVisits(), 1, "snapshot keeps the same panel open");
	assert.ok(firstPanel);
	const targetRow = renderComponent(firstPanel!).split("\n");
	const targetIndex = targetRow.findIndex((line) => line.includes("a-target"));
	assert.ok(targetIndex >= 0, "selected profile remains in the list");
	assert.match(targetRow[targetIndex + 1] ?? "", /1 role/);
	assert.match(renderComponent(firstPanel!), /Snapshot saved; live routing unchanged\. Profile "a-target" saved from current routing\./);
});

test("snapshot feedback keeps both outcomes visible for long profile names at narrow widths", async (t) => {
	const { fixture, storePath, writeStore } = profilesStoreFixture(t);
	const longName = `a${"x".repeat(63)}`;
	writeStore({ [longName]: {} });
	let firstPanel: RoutingConsumerPanel | undefined;
	fixture.onInput((panel) => {
		if (firstPanel === undefined) {
			firstPanel = panel;
			panel.handleInput("s");
			const success = stripAnsi(panel.render(60).join("\n"));
			assert.match(success, /Snapshot saved; live routing unchanged\./);
			rmSync(storePath);
			mkdirSync(storePath);
			panel.handleInput("s");
			panel.handleInput("\x1b");
		} else {
			panel.handleInput("\x1b");
		}
	});
	await fixture.run("jero:profiles");
	assert.ok(firstPanel);
	const constrained = stripAnsi(firstPanel!.render(60).join("\n"));
	assert.match(constrained, /Snapshot failed; live routing unchanged\./);
});

test("the profiles command seeds and shows the routing the runtime uses when models.json is sparse", async (t) => {
	const { fixture } = profilesStoreFixture(t);
	// No models.json at all, but routing is materialized where the runtime
	// reads it: subagents.json for worker, frontmatter only for helper.
	writeMarkdown(join(fixture.root, ".pi", "agents", "helper.md"), "---\nname: helper\ndescription: Helper\nmodel: openai/beta\n---\nbody\n");
	writeFileSync(join(fixture.root, ".pi", "subagents.json"), `${JSON.stringify({ model_profiles: { worker: { model: "openai/alpha", effort: "high" } } }, null, 2)}\n`);
	let rendered: string | undefined;
	fixture.onInput((panel) => {
		rendered = stripAnsi(renderComponent(panel));
		panel.handleInput("\x1b");
	});
	await fixture.run("jero:profiles");

	const store = JSON.parse(readFileSync(join(fixture.configHome, "profiles.json"), "utf8"));
	assert.equal(store.active, "current", "materialized routing counts as existing routing");
	assert.deepEqual(store.profiles.current, {
		worker: { model: "openai/alpha", thinking: "high" },
		helper: { model: "openai/beta" },
	});
	assert.ok(rendered);
	assert.match(rendered, /Current routing \(effective\)/);
	assert.match(rendered, /worker\s+openai\/alpha\s+high/);
	assert.match(rendered, /helper\s+openai\/beta/);
	assert.doesNotMatch(rendered, /No routing entries/);
});

test("effective routing prefers models.json over the materialized stores", (t) => {
	const fixture = routingConsumerFixture(t, ["worker", "helper"]);
	mkdirSync(fixture.configHome, { recursive: true });
	writeFileSync(fixture.globalPath, `${JSON.stringify({ worker: { model: "openai/alpha" } }, null, 2)}\n`);
	writeFileSync(join(fixture.root, ".pi", "subagents.json"), `${JSON.stringify({
		model_profiles: { worker: { model: "openai/beta", effort: "high" }, helper: { model: "openai/beta" } },
	}, null, 2)}\n`);
	const effective = JSON.parse(JSON.stringify(__testing.readEffectiveModelConfig(fixture.root)));
	assert.deepEqual(effective, {
		worker: { model: "openai/alpha" },
		helper: { model: "openai/beta" },
	});
	assert.equal(existsSync(join(fixture.root, ".pi", "jero", "models.json")), false, "reading never writes");
});

test("the profiles panel fills the terminal, lists routing per agent, and scrolls", async (t) => {
	const { fixture, writeStore } = profilesStoreFixture(t);
	writeStore({
		team: {
			orchestrator: { model: "nan/glm5.3", thinking: "high" },
			worker: { model: "openai/alpha", thinking: "high" },
			"sdd-design": { model: "nan/glm5.3", thinking: "high" },
		},
	}, "team");
	let rendered: string | undefined;
	let panel: { render(width: number): string[] } | undefined;
	fixture.onInput((visited) => {
		panel = visited;
		rendered = renderComponent(visited);
		visited.handleInput("\x1b");
	});
	await fixture.run("jero:profiles");

	assert.ok(rendered);
	const lines = rendered.split("\n");
	// The frame spans the terminal height the fake TUI reports.
	assert.equal(lines.length, 24, `expected 24 rows, got ${lines.length}`);
	assert.match(lines[0], /^╭/);
	assert.match(lines.at(-1)!, /^╰/);
	const text = rendered;
	// Routing is listed one agent per line, aligned in columns, never collapsed
	// into "N agents → model: a, b, …" summaries.
	assert.match(text, /Profile routing/);
	assert.match(text, /Current routing \(effective\)/);
	assert.match(text, /orchestrator\s+nan\/glm5\.3 · high/);
	assert.match(text, /worker\s+openai\/alpha\s+high/);
	assert.match(text, /sdd-design\s+nan\/glm5\.3\s+high/);
	assert.doesNotMatch(text, /agents? → /);

	// A taller terminal renders a taller frame with the same content.
	fixture.tui.terminal.rows = 40;
	const taller = renderComponent(panel);
	assert.equal(taller.split("\n").length, 40);

	// A short terminal clamps instead of crashing, and keeps both borders.
	fixture.tui.terminal.rows = 9;
	const short = stripAnsi(panel.render(120).map((line) => line.replace(/[ \t]+$/g, "")).join("\n"));
	const shortLines = short.split("\n");
	assert.equal(shortLines.length, 9);
	assert.match(shortLines[0], /^╭/);
	assert.match(shortLines.at(-1)!, /^╰/);
});

test("j and k scroll the detail pane one line at a time, like the agents view", async (t) => {
	const { fixture, writeStore } = profilesStoreFixture(t);
	const routing: Record<string, { model: string; thinking: string }> = {};
	for (let index = 1; index <= 25; index += 1) {
		routing[`agent-${String(index).padStart(2, "0")}`] = { model: "openai/alpha", thinking: "high" };
	}
	writeStore({ team: routing }, "team");
	let panel: { handleInput(data: string): void; render(width: number): string[] } | undefined;
	fixture.onInput((visited) => {
		panel = visited;
		visited.handleInput("\x1b");
	});
	await fixture.run("jero:profiles");
	assert.ok(panel, "the panel must open");
	const body = () => panel!.render(120).slice(1, -2).map((line) => line.replace(/[ \t]+$/, "")).join("\n");
	const firstAgentRow = (text: string) => text.split("\n").findIndex((line) => line.includes("agent-01"));
	const before = body();
	assert.ok(firstAgentRow(before) >= 0, "the first routing row must be visible before scrolling");
	panel!.handleInput("j");
	const afterJ = body();
	assert.notEqual(firstAgentRow(afterJ), firstAgentRow(before), "j must scroll the detail down by one line");
	panel!.handleInput("k");
	assert.equal(firstAgentRow(body()), firstAgentRow(before), "k must scroll the detail back up");
});

