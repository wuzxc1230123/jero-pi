// 重平衡分片：自 review-controller-native-routing.test.ts 按顶层语句边界对半机械平移（语义零改动）。
// node --test 只在文件间并行；重用例扎堆单文件会抬高整套件并行的下限。

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
	await __testing.executeReviewControllerOperation({ operation: "repair", lineageId }, cwd, native, { candidateViews, retainedUntrackedSelections: selections });
	const result = await __testing.executeReviewCaptureOperation({ lineageId, collectBinding: JSON.stringify(input), correctionLines: 1 }, cwd, native, undefined, candidateViews, selections, true);
	const workspaceLineage = "repair-workspace", workspaceRequests: Array<Record<string, unknown>> = [];
	await __testing.executeReviewControllerOperation({ operation: "repair", lineageId: workspaceLineage }, cwd, { targetStatus: async (request: Record<string, unknown>) => { workspaceRequests.push(request); return status(workspaceLineage); } } as unknown as NativeReviewCli, { candidateViews: candidateViews });
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

	const listed = await __testing.executeReviewControllerOperation({ operation: "status", lineageId }, cwd, native, { candidateViews, retainedUntrackedSelections: selections });
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

	await __testing.executeReviewControllerOperation({ operation: "status", lineageId, input: JSON.stringify({ baseRef: "explicit-base", committedOnly: true }) }, retainedRoot, native, { candidateViews: candidateViews });
	await __testing.executeReviewControllerOperation({ operation: "status", lineageId: "unretained" }, retainedRoot, native, { candidateViews: candidateViews });
	await __testing.executeReviewControllerOperation({ operation: "status", lineageId }, otherRoot, native, { candidateViews: candidateViews });

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
		{ retainedUntrackedSelections: selections },
	);
	assert.equal(selections.size, 2);
	await __testing.executeReviewControllerOperation(
		{ operation: "status", lineageId, input: JSON.stringify({ baseRef: "main", committedOnly: true }) },
		cwd,
		native,
		{ retainedUntrackedSelections: selections },
	);
	assert.deepEqual(requests[1], { cwd, lineageId, agent: "pi", baseRef: "main", committedOnly: true });
	assert.equal(selections.size, 1);
	const replacementStatus = await __testing.executeReviewControllerOperation(
		{ operation: "status", lineageId },
		cwd,
		native,
		{ retainedUntrackedSelections: selections },
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
	await __testing.executeReviewControllerOperation({ operation: "status", lineageId, input: JSON.stringify(override) }, cwd, native, { retainedUntrackedSelections: selections });
	await __testing.executeReviewControllerOperation({ operation: "status", lineageId }, cwd, native, { retainedUntrackedSelections: selections });
	assert.deepEqual(requests.slice(-2), Array.from({ length: 2 }, () => ({ cwd, lineageId, agent: "pi", ...override })));
});

test("route retention caps, rejects collisions and invalid selectors, and clears every terminal state", async () => {
	const native = { targetStatus: async (request: Record<string, unknown>) => status(String(request.lineageId)) } as unknown as NativeReviewCli;
	const selections = new Map();
	for (let index = 0; index <= 64; index += 1) await __testing.executeReviewControllerOperation({ operation: "status", lineageId: `bounded-${index}`, input: JSON.stringify({ baseRef: `base-${index}`, committedOnly: true }) }, process.cwd(), native, { retainedUntrackedSelections: selections });
	const evicted = await __testing.executeReviewCaptureOperation({ lineageId: "bounded-0", collectBinding: JSON.stringify(collectInput("bounded-0")) }, process.cwd(), native, undefined, undefined, selections, true);
	const collision = new Map(), lineageId = "route-collision", input = correctionPlanInput(lineageId);
	await __testing.executeReviewControllerOperation({ operation: "status", lineageId, input: JSON.stringify({ baseRef: "base-a", committedOnly: true }) }, process.cwd(), { targetStatus: async () => status(lineageId, [input]) } as unknown as NativeReviewCli, { retainedUntrackedSelections: collision });
	const rejected = await __testing.executeReviewControllerOperation({ operation: "status", lineageId, input: JSON.stringify({ baseRef: "base-b", committedOnly: true }) }, process.cwd(), { targetStatus: async () => status(lineageId, [input]) } as unknown as NativeReviewCli, { retainedUntrackedSelections: collision });
	for (const state of ["invalidated", "approved", "escalated"]) {
		const routes = new Map(), id = `terminal-${state}`;
		await __testing.executeReviewControllerOperation({ operation: "status", lineageId: id, input: JSON.stringify({ baseRef: "base", committedOnly: true }) }, process.cwd(), { targetStatus: async () => status(id, [input]) } as unknown as NativeReviewCli, { retainedUntrackedSelections: routes });
		await __testing.executeReviewControllerOperation({ operation: "status", lineageId: id }, process.cwd(), { targetStatus: async () => status(id, [], state) } as unknown as NativeReviewCli, { retainedUntrackedSelections: routes });
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
