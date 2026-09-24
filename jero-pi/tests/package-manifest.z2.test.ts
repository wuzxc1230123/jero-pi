import { contractFields, nestedContractFields, readTextContract } from "./package-manifest-shared.ts";
// package-manifest 测试第 2 段（共 2 段；夹具在 package-manifest-shared.ts）。
// 机械平移自原 package-manifest.test.ts，语义零改动。

import { default as assert } from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { default as test } from "node:test";
import { fileURLToPath } from "node:url";
import { applyModelConfig } from "../extensions/jero-ai.ts";
import { resolveGentlePiAgentHome } from "../lib/agent-home.ts";
import { getPackageAssetOwner, installPackageAssets, installSddAssets, type PackageAssetOwner } from "../lib/sdd-preflight.ts";
import {
	type LegacyManagedAssetsManifest, MANAGED_EXEMPLAR_FILE, MANAGED_EXEMPLAR_TOOLS,
	type ManagedAssetsManifest, PACKAGE_ROOT, type PackageJson, type PackageJsonPiManifest,
	readPackageJson, RETIRED_ADVERSARIAL_AGENTS, RETIRED_REFUTER_FILE, REVIEW_RISK_FILE, sha256,
	V013_MANAGED_ASSETS, V013_REVIEW_RISK_FIXTURE, V014_MANAGED_ASSETS, V014_REVIEW_RISK_FIXTURE
} from "./package-manifest-shared.ts";
import { assertWorkerFallbackRouting, readAgentDefinition, readAgentFrontmatter, readMarkdownSection } from "./package-manifest-shared.ts";

test("first forced sync migrates untouched v0.13 assets, preserves routing, and owns new assets", async () => {
	const temporaryAgentHome = mkdtempSync(join(tmpdir(), "gentle-pi-v013-upgrade-"));
	const previousAgentHome = process.env.JERO_PI_AGENT_HOME;
	const installedReviewRisk = join(temporaryAgentHome, "agents", REVIEW_RISK_FILE);
	const installedExemplar = join(temporaryAgentHome, "agents", MANAGED_EXEMPLAR_FILE);
	const managedAssetsManifest = join(
		temporaryAgentHome,
		"jero",
		"managed-assets.json",
	);
	const legacySource = readFileSync(V013_REVIEW_RISK_FIXTURE, "utf8");
	const routedLegacySource = legacySource.replace(
		"description: R1 Risk reviewer — security, privilege boundaries, data exposure, dependency risks, and merge-blocking vulnerabilities.\n",
		"description: R1 Risk reviewer — security, privilege boundaries, data exposure, dependency risks, and merge-blocking vulnerabilities.\nmodel: private/legacy-model\nthinking: xhigh\n",
	);

	try {
		process.env.JERO_PI_AGENT_HOME = temporaryAgentHome;
		mkdirSync(dirname(installedReviewRisk), { recursive: true });
		writeFileSync(installedReviewRisk, routedLegacySource);
		assert.equal(existsSync(managedAssetsManifest), false, "v0.13 had no ownership manifest");

		await installSddAssets(PACKAGE_ROOT, true);

		const migrated = readFileSync(installedReviewRisk, "utf8");
		const currentPackageSource = readFileSync(
			join(PACKAGE_ROOT, "assets", "agents", REVIEW_RISK_FILE),
			"utf8",
		);
		assert.notEqual(migrated, routedLegacySource, "the stale v0.13 review contract must refresh");
		assert.match(migrated, /^model: private\/legacy-model$/m);
		assert.match(migrated, /^thinking: xhigh$/m);
		assert.equal(
			migrated.replace(/^model: .*\n|^thinking: .*\n/gm, ""),
			currentPackageSource,
			"migration must update the package body without losing user routing",
		);
		assert.equal(
			readFileSync(installedExemplar, "utf8"),
			readFileSync(join(PACKAGE_ROOT, "assets", "agents", MANAGED_EXEMPLAR_FILE), "utf8"),
			"an asset missing from v0.13 must install normally",
		);

		const manifest = JSON.parse(
			readFileSync(managedAssetsManifest, "utf8"),
		) as ManagedAssetsManifest;
		assert.equal(manifest.assets[`agents/${REVIEW_RISK_FILE}`], sha256(migrated));
		assert.equal(
			manifest.assets[`agents/${MANAGED_EXEMPLAR_FILE}`],
			sha256(readFileSync(installedExemplar, "utf8")),
		);

		const userEditedMigration = migrated.replace(
			"对所提供的 `initial_review_tree` 恰好运行一次本被选评审视角。",
			"对所提供的 `initial_review_tree` 恰好运行一次本被选评审视角，并附用户撰写的备注。",
		);
		assert.notEqual(userEditedMigration, migrated, "the fixture must exercise post-migration drift");
		writeFileSync(installedReviewRisk, userEditedMigration);
		await installSddAssets(PACKAGE_ROOT, true);
		assert.deepEqual(
			readFileSync(installedReviewRisk),
			Buffer.from(userEditedMigration),
			"exact full-content ownership must protect edits made after migration",
		);
		const postEditManifest = JSON.parse(
			readFileSync(managedAssetsManifest, "utf8"),
		) as ManagedAssetsManifest;
		assert.equal(postEditManifest.assets[`agents/${REVIEW_RISK_FILE}`], undefined);
	} finally {
		if (previousAgentHome === undefined) {
			delete process.env.JERO_PI_AGENT_HOME;
		} else {
			process.env.JERO_PI_AGENT_HOME = previousAgentHome;
		}
		rmSync(temporaryAgentHome, { recursive: true, force: true });
	}
});

test("first forced sync migrates untouched v0.14 review contracts and preserves routing", async () => {
	const temporaryAgentHome = mkdtempSync(join(tmpdir(), "gentle-pi-v014-upgrade-"));
	const previousAgentHome = process.env.JERO_PI_AGENT_HOME;
	const installedReviewRisk = join(temporaryAgentHome, "agents", REVIEW_RISK_FILE);
	const legacySource = readFileSync(V014_REVIEW_RISK_FIXTURE, "utf8");
	const routedLegacySource = legacySource.replace(
		"description: R1 Risk reviewer — security, privilege boundaries, data exposure, dependency risks, and merge-blocking vulnerabilities.\n",
		"description: R1 Risk reviewer — security, privilege boundaries, data exposure, dependency risks, and merge-blocking vulnerabilities.\nmodel: private/v014-model\nthinking: high\n",
	);

	try {
		process.env.JERO_PI_AGENT_HOME = temporaryAgentHome;
		mkdirSync(dirname(installedReviewRisk), { recursive: true });
		writeFileSync(installedReviewRisk, routedLegacySource);

		await installSddAssets(PACKAGE_ROOT, true);

		const migrated = readFileSync(installedReviewRisk, "utf8");
		assert.notEqual(migrated, routedLegacySource);
		assert.match(migrated, /^model: private\/v014-model$/m);
		assert.match(migrated, /^thinking: high$/m);
		assert.match(migrated, /initial_review_tree/);
		assert.doesNotMatch(migrated, /Full 4R runs at most two complete sweeps per lens/);
		const currentPackageSource = readFileSync(
			join(PACKAGE_ROOT, "assets", "agents", REVIEW_RISK_FILE),
			"utf8",
		);
		assert.equal(
			migrated.replace(/^model: .*\n|^thinking: .*\n/gm, ""),
			currentPackageSource,
		);
	} finally {
		if (previousAgentHome === undefined) delete process.env.JERO_PI_AGENT_HOME;
		else process.env.JERO_PI_AGENT_HOME = previousAgentHome;
		rmSync(temporaryAgentHome, { recursive: true, force: true });
	}
});

test("first forced sync preserves a body-edited v0.13 asset byte-for-byte", async () => {
	const temporaryAgentHome = mkdtempSync(join(tmpdir(), "gentle-pi-v013-edited-"));
	const previousAgentHome = process.env.JERO_PI_AGENT_HOME;
	const installedReviewRisk = join(temporaryAgentHome, "agents", REVIEW_RISK_FILE);
	const editedLegacySource = readFileSync(V013_REVIEW_RISK_FIXTURE, "utf8").replace(
		"Find security risks; do not fix them.",
		"Find security risks; preserve this user-authored body edit.",
	);

	try {
		process.env.JERO_PI_AGENT_HOME = temporaryAgentHome;
		mkdirSync(dirname(installedReviewRisk), { recursive: true });
		writeFileSync(installedReviewRisk, editedLegacySource);

		await installSddAssets(PACKAGE_ROOT, true);

		assert.deepEqual(readFileSync(installedReviewRisk), Buffer.from(editedLegacySource));
		const manifest = JSON.parse(
			readFileSync(join(temporaryAgentHome, "jero", "managed-assets.json"), "utf8"),
		) as ManagedAssetsManifest;
		assert.equal(manifest.assets[`agents/${REVIEW_RISK_FILE}`], undefined);
	} finally {
		if (previousAgentHome === undefined) {
			delete process.env.JERO_PI_AGENT_HOME;
		} else {
			process.env.JERO_PI_AGENT_HOME = previousAgentHome;
		}
		rmSync(temporaryAgentHome, { recursive: true, force: true });
	}
});

test("forced package installation refreshes an asset recorded as package-managed", async () => {
	const temporaryAgentHome = mkdtempSync(join(tmpdir(), "gentle-pi-malformed-refuter-"));
	const previousAgentHome = process.env.JERO_PI_AGENT_HOME;
	const installedExemplar = join(temporaryAgentHome, "agents", MANAGED_EXEMPLAR_FILE);
	const managedAssetsManifest = join(
		temporaryAgentHome,
		"jero",
		"managed-assets.json",
	);
	const previousPackageSource =
		"---\nname: jero-explore\ntools:\n  - read\n  - bash\n---\nprevious package version\n";
	const routedPreviousPackageSource = previousPackageSource.replace(
		"name: jero-explore\n",
		"name: jero-explore\nmodel: openai/previous-package\nthinking: high\n",
	);

	try {
		process.env.JERO_PI_AGENT_HOME = temporaryAgentHome;
		await installSddAssets(PACKAGE_ROOT, true);
		assert.ok(existsSync(installedExemplar), "a missing package asset must install");
		assert.ok(
			existsSync(managedAssetsManifest),
			"the installer must record ownership independently from the filename",
		);

		const manifest = JSON.parse(
			readFileSync(managedAssetsManifest, "utf8"),
		) as ManagedAssetsManifest;
		writeFileSync(installedExemplar, routedPreviousPackageSource);
		manifest.assets[`agents/${MANAGED_EXEMPLAR_FILE}`] = sha256(
			routedPreviousPackageSource,
		);
		writeFileSync(managedAssetsManifest, JSON.stringify(manifest, null, 2));

		await installSddAssets(PACKAGE_ROOT, true);

		const refreshed = readAgentDefinition(installedExemplar);
		assert.deepEqual(refreshed.tools, MANAGED_EXEMPLAR_TOOLS);
		assert.doesNotMatch(refreshed.source, /^  - bash$/m);
	} finally {
		if (previousAgentHome === undefined) {
			delete process.env.JERO_PI_AGENT_HOME;
		} else {
			process.env.JERO_PI_AGENT_HOME = previousAgentHome;
		}
		rmSync(temporaryAgentHome, { recursive: true, force: true });
	}
});

export async function assertManagedAgentUserEditIsPreserved(
	editLabel: string,
	editSource: (source: string) => string,
): Promise<void> {
	const temporaryAgentHome = mkdtempSync(join(tmpdir(), "gentle-pi-managed-edit-"));
	const previousAgentHome = process.env.JERO_PI_AGENT_HOME;
	const installedExemplar = join(temporaryAgentHome, "agents", MANAGED_EXEMPLAR_FILE);
	const managedAssetsManifest = join(
		temporaryAgentHome,
		"jero",
		"managed-assets.json",
	);

	try {
		process.env.JERO_PI_AGENT_HOME = temporaryAgentHome;
		await installSddAssets(PACKAGE_ROOT, true);
		const installedSource = readFileSync(installedExemplar, "utf8");
		const userEditedSource = editSource(installedSource);
		assert.notEqual(userEditedSource, installedSource, `${editLabel} must alter the asset`);
		writeFileSync(installedExemplar, userEditedSource);

		await installSddAssets(PACKAGE_ROOT, true);

		assert.deepEqual(
			readFileSync(installedExemplar),
			Buffer.from(userEditedSource),
			`${editLabel} must invalidate ownership and survive force refresh byte-for-byte`,
		);
		const manifest = JSON.parse(
			readFileSync(managedAssetsManifest, "utf8"),
		) as ManagedAssetsManifest;
		assert.equal(
			manifest.assets[`agents/${MANAGED_EXEMPLAR_FILE}`],
			undefined,
			`${editLabel} must remove package ownership`,
		);
	} finally {
		if (previousAgentHome === undefined) {
			delete process.env.JERO_PI_AGENT_HOME;
		} else {
			process.env.JERO_PI_AGENT_HOME = previousAgentHome;
		}
		rmSync(temporaryAgentHome, { recursive: true, force: true });
	}
}

test("forced package installation preserves a model-only edit to a managed agent", async () => {
	await assertManagedAgentUserEditIsPreserved("a model-only user edit", (source) =>
		source.replace(
			"name: jero-explore\n",
			"name: jero-explore\nmodel: private/user-model\n",
		),
	);
});

test("forced package installation preserves a thinking-only edit to a managed agent", async () => {
	await assertManagedAgentUserEditIsPreserved("a thinking-only user edit", (source) =>
		source.replace(
			"name: jero-explore\n",
			"name: jero-explore\nthinking: xhigh\n",
		),
	);
});

test("forced package installation preserves an ordinary body edit to a managed agent", async () => {
	await assertManagedAgentUserEditIsPreserved("an ordinary body edit", (source) =>
		source.replace(
			"你是通用非 SDD 工作的只读探索者。",
			"保留这条用户撰写的正文修改。你是通用非 SDD 工作的只读探索者。",
		),
	);
});

test("package model assignment keeps only package-managed agents owned", async () => {
	const temporaryAgentHome = mkdtempSync(join(tmpdir(), "gentle-pi-model-ownership-"));
	const previousAgentHome = process.env.JERO_PI_AGENT_HOME;
	const installedExemplar = join(temporaryAgentHome, "agents", MANAGED_EXEMPLAR_FILE);
	const userAgent = join(temporaryAgentHome, "agents", "user-router.md");
	const managedAssetsManifest = join(
		temporaryAgentHome,
		"jero",
		"managed-assets.json",
	);
	const userAgentSource = "---\nname: user-router\n---\nuser-owned body\n";

	try {
		process.env.JERO_PI_AGENT_HOME = temporaryAgentHome;
		await installSddAssets(PACKAGE_ROOT, true);
		writeFileSync(userAgent, userAgentSource);

		await applyModelConfig(PACKAGE_ROOT, {
			"jero-explore": { model: "package/selected-model", thinking: "high" },
			"user-router": { model: "user/selected-model", thinking: "low" },
		});

		const routedExemplar = readFileSync(installedExemplar, "utf8");
		const routedUserAgent = readFileSync(userAgent, "utf8");
		assert.match(routedExemplar, /^model: package\/selected-model$/m);
		assert.match(routedExemplar, /^thinking: high$/m);
		assert.match(routedUserAgent, /^model: user\/selected-model$/m);
		assert.match(routedUserAgent, /^thinking: low$/m);

		const manifest = JSON.parse(
			readFileSync(managedAssetsManifest, "utf8"),
		) as ManagedAssetsManifest;
		assert.equal(
			manifest.assets[`agents/${MANAGED_EXEMPLAR_FILE}`],
			sha256(routedExemplar),
			"package-controlled routing must update the managed asset hash coherently",
		);
		assert.equal(
			manifest.assets["agents/user-router.md"],
			undefined,
			"routing an arbitrary user agent must not relabel it as package-owned",
		);

		await installSddAssets(PACKAGE_ROOT, true);
		assert.equal(
			readFileSync(installedExemplar, "utf8"),
			readFileSync(join(PACKAGE_ROOT, "assets", "agents", MANAGED_EXEMPLAR_FILE), "utf8"),
			"a routed package-managed agent must remain eligible for package refresh",
		);
		assert.equal(
			readFileSync(userAgent, "utf8"),
			routedUserAgent,
			"package refresh must preserve the routed arbitrary user agent",
		);
	} finally {
		if (previousAgentHome === undefined) {
			delete process.env.JERO_PI_AGENT_HOME;
		} else {
			process.env.JERO_PI_AGENT_HOME = previousAgentHome;
		}
		rmSync(temporaryAgentHome, { recursive: true, force: true });
	}
});

test("jd-fix-agent packaged allowlist includes write tools", () => {
	const frontmatter = readAgentFrontmatter(
		join(PACKAGE_ROOT, "assets", "agents", "jd-fix-agent.md"),
	);

	for (const tool of ["read", "edit", "write", "bash"]) {
		assert.match(frontmatter, new RegExp(`^  - ${tool}$`, "m"));
	}
});

test("sdd-explore packages its CodeGraph-enabled exploration allowlist", () => {
	const agentPath = join(PACKAGE_ROOT, "assets", "agents", "sdd-explore.md");
	const { name, tools } = readAgentDefinition(agentPath);

	assert.equal(name, "sdd-explore");
	assert.deepEqual(tools, [
		"read",
		"grep",
		"find",
		"fovea_focus",
		"fovea_sketch",
		"fovea_dwell",
		"edit",
		"write",
		"mem_save",
	]);
});

test("jero-worker packages the exact scoped writer contract", () => {
	const agentsDir = join(PACKAGE_ROOT, "assets", "agents");
	const agentPath = join(agentsDir, "jero-worker.md");
	assert.ok(existsSync(agentPath), "gentle-pi must package jero-worker.md");
	for (const genericName of ["worker.md", "generic-writer.md"]) {
		assert.ok(
			!existsSync(join(agentsDir, genericName)),
			`the package-owned writer must not use collision-prone ${genericName}`,
		);
	}

	const { name, source, tools } = readAgentDefinition(agentPath);
	assert.equal(name, "jero-worker");
	assert.deepEqual(tools, [
		"read",
		"grep",
		"find",
		"edit",
		"write",
		"bash",
		"mem_save",
	]);
	assert.ok(
		tools.every((tool) => !tool.startsWith("subagent_")),
		"a subagent must not be able to delegate",
	);
	assert.ok(!tools.includes("glob"), "the unsupported glob tool must not return");

	const interactionContract = readMarkdownSection(source, "交互契约");
	assert.doesNotMatch(
		interactionContract,
		/```text/,
		"the interaction section must not define a second normative envelope",
	);
	assert.match(interactionContract, /停止编辑/);
	assert.match(interactionContract, /按返回契约返回完整 schema/);
	assert.match(interactionContract, /`status: interaction_required`/);
	assert.match(interactionContract, /嵌套 `interaction_required` 载荷/);

	const returnContract = readTextContract(source, "返回契约");
	assert.deepEqual(contractFields(returnContract), [
		"status",
		"summary",
		"files_changed",
		"tdd_evidence",
		"validation",
		"risks",
		"review_focus",
		"skill_resolution",
		"interaction_required",
	]);
	assert.deepEqual(nestedContractFields(returnContract, "interaction_required"), [
		"question",
		"reason",
		"options",
		"unblock_response",
	]);
	assert.match(
		returnContract,
		/skill_resolution: paths-injected \| paths-invalid \| none/,
	);
	assert.equal(
		(source.match(/```text/g) ?? []).length,
		1,
		"the Return contract must be the single authoritative full handoff schema",
	);
	assert.doesNotMatch(source, /fallback-(?:registry|path)/);

	const returnContractSection = readMarkdownSection(source, "返回契约");
	assert.match(
		returnContractSection,
		/仅当父会话注入了一个或多个确切技能路径且有任一路径无法读取时，使用 `skill_resolution: paths-invalid`/,
	);
	assert.match(
		returnContractSection,
		/使用 `skill_resolution: paths-invalid` 时，保持 `status: blocked`/,
	);

	const contextContract = readMarkdownSection(source, "上下文契约");
	assert.match(contextContract, /父会话显式列出的既有未跟踪目标/);
	assert.match(contextContract, /被委托任务所需的新文件/);
	assert.match(contextContract, /人类可以批准或收窄的推导候选集/);
	assert.match(contextContract, /绝不是让人类自行编写路径或 glob 的开放式请求/);
	assert.match(interactionContract, /人类可以批准、拒绝或从中选择的封闭集合/);
	assert.match(interactionContract, /绝不让人类以自由文本编写路径、glob、标识符或命令/);

	const implementationRules = readMarkdownSection(source, "实现规则");
	assert.match(implementationRules, /仅对非人类的技术阻塞使用 `blocked`/);

	const toolSafety = readMarkdownSection(source, "工具安全");
	assert.match(toolSafety, /敏感文件/);
	assert.match(toolSafety, /暂存、提交、推送、发布/);

	const memorySafety = readMarkdownSection(source, "记忆安全");
	assert.match(memorySafety, /密钥、凭据、个人数据/);
	assert.match(memorySafety, /原始的不可信仓库/);

	const testDiscipline = readMarkdownSection(source, "测试纪律");
	assert.match(testDiscipline, /严格 TDD 激活/);
	assert.match(testDiscipline, /not active/);
	assert.match(
		testDiscipline,
		/宽泛套件、构建、格式化工具或 lint 仅在父会话显式授权时才可运行。/,
	);
	assert.match(testDiscipline, /保持每条命令精确，并在执行前核实其范围。/);
	assert.doesNotMatch(testDiscipline, /clearly required by the repository contract/);
});

test("installSddAssets installs jero-worker with a loader-compatible scoped identity", async () => {
	const temporaryAgentHome = mkdtempSync(join(tmpdir(), "gentle-pi-agent-home-"));
	const previousAgentHome = process.env.JERO_PI_AGENT_HOME;

	try {
		process.env.JERO_PI_AGENT_HOME = temporaryAgentHome;
		await installSddAssets(PACKAGE_ROOT, true);

		const installedAgentsDir = join(temporaryAgentHome, "agents");
		const installedAgentPath = join(installedAgentsDir, "jero-worker.md");
		assert.ok(existsSync(installedAgentPath), "the production installer must install jero-worker.md");
		for (const genericName of ["worker.md", "generic-writer.md"]) {
			assert.ok(
				!existsSync(join(installedAgentsDir, genericName)),
				`the installer must not create collision-prone ${genericName}`,
			);
		}

		const { name, source, tools } = readAgentDefinition(installedAgentPath);
		const normalizedRuntimeIdentity = name.trim().toLowerCase();
		assert.equal(normalizedRuntimeIdentity, "jero-worker");
		assert.deepEqual(tools, [
			"read",
			"grep",
			"find",
			"edit",
			"write",
			"bash",
			"mem_save",
		]);
		assert.doesNotMatch(
			readAgentFrontmatter(installedAgentPath),
			/^package\s*:/m,
			"package frontmatter must not alter external loader identity",
		);
		assert.doesNotMatch(source, /^name:\s*(?:worker|generic-writer)$/m);
	} finally {
		if (previousAgentHome === undefined) {
			delete process.env.JERO_PI_AGENT_HOME;
		} else {
			process.env.JERO_PI_AGENT_HOME = previousAgentHome;
		}
		rmSync(temporaryAgentHome, { recursive: true, force: true });
	}

	assert.equal(process.env.JERO_PI_AGENT_HOME, previousAgentHome);
	assert.ok(
		!existsSync(temporaryAgentHome),
		"the integration test must delete only its temporary agent home",
	);
});

test("agent home resolver centralizes Gentle and Pi agent-dir precedence", () => {
	const explicitGentleHome = mkdtempSync(join(tmpdir(), "gentle-pi-resolver-explicit-"));
	const piAgentDir = mkdtempSync(join(tmpdir(), "gentle-pi-resolver-pi-dir-"));

	try {
		assert.equal(
			resolveGentlePiAgentHome({
				JERO_PI_AGENT_HOME: explicitGentleHome,
				PI_CODING_AGENT_DIR: piAgentDir,
			}),
			explicitGentleHome,
		);
		assert.equal(resolveGentlePiAgentHome({ PI_CODING_AGENT_DIR: piAgentDir }), piAgentDir);
		assert.equal(resolveGentlePiAgentHome({}), join(homedir(), ".pi", "agent"));
		assert.equal(
			resolveGentlePiAgentHome({ JERO_PI_AGENT_HOME: "", PI_CODING_AGENT_DIR: piAgentDir }),
			piAgentDir,
			"an empty explicit override falls through like Pi Subagents does",
		);
		assert.equal(
			resolveGentlePiAgentHome({ PI_CODING_AGENT_DIR: "" }),
			join(homedir(), ".pi", "agent"),
			"an empty PI_CODING_AGENT_DIR falls through like Pi Subagents does",
		);
	} finally {
		rmSync(explicitGentleHome, { recursive: true, force: true });
		rmSync(piAgentDir, { recursive: true, force: true });
	}
});

test("asset installation uses PI_CODING_AGENT_DIR as the Pi agent home when no explicit Gentle override is set", async () => {
	const previousAgentHome = process.env.JERO_PI_AGENT_HOME;
	const previousPiAgentDir = process.env.PI_CODING_AGENT_DIR;
	const temporaryPiAgentDir = mkdtempSync(join(tmpdir(), "gentle-pi-agent-dir-"));
	const explicitGentleHome = mkdtempSync(join(tmpdir(), "gentle-pi-explicit-home-"));

	try {
		delete process.env.JERO_PI_AGENT_HOME;
		process.env.PI_CODING_AGENT_DIR = temporaryPiAgentDir;

		await installSddAssets(PACKAGE_ROOT, true);

		const installedPath = join(temporaryPiAgentDir, "agents", "jero-explore.md");
		assert.ok(existsSync(installedPath), "managed agents must install where Pi Subagents reads global definitions");
		assert.deepEqual(readAgentDefinition(installedPath).tools, MANAGED_EXEMPLAR_TOOLS);
		assert.ok(
			!existsSync(join(explicitGentleHome, "agents", "jero-explore.md")),
			"the explicit override fixture must still be untouched before it is selected",
		);

		process.env.JERO_PI_AGENT_HOME = explicitGentleHome;
		await installSddAssets(PACKAGE_ROOT, true);
		assert.ok(
			existsSync(join(explicitGentleHome, "agents", "jero-explore.md")),
			"JERO_PI_AGENT_HOME remains the explicit test/operator override",
		);
	} finally {
		if (previousAgentHome === undefined) delete process.env.JERO_PI_AGENT_HOME;
		else process.env.JERO_PI_AGENT_HOME = previousAgentHome;
		if (previousPiAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previousPiAgentDir;
		rmSync(temporaryPiAgentDir, { recursive: true, force: true });
		rmSync(explicitGentleHome, { recursive: true, force: true });
	}
});

test("global model routing uses PI_CODING_AGENT_DIR for package-installed agents", async () => {
	const previousAgentHome = process.env.JERO_PI_AGENT_HOME;
	const previousPiAgentDir = process.env.PI_CODING_AGENT_DIR;
	const temporaryPiAgentDir = mkdtempSync(join(tmpdir(), "gentle-pi-model-agent-dir-"));
	const temporaryProject = mkdtempSync(join(tmpdir(), "gentle-pi-model-project-"));

	try {
		delete process.env.JERO_PI_AGENT_HOME;
		process.env.PI_CODING_AGENT_DIR = temporaryPiAgentDir;
		await installSddAssets(PACKAGE_ROOT, true);

		const result = await applyModelConfig(temporaryProject, {
			"jero-explore": { model: "provider/model", thinking: "high" },
		});

		assert.equal(result.updated, 2);
		const config = JSON.parse(readFileSync(join(temporaryPiAgentDir, "subagents.json"), "utf8"));
		assert.deepEqual(config.model_profiles["jero-explore"], {
			model: "provider/model",
			effort: "high",
		});
	} finally {
		if (previousAgentHome === undefined) delete process.env.JERO_PI_AGENT_HOME;
		else process.env.JERO_PI_AGENT_HOME = previousAgentHome;
		if (previousPiAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previousPiAgentDir;
		rmSync(temporaryPiAgentDir, { recursive: true, force: true });
		rmSync(temporaryProject, { recursive: true, force: true });
	}
});

test("normal and forced installation copy generic agents with complete role contracts", async () => {
	const previousAgentHome = process.env.JERO_PI_AGENT_HOME;
	const expectedTools = {
		"jero-explore": ["read", "grep", "find", "fovea_focus", "fovea_sketch", "fovea_dwell"],
		"jero-verify": ["read", "grep", "find", "bash"],
	} as const;

	try {
		for (const force of [false, true]) {
			const temporaryAgentHome = mkdtempSync(join(tmpdir(), "gentle-pi-generic-agents-"));
			process.env.JERO_PI_AGENT_HOME = temporaryAgentHome;
			try {
				await installSddAssets(PACKAGE_ROOT, force);

				for (const [name, tools] of Object.entries(expectedTools)) {
					const packagedPath = join(PACKAGE_ROOT, "assets", "agents", `${name}.md`);
					const installedPath = join(temporaryAgentHome, "agents", `${name}.md`);
					const { name: installedName, source, tools: installedTools } = readAgentDefinition(installedPath);
					assert.equal(source, readFileSync(packagedPath, "utf8"));
					assert.equal(installedName, name);
					assert.deepEqual(installedTools, tools);
					assert.match(source, /generic non-SDD work|通用非 SDD 工作/);
					assert.match(source, /不修复发现、不委托子代理|不委托子代理、不提交/);
					if (name === "jero-explore") {
						assert.match(source, /以 cwd 为范围的 fovea 工具/);
						assert.match(source, /绝不让它们指向另一个路径/);
						assert.match(source, /唯一被允许的变更/);
						assert.match(source, /所有已跟踪文件、源码文件和其他项目内容保持只读/);
						assert.match(source, /若 fovea 工具不可用或失败/);
						assert.match(source, /在它们不可用或失败之前不得使用该回退/);
					}
					assert.match(source, /不编辑、不写入/);
					assert.match(source, /压缩的(?:交接|证据交接)/);
					assert.match(source, /不使用 SDD 阶段协议或评审视角。/);
					if (name === "jero-verify") {
						assert.match(source, /父会话显式授权的确切测试、构建或 lint 命令/);
						assert.match(source, /父会话显式指明为预期的输出/);
						assert.match(source, /意外的变更视为阻塞项/);
						assert.match(source, /不清理或修复它/);
					}
				}
			} finally {
				rmSync(temporaryAgentHome, { recursive: true, force: true });
			}
		}
	} finally {
		if (previousAgentHome === undefined) delete process.env.JERO_PI_AGENT_HOME;
		else process.env.JERO_PI_AGENT_HOME = previousAgentHome;
	}
});

test("bounded implementation routing uses the same explicit fallback in both policy sections", () => {
	const routing = readFileSync(
		join(PACKAGE_ROOT, "assets", "orchestrator-delegation.md"),
		"utf8",
	);
	const simpleDelegation = readMarkdownSection(routing, "2. 简单委托");
	const mandatoryDelegation = readMarkdownSection(routing, "强制委托触发条件");

	assertWorkerFallbackRouting(simpleDelegation, "Simple Delegation");
	assertWorkerFallbackRouting(mandatoryDelegation, "Mandatory Delegation Triggers");
	assert.doesNotMatch(
		routing,
		/non-normative compatibility quotation|former wording is retained|no-runtime inline exception|superseded by the stop requirement/,
		"model-facing routing must not retain contradictory dead prose",
	);
	assert.doesNotMatch(
		routing,
		/`generic-writer`/,
		"routing must not revive the collision-prone generic package name",
	);
});

test("orchestrator routes generic roles without static RDD lens routing", () => {
	for (const file of ["orchestrator.md", "orchestrator-delegation.md"]) {
		const routing = readFileSync(join(PACKAGE_ROOT, "assets", file), "utf8");
		assert.match(routing, /通用非 SDD 探索[\s\S]*`jero-explore`/);
		assert.match(
			routing,
			/有界(?:实现|多文件写入)[\s\S]*`jero-worker`/,
		);
		assert.match(routing, /通用非 SDD 验证[\s\S]*`jero-verify`/);
		assert.match(routing, /SDD 角色留在 SDD 内|`sdd-explore` 与 `sdd-verify` 仅在 SDD 内使用/);
		assert.match(routing, /(?:真正本地的 )?1[-–]3 个已知文件(?:的)?只读检查|1[-–]3 文件只读检查/);
		assert.match(routing, /执行\/委托验证命令|委托执行或转委托命令/);
		assert.match(routing, /缺失(?:或|\/)不可用[\s\S]*?(?:原生 `Agent`[\s\S]*?同样的只读|同一只读[\s\S]*?原生 `Agent`)/);
		assert.match(routing, /报告回退/);
		assert.doesNotMatch(routing, /review lenses? (?:inside|only inside)|review lens routing/i);
	}

	const core = readFileSync(join(PACKAGE_ROOT, "assets", "orchestrator.md"), "utf8");
	assert.match(core, /把镜像的提供方捆绑评审执行契约注入/);
	assert.match(core, /本包不发明生命周期指令/);
});

test("pre-release package and runtime stop before publication", () => {
	const packageJson = readPackageJson();
	assert.equal(packageJson.version, "0.1.0", "the pre-release manifest stays pinned until the P5 identity pass");
	assert.equal(
		packageJson.scripts?.test,
		"node --experimental-strip-types --test \"tests/*.test.ts\" \"tests/authority/*.test.ts\" \"tests/authority/conformance/*.test.ts\" && pnpm run test:harness",
	);
	assert.ok(packageJson.files?.includes("assets/"));
	assert.ok(!packageJson.files?.includes("contracts/"));

	const verifier = readFileSync(join(PACKAGE_ROOT, "scripts", "verify-package-files.mjs"), "utf8");
	// gentle-pi#311 P5: the retired adversarial role agents must not be pinned
	// as required package files, while the append-only migration history stays.
	assert.doesNotMatch(verifier, /assets\/agents\/review-refuter\.md/);
	assert.doesNotMatch(verifier, /assets\/agents\/review-validator\.md/);
	assert.match(verifier, /assets\/migrations\/managed-assets-v0\.13\.json/);
	assert.match(verifier, /assets\/migrations\/managed-assets-v0\.14\.json/);

	const runtime = readFileSync(join(PACKAGE_ROOT, "extensions", "jero-ai.ts"), "utf8");
	assert.doesNotMatch(runtime, /execFileSync\("git", \["(?:commit|push|tag)"/);
	assert.doesNotMatch(runtime, /execFileSync\("(?:npm|pnpm)", \["publish"/);
});

test("bounded review keeps the Judgment Day skill contract at canon metadata version 1.7", () => {
	const frontmatter = readAgentFrontmatter(
		join(PACKAGE_ROOT, "skills", "judgment-day", "SKILL.md"),
	);

	assert.match(frontmatter, /^  version: "1\.7"$/m);
	assert.doesNotMatch(frontmatter, /^  version: "1\.4"$/m);
});

test("technical reference documents dynamic Gentle AI RDD ownership and the installed permission boundary", () => {
	const reference = readFileSync(join(PACKAGE_ROOT, "docs", "jero-reference.md"), "utf8");
	for (const clause of [
		"jero-pi dynamically supplies runtime-specific RDD instructions",
		"does not define an RDD lifecycle",
		"Dangerous-command safety remains independent and authoritative.",
		"package-managed isolated installation",
		"Project and user overrides may shadow a package asset",
	]) {
		assert.ok(reference.includes(clause), `technical reference missing dynamic RDD clause: ${clause}`);
	}
	assert.doesNotMatch(reference, /New ordinary review uses compact `gentle_review` `start -> finalize -> validate`\./);
});


test("package verification explicitly requires the managed remediation actor", () => {
	assert.match(readFileSync(join(PACKAGE_ROOT, "scripts/verify-package-files.mjs"), "utf8"), /assets\/agents\/sdd-remediate\.md/);
});

