#!/usr/bin/env node
// Type gate: holds the diagnostic baseline at its current level.
//
// `tsc --noEmit` is compared against scripts/types-baseline.json by
// (file, error code) counts: the gate fails when the number of diagnostics
// grows for any pair, or when the total grows. The baseline is currently zero
// (the repository compiles cleanly), so the gate's job is to keep it there —
// any new diagnostic fails the build until it is fixed or the baseline is
// consciously refreshed with `--update` after review.
//
// Known blind spot, stated rather than hidden: keying on (file, code) counts is
// what keeps the baseline stable while files are edited, because line numbers
// shift. A single change that removes one diagnostic and introduces another of
// the same code in the same file therefore passes. With a zero baseline the
// total check alone already catches everything; the per-pair keying only
// matters again if the baseline is ever raised above zero.
//
// Usage:
//   node scripts/check-types.mjs            fail on any new diagnostic
//   node scripts/check-types.mjs --update   rewrite the baseline and exit 0

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const baselinePath = join(packageRoot, "scripts", "types-baseline.json");
const configPath = join(packageRoot, "tsconfig.json");
const DIAGNOSTIC = /^(.*?)\((\d+),(\d+)\): error (TS\d+): (.*)$/;
const REPORT_LIMIT = 20;

function relativeToPackage(file) {
	return relative(packageRoot, file).split("\\").join("/");
}

function compile() {
	let tsc;
	try {
		tsc = createRequire(import.meta.url).resolve("typescript/bin/tsc");
	} catch {
		console.error("types: cannot resolve the TypeScript compiler. Run `pnpm install` first.");
		process.exit(1);
	}
	try {
		execFileSync(process.execPath, [tsc, "-p", configPath], {
			cwd: packageRoot,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
			timeout: 300_000,
		});
		return { output: "", exitCode: 0 };
	} catch (error) {
		// tsc exits non-zero when it reports diagnostics and writes them to stdout.
		// 退出码与输出分开携带：非零退出但解析不出带位置前缀的诊断时，
		// 说明是配置级错误（TS5058/TS18003）或编译器崩溃，必须在主流程 fail-closed，
		// 不能当成"零诊断"的干净编译放行（否则整条门变成假绿灯）。
		return { output: `${error.stdout ?? ""}${error.stderr ?? ""}`, exitCode: typeof error.status === "number" ? error.status : 1 };
	}
}

function summarize(output) {
	const counts = new Map();
	const samples = new Map();
	let total = 0;
	for (const line of output.split(/\r?\n/)) {
		const match = DIAGNOSTIC.exec(line);
		if (!match) continue;
		const key = `${relativeToPackage(match[1])} ${match[4]}`;
		counts.set(key, (counts.get(key) ?? 0) + 1);
		if (!samples.has(key)) samples.set(key, match[5].trim());
		total += 1;
	}
	return { counts, samples, total };
}

function writeBaseline(summary) {
	const byFileAndCode = Object.fromEntries([...summary.counts].sort(([left], [right]) => left.localeCompare(right)));
	const payload = {
		note: "Recorded TypeScript diagnostics. Regenerate with `node scripts/check-types.mjs --update` after fixing or deliberately accepting diagnostics. This file may only shrink without a review decision.",
		total: summary.total,
		byFileAndCode,
	};
	writeFileSync(baselinePath, `${JSON.stringify(payload, null, 2)}\n`);
}

const compiled = compile();
const summary = summarize(compiled.output);

if (compiled.exitCode !== 0 && summary.total === 0) {
	console.error(`types: tsc exited with code ${compiled.exitCode} but no position-keyed diagnostics could be parsed — this is a compiler/config failure, not a clean compile.`);
	const unparsed = compiled.output.split(/\r?\n/).filter((line) => line.trim() !== "").slice(0, REPORT_LIMIT);
	if (unparsed.length === 0) console.error("  (tsc produced no captured output)");
	for (const line of unparsed) console.error(`  ${line.slice(0, 200)}`);
	process.exit(1);
}

if (process.argv.includes("--update")) {
	writeBaseline(summary);
	console.log(`types: baseline recorded ${summary.total} diagnostic(s) across ${summary.counts.size} file/code pair(s)`);
	process.exit(0);
}

let baseline;
try {
	baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
} catch (error) {
	console.error(`types: cannot read ${relativeToPackage(baselinePath)}: ${error instanceof Error ? error.message : String(error)}`);
	process.exit(1);
}

const regressions = [];
for (const [key, count] of summary.counts) {
	const recorded = baseline.byFileAndCode[key] ?? 0;
	if (count > recorded) regressions.push({ key, added: count - recorded, message: summary.samples.get(key) ?? "" });
}

const totalGrew = summary.total > baseline.total;

if (regressions.length > 0 || totalGrew) {
	if (regressions.length > 0) {
		console.error(`types: ${regressions.length} file/code pair(s) report more diagnostics than recorded:`);
		for (const regression of regressions.slice(0, REPORT_LIMIT)) {
			console.error(`  +${regression.added}  ${regression.key}  ${regression.message.slice(0, 100)}`);
		}
		if (regressions.length > REPORT_LIMIT) console.error(`  ... and ${regressions.length - REPORT_LIMIT} more`);
	}
	if (totalGrew) {
		console.error(`types: total ${summary.total} exceeds the recorded ${baseline.total}`);
	}
	console.error("Fix the new diagnostics, or run `node scripts/check-types.mjs --update` when they are deliberately accepted.");
	process.exit(1);
}

const improved = [...Object.entries(baseline.byFileAndCode)].filter(([key, count]) => (summary.counts.get(key) ?? 0) < count).length;
console.log(
	`types: ${summary.total} recorded diagnostic(s), no regressions` +
		(improved > 0 ? `; ${improved} file/code pair(s) improved, run --update to shrink the baseline` : ""),
);
