import { join } from "node:path";
import { jeroDomainHash } from "./canonical.ts";
import { decodeJeroReceiptBodyV1, type JeroReceiptBodyV1, type JeroReceiptEnvelopeV1 } from "./protocol.ts";
import { jeroLineageDirectory } from "./store-root.ts";

// Receipt envelopes for finalized lineages (design §5.1.1 FINALIZE /
// acknowledge-approved). The receipt hash is the jero-authority receipt
// domain hash over the canonical receipt body — never the upstream
// `canonicalHash`/`domainHashV1`, whose namespace belongs to gentle-ai.
// Persistence (FINALIZE writing `lineages/<id>/review-receipt.json`, plus
// CAS install of the receipt body) lands with the state-machine milestone;
// this module owns envelope creation, integrity assertion, and the path.

export class JeroReceiptError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "JeroReceiptError";
	}
}

export const JERO_RECEIPT_FILENAME = "review-receipt.json";
const RECEIPT_HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;

function cloneCanonical<T>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T;
}

/** Receipt domain hash: `jero.authority.receipt/v1\0<canonical body>` as a `sha256:` identity. */
export function jeroReceiptHashV1(body: JeroReceiptBodyV1): string {
	return `sha256:${jeroDomainHash("receipt", body)}`;
}

/** Creates a receipt envelope from a strictly validated, terminally state receipt body. */
export function createJeroReceiptEnvelopeV1(body: JeroReceiptBodyV1): JeroReceiptEnvelopeV1 {
	const canonical = cloneCanonical(body);
	const decoded = decodeJeroReceiptBodyV1(canonical);
	if (decoded.state !== "approved" && decoded.state !== "escalated") {
		throw new JeroReceiptError("A receipt may only be issued from a terminal lineage state");
	}
	return { body: decoded, receipt_hash: jeroReceiptHashV1(decoded) };
}

/** Fails closed unless the envelope body decodes strictly and re-hashes to its receipt hash. */
export function assertJeroReceiptIntegrityV1(envelope: JeroReceiptEnvelopeV1): void {
	if (typeof envelope?.receipt_hash !== "string" || !RECEIPT_HASH_PATTERN.test(envelope.receipt_hash)) {
		throw new JeroReceiptError("Receipt hash is not a canonical SHA-256 identity");
	}
	const body = decodeJeroReceiptBodyV1(envelope.body);
	if (jeroReceiptHashV1(body) !== envelope.receipt_hash) {
		throw new JeroReceiptError("Receipt hash mismatch");
	}
}

/** Persistence path for a lineage's FINALIZE receipt. */
export function jeroReceiptPathV1(storeRoot: string, lineageId: string): string {
	return join(jeroLineageDirectory(storeRoot, lineageId), JERO_RECEIPT_FILENAME);
}
