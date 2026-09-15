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
import { issueJeroReviewReceiptV1, type JeroFindingSubmissionRowV1 } from "./finalize.ts";
import { isJeroLineageId } from "./store-root.ts";
import { canonicalJsonV1 } from "../review-canonical.ts";

// `authority.review.validate` (spec §E): evidence-first correction ordering
// through the ported review-correction-lifecycle decision machine (wrapped
// as-is — resolveCorrectionStep + assertDistinctCorrectionEvidence), then
// targeted-validation admission over the frozen correction scope. The answer
// document contract is enforced by the ported review-compact-contract.ts
// wrapper (wrapped as-is).

export type JeroValidateRefusalCode =
	| "invalid-request" | "invalid-state" | "lineage-missing" | "corrupted" | "terminal-immutable"
	| "evidence-first-required" | "request-hash-mismatch" | "correction-scope-mismatch" | "evidence-replaced"
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
	/** Rows the validator observed as NEW findings caused by the fix (the wrapper's `fix_caused_findings` answer is always `[]`). */
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
	// F1: a malformed lineageId is a typed refusal, never a raw store error.
	if (!isJeroLineageId(lineageId)) return { ok: false, code: "invalid-request", detail: `lineageId ${JSON.stringify(lineageId)} is not a canonical review-<16hex> lineage id` };
	const loaded = context.lineages.load(lineageId);
	if (loaded.kind === "missing") return { ok: false, code: "lineage-missing", detail: `lineage ${lineageId} does not exist` };
	if (loaded.kind === "corrupted") return { ok: false, code: "corrupted", detail: loaded.detail };
	return { ok: true, record: loaded.record };
}

/** §E request-hash binding: the answer document must carry this hash over the frozen correction scope. */
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
 * VALIDATE (spec §E). The correction evidence outcome is resolved FIRST
 * (evidence-first ordering); only `passed` unlocks targeted validation, a
 * `verification_failed` capture reopens the correction charging nothing, and
 * `procedural_tooling_failed` is a terminal escalation. The answer document
 * then pairs 1:1 with the frozen `fix_finding_ids` under the bound
 * request_hash; regressions and fix-caused findings escalate — validation
 * failure never reopens correction (openspec review-transaction :104).
 */
export function reviewValidateV1(context: JeroAuthorityContextV1, input: JeroReviewValidateInputV1): JeroReviewValidateResultV1 {
	// Wrapper contract (as-is port): exact keys, digest-shaped request_hash,
	// fix_caused_findings must be an explicitly empty array, evidence non-empty.
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
	// Evidence-first ordering (spec §E / openspec review-correction-lifecycle :9-11).
	const step = resolveCorrectionStep(correctionStatusOfV1(state), evidenceOfV1(input.evidence));
	if (state.state !== "fix_validating") {
		return { kind: "refused", code: "evidence-first-required", detail: `targeted validation requires fix_validating (lineage is in ${state.state}); record correction evidence first` };
	}
	// Distinct immutable evidence directories across recaptures. The reopen
	// below clears the recorded evidence, so distinctness ALSO holds against
	// the failed revision's identity (F3): the same identity may never be
	// re-presented after a failed capture — a reused evidence directory is a
	// replaced record, not a fresh capture.
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
		// §A.2 row 7c: reopen without charging anything; prior record immutable.
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
		// §A.2 row 7d: procedural tooling failure escalates before any retry.
		return runValidateOperationV1(context, record, input, (next) => {
			next.correction_evidence = {
				outcome: input.evidence.outcome,
				evidence_identity: input.evidence.evidenceIdentity,
				record_digest: input.evidence.recordDigest,
				...(input.evidence.candidateTree === undefined ? {} : { candidate_tree: input.evidence.candidateTree }),
			};
			next.state = "escalated";
			next.invalidation_reason = "escalation cause targeted_validator_rejected: procedural tooling failed while capturing verification evidence";
			const receipt = issueJeroReviewReceiptV1(context, next);
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
	// step.kind === "run-targeted-validation": admit the answer document.
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
			const receipt = issueJeroReviewReceiptV1(context, next);
			if (receipt.ok === false) return { kind: "refused", code: "authority-unavailable", detail: receipt.detail };
			return {
				kind: "terminal",
				lineage_id: next.lineage_id,
				state: "escalated",
				escalation: { cause, finding_ids: [...next.fix_finding_ids] },
				receipt_hash: receipt.envelope.receipt_hash,
			};
		};
		// The validator cannot add findings: new rows caused by the fix escalate (§E).
		if (fixCaused.length > 0) {
			next.fix_caused_findings = fixCaused.map((finding, index) => ({ id: finding.id ?? `fix-caused-${index}`, ...(finding.location === undefined ? {} : { location: finding.location }), ...(finding.severity === undefined ? {} : { severity: finding.severity }), ...(finding.claim === undefined ? {} : { claim: finding.claim }), ...(finding.proof_refs === undefined ? {} : { proof_refs: [...finding.proof_refs] }) }));
			return escalate("targeted_validator_rejected", "the targeted validator reported findings caused by the correction");
		}
		// Original acceptance criteria must pass; one passing regression proof per frozen ID.
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
		// Follow-ups are inert observations (§D.4), mapped through the ported
		// toNativeValidatorDocument so wrapper rows and record rows agree.
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
	// F14: the request hash binds request CONTENT only; the idempotency key is
	// addressing, not content (canonical JSON drops undefined object values).
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
				return { draft: { state: next, request_journal: current.request_journal }, result };
			},
		});
		const result = outcome.result;
		if (result.kind === "validated" || result.kind === "recapture_required") return { ...result, revision: outcome.revision };
		return result;
	} catch (error) {
		return { kind: "refused", code: "authority-unavailable", detail: error instanceof Error ? error.message : String(error) };
	}
}
