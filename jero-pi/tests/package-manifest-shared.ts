// package-manifest 测试共享夹具与助手：自 package-manifest.test.ts 机械平移（语义零改动）。

import { default as assert } from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { default as test } from "node:test";
import { fileURLToPath } from "node:url";
import { applyModelConfig } from "../extensions/jero-ai.ts";
import { resolveJeroPiAgentHome } from "../lib/agent-home.ts";
import { getPackageAssetOwner, installPackageAssets, installSddAssets, type PackageAssetOwner } from "../lib/sdd-preflight.ts";


export const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
export const MANAGED_EXEMPLAR_FILE = "jero-explore.md";
export const RETIRED_REFUTER_FILE = "review-refuter.md";
export const REVIEW_RISK_FILE = "review-risk.md";
export const V013_REVIEW_RISK_FIXTURE = join(
	PACKAGE_ROOT,
	"tests",
	"fixtures",
	"v0.13",
	"assets",
	"agents",
	REVIEW_RISK_FILE,
);
export const V013_MANAGED_ASSETS = join(
	PACKAGE_ROOT,
	"assets",
	"migrations",
	"managed-assets-v0.13.json",
);
export const V014_REVIEW_RISK_FIXTURE = join(
	PACKAGE_ROOT,
	"tests",
	"fixtures",
	"v0.14",
	"assets",
	"agents",
	REVIEW_RISK_FILE,
);
export const V014_MANAGED_ASSETS = join(
	PACKAGE_ROOT,
	"assets",
	"migrations",
	"managed-assets-v0.14.json",
);
// gentle-pi#311 P5: the managed-asset installer mechanism tests use
// jero-explore.md as their exemplar (packaged, absent from the v0.13
// manifest) after review-refuter.md was retired together with every
// Pi-authored adversarial review verdict.
export const MANAGED_EXEMPLAR_TOOLS = ["read", "grep", "find", "fovea_focus", "fovea_sketch", "fovea_dwell"];
export const RETIRED_ADVERSARIAL_AGENTS = ["review-refuter.md", "review-validator.md"];

export interface ManagedAssetsManifest {
	schemaVersion: number;
	assets: Record<string, string>;
}

export interface LegacyManagedAssetsManifest extends ManagedAssetsManifest {
	packageVersion: string;
}

export function sha256(content: string): string {
	return createHash("sha256").update(content).digest("hex");
}

export interface PackageJsonPiManifest {
	extensions?: string[];
	skills?: string[];
}

export interface PackageJson {
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

export function readPackageJson(): PackageJson {
	const rawPackageJson = readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8");

	try {
		return JSON.parse(rawPackageJson) as PackageJson;
	} catch (error) {
		throw new Error("package.json must contain valid JSON", { cause: error });
	}
}

// 助手统一住 shared：分片互相 import 会令被导入分片的顶层 test() 注册在
// 导入方进程里重跑一遍，整个家族的用例被成倍执行。
export function readAgentFrontmatter(file: string): string {
	const source = readFileSync(file, "utf8");
	const match = source.match(/^---\n([\s\S]*?)\n---/);
	assert.ok(match, `${file} must have frontmatter`);
	return match[1];
}

export function readAgentDefinition(file: string): {
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

export function readTextContract(source: string, heading: string): string {
	const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const match = source.match(
		new RegExp(`^## ${escapedHeading}\\n[\\s\\S]*?\\n\\x60\\x60\\x60text\\n([\\s\\S]*?)\\n\\x60\\x60\\x60`, "m"),
	);
	assert.ok(match, `${heading} must include a text contract block`);
	return match[1];
}

export function contractFields(contract: string, indentation = 0): string[] {
	const prefix = " ".repeat(indentation);
	return contract
		.split("\n")
		.flatMap((line) => {
			const match = line.match(new RegExp(`^${prefix}([a-z_]+):`));
			return match ? [match[1]] : [];
		});
}

export function nestedContractFields(contract: string, parent: string): string[] {
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

export function readMarkdownSection(source: string, heading: string): string {
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

export function assertWorkerFallbackRouting(section: string, sectionName: string): void {
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

// P4 落地（设计 §5.3 集成矩阵）：九个伴生 pi-package 是硬依赖，其资源经
// node_modules 路径进 pi manifest 才会被宿主加载（宿主目录扫描跳过
// node_modules；packages.md "Dependencies" 契约）。缺路径时宿主静默跳过，
// 即"依赖存在即用"。禁止 bundledDependencies：pi-pretty/pi-lens 含平台
// 特定原生依赖，必须由宿主安装时的 npm install 按用户平台解析。
export const COMPANION_EXTENSION_REFS: Record<string, string> = {
	"@heyhuynhgiabuu/pi-pretty": "node_modules/@heyhuynhgiabuu/pi-pretty/dist/index.js",
	"@juicesharp/rpiv-ask-user-question": "node_modules/@juicesharp/rpiv-ask-user-question/index.ts",
	"@juicesharp/rpiv-todo": "node_modules/@juicesharp/rpiv-todo/index.ts",
	"billion-context-pi": "node_modules/billion-context-pi/dist/index.js",
	"pi-cache-optimizer": "node_modules/pi-cache-optimizer/index.ts",
	"pi-fovea": "node_modules/pi-fovea/src/index.ts",
	"pi-hashline-edit-pro": "node_modules/pi-hashline-edit-pro/index.ts",
	"pi-lens": "node_modules/pi-lens/dist/index.js",
	"pi-web-access": "node_modules/pi-web-access/index.ts",
};
export const COMPANION_SKILL_REFS = [
	"node_modules/pi-fovea/skills",
	"node_modules/pi-lens/skills",
];
