# 严格 TDD 模块 —— Verify 阶段

> **本模块仅在启用严格 TDD 模式（Strict TDD Mode）且存在可用测试运行器时才会加载。**
> 你读到本模块时，编排器（父会话）已验证过这两个条件。请遵循每一条指令。

## TDD 验证哲学

当严格 TDD 模式启用时，验证超越“代码能否工作？”，到达“代码是否被正确地构建？”——即：TDD 是否真的被遵循了？apply 阶段报告 TDD 证据；你的工作是将该证据与现实核对。

## 步骤 5a：TDD 合规检查（含断言质量审计）

读取 `apply-progress` 产物并验证 TDD 确实被遵循：

```
读取 apply-progress 产物：
├── 找到 "TDD Cycle Evidence" 表
├── 对每一行任务：
│   ├── RED 列：
│   │   ├── 必须写 "✅ Written"
│   │   ├── 验证：测试文件在代码库中存在
│   │   └── 标记：测试文件不存在则为 CRITICAL
│   │
│   ├── GREEN 列：
│   │   ├── 必须写 "✅ Passed"
│   │   ├── 与步骤 5b 的测试执行结果交叉核对：
│   │   │   └── 所列测试文件在你运行时必须通过
│   │   └── 标记：测试现在失败则为 CRITICAL（它当时真的是绿色吗？）
│   │
│   ├── TRIANGULATE 列：
│   │   ├── 若为 "✅ N cases" → 验证测试文件中确实存在 N 个测试用例
│   │   ├── 若为 "➖ Single" → 验证规格对该任务确实只有一个场景
│   │   └── 标记：规格有多个场景却只有 1 个测试用例则为 WARNING
│   │
│   ├── SAFETY NET 列：
│   │   ├── 若为 "✅ N/N" → 修改前运行过既有测试（良好）
│   │   ├── 若为 "N/A (new)" → 验证该文件确实是新建（而非修改）
│   │   └── 标记：文件被修改但安全网显示 "N/A" 则为 WARNING
│   │
│   └── REFACTOR 列：
│       ├── 无法严格验证（主观质量）
│       └── 跳过验证，信任报告
│
├── 若未找到 "TDD Cycle Evidence" 表：
│   └── 标记：CRITICAL——apply 阶段未报告 TDD 证据
│       （启用了严格 TDD 但 apply 未遵循协议）
│
└── 摘要："{N}/{total} tasks have complete TDD evidence"
```

## 步骤 5（扩展）：测试层级验证

按测试层级分类与本变更相关的全部测试文件：

```
扫描本变更创建/修改的测试文件：
├── 分类每个测试文件：
│   ├── 单元测试（Unit）：隔离地测试单个函数/类
│   │   └── 特征：无 render()、无 page.、无 HTTP 调用、依赖被 mock
│   ├── 集成测试（Integration）：测试组件交互或用户行为
│   │   └── 特征：render()、screen.、userEvent.、testing-library 导入
│   ├── E2E 测试：通过真实浏览器/HTTP 测试完整系统
│   │   └── 特征：page.goto()、playwright/cypress 导入、浏览器上下文
│   └── 未知：无法分类 → 按原样报告
│
├── 报告分布：
│   ├── Unit：{N} 个测试，横跨 {N} 个文件
│   ├── Integration：{N} 个测试，横跨 {N} 个文件
│   ├── E2E：{N} 个测试，横跨 {N} 个文件
│   └── 总计：{N} 个测试
│
├── 与能力交叉核对：
│   ├── 若存在集成测试但能力中无此工具 → 怎么来的？
│   ├── 若存在 E2E 测试但能力中无此工具 → 怎么来的？
│   └── 标记：测试使用了能力中未检测到的工具则为 WARNING
│
└── 对每个规格场景：注明哪个层级覆盖它
    └── 标记：关键业务逻辑只有单元测试则为 SUGGESTION
        （仅当集成/E2E 工具可用时）
```

## 步骤 5d（扩展）：变更文件覆盖率

当覆盖率工具可用时，专门为变更文件报告覆盖率：

```
若覆盖率工具可用（来自缓存的能力）：
├── 运行：{test_command} --coverage（或等价命令）
├── 解析覆盖率报告
├── 只过滤出本变更创建或修改的文件
│   （文件列表来自 apply-progress 的 "Files Changed" 表）
├── 逐文件报告：
│   ├── 文件路径
│   ├── 行覆盖率 %
│   ├── 分支覆盖率 %（若可用）
│   ├── 未覆盖的行区间（具体行号，而不只是 %）
│   └── 逐文件标记：
│       ├── ≥ 95% → ✅ Excellent
│       ├── ≥ 80% → ⚠️ Acceptable
│       └── < 80% → ⚠️ Low（列出未覆盖行）
├── 汇总报告：
│   ├── 变更文件的平均覆盖率
│   ├── 变更文件的总未覆盖行数
│   └── 若配置了阈值则与之比较
└── 标记：任何变更文件覆盖率 < 80% 则为 WARNING

若覆盖率工具不可用：
└── 报告："Coverage analysis skipped — no coverage tool detected"
    （不是失败——只是不可用）
```

## 步骤 5e：质量度量（若工具可用）

仅对变更文件、仅在工具可用时运行质量检查：

```
从缓存的能力读取质量工具：

若 linter 可用：
├── 只对变更文件运行 linter
├── 报告：错误与警告
└── 标记：错误为 WARNING，警告为 SUGGESTION

若类型检查器可用：
├── 运行类型检查器（通常是全项目，而非逐文件）
├── 将输出过滤到变更文件
├── 报告：变更文件中的类型错误
└── 标记：类型错误为 WARNING

若两者都不可用：
└── 报告："Quality metrics skipped — no tools detected"
```

## 报告模板扩展

当严格 TDD 模式启用时，你的验证报告必须包含这些额外小节：

```markdown
### TDD Compliance
| Check | Result | Details |
|-------|--------|---------|
| TDD Evidence reported | ✅ / ❌ | {Found in apply-progress / Missing} |
| All tasks have tests | ✅ / ❌ | {N}/{total} tasks have test files |
| RED confirmed (tests exist) | ✅ / ⚠️ | {N}/{total} test files verified |
| GREEN confirmed (tests pass) | ✅ / ❌ | {N}/{total} tests pass on execution |
| Triangulation adequate | ✅ / ⚠️ / ➖ | {N} tasks triangulated / {N} single-case |
| Safety Net for modified files | ✅ / ⚠️ | {N}/{total} modified files had safety net |

**TDD Compliance**: {N}/{total} checks passed

---

### Test Layer Distribution
| Layer | Tests | Files | Tools |
|-------|-------|-------|-------|
| Unit | {N} | {N} | {tool} |
| Integration | {N} | {N} | {tool or "not installed"} |
| E2E | {N} | {N} | {tool or "not installed"} |
| **Total** | **{N}** | **{N}** | |

---

### Changed File Coverage
| File | Line % | Branch % | Uncovered Lines | Rating |
|------|--------|----------|-----------------|--------|
| `path/to/file.ext` | 95% | 90% | — | ✅ Excellent |
| `path/to/other.ext` | 82% | 75% | L45-48, L62 | ⚠️ Acceptable |
| `path/to/new.ext` | 100% | 100% | — | ✅ Excellent |

**Average changed file coverage**: {N}%
{or "Coverage analysis skipped — no coverage tool detected"}

---

### Assertion Quality
| File | Line | Assertion | Issue | Severity |
|------|------|-----------|-------|----------|
| ... | ... | ... | ... | ... |

**Assertion quality**: {N} CRITICAL, {N} WARNING
{or "✅ All assertions verify real behavior"}

---

### Quality Metrics
**Linter**: ✅ No errors / ⚠️ {N} warnings / ❌ {N} errors / ➖ Not available
**Type Checker**: ✅ No errors / ❌ {N} errors / ➖ Not available
```

## 步骤 5f：断言质量审计（强制）

扫描本变更创建或修改的全部测试文件，检查平凡/无意义的断言：

```
对本变更相关的每个测试文件：
├── 读取文件内容
├── 扫描被禁用的断言模式：
│   ├── 恒真式：expect(true).toBe(true)、assert True、expect(1).toBe(1)
│   ├── 孤立的空集合检查：expect(result).toEqual([]) 或 assert len(result) == 0
│   │   └── 除非存在相同 setup 且断言非空结果的伴随测试
│   ├── 单独使用的仅类型断言：toBeDefined()、not.toBeNull()、typeof 检查
│   │   └── 若与同一测试中的值断言组合使用则可以
│   ├── 从不调用生产代码的断言（无函数调用、无 render、无请求）
│   ├── 幽灵循环：位于遍历 queryAll/filter 结果的 for/forEach 内部的断言
│   │   └── 检查集合是否可能为空——若是，这些断言绝不运行
│   │       标记：CRITICAL——对空数组的循环是一个永远通过的测试
│   ├── 不完整的 TDD 循环：测试因前置条件阻止代码运行而通过
│   │   └── 例如测试一个因状态而从未被渲染的组件的行为
│   │       标记：CRITICAL——测试必须设置使代码路径确实被行使的条件
│   ├── 仅冒烟测试：render() + toBeInTheDocument() 而无行为断言
│   │   └── "Renders without crash" 不是有效测试——它必须断言渲染出了什么
│   │       标记：WARNING——冒烟测试不计入 TDD 覆盖
│   ├── 实现细节耦合：对 CSS 类、内部状态、mock 调用计数的断言
│   │   └── expect(el.className).toContain("text-xs") 或 expect(mock.calls.length).toBe(3)
│   │       标记：WARNING——测试必须断言行为，而不是实现
│   └── Mock/断言比例：统计每个测试文件的 vi.mock() 调用数与 expect() 调用数
│       └── 若 mock 数 > 2× 断言数 → 标记：WARNING——"Mock-heavy test ({N} mocks, {N} assertions)"
│           建议：把逻辑提取为纯函数，或移到更高的测试层级
│
├── 对发现的每个违规：
│   ├── 记录：文件、行号、该断言、它为何平凡
│   └── 分类：
│       ├── CRITICAL：恒真式（expect(true).toBe(true)）——测试什么也证明不了
│       ├── CRITICAL：无生产代码调用的断言——测试什么也未行使
│       ├── CRITICAL：幽灵循环——对可能为空的集合的循环内部的断言
│       ├── WARNING：无伴随非空测试的空集合断言
│       ├── WARNING：无值断言的仅类型断言
│       ├── WARNING：仅冒烟测试——render + toBeInTheDocument 而无行为检查
│       ├── WARNING：CSS 类 / 实现细节断言
│       └── WARNING：mock 过重的测试（mock 数 > 2× 断言数）——错误的测试层级
│
├── 检查三角化质量：
│   ├── 统计每个行为的不同测试用例数
│   ├── 若一个具有多个规格场景的行为只有 1 个测试用例：
│   │   └── 标记：WARNING——"Insufficient triangulation for {behavior}"
│   ├── 若所有测试用例断言同一类型的值（例如全部检查空数组）：
│   │   └── 标记：WARNING——"No variance in test expectations — all assert empty/trivial"
│   └── 三角化充分的行为拥有断言不同期望值的测试
│
└── 摘要："{N} trivial assertions found across {N} files"
```

### 断言质量报告表

发现任何问题时，在验证报告中包含此表：

```markdown
### Assertion Quality
| File | Line | Assertion | Issue | Severity |
|------|------|-----------|-------|----------|
| `path/test.ts` | 15 | `expect(true).toBe(true)` | Tautology — proves nothing | CRITICAL |
| `path/test.ts` | 23 | `expect(result).toEqual([])` | Empty without companion non-empty test | WARNING |
| `path/test.ts` | 31 | `expect(result).toBeDefined()` | Type-only — no value asserted | WARNING |

**Assertion quality**: {N} CRITICAL, {N} WARNING
```

若发现零个问题，报告："**Assertion quality**: ✅ All assertions verify real behavior"

## 规则（严格 TDD 验证专属）

- 始终检查 apply-progress 中的 TDD Cycle Evidence 表——它是首要产物
- 始终将报告的测试文件与实际执行交叉核对——不要盲目信任报告
- 始终运行断言质量审计（步骤 5f）——平凡测试比缺失测试更糟
- 若 apply-progress 没有 TDD 证据表，标记为 CRITICAL——协议未被遵循
- 若发现恒真式断言（expect(true).toBe(true)），标记为 CRITICAL——它们必须被重写
- 覆盖率与质量度量是信息性的，不阻塞——只标记为 WARNING，绝不为 CRITICAL
- 测试层级分布是信息性的——仅为 SUGGESTION 级别
- 绝不修复问题——只报告。由编排器（父会话）决定。
- 若覆盖率/质量工具不可用，干净地说明并继续——绝不把缺失工具标记为失败
