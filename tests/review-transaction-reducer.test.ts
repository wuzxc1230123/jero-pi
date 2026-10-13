import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	assertFrozenLedgerIntegrity,
	assertReceiptIntegrity,
	assertState,
	createFrozenLedger,
	createReceiptEnvelope,
	createReviewState,
	createScopeChildClaim,
	operationForTransition,
	reducerOperationResult,
	repositoryRootForGate,
	validateReviewGraphReplayV1,
} from "../lib/review-transaction-reducer.ts";
import {
	canonicalHash,
	EVIDENCE_CLASS,
	type CanonicalFrozenRowV1,
	REVIEW_OPERATION,
	REVIEW_PHASE,
	REVIEW_TRANSITION,
	ReviewIntegrityError,
	TERMINAL_STATE,
	type ReceiptBodyV1,
	type ReviewBudgetV1,
	type ReviewOperation,
	type ReviewStateV1,
} from "../lib/review-transaction-schema.ts";
import { REVIEW_MODE } from "../lib/review-snapshot.ts";
import { REVIEW_LENS, REVIEW_ROUTE } from "../lib/authority/review-triggers.ts";
import { testSnapshot } from "./review-test-fixtures.ts";

// review-transaction-reducer 域测试：台账/状态/回执之外的归约面——
// operationForTransition 映射、createReviewState 守卫、assertState 深分支、
// scope claim、图回放校验与 gate 根解析。夹具复用 review-test-fixtures。

const TREE = {
	BASE: "1".repeat(40),
	COMPLETE: "2".repeat(40),
	INITIAL: "3".repeat(40),
	FINAL: "4".repeat(40),
	CHILD: "5".repeat(40),
} as const;

function budget(overrides: Partial<ReviewBudgetV1> = {}): ReviewBudgetV1 {
	return {
		review_batches: 2,
		review_actors: 2,
		refuter_batches: 2,
		fix_batches: 2,
		validator_runs: 2,
		final_verifications: 2,
		judgment_rounds: 0,
		judge_runs: 0,
		...overrides,
	};
}

function frozenRow(id: string): CanonicalFrozenRowV1 {
	return {
		id,
		lens: REVIEW_LENS.RISK,
		location: "src/auth.ts:20",
		severity: "CRITICAL",
		status_at_freeze: "open",
		evidence_class: EVIDENCE_CLASS.INFERENTIAL_SEVERE,
		evidence_claim: "A forged token reaches the protected handler.",
	};
}

function makeState(): ReviewStateV1 {
	return createReviewState({
		lineageId: "lineage-a",
		mode: REVIEW_MODE.ORDINARY,
		snapshot: testSnapshot({
			baseTree: TREE.BASE,
			completeTree: TREE.COMPLETE,
			initialTree: TREE.INITIAL,
			route: REVIEW_ROUTE.STANDARD,
			lenses: [REVIEW_LENS.RISK],
		}),
		evidenceHash: "b".repeat(64),
		budget: budget(),
	});
}

function clone(state: ReviewStateV1): ReviewStateV1 {
	return structuredClone(state);
}

test("operationForTransition：十个转移映射四类操作，未知转移拒绝", () => {
	const expected: readonly [(typeof REVIEW_TRANSITION)[keyof typeof REVIEW_TRANSITION], ReviewOperation][] = [
		[REVIEW_TRANSITION.ORDINARY_DISCOVERY, REVIEW_OPERATION.FREEZE_LEDGER],
		[REVIEW_TRANSITION.JUDGMENT_DAY_DISCOVERY, REVIEW_OPERATION.FREEZE_LEDGER],
		[REVIEW_TRANSITION.ORDINARY_EVIDENCE, REVIEW_OPERATION.RESOLVE_EVIDENCE],
		[REVIEW_TRANSITION.JUDGMENT_DAY_REJUDGMENT, REVIEW_OPERATION.RESOLVE_EVIDENCE],
		[REVIEW_TRANSITION.ORDINARY_FIX, REVIEW_OPERATION.AUTHORIZE_FIX],
		[REVIEW_TRANSITION.ORDINARY_NO_FIX, REVIEW_OPERATION.AUTHORIZE_FIX],
		[REVIEW_TRANSITION.JUDGMENT_DAY_FIX, REVIEW_OPERATION.AUTHORIZE_FIX],
		[REVIEW_TRANSITION.ORDINARY_VALIDATION, REVIEW_OPERATION.VALIDATE_FIX],
		[REVIEW_TRANSITION.ORDINARY_FINAL_VERIFICATION, REVIEW_OPERATION.VERIFY],
		[REVIEW_TRANSITION.JUDGMENT_DAY_FINAL_VERIFICATION, REVIEW_OPERATION.VERIFY],
	];
	for (const [transition, operation] of expected) {
		assert.equal(operationForTransition(transition), operation);
	}
	assert.throws(() => operationForTransition("nope" as never), /Unsupported reducer transition/);
});

test("createReviewState：快照模式与路由派生守卫", () => {
	assert.doesNotThrow(() => makeState());

	const snapshot = testSnapshot({
		baseTree: TREE.BASE,
		completeTree: TREE.COMPLETE,
		initialTree: TREE.INITIAL,
		route: REVIEW_ROUTE.STANDARD,
		lenses: [REVIEW_LENS.RISK],
	});
	assert.throws(
		() => createReviewState({
			lineageId: "lineage-a",
			mode: REVIEW_MODE.ORDINARY,
			snapshot: { ...snapshot, schema: "other/v9" as never },
			evidenceHash: "b".repeat(64),
			budget: budget(),
		}),
		/Unknown review snapshot schema/,
	);
	assert.throws(
		() => createReviewState({
			lineageId: "lineage-a",
			mode: REVIEW_MODE.JUDGMENT_DAY,
			snapshot,
			evidenceHash: "b".repeat(64),
			budget: budget(),
		}),
		/mode does not match/,
	);
	// 普通模式：路由与透镜必须由 diff 证据派生——伪报 FULL_4R 被拒。
	assert.throws(
		() => createReviewState({
			lineageId: "lineage-a",
			mode: REVIEW_MODE.ORDINARY,
			snapshot: { ...snapshot, route: REVIEW_ROUTE.FULL_4R },
			evidenceHash: "b".repeat(64),
			budget: budget(),
		}),
		/not derived from the snapshot diff/,
	);
	// 裁判日快照不得携带普通路由分类。
	assert.throws(
		() => createReviewState({
			lineageId: "lineage-a",
			mode: REVIEW_MODE.JUDGMENT_DAY,
			snapshot: testSnapshot({
				mode: REVIEW_MODE.JUDGMENT_DAY,
				baseTree: TREE.BASE,
				completeTree: TREE.COMPLETE,
				route: REVIEW_ROUTE.STANDARD,
				lenses: [REVIEW_LENS.RISK],
			}),
			evidenceHash: "b".repeat(64),
			budget: budget(),
		}),
		/must not carry ordinary route/,
	);
	// 普通血统必须有不可变 genesis 路径。
	assert.throws(
		() => createReviewState({
			lineageId: "lineage-a",
			mode: REVIEW_MODE.ORDINARY,
			snapshot: { ...snapshot, genesis_paths: undefined },
			evidenceHash: "b".repeat(64),
			budget: budget(),
		}),
		/genesis paths/,
	);
});

test("createReviewState：父血统透传", () => {
	const snapshot = testSnapshot({
		baseTree: TREE.BASE,
		completeTree: TREE.COMPLETE,
		initialTree: TREE.INITIAL,
		route: REVIEW_ROUTE.STANDARD,
		lenses: [REVIEW_LENS.RISK],
	});
	const child = createReviewState({
		lineageId: "lineage-child",
		parentLineageId: "lineage-a",
		mode: REVIEW_MODE.ORDINARY,
		snapshot,
		evidenceHash: "b".repeat(64),
		budget: budget(),
	});
	assert.equal(child.parent_lineage_id, "lineage-a");
	assert.doesNotThrow(() => assertState(child));
});

test("assertState：结构与预算深分支逐项拒绝", () => {
	const base = makeState();

	const badSchema = clone(base);
	badSchema.schema = "other/v9" as never;
	assert.throws(() => assertState(badSchema), /Unknown review state schema/);

	const badLineage = clone(base);
	badLineage.lineage_id = "bad lineage!";
	assert.throws(() => assertState(badLineage), /Invalid lineage ID/);

	const badRevision = clone(base);
	badRevision.revision = -1;
	assert.throws(() => assertState(badRevision), /Invalid state revision/);

	const badTree = clone(base);
	badTree.current_candidate_tree = "zzz";
	assert.throws(() => assertState(badTree), /not a resolved object ID/);

	const badDigest = clone(base);
	badDigest.policy_hash = "not-a-digest";
	assert.throws(() => assertState(badDigest), /not a SHA-256 digest/);

	const badGenesis = clone(base);
	badGenesis.genesis_paths = ["src/review.ts", "app.ts"];
	assert.throws(() => assertState(badGenesis), /unique and sorted/);

	const badGenesisPath = clone(base);
	badGenesisPath.genesis_paths = ["../escape.ts", "app.ts"];
	assert.throws(() => assertState(badGenesisPath), /canonical repository-relative/);

	const overBudget = clone(base);
	overBudget.counters = { ...overBudget.counters, review_batches: 3 };
	assert.throws(() => assertState(overBudget), /Review budget exceeded/);

	const negativeCounter = clone(base);
	negativeCounter.counters = { ...negativeCounter.counters, review_batches: -1 };
	assert.throws(() => assertState(negativeCounter), /Invalid review counter/);

	const raised = clone(base);
	raised.counters = { ...raised.counters, review_batches: 1 };
	const nonMonotonic = clone(raised);
	nonMonotonic.counters = { ...nonMonotonic.counters, review_batches: 0 };
	assert.throws(() => assertState(nonMonotonic, raised), /not monotonic/);

	const terminalWithoutPhase = clone(base);
	terminalWithoutPhase.terminal_state = TERMINAL_STATE.APPROVED;
	assert.throws(() => assertState(terminalWithoutPhase), /Terminal state requires terminal phase/);
});

test("assertState：台账/修复/活跃发现/子声明/日志守卫", () => {
	const base = makeState();

	const ledger = createFrozenLedger([frozenRow("RISK-001")]);
	const withLedger = clone(base);
	withLedger.frozen_ledger = structuredClone(ledger);
	assert.doesNotThrow(() => assertState(withLedger));

	const dupActive = clone(withLedger);
	dupActive.active_finding_ids = ["RISK-001", "RISK-001"];
	assert.throws(() => assertState(dupActive), /Active finding IDs must be unique/);

	const unfrozenActive = clone(withLedger);
	unfrozenActive.active_finding_ids = ["GHOST-9"];
	assert.throws(() => assertState(unfrozenActive), /not frozen/);

	const claim = createScopeChildClaim(base.lineage_id, TREE.CHILD, budget());
	const withClaim = clone(base);
	withClaim.child_claims = [structuredClone(claim)];
	assert.doesNotThrow(() => assertState(withClaim));

	const foreignClaim = clone(withClaim);
	foreignClaim.child_claims = [{ ...structuredClone(claim), parent_lineage_id: "someone-else" }];
	assert.throws(() => assertState(foreignClaim), /parent does not match/);

	const tamperedClaim = clone(withClaim);
	tamperedClaim.child_claims = [
		{ ...structuredClone(claim), child_lineage_id: canonicalHash({ parent_lineage_id: base.lineage_id, target_tree: TREE.BASE }) },
	];
	assert.throws(() => assertState(tamperedClaim), /Child claim identity mismatch/);

	const dupTarget = clone(withClaim);
	dupTarget.child_claims = [structuredClone(claim), structuredClone(claim)];
	assert.throws(() => assertState(dupTarget), /target must be unique/);

	const badJournalStatus = clone(base);
	badJournalStatus.request_journal = [
		{ idempotency_key: "op-1", request_hash: "c".repeat(64), operation: REVIEW_OPERATION.GATE, status: "weird" as never },
	];
	assert.throws(() => assertState(badJournalStatus), /unsupported status/);

	const twoPending = clone(base);
	twoPending.request_journal = [
		{ idempotency_key: "op-1", request_hash: "c".repeat(64), operation: REVIEW_OPERATION.GATE, status: "pending" },
		{ idempotency_key: "op-2", request_hash: "d".repeat(64), operation: REVIEW_OPERATION.GATE, status: "pending" },
	];
	assert.throws(() => assertState(twoPending), /Only one pending operation/);

	const dupKey = clone(base);
	dupKey.request_journal = [
		{ idempotency_key: "op-1", request_hash: "c".repeat(64), operation: REVIEW_OPERATION.GATE, status: "completed" },
		{ idempotency_key: "op-1", request_hash: "d".repeat(64), operation: REVIEW_OPERATION.GATE, status: "completed" },
	];
	assert.throws(() => assertState(dupKey), /must be unique/);
});

test("assertState：不可变绑定与终局权威", () => {
	const base = makeState();

	const routeDrift = clone(base);
	routeDrift.route = REVIEW_ROUTE.FULL_4R as never;
	assert.throws(() => assertState(routeDrift, base), /Immutable review binding changed/);

	const withLedger = clone(base);
	withLedger.frozen_ledger = createFrozenLedger([frozenRow("RISK-001")]);
	const ledgerRewritten = clone(withLedger);
	ledgerRewritten.frozen_ledger = createFrozenLedger([frozenRow("RISK-002")]);
	assert.throws(() => assertState(ledgerRewritten, withLedger), /Frozen review ledger changed/);

	const terminal = clone(base);
	terminal.phase = REVIEW_PHASE.TERMINAL;
	terminal.terminal_state = TERMINAL_STATE.APPROVED;
	terminal.final_candidate_tree = TREE.FINAL;
	assert.doesNotThrow(() => assertState(terminal));

	const terminalDrift = clone(terminal);
	terminalDrift.escalation_reasons = ["changed"];
	assert.throws(() => assertState(terminalDrift, terminal), /closed and immutable/);
});

test("assertFrozenLedgerIntegrity：schema 与非规范排序拒绝", () => {
	const ledger = createFrozenLedger([frozenRow("RISK-002"), frozenRow("RISK-001")]);
	assert.doesNotThrow(() => assertFrozenLedgerIntegrity(ledger));

	const badSchema = structuredClone(ledger);
	badSchema.schema = "other/v9" as never;
	assert.throws(() => assertFrozenLedgerIntegrity(badSchema), /Unknown frozen ledger schema/);

	// 行未按 ID 排序但哈希按乱序计算：重建后排序不一致 → 拒绝。
	const unsorted = [frozenRow("RISK-002"), frozenRow("RISK-001")];
	const unsortedLedger = {
		schema: "jero-ai.review-frozen-ledger/v1",
		rows: unsorted,
		frozen_ledger_hash: canonicalHash(unsorted),
	} as never;
	assert.throws(() => assertFrozenLedgerIntegrity(unsortedLedger), /not in canonical ID order/);
});

test("createReceiptEnvelope / assertReceiptIntegrity：合法封套与篡改拒绝", () => {
	const current = makeState();
	const body: ReceiptBodyV1 = {
		schema: "jero-ai.review-receipt-body/v1",
		lineage_id: current.lineage_id,
		mode: current.mode,
		base_tree: current.base_tree,
		complete_snapshot_tree: current.complete_snapshot_tree,
		review_projection: current.review_projection,
		initial_review_tree: current.initial_review_tree,
		final_candidate_tree: TREE.FINAL,
		route: current.route,
		lenses: current.lenses,
		policy_hash: current.policy_hash,
		frozen_ledger_hash: createFrozenLedger([frozenRow("RISK-001")]).frozen_ledger_hash,
		evidence_hash: current.evidence_hash,
		budget: current.budget,
		counters: current.counters,
		terminal_state: TERMINAL_STATE.APPROVED,
	};
	const envelope = createReceiptEnvelope(body);
	assert.doesNotThrow(() => assertReceiptIntegrity(envelope));

	const badSchema = structuredClone(envelope);
	badSchema.body.schema = "other/v9" as never;
	assert.throws(() => assertReceiptIntegrity(badSchema), /Unknown receipt body schema/);

	const tampered = structuredClone(envelope);
	tampered.receipt_hash = "e".repeat(64);
	assert.throws(() => assertReceiptIntegrity(tampered), /Receipt hash mismatch/);
});

test("createScopeChildClaim：合法身份与非法输入拒绝", () => {
	const claim = createScopeChildClaim("lineage-a", TREE.CHILD, budget());
	assert.equal(
		claim.child_lineage_id,
		canonicalHash({ parent_lineage_id: "lineage-a", target_tree: TREE.CHILD }),
	);
	assert.throws(() => createScopeChildClaim("", TREE.CHILD, budget()), /Invalid lineage ID/);
	assert.throws(() => createScopeChildClaim("lineage-a", "zzz", budget()), /not a resolved object ID/);
	assert.throws(() => createScopeChildClaim("lineage-a", TREE.CHILD, budget({ fix_batches: -1 })), /Invalid budget counter/);
});

test("validateReviewGraphReplayV1：创世/守卫/操作预备/门分支", () => {
	assert.throws(() => validateReviewGraphReplayV1([]), /requires a genesis event/);

	const state = makeState();
	const genesis = {
		body: {
			payload: { state },
			reduced_state_hash: canonicalHash(state),
			reducer_transition: "start",
			reducer_input: state,
		},
	};

	const noState = [{ body: { payload: {}, reduced_state_hash: "x", reducer_transition: "start", reducer_input: {} } }] as never[];
	assert.throws(() => validateReviewGraphReplayV1(noState), /state reduction is invalid/);

	const badGenesis = [{
		body: {
			payload: { state },
			reduced_state_hash: canonicalHash(state),
			reducer_transition: "ordinary-discovery",
			reducer_input: state,
		},
	}] as never[];
	assert.throws(() => validateReviewGraphReplayV1(badGenesis), /genesis reducer input is invalid/);

	// operation-prepared：输入 transition 合法且状态仅推进修订号 → 通过。
	const revised = structuredClone(state);
	revised.revision = 1;
	const prepared = [
		genesis,
		{
			body: {
				payload: { state: revised },
				reduced_state_hash: canonicalHash(revised),
				reducer_transition: "operation-prepared",
				reducer_input: { transition: REVIEW_TRANSITION.ORDINARY_DISCOVERY },
			},
		},
	] as never[];
	assert.doesNotThrow(() => validateReviewGraphReplayV1(prepared));

	// operation-prepared：非法 transition 字符串 → 拒绝。
	const preparedBad = structuredClone(prepared) as unknown as { body: { reducer_input: unknown } }[];
	preparedBad[1]!.body.reducer_input = { transition: "nope" };
	assert.throws(() => validateReviewGraphReplayV1(preparedBad as never), /prepared operation transition is invalid/);

	// gate：kind 非 gate-evaluated → 拒绝。
	const gated = structuredClone(state);
	gated.revision = 2;
	const gateBad = [
		genesis,
		{
			body: {
				payload: { state: gated },
				reduced_state_hash: canonicalHash(gated),
				reducer_transition: "gate",
				reducer_input: { any: true },
			},
		},
	] as never[];
	assert.throws(() => validateReviewGraphReplayV1(gateBad), /gate replay journal is invalid/);

	// 不支持的 transition → 拒绝。
	const weird = structuredClone(state);
	weird.revision = 3;
	const unsupported = [
		genesis,
		{
			body: {
				payload: { state: weird },
				reduced_state_hash: canonicalHash(weird),
				reducer_transition: "weird",
				reducer_input: {},
			},
		},
	] as never[];
	assert.throws(() => validateReviewGraphReplayV1(unsupported), /reducer transition is unsupported/);
});

test("reducerOperationResult：携带修订号/阶段/终局", () => {
	const base = makeState();
	assert.deepEqual(reducerOperationResult(base, 3), { revision: 3, phase: base.phase });

	const terminal = clone(base);
	terminal.phase = REVIEW_PHASE.TERMINAL;
	terminal.terminal_state = TERMINAL_STATE.ESCALATED;
	assert.deepEqual(reducerOperationResult(terminal, 7), {
		revision: 7,
		phase: REVIEW_PHASE.TERMINAL,
		terminal_state: TERMINAL_STATE.ESCALATED,
	});
});

test("repositoryRootForGate：解析真实 git 仓库根", () => {
	const parent = mkdtempSync(join(tmpdir(), "jero-gate-root-"));
	const nested = join(parent, "repo", "deep");
	try {
		mkdirSync(nested, { recursive: true });
		const git = (...args: string[]) => execFileSync("git", args, { cwd: join(parent, "repo"), encoding: "utf8" }).trim();
		git("init", "-b", "main");
		writeFileSync(join(parent, "repo", "fixture.ts"), "export const fixture = true;\n");
		git("add", ".");
		git("-c", "user.name=Review", "-c", "user.email=review@example.invalid", "commit", "-m", "fixture");
		// git rev-parse 在 Windows 也返回 POSIX 分隔符——两侧归一化后比较。
		assert.equal(repositoryRootForGate(nested), join(parent, "repo").replaceAll("\\", "/"));
	} finally {
		rmSync(parent, { recursive: true, force: true });
	}
});
