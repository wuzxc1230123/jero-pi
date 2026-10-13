import { join } from "node:path";
import { jeroDomainHash } from "./canonical.ts";
import { decodeJeroReceiptBodyV1, type JeroReceiptBodyV1, type JeroReceiptEnvelopeV1 } from "./protocol.ts";
import { jeroLineageDirectory } from "./store-root.ts";

// 已定稿血脉的回执封套（设计 §5.1.1 的 FINALIZE / acknowledge-approved）。
// 回执哈希是对权威回执正文的 jero-authority 回执域哈希——绝不用上游的
// `canonicalHash`/`domainHashV1`，其命名空间属于 gentle-ai。持久化
// （FINALIZE 写入 `lineages/<id>/review-receipt.json`，外加回执正文的
// CAS 安装）随状态机里程碑落地；本模块拥有封套创建、完整性断言与
// 路径。

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

/** 回执域哈希：以 `sha256:` 身份表示的 `jero.authority.receipt/v1\0<权威正文>`。 */
export function jeroReceiptHashV1(body: JeroReceiptBodyV1): string {
	return `sha256:${jeroDomainHash("receipt", body)}`;
}

/** 从严格校验过的、处于终局状态的回执正文创建回执封套。 */
export function createJeroReceiptEnvelopeV1(body: JeroReceiptBodyV1): JeroReceiptEnvelopeV1 {
	const canonical = cloneCanonical(body);
	const decoded = decodeJeroReceiptBodyV1(canonical);
	if (decoded.state !== "approved" && decoded.state !== "escalated") {
		throw new JeroReceiptError("A receipt may only be issued from a terminal lineage state");
	}
	return { body: decoded, receipt_hash: jeroReceiptHashV1(decoded) };
}

/** 除非封套正文通过严格解码且重新哈希等于其回执哈希，否则保守失败。 */
export function assertJeroReceiptIntegrityV1(envelope: JeroReceiptEnvelopeV1): void {
	if (typeof envelope?.receipt_hash !== "string" || !RECEIPT_HASH_PATTERN.test(envelope.receipt_hash)) {
		throw new JeroReceiptError("Receipt hash is not a canonical SHA-256 identity");
	}
	const body = decodeJeroReceiptBodyV1(envelope.body);
	if (jeroReceiptHashV1(body) !== envelope.receipt_hash) {
		throw new JeroReceiptError("Receipt hash mismatch");
	}
}

/** 血脉 FINALIZE 回执的持久化路径。 */
export function jeroReceiptPathV1(storeRoot: string, lineageId: string): string {
	return join(jeroLineageDirectory(storeRoot, lineageId), JERO_RECEIPT_FILENAME);
}
