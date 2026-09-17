import type { ReviewStatusV3 } from "../review-integration-v2.ts";
import type { JeroReviewStatusResultV1 } from "./status.ts";
import type { JeroSnapshotDerivationV1 } from "./snapshots.ts";

// P4d: the jero→wire projection layer. The extension's review controller
// machinery (negotiatedStatusForHostTransport, mapNativeTargetStatus, the
// collect-binding renderers, the relay request builders) consumes the
// camelCase ReviewStatusV3 wire record; the authority emits its own typed
// jero-cased unions. This module is the ONE translation point — every field
// the controller reads is projected here, nothing is inferred elsewhere.
// Wire schema strings stay gentle-ai.* until the P5 identity pass (port
// discipline); the authority's own values (jero-authority/v1 version marker)
// pass through verbatim as non-routing metadata.

const WIRE_CONTRACT = "gentle-ai.review-integration/v2" as const;
const PROJECTION_SCHEMA = "gentle-ai.review-candidate-projection/v1" as const;
const REPAIR_SCHEMA = "gentle-ai.review-authority-repair-assessment/v1" as const;

interface WireArgument {
	name: string;
	value: string;
	token: string;
}

function projectArgumentsV1(arguments_: readonly { name: string; value: string; token: string }[] | undefined): WireArgument[] {
	return (arguments_ ?? []).map((argument) => ({ name: argument.name, value: argument.value, token: argument.token }));
}

function projectCollectInputsV1(inputs: readonly {
	name: string;
	schema: string;
	capture_operation: string;
	arguments: readonly { name: string; value: string; token: string }[];
	submission?: { operation_token: string; argument_tokens: readonly string[]; value: { slot: string; domain: string; schema?: string; minimum?: number; maximum?: number; substitution_location: number } };
	artifact_subject?: Record<string, unknown>;
	base_tree?: string;
	candidate_tree?: string;
	changed_path_manifest?: readonly unknown[];
	repository_context?: Record<string, unknown>;
	validation_request?: Record<string, unknown>;
	correction_request?: Record<string, unknown>;
}[]): Record<string, unknown>[] {
	return inputs.map((input) => ({
		name: input.name,
		schema: input.schema,
		captureOperation: input.capture_operation,
		arguments: projectArgumentsV1(input.arguments),
		...(input.submission === undefined ? {} : {
			submission: {
				operationToken: input.submission.operation_token,
				argumentTokens: [...input.submission.argument_tokens],
				values: [{
					slot: input.submission.value.slot,
					domain: input.submission.value.domain,
					...(input.submission.value.schema === undefined ? {} : { schema: input.submission.value.schema }),
					...(input.submission.value.minimum === undefined ? {} : { minimum: input.submission.value.minimum }),
					...(input.submission.value.maximum === undefined ? {} : { maximum: input.submission.value.maximum }),
					substitutionLocation: input.submission.value.substitution_location,
				}],
			},
		}),
		...(input.artifact_subject === undefined ? {} : { artifactSubject: input.artifact_subject }),
		...(input.base_tree === undefined ? {} : { baseTree: input.base_tree }),
		...(input.candidate_tree === undefined ? {} : { candidateTree: input.candidate_tree }),
		...(input.changed_path_manifest === undefined ? {} : { changedPathManifest: input.changed_path_manifest }),
		...(input.repository_context === undefined ? {} : { repositoryContext: input.repository_context }),
		...(input.validation_request === undefined ? {} : { validationRequest: input.validation_request }),
		...(input.correction_request === undefined ? {} : { correctionRequest: input.correction_request }),
	}));
}

/**
 * Projects the authority's status union plus the live snapshot derivation
 * into the ReviewStatusV3 wire record the controller consumes. Refused
 * statuses are NOT projected — the adapter maps them to thrown errors.
 */
export function projectJeroStatusToWireV1(status: Extract<JeroReviewStatusResultV1, { kind: "status" }>, derivation: JeroSnapshotDerivationV1): ReviewStatusV3 {
	const next = status.next_transition;
	const record = derivation.record;
	const wire = {
		contract: WIRE_CONTRACT,
		applicability: status.applicability,
		targetIdentity: status.target_identity,
		action: status.action,
		replayability: status.replayability,
		...(status.authority === undefined ? {} : {
			authority: {
				version: status.authority.version,
				lineage_id: status.authority.lineage_id,
				state: status.authority.state,
				generation: status.authority.generation,
				revision: status.authority.revision,
				...(status.authority.consumed === true ? { consumed: true } : {}),
			},
		}),
		receipt: { status: status.receipt.status },
		...(status.frozen === undefined ? {} : {
			frozen: {
				tier: status.frozen.tier,
				original_changed_lines: status.frozen.original_changed_lines,
				correction_budget: status.frozen.correction_budget,
				...(status.frozen.changed_path_manifest_sha256 === undefined ? {} : { changed_path_manifest_sha256: status.frozen.changed_path_manifest_sha256 }),
			},
		}),
		projection: {
			schema: PROJECTION_SCHEMA,
			kind: "current-changes",
			projection: status.projection,
			baseTree: record.base_tree,
			initialReviewTree: record.initial_review_tree,
			currentCandidateTree: record.initial_review_tree,
			pathsDigest: `sha256:${derivation.changed_path_manifest_sha256}`,
			paths: derivation.changed_path_manifest.map((entry) => entry.path),
			intendedUntracked: [...record.intended_untracked],
			intendedUntrackedProof: `sha256:${derivation.changed_path_manifest_sha256}`,
			initialSnapshotIdentity: `sha256:${derivation.snapshot_id}`,
			currentSnapshotIdentity: `sha256:${derivation.snapshot_id}`,
		},
		repair: { schema: REPAIR_SCHEMA, status: "not_required", counts: { lineages: 0, compact_lineages: 0, legacy_lineages: 0, events: 0, bytes: 0, eligible_candidates: 0, unsupported_lineages: 0, conflicts: 0 }, supported_operations: [], authorization_schema: "gentle-ai.review-abandon-authorization/v2" },
		candidates: [...(status.candidates ?? [])],
		...(next === undefined ? {} : {
			nextTransition: {
				kind: next.kind,
				reasonCode: next.reason_code,
				...(next.kind === "execute" && next.execute !== undefined ? { execute: next.execute } : {}),
				...(next.kind === "collect" && next.collect !== undefined ? { collect: { inputs: projectCollectInputsV1(next.collect.inputs as never) } } : {}),
			},
		}),
		...(status.forecast === undefined ? {} : { forecast: status.forecast }),
		...(status.repository_context === undefined ? {} : { repositoryContext: status.repository_context }),
		raw: status as unknown as Record<string, unknown>,
	};
	return wire as unknown as ReviewStatusV3;
}
