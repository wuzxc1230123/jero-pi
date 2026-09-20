import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import test from "node:test";
import { REVIEW_LENS_PARITY_PATTERNS } from "./support/review-lens-parity.ts";

const ROOT = join(import.meta.dirname, "..");
const CANONICAL = "skills/_shared/review-ledger-contract.md";
const ORCHESTRATOR = ["assets/orchestrator.md", "assets/orchestrator-delegation.md"];
const REVIEW_LENSES = [
	"assets/agents/review-risk.md",
	"assets/agents/review-resilience.md",
	"assets/agents/review-readability.md",
	"assets/agents/review-reliability.md",
] as const;
const JUDGES = ["assets/agents/jd-judge-a.md", "assets/agents/jd-judge-b.md"] as const;
const FIX_AGENT = "assets/agents/jd-fix-agent.md";
const JD_SKILL = "skills/judgment-day/SKILL.md";
const JD_PROMPTS = "skills/judgment-day/references/prompts-and-formats.md";
const GENTLE_SKILL = "skills/jero-ai/SKILL.md";
const README = "README.md";
const TECHNICAL_REFERENCE = "docs/jero-reference.md";
const CHAIN = "assets/chains/4r-review.chain.md";
const SDD_WORKFLOW = "assets/sdd-orchestrator-workflow.md";
const RELEASE_SKILL = "skills/release/SKILL.md";
const WORKER = "assets/agents/jero-worker.md";
const CANONICAL_LIFECYCLE_SPECS = [
	"openspec/specs/review-orchestration/spec.md",
	"openspec/specs/review-transaction/spec.md",
] as const;
const HISTORICAL_LIFECYCLE_SPECS = [
	"openspec/changes/complete-native-review-lifecycle/specs/review-orchestration/spec.md",
	"openspec/changes/complete-native-review-lifecycle/specs/review-transaction/spec.md",
] as const;

function read(path: string): string {
	return readFileSync(join(ROOT, path), "utf8");
}

function union(paths: readonly string[]): string {
	return paths.map(read).join("\n");
}

function assertMatches(label: string, content: string, patterns: readonly RegExp[]): void {
	for (const pattern of patterns) assert.match(content, pattern, label);
}

function fencedBlock(path: string, heading: string): string {
	const lines = read(path).split("\n");
	const starts = lines.flatMap((line, index) => line === heading ? [index] : []);
	assert.equal(starts.length, 1, `${path} must contain one exact ${heading}`);
	const fenceStart = lines.findIndex((line, index) => index > starts[0]! && line.startsWith("```"));
	const fence = lines[fenceStart]!.match(/^(`+)/)?.[1];
	const relativeEnd = lines.slice(fenceStart + 1).findIndex((line) => line === fence);
	assert.ok(fenceStart > starts[0]! && relativeEnd >= 0, `${path} must contain a complete fenced block`);
	return lines.slice(fenceStart + 1, fenceStart + 1 + relativeEnd).join("\n");
}

function jsonBlocks(path: string): unknown[] {
	return [...read(path).matchAll(/```json\n([\s\S]*?)\n```/g)].map((match) => JSON.parse(match[1]!));
}

function assertNativeJsonHasNoMetadata(path: string, value: unknown): void {
	const serialized = JSON.stringify(value);
	for (const forbidden of ["summary", "skill_resolution", "orchestration", "prose"]) {
		assert.ok(!serialized.includes(forbidden), `${path} native JSON contains ${forbidden}`);
	}
}

const JUDGMENT_DAY_DISCOVERY_PATTERNS = [
	/(?:Judgment Day starts with exactly two blind judges and zero refuters\.|Judgment Day 从恰好两名盲裁判和零名反驳者开始。)/,
	/(?:Judgment Day alone may iterate discovery and scoped re-judgment, for at most two rounds\.|只有 Judgment Day 可以迭代发现和范围化复审，最多两轮。)/,
	/(?:Findings surviving round two escalate; no third-round transition exists\.|存活到第二轮之后的发现会升级；不存在第三轮转移。)/,
] as const;

const JUDGMENT_DAY_STANDALONE_SEMANTICS =
	/Judgment Day (?:is independent: it neither enables nor replaces ordinary review; a separately requested ordinary review remains independent|(?:是)?独立(?:的|运行)?：它既不启用也不(?:取|替)代普通评审；单独请求的普通评审(?:同样)?保持独立)/;

const OBSOLETE_JUDGMENT_DAY_REPLACEMENT =
	/Judgment Day starts only when explicitly requested and replaces ordinary review for that lineage\./;

const JUDGMENT_DAY_SEMANTIC_SURFACES = [
	CANONICAL,
	JD_SKILL,
	JD_PROMPTS,
	...JUDGES,
	FIX_AGENT,
	"assets/orchestrator-delegation.md",
	SDD_WORKFLOW,
] as const;

const JUDGMENT_DAY_REJUDGMENT_PATTERNS = [
	/(?:Initial discovery and scoped re-judgment are separate modes\.|初始发现和范围化复审是两种独立的模式。)/,
	/(?:On controller-requested scoped re-judgment, receive only requested frozen IDs, their exact hash-bound rows, and the fix diff\.|在控制器请求的范围化复审中，只接收被请求的冻结 ID、它们精确哈希绑定的行以及修复 diff。)/,
	/(?:Resolve only supplied IDs and fix-line regressions; do not add findings|只解决所提供的 ID 和修复行回归；不添加发现)/,
	/(?:Return one `verified \| corroborated \| regression` resolution per requested ID\.|对每个被请求的 ID 返回一个 `verified \| corroborated \| regression` 裁决。)/,
] as const;

const FIX_PATTERNS = [
	/(?:Fix only the exact controller-authorized severe IDs in the one supplied batch\.|只修复这一个所提供批次中被控制器精确授权的严重 ID。)/,
	/(?:Do not add findings, alter frozen claims, authorize transitions, deliver, publish, or start another actor\.|不添加发现、不更改冻结声明、不授权转移、不交付、不发布、不启动另一个执行器。)/,
] as const;

test("canonical contract defines compact risk, causal admission, correction, CAS, compatibility, and the delivery boundary", () => {
	const content = read(CANONICAL);
	assertMatches(CANONICAL, content, [
		/start -> finalize -> validate/,
		/`low`[\s\S]*`medium`[\s\S]*`high`/,
		/min\(200, ceil\(original_changed_lines \/ 2\)\)/,
		/testdata\/golden\/\*\*/,
		/`reviewing`, `correction_required`, `validating`, `approved`, and `escalated`/,
		/`evidence_class`, `causal_disposition`, and concrete proof/,
		/`changed-hunk`[\s\S]*`candidate-created-path`[\s\S]*`differential-test`[\s\S]*`before-after`/,
		/Only severe `introduced`, `behavior-activated`, or `worsened` findings with valid proof can enter `correction_ids`/,
		/`pre-existing` and `base-only` findings become non-blocking follow-ups/,
		/one correction transaction/i,
		/original budget/i,
		/frozen findings and genesis scope/i,
		/content-derived revisions, compare-and-swap replacement, exact retry idempotency/i,
		/graph-v1 ordinary lineages remain readable for compatibility but reject new mutation/i,
		/Legacy graph bundle export\/import is retired/i,
		/Judgment Day remains mutable on graph-v1/i,
		/--agent=pi --materialize=true/,
		/provider-owned submission form/i,
		/self-contained authority-advancing vectors/i,
		/Commit, push, pull-request creation, and release creation are not RDD gates/i,
		/Review outcomes and receipt state are informational and never authorize, consume, rewrite, or block a Bash delivery command/i,
		/Pi does not inspect RDD mode or native authority for those commands/i,
		/Review transactions, validation, and SDD never perform delivery commands themselves/i,
		/local orchestrator and same-user process are trusted/i,
		/reviewer and validator outputs remain semantically untrusted/i,
		/do not report.*trusted local orchestrator.*security finding/i,
		/untrusted repository content.*malformed inputs.*stale authority.*path drift.*external callers/i,
		...JUDGMENT_DAY_DISCOVERY_PATTERNS,
	]);
	assert.match(read(TECHNICAL_REFERENCE), /Review outcomes and receipt state are informational; commit, push, pull-request, and release delivery follow ordinary repository policy\./);
	assert.match(read(README), /\]\(docs\/jero-reference\.md(?:#[^)]+)?\)/);
	assert.doesNotMatch(read(README), /one one-shot authorization for the exact command/i);
	assert.doesNotMatch(read(README), /review-publication-gate/i);
});

for (const path of REVIEW_LENSES) {
	test(`${path} requires causal evidence and remains a one-shot read-only result producer`, () => {
		const content = read(path);
		assertMatches(path, content, REVIEW_LENS_PARITY_PATTERNS);
	});
}

function packagePaths(): string[] {
	const manifest = JSON.parse(read("package.json")) as { files?: unknown };
	if (!Array.isArray(manifest.files)) throw new Error("package.json must declare package files");
	return manifest.files.map((entry) => {
		if (typeof entry !== "string") throw new Error("package.json files entries must be strings");
		return entry.replace(/\/+$/, "");
	});
}

function projectPath(absolutePath: string): string | undefined {
	const path = relative(ROOT, absolutePath);
	if (path === "" || path === ".." || path.startsWith(`..${sep}`)) return undefined;
	return path.split(sep).join("/");
}

function isPackagedFile(path: string, packageRoots: readonly string[]): boolean {
	const absolutePath = resolve(ROOT, path);
	const projectRelativePath = projectPath(absolutePath);
	if (!projectRelativePath || !existsSync(absolutePath) || !statSync(absolutePath).isFile()) return false;
	return packageRoots.some((root) => projectRelativePath === root || projectRelativePath.startsWith(`${root}/`));
}

function packagedOrdinaryReviewLenses(): string[] {
	const packageRoots = packagePaths();
	return readdirSync(join(ROOT, "assets", "agents"), { withFileTypes: true })
		.filter((entry) => entry.isFile() && entry.name.startsWith("review-") && entry.name.endsWith(".md"))
		.map((entry) => `assets/agents/${entry.name}`)
		.filter((path) => isPackagedFile(path, packageRoots))
		.sort();
}

const MARKDOWN_FILE_REFERENCE = /(?:https?:\/\/[^\s)`\]]+|(?:\.{1,2}\/)?[A-Za-z0-9][A-Za-z0-9_./-]*)\.md\b/g;

function assertMarkdownFileDependenciesResolve(path: string, content: string, packageRoots: readonly string[]): void {
	const sourceDirectory = dirname(join(ROOT, path));
	const unresolved = [...content.matchAll(MARKDOWN_FILE_REFERENCE)]
		.map((match) => match[0])
		.filter((reference) => {
			if (reference.startsWith("http://") || reference.startsWith("https://")) return true;
			return ![resolve(ROOT, reference), resolve(sourceDirectory, reference)].some((candidate) => {
				const candidatePath = projectPath(candidate);
				return candidatePath !== undefined && isPackagedFile(candidatePath, packageRoots);
			});
		});
	assert.deepEqual(unresolved, [], `${path} names unavailable Markdown dependencies: ${unresolved.join(", ")}`);
}

test("packaged ordinary review lenses resolve their Markdown file dependencies", () => {
	const packageRoots = packagePaths();
	const lenses = packagedOrdinaryReviewLenses();
	assert.ok(lenses.length > 0, "package must ship at least one ordinary review lens");
	for (const path of lenses) assertMarkdownFileDependenciesResolve(path, read(path), packageRoots);
});

test("ordinary review dependencies allow packaged files and reject unresolved paths", () => {
	const packageRoots = packagePaths();
	assertMarkdownFileDependenciesResolve("assets/agents/review-risk.md", "Sources: docs/native-authority-architecture.md", packageRoots);
	assert.throws(
		() => assertMarkdownFileDependenciesResolve("assets/agents/review-risk.md", "Sources: docs/nonexistent/security.md", packageRoots),
		/unavailable Markdown dependencies: docs\/nonexistent\/security\.md/,
	);
});

test("ordinary lens prompts contain the literal compact-v2 native result envelope", () => {
	const expectedLenses = ["review-risk", "review-resilience", "review-readability", "review-reliability"];
	for (const [index, path] of REVIEW_LENSES.entries()) {
		const blocks = jsonBlocks(path);
		assert.equal(blocks.length, 1, `${path} must contain one native JSON example`);
		const envelope = blocks[0] as Record<string, unknown>;
		assert.deepEqual(Object.keys(envelope), ["review_result"]);
		const reviewResult = envelope.review_result as Record<string, unknown>;
		assert.deepEqual(Object.keys(reviewResult), ["lens_results"]);
		const lensResults = reviewResult.lens_results as Array<Record<string, unknown>>;
		assert.equal(lensResults.length, 1);
		assert.deepEqual(Object.keys(lensResults[0]!), ["lens", "findings", "evidence"]);
		assert.equal(lensResults[0]!.lens, expectedLenses[index]);
		const findings = lensResults[0]!.findings as Array<Record<string, unknown>>;
		assert.equal(findings[0]!.lens, expectedLenses[index]);
		assert.deepEqual(Object.keys(findings[0]!), [
			"id",
			"lens",
			"location",
			"severity",
			"claim",
			"evidence_class",
			"causal_disposition",
			"proof_refs",
		]);
		assertNativeJsonHasNoMetadata(path, envelope);
		assert.match(read(path), /不要把 `summary`、`skill_resolution`、散文或编排元数据放进原生 JSON 结果之内或旁边/);
		assert.match(read(path), /若干净，使用空的 `findings` 数组和包含具体范围内评审证据的非空 `evidence` 数组/);
		assert.doesNotMatch(read(path), /Use empty `findings` and `evidence` arrays when clean/);
	}
});

test("canonical ordinary review specs preserve the negotiated one-correction contract", (t) => {
	if (!CANONICAL_LIFECYCLE_SPECS.every((path) => existsSync(join(ROOT, path)))) {
		return t.skip("openspec lifecycle specs are absent from this tree (uncommitted openspec/ retirement)");
	}
	for (const path of CANONICAL_LIFECYCLE_SPECS) {
		const content = read(path);
		assert.match(content, /one correction transaction/i, path);
		assert.match(content, /original.*budget|budget.*original/i, path);
		assert.match(content, /never reruns initial lenses|without rerunning initial (?:lenses|review)/i, path);
		assert.match(content, /correction_required/, path);
		assert.match(content, /failure escalates|failed.*escalates|MUST escalate/i, path);
		assert.match(content, /forecast/i, path);
		assert.doesNotMatch(content, /up to three failed targeted attempts|third failed attempt/i, path);
	}
});

test("historical lifecycle change specs preserve their completed one-attempt design context", (t) => {
	if (!HISTORICAL_LIFECYCLE_SPECS.every((path) => existsSync(join(ROOT, path)))) {
		return t.skip("openspec lifecycle specs are absent from this tree (uncommitted openspec/ retirement)");
	}
	for (const path of HISTORICAL_LIFECYCLE_SPECS) {
		const content = read(path);
		assert.match(content, /at most one correction|one correction batch|After the one correction|GIVEN one exact ordinary correction|one validator and one final verification/i, path);
		assert.doesNotMatch(content, /up to three failed targeted attempts/i, path);
	}
});

test("risk lens distinguishes trusted orchestration from concrete boundary bypasses", () => {
	const content = read("assets/agents/review-risk.md");
	assert.match(content, /本地编排器和同用户进程受信任/i);
	assert.match(content, /评审者和验证者的输出在语义上仍不可信/i);
	assert.match(content, /不要把受信任的本地编排器能够提交执行器或最终验证输出这一能力本身报告为安全发现/i);
	assert.match(content, /不可信的仓库内容、格式错误的输入、陈旧的权威、路径漂移或外部调用者/i);
});

test("the Pi-owned adversarial role agents are retired: roles execute through Go-owned pi processes", () => {
	// gentle-pi#311 P5: the refuter and targeted validator are no longer
	// Pi-authored actors. The provider renders self-contained
	// review.capture-refuter / review.capture-validation vectors; executing
	// them makes Go materialize the role prompt, spawn its own locked-down pi
	// subprocess, and admit the raw verdict.
	for (const retired of ["assets/agents/review-refuter.md", "assets/agents/review-validator.md"]) {
		assert.throws(() => read(retired), `${retired} must be deleted`);
	}
});

for (const path of JUDGES) {
	test(`${path} preserves graph-v1 Judgment Day discovery and scoped re-judgment`, () => {
		const content = read(path);
		assertMatches(path, content, JUDGMENT_DAY_DISCOVERY_PATTERNS);
		assertMatches(path, content, JUDGMENT_DAY_REJUDGMENT_PATTERNS);
	});
}

test("Judgment Day judge prompts contain distinct graph-v1 discovery and re-judgment shapes", () => {
	for (const path of [...JUDGES, JD_PROMPTS]) {
		const blocks = jsonBlocks(path);
		assert.equal(blocks.length, 2, `${path} must contain discovery and re-judgment JSON examples`);
		const discovery = blocks[0] as Record<string, unknown>;
		assert.deepEqual(Object.keys(discovery), ["rows"]);
		const rows = discovery.rows as Array<Record<string, unknown>>;
		assert.deepEqual(Object.keys(rows[0]!), [
			"id",
			"lens",
			"location",
			"severity",
			"status_at_freeze",
			"evidence_class",
			"evidence_claim",
		]);
		assert.equal(rows[0]!.lens, "judgment-day");

		const rejudgment = blocks[1] as Record<string, unknown>;
		assert.deepEqual(Object.keys(rejudgment), ["resolutions"]);
		const resolutions = rejudgment.resolutions as Array<Record<string, unknown>>;
		assert.deepEqual(Object.keys(resolutions[0]!), ["id", "outcome"]);
		for (const block of blocks) assertNativeJsonHasNoMetadata(path, block);
		assert.match(read(path), /(?:Do not put `summary`, `skill_resolution`, prose, or orchestration metadata inside or beside (?:either )?(?:the )?native JSON result|不要把 `summary`、`skill_resolution`、散文或编排元数据放进任一原生 JSON 结果之内或旁边)/);
	}
	const judgePrompt = fencedBlock(JD_PROMPTS, "## Judge Prompt");
	assert.match(judgePrompt, /```json\n\{\n  "rows":/);
	assert.match(judgePrompt, /Do not put `summary`, `skill_resolution`, prose, or orchestration metadata inside or beside the native JSON result/);
	assert.doesNotMatch(judgePrompt, /End with `Skill Resolution:/);
});

test("Judgment Day canonical and packaged surfaces preserve the independent lifecycle", () => {
	for (const path of JUDGMENT_DAY_SEMANTIC_SURFACES) {
		const content = read(path);
		assert.match(content, JUDGMENT_DAY_STANDALONE_SEMANTICS, `${path} must use the current standalone Judgment Day sentence`);
		assert.doesNotMatch(content, OBSOLETE_JUDGMENT_DAY_REPLACEMENT, `${path} must reject the obsolete replacement semantics`);
	}
});

test("Judgment Day skill and prompts preserve bounded fix and re-judgment authority", () => {
	const skill = read(JD_SKILL);
	const judgePrompt = fencedBlock(JD_PROMPTS, "## Judge Prompt");
	assertMatches(JD_SKILL, skill, [...JUDGMENT_DAY_DISCOVERY_PATTERNS, ...JUDGMENT_DAY_REJUDGMENT_PATTERNS, ...FIX_PATTERNS]);
	assertMatches(JD_PROMPTS, judgePrompt, JUDGMENT_DAY_DISCOVERY_PATTERNS);
	assertMatches(JD_PROMPTS, fencedBlock(JD_PROMPTS, "## Fix Agent Prompt"), FIX_PATTERNS);
	assertMatches(FIX_AGENT, read(FIX_AGENT), FIX_PATTERNS);
});

test("Judgment Day fix routing has one canonical shape and never falls back to generic roles", () => {
	const canonicalShape = [
		"## Judgment Day activation",
		"User explicitly requested Judgment Day.",
		"## Exact authorized severe IDs",
		"- `JD-A-001`",
		"## Judgment Day correction batch",
		"Round: 1 of 2.",
		"Frozen ledger SHA-256: `aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`",
		"## Exact frozen finding rows",
		'{"id":"JD-A-001","lens":"judgment-day","location":"path/to/authorized-file.ts:1","severity":"CRITICAL","status_at_freeze":"open","evidence_class":"deterministic","evidence_claim":"Concrete user-impact claim supported by the frozen location."}',
		"## Allowed edit surfaces",
	].join("\n");
	for (const [path, content] of [
		[CANONICAL, read(CANONICAL)],
		[FIX_AGENT, read(FIX_AGENT)],
		[JD_SKILL, read(JD_SKILL)],
		[JD_PROMPTS, fencedBlock(JD_PROMPTS, "## Fix Agent Prompt")],
		["assets/orchestrator-delegation.md", read("assets/orchestrator-delegation.md")],
		[SDD_WORKFLOW, read(SDD_WORKFLOW)],
	] as const) {
		assert.ok(content.includes(canonicalShape), `${path} must carry the canonical Judgment Day fix shape`);
		assert.match(content, /(?:requires no graph-v1 or native review lineage|(?:不要求|不需要) graph-v1 或原生评审 ?(?:谱系|lineage))/i);
	}
	const routing = `${read("assets/orchestrator-delegation.md")}\n${read(SDD_WORKFLOW)}`;
	assert.match(routing, /Judgment Day 阶段角色绝不是通用回退。/);
	assert.match(routing, /若通用写者链不可用，使用文档记载的原生通用回退或停止。/);
	assert.match(read(SDD_WORKFLOW), /\| default\s+\| balanced\s+\| SDD 阶段回退；绝不是 Judgment Day 角色\s+\|/);
});

test("orchestrator, injected skill, and technical reference defer RDD lifecycle ownership to Jero", () => {
	const boundary = "本包启动时把镜像的提供方捆绑评审执行契约注入本会话系统提示；Jero 不向 Pi 系统提示写入任何内容，本包拥有此处其余一切。缺少该镜像契约时，本包不发明生命周期指令。";
	const orchestrator = union(ORCHESTRATOR);
	assert.ok(orchestrator.includes(boundary), "orchestrator must carry the sole static ownership boundary");

	for (const [label, content] of [
		[GENTLE_SKILL, read(GENTLE_SKILL)],
		[TECHNICAL_REFERENCE, read(TECHNICAL_REFERENCE)],
	] as const) {
		assertMatches(label, content, [
			/jero-pi dynamically supplies runtime-specific RDD instructions/i,
			/(?:sole lifecycle authority|does not define an RDD lifecycle)/i,
		]);
	}

	for (const [label, content] of [
		["orchestrator", orchestrator],
		[GENTLE_SKILL, read(GENTLE_SKILL)],
	] as const) {
		assert.doesNotMatch(content, /start -> finalize -> validate|INSPECT before START|next_transition|review\.capture-result/i, label);
	}
});

test("technical reference documents the dynamic runtime authority boundary without an old package route", () => {
	const content = read(TECHNICAL_REFERENCE);
	assert.match(content, /jero-pi dynamically supplies runtime-specific RDD instructions/i);
	assert.match(content, /does not define an RDD lifecycle/i);
	assert.doesNotMatch(content, /New ordinary review uses compact `gentle_review` `start -> finalize -> validate`\./);
	assert.match(content, /Dangerous-command safety remains independent and authoritative/);
	assert.match(content, /Project and user overrides may shadow a package asset/);
});

test("managed contracts retain no fresh lifecycle review directive", () => {
	const managed = union([...ORCHESTRATOR, SDD_WORKFLOW, RELEASE_SKILL, WORKER, GENTLE_SKILL, README]);
	for (const obsolete of [
		"A fresh review still follows delegated implementation.",
		"run a fresh-context review lens unless",
		"Run a fresh review before pushing a code release",
	]) assert.ok(!managed.includes(obsolete), `managed contracts retain ${obsolete}`);
	assert.match(read(SDD_WORKFLOW), /SDD 阶段验证不启动普通评审，也不启动 Judgment Day/);
});

test("static 4R chain runs each selected lens once and owns no orchestration", () => {
	const content = read(CHAIN);
	for (const lens of ["review-risk", "review-resilience", "review-readability", "review-reliability"]) {
		assert.equal(content.split(`## ${lens}`).length - 1, 1, `${CHAIN} must run ${lens} once`);
	}
	assert.equal(content.split("所提供的 `initial_review_tree`").length - 1, 4);
	for (const forbidden of ["review-refuter", "review-validator", "fix/re-review", "Ledger persistence", "final verification"]) {
		assert.ok(!content.includes(forbidden), `${CHAIN} contains ${forbidden}`);
	}
});
