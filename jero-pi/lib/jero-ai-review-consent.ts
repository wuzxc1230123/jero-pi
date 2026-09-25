// jero-ai 评审同意域：启动策略校验、untracked 选择、待定同意注册表、留存选择与陈旧绑定诊断。
// 自 extensions/jero-ai.ts 拆分（机械平移，语义零改动）。

import { createHash } from "node:crypto";
import { lstatSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { REVIEW_MODE } from "./review-snapshot.ts";
import { type CandidateView, CandidateViewError, CandidateViewRegistry } from "./review-candidate-view.ts";
import { isCanonicalProcessString, type NativeIntendedUntrackedSelectionSubmission } from "./authority/client-contract.ts";
import { type ReviewConsentEnvelope, type ReviewStatusV3 } from "./authority/wire-contract.ts";
import { isRecord } from "./jero-ai-persona-config.ts";
import {
	mapNativeTargetStatus, nativeStartPreAuthorityRejection, parseControllerJson,
	parseReviewControllerParameters, requiredControllerString, REVIEW_CONTROLLER_OPERATION,
	type ReviewControllerOperation
} from "./jero-ai-review-params.ts";

export interface NativeStartPolicyValidation {
	policyPath?: string;
	reason?: string;
}

export function isStrictDescendantPath(parent: string, candidate: string): boolean {
	const pathFromParent = relative(parent, candidate);
	return pathFromParent.length > 0 && pathFromParent !== ".." && !pathFromParent.startsWith(`..${sep}`) && !isAbsolute(pathFromParent);
}

export function validateNativeStartPolicyPath(cwd: string, value: unknown): NativeStartPolicyValidation {
	if (typeof value !== "string" || value.trim().length === 0) return { reason: "policy-path-not-regular" };
	let repository: string;
	try {
		repository = realpathSync(cwd);
	} catch {
		return { reason: "policy-path-outside-scope" };
	}
	const policyRoot = join(repository, ".jero", "policies");
	const candidate = resolve(repository, value);
	if (!isStrictDescendantPath(policyRoot, candidate)) return { reason: "policy-path-outside-scope" };
	const jeroDirectory = join(repository, ".jero");
	for (const directory of [jeroDirectory, policyRoot]) {
		try {
			const metadata = lstatSync(directory);
			if (metadata.isSymbolicLink()) return { reason: "policy-path-symlink" };
			if (!metadata.isDirectory()) return { reason: "policy-path-not-regular" };
		} catch {
			return { reason: "policy-path-not-regular" };
		}
	}
	const segments = relative(policyRoot, candidate).split(sep);
	let current = policyRoot;
	for (const [index, segment] of segments.entries()) {
		current = join(current, segment);
		try {
			const metadata = lstatSync(current);
			if (metadata.isSymbolicLink()) return { reason: "policy-path-symlink" };
			if (index === segments.length - 1) {
				if (!metadata.isFile()) return { reason: "policy-path-not-regular" };
			} else if (!metadata.isDirectory()) {
				return { reason: "policy-path-not-regular" };
			}
		} catch {
			return { reason: "policy-path-not-regular" };
		}
	}
	try {
		const canonicalPath = realpathSync(candidate);
		if (canonicalPath !== candidate || !isStrictDescendantPath(policyRoot, canonicalPath)) return { reason: "policy-path-symlink" };
		return { policyPath: canonicalPath };
	} catch {
		return { reason: "policy-path-not-regular" };
	}
}

const NATIVE_START_FOCUS = {
	RISK: "risk",
	RESILIENCE: "resilience",
	READABILITY: "readability",
	RELIABILITY: "reliability",
} as const;
type NativeStartFocus = (typeof NATIVE_START_FOCUS)[keyof typeof NATIVE_START_FOCUS];

export function isNativeStartFocus(value: unknown): value is NativeStartFocus {
	return typeof value === "string" && (Object.values(NATIVE_START_FOCUS) as readonly string[]).includes(value);
}

export const NATIVE_START_UNTRACKED_SCOPE = {
	EXCLUDE: "exclude",
	SELECT: "select",
} as const;
export type NativeStartUntrackedScope = (typeof NATIVE_START_UNTRACKED_SCOPE)[keyof typeof NATIVE_START_UNTRACKED_SCOPE];

export interface NativeStartUntrackedSelection {
	untrackedScope?: NativeStartUntrackedScope;
	expectedUntrackedInventory?: string;
	intendedUntracked?: readonly string[];
	reason?: string;
}

export interface RetainedNativeUntrackedSelection {
	readonly untrackedScope: NativeStartUntrackedScope;
	readonly expectedUntrackedInventory: string;
	readonly intendedUntracked: readonly string[];
	readonly submission?: NativeIntendedUntrackedSelectionSubmission;
}

export interface RetainedPreLineageNativeUntrackedSelection extends RetainedNativeUntrackedSelection {
	readonly targetIdentity: string;
	readonly candidateTree: string;
}

export interface RetainedNativeCaptureRoute { readonly workspaceRoot: string; readonly lineageId: string; readonly baseRef?: string; readonly committedOnly?: true; }

export type RetainedNativeStatusSelection = RetainedNativeUntrackedSelection | RetainedNativeCaptureRoute;

export const MAX_RETAINED_NATIVE_STATUS_SELECTIONS = 64;
export class NativeCaptureRouteRegistrationError extends Error {}

function isNativeStartUntrackedPath(value: unknown): value is string {
	return isCanonicalProcessString(value)
		&& !isAbsolute(value)
		&& !/^[A-Za-z]:\//.test(value)
		&& !value.includes("\\")
		&& value.split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

export function validateNativeStartUntrackedSelection(value: Record<string, unknown>): NativeStartUntrackedSelection {
	const declared = "untrackedScope" in value || "expectedUntrackedInventory" in value || "intendedUntracked" in value;
	if (!declared) return {};
	const scope = value.untrackedScope;
	const expectedUntrackedInventory = value.expectedUntrackedInventory;
	// 仅做类型断言：行在使用前会在下方校验。
	const intendedUntracked = value.intendedUntracked as string[] | undefined;
	if (
		(scope !== NATIVE_START_UNTRACKED_SCOPE.EXCLUDE && scope !== NATIVE_START_UNTRACKED_SCOPE.SELECT) ||
		!isCanonicalProcessString(expectedUntrackedInventory) ||
		(intendedUntracked !== undefined && (!Array.isArray(intendedUntracked) || intendedUntracked.some((path) => !isNativeStartUntrackedPath(path) || intendedUntracked.indexOf(path) !== intendedUntracked.lastIndexOf(path))))
	) return { reason: "untracked-selection-invalid" };
	if (scope === NATIVE_START_UNTRACKED_SCOPE.EXCLUDE && (intendedUntracked?.length ?? 0) > 0) return { reason: "untracked-selection-invalid" };
	if (scope === NATIVE_START_UNTRACKED_SCOPE.SELECT && (intendedUntracked?.length ?? 0) === 0) return { reason: "untracked-selection-invalid" };
	return {
		untrackedScope: scope,
		expectedUntrackedInventory,
		intendedUntracked: intendedUntracked === undefined ? [] : [...intendedUntracked],
	};
}

export function nativeStartRejection(reason: string, field?: string): Record<string, unknown> {
	return {
		operation: REVIEW_CONTROLLER_OPERATION.START,
		status: "blocked",
		outcome: reason === "legacy-policy-hash-unsupported"
			? "native-start-legacy-policy-hash-unsupported"
			: reason === "base-ref-invalid"
				? "native-start-base-ref-invalid"
				: reason === "base-ref-ambiguous"
					? "native-start-base-ref-ambiguous"
					: reason === "base-ref-unresolvable" || reason === "base-ref-moved"
						? "native-start-base-ref-unresolvable"
						: reason === "committed-only-required"
							? "native-start-committed-only-required"
							: reason === "committed-only-invalid"
								? "native-start-committed-only-invalid"
								: reason === "unknown-field" || reason === "focus-invalid" || reason === "untracked-selection-invalid"
									? "native-start-input-invalid"
									: "native-start-policy-path-invalid",
		reason,
		...(field === undefined ? {} : { field }),
		...nativeStartPreAuthorityRejection(),
	};
}

export function nativeStatusInputRejection(reason: string, field?: string): Record<string, unknown> {
	return {
		operation: REVIEW_CONTROLLER_OPERATION.STATUS,
		status: "blocked",
		outcome: "native-status-input-invalid",
		reason,
		...(field === undefined ? {} : { field }),
		mutation_performed: false,
		mutation_outcome: "none",
	};
}

export const PENDING_REVIEW_CONSENT_TTL_MS = 10 * 60 * 1000;
export const REVIEW_SESSION_PERMISSION_STATUS_KEY = "jero-review-session-permission";
export const REVIEW_SESSION_PERMISSION_STATUS_TEXT = "reviews allowed for this session";

export type PendingReviewConsentSessionKey = string | symbol;

export interface PendingReviewConsent {
	id: string;
	repositoryCwd: string;
	authorityCwd: string;
	candidateView: CandidateView;
	candidateViews: CandidateViewRegistry | null;
	verifyCandidate: () => void;
	cleanupCandidate: () => void;
	untrackedSelection?: RetainedNativeUntrackedSelection;
	consent: ReviewConsentEnvelope;
	consentDigest: string;
	expiresAt: number;
	expiry?: ReturnType<typeof setTimeout>;
}

export const PENDING_REVIEW_CONSENT_DISPOSITION = {
	EXPIRED: "expired",
	CONSUMED: "consumed",
} as const;

type PendingReviewConsentDisposition = (typeof PENDING_REVIEW_CONSENT_DISPOSITION)[keyof typeof PENDING_REVIEW_CONSENT_DISPOSITION];

const PENDING_REVIEW_CONSENT_STALE_DISPOSITION_LIMIT = 32;

/**
 * 仅存于进程内存的待定同意分区。已加载的扩展模块
 * 在多次注册间共享此注册表，而精确的 Pi 会话 ID 仍是
 * 唯一的延续边界。它刻意不提供任何持久化面。
 */
export class PendingReviewConsentRegistry {
	private readonly sessions = new Map<PendingReviewConsentSessionKey, Map<string, PendingReviewConsent>>();
	// gentle-pi#455：绑定 id 全局唯一（randomUUID），因此其活跃
	// 属主与过期处置仅按绑定 id 追踪。该
	// 索引让 answer-consent 能解析并恰好原子地取走一次由另一个
	// 活跃 Pi 会话的 START 创建的绑定；上方按会话的
	// map 仍是会话范围清单与关闭清理的权威。
	private readonly byBinding = new Map<string, PendingReviewConsentSessionKey>();
	private readonly staleDispositions = new Map<string, PendingReviewConsentDisposition>();

	get(sessionKey: PendingReviewConsentSessionKey): Map<string, PendingReviewConsent> | undefined {
		return this.sessions.get(sessionKey);
	}

	ensure(sessionKey: PendingReviewConsentSessionKey): Map<string, PendingReviewConsent> {
		let pending = this.sessions.get(sessionKey);
		if (pending === undefined) {
			pending = new Map<string, PendingReviewConsent>();
			this.sessions.set(sessionKey, pending);
		}
		return pending;
	}

	// 一步把新创建的待定绑定注册到其属主会话与
	// 跨会话绑定索引，使两者永不漂移。
	add(sessionKey: PendingReviewConsentSessionKey, pending: PendingReviewConsent): void {
		this.ensure(sessionKey).set(pending.id, pending);
		this.byBinding.set(pending.id, sessionKey);
	}

	// 无论哪个会话发问，都把活跃绑定解析到其属主会话，
	// 这样 answer-consent 能触及由另一个会话的
	// START 创建的绑定（gentle-pi#455）。
	resolve(bindingId: string): { sessionKey: PendingReviewConsentSessionKey; pending: PendingReviewConsent } | undefined {
		const sessionKey = this.byBinding.get(bindingId);
		const pending = sessionKey === undefined ? undefined : this.sessions.get(sessionKey)?.get(bindingId);
		return pending === undefined ? undefined : { sessionKey, pending };
	}

	private remove(sessionKey: PendingReviewConsentSessionKey, pending: PendingReviewConsent): boolean {
		const session = this.sessions.get(sessionKey);
		if (session?.get(pending.id) !== pending) return false;
		session.delete(pending.id);
		if (session.size === 0) this.sessions.delete(sessionKey);
		if (this.byBinding.get(pending.id) === sessionKey) this.byBinding.delete(pending.id);
		return true;
	}

	private rememberDisposition(pending: PendingReviewConsent, disposition: PendingReviewConsentDisposition): void {
		this.staleDispositions.delete(pending.id);
		this.staleDispositions.set(pending.id, disposition);
		while (this.staleDispositions.size > PENDING_REVIEW_CONSENT_STALE_DISPOSITION_LIMIT) this.staleDispositions.delete(this.staleDispositions.keys().next().value!);
	}

	consume(sessionKey: PendingReviewConsentSessionKey, pending: PendingReviewConsent): boolean {
		if (!this.remove(sessionKey, pending)) return false;
		this.rememberDisposition(pending, PENDING_REVIEW_CONSENT_DISPOSITION.CONSUMED);
		return true;
	}

	expire(sessionKey: PendingReviewConsentSessionKey, pending: PendingReviewConsent): boolean {
		if (!this.remove(sessionKey, pending)) return false;
		this.rememberDisposition(pending, PENDING_REVIEW_CONSENT_DISPOSITION.EXPIRED);
		return true;
	}

	discard(sessionKey: PendingReviewConsentSessionKey, pending: PendingReviewConsent): void {
		this.remove(sessionKey, pending);
	}

	staleDisposition(binding: string): PendingReviewConsentDisposition | undefined {
		return this.staleDispositions.get(binding);
	}

	take(sessionKey: PendingReviewConsentSessionKey): PendingReviewConsent[] {
		const session = this.sessions.get(sessionKey);
		this.sessions.delete(sessionKey);
		if (session !== undefined) for (const pending of session.values()) if (this.byBinding.get(pending.id) === sessionKey) this.byBinding.delete(pending.id);
		return session === undefined ? [] : [...session.values()];
	}
}

export const processPendingReviewConsentRegistry = new PendingReviewConsentRegistry();
export const processRetainedNativeStatusSelections = new Map<PendingReviewConsentSessionKey, Map<string, RetainedNativeStatusSelection>>();

// gentle-pi#556 / gentle-ai#4051：会话内具名代理（SDD 阶段
// 执行器或其他子代理）启动与结束的嵌套深度。启动与
// 结束成对，因此子代理自身循环的结束绝不会让主
// 循环的 `agent_end` 预检在会话余下时间里被抑制：
// 具名代理启动使深度加一，配对的结束使其减一，
// 新的主循环启动将其重置为 0。
export const processAgentEndSubagentDepth = new Map<PendingReviewConsentSessionKey, number>();

export function pendingReviewConsentSessionKey(context: ExtensionContext | undefined, fallbackKey: symbol): PendingReviewConsentSessionKey {
	try {
		const sessionManager = (context as unknown as { sessionManager?: { getSessionId?: () => unknown } } | undefined)?.sessionManager;
		const sessionId = sessionManager?.getSessionId?.();
		if (typeof sessionId === "string") return sessionId;
	} catch { /* 极简或测试上下文使用注册局部兜底键。 */ }
	return fallbackKey;
}

export function consumePendingReviewConsent(pending: PendingReviewConsent, registry: PendingReviewConsentRegistry, sessionKey: PendingReviewConsentSessionKey): boolean {
	if (!registry.consume(sessionKey, pending)) return false;
	if (pending.expiry !== undefined) clearTimeout(pending.expiry);
	pending.expiry = undefined;
	return true;
}

export function discardPendingReviewConsent(pending: PendingReviewConsent, registry: PendingReviewConsentRegistry, sessionKey: PendingReviewConsentSessionKey): void {
	if (pending.expiry !== undefined) clearTimeout(pending.expiry);
	pending.expiry = undefined;
	registry.discard(sessionKey, pending);
}

export function expirePendingReviewConsent(pending: PendingReviewConsent, registry: PendingReviewConsentRegistry, sessionKey: PendingReviewConsentSessionKey): void {
	if (pending.expiry !== undefined) clearTimeout(pending.expiry);
	pending.expiry = undefined;
	if (registry.expire(sessionKey, pending)) pending.cleanupCandidate();
}

export function cleanupPendingReviewConsent(pending: PendingReviewConsent, registry: PendingReviewConsentRegistry, sessionKey: PendingReviewConsentSessionKey): void {
	discardPendingReviewConsent(pending, registry, sessionKey);
	pending.cleanupCandidate();
}

export function cleanupAllPendingReviewConsents(registry: PendingReviewConsentRegistry, sessionKey: PendingReviewConsentSessionKey): void {
	for (const pending of registry.take(sessionKey)) cleanupPendingReviewConsent(pending, registry, sessionKey);
}

// 一个未被使用的同意绑定与仅为该绑定保留的候选视图
// 作为一个生命周期单元一起过期。当同步时间给出
// `expiresAt <= now` 的那一刻 TTL 过期即被观察到，因此清理必须
// 相对该观察同步执行——排队的清理宏任务只是
// 安全网，不是权威。在此处（在任何后续
// START 复用保留视图之前）修剪，可以不让定时器顺序决定
// 正确性：新的候选重试绝不会复用绑定
// 已过期的视图，因此不会触发 `candidate-target-projection-drift`。
export function pruneExpiredReviewConsents(registry: PendingReviewConsentRegistry, sessionKey: PendingReviewConsentSessionKey, now: () => number): void {
	const pendingReviewConsents = registry.get(sessionKey);
	if (pendingReviewConsents === undefined) return;
	for (const pending of [...pendingReviewConsents.values()]) {
		if (pending.expiresAt <= now()) expirePendingReviewConsent(pending, registry, sessionKey);
	}
}

export function reviewConsentDigest(consent: ReviewConsentEnvelope): string {
	return createHash("sha256").update(JSON.stringify(consent)).digest("hex");
}

export function reviewSessionManagerAndId(context: ExtensionContext): { manager: object; sessionId: string } | undefined {
	try {
		const manager = context.sessionManager as unknown as { getSessionId?: () => unknown };
		const sessionId = manager.getSessionId?.();
		if (typeof manager !== "object" || manager === null || typeof sessionId !== "string" || sessionId.length === 0) return undefined;
		return { manager, sessionId };
	} catch {
		return undefined;
	}
}

function isDirectOrdinaryReviewStart(parametersValue: unknown): boolean {
	try {
		const parameters = parseReviewControllerParameters(parametersValue);
		if (parameters.operation !== REVIEW_CONTROLLER_OPERATION.START) return false;
		const input = parseControllerJson(requiredControllerString(parameters, "input"), parameters.operation);
		return input.mode === REVIEW_MODE.ORDINARY;
	} catch {
		return false;
	}
}

export function isHostReviewConsentEligibleOperation(parametersValue: unknown): boolean {
	if (isDirectOrdinaryReviewStart(parametersValue)) return true;
	try {
		return parseReviewControllerParameters(parametersValue).operation === REVIEW_CONTROLLER_OPERATION.SELECT_INTENDED_UNTRACKED;
	} catch {
		return false;
	}
}

export function completedGrantedReviewConsent(outcome: Record<string, unknown>): boolean {
	if (
		outcome.operation !== REVIEW_CONTROLLER_OPERATION.ANSWER_CONSENT ||
		outcome.status !== undefined ||
		outcome.outcome !== undefined ||
		outcome.native_invocation_attempted === false ||
		outcome.mutation_performed === false ||
		outcome.lineage_created === false ||
		!isCanonicalProcessString(outcome.workspace_root)
	) return false;
	const result = outcome.result;
	if (!isRecord(result)) return false;
	const nonnegativeInteger = (value: unknown): boolean => Number.isInteger(value) && Number(value) >= 0;
	return isCanonicalProcessString(result.lineage_id) &&
		isCanonicalProcessString(result.state) &&
		isCanonicalProcessString(result.risk_tier) &&
		Array.isArray(result.selected_lenses) && result.selected_lenses.every(isCanonicalProcessString) &&
		nonnegativeInteger(result.changed_files) &&
		nonnegativeInteger(result.original_changed_lines) &&
		nonnegativeInteger(result.correction_budget) &&
		(result.action === "created" || result.action === "resumed" || result.action === "replayed" || result.action === "closed") &&
		typeof result.lenses_required === "boolean";
}

// gentle-pi#516：本会话不持有的绑定（已被应答、
// 已过期，或由另一个 Pi 会话或进程签发）过去会落到
// 普通的已协商 STATUS，其读起来与健康的前置
// "ready" 一模一样，把模型又送回 START 进行第二次同意提示。该
// 事实是本地的且在任何 provider 调用前已被证明，因此结果应指明
// 绑定与出口；当前 STATUS 只是作为上下文随行。
const STALE_CONSENT_BINDING_DIAGNOSTIC_CODE = {
	EXPIRED: "consent-binding-expired",
	ALREADY_CONSUMED: "consent-binding-already-consumed",
	UNKNOWN: "consent-binding-unknown",
} as const;

type StaleConsentBindingDiagnosticCode = (typeof STALE_CONSENT_BINDING_DIAGNOSTIC_CODE)[keyof typeof STALE_CONSENT_BINDING_DIAGNOSTIC_CODE];

interface StaleConsentBindingDiagnostics {
	code: StaleConsentBindingDiagnosticCode;
	message: string;
}

export function staleConsentBindingDiagnostics(binding: string, disposition: PendingReviewConsentDisposition | undefined): StaleConsentBindingDiagnostics {
	const exit = "Run START again for this candidate to obtain a fresh consent envelope and answer that envelope's binding once; do not resend this binding.";
	if (disposition === PENDING_REVIEW_CONSENT_DISPOSITION.EXPIRED) {
		return { code: STALE_CONSENT_BINDING_DIAGNOSTIC_CODE.EXPIRED, message: `consent binding ${binding} expired after ${PENDING_REVIEW_CONSENT_TTL_MS / 60_000} minutes without an answer. ${exit}` };
	}
	if (disposition === PENDING_REVIEW_CONSENT_DISPOSITION.CONSUMED) {
		return { code: STALE_CONSENT_BINDING_DIAGNOSTIC_CODE.ALREADY_CONSUMED, message: `consent binding ${binding} was already consumed by an earlier answer. ${exit}` };
	}
	return { code: STALE_CONSENT_BINDING_DIAGNOSTIC_CODE.UNKNOWN, message: `consent binding ${binding} is not held by this Pi session. ${exit}` };
}

export function staleConsentBindingOutcome(operation: ReviewControllerOperation, binding: string, diagnostics: ReturnType<typeof staleConsentBindingDiagnostics>, status: ReviewStatusV3): Record<string, unknown> {
	const mapped = mapNativeTargetStatus(operation, status);
	return {
		...mapped,
		status: "blocked",
		outcome: "consent-binding-stale",
		consent_binding: binding,
		diagnostics,
		native_invocation_attempted: false,
		...nativeStartPreAuthorityRejection(),
		provider_action: status.action,
		...(status.action === "start" ? { next_action: "restart-for-fresh-consent" } : mapped.next_action === undefined ? { next_action: status.action } : {}),
	};
}

// gentle-pi#455 修正：跨会话解析仅凭绑定的
// 不透明 id 查找，因此必须独立确认应答
// 调用针对的是其属主 START 为之签发该绑定的同一个仓库。
// 这是一个与过期绑定结果同族的带类型、非持有者
// 拒绝——它从不运行模式门或原生
// answerConsent，也从不消耗绑定，因此之后仍可从
// 正确的仓库应答。
export function consentBindingRepositoryMismatchOutcome(operation: ReviewControllerOperation, binding: string, mintingRepositoryCwd: string, answeringRepositoryCwd: string): Record<string, unknown> {
	return {
		operation,
		status: "blocked",
		outcome: "consent-binding-repository-mismatch",
		consent_binding: binding,
		diagnostics: {
			code: "consent-binding-repository-mismatch",
			message: `consent binding ${binding} was minted for repository ${mintingRepositoryCwd}, not ${answeringRepositoryCwd}. Answer this binding from a session addressing ${mintingRepositoryCwd}; do not resend this binding from a different repository.`,
		},
		native_invocation_attempted: false,
		...nativeStartPreAuthorityRejection(),
		next_action: "answer-from-minting-repository",
	};
}

// gentle-pi#874：当前 STATUS 所拥有的 committed-range 选择器。在干净、
// 完全已提交的工作树上，无选择器的 STATUS 会以一个
// 指明 provider 所需确切 merge-base 的 review.start execute
// transition 作答，因此普通 START 可以采纳 provider 刚渲染的路由，
// 而不必让调用方手工把 `base-ref` 抄进输入。只读取
// provider 自己提供的参数——绝不猜测、不读持久化值、
// 不用过期 transition——且任何不是完整 commit id 配对
// committed-only 的内容都会被拒绝，因此其他所有 STATUS 保持
// 今日行为逐字节不变。
const OFFERED_COMMITTED_RANGE_BASE_REF = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i;

export function offeredCommittedRangeBaseRef(target: ReviewStatusV3): string | undefined {
	const execute = target.nextTransition?.kind === "execute" ? target.nextTransition.execute : undefined;
	if (execute?.operation !== "review.start") return undefined;
	if (execute.arguments.some((argument) => argument.name === "workspace-overlay")) return undefined;
	const baseRef = execute.arguments.find((argument) => argument.name === "base-ref")?.value;
	if (baseRef === undefined || !OFFERED_COMMITTED_RANGE_BASE_REF.test(baseRef)) return undefined;
	if (execute.arguments.find((argument) => argument.name === "committed-only")?.value !== "true") return undefined;
	return baseRef;
}

export function assertNativeStartCandidateBinding(candidateView: CandidateView, target: ReviewStatusV3): void {
	candidateView.verify();
	if (
		target.projection.projection !== "workspace" ||
		target.projection.baseTree !== candidateView.baseTree ||
		target.projection.initialReviewTree !== candidateView.candidateTree ||
		target.projection.currentCandidateTree !== candidateView.candidateTree ||
		JSON.stringify([...target.projection.paths].sort()) !== JSON.stringify([...candidateView.paths].sort()) ||
		(candidateView.intendedUntracked !== undefined && JSON.stringify([...target.projection.intendedUntracked].sort()) !== JSON.stringify([...candidateView.intendedUntracked].sort()))
	) {
		throw new CandidateViewError("native START workspace target does not match the immutable reviewer candidate view", "candidate-target-projection-drift");
	}
}
