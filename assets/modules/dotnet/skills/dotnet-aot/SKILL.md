---
name: dotnet-aot
description: 裁剪与 Native AOT 兼容：PublishTrimmed/PublishAot 属性、IL2xxx/IL3xxx 诊断与标注（DynamicallyAccessedMembers/RequiresUnreferencedCode）、源生成替代反射、功能开关（feature switch）。当做 AOT/裁剪兼容或消 IL 警告时使用。触发词：AOT、NativeAOT、裁剪、trimming、IL2026、IL3050、PublishTrimmed。
---

# 裁剪与 Native AOT

AOT 的契约是"启动即全知"：运行时不再能补 JIT 与反射的课——所有动态行为必须提前声明、生成或迁移。

> **相关技能：** 序列化的反射面 → `dotnet-serialization`；诊断取证 → `dotnet-diagnostics`；升级面（compat 开关） → `dotnet-upgrade`。

## 何时使用

引入 `PublishTrimmed`/`PublishAot`、消除 IL2xxx/IL3xxx 警告、评审反射代码的 AOT 兼容性时使用。

## 核心要点

- **开关与诊断**：`<PublishTrimmed>true</PublishTrimmed>` 先行（裁剪警告早暴露）；`<IsAotCompatible>` 库声明级；Native AOT 额外禁运行时代码生成（IL3xxx 族）。
- **警告即工作清单**：IL2xxx（裁剪）/IL3xxx（AOT）指到具体反射点——修复优先序：重构消除反射 > 标注声明意图 > 最后才是 `UnconditionalSuppressMessage`（带理由与期限）。
- **标注语义**：`[DynamicallyAccessedMembers(Type)]` 让裁剪器保留目标成员；`[RequiresUnreferencedCode("…")]` 在公共 API 面传染警告（调用方知情）；`RequiresDynamicCode` 同族管运行时代码生成。
- **反射替代谱**：源生成器（JSON 见 `dotnet-serialization`、正则 `[GeneratedRegex]`、日志 `LoggerMessage`）；`UnsafeAccessor` 越私有边界（明确且窄）；配置绑定走源生成 `ConfigurationBinder`。
- **逃生舱分级**：`TrimmerRootAssembly` 整体保活（粗粒度、体积代价）；功能开关（feature switch，`FeatureSwitchDefinition`）让库代码路径可裁（默认值编译期固化）。
- **跨平台产物**：`dotnet publish -r <rid>` 每目标平台各出；native 库链接差异进 CI 矩阵。

## 红线

- `Reflection.Emit`/`Assembly.Load` 进 AOT 路径（无标注迁移方案）。
- 批量 `UnconditionalSuppressMessage` 平推（不是修复是掩盖）。
- 只测 JIT 就宣布 AOT 兼容——AOT 产物必须单独跑测试。

## 深读指路（references/）

裁剪模型、标注谱系与迁移剧本：`references/aot-trimming.md`。
