import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { jeroDomainHash } from "./canonical.ts";
import { sha256Hex } from "../review-canonical.ts";
import type { JeroAuthorityContextV1 } from "./review.ts";
import type { JeroLineageStateFileV1 } from "./lineage-store.ts";
import { jeroLineageDirectory } from "./store-root.ts";
import { decodeJeroReviewerResultEnvelopeV1 } from "./capture.ts";
import { jeroArtifactSubjectForRecordV1, type JeroResultArtifactSummaryV1 } from "./collect-inputs.ts";
import type { JeroLensName } from "./protocol.ts";

// 结果产物受理（spec §D）：`review capture-result` 的受理答案。产物的
// sha256 是“原始”被受理评审员 stdout 字节的摘要（同一受理的 reference
// 形式与 path 形式捕获共享它）；受理在接受前重新计算并比较；
// lens/selected_order/subject_hash/lineage/target_identity 必须等于所提供
// 槽位的 artifact_subject 字段；恰好发出一个定位符——普通捕获为
// `path`，仓库上下文捕获为铸造的不透明 `rart1_` 引用。持久化：原始
// 字节逐字存放于 `lineages/<id>/reviewer-results/<NN>-<lens>.json`
// （NN = 两位零填充的 selected_order），类型化封套入 CAS，外加 STATUS 的
// captured-artifacts-complete 谓词所消费的发现清单。

export const JERO_RESULT_ARTIFACT_SCHEMA = "jero.authority.review-result-artifact/v1";
export const JERO_RESULT_ARTIFACT_CAPABILITY = "review.native_result_artifact";
export const JERO_RESULT_ARTIFACT_MANIFEST_SCHEMA = "jero.authority.result-artifact-manifest/v1";

export interface JeroResultArtifactV1 {
	readonly schema: typeof JERO_RESULT_ARTIFACT_SCHEMA;
	readonly capability: typeof JERO_RESULT_ARTIFACT_CAPABILITY;
	readonly sha256: string;
	readonly lineage_id: string;
	readonly target_identity: string;
	readonly lens: JeroLensName;
	readonly selected_order: number;
	readonly subject_hash: string;
	readonly admission_decision: "completed";
	readonly path?: string;
	readonly reference?: string;
}

export type JeroResultArtifactAdmissionRefusalCode =
	| "invalid-request" | "lineage-missing" | "corrupted" | "invalid-state"
	| "sha256-mismatch" | "subject-mismatch" | "slot-consumed" | "invalid-envelope" | "authority-unavailable";

export interface JeroReviewerResultAdmissionInputV1 {
	readonly lineageId: string;
	readonly lens: JeroLensName;
	readonly selectedOrder: number;
	/** 所提供槽位的主题哈希（`--subject-hash`）；受理时对照记录重新绑定。 */
	readonly subjectHash: string;
	/** 被受理评审员的原始 stdout 字节，逐字。 */
	readonly rawResultBytes: Uint8Array;
	/** 调用方中继了声明摘要时，受理重新计算并比较（spec §D）。 */
	readonly declaredSha256?: string;
	/** 普通捕获为 `path`；捕获搭载仓库上下文句柄时为 `reference`。 */
	readonly locator: "path" | "reference";
}

export type JeroResultArtifactAdmissionResultV1 =
	| { readonly kind: "refused"; readonly code: JeroResultArtifactAdmissionRefusalCode; readonly detail?: string }
	| { readonly kind: "admitted"; readonly artifact: JeroResultArtifactV1; readonly replayed: boolean };

const RART_REFERENCE = /^rart1_[0-9a-f]{64}$/;

export function jeroReviewerResultsDirectoryV1(storeRoot: string, lineageId: string): string {
	return join(jeroLineageDirectory(storeRoot, lineageId), "reviewer-results");
}

/** `rart1_ + jeroDomainHash("result-artifact", {subject_hash, sha256})`（spec §D 的引用铸造）。 */
export function jeroResultArtifactReferenceV1(subjectHash: string, sha256: string): string {
	return `rart1_${jeroDomainHash("result-artifact", { subject_hash: subjectHash, sha256 })}`;
}

function manifestPathV1(storeRoot: string, lineageId: string): string {
	return join(jeroReviewerResultsDirectoryV1(storeRoot, lineageId), "artifacts.json");
}

function decodeManifestV1(value: unknown, lineageId: string): JeroResultArtifactV1[] {
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError("result-artifact manifest: expected object");
	const parsed = value as Record<string, unknown>;
	for (const key of Object.keys(parsed)) if (!["schema", "lineage_id", "artifacts"].includes(key)) throw new TypeError(`result-artifact manifest: unknown key "${key}"`);
	if (parsed.schema !== JERO_RESULT_ARTIFACT_MANIFEST_SCHEMA) throw new TypeError("result-artifact manifest: unsupported schema");
	if (parsed.lineage_id !== lineageId) throw new TypeError("result-artifact manifest: lineage mismatch");
	if (!Array.isArray(parsed.artifacts)) throw new TypeError("result-artifact manifest: artifacts must be an array");
	return parsed.artifacts.map((entry, index) => {
		if (typeof entry !== "object" || entry === null) throw new TypeError(`result-artifact manifest: artifacts[${index}] must be an object`);
		const artifact = entry as Record<string, unknown>;
		for (const key of Object.keys(artifact)) if (!["schema", "capability", "sha256", "lineage_id", "target_identity", "lens", "selected_order", "subject_hash", "admission_decision", "path", "reference"].includes(key)) throw new TypeError(`result-artifact manifest: artifacts[${index}] unknown key "${key}"`);
		if ((artifact.path === undefined) === (artifact.reference === undefined)) throw new TypeError(`result-artifact manifest: artifacts[${index}] must carry exactly one locator`);
		if (artifact.admission_decision !== "completed") throw new TypeError(`result-artifact manifest: artifacts[${index}].admission_decision must be completed`);
		if (artifact.reference !== undefined && !RART_REFERENCE.test(artifact.reference as string)) throw new TypeError(`result-artifact manifest: artifacts[${index}].reference is malformed`);
		return artifact as unknown as JeroResultArtifactV1;
	});
}

function readManifestV1(context: JeroAuthorityContextV1, lineageId: string): JeroResultArtifactV1[] {
	try {
		const bytes = readFileSync(manifestPathV1(context.store.store_root, lineageId));
		return decodeManifestV1(JSON.parse(bytes.toString("utf8")), lineageId);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
		throw error;
	}
}

function writeManifestV1(context: JeroAuthorityContextV1, lineageId: string, artifacts: readonly JeroResultArtifactV1[]): void {
	const directory = jeroReviewerResultsDirectoryV1(context.store.store_root, lineageId);
	mkdirSync(directory, { recursive: true, mode: 0o700 });
	const destination = manifestPathV1(context.store.store_root, lineageId);
	const temporary = join(directory, `.artifacts.${randomUUID()}.tmp`);
	writeFileSync(temporary, `${JSON.stringify({ schema: JERO_RESULT_ARTIFACT_MANIFEST_SCHEMA, lineage_id: lineageId, artifacts }, null, 2)}\n`, { mode: 0o600 });
	renameSync(temporary, destination);
}

/** STATUS 产物发现：某个血脉的已受理结果产物列表。 */
export function listJeroResultArtifactsV1(context: JeroAuthorityContextV1, lineageId: string): JeroResultArtifactV1[] {
	return readManifestV1(context, lineageId);
}

export function jeroResultArtifactSummariesV1(artifacts: readonly JeroResultArtifactV1[]): JeroResultArtifactSummaryV1[] {
	return artifacts.map((artifact) => ({
		schema: artifact.schema,
		capability: artifact.capability,
		sha256: artifact.sha256,
		lineage_id: artifact.lineage_id,
		target_identity: artifact.target_identity,
		lens: artifact.lens,
		selected_order: artifact.selected_order,
		subject_hash: artifact.subject_hash,
		admission_decision: artifact.admission_decision,
	}));
}

/**
 * captured-artifacts-complete 谓词（spec §D）：每个已选评审视角都有
 * 一个主题绑定记录冻结权威的已受理产物。完整性从磁盘检查——清单加
 * 各评审视角的结果文件——绝不仅仅依据内存状态：每个已受理评审视角的
 * `<NN>-<lens>.json` 文件必须“存在”且其内容 sha256 等于清单行的摘要
 * （MA4 评审裁决：落实文档字符串的承诺——被删除或被改写的结果文件
 * 使捕获集不完整，即使清单仍列出它）。
 */
export function capturedJeroArtifactsCompleteV1(context: JeroAuthorityContextV1, record: JeroLineageStateFileV1): { complete: boolean; artifacts: readonly JeroResultArtifactV1[]; missing: readonly { lens: JeroLensName; selected_order: number }[] } {
	const artifacts = readManifestV1(context, record.lineage_id);
	const byLens = new Map(artifacts.map((artifact) => [artifact.lens, artifact]));
	const missing: { lens: JeroLensName; selected_order: number }[] = [];
	for (const [order, lens] of (record.state.selected_lenses ?? []).entries()) {
		const artifact = byLens.get(lens);
		if (artifact === undefined || artifact.selected_order !== order) {
			missing.push({ lens, selected_order: order });
			continue;
		}
		const expectedSubject = jeroArtifactSubjectForRecordV1(context.store.store_root, record, lens, order);
		if (artifact.subject_hash !== expectedSubject.subject_hash || artifact.target_identity !== record.state.snapshot.identity) {
			missing.push({ lens, selected_order: order });
			continue;
		}
		// MA4：各评审视角的结果文件必须存在且哈希等于清单行（sha256 是
		// 对“原始”被受理评审员字节的，因此任何受理后的编辑或删除都
		// 保守失败）。`path` 定位符必须仍指向受理写入的权威文件。
		const resultFile = join(jeroReviewerResultsDirectoryV1(context.store.store_root, record.lineage_id), `${String(order).padStart(2, "0")}-${lens}.json`);
		let bytes: Buffer | undefined;
		try {
			bytes = readFileSync(resultFile);
		} catch {
			bytes = undefined;
		}
		if (bytes === undefined || `sha256:${sha256Hex(bytes)}` !== artifact.sha256 || (artifact.path !== undefined && artifact.path !== resultFile)) {
			missing.push({ lens, selected_order: order });
		}
	}
	return { complete: missing.length === 0, artifacts, missing };
}

/**
 * 将一个评审员结果受理为槽位的结果产物（spec §D）。校验封套契约，
 * 对原始字节重新计算 sha256，对照所提供槽位重新绑定
 * 主题/序号/评审视角/血脉/目标，然后在 freeze-ledger 日志步骤“之前”
 * 持久化原始字节 + CAS 封套 + 清单（§D 顺序说明）。精确的重复受理
 * 会重放；对已消费评审视角的第二次、有分歧的受理保守失败。
 */
export function admitJeroReviewerResultV1(context: JeroAuthorityContextV1, input: JeroReviewerResultAdmissionInputV1): JeroResultArtifactAdmissionResultV1 {
	const loaded = context.lineages.load(input.lineageId);
	if (loaded.kind === "missing") return { kind: "refused", code: "lineage-missing", detail: `lineage ${input.lineageId} does not exist` };
	if (loaded.kind === "corrupted") return { kind: "refused", code: "corrupted", detail: loaded.detail };
	const record = loaded.record;
	const state = record.state;
	if (state.state !== "reviewing") return { kind: "refused", code: "invalid-state", detail: `result admission requires reviewing (lineage is in ${state.state})` };
	const selected = state.selected_lenses ?? [];
	if (selected[input.selectedOrder] !== input.lens) {
		return { kind: "refused", code: "subject-mismatch", detail: `lens ${input.lens} is not the selected lens at order ${input.selectedOrder}` };
	}
	// 严格封套解码：未知键、错误枚举、空证据都保守失败。
	try {
		const envelope = decodeJeroReviewerResultEnvelopeV1(JSON.parse(Buffer.from(input.rawResultBytes).toString("utf8")));
		if (envelope.review_result.lens_results[0]!.lens !== input.lens) {
			return { kind: "refused", code: "subject-mismatch", detail: `envelope lens ${envelope.review_result.lens_results[0]!.lens} does not match the offered slot ${input.lens}` };
		}
	} catch (error) {
		return { kind: "refused", code: "invalid-envelope", detail: error instanceof Error ? error.message : String(error) };
	}
	const sha256 = `sha256:${sha256Hex(Buffer.from(input.rawResultBytes))}`;
	if (input.declaredSha256 !== undefined && input.declaredSha256 !== sha256) {
		return { kind: "refused", code: "sha256-mismatch", detail: `declared ${input.declaredSha256} but the raw bytes hash to ${sha256}` };
	}
	const expectedSubject = jeroArtifactSubjectForRecordV1(context.store.store_root, record, input.lens, input.selectedOrder);
	if (input.subjectHash !== expectedSubject.subject_hash) {
		return { kind: "refused", code: "subject-mismatch", detail: "the offered subject hash does not bind the record's frozen authority" };
	}
	const existing = readManifestV1(context, input.lineageId);
	const prior = existing.find((artifact) => artifact.lens === input.lens);
	if (prior !== undefined) {
		if (prior.sha256 === sha256 && prior.subject_hash === expectedSubject.subject_hash) {
			return { kind: "admitted", artifact: prior, replayed: true };
		}
		return { kind: "refused", code: "slot-consumed", detail: `lens ${input.lens} already admitted a different result (lenses run exactly once)` };
	}
	const artifact: JeroResultArtifactV1 = {
		schema: JERO_RESULT_ARTIFACT_SCHEMA,
		capability: JERO_RESULT_ARTIFACT_CAPABILITY,
		sha256,
		lineage_id: input.lineageId,
		target_identity: state.snapshot.identity,
		lens: input.lens,
		selected_order: input.selectedOrder,
		subject_hash: expectedSubject.subject_hash,
		admission_decision: "completed",
		...(input.locator === "path"
			? { path: join(jeroReviewerResultsDirectoryV1(context.store.store_root, input.lineageId), `${String(input.selectedOrder).padStart(2, "0")}-${input.lens}.json`) }
			: { reference: jeroResultArtifactReferenceV1(expectedSubject.subject_hash, sha256) }),
	};
	try {
		const directory = jeroReviewerResultsDirectoryV1(context.store.store_root, input.lineageId);
		mkdirSync(directory, { recursive: true, mode: 0o700 });
		// 被受理的原始字节，逐字、0o600（上游：result.json/result.raw 纪律）。
		writeFileSync(join(directory, `${String(input.selectedOrder).padStart(2, "0")}-${input.lens}.json`), Buffer.from(input.rawResultBytes), { mode: 0o600 });
		context.cas.put(artifact, { schema: JERO_RESULT_ARTIFACT_SCHEMA });
		writeManifestV1(context, input.lineageId, [...existing, artifact]);
	} catch (error) {
		return { kind: "refused", code: "authority-unavailable", detail: error instanceof Error ? error.message : String(error) };
	}
	return { kind: "admitted", artifact, replayed: false };
}

/** 对单个产物封套的严格解码（合规/清单表面）。 */
export function decodeJeroResultArtifactV1(value: unknown, label = "result_artifact"): JeroResultArtifactV1 {
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError(`${label}: expected object`);
	const parsed = value as Record<string, unknown>;
	for (const key of Object.keys(parsed)) if (!["schema", "capability", "sha256", "lineage_id", "target_identity", "lens", "selected_order", "subject_hash", "admission_decision", "path", "reference"].includes(key)) throw new TypeError(`${label}: unknown key "${key}"`);
	if (parsed.schema !== JERO_RESULT_ARTIFACT_SCHEMA) throw new TypeError(`${label}.schema must be ${JERO_RESULT_ARTIFACT_SCHEMA}`);
	if (parsed.capability !== JERO_RESULT_ARTIFACT_CAPABILITY) throw new TypeError(`${label}.capability must be ${JERO_RESULT_ARTIFACT_CAPABILITY}`);
	if (parsed.admission_decision !== "completed") throw new TypeError(`${label}.admission_decision must be completed (the vocabulary is closed to it)`);
	if ((parsed.path === undefined) === (parsed.reference === undefined)) throw new TypeError(`${label}: exactly one of path or reference is required`);
	if (typeof parsed.selected_order !== "number" || !Number.isSafeInteger(parsed.selected_order) || parsed.selected_order < 0 || parsed.selected_order > 3) throw new TypeError(`${label}.selected_order must be an integer in 0..3`);
	if (!/^sha256:[0-9a-f]{64}$/.test(parsed.sha256 as string)) throw new TypeError(`${label}.sha256 must be a canonical sha256 identity`);
	if (!/^sha256:[0-9a-f]{64}$/.test(parsed.subject_hash as string)) throw new TypeError(`${label}.subject_hash must be a canonical sha256 identity`);
	if (!/^sha256:[0-9a-f]{64}$/.test(parsed.target_identity as string)) throw new TypeError(`${label}.target_identity must be a canonical sha256 identity`);
	if (parsed.reference !== undefined && !RART_REFERENCE.test(parsed.reference as string)) throw new TypeError(`${label}.reference must match rart1_<64-hex>`);
	return parsed as unknown as JeroResultArtifactV1;
}
