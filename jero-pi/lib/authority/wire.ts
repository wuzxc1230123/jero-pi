import type { ReviewConsentChoiceV2, ReviewConsentV3, ReviewStatusV3 } from "./wire-contract.ts";
import type { JeroReviewStatusResultV1 } from "./status.ts";
import type { JeroReviewStartResultV1 } from "./start.ts";
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
				...(next.kind === "execute" && next.execute !== undefined ? { execute: projectJeroExecuteToWireV1(next.execute) } : {}),
				...(next.kind === "collect" && next.collect !== undefined ? { collect: { inputs: projectCollectInputsV1(next.collect.inputs as never) } } : {}),
			},
		}),
		...(status.forecast === undefined ? {} : { forecast: status.forecast }),
		...(status.repository_context === undefined ? {} : { repositoryContext: status.repository_context }),
		raw: status as unknown as Record<string, unknown>,
	};
	return wire as unknown as ReviewStatusV3;
}

// P4d-e: the START consent gate's wire envelope. The authority emits the
// typed `consent_required` union arm; the controller machinery (the pending
// registry, reviewConsentDigest, the two-option UI, answerConsent's binding
// re-parse) consumes the gentle-ai.review-integration.consent/v3 record.
// Fixture parity: tests/fixtures/review-integration/v2/fixtures/consent.fixture.json
// grounds every copy string; the invocations embed the untracked selection so
// the answer path re-freezes the exact candidate the question was minted for
// (flag form matches nativeUntrackedSelectionArguments: --flag=value).
// P4d-g: the execute payload projection. The authority builders emit the
// jero-cased binding (lineage_id/revision/target_identity/repository_context);
// the wire contract (ReviewNextTransitionExecuteV3.binding) is camelCase with
// a REQUIRED targetIdentity — the P4d read path previously passed the jero
// binding through verbatim, leaving every execute consumer reading undefined
// binding fields. Everything else on the payload is already wire-shaped.
function projectJeroExecuteToWireV1(execute: { readonly operation: string; readonly command?: string; readonly arguments: readonly { readonly name: string; readonly value: string; readonly token: string }[]; readonly preconditions: readonly { readonly name: string; readonly value: string }[]; readonly binding: { readonly lineage_id: string; readonly revision: string; readonly target_identity: string; readonly repository_context?: string }; readonly artifacts?: readonly unknown[] }): Record<string, unknown> {
	return {
		operation: execute.operation,
		...(execute.command === undefined ? {} : { command: execute.command }),
		arguments: execute.arguments.map((row) => ({ name: row.name, value: row.value, token: row.token })),
		preconditions: execute.preconditions.map((row) => ({ name: row.name, value: row.value })),
		binding: { targetIdentity: execute.binding.target_identity, lineageId: execute.binding.lineage_id, revision: execute.binding.revision },
		...(execute.artifacts === undefined ? {} : { artifacts: execute.artifacts }),
	};
}

// P4d-g: the last-event closure projection. The authority's closure builder
// emits the jero-cased record; the controller consumes the wire closure
// through decodeReviewLastEventClosureV1 (schema gentle-ai.review-last-event-
// closure/v1, camelCase top level, snake_case nested rows verbatim).
export function projectJeroClosureToWireV1(closure: {
	readonly schema: string; readonly operation: string; readonly lineage_id: string; readonly state: string; readonly store_revision: string;
	readonly action?: string; readonly target_identity?: string; readonly request_hash?: string; readonly correction_lines?: number;
	readonly advisory_findings?: unknown; readonly reviewer_results?: readonly unknown[]; readonly status_continuation?: unknown;
	readonly acknowledgement?: unknown; readonly acknowledgement_undecodable?: boolean;
}): Record<string, unknown> {
	return {
		schema: "gentle-ai.review-last-event-closure/v1",
		operation: closure.operation,
		lineageId: closure.lineage_id,
		state: closure.state,
		storeRevision: closure.store_revision,
		...(closure.action === undefined ? {} : { action: closure.action }),
		...(closure.target_identity === undefined ? {} : { targetIdentity: closure.target_identity }),
		...(closure.request_hash === undefined ? {} : { requestHash: closure.request_hash }),
		...(closure.correction_lines === undefined ? {} : { correctionLines: closure.correction_lines }),
		...(closure.advisory_findings === undefined ? {} : { advisoryFindings: closure.advisory_findings }),
		...(closure.reviewer_results === undefined ? {} : { reviewerResults: closure.reviewer_results }),
		...(closure.status_continuation === undefined ? {} : { statusContinuation: closure.status_continuation }),
		...(closure.acknowledgement === undefined ? {} : { acknowledgement: closure.acknowledgement }),
		...(closure.acknowledgement_undecodable === true ? { acknowledgementUndecodable: true } : {}),
	};
}

export function projectJeroConsentEnvelopeV1(
	consent: Extract<JeroReviewStartResultV1, { kind: "consent_required" }>,
	invocation: { cwd: string; untrackedScope?: "exclude" | "select"; expectedUntrackedInventory?: string; intendedUntracked?: readonly string[] },
): ReviewConsentV3 {
	const evidence = consent.risk_evidence;
	const touches = evidence.length === 0 ? "" : ` because it touches ${evidence.join("; ")}`;
	const reason = `this change gets a deeper review${touches}.`;
	const selectionArguments = invocation.untrackedScope === undefined ? [] : [
		`--untracked-scope=${invocation.untrackedScope}`,
		`--expected-untracked-inventory=${invocation.expectedUntrackedInventory}`,
		...(invocation.untrackedScope === "select" ? (invocation.intendedUntracked ?? []).map((path) => `--intended-untracked=${path}`) : []),
	];
	const choice = (answer: "granted" | "declined", label: string, effect: string): ReviewConsentChoiceV2 => ({
		answer,
		label,
		effect,
		invocation: ["gentle-ai", "review", "start",
			"--contract", WIRE_CONTRACT,
			"--cwd", invocation.cwd,
			"--target", consent.target_identity,
			"--projection", consent.projection,
			"--agent", "pi",
			...selectionArguments,
			"--consent", answer,
		].join(" "),
	});
	const choices: readonly [ReviewConsentChoiceV2, ReviewConsentChoiceV2] = [
		choice("granted", "Run the review now", "Reviews this exact frozen candidate now; nothing is granted for later candidates, so each later medium- or high-risk candidate asks again."),
		choice("declined", "Not now, just this once", "Skips the review for this exact candidate only; no review lineage or receipt is created, and ordinary delivery is unmanaged by candidate choice. The next candidate is asked again. This is not the kill switch."),
	];
	const offPath = { note: "To turn reviews off for good, run 'gentle-ai review mode disable'.", command: "gentle-ai review mode disable" } as const;
	const raw = {
		schema: "gentle-ai.review-integration.consent/v3",
		contract: WIRE_CONTRACT,
		operation: "review.start",
		action: "consent_required",
		blocking: true,
		target_identity: consent.target_identity,
		projection: consent.projection,
		risk_level: consent.risk_level,
		changed_files: consent.changed_files,
		changed_lines: consent.changed_lines,
		headline: "Gentle AI can review this change before you call it done.",
		reason,
		value: "Reviewing takes a bit longer, and it makes the result substantially safer.",
		risk_evidence: [...evidence],
		choices,
		off_path: offPath,
		agent: "pi",
	};
	return {
		schema: "gentle-ai.review-integration.consent/v3",
		agent: "pi",
		contract: WIRE_CONTRACT,
		operation: "review.start",
		action: "consent_required",
		blocking: true,
		targetIdentity: consent.target_identity,
		projection: consent.projection,
		riskLevel: consent.risk_level,
		changedFiles: consent.changed_files,
		changedLines: consent.changed_lines,
		headline: raw.headline,
		reason,
		value: raw.value,
		riskEvidence: [...evidence],
		choices,
		offPath,
		raw,
	};
}
