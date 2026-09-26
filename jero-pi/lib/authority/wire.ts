import type { ReviewConsentChoiceV2, ReviewConsentV3, ReviewStatusV3 } from "./wire-contract.ts";
import type { JeroReviewStatusResultV1 } from "./status.ts";
import type { JeroReviewStartResultV1 } from "./start.ts";
import { type JeroSnapshotDerivationV1, jeroUntrackedInventoryDigestV1 } from "./snapshots.ts";

// P4d：jero→线上投影层。扩展的评审控制器机制
// （negotiatedStatusForHostTransport、mapNativeTargetStatus、collect 绑定
// 渲染器、中继请求构建器）消费 camelCase 的 ReviewStatusV3 线上记录；
// 权威发出自己的类型化 jero 命名联合。本模块是“唯一”的翻译点——
// 控制器读取的每个字段都在这里投影，别处不做推断。线上 schema 字符串
// 在 P5 身份改造前保持 gentle-ai.*（移植纪律）；权威自己的值
// （jero-authority/v1 版本标记）作为非路由元数据逐字透传。

const WIRE_CONTRACT = "gentle-ai.review-integration/v2" as const;
const PROJECTION_SCHEMA = "gentle-ai.review-candidate-projection/v1" as const;
const REPAIR_SCHEMA = "gentle-ai.review-authority-repair-assessment/v1" as const;

interface WireArgument {
	name: string;
	value: string;
	token: string;
}

function projectArgumentsV1(arguments_: readonly { name: string; value: string; token: string }[] | undefined): WireArgument[] {
	return (arguments_ ?? []).map((argument) => ({ name: argument.name, value: argument.value, token: argument.token }));
}

function projectCollectInputsV1(inputs: readonly {
	name: string;
	schema: string;
	capture_operation: string;
	arguments: readonly { name: string; value: string; token: string }[];
	submission?: { operation_token: string; argument_tokens: readonly string[]; value: { slot: string; domain: string; schema?: string; minimum?: number; maximum?: number; substitution_location: number } };
	artifact_subject?: Record<string, unknown>;
	base_tree?: string;
	candidate_tree?: string;
	changed_path_manifest?: readonly unknown[];
	repository_context?: Record<string, unknown>;
	validation_request?: Record<string, unknown>;
	correction_request?: Record<string, unknown>;
}[]): Record<string, unknown>[] {
	return inputs.map((input) => ({
		name: input.name,
		schema: input.schema,
		captureOperation: input.capture_operation,
		arguments: projectArgumentsV1(input.arguments),
		...(input.submission === undefined ? {} : {
			submission: {
				operationToken: input.submission.operation_token,
				argumentTokens: [...input.submission.argument_tokens],
				values: [{
					slot: input.submission.value.slot,
					domain: input.submission.value.domain,
					...(input.submission.value.schema === undefined ? {} : { schema: input.submission.value.schema }),
					...(input.submission.value.minimum === undefined ? {} : { minimum: input.submission.value.minimum }),
					...(input.submission.value.maximum === undefined ? {} : { maximum: input.submission.value.maximum }),
					substitutionLocation: input.submission.value.substitution_location,
				}],
			},
		}),
		...(input.artifact_subject === undefined ? {} : { artifactSubject: input.artifact_subject }),
		...(input.base_tree === undefined ? {} : { baseTree: input.base_tree }),
		...(input.candidate_tree === undefined ? {} : { candidateTree: input.candidate_tree }),
		...(input.changed_path_manifest === undefined ? {} : { changedPathManifest: input.changed_path_manifest }),
		...(input.repository_context === undefined ? {} : { repositoryContext: input.repository_context }),
		...(input.validation_request === undefined ? {} : { validationRequest: input.validation_request }),
		...(input.correction_request === undefined ? {} : { correctionRequest: input.correction_request }),
	}));
}

/**
 * 把权威的状态联合加活动快照派生投影为控制器消费的 ReviewStatusV3
 * 线上记录。被拒绝的状态“不”被投影——适配器把它们映射为抛出的
 * 错误。
 */
export function projectJeroStatusToWireV1(status: Extract<JeroReviewStatusResultV1, { kind: "status" }>, derivation: JeroSnapshotDerivationV1): ReviewStatusV3 {
	const next = status.next_transition;
	const record = derivation.record;
	const wire = {
		contract: WIRE_CONTRACT,
		applicability: status.applicability,
		targetIdentity: status.target_identity,
		action: status.action,
		replayability: status.replayability,
		...(status.authority === undefined ? {} : {
			authority: {
				version: status.authority.version,
				lineage_id: status.authority.lineage_id,
				state: status.authority.state,
				generation: status.authority.generation,
				revision: status.authority.revision,
				...(status.authority.consumed === true ? { consumed: true } : {}),
			},
		}),
		receipt: { status: status.receipt.status },
		...(status.frozen === undefined ? {} : {
			frozen: {
				tier: status.frozen.tier,
				original_changed_lines: status.frozen.original_changed_lines,
				correction_budget: status.frozen.correction_budget,
				...(status.frozen.changed_path_manifest_sha256 === undefined ? {} : { changed_path_manifest_sha256: status.frozen.changed_path_manifest_sha256 }),
			},
		}),
		projection: {
			schema: PROJECTION_SCHEMA,
			kind: "current-changes",
			projection: status.projection,
			baseTree: record.base_tree,
			initialReviewTree: record.initial_review_tree,
			// currentCandidateTree 刻意取"本次新鲜派生"的 initial_review_tree：
			// workspace 投影下它与 complete_snapshot_tree 恒等；staged 投影下
			// 它指向被冻结的暂存树（候选正是那棵树），换成 complete_snapshot_tree
			// 会让 staged 评审的候选绑定失配。
			currentCandidateTree: record.initial_review_tree,
			pathsDigest: `sha256:${derivation.changed_path_manifest_sha256}`,
			paths: derivation.changed_path_manifest.map((entry) => entry.path),
			intendedUntracked: [...record.intended_untracked],
			// 与 start.ts 的 intended_untracked_proof 同源（spec §B.2 的
			// 清单摘要）：证明必须能从随行的 intendedUntracked 名称表重算，
			// 复用 changed_path_manifest 摘要会让下游校验必败。
			intendedUntrackedProof: jeroUntrackedInventoryDigestV1(record.intended_untracked),
			initialSnapshotIdentity: `sha256:${derivation.snapshot_id}`,
			currentSnapshotIdentity: `sha256:${derivation.snapshot_id}`,
		},
		repair: { schema: REPAIR_SCHEMA, status: "not_required", counts: { lineages: 0, compact_lineages: 0, legacy_lineages: 0, events: 0, bytes: 0, eligible_candidates: 0, unsupported_lineages: 0, conflicts: 0 }, supported_operations: [], authorization_schema: "gentle-ai.review-abandon-authorization/v2" },
		candidates: [...(status.candidates ?? [])],
		...(next === undefined ? {} : {
			nextTransition: {
				kind: next.kind,
				reasonCode: next.reason_code,
				...(next.kind === "execute" && next.execute !== undefined ? { execute: projectJeroExecuteToWireV1(next.execute) } : {}),
				...(next.kind === "collect" && next.collect !== undefined ? { collect: { inputs: projectCollectInputsV1(next.collect.inputs as never) } } : {}),
			},
		}),
		...(status.forecast === undefined ? {} : { forecast: status.forecast }),
		...(status.repository_context === undefined ? {} : { repositoryContext: status.repository_context }),
		raw: status as unknown as Record<string, unknown>,
	};
	return wire as unknown as ReviewStatusV3;
}

// P4d-e：START 同意门的线上封套。权威发出类型化的 `consent_required`
// 联合分支；控制器机制（pending 注册表、reviewConsentDigest、双选项
// UI、answerConsent 的绑定重新解析）消费
// gentle-ai.review-integration.consent/v3 记录。Fixture 对齐：
// tests/fixtures/review-integration/v2/fixtures/consent.fixture.json 为
// 每个文案字符串提供依据；调用内嵌未跟踪选择，使应答路径重新冻结的
// 正是问题签发时的确切候选（标志形式与
// nativeUntrackedSelectionArguments 一致：--flag=value）。
// P4d-g：execute 载荷投影。权威构建器发出 jero 命名的绑定
// （lineage_id/revision/target_identity/repository_context）；线上契约
// （ReviewNextTransitionExecuteV3.binding）是 camelCase 且 targetIdentity
// “必填”——P4d 读取路径此前逐字透传 jero 绑定，导致每个 execute 消费者
// 读到的绑定字段是 undefined。载荷上其余内容已是线上形态。
function projectJeroExecuteToWireV1(execute: { readonly operation: string; readonly command?: string; readonly arguments: readonly { readonly name: string; readonly value: string; readonly token: string }[]; readonly preconditions: readonly { readonly name: string; readonly value: string }[]; readonly binding: { readonly lineage_id: string; readonly revision: string; readonly target_identity: string; readonly repository_context?: string }; readonly artifacts?: readonly unknown[] }): Record<string, unknown> {
	return {
		operation: execute.operation,
		...(execute.command === undefined ? {} : { command: execute.command }),
		arguments: execute.arguments.map((row) => ({ name: row.name, value: row.value, token: row.token })),
		preconditions: execute.preconditions.map((row) => ({ name: row.name, value: row.value })),
		binding: { targetIdentity: execute.binding.target_identity, lineageId: execute.binding.lineage_id, revision: execute.binding.revision },
		...(execute.artifacts === undefined ? {} : { artifacts: execute.artifacts }),
	};
}

// P4d-g：last-event 闭包投影。权威的闭包构建器发出 jero 命名的记录；
// 控制器经 decodeReviewLastEventClosureV1 消费线上闭包（schema 为
// gentle-ai.review-last-event-closure/v1，顶层 camelCase，嵌套行 snake_case
// 逐字保留）。
export function projectJeroClosureToWireV1(closure: {
	readonly schema: string; readonly operation: string; readonly lineage_id: string; readonly state: string; readonly store_revision: string;
	readonly action?: string; readonly target_identity?: string; readonly request_hash?: string; readonly correction_lines?: number;
	readonly advisory_findings?: unknown; readonly reviewer_results?: readonly unknown[]; readonly status_continuation?: unknown;
	readonly acknowledgement?: unknown; readonly acknowledgement_undecodable?: boolean;
}): Record<string, unknown> {
	return {
		schema: "gentle-ai.review-last-event-closure/v1",
		operation: closure.operation,
		lineageId: closure.lineage_id,
		state: closure.state,
		storeRevision: closure.store_revision,
		...(closure.action === undefined ? {} : { action: closure.action }),
		...(closure.target_identity === undefined ? {} : { targetIdentity: closure.target_identity }),
		...(closure.request_hash === undefined ? {} : { requestHash: closure.request_hash }),
		...(closure.correction_lines === undefined ? {} : { correctionLines: closure.correction_lines }),
		...(closure.advisory_findings === undefined ? {} : { advisoryFindings: closure.advisory_findings }),
		...(closure.reviewer_results === undefined ? {} : { reviewerResults: closure.reviewer_results }),
		...(closure.status_continuation === undefined ? {} : { statusContinuation: closure.status_continuation }),
		...(closure.acknowledgement === undefined ? {} : { acknowledgement: closure.acknowledgement }),
		...(closure.acknowledgement_undecodable === true ? { acknowledgementUndecodable: true } : {}),
	};
}

export function projectJeroConsentEnvelopeV1(
	consent: Extract<JeroReviewStartResultV1, { kind: "consent_required" }>,
	invocation: { cwd: string; untrackedScope?: "exclude" | "select"; expectedUntrackedInventory?: string; intendedUntracked?: readonly string[] },
): ReviewConsentV3 {
	const evidence = consent.risk_evidence;
	const touches = evidence.length === 0 ? "" : ` because it touches ${evidence.join("; ")}`;
	const reason = `this change gets a deeper review${touches}.`;
	const selectionArguments = invocation.untrackedScope === undefined ? [] : [
		`--untracked-scope=${invocation.untrackedScope}`,
		`--expected-untracked-inventory=${invocation.expectedUntrackedInventory}`,
		...(invocation.untrackedScope === "select" ? (invocation.intendedUntracked ?? []).map((path) => `--intended-untracked=${path}`) : []),
	];
	const choice = (answer: "granted" | "declined", label: string, effect: string): ReviewConsentChoiceV2 => ({
		answer,
		label,
		effect,
		invocation: ["gentle-ai", "review", "start",
			"--contract", WIRE_CONTRACT,
			"--cwd", invocation.cwd,
			"--target", consent.target_identity,
			"--projection", consent.projection,
			"--agent", "pi",
			...selectionArguments,
			"--consent", answer,
		].join(" "),
	});
	const choices: readonly [ReviewConsentChoiceV2, ReviewConsentChoiceV2] = [
		choice("granted", "Run the review now", "Reviews this exact frozen candidate now; nothing is granted for later candidates, so each later medium- or high-risk candidate asks again."),
		choice("declined", "Not now, just this once", "Skips the review for this exact candidate only; no review lineage or receipt is created, and ordinary delivery is unmanaged by candidate choice. The next candidate is asked again. This is not the kill switch."),
	];
	const offPath = { note: "To turn reviews off for good in this repository, run /jero:review-mode disable.", command: "/jero:review-mode disable" } as const;
	const raw = {
		schema: "gentle-ai.review-integration.consent/v3",
		contract: WIRE_CONTRACT,
		operation: "review.start",
		action: "consent_required",
		blocking: true,
		target_identity: consent.target_identity,
		projection: consent.projection,
		risk_level: consent.risk_level,
		changed_files: consent.changed_files,
		changed_lines: consent.changed_lines,
		headline: "Jero can review this change before you call it done.",
		reason,
		value: "Reviewing takes a bit longer, and it makes the result substantially safer.",
		risk_evidence: [...evidence],
		choices,
		off_path: offPath,
		agent: "pi",
	};
	return {
		schema: "gentle-ai.review-integration.consent/v3",
		agent: "pi",
		contract: WIRE_CONTRACT,
		operation: "review.start",
		action: "consent_required",
		blocking: true,
		targetIdentity: consent.target_identity,
		projection: consent.projection,
		riskLevel: consent.risk_level,
		changedFiles: consent.changed_files,
		changedLines: consent.changed_lines,
		headline: raw.headline,
		reason,
		value: raw.value,
		riskEvidence: [...evidence],
		choices,
		offPath,
		raw,
	};
}
