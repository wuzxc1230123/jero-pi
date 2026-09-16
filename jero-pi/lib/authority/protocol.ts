import { JERO_RECEIPT_BODY_SCHEMA, JERO_REVIEW_TRANSACTION_SCHEMA, JERO_VERIFY_RESULT_SCHEMA } from "./canonical.ts";

// Strict decoders for the internal `jero.authority/v1` record family
// (design §5.1.1/§5.1.7). Every decoder enforces an EXACT key set, closed
// enums, and typed fields; unknown keys, missing keys, and out-of-enum
// values fail closed with the offending key named in the error. The decode
// discipline mirrors the private helpers in native-review-cli.ts
// (exactObject/requiredString/enumString), lifted here so lib/authority owns
// its own kit — nothing in this module reads the environment, accepts
// free-text commands, or imports extensions/.

export class JeroAuthorityProtocolError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "JeroAuthorityProtocolError";
	}
}

// ---------------------------------------------------------------------------
// Strict decode helper kit (private)
// ---------------------------------------------------------------------------

function object(value: unknown, label: string): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new JeroAuthorityProtocolError(`${label}: expected object`);
	return value as Record<string, unknown>;
}

function exactObject(value: unknown, required: readonly string[], optional: readonly string[] = [], label = "record"): Record<string, unknown> {
	const parsed = object(value, label);
	for (const key of Object.keys(parsed)) {
		if (!required.includes(key) && !optional.includes(key)) throw new JeroAuthorityProtocolError(`${label}: unknown key "${key}"`);
	}
	for (const key of required) {
		if (!(key in parsed)) throw new JeroAuthorityProtocolError(`${label}: missing key "${key}"`);
	}
	return parsed;
}

function requiredString(value: unknown, label: string): string {
	if (typeof value !== "string" || value.length === 0) throw new JeroAuthorityProtocolError(`${label}: expected non-empty string`);
	return value;
}

function stringValue(value: unknown, label: string): string {
	if (typeof value !== "string") throw new JeroAuthorityProtocolError(`${label}: expected string`);
	return value;
}

function requiredEnum<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
	const parsed = stringValue(value, label);
	if (!(allowed as readonly string[]).includes(parsed)) throw new JeroAuthorityProtocolError(`${label}: unsupported value "${parsed}" (expected one of ${allowed.join(", ")})`);
	return parsed as T;
}

function optionalEnum<T extends string>(value: unknown | undefined, allowed: readonly T[], label: string): T | undefined {
	return value === undefined ? undefined : requiredEnum(value, allowed, label);
}

function requiredDigest(value: unknown, label: string): string {
	const parsed = requiredString(value, label);
	if (!/^[0-9a-f]{64}$/.test(parsed)) throw new JeroAuthorityProtocolError(`${label}: expected lowercase SHA-256 digest`);
	return parsed;
}

function requiredSha256Identity(value: unknown, label: string): string {
	const parsed = requiredString(value, label);
	if (!/^sha256:[0-9a-f]{64}$/.test(parsed)) throw new JeroAuthorityProtocolError(`${label}: expected canonical SHA-256 identity`);
	return parsed;
}

function booleanValue(value: unknown, label: string): boolean {
	if (typeof value !== "boolean") throw new JeroAuthorityProtocolError(`${label}: expected boolean`);
	return value;
}

function nonNegativeInteger(value: unknown, label: string): number {
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new JeroAuthorityProtocolError(`${label}: expected safe non-negative integer`);
	return value;
}

function stringArray(value: unknown, label: string): string[] {
	if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || entry.length === 0)) throw new JeroAuthorityProtocolError(`${label}: expected string array`);
	return value as string[];
}

function optionalStringArray(value: unknown | undefined, label: string): string[] | undefined {
	return value === undefined ? undefined : stringArray(value, label);
}

function recordOf<T>(value: unknown, label: string, decode: (entry: unknown, entryLabel: string) => T): Record<string, T> {
	const parsed = object(value, label);
	for (const key of Object.keys(parsed)) decode(parsed[key], `${label}[${JSON.stringify(key)}]`);
	return parsed as Record<string, T>;
}

// ---------------------------------------------------------------------------
// Lineage state record (`jero.authority.review-transaction/v1`)
// Field model mirrors the upstream compact transaction record decoder in
// native-review-cli.ts (decodeReviewTransaction) under the jero schema.
// ---------------------------------------------------------------------------

export const JERO_REVIEW_MODES = ["ordinary_4r", "ordinary_bounded", "judgment_day"] as const;
export type JeroReviewMode = (typeof JERO_REVIEW_MODES)[number];

export const JERO_REVIEW_STATES = ["unreviewed", "reviewing", "judges_confirmed", "findings_frozen", "evidence_classified", "fix_required", "fixing", "fix_validating", "ready_final_verification", "final_verifying", "approved", "escalated", "invalidated"] as const;
export type JeroReviewStateName = (typeof JERO_REVIEW_STATES)[number];

export const JERO_SNAPSHOT_KINDS = ["current-changes", "base-diff", "commit-range", "fix-diff"] as const;
export type JeroSnapshotKind = (typeof JERO_SNAPSHOT_KINDS)[number];

export const JERO_FINDING_LENSES = ["risk", "resilience", "readability", "reliability"] as const;
export type JeroFindingLens = (typeof JERO_FINDING_LENSES)[number];

export const JERO_LENS_NAMES = ["review-risk", "review-resilience", "review-readability", "review-reliability"] as const;
export type JeroLensName = (typeof JERO_LENS_NAMES)[number];

export const JERO_FINDING_SEVERITIES = ["BLOCKER", "CRITICAL", "WARNING", "SUGGESTION"] as const;
export type JeroFindingSeverity = (typeof JERO_FINDING_SEVERITIES)[number];

export const JERO_EVIDENCE_CLASSES = ["deterministic", "inferential", "insufficient"] as const;
export type JeroEvidenceClass = (typeof JERO_EVIDENCE_CLASSES)[number];

export const JERO_CAUSAL_DISPOSITIONS = ["introduced", "behavior-activated", "worsened", "pre-existing", "base-only", "unknown"] as const;
export type JeroCausalDisposition = (typeof JERO_CAUSAL_DISPOSITIONS)[number];

export const JERO_FINDING_OUTCOMES = ["corroborated", "refuted", "inconclusive", "info"] as const;
export type JeroFindingOutcome = (typeof JERO_FINDING_OUTCOMES)[number];

export const JERO_RISK_LEVELS = ["low", "medium", "high"] as const;
export type JeroRiskLevel = (typeof JERO_RISK_LEVELS)[number];

export interface JeroAuthoritySnapshotV1 {
	kind: JeroSnapshotKind;
	base_tree: string;
	candidate_tree: string;
	paths_digest: string;
	intended_untracked: string[];
	intended_untracked_proof: string;
	paths: string[];
	identity: string;
	ledger_ids?: string[];
}

export interface JeroJudgeProofV1 {
	judge_id: string;
	execution_hash: string;
	result_hash: string;
	blind: boolean;
	confirmed: boolean;
}

export interface JeroFindingRowV1 {
	id: string;
	lens?: JeroFindingLens;
	location?: string;
	severity?: JeroFindingSeverity;
	claim?: string;
	proof_refs?: string[];
}

export interface JeroFindingClassificationV1 {
	finding_id: string;
	class: JeroEvidenceClass;
	proof: string;
	causal_disposition?: JeroCausalDisposition;
}

export interface JeroFollowUpV1 {
	observation: string;
	proof_refs: string[];
}

export interface JeroValidationCheckV1 {
	evidence_hash: string;
	fix_delta_hash: string;
	passed: boolean;
}

export interface JeroReleaseEvidenceV1 {
	release_tree: string;
	configuration_hash: string;
	generated_artifact_hash: string;
	provenance_hash: string;
	publication_boundary_hash: string;
	publication_state: "sealed";
	evidence_freshness_hash: string;
	evidence_freshness_state: "current";
}

export interface JeroAuthorityCountersV1 {
	full_reviews: number;
	refuter_batches: number;
	fix_batches: number;
	scoped_fix_validations: number;
	final_verifications: number;
	fix_rounds: number;
	scoped_rejudgments: number;
	judge_executions: number;
	risk_executions?: number;
	resilience_executions?: number;
	readability_executions?: number;
	reliability_executions?: number;
}

export interface JeroLensResultV1 {
	lens: JeroLensName;
	findings: JeroFindingRowV1[];
	evidence: string[];
	result_hash: string;
}

// Recorded correction evidence for the evidence-first correction lifecycle
// (spec §E): the capture outcome is recorded BEFORE targeted validation is
// offered, a `verification_failed` capture reopens the correction without
// charging anything, and every recapture must land under a distinct immutable
// evidence identity (assertDistinctCorrectionEvidence). Persisting the last
// recorded evidence is what makes those rules enforceable across processes.
export const JERO_CORRECTION_EVIDENCE_OUTCOMES = ["passed", "verification_failed", "procedural_tooling_failed"] as const;
export type JeroCorrectionEvidenceOutcome = (typeof JERO_CORRECTION_EVIDENCE_OUTCOMES)[number];

export interface JeroCorrectionEvidenceRecordV1 {
	outcome: JeroCorrectionEvidenceOutcome;
	evidence_identity: string;
	record_digest: string;
	candidate_tree?: string;
}

export interface JeroReviewTransactionStateV1 {
	schema: typeof JERO_REVIEW_TRANSACTION_SCHEMA;
	lineage_id: string;
	mode: JeroReviewMode;
	generation: number;
	state: JeroReviewStateName;
	snapshot: JeroAuthoritySnapshotV1;
	base_tree: string;
	paths_digest: string;
	initial_review_tree: string;
	final_candidate_tree: string;
	fix_delta_hash: string;
	policy_hash: string;
	ledger_hash: string;
	ledger_findings_hash: string;
	evidence_hash: string;
	judge_proofs: JeroJudgeProofV1[];
	counters: JeroAuthorityCountersV1;
	findings: JeroFindingRowV1[];
	classifications: Record<string, JeroFindingClassificationV1>;
	outcomes: Record<string, JeroFindingOutcome>;
	fix_finding_ids: string[];
	pending_refuter_ids: string[];
	fix_caused_findings: JeroFindingRowV1[];
	follow_ups: JeroFollowUpV1[];
	genesis_paths?: string[];
	invalidation_reason?: string;
	judge_proof_hash?: string;
	judge_agreement_hash?: string;
	failed_evidence_revision?: string;
	original_criteria?: JeroValidationCheckV1;
	correction_regression?: JeroValidationCheckV1;
	release?: JeroReleaseEvidenceV1;
	risk_level?: JeroRiskLevel;
	selected_lenses?: JeroLensName[];
	lens_results?: JeroLensResultV1[];
	original_changed_lines?: number;
	correction_budget?: number;
	proposed_correction_lines?: number;
	actual_correction_lines?: number;
	correction_evidence?: JeroCorrectionEvidenceRecordV1;
	/**
	 * M3 (spec §G, discrepancy #4): the frozen changed-path manifest digest.
	 * Persisted at START so the STATUS frozen block ALWAYS comes from the
	 * record — never from a live manifest re-derivation that drifts when the
	 * workspace moves under a correction. Optional: pre-M3 records re-derive
	 * read-only from their frozen snapshot.
	 */
	changed_path_manifest_sha256?: string;
}

function decodeSnapshot(value: unknown): JeroAuthoritySnapshotV1 {
	const snapshot = exactObject(value, ["kind", "base_tree", "candidate_tree", "paths_digest", "intended_untracked", "intended_untracked_proof", "paths", "identity"], ["ledger_ids"], "snapshot");
	return {
		kind: requiredEnum(snapshot.kind, JERO_SNAPSHOT_KINDS, "snapshot.kind"),
		base_tree: requiredString(snapshot.base_tree, "snapshot.base_tree"),
		candidate_tree: requiredString(snapshot.candidate_tree, "snapshot.candidate_tree"),
		paths_digest: requiredString(snapshot.paths_digest, "snapshot.paths_digest"),
		intended_untracked: stringArray(snapshot.intended_untracked, "snapshot.intended_untracked"),
		intended_untracked_proof: requiredString(snapshot.intended_untracked_proof, "snapshot.intended_untracked_proof"),
		paths: stringArray(snapshot.paths, "snapshot.paths"),
		identity: requiredString(snapshot.identity, "snapshot.identity"),
		...(snapshot.ledger_ids === undefined ? {} : { ledger_ids: stringArray(snapshot.ledger_ids, "snapshot.ledger_ids") }),
	};
}

function decodeFinding(value: unknown, label: string): JeroFindingRowV1 {
	const finding = exactObject(value, ["id"], ["lens", "location", "severity", "claim", "proof_refs"], label);
	return {
		id: requiredString(finding.id, `${label}.id`),
		...(finding.lens === undefined ? {} : { lens: requiredEnum(finding.lens, JERO_FINDING_LENSES, `${label}.lens`) }),
		...(finding.location === undefined ? {} : { location: stringValue(finding.location, `${label}.location`) }),
		...(finding.severity === undefined ? {} : { severity: requiredEnum(finding.severity, JERO_FINDING_SEVERITIES, `${label}.severity`) }),
		...(finding.claim === undefined ? {} : { claim: stringValue(finding.claim, `${label}.claim`) }),
		...(finding.proof_refs === undefined ? {} : { proof_refs: stringArray(finding.proof_refs, `${label}.proof_refs`) }),
	};
}

function decodeFindingArray(value: unknown, label: string): JeroFindingRowV1[] {
	if (!Array.isArray(value)) throw new JeroAuthorityProtocolError(`${label}: expected array`);
	return value.map((entry, index) => decodeFinding(entry, `${label}[${index}]`));
}

function decodeLensResult(value: unknown, label: string): JeroLensResultV1 {
	const result = exactObject(value, ["lens", "findings", "evidence", "result_hash"], [], label);
	return {
		lens: requiredEnum(result.lens, JERO_LENS_NAMES, `${label}.lens`),
		findings: decodeFindingArray(result.findings, `${label}.findings`),
		evidence: stringArray(result.evidence, `${label}.evidence`),
		result_hash: requiredString(result.result_hash, `${label}.result_hash`),
	};
}

function decodeFindingClassification(value: unknown, label: string): JeroFindingClassificationV1 {
	const evidence = exactObject(value, ["finding_id", "class", "proof"], ["causal_disposition"], label);
	return {
		finding_id: requiredString(evidence.finding_id, `${label}.finding_id`),
		class: requiredEnum(evidence.class, JERO_EVIDENCE_CLASSES, `${label}.class`),
		proof: requiredString(evidence.proof, `${label}.proof`),
		...(evidence.causal_disposition === undefined ? {} : { causal_disposition: requiredEnum(evidence.causal_disposition, JERO_CAUSAL_DISPOSITIONS, `${label}.causal_disposition`) }),
	};
}

function decodeValidationCheck(value: unknown, label: string): JeroValidationCheckV1 {
	const check = exactObject(value, ["evidence_hash", "fix_delta_hash", "passed"], [], label);
	return {
		evidence_hash: requiredString(check.evidence_hash, `${label}.evidence_hash`),
		fix_delta_hash: requiredString(check.fix_delta_hash, `${label}.fix_delta_hash`),
		passed: booleanValue(check.passed, `${label}.passed`),
	};
}

function decodeReleaseEvidence(value: unknown): JeroReleaseEvidenceV1 {
	const release = exactObject(value, ["release_tree", "configuration_hash", "generated_artifact_hash", "provenance_hash", "publication_boundary_hash", "publication_state", "evidence_freshness_hash", "evidence_freshness_state"], [], "release");
	return {
		release_tree: requiredString(release.release_tree, "release.release_tree"),
		configuration_hash: requiredString(release.configuration_hash, "release.configuration_hash"),
		generated_artifact_hash: requiredString(release.generated_artifact_hash, "release.generated_artifact_hash"),
		provenance_hash: requiredString(release.provenance_hash, "release.provenance_hash"),
		publication_boundary_hash: requiredString(release.publication_boundary_hash, "release.publication_boundary_hash"),
		publication_state: requiredEnum(release.publication_state, ["sealed"] as const, "release.publication_state"),
		evidence_freshness_hash: requiredString(release.evidence_freshness_hash, "release.evidence_freshness_hash"),
		evidence_freshness_state: requiredEnum(release.evidence_freshness_state, ["current"] as const, "release.evidence_freshness_state"),
	};
}

function decodeCorrectionEvidence(value: unknown, label: string): JeroCorrectionEvidenceRecordV1 {
	const evidence = exactObject(value, ["outcome", "evidence_identity", "record_digest"], ["candidate_tree"], label);
	return {
		outcome: requiredEnum(evidence.outcome, JERO_CORRECTION_EVIDENCE_OUTCOMES, `${label}.outcome`),
		evidence_identity: requiredString(evidence.evidence_identity, `${label}.evidence_identity`),
		record_digest: requiredString(evidence.record_digest, `${label}.record_digest`),
		...(evidence.candidate_tree === undefined ? {} : { candidate_tree: stringValue(evidence.candidate_tree, `${label}.candidate_tree`) }),
	};
}

function decodeCounters(value: unknown): JeroAuthorityCountersV1 {
	const counters = exactObject(
		value,
		["full_reviews", "refuter_batches", "fix_batches", "scoped_fix_validations", "final_verifications", "fix_rounds", "scoped_rejudgments", "judge_executions"],
		["risk_executions", "resilience_executions", "readability_executions", "reliability_executions"],
		"counters",
	);
	const decoded: JeroAuthorityCountersV1 = {
		full_reviews: nonNegativeInteger(counters.full_reviews, "counters.full_reviews"),
		refuter_batches: nonNegativeInteger(counters.refuter_batches, "counters.refuter_batches"),
		fix_batches: nonNegativeInteger(counters.fix_batches, "counters.fix_batches"),
		scoped_fix_validations: nonNegativeInteger(counters.scoped_fix_validations, "counters.scoped_fix_validations"),
		final_verifications: nonNegativeInteger(counters.final_verifications, "counters.final_verifications"),
		fix_rounds: nonNegativeInteger(counters.fix_rounds, "counters.fix_rounds"),
		scoped_rejudgments: nonNegativeInteger(counters.scoped_rejudgments, "counters.scoped_rejudgments"),
		judge_executions: nonNegativeInteger(counters.judge_executions, "counters.judge_executions"),
	};
	for (const key of ["risk_executions", "resilience_executions", "readability_executions", "reliability_executions"] as const) {
		if (counters[key] !== undefined) decoded[key] = nonNegativeInteger(counters[key], `counters.${key}`);
	}
	return decoded;
}

export function decodeJeroReviewTransactionStateV1(value: unknown): JeroReviewTransactionStateV1 {
	const transaction = exactObject(
		value,
		["schema", "lineage_id", "mode", "generation", "state", "snapshot", "base_tree", "paths_digest", "initial_review_tree", "final_candidate_tree", "fix_delta_hash", "policy_hash", "ledger_hash", "ledger_findings_hash", "evidence_hash", "judge_proofs", "counters", "findings", "classifications", "outcomes", "fix_finding_ids", "pending_refuter_ids", "fix_caused_findings", "follow_ups"],
		["genesis_paths", "invalidation_reason", "judge_proof_hash", "judge_agreement_hash", "release", "failed_evidence_revision", "original_criteria", "correction_regression", "risk_level", "selected_lenses", "lens_results", "original_changed_lines", "correction_budget", "proposed_correction_lines", "actual_correction_lines", "correction_evidence", "changed_path_manifest_sha256"],
		JERO_REVIEW_TRANSACTION_SCHEMA,
	);
	if (transaction.schema !== JERO_REVIEW_TRANSACTION_SCHEMA) throw new JeroAuthorityProtocolError(`${JERO_REVIEW_TRANSACTION_SCHEMA}: unsupported schema "${transaction.schema}"`);
	if (!Array.isArray(transaction.judge_proofs)) throw new JeroAuthorityProtocolError(`${JERO_REVIEW_TRANSACTION_SCHEMA}.judge_proofs: expected array`);
	if (!Array.isArray(transaction.follow_ups)) throw new JeroAuthorityProtocolError(`${JERO_REVIEW_TRANSACTION_SCHEMA}.follow_ups: expected array`);
	if (transaction.lens_results !== undefined && !Array.isArray(transaction.lens_results)) throw new JeroAuthorityProtocolError(`${JERO_REVIEW_TRANSACTION_SCHEMA}.lens_results: expected array`);
	const lensResults = transaction.lens_results === undefined
		? undefined
		: (transaction.lens_results as unknown[]).map((result, index) => decodeLensResult(result, `lens_results[${index}]`));
	return {
		schema: JERO_REVIEW_TRANSACTION_SCHEMA,
		lineage_id: requiredString(transaction.lineage_id, "lineage_id"),
		mode: requiredEnum(transaction.mode, JERO_REVIEW_MODES, "mode"),
		generation: nonNegativeInteger(transaction.generation, "generation"),
		state: requiredEnum(transaction.state, JERO_REVIEW_STATES, "state"),
		snapshot: decodeSnapshot(transaction.snapshot),
		base_tree: stringValue(transaction.base_tree, "base_tree"),
		paths_digest: stringValue(transaction.paths_digest, "paths_digest"),
		initial_review_tree: stringValue(transaction.initial_review_tree, "initial_review_tree"),
		final_candidate_tree: stringValue(transaction.final_candidate_tree, "final_candidate_tree"),
		fix_delta_hash: stringValue(transaction.fix_delta_hash, "fix_delta_hash"),
		policy_hash: stringValue(transaction.policy_hash, "policy_hash"),
		ledger_hash: stringValue(transaction.ledger_hash, "ledger_hash"),
		ledger_findings_hash: stringValue(transaction.ledger_findings_hash, "ledger_findings_hash"),
		evidence_hash: stringValue(transaction.evidence_hash, "evidence_hash"),
		judge_proofs: transaction.judge_proofs.map((proof, index) => {
			const row = exactObject(proof, ["judge_id", "execution_hash", "result_hash", "blind", "confirmed"], [], `judge_proofs[${index}]`);
			return {
				judge_id: requiredString(row.judge_id, `judge_proofs[${index}].judge_id`),
				execution_hash: requiredString(row.execution_hash, `judge_proofs[${index}].execution_hash`),
				result_hash: requiredString(row.result_hash, `judge_proofs[${index}].result_hash`),
				blind: booleanValue(row.blind, `judge_proofs[${index}].blind`),
				confirmed: booleanValue(row.confirmed, `judge_proofs[${index}].confirmed`),
			};
		}),
		counters: decodeCounters(transaction.counters),
		findings: decodeFindingArray(transaction.findings, "findings"),
		classifications: recordOf(transaction.classifications, "classifications", decodeFindingClassification),
		outcomes: recordOf(transaction.outcomes, "outcomes", (outcome, label) => requiredEnum(outcome, JERO_FINDING_OUTCOMES, label)),
		fix_finding_ids: stringArray(transaction.fix_finding_ids, "fix_finding_ids"),
		pending_refuter_ids: stringArray(transaction.pending_refuter_ids, "pending_refuter_ids"),
		fix_caused_findings: decodeFindingArray(transaction.fix_caused_findings, "fix_caused_findings"),
		follow_ups: transaction.follow_ups.map((followUp, index) => {
			const row = exactObject(followUp, ["observation", "proof_refs"], [], `follow_ups[${index}]`);
			return {
				observation: requiredString(row.observation, `follow_ups[${index}].observation`),
				proof_refs: stringArray(row.proof_refs, `follow_ups[${index}].proof_refs`),
			};
		}),
		...(transaction.genesis_paths === undefined ? {} : { genesis_paths: stringArray(transaction.genesis_paths, "genesis_paths") }),
		...(transaction.invalidation_reason === undefined ? {} : { invalidation_reason: requiredString(transaction.invalidation_reason, "invalidation_reason") }),
		...(transaction.judge_proof_hash === undefined ? {} : { judge_proof_hash: requiredString(transaction.judge_proof_hash, "judge_proof_hash") }),
		...(transaction.judge_agreement_hash === undefined ? {} : { judge_agreement_hash: requiredString(transaction.judge_agreement_hash, "judge_agreement_hash") }),
		...(transaction.failed_evidence_revision === undefined ? {} : { failed_evidence_revision: requiredString(transaction.failed_evidence_revision, "failed_evidence_revision") }),
		...(transaction.original_criteria === undefined ? {} : { original_criteria: decodeValidationCheck(transaction.original_criteria, "original_criteria") }),
		...(transaction.correction_regression === undefined ? {} : { correction_regression: decodeValidationCheck(transaction.correction_regression, "correction_regression") }),
		...(transaction.release === undefined ? {} : { release: decodeReleaseEvidence(transaction.release) }),
		...(transaction.risk_level === undefined ? {} : { risk_level: requiredEnum(transaction.risk_level, JERO_RISK_LEVELS, "risk_level") }),
		...(transaction.selected_lenses === undefined ? {} : { selected_lenses: stringArray(transaction.selected_lenses, "selected_lenses").map((lens, index) => requiredEnum(lens, JERO_LENS_NAMES, `selected_lenses[${index}]`)) }),
		...(lensResults === undefined ? {} : { lens_results: lensResults }),
		...(transaction.original_changed_lines === undefined ? {} : { original_changed_lines: nonNegativeInteger(transaction.original_changed_lines, "original_changed_lines") }),
		...(transaction.correction_budget === undefined ? {} : { correction_budget: nonNegativeInteger(transaction.correction_budget, "correction_budget") }),
		...(transaction.proposed_correction_lines === undefined ? {} : { proposed_correction_lines: nonNegativeInteger(transaction.proposed_correction_lines, "proposed_correction_lines") }),
		...(transaction.actual_correction_lines === undefined ? {} : { actual_correction_lines: nonNegativeInteger(transaction.actual_correction_lines, "actual_correction_lines") }),
		...(transaction.correction_evidence === undefined ? {} : { correction_evidence: decodeCorrectionEvidence(transaction.correction_evidence, "correction_evidence") }),
		...(transaction.changed_path_manifest_sha256 === undefined ? {} : { changed_path_manifest_sha256: requiredString(transaction.changed_path_manifest_sha256, "changed_path_manifest_sha256") }),
	};
}

// ---------------------------------------------------------------------------
// Request journal entry (embedded in the persisted lineage record)
// Semantics mirror review-transaction.ts RequestJournalEntryV1: exact
// (idempotency_key, request_hash) replay returns the stored
// canonical_result; key reuse with a different request fails closed; a
// pending entry blocks new mutating operations.
// ---------------------------------------------------------------------------

// "acknowledge" is the M2 addition (spec §I.9): the approved-authority burn
// is journaled exactly-once under this operation; the persisted 13-state enum
// has no "burned" member, so the burn is authority-level (a completed journal
// entry), never a state-level transition.
// "apply-fix" is the M2 review-driven addition (findings F14): the bounded-edit
// application journals its own apply-time events — most importantly the
// correction-budget-exceeded escalation, which previously rode "authorize-fix"
// and mislabeled an apply-time outcome as a plan-admission one.
export const JERO_AUTHORITY_OPERATIONS = ["start", "freeze-ledger", "resolve-evidence", "authorize-fix", "apply-fix", "validate-fix", "verify", "gate", "acknowledge"] as const;
export type JeroAuthorityOperation = (typeof JERO_AUTHORITY_OPERATIONS)[number];

export const JERO_JOURNAL_STATUSES = ["pending", "completed"] as const;
export type JeroJournalStatus = (typeof JERO_JOURNAL_STATUSES)[number];

export interface JeroRequestJournalEntryV1 {
	operation: JeroAuthorityOperation;
	idempotency_key: string;
	request_hash: string;
	status: JeroJournalStatus;
	authorization?: unknown;
	canonical_result?: unknown;
}

export function decodeJeroRequestJournalEntryV1(value: unknown, label = "request_journal entry"): JeroRequestJournalEntryV1 {
	const entry = exactObject(value, ["operation", "idempotency_key", "request_hash", "status"], ["authorization", "canonical_result"], label);
	if (entry.status === "completed" && entry.canonical_result === undefined) throw new JeroAuthorityProtocolError(`${label}: completed entry requires canonical_result`);
	return {
		operation: requiredEnum(entry.operation, JERO_AUTHORITY_OPERATIONS, `${label}.operation`),
		idempotency_key: requiredString(entry.idempotency_key, `${label}.idempotency_key`),
		request_hash: requiredDigest(entry.request_hash, `${label}.request_hash`),
		status: requiredEnum(entry.status, JERO_JOURNAL_STATUSES, `${label}.status`),
		...(entry.authorization === undefined ? {} : { authorization: entry.authorization }),
		...(entry.canonical_result === undefined ? {} : { canonical_result: entry.canonical_result }),
	};
}

// ---------------------------------------------------------------------------
// Receipt body + envelope (`jero.authority.receipt-body/v1`)
// The receipt freezes the terminal authority summary of a lineage; its hash
// is the jero-authority receipt domain hash (see receipts.ts).
// ---------------------------------------------------------------------------

export interface JeroReceiptBodyV1 {
	schema: typeof JERO_RECEIPT_BODY_SCHEMA;
	lineage_id: string;
	mode: JeroReviewMode;
	state: JeroReviewStateName;
	base_tree: string;
	initial_review_tree: string;
	final_candidate_tree: string;
	paths_digest: string;
	fix_delta_hash: string;
	policy_hash: string;
	ledger_hash: string;
	ledger_findings_hash: string;
	evidence_hash: string;
	counters: JeroAuthorityCountersV1;
}

export interface JeroReceiptEnvelopeV1 {
	body: JeroReceiptBodyV1;
	receipt_hash: string;
}

export function decodeJeroReceiptBodyV1(value: unknown, label = JERO_RECEIPT_BODY_SCHEMA): JeroReceiptBodyV1 {
	const body = exactObject(
		value,
		["schema", "lineage_id", "mode", "state", "base_tree", "initial_review_tree", "final_candidate_tree", "paths_digest", "fix_delta_hash", "policy_hash", "ledger_hash", "ledger_findings_hash", "evidence_hash", "counters"],
		[],
		label,
	);
	if (body.schema !== JERO_RECEIPT_BODY_SCHEMA) throw new JeroAuthorityProtocolError(`${label}: unsupported schema "${String(body.schema)}"`);
	return {
		schema: JERO_RECEIPT_BODY_SCHEMA,
		lineage_id: requiredString(body.lineage_id, `${label}.lineage_id`),
		mode: requiredEnum(body.mode, JERO_REVIEW_MODES, `${label}.mode`),
		state: requiredEnum(body.state, JERO_REVIEW_STATES, `${label}.state`),
		base_tree: requiredString(body.base_tree, `${label}.base_tree`),
		initial_review_tree: requiredString(body.initial_review_tree, `${label}.initial_review_tree`),
		final_candidate_tree: requiredString(body.final_candidate_tree, `${label}.final_candidate_tree`),
		paths_digest: requiredString(body.paths_digest, `${label}.paths_digest`),
		fix_delta_hash: requiredString(body.fix_delta_hash, `${label}.fix_delta_hash`),
		policy_hash: requiredString(body.policy_hash, `${label}.policy_hash`),
		ledger_hash: requiredString(body.ledger_hash, `${label}.ledger_hash`),
		ledger_findings_hash: requiredString(body.ledger_findings_hash, `${label}.ledger_findings_hash`),
		evidence_hash: requiredString(body.evidence_hash, `${label}.evidence_hash`),
		counters: decodeCounters(body.counters),
	};
}

// ---------------------------------------------------------------------------
// Verification envelope (`jero.verify-result/v1`, design §5.1.8)
// The typed record for SDD verify-report envelopes; markdown/YAML extraction
// stays with the SDD milestone, this decoder owns the strict field contract.
// ---------------------------------------------------------------------------

export interface JeroVerifyResultV1 {
	schema: typeof JERO_VERIFY_RESULT_SCHEMA;
	evidence_revision: string;
	verdict: "pass" | "fail";
	blockers: number;
	critical_findings: number;
	requirements: string;
	scenarios: string;
	test_command: string;
	test_exit_code: number;
	test_output_hash: string;
	build_command: string;
	build_exit_code: number;
	build_output_hash: string;
}

function requiredRatio(value: unknown, label: string): string {
	const parsed = requiredString(value, label);
	if (!/^\d+\/\d+$/.test(parsed)) throw new JeroAuthorityProtocolError(`${label}: expected "<completed>/<total>" ratio`);
	return parsed;
}

export function decodeJeroVerifyResultV1(value: unknown): JeroVerifyResultV1 {
	const record = exactObject(
		value,
		["schema", "evidence_revision", "verdict", "blockers", "critical_findings", "requirements", "scenarios", "test_command", "test_exit_code", "test_output_hash", "build_command", "build_exit_code", "build_output_hash"],
		[],
		JERO_VERIFY_RESULT_SCHEMA,
	);
	if (record.schema !== JERO_VERIFY_RESULT_SCHEMA) throw new JeroAuthorityProtocolError(`${JERO_VERIFY_RESULT_SCHEMA}: unsupported schema "${String(record.schema)}"`);
	return {
		schema: JERO_VERIFY_RESULT_SCHEMA,
		evidence_revision: requiredSha256Identity(record.evidence_revision, "evidence_revision"),
		verdict: requiredEnum(record.verdict, ["pass", "fail"] as const, "verdict"),
		blockers: nonNegativeInteger(record.blockers, "blockers"),
		critical_findings: nonNegativeInteger(record.critical_findings, "critical_findings"),
		requirements: requiredRatio(record.requirements, "requirements"),
		scenarios: requiredRatio(record.scenarios, "scenarios"),
		test_command: requiredString(record.test_command, "test_command"),
		test_exit_code: nonNegativeInteger(record.test_exit_code, "test_exit_code"),
		test_output_hash: requiredSha256Identity(record.test_output_hash, "test_output_hash"),
		build_command: requiredString(record.build_command, "build_command"),
		build_exit_code: nonNegativeInteger(record.build_exit_code, "build_exit_code"),
		build_output_hash: requiredSha256Identity(record.build_output_hash, "build_output_hash"),
	};
}

// ---------------------------------------------------------------------------
// Review-mode record (`jero.authority.review-mode/v1`, spec §I.8)
// The persisted RDD switch. M2 owns the clone-scoped record under the jero
// authority store; the global value is read-only from the jero config home.
// ---------------------------------------------------------------------------

export const JERO_REVIEW_MODE_RECORD_SCHEMA = "jero.authority.review-mode/v1";

export const JERO_REVIEW_MODE_VALUES = ["on", "off"] as const;
export type JeroReviewModeValue = (typeof JERO_REVIEW_MODE_VALUES)[number];

export interface JeroReviewModeRecordV1 {
	schema: typeof JERO_REVIEW_MODE_RECORD_SCHEMA;
	value: JeroReviewModeValue;
}

export function decodeJeroReviewModeRecordV1(value: unknown, label = JERO_REVIEW_MODE_RECORD_SCHEMA): JeroReviewModeRecordV1 {
	const record = exactObject(value, ["schema", "value"], [], label);
	if (record.schema !== JERO_REVIEW_MODE_RECORD_SCHEMA) throw new JeroAuthorityProtocolError(`${label}: unsupported schema "${String(record.schema)}"`);
	return {
		schema: JERO_REVIEW_MODE_RECORD_SCHEMA,
		value: requiredEnum(record.value, JERO_REVIEW_MODE_VALUES, `${label}.value`),
	};
}
