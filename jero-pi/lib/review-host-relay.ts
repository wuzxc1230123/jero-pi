// 精简的 Pi 宿主中继（gentle-pi#311 P4；提供方契约 gentle-ai#3249）。
//
// gentle-ai 拥有提示词物化、角色与 schema 选择、字节
// 预算、解析、准入、不可变捕获、重试、修正
// 记账以及回执状态。这条宿主边界刻意保持
// 狭窄：
//
//   1. 以 `--agent pi
//      --materialize` 原样运行提供方签发的捕获绑定，将 stdout 按不透明
//      的提示词字节（BYTES）逐字接收。
//   2. 将这些提示词字节传给纯粹的不透明 Pi 适配器，该适配器拥有自己的
//      锁定的打印模式子进程与全新空草稿目录；
//      将其 stdout 作为原始最终字节接收。模型/提供方/档案的选择
//      始终归用户所有：不加 --model，不加 --provider，环境原样不动。
//   3. 通过 collect 输入所携带的提供方所有的 `submission`
//      表单原封不动地提交这些字节：执行其精确的 operation 与
//      argument 令牌，仅把临时文件路径替换进已声明的
//      {{value}} 槽位（无 BOM：缓冲区逐字节
//      写入）。宿主从不合成或过滤完成
//      表单；没有提供方 submission 的物化槽位属于类型化
//      契约失配，绝不是重建的调用。
//
// 任何失败时中继都会返回类型化（TYPED）传输错误，并且不再
// 提交任何内容。传输失败后，调用方重新查询协商出的
// STATUS，且仅在完全相同的绑定槽位被重新提供时才重新发起 ——
// 绝不依据会话记录推断。中继从不解析或重建
// 绑定、证据、提示词、schema、预算或准入。

import { spawn } from "node:child_process";
import { closeSync, openSync, readSync } from "node:fs";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import {
	OPAQUE_PI_REVIEWER_TRANSPORT_FAILURE,
	OpaquePiReviewerTransportError,
	runOpaquePiReviewer,
	type OpaquePiReviewerResult,
} from "./opaque-pi-reviewer-adapter.ts";
import { REVIEW_PROVIDER_ROLE_CAPTURE_OPERATION, REVIEW_PROVIDER_ROLE_CAPTURE_OPERATIONS, type ReviewCaptureSubmissionV1, type ReviewCollectInputV3 } from "./authority/wire-contract.ts";

// 为既有中继消费者保留的兼容导出。纯适配器拥有固定的
// Pi 进程边界及其锁定的 argv。
export { OPAQUE_PI_REVIEWER_ARGV as REVIEW_HOST_RELAY_PI_ARGV } from "./opaque-pi-reviewer-adapter.ts";

export const REVIEW_HOST_RELAY_UNAVAILABLE_MESSAGE =
	"provider relay requires a gentle-ai build with the pi host relay surface";

export const REVIEW_HOST_RELAY_FAILURE = {
	RELAY_UNAVAILABLE: "relay-unavailable",
	SUBMISSION_CONTRACT_MISMATCH: "submission-contract-mismatch",
	MATERIALIZE_FAILED: "materialize-failed",
	EMPTY_PROMPT: "empty-prompt",
	PI_LAUNCH_FAILED: "pi-launch-failed",
	PI_FAILED: "pi-failed",
	// gentle-pi#367：被中继上限杀死的评审器不是崩溃。它是
	// 字节级相同的重新发起也无法存活的唯一失败类别，
	// 因此它拥有自己的 kind、自己的 elapsed/limit 证据，以及自己的
	// 后续处理，而不是藏在 `pi-failed` 之内。
	PI_TIMED_OUT: "pi-timed-out",
	PI_EMPTY_OUTPUT: "pi-empty-output",
	SUBMISSION_REFUSED: "submission-refused",
} as const;
export type ReviewHostRelayFailureKind = (typeof REVIEW_HOST_RELAY_FAILURE)[keyof typeof REVIEW_HOST_RELAY_FAILURE];

export type ReviewHostRelayStage = "binding" | "materialize" | "pi" | "submit";

export const REVIEW_HOST_RELAY_SUBMISSION_VALUE_SLOT = "{{value}}";

export const REVIEW_HOST_RELAY_SUBMISSION_MISSING_MESSAGE =
	"provider contract mismatch: the materialize capture input carries no provider-owned submission form; the host never synthesizes the completing form";

export class ReviewHostRelayError extends Error {
	readonly kind: ReviewHostRelayFailureKind;
	readonly stage: ReviewHostRelayStage;
	readonly exitCode: number | null;
	readonly stderr: string;
	readonly timedOut: boolean;
	// 被杀死或失败的子进程实际消耗的墙钟时间，以及度量它所依据的
	// 上限。只有当没有子进程运行过时二者才为 null。
	// 没有它们就无法把传输失败与崩溃区分开，这正是
	// 迫使 gentle-pi#367 报告者手工测量中继的原因。
	readonly elapsedMs: number | null;
	readonly timeoutMs: number | null;
	// 在 submission 调用发起之前为 "none"；已发起但结局
	// 无法读取的 submission 为 "unknown"，调用方通过
	// 协商出的 STATUS 对账，绝不盲目重试。已发起却被
	// gentle-ai 以其类型化准入拒绝的 submission 重新回到
	// "none"：提供方声明该评审视角槽位未被消费
	// （gentle-pi#522 / #524）。
	readonly mutationOutcome: "none" | "unknown";
	constructor(kind: ReviewHostRelayFailureKind, stage: ReviewHostRelayStage, message: string, details?: { exitCode?: number | null; stderr?: string; timedOut?: boolean; elapsedMs?: number; timeoutMs?: number; mutationOutcome?: "none" | "unknown" }) {
		super(message);
		this.name = "ReviewHostRelayError";
		this.kind = kind;
		this.stage = stage;
		this.exitCode = details?.exitCode ?? null;
		this.stderr = details?.stderr ?? "";
		this.timedOut = details?.timedOut ?? false;
		this.elapsedMs = details?.elapsedMs ?? null;
		this.timeoutMs = details?.timeoutMs ?? null;
		this.mutationOutcome = details?.mutationOutcome ?? (stage === "submit" ? "unknown" : "none");
	}
}

// gentle-pi#522 / #524：gentle-ai 在任何准入之前以退出码 1 及其类型化
// 操作符行 `<reason> [invalid_request]` 拒绝评审器 submission。
// 该代码属于提供方的预检类别：请求按原样被拒绝，
// 且评审视角槽位未被消费。中继只识别这一
// 类型化形态；它从不解析原因，也从不重试。
const ADMISSION_REFUSAL = /\[invalid_request\]/;

export function isReviewHostRelayAdmissionRefusal(capture: { exitCode: number | null; timedOut: boolean }, stderr: string): boolean {
	return capture.exitCode === 1 && !capture.timedOut && ADMISSION_REFUSAL.test(stderr);
}

// 二进制传输 materialize 调用的拒绝分类。
// 已安装的 gentle-ai 是 materialize 表单是否存在的唯一权威；
// Pi 从不做版本嗅探。jero-pi M3（设计 §8）：
// gentle-pi.review-relay/v1 握手环境变量及其拒绝类别已被删除
// —— 不再遗留任何需要声明的跨进程契约。
const UNKNOWN_FLAG_REFUSAL = /flag provided but not defined: -{1,2}(?:materialize|agent)\b/;

export function classifyReviewHostRelayRefusal(stderr: string): "unknown-flag" | "other" {
	if (UNKNOWN_FLAG_REFUSAL.test(stderr)) return "unknown-flag";
	return "other";
}

// ---------------------------------------------------------------------------
// gentle-pi#638：只有中继上限导致的评审器超时对所选的确切槽位才是
// 决定性的：重新发起同一个物化请求只会撞上同一堵
// 墙。一般性准入拒绝，包括格式错误的评审器 JSON 与
// binding_mismatch [invalid_request]，描述的是可修复的已提交字节；换一个
// 全新的评审器即可改变它们。它们保持现有的精确重新提供路径。
// 未来的提供方签发、类型化的槽位决定性拒绝，只有在其 schema 证明这个
// 确切绑定槽位无法修复时，才可添加到这里。
// ---------------------------------------------------------------------------

export const REVIEW_HOST_RELAY_UNACHIEVABLE_REASON = {
	PI_TIMED_OUT: "relay_transport_bound_exceeded",
} as const;

export function reviewHostRelayUnachievableReason(error: ReviewHostRelayError): string | undefined {
	return error.kind === REVIEW_HOST_RELAY_FAILURE.PI_TIMED_OUT
		? REVIEW_HOST_RELAY_UNACHIEVABLE_REASON.PI_TIMED_OUT
		: undefined;
}

// 声明中 --detail 的可选有界证据。只有被杀死的评审器才携带值得记录的测量数据；准入拒绝的文本已随 failure.stderr 携带，未测量的失败绝不伪造 detail。
export function reviewHostRelayUnachievableDetail(error: ReviewHostRelayError): string | undefined {
	if (error.kind === REVIEW_HOST_RELAY_FAILURE.PI_TIMED_OUT && error.elapsedMs !== null && error.timeoutMs !== null) {
		return `killed after ${error.elapsedMs}ms against a ${error.timeoutMs}ms relay bound`;
	}
	return undefined;
}

// ---------------------------------------------------------------------------
// 槽位检测 —— 由提供方决定。只有当提供方自己在
// `review.capture-result` 收集输入上签发了 `--materialize` 令牌
// （连同 pi 运行时身份）时，该 collect 输入才经由
// 宿主中继路由。绝不从状态散文、风险或会话记录推断任何东西。
// ---------------------------------------------------------------------------

export interface ReviewHostRelaySlot {
	/** 每一个提供方签发的参数令牌，逐字、按提供方顺序。 */
	readonly captureArgumentTokens: readonly string[];
	/**
	 * 提供方所有的完成表单，逐字保留。仅当提供方
	 * 违反自身契约时缺失；此时中继保守失败并抛出
	 * 类型化的 submission-contract-mismatch 错误，而不是凭空合成一个。
	 */
	readonly submission?: ReviewCaptureSubmissionV1;
	readonly lens?: string;
	readonly order?: string;
	readonly subjectHash?: string;
}

function argumentValue(input: ReviewCollectInputV3, name: string): string | undefined {
	const matches = input.arguments.filter((argument) => argument.name === name);
	return matches.length === 1 ? matches[0]!.value : undefined;
}

function renderToken(argument: ReviewCollectInputV3["arguments"][number]): string {
	return argument.token ?? `--${argument.name}=${argument.value}`;
}

export function isReviewHostRelayCollectInput(input: ReviewCollectInputV3): boolean {
	return input.captureOperation === "review.capture-result"
		&& argumentValue(input, "materialize") === "true"
		&& argumentValue(input, "agent") === "pi";
}

export function reviewHostRelaySlots(inputs: readonly ReviewCollectInputV3[]): readonly ReviewHostRelaySlot[] {
	return inputs.filter((input) => isReviewHostRelayCollectInput(input)).map((input) => ({
		captureArgumentTokens: input.arguments.map((argument) => renderToken(argument)),
		...(input.submission === undefined ? {} : { submission: input.submission }),
		...(argumentValue(input, "lens") === undefined ? {} : { lens: argumentValue(input, "lens") }),
		...(argumentValue(input, "order") === undefined ? {} : { order: argumentValue(input, "order") }),
		...(input.artifactSubject === undefined ? {} : { subjectHash: input.artifactSubject.subjectHash }),
	}));
}

// ---------------------------------------------------------------------------
// 提供方角色向量（gentle-pi#311 P4-roles）—— 两个由 Go 拥有的非评审视角
// 对抗性角色捕获操作。与上面的评审视角物化槽位不同，
// 这些向量是自包含（SELF-CONTAINED）的：提供方渲染出绑定
// 令牌外加 `--agent=pi --execute=true`，执行这个精确渲染的
// 调用会让 Go 物化角色提示词、生成自己锁定的
// pi 子进程，并把原始裁决准入到紧凑槽位。宿主
// 从不为这些槽位做物化、启动 pi 或提交任何东西 —— 它
// 逐字运行一次 CLI 调用并重新查询协商出的 STATUS。
// ---------------------------------------------------------------------------

export interface ReviewProviderRoleVectorSlot {
	/** 提供方命名的捕获操作，例如 `review.capture-refuter`。 */
	readonly captureOperation: (typeof REVIEW_PROVIDER_ROLE_CAPTURE_OPERATION)[keyof typeof REVIEW_PROVIDER_ROLE_CAPTURE_OPERATION];
	/** 每一个提供方签发的参数令牌，逐字、按提供方顺序。 */
	readonly argumentTokens: readonly string[];
	/** 提供方声明的输入名，例如 `provider_refuter`。 */
	readonly name: string;
}

export function isReviewProviderRoleVectorInput(input: ReviewCollectInputV3): boolean {
	return (REVIEW_PROVIDER_ROLE_CAPTURE_OPERATIONS as readonly string[]).includes(input.captureOperation)
		&& argumentValue(input, "execute") === "true"
		&& argumentValue(input, "agent") === "pi";
}

export function reviewProviderRoleVectorSlots(inputs: readonly ReviewCollectInputV3[]): readonly ReviewProviderRoleVectorSlot[] {
	return inputs.filter((input) => isReviewProviderRoleVectorInput(input)).map((input) => ({
		captureOperation: input.captureOperation as ReviewProviderRoleVectorSlot["captureOperation"],
		argumentTokens: input.arguments.map((argument) => renderToken(argument)),
		name: input.name,
	}));
}

// 将提供方所有的 submission 表单解析为可执行的绑定。
// 每当完成表单缺失或无法绑定恰好一个产物值时，都以类型化的
// contract-mismatch 错误保守失败；中继从不
// 修复、过滤或合成它。
export interface ReviewHostRelaySubmissionBinding {
	readonly operationToken: string;
	readonly argumentTokens: readonly string[];
	readonly substitutionLocation: number;
}

export function resolveReviewHostRelaySubmission(submission: ReviewCaptureSubmissionV1 | undefined): ReviewHostRelaySubmissionBinding {
	if (submission === undefined) {
		throw new ReviewHostRelayError(REVIEW_HOST_RELAY_FAILURE.SUBMISSION_CONTRACT_MISMATCH, "binding", REVIEW_HOST_RELAY_SUBMISSION_MISSING_MESSAGE);
	}
	if (submission.operationToken.length === 0 || submission.argumentTokens.length === 0 || submission.argumentTokens.some((token) => typeof token !== "string" || token.length === 0)) {
		throw new ReviewHostRelayError(REVIEW_HOST_RELAY_FAILURE.SUBMISSION_CONTRACT_MISMATCH, "binding", "provider contract mismatch: the submission form carries an empty operation or argument token");
	}
	if (submission.values.length !== 1) {
		throw new ReviewHostRelayError(REVIEW_HOST_RELAY_FAILURE.SUBMISSION_CONTRACT_MISMATCH, "binding", `provider contract mismatch: the submission form must bind exactly one artifact value, received ${submission.values.length}`);
	}
	const value = submission.values[0]!;
	const location = value.substitutionLocation;
	if (!Number.isSafeInteger(location) || location < 0 || location >= submission.argumentTokens.length) {
		throw new ReviewHostRelayError(REVIEW_HOST_RELAY_FAILURE.SUBMISSION_CONTRACT_MISMATCH, "binding", "provider contract mismatch: the submission substitution location is outside its argument tokens");
	}
	if (!submission.argumentTokens[location]!.includes(REVIEW_HOST_RELAY_SUBMISSION_VALUE_SLOT)) {
		throw new ReviewHostRelayError(REVIEW_HOST_RELAY_FAILURE.SUBMISSION_CONTRACT_MISMATCH, "binding", `provider contract mismatch: the submission token at location ${location} carries no ${REVIEW_HOST_RELAY_SUBMISSION_VALUE_SLOT} slot`);
	}
	return { operationToken: submission.operationToken, argumentTokens: submission.argumentTokens, substitutionLocation: location };
}

// ---------------------------------------------------------------------------
// 中继执行
// ---------------------------------------------------------------------------

export interface ReviewHostRelayRequest {
	readonly captureArgumentTokens: readonly string[];
	/** 供协调器专用的原生 materialize/submit 调用所用的权威目标工作树。 */
	readonly targetCwd?: string;
	/** 提供方所有的完成表单；缺失即契约失配。 */
	readonly submission?: ReviewCaptureSubmissionV1;
	/** 绝对路径；默认为已验证的包内二进制。 */
	readonly providerExecutable?: string;
	/** 用户所有的 pi 启动器；默认为 PATH 上的 `pi`。 */
	readonly piExecutable?: string;
	readonly environment?: NodeJS.ProcessEnv;
	readonly providerTimeoutMs?: number;
	/**
	 * 完全覆盖评审器上限。生产环境保持未设置，由中继从
	 * 物化的提示词字节和
	 * {@link REVIEW_HOST_RELAY_PI_TIMEOUT_ENV} 推导上限；这个接缝的存在
	 * 是为了让测试无需真实等待墙钟时间即可
	 * 覆盖超时分支。
	 */
	readonly piTimeoutMs?: number;
	readonly signal?: AbortSignal;
}

export interface ReviewHostRelayResult {
	readonly promptByteLength: number;
	readonly resultByteLength: number;
	/** 原始 submission stdout（提供方已准入的 manifest JSON），不透明。 */
	readonly submission: string;
}

/** 不透明的物化并评审结果，尚未提交给提供方。 */
export interface ReviewHostRelayPreparedResult {
	/** 在物化开始前捕获的拷贝安全请求快照。 */
	readonly request: ReviewHostRelayRequest;
	readonly promptByteLength: number;
	readonly resultByteLength: number;
}

const preparedResultBytes = new WeakMap<ReviewHostRelayPreparedResult, Buffer>();

export type ReviewHostRelayRunner = (request: ReviewHostRelayRequest) => Promise<ReviewHostRelayResult>;
export type ReviewHostRelayPreparationRunner = (request: ReviewHostRelayRequest) => Promise<ReviewHostRelayPreparedResult>;
export type ReviewHostRelaySubmissionRunner = (prepared: ReviewHostRelayPreparedResult) => Promise<ReviewHostRelayResult>;

// jero-pi M3 接缝（spec §I.7）：`renderSlot` 用进程内 authority.capture 渲染
// 替换二进制 materialize 阶段（仅提示词字节 —— 该
// 接缝从不生成进程），`admitResult` 用读取暂存结果文件的进程内
// 捕获准入替换二进制 submit 阶段。二者
// 默认都与 P1 桩一样保守失败。扩展（P4）
// 组合为：STATUS(collect) → renderBinding → relay prepare（pi 子进程）→
// relay submit（进程内准入）。
export type ReviewHostRelayRenderSlot = (request: ReviewHostRelayRequest) => Promise<{ promptBytes: Buffer }>;
export type ReviewHostRelayAdmitResult = (request: ReviewHostRelayRequest, operationToken: string, argumentTokens: readonly string[], resultFile: string) => Promise<string>;

const DEFAULT_GENTLE_AI_TIMEOUT_MS = 120_000;

// ---------------------------------------------------------------------------
// 评审器子进程上限（gentle-pi#367）。
//
// 旧上限是单个硬编码的 600_000 ms，只能通过
// 可测试注入的 runner 触达。一次实地测量的评审视角面对约 1.58 MB 的
// 物化提示词合理地需要 478 秒：它手工运行得以存活，却在
// 中继下被杀死，获准的后续处理随后又把每个评审视角重新花了一遍，
// 撞上同一堵墙。一个固定数字无法服务跨
// 数量级变化的提示词类别，因此改为推导上限：
//
//   floor + ceil(promptBytes / MiB * perMebibyte)，并钳制到上限值
//
// floor 覆盖不依赖提示词大小的模型延迟；线性项
// 覆盖依赖大小的那一部分。在实测的 1.58 MB 下，推导出的
// 上限约 37 分钟，相对评审器实际需要的 478 秒约有 4.7 倍余量
// —— 刻意宽松，因为评审器模型与
// 提供方归用户所有，中继无法知晓其吞吐量。
//
// JERO_PI_REVIEW_RELAY_PI_TIMEOUT_MS 为知晓自身配置的调用方
// 完全替换推导上限。它遵循仓库既有的
// 数值覆盖形态（JERO_PI_CANDIDATE_GIT_TIMEOUT_MS、
// JERO_PI_REVIEW_MAX_BUFFER_BYTES）：正十进制数，格式
// 非法时静默忽略，并钳制到同一个硬上限，因此任何配置都
// 无法把前台 FINALIZE 变成无界子进程。
// ---------------------------------------------------------------------------

export const REVIEW_HOST_RELAY_PI_TIMEOUT_ENV = "JERO_PI_REVIEW_RELAY_PI_TIMEOUT_MS";
export const REVIEW_HOST_RELAY_PI_TIMEOUT_FLOOR_MS = 900_000;
export const REVIEW_HOST_RELAY_PI_TIMEOUT_PER_MEBIBYTE_MS = 900_000;
export const REVIEW_HOST_RELAY_PI_TIMEOUT_MAX_MS = 7_200_000;
const BYTES_PER_MEBIBYTE = 1024 * 1024;

export function resolveReviewHostRelayPiTimeoutMs(promptByteLength: number, environment: NodeJS.ProcessEnv = process.env): number {
	const configured = environment[REVIEW_HOST_RELAY_PI_TIMEOUT_ENV];
	if (configured !== undefined && /^[1-9]\d*$/.test(configured)) {
		const parsed = Number(configured);
		if (Number.isSafeInteger(parsed)) return Math.min(parsed, REVIEW_HOST_RELAY_PI_TIMEOUT_MAX_MS);
	}
	const bytes = Number.isSafeInteger(promptByteLength) && promptByteLength > 0 ? promptByteLength : 0;
	const scaled = REVIEW_HOST_RELAY_PI_TIMEOUT_FLOOR_MS + Math.ceil((bytes / BYTES_PER_MEBIBYTE) * REVIEW_HOST_RELAY_PI_TIMEOUT_PER_MEBIBYTE_MS);
	return Math.min(scaled, REVIEW_HOST_RELAY_PI_TIMEOUT_MAX_MS);
}

// 评审器是时间耗尽，不是崩溃。该消息陈述两项
// 测量值，并点名能改变结局的两件事，因为
// 唯一无法改变结局的就是原样重新发起同一个槽位。
export function reviewHostRelayPiTimeoutMessage(elapsedMs: number, timeoutMs: number, promptByteLength: number): string {
	return `pi reviewer subprocess exceeded the relay bound: killed after ${elapsedMs}ms against a ${timeoutMs}ms limit for a ${promptByteLength}-byte materialized prompt. `
		+ `Relaunching the same slot unchanged reaches the same wall. Raise ${REVIEW_HOST_RELAY_PI_TIMEOUT_ENV} above the reviewer's real wall time (ceiling ${REVIEW_HOST_RELAY_PI_TIMEOUT_MAX_MS}ms) or reduce the candidate scope so the materialized prompt is smaller.`;
}

interface ProcessCapture {
	stdout: Buffer;
	stderr: Buffer;
	exitCode: number | null;
	timedOut: boolean;
	elapsedMs: number;
}

// Windows 的 CreateProcess 只解析 *.exe；带 shebang 的无扩展启动器
// （含 POSIX 风格垫片）无法直接 spawn（ENOENT）。改为经由当前 Node
// 可执行文件运行——子进程的 process.argv[2:] 与 POSIX 直执行完全一致。
// 与 lib/opaque-pi-reviewer-adapter.ts 的路由规则保持一致。
function launchableProcessTarget(file: string): { file: string; argumentPrefix: readonly string[] } {
	if (process.platform === "win32" && !/\.(exe|cmd|bat)$/i.test(file)) {
		try {
			const fd = openSync(file, "r");
			try {
				const header = Buffer.alloc(2);
				if (readSync(fd, header, 0, 2, 0) === 2 && header[0] === 0x23 && header[1] === 0x21) return { file: process.execPath, argumentPrefix: [file] };
			} finally { closeSync(fd); }
		} catch { /* 不可读的启动器向下穿透到直接 spawn，后者自行给出类型化启动失败。 */ }
	}
	return { file, argumentPrefix: [] };
}

function collectProviderProcess(
	file: string,
	arguments_: readonly string[],
	options: { cwd: string; env: NodeJS.ProcessEnv; stdin?: Buffer; timeoutMs: number; signal?: AbortSignal },
): Promise<ProcessCapture> {
	return new Promise((resolve, reject) => {
		const startedAt = Date.now();
		const target = launchableProcessTarget(file);
		const child = spawn(target.file, [...target.argumentPrefix, ...arguments_], {
			cwd: options.cwd,
			env: options.env,
			stdio: ["pipe", "pipe", "pipe"],
			shell: false,
			windowsHide: true,
			...(options.signal === undefined ? {} : { signal: options.signal }),
		});
		const stdout: Buffer[] = [];
		const stderr: Buffer[] = [];
		let timedOut = false;
		let settled = false;
		const timer = options.timeoutMs > 0
			? setTimeout(() => {
				timedOut = true;
				child.kill("SIGKILL");
			}, options.timeoutMs)
			: undefined;
		timer?.unref();
		child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
		child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
		child.on("error", (error) => {
			if (settled) return;
			settled = true;
			if (timer !== undefined) clearTimeout(timer);
			reject(error);
		});
		child.on("close", (code) => {
			if (settled) return;
			settled = true;
			if (timer !== undefined) clearTimeout(timer);
			resolve({ stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr), exitCode: code, timedOut, elapsedMs: Date.now() - startedAt });
		});
		if (options.stdin === undefined) {
			child.stdin.end();
		} else {
			child.stdin.on("error", () => undefined);
			child.stdin.end(options.stdin);
		}
	});
}

function relayPiTransportError(error: unknown, promptByteLength: number, piTimeoutMs: number): ReviewHostRelayError {
	if (!(error instanceof OpaquePiReviewerTransportError)) {
		return new ReviewHostRelayError(
			REVIEW_HOST_RELAY_FAILURE.PI_LAUNCH_FAILED,
			"pi",
			`pi subprocess could not start: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	const details = {
		exitCode: error.exitCode,
		stderr: error.stderr.toString("utf8"),
		timedOut: error.timedOut,
		...(error.elapsedMs === null ? {} : { elapsedMs: error.elapsedMs }),
		...(error.timeoutMs === null ? {} : { timeoutMs: error.timeoutMs }),
	};
	if (
		error.kind === OPAQUE_PI_REVIEWER_TRANSPORT_FAILURE.TIMED_OUT
		&& error.elapsedMs !== null
		&& error.timeoutMs !== null
	) {
		return new ReviewHostRelayError(
			REVIEW_HOST_RELAY_FAILURE.PI_TIMED_OUT,
			"pi",
			reviewHostRelayPiTimeoutMessage(error.elapsedMs, error.timeoutMs, promptByteLength),
			{ ...details, timedOut: true, elapsedMs: error.elapsedMs, timeoutMs: error.timeoutMs },
		);
	}
	if (error.kind === OPAQUE_PI_REVIEWER_TRANSPORT_FAILURE.EMPTY_OUTPUT) {
		return new ReviewHostRelayError(REVIEW_HOST_RELAY_FAILURE.PI_EMPTY_OUTPUT, "pi", "pi subprocess produced no output bytes", details);
	}
	if (
		error.kind === OPAQUE_PI_REVIEWER_TRANSPORT_FAILURE.LAUNCH_FAILED
		|| error.kind === OPAQUE_PI_REVIEWER_TRANSPORT_FAILURE.SCRATCH_FAILED
	) {
		return new ReviewHostRelayError(REVIEW_HOST_RELAY_FAILURE.PI_LAUNCH_FAILED, "pi", `pi subprocess could not start: ${error.message}`, details);
	}
	return new ReviewHostRelayError(REVIEW_HOST_RELAY_FAILURE.PI_FAILED, "pi", "pi subprocess failed", details);
}

function assertTokens(name: string, tokens: readonly string[]): void {
	if (tokens.length === 0) throw new TypeError(`Pi host relay requires the provider-issued ${name} tokens`);
	if (tokens.some((token) => typeof token !== "string" || token.length === 0)) {
		throw new TypeError(`Pi host relay ${name} tokens must all be non-empty strings`);
	}
}

function snapshotReviewHostRelayRequest(request: ReviewHostRelayRequest): ReviewHostRelayRequest {
	assertTokens("capture", request.captureArgumentTokens);
	// 完成表单在任何进程启动前即被校验：没有提供方
	// submission 的物化槽位是类型化契约失配，
	// 绝不会变成合成的调用。
	resolveReviewHostRelaySubmission(request.submission);
	// jero-pi P1：不存在打包的二进制。仍可显式提供可执行文件
	// （测试用），但没有它时中继在
	// materialize/submit 阶段保守失败；P2 用进程内
	// authority.capture 渲染替换这些阶段。
	const providerExecutable = request.providerExecutable;
	if (providerExecutable !== undefined && !isAbsolute(providerExecutable)) throw new TypeError("Pi host relay requires an absolute gentle-ai executable path");
	const environment = Object.freeze({ ...(request.environment ?? process.env) }) as NodeJS.ProcessEnv;
	const submission = request.submission === undefined ? undefined : Object.freeze({
		operationToken: request.submission.operationToken,
		argumentTokens: Object.freeze([...request.submission.argumentTokens]),
		values: Object.freeze(request.submission.values.map((value) => Object.freeze({ ...value }))),
	});
	return Object.freeze({
		...request,
		captureArgumentTokens: Object.freeze([...request.captureArgumentTokens]),
		...(submission === undefined ? {} : { submission }),
		providerExecutable,
		environment,
		providerTimeoutMs: request.providerTimeoutMs ?? DEFAULT_GENTLE_AI_TIMEOUT_MS,
		targetCwd: request.targetCwd ?? process.cwd(),
	});
}

/**
 * 物化一个提供方绑定的评审器提示词并运行其不透明的 Pi
 * 子进程。它不提交任何东西，因此各评审器的工作可以
 * 在调用方执行提供方排序的准入之前完成。
 */
export async function prepareReviewHostRelaySlot(
	request: ReviewHostRelayRequest,
	reviewer: typeof runOpaquePiReviewer = runOpaquePiReviewer,
	render?: ReviewHostRelayRenderSlot,
): Promise<ReviewHostRelayPreparedResult> {
	// 在第一个异步边界之前拷贝可变的传输配置。所提供的
	// AbortSignal 有意跨 materialize、reviewer
	// 与 submit 保持活跃，保留既有的取消行为。
	const preparedRequest = snapshotReviewHostRelayRequest(request);

	// jero-pi M3：渲染接缝是生产路径 ——
	// authority.capture.renderBinding 字节，不生成进程。没有接缝（且
	// 没有仅供 fixture 使用的可执行文件）时，中继精确地像
	// P1 桩那样保守失败：什么也不物化，什么也不提交。
	if (render !== undefined) {
		let promptBytes: Buffer;
		try {
			promptBytes = Buffer.from((await render(preparedRequest)).promptBytes);
		} catch (error) {
			if (error instanceof ReviewHostRelayError) throw error;
			throw new ReviewHostRelayError(REVIEW_HOST_RELAY_FAILURE.MATERIALIZE_FAILED, "materialize", `in-process capture rendering failed: ${error instanceof Error ? error.message : String(error)}`);
		}
		if (promptBytes.length === 0) {
			throw new ReviewHostRelayError(REVIEW_HOST_RELAY_FAILURE.EMPTY_PROMPT, "materialize", "in-process capture rendering produced no bytes");
		}
		return await runPreparedReviewerV1(preparedRequest, promptBytes, reviewer);
	}

	if (preparedRequest.providerExecutable === undefined) {
		throw new ReviewHostRelayError(REVIEW_HOST_RELAY_FAILURE.RELAY_UNAVAILABLE, "materialize", "authority-unavailable: no in-process renderSlot seam was injected and no binary transport exists (jero-pi M3)");
	}

	// 提供方物化不透明提示词并检测此中继
	// 表面是否可用。不做版本嗅探，也不做提示词重建。
	let materialized: ProcessCapture;
	try {
		materialized = await collectProviderProcess(preparedRequest.providerExecutable!, ["review", "capture-result", ...preparedRequest.captureArgumentTokens], {
			cwd: preparedRequest.targetCwd!,
			env: { ...preparedRequest.environment! },
			timeoutMs: preparedRequest.providerTimeoutMs!,
			...(preparedRequest.signal === undefined ? {} : { signal: preparedRequest.signal }),
		});
	} catch (error) {
		throw new ReviewHostRelayError(REVIEW_HOST_RELAY_FAILURE.MATERIALIZE_FAILED, "materialize", `gentle-ai prompt materialization could not start: ${error instanceof Error ? error.message : String(error)}`);
	}
	if (materialized.exitCode !== 0 || materialized.timedOut) {
		const stderr = materialized.stderr.toString("utf8");
		const refusal = classifyReviewHostRelayRefusal(stderr);
		const timing = { elapsedMs: materialized.elapsedMs, timeoutMs: preparedRequest.providerTimeoutMs! };
		if (refusal === "unknown-flag") {
			throw new ReviewHostRelayError(REVIEW_HOST_RELAY_FAILURE.RELAY_UNAVAILABLE, "materialize", REVIEW_HOST_RELAY_UNAVAILABLE_MESSAGE, {
				exitCode: materialized.exitCode,
				stderr,
				timedOut: materialized.timedOut,
				...timing,
			});
		}
		throw new ReviewHostRelayError(REVIEW_HOST_RELAY_FAILURE.MATERIALIZE_FAILED, "materialize", materialized.timedOut
			? `gentle-ai prompt materialization exceeded its ${preparedRequest.providerTimeoutMs!}ms bound after ${materialized.elapsedMs}ms`
			: "gentle-ai prompt materialization failed", { exitCode: materialized.exitCode, stderr, timedOut: materialized.timedOut, ...timing });
	}
	const promptBytes = materialized.stdout;
	return await runPreparedReviewerV1(preparedRequest, promptBytes, reviewer, {
		emptyPromptError: new ReviewHostRelayError(REVIEW_HOST_RELAY_FAILURE.EMPTY_PROMPT, "materialize", "gentle-ai prompt materialization produced no bytes", {
			exitCode: 0,
			stderr: materialized.stderr.toString("utf8"),
			elapsedMs: materialized.elapsedMs,
			timeoutMs: preparedRequest.providerTimeoutMs!,
		}),
	});
}

// 渲染接缝与二进制传输共享的评审器阶段：上限
// 从实际物化的提示词字节推导，纯
// 适配器拥有全新隔离的 Pi 进程，准备好的结果
// 把自己的字节保存在私有 WeakMap 中。
async function runPreparedReviewerV1(
	preparedRequest: ReviewHostRelayRequest,
	promptBytes: Buffer,
	reviewer: typeof runOpaquePiReviewer,
	options: { emptyPromptError?: ReviewHostRelayError } = {},
): Promise<ReviewHostRelayPreparedResult> {
	if (promptBytes.length === 0) {
		throw options.emptyPromptError ?? new ReviewHostRelayError(REVIEW_HOST_RELAY_FAILURE.EMPTY_PROMPT, "materialize", "capture rendering produced no bytes");
	}
	// 评审器上限从提供方实际物化的提示词
	// 推导。显式的请求超时是测试接缝，优先级高于
	// 用户所有的环境覆盖和按规模推导的上限。
	const piTimeoutMs = preparedRequest.piTimeoutMs ?? resolveReviewHostRelayPiTimeoutMs(promptBytes.length, preparedRequest.environment);

	// 纯适配器拥有全新隔离的 Pi 进程。其输入和输出
	// 都是不透明字节；这个协调器只映射传输失败。
	let piResult: OpaquePiReviewerResult;
	try {
		piResult = await reviewer(promptBytes, {
			...(preparedRequest.piExecutable === undefined ? {} : { piExecutable: preparedRequest.piExecutable }),
			environment: preparedRequest.environment,
			timeoutMs: piTimeoutMs,
			...(preparedRequest.signal === undefined ? {} : { signal: preparedRequest.signal }),
		});
	} catch (error) {
		throw relayPiTransportError(error, promptBytes.length, piTimeoutMs);
	}
	const prepared = Object.freeze({
		request: preparedRequest,
		promptByteLength: promptBytes.length,
		resultByteLength: piResult.stdoutByteLength,
	});
	preparedResultBytes.set(prepared, Buffer.from(piResult.stdout));
	return prepared;
}

/**
 * 在等待任何结果之前先启动每个评审器。如果一个或多个评审器
 * 失败，它只在每个已启动的传输都落定后才拒绝，并按
 * 提供方顺序报告最早失败的请求。
 */
export async function runReviewHostRelayReviewerGroup(
	requests: readonly ReviewHostRelayRequest[],
	prepare: ReviewHostRelayPreparationRunner = prepareReviewHostRelaySlot,
): Promise<readonly ReviewHostRelayPreparedResult[]> {
	if (requests.length === 0) {
		throw new TypeError("Pi host relay reviewer group requires at least one provider-bound request");
	}
	const settled = await Promise.allSettled(requests.map(async (request) => await prepare(request)));
	const rejected = settled.filter((result): result is PromiseRejectedResult => result.status === "rejected");
	if (rejected.length > 0) {
		// 抛出首个拒绝以保持既有错误形态；其余失败附加在属性上，
		// 不再静默丢弃（审计 P2-18：正确但难排障）。
		const [first, ...rest] = rejected.map((result) => result.reason);
		if (rest.length > 0 && first instanceof Error) {
			(first as Error & { additionalRejections?: unknown[] }).additionalRejections = rest;
		}
		throw first;
	}
	return settled.map((result) => (result as PromiseFulfilledResult<ReviewHostRelayPreparedResult>).value);
}

/**
 * 通过精确的提供方所有完成表单提交一个已评审的不透明
 * 结果。只替换提供方声明的产物槽位。
 */
export async function submitReviewHostRelayPreparedResult(prepared: ReviewHostRelayPreparedResult, admit?: ReviewHostRelayAdmitResult): Promise<ReviewHostRelayResult> {
	const resultBytes = preparedResultBytes.get(prepared);
	if (resultBytes === undefined) throw new TypeError("Pi host relay requires a recognized prepared result");
	const { request } = prepared;
	assertTokens("capture", request.captureArgumentTokens);
	const submissionBinding = resolveReviewHostRelaySubmission(request.submission);
	// jero-pi M3：准入接缝是生产路径 —— 在同一个 0o600 暂存结果
	// 文件上做进程内捕获准入。没有接缝（且
	// 没有仅供 fixture 使用的可执行文件）时，中继精确地像
	// P1 桩那样保守失败。
	const useInProcessAdmission = admit !== undefined;
	if (!useInProcessAdmission && request.providerExecutable === undefined) {
		throw new ReviewHostRelayError(REVIEW_HOST_RELAY_FAILURE.RELAY_UNAVAILABLE, "submit", "authority-unavailable: no in-process admitResult seam was injected and no binary transport exists (jero-pi M3)");
	}
	const stagingDirectory = await mkdtemp(join(tmpdir(), "gentle-pi-host-relay-result-"));
	let primaryFailure = false;
	try {
		await chmod(stagingDirectory, 0o700);
		const resultFile = join(stagingDirectory, "result.raw");
		await writeFile(resultFile, resultBytes, { mode: 0o600 });
		await chmod(resultFile, 0o600);
		const submitTokens = submissionBinding.argumentTokens.map((token, index) =>
			index === submissionBinding.substitutionLocation
				? token.split(REVIEW_HOST_RELAY_SUBMISSION_VALUE_SLOT).join(resultFile)
				: token,
		);
		if (useInProcessAdmission) {
			let admitted: string;
			try {
				admitted = await admit!(request, submissionBinding.operationToken, submitTokens, resultFile);
			} catch (error) {
				if (error instanceof ReviewHostRelayError) throw error;
				// Mi7（评审）：下面的 [invalid_request] 启发式是 P4
				// admit-wrapper 契约，镜像上面的二进制纪律
				// （gentle-pi#522/#524：退出码 1 + `<reason> [invalid_request]` 是
				// 提供方的类型化预检拒绝，证明评审视角槽位未被
				// 消费）。把权威拒绝适配到
				// 该接缝上的 P4 包装器必须把权威的类型化拒绝联合以
				// message 携带 `[invalid_request]` 标记的 Error 暴露出来，这样
				// 中继才能将其归类为已证明的非变更（mutationOutcome
				// "none"）；其余所有失败保持 "unknown"，等待一次新的
				// 协商 STATUS。结构化的类型化拒绝通道（用类型化
				// 错误字段取代消息标记）被刻意留给
				// P4 —— 这个接缝只记录它必须满足的契约。
				const message = error instanceof Error ? error.message : String(error);
				throw new ReviewHostRelayError(
					REVIEW_HOST_RELAY_FAILURE.SUBMISSION_REFUSED,
					"submit",
					/\[invalid_request\]/.test(message) ? message : `in-process capture admission failed: ${message}`,
					{ mutationOutcome: /\[invalid_request\]/.test(message) ? "none" : "unknown" },
				);
			}
			if (admitted.length === 0) {
				throw new ReviewHostRelayError(REVIEW_HOST_RELAY_FAILURE.SUBMISSION_REFUSED, "submit", "in-process capture admission produced no bytes");
			}
			return {
				promptByteLength: prepared.promptByteLength,
				resultByteLength: prepared.resultByteLength,
				submission: admitted,
			};
		}
		let submission: ProcessCapture;
		try {
			submission = await collectProviderProcess(request.providerExecutable!, ["review", submissionBinding.operationToken, ...submitTokens], {
				cwd: request.targetCwd!,
				env: { ...request.environment! },
				timeoutMs: request.providerTimeoutMs!,
				...(request.signal === undefined ? {} : { signal: request.signal }),
			});
		} catch (error) {
			throw new ReviewHostRelayError(REVIEW_HOST_RELAY_FAILURE.SUBMISSION_REFUSED, "submit", `gentle-ai capture submission could not start: ${error instanceof Error ? error.message : String(error)}`);
		}
		if (submission.exitCode !== 0 || submission.timedOut || submission.stdout.length === 0) {
			const stderr = submission.stderr.toString("utf8");
			const details = { exitCode: submission.exitCode, stderr, timedOut: submission.timedOut, elapsedMs: submission.elapsedMs, timeoutMs: request.providerTimeoutMs! };
			// 类型化准入拒绝证明提供方没有消费任何槽位。
			// 其余已发起的 submission 保持 unknown，等待新的 STATUS。
			if (isReviewHostRelayAdmissionRefusal(submission, stderr)) {
				throw new ReviewHostRelayError(REVIEW_HOST_RELAY_FAILURE.SUBMISSION_REFUSED, "submit", stderr.trim(), {
					...details,
					mutationOutcome: "none",
				});
			}
			throw new ReviewHostRelayError(REVIEW_HOST_RELAY_FAILURE.SUBMISSION_REFUSED, "submit", submission.timedOut
				? `gentle-ai capture submission exceeded its ${request.providerTimeoutMs!}ms bound after ${submission.elapsedMs}ms`
				: "gentle-ai refused the relayed capture submission", details);
		}
		return {
			promptByteLength: prepared.promptByteLength,
			resultByteLength: prepared.resultByteLength,
			submission: submission.stdout.toString("utf8"),
		};
	} catch (error) {
		primaryFailure = true;
		throw error;
	} finally {
		try {
			await rm(stagingDirectory, { recursive: true, force: true });
		} catch (error) {
			if (!primaryFailure) {
				throw new ReviewHostRelayError(
					REVIEW_HOST_RELAY_FAILURE.SUBMISSION_REFUSED,
					"submit",
					`Pi host relay result staging cleanup failed: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		}
	}
}

/**
 * 兼容的单绑定路径：materialize → 不透明 Pi 适配器 → submit。
 * 它精确保留既有 API 及其类型化失败行为。
 */
export async function runReviewHostRelaySlot(request: ReviewHostRelayRequest): Promise<ReviewHostRelayResult> {
	return await submitReviewHostRelayPreparedResult(await prepareReviewHostRelaySlot(request));
}
