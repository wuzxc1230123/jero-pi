import { createHash } from "node:crypto";

export class ReviewCanonicalError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ReviewCanonicalError";
	}
}

type CanonicalValue = null | boolean | number | string | CanonicalValue[] | { [key: string]: CanonicalValue | undefined };

function canonicalize(value: unknown, inArray = false): string {
	if (value === null) return "null";
	if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
	if (typeof value === "number") {
		if (!Number.isFinite(value)) throw new ReviewCanonicalError("Canonical JSON rejects non-finite numbers");
		return JSON.stringify(value);
	}
	if (value === undefined) {
		if (inArray) throw new ReviewCanonicalError("Canonical JSON rejects undefined array values");
		throw new ReviewCanonicalError("Canonical JSON rejects undefined values");
	}
	if (Array.isArray(value)) return `[${value.map((item) => canonicalize(item, true)).join(",")}]`;
	if (typeof value === "object") {
		const record = value as Record<string, unknown>;
		return `{${Object.keys(record).filter((key) => record[key] !== undefined).toSorted().map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`).join(",")}}`;
	}
	throw new ReviewCanonicalError(`Canonical JSON rejects ${typeof value}`);
}

export function canonicalJsonV1(value: CanonicalValue | unknown): string {
	return canonicalize(value);
}

/** 码点序字符串比较：与 locale/ICU 构建无关。凡排序结果进入哈希或完整性
 * 校验的比较一律用它——localeCompare 的 collation 序随进程默认 locale 与
 * CLDR 版本漂移，写入环境与校验环境不一致时会产生假完整性错误。 */
export function compareCodepointsV1(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

export function canonicalBytesV1(value: CanonicalValue | unknown): Uint8Array {
	return new TextEncoder().encode(canonicalJsonV1(value));
}

export function sha256Hex(bytes: string | Uint8Array): string {
	return createHash("sha256").update(bytes).digest("hex");
}

export function domainHashV1(domain: string, value: CanonicalValue | unknown): string {
	if (!/^[a-z0-9-]+$/.test(domain)) throw new ReviewCanonicalError("Canonical hash domain is invalid");
	return sha256Hex(`jero-ai.review-${domain}/v1\0${canonicalJsonV1(value)}`);
}

export function parseCanonicalJsonV1(input: string | Uint8Array, maxBytes = 1024 * 1024): unknown {
	const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
	if (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || bytes.byteLength > maxBytes) {
		throw new ReviewCanonicalError("Canonical JSON exceeds the configured byte limit");
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
	} catch {
		throw new ReviewCanonicalError("Canonical JSON is invalid");
	}
	if (canonicalJsonV1(parsed) !== new TextDecoder("utf-8", { fatal: true }).decode(bytes)) {
		throw new ReviewCanonicalError("JSON input is not canonical");
	}
	return parsed;
}
