// jero-ai 测试第 1 段（留守原文件名）（共 2 段；夹具在 jero-ai-shared.ts）。
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
	startedReviewResult, writeMarkdown,
	routingConsumerFixture,
} from "./jero-ai-shared.ts";

test("authority unavailability fails closed without installer recovery or lifecycle-script attribution", async () => {
	const result = await __testing.executeReviewControllerOperation(
		{ operation: "inspect" },
		process.cwd(),
		{
			targetStatus: async () => {
				throw new NativeReviewCliError(
					NATIVE_REVIEW_ERROR_CODE.UNAVAILABLE,
					"review/status",
					false,
					false,
					"authority-unavailable: in-process review authority is not wired yet (jero-pi P2); operation refused fail-closed",
				);
			},
		} as unknown as NativeReviewCli,
	);

	assert.equal(result.outcome, "native-status-unavailable");
	assert.equal(result.next_action, "require-complete-native-authority-inventory");
	assert.equal(result.recovery_command, undefined);
	assert.doesNotMatch(JSON.stringify(result), /install-gentle-ai/);
	assert.doesNotMatch(JSON.stringify(result), /JERO_PI_SKIP_GENTLE_AI_INSTALL/);
});

test("registered Jero Review tools render reusable rose lifecycle call rows", () => {
	const tools = registeredJeroTools();
	const cases = [
		["jero_review", { operation: "status" }, "review status"],
		["jero_review", { operation: "future-operation", secret: "/private" }, "review"],
		["jero_review_scope", {}, "review scope"],
		["jero_review_capture_group", {}, "review capture group"],
		[
			"jero_review_capture",
			{
				lineageId: "lineage-id",
				collectBinding: "binding-id",
				sha256: "sha256:hash-value",
				secret: "secret-value",
				arbitrary: "arbitrary-value",
			},
			"review capture",
		],
	] as const;

	assert.deepEqual(
		[...new Set(cases.map(([name]) => name))].sort(),
		[...tools.keys()].filter((name) => name.startsWith("jero_review")).sort(),
	);

	for (const [name, args, operationPath] of cases) {
		const tool = tools.get(name);
		assert.ok(tool, `missing ${name}`);
		const initial = tool.renderCall(args, lifecycleTheme, lifecycleContext());
		const initialText = renderComponent(initial);
		const running = tool.renderCall(
			args,
			lifecycleTheme,
			lifecycleContext({ executionStarted: true, lastComponent: initial }),
		);
		const runningText = renderComponent(running);
		const completed = tool.renderCall(
			args,
			lifecycleTheme,
			lifecycleContext({ executionStarted: true, isPartial: false, lastComponent: running }),
		);
		const completedText = renderComponent(completed);
		const failed = tool.renderCall(
			args,
			lifecycleTheme,
			lifecycleContext({ executionStarted: true, isPartial: false, isError: true, lastComponent: completed }),
		);
		const failedText = renderComponent(failed);

		assert.strictEqual(initial, running);
		assert.strictEqual(running, completed);
		assert.strictEqual(completed, failed);
		assert.equal(cardTitle(initialText), `🌹︎ Jero · running · ${operationPath}`); assert.equal(cardTone(initialText), "warning");
		assert.equal(cardTitle(runningText), `🌹︎ Jero · running · ${operationPath}`); assert.equal(cardTone(runningText), "warning");
		assert.equal(cardTitle(completedText), `🌹︎ Jero · completed · ${operationPath}`); assert.equal(cardTone(completedText), "success");
		assert.equal(cardTitle(failedText), `🌹︎ Jero · failed · ${operationPath}`); assert.equal(cardTone(failedText), "error");
		assert.doesNotMatch(renderComponent(failed), /future-operation|secret|private/);
		for (const forbiddenValue of ["lineage-id", "binding-id", "sha256:hash-value", "secret-value", "arbitrary-value"]) {
			assert.doesNotMatch(failedText, new RegExp(forbiddenValue));
		}
	}
});

test("registered Jero Review tools preserve result envelopes and redact collapsed result rendering", async () => {
	const tools = registeredJeroTools();
	const scope = tools.get("jero_review_scope");
	const manifest = { version: 1, scopeByMode: { "100644": ["src/file.ts"] }, gitlinks: {} };
	const bytes = Buffer.from(JSON.stringify(manifest), "utf8");
	const encoded = gzipSync(bytes, CANONICAL_GZIP_OPTIONS).toString("base64url");
	const sha256 = createHash("sha256").update(bytes).digest("hex");

	const result = await scope.execute(
		"scope-call",
		{ manifest: encoded, sha256, cursor: 0 },
		undefined,
		undefined,
		{ cwd: process.cwd() } as unknown as ExtensionContext,
	);
	const visibleEnvelope = JSON.parse(result.content[0].text);
	assert.deepEqual(visibleEnvelope, {
		version: 1,
		sha256,
		cursor: 0,
		totalPaths: 1,
		entries: [{ path: "src/file.ts", mode: "100644" }],
	});
	assert.deepEqual(result.details, visibleEnvelope);

	const resultText = "safe result\x1b[31m\nlineage=secret body=private";
	const expandHint = keyHint("app.tools.expand", "to expand");
	for (const name of ["jero_review", "jero_review_scope", "jero_review_capture"]) {
		const tool = tools.get(name);
		assert.equal(typeof tool?.renderResult, "function", `${name} must define result rendering`);
		for (const options of [
			{ expanded: false, isPartial: true, isError: false },
			{ expanded: false, isPartial: false, isError: false },
			{ expanded: false, isPartial: false, isError: true },
		]) {
			const collapsed = renderComponent(tool.renderResult({ content: [{ type: "text", text: resultText }] }, options, lifecycleTheme, {}));
			assert.match(cardBody(collapsed), /\d+ lines?\b/, `${name} collapsed output must contain one expand hint`);
			assert.match(cardBody(collapsed), /\d+ lines?\b/, `${name} collapsed output must start with the hint`);
			assert.doesNotMatch(collapsed, /safe result|lineage=secret|private/);
		}
		const expanded = renderComponent(tool.renderResult({ content: [{ type: "text", text: resultText }] }, { expanded: true, isPartial: false, isError: true }, lifecycleTheme, {}));
		assert.equal(cardBody(expanded).split("\n")[0], "safe result");
		assert.match(expanded, /safe result/);
		assert.match(expanded, /lineage=secret body=private/);
		assert.doesNotMatch(expanded, /to expand/);
		assert.doesNotMatch(cardBody(expanded), /\x1b\[/);
		const nonText = renderComponent(tool.renderResult({ content: [{ type: "image", data: "opaque", mimeType: "image/png" }] }, { expanded: true, isPartial: false }, lifecycleTheme, {}));
		assert.equal(cardBody(nonText), "");
		const empty = renderComponent(tool.renderResult({ content: [{ type: "text", text: "" }] }, { expanded: false, isPartial: false }, lifecycleTheme, {}));
		assert.equal(cardBody(empty), "");
	}
});





test("models saves and clears independent provider review roles without local artifacts", async (t) => {
	const fixture = routingConsumerFixture(t, []);
	const roles = ["review-refuter", "review-validator"];
	assert.deepEqual(
		__testing.listDiscoverableAgents(fixture.root).map((agent) => agent.name),
		[],
		"requires zero discovered agents; check package-sibling legacy agent directories",
	);

	const assertNoLocalArtifacts = () => {
		for (const base of [join(fixture.root, ".pi"), fixture.agentHome]) {
			assert.equal(existsSync(join(base, "subagents.json")), false);
			for (const dir of ["agents", "subagents"]) {
				for (const role of roles) {
					assert.equal(existsSync(join(base, dir, `${role}.md`)), false);
				}
			}
		}
	};
	fixture.onInput((panel) => {
		const initial = renderComponent(panel);
		for (const role of roles) {
			assert.equal(initial.split(role).length - 1, 1);
		}
		assert.match(initial, /Pi persisted default model/);
		assert.match(initial, /Pi persisted default effort/);
		for (const [index, model] of ["alpha", "beta"].entries()) {
			panel.handleInput("j");
			panel.handleInput("\r");
			assert.match(renderComponent(panel), /Pi persisted default model/);
			assert.doesNotMatch(renderComponent(panel), /Inherit active\/default model/);
			for (const character of model) panel.handleInput(character);
			panel.handleInput("\r");
			panel.handleInput("e");
			assert.match(renderComponent(panel), /Pi persisted default effort/);
			assert.doesNotMatch(renderComponent(panel), /Inherit effort/);
			for (let step = 0; step <= index; step++) panel.handleInput("j");
			panel.handleInput("\r");
		}
		panel.handleInput("\x13");
	});
	await fixture.run("jero:models");
	assert.deepEqual(JSON.parse(readFileSync(fixture.globalPath, "utf8")), {
		"review-refuter": { model: "openai/alpha", thinking: "off" },
		"review-validator": { model: "openai/beta", thinking: "minimal" },
	});
	assertNoLocalArtifacts();

	fixture.onInput((panel) => {
		panel.handleInput("j");
		panel.handleInput("i");
		panel.handleInput("\x13");
	});
	await fixture.run("jero:models");
	assert.deepEqual(JSON.parse(readFileSync(fixture.globalPath, "utf8")), {
		"review-refuter": {},
		"review-validator": { model: "openai/beta", thinking: "minimal" },
	});
	assertNoLocalArtifacts();

	fixture.onInput((panel) => {
		panel.handleInput("j");
		panel.handleInput("j");
		panel.handleInput("i");
		panel.handleInput("\x13");
	});
	await fixture.run("jero:models");
	assert.deepEqual(JSON.parse(readFileSync(fixture.globalPath, "utf8")), {
		"review-refuter": {},
		"review-validator": {},
	});
	assertNoLocalArtifacts();
});

test("provider review roles skip migration and both projection paths even when discoverable", async (t) => {
	const roles = ["review-refuter", "review-validator"];
	const fixture = routingConsumerFixture(t, [...roles, "worker"]);
	assert.deepEqual(
		__testing.listDiscoverableAgents(fixture.root).map((agent) => agent.name).sort(),
		[...roles, "worker"].sort(),
		"requires only seeded agents; check package-sibling legacy agent directories",
	);

	const rolePaths = roles.map((role) => join(fixture.root, ".pi", "agents", `${role}.md`));
	const originals = rolePaths.map((path) => readFileSync(path, "utf8"));
	const profilePaths = [
		join(fixture.root, ".pi", "subagents.json"),
		join(fixture.agentHome, "subagents.json"),
	];
	const profile = `${JSON.stringify({ model_profiles: {
		"review-refuter": "existing-refuter",
		"review-validator": "existing-validator",
	} }, null, 2)}\n`;
	for (const path of profilePaths) writeMarkdown(path, profile);
	const assignments = {
		"review-refuter": { model: "openai/alpha", thinking: "off" as const },
		"review-validator": { model: "openai/beta", thinking: "minimal" as const },
	};
	writeMarkdown(join(fixture.root, ".pi", "settings.json"), JSON.stringify({
		subagents: { agentOverrides: assignments },
	}));
	const assertReservedUnchanged = () => {
		rolePaths.forEach((path, index) => assert.equal(readFileSync(path, "utf8"), originals[index]));
		for (const path of profilePaths) assert.equal(readFileSync(path, "utf8"), profile);
	};
	await fixture.run("jero:models");
	assertReservedUnchanged();
	for (const role of roles) assert.equal(fixture.panels[0].split(role).length - 1, 1);
	assert.match(fixture.panels[0], /worker\s+model=inherit, effort=inherit/);
	for (const apply of [applyModelConfig, applyModelConfigAsync]) {
		await apply(fixture.root, assignments);
		assertReservedUnchanged();
		await apply(fixture.root, { "review-refuter": {}, "review-validator": {} });
		assertReservedUnchanged();
	}
	await applyModelConfigAsync(fixture.root, { worker: { model: "openai/alpha" } });
	assert.match(readFileSync(join(fixture.root, ".pi", "agents", "worker.md"), "utf8"), /model: openai\/alpha/);
	assert.ok(JSON.parse(readFileSync(profilePaths[0], "utf8")).model_profiles.worker);
});

test("models rejects invalid project routing with its selected source path", async (t) => {
	const fixture = routingConsumerFixture(t);
	writeFileSync(fixture.projectPath, "[]");
	await fixture.run("jero:models");
	assert.equal(fixture.notifications[0]?.severity, "warning");
	assert.ok(fixture.notifications[0]?.message.includes(fixture.projectPath));
	assert.equal(fixture.panelVisits(), 0);
});

test("export re-reads saved routing and rejects invalid project before creating its destination parent", async (t) => {
	const fixture = routingConsumerFixture(t);
	writeFileSync(fixture.projectPath, '{"worker":"openai/gpt-5"}');
	fixture.onPanel(() => {
		if (fixture.panelVisits() > 1) return { type: "cancel", config: {} };
		writeFileSync(fixture.projectPath, "[]");
		return { type: "export", config: {} };
	});
	await fixture.run("jero:models");
	assert.equal(fixture.notifications[0]?.severity, "warning");
	assert.ok(fixture.notifications[0]?.message.includes(`Invalid model config: ${fixture.projectPath}`));
	assert.equal(existsSync(fixture.exportPath), false);
	assert.equal(existsSync(fixture.configHome), false);
});

test("status reports invalid saved routing path instead of default agent routing", async (t) => {
	const fixture = routingConsumerFixture(t);
	writeFileSync(fixture.projectPath, "[]");
	await fixture.run("jero:status");
	const report = fixture.notifications.at(-1)!;
	assert.match(report.message, /Saved model routing: invalid/);
	assert.ok(report.message.includes(fixture.projectPath));
	assert.equal(report.severity, "warning");
	assert.doesNotMatch(report.message, /worker: model=/);
});

test("models exports missing, normalized project, and global-precedence saved routing", async (t) => {
	for (const source of ["missing", "project", "global"] as const) {
		await t.test(source, async (t) => {
			const fixture = routingConsumerFixture(t);
			if (source !== "missing") writeFileSync(fixture.projectPath, '{"worker":" openai/gpt-5 ","ignored":null}');
			if (source === "global") writeMarkdown(fixture.globalPath, '{"worker":{"model":" anthropic/opus ","thinking":"high"}}');
			fixture.onPanel(() => ({ type: fixture.panelVisits() === 1 ? "export" : "cancel", config: {} }));
			await fixture.run("jero:models");
			const agents = source === "missing" ? {} : source === "project"
				? { worker: { model: "openai/gpt-5" } }
				: { worker: { model: "anthropic/opus", thinking: "high" } };
			assert.deepEqual(JSON.parse(readFileSync(fixture.exportPath, "utf8")).agents, agents);
			assert.equal(fixture.notifications[0]?.severity, "info");
			assert.match(fixture.notifications[0]!.message, /导出到/);
			assert.equal(fixture.panelVisits(), 2);
			await fixture.run("jero:status");
			const report = fixture.notifications.at(-1)!.message;
			assert.ok(report.includes(`Saved model routing: ${source === "missing" ? "missing" : "valid"}`));
			assert.ok(report.includes(`Global model config: ${source === "global" ? "present" : "missing"}`));
			const expectedRouting = source === "missing" ? "inherit, effort=inherit"
				: source === "project" ? "openai/gpt-5, effort=inherit" : "anthropic/opus, effort=high";
			assert.ok(report.includes(`worker: model=${expectedRouting}`), report);
			assert.ok(fixture.panels[0].includes(`model=${expectedRouting}`), fixture.panels[0]);
		});
	}
});

test("invalid global routing overrides valid project in models, status, and export re-read", async (t) => {
	for (const atExport of [false, true]) {
		await t.test(atExport ? "invalidated during panel" : "invalid before panel", async (t) => {
			const fixture = routingConsumerFixture(t);
			writeFileSync(fixture.projectPath, '{"worker":"openai/gpt-5"}');
			if (!atExport) writeMarkdown(fixture.globalPath, "[]");
			fixture.onPanel(() => {
				if (fixture.panelVisits() > 1) return { type: "cancel", config: {} };
				writeMarkdown(fixture.globalPath, "[]");
				return { type: "export", config: {} };
			});
			await fixture.run("jero:models");
			assert.equal(fixture.notifications[0]?.severity, "warning");
			assert.ok(fixture.notifications[0]?.message.includes(fixture.globalPath));
			assert.match(fixture.notifications[0]!.message, atExport ? /模型路由导出失败/ : /无法打开模型配置/);
			assert.equal(fixture.panelVisits(), atExport ? 2 : 0);
			assert.equal(existsSync(fixture.exportPath), false);
			await fixture.run("jero:status");
			const report = fixture.notifications.at(-1)!;
			assert.match(report.message, /Global model config: present\nSaved model routing: invalid/);
			assert.ok(report.message.includes(fixture.globalPath));
			assert.doesNotMatch(report.message, /worker: model=/);
			assert.equal(report.severity, "warning");
		});
	}
});

test("session startup reports invalid project routing without mutating the profile", async (t) => {
	const root = mkdtempSync(join(tmpdir(), "gentle-pi-model-routing-startup-"));
	const configHome = join(root, "global");
	const projectConfigDir = join(root, ".pi", "jero");
	const projectAgentsDir = join(root, ".pi", "agents");
	const projectProfileDir = join(root, ".pi");
	const rootAgentsDir = join(root, "agents");
	const agentHome = join(root, "agent-home");
	const agentHomeAgentsDir = join(agentHome, "agents");
	const agentHomeSubagentsDir = join(agentHome, "subagents");
	mkdirSync(configHome, { recursive: true });
	mkdirSync(projectConfigDir, { recursive: true });
	mkdirSync(projectAgentsDir, { recursive: true });
	mkdirSync(projectProfileDir, { recursive: true });
	mkdirSync(rootAgentsDir, { recursive: true });
	mkdirSync(agentHomeAgentsDir, { recursive: true });
	mkdirSync(agentHomeSubagentsDir, { recursive: true });
	t.after(() => rmSync(root, { recursive: true, force: true }));

	const previousConfigHome = process.env.JERO_PI_CONFIG_HOME;
	const previousAgentHome = process.env.JERO_PI_AGENT_HOME;
	process.env.JERO_PI_CONFIG_HOME = configHome;
	process.env.JERO_PI_AGENT_HOME = agentHome;
	t.after(() => {
		if (previousConfigHome === undefined) delete process.env.JERO_PI_CONFIG_HOME;
		else process.env.JERO_PI_CONFIG_HOME = previousConfigHome;
		if (previousAgentHome === undefined) delete process.env.JERO_PI_AGENT_HOME;
		else process.env.JERO_PI_AGENT_HOME = previousAgentHome;
	});

	writeFileSync(join(projectConfigDir, "models.json"), "[]");
	writeMarkdown(join(projectAgentsDir, "worker.md"), "---\nname: worker\ndescription: Worker\n---\nbody\n");
	const profilePath = join(projectProfileDir, "subagents.json");
	const profileBytes = `${JSON.stringify({ unrelated: { keep: true } }, null, 2)}\n`;
	writeFileSync(profilePath, profileBytes);
	const before = readFileSync(profilePath, "utf8");

	const handlers = new Map<string, (event: unknown, ctx: ExtensionContext) => Promise<void>>();
	const pi = {
		on(name: string, handler: (event: unknown, ctx: ExtensionContext) => Promise<void>) {
			handlers.set(name, handler);
		},
		registerCommand() {},
		registerTool() {},
	} as unknown as ExtensionAPI;
	createJeroAiExtension({ nativeReviewCli: null })(pi);
	const sessionStart = handlers.get("session_start");
	assert.equal(typeof sessionStart, "function");
	const notifications: Array<{ message: string; severity: string }> = [];
	await sessionStart!({}, {
		cwd: root,
		hasUI: true,
		ui: {
			notify(message: string, severity: string) {
				notifications.push({ message, severity });
			},
		},
	} as unknown as ExtensionContext);

	const warning = notifications.find((entry) => entry.message.includes(join(projectConfigDir, "models.json")));
	assert.ok(warning, JSON.stringify(notifications));
	assert.equal(warning!.severity, "warning");
	assert.match(warning!.message, /已跳过模型配置/);
	assert.equal(readFileSync(profilePath, "utf8"), before);

	writeFileSync(join(projectConfigDir, "models.json"), '{"worker":"openai/gpt-5"}');
	const globalPath = join(configHome, "models.json");
	writeFileSync(globalPath, "[]");
	notifications.length = 0;
	await sessionStart!({}, {
		cwd: root,
		hasUI: true,
		ui: { notify(message: string, severity: string) { notifications.push({ message, severity }); } },
	} as unknown as ExtensionContext);
	const globalWarning = notifications.find((entry) => entry.message.includes(globalPath));
	assert.ok(globalWarning, JSON.stringify(notifications));
	assert.equal(globalWarning.severity, "warning");
	assert.match(globalWarning.message, /已跳过模型配置/);
	assert.equal(readFileSync(profilePath, "utf8"), before);
});
