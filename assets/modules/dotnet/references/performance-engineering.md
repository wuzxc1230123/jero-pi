# 性能工程（performance-engineering）

> 来源：dotnet-skills csharp-type-design-performance 快照 / dotnet-skills 仓库 analyzing-dotnet-performance 与 microbenchmarking（经 skills-main 快照派生）/ Microsoft Learn 内存与 GC 文档；权威级：建议
> 锚定运行时：.NET 10 / C# 14 ｜ 核验日期：2026-10 ｜ 授权账本：`_sources.md`

## 方法论序

测量（diagnostics-tools）→ 定位热点 → 基线（benchmark-measurement）
→ 单变量优化 → 复测对比 → 端到端确认。跳步的"优化"是占卜。

## 分配成本模型

- gen0 回收便宜但分配本身有成本：分配率（MB/s）× 存活形状决定
  GC 频率与停顿分布。
- 中期存活对象最贵（promote 到 gen1/2）；LOH（≥85KB）分配直进
  大对象堆（不清扫、易碎片）。
- `dotnet-counters` 看 alloc-rate 与 gen0/1/2 计数比；分配率降
  一个数量级往往就是用户可感的胜利。

## Span/Memory 谱系

```csharp
ReadOnlySpan<char> s = "id=42;name=x";
int eq = s.IndexOf('=');
int semi = s.IndexOf(';');
var id = int.Parse(s.Slice(eq + 1, semi - eq - 1));   // 零子串分配
```

- `Span<T>` 栈上 ref 结构：不能进字段/async 签名/闭包捕获；方法
  内与同步管线全承载。
- `ReadOnlySpan<char>` 解析/切分零拷贝；`string.Slice` 系（
  `Substring`）产新串——热路径改 span 重载。
- `Memory<T>` 可装箱存字段/跨 await（`.Span` 取用）；`ArraySegment`
  旧形态只做互操作。
- `stackalloc` 小缓冲直接栈上（`Span<byte> buf = stackalloc byte[256]`）；
  尺寸上界编译期或 `switch` 分档防栈溢出。
- `string.Create` 按目标长度构造（`string.Create(len, state, spans)`）
  避免中间 StringBuilder。

## 池化

```csharp
byte[] buf = ArrayPool<byte>.Shared.Rent(4096);
try { Use(buf.AsSpan(0, actualLength)); }
finally { ArrayPool<byte>.Shared.Return(buf); }
```

- `ArrayPool<T>.Shared` 进程级池；`Rent(n)` 返回 ≥n（常为 2 的幂）
  ——**用长度自记，别假设等于请求值**。
- `MemoryPool<T>`/`IMemoryOwner<T>` 跨 await 所有权流转移。
- 频繁 ≥1KB 临时缓冲是池化信号；不池小的（池管理成本反超）。

## LINQ 分层

- 冷路径：LINQ 可读性完胜——用。
- 热路径：手写循环；`CollectionsMarshal.AsSpan(list)` 拿 span 遍
  历（.NET 5+）；`foreach` 对数组/Span 已零开销。
- 多次枚举同一 `IEnumerable` 必须物化一次（`ToList`）或改单遍流水
  ——多次枚举是隐性双倍成本 + 逻辑错误的温床。
- 谓词闭包与 lambda 捕获有分配成本：热路径局部函数（`static`
  lambda）/手写比较器。

## 装箱三源与结构体纪律

- 装箱源：值类型进 `object`/非泛型接口、非泛型集合（`Hashtable`
  时代残留）、`string.Format` 系的值类型插值（插值处理器已消除
  多数）。
- `readonly struct` 消防御性拷贝；`in` 参数只配大尺寸（> 指针
  2–3 倍以上）readonly struct。
- struct 超两个引用字段慎用（拷贝成本追平引用类型的间接层）；
  `ref struct` 只做栈上管线件（Span 家族）。
- 集合容量预估：`new List<T>(capacity)`/`Dictionary` 同——扩容
  是分配+拷贝的复合成本。

## 字符串与比较

- 比较/哈希显式 `StringComparison.Ordinal`（文化敏感比较是无声
  bug 源 + 慢）；InvariantCulture 仅序列化格式域。
- .NET 10 插值走 `DefaultInterpolatedStringHandler`：`$"{a}:{b}"`
  单次分配目标串——热路径插值可用；循环累积仍 `StringBuilder`（
  预估容量）或 `string.Create`。
- 解析用 `ISpanParsable<T>` 系（`int.Parse(ReadOnlySpan<char>)`）
  免子串。

## GC 形状与高级面

- Server GC（吞吐）/Workstation GC（延迟）按负载选（ASP.NET Core
  默认 Server GC）；`DOTNET_GCHeapHardLimit` 容器内显式限堆。
- pinning（`fixed`/`GCHandle.Alloc(Pinned)`）阻碍压缩——短 pin
  或 `MemoryPool` 池化代替长 pin。
- 大对象复用：池化 + `ArrayPool`；`LOH` 碎片看 `dotnet-gcdump`
  （diagnostics-tools）。
- DATAS（Dynamic Adaptation To Application Sizes，.NET 8+）按
  内存预算自适应堆——容器环境的默认候选。

## 反模式清单

- 无基线的微优化；为省一个分配把可读性写没了（成本模型里工程师
  的时间也是成本）。
- `List<T>` 手动 index 满扩容循环外再 `TrimExcess`（直接预估容量）。
- `Thread.Sleep` 轮询、`Thread` 手纺（Task/Channel 谱系代之）。
- 把"用 struct"当教条——拷贝成本与语义（按值捕获）都是账。
