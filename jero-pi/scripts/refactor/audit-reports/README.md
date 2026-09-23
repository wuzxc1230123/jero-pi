# jero-pi 代码审核报告归档（2026-09-23）

本目录归档本轮全量审核的分域报告，由四个并行审核代理产出 + 主会话的结构分析。

## 分域报告

- [review-agents-runner.md](review-agents-runner.md) — 代理运行器+视图（agents-runner / agents-view）
- [review-extension-ui.md](review-extension-ui.md) — 扩展入口与 UI 域（jero-ai.ts / jero-agents / startup-banner / sdd-init）
- [review-authority.md](review-authority.md) — authority 权威域（主会话结构分析产出：wire-contract/client-contract 拆分、finalize.ts:291 优先级隐患）
- [review-review-core.md](review-review-core.md) — 评审核心三文件（主会话结构分析产出：拆分方案、缩进疤痕、Graph-v1 活路径核实）
- [review-lib-misc.md](review-lib-misc.md) — lib 其余模块与循环依赖（主会话结构分析产出：TDZ 零高危结论、sdd-preflight 拆分、三处跨文件重复、类型门禁已破的实证）

## 主会话结构分析（已确认事实）

- extensions/jero-ai.ts = **9042 行**，拆分停在半途：15 个 lib/jero-ai-*.ts 新模块已生成但扩展体未剥离。
- **118 个符号在扩展与新模块间重复定义**（全部落在 stage1 区域 223-4278，区域外 0）。
- 扩展 import 区（1-222）**未 import 任何新模块**；新模块当前是死代码。
- strip-extension.mjs / fix-imports.mjs 已写好但未运行。
- 新模块间存在**循环依赖**（model-config <-> model-routing-apply 等），但经主会话程序化核验：**无真实 TDZ 高危点**（跨环顶层 const 初始化均未引用环上对方模块的值，仅函数引用，hoisted 安全）。
- 剥离脚本会移除全部 118 个重复符号 → 扩展降至 ~4300 行。
