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
import { GRAPH_V1_ORDINARY_READ_ONLY, packageAssetDiagnosticLines } from "../lib/jero-ai-package-assets.ts";
import { type BackgroundSubagentsPolicy, loadBackgroundSubagentsPolicy, parseBackgroundSubagentsPolicyFile, renderBackgroundSubagentsReport, resolveBackgroundSubagentsPolicy, writeGlobalBackgroundSubagentsPolicy } from "../lib/jero-ai-background-subagents.ts";
import { readActiveToolNames, rejectInvalidJudgmentDayFixDispatch, rejectUnscopedBoundedWriterDispatch, renderBackgroundSubagentsStatusLine, resolveBackgroundSubagentsCapability, sddDispatchAgentName } from "../lib/jero-ai-writer-scope.ts";
import { RDD_STATUS_MEMO_TTL_MS, RDD_STATUS_TIMEOUT_MS, clearNativeReviewOutcomeMemoForTesting, clearRddStatusMemoForTesting, getOrchestratorPrompt, isValidRddModeStatus, readNativeReviewOutcome, recordNativeReviewOutcome, renderOrchestratorPrompt, renderRddStatusLine, resolveRddModeStatus, resolveRddStatusLine, resolveReviewAssessmentPlan } from "../lib/jero-ai-rdd-status.ts";
import { buildGentlePrompt, loadReviewContractPromptFragment, readMirroredReviewContractFragment } from "../lib/jero-ai-prompts.ts";
import { classifyGuardedCommand, evaluateGuardedCommand, guardedCommandPreview, guardedCommandTitle, loadRuntimeGuardrailsConfig, setGuardrailsProcessEnv } from "../lib/jero-ai-guardrails.ts";
import { SDD_CHANGE_FLAG, evaluateSensitivePathTool, hasWritableMemoryTool, isNamedAgentStartEvent, isSddAgentStartEvent, readSddChangeFlag, resolveSddChangeStartup, resolveSelectedNativeSddChangeStartup, sddPhaseFromAgentStartEvent } from "../lib/jero-ai-sdd-startup.ts";
import { confirmCommand, createHerdrConfirmationLifecycle } from "../lib/jero-ai-herdr-confirm.ts";
import { gentleAiConfigHome, isRecord, legacyProjectModelConfigPath, modelConfigPath, readPersonaMode } from "../lib/jero-ai-persona-config.ts";
import { listAgentsFromDir, listAgentsFromDirAsync, listDiscoverableAgents, orderDiscoverableAgents, readEffectiveModelConfig, readEffectiveModelConfigAsync, readSavedModelConfig, readSavedModelConfigAsync } from "../lib/jero-ai-model-config.ts";
import { applyModelConfig, applySavedModelConfig, describeModelConfig, migrateLegacyProjectModelOverrides } from "../lib/jero-ai-model-routing-apply.ts";
import { handleModelsCommand, renderSddModelPanelForTesting } from "../lib/jero-ai-model-panel.ts";
import { handleProfilesCommand } from "../lib/jero-ai-profiles-panel.ts";
import { handlePersonaCommand } from "../lib/jero-ai-persona-command.ts";

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
	setGuardrailsProcessEnv(dependencies.processEnv ?? process.env);
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

// 兼容再导出：这些符号已随 stage1 拆分迁往 lib/，但既有调用方
// （extensions/sdd-init.ts 与 tests/*.test.ts）仍按扩展的公开面导入。
export {
	applyModelConfig,
	applyModelConfigAsync,
	applySavedModelConfig,
} from "../lib/jero-ai-model-routing-apply.ts";
export {
	readModelConfig,
	readModelConfigAsync,
} from "../lib/jero-ai-model-config.ts";

