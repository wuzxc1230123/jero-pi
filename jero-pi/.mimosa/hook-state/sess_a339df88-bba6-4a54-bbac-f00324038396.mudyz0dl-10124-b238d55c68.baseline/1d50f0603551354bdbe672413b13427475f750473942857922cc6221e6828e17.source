import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	extractGeneratedRuntimeSources,
	reconcileContractsOnDisk,
	reconcileGeneratedRuntimeSources,
} from "../scripts/verify-package-files.mjs";

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
// (docs/review-integration.md, the relocated telemetry schema) are hash-checked
// directly by the main script; the walk must not demand they appear on disk
// under tests/fixtures/review-integration/.
test("golden-vector walk ignores hash entries rooted outside tests/fixtures/review-integration", () => {
	const fixtureRoot = makeFixtureRoot();
	try {
		mkdirSync(join(fixtureRoot, WALK_ROOT, "v2/schemas"), { recursive: true });
		mkdirSync(join(fixtureRoot, "docs"), { recursive: true });
		writeFileSync(join(fixtureRoot, `${WALK_ROOT}/v2/schemas/status.schema.json`), "{}\n");
		writeFileSync(join(fixtureRoot, "docs/review-integration.md"), "# contract doc\n");

		const { unlistedOnDisk, listedButMissing } = reconcileContractsOnDisk(fixtureRoot, {
			[`${WALK_ROOT}/v2/schemas/status.schema.json`]: "irrelevant-for-this-walk",
			"docs/review-integration.md": "pinned-elsewhere",
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
