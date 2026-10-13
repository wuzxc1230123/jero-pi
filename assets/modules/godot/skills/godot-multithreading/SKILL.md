---
name: godot-multithreading
description: 多线程：WorkerThreadPool 任务/任务组、Thread 自管与 join、引擎线程边界（场景树只在主线程）、共享状态加锁、结果经信号回主线程。当重计算卡帧要移出主线程或排查偶现崩溃/竞态时使用。触发词：多线程、线程、Thread、WorkerThreadPool、Mutex、并发、后台计算、竞态、卡帧计算、异步任务。
---

# 多线程（Godot 4.x）

管"重计算移出主线程"：选型阶梯与引擎线程边界。深度知识住模块 references（L2，路径经模块知识入口注入，按需读）。

> **相关技能：** 性能预算与分帧（更轻的替代）→ `godot-performance`；纯函数与可测性 → `godot-gdscript`；验证 → `godot-verify`。

## 何时使用

大世界生成/寻路批算/图像处理等重计算卡帧、或排查偶现崩溃（竞态特征）时使用；能分帧拆掉的计算先分帧——线程是最后手段。

## 核心要点

- 选型阶梯：分帧 → `await`（**不是线程**，仍在主线程）→ `WorkerThreadPool`（4.x 首选，`add_task`/`add_group_task`）→ 自管 `Thread`。
- **场景树/节点只在主线程动**：子线程回家只有 `call_deferred`/信号两条路；任务内纯计算 + 传值进出。
- 共享可变状态（Dictionary/Array/字段）跨线程读写必须 `Mutex`；能靠"传值进出"避免共享就别上锁。
- `Thread` 必须在节点释放前 `wait_to_finish()`——未 join 的线程在退出时是崩溃源。

## 红线

- 子线程加删节点/改属性/get_node（未定义行为）。
- 无锁跨线程读写共享容器（崩得随机不可复现）。
- 每帧 new Thread 不 join（泄漏 + 退出崩溃）。

## 深读指路（references/）

多线程全文（选型阶梯/WorkerThreadPool 配方/边界清单）：`references/multithreading.md`。
