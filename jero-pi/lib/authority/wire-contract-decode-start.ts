// 线上契约解码（能力/start 面）：capabilities、artifact、start v3/v4、投影、修复评估。
// 自 lib/authority/wire-contract.ts 拆分（机械平移，语义零改动）。

import {
	CAPABILITIES_SCHEMA_IDENTITIES,
	FEATURE_NAMES,
	REQUIRED_GATES,
	REQUIRED_MANDATORY_FEATURES,
	REQUIRED_OPERATIONS,
	REQUIRED_PROJECTIONS,
	REVIEW_AUTHORITY_VERSION,
	REVIEW_INTEGRATION_CONTRACT,
	REVIEW_INTEGRATION_OPERATION,
	REVIEW_LENSES,
	REVIEW_PROJECTION_KIND,
	REVIEW_START_STATE,
	RISK_LEVELS,
	RISK_REASON_CODES,
	RISK_SIGNALS,
	START_ACTIONS
} from "./wire-contract-enums.ts";
import {
	type AuthorityRepairAssessmentCandidateV1,
	type AuthorityRepairAssessmentCountsV1,
	type AuthorityRepairAssessmentV1,
	type ChangedPathEntry,
	REPOSITORY_CONTEXT_OUTCOMES,
	type ReviewArtifactSubjectV2,
	type ReviewCapabilitiesV2,
	type ReviewCaptureSubmissionV1,
	type ReviewCorrectionPlanRequestV1,
	type ReviewFeatureV2,
	type ReviewForecastV1,
	type ReviewNextTransitionExecuteV3,
	type ReviewProjectionDescriptorV1,
	type ReviewProviderTaskV1,
	type ReviewRepositoryContextV2,
	type ReviewRiskReasonV2,
	type ReviewStartV3,
	type ReviewStartV4,
	type ReviewTargetedValidationClassificationV1,
	type ReviewTargetedValidationFindingV1,
	type ReviewTargetedValidationRequestV1,
	type ReviewTransitionArgumentV3
} from "./wire-contract-interfaces.ts";
import {
	array,
	assertExactSet,
	assertSupersetOf,
	boolean,
	decodeFeature,
	decodeOptionalFeature,
	enumArray,
	enumeration,
	exactRecord,
	gitTree,
	integer,
	lineage,
	nonempty,
	requireIdentity,
	safePath,
	sha256,
	stringArray,
	text
} from "./wire-contract-decode-helpers.ts";
import {
	decodeReviewNextTransitionV3
} from "./wire-contract-decode-status.ts";
export function decodeReviewCapabilitiesV2(value: unknown, verifiedExecutableDigest: string): ReviewCapabilitiesV2 {
	const requiredFields = ["schema", "contract", "protocol", "package", "build", "executable", "operations", "gates", "projections", "schemas", "features", "compatibility"] as const;
	const body = exactRecord(value, "capabilities", requiredFields, ["bootstrap"]);
	// 加性次版本接受：每个被接受的 schema 身份保持自己确切的协议次版本
	// 与必需 schema 下限；v2 保持原样，未知身份先于其他一切被拒绝。
	const identity = CAPABILITIES_SCHEMA_IDENTITIES[typeof body.schema === "string" ? body.schema : ""];
	if (identity === undefined) throw new TypeError(`schema must be one of ${Object.keys(CAPABILITIES_SCHEMA_IDENTITIES).join(", ")}`);
	requireIdentity(body, body.schema as string);

	const protocol = exactRecord(body.protocol, "capabilities.protocol", ["major", "minor"]);
	if (protocol.major !== 2 || protocol.minor !== identity.protocolMinor) throw new TypeError("incompatible review integration protocol");

	const packageIdentity = exactRecord(body.package, "capabilities.package", ["name", "version", "release_channel"]);
	if (packageIdentity.name !== "gentle-ai") throw new TypeError("capabilities package identity mismatch");
	const packageVersion = nonempty(packageIdentity.version, "capabilities.package.version");
	enumeration(packageIdentity.release_channel, ["development", "prerelease", "stable"] as const, "capabilities.package.release_channel");

	const build = exactRecord(body.build, "capabilities.build", ["id", "go_version", "module_version", "vcs", "vcs_revision", "vcs_time", "vcs_modified"]);
	const buildId = sha256(build.id, "capabilities.build.id");
	nonempty(build.go_version, "capabilities.build.go_version");
	for (const field of ["module_version", "vcs", "vcs_revision", "vcs_time"] as const) text(build[field], `capabilities.build.${field}`);
	enumeration(build.vcs_modified, ["true", "false", "unknown"] as const, "capabilities.build.vcs_modified");

	const executable = exactRecord(body.executable, "capabilities.executable", ["sha256", "evidence", "verification"]);
	const selfReportedDigest = sha256(executable.sha256, "capabilities.executable.sha256");
	if (executable.evidence !== "self-reported" || executable.verification !== "compare-with-published-manifest") throw new TypeError("capabilities executable evidence is incompatible");
	const normalizedVerifiedDigest = sha256(verifiedExecutableDigest.startsWith("sha256:") ? verifiedExecutableDigest : `sha256:${verifiedExecutableDigest}`, "verified executable digest");
	if (selfReportedDigest !== normalizedVerifiedDigest) throw new TypeError("review provider executable digest mismatch");

	const advertisedOperations = stringArray(body.operations, "capabilities.operations", { minimum: REQUIRED_OPERATIONS.length, unique: true });
	// 门与投影和操作、schema 一样是超集承诺而非精确清单：兼容的提供方
	// 发布可以在必需下限之外宣告额外的门或投影名。按普通字符串数组
	// 解码（而不是对着已知枚举用 `enumArray`），使未知增补不会在
	// assertSupersetOf 尚未运行之前就被拒绝。
	const advertisedGates = stringArray(body.gates, "capabilities.gates", { minimum: REQUIRED_GATES.length, unique: true });
	const advertisedProjections = stringArray(body.projections, "capabilities.projections", { minimum: REQUIRED_PROJECTIONS.length, unique: true });
	const advertisedSchemas = stringArray(body.schemas, "capabilities.schemas", { minimum: identity.requiredSchemas.length, unique: true });
	assertSupersetOf(advertisedOperations, REQUIRED_OPERATIONS, "capabilities operations");
	assertSupersetOf(advertisedGates, REQUIRED_GATES, "capabilities gates");
	assertSupersetOf(advertisedProjections, REQUIRED_PROJECTIONS, "capabilities projections");
	assertSupersetOf(advertisedSchemas, identity.requiredSchemas, "capabilities schemas");

	const features = exactRecord(body.features, "capabilities.features", ["mandatory", "optional"]);
	const requiredMandatoryFeatures = identity.requiredMandatoryFeatures ?? REQUIRED_MANDATORY_FEATURES;
	const mandatory = array(features.mandatory, "capabilities.features.mandatory", (entry, label) => decodeFeature(entry, label), { minimum: requiredMandatoryFeatures.length });
	const optional = array(features.optional, "capabilities.features.optional", (entry, label) => decodeOptionalFeature(entry, label), { minimum: identity.optionalFeatureFloor ?? 17, unique: true });
	const mandatoryNames = mandatory.map((feature) => feature.name);
	const optionalNames = optional.map((feature) => feature.name);
	assertExactSet(mandatoryNames, requiredMandatoryFeatures, "mandatory capabilities");
	if (new Set(optionalNames).size !== optionalNames.length) throw new TypeError("optional capabilities contain duplicate names");
	if (optionalNames.some((name) => mandatoryNames.includes(name as ReviewFeatureV2["name"]))) throw new TypeError("mandatory and optional capabilities overlap");
	if (mandatory.some((feature) => !feature.supported)) throw new TypeError("mandatory capability is unsupported");

	const compatibility = exactRecord(body.compatibility, "capabilities.compatibility", ["minimum_protocol_major", "maximum_protocol_major", "additive_minor_policy", "unknown_mandatory", "unknown_optional", "modes", "legacy_window"]);
	if (compatibility.minimum_protocol_major !== 2 || compatibility.maximum_protocol_major !== 2 || compatibility.additive_minor_policy !== "optional-fields-only" || compatibility.unknown_mandatory !== "reject" || compatibility.unknown_optional !== "ignore") {
		throw new TypeError("incompatible capability evolution policy");
	}
	const modes = enumArray(compatibility.modes, Object.values(REVIEW_AUTHORITY_VERSION), "capabilities.compatibility.modes", { minimum: 2, maximum: 2 });
	if (modes[0] !== REVIEW_AUTHORITY_VERSION.COMPACT_V2 || modes[1] !== REVIEW_AUTHORITY_VERSION.LEGACY_V1) throw new TypeError("capabilities compatibility modes are out of order");
	const legacyWindow = exactRecord(compatibility.legacy_window, "capabilities.compatibility.legacy_window", ["mode", "state", "read_only", "deprecation_started", "removal", "minimum_compatibility_releases"]);
	if (legacyWindow.mode !== REVIEW_AUTHORITY_VERSION.LEGACY_V1) throw new TypeError("capabilities legacy window mode is incompatible");
	enumeration(legacyWindow.state, ["pre-fence", "active", "deprecated", "expired"] as const, "capabilities.compatibility.legacy_window.state");
	boolean(legacyWindow.read_only, "capabilities.compatibility.legacy_window.read_only");
	boolean(legacyWindow.deprecation_started, "capabilities.compatibility.legacy_window.deprecation_started");
	nonempty(legacyWindow.removal, "capabilities.compatibility.legacy_window.removal");
	integer(legacyWindow.minimum_compatibility_releases, "capabilities.compatibility.legacy_window.minimum_compatibility_releases", 1);

	if (body.bootstrap !== undefined) {
		const bootstrap = exactRecord(body.bootstrap, "capabilities.bootstrap", ["command", "target_selector_variants", "required_feature", "unsupported_outcome", "parent_only"]);
		if (bootstrap.command !== "gentle-ai review status --cwd <repo> --contract gentle-ai.review-integration/v2 --next-transition") throw new TypeError("capabilities.bootstrap.command is unsupported");
		array(bootstrap.target_selector_variants, "capabilities.bootstrap.target_selector_variants", (entry, label) => {
			const selector = exactRecord(entry, label, ["target_type", "arguments"]);
			enumeration(selector.target_type, ["staged", "base_ref", "workspace_overlay_base_ref", "workspace_overlay_base_tree"] as const, `${label}.target_type`);
			stringArray(selector.arguments, `${label}.arguments`, { minimum: 2 });
			return selector;
		}, { minimum: 4, maximum: 4 });
		if (bootstrap.required_feature !== "native_next_transition") throw new TypeError("capabilities.bootstrap.required_feature is unsupported");
		if (bootstrap.unsupported_outcome !== "unsupported-capability") throw new TypeError("capabilities.bootstrap.unsupported_outcome is unsupported");
		if (bootstrap.parent_only !== true) throw new TypeError("capabilities.bootstrap.parent_only must be true");
	}

	return {
		contract: REVIEW_INTEGRATION_CONTRACT,
		packageVersion,
		buildId,
		executableDigest: selfReportedDigest,
		operations: new Set(REQUIRED_OPERATIONS),
		gates: new Set(REQUIRED_GATES),
		projections: new Set(REQUIRED_PROJECTIONS),
		schemas: new Set(identity.requiredSchemas),
		mandatoryFeatures: new Set(mandatoryNames),
		optionalFeatures: new Set(optional.filter((feature) => feature.supported && (FEATURE_NAMES as readonly string[]).includes(feature.name)).map((feature) => feature.name)),
		raw: body,
	};
}

// ---------------------------------------------------------------------------
// artifact-subject/v2
// ---------------------------------------------------------------------------

export function decodeArtifactSubject(value: unknown, label: string): ReviewArtifactSubjectV2 {
	const body = exactRecord(value, label, ["schema", "subject_hash", "lineage_id", "authority_revision", "target_identity", "base_tree", "candidate_tree", "changed_path_manifest_sha256", "lens", "selected_order"], ["correction_target_identity"]);
	if (body.schema !== "gentle-ai.review-artifact-subject/v2") throw new TypeError(`${label}.schema must be gentle-ai.review-artifact-subject/v2`);
	return {
		schema: "gentle-ai.review-artifact-subject/v2",
		subjectHash: sha256(body.subject_hash, `${label}.subject_hash`),
		lineageId: lineage(body.lineage_id, `${label}.lineage_id`),
		authorityRevision: sha256(body.authority_revision, `${label}.authority_revision`),
		targetIdentity: sha256(body.target_identity, `${label}.target_identity`),
		baseTree: gitTree(body.base_tree, `${label}.base_tree`),
		candidateTree: gitTree(body.candidate_tree, `${label}.candidate_tree`),
		changedPathManifestSha256: sha256(body.changed_path_manifest_sha256, `${label}.changed_path_manifest_sha256`),
		lens: enumeration(body.lens, REVIEW_LENSES, `${label}.lens`),
		selectedOrder: integer(body.selected_order, `${label}.selected_order`, 0, 3),
		...(body.correction_target_identity === undefined ? {} : { correctionTargetIdentity: sha256(body.correction_target_identity, `${label}.correction_target_identity`) }),
	};
}

export function decodeReviewArtifactSubjectV2(value: unknown): ReviewArtifactSubjectV2 {
	return decodeArtifactSubject(value, "artifact_subject");
}

export function decodeChangedPathEntry(value: unknown, label: string): ChangedPathEntry {
	const body = exactRecord(value, label, ["path", "status", "old_mode", "new_mode", "deleted", "type_changed", "mode_only", "intended_untracked"]);
	return {
		path: nonempty(body.path, `${label}.path`),
		status: enumeration(body.status, ["A", "D", "M", "T"] as const, `${label}.status`),
		oldMode: text(body.old_mode, `${label}.old_mode`, { pattern: /^[0-7]{6}$/ }),
		newMode: text(body.new_mode, `${label}.new_mode`, { pattern: /^[0-7]{6}$/ }),
		deleted: boolean(body.deleted, `${label}.deleted`),
		typeChanged: boolean(body.type_changed, `${label}.type_changed`),
		modeOnly: boolean(body.mode_only, `${label}.mode_only`),
		intendedUntracked: boolean(body.intended_untracked, `${label}.intended_untracked`),
	};
}

// ---------------------------------------------------------------------------
// start/v3
// ---------------------------------------------------------------------------

export function decodeReviewStartV3(value: unknown, overlayIdentitySatisfiesRepositoryContext = false): ReviewStartV3 {
	const overlayFields = ["target_mode", "target_identity", "base_tree", "candidate_tree"] as const;
	const body = exactRecord(value, "start", [
		"schema", "contract", "operation", "action", "lenses_required", "lineage_id", "state", "risk_level",
		"selected_lenses", "projection", "changed_files", "changed_lines", "correction_budget", "risk_reasons", "artifact_subjects",
	], [...overlayFields, "changed_path_manifest", "repository_context", "acknowledgement"]);
	requireIdentity(body, "gentle-ai.review-integration.start/v3", REVIEW_INTEGRATION_OPERATION.START);

	// dependentRequired 让 base_tree 与 candidate_tree 双向绑定，并单独让
	// target_mode 与 target_identity 双向绑定，两者都要求
	// base_tree+candidate_tree。两对相互独立：带 selected_lenses 的
	// START 可以携带 base_tree/candidate_tree 而从不携带
	// target_mode/target_identity。
	if ((body.base_tree === undefined) !== (body.candidate_tree === undefined)) throw new TypeError("start.base_tree and start.candidate_tree must appear together");
	const baseTree = body.base_tree === undefined ? undefined : gitTree(body.base_tree, "start.base_tree");
	const candidateTree = body.candidate_tree === undefined ? undefined : gitTree(body.candidate_tree, "start.candidate_tree");

	if ((body.target_mode === undefined) !== (body.target_identity === undefined)) throw new TypeError("start.target_mode and start.target_identity must appear together");
	if (body.target_mode !== undefined && (baseTree === undefined || candidateTree === undefined)) throw new TypeError("start.target_mode and start.target_identity require base_tree and candidate_tree");
	const targetMode = body.target_mode === undefined ? undefined : enumeration(body.target_mode, ["base-workspace-overlay"] as const, "start.target_mode");
	const targetIdentity = body.target_identity === undefined ? undefined : sha256(body.target_identity, "start.target_identity");

	if (body.changed_path_manifest !== undefined && (baseTree === undefined || candidateTree === undefined)) {
		throw new TypeError("start.changed_path_manifest requires base_tree and candidate_tree");
	}

	const action = enumeration(body.action, START_ACTIONS, "start.action");
	const state = enumeration(body.state, Object.values(REVIEW_START_STATE), "start.state");
	const selectedLenses = enumArray(body.selected_lenses, REVIEW_LENSES, "start.selected_lenses", { maximum: 4, unique: true });

	if (selectedLenses.length >= 1 && (body.base_tree === undefined || body.candidate_tree === undefined || body.changed_path_manifest === undefined)) {
		throw new TypeError("start with selected_lenses requires base_tree, candidate_tree, and changed_path_manifest");
	}

	const reviewingCreatedOrResumed = (action === "created" || action === "resumed") && state === REVIEW_START_STATE.REVIEWING;
	// START/v4 可以把冻结目标渲染为 overlay 身份而非
	// repository_context；只有当该身份存在时，缺失才被原谅。
	const requiresRepositoryContext = reviewingCreatedOrResumed && !(overlayIdentitySatisfiesRepositoryContext && targetIdentity !== undefined);
	if (requiresRepositoryContext && body.repository_context === undefined) throw new TypeError("start.repository_context is required when action is created/resumed and state is reviewing");
	if (!reviewingCreatedOrResumed && body.repository_context !== undefined) throw new TypeError("start.repository_context is only valid when action is created/resumed and state is reviewing");

	let repositoryContext: ReviewRepositoryContextV2 | undefined;
	if (body.repository_context !== undefined) {
		const source = exactRecord(body.repository_context, "start.repository_context", ["capability", "handle", "revision", "target_identity"], ["event_id", "outcome"]);
		if (source.capability !== "review.opaque_repository_context") throw new TypeError("start.repository_context.capability is unsupported");
		repositoryContext = {
			capability: "review.opaque_repository_context",
			handle: text(source.handle, "start.repository_context.handle", { pattern: /^rctx[12]_[0-9a-f]{64}$/ }),
			revision: sha256(source.revision, "start.repository_context.revision"),
			targetIdentity: sha256(source.target_identity, "start.repository_context.target_identity"),
			...(source.event_id === undefined ? {} : { eventId: sha256(source.event_id, "start.repository_context.event_id") }),
			...(source.outcome === undefined ? {} : { outcome: enumeration(source.outcome, REPOSITORY_CONTEXT_OUTCOMES, "start.repository_context.outcome") }),
		};
	}

	const riskReasons = array(body.risk_reasons, "start.risk_reasons", (entry, label): ReviewRiskReasonV2 => {
		const reason = exactRecord(entry, label, ["code"], ["signal", "path", "old_mode", "new_mode"]);
		return {
			code: enumeration(reason.code, RISK_REASON_CODES, `${label}.code`),
			...(reason.signal === undefined ? {} : { signal: enumeration(reason.signal, RISK_SIGNALS, `${label}.signal`) }),
			...(reason.path === undefined ? {} : { path: nonempty(reason.path, `${label}.path`) }),
			...(reason.old_mode === undefined ? {} : { oldMode: text(reason.old_mode, `${label}.old_mode`, { pattern: /^[0-7]{6}$/ }) }),
			...(reason.new_mode === undefined ? {} : { newMode: text(reason.new_mode, `${label}.new_mode`, { pattern: /^[0-7]{6}$/ }) }),
		};
	}, { minimum: 1, unique: true });

	const artifactSubjects = array(body.artifact_subjects, "start.artifact_subjects", (entry, label) => decodeArtifactSubject(entry, label), { maximum: 4 });

	return {
		contract: REVIEW_INTEGRATION_CONTRACT,
		action,
		lensesRequired: boolean(body.lenses_required, "start.lenses_required"),
		lineageId: nonempty(body.lineage_id, "start.lineage_id"),
		state,
		riskLevel: enumeration(body.risk_level, RISK_LEVELS, "start.risk_level"),
		selectedLenses,
		projection: enumeration(body.projection, REQUIRED_PROJECTIONS, "start.projection"),
		changedFiles: integer(body.changed_files, "start.changed_files"),
		changedLines: integer(body.changed_lines, "start.changed_lines"),
		correctionBudget: integer(body.correction_budget, "start.correction_budget", 0, 200),
		riskReasons,
		artifactSubjects,
		...(targetMode === undefined ? {} : { targetMode }),
		...(targetIdentity === undefined ? {} : { targetIdentity }),
		...(baseTree === undefined ? {} : { baseTree }),
		...(candidateTree === undefined ? {} : { candidateTree }),
		...(body.changed_path_manifest === undefined ? {} : { changedPathManifest: array(body.changed_path_manifest, "start.changed_path_manifest", decodeChangedPathEntry, { unique: true }) }),
		...(repositoryContext === undefined ? {} : { repositoryContext }),
		raw: body,
	};
}

function assertReviewStartV4StatusBinding(execute: ReviewNextTransitionExecuteV3, start: ReviewStartV3): void {
	const expectedTargetIdentity = start.repositoryContext?.targetIdentity ?? start.targetIdentity;
	const targetIdentityConflicts = expectedTargetIdentity === undefined || execute.binding.targetIdentity !== expectedTargetIdentity
		|| (start.targetIdentity !== undefined && start.targetIdentity !== expectedTargetIdentity)
		|| start.artifactSubjects.some((subject) => subject.targetIdentity !== expectedTargetIdentity);
	if (targetIdentityConflicts) throw new TypeError("START/v4 status target identity binding conflicts with frozen START");
	if (execute.binding.lineageId !== undefined && execute.binding.lineageId !== start.lineageId) {
		throw new TypeError("START/v4 status lineage binding conflicts with frozen START");
	}
	const optionalSelectors: Readonly<Record<string, string | undefined>> = {
		"base-ref": start.baseTree,
		"base-tree": start.baseTree,
		projection: start.projection,
		target: expectedTargetIdentity,
	};
	const argumentsByName = new Map<string, string>();
	for (const argument of execute.arguments) {
		if (argumentsByName.has(argument.name)) throw new TypeError(`START/v4 status arguments duplicate ${argument.name} binding`);
		argumentsByName.set(argument.name, argument.value);
		if (Object.hasOwn(optionalSelectors, argument.name) && argument.value !== optionalSelectors[argument.name]) throw new TypeError(`START/v4 status ${argument.name} binding conflicts with frozen START`);
	}
	if (argumentsByName.get("lineage") !== start.lineageId) throw new TypeError("START/v4 status requires exactly one lineage binding for the frozen START");
	if (execute.arguments.find((argument) => argument.name === "lineage")?.token !== `--lineage=${start.lineageId}`) throw new TypeError("START/v4 status lineage binding conflicts with frozen START");
	for (const [name, value] of [["contract", REVIEW_INTEGRATION_CONTRACT], ["next-transition", "true"], ["agent", "pi"]]) {
		if (argumentsByName.get(name) !== value || execute.arguments.find((argument) => argument.name === name)?.token !== `--${name}=${value}`) throw new TypeError(`START/v4 status ${name} binding conflicts with frozen START`);
	}
	const selectorArguments = execute.selectorArguments;
	if (selectorArguments === undefined || selectorArguments.length === 0) throw new TypeError("START/v4 status selector arguments are required");
	const selectorsByName = new Map<string, ReviewTransitionArgumentV3>();
	for (const selector of selectorArguments) {
		const full = execute.arguments.find((argument) => argument.name === selector.name);
		if (selectorsByName.has(selector.name) || full === undefined || full.value !== selector.value || full.token !== selector.token) throw new TypeError(`START/v4 status selector ${selector.name} binding conflicts with full arguments`);
		selectorsByName.set(selector.name, selector);
	}
	const selector = (name: string, value: string): void => {
		if (selectorsByName.get(name)?.value !== value || selectorsByName.get(name)?.token !== `--${name}=${value}` || execute.arguments.find((argument) => argument.name === name)?.token !== `--${name}=${value}`) throw new TypeError(`START/v4 status selector ${name} binding conflicts with frozen START`);
	};
	const baseRef = argumentsByName.get("base-ref");
	if (start.targetMode === "base-workspace-overlay") {
		if (baseRef !== start.baseTree || argumentsByName.has("committed-only")) throw new TypeError("START/v4 status workspace overlay binding conflicts with frozen START");
		selector("base-ref", start.baseTree!); selector("workspace-overlay", "true");
	} else if (baseRef !== undefined) {
		if (baseRef !== start.baseTree || argumentsByName.has("workspace-overlay")) throw new TypeError("START/v4 status committed range binding conflicts with frozen START");
		selector("base-ref", start.baseTree!); selector("committed-only", "true");
	} else {
		if (argumentsByName.has("committed-only") || argumentsByName.has("workspace-overlay")) throw new TypeError("START/v4 status current projection binding conflicts with frozen START");
		selector("projection", start.projection);
	}
}

export function decodeReviewStartV4(value: unknown): ReviewStartV4 {
	const overlayFields = ["target_mode", "target_identity", "base_tree", "candidate_tree"] as const;
	const body = exactRecord(value, "start", [
		"schema", "contract", "operation", "action", "lenses_required", "lineage_id", "state", "risk_level",
		"selected_lenses", "projection", "changed_files", "changed_lines", "correction_budget", "risk_reasons", "artifact_subjects",
	], [...overlayFields, "changed_path_manifest", "repository_context", "acknowledgement", "next_transition"]);
	requireIdentity(body, "gentle-ai.review-integration.start/v4", REVIEW_INTEGRATION_OPERATION.START);
	const action = enumeration(body.action, ["created", "replayed", "closed", "blocked-scope-action"] as const, "start.action");
	const v3Action = action === "replayed" ? "resumed" : action;
	const nextTransition = body.next_transition === undefined ? undefined : decodeReviewNextTransitionV3(body.next_transition);
	const reviewing = (action === "created" || action === "replayed") && body.state === REVIEW_START_STATE.REVIEWING;
	if (reviewing && nextTransition?.kind !== "execute") throw new TypeError("reviewing created/replayed START requires next_transition.execute");
	if (reviewing && nextTransition.execute?.operation !== "review.status") throw new TypeError("reviewing created/replayed START next_transition.execute.operation must be review.status");
	const closedApprovedZeroLens = action === "closed" && body.state === REVIEW_START_STATE.APPROVED && Array.isArray(body.selected_lenses) && body.selected_lenses.length === 0;
	if (closedApprovedZeroLens && nextTransition !== undefined) throw new TypeError("closed approved zero-lens START cannot carry next_transition");
	const v3Body = { ...body };
	delete v3Body.next_transition;
	const decoded = decodeReviewStartV3({ ...v3Body, schema: "gentle-ai.review-integration.start/v3", action: v3Action }, true);
	if (reviewing) assertReviewStartV4StatusBinding(nextTransition!.execute!, decoded);
	return { ...decoded, action, ...(nextTransition === undefined ? {} : { nextTransition }), raw: body };
}

// ---------------------------------------------------------------------------
// projection/v1——逐字复用；v2 capabilities schema 仍宣告
// gentle-ai.review-integration.projection/v1，因此给这个解码器改名就
// 等于模块改名想消除的那种谎言。
// ---------------------------------------------------------------------------

export function decodeReviewProjectionV1(value: unknown): ReviewProjectionDescriptorV1 {
	const projection = exactRecord(value, "status.projection", ["schema", "kind", "projection", "base_tree", "initial_review_tree", "current_candidate_tree", "paths_digest", "paths", "intended_untracked", "intended_untracked_proof", "initial_snapshot_identity", "current_snapshot_identity"]);
	if (projection.schema !== "gentle-ai.review-integration.projection/v1") throw new TypeError("status.projection schema is incompatible");
	return {
		schema: "gentle-ai.review-integration.projection/v1",
		kind: enumeration(projection.kind, Object.values(REVIEW_PROJECTION_KIND), "status.projection.kind"),
		projection: enumeration(projection.projection, REQUIRED_PROJECTIONS, "status.projection.projection"),
		baseTree: gitTree(projection.base_tree, "status.projection.base_tree"),
		initialReviewTree: gitTree(projection.initial_review_tree, "status.projection.initial_review_tree"),
		currentCandidateTree: gitTree(projection.current_candidate_tree, "status.projection.current_candidate_tree"),
		pathsDigest: sha256(projection.paths_digest, "status.projection.paths_digest"),
		paths: array(projection.paths, "status.projection.paths", safePath, { unique: true }),
		intendedUntracked: array(projection.intended_untracked, "status.projection.intended_untracked", safePath, { unique: true }),
		intendedUntrackedProof: sha256(projection.intended_untracked_proof, "status.projection.intended_untracked_proof"),
		initialSnapshotIdentity: sha256(projection.initial_snapshot_identity, "status.projection.initial_snapshot_identity"),
		currentSnapshotIdentity: sha256(projection.current_snapshot_identity, "status.projection.current_snapshot_identity"),
	};
}

// ---------------------------------------------------------------------------
// authority-repair-assessment/v1——净新增。同时用作 status.repair 与
// repair.assessment。
// ---------------------------------------------------------------------------

function decodeAuthorityRepairAssessmentCounts(value: unknown, label: string): AuthorityRepairAssessmentCountsV1 {
	const body = exactRecord(value, label, ["lineages", "compact_lineages", "legacy_lineages", "events", "bytes", "eligible_candidates", "unsupported_lineages", "conflicts"]);
	return {
		lineages: integer(body.lineages, `${label}.lineages`, 0, 256),
		compactLineages: integer(body.compact_lineages, `${label}.compact_lineages`, 0, 256),
		legacyLineages: integer(body.legacy_lineages, `${label}.legacy_lineages`, 0, 256),
		events: integer(body.events, `${label}.events`, 0, 1024),
		bytes: integer(body.bytes, `${label}.bytes`, 0, 8_388_608),
		eligibleCandidates: integer(body.eligible_candidates, `${label}.eligible_candidates`, 0, 256),
		unsupportedLineages: integer(body.unsupported_lineages, `${label}.unsupported_lineages`, 0, 1024),
		conflicts: integer(body.conflicts, `${label}.conflicts`, 0, 1024),
	};
}

export function decodeAuthorityRepairAssessmentV1(value: unknown): AuthorityRepairAssessmentV1 {
	const label = "assessment";
	const body = exactRecord(value, label, ["schema", "status", "counts", "supported_operations", "authorization_schema"], ["class", "cause", "disposition", "repository_binding", "candidate"]);
	if (body.schema !== "gentle-ai.review-authority-repair-assessment/v1") throw new TypeError(`${label}.schema must be gentle-ai.review-authority-repair-assessment/v1`);
	const status = enumeration(body.status, ["eligible", "unsupported", "ambiguous", "conflicting", "truncated"] as const, `${label}.status`);

	const eligibleFields = ["class", "cause", "disposition", "repository_binding", "candidate"] as const;
	const eligiblePresent = eligibleFields.filter((field) => body[field] !== undefined);
	if (status === "eligible") {
		if (eligiblePresent.length !== eligibleFields.length) throw new TypeError(`${label} eligible status requires class, cause, disposition, repository_binding, and candidate`);
	} else if (eligiblePresent.length > 0) {
		throw new TypeError(`${label} non-eligible status cannot expose class, cause, disposition, repository_binding, or candidate`);
	}
	if (body.class !== undefined && body.class !== "legacy_v1_historical_alias") throw new TypeError(`${label}.class is unsupported`);
	if (body.cause !== undefined && body.cause !== "unsupported_historical_v1_operation_alias") throw new TypeError(`${label}.cause is unsupported`);
	if (body.disposition !== undefined && body.disposition !== "quarantine-approved-historical-alias") throw new TypeError(`${label}.disposition is unsupported`);

	let candidate: AuthorityRepairAssessmentCandidateV1 | undefined;
	if (body.candidate !== undefined) {
		const source = exactRecord(body.candidate, `${label}.candidate`, ["lineage_id", "revision", "chain_identity", "event_count", "alias_event_count", "operations"]);
		candidate = {
			lineageId: lineage(source.lineage_id, `${label}.candidate.lineage_id`),
			revision: sha256(source.revision, `${label}.candidate.revision`),
			chainIdentity: sha256(source.chain_identity, `${label}.candidate.chain_identity`),
			eventCount: integer(source.event_count, `${label}.candidate.event_count`, 2, 1024),
			aliasEventCount: integer(source.alias_event_count, `${label}.candidate.alias_event_count`, 1, 1024),
			operations: enumArray(source.operations, ["review/complete-fix", "review/validate-fix"] as const, `${label}.candidate.operations`, { minimum: 1, maximum: 2, unique: true }),
		};
	}

	const counts = decodeAuthorityRepairAssessmentCounts(body.counts, `${label}.counts`);
	if (status === "eligible" && (counts.eligibleCandidates !== 1 || counts.unsupportedLineages !== 0 || counts.conflicts !== 0)) {
		throw new TypeError(`${label}.counts is incompatible with eligible status`);
	}

	const supportedOperations = array(body.supported_operations, `${label}.supported_operations`, (entry, entryLabel) => enumeration(entry, ["review/complete-fix", "review/validate-fix"] as const, entryLabel), { minimum: 2, maximum: 2 });
	if (supportedOperations[0] !== "review/complete-fix" || supportedOperations[1] !== "review/validate-fix") throw new TypeError(`${label}.supported_operations is out of order`);
	if (body.authorization_schema !== "gentle-ai.review-repair-authorization/v1") throw new TypeError(`${label}.authorization_schema must be gentle-ai.review-repair-authorization/v1`);

	return {
		schema: "gentle-ai.review-authority-repair-assessment/v1",
		status,
		...(body.class === undefined ? {} : { class: "legacy_v1_historical_alias" as const }),
		...(body.cause === undefined ? {} : { cause: "unsupported_historical_v1_operation_alias" as const }),
		...(body.disposition === undefined ? {} : { disposition: "quarantine-approved-historical-alias" as const }),
		...(body.repository_binding === undefined ? {} : { repositoryBinding: sha256(body.repository_binding, `${label}.repository_binding`) }),
		...(candidate === undefined ? {} : { candidate }),
		counts,
		supportedOperations: supportedOperations as readonly ["review/complete-fix", "review/validate-fix"],
		authorizationSchema: "gentle-ai.review-repair-authorization/v1",
	};
}

// ---------------------------------------------------------------------------
// next-transition/v3——净新增；与 v1 的 decodeNextTransition（void）
// 不同，本解码器返回类型化值，使调用方能读取绑定清单的 collect 输入
// 与 execute 绑定。
// ---------------------------------------------------------------------------

export const NEXT_TRANSITION_OPERATIONS = ["review.start", "review.status", "review.recover", "review.repair", "review.acknowledge-approved"] as const;

export function decodeTransitionArguments(value: unknown, label: string): readonly ReviewTransitionArgumentV3[] {
	return array(value, label, (entry, entryLabel) => {
		const argument = exactRecord(entry, entryLabel, ["name", "value"], ["token"]);
		const name = text(argument.name, `${entryLabel}.name`, { minimum: 1, pattern: /^[a-z0-9_-]+$/ });
		const argumentValue = text(argument.value, `${entryLabel}.value`, { minimum: 1 });
		const token = argument.token === undefined ? undefined : text(argument.token, `${entryLabel}.token`, { minimum: 1 });
		return { name, value: argumentValue, ...(token === undefined ? {} : { token }) };
	});
}

export function decodeCaptureSubmission(value: unknown, label: string, v5: boolean, v6: boolean, captureOperation: string): ReviewCaptureSubmissionV1 {
	// status/v6 增加提供方持有的意图未跟踪选择表单。
	if (v6 && captureOperation === "external.select_intended_untracked" && typeof value === "object" && value !== null && (value as Record<string, unknown>).operation_token === "status") {
		const submission = exactRecord(value, label, ["operation_token", "argument_tokens", "value"]);
		const expectedTokens = [
			"--contract=gentle-ai.review-integration/v2", "--next-transition=true", "--agent=pi",
			"--projection=workspace", "--intended-untracked-selection={{value}}",
		] as const;
		const operationToken = enumeration(submission.operation_token, ["status"] as const, `${label}.operation_token`);
		const argumentTokens = stringArray(submission.argument_tokens, `${label}.argument_tokens`, { minimum: expectedTokens.length, maximum: expectedTokens.length });
		if (argumentTokens.some((token, index) => token !== expectedTokens[index])) throw new TypeError(`${label}.argument_tokens substitution binding is invalid`);
		const row = exactRecord(submission.value, `${label}.value`, ["slot", "domain", "schema", "substitution_location"]);
		return {
			operationToken,
			argumentTokens,
			values: [{
				slot: enumeration(row.slot, ["intended_untracked_selection"] as const, `${label}.value.slot`),
				domain: enumeration(row.domain, ["schema_bound_json"] as const, `${label}.value.domain`),
				schema: enumeration(row.schema, ["gentle-ai.review-intended-untracked-selection/v1"] as const, `${label}.value.schema`),
				substitutionLocation: integer(row.substitution_location, `${label}.value.substitution_location`, 4, 4),
			}],
		};
	}
	// status/v5：在线 2.4.0-main 二进制把物化 capture-result 提交作为
	// 携带 `schema` 键的“单数” `value` 对象发出（2026-08-16 自
	// 2.4.0-main.b1afef46 捕获；自 gentle-ai f1a95179 起发射器就是单数
	// 形态）。该表单封闭为那个确切的捕获形态，并归一化为宿主中继已在
	// 消费的单条目类型化 values 数组。同时携带两种线上形态的载荷匹配
	// 不到任何捕获形态，落到遗留解码器，后者会拒绝未知的 `value` 键。
	if (v5 && typeof value === "object" && value !== null && "value" in value && !("values" in value)) {
		const submission = exactRecord(value, label, ["operation_token", "argument_tokens", "value"]);
		const operationToken = enumeration(submission.operation_token, ["capture-result", "capture-correction-plan"] as const, `${label}.operation_token`);
		const argumentTokens = stringArray(submission.argument_tokens, `${label}.argument_tokens`, { minimum: 1 });
		const row = operationToken === "capture-result"
			? exactRecord(submission.value, `${label}.value`, ["slot", "domain", "schema", "substitution_location"])
			: exactRecord(submission.value, `${label}.value`, ["slot", "domain", "minimum", "maximum", "substitution_location"]);
		return {
			operationToken,
			argumentTokens,
			values: [{
				slot: operationToken === "capture-result"
					? enumeration(row.slot, ["reviewer_result"] as const, `${label}.value.slot`)
					: enumeration(row.slot, ["correction_lines"] as const, `${label}.value.slot`),
				domain: nonempty(row.domain, `${label}.value.domain`),
				...(row.schema === undefined ? {} : { schema: nonempty(row.schema, `${label}.value.schema`) }),
				...(row.minimum === undefined ? {} : { minimum: integer(row.minimum, `${label}.value.minimum`, 1, 200) }),
				...(row.maximum === undefined ? {} : { maximum: integer(row.maximum, `${label}.value.maximum`, 1, 200) }),
				substitutionLocation: integer(row.substitution_location, `${label}.value.substitution_location`, 0, argumentTokens.length - 1),
			}],
		};
	}
	const submission = exactRecord(value, label, ["operation_token", "argument_tokens", "values"]);
	const operationToken = text(submission.operation_token, `${label}.operation_token`, { minimum: 1, pattern: /^[a-z0-9-]+$/ });
	const argumentTokens = stringArray(submission.argument_tokens, `${label}.argument_tokens`, { minimum: 1 });
	const values = array(submission.values, `${label}.values`, (entry, entryLabel) => {
		const row = exactRecord(entry, entryLabel, ["slot", "domain", "substitution_location"]);
		return {
			slot: nonempty(row.slot, `${entryLabel}.slot`),
			domain: nonempty(row.domain, `${entryLabel}.domain`),
			substitutionLocation: integer(row.substitution_location, `${entryLabel}.substitution_location`, 0, argumentTokens.length - 1),
		};
	}, { minimum: 1 });
	return { operationToken, argumentTokens, values };
}

// 仅 v5 的结构解码器，精确对应 gentle-ai main 上 vendored 的
// status-v5.schema.json 与 correction-plan-request.schema.json。

export function decodeProviderTask(value: unknown, label: string): ReviewProviderTaskV1 {
	const task = exactRecord(value, label, ["agent", "role", "prompt"]);
	return {
		agent: enumeration(task.agent, ["review-refuter", "review-validator"] as const, `${label}.agent`),
		role: enumeration(task.role, ["refuter", "targeted-validator"] as const, `${label}.role`),
		prompt: nonempty(task.prompt, `${label}.prompt`),
	};
}

export function decodeCorrectionPlanRequestV1(value: unknown, label: string): ReviewCorrectionPlanRequestV1 {
	const body = exactRecord(value, label, ["schema", "request_hash", "lineage_id", "expected_revision", "target_identity", "correction_budget", "fix_finding_ids", "findings"]);
	if (body.schema !== "gentle-ai.review-correction-plan-request/v1") throw new TypeError(`${label}.schema must be gentle-ai.review-correction-plan-request/v1`);
	return {
		schema: "gentle-ai.review-correction-plan-request/v1",
		requestHash: sha256(body.request_hash, `${label}.request_hash`),
		lineageId: lineage(body.lineage_id, `${label}.lineage_id`),
		expectedRevision: sha256(body.expected_revision, `${label}.expected_revision`),
		targetIdentity: sha256(body.target_identity, `${label}.target_identity`),
		correctionBudget: integer(body.correction_budget, `${label}.correction_budget`, 1, 200),
		fixFindingIds: stringArray(body.fix_finding_ids, `${label}.fix_finding_ids`, { minimum: 1, unique: true }),
		findings: array(body.findings, `${label}.findings`, (entry, entryLabel) => {
			const finding = exactRecord(entry, entryLabel, ["id", "lens", "location", "severity", "claim", "proof_refs", "evidence", "evidence_class", "causal_disposition"]);
			return {
				id: nonempty(finding.id, `${entryLabel}.id`),
				lens: enumeration(finding.lens, ["risk", "resilience", "readability", "reliability"] as const, `${entryLabel}.lens`),
				location: nonempty(finding.location, `${entryLabel}.location`),
				severity: enumeration(finding.severity, ["BLOCKER", "CRITICAL"] as const, `${entryLabel}.severity`),
				claim: nonempty(finding.claim, `${entryLabel}.claim`),
				proofRefs: stringArray(finding.proof_refs, `${entryLabel}.proof_refs`, { minimum: 1 }),
				evidence: nonempty(finding.evidence, `${entryLabel}.evidence`),
				evidenceClass: enumeration(finding.evidence_class, ["deterministic", "inferential"] as const, `${entryLabel}.evidence_class`),
				causalDisposition: enumeration(finding.causal_disposition, ["introduced", "behavior-activated", "worsened"] as const, `${entryLabel}.causal_disposition`),
			};
		}, { minimum: 1 }),
	};
}

export function decodeReviewTargetedValidationRequestV1(value: unknown, label = "targeted_validation_request"): ReviewTargetedValidationRequestV1 {
	const body = exactRecord(value, label, [
		"schema", "request_hash", "lineage_id", "expected_revision", "target_identity", "fix_finding_ids", "policy_content", "fix_findings", "fix_classifications",
		"projection", "correction_candidate_tree", "correction_target_identity", "correction_paths", "correction_paths_digest",
	]);
	if (body.schema !== "gentle-ai.review-targeted-validation-request/v1") throw new TypeError(`${label}.schema must be gentle-ai.review-targeted-validation-request/v1`);
	const fixFindingIds = stringArray(body.fix_finding_ids, `${label}.fix_finding_ids`, { minimum: 1, unique: true });
	const fixFindings = array(body.fix_findings, `${label}.fix_findings`, (entry, entryLabel): ReviewTargetedValidationFindingV1 => {
		const finding = exactRecord(entry, entryLabel, ["id", "lens", "location", "severity", "claim", "proof_refs", "evidence_class", "causal_disposition"]);
		return {
			id: nonempty(finding.id, `${entryLabel}.id`),
			lens: enumeration(finding.lens, ["risk", "resilience", "readability", "reliability"] as const, `${entryLabel}.lens`),
			location: nonempty(finding.location, `${entryLabel}.location`),
			severity: enumeration(finding.severity, ["BLOCKER", "CRITICAL"] as const, `${entryLabel}.severity`),
			claim: nonempty(finding.claim, `${entryLabel}.claim`),
			proofRefs: stringArray(finding.proof_refs, `${entryLabel}.proof_refs`, { minimum: 1 }),
			evidenceClass: enumeration(finding.evidence_class, ["deterministic", "inferential"] as const, `${entryLabel}.evidence_class`),
			causalDisposition: enumeration(finding.causal_disposition, ["introduced", "behavior-activated", "worsened"] as const, `${entryLabel}.causal_disposition`),
		};
	}, { minimum: 1 });
	const fixClassifications = array(body.fix_classifications, `${label}.fix_classifications`, (entry, entryLabel): ReviewTargetedValidationClassificationV1 => {
		const classification = exactRecord(entry, entryLabel, ["finding_id", "class", "causal_disposition", "proof"], ["severity"]);
		const severity = classification.severity === undefined ? undefined : nonempty(classification.severity, `${entryLabel}.severity`);
		return {
			findingId: nonempty(classification.finding_id, `${entryLabel}.finding_id`),
			...(severity === undefined ? {} : { severity }),
			class: enumeration(classification.class, ["deterministic", "inferential"] as const, `${entryLabel}.class`),
			causalDisposition: enumeration(classification.causal_disposition, ["introduced", "behavior-activated", "worsened"] as const, `${entryLabel}.causal_disposition`),
			proof: nonempty(classification.proof, `${entryLabel}.proof`),
		};
	}, { minimum: 1 });
	const findingIds = fixFindings.map((finding) => finding.id);
	const classificationFindingIds = fixClassifications.map((classification) => classification.findingId);
	assertExactSet(findingIds, fixFindingIds, `${label}.fix_findings`);
	assertExactSet(classificationFindingIds, fixFindingIds, `${label}.fix_classifications`);
	return {
		schema: "gentle-ai.review-targeted-validation-request/v1",
		requestHash: sha256(body.request_hash, `${label}.request_hash`),
		lineageId: lineage(body.lineage_id, `${label}.lineage_id`),
		expectedRevision: sha256(body.expected_revision, `${label}.expected_revision`),
		targetIdentity: sha256(body.target_identity, `${label}.target_identity`),
		fixFindingIds,
		policyContent: nonempty(body.policy_content, `${label}.policy_content`),
		fixFindings,
		fixClassifications,
		projection: enumeration(body.projection, REQUIRED_PROJECTIONS, `${label}.projection`),
		correctionCandidateTree: gitTree(body.correction_candidate_tree, `${label}.correction_candidate_tree`),
		correctionTargetIdentity: sha256(body.correction_target_identity, `${label}.correction_target_identity`),
		correctionPaths: stringArray(body.correction_paths, `${label}.correction_paths`, { minimum: 1, unique: true }),
		correctionPathsDigest: sha256(body.correction_paths_digest, `${label}.correction_paths_digest`),
	};
}

export function decodeReviewForecastV1(value: unknown, label = "status.forecast"): ReviewForecastV1 {
	const body = exactRecord(value, label, ["horizon", "steps"]);
	const horizon = enumeration(body.horizon, ["partial", "terminal"] as const, `${label}.horizon`);
	const steps = array(body.steps, `${label}.steps`, (entry, entryLabel) => {
		const step = exactRecord(entry, entryLabel, ["step", "kind", "reason_code", "description"]);
		if (step.step !== 1) throw new TypeError(`${entryLabel}.step must be 1`);
		return {
			step: 1 as const,
			kind: enumeration(step.kind, ["execute", "collect", "stop"] as const, `${entryLabel}.kind`),
			reasonCode: text(step.reason_code, `${entryLabel}.reason_code`, { minimum: 1, pattern: /^[a-z0-9_]+$/ }),
			description: nonempty(step.description, `${entryLabel}.description`),
		};
	}, { minimum: 1, maximum: 1 });
	// 已发布的 horizon-到-step 不变量：stop 头是 terminal，其余头都是
	// partial。
	if ((horizon === "terminal") !== (steps[0]!.kind === "stop")) throw new TypeError(`${label}.horizon does not match its step kind`);
	return { horizon, steps };
}

