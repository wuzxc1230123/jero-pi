// jero-ai 评审捕获选择域：绑定解析、精确捕获/组选择、捕获操作执行与派发水合。
// 自 extensions/jero-ai.ts 拆分（机械平移，语义零改动）。

import { join } from "node:path";
import {
	resolveReviewHostRelaySubmission, REVIEW_HOST_RELAY_FAILURE, ReviewHostRelayError,
	type ReviewHostRelayPreparedResult, type ReviewHostRelayRequest, type ReviewHostRelaySlot,
	reviewHostRelaySlots, reviewProviderRoleVectorSlots
} from "./review-host-relay.ts";
import { CandidateViewError, CandidateViewRegistry } from "./review-candidate-view.ts";
import { isCanonicalProcessString, type NativeReviewCli } from "./authority/client-contract.ts";
import { type ReviewCollectInputV3, type ReviewLastEventClosureBinding, type ReviewStatusV3 } from "./authority/wire-contract.ts";
import { isRecord } from "./jero-ai-persona-config.ts";
import { parseReviewCaptureGroupParameters, parseReviewCaptureParameters } from "./jero-ai-review-params.ts";
import { type RetainedNativeStatusSelection } from "./jero-ai-review-consent.ts";
import {
	nativeOperationFailure, readRetainedNativeCaptureRoute, readRetainedNativeUntrackedSelection,
	resolveReviewControllerWorkspaceRoot
} from "./jero-ai-review-native-ops.ts";
import {
	activeReviewHostRelayReviewerGroupRunner, activeReviewHostRelaySubmissionRunner,
	decodeRelayLastEventClosure, executeProviderRoleVectorCapture, executeReviewHostRelayCapture,
	mapAndClearLastEventClosure, pendingReviewerLenses, reconcileUnknownReviewCaptureFailure,
	REVIEW_HOST_RELAY_REFUSED_ACTION, REVIEW_HOST_RELAY_RETRY_ACTION, reviewHostRelayFailureReport
} from "./jero-ai-review-relay.ts";
import { hostTransportUnavailable, negotiatedStatusForHostTransport, REVIEW_HOST_AGENT } from "./jero-ai-review-transport.ts";
// 受支持的 continuation（jero_review inspect），并把由此产生的
// 同意封套交还给人类。
export function renderAgentEndReviewPreflightMessage(targetIdentity: string): string {
	return `Receipt-driven development is enabled, and this worktree holds an unreviewed candidate (target ${targetIdentity}). First determine whether the user explicitly left this exact target unreviewed. If yes, do not invoke review; report that disposition and continue. Only otherwise, call the jero_review tool with {"operation":"inspect"} and follow the transition it returns; it currently offers review.start for this target. An eligible interactive Pi host may resolve consent directly with its own three-action UI. If jero_review instead returns an unresolved gentle-ai.review-integration.consent/v3 envelope, relay that original two-choice provider envelope to the human losslessly. Never answer consent from model prose or tool arguments.\n\nThis extension never runs START itself. This reminder consumes only this session's observed mutation generation.`;
}

export function canonicalReviewCaptureBinding(value: unknown): string {
	if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number") return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map((entry) => canonicalReviewCaptureBinding(entry)).join(",")}]`;
	if (!isRecord(value)) throw new Error("Review capture collectBinding must encode a JSON object");
	return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalReviewCaptureBinding(value[key])}`).join(",")}}`;
}

export function parseCanonicalReviewCaptureBinding(input: string): string {
	let binding: unknown;
	try {
		binding = JSON.parse(input);
	} catch (error) {
		throw new Error(`Review capture collectBinding is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
	}
	if (!isRecord(binding)) throw new Error("Review capture collectBinding must encode exactly one collect input object");
	return canonicalReviewCaptureBinding(binding);
}

export function exactCollectArgument(input: ReviewCollectInputV3, name: string): string | undefined {
	const matches = input.arguments.filter((argument) => argument.name === name);
	return matches.length === 1 ? matches[0]!.value : undefined;
}

// intended-untracked collect 输入随 status/v6 到来，其后每个
// status 版本都保留它；只匹配一个确切版本会让每个
// 含未跟踪文件的工作区在 gentle-ai 应答 v7 后
// 无法启动评审（gentle-pi#610，gentle-ai#4187）。
const INTENDED_UNTRACKED_STATUS_SCHEMA = /^gentle-ai\.review-integration\.status\/v(\d+)$/;
function statusCarriesIntendedUntrackedSelection(schema: unknown): boolean {
	const match = typeof schema === "string" ? INTENDED_UNTRACKED_STATUS_SCHEMA.exec(schema) : null;
	return match !== null && Number(match[1]) >= 6;
}

export function reviewIntendedUntrackedInput(status: ReviewStatusV3): ReviewCollectInputV3 | undefined {
	if (!statusCarriesIntendedUntrackedSelection(status.raw.schema) || status.nextTransition?.kind !== "collect") return undefined;
	const matches = (status.nextTransition.collect?.inputs ?? []).filter((input) => {
		const value = input.submission?.values[0];
		return input.name === "intended_untracked_selection" && input.schema === "gentle-ai.review-intended-untracked-selection/v1" && input.captureOperation === "external.select_intended_untracked" && input.submission?.operationToken === "status" && input.submission.values.length === 1 && value?.slot === "intended_untracked_selection" && value.domain === "schema_bound_json";
	});
	return matches.length === 1 ? matches[0] : undefined;
}

// gentle-pi#706：intended-untracked 选择上的 inspect stop 不携带
// continuation，因此 blocked 结果会精确指明它：清单摘要
// 只覆盖路径名，往返要么经 select
// 操作解决，要么经 inspect 自己的顶层 untrackedScope 解决。
export const INSPECT_UNTRACKED_SELECTION_NEXT_STEP =
	'The intended-untracked selection is required before START. The expected_untracked_inventory digest covers untracked path names only (git ls-files --others --exclude-standard); nothing is read or hashed at inventory time, and file content is hashed only for selected paths at candidate freeze. Either call jero_review with operation "select-intended-untracked" passing this selectionBinding and intendedUntracked ([] excludes every eligible path, a subset includes only those paths), or call inspect again with untrackedScope ("exclude", or "select" with intendedUntracked) to resolve the round trip in one call. To keep a path out of the inventory permanently, ignore it through .gitignore or .git/info/exclude.';

interface PublicReviewCaptureBinding { collectBinding: string; }
export function publicReviewCaptureBindings(status: ReviewStatusV3): readonly PublicReviewCaptureBinding[] {
	if (status.nextTransition?.kind !== "collect") return [];
	return (status.nextTransition.collect?.inputs ?? []).filter((input) => input.captureOperation !== "external.select_intended_untracked").map((input) => ({ collectBinding: canonicalReviewCaptureBinding(input) }));
}

function captureBindingRejected(reason: string, group = false): Record<string, unknown> {
	return {
		tool: group ? "jero_review_capture_group" : "jero_review_capture",
		status: "blocked",
		outcome: group ? "capture-group-rejected" : "capture-binding-rejected",
		reason,
		mutation_performed: false,
		mutation_outcome: "none",
	};
}

interface SelectedReviewCapture {
	input: ReviewCollectInputV3;
	binding: ReviewLastEventClosureBinding;
}

function selectExactReviewCapture(
	status: ReviewStatusV3,
	lineageId: string,
	canonicalBinding: string,
): SelectedReviewCapture | Record<string, unknown> {
	const statusLineageId = status.authority?.lineageId;
	const statusTargetIdentity = status.targetIdentity;
	if (
		!isCanonicalProcessString(lineageId) ||
		!isCanonicalProcessString(statusLineageId) ||
		!isCanonicalProcessString(statusTargetIdentity) ||
		status.applicability !== "current_target" ||
		statusLineageId !== lineageId
	) {
		return captureBindingRejected("current STATUS does not offer one non-empty matching lineage and target identity");
	}
	if (status.nextTransition?.kind !== "collect") {
		return captureBindingRejected("current STATUS does not offer a collect transition");
	}
	const matches = (status.nextTransition.collect?.inputs ?? []).filter((input) => canonicalReviewCaptureBinding(input) === canonicalBinding);
	if (matches.length !== 1) {
		return captureBindingRejected(matches.length === 0
			? "collectBinding is missing or stale for current STATUS"
			: "collectBinding matches more than one current STATUS input");
	}
	const input = matches[0]!;
	const inputLineageId = exactCollectArgument(input, "lineage");
	const inputTargetIdentity = exactCollectArgument(input, "target");
	// Go 的 targeted-validator 向量把其捕获目标绑定到
	// provider 拥有的验证请求中的纠正目标，而不是
	// STATUS 的当前候选身份。其余所有捕获仍绑定到 STATUS。
	const expectedInputTargetIdentity = input.validationRequest?.correctionTargetIdentity ?? statusTargetIdentity;
	if (
		!isCanonicalProcessString(inputLineageId) ||
		!isCanonicalProcessString(inputTargetIdentity) ||
		inputLineageId !== lineageId ||
		inputTargetIdentity !== expectedInputTargetIdentity
	) {
		return captureBindingRejected("collectBinding does not carry one non-empty matching provider lineage and target token");
	}
	return {
		input,
		binding: { lineageId, targetIdentity: statusTargetIdentity },
	};
}

function isSelectedReviewCapture(value: SelectedReviewCapture | Record<string, unknown>): value is SelectedReviewCapture {
	return "input" in value && "binding" in value;
}

function isSelectedReviewCaptureGroup(value: SelectedReviewCaptureGroup | Record<string, unknown>): value is SelectedReviewCaptureGroup {
	return "slots" in value && "binding" in value;
}

function captureGroupRejected(reason: string): Record<string, unknown> { return captureBindingRejected(reason, true); }

export function hasExactReviewCaptureSuffix(status: ReviewStatusV3, expected: readonly string[]): boolean {
	const current = status.nextTransition?.kind === "collect"
		? (status.nextTransition.collect?.inputs ?? []).filter((input) => input.captureOperation === "review.capture-result").map(canonicalReviewCaptureBinding)
		: [];
	return current.length === expected.length && current.every((binding, index) => binding === expected[index]);
}

export function captureGroupAuthorityDrift(status: ReviewStatusV3): Record<string, unknown> {
	return { ...captureGroupRejected("authoritative STATUS does not offer exactly the unsubmitted reviewer suffix"), outcome: "capture-group-authority-drift", reconciliation: status.raw, authority_applicability: status.applicability, provider_action: status.action, next_transition: status.nextTransition };
}

interface SelectedReviewCaptureGroup {
	slots: readonly ReviewHostRelaySlot[];
	binding: ReviewLastEventClosureBinding;
}

function selectExactReviewCaptureGroup(
	status: ReviewStatusV3,
	lineageId: string,
	canonicalBindings: readonly string[],
): SelectedReviewCaptureGroup | Record<string, unknown> {
	const inputs = status.nextTransition?.kind === "collect" ? status.nextTransition.collect?.inputs ?? [] : [];
	const slots = reviewHostRelaySlots(inputs);
	if (inputs.length === 0 || slots.length !== inputs.length) {
		return captureGroupRejected("current STATUS does not offer an exclusively materialize reviewer capture group");
	}
	const currentBindings = inputs.map((input) => canonicalReviewCaptureBinding(input));
	if (new Set(currentBindings).size !== currentBindings.length || canonicalBindings.length !== currentBindings.length || canonicalBindings.some((binding, index) => binding !== currentBindings[index])) {
		return captureGroupRejected("collectBindings must be the complete distinct current reviewer group in exact provider order");
	}
	const first = selectExactReviewCapture(status, lineageId, currentBindings[0]!);
	if (!isSelectedReviewCapture(first)) return captureGroupRejected(String(first.reason ?? "current STATUS rejected a reviewer binding"));
	const expectedRevision = exactCollectArgument(inputs[0]!, "expected-revision");
	const repositoryContext = exactCollectArgument(inputs[0]!, "repository-context");
	const statusTargetIdentity = status.targetIdentity;
	const currentRepositoryContext = status.repositoryContext;
	if (!isCanonicalProcessString(expectedRevision) || !isCanonicalProcessString(repositoryContext) || currentRepositoryContext === undefined || expectedRevision !== currentRepositoryContext.revision) {
		return captureGroupRejected("current STATUS does not bind one matching expected revision and repository context for the reviewer group");
	}
	if (currentRepositoryContext.handle !== repositoryContext || currentRepositoryContext.targetIdentity !== statusTargetIdentity) {
		return captureGroupRejected("current STATUS repository context does not match the reviewer group binding");
	}
	const lenses = new Set<string>(), orders = new Set<string>(), subjectHashes = new Set<string>();
	for (let index = 0; index < inputs.length; index += 1) {
		const input = inputs[index]!, slot = slots[index]!, subject = input.artifactSubject;
		const slotLineage = exactCollectArgument(input, "lineage"), target = exactCollectArgument(input, "target");
		const revision = exactCollectArgument(input, "expected-revision"), context = exactCollectArgument(input, "repository-context");
		const subjectHash = exactCollectArgument(input, "subject-hash"), order = slot.order, lens = slot.lens;
		if (
			subject === undefined || slot.submission === undefined || slotLineage !== lineageId || target !== statusTargetIdentity
			|| revision !== expectedRevision || context !== repositoryContext || subjectHash !== subject.subjectHash || order === undefined || lens === undefined
			|| subject.lineageId !== lineageId || subject.authorityRevision !== expectedRevision || subject.targetIdentity !== statusTargetIdentity
			|| lens !== subject.lens || String(subject.selectedOrder) !== order
		) return captureGroupRejected("current STATUS carries an incomplete or mismatched materialize reviewer binding");
		try { resolveReviewHostRelaySubmission(slot.submission); } catch { return captureGroupRejected("current STATUS carries an invalid provider reviewer submission descriptor"); }
		const value = slot.submission.values[0];
		if (slot.submission.operationToken !== "capture-result" || value?.slot !== "reviewer_result" || value.domain !== "artifact_path_or_stdin" || lenses.has(lens) || orders.has(order) || subjectHashes.has(subject.subjectHash)) {
			return captureGroupRejected("current STATUS carries duplicate or invalid reviewer slot identities");
		}
		lenses.add(lens); orders.add(order); subjectHashes.add(subject.subjectHash);
	}
	return { slots, binding: first.binding };
}

function reviewHostRelayGroupFailure(
	error: ReviewHostRelayError,
	slots: readonly ReviewHostRelaySlot[],
	prepared: readonly ReviewHostRelayPreparedResult[],
	submitted: number,
): Record<string, unknown> {
	return {
		tool: "jero_review_capture_group",
		status: "blocked",
		outcome: error.kind === REVIEW_HOST_RELAY_FAILURE.RELAY_UNAVAILABLE ? "pi-host-relay-unavailable" : error.kind === REVIEW_HOST_RELAY_FAILURE.PI_TIMED_OUT ? "pi-host-relay-timeout" : "pi-host-relay-transport-failure",
		reason: error.message,
		failure: reviewHostRelayFailureReport(error),
		...reviewHostRelayGroupProgress(slots, prepared, submitted),
		next_action: error.kind === REVIEW_HOST_RELAY_FAILURE.SUBMISSION_REFUSED ? REVIEW_HOST_RELAY_REFUSED_ACTION : REVIEW_HOST_RELAY_RETRY_ACTION,
	};
}

export async function executeReviewCaptureOperation(
	parametersValue: unknown,
	sessionCwd: string,
	nativeReviewCli: NativeReviewCli | null,
	signal?: AbortSignal,
	candidateViews: CandidateViewRegistry | null = new CandidateViewRegistry(),
	retainedUntrackedSelections: Map<string, RetainedNativeStatusSelection> = new Map(),
	requireRegisteredRoute = false,
): Promise<Record<string, unknown>> {
	const parameters = parseReviewCaptureParameters(parametersValue);
	if (nativeReviewCli === null || nativeReviewCli.targetStatus === undefined) {
		return {
			tool: "jero_review_capture",
			status: "blocked",
			outcome: "native-status-unsupported",
			mutation_performed: false,
			mutation_outcome: "none",
		};
	}
	const canonicalBinding = parseCanonicalReviewCaptureBinding(parameters.collectBinding);
	const cwd = resolveReviewControllerWorkspaceRoot(parameters.workspaceRoot, sessionCwd, candidateViews, parameters.lineageId);
	const route = readRetainedNativeCaptureRoute(retainedUntrackedSelections, canonicalBinding);
	if (requireRegisteredRoute && (route === undefined || route.workspaceRoot !== cwd || route.lineageId !== parameters.lineageId)) {
		return captureBindingRejected("collectBinding is unknown, expired, or belongs to a different session route");
	}
	let status: ReviewStatusV3;
	try {
		const negotiated = await negotiatedStatusForHostTransport(nativeReviewCli, {
			cwd,
			lineageId: parameters.lineageId,
			...(route?.baseRef === undefined ? {} : { baseRef: route.baseRef, committedOnly: true }),
			...readRetainedNativeUntrackedSelection(retainedUntrackedSelections, cwd, parameters.lineageId),
			...(signal === undefined ? {} : { signal }),
		}, retainedUntrackedSelections, cwd);
		if (negotiated.transport !== undefined) return hostTransportUnavailable("jero_review_capture", negotiated.transport);
		status = negotiated.status!;
	} catch (error) {
		return nativeOperationFailure("jero_review_capture", error);
	}
	const selected = selectExactReviewCapture(status, parameters.lineageId, canonicalBinding);
	if (!isSelectedReviewCapture(selected)) return selected;

	// 纠正期间，流程同时携带原始权威目标身份
	// 和一个不同的 provider 签发纠正目标身份
	// （gentle-pi#535 第 15 行）。在捕获结果上回显纠正
	// 身份，使调用方绝不必从不透明绑定中重建二者的区别。
	const correctionTargetIdentity = selected.input.validationRequest?.correctionTargetIdentity ?? selected.input.artifactSubject?.correctionTargetIdentity;
	const withCorrectionTarget = (result: Record<string, unknown>): Record<string, unknown> =>
		correctionTargetIdentity === undefined ? result : { ...result, correction_target_identity: correctionTargetIdentity };

	const hostRelaySlots = reviewHostRelaySlots([selected.input]);
	if (hostRelaySlots.length === 1) {
		if (parameters.correctionLines !== undefined) return captureBindingRejected("correctionLines is valid only for a correction-plan capture");
		if (parameters.reviewerRunAcknowledged !== true) {
			return {
				tool: "jero_review_capture",
				status: "blocked",
				outcome: "reviewer-model-run-forecast",
				cost_forecast: {
					transport: "pi_host_relay",
					model_runs: 1,
					lenses: hostRelaySlots[0]!.lens === undefined ? [] : [hostRelaySlots[0]!.lens],
				},
				mutation_performed: false,
				mutation_outcome: "none",
			};
		}
		return withCorrectionTarget(await executeReviewHostRelayCapture(hostRelaySlots[0]!, nativeReviewCli, cwd, selected.binding, retainedUntrackedSelections, route, signal));
	}

	if (selected.input.captureOperation === "review.capture-correction-plan") {
		if (parameters.reviewerRunAcknowledged !== undefined) return captureBindingRejected("reviewerRunAcknowledged is valid only for a materialize reviewer capture");
		const submission = selected.input.submission;
		const value = submission?.values.length === 1 ? submission.values[0] : undefined;
		if (submission === undefined || value?.slot !== "correction_lines") return captureBindingRejected("provider correction-plan capture omitted its exact correction-lines binding");
		if (parameters.correctionLines === undefined) {
			return {
				tool: "jero_review_capture",
				status: "blocked",
				outcome: "correction-lines-required",
				minimum: value.minimum ?? 1,
				maximum: value.maximum ?? 200,
				mutation_performed: false,
				mutation_outcome: "none",
			};
		}
		if ((value.minimum !== undefined && parameters.correctionLines < value.minimum) || (value.maximum !== undefined && parameters.correctionLines > value.maximum)) {
			return captureBindingRejected("correctionLines is outside the exact provider-issued correction-plan bounds");
		}
		if (nativeReviewCli.captureCorrectionPlan === undefined) return captureBindingRejected("native correction-plan capture is unavailable");
		try {
			const closure = await nativeReviewCli.captureCorrectionPlan({
				argumentTokens: submission.argumentTokens,
				correctionLines: parameters.correctionLines,
				cwd,
				...(signal === undefined ? {} : { signal }),
			});
			return withCorrectionTarget(mapAndClearLastEventClosure(closure, selected.binding, retainedUntrackedSelections, cwd));
		} catch (error) {
			return await reconcileUnknownReviewCaptureFailure(error, nativeReviewCli, cwd, selected.binding, retainedUntrackedSelections, route);
		}
	}

	const providerRoleSlots = reviewProviderRoleVectorSlots([selected.input]);
	if (providerRoleSlots.length === 1) {
		if (parameters.reviewerRunAcknowledged !== undefined || parameters.correctionLines !== undefined) {
			return captureBindingRejected("reviewerRunAcknowledged and correctionLines are not valid for a provider role capture");
		}
		return withCorrectionTarget(await executeProviderRoleVectorCapture(providerRoleSlots[0]!, nativeReviewCli, cwd, selected.binding, retainedUntrackedSelections, route, signal));
	}
	return captureBindingRejected(`unsupported provider capture operation: ${selected.input.captureOperation}`);
}

function reviewHostRelayGroupDiagnostics(slots: readonly ReviewHostRelaySlot[], prepared: readonly ReviewHostRelayPreparedResult[], count: number): readonly Record<string, unknown>[] {
	return slots.slice(0, count).map((slot, index) => ({
		...(slot.lens === undefined ? {} : { lens: slot.lens }),
		...(slot.order === undefined ? {} : { order: slot.order }),
		...(slot.subjectHash === undefined ? {} : { subject_hash: slot.subjectHash }),
		prompt_bytes: prepared[index]?.promptByteLength,
		result_bytes: prepared[index]?.resultByteLength,
	}));
}

function reviewHostRelayGroupProgress(
	slots: readonly ReviewHostRelaySlot[],
	prepared: readonly ReviewHostRelayPreparedResult[],
	submitted: number,
	uncertain = false,
): Record<string, unknown> {
	const outcome = submitted === 0 ? uncertain ? "unknown" : "none" : uncertain ? "partial_unknown" : submitted === slots.length ? "completed" : "partial";
	return {
		prepared_reviewers: prepared.length,
		submitted_reviewers: submitted,
		host_relay: { transport: "pi_host_relay", reviewers: reviewHostRelayGroupDiagnostics(slots, prepared, submitted) },
		...(submitted === 0 && uncertain ? { mutation_outcome: outcome } : { mutation_performed: submitted > 0, mutation_outcome: outcome }),
	};
}

export async function executeReviewCaptureGroupOperation(
	parametersValue: unknown,
	sessionCwd: string,
	nativeReviewCli: NativeReviewCli | null,
	signal?: AbortSignal,
	candidateViews: CandidateViewRegistry | null = new CandidateViewRegistry(),
	retainedUntrackedSelections: Map<string, RetainedNativeStatusSelection> = new Map(),
	requireRegisteredRoute = false,
): Promise<Record<string, unknown>> {
	const parameters = parseReviewCaptureGroupParameters(parametersValue);
	if (nativeReviewCli === null || nativeReviewCli.targetStatus === undefined) return { ...captureGroupRejected("native target STATUS is unavailable"), outcome: "native-status-unsupported" };
	const canonicalBindings = parameters.collectBindings.map((binding) => parseCanonicalReviewCaptureBinding(binding));
	const cwd = resolveReviewControllerWorkspaceRoot(parameters.workspaceRoot, sessionCwd, candidateViews, parameters.lineageId);
	const routes = canonicalBindings.map((binding) => readRetainedNativeCaptureRoute(retainedUntrackedSelections, binding));
	const route = routes[0];
	if (requireRegisteredRoute && (route === undefined || routes.some((candidate) => candidate === undefined || candidate.workspaceRoot !== cwd || candidate.lineageId !== parameters.lineageId || candidate.baseRef !== route.baseRef))) {
		return captureGroupRejected("collectBindings are unknown, expired, or belong to different session routes");
	}
	const freshStatus = () => negotiatedStatusForHostTransport(nativeReviewCli, {
		cwd, lineageId: parameters.lineageId,
		...(route?.baseRef === undefined ? {} : { baseRef: route.baseRef, committedOnly: true }),
		...readRetainedNativeUntrackedSelection(retainedUntrackedSelections, cwd, parameters.lineageId),
		...(signal === undefined ? {} : { signal }),
	}, retainedUntrackedSelections, cwd);
	let status: ReviewStatusV3;
	try {
		const negotiated = await freshStatus();
		if (negotiated.transport !== undefined) return hostTransportUnavailable("jero_review_capture_group", negotiated.transport);
		status = negotiated.status!;
	} catch (error) {
		return { ...captureGroupRejected(error instanceof Error ? error.message : String(error)), outcome: "native-status-failed" };
	}
	const group = selectExactReviewCaptureGroup(status, parameters.lineageId, canonicalBindings);
	if (!isSelectedReviewCaptureGroup(group)) return group;
	if (parameters.reviewerRunAcknowledged !== true) {
		return {
			tool: "jero_review_capture_group",
			status: "blocked",
			outcome: "reviewer-model-run-forecast",
			cost_forecast: { transport: "pi_host_relay", model_runs: group.slots.length, lenses: group.slots.map((slot) => slot.lens).filter((lens): lens is string => lens !== undefined) },
			mutation_performed: false,
			mutation_outcome: "none",
		};
	}
	const requests: readonly ReviewHostRelayRequest[] = group.slots.map((slot) => ({
		captureArgumentTokens: slot.captureArgumentTokens,
		targetCwd: cwd,
		submission: slot.submission!,
		...(signal === undefined ? {} : { signal }),
	}));
	let prepared: readonly ReviewHostRelayPreparedResult[];
	try {
		prepared = await activeReviewHostRelayReviewerGroupRunner(requests);
		if (prepared.length !== requests.length) throw new Error("Pi host relay reviewer group returned a different number of prepared results");
	} catch (error) {
		return error instanceof ReviewHostRelayError
			? reviewHostRelayGroupFailure(error, group.slots, [], 0)
			: { ...captureGroupRejected(error instanceof Error ? error.message : String(error)), outcome: "pi-host-relay-reviewer-group-failed" };
	}
	for (let index = 0; index < prepared.length; index += 1) {
		let current: SelectedReviewCapture | Record<string, unknown>;
		try {
			const negotiated = await freshStatus();
			if (negotiated.transport !== undefined) return { ...hostTransportUnavailable("jero_review_capture_group", negotiated.transport), ...reviewHostRelayGroupProgress(group.slots, prepared, index) };
			if (!hasExactReviewCaptureSuffix(negotiated.status!, canonicalBindings.slice(index))) return { ...captureGroupAuthorityDrift(negotiated.status!), ...reviewHostRelayGroupProgress(group.slots, prepared, index) };
			current = selectExactReviewCapture(negotiated.status!, parameters.lineageId, canonicalBindings[index]!);
		} catch (error) {
			return { ...captureGroupRejected(error instanceof Error ? error.message : String(error)), outcome: "native-status-failed", ...reviewHostRelayGroupProgress(group.slots, prepared, index) };
		}
		if (!isSelectedReviewCapture(current)) return { ...captureGroupRejected(String(current.reason ?? "current STATUS rejected a reviewer binding")), ...reviewHostRelayGroupProgress(group.slots, prepared, index) };
		try {
			const result = await activeReviewHostRelaySubmissionRunner(prepared[index]!);
			const closure = decodeRelayLastEventClosure(result.submission);
			if (closure !== undefined) {
				const closed = mapAndClearLastEventClosure(closure, current.binding, retainedUntrackedSelections, cwd);
				return { ...closed, tool: "jero_review_capture_group", ...reviewHostRelayGroupProgress(group.slots, prepared, index + 1) };
			}
		} catch (error) {
			if (error instanceof ReviewHostRelayError && error.mutationOutcome !== "unknown") return reviewHostRelayGroupFailure(error, group.slots, prepared, index);
			const reconciled = await reconcileUnknownReviewCaptureFailure(error, nativeReviewCli, cwd, current.binding, retainedUntrackedSelections, route, undefined, REVIEW_HOST_AGENT);
			return { ...reconciled, tool: "jero_review_capture_group", ...reviewHostRelayGroupProgress(group.slots, prepared, index, true), ...(error instanceof ReviewHostRelayError ? { failure: reviewHostRelayFailureReport(error), reason: error.message } : {}) };
		}
	}
	const reconciled = await reconcileUnknownReviewCaptureFailure(undefined, nativeReviewCli, cwd, group.binding, retainedUntrackedSelections, route, canonicalBindings.slice(prepared.length), REVIEW_HOST_AGENT);
	return { ...reconciled, tool: "jero_review_capture_group", outcome: reconciled.outcome === "capture-group-authority-drift" ? reconciled.outcome : reconciled.status === "reconciled" ? "native-reviewer-group-status-reconciled" : "native-reviewer-group-status-reconciliation-failed", ...reviewHostRelayGroupProgress(group.slots, prepared, prepared.length) };
}

type DispatchHydrationOutcome =
	| { hydrated: true; lineage_id: string; lenses: readonly string[] }
	| { hydrated: false; lineage_id: string; reason: string; message: string }
	| undefined;

export function hydrateDispatchBindingFromStatus(candidateViews: CandidateViewRegistry | null, contributorRoot: string, status: ReviewStatusV3): DispatchHydrationOutcome {
	if (candidateViews === null || candidateViews.hasCurrentBinding(contributorRoot)) return undefined;
	const lineageId = status.authority?.lineageId;
	if (lineageId === undefined || status.applicability !== "current_target" || candidateViews.hasProjection(lineageId, contributorRoot)) return undefined;
	const lenses = pendingReviewerLenses(status);
	if (lenses.length === 0) return undefined;
	try {
		candidateViews.restoreCurrentForDispatchFromNative(lineageId, contributorRoot, status.projection, lenses);
		return { hydrated: true, lineage_id: lineageId, lenses };
	} catch (error) {
		// 水合绝不让调用方失败；注册表记录带类型的
		// 原因，让随后的派发拒绝指明该尝试，而不是
		// 宣称从未有过可用绑定。
		return {
			hydrated: false,
			lineage_id: lineageId,
			reason: error instanceof CandidateViewError ? error.reason : "candidate-view-invalid",
			message: error instanceof Error ? error.message : String(error),
		};
	}
}
