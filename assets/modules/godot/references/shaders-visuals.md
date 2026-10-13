# 着色器与视觉效果

gdshader 语法接近 GLSL 但有自己的宿主约定（uniform、内建、`texture()`）。
写之前先明确：能用材质参数/粒子/`modulate` 解决的不写着色器——着色器
是最后手段，不是第一反应。

## gdshader 基线（4.x）

```glsl
shader_type canvas_item;

uniform float flash_amount : hint_range(0.0, 1.0) = 0.0;
uniform vec4 flash_color : source_color = vec4(1.0);

void fragment() {
	vec4 tex = texture(TEXTURE, UV);
	COLOR = mix(tex, flash_color, flash_amount * tex.a);
}
```

- `shader_type canvas_item`（2D）/ `spatial`（3D）先声明；COLOR/UV/TEXTURE
  是内建，勿重复声明。
- uniform 带 `hint_range`/`source_color`，检查器才给合适的编辑器。
- 4.x 着色器语言里采样仍是 `sampler2D` + `texture()`（与 GLSL 的
  `texture2D` 不同，与 3.x 一致）；**变化在 Shader 资源 API 侧**：4.4
  起默认纹理方法签名是 `Texture` 而非 `Texture2D`——从教程抄 GDScript
  侧的 `shader_parameter` 代码时注意版本。
- 参数从 GDScript 侧设置：`material.set_shader_parameter("flash_amount", 1.0)`；
  每实例不同参数用 `material.duplicate()` 或 `next_pass`（3.x 语义已废）。

## 粒子（GPUParticles2D/3D）

- 一次性特效（爆炸、命中）用 `one_shot = true` + `emitting = true`，
  实例化粒子上场景，`finished` 信号后 `queue_free()`——组件化收口。
- 数量预算：粒子数是显存/带宽开销，2D 手游向项目单 emitter 上限先钉
  ~200，总量走性能预算（见 performance.md）。
- GPUParticles 需要兼容渲染器支持；Web 导出回落 Compatibility 时验证
  粒子是否可见，别只在本机 Forward+ 验收。

## 2D 视觉速查

- 光照：`PointLight2D`/`DirectionalLight2D` + `CanvasModulate` 调环境；
  受光贴图需法线（NormalMap）配合。
- 后处理：`WorldEnvironment` + `Environment` 资源；2D 也可开 glow
  （`glow_enabled`，HDR 配置在 Compatibility 渲染器上受限，跨端验证）。
- 遮挡/透视：`BackBufferCopy` 拿屏幕纹理做折射/溶解类效果——它强制
  同步点，帧预算敏感，评审问一句"必要吗"。
- 像素风：纹理 `filter = Nearest`、窗口拉伸模式 `canvas_items` +
  `aspect=keep`，视口缩放整数倍；混用线性/最近邻会糊或闪。

## NEVER

- **绝不在 fragment 里做分支重的动态循环**（每像素成本）；能查表
  （渐变纹理）就查表。
- **绝不无版本意识抄 3.x 着色器教程**：3.x 的 `hint_color` → 4.x
  `source_color`；`VERTEX` 语义、光照内建（`LIGHT` 函数签名）全变了。
- **绝不让着色器持有游戏状态**：uniform 是参数不是变量存储；状态在
  GDScript，每帧传参（或经 CanvasItemMaterial 属性）。
- 视觉效果改动必须"跑起来看一眼"（见 verification.md 第三道门）——
  着色器编译错误只在运行时显形，parse 检查覆盖不了 .gdshader。
