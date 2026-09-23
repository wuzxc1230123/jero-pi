// runtime-harness 场景第 2/3 段：自 run() 机械平移（语义零改动）。
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { discoverAndLoadExtensions } from "@earendil-works/pi-coding-agent";
import { matchesKey } from "@earendil-works/pi-tui";
import { fileURLToPath, pathToFileURL } from "node:url";
import { stripAnsi } from "../lib/terminal-theme.ts";
import { domainHashV1 } from "../lib/review-canonical.ts";
import { canonicalHash } from "../lib/review-transaction.ts";

import {
	EXPECTED_BANNER_COMMANDS,
	EXPECTED_COMMANDS,
	EXTENSIONS,
	FORBIDDEN_COMPAT_COMMANDS,
	ROOT,
	createCtx,
	createJeroAiExtension,
	createPi,
	createUi,
	gitSync,
	loadExtensions,
	readAgentDefinition,
	restoreWorkspaceWritePermissions,
	sha256,
	tempWorkspace,
} from "./runtime-harness-support.mjs";

export async function part2(env) {
	const { globalConfigHome, globalAgentHome, ambientTestAssetsDir, globalModelsPath, globalSubagentsPath, pi, hooks, commands, flags, tools, emittedEvents, discovered, delegationDetail, promptCwd, toolCwd, candidateDriftCwd, bannerCwd, cancelPickerCwd } = env;

	const noUiCwd = await tempWorkspace();
	const startupAgentHome = join(noUiCwd, "agent-home");
	process.env.JERO_PI_AGENT_HOME = startupAgentHome;
	try {
		const globalAgentHome = startupAgentHome;
		for (const handler of hooks.get("session_start")) {
			await handler({ reason: "startup" }, createCtx(noUiCwd, false));
		}
		assert.equal(
			existsSync(join(noUiCwd, ".pi", "agents", "sdd-apply.md")),
			false,
			"session_start must not install project-local SDD agents",
		);
		assert.equal(
			existsSync(join(noUiCwd, ".pi", "chains", "sdd-full.chain.md")),
			false,
			"session_start must not install project-local SDD chains",
		);
		assert.equal(existsSync(join(globalAgentHome, "agents", "sdd-apply.md")), false);
		assert.equal(existsSync(join(globalAgentHome, "chains", "sdd-full.chain.md")), false);
		assert.equal(existsSync(join(globalAgentHome, "gentle-ai", "support")), false);
		for (const diagnostic of ["jero:status", "jero:doctor"]) {
			const ctx = createCtx(noUiCwd, true);
			await commands.get(diagnostic).handler("", ctx);
			assert.match(ctx.ui.notifications.at(-1).message, /Global SDD assets: on demand/);
			assert.doesNotMatch(ctx.ui.notifications.at(-1).message, /install-sdd --force/);
		}
		// gentle-pi#311 P5: the Pi-authored adversarial role agents are retired;
		// installation must not (re)create them.
		const installedRefuterPath = join(globalAgentHome, "agents", "review-refuter.md");
		assert.equal(existsSync(installedRefuterPath), false, "the retired review-refuter agent must not be installed");
		assert.equal(
			existsSync(join(globalAgentHome, "agents", "review-validator.md")),
			false,
			"the retired review-validator agent must not be installed",
		);
		const installedExplorePath = join(globalAgentHome, "agents", "jero-explore.md");
		assert.equal(existsSync(installedExplorePath), true);
		assert.deepEqual(
			readAgentDefinition(await readFile(installedExplorePath, "utf8")),
			{ name: "jero-explore", tools: ["read", "grep", "find", "fovea_focus", "fovea_sketch", "fovea_dwell"] },
			"isolated package installation must activate only the explorer inspection tools",
		);
		const installedRiskSource = await readFile(
			join(globalAgentHome, "agents", "review-risk.md"),
			"utf8",
		);
		assert.match(installedRiskSource, /对所提供的 `initial_review_tree` 恰好运行一次/);
		assert.match(installedRiskSource, /不能授权转移、修复、回执、闸门或交付/);
		await commands.get("jero:sdd-preflight").handler("", createCtx(noUiCwd, false, "startup-sdd-install"));
		assert.equal(existsSync(join(globalAgentHome, "agents", "sdd-apply.md")), true);
		assert.equal(existsSync(join(globalAgentHome, "chains", "sdd-full.chain.md")), true);
		assert.equal(existsSync(join(globalAgentHome, "jero", "support", "sdd-status-contract.md")), true);
		const managedAssetsManifestPath = join(globalAgentHome, "jero", "managed-assets.json");
		const managedAssetsManifest = JSON.parse(
			await readFile(managedAssetsManifestPath, "utf8"),
		);
		const previousManagedApply = "stale global apply\n";
		const previousManagedChain = "stale global chain\n";
		const previousManagedSupport = "stale global status contract\n";
		await writeFile(join(globalAgentHome, "agents", "sdd-apply.md"), previousManagedApply);
		managedAssetsManifest.assets["agents/sdd-apply.md"] = sha256(previousManagedApply);
		const samePathUserRefuter = [
			"---",
			"name: review-refuter",
			"tools:",
			"  - read",
			"  - bash",
			"---",
			"user-owned runtime policy",
			"",
		].join("\n");
		await writeFile(installedRefuterPath, samePathUserRefuter);
		delete managedAssetsManifest.assets["agents/review-refuter.md"];
		// Retirement sweep: a hash-proven package-managed copy of a retired
		// asset is deleted on refresh; the user-authored same-path refuter
		// above must survive because its hash proves nothing.
		const retiredManagedValidatorPath = join(globalAgentHome, "agents", "review-validator.md");
		const retiredManagedValidator = "stale managed validator\n";
		await writeFile(retiredManagedValidatorPath, retiredManagedValidator);
		managedAssetsManifest.assets["agents/review-validator.md"] = sha256(retiredManagedValidator);
		await mkdir(join(globalAgentHome, "subagents"), { recursive: true });
		const userRefuterOverride = join(globalAgentHome, "subagents", "review-refuter.md");
		await writeFile(userRefuterOverride, "user refuter override must stay\n");
		await writeFile(join(globalAgentHome, "chains", "sdd-full.chain.md"), previousManagedChain);
		managedAssetsManifest.assets["chains/sdd-full.chain.md"] = sha256(previousManagedChain);
		await writeFile(join(globalAgentHome, "jero", "support", "sdd-status-contract.md"), previousManagedSupport);
		managedAssetsManifest.assets["jero/support/sdd-status-contract.md"] = sha256(previousManagedSupport);
		await writeFile(
			managedAssetsManifestPath,
			JSON.stringify(managedAssetsManifest, null, 2),
		);
		await mkdir(join(noUiCwd, ".pi", "agents"), { recursive: true });
		await writeFile(join(noUiCwd, ".pi", "agents", "sdd-apply.md"), "project override must stay\n");
		const projectRefuterOverride = join(noUiCwd, ".pi", "agents", "review-refuter.md");
		await writeFile(projectRefuterOverride, "project refuter override must stay\n");
		for (const handler of hooks.get("session_start")) {
			await handler({ reason: "startup" }, createCtx(noUiCwd, false));
		}
		for (const [key, stale] of [
			["agents/sdd-apply.md", previousManagedApply],
			["chains/sdd-full.chain.md", previousManagedChain],
			["jero/support/sdd-status-contract.md", previousManagedSupport],
		]) {
			assert.equal(await readFile(join(globalAgentHome, key), "utf8"), stale,
				"startup must preserve existing SDD package content without explicit routing");
		}
		assert.equal(existsSync(retiredManagedValidatorPath), false, "review retirement still runs at startup");
		const driftCtx = createCtx(noUiCwd, true);
		await commands.get("jero:status").handler("", driftCtx);
		assert.match(driftCtx.ui.notifications.at(-1).message, /Global SDD assets stale: 3 file\(s\).*install-sdd --force/);
		assert.doesNotMatch(driftCtx.ui.notifications.at(-1).message, /install-(delegation|review) --force/);
		await commands.get("jero:sdd-preflight").handler("", createCtx(noUiCwd, false, "startup-sdd-refresh"));
		assert.notEqual(
			await readFile(join(globalAgentHome, "agents", "sdd-apply.md"), "utf8"),
			"stale global apply\n",
			"SDD preflight must refresh stale global SDD agents",
		);
		assert.equal(
			await readFile(installedRefuterPath, "utf8"),
			samePathUserRefuter,
			"session refresh must preserve a same-path user-authored agent byte-for-byte",
		);
		assert.notEqual(
			await readFile(join(globalAgentHome, "chains", "sdd-full.chain.md"), "utf8"),
			"stale global chain\n",
			"SDD preflight must refresh stale global SDD chains",
		);
		assert.notEqual(
			await readFile(join(globalAgentHome, "jero", "support", "sdd-status-contract.md"), "utf8"),
			"stale global status contract\n",
			"SDD preflight must refresh stale global SDD support files",
		);
		assert.equal(
			await readFile(join(noUiCwd, ".pi", "agents", "sdd-apply.md"), "utf8"),
			"project override must stay\n",
			"session_start must not overwrite project-local SDD overrides",
		);
		assert.equal(
			await readFile(projectRefuterOverride, "utf8"),
			"project refuter override must stay\n",
			"package refresh must not rewrite or certify an explicit project refuter",
		);
		assert.equal(
			await readFile(userRefuterOverride, "utf8"),
			"user refuter override must stay\n",
			"package refresh must not rewrite or certify an explicit user refuter",
		);
		assert.equal(
			existsSync(retiredManagedValidatorPath),
			false,
			"session refresh must delete a hash-proven package-managed copy of a retired asset",
		);
		const refreshedManagedAssets = JSON.parse(
			await readFile(managedAssetsManifestPath, "utf8"),
		);
		assert.equal(
			refreshedManagedAssets.assets["agents/review-validator.md"],
			undefined,
			"a retired asset must lose package-managed ownership",
		);
		assert.equal(
			refreshedManagedAssets.assets["agents/review-refuter.md"],
			undefined,
			"a user-authored same-path retired asset must stay unowned",
		);
	} finally {
		process.env.JERO_PI_AGENT_HOME = globalAgentHome;
		await rm(noUiCwd, { recursive: true, force: true });
	}

	const lazySddCwd = await tempWorkspace();
	const lazyAgentHome = join(lazySddCwd, "agent-home");
	process.env.JERO_PI_AGENT_HOME = lazyAgentHome;
	try {
		// This scenario must not inherit SDD definitions from earlier startup tests.
		const globalAgentHome = lazyAgentHome;
		await writeFile(
			globalModelsPath,
			JSON.stringify({ "sdd-apply": { model: "openai/gpt-5", thinking: "high" } }, null, 2),
		);
		const ctx = createCtx(lazySddCwd, true);
		const inputHook = hooks.get("input")[0];
		assert.deepEqual(
			await inputHook({ text: "你好，随便看看", source: "interactive" }, ctx),
			{ action: "continue" },
		);
		assert.deepEqual(
			await inputHook({ text: "what is SDD?", source: "interactive" }, ctx),
			{ action: "continue" },
		);
		assert.deepEqual(
			await inputHook({ text: "what can I do with SDD?", source: "interactive" }, ctx),
			{ action: "continue" },
		);
		assert.deepEqual(
			await inputHook({ text: "how do I use SDD?", source: "interactive" }, ctx),
			{ action: "continue" },
		);
		assert.deepEqual(
			await inputHook({ text: "Can I use SDD?", source: "interactive" }, ctx),
			{ action: "continue" },
		);
		assert.deepEqual(
			await inputHook({ text: "don't use sdd for this", source: "interactive" }, ctx),
			{ action: "continue" },
		);
		assert.deepEqual(
			await inputHook({ text: "暂时不用 SDD", source: "interactive" }, ctx),
			{ action: "continue" },
		);
		assert.deepEqual(
			await inputHook({ text: "let's not use SDD for this", source: "interactive" }, ctx),
			{ action: "continue" },
		);
		assert.deepEqual(
			await inputHook({ text: "never use SDD here", source: "interactive" }, ctx),
			{ action: "continue" },
		);
		assert.deepEqual(
			await inputHook({ text: "现在还不想用 SDD", source: "interactive" }, ctx),
			{ action: "continue" },
		);
		assert.deepEqual(
			await inputHook({ text: "I use SDD sometimes", source: "interactive" }, ctx),
			{ action: "continue" },
		);
		assert.deepEqual(
			await inputHook({ text: "I'm using SDD in another repo", source: "interactive" }, ctx),
			{ action: "continue" },
		);
		assert.equal(existsSync(join(lazySddCwd, ".pi", "agents", "sdd-apply.md")), false);
		assert.equal(existsSync(join(globalAgentHome, "agents", "sdd-apply.md")), false);

		assert.deepEqual(
			await inputHook({ text: "让我们用 SDD 吧", source: "interactive" }, ctx),
			{ action: "continue" },
		);
		assert.equal(existsSync(join(lazySddCwd, ".pi", "agents", "sdd-apply.md")), false);
		assert.equal(existsSync(join(lazySddCwd, ".pi", "chains", "sdd-full.chain.md")), false);
		assert.equal(existsSync(join(globalAgentHome, "agents", "sdd-apply.md")), true);
		assert.equal(existsSync(join(globalAgentHome, "agents", "sdd-status.md")), true);
		assert.equal(existsSync(join(globalAgentHome, "agents", "sdd-sync.md")), true);
		assert.equal(existsSync(join(globalAgentHome, "jero", "support", "sdd-status-contract.md")), true);
		assert.equal(existsSync(join(globalAgentHome, "chains", "sdd-full.chain.md")), true);
		assert.equal(ctx.ui.selections.length, 1, "first interactive SDD trigger confirms session suggestions");
		assert.match(ctx.ui.notifications.at(-1).message, /Preference source: explicit session choice/);
		assert.deepEqual(
			await inputHook({ text: "please use sdd for this change", source: "interactive" }, ctx),
			{ action: "continue" },
		);
		assert.equal(ctx.ui.selections.length, 1, "natural SDD triggers reuse confirmed session choices");
		assert.deepEqual(
			await inputHook({ text: "/sdd", source: "interactive" }, ctx),
			{ action: "continue" },
		);
		assert.deepEqual(
			await inputHook({ text: "/sdd plan", source: "interactive" }, ctx),
			{ action: "continue" },
		);
		assert.deepEqual(
			await inputHook({ text: "/sdd:plan", source: "interactive" }, ctx),
			{ action: "continue" },
		);
		assert.equal(ctx.ui.selections.length, 1, "slash SDD triggers reuse confirmed session choices");

		assert.deepEqual(
			await inputHook({ text: "/sdd-plan this change", source: "interactive" }, ctx),
			{ action: "continue" },
		);
		assert.equal(existsSync(join(lazySddCwd, ".pi", "agents", "sdd-apply.md")), false);
		assert.equal(existsSync(join(lazySddCwd, ".pi", "chains", "sdd-full.chain.md")), false);
		assert.equal(existsSync(join(globalAgentHome, "agents", "sdd-apply.md")), true);
		assert.equal(existsSync(join(globalAgentHome, "agents", "sdd-status.md")), true);
		assert.equal(existsSync(join(globalAgentHome, "agents", "sdd-sync.md")), true);
		assert.equal(existsSync(join(globalAgentHome, "jero", "support", "sdd-status-contract.md")), true);
		assert.equal(existsSync(join(globalAgentHome, "chains", "sdd-full.chain.md")), true);
		const globalSddApply = await readFile(
			join(globalAgentHome, "agents", "sdd-apply.md"),
			"utf8",
		);
		assert.match(globalSddApply, /model: openai\/gpt-5/);
		assert.match(globalSddApply, /thinking: high/);
		const lazySettingsPath = join(lazySddCwd, ".pi", "settings.json");
		if (existsSync(lazySettingsPath)) {
			const lazySettings = JSON.parse(await readFile(lazySettingsPath, "utf8"));
			assert.equal(
				lazySettings.subagents?.agentOverrides?.["sdd-apply"],
				undefined,
				"global SDD model routing must be materialized in agent frontmatter, not project settings overrides",
			);
		}
		assert.equal(ctx.ui.selections.length, 1, "automatic SDD routing reuses session confirmation");
		assert.match(ctx.ui.notifications.at(-1).message, /Preference source: explicit session choice/);
		await commands.get("jero:status").handler("", ctx);
		assert.match(ctx.ui.notifications.at(-1).message, /Global SDD assets stale: 0 file\(s\)/);
		assert.doesNotMatch(ctx.ui.notifications.at(-1).message, /install-sdd --force/);

		await inputHook({ text: "/sdd-plan another change", source: "interactive" }, ctx);
		assert.equal(ctx.ui.selections.length, 1, "resolved preflight must not prompt again in this session");
		const promptHook = hooks.get("before_agent_start")[0];
		const promptResult = await promptHook({ systemPrompt: "base" }, ctx);
		assert.match(promptResult.systemPrompt, /SDD Session Preflight/);
		assert.match(promptResult.systemPrompt, /Execution mode: auto/);
		const workerPromptResult = await promptHook(
			{ agentName: "worker", systemPrompt: "worker base" },
			ctx,
		);
		assert.equal(
			workerPromptResult.systemPrompt,
			"worker base",
			"non-SDD subagents must not receive parent harness or SDD preflight prompts",
		);
	} finally {
		process.env.JERO_PI_AGENT_HOME = globalAgentHome;
		await rm(lazySddCwd, { recursive: true, force: true });
		await rm(globalModelsPath, { force: true });
	}

	for (const [index, text] of ["/sdd", "/sdd plan", "/sdd:plan", "/sdd-plan this change", "/jero-sdd-continue", "/jero-sdd-status fix-rose --json", "/jero-sdd-init"].entries()) {
		const slashSddCwd = await tempWorkspace();
		try {
			const ctx = createCtx(slashSddCwd, true, `slash-sdd-session-${index}`);
			const inputHook = hooks.get("input")[0];
			assert.deepEqual(await inputHook({ text, source: "interactive" }, ctx), {
				action: "continue",
			});
			assert.equal(existsSync(join(slashSddCwd, ".pi", "agents", "sdd-apply.md")), false);
			assert.equal(existsSync(join(globalAgentHome, "agents", "sdd-apply.md")), true);
			assert.equal(ctx.ui.selections.length, 1, `${text} must confirm the fresh interactive session`);
		} finally {
			await rm(slashSddCwd, { recursive: true, force: true });
		}
	}

	const commandPreflightCwd = await tempWorkspace();
	try {
		const command = commands.get("jero:sdd-preflight");
		const interactive = createCtx(commandPreflightCwd, true, "explicit-command-regression");
		await command.handler("", interactive);
		const first = interactive.ui.selections.length;
		await command.handler("", interactive);
		const reused = interactive.ui.selections.length;
		const select = interactive.ui.select;
		interactive.ui.select = async (label, options) => {
			const value = await select(label, options);
			return label === "SDD execution mode" ? "interactive" : value;
		};
		interactive.ui.input = async () => "650";
		await command.handler("--edit", interactive);
		const edited = interactive.ui.selections.length;
		await command.handler("", interactive);
		assert.equal(interactive.ui.selections.length, edited, "edited choices also reuse without prompting");
		const saved = JSON.parse(await readFile(join(commandPreflightCwd, ".pi", "jero", "sdd-preflight.json"), "utf8"));
		assert.equal(saved.executionMode, "interactive");
		assert.equal(saved.reviewBudgetLines, 650);
		const rpc = createCtx(commandPreflightCwd, true, "explicit-command-rpc-regression");
		rpc.mode = "rpc";
		let rpcInputs = 0;
		rpc.ui.input = async (_label, placeholder) => { rpcInputs += 1; return placeholder; };
		await command.handler("", rpc);
		await command.handler("--edit", rpc);
		const noUi = createCtx(commandPreflightCwd, false, "explicit-command-no-ui-regression");
		let noUiInputs = 0;
		noUi.ui.input = async (_label, placeholder) => { noUiInputs += 1; return placeholder; };
		await command.handler("", noUi);
		await command.handler("--edit", noUi);
		assert.deepEqual({ first, reused, edited, rpc: rpc.ui.selections.length, noUi: noUi.ui.selections.length },
			{ first: 1, reused: 1, edited: 3, rpc: 0, noUi: 0 },
			"explicit command confirms once, reuses unless --edit, and never prompts headless callers");
		assert.deepEqual({ rpcInputs, noUiInputs }, { rpcInputs: 0, noUiInputs: 0 });
	} finally {
		await rm(commandPreflightCwd, { recursive: true, force: true });
	}

	const commandSddCwd = await tempWorkspace();
	try {
		const ctx = createCtx(commandSddCwd, true, "command-session");
		await commands.get("jero:sdd-preflight").handler("--edit", ctx);
		assert.equal(existsSync(join(commandSddCwd, ".pi", "agents", "sdd-apply.md")), false);
		assert.equal(existsSync(join(globalAgentHome, "agents", "sdd-apply.md")), true);
		assert.equal(ctx.ui.selections.length, 2, "explicit preflight prompts intentional choice fields");
		assert.equal(ctx.ui.selections.some(({ label }) => label === "SDD artifact store"), false, "one-option artifact store must be elided");
		assert.match(ctx.ui.notifications.at(-1).message, /Preference source: explicit session choice/);
		await commands.get("jero:sdd-preflight").handler("--edit", ctx);
		assert.equal(ctx.ui.selections.length, 4, "--edit remains an intentional re-prompt");
	} finally {
		await rm(commandSddCwd, { recursive: true, force: true });
	}

	const sddAgentGuardCwd = await tempWorkspace();
	try {
		const ctx = createCtx(sddAgentGuardCwd, true, "sdd-agent-guard-session");
		const promptHook = hooks.get("before_agent_start")[0];
		const promptResult = await promptHook(
			{
				systemPrompt: "You are the SDD proposal executor for Gentle AI.",
			},
			ctx,
		);
		assert.equal(existsSync(join(sddAgentGuardCwd, ".pi", "agents", "sdd-apply.md")), false);
		assert.equal(existsSync(join(sddAgentGuardCwd, ".pi", "chains", "sdd-full.chain.md")), false);
		assert.equal(existsSync(join(globalAgentHome, "agents", "sdd-apply.md")), true);
		assert.equal(existsSync(join(globalAgentHome, "chains", "sdd-full.chain.md")), true);
		assert.equal(ctx.ui.selections.length, 1, "fresh interactive SDD-agent startup requires confirmation");
		assert.match(promptResult.systemPrompt, /SDD Session Preflight/);
		assert.doesNotMatch(
			promptResult.systemPrompt,
			/el Jero Identity and Harness/,
			"SDD executor startup must not receive the parent orchestrator prompt",
		);
		assert.doesNotMatch(
			promptResult.systemPrompt,
			/Work Routing Ladder/,
			"SDD executor startup must not receive parent routing instructions",
		);
		assert.match(ctx.ui.notifications.at(-1).message, /SDD preflight complete/);

		const reusedPromptResult = await promptHook(
			{
				agentName: "sdd-tasks",
				systemPrompt: "You are the SDD tasks executor for Gentle AI.",
			},
			ctx,
		);
		assert.equal(ctx.ui.selections.length, 1, "SDD-agent startup reuses confirmed session preferences");
		assert.doesNotMatch(
			reusedPromptResult.systemPrompt,
			/el Jero Identity and Harness/,
			"named SDD executor startup must not receive the parent orchestrator prompt",
		);
	} finally {
		await rm(sddAgentGuardCwd, { recursive: true, force: true });
	}

	const unresolvedSddCwd = await tempWorkspace();
	try {
		const ctx = createCtx(unresolvedSddCwd, true, "unresolved-preflight-session");
		ctx.ui.select = async () => undefined;
		assert.deepEqual(await hooks.get("input")[0]({ text: "/sdd", source: "interactive" }, ctx), { action: "handled" });
		const result = await hooks.get("before_agent_start")[0]({ agentName: "sdd-explore", systemPrompt: "SDD executor" }, ctx);
		assert.match(result.systemPrompt, /SDD preflight unresolved/);
		assert.match(result.systemPrompt, /STOP: Do not initialize/);
		assert.doesNotMatch(result.systemPrompt, /## SDD Session Preflight/);
		assert.equal(existsSync(join(unresolvedSddCwd, "openspec", "config.yaml")), false);
		assert.equal(existsSync(join(unresolvedSddCwd, ".pi", "jero", "sdd-preflight.json")), false);
	} finally {
		await rm(unresolvedSddCwd, { recursive: true, force: true });
	}

	const noUiSddAgentCwd = await tempWorkspace();
	try {
		const ctx = createCtx(noUiSddAgentCwd, false, "no-ui-sdd-agent-session");
		const promptHook = hooks.get("before_agent_start")[0];
		const promptResult = await promptHook(
			{
				agentName: "sdd-proposal",
				systemPrompt: "You are the SDD proposal executor for Gentle AI.",
			},
			ctx,
		);
		assert.match(promptResult.systemPrompt, /SDD Session Preflight/);
		assert.match(promptResult.systemPrompt, /canonical defaults or persisted choices/);
		assert.equal(ctx.ui.selections.length, 0);
		assert.equal(existsSync(join(noUiSddAgentCwd, ".pi", "agents", "sdd-apply.md")), false);
		assert.equal(existsSync(join(globalAgentHome, "agents", "sdd-apply.md")), true);
	} finally {
		await rm(noUiSddAgentCwd, { recursive: true, force: true });
	}

	const invalidPreflightCwd = await tempWorkspace();
	try {
		await writeFile(globalModelsPath, "{ invalid json");
		const ctx = createCtx(invalidPreflightCwd, true, "invalid-preflight-session");
		await commands.get("jero:sdd-preflight").handler("", ctx);
		assert.equal(ctx.ui.notifications.at(-1).level, "warning");
		assert.match(ctx.ui.notifications.at(-1).message, /Model routing skipped:/);
		assert.match(ctx.ui.notifications.at(-1).message, /invalid JSON or not an object/);
	} finally {
		await rm(invalidPreflightCwd, { recursive: true, force: true });
		await rm(globalModelsPath, { force: true });
	}

	const engramSddCwd = await tempWorkspace();
	try {
		pi.setActiveTools(["read", "bash", "edit", "write", "mem_save"]);
		const ctx = createCtx(engramSddCwd, true, "engram-session");
		await commands.get("jero:sdd-preflight").handler("--edit", ctx);
		assert.deepEqual(ctx.ui.selections[1].options, ["openspec", "engram", "hybrid"]);
	} finally {
		pi.setActiveTools(["read", "bash", "edit", "write"]);
		await rm(engramSddCwd, { recursive: true, force: true });
	}

	// Issue #64: selecting engram as the artifact store must not cause
	// /gentle-sdd-init to create openspec/ or openspec/config.yaml.
	const engramSddInitCwd = await tempWorkspace();
	try {
		pi.setActiveTools(["read", "bash", "edit", "write", "mem_save"]);
		const ctx = createCtx(engramSddInitCwd, true, "engram-sdd-init-session");
		ctx.ui.select = async (label, options) => {
			if (label === "SDD artifact store") return "engram";
			return options[0];
		};
		await commands.get("jero:sdd-preflight").handler("--edit", ctx);
		await commands.get("jero-sdd-init").handler("", ctx);
		assert.equal(
			existsSync(join(engramSddInitCwd, "openspec")),
			false,
			"/gentle-sdd-init must not create openspec/ when artifactStore is engram",
		);
		assert.equal(
			existsSync(join(engramSddInitCwd, "openspec", "config.yaml")),
			false,
			"/gentle-sdd-init must not write openspec/config.yaml when artifactStore is engram",
		);
		assert.doesNotMatch(
			ctx.ui.notifications.at(-1).message,
			/Wrote openspec\/config\.yaml/,
			"/gentle-sdd-init must not announce openspec/config.yaml when artifactStore is engram",
		);
		assert.match(
			ctx.ui.notifications.at(-1).message,
			/SDD initialized for engram:/,
		);
		assert.equal(ctx.ui.notifications.at(-1).level, "info");
	} finally {
		pi.setActiveTools(["read", "bash", "edit", "write"]);
		await rm(engramSddInitCwd, { recursive: true, force: true });
	}

	// Issue #64 counterpart: the engram skip must stay narrow. Selecting both
	// still has to create the full openspec/ scaffold and write config.yaml,
	// so an over-broad skip is caught here instead of in the field.
	const bothSddInitCwd = await tempWorkspace();
	try {
		pi.setActiveTools(["read", "bash", "edit", "write", "mem_save"]);
		const ctx = createCtx(bothSddInitCwd, true, "both-sdd-init-session");
		ctx.ui.select = async (label, options) => {
			if (label === "SDD artifact store") return "hybrid";
			return options[0];
		};
		await commands.get("jero:sdd-preflight").handler("--edit", ctx);
		await commands.get("jero-sdd-init").handler("", ctx);
		assert.equal(
			existsSync(join(bothSddInitCwd, "openspec", "specs")),
			true,
			"/gentle-sdd-init must create openspec/specs when artifactStore is both",
		);
		assert.equal(
			existsSync(join(bothSddInitCwd, "openspec", "changes", "archive")),
			true,
			"/gentle-sdd-init must create openspec/changes/archive when artifactStore is both",
		);
		assert.equal(
			existsSync(join(bothSddInitCwd, "openspec", "config.yaml")),
			true,
			"/gentle-sdd-init must write openspec/config.yaml when artifactStore is both",
		);
		assert.match(
			ctx.ui.notifications.at(-1).message,
			/Wrote openspec\/config\.yaml/,
			"/gentle-sdd-init must announce openspec/config.yaml when artifactStore is both",
		);
		assert.equal(ctx.ui.notifications.at(-1).level, "info");
	} finally {
		pi.setActiveTools(["read", "bash", "edit", "write"]);
		await rm(bothSddInitCwd, { recursive: true, force: true });
	}

	const directEngramToolCwd = await tempWorkspace();
	try {
		pi.setActiveTools(["read", "bash", "edit", "write", "engram_mem_save"]);
		const ctx = createCtx(directEngramToolCwd, true, "direct-engram-session");
		await commands.get("jero:sdd-preflight").handler("", ctx);
		assert.equal(ctx.ui.selections.some(({ label }) => label === "SDD artifact store"), false, "unrecognized Engram capability must elide the artifact selector");
	} finally {
		pi.setActiveTools(["read", "bash", "edit", "write"]);
		await rm(directEngramToolCwd, { recursive: true, force: true });
	}

	for (const owner of ["sdd", "delegation", "review"]) {
		const fixture = await tempWorkspace();
		const agentHome = join(fixture, "agent-home");
		const representatives = {
			sdd: "sdd-apply.md",
			delegation: "jero-worker.md",
			review: "review-risk.md",
		};
		try {
			process.env.JERO_PI_AGENT_HOME = agentHome;
			process.env.JERO_PI_CONFIG_HOME = join(fixture, "config");
			await mkdir(process.env.JERO_PI_CONFIG_HOME);
			await writeFile(join(process.env.JERO_PI_CONFIG_HOME, "models.json"),
				JSON.stringify({ [representatives[owner].replace(/\.md$/, "")]: "test/installer-must-not-apply" }));
			const ctx = createCtx(fixture, true);
			const command = commands.get(`jero:install-${owner}`);
			assert.ok(command, `missing owner installer: ${owner}`);
			await command.handler("", ctx);
			for (const [candidate, name] of Object.entries(representatives)) {
				assert.equal(existsSync(join(agentHome, "agents", name)), candidate === owner,
					`${owner} installation must not install ${candidate} assets`);
			}
			assert.equal(existsSync(join(fixture, ".pi", "agents")), false);
			assert.match(ctx.ui.notifications.at(-1).message, /assets installed: \d+ agent\(s\), \d+ chain\(s\), \d+ support file\(s\)/);
			const selectedPath = join(agentHome, "agents", representatives[owner]);
			const packaged = await readFile(selectedPath, "utf8");
			assert.doesNotMatch(packaged, /test\/installer-must-not-apply/);
			const manifestPath = join(agentHome, "jero", "managed-assets.json");
			const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
			for (const [candidate, name] of Object.entries(representatives)) {
				const stale = `stale managed ${candidate}\n`;
				await writeFile(join(agentHome, "agents", name), stale);
				manifest.assets[`agents/${name}`] = sha256(stale);
			}
			await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
			await command.handler("", ctx);
			assert.equal(await readFile(selectedPath, "utf8"), `stale managed ${owner}\n`,
				"repair without --force must preserve existing files");
			await command.handler("--force", ctx);
			assert.equal(await readFile(selectedPath, "utf8"), packaged);
			const refreshed = JSON.parse(await readFile(manifestPath, "utf8"));
			for (const [candidate, name] of Object.entries(representatives)) {
				if (candidate === owner) continue;
				assert.equal(await readFile(join(agentHome, "agents", name), "utf8"), `stale managed ${candidate}\n`);
				assert.equal(refreshed.assets[`agents/${name}`], manifest.assets[`agents/${name}`]);
			}
			const userEdit = `${packaged}\nUser-owned instructions must survive.\n`;
			await writeFile(selectedPath, userEdit);
			await command.handler("--force", ctx);
			assert.equal(await readFile(selectedPath, "utf8"), userEdit);
			assert.equal(existsSync(join(agentHome, "subagents.json")), false,
				"owner installers must not apply model routing");
			await commands.get("jero:status").handler("", ctx);
			const label = owner === "sdd" ? "SDD" : owner;
			assert.ok(ctx.ui.notifications.at(-1).message.includes(`Global ${label} user overrides: 1 file(s)`));
		} finally {
			process.env.JERO_PI_CONFIG_HOME = globalConfigHome;
			process.env.JERO_PI_AGENT_HOME = globalAgentHome;
			await rm(fixture, { recursive: true, force: true });
		}
	}

	const repairFixture = await tempWorkspace();
	try {
		process.env.JERO_PI_AGENT_HOME = join(repairFixture, "agent-home");
		const ctx = createCtx(repairFixture, true);
		await commands.get("jero:install-sdd").handler("", ctx);
		for (const diagnostic of ["jero:status", "jero:doctor"]) {
			await commands.get(diagnostic).handler("", ctx);
			const message = ctx.ui.notifications.at(-1).message;
			assert.match(message, /\/jero:install-delegation --force/,
				`${diagnostic} must provide a repair for missing delegation assets`);
			assert.match(message, /\/jero:install-review --force/,
				`${diagnostic} must provide a repair for missing review assets`);
			assert.doesNotMatch(message, /install-sdd --force/);
		}
		const manifest = JSON.parse(await readFile(join(process.env.JERO_PI_AGENT_HOME, "jero", "managed-assets.json"), "utf8"));
		for (const key of Object.keys(manifest.assets)) {
			await rm(join(process.env.JERO_PI_AGENT_HOME, key));
		}
		for (const diagnostic of ["jero:status", "jero:doctor"]) {
			await commands.get(diagnostic).handler("", ctx);
			assert.match(ctx.ui.notifications.at(-1).message, /Global SDD assets stale: [1-9]\d* file\(s\).*install-sdd --force/);
			assert.doesNotMatch(ctx.ui.notifications.at(-1).message, /on demand/,
				"managed installation evidence must survive missing SDD files");
		}
	} finally {
		process.env.JERO_PI_AGENT_HOME = globalAgentHome;
		await rm(repairFixture, { recursive: true, force: true });
	}

	for (const trigger of ["jero:sdd-preflight", "jero-sdd-init"]) {
		const fixture = await tempWorkspace();
		const agentHome = join(fixture, "agent-home");
		try {
			process.env.JERO_PI_AGENT_HOME = agentHome;
			const command = commands.get(trigger);
			await command.handler("", createCtx(fixture, true, `${trigger}-install`));
			assert.equal(existsSync(join(agentHome, "agents", "jero-worker.md")), false,
				`${trigger} must not install delegation assets`);
			assert.equal(existsSync(join(agentHome, "agents", "review-risk.md")), false,
				`${trigger} must not install review assets`);
			const manifestPath = join(agentHome, "jero", "managed-assets.json");
			const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
			const managedKeys = [
				"agents/sdd-apply.md",
				"chains/sdd-full.chain.md",
				"jero/support/sdd-status-contract.md",
			];
			const originals = new Map();
			for (const key of managedKeys) {
				originals.set(key, await readFile(join(agentHome, key), "utf8"));
			}
			const untouchedKeys = ["agents/jero-worker.md", "agents/review-risk.md"];
			for (const key of [...managedKeys, ...untouchedKeys]) {
				await writeFile(join(agentHome, key), `stale ${key}\n`);
				manifest.assets[key] = sha256(`stale ${key}\n`);
			}
			await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
			const userPath = join(agentHome, "agents", "sdd-spec.md");
			const userEdit = `${await readFile(userPath, "utf8")}\nUser-owned instructions.\n`;
			await writeFile(userPath, userEdit);
			const projectOverride = join(fixture, ".pi", "agents", "sdd-apply.md");
			await mkdir(dirname(projectOverride), { recursive: true });
			await writeFile(projectOverride, "Project override must survive.\n");
			await command.handler("", createCtx(fixture, true, `${trigger}-refresh`));
			for (const key of managedKeys) {
				assert.equal(await readFile(join(agentHome, key), "utf8"), originals.get(key),
					`${trigger} must refresh managed ${key} on demand`);
			}
			const refreshed = JSON.parse(await readFile(manifestPath, "utf8"));
			for (const key of untouchedKeys) {
				assert.equal(await readFile(join(agentHome, key), "utf8"), `stale ${key}\n`);
				assert.equal(refreshed.assets[key], manifest.assets[key]);
			}
			assert.equal(await readFile(userPath, "utf8"), userEdit);
			assert.equal(await readFile(projectOverride, "utf8"), "Project override must survive.\n");
		} finally {
			process.env.JERO_PI_AGENT_HOME = globalAgentHome;
			await rm(fixture, { recursive: true, force: true });
		}
	}

	const installCwd = await tempWorkspace();
	try {
		const ctx = createCtx(installCwd, true);
		await commands.get("jero:install-sdd").handler("", ctx);
		assert.match(ctx.ui.notifications.at(-1).message, /Global Jero SDD assets installed/);
		assert.equal(existsSync(join(installCwd, ".pi", "agents", "sdd-apply.md")), false);
		assert.equal(existsSync(join(globalAgentHome, "agents", "sdd-apply.md")), true);
		assert.equal(existsSync(join(globalAgentHome, "agents", "sdd-status.md")), true);
		assert.equal(existsSync(join(globalAgentHome, "jero", "support", "sdd-status-contract.md")), true);
	} finally {
		await rm(installCwd, { recursive: true, force: true });
	}

	const staleAssetsCwd = await tempWorkspace();
	const previousAgentHome = process.env.JERO_PI_AGENT_HOME;
	Object.assign(env, { noUiCwd, startupAgentHome, lazySddCwd, lazyAgentHome, commandPreflightCwd, commandSddCwd, sddAgentGuardCwd, unresolvedSddCwd, noUiSddAgentCwd, invalidPreflightCwd, engramSddCwd, engramSddInitCwd, bothSddInitCwd, directEngramToolCwd, repairFixture, installCwd, staleAssetsCwd, previousAgentHome });
}
