import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import {
	isValidMemoryTopic,
	listMemory,
	MAX_MEMORY_CONTENT_BYTES,
	readMemory,
	resolveMemoryRoot,
	saveMemory,
	searchMemory,
} from "../lib/memory.ts";

// jero memory: the built-in persistent memory tools (mem_save / mem_read /
// mem_list / mem_search) backed by lib/memory.ts. The parent orchestrator
// owns retrieval and passes selected context into subagent prompts; agents
// save significant discoveries, decisions, and SDD phase artifacts before
// returning. Tool names keep the `mem_*` shape so delegation contracts and
// the doctor's memory-tool detection keep working.

const SAVE_PARAMETERS = {
	type: "object",
	additionalProperties: false,
	required: ["topic", "content"],
	properties: {
		topic: { type: "string", description: "Stable topic key, e.g. sdd/<change>/proposal or decisions/auth-layout. Letters, digits, ., _, -, and / for hierarchy." },
		content: { type: "string", description: `The memory body as markdown, up to ${MAX_MEMORY_CONTENT_BYTES} bytes. Saving again with the same topic replaces it.` },
		tags: { type: "array", items: { type: "string" }, description: "Optional short labels for listing, e.g. [\"sdd\", \"decision\"]." },
	},
} as const;

const READ_PARAMETERS = {
	type: "object",
	additionalProperties: false,
	required: ["topic"],
	properties: {
		topic: { type: "string", description: "Exact topic key to read." },
	},
} as const;

const LIST_PARAMETERS = {
	type: "object",
	additionalProperties: false,
	properties: {
		prefix: { type: "string", description: "Only topics starting with this prefix, e.g. sdd/auth-layout/." },
		tag: { type: "string", description: "Only entries carrying this tag." },
		limit: { type: "integer", description: "Maximum entries to report (default 50)." },
	},
} as const;

const SEARCH_PARAMETERS = {
	type: "object",
	additionalProperties: false,
	required: ["query"],
	properties: {
		query: { type: "string", description: "Whitespace-separated terms; all must match, case-insensitive." },
		limit: { type: "integer", description: "Maximum hits to report (default 20)." },
	},
} as const;

export function memoryEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
	const value = env.JERO_PI_MEMORY?.trim().toLowerCase();
	return !(value === "0" || value === "false" || value === "off");
}

type MemoryToolParams = {
	topic?: unknown;
	content?: unknown;
	tags?: unknown;
	prefix?: unknown;
	tag?: unknown;
	limit?: unknown;
	query?: unknown;
};

function rootFor(ctx: Pick<ExtensionContext, "cwd">, env: NodeJS.ProcessEnv): string {
	return resolveMemoryRoot(ctx.cwd, env);
}

function asStringArray(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((tag): tag is string => typeof tag === "string") : [];
}

function asPositiveInt(value: unknown): number | undefined {
	return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

export default function jeroMemory(pi: ExtensionAPI, env: NodeJS.ProcessEnv = process.env): void {
	if (!memoryEnabled(env)) return;

	pi.registerTool({
		name: "mem_save",
		renderShell: "self",
		label: "Memory",
		description: "Save or replace one persistent memory entry by topic key. Use stable keys (sdd/<change>/<phase>, decisions/<slug>) so later sessions can find it.",
		promptSnippet: "Persist decisions, fixes, and phase artifacts under stable topic keys",
		promptGuidelines: [
			"Save significant discoveries, decisions, bug fixes, and completed SDD phase artifacts before returning from delegated work.",
			"Use stable hierarchical topic keys such as sdd/<change>/proposal or decisions/<slug>; saving again with the same topic replaces it.",
			"Do not save secrets, tokens, or throwaway output; memory is for context the next session needs.",
		],
		parameters: SAVE_PARAMETERS,
		executionMode: "sequential",
		renderCall(args, theme) {
			const topic = typeof (args as { topic?: unknown }).topic === "string" ? (args as { topic: string }).topic : "";
			return new Text(theme.fg("toolTitle", `❀ mem_save · ${topic}`), 0, 0);
		},
		renderResult(result, options, theme) {
			const text = result.content.map((part) => (part.type === "text" ? part.text : "")).join("\n");
			return new Text(options.expanded ? text : theme.fg("muted", text.split("\n")[0] ?? ""), 0, 0);
		},
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const args = params as MemoryToolParams;
			const topic = typeof args.topic === "string" ? args.topic.trim() : "";
			const content = typeof args.content === "string" ? args.content : "";
			if (topic === "" || content === "") {
				return { content: [{ type: "text", text: "mem_save requires a non-empty topic and content." }], details: { error: "invalid-arguments" } };
			}
			try {
				const saved = saveMemory(rootFor(ctx, env), topic, content, {
					session: typeof ctx.sessionManager?.getSessionId === "function" ? (ctx.sessionManager.getSessionId() ?? "") : "",
					tags: asStringArray(args.tags),
				});
				return { content: [{ type: "text", text: `saved ${saved.topic} (${saved.bytes} bytes, ${saved.created ? "created" : "replaced"})` }], details: { topic: saved.topic, bytes: saved.bytes, created: saved.created } };
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return { content: [{ type: "text", text: `mem_save failed: ${message}` }], details: { error: "save-failed" } };
			}
		},
	});

	pi.registerTool({
		name: "mem_read",
		renderShell: "self",
		label: "Memory",
		description: "Read one persistent memory entry by exact topic key.",
		promptSnippet: "Read a persisted memory entry by its exact topic key",
		promptGuidelines: ["The parent orchestrator retrieves memory and passes selected context into subagent prompts; read a specific artifact only when instructed."],
		parameters: READ_PARAMETERS,
		executionMode: "sequential",
		renderCall(args, theme) {
			const topic = typeof (args as { topic?: unknown }).topic === "string" ? (args as { topic: string }).topic : "";
			return new Text(theme.fg("toolTitle", `❀ mem_read · ${topic}`), 0, 0);
		},
		renderResult(result, options, theme) {
			const text = result.content.map((part) => (part.type === "text" ? part.text : "")).join("\n");
			return new Text(options.expanded ? text : theme.fg("muted", text.split("\n")[0] ?? ""), 0, 0);
		},
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const args = params as MemoryToolParams;
			const topic = typeof args.topic === "string" ? args.topic.trim() : "";
			if (!isValidMemoryTopic(topic)) {
				return { content: [{ type: "text", text: `mem_read: invalid topic "${topic}".` }], details: { error: "invalid-topic" } };
			}
			const record = readMemory(rootFor(ctx, env), topic);
			if (record === undefined) {
				return { content: [{ type: "text", text: `mem_read: no entry for "${topic}".` }], details: { error: "not-found" } };
			}
			const header = [record.saved_at !== "" ? `saved ${record.saved_at}` : "", record.tags.length > 0 ? `tags: ${record.tags.join(", ")}` : ""].filter((line) => line !== "").join(" · ");
			return { content: [{ type: "text", text: header === "" ? record.content : `${header}\n\n${record.content}` }], details: { topic, tags: record.tags } };
		},
	});

	pi.registerTool({
		name: "mem_list",
		renderShell: "self",
		label: "Memory",
		description: "List persisted memory entries by prefix or tag, newest fields included in the summary.",
		promptSnippet: "List memory entries by prefix or tag",
		promptGuidelines: ["List before guessing keys; pick exact topics with mem_read or mem_search."],
		parameters: LIST_PARAMETERS,
		executionMode: "sequential",
		renderCall(_args, theme) {
			return new Text(theme.fg("toolTitle", "❀ mem_list"), 0, 0);
		},
		renderResult(result, options, theme) {
			const text = result.content.map((part) => (part.type === "text" ? part.text : "")).join("\n");
			return new Text(options.expanded ? text : theme.fg("muted", text.split("\n")[0] ?? ""), 0, 0);
		},
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const args = params as MemoryToolParams;
			const entries = listMemory(rootFor(ctx, env), {
				prefix: typeof args.prefix === "string" ? args.prefix : undefined,
				tag: typeof args.tag === "string" ? args.tag : undefined,
				limit: asPositiveInt(args.limit),
			});
			if (entries.length === 0) {
				return { content: [{ type: "text", text: "mem_list: no matching entries." }], details: { count: 0 } };
			}
			const lines = entries.map((entry) => `${entry.topic}${entry.tags.length > 0 ? ` [${entry.tags.join(",")}]` : ""}${entry.summary !== "" ? ` — ${entry.summary}` : ""}`);
			return { content: [{ type: "text", text: lines.join("\n") }], details: { count: entries.length } };
		},
	});

	pi.registerTool({
		name: "mem_search",
		renderShell: "self",
		label: "Memory",
		description: "Search persisted memory entries; all whitespace-separated terms must match, case-insensitive.",
		promptSnippet: "Search memory entries by keywords",
		promptGuidelines: ["Search memory before re-deriving decisions or re-fixing bugs that an earlier session may have recorded."],
		parameters: SEARCH_PARAMETERS,
		executionMode: "sequential",
		renderCall(args, theme) {
			const query = typeof (args as { query?: unknown }).query === "string" ? (args as { query: string }).query : "";
			return new Text(theme.fg("toolTitle", `❀ mem_search · ${query}`), 0, 0);
		},
		renderResult(result, options, theme) {
			const text = result.content.map((part) => (part.type === "text" ? part.text : "")).join("\n");
			return new Text(options.expanded ? text : theme.fg("muted", text.split("\n")[0] ?? ""), 0, 0);
		},
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const args = params as MemoryToolParams;
			const query = typeof args.query === "string" ? args.query : "";
			const hits = searchMemory(rootFor(ctx, env), query, { limit: asPositiveInt(args.limit) });
			if (hits.length === 0) {
				return { content: [{ type: "text", text: `mem_search: no entries match "${query}".` }], details: { count: 0 } };
			}
			const lines = hits.map((hit) => (hit.line !== "" ? `${hit.topic} — ${hit.line}` : hit.topic));
			return { content: [{ type: "text", text: lines.join("\n") }], details: { count: hits.length } };
		},
	});
}
