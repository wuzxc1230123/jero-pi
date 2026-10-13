# 安全（security-practices）

> 来源：Vue 官方安全指南 + OWASP 前端速查（XSS/注入面）；权威级：规范+建议
> 锚定版本：Vue 3.5/3.6 ｜ 核验日期：2026-10 ｜ 授权账本：`_sources.md`

## 第一事实

**打进客户端的一切都是公开的**：bundle 里的 API key、混淆的"隐藏
逻辑"、`VITE_` 变量、注释——打开 DevTools 全可见。能设防的只有
注入面与信任边界；需要保密的计算与凭据在服务端。

## XSS 与 v-html

- `{{ }}` 插值自动转义（安全默认）；危险面集中在 `v-html`、动态
  `:href`/`:src`、`innerHTML` 类 DOM 操作。
- **v-html 三问**：内容可信（静态常量）？不可信是否 sanitize
  （DOMPurify 白名单——标签与属性都管，`onerror` 是属性）？必须
  HTML 吗（多数场景文本插值/组件化即可）——三问过不了就换实现。
- 富文本编辑器场景：存储前 sanitize 或渲染前 sanitize（钉一处，
  全链路一致）；sanitize 配置进版本评审。

## URL 与资源注入

- 动态 `:href`/`:src`/`window.open`/iframe src：协议白名单校验
  （`https:`/相对路径）——`javascript:` 伪协议经用户输入直达是
  经典 XSS。
- 用户头像/附件 URL 走自家代理或签名 URL，不透传任意外域。
- `target="_blank"` 配 `rel="noopener noreferrer"`（钓鱼面）。

## 动态代码路径

- `<component :is>`：用户输入拼组件名 → 映射表白名单（输入 →
  预注册组件对象）。
- 自定义指令/属性绑定拼选择器与代码（`binding.arg` 直达 query/
  eval 面）同规则。
- 运行时模板编译（`template` 字符串选项）避免——预编译 SFC 无
  `unsafe-eval` 面，CSP 才能收紧。

## 凭据与会话

- API secrets 不进客户端（需要鉴权的调用经自家后端代理/BFF）；
  客户端只持会话令牌且 httpOnly cookie 优先（JS 不可读，XSS 拿不
  走）。
- localStorage 存令牌是降级方案（XSS 可读）——明白接受再选。
- 令牌刷新在静默路径；登出清全部面（storage/内存 store）。

## 消息与嵌入

- `postMessage` 监听校验 `event.origin` 白名单；发送方
  `targetOrigin` 显式（不用 `*`）。
- 嵌三方 iframe：`sandbox` 收权属性；自家被嵌：
  `X-Frame-Options`/CSP `frame-ancestors` 服务端设。

## 依赖与供应链

- 锁文件提交；`pnpm audit`/`npm audit` 进 CI 定期任务；高危按升
  级面处置（upgrade-migrations）。
- 构建期脚本（postinstall）与三方 CDN 引用最小化——依赖面即攻
  击面；lock 漂移即审。
- `VITE_`/`NUXT_PUBLIC` 之外的环境面不进客户端（配置纪律见
  vite-toolchain/nuxt-framework）。

## CSP 与纵深

- CSP 头收紧 script-src（报文观察期后 enforce）；SFC 预编译无
  unsafe-eval 诉求。
- 敏感操作（改密/支付）二次确认 + 服务端幂等；前端限流提示不替代
  服务端限流。

## 红线

- 不可信内容直进 `v-html`；动态 URL 未校验协议。
- secrets 打进客户端 bundle；postMessage 不校验 origin。
- 锁文件不提交/audit 从不跑。
