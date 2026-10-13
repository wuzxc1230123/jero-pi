// 通用类型谓词：unknown → Record<string, unknown>。
// 注意：lib/review-session-standing-permission-ipc.ts 另有一份不排除
// 数组的变体（语义不同，未统一）——那是刻意的宽松解码还是缺陷需要
// 领域判断，统一前不得改动。
export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
