# benchmarks/results/ — 基准结果留存

`run.mjs` 默认把每次运行的完整报告写到这里（`--out` 可重定向）：

- `<startedAt 时间戳>.json` — 一次运行的全量存档（臂、任务、wall_ms、
  diff 计量、safety check、agent 状态与 stderr 尾部），永不覆盖。
- `latest.json` — 最新一次运行的指针副本，供快速引用。

引用纪律：在任何文档或讨论中引用基准数字时，必须指明来源的时间戳
存档文件；`latest.json` 只反映"最近一次"，不保证 n≥3。

当前状态：本目录尚无真实 agent 运行存档（真实多臂对照需 LLM API 配额，
待执行）。运行器管道已于 2026-09-25 用假 agent（写固定源/测试文件）完成
端到端冒烟：克隆、臂环境变量、diff 分桶计量（added/wrote_tests）、safety
层对抗 check 执行与判级、结果落档全链路验证通过；冒烟报告按纪律不写入
本目录（数字无基准含义）。
