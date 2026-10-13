// 证据先行的修正生命周期，协议 v1.5。
//
// 普通评审恰好允许一个有界的修正事务。自 v1.5 起，提供方在提供
// `targeted_validation` 之前先收集绑定候选的验证证据，其记录的结局
// 决定随后三个终局分支中的哪一个。这些分支的区别在于各自的消耗：
// 只有 `procedural_tooling_failed` 终结生命周期，只有 `passed` 解锁
// 验证，而 `verification_failed` 必须分文不耗。
//
// 本模块刻意保持纯函数——无子进程、无文件系统、无时钟。证据目录
// 与预算台账归提供方所有；Pi 拥有的是决策，而基于数据做出的决策
// 无需活动二进制即可测试。被否决的替代方案是把这些分支内联到既有
// 验证条件旁边，那样单一修正不变量将由控制流而非数据来约束。

export const CORRECTION_OUTCOMES = Object.freeze(["passed", "verification_failed", "procedural_tooling_failed"] as const);
export type CorrectionOutcome = (typeof CORRECTION_OUTCOMES)[number];

export class CorrectionOutcomeError extends Error {
	constructor(received: unknown) {
		super(`review correction evidence outcome must be exactly one of ${CORRECTION_OUTCOMES.join(", ")}; received ${JSON.stringify(received)}`);
		this.name = "CorrectionOutcomeError";
	}
}

export class CorrectionEvidenceReplacedError extends Error {
	constructor(detail: string) {
		super(`correction-evidence-replaced: ${detail}`);
		this.name = "CorrectionEvidenceReplacedError";
	}
}

export interface CorrectionStatus {
	readonly lineageId: string;
	readonly targetIdentity: string;
	readonly authorityRevision: string;
	readonly correctionBudget: number;
	readonly changedLinesCharged: number;
}

export interface CorrectionEvidence {
	readonly outcome: string;
	readonly evidenceIdentity: string;
	readonly recordDigest: string;
	readonly candidateTree?: string;
	readonly rawPayloadSha256?: string;
}

interface CorrectionStepBase {
	readonly kind: string;
	readonly lineageId: string;
	readonly transactionOpen: boolean;
	readonly unlocksTargetedValidation: boolean;
}

export interface RunTargetedValidationStep extends CorrectionStepBase {
	readonly kind: "run-targeted-validation";
	readonly transactionOpen: false;
	readonly unlocksTargetedValidation: true;
	// 请求由提供方发出。Pi 为其重新查询 STATUS 而不是凭空捏造，
	// 因此该步骤点名它期望收集的操作。
	readonly expectCaptureOperation: "external.run_targeted_validation";
	readonly evidenceIdentity: string;
}

export interface RecaptureRequiredStep extends CorrectionStepBase {
	readonly kind: "recapture-required";
	readonly transactionOpen: true;
	readonly unlocksTargetedValidation: false;
	readonly attemptConsumed: false;
	readonly budgetConsumed: 0;
	readonly changedLinesCharged: number;
	readonly autoRetry: false;
	// 携带本次捕获所取代的身份。新捕获是强制性的：刻意不提供任何
	// 能让调用方以旧身份重新提交相同候选字节的字段。
	readonly supersedes: string;
	readonly requiresNewCapture: true;
	readonly guidance: string;
}

export interface TerminalEscalationStep extends CorrectionStepBase {
	readonly kind: "terminal-escalation";
	readonly transactionOpen: false;
	readonly unlocksTargetedValidation: false;
	readonly retryEligible: false;
	readonly launchesReviewer: false;
	readonly launchesValidator: false;
	readonly launchesCorrection: false;
	readonly escalation: string;
	readonly evidenceIdentity: string;
}

export type CorrectionStep = RunTargetedValidationStep | RecaptureRequiredStep | TerminalEscalationStep;

function requireOutcome(value: unknown): CorrectionOutcome {
	if (typeof value !== "string" || !(CORRECTION_OUTCOMES as readonly string[]).includes(value)) throw new CorrectionOutcomeError(value);
	return value as CorrectionOutcome;
}

export function resolveCorrectionStep(status: CorrectionStatus, evidence: CorrectionEvidence): CorrectionStep {
	const outcome = requireOutcome(evidence?.outcome);

	if (outcome === "passed") {
		return Object.freeze({
			kind: "run-targeted-validation",
			lineageId: status.lineageId,
			transactionOpen: false,
			unlocksTargetedValidation: true,
			expectCaptureOperation: "external.run_targeted_validation",
			evidenceIdentity: evidence.evidenceIdentity,
		} as const);
	}

	if (outcome === "verification_failed") {
		return Object.freeze({
			kind: "recapture-required",
			lineageId: status.lineageId,
			transactionOpen: true,
			unlocksTargetedValidation: false,
			attemptConsumed: false,
			budgetConsumed: 0,
			// 只上报、绝不重算：失败的验证不得朝任何方向挪动
			// 提供方已持有的账目。
			changedLinesCharged: status.changedLinesCharged,
			autoRetry: false,
			supersedes: evidence.evidenceIdentity,
			requiresNewCapture: true,
			guidance: "Verification failed. Change the candidate and capture new evidence; the correction transaction stays open and nothing has been charged. Do not retry the same bytes.",
		} as const);
	}

	return Object.freeze({
		kind: "terminal-escalation",
		lineageId: status.lineageId,
		transactionOpen: false,
		unlocksTargetedValidation: false,
		retryEligible: false,
		launchesReviewer: false,
		launchesValidator: false,
		launchesCorrection: false,
		escalation: "Procedural tooling failed while capturing verification evidence. This is a terminal escalation: no reviewer, correction, or validator runs afterwards, and retry eligibility is not considered. It needs one human decision.",
		evidenceIdentity: evidence.evidenceIdentity,
	} as const);
}

export interface DistinctEvidenceCheck {
	readonly prior: CorrectionEvidence;
	readonly next: CorrectionEvidence;
	// 早先记录是否仍可解析，以及其字节“现在”哈希成什么。
	// 两者都是调用方提供的观察结果；本函数只做判断而不做 IO，
	// 从而保持该不变量可做单元测试。
	readonly priorStillResolvable: boolean;
	readonly priorRecordDigestNow: string;
}

export function assertDistinctCorrectionEvidence(check: DistinctEvidenceCheck): void {
	const { prior, next, priorStillResolvable, priorRecordDigestNow } = check;

	if (next.evidenceIdentity === prior.evidenceIdentity) {
		throw new CorrectionEvidenceReplacedError(`the provider reused evidence identity ${prior.evidenceIdentity} for a second capture; each capture must land in its own immutable directory`);
	}
	if (!priorStillResolvable) {
		throw new CorrectionEvidenceReplacedError(`the earlier evidence record ${prior.evidenceIdentity} is no longer resolvable; a failed capture must survive alongside its successor, not be replaced`);
	}
	if (priorRecordDigestNow !== prior.recordDigest) {
		throw new CorrectionEvidenceReplacedError(`the earlier evidence record ${prior.evidenceIdentity} now digests to ${priorRecordDigestNow} instead of ${prior.recordDigest}; its bytes must be immutable`);
	}
}
