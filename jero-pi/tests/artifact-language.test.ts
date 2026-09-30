import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { dirname, extname, join, relative } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
	renderSddPreflightPrompt,
	type SddPreflightPreferences,
} from "../lib/sdd-preflight.ts";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const TEXT_EXTENSIONS = new Set([".md", ".ts", ".mjs", ".json"]);

async function collectTextFiles(dir: string): Promise<string[]> {
	const entries = await readdir(dir, { withFileTypes: true });
	const files: string[] = [];
	for (const entry of entries) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) {
			files.push(...(await collectTextFiles(path)));
			continue;
		}
		if (entry.isFile() && TEXT_EXTENSIONS.has(extname(entry.name))) {
			files.push(path);
		}
	}
	return files;
}

const SPANISH_PREFLIGHT_COPY = [
	/Antes de continuar con SDD/i,
	/Antes de seguir con SDD/i,
	/una opci[oó]n por grupo/i,
	/usar recomendad[oa]/i,
	/\bRitmo\b/i,
	/\bArtefactos\b/i,
	/\bPreguntarme\b/i,
	/l[ií]neas cambiadas/i,
	/\bhacelo\b/i,
	/\bSoy el Jero\b/i,
];

test("orchestrator keeps conversation language separate from generated artifact language", async () => {
	const orchestrator = await readFile(join(ROOT, "assets/orchestrator.md"), "utf8");

	// persona-single-channel: the conversation-language rule (previously a duplicated
	// LB1 sentence here) now lives once, in the wrapper block (jero-ai.ts), and this
	// section only carries a one-line pointer back to it. (i18n pass: the asset is
	// Simplified Chinese now, with the artifact-language contract flipped to a
	// Chinese default.)
	assert.match(
		orchestrator,
		/回复语言风格与当前 persona 的中文变体已在上方身份\/harness 段（其 `Current persona mode:` 行）一次性定义/,
	);
	assert.match(
		orchestrator,
		/生成式技术产物[\s\S]*默认使用简体中文，与用户会话语言或当前 persona 无关/,
	);
	for (const artifactScope of ["代码注释", "测试", "fixture", "委托的阶段输出"]) {
		assert.match(orchestrator, new RegExp(artifactScope));
	}
	assert.match(
		orchestrator,
		/公开\/情境性评论与回复[\s\S]*默认使用目标上下文语言/,
	);
});

test("rendered SDD preflight prompt is English artifact copy", () => {
	const prefs: SddPreflightPreferences = {
		executionMode: "interactive",
		artifactStore: "openspec",
		chainedPrStrategy: "ask-on-risk",
		reviewBudgetLines: 400,
		engramAvailable: false,
		prompted: true,
	};
	const prompt = renderSddPreflightPrompt(prefs);

	assert.match(prompt, /These SDD preferences are explicit current-session choices/);
	assert.match(prompt, /Delivery strategy: ask-on-risk/);
	assert.match(prompt, /Review budget: 400 changed lines/);
	assert.match(prompt, /complete only the current SDD phase/i);
	assert.match(prompt, /Do not start the next SDD phase/i);
	assert.match(prompt, /approve only the immediate next phase/i);
	assert.match(prompt, /offer the user a proposal question round/i);
	assert.match(prompt, /business rules, implications, impact, edge cases/i);
	// 多轮语义与资产文本对齐：持续作答即持续追问、直到用户停止或无开放分支。
	assert.match(prompt, /another question round/i);
	assert.match(prompt, /continue question rounds until the user stops/i);
	assert.match(prompt, /explicit acceptance of `size:exception`/);
	assert.match(prompt, /human-controlled consent, authorization, security, destructive\/publishing/);
	for (const pattern of SPANISH_PREFLIGHT_COPY) {
		assert.doesNotMatch(prompt, pattern);
	}

	const headless = renderSddPreflightPrompt({ ...prefs, executionMode: "auto", prompted: false });
	assert.match(headless, /canonical defaults or persisted choices/);
	assert.match(headless, /ambiguous-scope/);
});

test("orchestrator Memory Contract carries the jero-pi memory staleness rule", async () => {
	// orchestrator-lazy-diet: the rule lives in assets/orchestrator-memory.md;
	// core keeps only the intro + pointer. Union read so this assertion is
	// repointed, not weakened. jero-pi's built-in mem_* store replaced the
	// external Engram provider and has no lifecycle tooling, so the rule pins
	// staleness discipline instead of provider actions: list before relying,
	// treat out-of-date entries as stale, never claim lifecycle actions that
	// do not exist.
	const orchestrator =
		(await readFile(join(ROOT, "assets/orchestrator.md"), "utf8")) +
		(await readFile(join(ROOT, "assets/orchestrator-memory.md"), "utf8"));

	for (const required of [
		"jero-pi 内置记忆无生命周期工具",
		"不携带评审生命周期元数据或工具",
		"再次保存同一主题即替换该条目（last write wins）",
		"在会话开始或架构敏感工作之前，用 `mem_list` 列出当前项目的主题",
		"把过时记忆当作过期上下文，而非可信事实",
		"向用户呈现该过期上下文，并在依赖它之前对照当前证据验证",
		"不存在 `mark_reviewed` 动作，也没有记忆维护命令",
		"绝不声称已标记、评审、提升或过期某个记忆条目",
	]) {
		assert.ok(
			orchestrator.includes(required),
			`orchestrator.md missing memory staleness rule: ${required}`,
		);
	}
});

test("SDD proposal questions focus on business and PRD gaps", async () => {
	const proposalAgent = await readFile(join(ROOT, "assets/agents/sdd-proposal.md"), "utf8");

	assert.match(proposalAgent, /向用户提供一轮提案问题/);
	assert.match(proposalAgent, /第二轮提问/);
	assert.match(proposalAgent, /业务问题/);
	assert.match(proposalAgent, /业务规则/);
	assert.match(proposalAgent, /影响与冲击/);
	assert.match(proposalAgent, /边界情形/);
	assert.match(proposalAgent, /目标用户/);
	assert.match(proposalAgent, /产品成果/);
	assert.match(proposalAgent, /决策缺口/);
	// grilling 借鉴批（纯文本强化）：问题必须从证据与先前答案派生、
	// 按"会否改变提案走向"取舍而非面面俱到；术语沉淀为共享语言小节随提案沉淀。
	assert.match(proposalAgent, /从探索结果、研究断言与用户已给出的信息中派生/);
	assert.match(proposalAgent, /## 共享语言/);
	// Proposal-shaping questions must stay on business/product ground: the agent is
	// explicitly told to keep harness mechanics out of the proposal question round
	// unless the user opts into discussing delivery. Removing this guard is the most
	// likely way harness mechanics would leak back into proposal questions.
	// (i18n pass: the asset is Simplified Chinese now.)
	assert.match(
		proposalAgent,
		/除非用户明确要求讨论交付，否则不要询问测试命令、PR 形态、改动行数预算或其他测试机制决策/,
	);
});

test("SDD sync/archive/remediate carry the knowledge-deposit and repeat-offender copy", async () => {
	// grilling/CONTEXT.md/ADR/non-goal-retrospective/build-eval 借鉴批：
	// 写入侧归 sync（术语表 + 决策记录 + 非目标，追加式、非破坏），
	// 读取侧由已确立规范索引自动发现——这里钉住三份资产的关键文案。
	const sync = await readFile(join(ROOT, "assets/agents/sdd-sync.md"), "utf8");
	assert.match(sync, /## 知识沉淀回写/);
	assert.match(sync, /openspec\/specs\/glossary\/spec\.md/);
	assert.match(sync, /openspec\/specs\/decisions\/spec\.md/);
	assert.match(sync, /## 决策记录/);
	assert.match(sync, /## 非目标记录/);
	assert.match(sync, /### DR-YYYY-MM-DD: \{标题\}/);
	assert.match(sync, /绝不改写既有条目/);

	const archive = await readFile(join(ROOT, "assets/agents/sdd-archive.md"), "utf8");
	assert.match(archive, /## 归档回顾/);
	assert.match(archive, /project\/non-goals/);
	assert.match(archive, /project\/repeat-offenders/);
	assert.match(archive, /先 `mem_read` 既有主题再合并保存/);

	const remediate = await readFile(join(ROOT, "assets/agents/sdd-remediate.md"), "utf8");
	assert.match(remediate, /重复 offender 纪律/);
	assert.match(remediate, /project\/repeat-offenders/);
	// 借鉴 build-eval 但守住边界：remediate 只提议可执行检查，绝不自行改测试套件。
	assert.match(remediate, /绝不自行向项目测试套件添加检查/);
});

test("SDD tasks/apply/verify/archive carry the per-task verify command and traceability copy", async () => {
	// bigpowers 借鉴批（量化与追溯）：任务级 verify: 命令由 tasks 定死，
	// apply 执行、verify 复核、archive 生成追溯矩阵与周期校准——四段闭环。
	const tasks = await readFile(join(ROOT, "assets/agents/sdd-tasks.md"), "utf8");
	assert.match(tasks, /<!-- verify: pnpm test -- tests\/foo\.test\.ts -->/);
	assert.match(tasks, /<!-- verify: manual -->/);
	assert.match(tasks, /命令必须一行可运行、确定性退出码、不发起网络请求/);
	assert.match(tasks, /验证期不得改写/);
	assert.match(tasks, /## Size Estimate/);

	const apply = await readFile(join(ROOT, "assets/agents/sdd-apply.md"), "utf8");
	assert.match(apply, /<!-- verify: \.\.\. -->/);
	assert.match(apply, /Task Verify Evidence/);
	assert.match(apply, /started: <ISO 8601>/);
	// 时间戳只补不改：续接场景保留最早开工时间。
	assert.match(apply, /不改写既有时间戳/);

	const verify = await readFile(join(ROOT, "assets/agents/sdd-verify.md"), "utf8");
	assert.match(verify, /任务级验证命令复核/);
	assert.match(verify, /勾选与证据矛盾/);
	assert.match(verify, /遗留任务产物无命令注释时不阻塞/);

	const archive = await readFile(join(ROOT, "assets/agents/sdd-archive.md"), "utf8");
	assert.match(archive, /## 追溯矩阵/);
	assert.match(archive, /traceability\.md/);
	assert.match(archive, /untraced/);
	assert.match(archive, /orphan/);
	assert.match(archive, /绝不为了矩阵整洁而补造映射/);
	assert.match(archive, /周期与估点校准/);
});

test("diagnose-stall skill, design threat model, and spike discipline stay pinned", async () => {
	// bigpowers 借鉴批（诊断与防御）：停滞分诊技能 + 路由表条目同步、
	// 设计期可选威胁建模（不新增门禁）、抛弃式原型纪律（代码即弃）。
	const skill = await readFile(join(ROOT, "skills/jero-diagnose-stall/SKILL.md"), "utf8");
	assert.match(skill, /诊断是只读的/);
	assert.match(skill, /绝不替编排器做状态转移/);
	assert.match(skill, /未分类/);

	const router = await readFile(join(ROOT, "skills/jero-skills/SKILL.md"), "utf8");
	assert.match(router, /jero-diagnose-stall/);

	const design = await readFile(join(ROOT, "assets/agents/sdd-design.md"), "utf8");
	assert.match(design, /## 事前威胁建模（安全敏感时）/);
	assert.match(design, /## Threat Model/);
	assert.match(design, /非安全敏感变更省略本节/);
	assert.match(design, /不新增任何门禁/);

	const discipline = await readFile(join(ROOT, "docs/how-to-choose-discipline.md"), "utf8");
	assert.match(discipline, /抛弃式原型（spike）/);
	assert.match(discipline, /绝不合并、绝不转正/);
	assert.match(discipline, /spike 的产出是答案，不是代码/);
});

test("all shipped SDD agents and chains require parent preflight transport", async () => {
	const agents = [
		"sdd-init", "sdd-onboard", "sdd-explore", "sdd-research", "sdd-proposal", "sdd-spec", "sdd-design",
		"sdd-tasks", "sdd-status", "sdd-apply", "sdd-verify", "sdd-sync", "sdd-archive", "sdd-remediate",
	];
	const chains = ["sdd-full", "sdd-plan", "sdd-verify"];
	assert.equal(agents.length, 14);
	assert.equal(chains.length, 3);
	for (const agent of agents) {
		const source = await readFile(join(ROOT, "assets", "agents", `${agent}.md`), "utf8");
		assert.match(source, /## Parent Preflight Transport/);
		assert.match(source, /被委托的 RPC 子代理绝不确认或持久化 SDD 选择/);
		assert.doesNotMatch(source, /(?:infer|synthesize) (?:a )?(?:preflight )?(?:confirmation|defaults?) yourself/i);
	}
	for (const chain of chains) {
		const source = await readFile(join(ROOT, "assets", "chains", `${chain}.chain.md`), "utf8");
		assert.match(source, /## Parent preflight transport guard/);
		assert.match(source, /Missing or malformed transport blocks the chain before its first phase/);
	}
});

test("SDD chain assets distinguish interactive gates from auto execution", async () => {
	const planChain = await readFile(join(ROOT, "assets/chains/sdd-plan.chain.md"), "utf8");
	const fullChain = await readFile(join(ROOT, "assets/chains/sdd-full.chain.md"), "utf8");

	assert.match(planChain, /自动模式或显式的全规划批准/);
	assert.match(planChain, /交互模式/);
	assert.match(planChain, /必须在 sdd-proposal 之后停下/);
	assert.match(fullChain, /自动模式或显式的全生命周期批准/);
	assert.match(fullChain, /交互模式/);
	assert.match(fullChain, /必须在每个阶段边界停下/);
});

test("orchestrator lazy-loads detailed SDD workflow", async () => {
	const orchestrator = await readFile(join(ROOT, "assets/orchestrator.md"), "utf8");
	const workflow = await readFile(join(ROOT, "assets/sdd-orchestrator-workflow.md"), "utf8");

	assert.match(orchestrator, /## SDD 工作流（懒加载）/, "i18n pass");
	assert.doesNotMatch(orchestrator, /## SDD Workflow \(lazy-loaded\)/);
	assert.match(orchestrator, /包资产根目录：`\{\{JERO_PI_ASSETS_ROOT\}\}`。下方懒加载资产路径均相对该根目录。/);
	assert.match(orchestrator, /`sdd-orchestrator-workflow\.md`/);
	assert.doesNotMatch(orchestrator, /\{\{JERO_PI_SDD_WORKFLOW_PATH\}\}/);
	assert.match(orchestrator, /注入的 `## SDD Session Preflight` 块或权威方裁决/);
	assert.match(orchestrator, /默认值与能力约束可以在无确认提示的情况下裁决字段/);
	assert.doesNotMatch(orchestrator, /or an explicit user answer covering the preflight choices/);
	assert.doesNotMatch(orchestrator, /## Native SDD Dispatcher/);
	assert.match(workflow, /## 原生 SDD 派发器/);
	assert.match(workflow, /## SDD 状态契约/);
	assert.match(workflow, /## 执行模式/);
	assert.match(workflow, /## Strict TDD 转发/);
	assert.match(workflow, /## 评审负载守卫/);
	assert.match(workflow, /## 结果契约/);
});

test("persistent harness prompt assets do not hardcode Spanish SDD artifact copy", async () => {
	const files = [
		...(await collectTextFiles(join(ROOT, "assets"))),
		...(await collectTextFiles(join(ROOT, "prompts"))),
	];
	const failures: string[] = [];

	for (const file of files) {
		const text = await readFile(file, "utf8");
		for (const pattern of SPANISH_PREFLIGHT_COPY) {
			if (pattern.test(text)) {
				failures.push(`${relative(ROOT, file)} matched ${pattern}`);
			}
		}
	}

	assert.deepEqual(failures, []);
});

test("SDD assets route completed implementation directly through verify, sync, and archive", async () => {
	const [tasks, apply, status, contract, chain] = await Promise.all([
		readFile(join(ROOT, "assets/agents/sdd-tasks.md"), "utf8"),
		readFile(join(ROOT, "assets/agents/sdd-apply.md"), "utf8"),
		readFile(join(ROOT, "assets/agents/sdd-status.md"), "utf8"),
		readFile(join(ROOT, "assets/support/sdd-status-contract.md"), "utf8"),
		readFile(join(ROOT, "assets/chains/sdd-full.chain.md"), "utf8"),
	]);
	const assets = [tasks, apply, status, contract, chain].join("\n");

	assert.match(tasks, /<!-- sdd-owner: implementation -->/);
	assert.match(apply, /next_recommended: "sdd-verify"/);
	assert.match(status, /jero-ai\.sdd-status.*v2/i);
	assert.match(status, /read-only/i);
	assert.match(contract, /(?:sdd-apply|sdd-verify)[\s\S]*归档/);
	assert.match(contract, /Manual `sdd-sync` remains its intentional local resolver/);
	assert.match(chain, /apply -> verify -> sync -> archive/);
	assert.doesNotMatch(assets, /<!-- sdd-owner: parent -->/);
	assert.doesNotMatch(assets, /parent-lifecycle/);
	assert.doesNotMatch(assets, /approved receipt|bounded review/i);
	assert.doesNotMatch(chain, /## sdd-review/);
});

test("comment-writer is context-reactive and neutral by default for Chinese comments", async () => {
	const skill = await readFile(join(ROOT, "skills/comment-writer/SKILL.md"), "utf8");

	for (const required of [
		"target context language",
		"explicitly requests a language",
		"neutral/professional Simplified Chinese by default",
	]) {
		assert.match(skill, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
	}

	for (const casualChinese of [
		/绝绝子/,
		/\byyds\b/i,
		/老铁/,
		/咋/,
		/俺/,
		/整活/,
	]) {
		assert.doesNotMatch(skill, casualChinese);
	}

	for (const englishExample of [
		"Good approach overall",
		"Approved. The scope is clear",
		"This PR exceeds the 400-line budget",
	]) {
		assert.match(skill, new RegExp(englishExample.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
	}
});
