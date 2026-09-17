import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveJeroAuthorityContextV1, type JeroAuthorityContextV1 } from "./review.ts";
import { renderJeroCaptureBindingV1, decodeJeroReviewerResultEnvelopeV1, type JeroCaptureSlotV1 } from "./capture.ts";
import type { JeroLensName } from "./protocol.ts";
import type { JeroFindingClassificationSubmissionV1, JeroLensResultSubmissionV1 } from "./finalize.ts";
import { admitJeroReviewerResultV1 } from "./result-artifacts.ts";
import { capturedJeroArtifactsCompleteV1, jeroReviewerResultsDirectoryV1 } from "./result-artifacts.ts";
import { reviewFinalizeV1 } from "./finalize.ts";

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
	return { kind: "composed", state: resolved.state, fix_finding_ids: resolved.kind === "evidence_resolved" ? [...resolved.fix_finding_ids] : undefined };
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
		return JSON.stringify({ ...admitted.artifact, ...(composition === undefined ? {} : { finalize_composition: composition }) });
	} catch (error) {
		if (error instanceof Error && error.message.includes("[invalid_request]")) throw error;
		// Admission discipline failures (sha mismatch, rebinding drift, state
		// guards) are proven non-mutations: the slot was not consumed.
		throw new Error(`[invalid_request] capture admission failed: ${error instanceof Error ? error.message : String(error)}`);
	}
}
