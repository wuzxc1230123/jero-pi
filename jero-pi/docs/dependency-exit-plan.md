# 伴生依赖退出预案（dependency exit plan）

jero-pi 的 G4/D5 决策把 10 个生态插件升级为**强制依赖**（精确钉版 + lockfile +
发布龄期 + CI 审计）。这是"调用而非复刻"的收益，代价是供应链集中：每个依赖
一旦停更、破坏性变更或被投毒，都会直接进入每个用户的会话。本文件为每个
依赖声明：它承接什么、失效信号是什么、退出路径是什么。**依赖出事时按本表
行动，不要临场发明。**

通用纪律（已落地，不随本表变化）：

- 全部依赖精确钉版，lockfile 入库；升级一律单独 PR + 全量测试 + 打包门。
- `pnpm-workspace.yaml` 强制 minimumReleaseAge（4320 分钟）/ 信任不降级 /
  禁非常规传递依赖；CI 跑 `pnpm audit --prod --audit-level=high`。
- 升级评审节奏：每季度例行过一遍下表"失效信号"列；任何依赖 6 个月无发布
  且有未修复的高危 issue，即触发该行的退出预案评审。

| 依赖（钉版） | 承接的能力 | 失效信号 | 退出路径 | 退出成本 |
|---|---|---|---|---|
| `@heyhuynhgiabuu/pi-pretty` 0.6.14 | 工具输出渲染全权（替代自研 quiet-tools 重注册 + 包装层） | 渲染错乱、注册冲突复发、停更 | 撞名消解已内置：extensions 装配层在 pi-pretty 注册前合并其自有开关 `PRETTY_DISABLE_TOOLS=read,grep`（read/grep 交给 pi-hashline-edit-pro，否则两者同名注册会让宿主启动直接失败，见 `lib/pretty-disable-tools.ts`）；如需整个退回宿主默认渲染，操作者设 `PRETTY_DISABLE_TOOLS=read,grep,bash`；退路 B：从 git 历史恢复 quiet-tools 的"权威生命周期卡"自渲染部分，工具输出交给宿主默认 | 低——合并逻辑包内自带，操作者零配置 |
| `@juicesharp/rpiv-ask-user-question` 2.10.1 | 封闭选项询问工具（替代自研 ask-user-choice） | 工具缺席/签名变更/停更 | 从 git 历史（jero-todo 退役同批次）恢复自研 `ask-user-choice.ts`；评审同意 UI 本就是独立组件，不受影响 | 中——实现已在历史中，需恢复 + 测试改写 |
| `@juicesharp/rpiv-todo` 2.10.1 | todo 工具（Q1 裁决：jero-todo 退役换此件） | 同上 | 从 git 历史恢复 jero-todo（退役于同一裁决，恢复路径对称） | 中 |
| `billion-context-pi` 0.1.75 | 模型驱动的上下文管理（压缩/整理） | 压缩质量劣化、与宿主 compact 冲突 | 直接移除：宿主 Pi 自带 compaction；jero-pi 的记忆工具（`mem_*`）已承载跨压缩的状态保全，不构成硬依赖 | 低 |
| `pi-cache-optimizer` 2.8.10 | 提示/KV 缓存命中率优化（稳定提示、缓存键、页脚统计） | 缓存统计错乱、代理请求被改写出错 | 直接移除：纯优化项，无功能面依赖它；唯一接线是其页脚统计与 shell 层并存的显示问题 | 低 |
| `pi-fovea` 0.27.0 | 仓库代码图/符号地图（每次提示注入 repo map） | 图谱错乱、停更 | 无胶水依赖：SDD explore 资产提示词只说"如有代码图工具优先用之"；移除后 explore 退化为普通检索，无需代码改动 | 低 |
| `pi-hashline-edit-pro` 4.3.6 | 哈希锚定的 read/replace/insert/grep 编辑工具（陈旧锚拒绝、不模糊匹配） | 编辑工具缺席/锚语义变更 | 移除后子代理回退宿主内建 edit/write；哈希锚定的"防错位编辑"是增强而非契约，SDD 的 TDD 证据与评审权威不依赖它 | 低-中 |
| `pi-browser-use` 0.11.8 | 内置浏览器自动化：`browser_*` 工具（导航/AX 快照/截图/交互），chrome-devtools-mcp 引擎经环回端口驱动本地 Chrome，持久档案 `~/.pi/browser-profile`；skills 含 browser-policy（CLI-first 必要性梯子：先 gh/API/抓取再开浏览器）与 visual-qa（截图验证）。**jero 侧自有防线**：`JERO_PI_BROWSER_DOMAINS` 结构门（`lib/jero-ai-browser-gate.ts`，tool_call 拦截）对其导航做域名级 allow/deny，allow 模式 fail-closed——该门是 jero 代码，不随本伴生件增删 | browser_* 工具缺席、Chrome/MCP 启动失败、skills 目录缺失（companion 测试有结构断言）、停更 | 直接移除：零胶水——jero 自有代码不引用其工具名（结构门按 `browser_` 前缀 + url 参数约定匹配，伴生件缺席时门自动空转），SDD 研究准入/评审权威/精益纪律均不依赖；移除即"无浏览器能力"，前端验证退化为 pi-web-access 抓取与读代码。注意其 engines 要求 Node ≥24（高于本仓 ≥22.6 下限），低版本环境本就装不上它，移除无额外代价 | 低 |
| `pi-lens` 4.1.6 | 编辑时语言感知快速反馈（LSP/lint/格式化），评审透镜的非权威辅证 | 误报淹没会话、停更 | 直接移除：设计 §5.3 已声明其反馈"非权威、不阻塞流程"；透镜权威在 `lib/authority/` | 低 |
| `pi-web-access` 0.29.0 | web_search / fetch_content 等研究工具；SDD 研究准入按其四个精确工具名授 `open-web`/`documentation` | 工具名变更/停更/成本问题（社区反馈约 $0.012/请求） | 准入机制是 fail-closed 的：工具不全 → 研究能力不授予、SDD 预检明示，MCP 网关与 Bash 兜底仍禁止。移除即"无研究能力"，无需代码改动；如需恢复研究，另选提供同形工具的插件并把准入表指过去 | 低 |

## 行动顺序（依赖实际出事时）

1. 先在 issue/PR 里引用本表对应行，确认失效信号成立；
2. 按"退出路径"执行；涉及恢复 git 历史代码的，恢复后必须补回对应测试族；
3. 退出 PR 单独提交，全量测试 + 断网门 + 打包门三重验证；
4. 在 `CHANGELOG.md` 记录退出与用户可见影响；若该能力用户可感知
   （询问工具、渲染、研究），在 README 的能力清单同步删除。

## 白名单提醒（不要顺手"清理"）

`gentle-` 残留五类已于 2026-09-27 全部清退或转性（wire 身份自化为
`jero-ai.*`，详见 `docs/jero-reference.md` 兼容白名单节）；现存的
gentle-ai 字样全部是**守卫对象或历史事实**（外来存储守卫、上游工单
引用、harness 禁用清单、迁移期兼容读取），不在本表处置范围内。

## 评审记录

- **2026-09-26 例行评审**（本机联网执行 `npm view` × 9 + `pnpm audit
  --prod --audit-level=high`）：全部 9 个依赖近两周内均有发布（最久
  `pi-pretty` 2026-09-14，最近 `billion-context-pi` 2026-09-26），
  零失效信号、零已知漏洞，"6 个月无发布"红线无一逼近——**不触发任何
  退出**。钉版全部落后于 latest（如 pi-pretty 0.6.14→0.6.29、
  pi-fovea 0.27.0→0.31.1）；按通用纪律升级一律单独 PR + 全量测试 +
  打包门，不在此评审里顺手升。下次评审：2026-12 或任一失效信号出现时。

- **2026-10-01 advisory 处置**（收编 pi-browser-use 后例行审计发现）：
  4 个 high 级 advisory 落在**既有钉版**的传递依赖上，与 pi-browser-use
  无关——undici 8.9.0（GHSA-rfgv-xxqx-mfg5 DoS / GHSA-w293-vg96-wgc3
  TLS 校验绕过，经 pi-web-access 与宿主）、brace-expansion 5.0.9
  （GHSA-qhr7-859c-m2p7 / GHSA-8436-99hf-9mmv 栈耗尽，经宿主 minimatch）。
  按"最小增量"钉 undici@8.10.2、brace-expansion@5.0.12（后者多覆盖一条
  moderate 级后续修补）：两者均在依赖方声明的 semver 区间内（^8.9.0 / ^5）、
  满足 ≥3 天发布龄期门。**坑位记录（含当日回退事故，方向曾记录反，此处
  为勘误后的事实）**：本仓 pnpm 11.1.1 存在 `pnpm-workspace.yaml` 时
  **忽略 `package.json` 的 `pnpm.overrides`，生效位置就是 workspace
  yaml**；且 overrides 只在真正触发重解析（清单/设置变更或全新解析）时
  应用——首测时 yaml overrides 因"Already up to date"空转被误判为无效，
  转投 manifest 后一度"生效"（实为当时 yaml 内仍残留同值配置），随后
  删除 yaml 配置触发重解析即回退，且**回退态 lockfile 曾随 40cd0b9 提交
  并误报 0 high**；后以删净 node_modules 的全新解析实验证实方向并修正
  （manifest 死配置已删）。另：pnpm 11 对"看似最新"的树会拒绝 `--force`
  重解析，需移动/删除 node_modules 强制。overrides 仅作用于本仓/CI 的
  lockfile 树；终端用户机器按 semver 区间现装，天然解析到已修复版本。
  audit 复核（修正后）：0 high / 0 moderate / 0 low。
