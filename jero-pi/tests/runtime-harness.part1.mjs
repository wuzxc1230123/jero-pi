// runtime-harness 场景第 1/3 段：自 run() 机械平移（语义零改动）。
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { discoverAndLoadExtensions } from "@earendil-works/pi-coding-agent";
import { matchesKey } from "@earendil-works/pi-tui";
import { fileURLToPath, pathToFileURL } from "node:url";
import { stripAnsi } from "../lib/terminal-theme.ts";
import { domainHashV1 } from "../lib/review-canonical.ts";
import { canonicalHash } from "../lib/review-transaction.ts";
import { LEAN_MODE_ENTRY_TYPE } from "../lib/jero-ai-lean.ts";

import {
	EXPECTED_BANNER_COMMANDS,
	EXPECTED_COMMANDS,
	EXTENSIONS,
	FORBIDDEN_COMPAT_COMMANDS,
	ROOT,
	createCtx,
	createJeroAiExtension,
	createPi,
	createUi,
	gitSync,
	loadExtensions,
	readAgentDefinition,
	restoreWorkspaceWritePermissions,
	sha256,
	tempWorkspace,
} from "./runtime-harness-support.mjs";

export async function part1(env) {
	const { globalConfigHome, globalAgentHome, ambientTestAssetsDir, globalModelsPath, globalSubagentsPath, pi, hooks, commands, flags, tools, emittedEvents, sessionEntries } = env;

	// gentle-pi#404: a collect binding that returns the native last-event
	// closure must terminate after one capture. It must not re-enter a public
	// lifecycle mutation or synthesize a follow-up transition.
	{
		const lineageId = "runtime-last-event";
		const sha = `sha256:${"a".repeat(64)}`;
		const tree = "b".repeat(40);
		const repositoryContext = `rctx1_${"c".repeat(64)}`;
		const calls = [];
		const arguments_ = [
			{ name: "lineage", value: lineageId, token: `--lineage=${lineageId}` },
			{ name: "expected-revision", value: sha, token: `--expected-revision=${sha}` },
			{ name: "target", value: sha, token: `--target=${sha}` },
			{ name: "repository-context", value: repositoryContext, token: `--repository-context=${repositoryContext}` },
			{ name: "lens", value: "review-risk", token: "--lens=review-risk" },
			{ name: "order", value: "0", token: "--order=0" },
			{ name: "subject-hash", value: sha, token: `--subject-hash=${sha}` },
		];
		const input = {
			name: "correction_plan",
			schema: "gentle-ai.review-correction-plan/v1",
			captureOperation: "review.capture-correction-plan",
			arguments: arguments_,
			submission: {
				operationToken: "capture-correction-plan",
				argumentTokens: [...arguments_.map((argument) => argument.token), "--correction-lines={{value}}"],
				values: [{ slot: "correction_lines", domain: "positive_integer", substitutionLocation: 7, minimum: 1, maximum: 1 }],
			},
		};
		const status = {
			contract: "gentle-ai.review-integration/v2",
			applicability: "current_target",
			authority: { version: "compact-v2", lineageId, state: "correction_required", generation: 1, revision: sha },
			receipt: { status: "expected_missing" },
			action: "stop",
			replayability: "not_replayable",
			targetIdentity: sha,
			projection: {
				schema: "gentle-ai.review-candidate-projection/v1",
				kind: "current-changes",
				projection: "workspace",
				baseTree: tree,
				initialReviewTree: tree,
				currentCandidateTree: tree,
				pathsDigest: sha,
				paths: ["app.ts"],
				intendedUntracked: [],
				intendedUntrackedProof: sha,
				initialSnapshotIdentity: sha,
				currentSnapshotIdentity: sha,
			},
			repair: { schema: "gentle-ai.review-authority-repair-assessment/v1", status: "unsupported", counts: { lineages: 0, compactLineages: 0, legacyLineages: 0, events: 0, bytes: 0, eligibleCandidates: 0, unsupportedLineages: 0, conflicts: 0 }, supportedOperations: ["review/complete-fix", "review/validate-fix"], authorizationSchema: "gentle-ai.review-repair-authorization/v1" },
			candidates: [],
			nextTransition: { kind: "collect", reasonCode: "correction_plan_required", collect: { inputs: [input] } },
			raw: { schema: "gentle-ai.review-integration.status/v5" },
		};
		const nativeReviewCli = {
			async targetStatus(request) {
				calls.push({ operation: "status", request });
				return status;
			},
			async captureCorrectionPlan(request) {
				calls.push({ operation: "capture-correction-plan", request });
				return {
					schema: "gentle-ai.review-last-event-closure/v1",
					operation: "review.capture-correction-plan",
					lineageId,
					state: "correction_required",
					targetIdentity: sha,
					requestHash: sha,
					correctionLines: 1,
					storeRevision: sha,
				};
			},
		};
		const lastEventPi = createPi();
		createJeroAiExtension({ nativeReviewCli })(lastEventPi.pi);
		const controller = lastEventPi.tools.get("jero_review");
		const capture = lastEventPi.tools.get("jero_review_capture");
		assert.ok(controller, "runtime must register the public status controller");
		assert.ok(capture, "runtime must register the one-slot capture tool");
		assert.equal(lastEventPi.tools.get("jero_review_capture_group")?.executionMode, "sequential", "runtime must register grouped capture with bounded foreground concurrency");
		assert.equal(controller.parameters.properties.operation.enum.includes("finalize"), false);
		assert.equal(controller.parameters.properties.operation.enum.includes("validate"), false);

		const publicStatus = await controller.execute(
			"runtime-status",
			{ operation: "status", lineageId },
			undefined,
			undefined,
			createCtx(ROOT, false, lineageId),
		);
		const collectBindings = publicStatus.details.collectBindings;
		assert.equal(publicStatus.details.status, "blocked");
		assert.equal(collectBindings.length, 1);

		const captured = await capture.execute(
			"runtime-capture",
			{ lineageId, collectBinding: collectBindings[0].collectBinding, correctionLines: 1 },
			undefined,
			undefined,
			createCtx(ROOT, false, lineageId),
		);
		assert.equal(captured.details.status, "closed");
		assert.equal(captured.details.outcome, "native-last-event-closure");
		assert.equal(captured.details.closure.operation, "review.capture-correction-plan");
		assert.deepEqual(
			calls.map(({ operation }) => operation),
			["status", "status", "capture-correction-plan"],
			"last-event closure must make no follow-up lifecycle mutation",
		);
	}

	for (const name of EXPECTED_COMMANDS) {
		assert.ok(commands.has(name), `missing command ${name}`);
	}
	for (const name of FORBIDDEN_COMPAT_COMMANDS) {
		assert.equal(commands.has(name), false, `compat command should not be registered: ${name}`);
	}
	assert.ok(flags.has("no-skill-registry"), "missing no-skill-registry flag");
	assert.ok(hooks.has("session_start"), "missing session_start hook");
	assert.ok(hooks.has("session_shutdown"), "missing session_shutdown hook");
	assert.ok(hooks.has("input"), "missing input hook");
	assert.ok(hooks.has("before_agent_start"), "missing before_agent_start hook");
	assert.ok(hooks.has("tool_call"), "missing tool_call hook");
	// Design §5.3 tool-registration conflict discipline: the pretty plugin
	// owns bash/read/write/edit (and friends) rendering; jero-pi itself must
	// not re-register any built-in tool name.
	for (const toolName of ["read", "bash", "grep", "find", "ls", "edit", "write"]) {
		assert.equal(tools.has(toolName), false, `jero-pi must not re-register the plugin-owned built-in tool ${toolName}`);
	}
	assert.ok(tools.has("jero_review"), "missing registered bounded review controller tool");
	assert.ok(tools.has("jero_review_scope"), "missing registered bounded review scope tool");
	assert.deepEqual(
		tools.get("jero_review").parameters.properties.operation.enum.filter((operation) => operation.includes("supersession") || operation === "supersede" || operation === "reconcile-authority"),
		["reconcile-authority"],
		"runtime controller must expose only native authority reconciliation",
	);

	for (const entry of await readdir(join(ROOT, "assets", "agents"))) {
		if (!entry.endsWith(".md")) continue;
		const agentPrompt = await readFile(join(ROOT, "assets", "agents", entry), "utf8");
		assert.doesNotMatch(
			agentPrompt,
			/inheritProjectContext:\s*true/,
			`${entry} must not inherit parent project context by default`,
		);
	}

	const discovered = await discoverAndLoadExtensions(["./extensions"], ROOT);
	assert.deepEqual(
		discovered.errors,
		[],
		"declared extension directory must load without invalid helper modules",
	);

	// orchestrator-lazy-diet: Pi Subagent Model Routing detail (the "do not
	// pass the `model` parameter by default" / SDD-model-assignment-scoping
	// rules) moved verbatim to assets/orchestrator-delegation.md; the
	// always-on combined prompt now only carries a pointer to it. Union read
	// so these assertions are repointed, not weakened.
	const delegationDetail = await readFile(join(ROOT, "assets", "orchestrator-delegation.md"), "utf8");

	const promptCwd = await tempWorkspace();
	try {
		// The native SDD status engine resolves through the in-process
		// authority, whose store lives under the git common dir: without a
		// repository (with a root commit) every status call fails closed.
		gitSync(promptCwd, "init", "-b", "main");
		await writeFile(join(promptCwd, "tracked.txt"), "base\n");
		gitSync(promptCwd, "add", "tracked.txt");
		gitSync(promptCwd, "commit", "-m", "harness workspace root");
		const promptHook = hooks.get("before_agent_start")[0];
		const promptResult = await promptHook({ systemPrompt: "base" }, createCtx(promptCwd));
		assert.match(promptResult.systemPrompt, /base/);
		assert.match(promptResult.systemPrompt, /el Jero/);
		assert.match(promptResult.systemPrompt + delegationDetail, /默认不传 `model` 参数/);
		assert.match(
			promptResult.systemPrompt + delegationDetail,
			/SDD 模型分配表仅适用于 SDD\/Judgment-Day 阶段代理/,
		);
		assert.doesNotMatch(promptResult.systemPrompt, /Every Agent tool call MUST include `model`/);
		assert.doesNotMatch(promptResult.systemPrompt, /default\s*\|\s*sonnet\s*\|\s*Non-SDD general delegation/);
		assert.match(promptResult.systemPrompt, /openspec\/config\.yaml[\s\S]*都不是会话预检/);
		assert.match(promptResult.systemPrompt, /不要标记 SDD 预检完成/);
		assert.ok(
			promptResult.systemPrompt.includes(
				`包资产根目录：\`${join(ROOT, "assets")}\`。下方懒加载资产路径均相对该根目录。`,
			),
			"parent prompt must declare the one absolute root for relative lazy asset paths",
		);
		assert.match(promptResult.systemPrompt, /`sdd-orchestrator-workflow\.md`/);
		assert.doesNotMatch(
			promptResult.systemPrompt,
			new RegExp(ambientTestAssetsDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
			"normal runtime must ignore ambient JERO_PI_TEST_ASSETS_DIR",
		);
		assert.doesNotMatch(promptResult.systemPrompt, /\{\{JERO_PI_SDD_WORKFLOW_PATH\}\}/);
		delete process.env.JERO_PI_TEST_ASSETS_DIR;
		await rm(ambientTestAssetsDir, { recursive: true, force: true });
		await writeFile(
			join(globalConfigHome, "persona.json"),
			'{"mode":"neutral"}\n',
		);
		const neutralPromptResult = await promptHook({ systemPrompt: "base" }, createCtx(promptCwd));
		assert.match(neutralPromptResult.systemPrompt, /不使用俚语或地域性表达/);
		assert.doesNotMatch(
			neutralPromptResult.systemPrompt,
			/用户使用中文时，用自然、地道的简体中文/,
			"neutral persona prompt must not include the gentleman-only natural-Chinese clause after reload",
		);
		const subagentPromptResult = await promptHook(
			{ agentName: "worker", systemPrompt: "worker base" },
			createCtx(promptCwd),
		);
		assert.equal(subagentPromptResult.systemPrompt, "worker base");
		assert.equal(
			existsSync(join(promptCwd, ".pi", "agents", "sdd-apply.md")),
			false,
			"normal agent startup must not run SDD preflight",
		);
		await mkdir(join(promptCwd, ".pi", "jero"), { recursive: true });
		await writeFile(
			join(promptCwd, ".pi", "jero", "persona.json"),
			'{"mode":"gentleman"}\n',
		);
		const localOverridePromptResult = await promptHook({ systemPrompt: "base" }, createCtx(promptCwd));
		assert.match(
			localOverridePromptResult.systemPrompt,
			/用户使用中文时，用自然、地道的简体中文/,
		);
		const personaCtx = createCtx(promptCwd, true);
		personaCtx.ui.select = async () => "neutral";
		await commands.get("jero:persona").handler("", personaCtx);
		assert.equal(
			await readFile(join(globalConfigHome, "persona.json"), "utf8"),
			'{\n  "mode": "neutral"\n}\n',
		);
		assert.equal(
			await readFile(join(promptCwd, ".pi", "jero", "persona.json"), "utf8"),
			'{\n  "mode": "neutral"\n}\n',
		);
		assert.match(personaCtx.ui.notifications.at(-1).message, /全局配置：/);
		// lean discipline：提示词层增强。默认 full 只注入主会话；
		// jero.lean-mode/v1 会话条目（/jero:lean 写入、"stop lean" 关闭）
		// 在每次代理启动时重新解析，无需 /reload；off 不注入任何精益文本。
		const leanCtx = () => {
			const context = createCtx(promptCwd, true);
			context.sessionManager.getBranch = () => sessionEntries;
			return context;
		};
		const leanProbe = "停在第一个成立的横档上";
		const leanDefaultResult = await promptHook({ systemPrompt: "base" }, leanCtx());
		assert.match(leanDefaultResult.systemPrompt, new RegExp(leanProbe), "default lean mode must inject the ladder into the main session");

		const leanCommand = commands.get("jero:lean");
		assert.ok(leanCommand, "missing jero:lean command");
		const leanSetCtx = leanCtx();
		await leanCommand.handler("ultra", leanSetCtx);
		assert.deepEqual(
			sessionEntries.at(-1),
			{ type: "custom", customType: LEAN_MODE_ENTRY_TYPE, data: { mode: "ultra" } },
			"/jero:lean <mode> must persist exactly one session entry",
		);
		assert.match(leanSetCtx.ui.notifications.at(-1).message, /ultra/);
		const leanUltraResult = await promptHook({ systemPrompt: "base" }, leanCtx());
		assert.match(leanUltraResult.systemPrompt, /YAGNI 极端主义/, "session entry must flip the injected level on the next agent start without /reload");

		const leanStatusCtx = leanCtx();
		await leanCommand.handler("status", leanStatusCtx);
		assert.match(leanStatusCtx.ui.notifications.at(-1).message, /Lean discipline: ultra/);

		const leanInputCtx = leanCtx();
		assert.deepEqual(
			await hooks.get("input")[0]({ text: "STOP LEAN!", source: "interactive" }, leanInputCtx),
			{ action: "handled" },
			"the standalone stop-lean phrase must be handled, not forwarded",
		);
		assert.equal(sessionEntries.at(-1).data.mode, "off", "stop lean must persist an off entry");
		const leanOffResult = await promptHook({ systemPrompt: "base" }, leanCtx());
		assert.doesNotMatch(leanOffResult.systemPrompt, new RegExp(leanProbe), "off must restore the historical prompt");
		// 具名代理在任何档位下都不接收精益注入：它们经既有的任务上下文
		// 传输获得纪律，本注入绝不改写委派通道。
		const leanNamedResult = await promptHook({ agentName: "worker", systemPrompt: "worker base" }, leanCtx());
		assert.doesNotMatch(leanNamedResult.systemPrompt, new RegExp(leanProbe));
		const onboardCtx = createCtx(promptCwd, true, "sdd-onboard-session");
		onboardCtx.ui.select = async (_label, options) => options[0];
		const onboardPromptResult = await promptHook(
			{ agentName: "sdd-onboard", systemPrompt: "onboard base" },
			onboardCtx,
		);
		assert.match(onboardPromptResult.systemPrompt, /onboard base/);
		assert.match(onboardPromptResult.systemPrompt, /## SDD Session Preflight/);
		assert.equal(existsSync(join(globalAgentHome, "agents", "sdd-onboard.md")), true);
		await mkdir(join(promptCwd, "openspec", "changes", "status-demo", "specs", "demo"), { recursive: true });
		await writeFile(join(promptCwd, "openspec", "changes", "status-demo", "proposal.md"), "# Proposal\n");
		await writeFile(join(promptCwd, "openspec", "changes", "status-demo", "specs", "demo", "spec.md"), "# Spec\n");
		await writeFile(join(promptCwd, "openspec", "changes", "status-demo", "design.md"), "# Design\n");
		await writeFile(join(promptCwd, "openspec", "changes", "status-demo", "tasks.md"), "# Tasks\n\n- [ ] 1.1 Implement demo\n");
		const applyPromptResult = await promptHook(
			{ agentName: "sdd-apply", systemPrompt: "apply base" },
			createCtx(promptCwd, true, "sdd-apply-session"),
		);
		assert.match(applyPromptResult.systemPrompt, /## Native SDD Status Engine/);
		assert.match(applyPromptResult.systemPrompt, /"changeName": "status-demo"/);
		assert.match(applyPromptResult.systemPrompt, /### apply instructions/);
		const statusCtx = createCtx(promptCwd, true);
		await commands.get("jero-sdd-status").handler("status-demo --json", statusCtx);
		assert.match(statusCtx.ui.notifications.at(-1).message, /"schemaName": "gentle-ai\.sdd-status"/);
		const continueCtx = createCtx(promptCwd, true);
		let markerConfirmations = 0;
		continueCtx.ui.confirm = async (_title, message) => {
			assert.ok(message.includes(join(promptCwd, "openspec/changes/status-demo/.jero-instance")));
			assert.match(message, /no source roots and no persistent authority/);
			markerConfirmations += 1;
			return true;
		};
		await commands.get("jero-sdd-continue").handler("status-demo", continueCtx);
		assert.equal(markerConfirmations, 1);
		assert.match(continueCtx.ui.notifications.at(-1).message, /Native SDD Status Engine/);
		assert.match(continueCtx.ui.notifications.at(-1).message, /"nextRecommended": "apply"/);
		const { execFileSync } = await import("node:child_process");
		execFileSync("git", ["init"], { cwd: promptCwd, stdio: "ignore" });
		const recoveryRequiredDirectory = join(promptCwd, ".git", "gentle-ai", "reviews", "control", "recovery-required-v1");
		await mkdir(recoveryRequiredDirectory, { recursive: true });
		await writeFile(
			join(recoveryRequiredDirectory, `${domainHashV1("openspec-change-name", "status-demo")}.json`),
			'{"schema":"gentle-ai.recovery-required/v1","change_name":"status-demo"}',
		);
		const blockedContinueCtx = createCtx(promptCwd, true);
		// Design §5.1.6: an upstream `.git` authority store is foreign data —
		// the authority refuses to resolve it fail-closed instead of offering
		// recovery routes or a graceful status.
		await assert.rejects(
			() => commands.get("jero-sdd-continue").handler("status-demo", blockedContinueCtx),
			/foreign-authority-store/,
		);
	} finally {
		await rm(promptCwd, { recursive: true, force: true });
	}

	const toolCwd = await tempWorkspace();
	try {
		const toolHook = hooks.get("tool_call")[0];
		const ghPrCwd = await tempWorkspace();
		try {
			execFileSync("git", ["init"], { cwd: ghPrCwd, stdio: "ignore" });
			const deliveryResult = await toolHook(
				{ toolName: "bash", input: { command: "gh pr create --draft" } },
				createCtx(ghPrCwd, true, "ordinary-delivery-session"),
			);
			assert.equal(deliveryResult, undefined, "ordinary delivery policy, not review authority, governs pull-request creation");
		} finally {
			await rm(ghPrCwd, { recursive: true, force: true });
		}
		assert.equal(await toolHook({ toolName: "bash", input: { command: "git status" } }, createCtx(toolCwd)), undefined);
		const denied = await toolHook({ toolName: "bash", input: { command: "rm -rf /" } }, createCtx(toolCwd));
		assert.equal(denied.block, true);
		assert.match(denied.reason, /destructive/);
		const reviewDispatch = { agent: "review-risk", task: "review", mode: "task" };
		const missingReviewView = await toolHook({ toolName: "subagent_run", input: reviewDispatch }, createCtx(toolCwd));
		assert.equal(missingReviewView.block, true);
		assert.match(missingReviewView.reason, /candidate view/i);
		assert.equal(reviewDispatch.task, "review", "blocked review dispatch must not mutate child input");

		for (const [agent, label, task] of [
			["jero-worker", "missing", "Implement the requested change."],
			["jero-worker", "absolute", "## Allowed edit surfaces\n/tmp/outside.ts"],
			["jero-worker", "Windows absolute", "## Allowed edit surfaces\nC:\\outside.ts"],
			["jero-worker", "prose instead of paths", "## Allowed edit surfaces\nThe parent will determine the paths."],
			["jero-worker", "repository root", "## Allowed edit surfaces\n."],
			["jero-worker", "bare repository root", "## Allowed edit surfaces\n./"],
			["jero-worker", "normalized bare repository root", "## Allowed edit surfaces\n.//"],
			["jero-worker", "equivalent normalized bare repository root", "## Allowed edit surfaces\n././/"],
			["worker", "generic writer missing", "Implement the requested change."],
		]) {
			const writerDispatch = { agent, task, mode: "task" };
			const writerResult = await toolHook(
				{ toolName: "subagent_run", input: writerDispatch },
				createCtx(toolCwd),
			);
			assert.equal(writerResult?.block, true, `${label} writer scope must be blocked before dispatch`);
			assert.match(writerResult?.reason ?? "", /推导或映射/);
			assert.match(writerResult?.reason ?? "", /重新启动/);
			assert.match(writerResult?.reason ?? "", /不要让人类来编写路径或 glob/);
			assert.equal(writerDispatch.task, task, "writer guard must not mutate child input");
		}

		const scopedWriterDispatch = {
			agent: "jero-worker",
			task: "Implement the requested change.\n\n## Allowed edit surfaces\nextensions/jero-ai.ts\ntests/runtime-harness.mjs",
			mode: "task",
		};
		assert.equal(
			await toolHook({ toolName: "subagent_run", input: scopedWriterDispatch }, createCtx(toolCwd)),
			undefined,
			"a writer may dispatch with narrow task-scoped repository-relative paths",
		);
		assert.equal(
			await toolHook(
				{
					toolName: "subagent_run",
					input: {
						agent: "worker",
						task: "Implement the requested change.",
						context: "## Allowed edit surfaces\n- assets/orchestrator.md",
						mode: "task",
					},
				},
				createCtx(toolCwd),
			),
			undefined,
			"a writer may dispatch when context carries narrow task-scoped repository-relative paths",
		);

		const interactiveSddDispatch = {
			agent: "sdd-remediate",
			task: "Correct the bound failed verification evidence.",
			context: "Retain the parent-supplied remediation scope.",
			mode: "task",
		};
		assert.equal(
			await toolHook({ toolName: "subagent_run", input: interactiveSddDispatch }, createCtx(toolCwd, true, "interactive-sdd-parent")),
			undefined,
			"an interactive parent may dispatch an SDD child only after preflight resolves",
		);
		assert.match(
			interactiveSddDispatch.context,
			/^## SDD Session Preflight\nThese SDD preferences are explicit current-session choices\./,
			"the parent-confirmed rendered preflight must be transported through the RPC child's context",
		);
		const rpcChildCwd = await tempWorkspace();
		try {
			const rpcChild = createPi();
			createJeroAiExtension({ processEnv: { JERO_PI_AGENTS_CHILD: "1" } })(rpcChild.pi);
			const rpcChildCtx = createCtx(rpcChildCwd, false, "delegated-rpc-sdd-child");
			rpcChildCtx.mode = "rpc";
			const rpcChildPrompt = await rpcChild.hooks.get("before_agent_start")[0](
				{ agentName: "sdd-remediate", systemPrompt: "You are the SDD remediate executor for Gentle AI." },
				rpcChildCtx,
			);
			assert.doesNotMatch(rpcChildPrompt.systemPrompt, /## SDD Session Preflight/);
			assert.equal(
				existsSync(join(rpcChildCwd, ".pi", "jero", "sdd-preflight.json")),
				false,
				"a delegated RPC child must not silently originate or persist defaults",
			);
		} finally {
			await rm(rpcChildCwd, { recursive: true, force: true });
		}

		const canonicalFrozenFindingRow = '{"id":"JD-A-001","lens":"judgment-day","location":"extensions/jero-ai.ts:1","severity":"CRITICAL","status_at_freeze":"open","evidence_class":"deterministic","evidence_claim":"The frozen finding has concrete user impact."}';
		const canonicalFrozenFindingRows = [JSON.parse(canonicalFrozenFindingRow)];
		const canonicalFrozenLedgerHash = canonicalHash(canonicalFrozenFindingRows);
		const canonicalJdFixTask = [
			"Apply the controller-authorized fix.",
			"",
			"## Judgment Day activation",
			"User explicitly requested Judgment Day.",
			"",
			"## Exact authorized severe IDs",
			"- `JD-A-001`",
			"",
			"## Judgment Day correction batch",
			"Round: 1 of 2.",
			`Frozen ledger SHA-256: \`${canonicalFrozenLedgerHash}\``,
			"",
			"## Exact frozen finding rows",
			canonicalFrozenFindingRow,
			"",
			"## Allowed edit surfaces",
			"extensions/jero-ai.ts",
			"tests/runtime-harness.mjs",
		].join("\n");
		const orderedFrozenFindingRows = [
			...canonicalFrozenFindingRows,
			{ ...canonicalFrozenFindingRows[0], id: "JD-B-002", location: "tests/runtime-harness.mjs:1" },
		];
		const reversedFrozenFindingRows = [...orderedFrozenFindingRows].reverse();
		const rowOrderMismatchJdFixTask = canonicalJdFixTask
			.replace("- `JD-A-001`", "- `JD-A-001`\n- `JD-B-002`")
			.replace(canonicalFrozenLedgerHash, canonicalHash(reversedFrozenFindingRows))
			.replace(canonicalFrozenFindingRow, reversedFrozenFindingRows.map((row) => JSON.stringify(row)).join("\n"));
		const incorrectFrozenLedgerHash = `${canonicalFrozenLedgerHash.slice(0, -1)}${canonicalFrozenLedgerHash.endsWith("0") ? "1" : "0"}`;
		for (const [label, input] of [
			["missing activation", { agent: "jd-fix-agent", task: "## Allowed edit surfaces\nextensions/jero-ai.ts", mode: "task" }],
			["duplicate activation", { agent: "jd-fix-agent", task: `${canonicalJdFixTask}\n\n## Judgment Day activation\nUser explicitly requested Judgment Day.`, mode: "task" }],
			["missing severe IDs", { agent: "jd-fix-agent", task: canonicalJdFixTask.replace("## Exact authorized severe IDs\n- `JD-A-001`\n", ""), mode: "task" }],
			["duplicate severe ID bindings", { agent: "jd-fix-agent", task: canonicalJdFixTask.replace("- `JD-A-001`", "- `JD-A-001`\n- `JD-A-001`"), mode: "task" }],
			["duplicate severe ID sections", { agent: "jd-fix-agent", task: canonicalJdFixTask, context: "## Exact authorized severe IDs\n- `JD-B-002`", mode: "task" }],
			["malformed activation", { agent: "jd-fix-agent", task: canonicalJdFixTask.replace("User explicitly requested Judgment Day.", "Judgment Day is explicitly activated for this dispatch."), mode: "task" }],
			["extra activation line", { agent: "jd-fix-agent", task: canonicalJdFixTask.replace("User explicitly requested Judgment Day.", "User explicitly requested Judgment Day.\nUnexpected activation detail."), mode: "task" }],
			["malformed severe ID", { agent: "jd-fix-agent", task: canonicalJdFixTask.replace("- `JD-A-001`", "JD-A-001"), mode: "task" }],
			["empty severe IDs", { agent: "jd-fix-agent", task: canonicalJdFixTask.replace("- `JD-A-001`", ""), mode: "task" }],
			["missing correction batch", { agent: "jd-fix-agent", task: canonicalJdFixTask.replace(`## Judgment Day correction batch\nRound: 1 of 2.\nFrozen ledger SHA-256: \`${canonicalFrozenLedgerHash}\`\n`, ""), mode: "task" }],
			["duplicate correction batch", { agent: "jd-fix-agent", task: `${canonicalJdFixTask}\n## Judgment Day correction batch\nRound: 2 of 2.\nFrozen ledger SHA-256: \`bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\``, mode: "task" }],
			["out-of-order correction batch", { agent: "jd-fix-agent", task: canonicalJdFixTask.replace(`## Judgment Day correction batch\nRound: 1 of 2.\nFrozen ledger SHA-256: \`${canonicalFrozenLedgerHash}\`\n\n## Exact frozen finding rows\n${canonicalFrozenFindingRow}`, `## Exact frozen finding rows\n${canonicalFrozenFindingRow}\n\n## Judgment Day correction batch\nRound: 1 of 2.\nFrozen ledger SHA-256: \`${canonicalFrozenLedgerHash}\``), mode: "task" }],
			["invalid correction round", { agent: "jd-fix-agent", task: canonicalJdFixTask.replace("Round: 1 of 2.", "Round: 3 of 2."), mode: "task" }],
			["uppercase frozen ledger hash", { agent: "jd-fix-agent", task: canonicalJdFixTask.replace(canonicalFrozenLedgerHash, canonicalFrozenLedgerHash.toUpperCase()), mode: "task" }],
			["incorrect frozen ledger hash", { agent: "jd-fix-agent", task: canonicalJdFixTask.replace(canonicalFrozenLedgerHash, incorrectFrozenLedgerHash), mode: "task" }],
			["extra correction batch line", { agent: "jd-fix-agent", task: canonicalJdFixTask.replace("Round: 1 of 2.", "Round: 1 of 2.\nUnexpected line"), mode: "task" }],
			["missing frozen rows", { agent: "jd-fix-agent", task: canonicalJdFixTask.replace(`## Exact frozen finding rows\n${canonicalFrozenFindingRow}\n`, ""), mode: "task" }],
			["malformed frozen row", { agent: "jd-fix-agent", task: canonicalJdFixTask.replace(canonicalFrozenFindingRow, "{"), mode: "task" }],
			["duplicate frozen row", { agent: "jd-fix-agent", task: canonicalJdFixTask.replace(canonicalFrozenFindingRow, `${canonicalFrozenFindingRow}\n${canonicalFrozenFindingRow}`), mode: "task" }],
			["mismatched frozen row ID", { agent: "jd-fix-agent", task: canonicalJdFixTask.replace(canonicalFrozenFindingRow, canonicalFrozenFindingRow.replace("JD-A-001", "JD-B-002")), mode: "task" }],
			["frozen row order mismatch", { agent: "jd-fix-agent", task: rowOrderMismatchJdFixTask, mode: "task" }],
			["extra frozen row field", { agent: "jd-fix-agent", task: canonicalJdFixTask.replace(canonicalFrozenFindingRow, canonicalFrozenFindingRow.replace("}", ",\"extra\":true}")), mode: "task" }],
			["non-Judgment-Day frozen row", { agent: "jd-fix-agent", task: canonicalJdFixTask.replace("\"lens\":\"judgment-day\"", "\"lens\":\"review-risk\""), mode: "task" }],
			["non-open frozen row", { agent: "jd-fix-agent", task: canonicalJdFixTask.replace("\"status_at_freeze\":\"open\"", "\"status_at_freeze\":\"closed\""), mode: "task" }],
			["non-severe frozen row", { agent: "jd-fix-agent", task: canonicalJdFixTask.replace("\"severity\":\"CRITICAL\"", "\"severity\":\"WARNING\""), mode: "task" }],
			["empty frozen evidence", { agent: "jd-fix-agent", task: canonicalJdFixTask.replace("\"evidence_claim\":\"The frozen finding has concrete user impact.\"", "\"evidence_claim\":\"\""), mode: "task" }],
			["missing edit surface", { agent: "jd-fix-agent", task: canonicalJdFixTask.replace("## Allowed edit surfaces\nextensions/jero-ai.ts\ntests/runtime-harness.mjs", ""), mode: "task" }],
			["invalid edit surface", { agent: "jd-fix-agent", task: canonicalJdFixTask.replace("## Allowed edit surfaces\nextensions/jero-ai.ts", "## Allowed edit surfaces\n."), mode: "task" }],
			["mixed", { agent: ["jd-fix-agent", "jero-worker"], task: canonicalJdFixTask, mode: "task" }],
			["agent array", { agent: ["jd-fix-agent"], task: canonicalJdFixTask, mode: "task" }],
			["agents array", { agents: ["jd-fix-agent"], task: canonicalJdFixTask, mode: "task" }],
			["duplicate agent binding", { agent: "jd-fix-agent", agents: "jd-fix-agent", task: canonicalJdFixTask, mode: "task" }],
		]) {
			const original = structuredClone(input);
			const result = await toolHook({ toolName: "subagent_run", input }, createCtx(toolCwd));
			assert.equal(result?.block, true, `${label} jd-fix-agent dispatch must be blocked`);
			assert.match(result?.reason ?? "", /Judgment Day 修复派发要求/);
			assert.deepEqual(input, original, `${label} jd-fix-agent rejection must not mutate input`);
		}
		assert.equal(
			await toolHook(
				{ toolName: "subagent_run", input: { agent: "jd-fix-agent", task: canonicalJdFixTask, mode: "task" } },
				createCtx(toolCwd),
			),
			undefined,
			"a canonical explicit Judgment Day fix dispatch with narrow edit surfaces may run",
		);
		for (const [label, input] of [
			[
				"valid scope followed by a repository-root scope",
				{
					agent: "jero-worker",
					task: "## Allowed edit surfaces\nextensions/jero-ai.ts\n\n## Allowed edit surfaces\n.",
					mode: "task",
				},
			],
			[
				"valid task scope plus invalid context scope",
				{
					agent: "jero-worker",
					task: "## Allowed edit surfaces\nextensions/jero-ai.ts",
					context: "## Allowed edit surfaces\n.",
					mode: "task",
				},
			],
			[
				"conflicting valid task and context scopes",
				{
					agent: "jero-worker",
					task: "## Allowed edit surfaces\nextensions/jero-ai.ts",
					context: "## Allowed edit surfaces\ntests/runtime-harness.mjs",
					mode: "task",
				},
			],
		]) {
			const writerResult = await toolHook({ toolName: "subagent_run", input }, createCtx(toolCwd));
			assert.equal(writerResult?.block, true, `${label} must block writer dispatch`);
		}
		assert.equal(
			await toolHook(
				{
					toolName: "subagent_run",
					input: {
						agent: "jero-worker",
						task: "## Allowed edit surfaces\nextensions/jero-ai.ts\ntests/runtime-harness.mjs\n\n## Allowed edit surfaces\n- `tests/runtime-harness.mjs`\n- `extensions/jero-ai.ts`",
						mode: "task",
					},
				},
				createCtx(toolCwd),
			),
			undefined,
			"a writer may dispatch when multiple allowed edit surface sections are compatible",
		);
		assert.equal(
			await toolHook(
				{ toolName: "subagent_run", input: { agent: "scout", task: "Map the repository.", mode: "task" } },
				createCtx(toolCwd),
			),
			undefined,
			"non-writer subagents must remain unaffected",
		);
		const sensitiveRead = await toolHook({ toolName: "read", input: { path: join(toolCwd, ".env.local") } }, createCtx(toolCwd));
		assert.equal(sensitiveRead.block, true);
		assert.match(sensitiveRead.reason, /sensitive path/);
		const sensitiveWrite = await toolHook({ toolName: "write", input: { path: join(toolCwd, "secrets", "token.txt"), content: "x" } }, createCtx(toolCwd));
		assert.equal(sensitiveWrite.block, true);
		const sensitiveEdit = await toolHook({ toolName: "edit", input: { edits: [], path: join(toolCwd, "id_rsa.pem") } }, createCtx(toolCwd));
		assert.equal(sensitiveEdit.block, true);
		assert.equal(await toolHook({ toolName: "read", input: { path: join(toolCwd, "src", "index.ts") } }, createCtx(toolCwd)), undefined);
		const dangerousReviewCtx = createCtx(toolCwd, true, "dangerous-review-session");
		const needsConfirm = await toolHook(
			{ toolName: "bash", input: { command: "git push" } },
			dangerousReviewCtx,
		);
		assert.equal(needsConfirm.block, true);
		assert.match(needsConfirm.reason, /not confirmed/);
		assert.deepEqual(
			emittedEvents.map(({ channel, data }) => ({
				channel,
				state: data.state,
				active: data.active,
				label: data.label,
			})),
			[
				{
					channel: "pi-permission-system:permission-request",
					state: "waiting",
					active: undefined,
					label: undefined,
				},
				{
					channel: "herdr:blocked",
					state: undefined,
					active: true,
					label: "Guarded command confirmation",
				},
				{
					channel: "pi-permission-system:permission-request",
					state: "denied",
					active: undefined,
					label: undefined,
				},
				{
					channel: "herdr:blocked",
					state: undefined,
					active: false,
					label: undefined,
				},
			],
			"guarded confirmation emits both lifecycle channels in order",
		);
		assert.equal(emittedEvents[0].data.requestId, emittedEvents[2].data.requestId);
		emittedEvents.length = 0;
		// D6 (design §5.3, rpiv row): the rpiv:ask-user:blocked listener is
		// deleted together with the ask-user-choice replica — the questionnaire
		// plugin owns its own blocking UX, and jero-pi neither relays those
		// payloads nor observes them.
		pi.events.emit("rpiv:ask-user:blocked", {
			active: true,
			question: "private runtime questionnaire",
			answer: "private runtime answer",
			path: "/private/runtime-path",
			command: "private runtime command",
		});
		pi.events.emit("rpiv:ask-user:blocked", { active: false });
		assert.deepEqual(
			emittedEvents.filter(({ channel }) => channel === "herdr:blocked"),
			[],
		);
		assert.equal(
			dangerousReviewCtx.ui.notifications.length,
			0,
			"dangerous-command confirmation must not launch or announce review actors",
		);
		const commitCwd = await tempWorkspace();
		try {
			execFileSync("git", ["init"], { cwd: commitCwd, stdio: "ignore" });
			const deliveryResult = await toolHook(
				{ toolName: "bash", input: { command: "git commit -m bounded tracked.txt" } },
				createCtx(commitCwd),
			);
			assert.equal(deliveryResult, undefined, "ordinary delivery policy, not review authority, governs commits");
		} finally {
			await rm(commitCwd, { recursive: true, force: true });
		}
	} finally {
		await rm(toolCwd, { recursive: true, force: true });
	}

	// review-candidate-view Phase 3.6 settling test: a contributor edit landing
	// strictly between the controller-owned candidate binding and reviewer
	// dispatch must diverge the live candidate tree from the frozen one, and
	// dispatch must fail closed rather than expose a substituted view to the
	// lens sub-agent. This drives the real `createJeroAiExtension` tool_call
	// wiring (not the bare library function tested in
	// tests/review-candidate-view.test.ts) with an injected candidate-view
	// registry, so the actual production dispatch path is exercised.
	const candidateDriftCwd = await tempWorkspace();
	try {
		const { createJeroAiExtension } = await import(
			pathToFileURL(join(ROOT, "extensions/jero-ai.ts")).href
		);
		const { CandidateViewRegistry } = await import(
			pathToFileURL(join(ROOT, "lib/review-candidate-view.ts")).href
		);

		gitSync(candidateDriftCwd, "init", "-b", "main");
		await writeFile(join(candidateDriftCwd, "tracked.txt"), "base\n");
		gitSync(candidateDriftCwd, "add", "tracked.txt");
		gitSync(
			candidateDriftCwd,
			"-c", "user.name=Runtime Harness",
			"-c", "user.email=runtime-harness@example.invalid",
			"commit", "-m", "base",
		);

		const registry = new CandidateViewRegistry();
		const view = registry.create({ contributorRoot: candidateDriftCwd });
		registry.bindCurrent({ token: view.token, lineageId: "harness-candidate-drift", selectedLenses: ["review-risk"] });

		const dispatchPi = createPi();
		createJeroAiExtension({ candidateViews: registry })(dispatchPi.pi);
		const dispatchToolHook = dispatchPi.hooks.get("tool_call")[0];

		// The contributor edits the tracked file strictly after the candidate
		// view was bound (START) and strictly before dispatch would run.
		await writeFile(join(candidateDriftCwd, "tracked.txt"), "drifted after bind, before dispatch\n");

		const dispatchInput = { agent: "review-risk", task: "review", mode: "task" };
		const dispatchResult = await dispatchToolHook(
			{ toolName: "subagent_run", input: dispatchInput },
			createCtx(candidateDriftCwd),
		);
		assert.equal(dispatchResult?.block, true, "dispatch must fail closed when the candidate tree diverges between bind and dispatch");
		assert.match(dispatchResult.reason, /live candidate|drift/i);
		assert.equal(
			dispatchInput.task,
			"review",
			"a failed-closed dispatch must never mutate the child dispatch input",
		);
		assert.doesNotMatch(
			dispatchInput.task,
			/Controller-owned review lineage/,
			"a failed-closed dispatch must never inject a substituted candidate view into the lens sub-agent's task",
		);
		await chmod(view.root, 0o700);
		registry.cleanup(view.token);
	} finally {
		restoreWorkspaceWritePermissions(candidateDriftCwd);
		await rm(candidateDriftCwd, { recursive: true, force: true });
	}

	const bannerCwd = await tempWorkspace();
	try {
		const ctx = createCtx(bannerCwd, true);
		await commands.get("jero:toggle-rose").handler("", ctx);
		let bannerConfig = JSON.parse(await readFile(join(globalConfigHome, "banner.json"), "utf8"));
		assert.equal(bannerConfig.showRose, false);
		assert.equal(bannerConfig.showTextLogo, true);
		assert.equal(bannerConfig.color, "pink");
		await commands.get("jero:toggle-text-logo").handler("", ctx);
		bannerConfig = JSON.parse(await readFile(join(globalConfigHome, "banner.json"), "utf8"));
		assert.equal(bannerConfig.showTextLogo, false);
		await commands.get("jero:banner-color").handler("cyan", ctx);
		bannerConfig = JSON.parse(await readFile(join(globalConfigHome, "banner.json"), "utf8"));
		assert.equal(bannerConfig.color, "cyan");
		await commands.get("jero:banner").handler("", ctx);
		bannerConfig = JSON.parse(await readFile(join(globalConfigHome, "banner.json"), "utf8"));
		assert.equal(bannerConfig.showRose, true);
	} finally {
		await rm(bannerCwd, { recursive: true, force: true });
		await rm(join(globalConfigHome, "banner.json"), { force: true });
	}

	// issue-301: cancelling the color picker must be a no-op — no write,
	// no notify, and the previously saved color must survive byte/semantically
	// unchanged. Covers both entry points: /jero:banner-color picker
	// (cancelled), and /jero:banner -> Color row -> nested picker (cancelled).
	// Also covers an invalid non-empty argument, which must still open the
	// picker and treat its cancellation as a no-op.
	const cancelPickerCwd = await tempWorkspace();
	try {
		const bannerConfigPath = join(globalConfigHome, "banner.json");
		const seeded = {
			showRose: false,
			showTextLogo: false,
			color: "green",
		};
		const seededJson = `${JSON.stringify(seeded, null, 2)}\n`;
		await writeFile(bannerConfigPath, seededJson, "utf8");

		const cancelCtx = createCtx(cancelPickerCwd, true);

		// (a) /jero:banner-color picker cancelled: seeded color unchanged, no notify.
		cancelCtx.ui.notifications.length = 0;
		cancelCtx.ui.selections.length = 0;
		cancelCtx.ui.select = async (label, options) => {
			cancelCtx.ui.selections.push({ label, options });
			return undefined;
		};
		await commands.get("jero:banner-color").handler("", cancelCtx);
		let afterCancel = await readFile(bannerConfigPath, "utf8");
		assert.equal(afterCancel, seededJson, "banner-color cancel must not rewrite banner.json");
		assert.equal(cancelCtx.ui.selections.length, 1, "banner-color cancel must open the picker once");
		assert.equal(cancelCtx.ui.notifications.length, 0, "banner-color cancel must not notify");

		// (d) invalid non-empty /jero:banner-color input still opens picker;
		//     cancelling it is a no-op.
		cancelCtx.ui.notifications.length = 0;
		cancelCtx.ui.selections.length = 0;
		await commands.get("jero:banner-color").handler("purple", cancelCtx);
		afterCancel = await readFile(bannerConfigPath, "utf8");
		assert.equal(afterCancel, seededJson, "banner-color invalid+cancel must not rewrite banner.json");
		assert.equal(cancelCtx.ui.selections.length, 1, "invalid banner-color arg must still open the picker");
		assert.equal(cancelCtx.ui.notifications.length, 0, "banner-color invalid+cancel must not notify");

		// (b) /jero:banner selects the Color row, then the nested picker is
		//     cancelled: seeded color unchanged, no notify. The outer select
		//     returns the Color row; the nested select returns undefined.
		cancelCtx.ui.notifications.length = 0;
		cancelCtx.ui.selections.length = 0;
		let selectCall = 0;
		cancelCtx.ui.select = async (label, options) => {
			cancelCtx.ui.selections.push({ label, options });
			selectCall += 1;
			// First call: outer "Startup banner" menu -> pick the Color row.
			// Second call: nested color picker -> cancel (undefined).
			return selectCall === 1 ? options[options.length - 1] : undefined;
		};
		await commands.get("jero:banner").handler("", cancelCtx);
		afterCancel = await readFile(bannerConfigPath, "utf8");
		assert.equal(afterCancel, seededJson, "banner Color-row cancel must not rewrite banner.json");
		assert.equal(cancelCtx.ui.selections.length, 2, "banner Color-row flow must open outer then nested picker");
		assert.equal(cancelCtx.ui.notifications.length, 0, "banner Color-row cancel must not notify");

		// Sanity: the seeded config round-trips through normalization unchanged,
		// proving the byte equality above is semantic, not a test artifact.
		const reparsed = JSON.parse(await readFile(bannerConfigPath, "utf8"));
		assert.deepEqual(reparsed, seeded, "seeded non-default color must round-trip semantically");
	} finally {
		await rm(cancelPickerCwd, { recursive: true, force: true });
		await rm(join(globalConfigHome, "banner.json"), { force: true });
	}

	Object.assign(env, { discovered, delegationDetail, promptCwd, toolCwd, candidateDriftCwd, bannerCwd, cancelPickerCwd });
}
