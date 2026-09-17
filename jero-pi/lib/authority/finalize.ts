import { JERO_RECEIPT_BODY_SCHEMA, jeroDomainHash } from "./canonical.ts";
import type { JeroAuthorityContextV1 } from "./review.ts";
import {
	type JeroFindingLens,
	type JeroFindingRowV1,
	type JeroFollowUpV1,
	type JeroLensName,
	type JeroLensResultV1,
	type JeroReceiptBodyV1,
	type JeroReceiptEnvelopeV1,
	type JeroReviewTransactionStateV1,
} from "./protocol.ts";
import type { JeroLineageStateFileV1 } from "./lineage-store.ts";
import { isJeroLineageId } from "./store-root.ts";
import { deriveJeroCorrectionLinesV1 } from "./snapshots.ts";
import { jeroReceiptPathV1, createJeroReceiptEnvelopeV1 } from "./receipts.ts";
import { projectJeroReviewStateV1, checkJeroReviewTransitionV1, isJeroOrdinaryModeV1, isJeroTerminalReviewStateV1, type JeroEscalationCause, type JeroWireReviewState } from "./transitions.ts";
import { parseNativeCompactFinalizeInput, CompactReviewContractError, type CompactFinalizeContractInput } from "../review-compact-contract.ts";
import type { CorrectionOutcome } from "../review-correction-lifecycle.ts";
import { writeFileSync, mkdirSync } from "node:fs";
import { canonicalJsonV1 } from "../review-canonical.ts";
import { capturedJeroArtifactsCompleteV1 } from "./result-artifacts.ts";

// `authority.review.finalize` (spec §D): lens-result admission (`freeze-
// ledger`), classification/refutation (`resolve-evidence`), correction-plan
// admission (`authorize-fix`), bounded-edit application, and final
// verification (`verify`) — each reduction reimplemented over the compact
// `JeroReviewTransactionStateV1` record with review-policy-ordinary.ts as the
// semantic oracle, and the wrapper input contract enforced by the ported
// review-compact-contract.ts (wrapped as-is).

export type JeroFinalizeRefusalCode =
	| "not-a-git-repository" | "git-unavailable" | "authority-unavailable" | "foreign-authority-store"
	| "invalid-request" | "invalid-state" | "lineage-missing" | "corrupted" | "terminal-immutable"
	| "cross-mode-operation-refused" | "second-correction-refused" | "non-genesis-path" | "validation-belongs-to-validate"
	| "fix-verification-failed";

export interface JeroFindingSubmissionRowV1 {
	readonly id?: string;
	readonly location?: string;
	readonly severity?: "BLOCKER" | "CRITICAL" | "WARNING" | "SUGGESTION";
	readonly claim?: string;
	readonly proof_refs?: readonly string[];
}

export interface JeroLensResultSubmissionV1 {
	readonly lens: JeroLensName;
	readonly findings: readonly JeroFindingSubmissionRowV1[];
	readonly evidence: readonly string[];
}

export interface JeroFindingClassificationSubmissionV1 {
	readonly finding_id: string;
	readonly class: "deterministic" | "inferential" | "insufficient";
	readonly proof: string;
	readonly causal_disposition?: "introduced" | "behavior-activated" | "worsened" | "pre-existing" | "base-only" | "unknown";
}

export interface JeroRefuterResolutionSubmissionV1 {
	readonly finding_id: string;
	readonly outcome: "corroborated" | "refuted" | "inconclusive";
	readonly proof: string;
}

export interface JeroRefuterBatchSubmissionV1 {
	readonly request_hash: string;
	readonly resolutions: readonly JeroRefuterResolutionSubmissionV1[];
}

export interface JeroFixApplicationV1 {
	readonly candidate_tree: string;
	readonly fix_delta_hash: string;
	readonly correction_paths: readonly string[];
	readonly actual_correction_lines: number;
}

export interface JeroReviewFinalizeInputV1 {
	readonly cwd: string;
	readonly lineageId?: string;
	/** Absent ⇒ forecast-only run, spends nothing (spec §D.1). */
	readonly reviewer_run_acknowledged?: boolean;
	readonly review_result?: { readonly lens_results: readonly JeroLensResultSubmissionV1[] };
	readonly classifications?: readonly JeroFindingClassificationSubmissionV1[];
	readonly refuter_batch?: JeroRefuterBatchSubmissionV1;
	readonly correction_line_forecast?: number;
	readonly fix_application?: JeroFixApplicationV1;
	readonly final_evidence?: string;
	readonly final_verification_passed?: boolean;
	readonly final_verification_outcome?: CorrectionOutcome;
	readonly idempotencyKey?: string;
}

export type JeroReviewFinalizeResultV1 =
	| { readonly kind: "refused"; readonly code: JeroFinalizeRefusalCode; readonly detail?: string }
	| { readonly kind: "forecast"; readonly lineage_id: string; readonly state: JeroWireReviewState; readonly lens_slots: readonly { lens: JeroLensName; findings: number }[]; readonly note: string }
	| { readonly kind: "frozen"; readonly lineage_id: string; readonly state: JeroWireReviewState; readonly findings: readonly JeroFindingRowV1[]; readonly ledger_findings_hash: string; readonly revision?: string }
	| { readonly kind: "refuter_required"; readonly lineage_id: string; readonly state: JeroWireReviewState; readonly canonical_rows: readonly JeroFindingRowV1[]; readonly refuter_request_hash: string; readonly revision?: string }
	| { readonly kind: "evidence_resolved"; readonly lineage_id: string; readonly state: JeroWireReviewState; readonly fix_finding_ids: readonly string[]; readonly follow_ups: readonly JeroFollowUpV1[]; readonly revision?: string }
	| { readonly kind: "fix_authorized"; readonly lineage_id: string; readonly state: JeroWireReviewState; readonly proposed_correction_lines: number; readonly correction_budget: number; readonly revision?: string }
	| { readonly kind: "fix_applied"; readonly lineage_id: string; readonly state: JeroWireReviewState; readonly actual_correction_lines: number; readonly fix_delta_hash: string; readonly revision?: string }
	| { readonly kind: "terminal"; readonly lineage_id: string; readonly state: "approved" | "escalated"; readonly escalation?: { readonly cause: JeroEscalationCause; readonly finding_ids: readonly string[] }; readonly receipt_hash: string; readonly revision?: string };

const SEVERE = new Set(["BLOCKER", "CRITICAL"]);
const CANDIDATE_CAUSED = new Set(["introduced", "behavior-activated", "worsened"]);
const BARE_LENS: Readonly<Record<JeroLensName, JeroFindingLens>> = {
	"review-risk": "risk",
	"review-resilience": "resilience",
	"review-readability": "readability",
	"review-reliability": "reliability",
};

function lensResultHashV1(lens: JeroLensName, findings: readonly JeroFindingRowV1[], evidence: readonly string[]): string {
	return jeroDomainHash("lens-result", { lens, findings, evidence });
}

function clone<T>(value: T): T {
	return JSON.parse(canonicalJsonV1(value)) as T;
}

/**
 * Wraps the ported `parseNativeCompactFinalizeInput` as-is (spec §D.1): the
 * wrapper-known subset must satisfy the exact key set and pairing rules of
 * review-compact-contract.ts; M2's own extensions (review_result,
 * classifications, refuter_batch, fix_application) are strict-decoded
 * separately below because the upstream wrapper never carried them.
 */
export function parseFinalizeWrapperSubsetV1(input: JeroReviewFinalizeInputV1): CompactFinalizeContractInput {
	const wrapperInput: Record<string, unknown> = { cwd: input.cwd };
	for (const key of ["lineageId", "correction_line_forecast", "final_evidence", "final_verification_passed", "final_verification_outcome", "reviewer_run_acknowledged"] as const) {
		if (input[key] !== undefined) wrapperInput[key] = input[key];
	}
	return parseNativeCompactFinalizeInput(wrapperInput);
}

function decodeFinalizeExtensionsV1(input: JeroReviewFinalizeInputV1): string | undefined {
	const allowed = new Set(["cwd", "lineageId", "reviewer_run_acknowledged", "review_result", "classifications", "refuter_batch", "correction_line_forecast", "fix_application", "final_evidence", "final_verification_passed", "final_verification_outcome", "idempotencyKey", "validation"]);
	for (const key of Object.keys(input)) if (!allowed.has(key)) return `unknown field ${key}`;
	if (input.review_result !== undefined) {
		if (typeof input.review_result !== "object" || input.review_result === null || Array.isArray(input.review_result)) return "review_result must be an object";
		if (clone(input.review_result).lens_results === undefined) return "review_result requires lens_results";
		for (const [index, result] of input.review_result.lens_results.entries()) {
			if (typeof result !== "object" || result === null) return `review_result.lens_results[${index}] must be an object`;
			for (const key of Object.keys(result)) if (!["lens", "findings", "evidence"].includes(key)) return `review_result.lens_results[${index}] carries unknown field ${key}`;
			if (typeof result.lens !== "string" || !(Object.keys(BARE_LENS) as readonly string[]).includes(result.lens)) return `review_result.lens_results[${index}].lens is unsupported`;
			if (!Array.isArray(result.findings)) return `review_result.lens_results[${index}].findings must be an array`;
			// Mi8 (review ruling), mirroring capture.ts: findings present ⇒
			// evidence may be empty (each finding carries its own proof_refs);
			// clean (empty findings) ⇒ evidence must be non-empty.
			if (!Array.isArray(result.evidence) || result.evidence.some((row: unknown) => typeof row !== "string" || row.length === 0)) return `review_result.lens_results[${index}].evidence must be a string array`;
			if (result.findings.length === 0 && result.evidence.length === 0) return `review_result.lens_results[${index}]: empty findings require non-empty evidence`;
			for (const [row, finding] of result.findings.entries()) {
				if (typeof finding !== "object" || finding === null) return `review_result.lens_results[${index}].findings[${row}] must be an object`;
				for (const key of Object.keys(finding)) if (!["id", "location", "severity", "claim", "proof_refs"].includes(key)) return `findings[${row}] carries unknown field ${key}`;
				if (finding.severity !== undefined && !SEVERE.has(finding.severity) && !["WARNING", "SUGGESTION"].includes(finding.severity)) return `findings[${row}].severity is unsupported`;
			}
		}
	}
	if (input.classifications !== undefined) {
		if (!Array.isArray(input.classifications)) return "classifications must be an array";
		for (const [row, classification] of input.classifications.entries()) {
			if (typeof classification !== "object" || classification === null) return `classifications[${row}] must be an object`;
			for (const key of Object.keys(classification)) if (!["finding_id", "class", "proof", "causal_disposition"].includes(key)) return `classifications[${row}] carries unknown field ${key}`;
			if (typeof classification.finding_id !== "string" || classification.finding_id.length === 0) return `classifications[${row}].finding_id is malformed`;
			if (typeof classification.proof !== "string" || classification.proof.trim().length === 0) return `classifications[${row}].proof must be concrete`;
			if (!["deterministic", "inferential", "insufficient"].includes(classification.class)) return `classifications[${row}].class is unsupported`;
		}
	}
	if (input.refuter_batch !== undefined) {
		const batch = input.refuter_batch;
		if (typeof batch !== "object" || batch === null) return "refuter_batch must be an object";
		for (const key of Object.keys(batch)) if (!["request_hash", "resolutions"].includes(key)) return `refuter_batch carries unknown field ${key}`;
		if (typeof batch.request_hash !== "string" || !/^sha256:[0-9a-f]{64}$/.test(batch.request_hash)) return "refuter_batch.request_hash is malformed";
		if (!Array.isArray(batch.resolutions)) return "refuter_batch.resolutions must be an array";
		for (const [row, resolution] of batch.resolutions.entries()) {
			if (typeof resolution !== "object" || resolution === null) return `refuter_batch.resolutions[${row}] must be an object`;
			if (typeof resolution.finding_id !== "string" || resolution.finding_id.length === 0) return `refuter_batch.resolutions[${row}].finding_id is malformed`;
			if (!["corroborated", "refuted", "inconclusive"].includes(resolution.outcome)) return `refuter_batch.resolutions[${row}].outcome is unsupported`;
			if (typeof resolution.proof !== "string" || resolution.proof.trim().length === 0) return `refuter_batch.resolutions[${row}].proof must be concrete`;
		}
	}
	if (input.fix_application !== undefined) {
		const fix = input.fix_application;
		if (typeof fix !== "object" || fix === null) return "fix_application must be an object";
		for (const key of Object.keys(fix)) if (!["candidate_tree", "fix_delta_hash", "correction_paths", "actual_correction_lines"].includes(key)) return `fix_application carries unknown field ${key}`;
		if (typeof fix.candidate_tree !== "string" || !/^[0-9a-f]{40,64}$/.test(fix.candidate_tree)) return "fix_application.candidate_tree must be a resolved Git tree";
		if (typeof fix.fix_delta_hash !== "string" || !/^[0-9a-f]{64}$/.test(fix.fix_delta_hash)) return "fix_application.fix_delta_hash is malformed";
		if (!Array.isArray(fix.correction_paths) || fix.correction_paths.some((path) => typeof path !== "string" || path.length === 0)) return "fix_application.correction_paths must be repo-relative paths";
		if (!Number.isSafeInteger(fix.actual_correction_lines) || fix.actual_correction_lines < 0) return "fix_application.actual_correction_lines must be a non-negative integer";
	}
	return undefined;
}

/** §D.8 receipt issuance: envelope + `lineages/<id>/review-receipt.json` + CAS install of the body. */
export function issueJeroReviewReceiptV1(context: JeroAuthorityContextV1, state: JeroReviewTransactionStateV1): { ok: true; envelope: JeroReceiptEnvelopeV1 } | { ok: false; detail: string } {
	const body: JeroReceiptBodyV1 = {
		schema: JERO_RECEIPT_BODY_SCHEMA,
		lineage_id: state.lineage_id,
		mode: state.mode,
		state: state.state,
		base_tree: state.base_tree,
		initial_review_tree: state.initial_review_tree,
		final_candidate_tree: state.final_candidate_tree,
		paths_digest: state.paths_digest,
		fix_delta_hash: state.fix_delta_hash,
		policy_hash: state.policy_hash,
		ledger_hash: state.ledger_hash,
		ledger_findings_hash: state.ledger_findings_hash,
		evidence_hash: state.evidence_hash,
		counters: state.counters,
	};
	let envelope: JeroReceiptEnvelopeV1;
	try {
		envelope = createJeroReceiptEnvelopeV1(body);
	} catch (error) {
		return { ok: false, detail: error instanceof Error ? error.message : String(error) };
	}
	try {
		const receiptPath = jeroReceiptPathV1(context.store.store_root, state.lineage_id);
		mkdirSync(context.store.store_root, { recursive: true });
		// Canonical JSON with NO trailing newline: parseCanonicalJsonV1
		// re-serializes and compares, so the file must be byte-canonical.
		writeFileSync(receiptPath, canonicalJsonV1(envelope), { mode: 0o600 });
		context.cas.put(envelope.body, { schema: JERO_RECEIPT_BODY_SCHEMA });
	} catch (error) {
		return { ok: false, detail: error instanceof Error ? error.message : String(error) };
	}
	return { ok: true, envelope };
}

interface JeroEscalationMarkerV1 {
	cause: JeroEscalationCause;
	finding_ids: string[];
}

function escalateStateV1(state: JeroReviewTransactionStateV1, marker: JeroEscalationMarkerV1): void {
	state.state = "escalated";
	state.invalidation_reason = `escalation cause ${marker.cause}${marker.finding_ids.length > 0 ? `: ${marker.finding_ids.join(", ")}` : ""}`;
}

/** Loads the lineage for a mutating operation; typed refusal for every failure mode. */
function loadForMutationV1(context: JeroAuthorityContextV1, lineageId: string | undefined, cwd: string):
	{ ok: true; record: JeroLineageStateFileV1 } | { ok: false; code: JeroFinalizeRefusalCode; detail?: string } {
	if (lineageId === undefined) return { ok: false, code: "invalid-request", detail: "finalize requires lineageId" };
	// F1: a malformed lineageId is a typed refusal, never a raw store error.
	if (!isJeroLineageId(lineageId)) return { ok: false, code: "invalid-request", detail: `lineageId ${JSON.stringify(lineageId)} is not a canonical review-<16hex> lineage id` };
	const loaded = context.lineages.load(lineageId);
	if (loaded.kind === "missing") return { ok: false, code: "lineage-missing", detail: `lineage ${lineageId} does not exist` };
	if (loaded.kind === "corrupted") return { ok: false, code: "corrupted", detail: loaded.detail };
	return { ok: true, record: loaded.record };
}

function evidenceChainV1(previous: string, addition: unknown): string {
	return jeroDomainHash("evidence", { previous, addition });
}

function lensCounterKeyV1(lens: JeroLensName): "risk_executions" | "resilience_executions" | "readability_executions" | "reliability_executions" {
	switch (lens) {
		case "review-risk": return "risk_executions";
		case "review-resilience": return "resilience_executions";
		case "review-readability": return "readability_executions";
		default: return "reliability_executions";
	}
}

/**
 * FINALIZE (spec §D). One discriminated union covers every reduction; the
 * persisted state routes to exactly one, so replaying a completed step is an
 * invalid-state refusal and terminal states are immutable.
 */
export function reviewFinalizeV1(context: JeroAuthorityContextV1, input: JeroReviewFinalizeInputV1): JeroReviewFinalizeResultV1 {
	if (("validation" in input) && (input as { validation?: unknown }).validation !== undefined) {
		return { kind: "refused", code: "validation-belongs-to-validate", detail: "targeted validation is admitted through authority.review.validate" };
	}
	try {
		parseFinalizeWrapperSubsetV1(input);
	} catch (error) {
		if (error instanceof CompactReviewContractError) return { kind: "refused", code: "invalid-request", detail: `${error.area}: ${error.code}` };
		return { kind: "refused", code: "invalid-request", detail: error instanceof Error ? error.message : String(error) };
	}
	const extensionError = decodeFinalizeExtensionsV1(input);
	if (extensionError !== undefined) return { kind: "refused", code: "invalid-request", detail: extensionError };
	const loaded = loadForMutationV1(context, input.lineageId, input.cwd);
	if (loaded.ok === false) return { kind: "refused", code: loaded.code, detail: loaded.detail };
	const record = loaded.record;
	const state = record.state;
	if (isJeroTerminalReviewStateV1(state.state)) {
		return { kind: "refused", code: "terminal-immutable", detail: `lineage ${state.lineage_id} is terminal (${state.state})` };
	}
	// Input-first dispatch for lens admission (§A.2 illegal #2): a lens-result
	// submission is a freeze-ledger attempt from ANY state — the replay check
	// and the state gate both live inside that path, so a replay of a
	// completed freeze still returns its stored result while a second,
	// divergent admission from a non-reviewing state fails closed.
	if (input.review_result !== undefined && state.state !== "findings_frozen" || (input.review_result !== undefined && input.reviewer_run_acknowledged === true)) {
		return finalizeFreezeLedgerV1(context, record, input);
	}
	switch (state.state) {
		case "findings_frozen": return finalizeResolveEvidenceV1(context, record, input);
		case "fix_required": return finalizeAuthorizeFixV1(context, record, input);
		case "fixing": return finalizeApplyFixV1(context, record, input);
		case "ready_final_verification": return finalizeVerifyV1(context, record, input);
		default:
			return { kind: "refused", code: "invalid-state", detail: `finalize is not admitted from persisted state ${state.state}` };
	}
}

class JeroApplyRefusalError extends Error {
	readonly refusal: JeroReviewFinalizeResultV1;
	constructor(refusal: JeroReviewFinalizeResultV1) {
		super("apply-refused");
		this.name = "JeroApplyRefusalError";
		this.refusal = refusal;
	}
}

function runJournaledV1(context: JeroAuthorityContextV1, record: JeroLineageStateFileV1, operation: "freeze-ledger" | "resolve-evidence" | "authorize-fix" | "apply-fix" | "verify", input: JeroReviewFinalizeInputV1, apply: (state: JeroReviewTransactionStateV1) => JeroReviewFinalizeResultV1): JeroReviewFinalizeResultV1 {
	// F14: the request hash binds request CONTENT only — the idempotency key is
	// addressing, not content, so it is stripped before hashing (canonical JSON
	// drops undefined object values).
	const requestHash = jeroDomainHash("request", { operation, lineage_id: record.lineage_id, input: { ...input, idempotencyKey: undefined } });
	const idempotencyKey = input.idempotencyKey ?? `${operation}:${requestHash.slice(0, 16)}`;
	try {
		const outcome = context.lineages.runOperation({
			lineageId: record.lineage_id,
			operation,
			idempotencyKey,
			requestHash,
			apply: (current) => {
				const next = clone(current.state);
				const result = apply(next);
				// A refused reduction must never reach the journal: abort the
				// save by throwing, and surface the typed refusal below.
				if (result.kind === "refused") throw new JeroApplyRefusalError(result);
				return { draft: { state: next, request_journal: current.request_journal }, result };
			},
		});
		const result = outcome.result;
		// The stored canonical result omits the save revision (it is derived
		// from the journal that stores it); patch it into the live reply.
		if (result.kind === "frozen" || result.kind === "refuter_required" || result.kind === "evidence_resolved" || result.kind === "fix_authorized" || result.kind === "fix_applied") {
			return { ...result, revision: outcome.revision };
		}
		return result;
	} catch (error) {
		if (error instanceof JeroApplyRefusalError) return error.refusal;
		return { kind: "refused", code: "authority-unavailable", detail: error instanceof Error ? error.message : String(error) };
	}
}

// --- reviewing → findings_frozen: lens-result admission (§D.1 lens results) ---

function finalizeFreezeLedgerV1(context: JeroAuthorityContextV1, record: JeroLineageStateFileV1, input: JeroReviewFinalizeInputV1): JeroReviewFinalizeResultV1 {
	const state = record.state;
	if (!isJeroOrdinaryModeV1(state.mode)) {
		return { kind: "refused", code: "cross-mode-operation-refused", detail: "ordinary lens admission is not a Judgment Day operation" };
	}
	if (input.review_result === undefined) {
		return { kind: "refused", code: "invalid-request", detail: "finalize from reviewing requires review_result.lens_results" };
	}
	const selected = state.selected_lenses ?? [];
	// Zero-lens lineages never reach `reviewing` finalize (START closed them).
	if (selected.length === 0) return { kind: "refused", code: "invalid-state", detail: "a zero-lens lineage cannot admit lens results" };
	// Forecast-only run: spends nothing (§D.1 reviewer_run_acknowledged absent).
	if (input.reviewer_run_acknowledged !== true) {
		return {
			kind: "forecast",
			lineage_id: state.lineage_id,
			state: projectJeroReviewStateV1(state.state),
			lens_slots: input.review_result.lens_results.map((result) => ({ lens: result.lens, findings: result.findings.length })),
			note: "forecast-only finalize: no model tokens are spent and no authority state changes",
		};
	}
	const submissionLenses = input.review_result.lens_results.map((result) => result.lens);
	if (new Set(submissionLenses).size !== submissionLenses.length) {
		return { kind: "refused", code: "invalid-request", detail: "each selected lens appears exactly once" };
	}
	// Lenses run exactly once, only over the selected set (illegal #2/#7).
	if (submissionLenses.length !== selected.length || !selected.every((lens) => submissionLenses.includes(lens))) {
		return { kind: "refused", code: "invalid-request", detail: "lens results must cover exactly the selected lenses" };
	}
	// MA4 (review ruling): freeze-ledger requires the captured reviewer
	// artifacts to be complete ON DISK — every selected lens admitted through
	// result-artifacts.ts with its per-lens result file present and hashing to
	// the manifest row. A hand-built review_result can no longer freeze after
	// an artifact was deleted (the STATUS execute path advertises the same
	// `captured_artifacts=complete` precondition; the gate runs before the
	// journal so an artifact deletion also refuses exact replays).
	const completeness = capturedJeroArtifactsCompleteV1(context, record);
	if (!completeness.complete) {
		return {
			kind: "refused",
			code: "invalid-state",
			detail: `freeze-ledger requires the captured reviewer artifacts to be complete on disk (missing: ${completeness.missing.map(({ lens, selected_order }) => `${lens}@${selected_order}`).join(", ")})`,
		};
	}
	return runJournaledV1(context, record, "freeze-ledger", input, (next) => {
		const transition = checkJeroReviewTransitionV1(next.state, next.mode, "freeze-ledger", { fixRounds: next.counters.fix_rounds, fixBatches: next.counters.fix_batches });
		if (!transition.legal) return { kind: "refused", code: "invalid-state", detail: transition.reason };
		const findings: JeroFindingRowV1[] = [];
		const lensResults: JeroLensResultV1[] = [];
		for (const lens of selected) {
			const submission = input.review_result!.lens_results.find((result) => result.lens === lens)!;
			const rows: JeroFindingRowV1[] = submission.findings.map((finding, index) => ({
				id: finding.id ?? `${lens}-${index}`,
				lens: BARE_LENS[lens],
				...(finding.location === undefined ? {} : { location: finding.location }),
				...(finding.severity === undefined ? {} : { severity: finding.severity }),
				...(finding.claim === undefined ? {} : { claim: finding.claim }),
				...(finding.proof_refs === undefined ? {} : { proof_refs: [...finding.proof_refs] }),
			}));
			findings.push(...rows);
			lensResults.push({ lens, findings: rows, evidence: [...submission.evidence], result_hash: lensResultHashV1(lens, rows, submission.evidence) });
			const key = lensCounterKeyV1(lens);
			next.counters[key] = (next.counters[key] ?? 0) + 1;
		}
		next.findings = findings;
		next.lens_results = lensResults;
		next.ledger_findings_hash = `sha256:${jeroDomainHash("ledger-findings", findings)}`;
		next.ledger_hash = `sha256:${jeroDomainHash("ledger", lensResults.map((result) => result.result_hash))}`;
		next.evidence_hash = evidenceChainV1(next.evidence_hash, lensResults.map((result) => ({ lens: result.lens, result_hash: result.result_hash, evidence: result.evidence })));
		next.state = "findings_frozen";
		return {
			kind: "frozen",
			lineage_id: next.lineage_id,
			state: projectJeroReviewStateV1(next.state),
			findings: next.findings,
			ledger_findings_hash: next.ledger_findings_hash,
		};
	});
}

// --- findings_frozen → evidence_classified / fix_required / escalated (§D.2-D.5) ---

export function pendingRefuterRequestHashV1(pending: readonly string[]): string {
	return `sha256:${jeroDomainHash("refuter-request", [...pending].toSorted())}`;
}

function finalizeResolveEvidenceV1(context: JeroAuthorityContextV1, record: JeroLineageStateFileV1, input: JeroReviewFinalizeInputV1): JeroReviewFinalizeResultV1 {
	const state = record.state;
	if (!isJeroOrdinaryModeV1(state.mode)) {
		return { kind: "refused", code: "cross-mode-operation-refused", detail: "Judgment Day runs zero refuters" };
	}
	if (input.classifications === undefined) {
		return { kind: "refused", code: "invalid-request", detail: "finalize from findings_frozen requires classifications" };
	}
	const findings = state.findings;
	const severeIds = findings.filter((finding) => finding.severity !== undefined && SEVERE.has(finding.severity)).map(({ id }) => id);
	// Malformed classification input escalates (§D.5): unknown or duplicated IDs.
	const seen = new Set<string>();
	for (const classification of input.classifications) {
		if (!findings.some((finding) => finding.id === classification.finding_id)) {
			return escalateNowV1(context, record, input, "resolve-evidence", { cause: "insufficient_evidence", finding_ids: [classification.finding_id] });
		}
		if (seen.has(classification.finding_id)) {
			return escalateNowV1(context, record, input, "resolve-evidence", { cause: "insufficient_evidence", finding_ids: [classification.finding_id] });
		}
		seen.add(classification.finding_id);
	}
	const byId = new Map(input.classifications.map((classification) => [classification.finding_id, classification]));
	const inferentialSevere = severeIds.filter((id) => byId.get(id)?.class === "inferential");
	const needsRefuter = inferentialSevere.filter((id) => {
		const disposition = byId.get(id)?.causal_disposition;
		return disposition === undefined || disposition === "introduced" || disposition === "behavior-activated" || disposition === "worsened";
	});
	// First FINALIZE for inferential severe rows: canonical rows + a
	// content-derived request hash WITHOUT the state transition; the second
	// replays with that hash plus one complete refuter batch (readme:295).
	if (needsRefuter.length > 0 && input.refuter_batch === undefined) {
		const requestHash = pendingRefuterRequestHashV1(needsRefuter);
		const next = clone(state);
		for (const classification of input.classifications) {
			next.classifications[classification.finding_id] = {
				finding_id: classification.finding_id,
				class: classification.class,
				proof: classification.proof,
				...(classification.causal_disposition === undefined ? {} : { causal_disposition: classification.causal_disposition }),
			};
		}
		next.pending_refuter_ids = [...needsRefuter].toSorted();
		try {
			const saved = context.lineages.save(record.lineage_id, { state: next, request_journal: record.request_journal }, { expectedRevision: record.revision });
			return {
				kind: "refuter_required",
				lineage_id: record.lineage_id,
				state: projectJeroReviewStateV1(next.state),
				canonical_rows: findings.filter((finding) => next.pending_refuter_ids.includes(finding.id)),
				refuter_request_hash: requestHash,
				revision: saved.revision,
			};
		} catch (error) {
			return { kind: "refused", code: "authority-unavailable", detail: error instanceof Error ? error.message : String(error) };
		}
	}
	return runJournaledV1(context, record, "resolve-evidence", input, (next) => {
		const transition = checkJeroReviewTransitionV1(next.state, next.mode, "resolve-evidence", { fixRounds: next.counters.fix_rounds, fixBatches: next.counters.fix_batches });
		if (!transition.legal && next.pending_refuter_ids.length === 0) return { kind: "refused", code: "invalid-state", detail: transition.reason };
		const escalation: string[] = [];
		const escalationIds: string[] = [];
		let cause: JeroEscalationCause = "insufficient_evidence";
		const refuterOutcomes = new Map<string, { outcome: string; proof: string }>();
		if (input.refuter_batch !== undefined) {
			// §A.2 illegal #12: invalid/missing/duplicate/unknown/inconclusive
			// refuter output escalates WITHOUT a second batch.
			if (input.refuter_batch.request_hash !== pendingRefuterRequestHashV1(next.pending_refuter_ids)) {
				return { kind: "refused", code: "invalid-request", detail: "refuter batch request_hash does not bind the pending refuter request" };
			}
			const pending = new Set(next.pending_refuter_ids);
			const refuterSeen = new Set<string>();
			for (const resolution of input.refuter_batch.resolutions) {
				if (!pending.has(resolution.finding_id)) {
					escalation.push(`refuter returned unknown finding ${resolution.finding_id}`);
					escalationIds.push(resolution.finding_id);
					cause = "missing_refuter_outcome";
					continue;
				}
				if (refuterSeen.has(resolution.finding_id)) {
					escalation.push(`refuter duplicated finding ${resolution.finding_id}`);
					escalationIds.push(resolution.finding_id);
					cause = "missing_refuter_outcome";
					continue;
				}
				refuterSeen.add(resolution.finding_id);
				refuterOutcomes.set(resolution.finding_id, { outcome: resolution.outcome, proof: resolution.proof });
			}
			for (const id of next.pending_refuter_ids) {
				if (!refuterSeen.has(id)) {
					escalation.push(`refuter omitted finding ${id}`);
					escalationIds.push(id);
					cause = "missing_refuter_outcome";
				}
			}
			next.counters.refuter_batches += 1;
		}
		// Record classifications.
		for (const classification of input.classifications!) {
			next.classifications[classification.finding_id] = {
				finding_id: classification.finding_id,
				class: classification.class,
				proof: classification.proof,
				...(classification.causal_disposition === undefined ? {} : { causal_disposition: classification.causal_disposition }),
			};
		}
		const fixFindingIds: string[] = [];
		const followUps: JeroFollowUpV1[] = [...next.follow_ups];
		for (const finding of findings) {
			const classification = byId.get(finding.id);
			const severe = finding.severity !== undefined && SEVERE.has(finding.severity);
			if (classification === undefined) {
				next.outcomes[finding.id] = severe ? "inconclusive" : "info";
				if (severe) {
					escalation.push(`finding ${finding.id} has no classification`);
					escalationIds.push(finding.id);
				}
				continue;
			}
			const disposition = classification.causal_disposition ?? "unknown";
			const refuted = refuterOutcomes.get(finding.id)?.outcome === "refuted";
			const inconclusive = refuterOutcomes.get(finding.id)?.outcome === "inconclusive";
			if (severe && inconclusive) {
				// readme:293 — an inconclusive refuter escalates without replacement.
				next.outcomes[finding.id] = "inconclusive";
				escalation.push(`finding ${finding.id} remained inconclusive after the only refuter batch`);
				escalationIds.push(finding.id);
				cause = "unresolved_severe_findings";
				continue;
			}
			if (severe && (classification.class === "insufficient" || disposition === "unknown")) {
				next.outcomes[finding.id] = "inconclusive";
				escalation.push(`finding ${finding.id} has ${classification.class === "insufficient" ? "insufficient evidence" : "unknown causality"}`);
				escalationIds.push(finding.id);
				cause = classification.class === "insufficient" ? "insufficient_evidence" : "unknown_causality";
				continue;
			}
			if (!CANDIDATE_CAUSED.has(disposition)) {
				// pre-existing / base-only become inert follow-ups (§D.4).
				next.outcomes[finding.id] = "info";
				if (classification.class !== "insufficient") {
					followUps.push({ observation: `${finding.id}: ${disposition} (not candidate-caused)`, proof_refs: [classification.proof] });
				}
				continue;
			}
			if (refuted) {
				next.outcomes[finding.id] = "refuted";
				continue;
			}
			// §D.3: only severe candidate-caused findings with valid proof enter correction IDs.
			next.outcomes[finding.id] = severe ? "corroborated" : "info";
			if (severe) fixFindingIds.push(finding.id);
		}
		next.evidence_hash = evidenceChainV1(next.evidence_hash, {
			classifications: input.classifications,
			...(input.refuter_batch === undefined ? {} : { refuter_batch: { request_hash: input.refuter_batch.request_hash, resolutions: input.refuter_batch.resolutions } }),
		});
		next.pending_refuter_ids = [];
		if (escalation.length > 0) {
			next.follow_ups = followUps;
			next.fix_finding_ids = [];
			escalateStateV1(next, { cause, finding_ids: [...new Set(escalationIds)].toSorted() });
			const receipt = issueJeroReviewReceiptV1(context, next);
			if (receipt.ok === false) return { kind: "refused", code: "authority-unavailable", detail: receipt.detail };
			return {
				kind: "terminal",
				lineage_id: next.lineage_id,
				state: "escalated",
				escalation: { cause, finding_ids: [...new Set(escalationIds)].toSorted() },
				receipt_hash: receipt.envelope.receipt_hash,
			};
		}
		next.fix_finding_ids = fixFindingIds.toSorted();
		next.follow_ups = followUps;
		next.state = fixFindingIds.length > 0 ? "fix_required" : "ready_final_verification";
		return {
			kind: "evidence_resolved",
			lineage_id: next.lineage_id,
			state: projectJeroReviewStateV1(next.state),
			fix_finding_ids: next.fix_finding_ids,
			follow_ups: next.follow_ups,
		};
	});
}

/** Content-driven escalation through the journaled resolve-evidence path (malformed input rows). */
function escalateNowV1(context: JeroAuthorityContextV1, record: JeroLineageStateFileV1, input: JeroReviewFinalizeInputV1, operation: "resolve-evidence", marker: JeroEscalationMarkerV1): JeroReviewFinalizeResultV1 {
	return runJournaledV1(context, record, operation, input, (next) => {
		escalateStateV1(next, marker);
		const receipt = issueJeroReviewReceiptV1(context, next);
		if (receipt.ok === false) return { kind: "refused", code: "authority-unavailable", detail: receipt.detail };
		return {
			kind: "terminal",
			lineage_id: next.lineage_id,
			state: "escalated",
			escalation: marker,
			receipt_hash: receipt.envelope.receipt_hash,
		};
	});
}

// --- fix_required → fixing: correction-plan admission (§A.2 row 5) ---

function finalizeAuthorizeFixV1(context: JeroAuthorityContextV1, record: JeroLineageStateFileV1, input: JeroReviewFinalizeInputV1): JeroReviewFinalizeResultV1 {
	const state = record.state;
	if (!isJeroOrdinaryModeV1(state.mode)) {
		// M3 (§J.4 cross-mode): the ordinary correction-plan admission never
		// runs on a Judgment Day lineage; judgment-day.ts owns the JD fix loop.
		return { kind: "refused", code: "cross-mode-operation-refused", detail: "the ordinary correction-plan admission is not a Judgment Day operation" };
	}
	if (input.correction_line_forecast === undefined) {
		return { kind: "refused", code: "invalid-request", detail: "finalize from fix_required requires correction_line_forecast" };
	}
	if (!Number.isSafeInteger(input.correction_line_forecast) || input.correction_line_forecast < 1 || input.correction_line_forecast > 200) {
		// Plan forecast is bounded 1..200 (native-review-cli :2451 parity).
		return { kind: "refused", code: "invalid-request", detail: "correction_line_forecast must be an integer in 1..200" };
	}
	if (state.counters.fix_rounds >= 1 && isJeroOrdinaryModeV1(state.mode)) {
		// §A.2 illegal #4: a second correction transaction fails closed.
		return { kind: "refused", code: "second-correction-refused", detail: "ordinary permits exactly one correction transaction" };
	}
	return runJournaledV1(context, record, "authorize-fix", input, (next) => {
		const transition = checkJeroReviewTransitionV1(next.state, next.mode, "authorize-fix", { fixRounds: next.counters.fix_rounds, fixBatches: next.counters.fix_batches });
		if (!transition.legal) return { kind: "refused", code: transition.reason === "second-correction-refused" ? "second-correction-refused" : "invalid-state", detail: transition.reason };
		next.proposed_correction_lines = input.correction_line_forecast;
		next.counters.fix_rounds += 1;
		next.counters.fix_batches += 1;
		next.state = "fixing";
		return {
			kind: "fix_authorized",
			lineage_id: next.lineage_id,
			state: projectJeroReviewStateV1(next.state),
			proposed_correction_lines: next.proposed_correction_lines,
			correction_budget: next.correction_budget ?? 0,
		};
	});
}

// --- fixing → fix_validating: bounded-edit application (§A.2 row 6) ---

function finalizeApplyFixV1(context: JeroAuthorityContextV1, record: JeroLineageStateFileV1, input: JeroReviewFinalizeInputV1): JeroReviewFinalizeResultV1 {
	const state = record.state;
	if (!isJeroOrdinaryModeV1(state.mode)) {
		// M3 (§J.4 cross-mode): the ordinary bounded-edit application never
		// runs on a Judgment Day lineage; judgment-day.ts owns the JD fix loop.
		return { kind: "refused", code: "cross-mode-operation-refused", detail: "the ordinary bounded-edit application is not a Judgment Day operation" };
	}
	if (input.fix_application === undefined) {
		return { kind: "refused", code: "invalid-request", detail: "finalize from fixing requires fix_application" };
	}
	const fix = input.fix_application;
	const genesis = new Set(state.genesis_paths ?? []);
	if (!fix.correction_paths.every((path) => genesis.has(path))) {
		// A fix touching a non-genesis path fails closed (§J.2).
		return { kind: "refused", code: "non-genesis-path", detail: `fix touches paths outside the frozen genesis scope: ${fix.correction_paths.filter((path) => !genesis.has(path)).join(", ")}` };
	}
	// F5 (§9.2 actor output is untrusted): the declared fix facts are
	// re-derived from the lineage's isolated snapshot object store — the
	// declared candidate tree must resolve and the declared line count must
	// equal the `git diff --numstat` derivation over the genesis paths. The
	// budget and the receipt are therefore never under the caller's control.
	let derivation: { lines: number; touchedNonGenesisPaths: readonly string[] };
	try {
		derivation = deriveJeroCorrectionLinesV1({
			storeRoot: context.store.store_root,
			targetIdentity: state.snapshot.identity,
			initialTree: state.initial_review_tree,
			candidateTree: fix.candidate_tree,
			genesisPaths: state.genesis_paths ?? [],
		});
	} catch (error) {
		return { kind: "refused", code: "fix-verification-failed", detail: error instanceof Error ? error.message : String(error) };
	}
	if (derivation.touchedNonGenesisPaths.length > 0) {
		return { kind: "refused", code: "non-genesis-path", detail: `the declared candidate tree touches paths outside the frozen genesis scope: ${derivation.touchedNonGenesisPaths.join(", ")}` };
	}
	if (derivation.lines !== fix.actual_correction_lines) {
		return { kind: "refused", code: "fix-verification-failed", detail: `the declared candidate tree derives ${derivation.lines} correction lines but the caller declared ${fix.actual_correction_lines}` };
	}
	const actualLines = derivation.lines;
	const budget = state.correction_budget ?? 0;
	if (actualLines > budget) {
		// §A.2 illegal #5: a budget overrun escalates; it never reopens
		// correction. Journaled under the apply-time operation (F14) — the
		// escalation happens while APPLYING the bounded edit, not while
		// admitting the correction plan.
		return runJournaledV1(context, record, "apply-fix", input, (next) => {
			const transition = checkJeroReviewTransitionV1(next.state, next.mode, "apply-fix", { fixRounds: next.counters.fix_rounds, fixBatches: next.counters.fix_batches });
			if (!transition.legal) return { kind: "refused", code: "invalid-state", detail: transition.reason };
			next.actual_correction_lines = actualLines;
			escalateStateV1(next, { cause: "correction_budget_exceeded", finding_ids: [...next.fix_finding_ids] });
			const receipt = issueJeroReviewReceiptV1(context, next);
			if (receipt.ok === false) return { kind: "refused", code: "authority-unavailable", detail: receipt.detail };
			return {
				kind: "terminal",
				lineage_id: next.lineage_id,
				state: "escalated",
				escalation: { cause: "correction_budget_exceeded", finding_ids: [...next.fix_finding_ids] },
				receipt_hash: receipt.envelope.receipt_hash,
			};
		});
	}
	// Row 6 carries no journal operation of its own (§A.2 journal column): a plain save.
	const transition = checkJeroReviewTransitionV1(state.state, state.mode, "apply-fix", { fixRounds: state.counters.fix_rounds, fixBatches: state.counters.fix_batches });
	if (!transition.legal) return { kind: "refused", code: "invalid-state", detail: transition.reason };
	const next = clone(state);
	next.actual_correction_lines = actualLines;
	next.fix_delta_hash = fix.fix_delta_hash;
	next.final_candidate_tree = fix.candidate_tree;
	next.state = "fix_validating";
	try {
		const saved = context.lineages.save(record.lineage_id, { state: next, request_journal: record.request_journal }, { expectedRevision: record.revision });
		return {
			kind: "fix_applied",
			lineage_id: next.lineage_id,
			state: projectJeroReviewStateV1(next.state),
			actual_correction_lines: next.actual_correction_lines,
			fix_delta_hash: next.fix_delta_hash,
			revision: saved.revision,
		};
	} catch (error) {
		return { kind: "refused", code: "authority-unavailable", detail: error instanceof Error ? error.message : String(error) };
	}
}

// --- ready_final_verification → approved | escalated (§A.2 rows 8-9, §D.7) ---

function finalizeVerifyV1(context: JeroAuthorityContextV1, record: JeroLineageStateFileV1, input: JeroReviewFinalizeInputV1): JeroReviewFinalizeResultV1 {
	if (input.final_evidence === undefined) {
		return { kind: "refused", code: "invalid-request", detail: "finalize from ready_final_verification requires final_evidence paired with exactly one verification result" };
	}
	return runJournaledV1(context, record, "verify", input, (next) => {
		const transition = checkJeroReviewTransitionV1(next.state, next.mode, "record-final-evidence", { fixRounds: next.counters.fix_rounds, fixBatches: next.counters.fix_batches });
		if (!transition.legal) return { kind: "refused", code: "invalid-state", detail: transition.reason };
		next.counters.final_verifications += 1;
		// Final evidence is hashed now, never at START (readme:299).
		next.evidence_hash = evidenceChainV1(next.evidence_hash, { final_evidence_sha256: jeroDomainHash("final-evidence", input.final_evidence) });
		next.state = "final_verifying";
		const passed = input.final_verification_passed === true || input.final_verification_outcome === "passed";
		const escalationReasons: string[] = [];
		if (!passed) {
			escalationReasons.push(input.final_verification_outcome === "verification_failed"
				? "final verification failed during correction evidence capture"
				: input.final_verification_outcome === "procedural_tooling_failed"
					? "procedural tooling failed during final verification"
					: "final verification failed");
		}
		if ((next.fix_caused_findings ?? []).length > 0) escalationReasons.push("the correction caused new findings");
		next.state = passed && escalationReasons.length === 0 ? "approved" : "escalated";
		if (next.state === "escalated") {
			const cause: JeroEscalationCause = (next.fix_caused_findings ?? []).length > 0 ? "targeted_validator_rejected" : "unresolved_severe_findings";
			escalateStateV1(next, { cause, finding_ids: next.fix_caused_findings.map(({ id }) => id) });
			const receipt = issueJeroReviewReceiptV1(context, next);
			if (receipt.ok === false) return { kind: "refused", code: "authority-unavailable", detail: receipt.detail };
			return {
				kind: "terminal",
				lineage_id: next.lineage_id,
				state: "escalated",
				escalation: { cause, finding_ids: next.fix_caused_findings.map(({ id }) => id) },
				receipt_hash: receipt.envelope.receipt_hash,
			};
		}
		const receipt = issueJeroReviewReceiptV1(context, next);
		if (receipt.ok === false) return { kind: "refused", code: "authority-unavailable", detail: receipt.detail };
		return {
			kind: "terminal",
			lineage_id: next.lineage_id,
			state: "approved",
			receipt_hash: receipt.envelope.receipt_hash,
		};
	});
}
