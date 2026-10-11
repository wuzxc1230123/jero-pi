# 更新日志（CHANGELOG）

jero-pi 尚未发布到 npm（版本停在 0.1.0 基线），本文件自重构收尾期开始记录。
格式仿 Keep a Changelog；"已裁决"类条目对应 `JERO-PI-DESIGN.md` 的决策记录。

## [Unreleased]

### 深挖修复批：test:fast 选择器缺陷 + harness 假绿通路 + 扫描剔除次序 + 提取器残余弱面（2026-10-12）

**四组问题全部经深挖证实后修复；机械回路（typecheck/全量/七门）本就全绿，本批修的是门看不见的逻辑缺口。**

- **test:fast 选择器核心缺陷**（`scripts/test-fast.mjs`）：`allTestFiles` 对顶层测试文件只存裸文件名、不带 `tests/` 前缀，而映射表全部模式带前缀——除 `lib/authority`（子目录条目恰好带前缀+特判）外全部映射域的 glob 静默展开为空、exit 0 且提示误导（上一批"36 文件 267 测"恰好只验证了唯一没坏的域）。修复：递归清单统一带前缀（conformance 6 测从此可达）、陈旧引用硬失败守卫（任何在 tests/ 下展开为空的模式 exit 1——曾经的 `tests/memory-*.test.ts` 就是静默空转的陈旧引用，已删）、agents 套件补全（`jero-agents*`/`jero-shell`/`shell-*`/`agents-`/`jero-agents-` lib 前缀）、alternation 统一带 `jero-pi/` 可选前缀、Windows 反斜杠归一。
- **真机冒烟 harness 三处加固**（`scripts/smoke-real-pi.mjs`）：①结算面终态未锚定 START 段谱系 id——零透镜 START 创建即 approved，结算段模型跑偏另起谱系即假绿（真谱系仍卡 reviewing、捕获路径未被行使）；改为按目标谱系定点断言 approved|escalated 且必须有回执落盘（两终态都经回执签发）。②记忆面只证 mem_save——补断言 index.json 含该主题行（"写被索引"），读/列/搜零盘面足迹维持模型汇报覆盖。③面四覆盖层读取无守卫——verify 先失败时 ENOENT 击穿整个 harness（汇总不打印、KEEP 留不住现场）；加守卫 + 全部六个模型面缺省逐面记跳过（汇总如实反映跑了几个面）+ finally 清理带 EBUSY/EPERM 守卫 + 异常逃逸也触发 KEEP + 继承的 GIT_* 全剥 + git 子进程带超时。
- **扫描忽略剔除前移到预算截断之前**（`lib/module-trigger-compiler.ts`）：上一批的"防撑爆 2 万预算"承诺未达成——剔除发生在截断之后，被忽略文件先占槽位再被移除，字典序靠前的构建产物会把真实文件挤出预算（假阴性）。修复：剔除先行、预算对"忽略剔除后的真实文件"成立；新增走查条目硬上限（20 万）兜无界递归并诚实置 truncated；`check-ignore -z` 双向 NUL 分隔（core.quotePath 的 C 风格转义让被忽略的中文/引号路径静默失配——伪命中剔除对非 ASCII 文件名失效）；maxBuffer 64MB（默认 1MB 在恰好瞄准的病态仓上把子进程杀掉、静默退回不过滤）。钉测：剔除先于截断（真实文件幸存）、非 ASCII 忽略路径被剔、走查上限诚实。
- **提取器残余弱面**（`lib/authority/capture-relay.ts`）：多跨距试解析只按 JSON.parse 过滤——散文前言先出现"可解析但不是信封"的 JSON（`{}`、`{"note":…}`）时仍会交出异物、在下游信封解码吃拒收（正是要修的拒收形态换了身马甲）；判据改为 JSON.parse + 信封严格解码双过。连带：全 '{' 无配对的病态输入最坏 O(n²) 同步阻塞——加 400 万字符扫描预算，耗尽按原始字节交回原生拒收。钉测：可解析异物被跳过且暂存完整本体；病态输入毫秒级放弃照常拒收。
- 验证：typecheck 0 诊；触发编译域、捕获中继域、test:fast 选择面自检全绿；全量与七道门见本批提交记录。

### 收尾修复批：单一事实源钉夹具 + 提取器多跨距 + test:fast（2026-10-11）

**P0 批后的真机复跑暴露并修复三件事：夹具抄实现、提取器散文花括号弱面、harness 脆断言；连带交付局部快速回路。**

- **真机复跑判定**：P0 批 7/8 面绿，结算面经两轮定位为模型产物方差 + 提取器弱面（非 P0 回归——捕获机制面/绑定/路由/受理全程正常，权威深度校验在正确拒收违约内容）；多跨距修复后复跑结算面一次通过 approved+回执。
- **提取器多跨距试解析**（`capture-relay.ts`）：散文前言先出现与信封无关的花括号时（真机实证 "Expected property name" 类拒收的形态来源），旧提取器取首个平衡跨距即交出垃圾——改为从首个 '{' 起逐个收集顶层平衡跨距、返回第一个通过 JSON.parse 的，全部失败才按原始字节交回原生拒收。钉测：散文花括号在信封前被跳过且暂存完整本体。
- **夹具单一事实源**（"夹具抄实现"结构性修法）：`REVIEW_PROJECTION_SCHEMA` 具名导出于 wire-contract-enums，wire 投影与 13 个测试夹具全部改引常量——曾经 projection.schema 的错 id 被九个夹具原样复制而测试全绿，正是"夹具手抄实现值"的病根；词表值从此只有一处可写。（codemod 曾误伤金样 fixture 字节，已 git 复原、打包门复绿后重做。）
- **harness 盘面真相断言收尾**：记忆面曾要求 stdout 含字面工具名——模型措辞方差制造假红（盘面四步全成仍判败），改为落盘+零退出码即过，与 START 面同律；结算面终局判据修正为"生命周期正确闭合"（approved 与 escalated 都是契约合法终态，评审者对不确定严重发现按台账契约升级是系统正确行为，不是故障）——真机三轮实证三种结局全部是模型产物方差，harness 断言必须判系统行为而非模型运气。
- **`test:fast` 局部快速回路**（`scripts/test-fast.mjs`，入打包门 323 文件）：按改动路径映射最小相关测试集（路径前缀→套件规则表，保守过选），未映射改动明示走门/全量兜底；明示"不替代全量，prepack 前仍须 pnpm test"。当前改动面选中 36 文件 267 测 3 分钟内跑完（全量 13 分钟）。
- 验证：typecheck 0 诊；夹具域 121/121、捕获中继 6/6、test:fast 267/267 全绿；真机 harness 8/8（含评审全生命周期）；全量与七道门见本批提交记录。

### P0 优化批：投影类型化 + 扫描 gitignore 感知 + 续跑提示（2026-10-11）

**三项 P0 优化落地；第一项的编译器一接管就揪出三处被双重强转掩护的活漂移，当场修复。**

- **wire 投影消灭外层双重强转**（`lib/authority/wire.ts`）：`projectJeroStatusToWireV1` 曾以 `as unknown as ReviewStatusV3` 收尾，缺陷 2（捕获路由蛇形漂移）正是被它掩护的。类型化过程中编译器再揪出三处同族活漂移一并修复——①repair 小节蛇形键（supported_operations/authorization_schema/counts.*）且授权串误用 abandon-authorization；②projection.schema 用错 id（candidate-projection，正典是 integration.projection/v1，解码器强制），错值已被九个测试夹具复制，全部同步正典；③authority.version/action/applicability/replayability/frozen.tier/forecast/repositoryContext 为 jero 词表向线上词表的逐字透传双轨，转换显式收拢到字段级并注释。接口对齐三处：`consumed?: true` 入 ReviewStatusAuthorityV1、repair 状态联合补 `"not_required"`、supportedOperations 由定长元组放宽为联合数组。顶层键漂移从此编译期报错。
- **仓库扫描 gitignore 感知**（`lib/module-trigger-compiler.ts`）：walkRepoFiles 经一次批量 `git check-ignore --stdin` 剔除被忽略文件（spawn 带 timeout，git 缺席/非仓库/失败回退为不过滤的旧语义——触发判定宁可多扫不可漏扫）。防两件事：构建产物拖慢扫描与撑爆 2 万截断预算；被忽略目录里的文件伪命中静态触发器（真机实例：忽略目录下的 go.mod 会在非 Go 项目激活 golang 束）。回归钉测两向：git 仓库内剔除、非仓库回退。
- **评审续跑提示**（`lib/jero-ai-review-params.ts` 的 `renderReviewContinuationPrompt`）：台账是评审状态机的唯一事实源，模型上下文不是——活谱系中段的 STATUS/INSPECT 信封携带确定性 `continuation_prompt`（只引用本封套自带的 collectBindings/next_transition，不发明参数），驱动方（脚本/断线会话/人工）逐段续跑。真机实证的动机：大候选单发编排必死，两段式续走全程贯通——本机制把两段式产品化为任意段。钉测：granted 谱系 STATUS 信封必带提示且引用真实谱系 id。
- 验证：typecheck 0 诊；目标测（wiring 6/触发编译 16/捕获中继 5/模块库 40）全绿；review 域 732 零失败；authority 全回路 295 测 0 败 + runtime 一致 + 边界干净；全量与七道门见本批提交记录。

### 收尾打磨批：真机冒烟 harness + 提取回落 + 深知识计数口径（2026-10-11）

**把"只有真机能抓的缝"从人工实践变成一键脚本（真跑 8/8 全绿含评审全生命周期），连带两处可选打磨落地。**

- **真机冒烟 harness（`pnpm run smoke:pi`）**：新增 `scripts/smoke-real-pi.mjs`（零依赖，入打包门清单）——本地 Pi 宿主 + 包本体在一次性沙箱仓库过八面：根提交前提 → 项目级装载 → 模型探针 → install-module golang 全链落盘（含无 MCP 声明面） → 静态触发编译（种 go.mod 命中） → 记忆四工具（隔离记忆根，经真实模型调用） → 评审·同意与 START → 评审·捕获与结算（断言 approved+final_verifications）。模型指向经 `JERO_PI_SMOKE_PROVIDER/MODEL`（缺省按面跳过并说明）；失败打印 pi 输出尾部、`JERO_PI_SMOKE_KEEP=1` 保留现场；评审面刻意两段式（单发 mega-prompt 在 START 后的编排阶段会被 pi 一次性吞掉，真机实证两次）。**建 harness 过程中再抓两个真机事实并当场消化**：伴生扩展 pi-lens 在工作树持续追加探针日志会令 START 后目标身份漂移（控制器判谱系 unrelated 不下发收集槽位）——沙箱预置 .gitignore 排除扰动源即稳；pi 包装进程可能在 START 已成功后异常退出——断言以盘面谱系真相为准。AGENTS 验证回路与 jero-reference 环境变量表同步收录。**验证：真跑 8/8 全绿、退出码 0,评审谱系一次结算 approved。**
- **中继提取回落（capture-relay）**：围栏候选解析失败（如信封字符串值内本身含 ``` 致非贪婪提前截断）时回落花括号跨距取完整对象，而非把截断体交出去吃可避免的拒收；边角回归钉测（围栏内含围栏标记的信封受理且暂存完整本体）。
- **深知识计数口径（module-bundle-content）**：description 的"N 篇深知识"按内容篇计，`_sources` 出处账本（元）不再计入对照；golang 束 description 同步为"27 篇深知识 references 与 1 篇出处账本"（godot 无账本不受影响，两束库门绿灯维持）。
- **终审自查再修一处棘轮盲区**：首版清单完备性棘轮只扫一层且只滤 .md/.yaml——与人工审计同盲区，把 `skills/jero-module-creator/assets/module-manifest.template.json` 漏在打包门外（322 号补录）；棘轮升级为递归扫描 + .md/.yaml/.json 全扩展（注释留档"结构不变量不得复刻人工清单的习惯盲区"）。
- 验证：typecheck 0 诊；目标测（捕获中继 5/5、模块库 40/40）；全量与七道门见本批提交记录（打包门 321 文件）。

### 质量门体系加固批：打包门清单完备化 + 诊断透出（2026-10-11）

**对全部八项质量检查做注入式变异测试（注入真违规验证变红，8/8 机制有效）后修复两处体系缺口；另修复一起变异探针期间的外部中断导致的金样 fixture 清零（git 恢复，门复绿）。**

- **打包门清单缺口（审计发现 19 个漏录路径）**：`verify-package-files.mjs` 的 requiredPaths 手工清单缺 5 个扩展入口（jero-agents/jero-shell/module-verify/runtime-metrics/startup-banner——9 个扩展只收录 4 个）、5 个技能 SKILL.md（jero-skills 运行时路由表/jero-lean/jero-lean-review/jero-debt/jero-diagnose-stall）、8 个技能参考件（branch-pr×2/chained-pr/issue-creation×2/jero-module-creator 模板/judgment-day/release）与 `schemas/module.schema.json`——prepack 链会放行缺这些文件的残包。全部补录（清单 301→320），jero-reference 打包门计数行同步。
- **清单完备性棘轮（堵住整类缺口）**：既有 `tests/verify-package-files.test.ts` 只在合成夹具上测门函数，从未拿真清单对真盘面。新增 4 条结构不变量：每个扩展入口/每个技能 SKILL.md 及其 references+assets/每个提示词模板与发布 schema/每个模块束的 module.json+知识入口必须被清单收录——忘登记先红测试，不再依赖人工记清单。
- **nativeStatusFailed 通用分支诊断透出**：裸 Error（真机实证：零提交仓预检的 "Repository root commit anchors are required"）曾被整体吞掉，代理只拿到无 cause 的 `native-status-unavailable` 封套，排障需旁路复现。封套加性新增 `authority_error` 字段携带拒绝原因，fail-closed 语义不变；`jero-ai.test.ts` 补回归钉测。
- **变异测试结论（留档）**：八项检查对各自规约的违规 100% 精确拦截（带定位与修复指引）；12 处平台条件跳过全部有理由且被 test-quality 门禁止空理由；GIT_* fail-closed 与 headless TUI 面为设计行为/固有限制，不改。
- 验证：typecheck 0 诊；目标测（打包门棘轮 12 + 诊断透出钉测）全绿；全量与七道门见本批提交记录。

### 真机冒烟修复批：评审权威三缺陷（2026-10-11）

**Pi 1.0.4 真机全功能冒烟（项目级路径安装 + `pi -p` 驱动 GLM-5.3）发现评审链路三处包级缺陷，全部修复并以"目标回归 → authority 全回路 → 全量 → 真机复验"四层验证闭环；其余功能面（模块契约/记忆/SDD/技能/受管资产/精益/装载）真机全绿。**

- **缺陷 1（mode 写读漂移）**：`lib/authority/mode.ts` 克隆模式记录写入曾追加尾随 `\n`，而读侧 `parseCanonicalJsonV1` 逐字节比对正典形态——执行过 `/jero:review-mode enable|disable` 后每次读取判 `mode-record-corrupted`，START 模式门 fail-closed。修为与 `lineage-store` 同律（正典字节直写）。测试缺口同因：持久化测试用宽容 `JSON.parse` 读文件、CLI 测试夹具自写正典（无 LF），从未走过"权威写→权威读"真往返；补 `authority-mode.test.ts` 往返钉测。
- **缺陷 2（捕获路由永不注册）**：`lib/authority/wire.ts` 的 `projectJeroStatusToWireV1` 是 `targetStatus` 唯一生产投影点，其 `authority.lineage_id`/`frozen.*` 蛇形透传 + 尾部 `as unknown as` 双重强转掩盖了与类型化 `ReviewStatusV3`（驼峰）的漂移——扩展 `retainNativeCaptureRoutes` 读 `lineageId` 恒 undefined → 路由表恒空 → `jero_review_capture` 在任何会话都被 `capture-binding-rejected` 拒绝。修为驼峰（P4d-g execute 绑定同族修复的漏网两小节）；外部 wire 输入仍由 `decodeReviewStatusV3` 独立解码，两方向不越界。测试缺口同因：扩展单测注入的 stub CLI 返回手工驼峰形状，真 CLI→真注册的缝从未被测；补 `authority-controller-wiring.test.ts` 集成钉测（granted 谱系 STATUS → `syncRetainedNativeStatusSelections` → 每个收集槽位注册出捕获路由）。
- **缺陷 3（中继提交容器不容忍）**：权威提示词的输出契约样例本身以 \`\`\`json 围栏展示，真机评审模型（opaque 隔离子进程）如实带回围栏或散文前言，而 `lib/authority/capture-relay.ts` 受理面逐字节严格 `JSON.parse` 在信封解码之前就拒成 `submission-refused`（同契约自相矛盾）。修为确定性运输容器提取（直通解析 → 首个围栏块 → 字符串感知花括号跨距；两条提不出 JSON 仍按原生解析错误拒收），信封严格解码原样保留，暂存提取后字节使组合面严格重解析自洽；补 `authority-capture-relay.test.ts` 三容器形态受理 + 纯散文照拒钉测。
- **连带诊断性观察（未改）**：`nativeStatusFailed` 通用分支丢弃原始异常文本（真机零提交仓的"Repository root commit anchors are required"到代理侧只剩无 cause 封套），排障需旁路复现——留作后续批。
- **真机验证**：缺陷 1/2 修复后 capture 穿透路由与同意层（暴露缺陷 3）；三修齐后新会话续跑谱系 `review-c9383b872955116f` 一次通过全生命周期——捕获受理 → 台账四段流转（capture-result→freeze-ledger→resolve-evidence→verify）→ 终态 approved → acknowledge 烧毁 → 回执铸造（receipt/ledger/evidence 三哈希 + counters 齐全）；隔离评审者无文件工具时诚实提交零发现而非编造（对抗之眼纪律实证）。另证 ABANDON 的 UI 门与 headless fail-closed、medium 档透镜集由权威冻结等均为设计行为。
- 验证：typecheck 0 诊；目标回归（mode 4/捕获中继 4/接线缝 5）全绿；authority 全回路 293 测 0 败 + runtime 一致 + 边界干净；review 域 732 测零败；全量与七道门见本批提交记录。

### 设计文档 v2.0 重建批（2026-10-11）

**`JERO-PI-DESIGN.md` 按现行代码整体重写（v1.0 的重构设计已全部实现，原文进 git 历史）；仓库根 `upstream-pi-mcp-feature-requests.md` 确认删除（两份上游工单草稿均被 Pi 0.99 项目作用域满足，处置记录进新设计文档附录 C）。**

- **v2.0 结构**：背景与 G1–G6 达成状态（附验收现行值）+ 追加目标 G7 中文化/G8 模块契约/G9 知识飞轮 · 现行分层架构图（9 extensions/authority 51 文件/模块执行面/注入面第四层）· D1–D9 决策现行重述 · 子系统现行状态（权威/SDD 编排全机制清单/知识飞轮/记忆/模块契约/遥测/安装）· 身份迁移终态核销 · 依赖与供应链（9 伴生现行钉版 + 龄期门 + 退出预案）· 安全信任模型现行版 · **v1.0 之后追加决策记录九条**（gentle- 清退/中文化/宿主升级策略/模块 v2/项目级 MCP/SDD 运行时强化/知识飞轮/能力路由技能族/外部借鉴纪律）· 风险开放问题更新（新增 Q1 第三束、Q2 rules.review 覆盖度）。
- **分工固化**：设计文档答"为什么"，jero-reference 答"是什么"（计数/路径/版本以 reference 为准）；AGENTS.md 指引行同步。
- 验证：测试/脚本零处钉住旧文档内容（grep 核实）；文档变更不触代码面，既有全绿状态维持（此前全量 2570 测 + harness 退出码 0）。

### skills-main 借鉴批二：巡检可视化 / 阶段边界与上下文预算 / 门标记豁免（2026-10-10）

**第三批零流程改动：巡检报告可视化、编排器上下文卫生、依赖门语义区分；预检瘦身经评估撤回（与"必需步骤每回合可见"的 bootstrap/面包屑立论冲突，不做）。**

- **巡检可视化**（借鉴 mattpocock HTML-REPORT）：`jero-architecture-patrol` 发现 ≥3 条或用户要求时，另产自包含 HTML 报告到系统临时目录（Tailwind+Mermaid CDN、每条发现带前/后对比图）——新增 `references/html-report.md`（骨架/发现卡片/五种图模式按发现形状配图/顶部建议节/深模块词汇纪律），SKILL.md 版本 1.0→1.1；打包门收录两路径。
- **阶段边界与上下文预算**（借鉴 mattpocock PHASE-BOUNDARIES）：sdd-orchestrator-workflow 新增节——smart zone（~150k）有限预算，上下文决策只在阶段边界按序五问（继续先排除 → 无关则开新会话 → 移交仅四情形 → 可 AFK 则派子代理 → 压缩是兜底不是首选），一手/二手来源损失框架；守门员在阶段间隙自查余量、绝不在阶段中段压缩，压缩后由 bootstrap/面包屑重建必需上下文；措辞 harness 中立（不点名宿主斜杠命令）。orchestrator.md 核心 8192B 预算不动（7422B），新节进懒加载 workflow 文件。
- **依赖门语义区分**：review-ledger 契约的 Markdown 依赖门新增 `<!-- target-repo-md-refs -->` 行级显式豁免——带标记行点名的 `.md`（如 `CODING_STANDARDS.md`/`CONTRIBUTING.md`）是目标仓库可选约定文件而非包内依赖；四个评审透镜恢复精确 `.md` 文件名并打标记（上一批为过门去扩展名的措辞规避就此结构性解决）；单元钉测双向锁定（有标记豁免、无标记仍拦）。
- 验证：typecheck 0 诊；打包门 300 文件过；docs-manifest 同步（22 技能）；目标钉测 213 全绿；test:sdd 184 / test:review 732 / test:agents 275 零失败。

### skills-main 借鉴批：拷问术/红回路/概念去重/项目规范优先/合并危险/正文耐用性 + `jero-prototype`（2026-10-10）

**两批零流程改动的纯文本强化：第一批判改既有资产与技能，第二批新增 `jero-prototype` 技能（技能数 21→22）。SDD 阶段链、状态权威、依赖图全部不动。**

- **拷问术三机制**（借鉴 mattpocock grilling）：sdd-orchestrator-workflow 提案提问节与 sdd-proposal 同步——每轮只问前沿（被未决答案挂起的问题留后续轮）、每问附推荐答案（措辞让"同意"即采纳）、事实/决策分工（可查证事实先自查，绝不当作产品问题抛给用户）。
- **紧反馈回路**（借鉴 mattpocock diagnosing-bugs）：sdd-remediate 新增前置纪律——没有一条已在本缺陷上跑红过的命令不进入假设与修复（优先复用任务行 `verify:` 命令），修后同命令转绿、前后退出码入证据；非确定性行为先提高复现率，仍不可复现即如实停止。
- **非目标概念键去重**（借鉴 mattpocock out-of-scope KB）：sdd-sync 非目标记录加 kebab-case 概念键（同概念再拒追加不重开条）；提案前门新增按概念相似度匹配历史拒绝的读取步骤（命中即向用户呈现，已拒方向绝不静默重启）。
- **评审消费项目规范**（借鉴 mattpocock code-review Standards 轴）：四个 review 透镜各加一条——目标仓库存在 `CODING_STANDARDS`/`CONTRIBUTING` 编码章节或 `openspec/config.yaml` 的 `rules.review` 段时，明文规范优先于透镜通用启发；`rules.review` 与既有 `rules.spec` 一并补档 jero-reference 契约与环境表（此前两者都是无文档的提示词约定）。
- **PR 合并危险段**（借鉴 mattpocock pr/Humanlayer show-me）：branch-pr PR 正文模板六段升七段（**合并门**单向/双向 + **爆炸半径**一词概括），chained-pr Chain Context 表加 `Merge door`/`Blast radius` 两行；两技能版本随升（2.2/1.1）。
- **正文耐用性**（借鉴 mattpocock agent-brief 耐用性四原则）：issue-creation 新增"正文耐用性"节（禁行号、行为契约而非实现位置、验收标准独立可核验、显式范围外），版本 1.4→1.5；sdd-design 契约段同步吸收（契约写类型与行为约束，行号与易变路径会让 sync 沉淀过期）。
- **技能写作规范增补**（借鉴 mattpocock writing-for-agents）：skill-authoring §3 增引导词（leading words）/no-op 猎杀/防腐（沉积）三条。
- **`jero-prototype` 技能**（借鉴 mattpocock prototype）：一次性原型裁决"纸上谈不拢"的设计问题——LOGIC 分支单文件 HTML（纯模块可整体吊走、自由按钮+引导走查、写给领域专家），UI 分支同路由 `?variant=` 三个结构迥异变体（浮动条切换、生产构建隐藏）；纪律：默认无持久化、零打磨、一条命令可跑；结论回收——验证过的 reducer/状态机/schema/类型形状回流 design 契约段，原型全量存 `prototype/<name>` 分支当一手来源，绝不进 main；**不是 SDD 阶段**、不进 `jero-ai.sdd-status/v2`；路由表/参考文档/打包门 requiredPaths/钉测（jero-prototype-skill.test.ts，含路由器不许撒谎钉）四线同步。
- 行为验证说明：本批技能文本变更沿用仓库借鉴批先例（grilling/bigpowers 批同此）以契约钉测锁定，未附 `pressure/` 微测记录——预防性强化而非对观察到的失败做修复，豁免理由随本条目留档。
- 验证：typecheck 0 诊；test:sdd 184 / test:review 732 / test:agents 275 零失败；artifact-language 借鉴批断言 + jero-prototype-skill + skill-collision（前向棘轮自动收录）全绿；docs-manifest 同步（28 命令 / 19 工具 / 22 技能）。

### golang 能力模块束批（2026-10-10）

**包内模块库第二束：`golang` 全中文模块（21 技能 + 28 篇 references + 评审/测试/架构三角色，知识锚定 Go 1.25/1.26），素材派生自 samber/cc-skills-golang（MIT）与 cxuu/golang-skills（Apache-2.0）两套快照重蒸馏（非逐句翻译，`references/_sources.md` 逐篇登记出处与授权）；伴生修复契约库 config 物化缺陷。**

- **模块本体**（53 文件）：`module.json`（v2、触发器 `go.mod`/`**/*.go`、Strict TDD 钉 `go test ./...`、零依赖、**不声明 MCP**——束内供应链门限 uvx/npx 钉版，gopls 形态装不下，决策记入 `_sources.md` 与 `tooling-guide.md`）+ 知识入口 42 行（≤60 门内）+ 三角色（golang-reviewer 对抗之眼只读 / golang-tester 有界写者跑三道门 / golang-architect 深推理设计提案）；内容面吸收两套素材的四机制：原子归属交接块、触发式描述、出处块（来源/权威级/最低 Go 版本/核验日期）、确定性验证命令（三道门协议 `verification-gates.md` 对齐 godot 束 verification.md）；1.26 勘误贯穿（wg.Go、B.Loop 不再阻内联、go fix 体系、Green Tea GC、errors.AsType、slog.NewMultiHandler、os.Root、goroutine 泄漏剖析）。
- **gopls MCP 接线技能（golang-mcp，官方 MCP 事实核验后的补偿面）**：golang/tools 源码直查确认 Go 官方 MCP 服务器存在（`gopls mcp` 子命令，2025 年内置，stdio/SSE，八工具 `go_workspace`/`go_search`/`go_file_context`/`go_package_api`/`go_symbol_references`/`go_rename_symbol`/`go_diagnostics`/`go_vulncheck`，基于 MCP 官方 Go SDK）——但其分发形态（本地二进制/`go run`）过不了束内供应链门（uvx/npx 钉版白名单），故以**技能**形态补偿：接线两种形态样例（本地 gopls / `go run` 钉版）+ 官方 Read/Edit 工作流 + 工具缺席降级纪律；`tooling-guide.md` gopls 段升级为核验事实（含成熟度注记），`_sources.md` 登记核验；模块清单仍零 MCP 声明（契约豁免的是项目内手工接线）。
- **契约库缺陷修复**：`lib/module-contract.ts` 的 config 物化条件原挂在 gitignore 上——只声明 `testCommand`（两键按 schema/configSpec 皆可选）的清单 config 整段被**静默丢弃**，Strict TDD 取值链第一级随之失联；改为任一键存在即物化，`module-contract.test.ts` 补回归钉住（发现路径：golang 束安装后覆盖层报"无模块钉测试命令"）。
- **束内内容机检升级为契约面（模块库全面审核批复落地）**：判定体抽成 `lib/module-bundle-content.ts` 纯函数（悬空交接指针/技能与角色骨架同名/孤儿 reference/清单手写计数），`verifyModule` 新增 **bundle-content** 检查项（未提供素材 skip）——手工模块经 `/jero-module-verify` 与安装束同受其律；读取面 `readBundleTexts`（管线导出）双布局兼容：源布局直读模块束目录，安装布局经安装记录恢复拆到 `.pi/skills/`、`.pi/agents/` 的伴生资产（发现路径：首版接线后安装 E2E 报"束内实为 0"——安装器把 skills/ 拆走，源布局假设不成立）；CI 库门 `check-module-contract.mjs` 与库内容测试改吃同一判定体/读取面，三方判定永不漂移。
- **新增测试**：`tests/module-library-content.test.ts`（束内容机检——交接指针可解析含宿主代理豁免/references 指路无悬空无孤儿/frontmatter 同名/全中文，两束同检防再生束绕过）+ `module-verify.test.ts` 增 golang 真实束安装全链（无 MCP 档面：不创建 `.pi/mcp.json`、覆盖层含钉住命令、幂等重装、module-list 无 MCP 披露形态）。
- **集成面**：`verify-package-files.mjs` 逐个登记 55 个新文件（54 束文件 + lib/module-bundle-content.ts 判定体；打包门总数随并行批合计 301）；README/docs（module-contract、jero-reference）与根 AGENTS.md 的"首束 godot"表述拨正为两束；jero-reference 打包门计数行同步。
- **验证**：全量 2564 测 0 败（含新增 4 测）+ 八道质量门全绿（module-contract 库绿灯覆盖新束/schema 漂移/authority 边界/test-quality/empty-catch/review-naming/docs-manifest/runtime 一致性）+ typecheck 0 诊断。

### Pi 1.0.0 升级 + 遗留清账批（2026-10-06）

**宿主从 Pi 0.85.1 升到 1.0.4（全家族对齐；1.0.0/1.0.2/1.0.4 三个门内版本先后全量验证），peer 下限保持 ≥0.85.1；模块 MCP 合并目标从全局 agent `mcp.json` 收口到项目级 `.pi/mcp.json`（上游 Pi 0.99.0 落地项目作用域后的既定方向）。** 供应链 3 天发布龄期门内逐批跟进(1.1.0 未满门继续跳过)。

- **Pi 1.0.0 适配**：工具执行上下文 `ExtensionToolContext`（0.99.0 起要求 `tools`/`executeTool`）——测试假 ctx 补桩；stock bash 错误语义变更钉进测试（非零数字退出码从抛错改为 resolve 出 `isError` 结构化结果、无退出码反向变抛错），生产失败判定读 exec 包装捕获的 exitCode、不受影响；`tuiMode` 后装脚本语义反转——从"强制扳成 fullscreen"改为"仅在键缺席时补默认"（Pi 1.0 起全屏本是宿主默认，旧逻辑会覆盖用户显式选择的 `regular`）。
- **伴生九件升级**（全部升到龄期门内最新版）：pi-pretty 0.6.30、rpiv 两件 2.12.0、billion-context-pi 0.1.83、pi-cache-optimizer 2.8.21、pi-fovea 0.31.3、pi-hashline-edit-pro 6.2.0、pi-lens 4.3.0、pi-web-access 0.37.0；入口面两处随版迁移（pi-pretty `dist/index.js`→`src/index.ts`、pi-web-access `index.ts`→`dist`）；pi-lens peer 仍钉旧 pi-tui（上游未适配 1.x），按真机冒烟接受运行时兼容并登记退出预案。
- **MCP 项目级收口**：`agentMcpJsonPath()`（agent home）→ `projectMcpJsonPath()`（`<项目>/.pi/mcp.json`），合并三律/来源账本/doctor 三态归因原样保留；安装文案明示"项目级档需 Pi ≥0.99（首用有项目信任确认）"；实装测试反向断言 agent home 不被触碰；godot 束技能与参考文档、module-contract/jero-reference/exit-plan 措辞同步；上游 feature 请求草稿（项目级 `.pi/mcp.json` + `pi.registerMcpServer()`）标注已落地存档。
- **验证**：全量 2558 测（2546 过/0 败）+ runtime harness + 真机启动冒烟（真实 Pi 宿主按 pi.extensions 全量加载扩展层）+ 八道质量门 + `pnpm audit --prod` 零漏洞；`pnpm-workspace.yaml` 发布龄期豁免清单随 1.0.0 家族更新（含新增 pi-mcp/pi-codemode）。

### 伴生插件撞名消解批（2026-09-28）

**修复真实宿主启动阻断：`pi-pretty` 与 `pi-hashline-edit-pro` 都注册 `read`/`grep`，宿主（peer 0.85.1）对扩展间同名工具是硬冲突，按发布配置启动会话直接失败（`Tool "read" conflicts`）。** 单测与 runtime harness 用假宿主加载不到这一层；发现路径：隔离 Pi home `pi install` → 裸 `pi -p` 启动实测。上游 pi-pretty 最新 0.6.29 仍默认注册 `read`，升级钉版不解决。

- **撞名消解内置**：新增 `lib/pretty-disable-tools.ts`（纯合并助手，typed 入参不触 `process.env`），`extensions/jero-ai.ts` 模块顶层（`pi.extensions` 数组中 `./extensions` 先于 node_modules 插件加载）把 `read,grep` 合并进 pi-pretty 自有开关 `PRETTY_DISABLE_TOOLS`，让哈希锚定版本独占这两个名字；操作者已有的跳过项保留并去重。
- **文档拨正**：`dependency-exit-plan.md` pi-pretty 行声称的 `JERO_PI_PRETTY=0` 开关在代码中不存在（全仓 grep 仅命中文档本身），改为如实描述内置消解与操作者级全关法（`PRETTY_DISABLE_TOOLS=read,grep,bash`）。
- **验证**：真实宿主裸启动（无手工 env）从撞名失败变为直达 provider 鉴权（隔离环境预期终点）；新增 `tests/pretty-disable-tools.test.ts` 3 例。

### gentle-ai 依赖切除批（2026-09-27：第十一批）

**切除对 `gentle-ai` 原生评审 CLI（Go 二进制）的运行时依赖，评审全面落于自实现。** 关键事实：进程内权威适配器（`lib/jero-authority-cli.ts`）本就是生产唯一默认 CLI（评审全操作——START/STATUS/同意仪式/修正捕获/acknowledge/维护四联/风险评估/SDD 对——进程内服务），二进制仅在显式提供 `providerExecutable` 的测试接缝里才会被 spawn。本批把"自实现"落实为**自命名与自存储**：

- **wire 身份自化**：全部 `gentle-ai.*` schema 身份（`review-integration.*`、`sdd-status@2` 等 20+ 个）改 `jero-ai.*`——编码端（wire 投影）、解码端（字面校验与封闭词表）、runtime 再生成（13 模块）、68 个黄金向量按新字节重导为**本仓行为规格**（不再钉上游 v2.9.1）、`tests/fixtures/review-integration/**`、devbinary、runtime-harness 分片与 sdd-agent 资产同步；转义形态 `gentle-ai\\.`（字符串内正则）单独补扫。
- **capabilities 与调用词自化**：`package.name` 校验、consent/start invocation 词（`["jero-ai", "review", "start", …]` 与编解码双侧）、bootstrap 锚点命令、`native_contract: "jero-ai/2.1.4"`、off-path 杀开关命令接受集（jero-ai/历史 gentle-ai/`/jero:` 三元）。
- **存储自化**：managed 存储根 `gentle-ai/reviews`→`jero-ai/reviews`，"新名缺席且旧名在场时原地收编旧存储，绝不改写"（新增旧根收编回归测试）；权威自有存储 `jero-review` 不变；`FOREIGN_*_STORE` 外来守卫保持指向上游路径（守卫对象是位置事实）。
- **二进制接缝保留为通用测试接缝**：`providerExecutable` 生产者全部在测试中，生产路径从不 spawn 任何外部可执行文件；host-relay 错误文案去掉品牌、transport 的"安装 native provider"指引改为进程内权威语义。
- **兼容性裁决**：旧版 wire 身份的持久化评审记录在新解码器下 fail-closed（未发布包、单机数据、存量评审按新候选重启）；迁移期只读面——旧存储根收编、旧 managed-assets 注册表路径、consent off-path 双接受——保持可读。
- **文档**：`jero-reference.md` 兼容白名单节改写为"守卫对象与历史事实"四行清单；`dependency-exit-plan.md`、`AGENTS.md`、sdd-status.ts 归属头注同步。

### gentle 残留清退批（2026-09-27：第十批）

应用户指令对 2026-09-26 审计的五类 `gentle-` 白名单开专项：四类全部清退，外部契约类经证据确认**不可单方迁移**（`gentle-ai` 是外部原生评审 CLI 的身份——解码器字面校验 `package.name === "gentle-ai"` 与 `invocation: ["gentle-ai", "review", …]`、`FOREIGN_*_STORE` 是防误写外部存储的守卫、68 个黄金向量字节钉住上游 v2.9.1 行为规格），保留并改写白名单文档为"仅外部契约类"。

- **persona 档位 `gentleman`→`direct`**（`PersonaMode`/`PERSONA_OPTIONS`/`DIRECT_PERSONA_PROMPT`/命令描述）：读取侧非 `neutral` 一律归入 `direct`——旧 `persona.json` 里持久化的 `gentleman` 借此原地迁移，写侧只写新值，零 legacy 分支。
- **`gentle-agents`→`jero-agents`**：三个存储目录（任务历史、运行时 sessions/transcripts、orchestrator presence）按"新名读 + 旧名回退"探测迁移，绝不改写既有目录（新增旧根原地读回归测试）；`AGENTS_RESULT_TYPE`/`AGENTS_MESSAGE_TYPE` 自定义类型改新名，渲染侧注册 legacy 类型实现旧会话 JSONL 兼容读取。
- **`gentle-pi.*` 自有契约串→`jero-pi.*`**：引擎 `schemaName`（sdd-status）、child standing review permission IPC schema、relay 事件名（`child-session-change`/`session-worktree-changed`）、review reminder receipt customType（读取侧含 legacy 兼容）、侧栏 `Symbol.for` 键、dev-binary widget 键、生成文件头、临时目录前缀。
- **`gentle-pi#NNN` 工单引用全清**（~186 处）：保留全部说明文本与上游 `gentle-ai#NNN` 互操作引用；ASCII 分轮正则 + 字节级全角残迹清理（`perl -CSD` 下 argv 解码/文件原始字节不一致会使全角模式静默失配——教训入档）。
- **品牌可见面**：启动横幅 `TEXT_LOGO` 由 GENTLE-PI 手绘草书换为程序化生成的 JERO-PI 像素字模艺术（`LETTER_WEIGHTS` 同步，笔画序动画自动派生不受影响）；`tests/gentle-card-text.ts` 改名 `jero-card-text.ts`；skills frontmatter `author: gentleman-programming`→`jero-pi`（13 个，与 release 技能既有署名对齐）。
- **补扫清偿**：临时目录前缀 `gentle-pi-opaque-reviewer-`/`gentle-pi-host-relay-result-` 改 `jero-pi-`；`review-host-relay` 常量 `DEFAULT_GENTLE_AI_TIMEOUT_MS`→`DEFAULT_PROVIDER_TIMEOUT_MS`；测试夹具 tmpdir 前缀 ×5 与 agents-widget 标签样例去品牌（宽标签断言按新渲染实测更新）；recovered-lineage 复现锚点注释的仓库属主改 jero-pi（sha 为本仓更名前连续历史，仍然有效；上游 CLI 版本串保留），并以简体中文重写。
- **文档同步**：`jero-reference.md` 兼容白名单节改写为"仅外部契约类"；`dependency-exit-plan.md` 白名单提醒、`AGENTS.md` 已知约束行同步；文档中引擎 schema 名 `jero-pi.sdd-status@1`。
- **明确保留**：`gentle-ai.*` wire 串与 `review-integration` fixtures（上游契约 + 黄金向量钉住）、原生 CLI 词与 `FOREIGN_*_STORE` 守卫、注释中的上游 `gentle-ai#NNN` 互操作引用、`runtime-harness-support.mjs` 的 `FORBIDDEN_COMPAT_COMMANDS` 禁用清单（守卫本身）、OpenCode 上游主题沿指描述。

### 审计清偿批（2026-09-27：第九批）

全库编码规范与命名一致性审计（extensions/lib/lib·authority/tests/scripts/skills·docs 五区深读 + 机械扫描）后的定向清偿；风格分叉类（Error 前缀多式、判别字段 kind/type、assert 导入两式等）按约定留待成文后再统一，本批只动有明确依据的项。

- **文档拨正**：`jero-skills` 路由表与 `jero-reference.md` 手写正文的 `jero-release` 拨正为 `release`——`skill-authoring.md` 明文规定 release 保持裸名，两处手写文本系改名漏改（生成 manifest 块一直正确）。
- **缩进纪律**：`lib/banner-config.ts`、`banner-stats.ts`、`banner-logo-model.ts` 三文件整片空格缩进转 tab（TS 编译器 AST 识别模板串跨度，`git diff -w` 为空证语义零改动）；`tests/jero-agents.z3.test.ts` 与 `tests/sdd-research-capabilities.test.ts` 的逐级单空格缩进同法转 tab；`extensions/jero-ai.ts` 两处缩进层级错乱矫正（纯空白）。
- **authority 命名**：`JeroJudgmentDayApplyRefusal` 补 `Error` 后缀——全目录 16 个 Error 子类中唯一缺后缀者（同类均为 `*RefusalError`）；模块私有类，4 处文件内引用同步。
- **显式 any 清零**：`lib/orchestrator-presence.ts` 的 `Record<string, any>` 改 `unknown`（配套 `pick` 参数放宽为 `object`、`validHeader` 经 keys 钉死后定型、两处既定收敛经 `unknown` 中转）；`extensions/startup-banner.ts` 的 `ctx: any` 改 `ExtensionContext`。
- **env 接缝与契约**：`banner-config.ts` 与 `jero-ai-persona-config.ts` 的 `jeroConfigHome` 补 `env = process.env` 注入接缝（与 `memory.ts` 同族同型）；`JERO_PI_AGENTS_KEY` 更名 `JERO_PI_AGENTS_COLLAPSE_KEY`——未发布包、无文档记载、单一测试引用，与 `AGENTS_VIEW_KEY`/`AGENTS_STOP_KEY` 命名族对齐。
- **死代码清偿**：删除 `review-transaction-reducer.ts` 的 `reviewStoreRootForRepository`——全库零引用，且与 `review-repository.ts` 的 `reviewStoreRootForRepositoryV1` 同名同职责双实现（非 V1 版自带 git 调用与硬编码存储路径）。
- **测试与脚本注释**：`reviewGitEnvironment` 守卫自测的 `GIT_DIR` 注入补全仓唯一豁免注释（说明为何必须经 `process.env` 及恢复纪律）；英文注释清零——`tests/authority/fixtures.ts`、`scripts/check-authority-boundary.mjs`、三个 agents 测试夹具头注释、`sdd-research-capabilities` 一处行内注释；三个 4 文件分片家族的 base/z2/z3 头注释"共 3 段"更新为"共 4 段"（追加 z4 后漏改，共 9 文件）。
- **其余**：`extensions/jero-shell.ts` 模块常量 `defaultShellDeps` 改 `DEFAULT_SHELL_DEPS`（全目录 UPPER_SNAKE 海洋中唯一 camelCase 例外）。

### 扩展机制批（2026-09-27：第八批）

- **零代码扩展指南与模块/子代理创建器**：新增 `docs/extension-guide.md`（目标项目 `.pi/` 扩展的放置机制、错误避免与升级路径单一事实源）与 `skills/jero-module-creator`、`skills/jero-agent-creator` 技能（领域访谈 → 领域词元命名 → 技能/代理生成 → `openspec/config.yaml` 命令钉住 → 冒烟五步）；`prompts/` 补 `/module-creation`、`/agent-creation` 薄转交入口（目录钉住断言 2→4），`skill-creator` 决策门补转交行防路由落错。命名统一为"一个模块一个领域词元"（技能名 = 词元，代理名 = `词元-角色`）。
- **扩展资产的机器钉住**：`verify-package-files` requiredPaths +7（两个 SKILL.md 与 5 个模板资产——创建器模板驱动的完整性面）；`skill-collision-prefixes` 前向棘轮——"`jero-` 前缀 + 同名目录"从文档约定升为机器约定（`jero-ai` 历史特例排除）；新增两份技能内容测试（`tests/jero-module-creator.test.ts` / `tests/jero-agent-creator.test.ts`）钉住零代码边界、不建执行代理、词元命名（含近义词干回归禁令）、只读模板与台账输出契约。
- **文档链同步**：`jero-skills` 路由表、`jero-reference.md`（技能散文清单 + prompt 模板行）、`skill-authoring.md`（范围说明）、`README.md` 与 `AGENTS.md` 文档链接入扩展指南。

### 审核修复批（2026-09-27：第七批）

- **Codex 用量端点开关与边界登记**：`lib/shell-usage.ts` 新增 `usageFetchEnabled`——`JERO_PI_USAGE_FETCH=0|false|off` 时自动与手动订阅用量刷新一并短路（连令牌解析都不做）。该端点（`chatgpt.com/backend-api/wham/usage`，携带 OAuth Bearer）是 git/gh/pi 三类外部进程之外唯一带凭证的网络出口，jero-reference 架构边界、Shell 节与环境变量清单三处显式登记；README 安装须知同步补 postinstall tuiMode 写入的知情说明。
- **上下文监控档位随会话复位**（`extensions/jero-ai.ts`）：`contextMonitorLevel` 此前只在 `session_compact` 复位，Pi 在 /new、/resume、/fork 复用扩展实例，上一会话残留的 critical 档会让新会话的逐档告警永不升级；现随 `session_shutdown` 复位。测试钉住"critical → 会话结束 → notice 再告警"。
- **嵌套子代理结束不再提前关闭纪律注入窗口**（`extensions/jero-ai.ts`）：`agent_end` 的 `disciplineBootstrapPending = false` 原先在子代理深度判断之前无条件执行，具名/SDD 子代理结束时主代理循环即丢失 bootstrap/规范索引注入（注入不落会话文件，丢失即时）；深度门控与递减一并前置到评审回执门之前，保证每个子代理结束恰好配对一次。测试钉住"子代理 agent_end 后窗口仍在、主代理 agent_end 才关闭"。
- **authority 域同步 git 调用补 60s timeout**：`fix-application`/`snapshots`/`risk-assess`/`store-root`/`collect-inputs` 共 8 处 `execFileSync("git")` 此前全部无上限——git 挂起会无限期持有权威变更锁（独占 mkdir）冻结整个评审管道；超时按既有 `git-unavailable`/`derivation-failed` 类型化拒绝收敛。
- **Windows 悬空符号链接夹具修复**（3 例本机 Windows 失败、CI 门外）：实测 Node 在 Windows 上对悬空符号链接的 `rmSync` 是**静默 no-op**（含 force/recursive；`unlinkSync` 正常），后续 `writeFileSync`/`symlinkSync` 会穿透或 EEXIST。`tests/sdd-research-capabilities.test.ts` 与 `tests/review-candidate-view.z2.test.ts` 的 5 处删除改用 `unlinkSync`；CI Windows 作业新增这两个文件的符号链接夹具回归步骤。
- **测试挂起兜底**：三处测试 `spawnSync`（agents-history/orchestrator-budget/install-tui-mode-setting）补 30s timeout；全部 `--test` 入口（test/test:authority/test:agents/test:review/test:sdd）补 `--test-timeout=300000`——此前任一子进程挂死即整套件挂死直到 CI 级超时。
- **后台子代理策略 fail-closed 补缝**（`lib/jero-ai-background-subagents.ts`）：外层 catch（配置主目录不可解析等基础设施故障）此前返回默认 `on`，与"无效显式输入保守失败为 off"契约相悖，现保守返回 `off`；`existsSync` 换成 `statSync` 探测——EACCES 等"存在但不可读"不再被误判为"不存在"而滑向默认 on，改走 malformed-off 并正确归属文件（POSIX 测试钉住）。
- **postinstall 安装位探测容错**（`scripts/install-tui-mode-setting.mjs`）：所有权谓词解析调用方包根并与候选安装位比对，调用方根不可解析（如安装目录已消失的残留 postinstall）时 `realpathSync` 抛裸 ENOENT 打断探测；现按不匹配处理，干净走 `recognized: false`（所有权语义逐字保持：谓词仍解析调用方根，绝非候选位自比对）。
- **发布链补类型门**：`prepack`/`prepublishOnly` 首步补 `pnpm run typecheck`（此前全链唯独漏它，类型回归可随发布出门）。

### 第四档小改进清偿（2026-09-27：第六批）

- **`mem_save` 元数据补全**：新增可选 `agent`/`phase` 参数并透传 frontmatter——此前恒为空串，SDD 子代理保存时无法自报身份、检索侧无区分度；不传保持空串（既有行为不变），测试钉住两种形态。
- **未知 RPC 事件可见化**（`lib/agents-protocol.ts`）：`normalizeRpcEvent` 对未知事件类型不再静默丢弃，折为有界 NOTE（`unknown rpc event: <type>`，截 40 字符）——pi 上游新增事件名时线程里可见而不是静默失联；已知高频无语义事件（`message_start`/`queue_update`）保留显式忽略集。测试补双向断言。
- **`sessionEventReason` 共享助手**（新 `lib/session-event-reason.ts`）：pi 会话生命周期 reason 的类型化读取（reload/new/resume/fork/quit），替换六个扩展文件里散落的 `as { reason?: unknown }` 强转；各站点只与枚举字面量比较，语义逐字保持。
- 琐碎：删除 jero-ai-rdd-status.ts 中重复粘贴两次的预算论证注释块（escapeControlChars 同名异义经核已历史性解决，无需动作）。

### 编排契约收编与 P2 清偿（2026-09-27：第五批）

- **共享字面量单一事实源**（`lib/agents-protocol.ts`）：`TOOL_PREFIX`/`PARENT_NOTIFICATION_TOOL`/`SUBAGENT_RUN_TOOL`、子进程身份环境标记 `AGENTS_CHILD_ENV`/`AGENTS_OWNED_IPC_ENV`、`TASK_STEP` 状态机词汇全部钉在 protocol（helpers 与 runner 的共同叶子层）。runner-core 内联的 thinking 级别表改用 `model-routing-authority.THINKING_LEVELS`；`jero.review-preflight` 消息类型常量与渲染器同址（`lib/jero-ai-review-select.ts`），jero-ai/jero-shell 两侧共用。七个文件的字面量引用全部改指常量。
- **SDD 预检头部探测收编**：jero-ai 派发门的防伪造检查改用 `sdd-preflight-intent.containsSddPreflightBlockHeader`（与权威正则同文件演进），删除弱化副本正则。
- **契约一致性巡检**（`tests/contract-consistency.test.ts`）：JD 双盲契约三处措辞（技能/_shared 正典/法官代理）、委托触发规则四处数值（jero 技能/orchestrator 提示）、`parseChildFrame` 拒绝原因与 `QUERY_REJECTION_ERRORS` 白名单的行为级 membership 全部钉住——改一处漏一处先在这里失败。`QUERY_REJECTION_ERRORS` 为此从 runner-core 导出。
- **P2 清偿**：删除文档先行未落地的 `metadata.tier` 制度（skill-authoring §4，清单项同步重编号）；`prompts/skill-creation.md` 收敛为指向 `jero-skill-creator` 技能与 skill-authoring 规范的薄入口（不再复述流程步骤，消除 1:1 双源）；三个超预算技能按渐进披露拆分——issue-creation（7.9KB→3.6KB，控件细则与私有文件脚本外置 references/）、branch-pr（5.6KB→2.2KB，分支/提交映射与 PR 模板外置）、release（4.9KB→2.4KB，命令序列外置为 runbook）。

### jero-ai 评审工具段外抽（2026-09-27：refactor/jero-ai-split 主件落地）

- **四个 `jero_review*` 工具注册外抽**至 `lib/jero-ai-review-tools.ts`（`registerJeroReviewTools`）：jero-ai.ts 从 ~1120 行降至 864 行，评审工具定义、lens 标签助手与同意子状态机全部迁出，闭包依赖（nativeReviewCli、候选视图注册表、同意注册表与回退键、同意时钟、子进程常任权限、会话权限助手）经 `JeroReviewToolContext` 显式传入。
- **可变提醒状态对象化**：`reminderSessionActive`/`reminderEpoch` 两个 let 收敛为 `reminderState` 持有对象，评审工具与 jero-ai 的事件处理器（session_shutdown/session_start/agent_end/tool_result 五处读写）共享同一引用——外抽后语义逐字保持。
- **命名棘轮记录决策**（jeroAiReview 8→9）：新文件是宿主侧工具注册（与既有 8 个 `jero-ai-review-*` adapter 同类），依赖 ExtensionAPI，不属可进 `lib/authority/` 的纯评审域。
- **docs manifest 门扩展**：`collectTools` 的工具名派生范围显式包含 lib/jero-ai-review-tools.ts（与 jero-agents `tool()` 前缀特例同理），19 工具清单不变。

### 扩展层"只注册不实现"第二批（2026-09-27）

- **jero-ai 兼容再导出块删除**：`extensions/jero-ai.ts` 不再充当 lib 的公共面（原 8 个 `export *`/具名再导出全部移除）；30 个测试文件 + `tests/fixtures/measure-orchestrator-prompt.mjs` 夹具改指各自的 lib 源（`jero-ai-testing-exports` / `jero-ai-model-routing-apply` / `jero-ai-model-config` / `jero-ai-review-consent`），扩展公开面收敛为 `jeroAi`/`createJeroAiExtension`。
- **skill-registry 引擎下沉**：`extensions/skill-registry.ts` 624 → 96 行，只剩生命周期装配与命令注册；扫描/frontmatter 解析/去重/指纹缓存/渲染/fs 监视/legacy 项目本副本隔离整体迁至 `lib/skill-registry-engine.ts`（机械平移）。两处刻意偏差：去重守卫的 `import.meta.url` 改由扩展显式传入（下沉后默认参数会在 lib 模块内求值，指向 lib 文件将使"项目本副本胜出"判定失效）；缓存指纹 SHA-1 → SHA-256（Mimosa 门建议；仅缓存变更检测用途，schema 版本 7→8 让旧缓存一次性 miss 自愈）。测试 `__testing` 导入同步改指 lib。
- 评审工具注册段（4 个 `jero_review*` 工具）的外抽经评估**暂缓**：与同意子状态机、候选视图注册表、会话权限助手的闭包交织重，需要通读全部交织点的独立会话，避免为拆而拆引入行为风险。

### 扩展层"只注册不实现"第一批（2026-09-26：结构化第二批）

- **sdd-init 探测引擎下沉**：`extensions/sdd-init.ts` 821 → 66 行，仅剩命令注册与预检/写盘编排；`walkProject` + 六族探测器 + config.yaml 渲染整体迁至 `lib/sdd-project-detect.ts`（机械平移，语义零改动），并首次获得直接测试覆盖（`tests/sdd-project-detect.test.ts`：Node/空目录/清单+Makefile 三族）。同时 sdd-init 改为直接 import `lib/jero-ai-model-routing-apply.ts` 的 `applySavedModelConfig`，不再经 jero-ai 扩展的兼容再导出。
- **jero-shell 业务函数下沉**：`shellGitRunner`/`loadFileDiff` → `lib/shell-changes.ts`（与 GitRunner 类型同址）；`fetchCodexUsage` → `lib/shell-usage.ts`（与解析函数同址）。`openInExternalEditor` 经评估**保留在扩展层**——其 win32 `shell: true` 是 .cmd 编辑器垫片（如 VS Code 的 code.cmd）的必要路径，属既有信任边界（与 git 的 EDITOR 集成同级），不为此重构真实行为。
- **子代理问答直通**（`extensions/jero-agents.ts`）：父会话收到的提问消息在 Task ID/Request ID 行之外追加免抄写的回复调用模板（`task_id="<id>" and request_id="<rid>"`），父模型不再需要从自由文本转写两个关联 ID——转写错一位即断链。测试同步钉住该模板。

### AI 协作友好化第一批（2026-09-26：评审报告 P0 + memory 缺陷修复）

#### 悬空指针与漂移清理（P0）

- **活提示里的幽灵命令**：`assets/orchestrator.md` 与 `assets/orchestrator-delegation.md` 引用的 `/jero-sdd-new`、`/jero-sdd-ff` 全仓无注册（实际为 `/jero-sdd-init`/`/jero-sdd-continue`）——这两份文档注入每个父会话，修正为真实命令名。
- skills：`skill-registry` 的 Engram 残留措辞改为自有 `mem_save`（`topic: skill-registry`）、删除死链 `_shared/skill-resolver.md`；`work-unit-commits` 移除全仓无实现的会话键 `review_budget_lines`。
- README 命令计数 22 → 25（与 docs manifest 对齐）。
- 新增仓库根 `AGENTS.md`：布局地图、三条铁律（新评审代码进 `lib/authority/`、夹具进 `-shared.ts` 且分片禁互导、`runtime/` 生成物纪律）、按域验证回路、`_tools/*.md` 相对仓库根解析的层级说明——补齐 AI 代理入口自述的缺位。

#### 死代码删除（P0）

- `lib/review-consent-latch.ts` 整文件 + 其测试：生产零引用（唯一 importer 是自己的测试）。评审域命名棘轮随之下移（review 33 → 32）。
- `lib/authority/client-contract-decode.ts` 移除 exec 时代零引用解码链约 300 行：`decodeReviewStartResponse`、`decodeNativeMaintenanceResult`、`decodeLegacyReconcileAudit`、`decodeReviewTransaction`（及 `decodeSnapshot`/`decodeFinding`/`decodeLensResult`/`decodeFindingEvidence`/`decodeValidationCheck`/`decodeReleaseEvidence` 整条辅助链）、`decodeDeclinedConsentStart`、`decodeNativeAdmittedResultManifest`、`decodeNativeProviderRoleCaptureArtifact`、`decodeNativeUnachievableLensCaptureArtifact`、`parseJson`、`decode` 包装器、`assertSupportedNextTransitionOperation`、`nativeError`/`nativeProcessDiagnostics`、`canonicalNativeReviewCwd`/`repositoryPathIdentity`/`repositoriesMatch`、`providerProcessEnvironment`、`sha256Identity`、`decodeSelectedLenses`、`hasCanonicalSelectedLenses`/`hasValidLensesRequired`、`NativeJsonExecution`/`NegotiatedExecution`/`NativeReviewAdmittedResultManifest`，`normalizeNativeReviewCwd` 取消导出（仅内部使用）。runtime 生成物同步再生成。

#### 增量验证回路（P0）

- package.json 新增域脚本：`test:authority`（+ 复合 `test:authority:full`：runtime 再生成 → 域测试 → 一致性 → 边界检查）、`test:agents`、`test:review`、`test:sdd`、`fix:docs-manifest`（`--write` 别名）。

#### memory 缺陷修复（P1）

- **索引锁释放加所有权校验**（`lib/memory.ts`）：锁目录内新增持有者令牌文件；释放前比对，令牌缺失或已易主（陈旧接管后）绝不删除——堵住"原持有者迟到的 `rmSync` 误删接管者新锁、打开第二个双持有窗口"的竞态。`rebuildMemoryIndexIfLockable` 的 EEXIST 分支同步收敛为保守跳过（对齐其文档注释"锁被占用时跳过重建"，读路径绝不抛错）。
- **条目与索引 0600**：`atomicWrite` 创建即收紧权限（Windows 忽略 mode）；记忆正文可能含敏感内容，对齐 agent-profiles/presence 的既有纪律。
- **父子记忆根统一**：新增 `JERO_PI_MEMORY_ROOT` 显式覆盖（优先级：显式 env > 项目 `.jero/memory` > 全局），`buildRequest` 把父会话解析出的记忆根下传给每个子代理——子代理在 worktree 中按 cwd 解析会与父会话静默分叉，违背"子保存、父检索"委派契约；显式设置时不覆盖。`tests/jero-agents.z2` 的 spawn env 断言同步为"子进程继承父根"。

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
