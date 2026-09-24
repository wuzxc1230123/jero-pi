// SDD 预检偏好：执行模式/工件库/链式 PR 策略的类型、默认值、会话缓存与磁盘持久化。
// 自 lib/sdd-preflight.ts 拆分（机械平移，语义零改动）。

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { type SddArtifactStore } from "./sdd-status.ts";
export type SddExecutionMode = "interactive" | "auto";
export type SddDeliveryStrategy =
	| "ask-on-risk"
	| "auto-chain"
	| "single-pr"
	| "exception-ok";
/** @deprecated 请改用 SddDeliveryStrategy；旧值在持久化边界归一化。 */
export type SddChainedPrStrategy =
	| SddDeliveryStrategy
	| "auto-forecast"
	| "ask-always"
	| "single-pr-default"
	| "force-chained";
export type SddPreflightField = "executionMode" | "artifactStore" | "chainedPrStrategy" | "reviewBudgetLines";
export const SDD_PREFLIGHT_FIELDS = ["executionMode", "artifactStore", "chainedPrStrategy", "reviewBudgetLines"] as const;
// 父级派发与进程生成边界共享这份精确的已发布
// 清单，使新打包的 SDD 角色无法绕过预检传输。
export const SHIPPED_SDD_AGENT_NAMES = Object.freeze([
	"sdd-init",
	"sdd-onboard",
	"sdd-explore",
	"sdd-research",
	"sdd-proposal",
	"sdd-spec",
	"sdd-design",
	"sdd-tasks",
	"sdd-status",
	"sdd-apply",
	"sdd-verify",
	"sdd-sync",
	"sdd-archive",
	"sdd-remediate",
]);

export interface SddPreflightPreferences {
	executionMode: SddExecutionMode;
	artifactStore: SddArtifactStore;
	/** 运行时值为权威值；旧赋值在持久化/渲染边界归一化。 */
	chainedPrStrategy: SddChainedPrStrategy;
	reviewBudgetLines: number;
	engramAvailable: boolean;
	prompted: boolean;
	sizeExceptionAccepted?: true;
}

export interface SddPreflightResolutionOptions {
	persisted?: Partial<SddPreflightPreferences>;
	promptFields?: readonly SddPreflightField[];
	acceptSizeException?: true;
}

export interface SddPreflightCallbacks {
	pi: ExtensionAPI;
	installAssets?: (cwd: string) =>
		| {
				agents: number;
				chains: number;
				support: number;
				skipped: number;
		  }
		| Promise<{
				agents: number;
				chains: number;
				support: number;
				skipped: number;
		  }>;
	applyModelConfig?: (
		cwd: string,
	) =>
		| { updated: number; skipped: number; invalidPath?: string }
		| Promise<{ updated: number; skipped: number; invalidPath?: string }>;
}

export interface ManagedAssetsManifest {
	schemaVersion: number;
	assets: Record<string, string>;
}

export interface LegacyManagedAssetsManifest extends ManagedAssetsManifest {
	packageVersion: string;
}

export interface ManagedAssetsLockOwner {
	schemaVersion: 1;
	token: string;
	pid: number;
	createdAtMs: number;
}

/** @internal hold 选项的存在只是为了让进程锁回归测试可确定。 */
export interface PackageAssetInstallLockOptions {
	timeoutMs?: number;
	retryMs?: number;
	holdLockMs?: number;
}

export const DEFAULT_SDD_PREFLIGHT: SddPreflightPreferences = Object.freeze({
	executionMode: "auto",
	artifactStore: "openspec",
	chainedPrStrategy: "ask-on-risk",
	reviewBudgetLines: 400,
	engramAvailable: false,
	prompted: false,
});

export const sddPreflightBySession = new Map<string, SddPreflightPreferences>();
export const sddPreflightInFlight = new Map<string, Promise<SddPreflightPreferences>>();

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSddExecutionMode(value: unknown): value is SddExecutionMode {
	return value === "interactive" || value === "auto";
}

function isSddArtifactStore(value: unknown): value is SddArtifactStore {
	return value === "openspec" || value === "engram" || value === "hybrid" || value === "none";
}

// normalizeSddArtifactStore 接受权威命名以及双存储模式的旧拼写 "both"。
// 改名之前写入的操作员预检文件在磁盘上携带 "both"；
// 拒绝它会静默把操作员的选择丢回默认值，
// 因此选择向前映射。
export function normalizeSddArtifactStore(value: unknown): SddArtifactStore | undefined {
	if (value === "both") return "hybrid";
	return isSddArtifactStore(value) ? value : undefined;
}

function normalizeReviewBudgetValue(value: unknown): number | undefined {
	const parsed = typeof value === "number"
		? value
		: typeof value === "string"
			? Number.parseInt(value.trim(), 10)
			: Number.NaN;
	return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : undefined;
}

function normalizeSddStrategySelection(
	value: unknown,
	allowExceptionOk: boolean,
): SddDeliveryStrategy | undefined {
	if (value === "exception-ok") return allowExceptionOk ? value : undefined;
	if (value === "auto-forecast" || value === "ask-always") return "ask-on-risk";
	if (value === "single-pr-default") return "single-pr";
	if (value === "force-chained") return "auto-chain";
	return value === "ask-on-risk" || value === "auto-chain" || value === "single-pr"
		? value
		: undefined;
}

export function normalizeSddChainedPrStrategy(
	value: unknown,
	allowExceptionOk = false,
): SddDeliveryStrategy {
	return normalizeSddStrategySelection(value, allowExceptionOk) ?? "ask-on-risk";
}

export function normalizedSelections(
	value: Partial<Record<SddPreflightField, unknown>> | undefined,
	engramAvailable: boolean,
	allowExceptionOk: boolean,
): Partial<Record<SddPreflightField, unknown>> {
	if (!value) return {};
	const result: Partial<Record<SddPreflightField, unknown>> = {};
	if (isSddExecutionMode(value.executionMode)) result.executionMode = value.executionMode;
	const artifactStore = normalizeSddArtifactStore(value.artifactStore);
	if (artifactStore !== undefined && (engramAvailable || artifactStore === "openspec" || artifactStore === "none")) result.artifactStore = artifactStore;
	const strategy = normalizeSddStrategySelection(value.chainedPrStrategy, allowExceptionOk);
	if (strategy) result.chainedPrStrategy = strategy;
	const reviewBudgetLines = normalizeReviewBudgetValue(value.reviewBudgetLines);
	if (reviewBudgetLines !== undefined) result.reviewBudgetLines = reviewBudgetLines;
	return result;
}


export function sddPreflightDiskPath(cwd: string): string {
	return join(cwd, ".pi", "jero", "sdd-preflight.json");
}

export function readSddPreflightFromDisk(cwd: string): SddPreflightPreferences | undefined {
	const path = sddPreflightDiskPath(cwd);
	if (!existsSync(path)) return undefined;
	try {
		const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
		if (!isRecord(parsed)) return undefined;
		// 校验必填字段，防范过期/损坏的写入。
		const { executionMode, artifactStore, chainedPrStrategy, reviewBudgetLines, engramAvailable, prompted } = parsed;
		// 校验之前先归一化：双存储改名之前写入的预检
		// 文件携带 "both"，丢弃它会静默把操作员的
		// 选择丢回默认值。
		const canonicalArtifactStore = normalizeSddArtifactStore(artifactStore);
		if (
			!isSddExecutionMode(executionMode) ||
			canonicalArtifactStore === undefined ||
			typeof reviewBudgetLines !== "number" ||
			!Number.isFinite(reviewBudgetLines) ||
			reviewBudgetLines <= 0 ||
			typeof engramAvailable !== "boolean" ||
			typeof prompted !== "boolean"
		) {
			return undefined;
		}
		return {
			executionMode,
			artifactStore: canonicalArtifactStore,
			chainedPrStrategy: normalizeSddChainedPrStrategy(chainedPrStrategy),
			reviewBudgetLines: normalizeReviewBudgetValue(reviewBudgetLines) ?? DEFAULT_SDD_PREFLIGHT.reviewBudgetLines,
			engramAvailable,
			prompted,
		};
	} catch {
		return undefined;
	}
}

/**
 * 持久化偏好到磁盘。失败不抛出（内存会话缓存是主存储），但返回 false
 * 让调用方可以告知用户"本次会话内生效、未写入磁盘"。
 */
export function writeSddPreflightToDisk(cwd: string, prefs: SddPreflightPreferences): boolean {
	try {
		const path = sddPreflightDiskPath(cwd);
		const prompted = prefs.prompted === true;
		const canonical: SddPreflightPreferences = {
			executionMode: isSddExecutionMode(prefs.executionMode) ? prefs.executionMode : DEFAULT_SDD_PREFLIGHT.executionMode,
			artifactStore: normalizeSddArtifactStore(prefs.artifactStore) ?? DEFAULT_SDD_PREFLIGHT.artifactStore,
			chainedPrStrategy: normalizeSddChainedPrStrategy(prefs.chainedPrStrategy),
			reviewBudgetLines:
				normalizeReviewBudgetValue(prefs.reviewBudgetLines) ??
				DEFAULT_SDD_PREFLIGHT.reviewBudgetLines,
			engramAvailable: prefs.engramAvailable === true,
			prompted,
		};
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, JSON.stringify(canonical, null, 2));
		return true;
	} catch {
		// 磁盘写入失败非致命；内存缓存是主存储
		return false;
	}
}

