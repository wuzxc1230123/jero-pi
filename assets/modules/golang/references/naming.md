# 命名（naming）

> 来源：Effective Go / Google Go Style Guide / Uber Go Style Guide（经 golang-skills 快照派生）；权威级：规范
> 最低 Go 版本：1.22 ｜ 核验日期：2026-10 ｜ 授权账本：`_sources.md`

## 决策树

```
命名什么？
├─ 包 → 单个小写词，表职责（http、strconv）；禁 util/common/helpers
├─ 导出标识符 → MixedCaps 大写开头（UserName）
├─ 未导出标识符 → MixedCaps 小写开头（userName）
├─ 接口（单方法）→ 动作者 -er（Reader、Validator）
├─ 接口（多方法）→ 名词角色（Storage、FileSystem）
├─ 错误值 → ErrXxx；错误类型 → XxxError
├─ 测试 → TestXxx；子测试名 → 空格短语（"rejects negative input"）
└─ 接收者 → 1–2 字母、类型内一致（u、srv）
```

## 包名

- 小写单词、可发音、无下划线无复数：`time` 不是 `times`，`httputil`
  可以（util 做后缀比做整名好，但仍要能表意）。
- 与导入路径尾段一致；同目录一个包名。
- 包名是调用方前缀：`bytes.Buffer` 读作"bytes buffer"——名字里别重复
  包名（`bytes.ByteBuffer` 反模式）。

## MixedCaps

- 驼峰是唯一风格；下划线只出现在测试文件名与包名。
- 缩略词全大写或全小写：`URL`/`url`、`HTTPServer`/`httpServer`，
  `Url`/`HttpServer` 永不。
- 首字母大小写即导出语义——不造 `private` 关键字思维；为测试导出
  内部类型是设计问题，不是命名问题。

## 变量：长度与作用域成比例

```go
for i := range n { ... }        // 1–2 字符，作用域 3 行
count := len(items)              // 局部，作用域一个函数
usersOnlineCount := ...          // 包级/长作用域，名字自带上下文
```

- 布尔用 Is/Has/Can/Allows 开头（`isEmpty`、`hasPermission`）。
- getter 无 Get 前缀：`u.Name()`；setter 才有 Set：`u.SetName(n)`。
- 同函数内不要同名的缩写与全称混用（`srv` 与 `server` 并存是噪音）。

## 常量

- MixedCaps（不用 SCREAMING_SNAKE——那是其他语言的习惯）。
- 枚举类型显式声明 + iota：`type Kind int; const ( KindA Kind = iota; KindB )`；
  序列化值要稳定时显式赋值，不依赖 iota 顺序。
- 无类型的 const 字面量（`const timeout = 5 * time.Second`）在包内
  使用更灵活；导出常量带类型。

## 接口命名细则

- 标准库范式：单方法接口 = 方法名 + er（`Read` → `Reader`）。
- er 化不自然时（`Reposter`?）用行为名词重命名接口本身。
- 实现命名：`Xxx` 接口的默认实现 `xxxImpl` 是弱命名；更常见的是直接
  以存储/协议命名（`diskStore`、`memoryCache`）。

## 文档注释（doc comment）与命名联动

- `// Name does something`——名字开头、第三人称单数、句号结尾。
- 名字难写注释 = 名字没起好：`LoadBalanceV2` 需要一段注释解释 V2，
  说明该按语义重命名（`WeightedScheduler`）。
- 包注释描述整体职责，不重复每个导出项。

## 子测试命名

`t.Run("rejects negative input", ...)`——空格分隔的行为短语，失败
输出即是文档；不写 `test_case_1`。
