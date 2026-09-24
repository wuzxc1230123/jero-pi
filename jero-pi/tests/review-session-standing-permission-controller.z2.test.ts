// 重平衡分片：自原文件按 test 块对半机械平移（语义零改动）。

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

import { consentFixture, type RegisteredCommand, type RegisteredEvent, type RegisteredTool, consent, providerV2Consent, nonPiV3Consent, consentCustom, reviewRepository, siblingWorktree, startStatus, intendedUntrackedSelectionStatuses, piConsent, controllerHarness, interactiveContext } from "./review-session-standing-permission-controller-shared.ts";

test("successful decoded native START action variants remain eligible for a host grant", async (t) => {
	const cwd = reviewRepository(t);
	let candidate = 3;
	for (const action of ["created", "resumed", "replayed", "closed"] as const) {
		const runtime = controllerHarness(cwd, {}, { startAction: action });
		let prompts = 0;
		const ctx = interactiveContext(cwd, {}, async (_title, options) => {
			prompts += 1;
			return options[2];
		}, `session-${action}`);
		const start = { operation: "start", input: JSON.stringify({ mode: "ordinary" }) };
		await runtime.controller.execute(`${action}-grant`, start, undefined, undefined, ctx);
		writeFileSync(join(cwd, "app.ts"), `export const value = ${candidate++};\n`);
		await runtime.controller.execute(`${action}-next`, start, undefined, undefined, ctx);
		assert.equal(prompts, 1, `${action} must retain the successful decoded START grant variant`);
	}
});

test("blocked-scope-action never persists host permission", async (t) => {
	const cwd = reviewRepository(t);
	const runtime = controllerHarness(cwd, {}, { startAction: "blocked-scope-action" });
	let prompts = 0;
	const ctx = interactiveContext(cwd, {}, async (_title, options) => options[prompts++ === 0 ? 2 : 1]);
	const start = { operation: "start", input: JSON.stringify({ mode: "ordinary" }) };
	const blocked = (await runtime.controller.execute("blocked-host-choice", start, undefined, undefined, ctx)).details;
	assert.equal((blocked.result as { action?: string }).action, "blocked-scope-action");
	assert.equal((blocked.result as { state?: string }).state, "unreviewed");
	writeFileSync(join(cwd, "app.ts"), "export const value = 3;\n");
	await runtime.controller.execute("after-blocked-scope", start, undefined, undefined, ctx);
	assert.equal(prompts, 2, "pending explicit scope action must leave the next candidate behind a fresh prompt");
	assert.deepEqual(runtime.answers, ["granted", "declined"]);
});

test("a stale consent result with contextual native status never arms host permission", async (t) => {
	const cwd = reviewRepository(t);
	let now = 0;
	const runtime = controllerHarness(cwd, {}, { now: () => now });
	const manager = {};
	let prompts = 0;
	const ctx = interactiveContext(cwd, manager, async (_title, options) => {
		prompts += 1;
		if (prompts === 1) {
			now = 10 * 60 * 1000 + 1;
			return options[2];
		}
		return options[1];
	});
	const start = { operation: "start", input: JSON.stringify({ mode: "ordinary" }) };
	const stale = (await runtime.controller.execute("expired-host-choice", start, undefined, undefined, ctx)).details;
	assert.equal(stale.outcome, "consent-binding-stale");
	assert.equal(stale.native_invocation_attempted, false);
	assert.equal(typeof stale.result, "object", "native STATUS is contextual evidence, not a successful START result");
	writeFileSync(join(cwd, "app.ts"), "export const value = 3;\n");
	await runtime.controller.execute("after-stale", start, undefined, undefined, ctx);
	assert.equal(prompts, 2, "the next fresh consent envelope must still prompt after a stale contextual result");
	assert.deepEqual(runtime.answers, ["declined"]);
});

test("a failed consent invocation never arms host permission", async (t) => {
	const cwd = reviewRepository(t);
	const failure = Object.assign(new Error("provider start failed before mutation"), { mutationOutcome: "none" as const });
	const runtime = controllerHarness(cwd, {}, { answerConsentError: failure });
	let prompts = 0;
	const ctx = interactiveContext(cwd, {}, async (_title, options) => options[prompts++ === 0 ? 2 : 1]);
	const start = { operation: "start", input: JSON.stringify({ mode: "ordinary" }) };
	const failed = (await runtime.controller.execute("failed-host-choice", start, undefined, undefined, ctx)).details;
	assert.equal(failed.outcome, "native-operation-failed");
	writeFileSync(join(cwd, "app.ts"), "export const value = 3;\n");
	await runtime.controller.execute("after-error", start, undefined, undefined, ctx);
	assert.equal(prompts, 2, "a native error must leave the next candidate behind a fresh prompt");
	assert.deepEqual(runtime.answers, ["granted", "declined"]);
});

test("headless, child, and changed post-UI identity never use host permission", async (t) => {
	const cwd = reviewRepository(t);
	const start = { operation: "start", input: JSON.stringify({ mode: "ordinary" }) };
	for (const [label, processEnv, makeContext, parameters] of [
		["headless", {}, () => ({ ...interactiveContext(cwd, {}, async () => { throw new Error("must not prompt"); }), mode: "print", hasUI: false }) as ExtensionContext, start],
		["child", { JERO_PI_AGENTS_CHILD: "1" }, () => interactiveContext(cwd, {}, async () => { throw new Error("must not prompt"); }), start],
	] as const) {
		const runtime = controllerHarness(cwd, processEnv);
		const result = (await runtime.controller.execute(label, parameters, undefined, undefined, makeContext())).details;
		assert.equal(result.outcome, "native-review-consent-required", label);
		assert.deepEqual(runtime.answers, [], label);
	}

	const runtime = controllerHarness(cwd);
	const manager = { sessionId: "before", getSessionId() { return this.sessionId; } };
	const ctx = {
		cwd,
		mode: "tui",
		hasUI: true,
		sessionManager: manager,
		ui: {
			custom: consentCustom(async (_title: string, options: string[]) => { manager.sessionId = "after"; return options[2]; }),
			notify() {},
			setStatus() {},
			theme: { fg: (_color: string, text: string) => text },
		},
	} as unknown as ExtensionContext;
	const switched = (await runtime.controller.execute("switched", start, undefined, undefined, ctx)).details;
	assert.equal(switched.outcome, "native-review-consent-required");
	assert.deepEqual(runtime.answers, []);
});

test("standing permission never replays provider v2 or non-Pi v3 consents", async (t) => {
	const cwd = reviewRepository(t);
	const manager = {};
	const start = { operation: "start", input: JSON.stringify({ mode: "ordinary" }) };
	const authorized = controllerHarness(cwd);
	const grantingContext = interactiveContext(cwd, manager, async (_title, options) => options[2]);
	await authorized.controller.execute("grant-standing-permission", start, undefined, undefined, grantingContext);
	assert.deepEqual(authorized.answers, ["granted"]);

	for (const [label, providerConsent] of [
		["provider v2", providerV2Consent()],
		["non-Pi v3", nonPiV3Consent()],
	] as const) {
		const runtime = controllerHarness(cwd, {}, { consent: providerConsent });
		const result = (await runtime.controller.execute(label, start, undefined, undefined, interactiveContext(cwd, manager, async () => { throw new Error(`${label} must not prompt`); }))).details;
		assert.equal(result.outcome, "native-review-consent-required", label);
		assert.deepEqual(result.consent, providerConsent.raw, `${label} returns the exact unresolved provider envelope`);
		assert.deepEqual(runtime.answers, [], `${label} never submits a provider answer`);
	}
});

test("a child never asks its broker to replay provider v2 or non-Pi v3 consents", async (t) => {
	const cwd = reviewRepository(t);
	const start = { operation: "start", input: JSON.stringify({ mode: "ordinary" }), workspaceRoot: cwd };
	for (const [label, providerConsent] of [
		["provider v2", providerV2Consent()],
		["non-Pi v3", nonPiV3Consent()],
	] as const) {
		let brokerRequests = 0;
		const runtime = controllerHarness(cwd, { JERO_PI_AGENTS_CHILD: "1" }, {
			consent: providerConsent,
			childStandingReviewPermissionClient: {
				requestAuthorization: async () => {
					brokerRequests += 1;
					return true;
				},
				close() {},
			} as unknown as ChildStandingReviewPermissionClient,
		});
		const result = (await runtime.controller.execute(label, start, undefined, undefined, interactiveContext(cwd, {}, async () => { throw new Error(`${label} child must not prompt`); }))).details;
		assert.equal(result.outcome, "native-review-consent-required", label);
		assert.deepEqual(result.consent, providerConsent.raw, `${label} returns the exact unresolved provider envelope`);
		assert.equal(brokerRequests, 0, `${label} never requests broker authorization`);
		assert.deepEqual(runtime.answers, [], `${label} never submits a provider answer`);
	}
});

test("child permission transport survives reload shutdown but closes on terminal session shutdown", (t) => {
	const cwd = reviewRepository(t);
	let closes = 0;
	const runtime = controllerHarness(cwd, { JERO_PI_AGENTS_CHILD: "1" }, {
		childStandingReviewPermissionClient: { close: () => { closes += 1; } } as unknown as ChildStandingReviewPermissionClient,
	});
	const shutdown = runtime.events.get("session_shutdown");
	assert.ok(shutdown);
	const context = interactiveContext(cwd, {}, async () => undefined, "child-session");
	shutdown({ reason: "reload" }, context);
	assert.equal(closes, 0, "reload leaves the process-owned transport open for the replacement extension");
	shutdown({ reason: "new" }, context);
	assert.equal(closes, 1, "a terminal lifecycle closes the transport");
});

test("a package-owned child replays its exact pending ordinary grant from a sibling Git worktree only while its parent session remains authorized", async (t) => {
	const parentRoot = reviewRepository(t);
	const childRoot = siblingWorktree(t, parentRoot);
	const unrelatedRoot = reviewRepository(t);
	writeFileSync(join(childRoot, "app.ts"), "export const value = 2;\n");
	const parentManager: { getSessionId?: () => string } = {};
	const parentIdentity = await captureReviewSessionIdentity({
		cwd: parentRoot,
		mode: "tui",
		hasUI: true,
		sessionManager: Object.assign(parentManager, { getSessionId: () => "parent-session" }),
	}, {});
	assert.ok(parentIdentity);
	assert.equal(grantReviewSessionPermission(parentIdentity), true);

	const childToParent = new PassThrough();
	const parentToChild = new PassThrough();
	const broker = new ParentStandingReviewPermissionBroker(
		{ readable: childToParent, writable: parentToChild },
		(repositoryIdentity) => repositoryIdentity === parentIdentity.repositoryIdentity && parentManager.getSessionId() === "parent-session" && hasReviewSessionPermission(parentIdentity),
	);
	const childPermission = new ChildStandingReviewPermissionClient(
		{ readable: parentToChild, writable: childToParent },
		{ timeoutMs: 25 },
	);
	const runtime = controllerHarness(childRoot, { JERO_PI_AGENTS_CHILD: "1" }, { childStandingReviewPermissionClient: childPermission });
	const childContext = interactiveContext(childRoot, {}, async () => { throw new Error("a child must not open its own consent UI"); }, "child-session");
	const explicitStart = { operation: "start", input: JSON.stringify({ mode: "ordinary" }), workspaceRoot: childRoot };

	const granted = (await runtime.controller.execute("child-grant", explicitStart, undefined, undefined, childContext)).details;
	assert.equal(granted.operation, "answer-consent");
	assert.deepEqual(runtime.answers, ["granted"], "the child locally replays the exact provider grant once");

	const unrelatedContext = interactiveContext(unrelatedRoot, {}, async () => { throw new Error("an unrelated child target must not open its own consent UI"); }, "child-session");
	const unrelatedStart = { operation: "start", input: JSON.stringify({ mode: "ordinary" }), workspaceRoot: unrelatedRoot };
	const unrelated = (await runtime.controller.execute("child-unrelated", unrelatedStart, undefined, undefined, unrelatedContext)).details;
	assert.equal(unrelated.outcome, "native-review-consent-required", "a dynamically targeted unrelated repository is denied by the task-bound broker");
	assert.deepEqual(runtime.answers, ["granted"]);

	revokeReviewSessionPermissionsForSession(parentIdentity.sessionManager, parentIdentity.sessionId);
	writeFileSync(join(childRoot, "app.ts"), "export const value = 3;\n");
	const denied = (await runtime.controller.execute("child-revoked", explicitStart, undefined, undefined, childContext)).details;
	assert.equal(denied.outcome, "native-review-consent-required", "a revoked parent session cannot authorize the next child candidate");
	assert.deepEqual(runtime.answers, ["granted"]);
	childPermission.close();
	broker.close();
	childToParent.destroy();
	parentToChild.destroy();
});
