// package-manifest 测试第 1 段（留守原文件名）（共 2 段；夹具在 package-manifest-shared.ts）。
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
	V013_MANAGED_ASSETS, V013_REVIEW_RISK_FIXTURE, V014_MANAGED_ASSETS, V014_REVIEW_RISK_FIXTURE,
	readAgentFrontmatter, readAgentDefinition, readMarkdownSection,
	COMPANION_EXTENSION_REFS, COMPANION_SKILL_REFS,
} from "./package-manifest-shared.ts";

test("package manifest declares the tested Pi minimum required for agent_settled", () => {
	const manifest = readPackageJson();
	assert.equal(manifest.peerDependencies?.["@earendil-works/pi-coding-agent"], ">=0.85.1");
	assert.equal(manifest.devDependencies?.["@earendil-works/pi-coding-agent"], "0.85.1");
});

test("package manifest has no obsolete native activation build surface", () => {
	const packageJson = readPackageJson();
	const manifest = JSON.stringify(packageJson);

	assert.ok(!packageJson.files?.includes("native/"), "package must not ship the obsolete native addon directory");
	assert.ok(!packageJson.scripts?.["native:build"], "package must not expose an obsolete native build script");
	assert.doesNotMatch(manifest, /build-native-addon|gentle_review_native|review-native-fence/i);
	assert.doesNotMatch(packageJson.scripts?.prepack ?? "", /native:build/);
	assert.doesNotMatch(packageJson.scripts?.prepublishOnly ?? "", /native:build/);
});

test("package verification names the native review runtime boundary and packaged fixtures", () => {
	const verifier = readFileSync(join(PACKAGE_ROOT, "scripts", "verify-package-files.mjs"), "utf8");
	const manifest = readPackageJson();

	assert.ok(manifest.files?.includes("lib/"), "the published package must include the native review runtime module directory");
	assert.ok(manifest.files?.includes("runtime/"), "the published package must include generated JavaScript runtime modules");
	assert.match(verifier, /"lib\/authority\/client-contract\.ts"/, "package verification must require the client contract under the authority");
	assert.match(verifier, /"runtime\/client-contract\.mjs"/, "package verification must require the generated client contract module");
	assert.match(verifier, /build-runtime-modules\.mjs.*--check/s, "package verification must reject generated-runtime drift");
	assert.match(verifier, /"tests\/fixtures\/native-review-cli\/v2\.1\.3\/start\.json"/, "package verification must retain the pinned native decoder fixture");
	assert.match(
		readFileSync(join(PACKAGE_ROOT, "extensions", "jero-ai.ts"), "utf8"),
		/createJeroAuthorityReviewCli\(\)/,
		"the production extension must construct its native client from the in-process authority adapter",
	);
});

test("npm publication is bound to the exact package tag and triggering commit", () => {
	const workflow = readFileSync(join(PACKAGE_ROOT, ".github", "workflows", "publish.yml"), "utf8");
	const releaseSkill = readFileSync(join(PACKAGE_ROOT, "skills", "release", "SKILL.md"), "utf8");
	const packageJson = readPackageJson();
	const dispatchBlock = workflow.match(
		/^ {2}workflow_dispatch:\n([\s\S]*?)^\npermissions:/m,
	)?.[1];
	assert.ok(dispatchBlock);
	const inputNames = [
		...dispatchBlock.matchAll(/^ {6}([A-Za-z0-9_-]+):$/gm),
	].map((match) => match[1]);

	assert.match(workflow, /on:\n\s+workflow_dispatch:\s*\n/);
	assert.deepEqual(inputNames, ["tag"], "the trusted workflow must expose exactly one caller input");
	assert.match(workflow, /inputs:\n\s+tag:/, "the trusted main workflow must accept only the release tag");
	assert.match(workflow, /RELEASE_TAG: \$\{\{ inputs\.tag \}\}/);
	assert.doesNotMatch(workflow, /checkout-ref|dist-tag.*inputs|inputs\.(?!tag)/, "the release workflow must not accept checkout or dist-tag inputs");
	assert.match(workflow, /ref: \$\{\{ github\.sha \}\}/, "checkout must use the immutable event SHA");
	assert.match(workflow, /persist-credentials: false/, "the release checkout must not retain GitHub credentials");
	assert.match(workflow, /DEFAULT_BRANCH: \$\{\{ github\.event\.repository\.default_branch \}\}/);
	assert.match(workflow, /\$\{DEFAULT_BRANCH\}" != "main"/);
	assert.match(workflow, /\$\{GITHUB_REF\}" != "refs\/heads\/main"/);
	assert.match(workflow, /\$\{GITHUB_REF_TYPE\}" != "branch"/);
	assert.match(workflow, /Release tag is not exact vSemVer/);
	assert.match(workflow, /git ls-remote origin[\s\S]*"refs\/heads\/main"[\s\S]*"refs\/tags\/\$\{tag\}"/);
	assert.match(workflow, /git fetch --atomic --no-tags origin/);
	assert.match(workflow, /refs\/heads\/main:refs\/remotes\/origin\/release-main/);
	assert.match(workflow, /refs\/tags\/\$\{tag\}:refs\/release-verification\/tag/);
	assert.match(workflow, /git cat-file -t refs\/release-verification\/tag/);
	assert.match(workflow, /git checkout --detach "\$\{tag_commit\}"/);
	assert.match(workflow, /git rev-parse "\$\{GITHUB_SHA\}\^\{commit\}"/);
	assert.match(workflow, /git rev-parse ['"]HEAD\^\{commit\}['"]/);
	assert.match(workflow, /Reverify protected release authority and publish/);
	assert.match(workflow, /Release authority changed after verification/);
	assert.match(workflow, /id-token: write/, "trusted publishing requires OIDC");
	assert.match(workflow, /node-version: "24"/, "trusted publishing must use a supported Node.js version");
	assert.match(workflow, /const minimum = \[11, 5, 1\]/, "trusted publishing must reject npm versions below 11.5.1");
	assert.match(workflow, /packageJson\.repository\?\.type !== expectedRepository\.type/);
	assert.match(workflow, /packageJson\.repository\?\.url !== expectedRepository\.url/);
	assert.deepEqual(
		packageJson.repository,
		{
			type: "git",
			url: "git+https://github.com/jero-pi/jero-pi.git",
		},
		"trusted publishing requires the exact case-sensitive npm repository identity",
	);
	assert.match(workflow, /npm publish --provenance --access public/);
	assert.doesNotMatch(workflow, /pnpm publish|--no-git-checks|NODE_AUTH_TOKEN/);

	assert.match(releaseSkill, /tag="v\$\{version\}"/);
	assert.match(releaseSkill, /release_sha="\$\(git rev-parse 'origin\/main\^\{commit\}'\)"/);
	assert.match(releaseSkill, /git rev-parse "\$\{tag\}\^\{commit\}"/);
	assert.match(releaseSkill, /git fetch --no-tags origin "refs\/tags\/\$\{tag\}"/);
	assert.match(releaseSkill, /gh release create "\$\{tag\}"[\s\S]*--verify-tag/);
	assert.match(releaseSkill, /--ref main/);
	assert.match(releaseSkill, /-f tag="\$\{tag\}"/);
	assert.match(releaseSkill, /trusted OIDC with provenance/);
	assert.doesNotMatch(releaseSkill, /--ref "\$\{tag\}"|-f dist-tag=/);
});

test("Pi delivery relay is absent from the packaged extension", () => {
	const extension = readFileSync(join(PACKAGE_ROOT, "extensions", "jero-ai.ts"), "utf8");

	assert.doesNotMatch(extension, /review-publication-gate/);
});

test("generated runtime modules and packed-package checks are deterministic", () => {
	const packageJson = readPackageJson();
	const generator = readFileSync(join(PACKAGE_ROOT, "scripts", "build-runtime-modules.mjs"), "utf8");
	const ci = readFileSync(join(PACKAGE_ROOT, ".github", "workflows", "ci.yml"), "utf8");
	assert.equal(packageJson.scripts?.["build:runtime-modules"], "node scripts/build-runtime-modules.mjs --write");
	assert.equal(packageJson.scripts?.["check:runtime-modules"], "node scripts/build-runtime-modules.mjs --check");
	// jero-pi P4: test:packed-package 已恢复（零二进制姿态的打包 E2E），
	// 并接入 prepublishOnly 发布门。
	assert.equal(packageJson.scripts?.["test:packed-package"], "node scripts/test-packed-runner.mjs");
	assert.match(packageJson.scripts?.prepublishOnly ?? "", /test:packed-package/);
	assert.match(readFileSync(join(PACKAGE_ROOT, "scripts", "verify-package-files.mjs"), "utf8"), /"scripts\/test-packed-runner\.mjs"/);
	assert.match(ci, /pnpm run check:runtime-modules/);
	assert.match(generator, /Generated by scripts\/build-runtime-modules\.mjs/);
});

test("package manifest keeps the zero-binary install posture (jero-pi P1)", () => {
	const packageJson = readPackageJson();
	const verifier = readFileSync(join(PACKAGE_ROOT, "scripts", "verify-package-files.mjs"), "utf8");

	assert.equal(packageJson.scripts?.postinstall, "node scripts/install-tui-mode-setting.mjs");
	assert.ok(packageJson.files?.includes("scripts/"));
	// The forbidden list proves no installer/binary/telemetry/provider-mirror
	// residue can ship (design D1/D3/D7).
	assert.match(verifier, /const forbiddenPaths = \[/);
	assert.match(verifier, /"scripts\/gentle-ai-installer\.mjs"/);
	assert.match(verifier, /"lib\/gentle-ai-binary\.ts"/);
	assert.match(verifier, /"lib\/telemetry-trigger\.ts"/);
	assert.match(verifier, /"contracts"/);
	for (const forbidden of ["scripts/install-gentle-ai.mjs", "scripts/gentle-ai-installer.mjs", "lib/gentle-ai-binary.ts", "lib/provider-contract-bundle.ts", "lib/telemetry-trigger.ts", "runtime/gentle-ai-binary.mjs", "runtime/telemetry-trigger.mjs", "extensions/quiet-tools.ts", "extensions/ask-user-choice.ts", "extensions/codegraph-tools.ts"]) {
		assert.ok(!existsSync(join(PACKAGE_ROOT, ...forbidden.split("/"))), forbidden + " must not exist");
	}
	assert.ok(!existsSync(join(PACKAGE_ROOT, "contracts")), "contracts/ tree must stay retired");
});

// P4 落地（设计 §5.3 集成矩阵）：九个伴生 pi-package 是硬依赖，其资源经
// node_modules 路径进 pi manifest 才会被宿主加载（宿主目录扫描跳过
// node_modules；packages.md "Dependencies" 契约）。缺路径时宿主静默跳过，
// 即"依赖存在即用"。禁止 bundledDependencies：pi-pretty/pi-lens 含平台
// 特定原生依赖，必须由宿主安装时的 npm install 按用户平台解析。
// COMPANION_EXTENSION_REFS / COMPANION_SKILL_REFS 定义在 package-manifest-shared.ts。

test("companion pi-packages load through node_modules manifest references without bundling", () => {
	const packageJson = readPackageJson();

	assert.ok(
		packageJson.pi?.extensions?.includes("./extensions"),
		"jero-pi must load its own packaged extensions",
	);
	for (const [name, ref] of Object.entries(COMPANION_EXTENSION_REFS)) {
		assert.ok(
			packageJson.pi?.extensions?.includes(ref),
			`the pi manifest must reference ${name} through its node_modules entry`,
		);
		const entry = join(PACKAGE_ROOT, ...ref.split("/"));
		assert.ok(existsSync(entry), `companion entry ${ref} must exist after install`);
		const companion = JSON.parse(readFileSync(join(PACKAGE_ROOT, "node_modules", ...name.split("/"), "package.json"), "utf8"));
		const companionEntry = companion.pi?.extensions?.[0]?.replace(/^\.\//, "");
		assert.ok(
			companionEntry !== undefined && ref.endsWith(companionEntry),
			`the ${name} reference must match the companion's own pi manifest entry`,
		);
	}
	for (const ref of COMPANION_SKILL_REFS) {
		assert.ok(
			packageJson.pi?.skills?.includes(ref),
			`the pi manifest must reference companion skills at ${ref}`,
		);
		assert.ok(existsSync(join(PACKAGE_ROOT, ...ref.split("/"))), `companion skills dir ${ref} must exist after install`);
	}
	assert.equal(
		packageJson.bundledDependencies,
		undefined,
		"companions must not be bundled: pi-pretty/pi-lens native dependencies resolve per-platform at install time",
	);
	assert.equal(
		packageJson.bundleDependencies,
		undefined,
		"companions must not be bundled: pi-pretty/pi-lens native dependencies resolve per-platform at install time",
	);
});

test("companion dependencies are exact-pinned and pi-tui stays a host-provided peer", () => {
	const packageJson = readPackageJson();

	for (const name of Object.keys(COMPANION_EXTENSION_REFS)) {
		const version = packageJson.dependencies?.[name];
		assert.ok(
			version !== undefined && /^\d/.test(version),
			`companion ${name} must be an exact-pinned dependency (got ${String(version)})`,
		);
	}
	assert.equal(packageJson.dependencies?.["@earendil-works/pi-tui"], undefined, "the host bundles pi-tui; jero-pi must not install its own copy");
	assert.equal(packageJson.peerDependencies?.["@earendil-works/pi-tui"], "*", "pi-tui belongs to the host-provided core peer family");
	assert.equal(packageJson.devDependencies?.["@earendil-works/pi-tui"], "0.85.1", "tests pin pi-tui to the tested host version");
});

test("package verification pins the relocated golden vectors as the behavioral spec", () => {
	const verifier = readFileSync(join(PACKAGE_ROOT, "scripts", "verify-package-files.mjs"), "utf8");

	// The upstream contract artifacts moved to tests/fixtures/review-integration
	// and stay byte-pinned (design §5.1.7): they are the spec lib/authority/
	// conformance is graded against at P2.
	assert.match(verifier, /tests\/fixtures\/review-integration\/v1\/fixtures\/status\.fixture\.json/);
	assert.match(verifier, /tests\/fixtures\/review-integration\/v2\/fixtures\/status\.fixture\.json/);
});












test("Markdown section extraction isolates policy text from sibling sections", () => {
	const markdown = [
		"# Agent",
		"## Context contract",
		"context-only policy",
		"### Context detail",
		"nested context policy",
		"## Tool safety",
		"tool-only policy",
	].join("\n");

	const context = readMarkdownSection(markdown, "Context contract");

	assert.match(context, /context-only policy/);
	assert.match(context, /nested context policy/);
	assert.doesNotMatch(context, /tool-only policy/);
});

test("packaged agents use YAML list syntax for tool allowlists", () => {
	const agentsDir = join(PACKAGE_ROOT, "assets", "agents");
	const agentFiles = readdirSync(agentsDir).flatMap((entry) =>
		entry.endsWith(".md") ? [join(agentsDir, entry)] : [],
	);

	assert.ok(agentFiles.length > 0, "gentle-pi must ship packaged agents");

	for (const file of agentFiles) {
		const frontmatter = readAgentFrontmatter(file);
		assert.doesNotMatch(
			frontmatter,
			/^tools:\s*[^\n,]+(?:,\s*[^\n,]+)+$/m,
			`${file} must not use comma-separated inline tools; pi-subagents expects a YAML list`,
		);
		assert.match(
			frontmatter,
			/^tools:\n(?: {2}- "\*": false\n)?(?: {2}- [\w-]+\n?)+/m,
			`${file} must declare tools as a YAML list`,
		);
	}
});

// The Pi child-session tool registry exposes `find` for filesystem discovery
// and has no `glob` or `webfetch` builtin (see tests/runtime-harness.mjs and
// the working builtin `reviewer` canary in issue #62). A packaged agent that
// declares a name the runtime cannot resolve does not fail loudly: the SDK
// silently drops it and the child starts with a reduced allowlist, so the
// agent reports itself blocked instead of naming the missing tool.
export const UNSUPPORTED_CHILD_SESSION_TOOLS = ["glob", "webfetch"];

test("packaged agents declare only tool names a Pi child session can resolve", () => {
	const agentsDir = join(PACKAGE_ROOT, "assets", "agents");
	const agentFiles = readdirSync(agentsDir).flatMap((entry) =>
		entry.endsWith(".md") ? [join(agentsDir, entry)] : [],
	);

	assert.ok(agentFiles.length > 0, "gentle-pi must ship packaged agents");

	for (const file of agentFiles) {
		const { tools } = readAgentDefinition(file);
		for (const unsupported of UNSUPPORTED_CHILD_SESSION_TOOLS) {
			assert.ok(
				!tools.includes(unsupported),
				`${file} declares ${unsupported}, which no Pi child session exposes; use find for discovery`,
			);
		}
	}
});

export async function withIsolatedAssetHome(run: (agentHome: string) => void | Promise<void>): Promise<void> {
	const temporary = mkdtempSync(join(tmpdir(), "gentle-asset-owners-"));
	const previous = process.env.JERO_PI_AGENT_HOME;
	try {
		process.env.JERO_PI_AGENT_HOME = temporary;
		await run(temporary);
	} finally {
		if (previous === undefined) delete process.env.JERO_PI_AGENT_HOME;
		else process.env.JERO_PI_AGENT_HOME = previous;
		rmSync(temporary, { recursive: true, force: true });
	}
}

export function installedAssetManifest(agentHome: string): ManagedAssetsManifest {
	const jero = join(agentHome, "jero", "managed-assets.json");
	return JSON.parse(readFileSync(existsSync(jero) ? jero : join(agentHome, "jero", "managed-assets.json"), "utf8"));
}

test("selective delegation installation owns only generic agents", async () => {
	await withIsolatedAssetHome(async (agentHome) => {
		const result = await installPackageAssets(agentHome, false, ["delegation"]);
		assert.deepEqual(Object.keys(installedAssetManifest(agentHome).assets).sort(), [
			"agents/jero-explore.md",
			"agents/jero-verify.md",
			"agents/jero-worker.md",
		]);
		assert.deepEqual(result, { agents: 3, chains: 0, support: 0, skipped: 0 });
		assert.deepEqual(readdirSync(join(agentHome, "agents")).sort(), [
			"jero-explore.md", "jero-verify.md", "jero-worker.md",
		]);
		assert.equal(existsSync(join(agentHome, "chains")), false);
		assert.equal(existsSync(join(agentHome, "gentle-ai", "support")), false);
	});
});

test("selective installation retires only assets belonging to the selected owner", async () => {
	await withIsolatedAssetHome(async (agentHome) => {
		await installSddAssets(agentHome, false);
		const manifestPath = join(agentHome, "jero", "managed-assets.json");
		const manifest = installedAssetManifest(agentHome);
		for (const name of RETIRED_ADVERSARIAL_AGENTS) {
			writeFileSync(join(agentHome, "agents", name), "Previously managed review agent\n");
			manifest.assets[`agents/${name}`] = sha256("Previously managed review agent\n");
		}
		writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
		for (const owner of ["delegation", "sdd"] as const) {
			await installPackageAssets(agentHome, true, [owner]);
			assert.deepEqual(installedAssetManifest(agentHome), manifest);
			for (const name of RETIRED_ADVERSARIAL_AGENTS) {
				assert.equal(readFileSync(join(agentHome, "agents", name), "utf8"), "Previously managed review agent\n");
			}
		}
		writeFileSync(join(agentHome, "agents", "review-validator.md"), "User-modified retired agent\n");
		await installPackageAssets(agentHome, false, ["review"]);
		assert.equal(existsSync(join(agentHome, "agents", "review-refuter.md")), false);
		assert.equal(readFileSync(join(agentHome, "agents", "review-validator.md"), "utf8"), "User-modified retired agent\n");
		for (const name of RETIRED_ADVERSARIAL_AGENTS) {
			assert.equal(installedAssetManifest(agentHome).assets[`agents/${name}`], undefined);
		}
	});
});

export const EXPECTED_OWNER_ASSETS: Record<PackageAssetOwner, readonly string[]> = {
	delegation: [
		"agents/jero-explore.md", "agents/jero-verify.md", "agents/jero-worker.md",
	],
	review: [
		"agents/jd-fix-agent.md", "agents/jd-judge-a.md", "agents/jd-judge-b.md",
		"agents/review-readability.md", "agents/review-reliability.md",
		"agents/review-resilience.md", "agents/review-risk.md", "chains/4r-review.chain.md",
	],
	sdd: [
		"agents/sdd-apply.md", "agents/sdd-archive.md", "agents/sdd-design.md",
		"agents/sdd-explore.md", "agents/sdd-init.md", "agents/sdd-onboard.md",
		"agents/sdd-proposal.md", "agents/sdd-remediate.md", "agents/sdd-research.md", "agents/sdd-spec.md",
		"agents/sdd-status.md", "agents/sdd-sync.md", "agents/sdd-tasks.md", "agents/sdd-verify.md",
		"chains/sdd-full.chain.md", "chains/sdd-plan.chain.md", "chains/sdd-verify.chain.md",
		"jero/support/sdd-status-contract.md", "jero/support/strict-tdd-verify.md",
		"jero/support/strict-tdd.md",
	],
};

export function assetFileKeys(root: string, prefix = ""): string[] {
	if (!existsSync(root)) return [];
	return readdirSync(root, { withFileTypes: true }).flatMap(entry => {
		const key = `${prefix}${entry.name}`;
		return entry.isDirectory() ? assetFileKeys(join(root, entry.name), `${key}/`) : [key];
	}).sort();
}

for (const owner of Object.keys(EXPECTED_OWNER_ASSETS) as PackageAssetOwner[]) {
	test(`selective ${owner} installation covers its catalog without cross-owner files`, async () => {
		await withIsolatedAssetHome(async (agentHome) => {
			const expected = [...EXPECTED_OWNER_ASSETS[owner]].sort();
			await installPackageAssets(agentHome, false, [owner]);
			assert.deepEqual(Object.keys(installedAssetManifest(agentHome).assets).sort(), expected);
			assert.deepEqual(assetFileKeys(agentHome), [...expected, "jero/managed-assets.json"].sort());
			for (const key of expected) {
				assert.equal(getPackageAssetOwner(key), owner);
				const source = join(PACKAGE_ROOT, "assets", key.replace(/^jero\//, ""));
				assert.equal(readFileSync(join(agentHome, key), "utf8"), readFileSync(source, "utf8"));
			}
			const counts = await installPackageAssets(agentHome, false, [owner, owner]);
			assert.deepEqual(counts, { agents: 0, chains: 0, support: 0, skipped: expected.length });
		});
	});
}

test("legacy all-assets installation covers every packaged file with explicit ownership", async () => {
	const packaged = ["agents", "chains", "support"].flatMap(group =>
		assetFileKeys(join(PACKAGE_ROOT, "assets", group), group === "support" ? "jero/support/" : `${group}/`),
	).sort();
	assert.deepEqual(packaged, Object.values(EXPECTED_OWNER_ASSETS).flat().sort());
	for (const key of packaged) assert.notEqual(getPackageAssetOwner(key), undefined, key);
	for (const key of ["agents/sdd-new.md", "jero/support/new.md", "toString", "__proto__"]) {
		assert.equal(getPackageAssetOwner(key), undefined, "unknown assets must not default to SDD");
	}
	await withIsolatedAssetHome(async (agentHome) => {
		assert.deepEqual(await installSddAssets(agentHome, false), { agents: 24, chains: 4, support: 3, skipped: 0 });
		assert.deepEqual(Object.keys(installedAssetManifest(agentHome).assets).sort(), packaged);
		assert.deepEqual(await installSddAssets(agentHome, false), { agents: 0, chains: 0, support: 0, skipped: 31 });
		assert.deepEqual(await installSddAssets(agentHome, true), { agents: 24, chains: 4, support: 3, skipped: 0 });
	});
});

test("selective refresh preserves unselected ownership and selected user changes after an all-assets install", async () => {
	await withIsolatedAssetHome(async (agentHome) => {
		await installSddAssets(agentHome, false);
		const manifest = installedAssetManifest(agentHome);
		const selectedUserKey = "agents/jero-explore.md";
		const unselectedUserKey = "agents/sdd-apply.md";
		for (const key of [selectedUserKey, unselectedUserKey, "agents/custom.md"]) {
			writeFileSync(join(agentHome, key), "User-authored instructions\n");
		}
		const before = new Map(assetFileKeys(agentHome).map(key => [key, readFileSync(join(agentHome, key), "utf8")]));
		assert.deepEqual(await installPackageAssets(agentHome, true, ["delegation"]), { agents: 2, chains: 0, support: 0, skipped: 1 });
		delete manifest.assets[selectedUserKey];
		assert.deepEqual(installedAssetManifest(agentHome), manifest);
		for (const [key, content] of before) {
			if (key !== "jero/managed-assets.json") assert.equal(readFileSync(join(agentHome, key), "utf8"), content, key);
		}
		const manifestBytes = readFileSync(join(agentHome, "jero", "managed-assets.json"), "utf8");
		assert.deepEqual(await installPackageAssets(agentHome, true, []), { agents: 0, chains: 0, support: 0, skipped: 0 });
		assert.equal(readFileSync(join(agentHome, "jero", "managed-assets.json"), "utf8"), manifestBytes);
	});
});

test("selective review migration adopts only untouched legacy copies and preserves routing", async () => {
	for (const edited of [false, true]) {
		await withIsolatedAssetHome(async (agentHome) => {
			mkdirSync(join(agentHome, "agents"));
			const legacy = readFileSync(V014_REVIEW_RISK_FIXTURE, "utf8")
				.replace("name: review-risk\n", "name: review-risk\nmodel: custom/model\nthinking: high\n")
				+ (edited ? "\nUser review restrictions.\n" : "");
			const target = join(agentHome, "agents", REVIEW_RISK_FILE);
			writeFileSync(target, legacy);
			await installPackageAssets(agentHome, true, ["delegation"]);
			assert.equal(readFileSync(target, "utf8"), legacy);
			assert.equal(installedAssetManifest(agentHome).assets["agents/review-risk.md"], undefined);
			const result = await installPackageAssets(agentHome, true, ["review"]);
			const actual = readFileSync(target, "utf8");
			const manifest = installedAssetManifest(agentHome);
			assert.equal(result.skipped, edited ? 1 : 0);
			if (edited) {
				assert.equal(actual, legacy);
				assert.equal(manifest.assets["agents/review-risk.md"], undefined);
			} else {
				assert.notEqual(actual, legacy);
				assert.match(actual, /model: custom\/model\nthinking: high/);
				assert.equal(manifest.assets["agents/review-risk.md"], sha256(actual));
			}
			assert.equal(existsSync(join(agentHome, "agents", "sdd-apply.md")), false);
			assert.equal(existsSync(join(agentHome, "gentle-ai", "support")), false);
		});
	}
});

test("unowned legacy research migrates by exact normalized hash, preserving routing and user edits", async () => {
	const packaged = readFileSync(join(PACKAGE_ROOT, "assets", "agents", "sdd-research.md"), "utf8");
	const oldAdmission = "- Evidence grants for this runtime are `documentation=[]; open-web=[]`. Never infer evidence capability from bash, persistence tools, or any inherited tool; persistence tools are not evidence grants. Unsupported or undeclared classes deny admission and emit no claims.\n- Because this runtime declares no evidence grants, retain the selected request, persist a `blocked` outcome with no claims, and stop.\n";
	const legacy = packaged
		.replace("你是 Jero 的 SDD research executor。", "You are the SDD research executor for Gentle AI.")
		.replace("  - mem_read" + String.fromCharCode(10), "  - mem_get_observation" + String.fromCharCode(10))
		.replace("OpenSpec 要求其确切的变更本地绝对 `.md` 路径。记忆要求确切的 `topic_key`（`sdd/<change>/<artifact>`）。", "OpenSpec requires its exact absolute change-local `.md` path. Engram requires exact observation `id`, `project`, `topic_key`, and positive `revision_count`.")
		.replace("OpenSpec 要求完整 JSON 字节、匹配的 revision 和 digest；记忆要求渲染后的 `mem_read` 文本（一行 `saved <timestamp>` 头部、一个空行分隔符，然后逐字逐句的条目正文）且正文 digest 匹配。", "OpenSpec requires complete JSON bytes, matching revision and digest; Engram requires matching returned id/project/topic_key/revision_count and content digest.")
		.replace("任意主题键和通用网关都不是恢复路径。搜索使用精确的项目/主题查询；只有匹配的项目/主题条目才能提供已携带的主题键。", "arbitrary observation IDs and generic gateways are not recovery routes. Search uses the exact project/topic query; only a matching project/topic observation may supply the already-carried ID.")
		.replace("要读取的输入（`engram`/`both`：用主题键调用 `mem_read`，确切键未知时回退到 `mem_search`/`mem_list`；`openspec`：读取 `openspec/changes/{change}/` 下的文件）：", "Inputs to read (`engram`/`both`: use the injected Engram memory read tools for the topic key, then fetch the full observation; `openspec`: read the file under `openspec/changes/{change}/`):")
		.replace("- `engram`/`both`：调用 `mem_save`，`topic` 为 `\"sdd/{change}/research\"`，完整产物体作为 `content`（用同一主题再次保存会替换该条目）。", "- `engram`/`both`: call the injected Engram save tool with title and `topic_key` `\"sdd/{change}/research\"`, `type: \"architecture\"`, `project` from context, and `capture_prompt: false` when the tool schema supports it (omit the field if an older schema rejects it).")
		.replace("Nothing extracts this block automatically — durable capture happens only through the explicit `mem_save` persistence required by the Memory Contract above, or when the parent or user directs a save; you do not parse the block yourself.", "The Engram memory provider automatically extracts and persists these items as passive capture; you do not parse the block or invoke passive-capture tools yourself.")
		.replace(/## Parent Preflight Transport\n[\s\S]*?(?=## 技能解析契约)/, "")
		.replace(/## 有界产物交接\n[\s\S]*?(?=## 记忆契约)/, "")
		.replace(/  - fetch_content\n  - web_search\n  - source_check\n  - get_search_content\n/, "")
		.replace(/- 使用注入的 `## SDD Research Capabilities`[\s\S]*?(?=- 准入被拒)/, oldAdmission)
		.replace(/仅当所有被选问题都有经验证的来源背书答案时使用 `done`[\s\S]*?产品决策仍由父会话单独确认。/, "For this runtime the outcome is `blocked` with an admission denial and no claims.")
		.replace("## 技能解析契约", "## Skill Resolution Contract")
		.replace("在本 SDD 阶段使用为你指定的执行器/阶段技能。对项目/用户技能，优先使用父会话注入的 `## Skills to load before work` 路径；开工前读取这些精确的 `SKILL.md` 文件。正常运行期间不得自行发现额外的项目/用户技能或注册表。", "Use your assigned executor/phase skill for this SDD phase. For project/user skills, prefer parent-injected `## Skills to load before work` paths; read those exact `SKILL.md` files before work. Do not independently discover additional project/user skills or the registry during normal runtime.")
		.replace("若技能路径缺失，仅允许将显式回退加载作为降级自愈。将 `skill_resolution` 报告为 `paths-injected`、`fallback-registry`、`fallback-path` 或 `none`；出现回退意味着父会话下次应传入已索引的路径。", "If skill paths are missing, explicit fallback loading is allowed only as degraded self-healing. Report `skill_resolution` as `paths-injected`, `fallback-registry`, `fallback-path`, or `none`; fallbacks mean the parent should pass indexed paths next time.")
		.replace("- 仅在编排器选择 `sdd-research` 并提供已持久化的研究意图时运行：变更名、问题清单、所请求的来源类别和产物存储。将该意图视为不可变；若其缺失，返回 `blocked` 且不做任何声明。", "- Run only when the orchestrator selects `sdd-research` and supplies the persisted research intent: the change name, the questions, the requested source classes, and the artifact store. Treat that intent as immutable; if it is absent, return `blocked` with no claims.")
		.replace("- 准入被拒、证据不完整、来源无效或持久化分歧都不会产生未经验证的声明，并阻塞提案就绪。", "- Admission denial, partial evidence, invalid sources, or persistence divergence emits no unvalidated claim and blocks proposal readiness.")
		.replace("- 将证据声明与非权威的产品选择分开；编排器拥有产品决策和提案准入。", "- Keep evidence claims separate from non-authoritative product choices; the orchestrator owns product decisions and proposal admission.")
		.replace("- 绝不启动子代理。父会话/编排器拥有委托权。", "- Do NOT launch child subagents. Parent/orchestrator owns delegation.")
		.replace("- 按下文记忆契约持久化研究与预提案产物；绝不声称执行了未实际执行的持久化。", "- Persist the research and pre-proposal artifacts per the Memory Contract below; never claim persistence you did not perform.")
		.replace("- 保持输出简洁并返回 SDD 结果契约。", "- Keep output concise and return the SDD result contract.")
		.replace("## 记忆契约", "## Memory Contract")
		.replace("在做阶段工作之前，直接从活动后端读取输入产物；不要等待父会话内联它们。父会话可以传递产物引用和上下文，但获取所需输入是本阶段的责任。", "Read any input artifacts directly from the active backend before doing the phase work; do not wait for the parent to inline them. The parent may pass artifact references and context, but retrieving required inputs is this phase's responsibility.")
		.replace("- 探索结果（存在时）：`sdd/{change}/explore`（openspec：`openspec/changes/{change}/` 下的探索文件）。", "- Exploration (when it exists): `sdd/{change}/explore` (openspec: the exploration file under `openspec/changes/{change}/`).")
		.replace("返回前将本阶段产物持久化到活动后端（强制）：", "Persist this phase's artifact to the active backend before returning (mandatory):")
		.replace("- `openspec`：写入/更新 `openspec/changes/{change}/research.md`。", "- `openspec`: write/update `openspec/changes/{change}/research.md`.")
		.replace("- `none`：内联返回研究记录。", "- `none`: return the research record inline.")
		.replace("研究产物使用 schema `gentle-ai.sdd-research/v1`：一个正的 `revision`、显式的 `done | partial | blocked` 结果、问题清单、准入和观察到的精确授权、来源，以及经验证的声明（每条声明映射到来源 ID）。", "The research artifact uses schema `gentle-ai.sdd-research/v1`: a positive `revision`, an explicit `done | partial | blocked` outcome, the questions, admission and the observed exact grants, sources, and validated claims where each claim maps to source IDs. ")
		.replace("还要更新预提案状态（`engram`/`both`：主题 `\"sdd/{change}/preproposal\"`；相同的保存约定），使用 schema `gentle-ai.sdd-preproposal/v1`：一个正的 `revision`、探索引用、研究请求和类别、准入结果、证据引用、产品决策（`pending | confirmed`）和 `proposal_ready`。", "Also update the pre-proposal state (`engram`/`both`: topic `\"sdd/{change}/preproposal\"`; same save conventions) using schema `gentle-ai.sdd-preproposal/v1`: a positive `revision`, the exploration reference, the research request and classes, the admission outcome, evidence references, product decisions (`pending | confirmed`), and `proposal_ready`.")
		.replace("混合（`both`）持久化意味着两个存储中字节一致。混合不匹配或单侧写入失败时，绝不偏爱任何一个存储：从保留的意图恢复，而非从幸存的存储恢复，并在恢复期间保持提案就绪为假。", "Hybrid (`both`) persistence means identical bytes in both stores. On hybrid mismatch or a one-sided write failure, never prefer one store: recover from the retained intent, not from a surviving store, and keep proposal readiness false for recovery.")
		.replace("绝不声称执行了未实际执行的持久化。", "Never claim persistence you did not perform.");
	const manifest = JSON.parse(readFileSync(join(PACKAGE_ROOT, "assets", "migrations", "managed-assets-v2.5.0.json"), "utf8"));
	assert.equal(sha256(legacy), manifest.assets["agents/sdd-research.md"], "fixture reconstruction must match observed old package bytes");
	const temporary = mkdtempSync(join(tmpdir(), "gentle-research-migration-"));
	const previous = process.env.JERO_PI_AGENT_HOME;
	try {
		for (const edited of [false, true]) {
			const agentHome = join(temporary, edited ? "edited" : "legacy");
			process.env.JERO_PI_AGENT_HOME = agentHome;
			mkdirSync(join(agentHome, "agents"), { recursive: true });
			const target = join(agentHome, "agents", "sdd-research.md");
			const routed = legacy.replace("name: sdd-research\n", "name: sdd-research\nmodel: custom/model\nthinking: high\n") + (edited ? "\nUser research restrictions.\n" : "");
			writeFileSync(target, routed);
			await installSddAssets(temporary, true);
			const actual = readFileSync(target, "utf8");
			if (edited) assert.equal(actual, routed);
			else {
				assert.match(actual, /  - fetch_content/);
				assert.match(actual, /model: custom\/model\nthinking: high/);
				const ownership = JSON.parse(readFileSync(join(agentHome, "jero", "managed-assets.json"), "utf8"));
				assert.equal(ownership.assets["agents/sdd-research.md"], sha256(actual));
				await installSddAssets(temporary, true);
				assert.equal(readFileSync(target, "utf8"), actual, "subsequent refresh keeps adopted model routing");
			}
		}
	} finally {
		if (previous === undefined) delete process.env.JERO_PI_AGENT_HOME;
		else process.env.JERO_PI_AGENT_HOME = previous;
		rmSync(temporary, { recursive: true, force: true });
	}
});

test("the retired Pi adversarial role agents are not packaged", () => {
	// gentle-pi#311 P5: the refuter and targeted validator verdicts execute
	// through Go-owned pi processes via provider-rendered self-contained
	// vectors; the Pi-authored agent definitions must stay deleted.
	for (const retired of RETIRED_ADVERSARIAL_AGENTS) {
		assert.ok(!existsSync(join(PACKAGE_ROOT, "assets", "agents", retired)), `${retired} must stay deleted`);
	}
});

test("forced package installation preserves same-path user-authored agents and separate shadows, including on retired asset paths", async () => {
	// The user-authored file below sits on the RETIRED review-refuter.md path:
	// this also pins that gentle-pi#311 P5 asset retirement deletes only
	// hash-proven package-managed copies, never user content.
	const temporaryAgentHome = mkdtempSync(join(tmpdir(), "gentle-pi-refuter-home-"));
	const temporaryProject = mkdtempSync(join(tmpdir(), "gentle-pi-refuter-project-"));
	const previousAgentHome = process.env.JERO_PI_AGENT_HOME;
	const samePathUserAgent = join(temporaryAgentHome, "agents", RETIRED_REFUTER_FILE);
	const userShadow = join(temporaryAgentHome, "subagents", RETIRED_REFUTER_FILE);
	const projectOverride = join(temporaryProject, ".pi", "agents", RETIRED_REFUTER_FILE);
	const userAgentSource = [
		"---",
		"name: review-refuter",
		"tools:",
		"  - read",
		"  - bash",
		"---",
		"user-authored permission policy",
		"",
	].join("\n");

	try {
		process.env.JERO_PI_AGENT_HOME = temporaryAgentHome;
		mkdirSync(dirname(projectOverride), { recursive: true });
		writeFileSync(projectOverride, "project override must stay\n");
		mkdirSync(dirname(userShadow), { recursive: true });
		writeFileSync(userShadow, "user shadow must stay\n");
		mkdirSync(dirname(samePathUserAgent), { recursive: true });
		writeFileSync(samePathUserAgent, userAgentSource);

		await installSddAssets(temporaryProject, true);

		assert.deepEqual(
			readFileSync(samePathUserAgent),
			Buffer.from(userAgentSource),
			"force refresh must not claim a same-path user agent by filename",
		);
		assert.equal(
			readFileSync(projectOverride, "utf8"),
			"project override must stay\n",
			"package refresh must preserve explicit project overrides",
		);
		assert.equal(
			readFileSync(userShadow, "utf8"),
			"user shadow must stay\n",
			"package refresh must preserve separate user shadows",
		);
	} finally {
		if (previousAgentHome === undefined) {
			delete process.env.JERO_PI_AGENT_HOME;
		} else {
			process.env.JERO_PI_AGENT_HOME = previousAgentHome;
		}
		rmSync(temporaryAgentHome, { recursive: true, force: true });
		rmSync(temporaryProject, { recursive: true, force: true });
	}
});

test("v0.13 ownership evidence is bundled and matches the self-contained upgrade fixture", () => {
	const legacyManifest = JSON.parse(
		readFileSync(V013_MANAGED_ASSETS, "utf8"),
	) as LegacyManagedAssetsManifest;
	const legacyReviewRisk = readFileSync(V013_REVIEW_RISK_FIXTURE, "utf8");

	assert.equal(legacyManifest.packageVersion, "0.13.0");
	assert.equal(
		legacyManifest.assets[`agents/${REVIEW_RISK_FILE}`],
		sha256(legacyReviewRisk),
		"published migration evidence must fingerprint the exact v0.13 package asset",
	);
});

test("v0.14 ownership evidence is bundled and matches the self-contained bounded-review fixture", () => {
	const legacyManifest = JSON.parse(
		readFileSync(V014_MANAGED_ASSETS, "utf8"),
	) as LegacyManagedAssetsManifest;
	const legacyReviewRisk = readFileSync(V014_REVIEW_RISK_FIXTURE, "utf8");

	assert.equal(legacyManifest.packageVersion, "0.14.0");
	assert.equal(
		legacyManifest.assets[`agents/${REVIEW_RISK_FILE}`],
		sha256(legacyReviewRisk),
		"migration evidence must fingerprint the exact pre-transaction v0.14 asset",
	);
});

