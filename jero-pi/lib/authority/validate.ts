import { jeroDomainHash } from "./canonical.ts";
import type { JeroAuthorityContextV1 } from "./review.ts";
import type { JeroReviewTransactionStateV1 } from "./protocol.ts";
import type { JeroLineageStateFileV1 } from "./lineage-store.ts";
import { projectJeroReviewStateV1, checkJeroReviewTransitionV1, type JeroEscalationCause, type JeroWireReviewState } from "./transitions.ts";
import { parseNativeCompactFinalizeInput, CompactReviewContractError, toNativeValidatorDocument, type CompactTargetedValidationInput } from "../review-compact-contract.ts";
import {
	assertDistinctCorrectionEvidence,
	resolveCorrectionStep,
	type CorrectionEvidence,
	type CorrectionOutcome,
	type CorrectionStatus,
} from "../review-correction-lifecycle.ts";
import { deriveJeroReviewReceiptV1, issueJeroReviewReceiptV1, type JeroFindingSubmissionRowV1 } from "./finalize.ts";
import { isJeroLineageId } from "./store-root.ts";
import { canonicalJsonV1 } from "../review-canonical.ts";

// `authority.review.validate`（spec §E）：经移植的
// review-correction-lifecycle 决策机（原样封装——resolveCorrectionStep +
// assertDistinctCorrectionEvidence）实现证据先行的修正顺序，随后在冻结
// 修正范围上做定向验证受理。答案文档契约由移植的
// review-compact-contract.ts 封装强制执行（原样封装）。

export type JeroValidateRefusalCode =
	| "invalid-request" | "invalid-state" | "lineage-missing" | "corrupted" | "terminal-immutable"
	| "cross-mode-operation-refused" | "evidence-first-required" | "request-hash-mismatch" | "correction-scope-mismatch" | "evidence-replaced"
	| "authority-unavailable";

export interface JeroCorrectionEvidenceSubmissionV1 {
	readonly outcome: CorrectionOutcome;
	readonly evidenceIdentity: string;
	readonly recordDigest: string;
	readonly candidateTree?: string;
}

export interface JeroReviewValidateInputV1 {
	readonly cwd: string;
	readonly lineageId: string;
	readonly evidence: JeroCorrectionEvidenceSubmissionV1;
	readonly validation: CompactTargetedValidationInput;
	/** validator 观察到的、由修正“新”引发的发现行（封装的 `fix_caused_findings` 答案恒为 `[]`）。 */
	readonly fix_caused_result?: readonly JeroFindingSubmissionRowV1[];
	readonly idempotencyKey?: string;
}

export type JeroReviewValidateResultV1 =
	| { readonly kind: "refused"; readonly code: JeroValidateRefusalCode; readonly detail?: string }
	| { readonly kind: "validated"; readonly lineage_id: string; readonly state: JeroWireReviewState; readonly validated_finding_ids: readonly string[]; readonly revision?: string }
	| { readonly kind: "recapture_required"; readonly lineage_id: string; readonly state: JeroWireReviewState; readonly supersedes: string; readonly guidance: string; readonly revision?: string }
	| { readonly kind: "terminal"; readonly lineage_id: string; readonly state: "approved" | "escalated"; readonly escalation?: { readonly cause: JeroEscalationCause; readonly finding_ids: readonly string[] }; readonly receipt_hash: string; readonly revision?: string };

function clone<T>(value: T): T {
	return JSON.parse(canonicalJsonV1(value)) as T;
}

function correctionStatusOfV1(state: JeroReviewTransactionStateV1): CorrectionStatus {
	return {
		lineageId: state.lineage_id,
		targetIdentity: state.snapshot.identity,
		authorityRevision: state.evidence_hash,
		correctionBudget: state.correction_budget ?? 0,
		changedLinesCharged: state.actual_correction_lines ?? 0,
	};
}

function evidenceOfV1(submission: JeroCorrectionEvidenceSubmissionV1): CorrectionEvidence {
	return {
		outcome: submission.outcome,
		evidenceIdentity: submission.evidenceIdentity,
		recordDigest: submission.recordDigest,
		...(submission.candidateTree === undefined ? {} : { candidateTree: submission.candidateTree }),
	};
}

function loadLineageV1(context: JeroAuthorityContextV1, lineageId: string): { ok: true; record: JeroLineageStateFileV1 } | { ok: false; code: JeroValidateRefusalCode; detail?: string } {
	// F1：畸形的 lineageId 是类型化拒绝，绝不透出原始存储错误。
	if (!isJeroLineageId(lineageId)) return { ok: false, code: "invalid-request", detail: `lineageId ${JSON.stringify(lineageId)} is not a canonical review-<16hex> lineage id` };
	const loaded = context.lineages.load(lineageId);
	if (loaded.kind === "missing") return { ok: false, code: "lineage-missing", detail: `lineage ${lineageId} does not exist` };
	if (loaded.kind === "corrupted") return { ok: false, code: "corrupted", detail: loaded.detail };
	return { ok: true, record: loaded.record };
}

/** §E 的请求哈希绑定：答案文档必须在冻结修正范围上携带此哈希。 */
export function expectedJeroTargetedValidationRequestHashV1(state: JeroReviewTransactionStateV1): string {
	return jeroDomainHash("targeted-validation-request", {
		lineage_id: state.lineage_id,
		target_identity: state.snapshot.identity,
		fix_finding_ids: state.fix_finding_ids,
		findings: state.findings.filter((finding) => state.fix_finding_ids.includes(finding.id)),
		fix_delta_hash: state.fix_delta_hash,
	});
}

/**
 * VALIDATE（spec §E）。修正证据结局“首先”被裁决（证据先行顺序）；
 * 只有 `passed` 解锁定向验证，`verification_failed` 的捕获免费重开
 * 修正，`procedural_tooling_failed` 是终局升级。答案文档随后在绑定的
 * request_hash 下与冻结的 `fix_finding_ids` 一一配对；回归与修正引发
 * 的发现触发升级——验证失败绝不重开修正（openspec
 * review-transaction :104）。
 */
export function reviewValidateV1(context: JeroAuthorityContextV1, input: JeroReviewValidateInputV1): JeroReviewValidateResultV1 {
	// 封装契约（原样移植）：精确键集、摘要形的 request_hash、
	// fix_caused_findings 必须是显式空数组、证据非空。
	try {
		parseNativeCompactFinalizeInput({ cwd: input.cwd, lineageId: input.lineageId, validation: { ...input.validation } });
	} catch (error) {
		if (error instanceof CompactReviewContractError) return { kind: "refused", code: "invalid-request", detail: `${error.area}: ${error.code}` };
		return { kind: "refused", code: "invalid-request", detail: error instanceof Error ? error.message : String(error) };
	}
	const loaded = loadLineageV1(context, input.lineageId);
	if (loaded.ok === false) return { kind: "refused", code: loaded.code, detail: loaded.detail };
	const record = loaded.record;
	const state = record.state;
	if (state.state === "approved" || state.state === "escalated" || state.state === "invalidated") {
		return { kind: "refused", code: "terminal-immutable", detail: `lineage ${state.lineage_id} is terminal (${state.state})` };
	}
	if (state.mode === "judgment_day") {
		// M3（§J.4 跨模式）：Judgment Day 运行零个定向 validator——
		// judgment-day.ts 中的定向再判决受理是 validate-fix 转移的 JD
		// 孪生。
		return { kind: "refused", code: "cross-mode-operation-refused", detail: "the ordinary targeted validation is not a Judgment Day operation" };
	}
	// 证据先行顺序（spec §E / openspec review-correction-lifecycle :9-11）。
	const step = resolveCorrectionStep(correctionStatusOfV1(state), evidenceOfV1(input.evidence));
	if (state.state !== "fix_validating") {
		return { kind: "refused", code: "evidence-first-required", detail: `targeted validation requires fix_validating (lineage is in ${state.state}); record correction evidence first` };
	}
	// 跨重新捕获的互异不可变证据目录。下面的重开会清除已记录证据，
	// 因此相异性“同样”对失败修订的身份成立（F3）：同一身份绝不能在
	// 失败捕获之后再次提交——复用的证据目录是被替换的记录，不是新
	// 捕获。
	if (state.failed_evidence_revision !== undefined && input.evidence.evidenceIdentity === state.failed_evidence_revision) {
		return { kind: "refused", code: "evidence-replaced", detail: `correction evidence identity ${JSON.stringify(input.evidence.evidenceIdentity)} was already used by the failed capture it supersedes; every recapture must land under a distinct immutable evidence identity` };
	}
	if (state.correction_evidence !== undefined) {
		const prior: CorrectionEvidence = {
			outcome: state.correction_evidence.outcome,
			evidenceIdentity: state.correction_evidence.evidence_identity,
			recordDigest: state.correction_evidence.record_digest,
			...(state.correction_evidence.candidate_tree === undefined ? {} : { candidateTree: state.correction_evidence.candidate_tree }),
		};
		try {
			assertDistinctCorrectionEvidence({
				prior,
				next: evidenceOfV1(input.evidence),
				priorStillResolvable: true,
				priorRecordDigestNow: prior.recordDigest,
			});
		} catch (error) {
			return { kind: "refused", code: "evidence-replaced", detail: error instanceof Error ? error.message : String(error) };
		}
	}
	if (step.kind === "recapture-required") {
		// §A.2 行 7c：免费重开；先前记录不可变。
		const next = clone(state);
		next.state = "fixing";
		next.failed_evidence_revision = input.evidence.evidenceIdentity;
		next.correction_evidence = undefined;
		try {
			const saved = context.lineages.save(record.lineage_id, { state: next, request_journal: record.request_journal }, { expectedRevision: record.revision });
			return {
				kind: "recapture_required",
				lineage_id: next.lineage_id,
				state: projectJeroReviewStateV1(next.state),
				supersedes: input.evidence.evidenceIdentity,
				guidance: step.guidance,
				revision: saved.revision,
			};
		} catch (error) {
			return { kind: "refused", code: "authority-unavailable", detail: error instanceof Error ? error.message : String(error) };
		}
	}
	if (step.kind === "terminal-escalation") {
		// §A.2 行 7d：程序性工具故障在任何重试之前升级。
		return runValidateOperationV1(context, record, input, (next) => {
			next.correction_evidence = {
				outcome: input.evidence.outcome,
				evidence_identity: input.evidence.evidenceIdentity,
				record_digest: input.evidence.recordDigest,
				...(input.evidence.candidateTree === undefined ? {} : { candidate_tree: input.evidence.candidateTree }),
			};
			next.state = "escalated";
			next.invalidation_reason = "escalation cause targeted_validator_rejected: procedural tooling failed while capturing verification evidence";
			const receipt = deriveJeroReviewReceiptV1(next);
			if (receipt.ok === false) return { kind: "refused", code: "authority-unavailable", detail: receipt.detail };
			return {
				kind: "terminal",
				lineage_id: next.lineage_id,
				state: "escalated",
				escalation: { cause: "targeted_validator_rejected", finding_ids: [...next.fix_finding_ids] },
				receipt_hash: receipt.envelope.receipt_hash,
			};
		});
	}
	// step.kind === “run-targeted-validation”：受理答案文档。
	const expectedHash = expectedJeroTargetedValidationRequestHashV1(state);
	if (input.validation.request_hash !== expectedHash) {
		return { kind: "refused", code: "request-hash-mismatch", detail: `validation request_hash does not bind the frozen correction scope (expected ${expectedHash.slice(0, 16)}…)` };
	}
	const submittedIds = [...input.validation.correction_ids].toSorted();
	const frozenIds = [...state.fix_finding_ids].toSorted();
	if (submittedIds.length !== frozenIds.length || submittedIds.some((id, index) => id !== frozenIds[index])) {
		return { kind: "refused", code: "correction-scope-mismatch", detail: `correction_ids must pair 1:1 with the frozen fix_finding_ids (${frozenIds.join(", ")})` };
	}
	const fixCaused = input.fix_caused_result ?? [];
	return runValidateOperationV1(context, record, input, (next) => {
		next.correction_evidence = {
			outcome: input.evidence.outcome,
			evidence_identity: input.evidence.evidenceIdentity,
			record_digest: input.evidence.recordDigest,
			...(input.evidence.candidateTree === undefined ? {} : { candidate_tree: input.evidence.candidateTree }),
		};
		const escalate = (cause: JeroEscalationCause, detail: string): JeroReviewValidateResultV1 => {
			next.state = "escalated";
			next.invalidation_reason = `escalation cause ${cause}: ${detail}`;
			const receipt = deriveJeroReviewReceiptV1(next);
			if (receipt.ok === false) return { kind: "refused", code: "authority-unavailable", detail: receipt.detail };
			return {
				kind: "terminal",
				lineage_id: next.lineage_id,
				state: "escalated",
				escalation: { cause, finding_ids: [...next.fix_finding_ids] },
				receipt_hash: receipt.envelope.receipt_hash,
			};
		};
		// validator 不能新增发现：由修正引发的新行触发升级（§E）。
		if (fixCaused.length > 0) {
			next.fix_caused_findings = fixCaused.map((finding, index) => ({ id: finding.id ?? `fix-caused-${index}`, ...(finding.location === undefined ? {} : { location: finding.location }), ...(finding.severity === undefined ? {} : { severity: finding.severity }), ...(finding.claim === undefined ? {} : { claim: finding.claim }), ...(finding.proof_refs === undefined ? {} : { proof_refs: [...finding.proof_refs] }) }));
			return escalate("targeted_validator_rejected", "the targeted validator reported findings caused by the correction");
		}
		// 原始验收标准必须通过；每个冻结 ID 一条通过的回归证明。
		if (!input.validation.original_criteria.passed) {
			return escalate("targeted_validator_rejected", "original acceptance criteria did not pass");
		}
		if (!input.validation.correction_regression.passed) {
			return escalate("targeted_validator_rejected", "correction regression checks did not pass for every frozen finding");
		}
		const transition = checkJeroReviewTransitionV1(next.state, next.mode, "validate-fix", { fixRounds: next.counters.fix_rounds, fixBatches: next.counters.fix_batches });
		if (!transition.legal) return { kind: "refused", code: "invalid-state", detail: transition.reason };
		next.original_criteria = {
			evidence_hash: jeroDomainHash("validation-evidence", input.validation.original_criteria.evidence),
			fix_delta_hash: next.fix_delta_hash,
			passed: true,
		};
		next.correction_regression = {
			evidence_hash: jeroDomainHash("validation-evidence", input.validation.correction_regression.evidence),
			fix_delta_hash: next.fix_delta_hash,
			passed: true,
		};
		// Follow-up 是惰性观察（§D.4），经移植的 toNativeValidatorDocument
		// 映射，使封装行与记录行一致。
		const document = toNativeValidatorDocument({ ...input.validation, fix_caused_findings: [] });
		for (const followUp of document.follow_ups) {
			const observation = `${followUp.observation}`;
			if (!next.follow_ups.some((existing) => existing.observation === observation)) {
				next.follow_ups.push({ observation, proof_refs: [...followUp.proof_refs] });
			}
		}
		next.counters.scoped_fix_validations += 1;
		next.state = "ready_final_verification";
		return {
			kind: "validated",
			lineage_id: next.lineage_id,
			state: projectJeroReviewStateV1(next.state),
			validated_finding_ids: frozenIds,
		};
	});
}

function runValidateOperationV1(context: JeroAuthorityContextV1, record: JeroLineageStateFileV1, input: JeroReviewValidateInputV1, apply: (state: JeroReviewTransactionStateV1) => JeroReviewValidateResultV1): JeroReviewValidateResultV1 {
	// F14：请求哈希只绑定请求“内容”；幂等键是寻址信息而非内容
	// （权威 JSON 会丢弃 undefined 的对象值）。
	const requestHash = jeroDomainHash("request", { operation: "validate-fix", lineage_id: record.lineage_id, input: { ...input, idempotencyKey: undefined } });
	const idempotencyKey = input.idempotencyKey ?? `validate-fix:${requestHash.slice(0, 16)}`;
	try {
		const outcome = context.lineages.runOperation({
			lineageId: record.lineage_id,
			operation: "validate-fix",
			idempotencyKey,
			requestHash,
			apply: (current) => {
				const next = clone(current.state);
				const result = apply(next);
				// 被拒绝的归约绝不能进入日志（对齐 finalize 的 F14 纪律）：
				// apply 可能在返回 refused 前已改动草稿（correction_evidence、
				// escalated、fix_caused_findings），抛出以中止保存——已改动的
				// 草稿被丢弃，拒绝以类型化结果原样返回，绝不作为
				// canonical_result 持久化（否则精确重放会永远返回该拒绝，
				// 而记录状态已经漂移）。
				if (result.kind === "refused") throw new JeroValidateApplyRefusalError(result);
				return { draft: { state: next, request_journal: current.request_journal }, result };
			},
		});
		const result = outcome.result;
		// F8 顺序（对齐 finalize 的 runJournaledV1）：终局（escalated）结果
		// 的回执在日志落盘成功之后从已保存状态内容派生并原子写入；apply
		// 内只做纯派生（receipt_hash 进结果），磁盘上不再有先于日志的孤儿
		// 回执，精确重放在此幂等重签。
		if (result.kind === "terminal") {
			const reloaded = context.lineages.load(record.lineage_id);
			if (reloaded.kind !== "ok") {
				return { kind: "refused", code: "authority-unavailable", detail: "terminal state was journaled, but its lineage could not be reloaded for receipt issuance" };
			}
			const issued = issueJeroReviewReceiptV1(context, reloaded.record.state);
			if (issued.ok === false) {
				return { kind: "refused", code: "authority-unavailable", detail: `terminal state was journaled, but its receipt could not be persisted: ${issued.detail}` };
			}
			if (issued.envelope.receipt_hash !== result.receipt_hash) {
				return { kind: "refused", code: "authority-unavailable", detail: "terminal state was journaled, but its receipt derivation drifted from the recorded result" };
			}
		}
		if (result.kind === "validated" || result.kind === "recapture_required") return { ...result, revision: outcome.revision };
		return result;
	} catch (error) {
		if (error instanceof JeroValidateApplyRefusalError) return error.refusal;
		return { kind: "refused", code: "authority-unavailable", detail: error instanceof Error ? error.message : String(error) };
	}
}

class JeroValidateApplyRefusalError extends Error {
	readonly refusal: JeroReviewValidateResultV1;
	constructor(refusal: JeroReviewValidateResultV1) {
		super("apply-refused");
		this.name = "JeroValidateApplyRefusalError";
		this.refusal = refusal;
	}
}
