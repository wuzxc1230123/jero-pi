import { spawn } from "node:child_process";
import { closeSync, openSync, readSync } from "node:fs";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, posix, win32 } from "node:path";

export const OPAQUE_PI_REVIEWER_ARGV = Object.freeze([
	"--print",
	"--mode", "text",
	"--no-session",
	"--no-tools",
	"--no-extensions",
	"--no-skills",
	"--no-prompt-templates",
	"--no-themes",
	"--no-context-files",
	"--no-approve",
] as const);

export const OPAQUE_PI_REVIEWER_TRANSPORT_FAILURE = {
	SCRATCH_FAILED: "scratch-failed",
	LAUNCH_FAILED: "launch-failed",
	CANCELLED: "cancelled",
	TIMED_OUT: "timed-out",
	NONZERO_EXIT: "nonzero-exit",
	EMPTY_OUTPUT: "empty-output",
	CLEANUP_FAILED: "cleanup-failed",
} as const;
export type OpaquePiReviewerTransportFailureKind = (typeof OPAQUE_PI_REVIEWER_TRANSPORT_FAILURE)[keyof typeof OPAQUE_PI_REVIEWER_TRANSPORT_FAILURE];

export interface OpaquePiReviewerOptions {
	readonly piExecutable?: string;
	readonly environment?: NodeJS.ProcessEnv;
	readonly timeoutMs?: number;
	readonly signal?: AbortSignal;
}

export interface OpaquePiReviewerResult {
	readonly stdout: Buffer;
	readonly promptByteLength: number;
	readonly stdoutByteLength: number;
}

export interface OpaquePiReviewerTransportDetails {
	readonly exitCode?: number | null;
	readonly stderr?: Buffer;
	readonly timedOut?: boolean;
	readonly cancelled?: boolean;
	/** 已启动 Pi 进程的墙钟时间；未启动进程时省略。 */
	readonly elapsedMs?: number;
	/** 应用于已启动 Pi 进程的超时上限；未启动进程时省略。 */
	readonly timeoutMs?: number;
}

export class OpaquePiReviewerTransportError extends Error {
	readonly kind: OpaquePiReviewerTransportFailureKind;
	readonly exitCode: number | null;
	readonly stderr: Buffer;
	readonly timedOut: boolean;
	readonly cancelled: boolean;
	readonly elapsedMs: number | null;
	readonly timeoutMs: number | null;

	constructor(kind: OpaquePiReviewerTransportFailureKind, message: string, details: OpaquePiReviewerTransportDetails = {}) {
		super(message);
		this.name = "OpaquePiReviewerTransportError";
		this.kind = kind;
		this.exitCode = details.exitCode ?? null;
		this.stderr = details.stderr ?? Buffer.alloc(0);
		this.timedOut = details.timedOut ?? false;
		this.cancelled = details.cancelled ?? false;
		this.elapsedMs = details.elapsedMs ?? null;
		this.timeoutMs = details.timeoutMs ?? null;
	}
}

interface OpaquePiProcessResult {
	readonly stdout: Buffer;
	readonly stderr: Buffer;
	readonly exitCode: number | null;
	readonly timedOut: boolean;
	readonly cancelled: boolean;
	readonly elapsedMs: number;
	readonly timeoutMs: number;
}

const DEFAULT_OPAQUE_PI_TIMEOUT_MS = 600_000;

export interface PiLaunch {
	readonly file: string;
	readonly arguments: readonly string[];
}

interface PiHostProcess {
	readonly execPath: string;
	readonly entry: string | undefined;
}

/**
 * 全新 Pi 进程的确切 spawn 形态。Windows 上裸 `pi` 会解析成 pi.cmd、
 * pi.ps1 或 POSIX 垫片，Node 都无法以 shell:false 启动它们（EINVAL 或
 * ENOENT）。本适配器本身已运行在 Pi 内，因此在 win32 上改为通过宿主自身
 * 的 process.execPath 启动宿主自己的 JavaScript 入口；shell 永不启用。
 * 其他平台以及所有显式启动器都保持原有的确切形态。
 */
export function resolvePiLaunch(
	piExecutable: string | undefined,
	platform: NodeJS.Platform = process.platform,
	host: PiHostProcess = { execPath: process.execPath, entry: process.argv[1] },
): PiLaunch {
	if (piExecutable !== undefined) {
		// 带 shebang 的 Node 脚本在 Windows 上无法以无扩展名方式启动
		// （CreateProcess 只解析 *.exe）；让它经由当前 Node 可执行文件
		// 运行，POSIX 风格的垫片才能在所有平台继续工作。
		if (process.platform === "win32" && !/\.(exe|cmd|bat)$/i.test(piExecutable)) {
			try {
				const fd = openSync(piExecutable, "r");
				try {
					const header = Buffer.alloc(64);
					const bytes = readSync(fd, header, 0, 64, 0);
					if (bytes > 2 && header[0] === 0x23 && header[1] === 0x21) return { file: process.execPath, arguments: [piExecutable, ...OPAQUE_PI_REVIEWER_ARGV] };
				} finally { closeSync(fd); }
			} catch { /* 不可读：向下穿透到直接 spawn，
				后者会自行给出类型化的启动失败 */ }
		}
		return { file: piExecutable, arguments: [...OPAQUE_PI_REVIEWER_ARGV] };
	}
	if (platform !== "win32") return { file: "pi", arguments: [...OPAQUE_PI_REVIEWER_ARGV] };
	if (typeof host.entry !== "string" || host.entry.length === 0 || !(platform === "win32" ? win32 : posix).isAbsolute(host.entry)) {
		throw new Error(`Pi host entry could not be resolved from the running process (received ${JSON.stringify(host.entry ?? null)}); a bare pi launcher cannot be spawned on Windows without a shell`);
	}
	return { file: host.execPath, arguments: [host.entry, ...OPAQUE_PI_REVIEWER_ARGV] };
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function runPiProcess(prompt: Buffer, scratchDirectory: string, options: OpaquePiReviewerOptions): Promise<OpaquePiProcessResult> {
	return new Promise((resolve, reject) => {
		const startedAt = Date.now();
		let launch: PiLaunch;
		try {
			launch = resolvePiLaunch(options.piExecutable);
		} catch (error) {
			reject(error);
			return;
		}
		const child = spawn(launch.file, [...launch.arguments], {
			cwd: scratchDirectory,
			env: options.environment ?? process.env,
			stdio: ["pipe", "pipe", "pipe"],
			shell: false,
			windowsHide: true,
		});
		const stdout: Buffer[] = [];
		const stderr: Buffer[] = [];
		const timeoutMs = options.timeoutMs ?? DEFAULT_OPAQUE_PI_TIMEOUT_MS;
		let timedOut = false;
		let cancelled = false;
		let settled = false;
		const timer = timeoutMs > 0
			? setTimeout(() => {
				timedOut = true;
				child.kill("SIGKILL");
			}, timeoutMs)
			: undefined;
		timer?.unref();
		const cancel = () => {
			cancelled = true;
			child.kill("SIGKILL");
		};
		const clear = () => {
			if (timer !== undefined) clearTimeout(timer);
			options.signal?.removeEventListener("abort", cancel);
		};

		child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
		child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
		child.on("error", (error) => {
			if (settled) return;
			settled = true;
			clear();
			reject(error);
		});
		child.on("close", (code) => {
			if (settled) return;
			settled = true;
			clear();
			resolve({
				stdout: Buffer.concat(stdout),
				stderr: Buffer.concat(stderr),
				exitCode: code,
				timedOut,
				cancelled,
				elapsedMs: Date.now() - startedAt,
				timeoutMs,
			});
		});
		if (options.signal?.aborted) cancel();
		else options.signal?.addEventListener("abort", cancel, { once: true });
		child.stdin.on("error", () => undefined);
		child.stdin.end(prompt);
	});
}

/** 将原始提示词字节送入一个固定且隔离的 Pi 进程运行。 */
export async function runOpaquePiReviewer(prompt: Buffer, options: OpaquePiReviewerOptions = {}): Promise<OpaquePiReviewerResult> {
	if (options.signal?.aborted) {
		throw new OpaquePiReviewerTransportError(
			OPAQUE_PI_REVIEWER_TRANSPORT_FAILURE.CANCELLED,
			"Pi process was cancelled before launch",
			{ cancelled: true },
		);
	}

	let scratchDirectory: string | undefined;
	let primaryFailure = false;
	try {
		try {
			scratchDirectory = await mkdtemp(join(tmpdir(), "gentle-pi-opaque-reviewer-"));
			await chmod(scratchDirectory, 0o700);
		} catch (error) {
			throw new OpaquePiReviewerTransportError(
				OPAQUE_PI_REVIEWER_TRANSPORT_FAILURE.SCRATCH_FAILED,
				`Pi scratch directory could not be prepared: ${errorMessage(error)}`,
			);
		}

		let processResult: OpaquePiProcessResult;
		try {
			processResult = await runPiProcess(prompt, scratchDirectory, options);
		} catch (error) {
			if (options.signal?.aborted) {
				throw new OpaquePiReviewerTransportError(
					OPAQUE_PI_REVIEWER_TRANSPORT_FAILURE.CANCELLED,
					"Pi process was cancelled",
					{ cancelled: true },
				);
			}
			throw new OpaquePiReviewerTransportError(
				OPAQUE_PI_REVIEWER_TRANSPORT_FAILURE.LAUNCH_FAILED,
				`Pi process could not start: ${errorMessage(error)}`,
			);
		}
		const timing = {
			elapsedMs: processResult.elapsedMs,
			timeoutMs: processResult.timeoutMs,
		};
		if (processResult.timedOut) {
			throw new OpaquePiReviewerTransportError(
				OPAQUE_PI_REVIEWER_TRANSPORT_FAILURE.TIMED_OUT,
				"Pi process timed out",
				{ exitCode: processResult.exitCode, stderr: processResult.stderr, timedOut: true, ...timing },
			);
		}
		if (processResult.cancelled) {
			throw new OpaquePiReviewerTransportError(
				OPAQUE_PI_REVIEWER_TRANSPORT_FAILURE.CANCELLED,
				"Pi process was cancelled",
				{ exitCode: processResult.exitCode, stderr: processResult.stderr, cancelled: true, ...timing },
			);
		}
		if (processResult.exitCode !== 0) {
			throw new OpaquePiReviewerTransportError(
				OPAQUE_PI_REVIEWER_TRANSPORT_FAILURE.NONZERO_EXIT,
				"Pi process failed",
				{ exitCode: processResult.exitCode, stderr: processResult.stderr, ...timing },
			);
		}
		if (processResult.stdout.length === 0) {
			throw new OpaquePiReviewerTransportError(
				OPAQUE_PI_REVIEWER_TRANSPORT_FAILURE.EMPTY_OUTPUT,
				"Pi process produced no output bytes",
				{ exitCode: 0, stderr: processResult.stderr, ...timing },
			);
		}
		return {
			stdout: processResult.stdout,
			promptByteLength: prompt.length,
			stdoutByteLength: processResult.stdout.length,
		};
	} catch (error) {
		primaryFailure = true;
		throw error;
	} finally {
		if (scratchDirectory !== undefined) {
			try {
				await rm(scratchDirectory, { recursive: true, force: true });
			} catch (error) {
				if (!primaryFailure) {
					throw new OpaquePiReviewerTransportError(
						OPAQUE_PI_REVIEWER_TRANSPORT_FAILURE.CLEANUP_FAILED,
						`Pi scratch directory cleanup failed: ${errorMessage(error)}`,
					);
				}
			}
		}
	}
}
