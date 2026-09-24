
// 嵌套检出（包目录位于仓库根之内）会让 process.cwd() ≠ git 顶层；控制器
// 按 worktree 收敛语义把 cwd 解析到 git 顶层，测试体内联的 process.cwd()
// 断言随之失败。进入一个"自身即 git 顶层"的 scratch 目录后再跑用例，
// 语义与常规检出（cwd == 仓库根）完全一致。
{
	const scratchRoot = mkdtempSync(join(tmpdir(), "native-routing-cwd-"));
	execFileSync("git", ["init", "-q", "-b", "main", "."], { cwd: scratchRoot, stdio: "ignore" });
	process.chdir(scratchRoot);
	process.on("exit", () => {
		try {
			process.chdir(tmpdir());
			rmSync(scratchRoot, { recursive: true, force: true });
		} catch {
			/* 退出路径清理尽力而为 */
		}
	});
}

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
// 进程加载即打桩 Windows ACL 权威：真实 PowerShell/icacls 栈只归候选视图
// 专属端到端用例管（见 review-candidate-view-shared.ts）；本家族用例只
// 验证候选视图之上的业务语义，打桩避免每个创建/清理周期数十次秒级子进程。
import "./review-candidate-view-shared.ts";
import { NATIVE_REVIEW_ERROR_CODE, type NativeReviewCli, NativeReviewCliError, NativeReviewConsentRequiredError } from "../lib/authority/client-contract.ts";
import { decodeReviewConsentV3, decodeReviewStatusV3, type ReviewCollectInputV3, type ReviewStatusV3 } from "../lib/authority/wire-contract.ts";


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

// 跨分片助手必须住在 shared：分片互为导入时，被导入分片的顶层 test()
// 注册会在导入方进程里重跑一遍（.test ↔ z2 曾构成循环导入），整个
// 家族的用例被成倍执行（同见 review-candidate-view-shared.ts 注）。

export interface RegisteredControllerTool {
	execute: (toolCallId: string, params: unknown, signal: AbortSignal | undefined, onUpdate: undefined, ctx: ExtensionContext) => Promise<{ details?: unknown }>;
}

export function correctionPlanInput(lineageId: string): ReviewCollectInputV3 {
	const arguments_ = [{ name: "lineage", value: lineageId, token: `--lineage=${lineageId}` }, { name: "target", value: SHA, token: `--target=${SHA}` }];
	return { name: "correction_plan", schema: "https://gentle-ai.dev/schema/review/correction-plan/v1", captureOperation: "review.capture-correction-plan", arguments: arguments_, submission: { operationToken: "capture-correction-plan", argumentTokens: [`--lineage=${lineageId}`, "--correction-lines={{value}}"], values: [{ slot: "correction_lines", domain: "integer", substitutionLocation: 1, minimum: 1, maximum: 200 }] } } as unknown as ReviewCollectInputV3;
}

export function bindingOf(result: Record<string, unknown>): string {
	return (result.collectBindings as readonly { collectBinding: string }[])[0]!.collectBinding;
}

export function repository(t: test.TestContext): string {
	const cwd = realpathSync(mkdtempSync(join(tmpdir(), "gentle-pi-native-routing-")));
	t.after(() => {
		execFileSync("chmod", ["-R", "u+rwx", cwd], { stdio: "ignore" });
		chmodSync(cwd, 0o700);
		rmSync(cwd, { recursive: true, force: true });
	});
	execFileSync("git", ["init", "-b", "main"], { cwd, stdio: "ignore" });
	writeFileSync(join(cwd, "tracked.txt"), "base\n");
	execFileSync("git", ["add", "tracked.txt"], { cwd, stdio: "ignore" });
	execFileSync("git", ["-c", "user.name=Routing Test", "-c", "user.email=routing@example.invalid", "commit", "-m", "base"], { cwd, stdio: "ignore" });
	writeFileSync(join(cwd, "tracked.txt"), "candidate\n");
	return cwd;
}

export function reviewRuntime(nativeReviewCli: NativeReviewCli, candidateViews: CandidateViewRegistry) {
	const tools = new Map<string, RegisteredControllerTool>();
	let toolCall: ((event: { toolName: string; input: unknown }, ctx: ExtensionContext) => Promise<unknown>) | undefined;
	let sessionShutdown: ((event: unknown, ctx: ExtensionContext) => unknown) | undefined;
	createJeroAiExtension({ nativeReviewCli, candidateViews })({
		on(name: string, handler: (event: { toolName: string; input: unknown }, ctx: ExtensionContext) => Promise<unknown>) {
			if (name === "tool_call") toolCall = handler;
			if (name === "session_shutdown") sessionShutdown = handler as unknown as (event: unknown, ctx: ExtensionContext) => unknown;
		},
		registerTool(definition: RegisteredControllerTool & { name: string }) { tools.set(definition.name, definition); },
		registerCommand() {},
	} as unknown as ExtensionAPI);
	const controller = tools.get("jero_review");
	const capture = tools.get("jero_review_capture");
	assert.ok(controller);
	assert.ok(capture);
	assert.ok(toolCall);
	assert.ok(sessionShutdown);
	return { controller, capture, toolCall, sessionShutdown };
}

export function reviewContext(cwd: string): ExtensionContext {
	return { cwd, hasUI: false, ui: { confirm: async () => true } } as unknown as ExtensionContext;
}

export function startStatus(cwd: string, baseRef?: string, intendedUntracked: readonly string[] = []): ReviewStatusV3 {
	const candidateViews = new CandidateViewRegistry();
	const view = candidateViews.create({ contributorRoot: cwd, intendedUntracked, ...(baseRef === undefined ? {} : { baseRef, committedOnly: true }) });
	try {
		return {
			contract: "gentle-ai.review-integration/v2",
			applicability: "unrelated",
			action: "start",
			replayability: "not_replayable",
			targetIdentity: SHA,
			projection: {
				schema: "gentle-ai.review-candidate-projection/v1",
				kind: "current-changes",
				projection: "workspace",
				baseTree: view.baseTree,
				initialReviewTree: view.candidateTree,
				currentCandidateTree: view.candidateTree,
				pathsDigest: SHA,
				paths: [...view.paths],
				intendedUntracked: [...intendedUntracked],
				intendedUntrackedProof: SHA,
				initialSnapshotIdentity: SHA,
				currentSnapshotIdentity: SHA,
			},
			candidates: [],
			raw: { schema: "gentle-ai.review-integration.status/v5" },
		} as unknown as ReviewStatusV3;
	} finally {
		candidateViews.cleanup(view.token);
	}
}

