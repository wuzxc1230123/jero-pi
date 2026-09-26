# 更新日志（CHANGELOG）

jero-pi 尚未发布到 npm（版本停在 0.1.0 基线），本文件自重构收尾期开始记录。
格式仿 Keep a Changelog；"已裁决"类条目对应 `JERO-PI-DESIGN.md` 的决策记录。

## [Unreleased]

### 全量代码审查修复（2026-09-26：七条 P1 + 权威收口 + 机械重构 + 性能探测）

#### 正确性与安全（P1）

- **pi 会话生命周期**：`session_shutdown` 处理按 `event.reason` 区分——pi 在 /new、/resume、/fork 时同样发出该事件且复用扩展实例、不重跑 setup，此前无差别清场会**杀掉所有会话的存活子代理任务**并永久退订一次性事件总线注册（jero-agents 的指标订阅、jero-shell 的变更中继、runtime-metrics 的指标聚合三条 P1 同根）。现仅 quit/reload/未知 reason 清场，会话替换保留注册与任务；回归测试钉住三种替换 reason 与 quit。
- **硬拒绝正则加固**（`lib/jero-ai-guardrails.ts`）：新增归一化第二遍（小写化、剥引号、`$HOME`/`${HOME}` 折叠为 `~`），rm 旗标改双前瞻表达"同一命令行同时含 r 与 f"（覆盖 -rf/-fr/-rvf/-r -f/--recursive --force）；24 个对抗向量（旗标换序、引号包裹、大小写、变量展开、Windows 盘符根 `rm -rf C:/`）全部拦截，7 个常规递归删除不误伤。
- **VALIDATE 拒绝不再持久化**（`lib/authority/validate.ts`）：对齐 finalize 的 `JeroApplyRefusalError` 模式——apply 返回 refused 即抛出中止保存，被污染的草稿被丢弃、拒绝原样返回，杜绝"精确重放永远返回拒绝而记录状态已漂移"。
- **win32 进程树终止**（`lib/agents-runner-core.ts`）：取消/超时改 `taskkill /PID <pid> /T /F`（失败回退直接子进程 kill），孙进程（pi 子进程里的 bash 等）不再成孤儿；POSIX 进程组路径不变。
- **memory 索引锁协议**（`lib/memory.ts`）：`listMemory` 的索引重建改为"锁可用才重建"（绝不无锁覆盖持锁者刚写入的行）；锁等待处理 ENOENT 竞态；陈旧锁接管改原子 rename（消除双持有者）；空目录修剪改非递归 rmdir + 忽略刚删文件名的有界重试（既排除 recursive rm 的 TOCTOU，又消化 Windows delete-pending 残留）；删除无调用方的 `normalizeMemoryTopic`。
- **发布门禁超时与环境剥离**：review-publication-gate 全部 11 处同步 `spawnSync` 加 timeout（本地 git 10s、ls-remote/gh 30s）与 64MB 缓冲——网络挂起不再冻结宿主并令跨进程 authority.lock 失效；transaction-gate/reducer/snapshot 的 git 探测补 `reviewGitEnvironment()` 剥离，对齐本层 UNSAFE_GIT_ENVIRONMENT 防线。
- **热路径缓存**：SDD 面包屑新增 openspec/ 树 stat 指纹缓存（`cachedResolveSddStatus`，控制器/命令路径仍取即席读数）；spec-index 改"先查 marker 再扫盘"且每个 spec.md 只读一次——context 事件每次 LLM 请求的磁盘开销从全量文件读取降为 stat 遍历。

#### 权威层信任边界收口

- **acknowledge 焚毁锁内复检**：apply 内复检 approved/revision/identity/already-consumed（此前唯一不做锁内复检的操作，外层读数与 runOperation 之间的并发维护可造成 TOCTOU），被拒归约绝不进日志。
- **sdd-attempt R4 逐字重放**：settle 声明必须与 acquire 冻结的未跟踪三元组完全一致，漂移以新类型化拒绝 `untracked-scope-drift` 暴露（原实现静默采纳 settle 输入，违反模块自己的"acquire 冻结、settle 逐字重放"契约）；`settled_untracked` 改从冻结值重放；intendedUntracked 校验补反斜杠/空段/`.` 段，与 start.ts 对齐。
- **回执先日志后落盘**：`issueJeroReviewReceiptV1` 拆为纯派生（`derive`，哈希进终局结果）与原子落盘（`persist`，临时文件+rename）两段；finalize/validate 的终局回执在日志保存成功后从已保存状态内容派生并写入（哈希与结果核对）——磁盘上不再可能出现先于日志的孤儿回执，落盘失败不回滚日志（canonical_result 已携带 receipt_hash），崩溃窗口由 start.ts 的 F8 内容派生治愈路径闭环，精确重放幂等重签。
- **wire 投影 proof 修正**：`intendedUntrackedProof` 从误用 changed_path_manifest 摘要改为与 start.ts 同源的 `jeroUntrackedInventoryDigestV1`（可从随行 intendedUntracked 名称表重算，此前下游校验必败）；`currentCandidateTree` 经论证**保留**新鲜派生的 initial_review_tree（workspace 投影下与 complete_snapshot_tree 恒等、staged 投影下正确指向被冻结的暂存树，换值会破坏 staged 候选绑定），注释说明。

#### 机械重构

- `executeReviewControllerOperation` 的 9 个尾随位置参数收进 `ReviewControllerDependencies` 对象（内部 13 参递归与扩展调用点迁移，~55 个测试调用点同步，3 参调用形态不变；显式 `null` 语义保留——默认值仅 `undefined` 触发，`??` 会吞掉合法的 null）。
- `applyModelConfig`/`applyModelConfigAsync` 约 100 行逐行复制收敛为 IO 接缝单实现，同步外壳改为诚实的非 async 函数；IO 对象全部经箭头包装在**调用时**读取 ESM 活绑定（把函数值捕获进模块级对象会冻结 `syncBuiltinESMExports` 后置替换之前的实现——被边界测试当场抓住）。
- startup-banner.ts 全文 2 空格→tab（487 行）；jero-ai.ts 函数体整体归位一层缩进（986 行）+ 两处历史错位行修正 + 47 条 import 语句归顶（先验证无多行模板续行才动）。

#### 性能与边界论证

- **候选视图内容级漂移探测**（`lib/review-candidate-view-registry.ts`）：每次评审 subagent 派发原需 worktree add + 全量 checkout + 逐文件校验再销毁；现以内容级指纹（HEAD tree + `git diff HEAD --no-renames --binary` 补丁字节 + 选中未跟踪文件的 blob 哈希 + 冻结绑定字段）与上次完整验证比对，一致即跳过物化；任何内容/模式/二进制变化必然改变指纹；unborn HEAD（孤儿仓库主路径）或探测不可用一律旁路回全量对账。
- **STATUS 快照复用论证不成立并文档化**（`lib/authority/snapshots.ts`）：porcelain 指纹 memo 被 F7 回归当场证伪——porcelain 是**路径级**指纹，同路径不同内容的两次未提交修改产生完全相同输出，会把漂移前的冻结身份当缓存命中；内容级指纹（逐脏文件 hash）的代价恰等于被优化的全量冻结本身。结论以注释留在 `deriveJeroReviewSnapshotV1` 头部，防止重蹈。

#### 工具链门硬化与快胜

- 权威边界门（`check-authority-boundary.mjs`）：先剥行内块注释再过滤（堵住 `/* note */ code` 整行隐藏）、动态 `import()` 纳入 extensions/ 规则；`build-runtime-modules.mjs` 生成后校验改写出的相对 import 必须存在于 runtime/（未来 lib 根值导入漂移立即报错而非消费端 ERR_MODULE_NOT_FOUND）；`check-docs-manifest.mjs` 的 `main()` 不再复制 `checkDocsManifest()` 判定体。
- 快胜一批：sdd-init 命令 handler 去掉全仓唯一 `ctx: any` 并补 hasUI 门；模型搜索框 j/k 仅在搜索词为空时充当导航（含 j/k 的模型 id 可正常键入）；capture-relay 死导入删除；`.(exe|cmd|bat)` 点号转义；shell/session-changes 显示路径改 `join`（消除 Windows 混合分隔符）；review-consent-latch 改临时文件+rename 原子写；onAbort 通知补 hasUI。

#### 行为变更（默认值）

- **后台子代理策略默认改为 on**：`resolveBackgroundSubagentsPolicy` 的内置默认从 "off" 翻转为 "on"——并行后台委托成为常规形态，想收敛经项目/全局配置文件、`JERO_PI_BACKGROUND_SUBAGENTS=off` 或 `/jero:background-subagents disable` 关掉（四级解析顺序不变：项目文件 > 全局文件 > 环境变量 > 内置默认）。保守方向同步收紧：**存在但畸形的文件**与**设置了但无法识别的环境变量值**都保守失败为 "off"（此前无效 env 只是"被忽略"并滑向默认——默认翻转为 on 后这不再安全，显式输入坏了绝不静默落到 on）。`DEFAULT_BACKGROUND_SUBAGENTS_RENDERING` 对齐为 on；状态行/命令报告文案同步；`/jero:guard` 与编排器提示词状态行动态反映。验证姿态不受影响：写者验证规则跟随的是 RDD 线（review-mode 开关），该策略线只门控后台派发。顺带清除本模块六处机械拆分残留的重复注释块。

### 流程层补强（对照 Trellis-main 差距评审的落地）

- **SDD 状态面包屑**（新 `lib/jero-ai-sdd-breadcrumb.ts` + jero-ai 接线）：bootstrap 注入的是不变纪律，面包屑注入的是活状态——磁盘状态引擎解析的当前变更、`next_recommended`、任务进度与首个阻塞，在有活跃 SDD 变更期间的**每次 LLM 请求**刷新（marker `jero:sdd-breadcrumb/v1` + 16 位状态指纹去重；陈旧面包屑先剔除再插新，同指纹在场不重复注入）。不变量借自 Trellis 的每回合面包屑："必需步骤不在每回合可见，就会被模型静默跳过"。无活跃变更/已归档/变更歧义/非权威存储不注入；状态解析失败保守跳过，绝不阻塞请求。RPC 子进程与包子进程同 bootstrap 门拒绝；`JERO_PI_SDD_BREADCRUMB=0|false|off` 关闭。
- **已确立规范索引注入**（新 `lib/jero-ai-spec-index.ts` + jero-ai 接线，知识飞轮读取侧）：SDD sync 回写 `openspec/specs/` 之后，后续会话在 bootstrap 同一注入窗口（`session_start`/`session_compact` 置位）收到域索引——域路径 + Purpose 首行摘要（≤40 域、摘要 ≤160 字符、超限明示截断；无 Purpose 段退回首个非标题非列表行，再退占位说明）。修复"沉淀有了、回注没有"的结构缺口：同一教训不再每会话重学。写入侧零新机制（SDD sync 拥有回写）；索引只是发现入口，内容以 spec.md 为准；`JERO_PI_SPEC_INDEX=0|false|off` 关闭。
- **文档清单同步门**（新 `scripts/check-docs-manifest.mjs` + `docs/jero-reference.md` 生成块 + `tests/docs-manifest.test.ts`）：从注册点（`register*Command` 字面量/常量/模板展开、`name:` 工具字面量、`tool(` 前缀展开、`skills/*/SKILL.md`）派生命令/工具/技能三张清单，钉进 reference 文档的 `jero:manifest` 生成块并核对标题计数；`--write` 再生成。本次即抓到真实漂移：命令 22→25（install 三命令按循环模板注册、计数口径不一）、工具清单漏 `subagent_continue`。接入 `prepack`/`prepublishOnly` 与 CI（`check:docs-manifest`），漂移在本地 `pnpm test` 即失败。
- **轻量 change**（P1.1，走完整设计→测试→实现）：changeRoot 下的规范常规文件 `.jero-lightweight` 声明显式豁免——`lib/sdd-status.ts` 的就绪门变为 proposal+tasks（specs/design 不再阻塞、规划推荐链跳过两横档）；无 delta specs 时 sync `not_applicable`、archive 不要求 sync-report，写了 specs 走正常 sync；目录等非规范标记形状保守视为未声明。契约同步：引擎 `SddStatus.lightweight?: true`（`gentle-pi.sdd-status@1` 向后兼容扩展）→ 权威投影 `JeroSddStatusV2`/wire `NativeSddStatusV2` 稀疏携带同名字段 → `decodeNativeSddStatusV2` 校验布尔型（`jeroSddContinueV1` 的转移即投影，轻量 change 天然可续）；`runtime/*.mjs` 再生成。新测试 `tests/authority/authority-sdd-lightweight.test.ts` 三层覆盖（引擎语义 6 例 + 投影/续跑 2 例 + 解码器 1 例）。
- **评审域命名收敛启动**（P2）：`jero-authority-cli.ts` 的 SDD 投影 `projectV2` 从 `as unknown as` 双盲强转改为逐字段结构化重投影（编译器持续检查两个形状不再悄悄漂移）；新 `scripts/check-review-naming.mjs` + `scripts/review-naming-baseline.json` 把两个外围前缀（`review-*` 33、`jero-ai-review-*` 8）钉在最大值只降不升（authority/ 43 是收敛目的地不设上限，`--update` 棘轮下移），新评审域代码进 `authority/` 或显式记录决策。接入 `prepack`/`prepublishOnly` 与 CI，`tests/review-naming.test.ts` 钉住基线与打包链。整体改名迁移（约 41 个外围文件归位）留待专项 SDD 变更，此门保证迁移前不再发散。
- **未落地：570 处 gentle- 白名单清理与伴生依赖退出**——均为多会话专项（前者按白名单文档分批清退，后者按 `docs/dependency-exit-plan.md` 行动顺序启动），不顺手改。
- **benchmarks 实跑前置核查**（2026-09-26，本机）：两条硬阻塞写入 `benchmarks/results/README.md`——宿主 `pi` 0.84.1 低于包最低要求 0.85.1；环境无任何提供商 API 凭据（只从环境变量/密钥服务读取，绝不入仓）。附最小起步命令建议；两条件满足前 P0 保持"未验证主张"定性。
- **伴生依赖季度例行评审（首次执行）**：联网核查 9 个依赖（`npm view` × 9 + 本地 `pnpm audit --prod`）——全部近两周内有发布、零失效信号、零已知漏洞，不触发退出；钉版全部落后 latest 但按纪律升级走单独 PR。记录落 `docs/dependency-exit-plan.md` 新增"评审记录"节，下次 2026-12。
- **gentle- 白名单残留审计**：约 555+ 处分五类逐一点数（wire schema 串 369/55 文件、历史工单引用 145/28、`gentleman` 档位值 18/15、`gentle-agents` 存储 8/4、`gentle-pi.*` 契约串 15/10），每类标注移除条件（黄金向量迁移 / 顺手清 / legacy 回退 / 探测迁移 / 契约大版本），落 `docs/jero-reference.md` 兼容白名单节——清退从"感觉有 570 处"变成有分批依据的表。

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
