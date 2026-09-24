// 夹具统一住 shared（分片互导会令被导入分片的顶层 test() 注册在导入方
// 进程里重跑一遍）；由 standing-permission-controller 拆分产生。

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";
import { Text, visibleWidth } from "@earendil-works/pi-tui";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createJeroAiExtension } from "../extensions/jero-ai.ts";
import { ChildStandingReviewPermissionClient, ParentStandingReviewPermissionBroker } from "../lib/review-session-standing-permission-ipc.ts";
import { captureReviewSessionIdentity, grantReviewSessionPermission, hasReviewSessionPermission, revokeReviewSessionPermissionsForSession } from "../lib/review-session-standing-permission.ts";
import { CandidateViewRegistry } from "../lib/review-candidate-view.ts";
// 进程加载即打桩 Windows ACL 权威：真实 PowerShell/icacls 栈只归候选视图
// 专属端到端用例管（见 review-candidate-view-shared.ts）；本文件用例只
// 验证候选视图之上的业务语义，打桩避免每个创建/清理周期数十次秒级子进程。
import "./review-candidate-view-shared.ts";
import { NativeReviewConsentRequiredError, type NativeReviewCli } from "../lib/authority/client-contract.ts";
import { decodeReviewConsentV2, decodeReviewConsentV3, type ReviewConsentEnvelope, type ReviewStatusV3 } from "../lib/authority/wire-contract.ts";
import {
	HOST_REVIEW_SESSION_PERMISSION_LABEL,
	formatReviewConsentUi,
	presentReviewConsentUi,
} from "../lib/review-consent-ui.ts";

export function consentFixture(): Record<string, unknown> {
	const path = join(process.cwd(), "tests", "fixtures", "devbinary", "consent-v3.captured.json");
	return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

export function consent() {
	const raw = consentFixture();
	raw.agent = "pi";
	return decodeReviewConsentV3(raw, "pi");
}

export function providerV2Consent() {
	const raw = consentFixture();
	delete raw.agent;
	raw.schema = "gentle-ai.review-integration.consent/v2";
	return decodeReviewConsentV2(raw);
}

export function nonPiV3Consent() {
	return decodeReviewConsentV3(consentFixture(), "claude-code");
}

export function consentCustom(select: (title: string, options: string[]) => Promise<string | undefined>) {
	return async (factory: (...args: unknown[]) => unknown) => {
		let result: unknown;
		const component = factory(
			{ terminal: { rows: 24 }, requestRender() {} },
			{ fg: (_color: string, text: string) => text, bold: (text: string) => text },
			undefined,
			(value: unknown) => { result = value; },
		) as { getActionOptions(): readonly string[]; render(width: number): string[]; handleInput?(data: string): void };
		component.render(80);
		const options = [...component.getActionOptions()];
		const selected = await select("", options);
		const index = options.indexOf(selected ?? "");
		if (index === -1) component.handleInput?.("\u001b");
		else {
			for (let current = 0; current < index; current += 1) {
				component.handleInput?.("\u001b[B");
				component.render(80);
			}
			component.handleInput?.("\r");
		}
		return result;
	};
}

export function reviewRepository(t: test.TestContext): string {
	const cwd = realpathSync(mkdtempSync(join(tmpdir(), "gentle-pi-session-consent-")));
	t.after(() => {
		try { execFileSync("chmod", ["-R", "u+w", cwd], { stdio: "ignore" }); } catch { /* best effort */ }
		rmSync(cwd, { recursive: true, force: true });
	});
	execFileSync("git", ["init", "-b", "main"], { cwd, stdio: "ignore" });
	writeFileSync(join(cwd, "app.ts"), "export const value = 1;\n");
	execFileSync("git", ["add", "app.ts"], { cwd, stdio: "ignore" });
	execFileSync("git", ["-c", "user.name=Consent Test", "-c", "user.email=consent@example.invalid", "commit", "-m", "base"], { cwd, stdio: "ignore" });
	writeFileSync(join(cwd, "app.ts"), "export const value = 2;\n");
	return cwd;
}

export function siblingWorktree(t: test.TestContext, parentRoot: string): string {
	const cwd = realpathSync(mkdtempSync(join(tmpdir(), "gentle-pi-session-consent-worktree-")));
	t.after(() => rmSync(cwd, { recursive: true, force: true }));
	execFileSync("git", ["worktree", "add", "-b", `permission-child-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, cwd, "HEAD"], { cwd: parentRoot, stdio: "ignore" });
	return cwd;
}

export function startStatus(cwd: string, intendedUntracked: readonly string[] = []): ReviewStatusV3 {
	const views = new CandidateViewRegistry();
	const candidate = views.create({
		contributorRoot: cwd,
		...(intendedUntracked.length === 0 ? {} : { intendedUntracked }),
	});
	try {
		return {
			contract: "gentle-ai.review-integration/v2",
			applicability: "unrelated",
			action: "start",
			replayability: "not_replayable",
			targetIdentity: `sha256:${"a".repeat(64)}`,
			projection: {
				schema: "gentle-ai.review-candidate-projection/v1",
				kind: "current-changes",
				projection: "workspace",
				baseTree: candidate.baseTree,
				initialReviewTree: candidate.candidateTree,
				currentCandidateTree: candidate.candidateTree,
				pathsDigest: `sha256:${"a".repeat(64)}`,
				paths: [...candidate.paths],
				intendedUntracked: [...intendedUntracked],
				intendedUntrackedProof: `sha256:${"a".repeat(64)}`,
				initialSnapshotIdentity: `sha256:${"a".repeat(64)}`,
				currentSnapshotIdentity: `sha256:${"a".repeat(64)}`,
			},
			candidates: [],
			raw: { schema: "gentle-ai.review-integration.status/v5" },
		} as unknown as ReviewStatusV3;
	} finally {
		views.cleanup(candidate.token);
	}
}

export function intendedUntrackedSelectionStatuses(cwd: string, eligible: string): { initial: ReviewStatusV3; selected: ReviewStatusV3 } {
	const initialTarget = startStatus(cwd);
	const selectedTarget = startStatus(cwd, [eligible]);
	const selection = {
		name: "intended_untracked_selection",
		schema: "gentle-ai.review-intended-untracked-selection/v1",
		captureOperation: "external.select_intended_untracked",
		arguments: [
			{ name: "target_identity", value: initialTarget.targetIdentity },
			{ name: "projection", value: "workspace" },
			{ name: "base_tree", value: initialTarget.projection.baseTree },
			{ name: "candidate_tree", value: initialTarget.projection.currentCandidateTree },
			{ name: "eligible_paths_json", value: JSON.stringify([eligible]) },
			{ name: "expected_untracked_inventory", value: "sha256:" + "a".repeat(64) },
		],
		submission: {
			operationToken: "status",
			argumentTokens: ["--contract=gentle-ai.review-integration/v2", "--next-transition=true", "--agent=pi", "--projection=workspace", "--intended-untracked-selection={{value}}"],
			values: [{ slot: "intended_untracked_selection", domain: "schema_bound_json", schema: "gentle-ai.review-intended-untracked-selection/v1", substitutionLocation: 4 }],
		},
	};
	return {
		initial: {
			...initialTarget,
			nextTransition: { kind: "collect", reasonCode: "intended_untracked_selection_required", collect: { inputs: [selection] } },
			raw: { schema: "gentle-ai.review-integration.status/v7" },
		} as unknown as ReviewStatusV3,
		selected: selectedTarget,
	};
}

export function piConsent() {
	const decoded = consent();
	return {
		...decoded,
		choices: decoded.choices.map((choice) => ({
			...choice,
			invocation: choice.invocation.replace(" --consent ", " --agent pi --consent "),
		})) as unknown as typeof decoded.choices,
	};
}

export function controllerHarness(cwd: string, processEnv: NodeJS.ProcessEnv = {}, options: {
	now?: () => number;
	answerConsentError?: Error & { mutationOutcome?: "none" | "unknown" };
	startAction?: "created" | "resumed" | "replayed" | "closed" | "blocked-scope-action";
	childStandingReviewPermissionClient?: ChildStandingReviewPermissionClient;
	consent?: ReviewConsentEnvelope;
	targetStatus?: (request: Record<string, unknown>) => Promise<ReviewStatusV3>;
} = {}) {
	const tools = new Map<string, RegisteredTool>();
	const commands = new Map<string, RegisteredCommand>();
	const events = new Map<string, RegisteredEvent>();
	const answers: string[] = [];
	const answerRequests: Array<{ cwd: string; consent: { raw: unknown }; answer: "granted" | "declined" }> = [];
	const permissionConsent = options.consent ?? piConsent();
	const native = {
		reviewMode: async () => ({ operation: "status", scope: "clone", status: { global: "", cloneLocal: "", effective: "on", source: "default" } }),
		targetStatus: async (request: Record<string, unknown>) => options.targetStatus?.(request) ?? startStatus(cwd),
		start: async () => { throw new NativeReviewConsentRequiredError(permissionConsent); },
		answerConsent: async (request: { cwd: string; consent: { raw: unknown }; answer: "granted" | "declined" }) => {
			answers.push(request.answer);
			answerRequests.push(request);
			if (options.answerConsentError !== undefined && answers.length === 1) throw options.answerConsentError;
			if (request.answer === "declined") return {
				kind: "declined",
				targetIdentity: permissionConsent.targetIdentity,
				projection: permissionConsent.projection,
				riskLevel: permissionConsent.riskLevel,
				changedFiles: permissionConsent.changedFiles,
				changedLines: permissionConsent.changedLines,
				consent: "declined_this_candidate",
				raw: { operation: "review/start", action: "declined", consent: "declined_this_candidate" },
			};
			const action = options.startAction ?? "closed";
			return { kind: "started", start: { lineageId: `lineage-${answers.length}`, state: action === "blocked-scope-action" ? "unreviewed" : "approved", riskLevel: "high", selectedLenses: [], changedFiles: 1, changedLines: 2, correctionBudget: 0, action, lensesRequired: false, riskReasons: [] } };
		},
	} as unknown as NativeReviewCli;
	createJeroAiExtension({ nativeReviewCli: native, candidateViews: new CandidateViewRegistry(), processEnv, now: options.now, childStandingReviewPermissionClient: options.childStandingReviewPermissionClient })({
		on(name: string, handler: RegisteredEvent) { events.set(name, handler); },
		registerCommand(name: string, definition: RegisteredCommand) { commands.set(name, definition); },
		registerTool(definition: RegisteredTool & { name: string }) { tools.set(definition.name, definition); },
		events: { emit() {} },
	} as unknown as ExtensionAPI);
	const controller = tools.get("jero_review");
	assert.ok(controller);
	return { controller: controller!, answers, answerRequests, consent: permissionConsent, commands, events };
}

export function interactiveContext(cwd: string, manager: object, select: (title: string, options: string[]) => Promise<string | undefined>, sessionId = "session-a"): ExtensionContext {
	return {
		cwd,
		mode: "tui",
		hasUI: true,
		sessionManager: Object.assign(manager, { getSessionId: () => sessionId }),
		ui: { custom: consentCustom(select), notify() {}, setStatus() {}, theme: { fg: (_color: string, text: string) => text } },
	} as unknown as ExtensionContext;
}

export interface RegisteredTool {
	execute(id: string, parameters: unknown, signal: undefined, onUpdate: undefined, context: ExtensionContext): Promise<{ details: Record<string, unknown> }>;
}

export interface RegisteredCommand {
	handler(args: string, context: ExtensionContext): Promise<void>;
}

export interface RegisteredEvent {
	(event: unknown, context: ExtensionContext): Promise<unknown> | unknown;
}
