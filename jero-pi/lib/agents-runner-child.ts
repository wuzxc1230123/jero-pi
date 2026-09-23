// 子进程装配：childArguments、命令行切分、piCommand 探测与 JsonLines 帧编解码。
// 自 lib/agents-runner.ts 拆分（机械平移，语义零改动）。

import { formatModelRef } from "./agents-config.ts";
import {
	DEFAULT_TOOLS, PARENT_NOTIFICATION_TOOL, type PiCommand, type ProcessLike, SDD_CHANGE_FLAG,
	type TaskRequest
} from "./agents-runner-core.ts";
export function childArguments(request: TaskRequest): string[] {
	const args = ["--mode", "rpc", "--session-dir", request.sessionDir];
	for (const path of request.extensionPaths ?? []) args.push("--extension", path);
	if (request.sddChange) args.push(SDD_CHANGE_FLAG, JSON.stringify(request.sddChange));
	if (request.resumeSessionPath) args.push("--session", request.resumeSessionPath);
	if (request.model) args.push("--model", request.thinking ? `${formatModelRef(request.model)}:${request.thinking}` : formatModelRef(request.model));
	else if (request.thinking) args.push("--thinking", request.thinking);
	const tools = request.agent.tools.length > 0 ? [...new Set([...request.agent.tools, PARENT_NOTIFICATION_TOOL])] : DEFAULT_TOOLS;
	if (tools.length > 0) args.push("--tools", tools.join(","));
	if (request.agent.instructions.length > 0) args.push("--append-system-prompt", request.agent.instructions);
	return args;
}

// 子进程就是正在运行我们的那个 pi：node 加它的 cli 入口。
// JERO_PI_AGENTS_PI 用一条命令行覆盖它。带引号的片段
// （"..." / '...'）保持空格完整，因此位于 "C:\Program
// Files\..." 下的 Windows pi 仍是一个参数；引号除此之外不做 shell 处理。
function splitCommandLine(line: string): string[] {
	const parts: string[] = [];
	let current = "";
	let quote: '"' | "'" | undefined;
	for (const character of line) {
		if (quote !== undefined) {
			if (character === quote) quote = undefined;
			else current += character;
			continue;
		}
		if (character === '"' || character === "'") {
			quote = character;
			continue;
		}
		if (/\s/.test(character)) {
			if (current !== "") parts.push(current);
			current = "";
			continue;
		}
		current += character;
	}
	if (current !== "") parts.push(current);
	return parts;
}

export function piCommand(proc: ProcessLike = process): PiCommand {
	const override = proc.env.JERO_PI_AGENTS_PI?.trim();
	if (override) {
		const [command, ...args] = splitCommandLine(override);
		return { command, args };
	}
	const entry = proc.argv[1];
	if (entry && /(^|[\\/])cli\.js$/.test(entry)) return { command: proc.execPath, args: [entry] };
	return { command: "pi", args: [] };
}

// RPC 帧是严格的 JSONL：仅 LF，可选 CR。无法解析的行
// 被丢弃（pi 自身的解析错误反正会以响应形式到达）。
export class JsonLines {
	private buffer = "";
	private readonly onValue: (value: unknown) => void;

	constructor(onValue: (value: unknown) => void) {
		this.onValue = onValue;
	}

	push(chunk: string): void {
		this.buffer += chunk;
		const lines = this.buffer.split("\n");
		this.buffer = lines.pop() ?? "";
		// 子进程持续输出不含换行的字节流时，残留缓冲会无界增长；
		// 超过 1 MiB 即判定协议违规并截断，避免宿主内存被拖垮。
		if (this.buffer.length > 1024 * 1024) this.buffer = "";
		for (const raw of lines) {
			const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
			if (line.length === 0) continue;
			try {
				this.onValue(JSON.parse(line));
			} catch {
				// 非 JSON：忽略
			}
		}
	}
}

