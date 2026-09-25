# jero-pi 项目设计文档

> 版本：v1.0（2026-09-15）
> 基线：gentle-pi v2.7.0 源码树（本仓库 `gentle-pi-main/`，`init` 分支）
> 状态：设计定稿待评审

---

## 1. 背景与动机

jero-pi 是 [gentle-pi](gentle-pi-main/) 的重构版。gentle-pi 是一个功能完整的 Pi coding-agent 原生扩展包（~11 万行 TS/MJS），但它的架构有一个结构性重负：**评审权威、SDD 原生状态与遥测投递全部外包给一个 postinstall 分发的 Go 二进制（gentle-ai v2.9.1）**。这条分发链带来了：

- 安装期网络下载（GitHub Releases / Go 源码构建）与双 SHA-256 钉住校验；
- 包私有 `.gentle-ai/` 运行时布局、安装锁、墓碑、完整性清单；
- 跨语言进程契约（`gentle-pi.review-relay/v1` 握手、`review-integration/v2` 信封协商）；
- 一大批只为维护这条边界的代码：installer、binary resolver、provider-contract 镜像、cross-lane 测试电池。

与此同时，gentle-pi 又**自研了若干生态里已有成熟插件的能力**（封闭选项询问、代码图工具、工具输出渲染），同时把另一些生态包（intercom/web-access/lens）当"可选伴生"做特征探测——两头都不彻底。

本设计将 jero-pi 定位为：**零原生二进制依赖、纯 Node/TypeScript、权威逻辑自持、生态能力靠调用而非复刻**的 Pi 扩展包。

## 2. 目标与非目标

### 2.1 目标

| # | 目标 | 验收方式 |
|---|---|---|
| G1 | 零原生二进制依赖：删除 postinstall 分发链，运行时不 spawn 任何 gentle-ai 进程 | `grep` 无 installer/binary-resolver 残留；packed-package 测试在断网环境通过 |
| G2 | 用 Node 进程内模块实现原 gentle-ai 二进制的全部职责（评审权威、SDD 状态/验证、审查提示渲染） | 权威一致性测试套件（以现有 vendored fixtures 为黄金向量）全绿 |
| G3 | 自实现持久记忆（替代 gentle-engram），满足 SDD 委派的记忆契约 | `mem_*` 工具可用；SDD 工件按 topic key 落盘并可检索 |
| G4 | 生态插件从"可选伴生"升级为强制依赖，删除自研的重复实现改为调用 | 依赖清单落地；`ask-user-choice`/`codegraph-tools` 等自有复刻删除 |
| G5 | 身份全量迁移 gentle→jero（命令、环境变量、路径、schema、包名） | 命名迁移表逐项核对；无 `GENTLE_PI_`/`gentle-pi.` 前缀残留 |
| G6 | 保留 gentle-pi 已验证的核心价值：shell 工作区、子代理编排、SDD/OpenSpec、fail-closed 纪律 | 对应测试族持续通过 |

### 2.2 非目标

- **不追求与 gentle-ai 二进制的互操作**：不保留双实现切换开关，不做 `/v1`/`/v2` 契约协商——对手方消失了，契约内化为内部协议。
- **不重写上游已稳定的子系统**：agents 编排（pi RPC 子进程）、shell UI、session-changes、todo、skill-registry、模型路由/profiles 原样保留（仅改名）。
- **不做增量兼容层**：不读取旧 `~/.pi/gentle-ai/` 配置、不支持旧 `GENTLE_PI_*` 环境变量。jero-pi 是新包，一次性切换。
- **不引入向量数据库/原生模块**：记忆检索用文件 + 轻量索引，保持零原生依赖承诺。

## 3. 总体架构

### 3.1 分层图

```text
┌─────────────────────────────────────────────────────────────────┐
│  Pi 宿主（@earendil-works/pi-coding-agent ≥0.85.1，peer 依赖）    │
├─────────────────────────────────────────────────────────────────┤
│  扩展层 extensions/*.ts（8 个文件）                               │
│    jero-ai(核心harness) · jero-shell · jero-agents               │
│    sdd-init · skill-registry · startup-banner ·                  │
│    jero-memory · runtime-metrics                                 │
│    （删除：ask-user-choice、codegraph-tools、quiet-tools、        │
│      pi-pretty 包装 → 由强制依赖插件承接）                         │
├─────────────────────────────────────────────────────────────────┤
│  领域层 lib/                                                     │
│    authority/   ← 新：进程内评审权威（原 Go 二进制职责的 Node 实现）│
│    memory/      ← 新：持久记忆存储与检索（原 gentle-engram 职责）  │
│    agents/  review/(传输层瘦身)  shell/  metrics/  sdd/  core/    │
├─────────────────────────────────────────────────────────────────┤
│  生态插件层（全部为 dependencies，直接调用）                       │
│    pi-tui · pi-pretty · pi-intercom · pi-web-access ·             │
│    pi-lens · pi-fovea · @juicesharp/rpiv-ask-user-question       │
├─────────────────────────────────────────────────────────────────┤
│  系统边界（仅剩这三类外部进程）                                    │
│    git（快照/事务/worktree） · gh（发布门CI查询，可选） ·          │
│    pi 自身（--mode rpc 子代理与审查员子进程）                      │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 与 gentle-pi 的结构性差异

| 维度 | gentle-pi | jero-pi |
|---|---|---|
| 评审权威 | 包内钉住的 Go 二进制，跨进程信封协商 | 进程内 `lib/authority/` 模块，内部 typed API |
| 安装 | postinstall 下载/构建二进制，双 SHA-256 | 纯 npm 安装，postinstall 仅（可选）写 tuiMode |
| 遥测 | 经二进制投递（端点不透明） | **删除外发遥测**；仅保留本地运行时指标 |
| 记忆 | 可选伴生 gentle-engram，特征探测 | 自实现 `lib/memory/` + `mem_*` 工具 |
| 封闭选项询问 | 自研 ask-user-choice + 监听第三方 blocked 事件 | 硬依赖 rpiv-ask-user-question |
| 代码图 | 自研 codegraph-tools 包装外部 CLI | 硬依赖 pi-fovea |
| 研究能力 | 按 4 个工具名做通用特征探测 | 硬依赖 pi-web-access，按其注册工具名准入 |
| 工具渲染 | quiet-tools 重注册内建工具 + pi-pretty 包装 | pi-pretty 全权承接；自留的只有权威生命周期卡 |
| 网络出口 | 安装期 GitHub/GoProxy、chatgpt.com 用量、二进制内遥测 | 仅运行时 chatgpt.com 用量面板（可选）与 pi-web-access 自身出口 |

## 4. 核心设计决策

| # | 决策 | 理由 | 代价与缓解 |
|---|---|---|---|
| D1 | **删除二进制分发链**：`scripts/install-gentle-ai.mjs`、`scripts/gentle-ai-installer.mjs`、`lib/gentle-ai-binary.ts`、`.gentle-ai/` 布局、dev-binary 通道、cross-lane 电池 | 这是"零原生依赖"的主链；旧 fork 的教训是先去分发化、后改名，避免改即将删除的代码 | 丢失"独立二进制不可被模型游说"性质 → 见 §9 信任模型 |
| D2 | **评审权威进程内化**：新建 `lib/authority/`，保留状态机、CAS、回执、fail-closed 语义，接口从"execFile + JSON 信封"改为"进程内 typed 调用" | 消除跨语言契约税；上游 TS 侧本就拥有 Git 投影、候选视图、锁等全部地基 | 语义漂移风险 → 用 vendored fixtures 作黄金向量锁定行为（§5.1.7） |
| D3 | **删除外发遥测**：`telemetry-trigger`、`runtime-metrics-native/policy/delivery` 整条 send 路径移除 | 无二进制则无投递通道；自建上报端点违背项目隐私边界（无累积记账原则） | `/jero:telemetry` 命令删除；本地指标保留供 agents 视图用量展示 |
| D4 | **自实现记忆 `lib/memory/`**，暴露 `mem_save`/`mem_read`/`mem_list` 工具 | 记忆是 SDD 委派契约的一等公民（父检索、子保存），不应是可选件 | 不做向量检索；topic key + 关键词索引即可覆盖 SDD 工件契约 |
| D5 | **伴生包强制依赖化**：pi-web-access、pi-lens、pi-fovea、rpiv-ask-user-question 进 dependencies，精确钉版（pi-intercom 经评审移除：单会话使用无对等通信需求，跨会话轴保持不建设） | "调用而非复刻"；特征探测的降级路径全部收敛为"装了就能用" | 供应链面扩大 → 钉精确版本 + 传递依赖审计进 CI（沿用 P2-B 审计脚本） |
| D6 | **删除自研复刻**：ask-user-choice、codegraph-tools、quiet-tools 重注册、sdd-research-capabilities 通用探测 | D5 的对偶面：有了强制依赖就不留双实现 | quiet-tools 的"gentle-ai 生命周期卡"渲染职责并入 jero 渲染器 |
| D7 | **契约内化**：`contracts/review-integration/v1+v2`、provider-contract 镜像与锁全部退役；fixtures 收编为内部黄金向量 | 对手方（外部 provider）不存在了，镜像注入系统提示的机制随之失去意义 | 上游"不可扩展信封"约束解除，schema 归我们所有，可演进为 `jero.authority/v1` |
| D8 | **身份迁移放最后**：命令 `/gentle:*`→`/jero:*`、`GENTLE_PI_*`→`JERO_PI_*`、`~/.pi/gentle-ai/`→`~/.pi/jero/`、schema 前缀、包名，全部在功能改造完成后一次性做 | 避免在持续变动的面上做全局改名（旧 fork 的直接教训） | 中间态文档明确标注"当前仍用 gentle 命名" |
| D9 | **保留**：agents 编排、shell 全家、session-changes、todo、skill-registry、模型路由/profiles、SDD/OpenSpec 文件流、危险命令守卫、发布门（git/gh） | 这些是纯 TS、无外部对手方、测试覆盖良好的资产 | 无 |

## 5. 子系统设计

### 5.1 jero-authority：进程内评审权威（原 Go 二进制职责）

#### 5.1.1 职责清单（从二进制接管）

原 `gentle-ai` 二进制经 execFile 承担的操作（见 `lib/native-review-cli.ts` 的操作表），逐一映射为 `lib/authority/` 的内部 API：

| 原二进制操作 | 新内部 API | 说明 |
|---|---|---|
| `review start` | `authority.review.start(target, selection)` | 冻结候选（base_tree/candidate_tree/changed_path_manifest） |
| `review status` / target status | `authority.review.status(target)` | `current_target/unrelated/ambiguous/corrupted` 判定与 next action |
| `review capture-*`（4 组） | `authority.capture.renderBinding(slot)` | 渲染自包含审查提示向量（原 provider 渲染） |
| `review reclaim/recover` | `authority.maintenance.reclaim/recover` | 破坏性恢复，仍走显式授权绑定 |
| `review abandon/quarantine-legacy/reconcile-authority/repair-legacy-alias` | `authority.maintenance.*` | 保持 N 行授权绑定 + 新鲜交互批准 + headless fail-closed |
| `review mode` | `authority.mode.get/set` | RDD 开关（仍仅 `/jero:review-mode` 用户显式） |
| `review assess` | `authority.risk.assess(diff)` | 只读风险评估 + 验证计划 |
| `review acknowledge-approved` / FINALIZE / VALIDATE | `authority.review.finalize/validate/acknowledge` | 透镜结果规范化、纠正预算、回执 |
| `sdd-status/sdd-attempt/sdd-continue` | `authority.sdd.status/attempt/continue` | 校验 `verify-report` 工件信封 |
| `telemetry *` | **删除** | 见 D3 |

#### 5.1.2 存储设计

沿用上游已验证的 CAS 模型，全部在 Pi 侧文件系统内：

```text
<repo>/.git/jero-review/          # Git common 目录下，与上游 authority-root 同位策略
  ├── objects/<sha256>/           # 内容寻址对象：快照、透镜结果、回执、审计记录
  ├── lineages/<lineage>/         # 血统状态（graph-v1 只读兼容可裁剪，见 5.1.6）
  └── locks/                      # 协作锁（包私有一致的锁语义，tombstone fail-closed）
```

- 哈希一律 `node:crypto` SHA-256；对象写入走 temp+rename 原子替换（复用 `~/.pi/jero/` 配置写入的既有原子写模式）。
- 幂等语义保留：同请求哈希重放返回既有结果；stale/语义重试、终态后再变更、同血统歧义一律 fail-closed。

#### 5.1.3 状态机（保留上游 compact 五态 + Judgment Day）

```text
普通线：reviewing → (correction_required → validating)*1 → approved | escalated
JD 线：仅显式请求启动；两盲审 + 零反驳者；至多两轮 discovery/re-judgment；round2 存活发现 → escalated
```

不变量原样继承：透镜只跑一次不重跑；冻结发现与创世范围不变；纠正恰一次且预算 `min(200, ceil(原始变更行/2))`；`testdata/golden/**` 计入快照身份不计入风险行；actor 输出（模型产物）永远是无信托数据，不能授权任何转移。

#### 5.1.4 审查员执行：host relay 保留，渲染器内化

`lib/review-host-relay.ts` 的架构价值独立于二进制——**不透明 Buffer→Buffer 适配器 + 精确 materialize/submission token + 体积推导超时（15min/MiB，上限 2h）**——全部保留。变化只有一处：审查提示向量（`review.capture-refuter/validation` 等）由 `authority.capture.renderBinding()` 在进程内渲染，而非二进制产出。审查员仍是锁定的 `pi` 子进程（`lib/opaque-pi-reviewer-adapter.ts`）。

#### 5.1.5 同意与会话常任权限

`consent/v3` 两选项 UI、进程内 WeakMap 常任授权（活 SessionManager 会话 + 规范 Git common-dir 摘要键）、fd3 子进程授权通道（`lib/review-session-standing-permission-ipc.ts`，schema 改 `jero.child-standing-review-permission/v1`）全部保留——这套机制本来就完全在 TS 侧。

#### 5.1.6 兼容性裁剪决策

上游为历史血统保留了 graph-v1 只读兼容与 legacy 维护路由（quarantine-legacy、repair-legacy-alias）。jero-pi 是新包、新存储命名空间（`jero-review/`），**不存在历史血统**：

- 保留 `abandon`（当前语义）与 `reconcile-authority`（仍有工程价值）；
- **删除** `quarantine-legacy`、`repair-legacy-alias`、graph-v1 只读路径与 `review-legacy-detector.ts`；
- 首次在含上游 `.git` 内权威数据的仓库上运行时，`status` 报 `foreign-authority-store` 并拒绝 START（fail-closed，不做迁移）。

#### 5.1.7 一致性测试：黄金向量策略

上游 `contracts/review-integration/v1+v2/fixtures/` 与 `tests/fixtures/devbinary/*.captured.json` 是从真实二进制捕获的信封样本——binary 删除后它们的价值反转：**从"必须逐字节一致的不可变区"变为"Node 实现的行为规格"**。

- 新建 `tests/authority/conformance/`：每个 fixture 断言 `lib/authority/` 对同等输入产出同构结果（字段级，不含二进制实现细节如时间戳）；
- unknown-key 拒绝解码的纪律保留为内部不变量测试（防权威模块被顺手加字段而不过契约评审）；
- 原 cross-lane 电池（需真实二进制）删除，其"控制器排序=权威 next step"类断言移植为进程内集成测试。

#### 5.1.8 验证信封

`gentle-ai.verify-result/v1` → **`jero.verify-result/v1`**（我们自有 schema）。`authority.sdd.attempt` 在进程内校验 `verify-report.md` 信封；外部校验器约束（新增字段被拒）随之解除，但信封演进走 schema 评审而非随手加字段。

### 5.2 jero-memory：持久记忆（替代 gentle-engram）

#### 5.2.1 存储模型

```text
~/.pi/jero/memory/                 # 全局记忆（默认）
<project>/.jero/memory/            # 项目记忆（存在即优先生效）
  ├── entries/<topic-key>.md       # 一条记忆一文件，topic-key 即文件名
  │     （frontmatter: saved_at, agent, session, phase, tags[]）
  └── index.json                   # 轻量索引：key → {mtime, tags,首行摘要}，写入时增量更新
```

topic-key 沿用 SDD 记忆契约的稳定键：`sdd/<change>/proposal|spec|design|tasks|apply-progress|verify-report`，另允许自由键。写入 temp+rename 原子替换，与配置文件同套工具函数。

#### 5.2.2 工具面（`extensions/jero-memory.ts` 注册）

| 工具 | 语义 |
|---|---|
| `mem_save` | `topic` + `content`（≤64 KiB），幂等覆盖同 key |
| `mem_read` | 按 topic 精确读 |
| `mem_list` | 按 glob/前缀/tag 列 key 与摘要 |
| `mem_search` | 关键词检索（index + 内容 grep，无向量） |

工具名保持 `mem_*` 形态：SDD 委派契约、orchestrator-memory 资产与 doctor 检测（`hasWritableEngramTool` 改名 `hasWritableMemoryTool`，判定 `mem_save` 或 `*.mem_save` 命名空间形态）零改动续用。

#### 5.2.3 委派契约（继承上游纪律）

- 父/orchestrator 独占检索，选中上下文注入子代理 prompt；
- 子代理在返回前保存重要发现/决策/修复/阶段工件；
- 记忆模式（memory/hybrid）下 SDD 工件双写文件与记忆；
- `Gentle Todo` 式的系统提示提醒不引入——记忆保存由 SDD 阶段资产约束，不做每轮唠叨。

### 5.3 生态插件集成矩阵（D5/D6 落地）

| 插件（钉精确版） | 承接的能力 | 删除的自研件 | 集成点 | 失效策略 |
|---|---|---|---|---|
| `@earendil-works/pi-tui` | TUI 地基（不变） | — | 全部 shell/视图模块 | 宿主级故障，无降级 |
| `@heyhuynhgiabuu/pi-pretty` | 工具输出渲染全权 | `quiet-tools.ts` 重注册、`pi-pretty.ts` 包装层（`PRETTY_DISABLE_TOOLS` 互操作不再需要） | 默认开启 | `JERO_PI_PRETTY=0` 关 |
| `@juicesharp/rpiv-ask-user-question` | 封闭选项询问工具 | `ask-user-choice.ts`、`native-choice-list.ts`（若无其他引用）、`rpiv:ask-user:blocked` 事件监听 | 直接使用其工具；评审同意 UI 是独立组件不受影响 | 依赖存在即用 |
| `pi-fovea` | 仓库代码图/符号地图（每次提示注入 repo map） | `codegraph-tools.ts` | 无需胶水；SDD explore 资产提示词中"如有代码图工具优先用之" | 依赖存在即用 |
| `pi-web-access` | web_search/source_check/fetch_content/get_search_content | `sdd-research-capabilities.ts` 的通用特征探测 | 研究准入改为：枚举 `pi.getActiveTools()` 中 pi-web-access 注册的四个精确工具名，全活跃才授 `open-web`，仅 `fetch_content` 授 `documentation`；MCP 网关与 Bash 兜底仍然禁止 | 缺工具 → 研究能力不授予，SDD 预检明示 |
| `pi-lens` | 编辑时语言感知快速反馈 | （无自研对应） | apply 阶段子代理可用；其反馈可作为 review-reliability 透镜的非权威辅证 | 不阻塞流程 |

**工具注册冲突纪律**（Pi 已知约束）：依赖插件承接 `bash/read/write/edit` 渲染后，jero-pi 自身**不得再注册同名工具**——quiet-tools 的删除同时消解了上游文档记载的 pi-tool-cards 冲突面。

### 5.4 遥测与指标（D3）

- 删除：`lib/telemetry-trigger.ts`、`lib/runtime-metrics-native.ts`、`lib/runtime-metrics-policy.ts`、`lib/runtime-metrics-delivery.ts`、`contracts/telemetry/`、`/jero:telemetry` 命令、`runtime/telemetry-trigger.mjs` 生成物。
- 保留：`lib/runtime-metrics.ts` + `runtime-metrics-children.ts`（进程内记账）→ 供 Agents 视图与 `/jero:usage` 面板的每任务用量展示；`CHILD_METRICS_EVENT` 子代聚合不变。
- `DO_NOT_TRACK`/`CI` 门控随删除自然消失（无外发即无门控需求）。
- 订阅用量面板（chatgpt.com usage 端点、复用宿主 OAuth token）保留：这是用户可见功能而非遥测，且本就是纯 TS。

### 5.5 安装与分发

```jsonc
// package.json（P5 终态）
{
  "name": "jero-pi",
  "scripts": {
    "postinstall": "node scripts/install-tui-mode-setting.mjs",  // 仅本地写设置，无网络
    "test": "node --experimental-strip-types --test tests/*.test.ts && pnpm run test:harness"
    // check:provider-contract、test:cross-lane、test:dev-binary 删除
  },
  "dependencies": {
    "@earendil-works/pi-tui": "0.85.1",
    "@heyhuynhgiabuu/pi-pretty": "0.6.14",
    "pi-web-access": "<pin>",
    "pi-lens": "<pin>",
    "pi-fovea": "<pin>",
    "@juicesharp/rpiv-ask-user-question": "<pin>"
  },
  "peerDependencies": {
    "@earendil-works/pi-coding-agent": ">=0.85.1"  // 去掉 optional：jero-pi 只在 Pi 内有意义
  }
}
```

- `install-tui-mode-setting.mjs` 保留但重定向识别路径到 jero-pi 的自有安装位置（npm/git 两处），锁 + 原子替换语义不变。
- `pi.image` 从 CDN 改为包内相对路径 `assets/jero-logo.png`（去 jsDelivr 外链）。
- prepack 校验脚本 `verify-package-files.mjs` 收窄：不再断言 `.gentle-ai/` 与 contracts 镜像，新增断言"打包产物不含 installer 与二进制相关文件"。
- **新增 CI 门**：`npm pack --dry-run` 产物 + 断网 `pnpm test`（`NODE_OFFLINE=1` 模拟，验证无任何安装期网络依赖）。

## 6. 模块处置映射表

按域汇总（`gentle-pi-main/` 现状 → jero-pi 终态）。**K=保留（改名）· P=改造 · N=新建 · D=删除 · R=由依赖替代**

| 域 | 模块 | 处置 | 备注 |
|---|---|---|---|
| 核心扩展 | `extensions/gentle-ai.ts` | P | 拆薄：评审工具改为调 `lib/authority/`；删除遥测/二进制公告/dev-binary 命令 |
| | `gentle-shell.ts` `gentle-agents.ts` `gentle-todo.ts` `sdd-init.ts` `skill-registry.ts` `startup-banner.ts` | K | 改名 + 命令前缀 |
| | `ask-user-choice.ts` `codegraph-tools.ts` `quiet-tools.ts` `pi-pretty.ts` | R | rpiv-ask-user-question / pi-fovea / pi-pretty |
| | `runtime-metrics.ts` | P | 去投递，仅本地记账 |
| | — | N | `extensions/jero-memory.ts` |
| 权威 | `native-review-cli.ts` `gentle-ai-binary.ts` `provider-contract-bundle.ts` | D | 职责由 `lib/authority/` 接管 |
| | `review-integration-v2.ts` | P | 收敛为 `lib/authority/protocol.ts`（内部信封 + 严格解码） |
| | `review-host-relay.ts` `opaque-pi-reviewer-adapter.ts` `review-relay-contract.ts` | P | 保留架构；渲染器内化；握手 env 删除 |
| | `review-snapshot/-transaction/-lock/-object-store/-repository/-canonical/-candidate-view(-owner)/-risk(-assessment)` | K/P | 锁与 CAS 工具函数被 authority 复用；owner/ACL（whoami/icacls）保留 |
| | `review-consent-*` `review-session-standing-permission(-ipc)` `review-correction-lifecycle` `review-reminder-receipt` `review-triggers` `review-last-event-controller` | K | schema 前缀改 jero |
| | `review-policy-ordinary/-judgment-day` `review-publication-gate` `review-graph-schema` | K | publication-gate 依赖 git/gh，与二进制无关 |
| | `review-legacy-detector.ts` `native-review-authority-quarantine.ts`（legacy 路由部分） | D | 见 5.1.6 |
| 编排 | `agents-*`（12 件）`orchestrator-presence` `agent-home` `agent-profiles` `model-routing-authority` `profiles-orchestrator` | K | 全部纯 TS |
| Shell | `shell-*`（14 件）`terminal-theme` `gentle-ai-renderer→jero-renderer` | K/P | 渲染器吸收生命周期卡职责 |
| 会话变更 | `session-change-capture/-changes` `session-worktree-registry` | K | 新增的本域，不动 |
| SDD | `sdd-preflight` `sdd-status` `openspec-deltas` `openspec-guardrails` | K/P | sdd-status 改调 authority.sdd |
| | `sdd-research-capabilities` | P | 收敛为 pi-web-access 工具准入（§5.3） |
| 指标 | `runtime-metrics-delivery/-native/-policy` `telemetry-trigger` | D | §5.4 |
| 契约/资产 | `contracts/**`（review-integration、镜像、telemetry） | D | fixtures 收编进 conformance 套件后删目录 |
| | `assets/**`（24 代理、4 链、support、orchestrator 文档） | K | 改品牌词；orchestrator-delegation 中"镜像 canon"段落重写为自有权威说明 |
| | `skills/**` `prompts/**` `themes/**` | K | 前缀 `gentle-ai-*`→`jero-*` |
| 脚本 | `install-gentle-ai.mjs` `gentle-ai-installer.mjs` `mirror-provider-contract.mjs` `check-provider-contract.mjs` `measure-native-authority-slimming.mjs` | D | |
| | `install-tui-mode-setting.mjs` `build-runtime-modules.mjs` `check-types.mjs` `verify-package-files.mjs` `test-packed-runner.mjs` | P | 路径/断言适配；runtime 生成集缩编 |
| 原生交互 | `native-choice-list` `native-fullscreen-interaction` `native-pointer-region` | K | choice-list 若被 R 后无引用则 D |

## 7. 依赖前后对比

| 层 | gentle-pi v2.7.0 | jero-pi |
|---|---|---|
| dependencies | pi-tui、pi-pretty（2） | pi-pretty、rpiv-ask-user-question、rpiv-todo、billion-context-pi、pi-cache-optimizer、pi-fovea、pi-hashline-edit-pro、pi-lens、pi-web-access（9，全钉版） |
| peerDependencies | pi-coding-agent（optional）、typebox | pi-coding-agent（必需，≥0.85.1）、pi-tui（shell/视图所需）；typebox 无需（ask-user-choice 删除后无引用） |
| 原生二进制 | gentle-ai Go v2.9.1（分发+运行时） | **无** |
| 系统进程 | gentle-ai、pi、git、gh、codegraph、whoami/powershell/icacls/tar、（Win 构建）go | pi、git、gh、whoami/powershell/icacls |
| 网络出口 | 安装期 GitHub Releases/GoProxy/SumDB、二进制内遥测、chatgpt.com 用量 | chatgpt.com 用量（可选功能）+ pi-web-access 自身运行时出口 |
| postinstall | 下载/构建/校验二进制 | 仅本地 tuiMode 设置写入 |

## 8. 命名与身份迁移（P5 一次性执行）

| 类别 | 旧 | 新 |
|---|---|---|
| 包名/目录 | gentle-pi / gentle-pi-main | jero-pi |
| 命令 | `/gentle:*`、`/gentle-sdd-*` | `/jero:*`、`/jero-sdd-*` |
| 环境变量 | `GENTLE_PI_*`（AGENT_HOME 继承 `PI_CODING_AGENT_DIR` 不变） | `JERO_PI_*` |
| 配置家 | `~/.pi/gentle-ai/` | `~/.pi/jero/` |
| 会话条目 | `gentle-pi.session-change/v1`、`gentle-pi.session-worktree/v1` | `jero.session-change/v1`、`jero.session-worktree/v1` |
| 协议串 | `gentle-pi.review-relay/v1`（**删除**，进程内无需握手） | — |
| | `gentle-ai.verify-result/v1` | `jero.verify-result/v1` |
| | `gentle-pi.child-standing-review-permission/v1` | `jero.child-standing-review-permission/v1` |
| | `gentle-pi.dev-binary/v1`、5×`gentle-ai.telemetry-*/v1` | **删除** |
| 存储 | `.gentle-ai/`（包内）、`.git` 内 authority store | `.git/jero-review/` |
| 技能/资产前缀 | `gentle-ai-*` | `jero-*` |
| 主题 | Gentle/Gentleman-* | Jero（文件名与变量名，视觉可延续） |

执行方式：一次性 `git mv` + 全局替换脚本（沿用 `_tools/migrate.mjs` 模式重建，跑完即删），随后 `pnpm test` + typecheck + 打包断言三重门。

## 9. 安全与信任模型

上游把"scope/risk/状态/回执/门"放进独立二进制的动机是**权威与编排的物理隔离**：模型 prose 无法直接说服一个它碰不到的进程。进程内化后这个物理边界消失，必须以工程纪律重建等价的逻辑边界：

1. **模块边界**：`lib/authority/` 不 import 任何 extensions/ 代码、不读环境变量做决策、不接受自由文本参数——入参全部是 typed 对象（`review-target`、`lens-slot`、`finding-row`），出全部是判别联合。CI 加 dependency-cruiser 规则强制该边界。
2. **模型输出仍是无信托数据**：`evidence_class/causal_disposition/proof` 校验、severe-only 进纠正 ID、malformed→escalated 的全部规则在 authority 内实现，与上游逐条对应（conformance 套件锁定）。
3. **威胁模型诚实声明**：上游明确"恶意同用户进程"本就非目标（它可替换扩展或本地权威）。进程内实现不改变该声明的真值；失去的仅是"模型侧实现 bug 被二进制挡住"这层意外保险，换取的是整个分发链攻击面的消失（安装期供应链、哈希清单替换、Windows 源码构建工具链）。
4. **fail-closed 纪律不变**：未知信封字段拒绝、headless 维护路由拒绝、权威存储异常拒绝 START、外源权威数据拒绝（§5.1.6）。
5. **新增攻击面评估**：9 个强制伴生依赖的供应链。缓解：全部钉精确版本、lockfile 进库、CI 复跑 P2-B 依赖审计（注入防护 + inlineScriptWrite 守卫沿用）、pi-pretty 维持禁 bundle 规则（传递原生可选依赖）。

## 10. 实施路线图

依赖顺序即风险顺序：先拆最重的分发链并让全部调用点 fail-closed（可独立验收），再逐域填 Node 实现，生态依赖与删除同步做，改名放最后。

| 阶段 | 内容 | 验收门 |
|---|---|---|
| **P0 基线** | 当前 `init` 分支工作树；跑通 `pnpm test` 记录基线红绿表（Windows 已知 3 挂起 + spawn/IPC 族失败单列） | 基线日志入 `_tools/` |
| **P1 去分发化** | D1：删 installer/binary/契约镜像/postinstall 网络；`native-review-cli` 全部操作改为抛 `authority-unavailable` 的适配层；删 cross-lane/dev-binary 测试与脚本 | `grep -r "gentle-ai-binary\|installer\|review-relay"` 零命中；断网 packed-package 测试过 |
| **P2 权威内化** | D2+D7：`lib/authority/` 全量（存储/状态机/渲染器/SDD 状态/维护路由/裁剪 legacy）；fixtures 收编 conformance 套件；`contracts/` 退役 | conformance 全绿；评审集成测试（START→FINALIZE→VALIDATE、consent、纠正、abandon）进程内跑通 |
| **P3 记忆** | D4：`lib/memory/` + `extensions/jero-memory.ts` + doctor/SDD 委派接线 | 记忆工具单测 + SDD hybrid 模式集成测试 |
| **P4 生态依赖化** | D5+D6+D3：依赖入 package.json；删 ask-user-choice/codegraph-tools/quiet-tools/pi-pretty 包装/遥测路径；research 准入收敛 | 工具注册冲突扫描（无同名 bash/read/... 注册）；受影响测试族改写后全绿 |
| **P5 身份迁移** | D8：§8 全表执行；包更名 jero-pi；README/docs 重写 | 三重门：`pnpm test` + typecheck + 打包断言；命名残留 grep 零命中 |

每阶段独立提交、独立可回滚；P2 是唯一的大体量阶段，内部再按 5.1.1 表的 API 分组切成 6 个可验收的子里程碑（存储→状态机→渲染→SDD→维护→conformance 收尾）。

## 11. 风险与开放问题

| # | 风险/问题 | 等级 | 处置 |
|---|---|---|---|
| R1 | 权威语义 reimplement 漂移（上游二进制行为未被 fixtures 完全覆盖的暗角） | 高 | conformance 先行：P2 第一个子里程碑就是把 fixture 覆盖率提上来，缺口用上游文档条款（readme-reference 的 FINALIZE/纠正/JD 规则）转成显式测试 |
| R2 | 失去独立二进制信任锚 | 中 | §9 纪律重建 + 威胁模型声明；社区评审 conformance 套件 |
| R3 | 9 个强制伴生依赖的供应链与版本漂移 | 中 | 钉版 + lockfile + CI 审计 + 发布龄期/信任不降级策略；升级走单独 PR 全量测试 |
| R4 | pi-web-access 有偿 API（约 $0.012/请求的社区反馈） | 低 | 研究能力保持 SDD 显式授予制（预检确认），不默认自动调用 |
| R5 | Windows 环境已知测试挂起（上游同样存在） | 低 | 基线红绿表单列，不算回归；P2 后复评是否顺带修复 |
| Q1 | gentle-todo 是否也按"调用优先"换回 `@juicesharp/rpiv-todo`？ | 已裁决（2026-09 实现更新） | **jero-todo 已退役，切换 `@juicesharp/rpiv-todo`**：与"零自研复刻、生态件强制依赖化"的 G4 方向保持一致，随 P4 生态切换一并执行 |
| Q2 | `orchestrator-presence`（心跳存在发布）是否改筑于 pi-intercom？ | 已裁决 | **pi-intercom 已移除**（单会话使用无对等通信需求）；presence 维持只读启发式现状，跨会话轴不建设 |
| Q3 | 订阅用量面板（chatgpt.com 出口）是否保留？ | — | 默认保留（用户可见功能）；若你要"绝对零外部 HTTP"可 P4 顺手删，`shell-usage*` 独立好删 |

## 12. 附录

### A. 被删除的外部契约（终态核对清单）

`gentle-pi.review-relay/v1` · `gentle-ai.verify-result/v1`→改 `jero.verify-result/v1` · `gentle-ai.telemetry-{trigger,status,policy,runtime-send,runtime-aggregate}/v1` · `gentle-pi.dev-binary/v1` · `gentle-ai.review-integration/v2`（内化为 `jero.authority/v1`）· `gentle-pi.review-provider-contract-mirror-lock/v1`

### B. 保留并改名的契约

`jero.session-change/v1` · `jero.session-worktree/v1` · `jero.child-standing-review-permission/v1` · `jero.background-subagents/v1` · `jero.agent_model_profiles/v1` · `jero.sdd-preflight`（传输块） · SDD 资产哈希所有权清单（`assets/migrations/` 重建为 jero 命名空间）

### C. 本文档引用的上游事实来源

评审权威/维护路由/FINALIZE 契约：`gentle-pi-main/docs/readme-reference.md`；shell/agents/todo 行为：`docs/gentle-shell.md`；操作表与调用点：`lib/native-review-cli.ts`、`lib/gentle-ai-binary.ts`、`scripts/gentle-ai-installer.mjs`；能力总表：`docs/readme-reference.md` Capability reference。
