import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
// .mjs 脚本无类型声明；行为测试只依赖这几个纯函数签名（经动态导入显式标注）。
const packageFilesSpecifier: string = "../scripts/verify-package-files.mjs";
const {
	extractGeneratedRuntimeSources,
	reconcileContractsOnDisk,
	reconcileGeneratedRuntimeSources,
} = await import(packageFilesSpecifier) as {
	extractGeneratedRuntimeSources: (packageRoot: string) => string[];
	reconcileContractsOnDisk: (packageRoot: string, hashes: Record<string, string>) => { unlistedOnDisk: string[]; listedButMissing: string[] };
	reconcileGeneratedRuntimeSources: (packageRoot: string, sources: string[], paths: string[]) => { drifted: Array<{ name: string; inSources: boolean; inRuntimeDir: boolean; inRequiredPaths: boolean }> };
};

function makeFixtureRoot(): string {
	return mkdtempSync(join(tmpdir(), "jero-pi-verify-package-files-"));
}

const WALK_ROOT = "tests/fixtures/review-integration";

test("golden-vector walk fails on a file that exists on disk but is unlisted in contractHashes", () => {
	const fixtureRoot = makeFixtureRoot();
	try {
		const knownRelativePath = `${WALK_ROOT}/v2/schemas/known.schema.json`;
		const unlistedRelativePath = `${WALK_ROOT}/v2/schemas/unlisted.schema.json`;
		mkdirSync(join(fixtureRoot, WALK_ROOT, "v2/schemas"), { recursive: true });
		writeFileSync(join(fixtureRoot, knownRelativePath), "{}\n");
		writeFileSync(join(fixtureRoot, unlistedRelativePath), "{}\n");

		const { unlistedOnDisk, listedButMissing } = reconcileContractsOnDisk(fixtureRoot, {
			[knownRelativePath]: "irrelevant-for-this-walk",
		});

		assert.deepEqual(unlistedOnDisk, [unlistedRelativePath]);
		assert.deepEqual(listedButMissing, []);
	} finally {
		rmSync(fixtureRoot, { recursive: true, force: true });
	}
});

test("golden-vector walk fails on a contractHashes entry that is missing from disk", () => {
	const fixtureRoot = makeFixtureRoot();
	try {
		const missingRelativePath = `${WALK_ROOT}/v2/schemas/missing.schema.json`;
		mkdirSync(join(fixtureRoot, WALK_ROOT, "v2/schemas"), { recursive: true });

		const { unlistedOnDisk, listedButMissing } = reconcileContractsOnDisk(fixtureRoot, {
			[missingRelativePath]: "irrelevant-for-this-walk",
		});

		assert.deepEqual(unlistedOnDisk, []);
		assert.deepEqual(listedButMissing, [missingRelativePath]);
	} finally {
		rmSync(fixtureRoot, { recursive: true, force: true });
	}
});

// Byte-pinned artifacts that live outside the relocated golden-vector tree
// (e.g. the relocated telemetry schema) are hash-checked directly by the main
// script; the walk must not demand they appear on disk under
// tests/fixtures/review-integration/.
test("golden-vector walk ignores hash entries rooted outside tests/fixtures/review-integration", () => {
	const fixtureRoot = makeFixtureRoot();
	try {
		mkdirSync(join(fixtureRoot, WALK_ROOT, "v2/schemas"), { recursive: true });
		writeFileSync(join(fixtureRoot, `${WALK_ROOT}/v2/schemas/status.schema.json`), "{}\n");

		const { unlistedOnDisk, listedButMissing } = reconcileContractsOnDisk(fixtureRoot, {
			[`${WALK_ROOT}/v2/schemas/status.schema.json`]: "irrelevant-for-this-walk",
			"schemas/runtime-aggregate-v1.schema.json": "pinned-elsewhere",
		});

		assert.deepEqual(unlistedOnDisk, []);
		assert.deepEqual(listedButMissing, []);
	} finally {
		rmSync(fixtureRoot, { recursive: true, force: true });
	}
});

test("sources <-> runtime/*.mjs walk fails when a generated runtime file is absent from the generator's sources array", () => {
	const fixtureRoot = makeFixtureRoot();
	try {
		mkdirSync(join(fixtureRoot, "runtime"), { recursive: true });
		writeFileSync(join(fixtureRoot, "runtime/known.mjs"), "// generated\n");
		writeFileSync(join(fixtureRoot, "runtime/orphan.mjs"), "// generated\n");

		const { drifted } = reconcileGeneratedRuntimeSources(
			fixtureRoot,
			["known"],
			["runtime/known.mjs", "runtime/orphan.mjs"],
		);

		assert.deepEqual(drifted, [
			{ name: "orphan", inSources: false, inRuntimeDir: true, inRequiredPaths: true },
		]);
	} finally {
		rmSync(fixtureRoot, { recursive: true, force: true });
	}
});

test("sources <-> runtime/*.mjs walk fails when a sources entry is absent from requiredPaths", () => {
	const fixtureRoot = makeFixtureRoot();
	try {
		mkdirSync(join(fixtureRoot, "runtime"), { recursive: true });
		writeFileSync(join(fixtureRoot, "runtime/known.mjs"), "// generated\n");
		writeFileSync(join(fixtureRoot, "runtime/unrequired.mjs"), "// generated\n");

		const { drifted } = reconcileGeneratedRuntimeSources(
			fixtureRoot,
			["known", "unrequired"],
			["runtime/known.mjs"],
		);

		assert.deepEqual(drifted, [
			{ name: "unrequired", inSources: true, inRuntimeDir: true, inRequiredPaths: false },
		]);
	} finally {
		rmSync(fixtureRoot, { recursive: true, force: true });
	}
});

test("extractGeneratedRuntimeSources reads the generator's sources array without importing it", () => {
	const fixtureRoot = makeFixtureRoot();
	try {
		mkdirSync(join(fixtureRoot, "scripts"), { recursive: true });
		writeFileSync(
			join(fixtureRoot, "scripts/build-runtime-modules.mjs"),
			'const sources = [\n\t"native-review-cli",\n\t"review-integration-v2",\n];\nexport {};\n',
		);

		assert.deepEqual(extractGeneratedRuntimeSources(fixtureRoot), [
			"native-review-cli",
			"review-integration-v2",
		]);
	} finally {
		rmSync(fixtureRoot, { recursive: true, force: true });
	}
});

test("extractGeneratedRuntimeSources fails loudly on a generator that lost its sources array", () => {
	const fixtureRoot = makeFixtureRoot();
	try {
		mkdirSync(join(fixtureRoot, "scripts"), { recursive: true });
		writeFileSync(join(fixtureRoot, "scripts/build-runtime-modules.mjs"), "export {};\n");

		assert.throws(() => extractGeneratedRuntimeSources(fixtureRoot), /does not declare a "sources" array/);
	} finally {
		rmSync(fixtureRoot, { recursive: true, force: true });
	}
});

test("both walks report no drift when sources, runtime/*.mjs, requiredPaths, and contractHashes fully agree", () => {
	const fixtureRoot = makeFixtureRoot();
	try {
		mkdirSync(join(fixtureRoot, WALK_ROOT, "v2/schemas"), { recursive: true });
		mkdirSync(join(fixtureRoot, "runtime"), { recursive: true });
		writeFileSync(join(fixtureRoot, `${WALK_ROOT}/v2/schemas/status.schema.json`), "{}\n");
		writeFileSync(join(fixtureRoot, "runtime/known.mjs"), "// generated\n");

		const contractsResult = reconcileContractsOnDisk(fixtureRoot, {
			[`${WALK_ROOT}/v2/schemas/status.schema.json`]: "irrelevant-for-this-walk",
		});
		const sourcesResult = reconcileGeneratedRuntimeSources(
			fixtureRoot,
			["known"],
			["runtime/known.mjs"],
		);

		assert.deepEqual(contractsResult, { unlistedOnDisk: [], listedButMissing: [] });
		assert.deepEqual(sourcesResult, { drifted: [] });
	} finally {
		rmSync(fixtureRoot, { recursive: true, force: true });
	}
});

// 清单完备性棘轮：上面的函数测试全部跑在合成夹具上，从未拿真
// requiredPaths 对真盘面——历史两批缺口（5 个扩展入口、5 个技能
// SKILL.md、8 个技能参考件与 schemas/module.schema.json）正是从这个
// 缝里静默漏过的（真机冒烟批审计发现）。以下把"盘面承重面必须被
// 清单收录"钉成结构不变量：新增扩展/技能/提示词模板/schema/模块束
// 心而忘了登记打包门，测试先红，不再依赖人工记清单。

const PACKAGE_ROOT = join(import.meta.dirname, "..");
const GATE_SOURCE = readFileSync(join(PACKAGE_ROOT, "scripts", "verify-package-files.mjs"), "utf8");

function assertListed(relativePath: string): void {
	assert.ok(GATE_SOURCE.includes(`"${relativePath}"`), `打包门 requiredPaths 缺录：${relativePath}`);
}

test("每个扩展入口都在打包门清单", () => {
	for (const name of readdirSync(join(PACKAGE_ROOT, "extensions")).filter((file) => file.endsWith(".ts"))) {
		assertListed(`extensions/${name}`);
	}
});

test("每个技能的 SKILL.md 与 references/assets 文件都在打包门清单", () => {
	for (const entry of readdirSync(join(PACKAGE_ROOT, "skills"), { withFileTypes: true })) {
		if (!entry.isDirectory() || entry.name === "_shared") continue;
		assertListed(`skills/${entry.name}/SKILL.md`);
		for (const sub of ["references", "assets"]) {
			const directory = join(PACKAGE_ROOT, "skills", entry.name, sub);
			if (!existsSync(directory)) continue;
			for (const file of readdirSync(directory).filter((name) => name.endsWith(".md") || name.endsWith(".yaml"))) {
				assertListed(`skills/${entry.name}/${sub}/${file}`);
			}
		}
	}
});

test("每个提示词模板与发布 schema 都在打包门清单", () => {
	for (const name of readdirSync(join(PACKAGE_ROOT, "prompts")).filter((file) => file.endsWith(".md"))) {
		assertListed(`prompts/${name}`);
	}
	for (const name of readdirSync(join(PACKAGE_ROOT, "schemas")).filter((file) => file.endsWith(".json"))) {
		assertListed(`schemas/${name}`);
	}
});

test("每个模块束的清单与知识入口都在打包门清单", () => {
	for (const entry of readdirSync(join(PACKAGE_ROOT, "assets", "modules"), { withFileTypes: true })) {
		if (!entry.isDirectory()) continue;
		assertListed(`assets/modules/${entry.name}/module.json`);
		assertListed(`assets/modules/${entry.name}/knowledge/SKILL.md`);
	}
});
