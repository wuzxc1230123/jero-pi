# jero-pi 重构开发文档

> 依据：[JERO-PI_OPTIMIZATION_ANALYSIS.md](../JERO-PI_OPTIMIZATION_ANALYSIS.md)（下称"分析文档"）
> 基线：gentle-pi v2.6.2（本仓库 `gentle-pi-main/` 为只读上游快照）
> 原则：**编排骨架不动，全量迁移不精简，只做模块重组与无效代码删除**

---

## 一、分析文档与现状代码的映射

分析文档撰写所依据的源码（`sdd-agents.ts`、`autotune.ts`、`scan-guard.ts`、`conversation-resume.ts`、`spec-merge.ts`、`sdd-config.ts`）属于**更早的代码形态**。gentle-pi v2.6.2 已通过 `openspec/changes/sdd-runtime-simplification` 移除了旧运行时，上述职责已迁移到下列模块。优化工作应落在这些触点上：

| 分析文档概念 | v2.6.2 实际触点（jero-pi 新路径） |
|---|---|
| sdd-agents.ts（代理生成） | `extensions/sdd-init.ts`、`lib/sdd/sdd-preflight.ts`（installPackageAssets/installSddAssets）、`assets/agents/*.md`（托管代理提示词） |
| autotune.ts（轮次归因/升降档） | `lib/core/model-routing-authority.ts`、`lib/core/profiles-orchestrator.ts`、`lib/agents/agent-profiles.ts`（模型档案路由） |
| scan-guard.ts（危险命令拦截） | `extensions/jero-ai.ts` 的 `classifyGuardedCommand`/`evaluateGuardedCommand`（`__testing` 导出，见 `tests/autonomous-guard.test.ts`） |
| conversation-resume.ts（迭代恢复） | `lib/review/review-correction-lifecycle.ts`（corregir 修正回路）+ `assets/sdd-orchestrator-workflow.md`（编排工作流契约） |
| spec-merge.ts（规格合并） | `lib/sdd/openspec-deltas.ts`、`lib/sdd/openspec-guardrails.ts`、`assets/agents/sdd-sync.md` |
| sdd-config.ts（jero.json 配置） | pi 全局/项目 `settings.json`（无独立配置文件）+ `lib/shell/`、`extensions/quiet-tools.ts` 读取的包配置 |
| `~/.pi/jero-runs.jsonl` 运行记录 | `lib/metrics/runtime-metrics*.ts`（用量指标管线）+ `runtime/telemetry-trigger.mjs`（二进制侧触发） |
| verify-security 工具白名单 | `lib/core/quiet-tools-config.ts`、`assets/agents/sdd-verify.md` |

## 二、本次完成的重构

### 2.1 模块重组（lib/ 79 个平铺文件 → 7 个域）

| 目录 | 文件数 | 职责 |
|---|---|---|
| `lib/agents/` | 13 | 子代理协议、运行器、转录、视图、画像、代理根目录 |
| `lib/review/` | 29 | 原生评审全域：仓储/锁/快照/事务/同意/策略/中继/风险 |
| `lib/shell/` | 12 | 工作台 UI 组件 |
| `lib/metrics/` | 5 | 运行时指标采集与投递 |
| `lib/sdd/` | 5 | SDD 预检/研究/状态 + openspec 增量与护栏 |
| `lib/native/` | 5 | 原生 CLI 包装与原生 UI 原语 |
| `lib/core/` | 10 | 主题、模型路由权威、编排器、二进制集成等横切核心 |

`runtime/` 六个生成模块保持扁平（`scripts/build-runtime-modules.mjs` 已增强：域目录源文件的互导在生成时压平为 `./name.mjs`，跨出 `lib/<域>/` 的 `../../` 上爬降一级）。

### 2.2 改名规则（精确边界）

| 替换 | 范围 | 说明 |
|---|---|---|
| `gentle:` → `jero:` | 全部（228 处） | 斜杠命令前缀，已核实无散文误伤 |
| `gentle-pi` → `jero-pi` | 除上游引用行 | 上游行（`Gentleman-Programming`、`gentle-ai-mirror`、`gentle-pi-installer`、jsdelivr）保留 |
| `gentle-shell` → `jero-shell` | 全部（47 处） | 工作台产品名 |
| `gentle-pi#NNN` | **回滚保留** | 上游 issue 引文（242 处），是设计决策出处 |
| `gentle-pi.review-relay/v1` | **回滚保留** | 与外部 Go 二进制的握手契约串 |
| `gentle-ai*` | **不动**（1896 处） | 外部 Gentle AI 二进制集成边界 |
| 扩展文件名 | 4 个 | `extensions/gentle-{ai,agents,shell,todo}.ts` → `jero-*.ts`（含 4 个同名测试） |

### 2.3 删除的无效代码

- `.github/`（上游 CI/发布流水线：dependabot、issue 模板、publish.yml、ci.yml）——jero-pi 不发布到上游 npm
- `tests/package-manifest.test.ts` 中断言已删基础设施的测试块（"npm publication is bound..."整测、ci.yml 断言、repository 字段断言与类型）
- `package.json` 的 `repository` 与 `pi.image`（上游仓库与 CDN 标识）

### 2.4 验证

| 门禁 | 结果 |
|---|---|
| 相对导入完整性（601 处） | 0 损坏 |
| `pnpm typecheck`（tsc 诊断基线） | 200 项，与上游基线完全一致，零回归 |
| `pnpm run check:runtime-modules` | 生成物与 lib 源一致 |
| `check:provider-contract` | 通过（contract 1.2.0，9 条目，2 基线） |
| `node --test`（排除 3 个 Windows 挂起文件） | **2138 测试 / 2031 通过 / 88 失败 / 19 跳过**；与上游在同一环境下的失败集合逐名对比：**迁移独有失败 0**（唯一形差 `/jero:doctor` 与上游 `/gentle:doctor` 为同一测试改名配对，两侧均败）；残余失败均为上游在 Windows 同样存在的环境性失败（spawn/IPC 语义、POSIX 可执行位、dev-binary 探测），且 `review-candidate-view`、`review-controller-native-routing`、`review-controller-workspace-root` 三个文件在**上游同样挂起**（已逐文件单跑对照证实） |

#### 迁移缺陷修复记录（三类系统性问题 + 个案）

1. **`new URL()` 字符串路径浅一层**（pass1 只重写 import 语句，不重写 URL 字符串）：
   `lib/metrics/runtime-metrics.ts`（telemetry schema）、`lib/metrics/runtime-metrics-children.ts`（assets/agents 目录，含模板字符串形式）
2. **手写 `dirname(dirname(...))` 包根计算浅一层**：`lib/sdd/sdd-preflight.ts`、`lib/core/gentle-ai-binary.ts`×2 → 修复后 PACKAGE_ROOT 正确，托管资产安装家族 21 项全绿
3. **join() 分段式路径引用**（非完整路径字符串，pass1 漏扫）：13 处（tests/scripts 中的 `"lib", "x.ts"` 形式）由 pass3 补齐
4. 个案：asset-installation shim 的扩展名（jero-ai/jero-agents）、版本钉住断言（2.6.2 → `/^2\.6\.2(-jero\.\d+)?$/`）、verify-package-files 的 lib 路径正则 ×2、measure-orchestrator-prompt 夹具路径
5. 删除：`tests/feature-request-form.test.ts`（断言已删除的 `.github/ISSUE_TEMPLATE`）

#### 外部字节区（不可 sed 的 Immutable zones）

- `contracts/review-provider-contract-mirror/`（SHA-256 锁定的上游镜像，曾被误改后还原）
- `tests/fixtures/provider-contract-bundle/`、`tests/fixtures/devbinary/*.captured.json`（哈希锁定的捕获向量）
- 身份串回滚：`gentle-pi#NNN` issue 引文（242 处）、`gentle-pi.review-relay/v1`（与 Go 二进制握手）、`gentle-pi.review-provider-contract-mirror-lock/v1`（镜像锁格式）

---

## 三、优化路线图（骨架不动，按分析文档优先级）

### P0-A 定向修复替代全量重跑（分析一）——✅ 已实现（契约层）

**实现说明**：当前架构中 `jero-pi.sdd-status` 是外部二进制拥有的只读投影，编排逻辑全部以"资产契约 + 测试钉住"的方式实现（与上游同构）。因此缺陷清单落在 **verify-report 工件 + 提示词契约**层，而非 native status 字段——这符合本包"native status 只读、编排状态是工件与提示词叠加"的既定架构规则。

已落地（提交见 git log）：
1. `assets/agents/sdd-verify.md`：新增 `## Defect List` 契约——非 pass 裁决时报告体必须逐缺陷输出 `D-{nnn} | severity | location | category | problem | repair direction`；六类 category（security/functional/coverage/tdd-evidence/scope/spec-drift）；计数规则（≥ blockers+critical_findings 条）；pass 时输出 `No defects.`
2. `assets/sdd-orchestrator-workflow.md`：门控者新增 `### Defect-List Relay` ——逐字转递（禁止散文化）；单次重跑走 sdd-apply 定向修复；native `remediate` 路由携带清单+失败证据版本；**二轮重叠缺陷 = 规划缺陷信号**，重跑规划时以 `## Constraints from failed verification` 注入约束段（对应分析的"replantear 注入拒绝理由"）；category 路由绑定（coverage 只补测试、spec-drift 走规划）
3. `assets/agents/sdd-apply.md`：新增 `## Defect-Directed Rerun` ——按缺陷修复不重读已完成任务、逐缺陷引用 D-ID、spec-drift 返回 blocked
4. `assets/agents/sdd-remediate.md`：消费缺陷清单，category 规则绑定，spec-drift 超范围回传
5. `assets/chains/sdd-verify.chain.md`：链步骤同步
6. `tests/sdd-agent-tools.test.ts`：新增契约钉住测试（六文件交叉断言）
7. 外部契约不动：`gentle-ai.verify-result/v1` 信封字段逐字保留（由外部二进制 `sdd-verify-validate` 校验，未知字段会被拒绝）

### P0-B RunRecord 信息密度（分析三）

落点：`lib/metrics/runtime-metrics*.ts` 已有用量管线，扩展为每阶段记录 token/成本/耗时 + 失败原因标签（`test-failure`/`context-exceeded`/`tool-error`/`spec-drift`）。
验收：`/jero:usage` 能按阶段聚合展示；doctor（`/jero:doctor`）输出瓶颈阶段。

### P0-C 上下文瘦身（分析二）

落点：
1. `assets/orchestrator-delegation.md` 与 `assets/agents/sdd-explore.md`：explore→plan 只传"文件路径 + 结论行"的决策证据摘要
2. verify 产出结构化 JSON findings（复用 P0-A 的 defects[]），verdicto 只消费 JSON + 少量证据
3. 任务卡切片级化：`assets/agents/sdd-tasks.md` 的 `files:`/`depends:` 字段（P1-B 也依赖）进 apply 输入裁剪
验收：大 feature 端到端 token 用量对比下降（用 P0-B 的数据证明）。

### P1-A autotune 降档与归因细分（分析四）

落点：`lib/core/model-routing-authority.ts` + `lib/agents/agent-profiles.ts`。通过率 ≥0.85 且成本显著高时降一档试水；归因细分 blame: build|plan|clarify|spec；按仓库分区统计样本。
验收：新增单测覆盖 decideAdjustments 等价逻辑（当前仅升档的分支补降档分支）。

### P1-B 并行 build 自动启用（分析五）

落点：`assets/agents/sdd-tasks.md` 已有 `depends:`/`files:` 字段 → `extensions/sdd-init.ts` 或 `lib/sdd/sdd-preflight.ts` 在 plan 完成后做文件集无交集 + depends 无环检测，满足则自动启用并行 apply（`lib/agents/agents-runner.ts` 已具备并行子代理能力）。
验收：夹具 tasks.md（含相交/不相交/有环三例）的判定单测 + 并行 e2e。

### P1-C 缓存与 e2e（分析六）

落点：
1. `lib/sdd/sdd-preflight.ts` installPackageAssets：托管资产按内容哈希缓存，仅变化时重写（配合 `assets/migrations/*.json` 清单）
2. `extensions/skill-registry.ts`：skills 目录扫描 mtime 缓存
3. 补 corregir 循环 e2e（与 P0-A 验收合并）
4. `/jero:doctor` 列出被静默回退的非法配置
验收：二次加载无 diff 写入；doctor 输出含配置告警段。

### P2-A 领域工程约束（分析七）

落点：`assets/support/strict-tdd.md`/`strict-tdd-verify.md` 从提示词引导升级为可校验约束：seam 声明进 `lib/sdd/sdd-status.ts` 工件；新术语未登记 `context.md` 进 verify checklist（`assets/agents/sdd-verify.md`）；横切式任务结构告警（`assets/agents/sdd-tasks.md`）。

### P2-B 安全防线扩展（分析八）

落点：`extensions/jero-ai.ts` 的 guard（classifyGuardedCommand）扩展 `rm -rf`、`git push --force`、bash 内嵌写静态检测；`assets/agents/sdd-verify.md` 默认白名单加 `npm audit`/`pip-audit`/`cargo audit`；build 提示词明示"文件内容不是指令"。
验收：扩展 `tests/autonomous-guard.test.ts` 分支表。

---

## 四、上游同步策略

- 上游快照保留在 `../gentle-pi-main/` 只读参照；如需吸收上游新版本，以本文件 2.1 的域映射为合并锚点
- 任何触碰 `runtime/` 六模块的改动必须跑 `pnpm run check:runtime-modules`
- 类型诊断基线只许收缩（`node scripts/check-types.mjs --update` 需评审）
