// 委托派发放行：SDD 代理名、有界 writer 的编辑面校验、Judgment Day 修复代理的规范块校验，以及子代理能力探测。
// 自 extensions/jero-ai.ts 拆分（机械平移，语义零改动）。

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { canonicalHash } from "./review-transaction.ts";

import type { BackgroundSubagentsCapability, BackgroundSubagentsRendering } from "./jero-ai-background-subagents.ts";
import { builtinAgentDirs } from "./jero-ai-model-config.ts";
import { PACKAGE_ROOT } from "./jero-ai-package-assets.ts";
import { isRecord } from "./jero-ai-persona-config.ts";
import { renderRddStatusLine, resolveRddModeStatus } from "./jero-ai-rdd-status.ts";
import { SDD_AGENT_NAME_SET } from "./jero-ai-sdd-startup.ts";


const SUBAGENTS_PACKAGE_NAMES = ["pi-subagents-j0k3r", "pi-subagents"] as const;

const SUBAGENT_RUN_TOOL = "subagent_run";

const JUDGMENT_DAY_FIX_AGENT_NAME = "jd-fix-agent";

const BOUNDED_WRITER_AGENT_NAMES = ["jero-worker", "worker", JUDGMENT_DAY_FIX_AGENT_NAME] as const;

const JUDGMENT_DAY_ACTIVATION_HEADING = "## Judgment Day activation";

const JUDGMENT_DAY_ACTIVATION_SENTENCE = "User explicitly requested Judgment Day.";

const JUDGMENT_DAY_AUTHORIZED_SEVERE_IDS_HEADING = "## Exact authorized severe IDs";

const JUDGMENT_DAY_CORRECTION_BATCH_HEADING = "## Judgment Day correction batch";

const JUDGMENT_DAY_FROZEN_FINDING_ROWS_HEADING = "## Exact frozen finding rows";

const ALLOWED_EDIT_SURFACES_HEADING = /^## Allowed edit surfaces[ \t]*$/gim;

const MARKDOWN_HEADING_LINE = /^ {0,3}#{1,6} /;

const MARKDOWN_LIST_MARKER = /^(?:[-*+]|\d+[.)]) +/;

const WRITER_EDIT_SURFACE_REJECTION =
	"写者任务必须包含精确的 Markdown 标题 `## Allowed edit surfaces`，其中列出狭窄的仓库相对路径或狭窄的 glob，每行一条。直到下一个规范 Markdown 标题之前的每个非空行都属于该小节，且必须是有效的编辑面条目。包含空白字符的路径需要整条反引号包裹；解释性文字请放在下一个 Markdown 标题之下。父会话必须从被委托的任务推导或映射出该规范块并重新启动写者；不接受别名，也不要让人类来编写路径或 glob。";



function isTaskScopedRepositoryRelativePath(value: string, isWholeEntryBackticked: boolean): boolean {
	const normalized = value.replace(/\\/g, "/");
	if (
		normalized.length === 0 ||
		isAbsolute(value) ||
		/^(?:[A-Za-z]:|\/|~)/.test(normalized) ||
		/\p{Cc}|\p{Zl}|\p{Zp}/u.test(normalized) ||
		(/\p{White_Space}/u.test(normalized) && !isWholeEntryBackticked)
	) {
		return false;
	}

	const withoutCurrentDirectory = normalized.replace(/^(?:\.\/)+/, "");
	if (
		withoutCurrentDirectory.length === 0 ||
		withoutCurrentDirectory === "." ||
		withoutCurrentDirectory.startsWith("/") ||
		withoutCurrentDirectory.split("/").some((segment) => segment === "..")
	) {
		return false;
	}

	return !/[?*\[\]{}]/.test(withoutCurrentDirectory.split("/")[0]);
}



type AllowedEditSurfaceEntry = {
	source: string;
	value: string;
	isWholeEntryBackticked: boolean;
	isValidMarkdownSyntax: boolean;
};

/** 读取一个条目，并记录反引号是否包裹了整条路径。 */


/** 读取一个条目，并记录反引号是否包裹了整条路径。 */
function readSurfaceEntry(line: string): AllowedEditSurfaceEntry {
	const withoutListMarker = line.replace(MARKDOWN_LIST_MARKER, "");
	const backticked = withoutListMarker.match(/^`([^`]+)`$/);
	return {
		source: line,
		value: backticked?.[1] ?? withoutListMarker,
		isWholeEntryBackticked: backticked !== null,
		isValidMarkdownSyntax:
			!/^(?:[-*+]|\d+[.)])$/.test(line) && (!withoutListMarker.includes("`") || backticked !== null),
	};
}

/**
 * 把直到下一个 Markdown 标题之前的每个非空行都读取为一个编辑面。
 * 普通散文行不能终止该小节：它必须以校验失败收场。
 */


/**
 * 把直到下一个 Markdown 标题之前的每个非空行都读取为一个编辑面。
 * 普通散文行不能终止该小节：它必须以校验失败收场。
 */
function readAllowedEditSurfaceEntries(following: string): AllowedEditSurfaceEntry[] {
	const lines = following.split(/\r?\n/);
	const headingIndex = lines.findIndex((line) => MARKDOWN_HEADING_LINE.test(line));
	return (headingIndex === -1 ? lines : lines.slice(0, headingIndex))
		.map((line) => line.replace(/ +$/g, ""))
		.filter((line) => line.length > 0)
		.map((line) => readSurfaceEntry(line.replace(/^ {0,3}/, "")));
}



function hasTaskScopedAllowedEditSurfaces(...values: unknown[]): boolean {
	let expectedEntries: string[] | undefined;
	let hasSection = false;

	for (const value of values) {
		if (typeof value !== "string") continue;

		const headings = value.matchAll(ALLOWED_EDIT_SURFACES_HEADING);
		for (const heading of headings) {
			const bodyStart = (heading.index ?? 0) + heading[0].length;
			const entries = readAllowedEditSurfaceEntries(value.slice(bodyStart));
			if (
				entries.length === 0 ||
				!entries.every(
					(entry) =>
						entry.isValidMarkdownSyntax &&
						!/\p{Cc}|\p{Zl}|\p{Zp}/u.test(entry.source) &&
						isTaskScopedRepositoryRelativePath(entry.value, entry.isWholeEntryBackticked),
				)
			) {
				return false;
			}

			const uniqueEntries = [...new Set(entries.map((entry) => entry.value))].sort();
			if (
				expectedEntries &&
				(expectedEntries.length !== uniqueEntries.length ||
					expectedEntries.some((entry, index) => entry !== uniqueEntries[index]))
			) {
				return false;
			}
			expectedEntries = uniqueEntries;
			hasSection = true;
		}
	}

	return hasSection;
}



export function sddDispatchAgentName(input: unknown): string | undefined {
	if (!isRecord(input)) return undefined;
	if (typeof input.agent === "string" && SDD_AGENT_NAME_SET.has(input.agent)) return input.agent;
	if (Array.isArray(input.agent) && input.agent.some((agent) => typeof agent === "string" && SDD_AGENT_NAME_SET.has(agent))) {
		return "invalid";
	}
	return undefined;
}



export function rejectUnscopedBoundedWriterDispatch(input: unknown): { block: true; reason: string } | undefined {
	if (
		!isRecord(input) ||
		typeof input.agent !== "string" ||
		!(BOUNDED_WRITER_AGENT_NAMES as readonly string[]).includes(input.agent)
	) {
		return undefined;
	}
	if (hasTaskScopedAllowedEditSurfaces(input.task, input.context)) {
		return undefined;
	}
	return { block: true, reason: WRITER_EDIT_SURFACE_REJECTION };
}



function hasJudgmentDayFixAgentReference(input: Record<string, unknown>): boolean {
	return input.agent === JUDGMENT_DAY_FIX_AGENT_NAME ||
		(Array.isArray(input.agent) && input.agent.includes(JUDGMENT_DAY_FIX_AGENT_NAME)) ||
		input.agents === JUDGMENT_DAY_FIX_AGENT_NAME ||
		(Array.isArray(input.agents) && input.agents.includes(JUDGMENT_DAY_FIX_AGENT_NAME));
}



function canonicalJudgmentDaySectionBodies(value: unknown, heading: string): string[][] {
	if (typeof value !== "string") return [];
	const headingPattern = new RegExp(`^${heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "gm");
	return [...value.matchAll(headingPattern)].map((match) => {
		const body = value.slice((match.index ?? 0) + match[0].length);
		const nextHeading = body.search(/^ {0,3}#{1,6} /m);
		return body
			.slice(0, nextHeading === -1 ? undefined : nextHeading)
			.split(/\r?\n/)
			.filter((line) => line.length > 0);
	});
}



const JUDGMENT_DAY_SEVERE_ID_ENTRY = /^- `(JD-[A-Z][A-Z0-9]*-\d+)`$/;

const JUDGMENT_DAY_CORRECTION_ROUND_ENTRY = /^Round: [12] of 2\.$/;

const JUDGMENT_DAY_FROZEN_LEDGER_SHA256_ENTRY = /^Frozen ledger SHA-256: `([0-9a-f]{64})`$/;

const JUDGMENT_DAY_FROZEN_ROW_FIELDS = [
	"id",
	"lens",
	"location",
	"severity",
	"status_at_freeze",
	"evidence_class",
	"evidence_claim",
] as const;

const JUDGMENT_DAY_FIX_SECTION_HEADINGS = [
	JUDGMENT_DAY_ACTIVATION_HEADING,
	JUDGMENT_DAY_AUTHORIZED_SEVERE_IDS_HEADING,
	JUDGMENT_DAY_CORRECTION_BATCH_HEADING,
	JUDGMENT_DAY_FROZEN_FINDING_ROWS_HEADING,
	"## Allowed edit surfaces",
] as const;



function canonicalJudgmentDaySevereIds(entries: readonly string[]): string[] | undefined {
	const ids = entries.map((entry) => entry.match(JUDGMENT_DAY_SEVERE_ID_ENTRY)?.[1]);
	return ids.length > 0 && ids.every((id): id is string => id !== undefined) && new Set(ids).size === ids.length
		? ids
		: undefined;
}



function canonicalJudgmentDayCorrectionBatchHash(entries: readonly string[]): string | undefined {
	if (entries.length !== 2 || !JUDGMENT_DAY_CORRECTION_ROUND_ENTRY.test(entries[0]!)) return undefined;
	return entries[1]!.match(JUDGMENT_DAY_FROZEN_LEDGER_SHA256_ENTRY)?.[1];
}



function isNonEmptyJudgmentDayFrozenField(value: unknown): value is string {
	return typeof value === "string" && value.trim().length > 0;
}



function parseCanonicalJudgmentDayFrozenRows(
	entries: readonly string[],
	authorizedIds: readonly string[],
): Record<string, unknown>[] | undefined {
	if (entries.length !== authorizedIds.length) return undefined;
	const rows: Record<string, unknown>[] = [];
	const rowIds: string[] = [];
	for (const entry of entries) {
		let row: unknown;
		try {
			row = JSON.parse(entry) as unknown;
		} catch {
			return undefined;
		}
		if (!isRecord(row)) return undefined;
		const keys = Object.keys(row);
		if (keys.length !== JUDGMENT_DAY_FROZEN_ROW_FIELDS.length ||
			!JUDGMENT_DAY_FROZEN_ROW_FIELDS.every((field) => field in row) ||
			!isNonEmptyJudgmentDayFrozenField(row.id) ||
			!JUDGMENT_DAY_SEVERE_ID_ENTRY.test(`- \`${row.id}\``) ||
			row.lens !== "judgment-day" ||
			!isNonEmptyJudgmentDayFrozenField(row.location) ||
			(row.severity !== "BLOCKER" && row.severity !== "CRITICAL") ||
			row.status_at_freeze !== "open" ||
			!isNonEmptyJudgmentDayFrozenField(row.evidence_class) ||
			!isNonEmptyJudgmentDayFrozenField(row.evidence_claim)
		) return undefined;
		rows.push(row);
		rowIds.push(row.id);
	}
	return new Set(rowIds).size === rowIds.length &&
		rowIds.every((id, index) => id === authorizedIds[index])
		? rows
		: undefined;
}



function hasCanonicalJudgmentDayFixSectionOrder(...values: unknown[]): boolean {
	const dispatch = values.filter((value): value is string => typeof value === "string").join("\n");
	let previousPosition = -1;
	for (const heading of JUDGMENT_DAY_FIX_SECTION_HEADINGS) {
		const matches = [...dispatch.matchAll(new RegExp(`^${heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "gm"))];
		if (matches.length !== 1 || (matches[0]!.index ?? -1) <= previousPosition) return false;
		previousPosition = matches[0]!.index ?? -1;
	}
	return true;
}



function hasCanonicalJudgmentDayFixActivation(...values: unknown[]): boolean {
	const hasMalformedHeading = values.some((value) =>
		typeof value === "string" && value.split(/\r?\n/).some((line) => {
			const candidate = line.match(/^ {0,3}#{1,6} (Judgment Day activation|Exact authorized severe IDs|Judgment Day correction batch|Exact frozen finding rows)[ \t]*$/i);
			return candidate !== null &&
				line !== JUDGMENT_DAY_ACTIVATION_HEADING &&
				line !== JUDGMENT_DAY_AUTHORIZED_SEVERE_IDS_HEADING &&
				line !== JUDGMENT_DAY_CORRECTION_BATCH_HEADING &&
				line !== JUDGMENT_DAY_FROZEN_FINDING_ROWS_HEADING;
		}),
	);
	const activationBodies = values.flatMap((value) =>
		canonicalJudgmentDaySectionBodies(value, JUDGMENT_DAY_ACTIVATION_HEADING),
	);
	const severeIdBodies = values.flatMap((value) =>
		canonicalJudgmentDaySectionBodies(value, JUDGMENT_DAY_AUTHORIZED_SEVERE_IDS_HEADING),
	);
	const correctionBatchBodies = values.flatMap((value) =>
		canonicalJudgmentDaySectionBodies(value, JUDGMENT_DAY_CORRECTION_BATCH_HEADING),
	);
	const frozenFindingRowBodies = values.flatMap((value) =>
		canonicalJudgmentDaySectionBodies(value, JUDGMENT_DAY_FROZEN_FINDING_ROWS_HEADING),
	);
	const authorizedIds = severeIdBodies.length === 1
		? canonicalJudgmentDaySevereIds(severeIdBodies[0]!)
		: undefined;
	const correctionBatchHash = correctionBatchBodies.length === 1
		? canonicalJudgmentDayCorrectionBatchHash(correctionBatchBodies[0]!)
		: undefined;
	const frozenFindingRows = authorizedIds !== undefined && frozenFindingRowBodies.length === 1
		? parseCanonicalJudgmentDayFrozenRows(frozenFindingRowBodies[0]!, authorizedIds)
		: undefined;
	return !hasMalformedHeading && hasCanonicalJudgmentDayFixSectionOrder(...values) &&
		activationBodies.length === 1 &&
		activationBodies[0]!.length === 1 &&
		activationBodies[0]![0] === JUDGMENT_DAY_ACTIVATION_SENTENCE &&
		authorizedIds !== undefined && correctionBatchHash !== undefined &&
		frozenFindingRows !== undefined && correctionBatchHash === canonicalHash(frozenFindingRows);
}



const JUDGMENT_DAY_FIX_DISPATCH_REJECTION =
	"Judgment Day 修复派发要求：恰好一个 `agent: \"jd-fix-agent\"`；一个精确的 `## Judgment Day activation` 小节，其中仅含 `User explicitly requested Judgment Day.`；一个非空、无重复的规范 `## Exact authorized severe IDs` 小节；一个精确的 `## Judgment Day correction batch` 小节，带 `Round: 1 of 2.` 或 `Round: 2 of 2.` 以及相匹配的规范小写 SHA-256，对应一个精确的 `## Exact frozen finding rows` 小节，其处于 open 状态的 BLOCKER/CRITICAL Judgment Day 行与授权 ID 逐一对应且顺序一致；以及既有的精确 `## Allowed edit surfaces` 守卫。父会话必须提供规范的有界派发；不要自行推断激活、授权或冻结发现。";



export function rejectInvalidJudgmentDayFixDispatch(input: unknown): { block: true; reason: string } | undefined {
	if (!isRecord(input) || !hasJudgmentDayFixAgentReference(input)) return undefined;
	if (
		input.agent === JUDGMENT_DAY_FIX_AGENT_NAME &&
		!("agents" in input) &&
		hasCanonicalJudgmentDayFixActivation(input.task, input.context) &&
		hasTaskScopedAllowedEditSurfaces(input.task, input.context)
	) {
		return undefined;
	}
	return { block: true, reason: JUDGMENT_DAY_FIX_DISPATCH_REJECTION };
}

/**
 * 已安装子代理包可能所在的根目录。这些根目录与 builtinAgentDirs()
 * 遍历的相同，仅去掉了其 `/agents` 后缀。
 *
 * builtinAgentDirs() 查找的是 markdown 代理定义，而该包完全可能
 * 合法地不附带。能力探测是另一个问题，因此不能复用那条路径：
 * pi-subagents-j0k3r v1.5.2 携带 index.ts、src/、skills/
 * 和 scripts/，根本没有 agents/ 目录，所以按 agents 目录探测会在
 * 每个真实安装上都报告 "absent"，让后台策略形同虚设。
 */


/**
 * 已安装子代理包可能所在的根目录。这些根目录与 builtinAgentDirs()
 * 遍历的相同，仅去掉了其 `/agents` 后缀。
 *
 * builtinAgentDirs() 查找的是 markdown 代理定义，而该包完全可能
 * 合法地不附带。能力探测是另一个问题，因此不能复用那条路径：
 * pi-subagents-j0k3r v1.5.2 携带 index.ts、src/、skills/
 * 和 scripts/，根本没有 agents/ 目录，所以按 agents 目录探测会在
 * 每个真实安装上都报告 "absent"，让后台策略形同虚设。
 */
function subagentsPackageRoots(cwd: string): string[] {
	return SUBAGENTS_PACKAGE_NAMES.flatMap((packageName) => [
		join(PACKAGE_ROOT, "..", packageName),
		join(cwd, ".pi", "npm", "node_modules", packageName),
		join(homedir(), ".local", "lib", "node_modules", packageName),
	]);
}

/** 一个包根目录只有在携带自身 manifest 时才算已安装。 */


/** 一个包根目录只有在携带自身 manifest 时才算已安装。 */
function hasInstalledSubagentsPackage(cwd: string): boolean {
	return subagentsPackageRoots(cwd).some((root) =>
		existsSync(join(root, "package.json")),
	);
}



function hasSubagentRunTool(activeTools: readonly string[]): boolean {
	return activeTools.some(
		(name) => name === SUBAGENT_RUN_TOOL || name.endsWith(`.${SUBAGENT_RUN_TOOL}`),
	);
}

/**
 * 读取实时的 pi 工具注册表，当它不携带任何信号时返回 undefined。
 *
 * 句柄缺失、结果不是数组、注册表抛错、列表为空，都属于“没有信号”
 * 而不是“没有子代理”：从一个不提供信息的注册表得出 absent 的结论，
 * 会复现本探测所要修复的缺陷本身。
 */


/**
 * 读取实时的 pi 工具注册表，当它不携带任何信号时返回 undefined。
 *
 * 句柄缺失、结果不是数组、注册表抛错、列表为空，都属于“没有信号”
 * 而不是“没有子代理”：从一个不提供信息的注册表得出 absent 的结论，
 * 会复现本探测所要修复的缺陷本身。
 */
export function readActiveToolNames(pi: unknown): readonly string[] | undefined {
	try {
		const getActiveTools = (pi as { getActiveTools?: () => unknown })
			?.getActiveTools;
		if (typeof getActiveTools !== "function") return undefined;
		const tools = getActiveTools.call(pi);
		if (!Array.isArray(tools)) return undefined;
		const names = tools
			.map((tool) =>
				typeof tool === "string"
					? tool
					: isRecord(tool) && typeof tool.name === "string"
						? tool.name
						: "",
			)
			.filter((name) => name.length > 0);
		return names.length > 0 ? names : undefined;
	} catch {
		return undefined;
	}
}

/**
 * `subagent_run` 可用性探测。
 *
 * 实时工具注册表直接回答这个问题，只要携带任何信号就以其为准。
 * 没有它时——会话之外的提示词渲染，或没有 getActiveTools 的
 * 运行时——能力回退为是否安装了子代理包。
 */


/**
 * `subagent_run` 可用性探测。
 *
 * 实时工具注册表直接回答这个问题，只要携带任何信号就以其为准。
 * 没有它时——会话之外的提示词渲染，或没有 getActiveTools 的
 * 运行时——能力回退为是否安装了子代理包。
 */
export function resolveBackgroundSubagentsCapability(
	cwd: string,
	activeTools?: readonly string[],
): BackgroundSubagentsCapability {
	try {
		if (activeTools !== undefined && activeTools.length > 0) {
			return hasSubagentRunTool(activeTools) ? "ready" : "absent";
		}
		return hasInstalledSubagentsPackage(cwd) ? "ready" : "absent";
	} catch {
		return "absent";
	}
}



export function renderBackgroundSubagentsStatusLine(
	background: BackgroundSubagentsRendering,
): string {
	return `Background subagent policy: ${background.policy} (capability: ${background.capability})`;
}

/**
 * 只有当 `effective` 恰为 `on`/`off` 且 `source` 是导出的
 * `NATIVE_REVIEW_MODE_SOURCE` 值之一时，`status` 对象才可信。
 * `resolveRddModeStatus` 只会产生这种形态的值，但
 * `renderRddStatusLine` 仍在渲染边界做校验——畸形或不完整的对象
 * （上游解码出错、未来的字段变更、手工构造的测试 fixture）必须
 * 保守失败为 "unknown" 行，绝不原样渲染一个无法识别的值。
 */
