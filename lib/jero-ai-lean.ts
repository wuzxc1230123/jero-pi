// 精益纪律（lean discipline）：借自 ponytail 的"懒惰资深工程师"七级梯子，
// 以提示词层增强嫁接进 jero-pi。本模块是有意无状态的纯函数层——无 IO、
// 无文件持久化、绝不接触评审权威（lib/authority/）与会话常任权限；
// 会话内的模式经自定义 session 条目（jero.lean-mode/v1，不进 LLM 上下文）
// 持久化，由扩展在 before_agent_start 每次代理启动时倒序回放。
//
// 与 400 行评审预算正交：预算管工作切片，梯子管代码必要性。这里的指令
// 块是运行时注入的规范文本（skills/jero-lean/SKILL.md 是模型按需加载的
// 完整参考）；tests/jero-lean.test.ts 以关键字对齐测试防止两者漂移。

export const LEAN_MODES = ["off", "lite", "full", "ultra"] as const;

export type LeanMode = (typeof LEAN_MODES)[number];

// 默认档 full：只追加提示词，不改变任何既有流程；off 完全还原历史行为。
export const LEAN_DEFAULT_MODE: LeanMode = "full";

// 无 UI/无会话条目场景（headless、RPC、测试）的初始档位来源。
export const LEAN_MODE_ENV = "JERO_PI_LEAN_MODE";

// 会话条目类型：与 REVIEW_REMINDER_RECEIPT 同机制（custom entry，
// appendEntry 写入、getBranch 倒序回放），但只承载 { mode } 一个键。
export const LEAN_MODE_ENTRY_TYPE = "jero.lean-mode/v1";

export interface LeanBranchEntry {
	readonly type: unknown;
	readonly customType?: unknown;
	readonly data?: unknown;
}

export function isValidLeanMode(value: unknown): value is LeanMode {
	return typeof value === "string" && (LEAN_MODES as readonly string[]).includes(value);
}

// 严格单键解码：未来字段演进必须换新条目类型，旧条目按畸形忽略。
export function isValidLeanModeEntry(data: unknown): data is { mode: LeanMode } {
	if (!data || typeof data !== "object" || Array.isArray(data)) return false;
	const record = data as Record<string, unknown>;
	return Object.keys(record).length === 1 && "mode" in record && isValidLeanMode(record.mode);
}

// 倒序回放：最近一次合法的 lean 模式条目获胜；畸形条目跳过不中断。
export function resolveLeanModeFromBranch(
	branch: readonly LeanBranchEntry[],
): LeanMode | undefined {
	for (let index = branch.length - 1; index >= 0; index -= 1) {
		const entry = branch[index];
		if (entry.type !== "custom" || entry.customType !== LEAN_MODE_ENTRY_TYPE) continue;
		if (isValidLeanModeEntry(entry.data)) return entry.data.mode;
	}
	return undefined;
}

export function leanModeFromEnv(env: Record<string, string | undefined>): LeanMode | undefined {
	const raw = env[LEAN_MODE_ENV];
	return isValidLeanMode(raw) ? raw : undefined;
}

// 优先级：会话条目 > 环境变量 > 默认档。永不返回 undefined。
export function resolveEffectiveLeanMode(
	branch: readonly LeanBranchEntry[],
	env: Record<string, string | undefined> = process.env,
): LeanMode {
	return resolveLeanModeFromBranch(branch) ?? leanModeFromEnv(env) ?? LEAN_DEFAULT_MODE;
}

export type ParsedLeanCommand =
	| { kind: "status" }
	| { kind: "set"; mode: LeanMode }
	| { kind: "invalid"; reason: string };

// 解析 /jero:lean 的参数串（registerCommand 处理器收到的 args）。
// 大小写不敏感；空串与 "status" 都是查询。
export function parseLeanCommand(args: string): ParsedLeanCommand {
	const trimmed = args.trim();
	if (trimmed.length === 0 || trimmed === "status") return { kind: "status" };
	const candidate = trimmed.toLowerCase();
	if (candidate === "off") return { kind: "set", mode: "off" };
	if (candidate === "lite") return { kind: "set", mode: "lite" };
	if (candidate === "full") return { kind: "set", mode: "full" };
	if (candidate === "ultra") return { kind: "set", mode: "ultra" };
	return { kind: "invalid", reason: `未知的 lean 档位 "${trimmed}"。请使用 status、off、lite、full 或 ultra。` };
}

// 停用短语：与 ponytail 同款契约——仅命中独立的 "stop lean"（容忍
// 大小写与尾部标点），绝不做子串匹配，以免误杀任务文本。
export function isLeanDeactivationText(text: string): boolean {
	const normalized = text.trim().replace(/[.!?。！?]+$/u, "").toLowerCase();
	return normalized === "stop lean";
}

export function renderLeanStatusLine(mode: LeanMode): string {
	return `Lean discipline: ${mode}`;
}

// 共享核心：梯子 + 懒惰边界。lite 不裁剪任何东西，因此不携带；
// full/ultra 携带。此文本是运行时注入的规范版本。
const LEAN_LADDER_BLOCK = [
	"在理解问题之后、写出代码之前，按梯子停在第一个成立的横档上。懒于方案，绝不懒于阅读：先读要改动的代码，再选横档。",
	"1. 这真的需要存在吗？——投机性需求直接跳过，并用一行说明。（YAGNI）",
	"2. 代码库里已经有吗？——先找再写；重复实现近在咫尺的助手、类型或模式是最常见的浪费。",
	"3. 标准库能做到吗？——用它。",
	"4. 平台原生能力够吗？——原生控件、CSS、数据库约束优先于自建组件与自写逻辑。",
	"5. 已安装的依赖能解决吗？——几行能解决的事绝不新增依赖。",
	"6. 能写成一行吗？——一行。",
	"7. 只有此时：写出能工作的最小实现。",
].join("\n");

const LEAN_RULES_BLOCK = [
	"不加未被要求的抽象：单实现的接口、只有一个产品的工厂、为常量做的配置，都是多余。不为“以后”写样板。删除优先于新增；平淡优于取巧。文件最少，能工作的 diff 最短。",
].join("\n");

const LEAN_NEVER_CUT_BLOCK = [
	"绝不简化掉：信任边界的输入校验、防止数据丢失的错误处理、安全措施、可访问性基础、用户明确要求的内容。用户坚持要完整版本时照做，不再重新争论。",
	"非平凡逻辑必须留下一个可运行检查（断言自检或一个小测试）；YAGNI 约束测试的数量，绝不约束质量门。",
	"有意的妥协必须留注释标记：`jero: <简化了什么>. ceiling: <天花板>. upgrade: <重启条件>.`——/jero:debt 会收割这些标记。",
].join("\n");

const LEAN_OUTPUT_BUDGET_BLOCK =
	"输出预算：先代码，随后至多三行说明——跳过了什么、何时该补上（形如 `skipped: X, add when Y.`）。解释比代码长就删解释（用户明确要求的解释除外）。";

const LEAN_BUDGET_ORTHOGONALITY_BLOCK =
	"本纪律与 400 行评审预算正交：预算管工作切片，梯子管必要性；绝不为了行数删除注释、测试或文档。";

const LEAN_ULTRA_EXTRA_BLOCK =
	"ultra 极端档：YAGNI 极端主义。删除优先于新增；先交付最小实现，并在同一回合质疑需求的其余部分；用户坚持后再补足。";

// 分档指令块。off 返回空串（扩展侧据此跳过注入，完全还原历史行为）。
// lite 有意保持单段：它不裁剪任何东西，只有"点名替代方案"义务。
export function getLeanInstructions(mode: LeanMode): string {
	if (mode === "off") return "";
	if (mode === "lite") {
		return [
			"## Jero 精益纪律（lean: lite）",
			"",
			"按用户的请求完整实现，不做额外删减；但在交付时用一行点名更精简的替代方案（形如 `lean: 可用 <X> 替代，当 <条件> 时值得`）。",
		].join("\n");
	}
	const blocks = [
		`## Jero 精益纪律（lean: ${mode}）`,
		"",
		LEAN_LADDER_BLOCK,
		"",
		LEAN_RULES_BLOCK,
		"",
		LEAN_NEVER_CUT_BLOCK,
		"",
		LEAN_OUTPUT_BUDGET_BLOCK,
		LEAN_BUDGET_ORTHOGONALITY_BLOCK,
	];
	if (mode === "ultra") blocks.push(LEAN_ULTRA_EXTRA_BLOCK);
	return blocks.join("\n");
}
