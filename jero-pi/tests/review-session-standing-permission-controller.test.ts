
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

test("host UI preserves the complete provider envelope and adds a separately owned third action", () => {
	const envelope = consent();
	const before = structuredClone(envelope.raw);
	const model = formatReviewConsentUi(envelope);
	assert.match(model.title, new RegExp(envelope.headline.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
	for (const text of [envelope.reason, envelope.value, ...envelope.riskEvidence, envelope.offPath.note, envelope.offPath.command]) {
		assert.ok(model.title.includes(text), `missing provider text: ${text}`);
	}
	assert.equal(model.options.length, 3);
	for (const [index, choice] of envelope.choices.entries()) {
		assert.ok(model.options[index]!.includes(choice.label));
		assert.ok(model.options[index]!.includes(choice.effect));
	}
	assert.equal(model.content.actions[2]?.label, "Review and allow this session");
	assert.equal(model.content.actions[2]?.effect, "Reviews this change and allows later reviews in this session and repository; revoke anytime.");
	assert.ok(model.options[2]!.includes(HOST_REVIEW_SESSION_PERMISSION_LABEL));
	assert.match(model.title, /The first two actions are provider-owned and apply only to this candidate/);
	assert.match(model.title, /The third action is owned by the Pi host/);
	assert.match(model.content.ownership, /runs the current provider grant for this frozen candidate/);
	assert.match(model.content.ownership, /one fresh validated provider grant for each later candidate/);
	assert.match(model.content.ownership, /canonical Git repository identity, including sibling worktrees/);
	assert.match(model.content.ownership, /Reload preserves it; new, resume, fork, quit, process restart, or explicit revocation ends it/);
	assert.match(model.content.ownership, /no verdict, acknowledgement, maintenance, delivery, or cross-repository authority/);
	assert.equal(envelope.choices.length, 2, "the decoded provider envelope must remain a two-choice contract");
	assert.deepEqual(envelope.raw, before, "formatting must not mutate or append to the provider envelope");
});

test("the real Pi Text primitive bounds every consent line at narrow terminal widths", () => {
	const model = formatReviewConsentUi(consent());
	for (const width of [1, 2, 8, 20, 40]) {
		for (const text of [model.title, ...model.options]) {
			const lines = new Text(text, 0, 0).render(width);
			assert.ok(lines.length > 0);
			for (const line of lines) assert.ok(visibleWidth(line) <= width, `width ${width}: ${line}`);
		}
	}
});

test("selection maps only exact displayed actions and cancellation or UI failure stays unresolved", async () => {
	const envelope = consent();
	const model = formatReviewConsentUi(envelope);
	const selections = [model.options[0], model.options[1], model.options[2], undefined] as const;
	const expected = [
		{ kind: "provider", answer: "granted" },
		{ kind: "provider", answer: "declined" },
		{ kind: "host-session" },
		undefined,
	];
	for (let index = 0; index < selections.length; index += 1) {
		const ctx = { mode: "tui", ui: { custom: consentCustom(async () => selections[index]) } } as unknown as ExtensionContext;
		assert.deepEqual(await presentReviewConsentUi(ctx, envelope), expected[index]);
	}
	const failed = { mode: "tui", ui: { custom: consentCustom(async () => { throw new Error("UI unavailable"); }) } } as unknown as ExtensionContext;
	assert.equal(await presentReviewConsentUi(failed, envelope), undefined);
});

test("non-TUI selection preserves the existing action and cancellation mapping", async () => {
	const envelope = consent();
	const model = formatReviewConsentUi(envelope);
	const selections = [model.options[0], model.options[1], model.options[2], undefined] as const;
	const expected = [
		{ kind: "provider", answer: "granted" },
		{ kind: "provider", answer: "declined" },
		{ kind: "host-session" },
		undefined,
	];
	for (let index = 0; index < selections.length; index += 1) {
		const ctx = { mode: "rpc", ui: { select: async () => selections[index] } } as unknown as ExtensionContext;
		assert.deepEqual(await presentReviewConsentUi(ctx, envelope), expected[index]);
	}
});

test("a validated intended-untracked selection may use the host third action only for its selected repository", async (t) => {
	const cwd = reviewRepository(t);
	const sibling = siblingWorktree(t, cwd);
	const unrelated = reviewRepository(t);
	const selectedPath = "selected.md";
	for (const root of [cwd, sibling, unrelated]) writeFileSync(join(root, selectedPath), "selected\n");
	const statuses = new Map<string, ReturnType<typeof intendedUntrackedSelectionStatuses>>();
	const statusFor = (root: string) => statuses.get(root) ?? statuses.set(root, intendedUntrackedSelectionStatuses(root, selectedPath)).get(root)!;
	const runtime = controllerHarness(cwd, {}, {
		targetStatus: async (request) => ("intendedUntrackedSelection" in request ? statusFor(request.cwd as string).selected : statusFor(request.cwd as string).initial),
	});
	const manager = {};
	let prompts = 0;
	const select = async (_title: string, options: string[]) => {
		prompts += 1;
		assert.equal(options.length, 3, "the host UI exposes exactly its two provider choices plus one host action");
		return options[2];
	};
	const selectIntended = async (root: string, context: ExtensionContext) => {
		const listed = (await runtime.controller.execute(`list-${root}`, { operation: "status", workspaceRoot: root }, undefined, undefined, context)).details;
		assert.equal(typeof listed.selectionBinding, "string");
		return await runtime.controller.execute(`select-${root}`, { operation: "select-intended-untracked", selectionBinding: listed.selectionBinding, intendedUntracked: [selectedPath], workspaceRoot: root }, undefined, undefined, context);
	};

	const first = (await selectIntended(cwd, interactiveContext(cwd, manager, select))).details;
	assert.equal(first.operation, "answer-consent");
	assert.deepEqual(runtime.answers, ["granted"]);
	assert.equal(runtime.answerRequests[0]?.answer, "granted", "the exact provider grant is relayed once");
	assert.equal(JSON.stringify(runtime.answerRequests[0]?.consent.raw), JSON.stringify(runtime.consent.raw), "the exact provider envelope is granted unchanged");
	const grantedIdentity = await captureReviewSessionIdentity(interactiveContext(cwd, manager, select), {});
	assert.ok(grantedIdentity);
	assert.equal(hasReviewSessionPermission(grantedIdentity), true, "the host third action establishes the session repository grant");

	const second = (await selectIntended(sibling, interactiveContext(sibling, manager, select))).details;
	assert.equal(second.operation, "answer-consent");
	assert.deepEqual(runtime.answers, ["granted", "granted"]);
	assert.equal(prompts, 1, "a sibling worktree consumes the selected repository grant without another prompt");

	const third = (await selectIntended(unrelated, interactiveContext(unrelated, manager, select))).details;
	assert.equal(third.operation, "answer-consent");
	assert.deepEqual(runtime.answers, ["granted", "granted", "granted"]);
	assert.equal(prompts, 2, "an unrelated repository receives a new explicit host prompt");

	const headless = (await selectIntended(unrelated, { ...interactiveContext(unrelated, {}, async () => { throw new Error("headless must not prompt"); }), mode: "print", hasUI: false } as ExtensionContext)).details;
	assert.equal(headless.outcome, "native-review-consent-required");
	assert.equal(JSON.stringify(headless.consent), JSON.stringify(runtime.consent.raw), "an unavailable host returns the byte-equivalent raw provider envelope");
	assert.deepEqual(runtime.answers, ["granted", "granted", "granted"], "an unavailable host never submits a provider answer");
});

test("standing permission replays an explicit sibling-worktree consent against its binding-owned workspace root", async (t) => {
	const parentRoot = reviewRepository(t);
	const siblingRoot = siblingWorktree(t, parentRoot);
	writeFileSync(join(siblingRoot, "app.ts"), "export const value = 2;\n");
	const manager = {};
	const context = interactiveContext(parentRoot, manager, async () => {
		throw new Error("an active standing permission must not reopen consent UI");
	});
	const identity = await captureReviewSessionIdentity(context, {});
	assert.ok(identity);
	assert.equal(grantReviewSessionPermission(identity), true);

	const runtime = controllerHarness(parentRoot);
	const details = (await runtime.controller.execute(
		"sibling-standing-permission",
		{ operation: "start", input: JSON.stringify({ mode: "ordinary" }), workspaceRoot: siblingRoot },
		undefined,
		undefined,
		context,
	)).details;

	assert.equal(details.operation, "answer-consent");
	assert.deepEqual(runtime.answers, ["granted"]);
	assert.equal(runtime.answerRequests[0]?.cwd, siblingRoot, "automatic continuation must preserve the pending binding's canonical sibling worktree root");
});

test("provider grant and decline remain candidate-only and cancellation stores nothing", async (t) => {
	const cwd = reviewRepository(t);
	const runtime = controllerHarness(cwd);
	const manager = {};
	const selections = [0, 1, undefined] as const;
	let prompts = 0;
	const ctx = interactiveContext(cwd, manager, async (_title, options) => {
		const selection = selections[prompts++];
		return selection === undefined ? undefined : options[selection];
	});
	const start = { operation: "start", input: JSON.stringify({ mode: "ordinary" }) };
	assert.equal(((await runtime.controller.execute("grant", start, undefined, undefined, ctx)).details.result as { lineage_id?: string }).lineage_id, "lineage-1");
	writeFileSync(join(cwd, "app.ts"), "export const value = 3;\n");
	assert.equal((await runtime.controller.execute("decline", start, undefined, undefined, ctx)).details.outcome, "consent-declined-this-candidate");
	writeFileSync(join(cwd, "app.ts"), "export const value = 4;\n");
	const cancelled = (await runtime.controller.execute("cancel", start, undefined, undefined, ctx)).details;
	assert.equal(cancelled.outcome, "native-review-consent-required");
	assert.deepEqual(runtime.answers, ["granted", "declined"]);
	assert.equal(prompts, 3, "neither provider choice creates standing host permission");
});

test("explicit revocation ends the host grant without changing provider mode or authority", async (t) => {
	const cwd = reviewRepository(t);
	const runtime = controllerHarness(cwd);
	const manager = {};
	let prompts = 0;
	const ctx = interactiveContext(cwd, manager, async (_title, options) => options[prompts++ === 0 ? 2 : 1]);
	const start = { operation: "start", input: JSON.stringify({ mode: "ordinary" }) };
	await runtime.controller.execute("grant-session", start, undefined, undefined, ctx);
	const command = runtime.commands.get("jero:review-session-permission");
	assert.ok(command);
	await command!.handler("revoke", ctx);
	writeFileSync(join(cwd, "app.ts"), "export const value = 3;\n");
	await runtime.controller.execute("after-revoke", start, undefined, undefined, ctx);
	assert.equal(prompts, 2);
	assert.deepEqual(runtime.answers, ["granted", "declined"]);
});

test("reload shutdown preserves the grant, while nonreload shutdown revokes it", async (t) => {
	const cwd = reviewRepository(t);
	const runtime = controllerHarness(cwd);
	const manager = {};
	let prompts = 0;
	const ctx = interactiveContext(cwd, manager, async (_title, options) => options[prompts++ === 0 ? 2 : 1]);
	const start = { operation: "start", input: JSON.stringify({ mode: "ordinary" }) };
	await runtime.controller.execute("grant-session", start, undefined, undefined, ctx);
	const shutdown = runtime.events.get("session_shutdown");
	assert.ok(shutdown);
	await shutdown!({ reason: "reload" }, ctx);
	writeFileSync(join(cwd, "app.ts"), "export const value = 3;\n");
	await runtime.controller.execute("after-reload", start, undefined, undefined, ctx);
	assert.equal(prompts, 1, "reload keeps the standing permission");
	await shutdown!({ reason: "new" }, ctx);
	writeFileSync(join(cwd, "app.ts"), "export const value = 4;\n");
	await runtime.controller.execute("after-new", start, undefined, undefined, ctx);
	assert.equal(prompts, 2, "new-session shutdown revokes the standing permission");
});
