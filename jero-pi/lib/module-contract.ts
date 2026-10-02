// 能力模块契约（jero.module-contract/v2，兼容 v1）——编排面扩展的机器验证单元。
//
// 设计：一个模块 = 一个目录 + 一份 module.json 清单，声明四个面
// （触发/知识/角色/接线）。语义判断变数据：静态触发器由机器对仓库
// 文件树判定（lib/module-trigger-compiler.ts），路由规则消费路由单
// （RoutingSlip，见 assets/orchestrator-delegation.md）字段，角色档案
// 携带隔离正当性——孤儿代理在安装验证时被拒绝，而不是运行时静默不被
// 委派。规范见 docs/module-contract.md。
//
// v2 = v1 + dependencies（模块间依赖自述）：安装器（lib/module-installer.ts）
// 据此做闭包解析与依赖先装，安装验证做缺失/成环的响亮失败。

export const MODULE_CONTRACT_V1 = "jero.module-contract/v1";
export const MODULE_CONTRACT_V2 = "jero.module-contract/v2";
// 发布面接受两个契约版本；v1 清单继续通过（向后兼容），dependencies
// 字段仅 v2 可用——封闭契约的演进纪律，不搞静默宽容。
export const MODULE_CONTRACT_IDS = [MODULE_CONTRACT_V1, MODULE_CONTRACT_V2] as const;
export type ModuleContractId = (typeof MODULE_CONTRACT_IDS)[number];

// 编排面 S1–S8：orchestrator 真实派发情况中扩展可参与的位置。
// S9（事故诊断）与 S10（继续/恢复）刻意不开放：后者是纯机械层。
export const BINDING_SURFACES = [
	"inline",
	"explore",
	"worker",
	"verify",
	"sdd-planning",
	"sdd-execution",
	"review",
	"answer",
] as const;
export type BindingSurface = (typeof BINDING_SURFACES)[number];

// 知识注入档位：L0（manifest 行）/ L1（entry 正文）。references 是 L2，
// 由子代理按需自读，不参与注入计划。
export const INJECT_LEVELS = ["manifest-only", "entry"] as const;
export type InjectLevel = (typeof INJECT_LEVELS)[number];

// 角色存在的正当理由（四选一以上）。无正当理由的角色 = 知识型意图，
// 安装验证拒绝——这是孤儿代理的源头灭绝机制。
export const ISOLATION_REASONS = [
	"adversarial-eyes",
	"least-privilege",
	"context-economy",
	"parallel-fanout",
] as const;
export type IsolationReason = (typeof ISOLATION_REASONS)[number];

// 权限预设：编译期展开为工具白名单，模块不手写工具清单。
export const PERMISSION_PRESETS = {
	"read-only": ["read", "grep", "find"],
	scan: ["read", "grep"],
	"write-bounded": ["read", "grep", "find", "edit", "write", "bash"],
} as const;
export type PermissionPreset = keyof typeof PERMISSION_PRESETS;

export function expandPermissionPreset(preset: PermissionPreset): readonly string[] {
	return PERMISSION_PRESETS[preset] ?? [];
}

// 模型档位与 SDD 阶段表（assets/sdd-orchestrator-workflow.md 模型分配）对齐。
export const MODEL_TIERS = ["fast", "balanced", "deep-reasoning"] as const;
export type ModelTier = (typeof MODEL_TIERS)[number];

export const ROUTING_ACTIONS = ["suggest-role", "delegate-role"] as const;
export type RoutingAction = (typeof ROUTING_ACTIONS)[number];

// 路由单可被 routing.when.slip 引用的字段（见编排器路由单协议）。
export const SLIP_UTTERANCE_TYPES = [
	"qa",
	"micro-edit",
	"implement",
	"explore",
	"verify",
	"design-request",
	"review",
	"incident",
	"continue",
] as const;
export type SlipUtteranceType = (typeof SLIP_UTTERANCE_TYPES)[number];

export const SLIP_DELIVERABLES = ["decision", "document", "plan-then-code"] as const;
export type SlipDeliverable = (typeof SLIP_DELIVERABLES)[number];

export const SLIP_IRREVERSIBILITY = ["reversible", "recoverable", "archaeology"] as const;
export type SlipIrreversibility = (typeof SLIP_IRREVERSIBILITY)[number];

// 包内代理前缀族与包内代理名：token/角色名的防遮蔽名单。
export const PACKAGE_AGENT_PREFIXES = ["jero-", "review-", "sdd-", "jd-"] as const;

export const BUILTIN_AGENT_NAMES = [
	"jd-fix-agent",
	"jd-judge-a",
	"jd-judge-b",
	"jero-explore",
	"jero-verify",
	"jero-worker",
	"review-readability",
	"review-reliability",
	"review-resilience",
	"review-risk",
	"sdd-apply",
	"sdd-archive",
	"sdd-design",
	"sdd-explore",
	"sdd-init",
	"sdd-onboard",
	"sdd-proposal",
	"sdd-remediate",
	"sdd-research",
	"sdd-spec",
	"sdd-status",
	"sdd-sync",
	"sdd-tasks",
	"sdd-verify",
] as const;

// entry 正文行数上限：渐进披露是门，不是纪律。L1 每次命中被完整注入，
// 深度必须住在 references（L2）。
export const MAX_ENTRY_LINES = 60;

/**
 * MCP 服务器名（安装器把它作为 Pi agent mcp.json 的 mcpServers 键合并写入；
 * 仅 v2 可声明，声明≠安装工具链——command 必须在用户机器上可用）。
 */
export const MCP_SERVER_NAME_PATTERN = /^[a-z][a-z0-9-]{1,31}$/;

export interface McpServerSpec {
	readonly name: string;
	/** stdio 启动命令（如 uvx）；可用性由宿主/doctor 显影，安装器不做网络安装。 */
	readonly command: string;
	readonly args?: readonly string[];
	readonly env?: Readonly<Record<string, string>>;
}

export interface McpSpec {
	readonly servers: readonly McpServerSpec[];
}

/**
 * 包内束（assets/modules/*）允许的 MCP 启动命令白名单：只许解析器代理
 * （uvx/npx）+ 精确钉版，禁止任意可执行件——把"被投毒包写任意命令"的
 * 供应链面收窄为"钉一个 registry 包"。项目内手工模块不受此限（自己的
 * 项目自己负责），门（check-module-contract）只对包内束强制。
 */
export const BUNDLED_MCP_COMMANDS = ["uvx", "npx"] as const;

const MCP_PIN_TOKEN_PATTERN = /^@?[a-z0-9][/a-z0-9._-]*@\d+\.\d+\.\d+([-+][0-9A-Za-z.-]+)?$/;

/** 包内束 MCP 档的供应链策略校验：违例返回人话描述，合规返回 undefined。 */
export function bundledMcpServerViolation(server: McpServerSpec): string | undefined {
	if (!(BUNDLED_MCP_COMMANDS as readonly string[]).includes(server.command)) {
		return `command 必须是 ${BUNDLED_MCP_COMMANDS.join(" / ")} 之一（包内束禁止任意可执行件）`;
	}
	if (server.env !== undefined && Object.keys(server.env).length > 0) {
		return "包内束 MCP 档禁止携带 env（凭证属宿主环境，不进包）";
	}
	if (!(server.args ?? []).some((arg) => MCP_PIN_TOKEN_PATTERN.test(arg))) {
		return "args 必须含 pkg@精确语义化版本 的钉版 token（如 godot-ai@4.2.3）——禁止解析 latest";
	}
	return undefined;
}

const TOKEN_PATTERN = /^[a-z][a-z0-9-]{1,23}$/;
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

export interface TriggerSpec {
	readonly files: readonly string[];
	readonly intents: readonly string[];
}

export interface KnowledgeSpec {
	readonly entry: string;
	readonly references: readonly string[];
}

export interface RoleSpec {
	readonly name: string;
	readonly isolation: readonly IsolationReason[];
	readonly permission: PermissionPreset;
	readonly model: ModelTier;
	readonly output: string;
}

export interface BindingSpec {
	readonly inject: InjectLevel;
	readonly appendRoles: readonly string[];
}

export interface RoutingSlipWhen {
	readonly utteranceType?: SlipUtteranceType;
	readonly crossModule?: boolean;
	readonly deliverable?: SlipDeliverable;
	readonly irreversibility?: SlipIrreversibility;
	readonly triggerHit?: boolean;
}

export interface RoutingWhen {
	readonly surface?: BindingSurface;
	readonly slip?: RoutingSlipWhen;
}

export interface RoutingRule {
	readonly when: RoutingWhen;
	readonly action: RoutingAction;
	readonly target: string;
}

export interface ModuleConfig {
	readonly testCommand?: string;
	readonly gitignore?: readonly string[];
}

// C 级硬保证声明：模块要求某角色机制性必跑。零代码下不可安装（唯一路径
// 是进包加链），声明的意义是"响亮的缺席"——覆盖层明示，缺席不静默。
export interface PipelineSpec {
	readonly gate: string;
}

export interface ModuleManifest {
	readonly schema: ModuleContractId;
	readonly token: string;
	readonly version: string;
	readonly description?: string;
	/** v2 专属：依赖的模块词元（安装器闭包解析 + 安装验证缺失/成环检查）。 */
	readonly dependencies?: readonly string[];
	/** v2 专属：声明的 MCP 服务器档——安装器幂等合并进 Pi 的 agent mcp.json（同名用户档不覆盖）。 */
	readonly mcp?: McpSpec;
	readonly triggers: TriggerSpec;
	readonly knowledge: KnowledgeSpec;
	readonly roles: readonly RoleSpec[];
	readonly bindings: Partial<Record<BindingSurface, BindingSpec>>;
	readonly routing: readonly RoutingRule[];
	readonly config?: ModuleConfig;
	readonly pipeline?: PipelineSpec;
}

export interface ManifestIssue {
	readonly code: string;
	readonly path: string;
	readonly message: string;
}

export interface ParsedManifest {
	readonly manifest?: ModuleManifest;
	readonly issues: readonly ManifestIssue[];
}

function issue(code: string, path: string, message: string): ManifestIssue {
	return { code, path, message };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function checkUnknownKeys(
	value: Record<string, unknown>,
	allowed: readonly string[],
	path: string,
	issues: ManifestIssue[],
): void {
	for (const key of Object.keys(value)) {
		if (!allowed.includes(key)) {
			issues.push(issue("unknown-key", `${path}.${key}`, `未知字段 "${key}"（契约封闭，新增字段须升契约版本）`));
		}
	}
}

function stringList(
	value: unknown,
	path: string,
	issues: ManifestIssue[],
): readonly string[] | undefined {
	if (!Array.isArray(value)) {
		issues.push(issue("type", path, "必须是字符串数组"));
		return undefined;
	}
	const out: string[] = [];
	for (const [index, item] of value.entries()) {
		if (typeof item !== "string" || item.trim().length === 0) {
			issues.push(issue("type", `${path}[${index}]`, "必须是非空字符串"));
			return undefined;
		}
		out.push(item);
	}
	return out;
}

function parseEnum<T extends string>(
	value: unknown,
	allowed: readonly T[],
	path: string,
	issues: ManifestIssue[],
): T | undefined {
	if (typeof value !== "string" || !allowed.includes(value as T)) {
		issues.push(issue("enum", path, `必须是 ${allowed.join(" | ")} 之一`));
		return undefined;
	}
	return value as T;
}

function parseBinding(
	value: unknown,
	surface: string,
	path: string,
	issues: ManifestIssue[],
): BindingSpec | undefined {
	if (!isPlainObject(value)) {
		issues.push(issue("type", path, "必须是对象 {inject, appendRoles?}"));
		return undefined;
	}
	checkUnknownKeys(value, ["inject", "appendRoles"], path, issues);
	const inject = parseEnum(value.inject, INJECT_LEVELS, `${path}.inject`, issues);
	const appendRoles = value.appendRoles === undefined
		? []
		: stringList(value.appendRoles, `${path}.appendRoles`, issues);
	if (inject === undefined || appendRoles === undefined) return undefined;
	return { inject, appendRoles };
}

function parseSlipWhen(
	value: unknown,
	path: string,
	issues: ManifestIssue[],
): RoutingSlipWhen | undefined {
	if (!isPlainObject(value)) {
		issues.push(issue("type", path, "必须是路由单条件对象"));
		return undefined;
	}
	checkUnknownKeys(
		value,
		["utteranceType", "crossModule", "deliverable", "irreversibility", "triggerHit"],
		path,
		issues,
	);
	const slip: {
		utteranceType?: SlipUtteranceType;
		crossModule?: boolean;
		deliverable?: SlipDeliverable;
		irreversibility?: SlipIrreversibility;
		triggerHit?: boolean;
	} = {};
	let ok = true;
	if (value.utteranceType !== undefined) {
		const parsed = parseEnum(value.utteranceType, SLIP_UTTERANCE_TYPES, `${path}.utteranceType`, issues);
		if (parsed === undefined) ok = false;
		else slip.utteranceType = parsed;
	}
	if (value.crossModule !== undefined) {
		if (typeof value.crossModule !== "boolean") {
			issues.push(issue("type", `${path}.crossModule`, "必须是布尔值"));
			ok = false;
		} else slip.crossModule = value.crossModule;
	}
	if (value.deliverable !== undefined) {
		const parsed = parseEnum(value.deliverable, SLIP_DELIVERABLES, `${path}.deliverable`, issues);
		if (parsed === undefined) ok = false;
		else slip.deliverable = parsed;
	}
	if (value.irreversibility !== undefined) {
		const parsed = parseEnum(value.irreversibility, SLIP_IRREVERSIBILITY, `${path}.irreversibility`, issues);
		if (parsed === undefined) ok = false;
		else slip.irreversibility = parsed;
	}
	if (value.triggerHit !== undefined) {
		if (typeof value.triggerHit !== "boolean") {
			issues.push(issue("type", `${path}.triggerHit`, "必须是布尔值"));
			ok = false;
		} else slip.triggerHit = value.triggerHit;
	}
	return ok ? slip : undefined;
}

/** 解析并结构校验一份 module.json 文本。语义级校验（防遮蔽/路由解析等）见 verifyModule。 */
export function parseModuleManifest(raw: string): ParsedManifest {
	const issues: ManifestIssue[] = [];
	let data: unknown;
	try {
		data = JSON.parse(raw);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { issues: [issue("json", "$", `JSON 解析失败：${message}`)] };
	}
	if (!isPlainObject(data)) {
		return { issues: [issue("type", "$", "顶层必须是对象")] };
	}
	// 契约版本先行判定：v2 的顶层白名单多一个 dependencies。v1 清单出现
	// 该键仍按 unknown-key 拒绝——封闭契约的演进纪律，不搞静默宽容。
	const contractId = typeof data.schema === "string" &&
			(MODULE_CONTRACT_IDS as readonly string[]).includes(data.schema)
		? (data.schema as ModuleContractId)
		: undefined;
	if (contractId === undefined) {
		issues.push(issue("enum", "$.schema", `必须是 ${MODULE_CONTRACT_IDS.join(" | ")} 之一`));
	}
	const topLevelKeys = [
		"schema", "token", "version", "description", "triggers", "knowledge", "roles", "bindings", "routing", "config", "pipeline",
	];
	if (contractId === MODULE_CONTRACT_V2) topLevelKeys.splice(4, 0, "dependencies", "mcp");
	checkUnknownKeys(data, topLevelKeys, "$", issues);

	if (typeof data.token !== "string" || !TOKEN_PATTERN.test(data.token)) {
		issues.push(issue("pattern", "$.token", "token 必须匹配 /^[a-z][a-z0-9-]{1,23}$/（小写词元，禁下划线）"));
	}
	if (typeof data.version !== "string" || !VERSION_PATTERN.test(data.version)) {
		issues.push(issue("pattern", "$.version", "version 必须是语义化版本（如 1.0.0）"));
	}
	if (data.description !== undefined && (typeof data.description !== "string" || data.description.length > 200)) {
		issues.push(issue("type", "$.description", "description 必须是 ≤200 字符的字符串"));
	}

	// dependencies（仅 v2）：模块间依赖自述，安装器据此闭包解析、依赖先装。
	let dependencies: readonly string[] | undefined;
	if (contractId === MODULE_CONTRACT_V2 && data.dependencies !== undefined) {
		const list = stringList(data.dependencies, "$.dependencies", issues);
		if (list !== undefined) {
			const illegal = list.filter((dep) => !TOKEN_PATTERN.test(dep));
			if (illegal.length > 0) {
				issues.push(issue("pattern", "$.dependencies", `依赖词元非法：${illegal.join(", ")}（须与 token 同模式）`));
			}
			const duplicated = [...new Set(list.filter((dep, index) => list.indexOf(dep) !== index))];
			if (duplicated.length > 0) {
				issues.push(issue("duplicate", "$.dependencies", `依赖词元重复：${duplicated.join(", ")}`));
			}
			dependencies = list;
		}
	}

	// mcp（仅 v2）：模块声明的 MCP 服务器档——安装器据此合并写入 Pi 的
	// agent mcp.json（见 lib/module-installer.ts 的 mergeModuleMcpServers：
	// 幂等、同名用户档不覆盖、畸形配置保命不动）。声明≠安装工具链。
	let mcp: McpSpec | undefined;
	if (contractId === MODULE_CONTRACT_V2 && data.mcp !== undefined) {
		if (!isPlainObject(data.mcp)) {
			issues.push(issue("type", "$.mcp", "必须是对象 {servers}"));
		} else {
			checkUnknownKeys(data.mcp, ["servers"], "$.mcp", issues);
			if (!Array.isArray(data.mcp.servers)) {
				issues.push(issue("type", "$.mcp.servers", "必须是数组"));
			} else {
				const seen = new Set<string>();
				const servers: McpServerSpec[] = [];
				for (const [index, raw] of data.mcp.servers.entries()) {
					const at = `$.mcp.servers[${index}]`;
					if (!isPlainObject(raw)) {
						issues.push(issue("type", at, "必须是对象 {name, command, args?, env?}"));
						continue;
					}
					checkUnknownKeys(raw, ["name", "command", "args", "env"], at, issues);
					const name = typeof raw.name === "string" ? raw.name : "";
					const nameValid = MCP_SERVER_NAME_PATTERN.test(name);
					let duplicate = false;
					if (!nameValid) {
						issues.push(issue("pattern", `${at}.name`, "name 必须匹配 /^[a-z][a-z0-9-]{1,31}$/"));
					} else if (seen.has(name)) {
						duplicate = true;
						issues.push(issue("duplicate", `${at}.name`, `MCP 服务器名重复：${name}`));
					} else {
						seen.add(name);
					}
					const commandValid = typeof raw.command === "string" && raw.command.trim().length > 0;
					if (!commandValid) {
						issues.push(issue("type", `${at}.command`, "command 必须是非空字符串（stdio 启动命令，如 uvx）"));
					}
					const args = raw.args === undefined ? undefined : stringList(raw.args, `${at}.args`, issues);
					const argsOk = raw.args === undefined || args !== undefined;
					let env: Record<string, string> | undefined;
					if (raw.env !== undefined) {
						if (!isPlainObject(raw.env)) {
							issues.push(issue("type", `${at}.env`, "env 必须是 string→string 对象"));
						} else {
							const flat: Record<string, string> = {};
							for (const [key, value] of Object.entries(raw.env)) {
								if (typeof value !== "string") issues.push(issue("type", `${at}.env.${key}`, "env 值必须是字符串"));
								else flat[key] = value;
							}
							env = flat;
						}
					}
					if (nameValid && !duplicate && commandValid && argsOk) {
						servers.push({
							name,
							command: raw.command as string,
							...(args !== undefined ? { args } : {}),
							...(env !== undefined ? { env } : {}),
						});
					}
				}
				mcp = { servers };
			}
		}
	}

	// triggers：静态 files 是契约的心脏，必填且非空。
	let triggerFiles: readonly string[] = [];
	let triggerIntents: readonly string[] = [];
	if (!isPlainObject(data.triggers)) {
		issues.push(issue("type", "$.triggers", "必须是对象 {files, intents}"));
	} else {
		checkUnknownKeys(data.triggers, ["files", "intents"], "$.triggers", issues);
		const files = stringList(data.triggers.files, "$.triggers.files", issues);
		if (files === undefined) return { issues };
		if (files.length === 0) {
			issues.push(issue("empty", "$.triggers.files", "静态触发器必填非空——语义 intents 只能作兜底"));
		}
		const intents = data.triggers.intents === undefined
			? []
			: stringList(data.triggers.intents, "$.triggers.intents", issues);
		if (intents === undefined) return { issues };
		triggerFiles = files;
		triggerIntents = intents;
	}
	const triggers: TriggerSpec = { files: triggerFiles, intents: triggerIntents };

	// knowledge：entry 必填；references 允许 glob。
	let knowledge: KnowledgeSpec | undefined;
	if (!isPlainObject(data.knowledge)) {
		issues.push(issue("type", "$.knowledge", "必须是对象 {entry, references?}"));
	} else {
		checkUnknownKeys(data.knowledge, ["entry", "references"], "$.knowledge", issues);
		if (typeof data.knowledge.entry !== "string" || !/\.md$/.test(data.knowledge.entry) || data.knowledge.entry.includes("..")) {
			issues.push(issue("pattern", "$.knowledge.entry", "entry 必须是相对当前模块目录的 .md 路径"));
		} else {
			const references = data.knowledge.references === undefined
				? []
				: stringList(data.knowledge.references, "$.knowledge.references", issues);
			if (references !== undefined) {
				knowledge = { entry: data.knowledge.entry, references };
			}
		}
	}

	// roles：name 必须以 `{token}-` 开头（一个模块一个词元的机械化）。
	const roles: RoleSpec[] = [];
	if (!Array.isArray(data.roles)) {
		issues.push(issue("type", "$.roles", "必须是角色对象数组（纯知识模块可为空数组）"));
	} else {
		for (const [index, raw] of data.roles.entries()) {
			const path = `$.roles[${index}]`;
			if (!isPlainObject(raw)) {
				issues.push(issue("type", path, "必须是角色对象"));
				continue;
			}
			checkUnknownKeys(raw, ["name", "isolation", "permission", "model", "output"], path, issues);
			const name = typeof raw.name === "string" ? raw.name : undefined;
			const isolation = stringList(raw.isolation, `${path}.isolation`, issues);
			if (isolation !== undefined) {
				for (const [reasonIndex, reason] of isolation.entries()) {
					if (!ISOLATION_REASONS.includes(reason as IsolationReason)) {
						issues.push(issue("enum", `${path}.isolation[${reasonIndex}]`, `必须是 ${ISOLATION_REASONS.join(" | ")} 之一`));
					}
				}
			}
			const permission = parseEnum(raw.permission, Object.keys(PERMISSION_PRESETS) as PermissionPreset[], `${path}.permission`, issues);
			const model = parseEnum(raw.model, MODEL_TIERS, `${path}.model`, issues);
			if (name === undefined || isolation === undefined || permission === undefined || model === undefined) continue;
			if (typeof raw.output !== "string" || raw.output.trim().length === 0) {
				issues.push(issue("type", `${path}.output`, "output 必须是非空字符串（如 findings-report / design-proposal）"));
				continue;
			}
			roles.push({
				name,
				isolation: isolation as readonly IsolationReason[],
				permission,
				model,
				output: raw.output,
			});
		}
	}
	const roleNames = new Set(roles.map((role) => role.name));
	if (roleNames.size !== roles.length) {
		issues.push(issue("duplicate", "$.roles", "角色名在模块内必须唯一"));
	}

	// bindings：键必须是编排面，值声明注入档位与追加角色。
	const bindings: Partial<Record<BindingSurface, BindingSpec>> = {};
	if (!isPlainObject(data.bindings)) {
		issues.push(issue("type", "$.bindings", "必须是编排面对象"));
	} else {
		for (const [key, value] of Object.entries(data.bindings)) {
			if (!BINDING_SURFACES.includes(key as BindingSurface)) {
				issues.push(issue("enum", `$.bindings.${key}`, `未知编排面（合法值：${BINDING_SURFACES.join(" | ")}）`));
				continue;
			}
			const parsed = parseBinding(value, key, `$.bindings.${key}`, issues);
			if (parsed) bindings[key as BindingSurface] = parsed;
		}
		if (Object.keys(bindings).length === 0) {
			issues.push(issue("empty", "$.bindings", "至少声明一个编排面——无接线的模块等于不存在"));
		}
	}

	// routing：when 必须恰含 surface 或 slip 之一；target 在语义校验中解析。
	const routing: RoutingRule[] = [];
	if (!Array.isArray(data.routing)) {
		issues.push(issue("type", "$.routing", "必须是路由规则数组（可为空）"));
	} else {
		for (const [index, raw] of data.routing.entries()) {
			const path = `$.routing[${index}]`;
			if (!isPlainObject(raw)) {
				issues.push(issue("type", path, "必须是路由规则对象"));
				continue;
			}
			checkUnknownKeys(raw, ["when", "action", "target"], path, issues);
			const action = parseEnum(raw.action, ROUTING_ACTIONS, `${path}.action`, issues);
			const target = typeof raw.target === "string" && raw.target.trim().length > 0 ? raw.target : undefined;
			if (!isPlainObject(raw.when)) {
				issues.push(issue("type", `${path}.when`, "必须是 {surface} 或 {slip}（恰含其一）"));
				continue;
			}
			checkUnknownKeys(raw.when, ["surface", "slip"], `${path}.when`, issues);
			const hasSurface = raw.when.surface !== undefined;
			const hasSlip = raw.when.slip !== undefined;
			if (hasSurface === hasSlip) {
				issues.push(issue("exclusive", `${path}.when`, "必须恰含 surface 或 slip 之一"));
				continue;
			}
			let when: RoutingWhen | undefined;
			if (hasSurface) {
				const surface = parseEnum(raw.when.surface, BINDING_SURFACES, `${path}.when.surface`, issues);
				if (surface !== undefined) when = { surface };
			} else {
				const slip = parseSlipWhen(raw.when.slip, `${path}.when.slip`, issues);
				if (slip !== undefined) when = { slip };
			}
			if (action === undefined || target === undefined || when === undefined) continue;
			routing.push({ when, action, target });
		}
	}

	// config：命令钉住的声明化（SDD Strict TDD 转发的数据源）。
	let config: ModuleConfig | undefined;
	if (data.config !== undefined) {
		if (!isPlainObject(data.config)) {
			issues.push(issue("type", "$.config", "必须是对象 {testCommand?, gitignore?}"));
		} else {
			checkUnknownKeys(data.config, ["testCommand", "gitignore"], "$.config", issues);
			let testCommand: string | undefined;
			if (data.config.testCommand !== undefined) {
				if (typeof data.config.testCommand !== "string" || data.config.testCommand.trim().length === 0) {
					issues.push(issue("type", "$.config.testCommand", "testCommand 必须是非空字符串——钉命令就要钉能跑通的"));
				} else {
					testCommand = data.config.testCommand;
				}
			}
			const gitignore = data.config.gitignore === undefined
				? undefined
				: stringList(data.config.gitignore, "$.config.gitignore", issues);
			if (gitignore !== undefined) config = { testCommand, gitignore };
		}
	}

	// pipeline：C 级硬门声明（gate 名非空；语义在 verify 与覆盖层——响亮的缺席）。
	let pipeline: PipelineSpec | undefined;
	if (data.pipeline !== undefined) {
		if (!isPlainObject(data.pipeline)) {
			issues.push(issue("type", "$.pipeline", "必须是对象 {gate}"));
		} else {
			checkUnknownKeys(data.pipeline, ["gate"], "$.pipeline", issues);
			if (typeof data.pipeline.gate !== "string" || data.pipeline.gate.trim().length === 0) {
				issues.push(issue("type", "$.pipeline.gate", "gate 必须是非空字符串（如 4r-review.chain 的扩展链名）"));
			} else {
				pipeline = { gate: data.pipeline.gate };
			}
		}
	}

	if (issues.length > 0) return { issues };
	const token = data.token as string;
	return {
		manifest: {
			schema: contractId as ModuleContractId,
			token,
			version: data.version as string,
			description: typeof data.description === "string" ? data.description : undefined,
			dependencies,
			mcp,
			triggers,
			knowledge: knowledge as KnowledgeSpec,
			roles,
			bindings,
			routing,
			config,
			pipeline,
		},
		issues: [],
	};
}

export interface ModuleVerifyCheck {
	readonly id: string;
	readonly status: "pass" | "fail" | "skip";
	readonly detail: string;
}

export interface ModuleVerifyReport {
	readonly token: string;
	readonly ok: boolean;
	readonly checks: readonly ModuleVerifyCheck[];
}

export interface ModuleVerifyInput {
	readonly manifest: ModuleManifest;
	/** knowledge.entry 的文本；任何接线使用 entry 档时必填（entry-size lint）。 */
	readonly entryText?: string;
	/** 当前仓库相对路径样本（正斜杠）；提供时执行 triggers-hit 检查。 */
	readonly repoFiles?: readonly string[];
	/** 样本是否被扫描上限截断；截断时零命中失败的详情会标注假阴性可能。 */
	readonly repoFilesTruncated?: boolean;
	/** 同仓库其他模块的 token；提供时执行 token-unique 检查。 */
	readonly otherTokens?: readonly string[];
	/** 项目 `.pi/skills/` 下的松散技能名；提供时执行 no-loose-duplicate 检查。 */
	readonly looseSkillTokens?: readonly string[];
	/** 项目模块根内全部已装模块的 {token, dependencies}（含本模块）；提供时执行 deps-resolve 检查。 */
	readonly installedModules?: readonly { readonly token: string; readonly dependencies: readonly string[] }[];
}

function check(
	id: string,
	ok: boolean,
	passDetail: string,
	failDetail: string,
): ModuleVerifyCheck {
	return { id, status: ok ? "pass" : "fail", detail: ok ? passDetail : failDetail };
}

/** 依赖图环检测：从 start 深度优先，返回环上的词元序列（首尾相同闭合，如 a → b → a）；无环返回 undefined。 */
function findDependencyCycle(start: string, graph: Map<string, string[]>): string[] | undefined {
	const state = new Map<string, "visiting" | "visited">();
	const stack: string[] = [];
	const visit = (token: string): string[] | undefined => {
		const mark = state.get(token);
		if (mark === "visiting") {
			return [...stack.slice(stack.indexOf(token)), token];
		}
		if (mark === "visited") return undefined;
		state.set(token, "visiting");
		stack.push(token);
		for (const dep of graph.get(token) ?? []) {
			const found = visit(dep);
			if (found !== undefined) return found;
		}
		stack.pop();
		state.set(token, "visited");
		return undefined;
	};
	return visit(start);
}

/** 安装验证：语义级检查（token/依赖/防遮蔽/触发/路由/隔离/entry/config/硬门）。任何 fail 即模块未过门，静默失效族在这里显式失败。 */
export function verifyModule(input: ModuleVerifyInput): ModuleVerifyReport {
	const { manifest } = input;
	const checks: ModuleVerifyCheck[] = [];
	const roleNames = manifest.roles.map((role) => role.name);

	const tokenValid = TOKEN_PATTERN.test(manifest.token) && !PACKAGE_AGENT_PREFIXES.some(
		(prefix) => manifest.token.startsWith(prefix),
	);
	checks.push(
		check(
			"token-valid",
			tokenValid,
			`token "${manifest.token}" 合法且不撞包内前缀族`,
			"token 非法或以包内前缀（jero-/review-/sdd-/jd-）开头——那是遮蔽炸弹",
		),
	);

	const others = input.otherTokens ?? [];
	const unique = !others.includes(manifest.token);
	checks.push(
		check("token-unique", unique, "token 在本仓库模块中唯一", `token 与既有模块冲突：${manifest.token}`),
	);

	// deps-resolve（v2）：依赖缺失/自依赖/成环都是安装期响亮失败——静默
	// 拆依赖等于运行时知识链断裂。
	const declaredDeps = manifest.dependencies ?? [];
	if (declaredDeps.length === 0) {
		checks.push({ id: "deps-resolve", status: "skip", detail: "无依赖声明（v1 清单或 v2 空依赖）" });
	} else if (input.installedModules === undefined) {
		checks.push({ id: "deps-resolve", status: "skip", detail: "未提供已装模块清单，跳过依赖解析" });
	} else {
		const installedTokens = new Set(input.installedModules.map((item) => item.token));
		const selfDep = declaredDeps.includes(manifest.token);
		const missing = declaredDeps.filter((dep) => !installedTokens.has(dep));
		const graph = new Map(input.installedModules.map((item) => [item.token, [...item.dependencies]]));
		// 本模块不在清单（独立验证场景）时也要入图，环检测才完整。
		if (!graph.has(manifest.token)) graph.set(manifest.token, [...declaredDeps]);
		const cycle = findDependencyCycle(manifest.token, graph);
		const depsOk = !selfDep && missing.length === 0 && cycle === undefined;
		checks.push(
			check(
				"deps-resolve",
				depsOk,
				`依赖全部解析（${declaredDeps.join("、")}）且无环`,
				[
					selfDep ? `自依赖 ${manifest.token}` : "",
					missing.length > 0
						? `依赖缺失：${missing.join("、")}——先安装依赖模块（/jero:install-module ${missing.join(" ")}）或删掉该声明`
						: "",
					cycle !== undefined ? `依赖成环：${cycle.join(" → ")}` : "",
				]
					.filter((part) => part.length > 0)
					.join("；"),
			),
		);
	}

	if (input.looseSkillTokens === undefined) {
		checks.push({ id: "no-loose-duplicate", status: "skip", detail: "未提供松散技能名清单，跳过双轨检查" });
	} else {
		const looseDuplicate = input.looseSkillTokens.includes(manifest.token);
		checks.push(
			check(
				"no-loose-duplicate",
				!looseDuplicate,
				"token 与松散技能无重名",
				`token 与 .pi/skills/ 松散技能 "${manifest.token}" 重名——同一知识双源必漂移，二选一：知识迁入模块，或删除松散技能`,
			),
		);
	}

	const shadowedRoles = roleNames.filter(
		(name) => BUILTIN_AGENT_NAMES.includes(name as (typeof BUILTIN_AGENT_NAMES)[number]) ||
			PACKAGE_AGENT_PREFIXES.some((prefix) => name.startsWith(prefix)),
	);
	const offTokenRoles = roleNames.filter((name) => !name.startsWith(`${manifest.token}-`));
	const rolesClean = shadowedRoles.length === 0 && offTokenRoles.length === 0;
	checks.push(
		check(
			"no-shadow",
			rolesClean,
			"角色名不撞包内代理且全部携带本模块词元前缀",
			`角色名违规：${[...shadowedRoles, ...offTokenRoles].join(", ") || "（无）"}——角色名必须是 {token}-{角色} 且不撞包内命名空间`,
		),
	);

	if (input.repoFiles === undefined) {
		checks.push({ id: "triggers-hit", status: "skip", detail: "未提供仓库文件样本，跳过触发命中检查" });
	} else {
		const matched = new Set<string>();
		for (const glob of manifest.triggers.files) {
			const re = globToRegExp(glob);
			for (const file of input.repoFiles) {
				if (re.test(file)) matched.add(`${glob} → ${file}`);
			}
		}
		const truncationNote = input.repoFilesTruncated ? "（样本已被扫描上限截断，可能是假阴性——先确认触发文件未被截掉）" : "";
		checks.push(
			check(
				"triggers-hit",
				matched.size > 0,
				`静态触发器命中 ${matched.size} 处${input.repoFilesTruncated ? "（样本已截断，命中数可能偏低）" : ""}`,
				`静态触发器在本仓库零命中——门控词写偏，或本模块不属于此仓库${truncationNote}`,
			),
		);
	}

	const routingTargets = manifest.routing.map((rule) => rule.target);
	const unresolved = routingTargets.filter((target) => !roleNames.includes(target));
	checks.push(
		check(
			"routing-resolves",
			unresolved.length === 0,
			"全部路由目标解析到本模块角色",
			`路由目标不可解析：${unresolved.join(", ")}——目标只能是本模块角色（重路由包内代理是编排器的职责，不是模块的）`,
		),
	);

	const appendRoleRefs = Object.values(manifest.bindings).flatMap(
		(binding) => binding?.appendRoles ?? [],
	);
	const unresolvedAppends = appendRoleRefs.filter((name) => !roleNames.includes(name));
	if (unresolvedAppends.length > 0) {
		checks.push(check("append-roles-resolve", false, "", `appendRoles 引用了不存在的角色：${unresolvedAppends.join(", ")}`));
	} else if (appendRoleRefs.length === 0) {
		checks.push({ id: "append-roles-resolve", status: "skip", detail: "无 appendRoles 声明" });
	} else {
		checks.push(check("append-roles-resolve", true, "appendRoles 全部可解析", ""));
	}

	const isolationEmpty = manifest.roles.filter((role) => role.isolation.length === 0);
	checks.push(
		check(
			"isolation-justified",
			isolationEmpty.length === 0,
			"每个角色都声明了隔离正当性",
			`以下角色没有隔离理由（${ISOLATION_REASONS.join(" / ")} 四选一以上）：${
				isolationEmpty.map((role) => role.name).join(", ") || "（无）"
			}——只是"懂更多"的角色是知识型意图，知识请移入 knowledge`,
		),
	);

	const needsEntry = Object.values(manifest.bindings).some((binding) => binding?.inject === "entry");
	if (!needsEntry) {
		checks.push({ id: "entry-size", status: "skip", detail: "无 entry 档接线，跳过正文行数门" });
	} else if (input.entryText === undefined) {
		checks.push({ id: "entry-size", status: "fail", detail: "接线使用 entry 档但未提供 entry 文本——渐进披露无从检查" });
	} else {
		// 尾随换行不计行：编辑器普遍补尾空行，60 行整的文件就该是 60 行。
		const lines = input.entryText.replace(/\r?\n$/, "").split(/\r?\n/).length;
		checks.push(
			check(
				"entry-size",
				lines <= MAX_ENTRY_LINES,
				`entry 正文 ${lines} 行（≤${MAX_ENTRY_LINES}）`,
				`entry 正文 ${lines} 行，超过 ${MAX_ENTRY_LINES} 行上限——深度知识移入 references（L2 按需读）`,
			),
		);
	}

	const config = manifest.config;
	if (config === undefined) {
		checks.push({ id: "config-pinned", status: "skip", detail: "未声明 config" });
	} else {
		const valid = config.testCommand === undefined || config.testCommand.trim().length > 0;
		checks.push(
			check("config-pinned", valid, "config 声明合法", "testCommand 不能是空白串——钉命令前先在目标项目跑通"),
		);
	}

	if (manifest.pipeline === undefined) {
		checks.push({ id: "pipeline-gate-loud", status: "skip", detail: "未声明硬门（零代码默认）" });
	} else {
		// 声明不是失败：意义在于覆盖层明示 + 编排器不得静默跳过（响亮的缺席）。
		checks.push({
			id: "pipeline-gate-loud",
			status: "pass",
			detail: `已声明硬门 "${manifest.pipeline.gate}"——机制性必跑须进包加链安装；覆盖层将明示，缺席时编排器不得静默跳过`,
		});
	}

	return { token: manifest.token, ok: checks.every((item) => item.status !== "fail"), checks };
}

// —— 最小 glob：`*` 不跨目录、`**` 跨目录、`?` 单字符，其余按字面量。 ——

export function globToRegExp(glob: string): RegExp {
	let source = "^";
	let i = 0;
	while (i < glob.length) {
		const ch = glob[i];
		if (ch === "*") {
			if (glob[i + 1] === "*") {
				// `**` 跨目录；吞掉紧随的 `/`，使 `**/*.tscn` 也能命中根级文件。
				source += ".*";
				i += 2;
				if (glob[i] === "/") i += 1;
			} else {
				source += "[^/]*";
				i += 1;
			}
		} else if (ch === "?") {
			source += "[^/]";
			i += 1;
		} else {
			source += ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
			i += 1;
		}
	}
	return new RegExp(`${source}$`);
}
