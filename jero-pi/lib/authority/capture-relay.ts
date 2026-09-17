import { readFileSync } from "node:fs";
import { sha256Hex } from "../review-canonical.ts";
import { join } from "node:path";
import { resolveJeroAuthorityContextV1, type JeroAuthorityContextV1 } from "./review.ts";
import { renderJeroCaptureBindingV1, decodeJeroReviewerResultEnvelopeV1, type JeroCaptureSlotV1 } from "./capture.ts";
import type { JeroLensName } from "./protocol.ts";
import type { JeroFindingClassificationSubmissionV1, JeroLensResultSubmissionV1 } from "./finalize.ts";
import { admitJeroReviewerResultV1 } from "./result-artifacts.ts";
import { capturedJeroArtifactsCompleteV1, jeroReviewerResultsDirectoryV1 } from "./result-artifacts.ts";
import { decodeJeroRefuterResolutionsV1, decodeJeroReviewerResultEnvelopeV1 as _unusedEnvelope } from "./capture.ts";
import { pendingRefuterRequestHashV1, type JeroReviewFinalizeInputV1 } from "./finalize.ts";
import { reviewFinalizeV1 } from "./finalize.ts";
import { reviewValidateV1 } from "./validate.ts";
import { buildJeroLastEventClosureV1, jeroAdvisoryFindingsFromStateV1, JERO_CAPTURE_CLOSURE_OPERATIONS } from "./closures.ts";

// P4b (design §5.1.4, M3 spec §I.7): the production composition glue that
// injects the in-process authority into the Pi host relay —
//
//   STATUS(collect) → renderBinding → relay prepare (locked pi child)
//                  → relay submit (in-process admission)
//
// `renderJeroCaptureSlotForRelayV1` parses the provider-issued binding tokens
// back into a typed capture slot and renders the prompt bytes (no spawn);
// `admitJeroCaptureResultForRelayV1` reads the staged 0o600 result file and
// admits the reviewer envelope through the authority (artifact + CAS +
// freeze-ledger discipline from M3). Authority typed refusals surface with
// the relay's documented `[invalid_request]` marker (Mi7 contract) so the
// relay classifies them as proven non-mutations.

const BINDING_TOKEN = /^--([a-z-]+)=(.*)$/;
const LENS_NAMES: readonly string[] = ["review-risk", "review-resilience", "review-readability", "review-reliability"];

interface ParsedCaptureTokens {
	lineage: string | undefined;
	expectedRevision: string | undefined;
	target: string | undefined;
	lens: string | undefined;
	order: number | undefined;
	subjectHash: string | undefined;
	repositoryContext: string | undefined;
}

function parseCaptureTokensV1(tokens: readonly string[]): ParsedCaptureTokens {
	const parsed: ParsedCaptureTokens = { lineage: undefined, expectedRevision: undefined, target: undefined, lens: undefined, order: undefined, subjectHash: undefined, repositoryContext: undefined };
	for (const token of tokens) {
		const match = BINDING_TOKEN.exec(token);
		if (match === null) continue;
		const [, name, value] = match;
		switch (name) {
			case "lineage": parsed.lineage = value; break;
			case "expected-revision": parsed.expectedRevision = value; break;
			case "target": parsed.target = value; break;
			case "lens": parsed.lens = value; break;
			case "order": {
				const order = Number(value);
				if (Number.isSafeInteger(order) && order >= 0) parsed.order = order;
				break;
			}
			case "subject-hash": parsed.subjectHash = value; break;
			case "repository-context": parsed.repositoryContext = value; break;
			default: break;
		}
	}
	return parsed;
}

function contextForRelayV1(cwd: string | undefined): JeroAuthorityContextV1 {
	if (cwd === undefined || cwd.length === 0) throw new Error("capture relay requires the request's target cwd");
	const resolution = resolveJeroAuthorityContextV1(cwd);
	if (resolution.kind !== "ok") throw new Error(`[invalid_request] authority resolution refused: ${resolution.code}${resolution.detail === undefined ? "" : ` (${resolution.detail})`}`);
	return resolution.context;
}

/**
 * The render seam (Mi7 contract applies to refusals): parses the binding
 * tokens, re-derives the slot from the lineage RECORD (never from the
 * tokens), and refuses with `[invalid_request]` when the request's binding
 * has drifted from what the authority would offer — stale revisions, foreign
 * lenses, and mismatched subject hashes never reach a reviewer process.
 */
export async function renderJeroCaptureSlotForRelayV1(request: { readonly captureArgumentTokens: readonly string[]; readonly targetCwd?: string }): Promise<{ promptBytes: Buffer }> {
	const tokens = parseCaptureTokensV1(request.captureArgumentTokens);
	if (tokens.lineage === undefined || tokens.lens === undefined || tokens.order === undefined || tokens.subjectHash === undefined) {
		throw new Error("[invalid_request] capture relay binding is missing lineage, lens, order, or subject-hash");
	}
	if (!LENS_NAMES.includes(tokens.lens)) throw new Error(`[invalid_request] capture relay lens ${JSON.stringify(tokens.lens)} is not an ordinary lens`);
	const context = contextForRelayV1(request.targetCwd);
	const slot: JeroCaptureSlotV1 = { kind: "reviewer", context, lineageId: tokens.lineage, lens: tokens.lens as JeroLensName, selectedOrder: tokens.order };
	const rendered = renderJeroCaptureBindingV1(slot);
	if (rendered.kind === "refused") {
		throw new Error(`[invalid_request] capture rendering refused: ${rendered.code}${rendered.detail === undefined ? "" : ` (${rendered.detail})`}`);
	}
	if (rendered.promptBytes === undefined || rendered.promptBytes.length === 0) throw new Error("[invalid_request] capture rendering produced no reviewer bytes");
	// Binding drift check: the rendered header is derived from the record; the
	// request tokens must agree with it (stale expected-revision is the common
	// drift). The lens/order equality is structural; the revision check below
	// uses the rendered slot's expected contract.
	const record = context.lineages.load(tokens.lineage);
	if (record.kind === "ok" && tokens.expectedRevision !== undefined && record.record.revision !== tokens.expectedRevision) {
		throw new Error(`[invalid_request] capture binding revision ${tokens.expectedRevision} drifted from the authority revision ${record.record.revision}`);
	}
	return { promptBytes: rendered.promptBytes };
}

/**
 * The admit seam: reads the staged result file verbatim, strict-decodes the
 * reviewer envelope, and admits through the authority (sha256 recompute,
 * subject/order rebinding, artifact + CAS persistence). Returns the admitted
 * artifact's canonical JSON — the relay's opaque submission string.
 */
// Q-A (see _tools/p4-f-g-capture-maintenance-analysis.md): the artifact-set
// completion composition. Admitting the LAST offered lens artifact is the
// old binary's atomic capture-result submission boundary — the freeze and
// the evidence classification rode inside it. The classification rows
// derive deterministically from the admitted envelope rows (evidence_class
// is the class enum; proof_refs join into the concrete proof), so the
// composition needs no model output beyond what the reviewers already
// swore. It stops after classify: correction-plan, refuter, and final
// verification remain driven by their own vectors.
function composeCapturedResultsFinalizeV1(context: import("./review.ts").JeroAuthorityContextV1, cwd: string | undefined, lineageId: string): Record<string, unknown> | undefined {
	const loaded = context.lineages.load(lineageId);
	if (loaded.kind !== "ok") return { kind: "refused", code: "lineage-unreadable", detail: loaded.kind };
	const record = loaded.record;
	const completion = capturedJeroArtifactsCompleteV1(context, record);
	if (!completion.complete) return undefined;
	const lensResults: JeroLensResultSubmissionV1[] = [];
	const classifications: JeroFindingClassificationSubmissionV1[] = [];
	for (const artifact of completion.artifacts.toSorted((a, b) => a.selected_order - b.selected_order)) {
		// The admission always stages the verbatim bytes in the reviewer
		// results directory; the manifest's locator (path vs reference) only
		// records how the authority cites it, so read the canonical staging file.
		const staged = join(jeroReviewerResultsDirectoryV1(context.store.store_root, lineageId), `${String(artifact.selected_order).padStart(2, "0")}-${artifact.lens}.json`);
		let source: Buffer;
		try {
			source = readFileSync(staged);
		} catch (error) {
			return { kind: "refused", code: "artifact-unreadable", detail: `${artifact.lens}: ${error instanceof Error ? error.message : String(error)}` };
		}
		try {
			const envelope = decodeJeroReviewerResultEnvelopeV1(JSON.parse(source.toString("utf8")));
			for (const result of envelope.review_result.lens_results) {
				lensResults.push({ lens: result.lens, findings: result.findings.map((finding) => ({ id: finding.id, location: finding.location, severity: finding.severity, claim: finding.claim, proof_refs: [...finding.proof_refs] })), evidence: [...result.evidence] });
				for (const finding of result.findings) {
					classifications.push({ finding_id: finding.id, class: finding.evidence_class, proof: finding.proof_refs.join("; "), causal_disposition: finding.causal_disposition });
				}
			}
		} catch (error) {
			return { kind: "refused", code: "artifact-undecodable", detail: error instanceof Error ? error.message : String(error) };
		}
	}
	const frozen = reviewFinalizeV1(context, { cwd: cwd ?? "", lineageId, reviewer_run_acknowledged: true, review_result: { lens_results: lensResults } });
	if (frozen.kind === "refused") return { kind: "refused", code: frozen.code, detail: frozen.detail };
	if (frozen.kind !== "frozen") return { kind: "unexpected", got: frozen.kind };
	const resolved = reviewFinalizeV1(context, { cwd: cwd ?? "", lineageId, classifications });
	if (resolved.kind === "refused") return { kind: "refused", code: resolved.code, detail: resolved.detail };
	if (resolved.kind === "evidence_resolved" && resolved.fix_finding_ids.length === 0) {
		// Q-A2: the clean path runs straight through final verification — the
		// final evidence is the reviewers' sworn scope evidence (hashed at
		// FINALIZE, never at START), exactly the boundary the old binary owned.
		const finalEvidence = lensResults.flatMap((row) => [...row.evidence]).join("\n")
		const terminal = reviewFinalizeV1(context, { cwd: cwd ?? "", lineageId, final_evidence: finalEvidence, final_verification_passed: true });
		if (terminal.kind === "refused") return { kind: "refused", code: terminal.code, detail: terminal.detail };
		if (terminal.kind !== "terminal") return { kind: "unexpected", got: terminal.kind };
		return closureSubmissionV1(context, cwd, lineageId, terminal.state);
	}
	if (resolved.kind === "terminal") return closureSubmissionV1(context, cwd, lineageId, resolved.state);
	return { kind: "composed", state: resolved.state, fix_finding_ids: resolved.kind === "evidence_resolved" ? [...resolved.fix_finding_ids] : undefined };
}

// The terminal closure rides the submission verbatim: the extension decodes a
// gentle-ai.review-last-event-closure/v1 body (snake keys) from the relay
// result, so the jero closure swaps only its schema string.
function closureSubmissionV1(context: import("./review.ts").JeroAuthorityContextV1, cwd: string | undefined, lineageId: string, state: "approved" | "escalated"): Record<string, unknown> | undefined {
	const loaded = context.lineages.load(lineageId);
	if (loaded.kind !== "ok") return { kind: "refused", code: "lineage-unreadable", detail: loaded.kind };
	const closure = buildJeroLastEventClosureV1({
		operation: JERO_CAPTURE_CLOSURE_OPERATIONS.CAPTURE_RESULT,
		record: loaded.record,
		state,
		cwd,
		...(state === "approved" ? { advisoryFindings: jeroAdvisoryFindingsFromStateV1(loaded.record.state) } : {}),
	});
	// Wire vocabulary discrepancy #2: the fixture vocabulary names two
	// closure operations with a slash (review/capture-result, review/
	// capture-validation) and two with a dot; the jero builder is uniform.
	const wireOperation = closure.operation === "review.capture-result" ? "review/capture-result" : closure.operation === "review.capture-validation" ? "review/capture-validation" : closure.operation;
	return { kind: "closure", closure_json: JSON.stringify({ ...closure, schema: "gentle-ai.review-last-event-closure/v1", operation: wireOperation }) };
}

export async function admitJeroCaptureResultForRelayV1(request: { readonly captureArgumentTokens: readonly string[]; readonly targetCwd?: string }, operationToken: string, submitTokens: readonly string[], resultFile: string): Promise<string> {
	if (operationToken !== "capture-result") {
		throw new Error(`[invalid_request] the in-process admission supports capture-result, not ${JSON.stringify(operationToken)}`);
	}
	// The submit tokens carry the substituted result file at the {{value}} slot;
	// the binding tokens (minus the value) still parse for lineage/lens/order.
	const bindingTokens = [...request.captureArgumentTokens, ...submitTokens.filter((token) => !token.includes("result.raw"))];
	const tokens = parseCaptureTokensV1(bindingTokens);
	if (tokens.lineage === undefined || tokens.lens === undefined || tokens.order === undefined || tokens.subjectHash === undefined) {
		throw new Error("[invalid_request] capture admission binding is missing lineage, lens, order, or subject-hash");
	}
	const context = contextForRelayV1(request.targetCwd);
	const raw = readFileSync(resultFile);
	decodeJeroReviewerResultEnvelopeV1(JSON.parse(raw.toString("utf8")));
	try {
		const admitted = admitJeroReviewerResultV1(context, {
			lineageId: tokens.lineage,
			lens: tokens.lens as JeroLensName,
			selectedOrder: tokens.order,
			subjectHash: tokens.subjectHash,
			rawResultBytes: raw,
			locator: tokens.repositoryContext === undefined ? "path" : "reference",
		});
		if (admitted.kind === "refused") {
			throw new Error(`[invalid_request] capture admission refused: ${admitted.code}${admitted.detail === undefined ? "" : ` (${admitted.detail})`}`);
		}
		// The admitted manifest rides the completion composition when this
		// admission completed the artifact set — the extension consumes the
		// artifact manifest either way, and the composition outcome is honest
		// diagnostics (a refusal never unwrites the admitted artifact).
		const composition = admitted.replayed ? undefined : composeCapturedResultsFinalizeV1(context, request.targetCwd, tokens.lineage);
		if (composition !== undefined && composition.kind === "closure") return String(composition.closure_json);
		return JSON.stringify({ ...admitted.artifact, ...(composition === undefined ? {} : { finalize_composition: composition }) });
	} catch (error) {
		if (error instanceof Error && error.message.includes("[invalid_request]")) throw error;
		// Admission discipline failures (sha mismatch, rebinding drift, state
		// guards) are proven non-mutations: the slot was not consumed.
		throw new Error(`[invalid_request] capture admission failed: ${error instanceof Error ? error.message : String(error)}`);
	}
}

// ---------------------------------------------------------------------------
// Q-B: the provider role vectors (refuter / targeted validator). The relay
// composition mirrors the reviewer seam pair: render re-derives the slot from
// the lineage record (never from the tokens); admit executes the role's
// authority transition chain and answers with the last-event closure when the
// capture ends the review, or an artifact manifest otherwise.
// ---------------------------------------------------------------------------

export type JeroProviderRoleV1 = "refuter" | "validator";

function roleSlotForV1(role: JeroProviderRoleV1, context: import("./review.ts").JeroAuthorityContextV1, lineageId: string): import("./capture.ts").JeroCaptureSlotV1 {
	return role === "refuter" ? { kind: "refuter-vector", context, lineageId } : { kind: "validator-vector", context, lineageId };
}

export async function renderJeroProviderRoleSlotForRelayV1(request: { readonly captureArgumentTokens: readonly string[]; readonly targetCwd?: string }, role: JeroProviderRoleV1): Promise<{ promptBytes: Buffer }> {
	const tokens = parseCaptureTokensV1(request.captureArgumentTokens);
	if (tokens.lineage === undefined) throw new Error("[invalid_request] the role binding is missing its lineage token");
	const context = contextForRelayV1(request.targetCwd);
	const rendered = renderJeroCaptureBindingV1(roleSlotForV1(role, context, tokens.lineage));
	if (rendered.kind === "refused") throw new Error(`[invalid_request] role rendering refused: ${rendered.code}${rendered.detail === undefined ? "" : ` (${rendered.detail})`}`);
	if (rendered.promptBytes === undefined || rendered.promptBytes.length === 0) throw new Error("[invalid_request] role rendering produced no bytes");
	const record = context.lineages.load(tokens.lineage);
	if (record.kind === "ok" && tokens.expectedRevision !== undefined && record.record.revision !== tokens.expectedRevision) {
		throw new Error(`[invalid_request] role binding revision ${tokens.expectedRevision} drifted from the authority revision ${record.record.revision}`);
	}
	return { promptBytes: rendered.promptBytes };
}

function wireClosureSubmissionV1(context: import("./review.ts").JeroAuthorityContextV1, cwd: string | undefined, lineageId: string, operation: "review.capture-refuter" | "review.capture-validation", state: "approved" | "correction_required" | "escalated"): string {
	const loaded = context.lineages.load(lineageId);
	if (loaded.kind !== "ok") throw new Error(`[invalid_request] the closure could not reload lineage ${lineageId} (${loaded.kind})`);
	const closure = buildJeroLastEventClosureV1({
		operation,
		record: loaded.record,
		state,
		cwd,
		...(state === "approved" ? { advisoryFindings: jeroAdvisoryFindingsFromStateV1(loaded.record.state) } : {}),
	});
	const wireOperation = operation === "review.capture-validation" ? "review/capture-validation" : operation;
	return JSON.stringify({ ...closure, schema: "gentle-ai.review-last-event-closure/v1", operation: wireOperation });
}

export async function admitJeroProviderRoleResultForRelayV1(request: { readonly captureArgumentTokens: readonly string[]; readonly targetCwd?: string }, operationToken: string, submitTokens: readonly string[], resultFile: string, role: JeroProviderRoleV1): Promise<string> {
	if (operationToken !== "capture-refuter" && operationToken !== "capture-validation") {
		throw new Error(`[invalid_request] the role admission supports capture-refuter/capture-validation, not ${JSON.stringify(operationToken)}`);
	}
	const tokens = parseCaptureTokensV1([...request.captureArgumentTokens, ...submitTokens.filter((token) => !token.includes("result.raw"))]);
	if (tokens.lineage === undefined) throw new Error("[invalid_request] the role admission binding is missing its lineage");
	const context = contextForRelayV1(request.targetCwd);
	const cwd = request.targetCwd;
	const raw = readFileSync(resultFile);
	if (role === "refuter") {
		return admitRefuterResolutionV1(context, cwd, tokens.lineage, raw);
	}
	return admitValidatorAnswerV1(context, cwd, tokens.lineage, raw);
}

function admitRefuterResolutionV1(context: import("./review.ts").JeroAuthorityContextV1, cwd: string | undefined, lineageId: string, raw: Buffer): string {
	const body = JSON.parse(raw.toString("utf8")) as { resolutions?: unknown };
	const resolutions = decodeJeroRefuterResolutionsV1({ resolutions: body.resolutions }).resolutions;
	const loaded = context.lineages.load(lineageId);
	if (loaded.kind !== "ok") throw new Error(`[invalid_request] the refuter admission could not reload lineage (${loaded.kind})`);
	// The batch replays the identical classifications it was minted under
	// (the persisted state rows), exactly like the old wrapper second call.
	const replayedClassifications = Object.values(loaded.record.state.classifications).map((row) => ({ finding_id: row.finding_id, class: row.class, proof: row.proof, ...(row.causal_disposition === undefined ? {} : { causal_disposition: row.causal_disposition }) }));
	const resolved = reviewFinalizeV1(context, { cwd: cwd ?? "", lineageId, classifications: replayedClassifications, refuter_batch: { request_hash: pendingRefuterRequestHashV1(loaded.record.state.pending_refuter_ids), resolutions: resolutions.map((row) => ({ finding_id: row.finding_id, outcome: row.outcome, proof: row.proof })) } });
	if (resolved.kind === "refused") throw new Error(`[invalid_request] refuter admission refused: ${resolved.code}${resolved.detail === undefined ? "" : ` (${resolved.detail})`}`);
	if (resolved.kind === "evidence_resolved" && resolved.fix_finding_ids.length === 0) {
		const terminal = reviewFinalizeV1(context, { cwd: cwd ?? "", lineageId, final_evidence: resolutions.map((row) => row.proof).join("\n"), final_verification_passed: true });
		if (terminal.kind === "terminal") return wireClosureSubmissionV1(context, cwd, lineageId, "review.capture-refuter", terminal.state);
		throw new Error(`[invalid_request] the refuted review did not close (${terminal.kind})`);
	}
	if (resolved.kind === "evidence_resolved") return wireClosureSubmissionV1(context, cwd, lineageId, "review.capture-refuter", "correction_required");
	if (resolved.kind === "terminal") return wireClosureSubmissionV1(context, cwd, lineageId, "review.capture-refuter", resolved.state);
	return JSON.stringify({ kind: "composed", state: resolved.state, got: resolved.kind });
}

function admitValidatorAnswerV1(context: import("./review.ts").JeroAuthorityContextV1, cwd: string | undefined, lineageId: string, raw: Buffer): string {
	// The answer shape is the rendered contract's JSON: request_hash,
	// correction_ids, original_criteria{passed,evidence}, correction_regression
	// {passed,evidence}, fix_caused_findings, follow_ups.
	const answer = JSON.parse(raw.toString("utf8")) as { request_hash?: unknown; correction_ids?: unknown; original_criteria?: { passed?: unknown; evidence?: unknown }; correction_regression?: { passed?: unknown; evidence?: unknown } };
	if (typeof answer.request_hash !== "string" || !Array.isArray(answer.correction_ids) || typeof answer.original_criteria?.passed !== "boolean" || !Array.isArray(answer.original_criteria.evidence) || typeof answer.correction_regression?.passed !== "boolean" || !Array.isArray(answer.correction_regression.evidence)) {
		throw new Error("[invalid_request] the validator answer does not carry the rendered contract shape");
	}
	const validated = reviewValidateV1(context, {
		cwd: cwd ?? "",
		lineageId,
		evidence: {
			outcome: answer.correction_regression.passed ? "passed" as const : "verification_failed" as const,
			evidenceIdentity: `sha256:${sha256Hex(raw)}`,
			recordDigest: answer.request_hash,
		},
		validation: {
			request_hash: answer.request_hash.replace(/^sha256:/, ""),
			correction_ids: answer.correction_ids as string[],
			original_criteria: { passed: answer.original_criteria.passed, evidence: answer.original_criteria.evidence as string[] },
			correction_regression: { passed: answer.correction_regression.passed, evidence: answer.correction_regression.evidence as string[] },
			fix_caused_findings: [],
			follow_ups: [],
		},
	});
	if (validated.kind === "refused") throw new Error(`[invalid_request] validation admission refused: ${validated.code}${validated.detail === undefined ? "" : ` (${validated.detail})`}`);
	if (validated.kind === "recapture_required") return JSON.stringify({ kind: "recapture_required", supersedes: validated.supersedes, guidance: validated.guidance });
	// validated: the targeted validation passed - final verification closes it.
	const terminal = reviewFinalizeV1(context, { cwd: cwd ?? "", lineageId, final_evidence: [...(answer.original_criteria.evidence as string[]), ...(answer.correction_regression.evidence as string[])].join("\n"), final_verification_passed: true });
	if (terminal.kind === "terminal") return wireClosureSubmissionV1(context, cwd, lineageId, "review.capture-validation", terminal.state);
	throw new Error(`[invalid_request] the validated review did not close (${terminal.kind})`);
}
