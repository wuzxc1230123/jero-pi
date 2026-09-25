// Jero Agents 完成投递队列（issue #867）。
//
// 后台子代理的完成结果过去会以 `deliverAs: "followUp"` 消息直接交给宿主，
// 但宿主只在父代理完全停止调用工具时才清空该队列。在长时间的编排器运行中，
// 通知可能在父代理早已通过 subagent_result 拉取同一结果之后数十分钟才
// 到达。本模块改为自行持有待处理的完成项：扩展在任务落定时入队，在清空时
// 判定新鲜度，并丢弃父代理已消费的内容。它无依赖且与时钟无关：所有时间戳
// 都由外部传入，因此行为可以针对假时钟做单元测试。

/**
 * 清空时早于该时长的完成项即为过期：父代理已有多个回合可以用
 * subagent_result 拉取结果，重放进模型上下文会重新进入会话可能早已
 * 使用过的状态。九十秒足以从容覆盖一个缓慢的编排器回合（模型延迟加
 * 上若干次工具调用），同时仍比 issue #867 中实测的 50-58 分钟 followUp
 * 延迟低几个数量级。
 */
export const STALE_COMPLETION_MS = 90_000;

export interface DeliverableCompletion<T> {
	/** 入队时的已落定任务原样保留。 */
	task: T;
	/** 任务落定时传给 enqueue 的时钟值。 */
	settledAt: number;
	/** 当 now - settledAt 达到 STALE_COMPLETION_MS 后为 true。 */
	stale: boolean;
}

export interface CompletionQueue<T extends { id: string }> {
	/** 记录一个已落定的完成项。每个任务 id 至多一条记录；对已投递、待处理或已消费 id 的重复入队是空操作。 */
	enqueue(task: T, settledAt: number): void;
	/** 将任务结果标记为已被父代理消费。幂等；未知 id 也会被记住，以抑制后续的完成项。 */
	consume(taskId: string): void;
	/** 按落定顺序移除并返回仍待处理的完成项，每项附带其在 `now` 时刻的过期判定。已消费条目被丢弃且永不返回。 */
	takeDeliverable(now: number): Array<DeliverableCompletion<T>>;
	/** 丢弃一切：待处理的完成项以及已消费/已投递的簿记。用于会话启动和关闭，确保恢复后不会重放任何内容。 */
	dropAll(): void;
}

export function createCompletionQueue<T extends { id: string }>(): CompletionQueue<T> {
	let pending: Array<{ task: T; settledAt: number }> = [];
	const consumed = new Set<string>();
	const delivered = new Set<string>();
	return {
		enqueue(task, settledAt) {
			if (consumed.has(task.id) || delivered.has(task.id) || pending.some((entry) => entry.task.id === task.id)) return;
			pending.push({ task, settledAt });
		},
		consume(taskId) {
			consumed.add(taskId);
		},
		takeDeliverable(now) {
			const taken = pending;
			pending = [];
			const deliverable: Array<DeliverableCompletion<T>> = [];
			for (const entry of taken) {
				if (consumed.has(entry.task.id)) continue;
				delivered.add(entry.task.id);
				deliverable.push({ task: entry.task, settledAt: entry.settledAt, stale: now - entry.settledAt >= STALE_COMPLETION_MS });
			}
			return deliverable;
		},
		dropAll() {
			pending = [];
			consumed.clear();
			delivered.clear();
		},
	};
}
