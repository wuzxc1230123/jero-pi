# jero-pi 基准（benchmarks）

度量 jero-pi harness（含精益纪律 lean discipline）对真实 agent 产出的影响。
本目录是**开发期工具**：不在 `package.json` 的 `files` 清单内，不随包发布；
运行器零依赖（Node 内置模块），不发起任何网络请求——agent 命令由你显式提供。

方法论借鉴 ponytail 的 agentic 基准（真实 agent 会话、多臂对照、安全对抗层、
诚实边界），度量对象换成 jero-pi 自己的臂。

## 臂（Arms）

| 臂 | 环境变量 | 含义 |
|---|---|---|
| `baseline` | `JERO_PI_LEAN_MODE=off` | 历史行为，无精益注入 |
| `lean-full` | `JERO_PI_LEAN_MODE=full` | 默认档：梯子强制 |
| `lean-lite` | `JERO_PI_LEAN_MODE=lite` | 只点名替代方案 |
| `lean-ultra` | `JERO_PI_LEAN_MODE=ultra` | YAGNI 极端主义 |

对照纪律：每臂 × 每任务在**全新工作区副本**上运行，臂间唯一差异是上述
环境变量；建议每格 n≥3 取中位数。

## 指标

- **added_lines**：任务完成后 `git diff --numstat` 对 HEAD 的新增行合计，
  剔除 `tests/`、lockfile 与构建产物（测试行数单独记录为 `wrote_tests`，
  是正向信号，绝不从 LOC 指标里"省"掉）。
- **wall_ms**：任务墙钟时间。
- **check**：safety 层任务的对抗性校验命令（见下），结果为 `pass|fail|error`。
- **tokens/cost**：不由本运行器测量。会话内的真实用量请用包内
  runtime-metrics / Agents 视图读取；本目录绝不伪造该数字。

## 安全对抗层（safety tier）

LOC 指标可能被"砍掉守卫"赢下——这正是 ponytail 基准里
yagni-oneliner 臂栽跟头的地方。`tasks/safety-*.md` 把安全需求**隐含**
在工单文本里（不明说"注意安全"），并在任务元数据里声明一条
`check:` 命令，对产出代码执行对抗输入验证。任何臂若在削减 LOC 的
同时让 check 失败，即判定该臂不安全，其 LOC 数字不作数。

## 诚实边界

- 绝不宣称"某仓库因此节省了 X 行/token"：未写出的代码没有基线。
  本目录只比较**臂间**差异。
- 样本太小（n<3）时只报告原始数字，不外推结论。
- 简洁散文提示不是对照臂的正解：如需验证"精益纪律是否只是『话少』"，
  请自建 caveman 式控制臂（等价 token 的简洁风格提示），再下结论。

## 运行

```sh
node benchmarks/run.mjs --list
node benchmarks/run.mjs --repo /path/to/target-repo \
  --command 'pi -p "{ticket}"' \
  --arms lean-off,lean-full --tasks loc-01,safety-01 \
  --out benchmarks/results/manual-$(date +%Y%m%d).json
```

`--command` 是必填模板：`{ticket}` 展开为工单文本，`{workspace}` 展开为
该次运行的工作区路径。运行器对每个 `(arm, task)` 组合：

1. `git clone --local <repo> <tmp>/arm-task` 并以工作区初始状态为基线；
2. 在该目录内以臂的环境变量执行命令模板（shell 逐字执行，注意引号）；
3. 度量 `git diff --numstat` 与墙钟时间；safety 任务追加执行 `check:`；
4. 汇总写出 JSON（附完整元数据，可离线重算）。

`--dry-run` 只打印将执行的命令矩阵，不运行、不写结果。

## 任务集（tasks/）

工单按 ponytail 的两层组织：

- `loc-*.md` — 一句话特性工单，度量新增行数（date/color 输入框这类
  "易过度建设"陷阱刻意在内）。
- `safety-*.md` — 安全需求隐含的有界实现工单，带对抗性 `check:`。

新增任务时保持工单与语言无关的一句话格式，safety 任务必须提供
可离线执行的 `check:` 命令。
