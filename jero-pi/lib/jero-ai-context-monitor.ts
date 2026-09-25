// jero 上下文余量监控：Pi 宿主进程内本就有精确的 token 计数
// （`ExtensionContext.getContextUsage()`），本模块把它变成逐级阈值告警：
// 代理回合落定时评估用量，升级跨档时各通知一次；压缩完成后复位，
// 并提示用 mem_search / mem_read 找回持久化上下文。这是纯通知层
// 增强——绝不自动触发压缩、绝不注入回合、绝不改写任何权威状态。
// 阈值与 shell-gauge 的显示色（80/95）解耦：告警要早于仪表变色。

export const CONTEXT_MONITOR_THRESHOLDS = {
	notice: 70,
	warning: 85,
	critical: 93,
} as const;

const CONTEXT_MONITOR_LEVEL_ORDER = { ok: 0, notice: 1, warning: 2, critical: 3 } as const;

export type ContextMonitorLevel = keyof typeof CONTEXT_MONITOR_LEVEL_ORDER;

export interface ContextUsageSnapshot {
	tokens: number | null;
	contextWindow: number;
	percent: number | null;
}

export interface ContextMonitorState {
	lastLevel: ContextMonitorLevel;
}

export interface ContextMonitorVerdict {
	level: ContextMonitorLevel;
	escalated: boolean;
	notifyType: "info" | "warning" | "error";
	message?: string;
}

/** `JERO_PI_CONTEXT_MONITOR=0|false|off` 关闭；默认开启。 */
export function contextMonitorEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
	const value = env.JERO_PI_CONTEXT_MONITOR?.trim().toLowerCase();
	return !(value === "0" || value === "false" || value === "off");
}

function clampPercent(percent: number): number {
	return Math.max(0, Math.min(100, percent));
}

function levelForPercent(percent: number): ContextMonitorLevel {
	if (percent >= CONTEXT_MONITOR_THRESHOLDS.critical) return "critical";
	if (percent >= CONTEXT_MONITOR_THRESHOLDS.warning) return "warning";
	if (percent >= CONTEXT_MONITOR_THRESHOLDS.notice) return "notice";
	return "ok";
}

const MESSAGES: Record<Exclude<ContextMonitorLevel, "ok">, (percent: number) => string> = {
	notice: (percent) => `上下文窗口已用 ${percent}%。接近压缩阈值：后续仍需要的关键决策与发现，先 mem_save 到持久记忆。`,
	warning: (percent) => `上下文窗口已用 ${percent}%。压缩临近：先 mem_save 关键状态；需要时 /compact 后用 mem_search 找回。`,
	critical: (percent) => `上下文窗口仅余 ${100 - percent}%。即将压缩：立即 mem_save 未持久化的关键状态，避免丢失。`,
};

/**
 * 依据当前用量与上一档位给出裁决：只在新档位**高于**旧档位时升级并
 * 附带消息（每档最多通知一次）；用量回落（如压缩后）静默降档，使后续
 * 再次上升仍能告警。用量未知（tokens/percent 均缺失）时保持 ok。
 */
export function evaluateContextMonitor(usage: ContextUsageSnapshot, state: ContextMonitorState): ContextMonitorVerdict {
	const raw = usage.percent ?? (usage.contextWindow > 0 && usage.tokens !== null ? (usage.tokens / usage.contextWindow) * 100 : null);
	if (raw === null || !Number.isFinite(raw)) {
		return { level: "ok", escalated: false, notifyType: "info" };
	}
	const percent = Math.round(clampPercent(raw));
	const level = levelForPercent(percent);
	const escalated = CONTEXT_MONITOR_LEVEL_ORDER[level] > CONTEXT_MONITOR_LEVEL_ORDER[state.lastLevel];
	if (level === "ok") {
		return { level, escalated: false, notifyType: "info" };
	}
	return {
		level,
		escalated,
		notifyType: level === "critical" ? "error" : "warning",
		message: escalated ? MESSAGES[level](percent) : undefined,
	};
}

/** 压缩完成后的复位档位与提示语（提示语供宿主 notify 使用）。 */
export const CONTEXT_COMPACT_RECOVERY_MESSAGE = "上下文压缩已完成。继续前可用 mem_search / mem_read 找回此前持久化的关键上下文。";
