import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	EVIDENCE_CLASS,
	REVIEW_MODE,
	REVIEW_TRANSITION,
	ReviewTransactionStore,
	createReviewState,
	type CanonicalFrozenRowV1,
	type ReviewBudgetV1,
} from "../lib/authority/review-transaction.ts";
import { REVIEW_LENS, REVIEW_ROUTE } from "../lib/authority/review-triggers.ts";
import { frozenFindingMarkersForRepository } from "../lib/shell-review-findings.ts";
import { qualifiedReviewLockPlatform, testSnapshot } from "./review-test-fixtures.ts";

// 冻结发现 → TUI 展示投影的只读来源：读取器绝不写权威存储、存储缺席
// 或非 git 环境一律按"无发现"返回，且不得落下任何存储脚印。

const TREE = { BASE: "1".repeat(40), COMPLETE: "2".repeat(40), INITIAL: "3".repeat(40) } as const;

function budget(): ReviewBudgetV1 {
	return {
		review_batches: 1,
		review_actors: 1,
		refuter_batches: 1,
		fix_batches: 1,
		validator_runs: 1,
		final_verifications: 1,
		judgment_rounds: 0,
		judge_runs: 0,
	};
}

function frozenRow(id: string, location: string): CanonicalFrozenRowV1 {
	return {
		id,
		lens: REVIEW_LENS.RISK,
		location,
		severity: "CRITICAL",
		status_at_freeze: "open",
		evidence_class: EVIDENCE_CLASS.DETERMINISTIC,
		evidence_claim: `claim for ${id}`,
	};
}

function reviewRepo(t: test.TestContext): string {
	const parent = mkdtempSync(join(tmpdir(), "jero-shell-findings-"));
	const root = join(parent, "repo");
	mkdirSync(root);
	t.after(() => rmSync(parent, { recursive: true, force: true }));
	const git = (...args: string[]): string => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
	git("init", "-b", "main");
	writeFileSync(join(root, "fixture.ts"), "export const fixture = true;\n");
	git("add", ".");
	git("-c", "user.name=Review", "-c", "user.email=review@example.invalid", "commit", "-m", "fixture");
	return root;
}

function freezeLedger(root: string, lineageId: string, rows: CanonicalFrozenRowV1[]): void {
	const store = ReviewTransactionStore.forRepository(root, { mutationLockPlatform: qualifiedReviewLockPlatform() });
	store.create(createReviewState({
		lineageId,
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
	}), `start-${lineageId}`);
	store.runReducerOperation({
		lineageId,
		transition: REVIEW_TRANSITION.ORDINARY_DISCOVERY,
		idempotencyKey: `freeze-${lineageId}`,
		input: { rows },
	});
}

test("非 git 目录按无发现返回，不抛错", (t) => {
	const parent = mkdtempSync(join(tmpdir(), "jero-shell-findings-plain-"));
	t.after(() => rmSync(parent, { recursive: true, force: true }));
	assert.deepEqual(frozenFindingMarkersForRepository(parent), []);
});

test("git 仓库无评审存储时按无发现返回且绝不落下存储脚印", (t) => {
	const root = reviewRepo(t);
	const storeRoot = join(root, ".git", "jero-ai", "reviews");
	assert.deepEqual(frozenFindingMarkersForRepository(root), []);
	assert.equal(existsSync(storeRoot), false, "display probe must not pin identity or create store directories");
	assert.equal(existsSync(join(root, ".git", "jero-ai")), false);
});

test("冻结台账映射为展示标记：claim 取 evidence_claim", (t) => {
	const root = reviewRepo(t);
	freezeLedger(root, "lineage-a", [frozenRow("RISK-001", "src/auth.ts:20"), frozenRow("READ-002", "src/review.ts:8")]);
	// 台账行按 id 正典排序存储（assertFrozenLedgerIntegrity 的不变量），
	// 标记保持该顺序。
	assert.deepEqual(frozenFindingMarkersForRepository(root), [
		{ id: "READ-002", location: "src/review.ts:8", severity: "CRITICAL", claim: "claim for READ-002" },
		{ id: "RISK-001", location: "src/auth.ts:20", severity: "CRITICAL", claim: "claim for RISK-001" },
	]);
});

test("多个谱系携带台账时最新谱系胜出", (t) => {
	const root = reviewRepo(t);
	freezeLedger(root, "lineage-a", [frozenRow("OLD-001", "src/old.ts:1")]);
	freezeLedger(root, "lineage-b", [frozenRow("NEW-001", "src/new.ts:2")]);
	const markers = frozenFindingMarkersForRepository(root);
	assert.deepEqual(markers.map(({ id }) => id), ["NEW-001"]);
});

test("无台账谱系被跳过：更早谱系的台账兜底", (t) => {
	const root = reviewRepo(t);
	freezeLedger(root, "lineage-a", [frozenRow("OLD-001", "src/old.ts:1")]);
	// lineage-b 只创建、不冻结——最新谱系无台账时回退到更早的台账。
	const store = ReviewTransactionStore.forRepository(root, { mutationLockPlatform: qualifiedReviewLockPlatform() });
	store.create(createReviewState({
		lineageId: "lineage-b",
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
	}), "start-lineage-b");
	assert.deepEqual(frozenFindingMarkersForRepository(root).map(({ id }) => id), ["OLD-001"]);
});
