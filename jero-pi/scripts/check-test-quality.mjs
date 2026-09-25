#!/usr/bin/env node
// Test-quality gate: ratchets a small set of test anti-patterns to zero.
//
// Tests rot in characteristic ways: assertions that can never fail, skips
// without a reason, assertions on measured wall-clock durations (flaky by
// construction), and sleeps that slow the suite or mask races. This gate
// counts those patterns per (file, rule) and fails when any count grows or
// the total grows — same ratchet shape as check-types.mjs. Existing hits
// live in scripts/test-quality-baseline.json; fix them (or justify them with
// a line-level escape comment) and refresh the baseline with `--update`.
//
// Scope: every .ts file under tests/ (test files plus their shared helpers).
// Zero dependencies, offline; this is a text scan, not an AST pass — rules
// are deliberately shaped to under-trigger, and the escape comment is the
// pressure valve for the residue.
//
// Usage:
//   node scripts/check-test-quality.mjs            fail on any new hit
//   node scripts/check-test-quality.mjs --update   rewrite the baseline, exit 0
//   node scripts/check-test-quality.mjs --list     print all current hits

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const testsRoot = join(packageRoot, "tests");
const baselinePath = join(packageRoot, "scripts", "test-quality-baseline.json");
const ESCAPE = "allow-test-rule:";

// name -> [pattern, label]. Each pattern must under-trigger by design: a
// false negative costs nothing (the ratchet holds the rest), a false positive
// burns trust in the gate.
const RULES = [
	{
		name: "no-pass-always",
		pattern: /assert\.ok\(\s*true\s*[,)]|\(\)\s*=>\s*assert\(true\)|assert\.equal\(\s*true\s*,\s*true\s*\)/,
		label: "assertion that can never fail (pass-always)",
	},
	{
		name: "no-empty-skip-reason",
		pattern: /\.skip\(\s*\)/,
		label: "t.skip() without a stated reason",
	},
	{
		name: "no-elapsed-assertion",
		// A bare measured-duration identifier (not a property access like
		// error.elapsedMs, not a formatter call like formatElapsed(...))
		// compared against a numeric bound inside an assert call.
		pattern: /assert\.[a-z]+\(.*(?<![.\w])(?:elapsed\w*|duration(?:_?[Mm]s)?|took\w*|wall_?[Mm]s)\s*[<>]=?\s*\d/,
		label: "assertion on measured wall-clock duration (flaky by construction)",
	},
	{
		name: "no-magic-sleep",
		pattern: /sleepSync\(|Atomics\.wait\(|setTimeout\(\s*[^,\s)]+\s*,\s*(?:\d{4,}|[5-9]\d{3})\s*[,)]/,
		label: "sleep/wait of >=1s (or sync block) in tests",
	},
];

function listTestFiles() {
	const out = [];
	const walk = (dir) => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const path = join(dir, entry.name);
			if (entry.isDirectory()) walk(path);
			else if (entry.name.endsWith(".ts")) out.push(path);
		}
	};
	walk(testsRoot);
	return out.sort();
}

function scan() {
	const hits = [];
	for (const file of listTestFiles()) {
		const lines = readFileSync(file, "utf8").split("\n");
		for (const [index, line] of lines.entries()) {
			for (const rule of RULES) {
				if (!rule.pattern.test(line)) continue;
				const context = lines.slice(Math.max(0, index - 1), index + 2).join("\n");
				if (context.includes(`${ESCAPE} ${rule.name}`) || context.includes(`${ESCAPE}${rule.name}`)) continue;
				hits.push({ file: relativeToPackage(file), line: index + 1, rule: rule.name, label: rule.label, text: line.trim().slice(0, 160) });
			}
		}
	}
	return hits;
}

function relativeToPackage(file) {
	return file.slice(packageRoot.length + 1).split("\\").join("/");
}

function keyOf(hit) {
	return `${hit.file}|${hit.rule}`;
}

function main() {
	const update = process.argv.includes("--update");
	const list = process.argv.includes("--list");
	const hits = scan();
	if (list || update) {
		for (const hit of hits) console.log(`${hit.file}:${hit.line} [${hit.rule}] ${hit.label}\n    ${hit.text}`);
	}
	const counts = new Map();
	for (const hit of hits) counts.set(keyOf(hit), (counts.get(keyOf(hit)) ?? 0) + 1);
	if (update) {
		writeFileSync(baselinePath, `${JSON.stringify({ total: hits.length, byFileAndRule: Object.fromEntries([...counts.entries()].sort()) }, null, "\t")}\n`);
		console.log(`baseline written: ${hits.length} hit(s) across ${counts.size} (file, rule) pair(s)`);
		return;
	}
	let baseline;
	try {
		baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
	} catch {
		console.error(`test-quality baseline missing at ${relativeToPackage(baselinePath)}; run: node scripts/check-test-quality.mjs --update`);
		process.exit(1);
	}
	const baselineTotal = baseline.total ?? 0;
	const regressions = [];
	const seen = new Set(counts.keys());
	for (const [key, count] of counts) {
		const allowed = baseline.byFileAndRule?.[key] ?? 0;
		if (count > allowed) regressions.push(`${key}: ${count} > baseline ${allowed}`);
	}
	for (const [key, allowed] of Object.entries(baseline.byFileAndRule ?? {})) {
		if (!seen.has(key) && allowed > 0) console.log(`improvement: ${key} cleared (baseline ${allowed} -> 0); consider --update to shrink the baseline`);
	}
	if (regressions.length > 0 || hits.length > baselineTotal) {
		console.error(`test-quality gate failed: ${hits.length} hit(s) vs baseline ${baselineTotal}`);
		for (const line of regressions) console.error(`  ${line}`);
		for (const hit of hits.filter((candidate) => (baseline.byFileAndRule?.[keyOf(candidate)] ?? 0) === 0)) {
			console.error(`  new ${hit.file}:${hit.line} [${hit.rule}] ${hit.label}\n    ${hit.text}`);
		}
		console.error(`fix the pattern, or justify it with a line comment: ${ESCAPE}<rule-name>`);
		process.exit(1);
	}
	console.log(`test-quality gate passed: ${hits.length} hit(s), at or below baseline ${baselineTotal}`);
}

main();
