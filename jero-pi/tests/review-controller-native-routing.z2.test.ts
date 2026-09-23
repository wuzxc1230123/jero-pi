// review-controller-native-routing 测试第 2 段（共 3 段；夹具在 review-controller-native-routing-shared.ts）。
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
import { bindingOf, candidateRepository, correctionPlanInput, repository } from "./review-controller-native-routing.test.ts";
import { fourLensCollectStatus, occurrences } from "./review-controller-native-routing.z3.test.ts";

test("candidate lifecycle sweeps startup and cleans every shutdown including reload", async (t) => {
	const cwd = repository(t);
	for (const key of ["HOME", "JERO_PI_AGENT_HOME", "PI_CODING_AGENT_DIR", "JERO_PI_CONFIG_HOME", "JERO_PI_GENTLE_AI_DEV_BINARY"]) {
		const previous = process.env[key];
		process.env[key] = key === "JERO_PI_GENTLE_AI_DEV_BINARY" ? "" : join(cwd, key);
		if (process.env[key]) mkdirSync(process.env[key]!, { recursive: true });
		t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
	}
	t.mock.method(os, "homedir", () => join(cwd, "HOME"));
	const homeAgent = join(cwd, "HOME", ".agents", "isolation-probe.md");
	mkdirSync(dirname(homeAgent), { recursive: true });
	writeFileSync(homeAgent, "---\nname: isolation-probe\ndescription: Fixture\n---\n");
	writeFileSync(join(cwd, "JERO_PI_CONFIG_HOME", "models.json"), JSON.stringify({ "isolation-probe": { model: "fixture/model" } }));
	t.diagnostic(`startup routing: cwd=${cwd}; HOME, JERO_PI_AGENT_HOME, PI_CODING_AGENT_DIR, JERO_PI_CONFIG_HOME are same-named children; dev-binary override disabled`);
	const calls: string[] = [];
	const destinations: string[] = [];
	const violations: string[] = [];
	const discovery: string[] = [];
	const assets = resolve("assets");
	const inside = (root: string, path: string) => path === root || path.startsWith(`${root}${sep}`);
	const originalExists = fs.existsSync;
	const originalRealpath = fs.realpathSync;
	// Install guards BEFORE startup, including RED: a swallowed startup error
	// must never hide an attempted external write or read real-home contents.
	for (const [module, names] of [
		[fs, ["existsSync", "lstatSync", "readdirSync", "readFileSync", "mkdirSync", "writeFileSync", "rmSync"]],
		[fsp, ["access", "readdir", "readFile", "mkdir", "writeFile"]],
	] as const) {
		for (const name of names) {
			const original = (module as any)[name];
			t.mock.method(module as any, name, (value: string, ...args: unknown[]) => {
				const path = resolve(value);
				const writes = /^(mkdir|writeFile|rm)/.test(name);
				const allowed = inside(cwd, path) || (!writes && inside(assets, path));
				if (!allowed && name === "existsSync") return false;
				if (!allowed && ["access", "readdir"].includes(name)) return Promise.reject(Object.assign(new Error("fixture discovery boundary"), { code: "ENOENT" }));
				if (!allowed) { violations.push(`${name}:${path}`); throw new Error("fixture filesystem boundary"); }
				if (writes) {
					let ancestor = path;
					while (!originalExists(ancestor)) ancestor = dirname(ancestor);
					assert.ok(inside(cwd, originalRealpath(ancestor)), "write ancestor escaped fixture");
					destinations.push(path);
				}
				if (name.startsWith("readdir")) discovery.push(path);
				return original(value, ...args);
			});
		}
	}
	syncBuiltinESMExports();
	// Prove the guard refuses an escape without performing the attempted write.
	const escape = join(cwd, "..", "startup-isolation-escape");
	assert.throws(() => fs.writeFileSync(escape, "blocked"), /fixture filesystem boundary/);
	assert.deepEqual(violations, [`writeFileSync:${escape}`]);
	violations.length = 0;
	const hooks = new Map<string, Array<(event: unknown, ctx: ExtensionContext) => unknown>>();
	const registry = new CandidateViewRegistry();
	t.mock.method(registry, "sweepOrphans", (root: string) => { assert.equal(root, cwd); calls.push("sweep"); });
	t.mock.method(registry, "cleanupAll", () => { calls.push("cleanup"); });
	createJeroAiExtension({ nativeReviewCli: null, candidateViews: registry, processEnv: {} })({
		on(name: string, handler: (event: unknown, ctx: ExtensionContext) => unknown) {
			hooks.set(name, [...(hooks.get(name) ?? []), handler]);
		},
		registerTool() {}, registerCommand() {},
	} as unknown as ExtensionAPI);
	try {
		assert.equal(hooks.get("session_start")?.length, 1);
		await hooks.get("session_start")![0]!({ reason: "startup" }, reviewContext(cwd));
		assert.deepEqual(violations, []);
		assert.ok(destinations.length > 0, "startup must actually write fixture assets");
		assert.ok(discovery.includes(join(cwd, "HOME", ".agents")), "home agent discovery must use the fixture");
		assert.equal(existsSync(join(cwd, "JERO_PI_AGENT_HOME", "gentle-ai", "managed-assets.json")), true);
		assert.match(readFileSync(homeAgent, "utf8"), /model: fixture\/model/);
		assert.ok(destinations.includes(homeAgent), "the discovered fixture agent must actually receive routing");
		assert.ok(destinations.includes(join(cwd, "JERO_PI_AGENT_HOME", "subagents.json")));
		t.diagnostic(`confined startup: ${destinations.length} filesystem mutations; fixture home-agent routing and managed-assets manifest verified; external violations=0`);
		assert.deepEqual(calls, ["sweep"]);
	} finally {
		// Restore only mocks before fixture teardown; never clean external paths.
		t.mock.restoreAll();
		syncBuiltinESMExports();
	}
	t.mock.method(registry, "cleanupAll", () => { calls.push("cleanup"); });
	for (const reason of ["quit", "reload", "new", "resume", "fork"]) {
		for (const hook of hooks.get("session_shutdown")!) await hook({ reason }, reviewContext(cwd));
	}
	assert.deepEqual(calls, ["sweep", ...Array(5).fill("cleanup")]);
});

export interface RegisteredControllerTool {
	execute: (toolCallId: string, params: unknown, signal: AbortSignal | undefined, onUpdate: undefined, ctx: ExtensionContext) => Promise<{ details?: unknown }>;
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

test("ordinary START binds the native workspace candidate and returns the native result", async (t) => {
	const cwd = repository(t);
	const target = startStatus(cwd);
	let targetCalls = 0;
	let startCalls = 0;
	const native = {
		targetStatus: async (request: { cwd: string }) => {
			targetCalls += 1;
			assert.equal(request.cwd, cwd);
			return target;
		},
		start: async (request: { targetIdentity?: string }) => {
			startCalls += 1;
			assert.equal(request.targetIdentity, SHA);
			return { lineageId: "review-started", state: "reviewing", riskLevel: "low", selectedLenses: [], changedFiles: 1, changedLines: 1, correctionBudget: 1, action: "created", lensesRequired: false, riskReasons: [], raw: {} };
		},
	} as unknown as NativeReviewCli;
	const result = await __testing.executeReviewControllerOperation({ operation: "start", input: JSON.stringify({ mode: "ordinary" }) }, cwd, native);
	assert.equal(result.operation, "start");
	assert.equal(targetCalls, 1);
	assert.equal(startCalls, 1);
});

test("ordinary START preserves sanitized foreign diagnostics through one ambiguous reconciliation", async (t) => {
	const cwd = repository(t);
	const target = startStatus(cwd);
	let targetCalls = 0;
	let startCalls = 0;
	const native = {
		targetStatus: async () => {
			targetCalls += 1;
			return target;
		},
		start: async () => {
			startCalls += 1;
			throw {
				name: "NativeReviewCliError",
				code: NATIVE_REVIEW_ERROR_CODE.NON_ZERO,
				mutationOutcome: "unknown",
				nextAction: "review.status",
				diagnostics: {
					operation: "review/start",
					error_code: NATIVE_REVIEW_ERROR_CODE.NON_ZERO,
					exit_code: 1,
					timed_out: false,
					output_limit_exceeded: false,
					stderr: "token=secret",
				},
			};
		},
	} as unknown as NativeReviewCli;

	const result = await __testing.executeReviewControllerOperation({ operation: "start", input: JSON.stringify({ mode: "ordinary" }) }, cwd, native);
	assert.equal(result.outcome, "native-mutation-status-reconciled");
	assert.equal(result.mutation_outcome, "unknown");
	assert.deepEqual(result.diagnostics, {
		operation: "review/start",
		error_code: NATIVE_REVIEW_ERROR_CODE.NON_ZERO,
		exit_code: 1,
		timed_out: false,
		output_limit_exceeded: false,
		stderr: "token=[REDACTED]",
	});
	assert.match(String(result.required_status_action), /Run target-scoped review\.status/);
	assert.equal(result.next_action, "start");
	assert.equal(targetCalls, 2, "START failure reconciles STATUS exactly once");
	assert.equal(startCalls, 1, "reconciliation never replays START");
});

test("ambiguous START reconciliation preserves the provider-selected recovery directive", async (t) => {
	const cwd = repository(t), recoveryStatus = status("recovery-lineage");
	recoveryStatus.action = "recover";
	recoveryStatus.actionDisposition = "escalated";
	recoveryStatus.nextTransition = { kind: "stop", reasonCode: "manual_intervention_required" };
	let targetCalls = 0, startCalls = 0;
	const native = {
		targetStatus: async () => {
			targetCalls += 1;
			return targetCalls === 1 ? startStatus(cwd) : recoveryStatus;
		},
		start: async () => {
			startCalls += 1;
			throw new NativeReviewCliError(NATIVE_REVIEW_ERROR_CODE.NON_ZERO, "review/start", true, true, "unknown mutation");
		},
	} as unknown as NativeReviewCli;

	const result = await __testing.executeReviewControllerOperation({ operation: "start", input: JSON.stringify({ mode: "ordinary" }) }, cwd, native);
	assert.equal(result.outcome, "native-mutation-status-reconciled");
	assert.equal(result.mutation_outcome, "unknown");
	assert.equal(result.next_action, "recover-with-provider-disposition");
	assert.equal(result.required_status_action, "Use only the provider-selected recovery disposition; do not substitute scope_changed, invalidated, or escalated.");
	assert.equal(targetCalls, 2, "START failure reconciles STATUS exactly once");
	assert.equal(startCalls, 1, "reconciliation never replays START");
});

for (const statusSchema of ["gentle-ai.review-integration.status/v6", "gentle-ai.review-integration.status/v7"]) test(`pre-lineage intended-untracked selection revalidates and starts at an explicit workspace root (${statusSchema})`, async (t) => {
	const cwd = realpathSync(repository(t)), sessionCwd = repository(t), eligible = "selected.md";
	writeFileSync(join(cwd, eligible), "selected\n");
	const initialTarget = startStatus(cwd), target = startStatus(cwd, undefined, [eligible]);
	const selection: ReviewCollectInputV3 = {
		name: "intended_untracked_selection", schema: "gentle-ai.review-intended-untracked-selection/v1", captureOperation: "external.select_intended_untracked",
		arguments: [
			{ name: "target_identity", value: SHA }, { name: "projection", value: "workspace" },
			{ name: "base_tree", value: initialTarget.projection.baseTree }, { name: "candidate_tree", value: initialTarget.projection.currentCandidateTree },
			{ name: "eligible_paths_json", value: JSON.stringify([eligible]) }, { name: "expected_untracked_inventory", value: SHA },
		],
		submission: { operationToken: "status", argumentTokens: ["--contract=gentle-ai.review-integration/v2", "--next-transition=true", "--agent=pi", "--projection=workspace", "--intended-untracked-selection={{value}}"], values: [{ slot: "intended_untracked_selection", domain: "schema_bound_json", schema: "gentle-ai.review-intended-untracked-selection/v1", substitutionLocation: 4 }] },
	};
	const initial = { ...initialTarget, nextTransition: { kind: "collect", reasonCode: "intended_untracked_selection_required", collect: { inputs: [selection] } }, raw: { schema: statusSchema } } as ReviewStatusV3;
	const requests: Array<Record<string, unknown>> = [], starts: Array<Record<string, unknown>> = [], retained = new Map();
	const native = {
		reviewMode: async () => ({ operation: "status", scope: "clone", status: { global: "on", cloneLocal: "on", effective: "on", source: "clone_local" } }),
		targetStatus: async (request: Record<string, unknown>) => { requests.push(request); return "intendedUntrackedSelection" in request ? target : initial; },
		start: async (request: Record<string, unknown>) => { assert.equal(retained.size, 0); starts.push(request); return { lineageId: "selected", state: "reviewing", riskLevel: "low", selectedLenses: [], changedFiles: 1, changedLines: 1, correctionBudget: 1, action: "created", lensesRequired: false, riskReasons: [], raw: {} }; },
	} as unknown as NativeReviewCli;
	const listed = await __testing.executeReviewControllerOperation({ operation: "status", workspaceRoot: cwd }, sessionCwd, native, undefined, undefined, undefined, retained);
	const selectionBinding = listed.selectionBinding as string;
	assert.equal(typeof selectionBinding, "string");
	const selectedResult = await __testing.executeReviewControllerOperation({ operation: "select-intended-untracked", selectionBinding, intendedUntracked: [eligible], workspaceRoot: cwd } as never, sessionCwd, native, undefined, undefined, undefined, retained);
	assert.equal(starts.length, 1, JSON.stringify(selectedResult));
	assert.deepEqual(requests.map((request) => request.cwd), [cwd, cwd, cwd]);
	assert.equal(starts[0]!.cwd, cwd);
	assert.deepEqual(starts[0]!.intendedUntrackedSelection, { argumentTokens: selection.submission!.argumentTokens, value: JSON.stringify({ schema: "gentle-ai.review-intended-untracked-selection/v1", untracked_scope: "select", expected_untracked_inventory: SHA, intended_untracked: [eligible] }) });
	for (const invalid of [
		{ selectionBinding: selectionBinding.replace(eligible, "docs/stale.md"), intendedUntracked: [eligible] },
		{ selectionBinding, intendedUntracked: [eligible, eligible] }, { selectionBinding, intendedUntracked: ["docs/unknown.md"] },
	]) {
		const rejection = await __testing.executeReviewControllerOperation({ operation: "select-intended-untracked", ...invalid } as never, cwd, native, undefined, undefined, undefined, retained);
		assert.equal(rejection.status, "blocked", JSON.stringify(invalid));
		assert.equal(rejection.outcome, "intended-untracked-selection-binding-rejected", JSON.stringify(invalid));
		assert.equal(rejection.mutation_performed, false, JSON.stringify(invalid));
		assert.equal(rejection.mutation_outcome, "none", JSON.stringify(invalid));
	}
	await assert.rejects(() => __testing.executeReviewControllerOperation({ operation: "select-intended-untracked", selectionBinding, intendedUntracked: [eligible], input: "{}" } as never, cwd, native, undefined, undefined, undefined, retained), /exactly selectionBinding/);
	assert.equal(starts.length, 1);
	assert.equal(requests.every((request) => !("lineageId" in request)), true);
});

// gentle-pi#706: inspect names the exact continuation for the intended-untracked
// stop and can resolve it in one call through top-level untrackedScope.
export function untrackedStopFixture(
	t: test.TestContext,
	statusSchema = "gentle-ai.review-integration.status/v7",
): {
	cwd: string;
	eligible: string;
	initial: ReviewStatusV3;
	target: ReviewStatusV3;
	selection: ReviewCollectInputV3;
} {
	const cwd = repository(t),
		eligible = "selected.md";
	writeFileSync(join(cwd, eligible), "selected\n");
	const initialTarget = startStatus(cwd),
		target = startStatus(cwd, undefined, [eligible]);
	const selection: ReviewCollectInputV3 = {
		name: "intended_untracked_selection",
		schema: "gentle-ai.review-intended-untracked-selection/v1",
		captureOperation: "external.select_intended_untracked",
		arguments: [
			{ name: "target_identity", value: SHA },
			{ name: "projection", value: "workspace" },
			{ name: "base_tree", value: initialTarget.projection.baseTree },
			{
				name: "candidate_tree",
				value: initialTarget.projection.currentCandidateTree,
			},
			{ name: "eligible_paths_json", value: JSON.stringify([eligible]) },
			{ name: "expected_untracked_inventory", value: SHA },
		],
		submission: {
			operationToken: "status",
			argumentTokens: [
				"--contract=gentle-ai.review-integration/v2",
				"--next-transition=true",
				"--agent=pi",
				"--projection=workspace",
				"--intended-untracked-selection={{value}}",
			],
			values: [
				{
					slot: "intended_untracked_selection",
					domain: "schema_bound_json",
					schema: "gentle-ai.review-intended-untracked-selection/v1",
					substitutionLocation: 4,
				},
			],
		},
	};
	const initial = {
		...initialTarget,
		nextTransition: {
			kind: "collect",
			reasonCode: "intended_untracked_selection_required",
			collect: { inputs: [selection] },
		},
		raw: { schema: statusSchema },
	} as ReviewStatusV3;
	return { cwd, eligible, initial, target, selection };
}

for (const statusSchema of [
	"gentle-ai.review-integration.status/v6",
	"gentle-ai.review-integration.status/v7",
])
	test(`inspect on the intended-untracked stop returns nextStep and the selection binding (${statusSchema})`, async (t) => {
		const { cwd, initial } = untrackedStopFixture(t, statusSchema);
		let targetCalls = 0;
		const native = {
			targetStatus: async () => {
				targetCalls += 1;
				return initial;
			},
		} as unknown as NativeReviewCli;
		const result = await __testing.executeReviewControllerOperation(
			{ operation: "inspect" },
			cwd,
			native,
		);
		assert.equal(result.status, "blocked");
		assert.equal(typeof result.selectionBinding, "string");
		assert.equal(typeof result.nextStep, "string");
		for (const fragment of [
			"select-intended-untracked",
			"untrackedScope",
			".gitignore",
			"path names",
		]) {
			assert.equal((result.nextStep as string).includes(fragment), true, fragment);
		}
		assert.equal(targetCalls, 1);
	});

test("inspect with untrackedScope exclude resolves the intended-untracked stop in one round trip", async (t) => {
	const { cwd, initial, target, selection } = untrackedStopFixture(t);
	const requests: Array<Record<string, unknown>> = [],
		retained = new Map();
	const native = {
		targetStatus: async (request: Record<string, unknown>) => {
			requests.push(request);
			return "intendedUntrackedSelection" in request ? target : initial;
		},
	} as unknown as NativeReviewCli;
	const result = await __testing.executeReviewControllerOperation(
		{ operation: "inspect", untrackedScope: "exclude" },
		cwd,
		native,
		undefined,
		undefined,
		undefined,
		retained,
	);
	assert.equal(result.status, "ready");
	assert.equal("selectionBinding" in result, false);
	assert.equal(requests.length, 2);
	assert.equal(requests[1]!.untrackedScope, "exclude");
	assert.equal(requests[1]!.expectedUntrackedInventory, SHA);
	assert.deepEqual(requests[1]!.intendedUntracked, []);
	assert.deepEqual(requests[1]!.intendedUntrackedSelection, {
		argumentTokens: selection.submission!.argumentTokens,
		value: JSON.stringify({
			schema: "gentle-ai.review-intended-untracked-selection/v1",
			untracked_scope: "exclude",
			expected_untracked_inventory: SHA,
			intended_untracked: [],
		}),
	});
	const retainedEntry = retained.get(`${cwd}\u0000`) as
		| { untrackedScope: string; submission?: unknown }
		| undefined;
	assert.notEqual(retainedEntry, undefined);
	assert.equal(retainedEntry!.untrackedScope, "exclude");
	assert.notEqual(retainedEntry!.submission, undefined);
});

test("inspect with untrackedScope select resolves the stop with exactly the selected paths", async (t) => {
	const { cwd, eligible, initial, target } = untrackedStopFixture(t);
	const requests: Array<Record<string, unknown>> = [];
	const native = {
		targetStatus: async (request: Record<string, unknown>) => {
			requests.push(request);
			return "intendedUntrackedSelection" in request ? target : initial;
		},
	} as unknown as NativeReviewCli;
	const result = await __testing.executeReviewControllerOperation(
		{
			operation: "inspect",
			untrackedScope: "select",
			intendedUntracked: [eligible],
		},
		cwd,
		native,
	);
	assert.equal(result.status, "ready");
	assert.equal(requests.length, 2);
	assert.equal(requests[1]!.untrackedScope, "select");
	assert.deepEqual(requests[1]!.intendedUntracked, [eligible]);
	const submission = requests[1]!.intendedUntrackedSelection as {
		value: string;
	};
	assert.deepEqual(JSON.parse(submission.value), {
		schema: "gentle-ai.review-intended-untracked-selection/v1",
		untracked_scope: "select",
		expected_untracked_inventory: SHA,
		intended_untracked: [eligible],
	});
});

test("inspect with untrackedScope select rejects a path outside the eligible inventory", async (t) => {
	const { cwd, initial } = untrackedStopFixture(t);
	let targetCalls = 0;
	const native = {
		targetStatus: async () => {
			targetCalls += 1;
			return initial;
		},
	} as unknown as NativeReviewCli;
	const result = await __testing.executeReviewControllerOperation(
		{
			operation: "inspect",
			untrackedScope: "select",
			intendedUntracked: ["docs/unknown.md"],
		},
		cwd,
		native,
	);
	assert.equal(result.status, "blocked");
	assert.equal(result.outcome, "inspect-untracked-scope-invalid");
	assert.equal(result.mutation_performed, false);
	assert.equal(result.mutation_outcome, "none");
	assert.equal(targetCalls, 1);
});

for (const invalid of [
	{ untrackedScope: "select" },
	{ untrackedScope: "exclude", intendedUntracked: ["selected.md"] },
] as const)
	test(`inspect rejects an inconsistent untracked scope combination (${JSON.stringify(invalid)})`, async (t) => {
		const { cwd, initial } = untrackedStopFixture(t);
		let targetCalls = 0;
		const native = {
			targetStatus: async () => {
				targetCalls += 1;
				return initial;
			},
		} as unknown as NativeReviewCli;
		if (invalid.untrackedScope === "exclude") {
			await assert.rejects(
				() => __testing.executeReviewControllerOperation({ operation: "inspect", ...invalid }, cwd, native),
				/requires untrackedScope select/,
			);
			assert.equal(targetCalls, 0);
			return;
		}
		const result = await __testing.executeReviewControllerOperation(
			{ operation: "inspect", ...invalid },
			cwd,
			native,
		);
		assert.equal(result.status, "blocked");
		assert.equal(result.outcome, "inspect-untracked-scope-invalid");
		assert.equal(result.mutation_performed, false);
		assert.equal(result.mutation_outcome, "none");
		assert.equal(targetCalls, 1);
	});

test("inspect with untrackedScope and no intended-untracked stop reports not-required", async (t) => {
	const { cwd, target } = untrackedStopFixture(t);
	let targetCalls = 0;
	const native = {
		targetStatus: async () => {
			targetCalls += 1;
			return target;
		},
	} as unknown as NativeReviewCli;
	const result = await __testing.executeReviewControllerOperation(
		{ operation: "inspect", untrackedScope: "exclude" },
		cwd,
		native,
	);
	assert.equal(result.status, "ready");
	assert.equal(result.untracked_selection, "not-required");
	assert.equal(targetCalls, 1);
});

test("plain START adopts the pre-lineage selection retained by inspect and deletes it after success", async (t) => {
	const { cwd, eligible, initial, target, selection } = untrackedStopFixture(t);
	const requests: Array<Record<string, unknown>> = [],
		starts: Array<Record<string, unknown>> = [],
		retained = new Map();
	const native = {
		targetStatus: async (request: Record<string, unknown>) => {
			requests.push(request);
			return "intendedUntrackedSelection" in request ? target : initial;
		},
		start: async (request: Record<string, unknown>) => {
			starts.push(request);
			return {
				lineageId: "review-started",
				state: "reviewing",
				riskLevel: "low",
				selectedLenses: [],
				changedFiles: 1,
				changedLines: 1,
				correctionBudget: 1,
				action: "created",
				lensesRequired: false,
				riskReasons: [],
				raw: {},
			};
		},
	} as unknown as NativeReviewCli;
	const resolved = await __testing.executeReviewControllerOperation(
		{
			operation: "inspect",
			untrackedScope: "select",
			intendedUntracked: [eligible],
		},
		cwd,
		native,
		undefined,
		undefined,
		undefined,
		retained,
	);
	assert.equal(resolved.status, "ready");
	const started = await __testing.executeReviewControllerOperation(
		{ operation: "start", input: JSON.stringify({ mode: "ordinary" }) },
		cwd,
		native,
		undefined,
		undefined,
		undefined,
		retained,
	);
	assert.equal(started.operation, "start");
	assert.equal((started.result as Record<string, unknown>).lineage_id, "review-started");
	assert.equal(starts.length, 1);
	assert.equal(requests.length, 3);
	const startStatusRequest = requests[2]!;
	assert.equal(startStatusRequest.untrackedScope, "select");
	assert.equal(startStatusRequest.expectedUntrackedInventory, SHA);
	assert.deepEqual(startStatusRequest.intendedUntracked, [eligible]);
	assert.deepEqual(startStatusRequest.intendedUntrackedSelection, {
		argumentTokens: selection.submission!.argumentTokens,
		value: JSON.stringify({
			schema: "gentle-ai.review-intended-untracked-selection/v1",
			untracked_scope: "select",
			expected_untracked_inventory: SHA,
			intended_untracked: [eligible],
		}),
	});
	assert.equal(starts[0]!.untrackedScope, "select");
	assert.equal(retained.has(`${cwd}\u0000`), false);
	const lineageEntry = retained.get(`${cwd}\u0000review-started`) as
		| { untrackedScope: string; submission?: unknown }
		| undefined;
	assert.notEqual(lineageEntry, undefined);
	assert.equal(lineageEntry!.untrackedScope, "select");
	assert.notEqual(lineageEntry!.submission, undefined);
});

test("untrackedScope is accepted only by the inspect operation", async (t) => {
	const { cwd, initial } = untrackedStopFixture(t);
	const native = {
		targetStatus: async () => initial,
	} as unknown as NativeReviewCli;
	await assert.rejects(
		() =>
			__testing.executeReviewControllerOperation(
				{ operation: "status", untrackedScope: "exclude" } as never,
				cwd,
				native,
			),
		/does not accept untrackedScope/,
	);
	await assert.rejects(
		() =>
			__testing.executeReviewControllerOperation(
				{
					operation: "start",
					input: JSON.stringify({ mode: "ordinary" }),
					untrackedScope: "exclude",
				} as never,
				cwd,
				native,
			),
		/does not accept untrackedScope/,
	);
});

test("top-level intendedUntracked is accepted only by inspect select", async (t) => {
		const { cwd, initial } = untrackedStopFixture(t);
		const native = { targetStatus: async () => initial } as unknown as NativeReviewCli;
		for (const parameters of [
			{ operation: "inspect", intendedUntracked: [] },
			{ operation: "inspect", untrackedScope: "exclude", intendedUntracked: [] },
			{ operation: "status", intendedUntracked: [] },
			{ operation: "start", input: JSON.stringify({ mode: "ordinary" }), intendedUntracked: [] },
		] as const) {
			await assert.rejects(
				() => __testing.executeReviewControllerOperation(parameters as never, cwd, native),
				/intendedUntracked/,
				JSON.stringify(parameters),
			);
		}
	});

test("a fresh unsuccessful inspect invalidates its prior pre-lineage selection", async (t) => {
		const { cwd, eligible, initial, target } = untrackedStopFixture(t);
		const retained = new Map();
		let failInspect = false;
		const native = {
			targetStatus: async (request: Record<string, unknown>) => {
				if (failInspect) throw new Error("inspect unavailable");
				return "intendedUntrackedSelection" in request ? target : initial;
			},
		} as unknown as NativeReviewCli;
		await __testing.executeReviewControllerOperation(
			{ operation: "inspect", untrackedScope: "select", intendedUntracked: [eligible] },
			cwd, native, undefined, undefined, undefined, retained,
		);
		assert.equal(retained.has(`${cwd}\u0000`), true);
		failInspect = true;
		const failed = await __testing.executeReviewControllerOperation(
			{ operation: "inspect" }, cwd, native, undefined, undefined, undefined, retained,
		);
		assert.equal(failed.outcome, "native-status-unavailable");
		assert.equal(retained.has(`${cwd}\u0000`), false);
	});

test("START rejects a retained pre-lineage selection when fresh STATUS identifies a changed candidate", async (t) => {
		const { cwd, eligible, initial, target } = untrackedStopFixture(t);
		const retained = new Map();
		const candidateA = {
			...target,
			targetIdentity: "target-a",
			projection: { ...target.projection, currentCandidateTree: "candidate-a" },
		} as ReviewStatusV3;
		const candidateB = {
			...target,
			targetIdentity: "target-b",
			projection: { ...target.projection, currentCandidateTree: "candidate-b" },
		} as ReviewStatusV3;
		let resolved = false;
		let starts = 0;
		const native = {
			targetStatus: async (request: Record<string, unknown>) => {
				if (!("intendedUntrackedSelection" in request)) return initial;
				if (!resolved) { resolved = true; return candidateA; }
				return candidateB;
			},
			start: async () => {
				starts += 1;
				return { lineageId: "unexpected", state: "reviewing", riskLevel: "low", selectedLenses: [], changedFiles: 1, changedLines: 1, correctionBudget: 1, action: "created", lensesRequired: false, riskReasons: [], raw: {} };
			},
		} as unknown as NativeReviewCli;
		await __testing.executeReviewControllerOperation(
			{ operation: "inspect", untrackedScope: "select", intendedUntracked: [eligible] },
			cwd, native, undefined, null, undefined, retained,
		);
		const rejected = await __testing.executeReviewControllerOperation(
			{ operation: "start", input: JSON.stringify({ mode: "ordinary" }) },
			cwd, native, undefined, null, undefined, retained,
		);
		assert.equal(rejected.outcome, "native-start-retained-selection-candidate-mismatch");
		assert.equal(starts, 0);
		assert.equal(retained.has(`${cwd}\u0000`), false);
	});

test("a failed START retains a pre-lineage selection for a same-candidate retry", async (t) => {
		const { cwd, eligible, initial, target } = untrackedStopFixture(t);
		const retained = new Map();
		let starts = 0;
		const native = {
			targetStatus: async (request: Record<string, unknown>) =>
				"intendedUntrackedSelection" in request ? target : initial,
			start: async () => {
				starts += 1;
				if (starts === 1) throw Object.assign(new Error("retryable failure"), { mutationOutcome: "none" });
				return { lineageId: "retried", state: "reviewing", riskLevel: "low", selectedLenses: [], changedFiles: 1, changedLines: 1, correctionBudget: 1, action: "created", lensesRequired: false, riskReasons: [], raw: {} };
			},
		} as unknown as NativeReviewCli;
		await __testing.executeReviewControllerOperation(
			{ operation: "inspect", untrackedScope: "select", intendedUntracked: [eligible] },
			cwd, native, undefined, null, undefined, retained,
		);
		const failed = await __testing.executeReviewControllerOperation(
			{ operation: "start", input: JSON.stringify({ mode: "ordinary" }) },
			cwd, native, undefined, null, undefined, retained,
		);
		assert.equal(failed.mutation_outcome, "none");
		assert.equal(retained.has(`${cwd}\u0000`), true);
		const retried = await __testing.executeReviewControllerOperation(
			{ operation: "start", input: JSON.stringify({ mode: "ordinary" }) },
			cwd, native, undefined, null, undefined, retained,
		);
		assert.equal((retried.result as Record<string, unknown>).lineage_id, "retried");
		assert.equal(starts, 2);
		assert.equal(retained.has(`${cwd}\u0000`), false);
	});

