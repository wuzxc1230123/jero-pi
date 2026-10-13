// 护栏确认生命周期与 bash 确认编排：权限事件配对、阻塞标签、交互确认流程。
// 自 extensions/jero-ai.ts 拆分（机械平移，语义零改动）。

import { randomUUID } from "node:crypto";
import type { ExtensionAPI, ExtensionContext, ToolCallEventResult } from "@earendil-works/pi-coding-agent";

import { evaluateGuardedCommand, guardedCommandPreview, guardedCommandTitle, loadRuntimeGuardrailsConfig } from "./jero-ai-guardrails.ts";


// D6（design §5.3，rpiv 行）：`rpiv:ask-user:blocked` 监听器与
// choice/questionnaire 阻塞标签已删除——由于
// @juicesharp/rpiv-ask-user-question 是硬依赖，插件自管其
// 阻塞 UX。这里剩下的是受守卫命令的确认
// 生命周期（评审同意 UI，设计上是独立组件）。
const HERDR_BLOCKER_LABEL = {
	GUARDED_CONFIRMATION: "Guarded command confirmation",
} as const;



type HerdrBlockerLabel = (typeof HERDR_BLOCKER_LABEL)[keyof typeof HERDR_BLOCKER_LABEL];



type HerdrConfirmationLifecycle = {
	begin(): void;
	settle(): void;
};



export function createHerdrConfirmationLifecycle(events: ExtensionAPI["events"]): HerdrConfirmationLifecycle {
	let pending = 0;
	let emittedLabel: HerdrBlockerLabel | undefined;
	const emitEffectiveBlocker = (): void => {
		const nextLabel = pending > 0 ? HERDR_BLOCKER_LABEL.GUARDED_CONFIRMATION : undefined;
		if (nextLabel === emittedLabel) return;
		emittedLabel = nextLabel;
		if (nextLabel === undefined) events.emit("herdr:blocked", { active: false });
		else events.emit("herdr:blocked", { active: true, label: nextLabel });
	};

	return {
		begin() {
			pending += 1;
			emitEffectiveBlocker();
		},
		settle() {
			if (pending === 0) return;
			pending -= 1;
			emitEffectiveBlocker();
		},
	};
}



export async function confirmCommand(
	command: string,
	ctx: ExtensionContext,
	events: ExtensionAPI["events"],
	herdrLifecycle: HerdrConfirmationLifecycle,
): Promise<ToolCallEventResult | undefined> {
	const guardrailsConfig = loadRuntimeGuardrailsConfig(ctx.cwd);
	const evaluation = evaluateGuardedCommand(command, guardrailsConfig);
	const { action: classification } = evaluation;

	if (classification === "block") {
		return {
			block: true,
			reason:
				"Jero safety policy blocked a destructive shell command. Ask the user for an explicit safer plan.",
		};
	}

	if (classification === "not-guarded") return undefined;

	// 从这里开始，classification 只可能是 "allow" 或 "confirm"
	if (classification === "allow") return undefined;

	// classification === "confirm"
	if (!ctx.hasUI) {
		return {
			block: true,
			reason:
				"Jero safety policy requires interactive confirmation before this command.",
		};
	}
	const title = guardedCommandTitle(evaluation.key, evaluation.matches);
	const preview = guardedCommandPreview(command, evaluation.triggerIndex);
	const requestId = randomUUID();
	const emitPermissionRequest = (
		state: "waiting" | "approved" | "denied",
	): void => {
		events.emit("pi-permission-system:permission-request", {
			requestId,
			state,
			source: "tool_call",
			message: "Jero safety policy requires confirmation for this tool call.",
			toolName: "bash",
		});
	};
	let approved = false;
	let confirmationFailed = false;
	let confirmationError: unknown;
	emitPermissionRequest("waiting");
	herdrLifecycle.begin();
	try {
		approved = await ctx.ui.confirm(title, preview);
	} catch (error) {
		confirmationFailed = true;
		confirmationError = error;
	} finally {
		try {
			emitPermissionRequest(confirmationFailed || !approved ? "denied" : "approved");
		} finally {
			herdrLifecycle.settle();
		}
	}
	if (confirmationFailed) throw confirmationError;
	if (approved) return undefined;
	return {
		block: true,
		reason:
			"Jero safety policy blocked the command because it was not confirmed.",
	};
}

