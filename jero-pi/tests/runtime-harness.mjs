// runtime-harness 入口：环境 setup 与场景段的顺序编排。
// 常量/助手在 runtime-harness-support.mjs；场景段在 runtime-harness.partN.mjs。
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

import { EXPECTED_BANNER_COMMANDS, EXPECTED_COMMANDS, EXTENSIONS, FORBIDDEN_COMPAT_COMMANDS, ROOT, createCtx, createJeroAiExtension, createPi, createUi, gitSync, loadExtensions, readAgentDefinition, restoreWorkspaceWritePermissions, sha256, tempWorkspace } from "./runtime-harness-support.mjs";
import { part1 } from "./runtime-harness.part1.mjs";
import { part2 } from "./runtime-harness.part2.mjs";
import { part3 } from "./runtime-harness.part3.mjs";

async function run() {
	const globalConfigHome = await tempWorkspace();
	const globalAgentHome = await tempWorkspace();
	const ambientTestAssetsDir = await tempWorkspace();
	process.env.JERO_PI_CONFIG_HOME = globalConfigHome;
	process.env.JERO_PI_AGENT_HOME = globalAgentHome;
	process.env.JERO_PI_TEST_ASSETS_DIR = ambientTestAssetsDir;
	const globalModelsPath = join(globalConfigHome, "models.json");
	const globalSubagentsPath = join(globalAgentHome, "subagents.json");
	const { pi, hooks, commands, flags, tools, emittedEvents } = createPi();
	await loadExtensions(pi);
	const env = { globalConfigHome, globalAgentHome, ambientTestAssetsDir, globalModelsPath, globalSubagentsPath, pi, hooks, commands, flags, tools, emittedEvents };
	await part1(env);
	await part2(env);
	await part3(env);
}


run().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});

