import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

// ---------------------------------------------------------------------------
// gentle-pi#661/#662: RDD-aware verification rule for delegated work.
//
// The bounded writer always self-verifies: it runs the parent-authorized
// `## Verification` commands itself and reports observed output. Whether a
// SEPARATE `jero-verify` delegation is also required depends on the
// rendered `Receipt-driven development:` line, stated normatively exactly
// once in trigger 5 (Verification rule) and referenced -- not restated --
// everywhere else in this asset:
//   - `on`             -> the writer's own report is the verification of
//                         record; `jero-verify` is on-demand, except
//                         passive risk, which gets a structural readback.
//   - `off`/`unknown`  -> gentle-pi#662: the parent calls `jero_review` with
//                         `{"operation":"assess"}` over the writer's diff and
//                         follows the returned plan by native risk tier
//                         (passive/medium/high/unassessable), instead of a
//                         blanket non-trivial judgment. An unknown RDD line
//                         never lowers a tier below `off`.
// These tests assert the exact distinctive sentences (not bare words like
// `off`/`unknown`/`partial`/`blocked`), that the tier table is stated exactly
// once, that the routing ladder paragraph references trigger 5 rather than
// restating it, and that `## Known environmental failures` has one canonical
// definition (owned by the worker asset) that the delegation asset
// references rather than duplicates.
// ---------------------------------------------------------------------------

const ROOT = join(import.meta.dirname, "..");

function read(relativePath: string): string {
	return readFileSync(join(ROOT, relativePath), "utf8");
}

function countOccurrences(haystack: string, needle: string): number {
	return haystack.split(needle).length - 1;
}

const delegation = read("assets/orchestrator-delegation.md");
const worker = read("assets/agents/jero-worker.md");

const ON_SENTENCE =
	"当该行读作 `on` 时，写者报告即记录在案的验证，原生评审是写者无法影响的独立检查";
const OFF_UNKNOWN_SENTENCE =
	'当该行读作 `off` 或 `unknown` 时，写者返回后，对写者的 diff 调用 `jero_review` 的 `{"operation":"assess"}` 并遵循返回的计划，而不是凭任务描述判断非平凡性：该操作解析原生风险层级并确切说明接下来由谁验证。';
const TIER_TABLE_HEADER = "| 原生风险层级 | RDD 为 `off`/`unknown` 时的验证 |";
const PASSIVE_TIER_ROW = "| passive | 父会话结构化回读；无独立验证者，不跑测试 |";
const MEDIUM_TIER_ROW = "| medium | 写者自验证成立；仅当写者画像为小模型（mini 或低 effort）时追加独立 `jero-verify` 运行 |";
const HIGH_TIER_ROW = "| high | 写者自验证加独立 `jero-verify` 运行，恒定如此 |";
const UNASSESSABLE_TIER_ROW = "| unknown / assess 失败 | 按 high 处理 |";
const SMALL_MODEL_BIAS_SENTENCE =
	"小模型偏差使验证用途的层级上调一级（medium 变 high）；未知的 `Receipt-driven development:` 行绝不让层级比 `off` 更宽松。";
const SPOT_CHECK_SENTENCE =
	"父会话抽查（交付前重跑一条已报告的命令）在每个层级都保持必需。";
// gentle-pi#668: the `on` branch of trigger 5 holds only while the native
// review actually reaches a terminal outcome for this candidate -- a decline,
// a clone-local disable, or a refused START/STATUS all fall back to the exact
// same risk-gated path as `off`.
const ON_BRANCH_FALLBACK_SENTENCE =
	'该 `on` 分支仅当原生评审确实对该候选到达终局结果时成立（gentle-pi#668）：该候选的同意封套被人类拒绝（候选范围，绝不是 RDD 总开关）、流程中发现 clone 本地的 RDD 已禁用，或 START/STATUS 被拒绝，都完全像 `off` 一样回落到风险分级路径——调用 `jero_review` 并传入 `{"operation":"assess"}`（父会话已知时传入 `nativeReviewOutcome`；否则工具从它自己对该候选的观察推导，无法推导时保守失败为 `unknown`）并遵循返回的计划。';

test("trigger 5 (Verification rule) states the exact on-line routing: writer report is the verification of record", () => {
	assert.ok(delegation.includes(ON_SENTENCE), "trigger 5 is missing the exact on-line sentence");
});

test("trigger 5 states the exact off/unknown-line routing: the parent calls jero_review's assess operation and follows the returned plan", () => {
	assert.ok(delegation.includes(OFF_UNKNOWN_SENTENCE), "trigger 5 is missing the exact off/unknown-line sentence");
});

test("trigger 5 states the native risk tier table exactly once, with all four rows", () => {
	for (const row of [TIER_TABLE_HEADER, PASSIVE_TIER_ROW, MEDIUM_TIER_ROW, HIGH_TIER_ROW, UNASSESSABLE_TIER_ROW]) {
		assert.equal(countOccurrences(delegation, row), 1, `expected exactly one occurrence of tier table row: ${row}`);
	}
});

test("trigger 5 states the small-model bias and the unknown-never-lowers-a-tier rule", () => {
	assert.ok(delegation.includes(SMALL_MODEL_BIAS_SENTENCE), "trigger 5 is missing the small-model bias sentence");
});

test("trigger 5 keeps the parent spot check requirement in every tier", () => {
	assert.ok(delegation.includes(SPOT_CHECK_SENTENCE), "trigger 5 is missing the parent spot check sentence");
});

test("trigger 5 states that the on branch holds only while the native review closes for this candidate, falling back to the off path exactly once (gentle-pi#668)", () => {
	assert.equal(countOccurrences(delegation, ON_BRANCH_FALLBACK_SENTENCE), 1, "trigger 5 is missing (or duplicates) the on-branch fallback sentence");
});

test("the on-branch fallback sentence names all three non-closed triggers and never introduces a forbidden native RDD marker", () => {
	for (const clause of ["被人类拒绝", "clone 本地", "START/STATUS 被拒绝"]) {
		assert.ok(ON_BRANCH_FALLBACK_SENTENCE.includes(clause), `on-branch fallback sentence missing: ${clause}`);
	}
	for (const marker of ["gentle-ai review status", "next_transition", "review.capture-result", "review.validate", "reviewGate.result"]) {
		assert.ok(!delegation.includes(marker), `stale/forbidden RDD marker introduced: ${marker}`);
	}
});

test("the on-line and off/unknown-line routing sentences appear exactly once each (normative statement lives only in trigger 5)", () => {
	for (const sentence of [ON_SENTENCE, OFF_UNKNOWN_SENTENCE]) {
		assert.equal(countOccurrences(delegation, sentence), 1, `expected exactly one occurrence of: ${sentence.slice(0, 60)}...`);
	}
});

test("trigger 5 never restates the retired #661 off/unknown non-trivial judgment", () => {
	assert.doesNotMatch(delegation, /non-trivial change, in addition to the writer's own report/);
	assert.doesNotMatch(delegation, /purely passive documentation with no behavior to verify/);
});

test("the Simple Delegation paragraph references trigger 5 instead of restating the on/off/unknown routing", () => {
	assert.match(
		delegation,
		/按感知 RDD 的验证规则（强制委托触发条件下的触发 5，gentle-pi#661）/,
	);
	assert.match(delegation, /规范性的 on\/off\/unknown 路由在那里，不在此/);
});

test("delegation overlay's trigger 5 (Verification rule) is RDD-aware", () => {
	assert.match(delegation, /\*\*验证规则\*\*.*感知 RDD/);
});

test("delegation overlay reserves separate exploration for parent routing decisions", () => {
	assert.match(delegation, /独立探索保留给父会话需要地图来决策或路由时/i);
	assert.match(delegation, /为写入做准备的读取属于做出变更的写者/i);
});

test("delegation overlay keeps the required headings", () => {
	for (const heading of [
		"### 委托规则",
		"#### Background Subagent Policy",
		"#### Allowed edit surfaces (MANDATORY)",
		"### 3. SDD（可选）",
	]) {
		assert.ok(delegation.includes(heading), `delegation overlay lost required heading: ${heading}`);
	}
});

test("worker asset declares the Verification section after Test discipline", () => {
	const testDisciplineIndex = worker.indexOf("## 测试纪律");
	const verificationIndex = worker.indexOf("## Verification");
	const interactionIndex = worker.indexOf("## 交互契约");
	assert.ok(testDisciplineIndex >= 0, "worker asset lost ## Test discipline");
	assert.ok(verificationIndex >= 0, "worker asset is missing ## Verification");
	assert.ok(interactionIndex >= 0, "worker asset lost ## Interaction contract");
	assert.ok(
		testDisciplineIndex < verificationIndex && verificationIndex < interactionIndex,
		"## Verification must sit between ## Test discipline and ## Interaction contract",
	);
});

test("worker asset requires foreground, one-at-a-time verification with nothing left unreported", () => {
	for (const clause of [
		"在前台运行",
		"一次一条",
		"绝不在后台启动验证命令",
		"绝不在有列出的命令未报告的情况下结束任务",
	]) {
		assert.ok(worker.includes(clause), `worker asset is missing: ${clause}`);
	}
});

test("worker asset reports each verification command as <exact command>: <observed result> in validation", () => {
	assert.ok(worker.includes("`<exact command>: <observed result>`"));
	assert.ok(worker.includes("在 `validation` 中"));
});

// ---------------------------------------------------------------------------
// Contract consistency (`## Known environmental failures`): defined exactly
// once, in the worker asset, as "exact test names (or exact command lines)
// that already fail on the base"; the writer reports those as evidence, but
// any OTHER failing required command still forces `status: partial`. The
// delegation asset must reference this same definition, not restate it.
// ---------------------------------------------------------------------------

test("worker asset owns the canonical Known environmental failures definition", () => {
	assert.ok(worker.includes("## Known environmental failures"));
	assert.match(worker, /这是权威定义；其他资产引用它，不复述它/i);
	assert.match(worker, /列出在本任务变更之前、基线上已然失败的确切测试名或确切命令行/i);
	assert.match(worker, /任何其他失败的必需命令——未在该标题下点名的——仍然强制 `status: partial`。/);
});

test("delegation asset references the worker's Known environmental failures definition instead of restating it", () => {
	assert.match(
		delegation,
		/`## Known environmental failures` 遵循与 `jero-worker` 验证契约相同的定义：精确的既有基线失败作为证据报告，绝不是阻塞因素——任何其他失败的必需命令仍强制 `status: partial`。/,
	);
	// The full canonical wording ("lists exact test names or exact command
	// lines that already fail on the base") must not be duplicated here.
	assert.doesNotMatch(delegation, /lists exact test names or exact command lines that already fail on the base/i);
});

test("worker asset never claims completion while a required verification command fails under RDD, except a named environmental failure", () => {
	assert.match(worker, /本报告即该变更的权威验证/i);
	assert.match(worker, /原生评审仍是编写者无法影响的独立检查/i);
	assert.match(
		worker,
		/当 `## Verification` 之下有必需命令失败时绝不报告 `status: completed`，除非该确切失败已在 `## Known environmental failures` 下点名。/i,
	);
});

test("worker keeps candidate review disposition and lifecycle parent-owned", () => {
	for (const clause of [
		"主父会话拥有候选评审处置和生命周期，包括预检和任何显式的候选级豁免。",
		"绝不搜索、请求或调用评审工具，包括 `jero_review`。",
		"评审工具缺失绝不阻塞此 worker 的实现或验证交接。",
	]) {
		assert.ok(worker.includes(clause), `worker asset is missing: ${clause}`);
	}
});

test("worker asset keeps the existing Return contract fields", () => {
	for (const field of [
		"status: completed | partial | blocked | interaction_required",
		"summary:",
		"files_changed:",
		"tdd_evidence:",
		"validation:",
		"risks:",
		"review_focus:",
		"skill_resolution:",
		"interaction_required:",
	]) {
		assert.ok(worker.includes(field), `worker asset lost Return contract field: ${field}`);
	}
});
