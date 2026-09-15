# 外观层说明（主题契约 · 新增主题 · 验证工具）

本目录（`js/themes/`）存放**主题定义**。外观与游戏逻辑完全解耦：
逻辑层（`js/logic.js`、`js/config.js`）与输入层（`js/input.js`）**不包含任何外观代码**，
新增/替换主题不需要改动它们中的任何一行。

## 一、分层

```
逻辑层   config.js（规则与平衡参数） logic.js（纯函数规则，无 DOM/Canvas）
           │  唯一的"逻辑 → 外观"信号：Logic.diffLevel(state)（难度档位）
           ▼
装配层   main.js（视口 / 事件 / HUD 文本 / 暂停·设置·结算流程 / 固定步长主循环）
           │
外观层   gfx.js      通用绘制工具箱（颜色·数学·路径·画笔，主题无关）
         theme.js    主题注册表 + 换肤引擎（CSS 变量注入 / 持久化 / DIFF→主题映射）
         themes/*.js 主题定义（配色 · 尺寸 · 字体 · 生命图标 · 11 个绘制钩子）
         render.js   渲染管线（固定顺序调用钩子 + 中性兜底，零主题硬编码颜色）
         theme-ui.js 主题选择器 + 主题化生命图标
           │
DOM 皮肤 css/style.css（布局骨架，颜色全走变量） css/themes.css（各主题专属装饰）
```

## 二、主题定义字段

```js
Theme.define({
  id: "neon",                 // 必填，唯一 id（同时写入 <html data-theme>
  label: "霓虹深海",           // 设置面板显示名
  tagline: "暗色霓虹 · 数据管道",
  mode: "dark",               // "dark" | "light"（影响 color-scheme 与默认文字对比策略）
  preview: { bg, bg2, dots }, // 设置面板缩略色卡数据
  palette: { ... },           // 语义 token，见 Theme.PALETTE_DEFAULTS（缺失项自动兜底）
  metrics: { ... },           // 视觉尺寸，见 Theme.METRIC_DEFAULTS（itemRadius 等）
  font: { ui, display, canvas, labelSize },
  css: { radiusPanel, radiusBtn, borderWidth, panelShadow, btnShadow, hudShadow,
         letterSpacing, transition, fragRadius },   // 注入为 CSS 变量
  anim: { build, flash, shake, deliver, damage },   // 特效时长（秒），可只覆盖部分
  livesIcon: "<svg …>",       // 生命图标（内联 SVG，禁止 <filter>/id，避免重复 id）
  hooks: { … },               // 见下
});
```

未声明的字段会与默认值深合并，因此主题可以"只定义想改的部分"。

## 三、绘制钩子契约（全部可选，缺省走 `render.js` 的中性兜底）

所有钩子的第 2 个参数 `G` 是统一上下文：
`{ w, h, lanes, laneCount, bridgeWidth, laneHalf, m(metrics), p(palette), font, anim, dark, t(秒), laneX(i), bridgeTop(b), bridgeBottom(b) }`。

```js
field(ctx, G)                     // 场地底板：必须铺满 (0,0,G.w,G.h)
decor(ctx, G)                     // 场地装饰（在通路之下；建议 alpha ≤ 0.14，不得干扰识别）
lane(ctx, i, G)                   // 第 i 条通路：x = G.laneX(i)，纵向 0..G.h
bridge(ctx, b, G, hovered)        // 单座桥：b = { id, lanes:[a,b], y }
ghost(ctx, c, G)                  // 建桥预览：c = { laneA, laneB, y, legal }
warehouse(ctx, i, G)              // 第 i 座仓库（画在 y = G.h 之下）
item(ctx, item, G)                // 单个物品：item = { type, lane, x, y, … }
overlay(ctx, G)                   // 世界空间最上层（暗角 / 扫描线 / 纸纹…）
fx(ctx, type, fx, a, prog, G, vp) // 特效：build|flash|shake|deliver|damage（damage 才会拿到 vp）
laneLabel(ctx, i, sx, sy, G)      // 屏幕空间通路标签 L1..L5
screenOverlay(ctx, vp, G)         // 屏幕空间最上层（颗粒 / 暗角…）
```

硬性约定：

1. **物品形状语义全主题一致**（A 方 / B 三角 / C 圆 / D 五角星 / E 菱形），
   一律用 `Gfx.glyphPath(ctx, type, r, cx, cy)` 取形状，只换"怎么画"（发光 / 落墨 / 黏土），
   不换形状本身 —— 这是玩家识别玩法的基础。
2. **不得**读写游戏状态、不得改规则；`state` 只在 `render.js` 内部流转，钩子只看 `G` 与传入的对象。
3. **不得**使用 DOM / 定时器 / 网络 / `Math.random()`；纹理所用的随机数一律来自
   `Gfx.hash` / `Gfx.hash2`（确定性 → 逐帧稳定，不闪烁）。
4. 渐变统一走 `Gfx.linearGradient` / `Gfx.radialGradient`（带缓存，key 里带索引或尺寸），
   不要逐帧 `createLinearGradient`。
5. 同色小矩形阵列（纸纹颗粒、扫描线、刻度）请用 `Gfx.batchRects`，
   同色线段阵列用 `Gfx.batchLines`：像素结果一致，但把 N 次光栅化压成 1 次。
6. 装饰层每帧绘制，注意开销：`node tools/smoke-test.js` 会输出每个钩子的加权开销画像。

## 四、新增第 4 款主题（3 步，不需要改 HTML）

1. 复制 `js/themes/neon.js` 作为模板（推荐保留 IIFE + 顶部概念注释 + 模块私有工具的结构）；
2. 在 `index.html` 与 `tools/preview.html` 的脚本列表里加上 `js/themes/你的主题.js`；
3. 运行 `node tools/smoke-test.js`：注册表、几何落点、对比度、CSS 变量闭环、脚本顺序都会被自动核对。

设置面板里的主题卡片、自动轮换顺序、缩略色卡都会自动出现。

## 五、主题模式与自动轮换

- 设置面板可选「自动 · 跟随难度」或固定某一款主题；
- **自动**模式下：`Logic.diffLevel(state)` 每升一档，按注册顺序轮换一款主题
  （Lv.1 → Lv.2 → Lv.3 → 回到第一款），换肤时有一次淡入"洗版"过渡；
- 偏好只持久化"模式"（`localStorage` 的 `conveyorBridgeThemeMode_v2`），
  具体主题由 DIFF 推导，因此不会出现"存了个和当前难度矛盾的主题"。

## 六、验证工具（无第三方依赖）

| 命令 | 作用 |
| --- | --- |
| `node tools/smoke-test.js` | 无浏览器冒烟测试：桩件里按 `index.html` 顺序加载全部脚本、真实跑主循环、真实派发点击建桥；核对 16 条核心规则、逐主题换肤渲染、非法绘制参数、配色对比度、几何落点（场地/通路/桥/物品/仓库/建桥预览）、CSS 变量闭环、绘制开销画像 |
| `tools/preview.html?theme=neon&scene=play` | 开发沙盒页：复用正式外观层，构造确定性场景（play / start / settings / over），用于人工目视或截图 |
| `pwsh -File tools/capture-shots.ps1` | 用无头 Chrome 批量截图 `主题 × 场景`，并抓取画面自检 JSON 与渲染开销基准（需要能启动浏览器） |
| `node tools/inspect-shot.js <png>` | 把截图解码成 ASCII 结构图/色类图：核对布局与主色分布，无需肉眼看图 |

`tools/selfcheck.js` 在预览页里回读真实画布像素，在**已知世界坐标**处采样
（物品中心 vs 正下方背景、纵向扫描的明暗层次、通路 vs 间隙、桥 vs 场地），
把"看起来对不对"变成可以断言的数字。

## 七、已经踩过的坑（冒烟测试里有对应的防回归断言）

1. **面板里冒出滚动条**：`.panel` 是 `overflow` 容器，装饰用伪元素一旦用负偏移
   （例如 `right: -2px`）就会产生 2px 的可滚动溢出，开始 / 暂停 / 设置 / 结算四个面板
   全都会出现横向与竖向滚动条。现在装饰一律贴内边缘画，并且 `.panel` 显式
   `overflow-x: hidden` 且隐藏滚动条样式；测试会扫描 `.panel::before/after` 的负偏移并报错。
2. **坐标系错误导致"图标不见了"**：生成形状的辅助函数若忽略传入的 `(x, y)`，
   形状就会画在**世界原点**（场地左上角）。水墨主题的仓库目标形状与物品的洇墨外廓
   都栽在这上面。测试现在会检查"每座仓库内有图标大小的绘制、且中心落在印面/罐体里"。
3. **设置面板尺寸跳变**：说明文字长短、主题副标题换行都会改变面板尺寸。
   现在设置面板宽度固定（`width: min(92vw, 470px)`），说明文字与副标题都留了固定
   `min-height`，因此"自动 / 固定"两种状态下面板大小完全一致。
4. **装饰层的开销**：纸纹颗粒、扫描线这类"同色小矩形阵列"若逐个 `fillRect`，
   会占掉单帧开销的一半左右。改用 `Gfx.batchRects` 后，霓虹/水墨的单帧加权开销
   从 7766 / 7054 降到 1886 / 1602（像素结果完全一致）。
5. **物品辨识度**：高饱和度主题（霓虹）容易"发光成一团"。物品现在统一采用
   "分离环 + 类型色底座 + 渐变主体 + 近白亮边 + 白芯"的三层结构；
   测试会检查五类物品两两之间至少有一条线索成立（色相相差 ≥30° 或 亮度对比 ≥1.6），
   并检查每个物品在场地里都有绘制落在它自己的世界坐标上。
6. **重开后生命图标消失**：`ThemeUI.mountLives()` 返回的 `set(n)` 曾经只在"生命变少"时
   改 DOM（把被消耗的图标设为 `display:none`），生命变多时只改内部计数。于是**只要掉过命**，
   重开一局（`beginRun → set(5)`）之后内部计数是 5、DOM 里却仍是隐藏的，
   而装配层的 `state.lives !== getShown()` 判断又认为"没变化"，再也不会去修 ——
   LIVES 一行永久空掉，只有换主题触发重绘才会突然冒出来。
   现在 `set()` **无论增减都会把显隐同步回 DOM**；换肤用的 `paint()` 另走一路
   （重写 `innerHTML` + 同步显隐），不会被生命变化调用，因此不会每次掉命都重启图标动画。
   测试里有端到端回归：真实主循环玩到 Game Over → 点「再来一局」→ 必须仍是 5 颗心，
   再掉一条命 → 4 颗心。
