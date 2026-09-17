import type { NativeReviewCli, NativeReviewModeRequest, NativeReviewModeResult, NativeReviewAssessRequest, NativeSddAcquireRequest, NativeSddAttemptResult, NativeSddSettleRequest, NativeSddStatusRequest, NativeSddStatusV2 } from "./native-review-cli.ts";
import type { ReviewStatusV3 } from "./review-integration-v2.ts";
import type { ReviewAssessmentV1 } from "./review-risk-assessment.ts";
import { resolveJeroAuthorityContextV1, type JeroAuthorityContextV1 } from "./authority/review.ts";
import { jeroSddStatusV1, type JeroSddStatusV2 } from "./authority/sdd-status.ts";
import { jeroSddContinueV1 } from "./authority/sdd-continue.ts";
import { reviewStatusV1 } from "./authority/status.ts";
import { deriveJeroReviewSnapshotV1, jeroReviewPolicyHashV1 } from "./authority/snapshots.ts";
import { projectJeroStatusToWireV1 } from "./authority/wire.ts";
import { getJeroReviewModeV1, setJeroReviewModeV1 } from "./authority/mode.ts";
import { assessJeroReviewRiskV1 } from "./authority/risk-assess.ts";
import { acquireJeroSddAttemptV1, settleJeroSddAttemptV1 } from "./authority/sdd-attempt.ts";

// P4d: the in-process authority adapter over the NativeReviewCli surface.
// Served here: the SDD projection pair (P4c), the review STATUS read path
// (targetStatus — the controller's INSPECT/STATUS routing, collect-binding
// rendering, and relay request building all consume the projected wire
// record), the RDD mode pair, the read-only risk assessment, and the SDD
// attempt pair. Still on the fail-closed P1 stub: START/FINALIZE/VALIDATE
// (their consent-envelope and finalize-input controller wiring is the
// remaining P4d seam) and the maintenance quartet's interactive approval
// flow — every served method is typed-union in, wire record out, with
// authority refusals surfacing as errors carrying the typed code.

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

/** The P4d-served slice of the NativeReviewCli surface. */
export function createJeroAuthorityReviewCli(): Pick<NativeReviewCli, "sddStatus" | "sddContinue" | "targetStatus" | "reviewMode" | "assess" | "sddAttemptAcquire" | "sddAttemptSettle"> {
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
