// 浏览器出站结构门：对伴生件 pi-browser-use 注册的 browser_* 工具调用做
// 域名级 allow/deny 判定。browser-policy 技能是提示级约束；本门经宿主
// tool_call 拦截做结构级收窄——allow 模式下未命中清单或无法解析主机名的
// 导航一律 fail-closed 阻断。判定只依赖 (策略, 工具名, 入参) 三元组：
// 策略串的解析与 env 读取均为可注入纯函数（默认 process.env），不做 IO。
//
// 门面约定：只拦 toolName 以 browser_ 开头、且 input.url 为非空字符串的
// 调用（pi-browser-use 以 browser_ 前缀注册全部上游工具，导航面携带
// url 参数）。不硬编码具体工具清单，上游增删工具名不产生漏门。

export type BrowserDomainPolicy =
	| { mode: "off" }
	| { mode: "allow"; domains: string[] }
	| { mode: "deny"; domains: string[] }
	| { mode: "invalid"; raw: string };

export type BrowserGateDecision =
	| { action: "ignore" }
	| { action: "block"; reason: string };

const POLICY_ENV_VAR = "JERO_PI_BROWSER_DOMAINS";
const POLICY_PATTERN = /^\s*(allow|deny)\s*:\s*(\S.*)$/i;
const DOMAIN_ENTRY_PATTERN = /^\.?[a-z0-9-]+(?:\.[a-z0-9-]+)*$/;

const GATE_LABEL = "浏览器出站结构门（JERO_PI_BROWSER_DOMAINS）";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

/**
 * 解析策略串：`allow:域清单` / `deny:域清单`，清单以逗号或空白分隔；
 * `example.com` 匹配裸域及其全部子域，`.example.com` 仅匹配子域。
 * 未设置或全空白 = off（不设门）；模式词缺失、清单为空、任一条目非法
 * = invalid（按 fail-closed 处理，绝不静默降级为 off）。
 */
export function parseBrowserDomainPolicy(raw: string | undefined): BrowserDomainPolicy {
	if (raw === undefined || raw.trim() === "") return { mode: "off" };
	const match = POLICY_PATTERN.exec(raw);
	if (match === null) {
		return { mode: "invalid", raw: raw.trim() };
	}
	const mode = match[1]!.toLowerCase() as "allow" | "deny";
	const domains = match[2]!.split(/[\s,;]+/)
		.map((entry) => entry.trim().toLowerCase())
		.filter((entry) => entry !== "");
	if (domains.length === 0 || domains.some((entry) => !DOMAIN_ENTRY_PATTERN.test(entry))) {
		return { mode: "invalid", raw: raw.trim() };
	}
	return { mode, domains };
}

/** 从注入的 env（默认 process.env）读取策略串并解析。 */
export function resolveBrowserDomainPolicy(env: NodeJS.ProcessEnv = process.env): BrowserDomainPolicy {
	return parseBrowserDomainPolicy(env[POLICY_ENV_VAR]);
}

function hostMatchesEntry(host: string, entry: string): boolean {
	if (entry.startsWith(".")) return host.endsWith(entry);
	return host === entry || host.endsWith(`.${entry}`);
}

function blocked(reason: string): BrowserGateDecision {
	return { action: "block", reason };
}

/**
 * 判定一次工具调用是否放行。返回 ignore = 不归本门管（非浏览器工具、
 * 无 url 参数、或策略语义下无需阻断）；返回 block = 宿主应以其 reason
 * 阻断该调用。
 */
export function evaluateBrowserDomainGate(
	policy: BrowserDomainPolicy,
	toolName: string,
	input: unknown,
): BrowserGateDecision {
	if (!toolName.startsWith("browser_")) return { action: "ignore" };
	if (!isRecord(input) || typeof input.url !== "string" || input.url === "") return { action: "ignore" };
	const url = input.url;

	if (policy.mode === "off") return { action: "ignore" };

	if (policy.mode === "invalid") {
		return blocked(
			`${GATE_LABEL}：配置无法解析（原文：${policy.raw.slice(0, 80)}），已按 fail-closed 阻断浏览器导航。`
			+ `正确格式：allow:example.com,.internal.corp 或 deny:evil.example`,
		);
	}

	let hostname: string | null = null;
	try {
		const parsed = new URL(url);
		hostname = parsed.hostname === "" ? null : parsed.hostname.toLowerCase();
	} catch {
		hostname = null;
	}

	if (hostname === null) {
		// 无法解析主机名（无协议的裸串会被浏览器当搜索词）。allow 模式下
		// 无法证明其在清单内 → 阻断；deny 模式下它不构成对清单域名的
		// 定向导航 → 放行。
		if (policy.mode === "allow") {
			return blocked(`${GATE_LABEL}：导航目标无法解析出主机名（${url.slice(0, 80)}），allow 模式下按 fail-closed 阻断。`);
		}
		return { action: "ignore" };
	}

	if (policy.mode === "allow") {
		const matched = policy.domains.some((entry) => hostMatchesEntry(hostname!, entry));
		if (!matched) {
			return blocked(`${GATE_LABEL}：${hostname} 不在允许清单内。`);
		}
		return { action: "ignore" };
	}

	const denied = policy.domains.some((entry) => hostMatchesEntry(hostname!, entry));
	if (denied) {
		return blocked(`${GATE_LABEL}：${hostname} 命中拒绝清单。`);
	}
	return { action: "ignore" };
}
