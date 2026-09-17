import type { NativeReviewCli, NativeReviewModeRequest, NativeReviewModeResult, NativeReviewAssessRequest, NativeSddAcquireRequest, NativeSddAttemptResult, NativeSddSettleRequest, NativeSddStatusRequest, NativeSddStatusV2, NativeStartRequest, NativeStartResult, NativeReviewConsentAnswerRequest, NativeReviewConsentAnswerResult, NativeReviewAbandonRequest, NativeReviewReclaimRequest, NativeReviewRecoverRequest, NativeReviewReconcileAuthorityRequest, NativeReviewRecoveryResult, NativeReviewCorrectionPlanCaptureRequest, NativeReviewAcknowledgeApprovedRequest, NativeReviewAcknowledgeApprovedOutcome } from "./native-review-cli.ts";
import { NativeReviewConsentRequiredError, REVIEW_EMPTY_CANDIDATE_HINT, consentInvocationArguments, nativeRiskEvidencePhrases, nativeUntrackedSelection, isCanonicalProcessString } from "./native-review-cli.ts";
import type { ReviewLastEventClosureV1, ReviewStatusV3 } from "./review-integration-v2.ts";
import type { ReviewAssessmentV1 } from "./review-risk-assessment.ts";
import { resolveJeroAuthorityContextV1, type JeroAuthorityContextV1 } from "./authority/review.ts";
import { jeroSddStatusV1, type JeroSddStatusV2 } from "./authority/sdd-status.ts";
import { jeroSddContinueV1 } from "./authority/sdd-continue.ts";
import { reviewStatusV1 } from "./authority/status.ts";
import { reviewStartV1, type JeroReviewStartResultV1 } from "./authority/start.ts";
import { deriveJeroReviewSnapshotV1, jeroReviewPolicyHashV1 } from "./authority/snapshots.ts";
import { projectJeroClosureToWireV1, projectJeroConsentEnvelopeV1, projectJeroStatusToWireV1 } from "./authority/wire.ts";
import { getJeroReviewModeV1, setJeroReviewModeV1 } from "./authority/mode.ts";
import { assessJeroReviewRiskV1 } from "./authority/risk-assess.ts";
import { acquireJeroSddAttemptV1, settleJeroSddAttemptV1 } from "./authority/sdd-attempt.ts";
import { reviewAcknowledgeV1 } from "./authority/acknowledge.ts";
import { reviewFinalizeV1 } from "./authority/finalize.ts";
import { abandonJeroLineageV1, reclaimJeroAuthorityV1, recoverJeroLineageV1, reconcileJeroAuthorityV1, type JeroMaintenanceResultV1 } from "./authority/maintenance.ts";
import { buildJeroLastEventClosureV1 } from "./authority/closures.ts";

// P4d: the in-process authority adapter over the NativeReviewCli surface.
// Served here: the SDD projection pair (P4c), the review STATUS read path
// (targetStatus), the RDD mode pair, the read-only risk assessment, the SDD
// attempt pair, the START pair (P4d-e: direct starts plus the consent
// ceremony, envelope minted wire-side, answer re-freezes the bound
// candidate), and since P4d-g the correction-plan capture, the acknowledge
// burn, and the maintenance quartet. Still on the fail-closed P1 stub: the
// provider role vectors (refuter/validation relay execution - see
// _tools/p4-f-g-capture-maintenance-analysis.md Q-B) and the unachievable-
// lens declaration (Q-C: no authority-side write op) - every served method
// is typed-union in, wire record out, with authority refusals surfacing as
// errors carrying the typed code.

function projectV2(status: JeroSddStatusV2): NativeSddStatusV2 {
	return status as unknown as NativeSddStatusV2;
}

function contextOrThrow(cwd: string): JeroAuthorityContextV1 {
	const resolution = resolveJeroAuthorityContextV1(cwd);
	if (resolution.kind !== "ok") throw new Error(`authority-unavailable: the jero authority refused to resolve ${cwd}: ${resolution.code}${resolution.detail === undefined ? "" : ` (${resolution.detail})`}`);
	return resolution.context;
}

function refusalDetail(kind: string, code: string, detail?: string): string {
	return `authority-unavailable: ${kind} refused: ${code}${detail === undefined ? "" : ` (${detail})`}`;
}

export function createJeroAuthoritySddCli(): Pick<NativeReviewCli, "sddStatus" | "sddContinue"> {
	return {
		async sddStatus(request: NativeSddStatusRequest): Promise<NativeSddStatusV2> {
			const result = jeroSddStatusV1(contextOrThrow(request.workspaceRoot), { changeName: request.changeName, workspaceRoot: request.workspaceRoot });
			if (result.kind === "refused") throw new Error(refusalDetail("sdd status", result.code, result.detail));
			return projectV2(result.status);
		},
		async sddContinue(request: NativeSddStatusRequest): Promise<NativeSddStatusV2> {
			if (request.changeName === undefined || request.changeName.trim() === "") throw new Error("authority-unavailable: SDD continuation requires an exact selected change");
			const result = jeroSddContinueV1(contextOrThrow(request.workspaceRoot), { changeName: request.changeName, workspaceRoot: request.workspaceRoot });
			if (result.kind === "refused") throw new Error(refusalDetail("sdd continue", result.code, result.detail));
			return projectV2(result.status);
		},
	};
}

type JeroStartAuthorityArmV1 = Extract<JeroReviewStartResultV1, { lineage_id: string }>;

function isStartAuthorityArmV1(result: JeroReviewStartResultV1): result is JeroStartAuthorityArmV1 {
	return result.kind === "created" || result.kind === "resumed" || result.kind === "replayed" || result.kind === "closed";
}

// Mirrors the old client's fail-fast request discipline (native-review-cli
// parity): pairing and shape errors are TypeErrors thrown before the
// authority is touched, so no half-validated request ever freezes state.
function assertStartRequestV1(request: NativeStartRequest): void {
	if (request.baseRef !== undefined && !isCanonicalProcessString(request.baseRef)) throw new TypeError("Native START baseRef must be a non-empty, trimmed, NUL-free string");
	if (request.baseRef !== undefined && request.committedOnly !== true) throw new TypeError("Native START baseRef requires explicit committedOnly acknowledgement");
	if (request.baseRef === undefined && request.committedOnly !== undefined) throw new TypeError("Native START committedOnly requires an explicit baseRef");
	if (request.targetIdentity !== undefined && !/^sha256:[0-9a-f]{64}$/.test(request.targetIdentity)) throw new TypeError("Native START targetIdentity must be a canonical sha256 identity");
	nativeUntrackedSelection(request);
}

function projectStartOutcomeV1(result: JeroReviewStartResultV1, request: Pick<NativeStartRequest, "cwd" | "baseRef" | "untrackedScope" | "expectedUntrackedInventory" | "intendedUntracked">): NativeStartResult {
	if (result.kind === "refused") throw new Error(refusalDetail("review start", result.code, result.detail));
	if (result.kind === "consent_required") {
		// The wire envelope is the only surface the controller's pending
		// registry, digest binding, and answer path can consume; minting it
		// wire-side keeps the authority free of UI copy (9.1 boundary).
		throw new NativeReviewConsentRequiredError(projectJeroConsentEnvelopeV1(result, request));
	}
	if (result.kind === "declined") throw new Error("authority-unavailable: review start returned a declined answer on a consent-less request");
	if (result.kind === "blocked-scope-action") {
		return {
			lineageId: "",
			state: "unreviewed",
			riskLevel: "",
			selectedLenses: [],
			changedFiles: 0,
			changedLines: 0,
			correctionBudget: 0,
			action: "blocked-scope-action",
			lensesRequired: false,
			hint: `${result.reason} (fresh intended-untracked inventory: ${result.expected_untracked_inventory})`,
		};
	}
	const evidence = nativeRiskEvidencePhrases(result.risk_level, result.risk_reasons);
	return {
		lineageId: result.lineage_id,
		state: result.state,
		riskLevel: result.risk_level,
		selectedLenses: [...result.selected_lenses],
		changedFiles: result.changed_files,
		changedLines: result.changed_lines,
		correctionBudget: result.correction_budget,
		action: result.kind,
		lensesRequired: result.lenses_required,
		riskReasons: result.risk_reasons.map((reason) => ({ ...reason })),
		...(evidence.length === 0 ? {} : { riskEvidence: [...evidence] }),
		// Old-client parity: only the empty-candidate recovery hint is
		// reconstructed; a committed-only start reporting zero changes is a
		// real answer, not a recovery pointer.
		...(result.changed_files === 0 && request.baseRef === undefined ? { hint: REVIEW_EMPTY_CANDIDATE_HINT } : {}),
	};
}

// Re-parses the untracked selection the minted invocation embedded, so the
// consent answer re-freezes the exact candidate the question was asked for
// (flag form matches nativeUntrackedSelectionArguments: --flag=value).
function consentUntrackedSelectionV1(arguments_: readonly string[]): { untrackedScope?: "exclude" | "select"; expectedUntrackedInventory?: string; intendedUntracked?: readonly string[] } {
	let untrackedScope: "exclude" | "select" | undefined;
	let expectedUntrackedInventory: string | undefined;
	const intendedUntracked: string[] = [];
	for (const token of arguments_) {
		if (token.startsWith("--untracked-scope=")) untrackedScope = token.slice("--untracked-scope=".length) === "select" ? "select" : "exclude";
		else if (token.startsWith("--expected-untracked-inventory=")) expectedUntrackedInventory = token.slice("--expected-untracked-inventory=".length);
		else if (token.startsWith("--intended-untracked=")) intendedUntracked.push(token.slice("--intended-untracked=".length));
	}
	if (untrackedScope === undefined) return {};
	return { untrackedScope, expectedUntrackedInventory, intendedUntracked };
}

// P4d-g shared parsers: the provider-issued --name=value binding tokens the
// burn vector and the correction-plan submission carry. Each flag must appear
// exactly once; a forged or replayed envelope drifts and fails closed.
function exactFlagValueV1(tokens: readonly string[], flag: string): string | undefined {
	const values: string[] = [];
	for (let index = 0; index < tokens.length; index += 1) {
		const token = tokens[index]!;
		if (token === `--${flag}`) values.push(tokens[index + 1] ?? "");
		else if (token.startsWith(`--${flag}=`)) values.push(token.slice(flag.length + 3));
	}
	if (values.length > 1) throw new TypeError(`authority-unavailable: ${flag} appears more than once in the provider binding`);
	return values[0];
}

function parseBurnTokensV1(tokens: readonly string[]): { cwd: string; lineage: string; target: string; expectedRevision: string; token: string } {
	const cwd = exactFlagValueV1(tokens, "cwd");
	const lineage = exactFlagValueV1(tokens, "lineage");
	const target = exactFlagValueV1(tokens, "target");
	const expectedRevision = exactFlagValueV1(tokens, "expected-revision");
	const burnToken = exactFlagValueV1(tokens, "token");
	if (cwd === undefined || lineage === undefined || target === undefined || expectedRevision === undefined || burnToken === undefined) {
		throw new TypeError("authority-unavailable: the acknowledge binding must carry cwd, lineage, target, expected-revision, and token");
	}
	return { cwd, lineage, target, expectedRevision, token: burnToken };
}

function assertProviderTokensV1(tokens: readonly string[]): void {
	if (tokens.length === 0) throw new TypeError("authority-unavailable: provider-issued argument tokens are required");
	if (tokens.some((token) => typeof token !== "string" || token.length === 0)) throw new TypeError("authority-unavailable: provider argument tokens must all be non-empty strings");
}

function maintenanceOutcomeV1(result: JeroMaintenanceResultV1, kind: string): NativeReviewRecoveryResult {
	if (result.kind === "refused") throw new Error(refusalDetail(kind, result.code, result.detail));
	return { record: result.auditRecord };
}

/** The P4d-served slice of the NativeReviewCli surface. */
export function createJeroAuthorityReviewCli(): Pick<NativeReviewCli, "sddStatus" | "sddContinue" | "targetStatus" | "reviewMode" | "assess" | "sddAttemptAcquire" | "sddAttemptSettle" | "start" | "answerConsent" | "captureCorrectionPlan" | "abandon" | "reclaim" | "recover" | "reconcileAuthority"> & { acknowledgeApproved?(request: NativeReviewAcknowledgeApprovedRequest): Promise<NativeReviewAcknowledgeApprovedOutcome> } {
	return {
		...createJeroAuthoritySddCli(),
		async targetStatus(request: { cwd: string; projection?: "workspace" | "staged"; baseRef?: string; committedOnly?: boolean; signal?: AbortSignal }): Promise<ReviewStatusV3> {
			const context = contextOrThrow(request.cwd);
			const result = reviewStatusV1(context, {
				cwd: request.cwd,
				...(request.baseRef === undefined ? {} : { baseRef: request.baseRef, committedOnly: true }),
				...(request.projection === undefined ? {} : { projection: request.projection }),
			});
			if (result.kind === "refused") throw new Error(refusalDetail("review status", result.code, result.detail));
			// The wire projection descriptor needs the live derivation the
			// authority computed internally; re-derive with identical options.
			const derivation = deriveJeroReviewSnapshotV1({
				cwd: request.cwd,
				mode: "ordinary",
				candidate: request.projection === "staged"
					? { kind: "staged" }
					: request.committedOnly === true && request.baseRef !== undefined ? { kind: "base-diff", baseRef: request.baseRef } : { kind: "workspace" },
				policyHash: jeroReviewPolicyHashV1("ordinary"),
			});
			return projectJeroStatusToWireV1(result, derivation);
		},
		async reviewMode(request: NativeReviewModeRequest): Promise<NativeReviewModeResult> {
			const outcome = request.operation === "status"
				? getJeroReviewModeV1(request.cwd)
				: setJeroReviewModeV1(request.cwd, request.operation === "enable" ? "on" : "off");
			if (outcome.kind === "refused") throw new Error(refusalDetail("review mode", outcome.code, outcome.detail));
			return outcome.result as unknown as NativeReviewModeResult;
		},
		async assess(request: NativeReviewAssessRequest): Promise<ReviewAssessmentV1> {
			return assessJeroReviewRiskV1({ cwd: request.cwd, ...(request.baseRef === undefined ? {} : { baseRef: request.baseRef, committedOnly: true }) });
		},
		async start(request: NativeStartRequest): Promise<NativeStartResult> {
			assertStartRequestV1(request);
			const result = reviewStartV1(contextOrThrow(request.cwd), {
				cwd: request.cwd,
				...(request.baseRef === undefined ? {} : { baseRef: request.baseRef, committedOnly: true }),
				...(request.lineageId === undefined ? {} : { lineageId: request.lineageId }),
				...(request.targetIdentity === undefined ? {} : { targetIdentity: request.targetIdentity }),
				...(request.projection === undefined ? {} : { projection: request.projection }),
			}, {
				...(request.untrackedScope === undefined ? {} : { untrackedScope: request.untrackedScope }),
				...(request.expectedUntrackedInventory === undefined ? {} : { expectedUntrackedInventory: request.expectedUntrackedInventory }),
				...(request.intendedUntracked === undefined ? {} : { intendedUntracked: request.intendedUntracked }),
				...(request.intendedUntrackedSelection === undefined ? {} : { intendedUntrackedSelection: request.intendedUntrackedSelection }),
			});
			return projectStartOutcomeV1(result, request);
		},
		async answerConsent(request: NativeReviewConsentAnswerRequest): Promise<NativeReviewConsentAnswerResult> {
			// The one-shot binding discipline (agent, contract, cwd, target,
			// projection, answer, at most one lineage) is enforced by the same
			// parser the old client used; the invocation is the minted vector,
			// so any drift here is a forged envelope.
			const invocation = consentInvocationArguments(request);
			const result = reviewStartV1(contextOrThrow(request.cwd), {
				cwd: request.cwd,
				targetIdentity: request.consent.targetIdentity,
				projection: request.consent.projection,
				...(invocation.lineageId === undefined ? {} : { lineageId: invocation.lineageId }),
			}, {
				...consentUntrackedSelectionV1(invocation.arguments_),
				consent: request.answer,
			});
			if (result.kind === "declined") {
				return {
					kind: "declined",
					targetIdentity: request.consent.targetIdentity,
					projection: request.consent.projection,
					riskLevel: request.consent.riskLevel,
					changedFiles: request.consent.changedFiles,
					changedLines: request.consent.changedLines,
					consent: "declined_this_candidate",
					raw: request.consent.raw,
				};
			}
			if (isStartAuthorityArmV1(result)) {
				if (result.target_identity !== request.consent.targetIdentity) throw new Error(refusalDetail("consent answer", "identity-mismatch", "the frozen candidate no longer matches the consent target"));
				if (invocation.lineageId !== undefined && result.lineage_id !== invocation.lineageId) throw new Error(refusalDetail("consent answer", "identity-mismatch", "the started lineage does not match the consent binding"));
				return { kind: "started", start: projectStartOutcomeV1(result, { cwd: request.cwd }) };
			}
			// A granted answer that re-enters the gate (mode flipped, store
			// state changed underneath) is a binding violation, not a fresh
			// question: the envelope was already consumed once.
			throw new Error(refusalDetail("consent answer", result.kind === "refused" ? result.code : result.kind, result.kind === "refused" ? result.detail : "a granted consent answer must start the frozen candidate"));
		},
		async captureCorrectionPlan(request: NativeReviewCorrectionPlanCaptureRequest): Promise<ReviewLastEventClosureV1> {
			assertProviderTokensV1(request.argumentTokens);
			if (!Number.isSafeInteger(request.correctionLines) || request.correctionLines < 1 || request.correctionLines > 200) throw new TypeError("authority-unavailable: correction lines must be a positive integer up to 200");
			const valueIndex = request.argumentTokens.findIndex((token) => token.includes("{{value}}"));
			if (valueIndex < 0 || request.argumentTokens.filter((token) => token.includes("{{value}}")).length !== 1) throw new TypeError("authority-unavailable: the correction-plan submission requires exactly one provider-issued {{value}} token");
			const argumentTokens = request.argumentTokens.map((token, index) => index === valueIndex ? token.replaceAll("{{value}}", String(request.correctionLines)) : token);
			const lineage = exactFlagValueV1(argumentTokens, "lineage");
			const requestHash = exactFlagValueV1(argumentTokens, "request-hash");
			if (lineage === undefined || requestHash === undefined) throw new TypeError("authority-unavailable: the correction-plan binding must carry lineage and request-hash");
			const context = contextOrThrow(request.cwd);
			const result = reviewFinalizeV1(context, { cwd: request.cwd, lineageId: lineage, correction_line_forecast: request.correctionLines });
			if (result.kind === "refused") throw new Error(refusalDetail("correction plan", result.code, result.detail));
			if (result.kind !== "fix_authorized") throw new Error(`authority-unavailable: correction plan capture expected fix_authorized (got ${result.kind})`);
			const loaded = context.lineages.load(lineage);
			if (loaded.kind !== "ok") throw new Error(refusalDetail("correction plan", loaded.kind, "the corrected lineage could not be reloaded"));
			const closure = buildJeroLastEventClosureV1({ operation: "review.capture-correction-plan", record: loaded.record, state: "correction_required", cwd: request.cwd, requestHash, correctionLines: request.correctionLines });
			return projectJeroClosureToWireV1(closure) as unknown as ReviewLastEventClosureV1;
		},
		async acknowledgeApproved(request: NativeReviewAcknowledgeApprovedRequest): Promise<NativeReviewAcknowledgeApprovedOutcome> {
			assertProviderTokensV1(request.argumentTokens);
			if (request.argumentTokens.some((token) => token.includes("{{value}}"))) throw new TypeError("authority-unavailable: acknowledge tokens carry no caller-substituted value");
			const parsed = parseBurnTokensV1(request.argumentTokens);
			if (request.binding !== undefined && parsed.lineage !== request.binding.lineageId) throw new Error(refusalDetail("acknowledge", "binding-mismatch", "the burn vector lineage does not match the held STATUS binding"));
			const result = reviewAcknowledgeV1(contextOrThrow(request.cwd), { cwd: request.cwd, lineageId: parsed.lineage, targetIdentity: parsed.target, expectedRevision: parsed.expectedRevision, token: parsed.token });
			if (result.kind === "refused") throw new Error(refusalDetail("acknowledge", result.code, result.detail));
			return {
				schema: "gentle-ai.review-acknowledged/v1",
				operation: "review/acknowledge-approved",
				action: "acknowledged",
				lineageId: result.result.lineage_id,
				targetIdentity: result.result.target_identity,
				consumedRevision: result.result.consumed_revision,
				authority: "burned",
				raw: result.result as unknown as Record<string, unknown>,
			};
		},
		async abandon(request: NativeReviewAbandonRequest): Promise<NativeReviewRecoveryResult> {
			const result = abandonJeroLineageV1(contextOrThrow(request.cwd), {
				lineage: request.lineage, expectedRevision: request.expectedRevision, snapshotIdentity: request.snapshotIdentity,
				capturedLensResults: [...request.capturedLensResults], findingsPresent: request.findingsPresent,
				actor: request.actor, reason: request.reason, maintainerAuthorization: request.maintainerAuthorization,
			});
			return maintenanceOutcomeV1(result, "abandon");
		},
		async reclaim(request: NativeReviewReclaimRequest): Promise<NativeReviewRecoveryResult> {
			const result = reclaimJeroAuthorityV1(contextOrThrow(request.cwd), { lineage: request.lineage, actor: request.actor, reason: request.reason });
			return maintenanceOutcomeV1(result, "reclaim");
		},
		async recover(request: NativeReviewRecoverRequest): Promise<NativeReviewRecoveryResult> {
			const result = recoverJeroLineageV1(contextOrThrow(request.cwd), {
				predecessorLineage: request.predecessorLineage, expectedPredecessorRevision: request.expectedPredecessorRevision,
				successorLineage: request.successorLineage, disposition: request.disposition,
				actor: request.actor, reason: request.reason,
				...(request.maintainerAuthorization === undefined ? {} : { maintainerAuthorization: request.maintainerAuthorization }),
			});
			return maintenanceOutcomeV1(result, "recover");
		},
		async reconcileAuthority(request: NativeReviewReconcileAuthorityRequest): Promise<NativeReviewRecoveryResult> {
			const result = reconcileJeroAuthorityV1(contextOrThrow(request.cwd), {
				predecessorLineage: request.predecessorLineage, expectedPredecessorRevision: request.expectedPredecessorRevision,
				successorLineage: request.successorLineage, expectedSuccessorRevision: request.expectedSuccessorRevision,
				actor: request.actor, reason: request.reason,
				...(request.anomalies === undefined ? {} : { anomalies: request.anomalies }),
				maintainerAuthorization: request.maintainerAuthorization,
			});
			return maintenanceOutcomeV1(result, "reconcile");
		},
		async sddAttemptAcquire(request: NativeSddAcquireRequest): Promise<NativeSddAttemptResult> {
			const context = contextOrThrow(request.workspaceRoot);
			const result = acquireJeroSddAttemptV1(context, {
				workspaceRoot: request.workspaceRoot,
				changeName: request.changeName,
				requestId: request.requestId,
				workUnit: request.workUnit,
				evidenceGoal: request.evidenceGoal,
				...(request.maxAttempts === undefined ? {} : { maxAttempts: request.maxAttempts }),
				...(request.maxChangedLines === undefined ? {} : { maxChangedLines: request.maxChangedLines }),
				...(request.expectedRevision === undefined ? {} : { expectedRevision: request.expectedRevision }),
				...(request.token === undefined ? {} : { token: request.token }),
				...(request.remediatesEvidenceRevision === undefined ? {} : { remediatesEvidenceRevision: request.remediatesEvidenceRevision }),
				...(request.untrackedScope === undefined ? {} : { untrackedScope: request.untrackedScope }),
				...(request.expectedUntrackedInventory === undefined ? {} : { expectedUntrackedInventory: request.expectedUntrackedInventory }),
				...(request.intendedUntracked === undefined ? {} : { intendedUntracked: request.intendedUntracked }),
			});
			return attemptResultV1(result);
		},
		async sddAttemptSettle(request: NativeSddSettleRequest): Promise<NativeSddAttemptResult> {
			const context = contextOrThrow(request.workspaceRoot);
			const result = settleJeroSddAttemptV1(context, {
				workspaceRoot: request.workspaceRoot,
				changeName: request.changeName,
				requestId: request.requestId,
				token: request.token,
				outcome: request.outcome,
				...(request.evidenceRevision === undefined ? {} : { evidenceRevision: request.evidenceRevision }),
				...(request.remediationEvidence === undefined ? {} : { remediationEvidence: request.remediationEvidence }),
				diagnosis: request.diagnosis,
				harnessDisposition: request.harnessDisposition,
				cleanupEvidence: request.cleanupEvidence,
				processEvidence: request.processEvidence,
				...(request.untrackedScope === undefined ? {} : { untrackedScope: request.untrackedScope }),
				...(request.expectedUntrackedInventory === undefined ? {} : { expectedUntrackedInventory: request.expectedUntrackedInventory }),
				...(request.intendedUntracked === undefined ? {} : { intendedUntracked: request.intendedUntracked }),
			});
			return attemptResultV1(result);
		},
	};
}

function attemptResultV1(result: ReturnType<typeof acquireJeroSddAttemptV1>): NativeSddAttemptResult {
	if (result.kind === "refused") throw new Error(refusalDetail("sdd attempt", result.code, result.detail));
	return { state: result.state, ...(result.token === undefined ? {} : { token: result.token }), ...(result.reason === undefined ? {} : { reason: result.reason }) };
}
