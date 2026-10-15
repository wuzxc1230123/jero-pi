import type { ReviewConsentChoiceV2, ReviewConsentV3, ReviewNextTransitionExecuteV3, ReviewStatusV3 } from "./wire-contract.ts";
import type { ReviewStatusAuthorityV1, ReviewStatusFrozenV1 } from "./wire-contract-interfaces.ts";
import type { JeroReviewStatusResultV1 } from "./status.ts";
import type { JeroReviewStartResultV1 } from "./start.ts";
import { type JeroSnapshotDerivationV1, jeroUntrackedInventoryDigestV1 } from "./snapshots.ts";
import { REVIEW_PROJECTION_SCHEMA } from "./wire-contract-enums.ts";

// P4d：jero→线上投影层。扩展的评审控制器机制
// （negotiatedStatusForHostTransport、mapNativeTargetStatus、collect 绑定
// 渲染器、中继请求构建器）消费 camelCase 的 ReviewStatusV3 线上记录；
// 权威发出自己的类型化 jero 命名联合。本模块是“唯一”的翻译点——
// 控制器读取的每个字段都在这里投影，别处不做推断。线上 schema 字符串
// 在 P5 身份改造前保持 jero-ai.*（移植纪律）；权威自己的值
// （jero-authority/v1 版本标记）作为非路由元数据逐字透传。

const WIRE_CONTRACT = "jero-ai.review-integration/v2" as const;
// 正典投影 schema id（解码器 wire-contract-decode-start 强制
// integration.projection/v1；曾经的 candidate-projection 是被外层强转
// 掩护的漂移，连测试夹具都复制了错值——类型化后由编译器钉住）。
const PROJECTION_SCHEMA = REVIEW_PROJECTION_SCHEMA;
const REPAIR_SCHEMA = "jero-ai.review-authority-repair-assessment/v1" as const;

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
		// action/applicability/replayability/receipt 与 authority.version 同族：
		// jero 词表向线上词表的逐字透传（非路由元数据），转换收在字段级。
		applicability: status.applicability as ReviewStatusV3["applicability"],
		targetIdentity: status.target_identity,
		action: status.action as ReviewStatusV3["action"],
		replayability: status.replayability as ReviewStatusV3["replayability"],
		// P4d-g 同族修复：authority/frozen 是扩展消费面（类型化 ReviewStatusV3
		// 为驼峰——retainNativeCaptureRoutes 读 authority.lineageId）。此处是
		// 进程内适配器的唯一生产投影点，蛇形透传会让捕获路由永不注册、
		// jero_review_capture 在任何会话都被 capture-binding-rejected 拒绝；
		// 外部 wire 输入仍由 decodeReviewStatusV3 独立解码，两个方向互不越界。
		...(status.authority === undefined ? {} : {
			authority: {
				// version 是文件头注记的“非路由元数据逐字透传”双轨
				// （jero-authority/v1 vs 线上版本词表），转换收在字段级。
				version: status.authority.version as unknown as ReviewStatusAuthorityV1["version"],
				lineageId: status.authority.lineage_id,
				state: status.authority.state,
				generation: status.authority.generation,
				revision: status.authority.revision,
				...(status.authority.consumed === true ? { consumed: true as const } : {}),
			},
		}),
		receipt: { status: status.receipt.status },
		...(status.frozen === undefined ? {} : {
			frozen: {
				tier: status.frozen.tier as ReviewStatusFrozenV1["tier"],
				originalChangedLines: status.frozen.original_changed_lines,
				correctionBudget: status.frozen.correction_budget,
				...(status.frozen.changed_path_manifest_sha256 === undefined ? {} : { changedPathManifestSha256: status.frozen.changed_path_manifest_sha256 }),
			},
		}),
		projection: {
			schema: PROJECTION_SCHEMA,
			kind: "current-changes" as const,
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
		// repair 投影按类型面驼峰输出（曾经的蛇形键+abandon 授权串是缺陷 2
		// 同族的隐性漂移，被外层双重强转掩护——修键并对齐 repair 授权 schema）。
		repair: { schema: REPAIR_SCHEMA, status: "not_required" as const, counts: { lineages: 0, compactLineages: 0, legacyLineages: 0, events: 0, bytes: 0, eligibleCandidates: 0, unsupportedLineages: 0, conflicts: 0 }, supportedOperations: [], authorizationSchema: "jero-ai.review-repair-authorization/v1" as const },
		candidates: [...(status.candidates ?? [])],
		...(next === undefined ? {} : {
			// 转换的顶层键（kind/reasonCode）受编译器检查；execute/collect
			// 载荷构建器仍产出 Record 形态的线上双轨（见 projectJeroExecute
			// ToWireV1/projectCollectInputsV1），强转只收拢到载荷级——顶层
			// 字段改名从此在编译期报错，不再靠人眼。
			nextTransition: {
				kind: next.kind,
				reasonCode: next.reason_code,
				...(next.kind === "execute" && next.execute !== undefined ? { execute: projectJeroExecuteToWireV1(next.execute) as unknown as ReviewNextTransitionExecuteV3 } : {}),
				...(next.kind === "collect" && next.collect !== undefined ? { collect: { inputs: projectCollectInputsV1(next.collect.inputs as never) as never } } : {}),
			},
		}),
		// forecast/repositoryContext 是 jero 记录向线上型的逐字透传双轨
		// （内容不经路由），转换收在字段级。
		...(status.forecast === undefined ? {} : { forecast: status.forecast as unknown as ReviewStatusV3["forecast"] }),
		...(status.repository_context === undefined ? {} : { repositoryContext: status.repository_context as unknown as ReviewStatusV3["repositoryContext"] }),
		raw: status as unknown as Record<string, unknown>,
	};
	// 顶层不再双重强转：本对象字面量必须结构化满足 ReviewStatusV3，缺陷 2
	// 一类的顶层键漂移由编译器接管。raw 的宽转换保留（源本是权威侧蛇形
	// 记录，仅作诊断透传，不作路由）。
	return wire;
}

// P4d-e：START 同意门的线上封套。权威发出类型化的 `consent_required`
// 联合分支；控制器机制（pending 注册表、reviewConsentDigest、双选项
// UI、answerConsent 的绑定重新解析）消费
// jero-ai.review-integration.consent/v3 记录。Fixture 对齐：
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
// jero-ai.review-last-event-closure/v1，顶层 camelCase，嵌套行 snake_case
// 逐字保留）。
export function projectJeroClosureToWireV1(closure: {
	readonly schema: string; readonly operation: string; readonly lineage_id: string; readonly state: string; readonly store_revision: string;
	readonly action?: string; readonly target_identity?: string; readonly request_hash?: string; readonly correction_lines?: number;
	readonly advisory_findings?: unknown; readonly reviewer_results?: readonly unknown[]; readonly status_continuation?: unknown;
	readonly acknowledgement?: unknown; readonly acknowledgement_undecodable?: boolean;
}): Record<string, unknown> {
	return {
		schema: "jero-ai.review-last-event-closure/v1",
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

// 提供方调用词元的引号编码：解析端 splitNativeConsentInvocation 支持
// "..." 逐字词元（引号内反斜杠原样保留，适配 UNC/盘符路径）。值含空白或
// 单引号时必须包裹——否则按空白分词会截断，含空格的 cwd（Windows 用户
// 目录常见）曾使同意应答恒失败于 consent-invocation-cwd-changed。值含
// 双引号在解析文法下不可表示：在提问侧 fail-fast，好过应答侧绑定失败。
function consentInvocationToken(value: string): string {
	if (value.includes('"')) throw new TypeError(`Native consent invocation cannot encode a value containing a double quote: ${value}`);
	if (/[\s']/.test(value)) return `"${value}"`;
	return value;
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
		`--expected-untracked-inventory=${consentInvocationToken(String(invocation.expectedUntrackedInventory))}`,
		...(invocation.untrackedScope === "select" ? (invocation.intendedUntracked ?? []).map((path) => `--intended-untracked=${consentInvocationToken(path)}`) : []),
	];
	const choice = (answer: "granted" | "declined", label: string, effect: string): ReviewConsentChoiceV2 => ({
		answer,
		label,
		effect,
		invocation: ["jero-ai", "review", "start",
			"--contract", WIRE_CONTRACT,
			"--cwd", consentInvocationToken(invocation.cwd),
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
		schema: "jero-ai.review-integration.consent/v3",
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
		schema: "jero-ai.review-integration.consent/v3",
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
