import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import {
	companionDependencyDiagnosticLines,
	readCompanionDependencyStatuses,
} from "../lib/jero-ai-companion-deps.ts";
import { PACKAGE_ROOT } from "../lib/jero-ai-paths.ts";

function fixtureTree(): string {
	return mkdtempSync(join(tmpdir(), "jero-companion-deps-"));
}

function writeFixture(
	root: string,
	dependencies: Record<string, string>,
	extensions: string[],
	installed: Record<string, string | false>,
): void {
	writeFileSync(join(root, "package.json"), JSON.stringify({ dependencies, pi: { extensions } }));
	for (const [name, version] of Object.entries(installed)) {
		if (version === false) continue;
		const depRoot = join(root, "node_modules", name);
		mkdirSync(depRoot, { recursive: true });
		writeFileSync(join(depRoot, "package.json"), JSON.stringify({ name, version }));
	}
	for (const entry of extensions) {
		if (!entry.startsWith("node_modules/")) continue;
		const target = join(root, entry);
		mkdirSync(dirname(target), { recursive: true });
		writeFileSync(target, "export default function () {}");
	}
}

test("a healthy exact-pinned dependency with a resolving pi entry passes", () => {
	const root = fixtureTree();
	try {
		writeFixture(
			root,
			{ "pi-lens": "4.1.6" },
			["./extensions", "node_modules/pi-lens/dist/index.js"],
			{ "pi-lens": "4.1.6" },
		);
		const lines = companionDependencyDiagnosticLines(root);
		assert.equal(lines.length, 1);
		assert.match(lines[0]!, /^pass: Companion dependencies 1\/1 healthy/);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("a missing install is a fail with the exit-plan remedy", () => {
	const root = fixtureTree();
	try {
		writeFixture(
			root,
			{ "pi-fovea": "0.27.0" },
			["node_modules/pi-fovea/src/index.ts"],
			{ "pi-fovea": false },
		);
		const lines = companionDependencyDiagnosticLines(root);
		assert.match(lines[0]!, /^fail: Companion pi-fovea not installed \(pinned 0\.27\.0\)/);
		assert.match(lines[0]!, /docs\/dependency-exit-plan\.md/);
		assert.match(lines[1]!, /^warn: Companion dependencies 0\/1 healthy/);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("version drift against an exact pin is a warn, not a silent pass", () => {
	const root = fixtureTree();
	try {
		writeFixture(
			root,
			{ "pi-web-access": "0.29.0" },
			["node_modules/pi-web-access/index.ts"],
			{ "pi-web-access": "0.30.0" },
		);
		const lines = companionDependencyDiagnosticLines(root);
		assert.match(lines[0]!, /^warn: Companion pi-web-access version drift: pinned 0\.29\.0, installed 0\.30\.0/);
		assert.match(lines[1]!, /^warn: Companion dependencies 0\/1 healthy/);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("an unresolvable pi manifest entry is a warn pointing at the exit plan", () => {
	const root = fixtureTree();
	try {
		writeFixture(root, { "pi-pretty": "0.6.14" }, [], { "pi-pretty": "0.6.14" });
		const lines = companionDependencyDiagnosticLines(root);
		assert.match(lines[0]!, /^warn: Companion pi-pretty@0\.6\.14 pi manifest entry missing or unresolved/);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("a non-exact pin stays healthy but is called out as policy drift", () => {
	const root = fixtureTree();
	try {
		writeFixture(
			root,
			{ "pi-lens": "^4.1.6" },
			["node_modules/pi-lens/dist/index.js"],
			{ "pi-lens": "4.9.0" },
		);
		const lines = companionDependencyDiagnosticLines(root);
		assert.match(lines[0]!, /^info: Companion pi-lens@4\.9\.0 pinned "\^4\.1\.6" is not exact/);
		assert.match(lines[1]!, /^pass: Companion dependencies 1\/1 healthy/);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("the shipped package itself stays fully healthy", () => {
	const statuses = readCompanionDependencyStatuses(PACKAGE_ROOT);
	assert.equal(statuses.length, 9, "the exit-plan companion set is nine dependencies");
	const lines = companionDependencyDiagnosticLines(PACKAGE_ROOT);
	const summary = lines[lines.length - 1]!;
	assert.match(summary, /^pass: Companion dependencies 9\/9 healthy/);
	for (const status of statuses) {
		assert.equal(status.exactPinned, true, `${status.name} must stay exact-pinned`);
		assert.equal(status.installedVersion, status.pinned, `${status.name} must match its pin`);
		assert.equal(status.manifestEntries.length, 1, `${status.name} must have exactly one pi manifest entry`);
		assert.equal(status.entriesResolve, true, `${status.name} pi entry must resolve`);
	}
});
