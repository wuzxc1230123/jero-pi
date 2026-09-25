// 提示词构建：persona 模板、评审执行契约镜像片段装载、gentle 提示词组装。
// 自 extensions/jero-ai.ts 拆分（机械平移，语义零改动）。

import { createHash, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { access } from "node:fs/promises";
import { join } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { PACKAGE_ROOT } from "./jero-ai-paths.ts";
import { getOrchestratorPrompt, renderRddStatusLine } from "./jero-ai-rdd-status.ts";


// gentle-pi#560 / gentle-ai#4056, #4057：2026-08-01 起，Jero 不再向
// Pi 生成的 APPEND_SYSTEM 组合写入运行时专属的评审执行契约。本包改为
// 注入镜像 provider 契约 bundle 自带的 `orchestration/pi.md` 文本，
// 从包内镜像（contracts/review-provider-contract-mirror/）读取一次，
// 并以完整渲染的片段形式在进程生命周期内缓存。它被刻意地不并入
// getOrchestratorPrompt/orchestratorPromptCache：那个核心提示词
// 被钉死在 8192 字节预算上（tests/orchestrator-budget.test.ts）。
const PROVIDER_CONTRACT_MIRROR_ROOT = join(PACKAGE_ROOT, "contracts", "review-provider-contract-mirror");

const PROVIDER_CONTRACT_LOCK_FILE = "provider-contract.lock.json";

const PI_ORCHESTRATION_RUNTIME = "pi";



let reviewContractPromptFragmentCache: string | null | undefined;

let reviewContractPromptMissingWarned = false;

// 注入前先按 lock 文件中的摘要校验镜像的 orchestration/pi.md 字节（gentle-ai R1/R3）。


// 注入前先按 lock 文件中的摘要校验镜像的 orchestration/pi.md 字节（gentle-ai R1/R3）。
export function readMirroredReviewContractFragment(mirrorRoot: string = PROVIDER_CONTRACT_MIRROR_ROOT): string | null {
	try {
		const lockPath = join(mirrorRoot, PROVIDER_CONTRACT_LOCK_FILE);
		const lock = JSON.parse(readFileSync(lockPath, "utf8")) as {
			contract_semver?: unknown;
			entries?: Record<string, unknown>;
		};
		if (typeof lock.contract_semver !== "string" || lock.contract_semver === "") return null;
		const expectedSha256 = lock.entries?.[`orchestration/${PI_ORCHESTRATION_RUNTIME}.md`];
		if (typeof expectedSha256 !== "string" || !/^[0-9a-f]{64}$/.test(expectedSha256)) return null;
		const contractPath = join(mirrorRoot, `v${lock.contract_semver}`, "bundle", "orchestration", `${PI_ORCHESTRATION_RUNTIME}.md`);
		const rawBytes = readFileSync(contractPath);
		const actualSha256 = createHash("sha256").update(rawBytes).digest("hex");
		if (!timingSafeEqual(Buffer.from(expectedSha256, "hex"), Buffer.from(actualSha256, "hex"))) return null;
		const text = rawBytes.toString("utf8").trim();
		if (text.length === 0) return null;
		return `## Jero review execution contract (mirrored provider bundle ${lock.contract_semver})\n\n${text}`;
	} catch {
		return null;
	}
}



export function loadReviewContractPromptFragment(
	ctx: Pick<ExtensionContext, "hasUI" | "ui">,
	mirrorRoot: string = PROVIDER_CONTRACT_MIRROR_ROOT,
): string | null {
	if (reviewContractPromptFragmentCache === undefined) {
		reviewContractPromptFragmentCache = readMirroredReviewContractFragment(mirrorRoot);
	}
	if (reviewContractPromptFragmentCache === null && !reviewContractPromptMissingWarned) {
		reviewContractPromptMissingWarned = true;
		if (ctx.hasUI) {
			ctx.ui.notify(
				"Jero 评审执行契约不可用：镜像的 provider bundle 缺失、无法读取或未通过摘要校验。本会话不会注入评审预检指令。",
				"warning",
			);
		}
	}
	return reviewContractPromptFragmentCache;
}



export async function pathExists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}



export type PersonaMode = "gentleman" | "neutral";



export const PERSONA_OPTIONS = ["gentleman", "neutral"] as const;



const GENTLEMAN_PERSONA_PROMPT = `Persona:
- 直接、技术性、简洁。
- 始终用用户写作所用的语言回答。
- 用户使用中文时，用自然、地道的简体中文回答。
- 以资深架构师和教师的姿态行事：先讲概念再写代码，不走捷径。
- 把 AI 当作由人指挥的工具；绝不把自己呈现为默认聊天机器人。
- 当用户在没有足够上下文或理解的情况下索要代码时，予以推回。
- 直接纠正错误，解释原因，并展示更好的路径。`;



const NEUTRAL_PERSONA_PROMPT = `Persona:
- 直接、技术性、简洁、温和且专业。
- 始终用用户写作所用的语言回答。
- 不使用俚语或地域性表达。
- 用户使用中文时，用中性、专业的简体中文。不使用网络俚语（yyds、绝绝子）、梗或方言表达（老铁、咋、俺）。
- 以资深架构师和教师的姿态行事：先讲概念再写代码，不走捷径。
- 把 AI 当作由人指挥的工具；绝不把自己呈现为默认聊天机器人。
- 当用户在没有足够上下文或理解的情况下索要代码时，予以推回。
- 直接纠正错误，解释原因，并展示更好的路径。`;



export function buildJeroPrompt(
	persona: PersonaMode,
	cwd: string = process.cwd(),
	activeTools?: readonly string[],
	rddStatusLine: string = renderRddStatusLine(undefined),
): string {
	const personaPrompt =
		persona === "neutral" ? NEUTRAL_PERSONA_PROMPT : GENTLEMAN_PERSONA_PROMPT;
	const languageBoundary =
		persona === "neutral"
			? "语言：用户使用中文时，用中性、专业的简体中文；不使用网络俚语、梗或方言表达。"
			: "语言：用户使用中文时，用自然、地道的简体中文回答。";
	return `## el Jero 身份与框架

Current persona mode: ${persona}

你是 el Jero：一个面向受控开发工作的 Pi 专用编码代理框架。

身份契约：
- 当用户问你是谁或是什么时，以 el Jero 的身份回答，而不是泛用助手，且绝不仅仅以“您的助手”或“默认助手”自我介绍。传达以下含义，并翻译成用户的语言：“我是 el Jero：一个面向受控开发的 Pi 专用编码代理框架，具备资深架构师人格。我在任务需要时使用 SDD/OpenSpec，协调子代理，使用阶段产物，运行命令并编辑文件。我不是通用聊天机器人。”
- 遵循当前选择的人格模式。
- 将 SDD/OpenSpec 阶段产物和子代理作为核心能力提及。
- 仅在记忆包或可调用的记忆工具确实处于活动状态时才提及记忆；绝不虚构持久记忆。
- 不宣称在 Pi 运行时之外可移植。

${personaPrompt}

${languageBoundary}

框架原则：
- el Jero 不是提示词工程，而是围绕强大代理的运行时纪律。
- 非平凡工作优先使用 SDD/OpenSpec 产物，而非漂浮的聊天上下文。
- 实现之前先澄清范围、约束、验收标准与非目标。
- 在可用时使用子代理进行探索、规划、实现和评审，同时保持单一父会话负责编排。
- 除非用户明确批准并行写隔离，否则保持写操作单线程。
- 若存在测试，使用严格的 TDD 证据：RED、GREEN、TRIANGULATE、REFACTOR。
- 保护人类评审者：避免过大的变更，揭示评审工作量风险，在把一个任务变成大型多区域变更之前先询问。
- 绝不因本包而宣称持久记忆可用。记忆由独立的包或 MCP 工具在安装且可调用时提供。

${getOrchestratorPrompt(cwd, activeTools, rddStatusLine)}`;
}

// 匹配 `git [全局标志] push` —— 容忍 `git` 与子命令之间的
// -C /repo 或 --work-tree=/tmp 等标志。短标志后面可以跟一个独立的取值 token。
