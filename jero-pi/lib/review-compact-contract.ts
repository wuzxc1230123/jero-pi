// 精简后的 Pi FINALIZE 输入契约（gentle-pi#311 P5）。
//
// Pi 不再编写或传输 reviewer、refuter 或 validator 的裁决：评审视角
// 结果经 pi 宿主中继原生受理，对抗角色经提供方渲染的自包含向量在
// Go 持有的 pi 进程中执行，终局 FINALIZE 运行提供方自行协商的转移
// （捕获结果的发现）。这里剩下的只有固定提供方仍从宿主消费的协商
// 收集 ANSWER：编辑前的修正行数预报、由确切的
// `external.run_targeted_validation` 收集输入请求的定向验证文档，
// 以及带显式结局的最终验证证据。

import { CORRECTION_OUTCOMES, type CorrectionOutcome } from "./review-correction-lifecycle.ts";

const DIGEST = /^[0-9a-f]{64}$/;
const LINEAGE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export class CompactReviewContractError extends Error {
	readonly area: string;
	readonly code: string;

	constructor(area: string, code: string, message: string) {
		super(`${area}: ${message}`);
		this.name = "CompactReviewContractError";
		this.area = area;
		this.code = code;
	}
}

// 自已删除的 lib/review-compact.ts 迁移而来（gentle-pi#311 P5）：
// 仍有生产消费者的精简形态只有定向验证文档及其组成部分行。
export interface CompactValidationCheckInput {
	passed: boolean;
	evidence: string[];
}

export interface CompactFollowUp {
	finding_id: string;
	location: string;
	summary: string;
	proof_refs: string[];
}

export interface CompactTargetedValidationInput {
	request_hash: string;
	correction_ids: string[];
	original_criteria: CompactValidationCheckInput;
	correction_regression: CompactValidationCheckInput;
	fix_caused_findings?: unknown[];
	follow_ups: CompactFollowUp[];
}

export interface CompactFinalizeContractInput {
	cwd: string;
	lineageId?: string;
	correction_line_forecast?: number;
	validation?: CompactTargetedValidationInput;
	final_evidence?: string;
	final_verification_passed?: boolean;
	final_verification_outcome?: CorrectionOutcome;
	/**
	 * 显式确认本次 FINALIZE 可能消耗真实模型 token：提供方宿主中继槽位
	 * 为每个未决评审视角运行一个锁定的 `pi` 评审子进程。缺省时，
	 * FINALIZE 只预报运行且不消耗任何资源。与既有 `committedOnly`
	 * 确认同形——调用方声明自己接受的后果。
	 */
	reviewer_run_acknowledged?: boolean;
}

function fail(area: string, code: string, message: string): never {
	throw new CompactReviewContractError(area, code, message);
}

function record(value: unknown, area: string): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
		return fail(area, "type", "must be a plain object");
	}
	return value as Record<string, unknown>;
}

function exact(value: unknown, area: string, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
	const object = record(value, area);
	for (const key of Object.keys(object)) if (!required.includes(key) && !optional.includes(key)) fail(area, "unknown-key", `contains unknown field ${key}`);
	for (const key of required) if (!(key in object)) fail(area, "required", `requires ${key}`);
	return object;
}

function string(value: unknown, area: string): string {
	if (typeof value !== "string") return fail(area, "type", "must be a string");
	if (value.length === 0 || value.trim() !== value) return fail(area, "canonical-string", "must be non-empty and trimmed");
	return value;
}

function optionalString(value: unknown, area: string): string | undefined {
	return value === undefined ? undefined : string(value, area);
}

function strings(value: unknown, area: string): string[] {
	if (!Array.isArray(value)) return fail(area, "type", "must be an array");
	const parsed = value.map((item, index) => string(item, `${area}[${index}]`));
	if (new Set(parsed).size !== parsed.length) fail(area, "duplicate", "must not contain duplicates");
	return parsed;
}

function optionalLineage(value: unknown, area: string): string | undefined {
	const parsed = optionalString(value, area);
	if (parsed !== undefined && !LINEAGE_ID.test(parsed)) fail(area, "lineage", "is malformed");
	return parsed;
}

function parseValidation(value: unknown, area: string): CompactTargetedValidationInput {
	const input = exact(value, area, ["request_hash", "correction_ids", "original_criteria", "correction_regression", "fix_caused_findings", "follow_ups"]);
	const check = (item: unknown, label: string) => {
		const row = exact(item, label, ["passed", "evidence"]);
		if (typeof row.passed !== "boolean") fail(`${label}.passed`, "type", "must be boolean");
		return { passed: row.passed, evidence: strings(row.evidence, `${label}.evidence`) };
	};
	if (!Array.isArray(input.fix_caused_findings) || input.fix_caused_findings.length !== 0) fail(`${area}.fix_caused_findings`, "scope", "must be an explicitly empty array");
	if (!Array.isArray(input.follow_ups)) fail(`${area}.follow_ups`, "type", "must be an array");
	const follow_ups = input.follow_ups.map((item, index) => {
		const row = exact(item, `${area}.follow_ups[${index}]`, ["finding_id", "location", "summary", "proof_refs"]);
		return { finding_id: string(row.finding_id, `${area}.follow_ups[${index}].finding_id`), location: string(row.location, `${area}.follow_ups[${index}].location`), summary: string(row.summary, `${area}.follow_ups[${index}].summary`), proof_refs: strings(row.proof_refs, `${area}.follow_ups[${index}].proof_refs`) };
	});
	const request_hash = string(input.request_hash, `${area}.request_hash`);
	if (!DIGEST.test(request_hash)) fail(`${area}.request_hash`, "digest", "is malformed");
	return { request_hash, correction_ids: strings(input.correction_ids, `${area}.correction_ids`), original_criteria: check(input.original_criteria, `${area}.original_criteria`), correction_regression: check(input.correction_regression, `${area}.correction_regression`), fix_caused_findings: [], follow_ups };
}

function parseCompactFinalizeInputValue(value: unknown): CompactFinalizeContractInput {
	const input = exact(value, "review/finalize", ["cwd"], ["lineageId", "correction_line_forecast", "validation", "final_evidence", "final_verification_passed", "final_verification_outcome", "reviewer_run_acknowledged"]);
	let reviewer_run_acknowledged: boolean | undefined;
	if (input.reviewer_run_acknowledged !== undefined) {
		if (typeof input.reviewer_run_acknowledged !== "boolean") fail("review/finalize.reviewer_run_acknowledged", "type", "must be boolean");
		reviewer_run_acknowledged = input.reviewer_run_acknowledged;
	}
	const outcomeFields = Number(input.final_verification_passed !== undefined) + Number(input.final_verification_outcome !== undefined);
	if ((input.final_evidence === undefined && outcomeFields !== 0) || (input.final_evidence !== undefined && outcomeFields !== 1)) fail("review/finalize", "field-pair", "final evidence requires exactly one verification result or outcome");
	let correction_line_forecast: number | undefined;
	if (input.correction_line_forecast !== undefined) {
		const forecast = input.correction_line_forecast;
		// typeof 守卫只负责把 unknown 收窄成 number；整数语义仍由 isSafeInteger 把关。
		if (typeof forecast !== "number" || !Number.isSafeInteger(forecast) || forecast <= 0) fail("review/finalize.correction_line_forecast", "range", "must be a positive safe integer");
		correction_line_forecast = forecast;
	}
	let final_verification_passed: boolean | undefined;
	if (input.final_verification_passed !== undefined) {
		if (typeof input.final_verification_passed !== "boolean") fail("review/finalize.final_verification_passed", "type", "must be boolean");
		final_verification_passed = input.final_verification_passed;
	}
	let final_verification_outcome: CorrectionOutcome | undefined;
	if (input.final_verification_outcome !== undefined) {
		const outcome = string(input.final_verification_outcome, "review/finalize.final_verification_outcome");
		if (!(CORRECTION_OUTCOMES as readonly string[]).includes(outcome)) fail("review/finalize.final_verification_outcome", "enum", "contains an unsupported value");
		final_verification_outcome = outcome as CorrectionOutcome;
	}
	let final_evidence: string | undefined;
	if (input.final_evidence !== undefined) {
		// 最终证据逐字节原样保留：它不经改动地暂存到原生 --evidence
		// 文件，因此权威的修剪字符串规则不适用——只拒绝零长度证据。
		if (typeof input.final_evidence !== "string" || input.final_evidence.length === 0) fail("review/finalize.final_evidence", "empty", "must contain at least one byte");
		final_evidence = input.final_evidence;
	}
	return { cwd: string(input.cwd, "review/finalize.cwd"), ...(optionalLineage(input.lineageId, "review/finalize.lineageId") === undefined ? {} : { lineageId: optionalLineage(input.lineageId, "review/finalize.lineageId")! }), ...(correction_line_forecast === undefined ? {} : { correction_line_forecast }), ...(input.validation === undefined ? {} : { validation: parseValidation(input.validation, "review/finalize.validation") }), ...(final_evidence === undefined ? {} : { final_evidence }), ...(final_verification_passed === undefined ? {} : { final_verification_passed }), ...(final_verification_outcome === undefined ? {} : { final_verification_outcome }), ...(reviewer_run_acknowledged === undefined ? {} : { reviewer_run_acknowledged }) };
}

export function parseNativeCompactFinalizeInput(value: unknown): CompactFinalizeContractInput {
	const input = parseCompactFinalizeInputValue(value);
	if (input.validation && (input.validation.original_criteria.evidence.length === 0 || input.validation.correction_regression.evidence.length === 0)) {
		fail("review/finalize.validation", "empty", "validator evidence must be non-empty");
	}
	if (input.validation?.follow_ups.some((row) => row.proof_refs.length === 0)) fail("review/finalize.validation.follow_ups", "empty", "follow-up proof_refs must be non-empty");
	return input;
}

export function toNativeValidatorDocument(input: CompactTargetedValidationInput) {
	return {
		original_criteria: input.original_criteria,
		correction_regression: input.correction_regression,
		follow_ups: input.follow_ups.map((row) => ({ observation: row.summary, proof_refs: [...row.proof_refs] })),
	};
}
