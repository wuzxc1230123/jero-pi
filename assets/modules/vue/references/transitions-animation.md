# 过渡与动画（transitions-animation）

> 来源：Vue 官方进入/离开与列表过渡指南 + Web 动画性能惯例；权威级：规范+建议
> 锚定版本：Vue 3.5/3.6 ｜ 核验日期：2026-10 ｜ 授权账本：`_sources.md`

## 单元素 `<Transition>`

```vue
<Transition name="fade" mode="out-in" appear>
  <component :is="view" v-if="show" :key="view.id" />
</Transition>
```

- 适用于 `v-if`/`v-show` 切换与动态组件；**单元素/单组件**（多子
  时用 key 切换的同一位置）。
- `mode="out-in"`（旧出先进，默认推荐）/`in-out`——必须显式声明
  （同时进出是未定义告警源）。
- `appear`：初始渲染也播（进场动画需求）；`:duration` 显式钉总时
  长（嵌套动画时 CSS 探测不准）。

## 类名时间线（六态）

```
enter：v-enter-from → v-enter-active（过渡窗口）→ v-enter-to
leave：v-leave-from → v-leave-active → v-leave-to
```

```css
.fade-enter-active, .fade-leave-active { transition: opacity .2s }
.fade-enter-from, .fade-leave-to { opacity: 0 }
```

- `-active` 定 transition/animation 属性与时长；`-from/-to` 定起
  止态——经典四行式。
- `name` 换前缀防冲突；`enter-from-class` 族可全自定义类名（对接
  动画库）。

## 列表 `<TransitionGroup>`

```vue
<TransitionGroup name="list" tag="ul">
  <li v-for="item in items" :key="item.id"> … </li>
</TransitionGroup>
```

- 子项**必带 key**；FLIP 位移动画内建（`v-list-move` 类平滑重排）；
  移出项 `v-list-leave-active { position: absolute }` 让位动画。
- 新入（`v-list-enter-from`）与移动分离控制；tag 渲染容器元素
  （或不渲染用 `tag` 省略——片段形态注意样式上下文）。

## 性能纪律

- **只动 `transform` 与 `opacity`**（合成器路径，不触
  layout/paint）；动 top/left/width/height 是掉帧源。
- 过渡属性显式列举（`transition: opacity, transform .2s`）——
  `transition: all` 波及意外属性（hover 色变也走 200ms）。
- 大量元素动画（>100）考虑 canvas/分层或降低面积；高频指针跟随用
  `transform` + `requestAnimationFrame` 批量（`useRafFn`）。

## 状态驱动动画

- 类名切换 + CSS 变量参数化：状态归 Vue、绘制归 CSS——不把关键
  帧字符串拼进 JS。
- JS 钩子（`@enter`/`@leave` + `done` 回调）对接 GSAP 谱系/Web
  Animations API；Velocity 类命令式库同理。
- `@starting-style`（原生 CSS）与过渡新元素；Vue 的 `appear` 已覆
  盖组件场景。

## 可达性与节奏

- `prefers-reduced-motion: reduce` 降级（装饰动画关停、必要反馈
  改瞬时）——CSS 媒体查询统一处理。
- 时长预算：微反馈 100–200ms、进场 200–400ms；超过 500ms 的常态
  交互动画是耐心税。
- 过渡承载语义（反馈/引导/空间关系），不当装饰堆砌。

## 红线

- `transition: all`；多同级子元素无 `mode`。
- 动画触发布局属性致掉帧；忽略 reduced-motion。
- 动画库全家桶进 bundle 只为一个淡入（CSS 四行能做的事）。
