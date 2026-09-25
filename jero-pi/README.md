# jero-pi

面向 [Pi coding-agent](https://github.com/earendil-works) 的扩展包（pi-package）：把评审权威、SDD/OpenSpec 流程、子代理编排、持久记忆与精益纪律全部收进一个进程内 Node 包——零原生二进制、零安装期网络。

要求 Pi ≥ 0.85.1（经测试验证的最低版本）。

## 核心能力

- **进程内评审权威**（`lib/authority/`）：START → 同意 → relay 评审视角 → 冻结/分类 → 有界纠正 → 定向校验 → 确认销毁 → 维护。状态存于 `.git/jero-review/`，随仓库走；actor 产物（模型输出）永远是无信托数据，不能授权任何状态转移。评审结果与回执状态只作信息展示；commit、push、PR、发布等交付遵循普通仓库策略。
- **子代理编排**：单父会话编排，`subagent_*` 工具族 + 全屏 Agents 视图，每任务 token/成本核算；危险命令三层防护（硬拒绝 / 受守命令 / 自治模式）。
- **SDD/OpenSpec**：`/jero-sdd-init` 探测技术栈并落配置；确定性阶段状态引擎（proposal/spec/design/tasks/apply/verify/sync/archive）；严格 TDD 证据（RED/GREEN/TRIANGULATE/REFACTOR）。
- **持久记忆**：`mem_save` / `mem_read` / `mem_list` / `mem_search`，topic 键 Markdown 文件 + 轻量索引，零数据库、零原生模块。
- **精益纪律**（借自 ponytail 的"懒惰资深工程师"）：七级梯子写入节制 + `/jero:lean` 分档（off/lite/full/ultra，会话条目持久化，`stop lean` 一句话关闭）+ `jero:` 简化标记与 `/jero:debt` 债务台账 + `jero-lean-review` 独立精益评审。纯提示词层增强，`off` 完全还原历史行为。
- **Shell 层**：底部状态栏（git / 模型 / 上下文窗口 / 会话成本）、侧栏、变更小部件与 diff 视图、订阅用量窗口、主题（Jero / Jero-Cute / Jero-Sexy）。

## 安装与使用

```sh
pi install <本包来源>        # 首次安装
/jero:doctor                 # 体检：资产、OpenSpec、技能注册表、模型配置、精益档位
/jero:status                 # 包状态总览
/jero:sdd-preflight          # 会话 SDD 预检
/jero:lean ultra             # 切换精益档位（off/lite/full/ultra）
```

评审生命周期动词（`inspect` / `start` / `answer-consent` / `assess` / `finalize` / `validate`）是 `jero_review` 工具的操作，不是斜杠命令。

## 开发

```sh
pnpm install
pnpm test            # 单测 + runtime harness（真实扩展装配 × 假宿主端到端）
pnpm typecheck       # 诊断棘轮（scripts/types-baseline.json）
pnpm run check:runtime-modules
```

打包门：`prepack` 依次跑全量测试、runtime 模块一致性、权威边界检查、打包文件核验；`prepublishOnly` 追加 packed-tarball 分发链校验。CI 另有断网测试门与 Windows 权威回归。

基准工具（不随包发布）：`benchmarks/` 以多臂对照度量精益纪律对真实 agent 产出的影响，含安全对抗任务层。

文档：

- 技术参考：[docs/jero-reference.md](docs/jero-reference.md)——由当前代码状态生成的单一合并文档：架构分层、22 个命令、工具清单、评审生命周期、精益纪律、SDD/编排、契约与环境、测试与打包门。
- 入门教程：[docs/tutorial-first-review.md](docs/tutorial-first-review.md)——从安装到第一次通过评审的最小闭环。
- How-to：[docs/how-to-choose-discipline.md](docs/how-to-choose-discipline.md)——评审 / SDD / 精益三根轴怎么选档，以及轻量出口（assess、triviality_hint、RDD 开关）。
- 供应链：[docs/dependency-exit-plan.md](docs/dependency-exit-plan.md)——9 个伴生依赖逐项的失效信号与退出预案。

> 移植纪律：包身份从出生即 `jero-pi`；上游命名仅存于白名单（wire 金向量词汇、外来存储探测名、legacy 回退读、历史 fixture、上游参考文档）。
