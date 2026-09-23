// review-controller-native-routing 测试共享夹具与助手：自 review-controller-native-routing.test.ts 机械平移（语义零改动）。

import { default as assert } from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
	chmodSync, default as fs, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync,
	writeFileSync
} from "node:fs";
import { default as fsp } from "node:fs/promises";
import { default as os, tmpdir } from "node:os";
import { syncBuiltinESMExports } from "node:module";
import { dirname, join, resolve, sep } from "node:path";
import { default as test } from "node:test";
import { type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { __testing, createJeroAiExtension, PendingReviewConsentRegistry } from "../extensions/jero-ai.ts";
import { CandidateViewRegistry } from "../lib/review-candidate-view.ts";
import { NATIVE_REVIEW_ERROR_CODE, type NativeReviewCli, NativeReviewCliError, NativeReviewConsentRequiredError } from "../lib/authority/client-contract.ts";
import { decodeReviewConsentV3, decodeReviewStatusV3, type ReviewCollectInputV3, type ReviewStatusV3 } from "../lib/authority/wire-contract.ts";
import { bindingOf, candidateRepository, correctionPlanInput, repository } from "./review-controller-native-routing.test.ts";
import { type RegisteredControllerTool, reviewContext, reviewRuntime, startStatus, untrackedStopFixture } from "./review-controller-native-routing.z2.test.ts";
import { fourLensCollectStatus, occurrences } from "./review-controller-native-routing.z3.test.ts";


export const SHA = `sha256:${"a".repeat(64)}`;
export const TREE = "b".repeat(40);

export function collectInput(lineageId: string): ReviewCollectInputV3 {
	const arguments_ = [
		{ name: "lineage", value: lineageId, token: `--lineage=${lineageId}` },
		{ name: "expected-revision", value: SHA, token: `--expected-revision=${SHA}` },
		{ name: "target", value: SHA, token: `--target=${SHA}` },
		{ name: "repository-context", value: `rctx1_${"c".repeat(64)}`, token: `--repository-context=rctx1_${"c".repeat(64)}` },
		{ name: "lens", value: "review-risk", token: "--lens=review-risk" },
		{ name: "order", value: "0", token: "--order=0" },
		{ name: "subject-hash", value: SHA, token: `--subject-hash=${SHA}` },
	];
	return {
		name: "reviewer_result",
		schema: "https://gentle-ai.dev/schema/review/reviewer/v1",
		captureOperation: "review.capture-result",
		arguments: arguments_,
		artifactSubject: {
			schema: "gentle-ai.review-artifact-subject/v2",
			subjectHash: SHA,
			lineageId,
			authorityRevision: SHA,
			targetIdentity: SHA,
			baseTree: TREE,
			candidateTree: TREE,
			changedPathManifestSha256: SHA,
			lens: "review-risk",
			selectedOrder: 0,
		},
		submission: {
			operationToken: "capture-result",
			argumentTokens: [...arguments_.map((argument) => argument.token!), "--input={{value}}"],
			values: [{ slot: "reviewer_result", domain: "artifact_path_or_stdin", substitutionLocation: 7 }],
		},
	};
}

export function status(
	lineageId: string,
	inputs: readonly ReviewCollectInputV3[] = [collectInput(lineageId)],
	authorityState = "reviewing",
): ReviewStatusV3 {
	return {
		contract: "gentle-ai.review-integration/v2",
		applicability: "current_target",
		authority: { version: "compact-v2", lineageId, state: authorityState, generation: 1, revision: SHA },
		receipt: { status: "expected_missing" },
		action: "stop",
		replayability: "not_replayable",
		targetIdentity: SHA,
		projection: {
			schema: "gentle-ai.review-candidate-projection/v1",
			kind: "current-changes",
			projection: "workspace",
			baseTree: TREE,
			initialReviewTree: TREE,
			currentCandidateTree: TREE,
			pathsDigest: SHA,
			paths: ["app.ts"],
			intendedUntracked: [],
			intendedUntrackedProof: SHA,
			initialSnapshotIdentity: SHA,
			currentSnapshotIdentity: SHA,
		},
		repair: { schema: "gentle-ai.review-authority-repair-assessment/v1", status: "unsupported", counts: { lineages: 0, compactLineages: 0, legacyLineages: 0, events: 0, bytes: 0, eligibleCandidates: 0, unsupportedLineages: 0, conflicts: 0 }, supportedOperations: ["review/complete-fix", "review/validate-fix"], authorizationSchema: "gentle-ai.review-repair-authorization/v1" },
		candidates: [],
		nextTransition: { kind: "collect", reasonCode: "capture_required", collect: { inputs } },
		raw: { schema: "gentle-ai.review-integration.status/v5" },
	} as unknown as ReviewStatusV3;
}

export function approvedAcknowledgementStatus(lineageId: string, cwd = process.cwd()): ReviewStatusV3 {
	const arguments_ = [{ name: "cwd", value: cwd, token: `--cwd=${cwd}` }, { name: "lineage", value: lineageId, token: `--lineage=${lineageId}` }, { name: "target", value: SHA, token: `--target=${SHA}` }, { name: "expected-revision", value: SHA, token: `--expected-revision=${SHA}` }, { name: "token", value: "provider-issued-once", token: "--token=provider-issued-once" }];
	const approved = status(lineageId, [], "approved");
	approved.nextTransition = { kind: "execute", reasonCode: "approved_acknowledgement_required", execute: { operation: "review.acknowledge-approved", command: "gentle-ai review acknowledge-approved --provider-vector", arguments: arguments_, preconditions: [{ name: "state", value: "approved", token: "--state=approved" }], binding: { lineageId, targetIdentity: SHA, revision: SHA } } };
	return approved;
}

export function burnedAcknowledgementStatus(lineageId: string): ReviewStatusV3 {
	const burned = status(lineageId, [], "approved");
	burned.nextTransition = { kind: "stop", reasonCode: "approved_acknowledged" };
	return burned;
}

// gentle-pi#627: gentle-ai reports a stale managed-asset set as a typed stop
// carrying the exact `gentle-ai sync` invocation that resolves it.
export function managedAssetsOutdatedStatus(lineageId: string): ReviewStatusV3 {
	const stopped = status(lineageId, [], "approved");
	stopped.nextTransition = { kind: "stop", reasonCode: "managed_assets_outdated", continuation: { operation: "sync", command: "gentle-ai sync --agent claude-code", agent: "claude-code", staleAssets: ["orchestration/claude-code.md"] } };
	return stopped;
}

