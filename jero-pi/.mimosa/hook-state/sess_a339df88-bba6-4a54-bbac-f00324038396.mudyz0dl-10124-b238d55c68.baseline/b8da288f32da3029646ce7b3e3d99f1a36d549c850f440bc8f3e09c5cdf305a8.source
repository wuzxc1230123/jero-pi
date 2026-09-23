import { canonicalBytesV1, sha256Hex } from "../review-canonical.ts";

// jero-authority 哈希原语（设计 §5.1.2、§9）。
//
// jero 权威命名空间刻意与上游 `domainHashV1` 分离，后者的输出嵌入了
// `gentle-ai.review-` 前缀：jero 身份对相同的权威 JSON 字节计算，但使用
// 崭新的 `jero.authority.<domain>/v1` 域，因此 jero 身份绝不与上游
// gentle-ai 身份冲突——也不会被误认作后者。

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
 * 对权威 JSON 字节的域分隔 SHA-256：
 * `jero.authority.<domain>/v1\0<canonicalBytesV1(value)>`。
 *
 * 绝不在此处替换为 `domainHashV1`——它的输出嵌入了上游
 * `gentle-ai.review-` 前缀，会伪造与外来权威存储之间的身份连续性。
 */
export function jeroDomainHash(domain: string, value: unknown): string {
	if (!JERO_DOMAIN.test(domain)) throw new JeroAuthorityCanonicalError("Jero authority hash domain is invalid");
	return sha256Hex(concatBytes(new TextEncoder().encode(`jero.authority.${domain}/v1\0`), canonicalBytesV1(value)));
}

// 内部 `jero.authority/v1` 记录家族的 schema 字符串。所有持久化的权威
// 记录都在其 `schema` 字段携带其中之一，严格解码器拒绝任何其他值
// （设计 §5.1.7：未知键与未知 schema 保守失败）。
export const JERO_AUTHORITY_SCHEMA_PREFIX = "jero.authority/v1";

export const JERO_REPOSITORY_IDENTITY_SCHEMA = "jero.authority.repository/v1";
export const JERO_REVIEW_TRANSACTION_SCHEMA = "jero.authority.review-transaction/v1";
export const JERO_LINEAGE_STATE_SCHEMA = "jero.authority.lineage-state/v1";
export const JERO_RECEIPT_BODY_SCHEMA = "jero.authority.receipt-body/v1";
export const JERO_VERIFY_RESULT_SCHEMA = "jero.verify-result/v1";
