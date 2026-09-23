import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { __testing } from "../extensions/jero-ai.ts";

// ---------------------------------------------------------------------------
// persona-single-channel migration test
//
// Freezes the pre-change wrapper (jero-ai.ts) and orchestrator.md text as
// verbatim string-literal fixtures (from HEAD, BEFORE this change), then
// proves the union survives in the LIVE post-change combined injection
// (`__testing.buildGentlePrompt(persona)`, which calls `getOrchestratorPrompt()`
// internally and reads `assets/orchestrator.md` from disk, memoized for the
// lifetime of the process — see jero-ai.ts:118-133).
//
// DO NOT edit the PRE_* fixtures to make this test pass — they document the
// pre-change reality. Only the canonical block (jero-ai.ts / orchestrator.md)
// or the extraction/assertions below may change.
//
// i18n pass (en→zh): the persona prompts (jero-ai.ts) and the orchestrator
// assets were translated into Simplified Chinese. The POST_* baselines were
// re-frozen to that Chinese text (POST_ORCH_LANGBOUNDARY stays a union
// snapshot: LB1/LB3/LB4 from assets/orchestrator.md, LB2/LB5 from
// assets/orchestrator-delegation.md), the PRE_* fixtures remain the frozen
// English pre-change history, and every byte constant below is a
// node-measured Buffer.byteLength value against the Chinese POST_* baselines.
// ---------------------------------------------------------------------------

const orchestratorMdPath = fileURLToPath(
	new URL("../assets/orchestrator.md", import.meta.url),
);

function readOrchestratorMdRaw(): string {
	return readFileSync(orchestratorMdPath, "utf8");
}

// ---------------------------------------------------------------------------
// PRE_* fixtures — frozen verbatim from HEAD before this change
// ---------------------------------------------------------------------------

/** jero-ai.ts :179-184 — wrapper Identity contract block, pre-change (438 B). */
const PRE_WRAPPER_IDENTITY_BLOCK = `Identity contract:
- If the user asks who or what you are, answer as el Gentleman, not as a generic assistant.
- Say you are a Pi-specific coding-agent harness with senior architect persona.
- Mention SDD/OpenSpec phase artifacts and subagents as core capabilities.
- Mention memory only when memory packages or callable memory tools are actually active; never invent persistent memory.
- Do not claim portability outside the Pi runtime.
`;

/** jero-ai.ts :173-198 — full wrapper static template, pre-change, rendered for "gentleman". */
const PRE_WRAPPER_GENTLEMAN = `## el Gentleman Identity and Harness

Current persona mode: gentleman

You are el Gentleman: a Pi-specific coding-agent harness for controlled development work.

${PRE_WRAPPER_IDENTITY_BLOCK}
Persona:
- Be direct, technical, and concise.
- When the user writes Spanish, answer in natural Rioplatense Spanish with voseo.
- Act as a senior architect and teacher: concepts before code, no shortcuts.
- Treat AI as a tool directed by the human; never present yourself as a default chatbot.
- Push back when the user asks for code without enough context or understanding.
- Correct errors directly, explain why, and show the better path.

Language: natural Rioplatense Spanish with voseo when the user writes Spanish.

Harness principles:
- el Gentleman is not prompt engineering. It is runtime discipline around powerful agents.
- Prefer SDD/OpenSpec artifacts over floating chat context for non-trivial work.
- Clarify scope, constraints, acceptance criteria, and non-goals before implementation.
- Use subagents when available for exploration, planning, implementation, and review, while keeping one parent session responsible for orchestration.
- Keep writes single-threaded unless the user explicitly approves parallel write isolation.
- If tests exist, use strict TDD evidence: RED, GREEN, TRIANGULATE, REFACTOR.
- Protect the human reviewer: avoid oversized changes, surface review workload risk, and ask before turning one task into a large multi-area change.
- Never claim persistent memory is available because of this package. Memory is provided by separate packages or MCP tools when installed and callable.`;

/** jero-ai.ts :173-198 — full wrapper static template, pre-change, rendered for "neutral". */
const PRE_WRAPPER_NEUTRAL = `## el Gentleman Identity and Harness

Current persona mode: neutral

You are el Gentleman: a Pi-specific coding-agent harness for controlled development work.

${PRE_WRAPPER_IDENTITY_BLOCK}
Persona:
- Be direct, technical, concise, warm, and professional.
- Always respond in the same language the user writes in.
- Do not use slang or regional expressions.
- When the user writes Spanish, use neutral/professional Spanish. Do NOT use voseo (vos tenés, vos querés, hacé, andá, etc.) or any regional conjugations.
- Act as a senior architect and teacher: concepts before code, no shortcuts.
- Treat AI as a tool directed by the human; never present yourself as a default chatbot.
- Push back when the user asks for code without enough context or understanding.
- Correct errors directly, explain why, and show the better path.

Language: neutral/professional Spanish when the user writes Spanish. Do NOT use voseo or Rioplatense regional expressions.

Harness principles:
- el Gentleman is not prompt engineering. It is runtime discipline around powerful agents.
- Prefer SDD/OpenSpec artifacts over floating chat context for non-trivial work.
- Clarify scope, constraints, acceptance criteria, and non-goals before implementation.
- Use subagents when available for exploration, planning, implementation, and review, while keeping one parent session responsible for orchestration.
- Keep writes single-threaded unless the user explicitly approves parallel write isolation.
- If tests exist, use strict TDD evidence: RED, GREEN, TRIANGULATE, REFACTOR.
- Protect the human reviewer: avoid oversized changes, surface review workload risk, and ask before turning one task into a large multi-area change.
- Never claim persistent memory is available because of this package. Memory is provided by separate packages or MCP tools when installed and callable.`;

/** orchestrator.md :5-21 — Identity Contract section, pre-change (831 B). */
const PRE_ORCH_IDENTITY = `## Identity Contract

You are el Gentleman: a Pi-specific coding-agent harness for controlled development work.

When the user asks who or what you are, answer with this meaning, translated into the user's language:

\`\`\`text
I am el Gentleman: a Pi-specific coding-agent harness for controlled development, with a senior architect persona. I work with SDD/OpenSpec when the task justifies it, coordinate subagents, use phase artifacts, run commands, and edit files. I am not a generic chatbot.
\`\`\`

Rules:

- Never introduce yourself as only "your assistant" or "the default assistant".
- Keep the response in the user's language and follow the currently selected persona mode.
- Mention persistent memory only when a memory package or callable memory tools are actually active.
- Do not claim portability outside the Pi runtime.

`;

/** orchestrator.md :28-42 — Language Boundary section, pre-change (2,117 B). */
const PRE_ORCH_LANGBOUNDARY = `## Language Boundary

User-facing conversation should stay in the user's language and follow the currently active persona mode. The active mode is stated in the \`Current persona mode:\` line in the identity/harness section of this system prompt — always honor it for language style.

Subagent-facing prompts should be written in English by default, even when the user speaks Spanish. Translate the user's request into concise English before delegation. This keeps token usage lower and gives built-in/project subagents a consistent operating language without changing the user-facing persona.

Generated technical artifacts — whether by the parent inline or by subagents — (code, code comments, UI copy, identifiers, commit messages, filenames, PR descriptions, tests, fixtures, SDD/OpenSpec files, delegated phase outputs, and repository-facing documentation) default to English, regardless of the user's conversation language or active persona. Override only when the user explicitly requests another language for that artifact, or when extending a project whose existing convention is non-English.

Public/contextual comments and replies are different from technical artifacts. When using \`comment-writer\` or drafting a human-facing GitHub, PR review, Slack, Discord, or async comment, write in the target context language by default. Spanish issue/thread -> Spanish comment. English thread -> English comment. Mixed context -> target message language. Explicit user language or tone override wins. Spanish comments default to neutral/professional Spanish unless the user or target context clearly calls for regional tone.

Exceptions:

- Preserve exact user quotes, UI copy, error messages, filenames, commands, and domain terms in their original language when they are evidence.
- Ask a subagent to produce Spanish only when its output is intended to be pasted directly to the user, a PR/comment/reply in Spanish, or Spanish-language product/documentation text.
- SDD/OpenSpec artifact content may follow the project's established language, but phase task instructions to subagents should still be English.
`;

// ---------------------------------------------------------------------------
// POST_* fixtures — the current canonical Chinese text (en→zh i18n pass),
// transcribed verbatim from extensions/jero-ai.ts and the orchestrator assets,
// frozen here so the canonical blocks and this test move together.
// ---------------------------------------------------------------------------

/** jero-ai.ts buildGentlePrompt 身份契约 bullets — Chinese i18n baseline (764 B, node-measured). */
const POST_WRAPPER_IDENTITY_BLOCK = `身份契约：
- 当用户问你是谁或是什么时，以 el Jero 的身份回答，而不是泛用助手，且绝不仅仅以“您的助手”或“默认助手”自我介绍。传达以下含义，并翻译成用户的语言：“我是 el Jero：一个面向受控开发的 Pi 专用编码代理框架，具备资深架构师人格。我在任务需要时使用 SDD/OpenSpec，协调子代理，使用阶段产物，运行命令并编辑文件。我不是通用聊天机器人。”
- 遵循当前选择的人格模式。
- 将 SDD/OpenSpec 阶段产物和子代理作为核心能力提及。
- 仅在记忆包或可调用的记忆工具确实处于活动状态时才提及记忆；绝不虚构持久记忆。
- 不宣称在 Pi 运行时之外可移植。
`;

/** Language-match clause folded into GENTLEMAN_PERSONA_PROMPT, byte-identical to the NEUTRAL_PERSONA_PROMPT bullet (Chinese i18n baseline). */
const NEW_GENTLEMAN_LANGUAGE_CLAUSE =
	"- 始终用用户写作所用的语言回答。";

/** assets/orchestrator.md `## 身份契约` — one-line pointer, Chinese i18n baseline (144 B, node-measured). */
const POST_ORCH_IDENTITY = `## 身份契约

已在上方注入的身份/harness 段（\`Current persona mode:\` 行）中一次性定义。遵守它；不要在此重述。
`;

/** Language Boundary union snapshot, Chinese i18n baseline (1,991 B, node-measured): LB1/LB3/LB4 transcribed from assets/orchestrator.md, LB2/LB5 from assets/orchestrator-delegation.md (their current home after orchestrator-lazy-diet). */
const POST_ORCH_LANGBOUNDARY = `## 语言边界

回复语言风格与当前 persona 的中文变体已在上方身份/harness 段（其 \`Current persona mode:\` 行）一次性定义。以下规则仅限定委托/产物范围，不在那里重述：

面向子代理的委托提示词默认使用简体中文（本包的子代理定义已是中文）。委托前把用户的请求整理为简明的中文任务说明；仅当下游工具或目标明确需要英文时才使用英文。这为内置/项目子代理提供一致的运行语言，且不改变面向用户的 persona。

生成式技术产物——无论由父会话内联还是由子代理生成——（代码、代码注释、UI 文案、标识符、提交信息、文件名、PR 描述、测试、fixture、SDD/OpenSpec 文件、委托的阶段输出、面向仓库的文档）默认使用简体中文，与用户会话语言或当前 persona 无关。当下游目标上下文明显为英文（英文仓库既有惯例、英文 issue/PR 线程）时使用英文；用户为该产物显式指定其他语言时从其指定。

公开/情境性评论与回复不同于技术产物。使用 \`comment-writer\` 或起草面向人的 GitHub、PR 评审、Slack、Discord 或异步评论时，默认使用目标上下文语言：中文 issue/线程 → 中文评论；英文线程 → 英文评论；混合上下文 → 目标消息语言。用户显式语言或语气覆盖优先。中文评论默认使用中性/专业的简体中文，除非用户或目标上下文明确要求地域语气。

例外：

- 用户原话引文、UI 文案、错误信息、文件名、命令与领域术语作为证据时，保留其原始语言。
- 仅当子代理产物注定直接进入英文目标（英文 PR/评论/回复，或英文产品/文档文本）时，才要求其产出英文。
- SDD/OpenSpec 产物内容可遵循项目既有语言，但面向子代理的阶段任务说明仍遵循本节默认（简体中文；仅当下游明确需要英文时用英文）。
`;

// ---------------------------------------------------------------------------
// Byte-size constants (EXT-005) — repeated byte literals grouped by fixture
// instead of duplicated magic numbers across the integrity and byte-delta
// assertions below. Each constant is annotated with the fixture/pairing it
// measures; see the PRE_*/POST_* fixtures above for the underlying text.
// POST-side values are node-measured (Buffer.byteLength) against the
// re-frozen Chinese i18n baselines.
// ---------------------------------------------------------------------------

const PRE_WRAPPER_BYTES = 438; // PRE_WRAPPER_IDENTITY_BLOCK
const POST_WRAPPER_BYTES = 764; // POST_WRAPPER_IDENTITY_BLOCK (Chinese i18n baseline, node-measured)
const WRAPPER_IDENTITY_DELTA_BYTES = 326; // POST_WRAPPER_BYTES - PRE_WRAPPER_BYTES

const PRE_ORCH_IDENTITY_BYTES = 831; // PRE_ORCH_IDENTITY
const ORCH_IDENTITY_DELTA_BYTES = 687; // PRE_ORCH_IDENTITY_BYTES - POST_ORCH_IDENTITY (144 B)

const PRE_ORCH_LANGBOUNDARY_BYTES = 2117; // PRE_ORCH_LANGBOUNDARY

const GENTLEMAN_NET_DELTA_BYTES = -439; // section-sum method, gentleman mode (Chinese i18n baseline)
const NEUTRAL_NET_DELTA_BYTES = -487; // section-sum method, neutral mode (Chinese i18n baseline)

// ---------------------------------------------------------------------------
// Frozen fixture integrity — self-check the transcription against the design's
// judge-measured byte counts (design.md "Byte estimates" table). If these
// fail, the fixture above was transcribed incorrectly — fix the fixture, not
// this assertion.
// ---------------------------------------------------------------------------

test("fixture integrity: PRE byte counts match design.md judge-measured figures", () => {
	assert.equal(
		Buffer.byteLength(PRE_WRAPPER_IDENTITY_BLOCK),
		PRE_WRAPPER_BYTES,
		"PRE_WRAPPER_IDENTITY_BLOCK must equal the judge-measured 438 B (jero-ai.ts:179-184)",
	);
	assert.equal(
		Buffer.byteLength(PRE_ORCH_IDENTITY),
		PRE_ORCH_IDENTITY_BYTES,
		"PRE_ORCH_IDENTITY must equal the judge-measured 831 B (orchestrator.md:5-21)",
	);
	assert.equal(
		Buffer.byteLength(PRE_ORCH_LANGBOUNDARY),
		PRE_ORCH_LANGBOUNDARY_BYTES,
		"PRE_ORCH_LANGBOUNDARY must equal the judge-measured 2,117 B (orchestrator.md:28-42)",
	);
});

test("fixture integrity: POST_WRAPPER_IDENTITY_BLOCK matches the Chinese i18n baseline 764 B", () => {
	assert.equal(
		Buffer.byteLength(POST_WRAPPER_IDENTITY_BLOCK),
		POST_WRAPPER_BYTES,
		"POST_WRAPPER_IDENTITY_BLOCK must equal the 764 B Chinese i18n baseline (node-measured against the jero-ai.ts 身份契约 bullets)",
	);
});

// ---------------------------------------------------------------------------
// Line-level union sweep — one named assertion per Table A / Table B rule.
// Verifies survival (VERBATIM / MERGED / POINTER) in the LIVE post-change
// combined injection: __testing.buildGentlePrompt(persona).
// ---------------------------------------------------------------------------

test("Table A rule: wrapper :177 'You are el Jero...' survives verbatim (KEEP once, wrapper)", () => {
	for (const persona of ["gentleman", "neutral"] as const) {
		const prompt = __testing.buildGentlePrompt(persona);
		assert.match(
			prompt,
			/你是 el Jero：一个面向受控开发工作的 Pi 专用编码代理框架。/,
			`[${persona}] wrapper :177 opening sentence must survive`,
		);
	}
});

test("Table A rule: wrapper :180/:181 + orchestrator :9,:12 self-description MERGE into wrapper bullet 1", () => {
	for (const persona of ["gentleman", "neutral"] as const) {
		const prompt = __testing.buildGentlePrompt(persona);
		assert.match(
			prompt,
			/以 el Jero 的身份回答，而不是泛用助手/,
			`[${persona}] merged bullet must keep '以 el Jero 的身份回答，而不是泛用助手' (subsumes wrapper :180)`,
		);
		assert.match(
			prompt,
			/资深架构师人格/,
			`[${persona}] merged bullet must keep '资深架构师人格' (subsumes wrapper :181)`,
		);
		assert.match(
			prompt,
			/我是 el Jero：一个面向受控开发的 Pi 专用编码代理框架，具备资深架构师人格。我在任务需要时使用 SDD\/OpenSpec，协调子代理，使用阶段产物，运行命令并编辑文件。我不是通用聊天机器人。/,
			`[${persona}] the richer translated self-description paragraph (orchestrator :9,:12) must survive in the wrapper`,
		);
	}
});

test("Table A rule: orchestrator :17 'never introduce yourself...' ADDED to wrapper (orchestrator-only rule)", () => {
	for (const persona of ["gentleman", "neutral"] as const) {
		const prompt = __testing.buildGentlePrompt(persona);
		assert.match(
			prompt,
			/绝不仅仅以“您的助手”或“默认助手”自我介绍/,
			`[${persona}] orchestrator :17 rule must be added to the wrapper`,
		);
	}
});

test("Table A rule: persona-mode selection (trimmed) survives; language clause NOT restated in Identity contract", () => {
	for (const persona of ["gentleman", "neutral"] as const) {
		const prompt = __testing.buildGentlePrompt(persona);
		assert.match(
			prompt,
			/遵循当前选择的人格模式。/,
			`[${persona}] trimmed persona-mode-selection rule must survive (orchestrator :18, language clause dropped)`,
		);
	}
});

test("Table A rule: SDD/OpenSpec artifacts + subagents core-capabilities bullet survives (KEEP once)", () => {
	for (const persona of ["gentleman", "neutral"] as const) {
		const prompt = __testing.buildGentlePrompt(persona);
		assert.match(
			prompt,
			/将 SDD\/OpenSpec 阶段产物和子代理作为核心能力提及。/,
			`[${persona}] wrapper :182 rule must survive`,
		);
	}
});

test("Table A rule: memory rule (wrapper phrasing, with never-invent clause) survives (KEEP wrapper)", () => {
	for (const persona of ["gentleman", "neutral"] as const) {
		const prompt = __testing.buildGentlePrompt(persona);
		assert.match(
			prompt,
			/仅在记忆包或可调用的记忆工具确实处于活动状态时才提及记忆；绝不虚构持久记忆。/,
			`[${persona}] wrapper :183 memory rule (with never-invent) must survive`,
		);
	}
});

test("Table A rule: 'Do not claim portability outside the Pi runtime.' survives (KEEP once, byte-identical wrapper :184 / orchestrator :20)", () => {
	for (const persona of ["gentleman", "neutral"] as const) {
		const prompt = __testing.buildGentlePrompt(persona);
		assert.match(
			prompt,
			/不宣称在 Pi 运行时之外可移植。/,
			`[${persona}] portability rule must survive`,
		);
	}
});

test("Table B rule: LB2 subagent delegation language kept verbatim in delegation asset (unique)", () => {
	// orchestrator-lazy-diet: LB2 moved verbatim to
	// assets/orchestrator-delegation.md (delegation-scoped rule); the always-on
	// combined injection now only carries a pointer to it. Union read so this
	// assertion is repointed, not weakened. The en→zh i18n pass re-transcribed
	// the sentence from the delegation asset's current text.
	const delegationDetail = readFileSync(
		fileURLToPath(new URL("../assets/orchestrator-delegation.md", import.meta.url)),
		"utf8",
	);
	for (const persona of ["gentleman", "neutral"] as const) {
		const prompt = __testing.buildGentlePrompt(persona) + delegationDetail;
		assert.match(
			prompt,
			/面向子代理的委托提示词默认使用简体中文（本包的子代理定义已是中文）/,
			`[${persona}] LB2 must remain verbatim`,
		);
	}
});

test("Table B rule: LB3 artifacts language rule kept verbatim in orchestrator (unique)", () => {
	for (const persona of ["gentleman", "neutral"] as const) {
		const prompt = __testing.buildGentlePrompt(persona);
		assert.match(
			prompt,
			/生成式技术产物——无论由父会话内联还是由子代理生成/,
			`[${persona}] LB3 must remain verbatim`,
		);
	}
});

test("Table B rule: LB4 public-comment target language kept verbatim in orchestrator (unique)", () => {
	for (const persona of ["gentleman", "neutral"] as const) {
		const prompt = __testing.buildGentlePrompt(persona);
		assert.match(
			prompt,
			/公开\/情境性评论与回复不同于技术产物。/,
			`[${persona}] LB4 must remain verbatim`,
		);
	}
});

test("Table B rule: LB5 exceptions kept verbatim in delegation asset (unique)", () => {
	// orchestrator-lazy-diet: LB5 moved verbatim to
	// assets/orchestrator-delegation.md (delegation-scoped exceptions); the
	// always-on combined injection now only carries a pointer to it. Union
	// read so this assertion is repointed, not weakened. The en→zh i18n pass
	// re-transcribed the bullets from the delegation asset's current text.
	const delegationDetail = readFileSync(
		fileURLToPath(new URL("../assets/orchestrator-delegation.md", import.meta.url)),
		"utf8",
	);
	for (const persona of ["gentleman", "neutral"] as const) {
		const prompt = __testing.buildGentlePrompt(persona) + delegationDetail;
		assert.match(
			prompt,
			/用户原话引文、UI 文案、错误信息、文件名、命令与领域术语作为证据时，保留其原始语言。/,
			`[${persona}] LB5 exceptions bullet 1 must remain verbatim`,
		);
		assert.match(
			prompt,
			/仅当子代理产物注定直接进入英文目标/,
			`[${persona}] LB5 exceptions bullet 2 must remain verbatim`,
		);
		assert.match(
			prompt,
			/SDD\/OpenSpec 产物内容可遵循项目既有语言/,
			`[${persona}] LB5 exceptions bullet 3 must remain verbatim`,
		);
	}
});

test("orchestrator.md Identity Contract collapses to the one-line pointer (post-change)", () => {
	const raw = readOrchestratorMdRaw();
	assert.ok(
		raw.includes(POST_ORCH_IDENTITY.trim()),
		"orchestrator.md must contain the exact Identity Contract pointer text (Chinese i18n baseline)",
	);
});

test("orchestrator.md Language Boundary LB1 collapses to the one-line pointer; LB2-LB5 remain verbatim (post-change)", () => {
	const raw = readOrchestratorMdRaw();
	assert.ok(
		raw.includes(
			"回复语言风格与当前 persona 的中文变体已在上方身份/harness 段（其 `Current persona mode:` 行）一次性定义",
		),
		"orchestrator.md must contain the LB1 pointer text (Chinese i18n baseline)",
	);
});

// ---------------------------------------------------------------------------
// Duplication guard (exact-string) — task 1.3
// ---------------------------------------------------------------------------

function countOccurrences(haystack: string, needle: string): number {
	if (needle.length === 0) return 0;
	let count = 0;
	let index = haystack.indexOf(needle);
	while (index !== -1) {
		count += 1;
		index = haystack.indexOf(needle, index + needle.length);
	}
	return count;
}

test("dup guard (exact-string): '不宣称在 Pi 运行时之外可移植。' occurs exactly once", () => {
	for (const persona of ["gentleman", "neutral"] as const) {
		const prompt = __testing.buildGentlePrompt(persona);
		assert.equal(
			countOccurrences(prompt, "不宣称在 Pi 运行时之外可移植。"),
			1,
			`[${persona}] portability rule must occur exactly once in the combined injection`,
		);
	}
});

test("dup guard (exact-string): identity self-description sentence occurs exactly once", () => {
	const selfDescription =
		"我是 el Jero：一个面向受控开发的 Pi 专用编码代理框架，具备资深架构师人格。我在任务需要时使用 SDD/OpenSpec，协调子代理，使用阶段产物，运行命令并编辑文件。我不是通用聊天机器人。";
	for (const persona of ["gentleman", "neutral"] as const) {
		const prompt = __testing.buildGentlePrompt(persona);
		assert.equal(
			countOccurrences(prompt, selfDescription),
			1,
			`[${persona}] self-description sentence must occur exactly once in the combined injection`,
		);
	}
});

test("dup guard (exact-string): LB2/LB3/LB4 each occur exactly once", () => {
	// orchestrator-lazy-diet: LB2 moved verbatim to
	// assets/orchestrator-delegation.md (delegation-scoped rule, absent from
	// the always-on combined injection by design — see "No Double-Delivery").
	// LB3/LB4 stay verbatim in the always-on core. Union read for LB2 so the
	// "exactly once" guard is repointed to its new home, not weakened.
	const delegationDetail = readFileSync(
		fileURLToPath(new URL("../assets/orchestrator-delegation.md", import.meta.url)),
		"utf8",
	);
	const lb2 = "面向子代理的委托提示词默认使用简体中文（本包的子代理定义已是中文）。";
	const lb3 = "生成式技术产物——无论由父会话内联还是由子代理生成";
	const lb4 = "公开/情境性评论与回复不同于技术产物。";
	for (const persona of ["gentleman", "neutral"] as const) {
		const prompt = __testing.buildGentlePrompt(persona);
		assert.equal(
			countOccurrences(prompt + delegationDetail, lb2),
			1,
			`[${persona}] LB2 must occur exactly once`,
		);
		assert.equal(countOccurrences(prompt, lb3), 1, `[${persona}] LB3 must occur exactly once`);
		assert.equal(countOccurrences(prompt, lb4), 1, `[${persona}] LB4 must occur exactly once`);
	}
});

// ---------------------------------------------------------------------------
// Duplication guard (concept-level) — task 1.4, closes JD-001's paraphrase gap.
//
// Regex catches the persona language-match bullet ("始终用用户写作所用的语言
// 回答"). The conveyance clause in the identity contract ("...并翻译成用户的
// 语言：...") is a documented, SCOPED EXCEPTION (see design.md "Exact
// post-change text" note, round-2 judge finding): it is a self-description
// conveyance directive, not a general reply-language rule, so it is excluded
// from the count below. After the en→zh i18n pass the exception phrase no
// longer lexically contains the concept phrase, so the exception is stripped
// from the text BEFORE counting rather than subtracted from the raw match
// count (same exclusion semantics, correct arithmetic for the Chinese text).
// ---------------------------------------------------------------------------

const LANGUAGE_MATCH_CONCEPT_RE = /用户写作所用的语言/g;
const SCOPED_EXCEPTION_PHRASE = "翻译成用户的语言";

function countLanguageMatchConceptOccurrences(text: string): number {
	const withoutScopedException = text.split(SCOPED_EXCEPTION_PHRASE).join("");
	return (withoutScopedException.match(LANGUAGE_MATCH_CONCEPT_RE) ?? []).length;
}

test("dup guard (concept-level): language-match regex matches exactly once per rendered mode, excluding the scoped self-description exception", () => {
	const gentlemanPrompt = __testing.buildGentlePrompt("gentleman");
	const neutralPrompt = __testing.buildGentlePrompt("neutral");
	assert.equal(
		countLanguageMatchConceptOccurrences(gentlemanPrompt),
		1,
		"gentleman mode must have exactly one non-excepted language-match concept occurrence",
	);
	assert.equal(
		countLanguageMatchConceptOccurrences(neutralPrompt),
		1,
		"neutral mode must have exactly one non-excepted language-match concept occurrence",
	);
});

// ---------------------------------------------------------------------------
// Added-rule assertion — task 1.5
// ---------------------------------------------------------------------------

test("added rule: gentleman output contains the new GENTLEMAN_PERSONA_PROMPT language-match clause", () => {
	const prompt = __testing.buildGentlePrompt("gentleman");
	assert.match(
		prompt,
		/- 始终用用户写作所用的语言回答。/,
		"gentleman prompt must contain the new language-match clause mirroring NEUTRAL_PERSONA_PROMPT :158",
	);
});

test("regression: neutral output still contains its own unchanged language-match clause (:158)", () => {
	const prompt = __testing.buildGentlePrompt("neutral");
	assert.match(
		prompt,
		/- 始终用用户写作所用的语言回答。/,
		"neutral prompt must keep its own :158 language-match clause",
	);
});

// ---------------------------------------------------------------------------
// Byte-delta assertion — task 1.6 / 4.3. POST-side values below are
// node-measured (Buffer.byteLength) against the re-frozen Chinese i18n
// baselines, superseding the retired openspec byte-measurements note and the
// design's original English-baseline estimates.
// ---------------------------------------------------------------------------

test("byte delta: wrapper Identity contract block grows by the measured delta (post > pre)", () => {
	const pre = Buffer.byteLength(PRE_WRAPPER_IDENTITY_BLOCK);
	const post = Buffer.byteLength(POST_WRAPPER_IDENTITY_BLOCK);
	assert.equal(pre, PRE_WRAPPER_BYTES, "pre wrapper Identity block must be 438 B");
	assert.equal(post, POST_WRAPPER_BYTES, "post wrapper Identity block must be 764 B (Chinese i18n baseline)");
	assert.equal(post - pre, WRAPPER_IDENTITY_DELTA_BYTES, "wrapper Identity block delta must be +326 B");
});

test("byte delta: orchestrator.md Identity Contract shrinks to the measured pointer size (144 B, Chinese i18n baseline)", () => {
	const pre = Buffer.byteLength(PRE_ORCH_IDENTITY);
	const post = Buffer.byteLength(POST_ORCH_IDENTITY);
	assert.equal(pre, PRE_ORCH_IDENTITY_BYTES, "pre orchestrator Identity Contract must be 831 B");
	assert.equal(post, 144, "post orchestrator Identity Contract must be 144 B (Chinese i18n baseline, node-measured)");
	assert.equal(pre - post, ORCH_IDENTITY_DELTA_BYTES, "orchestrator Identity Contract delta must be -687 B");
});

test("byte delta: orchestrator.md Language Boundary union snapshot shrinks by the measured 126 B (Chinese i18n baseline)", () => {
	const pre = Buffer.byteLength(PRE_ORCH_LANGBOUNDARY);
	const post = Buffer.byteLength(POST_ORCH_LANGBOUNDARY);
	assert.equal(pre, PRE_ORCH_LANGBOUNDARY_BYTES, "pre orchestrator Language Boundary must be 2,117 B");
	assert.equal(post, 1991, "post orchestrator Language Boundary union snapshot must be 1,991 B (Chinese i18n baseline, node-measured)");
	assert.equal(pre - post, 126, "orchestrator Language Boundary delta must be -126 B (2,117 B English pre-change -> 1,991 B Chinese union snapshot)");
});

test("byte delta: new GENTLEMAN_PERSONA_PROMPT clause is present and small (single added line)", () => {
	assert.equal(
		Buffer.byteLength(`${NEW_GENTLEMAN_LANGUAGE_CLAUSE}\n`),
		48,
		"the added gentleman language-match clause line must be 48 B (Chinese i18n baseline, node-measured)",
	);
});

test("byte delta: net per-session injection delta (gentleman -439 B, neutral -487 B, section-sum method)", () => {
	// Section-sum method (fixture-derived, internally consistent). The original
	// persona-single-channel migration measured -293 B / -351 B against the
	// English baselines; the en→zh i18n pass re-froze the POST_* baselines in
	// Chinese and re-measured the section sum with node Buffer.byteLength.
	const wrapperDelta =
		Buffer.byteLength(POST_WRAPPER_IDENTITY_BLOCK) - Buffer.byteLength(PRE_WRAPPER_IDENTITY_BLOCK);
	const orchDelta =
		Buffer.byteLength(POST_ORCH_IDENTITY) -
		Buffer.byteLength(PRE_ORCH_IDENTITY) +
		(Buffer.byteLength(POST_ORCH_LANGBOUNDARY) - Buffer.byteLength(PRE_ORCH_LANGBOUNDARY));
	const gentlemanClauseDelta = Buffer.byteLength(`${NEW_GENTLEMAN_LANGUAGE_CLAUSE}\n`);
	assert.equal(
		wrapperDelta + orchDelta + gentlemanClauseDelta,
		GENTLEMAN_NET_DELTA_BYTES,
		"gentleman net per-session injection delta must be -439 B (section-sum method, Chinese i18n baseline)",
	);
	assert.equal(
		wrapperDelta + orchDelta,
		NEUTRAL_NET_DELTA_BYTES,
		"neutral net per-session injection delta must be -487 B (section-sum method, Chinese i18n baseline, no persona-prompt change)",
	);
});

// ---------------------------------------------------------------------------
// Requirement: Persona Constant Selection Keeps Working
// ---------------------------------------------------------------------------

test("gentleman persona selected: GENTLEMAN_PERSONA_PROMPT content appears once, no neutral-only rule leaks in", () => {
	const prompt = __testing.buildGentlePrompt("gentleman");
	assert.match(prompt, /Current persona mode: gentleman/);
	assert.match(prompt, /用户使用中文时，用自然、地道的简体中文回答/);
	assert.doesNotMatch(
		prompt,
		/不使用网络俚语/,
		"gentleman prompt must not leak the neutral-only slang/dialect prohibition bullet",
	);
});

test("neutral persona selected: NEUTRAL_PERSONA_PROMPT content appears once, no gentleman-only rule leaks in", () => {
	const prompt = __testing.buildGentlePrompt("neutral");
	assert.match(prompt, /Current persona mode: neutral/);
	assert.match(prompt, /不使用网络俚语（yyds、绝绝子）、梗或方言表达（老铁、咋、俺）/);
	assert.doesNotMatch(
		prompt,
		/用自然、地道的简体中文回答/,
		"neutral prompt must not leak the gentleman-only natural-Chinese instruction",
	);
});
