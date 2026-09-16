import { execFileSync } from "node:child_process";
import { delimiter } from "node:path";
import { jeroDomainHash } from "./canonical.ts";
import type { JeroArtifactSubjectV1 } from "./start.ts";
import type { JeroLensName, JeroReviewTransactionStateV1 } from "./protocol.ts";
import type { JeroLineageStateFileV1 } from "./lineage-store.ts";
import type { JeroRepositoryContextV1 } from "./repository-context.ts";
import { readJeroSnapshotRecordV1 } from "./snapshots.ts";
import { expectedJeroTargetedValidationRequestHashV1 } from "./validate.ts";
import { reviewGitEnvironment } from "../review-repository.ts";
import { deriveChangedPathManifest, digestChangedPathManifest } from "../review-candidate-view.ts";

// STATUS collect inputs + execute bindings (spec §A/§B/§I.2): the exact
// `--name=value` token discipline, host-only tokens, submission descriptors
// (the v5 SINGULAR `value` form, discrepancy #1), artifact subjects,
// repository-context embedding, and the provider-targeted-validation request
// document. Pure with respect to the lineage record: builders take the
// loaded record and emit typed wire shapes; the only Git executed here is
// the read-only correction-path derivation over the lineage's frozen
// snapshot object store.

// ---------------------------------------------------------------------------
// Wire shapes
// ---------------------------------------------------------------------------

export interface JeroTransitionArgumentV1 {
	readonly name: string;
	readonly value: string;
	readonly token: string;
}

/** The v5 SINGULAR submission `value` row (discrepancy #1: legacy `values[]` rows never carry schema/minimum/maximum). */
export interface JeroCaptureSubmissionValueV1 {
	readonly slot: string;
	readonly domain: string;
	readonly schema?: string;
	readonly minimum?: number;
	readonly maximum?: number;
	readonly substitution_location: number;
}

export interface JeroCaptureSubmissionDescriptorV1 {
	readonly operation_token: string;
	readonly argument_tokens: readonly string[];
	readonly value: JeroCaptureSubmissionValueV1;
}

export type JeroCaptureOperationName = "review.capture-result" | "review.capture-correction-plan" | "review.capture-refuter" | "review.capture-validation";

export interface JeroCollectInputV1 {
	readonly name: string;
	readonly schema: string;
	readonly capture_operation: JeroCaptureOperationName;
	readonly arguments: readonly JeroTransitionArgumentV1[];
	readonly submission?: JeroCaptureSubmissionDescriptorV1;
	readonly artifact_subject?: JeroArtifactSubjectV1;
	readonly base_tree?: string;
	readonly candidate_tree?: string;
	readonly repository_context?: JeroRepositoryContextV1;
	readonly validation_request?: JeroTargetedValidationRequestV1;
}

export interface JeroCollectTransitionPayloadV1 {
	readonly inputs: readonly JeroCollectInputV1[];
}

export interface JeroExecuteTransitionPayloadV1 {
	readonly operation: string;
	readonly command?: string;
	readonly arguments: readonly JeroTransitionArgumentV1[];
	readonly preconditions: readonly { readonly name: string; readonly value: string }[];
	readonly binding: {
		readonly lineage_id: string;
		readonly revision: string;
		readonly target_identity: string;
		readonly repository_context?: string;
	};
	readonly artifacts?: readonly JeroResultArtifactSummaryV1[];
}

/** The result-artifact summary an execute binding lists (fixture: status-v5-repository-context execute.artifacts). */
export interface JeroResultArtifactSummaryV1 {
	readonly schema: string;
	readonly capability: string;
	readonly sha256: string;
	readonly lineage_id: string;
	readonly target_identity: string;
	readonly lens: JeroLensName;
	readonly selected_order: number;
	readonly subject_hash: string;
	readonly admission_decision: "completed";
}

// jero schema strings for the four capture inputs. The conformance boundary
// maps these to the fixture vocabulary (discrepancy #2 discipline: canonical
// jero names internally, upstream names only in fixture-isomorphism tests).
export const JERO_CAPTURE_INPUT_SCHEMAS = {
	REVIEWER: "jero.authority.capture.reviewer/v1",
	CORRECTION_PLAN: "jero.authority.correction-plan/v1",
	REFUTER: "jero.authority.capture.refuter/v1",
	VALIDATOR: "jero.authority.capture.validator/v1",
} as const;

/** Fixture-vocabulary mapping for conformance tests (never used in production paths). */
export const JERO_CAPTURE_INPUT_SCHEMA_CONFORMANCE_MAP: Readonly<Record<string, string>> = {
	[JERO_CAPTURE_INPUT_SCHEMAS.REVIEWER]: "https://gentle-ai.dev/schema/review/reviewer/v1",
	[JERO_CAPTURE_INPUT_SCHEMAS.CORRECTION_PLAN]: "gentle-ai.review-correction-plan/v1",
	[JERO_CAPTURE_INPUT_SCHEMAS.REFUTER]: "https://gentle-ai.dev/schema/review/refuter/v1",
	[JERO_CAPTURE_INPUT_SCHEMAS.VALIDATOR]: "https://gentle-ai.dev/schema/review/validator/v1",
};

// ---------------------------------------------------------------------------
// Argument/token discipline (spec §A.1/§B)
// ---------------------------------------------------------------------------

function argument(name: string, value: string): JeroTransitionArgumentV1 {
	return { name, value, token: `--${name}=${value}` };
}

function bindingArguments(record: JeroLineageStateFileV1, repositoryContext: JeroRepositoryContextV1, extra: readonly JeroTransitionArgumentV1[] = []): JeroTransitionArgumentV1[] {
	return [
		argument("lineage", record.lineage_id),
		argument("expected-revision", record.revision),
		argument("target", record.state.snapshot.identity),
		argument("repository-context", repositoryContext.handle),
		...extra,
	];
}

/**
 * §B submission math: the submission's argument tokens are the collect
 * input's binding tokens MINUS the host-only `--agent`/`--materialize`
 * tokens PLUS one value token at `substitution_location`.
 */
export function jeroSubmissionArgumentTokensV1(collectArguments: readonly { readonly name: string; readonly value: string; readonly token?: string }[], valueToken: string): { argument_tokens: readonly string[]; substitution_location: number } {
	const binding = collectArguments
		.filter((row) => row.name !== "agent" && row.name !== "materialize" && row.name !== "execute")
		.map((row) => row.token ?? `--${row.name}=${row.value}`);
	return { argument_tokens: [...binding, valueToken], substitution_location: binding.length };
}

// ---------------------------------------------------------------------------
// Artifact subjects (STATUS-side derivation; START mints its own at creation)
// ---------------------------------------------------------------------------

function recordManifestSha256V1(storeRoot: string, state: JeroReviewTransactionStateV1): string {
	if (state.changed_path_manifest_sha256 !== undefined) return state.changed_path_manifest_sha256;
	// Pre-M3 records predate the persisted field: re-derive read-only from the
	// frozen snapshot object store (the identity match guarantees the trees).
	const record = readJeroSnapshotRecordV1(storeRoot, state.snapshot.identity);
	const executor = (file: string, args: readonly string[], options: { cwd: string; env: NodeJS.ProcessEnv }) =>
		execFileSync(file, args, { ...options, encoding: "buffer" }) as Buffer;
	const manifest = deriveChangedPathManifest(record.repository_root, state.base_tree, state.snapshot.candidate_tree, executor);
	return digestChangedPathManifest(manifest);
}

/** STATUS-side artifact subject for one selected lens (fixture: authority_revision == the live authority revision). */
export function jeroArtifactSubjectForRecordV1(storeRoot: string, record: JeroLineageStateFileV1, lens: JeroLensName, selectedOrder: number): JeroArtifactSubjectV1 {
	const state = record.state;
	const manifestSha256 = recordManifestSha256V1(storeRoot, state);
	return {
		schema: "jero.authority.artifact-subject/v1",
		subject_hash: `sha256:${jeroDomainHash("artifact-subject", {
			target_identity: state.snapshot.identity,
			lens,
			selected_order: selectedOrder,
			base_tree: state.base_tree,
			candidate_tree: state.snapshot.candidate_tree,
			changed_path_manifest_sha256: manifestSha256,
		})}`,
		lineage_id: record.lineage_id,
		authority_revision: record.revision,
		target_identity: state.snapshot.identity,
		base_tree: state.base_tree,
		candidate_tree: state.snapshot.candidate_tree,
		changed_path_manifest_sha256: manifestSha256,
		lens,
		selected_order: selectedOrder,
	};
}

// ---------------------------------------------------------------------------
// A.1 review.capture-result — one collect input per missing lens
// ---------------------------------------------------------------------------

export function buildJeroReviewerResultCollectInputsV1(storeRoot: string, record: JeroLineageStateFileV1, repositoryContext: JeroRepositoryContextV1): JeroCollectInputV1[] {
	const admitted = new Set((record.state.lens_results ?? []).map(({ lens }) => lens));
	return (record.state.selected_lenses ?? [])
		.map((lens, order) => ({ lens, order }))
		.filter(({ lens }) => !admitted.has(lens))
		.map(({ lens, order }) => {
			const subject = jeroArtifactSubjectForRecordV1(storeRoot, record, lens, order);
			const arguments_ = [
				...bindingArguments(record, repositoryContext),
				argument("lens", lens),
				argument("order", String(order)),
				argument("subject-hash", subject.subject_hash),
				argument("agent", "pi"),
				argument("materialize", "true"),
			];
			const { argument_tokens, substitution_location } = jeroSubmissionArgumentTokensV1(arguments_, "--input={{value}}");
			return {
				name: "reviewer_result",
				schema: JERO_CAPTURE_INPUT_SCHEMAS.REVIEWER,
				capture_operation: "review.capture-result" as const,
				arguments: arguments_,
				submission: {
					operation_token: "capture-result",
					argument_tokens,
					value: {
						slot: "reviewer_result",
						domain: "artifact_path_or_stdin",
						schema: JERO_CAPTURE_INPUT_SCHEMAS.REVIEWER,
						substitution_location,
					},
				},
				artifact_subject: subject,
				base_tree: record.state.base_tree,
				candidate_tree: record.state.snapshot.candidate_tree,
				repository_context: repositoryContext,
			};
		});
}

// ---------------------------------------------------------------------------
// A.2 review.capture-correction-plan — the request document + numeric slot
// ---------------------------------------------------------------------------

export interface JeroCorrectionPlanFindingRowV1 {
	readonly id: string;
	readonly lens: "risk" | "resilience" | "readability" | "reliability";
	readonly location: string;
	readonly severity: "BLOCKER" | "CRITICAL";
	readonly claim: string;
	readonly proof_refs: readonly string[];
	readonly evidence: string;
	readonly evidence_class: "deterministic" | "inferential";
	readonly causal_disposition: "introduced" | "behavior-activated" | "worsened";
}

export interface JeroCorrectionPlanRequestV1 {
	readonly schema: "jero.authority.correction-plan-request/v1";
	readonly request_hash: string;
	readonly lineage_id: string;
	readonly expected_revision: string;
	readonly target_identity: string;
	readonly correction_budget: number;
	readonly fix_finding_ids: readonly string[];
	readonly findings: readonly JeroCorrectionPlanFindingRowV1[];
}

/** The frozen-findings request document the fixing actor receives (spec §A.2). */
export function buildJeroCorrectionPlanRequestV1(record: JeroLineageStateFileV1): JeroCorrectionPlanRequestV1 {
	const state = record.state;
	const byId = new Map(state.findings.map((finding) => [finding.id, finding]));
	const findings: JeroCorrectionPlanFindingRowV1[] = [];
	for (const id of state.fix_finding_ids) {
		const finding = byId.get(id);
		const classification = state.classifications[id];
		if (finding === undefined || classification === undefined) continue;
		findings.push({
			id,
			lens: finding.lens ?? "risk",
			location: finding.location ?? "",
			severity: (finding.severity ?? "CRITICAL") as "BLOCKER" | "CRITICAL",
			claim: finding.claim ?? "",
			proof_refs: finding.proof_refs ?? [classification.proof],
			evidence: classification.proof,
			evidence_class: classification.class === "deterministic" ? "deterministic" : "inferential",
			causal_disposition: (classification.causal_disposition ?? "introduced") as "introduced" | "behavior-activated" | "worsened",
		});
	}
	return {
		schema: "jero.authority.correction-plan-request/v1",
		request_hash: `sha256:${jeroDomainHash("correction-plan-request", {
			lineage_id: record.lineage_id,
			revision: record.revision,
			fix_finding_ids: [...state.fix_finding_ids].toSorted(),
		})}`,
		lineage_id: record.lineage_id,
		expected_revision: record.revision,
		target_identity: state.snapshot.identity,
		correction_budget: state.correction_budget ?? 0,
		fix_finding_ids: [...state.fix_finding_ids].toSorted(),
		findings,
	};
}

export function buildJeroCorrectionPlanCollectInputV1(record: JeroLineageStateFileV1, repositoryContext: JeroRepositoryContextV1): JeroCollectInputV1 {
	const request = buildJeroCorrectionPlanRequestV1(record);
	const arguments_ = [
		...bindingArguments(record, repositoryContext),
		argument("request-hash", request.request_hash),
		argument("correction-budget", String(request.correction_budget)),
	];
	const { argument_tokens, substitution_location } = jeroSubmissionArgumentTokensV1(arguments_, "--correction-lines={{value}}");
	const maximum = Math.max(1, Math.min(200, request.correction_budget));
	return {
		name: "correction_plan",
		schema: JERO_CAPTURE_INPUT_SCHEMAS.CORRECTION_PLAN,
		capture_operation: "review.capture-correction-plan",
		arguments: arguments_,
		submission: {
			operation_token: "capture-correction-plan",
			argument_tokens,
			value: {
				slot: "correction_lines",
				domain: "integer",
				minimum: 1,
				maximum,
				substitution_location,
			},
		},
		repository_context: repositoryContext,
	};
}

// ---------------------------------------------------------------------------
// A.3 review.capture-refuter — self-contained provider role vector
// ---------------------------------------------------------------------------

export function buildJeroRefuterCollectInputV1(record: JeroLineageStateFileV1, repositoryContext: JeroRepositoryContextV1): JeroCollectInputV1 {
	return {
		name: "provider_refuter",
		schema: JERO_CAPTURE_INPUT_SCHEMAS.REFUTER,
		capture_operation: "review.capture-refuter",
		arguments: [
			...bindingArguments(record, repositoryContext),
			argument("agent", "pi"),
			argument("execute", "true"),
		],
		repository_context: repositoryContext,
	};
}

// ---------------------------------------------------------------------------
// A.4 review.capture-validation — the provider-targeted-validator vector
// ---------------------------------------------------------------------------

export interface JeroTargetedValidationFindingV1 {
	readonly id: string;
	readonly lens: "risk" | "resilience" | "readability" | "reliability";
	readonly location: string;
	readonly severity: "BLOCKER" | "CRITICAL";
	readonly claim: string;
	readonly proof_refs: readonly string[];
	readonly evidence_class: "deterministic" | "inferential";
	readonly causal_disposition: "introduced" | "behavior-activated" | "worsened";
}

export interface JeroTargetedValidationClassificationV1 {
	readonly finding_id: string;
	readonly severity?: string;
	readonly class: "deterministic" | "inferential";
	readonly causal_disposition: "introduced" | "behavior-activated" | "worsened";
	readonly proof: string;
}

export interface JeroTargetedValidationRequestV1 {
	readonly schema: "jero.authority.targeted-validation-request/v1";
	readonly request_hash: string;
	readonly lineage_id: string;
	readonly expected_revision: string;
	readonly target_identity: string;
	readonly fix_finding_ids: readonly string[];
	readonly policy_content: string;
	readonly fix_findings: readonly JeroTargetedValidationFindingV1[];
	readonly fix_classifications: readonly JeroTargetedValidationClassificationV1[];
	readonly projection: "workspace" | "staged";
	readonly correction_candidate_tree: string;
	readonly correction_target_identity: string;
	readonly correction_paths: readonly string[];
	readonly correction_paths_digest: string;
}

/** Read-only correction-path derivation over the lineage's frozen snapshot object store. */
function jeroCorrectionPathsV1(storeRoot: string, state: JeroReviewTransactionStateV1): string[] {
	const record = readJeroSnapshotRecordV1(storeRoot, state.snapshot.identity);
	const environment: NodeJS.ProcessEnv = {
		GIT_ALTERNATE_OBJECT_DIRECTORIES: `${record.object_store.object_directory}${delimiter}${record.object_store.alternate_object_directory}`,
	};
	const output = execFileSync("git", ["diff", "--no-renames", "--name-only", "-z", state.initial_review_tree, state.final_candidate_tree], {
		cwd: record.repository_root,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
		env: { ...reviewGitEnvironment(), ...environment },
	});
	return output.split("\0").filter(Boolean).toSorted();
}

/**
 * The full targeted-validation request (spec §A.4): fix findings carry
 * evidenceClass/causalDisposition only; the request hash is the M2 domain
 * hash over the frozen correction scope (validate.ts).
 */
export function buildJeroTargetedValidationRequestV1(storeRoot: string, record: JeroLineageStateFileV1): JeroTargetedValidationRequestV1 {
	const state = record.state;
	const requestHash = `sha256:${expectedJeroTargetedValidationRequestHashV1(state)}`;
	const fixIds = new Set(state.fix_finding_ids);
	const fixFindings: JeroTargetedValidationFindingV1[] = [];
	const fixClassifications: JeroTargetedValidationClassificationV1[] = [];
	for (const finding of state.findings) {
		if (!fixIds.has(finding.id)) continue;
		const classification = state.classifications[finding.id];
		if (classification === undefined) continue;
		fixFindings.push({
			id: finding.id,
			lens: finding.lens ?? "risk",
			location: finding.location ?? "",
			severity: (finding.severity ?? "CRITICAL") as "BLOCKER" | "CRITICAL",
			claim: finding.claim ?? "",
			proof_refs: finding.proof_refs ?? [classification.proof],
			evidence_class: classification.class === "deterministic" ? "deterministic" : "inferential",
			causal_disposition: (classification.causal_disposition ?? "introduced") as "introduced" | "behavior-activated" | "worsened",
		});
		fixClassifications.push({
			finding_id: finding.id,
			...(finding.severity === undefined ? {} : { severity: finding.severity }),
			class: classification.class === "deterministic" ? "deterministic" : "inferential",
			causal_disposition: (classification.causal_disposition ?? "introduced") as "introduced" | "behavior-activated" | "worsened",
			proof: classification.proof,
		});
	}
	const correctionPaths = jeroCorrectionPathsV1(storeRoot, state);
	return {
		schema: "jero.authority.targeted-validation-request/v1",
		request_hash: requestHash,
		lineage_id: record.lineage_id,
		expected_revision: record.revision,
		target_identity: state.snapshot.identity,
		fix_finding_ids: [...state.fix_finding_ids].toSorted(),
		policy_content: state.policy_hash,
		fix_findings: fixFindings,
		fix_classifications: fixClassifications,
		projection: "workspace",
		correction_candidate_tree: state.final_candidate_tree,
		correction_target_identity: state.snapshot.identity,
		correction_paths: correctionPaths,
		correction_paths_digest: `sha256:${jeroDomainHash("correction-paths", correctionPaths)}`,
	};
}

export function buildJeroValidationCollectInputV1(storeRoot: string, record: JeroLineageStateFileV1, repositoryContext: JeroRepositoryContextV1): JeroCollectInputV1 {
	const request = buildJeroTargetedValidationRequestV1(storeRoot, record);
	return {
		name: "provider_targeted_validator",
		schema: JERO_CAPTURE_INPUT_SCHEMAS.VALIDATOR,
		capture_operation: "review.capture-validation",
		arguments: [
			...bindingArguments(record, repositoryContext),
			argument("request-hash", request.request_hash),
			argument("agent", "pi"),
			argument("execute", "true"),
		],
		repository_context: repositoryContext,
		validation_request: request,
	};
}

// ---------------------------------------------------------------------------
// Execute bindings (fixture: status-v5-repository-context — review.finalize)
// ---------------------------------------------------------------------------

export function buildJeroFinalizeExecuteTransitionV1(record: JeroLineageStateFileV1, repositoryContext: JeroRepositoryContextV1, artifacts: readonly JeroResultArtifactSummaryV1[]): JeroExecuteTransitionPayloadV1 {
	const arguments_ = [
		argument("lineage", record.lineage_id),
		argument("captured-results", "true"),
		argument("contract", "jero.authority/v1"),
		argument("agent", "pi"),
	];
	return {
		operation: "review.finalize",
		command: `jero review finalize ${arguments_.map(({ token }) => token).join(" ")}`,
		arguments: arguments_,
		preconditions: [
			{ name: "state", value: "reviewing" },
			{ name: "captured_artifacts", value: "complete" },
		],
		binding: {
			lineage_id: record.lineage_id,
			revision: record.revision,
			target_identity: record.state.snapshot.identity,
			repository_context: repositoryContext.handle,
		},
		artifacts,
	};
}
