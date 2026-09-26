// review-controller-native-routing 测试第 3 段（共 3 段；夹具在 review-controller-native-routing-shared.ts）。
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
import { fileURLToPath } from "node:url";
import { default as test } from "node:test";
import { type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { __testing, createJeroAiExtension, PendingReviewConsentRegistry } from "../extensions/jero-ai.ts";
import { CandidateViewRegistry } from "../lib/review-candidate-view.ts";
import { NATIVE_REVIEW_ERROR_CODE, type NativeReviewCli, NativeReviewCliError, NativeReviewConsentRequiredError } from "../lib/authority/client-contract.ts";
import { decodeReviewConsentV3, decodeReviewStatusV3, type ReviewCollectInputV3, type ReviewStatusV3 } from "../lib/authority/wire-contract.ts";
import {
	approvedAcknowledgementStatus, bindingOf, burnedAcknowledgementStatus, collectInput,
	correctionPlanInput, managedAssetsOutdatedStatus, repository, reviewContext, reviewRuntime,
	SHA, startStatus, status, TREE
} from "./review-controller-native-routing-shared.ts";

test("ordinary START relays native consent without authoring or advancing it", async (t) => {
	const cwd = repository(t);
	const consent = decodeReviewConsentV3(JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "fixtures", "devbinary", "consent-v3.captured.json"), "utf8")));
	const native = {
		targetStatus: async () => startStatus(cwd),
		start: async () => { throw new NativeReviewConsentRequiredError(consent); },
	} as unknown as NativeReviewCli;
	const result = await __testing.executeReviewControllerOperation({ operation: "start", input: JSON.stringify({ mode: "ordinary" }) }, cwd, native);
	assert.equal(result.outcome, "native-review-consent-required");
	assert.equal(typeof result.consent_binding, "string");
	assert.equal(result.mutation_outcome, "none");
});

test("shutdown preserves failed consent candidates without interrupting session teardown", async (t) => {
	const cwd = repository(t);
	const consent = decodeReviewConsentV3(JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "fixtures", "devbinary", "consent-v3.captured.json"), "utf8")));
	const native = {
		targetStatus: async () => startStatus(cwd),
		start: async () => { throw new NativeReviewConsentRequiredError(consent); },
	} as unknown as NativeReviewCli;
	const registry = new CandidateViewRegistry();
	const runtime = reviewRuntime(native, registry);
	const ctx = reviewContext(cwd);
	const result = await runtime.controller.execute("pending", { operation: "start", input: JSON.stringify({ mode: "ordinary" }) }, undefined, undefined, ctx);
	assert.equal((result.details as { outcome: string }).outcome, "native-review-consent-required");
	t.mock.method(registry, "cleanup", () => { throw new Error("fixture unsafe ownership"); });
	assert.doesNotThrow(() => runtime.sessionShutdown({ reason: "reload" }, ctx));
});

test("ordinary START obeys the review-mode kill switch before target STATUS", async () => {
	let targetCalls = 0;
	const native = {
		reviewMode: async () => ({ operation: "status", scope: "clone", status: { global: "on", cloneLocal: "off", effective: "off", source: "clone_local" } }),
		targetStatus: async () => { targetCalls += 1; return status("unreachable"); },
	} as unknown as NativeReviewCli;
	const result = await __testing.executeReviewControllerOperation({ operation: "start", input: JSON.stringify({ mode: "ordinary" }) }, process.cwd(), native);
	assert.equal(result.outcome, "review-mode-disabled");
	assert.equal(targetCalls, 0);
});

test("STATUS preserves a native process failure without inventing authority recovery", async () => {
	const native = {
		targetStatus: async () => { throw new NativeReviewCliError(NATIVE_REVIEW_ERROR_CODE.UNAVAILABLE, "review/status", false, false, "native unavailable"); },
	} as unknown as NativeReviewCli;
	const result = await __testing.executeReviewControllerOperation({ operation: "status" }, process.cwd(), native);
	assert.equal(result.status, "blocked");
	assert.equal(result.outcome, "native-operation-failed");
	assert.equal(result.mutation_outcome, "none");
});

test("foreign native errors with malformed diagnostics remain untrusted", async () => {
	const native = {
		targetStatus: async () => { throw {
			name: "NativeReviewCliError",
			code: NATIVE_REVIEW_ERROR_CODE.NON_ZERO,
			diagnostics: {
				operation: "review/status",
				error_code: "forged-code",
				timed_out: false,
				output_limit_exceeded: false,
			},
		}; },
	} as unknown as NativeReviewCli;
	const result = await __testing.executeReviewControllerOperation({ operation: "status" }, process.cwd(), native);
	assert.equal(result.outcome, "native-operation-failed");
	assert.equal("diagnostics" in result, false);
});

test("STATUS preserves ambiguous native status as read-only provider-owned state", async () => {
	const lineageId = "ambiguous-lineage";
	const native = {
		targetStatus: async () => ({ ...status(lineageId), applicability: "ambiguous", action: "stop" }) as ReviewStatusV3,
	} as unknown as NativeReviewCli;
	const result = await __testing.executeReviewControllerOperation({ operation: "status", lineageId }, process.cwd(), native);
	assert.equal(result.operation, "status");
	assert.equal(result.status, "blocked");
	assert.deepEqual(result.result, { schema: "gentle-ai.review-integration.status/v5" });
});

test("STATUS routes an explicit workspace root to the provider and reports it", async () => {
	const cwd = process.cwd();
	const native = {
		targetStatus: async (request: { cwd: string }) => {
			assert.equal(request.cwd, cwd);
			return status("workspace-root");
		},
	} as unknown as NativeReviewCli;
	const result = await __testing.executeReviewControllerOperation({ operation: "status", lineageId: "workspace-root", workspaceRoot: cwd }, cwd, native);
	assert.equal(result.workspace_root, cwd);
});

test("a public provider-role collect binding remains reachable through one native capture", async () => {
	const closureLineage = "review-61da8af1a89ff96a";
	const baseInput = collectInput(closureLineage);
	const { submission: _submission, artifactSubject: _artifactSubject, ...roleInput } = baseInput;
	void _submission;
	void _artifactSubject;
	const input = {
		...roleInput,
		name: "provider_refuter",
		schema: "https://gentle-ai.dev/schema/review/refuter/v1",
		captureOperation: "review.capture-refuter",
		arguments: [
			{ name: "lineage", value: closureLineage, token: `--lineage=${closureLineage}` },
			{ name: "target", value: SHA, token: `--target=${SHA}` },
			{ name: "agent", value: "pi", token: "--agent=pi" },
			{ name: "execute", value: "true", token: "--execute=true" },
		],
	} as unknown as ReviewCollectInputV3;
	const roleStatus = { ...status(closureLineage), nextTransition: { kind: "collect", reasonCode: "provider_role_required", collect: { inputs: [input] } } } as ReviewStatusV3;
	let captureCalls = 0;
	const native = {
		targetStatus: async (request: { agent?: string }) => {
			assert.equal(request.agent, "pi");
			return roleStatus;
		},
		captureProviderRole: async (request: { captureOperation: string; argumentTokens: readonly string[] }) => {
			captureCalls += 1;
			assert.equal(request.captureOperation, "review.capture-refuter");
			assert.deepEqual(request.argumentTokens, [`--lineage=${closureLineage}`, `--target=${SHA}`, "--agent=pi", "--execute=true"]);
			return { schema: "gentle-ai.review-last-event-closure/v1", operation: "review.capture-refuter", lineageId: closureLineage, state: "approved", storeRevision: SHA };
		},
	} as unknown as NativeReviewCli;
	const result = await __testing.executeReviewCaptureOperation({ lineageId: closureLineage, collectBinding: JSON.stringify(input) }, process.cwd(), native);
	assert.equal(result.status, "closed");
	assert.equal(result.outcome, "native-last-event-closure");
	assert.equal(captureCalls, 1);
});

test("ordinary START follows a provider reconciliation status without creating a candidate or invoking START", async () => {
	let startCalls = 0;
	const native = {
		targetStatus: async () => status("reconcile-current"),
		start: async () => { startCalls += 1; throw new Error("must not start"); },
	} as unknown as NativeReviewCli;
	const result = await __testing.executeReviewControllerOperation({ operation: "start", input: JSON.stringify({ mode: "ordinary" }) }, process.cwd(), native);
	assert.equal(result.status, "blocked");
	assert.deepEqual(result.result, { schema: "gentle-ai.review-integration.status/v5" });
	assert.equal(startCalls, 0);
});

test("STATUS rejects locally-authored untracked input before reading native authority", async () => {
	let statusCalls = 0;
	const native = {
		targetStatus: async () => { statusCalls += 1; return status("unreachable"); },
	} as unknown as NativeReviewCli;
	const result = await __testing.executeReviewControllerOperation({ operation: "status", input: JSON.stringify({ unexpected: true }) }, process.cwd(), native);
	assert.equal(result.outcome, "native-status-input-invalid");
	assert.equal(result.mutation_outcome, "none");
	assert.equal(statusCalls, 0);
});

test("INSPECT remains a read-only negotiated STATUS projection with no inventory reconstruction", async () => {
	let calls = 0;
	const native = {
		targetStatus: async (request: { cwd: string }) => {
			calls += 1;
			assert.equal(request.cwd, process.cwd());
			return { ...status("inspect-lineage"), applicability: "ambiguous" } as ReviewStatusV3;
		},
	} as unknown as NativeReviewCli;
	const result = await __testing.executeReviewControllerOperation({ operation: "inspect" }, process.cwd(), native);
	assert.equal(result.operation, "inspect");
	assert.equal(result.status, "blocked");
	assert.equal("mutation_performed" in result, false);
	assert.equal(calls, 1);
});

test("targeted-validator provider vectors preserve their nonuniform native closure operation", async () => {
	const closureLineage = "review-validator";
	const baseInput = collectInput(closureLineage);
	const { submission: _submission, artifactSubject: _artifactSubject, ...roleInput } = baseInput;
	void _submission;
	void _artifactSubject;
	const input = {
		...roleInput,
		name: "provider_targeted_validator",
		schema: "https://gentle-ai.dev/schema/review/targeted-validator/v1",
		captureOperation: "review.capture-validation",
		arguments: [
			{ name: "lineage", value: closureLineage, token: `--lineage=${closureLineage}` },
			{ name: "target", value: SHA, token: `--target=${SHA}` },
			{ name: "agent", value: "pi", token: "--agent=pi" },
			{ name: "execute", value: "true", token: "--execute=true" },
		],
	} as unknown as ReviewCollectInputV3;
	const roleStatus = { ...status(closureLineage), nextTransition: { kind: "collect", reasonCode: "provider_role_required", collect: { inputs: [input] } } } as ReviewStatusV3;
	const native = {
		targetStatus: async () => roleStatus,
		captureProviderRole: async (request: { captureOperation: string }) => {
			assert.equal(request.captureOperation, "review.capture-validation");
			return { schema: "gentle-ai.review-last-event-closure/v1", operation: "review/capture-validation", lineageId: closureLineage, state: "approved", storeRevision: SHA };
		},
	} as unknown as NativeReviewCli;
	const result = await __testing.executeReviewCaptureOperation({ lineageId: closureLineage, collectBinding: JSON.stringify(input) }, process.cwd(), native);
	assert.equal(result.status, "closed");
	assert.equal(result.outcome, "native-last-event-closure");
	assert.equal("correction_target_identity" in result, false);
});

test("targeted-validator captures echo the distinct provider correction target identity", async () => {
	const closureLineage = "review-validator-correction-target";
	const correctionTarget = `sha256:${"d".repeat(64)}`;
	const baseInput = collectInput(closureLineage);
	const { submission: _submission, artifactSubject: _artifactSubject, ...roleInput } = baseInput;
	void _submission;
	void _artifactSubject;
	const input = {
		...roleInput,
		name: "provider_targeted_validator",
		schema: "https://gentle-ai.dev/schema/review/targeted-validator/v1",
		captureOperation: "review.capture-validation",
		arguments: [
			{ name: "lineage", value: closureLineage, token: `--lineage=${closureLineage}` },
			{ name: "target", value: correctionTarget, token: `--target=${correctionTarget}` },
			{ name: "agent", value: "pi", token: "--agent=pi" },
			{ name: "execute", value: "true", token: "--execute=true" },
		],
		validationRequest: { correctionTargetIdentity: correctionTarget },
	} as unknown as ReviewCollectInputV3;
	const roleStatus = { ...status(closureLineage), nextTransition: { kind: "collect", reasonCode: "provider_role_required", collect: { inputs: [input] } } } as ReviewStatusV3;
	const native = {
		targetStatus: async () => roleStatus,
		captureProviderRole: async () => ({ schema: "gentle-ai.review-last-event-closure/v1", operation: "review/capture-validation", lineageId: closureLineage, state: "approved", storeRevision: SHA }),
	} as unknown as NativeReviewCli;
	const result = await __testing.executeReviewCaptureOperation({ lineageId: closureLineage, collectBinding: JSON.stringify(input) }, process.cwd(), native);
	assert.equal(result.outcome, "native-last-event-closure");
	assert.equal(result.correction_target_identity, correctionTarget);
});

test("capture schema and guidance name diff-line units apart from the frozen logical correction budget", () => {
	const tools = new Map<string, { description: string; promptGuidelines?: readonly string[]; parameters: unknown }>();
	createJeroAiExtension({ nativeReviewCli: null })({
		on() {},
		registerTool(definition: { name: string; description: string; promptGuidelines?: readonly string[]; parameters: unknown }) { tools.set(definition.name, definition); },
		registerCommand() {},
	} as unknown as ExtensionAPI);
	const capture = tools.get("jero_review_capture");
	const controller = tools.get("jero_review");
	assert.ok(capture);
	assert.ok(controller);
	const schema = JSON.stringify(capture.parameters);
	assert.match(schema, /diff lines/);
	assert.match(schema, /logical correction budget/);
	const captureGuidance = (capture.promptGuidelines ?? []).join("\n");
	assert.match(captureGuidance, /diff lines/);
	assert.match(captureGuidance, /logical correction budget/);
	const controllerGuidance = (controller.promptGuidelines ?? []).join("\n");
	assert.match(controllerGuidance, /logical correction/);
	assert.match(controllerGuidance, /diff lines/);
});

test("correction-plan collection demands provider-bounded lines, then returns its terminal closure", async () => {
	const lineageId = "review-correction";
	const input = {
		name: "correction_plan",
		schema: "https://gentle-ai.dev/schema/review/correction-plan/v1",
		captureOperation: "review.capture-correction-plan",
		arguments: [
			{ name: "lineage", value: lineageId, token: `--lineage=${lineageId}` },
			{ name: "target", value: SHA, token: `--target=${SHA}` },
		],
		submission: {
			operationToken: "capture-correction-plan",
			argumentTokens: [`--lineage=${lineageId}`, "--correction-lines={{value}}"],
			values: [{ slot: "correction_lines", domain: "integer", substitutionLocation: 1, minimum: 2, maximum: 8 }],
		},
	} as unknown as ReviewCollectInputV3;
	const planStatus = { ...status(lineageId), nextTransition: { kind: "collect", reasonCode: "correction_plan_required", collect: { inputs: [input] } } } as ReviewStatusV3;
	let captures = 0;
	const native = {
		targetStatus: async () => planStatus,
		captureCorrectionPlan: async (request: { correctionLines: number; argumentTokens: readonly string[] }) => {
			captures += 1;
			assert.equal(request.correctionLines, 3);
			assert.deepEqual(request.argumentTokens, [`--lineage=${lineageId}`, "--correction-lines={{value}}"]);
			return { schema: "gentle-ai.review-last-event-closure/v1", operation: "review.capture-correction-plan", lineageId, state: "approved", storeRevision: SHA };
		},
	} as unknown as NativeReviewCli;
	const binding = JSON.stringify(input);
	const required = await __testing.executeReviewCaptureOperation({ lineageId, collectBinding: binding }, process.cwd(), native);
	assert.equal(required.outcome, "correction-lines-required");
	const complete = await __testing.executeReviewCaptureOperation({ lineageId, collectBinding: binding, correctionLines: 3 }, process.cwd(), native);
	assert.equal(complete.outcome, "native-last-event-closure");
	assert.equal(captures, 1);
});

test("capture refuses a stale binding before any provider mutation", async () => {
	const lineageId = "review-stale-binding";
	const current = collectInput(lineageId);
	const native = {
		targetStatus: async () => status(lineageId),
		captureResult: async () => { throw new Error("must not capture"); },
	} as unknown as NativeReviewCli;
	const stale = { ...current, arguments: [...current.arguments, { name: "unexpected", value: "drift", token: "--unexpected=drift" }] };
	const result = await __testing.executeReviewCaptureOperation({ lineageId, collectBinding: JSON.stringify(stale) }, process.cwd(), native);
	assert.equal(result.outcome, "capture-binding-rejected");
	assert.equal(result.mutation_outcome, "none");
	const foreign = { ...current, arguments: current.arguments.map((argument) => argument.name === "lineage" ? { ...argument, value: "foreign-lineage", token: "--lineage=foreign-lineage" } : argument) };
	const foreignResult = await __testing.executeReviewCaptureOperation({ lineageId, collectBinding: JSON.stringify(foreign) }, process.cwd(), native);
	assert.equal(foreignResult.outcome, "capture-binding-rejected");
	assert.equal(foreignResult.mutation_outcome, "none");
});

test("ordinary START rejects unknown, legacy-policy, and invalid focus inputs before the mode gate", async () => {
	for (const input of [
		{ mode: "ordinary", unexpected: true },
		{ mode: "ordinary", policyHash: "legacy-policy" },
		{ mode: "ordinary", focus: "not-a-native-focus" },
	]) {
		let statusCalls = 0;
		const native = {
			reviewMode: async () => { throw new Error("mode gate must not run"); },
			targetStatus: async () => { statusCalls += 1; return status("unreachable"); },
		} as unknown as NativeReviewCli;
		const result = await __testing.executeReviewControllerOperation({ operation: "start", input: JSON.stringify(input) }, process.cwd(), native);
		assert.match(String(result.outcome), /^native-start-/);
		assert.equal(result.mutation_outcome, "none");
		assert.equal(statusCalls, 0);
	}
});

test("ordinary START preserves a target STATUS failure instead of constructing compact fallback authority", async () => {
	const native = {
		targetStatus: async () => { throw new NativeReviewCliError(NATIVE_REVIEW_ERROR_CODE.OUTPUT_LIMIT, "review/status", true, false, "status too large"); },
	} as unknown as NativeReviewCli;
	const result = await __testing.executeReviewControllerOperation({ operation: "start", input: JSON.stringify({ mode: "ordinary" }) }, process.cwd(), native);
	assert.equal(result.status, "blocked");
	assert.equal(result.outcome, "native-operation-failed");
	assert.equal(result.mutation_outcome, "none");
	assert.equal((result.diagnostics as { error_code?: string }).error_code, NATIVE_REVIEW_ERROR_CODE.OUTPUT_LIMIT);
});

test("ordinary START leaves the review-mode gate dark when the native client does not expose it", async (t) => {
	const cwd = repository(t);
	const native = {
		targetStatus: async () => startStatus(cwd),
		start: async () => ({ lineageId: "dark-mode-lineage", state: "reviewing", riskLevel: "medium", selectedLenses: ["review-reliability"], changedFiles: 1, changedLines: 1, correctionBudget: 1, action: "created", lensesRequired: true, riskReasons: [] }),
	} as unknown as NativeReviewCli;
	const result = await __testing.executeReviewControllerOperation({ operation: "start", input: JSON.stringify({ mode: "ordinary" }) }, cwd, native);
	assert.equal(result.operation, "start");
	assert.equal((result.result as { lineage_id?: string }).lineage_id, "dark-mode-lineage");
});

test("current STATUS binding allows exactly one provider capture and never follows a retired lifecycle route", async () => {
	const lineageId = "last-event-provider-role";
	const base = collectInput(lineageId);
	const { submission: _submission, artifactSubject: _artifactSubject, ...withoutReviewerDocument } = base;
	void _submission;
	void _artifactSubject;
	const input = {
		...withoutReviewerDocument,
		name: "provider_refuter",
		schema: "https://gentle-ai.dev/schema/review/refuter/v1",
		captureOperation: "review.capture-refuter",
		arguments: [
			{ name: "lineage", value: lineageId, token: `--lineage=${lineageId}` },
			{ name: "target", value: SHA, token: `--target=${SHA}` },
			{ name: "agent", value: "pi", token: "--agent=pi" },
			{ name: "execute", value: "true", token: "--execute=true" },
		],
	} as unknown as ReviewCollectInputV3;
	let statusCalls = 0;
	let captureCalls = 0;
	const native = {
		targetStatus: async () => {
			statusCalls += 1;
			return { ...status(lineageId), nextTransition: { kind: "collect", reasonCode: "provider_role_required", collect: { inputs: [input] } } } as ReviewStatusV3;
		},
		captureProviderRole: async (request: { captureOperation: string; argumentTokens: readonly string[] }) => {
			captureCalls += 1;
			assert.equal(request.captureOperation, "review.capture-refuter");
			assert.deepEqual(request.argumentTokens, [`--lineage=${lineageId}`, `--target=${SHA}`, "--agent=pi", "--execute=true"]);
			return { schema: "gentle-ai.review-last-event-closure/v1", operation: "review.capture-refuter", lineageId, state: "approved", storeRevision: SHA };
		},
	} as unknown as NativeReviewCli;
	const result = await __testing.executeReviewCaptureOperation({ lineageId, collectBinding: JSON.stringify(input) }, process.cwd(), native);
	assert.equal(result.outcome, "native-last-event-closure");
	assert.equal(result.status, "closed");
	assert.equal(statusCalls, 1);
	assert.equal(captureCalls, 1);
});

test("ordinary START transports native focus and safe policy inputs without rebuilding provider authority", async (t) => {
	const cwd = repository(t);
	const seen: Array<Record<string, unknown>> = [];
	// 策略根是 .jero/policies（品牌重命名后的现行布局）。
	mkdirSync(join(cwd, ".jero", "policies"), { recursive: true });
	const policyPath = join(cwd, ".jero", "policies", "focus.json");
	writeFileSync(policyPath, "{}\n");
	const native = {
		targetStatus: async () => startStatus(cwd),
		start: async (request: Record<string, unknown>) => {
			seen.push(request);
			return { lineageId: `focus-${seen.length}`, state: "reviewing", riskLevel: "medium", selectedLenses: ["review-reliability"], changedFiles: 1, changedLines: 1, correctionBudget: 1, action: "created", lensesRequired: true, riskReasons: [] };
		},
	} as unknown as NativeReviewCli;
	for (const focus of [undefined, "risk", "resilience", "readability", "reliability"] as const) {
		const input = { mode: "ordinary", ...(focus === undefined ? {} : { focus }), ...(focus === "risk" ? { policyPath: ".jero/policies/focus.json" } : {}) };
		const result = await __testing.executeReviewControllerOperation({ operation: "start", input: JSON.stringify(input) }, cwd, native);
		assert.equal(result.operation, "start");
	}
	assert.equal(seen.length, 5);
	assert.equal("focus" in seen[0]!, false);
	assert.equal(seen[1]?.focus, "risk");
	assert.equal(seen[1]?.policyPath, policyPath);
	assert.deepEqual(seen.slice(2).map((request) => request.focus), ["resilience", "readability", "reliability"]);

	let statusCalls = 0;
	for (const input of [
		{ mode: "ordinary", focus: "unsupported" },
		{ mode: "ordinary", policyHash: "retired-local-policy" },
		{ mode: "ordinary", policyPath: "../outside" },
	]) {
		const rejected = await __testing.executeReviewControllerOperation({ operation: "start", input: JSON.stringify(input) }, cwd, {
			targetStatus: async () => { statusCalls += 1; return startStatus(cwd); },
		} as unknown as NativeReviewCli);
		assert.match(String(rejected.outcome), /^native-start-/);
		assert.equal(rejected.mutation_outcome, "none");
	}
	assert.equal(statusCalls, 0);
});

test("ordinary START keeps default and explicit base selection fail-closed before native mutation", async (t) => {
	const cwd = repository(t);
	let targetCalls = 0;
	const native = {
		targetStatus: async () => { targetCalls += 1; return startStatus(cwd); },
		start: async () => { throw new Error("must not start"); },
	} as unknown as NativeReviewCli;
	for (const input of [
		{ mode: "ordinary", baseRef: "missing-base", committedOnly: true },
		{ mode: "ordinary", baseRef: "HEAD", committedOnly: false },
		{ mode: "ordinary", baseRef: " HEAD", committedOnly: true },
		{ mode: "ordinary", committedOnly: true },
	]) {
		const rejected = await __testing.executeReviewControllerOperation({ operation: "start", input: JSON.stringify(input) }, cwd, native);
		assert.match(String(rejected.outcome), /^native-start-/);
		assert.equal(rejected.mutation_outcome, "none");
	}
	assert.equal(targetCalls, 0);
});

test("START and consent ambiguity reconciliation register their returned committed collect route", async (t) => {
	const cwd = repository(t), baseRef = execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" }).trim();
	const lineageId = "reconciled-collect", input = correctionPlanInput(lineageId), unknown = () => { throw new NativeReviewCliError(NATIVE_REVIEW_ERROR_CODE.NON_ZERO, "review/start", true, true, "unknown mutation"); };
	const selectors = (requests: readonly Record<string, unknown>[]) => requests.map(({ baseRef: base, committedOnly }) => ({ baseRef: base, committedOnly }));
	const directRequests: Array<Record<string, unknown>> = [], directRoutes = new Map();
	let directStartCalls = 0;
	const directNative = {
		targetStatus: async (request: Record<string, unknown>) => { directRequests.push(request); return directRequests.length === 1 ? startStatus(cwd, baseRef) : status(lineageId, [input]); },
		start: () => { directStartCalls += 1; return unknown(); },
		captureCorrectionPlan: async () => ({ schema: "gentle-ai.review-last-event-closure/v1", operation: "review.capture-correction-plan", lineageId, state: "correction_required", storeRevision: SHA }),
	} as unknown as NativeReviewCli;
	const directStart = await __testing.executeReviewControllerOperation({ operation: "start", input: JSON.stringify({ mode: "ordinary", baseRef, committedOnly: true }) }, cwd, directNative, { retainedUntrackedSelections: directRoutes });
	assert.deepEqual({ outcome: directStart.outcome, status: directStart.status, mutationOutcome: directStart.mutation_outcome, startCalls: directStartCalls, statusCalls: directRequests.length }, { outcome: "native-mutation-status-reconciled", status: "blocked", mutationOutcome: "unknown", startCalls: 1, statusCalls: 2 });
	assert.equal((directStart.diagnostics as { error_code?: string }).error_code, NATIVE_REVIEW_ERROR_CODE.NON_ZERO);
	assert.equal("next_action" in directStart, false);
	const directCapture = await __testing.executeReviewCaptureOperation({ lineageId, collectBinding: bindingOf(directStart), correctionLines: 1 }, cwd, directNative, undefined, undefined, directRoutes, true);
	const consent = decodeReviewConsentV3(JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "fixtures", "devbinary", "consent-v3.captured.json"), "utf8")));
	const consentRequests: Array<Record<string, unknown>> = [], consentRoutes = new Map(), registry = new PendingReviewConsentRegistry(), session = Symbol("consent-session");
	const consentNative = {
		targetStatus: async (request: Record<string, unknown>) => { consentRequests.push(request); return consentRequests.length === 1 ? startStatus(cwd, baseRef) : status(lineageId, [input]); },
		start: async () => { throw new NativeReviewConsentRequiredError(consent); },
		answerConsent: unknown,
		captureCorrectionPlan: directNative.captureCorrectionPlan,
	} as unknown as NativeReviewCli;
	const run = (parameters: Record<string, unknown>) => __testing.executeReviewControllerOperation(parameters, cwd, consentNative, { retainedUntrackedSelections: consentRoutes, pendingReviewConsentRegistry: registry, pendingReviewConsentFallbackKey: session });
	const pending = await run({ operation: "start", input: JSON.stringify({ mode: "ordinary", baseRef, committedOnly: true }) });
	await run({ operation: "answer-consent", input: JSON.stringify({ consentBinding: pending.consent_binding, answer: "granted" }) });
	const consentCapture = await __testing.executeReviewCaptureOperation({ lineageId, collectBinding: JSON.stringify(input), correctionLines: 1 }, cwd, consentNative, undefined, undefined, consentRoutes, true);
	assert.deepEqual({
		outcomes: [directCapture.outcome, consentCapture.outcome],
		directStartCalls,
		selectors: [selectors(directRequests), selectors(consentRequests)],
	}, {
		outcomes: ["native-last-event-closure", "native-last-event-closure"],
		directStartCalls: 1,
		selectors: [Array.from({ length: 3 }, () => ({ baseRef, committedOnly: true })), Array.from({ length: 3 }, () => ({ baseRef, committedOnly: true }))],
	});
});

test("ordinary START refuses a target projection that no longer matches the frozen candidate", async (t) => {
	const cwd = repository(t);
	let startCalls = 0;
	const target = startStatus(cwd);
	target.projection = { ...target.projection, currentCandidateTree: "c".repeat(40) };
	const result = await __testing.executeReviewControllerOperation({ operation: "start", input: JSON.stringify({ mode: "ordinary" }) }, cwd, {
		targetStatus: async () => target,
		start: async () => { startCalls += 1; throw new Error("must not start"); },
	} as unknown as NativeReviewCli);
	assert.equal(result.outcome, "native-operation-failed");
	assert.equal(result.mutation_outcome, "none");
	assert.equal(startCalls, 0);
});

// gentle-pi#455: a consent binding one active Pi session's START created must
// be answerable from another active session presenting the same opaque
// binding id -- consent bindings are not partitioned by which session's
// START created them, only by the repository and candidate they are scoped to.
test("answer-consent resolves a valid binding presented by a different active Pi session", async (t) => {
	const cwd = repository(t);
	const consent = decodeReviewConsentV3(JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "fixtures", "devbinary", "consent-v3.captured.json"), "utf8")));
	const registry = new PendingReviewConsentRegistry();
	const sessionA = Symbol("session-a"), sessionB = Symbol("session-b");
	let answerCalls = 0;
	const native = {
		targetStatus: async () => startStatus(cwd),
		start: async () => { throw new NativeReviewConsentRequiredError(consent); },
		answerConsent: async () => {
			answerCalls += 1;
			return { kind: "granted", start: { lineageId: "cross-session", state: "reviewing", riskLevel: "low", selectedLenses: [], changedFiles: 1, changedLines: 1, correctionBudget: 1, action: "created", lensesRequired: false, riskReasons: [] } };
		},
	} as unknown as NativeReviewCli;
	const started = await __testing.executeReviewControllerOperation({ operation: "start", input: JSON.stringify({ mode: "ordinary" }) }, cwd, native, { retainedUntrackedSelections: undefined, pendingReviewConsentRegistry: registry, pendingReviewConsentFallbackKey: sessionA });
	assert.equal(typeof started.consent_binding, "string", JSON.stringify(started));
	const answered = await __testing.executeReviewControllerOperation({ operation: "answer-consent", input: JSON.stringify({ consentBinding: started.consent_binding, answer: "granted" }) }, cwd, native, { retainedUntrackedSelections: undefined, pendingReviewConsentRegistry: registry, pendingReviewConsentFallbackKey: sessionB });
	assert.equal(answerCalls, 1, JSON.stringify(answered));
	assert.equal((answered.result as { lineage_id?: string } | undefined)?.lineage_id, "cross-session", JSON.stringify(answered));
	assert.notEqual(answered.status, "blocked", JSON.stringify(answered));
});

// gentle-pi#455: cross-session resolution must still enforce single use --
// once a binding is answered by any session, no session (including the one
// whose START created it) may answer it again.
test("a consumed consent binding cannot be answered a second time from any session", async (t) => {
	const cwd = repository(t);
	const consent = decodeReviewConsentV3(JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "fixtures", "devbinary", "consent-v3.captured.json"), "utf8")));
	const registry = new PendingReviewConsentRegistry();
	const sessionA = Symbol("session-a"), sessionB = Symbol("session-b");
	let answerCalls = 0;
	const native = {
		targetStatus: async () => startStatus(cwd),
		start: async () => { throw new NativeReviewConsentRequiredError(consent); },
		answerConsent: async () => {
			answerCalls += 1;
			return { kind: "granted", start: { lineageId: "single-use", state: "reviewing", riskLevel: "low", selectedLenses: [], changedFiles: 1, changedLines: 1, correctionBudget: 1, action: "created", lensesRequired: false, riskReasons: [] } };
		},
	} as unknown as NativeReviewCli;
	const started = await __testing.executeReviewControllerOperation({ operation: "start", input: JSON.stringify({ mode: "ordinary" }) }, cwd, native, { retainedUntrackedSelections: undefined, pendingReviewConsentRegistry: registry, pendingReviewConsentFallbackKey: sessionA });
	const binding = started.consent_binding as string;
	const first = await __testing.executeReviewControllerOperation({ operation: "answer-consent", input: JSON.stringify({ consentBinding: binding, answer: "granted" }) }, cwd, native, { retainedUntrackedSelections: undefined, pendingReviewConsentRegistry: registry, pendingReviewConsentFallbackKey: sessionB });
	assert.equal(answerCalls, 1, JSON.stringify(first));
	const replay = await __testing.executeReviewControllerOperation({ operation: "answer-consent", input: JSON.stringify({ consentBinding: binding, answer: "granted" }) }, cwd, native, { retainedUntrackedSelections: undefined, pendingReviewConsentRegistry: registry, pendingReviewConsentFallbackKey: sessionA });
	assert.equal(answerCalls, 1, JSON.stringify(replay));
	assert.equal(replay.status, "blocked", JSON.stringify(replay));
	assert.equal(replay.outcome, "consent-binding-stale", JSON.stringify(replay));
	assert.equal((replay.diagnostics as { code?: string } | undefined)?.code, "consent-binding-already-consumed", JSON.stringify(replay));
});

// gentle-pi#455 correction: cross-session resolution looks a binding up by
// its opaque id alone, so it must independently refuse an answer presented
// from a different repository than the one its owning START minted it for,
// without ever running the mode gate or native answerConsent, and without
// consuming the binding -- leaving it answerable from the right repository.
test("answer-consent refuses a binding presented from a different repository than the one its START minted, and leaves it answerable from the right one", async (t) => {
	const cwdA = repository(t), cwdB = repository(t);
	const consent = decodeReviewConsentV3(JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "fixtures", "devbinary", "consent-v3.captured.json"), "utf8")));
	const registry = new PendingReviewConsentRegistry();
	const sessionA = Symbol("session-a"), sessionB = Symbol("session-b");
	let answerCalls = 0;
	const native = {
		targetStatus: async () => startStatus(cwdA),
		start: async () => { throw new NativeReviewConsentRequiredError(consent); },
		answerConsent: async () => {
			answerCalls += 1;
			return { kind: "granted", start: { lineageId: "right-repo", state: "reviewing", riskLevel: "low", selectedLenses: [], changedFiles: 1, changedLines: 1, correctionBudget: 1, action: "created", lensesRequired: false, riskReasons: [] } };
		},
	} as unknown as NativeReviewCli;
	const started = await __testing.executeReviewControllerOperation({ operation: "start", input: JSON.stringify({ mode: "ordinary" }) }, cwdA, native, { retainedUntrackedSelections: undefined, pendingReviewConsentRegistry: registry, pendingReviewConsentFallbackKey: sessionA });
	const binding = started.consent_binding as string;
	const wrongRepo = await __testing.executeReviewControllerOperation({ operation: "answer-consent", input: JSON.stringify({ consentBinding: binding, answer: "granted" }) }, cwdB, native, { retainedUntrackedSelections: undefined, pendingReviewConsentRegistry: registry, pendingReviewConsentFallbackKey: sessionB });
	assert.equal(answerCalls, 0, JSON.stringify(wrongRepo));
	assert.equal(wrongRepo.status, "blocked", JSON.stringify(wrongRepo));
	assert.equal(wrongRepo.outcome, "consent-binding-repository-mismatch", JSON.stringify(wrongRepo));
	assert.equal((wrongRepo.diagnostics as { code?: string } | undefined)?.code, "consent-binding-repository-mismatch", JSON.stringify(wrongRepo));
	assert.equal(wrongRepo.mutation_performed, false, JSON.stringify(wrongRepo));
	const rightRepo = await __testing.executeReviewControllerOperation({ operation: "answer-consent", input: JSON.stringify({ consentBinding: binding, answer: "granted" }) }, cwdA, native, { retainedUntrackedSelections: undefined, pendingReviewConsentRegistry: registry, pendingReviewConsentFallbackKey: sessionA });
	assert.equal(answerCalls, 1, JSON.stringify(rightRepo));
	assert.equal((rightRepo.result as { lineage_id?: string } | undefined)?.lineage_id, "right-repo", JSON.stringify(rightRepo));
});

// gentle-pi#323: within the live consent TTL window, a content-independent
// replay key let a second ordinary START reuse the first START's still-live
// (never lineage-bound) frozen candidate view even though the live candidate
// content changed underneath it, and then dead-ended at
// candidate-target-projection-drift instead of minting a fresh view and a
// fresh consent envelope. An intended-untracked selection is retained across
// both calls so the pre-existing empty-untracked drift-recovery branch does
// not mask the general content-change gap this covers.
test("ordinary START mints a fresh candidate view when candidate content changes within the live consent TTL window", async (t) => {
	const candidateViews = new CandidateViewRegistry();
	t.after(() => candidateViews.cleanupAll());
	const cwd = repository(t);
	writeFileSync(join(cwd, "extra.md"), "kept\n");
	const consent = decodeReviewConsentV3(JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "fixtures", "devbinary", "consent-v3.captured.json"), "utf8")));
	const native = {
		targetStatus: async () => startStatus(cwd, undefined, ["extra.md"]),
		start: async () => { throw new NativeReviewConsentRequiredError(consent); },
	} as unknown as NativeReviewCli;
	const first = await __testing.executeReviewControllerOperation({ operation: "start", input: JSON.stringify({ mode: "ordinary" }) }, cwd, native, { candidateViews: candidateViews });
	assert.equal(first.outcome, "native-review-consent-required", JSON.stringify(first));
	writeFileSync(join(cwd, "tracked.txt"), "candidate two\n");
	const second = await __testing.executeReviewControllerOperation({ operation: "start", input: JSON.stringify({ mode: "ordinary" }) }, cwd, native, { candidateViews: candidateViews });
	assert.notEqual(second.outcome, "native-operation-failed", JSON.stringify(second));
	assert.equal(second.outcome, "native-review-consent-required", JSON.stringify(second));
	assert.notEqual(second.consent_binding, first.consent_binding, JSON.stringify(second));
});

test("controller-owned dispatch confines single and parallel graph actors to the current candidate view", async (t) => {
	const cwd = repository(t);
	const candidateViews = new CandidateViewRegistry();
	const lenses = ["review-risk", "review-resilience", "review-readability", "review-reliability"] as const;
	const { controller, toolCall } = reviewRuntime({
		targetStatus: async () => startStatus(cwd),
		start: async () => ({ lineageId: "current-4r", state: "reviewing", riskLevel: "high", selectedLenses: lenses, changedFiles: 1, changedLines: 1, correctionBudget: 1, action: "created", lensesRequired: true, riskReasons: [] }),
	} as unknown as NativeReviewCli, candidateViews);
	await controller.execute("start", { operation: "start", input: JSON.stringify({ mode: "ordinary" }) }, undefined, undefined, reviewContext(cwd));
	const current = candidateViews.resolveForLens("current-4r", "review-risk");
	try {
		const single = { agent: "review-risk", task: "Inspect", mode: "task" };
		const parallel = { agents: [...lenses], task: "Inspect", mode: "task" };
		assert.equal(await toolCall({ toolName: "subagent_run", input: single }, reviewContext(cwd)), undefined);
		assert.equal(await toolCall({ toolName: "subagent_run", input: parallel }, reviewContext(cwd)), undefined);
		for (const task of [single.task, parallel.task]) {
			assert.match(task, /Controller-owned review lineage: `current-4r`/);
			assert.match(task, new RegExp(`Frozen candidate tree: \`${current.candidateTree}\``));
			assert.match(task, /ambient contributor working directory is out of scope/);
		}
		for (const malformed of [
			{ agent: "review-risk", agents: ["review-risk"], task: "Inspect", mode: "task" },
			{ agents: ["review-risk", "worker"], task: "Inspect", mode: "task" },
			{ agent: "review-risk", task: "Inspect", mode: "background" },
		]) {
			const rejected = await toolCall({ toolName: "subagent_run", input: malformed }, reviewContext(cwd)) as { block?: boolean };
			assert.equal(rejected.block, true);
		}
	} finally {
		candidateViews.cleanup(current.token);
	}
});

test("controller forwards AbortSignal and retains typed native diagnostics without fallback authority", async (t) => {
	const cwd = repository(t);
	const controller = new AbortController();
	let targetSignal: AbortSignal | undefined;
	let startSignal: AbortSignal | undefined;
	const native = {
		targetStatus: async (request: { signal?: AbortSignal }) => { targetSignal = request.signal; return startStatus(cwd); },
		start: async (request: { signal?: AbortSignal }) => {
			startSignal = request.signal;
			return { lineageId: "signal-lineage", state: "reviewing", riskLevel: "medium", selectedLenses: ["review-reliability"], changedFiles: 1, changedLines: 1, correctionBudget: 1, action: "created", lensesRequired: true, riskReasons: [] };
		},
	} as unknown as NativeReviewCli;
	const started = await __testing.executeReviewControllerOperation({ operation: "start", input: JSON.stringify({ mode: "ordinary" }) }, cwd, native, { signal: controller.signal });
	assert.equal(started.operation, "start");
	assert.equal(targetSignal, controller.signal);
	assert.equal(startSignal, controller.signal);

	for (const operation of ["inspect", "start", "repair"] as const) {
		const input = operation === "start" ? JSON.stringify({ mode: "ordinary" }) : undefined;
		const failed = await __testing.executeReviewControllerOperation({ operation, ...(input === undefined ? {} : { input }) }, cwd, {
			targetStatus: async () => { throw new NativeReviewCliError(NATIVE_REVIEW_ERROR_CODE.PACKAGE_BINARY_MISSING, "review/status", false, false, "package binary missing"); },
		} as unknown as NativeReviewCli);
		// 外部二进制已随 D7 退役。inspect（只读）走 nativeStatusFailed 统一为
		// native-status-unavailable；start/repair（变更）走 nativeOperationFailure。
		// 两条路径都在 diagnostics 里保留原始错误码。
		// start 先经 targetStatus 对账失败后落入变更失败路径；
		// inspect/repair 的 STATUS 读取失败统一为 unavailable。
		assert.equal(failed.outcome, operation === "start" ? "native-operation-failed" : "native-status-unavailable", `operation=${operation} outcome=${failed.outcome}`);
		assert.equal(failed.mutation_outcome, "none");
		assert.equal((failed.diagnostics as { error_code?: string }).error_code, NATIVE_REVIEW_ERROR_CODE.PACKAGE_BINARY_MISSING);
	}
});

// #465: a collect-state STATUS/INSPECT/START answer used to carry every
// provider collect input twice, once inside result.next_transition.collect
// and once as the canonical collectBinding string, so a four-lens review paid
// roughly 28k characters per call and again on every blocked retry. The
// consumed projection is collectBindings; the raw inputs are the duplicate.
export function fourLensCollectStatus(): { raw: Record<string, unknown>; lenses: readonly string[] } {
	const captured = JSON.parse(readFileSync(new URL("./fixtures/devbinary/status-v5-capture-result-submission.captured.json", import.meta.url), "utf8")) as Record<string, unknown>;
	const nextTransition = captured.next_transition as { collect: { inputs: Array<Record<string, unknown>> } };
	const template = nextTransition.collect.inputs[0]!;
	const lenses = ["review-risk", "review-readability", "review-reliability", "review-resilience"] as const;
	// The captured input names its lens in the capture arguments and again in
	// the provider-owned submission tokens; rewrite every occurrence so each of
	// the four inputs is one distinct provider slot.
	const inputs = lenses.map((lens, order) => JSON.parse(JSON.stringify(template).replaceAll("review-reliability", lens).replaceAll("--order=0", `--order=${order}`)) as Record<string, unknown>);
	// The captured envelope predates the current action enumeration; the collect transition is what this test exercises.
	return { raw: { ...captured, action: "stop", next_transition: { ...nextTransition, collect: { inputs } } }, lenses };
}

export function occurrences(haystack: string, needle: string): number {
	return haystack.split(needle).length - 1;
}

test("collect-state public STATUS, INSPECT, and START serialize each provider collect input exactly once", async () => {
	const { raw, lenses } = fourLensCollectStatus();
	const status = decodeReviewStatusV3(raw);
	const lineageId = status.authority!.lineageId!;
	const native = { targetStatus: async () => status } as unknown as NativeReviewCli;
	for (const parameters of [
		{ operation: "status", lineageId },
		{ operation: "inspect" },
		{ operation: "start", input: JSON.stringify({ mode: "ordinary" }) },
	] as const) {
		const result = await __testing.executeReviewControllerOperation(parameters, process.cwd(), native);
		assert.equal(result.status, "blocked", parameters.operation);
		const bindings = result.collectBindings as readonly { collectBinding: string }[];
		assert.equal(bindings.length, lenses.length, parameters.operation);
		const serialized = JSON.stringify(result);
		const projected = JSON.stringify(bindings);
		for (const lens of lenses) {
			const needle = `--lens=${lens}`;
			assert.ok(occurrences(projected, needle) > 0, `${lens} must be published through collectBindings`);
			assert.equal(occurrences(JSON.stringify(result.result), needle), 0, `${parameters.operation} must not repeat the ${lens} collect input inside result (${serialized.length} characters)`);
			assert.equal(occurrences(serialized, needle), occurrences(projected, needle), `${parameters.operation} must serialize the ${lens} collect input exactly once (${serialized.length} characters)`);
		}
		const transition = (result.result as { next_transition: { kind: string } }).next_transition;
		assert.equal(transition.kind, "collect", `${parameters.operation} keeps the transition kind so the orchestrator still sees the collect state`);
		assert.ok(serialized.length < 2 * JSON.stringify(bindings).length, `${parameters.operation} answer (${serialized.length} characters) must not double the ${JSON.stringify(bindings).length}-character binding projection`);
	}
});

