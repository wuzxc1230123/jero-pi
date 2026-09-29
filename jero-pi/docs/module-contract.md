# 能力模块契约（jero.module-contract/v1）

零代码扩展的机器验证单元：一个模块 = 一个目录 + 一份 `module.json` 清单，声明四个面（触发/知识/角色/接线）。本文是字段与语义的单一事实源；机器面由 `schemas/module.schema.json`（发布形态）与 `lib/module-contract.ts`（执行形态）双钉，`check:module-contract` 门拦截两者漂移。

与 `docs/extension-guide.md` 的分工：那份管松散资产（`.pi/skills/`、`.pi/agents/`，legacy 路径）的放置与纪律；本文管契约化模块——**判断变数据**：静态触发器由机器对仓库文件树判定，路由规则消费路由单字段，角色档案携带隔离正当性，静默失效族在安装验证时显式失败。

## 为什么是 JSON 而不是 YAML

包无 YAML 依赖，代理 frontmatter 的手写解析器只覆盖平铺子集；清单需要嵌套结构（bindings/routing/roles），JSON 免解析歧义、天然配 JSON Schema，且清单主要由创建器生成而非手写——机器优先。

## 目录布局

```
.pi/modules/{token}/
├─ module.json               # 清单（本契约）
├─ knowledge/
│  └─ SKILL.md               # L1 知识入口（≤60 行含 frontmatter；注册表可见）
└─ references/*.md           # L2 深度知识（按需读，绝不整注）
```

知识入口经技能注册表被宿主（S1 内联触发）与编排器（S2–S6 注册表注入协议）消费——模块知识与松散技能共用同一注册表，无新协议。

## 清单字段

| 字段 | 必填 | 语义 |
|---|---|---|
| `schema` | ✓ | 固定 `jero.module-contract/v1` |
| `token` | ✓ | 领域词元：`^[a-z][a-z0-9-]{1,23}$`，禁包内前缀（`jero-`/`review-`/`sdd-`/`jd-`）——防遮蔽 |
| `version` | ✓ | 语义化版本 |
| `description` | | ≤200 字符领域一句话 |
| `triggers.files` | ✓ | **静态 glob，契约的心脏**：`*` 不跨目录、`**` 跨目录、`?` 单字符，机器对仓库树判定 |
| `triggers.intents` | | 语义兜底词，仅降级使用，每次命中留痕 |
| `knowledge.entry` | ✓ | 模块相对 `.md` 路径；任何接线注入 `entry` 档时行数 ≤60（`MAX_ENTRY_LINES`） |
| `knowledge.references` | | 深度知识 glob（L2） |
| `roles[]` | | 角色档案：`name`（必须 `{token}-{角色}`）、`isolation`（四选一以上，见下）、`permission`（预设非手写清单）、`model`（fast/balanced/deep-reasoning）、`output` |
| `bindings` | ✓ | 编排面 → `{inject, appendRoles?}`，至少一面 |
| `routing[]` | | `{when, action, target}`：`when` 恰含 `surface` 或 `slip` 之一；`action` ∈ suggest-role/delegate-role；`target` 只能是本模块角色 |
| `config.testCommand` | | 钉住的测试命令——覆盖层的 Strict TDD 数据源（SDD apply/verify 转发取值链的第一级：覆盖层 → config.yaml → 探测） |
| `config.gitignore` | | 模块要求的仓库卫生条目（如引擎缓存目录） |
| `pipeline.gate` | | **C 级硬门声明**：要求某角色机制性必跑。零代码下不可安装（唯一路径进包加链）；声明的意义是"响亮的缺席"——覆盖层明示，编排器不得静默跳过 |

### 隔离正当性（isolation 四选一以上）

角色存在的唯一理由是执行隔离，不是知识（知识注入即可获得）：

- `adversarial-eyes`——对抗之眼：评审/审查，不能被实现者上下文锚定；
- `least-privilege`——最小权限：只读/收窄工具面；
- `context-economy`——上下文经济：大进小出，代理是上下文防火墙；
- `parallel-fanout`——并行扇出：同时多方向。

零隔离理由的角色在安装验证被拒——这是孤儿代理（人格型执行代理）的源头灭绝机制。

### 权限预设

`read-only` → read/grep/find；`scan` → read/grep；`write-bounded` → read/grep/find/edit/write/bash。编译期展开，模块不手写工具清单。

## 编排面（bindings 的键）

| 面 | orchestrator 情况 | 消费方式 |
|---|---|---|
| `inline` | 小活父会话直接干 | 注册表/host 触发（提示层，宿主所有） |
| `explore` | 委托 `jero-explore` | 注册表注入协议（机制保证） |
| `worker` | 委托 `jero-worker` | 同上 |
| `verify` | 委托 `jero-verify` | 同上 |
| `sdd-planning` | `sdd-explore/proposal/spec/design/tasks` | 子代理启动协议第 3 步注入 |
| `sdd-execution` | `sdd-apply/verify/remediate` | 同上 + Strict TDD 转发 |
| `review` | 评审生命周期 | 注入 + `appendRoles` 进追加名单（delegate 级审计） |
| `answer` | 决策/问答（路由单 R1） | 注入 |

S9（事故诊断）与 S10（继续/恢复）刻意不开放——后者是纯机械层。

## 注入档位与保证谱

| 档位 | 量级 | 语义 |
|---|---|---|
| `manifest-only`（L0） | ~50 token | 只暴露存在与触发词（探索面默认） |
| `entry`（L1） | ≤60 行 | 命中面默认注入量 |
| references（L2） | 按需 | 子代理按 entry 指路自读，绝不整注 |

保证等级：知识注入 = **bind 级**（静态触发命中即机器绑定）；`suggest-role` = 提示层建议（审计留痕）；`delegate-role` = 编排器应尝试并在结果封套回报 `module_resolution.delegation`（`delegated` / `skipped:<原因>` / `name-unresolved`——已列入 SDD 阶段结果契约与启动协议纠正步）；必跑角色（硬保证）= `pipeline.gate` 声明——覆盖层明示其缺席，编排器不得静默跳过，机制性安装唯一路径仍是进链。

自然语言请求的路由判断走**路由单协议**（`assets/orchestrator-delegation.md`「自然语言路由单」节）：语义层只填类型化单据（utterance_type / deliverable / 歧义度 / 不可逆性，`trigger_hit` 由覆盖层静态预填），路由是单据上的确定性规则 R1–R4；模块路由表的 `slip` 条件引用同一批字段，两套机制共享一个确定性底座。

## 生命周期与工具

- **添加**：目录 + 清单放项目 `.pi/modules/{token}/` 或全局 `~/.pi/agent/modules/{token}/`（个人跨项目模块；与技能/代理的全局发现对称）；
- **验证**：`/jero-module-verify`——**八查**（token 合法/唯一、**no-loose-duplicate**（token 与 `.pi/skills/` 松散技能重名即拒——同一知识双源必漂移）、防遮蔽、触发命中、路由解析、隔离正当、entry 行数、命令钉住；`pipeline.gate` 声明以"响亮缺席"语义呈现）+ 编译覆盖层到 `.atl/module-overlay.md`（自动生成物，勿手改）；
- **会话启动**：存在任一模块根时**延后**刷新覆盖层（`setImmediate`，启动绝不等待全仓扫描），并对模块根做防抖变更监视（尽力而为）；模块根全部消失时**删除残留覆盖层**——编排器绝不消费过期接线；
- **重编译触发面（盲区须知）**：会话启动 / 手动命令 / 模块根内文件变更。**仓库树变化（如新增 `go.mod`）不会自动重编译**——触发命中条件改变后跑一次 `/jero-module-verify` 或重启会话；扫描超 2 万文件截断时覆盖层与零命中详情都会明示"可能假阴性"；
- **CI 门**：`pnpm run check:module-contract`——schema 与 TS 常量零漂移 + 创建器金样绿灯；
- **升级**：重跑验证命令，bindings 目标断链显式报错；
- **移除**：删目录；下次刷新覆盖层与注册表自然收回。

## 兼容性

- 松散资产（无清单）走 legacy 路径，行为与 `docs/extension-guide.md` 所述完全一致；
- 核心流程不消费扩展资产的不变量保留：覆盖层在注册表/派发侧，评审走 git 对象、SDD 走状态机不动；
- 创建器 `jero-module-creator` 生成契约化模块（金样：`skills/jero-module-creator/assets/module-manifest.template.json` + `module-entry.template.md`）。

## 机制速查

| 文件 | 职责 |
|---|---|
| `lib/module-contract.ts` | 类型、清单解析、安装验证八查、glob 语义 |
| `lib/module-trigger-compiler.ts` | 仓库扫描（TTL 缓存 30s）、静态触发编译、覆盖层渲染、多根模块发现 |
| `extensions/module-verify.ts` | `/jero-module-verify` 命令 + session_start 覆盖层刷新 + 模块根监视 |
| `schemas/module.schema.json` | 清单的发布形态 schema（门钉与 TS 常量零漂移） |
| `scripts/check-module-contract.mjs` | CI 门：schema 漂移 + 金样绿灯 |
| `lib/skill-registry-engine.ts` | 注册表把项目与全局模块根的 `knowledge/SKILL.md` 纳入发现 |
| `assets/orchestrator-skills.md` | 注册协议第 5 步：按覆盖层档位收窄注入、委派按路由表 |
| `assets/orchestrator-delegation.md` | 「自然语言路由单」：R1–R4 路由函数与 slip 字段 |
| `assets/sdd-orchestrator-workflow.md` | Strict TDD 取值链（覆盖层优先）+ `module_resolution` 结果契约 |
