import type { RemediationObservations, RemediationScope } from "./agents-runner.ts";
import type { NativeSddAcquireRequest, NativeSddSettleRequest, NativeSddAttemptResult } from "./authority/client-contract.ts";
import { sanitizeTerminalText } from "./terminal-theme.ts";

// Gentle Agents 协议。子 pi 进程流式输出 RPC 事件；宿主将每个事件变成
// 一个小型类型化增量，应用到只追加且有界的线程上，并只通知该任务的
// 监听者。这里不做重建转录、整体快照重校验或全局扇出。

export const TASK_STATUS = {
	QUEUED: "queued",
	RUNNING: "running",
	WAITING: "waiting",
	COMPLETED: "completed",
	FAILED: "failed",
	CANCELLED: "cancelled",
	TIMED_OUT: "timed_out",
} as const;

export type TaskStatus = (typeof TASK_STATUS)[keyof typeof TASK_STATUS];

export const FINISHED_STATUSES: readonly TaskStatus[] = [TASK_STATUS.COMPLETED, TASK_STATUS.FAILED, TASK_STATUS.CANCELLED, TASK_STATUS.TIMED_OUT];

export const TASK_EVENT = {
	TEXT: "text",
	THINKING: "thinking",
	TOOL_START: "tool_start",
	TOOL_UPDATE: "tool_update",
	TOOL_END: "tool_end",
	TURN_END: "turn_end",
	AGENT_END: "agent_end",
	AGENT_SETTLED: "agent_settled",
	ERROR: "error",
	ASK: "ask",
	NOTE: "note",
	USAGE: "usage",
	RESPONSE_OBSERVATION: "response_observation",
} as const;

export type TaskEventType = (typeof TASK_EVENT)[keyof typeof TASK_EVENT];

export const THREAD_ITEM = {
	TEXT: "text",
	THINKING: "thinking",
	TOOL: "tool",
	NOTE: "note",
} as const;

export type ThreadItemKind = (typeof THREAD_ITEM)[keyof typeof THREAD_ITEM];

export interface AskRequest {
	id: string;
	method: string;
	title: string;
}

export interface TextEvent { type: typeof TASK_EVENT.TEXT; text: string }
export interface ThinkingEvent { type: typeof TASK_EVENT.THINKING; text: string }
export interface ToolStartEvent { type: typeof TASK_EVENT.TOOL_START; callId: string; name: string; args: Record<string, unknown> }
export interface ToolUpdateEvent { type: typeof TASK_EVENT.TOOL_UPDATE; callId: string; output: string }
export interface ToolEndEvent { type: typeof TASK_EVENT.TOOL_END; callId: string; output: string; isError: boolean }
export interface TurnEndEvent { type: typeof TASK_EVENT.TURN_END }
export interface AgentEndEvent {
	type: typeof TASK_EVENT.AGENT_END;
	text: string;
	outcome: "success" | "error" | "aborted" | "empty";
	diagnostic?: string;
}
export interface AgentSettledEvent { type: typeof TASK_EVENT.AGENT_SETTLED }
export interface ErrorEvent { type: typeof TASK_EVENT.ERROR; message: string }
export interface AskEvent { type: typeof TASK_EVENT.ASK; request: AskRequest }
export interface NoteEvent { type: typeof TASK_EVENT.NOTE; text: string }
export interface UsageEvent { type: typeof TASK_EVENT.USAGE; tokens: number; cost: number }

export type ChildUnavailable = Readonly<{ state: "unavailable" }>;
export type ChildMetadata = Readonly<{ state: "observed"; value: string }> | ChildUnavailable;
export type ChildTokenMeasurement = Readonly<{ state: "reported"; value: number }> | ChildUnavailable;
export interface ChildResponseObservation {
	/** SDK 消息元数据，不是经过认证的路由或已选模型证据。 */
	readonly provider: ChildMetadata;
	readonly model: ChildMetadata;
	readonly responseModel: ChildMetadata;
	/** 提供方原生返回的精确 effort（若提供），而非 Pi 选择的 effort。 */
	readonly providerThinkingLevel: ChildMetadata;
	readonly selected: Readonly<{ provider: ChildUnavailable; model: ChildUnavailable; effort: ChildUnavailable }>;
	readonly stopReason: "stop" | "length" | "toolUse" | "error" | "aborted";
	/** 推理是输出的一部分，不是额外的 token 总量。 */
	readonly tokens: Readonly<Record<"input" | "output" | "cacheRead" | "cacheWrite" | "totalTokens" | "reasoning", ChildTokenMeasurement>>;
}
export interface ResponseObservationEvent { type: typeof TASK_EVENT.RESPONSE_OBSERVATION; observation: ChildResponseObservation }

export type TaskEvent = ResponseObservationEvent | TextEvent | ThinkingEvent | ToolStartEvent | ToolUpdateEvent | ToolEndEvent | TurnEndEvent | AgentEndEvent | AgentSettledEvent | ErrorEvent | AskEvent | NoteEvent | UsageEvent;

export interface TextItem { kind: typeof THREAD_ITEM.TEXT; text: string }
export interface ThinkingItem { kind: typeof THREAD_ITEM.THINKING; text: string }
export interface ToolItem { kind: typeof THREAD_ITEM.TOOL; callId: string; name: string; args: Record<string, unknown>; output: string; running: boolean; isError: boolean }
export interface NoteItem { kind: typeof THREAD_ITEM.NOTE; text: string }

export type ThreadItem = TextItem | ThinkingItem | ToolItem | NoteItem;

export interface ThreadLimits {
	maxItems: number;
	maxOutputChars: number;
}

export interface TaskThread {
	items: ThreadItem[];
	dropped: number;
	version: number;
	limits: ThreadLimits;
}

export interface RemediationTaskState extends RemediationObservations {
	scope?: RemediationScope;
	acquire: NativeSddAcquireRequest;
	token?: string;
	acquireResult?: NativeSddAttemptResult;
	acquireUncertain?: boolean;
	actorClaimed?: boolean;
	settle?: NativeSddSettleRequest;
	settlement?: NativeSddAttemptResult;
	settlementUncertain?: boolean;
}

export interface TaskRecord {
	sddRemediation?: RemediationTaskState;
	/** 运行时精确生成的 SDD 预检块，仅为续跑传输而保留。 */
	sddPreflightContext?: string;
	id: string;
	agent: string;
	mode: string;
	prompt: string;
	/** 卡片上的一行文字：子代理正在做什么。 */
	label: string;
	cwd: string;
	parentSessionId: string;
	status: TaskStatus;
	createdAt: number;
	startedAt: number | null;
	endedAt: number | null;
	model: string;
	thinking: string | undefined;
	sessionPath: string | null;
	error: string | null;
	result: string | null;
	lastStep: string;
	lastActivityAt: number;
	turns: number;
	toolCalls: number;
	tokens: number;
	cost: number;
}

export interface TaskSummary {
	running: number;
	queued: number;
	waiting: number;
	finished: number;
}

export type TaskListener = (task: TaskRecord, thread: TaskThread) => void;
export type SummaryListener = (summary: TaskSummary) => void;

const DEFAULT_LIMITS: ThreadLimits = { maxItems: 400, maxOutputChars: 16_000 };
/** 会阻塞等待回答的子进程 UI 请求；其余一切（notify、setStatus、setWidget）在此均视为噪音。 */
export const DIALOG_METHODS: ReadonlySet<string> = new Set(["select", "confirm", "input", "editor"]);
const LABEL_MAX = 72;
const TEXT_CAP = 20_000;
const ELLIPSIS = "…";

function clean(value: unknown): string {
	return typeof value === "string" ? sanitizeTerminalText(value) : "";
}

function contentText(content: unknown): string {
	if (!Array.isArray(content)) return "";
	return content
		.map((part) => (part && typeof part === "object" && (part as { type?: string }).type === "text" ? clean((part as { text?: unknown }).text) : ""))
		.filter((text) => text.length > 0)
		.join("\n");
}

function keepTail(text: string, max: number): string {
	return text.length <= max ? text : `${ELLIPSIS}${text.slice(text.length - max + 1)}`;
}

function terminalAssistant(messages: unknown): Omit<AgentEndEvent, "type"> {
	if (!Array.isArray(messages)) return { text: "", outcome: "empty", diagnostic: "assistant returned no final report" };
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index] as { role?: string; content?: unknown; stopReason?: unknown };
		if (message?.role !== "assistant") continue;
		const stopReason = clean(message.stopReason).toLowerCase();
		// 不保留无界的提供方错误载荷。终局原因已足以让操作员区分失败与
		// 空报告。
		if (stopReason === "error") return { text: "", outcome: "error", diagnostic: "assistant reported an error" };
		if (stopReason === "aborted") return { text: "", outcome: "aborted", diagnostic: "assistant aborted" };
		const text = contentText(message.content);
		return text.length > 0
			? { text, outcome: "success" }
			: { text: "", outcome: "empty", diagnostic: "assistant returned no final report" };
	}
	return { text: "", outcome: "empty", diagnostic: "assistant returned no final report" };
}

type Raw = Record<string, unknown>;

function askRequest(raw: Raw): AskRequest {
	const title = clean(raw.title) || clean(raw.message) || clean(raw.method);
	return { id: String(raw.id ?? ""), method: String(raw.method ?? ""), title };
}

const CHILD_UNAVAILABLE: ChildUnavailable = Object.freeze({ state: "unavailable" });
const CHILD_SELECTION = Object.freeze({ provider: CHILD_UNAVAILABLE, model: CHILD_UNAVAILABLE, effort: CHILD_UNAVAILABLE });

function childMetadata(value: unknown, max: number): ChildMetadata {
	// 只保留有界的标识符字段；绝不截断成另一个身份。
	return typeof value === "string" && value.length <= max && /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(value)
		? Object.freeze({ state: "observed", value }) : CHILD_UNAVAILABLE;
}

function childTokens(value: unknown): ChildTokenMeasurement {
	// SDK 默认的零值不是提供方在场的证据（与主适配器一致）。
	return typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= 1_000_000_000
		? Object.freeze({ state: "reported", value }) : CHILD_UNAVAILABLE;
}

function childResponse(message: Raw): ChildResponseObservation | undefined {
	const reason = message.stopReason;
	if (reason !== "stop" && reason !== "length" && reason !== "toolUse" && reason !== "error" && reason !== "aborted") return undefined;
	const usage = message.usage as Raw | undefined;
	return Object.freeze({
		provider: childMetadata(message.provider, 32), model: childMetadata(message.model, 128),
		responseModel: childMetadata(message.responseModel, 128), providerThinkingLevel: childMetadata(message.providerThinkingLevel, 32),
		// RPC 没有按请求维度的已选状态；get_state 只观察启动时点。
		selected: CHILD_SELECTION, stopReason: reason,
		tokens: Object.freeze({ input: childTokens(usage?.input), output: childTokens(usage?.output),
			cacheRead: childTokens(usage?.cacheRead), cacheWrite: childTokens(usage?.cacheWrite),
			totalTokens: childTokens(usage?.totalTokens), reasoning: childTokens(usage?.reasoning) }),
	});
}

// 一行 RPC 输入，零个或多个增量输出。流式增量只携带分块；
// pi 每次更新都重复的整体消息载荷会被忽略。
export function normalizeRpcEvent(raw: unknown, options: { observeResponses?: boolean } = {}): TaskEvent[] {
	if (!raw || typeof raw !== "object") return [];
	const event = raw as Raw;
	switch (event.type) {
		case "message_update": {
			const inner = event.assistantMessageEvent as Raw | undefined;
			if (!inner) return [];
			if (inner.type === "text_delta") return [{ type: TASK_EVENT.TEXT, text: clean(inner.delta) }];
			if (inner.type === "thinking_delta") return [{ type: TASK_EVENT.THINKING, text: clean(inner.delta) }];
			if (inner.type === "error") {
				const error = inner.error as Raw | undefined;
				return [{ type: TASK_EVENT.ERROR, message: clean(error?.message) || clean(inner.reason) || "unknown error" }];
			}
			return [];
		}
		case "tool_execution_start":
			return [{ type: TASK_EVENT.TOOL_START, callId: String(event.toolCallId ?? ""), name: clean(event.toolName), args: (event.args as Record<string, unknown>) ?? {} }];
		case "tool_execution_update":
			return [{ type: TASK_EVENT.TOOL_UPDATE, callId: String(event.toolCallId ?? ""), output: contentText((event.partialResult as Raw | undefined)?.content) }];
		case "tool_execution_end":
			return [{ type: TASK_EVENT.TOOL_END, callId: String(event.toolCallId ?? ""), output: contentText((event.result as Raw | undefined)?.content), isError: event.isError === true }];
		case "message_end": {
			const message = event.message as Raw | undefined;
			const usage = message?.role === "assistant" ? (message.usage as Raw | undefined) : undefined;
			const events: TaskEvent[] = [];
			if (usage) {
				const cost = usage.cost as Raw | undefined;
				events.push({ type: TASK_EVENT.USAGE, tokens: Number(usage.totalTokens ?? 0) || 0, cost: Number(cost?.total ?? 0) || 0 });
			}
			if (options.observeResponses === true && message?.role === "assistant") {
				const observation = childResponse(message);
				if (observation) events.push({ type: TASK_EVENT.RESPONSE_OBSERVATION, observation });
			}
			return events;
		}
		case "turn_end":
			return [{ type: TASK_EVENT.TURN_END }];
		case "agent_end":
			return [{ type: TASK_EVENT.AGENT_END, ...terminalAssistant(event.messages) }];
		case "agent_settled":
			return [{ type: TASK_EVENT.AGENT_SETTLED }];
		case "extension_ui_request":
			return DIALOG_METHODS.has(String(event.method)) ? [{ type: TASK_EVENT.ASK, request: askRequest(event) }] : [];
		case "auto_retry_start":
			return [{ type: TASK_EVENT.NOTE, text: `retrying (${String(event.attempt ?? "?")}/${String(event.maxAttempts ?? "?")})` }];
		case "extension_error":
			return [{ type: TASK_EVENT.NOTE, text: `extension error: ${clean(event.error)}` }];
		default:
			return [];
	}
}

// 卡片每个任务只显示一行：显式标签，或截取到可读长度的提示词首句。
export function taskLabel(prompt: string, label?: string): string {
	const explicit = clean(label).replace(/\s+/g, " ").trim();
	if (explicit.length > 0) return explicit.length > LABEL_MAX ? `${explicit.slice(0, LABEL_MAX - 1)}…` : explicit;
	const firstLine = clean(prompt).split("\n").map((line) => line.trim()).find((line) => line.length > 0) ?? "";
	const sentence = firstLine.split(/(?<=[.!?])\s/)[0] ?? firstLine;
	const compact = sentence.replace(/\s+/g, " ").replace(/[.:]$/, "");
	return compact.length > LABEL_MAX ? `${compact.slice(0, LABEL_MAX - 1)}…` : compact;
}

export function emptyThread(limits: Partial<ThreadLimits> = {}): TaskThread {
	return { items: [], dropped: 0, version: 0, limits: { ...DEFAULT_LIMITS, ...limits } };
}

function withItems(thread: TaskThread, items: ThreadItem[], dropped = thread.dropped): TaskThread {
	return { ...thread, items, dropped, version: thread.version + 1 };
}

function push(thread: TaskThread, item: ThreadItem): TaskThread {
	const items = [...thread.items, item];
	const overflow = Math.max(0, items.length - thread.limits.maxItems);
	return withItems(thread, overflow > 0 ? items.slice(overflow) : items, thread.dropped + overflow);
}

function appendText(thread: TaskThread, kind: typeof THREAD_ITEM.TEXT | typeof THREAD_ITEM.THINKING, raw: string): TaskThread {
	const text = clean(raw);
	if (text.length === 0) return thread;
	const last = thread.items[thread.items.length - 1];
	if (last && last.kind === kind) {
		const merged = { ...last, text: keepTail(last.text + text, TEXT_CAP) };
		return withItems(thread, [...thread.items.slice(0, -1), merged]);
	}
	return push(thread, { kind, text } as ThreadItem);
}

function updateTool(thread: TaskThread, callId: string, patch: Partial<ToolItem>): TaskThread {
	const index = thread.items.findIndex((item) => item.kind === THREAD_ITEM.TOOL && item.callId === callId);
	if (index < 0) return thread;
	const current = thread.items[index] as ToolItem;
	const next: ToolItem = { ...current, ...patch, output: keepTail(patch.output === undefined ? current.output : clean(patch.output), thread.limits.maxOutputChars) };
	const items = [...thread.items];
	items[index] = next;
	return withItems(thread, items);
}

export function askNote(request: AskRequest): string {
	return `asked: ${request.title}`;
}

export function applyTaskEvent(thread: TaskThread, event: TaskEvent): TaskThread {
	switch (event.type) {
		case TASK_EVENT.TEXT:
			return appendText(thread, THREAD_ITEM.TEXT, event.text);
		case TASK_EVENT.THINKING:
			return appendText(thread, THREAD_ITEM.THINKING, event.text);
		case TASK_EVENT.TOOL_START:
			return push(thread, { kind: THREAD_ITEM.TOOL, callId: event.callId, name: event.name, args: event.args, output: "", running: true, isError: false });
		case TASK_EVENT.TOOL_UPDATE:
			return updateTool(thread, event.callId, { output: event.output });
		case TASK_EVENT.TOOL_END:
			return updateTool(thread, event.callId, { output: event.output, running: false, isError: event.isError });
		case TASK_EVENT.ERROR:
			return push(thread, { kind: THREAD_ITEM.NOTE, text: `error: ${event.message}` });
		case TASK_EVENT.ASK:
			return push(thread, { kind: THREAD_ITEM.NOTE, text: askNote(event.request) });
		case TASK_EVENT.NOTE:
			return push(thread, { kind: THREAD_ITEM.NOTE, text: clean(event.text) });
		default:
			return thread;
	}
}

export function isFinished(status: TaskStatus): boolean {
	return FINISHED_STATUSES.includes(status);
}

// 任务事件对记录本身的意义：挂件显示的步骤标签、各计数器，
// 以及围绕用户提问的等待/运行状态翻转。
function recordPatch(task: TaskRecord, event: TaskEvent): Partial<TaskRecord> {
	const resumed = task.status === TASK_STATUS.WAITING && event.type !== TASK_EVENT.ASK ? { status: TASK_STATUS.RUNNING } : {};
	switch (event.type) {
		case TASK_EVENT.TOOL_START:
			return { ...resumed, lastStep: event.name, toolCalls: task.toolCalls + 1 };
		case TASK_EVENT.TURN_END:
			return { ...resumed, turns: task.turns + 1 };
		case TASK_EVENT.AGENT_END:
			return event.outcome === "success"
				? { ...resumed, result: event.text, error: null, lastStep: "responded" }
				: { ...resumed, result: null, error: event.diagnostic ?? "assistant did not produce a final report", lastStep: event.diagnostic ?? "assistant failed" };
		case TASK_EVENT.ERROR:
			return { ...resumed, lastStep: `error: ${event.message}` };
		case TASK_EVENT.ASK:
			return { status: TASK_STATUS.WAITING, lastStep: askNote(event.request) };
		case TASK_EVENT.TEXT:
			return { ...resumed, lastStep: task.lastStep === "queued" || task.lastStep === "starting" ? "writing" : task.lastStep };
		case TASK_EVENT.USAGE:
			return { ...resumed, tokens: task.tokens + event.tokens, cost: task.cost + event.cost };
		default:
			return resumed;
	}
}

export function summarize(tasks: Iterable<TaskRecord>): TaskSummary {
	const summary: TaskSummary = { running: 0, queued: 0, waiting: 0, finished: 0 };
	for (const task of tasks) {
		if (task.status === TASK_STATUS.RUNNING) summary.running += 1;
		else if (task.status === TASK_STATUS.QUEUED) summary.queued += 1;
		else if (task.status === TASK_STATUS.WAITING) summary.waiting += 1;
		else summary.finished += 1;
	}
	return summary;
}

export class TaskStore {
	private readonly tasks = new Map<string, TaskRecord>();
	private readonly threads = new Map<string, TaskThread>();
	private readonly listeners = new Map<string, Set<TaskListener>>();
	private readonly summaryListeners = new Set<SummaryListener>();
	private readonly limits: Partial<ThreadLimits>;

	constructor(limits: Partial<ThreadLimits> = {}) {
		this.limits = limits;
	}

	add(task: TaskRecord): void {
		this.tasks.set(task.id, task);
		this.threads.set(task.id, emptyThread(this.limits));
		this.notifySummary();
	}

	// 连同线程一起把任务从磁盘恢复；活动任务绝不被存储副本覆盖。
	restore(task: TaskRecord, thread: TaskThread): boolean {
		if (this.tasks.has(task.id)) return false;
		this.tasks.set(task.id, task);
		this.threads.set(task.id, { ...thread, limits: { ...DEFAULT_LIMITS, ...this.limits } });
		this.notifySummary();
		return true;
	}

	get(id: string): TaskRecord | undefined {
		return this.tasks.get(id);
	}

	thread(id: string): TaskThread {
		return this.threads.get(id) ?? emptyThread(this.limits);
	}

	list(parentSessionId?: string): TaskRecord[] {
		return [...this.tasks.values()]
			.filter((task) => parentSessionId === undefined || task.parentSessionId === parentSessionId)
			.sort((a, b) => b.lastActivityAt - a.lastActivityAt || b.createdAt - a.createdAt);
	}

	summary(parentSessionId?: string): TaskSummary {
		return summarize(this.list(parentSessionId));
	}

	// 状态变化是摘要唯一关心的内容；任务内部发生的一切
	// 都只归该任务的监听者。
	update(id: string, patch: Partial<TaskRecord>): TaskRecord | undefined {
		const current = this.tasks.get(id);
		if (!current) return undefined;
		const next = { ...current, ...patch };
		this.tasks.set(id, next);
		this.notifyTask(next);
		if (next.status !== current.status) this.notifySummary();
		return next;
	}

	apply(id: string, event: TaskEvent, at: number): TaskRecord | undefined {
		const current = this.tasks.get(id);
		if (!current) return undefined;
		this.threads.set(id, applyTaskEvent(this.thread(id), event));
		return this.update(id, { ...recordPatch(current, event), lastActivityAt: at });
	}

	subscribe(id: string, listener: TaskListener): () => void {
		const set = this.listeners.get(id) ?? new Set<TaskListener>();
		set.add(listener);
		this.listeners.set(id, set);
		return () => {
			set.delete(listener);
			if (set.size === 0) this.listeners.delete(id);
		};
	}

	subscribeSummary(listener: SummaryListener): () => void {
		this.summaryListeners.add(listener);
		return () => this.summaryListeners.delete(listener);
	}

	private notifyTask(task: TaskRecord): void {
		const set = this.listeners.get(task.id);
		if (!set) return;
		const thread = this.thread(task.id);
		for (const listener of set) listener(task, thread);
	}

	private notifySummary(): void {
		if (this.summaryListeners.size === 0) return;
		const summary = this.summary();
		for (const listener of this.summaryListeners) listener(summary);
	}
}
