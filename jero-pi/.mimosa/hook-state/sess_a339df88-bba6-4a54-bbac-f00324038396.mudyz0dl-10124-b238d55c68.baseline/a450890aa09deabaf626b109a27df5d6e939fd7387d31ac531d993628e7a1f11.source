// 客户端契约操作面：untracked 选择参数、风险证据短语、NATIVE_CLI_CONTRACTS、
// 进程诊断与 NativeReviewCliError。
// 自 lib/authority/client-contract.ts 拆分（机械平移，语义零改动）。

import {
	isAbsolute,
	posix,
	win32
} from "node:path";
import {
	NATIVE_REVIEW_OPERATION,
	NATIVE_START_ACTION,
	NATIVE_UNTRACKED_SCOPE,
	type NativeReviewErrorCode,
	type NativeReviewOperation,
	type NativeUntrackedScope,
	type NativeUntrackedSelectionRequest
} from "./client-contract-types.ts";
export function isCanonicalProcessString(value: unknown): value is string {
	return typeof value === "string" && value.length > 0 && value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value);
}

interface NativeUntrackedSelection {
	untrackedScope?: NativeUntrackedScope;
	expectedUntrackedInventory?: string;
	intendedUntracked?: readonly string[];
}

function isNativeUntrackedPath(value: unknown): value is string {
	return isCanonicalProcessString(value)
		&& !posix.isAbsolute(value)
		&& !win32.isAbsolute(value)
		&& !value.includes("\\")
		&& value.split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

export function nativeUntrackedSelection(request: NativeUntrackedSelectionRequest): NativeUntrackedSelection {
	const { untrackedScope, expectedUntrackedInventory, intendedUntracked } = request;
	const declared = untrackedScope !== undefined || expectedUntrackedInventory !== undefined || intendedUntracked !== undefined;
	if (!declared) return {};
	if (
		(untrackedScope !== NATIVE_UNTRACKED_SCOPE.EXCLUDE && untrackedScope !== NATIVE_UNTRACKED_SCOPE.SELECT) ||
		!isCanonicalProcessString(expectedUntrackedInventory) ||
		(intendedUntracked !== undefined && (!Array.isArray(intendedUntracked) || intendedUntracked.some((path) => !isNativeUntrackedPath(path) || intendedUntracked.indexOf(path) !== intendedUntracked.lastIndexOf(path))))
	) {
		throw new TypeError("Native untracked selection must declare one scope, one inventory digest, and unique repository-relative paths");
	}
	if (untrackedScope === NATIVE_UNTRACKED_SCOPE.EXCLUDE && (intendedUntracked?.length ?? 0) > 0) {
		throw new TypeError("Native exclude untracked selection cannot include paths");
	}
	if (untrackedScope === NATIVE_UNTRACKED_SCOPE.SELECT && (intendedUntracked?.length ?? 0) === 0) {
		throw new TypeError("Native select untracked selection requires at least one path");
	}
	return {
		untrackedScope,
		expectedUntrackedInventory,
		intendedUntracked: intendedUntracked === undefined ? undefined : [...intendedUntracked],
	};
}

function nativeUntrackedSelectionArguments(selection: NativeUntrackedSelection): readonly string[] {
	if (selection.untrackedScope === undefined) return [];
	return [
		`--untracked-scope=${selection.untrackedScope}`,
		`--expected-untracked-inventory=${selection.expectedUntrackedInventory!}`,
		...(selection.untrackedScope === NATIVE_UNTRACKED_SCOPE.SELECT
			? selection.intendedUntracked!.map((path) => `--intended-untracked=${path}`)
			: []),
	];
}

export const NATIVE_RISK_LEVEL = ["low", "medium", "high"] as const;

// gentle-ai 协商的 `start/v2` 封套是封闭 schema
// （`additionalProperties: false`），因此其普通兄弟携带的两个投影无法
// 在不引入新契约版本的情况下加进去。两者都是 `start/v2` 已作为必填
// 字段上报的事实的投影，协商调用方在这里重建它们，而不是落得比普通
// 调用方更糟的恢复境况。这些是 Pi 侧对原生事实的渲染，绝不声称 CLI
// 发送了它们：封套省略它们的每个版本，`riskEvidence`/`hint` 能力行
// 都保持暗置。
//
// internal/cli/review_mode.go 与 review_facade.go 的逐字节镜像。
// `reviewConsentEvidencePhrases` 在那里被记录为唯一的措辞来源，使其
// 各表面不会漂移，这让这里成为第二个表面：无法识别的原因码因此
// 不渲染任何内容而不是猜测，且 nativeRiskEvidencePhrases 在
// tests/native-review-parity.test.ts 中对照 gentle-ai fixture 钉住，
// 词汇变化会高声失败。
export const REVIEW_EMPTY_CANDIDATE_HINT =
	"the candidate has no pending changes; already-committed work can be reviewed by rerunning review start with --base-ref <commit> naming the base to compare against";
const REVIEW_MEDIUM_RISK_REASON = "this change is not purely passive documentation, so it gets one consolidated review.";
const REVIEW_EMPTY_CONTENT_CODE = "empty_content";
const REVIEW_RISK_SUBJECT_BY_CODE: Readonly<Record<string, string>> = Object.freeze({
	service_token: "service credentials",
	shell_source: "shell scripting",
	process_boundary: "code that starts other processes",
	process_scan_limit: "code that starts other processes",
	executable_mode: "an executable permission change",
	executable_change: "an executable change",
	configuration_change: "a configuration change",
});
const REVIEW_RISK_SUBJECT_BY_SIGNAL: Readonly<Record<string, string>> = Object.freeze({
	auth: "authentication",
	update: "the update path",
	security: "security",
	payments: "payments",
	data_exposure: "data exposure",
	data_loss: "data loss",
	permissions: "permissions",
	shell_process: "shell or process execution",
});
// Go 的信号开关没有空默认分支：每个 hot_path 原因都会发声，未映射的
// 信号退化为这个措辞而不是把路径整个丢掉。
const REVIEW_RISK_UNKNOWN_SIGNAL_SUBJECT = "a sensitive area";

interface NativeRiskEvidenceReason {
	readonly code?: string;
	readonly signal?: string;
	readonly path?: string;
}

function nativeRiskEvidenceSubject(reason: NativeRiskEvidenceReason): string {
	const code = typeof reason.code === "string" ? reason.code : "";
	if (code === "hot_path") {
		const signal = typeof reason.signal === "string" ? reason.signal : "";
		return REVIEW_RISK_SUBJECT_BY_SIGNAL[signal] ?? REVIEW_RISK_UNKNOWN_SIGNAL_SUBJECT;
	}
	return REVIEW_RISK_SUBJECT_BY_CODE[code] ?? "";
}

function nativeRiskEvidencePhrase(reason: NativeRiskEvidenceReason): string {
	const path = typeof reason.path === "string" ? reason.path.trim() : "";
	// 空文件先点名再描述。其余主语读作 “<什么变了> in <路径>”，
	// 对没有字节的文件那样写会断言并不存在的内容。
	if (reason.code === REVIEW_EMPTY_CONTENT_CODE) {
		return path === "" ? "" : `${path}, an empty file whose type cannot be determined from its content`;
	}
	const subject = nativeRiskEvidenceSubject(reason);
	if (subject === "" || path === "") return subject;
	return `${subject} in ${path}`;
}

export function nativeRiskEvidencePhrases(riskLevel: string, reasons: readonly NativeRiskEvidenceReason[]): readonly string[] {
	if (riskLevel !== "high" && riskLevel !== "medium") return [];
	const phrases = reasons.map((reason) => nativeRiskEvidencePhrase(reason)).filter((phrase) => phrase !== "");
	return riskLevel === "medium" ? [REVIEW_MEDIUM_RISK_REASON, ...phrases] : phrases;
}
export const NATIVE_REVIEW_LENS = ["review-risk", "review-resilience", "review-readability", "review-reliability"] as const;
const NATIVE_START_ACTION_VALUES = Object.values(NATIVE_START_ACTION);
// 钉住表刻意在 #3587 未发布期间保持不变。last-event 捕获支持通过显式
// 的开发二进制覆盖来演练；不允许源码级的钉住或契约行变更。
const ORGANIC_PARITY_DARK = { mode: false, riskEvidence: false, hint: false, delivery: false } as const;

export const NATIVE_CLI_CONTRACTS = Object.freeze({
	"2.1.4": Object.freeze({ start: true, finalize: true, validate: true, bindSdd: true, status: false, inventory: false, reclaim: false, recover: false, abandon: false, quarantineLegacy: false, reconcileAuthority: false, repairLegacyAlias: false, ...ORGANIC_PARITY_DARK }),
	"2.1.5": Object.freeze({ start: true, finalize: true, validate: true, bindSdd: true, status: true, inventory: true, reclaim: false, recover: false, abandon: false, quarantineLegacy: false, reconcileAuthority: false, repairLegacyAlias: false, ...ORGANIC_PARITY_DARK }),
	"2.1.6": Object.freeze({ start: true, finalize: true, validate: true, bindSdd: true, status: true, inventory: true, reclaim: false, recover: false, abandon: false, quarantineLegacy: false, reconcileAuthority: false, repairLegacyAlias: false, ...ORGANIC_PARITY_DARK }),
	"2.1.7": Object.freeze({ start: true, finalize: true, validate: true, bindSdd: true, status: true, inventory: true, reclaim: false, recover: false, abandon: false, quarantineLegacy: false, reconcileAuthority: false, repairLegacyAlias: false, ...ORGANIC_PARITY_DARK }),
	"2.1.8": Object.freeze({ start: true, finalize: true, validate: true, bindSdd: true, status: true, inventory: true, reclaim: true, recover: true, abandon: false, quarantineLegacy: false, reconcileAuthority: true, repairLegacyAlias: false, ...ORGANIC_PARITY_DARK }),
	"2.1.9": Object.freeze({ start: true, finalize: true, validate: true, bindSdd: true, status: true, inventory: true, reclaim: true, recover: true, abandon: true, quarantineLegacy: true, reconcileAuthority: true, repairLegacyAlias: false, ...ORGANIC_PARITY_DARK }),
	"2.1.10": Object.freeze({ start: true, finalize: true, validate: true, bindSdd: true, status: true, inventory: true, reclaim: true, recover: true, abandon: true, quarantineLegacy: true, reconcileAuthority: true, repairLegacyAlias: true, ...ORGANIC_PARITY_DARK }),
	"2.1.11": Object.freeze({ start: true, finalize: true, validate: true, bindSdd: true, status: true, inventory: true, reclaim: true, recover: true, abandon: true, quarantineLegacy: true, reconcileAuthority: true, repairLegacyAlias: true, ...ORGANIC_PARITY_DARK }),
	// 首个能力为真的行，并按设计决策 #1 的要求与本提交中的三重钉住
	// 升级配对。
	//
	// 四个 organic-parity 列只点亮两个，因为能力行是一种承诺，而这两个
	// 的数据已被证明能到达 Pi 实际消费的协商路径：
	//
	//   mode      `gentle-ai review mode status` 直接回答 review-mode/v1
	//             封套。
	//   delivery  门控结果携带 `delivery`（关闭杀开关时为
	//             “disabled/unmanaged”），已对照 v2.2.0 验证。
	//
	// riskEvidence 与 hint 刻意保持暗置。两者在 gentle-ai v2.2.0 中都
	// 存在，但只在普通 start 封套上；启动解码器承载的协商
	// `review-integration.start/v2` 携带的是 `risk_reasons` 而非
	// `risk_evidence`，且完全省略 `hint`。点亮它们会宣传不可能到达的
	// 数据。要关闭该缺口需要上游扩展协商启动封套，那会动到字节钉住
	// 的 fixture，因此属于 gentle-ai 发布，而不是 Pi 的能力翻转。
	"2.2.0": Object.freeze({ start: true, finalize: true, validate: true, bindSdd: true, status: true, inventory: true, reclaim: true, recover: true, abandon: true, quarantineLegacy: true, reconcileAuthority: true, repairLegacyAlias: true, mode: true, riskEvidence: false, hint: false, delivery: true }),
	// 2.2.1 重复 2.2.0，因为 Pi 所讲通道的线上协议没有变化。v2.2.1 在
	// review-integration/v1 上宣告 capabilities/v1.5（协议次版本 5），
	// 但协商启动封套仍是封闭的 `start/v2`，因此 riskEvidence 与 hint
	// 保持暗置，理由与 2.2.0 相同。该发布确实公开了第二个契约
	// review-integration/v2，其 `start/v3` 携带 base/candidate 树——但
	// Pi 尚未协商它，而能力行必须描述使用中的通道。
	"2.2.1": Object.freeze({ start: true, finalize: true, validate: true, bindSdd: true, status: true, inventory: true, reclaim: true, recover: true, abandon: true, quarantineLegacy: true, reconcileAuthority: true, repairLegacyAlias: true, mode: true, riskEvidence: false, hint: false, delivery: true }),
	// 2.2.2 出于相同原因重复 2.2.1，且是对照已发布的 v2.2.2 二进制确认
	// 而非假设：它在 review-integration/v1 上仍宣告 capabilities/v1.5，
	// 协商启动封套仍是封闭的 `start/v2`，因此 riskEvidence 与 hint
	// 仍无法到达。
	"2.2.2": Object.freeze({ start: true, finalize: true, validate: true, bindSdd: true, status: true, inventory: true, reclaim: true, recover: true, abandon: true, quarantineLegacy: true, reconcileAuthority: true, repairLegacyAlias: true, mode: true, riskEvidence: false, hint: false, delivery: true }),
	// 对照已发布的 v2.2.3 二进制实测：v2 通道仍是协议 2.0，操作集与
	// Pi 消费的封闭 START 字段不变，因此既有能力列不变。
	"2.2.3": Object.freeze({ start: true, finalize: true, validate: true, bindSdd: true, status: true, inventory: true, reclaim: true, recover: true, abandon: true, quarantineLegacy: true, reconcileAuthority: true, repairLegacyAlias: true, mode: true, riskEvidence: false, hint: false, delivery: true }),
	// 对照已发布的 v2.4.0 二进制实测：v2 通道宣告 capabilities/v2.2 并
	// 应答 status/v5 与 consent/v3，既有解码器都已能读取，而 Pi 消费的
	// START 封套仍是携带 `risk_reasons`、无 `risk_evidence` 也无 `hint`
	// 的 `start/v3`，因此既有能力列不变。v2.4.0 还把回执驱动开发改为
	// 自主选择，这改变的是模式封套报告的内容，而非是否报告。v2.2.4
	// 与 v2.3.0 发布时 Pi 仍停留在 2.2.3；它们从未被钉住或探测，因此
	// 没有对应行。
	"2.4.0": Object.freeze({ start: true, finalize: true, validate: true, bindSdd: true, status: true, inventory: true, reclaim: true, recover: true, abandon: true, quarantineLegacy: true, reconcileAuthority: true, repairLegacyAlias: true, mode: true, riskEvidence: false, hint: false, delivery: true }),
	// 通过将确切的 v2.5.0-rc.3 标签构建送入 gentle-ai-bench 驱动的旅程
	// 语料（退出码 0）实测，该语料演练 Pi 消费的启动/状态/捕获/验证/
	// 模式/交付生命周期。v2 通道宣告 capabilities/v2.3，其评审 START 是
	// #499 已解码的 `start/v4` 续跑封套；Pi 消费的封闭字段未变，因此
	// 各列与 2.4.0 行一致。riskEvidence 与 hint 保持暗置：仍未被证明
	// 能到达 Pi 读取的协商路径。
	"2.5.0-rc.3": Object.freeze({ start: true, finalize: true, validate: true, bindSdd: true, status: true, inventory: true, reclaim: true, recover: true, abandon: true, quarantineLegacy: true, reconcileAuthority: true, repairLegacyAlias: true, mode: true, riskEvidence: false, hint: false, delivery: true }),
	// 对照从签名档案安装的已发布 v2.5.0 二进制实测：v2 通道上的
	// `review capabilities` 宣告 capabilities/v2.4（协议次版本 4），并
	// 应答 status/v6、consent/v3 与 `start/v4` 续跑，解码器都已能读取。
	// rc.3 到稳定版之间 Pi 消费的封闭字段没有变化，因此各列与
	// 2.5.0-rc.3 行一致。riskEvidence 与 hint 保持暗置：仍未被证明能
	// 到达 Pi 读取的协商 START 路径。
	"2.5.0": Object.freeze({ start: true, finalize: true, validate: true, bindSdd: true, status: true, inventory: true, reclaim: true, recover: true, abandon: true, quarantineLegacy: true, reconcileAuthority: true, repairLegacyAlias: true, mode: true, riskEvidence: false, hint: false, delivery: true }),
	// 对照从签名档案安装的已发布 v2.6.0 二进制实测：v2 通道上的
	// `review capabilities` 宣告 capabilities/v2.5（协议次版本 5），并
	// 应答 status/v7、consent/v3 与 `start/v4` 续跑，解码器都已能读取。
	// `review mode status --json` 仍应答 `gentle-ai.rdd-mode-status/v1`，
	// `review validate --gate pre-commit` 仍应答携带 `delivery` 的
	// `gentle-ai.review-gate-result/v1`，两者均对照二进制验证。在
	// `review start` 期间拒绝 consent/v3 提示时，`risk_evidence` 仍只
	// 出现在那个阻塞封套上，绝不出现在协商的 `start/v4` 续跑上，因此
	// riskEvidence 与 hint 保持暗置，理由与自 2.2.0 以来每一行相同：
	// 仍未被证明能到达 Pi 读取的协商 START 路径。2.5.0 到 2.6.0 之间
	// Pi 消费的封闭字段没有变化，因此各列与 2.5.0 行一致。
	"2.6.0": Object.freeze({ start: true, finalize: true, validate: true, bindSdd: true, status: true, inventory: true, reclaim: true, recover: true, abandon: true, quarantineLegacy: true, reconcileAuthority: true, repairLegacyAlias: true, mode: true, riskEvidence: false, hint: false, delivery: true }),
	// 对照从签名档案安装的已发布 v2.7.0 二进制实测：v2 通道上的
	// `review capabilities` 仍宣告 capabilities/v2.5（协议次版本 5），并
	// 应答 status/v7、consent/v3 与 `start/v4` 续跑，解码器都已能读取。
	// `review mode status --json` 仍应答 `gentle-ai.rdd-mode-status/v1`，
	// `review validate --gate pre-commit` 仍应答携带 `delivery` 的
	// `gentle-ai.review-gate-result/v1`，两者均对照二进制验证。
	// riskEvidence 与 hint 保持暗置，理由与自 2.2.0 以来每一行相同：
	// 仍未被证明能到达 Pi 读取的协商 START 路径。2.6.0 到 2.7.0 之间
	// Pi 消费的封闭字段没有变化，因此各列与 2.6.0 行一致。
	"2.7.0": Object.freeze({ start: true, finalize: true, validate: true, bindSdd: true, status: true, inventory: true, reclaim: true, recover: true, abandon: true, quarantineLegacy: true, reconcileAuthority: true, repairLegacyAlias: true, mode: true, riskEvidence: false, hint: false, delivery: true }),
	// 对照从签名发布档案取得的已发布 v2.8.0 linux/amd64 二进制实测。
	// v2 通道仍宣告 capabilities/v2.5（协议次版本 5），schema 为
	// status/v7、consent/v3 与 start/v4。2.7.0 到 2.8.0 之间 Pi 消费的
	// 封闭字段没有变化，因此本行重复 2.7.0。riskEvidence 与 hint 保持
	// 暗置，因为两者都未被证明能到达 Pi 消费的协商 START 路径。
	"2.8.0": Object.freeze({ start: true, finalize: true, validate: true, bindSdd: true, status: true, inventory: true, reclaim: true, recover: true, abandon: true, quarantineLegacy: true, reconcileAuthority: true, repairLegacyAlias: true, mode: true, riskEvidence: false, hint: false, delivery: true }),
	// v2.8.1 只改了运行时遥测的模型归因（gentle-ai#4536）；2.8.0 到
	// 2.8.1 之间 Pi 消费的封闭字段没有变化，因此本行完全重复 2.8.0。
	// riskEvidence 与 hint 保持暗置，因为两者都未被证明能到达 Pi 消费
	// 的协商 START 路径。
	"2.8.1": Object.freeze({ start: true, finalize: true, validate: true, bindSdd: true, status: true, inventory: true, reclaim: true, recover: true, abandon: true, quarantineLegacy: true, reconcileAuthority: true, repairLegacyAlias: true, mode: true, riskEvidence: false, hint: false, delivery: true }),
	// v2.8.2 发布了 OpenCode SDD 预检插件修复、community-tools 的 RTK
	// 获取，以及 Claude Code Stop 遥测。提供方契约 semver 保持 1.2.0；
	// 同一钉住重新镜像了在该 semver 下漂移过的捆绑字节（评审视角的
	// inspection.status “unavailable”、定向 validator 的
	// regressions/inspection 成员、七个 Pi 停止原因码）。这些都不触及
	// 本行协商的封闭 START/STATUS 字段，因此它完全重复 2.8.1。
	// riskEvidence 与 hint 保持暗置，因为两者都未被证明能到达 Pi 消费
	// 的协商 START 路径。
	"2.8.2": Object.freeze({ start: true, finalize: true, validate: true, bindSdd: true, status: true, inventory: true, reclaim: true, recover: true, abandon: true, quarantineLegacy: true, reconcileAuthority: true, repairLegacyAlias: true, mode: true, riskEvidence: false, hint: false, delivery: true }),
	// v2.9.0 发布了自主选择的 RTK Community Tool 集成（#4560，仅
	// installer/sync/TUI）、SDD 尝试台账修复（#4564、#4567、#4569——
	// 修正指针现在先按链相等再按形状判定，拒绝措辞也变了）、同步
	// telemetry-runtime 符号链接根（#4565）、OpenCode 评审员 Task 包装
	// 解码（#4545），以及 Engram 协议资产措辞（#4179）。通过在
	// gentle-ai 源码树中对 v2.8.2 与 v2.9.0 标签之间的
	// contracts/review-integration/v2 和 contracts/review-provider-contract
	// 做 diff 实测：零字节变化。以上都不触及本行协商的封闭 START/
	// STATUS 字段，因此它完全重复 2.8.2。riskEvidence 与 hint 保持暗置，
	// 因为两者都未被证明能到达 Pi 消费的协商 START 路径。
	"2.9.0": Object.freeze({ start: true, finalize: true, validate: true, bindSdd: true, status: true, inventory: true, reclaim: true, recover: true, abandon: true, quarantineLegacy: true, reconcileAuthority: true, repairLegacyAlias: true, mode: true, riskEvidence: false, hint: false, delivery: true }),
	// v2.9.1 发布了恢复兼容的 OpenCode 评审同意（#4584）与从会话转录
	// 派生 Claude Code SDD 派发权威（#4575、#4551）。通过在 gentle-ai
	// 源码树中对 v2.9.0 与 v2.9.1 标签之间的
	// contracts/review-integration/v2 和 contracts/review-provider-contract
	// 做 diff 实测：零字节变化。两个变更都不触及本行协商的封闭
	// START/STATUS 字段，因此它完全重复 2.9.0。riskEvidence 与 hint 保持
	// 暗置，因为两者都未被证明能到达 Pi 消费的协商 START 路径。
	"2.9.1": Object.freeze({ start: true, finalize: true, validate: true, bindSdd: true, status: true, inventory: true, reclaim: true, recover: true, abandon: true, quarantineLegacy: true, reconcileAuthority: true, repairLegacyAlias: true, mode: true, riskEvidence: false, hint: false, delivery: true }),
});

export interface NativeReviewProcessDiagnostics {
	operation: NativeReviewOperation;
	error_code: NativeReviewErrorCode;
	exit_code?: number;
	signal?: NodeJS.Signals;
	timed_out: boolean;
	output_limit_exceeded: boolean;
	max_buffer_bytes?: number;
	configuration_hint?: string;
	stderr?: string;
}

export class NativeReviewCliError extends Error {
	readonly code: NativeReviewErrorCode;
	readonly operation: NativeReviewOperation;
	readonly launchAttempted: boolean;
	readonly mutating: boolean;
	readonly mutationOutcome: "none" | "unknown";
	readonly nextAction?: "review.status";
	readonly diagnostics: NativeReviewProcessDiagnostics;
	readonly auditRecord?: Record<string, unknown>;
	constructor(code: NativeReviewErrorCode, operation: NativeReviewOperation, launchAttempted: boolean, mutating: boolean, message: string, diagnostics?: NativeReviewProcessDiagnostics, auditRecord?: Record<string, unknown>) {
		super(message);
		this.name = "NativeReviewCliError";
		this.code = code;
		this.operation = operation;
		this.launchAttempted = launchAttempted;
		this.mutating = mutating;
		this.mutationOutcome = launchAttempted && mutating ? "unknown" : "none";
		this.nextAction = this.mutationOutcome === "unknown" && operation !== NATIVE_REVIEW_OPERATION.SDD_ATTEMPT ? "review.status" : undefined;
		this.diagnostics = diagnostics ?? { operation, error_code: code, timed_out: false, output_limit_exceeded: false };
		this.auditRecord = auditRecord;
	}
}

// 扩展发出的每个 gentle-ai CLI 调用共用的唯一中央运行器。jero-pi M3
// （设计 §8）：gentle-pi.review-relay/v1 握手声明已删除——中继在进程内
