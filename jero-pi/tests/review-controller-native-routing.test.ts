// review-controller-native-routing 测试第 1 段（留守原文件名）（共 3 段；夹具在 review-controller-native-routing-shared.ts）。
// 机械平移自原 review-controller-native-routing.test.ts，语义零改动。

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
import {
	approvedAcknowledgementStatus, burnedAcknowledgementStatus, collectInput,
	managedAssetsOutdatedStatus, SHA, status, TREE
} from "./review-controller-native-routing-shared.ts";
import { reviewContext, reviewRuntime } from "./review-controller-native-routing.z2.test.ts";

test("STATUS renders the managed_assets_outdated continuation command as the actionable next step", async () => {
	const lineageId = "managed-assets-outdated";
	const native = { targetStatus: async () => managedAssetsOutdatedStatus(lineageId) } as unknown as NativeReviewCli;
	const blocked = await __testing.executeReviewControllerOperation({ operation: "status", lineageId }, process.cwd(), native);
	assert.equal(blocked.status, "blocked");
	assert.equal(blocked.hint, "run gentle-ai sync --agent claude-code");

	// an unknown stop reason code keeps rendering as a plain blocked result
	const otherStopNative = { targetStatus: async () => burnedAcknowledgementStatus(lineageId) } as unknown as NativeReviewCli;
	const plainBlocked = await __testing.executeReviewControllerOperation({ operation: "status", lineageId }, process.cwd(), otherStopNative);
	assert.equal(plainBlocked.status, "blocked");
	assert.equal(plainBlocked.hint, undefined);

	// an older gentle-ai may report this same stop with no continuation; the
	// renderer degrades to a plain blocked result instead of losing the status
	const noContinuation = status(lineageId, [], "approved");
	noContinuation.nextTransition = { kind: "stop", reasonCode: "managed_assets_outdated" };
	const noContinuationNative = { targetStatus: async () => noContinuation } as unknown as NativeReviewCli;
	const degraded = await __testing.executeReviewControllerOperation({ operation: "status", lineageId }, process.cwd(), noContinuationNative);
	assert.equal(degraded.status, "blocked");
	assert.equal(degraded.hint, undefined);
});

test("public acknowledgement relays one current provider vector and never replays after authority burn", async () => {
	const lineageId = "acknowledge-approved";
	const requests: Array<Record<string, unknown>> = [];
	const acknowledgementRequests: Array<{ argumentTokens: readonly string[]; cwd: string }> = [];
	const native = {
		targetStatus: async (request: Record<string, unknown>) => {
			requests.push(request);
			return requests.length === 1
				? approvedAcknowledgementStatus(lineageId)
				: burnedAcknowledgementStatus(lineageId);
		},
		acknowledgeApproved: async (request: { argumentTokens: readonly string[]; cwd: string }) => {
			acknowledgementRequests.push(request);
		},
	} as unknown as NativeReviewCli;

	const rejected = await __testing.executeReviewControllerOperation({ operation: "acknowledge-approved", lineageId, input: "{}" }, process.cwd(), native);
	assert.deepEqual({ outcome: rejected.outcome, calls: requests.length }, { outcome: "native-approved-acknowledgement-input-invalid", calls: 0 });
	const completed = await __testing.executeReviewControllerOperation({ operation: "acknowledge-approved", lineageId }, process.cwd(), native);
	assert.deepEqual(completed, { operation: "acknowledge-approved", status: "closed", outcome: "native-approved-acknowledgement-completed", lineage_id: lineageId, target_identity: SHA, authority: "burned", delivery: "ordinary-repository-policy", mutation_performed: true, mutation_outcome: "committed" });
	assert.deepEqual(requests, [{ cwd: process.cwd(), lineageId }]);
	assert.deepEqual(acknowledgementRequests, [{ cwd: process.cwd(), argumentTokens: [`--cwd=${process.cwd()}`, `--lineage=${lineageId}`, `--target=${SHA}`, `--expected-revision=${SHA}`, "--token=provider-issued-once"], binding: { lineageId, targetIdentity: SHA, revision: SHA } }]);

	const later = await __testing.executeReviewControllerOperation({ operation: "acknowledge-approved", lineageId }, process.cwd(), native);
	assert.equal(later.outcome, "native-approved-acknowledgement-not-current");
	assert.equal(requests.length, 2);
	assert.equal(acknowledgementRequests.length, 1);
});

test("approved acknowledgement reuses an explicit STATUS excluded-untracked selection and clears it after consumption", async () => {
	const cwd = process.cwd();
	const lineageId = "acknowledge-approved-excluded-untracked";
	const selection = {
		untrackedScope: "exclude",
		expectedUntrackedInventory: "inventory-sha256",
		intendedUntracked: [],
	};
	const selections = new Map();
	const requests: Array<Record<string, unknown>> = [];
	let acknowledgements = 0;
	const native = {
		targetStatus: async (request: Record<string, unknown>) => {
			requests.push(request);
			return approvedAcknowledgementStatus(lineageId);
		},
		acknowledgeApproved: async () => { acknowledgements += 1; },
	} as unknown as NativeReviewCli;

	await __testing.executeReviewControllerOperation(
		{ operation: "status", lineageId, input: JSON.stringify(selection) },
		cwd,
		native,
		undefined,
		undefined,
		undefined,
		selections,
	);
	const acknowledged = await __testing.executeReviewControllerOperation(
		{ operation: "acknowledge-approved", lineageId },
		cwd,
		native,
		undefined,
		undefined,
		undefined,
		selections,
	);
	assert.equal(acknowledged.outcome, "native-approved-acknowledgement-completed");
	await __testing.executeReviewControllerOperation(
		{ operation: "status", lineageId },
		cwd,
		native,
		undefined,
		undefined,
		undefined,
		selections,
	);
	assert.deepEqual(requests, [
		{ cwd, lineageId, agent: "pi", ...selection },
		{ cwd, lineageId, ...selection },
		{ cwd, lineageId, agent: "pi" },
	]);
	assert.equal(acknowledgements, 1);
});

test("public acknowledgement reports the burn from the review-acknowledged/v1 envelope when the provider prints one", async () => {
	const lineageId = "acknowledge-approved-envelope";
	let statusCalls = 0;
	const acknowledgementRequests: Array<Record<string, unknown>> = [];
	const native = {
		targetStatus: async () => {
			statusCalls += 1;
			return statusCalls === 1 ? approvedAcknowledgementStatus(lineageId) : burnedAcknowledgementStatus(lineageId);
		},
		acknowledgeApproved: async (request: Record<string, unknown>) => {
			acknowledgementRequests.push(request);
			return {
				schema: "gentle-ai.review-acknowledged/v1",
				operation: "review/acknowledge-approved",
				action: "acknowledged",
				lineageId,
				targetIdentity: SHA,
				consumedRevision: SHA,
				authority: "burned",
				raw: { schema: "gentle-ai.review-acknowledged/v1" },
			};
		},
	} as unknown as NativeReviewCli;

	const completed = await __testing.executeReviewControllerOperation({ operation: "acknowledge-approved", lineageId }, process.cwd(), native);
	assert.deepEqual(completed, {
		operation: "acknowledge-approved",
		status: "closed",
		outcome: "native-approved-acknowledgement-completed",
		lineage_id: lineageId,
		target_identity: SHA,
		consumed_revision: SHA,
		authority: "burned",
		burn_evidence: "gentle-ai.review-acknowledged/v1",
		delivery: "ordinary-repository-policy",
		mutation_performed: true,
		mutation_outcome: "committed",
	});
	assert.equal(statusCalls, 1, "the burn is reported from the envelope, never from a later STATUS");
	assert.deepEqual(acknowledgementRequests, [{
		cwd: process.cwd(),
		argumentTokens: [`--cwd=${process.cwd()}`, `--lineage=${lineageId}`, `--target=${SHA}`, `--expected-revision=${SHA}`, "--token=provider-issued-once"],
		binding: { lineageId, targetIdentity: SHA, revision: SHA },
	}]);
});

export function candidateRepository(t: test.TestContext): string {
	const cwd = realpathSync(mkdtempSync(join(tmpdir(), "gentle-pi-native-routing-")));
	// The registry's views are 0555 dirs / 0444 files; restore writability before
	// the fixture teardown so a surviving view never breaks rmSync.
	t.after(() => { try { execFileSync("chmod", ["-R", "u+w", cwd]); } catch {} rmSync(cwd, { recursive: true, force: true }); });
	const git = (...arguments_: string[]) => execFileSync("git", arguments_, { cwd, encoding: "utf8" });
	git("init", "-b", "main");
	writeFileSync(join(cwd, "tracked.txt"), "base\n");
	git("add", "tracked.txt");
	git("-c", "user.name=Routing Test", "-c", "user.email=routing@example.invalid", "commit", "-m", "base");
	return realpathSync(cwd);
}

test("approved acknowledgement burn tears down the retained candidate view and keeps its projection", async (t) => {
	const lineageId = "acknowledge-approved-view-teardown";
	const contributorRoot = candidateRepository(t);
	writeFileSync(join(contributorRoot, "tracked.txt"), "candidate\n");
	const registry = new CandidateViewRegistry();
	t.after(() => registry.cleanupAll());
	const view = registry.create({ contributorRoot });
	registry.retain(view.token, lineageId);
	assert.ok(existsSync(view.root));
	let approved = false;
	const native = {
		targetStatus: async () => approved ? approvedAcknowledgementStatus(lineageId, contributorRoot) : status(lineageId),
		acknowledgeApproved: async () => {},
	} as unknown as NativeReviewCli;

	const blocked = await __testing.executeReviewControllerOperation({ operation: "acknowledge-approved", lineageId }, contributorRoot, native, undefined, registry);
	assert.equal(blocked.outcome, "native-approved-acknowledgement-not-current");
	assert.ok(existsSync(view.root), "a refused acknowledgement proves no burn; the view must survive");

	approved = true;
	const completed = await __testing.executeReviewControllerOperation({ operation: "acknowledge-approved", lineageId }, contributorRoot, native, undefined, registry);
	assert.equal(completed.outcome, "native-approved-acknowledgement-completed");
	assert.equal(existsSync(view.root), false, "the burn must tear down the immutable candidate view worktree");
	assert.ok(registry.hasProjection(lineageId, contributorRoot), "terminal approved cleanup keeps the lineage projection");
});

// gentle-ai#4003: the native burn is the committed authority outcome. A Pi-side
// candidate-view teardown failure after it must never be reported as a failed
// acknowledgement, or the caller cannot tell that authority was consumed.
test("approved acknowledgement reports the burn truthfully when candidate-view cleanup fails after it", async (t) => {
	const lineageId = "acknowledge-approved-deferred-cleanup";
	const contributorRoot = candidateRepository(t);
	writeFileSync(join(contributorRoot, "tracked.txt"), "candidate\n");
	let failWorktreeRemove = true;
	const registry = new CandidateViewRegistry((file, arguments_, options) => {
		if (failWorktreeRemove && arguments_[0] === "worktree" && arguments_[1] === "remove") {
			failWorktreeRemove = false;
			throw Object.assign(new Error("simulated worktree removal failure"), { status: 128 });
		}
		return execFileSync(file, arguments_, options);
	});
	t.after(() => registry.cleanupAll());
	const view = registry.create({ contributorRoot });
	registry.retain(view.token, lineageId);
	const statusRequests: unknown[] = [];
	let acknowledgements = 0;
	const native = {
		targetStatus: async (request: unknown) => { statusRequests.push(request); return approvedAcknowledgementStatus(lineageId, contributorRoot); },
		acknowledgeApproved: async () => { acknowledgements += 1; },
	} as unknown as NativeReviewCli;

	const completed = await __testing.executeReviewControllerOperation({ operation: "acknowledge-approved", lineageId }, contributorRoot, native, undefined, registry);

	assert.equal(acknowledgements, 1, "exactly one native burn");
	assert.equal(statusRequests.length, 1, "no STATUS reconciliation after a cleanup-only failure");
	assert.equal(completed.status, "closed");
	assert.equal(completed.outcome, "native-approved-acknowledgement-completed");
	assert.equal(completed.authority, "burned");
	assert.equal(completed.mutation_performed, true);
	assert.equal(completed.mutation_outcome, "committed");
	assert.deepEqual(completed.candidate_view_cleanup, {
		status: "deferred",
		diagnostics: { code: "candidate-view-git-failure", message: "candidate-view Git command worktree failed; inspect the candidate state before any new START" },
		next_action: "retry-candidate-view-cleanup-or-remove-the-view-out-of-band",
	});
	assert.ok(existsSync(view.root), "a failed teardown preserves the candidate view");
	assert.ok(registry.hasProjection(lineageId, contributorRoot), "the lineage projection survives the deferred cleanup");

	// The residue stays recoverable: the registry still owns the view, so a
	// later terminal cleanup removes it without replaying the burn.
	registry.cleanupTerminal(lineageId, "approved", contributorRoot);
	assert.equal(existsSync(view.root), false);
	assert.equal(acknowledgements, 1);
});

test("ambiguous acknowledgement reconciles STATUS once without replaying the provider vector", async () => {
	const lineageId = "ambiguous-acknowledgement";
	let statusCalls = 0;
	let acknowledgementCalls = 0;
	const native = {
		targetStatus: async () => {
			statusCalls += 1;
			return statusCalls === 1
				? approvedAcknowledgementStatus(lineageId)
				: burnedAcknowledgementStatus(lineageId);
		},
		acknowledgeApproved: async () => { acknowledgementCalls += 1; throw new NativeReviewCliError(NATIVE_REVIEW_ERROR_CODE.NON_ZERO, "review/acknowledge-approved", true, true, "acknowledgement outcome unknown"); },
	} as unknown as NativeReviewCli;

	const result = await __testing.executeReviewControllerOperation({ operation: "acknowledge-approved", lineageId }, process.cwd(), native);
	assert.equal(result.outcome, "native-mutation-status-reconciled");
	assert.equal(result.mutation_outcome, "unknown");
	assert.equal((result.diagnostics as { error_code?: string }).error_code, NATIVE_REVIEW_ERROR_CODE.NON_ZERO);
	assert.deepEqual(result.reconciliation, { schema: "gentle-ai.review-integration.status/v5" });
	assert.equal(statusCalls, 2);
	assert.equal(acknowledgementCalls, 1);
});

test("public acknowledgement rejects a typed decoy provider vector before invocation", async () => {
	const lineageId = "decoy-acknowledgement";
	const decoy = approvedAcknowledgementStatus(lineageId);
	const target = decoy.nextTransition!.execute!.arguments[2]!;
	target.value = `sha256:${"b".repeat(64)}`;
	target.token = `--target=${target.value}`;
	let statusCalls = 0;
	let acknowledgementCalls = 0;
	const native = {
		targetStatus: async () => { statusCalls += 1; return decoy; },
		acknowledgeApproved: async () => { acknowledgementCalls += 1; },
	} as unknown as NativeReviewCli;

	const result = await __testing.executeReviewControllerOperation({ operation: "acknowledge-approved", lineageId }, process.cwd(), native);
	assert.equal(result.outcome, "native-operation-failed");
	assert.equal(result.mutation_outcome, "none");
	assert.equal(statusCalls, 1);
	assert.equal(acknowledgementCalls, 0);
});

test("public acknowledgement rejects a mismatched provider cwd before invocation", async () => {
	let invoked = false;
	const result = await __testing.executeReviewControllerOperation({ operation: "acknowledge-approved", lineageId: "mismatched-cwd" }, process.cwd(), {
		targetStatus: async () => approvedAcknowledgementStatus("mismatched-cwd", "/provider/mismatch"),
		acknowledgeApproved: async () => { invoked = true; },
	} as unknown as NativeReviewCli);
	assert.deepEqual({ outcome: result.outcome, invoked }, { outcome: "native-operation-failed", invoked: false });
});

test("local acknowledgement failure remains pre-launch and does not reconcile STATUS", async () => {
	const lineageId = "local-acknowledgement-failure";
	let statusCalls = 0;
	let acknowledgementCalls = 0;
	const native = {
		targetStatus: async () => { statusCalls += 1; return approvedAcknowledgementStatus(lineageId); },
		acknowledgeApproved: async () => { acknowledgementCalls += 1; throw new TypeError("local acknowledgement validation failed"); },
	} as unknown as NativeReviewCli;

	const result = await __testing.executeReviewControllerOperation({ operation: "acknowledge-approved", lineageId }, process.cwd(), native);
	assert.equal(result.outcome, "native-operation-failed");
	assert.equal(result.mutation_outcome, "none");
	assert.equal(statusCalls, 1);
	assert.equal(acknowledgementCalls, 1);
});

export function correctionPlanInput(lineageId: string): ReviewCollectInputV3 {
	const arguments_ = [{ name: "lineage", value: lineageId, token: `--lineage=${lineageId}` }, { name: "target", value: SHA, token: `--target=${SHA}` }];
	return { name: "correction_plan", schema: "https://gentle-ai.dev/schema/review/correction-plan/v1", captureOperation: "review.capture-correction-plan", arguments: arguments_, submission: { operationToken: "capture-correction-plan", argumentTokens: [`--lineage=${lineageId}`, "--correction-lines={{value}}"], values: [{ slot: "correction_lines", domain: "integer", substitutionLocation: 1, minimum: 1, maximum: 200 }] } } as unknown as ReviewCollectInputV3;
}

export function bindingOf(result: Record<string, unknown>): string {
	return (result.collectBindings as readonly { collectBinding: string }[])[0]!.collectBinding;
}

test("public STATUS exposes one opaque current collect binding without advancing authority", async () => {
	const lineageId = "public-status-lineage";
	let statusCalls = 0;
	const native = {
		targetStatus: async (request: { lineageId?: string; agent?: string }) => {
			statusCalls += 1;
			assert.equal(request.lineageId, lineageId);
			assert.equal(request.agent, "pi");
			assert.equal("baseRef" in request, false);
			assert.equal("committedOnly" in request, false);
			return status(lineageId);
		},
	} as unknown as NativeReviewCli;
	const result = await __testing.executeReviewControllerOperation(
		{ operation: "status", lineageId },
		process.cwd(),
		native,
	);
	assert.equal(result.status, "blocked");
	assert.equal(statusCalls, 1);
	const collectBindings = result.collectBindings as readonly { collectBinding: string }[];
	assert.equal(collectBindings.length, 1);
	assert.deepEqual(JSON.parse(collectBindings[0]!.collectBinding), collectInput(lineageId));
});

test("interleaved sessions sharing a CLI retain only their own capture routes", async () => {
	const [a, b] = ["interleaved-a", "interleaved-b"];
	const inputs = new Map([[a, correctionPlanInput(a)], [b, correctionPlanInput(b)]]);
	const requests: Array<Record<string, unknown>> = [];
	let releaseA!: () => void, releaseB!: () => void, readyA!: () => void, readyB!: () => void;
	const waits = [new Promise<void>((resolve) => { releaseA = resolve; }), new Promise<void>((resolve) => { releaseB = resolve; })];
	const ready = [new Promise<void>((resolve) => { readyA = resolve; }), new Promise<void>((resolve) => { readyB = resolve; })];
	let captures = 0;
	const native = {
		targetStatus: async (request: Record<string, unknown>) => {
			requests.push(request);
			const index = requests.length - 1;
			if (index < 2) { [readyA, readyB][index]!(); await waits[index]!; }
			const lineageId = String(request.lineageId);
			return status(lineageId, [inputs.get(lineageId)!]);
		},
		captureCorrectionPlan: async ({ argumentTokens }: { argumentTokens: readonly string[] }) => {
			captures += 1;
			const lineageId = argumentTokens.find((token) => token.startsWith("--lineage="))!.slice("--lineage=".length);
			return { schema: "gentle-ai.review-last-event-closure/v1", operation: "review.capture-correction-plan", lineageId, state: "correction_required", storeRevision: SHA };
		},
	} as unknown as NativeReviewCli;
	const { controller, capture, sessionShutdown } = reviewRuntime(native, new CandidateViewRegistry());
	const contexts = [a, b].map((id) => ({ ...reviewContext(process.cwd()), sessionManager: { getSessionId: () => id } } as unknown as ExtensionContext));
	const listedA = controller.execute("", { operation: "status", lineageId: a, input: JSON.stringify({ baseRef: "base-a", committedOnly: true }) }, undefined, undefined, contexts[0]!);
	await ready[0];
	const listedB = controller.execute("", { operation: "status", lineageId: b, input: JSON.stringify({ baseRef: "base-b", committedOnly: true }) }, undefined, undefined, contexts[1]!);
	await ready[1]; releaseA(); await listedA; releaseB();
	const [resultA, resultB] = await Promise.all([listedA, listedB]);
	const ownA = await capture.execute("", { lineageId: a, collectBinding: bindingOf(resultA.details as Record<string, unknown>), correctionLines: 1 }, undefined, undefined, contexts[0]!);
	const ownB = await capture.execute("", { lineageId: b, collectBinding: bindingOf(resultB.details as Record<string, unknown>), correctionLines: 1 }, undefined, undefined, contexts[1]!);
	const foreign = await capture.execute("", { lineageId: a, collectBinding: bindingOf(resultA.details as Record<string, unknown>), correctionLines: 1 }, undefined, undefined, contexts[1]!);
	await sessionShutdown({}, contexts[0]!);
	const cleaned = await capture.execute("", { lineageId: a, collectBinding: bindingOf(resultA.details as Record<string, unknown>), correctionLines: 1 }, undefined, undefined, contexts[0]!);
	assert.deepEqual({
		outcomes: [ownA, ownB, foreign, cleaned].map(({ details }) => (details as { outcome?: string }).outcome),
		revalidationCalls: requests.length - 2,
		captures,
	}, { outcomes: ["native-last-event-closure", "native-last-event-closure", "capture-binding-rejected", "capture-binding-rejected"], revalidationCalls: 2, captures: 2 });
});

test("REPAIR retains frozen committed collect selectors and leaves workspace routes unselected", async (t) => {
	const candidateViews = new CandidateViewRegistry(); t.after(() => candidateViews.cleanupAll());
	const cwd = repository(t), lineageId = "repair-committed", input = correctionPlanInput(lineageId); const view = candidateViews.create({ contributorRoot: cwd, baseRef: execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" }).trim(), committedOnly: true });
	candidateViews.retain(view.token, lineageId); const frozenTarget = candidateViews.resolveProjection(lineageId, cwd), selections = new Map(), requests: Array<Record<string, unknown>> = [];
	const native = {
		targetStatus: async (request: Record<string, unknown>) => { requests.push(request); return requests.length === 3 ? status(lineageId, [], "approved") : status(lineageId, [input]); },
		captureCorrectionPlan: async () => { throw Object.assign(new Error("lost response"), { mutationOutcome: "unknown", nextAction: "review.status" }); },
	} as unknown as NativeReviewCli;
	await __testing.executeReviewControllerOperation({ operation: "repair", lineageId }, cwd, native, undefined, candidateViews, undefined, selections);
	const result = await __testing.executeReviewCaptureOperation({ lineageId, collectBinding: JSON.stringify(input), correctionLines: 1 }, cwd, native, undefined, candidateViews, selections, true);
	const workspaceLineage = "repair-workspace", workspaceRequests: Array<Record<string, unknown>> = [];
	await __testing.executeReviewControllerOperation({ operation: "repair", lineageId: workspaceLineage }, cwd, { targetStatus: async (request: Record<string, unknown>) => { workspaceRequests.push(request); return status(workspaceLineage); } } as unknown as NativeReviewCli, undefined, candidateViews);
	assert.deepEqual({ outcome: result.outcome, routes: selections.size, selectors: requests.map(({ cwd: requestCwd, lineageId: id, baseRef, committedOnly }) => ({ cwd: requestCwd, lineageId: id, baseRef, committedOnly })) }, { outcome: "native-capture-outcome-unknown", routes: 0, selectors: Array.from({ length: 3 }, () => ({ cwd, lineageId, baseRef: frozenTarget.baseCommit, committedOnly: true })) });
	assert.deepEqual(workspaceRequests, [{ cwd, lineageId: workspaceLineage }]);
});

test("selectorless STATUS resumes a retained committed correction lineage", async (t) => {
	const candidateViews = new CandidateViewRegistry();
	t.after(() => candidateViews.cleanupAll());
	const cwd = repository(t);
	const lineageId = "retained-committed-correction";
	const view = candidateViews.create({
		contributorRoot: cwd,
		baseRef: execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" }).trim(),
		committedOnly: true,
	});
	candidateViews.retain(view.token, lineageId);
	const frozenTarget = candidateViews.resolveProjection(lineageId, cwd);
	const requests: Array<Record<string, unknown>> = [];
	const selections = new Map();
	let captures = 0;
	const native = {
		targetStatus: async (request: Record<string, unknown>) => {
			requests.push(request);
			return status(lineageId, [correctionPlanInput(lineageId)], "correction_required");
		},
		captureCorrectionPlan: async () => {
			captures += 1;
			return { schema: "gentle-ai.review-last-event-closure/v1", operation: "review.capture-correction-plan", lineageId, state: "correction_required", storeRevision: SHA };
		},
	} as unknown as NativeReviewCli;

	const listed = await __testing.executeReviewControllerOperation({ operation: "status", lineageId }, cwd, native, undefined, candidateViews, undefined, selections);
	const captured = await __testing.executeReviewCaptureOperation({ lineageId, collectBinding: bindingOf(listed), correctionLines: 1 }, cwd, native, undefined, candidateViews, selections, true);

	assert.equal(captured.outcome, "native-last-event-closure");
	assert.equal(captures, 1);
	assert.deepEqual(requests, Array.from({ length: 2 }, () => ({ cwd, lineageId, agent: "pi", baseRef: frozenTarget.baseCommit, committedOnly: true })));
});

test("selectorless STATUS uses a retained committed selector only at its retained workspace", async (t) => {
	const candidateViews = new CandidateViewRegistry();
	t.after(() => candidateViews.cleanupAll());
	const retainedRoot = repository(t);
	const otherRoot = repository(t);
	const lineageId = "retained-selector-boundary";
	const view = candidateViews.create({
		contributorRoot: retainedRoot,
		baseRef: execFileSync("git", ["rev-parse", "HEAD"], { cwd: retainedRoot, encoding: "utf8" }).trim(),
		committedOnly: true,
	});
	candidateViews.retain(view.token, lineageId);
	const frozenTarget = candidateViews.resolveProjection(lineageId, retainedRoot);
	const requests: Array<Record<string, unknown>> = [];
	const native = {
		targetStatus: async (request: Record<string, unknown>) => {
			requests.push(request);
			return status(String(request.lineageId ?? "unretained"));
		},
	} as unknown as NativeReviewCli;

	await __testing.executeReviewControllerOperation({ operation: "status", lineageId, input: JSON.stringify({ baseRef: "explicit-base", committedOnly: true }) }, retainedRoot, native, undefined, candidateViews);
	await __testing.executeReviewControllerOperation({ operation: "status", lineageId: "unretained" }, retainedRoot, native, undefined, candidateViews);
	await __testing.executeReviewControllerOperation({ operation: "status", lineageId }, otherRoot, native, undefined, candidateViews);

	assert.deepEqual(requests, [
		{ cwd: retainedRoot, lineageId, agent: "pi", baseRef: "explicit-base", committedOnly: true },
		{ cwd: retainedRoot, lineageId: "unretained", agent: "pi" },
		{ cwd: retainedRoot, lineageId, agent: "pi", baseRef: frozenTarget.baseCommit, committedOnly: true },
	]);
});

test("STATUS preserves retained intended-untracked selection through selectorless same-lineage replacement collection", async () => {
	const cwd = process.cwd();
	const lineageId = "selectorless-replacement";
	const selectedUntracked = {
		untrackedScope: "select",
		expectedUntrackedInventory: "inventory-sha256",
		intendedUntracked: ["generated/report.json"],
	};
	const initial = correctionPlanInput(lineageId);
	const replacement: ReviewCollectInputV3 = {
		...correctionPlanInput(lineageId),
		arguments: [
			...correctionPlanInput(lineageId).arguments,
			{ name: "replacement", value: "b", token: "--replacement=b" },
		],
	};
	const selections = new Map();
	const requests: Array<Record<string, unknown>> = [];
	let captures = 0;
	const native = {
		targetStatus: async (request: Record<string, unknown>) => {
			requests.push(request);
			return "baseRef" in request
				? status(lineageId, [])
				: status(lineageId, [requests.length === 1 ? initial : replacement]);
		},
		captureCorrectionPlan: async ({ correctionLines, cwd: captureCwd }: { correctionLines: number; cwd: string }) => {
			captures += 1;
			assert.deepEqual({ correctionLines, cwd: captureCwd }, { correctionLines: 1, cwd });
			return { schema: "gentle-ai.review-last-event-closure/v1", operation: "review.capture-correction-plan", lineageId, state: "correction_required", storeRevision: SHA };
		},
	} as unknown as NativeReviewCli;

	const initialStatus = await __testing.executeReviewControllerOperation(
		{ operation: "status", lineageId, input: JSON.stringify(selectedUntracked) },
		cwd,
		native,
		undefined,
		undefined,
		undefined,
		selections,
	);
	assert.equal(selections.size, 2);
	await __testing.executeReviewControllerOperation(
		{ operation: "status", lineageId, input: JSON.stringify({ baseRef: "main", committedOnly: true }) },
		cwd,
		native,
		undefined,
		undefined,
		undefined,
		selections,
	);
	assert.deepEqual(requests[1], { cwd, lineageId, agent: "pi", baseRef: "main", committedOnly: true });
	assert.equal(selections.size, 1);
	const replacementStatus = await __testing.executeReviewControllerOperation(
		{ operation: "status", lineageId },
		cwd,
		native,
		undefined,
		undefined,
		undefined,
		selections,
	);
	assert.equal(selections.size, 2);
	const bindingA = bindingOf(initialStatus);
	const bindingB = bindingOf(replacementStatus);
	assert.notEqual(bindingA, bindingB);

	const stale = await __testing.executeReviewCaptureOperation(
		{ lineageId, collectBinding: bindingA, correctionLines: 1 },
		cwd,
		native,
		undefined,
		undefined,
		selections,
		true,
	);
	assert.deepEqual({ outcome: stale.outcome, requests: requests.length, captures }, { outcome: "capture-binding-rejected", requests: 3, captures: 0 });

	const captured = await __testing.executeReviewCaptureOperation(
		{ lineageId, collectBinding: bindingB, correctionLines: 1 },
		cwd,
		native,
		undefined,
		undefined,
		selections,
		true,
	);
	assert.equal(captured.outcome, "native-last-event-closure");
	assert.deepEqual(requests, [
		{ cwd, lineageId, agent: "pi", ...selectedUntracked },
		{ cwd, lineageId, agent: "pi", baseRef: "main", committedOnly: true },
		{ cwd, lineageId, agent: "pi", ...selectedUntracked },
		{ cwd, lineageId, agent: "pi", ...selectedUntracked },
	]);
	assert.equal(captures, 1);

	const override = { ...selectedUntracked, expectedUntrackedInventory: "override-inventory", intendedUntracked: ["generated/override.json"] };
	await __testing.executeReviewControllerOperation({ operation: "status", lineageId, input: JSON.stringify(override) }, cwd, native, undefined, undefined, undefined, selections);
	await __testing.executeReviewControllerOperation({ operation: "status", lineageId }, cwd, native, undefined, undefined, undefined, selections);
	assert.deepEqual(requests.slice(-2), Array.from({ length: 2 }, () => ({ cwd, lineageId, agent: "pi", ...override })));
});

test("route retention caps, rejects collisions and invalid selectors, and clears every terminal state", async () => {
	const native = { targetStatus: async (request: Record<string, unknown>) => status(String(request.lineageId)) } as unknown as NativeReviewCli;
	const selections = new Map();
	for (let index = 0; index <= 64; index += 1) await __testing.executeReviewControllerOperation({ operation: "status", lineageId: `bounded-${index}`, input: JSON.stringify({ baseRef: `base-${index}`, committedOnly: true }) }, process.cwd(), native, undefined, undefined, undefined, selections);
	const evicted = await __testing.executeReviewCaptureOperation({ lineageId: "bounded-0", collectBinding: JSON.stringify(collectInput("bounded-0")) }, process.cwd(), native, undefined, undefined, selections, true);
	const collision = new Map(), lineageId = "route-collision", input = correctionPlanInput(lineageId);
	await __testing.executeReviewControllerOperation({ operation: "status", lineageId, input: JSON.stringify({ baseRef: "base-a", committedOnly: true }) }, process.cwd(), { targetStatus: async () => status(lineageId, [input]) } as unknown as NativeReviewCli, undefined, undefined, undefined, collision);
	const rejected = await __testing.executeReviewControllerOperation({ operation: "status", lineageId, input: JSON.stringify({ baseRef: "base-b", committedOnly: true }) }, process.cwd(), { targetStatus: async () => status(lineageId, [input]) } as unknown as NativeReviewCli, undefined, undefined, undefined, collision);
	for (const state of ["invalidated", "approved", "escalated"]) {
		const routes = new Map(), id = `terminal-${state}`;
		await __testing.executeReviewControllerOperation({ operation: "status", lineageId: id, input: JSON.stringify({ baseRef: "base", committedOnly: true }) }, process.cwd(), { targetStatus: async () => status(id, [input]) } as unknown as NativeReviewCli, undefined, undefined, undefined, routes);
		await __testing.executeReviewControllerOperation({ operation: "status", lineageId: id }, process.cwd(), { targetStatus: async () => status(id, [], state) } as unknown as NativeReviewCli, undefined, undefined, undefined, routes);
		assert.equal(routes.size, 0, state);
	}
	let calls = 0;
	for (const value of [{ baseRef: "", committedOnly: true }, { committedOnly: true }, { baseRef: "base" }, { baseRef: "base", committedOnly: false }]) {
		const result = await __testing.executeReviewControllerOperation({ operation: "status", input: JSON.stringify(value) }, process.cwd(), { targetStatus: async () => { calls += 1; return status("unreachable"); } } as unknown as NativeReviewCli);
		assert.equal(result.outcome, "native-status-input-invalid");
	}
	assert.deepEqual({ routes: selections.size, evicted: evicted.outcome, collision: rejected.outcome, calls }, { routes: 64, evicted: "capture-binding-rejected", collision: "capture-route-registration-rejected", calls: 0 });
});

test("public INSPECT and STATUS publish the exact pi-bound binding that capture revalidates", async () => {
	const lineageId = "pi-bound-public-binding";
	const agentlessInput = collectInput(lineageId);
	const piBoundInput: ReviewCollectInputV3 = {
		...agentlessInput,
		arguments: [
			...agentlessInput.arguments,
			{ name: "agent", value: "pi", token: "--agent=pi" },
			{ name: "materialize", value: "true", token: "--materialize=true" },
		],
		submission: {
			...agentlessInput.submission!,
			argumentTokens: [
				...agentlessInput.submission!.argumentTokens.slice(0, -1),
				"--agent=pi",
				"--materialize=true",
				"--input={{value}}",
			],
			values: [{ slot: "reviewer_result", domain: "artifact_path_or_stdin", substitutionLocation: 9 }],
		},
	};
	const agentlessStatus = status(lineageId);
	agentlessStatus.nextTransition = {
		kind: "collect",
		reasonCode: "capture_required",
		collect: { inputs: [agentlessInput] },
	};
	const piBoundStatus = status(lineageId);
	piBoundStatus.nextTransition = {
		kind: "collect",
		reasonCode: "capture_required",
		collect: { inputs: [piBoundInput] },
	};
	const requests: Array<{ agent?: string; lineageId?: string }> = [];
	const native = {
		targetStatus: async (request: { agent?: string; lineageId?: string }) => {
			requests.push(request);
			return request.agent === "pi" ? piBoundStatus : agentlessStatus;
		},
	} as unknown as NativeReviewCli;

	const publicStatus = await __testing.executeReviewControllerOperation(
		{ operation: "status", lineageId },
		process.cwd(),
		native,
	);
	const statusBinding = (publicStatus.collectBindings as readonly { collectBinding: string }[])[0]!.collectBinding;
	assert.deepEqual(JSON.parse(statusBinding), piBoundInput);

	const publicInspect = await __testing.executeReviewControllerOperation(
		{ operation: "inspect" },
		process.cwd(),
		native,
	);
	const inspectBinding = (publicInspect.collectBindings as readonly { collectBinding: string }[])[0]!.collectBinding;
	assert.deepEqual(JSON.parse(inspectBinding), piBoundInput);

	const publicStart = await __testing.executeReviewControllerOperation(
		{ operation: "start", input: JSON.stringify({ mode: "ordinary" }) },
		process.cwd(),
		native,
	);
	const startBinding = (publicStart.collectBindings as readonly { collectBinding: string }[])[0]!.collectBinding;
	assert.deepEqual(JSON.parse(startBinding), piBoundInput);

	const forecast = await __testing.executeReviewCaptureOperation(
		{ lineageId, collectBinding: statusBinding },
		process.cwd(),
		native,
	);
	assert.equal(forecast.outcome, "reviewer-model-run-forecast");
	assert.deepEqual(requests.map((request) => request.agent), ["pi", "pi", "pi", "pi"]);
	assert.deepEqual(requests.map((request) => request.lineageId), [lineageId, undefined, undefined, lineageId]);
});

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

