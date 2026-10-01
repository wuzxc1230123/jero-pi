---
name: godot-csharp
description: C# / GodotSharp（.NET 侧）：项目形态、语言边界即模块边界、信号与 source generator、dotnet build CI。当用 C# 写 Godot 逻辑、混用 GDScript/C# 分界或排查 .NET 构建问题时使用。触发词：C#、csharp、GodotSharp、.NET、dotnet、csproj、C# 信号、C# 导出。
---

# C# / .NET 侧（Godot 4.x）

管"C# 怎么用对"：语言边界与 GodotSharp 纪律。深度知识住模块 references（L2，路径经模块知识入口注入，按需读）。

> **相关技能：** GDScript 语言规范 → `godot-gdscript`；活会话 attach C# 的限制 → `godot-live`；导出（.NET 版模板）→ `godot-export`。

## 何时使用

选型或编写 C# 侧逻辑、划 GDScript/C# 边界、配 .NET 构建链时使用；纯 GDScript 项目不归本技能管。

## 核心要点

- **语言边界即模块边界**：一个项目内 GDScript 与 C# **不混写同一系统**——按系统切语言，跨界只经信号/显式接口。
- 项目形态：`.csproj` + `*.cs` 与 `.tscn/.gd` 同仓；构建走 `dotnet build`，CI 与三道门可跑（编辑器外可构建是选 C# 的红利）。
- C# 适合重逻辑/团队既有 .NET 栈；轻量场景粘合用 GDScript 更顺手——不是"哪个更高级"的问题。
- 信号连接用 source generator（`[Signal]` + 分部类），公共 API 显式类型；字符串 API 名反射只在编辑器工具里用。

## 红线

- 同一系统内 GDScript 与 C# 互调纠缠（心智双倍、工具链双倍）。
- C# 侧绕过 `dotnet build` 只靠编辑器内编译（CI 无法独立验证）。
- 导出用错模板（.NET 侧需 .NET 版导出模板与启用构建）。

## 深读指路（references/）

C# 全文（项目形态/信号与 generator/边界纪律）：`references/csharp-dotnet.md`。
