import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, normalize, sep } from "node:path";
import { randomUUID } from "node:crypto";

// jero memory: the file-backed persistent memory store that replaces the
// optional gentle-engram companion. One topic key is one markdown file under
// a memory root; an index.json beside the entries speeds listing and search.
// The store is deliberately boring: plain files, atomic temp+rename writes,
// no databases, no native modules, no network.

export const MEMORY_INDEX_KIND = "jero.memory-index/v1";
export const MEMORY_ENTRY_GLOB = "*.md";
export const MAX_MEMORY_CONTENT_BYTES = 64 * 1024;
export const MAX_TOPIC_LENGTH = 128;
const TOPIC_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/;
const MAX_TAG_LENGTH = 64;

export interface MemoryEntryMeta {
	saved_at: string;
	agent: string;
	session: string;
	phase: string;
	tags: string[];
}

export interface MemoryIndexEntry {
	topic: string;
	saved_at: string;
	tags: string[];
	summary: string;
}

export interface MemorySaveResult {
	topic: string;
	path: string;
	bytes: number;
	created: boolean;
}

export function isValidMemoryTopic(topic: string): boolean {
	return topic.length <= MAX_TOPIC_LENGTH && TOPIC_PATTERN.test(topic) && !topic.split("/").includes("..");
}

export function isValidMemoryTag(tag: string): boolean {
	return tag.length > 0 && tag.length <= MAX_TAG_LENGTH && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(tag);
}

/** The global memory config home: `JERO_PI_CONFIG_HOME` overrides `~/.pi/jero`. */
export function memoryConfigHome(env: NodeJS.ProcessEnv = process.env): string {
	const override = env.JERO_PI_CONFIG_HOME?.trim();
	return override && override !== "" ? override : join(homedir(), ".pi", "jero");
}

/** Project memory wins when `<cwd>/.jero/memory` exists; otherwise the global root. */
export function resolveMemoryRoot(cwd: string, env: NodeJS.ProcessEnv = process.env): string {
	const projectRoot = join(cwd, ".jero", "memory");
	if (existsSync(projectRoot)) return projectRoot;
	return join(memoryConfigHome(env), "memory");
}

export function memoryEntryPath(root: string, topic: string): string {
	return join(root, "entries", `${topic}.md`);
}

function atomicWrite(path: string, content: string): void {
	mkdirSync(dirname(path), { recursive: true });
	const staging = join(dirname(path), `.${basenameOf(path)}.tmp-${randomUUID()}`);
	writeFileSync(staging, content, "utf8");
	try {
		renameSync(staging, path);
	} catch (error) {
		rmSync(staging, { force: true });
		throw error;
	}
}

function basenameOf(path: string): string {
	const parts = path.split(sep);
	return parts[parts.length - 1] ?? path;
}

function renderFrontmatter(meta: MemoryEntryMeta): string {
	const lines = ["---", `saved_at: ${meta.saved_at}`, `agent: ${meta.agent}`, `session: ${meta.session}`, `phase: ${meta.phase}`];
	if (meta.tags.length > 0) lines.push(`tags: ${meta.tags.join(",")}`);
	lines.push("---", "");
	return lines.join("\n");
}

interface ParsedEntry {
	meta: MemoryEntryMeta;
	body: string;
}

function parseEntry(raw: string): ParsedEntry {
	const meta: MemoryEntryMeta = { saved_at: "", agent: "", session: "", phase: "", tags: [] };
	let body = raw;
	if (raw.startsWith("---\n")) {
		const end = raw.indexOf("\n---\n", 4);
		if (end >= 0) {
			const header = raw.slice(4, end);
			body = raw.slice(end + 5);
			for (const line of header.split("\n")) {
				const colon = line.indexOf(": ");
				if (colon <= 0) continue;
				const key = line.slice(0, colon);
				const value = line.slice(colon + 2);
				if (key === "tags") meta.tags = value.split(",").map((tag) => tag.trim()).filter((tag) => tag !== "");
				else if (key === "saved_at" || key === "agent" || key === "session" || key === "phase") meta[key] = value;
			}
		}
	}
	return { meta, body };
}

function summarize(body: string): string {
	const firstMeaningful = body.split("\n").map((line) => line.trim()).find((line) => line !== "");
	return firstMeaningful === undefined ? "" : firstMeaningful.slice(0, 120);
}

function readIndex(root: string): Map<string, MemoryIndexEntry> {
	const map = new Map<string, MemoryIndexEntry>();
	const indexPath = join(root, "index.json");
	if (!existsSync(indexPath)) return map;
	try {
		const parsed = JSON.parse(readFileSync(indexPath, "utf8")) as { kind?: unknown; entries?: unknown };
		if (parsed.kind !== MEMORY_INDEX_KIND || typeof parsed.entries !== "object" || parsed.entries === null) return map;
		for (const [topic, value] of Object.entries(parsed.entries as Record<string, unknown>)) {
			if (!isValidMemoryTopic(topic) || typeof value !== "object" || value === null) continue;
			const record = value as Partial<MemoryIndexEntry>;
			if (typeof record.saved_at !== "string" || !Array.isArray(record.tags) || typeof record.summary !== "string") continue;
			map.set(topic, { topic, saved_at: record.saved_at, tags: record.tags.filter((tag): tag is string => typeof tag === "string"), summary: record.summary });
		}
	} catch {
		// A corrupt or unreadable index is rebuilt on the next save or listing.
	}
	return map;
}

function writeIndex(root: string, map: Map<string, MemoryIndexEntry>): void {
	const entries: Record<string, MemoryIndexEntry> = {};
	for (const topic of [...map.keys()].sort()) entries[topic] = map.get(topic)!;
	atomicWrite(join(root, "index.json"), `${JSON.stringify({ kind: MEMORY_INDEX_KIND, version: 1, entries }, null, "\t")}\n`);
}

/** Rebuilds index.json from the entries directory; used when the index is missing or stale. */
export function rebuildMemoryIndex(root: string): number {
	const map = new Map<string, MemoryIndexEntry>();
	for (const { topic, raw } of collectEntryFiles(root)) {
		const parsed = parseEntry(raw);
		map.set(topic, { topic, saved_at: parsed.meta.saved_at, tags: parsed.meta.tags, summary: summarize(parsed.body) });
	}
	writeIndex(root, map);
	return map.size;
}

export function saveMemory(root: string, topic: string, content: string, meta: Partial<MemoryEntryMeta> = {}): MemorySaveResult {
	if (!isValidMemoryTopic(topic)) throw new Error(`invalid memory topic "${topic}": use 1-128 chars of letters, digits, ".", "_", "-", with "/" for hierarchy`);
	const tags = meta.tags ?? [];
	for (const tag of tags) {
		if (!isValidMemoryTag(tag)) throw new Error(`invalid memory tag "${tag}"`);
	}
	const bytes = Buffer.byteLength(content, "utf8");
	if (bytes === 0) throw new Error("memory content must not be empty");
	if (bytes > MAX_MEMORY_CONTENT_BYTES) throw new Error(`memory content is ${bytes} bytes; the limit is ${MAX_MEMORY_CONTENT_BYTES}`);
	const path = memoryEntryPath(root, topic);
	const created = !existsSync(path);
	const rendered = `${renderFrontmatter({
		saved_at: meta.saved_at ?? new Date().toISOString(),
		agent: meta.agent ?? "",
		session: meta.session ?? "",
		phase: meta.phase ?? "",
		tags,
	})}${content.endsWith("\n") ? content : `${content}\n`}`;
	atomicWrite(path, rendered);
	const map = readIndex(root);
	const parsed = parseEntry(rendered);
	map.set(topic, { topic, saved_at: parsed.meta.saved_at, tags, summary: summarize(parsed.body) });
	writeIndex(root, map);
	return { topic, path, bytes, created };
}

export interface MemoryRecord extends MemoryEntryMeta {
	topic: string;
	content: string;
}

export function readMemory(root: string, topic: string): MemoryRecord | undefined {
	if (!isValidMemoryTopic(topic)) return undefined;
	const path = memoryEntryPath(root, topic);
	if (!existsSync(path) || !statSync(path).isFile()) return undefined;
	const parsed = parseEntry(readFileSync(path, "utf8"));
	return { topic, ...parsed.meta, content: parsed.body.replace(/\n$/, "") };
}

export interface MemoryListOptions {
	prefix?: string;
	tag?: string;
	limit?: number;
}

export function listMemory(root: string, options: MemoryListOptions = {}): MemoryIndexEntry[] {
	const limit = options.limit ?? 50;
	let entries = readIndex(root);
	if (entries.size === 0 && existsSync(join(root, "entries"))) {
		// An empty index over a populated entries directory is stale, not empty.
		rebuildMemoryIndex(root);
		entries = readIndex(root);
	}
	let listed = [...entries.values()].sort((a, b) => a.topic.localeCompare(b.topic));
	if (options.prefix !== undefined && options.prefix !== "") listed = listed.filter((entry) => entry.topic.startsWith(options.prefix!));
	if (options.tag !== undefined && options.tag !== "") listed = listed.filter((entry) => entry.tags.includes(options.tag!));
	return listed.slice(0, limit);
}

export interface MemorySearchHit {
	topic: string;
	line: string;
}

export interface MemorySearchOptions {
	limit?: number;
}

/** Case-insensitive AND search over entry bodies; returns the first matching line per topic. */
export function searchMemory(root: string, query: string, options: MemorySearchOptions = {}): MemorySearchHit[] {
	const limit = options.limit ?? 20;
	const terms = query.trim().toLowerCase().split(/\s+/).filter((term) => term !== "");
	if (terms.length === 0) return [];
	const hits: (MemorySearchHit & { score: number })[] = [];
	for (const { topic, raw } of collectEntryFiles(root)) {
		const { body } = parseEntry(raw);
		const lowered = body.toLowerCase();
		if (!terms.every((term) => lowered.includes(term))) continue;
		const score = terms.reduce((total, term) => total + occurrences(lowered, term), 0);
		const line = body.split("\n").map((value) => value.trim()).find((value) => terms.every((term) => value.toLowerCase().includes(term))) ?? "";
		hits.push({ topic, line: line.slice(0, 200), score });
	}
	return hits.sort((a, b) => b.score - a.score || a.topic.localeCompare(b.topic)).slice(0, limit).map(({ topic, line }) => ({ topic, line }));
}

/** Walks entries/ recursively so hierarchical topics (a/b/c) are found at any depth. */
function collectEntryFiles(root: string): { topic: string; raw: string }[] {
	const entriesDir = join(root, "entries");
	if (!existsSync(entriesDir)) return [];
	const collected: { topic: string; raw: string }[] = [];
	const walk = (directory: string, prefix: string): void => {
		for (const entry of readdirSync(directory, { withFileTypes: true })) {
			if (entry.isDirectory()) {
				walk(join(directory, entry.name), `${prefix}${entry.name}/`);
				continue;
			}
			if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
			const topic = `${prefix}${entry.name.slice(0, -3)}`;
			if (!isValidMemoryTopic(topic)) continue;
			try {
				collected.push({ topic, raw: readFileSync(join(directory, entry.name), "utf8") });
			} catch {
				// An unreadable entry is skipped, never fatal to the search.
			}
		}
	};
	walk(entriesDir, "");
	return collected;
}

function occurrences(haystack: string, needle: string): number {
	let count = 0;
	let index = haystack.indexOf(needle);
	while (index >= 0) {
		count += 1;
		index = haystack.indexOf(needle, index + needle.length);
	}
	return count;
}

/** Removes one topic; returns false when it did not exist. Index is kept in sync. */
export function deleteMemory(root: string, topic: string): boolean {
	if (!isValidMemoryTopic(topic)) return false;
	const path = memoryEntryPath(root, topic);
	if (!existsSync(path)) return false;
	rmSync(path, { force: true });
	pruneEmptyAncestorDirs(dirname(path), join(root, "entries"));
	const map = readIndex(root);
	if (map.delete(topic)) writeIndex(root, map);
	return true;
}

/** A hierarchical delete must not leave dangling empty directories behind. */
function pruneEmptyAncestorDirs(directory: string, stop: string): void {
	let current = directory;
	while (current.startsWith(`${stop}${sep}`) || current.startsWith(`${stop}/`)) {
		try {
			if (readdirSync(current).length > 0) return;
			rmSync(current, { recursive: true, force: true });
		} catch {
			return;
		}
		current = dirname(current);
	}
}

/** Normalizes a topic so SDD artifact keys stay stable, e.g. `sdd/<change>/proposal`. */
export function normalizeMemoryTopic(topic: string): string {
	return normalize(topic).split(sep).join("/").replace(/\/+$/, "");
}
