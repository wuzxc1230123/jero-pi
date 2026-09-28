# jero-pi 扩展指南——零代码添加技能、子代理与语言包

写给要在**不改动 jero-pi 包代码**的前提下扩展领域能力（C#/Godot/Unity/Java 等）的使用者：如何添加技能与子代理、如何让它们在既有流程里被自动使用、如何避免错误、以及什么时候才值得升级为代码改动。

**两条路径**：本文描述的是**松散资产**（`.pi/skills/` + `.pi/agents/` 各自为文件，legacy 路径）；推荐路径是**契约化模块**（`.pi/modules/{token}/module.json` 一份清单声明触发/知识/角色/接线，安装验证 + 派发覆盖层机器保证）——规范见 `docs/module-contract.md`，自动创建走 `/module-creation`（默认生成契约化形态）。两条路径共存：无清单即 legacy，有清单即契约化；本文的放置机制与错误避免知识对两条路径都适用。

与既有文档的分工：`docs/skill-authoring.md` 管**包内** `skills/` 目录的技能写作（命名前缀由测试机器钉住）；本文管**包外**（目标项目 `.pi/`、全局、伴生 npm 包）的扩展——机器质量门管不到的地方，纪律替代门禁（契约化模块的部分由 `/jero-module-verify` 与 `check:module-contract` 门接管）。

**创建路径**：手工按本文各节模板创建即可；自动创建用 `/module-creation`（整套领域模块：技能 + 子代理 + 命令钉住 + 冒烟检查）或 `/agent-creation`（单个子代理），自主触发走 `jero-module-creator` / `jero-agent-creator` 技能。两个创建器内置本文的模板与检查单——本文仍是放置机制与错误避免的单一事实源，创建器只是执行它的流程。

---

## 1. 扩展模型总览

| 资产 | 放置位置 | 自动加载 | 自动使用 | 机制强度 |
|---|---|---|---|---|
| **契约化模块** `.pi/modules/{token}/`（**主路径**） | 项目/全局模块根 | 机制保证（注册表 + 覆盖层自动刷新） | 机制保证（静态触发机器判定、八面注入档位、路由表委派审计） | 强（八查安装验证） |
| 技能 `SKILL.md`（松散） | 项目 `.pi/skills/<名>/` 等 | 机制保证（索引自动刷新） | 机制保证（编排器按 description 匹配注入） | 强 |
| 子代理 `*.md`（松散） | 项目 `.pi/agents/` 等 | 机制保证（递归发现） | **提示层**（需技能路由指示或点名委派） | 中 |
| `openspec/config.yaml` | 目标项目（`/jero-sdd-init` 生成后手改） | — | 机制保证（Verification 契约优先读） | 强 |
| 链 `*.chain.md` | 包内受管资产 | 受管安装 | 固定序列 | 零代码下**不可扩展** |

契约化模块是推荐路径——一个目录一份 `module.json` 声明全部四个面，添加即机器接线（规范见 `docs/module-contract.md`）；本文其余章节管**松散资产**的编写，以及**所有路径共用**的放置机制与错误避免。同一词元不允许同时存在两种形态（安装验证的 no-loose-duplicate 查会拒绝——同一知识双源必漂移）。

两个不变量决定了这套模型可以无限叠加：

1. **核心流程不消费扩展资产本身**。评审权威走 git 对象、SDD 走状态机，读的是仓库事实与 config.yaml。叠加资产对既有流程是纯增量——最坏情况是新资产没被用上（静默失效），评审与 SDD 照常运行，不会崩。
2. **发现是目录约定**。加第十个包和加第一个包走完全相同的机制，没有注册表要维护、没有清单要更新、不受 jero-pi 升级影响。

代价的不对称要记住：**知识与命令是机制性自动生效的；专用子代理的委派是"技能指路、编排器照办"的半自动**（高概率、可审计，非编译期保证）。若某代理必须每次机制性必跑：先在模块清单声明 `pipeline.gate`（覆盖层响亮明示缺席，编排器不得静默跳过），真正安装的唯一路径是进链——见第 8 节升级路径。

---

## 2. 放置位置与发现机制

### 2.1 技能根（`lib/skill-registry-engine.ts` 扫描）

- **项目级**（按目标项目 cwd）：`skills/`、`.pi/skills/`、`.atl/skills/`、`.claude/skills/`、`.agents/skills/` 等 17 个约定路径。
- **全局级**（按用户主目录）：`~/.pi/agent/skills/`、`~/.claude/skills/`、`~/.codex/skills/` 等 19 个约定路径。
- 索引产物是 `.atl/skill-registry.md`——**自动生成物，勿手改**。会话启动自动重建（`extensions/skill-registry.ts` 的 `session_start` 钩子），另有递归文件监视器实时重建（尽力而为；监视不被支持时退回启动刷新）。手动兜底命令：`/skill-registry:refresh`。

### 2.2 子代理发现（`lib/jero-ai-model-config.ts`、`lib/agents-config.ts`）

- 递归扫描 markdown（跳过 `skills/` 子目录与 `*.chain.md`），解析 frontmatter 取 `name`。
- 发现顺序：全局 `~/.pi/agent/{agents,subagents}` → 项目 `.pi/{agents,subagents}`，**同名时项目静默覆盖全局**（这是第 6 节头号风险来源）。

### 2.3 放哪的决策表

| 形态 | 选择性来自 | 适用 |
|---|---|---|
| **A. 项目级**（推荐默认） | 目标项目只放需要的包 | 单团队/单项目起步 |
| **B. 独立 npm 伴生包** | 项目装哪个包就有哪种语言 | 团队级分发；照 `pi-fovea`/`pi-lens` 形态（技能根需落在 2.1 约定路径之一，最省事是安装时落 `.pi/skills/`） |
| **C. 全局装全量** | 靠 description 仓库特征门控触发收敛 | 个人多项目；牺牲项目隔离 |
| 包内 `assets/` | 无（受管安装到共享代理主目录，全项目生效） | **零代码边界之外**，见第 8 节 |

---

## 3. 编写技能（项目级）

单个技能的自动创建走 `jero-skill-creator`；领域整套（技能 + 代理）走 `jero-module-creator`，其 `assets/module-skill.template.md` 即本节结构的模板化。手工创建按下述规范。

### 3.1 frontmatter 契约

```markdown
---
name: godot
description: 当仓库含 project.godot、Godot 生成的 .csproj/.sln，或任务涉及 Godot、.tscn 场景、节点、信号、GodotSharp 时使用。涵盖 C# 游戏开发惯例、dotnet 命令与评审清单。
---
```

只有 `name` 与 `description` 两个字段。description 是**给模型看的触发语**，触发措辞双轨制、渐进披露、禁止在 description 里总结流程等纪律与包内技能相同——细则见 `docs/skill-authoring.md` 第 1、3 节，此处不重复。

### 3.2 门控词写法（决定触发可靠性）

- 门控词用**精确文件名**（`project.godot`、`pom.xml`、`go.mod`、`*.csproj`），不用宽泛概念词（"游戏引擎"会在别的引擎仓库误触发）。
- 同时覆盖两类触发：**仓库特征**（文件名）与**任务词**（用户说"Godot""场景""信号"时）。
- 多个语言包并存时，门控词集合必须互斥，否则互相抢路由。

### 3.3 结构：短正文 + 深引用

```
.pi/skills/godot/
├─ SKILL.md                 # 短：门控、身份、委派指示、指向 references
└─ references/
   ├─ csharp-conventions.md # dotnet 命令、测试策略、C# 惯例
   ├─ godot-conventions.md  # 节点/场景/信号/生命周期
   └─ game-design.md        # 领域设计知识
```

SKILL.md 保持短（每次命中都会被完整注入子代理上下文），深度全放 `references/` 由子代理按需读。

### 3.4 委派指示段（让子代理被自动使用的关键机关）

SKILL.md 正文写一段显式路由，编排器消费注入的技能后照指示委派：

```markdown
## 委派路由
- 需求/玩法/系统设计分析：委派 godot-designer 代理产出提案。
- 评审 C#/Godot 变更时：在常规评审之外追加委派 godot-reviewer 代理。
- 执行实现：直接使用 jero-worker（本技能注入的语言知识随之生效）。
```

契约化路径下这一段是 manifest 的 `routing` 数据——编译进覆盖层路由表供编排器求值（见 `docs/module-contract.md`）；本节的散文写法仅用于松散技能。两条路径的共同纪律不变：这里引用的代理名（含包内 `jero-worker` 等）相当于你依赖的 API 面，写错一个字母委派就会静默不发生。第 7 节检查单第 4 步专门抓这个。

### 3.5 自动使用的完整链路（机制保证的部分）

宿主按 description 自主触发（顶层会话）＋ 编排器注册协议（子代理任务）：编排器每会话一次读 `.atl/skill-registry.md`，把任务上下文与 Trigger/description 列匹配，命中的精确 `SKILL.md` 路径经 `## Skills to load before work` 注入子代理；子代理被禁止自行重新发现注册表，只消费注入路径。子代理回报 `skill_resolution` 四态（`paths-injected` / `fallback-registry` / `fallback-path` / `none`），出现回退态即视为编排缺口，下次委托会被纠正——这是可审计性的来源。

### 3.6 技能 vs 斜杠命令

包内的显式流程入口做成 `prompts/*.md` 斜杠命令；项目级没有注册命令的能力（那需要 extension 代码），**显式入口也只能做成技能**——用 description 里的显式触发短语门控（"当用户说 /godot-review 或要求引擎专项评审时使用"）。

---

## 4. 编写子代理（项目级）

自动创建走 `/agent-creation`（`jero-agent-creator` 技能），其 `assets/` 内置本节的两类代理模板。手工创建按下述规范。

### 4.1 frontmatter 契约（与包内代理同格式）

```markdown
---
name: godot-reviewer
description: Godot/C# 领域只读评审——场景结构、信号滥用、节点泄漏、序列化陷阱。
tools:
  - "*": false
  - read
  - grep
  - find
  - jero_review_scope
---

你是 Godot 领域评审者。只报告发现，不修复……
```

字段：`name` / `description` / `tools`（`"*": false` 关默认再开允许清单是只读代理的标准写法），可选 `model` / `thinking` / `mode`。

### 4.2 何时做代理，何时只做技能

**代理的价值在角色与权限面不同，不在语言知识。** 判断标准：

- 需要**不同工具权限**（只读评审 vs 可写执行）→ 值得做代理。
- 需要**不同产出角色**（设计提案 vs 实现代码）→ 值得做代理。
- 只是"多了一门语言/框架的知识" → **不做代理**，知识进技能注入给通用子代理（`jero-worker`、`sdd-design` 等）。单独做一个与 jero-worker 同角色的语言执行代理，只会制造一个不会被自动委派的孤儿。

反例警示：语言子代理（csharp-worker）、游戏执行子代理通常都该裁剪掉，留下的应该是领域评审代理与设计代理这类权限/角色真正不同的实体。

### 4.3 委派入口（为什么是"半自动"）

子代理被使用只有三个通道：链引用、编排器委派、用户点名。**固定链（`4r-review.chain.md`、`sdd-*.chain.md`）按名引用固定代理序列，不含你的代理，且是受管资产不可改**（见 6.4）。因此项目级代理的常态入口是"技能路由指示 → 编排器委派"（3.4 节），点名委派是兜底。

---

## 5. 语言包模式（完整模板）

自动创建整套模块说一句"创建 {领域} 模块"或跑 `/module-creation`——`jero-module-creator` 会按 `assets/interview.md` 访谈后生成契约化模块并跑 `/jero-module-verify` 安装验证。手工创建时以 `docs/module-contract.md` 为规范、`skills/jero-module-creator/assets/` 的金样（`module-manifest.template.json` + `module-entry.template.md`）为起点。一个语言包 = 一个自包含目录：

```
.pi/modules/{token}/
├─ module.json               # 契约清单：触发/知识/角色/接线/路由/配置
├─ knowledge/
│  └─ SKILL.md               # L1 入口（≤60 行，注册表可见）
└─ references/               # L2 深度知识（惯例/命令/评审清单/设计知识）
.pi/agents/{token}-reviewer.md   # 角色按需（须在 manifest roles 中声明）
```

外加一次性数据动作：跑 `/jero-sdd-init`，把测试命令钉进 `openspec/config.yaml` **并写进清单 `config.testCommand`**（后者的优先级更高——它是 Strict TDD 转发取值链的第一级：覆盖层 → config.yaml → 兜底探测，三方共享同一真相）。

### 5.1 各语言现状（决定包内要补偿什么）

| 语言 | 探测器现状（`lib/sdd-project-detect.ts`） | 语言包需要补偿 |
|---|---|---|
| Go | **已内置**（`go.mod` → go test 等，strictTdd 自动成立） | 只补惯例知识 |
| Java | 仅 marker 识别（pom.xml/build.gradle），无命令探测 → strictTdd 为 false | config 模板钉命令 + 惯例知识 |
| C#（纯 .NET） | 无识别 | 同上（`dotnet test/build/format`） |
| Godot/C# | 无识别 | 同上 + 引擎惯例 |
| Unity/C# | 无识别，且 `Library/Temp/Logs/obj` 不在 IGNORED_DIRS，超大仓库可能吃掉 2 万文件扫描预算 | 同上 + `.gitignore` 纪律 + 测试命令包装 |

未识别栈的行为是**优雅降级**（"Unclassified software project"、`strict_tdd: false`、要求手动验证），不是失败——语言包的存在就是把降级档补偿回正常档。

### 5.2 引擎特有注意点

- **Godot**：`project.godot` 是精确文件名，门控词简单；`.godot/` 缓存目录必须 gitignore（评审走 git 对象，忽略后天然干净）；集成测试走 `godot --headless`，但优先策略是逻辑与引擎解耦后用 `dotnet test`。
- **Unity**：`Library/` 等目录必须 gitignore；Unity Test Framework 无廉价 headless CLI（需编辑器批处理），推荐在目标项目放 Makefile 包装批处理测试命令——现有 `detectMakefile` 能承接 `make test` 形态，config 里钉 `make test` 即可。

---

## 6. 错误避免（按严重度排序）

### 6.1 同名覆盖——唯一能真正破坏流程的向量

项目级代理与包内代理同名会**静默遮蔽**包内代理：链还在跑，但同名环节的行为已被你的文件顶掉。防御只有一条纪律：

> **一个模块一个领域词元**（`godot`、`cs`、`java`、`unity`）：技能名 = 词元（`.pi/skills/godot/`），代理名 = `词元-角色`（`godot-reviewer`、`godot-designer`）——技能与代理共用同一词元，禁用近义词干（有了 `godot-*` 就不再出现 `game-*`/`godot-cs-*`）；`references/` 是内容文件，用描述性名。永不与包内前缀族（`jero-*`、`review-*`、`sdd-*`、`jd-*`）重名。

### 6.2 静默失效族——最常见的实际问题

三种失效都不报错：

| 失效 | 表现 | 检测 |
|---|---|---|
| frontmatter 格式坏 | 代理解析返回空被静默过滤，等于不存在 | 检查单第 1、4 步 |
| description 门控词写偏 | 技能进索引但不被匹配注入 | 检查单第 2、3 步 |
| 委派指示里代理名打错 | 编排器照常工作但委派不发生（`skill_resolution` 只审计技能加载，不审计代理委派） | 检查单第 4 步 |

### 6.3 规模化退化——资产多了之后的慢性病

- **description 重叠抢路由**：两个技能的门控词有交集时会互相误触发。防御：门控词集合互斥、用精确文件名。
- **多命中上下文膨胀**：门控太宽的多个技能同时命中会成倍膨胀注入上下文。防御：SKILL.md 短、深度放 references、门控收紧。

### 6.4 受管资产与生成物——禁改清单

| 禁改 | 原因 |
|---|---|
| 包内 `assets/agents/*.md`、`assets/chains/*.chain.md`、`assets/support/*`（及其安装副本） | 受管资产带锁与清单，包升级整体替换，改动被冲掉 |
| `.atl/skill-registry.md` | 自动生成物，手动改动下次刷新即失效 |
| `runtime/*.mjs` | 生成物（仓库铁律 3） |

往固定链里挂代理的唯一合法路径是进包加新链——那是代码改动，见第 8 节。

### 6.5 升级交互

- 项目级 `.pi/` 文件不受 jero-pi 升级影响（受管安装只碰代理主目录与包资产）。
- 但技能文本引用的包内代理名（`jero-worker`、`sdd-design` 等）是你的依赖面——大版本若重命名代理，提示层路由会断。防御：每次升级 jero-pi 后跑一遍第 7 节检查单。
- 包内质量门（docs manifest、命名棘轮等）**不覆盖项目级资产**：零维护成本的另一面是零护栏，纪律全部靠本文。

---

## 7. 冒烟检查单（每加一个包 5 分钟）

**第 0 步（契约化模块）**：跑 `/jero-module-verify`——八查全绿 + `.atl/module-overlay.md` 生成，就是下面第 1–4 步的机器版（触发命中/路由解析/防遮蔽/entry 行数全部自动钉住），只需再人工确认第 5 步无重名。以下五步仅松散资产需要人肉执行：

1. **技能计数**：会话启动看启动通知的技能计数是否 +N。没加上 = frontmatter 坏了。
2. **索引在列**：打开 `.atl/skill-registry.md`，确认新技能在列且 Trigger 列含你的门控词。不在 = 解析失败。
3. **匹配注入**：问一句"这个仓库是什么技术栈"，确认编排器注入了新技能（子代理回报 `paths-injected`）。不注入 = description 写偏。
4. **委派可达**：点名让新代理做一件小事。委派失败 = 代理名/frontmatter 问题。
5. **无重名**：比对新代理/技能名与包内前缀族（`jero-*`、`review-*`、`sdd-*`、`jd-*`）无重合。重合 = 遮蔽炸弹。

---

## 8. 何时升级为代码改动（升级路径）

零代码方案的 95 分足够长期运行；以下信号出现时才考虑下沉，且每步都是增量、无返工：

| 信号 | 动作 | 改动面 |
|---|---|---|
| 某评审代理必须**每次**机制性必跑 | 先在模块清单声明 `pipeline.gate`（覆盖层响亮明示缺席，编排器不得静默跳过），再进包加链真正安装：`assets/chains/` 新链文件 + `ASSET_OWNER_BY_KEY`（`lib/sdd-preflight-assets.ts`）加一行 | 一行数据表 + 资产文件；跑 `pnpm run test:review` 等（见 `AGENTS.md` 验证回路） |
| 多个语言项目重复使用，子代理验证命令经常漂移 | P0 探测器：`IGNORED_DIRS` 补引擎缓存目录 + 新增 `detectDotnet`（`lib/sdd-project-detect.ts`） | 约 20 行；夹具放 `sdd-project-detect-shared.ts`（铁律 2） |
| 风险分层把 `.csproj/.sln` 全归默认档影响排期 | P1 风险正则：`lib/authority/review-risk.ts` 路径 token 补 .NET 生态 | 数行 |
| 包内代理的 JS 测试惯例提示质量不足 | P2 提示词：`assets/support/strict-tdd.md` 等补语言示例 | 资产文件 |
| 语言能力要随包发布给所有用户 | 技能进包 `skills/`（零代码，但受 `skill-authoring.md` 前缀规则约束）+ `pnpm run fix:docs-manifest` | 数据 + 命令 |

原则：**能用知识（技能）解决的不要用代码解决；代码下沉只发生在"机制保证"成为硬需求的那一刻。**

---

## 9. 机制速查附录

| 文件 | 职责 |
|---|---|
| `lib/skill-registry-engine.ts` | 技能根扫描（项目 17 + 全局 19 + 项目/全局模块知识根）、索引渲染、缓存与监视 |
| `extensions/skill-registry.ts` | `session_start` 自动刷新 + `/skill-registry:refresh` 命令 |
| `assets/orchestrator-skills.md` | 编排器技能注册协议（含第 5 步：按覆盖层档位收窄注入）、`## Skills to load before work` 注入、`skill_resolution` 审计 |
| `assets/orchestrator-delegation.md` | 编排器委托细则与「自然语言路由单」（R1–R4） |
| `lib/jero-ai-model-config.ts` | 代理递归发现（排除 `.chain.md` 与 `skills/`） |
| `lib/agents-config.ts` | 代理 frontmatter 解析、全局→项目发现顺序与同名覆盖 |
| `lib/sdd-preflight-assets.ts` | 包内受管资产清单（`ASSET_OWNER_BY_KEY`）、锁与安装 |
| `lib/sdd-project-detect.ts` | 栈/命令探测（Node/Go/Rust/Python/泛型/Makefile）、`IGNORED_DIRS` |
| `assets/support/strict-tdd.md` | Verification 契约：缓存能力 → config.yaml → 兜底探测 |
| `docs/skill-authoring.md` | 包内技能写作规范（触发双轨制、前缀棘轮、行为验证） |
| `docs/module-contract.md` | 契约化模块的规范单一事实源（清单字段/编排面/八查/保证谱） |
| `lib/module-contract.ts` · `lib/module-trigger-compiler.ts` | 模块契约执行面：清单解析/八查/静态触发编译/覆盖层渲染 |
| `extensions/module-verify.ts` | `/jero-module-verify` 安装验证 + 覆盖层刷新与模块根监视 |
| `skills/jero-module-creator/` | 领域模块脚手架技能：访谈清单、契约金样、config 钉住模板 |
| `skills/jero-agent-creator/` | 单个子代理创建技能：reviewer/designer 两类代理模板 |
| `prompts/module-creation.md` · `prompts/agent-creation.md` | 显式创建入口（薄转交，不复述流程） |
