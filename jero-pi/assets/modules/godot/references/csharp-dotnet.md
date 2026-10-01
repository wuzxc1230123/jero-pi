# C# / GodotSharp（.NET 侧）

C# 适合重逻辑/团队既有 .NET 栈；纪律：**语言边界即模块边界**——一项目内 GDScript 与 C# 不混写同一系统。

## 项目形态

- `.csproj` + `*.cs` 与 `.tscn/.gd` 同仓；构建走 `dotnet build`（Godot 编辑器外 CI 可跑）。
- 挂脚本的类：`partial class Player : CharacterBody2D`——`partial` 是 Source Generator 的硬要求，缺了 `[Export]/[Signal]` 不生效。
- `.godot/mono/` 生成物 gitignore（同 `.godot/`，见模块 `config.gitignore`）。

## 暴露面（Source Generators）

```csharp
public partial class Player : CharacterBody2D
{
	[Export] public float Speed { get; set; } = 300f;

	[Signal] public delegate void HealthChangedEventHandler(int current, int max);

	public void ApplyDamage(int amount)
	{
		Health -= amount;
		EmitSignal(SignalName.HealthChanged, Health, MaxHealth);
	}
}
```

- `[Export]` 属性 = Inspector 面；`[Signal]` delegate + `SignalName.Xxx` 常量成对生成——`EmitSignal` 用生成名，不写字符串。
- 信号订阅（C# 侧）：`enemy.Died += OnDied;` 断开 `-=`；生命周期不对称的订阅在 `ExitTree` 解绑（泄漏语义同 GDScript，见 `signals-groups.md`）。
- `[ExportGroup]/[ExportSubgroup]` 组织 Inspector；`[Export(PropertyHint.Range, "0,1")]` 对齐 GDScript 的 `@export_range`。

## 与 GDScript 互操作

- 双向可见（class_name 全局注册）；但**调用面走窄接口**：跨语言调用是 Variant 编组边界，`Godot.Collections.Dictionary<T>` ≠ `System.Collections.Generic.Dictionary`，转换有成本。
- 热路径（每帧）跨语言来回调 = 性能反模式；把系统整体放一种语言，边界处一次性交换数据。
- C# 节点从 `.tscn` 挂载同 GDScript（ext_resource 指向 `.cs`）；场景数据（`.tres`）两边等价消费。

## 工程纪律

- 逻辑与引擎拆分：纯域逻辑（伤害公式/背包/存档模型）写无 Node 依赖的普通 C# 类（POCO），`dotnet test` 直测（xUnit/NUnit，无需引擎进程）——引擎薄逻辑分离原则的 C# 版。
- Godot API 触达的适配层薄封装（`INode` 接口注入），引擎行为测试走 headless（见 `testing.md`）。
- 可空引用类型开（`<Nullable>enable</Nullable>`）；`Godot.GodotObject` 生命周期用 `using`/显式 `Dispose` 心智（`QueueFree` 后 C# 包装仍存活——`IsInstanceValid` 防御同 GDScript）。
- 版本：GodotSharp 与引擎版本强配对（`--version` 对齐）；.NET SDK 版本在 `global.json` 钉住。

## 测试与验证

- `dotnet test`（纯逻辑）+ `godot --headless`（引擎面 GdUnit4Sharp/集成脚本）双轨；模块 `config.testCommand` 按项目主语言二选一钉住（模块清单 config 字段，装进 `.pi/modules/` 后生效）。
- CI：`dotnet build` 零告警 + `dotnet test` + headless import 三道（`verification.md` 同构）。
- 导出：C# 项目需 .NET 工具链在导出机（CI 镜像带 SDK，见 `export-publishing.md`）。

## 选型判断

| 场景 | 选 |
|---|---|
| 重模拟/大量数值系统、团队 .NET 背景 | C# |
| 快速原型、小工具、编辑器粘合脚本 | GDScript |
| 单一系统 | 只用一种语言实现整个系统 |

混用双语言的前提：系统边界清晰 + 团队两边都熟；"一个系统一半 C# 一半 GDScript"是维护债的标配起点。
