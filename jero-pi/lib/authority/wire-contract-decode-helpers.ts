// 线上契约解码原语：exactRecord 的精确键纪律（默认 allowAdditional = false）
// 是移植时最需要忠实对待的单点风险：失去它意味着 Pi 静默接受畸形的 v2 载荷。
// 自 lib/authority/wire-contract.ts 拆分（机械平移，语义零改动）。

import {
	FEATURE_NAMES,
	REVIEW_INTEGRATION_CONTRACT
} from "./wire-contract-enums.ts";
import {
	type ReviewFeatureV2
} from "./wire-contract-interfaces.ts";

// ---------------------------------------------------------------------------
// 原语——逐字移植自 lib/review-integration-v1.ts。exactRecord 的精确
// 键纪律（默认 allowAdditional = false）是移植时最需要忠实对待的单点
// 风险：失去它意味着 Pi 静默接受畸形的 v2 载荷。
// ---------------------------------------------------------------------------

export function record(value: unknown, label: string): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
	return value as Record<string, unknown>;
}

export function exactRecord(value: unknown, label: string, required: readonly string[], optional: readonly string[] = [], allowAdditional = false): Record<string, unknown> {
	const body = record(value, label);
	for (const key of required) {
		if (!Object.hasOwn(body, key)) throw new TypeError(`${label}.${key} is required`);
	}
	const allowed = new Set([...required, ...optional]);
	if (!allowAdditional) for (const key of Object.keys(body)) if (!allowed.has(key)) throw new TypeError(`${label}.${key} is not allowed`);
	return body;
}

export function text(value: unknown, label: string, options: { minimum?: number; maximum?: number; pattern?: RegExp } = {}): string {
	const minimum = options.minimum ?? 0;
	if (typeof value !== "string" || value.length < minimum || (options.maximum !== undefined && value.length > options.maximum) || (options.pattern !== undefined && !options.pattern.test(value))) {
		throw new TypeError(`${label} is invalid`);
	}
	return value;
}

export function nonempty(value: unknown, label: string): string {
	return text(value, label, { minimum: 1 });
}

export function boolean(value: unknown, label: string): boolean {
	if (typeof value !== "boolean") throw new TypeError(`${label} must be a boolean`);
	return value;
}

export function integer(value: unknown, label: string, minimum = 0, maximum?: number): number {
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || (maximum !== undefined && value > maximum)) {
		throw new TypeError(`${label} must be an integer in range`);
	}
	return value;
}

export function enumeration<T extends string>(value: unknown, values: readonly T[], label: string): T {
	if (typeof value !== "string" || !values.includes(value as T)) throw new TypeError(`${label} is unsupported`);
	return value as T;
}

export function canonicalJson(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
	if (typeof value === "object" && value !== null) {
		const body = value as Record<string, unknown>;
		return `{${Object.keys(body).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(body[key])}`).join(",")}}`;
	}
	return JSON.stringify(value);
}

export function array<T>(value: unknown, label: string, decodeItem: (entry: unknown, label: string) => T, options: { minimum?: number; maximum?: number; unique?: boolean } = {}): readonly T[] {
	if (!Array.isArray(value) || value.length < (options.minimum ?? 0) || (options.maximum !== undefined && value.length > options.maximum)) {
		throw new TypeError(`${label} has an invalid length`);
	}
	const decoded = value.map((entry, index) => decodeItem(entry, `${label}[${index}]`));
	if (options.unique && new Set(decoded.map(canonicalJson)).size !== decoded.length) throw new TypeError(`${label} must not contain duplicates`);
	return decoded;
}

export function stringArray(value: unknown, label: string, options: { minimum?: number; maximum?: number; unique?: boolean; pattern?: RegExp } = {}): readonly string[] {
	return array(value, label, (entry, itemLabel) => text(entry, itemLabel, { minimum: 1, pattern: options.pattern }), options);
}

export function enumArray<T extends string>(value: unknown, values: readonly T[], label: string, options: { minimum?: number; maximum?: number; unique?: boolean } = {}): readonly T[] {
	return array(value, label, (entry, itemLabel) => enumeration(entry, values, itemLabel), options);
}

export function sha256(value: unknown, label: string): string {
	return text(value, label, { pattern: /^sha256:[0-9a-f]{64}$/ });
}

export function gitTree(value: unknown, label: string): string {
	return text(value, label, { pattern: /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/ });
}

export function lineage(value: unknown, label: string): string {
	return text(value, label, { pattern: /^[a-z0-9]+(?:-[a-z0-9]+)*$/ });
}

export function safePath(value: unknown, label: string): string {
	return text(value, label, { minimum: 1, pattern: /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$)).+$/ });
}

// v2 常量身份：每个 v2 载荷都钉住一个 `const` schema，因此与 v1 的
// requireVersionedIdentity 不同，没有需要解析的次版本驱动修订。
export function requireIdentity(value: Record<string, unknown>, schema: string, operation?: string): void {
	if (value.schema !== schema) throw new TypeError(`schema must be ${schema}`);
	if (value.contract !== REVIEW_INTEGRATION_CONTRACT) throw new TypeError(`contract must be ${REVIEW_INTEGRATION_CONTRACT}`);
	if (operation !== undefined && value.operation !== operation) throw new TypeError(`operation must be ${operation}`);
}

export function assertExactSet(actual: readonly string[], expected: readonly string[], label: string): void {
	if (actual.length !== expected.length || expected.some((value) => !actual.includes(value))) throw new TypeError(`${label} does not match the required integration surface`);
}

// 宣告的表面是超集承诺，不是精确清单——见 lib/review-integration-v1.ts
// 中相同的注释，这里编码的是 v2.2.0 的教训：要求精确匹配会拒绝兼容的
// 提供方发布。
export function assertSupersetOf(actual: readonly string[], required: readonly string[], label: string): void {
	const advertised = new Set(actual);
	const missing = required.filter((value) => !advertised.has(value));
	if (missing.length > 0) throw new TypeError(`${label} omits the required integration surface: ${missing.join(", ")}`);
}

// ---------------------------------------------------------------------------
// Capabilities/v2
// ---------------------------------------------------------------------------

export function decodeFeature(value: unknown, label: string): ReviewFeatureV2 {
	const feature = exactRecord(value, label, ["name", "supported", "requires"]);
	return {
		name: enumeration(feature.name, FEATURE_NAMES, `${label}.name`),
		supported: boolean(feature.supported, `${label}.supported`),
		requires: stringArray(feature.requires, `${label}.requires`, { unique: true }),
	};
}

export function decodeOptionalFeature(value: unknown, label: string): { name: string; supported: boolean; requires: readonly string[] } {
	const feature = exactRecord(value, label, ["name", "supported", "requires"]);
	return {
		name: nonempty(feature.name, `${label}.name`),
		supported: boolean(feature.supported, `${label}.supported`),
		requires: stringArray(feature.requires, `${label}.requires`, { unique: true }),
	};
}
