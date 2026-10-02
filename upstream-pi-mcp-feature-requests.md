# 上游 Pi feature 请求草稿（MCP 作用域）

> 用途：粘贴到 https://github.com/earendil-works/pi/issues （monorepo 的
> packages/coding-agent）。两份草稿独立成帖，互补但不互相依赖。本文件在
> 仓库根、不随 jero-pi 包发布。验证环境：pi-coding-agent 0.85.1。

---

## Issue 1 — Project-scoped MCP server configuration

**Title:** Project-scoped MCP server config (`.pi/mcp.json`), mirroring the existing `.pi/agents` / `.pi/skills` project surfaces

**Body:**

### Context

MCP servers are currently configured only via the global agent config (`~/.pi/agent/mcp.json`). Meanwhile, Pi already scopes **agents** and **skills** per project through `.pi/agents/` and `.pi/skills/` — the project-as-boundary model works great there.

I maintain a Pi extension package that ships domain modules (installed into a project's `.pi/modules/`, plus `.pi/agents/` + `.pi/skills/`). Some of those domains want an MCP server (e.g. a Godot-editor bridge). Today the only way to wire it is to write into the **global** `~/.pi/agent/mcp.json`, which means:

- installing a project-local extension has **global** side effects (the server becomes available in every Pi session, for every project);
- uninstalling the project leaves the entry orphaned unless we track and clean it ourselves;
- the trust boundary is wrong: repo-level content (like `.pi/agents`) is reviewed with the repo; a global config entry is not.

### Proposal

Support a project-scoped MCP config, e.g. `.pi/mcp.json` in the session cwd, with the same `mcpServers` shape:

- layered with the global config at session start (project entries extend the global set; on name collision, project wins, or a loud warning — either is fine as long as it's documented);
- absent file ⇒ exactly today's behavior (fully backward compatible);
- preserved unknown keys on rewrite (we merge entries idempotently and never want to destroy user content).

### Security consideration

`.pi/mcp.json` should be treated as trusted-as-repo-content (same as `.pi/agents/` — a cloned repo can already shape agent behavior). A first-use notice ("this project declares MCP servers: …") would be a nice touch, but scope-to-project alone already shrinks the blast radius a lot compared to writing global config.

### Environment

pi-coding-agent 0.85.1, Windows.

---

## Issue 2 — Extension API for runtime (session-scoped) MCP registration

**Title:** Extension API to register MCP servers at runtime (session-scoped, no config-file writes)

**Body:**

### Context

Same motivation as project-scoped MCP config: an extension that wants to bring
an MCP server along (e.g. a domain bridge installed per project) currently has
to mutate `~/.pi/agent/mcp.json` — a global, persistent side effect — and the
entry only takes effect after a session reload.

### Proposal

An extension API along the lines of:

```ts
pi.registerMcpServer({
	name: "godot-ai",
	command: "uvx",
	args: ["--from", "godot-ai@4.2.3", "godot-ai", "attach"],
	// optional env, disabled flag, etc.
});
```

- registers for the **current session only**; no file writes;
- auto-disposed on session shutdown (or an explicit `dispose()` handle);
- ideally available from `session_start` so the tools are live in the same
  session that enabled them, without a reload round-trip;
- duplicate registration rules (second call with same name ⇒ error or
  idempotent replace, either is fine if documented).

### Why this beats config-file writes for extensions

- zero global mutation; uninstalling/leaving a project leaves nothing behind;
  the consent surface stays inside the session where the user invoked the
  extension command;
- extensions can gate registration behind their own checks (tool availability,
  user confirmation) instead of shipping static config;
- composes cleanly with a future project-scoped `.pi/mcp.json` (the static
  file covers repo-declared servers; the API covers dynamic ones).

### Environment

pi-coding-agent 0.85.1, Windows.
