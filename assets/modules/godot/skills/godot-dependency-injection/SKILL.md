---
name: godot-dependency-injection
description: 依赖注入：构造注入（_init 传 Clock/RNG）、资源注入（@export 配置）、场景装配（instantiate 后 configure），逻辑代码零 autoload 引用——可测性的底座。当要 headless 直测逻辑、解耦全局单例或排查"测试拆不动"时使用。触发词：依赖注入、DI、构造注入、可测性、解耦、单例、autoload 滥用、mock、测试桩、Clock、RNG 注入。
---

# 依赖注入（Godot 4.x）

管"依赖显式化：看签名就知道需要什么"。深度知识住模块 references（L2，路径经模块知识入口注入，按需读）。

> **相关技能：** 纯函数与类型纪律 → `godot-gdscript`；测试策略 → `godot-verify`（深读 `references/testing.md`）；数据依赖 → `godot-resources`。

## 何时使用

要让逻辑可 headless 直测、给时间/随机包接口、解耦散弹式 autoload 查找时使用；场景粘合层（UI/关卡通配）的组装不归本技能管。

## 核心要点

- 三条注入面：**构造注入**（`_init(rng: RandomNumberGenerator)`，逻辑对象首选）、**资源注入**（`@export var cfg`，数据依赖）、**属性注入**（`instantiate()` 后 `configure(...)`，场景对象）。
- 时间与随机包接口注入（Clock/RNG）——冷却/超时逻辑才能确定性测试。
- autoload 是服务定位器不是 DI 容器：可测逻辑（公式/规则/状态机）**零 autoload 引用**；粘合层才碰服务且经显式引用。
- 循环依赖 = 设计警讯：合并、抽第三者、或改单向 + 信号回传，别绕语法。

## 红线

- 逻辑深处 `get_node("/root/AutoloadX")` 散弹查找（依赖看不见测试拆不动）。
- 藏全局单例还宣称可测（不可替换就测不了分支）。
- 绕过装配协议伸进场景内部喂依赖（与封装红线同源）。

## 深读指路（references/）

依赖注入全文（三条注入面/autoload 分界/循环依赖）：`references/dependency-injection.md`。
