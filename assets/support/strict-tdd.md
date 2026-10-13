# 严格 TDD 模块 —— Apply 阶段

> **本模块仅在启用严格 TDD 模式（Strict TDD Mode）且存在可用测试运行器时才会加载。**
> 你读到本模块时，编排器（父会话）已验证过这两个条件。请遵循每一条指令。

## TDD 哲学

TDD 不是测试。TDD 是**由测试驱动的软件设计**。你编写一个描述代码应当做什么的测试，然后编写让其实現所需的最少代码。测试设计出 API、契约与行为。代码是测试的副产品。

### 三定律

1. 在拥有一个失败的测试之前，**绝不编写生产代码**
2. **绝不编写超出使其失败所必需的测试**
3. **绝不编写超出使测试通过所必需的代码**

## TDD 实现循环

对你被指派的每一个任务，都严格遵循此循环：

```
对每个任务：
├── 0. SAFETY NET（安全网，仅在修改既有文件时）
│   ├── 对被修改的文件运行既有测试
│   ├── 捕获基线："{N} tests passing"
│   ├── 若有任何 FAIL → 停止，报告为 "pre-existing failure"
│   │   （绝不修复既有失败——报告给编排器（父会话））
│   └── 该基线证明你没有破坏原本正常的东西
│
├── 1. UNDERSTAND（理解）
│   ├── 阅读任务描述
│   ├── 阅读相关规格场景（它们就是你的验收标准）
│   ├── 阅读设计决策（它们约束你的方案）
│   ├── 阅读既有代码与测试模式（匹配其风格）
│   └── 确定测试层级（见下文“选择测试层级”）
│
├── 2. RED —— 先写一个失败的测试
│   ├── 编写描述规格中预期行为的测试
│   ├── 尽可能优先纯函数（无副作用 = 易于测试）
│   ├── 测试必须引用尚不存在的生产代码
│   │   （这保证了失败——无需执行来确认）
│   ├── 若生产代码/函数已存在：
│   │   └── 为尚未实现的新行为编写测试
│   └── GATE：测试尚未写好之前，绝不进入 GREEN
│
├── 3. GREEN —— 编写通过测试所需的最少代码
│   ├── 只实现失败测试所需要的部分
│   ├── Fake It 在此处是合法的（硬编码返回值可以接受）
│   ├── 执行测试 → 必须通过
│   │   ├── ✅ 通过 → 进入 TRIANGULATE 或 REFACTOR
│   │   └── ❌ 失败 → 修复实现，而不是测试
│   └── GATE：在执行确认 GREEN 之前绝不继续
│
├── 4. TRIANGULATE（对多数任务是强制的）
│   ├── 默认：三角化是必需的。跳过它需要一个令人信服的理由。
│   ├── 增加第二个使用不同输入/期望输出的测试用例
│   ├── 执行测试 → 若 Fake It 失效（硬编码不再可行）：
│   │   └── 泛化为真实逻辑（这正是全部意义所在）
│   ├── 重复，直到本任务的全部规格场景都被覆盖
│   ├── 每一轮三角化：编写测试 → 运行 → 修复实现
│   ├── 最少：每个行为至少 2 个测试用例（正常路径 + 一个边界用例）
│   │   ├── 一个使用会产生非空/非平凡结果的数据的测试
│   │   └── 一个使用会行使不同代码路径的数据的测试
│   ├── 警惕轻易通过的 GREEN：
│   │   ├── 若测试因组件/元素未渲染而通过 → 不是真正的 GREEN
│   │   ├── 若测试因循环迭代 0 次而通过 → 不是真正的 GREEN
│   │   ├── 若测试因 setup 未触发该代码路径而通过 → 不是真正的 GREEN
│   │   └── 真正的 GREEN 意味着：生产代码运行了并产出期望输出
│   ├── 仅当以下全部为真时才可跳过三角化：
│   │   ├── 任务是纯结构性的（配置文件、常量定义、类型导出）
│   │   ├── 字面上只有一种可能的输出（无分支、无逻辑）
│   │   └── 你在证据表中明确注明 "Triangulation skipped: {reason}"
│   └── GATE：REFACTOR 之前，本任务的全部规格场景都必须已有测试
│
├── 5. REFACTOR —— 在不改变行为的前提下改进
│   ├── 提取常量（消除魔法数字）
│   ├── 提取函数（降低圈复杂度）
│   ├── 改进命名、消除重复
│   ├── 在可行之处推向纯函数
│   ├── 践行 Boy Scout Rule（童子军规则）：让代码比你接手时更干净
│   ├── 每一步重构后都执行测试 → 必须仍然通过
│   │   ├── ✅ 仍通过 → 重构是安全的，继续
│   │   └── ❌ 失败 → 回退该步重构，尝试更小的步子
│   └── GATE：每一次重构变更后测试都必须保持绿色
│
├── 6. 将任务标记为完成 [x]
└── 7. 记录发现的任何偏差或问题
```

## 选择测试层级

基于 Engram 中缓存 的测试能力，为每个任务选择合适的测试层级：

```
按任务做什么来确定测试层级：
├── 纯逻辑、工具函数、计算、数据变换
│   └── 单元测试（Unit）（只要存在测试运行器就总是可用）
│
├── 组件渲染、用户交互、状态变更
│   ├── 若有集成工具 → 集成测试（Integration）
│   └── 若没有 → 带模拟（mock）的单元测试（优雅降级）
│
├── 多组件流程、API 交互、context/provider 行为
│   ├── 若有集成工具 → 集成测试（Integration）
│   └── 若没有 → 带模拟的单元测试
│
├── 关键业务流程、完整用户旅程、跨页导航
│   ├── 若有 E2E 工具 → E2E 测试
│   ├── 若没有但有集成工具 → 集成测试（Integration）
│   └── 若两者都没有 → 单元测试（Unit）（优雅降级）
│
└── 默认：单元测试（Unit）（永远是兜底）
```

**关键规则**：使用适合该任务的最高可用层级。但绝不因某层级不可用而跳过任务——降级到下一个可用层级。

## 测试执行

从缓存的测试能力中检测测试运行器：

```
从以下位置读取测试命令：
├── 缓存的能力 → test_runner.command（最快——已经检测过）
├── openspec/config.yaml → rules.apply.test_command（覆盖）
└── 兜底：从 package.json/pyproject.toml/go.mod 检测

在 TDD 期间执行测试时：
├── 只运行相关的测试文件，而不是整个套件
│   ├── JS/TS: {runner} {test-file-path}（例如 pnpm vitest run src/utils/tax.test.ts）
│   ├── Python: pytest {test-file-path}
│   ├── Go: go test ./{package}/... -run {TestName}
│   └── 按运行器的 CLI 适配
├── 这让循环保持快速
└── 全套件运行发生在 sdd-verify，而不是这里
```

## 纯函数偏好

在 GREEN/TRIANGULATE 步骤编写生产代码时，优先纯函数：

```
✅ PREFER (pure — easy to test):
function calculateDiscount(price: number, quantity: number): number {
  return quantity >= 5 ? price * quantity * 0.1 : 0
}

❌ AVOID (impure — hard to test):
function calculateDiscount(item: Item) {
  globalState.lastDiscount = item.price * 0.1  // side effect
  updateDOM()                                   // side effect
  return globalState.lastDiscount
}
```

**原因**：纯函数是确定性的（相同输入 → 相同输出）、没有副作用、且极易测试。TDD 自然会把你推向纯函数——拥抱它。

## 认可测试（Approval Testing，用于重构既有代码）

当任务涉及重构既有代码（而非编写新代码）时：

```
在触碰生产代码之前：
├── 1. 识别需要保留的既有行为
├── 2. 编写捕获当前行为的认可测试：
│   ├── 用已知输入调用函数
│   ├── 断言当前输出（即使丑陋或错误）
│   └── 这些测试记录了代码现在的行为
├── 3. 运行认可测试 → 必须通过（它们描述当前现实）
├── 4. 现在才重构生产代码
├── 5. 再次运行认可测试 → 必须仍然通过
│   ├── ✅ 通过 → 重构保留了行为
│   └── ❌ 失败 → 重构破坏了某些东西，回退
└── 6. 若规格说行为应当改变：
    ├── 更新认可测试以反映新的期望行为
    ├── 运行 → 测试失败（RED——新行为尚未实现）
    └── 实现新行为 → GREEN
```

## 返回摘要扩展

当严格 TDD 模式（Strict TDD Mode）启用时，你的返回摘要必须包含以下小节：

```markdown
### TDD Cycle Evidence
| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 1.1 | `path/test.ext` | Unit | ✅ 5/5 | ✅ Written | ✅ Passed | ✅ 3 cases | ✅ Clean |
| 1.2 | `path/test.ext` | Integration | N/A (new) | ✅ Written | ✅ Passed | ➖ Single | ✅ Clean |
| 1.3 | `path/test.ext` | Unit | ✅ 2/2 | ✅ Written | ✅ Passed | ✅ 2 cases | ➖ None needed |

### Test Summary
- **Total tests written**: {N}
- **Total tests passing**: {N}
- **Layers used**: Unit ({N}), Integration ({N}), E2E ({N})
- **Approval tests** (refactoring): {N} or "None — no refactoring tasks"
- **Pure functions created**: {N}
```

**列定义**：
- **Safety Net**：修改文件前运行的既有测试。新文件为 "N/A (new)"。
- **RED**：先写测试，引用尚不存在的代码。始终为 "✅ Written"。
- **GREEN**：最小实现后执行并通过测试。必须展示执行结果。
- **TRIANGULATE**：为逼出真实逻辑而增加的额外测试用例。规格只有一个场景时为 "➖ Single"。
- **REFACTOR**：测试仍通过的前提下改进了代码。代码本已干净时为 "➖ None needed"。

## 断言质量规则（强制）

**每条断言都必须验证真实行为。**一个未行使生产逻辑就通过的测试比没有测试更糟——它给出虚假信心。

### 禁用的断言模式（绝不编写）

```
# TRIVIAL ASSERTIONS — test proves nothing
expect(true).toBe(true)              # ❌ Tautology
expect(false).toBe(false)            # ❌ Tautology
expect(1).toBe(1)                    # ❌ Tautology — no production code involved
assert True                          # ❌ Always passes
assert 1 == 1                        # ❌ Always passes

# EMPTY COLLECTION ASSERTIONS without setup context
expect(result).toEqual([])           # ❌ ONLY valid if you set up conditions for empty
expect(result).toHaveLength(0)       # ❌ Same — why is it empty? Did production code run?
assert len(result) == 0              # ❌ Same — prove the emptiness comes from real logic
assert result == []                  # ❌ Same

# TYPE-ONLY ASSERTIONS — proves existence, not behavior
expect(result).toBeDefined()         # ❌ Alone is useless — WHAT is the value?
expect(result).not.toBeNull()        # ❌ Alone is useless — assert the actual value
expect(typeof result).toBe('object') # ❌ Alone is useless — what does the object contain?
assert result is not None            # ❌ Alone — assert what result actually IS

# GHOST LOOP — assertion inside a loop that iterates 0 times
const items = screen.queryAllByTestId("item");  // returns []
for (const item of items) {
  expect(item).toHaveTextContent("value");       # ❌ NEVER EXECUTES — loop body is dead code
}
# FIX: assert the collection is non-empty FIRST, or set up data so it IS non-empty:
expect(items).toHaveLength(3);                   # ✅ Proves items exist
for (const item of items) { ... }                # ✅ Now the loop actually runs

# INCOMPLETE TDD CYCLE — GREEN without TRIANGULATE
# If your GREEN test passes because the setup doesn't exercise the code path,
# you are NOT done. You MUST triangulate with a setup that DOES exercise it.
# Example: testing "search doesn't update until Enter" but the component
# that receives the search is never rendered → the test proves nothing.
# FIX: add a test where the component IS rendered and verify the behavior.
```

### 什么构成真实断言

每条测试断言都必须满足以下全部条件：
1. **调用生产代码**——测试调用实现中的函数、方法或组件
2. **断言具体输出**——与从规格推导出的具体期望值比较
3. **生产代码有错时会失败**——若你更改实现逻辑，这个测试就会破裂

```
# ✅ REAL assertions — production code determines the result
expect(calculateDiscount(100, 10)).toBe(10)       # Real input → real output
expect(screen.getByText('Welcome, John')).toBeInTheDocument()  # Rendered from data
assert result[0].status == "FAIL"                  # Specific finding from check execution
assert response.status_code == 403                 # Real HTTP response from the endpoint
expect(result).toHaveLength(3)                     # AND you set up exactly 3 items
```

### 空集合规则

`expect(result).toEqual([])` 或 `assert len(result) == 0` 仅在以下情况有效：
1. 你设置了应当产生空结果的具体前置条件（例如没有匹配记录）
2. 生产代码确实运行并过滤/处理数据后得到空结果
3. 一个使用不同 setup 的伴随测试产生非空结果（三角化）

若你无法基于 setup 解释结果为何为空 → 该断言是平凡的。

### 冒烟测试规则

仅渲染组件而不断言任何输出的测试不是有效测试：

```
# ❌ SMOKE TEST ONLY — proves nothing about behavior
render(<MyComponent data={mockData} />);
expect(screen.getByTestId("wrapper")).toBeInTheDocument();  # Just proves it rendered

# ✅ BEHAVIORAL TEST — proves what the component DOES with the data
render(<MyComponent data={mockData} />);
expect(screen.getByText("Expected Title")).toBeInTheDocument();  # Verifies output from data
expect(screen.getByRole("button")).toHaveTextContent("Submit");  # Verifies real content
```

"Renders without crash"（渲染不崩溃）是冒烟测试。它不是单元测试，不是集成测试，也不计入 TDD 覆盖。若你需要冒烟测试，它必须伴随真实的行为断言。

### Mock 卫生规则

**若你需要的 mock 比断言还多，你就在错误的层级上测试。**

```
Mock/断言比例指引：
├── 一个测试文件 ≤ 3 个 mock → ✅ 健康——聚焦的测试
├── 4–6 个 mock → ⚠️ 考虑把逻辑提取为纯函数
├── 7+ 个 mock → ❌ 停止——你在错误的层级上测试
│   ├── 把被测逻辑提取为纯函数，并不用 mock 测试它
│   ├── 或把测试移到存在真实依赖的集成/E2E 层级
│   └── 绝不写 10+ 个 mock 来验证一个单行变换
```

**先提取后 Mock 规则（Extract-Before-Mock）**：若你想测试的行为是数据变换、映射、过滤或条件逻辑（例如 `MUTED → FAIL` 状态转换），先把它提取为纯函数，再直接测试该纯函数。不需要 mock。

```
# ❌ BAD: 15 mocks to test a one-line status conversion
vi.mock("next/navigation", ...);
vi.mock("next/link", ...);
vi.mock("@/components/shadcn", ...);
// ... 12 more mocks ...
render(<StatusCell row={mutedRow} />);
expect(screen.getByText("FAIL")).toBeInTheDocument();

# ✅ GOOD: extract and test the logic directly
// In production code:
export function resolveDisplayStatus(status: string, isMuted: boolean): string {
  return status === "MUTED" ? "FAIL" : status;
}

// In test — ZERO mocks needed:
expect(resolveDisplayStatus("MUTED", true)).toBe("FAIL");
expect(resolveDisplayStatus("PASS", false)).toBe("PASS");
```

### 实现细节耦合规则

测试必须断言**用户可见的行为**，而不是内部实现细节：

```
# ❌ COUPLED TO IMPLEMENTATION — breaks on any style refactor
expect(element.className).toContain("text-xs");
expect(element.className).toContain("-mt-2.5");
expect(element.className).toContain("border-border-error-primary");
expect(element.style.color).toBe("red");

# ❌ COUPLED TO INTERNALS — breaks when implementation changes
expect(mockService.mock.calls.length).toBe(3);  # Why 3? Brittle.
expect(component.state.isLoading).toBe(true);    # Internal state, not behavior.

# ✅ BEHAVIORAL — survives refactors, tests what users see
expect(screen.getByText("Error: Payment failed")).toBeInTheDocument();
expect(screen.getByRole("alert")).toHaveTextContent("Risk:");
expect(screen.getByRole("button")).toBeDisabled();
```

**CSS 类断言绝不是有效的测试断言。**若你需要验证视觉样式：
1. 测试**语义结果**（例如元素具有 `role="alert"`、文本可见、按钮被禁用）
2. 或使用视觉回归工具 / E2E 截图对比
3. 绝不断言具体的 Tailwind/CSS 类名——它们是实现细节

## 规则（严格 TDD 专属）

- 绝不在编写测试之前编写生产代码——这是唯一不可打破的规则
- 绝不跳过 GREEN 执行门——你必须运行测试并确认它们通过
- 当规格定义了多个场景时绝不跳过三角化——硬编码的 Fake It 必须被逼出
- 绝不编写平凡断言（见上文“禁用的断言模式”）——它们比没有测试更糟
- 始终验证每条断言都调用生产代码并断言一个具体的期望值
- 修改既有文件前始终运行安全网（Safety Net）——保护已经正常的东西
- 始终报告 TDD Cycle Evidence 表——验证阶段会检查它
- 若测试运行器因基础设施原因执行失败（而非测试失败），报告为 "Blocked" 并继续下一个任务
- 优先纯函数——但在不合适之处不要强求（例如带状态的 React 组件）
- 对重构任务，在触碰代码之前始终编写认可测试
- 循环期间只运行相关的测试文件，而不是全套件
