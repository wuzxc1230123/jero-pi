import { homedir } from "node:os";
import { join } from "node:path";

// Pi Subagents 将其全局目录解析为 `PI_CODING_AGENT_DIR || ~/.pi/agent`，
// 因此这里的空值也必须向下穿透，否则两个主目录会再次分叉。
export function resolveGentlePiAgentHome(env: NodeJS.ProcessEnv = process.env): string {
	return env.JERO_PI_AGENT_HOME || env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
}
