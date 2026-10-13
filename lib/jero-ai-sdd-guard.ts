import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

// SDD 工件收缩守卫：openspec/changes/<name>/ 下的工件是模型可写的
// 普通文件，评审权威管不到它们——一次错误的整文件重写就能把
// tasks.md 的已完成清单毁掉大半（GSD 的 write-guard 正是为同类事故
// 而建）。本模块维护一个"最后 seen-good"水位台账（sha256 + 行数 +
// 字节数），在阶段推进（/jero-sdd-continue 成功路由后）记录水位；
// 下一次推进前对比当前文件：行数腰斩或工件消失即判定灾难性收缩，
// 由宿主要求显式确认后才放行。台账损坏视为不存在（从当前状态重
// 建），绝不阻塞；并发推进由 continue 的既有 marker + 确认门串行化，
// 台账本身无需锁（最后写入者胜，只影响水位精度，不影响正确性）。

export const SDD_ARTIFACT_GUARD_SCHEMA = "jero.sdd-artifact-guard/v1";
export const SDD_ARTIFACT_GUARD_FILE = ".jero-artifact-guard.json";
export const SDD_GUARD_LEDGER_VERSION = 1;
const MIN_WATERMARK_LINES = 8;

export interface SddArtifactWatermark {
	sha256: string;
	lines: number;
	bytes: number;
}

export interface SddArtifactGuardLedger {
	schema: string;
	version: number;
	recorded_at: string;
	artifacts: Record<string, SddArtifactWatermark>;
}

export interface SddShrinkFinding {
	path: string;
	watermark_lines: number;
	current_lines: number;
	disposition: "truncated" | "missing";
}

export interface SddShrinkEvaluation {
	shrunk: readonly SddShrinkFinding[];
	evaluated: number;
}

function atomicWrite(path: string, content: string): void {
	mkdirSync(join(path, ".."), { recursive: true });
	const staging = `${path}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`;
	writeFileSync(staging, content, "utf8");
	try {
		renameSync(staging, path);
	} catch (error) {
		rmSync(staging, { force: true });
		throw error;
	}
}

function countLines(content: string): number {
	if (content.length === 0) return 0;
	return content.split("\n").length - (content.endsWith("\n") ? 1 : 0);
}

function sha256(content: string): string {
	return createHash("sha256").update(content, "utf8").digest("hex");
}

/** 递归收集 changeRoot 下全部 markdown 工件（相对 changeRoot 的规范路径）。 */
export function collectSddArtifactPaths(changeRoot: string): string[] {
	const collected: string[] = [];
	const walk = (directory: string) => {
		for (const entry of readdirSync(directory, { withFileTypes: true })) {
			if (entry.name === ".git" || entry.name === "node_modules") continue;
			const path = join(directory, entry.name);
			if (entry.isDirectory()) {
				walk(path);
				continue;
			}
			if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
			collected.push(relative(changeRoot, path).split(sep).join("/"));
		}
	};
	walk(changeRoot);
	return collected.sort();
}

/** 记录当前全部工件的水位（最后 seen-good）。失败抛出，由调用方决定是否致命。 */
export function recordSddArtifactWatermarks(changeRoot: string, recordedAt: string = new Date().toISOString()): SddArtifactGuardLedger {
	const artifacts: Record<string, SddArtifactWatermark> = {};
	for (const relativePath of collectSddArtifactPaths(changeRoot)) {
		const content = readFileSync(join(changeRoot, relativePath), "utf8");
		artifacts[relativePath] = Object.freeze({ sha256: sha256(content), lines: countLines(content), bytes: Buffer.byteLength(content, "utf8") });
	}
	const ledger: SddArtifactGuardLedger = { schema: SDD_ARTIFACT_GUARD_SCHEMA, version: SDD_GUARD_LEDGER_VERSION, recorded_at: recordedAt, artifacts: Object.freeze(artifacts) };
	atomicWrite(join(changeRoot, SDD_ARTIFACT_GUARD_FILE), `${JSON.stringify(ledger, null, "\t")}\n`);
	return ledger;
}

/** 读取台账；缺失或损坏（schema/版本不符、条目畸形）一律视为不存在。 */
export function readSddArtifactGuardLedger(changeRoot: string): SddArtifactGuardLedger | undefined {
	const path = join(changeRoot, SDD_ARTIFACT_GUARD_FILE);
	if (!existsSync(path)) return undefined;
	let parsed: unknown;
	try {
		parsed = JSON.parse(readFileSync(path, "utf8"));
	} catch {
		return undefined;
	}
	const ledger = parsed as Partial<SddArtifactGuardLedger> | null;
	if (ledger === null || typeof ledger !== "object") return undefined;
	if (ledger.schema !== SDD_ARTIFACT_GUARD_SCHEMA || ledger.version !== SDD_GUARD_LEDGER_VERSION) return undefined;
	if (typeof ledger.artifacts !== "object" || ledger.artifacts === null) return undefined;
	const artifacts: Record<string, SddArtifactWatermark> = {};
	for (const [relativePath, value] of Object.entries(ledger.artifacts)) {
		if (relativePath.length === 0 || relativePath.startsWith("/") || relativePath.includes("\\")) continue;
		if (typeof value !== "object" || value === null) continue;
		const watermark = value as Partial<SddArtifactWatermark>;
		if (typeof watermark.sha256 !== "string" || typeof watermark.lines !== "number" || typeof watermark.bytes !== "number") continue;
		artifacts[relativePath] = { sha256: watermark.sha256, lines: watermark.lines, bytes: watermark.bytes };
	}
	return { schema: ledger.schema, version: ledger.version, recorded_at: typeof ledger.recorded_at === "string" ? ledger.recorded_at : "", artifacts };
}

/**
 * 对比当前工件与水位：带水位的工件消失即判定 missing（消失是收缩的
 * 极端形态，不受门槛保护）；文件尚在时，行数不足水位一半（且水位本
 * 身达到最小行数门槛，避免对小文件误报）判定 truncated。台账不存在
 * 时只统计、不判定（首次推进后才有可比水位）。
 */
export function evaluateSddArtifactShrink(changeRoot: string): SddShrinkEvaluation {
	const ledger = readSddArtifactGuardLedger(changeRoot);
	if (ledger === undefined) return { shrunk: [], evaluated: 0 };
	const shrunk: SddShrinkFinding[] = [];
	let evaluated = 0;
	for (const [relativePath, watermark] of Object.entries(ledger.artifacts)) {
		evaluated += 1;
		const path = join(changeRoot, relativePath);
		if (!existsSync(path) || !statSync(path).isFile()) {
			shrunk.push({ path: relativePath, watermark_lines: watermark.lines, current_lines: 0, disposition: "missing" });
			continue;
		}
		if (watermark.lines < MIN_WATERMARK_LINES) continue;
		const currentLines = countLines(readFileSync(path, "utf8"));
		if (currentLines * 2 < watermark.lines) {
			shrunk.push({ path: relativePath, watermark_lines: watermark.lines, current_lines: currentLines, disposition: "truncated" });
		}
	}
	return { shrunk, evaluated };
}

/** 渲染给确认对话框的收缩报告；逐条给出水位与当前行数。 */
export function renderSddShrinkReport(findings: readonly SddShrinkFinding[]): string {
	const lines = findings.map((finding) => `${finding.disposition === "missing" ? "missing" : "truncated"}: ${finding.path} — watermark ${finding.watermark_lines} lines, now ${finding.current_lines}`);
	return [
		"SDD artifacts shrank catastrophically since the last successful phase advance. Authorize continuation only if the shrink was intentional (e.g., a deliberate descope).",
		...lines,
		"Accepting records the current state as the new watermark; declining only shows status and leaves every file untouched.",
	].join("\n");
}
