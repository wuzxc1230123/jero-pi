import { decodeJeroVerifyResultV1, type JeroVerifyResultV1 } from "./protocol.ts";

// verify-report.md envelope extraction (spec _tools/p2-m4-sdd-analysis.md
// §C): the markdown/YAML front-matter bridge into the strict
// `jero.verify-result/v1` decoder owned by protocol.ts (M1). The SDD verify
// phase writes its report as a fenced JSON block inside verify-report.md; the
// extraction accepts exactly that shape — one fenced ```json block whose
// contents decode as the envelope — and nothing else.
//
// INTENTIONAL DIVERGENCE (design §5.1.8): upstream's newest head retired
// gentle-ai.verify-result/v1 attestation admission; jero-pi deliberately
// reinstates the discipline in-process under the jero.* namespace. The
// envelope fields are ours and evolve through schema review, not free-form
// edits.

export type JeroVerifyReportRefusalCode =
	| "missing-evidence"
	| "unreadable-evidence"
	| "malformed-envelope"
	| "schema-mismatch";

export type JeroVerifyReportResultV1 =
	| { readonly kind: "ok"; readonly envelope: JeroVerifyResultV1 }
	| { readonly kind: "refused"; readonly code: JeroVerifyReportRefusalCode; readonly detail: string };

const FENCED_JSON = /```json\s*\n([\s\S]*?)\n```/g;

/**
 * Extracts the verification envelope from a verify-report.md body. Strict:
 * exactly one fenced json block, decoding through the strict decoder —
 * unknown keys, bad ratios, and non-sha256 identities all refuse typed.
 */
export function extractJeroVerifyReportV1(text: string): JeroVerifyReportResultV1 {
	const matches = [...text.matchAll(FENCED_JSON)];
	if (matches.length === 0) return { kind: "refused", code: "malformed-envelope", detail: "verify-report carries no fenced json envelope" };
	if (matches.length > 1) return { kind: "refused", code: "malformed-envelope", detail: "verify-report carries more than one fenced json block" };
	let parsed: unknown;
	try {
		parsed = JSON.parse(matches[0]![1]!);
	} catch (error) {
		return { kind: "refused", code: "malformed-envelope", detail: error instanceof Error ? error.message : String(error) };
	}
	try {
		return { kind: "ok", envelope: decodeJeroVerifyResultV1(parsed) };
	} catch (error) {
		return { kind: "refused", code: "schema-mismatch", detail: error instanceof Error ? error.message : String(error) };
	}
}

/**
 * The settle-side evidence gate for `passed` outcomes (spec §C): the envelope
 * must be well-formed and its evidence_revision must be the identity the
 * settlement presents. Freshness against the acquire point and scope
 * containment are the caller's journaled context (the attempt ledger records
 * remediates_evidence_revision and the untracked trio); this helper is the
 * reusable in-process check the P4 wrapper calls before settling.
 */
export function validateJeroVerifyEvidenceForSettleV1(options: { envelopeText: string; evidenceRevision: string }): JeroVerifyReportResultV1 {
	const extracted = extractJeroVerifyReportV1(options.envelopeText);
	if (extracted.kind === "refused") return extracted;
	if (extracted.envelope.evidence_revision !== options.evidenceRevision) {
		return { kind: "refused", code: "schema-mismatch", detail: `envelope evidence_revision ${extracted.envelope.evidence_revision} does not match the settlement evidence ${options.evidenceRevision}` };
	}
	return extracted;
}
