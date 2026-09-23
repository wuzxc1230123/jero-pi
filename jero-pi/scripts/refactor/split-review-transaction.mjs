// lib/review-transaction.ts 机械拆分器：schema / reducer / store / gate 四模块 + 兼容 barrel。
// 原则：块按声明边界整体平移，语义零改动；被跨模块引用的内部符号自动加 export；
// 每个新模块的 import 由"标识符在正文中的出现"自动推导（type 名必须带 type 前缀，
// node strip-types 运行时不允许悬空的纯类型具名导入）。
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const SRC = join(root, "lib", "review-transaction.ts");
const lines = readFileSync(SRC, "utf8").split("\n");

// 1-based 闭区间切片
const slice = (ranges) =>
	ranges.map(([a, b]) => lines.slice(a - 1, b).join("\n")).join("\n\n");

const modules = {
	schema: {
		file: "review-transaction-schema.ts",
		header:
			"// 评审事务 schema：阶段/状态枚举、V1 接口、权威回执品牌、规范化 JSON 哈希与字段断言。\n// 自 lib/review-transaction.ts 拆分（机械平移，语义零改动）。",
		ranges: [[63, 334], [340, 340], [349, 361], [375, 419], [430, 435], [437, 590]],
	},
	reducer: {
		file: "review-transaction-reducer.ts",
		header:
			"// 评审事务 reducer：冻结台账与状态构造、回执封套、scope claim、状态归约与图回放校验。\n// 自 lib/review-transaction.ts 拆分（机械平移，语义零改动）。",
		ranges: [[592, 1083]],
	},
	store: {
		file: "review-transaction-store.ts",
		header:
			"// 评审事务存储：ReviewTransactionStore——图对象存储、变更锁、操作日志与权威回执铸造。\n// 自 lib/review-transaction.ts 拆分（机械平移，语义零改动）。",
		ranges: [[335, 338], [341, 341], [343, 348], [362, 374], [1084, 1499]],
	},
	gate: {
		file: "review-transaction-gate.ts",
		header:
			"// 评审事务门禁：push/pull 目标巡检、回执与状态匹配、gate 评估入口。\n// 自 lib/review-transaction.ts 拆分（机械平移，语义零改动）。",
		ranges: [[420, 428], [1500, 1967]],
	},
};

// 外部依赖：name -> { module, kind }
const externals = {};
const addExternals = (module, valueNames, typeNames) => {
	for (const n of valueNames) externals[n] = { module, kind: "value" };
	for (const n of typeNames) externals[n] = { module, kind: "type" };
};
addExternals("node:child_process", ["execFileSync"], []);
addExternals("node:crypto", ["createHash"], []);
addExternals("node:fs", ["existsSync"], []);
addExternals("node:path", ["isAbsolute", "join", "resolve"], []);
addExternals("./review-lock.ts", ["ReviewMutationLockV1"], ["ReviewLockPlatformAdapterV1"]);
addExternals("./review-object-store.ts", ["ReviewGraphObjectStoreV1"], []);
addExternals("./review-graph-schema.ts", ["createReviewEventV1"], []);
addExternals("./review-repository.ts", ["resolveRepositoryAuthorityV1"], ["RepositoryAuthorityV1"]);
addExternals(
	"./review-publication-gate.ts",
	["GATE_RESULT", "GATE_TARGET_KIND", "PUSH_UPDATE_KIND", "pushRemoteAdvertisesObjectV1", "resolveConfiguredPushDestinationV1", "resolvePushRemoteRefV1"],
	["GateResult", "GateTargetV1", "PushGateTargetV1", "PushRefUpdateV1"],
);
addExternals(
	"./review-snapshot.ts",
	["REVIEW_MODE", "REVIEW_PROJECTION"],
	["ReviewMode", "ReviewProjectionV1", "SnapshotV1", "ReviewSnapshotObjectStoreV1"],
);
addExternals("./review-triggers.ts", ["REVIEW_ROUTE", "classifyReviewRoute"], ["ReviewLens", "ReviewRoute"]);
addExternals(
	"./review-policy-ordinary.ts",
	["applyOrdinaryFix", "declineOrdinaryFix", "recordOrdinaryDiscovery", "recordOrdinaryFinalVerification", "recordOrdinaryValidation", "resolveOrdinaryEvidence"],
	["OrdinaryDiscoveryInput", "OrdinaryEvidenceInput", "OrdinaryFinalVerificationInput", "OrdinaryFixInput", "OrdinaryValidationInput"],
);
addExternals(
	"./review-policy-judgment-day.ts",
	["applyJudgmentDayFix", "recordJudgmentDayDiscovery", "recordJudgmentDayFinalVerification", "recordJudgmentDayRejudgment"],
	["JudgmentDayDiscoveryInput", "JudgmentDayFinalVerificationInput", "JudgmentDayFixInput", "JudgmentDayRejudgmentInput"],
);

// 跨模块符号：name -> { home, kind, exported }
const movable = {};
// 显式登记（exported = 原文件里已带 export 关键字）
const decl = (home, name, kind, exported) => {
	movable[name] = { home, kind, exported };
};
const value = (home, names, exported = false) => names.forEach((n) => decl(home, n, "value", exported));
const type = (home, names, exported = false) => names.forEach((n) => decl(home, n, "type", exported));

value("schema", ["ChildClaimEnvelopeV1", "DIGEST", "OBJECT_ID", "LINEAGE_ID", "COUNTER_KEYS", "canonicalize", "cloneCanonical", "assertDigest", "assertObjectId", "assertLineageId", "zeroCounters", "assertBudget", "assertCounters", "assertProjectionBinding", "assertCanonicalPaths", "assertFollowUp", "assertValidationEvidence", "authoritativeReceiptBrand"]);
value("schema", ["REVIEW_PHASE", "TERMINAL_STATE", "JOURNAL_STATUS", "FROZEN_SEVERITY", "FROZEN_STATUS", "EVIDENCE_CLASS", "RESOLUTION_OUTCOME", "RESOLUTION_SOURCE", "STORE_FAULT_POINT", "REVIEW_OPERATION", "REVIEW_TRANSITION", "canonicalHash", "ReviewIntegrityError"], true);
type("schema", ["ReviewPhase", "TerminalState", "JournalStatus", "FrozenSeverity", "FrozenStatus", "EvidenceClass", "ResolutionOutcome", "ResolutionSource", "StoreFaultPoint", "ReviewOperation", "ReviewTransition", "ReviewBudgetV1", "ReviewCountersV1", "CanonicalFrozenRowV1", "FrozenLedgerV1", "RequestJournalEntryV1", "GateResultV1", "FindingResolutionV1", "ReviewFixRecordV1", "ValidationEvidenceV1", "FollowUpObservationV1", "ReviewStateV1", "CreateReviewStateInput", "ReceiptBodyV1", "ReceiptEnvelopeV1", "ChildClaimV1", "AuthoritativeReceiptV1", "ReviewReducerInput", "ReducerOperationResultV1", "StartOperationResultV1", "RunReducerOperationOptions", "BeginReducerOperationOptions", "CompleteReducerOperationOptions"], true);

value("reducer", ["assertState", "assertImmutableState", "assertReceiptBody", "repositoryRootForGate", "createScopeChildClaim", "operationForTransition", "reduceReviewState", "reducerOperationResult"]);
value("reducer", ["createFrozenLedger", "assertFrozenLedgerIntegrity", "createReviewState", "createReceiptEnvelope", "assertReceiptIntegrity", "reviewStoreRootForRepository", "validateReviewGraphReplayV1"], true);

value("store", ["ReviewTransactionStoreOptions", "mutationLockPlatformForTesting", "RunOperationResult", "RunOperationOptions"]);
value("store", ["ReviewTransactionStore", "setReviewMutationLockPlatformForTesting"], true);

value("gate", ["GateTargetInspection", "FULL_REF", "isRecord", "isObjectId", "isFullRef", "runGateGit", "resolveGateObject", "resolveGateRef", "assertTreeObject", "assertCommitBinding", "inspectPushTarget", "inspectGateTarget", "deniedGateResult", "assertReceiptMatchesState"]);
value("gate", ["evaluateGateTarget", "createReceiptForState", "validateReviewGate", "validateAuthoritativeReviewGate"], true);
type("gate", ["ValidateReviewGateOptions"], true);

// ---- 生成各模块正文与 import ------------------------------------------------
const bodies = {};
for (const [name, spec] of Object.entries(modules)) {
	bodies[name] = slice(spec.ranges);
}

const usedIn = (body, name) => new RegExp(`\\b${name}\\b`).test(body);

const moduleFile = { schema: "./review-transaction-schema.ts", reducer: "./review-transaction-reducer.ts", store: "./review-transaction-store.ts", gate: "./review-transaction-gate.ts" };

const promote = new Map(); // home -> Set<name>（需要补 export 的内部符号）
const output = {};
for (const name of Object.keys(modules)) {
	const body = bodies[name];
	const extByModule = new Map();
	const crossByModule = new Map();
	const recordImport = (map, moduleName, entry) => {
		if (!map.has(moduleName)) map.set(moduleName, []);
		map.get(moduleName).push(entry);
	};
	// 外部依赖
	for (const [symbol, info] of Object.entries(externals)) {
		if (usedIn(body, symbol)) recordImport(extByModule, info.module, { name: symbol, kind: info.kind });
	}
	// 跨模块依赖
	for (const [symbol, info] of Object.entries(movable)) {
		if (info.home === name) continue;
		if (usedIn(body, symbol)) {
			recordImport(crossByModule, moduleFile[info.home], { name: symbol, kind: info.kind });
			if (!info.exported) {
				if (!promote.has(info.home)) promote.set(info.home, new Set());
				promote.get(info.home).add(symbol);
			}
		}
	}
	const formatGroup = (entries) =>
		entries
			.map((e) => (e.kind === "type" ? `type ${e.name}` : e.name))
			.sort((a, b) => a.replace(/^type /, "").localeCompare(b.replace(/^type /, "")))
			.join(",\n\t");
	const imports = [];
	for (const [moduleName, entries] of [...extByModule, ...crossByModule]) {
		imports.push(`import {\n\t${formatGroup(entries)}\n} from "${moduleName}";`);
	}
	output[name] = `${modules[name].header}\n\n${imports.join("\n")}\n\n${bodies[name]}\n`;
}

// ---- 内部符号导出提升（在宿主模块正文里给声明行加 export 前缀）----------------
for (const [home, names] of promote) {
	let body = output[home];
	for (const symbol of names) {
		const re = new RegExp(`(^|\\n)(const|function|interface|class|let) ${symbol}\\b`);
		const match = body.match(re);
		if (!match) throw new Error(`无法提升导出：${home}/${symbol}`);
		const at = match.index + match[1].length;
		body = body.slice(0, at) + "export " + body.slice(at);
	}
	output[home] = body;
}

for (const [name, spec] of Object.entries(modules)) {
	writeFileSync(join(root, "lib", spec.file), output[name], "utf8");
	process.stdout.write(`${spec.file}: ${output[name].split("\n").length} 行\n`);
}

const barrel = `// 兼容门面：评审事务四模块（schema/reducer/store/gate）统一再导出，消费方 import 路径不变。
export { REVIEW_MODE, type ReviewMode } from "./review-snapshot.ts";
export * from "./review-transaction-schema.ts";
export * from "./review-transaction-reducer.ts";
export * from "./review-transaction-store.ts";
export * from "./review-transaction-gate.ts";
`;
writeFileSync(SRC, barrel, "utf8");
process.stdout.write(`review-transaction.ts: barrel ${barrel.split("\n").length} 行\n`);
