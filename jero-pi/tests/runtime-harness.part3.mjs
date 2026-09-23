// runtime-harness 场景第 3/3 段：自 run() 机械平移（语义零改动）。
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

export async function part3(env) {
	const { globalConfigHome, globalAgentHome, ambientTestAssetsDir, globalModelsPath, globalSubagentsPath, pi, hooks, commands, flags, tools, emittedEvents, discovered, delegationDetail, promptCwd, toolCwd, candidateDriftCwd, bannerCwd, cancelPickerCwd, noUiCwd, startupAgentHome, lazySddCwd, lazyAgentHome, commandPreflightCwd, commandSddCwd, sddAgentGuardCwd, unresolvedSddCwd, noUiSddAgentCwd, invalidPreflightCwd, engramSddCwd, engramSddInitCwd, bothSddInitCwd, directEngramToolCwd, repairFixture, installCwd, staleAssetsCwd, previousAgentHome } = env;

	const previousHome = process.env.HOME;
	const previousUserProfile = process.env.USERPROFILE;
	try {
		const diagnosticsAgentHome = join(staleAssetsCwd, "agent-home");
		const diagnosticsHome = staleAssetsCwd;
		process.env.JERO_PI_AGENT_HOME = diagnosticsAgentHome;
		process.env.HOME = diagnosticsHome;
		process.env.USERPROFILE = diagnosticsHome;
		for (const [dir, name] of [
			[join(diagnosticsAgentHome, "subagents"), "sdd-apply.md"],
			[join(diagnosticsHome, ".agents"), "sdd-archive.md"],
			[join(staleAssetsCwd, ".agents"), "sdd-design.md"],
			[join(staleAssetsCwd, ".pi", "agents"), "sdd-spec.md"],
			[join(staleAssetsCwd, ".pi", "subagents"), "sdd-sync.md"],
		]) {
			await mkdir(dir, { recursive: true });
			await writeFile(
				join(dir, name),
				`---\nname: ${name.replace(/\.md$/, "")}\n---\nintentional SDD override\n`,
			);
		}
		await mkdir(join(diagnosticsAgentHome, "subagents", "nested"), { recursive: true });
		await mkdir(join(diagnosticsAgentHome, "agents", "nested"), { recursive: true });
		await mkdir(join(staleAssetsCwd, ".agents", "skills", "ignored"), { recursive: true });
		await writeFile(
			join(diagnosticsAgentHome, "subagents", "nested", "renamed-agent.md"),
			"---\nname: sdd-apply\n---\nintentional nested SDD override\n",
		);
		await writeFile(
			join(diagnosticsAgentHome, "agents", "nested", "managed-copy.md"),
			"---\nname: sdd-apply\n---\npackage-managed root is excluded\n",
		);
		await writeFile(
			join(staleAssetsCwd, ".agents", "skills", "ignored", "SKILL.md"),
			"---\nname: sdd-apply\n---\nskills are not agent definitions\n",
		);
		await mkdir(join(staleAssetsCwd, ".pi", "chains"), { recursive: true });
		await mkdir(join(staleAssetsCwd, ".pi", "jero", "support"), { recursive: true });
		await writeFile(join(staleAssetsCwd, ".pi", "chains", "sdd-full.chain.md"), "stale chain\n");
		await writeFile(join(staleAssetsCwd, ".pi", "jero", "support", "sdd-status-contract.md"), "stale status contract\n");
		const ctx = createCtx(staleAssetsCwd, true);
		await commands.get("jero:status").handler("", ctx);
		assert.match(ctx.ui.notifications.at(-1).message, /Active SDD agent overrides: 6 file\(s\)/);
		assert.match(ctx.ui.notifications.at(-1).message, /active non-builtin SDD agents shadow package assets/);
		await commands.get("jero:doctor").handler("", ctx);
		assert.match(ctx.ui.notifications.at(-1).message, /el Jero doctor/);
		assert.match(ctx.ui.notifications.at(-1).message, /Sensitive-path guard active/);
		pi.setActiveTools([{ name: "engram.mem_save" }]);
		await commands.get("jero:doctor").handler("", ctx);
		assert.match(ctx.ui.notifications.at(-1).message, /Engram memory tools active/);
		pi.setActiveTools([{ name: "engram_mem_save" }]);
		await commands.get("jero:doctor").handler("", ctx);
		assert.match(ctx.ui.notifications.at(-1).message, /Engram memory tools not active in this session/);
		pi.setActiveTools(["read", "bash", "edit", "write"]);
	} finally {
		if (previousAgentHome === undefined) delete process.env.JERO_PI_AGENT_HOME;
		else process.env.JERO_PI_AGENT_HOME = previousAgentHome;
		if (previousHome === undefined) delete process.env.HOME;
		else process.env.HOME = previousHome;
		if (previousUserProfile === undefined) delete process.env.USERPROFILE;
		else process.env.USERPROFILE = previousUserProfile;
		await rm(staleAssetsCwd, { recursive: true, force: true });
	}

	const sddCwd = await tempWorkspace();
	try {
		const ctx = createCtx(sddCwd, true);
		await commands.get("jero-sdd-init").handler("", ctx);
		assert.equal(existsSync(join(sddCwd, ".pi", "agents", "sdd-apply.md")), false);
		assert.equal(existsSync(join(sddCwd, ".pi", "chains", "sdd-full.chain.md")), false);
		assert.equal(existsSync(join(globalAgentHome, "agents", "sdd-apply.md")), true);
		assert.equal(existsSync(join(globalAgentHome, "agents", "sdd-status.md")), true);
		assert.equal(existsSync(join(globalAgentHome, "agents", "sdd-sync.md")), true);
		assert.equal(existsSync(join(globalAgentHome, "jero", "support", "sdd-status-contract.md")), true);
		assert.equal(existsSync(join(globalAgentHome, "chains", "sdd-full.chain.md")), true);
		assert.equal(ctx.ui.selections.length, 1, "sdd-init confirms session preflight before project initialization");
		assert.match(ctx.ui.notifications[1].message, /SDD preflight complete/);
		assert.match(ctx.ui.notifications.at(-1).message, /Wrote openspec\/config\.yaml/);
		const initializedConfig = await readFile(join(sddCwd, "openspec", "config.yaml"), "utf8");
		const explore = await hooks.get("before_agent_start")[0]({ agentName: "sdd-explore", systemPrompt: "You are the SDD explore executor for Gentle AI." }, ctx);
		assert.match(explore.systemPrompt, /explicit current-session choices/);
		assert.equal(ctx.ui.selections.length, 1, "confirmation -> sdd-init -> explore must reuse the resolved preflight");
		const nextSession = createCtx(sddCwd, true, "cold-start-with-saved-preferences");
		await hooks.get("input")[0]({ text: "/sdd", source: "interactive" }, nextSession);
		assert.equal(nextSession.ui.selections.length, 1, "saved preferences still require confirmation in a new session");
		assert.equal(await readFile(join(sddCwd, "openspec", "config.yaml"), "utf8"), initializedConfig, "new session confirmation must not reset project initialization");

		await commands.get("jero:sdd-preflight").handler("--edit", ctx);
		assert.equal(ctx.ui.selections.length, 3, "--edit permits changes after confirmed sdd-init");
	} finally {
		await rm(sddCwd, { recursive: true, force: true });
	}

	const invalidSddInitCwd = await tempWorkspace();
	try {
		await mkdir(join(invalidSddInitCwd, ".pi", "agents"), { recursive: true });
		await writeFile(
			join(invalidSddInitCwd, ".pi", "agents", "sdd-apply.md"),
			`---\nname: sdd-apply\ndescription: Apply phase\nmodel: keep/provider-model\n---\n\nbody\n`,
		);
		await writeFile(globalModelsPath, "{ invalid json");
		const ctx = createCtx(invalidSddInitCwd, true, "invalid-sdd-init-session");
		await commands.get("jero-sdd-init").handler("", ctx);
		assert.equal(ctx.ui.notifications[1].level, "warning");
		assert.match(ctx.ui.notifications[1].message, /Model routing skipped:/);
		assert.match(ctx.ui.notifications[1].message, /models\.json/);
		assert.match(ctx.ui.notifications.at(-1).message, /Wrote openspec\/config\.yaml/);
		const preservedAgent = await readFile(
			join(invalidSddInitCwd, ".pi", "agents", "sdd-apply.md"),
			"utf8",
		);
		assert.match(preservedAgent, /model: keep\/provider-model/);
	} finally {
		await rm(invalidSddInitCwd, { recursive: true, force: true });
		await rm(globalModelsPath, { force: true });
	}

	const legacyModelsCwd = await tempWorkspace();
	try {
		await mkdir(join(legacyModelsCwd, ".pi", "agents"), { recursive: true });
		await mkdir(join(legacyModelsCwd, ".pi", "jero"), { recursive: true });
		await writeFile(
			join(legacyModelsCwd, ".pi", "agents", "sdd-apply.md"),
			`---\nname: sdd-apply\ndescription: Apply phase\n---\n\nbody\n`,
		);
		await writeFile(
			join(legacyModelsCwd, ".pi", "jero", "models.json"),
			JSON.stringify({ "sdd-apply": "legacy/provider-model" }, null, 2),
		);
		const legacyCtx = createCtx(legacyModelsCwd, true);
		await hooks.get("session_start")[0]({ reason: "startup" }, legacyCtx);
		const legacyAgent = await readFile(
			join(legacyModelsCwd, ".pi", "agents", "sdd-apply.md"),
			"utf8",
		);
		assert.match(legacyAgent, /model: legacy\/provider-model/);
		await writeFile(
			globalModelsPath,
			JSON.stringify({ "sdd-apply": "global/provider-model" }, null, 2),
		);
		await hooks.get("session_start")[0]({ reason: "startup" }, legacyCtx);
		const globalWinsAgent = await readFile(
			join(legacyModelsCwd, ".pi", "agents", "sdd-apply.md"),
			"utf8",
		);
		assert.match(globalWinsAgent, /model: global\/provider-model/);
		assert.doesNotMatch(globalWinsAgent, /model: legacy\/provider-model/);
		await writeFile(globalModelsPath, "{ invalid json");
		await hooks.get("session_start")[0]({ reason: "startup" }, legacyCtx);
		const invalidGlobalSkippedAgent = await readFile(
			join(legacyModelsCwd, ".pi", "agents", "sdd-apply.md"),
			"utf8",
		);
		assert.match(invalidGlobalSkippedAgent, /model: global\/provider-model/);
		assert.doesNotMatch(invalidGlobalSkippedAgent, /model: legacy\/provider-model/);
		assert.equal(legacyCtx.ui.notifications.at(-1).level, "warning");
		assert.match(legacyCtx.ui.notifications.at(-1).message, /已跳过模型配置/);
		let modelPanelOpened = false;
		legacyCtx.ui.custom = () => {
			modelPanelOpened = true;
			return Promise.resolve({ type: "save", config: {} });
		};
		await commands.get("jero:models").handler("", legacyCtx);
		assert.equal(modelPanelOpened, false);
		assert.equal(await readFile(globalModelsPath, "utf8"), "{ invalid json");
		assert.equal(legacyCtx.ui.notifications.at(-1).level, "warning");
		assert.match(legacyCtx.ui.notifications.at(-1).message, /无法打开模型配置/);
		await writeFile(globalModelsPath, JSON.stringify({}, null, 2));
		await hooks.get("session_start")[0]({ reason: "startup" }, legacyCtx);
		const emptyGlobalPreservesAgent = await readFile(
			join(legacyModelsCwd, ".pi", "agents", "sdd-apply.md"),
			"utf8",
		);
		assert.match(emptyGlobalPreservesAgent, /model: global\/provider-model/);
		const emptyGlobalPreservesProfiles = JSON.parse(
			await readFile(join(legacyModelsCwd, ".pi", "subagents.json"), "utf8"),
		);
		assert.equal(
			emptyGlobalPreservesProfiles.model_profiles["sdd-apply"].model,
			"global/provider-model",
		);
		await writeFile(
			globalModelsPath,
			JSON.stringify({ "sdd-apply": { model: "bad\nmodel: injected" } }, null, 2),
		);
		await hooks.get("session_start")[0]({ reason: "startup" }, legacyCtx);
		const invalidEntryPreservesAgent = await readFile(
			join(legacyModelsCwd, ".pi", "agents", "sdd-apply.md"),
			"utf8",
		);
		assert.match(invalidEntryPreservesAgent, /model: global\/provider-model/);
		const invalidEntryPreservesProfiles = JSON.parse(
			await readFile(join(legacyModelsCwd, ".pi", "subagents.json"), "utf8"),
		);
		assert.equal(
			invalidEntryPreservesProfiles.model_profiles["sdd-apply"].model,
			"global/provider-model",
		);
		await writeFile(globalModelsPath, JSON.stringify({ "sdd-apply": {} }, null, 2));
		await hooks.get("session_start")[0]({ reason: "startup" }, legacyCtx);
		const explicitInheritClearsAgent = await readFile(
			join(legacyModelsCwd, ".pi", "agents", "sdd-apply.md"),
			"utf8",
		);
		assert.doesNotMatch(explicitInheritClearsAgent, /model:/);
		const explicitInheritClearsProfiles = JSON.parse(
			await readFile(join(legacyModelsCwd, ".pi", "subagents.json"), "utf8"),
		);
		assert.equal(explicitInheritClearsProfiles.model_profiles, undefined);
	} finally {
		await rm(legacyModelsCwd, { recursive: true, force: true });
		await rm(globalModelsPath, { force: true });
	}

	const staleSettingsOnlyCwd = await tempWorkspace();
	try {
		await writeFile(
			globalSubagentsPath,
			JSON.stringify(
				{
					model_profiles: {
						worker: { model: "stale/model", effort: "high" },
					},
				},
				null,
				2,
			),
		);
		await writeFile(globalModelsPath, JSON.stringify({ worker: {} }, null, 2));
		await hooks.get("session_start")[0]({ reason: "startup" }, createCtx(staleSettingsOnlyCwd, true));
		const staleOnlyClearedProfiles = JSON.parse(
			await readFile(globalSubagentsPath, "utf8"),
		);
		assert.equal(staleOnlyClearedProfiles.model_profiles, undefined);
	} finally {
		await rm(staleSettingsOnlyCwd, { recursive: true, force: true });
		await rm(globalModelsPath, { force: true });
		await rm(globalSubagentsPath, { force: true });
	}

	const legacySettingsMigrationCwd = await tempWorkspace();
	try {
		await mkdir(join(legacySettingsMigrationCwd, ".pi", "subagents"), { recursive: true });
		await mkdir(join(globalAgentHome, "subagents"), { recursive: true });
		await writeFile(
			join(legacySettingsMigrationCwd, ".pi", "subagents", "local-worker.md"),
			`---\nname: local-worker\ndescription: Local worker\n---\n`,
		);
		await writeFile(
			join(legacySettingsMigrationCwd, ".pi", "subagents", "local-new.md"),
			`---\nname: local-new\ndescription: Local new worker\n---\n`,
		);
		await writeFile(
			join(globalAgentHome, "subagents", "global-worker.md"),
			`---\nname: global-worker\ndescription: Global worker\n---\n`,
		);
		await writeFile(
			join(globalAgentHome, "subagents", "global-new.md"),
			`---\nname: global-new\ndescription: Global new worker\n---\n`,
		);
		await writeFile(
			join(legacySettingsMigrationCwd, ".pi", "subagents.json"),
			JSON.stringify({ model_profiles: { "local-worker": { model: "existing/local", effort: "medium" } } }, null, 2),
		);
		await writeFile(
			globalSubagentsPath,
			JSON.stringify({ model_profiles: { "global-worker": { model: "existing/global", effort: "medium" } } }, null, 2),
		);
		await writeFile(
			join(legacySettingsMigrationCwd, ".pi", "settings.json"),
			JSON.stringify(
				{
					theme: "keep-me",
					subagents: {
						history: "keep-me-too",
						agentOverrides: {
							"local-worker": {},
							"local-new": { model: "local/new-model", thinking: "minimal" },
							"global-worker": {},
							"global-new": { model: "global/new-model", thinking: "xhigh" },
							"unknown-project": { model: "unknown/project-model", thinking: "low" },
						},
					},
				},
				null,
				2,
			),
		);
		await hooks.get("session_start")[0]({ reason: "startup" }, createCtx(legacySettingsMigrationCwd, true));
		const migratedProjectProfiles = JSON.parse(
			await readFile(join(legacySettingsMigrationCwd, ".pi", "subagents.json"), "utf8"),
		);
		assert.equal(migratedProjectProfiles.model_profiles["local-worker"].model, "existing/local");
		assert.equal(migratedProjectProfiles.model_profiles["local-worker"].effort, "medium");
		assert.equal(migratedProjectProfiles.model_profiles["local-new"].model, "local/new-model");
		assert.equal(migratedProjectProfiles.model_profiles["local-new"].effort, "minimal");
		assert.equal(migratedProjectProfiles.model_profiles["unknown-project"].model, "unknown/project-model");
		assert.equal(migratedProjectProfiles.model_profiles["unknown-project"].effort, "low");
		const migratedGlobalProfiles = JSON.parse(await readFile(globalSubagentsPath, "utf8"));
		assert.equal(migratedGlobalProfiles.model_profiles["global-worker"].model, "existing/global");
		assert.equal(migratedGlobalProfiles.model_profiles["global-worker"].effort, "medium");
		assert.equal(migratedGlobalProfiles.model_profiles["global-new"].model, "global/new-model");
		assert.equal(migratedGlobalProfiles.model_profiles["global-new"].effort, "xhigh");
		const migratedSettings = JSON.parse(
			await readFile(join(legacySettingsMigrationCwd, ".pi", "settings.json"), "utf8"),
		);
		assert.equal(migratedSettings.theme, "keep-me");
		assert.equal(migratedSettings.subagents.history, "keep-me-too");
		assert.equal(migratedSettings.subagents.agentOverrides, undefined);
	} finally {
		await rm(legacySettingsMigrationCwd, { recursive: true, force: true });
		await rm(globalSubagentsPath, { force: true });
	}

	const invalidMigrationTargetCwd = await tempWorkspace();
	try {
		await mkdir(join(invalidMigrationTargetCwd, ".pi", "subagents"), { recursive: true });
		await writeFile(
			join(invalidMigrationTargetCwd, ".pi", "subagents", "local-bad.md"),
			`---\nname: local-bad\ndescription: Local bad target\n---\n`,
		);
		await mkdir(join(globalAgentHome, "subagents"), { recursive: true });
		await writeFile(
			join(globalAgentHome, "subagents", "global-bad.md"),
			`---\nname: global-bad\ndescription: Global bad target\n---\n`,
		);
		await writeFile(join(invalidMigrationTargetCwd, ".pi", "subagents.json"), "{ invalid json");
		await writeFile(globalSubagentsPath, "{ invalid global json");
		await writeFile(
			join(invalidMigrationTargetCwd, ".pi", "settings.json"),
			JSON.stringify({ subagents: { agentOverrides: { "local-bad": { model: "legacy/model", thinking: "low" }, "global-bad": { model: "legacy/global-model", thinking: "high" } } } }, null, 2),
		);
		await hooks.get("session_start")[0]({ reason: "startup" }, createCtx(invalidMigrationTargetCwd, true));
		assert.equal(await readFile(join(invalidMigrationTargetCwd, ".pi", "subagents.json"), "utf8"), "{ invalid json");
		assert.equal(await readFile(globalSubagentsPath, "utf8"), "{ invalid global json");
		const preservedLegacySettings = JSON.parse(
			await readFile(join(invalidMigrationTargetCwd, ".pi", "settings.json"), "utf8"),
		);
		assert.equal(preservedLegacySettings.subagents.agentOverrides["local-bad"].model, "legacy/model");
		assert.equal(preservedLegacySettings.subagents.agentOverrides["global-bad"].model, "legacy/global-model");
	} finally {
		await rm(invalidMigrationTargetCwd, { recursive: true, force: true });
		await rm(globalSubagentsPath, { force: true });
	}

	const modelsCwd = await tempWorkspace();
	try {
		await mkdir(join(modelsCwd, ".pi", "agents"), { recursive: true });
		await mkdir(join(modelsCwd, ".pi", "subagents"), { recursive: true });
		await mkdir(join(globalAgentHome, "subagents"), { recursive: true });
		await mkdir(
			join(modelsCwd, ".pi", "npm", "node_modules", "pi-subagents-j0k3r", "agents"),
			{ recursive: true },
		);
		await mkdir(
			join(modelsCwd, ".pi", "npm", "node_modules", "pi-subagents", "agents"),
			{ recursive: true },
		);
		await writeFile(
			join(
				modelsCwd,
				".pi",
				"npm",
				"node_modules",
				"pi-subagents-j0k3r",
				"agents",
				"worker.md",
			),
			`---\nname: worker\ndescription: Builtin worker\n---\n`,
		);
		await writeFile(
			join(modelsCwd, ".pi", "agents", "worker.md"),
			`---\nname: worker\ndescription: Project worker\nmodel: existing/project-worker\nthinking: high\n---\n`,
		);
		await writeFile(
			join(modelsCwd, ".pi", "subagents", "worker.md"),
			`---\nname: worker\ndescription: Project subagents worker\nmodel: existing/project-subagent-worker\nthinking: medium\n---\n`,
		);
		await writeFile(
			join(
				modelsCwd,
				".pi",
				"npm",
				"node_modules",
				"pi-subagents",
				"agents",
				"researcher.md",
			),
			`---\nname: researcher\ndescription: Legacy builtin researcher\n---\n`,
		);
		await writeFile(
			join(modelsCwd, ".pi", "agents", "sdd-apply.md"),
			`---\nname: sdd-apply\ndescription: Apply phase\n---\n\nbody\n`,
		);
		await writeFile(
			join(modelsCwd, ".pi", "subagents", "project-special.md"),
			`---\nname: project-special\ndescription: Project subagent dir fixture\n---\n\nbody\n`,
		);
		await writeFile(
			join(globalAgentHome, "subagents", "global-special.md"),
			`---\nname: global-special\ndescription: Global subagent dir fixture\n---\n\nbody\n`,
		);
		for (let i = 0; i < 25; i++) {
			const name = `large-agent-${String(i).padStart(2, "0")}`;
			await writeFile(
				join(modelsCwd, ".pi", "agents", `${name}.md`),
				`---\nname: ${name}\ndescription: Scroll fixture\n---\n`,
			);
		}
		await writeFile(
			join(modelsCwd, ".pi", "agents", "escape-agent.md"),
			`---\nname: evil\u001b]52;c;Zm9v\u0007-agent\ndescription: Escape fixture\n---\n`,
		);
		await writeFile(
			join(modelsCwd, ".pi", "subagents.json"),
			JSON.stringify(
				{
					model_profiles: {
						worker: { model: "existing/model", effort: "high" },
					},
				},
				null,
				2,
			),
		);
		await writeFile(globalModelsPath, JSON.stringify({}, null, 2));
		await hooks.get("session_start")[0]({ reason: "startup" }, createCtx(modelsCwd, true));
		const preservedProfiles = JSON.parse(
			await readFile(join(modelsCwd, ".pi", "subagents.json"), "utf8"),
		);
		assert.equal(
			preservedProfiles.model_profiles.worker.model,
			"existing/model",
		);
		assert.equal(preservedProfiles.model_profiles.worker.effort, "high");
		const preservedProjectWorker = await readFile(
			join(modelsCwd, ".pi", "agents", "worker.md"),
			"utf8",
		);
		assert.match(preservedProjectWorker, /model: existing\/project-worker/);
		assert.match(preservedProjectWorker, /thinking: high/);
		const preservedProjectSubagentWorker = await readFile(
			join(modelsCwd, ".pi", "subagents", "worker.md"),
			"utf8",
		);
		assert.match(preservedProjectSubagentWorker, /model: existing\/project-subagent-worker/);
		assert.match(preservedProjectSubagentWorker, /thinking: medium/);
		await writeFile(globalModelsPath, JSON.stringify({ worker: {} }, null, 2));
		await hooks.get("session_start")[0]({ reason: "startup" }, createCtx(modelsCwd, true));
		const clearedProfiles = JSON.parse(
			await readFile(join(modelsCwd, ".pi", "subagents.json"), "utf8"),
		);
		assert.equal(clearedProfiles.model_profiles, undefined);
		const unchangedProjectWorker = await readFile(
			join(modelsCwd, ".pi", "agents", "worker.md"),
			"utf8",
		);
		assert.match(unchangedProjectWorker, /model: existing\/project-worker/);
		assert.match(unchangedProjectWorker, /thinking: high/);
		const clearedProjectSubagentWorker = await readFile(
			join(modelsCwd, ".pi", "subagents", "worker.md"),
			"utf8",
		);
		assert.doesNotMatch(clearedProjectSubagentWorker, /model:/);
		assert.doesNotMatch(clearedProjectSubagentWorker, /thinking:/);

		await writeFile(
			globalModelsPath,
			JSON.stringify({ "sdd-apply": "openai/gpt-5" }, null, 2),
		);

		const ctx = createCtx(modelsCwd, true);
		ctx.modelRegistry.getAvailable = async () => [
			{ provider: "safe", id: "model" },
			{ provider: "evil\u001b]52;c;Zm9v\u0007", id: "model" },
		];
		ctx.ui.custom = (factory) => {
			const panel = factory(null, null, null, () => undefined);
			const initialLines = panel.render(120);
			const plainInitialLines = initialLines.map(stripAnsi);
			assert.ok(
				plainInitialLines[0].startsWith("╭") && plainInitialLines.at(-1).startsWith("╰"),
				"model panel should render inside a bordered card",
			);
			assert.ok(
				initialLines.length <= 20,
				"long model agent list should fit within a 24-row terminal 85% overlay budget",
			);
			assert.ok(
				plainInitialLines.some((line) => /↓ \d+ more agent\(s\)/.test(line)),
				"long model agent list should render a down-scroll indicator",
			);
			assert.ok(
				plainInitialLines.some((line) => line.includes("Continue")),
				"long model agent list should keep Continue visible",
			);
			assert.doesNotMatch(
				initialLines.join("\n"),
				/\u001b\]|\u0007/,
				"model panel must strip unsafe terminal control sequences from agent labels",
			);
			assert.doesNotMatch(
				plainInitialLines.join("\n"),
				/\]52|\[31m/,
				"model panel must strip user-provided terminal escapes from labels",
			);
			for (let i = 0; i < 20; i++) panel.handleInput("j");
			const scrolledLines = panel.render(120);
			const plainScrolledLines = scrolledLines.map(stripAnsi);
			assert.ok(
				scrolledLines.length <= 20,
				"scrolled model agent list should stay within the overlay height budget",
			);
			assert.ok(
				plainScrolledLines.some((line) => /↑ \d+ more agent\(s\)/.test(line)),
				"long model agent list should render an up-scroll indicator after navigation",
			);
			panel.handleInput("G");
			const bottomLines = panel.render(120);
			const plainBottomLines = bottomLines.map(stripAnsi);
			assert.ok(
				bottomLines.length <= 20,
				"bottom model agent list should stay within the overlay height budget",
			);
			assert.ok(
				plainBottomLines.some((line) => line.includes("▸ ← Back")),
				"G should jump to the Back action",
			);
			return Promise.resolve({ type: "cancel" });
		};
		await commands.get("jero:models").handler("", ctx);

		await hooks.get("session_start")[0]({ reason: "startup" }, ctx);
		const legacyAppliedAgent = await readFile(
			join(modelsCwd, ".pi", "agents", "sdd-apply.md"),
			"utf8",
		);
		assert.match(legacyAppliedAgent, /model: openai\/gpt-5/);
		assert.doesNotMatch(legacyAppliedAgent, /thinking:/);

		ctx.ui.custom = () =>
			Promise.resolve({
				type: "save",
				config: {
					"sdd-apply": { model: "openai/gpt-5", thinking: "high" },
					worker: { model: "openai/gpt-5-mini", thinking: "low" },
					researcher: { model: "openai/gpt-5-mini", thinking: "low" },
					"project-special": { model: "openai/gpt-5-mini", thinking: "low" },
					"global-special": { model: "openai/gpt-5-mini", thinking: "low" },
				},
			});
		await commands.get("jero:models").handler("", ctx);
		assert.doesNotMatch(
			ctx.ui.notifications.at(-1).message,
			/[\u001b\u0007]/,
			"model save notification must strip terminal control sequences from discovered agent names",
		);

		const savedConfig = JSON.parse(
			await readFile(globalModelsPath, "utf8"),
		);
		assert.deepEqual(savedConfig["sdd-apply"], {
			model: "openai/gpt-5",
			thinking: "high",
		});
		assert.equal(
			existsSync(join(modelsCwd, ".pi", "gentle-ai", "models.json")),
			false,
			"/jero:models must save model routing globally, not per project",
		);

		const applyAgent = await readFile(
			join(modelsCwd, ".pi", "agents", "sdd-apply.md"),
			"utf8",
		);
		assert.match(applyAgent, /model: openai\/gpt-5/);
		assert.match(applyAgent, /thinking: high/);

		const projectSubagents = JSON.parse(
			await readFile(join(modelsCwd, ".pi", "subagents.json"), "utf8"),
		);
		assert.equal(
			projectSubagents.model_profiles["sdd-apply"].model,
			"openai/gpt-5",
		);
		assert.equal(projectSubagents.model_profiles["sdd-apply"].effort, "high");
		assert.equal(
			projectSubagents.model_profiles.worker.model,
			"openai/gpt-5-mini",
		);
		assert.equal(projectSubagents.model_profiles.worker.effort, "low");
		const routedProjectSubagentWorker = await readFile(
			join(modelsCwd, ".pi", "subagents", "worker.md"),
			"utf8",
		);
		assert.match(routedProjectSubagentWorker, /model: openai\/gpt-5-mini/);
		assert.match(routedProjectSubagentWorker, /thinking: low/);
		const shadowedProjectAgentWorker = await readFile(
			join(modelsCwd, ".pi", "agents", "worker.md"),
			"utf8",
		);
		assert.match(shadowedProjectAgentWorker, /model: existing\/project-worker/);
		assert.match(shadowedProjectAgentWorker, /thinking: high/);
		assert.equal(
			projectSubagents.model_profiles["project-special"].model,
			"openai/gpt-5-mini",
		);
		assert.equal(projectSubagents.model_profiles["project-special"].effort, "low");
		const globalSubagents = JSON.parse(await readFile(globalSubagentsPath, "utf8"));
		assert.equal(
			globalSubagents.model_profiles.researcher.model,
			"openai/gpt-5-mini",
		);
		assert.equal(globalSubagents.model_profiles.researcher.effort, "low");
		assert.equal(
			globalSubagents.model_profiles["global-special"].model,
			"openai/gpt-5-mini",
		);
		assert.equal(globalSubagents.model_profiles["global-special"].effort, "low");
		assert.equal(existsSync(join(modelsCwd, ".pi", "settings.json")), false);

		const kittyE = "\x1b[101u";
		assert.notEqual(kittyE, "e");
		assert.equal(matchesKey(kittyE, "e"), true);

		let customPanelCalls = 0;
		ctx.ui.input = async () => "custom/provider-model";
		ctx.ui.custom = (factory) =>
			new Promise((resolve) => {
				customPanelCalls += 1;
				const panel = factory(null, null, null, resolve);
				if (customPanelCalls === 1) {
					panel.handleInput(kittyE); // effort picker for all agents
					for (let i = 0; i < 4; i++) panel.handleInput("j"); // medium
					panel.handleInput("\r");
					panel.handleInput("c"); // custom model from the same unsaved draft
					return;
				}
				panel.handleInput("\u0013"); // ctrl+s saves the draft reopened after custom model input
			});
		await commands.get("jero:models").handler("", ctx);

		const customSavedConfig = JSON.parse(
			await readFile(globalModelsPath, "utf8"),
		);
		assert.deepEqual(customSavedConfig["sdd-apply"], {
			model: "custom/provider-model",
			thinking: "medium",
		});

		let invalidCustomCalls = 0;
		ctx.ui.input = async () => "bad\nmodel: injected";
		ctx.ui.custom = (factory) =>
			new Promise((resolve) => {
				invalidCustomCalls += 1;
				const panel = factory(null, null, null, resolve);
				if (invalidCustomCalls === 1) {
					panel.handleInput("c");
					return;
				}
				panel.handleInput("\u001b");
			});
		await commands.get("jero:models").handler("", ctx);
		assert.match(
			ctx.ui.notifications.at(-1).message,
			/自定义模型 id 必须是单行/,
		);
		const rejectedCustomConfig = JSON.parse(
			await readFile(globalModelsPath, "utf8"),
		);
		assert.deepEqual(rejectedCustomConfig["sdd-apply"], {
			model: "custom/provider-model",
			thinking: "medium",
		});

		let exportPanelCalls = 0;
		ctx.ui.custom = () => {
			exportPanelCalls += 1;
			return Promise.resolve(exportPanelCalls === 1 ? { type: "export", config: {} } : { type: "cancel" });
		};
		await commands.get("jero:models").handler("", ctx);
		const exported = JSON.parse(await readFile(join(globalConfigHome, "models.export.json"), "utf8"));
		assert.equal(exported.kind, "jero.agent_model_routing");
		assert.equal(exported.version, 1);
		assert.deepEqual(exported.agents["sdd-apply"], {
			model: "custom/provider-model",
			thinking: "medium",
		});

		await writeFile(
			join(globalConfigHome, "models.export.json"),
			JSON.stringify({
				kind: "jero.agent_model_routing",
				version: 1,
				agents: { "sdd-apply": { model: "restore/provider", thinking: "high" } },
			}, null, 2),
		);
		let restorePanelCalls = 0;
		ctx.ui.confirm = async () => true;
		ctx.ui.custom = () => {
			restorePanelCalls += 1;
			return Promise.resolve(restorePanelCalls === 1 ? { type: "restore", config: {} } : { type: "cancel" });
		};
		await commands.get("jero:models").handler("", ctx);
		const restoredConfig = JSON.parse(await readFile(globalModelsPath, "utf8"));
		assert.deepEqual(restoredConfig["sdd-apply"], {
			model: "restore/provider",
			thinking: "high",
		});
		const restoredAgent = await readFile(join(modelsCwd, ".pi", "agents", "sdd-apply.md"), "utf8");
		assert.match(restoredAgent, /model: restore\/provider/);
		assert.match(restoredAgent, /thinking: high/);

		// issue #286: `thinking: "max"` must survive save normalization and
		// reach both subagents.json (effort) and agent frontmatter (thinking).
		ctx.ui.custom = () =>
			Promise.resolve({
				type: "save",
				config: { "sdd-apply": { model: "openai/gpt-5", thinking: "max" } },
			});
		await commands.get("jero:models").handler("", ctx);
		const maxSavedConfig = JSON.parse(await readFile(globalModelsPath, "utf8"));
		assert.equal(maxSavedConfig["sdd-apply"].thinking, "max");
		const maxSubagents = JSON.parse(
			await readFile(join(modelsCwd, ".pi", "subagents.json"), "utf8"),
		);
		assert.equal(maxSubagents.model_profiles["sdd-apply"].effort, "max");
		const maxApplyAgent = await readFile(
			join(modelsCwd, ".pi", "agents", "sdd-apply.md"),
			"utf8",
		);
		assert.match(maxApplyAgent, /thinking: max/);

		// issue #286: effort picker must offer `max` after `xhigh` and save it.
		let maxPickerCalls = 0;
		ctx.ui.custom = (factory) =>
			new Promise((resolve) => {
				maxPickerCalls += 1;
				const panel = factory(null, null, null, resolve);
				if (maxPickerCalls === 1) {
					panel.handleInput(kittyE); // open effort picker (set-all row)
					for (let i = 0; i < 7; i++) panel.handleInput("j"); // max
					panel.handleInput("\r");
					panel.handleInput("\u0013"); // ctrl+s saves the draft
					return;
				}
			});
		await commands.get("jero:models").handler("", ctx);
		const pickerMaxConfig = JSON.parse(await readFile(globalModelsPath, "utf8"));
		assert.equal(pickerMaxConfig["sdd-apply"].thinking, "max");
	} finally {
		await rm(modelsCwd, { recursive: true, force: true });
		await rm(globalModelsPath, { force: true });
		await rm(globalSubagentsPath, { force: true });
	}

	const registryCwd = await tempWorkspace();
	try {
		const ctx = createCtx(registryCwd, true);
		await commands.get("skill-registry:refresh").handler("", ctx);
		assert.match(ctx.ui.notifications.at(-1).message, /Skill registry:/);
	} finally {
		await rm(registryCwd, { recursive: true, force: true });
	}
	Object.assign(env, { previousHome, previousUserProfile, sddCwd, invalidSddInitCwd, legacyModelsCwd, staleSettingsOnlyCwd, legacySettingsMigrationCwd, invalidMigrationTargetCwd, modelsCwd, registryCwd });
}
