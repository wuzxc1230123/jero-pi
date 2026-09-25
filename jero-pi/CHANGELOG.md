# 更新日志（CHANGELOG）

jero-pi 尚未发布到 npm（版本停在 0.1.0 基线），本文件自重构收尾期开始记录。
格式仿 Keep a Changelog；"已裁决"类条目对应 `JERO-PI-DESIGN.md` 的决策记录。

## [Unreleased]

### 纪律存续与技能行为验证（对照 superpowers-main 差距评审的落地）

- **harness 纪律引导注入**（新 `lib/jero-ai-bootstrap.ts` + jero-ai 接线）：`session_start`/`session_compact` 置位、`agent_end`/`session_shutdown` 复位的窗口内，把压缩后仍须存续的核心纪律（澄清、路由、严格 TDD、单父编排、评审工作量、精益梯子、裁决与停问白名单、无信托数据）作为单条 user 消息注入本代理循环的每次 LLM 请求——紧随压缩摘要之后、marker（`jero:harness-bootstrap/v1`）去重、每循环至多一轮不逐轮唠叨。RPC 子进程与包子进程（`JERO_PI_AGENTS_CHILD=1`）绝不注入。修复"压缩后 harness 纪律随历史蒸发、技能描述触发从不保证第一轮就位"的结构缺口。
- **裁决与停问（Rulings, not stalls）**进 `jero-ai` 技能：歧义默认自行裁决并记台账（`Ruling: 决定 — 原因 — 错了的代价`），只有不可逆/安全敏感/工作区外副作用/计划坏死四类事停下问人；同一修复连续 3 次失败视为架构问题，停下质疑而不是发起第 4 次。
- **技能行为验证学说**进 `docs/skill-authoring.md` §5 与 `jero-skill-improver`：写技能 = 对流程文档做 TDD（加压场景记 RED 基线与合理化借口 → 最小修法 → 微测 ≥5 次带无技能对照）；失败形状配方匹配表（压力跳过→禁令+对照表、形状错→正面配方、漏元素→REQUIRED 槽位）；获胜配方禁加 nuance 子句；证据落技能目录 `pressure/`（注册表不扫子目录），跨技能回归落 `benchmarks/`。
- **发布门槛对齐真实仓库**：`package.json` repository 与 `publish.yml` 的 `github.repository` 门、trusted-publishing 工具链断言从占位 `jero-pi/jero-pi` 改为 `wuzxc1230123/jero-pi`（与 origin 一致），npm 发布链第一次真实可走。
- **伴生依赖健康审计进 `/jero:doctor`**（新 `lib/jero-ai-companion-deps.ts`）：逐依赖核对钉版安装（缺装=fail）与 pi 清单扩展入口可解析性（入口失效/版本漂移/非精确钉=warn+info），处置指引指向 `docs/dependency-exit-plan.md` 对应行——供应链年审从"出了事再查"变成每次体检自动覆盖。
- **Windows ACL 三件套挂起清账**（`_tools/g4-baseline-windows.md` 2026-09-25 附录）：三个曾"永不结束"的文件实测全部完整跑完零失败（review-candidate-view 179s / native-routing 19s / workspace-root 54s），全量 `pnpm test` 同机两次完整结束；仅存风险为 candidate-view 179s 贴 180s/文件预算线，根治路径（enforce 三 ACE 重建迁 icacls 或并行化）维持专项记载。

### 上下文与纪律增强（对照 gsd-core-next 差距评审的落地）

- **上下文余量监控**（新 `lib/jero-ai-context-monitor.ts` + jero-ai 接线）：主会话每个代理回合落定时按宿主精确 token 计数逐档告警（已用 70%/85%/93% → notice/warning/critical，每档升级通知一次）；`session_compact` 复位档位并提示用 `mem_search`/`mem_read` 找回上下文。仅 TUI 主会话生效，绝不自动触发压缩；`JERO_PI_CONTEXT_MONITOR=0` 关闭。
- **inspect 微小候选提示**（新 `lib/jero-ai-review-hint.ts`）：`jero_review inspect` 在候选干净就绪（passive 风险且 authored 行数 ≤10）时附加建议性字段 `triviality_hint`——提示先与用户确认是否值得走完整评审，只读 `assess` 是轻量替代；不参与任何状态转移。
- **SDD 工件收缩守卫**（新 `lib/jero-ai-sdd-guard.ts` + `/jero-sdd-continue` 接线）：成功推进后记录工件水位台账（`<changeRoot>/.jero-artifact-guard.json`，`jero.sdd-artifact-guard/v1`）；下次推进前对比，灾难性截断（行数腰斩且水位≥8 行）或工件消失时要求显式确认，拒绝则只展示状态、文件不动。台账损坏视为不存在，绝不阻塞。
- **测试质量棘轮门**（新 `scripts/check-test-quality.mjs` + 基线 3 处命中）：零依赖扫描 tests/ 的通过型断言、无理由 skip、实测时长断言、魔法睡眠四类反模式，按 (file, rule) 棘轮只降不升；行级 `// allow-test-rule:` 逃逸注释。接入 `prepack`/`prepublishOnly` 与 CI（`check:test-quality`）。
- **记忆索引锁异步化**：`saveMemory`/`deleteMemory` 改 async，锁等待从 `sleepSync` 忙等（最长 5 秒阻塞事件循环）改为异步轮询；扩展与测试调用点全部 `await`。
- **benchmarks 结果留存闭环**：`run.mjs` 默认把报告落盘 `benchmarks/results/<时间戳>.json` 并刷新 `latest.json`（`--out` 仍可重定向）；新增 `results/README.md` 引用纪律——引用数字必须给出对应时间戳存档。

### 文档

- 新增 `docs/tutorial-first-review.md`（从安装到第一次通过评审）与 `docs/how-to-choose-discipline.md`（评审/SDD/精益三轴选档 + 轻量出口），README 增加文档导航；`docs/dependency-exit-plan.md` 给出 9 个伴生依赖逐项的失效信号与退出预案。
- `docs/jero-reference.md`：阶段代理计数修正 16→14（`assets/agents/sdd-*.md` 实数）；打包核验口径澄清（148 必需 = 80 直接断言 + 68 字节钉住）；环境变量表补 `JERO_PI_CONTEXT_MONITOR`；补记上下文监控、triviality_hint 与 SDD 收缩守卫。
- `scripts/check-types.mjs` 头注释更新为现状：基线已是 0，门的工作是守住零（"does not compile cleanly yet" 已过时）。
- 移除 `tests/review-ledger-contract.test.ts` 中两个因包内 openspec/ 树退役而长期 `t.skip` 的空转契约测试及其死常量——契约措辞的权威载体是 `skills/_shared/review-ledger-contract.md`（同文件 CANONICAL 测试覆盖），行为由 authority conformance 黄金向量锁定。
- 仓库卫生：父仓库 `.gitignore` 补齐四个只读参考库条目（`gsd-core-next/`、`Trellis-main/`、`skills-main/`、`superpowers-main/`），杜绝 `.mimosa` 式误提交复发。
- `el Jero` 品牌声音与 `gentle-agents` 存储目录名经核实为**有意保留**（见下方白名单一节），不属残留，不做清洗。

### 身份清理（设计 G5/D8 收尾）

- 内部标识符与用户可见文案全面去 gentle 化（约 570 处、80 个文件）：导出函数 `gentleAi`→`jeroAi`、扩展默认导出 `gentleShell`→`jeroShell`、`GentlePromptEditor`→`JeroPromptEditor`、渲染类 `GentleAi*`→`Jero*`、配置选项 `gentlePiConfigHome`→`jeroPiConfigHome`、工具标签 "Gentle Review *"→"Jero Review *"、启动横幅描述、通知文案与各层头注释。
- 新增内部命名：评审 provider 进程簇改用中性命名（`providerExecutable`/`providerTimeoutMs`/`collectProviderProcess`/`providerProcessEnvironment`）。
- **有意保留的白名单**（wire/存储词汇，改动会破坏兼容）：`gentle-agents` 自定义消息类型与存储目录、`gentle-ai.review-*/v1` 等 schema 串、`gentle-pi.background-subagents/v2` 配置 schema、legacy 二进制探测串、`gentle-pi#NNN` 历史工单引用、`gentleman` persona 档位值。

### 修复

- `benchmarks/README.md` 运行示例的 `--arms lean-off,lean-full` 改为真实存在的臂名 `baseline,lean-full`（照抄旧示例会直接抛 `unknown arm`）。
- `extensions/sdd-init.ts` 的 `type ExtensionAPI = any` 换为 `@earendil-works/pi-coding-agent` 的真实类型。
- 仓库卫生：`.mimosa/`（安全扫描工作目录，563 个文件）移出 git 索引——根 `.gitignore` 早已声明忽略，但文件在被忽略前已入库。

### 打包

- `package.json` 的 `files` 移除 `tests/`：测试与 conformance 黄金向量继续留在仓库并由 `verify-package-files.mjs` 在源码树上校验，但不再随 npm 包分发（旧版 fixture `devbinary/`、`native-review-cli/`、`v0.10.7`–`v2` 因此离开发布产物）。

### 文档

- `docs/jero-reference.md`：lib 层计数修正为实测值（159 文件 ~46.5k 行，其中 authority/ 43 文件 ~14k 行）。
- `JERO-PI-DESIGN.md`：架构树扩展清单与实际 8 个扩展对齐；依赖对比表更新为实际 9 个伴生依赖（pi-tui 在 peerDependencies）；Q1 裁决更新为"jero-todo 已退役，切换 `@juicesharp/rpiv-todo`"。

### 技能体系

- 新增 `jero-skills` 路由技能：场景 → 技能/命令/工具的单一入口表，并规定"新增技能不同步路由表 = 路由器撒谎"。
- 新增 `docs/skill-authoring.md` 写作规范：description 触发语双轨制、命名前缀规则（🔒 测试钉住）、渐进披露、生命周期三档（core/experimental/已淘汰）、跨技能调用措辞、新增检查清单。
- 新增 3 个盲区模块的同名单测：`lib/jero-ai-path-guard.ts`、`lib/agents-remediation.ts`、`lib/banner-config.ts`（此前的测试套件对它们零覆盖）。

## [0.1.0] — 基线

gentle-pi（~11 万行 + Go 二进制）的去二进制化重构首版：评审权威进程内化（`lib/authority/`，conformance 黄金向量锁定）、自实现持久记忆、子代理编排、SDD/OpenSpec 流程、精益纪律（lean off/lite/full/ultra + benchmarks 多臂对照）、shell 层与三套主题。零原生二进制、零安装期网络。
