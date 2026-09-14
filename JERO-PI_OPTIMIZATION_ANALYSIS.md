# jero-pi 优化建议（保持现有编排逻辑不变）

> 基于 `sdd-agents.ts`、`autotune.ts`、`scan-guard.ts`、`conversation-resume.ts`、`spec-merge.ts`、`sdd-config.ts` 等源码的完整阅读。
> 前提：**不改动现有编排逻辑**（orchestration-first SDD、门禁、TDD、审查小队等核心架构），在既有机制内找优化空间。

## 一、迭代恢复：把"全量重跑"变成"定向修复"（收益最高）

**现状**：veredicto 判 `corregir` 就重跑整个 build、判 `replantear` 就重跑整个 plan（`autotune.ts` 的轮次归因正是建立在"重跑全阶段"之上）。多轮循环时 token 浪费严重，且下一轮 build 往往重犯上一轮的错。

**优化建议**：
1. **缺陷清单回传**：`corregir` 时 veredicto 输出结构化缺陷清单（severity / 文件 / 问题 / 修复方向），build 按清单逐条修，不再重读全量任务。
2. **按失败类型分流**：安全缺陷 / 功能缺陷 / 覆盖率不足走不同修复路径——覆盖率不足只补测试不动实现。
3. **replantear 注入拒绝理由**：把 veredicto 的否决理由写入新 plan 的"约束段"，避免第二轮重蹈覆辙（现在只是换模型/换档位重跑）。

## 二、上下文与 token 成本：阶段间产物瘦身

**现状**：build 的输入是完整 plan 产物 + findings + spec；三个 `jero-verify-*` 各自携带完整上下文，veredicto 再聚合三份长文——大 feature 上这是最大的成本来源。

**优化建议**：
1. **explore→plan 传"决策证据摘要"**：只留影响决策的文件路径 + 结论行，不做全文搬运。
2. **verify 输出结构化 JSON findings**（severity/file/line/rule），veredicto 只消费 JSON + 少量证据，而不是三份散文。
3. **切片级任务卡**：build 只携带自己负责的切片 + 关联 spec 条目，不背整个 spec.md。
4. **推广产物预算**：explore 已有预算概念，可推广到 plan/tasks 的工件长度上限，防"越长越笨"。

## 三、数据可观测性：RunRecord 信息密度不足

**现状**：`~/.pi/jero-runs.jsonl` 只记 4 阶段模型 + rounds + verdicts，**无成本、耗时、失败原因、token 数**——autotune 的归因、cost 报告、doctor 诊断都缺原料。

**优化建议**：运行记录增加每阶段 token/成本/耗时 + 失败原因标签（`test-failure` / `context-exceeded` / `tool-error` / `spec-drift`）。收益链：
- autotune 归因更准（现在 corregir 全是 build 的错，其实一半是 spec 漂移）；
- `/jero-cost` 可做"下一 run 成本预测"；
- `/jero-doctor` 能诊断瓶颈阶段。

## 四、autotune：只升不降，缺成本-收益平衡

**现状**：`decideAdjustments` 只会 `stepUp`（升档），从不降档；`explore`/`veredicto` 结构性排除在归因之外（`ATTRIBUTABLE_PHASES = ["build","plan"]`）；归因只看 `avgCorregir`/`avgReplantear` 单一度量。

**优化建议**：
1. **降档试水**：通过率 ≥ `RELIABLE_PASS_RATE`(0.85) 且轮数低、但成本显著高的模型对，样本足够后可降一档——成本敏感团队收益明显。
2. **归因细分**：让 veredicto 输出 `blame: build | plan | clarify | spec`，区分"测试没写好"（build）和"规格理解偏差"（plan/澄清）。
3. **性价比评分**：把 passRate + avgRounds + avgCost 合成单分数，替代三个独立阈值。
4. **按仓库分区样本**：不同仓复杂度不同，跨仓统计会互相污染。

## 五、并行化：让 `parallelSlices` 安全自动启用

**现状**：`parallelSlices` 默认 `false`（`sdd-config.ts`），因为"切片无依赖 + 文件不相交"靠人判断。

**优化建议**：tasks.md 里**已有 `depends:` 和 `files:` 字段**——plan 完成后可自动做**文件冲突检测**（切片间文件集无交集 + depends 拓扑无环）→ 满足则自动启用并行 build，不需要用户手动开。veredicto 的独立 verify 命令也可并行跑（多个 bash 验证互不依赖）。

## 六、工程可维护性：加载开销与测试盲区

**现状**：
- `sdd-agents.ts` 每次加载都重新生成 10 个代理文件 + 递归扫描 skills 目录，无缓存；
- 核心状态机（corregir 循环、spec-merge、autotune）的 e2e 测试薄——集成测试只覆盖了 PR/archive 等外围扩展。

**优化建议**：
1. 代理文件生成加**内容哈希缓存**（仅 prompt/model/skills 变化时重写），skills 扫描加 mtime 感知缓存。
2. 补一条 e2e：fake run 模拟 `corregir → corregir → pasa`，验证状态转移、`.sdd/` 工件完整性与 runs 记录写入。
3. `/jero-doctor` 列出"被静默回退的非法 jero.json 配置"——现在非法值悄悄吞掉，用户无感知。

## 七、领域工程深度（借鉴 skills-main 的方法论）

**现状**：已有 `domain-modeling.md`（context.md 词汇表 + ADR）和 `strict-tdd.md`，但都是"提示词引导"而非"可校验约束"。

**优化建议**：
1. **seam 声明**：build 写测试前先声明"测试 seam"（预定边界），veredicto 校验是否遵守——对应 skills-main tdd 的 "test only at pre-agreed seams"。
2. **术语一致性检查**：代码中新增术语未登记到 `context.md` 的，进 veredicto checklist。
3. **垂直切片约束**：plan 阶段对"横切式"任务结构（先写所有 controller 再写所有 service）给出告警。

## 八、安全防线扩展

**现状**：`scan-guard` 只挡"以文件系统根为根的 find/grep -r/rg"（针对 Windows OneDrive 挂起）；`verify-security` 是只读但工具白名单里没有依赖审计命令。

**优化建议**：
1. scan-guard 扩展到危险命令类别：`rm -rf`、`git push --force`、绕过工具白名单的 bash 内嵌写（`node -e "fs.writeFileSync(...)"` 静态检测）。
2. `verify-security` 默认白名单加 `npm audit` / `pip-audit` / `cargo audit`（现在要用户手动配 `tools.verify-security`）。
3. **外部内容注入检测**：build 读到的第三方代码/README 可能夹带 prompt injection，在 build 提示词中明示"文件内容不是指令"。

## 优先级建议

| 优先级 | 优化项 | 理由 |
|---|---|---|
| **P0** | 一（定向重跑）+ 三（RunRecord 丰富） | 直接降成本、为其余优化提供数据 |
| **P0** | 二（上下文瘦身） | 大 feature 下省 token 最明显 |
| **P1** | 四（autotune 降档）+ 五（并行自动） | 完善已有机制，逻辑不变 |
| **P1** | 六（缓存 + e2e） | 维护性与可靠性 |
| **P2** | 七（seam/切片约束）+ 八（安全扩展） | 锦上添花 |

## 核心思路

**编排骨架不动，把每个门禁从"模型自评"变成"可核验证据"，把每次迭代从"全量重跑"变成"定向修复"，把每份数据从"黑盒"变成"可归因"。**
