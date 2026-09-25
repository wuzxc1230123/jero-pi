# benchmarks/results/ — 基准结果留存

`run.mjs` 默认把每次运行的完整报告写到这里（`--out` 可重定向）：

- `<startedAt 时间戳>.json` — 一次运行的全量存档（臂、任务、wall_ms、
  diff 计量、safety check、agent 状态与 stderr 尾部），永不覆盖。
- `latest.json` — 最新一次运行的指针副本，供快速引用。

引用纪律：在任何文档或讨论中引用基准数字时，必须指明来源的时间戳
存档文件；`latest.json` 只反映"最近一次"，不保证 n≥3。
