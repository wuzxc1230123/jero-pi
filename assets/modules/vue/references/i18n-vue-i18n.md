# 国际化 vue-i18n（i18n-vue-i18n）

> 来源：vue-i18n 官方文档（组合式 API/SFC 集成/懒加载节）+ @nuxtjs/i18n 文档；权威级：建议
> 锚定版本：vue-i18n 11（Vue 3 配套） ｜ 核验日期：2026-10 ｜ 授权账本：`_sources.md`

## 组织形态

```ts
// locales/zh-CN.ts …按语言一文件；组合式用法
const i18n = createI18n({
  legacy: false,                     // 组合式模式（新代码默认）
  locale: 'zh-CN',
  fallbackLocale: 'en',
  messages: { 'zh-CN': zhCN },       // 或仅装载默认语言，其余懒加载
})
app.use(i18n)
```

```vue
<script setup>
const { t, locale } = useI18n()
</script>
<template>
  <h1>{{ t('orders.title', { count: 3 }) }}</template>
</template>
```

- 消息键按域组织（`orders.title`/`orders.empty`）；组件内键带组件名
  前缀或用 SFC `<i18n>` 块局部消息（按需，全局键优先——散装局部块
  是碎片源）。
- 键名即契约：改键 = 全语言同步改；类型化消息（schema 生成键联合
  类型）让缺键/错键编译期暴露。

## 语言状态与路由

- **locale 是应用状态**：URL 承接可分享态——前缀策略（`/en/orders`，
  @nuxtjs/i18n 的 `prefix_except_default` 惯例）优先于 cookie 探测；
  切语言即换 URL（可后退可分享）。
- `<html lang>` 动态同步（无障碍与 SEO 双面）；`useHead` 声明式更新。
- 检测序：URL > 显式选择（存储偏好）> `Accept-Language` 协商——
  别跳过 URL 直接猜。

## 懒加载与体积

```ts
const messages = await import(`../locales/${locale}.ts`)   // 按语言分块
i18n.global.setLocaleMessage(locale, messages.default)
```

- 只内置默认语言，其余按需动态 import（每语言一 chunk）；切换后
  `setLocaleMessage` + `locale.value = x`。
- 预取策略：语言切换器 hover/进入设置页时预载目标语言。
- 日期/数字/复数走 `Intl`（`$d`/`$n` 或原生 `Intl.DateTimeFormat`）
  ——不手写格式化表。

## 插值与复数

- 消息内插值参数（`{count}`），**不拼接字符串**——语序在各语言不
  同，拼接即碎。
- 复数（`{count, plural, one {…} other {…}}`——ICU 语法）；`t` 的
  复数形态带选择器。
- 富文本插值用组件化（`i18n-t` 组件槽位）不 `v-html`（XSS 面 +
  security-practices 红线）。

## 缺键与回退

- `fallbackLocale` 链兜底；缺键在开发期警告、生产期上报（遥测面
  采缺键清单驱动翻译排期）。
- 命名空间合并策略（`mergeLocaleMessage` 按域增量装载）；键冲突
  （模块库消息覆盖应用消息）显式规划命名空间。

## SSR/Nuxt 面

- `@nuxtjs/i18n`：路由前缀/检测/懒加载全托管；SSR 首屏语言与
  客户端判定一致（cookie 服务端同读——水合不匹配防线，
  ssr-hydration）。
- 语言包进 payload 的体积裁剪：只带当前语言所需域。
- SEO：`hreflang` 备选链接自动生成（@nuxtjs/i18n），canonical 随
  语言路由。

## RTL 与视觉

- RTL 语言（ar/he）：`dir` 属性随 locale 切换；CSS 逻辑属性
  （`margin-inline-start`）代替物理方向——镜像零成本。
- 文案长度弹性（德语长词/泰语高度）布局测试覆盖。

## 红线

- 消息字符串拼接（语序即碎）；`v-html` 渲染消息。
- locale 双源（store 与 i18n 全局各持一份）；缺键静默无视不统计。
- 全语言打包进首屏（体积税）。
