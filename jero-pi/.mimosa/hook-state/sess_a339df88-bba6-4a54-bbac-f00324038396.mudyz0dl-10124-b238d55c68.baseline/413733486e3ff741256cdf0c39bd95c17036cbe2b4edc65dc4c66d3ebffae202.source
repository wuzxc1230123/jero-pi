import { isAbsolute, join } from "node:path";
import { resolveSddStatus, type SddArtifactStore, type SddStatus } from "../sdd-status.ts";
import type { JeroAuthorityContextV1 } from "./review.ts";

// `authority.sdd.status`（规范 _tools/p2-m4-sdd-analysis.md §A.1）：Go
// 二进制以 `sdd-status` 提供的纯投影。jero-pi 从移植的 TS 解析器已在
// 读取的“同一个”openspec 树计算它——lib/sdd-status.ts 的
// resolveSddStatus 拥有产物/依赖发现——并把解析器的 v1 记录投影为扩展
// 曾消费的 v2 线上形态（camelCase，schema “gentle-ai.sdd-status” v2；
// 该字符串是移植的契约，在 P5 身份改造时改名）。不写日志：状态只报告
// 产物状态，绝不报告尝试令牌或计数（sdd-status-contract.md:66）。
//
// 投影自检：上游解码器纪律（native-review-cli.ts 的
// decodeNativeSddStatusV2 :1467-1498）在返回“之前”应用于投影记录——
// planning-home 包含性、恰好七个依赖键、绝不发出遗留的 `instructions`、
// 修正不变量——因此解析器漂移以类型化拒绝呈现，而不是坏的线上记录。

const SEVEN_DEPENDENCIES = ["proposal", "specs", "design", "tasks", "apply", "verify", "archive"] as const;
type SevenDependency = (typeof SEVEN_DEPENDENCIES)[number];
export type JeroSddDependencyStateV1 = "blocked" | "ready" | "all_done";

/** 上游的 12 值词汇，外加 TS 解析器可能发出的 jero 专属推荐（“sync”、“fix-task-ownership-marker”、“resolve-via-engram”、“blocked”）。 */
export type JeroSddNextRecommendedV1 =
	| "apply" | "verify" | "remediate" | "archive" | "archived" | "resolve-blockers" | "sdd-new" | "select-change" | "propose" | "spec" | "design" | "tasks"
	| "sync" | "fix-task-ownership-marker" | "resolve-via-engram" | "blocked";

export interface JeroSddStatusV2 {
	schemaName: "gentle-ai.sdd-status";
	schemaVersion: 2;
	changeName: string | null;
	artifactStore: SddArtifactStore;
	planningHome: { mode: "repo-local"; path: string };
	changeRoot: string | null;
	actionContext: { mode: "repo-local"; workspaceRoot: string; allowedEditRoots: readonly string[] };
	dependencies: Record<SevenDependency, JeroSddDependencyStateV1>;
	phaseInstructions?: { apply: readonly string[]; verify: readonly string[]; remediate: readonly string[]; archive: readonly string[] };
	blockedReasons: readonly string[];
	nextRecommended: JeroSddNextRecommendedV1;
}

export type JeroSddStatusRefusalCode = "invalid-request" | "projection-violation";

export type JeroSddStatusResultV1 =
	| { readonly kind: "ok"; readonly status: JeroSddStatusV2; readonly isNonAuthoritative: boolean }
	| { readonly kind: "refused"; readonly code: JeroSddStatusRefusalCode; readonly detail: string };

const NEXT_RECOMMENDED_MAP: Readonly<Record<string, JeroSddNextRecommendedV1>> = {
	"sdd-propose": "propose",
	"sdd-spec": "spec",
	"sdd-design": "design",
	"sdd-tasks": "tasks",
	"sdd-apply": "apply",
	"sdd-verify": "verify",
	"sdd-archive": "archive",
	archived: "archived",
	"sdd-sync": "sync",
	"fix-task-ownership-marker": "fix-task-ownership-marker",
	"resolve-via-engram": "resolve-via-engram",
	blocked: "blocked",
};

function artifactDependency(state: "missing" | "done" | "partial"): JeroSddDependencyStateV1 {
	return state === "missing" ? "blocked" : state === "partial" ? "ready" : "all_done";
}

function selfCheckV2(record: JeroSddStatusV2, workspaceRoot: string): void {
	const expectedOpenSpecHome = join(workspaceRoot, "openspec");
	if (record.planningHome.path !== expectedOpenSpecHome && !((record.artifactStore === "engram" || record.artifactStore === "hybrid") && record.planningHome.path === "engram:sdd")) {
		throw new Error("projected planning home escaped its workspace");
	}
	if (Object.keys(record.dependencies).length !== SEVEN_DEPENDENCIES.length) throw new Error("projected dependencies must carry exactly the seven phase keys");
	if ((record as unknown as Record<string, unknown>).instructions !== undefined) throw new Error("projected status must use phaseInstructions, not instructions");
	if (record.actionContext.workspaceRoot !== workspaceRoot) throw new Error("projected action context workspace root mismatch");
	if (!record.actionContext.allowedEditRoots.includes(workspaceRoot)) throw new Error("projected allowed edit roots must include the workspace root");
	if (record.phaseInstructions !== undefined && Object.keys(record.phaseInstructions).some((phase) => !["apply", "verify", "remediate", "archive"].includes(phase))) throw new Error("projected phase instructions carry an unsupported phase");
	if (record.phaseInstructions !== undefined && Object.keys(record.phaseInstructions).length !== 4) throw new Error("projected phase instructions must carry exactly the four native phases");
}

/**
 * `sdd.status`——只读投影。`changeName` 与上游请求一样是可选的；解析器
 * 的选择歧义与空存储行为以各自的 nextRecommended 值呈现，绝不作为
 * 拒绝。
 */
export function jeroSddStatusV1(_context: JeroAuthorityContextV1, request: { changeName?: string; workspaceRoot: string }): JeroSddStatusResultV1 {
	if (request.changeName !== undefined && (request.changeName.trim() !== request.changeName || request.changeName.includes("\0"))) {
		return { kind: "refused", code: "invalid-request", detail: "changeName must be a canonical process string" };
	}
	if (!isAbsolute(request.workspaceRoot)) {
		return { kind: "refused", code: "invalid-request", detail: "workspaceRoot must be absolute" };
	}
	const resolved: SddStatus = resolveSddStatus({ cwd: request.workspaceRoot, changeName: request.changeName, includeInstructions: true });
	const authoritative = !resolved.isNonAuthoritative;
	const planningHomePath = !authoritative && (resolved.artifactStore === "engram" || resolved.artifactStore === "hybrid")
		? "engram:sdd"
		: join(request.workspaceRoot, "openspec");
	const applyDependency: JeroSddDependencyStateV1 = resolved.applyState === "not_applicable" ? "ready" : resolved.applyState;
	const verifyDependency: JeroSddDependencyStateV1 = resolved.archived !== undefined
		? "all_done"
		: resolved.applyState !== "all_done"
			? "blocked"
			: resolved.artifacts.verifyReport === "done"
				? "all_done"
				: "ready";
	const dependencies = {
		proposal: artifactDependency(resolved.artifacts.proposal),
		specs: artifactDependency(resolved.artifacts.specs),
		design: artifactDependency(resolved.artifacts.design),
		tasks: artifactDependency(resolved.artifacts.tasks),
		apply: applyDependency,
		verify: verifyDependency,
		archive: (resolved.archived !== undefined ? "all_done" : resolved.nextRecommended === "sdd-archive" ? "ready" : "blocked") as JeroSddDependencyStateV1,
	} satisfies Record<SevenDependency, JeroSddDependencyStateV1>;
	const nextRecommended = NEXT_RECOMMENDED_MAP[resolved.nextRecommended] ?? (resolved.changeName === null ? "select-change" : "resolve-blockers");
	const record: JeroSddStatusV2 = {
		schemaName: "gentle-ai.sdd-status",
		schemaVersion: 2,
		changeName: resolved.changeName,
		artifactStore: resolved.artifactStore,
		planningHome: { mode: "repo-local", path: planningHomePath },
		changeRoot: resolved.changeRoot,
		actionContext: { mode: "repo-local", workspaceRoot: resolved.actionContext.workspaceRoot, allowedEditRoots: [...resolved.actionContext.allowedEditRoots] },
		dependencies,
		...(resolved.instructions === undefined ? {} : { phaseInstructions: { apply: [...resolved.instructions.apply], verify: [...resolved.instructions.verify], remediate: [], archive: [...resolved.instructions.archive] } }),
		blockedReasons: [...resolved.blockedReasons],
		nextRecommended,
	};
	try {
		selfCheckV2(record, request.workspaceRoot);
	} catch (error) {
		return { kind: "refused", code: "projection-violation", detail: error instanceof Error ? error.message : String(error) };
	}
	return { kind: "ok", status: record, isNonAuthoritative: resolved.isNonAuthoritative };
}
