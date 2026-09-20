import { execFileSync } from "node:child_process";
import { delimiter } from "node:path";
import { jeroDomainHash } from "./canonical.ts";
import type { JeroArtifactSubjectV1 } from "./start.ts";
import type { JeroLensName, JeroReviewTransactionStateV1 } from "./protocol.ts";
import type { JeroLineageStateFileV1 } from "./lineage-store.ts";
import type { JeroRepositoryContextV1 } from "./repository-context.ts";
import { readJeroSnapshotRecordV1 } from "./snapshots.ts";
import { expectedJeroTargetedValidationRequestHashV1 } from "./validate.ts";
import { reviewGitEnvironment } from "../review-repository.ts";
import { deriveChangedPathManifest, digestChangedPathManifest } from "../review-candidate-view.ts";

// STATUS collect 输入与 execute 绑定（spec §A/§B/§I.2）：确切的
// `--name=value` 令牌纪律、仅宿主令牌、提交描述符（v5 的单数 `value`
// 形态，差异 #1）、产物主题、仓库上下文内嵌，以及提供方定向验证请求
// 文档。对血脉记录保持纯函数：构建器接受已加载的记录并发出类型化
// 线上形态；此处执行的唯一 Git 是对血脉冻结快照对象存储的只读修正
// 路径派生。

// ---------------------------------------------------------------------------
// 线上形态
// ---------------------------------------------------------------------------

export interface JeroTransitionArgumentV1 {
	readonly name: string;
	readonly value: string;
	readonly token: string;
}

/** v5 的单数提交 `value` 行（差异 #1：遗留 `values[]` 行从不携带 schema/minimum/maximum）。 */
export interface JeroCaptureSubmissionValueV1 {
	readonly slot: string;
	readonly domain: string;
	readonly schema?: string;
	readonly minimum?: number;
	readonly maximum?: number;
	readonly substitution_location: number;
}

export interface JeroCaptureSubmissionDescriptorV1 {
	readonly operation_token: string;
	readonly argument_tokens: readonly string[];
	readonly value: JeroCaptureSubmissionValueV1;
}

export type JeroCaptureOperationName = "review.capture-result" | "review.capture-correction-plan" | "review.capture-refuter" | "review.capture-validation";

export interface JeroCollectInputV1 {
	readonly name: string;
	readonly schema: string;
	readonly capture_operation: JeroCaptureOperationName;
	readonly arguments: readonly JeroTransitionArgumentV1[];
	readonly submission?: JeroCaptureSubmissionDescriptorV1;
	readonly artifact_subject?: JeroArtifactSubjectV1;
	readonly base_tree?: string;
	readonly candidate_tree?: string;
	readonly repository_context?: JeroRepositoryContextV1;
	readonly validation_request?: JeroTargetedValidationRequestV1;
}

export interface JeroCollectTransitionPayloadV1 {
	readonly inputs: readonly JeroCollectInputV1[];
}

export interface JeroExecuteTransitionPayloadV1 {
	readonly operation: string;
	readonly command?: string;
	readonly arguments: readonly JeroTransitionArgumentV1[];
	readonly preconditions: readonly { readonly name: string; readonly value: string }[];
	readonly binding: {
		readonly lineage_id: string;
		readonly revision: string;
		readonly target_identity: string;
		readonly repository_context?: string;
	};
	readonly artifacts?: readonly JeroResultArtifactSummaryV1[];
}

/** execute 绑定列出的结果产物摘要（fixture：status-v5-repository-context 的 execute.artifacts）。 */
export interface JeroResultArtifactSummaryV1 {
	readonly schema: string;
	readonly capability: string;
	readonly sha256: string;
	readonly lineage_id: string;
	readonly target_identity: string;
	readonly lens: JeroLensName;
	readonly selected_order: number;
	readonly subject_hash: string;
	readonly admission_decision: "completed";
}

// 四个捕获输入的 jero schema 字符串。合规边界把它们映射到 fixture
// 词汇（差异 #2 纪律：内部用权威 jero 名称，上游名称只出现在
// fixture 同构测试中）。
export const JERO_CAPTURE_INPUT_SCHEMAS = {
	REVIEWER: "jero.authority.capture.reviewer/v1",
	CORRECTION_PLAN: "jero.authority.correction-plan/v1",
	REFUTER: "jero.authority.capture.refuter/v1",
	VALIDATOR: "jero.authority.capture.validator/v1",
} as const;

/** 供合规测试使用的 fixture 词汇映射（绝不用于生产路径）。 */
export const JERO_CAPTURE_INPUT_SCHEMA_CONFORMANCE_MAP: Readonly<Record<string, string>> = {
	[JERO_CAPTURE_INPUT_SCHEMAS.REVIEWER]: "https://gentle-ai.dev/schema/review/reviewer/v1",
	[JERO_CAPTURE_INPUT_SCHEMAS.CORRECTION_PLAN]: "gentle-ai.review-correction-plan/v1",
	[JERO_CAPTURE_INPUT_SCHEMAS.REFUTER]: "https://gentle-ai.dev/schema/review/refuter/v1",
	[JERO_CAPTURE_INPUT_SCHEMAS.VALIDATOR]: "https://gentle-ai.dev/schema/review/validator/v1",
};

// ---------------------------------------------------------------------------
// 参数/令牌纪律（spec §A.1/§B）
// ---------------------------------------------------------------------------

function argument(name: string, value: string): JeroTransitionArgumentV1 {
	return { name, value, token: `--${name}=${value}` };
}

function bindingArguments(record: JeroLineageStateFileV1, repositoryContext: JeroRepositoryContextV1, extra: readonly JeroTransitionArgumentV1[] = []): JeroTransitionArgumentV1[] {
	return [
		argument("lineage", record.lineage_id),
		argument("expected-revision", record.revision),
		argument("target", record.state.snapshot.identity),
		argument("repository-context", repositoryContext.handle),
		...extra,
	];
}

/**
 * §B 提交算术：提交的参数令牌等于 collect 输入的绑定令牌，减去仅宿主
 * 的 `--agent`/`--materialize` 令牌，再加上位于 `substitution_location`
 * 的一个值令牌。
 */
export function jeroSubmissionArgumentTokensV1(collectArguments: readonly { readonly name: string; readonly value: string; readonly token?: string }[], valueToken: string): { argument_tokens: readonly string[]; substitution_location: number } {
	const binding = collectArguments
		.filter((row) => row.name !== "agent" && row.name !== "materialize" && row.name !== "execute")
		.map((row) => row.token ?? `--${row.name}=${row.value}`);
	return { argument_tokens: [...binding, valueToken], substitution_location: binding.length };
}

// ---------------------------------------------------------------------------
// 产物主题（STATUS 侧派生；START 在创建时自行铸造）
// ---------------------------------------------------------------------------

function recordManifestSha256V1(storeRoot: string, state: JeroReviewTransactionStateV1): string {
	if (state.changed_path_manifest_sha256 !== undefined) return state.changed_path_manifest_sha256;
	// 早于 M3 的记录没有该持久化字段：从冻结快照对象存储只读重新派生
	// （身份匹配保证了树的一致）。
	const record = readJeroSnapshotRecordV1(storeRoot, state.snapshot.identity);
	const executor = (file: string, args: readonly string[], options: { cwd: string; env: NodeJS.ProcessEnv }) =>
		execFileSync(file, args, { ...options, encoding: "buffer" }) as Buffer;
	const manifest = deriveChangedPathManifest(record.repository_root, state.base_tree, state.snapshot.candidate_tree, executor);
	return digestChangedPathManifest(manifest);
}

/** 某个已选评审视角的 STATUS 侧产物主题（fixture：authority_revision == 活动权威修订号）。 */
export function jeroArtifactSubjectForRecordV1(storeRoot: string, record: JeroLineageStateFileV1, lens: JeroLensName, selectedOrder: number): JeroArtifactSubjectV1 {
	const state = record.state;
	const manifestSha256 = recordManifestSha256V1(storeRoot, state);
	return {
		schema: "jero.authority.artifact-subject/v1",
		subject_hash: `sha256:${jeroDomainHash("artifact-subject", {
			target_identity: state.snapshot.identity,
			lens,
			selected_order: selectedOrder,
			base_tree: state.base_tree,
			candidate_tree: state.snapshot.candidate_tree,
			changed_path_manifest_sha256: manifestSha256,
		})}`,
		lineage_id: record.lineage_id,
		authority_revision: record.revision,
		target_identity: state.snapshot.identity,
		base_tree: state.base_tree,
		candidate_tree: state.snapshot.candidate_tree,
		changed_path_manifest_sha256: manifestSha256,
		lens,
		selected_order: selectedOrder,
	};
}

// ---------------------------------------------------------------------------
// A.1 review.capture-result——每个缺失评审视角一个 collect 输入
// ---------------------------------------------------------------------------

export function buildJeroReviewerResultCollectInputsV1(storeRoot: string, record: JeroLineageStateFileV1, repositoryContext: JeroRepositoryContextV1): JeroCollectInputV1[] {
	const admitted = new Set((record.state.lens_results ?? []).map(({ lens }) => lens));
	return (record.state.selected_lenses ?? [])
		.map((lens, order) => ({ lens, order }))
		.filter(({ lens }) => !admitted.has(lens))
		.map(({ lens, order }) => {
			const subject = jeroArtifactSubjectForRecordV1(storeRoot, record, lens, order);
			const arguments_ = [
				...bindingArguments(record, repositoryContext),
				argument("lens", lens),
				argument("order", String(order)),
				argument("subject-hash", subject.subject_hash),
				argument("agent", "pi"),
				argument("materialize", "true"),
			];
			const { argument_tokens, substitution_location } = jeroSubmissionArgumentTokensV1(arguments_, "--input={{value}}");
			return {
				name: "reviewer_result",
				schema: JERO_CAPTURE_INPUT_SCHEMAS.REVIEWER,
				capture_operation: "review.capture-result" as const,
				arguments: arguments_,
				submission: {
					operation_token: "capture-result",
					argument_tokens,
					value: {
						slot: "reviewer_result",
						domain: "artifact_path_or_stdin",
						schema: JERO_CAPTURE_INPUT_SCHEMAS.REVIEWER,
						substitution_location,
					},
				},
				artifact_subject: subject,
				base_tree: record.state.base_tree,
				candidate_tree: record.state.snapshot.candidate_tree,
				repository_context: repositoryContext,
			};
		});
}

// ---------------------------------------------------------------------------
// A.2 review.capture-correction-plan——请求文档 + 数值槽位
// ---------------------------------------------------------------------------

export interface JeroCorrectionPlanFindingRowV1 {
	readonly id: string;
	readonly lens: "risk" | "resilience" | "readability" | "reliability";
	readonly location: string;
	readonly severity: "BLOCKER" | "CRITICAL";
	readonly claim: string;
	readonly proof_refs: readonly string[];
	readonly evidence: string;
	readonly evidence_class: "deterministic" | "inferential";
	readonly causal_disposition: "introduced" | "behavior-activated" | "worsened";
}

export interface JeroCorrectionPlanRequestV1 {
	readonly schema: "jero.authority.correction-plan-request/v1";
	readonly request_hash: string;
	readonly lineage_id: string;
	readonly expected_revision: string;
	readonly target_identity: string;
	readonly correction_budget: number;
	readonly fix_finding_ids: readonly string[];
	readonly findings: readonly JeroCorrectionPlanFindingRowV1[];
}

/** 修正执行者收到的冻结发现请求文档（spec §A.2）。 */
export function buildJeroCorrectionPlanRequestV1(record: JeroLineageStateFileV1): JeroCorrectionPlanRequestV1 {
	const state = record.state;
	const byId = new Map(state.findings.map((finding) => [finding.id, finding]));
	const findings: JeroCorrectionPlanFindingRowV1[] = [];
	for (const id of state.fix_finding_ids) {
		const finding = byId.get(id);
		const classification = state.classifications[id];
		if (finding === undefined || classification === undefined) continue;
		findings.push({
			id,
			lens: finding.lens ?? "risk",
			location: finding.location ?? "",
			severity: (finding.severity ?? "CRITICAL") as "BLOCKER" | "CRITICAL",
			claim: finding.claim ?? "",
			proof_refs: finding.proof_refs ?? [classification.proof],
			evidence: classification.proof,
			evidence_class: classification.class === "deterministic" ? "deterministic" : "inferential",
			causal_disposition: (classification.causal_disposition ?? "introduced") as "introduced" | "behavior-activated" | "worsened",
		});
	}
	return {
		schema: "jero.authority.correction-plan-request/v1",
		request_hash: `sha256:${jeroDomainHash("correction-plan-request", {
			lineage_id: record.lineage_id,
			revision: record.revision,
			fix_finding_ids: [...state.fix_finding_ids].toSorted(),
		})}`,
		lineage_id: record.lineage_id,
		expected_revision: record.revision,
		target_identity: state.snapshot.identity,
		correction_budget: state.correction_budget ?? 0,
		fix_finding_ids: [...state.fix_finding_ids].toSorted(),
		findings,
	};
}

export function buildJeroCorrectionPlanCollectInputV1(record: JeroLineageStateFileV1, repositoryContext: JeroRepositoryContextV1): JeroCollectInputV1 {
	const request = buildJeroCorrectionPlanRequestV1(record);
	const arguments_ = [
		...bindingArguments(record, repositoryContext),
		argument("request-hash", request.request_hash),
		argument("correction-budget", String(request.correction_budget)),
	];
	const { argument_tokens, substitution_location } = jeroSubmissionArgumentTokensV1(arguments_, "--correction-lines={{value}}");
	const maximum = Math.max(1, Math.min(200, request.correction_budget));
	return {
		name: "correction_plan",
		schema: JERO_CAPTURE_INPUT_SCHEMAS.CORRECTION_PLAN,
		capture_operation: "review.capture-correction-plan",
		arguments: arguments_,
		submission: {
			operation_token: "capture-correction-plan",
			argument_tokens,
			value: {
				slot: "correction_lines",
				domain: "integer",
				minimum: 1,
				maximum,
				substitution_location,
			},
		},
		repository_context: repositoryContext,
	};
}

// ---------------------------------------------------------------------------
// A.3 review.capture-refuter——自包含的提供方角色向量
// ---------------------------------------------------------------------------

export function buildJeroRefuterCollectInputV1(record: JeroLineageStateFileV1, repositoryContext: JeroRepositoryContextV1): JeroCollectInputV1 {
	return {
		name: "provider_refuter",
		schema: JERO_CAPTURE_INPUT_SCHEMAS.REFUTER,
		capture_operation: "review.capture-refuter",
		arguments: [
			...bindingArguments(record, repositoryContext),
			argument("agent", "pi"),
			argument("execute", "true"),
		],
		repository_context: repositoryContext,
	};
}

// ---------------------------------------------------------------------------
// A.4 review.capture-validation——提供方定向 validator 向量
// ---------------------------------------------------------------------------

export interface JeroTargetedValidationFindingV1 {
	readonly id: string;
	readonly lens: "risk" | "resilience" | "readability" | "reliability";
	readonly location: string;
	readonly severity: "BLOCKER" | "CRITICAL";
	readonly claim: string;
	readonly proof_refs: readonly string[];
	readonly evidence_class: "deterministic" | "inferential";
	readonly causal_disposition: "introduced" | "behavior-activated" | "worsened";
}

export interface JeroTargetedValidationClassificationV1 {
	readonly finding_id: string;
	readonly severity?: string;
	readonly class: "deterministic" | "inferential";
	readonly causal_disposition: "introduced" | "behavior-activated" | "worsened";
	readonly proof: string;
}

export interface JeroTargetedValidationRequestV1 {
	readonly schema: "jero.authority.targeted-validation-request/v1";
	readonly request_hash: string;
	readonly lineage_id: string;
	readonly expected_revision: string;
	readonly target_identity: string;
	readonly fix_finding_ids: readonly string[];
	readonly policy_content: string;
	readonly fix_findings: readonly JeroTargetedValidationFindingV1[];
	readonly fix_classifications: readonly JeroTargetedValidationClassificationV1[];
	readonly projection: "workspace" | "staged";
	readonly correction_candidate_tree: string;
	readonly correction_target_identity: string;
	readonly correction_paths: readonly string[];
	readonly correction_paths_digest: string;
}

/** 对血脉冻结快照对象存储的只读修正路径派生。 */
function jeroCorrectionPathsV1(storeRoot: string, state: JeroReviewTransactionStateV1): string[] {
	const record = readJeroSnapshotRecordV1(storeRoot, state.snapshot.identity);
	const environment: NodeJS.ProcessEnv = {
		GIT_ALTERNATE_OBJECT_DIRECTORIES: `${record.object_store.object_directory}${delimiter}${record.object_store.alternate_object_directory}`,
	};
	const output = execFileSync("git", ["diff", "--no-renames", "--name-only", "-z", state.initial_review_tree, state.final_candidate_tree], {
		cwd: record.repository_root,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
		env: { ...reviewGitEnvironment(), ...environment },
	});
	return output.split("\0").filter(Boolean).toSorted();
}

/**
 * 完整的定向验证请求（spec §A.4）：修正发现只携带
 * evidenceClass/causalDisposition；请求哈希是对冻结修正范围的 M2 域
 * 哈希（validate.ts）。
 */
export function buildJeroTargetedValidationRequestV1(storeRoot: string, record: JeroLineageStateFileV1): JeroTargetedValidationRequestV1 {
	const state = record.state;
	const requestHash = `sha256:${expectedJeroTargetedValidationRequestHashV1(state)}`;
	const fixIds = new Set(state.fix_finding_ids);
	const fixFindings: JeroTargetedValidationFindingV1[] = [];
	const fixClassifications: JeroTargetedValidationClassificationV1[] = [];
	for (const finding of state.findings) {
		if (!fixIds.has(finding.id)) continue;
		const classification = state.classifications[finding.id];
		if (classification === undefined) continue;
		fixFindings.push({
			id: finding.id,
			lens: finding.lens ?? "risk",
			location: finding.location ?? "",
			severity: (finding.severity ?? "CRITICAL") as "BLOCKER" | "CRITICAL",
			claim: finding.claim ?? "",
			proof_refs: finding.proof_refs ?? [classification.proof],
			evidence_class: classification.class === "deterministic" ? "deterministic" : "inferential",
			causal_disposition: (classification.causal_disposition ?? "introduced") as "introduced" | "behavior-activated" | "worsened",
		});
		fixClassifications.push({
			finding_id: finding.id,
			...(finding.severity === undefined ? {} : { severity: finding.severity }),
			class: classification.class === "deterministic" ? "deterministic" : "inferential",
			causal_disposition: (classification.causal_disposition ?? "introduced") as "introduced" | "behavior-activated" | "worsened",
			proof: classification.proof,
		});
	}
	const correctionPaths = jeroCorrectionPathsV1(storeRoot, state);
	return {
		schema: "jero.authority.targeted-validation-request/v1",
		request_hash: requestHash,
		lineage_id: record.lineage_id,
		expected_revision: record.revision,
		target_identity: state.snapshot.identity,
		fix_finding_ids: [...state.fix_finding_ids].toSorted(),
		policy_content: state.policy_hash,
		fix_findings: fixFindings,
		fix_classifications: fixClassifications,
		projection: "workspace",
		correction_candidate_tree: state.final_candidate_tree,
		correction_target_identity: state.snapshot.identity,
		correction_paths: correctionPaths,
		correction_paths_digest: `sha256:${jeroDomainHash("correction-paths", correctionPaths)}`,
	};
}

export function buildJeroValidationCollectInputV1(storeRoot: string, record: JeroLineageStateFileV1, repositoryContext: JeroRepositoryContextV1): JeroCollectInputV1 {
	const request = buildJeroTargetedValidationRequestV1(storeRoot, record);
	return {
		name: "provider_targeted_validator",
		schema: JERO_CAPTURE_INPUT_SCHEMAS.VALIDATOR,
		capture_operation: "review.capture-validation",
		arguments: [
			...bindingArguments(record, repositoryContext),
			argument("request-hash", request.request_hash),
			argument("agent", "pi"),
			argument("execute", "true"),
		],
		repository_context: repositoryContext,
		validation_request: request,
	};
}

// ---------------------------------------------------------------------------
// execute 绑定（fixture：status-v5-repository-context——review.finalize）
// ---------------------------------------------------------------------------

export function buildJeroFinalizeExecuteTransitionV1(record: JeroLineageStateFileV1, repositoryContext: JeroRepositoryContextV1, artifacts: readonly JeroResultArtifactSummaryV1[]): JeroExecuteTransitionPayloadV1 {
	const arguments_ = [
		argument("lineage", record.lineage_id),
		argument("captured-results", "true"),
		argument("contract", "jero.authority/v1"),
		argument("agent", "pi"),
	];
	return {
		operation: "review.finalize",
		command: `jero review finalize ${arguments_.map(({ token }) => token).join(" ")}`,
		arguments: arguments_,
		preconditions: [
			{ name: "state", value: "reviewing" },
			{ name: "captured_artifacts", value: "complete" },
		],
		binding: {
			lineage_id: record.lineage_id,
			revision: record.revision,
			target_identity: record.state.snapshot.identity,
			repository_context: repositoryContext.handle,
		},
		artifacts,
	};
}

/**
 * approved 状态的焚毁向量（扩展契约
 * assertReviewApprovedAcknowledgementExecuteV1）：恰好五个提供方签发的
 * 参数（cwd、lineage、target、expected-revision、token）、唯一的
 * approved 前置条件，以及焚毁必须相等的绑定。令牌由权威签发，且在
 * 血脉与修订号上是确定性的——扩展把这些同样的令牌重新解析进
 * reviewAcknowledgeV1，因此漂移的焚毁以绑定不匹配保守失败。命令保留
 * 线上的 gentle-ai 前缀：线上词汇被迁移后的金样向量字节钉住
 * （设计 5.1.7），并刻意在身份改造中幸存。
 */
export function buildJeroAcknowledgeExecuteTransitionV1(record: JeroLineageStateFileV1, repositoryContext: JeroRepositoryContextV1, cwd: string): JeroExecuteTransitionPayloadV1 {
	const arguments_ = [
		argument("cwd", cwd),
		argument("lineage", record.lineage_id),
		argument("target", record.state.snapshot.identity),
		argument("expected-revision", record.revision),
		argument("token", `jero-burn:${record.lineage_id}:${record.revision}`),
	];
	return {
		operation: "review.acknowledge-approved",
		command: `gentle-ai review acknowledge-approved ${arguments_.map(({ token }) => token).join(" ")}`,
		arguments: arguments_,
		preconditions: [{ name: "state", value: "approved" }],
		binding: {
			lineage_id: record.lineage_id,
			revision: record.revision,
			target_identity: record.state.snapshot.identity,
			repository_context: repositoryContext.handle,
		},
	};
}
