---
name: vue-security
description: 前端安全红线：v-html XSS 与 sanitize、动态 :href/:src 协议注入、动态组件与用户输入、secrets 不进客户端、依赖面与锁文件、postMessage 与 iframe 边界。当评审安全面或处理不可信输入时使用。触发词：安全、XSS、v-html、sanitize、注入、secrets、CSP。
---

# 安全（Vue 3）

前端安全的第一事实：**打进客户端的一切都是公开的**——secrets、内部配置、隐藏逻辑都挡不住打开 DevTools 的用户；能设防的只有注入面与信任边界。

> **相关技能：** 指令边界（v-html） → `vue-directives`；环境变量契约 → `vue-tooling`；服务端权威校验 → `vue-forms`。

## 何时使用

评审涉及不可信内容渲染/用户输入拼接/第三方嵌入的变更、检查 secrets 与依赖面时使用。

## 核心要点

- **`v-html` 三问**：内容可信（静态常量）？不可信是否 sanitize（DOMPurify 白名单）？必须 HTML 吗（多数场景文本插值/组件化即可）——三问过不了就换实现。
- **URL 注入**：动态 `:href`/`:src`/`window.open` 必须校验协议白名单（`https:`/相对路径）——`javascript:` 伪协议经用户输入直达是经典 XSS；图片 `onerror` 链路同理（sanitize 管属性不只是标签）。
- **动态组件与指令注入**：`<component :is>` 接收用户输入拼的组件名、自定义指令 `binding.arg` 拼选择器——用户输入直达代码路径是注入面；映射表白名单（输入→预注册组件）是标准解。
- **secrets 纪律**：API key/令牌不进 `VITE_` 变量与客户端代码——需要鉴权的调用经自家后端代理（BFF）；客户端只持会话级短令牌且走 httpOnly cookie 优先。
- **postMessage/iframe**：`message` 监听校验 `event.origin` 白名单；嵌入三方 iframe 收 sandbox 属性；自家被嵌入时 `X-Frame-Options`/CSP frame-ancestors 服务端设。
- **依赖面**：锁文件提交 + `npm audit`/`pnpm audit` 进 CI；前端供应链（构建期 postinstall 脚本）同样设防——lock 漂移即审。
- **CSP**：内容安全策略收紧 inline script（Vue 模板编译不受影响——运行时模板编译才涉 `unsafe-eval`，预编译 SFC 无此面）；CSP 报告先行观察再 enforce。

## 红线

- 不可信内容直进 `v-html`；动态 URL 未校协议。
- API secrets 打进客户端 bundle。
- postMessage 不校验 origin。

## 深读指路（references/）

注入面与信任边界全谱：`references/security-practices.md`。
