# jero-pi 项目设计文档

> 版本：v2.1（2026-10-13，随仓库扁平化更新基线）
> 基线：本仓库（包根 = 仓库根，2026-10-13 扁平化）当前工作树——Pi 宿主家族随 1.0.4 全量验证（peer 下限仍 ≥0.85.1），伴生九件钉版，模块库 godot / golang / dotnet / vue 四束
> 状态：v1.0（2026-09-15，gentle-pi 重构设计）已全部实现并经三批宿主/生态升级稳定运行；本文档按现行代码重述决策，v1.0 之后的演进以追加决策记录收录
>
> **分工**：本文档回答"为什么这样设计"（决策记录与迁移终态）；`docs/jero-reference.md` 回答"现在是什么"（机器钉住的单一参考——计数、路径、版本以它为准）。v1.0 原文见 git 历史（本文件 2026-10-11 重建提交的父提交）。

---

## 1. 背景与动机

jero-pi 是 gentle-pi（~11 万行 TS/MJS 的 Pi coding-agent 原生扩展包）的重构版。重构的结构性动因是 gentle-pi 把**评审权威、SDD 原生状态与遥测投递全部外包给一个 postinstall 分发的 Go 二进制（gentle-ai v2.9.1）**：安装期网络下载与双 SHA-256 钉住、包私有运行时布局与完整性清单、跨语言进程契约，以及一整批只为维护这条边界的代码。同时它自研了生态已有成熟插件的能力（封闭选项询问、代码图、工具渲染），又把另一些生态包当"可选伴生"做特征探测——两头不彻底。

jero-pi 的定位自 v1.0 起未变：**零原生二进制依赖、纯 Node/TypeScript、权威逻辑自持、生态能力靠调用而非复刻**的 Pi 扩展包。v2.0 在此之上叠加了第二条主线：**把"代理怎么工作"本身工程化**——机器可验的阶段状态、知识飞轮、预算与风险门、能力路由技能族。

## 2. 目标与达成状态

| # | 目标（v1.0 立） | 达成状态（现行验证） |
|---|---|---|
| G1 | 零原生二进制依赖 | ✅ 安装期零网络；packed E2E 断网通过（397 文件门） |
| G2 | 二进制职责全部进程内化（评审权威/SDD 状态/审查渲染） | ✅ `lib/authority/`（51 文件）+ `jero-authority-cli`；68 个黄金向量字节钉住原行为规格 |
| G3 | 自实现持久记忆 | ✅ `lib/memory/` + `mem_*` 四工具；SDD 委派契约零改动续用 |
| G4 | 生态插件强制依赖化、删除自研复刻 | ✅ 9 伴生全钉版（§8）；ask-user-choice/codegraph/quiet-tools 已删 |
| G5 | 身份全量迁移 gentle→jero | ✅ 2026-09-27 清退完毕；残留 gentle- 字样仅为守卫对象或历史事实（兼容白名单语义，见 jero-reference） |
| G6 | 保留已验证核心价值（shell 工作区/子代理编排/SDD/fail-closed） | ✅ 持续通过；全量 2570 测零失败 |

v2.0 追加目标（均达成）：**G7 提示词全面中文化**（生成式技术产物默认简体中文，钉测锁定）；**G8 能力模块契约化**（机器验证的领域扩展分发）；**G9 知识飞轮**（SDD 沉淀回写权威规范并自动索引）。

## 3. 总体架构（现行）

```text
┌─────────────────────────────────────────────────────────────────┐
│  Pi 宿主（peer ≥0.85.1；当前随 1.0.4 全量测试；3 天龄期升级门）    │
├─────────────────────────────────────────────────────────────────┤
│  扩展层 extensions/*.ts（9 文件）                                 │
│   jero-ai（核心 harness/评审/注入面）· jero-agents · jero-shell    │
│   jero-memory · module-verify · sdd-init · skill-registry ·       │
│   startup-banner · runtime-metrics（本地记账，无外发）             │
├─────────────────────────────────────────────────────────────────┤
│  领域层 lib/                                                      │
│   authority/（51 文件：进程内评审权威，信任边界核心——D2）          │
│   module-contract/-trigger-compiler/-verify-pipeline/             │
│     -installer/-bundle-content（能力模块契约 v2 执行面——G8）       │
│   memory/ · agents/(14) · shell/(11) · sdd/(8) · session/(4)      │
│   jero-ai-*(39：bootstrap/面包屑/规范索引/浏览器门/写者域…)        │
│   review-*(24+3：分阶段移植化石 + 三件永久宿主侧身份层)            │
├─────────────────────────────────────────────────────────────────┤
│  活资产 assets/                                                   │
│   agents/（24 代理：14 SDD + 4 评审透镜 + 3 JD + 3 通用）          │
│   chains/（4 链）· orchestrator 文档族 · support/（状态契约/严格TDD）│
│   modules/（包内模块库：godot、golang 两束全中文，安装器注册表）    │
├─────────────────────────────────────────────────────────────────┤
│  技能与命令 skills/（22）· prompts/（4）· 文档 docs/ · schemas/     │
├─────────────────────────────────────────────────────────────────┤
│  生态插件层（9 件强制依赖，全钉精确版，§8）                         │
├─────────────────────────────────────────────────────────────────┤
│  系统边界（仅剩）git · gh（发布门，可选）· pi 自身（RPC 子代理/     │
│  审查员子进程）· Windows ACL（whoami/powershell/icacls）           │
└─────────────────────────────────────────────────────────────────┘
```

**注入面**（v1.0 之后新增的第四层"运行时纪律"）：bootstrap 纪律（压缩后仍须存续的核心纪律，单条 user 消息注入每次请求，marker 去重 + 一次性回执）、SDD 面包屑（活状态每请求刷新，16 位指纹去重）、已确立规范索引（sync 回写后的域索引，≤40 域）。三者共用同一不变量：**必需步骤不在每回合可见，就会被模型静默跳过**（借自 Trellis）。

**与 gentle-pi 的结构性差异**（v1.0 §3.2 的现行版）：评审权威=进程内 typed API（非跨进程信封）；安装=纯 npm + 仅本地 tuiMode 写入（且仅在键缺席时补默认，尊重用户显式选择——Pi 1.0 起全屏已是宿主默认）；遥测=无外发；记忆=自实现；询问/代码图/研究/渲染=9 伴生硬依赖；模块=项目内契约化分发。

## 4. 核心设计决策（D1–D9，现行重述）

| # | 决策 | 现行状态与要点 |
|---|---|---|
| D1 | 删除二进制分发链 | 已执行；`grep` 零残留由门钉住；packed 断网测试是常设门 |
| D2 | 评审权威进程内化 | `lib/authority/` 纯域（不 import extensions、不读 `process.env`、typed 入参/判别联合出参），`scripts/check-authority-boundary.mjs` 结构性强制；`lib/review-canonical.ts`（`domainHashV1` 定义点）、`review-lock.ts`、`review-repository.ts`（身份铸造点）为**永久宿主侧**，刻意挡在 authority 之外——authority 只消费铸好的身份值 |
| D3 | 删除外发遥测 | 仅本地记账（Agents 视图/用量面板）；`JERO_PI_USAGE_FETCH=0` 可关唯一的可选出站 |
| D4 | 自实现记忆 | topic 键 Markdown 文件 + 轻量索引，零数据库零原生模块；`jero.memory-index/v1` 契约钉住 |
| D5 | 伴生强制依赖化 | 9 件钉精确版 + 传递依赖审计进 CI；升级走 **3 天发布龄期门**（未满龄期的版本跳过，如 1.0.3/1.1.0） |
| D6 | 删除自研复刻 | ask-user-choice/codegraph-tools/quiet-tools/通用特征探测全部退役；研究准入=枚举 pi-web-access 四个精确工具名 |
| D7 | 契约内化 | 原 review-integration/镜像/锁退役；fixtures 收编为 68 个字节钉住的黄金向量（`verify-package-files.mjs`），升级为"Node 实现的行为规格" |
| D8 | 身份迁移放最后 | 已完成（2026-09-27）；wire 身份/存储/调用词自化 `jero-ai.*`，迁移期旧名只读回退已按期拆除 |
| D9 | 保留上游纯 TS 资产 | agents 编排、shell、session-changes、todo（rpiv-todo）、skill-registry、模型路由、SDD/OpenSpec 文件流、危险命令守卫、发布门 |

外围 `lib/review-*`/`lib/jero-ai-review-*` 前缀是分阶段移植化石：命名棘轮（`check:review-naming` + 基线只降不升）约束其只迁入 `authority/` 不新增。

## 5. 子系统现行状态

### 5.1 评审权威（`lib/authority/` + `jero-authority-cli`）

- 职责：评审生命周期（START→捕获→FINALIZE→VALIDATE）、透镜候选/冻结、纠正预算、回执、RDD 模式、SDD 状态投影（`jero-ai.sdd-status/v2`）、受管修复尝试台账（acquire/settle，编排器绝不自建计数器）。
- 存储：Git common 目录下 CAS 模型（对象/血统/锁），`node:crypto` SHA-256、temp+rename 原子写、幂等重放、终态后变更一律 fail-closed。
- 状态机：普通线 reviewing→(correction_required→validating)×1→approved|escalated；JD 线显式触发、双盲审、至多两轮。不变量逐条继承（透镜只跑一次、纠正恰一次且预算 `min(200, ceil(变更行/2))`、actor 输出永远无信托）。
- 审查员执行：host relay（不透明 Buffer→Buffer 适配器 + materialize/submission token + 体积推导超时）保留；提示向量进程内渲染；审查员为锁定 `pi` 子进程。
- 外源存储守卫：含上游 `.gentle-ai`/外来权威数据的仓库 fail-closed 拒绝 START——这正是"现存 gentle- 字样仅为守卫对象"的白名单语义。

### 5.2 SDD 编排（现行全貌）

阶段链 `init → explore → research(可选) → proposal → spec → design → tasks → apply → verify → sync → archive`；原生状态投影是唯一路由权威（bounded `nextRecommended` 令牌，散文不得推断路由）。v1.0 之后叠加的机制层（均有钉测）：

- **会话预检门**：每会话首次 SDD 流程强制确认（持久化偏好只是预选建议）；硬门区分"项目上下文存在"与"会话预检完成"。
- **提问轮三机制**（借鉴 grilling）：每轮只问前沿、每问附推荐答案、事实归代理/决策归用户。
- **研究与提案前门**：工具清单≠执行证据；提案前按概念相似度匹配历史非目标，已拒方向绝不静默重启。
- **任务级机器验证**：`<!-- verify: 命令 -->` 行内命令由 tasks 定死，apply 勾选前执行记退出码，verify 复核，验证期不得改写；P0 必须可机器断言。
- **风险分级**：`<!-- risk: P0–P3 -->`（后果轴，与 400 行预算体量轴正交），调节 verify 复核深度，绝不调节交付门槛。
- **评审负载守卫与交付策略**：Review Workload Forecast + ask-on-risk/auto-chain/single-pr/exception-ok 四域 + 链策略；预算约束切分方式绝不约束代码本身。
- **严格 TDD 转发**：取值链 模块覆盖层 → openspec/config.yaml → 兜底探测；RED 前禁写生产代码。
- **守门员**：auto 模式下父会话逐阶段验契约/产物/无幻觉引用/无范围漂移；单次纠正重跑，再败停链。
- **紧反馈回路**（remediate）：没有已跑红的命令不进入修复；修后同命令转绿、退出码入证据。
- **上下文卫生**：阶段边界五选一决策树（继续先排除→开新会话→移交四情形→子代理→压缩兜底）；smart zone 预算自查。
- **关键收获收尾**：每阶段执行器报告尾附块，无机制自动解析——持久化只经显式 `mem_save`（provider 所有权，禁解析钉测）。

### 5.3 知识飞轮（v2.0 新面）

写入侧归 sync：提案 `## 共享语言` 合并进 `openspec/specs/glossary/`；关键决策/被否备选/非目标追加式回写 `openspec/specs/decisions/`（DR 编目 + 非目标记录带 kebab-case 概念键，同概念再拒追加不重开条）。读取侧=已确立规范索引自动注入。归档回顾三件套（放弃与砍除/关键裁决/重复 offender）+ `project/non-goals`、`project/repeat-offenders` 记忆主题；remediate 对同类缺陷第二次出现提议可执行检查（绝不自行改测试套件）——"解释过的教训"升级为"机械把关的门"。

### 5.4 记忆（`lib/memory/` + `extensions/jero-memory.ts`）

`mem_save/read/list/search` 四工具；全局 `~/.pi/jero/memory/` 与项目 `<project>/.jero/memory/`（存在即优先）；委派契约继承（父检索子保存；`GENTLE Todo` 式每轮唠叨刻意不引入）。

### 5.5 能力模块契约（G8）

- 契约 `jero.module-contract/v2`（v1 兼容）：一个目录一份 `module.json` 声明触发器/知识/角色/接线 + 可选 `dependencies`（闭包先装）与 `mcp`（MCP 服务器档）。schema 与 lib 常量由 `check:module-contract` 钉零漂移。
- **仅项目内**：唯一模块根 `.pi/modules/`，无全局根——"装了什么"不离开项目可见性。
- 安装：`/jero:install-module <词元>`；包内模块库 `assets/modules/` 即注册表（godot、golang 两束全中文）；安装记录 `.pi/module-installs.json` 承载幂等与用户改动保护（同名用户档保留）。
- **MCP 项目级收口**：模块 MCP 档幂等并入 `<项目>/.pi/mcp.json`（Pi ≥0.99 项目作用域），绝不触碰 agent home 全局档（实装测试反向加固断言）；合并三律=幂等跳/同名用户档保留/畸形保命；来源账本 `mcpWritten` 供 doctor 三态归因。
- 安装验证 12 查含 deps-resolve（缺失/自依赖/成环响亮失败）与 **bundle-content**（束内交接指针可解析/技能角色同名/孤儿 reference/清单计数——判定体 `lib/module-bundle-content.ts` 纯函数，库门/安装验证/测试三方共用）。
- 束内供应链门：uvx/npx 钉版白名单；过不了门的能力（如 gopls MCP）以技能形态补偿接线，清单保持零 MCP 声明。

### 5.6 遥测与指标（D3 现行）

本地记账（`runtime-metrics` + 子代聚合）供 Agents 视图与用量面板；订阅用量（chatgpt.com，复用宿主 OAuth）是用户可见功能而非遥测，`JERO_PI_USAGE_FETCH=0` 可关。无任何其他出站。

### 5.7 安装与分发（现行）

纯 npm 安装；postinstall 仅本地写 tuiMode 设置且**仅在键缺席时补默认**（Pi 1.0 起全屏已是宿主默认，旧逻辑会覆盖用户显式选择的 regular——语义反转有钉测）。git 源安装：仓库根即包清单（2026-10-13 扁平化），pi 在安装根直接解析并装依赖——此前的 `jero-pi/` 子目录 + 根壳镜像 + postinstall 编排方案随之退役（决策见 §9）。质量门由 prepack 串联八道：test-quality（5 反模式）/empty-catch/authority-boundary/docs-manifest/review-naming/module-contract/verify-package-files（300 必需文件 + 68 黄金向量字节钉住 + 25 禁止路径）/packed E2E（397 文件）。

## 6. 身份迁移终态（§8 v1.0 迁移表的核销）

| 类别 | 终态 |
|---|---|
| 命令 | `/jero:*` 28 个；`/gentle:*` 零残留 |
| 环境变量 | `JERO_PI_*`（清单见 jero-reference 契约与环境节）；`GENTLE_PI_*` 零残留 |
| 配置家 | `~/.pi/jero/`；`~/.pi/gentle-ai/` 只作为外源守卫的识别对象 |
| 契约串 | 16 个 `jero.*` 现行（清单见 jero-reference）；gentle 系全部删除或内化 |
| 存储 | `.git/jero-review/`；外来 `.gentle-ai` 存储 fail-closed |
| 提示词 | 全面简体中文（预检块/关键收获/技能注入头/守卫行，钉测锁定） |

## 7. 依赖与供应链（现行）

9 伴生全钉精确版：pi-pretty 0.6.30 · rpiv-ask-user-question 2.12.0 · rpiv-todo 2.12.0 · billion-context-pi 0.1.83 · pi-cache-optimizer 2.8.21 · pi-fovea 0.31.3 · pi-hashline-edit-pro 6.2.0 · pi-lens 4.3.0 · pi-web-access 0.37.0。peer：pi-coding-agent ≥0.85.1（当前随 1.0.4 全量验证）+ pi-tui。

- **升级策略**：3 天发布龄期门（例：1.0.3/1.1.0 未满龄跳过；伴生升到门内最新，跨主版本先真机冒烟）。
- **退出预案**：9 件每件一行退出路径（`docs/dependency-exit-plan.md`）；pi-lens peer 仍钉旧 pi-tui 按真机冒烟接受并登记预案。
- **宿主适配**：Pi 0.99 起 `ExtensionToolContext` 要求 `tools/executeTool`（测试假 ctx 补桩）；stock bash 错误语义变更（非零退出码→isError 结构化结果）有钉测，生产失败判定不受影响。

## 8. 安全与信任模型（v1.0 §9 的现行版）

进程内化失去"模型碰不到的物理边界"后，以工程纪律重建逻辑边界，现行机制：

1. **权威域纯度**：boundary 门结构性强制（不 import extensions、不读环境变量、typed 入参/判别联合出参）；身份层三件（canonical/lock/repository）永久宿主侧。
2. **模型输出无信托**：`evidence_class/causal_disposition/proof` 校验、severe-only 纠正、malformed→escalated 全部在 authority 内，黄金向量锁定。
3. **fail-closed 清单**：未知信封字段拒解、headless 维护路由拒绝、权威存储异常拒绝 START、外源权威数据拒绝、GIT_* 环境篡改拒绝（测试进程禁设 `GIT_*`）。
4. **供应链**：钉版 + lockfile + CI 审计 + 龄期门 + 束内 uvx/npx 白名单 + 模块安装记录哈希。
5. **浏览器出站结构门**：`JERO_PI_BROWSER_DOMAINS` allow/deny 清单，未命中 fail-closed（`lib/jero-ai-browser-gate.ts`）。

## 9. v1.0 之后的追加决策记录（按时间）

| 日期 | 决策 | 要点 |
|---|---|---|
| 2026-09-27 | gentle- 全清退 | 评审为进程内权威；wire 身份/存储/调用词自化 `jero-ai.*`；残留仅为守卫对象或历史事实，**绝不顺手清理** |
| 2026-09 下旬 | 提示词全面中文化 | 生成式技术产物默认简体中文，与用户会话语言无关；下游明显英文语境用英文；结构校验正则锁步重写；迁移夹具做双向字节 IDENTICAL 验证 |
| 2026-09/10 | Pi 宿主升级策略 | peer 下限钉 ≥0.85.1 不随升级抬；当前版本全量验证（1.0.0→1.0.2→1.0.4）；3 天龄期门；tuiMode 后装语义反转（键缺席才补默认） |
| 2026-10-01 | 模块契约 v2 | 依赖自述进清单；仅项目内；指令安装；deps-resolve 查；godot 金样落地 |
| 2026-10-06 前后 | 模块 MCP 项目级收口 | agent home 全局档 → `<项目>/.pi/mcp.json`（上游 Pi 0.99 落地项目作用域，本仓两份上游工单草稿均被满足——`upstream-pi-mcp-feature-requests.md` 因此删除，命运记录于此）；合并三律 + 来源账本 + doctor 归因 + 反向加固断言 |
| 2026-10 上旬 | SDD 运行时强化 | 受管修复尝试台账（acquire/settle 唯一权威）；评审负载守卫 + 交付策略四域；bootstrap 纪律/SDD 面包屑/规范索引三注入面；上下文清单（Context Manifest）；任务级 verify 命令；P0–P3 风险轴；威胁建模（安全敏感时）；估点与周期校准；追溯矩阵 |
| 2026-10 上旬 | 知识飞轮 | sync 回写 glossary/decisions/non-goals；归档回顾；repeat-offenders；后续演进补：非目标概念键 + 提案前门概念相似度匹配 |
| 2026-10 上旬 | 能力路由技能族 | jero-diagnose-stall（编排停滞六类只读分诊）、jero-architecture-patrol（六轴只读巡检 + 可视化 HTML 报告）、jero-debt、jero-lean/-review、jero-prototype（一次性原型裁决设计问题：LOGIC 单 HTML/UI 多变体，结论回流 design 契约，不是 SDD 阶段） |
| 2026-10-10/11 | 外部借鉴纪律成型 | 借鉴批模式=**零流程改动纯文本强化 + 契约钉测锁定 + CHANGELOG 留档**（豁免 pressure 微测的理由随条目记录）；来源 mattpocock/skills（拷问术/红回路/概念去重/Standards 轴/合并危险/正文耐用性/阶段边界）、bigpowers（verify 命令/风险分级/威胁建模）、Trellis（上下文清单/每回合可见不变量）；门演化一例：Markdown 依赖门加 `<!-- target-repo-md-refs -->` 显式豁免区分包内依赖与目标仓库引用 |
| 2026-10-11 | 设计文档 v2.0 重建 | 本文档：按现行代码重述决策，v1.0 原文进 git 历史；与 jero-reference 分工固化（为什么 vs 是什么） |
| 2026-10-13 | 仓库扁平化 | 包本体从 `jero-pi/` 子目录平移至仓库根（根 `package.json` 即 pi 清单），git 源安装编排壳（根壳清单镜像 + `.pi-git-install.mjs` postinstall + 等价性钉测）整体退役——pi 在安装根直接解析，静默半装载问题不复存在；`.github/` CI 工作流随扁平化回到仓库根首次真正生效（旧布局下 GitHub 不读子目录工作流）；连带清除无关残留（根 `插件.md` 草稿笔记、空 `tmp/`），`_tools/` 与包同根 |
| 2026-10-14 | spec_driven_develop 借鉴批 + 编排提示词上下文经济 | 外部插件整体不上（与本仓 SDD/评审/PR 技能重叠、模块契约装不下流程型包、纯提示层与机检哲学错位），点子吸收七机制（漂移遥测/并行准入+单一写者/结构二值清单/透镜降噪/修复裁决三态/回答审查门/拆分四维）——全部 advisory 层不碰权威路由与结算；顺带上下文经济三件：罕见协议下沉深懒层 `orchestrator-rare-protocols.md`（委派文档 -21%）、JD 模板单一来源化（doesNotMatch 防回潮）、懒资产字节棘轮（补核心 8KB 门之外的无约束缺口；量化结论：常驻面 ~9.8KB ≈ smart zone 2–3%） |

## 10. 风险与开放问题（现行）

| # | 风险/问题 | 等级 | 处置 |
|---|---|---|---|
| R1 | 权威语义漂移（黄金向量未覆盖的暗角） | 中 | 68 向量字节钉住 + conformance 域测试 + 上游文档条款转显式测试；已稳定运行两轮宿主升级 |
| R2 | 9 伴生供应链与版本漂移 | 中 | 钉版 + 龄期门 + CI 审计 + 每件退出预案（dependency-exit-plan.md） |
| R3 | pi-lens peer 钉旧 pi-tui | 低 | 真机冒烟接受，退出预案登记 |
| R4 | pi-web-access 有偿 API | 低 | 研究能力 SDD 显式授予制，不默认调用 |
| R5 | 提示词文本的行为方差 | 中 | 契约钉测锁语义；措辞级变更要求微测或豁免留档（skill-authoring §4）；benchmarks 多臂对照在库 |
| Q1 | 模块库第三束（Unity？） | 开放 | 契约与 bundle-content 门已就绪，按需立项 |
| Q2 | 评审透镜消费项目规范（rules.review）的覆盖度 | 开放 | 提示词约定已落地并补档；是否升级为 schema 化配置待观察使用面 |

## 11. 附录

### A. 现行契约串（16）

`jero.authority/v1` · `jero.authority.review-mode/v1` · `jero.review-assessment-plan/v1` · `jero.lean-mode/v1` · `jero.background-subagents/v1` · `jero.session-change/v1` · `jero.session-worktree/v1` · `jero.child-standing-review-permission/v1` · `jero.agent_model_profiles/v1` · `jero.memory-index/v1` · `jero.remediation-evidence/v1` · `jero.task-reconciliation-lock/v1` · `jero.module-contract/v1`（兼容）· `jero.module-contract/v2` · `jero.module-overlay/v1` · `jero.module-installs/v1`

### B. 删除的外部契约（终态）

`gentle-pi.review-relay/v1` · `gentle-ai.verify-result/v1`（→`jero.verify-result/v1`）· `gentle-ai.telemetry-*/v1`（5 件）· `gentle-pi.dev-binary/v1` · `gentle-ai.review-integration/v2`（内化）· provider-contract 镜像锁

### C. 文档处置记录

`upstream-pi-mcp-feature-requests.md`（仓库根，2026-10 删除）：两份上游 Pi MCP 工单草稿均被 Pi 0.99.0 项目作用域满足，已落地存档——内容命运记录于 §9 对应决策行，文件不再保留。

### D. 事实来源

现行事实（计数/路径/版本/环境变量）：`docs/jero-reference.md`（机器钉住）。v1.0 设计原文与决策细节：git 历史（2026-10-11 重建提交的父提交树）。CHANGELOG：每批演进的完整验证记录。
