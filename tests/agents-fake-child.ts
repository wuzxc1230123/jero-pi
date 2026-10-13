import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ChildLike } from "../lib/agents-runner.ts";

// 假的 `pi --mode rpc` 子进程：对所有命令一律返回成功响应，记录宿主
// 写入的内容，并允许测试注入事件。

export interface FakeChildOptions {
	exitOnKill?: boolean;
	pid?: number;
	/** get_state 回报的会话文件路径——真实子进程总是回报启动时 --session-dir 目录内的路径（runner 有圈定校验），测试按需注入同目录形态。 */
	sessionFile?: string;
}

export interface FakeChild {
	child: ChildLike;
	written: Array<Record<string, unknown>>;
	emit(event: Record<string, unknown>): void;
	exit(code: number): void;
	fail(message: string): void;
	killed: string[];
	sent: Array<Record<string, unknown>>;
	disconnects: number;
	message(event: Record<string, unknown>): void;
}

export function fakeChild(options: FakeChildOptions = {}): FakeChild {
	const emitter = new EventEmitter();
	const stdin = new PassThrough();
	const stdout = new PassThrough();
	const written: Array<Record<string, unknown>> = [];
	const killed: string[] = [];
	const sent: Array<Record<string, unknown>> = [];
	let disconnects = 0;
	let buffer = "";
	stdin.on("data", (chunk: Buffer) => {
		buffer += chunk.toString();
		const lines = buffer.split("\n");
		buffer = lines.pop() ?? "";
		for (const line of lines) {
			const command = JSON.parse(line) as Record<string, unknown>;
			written.push(command);
			if (command.type === "extension_ui_response") continue;
			const data = command.type === "get_state" ? { sessionFile: options.sessionFile ?? "/sessions/child.jsonl" } : undefined;
			stdout.write(`${JSON.stringify({ type: "response", id: command.id, command: command.type, success: true, data })}\n`);
		}
	});
	const child: ChildLike = {
		pid: options.pid,
		stdin,
		stdout,
		stderr: new PassThrough(),
		kill: (signal) => {
			killed.push(String(signal ?? "SIGTERM"));
			if (options.exitOnKill !== false) queueMicrotask(() => emitter.emit("exit", 0, signal ?? "SIGTERM"));
			return true;
		},
		send: (message, callback) => {
			sent.push(message);
			callback?.(null);
			return true;
		},
		disconnect: () => {
			disconnects += 1;
			emitter.emit("disconnect");
		},
		on: (event, listener) => {
			emitter.on(event, listener);
			return child;
		},
	};
	return { child, written, killed, sent, get disconnects() { return disconnects; }, message: (event) => emitter.emit("message", event), emit: (event) => stdout.write(`${JSON.stringify(event)}\n`), exit: (code) => emitter.emit("exit", code, null), fail: (message) => emitter.emit("error", new Error(message)) };
}
