import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { canonicalJsonV1 } from "../review-canonical.ts";
import { jeroDomainHash } from "./canonical.ts";
import type { JeroAuthorityContextV1 } from "./review.ts";
import { jeroLineageDirectory } from "./store-root.ts";

// `authority.sdd` 评审绑定（规范 _tools/p2-m4-sdd-analysis.md §B）：Go
// 二进制在把已批准评审绑定到 SDD 变更时雕刻的 sdd-review-binding 产物。
// jero-pi 把它持久化为血脉边车（`lineages/<id>/sdd-binding.json`，M3
// 边车模式），沿用相同的哈希链纪律：`revision` 覆盖去掉雕刻集
// {revision, receipt_hash} 后的权威形态；`authority_revision` 在绑定时刻
// 绑定到台账头。读取时校验镜像 M3 的 judgment 台账修复（MA1）：“每次”
// 读取都重新计算雕刻哈希并交叉校验血脉、变更与当前权威修订号——被
// 篡改或过期的绑定以类型化方式拒绝，并被“隔离”（改名挪开），绝不删除：
// 审计轨迹得以幸存。
//
// 字段形态遵循本地 fixture tests/fixtures/native-review-cli/v2.1.3/
// bind-sdd.json——其中 `change` 与 `lineage` 是普通字符串。

export const JERO_SDD_BINDING_SCHEMA = "gentle-ai.sdd-review-binding/v1";

export interface JeroGateContextV1 {
	gate: "post-apply" | "pre-commit" | "pre-push" | "pre-pr" | "release";
	lineage_id: string;
	generation: number;
	base_tree: string;
	candidate_tree: string;
	paths_digest: string;
	fix_delta_hash: string;
	policy_hash: string;
	ledger_hash: string;
	evidence_hash: string;
	base_relationship_valid: boolean;
	store_revision?: string;
	genesis_revision?: string;
	chain_identity?: string;
	bundle_digest?: string;
}

export interface JeroSddBindingV1 {
	schema: typeof JERO_SDD_BINDING_SCHEMA;
	revision: string;
	change: string;
	lineage: string;
	authority_revision: string;
	receipt_hash: string;
	gate_context: JeroGateContextV1;
}

export type JeroSddBindingReadV1 =
	| { readonly kind: "ok"; readonly binding: JeroSddBindingV1 }
	| { readonly kind: "missing" }
	| { readonly kind: "quarantined"; readonly code: "tampered-binding" | "stale-binding" | "malformed-binding"; readonly detail: string };

function bindingPathV1(storeRoot: string, lineageId: string): string {
	return join(jeroLineageDirectory(storeRoot, lineageId), "sdd-binding.json");
}

function carveHashV1(binding: Omit<JeroSddBindingV1, "schema" | "revision" | "receipt_hash">): string {
	return `sha256:${jeroDomainHash("sdd-binding", binding)}`;
}

function strictDecodeV1(value: unknown): JeroSddBindingV1 {
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("binding must be a plain object");
	const record = value as Record<string, unknown>;
	for (const key of ["schema", "revision", "change", "lineage", "authority_revision", "receipt_hash", "gate_context"]) {
		if (!(key in record)) throw new Error(`binding is missing ${key}`);
	}
	if (new Set(Object.keys(record)).size !== Object.keys(record).length) throw new Error("binding carries duplicate keys");
	if (record.schema !== JERO_SDD_BINDING_SCHEMA) throw new Error(`unsupported binding schema ${String(record.schema)}`);
	for (const key of ["revision", "authority_revision", "receipt_hash"]) {
		if (typeof record[key] !== "string" || !/^sha256:[0-9a-f]{64}$/.test(record[key] as string)) throw new Error(`${key} must be a canonical sha256 identity`);
	}
	for (const key of ["change", "lineage"]) {
		if (typeof record[key] !== "string" || (record[key] as string).length === 0) throw new Error(`${key} must be a non-empty string`);
	}
	const gate = record.gate_context as Record<string, unknown>;
	for (const key of ["gate", "lineage_id", "generation", "base_tree", "candidate_tree", "paths_digest", "fix_delta_hash", "policy_hash", "ledger_hash", "evidence_hash", "base_relationship_valid"]) {
		if (!(key in gate)) throw new Error(`gate_context is missing ${key}`);
	}
	return value as JeroSddBindingV1;
}

/** 把已批准血脉绑定到 SDD 变更；内容相同时幂等。 */
export function writeJeroSddBindingV1(context: JeroAuthorityContextV1, input: Omit<JeroSddBindingV1, "schema" | "revision">): JeroSddBindingV1 {
	if (input.gate_context.lineage_id !== input.lineage) throw new Error("gate_context.lineage_id must match the binding lineage");
	const binding: JeroSddBindingV1 = {
		schema: JERO_SDD_BINDING_SCHEMA,
		revision: carveHashV1({ change: input.change, lineage: input.lineage, authority_revision: input.authority_revision, gate_context: input.gate_context }),
		...input,
	};
	const directory = jeroLineageDirectory(context.store.store_root, input.lineage);
	mkdirSync(directory, { recursive: true, mode: 0o700 });
	const temporary = join(directory, `.sdd-binding.${randomUUID()}.tmp`);
	writeFileSync(temporary, `${canonicalJsonV1(binding)}\n`, { mode: 0o600 });
	renameSync(temporary, bindingPathV1(context.store.store_root, input.lineage));
	return binding;
}

/**
 * 校验并返回某血脉的绑定。篡改（雕刻哈希不匹配、交叉校验失败）与
 * 过期（authority_revision 落后于血脉记录的当前修订号）都保守失败，
 * 并把肇事文件挪到隔离名下——证据保留，绝不删除。
 */
export function readJeroSddBindingV1(context: JeroAuthorityContextV1, lineageId: string): JeroSddBindingReadV1 {
	const path = bindingPathV1(context.store.store_root, lineageId);
	let text: string;
	try {
		text = readFileSync(path, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return { kind: "missing" };
		throw error;
	}
	const quarantine = (code: "tampered-binding" | "stale-binding" | "malformed-binding", detail: string): JeroSddBindingReadV1 => {
		renameSync(path, join(jeroLineageDirectory(context.store.store_root, lineageId), `sdd-binding.quarantine-${randomUUID()}.json`));
		return { kind: "quarantined", code, detail };
	};
	let binding: JeroSddBindingV1;
	try {
		binding = strictDecodeV1(JSON.parse(text));
	} catch (error) {
		return quarantine("malformed-binding", error instanceof Error ? error.message : String(error));
	}
	if (binding.revision !== carveHashV1({ change: binding.change, lineage: binding.lineage, authority_revision: binding.authority_revision, gate_context: binding.gate_context })) {
		return quarantine("tampered-binding", "carve hash does not cover the recorded content");
	}
	if (binding.lineage !== lineageId || binding.gate_context.lineage_id !== lineageId) {
		return quarantine("tampered-binding", "binding lineage identity mismatch");
	}
	const loaded = context.lineages.load(lineageId);
	if (loaded.kind === "ok" && loaded.record.revision !== binding.authority_revision) {
		return quarantine("stale-binding", `binding authority revision ${binding.authority_revision} does not match the current revision ${loaded.record.revision}`);
	}
	return { kind: "ok", binding };
}
