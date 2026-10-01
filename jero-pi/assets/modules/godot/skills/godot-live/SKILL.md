---
name: godot-live
description: 经 godot-ai（MCP 桥）连接正在运行的 Godot 编辑器做活会话操作：实时读改场景树、GDScript 热重载、信号接线、材质/粒子/相机/环境调整、编辑器内跑测试。当需要搭场景、调节点、高频往返试错或截编辑器视口时使用；CI 与回归验证禁用。触发词：godot-ai、活会话、编辑器连接、实时编辑、热重载、场景树读写、编辑器 MCP、截视口。
---

# 编辑器活会话·godot-ai 对接（Godot 4.7+）

管"伸进编辑器进程内存"的交互编辑：attach 链、安全纪律与 NEVER。深度协议住模块 references（L2，按需读）。

> **相关技能：** 构建/校验/回归取证 → `godot-verify`（headless CLI 才是验证手段）；一次性截屏桥与方案对比 → 深读 `references/editor-live-session.md`。

## 何时使用

搭场景、调节点、配信号/UI/材质/粒子/相机、高频试错并即时看效果时使用；**要写进报告的验证结论不归本技能管**——活会话不是验证手段，"编辑器里看着对了"不算证据。

## 接入要点

- attach 链：MCP 客户端 → `godot-ai attach`（stdio）→ 本地服务（127.0.0.1:8000，鉴权 HTTP，Python 侧需 `uv`/uvx）→ 编辑器插件（环回 WebSocket :9500）；要求 Godot 4.7+（4.x 线内）。
- Pi 侧档：`/jero:install-module godot` 自动把 `godot-ai` 档并入 `~/.pi/agent/mcp.json`（幂等；同名用户档不覆盖；重载会话后生效）；两跳凭证独立轮换、无未认证回退。
- GDScript 写入即解析校验 + 热重载；C# 脚本仅文本写入、无构建/报错回传（attach C# 需 .NET 版编辑器）。
- 常用工具面：场景创建/编辑、节点检视与修改、信号接线、UI 配置、材质/动画/粒子/相机/环境、项目资产检索（如 PackedScene）、编辑器内跑场景测试套件；工具全量见 godot-ai 的 docs/TOOLS.md。

## 红线

- 绝不用活会话做回归验证——依赖"编辑器开着"的验证在 CI 里必死；回归结论必须 headless CLI 产出（`godot-verify` 三道门）。
- 绝不绕过项目文件直接改运行态而不落盘：活会话的修改最终要落成磁盘上的场景/脚本变更并过三道门。
- 配置不入库：`.mcp.json`/插件启用项 gitignore；对生产/他人项目开远程活会话默认拒绝（SSH + 显式授权除外）。

## 深读指路（references/）

活会话方案对比、安全纪律全文、一次性截屏桥：`references/editor-live-session.md`。
