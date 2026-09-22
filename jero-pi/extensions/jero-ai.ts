import { consumeReviewMutation, pendingReviewMutation, recordReviewMutation } from "../lib/review-reminder-receipt.ts";
import { resolveSessionWorktree } from "../lib/session-worktree-registry.ts";
import { resolveResearchCapabilities, renderResearchCapabilities } from "../lib/sdd-research-capabilities.ts";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import {
	existsSync,
	lstatSync,
	mkdtempSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import {
	access,
	mkdir,
	readFile,
	readdir,
	writeFile,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type {
	ExtensionAPI,
	ExtensionContext,
	Theme,
	ThemeColor,
	ToolCallEventResult,
} from "@earendil-works/pi-coding-agent";
import { Key, isKeyRelease, matchesKey, truncateToWidth, type KeybindingsManager, type TuiMouseEvent, type TuiMouseEventResult } from "@earendil-works/pi-tui";
import { resolveGentlePiAgentHome } from "../lib/agent-home.ts";
import {
	ensureSddPreflight,
	getSddPreflightPreferences,
	installPackageAssets,
	getPackageAssetOwner,
	hasPackageAssetOwnerInstallation,
	type PackageAssetOwner,
	isPackageManagedSddAsset,
	isSddPreflightTrigger,
	renderSddPreflightPrompt,
	isParentConfirmedSddPreflightContext,
	SHIPPED_SDD_AGENT_NAMES,
	SDD_PREFLIGHT_FIELDS,
	type SddPreflightField,
	type SddPreflightPreferences,
	updatePackageManagedSddAgentOwnership,
} from "../lib/sdd-preflight.ts";
import {
	THINKING_LEVELS,
	normalizeModelConfig,
	normalizeModelId,
	normalizeRoutingEntry,
	readSavedModelConfig as readModelRoutingAuthority,
	readSavedModelConfigAsync as readModelRoutingAuthorityAsync,
	type AgentModelConfig,
	type AgentRoutingEntry,
	type ModelConfigFileResult,
	type ThinkingLevel,
} from "../lib/model-routing-authority.ts";
import {
	bootstrapProfilesFile,
	buildProfileListItems,
	createProfile,
	deleteProfile,
	duplicateProfile,
	formatOrchestratorSelection,
	formatRoutingRow,
	isProfileOrchestratorKey,
	parseProfileExportTextWithDrops,
	PROFILE_ORCHESTRATOR_KEY,
	profileExportPath,
	profileRoutingRows,
	profilesFilePath,
	readProfileOrchestrator,
	readProfilesFileResult,
	renameProfile,
	routingColumnWidths,
	serializeProfileExport,
	setActiveProfile,
	updateProfile,
	writeProfilesFileSync,
	type AgentProfilesFile,
	type ProfileListItem,
	type ProfileRoutingRow,
	type ProfilesParseDrops,
} from "../lib/agent-profiles.ts";
import {
	applyOrchestratorSettings,
	readOrchestratorSettings,
	restoreOrchestratorSettings,
	type OrchestratorSettingsReadResult,
} from "../lib/profiles-orchestrator.ts";
import { measureAgentsViewLayout, type AgentsViewLayout } from "../lib/agents-view-layout.ts";
import { NativeChoiceList } from "../lib/native-choice-list.ts";
import { createNativeFullscreenInteraction } from "../lib/native-fullscreen-interaction.ts";
import {
	parseSddStatusCommandArgs,
	renderNativeSddPhasePrompt,
	resolveSddStatus,
	type SddPhase,
} from "../lib/sdd-status.ts";
import {
	REVIEW_HOST_RELAY_FAILURE,
	REVIEW_HOST_RELAY_PI_TIMEOUT_ENV,
	REVIEW_HOST_RELAY_PI_TIMEOUT_MAX_MS,
	REVIEW_HOST_RELAY_SUBMISSION_MISSING_MESSAGE,
	REVIEW_HOST_RELAY_UNAVAILABLE_MESSAGE,
	ReviewHostRelayError,
	reviewHostRelaySlots,
	reviewHostRelayUnachievableDetail,
	reviewHostRelayUnachievableReason,
	reviewProviderRoleVectorSlots,
	resolveReviewHostRelaySubmission,
	prepareReviewHostRelaySlot,
	runReviewHostRelayReviewerGroup,
	runReviewHostRelaySlot,
	submitReviewHostRelayPreparedResult,
	type ReviewHostRelayPreparedResult,
	type ReviewHostRelayRequest,
	type ReviewHostRelayRunner,
	type ReviewHostRelaySlot,
	type ReviewProviderRoleVectorSlot,
} from "../lib/review-host-relay.ts";
import {
	admitJeroCaptureResultForRelayV1,
	renderJeroCaptureSlotForRelayV1,
} from "../lib/authority/capture-relay.ts";
import {
	JOURNAL_STATUS,
	REVIEW_OPERATION,
	REVIEW_TRANSITION,
	ReviewTransactionStore,
	canonicalHash,
	createReviewState,
	type ReviewBudgetV1,
	type ReviewReducerInput,
	type StartOperationResultV1,
	type ReviewTransition,
} from "../lib/review-transaction.ts";
import {
	REVIEW_MODE,
	REVIEW_PROJECTION,
	captureReviewSnapshot,
	type ReviewMode,
	type ReviewProjectionV1,
} from "../lib/review-snapshot.ts";
import { renderJeroLifecycleCall, renderJeroResult, type JeroRenderContext } from "../lib/jero-ai-renderer.ts";
import { sanitizeTerminalText, stripAnsi } from "../lib/terminal-theme.ts";
import { CandidateViewError, CandidateViewRegistry, injectReviewCandidateView, readCandidateContextManifestPage, resolveCanonicalCandidateBase, type CandidateView } from "../lib/review-candidate-view.ts";
import {
	decodeNativeSddStatusV2,
	isCanonicalProcessString,
	isNativeReviewUnachievableVerbRefused,
	nativeReviewAbandonAuthorization,
	nativeReviewReconcileAuthorization,
	nativeReviewRecoverAuthorization,
	normalizeNativeReviewCwd,
	NativeReviewCliError,
	NativeReviewConsentBindingError,
	NativeReviewConsentRequiredError,
	NativeReviewIntegrationError,
	NATIVE_REVIEW_ERROR_CODE,
	NATIVE_REVIEW_OPERATION,
	NATIVE_REVIEW_MODE_OPERATION,
	NATIVE_REVIEW_MODE_SOURCE,
	NATIVE_REVIEW_RECONCILE_ANOMALIES,
	sanitizeForeignNativeReviewDiagnostics,
	type NativeReviewCli,
	type NativeSddStatusV2,
	type NativeIntendedUntrackedSelectionSubmission,
	type NativeReviewAcknowledgeApprovedOutcome,
	type NativeReviewAcknowledgeApprovedRequest,
	type NativeTargetStatusRequest,
	type NativeReviewModeOperation,
	type NativeReviewModeSource,
	type NativeReviewModeStatus,
	type NativeReviewProcessDiagnostics,
	type NativeReviewUnachievableLensCaptureArtifact,
	type NativeStartResult,
	type NativeReviewAssessRequest,
} from "../lib/authority/client-contract.ts";
import { createJeroAuthorityReviewCli } from "../lib/jero-authority-cli.ts";
import {
	verificationPlan,
	resolveWriterProfile,
	RDD_LINE,
	VERIFICATION_TIER,
	NATIVE_REVIEW_OUTCOME,
	type RddLine,
	type VerificationTier,
	type ReviewAssessmentV1,
	type NativeReviewOutcome,
} from "../lib/review-risk-assessment.ts";
import {
	assertReviewApprovedAcknowledgementExecuteV1,
	decodeReviewLastEventClosureV1,
	type ReviewCollectInputV3,
	type ReviewConsentEnvelope,
	type ReviewLastEventClosureBinding,
	type ReviewLastEventClosureV1,
	type ReviewStatusV3,
} from "../lib/authority/wire-contract.ts";
import { reconcileUnknownReviewLastEventCapture } from "../lib/review-last-event-controller.ts";
import { acquireChildStandingReviewPermissionClient, type ChildStandingReviewPermissionClient } from "../lib/review-session-standing-permission-ipc.ts";
import { isPiConsentV3, presentReviewConsentUi } from "../lib/review-consent-ui.ts";
import {
	captureReviewSessionIdentity,
	grantReviewSessionPermission,
	hasReviewSessionPermission,
	resolveCanonicalGitRepositoryIdentity,
	revokeReviewSessionPermission,
	reviewSessionPermissionEpoch,
	revokeReviewSessionPermissionsForSession,
	sameReviewSessionIdentity,
	type ReviewSessionIdentity,
} from "../lib/review-session-standing-permission.ts";

const GRAPH_V1_ORDINARY_READ_ONLY = "Graph-v1 ordinary review authority is read-only; use native compact-v2 review operations";
const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const ASSETS_DIR = join(PACKAGE_ROOT, "assets");

function gentlePiAgentHome(): string {
	return resolveGentlePiAgentHome();
}

function packageAssetAudit(owner: PackageAssetOwner): { stale: number; overrides: number } {
	let stale = 0;
	let overrides = 0;
	for (const [assetSubdir, installedSubdir, ownershipPrefix] of [
		["agents", "agents", "agents"],
		["chains", "chains", "chains"],
		["support", join("jero", "support"), "jero/support"],
	] as const) {
		const assetDir = join(ASSETS_DIR, assetSubdir);
		if (!existsSync(assetDir)) continue;
		for (const entry of readdirSync(assetDir, { withFileTypes: true })) {
			if (!entry.isFile() || getPackageAssetOwner(`${ownershipPrefix}/${entry.name}`) !== owner) continue;
			const installedPath = join(gentlePiAgentHome(), installedSubdir, entry.name);
			try {
				if (!existsSync(installedPath)) {
					stale += 1;
					continue;
				}
				if (
					!isPackageManagedSddAsset(
						installedPath,
						`${ownershipPrefix}/${entry.name}`,
					)
				) {
					overrides += 1;
					continue;
				}
				const packaged = readFileSync(join(assetDir, entry.name), "utf8");
				const installed = readFileSync(installedPath, "utf8");
				const comparablePackaged =
					assetSubdir === "agents"
						? updateFrontmatterRouting(packaged, undefined)
						: packaged;
				const comparableInstalled =
					assetSubdir === "agents"
						? updateFrontmatterRouting(installed, undefined)
						: installed;
				if (comparablePackaged !== comparableInstalled) {
					stale += 1;
				}
			} catch {
				stale += 1;
			}
		}
	}
	return { stale, overrides };
}

function packageAssetDiagnosticLines(cwd: string): string[] {
	return (["delegation", "review", "sdd"] as const).flatMap((owner) => {
		const label = owner === "sdd" ? "SDD" : owner;
		const onDemand = owner === "sdd" && !hasPackageAssetOwnerInstallation(owner);
		const { stale, overrides } = packageAssetAudit(owner);
		const local = localAgentOverrideCount(cwd, owner);
		const lines = [onDemand
			? `info: Global ${label} assets: on demand (not installed)`
			: `${stale > 0 ? "warn" : "pass"}: Global ${label} assets stale: ${stale} file(s)`];
		if (!onDemand && stale > 0) {
			lines[0] += ` — run /jero:install-${owner} --force to refresh managed assets`;
		}
		if (overrides > 0) {
			lines.push(`info: Global ${label} user overrides: ${overrides} file(s); preserved, not package drift`);
		}
		if (local > 0) {
			lines.push(`warn: Active ${label} agent overrides: ${local} file(s) — active non-builtin ${label} agents shadow package assets; keep only intentional overrides`);
		}
		return lines;
	});
}

function localAgentOverrideCount(cwd: string, owner: PackageAssetOwner): number {
	const packageSddAgentsDir = join(ASSETS_DIR, "agents");
	const packageSddAgentNames = new Set(
		listAgentsFromDir(packageSddAgentsDir, "builtin")
			.filter((agent) =>
				getPackageAssetOwner(
					`agents/${relative(packageSddAgentsDir, agent.filePath).split(sep).join("/")}`,
				) === owner,
			)
			.map((agent) => agent.name),
	);
	let count = 0;
	for (const { dir, source, packageManaged } of discoverableNonBuiltinAgentRoots(cwd)) {
		if (packageManaged || !existsSync(dir)) continue;
		for (const agent of listAgentsFromDir(dir, source)) {
			if (packageSddAgentNames.has(agent.name)) count += 1;
		}
	}
	return count;
}

// ---------------------------------------------------------------------------
// 后台子代理策略 —— 项目 > 全局 > 环境变量 > 默认关闭
// ---------------------------------------------------------------------------

type BackgroundSubagentsPolicy = "on" | "off";
type BackgroundSubagentsCapability = "ready" | "absent";

interface BackgroundSubagentsRendering {
	policy: BackgroundSubagentsPolicy;
	capability: BackgroundSubagentsCapability;
}

/** 四个来源中哪一个决定了生效策略。 */
type BackgroundSubagentsSource =
	| "project_file"
	| "global_file"
	| "environment"
	| "default";

interface BackgroundSubagentsResolution {
	policy: BackgroundSubagentsPolicy;
	source: BackgroundSubagentsSource;
	/** 决定策略的文件存在，但未通过严格解码。 */
	malformed: boolean;
	projectFile: string;
	globalFile: string;
	projectFileExists: boolean;
	globalFileExists: boolean;
	/** 原始环境变量值，即使无法识别且不生效也会上报。 */
	envValue: string | undefined;
}

interface LoadBackgroundSubagentsOptions {
	/** 覆盖配置主目录（测试中用于避免触碰 ~/.pi）。 */
	gentlePiConfigHome?: string;
	/** 覆盖环境变量查找（测试用）。 */
	env?: Record<string, string | undefined>;
}

const BACKGROUND_SUBAGENTS_SCHEMA = "jero.background-subagents/v1";
const BACKGROUND_SUBAGENTS_FILE = "background-subagents.json";

const DEFAULT_BACKGROUND_SUBAGENTS_RENDERING: BackgroundSubagentsRendering = {
	policy: "off",
	capability: "absent",
};

/**
 * 对 {"schema":"jero.background-subagents/v1","policy":"on"|"off"} 的严格解码。
 * 任何畸形形态（JSON 损坏、schema 不符、未知键、非法 policy）
 * 都返回 undefined，让调用方保守失败为 "off"。
 */
function parseBackgroundSubagentsPolicyFile(
	raw: string,
): BackgroundSubagentsPolicy | undefined {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return undefined;
	}
	if (!isRecord(parsed)) return undefined;
	if (parsed.schema !== BACKGROUND_SUBAGENTS_SCHEMA) return undefined;
	if (parsed.policy !== "on" && parsed.policy !== "off") return undefined;
	if (Object.keys(parsed).length !== 2) return undefined;
	return parsed.policy;
}

/**
 * 解析后台子代理策略，以及决定该策略的来源。
 *
 * 解析顺序（先命中者优先，与 loadRuntimeGuardrailsConfig 一致）：
 *   1. 项目文件 `${cwd}/.pi/jero/background-subagents.json`
 *   2. 全局文件 `${configHome}/background-subagents.json`
 *      （configHome 遵循 JERO_PI_CONFIG_HOME，默认 ~/.pi/jero）
 *   3. 环境变量 JERO_PI_BACKGROUND_SUBAGENTS（"on" | "off"）
 *   4. 默认 "off"
 *
 * 存在但畸形的文件会保守失败为 "off"，而不是继续落到较低优先级的来源，
 * 并且仍然归属于该文件：“由一个损坏的项目文件决定为 off”与“默认 off”
 * 是两种不同情况，只有前者才是需要修复的错误。
 *
 * 四个来源且先命中优先，正是那种会让一次编辑看起来毫无效果的结构，
 * 因此决定来源被纳入返回结果，而不是让调用方自行重新推导。
 */
function resolveBackgroundSubagentsPolicy(
	cwd: string,
	options: LoadBackgroundSubagentsOptions = {},
): BackgroundSubagentsResolution {
	const env = options.env ?? process.env;
	const envValue = env.JERO_PI_BACKGROUND_SUBAGENTS;
	let projectFile = "";
	let globalFile = "";
	try {
		const configHome = options.gentlePiConfigHome ?? gentleAiConfigHome();
		projectFile = join(cwd, ".pi", "jero", BACKGROUND_SUBAGENTS_FILE);
		globalFile = join(configHome, BACKGROUND_SUBAGENTS_FILE);
		const projectFileExists = existsSync(projectFile);
		const globalFileExists = existsSync(globalFile);
		const locations = { projectFile, globalFile, projectFileExists, globalFileExists, envValue };
		for (const [source, path, present] of [
			["project_file", projectFile, projectFileExists],
			["global_file", globalFile, globalFileExists],
		] as const) {
			if (!present) continue;
			let decoded: BackgroundSubagentsPolicy | undefined;
			try {
				decoded = parseBackgroundSubagentsPolicyFile(readFileSync(path, "utf8"));
			} catch {
				// 在这一层，无法读取与无法使用不可区分，
				// 两者都必须在声称拥有决定权的文件上保守失败。
				decoded = undefined;
			}
			return decoded === undefined
				? { policy: "off", source, malformed: true, ...locations }
				: { policy: decoded, source, malformed: false, ...locations };
		}
		if (envValue === "on" || envValue === "off") {
			return { policy: envValue, source: "environment", malformed: false, ...locations };
		}
		return { policy: "off", source: "default", malformed: false, ...locations };
	} catch {
		return {
			policy: "off",
			source: "default",
			malformed: false,
			projectFile,
			globalFile,
			projectFileExists: false,
			globalFileExists: false,
			envValue,
		};
	}
}

/**
 * 仅返回生效策略，供不上报来源的调用方使用。
 * 通过委托实现，加载器与解析器永远不会各执一词。
 */
function loadBackgroundSubagentsPolicy(
	cwd: string,
	options: LoadBackgroundSubagentsOptions = {},
): BackgroundSubagentsPolicy {
	return resolveBackgroundSubagentsPolicy(cwd, options).policy;
}

/** 写入全局策略文件，必要时创建配置主目录。 */
function writeGlobalBackgroundSubagentsPolicy(
	policy: BackgroundSubagentsPolicy,
	configHome: string = gentleAiConfigHome(),
): string {
	const path = join(configHome, BACKGROUND_SUBAGENTS_FILE);
	mkdirSync(configHome, { recursive: true });
	writeFileSync(
		path,
		`${JSON.stringify({ schema: BACKGROUND_SUBAGENTS_SCHEMA, policy }, null, 2)}\n`,
	);
	return path;
}

function describeBackgroundSubagentsSource(
	resolution: BackgroundSubagentsResolution,
): string {
	switch (resolution.source) {
		case "project_file":
			return `project file ${resolution.projectFile}`;
		case "global_file":
			return `global file ${resolution.globalFile}`;
		case "environment":
			return "JERO_PI_BACKGROUND_SUBAGENTS";
		default:
			return "built-in default";
	}
}

/**
 * 上报生效策略、决定它的来源、已解析的能力，以及用户需要了解的
 * 关于“未”起决定作用的来源的信息。`wrote` 表示本次调用刚写入全局
 * 文件的策略；被更高优先级文件压过的写入，绝不能被报告成
 * 已经生效。
 */
function renderBackgroundSubagentsReport(
	resolution: BackgroundSubagentsResolution,
	capability: BackgroundSubagentsCapability,
	wrote?: BackgroundSubagentsPolicy,
): { message: string; type: "info" | "warning" } {
	const lines = [
		`background subagents: ${resolution.policy} (decided by ${describeBackgroundSubagentsSource(resolution)}; capability: ${capability})`,
	];
	if (wrote !== undefined) {
		lines.push(`Wrote ${wrote} to the global file ${resolution.globalFile}.`);
	}
	if (resolution.malformed) {
		const path =
			resolution.source === "project_file" ? resolution.projectFile : resolution.globalFile;
		lines.push(
			`${path} is present but malformed, so the policy fails closed to off and no lower-priority source is consulted.`,
		);
	}
	const outranksTheWrite = wrote !== undefined && resolution.source === "project_file";
	if (outranksTheWrite) {
		lines.push(
			`That global write does not take effect here: the project file ${resolution.projectFile} outranks it. Edit or remove that project file to let the global setting decide.`,
		);
	} else if (
		wrote === undefined &&
		resolution.source === "project_file" &&
		resolution.globalFileExists
	) {
		lines.push(
			`The global file ${resolution.globalFile} exists but is outranked by that project file.`,
		);
	}
	if (resolution.envValue !== undefined && resolution.source !== "environment") {
		lines.push(
			resolution.envValue === "on" || resolution.envValue === "off"
				? `JERO_PI_BACKGROUND_SUBAGENTS=${resolution.envValue} is set, but both files outrank it and it outranks the built-in default; it decides only when neither file exists.`
				: `JERO_PI_BACKGROUND_SUBAGENTS="${resolution.envValue}" is not a recognized value ("on" or "off"), so it is ignored.`,
		);
	}
	lines.push(
		"Resolution order (first hit wins): project file, global file, JERO_PI_BACKGROUND_SUBAGENTS, built-in default off.",
	);
	return {
		message: lines.join("\n"),
		type: resolution.malformed || outranksTheWrite ? "warning" : "info",
	};
}

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

function sddDispatchAgentName(input: unknown): string | undefined {
	if (!isRecord(input)) return undefined;
	if (typeof input.agent === "string" && SDD_AGENT_NAME_SET.has(input.agent)) return input.agent;
	if (Array.isArray(input.agent) && input.agent.some((agent) => typeof agent === "string" && SDD_AGENT_NAME_SET.has(agent))) {
		return "invalid";
	}
	return undefined;
}

function rejectUnscopedBoundedWriterDispatch(input: unknown): { block: true; reason: string } | undefined {
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

function rejectInvalidJudgmentDayFixDispatch(input: unknown): { block: true; reason: string } | undefined {
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
function subagentsPackageRoots(cwd: string): string[] {
	return SUBAGENTS_PACKAGE_NAMES.flatMap((packageName) => [
		join(PACKAGE_ROOT, "..", packageName),
		join(cwd, ".pi", "npm", "node_modules", packageName),
		join(homedir(), ".local", "lib", "node_modules", packageName),
	]);
}

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
function readActiveToolNames(pi: unknown): readonly string[] | undefined {
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
function resolveBackgroundSubagentsCapability(
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

function renderBackgroundSubagentsStatusLine(
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
function isValidRddModeStatus(
	status: NativeReviewModeStatus | undefined,
): status is NativeReviewModeStatus {
	if (status === undefined || status === null || typeof status !== "object") return false;
	if (status.effective !== "on" && status.effective !== "off") return false;
	const validSources: readonly string[] = Object.values(NATIVE_REVIEW_MODE_SOURCE);
	return typeof status.source === "string" && validSources.includes(status.source);
}

/**
 * 渲染回执驱动开发（RDD）状态行，显示在
 * `Background subagent policy` 旁边（gentle-pi#661）。只要 `status`
 * 不是经过校验的 on/off 状态且来源可识别——`undefined`（原生读取器
 * 无法应答：二进制缺失、超时、中止，或原生 CLI 失败）或任何
 * 畸形/不完整的对象——就渲染保守失败的 "unknown" 行。这是纯渲染，
 * 从不发起原生调用，因此永不抛错。
 */
function renderRddStatusLine(
	status: NativeReviewModeStatus | undefined,
): string {
	return isValidRddModeStatus(status)
		? `Receipt-driven development: ${status.effective} (decided by ${status.source})`
		: "Receipt-driven development: unknown (native status unavailable)";
}

// 主会话提示词在每次非 SDD、非具名代理启动时都要等待它完成，
// 因此一次无界的原生读取会让会话启动卡在一个挂起的
// `gentle-ai` 子进程后面（gentle-pi#661 原生评审升级）。
// 生产调用点（before_agent_start）传入
// `AbortSignal.timeout(RDD_STATUS_TIMEOUT_MS)`；resolveRddModeStatus
// 自身也让调用与同一个信号竞速（而不只依赖 CLI 自己的信号处理），
// 这样即使面对一个忽略 `signal` 参数的 stub/mock
// reviewMode（测试正是如此），中止也能被尊重。
const RDD_STATUS_TIMEOUT_MS = 3000;
// 该窗口内重复的会话/代理启动构建会复用上次解析的状态，
// 而不是重新拉起原生二进制。也故意记忆失败/undefined 的解析结果
// （持续故障不应在每次代理启动时重试），用较慢的恢复信号换来
// 少得多的进程拉起；下方的一次性 notify 仍会让持续故障可见。
const RDD_STATUS_MEMO_TTL_MS = 30_000;
const rddStatusMemo = new Map<string, { readonly status: NativeReviewModeStatus | undefined; readonly expiresAt: number }>();

/** @internal 测试接缝：清空按 cwd 记忆的 RDD 状态缓存。 */
function clearRddStatusMemoForTesting(): void {
	rddStatusMemo.clear();
}

// gentle-pi#668（修正版）：单个候选的最近已知结果，按仓库 realpath
// 加 targetIdentity 作为键——绝不仅按仓库，否则一个候选的结果会泄漏进
// 其他每个候选的 `assess` 调用。只会写入 declined/unavailable
// （来自 ANSWER_CONSENT）；`closed` 永不写入/派生——需显式传入。
// 缺失的条目读回 `undefined`，按 `unknown` 处理（保守失败，同 `off`）。
const nativeReviewOutcomeByCandidate = new Map<string, "declined" | "unavailable">();

function nativeReviewOutcomeMemoKey(cwd: string, targetIdentity: string): string {
	try {
		return `${realpathSync(cwd)}\u0000${targetIdentity}`;
	} catch {
		return `${cwd}\u0000${targetIdentity}`;
	}
}

function recordNativeReviewOutcome(cwd: string, targetIdentity: string, outcome: "declined" | "unavailable"): void {
	nativeReviewOutcomeByCandidate.set(nativeReviewOutcomeMemoKey(cwd, targetIdentity), outcome);
}

/** 返回恰好针对该候选记录的结果；没有记录时返回 `undefined`。 */
function readNativeReviewOutcome(cwd: string, targetIdentity: string): "declined" | "unavailable" | undefined {
	return nativeReviewOutcomeByCandidate.get(nativeReviewOutcomeMemoKey(cwd, targetIdentity));
}

/** @internal 测试接缝：清空按候选记忆的原生评审结果缓存。 */
function clearNativeReviewOutcomeMemoForTesting(): void {
	nativeReviewOutcomeByCandidate.clear();
}

// 为 `assess` 尽力获取当前候选的 target identity（gentle-pi#668）：
// 复用 `targetStatus`，一个本工具已在别处发起的原生调用。
async function readCurrentTargetIdentityBestEffort(
	nativeReviewCli: Pick<NativeReviewCli, "targetStatus"> | null | undefined,
	cwd: string,
	signal?: AbortSignal,
): Promise<string | undefined> {
	if (nativeReviewCli?.targetStatus === undefined) return undefined;
	try {
		const status = await nativeReviewCli.targetStatus({ cwd, ...(signal === undefined ? {} : { signal }) });
		return status.applicability === "current_target" ? status.targetIdentity : undefined;
	} catch {
		return undefined;
	}
}

function rddAbortRejection(signal: AbortSignal): Promise<never> {
	return new Promise((_resolve, reject) => {
		if (signal.aborted) {
			reject(signal.reason ?? new Error("aborted"));
			return;
		}
		signal.addEventListener("abort", () => reject(signal.reason ?? new Error("aborted")), { once: true });
	});
}

async function readRddModeStatusOnce(
	nativeReviewCli: Pick<NativeReviewCli, "reviewMode"> | null | undefined,
	cwd: string,
	signal?: AbortSignal,
): Promise<NativeReviewModeStatus | undefined> {
	if (!nativeReviewCli?.reviewMode) return undefined;
	try {
		const call = nativeReviewCli.reviewMode({ cwd, operation: NATIVE_REVIEW_MODE_OPERATION.STATUS, signal });
		const result = signal === undefined ? await call : await Promise.race([call, rddAbortRejection(signal)]);
		return result.status;
	} catch {
		return undefined;
	}
}

// gentle-pi#662：只读的组合式原生风险评估加上计算出的验证计划
// （`lib/review-risk-assessment.ts`），供 `jero_review` 工具的
// `assess` 操作使用。永不抛错：不可用/失败的原生 assess 调用
// （缺少该动词的旧版二进制、超时、畸形响应）解析为
// `unassessable` 档位，`verificationPlan` 对其与 `high` 一视同仁
// ——即 gentle-pi#662 的保守失败规则。
interface ReviewAssessmentPlanDetails {
	schema: "jero.review-assessment-plan/v1";
	risk: VerificationTier;
	reasons: readonly { code: string; path: string; detail: string }[];
	changedPaths: number;
	changedLines: number;
	candidate: { kind: string; baseRef: string | undefined } | null;
	rddLine: RddLine;
	nativeReviewOutcome: NativeReviewOutcome;
	// gentle-pi#668：nativeReviewOutcome 的来源——explicit（调用方
	// 显式传入）、derived（匹配到该候选本身）或 unknown。
	outcome_source: "explicit" | "derived" | "unknown";
	writerProfile: "small" | "large";
	plan: {
		writerSelfVerification: boolean;
		structuralReadbackOnly: boolean;
		independentVerifier: boolean;
		reason: string;
	};
}

async function resolveReviewAssessmentPlan(
	nativeReviewCli: Pick<NativeReviewCli, "reviewMode" | "assess" | "targetStatus"> | null | undefined,
	cwd: string,
	input: ReviewAssessInput,
	signal?: AbortSignal,
): Promise<ReviewAssessmentPlanDetails> {
	if (input.baseRef !== undefined && input.committedOnly !== true) throw new Error("Review assess baseRef requires committedOnly: true");
	if (input.baseRef === undefined && input.committedOnly !== undefined) throw new Error("Review assess committedOnly requires an explicit baseRef");

	const status = await readRddModeStatusOnce(nativeReviewCli, cwd, signal);
	const rddLine: RddLine = isValidRddModeStatus(status) ? status.effective : RDD_LINE.UNKNOWN;
	const writerProfile = resolveWriterProfile({
		...(input.writerModelId === undefined ? {} : { model: { id: input.writerModelId } }),
		thinking: input.writerEffort,
	});

	let assessment: ReviewAssessmentV1 | undefined;
	let unassessableDetail: string | undefined;
	if (nativeReviewCli?.assess === undefined) {
		unassessableDetail = "native review assess is unavailable: the installed gentle-ai binary does not expose the assess command.";
	} else {
		try {
			const request: NativeReviewAssessRequest = {
				cwd,
				...(input.baseRef === undefined ? {} : { baseRef: input.baseRef, committedOnly: true as const }),
				...(signal === undefined ? {} : { signal }),
			};
			assessment = await nativeReviewCli.assess(request);
		} catch (error) {
			unassessableDetail = `native review assess failed: ${error instanceof Error ? error.message : String(error)}`;
		}
	}

	const risk: VerificationTier = assessment?.risk ?? VERIFICATION_TIER.UNASSESSABLE;
	// gentle-pi#668：显式传入永远优先；否则只针对本候选自己的
	// target identity 派生，绝不只按仓库。`closed`
	// 永不被派生。
	const targetIdentity = input.nativeReviewOutcome === undefined ? await readCurrentTargetIdentityBestEffort(nativeReviewCli, cwd, signal) : undefined;
	const derived = targetIdentity === undefined ? undefined : readNativeReviewOutcome(cwd, targetIdentity);
	const nativeReviewOutcome: NativeReviewOutcome = input.nativeReviewOutcome ?? derived ?? NATIVE_REVIEW_OUTCOME.UNKNOWN;
	const outcomeSource: "explicit" | "derived" | "unknown" = input.nativeReviewOutcome !== undefined ? "explicit" : derived === undefined ? "unknown" : "derived";
	const plan = verificationPlan({ rddLine, risk, writerProfile, nativeReviewOutcome });
	return {
		schema: "jero.review-assessment-plan/v1",
		risk,
		reasons: assessment?.reasons ?? (unassessableDetail === undefined ? [] : [{ code: "native-assess-unavailable", path: "", detail: unassessableDetail }]),
		changedPaths: assessment?.changedPaths ?? 0,
		changedLines: assessment?.changedLines ?? 0,
		candidate: assessment === undefined ? null : { kind: assessment.candidate.kind, baseRef: assessment.candidate.baseRef },
		rddLine,
		nativeReviewOutcome,
		outcome_source: outcomeSource,
		writerProfile,
		plan,
	};
}

let rddStatusUnavailableWarned = false;

/**
 * 为提示词渲染尽力读取原生 RDD 模式状态，按 cwd 记忆
 * `RDD_STATUS_MEMO_TTL_MS` 时长。复用 `reviewMode` STATUS 读取器
 * （`gentle-ai review mode status --json`，解码为
 * `NativeReviewModeStatus`），`/jero:review-mode` 命令调用的也是
 * 它。永不抛错，且在给定 `signal` 时绝不拖过其截止时间：
 * 二进制缺失、进程超时/中止、原生 CLI 失败都解析为
 * `undefined`。`ctx` 是可选的，仅在读取被吞掉时用于一次性
 * （每进程一次）的 UI 提示，让持续的原生故障在渲染的 "unknown"
 * 行之外也能被观察到。
 */
async function resolveRddModeStatus(
	nativeReviewCli: Pick<NativeReviewCli, "reviewMode"> | null | undefined,
	cwd: string,
	signal?: AbortSignal,
	now: () => number = Date.now,
	ctx?: Pick<ExtensionContext, "hasUI" | "ui">,
): Promise<NativeReviewModeStatus | undefined> {
	const nowMs = now();
	const cached = rddStatusMemo.get(cwd);
	if (cached !== undefined && cached.expiresAt > nowMs) return cached.status;
	const status = await readRddModeStatusOnce(nativeReviewCli, cwd, signal);
	rddStatusMemo.set(cwd, { status, expiresAt: nowMs + RDD_STATUS_MEMO_TTL_MS });
	if (status === undefined && !rddStatusUnavailableWarned) {
		rddStatusUnavailableWarned = true;
		if (ctx?.hasUI) {
			ctx.ui.notify(
				"Jero：回执驱动开发（receipt-driven-development）状态不可用（原生评审 CLI 缺失、超时或失败）。在恢复之前，父提示词将渲染 \"unknown\"；本提示本会话不会重复。",
				"warning",
			);
		}
	}
	return status;
}

/** 一次调用即完成解析并渲染 RDD 状态行，供生产调用点使用。 */
async function resolveRddStatusLine(
	nativeReviewCli: Pick<NativeReviewCli, "reviewMode"> | null | undefined,
	cwd: string,
	signal?: AbortSignal,
	now: () => number = Date.now,
	ctx?: Pick<ExtensionContext, "hasUI" | "ui">,
): Promise<string> {
	return renderRddStatusLine(await resolveRddModeStatus(nativeReviewCli, cwd, signal, now, ctx));
}

// 渲染出的提示词按后台策略/能力/RDD 状态键在进程生命周期内记忆；
// assets 字节本身每个键只读一次。`rddStatusLine` 默认取 "unknown"
// 兜底行（三种可渲染形态中最长的那个）而不是 ""，因此无参数的默认
// 渲染本身就是 tests/orchestrator-budget.test.ts 所度量的规范 8 KiB
// 预算的最坏情况；assets/orchestrator.md 的体量已把该最坏情况
// 计算在内。生产路径仍通过 resolveRddStatusLine 解析并传入
// 真实的行（on/off/unknown）。
const orchestratorPromptCache = new Map<string, string>();
function getOrchestratorPrompt(
	cwd: string = process.cwd(),
	activeTools?: readonly string[],
	rddStatusLine: string = renderRddStatusLine(undefined),
): string {
	const background: BackgroundSubagentsRendering = {
		policy: loadBackgroundSubagentsPolicy(cwd),
		capability: resolveBackgroundSubagentsCapability(cwd, activeTools),
	};
	const cacheKey = `${background.policy}:${background.capability}:${rddStatusLine}`;
	let prompt = orchestratorPromptCache.get(cacheKey);
	if (prompt === undefined) {
		prompt = renderOrchestratorPrompt(ASSETS_DIR, background, rddStatusLine);
		orchestratorPromptCache.set(cacheKey, prompt);
	}
	return prompt;
}

function renderOrchestratorPrompt(
	assetsDir: string,
	background: BackgroundSubagentsRendering = DEFAULT_BACKGROUND_SUBAGENTS_RENDERING,
	rddStatusLine: string = renderRddStatusLine(undefined),
): string {
	const backgroundPolicyBlock = `${renderBackgroundSubagentsStatusLine(background)}\n${rddStatusLine}`;
	return readFileSync(join(assetsDir, "orchestrator.md"), "utf8")
		.replaceAll("{{JERO_PI_ASSETS_ROOT}}", assetsDir)
		.replaceAll(
			"{{JERO_PI_BACKGROUND_POLICY}}",
			backgroundPolicyBlock,
		)
		.trim();
}

// gentle-pi#560 / gentle-ai#4056, #4057：2026-08-01 起，Jero 不再向
// Pi 生成的 APPEND_SYSTEM 组合写入运行时专属的评审执行契约。本包改为
// 注入镜像 provider 契约 bundle 自带的 `orchestration/pi.md` 文本，
// 从包内镜像（contracts/review-provider-contract-mirror/）读取一次，
// 并以完整渲染的片段形式在进程生命周期内缓存。它被刻意地不并入
// getOrchestratorPrompt/orchestratorPromptCache：那个核心提示词
// 被钉死在 8192 字节预算上（tests/orchestrator-budget.test.ts）。
const PROVIDER_CONTRACT_MIRROR_ROOT = join(PACKAGE_ROOT, "contracts", "review-provider-contract-mirror");
const PROVIDER_CONTRACT_LOCK_FILE = "provider-contract.lock.json";
const PI_ORCHESTRATION_RUNTIME = "pi";

let reviewContractPromptFragmentCache: string | null | undefined;
let reviewContractPromptMissingWarned = false;

// 注入前先按 lock 文件中的摘要校验镜像的 orchestration/pi.md 字节（gentle-ai R1/R3）。
function readMirroredReviewContractFragment(mirrorRoot: string = PROVIDER_CONTRACT_MIRROR_ROOT): string | null {
	try {
		const lockPath = join(mirrorRoot, PROVIDER_CONTRACT_LOCK_FILE);
		const lock = JSON.parse(readFileSync(lockPath, "utf8")) as {
			contract_semver?: unknown;
			entries?: Record<string, unknown>;
		};
		if (typeof lock.contract_semver !== "string" || lock.contract_semver === "") return null;
		const expectedSha256 = lock.entries?.[`orchestration/${PI_ORCHESTRATION_RUNTIME}.md`];
		if (typeof expectedSha256 !== "string" || !/^[0-9a-f]{64}$/.test(expectedSha256)) return null;
		const contractPath = join(mirrorRoot, `v${lock.contract_semver}`, "bundle", "orchestration", `${PI_ORCHESTRATION_RUNTIME}.md`);
		const rawBytes = readFileSync(contractPath);
		const actualSha256 = createHash("sha256").update(rawBytes).digest("hex");
		if (!timingSafeEqual(Buffer.from(expectedSha256, "hex"), Buffer.from(actualSha256, "hex"))) return null;
		const text = rawBytes.toString("utf8").trim();
		if (text.length === 0) return null;
		return `## Jero review execution contract (mirrored provider bundle ${lock.contract_semver})\n\n${text}`;
	} catch {
		return null;
	}
}

function loadReviewContractPromptFragment(
	ctx: Pick<ExtensionContext, "hasUI" | "ui">,
	mirrorRoot: string = PROVIDER_CONTRACT_MIRROR_ROOT,
): string | null {
	if (reviewContractPromptFragmentCache === undefined) {
		reviewContractPromptFragmentCache = readMirroredReviewContractFragment(mirrorRoot);
	}
	if (reviewContractPromptFragmentCache === null && !reviewContractPromptMissingWarned) {
		reviewContractPromptMissingWarned = true;
		if (ctx.hasUI) {
			ctx.ui.notify(
				"Jero 评审执行契约不可用：镜像的 provider bundle 缺失、无法读取或未通过摘要校验。本会话不会注入评审预检指令。",
				"warning",
			);
		}
	}
	return reviewContractPromptFragmentCache;
}

async function pathExists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

type PersonaMode = "gentleman" | "neutral";

const PERSONA_OPTIONS = ["gentleman", "neutral"] as const;

const GENTLEMAN_PERSONA_PROMPT = `Persona:
- 直接、技术性、简洁。
- 始终用用户写作所用的语言回答。
- 用户使用中文时，用自然、地道的简体中文回答。
- 以资深架构师和教师的姿态行事：先讲概念再写代码，不走捷径。
- 把 AI 当作由人指挥的工具；绝不把自己呈现为默认聊天机器人。
- 当用户在没有足够上下文或理解的情况下索要代码时，予以推回。
- 直接纠正错误，解释原因，并展示更好的路径。`;

const NEUTRAL_PERSONA_PROMPT = `Persona:
- 直接、技术性、简洁、温和且专业。
- 始终用用户写作所用的语言回答。
- 不使用俚语或地域性表达。
- 用户使用中文时，用中性、专业的简体中文。不使用网络俚语（yyds、绝绝子）、梗或方言表达（老铁、咋、俺）。
- 以资深架构师和教师的姿态行事：先讲概念再写代码，不走捷径。
- 把 AI 当作由人指挥的工具；绝不把自己呈现为默认聊天机器人。
- 当用户在没有足够上下文或理解的情况下索要代码时，予以推回。
- 直接纠正错误，解释原因，并展示更好的路径。`;

function buildGentlePrompt(
	persona: PersonaMode,
	cwd: string = process.cwd(),
	activeTools?: readonly string[],
	rddStatusLine: string = renderRddStatusLine(undefined),
): string {
	const personaPrompt =
		persona === "neutral" ? NEUTRAL_PERSONA_PROMPT : GENTLEMAN_PERSONA_PROMPT;
	const languageBoundary =
		persona === "neutral"
			? "语言：用户使用中文时，用中性、专业的简体中文；不使用网络俚语、梗或方言表达。"
			: "语言：用户使用中文时，用自然、地道的简体中文回答。";
	return `## el Jero 身份与框架

Current persona mode: ${persona}

你是 el Jero：一个面向受控开发工作的 Pi 专用编码代理框架。

身份契约：
- 当用户问你是谁或是什么时，以 el Jero 的身份回答，而不是泛用助手，且绝不仅仅以“您的助手”或“默认助手”自我介绍。传达以下含义，并翻译成用户的语言：“我是 el Jero：一个面向受控开发的 Pi 专用编码代理框架，具备资深架构师人格。我在任务需要时使用 SDD/OpenSpec，协调子代理，使用阶段产物，运行命令并编辑文件。我不是通用聊天机器人。”
- 遵循当前选择的人格模式。
- 将 SDD/OpenSpec 阶段产物和子代理作为核心能力提及。
- 仅在记忆包或可调用的记忆工具确实处于活动状态时才提及记忆；绝不虚构持久记忆。
- 不宣称在 Pi 运行时之外可移植。

${personaPrompt}

${languageBoundary}

框架原则：
- el Jero 不是提示词工程，而是围绕强大代理的运行时纪律。
- 非平凡工作优先使用 SDD/OpenSpec 产物，而非漂浮的聊天上下文。
- 实现之前先澄清范围、约束、验收标准与非目标。
- 在可用时使用子代理进行探索、规划、实现和评审，同时保持单一父会话负责编排。
- 除非用户明确批准并行写隔离，否则保持写操作单线程。
- 若存在测试，使用严格的 TDD 证据：RED、GREEN、TRIANGULATE、REFACTOR。
- 保护人类评审者：避免过大的变更，揭示评审工作量风险，在把一个任务变成大型多区域变更之前先询问。
- 绝不因本包而宣称持久记忆可用。记忆由独立的包或 MCP 工具在安装且可调用时提供。

${getOrchestratorPrompt(cwd, activeTools, rddStatusLine)}`;
}

// 匹配 `git [全局标志] push` —— 容忍 `git` 与子命令之间的
// -C /repo 或 --work-tree=/tmp 等标志。短标志后面可以跟一个独立的取值 token。
const GIT_GLOBAL_FLAGS_SRC = String.raw`(?:\s+--?\S+(?:\s+[^-\s]\S*)?)* `;
const GIT_PUSH_RE = new RegExp(String.raw`\bgit${GIT_GLOBAL_FLAGS_SRC}(push)\b`);

const DENIED_BASH_PATTERNS: RegExp[] = [
	// 阻止针对 /、~ 或 ~/子目录、$HOME 或 $HOME/子目录、.. 或 . 的 rm -rf
	/\brm\s+-rf\s+(?:\/(?:\s|$)|~(?:\/|\s|$)|[$]HOME(?:\/|\s|$)|\.\.?(?:\s|$))/,
	/\bgit\s+reset\s+--hard\b/,
	/\bgit\s+clean\b(?=[^\n]*(?:-[^\n]*f|--force))(?=[^\n]*(?:-[^\n]*d|--directories))/,
	// 强制推送拒绝：容忍子命令前的 git 全局标志（如 -C /repo）
	new RegExp(String.raw`\bgit${GIT_GLOBAL_FLAGS_SRC}push\b(?=[^\n]*\s--force(?:-with-lease)?\b)`),
	new RegExp(String.raw`\bgit${GIT_GLOBAL_FLAGS_SRC}push\b(?=[^\n]*\s-[^\s-]*f)`),
	/\bchmod\s+-R\s+777\b/,
	/\bchown\s+-R\b/,
];

// ---------------------------------------------------------------------------
// 自主守卫 —— 运行时护栏配置
// ---------------------------------------------------------------------------

const GUARD_ACTION = {
	ALLOW: "allow",
	CONFIRM: "confirm",
	BLOCK: "block",
} as const;

type GuardAction = (typeof GUARD_ACTION)[keyof typeof GUARD_ACTION];
type GuardClassification = GuardAction | "not-guarded";

interface GuardMatch {
	key: GuardedCommandKey;
	action: GuardAction;
	triggerIndex: number;
}

interface GuardEvaluation {
	action: GuardClassification;
	key?: GuardedCommandKey;
	triggerIndex: number;
	matches: GuardMatch[];
}

const GUARDED_COMMAND_KEY = {
	GIT_PUSH: "gitPush",
	GIT_REBASE: "gitRebase",
	GIT_BRANCH_DELETE_FORCE: "gitBranchDeleteForce",
	NPM_PUBLISH: "npmPublish",
	PI_REMOVE: "piRemove",
} as const;

type GuardedCommandKey = (typeof GUARDED_COMMAND_KEY)[keyof typeof GUARDED_COMMAND_KEY];

type GuardedCommandsConfig = Partial<Record<GuardedCommandKey, GuardAction>>;

interface RuntimeGuardrailsConfig {
	autonomousMode: boolean;
	guardedCommands: GuardedCommandsConfig;
}

interface LoadGuardrailsOptions {
	/** 覆盖配置主目录（测试中用于避免触碰 ~/.pi）。 */
	gentlePiConfigHome?: string;
	/** 覆盖自主模式检查所用的环境（注入的 processEnv 接缝）。 */
	env?: NodeJS.ProcessEnv;
}

const GUARDED_KEY_PATTERNS: Record<GuardedCommandKey, RegExp> = {
	gitPush: GIT_PUSH_RE,
	gitRebase: /\bgit\s+(rebase)\b/,
	gitBranchDeleteForce: /\bgit\s+(branch)\s+(?:-[a-zA-Z]*D[a-zA-Z]*|-[a-zA-Z]*d[a-zA-Z]*f[a-zA-Z]*|-[a-zA-Z]*f[a-zA-Z]*d[a-zA-Z]*|--delete\b[^\r\n;&|]*--force\b|--force\b[^\r\n;&|]*--delete\b)/,
	npmPublish: /\bnpm\s+(publish)\b/,
	piRemove: /\bpi\s+(remove)\b/,
};

const AUTONOMOUS_DEFAULT_ACTIONS: Record<GuardedCommandKey, GuardAction> = {
	gitPush: "allow",
	gitRebase: "confirm",
	gitBranchDeleteForce: "confirm",
	npmPublish: "block",
	piRemove: "confirm",
};

const GUARDED_COMMAND_LABELS: Record<GuardedCommandKey, string> = {
	gitPush: "git push",
	gitRebase: "git rebase",
	gitBranchDeleteForce: "forced git branch deletion",
	npmPublish: "npm publish",
	piRemove: "pi remove",
};

const SAFE_GUARDRAILS_CONFIG: RuntimeGuardrailsConfig = {
	autonomousMode: false,
	guardedCommands: {},
};

/**
 * 按运行时守卫策略对一条 shell 命令分类。
 *
 * 顺序（不可协商）：
 *   1. 硬拒绝模式 → "block"（永远生效，不能被配置覆盖）
 *   2. 若 autonomousMode 为 false → 镜像旧版 CONFIRM_BASH_PATTERNS 的结果
 *   3. 若 autonomousMode 为 true → 对命中的键使用配置的 GuardAction
 *      （对 guardedCommands 中未设置的键应用 AUTONOMOUS_DEFAULT_ACTIONS）
 *   4. 无命中 → "not-guarded"
 */
function collectGuardedMatches(
	command: string,
	config: RuntimeGuardrailsConfig,
): GuardMatch[] {
	const matches: GuardMatch[] = [];
	for (const [key, pattern] of Object.entries(GUARDED_KEY_PATTERNS) as [
		GuardedCommandKey,
		RegExp,
	][]) {
		const globalPattern = new RegExp(pattern.source, `${pattern.flags}g`);
		for (const match of command.matchAll(globalPattern)) {
			const action = config.autonomousMode
				? (config.guardedCommands[key] ?? AUTONOMOUS_DEFAULT_ACTIONS[key])
				: "confirm";
			matches.push({
				key,
				action,
				triggerIndex: match.index + match[0].lastIndexOf(match[1]),
			});
		}
	}
	return matches.sort((left, right) => left.triggerIndex - right.triggerIndex);
}

function evaluateGuardedCommand(
	command: string,
	config: RuntimeGuardrailsConfig,
): GuardEvaluation {
	const matches = collectGuardedMatches(command, config);

	// 硬拒绝覆盖整条命令上的任何已配置动作。
	for (const pattern of DENIED_BASH_PATTERNS) {
		const denied = pattern.exec(command);
		if (!denied) continue;
		const matchedAction = matches.find((match) =>
			match.triggerIndex >= denied.index && match.triggerIndex < denied.index + denied[0].length,
		);
		return {
			action: "block",
			key: matchedAction?.key,
			triggerIndex: matchedAction?.triggerIndex ?? denied.index,
			matches,
		};
	}

	// 在所有命中中，先取配置的 block，其次 confirm，最后 allow。
	const selected = matches.find((match) => match.action === "block")
		?? matches.find((match) => match.action === "confirm")
		?? matches.find((match) => match.action === "allow");
	if (selected) return { ...selected, matches };
	return { action: "not-guarded", triggerIndex: 0, matches };
}

function classifyGuardedCommand(
	command: string,
	config: RuntimeGuardrailsConfig,
): GuardClassification {
	return evaluateGuardedCommand(command, config).action;
}

function guardedCommandPreview(command: string, triggerIndex: number): string {
	const start = Math.max(0, triggerIndex - 60);
	const prefix = start > 0 ? "…" : "";
	return `${prefix}${truncateToWidth(command.slice(start).replace(/\s+/g, " ").trim(), 180 - prefix.length, "…")}`;
}

/** 所有受守卫动作的确认标题；没有键命中时使用通用文案。 */
function guardedCommandTitle(
	key?: GuardedCommandKey,
	matches: readonly GuardMatch[] = [],
): string {
	if (matches.length > 1) {
		return `Allow guarded actions: ${matches.map((match) => GUARDED_COMMAND_LABELS[match.key]).join("; ")}?`;
	}
	return key === undefined
		? "Allow guarded command?"
		: `Allow guarded ${GUARDED_COMMAND_LABELS[key]}?`;
}

function parseGuardrailsConfigFile(
	raw: string,
): RuntimeGuardrailsConfig | undefined {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return undefined;
	}
	if (!isRecord(parsed)) return undefined;

	const autonomousMode = parsed.autonomousMode === true;

	const rawCommands = isRecord(parsed.guardedCommands) ? parsed.guardedCommands : {};
	const guardedCommands: GuardedCommandsConfig = {};
	const validActions = new Set<string>(["allow", "confirm", "block"]);
	for (const [key, value] of Object.entries(rawCommands)) {
		if (
			typeof value === "string" &&
			validActions.has(value) &&
			Object.values(GUARDED_COMMAND_KEY).includes(key as GuardedCommandKey)
		) {
			guardedCommands[key as GuardedCommandKey] = value as GuardAction;
		}
	}

	return { autonomousMode, guardedCommands };
}

/**
 * 加载运行时护栏配置。
 *
 * 解析顺序（项目覆盖全局）：
 *   1. 检查 JERO_PI_AUTONOMOUS_MODE 环境变量 —— 若为 "1"，强制 autonomousMode=true
 *      并使用默认的受守卫命令动作。
 *   2. 从 ${gentlePiConfigHome}/runtime-guardrails.json 读取全局配置
 *   3. 从 ${cwd}/.pi/jero/runtime-guardrails.json 读取项目配置
 *      （项目值合并覆盖在全局之上）
 *   4. 任何位置的解析/读取错误 → 保守回退（返回 SAFE_GUARDRAILS_CONFIG）
 */
// 宿主注入的 processEnv（测试接缝）：在扩展创建时设置，让护栏的
// 环境变量检查与运行时其余部分读取同一份环境，
// 而不是绕过接缝去取真实的 process.env。
let guardrailsProcessEnv: NodeJS.ProcessEnv = process.env;

function loadRuntimeGuardrailsConfig(
	cwd: string,
	options: LoadGuardrailsOptions = {},
): RuntimeGuardrailsConfig {
	try {
		// 环境变量覆盖：以默认动作强制进入自主模式
		if ((options.env ?? guardrailsProcessEnv).JERO_PI_AUTONOMOUS_MODE === "1") {
			return { autonomousMode: true, guardedCommands: {} };
		}

		const configHome = options.gentlePiConfigHome ?? gentleAiConfigHome();
		const globalConfigPath = join(configHome, "runtime-guardrails.json");
		const projectConfigPath = join(cwd, ".pi", "jero", "runtime-guardrails.json");

		let merged: RuntimeGuardrailsConfig = { autonomousMode: false, guardedCommands: {} };

		if (existsSync(globalConfigPath)) {
			const globalParsed = parseGuardrailsConfigFile(
				readFileSync(globalConfigPath, "utf8"),
			);
			if (!globalParsed) return SAFE_GUARDRAILS_CONFIG;
			merged = globalParsed;
		}

		if (existsSync(projectConfigPath)) {
			const projectParsed = parseGuardrailsConfigFile(
				readFileSync(projectConfigPath, "utf8"),
			);
			if (!projectParsed) return SAFE_GUARDRAILS_CONFIG;
			// 项目值完全覆盖全局值
			merged = {
				autonomousMode: projectParsed.autonomousMode,
				guardedCommands: {
					...merged.guardedCommands,
					...projectParsed.guardedCommands,
				},
			};
		}

		return merged;
	} catch {
		return SAFE_GUARDRAILS_CONFIG;
	}
}

const PATH_GUARDED_TOOL_NAMES = new Set(["read", "write", "edit"]);
const PATH_INPUT_KEYS = new Set([
	"path",
	"paths",
	"file",
	"files",
	"filePath",
	"filePaths",
]);
const SENSITIVE_PATH_PATTERNS: RegExp[] = [
	/(^|\/)\.ssh(?:\/|$)/,
	/(^|\/)\.credentials(?:\/|$)/,
	/(^|\/)library\/keychains(?:\/|$)/,
	/(^|\/)\.aws\/credentials$/,
	/(^|\/)\.config\/gh\/hosts\.ya?ml$/,
	/(^|\/)secrets(?:\/|$)/,
	/(^|\/)\.env(?:$|[./_-])/,
	/\.(?:pem|key|p12|pfx)$/,
];

const SDD_AGENT_NAME_SET = new Set<string>(SHIPPED_SDD_AGENT_NAMES);
const SDD_CHANGE_FLAG = "jero-sdd-change";
const SDD_CHANGE_KEYS = ["changeName", "phase", "workspaceRoot"] as const;

const JUDGMENT_DAY_AGENT_NAMES = [
	"jd-judge-a",
	"jd-judge-b",
	"jd-fix-agent",
] as const;

const CORE_MODEL_AGENT_NAMES = [
	...SHIPPED_SDD_AGENT_NAMES,
	...JUDGMENT_DAY_AGENT_NAMES,
] as const;
const CORE_MODEL_AGENT_NAME_SET = new Set<string>(CORE_MODEL_AGENT_NAMES);

type AgentSource = "project" | "user" | "builtin";

interface AgentEntry {
	name: string;
	source: AgentSource;
	filePath?: string;
}

const KEEP_CURRENT = "Keep current";
const INHERIT_MODEL = "Inherit active/default model";
const CUSTOM_MODEL = "Custom model id";
const INHERIT_THINKING = "Inherit effort";
const THINKING_OPTIONS: (ThinkingLevel | typeof INHERIT_THINKING)[] = [
	INHERIT_THINKING,
	...THINKING_LEVELS,
];

const MODEL_CONTROL_OPTIONS = [
	KEEP_CURRENT,
	INHERIT_MODEL,
	CUSTOM_MODEL,
] as const;
const MODEL_PANEL_MAX_RENDER_ROWS = 20;
const AGENT_LIST_MAX_VISIBLE_ROWS = MODEL_PANEL_MAX_RENDER_ROWS - 13;
const MODEL_LIST_MAX_VISIBLE_ROWS = 12;

function readStringPath(value: unknown, path: string[]): string | undefined {
	let current = value;
	for (const key of path) {
		if (!isRecord(current)) return undefined;
		current = current[key];
	}
	return typeof current === "string" ? current : undefined;
}

function isSddAgentStartEvent(event: unknown): boolean {
	const candidates = readAgentStartNames(event);
	if (candidates.some((value) => SDD_AGENT_NAME_SET.has(value)) || sddPhaseFromAgentStartEvent(event) !== undefined) return true;

	const systemPrompt = readStringPath(event, ["systemPrompt"]) ?? "";
	return SHIPPED_SDD_AGENT_NAMES.some((name) => {
		const phase = name.replace(/^sdd-/, "");
		return new RegExp(`\\bSDD ${phase} executor\\b`, "i").test(systemPrompt);
	});
}

function readAgentStartNames(event: unknown): string[] {
	return [
		readStringPath(event, ["agentName"]),
		readStringPath(event, ["agent"]),
		readStringPath(event, ["name"]),
		readStringPath(event, ["agent", "name"]),
		readStringPath(event, ["subagent", "name"]),
	]
		.filter((value): value is string => value !== undefined)
		.map((value) => value.trim())
		.filter((value) => value.length > 0);
}

function isNamedAgentStartEvent(event: unknown): boolean {
	return readAgentStartNames(event).length > 0;
}

function sddPhaseFromAgentStartEvent(event: unknown): SddPhase | "remediate" | undefined {
	const phases = ["apply", "verify", "sync", "archive", "remediate"] as const;
	const names = readAgentStartNames(event);
	const systemPrompt = readStringPath(event, ["systemPrompt"]) ?? "";
	const promptPhases = phases.filter((phase) => new RegExp(`\\bSDD ${phase} executor\\b`, "i").test(systemPrompt));
	if (promptPhases.length > 1) return undefined;
	if (names.length === 0) return promptPhases[0];
	return phases.find((phase) => names.every((name) => name === `sdd-${phase}`) &&
		(promptPhases.length === 0 || promptPhases[0] === phase));
}

function resolveSddChangeSelection(serialized: unknown, cwd: string, agentName: string) {
	if (typeof serialized !== "string") throw new Error("SDD selection must be a JSON string.");
	let value: unknown;
	try {
		value = JSON.parse(serialized);
	} catch {
		throw new Error("SDD selection is malformed.");
	}
	if (!isRecord(value) || Object.keys(value).sort().join(",") !== (value.phase === "remediate" ? "changeName,failedEvidenceRevision,phase,workspaceRoot" : SDD_CHANGE_KEYS.join(","))) {
		throw new Error("SDD selection must contain only changeName, workspaceRoot, and phase.");
	}
	const { changeName, workspaceRoot } = value;
	const phase = value.phase;
	if (typeof changeName !== "string" || changeName.length === 0 ||
		typeof workspaceRoot !== "string" || workspaceRoot.length === 0) {
		throw new Error("SDD selection has an invalid identity.");
	}
	// phase 的判别单独成句，让字面量联合收窄在深嵌套复合条件下不退化为 string。
	if (phase !== "apply" && phase !== "verify" && phase !== "sync" && phase !== "archive" && phase !== "remediate") {
		throw new Error("SDD selection has an invalid identity.");
	}
	if (agentName !== `sdd-${phase}`) throw new Error("SDD selection phase does not match the child agent.");
	let canonicalCwd: string;
	let canonicalSelectionRoot: string;
	try {
		canonicalCwd = realpathSync(cwd);
		canonicalSelectionRoot = realpathSync(workspaceRoot);
	} catch {
		throw new Error("SDD selection workspaceRoot cannot be resolved.");
	}
	if (canonicalCwd !== canonicalSelectionRoot || workspaceRoot !== canonicalSelectionRoot) {
		throw new Error("SDD selection workspaceRoot does not match the canonical child root.");
	}
	if (phase === "remediate" && (typeof value.failedEvidenceRevision !== "string" || !/^sha256:[0-9a-f]{64}$/.test(value.failedEvidenceRevision))) throw new Error("Invalid remediation revision");
	// 判别收窄得到的字面量联合在对象属性位置会拓宽为 string；显式收窄回声明的相位联合。
	return { changeName, workspaceRoot: canonicalCwd, phase: phase as SddPhase | "remediate", ...(phase === "remediate" ? { failedEvidenceRevision: value.failedEvidenceRevision as string } : {}) };
}

function resolveSddChangeStartup(
	serialized: unknown,
	cwd: string,
	agentName: string,
	resolver: (options: Parameters<typeof resolveSddStatus>[0]) => ReturnType<typeof resolveSddStatus> = resolveSddStatus,
) {
	const selection = resolveSddChangeSelection(serialized, cwd, agentName);
	const status = resolver({ cwd: selection.workspaceRoot, workspaceRoot: selection.workspaceRoot, changeName: selection.changeName, includeInstructions: true });
	if (status.actionContext.workspaceRoot !== selection.workspaceRoot || status.changeName !== selection.changeName) {
		throw new Error("SDD selection resolver returned a mismatched status.");
	}
	return { selection, status };
}

async function resolveSelectedNativeSddChangeStartup(
	serialized: unknown,
	cwd: string,
	agentName: string,
	native: Pick<NativeReviewCli, "sddStatus"> | null | undefined,
	localResolver: (options: Parameters<typeof resolveSddStatus>[0]) => ReturnType<typeof resolveSddStatus> = resolveSddStatus,
): Promise<{ selection: { changeName: string; workspaceRoot: string; phase: SddPhase | "remediate"; failedEvidenceRevision?: string }; status: NativeSddStatusV2 | ReturnType<typeof resolveSddStatus> }> {
	const selection = resolveSddChangeSelection(serialized, cwd, agentName);
	if (selection.phase === "sync") {
		const status = localResolver({ cwd: selection.workspaceRoot, workspaceRoot: selection.workspaceRoot, changeName: selection.changeName, includeInstructions: true });
		if (status.actionContext.workspaceRoot !== selection.workspaceRoot || status.changeName !== selection.changeName) {
			throw new Error("SDD selection resolver returned a mismatched status.");
		}
		return { selection, status };
	}
	if (native?.sddStatus === undefined) throw new Error("SDD selection native status is unavailable.");
	let status: NativeSddStatusV2;
	try {
		status = decodeNativeSddStatusV2(
			await native.sddStatus({ changeName: selection.changeName, workspaceRoot: selection.workspaceRoot }),
			{ changeName: selection.changeName, workspaceRoot: selection.workspaceRoot },
		);
	} catch (error) {
		throw new Error(`SDD selection native status is blocked: ${error instanceof Error ? error.message : String(error)}`);
	}
	if ((selection.phase !== "remediate" && !(selection.phase in status.dependencies)) || status.phaseInstructions === undefined || !(selection.phase in status.phaseInstructions)) {
		throw new Error(`SDD selection native status cannot represent phase ${selection.phase}.`);
	}
	if (selection.phase === "remediate") {
		if (status.nextRecommended !== "remediate" || status.remediationState?.failedEvidenceRevision !== selection.failedEvidenceRevision) throw new Error("Stale remediation selection");
	} else if (status.nextRecommended !== selection.phase || status.dependencies[selection.phase] !== "ready" || (status.blockedReasons.length > 0 && selection.phase !== "verify")) {
		// 原生契约要求 `blockedReasons` 非空时阻止 terminal、archive 和
		// apply 工作，但刻意保持 `verify` 路线可运行，因为阻塞原因可以
		// 指明证据刷新这一自身解药（“失败的验证证据不完整；
		// 重新运行 SDD 验证”，gentle-ai#3538）。否决该路线会让
		// 原生推荐的阶段不可达（gentle-pi#972）。其他阶段仍然
		// 保守失败，且每个阻塞原因都保留在注入的
		// status 中供上报。
		throw new Error(`SDD selection native status blocks phase ${selection.phase}; it cannot execute.`);
	}
	return { selection, status };
}

function readSddChangeFlag(pi: ExtensionAPI): unknown {
	try {
		const value = (pi as unknown as { getFlag?: (name: string) => unknown }).getFlag?.(SDD_CHANGE_FLAG);
		return value === false ? undefined : value;
	} catch {
		return null;
	}
}

function normalizePolicyPath(value: string): string {
	return value.trim().replace(/^~(?=\/|$)/, homedir()).replace(/\\/g, "/").toLowerCase();
}

function isSensitivePath(value: string): boolean {
	const normalized = normalizePolicyPath(value);
	return SENSITIVE_PATH_PATTERNS.some((pattern) => pattern.test(normalized));
}

function collectPathInputs(value: unknown, key?: string): string[] {
	if (typeof value === "string") return key && PATH_INPUT_KEYS.has(key) ? [value] : [];
	if (Array.isArray(value)) return value.flatMap((item) => collectPathInputs(item, key));
	if (!isRecord(value)) return [];
	return Object.entries(value).flatMap(([entryKey, entryValue]) =>
		collectPathInputs(entryValue, entryKey),
	);
}

function hasWritableMemoryTool(pi: ExtensionAPI): boolean {
	try {
		const getActiveTools = (pi as unknown as { getActiveTools?: () => unknown[] })
			.getActiveTools;
		if (typeof getActiveTools !== "function") return false;
		const tools = getActiveTools.call(pi);
		return tools.some((tool) => {
			const name =
				typeof tool === "string"
					? tool
					: isRecord(tool) && typeof tool.name === "string"
						? tool.name
						: "";
			return name === "mem_save" || name.endsWith(".mem_save");
		});
	} catch {
		return false;
	}
}

function evaluateSensitivePathTool(
	toolName: string,
	input: unknown,
): ToolCallEventResult | undefined {
	if (!PATH_GUARDED_TOOL_NAMES.has(toolName)) return undefined;
	const sensitivePath = collectPathInputs(input).find(isSensitivePath);
	if (!sensitivePath) return undefined;
	return {
		block: true,
		reason: `Jero safety policy blocked access to sensitive path: ${sanitizeTerminalText(sensitivePath)}. Ask the user for an explicit safer plan.`,
	};
}

// D6（design §5.3，rpiv 行）：`rpiv:ask-user:blocked` 监听器与
// choice/questionnaire 阻塞标签已删除——由于
// @juicesharp/rpiv-ask-user-question 是硬依赖，插件自管其
// 阻塞 UX。这里剩下的是受守卫命令的确认
// 生命周期（评审同意 UI，设计上是独立组件）。
const HERDR_BLOCKER_LABEL = {
	GUARDED_CONFIRMATION: "Guarded command confirmation",
} as const;

type HerdrBlockerLabel = (typeof HERDR_BLOCKER_LABEL)[keyof typeof HERDR_BLOCKER_LABEL];

type HerdrConfirmationLifecycle = {
	begin(): void;
	settle(): void;
};

function createHerdrConfirmationLifecycle(events: ExtensionAPI["events"]): HerdrConfirmationLifecycle {
	let pending = 0;
	let emittedLabel: HerdrBlockerLabel | undefined;
	const emitEffectiveBlocker = (): void => {
		const nextLabel = pending > 0 ? HERDR_BLOCKER_LABEL.GUARDED_CONFIRMATION : undefined;
		if (nextLabel === emittedLabel) return;
		emittedLabel = nextLabel;
		if (nextLabel === undefined) events.emit("herdr:blocked", { active: false });
		else events.emit("herdr:blocked", { active: true, label: nextLabel });
	};

	return {
		begin() {
			pending += 1;
			emitEffectiveBlocker();
		},
		settle() {
			if (pending === 0) return;
			pending -= 1;
			emitEffectiveBlocker();
		},
	};
}

async function confirmCommand(
	command: string,
	ctx: ExtensionContext,
	events: ExtensionAPI["events"],
	herdrLifecycle: HerdrConfirmationLifecycle,
): Promise<ToolCallEventResult | undefined> {
	const guardrailsConfig = loadRuntimeGuardrailsConfig(ctx.cwd);
	const evaluation = evaluateGuardedCommand(command, guardrailsConfig);
	const { action: classification } = evaluation;

	if (classification === "block") {
		return {
			block: true,
			reason:
				"Jero safety policy blocked a destructive shell command. Ask the user for an explicit safer plan.",
		};
	}

	if (classification === "not-guarded") return undefined;

	// 从这里开始，classification 只可能是 "allow" 或 "confirm"
	if (classification === "allow") return undefined;

	// classification === "confirm"
	if (!ctx.hasUI) {
		return {
			block: true,
			reason:
				"Jero safety policy requires interactive confirmation before this command.",
		};
	}
	const title = guardedCommandTitle(evaluation.key, evaluation.matches);
	const preview = guardedCommandPreview(command, evaluation.triggerIndex);
	const requestId = randomUUID();
	const emitPermissionRequest = (
		state: "waiting" | "approved" | "denied",
	): void => {
		events.emit("pi-permission-system:permission-request", {
			requestId,
			state,
			source: "tool_call",
			message: "Jero safety policy requires confirmation for this tool call.",
			toolName: "bash",
		});
	};
	let approved = false;
	let confirmationFailed = false;
	let confirmationError: unknown;
	emitPermissionRequest("waiting");
	herdrLifecycle.begin();
	try {
		approved = await ctx.ui.confirm(title, preview);
	} catch (error) {
		confirmationFailed = true;
		confirmationError = error;
	} finally {
		try {
			emitPermissionRequest(confirmationFailed || !approved ? "denied" : "approved");
		} finally {
			herdrLifecycle.settle();
		}
	}
	if (confirmationFailed) throw confirmationError;
	if (approved) return undefined;
	return {
		block: true,
		reason:
			"Jero safety policy blocked the command because it was not confirmed.",
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function gentleAiConfigHome(): string {
	return process.env.JERO_PI_CONFIG_HOME ?? join(homedir(), ".pi", "jero");
}

function modelConfigPath(_cwd: string): string {
	return join(gentleAiConfigHome(), "models.json");
}

function modelExportPath(_cwd: string): string {
	return join(gentleAiConfigHome(), "models.export.json");
}

const MODEL_EXPORT_KIND = "jero.agent_model_routing";
const MODEL_EXPORT_VERSION = 1;

function legacyProjectModelConfigPath(cwd: string): string {
	return join(cwd, ".pi", "jero", "models.json");
}

function projectPersonaConfigPath(cwd: string): string {
	return join(cwd, ".pi", "jero", "persona.json");
}

function personaConfigPath(_cwd: string): string {
	return join(gentleAiConfigHome(), "persona.json");
}

function readPersonaFile(path: string): PersonaMode | undefined {
	if (!existsSync(path)) return undefined;
	try {
		const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
		if (!isRecord(parsed)) return undefined;
		return parsed.mode === "neutral" ? "neutral" : "gentleman";
	} catch {
		return undefined;
	}
}

function readPersonaMode(cwd: string): PersonaMode {
	return (
		readPersonaFile(projectPersonaConfigPath(cwd)) ??
		readPersonaFile(personaConfigPath(cwd)) ??
		"gentleman"
	);
}

function writePersonaMode(cwd: string, mode: PersonaMode): string[] {
	const paths = [personaConfigPath(cwd)];
	const projectPath = projectPersonaConfigPath(cwd);
	if (existsSync(projectPath)) paths.push(projectPath);
	for (const path of paths) {
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, `${JSON.stringify({ mode }, null, 2)}\n`);
	}
	return paths;
}

function readSavedModelConfig(cwd: string): ModelConfigFileResult {
	const projectPath = legacyProjectModelConfigPath(cwd);
	const result = readModelRoutingAuthority(modelConfigPath(cwd), projectPath);
	return result.status === "invalid" && result.path === projectPath
		? { status: "valid", config: {} }
		: result;
}

async function readSavedModelConfigAsync(
	cwd: string,
): Promise<ModelConfigFileResult> {
	const projectPath = legacyProjectModelConfigPath(cwd);
	const result = await readModelRoutingAuthorityAsync(modelConfigPath(cwd), projectPath);
	return result.status === "invalid" && result.path === projectPath
		? { status: "valid", config: {} }
		: result;
}

export function readModelConfig(cwd: string): AgentModelConfig {
	const result = readSavedModelConfig(cwd);
	return result.status === "valid" ? result.config : {};
}

export async function readModelConfigAsync(
	cwd: string,
): Promise<AgentModelConfig> {
	const result = await readSavedModelConfigAsync(cwd);
	return result.status === "valid" ? result.config : {};
}

function writeModelConfig(cwd: string, config: AgentModelConfig): void {
	const path = modelConfigPath(cwd);
	mkdirSync(dirname(path), { recursive: true });
	const cleaned = normalizeModelConfig(config) ?? {};
	writeFileSync(path, `${JSON.stringify(cleaned, null, 2)}\n`);
}

async function writeModelConfigAsync(cwd: string, config: AgentModelConfig): Promise<void> {
	const path = modelConfigPath(cwd);
	await mkdir(dirname(path), { recursive: true });
	const cleaned = normalizeModelConfig(config) ?? {};
	await writeFile(path, `${JSON.stringify(cleaned, null, 2)}\n`);
}

function parseModelExport(value: unknown): AgentModelConfig | undefined {
	if (!isRecord(value)) return undefined;
	if (value.kind !== MODEL_EXPORT_KIND || value.version !== MODEL_EXPORT_VERSION) return undefined;
	return normalizeModelConfig(value.agents);
}

async function exportSavedModelConfig(ctx: ExtensionContext): Promise<number> {
	const saved = await readModelRoutingAuthorityAsync(
		modelConfigPath(ctx.cwd),
		legacyProjectModelConfigPath(ctx.cwd),
	);
	if (saved.status === "invalid") throw new Error(`Invalid model config: ${saved.path}`);
	const agents = saved.status === "valid" ? saved.config : {};
	const path = modelExportPath(ctx.cwd);
	await mkdir(dirname(path), { recursive: true });
	await writeFile(
		path,
		`${JSON.stringify({ kind: MODEL_EXPORT_KIND, version: MODEL_EXPORT_VERSION, agents }, null, 2)}\n`,
	);
	return Object.keys(agents).length;
}

async function readModelExport(ctx: ExtensionContext): Promise<AgentModelConfig | undefined> {
	try {
		return parseModelExport(JSON.parse(await readFile(modelExportPath(ctx.cwd), "utf8")));
	} catch {
		return undefined;
	}
}

function cloneModelConfig(config: AgentModelConfig): AgentModelConfig {
	return Object.fromEntries(
		Object.entries(config).map(([name, entry]) => [name, { ...entry }]),
	);
}

function updateFrontmatterRouting(
	content: string,
	entry: AgentRoutingEntry | undefined,
): string {
	if (!content.startsWith("---\n")) return content;
	const endIndex = content.indexOf("\n---", 4);
	if (endIndex === -1) return content;
	const frontmatter = content.slice(4, endIndex);
	const body = content.slice(endIndex);
	const lines = frontmatter
		.split("\n")
		.filter(
			(line) => !line.startsWith("model:") && !line.startsWith("thinking:"),
		);
	const toInsert: string[] = [];
	if (entry?.model) toInsert.push(`model: ${entry.model}`);
	if (entry?.thinking) toInsert.push(`thinking: ${entry.thinking}`);
	if (toInsert.length > 0) {
		const descriptionIndex = lines.findIndex((line) =>
			line.startsWith("description:"),
		);
		const insertIndex =
			descriptionIndex >= 0 ? descriptionIndex + 1 : Math.min(1, lines.length);
		lines.splice(insertIndex, 0, ...toInsert);
	}
	return `---\n${lines.join("\n")}${body}`;
}

/**
 * 代理文件当前携带的路由，读取方式与 `updateFrontmatterRouting`
 * 的写入方式一致：顶层的 `model:` 与 `thinking:`
 * frontmatter 行。其余情况一律视为“无路由”，而非错误。
 */
function readFrontmatterRouting(content: string): AgentRoutingEntry | undefined {
	if (!content.startsWith("---\n")) return undefined;
	const endIndex = content.indexOf("\n---", 4);
	if (endIndex === -1) return undefined;
	const raw: Record<string, string> = {};
	for (const line of content.slice(4, endIndex).split("\n")) {
		if (line.startsWith("model:")) raw.model = line.slice("model:".length).trim();
		else if (line.startsWith("thinking:")) raw.thinking = line.slice("thinking:".length).trim();
	}
	if (raw.model === undefined && raw.thinking === undefined) return undefined;
	const entry = normalizeRoutingEntry(raw);
	return entry && !isClearRoutingEntry(entry) ? entry : undefined;
}

function routingEntryFromModelProfile(value: unknown): AgentRoutingEntry | undefined {
	if (!isRecord(value)) return undefined;
	const entry = normalizeRoutingEntry({ model: value.model, thinking: value.effort });
	return entry && !isClearRoutingEntry(entry) ? entry : undefined;
}

function readSubagentModelProfiles(path: string): Record<string, unknown> {
	if (!existsSync(path)) return {};
	try {
		const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
		return isRecord(parsed) && isRecord(parsed.model_profiles) ? parsed.model_profiles : {};
	} catch {
		return {};
	}
}

async function readSubagentModelProfilesAsync(path: string): Promise<Record<string, unknown>> {
	if (!(await pathExists(path))) return {};
	try {
		const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
		return isRecord(parsed) && isRecord(parsed.model_profiles) ? parsed.model_profiles : {};
	} catch {
		return {};
	}
}

/**
 * 代理被物化时使用的路由——即子代理启动实际解析到的路由——
 * 与 `models.json` 记录了什么无关：运行时优先读取
 * `subagents.json` 的 model profiles，否则读取代理 frontmatter。
 */
function readMaterializedRoutingEntry(
	cwd: string,
	agent: AgentEntry,
	profilesByPath: Map<string, Record<string, unknown>>,
): AgentRoutingEntry | undefined {
	const profilesPath = agentModelProfileConfigPath(cwd, agent.source);
	let profiles = profilesByPath.get(profilesPath);
	if (!profiles) {
		profiles = readSubagentModelProfiles(profilesPath);
		profilesByPath.set(profilesPath, profiles);
	}
	const fromProfile = routingEntryFromModelProfile(profiles[agent.name]);
	if (fromProfile) return fromProfile;
	if (!agent.filePath || !existsSync(agent.filePath)) return undefined;
	try {
		return readFrontmatterRouting(readFileSync(agent.filePath, "utf8"));
	} catch {
		return undefined;
	}
}

async function readMaterializedRoutingEntryAsync(
	cwd: string,
	agent: AgentEntry,
	profilesByPath: Map<string, Record<string, unknown>>,
): Promise<AgentRoutingEntry | undefined> {
	const profilesPath = agentModelProfileConfigPath(cwd, agent.source);
	let profiles = profilesByPath.get(profilesPath);
	if (!profiles) {
		profiles = await readSubagentModelProfilesAsync(profilesPath);
		profilesByPath.set(profilesPath, profiles);
	}
	const fromProfile = routingEntryFromModelProfile(profiles[agent.name]);
	if (fromProfile) return fromProfile;
	if (!agent.filePath || !(await pathExists(agent.filePath))) return undefined;
	try {
		return readFrontmatterRouting(await readFile(agent.filePath, "utf8"));
	} catch {
		return undefined;
	}
}

/**
 * 生效中的路由：`models.json` 有话可说的部分照其所言，对它保持沉默的
 * 每个可发现代理，则取运行时实际解析的物化存储。因此稀疏的
 * `models.json` 绝不会掩盖仍在生效的路由（#1012）。读取永不写入。
 */
function readEffectiveModelConfig(cwd: string): AgentModelConfig {
	const effective = cloneModelConfig(readModelConfig(cwd));
	const profilesByPath = new Map<string, Record<string, unknown>>();
	for (const agent of listDiscoverableAgents(cwd)) {
		if (isProviderReviewRole(agent.name) || agent.name in effective) continue;
		const entry = readMaterializedRoutingEntry(cwd, agent, profilesByPath);
		if (entry) effective[agent.name] = entry;
	}
	return effective;
}

async function readEffectiveModelConfigAsync(cwd: string): Promise<AgentModelConfig> {
	const effective = cloneModelConfig(await readModelConfigAsync(cwd));
	const profilesByPath = new Map<string, Record<string, unknown>>();
	for (const agent of await listDiscoverableAgentsAsync(cwd)) {
		if (isProviderReviewRole(agent.name) || agent.name in effective) continue;
		const entry = await readMaterializedRoutingEntryAsync(cwd, agent, profilesByPath);
		if (entry) effective[agent.name] = entry;
	}
	return effective;
}

/**
 * profile 是一份完整的路由快照：应用它之后，所有它未提及的可发现代理
 * 都必须回到 inherit，而不是停留在之前物化的状态。用清空条目补齐
 * 被省略的代理，可以让 `applyModelConfig` 移除它们的 model profiles
 * 和 frontmatter 路由，方式与 `/jero:models` 清空一个被设为
 * inherit 的代理相同。
 */
async function withOmittedAgentsClearedAsync(
	cwd: string,
	config: AgentModelConfig,
): Promise<AgentModelConfig> {
	const completed = cloneModelConfig(config);
	for (const agent of await listDiscoverableAgentsAsync(cwd)) {
		if (isProviderReviewRole(agent.name) || agent.name in completed) continue;
		completed[agent.name] = {};
	}
	return completed;
}

function parseAgentName(filePath: string): string | undefined {
	let content: string;
	try {
		content = readFileSync(filePath, "utf8");
	} catch {
		return undefined;
	}
	const name = content.match(/^name:\s*["']?([^"'\n]+)["']?\s*$/m)?.[1]?.trim();
	if (!name) return undefined;
	const packageName = content
		.match(/^package:\s*["']?([^"'\n]+)["']?\s*$/m)?.[1]
		?.trim();
	return packageName ? `${packageName}.${name}` : name;
}

async function parseAgentNameAsync(
	filePath: string,
): Promise<string | undefined> {
	let content: string;
	try {
		content = await readFile(filePath, "utf8");
	} catch {
		return undefined;
	}
	const name = content.match(/^name:\s*["']?([^"'\n]+)["']?\s*$/m)?.[1]?.trim();
	if (!name) return undefined;
	const packageName = content
		.match(/^package:\s*["']?([^"'\n]+)["']?\s*$/m)?.[1]
		?.trim();
	return packageName ? `${packageName}.${name}` : name;
}

function listAgentFilesRecursive(dir: string): string[] {
	if (!existsSync(dir)) return [];
	const files: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) {
			if (entry.name === "skills") continue;
			files.push(...listAgentFilesRecursive(path));
		} else if (
			entry.isFile() &&
			entry.name.endsWith(".md") &&
			!entry.name.endsWith(".chain.md")
		)
			files.push(path);
	}
	return files;
}

async function listAgentFilesRecursiveAsync(dir: string): Promise<string[]> {
	if (!(await pathExists(dir))) return [];
	const files: string[] = [];
	let entries;
	try {
		entries = await readdir(dir, { withFileTypes: true });
	} catch {
		return files;
	}
	for (const entry of entries) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) {
			if (entry.name === "skills") continue;
			files.push(...(await listAgentFilesRecursiveAsync(path)));
		} else if (
			entry.isFile() &&
			entry.name.endsWith(".md") &&
			!entry.name.endsWith(".chain.md")
		) {
			files.push(path);
		}
	}
	return files;
}

function listAgentsFromDir(dir: string, source: AgentSource): AgentEntry[] {
	return listAgentFilesRecursive(dir)
		.map((filePath): AgentEntry | undefined => {
			const name = parseAgentName(filePath);
			return name ? { name, source, filePath } : undefined;
		})
		.filter((entry): entry is AgentEntry => entry !== undefined);
}

async function listAgentsFromDirAsync(
	dir: string,
	source: AgentSource,
): Promise<AgentEntry[]> {
	const filePaths = await listAgentFilesRecursiveAsync(dir);
	const entries: AgentEntry[] = [];
	for (const filePath of filePaths) {
		const name = await parseAgentNameAsync(filePath);
		if (name) entries.push({ name, source, filePath });
	}
	return entries;
}

interface DiscoverableNonBuiltinAgentRoot {
	dir: string;
	source: AgentSource;
	/** 该目录归包安装器所有，因此 packageAssetAudit 会报告它。 */
	packageManaged: boolean;
}

function discoverableNonBuiltinAgentRoots(cwd: string): DiscoverableNonBuiltinAgentRoot[] {
	const globalAgentHome = gentlePiAgentHome();
	const roots: DiscoverableNonBuiltinAgentRoot[] = [
		{ dir: join(globalAgentHome, "agents"), source: "user", packageManaged: true },
		{ dir: join(globalAgentHome, "subagents"), source: "user", packageManaged: false },
		{ dir: join(homedir(), ".agents"), source: "user", packageManaged: false },
		{ dir: join(cwd, ".agents"), source: "project", packageManaged: false },
		{ dir: join(cwd, ".pi", "agents"), source: "project", packageManaged: false },
		{ dir: join(cwd, ".pi", "subagents"), source: "project", packageManaged: false },
	];
	const unique = new Map<string, DiscoverableNonBuiltinAgentRoot>();
	for (const root of roots) {
		let canonical: string;
		try {
			canonical = realpathSync(root.dir);
		} catch {
			canonical = resolve(root.dir);
		}
		const existing = unique.get(canonical);
		if (existing) {
			// 重新插入，使靠后的别名保持真正的后根优先，即使
			// 另一个物理根出现在重复条目之间。合并后的
			// 包管理根必须保留其安装器所有的路径：所有权
			// 更新要按该词法路径对照受管理 manifest 根校验。
			const managedRoot = existing.packageManaged ? existing : root.packageManaged ? root : undefined;
			unique.delete(canonical);
			unique.set(canonical, {
				dir: managedRoot?.dir ?? root.dir,
				source: root.source,
				packageManaged: managedRoot !== undefined,
			});
		} else unique.set(canonical, root);
	}
	return [...unique.values()];
}

function builtinAgentDirs(cwd: string): string[] {
	return [
		join(PACKAGE_ROOT, "..", "pi-subagents-j0k3r", "agents"),
		join(cwd, ".pi", "npm", "node_modules", "pi-subagents-j0k3r", "agents"),
		join(homedir(), ".local", "lib", "node_modules", "pi-subagents-j0k3r", "agents"),
		join(PACKAGE_ROOT, "..", "pi-subagents", "agents"),
		join(cwd, ".pi", "npm", "node_modules", "pi-subagents", "agents"),
		join(homedir(), ".local", "lib", "node_modules", "pi-subagents", "agents"),
	];
}

function listBuiltinAgentNames(cwd: string): Set<string> {
	return new Set(
		builtinAgentDirs(cwd).flatMap((dir) =>
			listAgentsFromDir(dir, "builtin").map((agent) => agent.name),
		),
	);
}

async function listBuiltinAgentNamesAsync(cwd: string): Promise<Set<string>> {
	const names = new Set<string>();
	for (const dir of builtinAgentDirs(cwd)) {
		for (const agent of await listAgentsFromDirAsync(dir, "builtin")) {
			names.add(agent.name);
		}
	}
	return names;
}

function listDiscoverableAgents(cwd: string): AgentEntry[] {
	const builtinDirs = builtinAgentDirs(cwd);
	const agents = [
		...builtinDirs.flatMap((dir) => listAgentsFromDir(dir, "builtin")),
		...discoverableNonBuiltinAgentRoots(cwd).flatMap(({ dir, source }) =>
			listAgentsFromDir(dir, source),
		),
	];
	const byName = new Map<string, AgentEntry>();
	for (const agent of agents) byName.set(agent.name, agent);
	return orderDiscoverableAgents(Array.from(byName.values()));
}

async function listDiscoverableAgentsAsync(cwd: string): Promise<AgentEntry[]> {
	const builtinDirs = builtinAgentDirs(cwd);
	const agents: AgentEntry[] = [];
	for (const dir of builtinDirs) {
		agents.push(...(await listAgentsFromDirAsync(dir, "builtin")));
	}
	for (const { dir, source } of discoverableNonBuiltinAgentRoots(cwd)) {
		agents.push(...(await listAgentsFromDirAsync(dir, source)));
	}
	const byName = new Map<string, AgentEntry>();
	for (const agent of agents) byName.set(agent.name, agent);
	return orderDiscoverableAgents(Array.from(byName.values()));
}

function orderDiscoverableAgents(agents: AgentEntry[]): AgentEntry[] {
	const coreFirst = CORE_MODEL_AGENT_NAMES.map((name) =>
		agents.find((agent) => agent.name === name),
	).filter((agent): agent is AgentEntry => agent !== undefined);
	const rest = agents
		.filter((agent) => !CORE_MODEL_AGENT_NAME_SET.has(agent.name))
		.sort((left, right) => left.name.localeCompare(right.name));
	return [...coreFirst, ...rest];
}

function isClearRoutingEntry(entry: AgentRoutingEntry): boolean {
	return entry.model === undefined && entry.thinking === undefined;
}

function agentModelProfileConfigPath(cwd: string, source: AgentSource): string {
	return source === "project"
		? join(cwd, ".pi", "subagents.json")
		: join(gentlePiAgentHome(), "subagents.json");
}

function modelProfileForRoutingEntry(
	entry: AgentRoutingEntry | undefined,
): Record<string, string> | undefined {
	if (!entry || isClearRoutingEntry(entry)) return undefined;
	const profile: Record<string, string> = {};
	if (entry.model) profile.model = entry.model;
	if (entry.thinking) profile.effort = entry.thinking;
	return Object.keys(profile).length > 0 ? profile : undefined;
}

function updateSubagentModelProfileAtPath(
	path: string,
	name: string,
	entry: AgentRoutingEntry | undefined,
	options: { preserveExisting?: boolean } = {},
): boolean {
	let config: Record<string, unknown> = {};
	if (existsSync(path)) {
		try {
			const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
			if (isRecord(parsed)) config = { ...parsed };
		} catch {
			config = {};
		}
	}
	const modelProfiles = isRecord(config.model_profiles)
		? { ...config.model_profiles }
		: {};
	const profile = modelProfileForRoutingEntry(entry);
	// 一次写入若会让 profile 保持原样（包括删除一个本就不存在的
	// profile），就不算更新，且不触碰任何文件。
	if (JSON.stringify(modelProfiles[name]) === JSON.stringify(profile)) return false;
	if (profile) {
		if (options.preserveExisting && isRecord(modelProfiles[name])) return false;
		modelProfiles[name] = profile;
	} else delete modelProfiles[name];
	if (Object.keys(modelProfiles).length > 0) config.model_profiles = modelProfiles;
	else delete config.model_profiles;
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);
	return true;
}

async function updateSubagentModelProfileAtPathAsync(
	path: string,
	name: string,
	entry: AgentRoutingEntry | undefined,
	options: { preserveExisting?: boolean } = {},
): Promise<boolean> {
	let config: Record<string, unknown> = {};
	if (await pathExists(path)) {
		try {
			const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
			if (isRecord(parsed)) config = { ...parsed };
		} catch {
			config = {};
		}
	}
	const modelProfiles = isRecord(config.model_profiles)
		? { ...config.model_profiles }
		: {};
	const profile = modelProfileForRoutingEntry(entry);
	// 一次写入若会让 profile 保持原样（包括删除一个本就不存在的
	// profile），就不算更新，且不触碰任何文件。
	if (JSON.stringify(modelProfiles[name]) === JSON.stringify(profile)) return false;
	if (profile) {
		if (options.preserveExisting && isRecord(modelProfiles[name])) return false;
		modelProfiles[name] = profile;
	} else delete modelProfiles[name];
	if (Object.keys(modelProfiles).length > 0) config.model_profiles = modelProfiles;
	else delete config.model_profiles;
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, `${JSON.stringify(config, null, 2)}\n`);
	return true;
}

function updateSubagentModelProfile(
	cwd: string,
	source: AgentSource,
	name: string,
	entry: AgentRoutingEntry | undefined,
	options: { preserveExisting?: boolean } = {},
): boolean {
	return updateSubagentModelProfileAtPath(
		agentModelProfileConfigPath(cwd, source),
		name,
		entry,
		options,
	);
}

function projectSettingsPath(cwd: string): string {
	return join(cwd, ".pi", "settings.json");
}

/**
 * Pi 自己的全局 settings 文件，编排器模型所在之处。
 * profiles 拥有其中的三个 `default*` 键；本扩展中没有任何
 * 其他代码读写该文件。
 */
function orchestratorSettingsPath(): string {
	return join(gentlePiAgentHome(), "settings.json");
}

function removeLegacyAgentOverridesFromSettings(
	settingsPath: string,
	settings: Record<string, unknown>,
): void {
	const subagents = isRecord(settings.subagents)
		? { ...settings.subagents }
		: undefined;
	if (!subagents) return;
	delete subagents.agentOverrides;
	if (Object.keys(subagents).length > 0) settings.subagents = subagents;
	else delete settings.subagents;
	mkdirSync(dirname(settingsPath), { recursive: true });
	writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
}

function isValidJsonObjectFileOrMissing(path: string): boolean {
	if (!existsSync(path)) return true;
	try {
		return isRecord(JSON.parse(readFileSync(path, "utf8")));
	} catch {
		return false;
	}
}

const PROVIDER_REVIEW_ROLES = ["review-refuter", "review-validator"] as const;

function isProviderReviewRole(name: string): boolean {
	return PROVIDER_REVIEW_ROLES.some((role) => role === name);
}

function modelAssignmentNames(cwd: string): string[] {
	return [...new Set([
		...PROVIDER_REVIEW_ROLES,
		...listDiscoverableAgents(cwd).map((agent) => agent.name),
	])];
}

const PROVIDER_ROUTING_DEFAULT_LABELS = {
	model: "Pi persisted default model",
	effort: "Pi persisted default effort",
} as const;

type RoutingDefaultField = keyof typeof PROVIDER_ROUTING_DEFAULT_LABELS;

function routingDefaultLabel(name: string, field: RoutingDefaultField): string {
	return isProviderReviewRole(name) ? PROVIDER_ROUTING_DEFAULT_LABELS[field] : "inherit";
}

function migrateLegacyProjectModelOverrides(cwd: string): number {
	const settingsPath = projectSettingsPath(cwd);
	if (!existsSync(settingsPath)) return 0;
	let settings: Record<string, unknown>;
	try {
		const parsed: unknown = JSON.parse(readFileSync(settingsPath, "utf8"));
		if (!isRecord(parsed)) return 0;
		settings = { ...parsed };
	} catch {
		return 0;
	}
	const subagents = isRecord(settings.subagents) ? settings.subagents : undefined;
	const agentOverrides = isRecord(subagents?.agentOverrides)
		? subagents.agentOverrides
		: undefined;
	if (!agentOverrides) return 0;
	const agentsByName = new Map(listDiscoverableAgents(cwd).map((agent) => [agent.name, agent]));
	const migratableEntries = Object.entries(agentOverrides)
		.filter(([name]) => !isProviderReviewRole(name))
		.map(([name, value]) => ({ name, entry: normalizeRoutingEntry(value) }))
		.filter((item): item is { name: string; entry: AgentRoutingEntry } =>
			item.entry !== undefined && !isClearRoutingEntry(item.entry),
		);
	const targetPaths = new Set(
		migratableEntries.map(({ name }) =>
			agentModelProfileConfigPath(cwd, agentsByName.get(name)?.source ?? "project"),
		),
	);
	if (![...targetPaths].every(isValidJsonObjectFileOrMissing)) return 0;
	let migrated = 0;
	for (const { name, entry } of migratableEntries) {
		const source = agentsByName.get(name)?.source ?? "project";
		if (updateSubagentModelProfile(cwd, source, name, entry, { preserveExisting: true })) migrated += 1;
	}
	removeLegacyAgentOverridesFromSettings(settingsPath, settings);
	return migrated;
}

async function updateSubagentModelProfileAsync(
	cwd: string,
	source: AgentSource,
	name: string,
	entry: AgentRoutingEntry | undefined,
	options: { preserveExisting?: boolean } = {},
): Promise<boolean> {
	return updateSubagentModelProfileAtPathAsync(
		agentModelProfileConfigPath(cwd, source),
		name,
		entry,
		options,
	);
}

export function applyModelConfig(
	cwd: string,
	config: AgentModelConfig,
): { updated: number; skipped: number } {
	let updated = 0;
	let skipped = 0;
	const seenAgents = new Set<string>();
	for (const agent of listDiscoverableAgents(cwd)) {
		if (isProviderReviewRole(agent.name)) continue;
		seenAgents.add(agent.name);
		const entry = config[agent.name];
		if (entry === undefined) {
			skipped += 1;
			continue;
		}
		if (agent.source === "builtin") {
			if (updateSubagentModelProfile(cwd, agent.source, agent.name, entry)) updated += 1;
			else skipped += 1;
			continue;
		}
		if (!agent.filePath || !existsSync(agent.filePath)) {
			skipped += 1;
		} else {
			const original = readFileSync(agent.filePath, "utf8");
			const next = updateFrontmatterRouting(original, entry);
			if (next === original) {
				skipped += 1;
			} else {
				if (!updatePackageManagedSddAgentOwnership(agent.filePath, original, next)) {
					writeFileSync(agent.filePath, next);
				}
				updated += 1;
			}
		}
		if (updateSubagentModelProfile(cwd, agent.source, agent.name, entry)) updated += 1;
		else skipped += 1;
	}
	for (const [name, entry] of Object.entries(config)) {
		if (isProviderReviewRole(name)) continue;
		// 编排器属于路由而非代理：它的模型存放在 Pi 的全局
		// settings.json 中，绝不能进入 subagents.json。
		if (isProfileOrchestratorKey(name)) continue;
		if (!seenAgents.has(name) && isClearRoutingEntry(entry)) {
			if (updateSubagentModelProfile(cwd, "user", name, entry)) updated += 1;
			else skipped += 1;
		}
	}
	return { updated, skipped };
}

export async function applyModelConfigAsync(
	cwd: string,
	config: AgentModelConfig,
): Promise<{ updated: number; skipped: number }> {
	let updated = 0;
	let skipped = 0;
	const seenAgents = new Set<string>();
	for (const agent of await listDiscoverableAgentsAsync(cwd)) {
		if (isProviderReviewRole(agent.name)) continue;
		seenAgents.add(agent.name);
		const entry = config[agent.name];
		if (entry === undefined) {
			skipped += 1;
			continue;
		}
		if (agent.source === "builtin") {
			if (await updateSubagentModelProfileAsync(cwd, agent.source, agent.name, entry))
				updated += 1;
			else skipped += 1;
			continue;
		}
		if (!agent.filePath || !(await pathExists(agent.filePath))) {
			skipped += 1;
		} else {
			const original = await readFile(agent.filePath, "utf8");
			const next = updateFrontmatterRouting(original, entry);
			if (next === original) {
				skipped += 1;
			} else {
				if (!updatePackageManagedSddAgentOwnership(agent.filePath, original, next)) {
					await writeFile(agent.filePath, next);
				}
				updated += 1;
			}
		}
		if (await updateSubagentModelProfileAsync(cwd, agent.source, agent.name, entry))
			updated += 1;
		else skipped += 1;
	}
	for (const [name, entry] of Object.entries(config)) {
		if (isProviderReviewRole(name)) continue;
		if (isProfileOrchestratorKey(name)) continue;
		if (!seenAgents.has(name) && isClearRoutingEntry(entry)) {
			if (await updateSubagentModelProfileAsync(cwd, "user", name, entry))
				updated += 1;
			else skipped += 1;
		}
	}
	return { updated, skipped };
}

export async function applySavedModelConfig(
	ctx: ExtensionContext,
	applyConfig: typeof applyModelConfigAsync = applyModelConfigAsync,
): Promise<{ updated: number; skipped: number; invalidPath?: string }> {
	const result = await readModelRoutingAuthorityAsync(
		modelConfigPath(ctx.cwd),
		legacyProjectModelConfigPath(ctx.cwd),
	);
	if (result.status === "invalid") {
		return { updated: 0, skipped: 0, invalidPath: result.path };
	}
	return applyConfig(
		ctx.cwd,
		result.status === "valid" ? result.config : {},
	);
}

function describeModelConfig(cwd: string, config: AgentModelConfig): string[] {
	return modelAssignmentNames(cwd).map((name) => {
		const entry = config[name];
		const model = entry?.model ?? routingDefaultLabel(name, "model");
		const thinking = entry?.thinking ?? routingDefaultLabel(name, "effort");
		return `${sanitizeTerminalText(name)}: model=${sanitizeTerminalText(model)}, effort=${sanitizeTerminalText(thinking)}`;
	});
}

async function getPiModelOptions(ctx: ExtensionContext): Promise<string[]> {
	const models = await ctx.modelRegistry.getAvailable();
	const modelIds = models
		.map((model) => normalizeModelId(`${model.provider}/${model.id}`))
		.filter((model): model is string => model !== undefined)
		.sort((left, right) => left.localeCompare(right));
	return [...MODEL_CONTROL_OPTIONS, ...modelIds];
}

interface OverlayComponent {
	render(width: number): string[];
	handleInput(data: string): void;
	invalidate(): void;
}

type ModelPanelResult =
	| { type: "save"; config: AgentModelConfig }
	| { type: "custom"; agent: string | "all"; config: AgentModelConfig }
	| { type: "export"; config: AgentModelConfig }
	| { type: "restore"; config: AgentModelConfig }
	| { type: "cancel" };

const SET_ALL_AGENTS = "Set all agents";

const PANEL_TONE = {
	BORDER: "border",
	MUTED: "muted",
	TEXT: "text",
	TITLE: "title",
	ACCENT: "accent",
	STATUS: "status",
} as const;

type PanelTone = (typeof PANEL_TONE)[keyof typeof PANEL_TONE];

const PANEL_TONE_COLOR: Record<PanelTone, ThemeColor> = {
	border: "border",
	muted: "muted",
	text: "text",
	title: "accent",
	accent: "accent",
	status: "thinkingHigh",
};

class SddModelPanel implements OverlayComponent {
	private cursor = 0;
	private mode: "agents" | "models" | "effort" = "agents";
	private selectedRow = SET_ALL_AGENTS;
	private modelCursor = 0;
	private effortCursor = 0;
	private query = "";
	private readonly draft: AgentModelConfig;
	private readonly rows: string[];
	private readonly modelOptions: string[];
	private readonly done: (result: ModelPanelResult) => void;
	private readonly theme: Theme | undefined;

	constructor(
		initialConfig: AgentModelConfig,
		modelOptions: string[],
		agents: string[],
		done: (result: ModelPanelResult) => void,
		theme?: Theme,
	) {
		this.draft = cloneModelConfig(initialConfig);
		this.rows = [SET_ALL_AGENTS, ...agents];
		this.modelOptions = modelOptions;
		this.done = done;
		this.theme = theme;
	}

	invalidate(): void {}

	handleInput(data: string): void {
		if (this.mode === "models") {
			this.handleModelInput(data);
			return;
		}
		if (this.mode === "effort") {
			this.handleEffortInput(data);
			return;
		}
		this.handleAgentInput(data);
	}

	render(width: number): string[] {
		const innerWidth = Math.max(1, width - 4);
		const lines =
			this.mode === "models"
				? this.renderModelPicker(innerWidth)
				: this.mode === "effort"
					? this.renderEffortPicker(innerWidth)
					: this.renderAgentList(innerWidth);
		return this.renderCard(lines, width);
	}

	private renderCard(lines: string[], width: number): string[] {
		const innerWidth = Math.max(1, width - 4);
		const horizontal = "─".repeat(innerWidth + 2);
		const border = (text: string) => this.renderText(text, "border");
		return [
			border(`╭${horizontal}╮`),
			...lines.map(
				(line) =>
					`${border("│")} ${this.fitStyledLine(line, innerWidth)} ${border("│")}`,
			),
			border(`╰${horizontal}╯`),
		];
	}

	private fitStyledLine(line: string, width: number): string {
		const visible = stripAnsi(line);
		if (visible.length > width) {
			return truncateToWidth(visible, Math.max(1, width), "…", true);
		}
		return `${line}${" ".repeat(Math.max(0, width - visible.length))}`;
	}

	private renderLine(text = "", width: number, tone?: PanelTone): string {
		const safe = truncateToWidth(
			sanitizeTerminalText(text),
			Math.max(1, width),
			"…",
			true,
		);
		return tone ? this.renderText(safe, tone) : safe;
	}

	private renderText(text: string, tone: PanelTone): string {
		const safe = sanitizeTerminalText(text);
		if (!this.theme) return safe;
		return this.theme.fg(PANEL_TONE_COLOR[tone], safe);
	}

	private renderCursor(focused: boolean): string {
		return focused ? this.renderText("▸", "accent") : " ";
	}

	private handleAgentInput(data: string): void {
		const maxCursor = this.rows.length + 1;
		if (matchesKey(data, "ctrl+c") || matchesKey(data, "escape")) {
			this.done({ type: "cancel" });
			return;
		}
		if (matchesKey(data, "ctrl+s")) {
			this.done({ type: "save", config: this.draft });
			return;
		}
		if (matchesKey(data, "down") || matchesKey(data, "j")) {
			this.cursor = Math.min(maxCursor, this.cursor + 1);
			return;
		}
		if (matchesKey(data, "up") || matchesKey(data, "k")) {
			this.cursor = Math.max(0, this.cursor - 1);
			return;
		}
		if (matchesKey(data, "g")) {
			this.cursor = 0;
			return;
		}
		if (data === "G") {
			this.cursor = maxCursor;
			return;
		}
		if (matchesKey(data, "i")) {
			this.applyInherit();
			return;
		}
		if (matchesKey(data, "e")) {
			this.selectedRow = this.rows[this.cursor] ?? SET_ALL_AGENTS;
			this.mode = "effort";
			this.effortCursor = 0;
			return;
		}
		if (matchesKey(data, "x")) {
			this.done({ type: "export", config: this.draft });
			return;
		}
		if (matchesKey(data, "r")) {
			this.done({ type: "restore", config: this.draft });
			return;
		}
		if (matchesKey(data, "c")) {
			const row = this.rows[this.cursor];
			if (row === SET_ALL_AGENTS)
				this.done({ type: "custom", agent: "all", config: this.draft });
			else if (row)
				this.done({ type: "custom", agent: row, config: this.draft });
			return;
		}
		if (!matchesKey(data, "return")) return;
		if (this.cursor === this.rows.length) {
			this.done({ type: "save", config: this.draft });
			return;
		}
		if (this.cursor === this.rows.length + 1) {
			this.done({ type: "cancel" });
			return;
		}
		this.selectedRow = this.rows[this.cursor] ?? SET_ALL_AGENTS;
		this.mode = "models";
		this.modelCursor = 0;
		this.query = "";
	}

	private handleModelInput(data: string): void {
		const options = this.filteredModelOptions();
		if (matchesKey(data, "ctrl+c")) {
			this.done({ type: "cancel" });
			return;
		}
		if (matchesKey(data, "escape")) {
			this.mode = "agents";
			this.query = "";
			return;
		}
		if (matchesKey(data, "backspace")) {
			this.query = this.query.slice(0, -1);
			this.modelCursor = Math.min(
				this.modelCursor,
				Math.max(0, this.filteredModelOptions().length - 1),
			);
			return;
		}
		if (matchesKey(data, "down") || matchesKey(data, "j")) {
			this.modelCursor = Math.min(
				Math.max(0, options.length - 1),
				this.modelCursor + 1,
			);
			return;
		}
		if (matchesKey(data, "up") || matchesKey(data, "k")) {
			this.modelCursor = Math.max(0, this.modelCursor - 1);
			return;
		}
		if (matchesKey(data, "return")) {
			const selected = options[this.modelCursor];
			if (!selected) return;
			if (selected === CUSTOM_MODEL) {
				this.done({
					type: "custom",
					agent: this.selectedRow === SET_ALL_AGENTS ? "all" : this.selectedRow,
					config: this.draft,
				});
				return;
			}
			if (selected === KEEP_CURRENT) {
				this.mode = "agents";
				return;
			}
			this.applyModelSelection(
				selected === INHERIT_MODEL ? undefined : selected,
			);
			this.mode = "agents";
			return;
		}
		if (data.length === 1 && data.charCodeAt(0) >= 32) {
			this.query += data;
			this.modelCursor = 0;
		}
	}

	private applyModelSelection(model: string | undefined): void {
		const row = this.rows[this.cursor];
		if (row === SET_ALL_AGENTS) {
			for (const name of this.rows.slice(1)) this.setModel(name, model);
			return;
		}
		if (!row) return;
		this.setModel(row, model);
	}

	private applyThinkingSelection(thinking: ThinkingLevel | undefined): void {
		const row = this.selectedRow;
		if (row === SET_ALL_AGENTS) {
			for (const name of this.rows.slice(1)) this.setThinking(name, thinking);
			return;
		}
		this.setThinking(row, thinking);
	}

	private applyInherit(): void {
		const row = this.rows[this.cursor];
		if (row === SET_ALL_AGENTS) {
			for (const name of this.rows.slice(1)) this.clearEntry(name);
			return;
		}
		if (row) this.clearEntry(row);
	}

	private setModel(name: string, model: string | undefined): void {
		const current = this.draft[name] ?? {};
		if (model === undefined) delete current.model;
		else current.model = model;
		if (!current.model && !current.thinking) this.draft[name] = {};
		else this.draft[name] = current;
	}

	private setThinking(name: string, thinking: ThinkingLevel | undefined): void {
		const current = this.draft[name] ?? {};
		if (thinking === undefined) delete current.thinking;
		else current.thinking = thinking;
		if (!current.model && !current.thinking) this.draft[name] = {};
		else this.draft[name] = current;
	}

	private clearEntry(name: string): void {
		this.draft[name] = {};
	}

	private filteredModelOptions(): string[] {
		const query = this.query.trim().toLowerCase();
		if (!query) return this.modelOptions;
		return this.modelOptions.filter((option) =>
			option.toLowerCase().includes(query),
		);
	}

	private renderAgentList(width: number): string[] {
		const lines: string[] = [];
		const line = (text = "", tone?: PanelTone) =>
			this.renderLine(text, width, tone);
		lines.push(line("Assign Models and Effort to Agents", "title"));
		lines.push("");
		lines.push(line("Current assignments:", "muted"));
		lines.push("");
		const visibleRows = Math.min(AGENT_LIST_MAX_VISIBLE_ROWS, this.rows.length);
		const listCursor = Math.min(this.cursor, this.rows.length - 1);
		const start = Math.max(
			0,
			Math.min(
				listCursor - Math.floor(visibleRows / 2),
				Math.max(0, this.rows.length - visibleRows),
			),
		);
		const end = Math.min(this.rows.length, start + visibleRows);
		if (start > 0) lines.push(line(`  ↑ ${start} more agent(s)`, "muted"));
		for (let i = start; i < end; i++) {
			const row = this.rows[i] ?? SET_ALL_AGENTS;
			const focused = i === this.cursor;
			const label =
				row === SET_ALL_AGENTS
					? this.renderSetAllLabel(row)
					: this.renderAgentLabel(row);
			lines.push(`${this.renderCursor(focused)} ${label}`);
		}
		if (end < this.rows.length)
			lines.push(line(`  ↓ ${this.rows.length - end} more agent(s)`, "muted"));
		lines.push("");
		lines.push(
			`${this.renderCursor(this.cursor === this.rows.length)} ${this.renderText(
				"Continue",
				this.cursor === this.rows.length ? "accent" : "text",
			)}`,
		);
		lines.push(
			`${this.renderCursor(this.cursor === this.rows.length + 1)} ${this.renderText(
				"← Back",
				this.cursor === this.rows.length + 1 ? "accent" : "text",
			)}`,
		);
		lines.push("");
		lines.push(
			line(
				`j/k scroll • enter model/save • e effort • i ${isProviderReviewRole(this.rows[this.cursor] ?? "") ? "Pi persisted defaults" : "inherit"} • c custom • x export • r restore • ctrl+s save • esc back`,
				"muted",
			),
		);
		return lines;
	}

	private renderModelPicker(width: number): string[] {
		const lines: string[] = [];
		const options = this.filteredModelOptions();
		const line = (text = "", tone?: PanelTone) =>
			this.renderLine(text, width, tone);
		lines.push(
			line(`Select model for ${sanitizeTerminalText(this.selectedRow)}`, "title"),
		);
		lines.push("");
		lines.push(
			`${this.renderText("◎", "accent")} ${this.renderText(this.query || "search...", "muted")}`,
		);
		lines.push("");
		const start = Math.max(
			0,
			Math.min(
				this.modelCursor - Math.floor(MODEL_LIST_MAX_VISIBLE_ROWS / 2),
				Math.max(0, options.length - MODEL_LIST_MAX_VISIBLE_ROWS),
			),
		);
		const end = Math.min(options.length, start + MODEL_LIST_MAX_VISIBLE_ROWS);
		for (let i = start; i < end; i++) {
			const focused = i === this.modelCursor;
			lines.push(
				`${this.renderCursor(focused)} ${this.renderText(
					options[i] === INHERIT_MODEL && isProviderReviewRole(this.selectedRow)
						? routingDefaultLabel(this.selectedRow, "model")
						: (options[i] ?? ""),
					focused ? "status" : "text",
				)}`,
			);
		}
		if (options.length === 0) lines.push(line("  No matching models", "muted"));
		lines.push("");
		lines.push(
			line("j/k: navigate • type: search • enter: select • esc: back", "muted"),
		);
		return lines;
	}

	private handleEffortInput(data: string): void {
		if (matchesKey(data, "ctrl+c")) {
			this.done({ type: "cancel" });
			return;
		}
		if (matchesKey(data, "escape")) {
			this.mode = "agents";
			return;
		}
		if (matchesKey(data, "down") || matchesKey(data, "j")) {
			this.effortCursor = Math.min(
				Math.max(0, THINKING_OPTIONS.length - 1),
				this.effortCursor + 1,
			);
			return;
		}
		if (matchesKey(data, "up") || matchesKey(data, "k")) {
			this.effortCursor = Math.max(0, this.effortCursor - 1);
			return;
		}
		if (!matchesKey(data, "return")) return;
		const selected = THINKING_OPTIONS[this.effortCursor];
		if (selected === INHERIT_THINKING) this.applyThinkingSelection(undefined);
		else this.applyThinkingSelection(selected);
		this.mode = "agents";
	}

	private renderEffortPicker(width: number): string[] {
		const lines: string[] = [];
		const line = (text = "", tone?: PanelTone) =>
			this.renderLine(text, width, tone);
		lines.push(
			line(`Select effort for ${sanitizeTerminalText(this.selectedRow)}`, "title"),
		);
		lines.push("");
		for (let i = 0; i < THINKING_OPTIONS.length; i++) {
			const focused = i === this.effortCursor;
			lines.push(
				`${this.renderCursor(focused)} ${this.renderText(
					THINKING_OPTIONS[i] === INHERIT_THINKING && isProviderReviewRole(this.selectedRow)
						? routingDefaultLabel(this.selectedRow, "effort")
						: (THINKING_OPTIONS[i] ?? ""),
					focused ? "status" : "text",
				)}`,
			);
		}
		lines.push("");
		lines.push(line("j/k: navigate • enter: select • esc: back", "muted"));
		return lines;
	}

	private renderSetAllLabel(row: string): string {
		const models = this.rows
			.slice(1)
			.map((name) => this.draft[name]?.model ?? routingDefaultLabel(name, "model"));
		const efforts = this.rows
			.slice(1)
			.map((name) => this.draft[name]?.thinking ?? routingDefaultLabel(name, "effort"));
		const firstModel = models[0] ?? "inherit";
		const firstEffort = efforts[0] ?? "inherit";
		const modelLabel = models.every((value) => value === firstModel)
			? firstModel
			: "mixed";
		const effortLabel = efforts.every((value) => value === firstEffort)
			? firstEffort
			: "mixed";
		return `${this.renderText(sanitizeTerminalText(row).padEnd(20), "text")} ${this.renderText("model=", "muted")}${this.renderText(modelLabel, "status")}${this.renderText(
			", effort=",
			"muted",
		)}${this.renderText(effortLabel, "status")}`;
	}

	private renderAgentLabel(row: string): string {
		const model = this.draft[row]?.model ?? routingDefaultLabel(row, "model");
		const effort = this.draft[row]?.thinking ?? routingDefaultLabel(row, "effort");
		return `${this.renderText(sanitizeTerminalText(row).padEnd(20), "text")} ${this.renderText("model=", "muted")}${this.renderText(model, "status")}${this.renderText(
			", effort=",
			"muted",
		)}${this.renderText(effort, "status")}`;
	}
}

function renderSddModelPanelForTesting(
	initialConfig: AgentModelConfig,
	modelOptions: string[],
	agents: string[],
	width: number,
	theme?: Theme,
): string[] {
	return new SddModelPanel(initialConfig, modelOptions, agents, () => {}, theme).render(
		width,
	);
}

async function showSddModelPanel(
	ctx: ExtensionContext,
	config: AgentModelConfig,
): Promise<ModelPanelResult> {
	const modelOptions = await getPiModelOptions(ctx);
	const agents = modelAssignmentNames(ctx.cwd);
	return ctx.ui.custom<ModelPanelResult>(
		(_tui, theme, _keybindings, done) =>
			new SddModelPanel(config, modelOptions, agents, done, theme),
		{
			overlay: true,
			overlayOptions: {
				anchor: "center",
				width: "70%",
				minWidth: 72,
				maxHeight: "85%",
			},
		},
	);
}

async function handleModelsCommand(ctx: ExtensionContext): Promise<void> {
	migrateLegacyProjectModelOverrides(ctx.cwd);
	const savedConfig = await readModelRoutingAuthorityAsync(
		modelConfigPath(ctx.cwd),
		legacyProjectModelConfigPath(ctx.cwd),
	);
	if (savedConfig.status === "invalid") {
		ctx.ui.notify(
			`el Jero 无法打开模型配置：${savedConfig.path} 不是合法的 JSON 或不是对象。请修复或删除该文件，然后重新运行 /jero:models。`,
			"warning",
		);
		return;
	}
	let config = savedConfig.status === "valid" ? savedConfig.config : {};
	let result = await showSddModelPanel(ctx, config);
	while (result.type === "custom" || result.type === "export" || result.type === "restore") {
		config = cloneModelConfig(result.config);
		if (result.type === "export") {
			try {
				const count = await exportSavedModelConfig(ctx);
				ctx.ui.notify(`el Jero 已将 ${count} 条已保存的模型路由条目导出到 ${modelExportPath(ctx.cwd)}。`, "info");
			} catch (error) {
				ctx.ui.notify(`模型路由导出失败：${error instanceof Error ? error.message : String(error)}`, "warning");
			}
			result = await showSddModelPanel(ctx, config);
			continue;
		}
		if (result.type === "restore") {
			const restored = await readModelExport(ctx);
			if (!restored) {
				ctx.ui.notify(`模型路由恢复失败：${modelExportPath(ctx.cwd)} 缺失或无效。`, "warning");
				result = await showSddModelPanel(ctx, config);
				continue;
			}
			const approved = await ctx.ui.confirm("Restore saved model routing?", `Replace ${modelConfigPath(ctx.cwd)} with ${modelExportPath(ctx.cwd)}`);
			if (approved) {
				try {
					await writeModelConfigAsync(ctx.cwd, restored);
				} catch (error) {
					ctx.ui.notify(`模型路由恢复失败（尚未写入配置）：${error instanceof Error ? error.message : String(error)}`, "warning");
					result = await showSddModelPanel(ctx, config);
					continue;
				}
				config = restored;
				try {
					const applyResult = await applyModelConfigAsync(ctx.cwd, restored);
					ctx.ui.notify([
						"el Jero 已恢复全局模型配置。",
						`导入文件：${modelExportPath(ctx.cwd)}`,
						`全局配置：${modelConfigPath(ctx.cwd)}`,
						`已更新代理数：${applyResult.updated}`,
					].join("\n"), "info");
				} catch (error) {
					ctx.ui.notify([
						"el Jero 已恢复全局模型配置，但将其应用到代理时失败。",
						`全局配置：${modelConfigPath(ctx.cwd)}`,
						`应用错误：${error instanceof Error ? error.message : String(error)}`,
					].join("\n"), "warning");
				}
			}
			result = await showSddModelPanel(ctx, config);
			continue;
		}
		const current =
			result.agent === "all"
				? "inherit"
				: (config[result.agent]?.model ?? "inherit");
		const custom = await ctx.ui.input(
			`${result.agent === "all" ? "all agents" : sanitizeTerminalText(result.agent)} custom model id`,
			current === "inherit" ? "provider/model" : sanitizeTerminalText(current),
		);
		if (custom === undefined) return;
		const trimmed = custom.trim();
		if (trimmed.length > 0) {
			const model = normalizeModelId(trimmed);
			if (!model) {
				ctx.ui.notify(
					"自定义模型 id 必须是单行的 provider/model 标识符，只能使用字母、数字以及 '.'、'-'、'_'、'~'、':'、'@'、'/'、'+'、'%' 这些字符。",
					"warning",
				);
				result = await showSddModelPanel(ctx, config);
				continue;
			}
			if (result.agent === "all") {
				const next: AgentModelConfig = { ...config };
				for (const name of modelAssignmentNames(ctx.cwd)) {
					next[name] = {
						...(next[name] ?? {}),
						model,
					};
				}
				config = next;
			} else {
				config = {
					...config,
					[result.agent]: {
						...(config[result.agent] ?? {}),
						model,
					},
				};
			}
		}
		result = await showSddModelPanel(ctx, config);
	}
	if (result.type !== "save") return;
	writeModelConfig(ctx.cwd, result.config);
	const applyResult = await applyModelConfigAsync(ctx.cwd, result.config);
	ctx.ui.notify(
		[
			"el Jero 全局模型配置已保存。",
			`全局配置：${modelConfigPath(ctx.cwd)}`,
			`已更新代理数：${applyResult.updated}`,
			...describeModelConfig(ctx.cwd, result.config),
		].join("\n"),
		"info",
	);
}

type ProfilesPanelResult =
	| { type: "apply"; name: string }
	| { type: "create" }
	| { type: "update"; name: string }
	| { type: "duplicate"; name: string }
	| { type: "rename"; name: string }
	| { type: "delete"; name: string }
	| { type: "export"; name: string }
	| { type: "import" }
	| { type: "close" };

type ProfilesSnapshotHandler = (name: string) => AgentProfilesFile;

const PROFILES_PANEL_MIN_BODY_ROWS = 6;

type ProfilesPanelPointerLayout = AgentsViewLayout & { listTop: number };

function hasOwnProfile(profiles: Record<string, unknown>, name: string): boolean {
	return Object.prototype.hasOwnProperty.call(profiles, name);
}

function profilesErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/** 将详情面板的滚动偏移限制在其自身内容的边界之内。 */
function clampDetailScroll(offset: number, lineCount: number, bodyRows: number): number {
	return Math.max(0, Math.min(offset, Math.max(0, lineCount - bodyRows)));
}

// 左侧 profile 列表，右侧详情面板。渲染与指针路由共享
// 同一份测量布局；列表行通过 NativeChoiceList 保留原生键盘、悬停、
// 按下、点击与滚轮处理。外框占满整个
// overlay，因此其高度与 AgentsView 一样跟随终端行数。
class ProfilesPanel implements OverlayComponent {
	private completed = false;
	private pointerLayout: ProfilesPanelPointerLayout | undefined;
	private detailScroll = 0;
	private lastDetailLineCount = 0;
	private lastDetailRows = 0;
	private lastSelectedId: string | undefined;
	private feedback: string | undefined;
	readonly list: NativeChoiceList<ProfileListItem>;
	private file: AgentProfilesFile;
	private readonly currentConfig: AgentModelConfig;
	private readonly done: (result: ProfilesPanelResult) => void;
	private readonly saveSnapshot: ProfilesSnapshotHandler;
	private readonly requestRender: () => void;
	private readonly listItems: ProfileListItem[];
	private readonly theme: Theme | undefined;
	private readonly rows: () => number;
	private readonly orchestratorSettings: OrchestratorSettingsReadResult;

	constructor(
		file: AgentProfilesFile,
		currentConfig: AgentModelConfig,
		done: (result: ProfilesPanelResult) => void,
		keybindings: KeybindingsManager | undefined,
		theme: Theme | undefined,
		selectedName: string | undefined,
		rows: () => number,
		orchestratorSettings: OrchestratorSettingsReadResult,
		saveSnapshot: ProfilesSnapshotHandler,
		requestRender: () => void,
	) {
		this.file = file;
		this.currentConfig = currentConfig;
		this.done = done;
		this.saveSnapshot = saveSnapshot;
		this.requestRender = requestRender;
		this.theme = theme;
		this.rows = rows;
		this.orchestratorSettings = orchestratorSettings;
		const items = buildProfileListItems(file);
		this.listItems = items;
		this.list = new NativeChoiceList<ProfileListItem>(
			items,
			{
				selectedPrefix: (text) => this.renderText(text, "accent"),
				selectedText: (text) => this.renderText(text, "accent"),
				description: (text) => this.renderText(text, "muted"),
				hoverBackground: (text) => (this.theme ? this.theme.bg("toolPendingBg", text) : text),
			},
			keybindings,
		);
		this.list.onSelect = (item) => this.finish({ type: "apply", name: item.id });
		this.list.onCancel = () => this.finish({ type: "close" });
		const selected = selectedName ? items.findIndex((item) => item.id === selectedName) : -1;
		if (selected >= 0) this.list.setSelectedIndex(selected);
	}

	invalidate(): void {
		this.pointerLayout = undefined;
		this.list.invalidate();
	}

	handleInput(data: string): void {
		if (isKeyRelease(data)) return;
		if (matchesKey(data, "ctrl+c") || matchesKey(data, "escape")) {
			this.finish({ type: "close" });
			return;
		}
		const name = this.list.getSelectedItem()?.id;
		if (matchesKey(data, Key.pageDown) || matchesKey(data, Key.ctrl("j"))) {
			this.scrollDetail(this.pageRows());
			return;
		}
		if (matchesKey(data, Key.pageUp) || matchesKey(data, Key.ctrl("k"))) {
			this.scrollDetail(-this.pageRows());
			return;
		}
		// Agents 式逐行滚动：j/k 每次移动一行路由详情。
		// 方向键仍归属 profile 列表，正如下方的字母键
		// 仍归属 profile 操作。
		if (data === "j") {
			this.scrollDetail(1);
			return;
		}
		if (data === "k") {
			this.scrollDetail(-1);
			return;
		}
		if (data === "c") return this.finish({ type: "create" });
		if (data === "i") return this.finish({ type: "import" });
		if (!name) return this.list.handleInput(data);
		if (data === "s") {
			try {
				this.file = this.saveSnapshot(name);
				this.refreshListItems();
				this.feedback = `Snapshot saved; live routing unchanged. Profile "${name}" saved from current routing.`;
			} catch (error) {
				this.feedback = `Snapshot failed; live routing unchanged. Profile "${name}" was not saved from current routing: ${profilesErrorMessage(error)}`;
			}
			this.requestRender();
			return;
		}
		if (data === "d") return this.finish({ type: "duplicate", name });
		if (data === "r") return this.finish({ type: "rename", name });
		if (data === "x") return this.finish({ type: "delete", name });
		if (data === "e") return this.finish({ type: "export", name });
		this.list.handleInput(data);
	}

	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		const layout = this.pointerLayout;
		if (!layout) return undefined;
		const inBody = event.y >= layout.listTop && event.y < layout.listTop + layout.bodyRows;
		if (
			inBody &&
			event.type === "wheel" &&
			event.wheelDelta &&
			layout.mode === "panes" &&
			event.x >= layout.threadX &&
			event.x < layout.threadX + layout.threadWidth
		) {
			this.scrollDetail(event.wheelDelta);
			return { handled: true, render: true };
		}
		if (!inBody) return undefined;
		if (event.x < layout.listX || event.x >= layout.listX + layout.listWidth) return undefined;
		return this.list.handleMouse({
			...event,
			x: event.x - layout.listX,
			y: event.y - layout.listTop,
			width: layout.listWidth,
			height: layout.bodyRows,
		});
	}

	render(width: number): string[] {
		const safeWidth = Math.max(1, width);
		const listWidth = measureAgentsViewLayout(safeWidth, PROFILES_PANEL_MIN_BODY_ROWS + 3).listWidth;
		const listLines = this.list.render(listWidth);
		// 外框填满 overlay，而 overlay 填满终端，因此
		// 主体高度取决于终端行数而非内容本身。
		const rows = Math.max(PROFILES_PANEL_MIN_BODY_ROWS + 3, Math.floor(this.rows()));
		const layout = measureAgentsViewLayout(safeWidth, rows);
		if (layout.mode === "fallback" || layout.width === 0) {
			this.pointerLayout = undefined;
			return [];
		}
		const selectedId = this.list.getSelectedItem()?.id;
		if (selectedId !== this.lastSelectedId) {
			this.lastSelectedId = selectedId;
			this.detailScroll = 0;
		}
		const detailLines = this.renderDetailLines(layout.threadWidth, layout.mode === "panes");
		this.lastDetailLineCount = detailLines.length;
		this.lastDetailRows = layout.bodyRows;
		this.detailScroll = clampDetailScroll(this.detailScroll, detailLines.length, layout.bodyRows);
		this.pointerLayout = { ...layout, listTop: 1 };
		const rule = "─".repeat(Math.max(0, layout.width - 2));
		const lines: string[] = [this.renderText(`╭${rule}╮`, "border")];
		for (let row = 0; row < layout.bodyRows; row += 1) {
			lines.push(this.renderBodyRow(row, layout, listLines, detailLines));
		}
		lines.push(this.renderFooterRow(layout.width));
		lines.push(this.renderText(`╰${rule}╯`, "border"));
		return lines;
	}

	private scrollDetail(delta: number): void {
		this.detailScroll = clampDetailScroll(
			this.detailScroll + Math.trunc(delta),
			this.lastDetailLineCount,
			this.lastDetailRows,
		);
	}

	private refreshListItems(): void {
		// 在刷新 NativeChoiceList 已按引用持有的可变 item 记录时，
		// 保持列表实例（及其指针观察者）存活。
		for (const item of buildProfileListItems(this.file)) {
			const current = this.listItems.find((candidate) => candidate.id === item.id);
			if (current) Object.assign(current, item);
		}
		this.list.refreshItems();
	}

	private pageRows(): number {
		return Math.max(1, this.lastDetailRows - 1);
	}

	private finish(result: ProfilesPanelResult): void {
		if (this.completed) return;
		this.completed = true;
		this.list.setDisabled(true);
		this.done(result);
	}

	private renderBodyRow(
		row: number,
		layout: AgentsViewLayout,
		listLines: string[],
		detailLines: string[],
	): string {
		if (layout.mode === "panes") {
			return [
				this.renderText("│", "border"),
				" ",
				this.fitPaneLine(listLines[row] ?? "", layout.listWidth),
				" ",
				this.renderText("│", "border"),
				" ",
				this.fitPaneLine(detailLines[this.detailScroll + row] ?? "", layout.threadWidth),
				this.renderText("│", "border"),
			].join("");
		}
		return [
			this.renderText("│", "border"),
			" ",
			this.fitPaneLine(listLines[row] ?? "", layout.listWidth),
			" ",
			this.renderText("│", "border"),
		].join("");
	}

	private renderFooterRow(width: number): string {
		const hints =
			"enter apply · c create · s snapshot · d duplicate · r rename · x delete · e export · i import · j/k line · ctrl+j/k page · esc close";
		const text = this.feedback ?? hints;
		return [
			this.renderText("│", "border"),
			" ",
			this.fitPaneLine(this.renderText(text, this.feedback ? "status" : "muted"), width - 4),
			" ",
			this.renderText("│", "border"),
		].join("");
	}

	private renderDetailLines(width: number, showDetail: boolean): string[] {
		if (!showDetail) return [];
		const name = this.list.getSelectedItem()?.id;
		if (!name || !hasOwnProfile(this.file.profiles, name)) {
			return [this.renderLine("No profile selected.", width, "muted")];
		}
		const config = this.file.profiles[name];
		const profileRows = profileRoutingRows(config);
		const currentRows = profileRoutingRows(this.currentConfig);
		// 两张表共享同一次列宽测量，这样同一个代理无论来自
		// profile 还是 models.json，都落在同一列。
		const widths = routingColumnWidths(profileRows, currentRows);
		return [
			this.renderLine(name === this.file.active ? `${name} (active)` : name, width, "title"),
			this.renderLine(
				`orchestrator  ${formatOrchestratorSelection(readProfileOrchestrator(config))}`,
				width,
				"text",
			),
			this.renderLine(`now           ${this.effectiveOrchestratorLabel()}`, width, "muted"),
			"",
			this.renderLine("Profile routing", width, "accent"),
			...this.indentLines(this.routingLines(profileRows, widths), width),
			"",
			this.renderLine("Current routing (effective)", width, "accent"),
			...this.indentLines(this.routingLines(currentRows, widths), width),
		];
	}

	private effectiveOrchestratorLabel(): string {
		const settings = this.orchestratorSettings;
		if (settings.status === "invalid") {
			return `unreadable (${sanitizeTerminalText(settings.reason)})`;
		}
		return formatOrchestratorSelection(settings.status === "valid" ? settings.entry : undefined);
	}

	private routingLines(
		rows: ProfileRoutingRow[],
		widths: { agent: number; model: number },
	): string[] {
		if (rows.length === 0) {
			return ["No routing entries — every agent inherits its default model."];
		}
		return rows.map((row) => formatRoutingRow(row, widths));
	}

	private indentLines(lines: string[], width: number): string[] {
		return lines.map((line) => this.renderLine(`  ${line}`, width, "text"));
	}

	private fitPaneLine(line: string, width: number): string {
		const visible = stripAnsi(line);
		if (visible.length > width) {
			return truncateToWidth(visible, Math.max(1, width), "…", true);
		}
		return `${line}${" ".repeat(Math.max(0, width - visible.length))}`;
	}

	private renderLine(text: string, width: number, tone?: PanelTone): string {
		const safe = truncateToWidth(
			sanitizeTerminalText(text),
			Math.max(1, width),
			"…",
			true,
		);
		return tone ? this.renderText(safe, tone) : safe;
	}

	private renderText(text: string, tone: PanelTone): string {
		const safe = sanitizeTerminalText(text);
		if (!this.theme) return safe;
		return this.theme.fg(PANEL_TONE_COLOR[tone], safe);
	}
}

async function showProfilesPanel(
	ctx: ExtensionContext,
	file: AgentProfilesFile,
	currentConfig: AgentModelConfig,
	selectedName: string | undefined,
	saveSnapshot: ProfilesSnapshotHandler,
): Promise<ProfilesPanelResult> {
	// 面板生命周期内只读取一次。显示为 "now" 的编排器是
	// 面板打开时的状态，而不是面板中途会变化的值。
	const orchestratorSettings = readOrchestratorSettings(orchestratorSettingsPath());
	return ctx.ui.custom<ProfilesPanelResult>(
		(tui, theme, keybindings, done) => {
			const panel = new ProfilesPanel(
				file,
				currentConfig,
				done,
				keybindings,
				theme,
				selectedName,
				() => Math.max(0, tui.terminal.rows),
				orchestratorSettings,
				saveSnapshot,
				() => tui.requestRender(),
			);
			const container = createNativeFullscreenInteraction({
				keyboardTarget: panel,
				requestRender: () => tui.requestRender(),
				mouseObserver: panel.list.createMouseObserver(() => tui.requestRender()),
			});
			container.addChild(panel);
			return container;
		},
		{
			overlay: true,
			overlayOptions: {
				anchor: "center",
				width: "100%",
				maxHeight: "100%",
				margin: 0,
			},
		},
	);
}

function reportProfilesDrops(ctx: ExtensionContext, path: string, drops: ProfilesParseDrops): void {
	// 被丢弃的名字按定义就是校验失败的那些，因此它们是
	// 到达终端的不可信输入，必须像任何其他
	// 外部提供的文本一样做清洗。
	const parts: string[] = [];
	if (drops.droppedProfiles.length > 0) {
		parts.push(`profile：${drops.droppedProfiles.map((name) => sanitizeTerminalText(name)).join(", ")}`);
	}
	if (drops.droppedAgents.length > 0) {
		parts.push(
			`路由条目：${drops.droppedAgents.map(({ profile, agent }) => `${sanitizeTerminalText(profile)}/${sanitizeTerminalText(agent)}`).join(", ")}`,
		);
	}
	if (drops.droppedActive !== undefined) {
		parts.push(`active 标记：${sanitizeTerminalText(drops.droppedActive)}`);
	}
	if (parts.length > 0) {
		ctx.ui.notify(
			`el Jero 在加载 ${sanitizeTerminalText(path)} 时丢弃了无效条目 —— ${parts.join("；")}。`,
			"warning",
		);
	}
}

function profileSnapshotFrom(
	current: AgentModelConfig,
	settings: OrchestratorSettingsReadResult,
): AgentModelConfig {
	const snapshot = cloneModelConfig(current);
	if (settings.status === "valid" && settings.entry !== undefined) {
		snapshot[PROFILE_ORCHESTRATOR_KEY] = { ...settings.entry };
	}
	return snapshot;
}

async function runProfilesPanelAction(
	ctx: ExtensionContext,
	path: string,
	file: AgentProfilesFile,
	result: Exclude<ProfilesPanelResult, { type: "close" }>,
): Promise<AgentProfilesFile> {
	switch (result.type) {
		case "apply": {
			if (!hasOwnProfile(file.profiles, result.name)) return file;
			const normalized = normalizeModelConfig(file.profiles[result.name]) ?? {};
			const orchestratorEntry = readProfileOrchestrator(normalized);
			// 应用横跨三个文件——存储、models.json 与 Pi 的全局
			// settings.json——且不存在跨文件改名，所以按让存储
			// 保持真实、失败时补偿的顺序写入：先在存储中认领
			// profile，再物化路由，最后是编排器。认领失败
			// 则路由原封不动；认领之后的任何失败都会恢复
			// 之前的认领，且在已知先前活跃 profile 时，
			// 恢复该 profile 所隐含的路由。
			const claimed = setActiveProfile(file, result.name);
			try {
				writeProfilesFileSync(path, claimed);
			} catch (error) {
				ctx.ui.notify(
					`el Jero 无法更新 ${sanitizeTerminalText(path)}：${profilesErrorMessage(error)}`,
					"warning",
				);
				return file;
			}
			const previousActiveConfig =
				file.active !== undefined && hasOwnProfile(file.profiles, file.active)
					? normalizeModelConfig(file.profiles[file.active]) ?? {}
					: undefined;
			// 仅在编排器写入成功后设置，让回退逻辑知道有东西
			// 需要撤销。使用回滚闭包（而非先前的字节值）是因为
			// “该文件此前不存在”是一种真实状态，必须通过删除
			// 文件来恢复，而 `undefined` 字节无法承载这一区别。
			let orchestratorRollback: (() => void) | undefined;
			const revertClaim = async (routingWritten: boolean): Promise<AgentProfilesFile> => {
				let restored = previousActiveConfig === undefined ? "" : "路由";
				if (routingWritten && previousActiveConfig !== undefined) {
					try {
						await writeModelConfigAsync(ctx.cwd, previousActiveConfig);
						// 以相同的替换语义再次物化先前的
						// profile，让失败 profile 的路由不会
						// 残留在 subagents.json 或代理 frontmatter 中。
						await applyModelConfigAsync(
							ctx.cwd,
							await withOmittedAgentsClearedAsync(ctx.cwd, previousActiveConfig),
						);
					} catch {
						restored = "";
					}
				}
				if (orchestratorRollback) {
					try {
						orchestratorRollback();
						restored = restored === "" ? "settings" : `${restored}与 settings`;
					} catch {
						restored = restored === "" ? "" : restored;
					}
				}
				try {
					writeProfilesFileSync(path, file);
					restored = restored === "" ? "active 标记" : `${restored}与 active 标记`;
				} catch {
					restored = restored === "" ? "无" : restored;
				}
				const unresolved =
					routingWritten && previousActiveConfig === undefined
						? ` ${sanitizeTerminalText(modelConfigPath(ctx.cwd))} 仍保留该 profile 的路由，因为没有记录先前活跃的 profile 可供恢复。`
						: "";
				ctx.ui.notify(
					`el Jero 无法应用 profile "${result.name}"。已恢复：${restored}。${unresolved}`,
					"warning",
				);
				return file;
			};
			try {
				await writeModelConfigAsync(ctx.cwd, normalized);
			} catch (error) {
				ctx.ui.notify(
					`el Jero 无法写入 ${sanitizeTerminalText(modelConfigPath(ctx.cwd))}：${profilesErrorMessage(error)}`,
					"warning",
				);
				return revertClaim(false);
			}
			// models.json 保存 profile 原样写入的内容；用清空条目
			// 补齐只是为了驱动物化，这样 profile 未提及的代理
			// 回到 inherit，而不是保留先前物化的路由。
			let applyResult: { updated: number; skipped: number };
			try {
				applyResult = await applyModelConfigAsync(
					ctx.cwd,
					await withOmittedAgentsClearedAsync(ctx.cwd, normalized),
				);
			} catch (error) {
				ctx.ui.notify(
					`el Jero 无法物化 profile "${result.name}"：${profilesErrorMessage(error)}`,
					"warning",
				);
				return revertClaim(true);
			}
			let orchestratorNote = "";
			if (orchestratorEntry !== undefined) {
				const settingsPath = orchestratorSettingsPath();
				const written = applyOrchestratorSettings(settingsPath, orchestratorEntry);
				if (written.status === "invalid") {
					ctx.ui.notify(
						`el Jero 无法根据 profile "${result.name}" 设置编排器：${sanitizeTerminalText(written.reason)}。${sanitizeTerminalText(settingsPath)} 保持不变。`,
						"warning",
					);
					return revertClaim(true);
				}
				if (written.status === "written") {
					const previous = written.previous;
					orchestratorRollback = () => restoreOrchestratorSettings(settingsPath, previous);
					orchestratorNote = `\n已在 ${sanitizeTerminalText(settingsPath)} 中将编排器设为 ${formatOrchestratorSelection(orchestratorEntry)}。`;
				}
			}
			ctx.ui.notify(
				[
					`el Jero 已应用 profile "${result.name}" —— 更新了 ${applyResult.updated} 个代理。`,
					"新路由将在下一次子代理启动时生效。",
				].join("\n") + orchestratorNote,
				"info",
			);
			return claimed;
		}
		case "create": {
			const name = await ctx.ui.input("New profile name", "e.g. deep-work");
			if (name === undefined) return file;
			try {
				const next = createProfile(file, name.trim(), {});
				writeProfilesFileSync(path, next);
				return next;
			} catch (error) {
				ctx.ui.notify(`未能创建 profile：${profilesErrorMessage(error)}`, "warning");
				return file;
			}
		}
		case "update": {
			// profile 是完整快照，因此捕获当前路由的同时也
			// 捕获了路由运行所处的编排器。无法读取的 settings 文件
			// 会让快照不含编排器条目，
			// 而不是凭空编造一个。
			const snapshot = profileSnapshotFrom(
				await readEffectiveModelConfigAsync(ctx.cwd),
				readOrchestratorSettings(orchestratorSettingsPath()),
			);
			try {
				const next = updateProfile(file, result.name, snapshot);
				writeProfilesFileSync(path, next);
				ctx.ui.notify(
					`el Jero 已根据 ${modelConfigPath(ctx.cwd)} 中的当前路由更新 profile "${result.name}"。`,
					"info",
				);
				return next;
			} catch (error) {
				ctx.ui.notify(`未能更新 profile：${profilesErrorMessage(error)}`, "warning");
				return file;
			}
		}
		case "duplicate": {
			const name = await ctx.ui.input(`Duplicate profile "${result.name}" as`, `${result.name}-copy`);
			if (name === undefined) return file;
			try {
				const next = duplicateProfile(file, result.name, name.trim());
				writeProfilesFileSync(path, next);
				return next;
			} catch (error) {
				ctx.ui.notify(`未能复制 profile：${profilesErrorMessage(error)}`, "warning");
				return file;
			}
		}
		case "rename": {
			const name = await ctx.ui.input(`Rename profile "${result.name}" to`, result.name);
			if (name === undefined) return file;
			try {
				const next = renameProfile(file, result.name, name.trim());
				writeProfilesFileSync(path, next);
				return next;
			} catch (error) {
				ctx.ui.notify(`未能重命名 profile：${profilesErrorMessage(error)}`, "warning");
				return file;
			}
		}
		case "delete": {
			const approved = await ctx.ui.confirm(
				"Delete profile?",
				`Delete profile "${result.name}" from ${path}? The routing in ${modelConfigPath(ctx.cwd)} is not changed.`,
			);
			if (!approved) return file;
			try {
				const next = deleteProfile(file, result.name);
				writeProfilesFileSync(path, next);
				return next;
			} catch (error) {
				ctx.ui.notify(`未能删除 profile：${profilesErrorMessage(error)}`, "warning");
				return file;
			}
		}
		case "export": {
			if (!hasOwnProfile(file.profiles, result.name)) return file;
			const exportPath = profileExportPath(gentleAiConfigHome());
			try {
				const text = serializeProfileExport(result.name, file.profiles[result.name]);
				await mkdir(dirname(exportPath), { recursive: true });
				await writeFile(exportPath, text);
				ctx.ui.notify(`el Jero 已将 profile "${result.name}" 导出到 ${exportPath}。`, "info");
			} catch (error) {
				ctx.ui.notify(`profile 导出失败：${profilesErrorMessage(error)}`, "warning");
			}
			return file;
		}
		case "import": {
			const importPath = profileExportPath(gentleAiConfigHome());
			let text: string;
			try {
				text = await readFile(importPath, "utf8");
			} catch {
				ctx.ui.notify(`profile 导入失败：${importPath} 缺失或无法读取。`, "warning");
				return file;
			}
			const parsed = parseProfileExportTextWithDrops(text);
			if (!parsed) {
				ctx.ui.notify(
					`profile 导入失败：${importPath} 不是合法的代理模型 profile 导出文件。`,
					"warning",
				);
				return file;
			}
			if (parsed.droppedAgents.length > 0) {
				ctx.ui.notify(
					`el Jero 在导入 profile "${parsed.name}" 时丢弃了无效路由条目：${parsed.droppedAgents.join(", ")}。`,
					"warning",
				);
			}
			if (hasOwnProfile(file.profiles, parsed.name)) {
				const approved = await ctx.ui.confirm(
					"Replace existing profile?",
					`Profile "${parsed.name}" already exists in ${path}. Replace its routing with the import?`,
				);
				if (!approved) return file;
			}
			try {
				const next = hasOwnProfile(file.profiles, parsed.name)
					? updateProfile(file, parsed.name, parsed.config)
					: createProfile(file, parsed.name, parsed.config);
				writeProfilesFileSync(path, next);
				const entries = Object.keys(parsed.config).length;
				ctx.ui.notify(
					`el Jero 已从 ${importPath} 导入 profile "${parsed.name}"（${entries} 条路由）。`,
					"info",
				);
				return next;
			} catch (error) {
				ctx.ui.notify(`profile 导入失败：${profilesErrorMessage(error)}`, "warning");
				return file;
			}
		}
	}
}

async function handleProfilesCommand(ctx: ExtensionContext): Promise<void> {
	const path = profilesFilePath(gentleAiConfigHome());
	const read = readProfilesFileResult(path);
	if (read.status === "invalid") {
		ctx.ui.notify(
			`el Jero 无法打开代理 profiles：${path} 不是合法的 JSON 或不是 profiles 文件。请修复或删除该文件，然后重新运行 /jero:profiles。`,
			"warning",
		);
		return;
	}
	let file: AgentProfilesFile;
	if (read.status === "missing") {
		file = bootstrapProfilesFile(await readEffectiveModelConfigAsync(ctx.cwd));
		try {
			writeProfilesFileSync(path, file);
		} catch (error) {
			ctx.ui.notify(
				`el Jero 无法创建 ${path}：${profilesErrorMessage(error)}`,
				"warning",
			);
			return;
		}
		ctx.ui.notify(`el Jero 已根据当前生效的路由在 ${path} 中播种 "current" profile。`, "info");
	} else {
		file = read.file;
		reportProfilesDrops(ctx, path, read.drops);
	}
	const saveSnapshot: ProfilesSnapshotHandler = (name) => {
		const next = updateProfile(
			file,
			name,
			profileSnapshotFrom(
				readEffectiveModelConfig(ctx.cwd),
				readOrchestratorSettings(orchestratorSettingsPath()),
			),
		);
		writeProfilesFileSync(path, next);
		file = next;
		return next;
	};
	let selectedName: string | undefined;
	let result = await showProfilesPanel(
		ctx,
		file,
		await readEffectiveModelConfigAsync(ctx.cwd),
		selectedName,
		saveSnapshot,
	);
	while (result.type !== "close") {
		selectedName = "name" in result ? result.name : undefined;
		file = await runProfilesPanelAction(ctx, path, file, result);
		result = await showProfilesPanel(
			ctx,
			file,
			await readEffectiveModelConfigAsync(ctx.cwd),
			selectedName,
			saveSnapshot,
		);
	}
}

async function handlePersonaCommand(ctx: ExtensionContext): Promise<void> {
	const current = readPersonaMode(ctx.cwd);
	const selected = await ctx.ui.select(
		`el Jero persona (current: ${current})`,
		[...PERSONA_OPTIONS],
	);
	if (selected !== "gentleman" && selected !== "neutral") return;
	const writtenPaths = writePersonaMode(ctx.cwd, selected);
	ctx.ui.notify(
		[
			`el Jero 人格模式已设为：${selected}`,
			`全局配置：${personaConfigPath(ctx.cwd)}`,
			...(writtenPaths.length > 1
				? [`项目覆盖已更新：${projectPersonaConfigPath(ctx.cwd)}`]
				: []),
			"运行 /reload 或开启新的 Pi 会话，让已注入的提示词刷新。",
		].join("\n"),
		"info",
	);
}

// ---------------------------------------------------------------------------
// 评审门辅助函数 —— 纯函数，经 __testing 导出供单元测试使用
// ---------------------------------------------------------------------------

const REVIEW_CONTROLLER_OPERATION = {
	START: "start",
	ANSWER_CONSENT: "answer-consent",
	ADVANCE: "advance",
	ACKNOWLEDGE_APPROVED: "acknowledge-approved",
	STATUS: "status",
	SELECT_INTENDED_UNTRACKED: "select-intended-untracked",
	EXPORT: "export",
	IMPORT: "import",
	INSPECT: "inspect",
	RESET: "reset",
	RECOVER: "recover",
	RECOVER_LOCK: "recover-lock",
	ABANDON: "abandon",
	RECONCILE_AUTHORITY: "reconcile-authority",
	REPAIR: "repair",
	// gentle-pi#662：只读原生风险评估（gentle-ai#4295）。从不
	// 变更评审权威状态，也从不要求 lineageId。
	ASSESS: "assess",
} as const;

type ReviewControllerOperation =
	(typeof REVIEW_CONTROLLER_OPERATION)[keyof typeof REVIEW_CONTROLLER_OPERATION];

function reviewToolOperationPath(args: unknown): string {
	const operation = isRecord(args) ? args.operation : undefined;
	if (
		typeof operation !== "string" ||
		!Object.values(REVIEW_CONTROLLER_OPERATION).includes(operation as ReviewControllerOperation)
	) {
		return "review";
	}
	return `review ${operation.replaceAll("-", " ")}`;
}

const REVIEW_CONTROLLER_PARAMETERS = {
	type: "object",
	additionalProperties: false,
	required: ["operation"],
	properties: {
		operation: {
			type: "string",
			enum: Object.values(REVIEW_CONTROLLER_OPERATION),
			description: "Controller operation. Inspect authority before start. Reset requires the exact challenge returned by inspect.",
		},
		lineageId: {
			type: "string",
			description: "Bounded review lineage identifier. A failed start creates no lineage; do not use it with status or advance.",
		},
		selectionBinding: { type: "string", description: "Opaque provider-issued pre-lineage intended-untracked selection binding." },
		intendedUntracked: { type: "array", items: { type: "string" }, description: 'Repository-relative paths selected from the provider binding; on inspect they are accepted only with untrackedScope "select".' },
		untrackedScope: { type: "string", enum: ["exclude", "select"], description: 'Inspect-only: resolve the intended-untracked selection stop in one call. "exclude" excludes every eligible untracked path and forbids intendedUntracked; "select" includes exactly the supplied intendedUntracked paths.' },
		changeName: {
			type: "string",
			description: "Canonical OpenSpec change name required to resolve a recovered authority during lifecycle validate.",
		},
		idempotencyKey: {
			type: "string",
			description: "Required for graph-v1 start and advance operations.",
		},
		transition: {
			type: "string",
			description: "A supported REVIEW_TRANSITION value for advance.",
		},
		input: {
			type: "string",
			description: "A JSON-serialized object string, not a nested object. New native ordinary START uses {\"mode\":\"ordinary\"}; answer-consent uses exactly {\"consentBinding\":\"<opaque id>\",\"answer\":\"granted|declined\"}. Ordinary provider capture belongs only to jero_review_capture. An explicit baseRef requires committedOnly: true and requests a committed range, while repository-local policyPath remains optional. ASSESS accepts an optional object with baseRef, committedOnly, writerModelId, writerEffort, and nativeReviewOutcome (gentle-pi#662/#668); omitting writerModelId and writerEffort assesses the ambient working tree and fails closed to a small writer profile (never large) because the writer's actual profile is unknown to this call. nativeReviewOutcome (one of closed, declined, unavailable, unknown) tells ASSESS whether the native review actually closed for this candidate: when Receipt-driven development reads on but the review was declined for this candidate, is unavailable, or its outcome is unknown, ASSESS falls back to the exact risk-gated plan it returns when RDD is off, re-enabling the separate verifier -- a decline is candidate-scoped and never lowers the bar below the RDD-off path. Omitting it lets ASSESS try to derive declined/unavailable from what this process itself recorded for this exact candidate (never a different one, and never from repository state alone), failing closed to unknown when it cannot; `closed` is never derived -- pass it explicitly, and only right after acknowledging the approved review for this same candidate. The returned outcome_source (explicit|derived|unknown) says which of these produced the value. Legacy controller input remains separate.",
		},
		outputPath: { type: "string", description: "Retired with legacy bundle export; ignored. Export returns legacy-operation-retired." },
		inputPath: { type: "string", description: "Repository-local JSON input file for the separate legacy controller flow (alternative to input). Legacy bundle import is retired." },
		operationId: { type: "string", description: "Retired with legacy bundle transport; ignored. Export/import return legacy-operation-retired." },
		lineageIds: { type: "string", description: "Retired with legacy bundle export; ignored. Export returns legacy-operation-retired." },
		workspaceRoot: {
			type: "string",
			description: "Optional explicit user-authorized absolute path inside the Git worktree that owns this review. It must resolve to an existing Git worktree; nested paths are canonicalized to that worktree root. Pi never invents this selector. Absent, the session cwd is used unless one unambiguous lineage binding already identifies its target root.",
		},
	},
} as const;

const REVIEW_CAPTURE_PARAMETERS = {
	type: "object",
	additionalProperties: false,
	required: ["lineageId", "collectBinding"],
	properties: {
		lineageId: {
			type: "string",
			minLength: 1,
			description: "Exact lineage from the current provider-issued collect transition.",
		},
		collectBinding: {
			type: "string",
			minLength: 1,
			description: "JSON-serialized exact copy of one decoded provider-owned next_transition.collect input from current STATUS.",
		},
		reviewerRunAcknowledged: {
			type: "boolean",
			description: "Required only after the one-slot materialize reviewer forecast; authorizes exactly one Pi host-relay run.",
		},
		correctionLines: {
			type: "integer",
			minimum: 1,
			description: "Positive correction-line plan in diff lines: one replaced source line counts as two (one deletion plus one addition). A different unit from the provider's frozen logical correction budget. Accepted only for the selected provider correction-plan slot and within its exact bounds.",
		},
		workspaceRoot: {
			type: "string",
			description: "Optional explicit existing Git worktree root, resolved with the controller's worktree confinement semantics.",
		},
	},
} as const;

interface ReviewCaptureParameters {
	lineageId: string;
	collectBinding: string;
	reviewerRunAcknowledged?: boolean;
	correctionLines?: number;
	workspaceRoot?: string;
}

const REVIEW_CAPTURE_GROUP_PARAMETERS = {
	type: "object",
	additionalProperties: false,
	required: ["lineageId", "collectBindings"],
	properties: {
		lineageId: { type: "string", minLength: 1, description: "Exact lineage from the current provider-issued collect transition." },
		collectBindings: { type: "array", minItems: 1, items: { type: "string", minLength: 1 }, description: "Ordered JSON-serialized exact copies of the complete current materialize reviewer collect set." },
		reviewerRunAcknowledged: { type: "boolean", description: "Required after the one group forecast; authorizes exactly the forecast reviewer runs." },
		workspaceRoot: { type: "string", description: "Optional explicit existing Git worktree root, resolved with the controller's worktree confinement semantics." },
	},
} as const;

interface ReviewCaptureGroupParameters {
	lineageId: string;
	collectBindings: readonly string[];
	reviewerRunAcknowledged?: boolean;
	workspaceRoot?: string;
}

const REVIEW_SCOPE_PARAMETERS = {
	type: "object",
	additionalProperties: false,
	required: ["manifest", "sha256"],
	properties: {
		manifest: { type: "string", maxLength: 4_096, description: "Exact controller-supplied gzip/base64url frozen changed-scope manifest." },
		sha256: { type: "string", pattern: "^[0-9a-f]{64}$", description: "Exact controller-supplied SHA-256 of the decompressed canonical manifest bytes." },
		cursor: { type: "integer", minimum: 0, description: "Pagination cursor. Start at 0 and continue with nextCursor until absent." },
	},
} as const;

interface ReviewScopeParameters {
	manifest: string;
	sha256: string;
	cursor?: number;
}

// gentle-pi#662：只读原生风险评估，在渲染的
// `Receipt-driven development:` 行为 `off` 或 `unknown` 时，用原生风险
// 而非任务描述判断来给独立验证者设门。以 `jero_review` 的
// `assess` 操作暴露（不是独立工具），其可选字段经由控制器既有的
// 通用 `input` JSON 字符串传入，与 START 的
// `{"mode":...,"baseRef":...}` 完全一致。
interface ReviewAssessInput {
	baseRef?: string;
	committedOnly?: boolean;
	writerModelId?: string;
	writerEffort?: string;
	// gentle-pi#668：调用方自己掌握的该候选结果。
	// 省略时会尝试为本候选本身的 target identity 自动派生
	// declined/unavailable（绝不是别的候选）；`closed`
	// 永不自动派生——需显式传入。
	nativeReviewOutcome?: NativeReviewOutcome;
}

function isNativeReviewOutcome(value: unknown): value is NativeReviewOutcome {
	return typeof value === "string" && (Object.values(NATIVE_REVIEW_OUTCOME) as readonly string[]).includes(value);
}

function parseReviewAssessInput(operation: ReviewControllerOperation, raw: string | undefined): ReviewAssessInput {
	if (raw === undefined) return {};
	const value = parseControllerJson(raw, operation);
	const allowed = new Set(["baseRef", "committedOnly", "writerModelId", "writerEffort", "nativeReviewOutcome"]);
	const unexpected = Object.keys(value).find((key) => !allowed.has(key));
	if (unexpected !== undefined) throw new Error(`Review controller ${operation} input does not accept ${unexpected}`);
	const { baseRef, committedOnly, writerModelId, writerEffort, nativeReviewOutcome } = value;
	if (baseRef !== undefined && typeof baseRef !== "string") throw new Error(`Review controller ${operation} input baseRef must be a string`);
	if (committedOnly !== undefined && typeof committedOnly !== "boolean") throw new Error(`Review controller ${operation} input committedOnly must be a boolean`);
	if (writerModelId !== undefined && typeof writerModelId !== "string") throw new Error(`Review controller ${operation} input writerModelId must be a string`);
	if (writerEffort !== undefined && typeof writerEffort !== "string") throw new Error(`Review controller ${operation} input writerEffort must be a string`);
	if (nativeReviewOutcome !== undefined && !isNativeReviewOutcome(nativeReviewOutcome)) {
		throw new Error(`Review controller ${operation} input nativeReviewOutcome must be one of ${Object.values(NATIVE_REVIEW_OUTCOME).join(", ")}`);
	}
	return {
		...(baseRef === undefined ? {} : { baseRef: baseRef as string }),
		...(committedOnly === undefined ? {} : { committedOnly: committedOnly as boolean }),
		...(writerModelId === undefined ? {} : { writerModelId: writerModelId as string }),
		...(writerEffort === undefined ? {} : { writerEffort: writerEffort as string }),
		...(nativeReviewOutcome === undefined ? {} : { nativeReviewOutcome: nativeReviewOutcome as NativeReviewOutcome }),
	};
}

interface ReviewControllerParameters {
	operation: ReviewControllerOperation;
	lineageId?: string;
	selectionBinding?: string;
	intendedUntracked?: readonly string[];
	untrackedScope?: NativeStartUntrackedScope;
	changeName?: string;
	idempotencyKey?: string;
	transition?: string;
	input?: string;
	outputPath?: string;
	inputPath?: string;
	operationId?: string;
	lineageIds?: string;
	acknowledgeUntrustedBundleSource?: string;
	workspaceRoot?: string;
}

type NativeReviewAcknowledgementCli = NativeReviewCli & {
	acknowledgeApproved?: (request: NativeReviewAcknowledgeApprovedRequest) => Promise<NativeReviewAcknowledgeApprovedOutcome | void>;
};

interface ReviewControllerStartInput {
	mode: ReviewMode;
	projection: ReviewProjectionV1;
	policyHash: string;
	evidenceHash: string;
	budget: ReviewBudgetV1;
	parentLineageId?: string;
}

function isReviewControllerOperation(value: string): value is ReviewControllerOperation {
	return Object.values(REVIEW_CONTROLLER_OPERATION).some((operation) => operation === value);
}

function parseReviewControllerParameters(value: unknown): ReviewControllerParameters {
	if (!isRecord(value)) throw new Error("Review controller parameters must be an object");
	if (typeof value.operation !== "string" || !isReviewControllerOperation(value.operation)) {
		throw new Error("Review controller operation is unsupported");
	}
	if (value.operation === REVIEW_CONTROLLER_OPERATION.SELECT_INTENDED_UNTRACKED) {
		const unexpected = Object.keys(value).find((key) => !["operation", "selectionBinding", "intendedUntracked", "workspaceRoot"].includes(key));
		if (unexpected !== undefined || typeof value.selectionBinding !== "string" || !Array.isArray(value.intendedUntracked) || (value.workspaceRoot !== undefined && typeof value.workspaceRoot !== "string")) throw new Error("Review intended-untracked selection accepts exactly selectionBinding and intendedUntracked, with optional workspaceRoot");
		return { operation: value.operation, selectionBinding: value.selectionBinding, intendedUntracked: value.intendedUntracked, ...(typeof value.workspaceRoot === "string" ? { workspaceRoot: value.workspaceRoot } : {}) };
	}
	// gentle-pi#706：顶层 untrackedScope/intendedUntracked 仅凭
	// inspect 就能解决 intended-untracked 停止点。intendedUntracked 不是
	// 独立选择器：只有显式 select 范围时 inspect 才接受它。
	const hasIntendedUntracked = "intendedUntracked" in value;
	if (hasIntendedUntracked && value.operation !== REVIEW_CONTROLLER_OPERATION.INSPECT) {
		throw new Error(
			`Review controller ${value.operation} does not accept intendedUntracked; it is accepted only by inspect with untrackedScope select`,
		);
	}
	if (value.untrackedScope !== undefined) {
		if (value.operation !== REVIEW_CONTROLLER_OPERATION.INSPECT)
			throw new Error(
				`Review controller ${value.operation} does not accept untrackedScope; it is accepted only by inspect`,
			);
		if (
			value.untrackedScope !== NATIVE_START_UNTRACKED_SCOPE.EXCLUDE &&
			value.untrackedScope !== NATIVE_START_UNTRACKED_SCOPE.SELECT
		)
			throw new Error(
				"Review controller inspect untrackedScope must be exclude or select",
			);
	}
	if (hasIntendedUntracked) {
		if (value.untrackedScope !== NATIVE_START_UNTRACKED_SCOPE.SELECT) {
			throw new Error(
				"Review controller inspect intendedUntracked requires untrackedScope select",
			);
		}
		if (!Array.isArray(value.intendedUntracked)) {
			throw new Error(
				"Review controller inspect intendedUntracked must be an array of repository-relative paths",
			);
		}
	}

	const needsLineage = !([REVIEW_CONTROLLER_OPERATION.START, REVIEW_CONTROLLER_OPERATION.ANSWER_CONSENT, REVIEW_CONTROLLER_OPERATION.STATUS, REVIEW_CONTROLLER_OPERATION.EXPORT, REVIEW_CONTROLLER_OPERATION.IMPORT, REVIEW_CONTROLLER_OPERATION.INSPECT, REVIEW_CONTROLLER_OPERATION.RESET, REVIEW_CONTROLLER_OPERATION.RECOVER, REVIEW_CONTROLLER_OPERATION.RECOVER_LOCK, REVIEW_CONTROLLER_OPERATION.ABANDON, REVIEW_CONTROLLER_OPERATION.RECONCILE_AUTHORITY, REVIEW_CONTROLLER_OPERATION.REPAIR, REVIEW_CONTROLLER_OPERATION.ASSESS] as readonly ReviewControllerOperation[]).includes(value.operation);
	if (needsLineage && (typeof value.lineageId !== "string" || value.lineageId.trim().length === 0)) {
		throw new Error("Review controller requires a lineageId");
	}
	const untrackedScope = value.untrackedScope === NATIVE_START_UNTRACKED_SCOPE.EXCLUDE ? value.untrackedScope
		: value.untrackedScope === NATIVE_START_UNTRACKED_SCOPE.SELECT ? value.untrackedScope
		: undefined;
	let intendedUntracked: readonly string[] | undefined;
	// 上方 hasIntendedUntracked 块的 Array.isArray 检查保证数组性；元素类型与原 any[] 透传一致。
	if (hasIntendedUntracked) intendedUntracked = [...value.intendedUntracked as string[]];
	const parameters: ReviewControllerParameters = {
		operation: value.operation,
		...(typeof value.lineageId === "string" ? { lineageId: value.lineageId } : {}),
		...(value.operation === REVIEW_CONTROLLER_OPERATION.INSPECT && untrackedScope !== undefined ? { untrackedScope } : {}),
		...(value.operation === REVIEW_CONTROLLER_OPERATION.INSPECT && intendedUntracked !== undefined ? { intendedUntracked } : {}),
	};
	for (const key of ["changeName", "idempotencyKey", "transition", "input", "outputPath", "inputPath", "operationId", "lineageIds", "acknowledgeUntrustedBundleSource", "workspaceRoot"] as const) {
		const optional = value[key];
		if (optional !== undefined && typeof optional !== "string") {
			if (value.operation === REVIEW_CONTROLLER_OPERATION.START && key === "input") {
				throw new Error("Review controller START input must be a JSON string encoding an object, not a nested object. No lineage was created; do not call STATUS or ADVANCE for this attempted lineage.");
			}
			throw new Error(`Review controller ${key} must be a string`);
		}
		if (typeof optional === "string") parameters[key] = optional;
	}
	return parameters;
}

function parseReviewCaptureParameters(value: unknown): ReviewCaptureParameters {
	if (!isRecord(value)) throw new Error("Review capture parameters must be an object");
	const allowed = new Set(["lineageId", "collectBinding", "reviewerRunAcknowledged", "correctionLines", "workspaceRoot"]);
	const unexpected = Object.keys(value).find((key) => !allowed.has(key));
	if (unexpected !== undefined) throw new Error(`Review capture does not accept ${unexpected}`);
	if (!isCanonicalProcessString(value.lineageId)) throw new Error("Review capture requires an exact non-empty lineageId");
	if (typeof value.collectBinding !== "string" || value.collectBinding.length === 0) throw new Error("Review capture requires a JSON-serialized collectBinding");
	let reviewerRunAcknowledged: boolean | undefined;
	if (value.reviewerRunAcknowledged !== undefined) {
		if (typeof value.reviewerRunAcknowledged !== "boolean") throw new Error("Review capture reviewerRunAcknowledged must be boolean");
		reviewerRunAcknowledged = value.reviewerRunAcknowledged;
	}
	let correctionLines: number | undefined;
	if (value.correctionLines !== undefined) {
		// typeof 守卫只负责把 unknown 收窄成 number；整数语义仍由 isSafeInteger 把关。
		if (typeof value.correctionLines !== "number" || !Number.isSafeInteger(value.correctionLines) || value.correctionLines < 1) throw new Error("Review capture correctionLines must be a positive integer");
		correctionLines = value.correctionLines;
	}
	let workspaceRoot: string | undefined;
	if (value.workspaceRoot !== undefined) {
		if (typeof value.workspaceRoot !== "string") throw new Error("Review capture workspaceRoot must be a string");
		workspaceRoot = value.workspaceRoot;
	}
	return {
		lineageId: value.lineageId,
		collectBinding: value.collectBinding,
		...(reviewerRunAcknowledged === undefined ? {} : { reviewerRunAcknowledged }),
		...(correctionLines === undefined ? {} : { correctionLines }),
		...(workspaceRoot === undefined ? {} : { workspaceRoot }),
	};
}

function parseReviewCaptureGroupParameters(value: unknown): ReviewCaptureGroupParameters {
	if (!isRecord(value)) throw new Error("Review capture group parameters must be an object");
	const allowed = new Set(["lineageId", "collectBindings", "reviewerRunAcknowledged", "workspaceRoot"]);
	const unexpected = Object.keys(value).find((key) => !allowed.has(key));
	if (unexpected !== undefined) throw new Error(`Review capture group does not accept ${unexpected}`);
	if (!isCanonicalProcessString(value.lineageId)) throw new Error("Review capture group requires an exact non-empty lineageId");
	if (!Array.isArray(value.collectBindings) || value.collectBindings.length === 0 || value.collectBindings.some((binding) => typeof binding !== "string" || binding.length === 0)) throw new Error("Review capture group requires one or more JSON-serialized collectBindings");
	let reviewerRunAcknowledged: boolean | undefined;
	if (value.reviewerRunAcknowledged !== undefined) {
		if (typeof value.reviewerRunAcknowledged !== "boolean") throw new Error("Review capture group reviewerRunAcknowledged must be boolean");
		reviewerRunAcknowledged = value.reviewerRunAcknowledged;
	}
	let workspaceRoot: string | undefined;
	if (value.workspaceRoot !== undefined) {
		if (typeof value.workspaceRoot !== "string") throw new Error("Review capture group workspaceRoot must be a string");
		workspaceRoot = value.workspaceRoot;
	}
	return {
		lineageId: value.lineageId,
		collectBindings: [...value.collectBindings],
		...(reviewerRunAcknowledged === undefined ? {} : { reviewerRunAcknowledged }),
		...(workspaceRoot === undefined ? {} : { workspaceRoot }),
	};
}

function requiredControllerString(
	parameters: ReviewControllerParameters,
	key: "idempotencyKey" | "transition" | "command" | "input" | "outputPath" | "inputPath" | "operationId",
): string {
	const value = parameters[key];
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new Error(`Review controller ${parameters.operation} requires ${key}`);
	}
	return value;
}

function readRepositoryControllerInput(inputPath: string, repositoryRoot: string): string {
	const canonicalRoot = realpathSync(repositoryRoot);
	const requestedPath = resolve(canonicalRoot, inputPath);
	const relativePath = relative(canonicalRoot, requestedPath);
	if (relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
		throw new Error("Review controller inputPath must be confined to the repository");
	}
	const stat = lstatSync(requestedPath);
	if (!stat.isFile() || stat.isSymbolicLink() || realpathSync(requestedPath) !== requestedPath) {
		throw new Error("Review controller inputPath must be a regular non-symlink file");
	}
	return readFileSync(requestedPath, "utf8");
}

function parseControllerJson(input: string, operation: ReviewControllerOperation): Record<string, unknown> {
	let value: unknown;
	try {
		value = JSON.parse(input);
	} catch (error) {
		if (operation === REVIEW_CONTROLLER_OPERATION.START) {
			throw new Error(
				`Review controller START input must be a JSON string encoding an object: ${error instanceof Error ? error.message : String(error)}. No lineage was created; do not call STATUS or ADVANCE for this attempted lineage.`,
			);
		}
		throw new Error(
			`Review controller ${operation} input is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	if (!isRecord(value)) throw new Error(`Review controller ${operation} input must be a JSON object`);
	return value;
}

async function authorizeDestructiveReviewOperation(
	parametersValue: unknown,
	ctx: ExtensionContext,
): Promise<void> {
	const parameters = parseReviewControllerParameters(parametersValue);
	// 只有 RESET 携带旧式的全仓库挑战。原生 compact-v2 的
	// RECOVER 有自己的六字段契约和自己的派生
	// `gentle-ai.review-recovery-authorization/v1` 绑定，这两者都无法用
	// 旧式的 `repositoryId`/`commonDirHash`/`inventoryHash`/`confirmation`
	// 四元组表达。原生 INSPECT 也从不发布该四元组，因此
	// 在这里强求它会让唯一受支持的恢复流程不可达
	// （issue #212）。
	// RECOVER 在 `executeReviewControllerOperation` 中自行授权，因为
	// 其绑定只能从一次新的原生 target-status 读取中派生。
	const isReset = parameters.operation === REVIEW_CONTROLLER_OPERATION.RESET;
	const maintenance = nativeMaintenanceOperation(parameters.operation);
	if (!isReset && maintenance === undefined) return;
	const input = parseControllerJson(requiredControllerString(parameters, "input"), parameters.operation);
	if (maintenance !== undefined && (missingNativeMaintenanceInputs(maintenance, input).length > 0 || invalidNativeMaintenanceInput(maintenance, input))) return;
	if (isReset) {
		for (const key of ["repositoryId", "commonDirHash", "inventoryHash"] as const) {
			if (typeof input[key] !== "string" || input[key].length === 0) throw new Error(`Review controller ${parameters.operation} requires an exact string ${key}`);
		}
		if (typeof input.confirmation !== "string" || input.confirmation.length === 0) throw new Error(`Review controller ${parameters.operation} requires an exact string confirmation`);
	}
	if (!ctx.hasUI) {
		throw new Error(`Review controller ${parameters.operation.toUpperCase()} requires fresh explicit authorization through the interactive Pi UI; headless execution fails closed`);
	}
	const maintenanceAuthorization = maintenance === undefined ? undefined : nativeMaintenanceAuthorization(maintenance, input);
	const approved = await ctx.ui.confirm(
		maintenance !== undefined ? `Authorize review authority ${parameters.operation.toUpperCase()}?` : `Authorize destructive review authority ${parameters.operation.toUpperCase()}?`,
		maintenance !== undefined
			? [`Operation: ${parameters.operation.toUpperCase()}`, "Exact published authorization binding:", maintenanceAuthorization!, maintenance === "abandon" ? "The native command may abandon only an eligible pristine compact-v2 lineage." : "The native command may quarantine only the bound invalid recovery successor; the predecessor stays untouched."].join("\n")
			: [`Operation: ${parameters.operation.toUpperCase()}`, `Repository: ${input.repositoryId}`, `Exact challenge: ${input.confirmation}`, "This invalidates all prior review authority for this repository."].join("\n"),
	);
	if (!approved) throw new Error(`Review controller ${parameters.operation.toUpperCase()} was not explicitly authorized`);
}

function parseReviewBudget(value: unknown, label: string): ReviewBudgetV1 {
	if (!isRecord(value)) throw new Error(`${label} must be an object`);
	return value as unknown as ReviewBudgetV1;
}

function parseStartInput(value: Record<string, unknown>): ReviewControllerStartInput {
	if (value.mode !== REVIEW_MODE.ORDINARY && value.mode !== REVIEW_MODE.JUDGMENT_DAY) {
		throw new Error(
			'Review controller START supports only "ordinary" or "judgment-day" mode; use "ordinary" unless Judgment Day was explicitly selected. Pass input as a JSON string encoding the START object. START failed before authority access, so no lineage was created; do not call STATUS or ADVANCE for this attempted lineage.',
		);
	}
	if (!isRecord(value.projection) || typeof value.projection.kind !== "string") {
		throw new Error("Review controller start requires a projection");
	}
	let projection: ReviewProjectionV1;
	if (value.projection.kind === REVIEW_PROJECTION.COMPLETE) {
		projection = { kind: REVIEW_PROJECTION.COMPLETE };
	} else if (
		value.projection.kind === REVIEW_PROJECTION.INTENDED_COMMIT &&
		typeof value.projection.tree === "string"
	) {
		projection = {
			kind: REVIEW_PROJECTION.INTENDED_COMMIT,
			tree: value.projection.tree,
		};
	} else {
		throw new Error("Review controller start projection is unsupported or unresolved");
	}
	if (typeof value.policyHash !== "string" || typeof value.evidenceHash !== "string") {
		throw new Error("Review controller start requires policyHash and evidenceHash");
	}
	if (value.parentLineageId !== undefined && typeof value.parentLineageId !== "string") {
		throw new Error("Review controller parentLineageId must be a string");
	}
	const result: ReviewControllerStartInput = {
		mode: value.mode,
		projection,
		policyHash: value.policyHash,
		evidenceHash: value.evidenceHash,
		budget: parseReviewBudget(value.budget, "Review controller start budget"),
	};
	if (typeof value.parentLineageId === "string") result.parentLineageId = value.parentLineageId;
	return result;
}

function isReviewTransition(value: string): value is ReviewTransition {
	return Object.values(REVIEW_TRANSITION).some((transition) => transition === value);
}

function isGraphV1JudgmentDayLineage(cwd: string, lineageId: string): boolean {
	try {
		return ReviewTransactionStore.forRepository(cwd).read(lineageId).mode === REVIEW_MODE.JUDGMENT_DAY;
	} catch {
		return false;
	}
}

interface NativeStartPreAuthorityRejection {
	lineage_created: false;
	mutation_performed: false;
	mutation_outcome: "none";
	reset_eligible: false;
}

function nativeStartPreAuthorityRejection(): NativeStartPreAuthorityRejection {
	return {
		lineage_created: false,
		mutation_performed: false,
		mutation_outcome: "none",
		reset_eligible: false,
	};
}

// Organic-rdd-parity 第三阶段（设计决策 #7）：在 ORDINARY START 分支
// 顶部、targetStatus 之前咨询一次。在协商版本将 `mode` 能力报告为
// true 之前保持暗置——那种情况下 `reviewMode` 抛出
// VERSION_INCOMPATIBLE，这里将其与“能力缺失”同等对待
// （今天的路径不变），绝不当作失败。任何
// 其他错误（真正的原生进程故障）仍通过调用方既有的
// nativeOperationFailure 处理浮出。
const REVIEW_MODE_DISABLED_OUTCOME = "review-mode-disabled";

// 与 gentle-ai 的 reviewModeScopeForSource
// （internal/reviewtransaction/rdd_mode.go）对齐：continuation 按真正
// 做出决定的来源限定作用域，这样操作者不必自己去推断
// 两个独立来源中该改哪一个。
//
// clone-local 覆盖只能用于关闭。Pi 显式的 clone 范围 enable 会清除
// 该覆盖，但不能开启全局 RDD：当全局仍未设置或为 off 时，清除覆盖后
// 生效模式仍是 off。需要时应告诉操作者先完成全局
// opt-in，再清除这个 clone 覆盖。
// Pi 从不自动改写操作者的全局 gentle-ai 状态。
//
// default 分支随锁定的 v2.4.0 运行时而改变，回执驱动开发
// 变为 opt-in。它过去不可能是评审被关闭的原因——一个所有来源
// 均未设置的安装会解析为 ON 且来源为 `default`——所以为它命名
// continuation 只能是瞎猜，gentle-ai 正是为此返回空
// scope。v2.4.0 把同样的安装解析为 OFF 且来源为 `default`，这让它
// 成为最常见的拒绝：每一个从未 opt-in 的安装。gentle-ai 现在
// 对它回答 `global`，不是 default 代表全局意见，而是因为
// global 是唯一能把评审打开的 scope，Pi 也给出同样
// 回答。让它保持 undefined 等于把最常见的状态
// 逼进死胡同。
function reviewModeContinuation(source: NativeReviewModeSource): string | undefined {
	if (source === NATIVE_REVIEW_MODE_SOURCE.CLONE_LOCAL) return "If global RDD is still off, write {\"schema\":\"jero.authority.review-mode/v1\",\"value\":\"on\"} to ~/.pi/jero/review-mode.json, then run /jero:review-mode enable to clear this clone-local override.";
	if (source === NATIVE_REVIEW_MODE_SOURCE.GLOBAL) return "Write {\"schema\":\"jero.authority.review-mode/v1\",\"value\":\"on\"} to ~/.pi/jero/review-mode.json to turn reviews back on; /jero:review-mode enable only clears the clone-local setting, which cannot override a global off.";
	return "Write {\"schema\":\"jero.authority.review-mode/v1\",\"value\":\"on\"} to ~/.pi/jero/review-mode.json to opt in; RDD is off by default until explicitly enabled. /jero:review-mode enable only clears a clone-local override and cannot enable global RDD.";
}

// 先说处境再说机制，与 gentle-ai 的
// RDDDisabledError.Error() 对齐。Pi 选择跳过而非拒绝——被关闭的开关
// 在这里从不阻塞——但它不能丢弃是哪个来源做的决定，因为那正是
// 操作者需要的信息，也是唯一能选出可行恢复路径的依据。
function nativeReviewModeSkipped(operation: ReviewControllerOperation, source: NativeReviewModeSource): Record<string, unknown> {
	const continuation = reviewModeContinuation(source);
	return {
		operation,
		status: "skipped",
		outcome: REVIEW_MODE_DISABLED_OUTCOME,
		delivery: "disabled/unmanaged",
		mode_source: source,
		reason: `receipt-driven development is disabled: ${operation} is skipped because the ${source} mode source keeps it off`,
		...(continuation === undefined ? {} : { next_action: continuation }),
		...nativeStartPreAuthorityRejection(),
	};
}

async function resolveReviewModeGate(
	nativeReviewCli: NativeReviewCli | null,
	operation: ReviewControllerOperation,
	cwd: string,
	signal: AbortSignal | undefined,
): Promise<Record<string, unknown> | undefined> {
	if (nativeReviewCli?.reviewMode === undefined) return undefined;
	try {
		const mode = await nativeReviewCli.reviewMode({ cwd, operation: NATIVE_REVIEW_MODE_OPERATION.STATUS, ...(signal === undefined ? {} : { signal }) });
		return mode.status.effective === "off" ? nativeReviewModeSkipped(operation, mode.status.source) : undefined;
	} catch (error) {
		if (asNativeReviewCliError(error)?.code === NATIVE_REVIEW_ERROR_CODE.VERSION_INCOMPATIBLE) return undefined;
		throw error;
	}
}

// gentle-pi#185：没有协商出 STATUS 支持的原生 CLI（没有
// `targetStatus`，或 provider 版本不兼容）会在任何候选视图恢复尝试
// 之前撞上这条边界，因此绝不会复现 #176 的空注册表
// 失败——但这条边界自己的 `next_action` 是一个机器 token，
// 人类或代理都无法执行。`remediation_command` 指明恢复动作；
// 自二进制退役以来，STATUS 由进程内权威提供，唯一
// 失去它的可能就是 jero-pi 安装损坏。
const NATIVE_STATUS_UNSUPPORTED_REMEDIATION_COMMAND = "reinstall the jero-pi package (pnpm install); review STATUS is served in-process and there is no external CLI to run";

function nativeStatusUnsupported(operation: ReviewControllerOperation): Record<string, unknown> {
	return {
		operation,
		status: "blocked",
		outcome: "native-status-unsupported",
		...(operation === REVIEW_CONTROLLER_OPERATION.START ? nativeStartPreAuthorityRejection() : { mutation_performed: false }),
		inventory_complete: false,
		next_action: "require-upstream-read-only-native-status-inventory",
		remediation_command: NATIVE_STATUS_UNSUPPORTED_REMEDIATION_COMMAND,
		evidence: {
			native_contract: "gentle-ai/2.1.4",
			general_status: "unsupported",
			claimant_inventory: "unsupported",
		},
	};
}

// 打包版与源码版模块实例可能共存，因此 instanceof 不可靠。
function asNativeReviewCliError(error: unknown): { code: string; diagnostics: NativeReviewProcessDiagnostics } | undefined {
	if (error instanceof NativeReviewCliError) return error;
	if (!isRecord(error) || error.name !== "NativeReviewCliError") return undefined;
	const value = error as { code?: unknown; diagnostics?: unknown };
	if (typeof value.code !== "string") return undefined;
	const diagnostics = sanitizeForeignNativeReviewDiagnostics(value.diagnostics);
	return diagnostics === undefined || value.code !== diagnostics.error_code ? undefined : { code: value.code, diagnostics };
}

// 与上方 asNativeReviewCliError 相同的模块实例共存注意事项。
function asNativeReviewConsentBindingError(error: unknown): { reason: string; message: string } | undefined {
	if (error instanceof NativeReviewConsentBindingError) return { reason: error.reason, message: error.message };
	if (!(error instanceof Error) || error.name !== "NativeReviewConsentBindingError") return undefined;
	const reason = (error as unknown as { reason?: unknown }).reason;
	return typeof reason !== "string" || reason.length === 0 ? undefined : { reason, message: error.message };
}

function nativeStatusFailed(operation: ReviewControllerOperation, error: unknown): Record<string, unknown> {
	const cliError = asNativeReviewCliError(error);
	if (cliError?.code === NATIVE_REVIEW_ERROR_CODE.VERSION_INCOMPATIBLE) return nativeStatusUnsupported(operation);
	if (cliError !== undefined) {
		return {
			...nativeOperationFailure(operation, error),
			outcome: "native-status-unavailable",
			inventory_complete: false,
			next_action: "require-complete-native-authority-inventory",
		};
	}
	// gentle-pi#599：已协商的 STATUS/inspect 请求若被原生 provider 以
	// 解码后的 failure/v2 封套拒绝（例如针对嵌套外部 Git 仓库的预检
	// `invalid_request` 拒绝），过去会落到下方通用结果，
	// 丢弃封套自带的 cause、code、retry_safe 和 next_action——而那正是
	// 让拒绝可付诸行动的唯一信息（把目标嵌套仓库作为
	// workspaceRoot 传入）。`nativeOperationFailure` 已经为每个变更操作
	// 忠实渲染这种确切的失败封套形态；这里复用它，
	// 而不是把拒绝掩盖成不透明的权威清单
	// 损坏。
	if (error instanceof NativeReviewIntegrationError) {
		return {
			...nativeOperationFailure(operation, error),
			outcome: "native-status-unavailable",
			inventory_complete: false,
		};
	}
	return {
		operation,
		status: "blocked",
		outcome: "native-status-unavailable",
		lineage_created: false,
		mutation_performed: false,
		mutation_outcome: "none",
		inventory_complete: false,
		next_action: "require-complete-native-authority-inventory",
	};
}

const NATIVE_RECOVERY_INPUT = {
	reclaim: ["lineage", "actor", "reason"],
	recover: ["predecessorLineage", "expectedPredecessorRevision", "successorLineage", "disposition", "actor", "reason"],
} as const;

const NATIVE_MAINTENANCE_INPUT = {
	abandon: ["lineage", "expectedRevision", "snapshotIdentity", "actor", "reason"],
	reconcileAuthority: ["predecessorLineage", "expectedPredecessorRevision", "successorLineage", "expectedSuccessorRevision", "actor", "reason"],
} as const;
type NativeMaintenanceOperation = keyof typeof NATIVE_MAINTENANCE_INPUT;

function nativeMaintenanceOperation(operation: ReviewControllerOperation): NativeMaintenanceOperation | undefined {
	if (operation === REVIEW_CONTROLLER_OPERATION.ABANDON) return "abandon";
	if (operation === REVIEW_CONTROLLER_OPERATION.RECONCILE_AUTHORITY) return "reconcileAuthority";
	return undefined;
}

function missingNativeMaintenanceInputs(operation: NativeMaintenanceOperation, input: Record<string, unknown>): readonly string[] {
	const missing = NATIVE_MAINTENANCE_INPUT[operation].filter((key) => !isCanonicalProcessString(input[key]));
	if (operation !== "abandon") return missing;
	return [
		...missing,
		...(Array.isArray(input.capturedLensResults) && input.capturedLensResults.every((entry) => isCanonicalProcessString(entry)) ? [] : ["capturedLensResults"]),
		...(typeof input.findingsPresent === "boolean" ? [] : ["findingsPresent"]),
	];
}

function invalidNativeMaintenanceInput(operation: NativeMaintenanceOperation, input: Record<string, unknown>): boolean {
	return operation === "reconcileAuthority" && input.anomalies !== undefined && input.anomalies !== NATIVE_REVIEW_RECONCILE_ANOMALIES.COMBINED;
}

function nativeMaintenanceAuthorization(operation: NativeMaintenanceOperation, input: Record<string, unknown>): string {
	if (operation === "abandon") return nativeReviewAbandonAuthorization({ lineage: String(input.lineage), expectedRevision: String(input.expectedRevision), snapshotIdentity: String(input.snapshotIdentity), capturedLensResults: (input.capturedLensResults as readonly unknown[]).map(String), findingsPresent: input.findingsPresent === true, actor: String(input.actor), reason: String(input.reason) });
	return nativeReviewReconcileAuthorization({ predecessorLineage: String(input.predecessorLineage), expectedPredecessorRevision: String(input.expectedPredecessorRevision), successorLineage: String(input.successorLineage), expectedSuccessorRevision: String(input.expectedSuccessorRevision), actor: String(input.actor), reason: String(input.reason), ...(input.anomalies === undefined ? {} : { anomalies: NATIVE_REVIEW_RECONCILE_ANOMALIES.COMBINED }) });
}

async function executeNativeAuthorityMaintenance(
	operation: ReviewControllerOperation,
	nativeOperation: NativeMaintenanceOperation,
	input: Record<string, unknown>,
	cwd: string,
	nativeReviewCli: NativeReviewCli | null,
	signal: AbortSignal | undefined,
): Promise<Record<string, unknown>> {
	const method = nativeOperation === "abandon" ? nativeReviewCli?.abandon : nativeReviewCli?.reconcileAuthority;
	const nativeCommand = nativeOperation === "reconcileAuthority" ? "review reconcile-authority" : "review abandon";
	if (method === undefined) {
		return { operation, status: "blocked", outcome: "native-maintenance-unavailable", native_operation: nativeCommand, mutation_performed: false, mutation_outcome: "none", next_action: "in-process-review-authority-unavailable" };
	}
	const missing = missingNativeMaintenanceInputs(nativeOperation, input);
	if (missing.length > 0) {
		return { operation, status: "blocked", outcome: "native-input-required", native_operation: nativeCommand, missing_input: missing, mutation_performed: false, mutation_outcome: "none", next_action: "resubmit-with-exact-native-maintenance-input" };
	}
	if (invalidNativeMaintenanceInput(nativeOperation, input)) {
		return { operation, status: "blocked", outcome: "native-input-invalid", native_operation: nativeCommand, mutation_performed: false, mutation_outcome: "none", next_action: "resubmit-with-the-exact-published-native-maintenance-binding" };
	}
	try {
		const result = nativeOperation === "abandon"
			? await nativeReviewCli.abandon!({ cwd, lineage: String(input.lineage), expectedRevision: String(input.expectedRevision), snapshotIdentity: String(input.snapshotIdentity), capturedLensResults: (input.capturedLensResults as readonly unknown[]).map(String), findingsPresent: input.findingsPresent === true, actor: String(input.actor), reason: String(input.reason), maintainerAuthorization: nativeMaintenanceAuthorization(nativeOperation, input), ...(signal === undefined ? {} : { signal }) })
			: await nativeReviewCli.reconcileAuthority!({ cwd, predecessorLineage: String(input.predecessorLineage), expectedPredecessorRevision: String(input.expectedPredecessorRevision), successorLineage: String(input.successorLineage), expectedSuccessorRevision: String(input.expectedSuccessorRevision), actor: String(input.actor), reason: String(input.reason), ...(input.anomalies === undefined ? {} : { anomalies: NATIVE_REVIEW_RECONCILE_ANOMALIES.COMBINED }), maintainerAuthorization: nativeMaintenanceAuthorization(nativeOperation, input), ...(signal === undefined ? {} : { signal }) });
		return { operation, native_operation: nativeCommand, result: result.record, mutation_performed: true, mutation_outcome: "committed", next_action: "inspect" };
	} catch (error) {
		return nativeOperationFailure(operation, error);
	}
}


/**
 * 将破坏性控制器操作路由到最接近的已审计原生等价物：
 * RESET 与 RECOVER_LOCK 映射到 `gentle-ai review reclaim`
 * （对单个不完整条目的已审计隔离），RECOVER 映射到
 * `gentle-ai review recover`（可审计的后继权威）。旧流程从未
 * 携带过的原生输入通过结构化封套请求，
 * 而不是凭空捏造。Pi 自有的授权语义先于该
 * 路由运行且保持不变。
 */
async function executeNativeRecoveryRoute(
	operation: ReviewControllerOperation,
	nativeOperation: "reclaim" | "recover",
	input: Record<string, unknown>,
	cwd: string,
	nativeReviewCli: NativeReviewCli | null,
	signal: AbortSignal | undefined,
): Promise<Record<string, unknown>> {
	const nativeCommand = `review ${nativeOperation}`;
	const method = nativeOperation === "reclaim" ? nativeReviewCli?.reclaim : nativeReviewCli?.recover;
	if (nativeReviewCli === null || method === undefined) {
		return {
			operation,
			status: "blocked",
			outcome: "native-recovery-unavailable",
			native_operation: nativeCommand,
			mutation_performed: false,
			mutation_outcome: "none",
			next_action: "in-process-review-authority-unavailable",
		};
	}
	const missing = NATIVE_RECOVERY_INPUT[nativeOperation].filter((key) =>
		key === "disposition"
			? input[key] !== "scope_changed" && input[key] !== "invalidated" && input[key] !== "escalated"
			: typeof input[key] !== "string" || (input[key] as string).trim().length === 0,
	);
	if (missing.length > 0) {
		return {
			operation,
			status: "blocked",
			outcome: "native-input-required",
			native_operation: nativeCommand,
			missing_input: missing,
			mutation_performed: false,
			mutation_outcome: "none",
			next_action: "resubmit-with-exact-native-recovery-input",
		};
	}
	try {
		const result = nativeOperation === "reclaim"
			? await nativeReviewCli.reclaim!({ cwd, lineage: String(input.lineage), actor: String(input.actor), reason: String(input.reason), ...(signal === undefined ? {} : { signal }) })
			: await nativeReviewCli.recover!({
				cwd,
				predecessorLineage: String(input.predecessorLineage),
				expectedPredecessorRevision: String(input.expectedPredecessorRevision),
				successorLineage: String(input.successorLineage),
				disposition: input.disposition as "scope_changed" | "invalidated" | "escalated",
				actor: String(input.actor),
				reason: String(input.reason),
				...(typeof input.maintainerAuthorization === "string" ? { maintainerAuthorization: input.maintainerAuthorization } : {}),
				...(signal === undefined ? {} : { signal }),
			});
		return {
			operation,
			native_operation: nativeCommand,
			result: result.record,
			mutation_performed: true,
			mutation_outcome: "committed",
			next_action: "inspect",
		};
	} catch (error) {
		return nativeOperationFailure(operation, error);
	}
}

function mapNativeStartResult(result: NativeStartResult): Record<string, unknown> {
	return {
		lineage_id: result.lineageId,
		state: result.state,
		risk_tier: result.riskLevel,
		selected_lenses: result.selectedLenses,
		changed_files: result.changedFiles,
		original_changed_lines: result.changedLines,
		correction_budget: result.correctionBudget,
		action: result.action,
		lenses_required: result.lensesRequired,
		...(result.riskReasons === undefined ? {} : { risk_reasons: result.riskReasons }),
		// Organic-parity 直通（设计决策 #8，organic-rdd-parity）：
		// risk_evidence/hint 从原生 start 结果原样渲染，
		// 零本地派生；只要协商版本的能力是暗置的
		// （今天所有已发布行），两者都保持缺失。
		...(result.riskEvidence === undefined ? {} : { risk_evidence: result.riskEvidence }),
		...(result.hint === undefined ? {} : { hint: result.hint }),
		...(result.nextTransition === undefined ? {} : { next_transition: result.nextTransition }),
	};
}

function requiredStatusActionText(lineageId?: string): string {
	return `Run target-scoped review.status${lineageId === undefined ? "" : ` for lineage ${lineageId}`} and follow only its declared action.`;
}

// 公开的 collect 投影是 collectBindings：每个 provider collect
// 输入序列化一次，作为 jero_review_capture 消费的不透明绑定。
// 原始 next_transition.collect.inputs 携带相同字节，因此一个四镜头
// collect 状态过去每次 STATUS、INSPECT 或 START 应答要花约 2.8 万字符，
// 且每次被阻塞的重试还要再花一次（#465）。原始 transition
// 保留 kind 与 reason，让编排器仍能看到 collect 状态。
function withoutRawCollectInputs(raw: Record<string, unknown>): Record<string, unknown> {
	if (!isRecord(raw.next_transition)) return raw;
	const { collect: _collect, ...transition } = raw.next_transition;
	return { ...raw, next_transition: transition };
}

function mapNativeTargetStatus(operation: ReviewControllerOperation, status: ReviewStatusV3, requestedLineageId?: string): Record<string, unknown> {
	if (
		status.nextTransition?.kind === "collect" &&
		(operation === REVIEW_CONTROLLER_OPERATION.START || operation === REVIEW_CONTROLLER_OPERATION.INSPECT || operation === REVIEW_CONTROLLER_OPERATION.STATUS)
	) {
		const selection = reviewIntendedUntrackedInput(status);
		return {
			operation,
			status: "blocked",
			result: withoutRawCollectInputs(status.raw),
			...(selection === undefined
				? { collectBindings: publicReviewCaptureBindings(status) }
				: { selectionBinding: canonicalReviewCaptureBinding(selection) }),
		};
	}
	if (status.action === "recover") {
		return {
			operation,
			status: "blocked",
			result: status.raw,
			provider_action: "recover",
			recovery_disposition: status.actionDisposition,
			next_action: "recover-with-provider-disposition",
			required_status_action: "Use only the provider-selected recovery disposition; do not substitute scope_changed, invalidated, or escalated.",
		};
	}
	// gentle-pi#627：过期的受管理资产集会用能解决它的那条
	// 精确 `gentle-ai sync` 调用来停止 transition。把该命令渲染为
	// 唯一可行动的下一步；其他所有 reason code 继续
	// 渲染为普通的 blocked 结果。
	if (status.nextTransition?.kind === "stop" && status.nextTransition.reasonCode === "managed_assets_outdated" && status.nextTransition.continuation !== undefined) {
		return {
			operation,
			status: "blocked",
			result: status.raw,
			...(requestedLineageId === undefined ? {} : { requested_lineage_id: requestedLineageId }),
			hint: `run ${status.nextTransition.continuation.command}`,
		};
	}
	// gentle-pi#638：unachievable-lens 停止为每个声明的槽位携带精确的 withdraw 命令，与 managed_assets_outdated 的先例一致。从未见过 collect 提议的重启仍能仅凭这条提示找到回去的路。
	// gentle-pi#822：当调用方询问某一个 lineage 时，只渲染该 lineage 的 withdraw 命令；第一个条目可能属于无关的 lineage，因此未匹配的请求省略提示，而不是浮出可能无关的 withdraw 命令。没有请求 lineage 时，第一个条目仍是兜底。
	if (status.nextTransition?.kind === "stop" && status.nextTransition.reasonCode === "unachievable_lens_slot" && status.nextTransition.unachievableLensSlots !== undefined) {
		const withdrawSlot = requestedLineageId === undefined ? status.nextTransition.unachievableLensSlots[0] : status.nextTransition.unachievableLensSlots.find((slot) => slot.withdraw.binding.lineageId === requestedLineageId);
		return {
			operation,
			status: "blocked",
			result: status.raw,
			...(requestedLineageId === undefined ? {} : { requested_lineage_id: requestedLineageId }),
			...(withdrawSlot === undefined ? {} : { hint: `run ${withdrawSlot.withdraw.command}` }),
		};
	}
	return {
		operation,
		status: status.action === "start" ? "ready" : "blocked",
		result: status.raw,
		...(requestedLineageId === undefined ? {} : { requested_lineage_id: requestedLineageId }),
	};
}

interface NativeStartPolicyValidation {
	policyPath?: string;
	reason?: string;
}

function isStrictDescendantPath(parent: string, candidate: string): boolean {
	const pathFromParent = relative(parent, candidate);
	return pathFromParent.length > 0 && pathFromParent !== ".." && !pathFromParent.startsWith(`..${sep}`) && !isAbsolute(pathFromParent);
}

function validateNativeStartPolicyPath(cwd: string, value: unknown): NativeStartPolicyValidation {
	if (typeof value !== "string" || value.trim().length === 0) return { reason: "policy-path-not-regular" };
	let repository: string;
	try {
		repository = realpathSync(cwd);
	} catch {
		return { reason: "policy-path-outside-scope" };
	}
	const policyRoot = join(repository, ".jero", "policies");
	const candidate = resolve(repository, value);
	if (!isStrictDescendantPath(policyRoot, candidate)) return { reason: "policy-path-outside-scope" };
	const gentleDirectory = join(repository, ".jero");
	for (const directory of [gentleDirectory, policyRoot]) {
		try {
			const metadata = lstatSync(directory);
			if (metadata.isSymbolicLink()) return { reason: "policy-path-symlink" };
			if (!metadata.isDirectory()) return { reason: "policy-path-not-regular" };
		} catch {
			return { reason: "policy-path-not-regular" };
		}
	}
	const segments = relative(policyRoot, candidate).split(sep);
	let current = policyRoot;
	for (const [index, segment] of segments.entries()) {
		current = join(current, segment);
		try {
			const metadata = lstatSync(current);
			if (metadata.isSymbolicLink()) return { reason: "policy-path-symlink" };
			if (index === segments.length - 1) {
				if (!metadata.isFile()) return { reason: "policy-path-not-regular" };
			} else if (!metadata.isDirectory()) {
				return { reason: "policy-path-not-regular" };
			}
		} catch {
			return { reason: "policy-path-not-regular" };
		}
	}
	try {
		const canonicalPath = realpathSync(candidate);
		if (canonicalPath !== candidate || !isStrictDescendantPath(policyRoot, canonicalPath)) return { reason: "policy-path-symlink" };
		return { policyPath: canonicalPath };
	} catch {
		return { reason: "policy-path-not-regular" };
	}
}

const NATIVE_START_FOCUS = {
	RISK: "risk",
	RESILIENCE: "resilience",
	READABILITY: "readability",
	RELIABILITY: "reliability",
} as const;
type NativeStartFocus = (typeof NATIVE_START_FOCUS)[keyof typeof NATIVE_START_FOCUS];

function isNativeStartFocus(value: unknown): value is NativeStartFocus {
	return typeof value === "string" && (Object.values(NATIVE_START_FOCUS) as readonly string[]).includes(value);
}

const NATIVE_START_UNTRACKED_SCOPE = {
	EXCLUDE: "exclude",
	SELECT: "select",
} as const;
type NativeStartUntrackedScope = (typeof NATIVE_START_UNTRACKED_SCOPE)[keyof typeof NATIVE_START_UNTRACKED_SCOPE];

interface NativeStartUntrackedSelection {
	untrackedScope?: NativeStartUntrackedScope;
	expectedUntrackedInventory?: string;
	intendedUntracked?: readonly string[];
	reason?: string;
}

interface RetainedNativeUntrackedSelection {
	readonly untrackedScope: NativeStartUntrackedScope;
	readonly expectedUntrackedInventory: string;
	readonly intendedUntracked: readonly string[];
	readonly submission?: NativeIntendedUntrackedSelectionSubmission;
}

interface RetainedPreLineageNativeUntrackedSelection extends RetainedNativeUntrackedSelection {
	readonly targetIdentity: string;
	readonly candidateTree: string;
}

interface RetainedNativeCaptureRoute { readonly workspaceRoot: string; readonly lineageId: string; readonly baseRef?: string; readonly committedOnly?: true; }

type RetainedNativeStatusSelection = RetainedNativeUntrackedSelection | RetainedNativeCaptureRoute;

const MAX_RETAINED_NATIVE_STATUS_SELECTIONS = 64;
class NativeCaptureRouteRegistrationError extends Error {}

function isNativeStartUntrackedPath(value: unknown): value is string {
	return isCanonicalProcessString(value)
		&& !isAbsolute(value)
		&& !/^[A-Za-z]:\//.test(value)
		&& !value.includes("\\")
		&& value.split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

function validateNativeStartUntrackedSelection(value: Record<string, unknown>): NativeStartUntrackedSelection {
	const declared = "untrackedScope" in value || "expectedUntrackedInventory" in value || "intendedUntracked" in value;
	if (!declared) return {};
	const scope = value.untrackedScope;
	const expectedUntrackedInventory = value.expectedUntrackedInventory;
	// 仅做类型断言：行在使用前会在下方校验。
	const intendedUntracked = value.intendedUntracked as string[] | undefined;
	if (
		(scope !== NATIVE_START_UNTRACKED_SCOPE.EXCLUDE && scope !== NATIVE_START_UNTRACKED_SCOPE.SELECT) ||
		!isCanonicalProcessString(expectedUntrackedInventory) ||
		(intendedUntracked !== undefined && (!Array.isArray(intendedUntracked) || intendedUntracked.some((path) => !isNativeStartUntrackedPath(path) || intendedUntracked.indexOf(path) !== intendedUntracked.lastIndexOf(path))))
	) return { reason: "untracked-selection-invalid" };
	if (scope === NATIVE_START_UNTRACKED_SCOPE.EXCLUDE && (intendedUntracked?.length ?? 0) > 0) return { reason: "untracked-selection-invalid" };
	if (scope === NATIVE_START_UNTRACKED_SCOPE.SELECT && (intendedUntracked?.length ?? 0) === 0) return { reason: "untracked-selection-invalid" };
	return {
		untrackedScope: scope,
		expectedUntrackedInventory,
		intendedUntracked: intendedUntracked === undefined ? [] : [...intendedUntracked],
	};
}

function nativeStartRejection(reason: string, field?: string): Record<string, unknown> {
	return {
		operation: REVIEW_CONTROLLER_OPERATION.START,
		status: "blocked",
		outcome: reason === "legacy-policy-hash-unsupported"
			? "native-start-legacy-policy-hash-unsupported"
			: reason === "base-ref-invalid"
				? "native-start-base-ref-invalid"
				: reason === "base-ref-ambiguous"
					? "native-start-base-ref-ambiguous"
					: reason === "base-ref-unresolvable" || reason === "base-ref-moved"
						? "native-start-base-ref-unresolvable"
						: reason === "committed-only-required"
							? "native-start-committed-only-required"
							: reason === "committed-only-invalid"
								? "native-start-committed-only-invalid"
								: reason === "unknown-field" || reason === "focus-invalid" || reason === "untracked-selection-invalid"
									? "native-start-input-invalid"
									: "native-start-policy-path-invalid",
		reason,
		...(field === undefined ? {} : { field }),
		...nativeStartPreAuthorityRejection(),
	};
}

function nativeStatusInputRejection(reason: string, field?: string): Record<string, unknown> {
	return {
		operation: REVIEW_CONTROLLER_OPERATION.STATUS,
		status: "blocked",
		outcome: "native-status-input-invalid",
		reason,
		...(field === undefined ? {} : { field }),
		mutation_performed: false,
		mutation_outcome: "none",
	};
}

const PENDING_REVIEW_CONSENT_TTL_MS = 10 * 60 * 1000;
const REVIEW_SESSION_PERMISSION_STATUS_KEY = "gentle-review-session-permission";
const REVIEW_SESSION_PERMISSION_STATUS_TEXT = "reviews allowed for this session";

type PendingReviewConsentSessionKey = string | symbol;

interface PendingReviewConsent {
	id: string;
	repositoryCwd: string;
	authorityCwd: string;
	candidateView: CandidateView;
	candidateViews: CandidateViewRegistry | null;
	verifyCandidate: () => void;
	cleanupCandidate: () => void;
	untrackedSelection?: RetainedNativeUntrackedSelection;
	consent: ReviewConsentEnvelope;
	consentDigest: string;
	expiresAt: number;
	expiry?: ReturnType<typeof setTimeout>;
}

const PENDING_REVIEW_CONSENT_DISPOSITION = {
	EXPIRED: "expired",
	CONSUMED: "consumed",
} as const;

type PendingReviewConsentDisposition = (typeof PENDING_REVIEW_CONSENT_DISPOSITION)[keyof typeof PENDING_REVIEW_CONSENT_DISPOSITION];

const PENDING_REVIEW_CONSENT_STALE_DISPOSITION_LIMIT = 32;

/**
 * 仅存于进程内存的待定同意分区。已加载的扩展模块
 * 在多次注册间共享此注册表，而精确的 Pi 会话 ID 仍是
 * 唯一的延续边界。它刻意不提供任何持久化面。
 */
export class PendingReviewConsentRegistry {
	private readonly sessions = new Map<PendingReviewConsentSessionKey, Map<string, PendingReviewConsent>>();
	// gentle-pi#455：绑定 id 全局唯一（randomUUID），因此其活跃
	// 属主与过期处置仅按绑定 id 追踪。该
	// 索引让 answer-consent 能解析并恰好原子地取走一次由另一个
	// 活跃 Pi 会话的 START 创建的绑定；上方按会话的
	// map 仍是会话范围清单与关闭清理的权威。
	private readonly byBinding = new Map<string, PendingReviewConsentSessionKey>();
	private readonly staleDispositions = new Map<string, PendingReviewConsentDisposition>();

	get(sessionKey: PendingReviewConsentSessionKey): Map<string, PendingReviewConsent> | undefined {
		return this.sessions.get(sessionKey);
	}

	ensure(sessionKey: PendingReviewConsentSessionKey): Map<string, PendingReviewConsent> {
		let pending = this.sessions.get(sessionKey);
		if (pending === undefined) {
			pending = new Map<string, PendingReviewConsent>();
			this.sessions.set(sessionKey, pending);
		}
		return pending;
	}

	// 一步把新创建的待定绑定注册到其属主会话与
	// 跨会话绑定索引，使两者永不漂移。
	add(sessionKey: PendingReviewConsentSessionKey, pending: PendingReviewConsent): void {
		this.ensure(sessionKey).set(pending.id, pending);
		this.byBinding.set(pending.id, sessionKey);
	}

	// 无论哪个会话发问，都把活跃绑定解析到其属主会话，
	// 这样 answer-consent 能触及由另一个会话的
	// START 创建的绑定（gentle-pi#455）。
	resolve(bindingId: string): { sessionKey: PendingReviewConsentSessionKey; pending: PendingReviewConsent } | undefined {
		const sessionKey = this.byBinding.get(bindingId);
		const pending = sessionKey === undefined ? undefined : this.sessions.get(sessionKey)?.get(bindingId);
		return pending === undefined ? undefined : { sessionKey, pending };
	}

	private remove(sessionKey: PendingReviewConsentSessionKey, pending: PendingReviewConsent): boolean {
		const session = this.sessions.get(sessionKey);
		if (session?.get(pending.id) !== pending) return false;
		session.delete(pending.id);
		if (session.size === 0) this.sessions.delete(sessionKey);
		if (this.byBinding.get(pending.id) === sessionKey) this.byBinding.delete(pending.id);
		return true;
	}

	private rememberDisposition(pending: PendingReviewConsent, disposition: PendingReviewConsentDisposition): void {
		this.staleDispositions.delete(pending.id);
		this.staleDispositions.set(pending.id, disposition);
		while (this.staleDispositions.size > PENDING_REVIEW_CONSENT_STALE_DISPOSITION_LIMIT) this.staleDispositions.delete(this.staleDispositions.keys().next().value!);
	}

	consume(sessionKey: PendingReviewConsentSessionKey, pending: PendingReviewConsent): boolean {
		if (!this.remove(sessionKey, pending)) return false;
		this.rememberDisposition(pending, PENDING_REVIEW_CONSENT_DISPOSITION.CONSUMED);
		return true;
	}

	expire(sessionKey: PendingReviewConsentSessionKey, pending: PendingReviewConsent): boolean {
		if (!this.remove(sessionKey, pending)) return false;
		this.rememberDisposition(pending, PENDING_REVIEW_CONSENT_DISPOSITION.EXPIRED);
		return true;
	}

	discard(sessionKey: PendingReviewConsentSessionKey, pending: PendingReviewConsent): void {
		this.remove(sessionKey, pending);
	}

	staleDisposition(binding: string): PendingReviewConsentDisposition | undefined {
		return this.staleDispositions.get(binding);
	}

	take(sessionKey: PendingReviewConsentSessionKey): PendingReviewConsent[] {
		const session = this.sessions.get(sessionKey);
		this.sessions.delete(sessionKey);
		if (session !== undefined) for (const pending of session.values()) if (this.byBinding.get(pending.id) === sessionKey) this.byBinding.delete(pending.id);
		return session === undefined ? [] : [...session.values()];
	}
}

const processPendingReviewConsentRegistry = new PendingReviewConsentRegistry();
const processRetainedNativeStatusSelections = new Map<PendingReviewConsentSessionKey, Map<string, RetainedNativeStatusSelection>>();

// gentle-pi#556 / gentle-ai#4051：会话内具名代理（SDD 阶段
// 执行器或其他子代理）启动与结束的嵌套深度。启动与
// 结束成对，因此子代理自身循环的结束绝不会让主
// 循环的 `agent_end` 预检在会话余下时间里被抑制：
// 具名代理启动使深度加一，配对的结束使其减一，
// 新的主循环启动将其重置为 0。
const processAgentEndSubagentDepth = new Map<PendingReviewConsentSessionKey, number>();

function pendingReviewConsentSessionKey(context: ExtensionContext | undefined, fallbackKey: symbol): PendingReviewConsentSessionKey {
	try {
		const sessionManager = (context as unknown as { sessionManager?: { getSessionId?: () => unknown } } | undefined)?.sessionManager;
		const sessionId = sessionManager?.getSessionId?.();
		if (typeof sessionId === "string") return sessionId;
	} catch { /* 极简或测试上下文使用注册局部兜底键。 */ }
	return fallbackKey;
}

function consumePendingReviewConsent(pending: PendingReviewConsent, registry: PendingReviewConsentRegistry, sessionKey: PendingReviewConsentSessionKey): boolean {
	if (!registry.consume(sessionKey, pending)) return false;
	if (pending.expiry !== undefined) clearTimeout(pending.expiry);
	pending.expiry = undefined;
	return true;
}

function discardPendingReviewConsent(pending: PendingReviewConsent, registry: PendingReviewConsentRegistry, sessionKey: PendingReviewConsentSessionKey): void {
	if (pending.expiry !== undefined) clearTimeout(pending.expiry);
	pending.expiry = undefined;
	registry.discard(sessionKey, pending);
}

function expirePendingReviewConsent(pending: PendingReviewConsent, registry: PendingReviewConsentRegistry, sessionKey: PendingReviewConsentSessionKey): void {
	if (pending.expiry !== undefined) clearTimeout(pending.expiry);
	pending.expiry = undefined;
	if (registry.expire(sessionKey, pending)) pending.cleanupCandidate();
}

function cleanupPendingReviewConsent(pending: PendingReviewConsent, registry: PendingReviewConsentRegistry, sessionKey: PendingReviewConsentSessionKey): void {
	discardPendingReviewConsent(pending, registry, sessionKey);
	pending.cleanupCandidate();
}

function cleanupAllPendingReviewConsents(registry: PendingReviewConsentRegistry, sessionKey: PendingReviewConsentSessionKey): void {
	for (const pending of registry.take(sessionKey)) cleanupPendingReviewConsent(pending, registry, sessionKey);
}

// 一个未被使用的同意绑定与仅为该绑定保留的候选视图
// 作为一个生命周期单元一起过期。当同步时间给出
// `expiresAt <= now` 的那一刻 TTL 过期即被观察到，因此清理必须
// 相对该观察同步执行——排队的清理宏任务只是
// 安全网，不是权威。在此处（在任何后续
// START 复用保留视图之前）修剪，可以不让定时器顺序决定
// 正确性：新的候选重试绝不会复用绑定
// 已过期的视图，因此不会触发 `candidate-target-projection-drift`。
function pruneExpiredReviewConsents(registry: PendingReviewConsentRegistry, sessionKey: PendingReviewConsentSessionKey, now: () => number): void {
	const pendingReviewConsents = registry.get(sessionKey);
	if (pendingReviewConsents === undefined) return;
	for (const pending of [...pendingReviewConsents.values()]) {
		if (pending.expiresAt <= now()) expirePendingReviewConsent(pending, registry, sessionKey);
	}
}

function reviewConsentDigest(consent: ReviewConsentEnvelope): string {
	return createHash("sha256").update(JSON.stringify(consent)).digest("hex");
}

function reviewSessionManagerAndId(context: ExtensionContext): { manager: object; sessionId: string } | undefined {
	try {
		const manager = context.sessionManager as unknown as { getSessionId?: () => unknown };
		const sessionId = manager.getSessionId?.();
		if (typeof manager !== "object" || manager === null || typeof sessionId !== "string" || sessionId.length === 0) return undefined;
		return { manager, sessionId };
	} catch {
		return undefined;
	}
}

function isDirectOrdinaryReviewStart(parametersValue: unknown): boolean {
	try {
		const parameters = parseReviewControllerParameters(parametersValue);
		if (parameters.operation !== REVIEW_CONTROLLER_OPERATION.START) return false;
		const input = parseControllerJson(requiredControllerString(parameters, "input"), parameters.operation);
		return input.mode === REVIEW_MODE.ORDINARY;
	} catch {
		return false;
	}
}

function isHostReviewConsentEligibleOperation(parametersValue: unknown): boolean {
	if (isDirectOrdinaryReviewStart(parametersValue)) return true;
	try {
		return parseReviewControllerParameters(parametersValue).operation === REVIEW_CONTROLLER_OPERATION.SELECT_INTENDED_UNTRACKED;
	} catch {
		return false;
	}
}

function completedGrantedReviewConsent(outcome: Record<string, unknown>): boolean {
	if (
		outcome.operation !== REVIEW_CONTROLLER_OPERATION.ANSWER_CONSENT ||
		outcome.status !== undefined ||
		outcome.outcome !== undefined ||
		outcome.native_invocation_attempted === false ||
		outcome.mutation_performed === false ||
		outcome.lineage_created === false ||
		!isCanonicalProcessString(outcome.workspace_root)
	) return false;
	const result = outcome.result;
	if (!isRecord(result)) return false;
	const nonnegativeInteger = (value: unknown): boolean => Number.isInteger(value) && Number(value) >= 0;
	return isCanonicalProcessString(result.lineage_id) &&
		isCanonicalProcessString(result.state) &&
		isCanonicalProcessString(result.risk_tier) &&
		Array.isArray(result.selected_lenses) && result.selected_lenses.every(isCanonicalProcessString) &&
		nonnegativeInteger(result.changed_files) &&
		nonnegativeInteger(result.original_changed_lines) &&
		nonnegativeInteger(result.correction_budget) &&
		(result.action === "created" || result.action === "resumed" || result.action === "replayed" || result.action === "closed") &&
		typeof result.lenses_required === "boolean";
}

// gentle-pi#516：本会话不持有的绑定（已被应答、
// 已过期，或由另一个 Pi 会话或进程签发）过去会落到
// 普通的已协商 STATUS，其读起来与健康的前置
// "ready" 一模一样，把模型又送回 START 进行第二次同意提示。该
// 事实是本地的且在任何 provider 调用前已被证明，因此结果应指明
// 绑定与出口；当前 STATUS 只是作为上下文随行。
const STALE_CONSENT_BINDING_DIAGNOSTIC_CODE = {
	EXPIRED: "consent-binding-expired",
	ALREADY_CONSUMED: "consent-binding-already-consumed",
	UNKNOWN: "consent-binding-unknown",
} as const;

type StaleConsentBindingDiagnosticCode = (typeof STALE_CONSENT_BINDING_DIAGNOSTIC_CODE)[keyof typeof STALE_CONSENT_BINDING_DIAGNOSTIC_CODE];

interface StaleConsentBindingDiagnostics {
	code: StaleConsentBindingDiagnosticCode;
	message: string;
}

function staleConsentBindingDiagnostics(binding: string, disposition: PendingReviewConsentDisposition | undefined): StaleConsentBindingDiagnostics {
	const exit = "Run START again for this candidate to obtain a fresh consent envelope and answer that envelope's binding once; do not resend this binding.";
	if (disposition === PENDING_REVIEW_CONSENT_DISPOSITION.EXPIRED) {
		return { code: STALE_CONSENT_BINDING_DIAGNOSTIC_CODE.EXPIRED, message: `consent binding ${binding} expired after ${PENDING_REVIEW_CONSENT_TTL_MS / 60_000} minutes without an answer. ${exit}` };
	}
	if (disposition === PENDING_REVIEW_CONSENT_DISPOSITION.CONSUMED) {
		return { code: STALE_CONSENT_BINDING_DIAGNOSTIC_CODE.ALREADY_CONSUMED, message: `consent binding ${binding} was already consumed by an earlier answer. ${exit}` };
	}
	return { code: STALE_CONSENT_BINDING_DIAGNOSTIC_CODE.UNKNOWN, message: `consent binding ${binding} is not held by this Pi session. ${exit}` };
}

function staleConsentBindingOutcome(operation: ReviewControllerOperation, binding: string, diagnostics: ReturnType<typeof staleConsentBindingDiagnostics>, status: ReviewStatusV3): Record<string, unknown> {
	const mapped = mapNativeTargetStatus(operation, status);
	return {
		...mapped,
		status: "blocked",
		outcome: "consent-binding-stale",
		consent_binding: binding,
		diagnostics,
		native_invocation_attempted: false,
		...nativeStartPreAuthorityRejection(),
		provider_action: status.action,
		...(status.action === "start" ? { next_action: "restart-for-fresh-consent" } : mapped.next_action === undefined ? { next_action: status.action } : {}),
	};
}

// gentle-pi#455 修正：跨会话解析仅凭绑定的
// 不透明 id 查找，因此必须独立确认应答
// 调用针对的是其属主 START 为之签发该绑定的同一个仓库。
// 这是一个与过期绑定结果同族的带类型、非持有者
// 拒绝——它从不运行模式门或原生
// answerConsent，也从不消耗绑定，因此之后仍可从
// 正确的仓库应答。
function consentBindingRepositoryMismatchOutcome(operation: ReviewControllerOperation, binding: string, mintingRepositoryCwd: string, answeringRepositoryCwd: string): Record<string, unknown> {
	return {
		operation,
		status: "blocked",
		outcome: "consent-binding-repository-mismatch",
		consent_binding: binding,
		diagnostics: {
			code: "consent-binding-repository-mismatch",
			message: `consent binding ${binding} was minted for repository ${mintingRepositoryCwd}, not ${answeringRepositoryCwd}. Answer this binding from a session addressing ${mintingRepositoryCwd}; do not resend this binding from a different repository.`,
		},
		native_invocation_attempted: false,
		...nativeStartPreAuthorityRejection(),
		next_action: "answer-from-minting-repository",
	};
}

// gentle-pi#874：当前 STATUS 所拥有的 committed-range 选择器。在干净、
// 完全已提交的工作树上，无选择器的 STATUS 会以一个
// 指明 provider 所需确切 merge-base 的 review.start execute
// transition 作答，因此普通 START 可以采纳 provider 刚渲染的路由，
// 而不必让调用方手工把 `base-ref` 抄进输入。只读取
// provider 自己提供的参数——绝不猜测、不读持久化值、
// 不用过期 transition——且任何不是完整 commit id 配对
// committed-only 的内容都会被拒绝，因此其他所有 STATUS 保持
// 今日行为逐字节不变。
const OFFERED_COMMITTED_RANGE_BASE_REF = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i;

function offeredCommittedRangeBaseRef(target: ReviewStatusV3): string | undefined {
	const execute = target.nextTransition?.kind === "execute" ? target.nextTransition.execute : undefined;
	if (execute?.operation !== "review.start") return undefined;
	if (execute.arguments.some((argument) => argument.name === "workspace-overlay")) return undefined;
	const baseRef = execute.arguments.find((argument) => argument.name === "base-ref")?.value;
	if (baseRef === undefined || !OFFERED_COMMITTED_RANGE_BASE_REF.test(baseRef)) return undefined;
	if (execute.arguments.find((argument) => argument.name === "committed-only")?.value !== "true") return undefined;
	return baseRef;
}

function assertNativeStartCandidateBinding(candidateView: CandidateView, target: ReviewStatusV3): void {
	candidateView.verify();
	if (
		target.projection.projection !== "workspace" ||
		target.projection.baseTree !== candidateView.baseTree ||
		target.projection.initialReviewTree !== candidateView.candidateTree ||
		target.projection.currentCandidateTree !== candidateView.candidateTree ||
		JSON.stringify([...target.projection.paths].sort()) !== JSON.stringify([...candidateView.paths].sort()) ||
		(candidateView.intendedUntracked !== undefined && JSON.stringify([...target.projection.intendedUntracked].sort()) !== JSON.stringify([...candidateView.intendedUntracked].sort()))
	) {
		throw new CandidateViewError("native START workspace target does not match the immutable reviewer candidate view", "candidate-target-projection-drift");
	}
}

function completeNativeStart(
	operation: ReviewControllerOperation,
	result: NativeStartResult,
	workspaceRoot: string,
	candidateView: CandidateView | undefined,
	candidateViews: CandidateViewRegistry | null,
): Record<string, unknown> {
	if (candidateView === undefined) return { operation, result: mapNativeStartResult(result), workspace_root: workspaceRoot };
	if (candidateViews && result.lensesRequired) {
		const binding = { token: candidateView.token, lineageId: result.lineageId, selectedLenses: result.selectedLenses };
		if (result.action === "resumed" && !candidateViews.hasCurrentBinding(candidateView.contributorRoot)) candidateViews.restoreCurrentFromNativeStart(binding);
		else candidateViews.bindCurrent(binding);
	} else if (candidateViews && ((result.action === "created" && result.state === "reviewing") || result.action === "resumed")) candidateViews.retain(candidateView.token, result.lineageId);
	else candidateViews?.cleanup(candidateView.token);
	const actorBinding = result.lensesRequired
		? {
			workspace_root: workspaceRoot,
			candidate_root: candidateView.root,
			candidate_tree: candidateView.candidateTree,
			candidate_paths: candidateView.paths,
		}
		: undefined;
	return {
		operation,
		result: mapNativeStartResult(result),
		workspace_root: workspaceRoot,
		...(actorBinding === undefined ? {} : { actor_binding: actorBinding }),
	};
}

// gentle-ai#4003：原生销毁之后失败的每个 Pi 侧拆除步骤
// 都是延迟清理，而非确认失败。只转发
// 已清洗的 CandidateViewError 表面；其余一切
// 都归约为该步骤的固定 code，使任何路径或命令文本都到不了
// 调用方。候选视图提示刻意走带外：没有控制器
// 操作暴露仅清理的重试，且重放 acknowledge-approved
// 会撞上已销毁的 lineage。
const POST_BURN_CLEANUP = {
	candidateView: { code: "candidate-view-cleanup-failed", nextAction: "retry-candidate-view-cleanup-or-remove-the-view-out-of-band" },
	retainedSelection: { code: "retained-selection-cleanup-failed", nextAction: "retained-selection-clears-on-the-next-terminal-status" },
} as const;

function deferredPostBurnCleanup(step: (typeof POST_BURN_CLEANUP)[keyof typeof POST_BURN_CLEANUP], cleanup: () => void): Record<string, unknown> | undefined {
	try {
		cleanup();
		return undefined;
	} catch (error) {
		return {
			status: "deferred",
			diagnostics: error instanceof CandidateViewError
				? { code: error.reason, message: error.message }
				: { code: step.code },
			next_action: step.nextAction,
		};
	}
}

function nativeOperationFailure(operation: ReviewControllerOperation | "jero_review_capture", error: unknown): Record<string, unknown> {
	const value = error as { mutationOutcome?: unknown; nextAction?: unknown; diagnostics?: unknown; auditRecord?: unknown; launchAttempted?: unknown; candidateViewPreNative?: unknown; failureEnvelope?: { raw?: unknown; mutationOutcome?: unknown; replayability?: unknown; nextAction?: unknown; code?: unknown; continuation?: { command?: unknown } } };
	if (isRecord(value.failureEnvelope) && isRecord(value.failureEnvelope.raw)) {
		const mutationOutcome = value.failureEnvelope.mutationOutcome;
		return {
			operation,
			status: "blocked",
			native_failure: value.failureEnvelope.raw,
			...(mutationOutcome === "committed"
				? { mutation_performed: true, mutation_outcome: "committed" }
				: mutationOutcome === "unknown"
					? { mutation_outcome: "unknown" }
					: { mutation_performed: false, mutation_outcome: "none" }),
			...(typeof value.failureEnvelope.replayability === "string" ? { replayability: value.failureEnvelope.replayability } : {}),
			...(typeof value.failureEnvelope.nextAction === "string" ? { next_action: value.failureEnvelope.nextAction } : {}),
			// gentle-pi#627：针对过期受管理资产集的 START 预检
			// 失败封套带有顶层 continuation；把它的
			// `gentle-ai sync` 命令渲染为唯一可行动的下一步。
			...(value.failureEnvelope.code === "managed_assets_outdated" && typeof value.failureEnvelope.continuation?.command === "string"
				? { hint: `run ${value.failureEnvelope.continuation.command}` }
				: {}),
		};
	}
	// 所有同意绑定守卫都在 provider 启动之前运行，因此这是
	// 一个本地不匹配，无需对账。把它报告成原生
	// 操作失败会掩盖唯一让它可修复的事实。
	const consentBinding = asNativeReviewConsentBindingError(error);
	if (consentBinding !== undefined) {
		return {
			operation,
			status: "blocked",
			outcome: "consent-binding-invalid",
			native_invocation_attempted: false,
			lineage_created: false,
			mutation_performed: false,
			mutation_outcome: "none" as const,
			diagnostics: { code: consentBinding.reason, message: consentBinding.message },
			next_action: "resolve-consent-binding",
		};
	}
	if (error instanceof NativeCaptureRouteRegistrationError) {
		return {
			operation,
			status: "blocked",
			outcome: "capture-route-registration-rejected",
			mutation_performed: false,
			mutation_outcome: "none",
		};
	}
	const mutationOutcome = value.mutationOutcome === "unknown" ? "unknown" : "none";
	const nativeCliError = asNativeReviewCliError(error);
	const nativeDiagnostics = nativeCliError?.diagnostics;
	// target-status 探测只以 `review/status` 操作标注诊断（本仓的 Node
	// 权威没有独立的 version 探测操作），在每条控制器路由上保留这类
	// 已清洗的诊断，而不是把一个可行动的失败重新标注为不透明的控制器失败。
	const preservesNativeTargetStatusDiagnostic = nativeDiagnostics?.operation === NATIVE_REVIEW_OPERATION.STATUS;
	const preservesAnswerConsentStartDiagnostic = operation === REVIEW_CONTROLLER_OPERATION.ANSWER_CONSENT && nativeDiagnostics?.operation === NATIVE_REVIEW_OPERATION.START;
	const diagnostics = operation === REVIEW_CONTROLLER_OPERATION.START && error instanceof CandidateViewError && value.candidateViewPreNative === true
		? error.diagnostics ?? { code: error.reason, message: "candidate view rejected before native START" }
		: error instanceof CandidateViewError
			? { code: error.reason, message: error.message }
			: nativeDiagnostics?.operation === `review/${operation}` || preservesNativeTargetStatusDiagnostic || preservesAnswerConsentStartDiagnostic
		? nativeDiagnostics
		: undefined;
	return {
		operation,
		status: "blocked",
		outcome: "native-operation-failed",
		...(operation === REVIEW_CONTROLLER_OPERATION.START && mutationOutcome === "none"
			? nativeStartPreAuthorityRejection()
			: mutationOutcome === "none"
				? { lineage_created: false, mutation_performed: false, mutation_outcome: "none" as const }
				: { mutation_outcome: mutationOutcome }),
		...(diagnostics === undefined ? {} : { diagnostics }),
		...(isRecord(value.auditRecord) ? { native_audit_record: value.auditRecord } : {}),
		...(mutationOutcome === "unknown" || value.nextAction === "review.status"
			? { replayability: "status_required", next_action: "review.status", required_status_action: requiredStatusActionText() }
			: { next_action: "resolve-native-operation-failure" }),
	};
}

function nativeMutationRequiresStatus(error: unknown): boolean {
	const value = error as {
		mutationOutcome?: unknown;
		nextAction?: unknown;
		failureEnvelope?: { mutationOutcome?: unknown; replayability?: unknown; nextAction?: unknown };
	};
	return value.mutationOutcome === "unknown" ||
		value.nextAction === "review.status" ||
		value.failureEnvelope?.mutationOutcome === "unknown" ||
		value.failureEnvelope?.replayability === "status_required" ||
		value.failureEnvelope?.nextAction === "review.status";
}

async function reconcileNativeMutationFailure(
	operation: ReviewControllerOperation,
	error: unknown,
	nativeReviewCli: NativeReviewCli,
	target: Parameters<NonNullable<NativeReviewCli["targetStatus"]>>[0],
	retainedSelections: Map<string, RetainedNativeStatusSelection>,
	preOperationRevision?: string,
	canonicalRetentionRoot = target.cwd,
): Promise<Record<string, unknown>> {
	const failure = nativeOperationFailure(operation, error);
	if (!nativeMutationRequiresStatus(error)) return failure;
	if (nativeReviewCli.targetStatus === undefined) {
		return {
			...failure,
			outcome: "native-mutation-status-required",
			replayability: "status_required",
			next_action: "review.status",
			required_status_action: requiredStatusActionText(target.lineageId),
		};
	}
	try {
		const status = await nativeReviewCli.targetStatus(target);
		syncRetainedNativeStatusSelections(retainedSelections, canonicalRetentionRoot, status, target.baseRef);
		const projectedStatus = mapNativeTargetStatus(operation, status, target.lineageId);
		const { next_action: staleNextAction, required_status_action: staleStatusDirective, ...reconciledBase } = failure;
		void staleNextAction;
		void staleStatusDirective;
		// 字段缺陷（fambig，2026-08-16）：无封套的变更失败
		// 被标记为 mutationOutcome "unknown"，但对账后的权威
		// revision 与操作前 revision 相同，就证明了失败的
		// 调用从未变更。把该证明报告为 mutation_outcome none，
		// 且不对其主张任何重放禁止。所有真正模糊的结果
		// ——revision 变动、未持有操作前 revision，或 STATUS
		// 不可用——仍与从前一样保守失败。
		if (preOperationRevision !== undefined && status.authority?.revision === preOperationRevision) {
			const { replayability: staleReplayability, ...provenBase } = reconciledBase;
			void staleReplayability;
			return {
				...provenBase,
				...projectedStatus,
				status: "blocked",
				outcome: "native-mutation-status-reconciled",
				reconciliation: status.raw,
				authority_applicability: status.applicability,
				provider_action: status.action,
				mutation_performed: false,
				mutation_outcome: "none",
				mutation_outcome_reason: `authority revision unchanged across reconciliation (${preOperationRevision}); the failed operation provably did not mutate`,
			};
		}
		return {
			...reconciledBase,
			...projectedStatus,
			status: "blocked",
			outcome: "native-mutation-status-reconciled",
			reconciliation: status.raw,
			authority_applicability: status.applicability,
			provider_action: status.action,
			replayability: status.replayability,
			...(status.action === "start" && projectedStatus.next_action === undefined ? { next_action: "start" } : {}),
			required_status_action: projectedStatus.required_status_action ?? requiredStatusActionText(target.lineageId),
		};
	} catch (statusError) {
		return {
			...failure,
			outcome: "native-mutation-status-reconciliation-failed",
			reconciliation_failure: nativeOperationFailure(REVIEW_CONTROLLER_OPERATION.STATUS, statusError),
			replayability: "status_required",
			next_action: "review.status",
			required_status_action: requiredStatusActionText(target.lineageId),
		};
	}
}

function reviewWorkspaceGitIdentity(cwd: string): { toplevel: string; commonDir: string } {
	const git = (...arguments_: string[]): string =>
		execFileSync("git", arguments_, { cwd, encoding: "utf8" }).trim();
	const toplevel = realpathSync(git("rev-parse", "--show-toplevel"));
	const commonDir = realpathSync(resolve(cwd, git("rev-parse", "--git-common-dir")));
	return { toplevel, commonDir };
}

/**
 * 解析显式的用户授权工作区目标。显式路径可以
 * 嵌套，也可以属于与 Pi 会话 cwd 无关的仓库；
 * Git 会将其解析为规范的工作树顶层。只有当没有
 * 目标被选择或记住时，会话 cwd 才仍是
 * 旧式默认。
 */
function resolveReviewControllerWorkspaceRoot(
	requested: string | undefined,
	sessionCwd: string,
	candidateViews: CandidateViewRegistry | null,
	lineageId: string | undefined,
): string {
	const remembered = requested === undefined && lineageId !== undefined
		? candidateViews?.resolveWorkspaceRoot(lineageId)
		: undefined;
	const selected = requested ?? remembered ?? sessionCwd;
	if (selected.trim().length === 0 || !isAbsolute(selected)) {
		throw new Error(`Review controller workspaceRoot must be an absolute path to an existing Git worktree root; received ${JSON.stringify(selected)}`);
	}
	let resolved: string;
	try {
		resolved = realpathSync(selected);
		if (!lstatSync(resolved).isDirectory()) throw new Error("not a directory");
	} catch {
		throw new Error(`Review controller workspaceRoot ${selected} is not an existing directory; create or adopt the worktree before binding review operations to it`);
	}
	let target: { toplevel: string; commonDir: string };
	try {
		target = reviewWorkspaceGitIdentity(resolved);
	} catch {
		if (requested === undefined && remembered === undefined) return sessionCwd;
		throw new Error(`Review controller workspaceRoot ${resolved} is not inside a Git worktree; review operations bind only to real worktrees of the session repository`);
	}
	if (lineageId !== undefined) candidateViews?.assertWorkspaceRoot(lineageId, target.toplevel);
	return target.toplevel;
}

function reviewLifecycleStorageKey(workspaceRoot: string, lineageId: string): string {
	return `${workspaceRoot}\u0000${lineageId}`;
}

function reviewCaptureSelectionStorageKey(collectBinding: string): string {
	return `capture\u0000${collectBinding}`;
}

function cloneRetainedNativeUntrackedSelection(selection: NativeStartUntrackedSelection): RetainedNativeUntrackedSelection | undefined {
	if (selection.untrackedScope === undefined || selection.expectedUntrackedInventory === undefined) return undefined;
	return Object.freeze({
		untrackedScope: selection.untrackedScope,
		expectedUntrackedInventory: selection.expectedUntrackedInventory,
		intendedUntracked: Object.freeze([...(selection.intendedUntracked ?? [])]),
	});
}

function retainNativeStatusSelection(selections: Map<string, RetainedNativeStatusSelection>, key: string, selection: RetainedNativeStatusSelection): void {
	if (!selections.has(key)) {
		while (selections.size >= MAX_RETAINED_NATIVE_STATUS_SELECTIONS) {
			const oldestKey = selections.keys().next().value;
			if (oldestKey === undefined) return;
			selections.delete(oldestKey);
		}
	}
	selections.set(key, selection);
}

function retainNativeUntrackedSelection(selections: Map<string, RetainedNativeStatusSelection>, workspaceRoot: string, lineageId: string, selection: RetainedNativeUntrackedSelection | undefined): void {
	if (selection !== undefined) retainNativeStatusSelection(selections, reviewLifecycleStorageKey(workspaceRoot, lineageId), selection);
}

function readRetainedNativeUntrackedSelection(selections: Map<string, RetainedNativeStatusSelection>, workspaceRoot: string, lineageId: string): NativeStartUntrackedSelection {
	const selection = selections.get(reviewLifecycleStorageKey(workspaceRoot, lineageId));
	// 判别键是运行时契约：capture-route 条目以 baseRef 键为标记，保留条目的
	// 实际形状比联合类型宽，不得改用其他键判别。
	if (selection === undefined || "baseRef" in selection) return {};
	const untracked = selection as RetainedNativeUntrackedSelection;
	return {
		untrackedScope: untracked.untrackedScope,
		expectedUntrackedInventory: untracked.expectedUntrackedInventory,
		intendedUntracked: [...untracked.intendedUntracked],
	};
}

// gentle-pi#706：inspect 的 untrackedScope 往返把已解析的
// 选择保留在 pre-lineage 空 lineage 键下，使该工作树中下一次
// 普通 START 直接采纳它，而无需重新推导选择。
function nativePreLineageCandidateIdentity(
	status: ReviewStatusV3,
): { targetIdentity: string; candidateTree: string } | undefined {
	const candidateTree = status.projection.currentCandidateTree;
	return isCanonicalProcessString(status.targetIdentity) && isCanonicalProcessString(candidateTree)
		? { targetIdentity: status.targetIdentity, candidateTree }
		: undefined;
}

function readRetainedPreLineageNativeUntrackedSelection(
	selections: Map<string, RetainedNativeStatusSelection>,
	workspaceRoot: string,
): RetainedPreLineageNativeUntrackedSelection | undefined {
	const selection = selections.get(reviewLifecycleStorageKey(workspaceRoot, ""));
	return selection !== undefined &&
		!("baseRef" in selection) &&
		typeof (selection as Partial<RetainedPreLineageNativeUntrackedSelection>).targetIdentity === "string" &&
		typeof (selection as Partial<RetainedPreLineageNativeUntrackedSelection>).candidateTree === "string"
		? selection as RetainedPreLineageNativeUntrackedSelection
		: undefined;
}

function sameNativePreLineageCandidate(
	selection: RetainedPreLineageNativeUntrackedSelection,
	status: ReviewStatusV3,
): boolean {
	const identity = nativePreLineageCandidateIdentity(status);
	return identity !== undefined &&
		identity.targetIdentity === selection.targetIdentity &&
		identity.candidateTree === selection.candidateTree;
}

function isRetainedNativeCaptureRoute(selection: RetainedNativeStatusSelection | undefined): selection is RetainedNativeCaptureRoute {
	return selection !== undefined && "workspaceRoot" in selection;
}

function retainNativeCaptureRoutes(selections: Map<string, RetainedNativeStatusSelection>, workspaceRoot: string, status: ReviewStatusV3, baseRef: string | undefined): void {
	const lineageId = status.authority?.lineageId;
	if (status.applicability !== "current_target" || !isCanonicalProcessString(lineageId) || isTerminalReviewAuthorityState(status.authority?.state)) return;
	const routes = (status.nextTransition?.kind === "collect" ? status.nextTransition.collect?.inputs ?? [] : []).map((input) => ({ key: reviewCaptureSelectionStorageKey(canonicalReviewCaptureBinding(input)), route: Object.freeze({ workspaceRoot, lineageId, ...(baseRef === undefined ? {} : { baseRef, committedOnly: true as const }) }) }));
	for (const { key, route } of routes) {
		const existing = selections.get(key);
		if (isRetainedNativeCaptureRoute(existing) && (existing.workspaceRoot !== route.workspaceRoot || existing.lineageId !== route.lineageId || existing.baseRef !== route.baseRef || existing.committedOnly !== route.committedOnly)) throw new NativeCaptureRouteRegistrationError("Provider collectBinding collides with a different registered route");
	}
	const current = new Set(routes.map(({ key }) => key));
	for (const [key, selection] of selections) if (isRetainedNativeCaptureRoute(selection) && selection.workspaceRoot === workspaceRoot && selection.lineageId === lineageId && !current.has(key)) selections.delete(key);
	for (const { key, route } of routes) if (!selections.has(key)) retainNativeStatusSelection(selections, key, route);
}

function readRetainedNativeCaptureRoute(selections: Map<string, RetainedNativeStatusSelection>, collectBinding: string): RetainedNativeCaptureRoute | undefined {
	const selection = selections.get(reviewCaptureSelectionStorageKey(collectBinding));
	return isRetainedNativeCaptureRoute(selection) ? selection : undefined;
}

function isTerminalReviewAuthorityState(state: string | undefined): boolean { return state === "invalidated" || state === "approved" || state === "escalated"; }

function clearRetainedNativeUntrackedSelection(selections: Map<string, RetainedNativeStatusSelection>, workspaceRoot: string, lineageId: string): void {
	selections.delete(reviewLifecycleStorageKey(workspaceRoot, lineageId));
}

function clearRetainedNativeStatusSelectionsOnTerminal(selections: Map<string, RetainedNativeStatusSelection>, workspaceRoot: string, lineageId: string | undefined, state: string | undefined): void {
	if (lineageId === undefined || !isTerminalReviewAuthorityState(state)) return;
	if (state !== "approved") clearRetainedNativeUntrackedSelection(selections, workspaceRoot, lineageId);
	for (const [key, selection] of selections) if (isRetainedNativeCaptureRoute(selection) && selection.workspaceRoot === workspaceRoot && selection.lineageId === lineageId) selections.delete(key);
}

function syncRetainedNativeStatusSelections(selections: Map<string, RetainedNativeStatusSelection>, workspaceRoot: string, status: ReviewStatusV3, baseRef: string | undefined): void {
	clearRetainedNativeStatusSelectionsOnTerminal(selections, workspaceRoot, status.authority?.lineageId, status.authority?.state);
	retainNativeCaptureRoutes(selections, workspaceRoot, status, baseRef);
}

function requiresExplicitTargetLifecycleRoot(requested: string | undefined, sessionCwd: string, workspaceRoot: string): boolean {
	return requested !== undefined || workspaceRoot !== sessionCwd;
}

// gentle-pi#311 P4 —— 轻量 Pi 宿主中继。provider 通过在 pi 绑定的
// `review.capture-result` collect 输入上签发 --materialize token 来决定
// 宿主满足哪些捕获槽位；从不做任何推断。
// P4b：生产 runner 将中继与进程内权威
// 接缝组合（lib/authority/capture-relay.ts）——renderBinding 负责提示词
// 字节，进程内 admission 负责暂存结果。runner 保持
// 可注入以便测试。
const runJeroAuthorityRelaySlot: ReviewHostRelayRunner = async (request) =>
	submitReviewHostRelayPreparedResult(
		await prepareReviewHostRelaySlot(request, undefined, renderJeroCaptureSlotForRelayV1),
		(requestForAdmit, operationToken, submitTokens, resultFile) => admitJeroCaptureResultForRelayV1(requestForAdmit, operationToken, submitTokens, resultFile),
	);
const runJeroAuthorityReviewerGroup: typeof runReviewHostRelayReviewerGroup = async (requests) =>
	runReviewHostRelayReviewerGroup(requests, (request) => prepareReviewHostRelaySlot(request, undefined, renderJeroCaptureSlotForRelayV1));
const submitJeroAuthorityPreparedResult: typeof submitReviewHostRelayPreparedResult = async (prepared) =>
	submitReviewHostRelayPreparedResult(prepared, (request, operationToken, submitTokens, resultFile) => admitJeroCaptureResultForRelayV1(request, operationToken, submitTokens, resultFile));
let activeReviewHostRelayRunner: ReviewHostRelayRunner = runJeroAuthorityRelaySlot;
let activeReviewHostRelayReviewerGroupRunner = runJeroAuthorityReviewerGroup;
let activeReviewHostRelaySubmissionRunner = submitJeroAuthorityPreparedResult;
function setReviewHostRelayRunnerForTesting(runner?: ReviewHostRelayRunner): void {
	activeReviewHostRelayRunner = runner ?? runJeroAuthorityRelaySlot;
}
function setReviewHostRelayGroupRunnersForTesting(reviewerGroup?: typeof runReviewHostRelayReviewerGroup, submission?: typeof submitReviewHostRelayPreparedResult): void {
	activeReviewHostRelayReviewerGroupRunner = reviewerGroup ?? runJeroAuthorityReviewerGroup;
	activeReviewHostRelaySubmissionRunner = submission ?? submitJeroAuthorityPreparedResult;
}

const REVIEW_HOST_RELAY_RETRY_ACTION =
	"Call fresh STATUS and submit only an exact reoffered one-slot binding; never replay this capture from transcript inference.";

// gentle-pi#522 / #524：gentle-ai 在准入处拒绝了提交，并
// 声明镜头槽位未被消耗。被拒绝的字节才是
// 问题所在，所以 continuation 是在重新提供的槽位上跑一次全新的评审者，
// 既不是重放，也不是未知结果对账。
const REVIEW_HOST_RELAY_REFUSED_ACTION =
	"gentle-ai refused this submission at admission and did not consume the lens slot; the reason is in failure.stderr. "
	+ "Call fresh STATUS and run only the exact slot it reoffers so the reviewer produces a new result that satisfies that refusal; never resubmit the refused bytes.";

// gentle-pi#638：声明已记录，因此全新 STATUS 会以每个声明槽位一个 withdraw 绑定停止评审，而不是重新提供评审者。withdraw 命令是回到同一槽位的唯一途径；其他一切都需要更小的候选和一次新评审。
const REVIEW_HOST_RELAY_UNACHIEVABLE_ACTION =
	"A deterministic relay failure was declared unachievable for this bound slot, and fresh STATUS now stops this review instead of reoffering the reviewer. "
	+ "If the failure was transient, run the withdraw command in unachievable_lens_slots with the same binding so the review re-offers this exact reviewer; otherwise reduce the candidate scope and start a new review.";

// gentle-pi#638：中继失败是确定性的，但 gentle-ai 拒绝了该声明，因此槽位状态未变，评审仍需要一个 provider 绑定的 continuation。
const REVIEW_HOST_RELAY_DECLARATION_FAILED_ACTION =
	"The relay failure was deterministic for this slot, but gentle-ai refused the unachievable declaration, so no slot state changed. "
	+ "Call fresh STATUS and follow only its declared action; never replay this capture from transcript inference.";

function reviewHostRelayTimeoutNextAction(error: ReviewHostRelayError): string {
	const measured = error.elapsedMs === null || error.timeoutMs === null
		? ""
		: ` The reviewer was killed after ${error.elapsedMs}ms against a ${error.timeoutMs}ms bound.`;
	return `Do not relaunch this slot unchanged: the same bound kills the same reviewer run again and re-spends the model tokens for nothing.${measured} `
		+ `Change one of two things first: export ${REVIEW_HOST_RELAY_PI_TIMEOUT_ENV}=<milliseconds> above the reviewer's real wall time (hard ceiling ${REVIEW_HOST_RELAY_PI_TIMEOUT_MAX_MS}), or reduce the candidate scope so the materialized prompt is smaller. `
		+ "Then call fresh STATUS and submit only its exact reoffered slot.";
}

function reviewHostRelayFailureReport(error: ReviewHostRelayError): Record<string, unknown> {
	return {
		kind: error.kind,
		stage: error.stage,
		exit_code: error.exitCode,
		timed_out: error.timedOut,
		...(error.elapsedMs === null ? {} : { elapsed_ms: error.elapsedMs }),
		...(error.timeoutMs === null ? {} : { timeout_ms: error.timeoutMs }),
		// 捕获的原生 stderr 是 provider 确切
		// 拒绝原因的唯一所在（gentle-pi#524）；丢弃它会把每个准入
		// 拒绝都藏进 "submission-refused" 背后。
		...(error.stderr.length === 0 ? {} : { stderr: error.stderr }),
	};
}

function mapLastEventClosure(
	closure: ReviewLastEventClosureV1,
	binding: ReviewLastEventClosureBinding,
): Record<string, unknown> {
	if (closure.lineageId !== binding.lineageId) throw new CandidateViewError("last-event closure returned a different lineage", "last-event-closure-binding-drift");
	if (binding.targetIdentity !== undefined && closure.targetIdentity !== undefined && closure.targetIdentity !== binding.targetIdentity) {
		throw new CandidateViewError("last-event closure returned a different target", "last-event-closure-binding-drift");
	}
	return {
		tool: "jero_review_capture",
		status: "closed",
		outcome: "native-last-event-closure",
		closure: {
			schema: closure.schema,
			operation: closure.operation,
			lineage_id: closure.lineageId,
			state: closure.state,
			store_revision: closure.storeRevision,
			...(closure.action === undefined ? {} : { action: closure.action }),
			...(closure.targetIdentity === undefined ? {} : { target_identity: closure.targetIdentity }),
			...(closure.requestHash === undefined ? {} : { request_hash: closure.requestHash }),
			...(closure.correctionLines === undefined ? {} : { correction_lines: closure.correctionLines }),
			...(closure.advisoryFindings === undefined ? {} : { advisory_findings: closure.advisoryFindings }),
			...(closure.statusContinuation === undefined ? {} : { status_continuation: closure.statusContinuation.raw }),
			// 宿主必须看到确认才能执行它：approval 现在
			// 等待那次确切调用而不是自行销毁，因此
			// 在这里丢弃它会让 lineage 永远滞留在 approved。
			...(closure.acknowledgement === undefined ? {} : { acknowledgement: closure.acknowledgement.raw }),
			// 存在但无法解码的 continuation 不等于没有：宿主已
			// approved 且不能在此结束它，沉默会被解读为
			// 无事可做。
			...(closure.acknowledgementUndecodable === undefined ? {} : { acknowledgement_undecodable: true }),
		},
		lineage_id: closure.lineageId,
		state: closure.state,
		store_revision: closure.storeRevision,
	};
}

function mapAndClearLastEventClosure(
	closure: ReviewLastEventClosureV1,
	binding: ReviewLastEventClosureBinding,
	selections: Map<string, RetainedNativeStatusSelection>,
	workspaceRoot: string,
): Record<string, unknown> {
	const mapped = mapLastEventClosure(closure, binding);
	clearRetainedNativeStatusSelectionsOnTerminal(selections, workspaceRoot, closure.lineageId, closure.state);
	return mapped;
}

function decodeRelayLastEventClosure(submission: string): ReviewLastEventClosureV1 | undefined {
	let body: unknown;
	try { body = JSON.parse(submission); } catch { throw new CandidateViewError("host relay submission returned malformed JSON", "last-event-closure-decode-failed"); }
	if (typeof body !== "object" || body === null || Array.isArray(body) || (body as { schema?: unknown }).schema !== "gentle-ai.review-last-event-closure/v1") return undefined;
	return decodeReviewLastEventClosureV1(body);
}

async function reconcileUnknownReviewCaptureFailure(
	error: unknown | undefined,
	nativeReviewCli: NativeReviewCli,
	cwd: string,
	binding: ReviewLastEventClosureBinding,
	selections: Map<string, RetainedNativeStatusSelection>,
	route: RetainedNativeCaptureRoute | undefined,
	expectedReviewCaptureSuffix?: readonly string[],
	agent?: "pi",
): Promise<Record<string, unknown>> {
	const failure = error === undefined ? undefined : nativeOperationFailure("jero_review_capture", error);
	if (error !== undefined && !nativeMutationRequiresStatus(error)) return failure;
	try {
		const selector = agent === undefined ? route : { ...route, agent };
		const status = await reconcileUnknownReviewLastEventCapture(nativeReviewCli, cwd, binding, selector);
		syncRetainedNativeStatusSelections(selections, cwd, status, route?.baseRef);
		if (expectedReviewCaptureSuffix !== undefined && !hasExactReviewCaptureSuffix(status, expectedReviewCaptureSuffix)) return captureGroupAuthorityDrift(status);
		return {
			tool: "jero_review_capture",
			status: "reconciled",
			outcome: "native-capture-outcome-unknown",
			...(failure === undefined ? {} : { native_failure: failure }),
			lineage_id: binding.lineageId,
			target_identity: status.targetIdentity,
			provider_action: status.action,
			...(status.nextTransition === undefined ? {} : { next_transition: status.nextTransition }),
			result: status.raw,
		};
	} catch (statusError) {
		const reconciliationFailure = nativeOperationFailure("jero_review_capture", statusError);
		return { ...(failure ?? reconciliationFailure), outcome: "native-capture-status-reconciliation-failed", reconciliation_failure: reconciliationFailure };
	}
}

async function executeReviewHostRelayCapture(
	slot: ReviewHostRelaySlot,
	nativeReviewCli: NativeReviewCli,
	cwd: string,
	binding: ReviewLastEventClosureBinding,
	selections: Map<string, RetainedNativeStatusSelection>,
	route: RetainedNativeCaptureRoute | undefined,
	signal?: AbortSignal,
): Promise<Record<string, unknown>> {
	try {
		if (slot.submission === undefined) {
			throw new ReviewHostRelayError(
				REVIEW_HOST_RELAY_FAILURE.SUBMISSION_CONTRACT_MISMATCH,
				"binding",
				REVIEW_HOST_RELAY_SUBMISSION_MISSING_MESSAGE,
			);
		}
		const result = await activeReviewHostRelayRunner({
			captureArgumentTokens: slot.captureArgumentTokens,
			targetCwd: cwd,
			submission: slot.submission,
			...(signal === undefined ? {} : { signal }),
		});
		const closure = decodeRelayLastEventClosure(result.submission);
		if (closure !== undefined) return mapAndClearLastEventClosure(closure, binding, selections, cwd);
		return {
			tool: "jero_review_capture",
			status: "captured",
			outcome: "native-reviewer-result-captured",
			lineage_id: binding.lineageId,
			host_relay: {
				transport: "pi_host_relay",
				...(slot.lens === undefined ? {} : { lens: slot.lens }),
				...(slot.order === undefined ? {} : { order: slot.order }),
				...(slot.subjectHash === undefined ? {} : { subject_hash: slot.subjectHash }),
				prompt_bytes: result.promptByteLength,
				result_bytes: result.resultByteLength,
				submission: result.submission,
			},
		};
	} catch (error) {
		if (!(error instanceof ReviewHostRelayError)) return await reconcileUnknownReviewCaptureFailure(error, nativeReviewCli, cwd, binding, selections, route, undefined, REVIEW_HOST_AGENT);
		if (error.mutationOutcome === "unknown") {
			return {
				...(await reconcileUnknownReviewCaptureFailure(error, nativeReviewCli, cwd, binding, selections, route, undefined, REVIEW_HOST_AGENT)),
				failure: reviewHostRelayFailureReport(error),
				reason: error.message,
			};
		}
		if (error.kind === REVIEW_HOST_RELAY_FAILURE.RELAY_UNAVAILABLE) {
			return {
				tool: "jero_review_capture",
				status: "blocked",
				outcome: "pi-host-relay-unavailable",
				reason: REVIEW_HOST_RELAY_UNAVAILABLE_MESSAGE,
				mutation_performed: false,
				mutation_outcome: "none",
			};
		}
		if (error.kind === REVIEW_HOST_RELAY_FAILURE.MATERIALIZE_FAILED && /not eligible for immutable receipt review/.test(error.message)) {
			// jero-pi M3（design 8）：握手拒绝类已删除；
			// 该形态的 provider 拒绝以普通 materialize
			// 失败浮出，携带其原样的拒绝原因。
			return {
				tool: "jero_review_capture",
				status: "blocked",
				outcome: "pi-host-relay-materialize-refused",
				reason: error.message,
				refusal: error.stderr,
				mutation_performed: false,
				mutation_outcome: "none",
			};
		}
		// gentle-pi#638：两类确定性中继失败终结的是槽位而非传输。通过原生动词声明槽位不可达成，会记录 provider 所拥有的事实——该评审者在当前条件下无法完成——随后恰好一次绑定 STATUS 重查渲染带 withdraw 绑定的带类型 stop，而不是重新提供同一槽位。声明绑定从该槽位自己的 provider 签发 `--name=value` token 重新派生，绝不来自 transcript 状态。
		const unachievableReason = reviewHostRelayUnachievableReason(error);
		const declarationBinding = unachievableSlotDeclarationBinding(slot);
		if (unachievableReason !== undefined && declarationBinding !== undefined && nativeReviewCli.captureUnachievableLens !== undefined) {
			let declared: NativeReviewUnachievableLensCaptureArtifact | undefined;
			try {
				declared = await nativeReviewCli.captureUnachievableLens({ cwd, ...declarationBinding, reason: unachievableReason, ...(reviewHostRelayUnachievableDetail(error) === undefined ? {} : { detail: reviewHostRelayUnachievableDetail(error)! }), ...(signal === undefined ? {} : { signal }) });
			} catch (declarationError) {
				// 仅对未知动词的能力拒绝才放行：没有 `capture-unachievable` 的旧二进制保持下方今日的传输失败行为。其余所有声明失败都浮出，绝不藏在其所跟随的中继失败背后。
				if (!isNativeReviewUnachievableVerbRefused(declarationError)) {
					// gentle-pi#822（diff 之外）：声明失败自己的封套携带变更真相——进程可能在失败前已记录声明——因此变更字段从它派生而非硬编码 none，未知结果由一次绑定 STATUS 重查证明或证伪，且从不改变失败结果。
					const declarationFailureReport = nativeOperationFailure("jero_review_capture", declarationError);
					let declarationMutationPerformed = declarationFailureReport.mutation_performed === true;
					let declarationMutationOutcome: "none" | "unknown" | "committed" = declarationFailureReport.mutation_outcome === "committed" ? "committed" : declarationFailureReport.mutation_outcome === "unknown" ? "unknown" : "none";
					if (declarationMutationOutcome === "unknown") {
						try {
							const status = await reconcileUnknownReviewLastEventCapture(nativeReviewCli, cwd, binding, route === undefined ? { agent: REVIEW_HOST_AGENT } : { ...route, agent: REVIEW_HOST_AGENT });
							syncRetainedNativeStatusSelections(selections, cwd, status, route?.baseRef);
							const stop = status.nextTransition?.kind === "stop" && status.nextTransition.reasonCode === "unachievable_lens_slot" ? status.nextTransition : undefined;
							const declaredSlot = stop?.unachievableLensSlots?.find((candidate) => candidate.lens === slot.lens && String(candidate.selectedOrder) === slot.order && candidate.subjectHash === declarationBinding.requestHash && candidate.withdraw.binding.targetIdentity === declarationBinding.targetIdentity && candidate.withdraw.binding.lineageId === declarationBinding.lineageId && candidate.withdraw.binding.revision === declarationBinding.expectedRevision);
							if (stop !== undefined && declaredSlot !== undefined) {
								declarationMutationPerformed = true;
								declarationMutationOutcome = "committed";
							}
						} catch {
							// 没有证明，变更保持未知；声明失败已是上报的结果。
						}
					}
					return {
						tool: "jero_review_capture",
						status: "blocked",
						outcome: "unachievable-lens-declaration-failed",
						reason: error.message,
						failure: reviewHostRelayFailureReport(error),
						declaration_failure: declarationFailureReport,
						mutation_performed: declarationMutationPerformed,
						mutation_outcome: declarationMutationOutcome,
						next_action: REVIEW_HOST_RELAY_DECLARATION_FAILED_ACTION,
					};
					}
			}
			if (declared !== undefined) {
				const declaration = { lens: declared.lens, selected_order: declared.selectedOrder, subject_hash: declarationBinding.requestHash, reason: declared.reason };
				try {
					const status = await reconcileUnknownReviewLastEventCapture(nativeReviewCli, cwd, binding, route === undefined ? { agent: REVIEW_HOST_AGENT } : { ...route, agent: REVIEW_HOST_AGENT });
					syncRetainedNativeStatusSelections(selections, cwd, status, route?.baseRef);
					const stop = status.nextTransition?.kind === "stop" && status.nextTransition.reasonCode === "unachievable_lens_slot" ? status.nextTransition : undefined;
					// gentle-pi#822：stop 也可能携带其他运行声明的槽位，因此只暴露与本会话刚声明的身份匹配的条目。有槽位但无匹配条目的 stop 是对账失败，绝不是渲染别人 withdraw 命令的成功。
					const declaredSlot = stop?.unachievableLensSlots?.find((slot) => slot.lens === declaration.lens && slot.selectedOrder === declaration.selected_order && slot.subjectHash === declaration.subject_hash && slot.withdraw.binding.targetIdentity === declarationBinding.targetIdentity && slot.withdraw.binding.lineageId === declarationBinding.lineageId && slot.withdraw.binding.revision === declarationBinding.expectedRevision);
					// gentle-pi#822：成功是被证明的，绝非假设——一个完全没有 unachievable_lens_slot stop 的 STATUS（无 transition、别的 reason code，或 collect 重新提供）与条目不匹配声明身份的 stop 一样，都是对账失败。
					if (declaredSlot === undefined) {
						return {
							tool: "jero_review_capture",
							status: "blocked",
							outcome: "unachievable-lens-declaration-reconciliation-failed",
							reason: error.message,
							failure: reviewHostRelayFailureReport(error),
							declaration,
							reconciliation_failure: { operation: "jero_review_capture", status: "blocked", outcome: "unachievable-lens-slot-declaration-unmatched", reason: stop === undefined ? "the bound STATUS did not return the unachievable_lens_slot stop" : "no unachievable_lens_slots entry matches the declared slot identity", declared_slot: { lens: declaration.lens, selected_order: declaration.selected_order, subject_hash: declaration.subject_hash }, mutation_performed: true, mutation_outcome: "committed" },
							mutation_performed: true,
							mutation_outcome: "committed",
							next_action: REVIEW_HOST_RELAY_DECLARATION_FAILED_ACTION,
						};
					}
					return {
						tool: "jero_review_capture",
						status: "blocked",
						outcome: "unachievable-lens-slot-declared",
						reason: error.message,
						failure: reviewHostRelayFailureReport(error),
						declaration,
						provider_action: status.action,
						...(status.nextTransition === undefined ? {} : { next_transition: status.nextTransition }),
						unachievable_lens_slots: [{ lens: declaredSlot.lens, selected_order: declaredSlot.selectedOrder, subject_hash: declaredSlot.subjectHash, reason: declaredSlot.reason, ...(declaredSlot.detail === undefined ? {} : { detail: declaredSlot.detail }), withdraw: declaredSlot.withdraw.command }],
						result: status.raw,
						next_action: REVIEW_HOST_RELAY_UNACHIEVABLE_ACTION,
						mutation_performed: true,
						mutation_outcome: "committed",
					};
				} catch (statusError) {
					return {
						tool: "jero_review_capture",
						status: "blocked",
						outcome: "unachievable-lens-declaration-reconciliation-failed",
						reason: error.message,
						failure: reviewHostRelayFailureReport(error),
						declaration,
						reconciliation_failure: nativeOperationFailure("jero_review_capture", statusError),
						mutation_performed: true,
						mutation_outcome: "committed",
						next_action: REVIEW_HOST_RELAY_DECLARATION_FAILED_ACTION,
					};
				}
			}
		}
		return {
			tool: "jero_review_capture",
			status: "blocked",
			outcome: error.kind === REVIEW_HOST_RELAY_FAILURE.PI_TIMED_OUT ? "pi-host-relay-timeout" : "pi-host-relay-transport-failure",
			failure: reviewHostRelayFailureReport(error),
			reason: error.message,
			mutation_performed: false,
			mutation_outcome: "none",
			next_action: error.kind === REVIEW_HOST_RELAY_FAILURE.PI_TIMED_OUT
				? reviewHostRelayTimeoutNextAction(error)
				: error.kind === REVIEW_HOST_RELAY_FAILURE.SUBMISSION_REFUSED
					? REVIEW_HOST_RELAY_REFUSED_ACTION
					: REVIEW_HOST_RELAY_RETRY_ACTION,
		};
	}
}

const REVIEW_PROVIDER_ROLE_RETRY_ACTION =
	"Call fresh STATUS and execute only the exact one-slot role vector it reoffers; never relaunch from transcript inference.";

// gentle-pi#638：从一个 materialize 槽位自己的 provider 签发 token 重新派生 capture-unachievable 声明绑定。provider 将这些 token 渲染为 `--name=value` 对（review-host-relay.ts 的 renderToken），Go 在记录前用冻结权威校验每个值，因此缺失必需值或 subject hash 就意味着该槽位无法声明，调用方保持其回退行为。
function unachievableSlotDeclarationBinding(slot: ReviewHostRelaySlot): { lineageId: string; targetIdentity: string; expectedRevision: string; requestHash: string; repositoryContext?: string } | undefined {
	const tokenValue = (name: string): string | undefined => {
		const prefix = `--${name}=`;
		const token = slot.captureArgumentTokens.find((candidate) => candidate.startsWith(prefix));
		return token === undefined ? undefined : token.slice(prefix.length);
	};
	const lineageId = tokenValue("lineage");
	const targetIdentity = tokenValue("target");
	const expectedRevision = tokenValue("expected-revision");
	const repositoryContext = tokenValue("repository-context");
	if (lineageId === undefined || targetIdentity === undefined || expectedRevision === undefined || slot.subjectHash === undefined) return undefined;
	return { lineageId, targetIdentity, expectedRevision, requestHash: slot.subjectHash, ...(repositoryContext === undefined ? {} : { repositoryContext }) };
}

async function executeProviderRoleVectorCapture(
	slot: ReviewProviderRoleVectorSlot,
	nativeReviewCli: NativeReviewCli,
	cwd: string,
	binding: ReviewLastEventClosureBinding,
	selections: Map<string, RetainedNativeStatusSelection>,
	route: RetainedNativeCaptureRoute | undefined,
	signal?: AbortSignal,
): Promise<Record<string, unknown>> {
	if (nativeReviewCli.captureProviderRole === undefined) {
		return {
			tool: "jero_review_capture",
			status: "blocked",
			outcome: "provider-role-capture-unsupported",
			reason: "The provider issued a self-contained role capture vector, but this runtime has no native provider-role capture surface.",
			mutation_performed: false,
			mutation_outcome: "none",
		};
	}
	try {
		const artifact = await nativeReviewCli.captureProviderRole({
			captureOperation: slot.captureOperation,
			argumentTokens: slot.argumentTokens,
			cwd,
			...(signal === undefined ? {} : { signal }),
		});
		if ("operation" in artifact) return mapAndClearLastEventClosure(artifact, binding, selections, cwd);
		return {
			tool: "jero_review_capture",
			status: "captured",
			outcome: "native-provider-role-captured",
			lineage_id: artifact.lineageId,
			provider_role: {
				transport: "go_owned_pi_process",
				capture_operation: slot.captureOperation,
				role: artifact.role,
				target_identity: artifact.targetIdentity,
				captured: artifact.captured,
			},
		};
	} catch (error) {
		const outcome = await reconcileUnknownReviewCaptureFailure(error, nativeReviewCli, cwd, binding, selections, route);
		return {
			...outcome,
			...(outcome.status === "reconciled" ? {} : { retry_discipline: REVIEW_PROVIDER_ROLE_RETRY_ACTION }),
		};
	}
}

// 仍在等待评审者结果的 provider 命名镜头：每个待定
// `review.capture-result` collect 输入对应一个镜头，按 provider 顺序。
function pendingReviewerLenses(status: ReviewStatusV3): readonly string[] {
	if (status.nextTransition?.kind !== "collect") return [];
	return [...new Set((status.nextTransition.collect?.inputs ?? [])
		.filter((input) => input.captureOperation === "review.capture-result")
		.map((input) => input.artifactSubject?.lens)
		.filter((lens): lens is NonNullable<typeof lens> => lens !== undefined))];
}

// 现场缺陷（2026-08-16，Engram #12461）：由原生
// `review recover` 创建的后继 lineage 只存在于原生权威中——本控制器
// 从未见过它的 START，因此直接评审者派发以
// current-binding-missing 拒绝，尽管控制器自己刚解码过
// 后继者的权威 STATUS。从 STATUS 发现中镜像 START 时注册：
// 当一个未知但存活、仍在收集
// 评审者结果的 lineage 出现在本控制器解码的 status 中时，从原生
// descriptor 恢复其冻结投影，并用 provider 命名的待定镜头绑定面向
// 派发的当前候选视图。
//
// 现场报告（2026-08-16，gentle-pi 402f9f77）：水合必须从
// 每一条解码权威 status 的通道运行，而不只是从 STATUS
// 操作——报告的流程是 `finalize`（阻塞于
// review.capture-result）随后一次评审者派发，从未经过
// STATUS。它也绝不让调用方失败：STATUS 与被阻塞的
// FINALIZE 封套保持只读，结果被返回，让调用方
// 上报而不是吞掉。
// 现场缺陷（2026-08-16，第三份报告）：Pi 宿主中继从未为真实
// lineage 运行过。对照活的 2.4.0-main provider 做忠实
// 复现测量——无 agent 的 `review status` 返回裸 capture-result
// collect 输入（lineage、expected-revision、target、repository-context、
// lens、order、subject-hash），而同一 status 加 `--agent pi` 会额外
// 携带 agent=pi、materialize=true 和 provider 提交。适配器
// 从未指明其 agent，因此 reviewHostRelaySlots() 看到零个 materialize
// 槽位，中继不可达，没有任何镜头被启动。
//
// agent 是被探测的，绝非假设。锁定的 provider 自
// v2.4.0 起定义 `--agent`——v2.2.3 在 `review status` 上根本没有定义它并
// 直接拒绝——但 Pi 依然从不嗅探版本：已安装的二进制仍是
// 该 flag 是否存在的唯一权威。带类型的拒绝按
// provider 实例记忆，并以确切的 provider 原因阻塞生命周期；
// Pi 绝不将其降级为无 agent 的 STATUS 回退。
const REVIEW_HOST_AGENT = "pi" as const;
const REVIEW_TRANSPORT_REFUSAL_CODES = new Set([
	"immutable_review_transport_unsupported",
	"unsupported_agent",
	"unknown_flag",
]);
interface ReviewTransportRefusal { supported: false; code: string; message: string; }
interface NegotiatedHostTransportStatus {
	status?: ReviewStatusV3;
	transport?: ReviewTransportRefusal;
}
const reviewTransportRefusalByProvider = new WeakMap<object, ReviewTransportRefusal>();

function clearReviewTransportProbeForTesting(nativeReviewCli: NativeReviewCli | null): void {
	if (nativeReviewCli !== null) reviewTransportRefusalByProvider.delete(nativeReviewCli as unknown as object);
}

function hostTransportUnavailable(
	operation: ReviewControllerOperation | "jero_review_capture" | "jero_review_capture_group",
	transport: ReviewTransportRefusal,
): Record<string, unknown> {
	// #535：provider 打印的原始 `gentle-ai review ...` continuation 在本
	// 运行时是死路——Pi 不在 provider 的不可变评审运行时
	// 列表中，因此每个仅 CLI 的出口都以同一传输 code 拒绝。该
	// 拒绝因此指明在此表面运行的 continuation
	// （jero_review / jero_review_capture 包装工具），同时 provider 自己的
	// 诊断在 relay_transport 中原样保留作为证据。
	const isCapture = operation === "jero_review_capture" || operation === "jero_review_capture_group";
	return {
		...(isCapture ? { tool: operation } : { operation }),
		status: "blocked",
		outcome: "pi-host-relay-transport-unavailable",
		reason: `The native provider refused the required pi reviewer transport (${transport.code}): ${transport.message}`,
		relay_transport: transport,
		mutation_performed: false,
		mutation_outcome: "none",
		wrapper_continuation: {
			tool: "jero_review",
			operation: REVIEW_CONTROLLER_OPERATION.INSPECT,
			...(isCapture ? { then: operation } : {}),
		},
		next_action: `Install a native gentle-ai provider that supports \`review status --agent pi\`, then re-enter negotiated STATUS with jero_review {"operation":"inspect"}${!isCapture ? " and follow the transition it returns" : operation === "jero_review_capture_group" ? " and resubmit jero_review_capture_group with the complete exact ordered collectBindings that fresh STATUS returns" : " and resubmit jero_review_capture with the exact one-slot collectBinding that fresh STATUS returns"}. A provider-printed raw CLI continuation does not run in this runtime, and Pi never falls back to an agent-less lifecycle route.`,
	};
}

/**
 * 为所需的 pi 评审者传输查询已协商的 STATUS。带类型的
 * 拒绝按 provider 缓存并作为不可用返回；无论新的
 * 还是记忆中的拒绝，都不得发起无 agent 的生命周期 STATUS 请求。
 */
async function negotiatedStatusForHostTransport(
	nativeReviewCli: NativeReviewCli,
	request: NativeTargetStatusRequest,
	retainedSelections: Map<string, RetainedNativeStatusSelection>,
	canonicalRetentionRoot = request.cwd,
): Promise<NegotiatedHostTransportStatus> {
	const provider = nativeReviewCli as unknown as object;
	const remembered = reviewTransportRefusalByProvider.get(provider);
	if (remembered !== undefined) return { transport: remembered };
	try {
		const status = await nativeReviewCli.targetStatus!({ ...request, agent: REVIEW_HOST_AGENT });
		syncRetainedNativeStatusSelections(retainedSelections, canonicalRetentionRoot, status, request.baseRef);
		return { status };
	} catch (error) {
		const code = error instanceof NativeReviewIntegrationError ? error.failureEnvelope.code : undefined;
		// 只有封闭的传输拒绝集合才被定型为不可用；其余
		// 每种失败仍是错误，走调用方的常规错误路径。
		if (code === undefined || !REVIEW_TRANSPORT_REFUSAL_CODES.has(code)) throw error;
		const transport: ReviewTransportRefusal = { supported: false, code, message: error.message };
		reviewTransportRefusalByProvider.set(provider, transport);
		return { transport };
	}
}

// gentle-pi#568：为会话解析当前已协商的评审 STATUS，
// 沿用 `agent_end` 决定是否提醒的确切守卫：一个
// 同时具备 `reviewMode` 与 `targetStatus` 的原生评审 CLI、带
// UI 的上下文，以及 RDD 生效开启。任一守卫缺失、
// 模式生效关闭，或任何 STATUS 错误或传输拒绝，都返回
// `undefined`。启动协商与变更设门的 `agent_end` 使用同一条原生
// 全目标路径；两者都不从本地变更回执推导候选范围。
async function resolveNegotiatedReviewStatusForSession(
	nativeReviewCli: NativeReviewCli | null,
	ctx: ExtensionContext,
	sessionKey: PendingReviewConsentSessionKey,
): Promise<ReviewStatusV3 | undefined> {
	if (nativeReviewCli?.reviewMode === undefined || nativeReviewCli.targetStatus === undefined) return undefined;
	if (ctx.hasUI !== true) return undefined;
	let modeEffective: "on" | "off";
	try {
		const mode = await nativeReviewCli.reviewMode({ cwd: ctx.cwd, operation: NATIVE_REVIEW_MODE_OPERATION.STATUS });
		modeEffective = mode.status.effective;
	} catch {
		return undefined;
	}
	if (modeEffective === "off") return undefined;
	try {
		const retainedSelections = ((key: PendingReviewConsentSessionKey) => processRetainedNativeStatusSelections.get(key) ?? processRetainedNativeStatusSelections.set(key, new Map()).get(key)!)(sessionKey);
		const negotiated = await negotiatedStatusForHostTransport(nativeReviewCli, { cwd: ctx.cwd }, retainedSelections, ctx.cwd);
		return negotiated.status;
	} catch {
		return undefined;
	}
}

// gentle-pi#556 / gentle-ai#4051：经 `agent_end` 发出的
// 变更设门提醒。它从不自行运行 START，因此指明唯一
// 受支持的 continuation（jero_review inspect），并把由此产生的
// 同意封套交还给人类。
function renderAgentEndReviewPreflightMessage(targetIdentity: string): string {
	return `Receipt-driven development is enabled, and this worktree holds an unreviewed candidate (target ${targetIdentity}). First determine whether the user explicitly left this exact target unreviewed. If yes, do not invoke review; report that disposition and continue. Only otherwise, call the jero_review tool with {"operation":"inspect"} and follow the transition it returns; it currently offers review.start for this target. An eligible interactive Pi host may resolve consent directly with its own three-action UI. If jero_review instead returns an unresolved gentle-ai.review-integration.consent/v3 envelope, relay that original two-choice provider envelope to the human losslessly. Never answer consent from model prose or tool arguments.\n\nThis extension never runs START itself. This reminder consumes only this session's observed mutation generation.`;
}

function canonicalReviewCaptureBinding(value: unknown): string {
	if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number") return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map((entry) => canonicalReviewCaptureBinding(entry)).join(",")}]`;
	if (!isRecord(value)) throw new Error("Review capture collectBinding must encode a JSON object");
	return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalReviewCaptureBinding(value[key])}`).join(",")}}`;
}

function parseCanonicalReviewCaptureBinding(input: string): string {
	let binding: unknown;
	try {
		binding = JSON.parse(input);
	} catch (error) {
		throw new Error(`Review capture collectBinding is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
	}
	if (!isRecord(binding)) throw new Error("Review capture collectBinding must encode exactly one collect input object");
	return canonicalReviewCaptureBinding(binding);
}

function exactCollectArgument(input: ReviewCollectInputV3, name: string): string | undefined {
	const matches = input.arguments.filter((argument) => argument.name === name);
	return matches.length === 1 ? matches[0]!.value : undefined;
}

// intended-untracked collect 输入随 status/v6 到来，其后每个
// status 版本都保留它；只匹配一个确切版本会让每个
// 含未跟踪文件的工作区在 gentle-ai 应答 v7 后
// 无法启动评审（gentle-pi#610，gentle-ai#4187）。
const INTENDED_UNTRACKED_STATUS_SCHEMA = /^gentle-ai\.review-integration\.status\/v(\d+)$/;
function statusCarriesIntendedUntrackedSelection(schema: unknown): boolean {
	const match = typeof schema === "string" ? INTENDED_UNTRACKED_STATUS_SCHEMA.exec(schema) : null;
	return match !== null && Number(match[1]) >= 6;
}

function reviewIntendedUntrackedInput(status: ReviewStatusV3): ReviewCollectInputV3 | undefined {
	if (!statusCarriesIntendedUntrackedSelection(status.raw.schema) || status.nextTransition?.kind !== "collect") return undefined;
	const matches = (status.nextTransition.collect?.inputs ?? []).filter((input) => {
		const value = input.submission?.values[0];
		return input.name === "intended_untracked_selection" && input.schema === "gentle-ai.review-intended-untracked-selection/v1" && input.captureOperation === "external.select_intended_untracked" && input.submission?.operationToken === "status" && input.submission.values.length === 1 && value?.slot === "intended_untracked_selection" && value.domain === "schema_bound_json";
	});
	return matches.length === 1 ? matches[0] : undefined;
}

// gentle-pi#706：intended-untracked 选择上的 inspect stop 不携带
// continuation，因此 blocked 结果会精确指明它：清单摘要
// 只覆盖路径名，往返要么经 select
// 操作解决，要么经 inspect 自己的顶层 untrackedScope 解决。
const INSPECT_UNTRACKED_SELECTION_NEXT_STEP =
	'The intended-untracked selection is required before START. The expected_untracked_inventory digest covers untracked path names only (git ls-files --others --exclude-standard); nothing is read or hashed at inventory time, and file content is hashed only for selected paths at candidate freeze. Either call jero_review with operation "select-intended-untracked" passing this selectionBinding and intendedUntracked ([] excludes every eligible path, a subset includes only those paths), or call inspect again with untrackedScope ("exclude", or "select" with intendedUntracked) to resolve the round trip in one call. To keep a path out of the inventory permanently, ignore it through .gitignore or .git/info/exclude.';

interface PublicReviewCaptureBinding { collectBinding: string; }
function publicReviewCaptureBindings(status: ReviewStatusV3): readonly PublicReviewCaptureBinding[] {
	if (status.nextTransition?.kind !== "collect") return [];
	return (status.nextTransition.collect?.inputs ?? []).filter((input) => input.captureOperation !== "external.select_intended_untracked").map((input) => ({ collectBinding: canonicalReviewCaptureBinding(input) }));
}

function captureBindingRejected(reason: string, group = false): Record<string, unknown> {
	return {
		tool: group ? "jero_review_capture_group" : "jero_review_capture",
		status: "blocked",
		outcome: group ? "capture-group-rejected" : "capture-binding-rejected",
		reason,
		mutation_performed: false,
		mutation_outcome: "none",
	};
}

interface SelectedReviewCapture {
	input: ReviewCollectInputV3;
	binding: ReviewLastEventClosureBinding;
}

function selectExactReviewCapture(
	status: ReviewStatusV3,
	lineageId: string,
	canonicalBinding: string,
): SelectedReviewCapture | Record<string, unknown> {
	const statusLineageId = status.authority?.lineageId;
	const statusTargetIdentity = status.targetIdentity;
	if (
		!isCanonicalProcessString(lineageId) ||
		!isCanonicalProcessString(statusLineageId) ||
		!isCanonicalProcessString(statusTargetIdentity) ||
		status.applicability !== "current_target" ||
		statusLineageId !== lineageId
	) {
		return captureBindingRejected("current STATUS does not offer one non-empty matching lineage and target identity");
	}
	if (status.nextTransition?.kind !== "collect") {
		return captureBindingRejected("current STATUS does not offer a collect transition");
	}
	const matches = (status.nextTransition.collect?.inputs ?? []).filter((input) => canonicalReviewCaptureBinding(input) === canonicalBinding);
	if (matches.length !== 1) {
		return captureBindingRejected(matches.length === 0
			? "collectBinding is missing or stale for current STATUS"
			: "collectBinding matches more than one current STATUS input");
	}
	const input = matches[0]!;
	const inputLineageId = exactCollectArgument(input, "lineage");
	const inputTargetIdentity = exactCollectArgument(input, "target");
	// Go 的 targeted-validator 向量把其捕获目标绑定到
	// provider 拥有的验证请求中的纠正目标，而不是
	// STATUS 的当前候选身份。其余所有捕获仍绑定到 STATUS。
	const expectedInputTargetIdentity = input.validationRequest?.correctionTargetIdentity ?? statusTargetIdentity;
	if (
		!isCanonicalProcessString(inputLineageId) ||
		!isCanonicalProcessString(inputTargetIdentity) ||
		inputLineageId !== lineageId ||
		inputTargetIdentity !== expectedInputTargetIdentity
	) {
		return captureBindingRejected("collectBinding does not carry one non-empty matching provider lineage and target token");
	}
	return {
		input,
		binding: { lineageId, targetIdentity: statusTargetIdentity },
	};
}

function isSelectedReviewCapture(value: SelectedReviewCapture | Record<string, unknown>): value is SelectedReviewCapture {
	return "input" in value && "binding" in value;
}

function isSelectedReviewCaptureGroup(value: SelectedReviewCaptureGroup | Record<string, unknown>): value is SelectedReviewCaptureGroup {
	return "slots" in value && "binding" in value;
}

function captureGroupRejected(reason: string): Record<string, unknown> { return captureBindingRejected(reason, true); }

function hasExactReviewCaptureSuffix(status: ReviewStatusV3, expected: readonly string[]): boolean {
	const current = status.nextTransition?.kind === "collect"
		? (status.nextTransition.collect?.inputs ?? []).filter((input) => input.captureOperation === "review.capture-result").map(canonicalReviewCaptureBinding)
		: [];
	return current.length === expected.length && current.every((binding, index) => binding === expected[index]);
}

function captureGroupAuthorityDrift(status: ReviewStatusV3): Record<string, unknown> {
	return { ...captureGroupRejected("authoritative STATUS does not offer exactly the unsubmitted reviewer suffix"), outcome: "capture-group-authority-drift", reconciliation: status.raw, authority_applicability: status.applicability, provider_action: status.action, next_transition: status.nextTransition };
}

interface SelectedReviewCaptureGroup {
	slots: readonly ReviewHostRelaySlot[];
	binding: ReviewLastEventClosureBinding;
}

function selectExactReviewCaptureGroup(
	status: ReviewStatusV3,
	lineageId: string,
	canonicalBindings: readonly string[],
): SelectedReviewCaptureGroup | Record<string, unknown> {
	const inputs = status.nextTransition?.kind === "collect" ? status.nextTransition.collect?.inputs ?? [] : [];
	const slots = reviewHostRelaySlots(inputs);
	if (inputs.length === 0 || slots.length !== inputs.length) {
		return captureGroupRejected("current STATUS does not offer an exclusively materialize reviewer capture group");
	}
	const currentBindings = inputs.map((input) => canonicalReviewCaptureBinding(input));
	if (new Set(currentBindings).size !== currentBindings.length || canonicalBindings.length !== currentBindings.length || canonicalBindings.some((binding, index) => binding !== currentBindings[index])) {
		return captureGroupRejected("collectBindings must be the complete distinct current reviewer group in exact provider order");
	}
	const first = selectExactReviewCapture(status, lineageId, currentBindings[0]!);
	if (!isSelectedReviewCapture(first)) return captureGroupRejected(String(first.reason ?? "current STATUS rejected a reviewer binding"));
	const expectedRevision = exactCollectArgument(inputs[0]!, "expected-revision");
	const repositoryContext = exactCollectArgument(inputs[0]!, "repository-context");
	const statusTargetIdentity = status.targetIdentity;
	const currentRepositoryContext = status.repositoryContext;
	if (!isCanonicalProcessString(expectedRevision) || !isCanonicalProcessString(repositoryContext) || currentRepositoryContext === undefined || expectedRevision !== currentRepositoryContext.revision) {
		return captureGroupRejected("current STATUS does not bind one matching expected revision and repository context for the reviewer group");
	}
	if (currentRepositoryContext.handle !== repositoryContext || currentRepositoryContext.targetIdentity !== statusTargetIdentity) {
		return captureGroupRejected("current STATUS repository context does not match the reviewer group binding");
	}
	const lenses = new Set<string>(), orders = new Set<string>(), subjectHashes = new Set<string>();
	for (let index = 0; index < inputs.length; index += 1) {
		const input = inputs[index]!, slot = slots[index]!, subject = input.artifactSubject;
		const slotLineage = exactCollectArgument(input, "lineage"), target = exactCollectArgument(input, "target");
		const revision = exactCollectArgument(input, "expected-revision"), context = exactCollectArgument(input, "repository-context");
		const subjectHash = exactCollectArgument(input, "subject-hash"), order = slot.order, lens = slot.lens;
		if (
			subject === undefined || slot.submission === undefined || slotLineage !== lineageId || target !== statusTargetIdentity
			|| revision !== expectedRevision || context !== repositoryContext || subjectHash !== subject.subjectHash || order === undefined || lens === undefined
			|| subject.lineageId !== lineageId || subject.authorityRevision !== expectedRevision || subject.targetIdentity !== statusTargetIdentity
			|| lens !== subject.lens || String(subject.selectedOrder) !== order
		) return captureGroupRejected("current STATUS carries an incomplete or mismatched materialize reviewer binding");
		try { resolveReviewHostRelaySubmission(slot.submission); } catch { return captureGroupRejected("current STATUS carries an invalid provider reviewer submission descriptor"); }
		const value = slot.submission.values[0];
		if (slot.submission.operationToken !== "capture-result" || value?.slot !== "reviewer_result" || value.domain !== "artifact_path_or_stdin" || lenses.has(lens) || orders.has(order) || subjectHashes.has(subject.subjectHash)) {
			return captureGroupRejected("current STATUS carries duplicate or invalid reviewer slot identities");
		}
		lenses.add(lens); orders.add(order); subjectHashes.add(subject.subjectHash);
	}
	return { slots, binding: first.binding };
}

function reviewHostRelayGroupFailure(
	error: ReviewHostRelayError,
	slots: readonly ReviewHostRelaySlot[],
	prepared: readonly ReviewHostRelayPreparedResult[],
	submitted: number,
): Record<string, unknown> {
	return {
		tool: "jero_review_capture_group",
		status: "blocked",
		outcome: error.kind === REVIEW_HOST_RELAY_FAILURE.RELAY_UNAVAILABLE ? "pi-host-relay-unavailable" : error.kind === REVIEW_HOST_RELAY_FAILURE.PI_TIMED_OUT ? "pi-host-relay-timeout" : "pi-host-relay-transport-failure",
		reason: error.message,
		failure: reviewHostRelayFailureReport(error),
		...reviewHostRelayGroupProgress(slots, prepared, submitted),
		next_action: error.kind === REVIEW_HOST_RELAY_FAILURE.SUBMISSION_REFUSED ? REVIEW_HOST_RELAY_REFUSED_ACTION : REVIEW_HOST_RELAY_RETRY_ACTION,
	};
}

async function executeReviewCaptureOperation(
	parametersValue: unknown,
	sessionCwd: string,
	nativeReviewCli: NativeReviewCli | null,
	signal?: AbortSignal,
	candidateViews: CandidateViewRegistry | null = new CandidateViewRegistry(),
	retainedUntrackedSelections: Map<string, RetainedNativeStatusSelection> = new Map(),
	requireRegisteredRoute = false,
): Promise<Record<string, unknown>> {
	const parameters = parseReviewCaptureParameters(parametersValue);
	if (nativeReviewCli === null || nativeReviewCli.targetStatus === undefined) {
		return {
			tool: "jero_review_capture",
			status: "blocked",
			outcome: "native-status-unsupported",
			mutation_performed: false,
			mutation_outcome: "none",
		};
	}
	const canonicalBinding = parseCanonicalReviewCaptureBinding(parameters.collectBinding);
	const cwd = resolveReviewControllerWorkspaceRoot(parameters.workspaceRoot, sessionCwd, candidateViews, parameters.lineageId);
	const route = readRetainedNativeCaptureRoute(retainedUntrackedSelections, canonicalBinding);
	if (requireRegisteredRoute && (route === undefined || route.workspaceRoot !== cwd || route.lineageId !== parameters.lineageId)) {
		return captureBindingRejected("collectBinding is unknown, expired, or belongs to a different session route");
	}
	let status: ReviewStatusV3;
	try {
		const negotiated = await negotiatedStatusForHostTransport(nativeReviewCli, {
			cwd,
			lineageId: parameters.lineageId,
			...(route?.baseRef === undefined ? {} : { baseRef: route.baseRef, committedOnly: true }),
			...readRetainedNativeUntrackedSelection(retainedUntrackedSelections, cwd, parameters.lineageId),
			...(signal === undefined ? {} : { signal }),
		}, retainedUntrackedSelections, cwd);
		if (negotiated.transport !== undefined) return hostTransportUnavailable("jero_review_capture", negotiated.transport);
		status = negotiated.status!;
	} catch (error) {
		return nativeOperationFailure("jero_review_capture", error);
	}
	const selected = selectExactReviewCapture(status, parameters.lineageId, canonicalBinding);
	if (!isSelectedReviewCapture(selected)) return selected;

	// 纠正期间，流程同时携带原始权威目标身份
	// 和一个不同的 provider 签发纠正目标身份
	// （gentle-pi#535 第 15 行）。在捕获结果上回显纠正
	// 身份，使调用方绝不必从不透明绑定中重建二者的区别。
	const correctionTargetIdentity = selected.input.validationRequest?.correctionTargetIdentity ?? selected.input.artifactSubject?.correctionTargetIdentity;
	const withCorrectionTarget = (result: Record<string, unknown>): Record<string, unknown> =>
		correctionTargetIdentity === undefined ? result : { ...result, correction_target_identity: correctionTargetIdentity };

	const hostRelaySlots = reviewHostRelaySlots([selected.input]);
	if (hostRelaySlots.length === 1) {
		if (parameters.correctionLines !== undefined) return captureBindingRejected("correctionLines is valid only for a correction-plan capture");
		if (parameters.reviewerRunAcknowledged !== true) {
			return {
				tool: "jero_review_capture",
				status: "blocked",
				outcome: "reviewer-model-run-forecast",
				cost_forecast: {
					transport: "pi_host_relay",
					model_runs: 1,
					lenses: hostRelaySlots[0]!.lens === undefined ? [] : [hostRelaySlots[0]!.lens],
				},
				mutation_performed: false,
				mutation_outcome: "none",
			};
		}
		return withCorrectionTarget(await executeReviewHostRelayCapture(hostRelaySlots[0]!, nativeReviewCli, cwd, selected.binding, retainedUntrackedSelections, route, signal));
	}

	if (selected.input.captureOperation === "review.capture-correction-plan") {
		if (parameters.reviewerRunAcknowledged !== undefined) return captureBindingRejected("reviewerRunAcknowledged is valid only for a materialize reviewer capture");
		const submission = selected.input.submission;
		const value = submission?.values.length === 1 ? submission.values[0] : undefined;
		if (submission === undefined || value?.slot !== "correction_lines") return captureBindingRejected("provider correction-plan capture omitted its exact correction-lines binding");
		if (parameters.correctionLines === undefined) {
			return {
				tool: "jero_review_capture",
				status: "blocked",
				outcome: "correction-lines-required",
				minimum: value.minimum ?? 1,
				maximum: value.maximum ?? 200,
				mutation_performed: false,
				mutation_outcome: "none",
			};
		}
		if ((value.minimum !== undefined && parameters.correctionLines < value.minimum) || (value.maximum !== undefined && parameters.correctionLines > value.maximum)) {
			return captureBindingRejected("correctionLines is outside the exact provider-issued correction-plan bounds");
		}
		if (nativeReviewCli.captureCorrectionPlan === undefined) return captureBindingRejected("native correction-plan capture is unavailable");
		try {
			const closure = await nativeReviewCli.captureCorrectionPlan({
				argumentTokens: submission.argumentTokens,
				correctionLines: parameters.correctionLines,
				cwd,
				...(signal === undefined ? {} : { signal }),
			});
			return withCorrectionTarget(mapAndClearLastEventClosure(closure, selected.binding, retainedUntrackedSelections, cwd));
		} catch (error) {
			return await reconcileUnknownReviewCaptureFailure(error, nativeReviewCli, cwd, selected.binding, retainedUntrackedSelections, route);
		}
	}

	const providerRoleSlots = reviewProviderRoleVectorSlots([selected.input]);
	if (providerRoleSlots.length === 1) {
		if (parameters.reviewerRunAcknowledged !== undefined || parameters.correctionLines !== undefined) {
			return captureBindingRejected("reviewerRunAcknowledged and correctionLines are not valid for a provider role capture");
		}
		return withCorrectionTarget(await executeProviderRoleVectorCapture(providerRoleSlots[0]!, nativeReviewCli, cwd, selected.binding, retainedUntrackedSelections, route, signal));
	}
	return captureBindingRejected(`unsupported provider capture operation: ${selected.input.captureOperation}`);
}

function reviewHostRelayGroupDiagnostics(slots: readonly ReviewHostRelaySlot[], prepared: readonly ReviewHostRelayPreparedResult[], count: number): readonly Record<string, unknown>[] {
	return slots.slice(0, count).map((slot, index) => ({
		...(slot.lens === undefined ? {} : { lens: slot.lens }),
		...(slot.order === undefined ? {} : { order: slot.order }),
		...(slot.subjectHash === undefined ? {} : { subject_hash: slot.subjectHash }),
		prompt_bytes: prepared[index]?.promptByteLength,
		result_bytes: prepared[index]?.resultByteLength,
	}));
}

function reviewHostRelayGroupProgress(
	slots: readonly ReviewHostRelaySlot[],
	prepared: readonly ReviewHostRelayPreparedResult[],
	submitted: number,
	uncertain = false,
): Record<string, unknown> {
	const outcome = submitted === 0 ? uncertain ? "unknown" : "none" : uncertain ? "partial_unknown" : submitted === slots.length ? "completed" : "partial";
	return {
		prepared_reviewers: prepared.length,
		submitted_reviewers: submitted,
		host_relay: { transport: "pi_host_relay", reviewers: reviewHostRelayGroupDiagnostics(slots, prepared, submitted) },
		...(submitted === 0 && uncertain ? { mutation_outcome: outcome } : { mutation_performed: submitted > 0, mutation_outcome: outcome }),
	};
}

async function executeReviewCaptureGroupOperation(
	parametersValue: unknown,
	sessionCwd: string,
	nativeReviewCli: NativeReviewCli | null,
	signal?: AbortSignal,
	candidateViews: CandidateViewRegistry | null = new CandidateViewRegistry(),
	retainedUntrackedSelections: Map<string, RetainedNativeStatusSelection> = new Map(),
	requireRegisteredRoute = false,
): Promise<Record<string, unknown>> {
	const parameters = parseReviewCaptureGroupParameters(parametersValue);
	if (nativeReviewCli === null || nativeReviewCli.targetStatus === undefined) return { ...captureGroupRejected("native target STATUS is unavailable"), outcome: "native-status-unsupported" };
	const canonicalBindings = parameters.collectBindings.map((binding) => parseCanonicalReviewCaptureBinding(binding));
	const cwd = resolveReviewControllerWorkspaceRoot(parameters.workspaceRoot, sessionCwd, candidateViews, parameters.lineageId);
	const routes = canonicalBindings.map((binding) => readRetainedNativeCaptureRoute(retainedUntrackedSelections, binding));
	const route = routes[0];
	if (requireRegisteredRoute && (route === undefined || routes.some((candidate) => candidate === undefined || candidate.workspaceRoot !== cwd || candidate.lineageId !== parameters.lineageId || candidate.baseRef !== route.baseRef))) {
		return captureGroupRejected("collectBindings are unknown, expired, or belong to different session routes");
	}
	const freshStatus = () => negotiatedStatusForHostTransport(nativeReviewCli, {
		cwd, lineageId: parameters.lineageId,
		...(route?.baseRef === undefined ? {} : { baseRef: route.baseRef, committedOnly: true }),
		...readRetainedNativeUntrackedSelection(retainedUntrackedSelections, cwd, parameters.lineageId),
		...(signal === undefined ? {} : { signal }),
	}, retainedUntrackedSelections, cwd);
	let status: ReviewStatusV3;
	try {
		const negotiated = await freshStatus();
		if (negotiated.transport !== undefined) return hostTransportUnavailable("jero_review_capture_group", negotiated.transport);
		status = negotiated.status!;
	} catch (error) {
		return { ...captureGroupRejected(error instanceof Error ? error.message : String(error)), outcome: "native-status-failed" };
	}
	const group = selectExactReviewCaptureGroup(status, parameters.lineageId, canonicalBindings);
	if (!isSelectedReviewCaptureGroup(group)) return group;
	if (parameters.reviewerRunAcknowledged !== true) {
		return {
			tool: "jero_review_capture_group",
			status: "blocked",
			outcome: "reviewer-model-run-forecast",
			cost_forecast: { transport: "pi_host_relay", model_runs: group.slots.length, lenses: group.slots.map((slot) => slot.lens).filter((lens): lens is string => lens !== undefined) },
			mutation_performed: false,
			mutation_outcome: "none",
		};
	}
	const requests: readonly ReviewHostRelayRequest[] = group.slots.map((slot) => ({
		captureArgumentTokens: slot.captureArgumentTokens,
		targetCwd: cwd,
		submission: slot.submission!,
		...(signal === undefined ? {} : { signal }),
	}));
	let prepared: readonly ReviewHostRelayPreparedResult[];
	try {
		prepared = await activeReviewHostRelayReviewerGroupRunner(requests);
		if (prepared.length !== requests.length) throw new Error("Pi host relay reviewer group returned a different number of prepared results");
	} catch (error) {
		return error instanceof ReviewHostRelayError
			? reviewHostRelayGroupFailure(error, group.slots, [], 0)
			: { ...captureGroupRejected(error instanceof Error ? error.message : String(error)), outcome: "pi-host-relay-reviewer-group-failed" };
	}
	for (let index = 0; index < prepared.length; index += 1) {
		let current: SelectedReviewCapture | Record<string, unknown>;
		try {
			const negotiated = await freshStatus();
			if (negotiated.transport !== undefined) return { ...hostTransportUnavailable("jero_review_capture_group", negotiated.transport), ...reviewHostRelayGroupProgress(group.slots, prepared, index) };
			if (!hasExactReviewCaptureSuffix(negotiated.status!, canonicalBindings.slice(index))) return { ...captureGroupAuthorityDrift(negotiated.status!), ...reviewHostRelayGroupProgress(group.slots, prepared, index) };
			current = selectExactReviewCapture(negotiated.status!, parameters.lineageId, canonicalBindings[index]!);
		} catch (error) {
			return { ...captureGroupRejected(error instanceof Error ? error.message : String(error)), outcome: "native-status-failed", ...reviewHostRelayGroupProgress(group.slots, prepared, index) };
		}
		if (!isSelectedReviewCapture(current)) return { ...captureGroupRejected(String(current.reason ?? "current STATUS rejected a reviewer binding")), ...reviewHostRelayGroupProgress(group.slots, prepared, index) };
		try {
			const result = await activeReviewHostRelaySubmissionRunner(prepared[index]!);
			const closure = decodeRelayLastEventClosure(result.submission);
			if (closure !== undefined) {
				const closed = mapAndClearLastEventClosure(closure, current.binding, retainedUntrackedSelections, cwd);
				return { ...closed, tool: "jero_review_capture_group", ...reviewHostRelayGroupProgress(group.slots, prepared, index + 1) };
			}
		} catch (error) {
			if (error instanceof ReviewHostRelayError && error.mutationOutcome !== "unknown") return reviewHostRelayGroupFailure(error, group.slots, prepared, index);
			const reconciled = await reconcileUnknownReviewCaptureFailure(error, nativeReviewCli, cwd, current.binding, retainedUntrackedSelections, route, undefined, REVIEW_HOST_AGENT);
			return { ...reconciled, tool: "jero_review_capture_group", ...reviewHostRelayGroupProgress(group.slots, prepared, index, true), ...(error instanceof ReviewHostRelayError ? { failure: reviewHostRelayFailureReport(error), reason: error.message } : {}) };
		}
	}
	const reconciled = await reconcileUnknownReviewCaptureFailure(undefined, nativeReviewCli, cwd, group.binding, retainedUntrackedSelections, route, canonicalBindings.slice(prepared.length), REVIEW_HOST_AGENT);
	return { ...reconciled, tool: "jero_review_capture_group", outcome: reconciled.outcome === "capture-group-authority-drift" ? reconciled.outcome : reconciled.status === "reconciled" ? "native-reviewer-group-status-reconciled" : "native-reviewer-group-status-reconciliation-failed", ...reviewHostRelayGroupProgress(group.slots, prepared, prepared.length) };
}

type DispatchHydrationOutcome =
	| { hydrated: true; lineage_id: string; lenses: readonly string[] }
	| { hydrated: false; lineage_id: string; reason: string; message: string }
	| undefined;

function hydrateDispatchBindingFromStatus(candidateViews: CandidateViewRegistry | null, contributorRoot: string, status: ReviewStatusV3): DispatchHydrationOutcome {
	if (candidateViews === null || candidateViews.hasCurrentBinding(contributorRoot)) return undefined;
	const lineageId = status.authority?.lineageId;
	if (lineageId === undefined || status.applicability !== "current_target" || candidateViews.hasProjection(lineageId, contributorRoot)) return undefined;
	const lenses = pendingReviewerLenses(status);
	if (lenses.length === 0) return undefined;
	try {
		candidateViews.restoreCurrentForDispatchFromNative(lineageId, contributorRoot, status.projection, lenses);
		return { hydrated: true, lineage_id: lineageId, lenses };
	} catch (error) {
		// 水合绝不让调用方失败；注册表记录带类型的
		// 原因，让随后的派发拒绝指明该尝试，而不是
		// 宣称从未有过可用绑定。
		return {
			hydrated: false,
			lineage_id: lineageId,
			reason: error instanceof CandidateViewError ? error.reason : "candidate-view-invalid",
			message: error instanceof Error ? error.message : String(error),
		};
	}
}

async function executeReviewControllerOperation(
	parametersValue: unknown,
	sessionCwd: string,
	nativeReviewCli: NativeReviewCli | null,
	signal?: AbortSignal,
	candidateViews: CandidateViewRegistry | null = new CandidateViewRegistry(),
	context?: ExtensionContext,
	retainedUntrackedSelections: Map<string, RetainedNativeStatusSelection> = new Map(),
	pendingReviewConsentRegistry: PendingReviewConsentRegistry = processPendingReviewConsentRegistry,
	pendingReviewConsentFallbackKey: symbol = Symbol("pending-review-consent-fallback"),
	reviewConsentNow: () => number = Date.now,
	reviewConsentScheduleTimer: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout> = setTimeout,
	intendedUntrackedSelection?: NativeIntendedUntrackedSelectionSubmission,
): Promise<Record<string, unknown>> {
	const parameters = parseReviewControllerParameters(parametersValue);
	const defaultCwd = resolveReviewControllerWorkspaceRoot(parameters.workspaceRoot, sessionCwd, candidateViews, parameters.lineageId);
	const pendingReviewConsentSession = pendingReviewConsentSessionKey(context, pendingReviewConsentFallbackKey);
	const _useTargetLifecycleRoot = requiresExplicitTargetLifecycleRoot(parameters.workspaceRoot, sessionCwd, defaultCwd);
	const includeWorkspaceRoot = parameters.workspaceRoot !== undefined || defaultCwd !== sessionCwd;
	if (parameters.operation === REVIEW_CONTROLLER_OPERATION.EXPORT || parameters.operation === REVIEW_CONTROLLER_OPERATION.IMPORT) {
		// 旧式 bundle 传输依附于已退役的集成前 graph/compact
		// 存储。原生 v2.1.11 CLI 未暴露 bundle 等价物，因此两个
		// 操作都返回结构化的退役封套；枚举成员被
		// 保留，使工具 schema 对既有调用方保持稳定。
		return {
			operation: parameters.operation,
			status: "blocked",
			outcome: "legacy-operation-retired",
			reason: "Legacy review bundle transport (export/import) was retired together with the pre-integration graph/compact stores; no bundle equivalent exists.",
			mutation_performed: false,
			mutation_outcome: "none",
			next_action: "There is no bundle transport and no external CLI. Review state lives in the in-process authority store under .git/jero-review/ and travels with the repository through normal Git replication; use the jero_review operations (inspect/status/start/finalize/validate and the audited maintenance operations) to work with it.",
		};
	}
	if (parameters.operation === REVIEW_CONTROLLER_OPERATION.ASSESS) {
		// 只读原生风险评估（gentle-ai#4295，gentle-pi#662）。从不
		// 变更，从不要求 lineageId，也从不经过
		// authorizeDestructiveReviewOperation（它对任何既非
		// RESET 也非维护操作的 operation 都提前返回）。
		const input = parseReviewAssessInput(parameters.operation, parameters.input);
		const details = await resolveReviewAssessmentPlan(nativeReviewCli, defaultCwd, input, signal);
		return { operation: parameters.operation, ...details, ...(includeWorkspaceRoot ? { workspace_root: defaultCwd } : {}) };
	}
	const maintenance = nativeMaintenanceOperation(parameters.operation);
	if (maintenance !== undefined) {
		const input = parseControllerJson(requiredControllerString(parameters, "input"), parameters.operation);
		return await executeNativeAuthorityMaintenance(parameters.operation, maintenance, input, defaultCwd, nativeReviewCli, signal);
	}
	if (
		parameters.operation === REVIEW_CONTROLLER_OPERATION.INSPECT &&
		nativeReviewCli !== null
	) {
		// 新的 inspect 在其第一次 STATUS 尝试之前取代所有
		// pre-lineage 选择。失败或候选已变的 inspect 不能把
		// 更早的选择留给后续 START 使用。
		clearRetainedNativeUntrackedSelection(retainedUntrackedSelections, defaultCwd, "");
		try {
			if (nativeReviewCli.targetStatus !== undefined) {
				const negotiated = await negotiatedStatusForHostTransport(
					nativeReviewCli,
					{
						cwd: defaultCwd,
						...(signal === undefined ? {} : { signal }),
					},
					retainedUntrackedSelections,
					defaultCwd,
				);
				if (negotiated.transport !== undefined) {
					return {
						...hostTransportUnavailable(parameters.operation, negotiated.transport),
						...(includeWorkspaceRoot ? { workspace_root: defaultCwd } : {}),
					};
				}
				const status = negotiated.status!;
				const plainMapped = mapNativeTargetStatus(
					parameters.operation,
					status,
					undefined,
				);
				if (parameters.untrackedScope === undefined) {
					// gentle-pi#706：stop 本身从不告诉调用方下一步做什么。
					return {
						...plainMapped,
						...("selectionBinding" in plainMapped
							? { nextStep: INSPECT_UNTRACKED_SELECTION_NEXT_STEP }
							: {}),
						...(includeWorkspaceRoot ? { workspace_root: defaultCwd } : {}),
					};
				}
				const input = reviewIntendedUntrackedInput(status);
				if (input === undefined)
					return {
						...plainMapped,
						untracked_selection: "not-required",
						...(includeWorkspaceRoot ? { workspace_root: defaultCwd } : {}),
					};
				const eligibleJson = exactCollectArgument(input, "eligible_paths_json"),
					inventory = exactCollectArgument(input, "expected_untracked_inventory");
				let eligible: unknown;
				try {
					eligible = JSON.parse(eligibleJson ?? "");
				} catch {
					eligible = undefined;
				}
				const selected = validateNativeStartUntrackedSelection({
					untrackedScope: parameters.untrackedScope,
					expectedUntrackedInventory: inventory,
					intendedUntracked: parameters.intendedUntracked,
				});
				if (
					!Array.isArray(eligible) ||
					selected.reason !== undefined ||
					selected.intendedUntracked!.some((path) => !eligible.includes(path))
				) {
					return {
						operation: parameters.operation,
						status: "blocked",
						outcome: "inspect-untracked-scope-invalid",
						reason:
							"The requested untrackedScope/intendedUntracked combination is invalid for the current intended-untracked stop: paths must be members of the eligible inventory, exclude selects none, and select selects at least one.",
						mutation_performed: false,
						mutation_outcome: "none",
					};
				}
				const submission: NativeIntendedUntrackedSelectionSubmission = {
					argumentTokens: input.submission!.argumentTokens,
					value: JSON.stringify({
						schema: "gentle-ai.review-intended-untracked-selection/v1",
						untracked_scope: parameters.untrackedScope,
						expected_untracked_inventory: inventory,
						intended_untracked: selected.intendedUntracked,
					}),
				};
				const resolved = await negotiatedStatusForHostTransport(
					nativeReviewCli,
					{
						cwd: defaultCwd,
						untrackedScope: parameters.untrackedScope,
						expectedUntrackedInventory: inventory,
						intendedUntracked: selected.intendedUntracked,
						intendedUntrackedSelection: submission,
						...(signal === undefined ? {} : { signal }),
					},
					retainedUntrackedSelections,
					defaultCwd,
				);
				if (resolved.transport !== undefined) {
					return {
						...hostTransportUnavailable(parameters.operation, resolved.transport),
						...(includeWorkspaceRoot ? { workspace_root: defaultCwd } : {}),
					};
				}
				const resolvedStatus = resolved.status!;
				const candidateIdentity = nativePreLineageCandidateIdentity(resolvedStatus);
				if (candidateIdentity !== undefined) {
					retainNativeUntrackedSelection(
						retainedUntrackedSelections,
						defaultCwd,
						"",
						Object.freeze({
							untrackedScope: parameters.untrackedScope,
							expectedUntrackedInventory: inventory!,
							intendedUntracked: Object.freeze([...selected.intendedUntracked!]),
							submission,
							...candidateIdentity,
						}),
					);
				}
				const resolvedMapped = mapNativeTargetStatus(
					parameters.operation,
					resolvedStatus,
					undefined,
				);
				return {
					...resolvedMapped,
					...("selectionBinding" in resolvedMapped
						? { nextStep: INSPECT_UNTRACKED_SELECTION_NEXT_STEP }
						: {}),
					...(includeWorkspaceRoot ? { workspace_root: defaultCwd } : {}),
				};
			}
			return nativeStatusUnsupported(parameters.operation);
		} catch (error) {
			return nativeStatusFailed(parameters.operation, error);
		}
	}
	if (parameters.operation === REVIEW_CONTROLLER_OPERATION.INSPECT) {
		return nativeStatusUnsupported(parameters.operation);
	}

	if (parameters.operation === REVIEW_CONTROLLER_OPERATION.RECOVER_LOCK) {
		const input = parseControllerJson(requiredControllerString(parameters, "input"), parameters.operation);
		if (typeof input.ownerHash !== "string") throw new Error("Lock recovery requires an exact ownerHash");
		// 卡死的旧式变更锁是一个不完整的在途条目；其
		// 移除归已审计的原生隔离所有。锁恢复不是
		// 破坏性的权威重置，因此待定授权得以保留。
		return await executeNativeRecoveryRoute(parameters.operation, "reclaim", input, defaultCwd, nativeReviewCli, signal);
	}
	if (parameters.operation === REVIEW_CONTROLLER_OPERATION.RECOVER) {
		const input = parseControllerJson(requiredControllerString(parameters, "input"), parameters.operation);
		// 授权绑定由 Pi 派生，绝不由调用方携带。它被
		// 原样记录为维护者证明，因此接受一个由
		// 调用方拼写的绑定会让未经批准的执行者为恢复边签名。
		if (input.maintainerAuthorization !== undefined) {
			return {
				operation: parameters.operation,
				status: "blocked",
				outcome: "native-recovery-caller-authorization-rejected",
				native_operation: "review recover",
				mutation_performed: false,
				mutation_outcome: "none",
				next_action: "resubmit-without-maintainer-authorization",
			};
		}
		const missing = NATIVE_RECOVERY_INPUT.recover.filter((key) =>
			key === "disposition"
				? !["scope_changed", "invalidated", "escalated"].includes(input[key] as string)
				: !isCanonicalProcessString(input[key]),
		);
		if (missing.length > 0) return await executeNativeRecoveryRoute(parameters.operation, "recover", input, defaultCwd, nativeReviewCli, signal);
		if (nativeReviewCli?.targetStatus === undefined) return nativeStatusUnsupported(parameters.operation);
		const frozenTarget = candidateViews?.hasProjection(String(input.predecessorLineage), defaultCwd)
			? candidateViews.resolveProjection(String(input.predecessorLineage), defaultCwd)
			: undefined;
		const statusRequest = {
			cwd: defaultCwd,
			lineageId: String(input.predecessorLineage),
			...(frozenTarget?.committedOnly === true ? { baseRef: frozenTarget.baseCommit, committedOnly: true } : {}),
			...(signal === undefined ? {} : { signal }),
		};
		let status: ReviewStatusV3;
		try {
			status = await nativeReviewCli.targetStatus(statusRequest);
		} catch (error) {
			return nativeStatusFailed(parameters.operation, error);
		}
		const pinnedRecoveryStatus = (candidate: ReviewStatusV3): boolean =>
			candidate.action === "recover"
			&& candidate.actionDisposition === status.actionDisposition
			&& candidate.authority?.lineageId === input.predecessorLineage
			&& candidate.authority?.revision === input.expectedPredecessorRevision
			&& candidate.targetIdentity === status.targetIdentity;
		if (status.action !== "recover" || status.actionDisposition === undefined || status.authority?.lineageId !== input.predecessorLineage || status.authority.revision !== input.expectedPredecessorRevision || !isCanonicalProcessString(status.targetIdentity)) {
			return { operation: parameters.operation, status: "blocked", outcome: "native-recovery-status-mismatch", mutation_performed: false, mutation_outcome: "none", result: status.raw, next_action: "follow-provider-target-status" };
		}
		if (input.disposition !== status.actionDisposition) {
			return { operation: parameters.operation, status: "blocked", outcome: "native-recovery-disposition-mismatch", mutation_performed: false, mutation_outcome: "none", provider_disposition: status.actionDisposition, next_action: "resubmit-with-provider-disposition" };
		}
		const recoverAuthorization = nativeReviewRecoverAuthorization({
			predecessorLineage: String(input.predecessorLineage),
			expectedPredecessorRevision: String(input.expectedPredecessorRevision),
			targetIdentity: status.targetIdentity,
			actor: String(input.actor),
			reason: String(input.reason),
		});
		if (context?.hasUI !== true) throw new Error("Review controller RECOVER requires fresh explicit authorization through the interactive Pi UI; headless execution fails closed");
		const approved = await context.ui.confirm(
			"Authorize destructive review authority RECOVER?",
			[
				"Operation: RECOVER",
				`Provider-selected disposition: ${status.actionDisposition}`,
				"Exact published authorization binding:",
				recoverAuthorization,
				`The native command creates one auditable successor authority (${String(input.successorLineage)}) for this exact predecessor and target identity; the predecessor stays untouched.`,
			].join("\n"),
		);
		if (!approved) throw new Error("Review controller RECOVER was not explicitly authorized");
		// 检查时到使用时：人类可以不受限制地
		// 思考，在此期间权威可能前进、被别人恢复，或
		// 不再符合恢复条件。批准与派生
		// 绑定都钉在批准前的读取上，因此在任何变更
		// 之前会再读一次权威，且必须仍与之精确匹配。
		let confirmedStatus: ReviewStatusV3;
		try {
			confirmedStatus = await nativeReviewCli.targetStatus(statusRequest);
		} catch (error) {
			return nativeStatusFailed(parameters.operation, error);
		}
		if (!pinnedRecoveryStatus(confirmedStatus)) {
			return {
				operation: parameters.operation,
				status: "blocked",
				outcome: "native-recovery-authority-changed",
				native_operation: "review recover",
				mutation_performed: false,
				mutation_outcome: "none",
				result: confirmedStatus.raw,
				next_action: "reinspect-and-reauthorize-recovery",
			};
		}
		return await executeNativeRecoveryRoute(parameters.operation, "recover", { ...input, disposition: status.actionDisposition, maintainerAuthorization: recoverAuthorization }, defaultCwd, nativeReviewCli, signal);
	}
	if (parameters.operation === REVIEW_CONTROLLER_OPERATION.RESET) {
		const input = parseControllerJson(requiredControllerString(parameters, "input"), parameters.operation);
		return await executeNativeRecoveryRoute(parameters.operation, "reclaim", input, defaultCwd, nativeReviewCli, signal);
	}
	if (parameters.operation === REVIEW_CONTROLLER_OPERATION.REPAIR) {
		if (nativeReviewCli?.targetStatus === undefined) return nativeStatusUnsupported(parameters.operation);
		const frozenTarget = parameters.lineageId === undefined || !candidateViews?.hasProjection(parameters.lineageId, defaultCwd) ? undefined : candidateViews.resolveProjection(parameters.lineageId, defaultCwd);
		let status: ReviewStatusV3;
		try {
			status = await nativeReviewCli.targetStatus({ cwd: defaultCwd, ...(parameters.lineageId === undefined ? {} : { lineageId: parameters.lineageId }), ...(frozenTarget?.committedOnly === true ? { baseRef: frozenTarget.baseCommit, committedOnly: true } : {}), ...(signal === undefined ? {} : { signal }) });
		} catch (error) {
			return nativeStatusFailed(parameters.operation, error);
		}
		clearRetainedNativeStatusSelectionsOnTerminal(retainedUntrackedSelections, defaultCwd, status.authority?.lineageId, status.authority?.state); retainNativeCaptureRoutes(retainedUntrackedSelections, defaultCwd, status, frozenTarget?.committedOnly === true ? frozenTarget.baseCommit : undefined);
		if (status.authority?.version === "compact-v2") return { operation: parameters.operation, repaired: false, compact_authority: "immutable-untouched", status: mapNativeTargetStatus(parameters.operation, status, parameters.lineageId) };
		if (status.authority?.version !== "legacy-v1") return mapNativeTargetStatus(parameters.operation, status, parameters.lineageId);
		const store = ReviewTransactionStore.forRepository(defaultCwd);
		store.repairCurrentAuthority();
		return { operation: parameters.operation, repaired: true };
	}
	if (parameters.operation === REVIEW_CONTROLLER_OPERATION.ACKNOWLEDGE_APPROVED) {
		const controllerOnlyInput = ["changeName", "idempotencyKey", "transition", "input", "outputPath", "inputPath", "operationId", "lineageIds", "acknowledgeUntrustedBundleSource"]
			.find((key) => parameters[key as keyof ReviewControllerParameters] !== undefined);
		if (controllerOnlyInput !== undefined || !isCanonicalProcessString(parameters.lineageId)) {
			return {
				operation: parameters.operation,
				status: "blocked",
				outcome: "native-approved-acknowledgement-input-invalid",
				reason: controllerOnlyInput === undefined ? "lineage-invalid" : "controller-only-input",
				...(controllerOnlyInput === undefined ? {} : { field: controllerOnlyInput }),
				mutation_performed: false,
				mutation_outcome: "none",
				next_action: "resubmit-the-exact-lineage-without-controller-only-input",
			};
		}
		const acknowledgementCli = nativeReviewCli as NativeReviewAcknowledgementCli | null;
		if (acknowledgementCli?.targetStatus === undefined) return nativeStatusUnsupported(parameters.operation);
		if (acknowledgementCli.acknowledgeApproved === undefined) {
			return {
				operation: parameters.operation,
				status: "blocked",
				outcome: "native-approved-acknowledgement-unsupported",
				mutation_performed: false,
				mutation_outcome: "none",
				next_action: "install-native-acknowledge-approved-support",
			};
		}
		const frozenTarget = candidateViews?.hasProjection(parameters.lineageId, defaultCwd)
			? candidateViews.resolveProjection(parameters.lineageId, defaultCwd)
			: undefined;
		const target = {
			cwd: defaultCwd,
			lineageId: parameters.lineageId,
			...(frozenTarget?.committedOnly === true ? { baseRef: frozenTarget.baseCommit, committedOnly: true } : {}),
			...readRetainedNativeUntrackedSelection(retainedUntrackedSelections, defaultCwd, parameters.lineageId),
			...(signal === undefined ? {} : { signal }),
		};
		let status: ReviewStatusV3;
		try {
			status = await acknowledgementCli.targetStatus(target);
		} catch (error) {
			return nativeStatusFailed(parameters.operation, error);
		}
		const execute = status.nextTransition?.kind === "execute" ? status.nextTransition.execute : undefined;
		if (
			status.applicability !== "current_target" ||
			status.authority?.lineageId !== parameters.lineageId ||
			status.authority.state !== "approved" ||
			execute?.operation !== "review.acknowledge-approved"
		) {
			return {
				operation: parameters.operation,
				status: "blocked",
				outcome: "native-approved-acknowledgement-not-current",
				result: status.raw,
				mutation_performed: false,
				mutation_outcome: "none",
				next_action: "follow-provider-target-status",
			};
		}
		let argumentTokens: readonly string[];
		try {
			argumentTokens = assertReviewApprovedAcknowledgementExecuteV1(execute, {
				cwd: defaultCwd,
				lineageId: parameters.lineageId,
				targetIdentity: status.targetIdentity,
				revision: status.authority.revision,
			});
		} catch (error) {
			return nativeOperationFailure(parameters.operation, error);
		}
		let acknowledged: NativeReviewAcknowledgeApprovedOutcome | undefined;
		try {
			// gentle-ai #3947：销毁操作以一个绑定到确切
			// lineage、目标与 revision 的 review-acknowledged/v1
			// 封套作答，销毁结果从该封套报告，绝不来自
			// 之后的 STATUS。截至 v2.5.0-rc.3 的每个已发布版本仍
			// 静默销毁，该结果保持逐字节不变。
			// acknowledgeApproved 以 void 表示"静默销毁、无封套"，在此统一为 undefined。
			acknowledged = (await acknowledgementCli.acknowledgeApproved({
				argumentTokens,
				cwd: defaultCwd,
				binding: { lineageId: parameters.lineageId, targetIdentity: status.targetIdentity, revision: status.authority.revision },
				...(signal === undefined ? {} : { signal }),
			})) as NativeReviewAcknowledgeApprovedOutcome | undefined;
		} catch (error) {
			if (!nativeMutationRequiresStatus(error)) return nativeOperationFailure(parameters.operation, error);
			return await reconcileNativeMutationFailure(parameters.operation, error, acknowledgementCli, target, retainedUntrackedSelections);
		}
		// gentle-ai#4003：从这里开始，原生销毁就是已提交的权威
		// 结果。两个 Pi 侧拆除步骤都在变更结果的
		// try/catch 之外运行且各自设防，因此清理失败被
		// 报告为延迟清理，绝不会被报告为失败的确认——
		// 那会诱使对一个已销毁操作的重放。
		const retainedSelectionCleanup = deferredPostBurnCleanup(POST_BURN_CLEANUP.retainedSelection, () => clearRetainedNativeUntrackedSelection(retainedUntrackedSelections, defaultCwd, parameters.lineageId));
		// 注册表负责在移除前恢复其 0555 视图的
		// 可写性；终态 approved 清理会保留 lineage 投影。
		const candidateViewCleanup = deferredPostBurnCleanup(POST_BURN_CLEANUP.candidateView, () => candidateViews?.cleanupTerminal(parameters.lineageId, "approved", defaultCwd));
		// gentle-pi#668：`closed` 在此从不自动派生或记录——
		// 想要走上该路径的父会话，会在其对这一候选的下一次
		// assess 调用中显式传入 nativeReviewOutcome: "closed"。
		return {
			operation: parameters.operation,
			status: "closed",
			outcome: "native-approved-acknowledgement-completed",
			lineage_id: parameters.lineageId,
			target_identity: status.targetIdentity,
			...(acknowledged === undefined ? {} : { consumed_revision: acknowledged.consumedRevision }),
			authority: "burned",
			...(acknowledged === undefined ? {} : { burn_evidence: acknowledged.schema }),
			delivery: "ordinary-repository-policy",
			mutation_performed: true,
			mutation_outcome: "committed",
			...(retainedSelectionCleanup === undefined ? {} : { retained_selection_cleanup: retainedSelectionCleanup }),
			...(candidateViewCleanup === undefined ? {} : { candidate_view_cleanup: candidateViewCleanup }),
		};
	}
	if (parameters.operation === REVIEW_CONTROLLER_OPERATION.ANSWER_CONSENT) {
		const input = parseControllerJson(requiredControllerString(parameters, "input"), parameters.operation);
		if (Object.keys(input).some((key) => key !== "consentBinding" && key !== "answer") || Object.keys(input).length !== 2) throw new Error("Review controller answer-consent input must contain exactly consentBinding and answer");
		if (typeof input.consentBinding !== "string" || input.consentBinding.length === 0) throw new Error("Review controller answer-consent requires an opaque consentBinding");
		if (input.answer !== "granted" && input.answer !== "declined") throw new Error("Review controller answer-consent answer must be granted or declined");
		// gentle-pi#455：仅凭不透明 id 解析绑定，这样
		// 由某个活跃 Pi 会话的 START 创建的绑定，可由任何
		// 出示它的活跃会话应答——而不只是创建它的会话。
		const resolved = pendingReviewConsentRegistry.resolve(input.consentBinding);
		const pending = resolved?.pending;
		const owningSession = resolved?.sessionKey ?? pendingReviewConsentSession;
		if (pending === undefined || pending.expiresAt <= reviewConsentNow()) {
			const disposition = pending === undefined
				? pendingReviewConsentRegistry.staleDisposition(input.consentBinding)
				: PENDING_REVIEW_CONSENT_DISPOSITION.EXPIRED;
			const stale = staleConsentBindingDiagnostics(input.consentBinding, disposition);
			if (pending !== undefined) expirePendingReviewConsent(pending, pendingReviewConsentRegistry, owningSession);
			if (nativeReviewCli?.targetStatus === undefined) return nativeStatusUnsupported(parameters.operation);
			try {
				const negotiated = await negotiatedStatusForHostTransport(nativeReviewCli, {
					cwd: defaultCwd,
					...(signal === undefined ? {} : { signal }),
				}, retainedUntrackedSelections, defaultCwd);
				if (negotiated.transport !== undefined) return hostTransportUnavailable(parameters.operation, negotiated.transport);
				return staleConsentBindingOutcome(parameters.operation, input.consentBinding, stale, negotiated.status!);
			} catch (error) {
				return nativeStatusFailed(parameters.operation, error);
			}
		}
		const answeringRepositoryCwd = realpathSync(defaultCwd);
		if (answeringRepositoryCwd !== pending.repositoryCwd) return consentBindingRepositoryMismatchOutcome(parameters.operation, input.consentBinding, pending.repositoryCwd, answeringRepositoryCwd);
		if (reviewConsentDigest(pending.consent) !== pending.consentDigest) throw new Error("Review controller consent envelope binding changed");
		pending.verifyCandidate();
		if (nativeReviewCli?.answerConsent === undefined) throw new Error("Native review consent follow-up is unavailable");
		if (!consumePendingReviewConsent(pending, pendingReviewConsentRegistry, owningSession)) {
			const stale = staleConsentBindingDiagnostics(
				input.consentBinding,
				pendingReviewConsentRegistry.staleDisposition(input.consentBinding),
			);
			if (nativeReviewCli.targetStatus === undefined) return nativeStatusUnsupported(parameters.operation);
			try {
				const negotiated = await negotiatedStatusForHostTransport(nativeReviewCli, {
					cwd: defaultCwd,
					...(signal === undefined ? {} : { signal }),
				}, retainedUntrackedSelections, defaultCwd);
				if (negotiated.transport !== undefined) return hostTransportUnavailable(parameters.operation, negotiated.transport);
				return staleConsentBindingOutcome(parameters.operation, input.consentBinding, stale, negotiated.status!);
			} catch (error) {
				return nativeStatusFailed(parameters.operation, error);
			}
		}
		try {
			const gated = await resolveReviewModeGate(nativeReviewCli, parameters.operation, defaultCwd, signal);
			if (gated !== undefined) {
				// gentle-pi#668：模式对该确切候选禁用——按其
				// targetIdentity 键控，绝不仅按仓库。
				recordNativeReviewOutcome(pending.authorityCwd, pending.consent.targetIdentity, NATIVE_REVIEW_OUTCOME.UNAVAILABLE);
				cleanupPendingReviewConsent(pending, pendingReviewConsentRegistry, owningSession);
				return gated;
			}
		} catch (error) {
			cleanupPendingReviewConsent(pending, pendingReviewConsentRegistry, owningSession);
			return nativeOperationFailure(parameters.operation, error);
		}
		// 一次性绑定在应答路径第一个 await 之前就被消耗。任何
		// 模糊的 provider 结果都经 STATUS 对账，且绝不能被重放。
		let completed: Record<string, unknown>;
		try {
			const answered = await nativeReviewCli.answerConsent({
				cwd: pending.authorityCwd,
				consent: pending.consent,
				answer: input.answer,
				...(signal === undefined ? {} : { signal }),
			});
			if (answered.kind === "declined") {
				// gentle-pi#668：候选范围的拒绝，按该确切
				// 候选的 targetIdentity 键控，绝不仅按仓库。
				recordNativeReviewOutcome(pending.authorityCwd, pending.consent.targetIdentity, NATIVE_REVIEW_OUTCOME.DECLINED);
				pending.cleanupCandidate();
				return {
					operation: parameters.operation,
					status: "skipped",
					outcome: "consent-declined-this-candidate",
					consent: answered.raw,
					...nativeStartPreAuthorityRejection(),
				};
			}
			retainNativeUntrackedSelection(retainedUntrackedSelections, pending.authorityCwd, answered.start.lineageId, pending.untrackedSelection);
			// gentle-pi#706：经 answer-consent 完成的 START 也消耗了
			// 所采纳的 pre-lineage 选择；像直接路径一样清除它。
			clearRetainedNativeUntrackedSelection(retainedUntrackedSelections, pending.authorityCwd, "");
			completed = completeNativeStart(parameters.operation, answered.start, pending.repositoryCwd, pending.candidateView, pending.candidateViews);
		} catch (error) {
			const value = error as { mutationOutcome?: unknown };
			if (value.mutationOutcome === "none") pending.cleanupCandidate();
			return await reconcileNativeMutationFailure(parameters.operation, error, nativeReviewCli, {
				cwd: pending.authorityCwd,
				...(pending.candidateView.committedOnly ? { baseRef: pending.candidateView.baseCommit, committedOnly: true } : {}),
				projection: "workspace",
			}, retainedUntrackedSelections);
		}
		return completed;
	}
	if (parameters.operation === REVIEW_CONTROLLER_OPERATION.SELECT_INTENDED_UNTRACKED) {
		if (nativeReviewCli?.targetStatus === undefined || nativeReviewCli.start === undefined) return nativeStatusUnsupported(parameters.operation);
		const canonicalBinding = parseCanonicalReviewCaptureBinding(parameters.selectionBinding!);
		let status: ReviewStatusV3;
		try {
			const negotiated = await negotiatedStatusForHostTransport(nativeReviewCli, { cwd: defaultCwd, ...(signal === undefined ? {} : { signal }) }, retainedUntrackedSelections, defaultCwd);
			if (negotiated.transport !== undefined) return hostTransportUnavailable(parameters.operation, negotiated.transport);
			status = negotiated.status!;
		} catch (error) { return nativeStatusFailed(parameters.operation, error); }
		const input = reviewIntendedUntrackedInput(status), eligibleJson = input === undefined ? undefined : exactCollectArgument(input, "eligible_paths_json"), inventory = input === undefined ? undefined : exactCollectArgument(input, "expected_untracked_inventory");
		let eligible: unknown;
		try { eligible = JSON.parse(eligibleJson ?? ""); } catch { eligible = undefined; }
		const scope = parameters.intendedUntracked!.length === 0 ? NATIVE_START_UNTRACKED_SCOPE.EXCLUDE : NATIVE_START_UNTRACKED_SCOPE.SELECT;
		const selected = validateNativeStartUntrackedSelection({ untrackedScope: scope, expectedUntrackedInventory: inventory, intendedUntracked: parameters.intendedUntracked });
		const rejected = input === undefined || canonicalReviewCaptureBinding(input) !== canonicalBinding || exactCollectArgument(input, "target_identity") !== status.targetIdentity || exactCollectArgument(input, "projection") !== status.projection.projection || exactCollectArgument(input, "base_tree") !== status.projection.baseTree || exactCollectArgument(input, "candidate_tree") !== status.projection.currentCandidateTree || !Array.isArray(eligible) || selected.reason !== undefined || selected.intendedUntracked!.some((path) => !eligible.includes(path));
		if (rejected) return { operation: parameters.operation, status: "blocked", outcome: "intended-untracked-selection-binding-rejected", mutation_performed: false, mutation_outcome: "none" };
		const submission = { argumentTokens: input.submission!.argumentTokens, value: JSON.stringify({ schema: "gentle-ai.review-intended-untracked-selection/v1", untracked_scope: scope, expected_untracked_inventory: inventory, intended_untracked: selected.intendedUntracked }) };
		const result = await executeReviewControllerOperation({ operation: REVIEW_CONTROLLER_OPERATION.START, ...(parameters.workspaceRoot === undefined ? {} : { workspaceRoot: parameters.workspaceRoot }), input: JSON.stringify({ mode: REVIEW_MODE.ORDINARY, untrackedScope: scope, expectedUntrackedInventory: inventory, intendedUntracked: selected.intendedUntracked }) }, sessionCwd, nativeReviewCli, signal, candidateViews, context, retainedUntrackedSelections, pendingReviewConsentRegistry, pendingReviewConsentFallbackKey, reviewConsentNow, reviewConsentScheduleTimer, submission);
		return { ...result, operation: parameters.operation };
	}
	if (parameters.operation === REVIEW_CONTROLLER_OPERATION.START) {
		const rawStart = parseControllerJson(
			requiredControllerString(parameters, "input"),
			REVIEW_CONTROLLER_OPERATION.START,
		);
		if (rawStart.mode === REVIEW_MODE.ORDINARY) {
			if ("policyHash" in rawStart) return nativeStartRejection("legacy-policy-hash-unsupported");
			const unknownField = Object.keys(rawStart).find((field) => !["mode", "baseRef", "committedOnly", "policyPath", "focus", "untrackedScope", "expectedUntrackedInventory", "intendedUntracked"].includes(field));
			if (unknownField !== undefined) return nativeStartRejection("unknown-field", unknownField);
			const focus = rawStart.focus;
			if (focus !== undefined && !isNativeStartFocus(focus)) return nativeStartRejection("focus-invalid");
			const policy: NativeStartPolicyValidation = rawStart.policyPath === undefined
				? {}
				: validateNativeStartPolicyPath(defaultCwd, rawStart.policyPath);
			if (policy.reason !== undefined) return nativeStartRejection(policy.reason);
			const baseRef = rawStart.baseRef;
			if (baseRef !== undefined && !isCanonicalProcessString(baseRef)) return nativeStartRejection("base-ref-invalid");
			if (baseRef !== undefined && rawStart.committedOnly !== true) return nativeStartRejection("committed-only-required");
			if (baseRef === undefined && "committedOnly" in rawStart) return nativeStartRejection("committed-only-invalid");
			const explicitUntrackedSelection =
				validateNativeStartUntrackedSelection(rawStart);
			if (explicitUntrackedSelection.reason !== undefined)
				return nativeStartRejection(explicitUntrackedSelection.reason);
			// gentle-pi#706：普通 START 采纳由 inspect
			// untrackedScope 往返在 pre-lineage 保留的选择；显式输入或
			// 携带的提交永远优先于保留条目。
			const retainedPreLineageSelection =
				explicitUntrackedSelection.untrackedScope === undefined &&
				intendedUntrackedSelection === undefined
					? readRetainedPreLineageNativeUntrackedSelection(
							retainedUntrackedSelections,
							defaultCwd,
						)
					: undefined;
			const untrackedSelection: NativeStartUntrackedSelection =
				retainedPreLineageSelection === undefined
					? explicitUntrackedSelection
					: {
							untrackedScope: retainedPreLineageSelection.untrackedScope,
							expectedUntrackedInventory:
								retainedPreLineageSelection.expectedUntrackedInventory,
							intendedUntracked: [...retainedPreLineageSelection.intendedUntracked],
						};
			const untrackedSubmission =
				intendedUntrackedSelection ?? retainedPreLineageSelection?.submission;
			const retainedUntrackedSelection =
				retainedPreLineageSelection ??
				cloneRetainedNativeUntrackedSelection(explicitUntrackedSelection);
			let canonicalBaseRef: string | undefined;
			if (baseRef !== undefined) {
				try {
					canonicalBaseRef = resolveCanonicalCandidateBase(defaultCwd, baseRef as string).commit;
				} catch (error) {
					if (error instanceof CandidateViewError && error.diagnostics !== undefined) return nativeOperationFailure(parameters.operation, Object.assign(error, { candidateViewPreNative: true }));
					if (error instanceof CandidateViewError && (error.reason === "base-ref-ambiguous" || error.reason === "base-ref-unresolvable" || error.reason === "base-ref-moved")) return nativeStartRejection(error.reason);
					return nativeStartRejection("base-ref-unresolvable");
				}
			}
			try {
				const gated = await resolveReviewModeGate(nativeReviewCli, parameters.operation, defaultCwd, signal);
				if (gated !== undefined) return gated;
			} catch (error) {
				return nativeOperationFailure(parameters.operation, error);
			}
			if (nativeReviewCli?.targetStatus === undefined) return nativeStatusUnsupported(parameters.operation);
			let target: ReviewStatusV3;
			try {
				const negotiated = await negotiatedStatusForHostTransport(nativeReviewCli, {
					cwd: defaultCwd,
					...(parameters.lineageId === undefined ? {} : { lineageId: parameters.lineageId }),
					...(canonicalBaseRef === undefined ? {} : { baseRef: canonicalBaseRef, committedOnly: true }),
					...(untrackedSelection.untrackedScope === undefined ? {} : untrackedSelection),
					...(untrackedSubmission === undefined ? {} : { intendedUntrackedSelection: untrackedSubmission }),
					...(signal === undefined ? {} : { signal }),
				}, retainedUntrackedSelections, defaultCwd);
				if (negotiated.transport !== undefined) return hostTransportUnavailable(parameters.operation, negotiated.transport);
				target = negotiated.status!;
				// gentle-pi#874：本 START 已获取的 STATUS 自身就可以
				// 为空工作区候选提供 committed-range START。
				// 就在*这里*采纳其 base commit，在候选视图与原生
				// START 解析之前，并为该范围重新推导目标，
				// 使三者就同一个 base-diff 身份达成一致。晚些采纳
				// 该提议会让工作区目标与 base-diff 候选视图
				// 不一致，START 以 identity-mismatch 失败。显式
				// 调用方 baseRef 与任何带未跟踪选择的 START
				// 都保持今日的单 STATUS 流程；只有采纳提议才付出
				// 第二次只读 STATUS 的代价。
				if (canonicalBaseRef === undefined && untrackedSelection.untrackedScope === undefined && untrackedSubmission === undefined) {
					const offeredBaseRef = offeredCommittedRangeBaseRef(target);
					if (offeredBaseRef !== undefined) {
						const renegotiated = await negotiatedStatusForHostTransport(nativeReviewCli, {
							cwd: defaultCwd,
							...(parameters.lineageId === undefined ? {} : { lineageId: parameters.lineageId }),
							baseRef: offeredBaseRef,
							committedOnly: true,
							...(signal === undefined ? {} : { signal }),
						}, retainedUntrackedSelections, defaultCwd);
						if (renegotiated.transport !== undefined) return hostTransportUnavailable(parameters.operation, renegotiated.transport);
						canonicalBaseRef = offeredBaseRef;
						target = renegotiated.status!;
					}
				}
				if (
					retainedPreLineageSelection !== undefined &&
					!sameNativePreLineageCandidate(retainedPreLineageSelection, target)
				) {
					clearRetainedNativeUntrackedSelection(retainedUntrackedSelections, defaultCwd, "");
					return {
						operation: parameters.operation,
						status: "blocked",
						outcome: "native-start-retained-selection-candidate-mismatch",
						mutation_performed: false,
						mutation_outcome: "none",
						next_action: "inspect-and-resolve-the-current-intended-untracked-selection",
					};
				}
				if (target.nextTransition?.kind === "collect" || target.applicability !== "unrelated" || target.action !== "start") return mapNativeTargetStatus(parameters.operation, target, parameters.lineageId);
			} catch (error) {
				return nativeOperationFailure(parameters.operation, error);
			}
			// gentle-pi#323：重放键必须折入当前候选的
			// 内容身份。没有它，第二次携带相同
			// {cwd, lineageId, input, inputPath} 的 START 会在同意
			// TTL 窗口内复用一个仍存活（从未绑定
			// lineage）的冻结候选视图，即使其下的活候选内容
			// 已改变，并最终死路于 candidate-target-projection-drift
			// 而无恢复。折入 currentCandidateTree 使内容变化
			// 铸出新的重放键——从而新的候选视图——
			// 而不是复用过期视图。
			const replayKey = JSON.stringify({ cwd: defaultCwd, lineageId: parameters.lineageId ?? null, input: parameters.input ?? null, inputPath: parameters.inputPath ?? null, candidateTree: target.projection.currentCandidateTree });
			// 在复用其保留的候选视图之前，同步丢弃任何 TTL
			// 已耗尽的绑定，使新候选的
			// 重试不能复用绑定已过期的视图并触发
			// candidate-target-projection-drift。定时器顺序不得决定
			// 正确性：排队的清理宏任务可能尚未触发。
			pruneExpiredReviewConsents(pendingReviewConsentRegistry, pendingReviewConsentSession, reviewConsentNow);
			const candidateIntendedUntracked = target.projection.intendedUntracked;
			let candidateView: ReturnType<CandidateViewRegistry["create"]> | undefined;
			let nativeStartAttempted = false;
			try {
				const candidateRequest = { contributorRoot: defaultCwd, replayKey, ...(canonicalBaseRef === undefined ? {} : { baseRef: canonicalBaseRef, committedOnly: true }) };
				candidateView = candidateViews?.createOrReuse({ ...candidateRequest, ...(candidateIntendedUntracked.length === 0 ? {} : { intendedUntracked: candidateIntendedUntracked }) });
				if (candidateView !== undefined && candidateIntendedUntracked.length === 0 && candidateView.candidateTree !== target.projection.currentCandidateTree) {
					candidateView.cleanup();
					candidateView = candidateViews?.createOrReuse({ ...candidateRequest, intendedUntracked: [] });
				}
				if (candidateView !== undefined) assertNativeStartCandidateBinding(candidateView, target);
				let result: NativeStartResult;
				try {
					nativeStartAttempted = true;
					result = await nativeReviewCli.start({
						cwd: defaultCwd,
						...(canonicalBaseRef === undefined
							? {}
							: { baseRef: candidateView?.baseCommit ?? canonicalBaseRef, committedOnly: true }),
						targetIdentity: target.targetIdentity,
						projection: target.projection.projection,
						...(untrackedSelection.untrackedScope === undefined ? {} : untrackedSelection),
						...(untrackedSubmission === undefined ? {} : { intendedUntrackedSelection: untrackedSubmission }),
						...(parameters.lineageId === undefined ? {} : { lineageId: parameters.lineageId }),
						...(policy.policyPath === undefined ? {} : { policyPath: policy.policyPath }),
						...(focus === undefined ? {} : { focus: focus as string }),
						...(signal === undefined ? {} : { signal }),
					});
				} catch (error) {
					if (!(error instanceof NativeReviewConsentRequiredError)) throw error;
					if (candidateView === undefined) throw new CandidateViewError("native consent requires a frozen candidate view");
					const consentCandidateView = candidateView;
					const repositoryCwd = realpathSync(defaultCwd);
					const consentDigest = reviewConsentDigest(error.consent);
					const pendingReviewConsents = pendingReviewConsentRegistry.get(pendingReviewConsentSession);
					const existing = [...(pendingReviewConsents?.values() ?? [])].find((pending) => pending.repositoryCwd === repositoryCwd && pending.candidateView.token === consentCandidateView.token && pending.consentDigest === consentDigest && pending.expiresAt > reviewConsentNow());
					if (existing === undefined) {
						for (const pending of [...(pendingReviewConsents?.values() ?? [])]) {
							if (pending.candidateView.token === consentCandidateView.token) {
								discardPendingReviewConsent(pending, pendingReviewConsentRegistry, pendingReviewConsentSession);
							}
						}
					}
					const id = existing?.id ?? randomUUID();
					if (existing === undefined) {
						let candidateCleaned = false;
						const pending: PendingReviewConsent = {
							id,
							repositoryCwd,
							authorityCwd: defaultCwd,
							candidateView: consentCandidateView,
							candidateViews,
							verifyCandidate: () => consentCandidateView.verify(),
							cleanupCandidate: () => {
								if (candidateCleaned) return;
								candidateCleaned = true;
								try { consentCandidateView.cleanup(); } catch { /* 所有权证明失败时保留视图；同意过期/拆除仍会完成。 */ }
							},
							...(retainedUntrackedSelection === undefined ? {} : { untrackedSelection: retainedUntrackedSelection }),
							consent: error.consent,
							consentDigest,
							expiresAt: reviewConsentNow() + PENDING_REVIEW_CONSENT_TTL_MS,
						};
						pendingReviewConsentRegistry.add(pendingReviewConsentSession, pending);
						pending.expiry = reviewConsentScheduleTimer(
							() => expirePendingReviewConsent(pending, pendingReviewConsentRegistry, pendingReviewConsentSession),
							PENDING_REVIEW_CONSENT_TTL_MS,
						);
						pending.expiry.unref();
					}
					return {
						operation: parameters.operation,
						status: "blocked",
						outcome: "native-review-consent-required",
						consent: error.consent.raw,
						consent_binding: id,
						...nativeStartPreAuthorityRejection(),
					};
				}
				retainNativeUntrackedSelection(retainedUntrackedSelections, defaultCwd, result.lineageId, retainedUntrackedSelection);
				// gentle-pi#706：被采纳的 pre-lineage 选择随消耗它的
				// START 一同消亡；绝不能泄漏给下一个候选。
				clearRetainedNativeUntrackedSelection(retainedUntrackedSelections, defaultCwd, "");
				return completeNativeStart(parameters.operation, result, defaultCwd, candidateView, candidateViews);
			} catch (error) {
				if (!nativeStartAttempted && error instanceof CandidateViewError && error.diagnostics !== undefined) return nativeOperationFailure(parameters.operation, Object.assign(error, { candidateViewPreNative: true }));
				if (error instanceof CandidateViewError && (error.reason === "base-ref-ambiguous" || error.reason === "base-ref-unresolvable" || error.reason === "base-ref-moved")) return nativeStartRejection(error.reason);
				const value = error as { mutationOutcome?: unknown; nextAction?: unknown };
				const provenNoMutation = value.mutationOutcome === "none";
				const preNativeFailure = !nativeStartAttempted;
				if (candidateView && candidateViews && (provenNoMutation || preNativeFailure)) candidateViews.cleanup(candidateView.token);
				const nativeCliError = asNativeReviewCliError(error);
				const failure = provenNoMutation
					? error
					: preNativeFailure
						? error instanceof CandidateViewError ? Object.assign(error, { candidateViewPreNative: true }) : error
						: Object.assign(
							error instanceof Error
								? error
								: nativeCliError === undefined
									? new Error(String(error))
									: { name: "NativeReviewCliError", code: nativeCliError.code, diagnostics: nativeCliError.diagnostics },
							{ mutationOutcome: "unknown", nextAction: "review.status" },
						);
				return reconcileNativeMutationFailure(parameters.operation, failure, nativeReviewCli, {
					cwd: defaultCwd,
					...(parameters.lineageId === undefined ? {} : { lineageId: parameters.lineageId }),
					...(canonicalBaseRef === undefined ? {} : { baseRef: candidateView?.baseCommit ?? canonicalBaseRef, committedOnly: true }),
					...(untrackedSelection.untrackedScope === undefined ? {} : untrackedSelection),
					projection: "workspace",
				}, retainedUntrackedSelections);
			}
		}
		if (rawStart.mode === REVIEW_MODE.ORDINARY) {
			return nativeStatusUnsupported(parameters.operation);
		}
		const idempotencyKey = requiredControllerString(parameters, "idempotencyKey");
		if (typeof parameters.lineageId !== "string" || parameters.lineageId.trim().length === 0) {
			throw new Error("Judgment Day graph-v1 START requires lineageId");
		}
		const input = parseStartInput(rawStart);
		const snapshot = captureReviewSnapshot({
			cwd: defaultCwd,
			mode: input.mode,
			projection: input.projection,
			policyHash: input.policyHash,
		});
		const stateInput = {
			lineageId: parameters.lineageId,
			mode: input.mode,
			snapshot,
			evidenceHash: input.evidenceHash,
			budget: input.budget,
		};
		const state = createReviewState(
			input.parentLineageId === undefined
				? stateInput
				: { ...stateInput, parentLineageId: input.parentLineageId },
		);
		const store = ReviewTransactionStore.forRepository(defaultCwd);
		let result: StartOperationResultV1;
		try {
			result = store.create(state, idempotencyKey);
		} catch (error) {
			if (!(error instanceof Error) || error.message !== "Graph lineage already exists") throw error;
			const current = store.read(parameters.lineageId!);
			const existing = current.request_journal.find((entry) => entry.idempotency_key === idempotencyKey);
			if (
				existing?.operation !== REVIEW_OPERATION.START ||
				existing.request_hash !== canonicalHash(state) ||
				existing.status !== JOURNAL_STATUS.COMPLETED
			) {
				throw new Error("Idempotency key was reused with a different START request; replay requires the same lineageId, idempotencyKey, and exact request");
			}
			result = existing.canonical_result as StartOperationResultV1;
		}
		return { operation: parameters.operation, result, state };
	}
	if (parameters.operation === REVIEW_CONTROLLER_OPERATION.ADVANCE) {
		const idempotencyKey = requiredControllerString(parameters, "idempotencyKey");
		const transitionValue = requiredControllerString(parameters, "transition");
		if (!isReviewTransition(transitionValue)) {
			throw new Error(`Review controller transition is unsupported: ${transitionValue}`);
		}
		const hasInput = parameters.input !== undefined;
		const hasInputPath = parameters.inputPath !== undefined;
		if (hasInput === hasInputPath) {
			throw new Error("Review controller advance requires exactly one of input or inputPath");
		}
		const rawInput = parseControllerJson(
			hasInput
				? requiredControllerString(parameters, "input")
				: readRepositoryControllerInput(requiredControllerString(parameters, "inputPath"), defaultCwd),
			REVIEW_CONTROLLER_OPERATION.ADVANCE,
		);
		const store = ReviewTransactionStore.forRepository(defaultCwd);
		if (store.read(parameters.lineageId!).mode === REVIEW_MODE.ORDINARY) {
			throw new Error(GRAPH_V1_ORDINARY_READ_ONLY);
		}
		const result = store.runReducerOperation({
			lineageId: parameters.lineageId,
			transition: transitionValue,
			idempotencyKey,
			input: rawInput as unknown as ReviewReducerInput,
		});
		return {
			operation: parameters.operation,
			result,
			state: store.read(parameters.lineageId),
		};
	}
	if (parameters.operation === REVIEW_CONTROLLER_OPERATION.STATUS) {
		const rawStatus = parameters.input === undefined
			? undefined
			: parseControllerJson(parameters.input, REVIEW_CONTROLLER_OPERATION.STATUS);
		const unknownField = rawStatus === undefined
			? undefined
			: Object.keys(rawStatus).find((field) => !["baseRef", "committedOnly", "untrackedScope", "expectedUntrackedInventory", "intendedUntracked"].includes(field));
		if (unknownField !== undefined) return nativeStatusInputRejection("unknown-field", unknownField);
		const baseRef = rawStatus?.baseRef;
		if (baseRef !== undefined && !isCanonicalProcessString(baseRef)) return nativeStatusInputRejection("base-ref-invalid");
		if (baseRef !== undefined && rawStatus?.committedOnly !== true) return nativeStatusInputRejection("committed-only-required");
		if (baseRef === undefined && rawStatus !== undefined && "committedOnly" in rawStatus) return nativeStatusInputRejection("committed-only-invalid");
		const untrackedSelection = rawStatus === undefined ? {} : validateNativeStartUntrackedSelection(rawStatus);
		if (
			rawStatus !== undefined &&
			(untrackedSelection.reason !== undefined || (baseRef === undefined && untrackedSelection.untrackedScope === undefined))
		) return nativeStatusInputRejection(untrackedSelection.reason ?? "untracked-selection-invalid");
		const retainedUntrackedSelection = cloneRetainedNativeUntrackedSelection(untrackedSelection);
		const effectiveUntrackedSelection = rawStatus === undefined && parameters.lineageId !== undefined
			? readRetainedNativeUntrackedSelection(retainedUntrackedSelections, defaultCwd, parameters.lineageId)
			: untrackedSelection;
		const retainedCommittedTarget = rawStatus === undefined && parameters.lineageId !== undefined && candidateViews?.hasProjection(parameters.lineageId, defaultCwd)
			? candidateViews.resolveProjection(parameters.lineageId, defaultCwd)
			: undefined;
		const effectiveBaseRef = baseRef ?? (retainedCommittedTarget?.committedOnly === true ? retainedCommittedTarget.baseCommit : undefined);
		if (nativeReviewCli?.targetStatus !== undefined) {
			try {
				const negotiated = await negotiatedStatusForHostTransport(nativeReviewCli, {
					cwd: defaultCwd,
					...(parameters.lineageId === undefined ? {} : { lineageId: parameters.lineageId }),
					// baseRef 的进程字符串规范已在上方 isCanonicalProcessString 校验背书。
					...(effectiveBaseRef === undefined ? {} : { baseRef: effectiveBaseRef as string, committedOnly: true }),
					...(effectiveUntrackedSelection.untrackedScope === undefined ? {} : { untrackedScope: effectiveUntrackedSelection.untrackedScope, expectedUntrackedInventory: effectiveUntrackedSelection.expectedUntrackedInventory, intendedUntracked: effectiveUntrackedSelection.intendedUntracked }),
					...(signal === undefined ? {} : { signal }),
				}, retainedUntrackedSelections, defaultCwd);
				if (negotiated.transport !== undefined) {
					return {
						...hostTransportUnavailable(parameters.operation, negotiated.transport),
						...(includeWorkspaceRoot ? { workspace_root: defaultCwd } : {}),
					};
				}
				const status = negotiated.status!;
				if (
					retainedUntrackedSelection !== undefined &&
					parameters.lineageId !== undefined &&
					status.applicability === "current_target" &&
					status.authority?.lineageId === parameters.lineageId
				) retainNativeUntrackedSelection(retainedUntrackedSelections, defaultCwd, parameters.lineageId, retainedUntrackedSelection);
				clearRetainedNativeStatusSelectionsOnTerminal(retainedUntrackedSelections, defaultCwd, status.authority?.lineageId, status.authority?.state);
				hydrateDispatchBindingFromStatus(candidateViews, defaultCwd, status);
				return { ...mapNativeTargetStatus(parameters.operation, status, parameters.lineageId), ...(includeWorkspaceRoot ? { workspace_root: defaultCwd } : {}) };
			} catch (error) {
				return nativeOperationFailure(parameters.operation, error);
			}
		}
		return nativeStatusUnsupported(parameters.operation);
	}
	throw new Error(`Review controller operation is unsupported: ${parameters.operation}`);
}

/** @internal */
export const __testing = {
	resolveReviewModeGate,
	readEffectiveModelConfig,
	readEffectiveModelConfigAsync,
	listAgentsFromDir,
	listAgentsFromDirAsync,
	listDiscoverableAgents,
	orderDiscoverableAgents,
	classifyGuardedCommand,
	evaluateGuardedCommand,
	guardedCommandPreview,
	guardedCommandTitle,
	loadRuntimeGuardrailsConfig,
	buildGentlePrompt,
	nativeStatusUnsupported,
	executeReviewControllerOperation,
	executeReviewCaptureOperation,
	executeReviewCaptureGroupOperation,
	setReviewHostRelayRunnerForTesting,
	setReviewHostRelayGroupRunnersForTesting,
	clearReviewTransportProbeForTesting,
	renderSddModelPanel: renderSddModelPanelForTesting,
	getOrchestratorPrompt,
	renderOrchestratorPrompt,
	loadReviewContractPromptFragment,
	readMirroredReviewContractFragment,
	loadBackgroundSubagentsPolicy,
	resolveBackgroundSubagentsPolicy,
	renderBackgroundSubagentsReport,
	writeGlobalBackgroundSubagentsPolicy,
	parseBackgroundSubagentsPolicyFile,
	resolveBackgroundSubagentsCapability,
	readActiveToolNames,
	renderBackgroundSubagentsStatusLine,
	renderRddStatusLine,
	isValidRddModeStatus,
	resolveRddModeStatus,
	resolveRddStatusLine,
	RDD_STATUS_TIMEOUT_MS,
	RDD_STATUS_MEMO_TTL_MS,
	clearRddStatusMemoForTesting,
	readNativeReviewOutcome,
	recordNativeReviewOutcome,
	clearNativeReviewOutcomeMemoForTesting,
	resolveControllerSddStatus,
	resolveStartupControllerSddStatus,
	resolveSddChangeStartup,
	resolveSelectedNativeSddChangeStartup,
	readSddChangeFlag,
	createJeroAiExtension: createJeroAiExtensionForTesting,
};

function resolveControllerSddStatus(
	cwd: string,
	changeName: string | undefined,
	includeInstructions: boolean,
	artifactStore: SddPreflightPreferences["artifactStore"] | undefined,
) {
	return resolveSddStatus({ cwd, changeName, includeInstructions, artifactStore });
}

function resolveStartupControllerSddStatus(
	cwd: string,
	changeName: string | undefined,
	includeInstructions: boolean,
	artifactStore: SddPreflightPreferences["artifactStore"] | undefined,
) {
	return resolveControllerSddStatus(cwd, changeName, includeInstructions, artifactStore);
}

export interface JeroRuntimeDependencies {
	nativeReviewCli?: NativeReviewCli | null;
	candidateViews?: CandidateViewRegistry | null;
	// 注入的注册表让测试与宿主集成获得显式所有权；
	// 正常的包注册共享模块本地的进程内存注册表。
	pendingReviewConsentRegistry?: PendingReviewConsentRegistry;
	// 同意绑定 TTL 时钟的确定性测试接缝。生产
	// 两者均保持 undefined，让同意路径观察真实墙钟时间；
	// 测试注入假时钟，使过期可观察，而无需 10 分钟
	// 睡眠，也不依赖排队的清理宏任务触发。
	now?: () => number;
	scheduleTimer?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
	// 会话子进程继承的环境；测试注入一个
	// 普通对象，使握手声明可观察，而无需
	// 触碰测试运行器自己的 process.env。
	processEnv?: NodeJS.ProcessEnv;
	// 包自有子进程仅通过这条父绑定的通道询问
	// 自己待定的普通 START 能否在本地重放授权。
	childStandingReviewPermissionClient?: Pick<ChildStandingReviewPermissionClient, "requestAuthorization" | "close">;
}

export function createJeroAiExtension(dependencies: JeroRuntimeDependencies = {}): (pi: ExtensionAPI) => void {
	return createJeroAiExtensionForTesting(dependencies);
}

function createJeroAiExtensionForTesting(
	dependencies: JeroRuntimeDependencies = {},
): (pi: ExtensionAPI) => void {
	// P4c/P4d：默认 CLI 是保守失败的 P1 桩，带 SDD 投影
	// 对、评审读路径、RDD 模式对、SDD 尝试对，以及
	// （P4d-e）START 对——直接启动与同意仪式——由
	// jero 权威在进程内提供（lib/jero-authority-cli.ts）。
	const nativeReviewCli = dependencies.nativeReviewCli === undefined
		? createJeroAuthorityReviewCli() as unknown as NativeReviewCli
		: dependencies.nativeReviewCli;
	const childStandingReviewPermissionLease = dependencies.childStandingReviewPermissionClient === undefined
		? acquireChildStandingReviewPermissionClient(dependencies.processEnv ?? process.env)
		: undefined;
	const childStandingReviewPermission = dependencies.childStandingReviewPermissionClient ?? childStandingReviewPermissionLease?.client;
	const reviewConsentNow = dependencies.now ?? (() => Date.now());
	const reviewConsentScheduleTimer = dependencies.scheduleTimer ?? ((callback, delayMs) => setTimeout(callback, delayMs));
	const pendingReviewConsentRegistry = dependencies.pendingReviewConsentRegistry ?? processPendingReviewConsentRegistry;
	guardrailsProcessEnv = dependencies.processEnv ?? process.env;
	return function gentleAi(pi: ExtensionAPI): void {
		const flags = pi as unknown as { registerFlag?: (name: string, definition: { description: string; type: "string"; default?: string }) => void };
		flags.registerFlag?.(SDD_CHANGE_FLAG, {
			description: "Internal launch-local selected SDD change identity for package-owned child agents.",
			type: "string",
		});
	const pendingReviewConsentFallbackKey = Symbol("pending-review-consent-fallback");
	const candidateViews = dependencies.candidateViews === undefined ? new CandidateViewRegistry() : dependencies.candidateViews;
	const herdrLifecycle = createHerdrConfirmationLifecycle(pi.events);
	const permissionEnvironment = dependencies.processEnv ?? process.env;

	const setReviewSessionPermissionStatus = (context: ExtensionContext, active: boolean): void => {
		try {
			(context.ui as unknown as { setStatus?: (key: string, text?: string) => void }).setStatus?.(
				REVIEW_SESSION_PERMISSION_STATUS_KEY,
				active ? REVIEW_SESSION_PERMISSION_STATUS_TEXT : undefined,
			);
		} catch { /* 状态显示是非阻塞的，也绝不是权限权威。 */ }
	};
	const capturePermissionIdentity = (context: ExtensionContext, cwd: string = context.cwd): Promise<ReviewSessionIdentity | undefined> =>
		captureReviewSessionIdentity({ ...context, cwd }, permissionEnvironment);
	const refreshReviewSessionPermissionStatus = async (context: ExtensionContext): Promise<ReviewSessionIdentity | undefined> => {
		const identity = await capturePermissionIdentity(context);
		setReviewSessionPermissionStatus(context, identity !== undefined && hasReviewSessionPermission(identity));
		return identity;
	};
	const revokeCurrentReviewSessionPermission = (context: ExtensionContext): boolean => {
		const coordinates = reviewSessionManagerAndId(context);
		const revoked = coordinates === undefined ? false : revokeReviewSessionPermissionsForSession(coordinates.manager, coordinates.sessionId);
		setReviewSessionPermissionStatus(context, false);
		return revoked;
	};
	const revokeCurrentRepositoryReviewSessionPermission = async (context: ExtensionContext): Promise<boolean> => {
		const identity = await capturePermissionIdentity(context);
		const revoked = identity === undefined ? false : revokeReviewSessionPermission(identity);
		setReviewSessionPermissionStatus(context, false);
		return revoked;
	};

	let reminderSessionActive = true;
	let reminderEpoch = 0;
	pi.on("session_shutdown", (event, context) => {
		reminderSessionActive = false;
		reminderEpoch += 1;
		// Pi 在 reload 以及会话替换/退出时都会拆除该注册表。
		try { candidateViews?.cleanupAll(); } catch { /* 保留失败的自有视图以便稍后恢复。 */ }
		const reason = (event as { reason?: unknown }).reason;
		if (reason !== "reload") {
			if (childStandingReviewPermissionLease !== undefined) childStandingReviewPermissionLease.closeIfCurrent();
			else childStandingReviewPermission?.close();
			revokeCurrentReviewSessionPermission(context);
		}
		const sessionKey = pendingReviewConsentSessionKey(context, pendingReviewConsentFallbackKey);
		cleanupAllPendingReviewConsents(pendingReviewConsentRegistry, sessionKey);
		processRetainedNativeStatusSelections.delete(sessionKey);
		processAgentEndSubagentDepth.delete(sessionKey);
	});

	pi.registerTool({
		name: "jero_review_scope",
		renderShell: "self",
		label: "Gentle Review Scope",
		description: "Read one bounded, integrity-checked page of the controller-owned frozen changed scope. This read-only tool never inspects the ambient or candidate tree.",
		parameters: REVIEW_SCOPE_PARAMETERS,
		executionMode: "parallel",
		renderCall(_args, theme, context) {
			return renderJeroLifecycleCall(
				"review scope",
				theme,
				context as JeroRenderContext | undefined,
			);
		},
		renderResult(result, options, theme, context) {
			return renderJeroResult(result, options, theme, context as JeroRenderContext | undefined);
		},
		async execute(_toolCallId, parameters) {
			const input = parameters as ReviewScopeParameters;
			const details = readCandidateContextManifestPage(input.manifest, input.sha256, input.cursor ?? 0);
			return { content: [{ type: "text", text: JSON.stringify(details) }], details };
		},
	});

	// 评审者捕获运行的镜头位于其 collect 绑定内，因此
	// 卡片可以显示 "review capture · risk" 而不是光秃秃的操作名。
	const lensLabel = (lens: unknown): string | undefined =>
		typeof lens === "string" && lens.length > 0 ? lens.replace(/^review-/, "") : undefined;
	const collectBindingLens = (binding: unknown): string | undefined => {
		if (typeof binding !== "string") return undefined;
		try {
			const parsed = JSON.parse(binding) as Record<string, unknown>;
			const subject = (parsed.artifactSubject ?? parsed.artifact_subject) as Record<string, unknown> | undefined;
			return lensLabel(subject?.lens);
		} catch {
			return undefined;
		}
	};
	const withLenses = (operation: string, lenses: readonly (string | undefined)[]): string => {
		const named = lenses.filter((lens): lens is string => lens !== undefined);
		return named.length === 0 ? operation : `${operation} · ${named.join(" · ")}`;
	};

	pi.registerTool({
		name: "jero_review_capture_group",
		renderShell: "self",
		label: "Gentle Review Capture Group",
		description: "Capture one complete provider-issued materialize reviewer group. It validates the exact ordered current collect set, forecasts its bounded model cost, runs reviewers concurrently, and admits outputs one at a time in provider order.",
		promptSnippet: "Use one complete exact current STATUS materialize reviewer group; acknowledge its forecast before the grouped run.",
		promptGuidelines: [
			"Pass only lineageId, the complete ordered collectBindings array from one current STATUS result, and reviewerRunAcknowledged after its forecast. Never mix, reorder, duplicate, or partially select bindings.",
			"The group materializes and runs independent reviewers concurrently, but rechecks STATUS before every provider-ordered submission. It stops on a closure, correction, drift, or uncertain capture outcome; it never follows another transition or replays a prepared output.",
		],
		parameters: REVIEW_CAPTURE_GROUP_PARAMETERS,
		executionMode: "sequential",
		renderCall(args, theme, context) {
			const bindings = (args as { collectBindings?: unknown }).collectBindings;
			const lenses = Array.isArray(bindings) ? bindings.map(collectBindingLens) : [];
			return renderJeroLifecycleCall(withLenses("review capture group", lenses), theme, context as JeroRenderContext | undefined);
		},
		renderResult(result, options, theme, context) {
			return renderJeroResult(result, options, theme, context as JeroRenderContext | undefined);
		},
		async execute(_toolCallId, parameters, signal, _onUpdate, ctx) {
			if (signal?.aborted) throw new Error("Review capture group was cancelled");
			const details = await executeReviewCaptureGroupOperation(
				parameters,
				ctx.cwd,
				nativeReviewCli,
				signal,
				candidateViews,
				((sessionKey: PendingReviewConsentSessionKey) => processRetainedNativeStatusSelections.get(sessionKey) ?? processRetainedNativeStatusSelections.set(sessionKey, new Map()).get(sessionKey)!)(pendingReviewConsentSessionKey(ctx, pendingReviewConsentFallbackKey)),
				true,
			);
			return { content: [{ type: "text", text: JSON.stringify(details) }], details };
		},
	});

	pi.registerTool({
		name: "jero_review_capture",
		renderShell: "self",
		label: "Gentle Review Capture",
		description: "Capture exactly one provider-issued ordinary native review collect slot. This is not a controller operation: it validates one opaque collect binding against current target-scoped STATUS, executes at most one capture, and never follows a transition.",
		promptSnippet: "Use one exact current STATUS collectBinding for one ordinary native capture; call fresh STATUS before every additional capture.",
		promptGuidelines: [
			"Pass only lineageId, the JSON-serialized exact collectBinding from current STATUS, and the route-specific optional acknowledgement or correctionLines value. Never compose provider argument tokens, prompts, results, verdicts, or lens arrays.",
			"A materialize reviewer slot first forecasts one model run; re-submit that same exact binding with reviewerRunAcknowledged: true to authorize one host relay. Correction-plan slots require correctionLines inside the provider-issued bounds, counted in diff lines (one replaced source line is one deletion plus one addition) — a different unit from the frozen logical correction budget. Refuter and validation vectors execute exactly once as provider-rendered.",
			"A native terminal closure or nonterminal capture returns directly. Do not expect automatic STATUS, FINALIZE, receipt, delivery, or another capture; call fresh STATUS before any next capture.",
		],
		parameters: REVIEW_CAPTURE_PARAMETERS,
		executionMode: "sequential",
		renderCall(args, theme, context) {
			return renderJeroLifecycleCall(
				withLenses("review capture", [collectBindingLens((args as { collectBinding?: unknown }).collectBinding)]),
				theme,
				context as JeroRenderContext | undefined,
			);
		},
		renderResult(result, options, theme, context) {
			return renderJeroResult(result, options, theme, context as JeroRenderContext | undefined);
		},
		async execute(_toolCallId, parameters, signal, _onUpdate, ctx) {
			if (signal?.aborted) throw new Error("Review capture was cancelled");
			const details = await executeReviewCaptureOperation(
				parameters,
				ctx.cwd,
				nativeReviewCli,
				signal,
				candidateViews,
				((sessionKey: PendingReviewConsentSessionKey) => processRetainedNativeStatusSelections.get(sessionKey) ?? processRetainedNativeStatusSelections.set(sessionKey, new Map()).get(sessionKey)!)(pendingReviewConsentSessionKey(ctx, pendingReviewConsentFallbackKey)),
				true,
			);
			return {
				content: [{ type: "text", text: JSON.stringify(details) }],
				details,
			};
		},
	});

	pi.registerTool({
		name: "jero_review",
		renderShell: "self",
		label: "Jero Review Controller",
		description:
			"Inspect and recover review authority and start native ordinary review. Ordinary capture is available only through the separate jero_review_capture tool. Review outcomes never authorize delivery: commit, push, pull-request, and release commands follow ordinary repository policy. RESET/RECOVER remain destructive and are executed by the audited in-process authority.",
		promptSnippet: "Inspect authority, then start native ordinary review; use jero_review_capture for one current collect slot",
		promptGuidelines: [
			'Call {"operation":"inspect"} before START. New native ordinary START uses a JSON string such as "{\\"mode\\":\\"ordinary\\"}"; an explicit baseRef must be paired with committedOnly: true to request a committed range, while policyPath remains repository-local. policyHash is legacy compact-only. The controller derives lineage, Git/untracked scope, tier, lenses, authored lines, and budget; the frozen correction budget counts logical corrections, while correction-plan correctionLines count diff lines (one replaced source line is one deletion plus one addition).',
			'An inspect blocked on the intended-untracked selection returns nextStep naming the exact continuation: call select-intended-untracked with the returned selectionBinding, or call inspect again with top-level untrackedScope ("exclude", or "select" with intendedUntracked) to resolve the round trip in one call; the retained selection is adopted by the next plain START.',
			"Use RECONCILE_AUTHORITY only to quarantine one invalid native recovery successor. Supply exact predecessorLineage, expectedPredecessorRevision, successorLineage, expectedSuccessorRevision, actor, and reason values; Pi derives and displays the seven-line native authorization binding for fresh UI approval. The predecessor stays untouched, native returns the durable audit record, and Pi never falls back to RESET or RECOVER.",
			"Use ABANDON only after an explicit user decision and with exact native inputs: lineage, expectedRevision, snapshotIdentity, capturedLensResults, findingsPresent, actor, and reason. A dual reconciliation may supply only anomalies `unchanged_target,malformed_recovery_authorization` in that exact order. The legacy quarantine and alias-repair routes are retired: a jero-pi store never carries legacy authority, so invalid recovery successors go through RECONCILE_AUTHORITY and a malformed lineage goes through reclaim. `review dispose-result` is unsupported pending design.",
			"Lens, refuter, and validator verdicts are admitted natively, never Pi-authored. Use jero_review_capture with exactly one current provider-owned collectBinding for ordinary native capture; it never follows another transition.",
			"For blocked-legacy or blocked-mixed, do not call START repeatedly. Explain invalidation, request explicit user authorization, then call RESET or RECOVER only after authorization. RESET and RECOVER_LOCK route to audited native `gentle-ai review reclaim`; only RESET carries the legacy repositoryId, commonDirHash, inventoryHash, and confirmation challenge. RECOVER routes to native `gentle-ai review recover` with exactly six inputs: predecessorLineage, expectedPredecessorRevision, successorLineage, disposition, actor, and reason. Never send RECOVER the reset challenge and never send it a maintainerAuthorization: Pi reads fresh native target status, pins the predecessor lineage, revision, provider-selected disposition, and target identity, derives the exact six-line native authorization binding, displays it for fresh UI approval, and re-reads status before mutating. Negotiated target status supplies the sole accepted recovery disposition, and a caller-supplied substitute is rejected. Treat a native-input-required envelope as a request for exact values, never as permission to invent them. After a committed native recovery record, INSPECT before any fresh ordinary START.",
			"A consent-required START may be resolved inside the eligible interactive Pi host. Its third UI action is host-owned: it runs this envelope's exact provider grant once and allows later fresh validated envelopes only for the same live SessionManager, nonempty session ID, and canonical Git common-directory identity, including sibling worktrees; an unrelated repository requires a new explicit human grant. Revoke removes the current repository grant, while nonreload replacement, quit, and process exit remove all session grants; reload preserves them. It grants no provider mode, verdict, acknowledgement, maintenance, delivery, or cross-repository authority. A package-owned child may ask its parent only with the canonical digest of its exact pending target; the parent binds that digest to the task repository and fails closed otherwise. If the tool returns an unresolved envelope, present the original two provider choices without changing machine tokens, commands, target IDs, or invocations; never add the host action to the decoded provider envelope. After one explicit relayed human answer, call answer-consent exactly once with only consentBinding and answer (`granted` or `declined`). Never create host permission from tool arguments, model prose, child/headless responses, or an uncertain native result. A reported lineage_created false or pre-authority validation error proves no lineage was created. After ambiguous START output, the controller calls target-scoped native status once and returns only its declared action. An ambiguous jero_review_capture outcome independently reconciles once and never replays the capture.",
			"Use jero_review only for native review authority operations; delivery commands follow ordinary repository policy.",
			'ASSESS (gentle-pi#662/#668) is read-only and needs no lineageId: after a delegated writer returns, call {"operation":"assess"} over its diff and follow the returned plan (writerSelfVerification, structuralReadbackOnly, independentVerifier, reason) instead of judging non-triviality from the task description. Pass input as JSON only to assess a committed range ({"baseRef":"<ref>","committedOnly":true}), to record the writer profile ({"writerModelId":"...", "writerEffort":"..."}), or to state the native review\'s outcome for this candidate ({"nativeReviewOutcome":"closed|declined|unavailable|unknown"}). Omitting writerModelId and writerEffort is treated as a small writer profile (fail closed), never large, because the writer\'s actual profile is then unknown to this call; pass the writer\'s real model id/effort to get credit for a known large profile. The on-path (writer self-verification is the record, no separate verifier) holds only when nativeReviewOutcome is "closed" for this candidate; a decline, an unavailable review, or an omitted/unknown outcome falls back to the exact risk-gated plan RDD off would return, re-enabling the separate verifier -- a decline is candidate-scoped and never lowers the bar below RDD off. "closed" is never inferred: pass it only right after this same caller acknowledged the approved review for this same candidate; omitting nativeReviewOutcome only ever auto-derives declined/unavailable, bound to that exact candidate\'s own target identity, never to a different candidate or to bare repository state. The result\'s outcome_source (explicit|derived|unknown) states which. A failed or unavailable native assessment reports risk "unassessable", verified exactly like "high". This never mutates review authority state.',
		],
		parameters: REVIEW_CONTROLLER_PARAMETERS,
		executionMode: "sequential",
		renderCall(args, theme, context) {
			return renderJeroLifecycleCall(
				reviewToolOperationPath(args),
				theme,
				context as JeroRenderContext | undefined,
			);
		},
		renderResult(result, options, theme, context) {
			return renderJeroResult(result, options, theme, context as JeroRenderContext | undefined);
		},
		async execute(_toolCallId, parameters, signal, _onUpdate, ctx) {
			if (signal?.aborted) throw new Error("Review controller operation was cancelled");
			await authorizeDestructiveReviewOperation(parameters, ctx);
			const sessionKey = pendingReviewConsentSessionKey(ctx, pendingReviewConsentFallbackKey);
			const retainedSelections = processRetainedNativeStatusSelections.get(sessionKey)
				?? processRetainedNativeStatusSelections.set(sessionKey, new Map()).get(sessionKey)!;
			// 在原生 await 之前快照：并发的自身写入即是新一代。
			const acknowledgementEpoch = reminderEpoch;
			let acknowledgementRoot: string | undefined;
			let acknowledgementMutation: string | undefined;
			try {
				const parsed = parseReviewControllerParameters(parameters);
				if (parsed.operation === REVIEW_CONTROLLER_OPERATION.ACKNOWLEDGE_APPROVED) {
					acknowledgementRoot = resolveReviewControllerWorkspaceRoot(parsed.workspaceRoot, ctx.cwd, candidateViews, parsed.lineageId);
					acknowledgementMutation = pendingReviewMutation(ctx.sessionManager, acknowledgementRoot);
				}
			} catch { /* 非法参数与不可用根目录由控制器校验负责。 */ }
			let details = await executeReviewControllerOperation(
				parameters,
				ctx.cwd,
				nativeReviewCli,
				signal,
				candidateViews,
				ctx,
				retainedSelections,
				pendingReviewConsentRegistry,
				pendingReviewConsentFallbackKey,
				reviewConsentNow,
				reviewConsentScheduleTimer,
			);
			if (details.operation === REVIEW_CONTROLLER_OPERATION.ACKNOWLEDGE_APPROVED &&
				details.outcome === "native-approved-acknowledgement-completed" &&
				details.status === "closed" && details.authority === "burned" &&
				typeof details.target_identity === "string") {
				try {
					if (reminderSessionActive && acknowledgementEpoch === reminderEpoch && acknowledgementRoot && pendingReviewConsentSessionKey(ctx, pendingReviewConsentFallbackKey) === sessionKey) {
						consumeReviewMutation(pi, ctx.sessionManager, acknowledgementRoot, acknowledgementMutation, "acknowledged", details.target_identity);
					}
				} catch { /* 簿记不能掩盖已确认的原生销毁。 */ }
			}
			if (
				isHostReviewConsentEligibleOperation(parameters) &&
				details.outcome === "native-review-consent-required" &&
				typeof details.consent_binding === "string"
			) {
				const resolved = pendingReviewConsentRegistry.resolve(details.consent_binding);
				const pending = resolved?.pending;
				const eligiblePending = pending !== undefined && isPiConsentV3(pending.consent)
					? pending
					: undefined;
				const answerPendingConsent = async (answer: "granted" | "declined") => executeReviewControllerOperation(
					{
						operation: REVIEW_CONTROLLER_OPERATION.ANSWER_CONSENT,
						input: JSON.stringify({ consentBinding: eligiblePending!.id, answer }),
						workspaceRoot: eligiblePending!.authorityCwd,
					},
					ctx.cwd,
					nativeReviewCli,
					signal,
					candidateViews,
					ctx,
					retainedSelections,
					pendingReviewConsentRegistry,
					pendingReviewConsentFallbackKey,
					reviewConsentNow,
					reviewConsentScheduleTimer,
				);
				let permissionWorkspaceRoot: string | undefined;
				try {
					const parsed = parseReviewControllerParameters(parameters);
					permissionWorkspaceRoot = resolveReviewControllerWorkspaceRoot(parsed.workspaceRoot, ctx.cwd, candidateViews, parsed.lineageId);
				} catch {
					// 上方成功的原生操作仍是权威；无法解析的
					// 本地绑定只是无法消耗宿主权限。
				}
				const initialIdentity = permissionWorkspaceRoot === undefined
					? undefined
					: await capturePermissionIdentity(ctx, permissionWorkspaceRoot);
				if (eligiblePending !== undefined && initialIdentity === undefined) {
					// 包子进程没有本地常备授权。它只能为其
					// 继承的父会话询问该确切待定目标的规范仓库身份，
					// 然后在本地重放该绑定一次。
					const repositoryIdentity = permissionWorkspaceRoot === undefined
						? undefined
						: await resolveCanonicalGitRepositoryIdentity(permissionWorkspaceRoot);
					if (repositoryIdentity !== undefined && await childStandingReviewPermission?.requestAuthorization(repositoryIdentity) === true) details = await answerPendingConsent("granted");
				} else if (eligiblePending !== undefined && initialIdentity !== undefined) {
					const initialEpoch = reviewSessionPermissionEpoch(initialIdentity);
					const permissionAlreadyActive = hasReviewSessionPermission(initialIdentity);
					const selection = initialEpoch === undefined
						? undefined
						: permissionAlreadyActive
							? { kind: "host-session" as const }
							: await presentReviewConsentUi(ctx, eligiblePending.consent);
					if (selection !== undefined) {
						const confirmedIdentity = await capturePermissionIdentity(ctx, permissionWorkspaceRoot);
						if (initialEpoch !== undefined && confirmedIdentity !== undefined && sameReviewSessionIdentity(initialIdentity, confirmedIdentity) && reviewSessionPermissionEpoch(confirmedIdentity) === initialEpoch) {
							const answer = selection.kind === "provider" ? selection.answer : "granted";
							details = await answerPendingConsent(answer);
							if (!permissionAlreadyActive && selection.kind === "host-session" && completedGrantedReviewConsent(details)) {
								if (grantReviewSessionPermission(confirmedIdentity, initialEpoch)) {
									setReviewSessionPermissionStatus(ctx, true);
									try { ctx.ui.notify("本 Pi 会话与该 Git 仓库已允许进行评审。", "info"); } catch { /* 仅为非阻塞指示。 */ }
								} else {
									try { ctx.ui.notify("该评审已启动，但内存中的会话权限注册表不兼容，后续候选将再次询问。", "warning"); } catch { /* 尽力而为。 */ }
								}
							}
						}
					}
				}
			}
			return {
				content: [{ type: "text", text: JSON.stringify(details) }],
				details,
			};
		},
	});

	function runSddPreflight(ctx: ExtensionContext, promptFields: readonly SddPreflightField[] = []): Promise<SddPreflightPreferences> {
		return ensureSddPreflight(ctx, { pi, installAssets: (cwd) => installPackageAssets(cwd, true, ["sdd"]), applyModelConfig: async () => applySavedModelConfig(ctx) }, { promptFields });
	}

	pi.on("session_start", async (event, ctx) => {
		reminderSessionActive = true;
		reminderEpoch += 1;
		try { candidateViews?.sweepOrphans(ctx.cwd); } catch { /* 所有权清扫不得阻塞启动。 */ }
		const reason = (event as { reason?: unknown }).reason;
		if (reason !== "reload") revokeCurrentReviewSessionPermission(ctx);
		await refreshReviewSessionPermissionStatus(ctx);
		try {
			const installResult = installPackageAssets(ctx.cwd, true, ["delegation", "review"]);
			migrateLegacyProjectModelOverrides(ctx.cwd);
			const modelResult = await applySavedModelConfig(ctx);
			if (ctx.hasUI && modelResult.invalidPath) {
				ctx.ui.notify(
					`el Jero 已跳过模型配置：${modelResult.invalidPath} 不是合法的 JSON 或不是对象。请修复或删除该文件，然后重新运行 /jero:models。`,
					"warning",
				);
				return;
			}
			if (ctx.hasUI && modelResult.updated > 0) {
				ctx.ui.notify(
					`el Jero 已将保存的模型配置应用到 ${modelResult.updated} 个代理。全局 delegation/review 资产已就绪：${installResult.agents} 个新代理、${installResult.chains} 条新链、${installResult.support} 个新支持文件。`,
					"info",
				);
			}
		} catch (error) {
			if (ctx.hasUI) {
				const message =
					error instanceof Error ? error.message : String(error);
				ctx.ui.notify(
					`el Jero 模型配置扫描失败：${message}`,
					"warning",
				);
			}
		}
		// 保留启动时的传输协商，但不要把其目标当作
		// 所有权基线：reload 可能仍有未完成的持久回执。
		try {
			const sessionKey = pendingReviewConsentSessionKey(ctx, pendingReviewConsentFallbackKey);
			await resolveNegotiatedReviewStatusForSession(nativeReviewCli, ctx, sessionKey);
		} catch {
			// 启动协商只是尽力而为；绝浮出或抛出。
		}
	});

	pi.on("input", async (event, ctx) => {
		if (typeof event.text !== "string" || !isSddPreflightTrigger(event.text)) {
			return { action: "continue" };
		}
		try { await runSddPreflight(ctx); }
		catch (error) {
			if (ctx.hasUI) ctx.ui.notify(error instanceof Error ? error.message : String(error), "warning");
			return { action: "handled" };
		}
		return { action: "continue" };
	});

	let nativeSddStartupBlock: string | undefined;
	pi.on("before_agent_start", async (event, ctx) => {
		nativeSddStartupBlock = undefined;
		const isSddAgent = isSddAgentStartEvent(event);
		const isNamedAgent = isNamedAgentStartEvent(event);
		const subagentDepthKey = pendingReviewConsentSessionKey(ctx, pendingReviewConsentFallbackKey);
		if (isSddAgent || isNamedAgent) {
			processAgentEndSubagentDepth.set(subagentDepthKey, (processAgentEndSubagentDepth.get(subagentDepthKey) ?? 0) + 1);
		} else {
			processAgentEndSubagentDepth.set(subagentDepthKey, 0);
		}
		try {
			if (isSddAgent && !getSddPreflightPreferences(ctx) && ctx.mode !== "rpc") {
				await runSddPreflight(ctx);
			}
		} catch (error) {
			// Pi 会记录 before_agent_start 抛出的错误并继续。返回一个
			// 未解决的门，而不是默默丢失预检指令。
			return { systemPrompt: `${event.systemPrompt}\n\nSDD preflight unresolved: ${error instanceof Error ? error.message : String(error)}\nSTOP: Do not initialize the project, launch phases, write artifacts, or infer consent. Request session preflight confirmation before continuing.` };
		}
		const prefs = getSddPreflightPreferences(ctx);
		// RPC 子进程从不解析或持久化默认值。父会话派发门
		// 在既有的任务上下文中传输渲染出的块，且 Gentle
		// Agents 会在生成子进程之前拒绝缺失/畸形的载荷。
		const sddPrompt =
			prefs && (!isNamedAgent || isSddAgent)
				? `\n\n${renderSddPreflightPrompt(prefs)}`
				: "";
		const phase = isSddAgent ? sddPhaseFromAgentStartEvent(event) : undefined;
		const launchSddChange = readSddChangeFlag(pi);
		if (launchSddChange !== undefined && !phase) nativeSddStartupBlock = "Receiving agent has no recognized SDD phase";
		const nativeStatusPrompt = phase
			? await (async () => {
				try {
					if (launchSddChange === undefined) {
						if (phase === "sync") return `\n\n${renderNativeSddPhasePrompt(resolveStartupControllerSddStatus(ctx.cwd, undefined, true, prefs?.artifactStore), phase)}`;
						const { status } = await readCommandSddStatus("", ctx);
						if (status.changeName === null || !status.phaseInstructions || status.nextRecommended !== phase) throw new Error(`Native SDD discovery cannot run ${phase}.`);
						return `\n\n${renderNativeSddPhasePrompt(status, phase)}`;
					}
					const agentName = `sdd-${phase}`;
					const startup = await resolveSelectedNativeSddChangeStartup(
						launchSddChange,
						ctx.cwd,
						agentName,
						nativeReviewCli,
						(options) => resolveControllerSddStatus(
							options.cwd,
							options.changeName,
							true,
							prefs?.artifactStore,
						),
					);
					return `\n\n${renderNativeSddPhasePrompt(startup.status, phase)}`;
				} catch (error) {
					nativeSddStartupBlock = error instanceof Error ? error.message : String(error);
					return `\n\n## Native SDD Status Engine\nSDD selection blocked: ${nativeSddStartupBlock}\nDo not run phase work; return this blocker to the parent.`;
				}
			})()
			: launchSddChange === undefined
				? ""
				: "\n\n## Native SDD Status Engine\nSDD selection blocked: the receiving agent has no recognized SDD phase.\nDo not run phase work; return this blocker to the parent.";
		// gentle-pi#661：RDD 状态行（以及 gentle 提示词的其余部分）
		// 只为主会话构建，与下方 reviewContractPrompt 的条件
		// 互为镜像——具名/SDD 代理永远不会走到这个
		// 分支，因此不会为它们解析或计算任何行。
		// resolveRddStatusLine 永不抛错，也绝不拖过
		// RDD_STATUS_TIMEOUT_MS：缺失/超时/中止/失败的原生
		// 二进制会渲染保守失败的 "unknown" 行。
		const gentlePrompt = isNamedAgent || isSddAgent
			? ""
			: `\n\n${buildGentlePrompt(
					readPersonaMode(ctx.cwd),
					ctx.cwd,
					readActiveToolNames(pi),
					await resolveRddStatusLine(nativeReviewCli, ctx.cwd, AbortSignal.timeout(RDD_STATUS_TIMEOUT_MS), undefined, ctx),
				)}`;
		// gentle-pi#560 / gentle-ai#4056, #4057：仅为主会话注入镜像
		// provider 契约 bundle 的评审执行契约，且只在
		// 原生评审 CLI 确实存在时注入。
		const reviewContractPrompt =
			!isNamedAgent && !isSddAgent && nativeReviewCli !== null
				? (() => {
					const fragment = loadReviewContractPromptFragment(ctx);
					return fragment === null ? "" : `\n\n${fragment}`;
				})()
				: "";
		return {
			systemPrompt: `${event.systemPrompt}${gentlePrompt}${sddPrompt}${nativeStatusPrompt}${reviewContractPrompt}${!isNamedAgent && !isSddAgent ? `\n\n${renderResearchCapabilities(resolveResearchCapabilities(pi))}` : ""}`,
		};
	});

	// gentle-pi#556 / gentle-ai#4051：RDD 开启时，代理可能完成
	// 一次已授权的实现并报告完成，却从未运行
	// 评审 STATUS 预检或提出同意问题。该
	// 处理器是只读且幂等的：它从不运行 START，从不
	// 应答同意，也不选择部分候选。持久的自身变更回执
	// 为 STATUS 设门，且只消耗该 await 之前捕获的代。
	pi.on("agent_end", async (_event, ctx) => {
		if (nativeReviewCli?.reviewMode === undefined || nativeReviewCli.targetStatus === undefined) return;
		if (ctx.hasUI !== true || !reminderSessionActive) return;
		const sessionKey = pendingReviewConsentSessionKey(ctx, pendingReviewConsentFallbackKey);
		const subagentDepth = processAgentEndSubagentDepth.get(sessionKey) ?? 0;
		if (subagentDepth > 0) {
			processAgentEndSubagentDepth.set(sessionKey, subagentDepth - 1);
			return;
		}
		const root = resolveSessionWorktree(ctx.cwd, ctx.cwd)?.root;
		if (!root) return;
		let mutation: string | undefined;
		try { mutation = pendingReviewMutation(ctx.sessionManager, root); }
		catch { return; }
		if (!mutation) return;
		const epoch = reminderEpoch;
		const status = await resolveNegotiatedReviewStatusForSession(nativeReviewCli, ctx, sessionKey);
		if (status === undefined || !reminderSessionActive || epoch !== reminderEpoch || pendingReviewConsentSessionKey(ctx, pendingReviewConsentFallbackKey) !== sessionKey) return;
		// 另一个并发的结束或 ACK 可能已消耗该前缀。
		if (!pendingReviewMutation(ctx.sessionManager, root, mutation)) return;
		if (status.nextTransition?.kind !== "execute" || status.nextTransition.execute.operation !== "review.start") return;
		const targetIdentity = status.targetIdentity;
		pi.sendMessage(
			{
				customType: "jero.review-preflight",
				content: renderAgentEndReviewPreflightMessage(targetIdentity),
				display: true,
			},
			{ triggerTurn: true, deliverAs: "followUp" },
		);
		consumeReviewMutation(pi, ctx.sessionManager, root, mutation, "nudged", targetIdentity);
	});

	pi.on("tool_result", (event, ctx) => {
		if (!reminderSessionActive || event.isError !== false || (event.toolName !== "write" && event.toolName !== "edit")) return;
		if (!isRecord(event.input) || typeof event.input.path !== "string" || !event.input.path.trim()) return;
		try {
			const root = resolveSessionWorktree(event.input.path, ctx.cwd)?.root;
			if (root) recordReviewMutation(pi, ctx.sessionManager, root, { source: "direct", toolName: event.toolName, toolCallId: event.toolCallId });
		} catch { /* 回执持久化不得改变一次成功的工具结果。 */ }
	});

	pi.on("tool_call", async (event, ctx) => {
		if (nativeSddStartupBlock && event.toolName !== "subagent_parent_message") return { block: true, reason: `SDD selection blocked: ${nativeSddStartupBlock}` };
		const sensitivePathDenied = evaluateSensitivePathTool(
			event.toolName,
			event.input,
		);
		if (sensitivePathDenied) return sensitivePathDenied;
		if (event.toolName === "subagent_run") {
			const sddAgent = sddDispatchAgentName(event.input);
			if (sddAgent === "invalid") {
				return { block: true, reason: "SDD dispatch requires exactly one shipped SDD agent name." };
			}
			if (sddAgent !== undefined) {
				// RPC 子进程是被委托的执行者，绝不是权威发起者。它
				// 必须从其交互式父会话接收已确认的块。
				if (ctx.mode === "rpc") {
					return { block: true, reason: "SDD dispatch refused: an RPC child cannot originate or persist SDD preflight defaults." };
				}
				try {
					const prefs = getSddPreflightPreferences(ctx) ?? await runSddPreflight(ctx);
					const rendered = renderSddPreflightPrompt(prefs);
					if (!prefs.prompted && ctx.hasUI) {
						return { block: true, reason: "SDD dispatch refused: interactive parent preflight lacks current-session confirmation." };
					}
					if (!isRecord(event.input)) {
						return { block: true, reason: "SDD dispatch refused: child input is malformed." };
					}
					if (event.input.context !== undefined && typeof event.input.context !== "string") {
						return { block: true, reason: "SDD dispatch refused: child context must be text." };
					}
					// 既有的 context 载荷是唯一的父到子传输通道。
					// 拒绝调用方拼写的仿制品，使子进程收到一个精确的、
					// 由父会话渲染的权威块，而不是含糊的混合物。
					const context = typeof event.input.context === "string" ? event.input.context.trim() : "";
					if (/^## SDD Session Preflight[ \t]*$/m.test(context)) {
						return { block: true, reason: "SDD dispatch refused: child context already contains an untrusted preflight block." };
					}
					event.input.context = context.length === 0
						? rendered
						: `${rendered}\n\n${context}`;
					if (!isParentConfirmedSddPreflightContext(event.input.context)) {
						return { block: true, reason: "SDD dispatch refused: rendered preflight transport is malformed." };
					}
				} catch (error) {
					return {
						block: true,
						reason: `SDD dispatch refused before child launch: ${error instanceof Error ? error.message : String(error)}`,
					};
				}
			}
			const judgmentDayFixDenied = rejectInvalidJudgmentDayFixDispatch(event.input);
			if (judgmentDayFixDenied) return judgmentDayFixDenied;
			const writerScopeDenied = rejectUnscopedBoundedWriterDispatch(event.input);
			if (writerScopeDenied) return writerScopeDenied;
			try {
				injectReviewCandidateView(event.input, candidateViews);
				return undefined;
			} catch (error) {
				return {
					block: true,
					reason: error instanceof Error ? error.message : "review subagent dispatch is invalid",
				};
			}
		}
		if (event.toolName !== "bash") return undefined;
		if (!isRecord(event.input) || typeof event.input.command !== "string") {
			return undefined;
		}
		return await confirmCommand(event.input.command, ctx, pi.events, herdrLifecycle);
	});

	for (const owner of ["delegation", "review", "sdd"] as const) {
		const label = owner === "sdd" ? "SDD" : owner;
		pi.registerCommand(`jero:install-${owner}`, {
			description: `Repair or refresh only global Jero ${label} assets.`,
			handler: async (args, ctx) => {
				const force = args.includes("--force");
				const result = installPackageAssets(ctx.cwd, force, [owner]);
				ctx.ui.notify(
					`Global Jero ${label} assets installed: ${result.agents} agent(s), ${result.chains} chain(s), ${result.support} support file(s), ${result.skipped} already present.`,
					"info",
				);
			},
		});
	}

	pi.registerCommand("jero:sdd-preflight", {
		description:
			"Run or reuse session SDD preflight; use --edit to change preferences.",
		handler: async (args, ctx) => {
			if (args.trim() !== "" && args.trim() !== "--edit") {
				ctx.ui.notify("用法：/jero:sdd-preflight [--edit]", "warning");
				return;
			}
			try {
				await runSddPreflight(ctx, args.trim() === "--edit" ? SDD_PREFLIGHT_FIELDS : []);
			} catch (error) {
				ctx.ui?.notify(error instanceof Error ? error.message : String(error), "warning");
			}
		},
	});

	const readCommandSddStatus = async (args: string, ctx: ExtensionContext) => {
		const parsed = parseSddStatusCommandArgs(args);
		const request = { changeName: parsed.changeName, workspaceRoot: realpathSync(ctx.cwd) };
		if (!nativeReviewCli?.sddStatus) throw new Error("Native SDD status capability unavailable; no local fallback.");
		const status = decodeNativeSddStatusV2(await nativeReviewCli.sddStatus(request), request);
		return { parsed, request, status };
	};
	const showCommandSddStatus = (status: NativeSddStatusV2, json: boolean, ctx: ExtensionContext) => {
		ctx.ui?.notify(json ? JSON.stringify(status, null, 2) : renderNativeSddPhasePrompt(status), "info");
	};
	const handleSddStatusCommand = async (args: string, ctx: ExtensionContext) => {
		const { parsed, status } = await readCommandSddStatus(args, ctx);
		showCommandSddStatus(status, parsed.json, ctx);
	};

	pi.registerCommand("jero-sdd-status", {
		description: "Show deterministic SDD change status and instructions.",
		handler: async (args, ctx) => {
			await handleSddStatusCommand(args, ctx);
		},
	});

	const handleSddContinueCommand = async (args: string, ctx: ExtensionContext) => {
		const { parsed, request, status } = await readCommandSddStatus(args, ctx);
		const planning = status.planningHome;
		const changeRoot = status.changeRoot;
		// 原生上下文是上界，绝不是人类逐次调用的授权。
		if (status.changeName === null || !ctx.hasUI || typeof ctx.ui?.confirm !== "function" || !nativeReviewCli?.sddContinue) {
			showCommandSddStatus(status, parsed.json, ctx);
			return;
		}
		if (typeof planning !== "object" || planning === null || !("path" in planning) || typeof planning.path !== "string" || typeof changeRoot !== "string") throw new Error("Native SDD continuation lacks an exact planning path.");
		if (!["openspec", "both"].includes(String(status.artifactStore)) || !["repo-local", "workspace-planning"].includes(String(status.actionContext.mode))) throw new Error("Native SDD continuation has unsupported planning context.");
		const marker = join(changeRoot, ".jero-instance");
		const checkMarker = () => {
			try {
				if (!lstatSync(marker).isFile() || realpathSync(marker) !== marker) throw new Error("Native SDD marker is not a canonical regular file.");
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			}
		};
		checkMarker();
		if (realpathSync(changeRoot) !== changeRoot || realpathSync(planning.path) !== planning.path || changeRoot !== join(planning.path, "changes", status.changeName) || !isStrictDescendantPath(request.workspaceRoot, marker)) throw new Error("Native SDD continuation workspace or planning path mismatch.");
		if (await ctx.ui.confirm("Prepare SDD marker?", `Authorize only continuation-time preparation of ${marker}? This grants no source roots and no persistent authority.`) !== true) {
			showCommandSddStatus(status, parsed.json, ctx);
			return;
		}
		if (realpathSync(ctx.cwd) !== request.workspaceRoot || realpathSync(changeRoot) !== changeRoot) throw new Error("Native SDD continuation workspace changed during confirmation.");
		checkMarker();
		const selected = { ...request, changeName: status.changeName };
		showCommandSddStatus(decodeNativeSddStatusV2(await nativeReviewCli.sddContinue(selected), selected), parsed.json, ctx);
	};

	pi.registerCommand("jero-sdd-continue", {
		description: "Resolve SDD status and route the next phase deterministically.",
		handler: async (args, ctx) => {
			await handleSddContinueCommand(args, ctx);
		},
	});

	pi.registerCommand("jero:models", {
		description: "Configure global per-agent models for el Jero.",
		handler: async (_args, ctx) => {
			await handleModelsCommand(ctx);
		},
	});

	pi.registerCommand("jero:profiles", {
		description: "Create, switch, and manage global agent-model profiles for el Jero.",
		handler: async (_args, ctx) => {
			await handleProfilesCommand(ctx);
		},
	});

	pi.registerCommand("jero:persona", {
		description: "Switch el Jero persona between gentleman and neutral.",
		handler: async (_args, ctx) => {
			await handlePersonaCommand(ctx);
		},
	});

	pi.registerCommand("jero:doctor", {
		description: "Run read-only Jero diagnostics for this Pi workspace.",
		handler: async (_args, ctx) => {
			const assetLines = packageAssetDiagnosticLines(ctx.cwd);
			const openspecConfigured = existsSync(
				join(ctx.cwd, "openspec", "config.yaml"),
			);
			const skillRegistryPresent = existsSync(
				join(ctx.cwd, ".atl", "skill-registry.md"),
			);
			const modelConfig = await readSavedModelConfigAsync(ctx.cwd);
			const engramActive = hasWritableMemoryTool(pi);
			const lines = [
				"el Jero doctor",
				...assetLines,
				`${openspecConfigured ? "pass" : "warn"}: OpenSpec config ${openspecConfigured ? "present" : "missing"}`,
				`${skillRegistryPresent ? "pass" : "warn"}: Skill registry ${skillRegistryPresent ? "present" : "missing"}`,
				`${modelConfig.status === "invalid" ? "fail" : "pass"}: Global model config ${modelConfig.status}`,
				"pass: Sensitive-path guard active for read/write/edit tools",
				`${engramActive ? "pass" : "warn"}: Engram memory tools ${engramActive ? "active" : "not active in this session"}`,
			];
			if (modelConfig.status === "invalid") {
				lines.push(`remedy: fix or remove ${modelConfig.path}`);
			}
			ctx.ui.notify(
				lines.join("\n"),
				lines.some((line) => line.startsWith("fail:")) || assetLines.some((line) => line.startsWith("warn:")) ? "warning" : "info",
			);
		},
	});

	pi.registerCommand("jero:review-session-permission", {
		description: "Show or revoke the process-memory review permission for this exact Pi session and Git repository (status|revoke).",
		handler: async (args, ctx) => {
			const subAction = args.trim().length === 0 ? "status" : args.trim();
			if (subAction !== "status" && subAction !== "revoke") {
				ctx.ui.notify(`未知的 /jero:review-session-permission 子操作 "${subAction}"。请使用 status 或 revoke。`, "warning");
				return;
			}
			if (subAction === "revoke") {
				const revoked = await revokeCurrentRepositoryReviewSessionPermission(ctx);
				ctx.ui.notify(revoked ? "已在此 Pi 会话中撤销该 Git 仓库的评审权限。provider 评审模式与权威未被更改。" : "此 Pi 会话中没有针对该 Git 仓库的活动评审权限。provider 评审模式与权威未被更改。", "info");
				return;
			}
			const identity = await refreshReviewSessionPermissionStatus(ctx);
			if (identity === undefined) {
				ctx.ui.notify("评审会话权限不可用：它需要交互式 Pi TUI、非子会话、非空会话 ID 以及规范的 Git 工作树。", "info");
				return;
			}
			ctx.ui.notify(hasReviewSessionPermission(identity)
				? "本 Pi 会话与该 Git 仓库已允许进行评审。使用 /jero:review-session-permission revoke 可恢复逐次询问。"
				: "本 Pi 会话的评审未获预授权；每个中高危及候选将正常逐次询问。", "info");
		},
	});

	pi.registerCommand("jero:review-mode", {
		description: "Show or set the Jero receipt-driven development kill switch (status|enable|disable). Every sub-action is user-initiated only; Pi automation never toggles it.",
		handler: async (args, ctx) => {
			const subAction = args.trim().length === 0 ? NATIVE_REVIEW_MODE_OPERATION.STATUS : args.trim();
			if (subAction !== NATIVE_REVIEW_MODE_OPERATION.STATUS && subAction !== NATIVE_REVIEW_MODE_OPERATION.ENABLE && subAction !== NATIVE_REVIEW_MODE_OPERATION.DISABLE) {
				ctx.ui.notify(`未知的 /jero:review-mode 子操作 "${subAction}"。请使用 status、disable 或 enable。`, "warning");
				return;
			}
			if (nativeReviewCli?.reviewMode === undefined) {
				ctx.ui.notify("当前协商的原生版本不支持 Jero 评审模式。", "info");
				return;
			}
			try {
				const result = await nativeReviewCli.reviewMode({ cwd: ctx.cwd, operation: subAction as NativeReviewModeOperation });
				if (subAction === NATIVE_REVIEW_MODE_OPERATION.DISABLE && result.status.effective === "off") {
					cleanupAllPendingReviewConsents(
						pendingReviewConsentRegistry,
						pendingReviewConsentSessionKey(ctx, pendingReviewConsentFallbackKey),
					);
				}
				const report = `receipt-driven development: ${result.status.effective} (decided by ${result.status.source})`;
				// 一个变更类子操作若未改变生效模式，就没有做到
				// 用户要求的事，而只报告结果状态读起来
				// 就像做到了。恰好只有一种形态会到达这里：
				// 针对全局 off 的 `enable`。Pi 总是传
				// `--scope clone`（设计决策 #7），它只会清除
				// clone-local 覆盖，无法开启全局 RDD。原生调用
				// 以 0 退出、报告操作 "enable"，却什么都没改。要把
				// 这一点说出来，并指明能解决它的全局记录编辑。
				const requested = subAction === NATIVE_REVIEW_MODE_OPERATION.ENABLE ? "on" : subAction === NATIVE_REVIEW_MODE_OPERATION.DISABLE ? "off" : result.status.effective;
				if (result.status.effective !== requested) {
					ctx.ui.notify(`${report}\n这并未重新开启评审：/jero:review-mode enable 只会清除 clone-local 覆盖，无法压过全局 off。请将 \{"schema":"jero.authority.review-mode/v1","value":"on"\} 写入 ${join(gentleAiConfigHome(), "review-mode.json")} 以重新开启。`, "warning");
					return;
				}
				ctx.ui.notify(report, "info");
			} catch (error) {
				if (asNativeReviewCliError(error)?.code === NATIVE_REVIEW_ERROR_CODE.VERSION_INCOMPATIBLE) {
					ctx.ui.notify("当前协商的原生版本不支持 Jero 评审模式。", "info");
					return;
				}
				ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
			}
		},
	});

	// 与 jero:review-mode 互为镜像：用户所有的开关，绝不是自动开关。
	// 它在这里比在那里更重要，因为该策略决定
	// 后台子代理是否可以被启动，因此 Pi 中任何东西都不得写
	// 它。唯一的写入者就是这个处理器，且只能经显式调用到达。
	pi.registerCommand("jero:background-subagents", {
		description: "Show or set the managed background-subagents policy (status|enable|disable). Every sub-action is user-initiated only; Pi automation never toggles it.",
		handler: async (args, ctx) => {
			const subAction = args.trim().length === 0 ? "status" : args.trim();
			if (subAction !== "status" && subAction !== "enable" && subAction !== "disable") {
				ctx.ui.notify(`未知的 /jero:background-subagents 子操作 "${subAction}"。请使用 status、enable 或 disable。`, "warning");
				return;
			}
			try {
				const wrote: BackgroundSubagentsPolicy | undefined = subAction === "enable" ? "on" : subAction === "disable" ? "off" : undefined;
				if (wrote !== undefined) writeGlobalBackgroundSubagentsPolicy(wrote);
				const resolution = resolveBackgroundSubagentsPolicy(ctx.cwd);
				const capability = resolveBackgroundSubagentsCapability(ctx.cwd, readActiveToolNames(pi));
				const report = renderBackgroundSubagentsReport(resolution, capability, wrote);
				ctx.ui.notify(report.message, report.type);
			} catch (error) {
				ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
			}
		},
	});

	pi.registerCommand("jero:status", {
		description: "Show Jero package status for this project.",
		handler: async (_args, ctx) => {
			const assetLines = packageAssetDiagnosticLines(ctx.cwd);
			const openspecConfigured = existsSync(
				join(ctx.cwd, "openspec", "config.yaml"),
			);
			const savedConfig = await readModelRoutingAuthorityAsync(
				modelConfigPath(ctx.cwd),
				legacyProjectModelConfigPath(ctx.cwd),
			);
			ctx.ui.notify(
				[
					"el Jero package is active.",
						`Persona: ${readPersonaMode(ctx.cwd)}`,
					...assetLines,
					`OpenSpec config: ${openspecConfigured ? "present" : "missing"}`,
					`Global model config: ${existsSync(modelConfigPath(ctx.cwd)) ? "present" : "missing"}`,
					`Saved model routing: ${savedConfig.status}${savedConfig.status === "invalid" ? ` (${savedConfig.path})` : ""}`,
					...(savedConfig.status === "invalid" ? [] : describeModelConfig(ctx.cwd, savedConfig.status === "valid" ? savedConfig.config : {})),
				].join("\n"),
				savedConfig.status === "invalid" || assetLines.some((line) => line.startsWith("warn:")) ? "warning" : "info",
			);
		},
	});
	};
}

export default function gentleAi(pi: ExtensionAPI): void {
	return createJeroAiExtension()(pi);
}
