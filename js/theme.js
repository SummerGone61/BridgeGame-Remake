"use strict";

/**
 * ============================================================
 * theme.js —— 主题运行时（外观层的"注册表 + 换肤引擎"）
 *
 * 解耦边界（本文件是唯一的外观↔逻辑接触面）：
 *   - 逻辑层（logic.js / config.js）不知道"主题"存在；
 *   - 渲染管线（render.js）只按契约调用主题钩子，颜色/形状全部取自主题；
 *   - DOM 皮肤通过 CSS 自定义属性注入（本文件写 :root），样式表里没有游戏规则；
 *   - 唯一的逻辑→外观信号是 Logic.diffLevel(state)（难度档位），
 *     由装配层 main.js 读取后调用 Theme.apply，主题自身不读分数/时间。
 *
 * 新增主题：新建 js/themes/xxx.js 并调用 Theme.define({...})，
 * 无需改动 index.html / render.js / logic.js / config.js。
 * ============================================================
 */

const Theme = {};

/* ---- 主题模式：auto（跟随难度档位自动轮换）+ 具体主题 id ---- */
Theme.MODE = { auto: "auto" };
Theme.PREF_KEY = "conveyorBridgeThemeMode_v2";

/* ---- 注册表 ---- */
Theme.definitions = {};   // id → 主题定义
Theme.order = [];         // 注册顺序（决定设置面板顺序与自动轮换顺序）
Theme.current = null;     // 当前生效主题 id
Theme.listeners = [];

/**
 * 注册一个主题定义。
 * def 允许只写差异部分：palette / metrics / hooks / font / css 均会与默认值深合并，
 * 因此新主题可以"只定义想改的部分"。
 */
Theme.define = function (def) {
  if (!def || !def.id) return null;
  def.palette = Theme.mergePalette(def.palette);
  def.metrics = Object.assign({}, Theme.METRIC_DEFAULTS, def.metrics || {});
  def.anim = Object.assign({}, Theme.ANIM_DEFAULTS, def.anim || {});
  def.font = Object.assign({}, Theme.FONT_DEFAULTS, def.font || {});
  def.css = Object.assign({}, Theme.CSS_DEFAULTS, def.css || {});
  def.hooks = def.hooks || {};
  def.label = def.label || def.id;
  def.tagline = def.tagline || "";
  def.mode = def.mode === "light" ? "light" : "dark";
  if (!Theme.definitions[def.id]) Theme.order.push(def.id);
  Theme.definitions[def.id] = def;
  if (!Theme.current) Theme.current = def.id;
  return def;
};

/* ============================================================
 * 默认值 / 契约
 * ============================================================ */

/**
 * 调色板契约：所有主题使用同一套语义化 token 名，
 * render.js 的兜底实现与 CSS 变量映射都只认这些名字。
 */
Theme.PALETTE_DEFAULTS = {
  page: "#101014",          // 页面底色（画布外）
  field: "#16161c",         // 场地底色
  fieldAlt: "#1c1c24",      // 场地渐变副色
  grid: "rgba(255,255,255,0.05)",
  gridStroke: "rgba(255,255,255,0.12)",
  laneA: "#33333d",         // 通路条纹 A
  laneB: "#26262e",         // 通路条纹 B
  laneEdge: "#4a4a56",      // 通路边缘线
  bridgeBody: "#6e6e7a",    // 桥体
  bridgeTop: "#d0d0da",     // 桥顶高光
  bridgeBottom: "#3a3a44",  // 桥底暗部
  bridgeEdge: "#f0f0f4",    // 桥边缘/悬停高亮
  text: "#d8d8de",
  textMid: "#b0b0bc",
  textDim: "#86868f",
  textBright: "#f4f4f8",
  panel: "#16161c",
  panelAlt: "#1e1e26",
  panelBorder: "#2c2c36",
  overlay: "rgba(8,8,12,0.78)",
  btnBg: "#1c1c24",
  btnText: "#e6e6ec",
  btnBorder: "#2c2c36",
  btnHover: "#282832",
  btnActive: "#20202a",
  primary: "#4c4c58",
  primaryHover: "#5c5c6a",
  primaryActive: "#3e3e4a",
  primaryText: "#ffffff",
  accent: "#8c8c98",
  accentAlt: "#b0b0bc",
  danger: "#e05561",
  success: "#5ec98a",
  heart: "#e8e8ee",
  glow: "rgba(255,255,255,0.35)",
  warehouseFrame: "#9a9aa6",
  warehouseFill: "rgba(0,0,0,0.25)",
  itemColors: { A: "#f4f4f8", B: "#d0d0d8", C: "#a6a6b2", D: "#7c7c8a", E: "#5a5a66" },
  fx: {
    build: "#d6d6de",
    flash: "#f0f0f4",
    shake: "#e8e8ee",
    plusText: "#ffffff",
    plusParticle: "#c8c8d2",
    wrong: "#ff8a94",
    damageOverlay: "#ffffff",
    damageFrame: "#f0f0f4",
    ghostOk: "#d6d6de",
    ghostOkLine: "#e8e8ee",
    ghostBad: "#6a6a76",
    ghostBadLine: "#8c8c98",
  },
};

Theme.METRIC_DEFAULTS = {
  itemRadius: 8,            // 物品外接半径（世界单位，纯视觉，与判定无关）
  warehouseWidth: 40,
  warehouseHeight: 16,
  warehouseIconRadius: 6,
  laneHalf: 4,              // 通路半宽
  laneSegment: 10,          // 通路条纹节距
  bridgeInset: 2,           // 桥内缩（视觉）
};

Theme.ANIM_DEFAULTS = {
  build: 0.18,
  flash: 0.15,
  shake: 0.25,
  deliver: 0.7,
  damage: 0.45,
};

Theme.FONT_DEFAULTS = {
  ui: '"Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif',
  display: '"Segoe UI", system-ui, sans-serif',
  canvas: 'bold 13px "Segoe UI", system-ui, sans-serif',
  labelSize: 13,
};

Theme.CSS_DEFAULTS = {
  radiusPanel: "0px",
  radiusBtn: "0px",
  borderWidth: "2px",
  panelShadow: "none",
  btnShadow: "none",
  hudShadow: "none",
  letterSpacing: "1px",
  transition: "140ms ease",
  fragRadius: "0px",
};

/** 深合并调色板（itemColors / fx 逐项合并，其余覆盖） */
Theme.mergePalette = function (p) {
  const base = Theme.PALETTE_DEFAULTS;
  const out = Object.assign({}, base, p || {});
  out.itemColors = Object.assign({}, base.itemColors, (p && p.itemColors) || {});
  out.fx = Object.assign({}, base.fx, (p && p.fx) || {});
  return out;
};

/* ============================================================
 * 读取当前主题
 * ============================================================ */

Theme.defaultName = function () { return Theme.order[0] || null; };

Theme.has = function (name) { return !!(name && Theme.definitions[name]); };

/** 取主题定义（默认取当前生效主题） */
Theme.get = function (name) {
  if (name && Theme.definitions[name]) return Theme.definitions[name];
  if (Theme.current && Theme.definitions[Theme.current]) return Theme.definitions[Theme.current];
  return Theme.definitions[Theme.defaultName()] || null;
};

/** 当前主题的动画时长（供装配层给特效打时长，缺项自动兜底） */
Theme.animOf = function () {
  const d = Theme.get();
  return (d && d.anim) || Theme.ANIM_DEFAULTS;
};

/**
 * DIFF（难度档位）→ 主题名：三款主题按顺序轮换。
 * 视觉层只接收 DIFF 信号做映射，不自行判断分数/时间/事件阈值。
 */
Theme.nameForDiff = function (diff) {
  const n = Theme.order.length;
  if (n === 0) return Theme.defaultName();
  const d = Math.max(1, Math.floor(diff) || 1);
  return Theme.order[(d - 1) % n];
};

/** 依据设置中的"主题模式"与当前 DIFF，解析实际生效的主题名 */
Theme.resolveName = function (mode, diff) {
  if (!mode || mode === Theme.MODE.auto) return Theme.nameForDiff(diff);
  return Theme.has(mode) ? mode : Theme.defaultName();
};

/* ============================================================
 * 换肤：CSS 变量注入 + DOM 标记
 * ============================================================ */

/** CSS 变量 → 主题定义字段路径（唯一映射表，样式表只认这些变量） */
Theme.CSS_VAR_MAP = {
  "--c-page": "palette.page",
  "--c-field": "palette.field",
  "--c-field-alt": "palette.fieldAlt",
  "--c-lane": "palette.laneA",
  "--c-lane-alt": "palette.laneB",
  "--c-lane-edge": "palette.laneEdge",
  "--c-text": "palette.text",
  "--c-text-mid": "palette.textMid",
  "--c-text-dim": "palette.textDim",
  "--c-text-bright": "palette.textBright",
  "--c-panel": "palette.panel",
  "--c-panel-alt": "palette.panelAlt",
  "--c-border": "palette.panelBorder",
  "--c-overlay": "palette.overlay",
  "--c-btn-bg": "palette.btnBg",
  "--c-btn-text": "palette.btnText",
  "--c-btn-border": "palette.btnBorder",
  "--c-btn-hover": "palette.btnHover",
  "--c-btn-active": "palette.btnActive",
  "--c-primary-bg": "palette.primary",
  "--c-primary-hover": "palette.primaryHover",
  "--c-primary-active": "palette.primaryActive",
  "--c-primary-text": "palette.primaryText",
  "--c-accent": "palette.accent",
  "--c-accent-alt": "palette.accentAlt",
  "--c-danger": "palette.danger",
  "--c-success": "palette.success",
  "--c-heart": "palette.heart",
  "--c-glow": "palette.glow",
  "--font-ui": "font.ui",
  "--font-display": "font.display",
  "--radius-panel": "css.radiusPanel",
  "--radius-btn": "css.radiusBtn",
  "--border-width": "css.borderWidth",
  "--panel-shadow": "css.panelShadow",
  "--btn-shadow": "css.btnShadow",
  "--hud-shadow": "css.hudShadow",
  "--letter-spacing": "css.letterSpacing",
  "--theme-transition": "css.transition",
  "--frag-radius": "css.fragRadius",
};

Theme.resolvePath = function (obj, path) {
  const parts = String(path).split(".");
  let cur = obj;
  for (let i = 0; i < parts.length; i++) {
    if (cur === null || cur === undefined) return undefined;
    cur = cur[parts[i]];
  }
  return cur;
};

Theme.onChange = function (cb) { if (typeof cb === "function") Theme.listeners.push(cb); };

/**
 * 应用主题：写 CSS 变量到 :root + 设置 data-theme 标记，
 * 同时通知监听者（渲染层每帧读取 Theme.get()，无需缓存失效处理）。
 */
Theme.apply = function (name, opts) {
  const def = Theme.get(name) || Theme.get();
  if (!def) return null;
  const changed = Theme.current !== def.id;
  Theme.current = def.id;
  if (typeof document !== "undefined" && document.documentElement) {
    const root = document.documentElement;
    for (const v in Theme.CSS_VAR_MAP) {
      const val = Theme.resolvePath(def, Theme.CSS_VAR_MAP[v]);
      if (val !== undefined && val !== null) root.style.setProperty(v, String(val));
    }
    root.setAttribute("data-theme", def.id);
    root.setAttribute("data-mode", def.mode);
    root.style.colorScheme = def.mode === "light" ? "light" : "dark";
  }
  if (changed && !(opts && opts.silent)) Theme.notify(def);
  return def;
};

Theme.notify = function (def) {
  for (let i = 0; i < Theme.listeners.length; i++) {
    try { Theme.listeners[i](def); } catch (e) { /* 监听者异常不影响换肤 */ }
  }
};

/**
 * 换肤过渡：给 body 挂一个短暂的"洗版"动画类，
 * 让 DIFF 触发的自动换主题不显得突兀（纯视觉，不阻塞游戏）。
 */
Theme.wash = function () {
  if (typeof document === "undefined" || !document.body) return;
  const el = document.getElementById("themeWash");
  if (!el) return;
  el.classList.remove("on");
  void el.offsetWidth;   // 强制重排以重启动画
  el.classList.add("on");
};

/* ============================================================
 * 主题模式持久化（只存"模式"，不存由 DIFF 推导出的具体主题）
 * ============================================================ */

Theme.loadMode = function () {
  try {
    const m = localStorage.getItem(Theme.PREF_KEY);
    if (m === Theme.MODE.auto || Theme.has(m)) return m;
  } catch (e) { /* 隐私模式等场景忽略 */ }
  return Theme.MODE.auto;
};

Theme.saveMode = function (m) {
  try { localStorage.setItem(Theme.PREF_KEY, String(m)); } catch (e) { /* 忽略 */ }
};

/* ---- 兼容旧调用点：颜色 → rgba ---- */
Theme.rgba = Gfx.rgba;
