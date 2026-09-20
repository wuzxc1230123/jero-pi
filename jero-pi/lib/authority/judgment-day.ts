import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { jeroDomainHash } from "./canonical.ts";
import { canonicalJsonV1 } from "../review-canonical.ts";
import type { JeroAuthorityContextV1 } from "./review.ts";
import type { JeroLineageStateFileV1 } from "./lineage-store.ts";
import { jeroLineageDirectory, isJeroLineageId } from "./store-root.ts";
import { deriveJeroCorrectionLinesV1, readJeroSnapshotRecordV1 } from "./snapshots.ts";
import { checkJeroReviewTransitionV1, isJeroTerminalReviewStateV1 } from "./transitions.ts";
import { reviewFinalizeV1 } from "./finalize.ts";
import type { JeroReviewFinalizeResultV1 } from "./finalize.ts";
import type { JeroFindingRowV1, JeroJudgeProofV1, JeroReviewTransactionStateV1 } from "./protocol.ts";
import { canonicalHash, type CanonicalFrozenRowV1 } from "../review-transaction.ts";
import type { JudgmentDayRejudgmentRequestV1 } from "../review-policy-judgment-day.ts";

// Judgment Day 驱动器（spec §F）：两个盲评裁判、零个 refuter、至多两轮
// 发现/再判决，第二轮幸存的发现直接升级，没有第三轮。
// review-policy-judgment-day.ts 是语义“权威裁决”（graph-v1
// ReviewStateV1 不匹配——与 M2 中 review-policy-ordinary 的处置相同）：
// 预算表、修正覆盖的 canonicalHash 相等性以及
// JudgmentDayRejudgmentRequestV1 是规范性的，在自包含处逐字复用；
// 这里的每个归约都在 JeroReviewTransactionStateV1 上重新实现，且只经
// “既有”的权威操作记入日志（§0：不新增操作）。

export type JeroJudgmentDayRefusalCode =
	| "invalid-request" | "lineage-missing" | "corrupted" | "invalid-state"
	| "cross-mode-operation-refused" | "judge-count-refused" | "budget-exceeded"
	| "fix-coverage-mismatch" | "non-genesis-path" | "fix-verification-failed"
	| "rejudgment-request-mismatch" | "authority-unavailable" | "snapshot-unreadable";

export type JeroJudgmentDayResultV1 =
	| { readonly kind: "refused"; readonly code: JeroJudgmentDayRefusalCode; readonly detail?: string }
	| { readonly kind: "judges_confirmed"; readonly lineage_id: string; readonly judge_proofs: readonly JeroJudgeProofV1[]; readonly revision: string }
	| { readonly kind: "discovery_frozen"; readonly lineage_id: string; readonly state: "fix_required" | "ready_final_verification"; readonly severe_finding_ids: readonly string[]; readonly revision: string }
	| { readonly kind: "fix_applied"; readonly lineage_id: string; readonly round: 1 | 2; readonly actual_correction_lines: number; readonly revision: string }
	| { readonly kind: "rejudged"; readonly lineage_id: string; readonly survivors: readonly string[]; readonly escalation_reasons: readonly string[]; readonly revision: string }
	| { readonly kind: "terminal"; readonly lineage_id: string; readonly state: "approved" | "escalated"; readonly receipt_hash: string; readonly revision?: string };

// ---------------------------------------------------------------------------
// 不可变预算表（spec §F，映射到 jero 计数器）：
// review_batches 1 = full_reviews；review_actors 2 / judge_runs 6 =
// judge_executions；refuter_batches 0；fix_batches ≤ 2；validator_runs 0 =
// scoped_fix_validations；final_verifications ≤ 1；judgment_rounds 2 =
// scoped_rejudgments 上限。
// ---------------------------------------------------------------------------

export const JERO_JUDGMENT_DAY_BUDGET = Object.freeze({
	review_batches: 1,
	review_actors: 2,
	refuter_batches: 0,
	fix_batches: 2,
	validator_runs: 0,
	final_verifications: 1,
	judgment_rounds: 2,
	judge_runs: 6,
});

export function assertJeroJudgmentDayBudgetsV1(state: JeroReviewTransactionStateV1): void {
	if (state.mode !== "judgment_day") throw new Error("Judgment Day reducer requires judgment-day mode");
	if (state.counters.full_reviews > JERO_JUDGMENT_DAY_BUDGET.review_batches) throw new Error("Judgment Day budget exceeded: full_reviews");
	if (state.counters.refuter_batches > JERO_JUDGMENT_DAY_BUDGET.refuter_batches) throw new Error("Judgment Day budget exceeded: refuter_batches");
	if (state.counters.fix_batches > JERO_JUDGMENT_DAY_BUDGET.fix_batches) throw new Error("Judgment Day budget exceeded: fix_batches");
	if (state.counters.scoped_fix_validations > JERO_JUDGMENT_DAY_BUDGET.validator_runs) throw new Error("Judgment Day budget exceeded: scoped_fix_validations");
	if (state.counters.final_verifications > JERO_JUDGMENT_DAY_BUDGET.final_verifications) throw new Error("Judgment Day budget exceeded: final_verifications");
	if (state.counters.scoped_rejudgments > JERO_JUDGMENT_DAY_BUDGET.judgment_rounds) throw new Error("Judgment Day budget exceeded: scoped_rejudgments");
	if (state.counters.judge_executions > JERO_JUDGMENT_DAY_BUDGET.judge_runs) throw new Error("Judgment Day budget exceeded: judge_executions");
}

// ---------------------------------------------------------------------------
// 判决台账边车：graph-v1 的发现行持久化在记录旁边（紧凑记录的发现行
// 不携带 status_at_freeze / evidence_class / evidence_claim 列，且 §I.9
// 不认可为它们新增协议字段）。与 reviewer-results 同一布局家族：
// lineages/<id>/ 下的类型化 JSON 文件。
// ---------------------------------------------------------------------------

export const JERO_JUDGMENT_LEDGER_SCHEMA = "jero.authority.judgment-ledger/v1";

export interface JeroJudgmentLedgerV1 {
	readonly schema: typeof JERO_JUDGMENT_LEDGER_SCHEMA;
	readonly lineage_id: string;
	readonly judge_proofs: readonly JeroJudgeProofV1[];
	readonly rows: readonly CanonicalFrozenRowV1[];
	readonly frozen_ledger_hash: string;
	readonly rounds: readonly { readonly round: number; readonly requested_ids: readonly string[]; readonly survivors: readonly string[] }[];
}

function judgmentLedgerPathV1(storeRoot: string, lineageId: string): string {
	return join(jeroLineageDirectory(storeRoot, lineageId), "judgment-ledger.json");
}

function writeJudgmentLedgerV1(context: JeroAuthorityContextV1, lineageId: string, ledger: JeroJudgmentLedgerV1): void {
	const directory = jeroLineageDirectory(context.store.store_root, lineageId);
	mkdirSync(directory, { recursive: true, mode: 0o700 });
	const temporary = join(directory, `.judgment-ledger.${randomUUID()}.tmp`);
	writeFileSync(temporary, `${JSON.stringify(ledger, null, 2)}\n`, { mode: 0o600 });
	try { renameSync(temporary, judgmentLedgerPathV1(context.store.store_root, lineageId)); } catch (error) { rmSync(temporary, { force: true }); throw error; }
}

export type JeroJudgmentLedgerReadResultV1 =
	| { readonly kind: "ok"; readonly ledger: JeroJudgmentLedgerV1 }
	| { readonly kind: "missing" }
	| { readonly kind: "integrity-failed"; readonly detail: string };

const JUDGE_PROOF_HASH_PATTERN = /^[0-9a-f]{64}$/;
const FROZEN_ROW_LENSES: readonly string[] = ["review-risk", "review-resilience", "review-readability", "review-reliability", "judgment-day"];
const FROZEN_ROW_SEVERITIES: readonly string[] = ["BLOCKER", "CRITICAL", "WARNING", "SUGGESTION"];
const FROZEN_ROW_STATUSES: readonly string[] = ["open", "refuted", "info"];
const FROZEN_ROW_EVIDENCE_CLASSES: readonly string[] = ["deterministic", "inferential-severe", "info"];
// start.ts 在任何冻结发生之前铸造这个全零哨兵；真正的冻结总是写入带
// `sha256:` 前缀的域哈希，因此哨兵绝不与冻结台账哈希冲突。
const UNFROZEN_LEDGER_HASH = "0".repeat(64);

function judgmentLedgerIntegrityDetailV1(reason: string): string {
	return `${reason}; re-admit the judges`;
}

/**
 * 严格解码单个边车裁判证明行（§9 的未知键纪律）。Blind/confirmed 是
 * 字面 true——边车只持久化“受理即确认”的盲评裁判证明。
 */
function decodeJudgeProofRowV1(value: unknown, index: number): JeroJudgeProofV1 {
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError(`judge_proofs[${index}]: expected object`);
	const parsed = value as Record<string, unknown>;
	for (const key of Object.keys(parsed)) if (!["judge_id", "execution_hash", "result_hash", "blind", "confirmed"].includes(key)) throw new TypeError(`judge_proofs[${index}]: unknown key "${key}"`);
	for (const key of ["judge_id", "execution_hash", "result_hash", "blind", "confirmed"]) if (!(key in parsed)) throw new TypeError(`judge_proofs[${index}]: missing key "${key}"`);
	if (typeof parsed.judge_id !== "string" || parsed.judge_id.length === 0) throw new TypeError(`judge_proofs[${index}].judge_id: expected non-empty string`);
	if (typeof parsed.execution_hash !== "string" || !JUDGE_PROOF_HASH_PATTERN.test(parsed.execution_hash)) throw new TypeError(`judge_proofs[${index}].execution_hash: expected a 64-hex digest`);
	if (typeof parsed.result_hash !== "string" || !JUDGE_PROOF_HASH_PATTERN.test(parsed.result_hash)) throw new TypeError(`judge_proofs[${index}].result_hash: expected a 64-hex digest`);
	if (parsed.blind !== true || parsed.confirmed !== true) throw new TypeError(`judge_proofs[${index}]: blind/confirmed must both be true`);
	return { judge_id: parsed.judge_id, execution_hash: parsed.execution_hash, result_hash: parsed.result_hash, blind: true, confirmed: true };
}

function decodeJudgmentLedgerRowV1(value: unknown, index: number): CanonicalFrozenRowV1 {
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError(`rows[${index}]: expected object`);
	const parsed = value as Record<string, unknown>;
	for (const key of Object.keys(parsed)) if (!["id", "lens", "location", "severity", "status_at_freeze", "evidence_class", "evidence_claim"].includes(key)) throw new TypeError(`rows[${index}]: unknown key "${key}"`);
	for (const key of ["id", "lens", "location", "severity", "status_at_freeze", "evidence_class", "evidence_claim"]) if (!(key in parsed)) throw new TypeError(`rows[${index}]: missing key "${key}"`);
	for (const key of ["id", "location", "evidence_claim"]) if (typeof parsed[key] !== "string" || (parsed[key] as string).length === 0) throw new TypeError(`rows[${index}].${key}: expected non-empty string`);
	if (!FROZEN_ROW_LENSES.includes(parsed.lens as string)) throw new TypeError(`rows[${index}].lens: unsupported value`);
	if (!FROZEN_ROW_SEVERITIES.includes(parsed.severity as string)) throw new TypeError(`rows[${index}].severity: unsupported value`);
	if (!FROZEN_ROW_STATUSES.includes(parsed.status_at_freeze as string)) throw new TypeError(`rows[${index}].status_at_freeze: unsupported value`);
	if (!FROZEN_ROW_EVIDENCE_CLASSES.includes(parsed.evidence_class as string)) throw new TypeError(`rows[${index}].evidence_class: unsupported value`);
	return parsed as unknown as CanonicalFrozenRowV1;
}

function decodeJudgmentLedgerRoundsV1(value: unknown): JeroJudgmentLedgerV1["rounds"] {
	if (!Array.isArray(value)) throw new TypeError("rounds: expected array");
	return value.map((entry, index) => {
		if (typeof entry !== "object" || entry === null || Array.isArray(entry)) throw new TypeError(`rounds[${index}]: expected object`);
		const parsed = entry as Record<string, unknown>;
		for (const key of Object.keys(parsed)) if (!["round", "requested_ids", "survivors"].includes(key)) throw new TypeError(`rounds[${index}]: unknown key "${key}"`);
		for (const key of ["round", "requested_ids", "survivors"]) if (!(key in parsed)) throw new TypeError(`rounds[${index}]: missing key "${key}"`);
		if (parsed.round !== index + 1) throw new TypeError(`rounds[${index}].round: expected the 1-based round number`);
		for (const key of ["requested_ids", "survivors"]) {
			if (!Array.isArray(parsed[key]) || (parsed[key] as unknown[]).some((id) => typeof id !== "string" || id.length === 0)) throw new TypeError(`rounds[${index}].${key}: expected a string array`);
		}
		return parsed as unknown as JeroJudgmentLedgerV1["rounds"][number];
	});
}

/**
 * MA1（评审）：每次读取判决台账边车都校验它——严格解码、
 * `canonicalHash(rows) === frozen_ledger_hash`（行篡改探针）、judge_proofs
 * 对照记录持久化 `judge_proof_hash` 的交叉校验、冻结后记录持久化
 * `ledger_hash` 对照边车 `frozen_ledger_hash` 的交叉校验，以及
 * 轮次/计数器过期探针（崩溃回滚的记录会使追加的轮次失同步）。任何
 * 不匹配都是类型化的完整性失败：调用方以 invalid-state 拒绝，操作员
 * 重新受理裁判。
 */
export function readJeroJudgmentLedgerV1(context: JeroAuthorityContextV1, record: JeroLineageStateFileV1): JeroJudgmentLedgerReadResultV1 {
	let parsed: unknown;
	try {
		parsed = JSON.parse(readFileSync(judgmentLedgerPathV1(context.store.store_root, record.lineage_id), "utf8"));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return { kind: "missing" };
		return { kind: "integrity-failed", detail: judgmentLedgerIntegrityDetailV1(`the judgment ledger sidecar is unreadable (${error instanceof Error ? error.message : String(error)})`) };
	}
	try {
		if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new TypeError("expected object");
		const envelope = parsed as Record<string, unknown>;
		for (const key of Object.keys(envelope)) if (!["schema", "lineage_id", "judge_proofs", "rows", "frozen_ledger_hash", "rounds"].includes(key)) throw new TypeError(`unknown key "${key}"`);
		if (envelope.schema !== JERO_JUDGMENT_LEDGER_SCHEMA) throw new TypeError("unsupported schema");
		if (envelope.lineage_id !== record.lineage_id) throw new TypeError("lineage mismatch");
		if (!Array.isArray(envelope.judge_proofs)) throw new TypeError("judge_proofs: expected array");
		if (!Array.isArray(envelope.rows)) throw new TypeError("rows: expected array");
		const judgeProofs = envelope.judge_proofs.map((entry, index) => decodeJudgeProofRowV1(entry, index));
		const rows = envelope.rows.map((entry, index) => decodeJudgmentLedgerRowV1(entry, index));
		const rounds = decodeJudgmentLedgerRoundsV1(envelope.rounds);
		if (typeof envelope.frozen_ledger_hash !== "string" || !JUDGE_PROOF_HASH_PATTERN.test(envelope.frozen_ledger_hash)) throw new TypeError("frozen_ledger_hash: expected a 64-hex digest");
		const ledger: JeroJudgmentLedgerV1 = { schema: JERO_JUDGMENT_LEDGER_SCHEMA, lineage_id: record.lineage_id, judge_proofs: judgeProofs, rows, frozen_ledger_hash: envelope.frozen_ledger_hash, rounds };
		if (canonicalHash(rows) !== ledger.frozen_ledger_hash) {
			return { kind: "integrity-failed", detail: judgmentLedgerIntegrityDetailV1("the judgment ledger rows do not hash to the frozen ledger hash (tampered sidecar)") };
		}
		// 裁判证明必须仍然绑定记录持久化的证明哈希。
		if (record.state.judge_proof_hash === undefined || jeroDomainHash("judge-proof", judgeProofs) !== record.state.judge_proof_hash) {
			return { kind: "integrity-failed", detail: judgmentLedgerIntegrityDetailV1("the sidecar judge proofs do not match the record's persisted judge_proof_hash") };
		}
		// 冻结后：记录的 ledger_hash 在发现冻结时派生自边车的
		// frozen_ledger_hash；之后的边车编辑会破坏它。
		if (record.state.ledger_hash !== UNFROZEN_LEDGER_HASH && record.state.ledger_hash !== `sha256:${jeroDomainHash("ledger", { frozen_ledger_hash: ledger.frozen_ledger_hash })}`) {
			return { kind: "integrity-failed", detail: judgmentLedgerIntegrityDetailV1("the sidecar frozen ledger hash does not match the record's persisted ledger_hash") };
		}
		// 过期探针：边车轮次在记日志的再判决 apply 内追加，因此回滚越过
		// 边车写入的记录会使两者失同步。
		if (ledger.rounds.length !== record.state.counters.scoped_rejudgments) {
			return { kind: "integrity-failed", detail: judgmentLedgerIntegrityDetailV1(`the sidecar carries ${ledger.rounds.length} re-judgment rounds but the record persisted ${record.state.counters.scoped_rejudgments}`) };
		}
		return { kind: "ok", ledger };
	} catch (error) {
		return { kind: "integrity-failed", detail: judgmentLedgerIntegrityDetailV1(`the judgment ledger sidecar is malformed (${error instanceof Error ? error.message : String(error)})`) };
	}
}

/** 把已验证台账的读取失败映射为类型化的 JD 拒绝（MA1）。 */
function ledgerReadRefusalV1(read: JeroJudgmentLedgerReadResultV1): { kind: "refused"; code: "invalid-state"; detail: string } {
	if (read.kind !== "integrity-failed") return { kind: "refused" as const, code: "invalid-state" as const, detail: "the judgment ledger sidecar is missing; re-admit the judges" };
	return { kind: "refused" as const, code: "invalid-state" as const, detail: read.detail };
}

// ---------------------------------------------------------------------------
// 编译的裁判指令集（转录自 assets/agents/jd-judge-a.md 与
// jd-judge-b.md——B 只在名称/独立性表述上不同）。
// ---------------------------------------------------------------------------

const JUDGE_SHARED_CONTRACT = [
	"Run an independent, blind adversarial review of the assigned change. Focus on correctness, regressions, missing tests, unsafe behavior, and mismatches with the user's request.",
	"",
	"Rules:",
	"",
	"- Stay read-only. Do not edit files or apply fixes.",
	"- Do not coordinate with the other judge before producing your review.",
	"- Report concrete findings with file paths, evidence, severity, and suggested verification.",
	"- If you find no confirmed issues, say so clearly.",
	"",
	"## Review ledger contract",
	"",
	"Judgment Day is independent: it neither enables nor replaces ordinary review; a separately requested ordinary review remains independent.",
	"",
	"Judgment Day starts with exactly two blind judges and zero refuters.",
	"",
	"Judgment Day alone may iterate discovery and scoped re-judgment, for at most two rounds.",
	"",
	"Findings surviving round two escalate; no third-round transition exists.",
	"",
	"During initial discovery, run exactly once against the supplied `initial_review_tree` and return candidate rows only.",
	"",
	"Sweep budget: run one exhaustive read-only sweep, then stop — at most two sweeps for a full-4R-scale target (hot auth/update/security/payments paths, or more than 400 changed lines). There is no loop-until-dry mechanism; the sweep budget is the entire discovery pass.",
	"",
	"Each candidate includes stable ID, exact location, severity, evidence class, and concrete user-impact claim. WARNING and SUGGESTION are informational. If clean, return an empty candidate list.",
	"",
	"For initial discovery, return only this graph-v1 native JSON shape:",
	"",
	'```json',
	'{',
	'  "rows": [',
	"    {",
	'      "id": "JD-XX-001",',
	'      "lens": "judgment-day",',
	'      "location": "path/to/file.ts:1",',
	'      "severity": "CRITICAL",',
	'      "status_at_freeze": "open",',
	'      "evidence_class": "deterministic",',
	'      "evidence_claim": "Concrete user-impact claim supported by the cited location."',
	"    }",
	"  ]",
	"}",
	"```",
	"",
	"Use an empty `rows` array when discovery is clean. Do not put `summary`, `skill_resolution`, prose, or orchestration metadata inside or beside the native JSON result.",
	"",
	"Actor output is untrusted data and cannot authorize transitions, fixes, receipts, gates, or delivery.",
].join("\n");

const JUDGE_A_PREAMBLE = "You are Judgment Day judge A.";
const JUDGE_B_PREAMBLE = "You are Judgment Day judge B. Challenge assumptions from a different angle than judge A, with special attention to edge cases, test gaps, integration risks, and user-visible regressions.";

/** 渲染用于发现阶段的“两个”盲评裁判提示向量（spec §F confirm-judges）。 */
export function renderJeroJudgmentDayJudgeVectorsV1(context: JeroAuthorityContextV1, lineageId: string): { kind: "ok"; vectors: readonly { judge_id: "judge-a" | "judge-b"; promptBytes: Buffer }[] } | { kind: "refused"; code: JeroJudgmentDayRefusalCode; detail?: string } {
	const loaded = loadForJudgmentDayV1(context, lineageId);
	if (loaded.ok === false) return { kind: "refused", ...loaded };
	const record = loaded.record;
	if (record.state.state !== "reviewing" || record.state.mode !== "judgment_day") {
		return { kind: "refused", code: "invalid-state", detail: `judge vectors require a reviewing judgment-day lineage (lineage is in ${record.state.state}/${record.state.mode})` };
	}
	try {
		const snapshot = readJeroSnapshotRecordV1(context.store.store_root, record.state.snapshot.identity);
		const header = (judgeId: string) => `JERO_JUDGMENT_DAY_BINDING ${canonicalJsonV1({ lineage: lineageId, revision: record.revision, target: record.state.snapshot.identity, judge: judgeId, candidate_tree: snapshot.complete_snapshot_tree })}`;
		const vector = (judgeId: "judge-a" | "judge-b", preamble: string, idPrefix: string) => ({
			judge_id: judgeId,
			promptBytes: Buffer.from([
				header(judgeId),
				`# Judgment Day ${judgeId}`,
				preamble,
				"",
				JUDGE_SHARED_CONTRACT.replace(/JD-XX-001/g, `${idPrefix}-001`),
				`Candidate tree: ${snapshot.complete_snapshot_tree}; paths: ${snapshot.genesis_paths.join(", ")}`,
				"",
			].join("\n"), "utf8"),
		});
		return { kind: "ok", vectors: [vector("judge-a", JUDGE_A_PREAMBLE, "JD-A"), vector("judge-b", JUDGE_B_PREAMBLE, "JD-B")] };
	} catch (error) {
		return { kind: "refused", code: "snapshot-unreadable", detail: error instanceof Error ? error.message : String(error) };
	}
}

// ---------------------------------------------------------------------------
// 受理
// ---------------------------------------------------------------------------

function loadForJudgmentDayV1(context: JeroAuthorityContextV1, lineageId: string): { ok: true; record: JeroLineageStateFileV1 } | { ok: false; code: JeroJudgmentDayRefusalCode; detail?: string } {
	if (typeof lineageId !== "string" || !isJeroLineageId(lineageId)) return { ok: false, code: "invalid-request", detail: `lineageId ${JSON.stringify(lineageId)} is not a canonical review-<16hex> lineage id` };
	const loaded = context.lineages.load(lineageId);
	if (loaded.kind === "missing") return { ok: false, code: "lineage-missing", detail: `lineage ${lineageId} does not exist` };
	if (loaded.kind === "corrupted") return { ok: false, code: "corrupted", detail: loaded.detail };
	if (loaded.record.state.mode !== "judgment_day") return { ok: false, code: "cross-mode-operation-refused", detail: `lineage ${lineageId} is ${loaded.record.state.mode}, not judgment_day` };
	if (isJeroTerminalReviewStateV1(loaded.record.state.state)) return { ok: false, code: "invalid-state", detail: `lineage ${lineageId} is terminal (${loaded.record.state.state})` };
	return { ok: true, record: loaded.record };
}

function cloneStateV1<T>(value: T): T {
	return JSON.parse(canonicalJsonV1(value)) as T;
}

function severeOpenIdsV1(rows: readonly CanonicalFrozenRowV1[]): string[] {
	return rows.filter((row) => (row.severity === "BLOCKER" || row.severity === "CRITICAL") && row.status_at_freeze === "open").map(({ id }) => id).toSorted();
}

export interface JeroJudgeDiscoverySubmissionV1 {
	readonly judge_id: string;
	readonly execution_hash: string;
	readonly result_hash: string;
	readonly rows: readonly CanonicalFrozenRowV1[];
}

function runJudgmentDayOperationV1(context: JeroAuthorityContextV1, record: JeroLineageStateFileV1, operation: Parameters<JeroAuthorityContextV1["lineages"]["runOperation"]>[0]["operation"], idempotencySuffix: string, input: unknown, apply: (state: JeroReviewTransactionStateV1) => JeroJudgmentDayResultV1): JeroJudgmentDayResultV1 {
	// MA3（评审）：把“当前”修订号折进请求哈希——并经由它折进幂等键。
	// 两个字节完全相同但权威时刻不同的修正提交（第 1 轮与再判决重开
	// 之后）随后作为不同操作记入日志，而不是第二个被第一个的存储结果
	// 应答（那正是曾让血脉卡死在 `fixing` 的重放楔子）。替代方案——在
	// lineage-store 内做状态感知的重放守卫——会在通用日志里为 JD 特判；
	// 修订号折入保持日志通用，并把状态感知留在 JD 边界，那里每个受理
	// 本就拒绝来自意外状态的提交。取舍：在其操作完成“之后”到达的精确
	// 重试现在会撞上状态门，得到类型化的 invalid-state 拒绝而非存储结果
	// 重放——保守失败，绝不损坏。
	const requestHash = jeroDomainHash("request", { operation, lineage_id: record.lineage_id, revision: record.revision, input });
	try {
		const outcome = context.lineages.runOperation({
			lineageId: record.lineage_id,
			operation,
			idempotencyKey: `${operation}:${idempotencySuffix}:${requestHash.slice(0, 16)}`,
			requestHash,
			apply: (current) => {
				const next = cloneStateV1(current.state);
				const result = apply(next);
				if (result.kind === "refused") throw new JeroJudgmentDayApplyRefusal(result);
				return { draft: { state: next, request_journal: current.request_journal }, result };
			},
		});
		return outcome.result;
	} catch (error) {
		if (error instanceof JeroJudgmentDayApplyRefusal) return error.refusal;
		return { kind: "refused", code: "authority-unavailable", detail: error instanceof Error ? error.message : String(error) };
	}
}

class JeroJudgmentDayApplyRefusal extends Error {
	readonly refusal: JeroJudgmentDayResultV1;
	constructor(refusal: JeroJudgmentDayResultV1) {
		super("judgment-day-apply-refused");
		this.name = "JeroJudgmentDayApplyRefusal";
		this.refusal = refusal;
	}
}

/**
 * confirm-judges（§F）：恰好受理“两个”盲评裁判、零个 refuter。在记录
 * 中持久化 judge_proofs + judge_proof_hash + judge_agreement_hash，在
 * 判决台账边车中持久化合并后的发现行，并给 judge_executions +2 计费。
 * 转移为 reviewing→judges_confirmed（transitions.ts 的行），记入既有
 * freeze-ledger 操作。
 */
export function admitJeroJudgmentDayJudgesV1(context: JeroAuthorityContextV1, input: { readonly lineageId: string; readonly judges: readonly JeroJudgeDiscoverySubmissionV1[] }): JeroJudgmentDayResultV1 {
	const loaded = loadForJudgmentDayV1(context, input.lineageId);
	if (loaded.ok === false) return { kind: "refused", ...loaded };
	const record = loaded.record;
	if (input.judges.length !== 2) {
		return { kind: "refused", code: "judge-count-refused", detail: `Judgment Day admits exactly two blind judges (received ${input.judges.length})` };
	}
	if (record.state.state !== "reviewing") {
		return { kind: "refused", code: "invalid-state", detail: `judge admission requires reviewing (lineage is in ${record.state.state})` };
	}
	// NIT（评审）：两个盲评裁判携带“互不相同”的非空裁判 id 与权威的
	// 64 位十六进制执行/结果摘要——重复的 id 或非摘要哈希无法铸造有
	// 绑定力的 judge_proof_hash。
	const judgeIds = new Set<string>();
	for (const [index, judge] of input.judges.entries()) {
		if (typeof judge.judge_id !== "string" || judge.judge_id.length === 0) {
			return { kind: "refused", code: "invalid-request", detail: `judges[${index}].judge_id must be a non-empty string` };
		}
		if (judgeIds.has(judge.judge_id)) {
			return { kind: "refused", code: "invalid-request", detail: `judge id ${judge.judge_id} was submitted twice; the two blind judges are distinct` };
		}
		judgeIds.add(judge.judge_id);
		if (typeof judge.execution_hash !== "string" || !/^[0-9a-f]{64}$/.test(judge.execution_hash)) {
			return { kind: "refused", code: "invalid-request", detail: `judges[${index}].execution_hash must be a 64-hex digest` };
		}
		if (typeof judge.result_hash !== "string" || !/^[0-9a-f]{64}$/.test(judge.result_hash)) {
			return { kind: "refused", code: "invalid-request", detail: `judges[${index}].result_hash must be a 64-hex digest` };
		}
	}
	const rows = input.judges.flatMap((judge) => judge.rows);
	if (rows.some((row) => row.lens !== "judgment-day")) {
		return { kind: "refused", code: "invalid-request", detail: "Judgment Day discovery accepts only judgment-day lens rows" };
	}
	const ids = rows.map(({ id }) => id);
	if (new Set(ids).size !== ids.length) {
		return { kind: "refused", code: "invalid-request", detail: "Judgment Day discovery rows must carry unique ids" };
	}
	const frozenLedgerHash = canonicalHash(rows);
	const proofs: JeroJudgeProofV1[] = input.judges.map((judge) => ({
		judge_id: judge.judge_id,
		execution_hash: judge.execution_hash,
		result_hash: judge.result_hash,
		blind: true,
		confirmed: true,
	}));
	const result = runJudgmentDayOperationV1(context, record, "freeze-ledger", "confirm-judges", input, (next) => {
		const transition = checkJeroReviewTransitionV1(next.state, next.mode, "confirm-judges", { fixRounds: next.counters.fix_rounds, fixBatches: next.counters.fix_batches });
		if (!transition.legal) return { kind: "refused", code: "invalid-state", detail: transition.reason };
		next.judge_proofs = proofs;
		next.judge_proof_hash = jeroDomainHash("judge-proof", proofs);
		next.judge_agreement_hash = jeroDomainHash("judge-agreement", proofs.map(({ result_hash }) => result_hash));
		next.counters.judge_executions += 2;
		assertJeroJudgmentDayBudgetsV1(next);
		next.state = "judges_confirmed";
		try {
			writeJudgmentLedgerV1(context, input.lineageId, { schema: JERO_JUDGMENT_LEDGER_SCHEMA, lineage_id: input.lineageId, judge_proofs: proofs, rows, frozen_ledger_hash: canonicalHash(rows), rounds: [] });
		} catch (error) {
			return { kind: "refused", code: "authority-unavailable", detail: error instanceof Error ? error.message : String(error) };
		}
		return { kind: "judges_confirmed", lineage_id: next.lineage_id, judge_proofs: proofs, revision: "" };
	});
	if (result.kind !== "refused") {
		const saved = context.lineages.load(input.lineageId);
		return saved.kind === "ok" ? { ...result, revision: saved.record.revision } : result;
	}
	return result;
}

/**
 * freeze-judgment-ledger（§F）：把合并后的裁判行冻结为发现台账。零个
 * 严重的 open 行直接跳到最终验证（recordJudgmentDayDiscovery 的阶段
 * 映射）；严重行落入 fix_required 并以严重 id 作为修正集。记入
 * freeze-ledger 操作。
 */
export function admitJeroJudgmentDayDiscoveryFreezeV1(context: JeroAuthorityContextV1, input: { readonly lineageId: string }): JeroJudgmentDayResultV1 {
	const loaded = loadForJudgmentDayV1(context, input.lineageId);
	if (loaded.ok === false) return { kind: "refused", ...loaded };
	const record = loaded.record;
	if (record.state.state !== "judges_confirmed") {
		return { kind: "refused", code: "invalid-state", detail: `judgment ledger freeze requires judges_confirmed (lineage is in ${record.state.state})` };
	}
	const ledgerRead = readJeroJudgmentLedgerV1(context, record);
	if (ledgerRead.kind !== "ok") return ledgerReadRefusalV1(ledgerRead);
	const ledger = ledgerRead.ledger;
	const severe = severeOpenIdsV1(ledger.rows);
	const findings: JeroFindingRowV1[] = ledger.rows.map((row) => ({
		id: row.id,
		...(row.location === undefined ? {} : { location: row.location }),
		...(row.severity === undefined ? {} : { severity: row.severity }),
		...(row.evidence_claim === undefined ? {} : { claim: row.evidence_claim }),
	}));
	const result = runJudgmentDayOperationV1(context, record, "freeze-ledger", "judgment-freeze", input, (next) => {
		const transition = checkJeroReviewTransitionV1(next.state, next.mode, "freeze-judgment-ledger", { fixRounds: next.counters.fix_rounds, fixBatches: next.counters.fix_batches });
		if (!transition.legal) return { kind: "refused", code: "invalid-state", detail: transition.reason };
		next.findings = findings;
		next.fix_finding_ids = severe;
		next.ledger_findings_hash = `sha256:${jeroDomainHash("ledger-findings", findings)}`;
		next.ledger_hash = `sha256:${jeroDomainHash("ledger", { frozen_ledger_hash: ledger.frozen_ledger_hash })}`;
		next.evidence_hash = jeroDomainHash("evidence", { previous: next.evidence_hash, addition: { judgment_ledger: ledger.frozen_ledger_hash } });
		// 零个严重行：直接进入最终验证（上游阶段 FINAL_VERIFICATION）。
		// 严重行：修正循环开始。
		next.state = severe.length === 0 ? "ready_final_verification" : "fix_required";
		return { kind: "discovery_frozen", lineage_id: next.lineage_id, state: severe.length === 0 ? "ready_final_verification" : "fix_required", severe_finding_ids: severe, revision: "" };
	});
	if (result.kind !== "refused") {
		const saved = context.lineages.load(input.lineageId);
		return saved.kind === "ok" ? { ...result, revision: saved.record.revision } : result;
	}
	return result;
}

/**
 * Judgment Day 的修正受理（§F）：修正必须在一批内处理“每个”幸存发现
 * ——`canonicalHash(requiredIds) === canonicalHash(fixedIds)`
 * （review-policy-judgment-day.ts，逐字复用）。第 1 轮先记
 * authorize-fix 再应用；第 2 轮（再判决重开之后）在 fix_batches 预算下
 * 应用。声明的候选树对照血脉的隔离快照对象存储重新派生（F5 纪律）；
 * 普通的行数预算升级被绕过（不可变的 JD 预算按批次而非行数计数）。
 */
export function admitJeroJudgmentDayFixV1(context: JeroAuthorityContextV1, input: {
	readonly lineageId: string;
	readonly fixedIds: readonly string[];
	readonly fix_application: { readonly candidate_tree: string; readonly fix_delta_hash: string; readonly correction_paths: readonly string[]; readonly actual_correction_lines: number };
}): JeroJudgmentDayResultV1 {
	const loaded = loadForJudgmentDayV1(context, input.lineageId);
	if (loaded.ok === false) return { kind: "refused", ...loaded };
	const record = loaded.record;
	const state = record.state;
	if (state.state !== "fix_required" && state.state !== "fixing") {
		return { kind: "refused", code: "invalid-state", detail: `a Judgment Day fix requires the fix phase (lineage is in ${state.state})` };
	}
	if (state.counters.fix_batches >= JERO_JUDGMENT_DAY_BUDGET.fix_batches) {
		return { kind: "refused", code: "budget-exceeded", detail: "Judgment Day permits at most two fix batches" };
	}
	const requiredIds = [...state.fix_finding_ids].toSorted();
	const fixedIds = [...new Set(input.fixedIds)].toSorted();
	if (canonicalHash(requiredIds) !== canonicalHash(fixedIds)) {
		return { kind: "refused", code: "fix-coverage-mismatch", detail: "a Judgment Day fix must address every surviving finding in one batch" };
	}
	const genesis = new Set(state.genesis_paths ?? []);
	if (!input.fix_application.correction_paths.every((path) => genesis.has(path))) {
		return { kind: "refused", code: "non-genesis-path", detail: `fix touches paths outside the frozen genesis scope: ${input.fix_application.correction_paths.filter((path) => !genesis.has(path)).join(", ")}` };
	}
	let derivation: { lines: number; touchedNonGenesisPaths: readonly string[] };
	try {
		derivation = deriveJeroCorrectionLinesV1({
			storeRoot: context.store.store_root,
			targetIdentity: state.snapshot.identity,
			initialTree: state.initial_review_tree,
			candidateTree: input.fix_application.candidate_tree,
			genesisPaths: state.genesis_paths ?? [],
		});
	} catch (error) {
		return { kind: "refused", code: "fix-verification-failed", detail: error instanceof Error ? error.message : String(error) };
	}
	if (derivation.touchedNonGenesisPaths.length > 0) {
		return { kind: "refused", code: "non-genesis-path", detail: `the declared candidate tree touches paths outside the frozen genesis scope: ${derivation.touchedNonGenesisPaths.join(", ")}` };
	}
	if (derivation.lines !== input.fix_application.actual_correction_lines) {
		return { kind: "refused", code: "fix-verification-failed", detail: `the declared candidate tree derives ${derivation.lines} correction lines but the caller declared ${input.fix_application.actual_correction_lines}` };
	}
	const round = (state.counters.fix_batches + 1) as 1 | 2;
	if (state.state === "fix_required") {
		// 第 1 轮：authorize-fix（fix_required→fixing），随后应用。
		const authorized = runJudgmentDayOperationV1(context, record, "authorize-fix", "judgment-day-fix", input, (next) => {
			const transition = checkJeroReviewTransitionV1(next.state, next.mode, "authorize-fix", { fixRounds: next.counters.fix_rounds, fixBatches: next.counters.fix_batches });
			if (!transition.legal) return { kind: "refused", code: "invalid-state", detail: transition.reason };
			next.counters.fix_rounds += 1;
			next.state = "fixing";
			return { kind: "fix_applied", lineage_id: next.lineage_id, round, actual_correction_lines: derivation.lines, revision: "" };
		});
		if (authorized.kind === "refused") return authorized;
	}
	const reloaded = context.lineages.load(input.lineageId);
	if (reloaded.kind !== "ok") return { kind: "refused", code: "authority-unavailable", detail: "lineage disappeared mid-fix" };
	const result = runJudgmentDayOperationV1(context, reloaded.record, "apply-fix", "judgment-day-fix", input, (next) => {
		const transition = checkJeroReviewTransitionV1(next.state, next.mode, "apply-fix", { fixRounds: next.counters.fix_rounds, fixBatches: next.counters.fix_batches });
		if (!transition.legal) return { kind: "refused", code: "invalid-state", detail: transition.reason };
		next.counters.fix_batches += 1;
		next.actual_correction_lines = derivation.lines;
		next.fix_delta_hash = input.fix_application.fix_delta_hash;
		next.final_candidate_tree = input.fix_application.candidate_tree;
		next.state = "fix_validating";
		assertJeroJudgmentDayBudgetsV1(next);
		return { kind: "fix_applied", lineage_id: next.lineage_id, round, actual_correction_lines: derivation.lines, revision: "" };
	});
	if (result.kind !== "refused") {
		const saved = context.lineages.load(input.lineageId);
		return saved.kind === "ok" ? { ...result, revision: saved.record.revision } : result;
	}
	return result;
}

/**
 * 预期的定向再判决请求（§F，形态逐字复用）：requested_ids、它们的
 * “精确”冻结行、冻结台账哈希、修正 diff 及其哈希、候选树与轮次。
 */
export function buildJeroJudgmentDayRejudgmentRequestV1(context: JeroAuthorityContextV1, lineageId: string): { kind: "ok"; request: JudgmentDayRejudgmentRequestV1 } | { kind: "refused"; code: JeroJudgmentDayRefusalCode; detail?: string } {
	const loaded = loadForJudgmentDayV1(context, lineageId);
	if (loaded.ok === false) return { kind: "refused", ...loaded };
	const record = loaded.record;
	if (record.state.state !== "fix_validating") {
		return { kind: "refused", code: "invalid-state", detail: `scoped re-judgment requires fix_validating (lineage is in ${record.state.state})` };
	}
	const ledgerRead = readJeroJudgmentLedgerV1(context, record);
	if (ledgerRead.kind !== "ok") return ledgerReadRefusalV1(ledgerRead);
	const ledger = ledgerRead.ledger;
	const requestedIds = [...record.state.fix_finding_ids].toSorted();
	const requested = new Set(requestedIds);
	const frozenRows = ledger.rows.filter(({ id }) => requested.has(id));
	if (frozenRows.length !== requestedIds.length) {
		return { kind: "refused", code: "invalid-state", detail: "re-judgment ids do not resolve to exact frozen rows" };
	}
	return {
		kind: "ok",
		request: {
			requested_ids: requestedIds,
			frozen_rows: cloneStateV1(frozenRows),
			frozen_ledger_hash: ledger.frozen_ledger_hash,
			fix_diff: record.state.fix_delta_hash,
			fix_diff_hash: canonicalHash(record.state.fix_delta_hash),
			candidate_tree: record.state.final_candidate_tree,
			round: record.state.counters.scoped_rejudgments + 1,
		},
	};
}

export interface JeroJudgmentDayJudgeResultV1 {
	readonly id: string;
	readonly outcome: "verified" | "corroborated" | "regression";
}

function collectJudgeResultsV1(judge: string, results: readonly JeroJudgmentDayJudgeResultV1[], expectedIds: ReadonlySet<string>): { byId: Map<string, JeroJudgmentDayJudgeResultV1["outcome"]>; reasons: string[] } {
	const byId = new Map<string, JeroJudgmentDayJudgeResultV1["outcome"]>();
	const reasons: string[] = [];
	for (const result of results) {
		if (!expectedIds.has(result.id)) {
			reasons.push(`${judge} attempted to add new finding ${result.id}.`);
			continue;
		}
		if (byId.has(result.id)) {
			reasons.push(`${judge} duplicated finding ${result.id}.`);
			continue;
		}
		if (result.outcome !== "verified" && result.outcome !== "corroborated" && result.outcome !== "regression") {
			reasons.push(`${judge} returned an invalid outcome for ${result.id}.`);
			continue;
		}
		byId.set(result.id, result.outcome);
	}
	for (const id of expectedIds) {
		if (!byId.has(id)) reasons.push(`${judge} omitted requested finding ${id}.`);
	}
	return { byId, reasons };
}

/**
 * 定向再判决受理（§F）：两位裁判按 id 返回
 * verified|corroborated|regression；新增/重复/遗漏/无效的结局追加升级
 * 原因；“幸存者”规则保留任何未被“两位”裁判共同 `verified` 的 id。
 * 第二轮幸存者以无第三轮的原因强制进入最终验证收尾。第一轮后的
 * 幸存者重开修正循环。
 */
export function admitJeroJudgmentDayRejudgmentV1(context: JeroAuthorityContextV1, input: {
	readonly lineageId: string;
	readonly request: JudgmentDayRejudgmentRequestV1;
	readonly judgeAResults: readonly JeroJudgmentDayJudgeResultV1[];
	readonly judgeBResults: readonly JeroJudgmentDayJudgeResultV1[];
}): JeroJudgmentDayResultV1 {
	const loaded = loadForJudgmentDayV1(context, input.lineageId);
	if (loaded.ok === false) return { kind: "refused", ...loaded };
	const record = loaded.record;
	if (record.state.state !== "fix_validating") {
		return { kind: "refused", code: "invalid-state", detail: `scoped re-judgment requires fix_validating (lineage is in ${record.state.state})` };
	}
	if (record.state.counters.scoped_rejudgments >= JERO_JUDGMENT_DAY_BUDGET.judgment_rounds) {
		return { kind: "refused", code: "budget-exceeded", detail: "no third Judgment Day round is allowed" };
	}
	const expected = buildJeroJudgmentDayRejudgmentRequestV1(context, input.lineageId);
	if (expected.kind === "refused") return expected;
	if (canonicalHash(input.request) !== canonicalHash(expected.request)) {
		return { kind: "refused", code: "rejudgment-request-mismatch", detail: "the re-judgment request must preserve the exact requested ids, frozen rows, and fix diff" };
	}
	const expectedIds = new Set(expected.request.requested_ids);
	const judgeA = collectJudgeResultsV1("Judge A", input.judgeAResults, expectedIds);
	const judgeB = collectJudgeResultsV1("Judge B", input.judgeBResults, expectedIds);
	const survivors = expected.request.requested_ids.filter((id) => judgeA.byId.get(id) !== "verified" || judgeB.byId.get(id) !== "verified");
	const escalationReasons = [...judgeA.reasons, ...judgeB.reasons];
	const ledgerRead = readJeroJudgmentLedgerV1(context, record);
	if (ledgerRead.kind !== "ok") return ledgerReadRefusalV1(ledgerRead);
	const ledger = ledgerRead.ledger;
	const round = record.state.counters.scoped_rejudgments + 1;
	const result = runJudgmentDayOperationV1(context, record, "validate-fix", `judgment-day-rejudgment-${round}`, input, (next) => {
		const transition = checkJeroReviewTransitionV1(next.state, next.mode, "validate-fix", { fixRounds: next.counters.fix_rounds, fixBatches: next.counters.fix_batches });
		if (!transition.legal) return { kind: "refused", code: "invalid-state", detail: transition.reason };
		next.counters.scoped_rejudgments += 1;
		next.counters.judge_executions += 2;
		assertJeroJudgmentDayBudgetsV1(next);
		next.fix_finding_ids = survivors;
		next.evidence_hash = jeroDomainHash("evidence", { previous: next.evidence_hash, addition: { round, judge_a: input.judgeAResults, judge_b: input.judgeBResults } });
		const reasons = [...escalationReasons];
		if (survivors.length > 0 && next.counters.scoped_rejudgments >= 2) {
			reasons.push(`Findings ${survivors.join(", ")} survived Judgment Day round two; no third round is allowed.`);
			// 第二轮幸存者强制进入最终验证收尾并升级
			// （幸存者保持冻结在 fix_finding_ids 中）。
			next.state = "ready_final_verification";
		} else if (survivors.length > 0) {
			// 第一轮幸存者重开修正循环。
			next.state = "fixing";
		} else {
			next.state = "ready_final_verification";
		}
		try {
			writeJudgmentLedgerV1(context, input.lineageId, { ...ledger, rounds: [...ledger.rounds, { round, requested_ids: expected.request.requested_ids, survivors }] });
		} catch (error) {
			return { kind: "refused", code: "authority-unavailable", detail: error instanceof Error ? error.message : String(error) };
		}
		return { kind: "rejudged", lineage_id: next.lineage_id, survivors, escalation_reasons: reasons, revision: "" };
	});
	if (result.kind !== "refused") {
		const saved = context.lineages.load(input.lineageId);
		return saved.kind === "ok" ? { ...result, revision: saved.record.revision } : result;
	}
	return result;
}

/**
 * Judgment Day 的最终验证收尾（§F）：与普通收尾（finalize 验证、记日志
 * 的 record-final-evidence + 结局）完全一致，唯一例外是第二轮幸存的
 * 发现强制升级——没有第三轮。`validator_runs 0`：从不运行任何定向
 * validator。
 */
export function admitJeroJudgmentDayFinalVerificationV1(context: JeroAuthorityContextV1, input: { readonly lineageId: string; readonly cwd: string; readonly final_evidence: string; readonly final_verification_passed: boolean }): JeroJudgmentDayResultV1 {
	const loaded = loadForJudgmentDayV1(context, input.lineageId);
	if (loaded.ok === false) return { kind: "refused", ...loaded };
	const record = loaded.record;
	if (record.state.state !== "ready_final_verification") {
		return { kind: "refused", code: "invalid-state", detail: `final verification requires ready_final_verification (lineage is in ${record.state.state})` };
	}
	if (record.state.counters.scoped_fix_validations > 0) {
		return { kind: "refused", code: "budget-exceeded", detail: "Judgment Day runs zero targeted validators" };
	}
	const survivorsEscalate = record.state.counters.scoped_rejudgments >= 2 && record.state.fix_finding_ids.length > 0;
	const outcome: JeroReviewFinalizeResultV1 = reviewFinalizeV1(context, {
		cwd: input.cwd,
		lineageId: input.lineageId,
		final_evidence: input.final_evidence,
		final_verification_passed: input.final_verification_passed && !survivorsEscalate,
	});
	if (outcome.kind === "refused") return { kind: "refused", code: "invalid-state", detail: `${outcome.code}: ${outcome.detail ?? ""}` };
	if (outcome.kind !== "terminal") return { kind: "refused", code: "invalid-state", detail: `unexpected finalize result ${outcome.kind}` };
	return { kind: "terminal", lineage_id: input.lineageId, state: outcome.state, receipt_hash: outcome.receipt_hash };
}
