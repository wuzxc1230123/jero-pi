import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
	existsSync,
	mkdtempSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { applyModelConfig } from "../extensions/jero-ai.ts";
import { resolveGentlePiAgentHome } from "../lib/agent-home.ts";
import { getPackageAssetOwner, installPackageAssets, installSddAssets, type PackageAssetOwner } from "../lib/sdd-preflight.ts";

const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const MANAGED_EXEMPLAR_FILE = "jero-explore.md";
const RETIRED_REFUTER_FILE = "review-refuter.md";
const REVIEW_RISK_FILE = "review-risk.md";
const V013_REVIEW_RISK_FIXTURE = join(
	PACKAGE_ROOT,
	"tests",
	"fixtures",
	"v0.13",
	"assets",
	"agents",
	REVIEW_RISK_FILE,
);
const V013_MANAGED_ASSETS = join(
	PACKAGE_ROOT,
	"assets",
	"migrations",
	"managed-assets-v0.13.json",
);
const V014_REVIEW_RISK_FIXTURE = join(
	PACKAGE_ROOT,
	"tests",
	"fixtures",
	"v0.14",
	"assets",
	"agents",
	REVIEW_RISK_FILE,
);
const V014_MANAGED_ASSETS = join(
	PACKAGE_ROOT,
	"assets",
	"migrations",
	"managed-assets-v0.14.json",
);
// gentle-pi#311 P5: the managed-asset installer mechanism tests use
// jero-explore.md as their exemplar (packaged, absent from the v0.13
// manifest) after review-refuter.md was retired together with every
// Pi-authored adversarial review verdict.
const MANAGED_EXEMPLAR_TOOLS = ["read", "grep", "find", "fovea_focus", "fovea_sketch", "fovea_dwell"];
const RETIRED_ADVERSARIAL_AGENTS = ["review-refuter.md", "review-validator.md"];

interface ManagedAssetsManifest {
	schemaVersion: number;
	assets: Record<string, string>;
}

interface LegacyManagedAssetsManifest extends ManagedAssetsManifest {
	packageVersion: string;
}

function sha256(content: string): string {
	return createHash("sha256").update(content).digest("hex");
}

interface PackageJsonPiManifest {
	extensions?: string[];
}

interface PackageJson {
	version?: string;
	files?: string[];
	scripts?: Record<string, string>;
	dependencies?: Record<string, string>;
	peerDependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
	bundledDependencies?: string[];
	bundleDependencies?: string[];
	repository?: {
		type?: string;
		url?: string;
	};
	pi?: PackageJsonPiManifest;
}

function readPackageJson(): PackageJson {
	const rawPackageJson = readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8");

	try {
		return JSON.parse(rawPackageJson) as PackageJson;
	} catch (error) {
		throw new Error("package.json must contain valid JSON", { cause: error });
	}
}

test("technical reference declares the tested Pi minimum required for agent_settled", () => {
	const manifest = readPackageJson();
	assert.equal(manifest.peerDependencies?.["@earendil-works/pi-coding-agent"], ">=0.85.1");
	assert.equal(manifest.devDependencies?.["@earendil-works/pi-coding-agent"], "0.85.1");
	const reference = readFileSync(join(PACKAGE_ROOT, "docs", "jero-reference.md"), "utf8");
	assert.match(reference, /Pi 0\.85\.1 or newer/);
	assert.match(reference, /agent_settled/);
	assert.match(readFileSync(join(PACKAGE_ROOT, "README.md"), "utf8"), /\]\(docs\/jero-reference\.md(?:#[^)]+)?\)/);
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
	// jero-pi P4 TODO: restore test:packed-package (scripts/test-packed-runner.mjs)
	// together with prepack/prepublishOnly wiring once the release gates land.
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

test("package manifest installs pi-pretty through a wrapper without bundling native optional dependencies", () => {
	const packageJson = readPackageJson();

	assert.equal(
		packageJson.dependencies?.["@heyhuynhgiabuu/pi-pretty"],
		"0.6.14",
		"gentle-pi must install the tested pi-pretty version as a normal dependency",
	);
	assert.ok(
		packageJson.pi?.extensions?.includes("./extensions"),
		"gentle-pi must load packaged extension wrappers",
	);
	assert.ok(
		!packageJson.pi?.extensions?.includes(
			"./node_modules/@heyhuynhgiabuu/pi-pretty/dist/index.js",
		),
		"gentle-pi must not reference pnpm-unportable nested node_modules paths",
	);
	assert.ok(
		!packageJson.bundledDependencies?.includes("@heyhuynhgiabuu/pi-pretty"),
		"pi-pretty must not be bundled because its native optional dependencies are platform-specific",
	);
	assert.ok(
		!packageJson.bundleDependencies?.includes("@heyhuynhgiabuu/pi-pretty"),
		"pi-pretty must not be bundled because its native optional dependencies are platform-specific",
	);
});

test("package verification pins the relocated golden vectors as the behavioral spec", () => {
	const verifier = readFileSync(join(PACKAGE_ROOT, "scripts", "verify-package-files.mjs"), "utf8");

	// The upstream contract artifacts moved to tests/fixtures/review-integration
	// and stay byte-pinned (design §5.1.7): they are the spec lib/authority/
	// conformance is graded against at P2.
	assert.match(verifier, /tests\/fixtures\/review-integration\/v1\/fixtures\/status\.fixture\.json/);
	assert.match(verifier, /tests\/fixtures\/review-integration\/v2\/fixtures\/status\.fixture\.json/);
	assert.match(verifier, /docs\/review-integration\.md/);
});

function readAgentFrontmatter(file: string): string {
	const source = readFileSync(file, "utf8");
	const match = source.match(/^---\n([\s\S]*?)\n---/);
	assert.ok(match, `${file} must have frontmatter`);
	return match[1];
}

function readAgentDefinition(file: string): {
	name: string;
	source: string;
	tools: string[];
} {
	const source = readFileSync(file, "utf8");
	const frontmatter = readAgentFrontmatter(file);
	const name = frontmatter.match(/^name:\s*(\S+)$/m)?.[1];
	assert.ok(name, `${file} must declare a frontmatter name`);
	const toolsBlock = frontmatter.match(
		/^tools:\n(?: {2}- "\*": false\n)?((?: {2}- [\w-]+\n?)+)/m,
	)?.[1];
	assert.ok(toolsBlock, `${file} must declare a YAML tool list`);
	const tools = [...toolsBlock.matchAll(/^ {2}- ([\w-]+)$/gm)].map(
		(match) => match[1],
	);

	return { name, source, tools };
}

function readTextContract(source: string, heading: string): string {
	const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const match = source.match(
		new RegExp(`^## ${escapedHeading}\\n[\\s\\S]*?\\n\\x60\\x60\\x60text\\n([\\s\\S]*?)\\n\\x60\\x60\\x60`, "m"),
	);
	assert.ok(match, `${heading} must include a text contract block`);
	return match[1];
}

function contractFields(contract: string, indentation = 0): string[] {
	const prefix = " ".repeat(indentation);
	return contract
		.split("\n")
		.flatMap((line) => {
			const match = line.match(new RegExp(`^${prefix}([a-z_]+):`));
			return match ? [match[1]] : [];
		});
}

function nestedContractFields(contract: string, parent: string): string[] {
	const lines = contract.split("\n");
	const parentIndexes = lines.flatMap((line, index) =>
		line.startsWith(`${parent}:`) ? [index] : [],
	);
	assert.equal(parentIndexes.length, 1, `${parent} must appear exactly once at top level`);

	const tail = lines.slice(parentIndexes[0] + 1);
	const relativeEnd = tail.findIndex((line) => /^\S/.test(line));
	const nestedBlock = relativeEnd === -1 ? tail : tail.slice(0, relativeEnd);

	return contractFields(nestedBlock.join("\n"), 2);
}

function readMarkdownSection(source: string, heading: string): string {
	const lines = source.split(/\r?\n/);
	const matches = lines.flatMap((line, index) => {
		const match = line.match(/^(#{1,6})\s+(.+?)\s*$/);
		return match?.[2] === heading
			? [{ index, level: match[1].length }]
			: [];
	});
	assert.equal(matches.length, 1, `Markdown must contain exactly one ${heading} section`);

	const [{ index: start, level }] = matches;
	const relativeEnd = lines.slice(start + 1).findIndex((line) => {
		const match = line.match(/^(#{1,6})\s+/);
		return match !== null && match[1].length <= level;
	});
	const end = relativeEnd === -1 ? lines.length : start + 1 + relativeEnd;

	return lines.slice(start + 1, end).join("\n").trim();
}

function assertWorkerFallbackRouting(section: string, sectionName: string): void {
	const boundedWriterPolicy = section.match(
		/对有界多文件写入，[\s\S]*?(?=\n\n|\n\s*\d+\.|$)/,
	)?.[0];
	assert.ok(boundedWriterPolicy, `${sectionName} must define bounded writer routing`);

	const preferred = boundedWriterPolicy.indexOf("`jero-worker`");
	const configuredFallback = boundedWriterPolicy.indexOf("用户配置的 `worker`");
	const nativeFallback = boundedWriterPolicy.indexOf("原生 `Agent`");

	assert.ok(preferred >= 0, `${sectionName} must reference exact jero-worker name`);
	assert.ok(
		configuredFallback > preferred,
		`${sectionName} must prefer the package-owned worker before a user-configured worker`,
	);
	assert.ok(
		nativeFallback > configuredFallback,
		`${sectionName} must place native Agent after both named worker definitions`,
	);
	assert.match(
		boundedWriterPolicy,
		/若两个写者定义都不存在[^。]*原生 `Agent`[^。]*即使 `subagent_\*` 工具可用。/,
		`${sectionName} must choose native Agent when neither worker definition exists`,
	);
	assert.match(
		section,
		/若无(?:任何)?委托机制可用，停止/,
		`${sectionName} must stop when delegation is impossible`,
	);
}

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
const UNSUPPORTED_CHILD_SESSION_TOOLS = ["glob", "webfetch"];

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

function withIsolatedAssetHome(run: (agentHome: string) => void): void {
	const temporary = mkdtempSync(join(tmpdir(), "gentle-asset-owners-"));
	const previous = process.env.JERO_PI_AGENT_HOME;
	try {
		process.env.JERO_PI_AGENT_HOME = temporary;
		run(temporary);
	} finally {
		if (previous === undefined) delete process.env.JERO_PI_AGENT_HOME;
		else process.env.JERO_PI_AGENT_HOME = previous;
		rmSync(temporary, { recursive: true, force: true });
	}
}

function installedAssetManifest(agentHome: string): ManagedAssetsManifest {
	const jero = join(agentHome, "jero", "managed-assets.json");
	return JSON.parse(readFileSync(existsSync(jero) ? jero : join(agentHome, "jero", "managed-assets.json"), "utf8"));
}

test("selective delegation installation owns only generic agents", () => {
	withIsolatedAssetHome((agentHome) => {
		const result = installPackageAssets(agentHome, false, ["delegation"]);
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

test("selective installation retires only assets belonging to the selected owner", () => {
	withIsolatedAssetHome((agentHome) => {
		installSddAssets(agentHome, false);
		const manifestPath = join(agentHome, "jero", "managed-assets.json");
		const manifest = installedAssetManifest(agentHome);
		for (const name of RETIRED_ADVERSARIAL_AGENTS) {
			writeFileSync(join(agentHome, "agents", name), "Previously managed review agent\n");
			manifest.assets[`agents/${name}`] = sha256("Previously managed review agent\n");
		}
		writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
		for (const owner of ["delegation", "sdd"] as const) {
			installPackageAssets(agentHome, true, [owner]);
			assert.deepEqual(installedAssetManifest(agentHome), manifest);
			for (const name of RETIRED_ADVERSARIAL_AGENTS) {
				assert.equal(readFileSync(join(agentHome, "agents", name), "utf8"), "Previously managed review agent\n");
			}
		}
		writeFileSync(join(agentHome, "agents", "review-validator.md"), "User-modified retired agent\n");
		installPackageAssets(agentHome, false, ["review"]);
		assert.equal(existsSync(join(agentHome, "agents", "review-refuter.md")), false);
		assert.equal(readFileSync(join(agentHome, "agents", "review-validator.md"), "utf8"), "User-modified retired agent\n");
		for (const name of RETIRED_ADVERSARIAL_AGENTS) {
			assert.equal(installedAssetManifest(agentHome).assets[`agents/${name}`], undefined);
		}
	});
});

const EXPECTED_OWNER_ASSETS: Record<PackageAssetOwner, readonly string[]> = {
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

function assetFileKeys(root: string, prefix = ""): string[] {
	if (!existsSync(root)) return [];
	return readdirSync(root, { withFileTypes: true }).flatMap(entry => {
		const key = `${prefix}${entry.name}`;
		return entry.isDirectory() ? assetFileKeys(join(root, entry.name), `${key}/`) : [key];
	}).sort();
}

for (const owner of Object.keys(EXPECTED_OWNER_ASSETS) as PackageAssetOwner[]) {
	test(`selective ${owner} installation covers its catalog without cross-owner files`, () => {
		withIsolatedAssetHome((agentHome) => {
			const expected = [...EXPECTED_OWNER_ASSETS[owner]].sort();
			installPackageAssets(agentHome, false, [owner]);
			assert.deepEqual(Object.keys(installedAssetManifest(agentHome).assets).sort(), expected);
			assert.deepEqual(assetFileKeys(agentHome), [...expected, "jero/managed-assets.json"].sort());
			for (const key of expected) {
				assert.equal(getPackageAssetOwner(key), owner);
				const source = join(PACKAGE_ROOT, "assets", key.replace(/^jero\//, ""));
				assert.equal(readFileSync(join(agentHome, key), "utf8"), readFileSync(source, "utf8"));
			}
			const counts = installPackageAssets(agentHome, false, [owner, owner]);
			assert.deepEqual(counts, { agents: 0, chains: 0, support: 0, skipped: expected.length });
		});
	});
}

test("legacy all-assets installation covers every packaged file with explicit ownership", () => {
	const packaged = ["agents", "chains", "support"].flatMap(group =>
		assetFileKeys(join(PACKAGE_ROOT, "assets", group), group === "support" ? "jero/support/" : `${group}/`),
	).sort();
	assert.deepEqual(packaged, Object.values(EXPECTED_OWNER_ASSETS).flat().sort());
	for (const key of packaged) assert.notEqual(getPackageAssetOwner(key), undefined, key);
	for (const key of ["agents/sdd-new.md", "jero/support/new.md", "toString", "__proto__"]) {
		assert.equal(getPackageAssetOwner(key), undefined, "unknown assets must not default to SDD");
	}
	withIsolatedAssetHome((agentHome) => {
		assert.deepEqual(installSddAssets(agentHome, false), { agents: 24, chains: 4, support: 3, skipped: 0 });
		assert.deepEqual(Object.keys(installedAssetManifest(agentHome).assets).sort(), packaged);
		assert.deepEqual(installSddAssets(agentHome, false), { agents: 0, chains: 0, support: 0, skipped: 31 });
		assert.deepEqual(installSddAssets(agentHome, true), { agents: 24, chains: 4, support: 3, skipped: 0 });
	});
});

test("selective refresh preserves unselected ownership and selected user changes after an all-assets install", () => {
	withIsolatedAssetHome((agentHome) => {
		installSddAssets(agentHome, false);
		const manifest = installedAssetManifest(agentHome);
		const selectedUserKey = "agents/jero-explore.md";
		const unselectedUserKey = "agents/sdd-apply.md";
		for (const key of [selectedUserKey, unselectedUserKey, "agents/custom.md"]) {
			writeFileSync(join(agentHome, key), "User-authored instructions\n");
		}
		const before = new Map(assetFileKeys(agentHome).map(key => [key, readFileSync(join(agentHome, key), "utf8")]));
		assert.deepEqual(installPackageAssets(agentHome, true, ["delegation"]), { agents: 2, chains: 0, support: 0, skipped: 1 });
		delete manifest.assets[selectedUserKey];
		assert.deepEqual(installedAssetManifest(agentHome), manifest);
		for (const [key, content] of before) {
			if (key !== "jero/managed-assets.json") assert.equal(readFileSync(join(agentHome, key), "utf8"), content, key);
		}
		const manifestBytes = readFileSync(join(agentHome, "jero", "managed-assets.json"), "utf8");
		assert.deepEqual(installPackageAssets(agentHome, true, []), { agents: 0, chains: 0, support: 0, skipped: 0 });
		assert.equal(readFileSync(join(agentHome, "jero", "managed-assets.json"), "utf8"), manifestBytes);
	});
});

test("selective review migration adopts only untouched legacy copies and preserves routing", () => {
	for (const edited of [false, true]) {
		withIsolatedAssetHome((agentHome) => {
			mkdirSync(join(agentHome, "agents"));
			const legacy = readFileSync(V014_REVIEW_RISK_FIXTURE, "utf8")
				.replace("name: review-risk\n", "name: review-risk\nmodel: custom/model\nthinking: high\n")
				+ (edited ? "\nUser review restrictions.\n" : "");
			const target = join(agentHome, "agents", REVIEW_RISK_FILE);
			writeFileSync(target, legacy);
			installPackageAssets(agentHome, true, ["delegation"]);
			assert.equal(readFileSync(target, "utf8"), legacy);
			assert.equal(installedAssetManifest(agentHome).assets["agents/review-risk.md"], undefined);
			const result = installPackageAssets(agentHome, true, ["review"]);
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

test("unowned legacy research migrates by exact normalized hash, preserving routing and user edits", () => {
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
			installSddAssets(temporary, true);
			const actual = readFileSync(target, "utf8");
			if (edited) assert.equal(actual, routed);
			else {
				assert.match(actual, /  - fetch_content/);
				assert.match(actual, /model: custom\/model\nthinking: high/);
				const ownership = JSON.parse(readFileSync(join(agentHome, "jero", "managed-assets.json"), "utf8"));
				assert.equal(ownership.assets["agents/sdd-research.md"], sha256(actual));
				installSddAssets(temporary, true);
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

test("forced package installation preserves same-path user-authored agents and separate shadows, including on retired asset paths", () => {
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

		installSddAssets(temporaryProject, true);

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

test("first forced sync migrates untouched v0.13 assets, preserves routing, and owns new assets", () => {
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

		installSddAssets(PACKAGE_ROOT, true);

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
		installSddAssets(PACKAGE_ROOT, true);
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

test("first forced sync migrates untouched v0.14 review contracts and preserves routing", () => {
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

		installSddAssets(PACKAGE_ROOT, true);

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

test("first forced sync preserves a body-edited v0.13 asset byte-for-byte", () => {
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

		installSddAssets(PACKAGE_ROOT, true);

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

test("forced package installation refreshes an asset recorded as package-managed", () => {
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
		installSddAssets(PACKAGE_ROOT, true);
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

		installSddAssets(PACKAGE_ROOT, true);

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

function assertManagedAgentUserEditIsPreserved(
	editLabel: string,
	editSource: (source: string) => string,
): void {
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
		installSddAssets(PACKAGE_ROOT, true);
		const installedSource = readFileSync(installedExemplar, "utf8");
		const userEditedSource = editSource(installedSource);
		assert.notEqual(userEditedSource, installedSource, `${editLabel} must alter the asset`);
		writeFileSync(installedExemplar, userEditedSource);

		installSddAssets(PACKAGE_ROOT, true);

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

test("forced package installation preserves a model-only edit to a managed agent", () => {
	assertManagedAgentUserEditIsPreserved("a model-only user edit", (source) =>
		source.replace(
			"name: jero-explore\n",
			"name: jero-explore\nmodel: private/user-model\n",
		),
	);
});

test("forced package installation preserves a thinking-only edit to a managed agent", () => {
	assertManagedAgentUserEditIsPreserved("a thinking-only user edit", (source) =>
		source.replace(
			"name: jero-explore\n",
			"name: jero-explore\nthinking: xhigh\n",
		),
	);
});

test("forced package installation preserves an ordinary body edit to a managed agent", () => {
	assertManagedAgentUserEditIsPreserved("an ordinary body edit", (source) =>
		source.replace(
			"你是通用非 SDD 工作的只读探索者。",
			"保留这条用户撰写的正文修改。你是通用非 SDD 工作的只读探索者。",
		),
	);
});

test("package model assignment keeps only package-managed agents owned", () => {
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
		installSddAssets(PACKAGE_ROOT, true);
		writeFileSync(userAgent, userAgentSource);

		applyModelConfig(PACKAGE_ROOT, {
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

		installSddAssets(PACKAGE_ROOT, true);
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

test("installSddAssets installs jero-worker with a loader-compatible scoped identity", () => {
	const temporaryAgentHome = mkdtempSync(join(tmpdir(), "gentle-pi-agent-home-"));
	const previousAgentHome = process.env.JERO_PI_AGENT_HOME;

	try {
		process.env.JERO_PI_AGENT_HOME = temporaryAgentHome;
		installSddAssets(PACKAGE_ROOT, true);

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

test("asset installation uses PI_CODING_AGENT_DIR as the Pi agent home when no explicit Gentle override is set", () => {
	const previousAgentHome = process.env.JERO_PI_AGENT_HOME;
	const previousPiAgentDir = process.env.PI_CODING_AGENT_DIR;
	const temporaryPiAgentDir = mkdtempSync(join(tmpdir(), "gentle-pi-agent-dir-"));
	const explicitGentleHome = mkdtempSync(join(tmpdir(), "gentle-pi-explicit-home-"));

	try {
		delete process.env.JERO_PI_AGENT_HOME;
		process.env.PI_CODING_AGENT_DIR = temporaryPiAgentDir;

		installSddAssets(PACKAGE_ROOT, true);

		const installedPath = join(temporaryPiAgentDir, "agents", "jero-explore.md");
		assert.ok(existsSync(installedPath), "managed agents must install where Pi Subagents reads global definitions");
		assert.deepEqual(readAgentDefinition(installedPath).tools, MANAGED_EXEMPLAR_TOOLS);
		assert.ok(
			!existsSync(join(explicitGentleHome, "agents", "jero-explore.md")),
			"the explicit override fixture must still be untouched before it is selected",
		);

		process.env.JERO_PI_AGENT_HOME = explicitGentleHome;
		installSddAssets(PACKAGE_ROOT, true);
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

test("global model routing uses PI_CODING_AGENT_DIR for package-installed agents", () => {
	const previousAgentHome = process.env.JERO_PI_AGENT_HOME;
	const previousPiAgentDir = process.env.PI_CODING_AGENT_DIR;
	const temporaryPiAgentDir = mkdtempSync(join(tmpdir(), "gentle-pi-model-agent-dir-"));
	const temporaryProject = mkdtempSync(join(tmpdir(), "gentle-pi-model-project-"));

	try {
		delete process.env.JERO_PI_AGENT_HOME;
		process.env.PI_CODING_AGENT_DIR = temporaryPiAgentDir;
		installSddAssets(PACKAGE_ROOT, true);

		const result = applyModelConfig(temporaryProject, {
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

test("normal and forced installation copy generic agents with complete role contracts", () => {
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
				installSddAssets(PACKAGE_ROOT, force);

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
