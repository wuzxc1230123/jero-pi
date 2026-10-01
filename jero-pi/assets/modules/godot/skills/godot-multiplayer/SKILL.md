---
name: godot-multiplayer
description: 多人联机（Godot 4 高层 API）：权威服务器模型、ENet 起步、MultiplayerSpawner/Synchronizer、RPC 语义与可靠性档位。当做联机、同步状态、调 RPC 或排查"不同步/延迟作弊"时使用。触发词：联机、多人、网络、RPC、multiplayer、同步、Synchronizer、Spawner、服务器、客户端、ENet、延迟。
---

# 多人联机（Godot 4.x）

管"谁说了算、怎么同步"：权威服务器基线与高层 API。深度知识住模块 references（L2，路径经模块知识入口注入，按需读）。

> **相关技能：** 信号驱动的本地解耦 → `godot-signals`；场景生成纪律 → `godot-nodes-scenes`；验证（联机也是 CLI 可跑）→ `godot-verify`。

## 何时使用

做联机架构、选同步策略、写 RPC、排查不同步时使用；**先单机可玩再做联机**——联机不是架构附加层，是架构决策，原型期不归本技能管。

## 核心要点

- 基线：**权威服务器模型**——server 模拟、client 呈现；客户端永远不直接裁定游戏状态。
- 连接面 ENet 起步（`MultiplayerPeer`），进阶再换 WebRTC/Steam；地址与端口进配置不硬编码。
- 生成走 `MultiplayerSpawner`（_spawn_path 钉死生成路径），状态走 `MultiplayerSynchronizer`（`SceneReplicationConfig` 勾选同步属性），不手写"全量广播"。
- `@rpc("any_peer", "unreliable")` 等注解显式声明方向与可靠性：高频位置 unreliable、裁定类 reliable；**RPC 方法名即协议**，改动要版本对齐。

## 红线

- 客户端自报伤害/位置并直接生效（作弊面——裁定只认权威端）。
- 每帧全量同步整棵场景树（勾选同步的属性越少越好，只同步决定呈现的最小集）。
- RPC 方法内混客户端/服务器逻辑不分叉（`is_multiplayer_authority()` 判定谁执行）。

## 深读指路（references/）

联机全文（连接面/生成与同步/裁定与预测）：`references/multiplayer.md`。
