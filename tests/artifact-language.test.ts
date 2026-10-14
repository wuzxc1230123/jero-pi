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

test("rendered SDD preflight prompt is Chinese prompt copy", () => {
	const prefs: SddPreflightPreferences = {
		executionMode: "interactive",
		artifactStore: "openspec",
		chainedPrStrategy: "ask-on-risk",
		reviewBudgetLines: 400,
		engramAvailable: false,
		prompted: true,
	};
	const prompt = renderSddPreflightPrompt(prefs);

	assert.match(prompt, /这些 SDD 偏好是本次会话的显式选择。除非用户明确变更，直接复用。/);
	assert.match(prompt, /交付策略：ask-on-risk/);
	assert.match(prompt, /评审预算：400 变更行/);
	assert.match(prompt, /只完成当前 SDD 阶段/);
	assert.match(prompt, /不得开始下一阶段/);
	assert.match(prompt, /只批准紧邻的下一阶段/);
	assert.match(prompt, /先向用户提供一轮提案问题/);
	assert.match(prompt, /业务规则、隐含影响、波及面、边界情况/);
	// 多轮语义与资产文本对齐：持续作答即持续追问、直到用户停止或无开放分支。
	assert.match(prompt, /再来一轮/);
	assert.match(prompt, /直到用户停止或不再存在会改变提案的开放分支/);
	assert.match(prompt, /对 `size:exception` 的显式接受/);
	assert.match(prompt, /同意、授权、安全、破坏性\/发布、歧义范围/);
	// 提示词全面中文化后，旧英文文案与西语仿制品同样不得回流。
	for (const stale of [/These SDD preferences/, /Execution mode:/, /Delivery strategy:/, /Review budget: 400 changed lines/]) {
		assert.doesNotMatch(prompt, stale);
	}
	for (const pattern of SPANISH_PREFLIGHT_COPY) {
		assert.doesNotMatch(prompt, pattern);
	}

	const headless = renderSddPreflightPrompt({ ...prefs, executionMode: "auto", prompted: false });
	assert.match(headless, /规范默认值或已持久化的选择/);
	assert.match(headless, /歧义范围/);
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
	assert.match(tasks, /## 任务行解剖/);

	const apply = await readFile(join(ROOT, "assets/agents/sdd-apply.md"), "utf8");
	assert.match(apply, /<!-- verify: \.\.\. -->/);
	assert.match(apply, /Task Verify Evidence/);
	assert.match(apply, /started: <ISO 8601>/);
	// 时间戳只补不改：续接场景保留最早开工时间。
	assert.match(apply, /不改写既有时间戳/);
	// 冲突修复批：P0 不得配 manual；manifest 是增补而非替代必需输入。
	assert.match(tasks, /P0 任务的 `verify` 不得为 `manual`/);
	assert.match(tasks, /尚无 `## Threat Model` 时在报告中标注回补/);

	const verify = await readFile(join(ROOT, "assets/agents/sdd-verify.md"), "utf8");
	assert.match(verify, /任务级验证命令复核/);
	assert.match(verify, /勾选与证据矛盾/);
	assert.match(verify, /遗留任务产物无命令注释时不阻塞/);
	// 冲突修复批：P0 必须机器断言（manual 也算完整性问题）；
	// 复核小节改名避免与 apply-progress 的 Task Verify Evidence 表同名。
	assert.match(verify, /无命令注释或仅标 `manual` 的 P0 任务列为完整性问题/);
	assert.match(verify, /Task Verify Recheck/);

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

test("plan-time risk grading stays pinned across tasks, verify, and discipline doc", async () => {
	// bigpowers 借鉴批（计划期风险分级）：后果轴与体量轴正交，
	// 级别只调节验证深度，绝不调节预算或替代评审轴决策。
	const tasks = await readFile(join(ROOT, "assets/agents/sdd-tasks.md"), "utf8");
	assert.match(tasks, /## 任务风险分级（P0–P3）/);
	assert.match(tasks, /<!-- risk: P1 -->/);
	assert.match(tasks, /与评审预算的\*\*体量轴\*\*正交/);
	assert.match(tasks, /未标记任务的默认级/);
	assert.match(tasks, /就高不就低/);

	const verify = await readFile(join(ROOT, "assets/agents/sdd-verify.md"), "utf8");
	assert.match(verify, /## 风险感知复核深度/);
	assert.match(verify, /无命令注释或仅标 `manual` 的 P0 任务列为完整性问题/);
	assert.match(verify, /绝不因缺标记阻塞/);
	assert.match(verify, /也不绕过任何既有门禁/);

	const discipline = await readFile(join(ROOT, "docs/how-to-choose-discipline.md"), "utf8");
	assert.match(discipline, /### 任务风险分级（P0–P3）/);
	assert.match(discipline, /威胁建模部分重叠，缺模时回补标注/);
});

test("context manifest and bootstrap receipt stay pinned", async () => {
	// Trellis 借鉴批：任务级上下文清单（读取≠编辑许可）+ 注入回执（一次性确认）。
	const tasks = await readFile(join(ROOT, "assets/agents/sdd-tasks.md"), "utf8");
	assert.match(tasks, /## 上下文清单（Context Manifest）/);
	assert.match(tasks, /\| 消费者 \| 路径 \| 理由 \|/);
	assert.match(tasks, /绝不构成编辑许可/);

	const apply = await readFile(join(ROOT, "assets/agents/sdd-apply.md"), "utf8");
	assert.match(apply, /`apply` 行是必需产物之外的增补实现上下文/);
	assert.match(apply, /绝不扩大编辑面/);
	assert.match(apply, /清单绝不豁免记忆契约的必需输入/);

	const verify = await readFile(join(ROOT, "assets/agents/sdd-verify.md"), "utf8");
	assert.match(verify, /`verify` 行是必需产物之外的增补验证上下文/);

	// 回执指令钉在 lib 注入文本里：语言跟随、中性回退、一次性。
	const bootstrapSource = await readFile(join(ROOT, "lib/jero-ai-bootstrap.ts"), "utf8");
	assert.match(bootstrapSource, /注入回执（一次性）/);
	assert.match(bootstrapSource, /jero bootstrap ✓/);
	assert.match(bootstrapSource, /除此之外不重复/);

	// 审计修复批：回执可经 JERO_PI_BOOTSTRAP_RECEIPT 摘除；tutorial 补可选增强一节。
	assert.match(bootstrapSource, /JERO_PI_BOOTSTRAP_RECEIPT/);
	const tutorial = await readFile(join(ROOT, "docs/tutorial-first-review.md"), "utf8");
	assert.match(tutorial, /## 6\. 可选增强/);
	assert.match(tutorial, /JERO_PI_BOOTSTRAP_RECEIPT=0/);
	assert.match(tutorial, /jero-diagnose-stall/);
});

test("architecture patrol skill and router entry stay pinned", async () => {
	// mattpocock/bigpowers 借鉴批（架构巡检）：只读幂等六轴巡检，
	// 发现走 SDD 立变更，绝不直接重构、绝不自我触发。
	const skill = await readFile(join(ROOT, "skills/jero-architecture-patrol/SKILL.md"), "utf8");
	assert.match(skill, /巡检是只读的/);
	assert.match(skill, /深模块机会（Ousterhout）/);
	assert.match(skill, /幂等纪律/);
	assert.match(skill, /openspec\/specs\/glossary\//);
	assert.match(skill, /绝不自我触发/);
	// 可视化批（借鉴 mattpocock HTML-REPORT）：发现 ≥3 或用户要求时另产自包含 HTML 报告。
	assert.match(skill, /references\/html-report\.md/);
	const htmlReport = await readFile(join(ROOT, "skills/jero-architecture-patrol/references/html-report.md"), "utf8");
	assert.match(htmlReport, /前\/后对比图/);
	assert.match(htmlReport, /质量图/);
	assert.match(htmlReport, /调用图坍缩/);
	assert.match(htmlReport, /词汇纪律/);
	// 优化批一（2026-10-14）：报告生成后三道自检断言，不带病交付。
	assert.match(htmlReport, /## 生成后自检/);
	assert.match(htmlReport, /不带病交付/);
	assert.match(htmlReport, /锚点可达/);

	const router = await readFile(join(ROOT, "skills/jero-skills/SKILL.md"), "utf8");
	assert.match(router, /jero-architecture-patrol/);

	const discipline = await readFile(join(ROOT, "docs/how-to-choose-discipline.md"), "utf8");
	assert.match(discipline, /jero-architecture-patrol/);
});

test("cross-surface conflict fixes stay pinned", async () => {
	// 四代理评审的交叉面修复批：P2 复核量词收窄、轻量归档豁免、
	// 威胁建模真实消费者、回顾五类（2026-10-14 增漂移遥测实效）、
	// P0+manual 提前拦截、`?` 行双侧规则。
	const verify = await readFile(join(ROOT, "assets/agents/sdd-verify.md"), "utf8");
	assert.match(verify, /重跑范围由「风险感知复核深度」节裁定/);
	assert.match(verify, /apply 进度的 `Task Verify Evidence` 表是其执行证据，仅抽查存疑项/);
	assert.match(verify, /对照威胁清单检查实现未打穿缓解/);

	const archive = await readFile(join(ROOT, "assets/agents/sdd-archive.md"), "utf8");
	assert.match(archive, /「不适用」的 `not_applicable` sync-report 即满足本条件/);
	assert.match(archive, /提取五类回顾/);
	assert.match(archive, /漂移遥测实效）；/);
	assert.match(archive, /绝不倒推补造/);
	assert.match(archive, /轻量路径下术语沉淀的唯一兜底/);

	const apply = await readFile(join(ROOT, "assets/agents/sdd-apply.md"), "utf8");
	assert.match(apply, /按格式冲突报告并以 `blocked` 停止/);
	assert.match(apply, /绝不打穿显式缓解/);

	const design = await readFile(join(ROOT, "assets/agents/sdd-design.md"), "utf8");
	assert.match(design, /评审 risk 透镜以候选视图为准，不直接读该产物/);

	const tasks = await readFile(join(ROOT, "assets/agents/sdd-tasks.md"), "utf8");
	assert.match(tasks, /触发信号部分重叠/);
	assert.match(tasks, /`\?` 行不计入 Total/);
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
		assert.match(source, /## 父会话预检传输/);
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
	assert.match(orchestrator, /注入的 `## SDD 会话预检` 块或权威方裁决/);
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
	assert.match(status, /只读/);
	assert.match(contract, /(?:sdd-apply|sdd-verify)[\s\S]*归档/);
	assert.match(contract, /手工 `sdd-sync` 有意保留其本地解析器/);
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

test("skills-main 借鉴批：拷问前沿/推荐答案、红回路、非目标概念键、项目规范优先、合并危险、issue 耐用性", async () => {
	// 保持 SDD 流程结构不变的纯文本强化批。六个落点：
	// 拷问术三机制（前沿轮次 + 推荐答案 + 事实/决策分工）、紧反馈回路前置、
	// 非目标概念键去重（sync 写侧 + 提案前门读侧）、评审透镜消费项目声明规范、
	// PR 合并危险段（单向/双向门 + 爆炸半径）、issue 正文耐用性。
	const workflow = await readFile(join(ROOT, "assets/sdd-orchestrator-workflow.md"), "utf8");
	assert.match(workflow, /每轮只问前沿/);
	assert.match(workflow, /推荐答案，措辞让"同意"即采纳推荐/);
	assert.match(workflow, /绝不当作产品问题抛给用户/);
	assert.match(workflow, /按概念相似度匹配/);
	assert.match(workflow, /已拒绝的方向绝不静默重启/);
	// 上下文卫生批（借鉴 mattpocock PHASE-BOUNDARIES）：五选一有序决策树只在阶段边界裁决。
	assert.match(workflow, /## 阶段边界与上下文预算/);
	assert.match(workflow, /压缩是\*\*兜底不是首选\*\*/);
	assert.match(workflow, /绝不在阶段中段压缩/);

	const proposalAgent = await readFile(join(ROOT, "assets/agents/sdd-proposal.md"), "utf8");
	assert.match(proposalAgent, /每轮只问前沿/);
	assert.match(proposalAgent, /推荐答案，措辞让"同意"即采纳推荐/);
	assert.match(proposalAgent, /绝不当作产品问题抛给用户/);

	const designAgent = await readFile(join(ROOT, "assets/agents/sdd-design.md"), "utf8");
	assert.match(designAgent, /契约描述写类型与行为约束/);
	assert.match(designAgent, /行号与易变路径会让沉淀过期/);

	const remediate = await readFile(join(ROOT, "assets/agents/sdd-remediate.md"), "utf8");
	assert.match(remediate, /紧反馈回路纪律/);
	assert.match(remediate, /跑红过至少一次/);
	assert.match(remediate, /没有红回路不开始修复/);

	const sync = await readFile(join(ROOT, "assets/agents/sdd-sync.md"), "utf8");
	assert.match(sync, /kebab-case 概念键/);
	assert.match(sync, /不重复开条/);

	for (const lens of ["review-readability", "review-reliability", "review-resilience", "review-risk"]) {
		const agent = await readFile(join(ROOT, `assets/agents/${lens}.md`), "utf8");
		assert.match(agent, /项目声明规范优先/, `${lens} must prefer declared repo standards`);
		assert.match(agent, /rules\.review/);
	}

	const prTemplate = await readFile(join(ROOT, "skills/branch-pr/references/pr-template.md"), "utf8");
	assert.match(prTemplate, /### 7\. 合并危险（必填）/);
	assert.match(prTemplate, /\*\*合并门：\*\*单向 \/ 双向/);
	assert.match(prTemplate, /\*\*爆炸半径：\*\*/);
	assert.match(prTemplate, /PR 正文七段格式/);

	const chainDetails = await readFile(join(ROOT, "skills/chained-pr/references/chaining-details.md"), "utf8");
	assert.match(chainDetails, /\| Merge door \|/);
	assert.match(chainDetails, /\| Blast radius \|/);

	const issueSkill = await readFile(join(ROOT, "skills/issue-creation/SKILL.md"), "utf8");
	assert.match(issueSkill, /## 正文耐用性/);
	assert.match(issueSkill, /不引用行号/);
	assert.match(issueSkill, /独立可核验/);
});

test("spec_driven_develop borrow batch stays pinned: drift telemetry, lane admission, structural checklist, lens noise floor", async () => {
	// spec_driven_develop 借鉴批（执行遥测与评审降噪）：
	// apply 期三档漂移阈值停链、并行车道四条硬准入与单一写者、
	// verify 结构二值清单（不打分）、四透镜共享降噪下限。
	const workflow = await readFile(join(ROOT, "assets/sdd-orchestrator-workflow.md"), "utf8");
	assert.match(workflow, /## 执行漂移遥测/);
	assert.match(workflow, /`ceil\(任务数 × 0\.20\)`/);
	assert.match(workflow, /编排器绝不因遥测自行改路由/);

	const delegation = await readFile(join(ROOT, "assets/orchestrator-delegation.md"), "utf8");
	assert.match(delegation, /### 并行车道准入与单一写者/);
	assert.match(delegation, /车道数 ≤ 4/);
	assert.match(delegation, /车道代理绝不写共享状态/);

	const verify = await readFile(join(ROOT, "assets/agents/sdd-verify.md"), "utf8");
	assert.match(verify, /## 结构二值清单/);
	assert.match(verify, /只记二值结果，不打分、不排名/);
	assert.match(verify, /3\+ 项失败/);

	for (const lens of ["review-readability", "review-reliability", "review-resilience", "review-risk"]) {
		const agent = await readFile(join(ROOT, `assets/agents/${lens}.md`), "utf8");
		assert.match(agent, /纯文档、仅格式化、生成物或锁文件扰动/, `${lens} must keep the shared noise floor`);
		assert.match(agent, /宁可一条确定性发现，不要多条弱建议/);
	}

	const discipline = await readFile(join(ROOT, "docs/how-to-choose-discipline.md"), "utf8");
	assert.match(discipline, /执行漂移遥测兜底/);
	assert.match(discipline, /计划跟不上现实时/);
});

test("spec_driven_develop borrow batch round 3 stays pinned: remediate verdict, answer audit gate, chain split dimensions", async () => {
	// spec_driven_develop 借鉴批第三轮（修复闭环与回答纪律）：
	// remediate 结果裁决三态、R1 问题审查门、链式拆分四维裁切。
	const remediate = await readFile(join(ROOT, "assets/agents/sdd-remediate.md"), "utf8");
	assert.match(remediate, /`remediate_verdict: fixed \| verified-clean \| escalate`/);
	assert.match(remediate, /从属于宿主尝试权威的结算字段/);
	assert.match(remediate, /不是失败证据，是显式上交/);

	const tasks = await readFile(join(ROOT, "assets/agents/sdd-tasks.md"), "utf8");
	assert.match(tasks, /拆分边界按四个维度裁切/);
	assert.match(tasks, /回滚边界优先/);

	const delegation = await readFile(join(ROOT, "assets/orchestrator-delegation.md"), "utf8");
	assert.match(delegation, /##### R1 回答纪律（问题审查门）/);
	assert.match(delegation, /不成立时直说并给理由/);
	assert.match(delegation, /最终选择权留给用户/);
});
