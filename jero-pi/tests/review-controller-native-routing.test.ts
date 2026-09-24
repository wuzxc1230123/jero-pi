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
import { bindingOf, correctionPlanInput, repository, reviewContext, reviewRuntime, startStatus } from "./review-controller-native-routing-shared.ts";

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
