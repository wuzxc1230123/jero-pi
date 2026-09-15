import { canonicalBytesV1, sha256Hex } from "../review-canonical.ts";

// jero-authority hashing primitives (design §5.1.2, §9).
//
// The jero authority namespace is deliberately separate from upstream
// `domainHashV1`, whose output embeds the `gentle-ai.review-` prefix:
// jero identities are computed over the same canonical JSON bytes but
// under fresh `jero.authority.<domain>/v1` domains, so a jero identity can
// never collide with — or be mistaken for — an upstream gentle-ai identity.

export class JeroAuthorityCanonicalError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "JeroAuthorityCanonicalError";
	}
}

const JERO_DOMAIN = /^[a-z0-9-]+$/;

function concatBytes(head: Uint8Array, tail: Uint8Array): Uint8Array {
	const merged = new Uint8Array(head.byteLength + tail.byteLength);
	merged.set(head, 0);
	merged.set(tail, head.byteLength);
	return merged;
}

/**
 * Domain-separated SHA-256 over canonical JSON bytes:
 * `jero.authority.<domain>/v1\0<canonicalBytesV1(value)>`.
 *
 * Never substitute `domainHashV1` here — its output embeds the upstream
 * `gentle-ai.review-` prefix and would forge identity continuity with a
 * foreign authority store.
 */
export function jeroDomainHash(domain: string, value: unknown): string {
	if (!JERO_DOMAIN.test(domain)) throw new JeroAuthorityCanonicalError("Jero authority hash domain is invalid");
	return sha256Hex(concatBytes(new TextEncoder().encode(`jero.authority.${domain}/v1\0`), canonicalBytesV1(value)));
}

// Schema strings for the internal `jero.authority/v1` record family. All
// persisted authority records carry one of these in their `schema` field and
// strict decoders reject any other value (design §5.1.7: unknown keys and
// unknown schemas fail closed).
export const JERO_AUTHORITY_SCHEMA_PREFIX = "jero.authority/v1";

export const JERO_REPOSITORY_IDENTITY_SCHEMA = "jero.authority.repository/v1";
export const JERO_REVIEW_TRANSACTION_SCHEMA = "jero.authority.review-transaction/v1";
export const JERO_LINEAGE_STATE_SCHEMA = "jero.authority.lineage-state/v1";
export const JERO_RECEIPT_BODY_SCHEMA = "jero.authority.receipt-body/v1";
export const JERO_VERIFY_RESULT_SCHEMA = "jero.verify-result/v1";
