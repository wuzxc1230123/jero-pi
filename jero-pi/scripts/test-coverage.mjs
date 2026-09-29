#!/usr/bin/env node
// 跨进程行覆盖率聚合：`pnpm run test:coverage`。
//
// 为什么需要它：`--experimental-test-coverage` 只数 --test 进程内加载的模块，
// 而本仓库三条测试路径在覆盖率的盲区里——
//   1. tests/runtime-harness.mjs（真实扩展装配端到端，独立进程）；
//   2. 评审权威环路经 spawn 的 jero-authority-cli 子进程；
//   3. 各类子进程夹具（RPC child 等）。
// 且 Node 内置报表在全量多子进程场景对同文件的合并会失真（上游缺陷，
// 实测同一文件 19% vs 专项真值 87%）——本脚本是覆盖度量的唯一权威。
// NODE_V8_COVERAGE 让每个 node 进程（含被 spawn 的）把 V8 profile 落盘，
// 本脚本跑完全量后把所有 profile 归并成 lib/ + extensions/ 的行覆盖表。
//
// 行覆盖为区间近似（c8 同源思路）：一行可执行 = 落在某函数区间内；
// 覆盖 = 至少一个 profile 的最内层包含区间 count>0。类型行被剥除、不进
// 分母——与 --test 内置报表口径一致的方向性数字，用于对比与找缺口。

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const RAW_DIR = join(root, ".coverage-raw");
const REPORT_PATH = join(root, ".coverage-merged.txt");
const SUITE_TIMEOUT_MS = 30 * 60 * 1000;

// —— 归并纯函数（tests/test-coverage.test.ts 直接测这里） ——

/** 把单个 V8 profile 的函数区间树摊平成区间列表。 */
export function flattenRanges(functions) {
	const ranges = [];
	for (const fn of functions ?? []) {
		for (const range of fn.ranges ?? []) {
			ranges.push({ start: range.startOffset, end: range.endOffset, count: range.count });
		}
	}
	return ranges;
}

/** 最内层包含区间决定覆盖：区间按宽度升序，第一个包含 offset 的即最内层。 */
export function innermostCovered(ranges, offset) {
	let best = null;
	for (const range of ranges) {
		if (offset >= range.start && offset < range.end) {
			if (best === null || range.end - range.start < best.end - best.start) best = range;
		}
	}
	return best === null ? undefined : best.count > 0;
}

/** 每行起始 offset 表（source 长度上限保护：超大文件跳过）。 */
export function lineStartOffsets(text) {
	const offsets = [0];
	for (let i = 0; i < text.length; i++) {
		if (text.charCodeAt(i) === 10) offsets.push(i + 1);
	}
	return offsets;
}

/**
 * 归并一组 profile，输出 { file → { executable, covered } }（行号集合的计数）。
 * profiles: [{ url, source, ranges }]；ranges 为摊平后的区间。
 */
export function mergeProfiles(profiles) {
	const merged = new Map();
	for (const profile of profiles) {
		const offsets = lineStartOffsets(profile.source);
		const linesOf = (start, end) => {
			const lines = [];
			for (let li = 0; li < offsets.length; li++) {
				if (offsets[li] >= end) break;
				if (offsets[li] >= start) lines.push(li + 1);
			}
			return lines;
		};
		let entry = merged.get(profile.url);
		if (entry === undefined) {
			entry = { executable: new Set(), covered: new Set() };
			merged.set(profile.url, entry);
		}
		for (const range of profile.ranges) {
			for (const line of linesOf(range.start, range.end)) entry.executable.add(line);
		}
		for (const line of entry.executable) {
			if (innermostCovered(profile.ranges, offsets[line - 1])) entry.covered.add(line);
		}
	}
	return merged;
}

// —— 采集与报表 ——

function loadProfiles() {
	// 同一 url 的多个 profile 必须保持独立条目：串接会让一个 profile 的
	// 未执行子块（count=0 的块区间）否决另一个 profile 的函数级覆盖。
	// 归并（union）发生在 mergeProfiles 的逐 profile 判定之后。
	const profiles = [];
	const sourceCache = new Map();
	const files = existsSync(RAW_DIR) ? readdirSync(RAW_DIR).filter((f) => f.endsWith(".json")) : [];
	for (const file of files) {
		let data;
		try {
			data = JSON.parse(readFileSync(join(RAW_DIR, file), "utf8"));
		} catch {
			// 单个坏 profile（进程被杀时的半截 JSON）跳过，不否定整体。
			continue;
		}
		for (const entry of data.result ?? []) {
			if (typeof entry.url !== "string" || !entry.url.startsWith("file://")) continue;
			if (!/(?:^|\/)(?:lib|extensions)\/[^/].*\.ts$/.test(entry.url.split("/").slice(-3).join("/"))) continue;
			const ranges = flattenRanges(entry.functions);
			if (ranges.length === 0) continue;
			let source = sourceCache.get(entry.url);
			if (source === undefined) {
				try {
					source = readFileSync(fileURLToPath(entry.url), "utf8");
				} catch {
					continue;
				}
				sourceCache.set(entry.url, source);
			}
			profiles.push({ url: entry.url, source, ranges });
		}
	}
	return profiles;
}

function renderReport(merged) {
	const rows = [];
	for (const [url, entry] of merged) {
		if (entry.executable.size === 0) continue;
		rows.push({
			file: relative(root, fileURLToPath(url)).replaceAll("\\", "/"),
			line: (entry.covered.size / entry.executable.size) * 100,
			executable: entry.executable.size,
			covered: entry.covered.size,
		});
	}
	rows.sort((a, b) => a.line - b.line);
	const buckets = { "100": 0, "90-99": 0, "75-89": 0, "50-74": 0, "1-49": 0 };
	for (const row of rows) {
		if (row.line === 100) buckets["100"] += 1;
		else if (row.line >= 90) buckets["90-99"] += 1;
		else if (row.line >= 75) buckets["75-89"] += 1;
		else if (row.line >= 50) buckets["50-74"] += 1;
		else buckets["1-49"] += 1;
	}
	const lines = [];
	lines.push("跨进程合并行覆盖（NODE_V8_COVERAGE 全进程归并；口径为区间近似）");
	lines.push(`文件数: ${rows.length}  桶分布: 100%=${buckets["100"]} 90-99=${buckets["90-99"]} 75-89=${buckets["75-89"]} 50-74=${buckets["50-74"]} <50=${buckets["1-49"]}`);
	lines.push("");
	lines.push("=== 行覆盖 <50%（升序） ===");
	for (const row of rows.filter((r) => r.line < 50)) {
		lines.push(`${row.line.toFixed(1)}%\t${row.covered}/${row.executable}\t${row.file}`);
	}
	return lines.join("\n");
}

function runSuite() {
	rmSync(RAW_DIR, { recursive: true, force: true });
	mkdirSync(RAW_DIR, { recursive: true });
	const env = { ...process.env, NODE_V8_COVERAGE: RAW_DIR };
	const run = (args) => {
		const result = spawnSync(process.execPath, args, { stdio: "inherit", env, cwd: root, timeout: SUITE_TIMEOUT_MS });
		if (result.status !== 0) {
			console.error(`套件失败（exit ${result.status}），原始 profile 保留在 ${RAW_DIR} 供排查`);
			process.exit(result.status ?? 1);
		}
	};
	run([
		"--require", "./scripts/test-env.cjs", "--experimental-strip-types", "--test",
		"--test-concurrency=12", "--test-timeout=300000",
		"tests/*.test.ts", "tests/authority/*.test.ts", "tests/authority/conformance/*.test.ts",
	]);
	run(["--experimental-strip-types", "tests/runtime-harness.mjs"]);
}

function main() {
	if (!process.argv.includes("--merge-only")) runSuite();
	const merged = mergeProfiles(loadProfiles());
	if (merged.size === 0) {
		console.error(`未采集到任何 lib/ extensions/ profile——检查 ${RAW_DIR}`);
		process.exit(1);
	}
	const report = renderReport(merged);
	writeFileSync(REPORT_PATH, report, "utf8");
	console.log(report);
	console.log(`\n报告已写入 ${relative(root, REPORT_PATH)}；原始 profile 在 ${relative(root, RAW_DIR)}（下次运行自动清理）。`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main();
}
