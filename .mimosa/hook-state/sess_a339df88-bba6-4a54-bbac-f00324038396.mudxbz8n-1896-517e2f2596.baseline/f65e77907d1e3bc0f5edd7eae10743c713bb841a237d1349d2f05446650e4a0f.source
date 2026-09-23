import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

// ---------------------------------------------------------------------------
// orchestrator-lazy-diet migration tests
//
// Locks the split of the always-on `assets/orchestrator.md` into a thin core
// plus lazy reference files (see design.md "Core budget rebuilt from measured
// drafts" and "Appendix: drafted core texts").
//
// `getOrchestratorPrompt`'s rendered return value is memoized in a
// module-level cache (first-read-wins for the process lifetime — see design.md
// "Test seam (JD-005)"). Tests that need alternate asset roots use the
// test-only `__testing.renderOrchestratorPrompt(assetsDir)` helper instead of
// ambient environment variables, so production runtime asset resolution stays
// deterministic. The representative production assets directory below is
// populated by COPYING the real repo assets (dynamically, at test-run time)
// into short and deliberately long tmpdir paths. This isolates byte-budget
// measurement from the real repo's absolute path length while keeping content
// representative of production. Tests that need to inspect the real repo files
// directly (the disposition-mapped union sweep, the core-alone token
// assertions) read `assets/*.md` directly via `readFileSync`, sidestepping the
// cache entirely.
// ---------------------------------------------------------------------------

const REPO_ROOT = join(import.meta.dirname, "..");
const REAL_ASSETS_DIR = join(REPO_ROOT, "assets");
const FIXTURE_PATH = join(import.meta.dirname, "fixtures", "orchestrator.pre-diet.md");
const BUDGET_BYTES = 8192;
const MIN_CONTROLLED_LONG_ASSETS_ROOT_CHARS = 93;

const LAZY_ASSET_NAMES = [
	"orchestrator.md",
	"sdd-orchestrator-workflow.md",
	"orchestrator-delegation.md",
	"orchestrator-memory.md",
	"orchestrator-skills.md",
] as const;
const LAZY_REFERENCE_FILE_NAMES = LAZY_ASSET_NAMES.slice(1);

function copyRequiredLazyAssets(destination: string): void {
	for (const name of LAZY_ASSET_NAMES) {
		const source = join(REAL_ASSETS_DIR, name);
		assert.ok(existsSync(source), `missing packaged lazy asset: ${name}`);
		copyFileSync(source, join(destination, name));
	}
}

const representativeProductionAssetsDir = mkdtempSync(join(tmpdir(), "gp-b-"));
copyRequiredLazyAssets(representativeProductionAssetsDir);
const { __testing } = await import("../extensions/jero-ai.ts");

// A controlled long assets root proves the parent prompt remains within the
// canonical budget independently of the checkout or installed-package path.
// The child-process measurement keeps production cache behavior separate from
// fixture measurements.
// The root is built to one exact length rather than "tmpdir plus a long
// suffix". The prompt declares the absolute root once, so it grows one byte
// per root character, and a 48-character macOS tmpdir pushed the previous
// construction to 164 characters where a 4-character Linux /tmp gave 121.
// A fixed length makes every platform measure the same budget claim.
const CONTROLLED_LONG_ASSETS_ROOT_CHARS = 128;
const controlledLongBaseDir = mkdtempSync(join(tmpdir(), "gp-long-"));
const controlledLongSegmentChars = CONTROLLED_LONG_ASSETS_ROOT_CHARS - join(controlledLongBaseDir, "x", "assets").length + 1;
assert.ok(
	controlledLongSegmentChars >= 1,
	`tmpdir ${tmpdir()} is too long to build a ${CONTROLLED_LONG_ASSETS_ROOT_CHARS}-char controlled assets root`,
);
const controlledLongAssetsDir = join(
	controlledLongBaseDir,
	"path-independent-prompt-budget-".repeat(Math.ceil(controlledLongSegmentChars / 31)).slice(0, controlledLongSegmentChars),
	"assets",
);
mkdirSync(controlledLongAssetsDir, { recursive: true });
assert.equal(
	controlledLongAssetsDir.length,
	CONTROLLED_LONG_ASSETS_ROOT_CHARS,
	`controlled long assets root is ${controlledLongAssetsDir.length} chars, want exactly ${CONTROLLED_LONG_ASSETS_ROOT_CHARS}`,
);
assert.ok(
	controlledLongAssetsDir.length >= MIN_CONTROLLED_LONG_ASSETS_ROOT_CHARS,
	`controlled long assets root is only ${controlledLongAssetsDir.length} chars, need >= ${MIN_CONTROLLED_LONG_ASSETS_ROOT_CHARS}`,
);
copyRequiredLazyAssets(controlledLongAssetsDir);

after(() => {
	rmSync(representativeProductionAssetsDir, { recursive: true, force: true });
	rmSync(controlledLongBaseDir, { recursive: true, force: true });
});

function readRealAsset(name: string): string {
	return readFileSync(join(REAL_ASSETS_DIR, name), "utf8");
}

function measureOrchestratorPromptBytes(assetsDir: string): number {
	const scriptPath = join(import.meta.dirname, "fixtures", "measure-orchestrator-prompt.mjs");
	const result = spawnSync(process.execPath, ["--experimental-strip-types", scriptPath, assetsDir], {
		env: process.env,
		encoding: "utf8",
	});
	assert.equal(
		result.status,
		0,
		`measure-orchestrator-prompt.mjs exited ${result.status} (stderr: ${result.stderr})`,
	);
	return Number.parseInt(result.stdout.trim(), 10);
}

// ---------------------------------------------------------------------------
// 2.2 — Byte budget (Spec: Always-On Injection Byte Budget)
// ---------------------------------------------------------------------------

// gentle-pi#661: `renderOrchestratorPrompt`/`getOrchestratorPrompt` default
// `rddStatusLine` to the "unknown (native status unavailable)" line -- the
// longest of the three renderable RDD status lines -- precisely so that a
// no-argument call renders the worst case this budget measures, not a
// smaller placeholder that production would later exceed. Assert that line
// is actually present so a future default change cannot silently start
// measuring a shorter render again.
const RDD_WORST_CASE_LINE = "Receipt-driven development: unknown (native status unavailable)";

test("getOrchestratorPrompt return value stays within the canonical 8,192 B budget at a short assets root", () => {
	const rendered = __testing.renderOrchestratorPrompt(representativeProductionAssetsDir);
	assert.ok(
		rendered.includes(RDD_WORST_CASE_LINE),
		"the default render must include the worst-case RDD status line to measure the real production budget",
	);
	const bytes = Buffer.byteLength(rendered, "utf8");
	assert.ok(
		bytes <= BUDGET_BYTES,
		`getOrchestratorPrompt() returned ${bytes} B, exceeds the ${BUDGET_BYTES} B budget`,
	);
});

test(`getOrchestratorPrompt keeps a controlled long (>= ${MIN_CONTROLLED_LONG_ASSETS_ROOT_CHARS} char) assets root within the canonical budget`, () => {
	const rendered = __testing.renderOrchestratorPrompt(controlledLongAssetsDir);
	assert.ok(
		rendered.includes(RDD_WORST_CASE_LINE),
		"the default render must include the worst-case RDD status line to measure the real production budget",
	);
	const bytes = measureOrchestratorPromptBytes(controlledLongAssetsDir);
	assert.equal(bytes, Buffer.byteLength(rendered, "utf8"), "child-process and direct render byte counts must match");
	assert.ok(
		bytes <= BUDGET_BYTES,
		`getOrchestratorPrompt() returned ${bytes} B at controlled ${controlledLongAssetsDir.length}-char assets root, exceeds the ${BUDGET_BYTES} B budget`,
	);
	assert.equal(
		rendered.split(controlledLongAssetsDir).length - 1,
		1,
		"the absolute assets root must be declared exactly once",
	);
	assert.ok(
		rendered.includes(`包资产根目录：\`${controlledLongAssetsDir}\`。下方懒加载资产路径均相对该根目录。`),
		"the parent prompt must declare how to resolve relative lazy asset paths",
	);
	for (const name of LAZY_REFERENCE_FILE_NAMES) {
		assert.ok(rendered.includes(`\`${name}\``), `lazy asset filename is missing: ${name}`);
	}
	assert.doesNotMatch(rendered, /\{\{/, "unresolved {{...}} placeholder leaked into the rendered prompt");
});

// ---------------------------------------------------------------------------
// 2.3 — Disposition-mapped union sweep (Spec: No Normative Content Loss +
// Pointer reachability)
//
// Every normative line of the frozen pre-diet fixture is assigned to a
// documented disposition: CORE_VERBATIM (byte-identical in the core),
// LAZY_VERBATIM (byte-identical in one specific lazy file), OBSOLETE
// (intentionally absent), or REPLACED (superseded by the focused #3417 asset
// policy ratchets below). REPLACED preserves the historical fixture without
// treating a retired prompt mirror as a current normative source.
// ---------------------------------------------------------------------------

type Target = "core" | "delegation" | "memory" | "skills";

interface DispositionRange {
	lines: [number, number];
	target: Target | "obsolete" | "replaced";
	label: string;
}

const TARGET_FILE: Record<Target, string> = {
	core: "orchestrator.md",
	delegation: "orchestrator-delegation.md",
	memory: "orchestrator-memory.md",
	skills: "orchestrator-skills.md",
};

// Line numbers below are 1-indexed against tests/fixtures/orchestrator.pre-diet.md
// (frozen byte-identical copy of assets/orchestrator.md at 23,047 B / 312 lines).
const DISPOSITION_MAP: DispositionRange[] = [
	{ lines: [1, 4], target: "core", label: "Header + bind" },
	{ lines: [5, 8], target: "core", label: "Identity Contract" },
	{ lines: [9, 13], target: "core", label: "Core Role" },
	{ lines: [15, 15], target: "core", label: "Language Boundary heading" },
	{ lines: [17, 17], target: "core", label: "Language Boundary LB1 pointer" },
	{ lines: [19, 19], target: "delegation", label: "Language Boundary LB2 (subagent-English)" },
	{ lines: [21, 21], target: "core", label: "Language Boundary LB3 (artifact language)" },
	{ lines: [23, 23], target: "core", label: "Language Boundary LB4 (public comment language)" },
	{ lines: [25, 29], target: "delegation", label: "Language Boundary LB5 (exceptions)" },
	{ lines: [31, 40], target: "core", label: "Mental Model" },
	{ lines: [42, 42], target: "core", label: "Work Routing Ladder heading" },
	{
		lines: [44, 97],
		target: "replaced",
		label: "Pre-RDD routing detail replaced by focused direct-delegation guidance (#3417)",
	},
	{
		lines: [98, 107],
		target: "obsolete",
		label: "Size/risk-selected SDD tier replaced by explicit-request/accepted-proposal selection (#312)",
	},
	{
		lines: [108, 108],
		target: "replaced",
		label: "Earlier SDD trigger wording replaced by the focused SDD boundary (#3417)",
	},
	{
		lines: [109, 110],
		target: "obsolete",
		label: "Size-gated SDD entry replaced by explicit-selection gating (#312)",
	},
	{ lines: [112, 112], target: "core", label: "Delegation Rules heading" },
	{ lines: [114, 114], target: "core", label: "Delegation Rules core question" },
	{
		lines: [116, 126],
		target: "obsolete",
		label: "Pre-canon delegation table replaced by the mirrored gentle-ai canon table (#312)",
	},
	{
		lines: [128, 132],
		target: "replaced",
		label: "Pre-RDD trigger wording replaced by focused direct-delegation guidance (#3417)",
	},
	{
		lines: [133, 133],
		target: "obsolete",
		label: "Superseded no-runtime inline exception",
	},
	{
		lines: [134, 167],
		target: "replaced",
		label: "Pre-RDD trigger and workflow wording replaced by focused delegation guidance (#3417)",
	},
	{
		lines: [169, 181],
		target: "obsolete",
		label: "Parent-selected review lens table replaced by native RAR lens ownership (#312)",
	},
	{ lines: [183, 191], target: "core", label: "SDD Workflow pointer" },
	{ lines: [193, 193], target: "core", label: "Memory Contract heading" },
	{
		lines: [195, 195],
		target: "replaced",
		label: "Verbose memory introduction replaced by compact parent/subagent ownership (#3417)",
	},
	{
		lines: [197, 201],
		target: "replaced",
		label: "Verbose non-SDD memory forwarding replaced by compact ownership (#3417)",
	},
	{ lines: [203, 230], target: "memory", label: "Memory Contract SDD phases table + artifact keys + lifecycle rule" },
	{ lines: [232, 232], target: "core", label: "Skill Registry Protocol heading" },
	{ lines: [234, 253], target: "skills", label: "Skill Registry Protocol detail" },
	{ lines: [255, 255], target: "core", label: "Intent-Driven Skill Discovery heading" },
	{ lines: [257, 276], target: "skills", label: "Intent-Driven Skill Discovery detail" },
	{ lines: [278, 283], target: "core", label: "Safety" },
	{ lines: [285, 312], target: "obsolete", label: "Superseded pre-transaction review contract" },
];

function isNormativeLine(line: string): boolean {
	const trimmed = line.trim();
	if (trimmed.length === 0) return false;
	if (trimmed.startsWith("```")) return false;
	if (/^\|[\s\-:|]+\|$/.test(trimmed)) return false;
	return true;
}

const fixtureLines = readFileSync(FIXTURE_PATH, "utf8").split("\n");
// i18n pass: the live model-facing assets (core/delegation/memory/skills) are
// Simplified Chinese now, so the frozen English pre-diet fixture no longer has
// byte-identical counterparts to assert against. Every non-obsolete
// disposition is superseded wholesale by the Chinese translation; only the
// "obsolete" absence guards below stay active, since no retired English line
// may resurface in the Chinese assets either. Current-asset coverage lives in
// the focused Chinese assertions at the bottom of this file.
const SUPERSEDED_LIFECYCLE_REVIEW_LINES = new Set([
	70,
	// 74/77: the loose mode-choice background lines were replaced by the
	// marked gentle-pi:background-subagents policy block (issue #256).
	74,
	76,
	77,
	92,
	125,
	126,
	133,
	134,
	135,
	137,
	145,
	154,
	160,
	166,
	// 222-230: the Engram lifecycle rule (injected review tool, active/
	// needs_review states, mark_reviewed) was replaced by the jero-pi memory
	// staleness rule when the external Engram provider became the built-in
	// mem_* store, which has no lifecycle tooling.
	222,
	223,
	224,
	225,
	226,
	227,
	228,
	229,
	230,
]);

for (const range of DISPOSITION_MAP) {
	// i18n pass: see the note above SUPERSEDED_LIFECYCLE_REVIEW_LINES — only
	// the "obsolete" absence guards remain meaningful against the Chinese
	// assets; every verbatim-survival disposition is superseded.
	if (range.target !== "obsolete") continue;
	test(
		`disposition-mapped absence: ${range.label} (fixture:${range.lines[0]}-${range.lines[1]}) stays retired`,
		() => {
			const targetContent = Object.values(TARGET_FILE).map(readRealAsset).join("\n");
			for (let ln = range.lines[0]; ln <= range.lines[1]; ln++) {
				const raw = fixtureLines[ln - 1];
				if (raw === undefined || !isNormativeLine(raw)) continue;
				const trimmed = raw.trim();
				assert.ok(
					!targetContent.includes(trimmed),
					`obsolete line retained: fixture:${ln} "${trimmed}" remains in a live model-facing asset (section: ${range.label})`,
				);
			}
		},
	);
}

// ---------------------------------------------------------------------------
// 2.4 — Core-alone load-bearing tokens (JD-007) — assert on the raw core
// string alone, no lazy union.
// ---------------------------------------------------------------------------

test("core-alone: load-bearing direct-delegation tokens remain without lazy union", () => {
	const core = readRealAsset("orchestrator.md");
	// i18n pass: the core is Simplified Chinese; the rule names assert their
	// Chinese wording.
	assert.match(core, /4 文件规则/);
	assert.match(core, /多文件写入规则/);
	assert.match(core, /事故规则/);
	assert.match(core, /验证规则/);
	assert.match(core, /长会话规则/);
});

test("core-alone: dynamic Gentle AI ownership replaces package lifecycle instructions", () => {
	const core = readRealAsset("orchestrator.md");
	assert.match(core, /把镜像的提供方捆绑评审执行契约注入本会话系统提示/);
	assert.match(core, /缺少该镜像契约时，本包不发明生命周期指令/);
	assert.doesNotMatch(core, /start -> finalize -> validate/i);
	assert.doesNotMatch(core, /receipt validation/i);
});

test("lazy delegation detail has no native RDD controller markers", () => {
	const delegation = readRealAsset("orchestrator-delegation.md");
	for (const marker of ["next_transition", "review.capture-result", "reconcile-terminal-mirrors"]) {
		assert.ok(!delegation.includes(marker), `stale RDD marker retained: ${marker}`);
	}
});

test("live orchestrator assets remove the stale strong-gate retry contract", () => {
	const content = `${readRealAsset("orchestrator.md")}\n${readRealAsset("orchestrator-delegation.md")}`;
	assert.doesNotMatch(content, /strong gate/i);
	assert.doesNotMatch(content, /extension blocks.*gh pr create/i);
	assert.doesNotMatch(content, /before the user retries the PR command/i);
	assert.doesNotMatch(content, /validateTriggerRuleSet/);
	assert.doesNotMatch(content, /exactly three parallel refuters|two of three valid `refuted`/i);
	assert.doesNotMatch(content, /review advice never/i);
});

// ---------------------------------------------------------------------------
// 2.5 — No double-delivery (Spec: No Double-Delivery of On-Demand Content)
// ---------------------------------------------------------------------------

test("relocated lazy bodies are not double-delivered in the always-on core", () => {
	const rendered = __testing.getOrchestratorPrompt();
	assert.doesNotMatch(
		rendered,
		/### Canonical Lightweight Workflows/,
		"delegation-only body leaked into the always-on core",
	);
	assert.doesNotMatch(
		rendered,
		/### Pi Subagent Model Routing/,
		"delegation-only body leaked into the always-on core",
	);
	assert.doesNotMatch(
		rendered,
		/### SDD phases/,
		"memory-only body leaked into the always-on core",
	);
	assert.doesNotMatch(
		rendered,
		/Common intent hints, not hard routing:/,
		"skills-only body leaked into the always-on core",
	);
});

test("relocated lazy files are reachable via root-relative in-core filenames", () => {
	const rendered = __testing.getOrchestratorPrompt();
	for (const name of LAZY_REFERENCE_FILE_NAMES) {
		assert.ok(rendered.includes(`\`${name}\``), `core is missing a reachable pointer to ${name}`);
	}
});

// ---------------------------------------------------------------------------
// 2.6 — Cache and path-substitution integrity (Spec: Cache and Path
// Substitution Integrity)
// ---------------------------------------------------------------------------

test("getOrchestratorPrompt substitutes every placeholder", () => {
	const rendered = __testing.getOrchestratorPrompt();
	assert.doesNotMatch(rendered, /\{\{/, "unresolved {{...}} placeholder leaked into the rendered prompt");
});

test("getOrchestratorPrompt memoizes the return across calls", () => {
	const first = __testing.getOrchestratorPrompt();
	const second = __testing.getOrchestratorPrompt();
	assert.equal(second, first, "second call must return the memoized string");
});

// ---------------------------------------------------------------------------
// gentle-pi#661 follow-up: byte-budget compression must not turn a pointer
// into an opaque "Detail: `file.md`" -- each pointer line must still name
// the lazy-loaded material it points to, in the shortest form that still
// says what is over there.
// ---------------------------------------------------------------------------

test("every compressed lazy-file pointer in the core still names the material it points to", () => {
	const core = readFileSync(join(REAL_ASSETS_DIR, "orchestrator.md"), "utf8");
	// One-sentence "<named material>: `file.md`." pointers, compressed for the
	// byte budget -- each must keep naming what is over there, not collapse
	// to an opaque "Detail: `file.md`.".
	const namedPointers: ReadonlyArray<{ file: string; mustName: readonly string[] }> = [
		{
			file: "orchestrator-delegation.md",
			mustName: ["逐动作表", "工作路由阶梯", "权威工作流", "阻塞提示中继"],
		},
		{
			file: "orchestrator-memory.md",
			mustName: ["阶段表", "产物键"],
		},
		{
			file: "orchestrator-skills.md",
			mustName: ["发现顺序", "意图提示"],
		},
	];
	for (const { file, mustName } of namedPointers) {
		// The pointer sentence: from the previous sentence boundary up to and
		// including the backtick-quoted filename. `orchestrator-delegation.md`
		// is referenced more than once in the core (a language-boundary pointer
		// earlier, this compressed per-action pointer later) -- take the LAST
		// occurrence, which is the one under test here. Sentence boundaries may
		// be ASCII periods or Chinese full stops (i18n pass).
		const fileToken = `\`${file}\``;
		const fileIndex = core.lastIndexOf(fileToken);
		assert.ok(fileIndex >= 0, `core is missing a pointer to ${file}`);
		const sentenceStart = Math.max(core.lastIndexOf(".", fileIndex), core.lastIndexOf("。", fileIndex));
		const pointerSentence = core.slice(sentenceStart + 1, fileIndex + fileToken.length);
		for (const name of mustName) {
			assert.ok(
				pointerSentence.includes(name),
				`the pointer to ${file} must name "${name}", got: ${JSON.stringify(pointerSentence.trim())}`,
			);
		}
	}
	// The SDD workflow pointer was never compressed to a bare filename; its
	// surrounding paragraphs already name the material at length (Chinese
	// wording after the i18n pass).
	assert.match(
		core,
		/SDD 阶段、原生派发器规则、状态契约、预检\/init 守卫、产物存储策略、执行模式、Strict TDD 转发、阶段结果契约与评审负载守卫/,
	);
});
