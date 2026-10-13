---
name: golang-naming
description: 命名决策树：包名表职责、接口 -er 后缀、短接收者、MixedCaps、无 Get 前缀、变量长度与作用域成比例。当命名标识符、包、接口或写文档注释（doc comment）时使用。触发词：命名、包名、接口名、接收者、缩写、驼峰。
---

# 命名（Go）

管"名字即接口"：好的名字让读者不需要跳转定义。命名是 Go 里最便宜也最值钱的可读性投资。

> **相关技能：** 风格底线 → `golang-style`；错误命名的文档面（ErrFoo）→ `golang-errors`；包组织 → `golang-project`。

## 何时使用

新建包/类型/函数、命名接收者与常量、写导出符号的文档注释时使用；评审命名一致性时同样适用。

## 核心要点

- **包名**：小写单词、表职责不用复数（`http` 非 `httputil2`）；禁 `util`/`common`/`helpers`/`misc`——名字含糊说明职责不清。
- **MixedCaps**：驼峰是唯一风格，下划线只在测试文件与包名；导出与否靠首字母大小写表达，不用 `public` 关键字思维。
- **接口 -er**：单方法接口用动作者命名（`Reader`、`Closer`）；多方法接口用名词表角色；实现加 `Impl` 后缀是坏味道。
- **接收者**：1–2 个字母、全类型一致（`(u *User)` 就处处 `u`）；不用 `this`/`self`。
- **无 Get 前缀**：`user.Name()` 不是 `user.GetName()`；布尔用 `Is/Has/Can` 开头。
- **缩略词全大写或全小写**：`URL`/`id`、`HTTPServer`/`httpServer`，绝不 `Url`。
- **长度与作用域成比例**：循环计数 `i`、方法内局部 `n`、包级导出名写全；名字带上下文（`usersCount` 优于全局 `count`）。
- **错误值** `ErrXxx`、**错误类型** `XxxError`；哨兵错误的文档注释说明调用方如何匹配。
- **文档注释以名字开头**：`// Name does ...`；包文档放任一文件的 `package xxx` 上方。

## 红线

- `util`/`common`/`misc` 类万能包名。
- `this`/`self` 接收者、匈牙利记号、类型后缀重复（`userStruct`）。
- 导出与未导出之间反复横跳（为测试导出内部类型是设计问题不是命名问题）。

## 深读指路（references/）

命名全文（决策树/各类别样例/子测试命名）：`references/naming.md`。
