// jero-ai 评审中继域：宿主中继槽位、提供方角色向量捕获、last-event 闭环映射。
// 自 extensions/jero-ai.ts 拆分（机械平移，语义零改动）。

import {
	prepareReviewHostRelaySlot, REVIEW_HOST_RELAY_FAILURE, REVIEW_HOST_RELAY_PI_TIMEOUT_ENV,
	REVIEW_HOST_RELAY_PI_TIMEOUT_MAX_MS, REVIEW_HOST_RELAY_SUBMISSION_MISSING_MESSAGE,
	REVIEW_HOST_RELAY_UNAVAILABLE_MESSAGE, ReviewHostRelayError, type ReviewHostRelayRunner,
	type ReviewHostRelaySlot, reviewHostRelayUnachievableDetail, reviewHostRelayUnachievableReason,
	type ReviewProviderRoleVectorSlot, runReviewHostRelayReviewerGroup,
	submitReviewHostRelayPreparedResult
} from "./review-host-relay.ts";
import { admitJeroCaptureResultForRelayV1, renderJeroCaptureSlotForRelayV1 } from "./authority/capture-relay.ts";
import { CandidateViewError } from "./review-candidate-view.ts";
import {
	isNativeReviewUnachievableVerbRefused, type NativeReviewCli,
	type NativeReviewUnachievableLensCaptureArtifact
} from "./authority/client-contract.ts";
import {
	decodeReviewLastEventClosureV1, type ReviewLastEventClosureBinding,
	type ReviewLastEventClosureV1, type ReviewStatusV3
} from "./authority/wire-contract.ts";
import { reconcileUnknownReviewLastEventCapture } from "./review-last-event-controller.ts";
import { type RetainedNativeCaptureRoute, type RetainedNativeStatusSelection } from "./jero-ai-review-consent.ts";
import {
	clearRetainedNativeStatusSelectionsOnTerminal, nativeMutationRequiresStatus,
	nativeOperationFailure, syncRetainedNativeStatusSelections
} from "./jero-ai-review-native-ops.ts";
import { REVIEW_HOST_AGENT } from "./jero-ai-review-transport.ts";
import { captureGroupAuthorityDrift, hasExactReviewCaptureSuffix } from "./jero-ai-review-select.ts";
// 字节，进程内 admission 负责暂存结果。runner 保持
// 可注入以便测试。
const runJeroAuthorityRelaySlot: ReviewHostRelayRunner = async (request) =>
	submitReviewHostRelayPreparedResult(
		await prepareReviewHostRelaySlot(request, undefined, renderJeroCaptureSlotForRelayV1),
		(requestForAdmit, operationToken, submitTokens, resultFile) => admitJeroCaptureResultForRelayV1(requestForAdmit, operationToken, submitTokens, resultFile),
	);
const runJeroAuthorityReviewerGroup: typeof runReviewHostRelayReviewerGroup = async (requests) =>
	runReviewHostRelayReviewerGroup(requests, (request) => prepareReviewHostRelaySlot(request, undefined, renderJeroCaptureSlotForRelayV1));
const submitJeroAuthorityPreparedResult: typeof submitReviewHostRelayPreparedResult = async (prepared) =>
	submitReviewHostRelayPreparedResult(prepared, (request, operationToken, submitTokens, resultFile) => admitJeroCaptureResultForRelayV1(request, operationToken, submitTokens, resultFile));
let activeReviewHostRelayRunner: ReviewHostRelayRunner = runJeroAuthorityRelaySlot;
export let activeReviewHostRelayReviewerGroupRunner = runJeroAuthorityReviewerGroup;
export let activeReviewHostRelaySubmissionRunner = submitJeroAuthorityPreparedResult;
export function setReviewHostRelayRunnerForTesting(runner?: ReviewHostRelayRunner): void {
	activeReviewHostRelayRunner = runner ?? runJeroAuthorityRelaySlot;
}
export function setReviewHostRelayGroupRunnersForTesting(reviewerGroup?: typeof runReviewHostRelayReviewerGroup, submission?: typeof submitReviewHostRelayPreparedResult): void {
	activeReviewHostRelayReviewerGroupRunner = reviewerGroup ?? runJeroAuthorityReviewerGroup;
	activeReviewHostRelaySubmissionRunner = submission ?? submitJeroAuthorityPreparedResult;
}

export const REVIEW_HOST_RELAY_RETRY_ACTION =
	"Call fresh STATUS and submit only an exact reoffered one-slot binding; never replay this capture from transcript inference.";

// gentle-pi#522 / #524：gentle-ai 在准入处拒绝了提交，并
// 声明镜头槽位未被消耗。被拒绝的字节才是
// 问题所在，所以 continuation 是在重新提供的槽位上跑一次全新的评审者，
// 既不是重放，也不是未知结果对账。
export const REVIEW_HOST_RELAY_REFUSED_ACTION =
	"gentle-ai refused this submission at admission and did not consume the lens slot; the reason is in failure.stderr. "
	+ "Call fresh STATUS and run only the exact slot it reoffers so the reviewer produces a new result that satisfies that refusal; never resubmit the refused bytes.";

// gentle-pi#638：声明已记录，因此全新 STATUS 会以每个声明槽位一个 withdraw 绑定停止评审，而不是重新提供评审者。withdraw 命令是回到同一槽位的唯一途径；其他一切都需要更小的候选和一次新评审。
const REVIEW_HOST_RELAY_UNACHIEVABLE_ACTION =
	"A deterministic relay failure was declared unachievable for this bound slot, and fresh STATUS now stops this review instead of reoffering the reviewer. "
	+ "If the failure was transient, run the withdraw command in unachievable_lens_slots with the same binding so the review re-offers this exact reviewer; otherwise reduce the candidate scope and start a new review.";

// gentle-pi#638：中继失败是确定性的，但 gentle-ai 拒绝了该声明，因此槽位状态未变，评审仍需要一个 provider 绑定的 continuation。
const REVIEW_HOST_RELAY_DECLARATION_FAILED_ACTION =
	"The relay failure was deterministic for this slot, but gentle-ai refused the unachievable declaration, so no slot state changed. "
	+ "Call fresh STATUS and follow only its declared action; never replay this capture from transcript inference.";

function reviewHostRelayTimeoutNextAction(error: ReviewHostRelayError): string {
	const measured = error.elapsedMs === null || error.timeoutMs === null
		? ""
		: ` The reviewer was killed after ${error.elapsedMs}ms against a ${error.timeoutMs}ms bound.`;
	return `Do not relaunch this slot unchanged: the same bound kills the same reviewer run again and re-spends the model tokens for nothing.${measured} `
		+ `Change one of two things first: export ${REVIEW_HOST_RELAY_PI_TIMEOUT_ENV}=<milliseconds> above the reviewer's real wall time (hard ceiling ${REVIEW_HOST_RELAY_PI_TIMEOUT_MAX_MS}), or reduce the candidate scope so the materialized prompt is smaller. `
		+ "Then call fresh STATUS and submit only its exact reoffered slot.";
}

export function reviewHostRelayFailureReport(error: ReviewHostRelayError): Record<string, unknown> {
	return {
		kind: error.kind,
		stage: error.stage,
		exit_code: error.exitCode,
		timed_out: error.timedOut,
		...(error.elapsedMs === null ? {} : { elapsed_ms: error.elapsedMs }),
		...(error.timeoutMs === null ? {} : { timeout_ms: error.timeoutMs }),
		// 捕获的原生 stderr 是 provider 确切
		// 拒绝原因的唯一所在（gentle-pi#524）；丢弃它会把每个准入
		// 拒绝都藏进 "submission-refused" 背后。
		...(error.stderr.length === 0 ? {} : { stderr: error.stderr }),
	};
}

function mapLastEventClosure(
	closure: ReviewLastEventClosureV1,
	binding: ReviewLastEventClosureBinding,
): Record<string, unknown> {
	if (closure.lineageId !== binding.lineageId) throw new CandidateViewError("last-event closure returned a different lineage", "last-event-closure-binding-drift");
	if (binding.targetIdentity !== undefined && closure.targetIdentity !== undefined && closure.targetIdentity !== binding.targetIdentity) {
		throw new CandidateViewError("last-event closure returned a different target", "last-event-closure-binding-drift");
	}
	return {
		tool: "jero_review_capture",
		status: "closed",
		outcome: "native-last-event-closure",
		closure: {
			schema: closure.schema,
			operation: closure.operation,
			lineage_id: closure.lineageId,
			state: closure.state,
			store_revision: closure.storeRevision,
			...(closure.action === undefined ? {} : { action: closure.action }),
			...(closure.targetIdentity === undefined ? {} : { target_identity: closure.targetIdentity }),
			...(closure.requestHash === undefined ? {} : { request_hash: closure.requestHash }),
			...(closure.correctionLines === undefined ? {} : { correction_lines: closure.correctionLines }),
			...(closure.advisoryFindings === undefined ? {} : { advisory_findings: closure.advisoryFindings }),
			...(closure.statusContinuation === undefined ? {} : { status_continuation: closure.statusContinuation.raw }),
			// 宿主必须看到确认才能执行它：approval 现在
			// 等待那次确切调用而不是自行销毁，因此
			// 在这里丢弃它会让 lineage 永远滞留在 approved。
			...(closure.acknowledgement === undefined ? {} : { acknowledgement: closure.acknowledgement.raw }),
			// 存在但无法解码的 continuation 不等于没有：宿主已
			// approved 且不能在此结束它，沉默会被解读为
			// 无事可做。
			...(closure.acknowledgementUndecodable === undefined ? {} : { acknowledgement_undecodable: true }),
		},
		lineage_id: closure.lineageId,
		state: closure.state,
		store_revision: closure.storeRevision,
	};
}

export function mapAndClearLastEventClosure(
	closure: ReviewLastEventClosureV1,
	binding: ReviewLastEventClosureBinding,
	selections: Map<string, RetainedNativeStatusSelection>,
	workspaceRoot: string,
): Record<string, unknown> {
	const mapped = mapLastEventClosure(closure, binding);
	clearRetainedNativeStatusSelectionsOnTerminal(selections, workspaceRoot, closure.lineageId, closure.state);
	return mapped;
}

export function decodeRelayLastEventClosure(submission: string): ReviewLastEventClosureV1 | undefined {
	let body: unknown;
	try { body = JSON.parse(submission); } catch { throw new CandidateViewError("host relay submission returned malformed JSON", "last-event-closure-decode-failed"); }
	if (typeof body !== "object" || body === null || Array.isArray(body) || (body as { schema?: unknown }).schema !== "gentle-ai.review-last-event-closure/v1") return undefined;
	return decodeReviewLastEventClosureV1(body);
}

export async function reconcileUnknownReviewCaptureFailure(
	error: unknown | undefined,
	nativeReviewCli: NativeReviewCli,
	cwd: string,
	binding: ReviewLastEventClosureBinding,
	selections: Map<string, RetainedNativeStatusSelection>,
	route: RetainedNativeCaptureRoute | undefined,
	expectedReviewCaptureSuffix?: readonly string[],
	agent?: "pi",
): Promise<Record<string, unknown>> {
	const failure = error === undefined ? undefined : nativeOperationFailure("jero_review_capture", error);
	if (error !== undefined && !nativeMutationRequiresStatus(error)) return failure;
	try {
		const selector = agent === undefined ? route : { ...route, agent };
		const status = await reconcileUnknownReviewLastEventCapture(nativeReviewCli, cwd, binding, selector);
		syncRetainedNativeStatusSelections(selections, cwd, status, route?.baseRef);
		if (expectedReviewCaptureSuffix !== undefined && !hasExactReviewCaptureSuffix(status, expectedReviewCaptureSuffix)) return captureGroupAuthorityDrift(status);
		return {
			tool: "jero_review_capture",
			status: "reconciled",
			outcome: "native-capture-outcome-unknown",
			...(failure === undefined ? {} : { native_failure: failure }),
			lineage_id: binding.lineageId,
			target_identity: status.targetIdentity,
			provider_action: status.action,
			...(status.nextTransition === undefined ? {} : { next_transition: status.nextTransition }),
			result: status.raw,
		};
	} catch (statusError) {
		const reconciliationFailure = nativeOperationFailure("jero_review_capture", statusError);
		return { ...(failure ?? reconciliationFailure), outcome: "native-capture-status-reconciliation-failed", reconciliation_failure: reconciliationFailure };
	}
}

export async function executeReviewHostRelayCapture(
	slot: ReviewHostRelaySlot,
	nativeReviewCli: NativeReviewCli,
	cwd: string,
	binding: ReviewLastEventClosureBinding,
	selections: Map<string, RetainedNativeStatusSelection>,
	route: RetainedNativeCaptureRoute | undefined,
	signal?: AbortSignal,
): Promise<Record<string, unknown>> {
	try {
		if (slot.submission === undefined) {
			throw new ReviewHostRelayError(
				REVIEW_HOST_RELAY_FAILURE.SUBMISSION_CONTRACT_MISMATCH,
				"binding",
				REVIEW_HOST_RELAY_SUBMISSION_MISSING_MESSAGE,
			);
		}
		const result = await activeReviewHostRelayRunner({
			captureArgumentTokens: slot.captureArgumentTokens,
			targetCwd: cwd,
			submission: slot.submission,
			...(signal === undefined ? {} : { signal }),
		});
		const closure = decodeRelayLastEventClosure(result.submission);
		if (closure !== undefined) return mapAndClearLastEventClosure(closure, binding, selections, cwd);
		return {
			tool: "jero_review_capture",
			status: "captured",
			outcome: "native-reviewer-result-captured",
			lineage_id: binding.lineageId,
			host_relay: {
				transport: "pi_host_relay",
				...(slot.lens === undefined ? {} : { lens: slot.lens }),
				...(slot.order === undefined ? {} : { order: slot.order }),
				...(slot.subjectHash === undefined ? {} : { subject_hash: slot.subjectHash }),
				prompt_bytes: result.promptByteLength,
				result_bytes: result.resultByteLength,
				submission: result.submission,
			},
		};
	} catch (error) {
		if (!(error instanceof ReviewHostRelayError)) return await reconcileUnknownReviewCaptureFailure(error, nativeReviewCli, cwd, binding, selections, route, undefined, REVIEW_HOST_AGENT);
		if (error.mutationOutcome === "unknown") {
			return {
				...(await reconcileUnknownReviewCaptureFailure(error, nativeReviewCli, cwd, binding, selections, route, undefined, REVIEW_HOST_AGENT)),
				failure: reviewHostRelayFailureReport(error),
				reason: error.message,
			};
		}
		if (error.kind === REVIEW_HOST_RELAY_FAILURE.RELAY_UNAVAILABLE) {
			return {
				tool: "jero_review_capture",
				status: "blocked",
				outcome: "pi-host-relay-unavailable",
				reason: REVIEW_HOST_RELAY_UNAVAILABLE_MESSAGE,
				mutation_performed: false,
				mutation_outcome: "none",
			};
		}
		if (error.kind === REVIEW_HOST_RELAY_FAILURE.MATERIALIZE_FAILED && /not eligible for immutable receipt review/.test(error.message)) {
			// jero-pi M3（design 8）：握手拒绝类已删除；
			// 该形态的 provider 拒绝以普通 materialize
			// 失败浮出，携带其原样的拒绝原因。
			return {
				tool: "jero_review_capture",
				status: "blocked",
				outcome: "pi-host-relay-materialize-refused",
				reason: error.message,
				refusal: error.stderr,
				mutation_performed: false,
				mutation_outcome: "none",
			};
		}
		// gentle-pi#638：两类确定性中继失败终结的是槽位而非传输。通过原生动词声明槽位不可达成，会记录 provider 所拥有的事实——该评审者在当前条件下无法完成——随后恰好一次绑定 STATUS 重查渲染带 withdraw 绑定的带类型 stop，而不是重新提供同一槽位。声明绑定从该槽位自己的 provider 签发 `--name=value` token 重新派生，绝不来自 transcript 状态。
		const unachievableReason = reviewHostRelayUnachievableReason(error);
		const declarationBinding = unachievableSlotDeclarationBinding(slot);
		if (unachievableReason !== undefined && declarationBinding !== undefined && nativeReviewCli.captureUnachievableLens !== undefined) {
			let declared: NativeReviewUnachievableLensCaptureArtifact | undefined;
			try {
				declared = await nativeReviewCli.captureUnachievableLens({ cwd, ...declarationBinding, reason: unachievableReason, ...(reviewHostRelayUnachievableDetail(error) === undefined ? {} : { detail: reviewHostRelayUnachievableDetail(error)! }), ...(signal === undefined ? {} : { signal }) });
			} catch (declarationError) {
				// 仅对未知动词的能力拒绝才放行：没有 `capture-unachievable` 的旧二进制保持下方今日的传输失败行为。其余所有声明失败都浮出，绝不藏在其所跟随的中继失败背后。
				if (!isNativeReviewUnachievableVerbRefused(declarationError)) {
					// gentle-pi#822（diff 之外）：声明失败自己的封套携带变更真相——进程可能在失败前已记录声明——因此变更字段从它派生而非硬编码 none，未知结果由一次绑定 STATUS 重查证明或证伪，且从不改变失败结果。
					const declarationFailureReport = nativeOperationFailure("jero_review_capture", declarationError);
					let declarationMutationPerformed = declarationFailureReport.mutation_performed === true;
					let declarationMutationOutcome: "none" | "unknown" | "committed" = declarationFailureReport.mutation_outcome === "committed" ? "committed" : declarationFailureReport.mutation_outcome === "unknown" ? "unknown" : "none";
					if (declarationMutationOutcome === "unknown") {
						try {
							const status = await reconcileUnknownReviewLastEventCapture(nativeReviewCli, cwd, binding, route === undefined ? { agent: REVIEW_HOST_AGENT } : { ...route, agent: REVIEW_HOST_AGENT });
							syncRetainedNativeStatusSelections(selections, cwd, status, route?.baseRef);
							const stop = status.nextTransition?.kind === "stop" && status.nextTransition.reasonCode === "unachievable_lens_slot" ? status.nextTransition : undefined;
							const declaredSlot = stop?.unachievableLensSlots?.find((candidate) => candidate.lens === slot.lens && String(candidate.selectedOrder) === slot.order && candidate.subjectHash === declarationBinding.requestHash && candidate.withdraw.binding.targetIdentity === declarationBinding.targetIdentity && candidate.withdraw.binding.lineageId === declarationBinding.lineageId && candidate.withdraw.binding.revision === declarationBinding.expectedRevision);
							if (stop !== undefined && declaredSlot !== undefined) {
								declarationMutationPerformed = true;
								declarationMutationOutcome = "committed";
							}
						} catch {
							// 没有证明，变更保持未知；声明失败已是上报的结果。
						}
					}
					return {
						tool: "jero_review_capture",
						status: "blocked",
						outcome: "unachievable-lens-declaration-failed",
						reason: error.message,
						failure: reviewHostRelayFailureReport(error),
						declaration_failure: declarationFailureReport,
						mutation_performed: declarationMutationPerformed,
						mutation_outcome: declarationMutationOutcome,
						next_action: REVIEW_HOST_RELAY_DECLARATION_FAILED_ACTION,
					};
					}
			}
			if (declared !== undefined) {
				const declaration = { lens: declared.lens, selected_order: declared.selectedOrder, subject_hash: declarationBinding.requestHash, reason: declared.reason };
				try {
					const status = await reconcileUnknownReviewLastEventCapture(nativeReviewCli, cwd, binding, route === undefined ? { agent: REVIEW_HOST_AGENT } : { ...route, agent: REVIEW_HOST_AGENT });
					syncRetainedNativeStatusSelections(selections, cwd, status, route?.baseRef);
					const stop = status.nextTransition?.kind === "stop" && status.nextTransition.reasonCode === "unachievable_lens_slot" ? status.nextTransition : undefined;
					// gentle-pi#822：stop 也可能携带其他运行声明的槽位，因此只暴露与本会话刚声明的身份匹配的条目。有槽位但无匹配条目的 stop 是对账失败，绝不是渲染别人 withdraw 命令的成功。
					const declaredSlot = stop?.unachievableLensSlots?.find((slot) => slot.lens === declaration.lens && slot.selectedOrder === declaration.selected_order && slot.subjectHash === declaration.subject_hash && slot.withdraw.binding.targetIdentity === declarationBinding.targetIdentity && slot.withdraw.binding.lineageId === declarationBinding.lineageId && slot.withdraw.binding.revision === declarationBinding.expectedRevision);
					// gentle-pi#822：成功是被证明的，绝非假设——一个完全没有 unachievable_lens_slot stop 的 STATUS（无 transition、别的 reason code，或 collect 重新提供）与条目不匹配声明身份的 stop 一样，都是对账失败。
					if (declaredSlot === undefined) {
						return {
							tool: "jero_review_capture",
							status: "blocked",
							outcome: "unachievable-lens-declaration-reconciliation-failed",
							reason: error.message,
							failure: reviewHostRelayFailureReport(error),
							declaration,
							reconciliation_failure: { operation: "jero_review_capture", status: "blocked", outcome: "unachievable-lens-slot-declaration-unmatched", reason: stop === undefined ? "the bound STATUS did not return the unachievable_lens_slot stop" : "no unachievable_lens_slots entry matches the declared slot identity", declared_slot: { lens: declaration.lens, selected_order: declaration.selected_order, subject_hash: declaration.subject_hash }, mutation_performed: true, mutation_outcome: "committed" },
							mutation_performed: true,
							mutation_outcome: "committed",
							next_action: REVIEW_HOST_RELAY_DECLARATION_FAILED_ACTION,
						};
					}
					return {
						tool: "jero_review_capture",
						status: "blocked",
						outcome: "unachievable-lens-slot-declared",
						reason: error.message,
						failure: reviewHostRelayFailureReport(error),
						declaration,
						provider_action: status.action,
						...(status.nextTransition === undefined ? {} : { next_transition: status.nextTransition }),
						unachievable_lens_slots: [{ lens: declaredSlot.lens, selected_order: declaredSlot.selectedOrder, subject_hash: declaredSlot.subjectHash, reason: declaredSlot.reason, ...(declaredSlot.detail === undefined ? {} : { detail: declaredSlot.detail }), withdraw: declaredSlot.withdraw.command }],
						result: status.raw,
						next_action: REVIEW_HOST_RELAY_UNACHIEVABLE_ACTION,
						mutation_performed: true,
						mutation_outcome: "committed",
					};
				} catch (statusError) {
					return {
						tool: "jero_review_capture",
						status: "blocked",
						outcome: "unachievable-lens-declaration-reconciliation-failed",
						reason: error.message,
						failure: reviewHostRelayFailureReport(error),
						declaration,
						reconciliation_failure: nativeOperationFailure("jero_review_capture", statusError),
						mutation_performed: true,
						mutation_outcome: "committed",
						next_action: REVIEW_HOST_RELAY_DECLARATION_FAILED_ACTION,
					};
				}
			}
		}
		return {
			tool: "jero_review_capture",
			status: "blocked",
			outcome: error.kind === REVIEW_HOST_RELAY_FAILURE.PI_TIMED_OUT ? "pi-host-relay-timeout" : "pi-host-relay-transport-failure",
			failure: reviewHostRelayFailureReport(error),
			reason: error.message,
			mutation_performed: false,
			mutation_outcome: "none",
			next_action: error.kind === REVIEW_HOST_RELAY_FAILURE.PI_TIMED_OUT
				? reviewHostRelayTimeoutNextAction(error)
				: error.kind === REVIEW_HOST_RELAY_FAILURE.SUBMISSION_REFUSED
					? REVIEW_HOST_RELAY_REFUSED_ACTION
					: REVIEW_HOST_RELAY_RETRY_ACTION,
		};
	}
}

const REVIEW_PROVIDER_ROLE_RETRY_ACTION =
	"Call fresh STATUS and execute only the exact one-slot role vector it reoffers; never relaunch from transcript inference.";

// gentle-pi#638：从一个 materialize 槽位自己的 provider 签发 token 重新派生 capture-unachievable 声明绑定。provider 将这些 token 渲染为 `--name=value` 对（review-host-relay.ts 的 renderToken），Go 在记录前用冻结权威校验每个值，因此缺失必需值或 subject hash 就意味着该槽位无法声明，调用方保持其回退行为。
function unachievableSlotDeclarationBinding(slot: ReviewHostRelaySlot): { lineageId: string; targetIdentity: string; expectedRevision: string; requestHash: string; repositoryContext?: string } | undefined {
	const tokenValue = (name: string): string | undefined => {
		const prefix = `--${name}=`;
		const token = slot.captureArgumentTokens.find((candidate) => candidate.startsWith(prefix));
		return token === undefined ? undefined : token.slice(prefix.length);
	};
	const lineageId = tokenValue("lineage");
	const targetIdentity = tokenValue("target");
	const expectedRevision = tokenValue("expected-revision");
	const repositoryContext = tokenValue("repository-context");
	if (lineageId === undefined || targetIdentity === undefined || expectedRevision === undefined || slot.subjectHash === undefined) return undefined;
	return { lineageId, targetIdentity, expectedRevision, requestHash: slot.subjectHash, ...(repositoryContext === undefined ? {} : { repositoryContext }) };
}

export async function executeProviderRoleVectorCapture(
	slot: ReviewProviderRoleVectorSlot,
	nativeReviewCli: NativeReviewCli,
	cwd: string,
	binding: ReviewLastEventClosureBinding,
	selections: Map<string, RetainedNativeStatusSelection>,
	route: RetainedNativeCaptureRoute | undefined,
	signal?: AbortSignal,
): Promise<Record<string, unknown>> {
	if (nativeReviewCli.captureProviderRole === undefined) {
		return {
			tool: "jero_review_capture",
			status: "blocked",
			outcome: "provider-role-capture-unsupported",
			reason: "The provider issued a self-contained role capture vector, but this runtime has no native provider-role capture surface.",
			mutation_performed: false,
			mutation_outcome: "none",
		};
	}
	try {
		const artifact = await nativeReviewCli.captureProviderRole({
			captureOperation: slot.captureOperation,
			argumentTokens: slot.argumentTokens,
			cwd,
			...(signal === undefined ? {} : { signal }),
		});
		if ("operation" in artifact) return mapAndClearLastEventClosure(artifact, binding, selections, cwd);
		return {
			tool: "jero_review_capture",
			status: "captured",
			outcome: "native-provider-role-captured",
			lineage_id: artifact.lineageId,
			provider_role: {
				transport: "go_owned_pi_process",
				capture_operation: slot.captureOperation,
				role: artifact.role,
				target_identity: artifact.targetIdentity,
				captured: artifact.captured,
			},
		};
	} catch (error) {
		const outcome = await reconcileUnknownReviewCaptureFailure(error, nativeReviewCli, cwd, binding, selections, route);
		return {
			...outcome,
			...(outcome.status === "reconciled" ? {} : { retry_discipline: REVIEW_PROVIDER_ROLE_RETRY_ACTION }),
		};
	}
}

// 仍在等待评审者结果的 provider 命名镜头：每个待定
// `review.capture-result` collect 输入对应一个镜头，按 provider 顺序。
export function pendingReviewerLenses(status: ReviewStatusV3): readonly string[] {
	if (status.nextTransition?.kind !== "collect") return [];
	return [...new Set((status.nextTransition.collect?.inputs ?? [])
		.filter((input) => input.captureOperation === "review.capture-result")
		.map((input) => input.artifactSubject?.lens)
		.filter((lens): lens is NonNullable<typeof lens> => lens !== undefined))];
}

// 现场缺陷（2026-08-16，Engram #12461）：由原生
// `review recover` 创建的后继 lineage 只存在于原生权威中——本控制器
// 从未见过它的 START，因此直接评审者派发以
// current-binding-missing 拒绝，尽管控制器自己刚解码过
// 后继者的权威 STATUS。从 STATUS 发现中镜像 START 时注册：
// 当一个未知但存活、仍在收集
// 评审者结果的 lineage 出现在本控制器解码的 status 中时，从原生
// descriptor 恢复其冻结投影，并用 provider 命名的待定镜头绑定面向
// 派发的当前候选视图。
//
// 现场报告（2026-08-16，gentle-pi 402f9f77）：水合必须从
// 每一条解码权威 status 的通道运行，而不只是从 STATUS
// 操作——报告的流程是 `finalize`（阻塞于
// review.capture-result）随后一次评审者派发，从未经过
// STATUS。它也绝不让调用方失败：STATUS 与被阻塞的
// FINALIZE 封套保持只读，结果被返回，让调用方
// 上报而不是吞掉。
// 现场缺陷（2026-08-16，第三份报告）：Pi 宿主中继从未为真实
// lineage 运行过。对照活的 2.4.0-main provider 做忠实
// 复现测量——无 agent 的 `review status` 返回裸 capture-result
// collect 输入（lineage、expected-revision、target、repository-context、
// lens、order、subject-hash），而同一 status 加 `--agent pi` 会额外
// 携带 agent=pi、materialize=true 和 provider 提交。适配器
// 从未指明其 agent，因此 reviewHostRelaySlots() 看到零个 materialize
// 槽位，中继不可达，没有任何镜头被启动。
//
// agent 是被探测的，绝非假设。锁定的 provider 自
// v2.4.0 起定义 `--agent`——v2.2.3 在 `review status` 上根本没有定义它并
// 直接拒绝——但 Pi 依然从不嗅探版本：已安装的二进制仍是
// 该 flag 是否存在的唯一权威。带类型的拒绝按
