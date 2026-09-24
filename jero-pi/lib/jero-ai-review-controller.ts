// jero-ai 评审控制器执行域：executeReviewControllerOperation——全部原生评审操作的分派与编排。
// 自 extensions/jero-ai.ts 拆分（机械平移，语义零改动）。

import { randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { type ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	canonicalHash, createReviewState, JOURNAL_STATUS, REVIEW_OPERATION, type ReviewReducerInput,
	ReviewTransactionStore, type StartOperationResultV1
} from "./review-transaction.ts";
import { captureReviewSnapshot, REVIEW_MODE } from "./review-snapshot.ts";
import { CandidateViewError, CandidateViewRegistry, resolveCanonicalCandidateBase } from "./review-candidate-view.ts";
import {
	isCanonicalProcessString, type NativeIntendedUntrackedSelectionSubmission,
	type NativeReviewAcknowledgeApprovedOutcome, type NativeReviewCli,
	NativeReviewConsentRequiredError, nativeReviewRecoverAuthorization, type NativeStartResult
} from "./authority/client-contract.ts";
import { NATIVE_REVIEW_OUTCOME } from "./review-risk-assessment.ts";
import { assertReviewApprovedAcknowledgementExecuteV1, type ReviewStatusV3 } from "./authority/wire-contract.ts";
import { GRAPH_V1_ORDINARY_READ_ONLY } from "./jero-ai-package-assets.ts";
import { recordNativeReviewOutcome, resolveReviewAssessmentPlan } from "./jero-ai-rdd-status.ts";
import {
	asNativeReviewCliError, executeNativeAuthorityMaintenance, executeNativeRecoveryRoute,
	isReviewTransition, mapNativeTargetStatus, NATIVE_RECOVERY_INPUT, nativeMaintenanceOperation,
	type NativeReviewAcknowledgementCli, nativeStartPreAuthorityRejection, nativeStatusFailed,
	nativeStatusUnsupported, parseControllerJson, parseReviewAssessInput,
	parseReviewControllerParameters, parseStartInput, readRepositoryControllerInput,
	requiredControllerString, resolveReviewModeGate, REVIEW_CONTROLLER_OPERATION,
	type ReviewControllerParameters
} from "./jero-ai-review-params.ts";
import {
	assertNativeStartCandidateBinding, cleanupPendingReviewConsent,
	consentBindingRepositoryMismatchOutcome, consumePendingReviewConsent,
	discardPendingReviewConsent, expirePendingReviewConsent, isNativeStartFocus,
	NATIVE_START_UNTRACKED_SCOPE, type NativeStartPolicyValidation, nativeStartRejection,
	type NativeStartUntrackedSelection, nativeStatusInputRejection, offeredCommittedRangeBaseRef,
	PENDING_REVIEW_CONSENT_DISPOSITION, PENDING_REVIEW_CONSENT_TTL_MS, type PendingReviewConsent,
	PendingReviewConsentRegistry, pendingReviewConsentSessionKey,
	processPendingReviewConsentRegistry, pruneExpiredReviewConsents,
	type RetainedNativeStatusSelection, reviewConsentDigest, staleConsentBindingDiagnostics,
	staleConsentBindingOutcome, validateNativeStartPolicyPath, validateNativeStartUntrackedSelection
} from "./jero-ai-review-consent.ts";
import {
	clearRetainedNativeStatusSelectionsOnTerminal, clearRetainedNativeUntrackedSelection,
	cloneRetainedNativeUntrackedSelection, completeNativeStart, deferredPostBurnCleanup,
	nativeMutationRequiresStatus, nativeOperationFailure, nativePreLineageCandidateIdentity,
	POST_BURN_CLEANUP, readRetainedNativeUntrackedSelection,
	readRetainedPreLineageNativeUntrackedSelection, reconcileNativeMutationFailure,
	resolveReviewControllerWorkspaceRoot,
	retainNativeCaptureRoutes, retainNativeUntrackedSelection, sameNativePreLineageCandidate
} from "./jero-ai-review-native-ops.ts";
import { hostTransportUnavailable, negotiatedStatusForHostTransport } from "./jero-ai-review-transport.ts";
import {
	canonicalReviewCaptureBinding, exactCollectArgument, hydrateDispatchBindingFromStatus,
	INSPECT_UNTRACKED_SELECTION_NEXT_STEP, parseCanonicalReviewCaptureBinding,
	reviewIntendedUntrackedInput
} from "./jero-ai-review-select.ts";
export async function executeReviewControllerOperation(
	parametersValue: unknown,
	sessionCwd: string,
	nativeReviewCli: NativeReviewCli | null,
	signal?: AbortSignal,
	candidateViews: CandidateViewRegistry | null = new CandidateViewRegistry(),
	context?: ExtensionContext,
	retainedUntrackedSelections: Map<string, RetainedNativeStatusSelection> = new Map(),
	pendingReviewConsentRegistry: PendingReviewConsentRegistry = processPendingReviewConsentRegistry,
	pendingReviewConsentFallbackKey: symbol = Symbol("pending-review-consent-fallback"),
	reviewConsentNow: () => number = Date.now,
	reviewConsentScheduleTimer: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout> = setTimeout,
	intendedUntrackedSelection?: NativeIntendedUntrackedSelectionSubmission,
): Promise<Record<string, unknown>> {
	const parameters = parseReviewControllerParameters(parametersValue);
	const defaultCwd = resolveReviewControllerWorkspaceRoot(parameters.workspaceRoot, sessionCwd, candidateViews, parameters.lineageId);
	const pendingReviewConsentSession = pendingReviewConsentSessionKey(context, pendingReviewConsentFallbackKey);
	const includeWorkspaceRoot = parameters.workspaceRoot !== undefined || defaultCwd !== sessionCwd;
	if (parameters.operation === REVIEW_CONTROLLER_OPERATION.EXPORT || parameters.operation === REVIEW_CONTROLLER_OPERATION.IMPORT) {
		// 旧式 bundle 传输依附于已退役的集成前 graph/compact
		// 存储。原生 v2.1.11 CLI 未暴露 bundle 等价物，因此两个
		// 操作都返回结构化的退役封套；枚举成员被
		// 保留，使工具 schema 对既有调用方保持稳定。
		return {
			operation: parameters.operation,
			status: "blocked",
			outcome: "legacy-operation-retired",
			reason: "Legacy review bundle transport (export/import) was retired together with the pre-integration graph/compact stores; no bundle equivalent exists.",
			mutation_performed: false,
			mutation_outcome: "none",
			next_action: "There is no bundle transport and no external CLI. Review state lives in the in-process authority store under .git/jero-review/ and travels with the repository through normal Git replication; use the jero_review operations (inspect/status/start/finalize/validate and the audited maintenance operations) to work with it.",
		};
	}
	if (parameters.operation === REVIEW_CONTROLLER_OPERATION.ASSESS) {
		// 只读原生风险评估（gentle-ai#4295，gentle-pi#662）。从不
		// 变更，从不要求 lineageId，也从不经过
		// authorizeDestructiveReviewOperation（它对任何既非
		// RESET 也非维护操作的 operation 都提前返回）。
		const input = parseReviewAssessInput(parameters.operation, parameters.input);
		const details = await resolveReviewAssessmentPlan(nativeReviewCli, defaultCwd, input, signal);
		return { operation: parameters.operation, ...details, ...(includeWorkspaceRoot ? { workspace_root: defaultCwd } : {}) };
	}
	const maintenance = nativeMaintenanceOperation(parameters.operation);
	if (maintenance !== undefined) {
		const input = parseControllerJson(requiredControllerString(parameters, "input"), parameters.operation);
		return await executeNativeAuthorityMaintenance(parameters.operation, maintenance, input, defaultCwd, nativeReviewCli, signal);
	}
	if (
		parameters.operation === REVIEW_CONTROLLER_OPERATION.INSPECT &&
		nativeReviewCli !== null
	) {
		// 新的 inspect 在其第一次 STATUS 尝试之前取代所有
		// pre-lineage 选择。失败或候选已变的 inspect 不能把
		// 更早的选择留给后续 START 使用。
		clearRetainedNativeUntrackedSelection(retainedUntrackedSelections, defaultCwd, "");
		try {
			if (nativeReviewCli.targetStatus !== undefined) {
				const negotiated = await negotiatedStatusForHostTransport(
					nativeReviewCli,
					{
						cwd: defaultCwd,
						...(signal === undefined ? {} : { signal }),
					},
					retainedUntrackedSelections,
					defaultCwd,
				);
				if (negotiated.transport !== undefined) {
					return {
						...hostTransportUnavailable(parameters.operation, negotiated.transport),
						...(includeWorkspaceRoot ? { workspace_root: defaultCwd } : {}),
					};
				}
				const status = negotiated.status!;
				const plainMapped = mapNativeTargetStatus(
					parameters.operation,
					status,
					undefined,
				);
				if (parameters.untrackedScope === undefined) {
					// gentle-pi#706：stop 本身从不告诉调用方下一步做什么。
					return {
						...plainMapped,
						...("selectionBinding" in plainMapped
							? { nextStep: INSPECT_UNTRACKED_SELECTION_NEXT_STEP }
							: {}),
						...(includeWorkspaceRoot ? { workspace_root: defaultCwd } : {}),
					};
				}
				const input = reviewIntendedUntrackedInput(status);
				if (input === undefined)
					return {
						...plainMapped,
						untracked_selection: "not-required",
						...(includeWorkspaceRoot ? { workspace_root: defaultCwd } : {}),
					};
				const eligibleJson = exactCollectArgument(input, "eligible_paths_json"),
					inventory = exactCollectArgument(input, "expected_untracked_inventory");
				let eligible: unknown;
				try {
					eligible = JSON.parse(eligibleJson ?? "");
				} catch {
					eligible = undefined;
				}
				const selected = validateNativeStartUntrackedSelection({
					untrackedScope: parameters.untrackedScope,
					expectedUntrackedInventory: inventory,
					intendedUntracked: parameters.intendedUntracked,
				});
				if (
					!Array.isArray(eligible) ||
					selected.reason !== undefined ||
					selected.intendedUntracked!.some((path) => !eligible.includes(path))
				) {
					return {
						operation: parameters.operation,
						status: "blocked",
						outcome: "inspect-untracked-scope-invalid",
						reason:
							"The requested untrackedScope/intendedUntracked combination is invalid for the current intended-untracked stop: paths must be members of the eligible inventory, exclude selects none, and select selects at least one.",
						mutation_performed: false,
						mutation_outcome: "none",
					};
				}
				const submission: NativeIntendedUntrackedSelectionSubmission = {
					argumentTokens: input.submission!.argumentTokens,
					value: JSON.stringify({
						schema: "gentle-ai.review-intended-untracked-selection/v1",
						untracked_scope: parameters.untrackedScope,
						expected_untracked_inventory: inventory,
						intended_untracked: selected.intendedUntracked,
					}),
				};
				const resolved = await negotiatedStatusForHostTransport(
					nativeReviewCli,
					{
						cwd: defaultCwd,
						untrackedScope: parameters.untrackedScope,
						expectedUntrackedInventory: inventory,
						intendedUntracked: selected.intendedUntracked,
						intendedUntrackedSelection: submission,
						...(signal === undefined ? {} : { signal }),
					},
					retainedUntrackedSelections,
					defaultCwd,
				);
				if (resolved.transport !== undefined) {
					return {
						...hostTransportUnavailable(parameters.operation, resolved.transport),
						...(includeWorkspaceRoot ? { workspace_root: defaultCwd } : {}),
					};
				}
				const resolvedStatus = resolved.status!;
				const candidateIdentity = nativePreLineageCandidateIdentity(resolvedStatus);
				if (candidateIdentity !== undefined) {
					retainNativeUntrackedSelection(
						retainedUntrackedSelections,
						defaultCwd,
						"",
						Object.freeze({
							untrackedScope: parameters.untrackedScope,
							expectedUntrackedInventory: inventory!,
							intendedUntracked: Object.freeze([...selected.intendedUntracked!]),
							submission,
							...candidateIdentity,
						}),
					);
				}
				const resolvedMapped = mapNativeTargetStatus(
					parameters.operation,
					resolvedStatus,
					undefined,
				);
				return {
					...resolvedMapped,
					...("selectionBinding" in resolvedMapped
						? { nextStep: INSPECT_UNTRACKED_SELECTION_NEXT_STEP }
						: {}),
					...(includeWorkspaceRoot ? { workspace_root: defaultCwd } : {}),
				};
			}
			return nativeStatusUnsupported(parameters.operation);
		} catch (error) {
			return nativeStatusFailed(parameters.operation, error);
		}
	}
	if (parameters.operation === REVIEW_CONTROLLER_OPERATION.INSPECT) {
		return nativeStatusUnsupported(parameters.operation);
	}

	if (parameters.operation === REVIEW_CONTROLLER_OPERATION.RECOVER_LOCK) {
		const input = parseControllerJson(requiredControllerString(parameters, "input"), parameters.operation);
		if (typeof input.ownerHash !== "string") throw new Error("Lock recovery requires an exact ownerHash");
		// 卡死的旧式变更锁是一个不完整的在途条目；其
		// 移除归已审计的原生隔离所有。锁恢复不是
		// 破坏性的权威重置，因此待定授权得以保留。
		return await executeNativeRecoveryRoute(parameters.operation, "reclaim", input, defaultCwd, nativeReviewCli, signal);
	}
	if (parameters.operation === REVIEW_CONTROLLER_OPERATION.RECOVER) {
		const input = parseControllerJson(requiredControllerString(parameters, "input"), parameters.operation);
		// 授权绑定由 Pi 派生，绝不由调用方携带。它被
		// 原样记录为维护者证明，因此接受一个由
		// 调用方拼写的绑定会让未经批准的执行者为恢复边签名。
		if (input.maintainerAuthorization !== undefined) {
			return {
				operation: parameters.operation,
				status: "blocked",
				outcome: "native-recovery-caller-authorization-rejected",
				native_operation: "review recover",
				mutation_performed: false,
				mutation_outcome: "none",
				next_action: "resubmit-without-maintainer-authorization",
			};
		}
		const missing = NATIVE_RECOVERY_INPUT.recover.filter((key) =>
			key === "disposition"
				? !["scope_changed", "invalidated", "escalated"].includes(input[key] as string)
				: !isCanonicalProcessString(input[key]),
		);
		if (missing.length > 0) return await executeNativeRecoveryRoute(parameters.operation, "recover", input, defaultCwd, nativeReviewCli, signal);
		if (nativeReviewCli?.targetStatus === undefined) return nativeStatusUnsupported(parameters.operation);
		const frozenTarget = candidateViews?.hasProjection(String(input.predecessorLineage), defaultCwd)
			? candidateViews.resolveProjection(String(input.predecessorLineage), defaultCwd)
			: undefined;
		const statusRequest = {
			cwd: defaultCwd,
			lineageId: String(input.predecessorLineage),
			...(frozenTarget?.committedOnly === true ? { baseRef: frozenTarget.baseCommit, committedOnly: true } : {}),
			...(signal === undefined ? {} : { signal }),
		};
		let status: ReviewStatusV3;
		try {
			status = await nativeReviewCli.targetStatus(statusRequest);
		} catch (error) {
			return nativeStatusFailed(parameters.operation, error);
		}
		const pinnedRecoveryStatus = (candidate: ReviewStatusV3): boolean =>
			candidate.action === "recover"
			&& candidate.actionDisposition === status.actionDisposition
			&& candidate.authority?.lineageId === input.predecessorLineage
			&& candidate.authority?.revision === input.expectedPredecessorRevision
			&& candidate.targetIdentity === status.targetIdentity;
		if (status.action !== "recover" || status.actionDisposition === undefined || status.authority?.lineageId !== input.predecessorLineage || status.authority.revision !== input.expectedPredecessorRevision || !isCanonicalProcessString(status.targetIdentity)) {
			return { operation: parameters.operation, status: "blocked", outcome: "native-recovery-status-mismatch", mutation_performed: false, mutation_outcome: "none", result: status.raw, next_action: "follow-provider-target-status" };
		}
		if (input.disposition !== status.actionDisposition) {
			return { operation: parameters.operation, status: "blocked", outcome: "native-recovery-disposition-mismatch", mutation_performed: false, mutation_outcome: "none", provider_disposition: status.actionDisposition, next_action: "resubmit-with-provider-disposition" };
		}
		const recoverAuthorization = nativeReviewRecoverAuthorization({
			predecessorLineage: String(input.predecessorLineage),
			expectedPredecessorRevision: String(input.expectedPredecessorRevision),
			targetIdentity: status.targetIdentity,
			actor: String(input.actor),
			reason: String(input.reason),
		});
		if (context?.hasUI !== true) throw new Error("Review controller RECOVER requires fresh explicit authorization through the interactive Pi UI; headless execution fails closed");
		const approved = await context.ui.confirm(
			"Authorize destructive review authority RECOVER?",
			[
				"Operation: RECOVER",
				`Provider-selected disposition: ${status.actionDisposition}`,
				"Exact published authorization binding:",
				recoverAuthorization,
				`The native command creates one auditable successor authority (${String(input.successorLineage)}) for this exact predecessor and target identity; the predecessor stays untouched.`,
			].join("\n"),
		);
		if (!approved) throw new Error("Review controller RECOVER was not explicitly authorized");
		// 检查时到使用时：人类可以不受限制地
		// 思考，在此期间权威可能前进、被别人恢复，或
		// 不再符合恢复条件。批准与派生
		// 绑定都钉在批准前的读取上，因此在任何变更
		// 之前会再读一次权威，且必须仍与之精确匹配。
		let confirmedStatus: ReviewStatusV3;
		try {
			confirmedStatus = await nativeReviewCli.targetStatus(statusRequest);
		} catch (error) {
			return nativeStatusFailed(parameters.operation, error);
		}
		if (!pinnedRecoveryStatus(confirmedStatus)) {
			return {
				operation: parameters.operation,
				status: "blocked",
				outcome: "native-recovery-authority-changed",
				native_operation: "review recover",
				mutation_performed: false,
				mutation_outcome: "none",
				result: confirmedStatus.raw,
				next_action: "reinspect-and-reauthorize-recovery",
			};
		}
		return await executeNativeRecoveryRoute(parameters.operation, "recover", { ...input, disposition: status.actionDisposition, maintainerAuthorization: recoverAuthorization }, defaultCwd, nativeReviewCli, signal);
	}
	if (parameters.operation === REVIEW_CONTROLLER_OPERATION.RESET) {
		const input = parseControllerJson(requiredControllerString(parameters, "input"), parameters.operation);
		return await executeNativeRecoveryRoute(parameters.operation, "reclaim", input, defaultCwd, nativeReviewCli, signal);
	}
	if (parameters.operation === REVIEW_CONTROLLER_OPERATION.REPAIR) {
		if (nativeReviewCli?.targetStatus === undefined) return nativeStatusUnsupported(parameters.operation);
		const frozenTarget = parameters.lineageId === undefined || !candidateViews?.hasProjection(parameters.lineageId, defaultCwd) ? undefined : candidateViews.resolveProjection(parameters.lineageId, defaultCwd);
		let status: ReviewStatusV3;
		try {
			status = await nativeReviewCli.targetStatus({ cwd: defaultCwd, ...(parameters.lineageId === undefined ? {} : { lineageId: parameters.lineageId }), ...(frozenTarget?.committedOnly === true ? { baseRef: frozenTarget.baseCommit, committedOnly: true } : {}), ...(signal === undefined ? {} : { signal }) });
		} catch (error) {
			return nativeStatusFailed(parameters.operation, error);
		}
		clearRetainedNativeStatusSelectionsOnTerminal(retainedUntrackedSelections, defaultCwd, status.authority?.lineageId, status.authority?.state); retainNativeCaptureRoutes(retainedUntrackedSelections, defaultCwd, status, frozenTarget?.committedOnly === true ? frozenTarget.baseCommit : undefined);
		if (status.authority?.version === "compact-v2") return { operation: parameters.operation, repaired: false, compact_authority: "immutable-untouched", status: mapNativeTargetStatus(parameters.operation, status, parameters.lineageId) };
		if (status.authority?.version !== "legacy-v1") return mapNativeTargetStatus(parameters.operation, status, parameters.lineageId);
		const store = ReviewTransactionStore.forRepository(defaultCwd);
		store.repairCurrentAuthority();
		return { operation: parameters.operation, repaired: true };
	}
	if (parameters.operation === REVIEW_CONTROLLER_OPERATION.ACKNOWLEDGE_APPROVED) {
		const controllerOnlyInput = ["changeName", "idempotencyKey", "transition", "input", "outputPath", "inputPath", "operationId", "lineageIds", "acknowledgeUntrustedBundleSource"]
			.find((key) => parameters[key as keyof ReviewControllerParameters] !== undefined);
		if (controllerOnlyInput !== undefined || !isCanonicalProcessString(parameters.lineageId)) {
			return {
				operation: parameters.operation,
				status: "blocked",
				outcome: "native-approved-acknowledgement-input-invalid",
				reason: controllerOnlyInput === undefined ? "lineage-invalid" : "controller-only-input",
				...(controllerOnlyInput === undefined ? {} : { field: controllerOnlyInput }),
				mutation_performed: false,
				mutation_outcome: "none",
				next_action: "resubmit-the-exact-lineage-without-controller-only-input",
			};
		}
		const acknowledgementCli = nativeReviewCli as NativeReviewAcknowledgementCli | null;
		if (acknowledgementCli?.targetStatus === undefined) return nativeStatusUnsupported(parameters.operation);
		if (acknowledgementCli.acknowledgeApproved === undefined) {
			return {
				operation: parameters.operation,
				status: "blocked",
				outcome: "native-approved-acknowledgement-unsupported",
				mutation_performed: false,
				mutation_outcome: "none",
				next_action: "install-native-acknowledge-approved-support",
			};
		}
		const frozenTarget = candidateViews?.hasProjection(parameters.lineageId, defaultCwd)
			? candidateViews.resolveProjection(parameters.lineageId, defaultCwd)
			: undefined;
		const target = {
			cwd: defaultCwd,
			lineageId: parameters.lineageId,
			...(frozenTarget?.committedOnly === true ? { baseRef: frozenTarget.baseCommit, committedOnly: true } : {}),
			...readRetainedNativeUntrackedSelection(retainedUntrackedSelections, defaultCwd, parameters.lineageId),
			...(signal === undefined ? {} : { signal }),
		};
		let status: ReviewStatusV3;
		try {
			status = await acknowledgementCli.targetStatus(target);
		} catch (error) {
			return nativeStatusFailed(parameters.operation, error);
		}
		const execute = status.nextTransition?.kind === "execute" ? status.nextTransition.execute : undefined;
		if (
			status.applicability !== "current_target" ||
			status.authority?.lineageId !== parameters.lineageId ||
			status.authority.state !== "approved" ||
			execute?.operation !== "review.acknowledge-approved"
		) {
			return {
				operation: parameters.operation,
				status: "blocked",
				outcome: "native-approved-acknowledgement-not-current",
				result: status.raw,
				mutation_performed: false,
				mutation_outcome: "none",
				next_action: "follow-provider-target-status",
			};
		}
		let argumentTokens: readonly string[];
		try {
			argumentTokens = assertReviewApprovedAcknowledgementExecuteV1(execute, {
				cwd: defaultCwd,
				lineageId: parameters.lineageId,
				targetIdentity: status.targetIdentity,
				revision: status.authority.revision,
			});
		} catch (error) {
			return nativeOperationFailure(parameters.operation, error);
		}
		let acknowledged: NativeReviewAcknowledgeApprovedOutcome | undefined;
		try {
			// gentle-ai #3947：销毁操作以一个绑定到确切
			// lineage、目标与 revision 的 review-acknowledged/v1
			// 封套作答，销毁结果从该封套报告，绝不来自
			// 之后的 STATUS。截至 v2.5.0-rc.3 的每个已发布版本仍
			// 静默销毁，该结果保持逐字节不变。
			// acknowledgeApproved 以 void 表示"静默销毁、无封套"，在此统一为 undefined。
			acknowledged = (await acknowledgementCli.acknowledgeApproved({
				argumentTokens,
				cwd: defaultCwd,
				binding: { lineageId: parameters.lineageId, targetIdentity: status.targetIdentity, revision: status.authority.revision },
				...(signal === undefined ? {} : { signal }),
			})) as NativeReviewAcknowledgeApprovedOutcome | undefined;
		} catch (error) {
			if (!nativeMutationRequiresStatus(error)) return nativeOperationFailure(parameters.operation, error);
			return await reconcileNativeMutationFailure(parameters.operation, error, acknowledgementCli, target, retainedUntrackedSelections);
		}
		// gentle-ai#4003：从这里开始，原生销毁就是已提交的权威
		// 结果。两个 Pi 侧拆除步骤都在变更结果的
		// try/catch 之外运行且各自设防，因此清理失败被
		// 报告为延迟清理，绝不会被报告为失败的确认——
		// 那会诱使对一个已销毁操作的重放。
		const retainedSelectionCleanup = deferredPostBurnCleanup(POST_BURN_CLEANUP.retainedSelection, () => clearRetainedNativeUntrackedSelection(retainedUntrackedSelections, defaultCwd, parameters.lineageId));
		// 注册表负责在移除前恢复其 0555 视图的
		// 可写性；终态 approved 清理会保留 lineage 投影。
		const candidateViewCleanup = deferredPostBurnCleanup(POST_BURN_CLEANUP.candidateView, () => candidateViews?.cleanupTerminal(parameters.lineageId, "approved", defaultCwd));
		// gentle-pi#668：`closed` 在此从不自动派生或记录——
		// 想要走上该路径的父会话，会在其对这一候选的下一次
		// assess 调用中显式传入 nativeReviewOutcome: "closed"。
		return {
			operation: parameters.operation,
			status: "closed",
			outcome: "native-approved-acknowledgement-completed",
			lineage_id: parameters.lineageId,
			target_identity: status.targetIdentity,
			...(acknowledged === undefined ? {} : { consumed_revision: acknowledged.consumedRevision }),
			authority: "burned",
			...(acknowledged === undefined ? {} : { burn_evidence: acknowledged.schema }),
			delivery: "ordinary-repository-policy",
			mutation_performed: true,
			mutation_outcome: "committed",
			...(retainedSelectionCleanup === undefined ? {} : { retained_selection_cleanup: retainedSelectionCleanup }),
			...(candidateViewCleanup === undefined ? {} : { candidate_view_cleanup: candidateViewCleanup }),
		};
	}
	if (parameters.operation === REVIEW_CONTROLLER_OPERATION.ANSWER_CONSENT) {
		const input = parseControllerJson(requiredControllerString(parameters, "input"), parameters.operation);
		if (Object.keys(input).some((key) => key !== "consentBinding" && key !== "answer") || Object.keys(input).length !== 2) throw new Error("Review controller answer-consent input must contain exactly consentBinding and answer");
		if (typeof input.consentBinding !== "string" || input.consentBinding.length === 0) throw new Error("Review controller answer-consent requires an opaque consentBinding");
		if (input.answer !== "granted" && input.answer !== "declined") throw new Error("Review controller answer-consent answer must be granted or declined");
		// gentle-pi#455：仅凭不透明 id 解析绑定，这样
		// 由某个活跃 Pi 会话的 START 创建的绑定，可由任何
		// 出示它的活跃会话应答——而不只是创建它的会话。
		const resolved = pendingReviewConsentRegistry.resolve(input.consentBinding);
		const pending = resolved?.pending;
		const owningSession = resolved?.sessionKey ?? pendingReviewConsentSession;
		if (pending === undefined || pending.expiresAt <= reviewConsentNow()) {
			const disposition = pending === undefined
				? pendingReviewConsentRegistry.staleDisposition(input.consentBinding)
				: PENDING_REVIEW_CONSENT_DISPOSITION.EXPIRED;
			const stale = staleConsentBindingDiagnostics(input.consentBinding, disposition);
			if (pending !== undefined) expirePendingReviewConsent(pending, pendingReviewConsentRegistry, owningSession);
			if (nativeReviewCli?.targetStatus === undefined) return nativeStatusUnsupported(parameters.operation);
			try {
				const negotiated = await negotiatedStatusForHostTransport(nativeReviewCli, {
					cwd: defaultCwd,
					...(signal === undefined ? {} : { signal }),
				}, retainedUntrackedSelections, defaultCwd);
				if (negotiated.transport !== undefined) return hostTransportUnavailable(parameters.operation, negotiated.transport);
				return staleConsentBindingOutcome(parameters.operation, input.consentBinding, stale, negotiated.status!);
			} catch (error) {
				return nativeStatusFailed(parameters.operation, error);
			}
		}
		const answeringRepositoryCwd = realpathSync(defaultCwd);
		if (answeringRepositoryCwd !== pending.repositoryCwd) return consentBindingRepositoryMismatchOutcome(parameters.operation, input.consentBinding, pending.repositoryCwd, answeringRepositoryCwd);
		if (reviewConsentDigest(pending.consent) !== pending.consentDigest) throw new Error("Review controller consent envelope binding changed");
		pending.verifyCandidate();
		if (nativeReviewCli?.answerConsent === undefined) throw new Error("Native review consent follow-up is unavailable");
		if (!consumePendingReviewConsent(pending, pendingReviewConsentRegistry, owningSession)) {
			const stale = staleConsentBindingDiagnostics(
				input.consentBinding,
				pendingReviewConsentRegistry.staleDisposition(input.consentBinding),
			);
			if (nativeReviewCli.targetStatus === undefined) return nativeStatusUnsupported(parameters.operation);
			try {
				const negotiated = await negotiatedStatusForHostTransport(nativeReviewCli, {
					cwd: defaultCwd,
					...(signal === undefined ? {} : { signal }),
				}, retainedUntrackedSelections, defaultCwd);
				if (negotiated.transport !== undefined) return hostTransportUnavailable(parameters.operation, negotiated.transport);
				return staleConsentBindingOutcome(parameters.operation, input.consentBinding, stale, negotiated.status!);
			} catch (error) {
				return nativeStatusFailed(parameters.operation, error);
			}
		}
		try {
			const gated = await resolveReviewModeGate(nativeReviewCli, parameters.operation, defaultCwd, signal);
			if (gated !== undefined) {
				// gentle-pi#668：模式对该确切候选禁用——按其
				// targetIdentity 键控，绝不仅按仓库。
				recordNativeReviewOutcome(pending.authorityCwd, pending.consent.targetIdentity, NATIVE_REVIEW_OUTCOME.UNAVAILABLE);
				cleanupPendingReviewConsent(pending, pendingReviewConsentRegistry, owningSession);
				return gated;
			}
		} catch (error) {
			cleanupPendingReviewConsent(pending, pendingReviewConsentRegistry, owningSession);
			return nativeOperationFailure(parameters.operation, error);
		}
		// 一次性绑定在应答路径第一个 await 之前就被消耗。任何
		// 模糊的 provider 结果都经 STATUS 对账，且绝不能被重放。
		let completed: Record<string, unknown>;
		try {
			const answered = await nativeReviewCli.answerConsent({
				cwd: pending.authorityCwd,
				consent: pending.consent,
				answer: input.answer,
				...(signal === undefined ? {} : { signal }),
			});
			if (answered.kind === "declined") {
				// gentle-pi#668：候选范围的拒绝，按该确切
				// 候选的 targetIdentity 键控，绝不仅按仓库。
				recordNativeReviewOutcome(pending.authorityCwd, pending.consent.targetIdentity, NATIVE_REVIEW_OUTCOME.DECLINED);
				pending.cleanupCandidate();
				return {
					operation: parameters.operation,
					status: "skipped",
					outcome: "consent-declined-this-candidate",
					consent: answered.raw,
					...nativeStartPreAuthorityRejection(),
				};
			}
			retainNativeUntrackedSelection(retainedUntrackedSelections, pending.authorityCwd, answered.start.lineageId, pending.untrackedSelection);
			// gentle-pi#706：经 answer-consent 完成的 START 也消耗了
			// 所采纳的 pre-lineage 选择；像直接路径一样清除它。
			clearRetainedNativeUntrackedSelection(retainedUntrackedSelections, pending.authorityCwd, "");
			completed = completeNativeStart(parameters.operation, answered.start, pending.repositoryCwd, pending.candidateView, pending.candidateViews);
		} catch (error) {
			const value = error as { mutationOutcome?: unknown };
			if (value.mutationOutcome === "none") pending.cleanupCandidate();
			return await reconcileNativeMutationFailure(parameters.operation, error, nativeReviewCli, {
				cwd: pending.authorityCwd,
				...(pending.candidateView.committedOnly ? { baseRef: pending.candidateView.baseCommit, committedOnly: true } : {}),
				projection: "workspace",
			}, retainedUntrackedSelections);
		}
		return completed;
	}
	if (parameters.operation === REVIEW_CONTROLLER_OPERATION.SELECT_INTENDED_UNTRACKED) {
		if (nativeReviewCli?.targetStatus === undefined || nativeReviewCli.start === undefined) return nativeStatusUnsupported(parameters.operation);
		const canonicalBinding = parseCanonicalReviewCaptureBinding(parameters.selectionBinding!);
		let status: ReviewStatusV3;
		try {
			const negotiated = await negotiatedStatusForHostTransport(nativeReviewCli, { cwd: defaultCwd, ...(signal === undefined ? {} : { signal }) }, retainedUntrackedSelections, defaultCwd);
			if (negotiated.transport !== undefined) return hostTransportUnavailable(parameters.operation, negotiated.transport);
			status = negotiated.status!;
		} catch (error) { return nativeStatusFailed(parameters.operation, error); }
		const input = reviewIntendedUntrackedInput(status), eligibleJson = input === undefined ? undefined : exactCollectArgument(input, "eligible_paths_json"), inventory = input === undefined ? undefined : exactCollectArgument(input, "expected_untracked_inventory");
		let eligible: unknown;
		try { eligible = JSON.parse(eligibleJson ?? ""); } catch { eligible = undefined; }
		const scope = parameters.intendedUntracked!.length === 0 ? NATIVE_START_UNTRACKED_SCOPE.EXCLUDE : NATIVE_START_UNTRACKED_SCOPE.SELECT;
		const selected = validateNativeStartUntrackedSelection({ untrackedScope: scope, expectedUntrackedInventory: inventory, intendedUntracked: parameters.intendedUntracked });
		const rejected = input === undefined || canonicalReviewCaptureBinding(input) !== canonicalBinding || exactCollectArgument(input, "target_identity") !== status.targetIdentity || exactCollectArgument(input, "projection") !== status.projection.projection || exactCollectArgument(input, "base_tree") !== status.projection.baseTree || exactCollectArgument(input, "candidate_tree") !== status.projection.currentCandidateTree || !Array.isArray(eligible) || selected.reason !== undefined || selected.intendedUntracked!.some((path) => !eligible.includes(path));
		if (rejected) return { operation: parameters.operation, status: "blocked", outcome: "intended-untracked-selection-binding-rejected", mutation_performed: false, mutation_outcome: "none" };
		const submission = { argumentTokens: input.submission!.argumentTokens, value: JSON.stringify({ schema: "gentle-ai.review-intended-untracked-selection/v1", untracked_scope: scope, expected_untracked_inventory: inventory, intended_untracked: selected.intendedUntracked }) };
		const result = await executeReviewControllerOperation({ operation: REVIEW_CONTROLLER_OPERATION.START, ...(parameters.workspaceRoot === undefined ? {} : { workspaceRoot: parameters.workspaceRoot }), input: JSON.stringify({ mode: REVIEW_MODE.ORDINARY, untrackedScope: scope, expectedUntrackedInventory: inventory, intendedUntracked: selected.intendedUntracked }) }, sessionCwd, nativeReviewCli, signal, candidateViews, context, retainedUntrackedSelections, pendingReviewConsentRegistry, pendingReviewConsentFallbackKey, reviewConsentNow, reviewConsentScheduleTimer, submission);
		return { ...result, operation: parameters.operation };
	}
	if (parameters.operation === REVIEW_CONTROLLER_OPERATION.START) {
		const rawStart = parseControllerJson(
			requiredControllerString(parameters, "input"),
			REVIEW_CONTROLLER_OPERATION.START,
		);
		if (rawStart.mode === REVIEW_MODE.ORDINARY) {
			if ("policyHash" in rawStart) return nativeStartRejection("legacy-policy-hash-unsupported");
			const unknownField = Object.keys(rawStart).find((field) => !["mode", "baseRef", "committedOnly", "policyPath", "focus", "untrackedScope", "expectedUntrackedInventory", "intendedUntracked"].includes(field));
			if (unknownField !== undefined) return nativeStartRejection("unknown-field", unknownField);
			const focus = rawStart.focus;
			if (focus !== undefined && !isNativeStartFocus(focus)) return nativeStartRejection("focus-invalid");
			const policy: NativeStartPolicyValidation = rawStart.policyPath === undefined
				? {}
				: validateNativeStartPolicyPath(defaultCwd, rawStart.policyPath);
			if (policy.reason !== undefined) return nativeStartRejection(policy.reason);
			const baseRef = rawStart.baseRef;
			if (baseRef !== undefined && !isCanonicalProcessString(baseRef)) return nativeStartRejection("base-ref-invalid");
			if (baseRef !== undefined && rawStart.committedOnly !== true) return nativeStartRejection("committed-only-required");
			if (baseRef === undefined && "committedOnly" in rawStart) return nativeStartRejection("committed-only-invalid");
			const explicitUntrackedSelection =
				validateNativeStartUntrackedSelection(rawStart);
			if (explicitUntrackedSelection.reason !== undefined)
				return nativeStartRejection(explicitUntrackedSelection.reason);
			// gentle-pi#706：普通 START 采纳由 inspect
			// untrackedScope 往返在 pre-lineage 保留的选择；显式输入或
			// 携带的提交永远优先于保留条目。
			const retainedPreLineageSelection =
				explicitUntrackedSelection.untrackedScope === undefined &&
				intendedUntrackedSelection === undefined
					? readRetainedPreLineageNativeUntrackedSelection(
							retainedUntrackedSelections,
							defaultCwd,
						)
					: undefined;
			const untrackedSelection: NativeStartUntrackedSelection =
				retainedPreLineageSelection === undefined
					? explicitUntrackedSelection
					: {
							untrackedScope: retainedPreLineageSelection.untrackedScope,
							expectedUntrackedInventory:
								retainedPreLineageSelection.expectedUntrackedInventory,
							intendedUntracked: [...retainedPreLineageSelection.intendedUntracked],
						};
			const untrackedSubmission =
				intendedUntrackedSelection ?? retainedPreLineageSelection?.submission;
			const retainedUntrackedSelection =
				retainedPreLineageSelection ??
				cloneRetainedNativeUntrackedSelection(explicitUntrackedSelection);
			let canonicalBaseRef: string | undefined;
			if (baseRef !== undefined) {
				try {
					canonicalBaseRef = resolveCanonicalCandidateBase(defaultCwd, baseRef as string).commit;
				} catch (error) {
					if (error instanceof CandidateViewError && error.diagnostics !== undefined) return nativeOperationFailure(parameters.operation, Object.assign(error, { candidateViewPreNative: true }));
					if (error instanceof CandidateViewError && (error.reason === "base-ref-ambiguous" || error.reason === "base-ref-unresolvable" || error.reason === "base-ref-moved")) return nativeStartRejection(error.reason);
					return nativeStartRejection("base-ref-unresolvable");
				}
			}
			try {
				const gated = await resolveReviewModeGate(nativeReviewCli, parameters.operation, defaultCwd, signal);
				if (gated !== undefined) return gated;
			} catch (error) {
				return nativeOperationFailure(parameters.operation, error);
			}
			if (nativeReviewCli?.targetStatus === undefined) return nativeStatusUnsupported(parameters.operation);
			let target: ReviewStatusV3;
			try {
				const negotiated = await negotiatedStatusForHostTransport(nativeReviewCli, {
					cwd: defaultCwd,
					...(parameters.lineageId === undefined ? {} : { lineageId: parameters.lineageId }),
					...(canonicalBaseRef === undefined ? {} : { baseRef: canonicalBaseRef, committedOnly: true }),
					...(untrackedSelection.untrackedScope === undefined ? {} : untrackedSelection),
					...(untrackedSubmission === undefined ? {} : { intendedUntrackedSelection: untrackedSubmission }),
					...(signal === undefined ? {} : { signal }),
				}, retainedUntrackedSelections, defaultCwd);
				if (negotiated.transport !== undefined) return hostTransportUnavailable(parameters.operation, negotiated.transport);
				target = negotiated.status!;
				// gentle-pi#874：本 START 已获取的 STATUS 自身就可以
				// 为空工作区候选提供 committed-range START。
				// 就在*这里*采纳其 base commit，在候选视图与原生
				// START 解析之前，并为该范围重新推导目标，
				// 使三者就同一个 base-diff 身份达成一致。晚些采纳
				// 该提议会让工作区目标与 base-diff 候选视图
				// 不一致，START 以 identity-mismatch 失败。显式
				// 调用方 baseRef 与任何带未跟踪选择的 START
				// 都保持今日的单 STATUS 流程；只有采纳提议才付出
				// 第二次只读 STATUS 的代价。
				if (canonicalBaseRef === undefined && untrackedSelection.untrackedScope === undefined && untrackedSubmission === undefined) {
					const offeredBaseRef = offeredCommittedRangeBaseRef(target);
					if (offeredBaseRef !== undefined) {
						const renegotiated = await negotiatedStatusForHostTransport(nativeReviewCli, {
							cwd: defaultCwd,
							...(parameters.lineageId === undefined ? {} : { lineageId: parameters.lineageId }),
							baseRef: offeredBaseRef,
							committedOnly: true,
							...(signal === undefined ? {} : { signal }),
						}, retainedUntrackedSelections, defaultCwd);
						if (renegotiated.transport !== undefined) return hostTransportUnavailable(parameters.operation, renegotiated.transport);
						canonicalBaseRef = offeredBaseRef;
						target = renegotiated.status!;
					}
				}
				if (
					retainedPreLineageSelection !== undefined &&
					!sameNativePreLineageCandidate(retainedPreLineageSelection, target)
				) {
					clearRetainedNativeUntrackedSelection(retainedUntrackedSelections, defaultCwd, "");
					return {
						operation: parameters.operation,
						status: "blocked",
						outcome: "native-start-retained-selection-candidate-mismatch",
						mutation_performed: false,
						mutation_outcome: "none",
						next_action: "inspect-and-resolve-the-current-intended-untracked-selection",
					};
				}
				if (target.nextTransition?.kind === "collect" || target.applicability !== "unrelated" || target.action !== "start") return mapNativeTargetStatus(parameters.operation, target, parameters.lineageId);
			} catch (error) {
				return nativeOperationFailure(parameters.operation, error);
			}
			// gentle-pi#323：重放键必须折入当前候选的
			// 内容身份。没有它，第二次携带相同
			// {cwd, lineageId, input, inputPath} 的 START 会在同意
			// TTL 窗口内复用一个仍存活（从未绑定
			// lineage）的冻结候选视图，即使其下的活候选内容
			// 已改变，并最终死路于 candidate-target-projection-drift
			// 而无恢复。折入 currentCandidateTree 使内容变化
			// 铸出新的重放键——从而新的候选视图——
			// 而不是复用过期视图。
			const replayKey = JSON.stringify({ cwd: defaultCwd, lineageId: parameters.lineageId ?? null, input: parameters.input ?? null, inputPath: parameters.inputPath ?? null, candidateTree: target.projection.currentCandidateTree });
			// 在复用其保留的候选视图之前，同步丢弃任何 TTL
			// 已耗尽的绑定，使新候选的
			// 重试不能复用绑定已过期的视图并触发
			// candidate-target-projection-drift。定时器顺序不得决定
			// 正确性：排队的清理宏任务可能尚未触发。
			pruneExpiredReviewConsents(pendingReviewConsentRegistry, pendingReviewConsentSession, reviewConsentNow);
			const candidateIntendedUntracked = target.projection.intendedUntracked;
			let candidateView: ReturnType<CandidateViewRegistry["create"]> | undefined;
			let nativeStartAttempted = false;
			try {
				const candidateRequest = { contributorRoot: defaultCwd, replayKey, ...(canonicalBaseRef === undefined ? {} : { baseRef: canonicalBaseRef, committedOnly: true }) };
				candidateView = candidateViews?.createOrReuse({ ...candidateRequest, ...(candidateIntendedUntracked.length === 0 ? {} : { intendedUntracked: candidateIntendedUntracked }) });
				if (candidateView !== undefined && candidateIntendedUntracked.length === 0 && candidateView.candidateTree !== target.projection.currentCandidateTree) {
					candidateView.cleanup();
					candidateView = candidateViews?.createOrReuse({ ...candidateRequest, intendedUntracked: [] });
				}
				if (candidateView !== undefined) assertNativeStartCandidateBinding(candidateView, target);
				let result: NativeStartResult;
				try {
					nativeStartAttempted = true;
					result = await nativeReviewCli.start({
						cwd: defaultCwd,
						...(canonicalBaseRef === undefined
							? {}
							: { baseRef: candidateView?.baseCommit ?? canonicalBaseRef, committedOnly: true }),
						targetIdentity: target.targetIdentity,
						projection: target.projection.projection,
						...(untrackedSelection.untrackedScope === undefined ? {} : untrackedSelection),
						...(untrackedSubmission === undefined ? {} : { intendedUntrackedSelection: untrackedSubmission }),
						...(parameters.lineageId === undefined ? {} : { lineageId: parameters.lineageId }),
						...(policy.policyPath === undefined ? {} : { policyPath: policy.policyPath }),
						...(focus === undefined ? {} : { focus: focus as string }),
						...(signal === undefined ? {} : { signal }),
					});
				} catch (error) {
					if (!(error instanceof NativeReviewConsentRequiredError)) throw error;
					if (candidateView === undefined) throw new CandidateViewError("native consent requires a frozen candidate view");
					const consentCandidateView = candidateView;
					const repositoryCwd = realpathSync(defaultCwd);
					const consentDigest = reviewConsentDigest(error.consent);
					const pendingReviewConsents = pendingReviewConsentRegistry.get(pendingReviewConsentSession);
					const existing = [...(pendingReviewConsents?.values() ?? [])].find((pending) => pending.repositoryCwd === repositoryCwd && pending.candidateView.token === consentCandidateView.token && pending.consentDigest === consentDigest && pending.expiresAt > reviewConsentNow());
					if (existing === undefined) {
						for (const pending of [...(pendingReviewConsents?.values() ?? [])]) {
							if (pending.candidateView.token === consentCandidateView.token) {
								discardPendingReviewConsent(pending, pendingReviewConsentRegistry, pendingReviewConsentSession);
							}
						}
					}
					const id = existing?.id ?? randomUUID();
					if (existing === undefined) {
						let candidateCleaned = false;
						const pending: PendingReviewConsent = {
							id,
							repositoryCwd,
							authorityCwd: defaultCwd,
							candidateView: consentCandidateView,
							candidateViews,
							verifyCandidate: () => consentCandidateView.verify(),
							cleanupCandidate: () => {
								if (candidateCleaned) return;
								candidateCleaned = true;
								try { consentCandidateView.cleanup(); } catch { /* 所有权证明失败时保留视图；同意过期/拆除仍会完成。 */ }
							},
							...(retainedUntrackedSelection === undefined ? {} : { untrackedSelection: retainedUntrackedSelection }),
							consent: error.consent,
							consentDigest,
							expiresAt: reviewConsentNow() + PENDING_REVIEW_CONSENT_TTL_MS,
						};
						pendingReviewConsentRegistry.add(pendingReviewConsentSession, pending);
						pending.expiry = reviewConsentScheduleTimer(
							() => expirePendingReviewConsent(pending, pendingReviewConsentRegistry, pendingReviewConsentSession),
							PENDING_REVIEW_CONSENT_TTL_MS,
						);
						pending.expiry.unref?.();
					}
					return {
						operation: parameters.operation,
						status: "blocked",
						outcome: "native-review-consent-required",
						consent: error.consent.raw,
						consent_binding: id,
						...nativeStartPreAuthorityRejection(),
					};
				}
				retainNativeUntrackedSelection(retainedUntrackedSelections, defaultCwd, result.lineageId, retainedUntrackedSelection);
				// gentle-pi#706：被采纳的 pre-lineage 选择随消耗它的
				// START 一同消亡；绝不能泄漏给下一个候选。
				clearRetainedNativeUntrackedSelection(retainedUntrackedSelections, defaultCwd, "");
				return completeNativeStart(parameters.operation, result, defaultCwd, candidateView, candidateViews);
			} catch (error) {
				if (!nativeStartAttempted && error instanceof CandidateViewError && error.diagnostics !== undefined) return nativeOperationFailure(parameters.operation, Object.assign(error, { candidateViewPreNative: true }));
				if (error instanceof CandidateViewError && (error.reason === "base-ref-ambiguous" || error.reason === "base-ref-unresolvable" || error.reason === "base-ref-moved")) return nativeStartRejection(error.reason);
				const value = error as { mutationOutcome?: unknown; nextAction?: unknown };
				const provenNoMutation = value.mutationOutcome === "none";
				const preNativeFailure = !nativeStartAttempted;
				if (candidateView && candidateViews && (provenNoMutation || preNativeFailure)) candidateViews.cleanup(candidateView.token);
				const nativeCliError = asNativeReviewCliError(error);
				const failure = provenNoMutation
					? error
					: preNativeFailure
						? error instanceof CandidateViewError ? Object.assign(error, { candidateViewPreNative: true }) : error
						: Object.assign(
							error instanceof Error
								? error
								: nativeCliError === undefined
									? new Error(String(error))
									: { name: "NativeReviewCliError", code: nativeCliError.code, diagnostics: nativeCliError.diagnostics },
							{ mutationOutcome: "unknown", nextAction: "review.status" },
						);
				return reconcileNativeMutationFailure(parameters.operation, failure, nativeReviewCli, {
					cwd: defaultCwd,
					...(parameters.lineageId === undefined ? {} : { lineageId: parameters.lineageId }),
					...(canonicalBaseRef === undefined ? {} : { baseRef: candidateView?.baseCommit ?? canonicalBaseRef, committedOnly: true }),
					...(untrackedSelection.untrackedScope === undefined ? {} : untrackedSelection),
					projection: "workspace",
				}, retainedUntrackedSelections);
			}
		}
		if (rawStart.mode === REVIEW_MODE.ORDINARY) {
			return nativeStatusUnsupported(parameters.operation);
		}
		const idempotencyKey = requiredControllerString(parameters, "idempotencyKey");
		if (typeof parameters.lineageId !== "string" || parameters.lineageId.trim().length === 0) {
			throw new Error("Judgment Day graph-v1 START requires lineageId");
		}
		const input = parseStartInput(rawStart);
		const snapshot = captureReviewSnapshot({
			cwd: defaultCwd,
			mode: input.mode,
			projection: input.projection,
			policyHash: input.policyHash,
		});
		const stateInput = {
			lineageId: parameters.lineageId,
			mode: input.mode,
			snapshot,
			evidenceHash: input.evidenceHash,
			budget: input.budget,
		};
		const state = createReviewState(
			input.parentLineageId === undefined
				? stateInput
				: { ...stateInput, parentLineageId: input.parentLineageId },
		);
		const store = ReviewTransactionStore.forRepository(defaultCwd);
		let result: StartOperationResultV1;
		try {
			result = store.create(state, idempotencyKey);
		} catch (error) {
			if (!(error instanceof Error) || error.message !== "Graph lineage already exists") throw error;
			const current = store.read(parameters.lineageId!);
			const existing = current.request_journal.find((entry) => entry.idempotency_key === idempotencyKey);
			if (
				existing?.operation !== REVIEW_OPERATION.START ||
				existing.request_hash !== canonicalHash(state) ||
				existing.status !== JOURNAL_STATUS.COMPLETED
			) {
				throw new Error("Idempotency key was reused with a different START request; replay requires the same lineageId, idempotencyKey, and exact request");
			}
			result = existing.canonical_result as StartOperationResultV1;
		}
		return { operation: parameters.operation, result, state };
	}
	if (parameters.operation === REVIEW_CONTROLLER_OPERATION.ADVANCE) {
		const idempotencyKey = requiredControllerString(parameters, "idempotencyKey");
		const transitionValue = requiredControllerString(parameters, "transition");
		if (!isReviewTransition(transitionValue)) {
			throw new Error(`Review controller transition is unsupported: ${transitionValue}`);
		}
		const hasInput = parameters.input !== undefined;
		const hasInputPath = parameters.inputPath !== undefined;
		if (hasInput === hasInputPath) {
			throw new Error("Review controller advance requires exactly one of input or inputPath");
		}
		const rawInput = parseControllerJson(
			hasInput
				? requiredControllerString(parameters, "input")
				: readRepositoryControllerInput(requiredControllerString(parameters, "inputPath"), defaultCwd),
			REVIEW_CONTROLLER_OPERATION.ADVANCE,
		);
		const store = ReviewTransactionStore.forRepository(defaultCwd);
		if (store.read(parameters.lineageId!).mode === REVIEW_MODE.ORDINARY) {
			throw new Error(GRAPH_V1_ORDINARY_READ_ONLY);
		}
		const result = store.runReducerOperation({
			lineageId: parameters.lineageId,
			transition: transitionValue,
			idempotencyKey,
			input: rawInput as unknown as ReviewReducerInput,
		});
		return {
			operation: parameters.operation,
			result,
			state: store.read(parameters.lineageId),
		};
	}
	if (parameters.operation === REVIEW_CONTROLLER_OPERATION.STATUS) {
		const rawStatus = parameters.input === undefined
			? undefined
			: parseControllerJson(parameters.input, REVIEW_CONTROLLER_OPERATION.STATUS);
		const unknownField = rawStatus === undefined
			? undefined
			: Object.keys(rawStatus).find((field) => !["baseRef", "committedOnly", "untrackedScope", "expectedUntrackedInventory", "intendedUntracked"].includes(field));
		if (unknownField !== undefined) return nativeStatusInputRejection("unknown-field", unknownField);
		const baseRef = rawStatus?.baseRef;
		if (baseRef !== undefined && !isCanonicalProcessString(baseRef)) return nativeStatusInputRejection("base-ref-invalid");
		if (baseRef !== undefined && rawStatus?.committedOnly !== true) return nativeStatusInputRejection("committed-only-required");
		if (baseRef === undefined && rawStatus !== undefined && "committedOnly" in rawStatus) return nativeStatusInputRejection("committed-only-invalid");
		const untrackedSelection = rawStatus === undefined ? {} : validateNativeStartUntrackedSelection(rawStatus);
		if (
			rawStatus !== undefined &&
			(untrackedSelection.reason !== undefined || (baseRef === undefined && untrackedSelection.untrackedScope === undefined))
		) return nativeStatusInputRejection(untrackedSelection.reason ?? "untracked-selection-invalid");
		const retainedUntrackedSelection = cloneRetainedNativeUntrackedSelection(untrackedSelection);
		const effectiveUntrackedSelection = rawStatus === undefined && parameters.lineageId !== undefined
			? readRetainedNativeUntrackedSelection(retainedUntrackedSelections, defaultCwd, parameters.lineageId)
			: untrackedSelection;
		const retainedCommittedTarget = rawStatus === undefined && parameters.lineageId !== undefined && candidateViews?.hasProjection(parameters.lineageId, defaultCwd)
			? candidateViews.resolveProjection(parameters.lineageId, defaultCwd)
			: undefined;
		const effectiveBaseRef = baseRef ?? (retainedCommittedTarget?.committedOnly === true ? retainedCommittedTarget.baseCommit : undefined);
		if (nativeReviewCli?.targetStatus !== undefined) {
			try {
				const negotiated = await negotiatedStatusForHostTransport(nativeReviewCli, {
					cwd: defaultCwd,
					...(parameters.lineageId === undefined ? {} : { lineageId: parameters.lineageId }),
					// baseRef 的进程字符串规范已在上方 isCanonicalProcessString 校验背书。
					...(effectiveBaseRef === undefined ? {} : { baseRef: effectiveBaseRef as string, committedOnly: true }),
					...(effectiveUntrackedSelection.untrackedScope === undefined ? {} : { untrackedScope: effectiveUntrackedSelection.untrackedScope, expectedUntrackedInventory: effectiveUntrackedSelection.expectedUntrackedInventory, intendedUntracked: effectiveUntrackedSelection.intendedUntracked }),
					...(signal === undefined ? {} : { signal }),
				}, retainedUntrackedSelections, defaultCwd);
				if (negotiated.transport !== undefined) {
					return {
						...hostTransportUnavailable(parameters.operation, negotiated.transport),
						...(includeWorkspaceRoot ? { workspace_root: defaultCwd } : {}),
					};
				}
				const status = negotiated.status!;
				if (
					retainedUntrackedSelection !== undefined &&
					parameters.lineageId !== undefined &&
					status.applicability === "current_target" &&
					status.authority?.lineageId === parameters.lineageId
				) retainNativeUntrackedSelection(retainedUntrackedSelections, defaultCwd, parameters.lineageId, retainedUntrackedSelection);
				clearRetainedNativeStatusSelectionsOnTerminal(retainedUntrackedSelections, defaultCwd, status.authority?.lineageId, status.authority?.state);
				hydrateDispatchBindingFromStatus(candidateViews, defaultCwd, status);
				return { ...mapNativeTargetStatus(parameters.operation, status, parameters.lineageId), ...(includeWorkspaceRoot ? { workspace_root: defaultCwd } : {}) };
			} catch (error) {
				return nativeOperationFailure(parameters.operation, error);
			}
		}
		return nativeStatusUnsupported(parameters.operation);
	}
	throw new Error(`Review controller operation is unsupported: ${parameters.operation}`);
}
