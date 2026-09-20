import { readFileSync } from "node:fs";

const runtimeSchema = JSON.parse(readFileSync(new URL("../schemas/runtime-aggregate-v1.schema.json", import.meta.url), "utf8"));

// 纯本地记账，不是遥测传输或 Pi 事件适配器。
// 调用方提供已定稿的助手响应与权威分类。
// 绝不从 SDK 默认值推断执行者、用量可用性或实测时长。
const EXECUTORS = ["orchestrator", "worker", "reviewer", "unknown"] as const;
// 稳定的家族，而非模型 ID/版本：新模型无需更新目录。
// 调用方把已知的原生元数据映射到家族；私有别名保持 custom。
const FAMILIES = ["claude", "gpt", "o-series", "gemini", "llama", "qwen", "deepseek", "kimi", "custom", "unknown"] as const;
// Pi 0.85.1 docs/models.md 的 Thinking Level Map。这些是选定的 Pi 层级，
// 不是推断的提供方 effort，也不声称每个模型都支持每个层级。
export const EFFORTS = ["off", "minimal", "low", "medium", "high", "xhigh", "max", "not_selected", "unsupported", "unavailable"] as const;
const ERRORS = ["none", "aborted", "rate_limit", "authentication", "network", "provider", "unknown"] as const;
const TOKEN_FIELDS = ["input", "output", "cacheRead", "cacheWrite", "reasoning", "totalTokens"] as const;
declare const agentClassBrand: unique symbol;
export type AgentClass = string & { readonly [agentClassBrand]: "AgentClass" };

function agentClasses(): readonly AgentClass[] {
	const values: unknown = runtimeSchema?.$defs?.row?.properties?.agent_class?.enum;
	if (!Array.isArray(values) || !values.length || values.some(value => typeof value !== "string")) {
		throw new Error("Invalid runtime telemetry agent_class schema");
	}
	return Object.freeze([...values]) as readonly AgentClass[];
}

// 镜像的传输契约是运行时的事实源。保持数据驱动，让打包代理的更新
// 跟随封闭枚举，而不需要第二份在 TypeScript 里漂移的名称注册表。
export const AGENT_CLASSES = agentClasses();
export function parseAgentClass(value: unknown): AgentClass | undefined {
	return typeof value === "string" && (AGENT_CLASSES as readonly string[]).includes(value) ? value as AgentClass : undefined;
}
function requiredAgentClass(value: string): AgentClass {
	const parsed = parseAgentClass(value);
	if (!parsed) throw new Error(`Runtime telemetry schema is missing required agent_class ${value}`);
	return parsed;
}
export const UNKNOWN_AGENT_CLASS = requiredAgentClass("unknown");
export const ORCHESTRATOR_AGENT_CLASS = requiredAgentClass("orchestrator");

interface ModelFieldRule { pattern: RegExp; maxLength: number }

function modelFieldRule(field: "provider" | "id"): ModelFieldRule {
	// 长度上限位于 $defs.model.properties.<field>；形状模式只位于
	// $defs.model.anyOf 的第一个（公开模式）分支上，紧邻 unknown/custom/
	// opencode 哨兵分支。两者都逐字节镜像自 Jero 传输 schema。
	const property: unknown = runtimeSchema?.$defs?.model?.properties?.[field];
	if (!object(property) || typeof property.maxLength !== "number") {
		throw new Error(`Invalid runtime telemetry model ${field} schema`);
	}
	const branches: unknown = runtimeSchema?.$defs?.model?.anyOf;
	const patternProperty = Array.isArray(branches) && object(branches[0]) && object(branches[0].properties)
		? branches[0].properties[field] : undefined;
	if (!object(patternProperty) || typeof patternProperty.pattern !== "string") {
		throw new Error(`Invalid runtime telemetry model ${field} schema`);
	}
	return { pattern: new RegExp(patternProperty.pattern), maxLength: property.maxLength };
}

// 由 schema 驱动，而非硬编码的 TypeScript 正则：镜像的传输契约持有
// provider/id 形状的开放家族模式规则。配套的 Jero 变更让 Go 侧保持
// 相同的模式。
const MODEL_PROVIDER_RULE = modelFieldRule("provider");
const MODEL_ID_RULE = modelFieldRule("id");

/** 只做提供方归一化，独立于任何具体模型 id：修剪、转小写，且只有当
 * slug 在 maxLength 内匹配 schema 提供方模式时才保留。非字符串/空
 * 输入为 "unknown"；不合规的非空字符串为 "custom"。由独立的提供方
 * 维度与 normalizeRuntimeModel 自身的提供方处理共享。
 */
export function normalizeRuntimeProvider(value: unknown): string {
	if (typeof value !== "string") return "unknown";
	const trimmed = value.trim();
	if (!trimmed) return "unknown";
	const lower = trimmed.toLowerCase();
	return lower.length <= MODEL_PROVIDER_RULE.maxLength && MODEL_PROVIDER_RULE.pattern.test(lower) ? lower : "custom";
}

/** 面向 (provider, id) 选择或响应对的通用 schema 驱动家族模式归一器
 * （gentle-pi#968 / gentle-ai#4536）。任意提供方上的开放权重模型按
 * 名称上报；私有别名与微调保持 custom。规则与镜像的 Go/schema 侧
 * 完全一致：
 *  - 非字符串或空的 provider/id 保守失败为 unknown/unknown；
 *  - id：修剪、保留最后一个 “/” 分隔段、转小写；只有在其 maxLength
 *    内匹配 schema id 模式时才算公开，否则为 "custom"；
 *  - provider：修剪、转小写；匹配 schema 提供方模式时保留，否则为
 *    "custom"；
 *  - id 不公开时 provider 也变为 "custom"，唯一例外是 "opencode"，
 *    它保持 opencode/custom；
 *  - 字面的 unknown/unknown 与 custom/custom 组合直接透传。
 */
export function normalizeRuntimeModel(provider: unknown, id: unknown): { provider: string; id: string } {
	if (typeof provider !== "string" || typeof id !== "string") return { provider: "unknown", id: "unknown" };
	const providerTrimmed = provider.trim();
	const idTrimmed = id.trim();
	if (!providerTrimmed || !idTrimmed) return { provider: "unknown", id: "unknown" };
	const providerLower = providerTrimmed.toLowerCase();
	const idSegment = idTrimmed.split("/").pop() ?? "";
	const idLower = idSegment.toLowerCase();
	if (providerLower === "unknown" && idLower === "unknown") return { provider: "unknown", id: "unknown" };
	if (providerLower === "custom" && idLower === "custom") return { provider: "custom", id: "custom" };
	const idPublic = idLower.length <= MODEL_ID_RULE.maxLength && MODEL_ID_RULE.pattern.test(idLower);
	const id_ = idPublic ? idLower : "custom";
	let providerResult = normalizeRuntimeProvider(providerTrimmed);
	if (!idPublic) providerResult = providerResult === "opencode" ? "opencode" : "custom";
	return { provider: providerResult, id: id_ };
}

/** normalizeRuntimeModel 的薄封装，供只跟踪 id 维度的调用方使用
 * （provider 只用于决定封闭的 unknown/空快速路径；合法的非空 provider
 * 字符串绝不会改变 id 结果）。
 */
export function classifyRuntimeModelId(provider: unknown, modelId: unknown): string {
	return normalizeRuntimeModel(provider, modelId).id;
}

/** 仅当 id 已处于归一化的公开形态时为 true：它在 maxLength 内匹配
 * schema id 模式（按构造这也排除了 "unknown"/"custom" 哨兵，因为两者
 * 都不匹配任何已识别的家族前缀）。用于在已分类的 id 维度
 * （response/selected/observed）中挑选最强的可用证据层级。
 */
export function isPublicRuntimeModelId(value: unknown): value is string {
	return typeof value === "string" && value.length > 0 && value.length <= MODEL_ID_RULE.maxLength && MODEL_ID_RULE.pattern.test(value);
}

type Missing = { state: "unavailable" | "unsupported" };
export type TokenMeasurement = Missing | { state: "reported"; value: number };
export type DurationMeasurement = Missing | { state: "measured"; value: number };
export interface FinalResponse {
	kind: "final_assistant_response";
	/** 仅用于本地去重：1..128 个 UTF-16 码元；绝不导出。 */
	responseId: string;
	/** 调用方观察到的所选 SDK 模型 ID，绝非派发/响应身份。
	 * 记录时经 normalizeRuntimeModel 归一化；只有匹配 schema 家族
	 * 模式的 id 才以公开名称幸存。
	 */
	selectedModelId?: string;
	/** 选择命名空间，独立于观察到的响应提供方。
	 * 省略以保持旧版同提供方调用方的兼容；适配器必须显式传入。
	 */
	selectedProvider?: string;
	agentClass?: AgentClass;
	/** 从响应元数据观察到的 SDK 模型 id，绝非端点证明。
	 * 与 selectedModelId 同样归一化；只有 schema 家族匹配才幸存。
	 */
	observedModelId?: string;
	responseModelId?: string;
	providerThinkingLevel?: typeof EFFORTS[number];
	executor: typeof EXECUTORS[number];
	provider: string;
	modelFamily: typeof FAMILIES[number];
	effort: typeof EFFORTS[number];
	error: typeof ERRORS[number];
	/** 独立的原生计数器；不要把缓存 token 加进这里的 input。 */
	tokens: Record<"input" | "output" | "cacheRead" | "cacheWrite", TokenMeasurement>
		& Partial<Record<"reasoning" | "totalTokens", TokenMeasurement>>;
	/** 从请求开始到响应头；不是首 token，也不是完整响应。 */
	responseHeadersMs: DurationMeasurement;
	/** 同一请求开始到响应完成；只接受显式测得的值。 */
	fullResponseMs: DurationMeasurement;
}

interface TokenTotals { reported: number; unavailable: number; unsupported: number; sum: number }
interface DurationTotals { measured: number; unavailable: number; unsupported: number; sum: number }
export interface RuntimeMetricBucket {
	hostAgent: "pi";
	agentClass: AgentClass;
	observedModelId: string;
	responseModelId: string;
	providerThinkingLevel: typeof EFFORTS[number];
	selectedModelId: string;
	selectedProvider: FinalResponse["provider"];
	executor: FinalResponse["executor"];
	provider: FinalResponse["provider"];
	modelFamily: FinalResponse["modelFamily"];
	effort: FinalResponse["effort"];
	error: FinalResponse["error"];
	responses: number;
	tokens: Record<typeof TOKEN_FIELDS[number], TokenTotals>;
	responseHeadersMs: DurationTotals;
	fullResponseMs: DurationTotals;
}

function object(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function member<T extends string>(values: readonly T[], value: unknown): value is T {
	return typeof value === "string" && values.includes(value as T);
}

function category<T extends string>(values: readonly T[], value: unknown, fallback: T): T {
	return member(values, value) ? value : fallback;
}

function measurement(value: unknown, present: "reported" | "measured"): boolean {
	if (!object(value)) return false;
	if (value.state === "unavailable" || value.state === "unsupported") return !("value" in value);
	if (value.state !== present || typeof value.value !== "number") return false;
	const n = value.value;
	// 硬上限保证即使到达容量，整数计数器的每个和仍是有限且精确的。
	return Number.isFinite(n) && n >= 0 && (present === "reported"
		? Number.isSafeInteger(n) && n <= 1_000_000_000
		: n <= 86_400_000);
}

export function validRuntimeResponse(value: unknown): value is FinalResponse {
	if (!object(value) || value.kind !== "final_assistant_response") return false;
	if (typeof value.responseId !== "string" || value.responseId.length < 1 || value.responseId.length > 128) return false;
	if (!member(EFFORTS, value.effort) || !member(ERRORS, value.error)) return false;
	const tokens = value.tokens;
	if (!object(tokens) || !TOKEN_FIELDS.every(key => measurement(tokens[key] === undefined && ["reasoning", "totalTokens"].includes(key)
		? { state: "unavailable" } : tokens[key], "reported"))) return false;
	if (!measurement(value.responseHeadersMs, "measured") || !measurement(value.fullResponseMs, "measured")) return false;
	const headers = value.responseHeadersMs as DurationMeasurement;
	const full = value.fullResponseMs as DurationMeasurement;
	return headers.state !== "measured" || full.state !== "measured" || headers.value <= full.value;
}

function tokenTotals(): TokenTotals {
	return { reported: 0, unavailable: 0, unsupported: 0, sum: 0 };
}

function durationTotals(): DurationTotals {
	return { measured: 0, unavailable: 0, unsupported: 0, sum: 0 };
}

function addDuration(totals: DurationTotals, value: DurationMeasurement): void {
	totals[value.state] += 1;
	if (value.state === "measured") totals.sum += value.value;
}

/**
 * 最多接受 1024 个响应/ID、64 个维度桶，每个 ID 最多 128 个码元。
 * 不做淘汰：一旦到达容量，新记录（含已存在的桶）被原子性拒绝；
 * 已接受的 ID 保持去重。无效/被拒绝的 ID 不被保留。新实例开启新的
 * 记账窗口，不保证跨实例/生命周期去重。没有重置/清空 API：窗口
 * 归属与交付仍是后续工作。运行时消耗与确定性的 SDD/RDD 计数保持
 * 分离；不做闭包归因或桥接。快照只包含封闭维度与有界的数值聚合。
 */
export class RuntimeMetrics {
	#ids = new Set<string>();
	#buckets = new Map<string, RuntimeMetricBucket>();
	#maxResponses: number;
	#maxBuckets: number;

	constructor({ maxResponses = 1024, maxBuckets = 64 }: { maxResponses?: number; maxBuckets?: number } = {}) {
		if (!Number.isInteger(maxResponses) || maxResponses < 1 || maxResponses > 1024
			|| !Number.isInteger(maxBuckets) || maxBuckets < 1 || maxBuckets > 64) {
			throw new RangeError("Invalid runtime metrics capacity");
		}
		this.#maxResponses = maxResponses;
		this.#maxBuckets = maxBuckets;
	}

	record(response: FinalResponse): "recorded" | "duplicate" | "invalid" | "capacity" {
		if (!validRuntimeResponse(response)) return "invalid";
		if (this.#ids.has(response.responseId)) return "duplicate";
		const selectedProvider = response.selectedProvider ?? response.provider;
		const dimensions = {
			hostAgent: "pi" as const,
			agentClass: category(AGENT_CLASSES, response.agentClass, UNKNOWN_AGENT_CLASS),
			observedModelId: classifyRuntimeModelId(response.provider, response.observedModelId),
			responseModelId: classifyRuntimeModelId(response.provider, response.responseModelId),
			providerThinkingLevel: category(EFFORTS, response.providerThinkingLevel, "unavailable"),
			selectedModelId: classifyRuntimeModelId(selectedProvider, response.selectedModelId),
			selectedProvider: normalizeRuntimeProvider(selectedProvider),
			executor: category(EXECUTORS, response.executor, "unknown"),
			provider: normalizeRuntimeProvider(response.provider),
			modelFamily: category(FAMILIES, response.modelFamily, typeof response.modelFamily === "string" && response.modelFamily ? "custom" : "unknown"),
			effort: response.effort,
			error: response.error,
		};
		const key = JSON.stringify(dimensions);
		let bucket = this.#buckets.get(key);
		if (this.#ids.size >= this.#maxResponses || (!bucket && this.#buckets.size >= this.#maxBuckets)) return "capacity";
		if (!bucket) {
			bucket = {
				...dimensions, responses: 0,
				tokens: { input: tokenTotals(), output: tokenTotals(), cacheRead: tokenTotals(), cacheWrite: tokenTotals(), reasoning: tokenTotals(), totalTokens: tokenTotals() },
				responseHeadersMs: durationTotals(), fullResponseMs: durationTotals(),
			};
			this.#buckets.set(key, bucket);
		}
		this.#ids.add(response.responseId);
		bucket.responses += 1;
		for (const field of TOKEN_FIELDS) {
			const value = response.tokens[field] ?? { state: "unavailable" as const };
			bucket.tokens[field][value.state] += 1;
			if (value.state === "reported") bucket.tokens[field].sum += value.value;
		}
		addDuration(bucket.responseHeadersMs, response.responseHeadersMs);
		addDuration(bucket.fullResponseMs, response.fullResponseMs);
		return "recorded";
	}

	snapshot(): RuntimeMetricBucket[] {
		return structuredClone([...this.#buckets.values()]);
	}
}
