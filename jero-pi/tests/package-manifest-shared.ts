// package-manifest 测试共享夹具与助手：自 package-manifest.test.ts 机械平移（语义零改动）。

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

