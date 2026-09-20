import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

// ---------------------------------------------------------------------------
// Provider Defect Handoff — structural readback tests (issue #256, track 5)
//
// Pins the port of Gentle AI's v2.4.0-rc.8 provider-defect handoff consent
// contract (the gentle-ai.review-integration.consent/v3 envelope; canonical
// source internal/assets/generic/sdd-orchestrator.md at tag v2.4.0-rc.8 of
// Gentleman-Programming/gentle-ai) into Pi's lazy-loaded orchestrator assets.
// The contract is a prerelease (not in v2.3.0 stable). These tests assert
// structural presence, ordering, and the removal of stale rc.3-era rules; they
// do not execute any lifecycle command.
// ---------------------------------------------------------------------------

const REPO_ROOT = join(import.meta.dirname, "..");
const DELEGATION_PATH = join(REPO_ROOT, "assets", "orchestrator-delegation.md");
const SDD_WORKFLOW_PATH = join(REPO_ROOT, "assets", "sdd-orchestrator-workflow.md");

const DELEGATION = readFileSync(DELEGATION_PATH, "utf8");
const SDD_WORKFLOW = readFileSync(SDD_WORKFLOW_PATH, "utf8");

const CHOICE_TOKENS = ["report_and_continue", "continue_without_reporting", "stop_here"] as const;

// rc.8 choice-1 ordering mirrors gentle-ai v2.4.0-rc.8 blocking_prompt_contract_test.go; asserted only where phrases exist.
function assertChoice1Order(haystack: string, anchors: readonly string[], surface: string): void {
	const positions = anchors.map((p) => haystack.indexOf(p));
	anchors.forEach((p, i) => assert.notEqual(positions[i], -1, `${surface}: missing rc.8 choice-1 anchor: ${JSON.stringify(p)}`));
	for (let i = 1; i < positions.length; i++) {
		assert.ok(positions[i - 1] < positions[i], `${surface}: rc.8 anchor ${i} must precede ${i + 1}; got ${positions}`);
	}
}

const countOccurrences = (haystack: string, needle: string): number => haystack.split(needle).length - 1;

const DELEGATION_CHOICE1_ORDER = [
	"完成跨开放与已关闭 issue 的决定性查证，寻找等价缺陷",
	"仅从其构建串推导其证据通道",
	"若等价项无可验证的相关已发布修复，仅在那个确切的权威/等价 issue 上添加恰好一条只含观察证据的出现次数评论",
	"仅发布到另一证据通道的修复不是本次出现的相关已发布修复",
	"若已安装构建早于该 release，建议安装已发布修复",
	"不再进行任何 GitHub 变更，也不盲目重试",
	"确认的创建要求 GitHub 创建操作确认新创建 issue 的身份",
	"执行下方共享的候选范围延续",
] as const;

// ---------------------------------------------------------------------------
// 1 — assets/orchestrator-delegation.md structural presence
// ---------------------------------------------------------------------------

test("orchestrator-delegation.md carries the provider defect handoff section", () => {
	assert.match(DELEGATION, /#### Jero Provider Defect Handoff \(MANDATORY\)/);
});

test("orchestrator-delegation.md references the prerelease consent/v3 contract", () => {
	assert.match(DELEGATION, /预发布/i);
	assert.match(DELEGATION, /gentle-ai\.review-integration\.consent\/v3/);
});

test("orchestrator-delegation.md lists all three semantic choice tokens", () => {
	for (const token of CHOICE_TOKENS) {
		assert.ok(
			DELEGATION.includes(`\`${token}\``),
			`orchestrator-delegation.md missing semantic choice token: ${token}`,
		);
	}
	assert.match(DELEGATION, /\*\*不报告而继续\*\*：不执行任何 GitHub 检索、写入、评论或打标签，且无需报告侧隐私扫描/);
	assert.match(DELEGATION, /\*\*就此停止\*\*：不执行任何 GitHub 操作，也不执行拒绝调用；保留全部消费者状态并停止/);
});

test("orchestrator-delegation.md orders the three choices: report_and_continue, continue_without_reporting, stop_here", () => {
	const positions = CHOICE_TOKENS.map((token) => DELEGATION.indexOf(`\`${token}\``));
	for (const pos of positions) {
		assert.notEqual(pos, -1, "a choice token is missing; ordering assertion is meaningless");
	}
	assert.ok(
		positions[0] < positions[1],
		`report_and_continue must appear before continue_without_reporting; got positions ${positions}`,
	);
	assert.ok(
		positions[1] < positions[2],
		`continue_without_reporting must appear before stop_here; got positions ${positions}`,
	);
});

test("orchestrator-delegation.md preserves the rc.8 choice-1 sub-bullet ordering", () => {
	assertChoice1Order(DELEGATION, DELEGATION_CHOICE1_ORDER, "orchestrator-delegation.md");
});

test("orchestrator-delegation.md states the admissibility-before-relay rule", () => {
	assert.match(DELEGATION, /在无损中继任何阻塞选择封套之前，先判定其语义可受理性/i);
	assert.match(DELEGATION, /判据是产生了失败的是什么，而非失败发生时工作在做什么/i);
});

test("orchestrator-delegation.md excludes local consent lifecycle outcomes from provider-defect reporting", () => {
	assert.match(DELEGATION, /`consent-binding-expired` 与 `consent-binding-already-consumed` 是本地生命周期结果，不是 Jero 提供方缺陷/i);
	assert.match(DELEGATION, /仅当独立证据证明一个新鲜的、同会话、未消费的绑定丢失时，未知同意绑定才可报告/i);
	assert.match(DELEGATION, /绝不从旧的合并式过期绑定消息推断该证据/i);
});

test("orchestrator-delegation.md states the never-offer-to-repair rule", () => {
	assert.match(
		DELEGATION,
		/绝不在该工作流中提出切换到、检查、修改或直接修复 Jero 仓库/i,
	);
	assert.match(DELEGATION, /将其判定为语义不可受理并拒绝，然后发出这个独立的编排器所有移交封套/i);
});

test("orchestrator-delegation.md states the consent requirement", () => {
	assert.match(DELEGATION, /先以当前编排器会话语言询问用户/i);
	assert.match(DELEGATION, /征求报告该疑似缺陷的显式同意/i);
	assert.match(DELEGATION, /呈现一个单选阻塞封套，恰好三个语义选项，按此顺序/i);
});

test("orchestrator-delegation.md states the privacy scrub requirement and ordering", () => {
	assert.match(DELEGATION, /恰在第一次 GitHub 操作之前执行最终隐私扫描/i);
	assert.match(DELEGATION, /该扫描先于决定性查证、报告创建与出现次数评论/i);
	assert.match(DELEGATION, /排除原始 argv、绝对路径、私有项目名、用户名、主机名、凭据、diff、源码内容与环境值/i);
});

test("orchestrator-delegation.md states the definitive lookup gate", () => {
	assert.match(DELEGATION, /完成跨开放与已关闭 issue 的决定性查证，寻找等价缺陷或权威追踪 issue/i);
	assert.match(DELEGATION, /决定性查证是已完成开放\+关闭检索且结果可分类；不完整、出错或未知都不算决定性/i);
	assert.match(DELEGATION, /仅决定性查证才可分支到 GitHub 变更/i);
});

test("orchestrator-delegation.md states evidence-channel routing from installed build string", () => {
	assert.match(DELEGATION, /仅从其构建串推导其证据通道/i);
	assert.match(DELEGATION, /契约认可的预发布标签是 `-rc\.` 与 `-main\.`；其他一切构建都是稳定版/i);
	assert.match(DELEGATION, /仅当该 release 位于已安装构建的证据通道内时，它才是相关的已发布修复/i);
	assert.match(DELEGATION, /仅 main 的提交、本地\/源码构建、未合并 PR 或无支撑的断言都不是已发布修复证据/i);
});

test("orchestrator-delegation.md states other-channel occurrence routing", () => {
	assert.match(DELEGATION, /仅发布到另一证据通道的修复不是本次出现的相关已发布修复：仅在那个确切的权威\/等价 issue 上添加恰好一条只含观察证据的出现次数评论/i);
	assert.match(DELEGATION, /并注明修复发布于何处/i);
	assert.match(DELEGATION, /不建议切换通道；通道选择权在用户/i);
});

test("orchestrator-delegation.md states outdated-build and regression routing", () => {
	assert.match(DELEGATION, /若已安装构建早于该 release，建议安装已发布修复并复现；暂不为该次出现创建或评论/i);
	assert.match(DELEGATION, /按疑似回归处理：在经证明包含该修复的构建上复现/i);
	assert.match(DELEGATION, /在合适的权威追踪 issue 上评论，或当该追踪 issue 不合适时创建关联的回归 issue/i);
	assert.match(DELEGATION, /绝不自动 reopen/i);
});

test("orchestrator-delegation.md states confirmed-creation identity requirement", () => {
	assert.match(DELEGATION, /确认的创建要求 GitHub 创建操作确认新创建 issue 的身份\/URL/i);
	assert.match(DELEGATION, /绝不仅凭输出文本推断创建成功/i);
});

test("orchestrator-delegation.md states the uncertainty continuation (decline invocation runs, not withheld)", () => {
	assert.match(DELEGATION, /不再进行任何 GitHub 变更，也不盲目重试/i);
	assert.match(
		DELEGATION,
		/恰好一次执行精确捕获的提供方所有拒绝调用，校验它，重入原生协商 STATUS，并恢复已持有的消费者延续/i,
	);
	assert.match(DELEGATION, /在确切的已创建 issue 身份得到解决之前，不要检索、评论、更新或重试创建，然后使用下方的不确定性延续/i);
});

test("orchestrator-delegation.md states the exact-captured-decline-invocation rule", () => {
	assert.match(DELEGATION, /两个继续选项都恰好一次执行那个精确捕获的拒绝调用/i);
	assert.match(DELEGATION, /`gentle-ai\.review-integration\.consent\/v3` 封套中精确捕获的提供方所有 `choices\[answer="declined"\]\.invocation`/i);
	assert.match(
		DELEGATION,
		/绝不由散文合成拒绝命令、目标、令牌或消费者延续/i,
	);
	assert.match(DELEGATION, /保守失败：保留全部消费者状态，且不运行任何替代命令/i);
	assert.match(DELEGATION, /校验 `action: "declined"`、`consent: "declined_this_candidate"` 与精确目标身份匹配/i);
});

test("orchestrator-delegation.md states handoff scope and mode preservation", () => {
	assert.match(DELEGATION, /在本移交内，不得在 clone 或 global 范围调用 `\/jero:review-mode disable`/i);
	assert.match(DELEGATION, /在本移交内，不得开启或关闭 RDD/i);
	assert.match(DELEGATION, /该结果不携带 lineage 或回执；普通交付不受候选选择管理，下一个候选会再次询问/i);
});

test("orchestrator-delegation.md states observed-evidence reporting", () => {
	assert.match(DELEGATION, /报告观察到的证据，而非未经确证的根本原因/i);
	assert.match(DELEGATION, /脱敏后的版本\/构建、OS\/架构\/客户端/i);
	assert.match(DELEGATION, /有界的尝试与结果、失败封套、变更结果/i);
	assert.match(DELEGATION, /预期与实际行为、最小复现/i);
	assert.match(DELEGATION, /安全的不透明原因\/修订标识符，以及保留状态证据/i);
});

test("orchestrator-delegation.md states the resume route (published fix or maintainer-authorized recovery)", () => {
	assert.match(DELEGATION, /仅在已安装的已发布修复，或运行时契约支持的、维护者显式授权且有文档记载的原生恢复或重置之后才恢复/i);
	assert.match(DELEGATION, /用户安装的已发布预发布版或 release candidate 满足此条件/i);
	assert.match(DELEGATION, /绝不对未发布代码恢复：源码 checkout、本地构建或未合并 PR/i);
});

// ---------------------------------------------------------------------------
// 2 — Prohibited stale rc.3-era rules (must NOT survive in the handoff)
// ---------------------------------------------------------------------------

test("orchestrator-delegation.md does NOT carry the gentle-report label discipline", () => {
	assert.equal(
		DELEGATION.includes("gentle-report"),
		false,
		"the v2.4.0-rc.8 handoff removed the gentle-report label discipline; the string must not appear",
	);
});

test("orchestrator-delegation.md does NOT make published fixes the sole resumption route", () => {
	assert.equal(
		DELEGATION.includes("Resume only after an installed published fix"),
		false,
		"rc.8 prohibits 'Resume only after an installed published fix' as the sole resumption route",
	);
	assert.equal(
		DELEGATION.includes("latest version"),
		false,
		"rc.8 prohibits 'latest version' wording in the handoff",
	);
});

test("orchestrator-delegation.md does NOT retain the rc.3 hard-stop that withholds the decline invocation", () => {
	assert.equal(
		DELEGATION.includes("Any report ambiguity or failure is a hard stop: preserve all consumer state and do not execute the decline invocation"),
		false,
		"rc.8 replaced the rc.3 hard-stop wedge with the uncertainty continuation that executes the decline invocation",
	);
});

test("orchestrator-delegation.md does NOT reference the rc.3 canon", () => {
	assert.equal(DELEGATION.includes("v2.4.0-rc.3"), false, "stale rc.3 version reference must be removed");
	assert.equal(DELEGATION.includes("gentle-ai#2060"), false, "stale rc.3 issue reference must be removed");
});

// ---------------------------------------------------------------------------
// 3 — SDD points to the single complete handoff contract
// ---------------------------------------------------------------------------

test("sdd-orchestrator-workflow.md points provider defects to the complete delegation contract", () => {
	assert.match(SDD_WORKFLOW, /## Provider Defect Handoff/);
	assert.match(
		SDD_WORKFLOW,
		/完整契约位于 `assets\/orchestrator-delegation\.md` 的 `#### Jero Provider Defect Handoff \(MANDATORY\)`/i,
	);
	assert.match(DELEGATION, /^#### Jero Provider Defect Handoff \(MANDATORY\)$/m);
	assert.doesNotMatch(SDD_WORKFLOW, /`report_and_continue`|`continue_without_reporting`|`stop_here`/);
});

test("the complete delegation handoff invokes `/jero:review-mode disable` exactly once", () => {
	const section = DELEGATION.match(
		/#### Jero Provider Defect Handoff[\s\S]*?(?=\n#### SDD Edit-Authority|$)/,
	)?.[0] ?? "";
	assert.ok(section.length > 0, "orchestrator-delegation.md: provider defect handoff section not found");
	assert.equal(countOccurrences(section, "/jero:review-mode disable"), 1);
});
