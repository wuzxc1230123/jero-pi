// pi 会话生命周期事件的 reason 读取助手：pi 在 /new、/resume、/fork、
// /reload 与退出时都会发出 session_shutdown（复用扩展实例、不重跑
// setup），reason 字段是区分"会话替换"与"真退出"的唯一信号——
// 各扩展的清场逻辑必须经同一形态读取，禁止散落 `as { reason? }` 强转。
export type SessionEventReason = "reload" | "new" | "resume" | "fork" | "quit" | undefined;

export function sessionEventReason(event: unknown): SessionEventReason {
	const reason = (event as { reason?: unknown } | undefined | null)?.reason;
	return reason === "reload" || reason === "new" || reason === "resume" || reason === "fork" || reason === "quit"
		? reason
		: undefined;
}
