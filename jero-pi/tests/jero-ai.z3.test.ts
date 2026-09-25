// 重平衡分片：自 jero-ai.test.ts 按顶层语句边界对半机械平移（语义零改动）。
// node --test 只在文件间并行；重用例扎堆单文件会抬高整套件并行的下限。

import { default as assert } from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { default as test } from "node:test";
import { gzipSync } from "node:zlib";
import { type ExtensionAPI, type ExtensionContext, initTheme, keyHint, type Theme, type ToolCallEventResult } from "@earendil-works/pi-coding-agent";
import { __testing, applyModelConfig, applyModelConfigAsync, createJeroAiExtension } from "../extensions/jero-ai.ts";
import { PROFILES_KIND, PROFILES_VERSION } from "../lib/agent-profiles.ts";
import { NATIVE_REVIEW_ERROR_CODE, type NativeReviewCli, NativeReviewCliError } from "../lib/authority/client-contract.ts";
import { CandidateViewError, type CandidateViewRegistry, CANONICAL_GZIP_OPTIONS } from "../lib/review-candidate-view.ts";
import { installPackageAssets } from "../lib/sdd-preflight.ts";
import { type ReviewCollectInputV3, type ReviewStatusV3 } from "../lib/authority/wire-contract.ts";
import { stripAnsi } from "../lib/terminal-theme.ts";
import { cardBody, cardHint, cardTitle, cardTone } from "./gentle-card-text.ts";
import {
	cleanWorkspaceStatus, lifecycleContext, lifecycleTheme, offeredCommittedRangeStatus,
	registeredGentleTools, renderComponent, reviewRepository, type ReviewStartRepository,
	startedReviewResult, writeMarkdown,
	routingConsumerFixture,
} from "./jero-ai-shared.ts";

test("agent discovery skips skills directories", async (t) => {
	const root = mkdtempSync(join(tmpdir(), "gentle-pi-agents-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const dotAgents = join(root, ".agents");
	writeMarkdown(join(dotAgents, "review-risk.md"), "name: review-risk\n");
	writeMarkdown(join(dotAgents, "team", "worker.md"), "name: worker\n");
	writeMarkdown(join(dotAgents, "skills", "ai-sdk", "SKILL.md"), "name: ai-sdk\n");
	writeMarkdown(
		join(dotAgents, "skills", "ai-sdk", "references", "evaluation.md"),
		"name: Prompt Evaluation\n",
	);

	const syncAgents = __testing.listAgentsFromDir(dotAgents, "user");
	const asyncAgents = await __testing.listAgentsFromDirAsync(dotAgents, "user");

	assert.deepEqual(
		syncAgents.map((agent) => agent.name),
		["review-risk", "worker"],
	);
	assert.deepEqual(
		asyncAgents.map((agent) => agent.name),
		["review-risk", "worker"],
	);
});

test("managed routing timeout leaves its profile, agent, and manifest unchanged", async (t) => {
	const root = mkdtempSync(join(tmpdir(), "gentle-pi-managed-routing-timeout-"));
	const agentHome = join(root, "agent-home");
	const previousAgentHome = process.env.JERO_PI_AGENT_HOME;
	t.after(() => {
		if (previousAgentHome === undefined) delete process.env.JERO_PI_AGENT_HOME;
		else process.env.JERO_PI_AGENT_HOME = previousAgentHome;
		rmSync(root, { recursive: true, force: true });
	});

	process.env.JERO_PI_AGENT_HOME = agentHome;
	await installPackageAssets(root, false, ["sdd"]);
	const agentPath = join(agentHome, "agents", "sdd-apply.md");
	const manifestPath = join(agentHome, "jero", "managed-assets.json");
	const profilePath = join(agentHome, "subagents.json");
	const profileBefore = "{\n  \"unrelated\": true\n}\n";
	writeFileSync(profilePath, profileBefore);
	const agentBefore = readFileSync(agentPath, "utf8");
	const manifestBefore = readFileSync(manifestPath, "utf8");
	writeFileSync(
		join(agentHome, "jero", "managed-assets.lock"),
		JSON.stringify({ schemaVersion: 1, token: "foreign", pid: process.pid, createdAtMs: Date.now() }),
	);

	await assert.rejects(
		applyModelConfig(root, { "sdd-apply": { model: "test/managed", thinking: "high" } }),
		/Timed out acquiring managed-assets lock file/i,
	);
	assert.equal(readFileSync(profilePath, "utf8"), profileBefore);
	assert.equal(readFileSync(agentPath, "utf8"), agentBefore);
	assert.equal(readFileSync(manifestPath, "utf8"), manifestBefore);
});

test("a later alias keeps managed-root precedence and manifest ownership", async (t) => {
	const root = mkdtempSync(join(tmpdir(), "gentle-pi-agent-root-alias-"));
	const agentHome = join(root, "agent-home");
	const home = join(root, "home");
	const cwd = join(root, "project");
	const managed = join(agentHome, "agents");
	const intervening = join(agentHome, "subagents");
	const alias = join(home, ".agents");
	const previousAgentHome = process.env.JERO_PI_AGENT_HOME;
	const previousHome = process.env.HOME;
	const previousUserProfile = process.env.USERPROFILE;
	t.after(() => {
		if (previousAgentHome === undefined) delete process.env.JERO_PI_AGENT_HOME;
		else process.env.JERO_PI_AGENT_HOME = previousAgentHome;
		if (previousHome === undefined) delete process.env.HOME;
		else process.env.HOME = previousHome;
		if (previousUserProfile === undefined) delete process.env.USERPROFILE;
		else process.env.USERPROFILE = previousUserProfile;
		rmSync(root, { recursive: true, force: true });
	});

	process.env.JERO_PI_AGENT_HOME = agentHome;
	process.env.HOME = home;
	process.env.USERPROFILE = home;
	await installPackageAssets(cwd, false, ["sdd"]);
	writeMarkdown(join(intervening, "sdd-apply.md"), "---\nname: sdd-apply\n---\nintervening override\n");
	mkdirSync(home, { recursive: true });
	try {
		symlinkSync(managed, alias, process.platform === "win32" ? "junction" : "dir");
	} catch (error) {
		t.skip(`directory aliases unavailable: ${error instanceof Error ? error.message : String(error)}`);
		return;
	}

	const selected = __testing.listDiscoverableAgents(cwd).find((agent) => agent.name === "sdd-apply");
	assert.equal(selected?.filePath, join(managed, "sdd-apply.md"));
	await applyModelConfig(cwd, { "sdd-apply": { model: "test/managed", thinking: "high" } });
	const manifest = JSON.parse(readFileSync(join(agentHome, "jero", "managed-assets.json"), "utf8")) as { assets: Record<string, string> };
	const routed = readFileSync(join(managed, "sdd-apply.md"), "utf8");
	assert.match(routed, /^model: test\/managed$/m);
	assert.equal(manifest.assets["agents/sdd-apply.md"], createHash("sha256").update(routed).digest("hex"));
});

test("runtime guidance keeps review policy out of the static orchestrator and injected skill", () => {
	const staticReferences = ["skills/jero-ai/SKILL.md"];
	const forbiddenGenericRoutes = [
		/fresh-context `reviewer`/,
		/fresh reviewer audits/,
		/reviewer fresh audits/,
		/run a fresh-context `reviewer`/,
	];

	for (const file of staticReferences) {
		const content = readFileSync(file, "utf8");
		assert.match(content, /Review Lens Selection|review lens/);
		assert.match(content, /review-risk/);
		assert.match(content, /review-reliability/);
		assert.match(content, /review-resilience/);
		assert.match(content, /review-readability/);
		for (const forbidden of forbiddenGenericRoutes) {
			assert.doesNotMatch(content, forbidden, `${file} must not route to generic reviewer`);
		}
	}

	const orchestrator = readFileSync("assets/orchestrator.md", "utf8")
		+ readFileSync("assets/orchestrator-delegation.md", "utf8");
	assert.match(orchestrator, /把镜像的提供方捆绑评审执行契约注入本会话系统提示/);
	assert.match(orchestrator, /本包不发明生命周期指令/);
	for (const lifecycleMarker of ["review-risk", "review-reliability", "review-resilience", "review-readability", "Authority-First Terminal Procedure", "reconcile-terminal-mirrors"]) {
		assert.doesNotMatch(orchestrator, new RegExp(lifecycleMarker), `static orchestrator must not mirror ${lifecycleMarker}`);
	}
});

test("ordinary native capture exposes a registered schema and STATUS binding copied unchanged to one slot", async (t) => {
	const tools = new Map<string, { name: string; parameters: { required?: readonly string[] } }>();
	const pi = {
		on() {},
		registerCommand() {},
		registerTool(tool: { name: string; parameters: { required?: readonly string[] } }) {
			tools.set(tool.name, tool);
		},
	} as unknown as ExtensionAPI;
	createJeroAiExtension({ nativeReviewCli: null })(pi);

	assert.ok(tools.has("jero_review_capture"));
	assert.deepEqual(tools.get("jero_review_capture")?.parameters.required, ["lineageId", "collectBinding"]);

	const sha = `sha256:${"a".repeat(64)}`;
	const lineageId = "ordinary-capture";
	const collectInput: ReviewCollectInputV3 = {
		name: "reviewer_result",
		schema: "https://gentle-ai.dev/schema/review/reviewer/v1",
		captureOperation: "review.capture-result",
		arguments: [
			{ name: "lineage", value: lineageId, token: `--lineage=${lineageId}` },
			{ name: "target", value: sha, token: `--target=${sha}` },
			{ name: "agent", value: "pi", token: "--agent=pi" },
			{ name: "materialize", value: "true", token: "--materialize=true" },
		],
		submission: {
			operationToken: "capture-result",
			argumentTokens: ["--lineage=ordinary-capture", `--target=${sha}`, "--agent=pi", "--materialize=true", "--input={{value}}"],
			values: [{ slot: "reviewer_result", domain: "artifact_path_or_stdin", substitutionLocation: 4 }],
		},
	};
	const currentStatus = {
		contract: "gentle-ai.review-integration/v2",
		applicability: "current_target",
		authority: { version: "compact-v2", lineageId, state: "reviewing", generation: 1, revision: sha },
		action: "stop",
		replayability: "not_replayable",
		targetIdentity: sha,
		projection: {
			schema: "gentle-ai.review-candidate-projection/v1",
			kind: "current-changes",
			projection: "workspace",
			baseTree: "b".repeat(40),
			initialReviewTree: "b".repeat(40),
			currentCandidateTree: "b".repeat(40),
			pathsDigest: sha,
			paths: ["app.ts"],
			intendedUntracked: [],
			intendedUntrackedProof: sha,
			initialSnapshotIdentity: sha,
			currentSnapshotIdentity: sha,
		},
		candidates: [],
		nextTransition: { kind: "collect", reasonCode: "capture_required", collect: { inputs: [collectInput] } },
		raw: { schema: "gentle-ai.review-integration.status/v5" },
	} as unknown as ReviewStatusV3;
	const native = { targetStatus: async () => currentStatus } as unknown as NativeReviewCli;

	const publicStatus = await __testing.executeReviewControllerOperation({ operation: "status" }, process.cwd(), native);
	const bindings = publicStatus.collectBindings as readonly { collectBinding: unknown }[];
	assert.equal(bindings.length, 1);
	assert.equal(typeof bindings[0]?.collectBinding, "string");

	let launches = 0;
	t.after(() => __testing.setReviewHostRelayRunnerForTesting());
	__testing.setReviewHostRelayRunnerForTesting(async () => {
		launches += 1;
		return { promptByteLength: 1, resultByteLength: 1, submission: "{}" };
	});
	const captured = await __testing.executeReviewCaptureOperation({
		lineageId,
		collectBinding: bindings[0]!.collectBinding,
		reviewerRunAcknowledged: true,
	}, process.cwd(), native);
	assert.equal(captured.status, "captured");
	assert.equal(launches, 1);
});

test("ordinary START adopts the committed-range selectors the provider just offered", async (t) => {
	const { cwd, baseCommit, baseTree, headTree: candidateTree } = reviewRepository(t);
	const starts: Array<Record<string, unknown>> = [];
	const native = {
		targetStatus: async () => offeredCommittedRangeStatus(baseCommit, baseTree, candidateTree),
		start: async (request: Record<string, unknown>) => { starts.push(request); return startedReviewResult(); },
	} as unknown as NativeReviewCli;
	const result = await __testing.executeReviewControllerOperation({ operation: "start", input: JSON.stringify({ mode: "ordinary" }) }, cwd, native);
	assert.equal(result.operation, "start");
	assert.equal(starts.length, 1);
	assert.equal(starts[0]?.baseRef, baseCommit);
	assert.equal(starts[0]?.committedOnly, true);
});

test("ordinary START keeps an explicit caller baseRef and ignores the offered selector", async (t) => {
	const { cwd, baseCommit, baseTree, headTree: candidateTree } = reviewRepository(t);
	const starts: Array<Record<string, unknown>> = [];
	const native = {
		// A shape-valid but never-invoked offer: the explicit caller value must win
		// before this is ever considered.
		targetStatus: async () => offeredCommittedRangeStatus("f".repeat(40), baseTree, candidateTree),
		start: async (request: Record<string, unknown>) => { starts.push(request); return startedReviewResult(); },
	} as unknown as NativeReviewCli;
	const result = await __testing.executeReviewControllerOperation({ operation: "start", input: JSON.stringify({ mode: "ordinary", baseRef: baseCommit, committedOnly: true }) }, cwd, native);
	assert.equal(result.operation, "start");
	assert.equal(starts.length, 1);
	assert.equal(starts[0]?.baseRef, baseCommit);
	assert.equal(starts[0]?.committedOnly, true);
});

test("ordinary START keeps today's invocation when STATUS offers no committed-range selector", async (t) => {
	const { cwd, headTree } = reviewRepository(t);
	const offeredWithoutBaseRef = cleanWorkspaceStatus(headTree, {
		kind: "execute",
		reasonCode: "fresh_target_ready",
		execute: { operation: "review.start", arguments: [{ name: "projection", value: "workspace", token: "--projection=workspace" }], preconditions: [], binding: { targetIdentity: `sha256:${"a".repeat(64)}` } },
	});
	for (const [label, target] of [["no execute transition", cleanWorkspaceStatus(headTree)], ["no base-ref", offeredWithoutBaseRef]] as const) {
		const starts: Array<Record<string, unknown>> = [];
		const native = {
			targetStatus: async () => target,
			start: async (request: Record<string, unknown>) => { starts.push(request); return startedReviewResult(); },
		} as unknown as NativeReviewCli;
		const result = await __testing.executeReviewControllerOperation({ operation: "start", input: JSON.stringify({ mode: "ordinary" }) }, cwd, native);
		assert.equal(result.operation, "start", label);
		assert.equal(starts.length, 1, label);
		assert.equal(starts[0]?.baseRef, undefined, label);
		assert.equal("committedOnly" in starts[0]!, false, label);
	}
});

test("ordinary START reports candidate-owner preparation failure as pre-native no mutation", async () => {
	let nativeStarts = 0;
	const target = {
		contract: "gentle-ai.review-integration/v2",
		applicability: "unrelated",
		action: "start",
		replayability: "not_replayable",
		targetIdentity: "a".repeat(64),
		projection: {
			schema: "gentle-ai.review-candidate-projection/v1",
			kind: "current-changes",
			projection: "workspace",
			baseTree: "b".repeat(40),
			initialReviewTree: "b".repeat(40),
			currentCandidateTree: "b".repeat(40),
			pathsDigest: "a".repeat(64),
			paths: [],
			intendedUntracked: [],
			intendedUntrackedProof: "a".repeat(64),
			initialSnapshotIdentity: "a".repeat(64),
			currentSnapshotIdentity: "a".repeat(64),
		},
		candidates: [],
		raw: { schema: "gentle-ai.review-integration.status/v5" },
	} as unknown as ReviewStatusV3;
	const native = {
		targetStatus: async () => target,
		start: async () => { nativeStarts += 1; throw new Error("native START must not run"); },
	} as unknown as NativeReviewCli;
	const candidateViews = {
		createOrReuse: () => { throw new CandidateViewError("candidate view owner preparation failed", "candidate-owner-preparation-failed"); },
	} as unknown as CandidateViewRegistry;
	const result = await __testing.executeReviewControllerOperation(
		{ operation: "start", input: JSON.stringify({ mode: "ordinary" }) },
		process.cwd(),
		native,
		undefined,
		candidateViews,
	);
	assert.equal(nativeStarts, 0);
	assert.equal(result.outcome, "native-operation-failed");
	assert.equal(result.mutation_outcome, "none");
	assert.deepEqual(result.diagnostics, {
		code: "candidate-owner-preparation-failed",
		message: "candidate view rejected before native START",
	});

	let materializationStatusCalls = 0;
	const rawMaterializationFailure = await __testing.executeReviewControllerOperation(
		{ operation: "start", input: JSON.stringify({ mode: "ordinary" }) },
		process.cwd(),
		{
			targetStatus: async () => { materializationStatusCalls += 1; return target; },
			start: async () => { nativeStarts += 1; throw new Error("native START must not run"); },
		} as unknown as NativeReviewCli,
		undefined,
		{ createOrReuse: () => { throw new Error("candidate materialization failed"); } } as unknown as CandidateViewRegistry,
	);
	assert.equal(nativeStarts, 0);
	assert.equal(materializationStatusCalls, 1, "a pre-START materialization failure never triggers reconciliation STATUS");
	assert.equal(rawMaterializationFailure.outcome, "native-operation-failed");
	assert.equal(rawMaterializationFailure.mutation_outcome, "none");
	assert.equal(rawMaterializationFailure.next_action, "resolve-native-operation-failure");

	let statusCalls = 0;
	const afterNative = await __testing.executeReviewControllerOperation(
		{ operation: "start", input: JSON.stringify({ mode: "ordinary" }) },
		process.cwd(),
		{
			targetStatus: async () => { statusCalls += 1; return target; },
			start: async () => {
				nativeStarts += 1;
				throw new CandidateViewError("post-native candidate verification failed", "candidate-view-timeout", {
					phase: "candidate-view",
					category: "timeout",
					git_subcommand: "worktree",
					timeout_ms: 10_000,
					max_buffer_bytes: 64 * 1024 * 1024,
					message: "candidate-view Git command worktree timed out after 10000ms; inspect the candidate state before any new START",
				});
			},
		} as unknown as NativeReviewCli,
		undefined,
		null,
	);
	assert.equal(nativeStarts, 1);
	assert.equal(statusCalls, 2, "a post-native diagnostic must reconcile STATUS");
	assert.equal(afterNative.mutation_outcome, "unknown");
	assert.deepEqual(afterNative.diagnostics, {
		code: "candidate-view-timeout",
		message: "post-native candidate verification failed",
	});
});
