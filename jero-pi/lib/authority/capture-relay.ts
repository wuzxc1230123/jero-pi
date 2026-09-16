import { readFileSync } from "node:fs";
import { resolveJeroAuthorityContextV1, type JeroAuthorityContextV1 } from "./review.ts";
import { renderJeroCaptureBindingV1, decodeJeroReviewerResultEnvelopeV1, type JeroCaptureSlotV1 } from "./capture.ts";
import { admitJeroReviewerResultV1 } from "./result-artifacts.ts";
import type { JeroLensName } from "./protocol.ts";

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
		return JSON.stringify(admitted.artifact);
	} catch (error) {
		if (error instanceof Error && error.message.includes("[invalid_request]")) throw error;
		// Admission discipline failures (sha mismatch, rebinding drift, state
		// guards) are proven non-mutations: the slot was not consumed.
		throw new Error(`[invalid_request] capture admission failed: ${error instanceof Error ? error.message : String(error)}`);
	}
}
