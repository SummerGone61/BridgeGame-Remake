"use strict";

/**
 * ============================================================
 * tools/smoke-test.js —— 无浏览器冒烟测试（Node，无第三方依赖）
 *
 * 做什么：
 *   1) 用最小 DOM / Canvas 2D 桩件在 Node 里按 index.html 的顺序加载全部脚本；
 *   2) 真实执行 Main.boot()、真实跑主循环若干帧、真实派发画布点击（建桥）；
 *   3) 对每一次 Canvas 调用做参数体检：
 *         - 数值参数是否有限（NaN / Infinity / undefined 一律记录）
 *         - fillStyle / strokeStyle 是否被赋成非法值（undefined、[object Object]、NaN）
 *   4) 三款主题逐一换肤后重跑，确认每个主题都能独立完成渲染；
 *   5) 量化核对配色可读性（Gfx.contrast）：物品 vs 场地、HUD 文字 vs 面板。
 *
 * 退出码：全部通过 = 0；有任何失败 = 1（可直接用于 CI）。
 * 运行：node tools/smoke-test.js
 * ============================================================
 */

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");
const problems = [];
const notes = [];

function fail(msg) { problems.push(msg); }
function note(msg) { notes.push(msg); }

/* ============================================================
 * 一、Canvas 2D 桩件（记录调用 + 参数体检 + 变换感知的几何记录）
 *
 * 几何记录的作用：本工具链无法用肉眼看图，因此把"外观是否画在
 * 几何上正确的位置"变成可断言的数据 —— 桩件跟踪 CTM（含
 * save/restore/translate/rotate/scale），并像真实 Canvas 一样在
 * **构造路径的那一刻**把点变换到设备空间（之后改 CTM 不会移动
 * 已有路径）。这样 fill/stroke 记录下来的包围盒就是屏幕上真实
 * 的落点，可用来核对：场地是否铺满、每条通路是否贯穿、每座桥是否
 * 跨在正确的两条通路之间、每件物品是否落在它的世界坐标上。
 * ============================================================ */
function makeCtx() {
  const ctx = {
    ops: 0,
    calls: Object.create(null),
    colorSet: new Set(),
    bad: [],
    shapes: [],           // { kind, color, box:[x0,y0,x1,y1] }（设备/屏幕空间）
    record: false,        // 只在几何核对阶段打开，避免记录百万级调用
    _fill: "#000000",
    _stroke: "#000000",
  };

  /* ---- 变换矩阵（a b c d e f，与 Canvas 的 setTransform 参数同序）---- */
  let m = [1, 0, 0, 1, 0, 0];
  const stack = [];
  const mul = function (n) {
    // 新变换 = 当前 × n
    m = [
      m[0] * n[0] + m[2] * n[1],
      m[1] * n[0] + m[3] * n[1],
      m[0] * n[2] + m[2] * n[3],
      m[1] * n[2] + m[3] * n[3],
      m[0] * n[4] + m[2] * n[5] + m[4],
      m[1] * n[4] + m[3] * n[5] + m[5],
    ];
  };
  const tp = function (x, y) { return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]; };

  /* ---- 当前路径（设备空间点集）---- */
  let pts = [];
  let box = null;
  const add = function (x, y) {
    const p = tp(x, y);
    pts.push(p);
    box = box ? [Math.min(box[0], p[0]), Math.min(box[1], p[1]), Math.max(box[2], p[0]), Math.max(box[3], p[1])]
              : [p[0], p[1], p[0], p[1]];
  };
  const emit = function (kind, color, extra) {
    if (!ctx.record || !box) return;
    ctx.shapes.push({ kind: kind, color: color, box: box.slice(), extra: extra || null, count: pts.length });
  };

  const check = (name, args) => {
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (typeof a === "number" && !Number.isFinite(a)) {
        ctx.bad.push(name + " 参数非有限数: (" + args.join(", ") + ")");
      }
      if (a === undefined) {
        ctx.bad.push(name + " 出现 undefined 参数: (" + args.map(String).join(", ") + ")");
      }
    }
  };

  /**
   * 绘制开销权重（近似"真实代价"，不是简单计数）：
   * 一次光栅化（fill/stroke/fillRect/strokeRect/clip）比一次路径构造贵得多，
   * 因此按类加权，避免"把 40 次 fill 合成 1 次 fill"这类优化在看板上看不出来。
   */
  const COST = {
    fill: 12, stroke: 12, fillRect: 10, strokeRect: 10, clip: 8, clearRect: 8,
    fillText: 16, strokeText: 16, drawImage: 20,
    createLinearGradient: 6, createRadialGradient: 8,
    save: 1, restore: 1, setTransform: 1, transform: 1, translate: 1, scale: 1, rotate: 1,
  };
  const weigh = function (name) { return COST[name] === undefined ? 1 : COST[name]; };
  ctx.__weigh = weigh;   // 供开销画像按同样权重统计

  const simple = function (name) {
    return function () {
      const args = Array.prototype.slice.call(arguments);
      check(name, args);
      ctx.ops++;
      ctx.calls[name] = (ctx.calls[name] || 0) + 1;
      if (name === "fillText" || name === "strokeText") {
        if (typeof args[0] !== "string") ctx.bad.push("fillText 文本非字符串: " + String(args[0]));
      }
    };
  };

  /* ---- 变换类 ---- */
  ctx.setTransform = function (a, b, c, d, e, f) {
    check("setTransform", arguments);
    ctx.ops++;
    if (arguments.length === 6) m = [a, b, c, d, e, f];
    else if (arguments.length === 1 && a && typeof a === "object") m = [a.a, a.b, a.c, a.d, a.e, a.f];
  };
  ctx.resetTransform = function () { ctx.ops++; m = [1, 0, 0, 1, 0, 0]; };
  ctx.save = function () { ctx.ops++; stack.push(m.slice()); };
  ctx.restore = function () { ctx.ops++; if (stack.length) m = stack.pop(); };
  ctx.translate = function (x, y) { check("translate", arguments); ctx.ops++; mul([1, 0, 0, 1, x, y]); };
  ctx.scale = function (x, y) { check("scale", arguments); ctx.ops++; mul([x, 0, 0, y, 0, 0]); };
  ctx.rotate = function (a) {
    check("rotate", arguments);
    ctx.ops++;
    const c = Math.cos(a), s = Math.sin(a);
    mul([c, s, -s, c, 0, 0]);
  };
  ctx.transform = function (a, b, c, d, e, f) { check("transform", arguments); ctx.ops++; mul([a, b, c, d, e, f]); };

  /* ---- 路径类（构造即变换到设备空间，符合 Canvas 规范）---- */
  ctx.beginPath = function () { ctx.ops++; pts = []; box = null; };
  ctx.closePath = function () { ctx.ops++; };
  ctx.moveTo = function (x, y) { check("moveTo", arguments); ctx.ops++; add(x, y); };
  ctx.lineTo = function (x, y) { check("lineTo", arguments); ctx.ops++; add(x, y); };
  ctx.rect = function (x, y, w, h) {
    check("rect", arguments); ctx.ops++;
    add(x, y); add(x + w, y); add(x + w, y + h); add(x, y + h);
  };
  ctx.arc = function (cx, cy, r) {
    check("arc", arguments); ctx.ops++;
    add(cx - r, cy - r); add(cx + r, cy - r); add(cx + r, cy + r); add(cx - r, cy + r);
  };
  ctx.ellipse = function (cx, cy, rx, ry) {
    check("ellipse", arguments); ctx.ops++;
    add(cx - rx, cy - ry); add(cx + rx, cy - ry); add(cx + rx, cy + ry); add(cx - rx, cy + ry);
  };
  ctx.arcTo = function (x1, y1, x2, y2) { check("arcTo", arguments); ctx.ops++; add(x1, y1); add(x2, y2); };
  ctx.quadraticCurveTo = function (cx, cy, x, y) { check("quadraticCurveTo", arguments); ctx.ops++; add(cx, cy); add(x, y); };
  ctx.bezierCurveTo = function (c1x, c1y, c2x, c2y, x, y) {
    check("bezierCurveTo", arguments); ctx.ops++; add(c1x, c1y); add(c2x, c2y); add(x, y);
  };
  ctx.clip = function () { ctx.ops++; };

  /* ---- 绘制类 ---- */
  ctx.fill = function () { ctx.ops++; ctx.calls.fill = (ctx.calls.fill || 0) + 1; emit("fill", ctx._fill); };
  ctx.stroke = function () { ctx.ops++; ctx.calls.stroke = (ctx.calls.stroke || 0) + 1; emit("stroke", ctx._stroke); };
  ctx.fillRect = function (x, y, w, h) {
    check("fillRect", arguments); ctx.ops++;
    ctx.calls.fillRect = (ctx.calls.fillRect || 0) + 1;
    if (ctx.record) {
      const a = tp(x, y), b = tp(x + w, y + h);
      ctx.shapes.push({
        kind: "fillRect", color: ctx._fill,
        box: [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])],
      });
    }
  };
  ctx.strokeRect = function (x, y, w, h) {
    check("strokeRect", arguments); ctx.ops++;
    if (ctx.record) {
      const a = tp(x, y), b = tp(x + w, y + h);
      ctx.shapes.push({
        kind: "strokeRect", color: ctx._stroke,
        box: [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])],
      });
    }
  };
  ctx.clearRect = simple("clearRect");
  ctx.fillText = simple("fillText");
  ctx.strokeText = simple("strokeText");
  ctx.setLineDash = simple("setLineDash");
  ctx.drawImage = simple("drawImage");

  ctx.createLinearGradient = function () { check("createLinearGradient", arguments); return { addColorStop: function () {}, __gradient: true }; };
  ctx.createRadialGradient = function () { check("createRadialGradient", arguments); return { addColorStop: function () {}, __gradient: true }; };
  ctx.createPattern = function () { return null; };
  ctx.measureText = function (t) { return { width: String(t).length * 7 }; };
  ctx.getImageData = function () { return { data: new Uint8ClampedArray(4) }; };
  ctx.putImageData = function () {};
  ctx.canvas = { width: 1280, height: 820 };
  ctx.__ctm = function () { return m.slice(); };

  function colorProp(name) {
    return {
      get: function () { return name === "fill" ? ctx._fill : ctx._stroke; },
      set: function (v) {
        // 合法的 CanvasGradient（渐变对象）不算非法颜色
        const isGradient = v && typeof v === "object" && v.__gradient === true;
        const bad = (!isGradient) && (v === undefined || v === null || v === "" ||
          (typeof v === "object") || (typeof v === "string" && /NaN|undefined|\[object/.test(v)));
        if (bad) ctx.bad.push(name + " 被赋值为非法颜色: " + String(v));
        else if (!isGradient) ctx.colorSet.add(String(v));
        if (!isGradient) { if (name === "fill") ctx._fill = v; else ctx._stroke = v; }
      },
    };
  }
  Object.defineProperty(ctx, "fillStyle", colorProp("fill"));
  Object.defineProperty(ctx, "strokeStyle", colorProp("stroke"));
  Object.defineProperty(ctx, "shadowColor", colorProp("shadow"));
  Object.defineProperty(ctx, "globalAlpha", { value: 1, writable: true });
  Object.defineProperty(ctx, "lineWidth", { value: 1, writable: true });
  Object.defineProperty(ctx, "font", { value: "13px sans-serif", writable: true });
  Object.defineProperty(ctx, "textAlign", { value: "left", writable: true });
  Object.defineProperty(ctx, "textBaseline", { value: "alphabetic", writable: true });
  Object.defineProperty(ctx, "shadowBlur", { value: 0, writable: true });
  Object.defineProperty(ctx, "lineCap", { value: "butt", writable: true });
  Object.defineProperty(ctx, "lineJoin", { value: "miter", writable: true });
  Object.defineProperty(ctx, "globalCompositeOperation", { value: "source-over", writable: true });
  Object.defineProperty(ctx, "miterLimit", { value: 10, writable: true });
  Object.defineProperty(ctx, "imageSmoothingEnabled", { value: true, writable: true });
  return ctx;
}

/* ============================================================
 * 二、最小 DOM 桩件
 * ============================================================ */
function makeDom() {
  function El(tag) {
    const el = {
      tagName: String(tag || "div").toUpperCase(),
      children: [],
      parentNode: null,
      dataset: {},
      attrs: {},
      listeners: Object.create(null),
      _text: "",
      _html: "",
      value: "1",
      type: "",
      checked: false,
      offsetWidth: 96,
      offsetHeight: 104,
      style: {
        setProperty: function (k, v) {
          if (v === undefined || v === null || /NaN/.test(String(v))) {
            fail("CSS 变量 " + k + " 被赋值为非法值: " + String(v));
          }
          this[k] = v;
        },
        removeProperty: function () {},
      },
      classList: (function () {
        const set = new Set();
        return {
          add: function (c) { set.add(c); },
          remove: function (c) { set.delete(c); },
          contains: function (c) { return set.has(c); },
          toggle: function (c, on) { if (on === undefined) { set.has(c) ? set.delete(c) : set.add(c); } else if (on) set.add(c); else set.delete(c); },
          _set: set,
        };
      })(),
    };
    // textContent / innerHTML 与真实 DOM 一致：赋值即清空子节点
    Object.defineProperty(el, "textContent", {
      get: function () { return el._text; },
      set: function (v) { el._text = String(v); el.children.length = 0; },
    });
    Object.defineProperty(el, "innerHTML", {
      get: function () { return el._html; },
      set: function (v) { el._html = String(v); el.children.length = 0; },
    });
    el.addEventListener = function (type, fn) {
      (el.listeners[type] = el.listeners[type] || []).push(fn);
    };
    el.removeEventListener = function () {};
    el.dispatch = function (type, ev) {
      const arr = el.listeners[type] || [];
      arr.forEach(function (fn) { fn(ev || {}); });
      return arr.length;
    };
    el.appendChild = function (c) { el.children.push(c); c.parentNode = el; return c; };
    el.removeChild = function (c) {
      const i = el.children.indexOf(c);
      if (i >= 0) el.children.splice(i, 1);
      return c;
    };
    el.remove = function () { if (el.parentNode) el.parentNode.removeChild(el); };
    el.setAttribute = function (k, v) { el.attrs[k] = String(v); };    el.getAttribute = function (k) { return el.attrs[k] === undefined ? null : el.attrs[k]; };
    el.querySelectorAll = function () { return []; };
    el.querySelector = function () { return null; };
    el.focus = function () {};
    el.getContext = function () { return el._ctx; };
    el.getBoundingClientRect = function () {
      return { left: 0, top: 0, right: el.offsetWidth, bottom: el.offsetHeight, width: el.offsetWidth, height: el.offsetHeight };
    };
    return el;
  }

  const registry = Object.create(null);
  const documentElement = El("html");
  const body = El("body");

  const document = {
    readyState: "complete",
    documentElement: documentElement,
    body: body,
    createElement: function (tag) { return El(tag); },
    getElementById: function (id) {
      if (!registry[id]) {
        const el = El(id === "game-canvas" ? "canvas" : "div");
        if (id === "game-canvas") {
          el._ctx = makeCtx();
          el.width = 1280;
          el.height = 820;
          el.offsetWidth = 1280;
          el.offsetHeight = 820;
        }
        registry[id] = el;
      }
      return registry[id];
    },
    addEventListener: function () {},
    querySelectorAll: function () { return []; },
    querySelector: function () { return null; },
  };

  const store = Object.create(null);
  const localStorage = {
    getItem: function (k) { return store[k] === undefined ? null : store[k]; },
    setItem: function (k, v) { store[k] = String(v); },
    removeItem: function (k) { delete store[k]; },
  };

  let now = 1000;
  const rafs = [];
  const window = {
    innerWidth: 1280,
    innerHeight: 820,
    devicePixelRatio: 1,
    addEventListener: function () {},
    removeEventListener: function () {},
    requestAnimationFrame: function (cb) { rafs.push(cb); return rafs.length; },
    cancelAnimationFrame: function () {},
    setTimeout: function (fn) { return setTimeout(fn, 0); },
    clearTimeout: clearTimeout,
    localStorage: localStorage,
    document: document,
  };

  return {
    document: document, window: window, localStorage: localStorage, registry: registry,
    canvas: document.getElementById("game-canvas"),
    ctx: document.getElementById("game-canvas")._ctx,
    rafs: rafs,
    now: function () { return now; },
    advance: function (ms) { now += ms; return now; },
  };
}

/* ============================================================
 * 三、按 index.html 的顺序加载脚本
 * ============================================================ */
const SCRIPTS = [
  "js/config.js",
  "js/logic.js",
  "js/gfx.js",
  "js/theme.js",
  "js/themes/neon.js",
  "js/themes/ink.js",
  "js/themes/clay.js",
  "js/render.js",
  "js/input.js",
  "js/theme-ui.js",
  "js/main.js",
];

function loadScripts(dom) {
  const sandbox = {
    window: dom.window,
    document: dom.document,
    navigator: { maxTouchPoints: 0, userAgent: "node-smoke-test" },
    localStorage: dom.localStorage,
    performance: { now: function () { return dom.now(); } },
    requestAnimationFrame: dom.window.requestAnimationFrame,
    cancelAnimationFrame: dom.window.cancelAnimationFrame,
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    console: console,
    Math: Math,
    Map: Map,
    Set: Set,
    Object: Object,
    Array: Array,
    String: String,
    Number: Number,
    JSON: JSON,
    Date: Date,
    Error: Error,
    isFinite: isFinite,
    parseInt: parseInt,
    parseFloat: parseFloat,
    Uint8ClampedArray: Uint8ClampedArray,
    Uint8Array: Uint8Array,
  };
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  const context = vm.createContext(sandbox);

  for (const rel of SCRIPTS) {
    const file = path.join(ROOT, rel);
    if (!fs.existsSync(file)) { fail("缺少脚本文件：" + rel); continue; }
    const code = fs.readFileSync(file, "utf8");
    try {
      vm.runInContext(code, context, { filename: rel });
    } catch (e) {
      fail("加载 " + rel + " 抛错：" + (e && e.message));
    }
  }
  return context;
}

/* ============================================================
 * 四、执行测试
 * ============================================================ */
function main() {
  const dom = makeDom();
  const ctx = dom.ctx;
  const sandbox = loadScripts(dom);
  // 顶层 const 在 vm 中属于"全局词法环境"，不会挂到 context 对象上，
  // 因此显式导出一份引用给测试使用（与浏览器多 <script> 共享顶层 const 的行为一致）。
  let api = null;
  try {
    vm.runInContext(
      "globalThis.__api = { Theme: Theme, Config: Config, Logic: Logic, Render: Render, " +
      "ThemeUI: ThemeUI, Main: Main, Gfx: Gfx, Input: Input };",
      sandbox, { filename: "export-api.js" });
    api = sandbox.__api;
  } catch (e) {
    fail("导出脚本 API 失败：" + e.message);
  }
  if (!api) return report();
  const { Theme, Config, Logic, Render, ThemeUI, Main, Gfx, Input } = api;

  // 缺少某个脚本时仍然继续跑：这样报告里既有"缺文件"也有后续全部体检结果
  const ids = Theme.order.slice();
  if (ids.length !== 3) fail("应有 3 款主题，实际注册 " + ids.length + " 款：" + ids.join(", "));
  const required = ["neon", "ink", "clay"];
  required.forEach(function (id) {
    if (!Theme.has(id)) fail("缺少主题：" + id);
  });
  if (Theme.definitions[ids[0]] === undefined) fail("主题注册表为空");

  // ---- 主循环：真实启动 ----
  if (typeof Main.boot !== "function") fail("Main.boot 未定义");
  const livesBefore = (dom.registry["lives"] && dom.registry["lives"].children.length) || 0;
  if (livesBefore === 0) {
    // main.js 在 readyState !== "loading" 时已自动 boot（与浏览器一致）；
    // 只有自动启动没发生时，测试才显式补一次，避免重复装配。
    try {
      Main.boot();
    } catch (e) {
      fail("Main.boot() 抛错：" + (e && e.stack ? e.stack.split("\n")[0] : e));
      return report();
    }
  }

  // HUD / 生命图标 / 主题选择器是否被真实构建
  const livesEl = dom.registry["lives"];
  if (!livesEl || livesEl.children.length !== 5) {
    fail("生命图标未按 5 个生成（实际 " + (livesEl ? livesEl.children.length : "无容器") + "）");
  } else if (!/svg/i.test(livesEl.children[0].innerHTML || "")) {
    fail("生命图标未注入主题 SVG");
  }
  const picker = dom.registry["themePicker"];
  if (!picker || picker.children.length !== ids.length + 1) {
    fail("主题选择器卡片数量异常（期望 " + (ids.length + 1) + "，实际 " + (picker ? picker.children.length : "无容器") + "）");
  } else {
    const autoCard = picker.children[0];
    if (autoCard.dataset.mode !== "auto") fail("主题选择器首张卡片应为 auto");
    if (autoCard.getAttribute("aria-checked") !== "true") fail("默认应选中 auto（跟随难度）");
  }

  // ---- 帧驱动 ----
  function runFrames(n, step) {
    const sceneState = { ops: 0, bad: 0 };
    for (let i = 0; i < n; i++) {
      const cbs = dom.rafs.splice(0, dom.rafs.length);
      if (!cbs.length) { fail("主循环未继续请求下一帧（第 " + i + " 帧）"); break; }
      const t = dom.advance(step || 16.7);
      cbs.forEach(function (cb) {
        try { cb(t); } catch (e) { fail("帧回调抛错：" + (e && e.stack ? e.stack.split("\n").slice(0, 2).join(" | ") : e)); }
      });
    }
    sceneState.ops = ctx.ops;
    return sceneState;
  }

  const beforeOps = ctx.ops;
  runFrames(8);
  if (ctx.ops <= beforeOps) fail("开始界面下画布没有任何绘制调用");

  // ---- 点击「开始」进入游戏 ----
  const startOverlay = dom.registry["startOverlay"];
  if (startOverlay.classList.contains("hidden")) fail("初始状态开始界面应可见（不应带 hidden）");
  const clicks = dom.registry["startBtn"].dispatch("click");
  if (clicks === 0) fail("开始按钮没有绑定点击事件");
  if (!startOverlay.classList.contains("hidden")) fail("点击开始后开始界面未隐藏");

  // ---- 用真实输入通道建桥：屏幕坐标 → 世界坐标由 Input 反解 ----
  // 复刻 main.js 的视口公式（仅用于把测试点击落到目标世界坐标上）
  const hudH = 104;
  const availW = 1280 - 16;
  const availH = 820 - (hudH + 24) - 90 - 8;
  const scale = Math.min(availW / Config.worldWidth, availH / Config.worldHeight);
  const offsetX = (1280 - Config.worldWidth * scale) / 2;
  const offsetY = (hudH + 24) + (availH - Config.worldHeight * scale) / 2;
  function clickWorld(wx, wy) {
    dom.canvas.dispatch("click", {
      clientX: offsetX + wx * scale,
      clientY: offsetY + wy * scale,
    });
  }

  clickWorld(40, 40);    // L1-L2 之间
  clickWorld(100, 120);  // L2-L3 之间
  clickWorld(160, 260);  // L3-L4 之间
  clickWorld(40, 40);    // 命中已有桥 → 拆桥

  const bridges = null;   // state 是 main.js 内部变量；桥的效果通过渲染调用与帧数间接验证
  runFrames(120, 16.7);
  const midOps = ctx.ops;
  if (midOps <= beforeOps) fail("游戏进行中画布没有任何绘制调用");

  // ---- 让逻辑层真实生成、投递一些物品（跑满 20 秒） ----
  runFrames(1200, 16.7);

  // ---- 端到端回归：Game Over →「再来一局」→ 五个生命图标必须全部回来 ----
  // 历史 bug：mountLives 的 set() 只在"生命变少"时改 DOM（隐藏被消耗的图标），
  // 重开一局（0 → 5）时只更新内部计数，于是重开后 LIVES 一行永久空白
  // （只有换主题触发 paint() 才会突然冒出来）。这里用真实主循环玩到 Game Over，
  // 再点真实的「再来一局」按钮来验证修复。
  const restart = [];
  (function restartLifecycle() {
    const livesEl = dom.registry["lives"];
    const visibleHearts = function () {
      let c = 0;
      livesEl.children.forEach(function (el) {
        if (el.style.display !== "none") c++;
      });
      return c;
    };
    const step = function (n) {
      for (let i = 0; i < n; i++) {
        const cbs = dom.rafs.splice(0, dom.rafs.length);
        if (!cbs.length) return false;
        const t = dom.advance(16.7);
        cbs.forEach(function (cb) {
          try { cb(t); } catch (e) { fail("重开流程帧回调抛错：" + (e && e.message)); }
        });
      }
      return true;
    };

    // 加速时间：只改生成间隔与下落速度这两个平衡参数（不碰任何规则常量），
    // 让真实主循环在几十~几百帧内掉光 5 条命。
    const saved = {
      spawnBaseInterval: Config.spawnBaseInterval,
      spawnMinInterval: Config.spawnMinInterval,
      itemSpeed: Config.itemSpeed,
    };
    Config.spawnBaseInterval = 0.05;
    Config.spawnMinInterval = 0.05;
    Config.itemSpeed = 900;

    // 先用真实的「再来一局」按钮开一局（等价于开始界面点「开始」）
    dom.registry["restartBtn"].dispatch("click");
    const heartsAtStart = visibleHearts();

    // 跑到 Game Over：结算面板去掉 hidden 即表示游戏结束
    const overEl = dom.registry["gameOverOverlay"];
    let frames = 0;
    while (overEl.classList.contains("hidden") && frames < 6000) {
      if (!step(1)) break;
      frames++;
    }
    const reachedOver = !overEl.classList.contains("hidden");
    const atOver = visibleHearts();

    // 点「再来一局 (R)」→ 五颗心必须全部回来
    dom.registry["restartBtn"].dispatch("click");
    const afterRestart = visibleHearts();

    // 再掉一条命：应当只隐藏最右边 1 颗，其余 4 颗仍在（且不再"凭空消失"）
    let hitFrames = 0;
    while (visibleHearts() === 5 && hitFrames < 900) {
      if (!step(1)) break;
      hitFrames++;
    }
    const afterOneHit = visibleHearts();

    if (heartsAtStart !== 5) fail("重开一局后生命图标不是 5 颗（实际 " + heartsAtStart + " 颗）");
    if (!reachedOver) fail("加速跑 " + frames + " 帧仍未进入 Game Over，无法验证重开流程");
    if (reachedOver && atOver !== 0) fail("Game Over 时生命图标应为 0 颗，实际 " + atOver + " 颗");
    if (afterRestart !== 5) {
      fail("重开一局后生命图标未恢复：期望 5 颗，实际 " + afterRestart +
           " 颗（set() 没有把显隐同步回 DOM）");
    }
    if (afterOneHit !== 4) {
      fail("重开后掉一条命应剩 4 颗心，实际 " + afterOneHit + " 颗");
    }
    restart.push({
      framesToOver: frames,
      atStart: heartsAtStart,
      atOver: atOver,
      afterRestart: afterRestart,
      afterOneHit: afterOneHit,
    });

    Config.spawnBaseInterval = saved.spawnBaseInterval;
    Config.spawnMinInterval = saved.spawnMinInterval;
    Config.itemSpeed = saved.itemSpeed;
  })();

  // ---- 逐主题换肤并重跑 ----
  const perTheme = [];
  const themeIds = ["auto"].concat(ids);
  themeIds.forEach(function (mode) {
    let err = null;
    try { ThemeUI.setMode(mode); } catch (e) { err = e; }
    if (err) { fail("切换到 " + mode + " 抛错：" + err.message); return; }

    ctx.bad.length = 0;
    ctx.colorSet.clear();
    const opsBefore = ctx.ops;
    runFrames(40, 16.7);
    const ops = ctx.ops - opsBefore;

    if (ops < 200) fail("主题 " + mode + " 下绘制调用过少（" + ops + "），疑似未渲染");
    if (ctx.bad.length) {
      fail("主题 " + mode + " 出现非法绘制参数 " + ctx.bad.length + " 处，例如：" + ctx.bad.slice(0, 4).join(" ／ "));
    }
    perTheme.push({
      mode: mode,
      applied: Theme.current,
      ops: ops,
      colors: ctx.colorSet.size,
      callKinds: Object.keys(ctx.calls).length,
    });
  });

  // ---- 核心规则回归（证明重构只动外观：规则行为逐条核对）----
  const rules = [];
  function rule(name, ok, detail) {
    rules.push({ name: name, ok: !!ok, detail: detail || "" });
    if (!ok) fail("规则核对失败：" + name + (detail ? "（" + detail + "）" : ""));
  }

  (function rulesCheck() {
    const st = Logic.createInitialState();
    rule("初始生命为 5", st.lives === 5);
    rule("开局难度 Lv.1", Logic.diffLevel(st) === 1);

    // 建桥：仅相邻通路 + 场地内 + 纵向不重叠（共享通路时）
    rule("相邻通路可建桥", Logic.applyIntent(st, { kind: "build", laneA: 0, laneB: 1, y: 40 }) === true);
    rule("非相邻通路不可建桥", Logic.applyIntent(st, { kind: "build", laneA: 0, laneB: 2, y: 200 }) === false);
    rule("越界位置不可建桥", Logic.applyIntent(st, { kind: "build", laneA: 2, laneB: 3, y: 1 }) === false);
    rule("共享通路的桥不可纵向重叠",
      Logic.applyIntent(st, { kind: "build", laneA: 1, laneB: 2, y: 43 }) === false);
    rule("不共享通路的桥可同高度共存",
      Logic.applyIntent(st, { kind: "build", laneA: 2, laneB: 3, y: 40 }) === true);

    // 物品自动进桥 → 水平过桥 → 回到通路继续下落
    const it = {
      id: 0, type: "A", lane: 0, y: 0, x: Config.laneXs[0],
      target: 0, onBridge: null, crossDir: 0,
    };
    st.nextSpawnAt = Infinity;   // 关掉生成，隔离本次"进桥/过桥"行为
    st.items.length = 0;
    st.items.push(it);
    it.y = 30;
    Logic.update(st, 1 / 120, { speedFactor: 1, spawnFactor: 1 });
    // 手动推进到桥面上方再走一步
    let entered = false;
    for (let i = 0; i < 400 && !entered; i++) {
      Logic.update(st, 1 / 120, { speedFactor: 1, spawnFactor: 1 });
      if (it.onBridge !== null) entered = true;
    }
    rule("物品自上而下自动进桥", entered, "400 步内未进桥");

    let crossed = false;
    for (let i = 0; i < 4000 && !crossed; i++) {
      Logic.update(st, 1 / 120, { speedFactor: 1, spawnFactor: 1 });
      if (it.onBridge === null && it.lane === 1) crossed = true;
    }
    rule("桥上水平过桥并落到相邻通路", crossed, "未完成过桥");

    // 投递结算：正确 +1 分；错误 -1 命
    const st2 = Logic.createInitialState();
    Logic.deliver(st2, { lane: 2, target: 2 });
    rule("正确投递 +1 分", st2.score === 1);
    Logic.deliver(st2, { lane: 1, target: 3 });
    rule("错误投递 -1 命", st2.lives === 4);
    const st3 = Logic.createInitialState();
    st3.lives = 1;
    Logic.deliver(st3, { lane: 0, target: 1 });
    rule("生命归零立即 Game Over", st3.gameOver === true && st3.lives === 0);

    // 桥上有物品时不可拆桥（§9）
    const st4 = Logic.createInitialState();
    Logic.applyIntent(st4, { kind: "build", laneA: 0, laneB: 1, y: 100 });
    const b0 = st4.bridges[0];
    st4.items.push({ id: 9, type: "A", lane: 0, y: 100, x: Config.laneXs[0], target: 0, onBridge: b0.id, crossDir: 1 });
    rule("桥上有物品 → 不可拆桥", Logic.applyIntent(st4, { kind: "delete", bridgeId: b0.id }) === false);
    st4.items.length = 0;
    rule("桥上无物品 → 可拆桥", Logic.applyIntent(st4, { kind: "delete", bridgeId: b0.id }) === true);

    // 难度曲线：每 15 分一档
    const st5 = Logic.createInitialState();
    st5.score = 15;
    rule("15 分升到 Lv.2", Logic.diffLevel(st5) === 2);
    st5.score = 45;
    rule("45 分升到 Lv.4", Logic.diffLevel(st5) === 4);
  })();


  // ---- 几何落点核对：外观是否画在"逻辑几何"该在的位置 ----
  // 说明：本工具链无法肉眼看图，所以把"看起来对不对"里最硬的一部分
  //       ——空间位置——变成断言：用变换感知的桩件记录每次 fill/stroke 的
  //       屏幕包围盒，再核对场地/通路/桥/物品/仓库是否落在正确坐标上。
  const layout = [];
  (function layoutCheck() {
    const vp = {
      cssW: 1280, cssH: 820, dpr: 1, scale: scale, offsetX: offsetX, offsetY: offsetY,
    };
    const scene = Logic.createInitialState();
    Logic.applyIntent(scene, { kind: "build", laneA: 0, laneB: 1, y: 90 });
    Logic.applyIntent(scene, { kind: "build", laneA: 1, laneB: 2, y: 200 });
    Logic.applyIntent(scene, { kind: "build", laneA: 3, laneB: 4, y: 330 });
    const types = ["A", "B", "C", "D", "E"];
    types.forEach(function (t, lane) {
      scene.items.push({
        id: lane, type: t, lane: lane, y: 40 + lane * 62,
        x: Config.laneXs[lane], target: Config.typeTarget[t], onBridge: null, crossDir: 0,
      });
    });

    const fieldX0 = vp.offsetX, fieldY0 = vp.offsetY;
    const fieldX1 = vp.offsetX + Config.worldWidth * vp.scale;
    const fieldY1 = vp.offsetY + Config.laneLength * vp.scale;
    const fieldH = fieldY1 - fieldY0;
    const s = function (wx) { return vp.offsetX + wx * vp.scale; };
    const sy = function (wy) { return vp.offsetY + wy * vp.scale; };
    const contains = function (b, x, y, tol) {
      const t = tol || 0;
      return b[0] <= x + t && b[2] >= x - t && b[1] <= y + t && b[3] >= y - t;
    };
    const W = function (b) { return b[2] - b[0]; };
    const Hh = function (b) { return b[3] - b[1]; };

    ids.forEach(function (id) {
      ThemeUI.setMode(id);
      const def = Theme.definitions[id];
      const m = def.metrics;

      // ① 场地：必须有一块铺满世界矩形的绘制
      ctx.shapes.length = 0;
      ctx.record = true;
      Render.draw(scene, ctx, vp, null, 1234);
      ctx.record = false;
      const shapes = ctx.shapes.slice();
      const stat = { theme: id, shapes: shapes.length };
      const fieldShape = shapes.some(function (sh) {
        return sh.box[0] <= fieldX0 + 2 && sh.box[1] <= fieldY0 + 2 &&
               sh.box[2] >= fieldX1 - 2 && sh.box[3] >= fieldY1 - 2;
      });
      stat.field = fieldShape;
      if (!fieldShape) fail("主题 " + def.label + " 未铺满场地（field 钩子没有覆盖世界矩形）");

      // ② 物品：每件物品处都要有"尺寸像物品"的绘制，且中心对得上
      stat.items = 0;
      scene.items.forEach(function (it) {
        const cx = s(it.x), cy = sy(it.y);
        const hit = shapes.some(function (sh) {
          if (!contains(sh.box, cx, cy, 1)) return false;
          const mx = Math.max(W(sh.box), Hh(sh.box));
          if (mx > m.itemRadius * vp.scale * 4.5) return false;      // 排除场地/通路/桥
          const bx = (sh.box[0] + sh.box[2]) / 2, by = (sh.box[1] + sh.box[3]) / 2;
          return Math.abs(bx - cx) <= m.itemRadius * vp.scale * 1.4 &&
                 Math.abs(by - cy) <= m.itemRadius * vp.scale * 1.4;
        });
        if (hit) stat.items++;
        else fail("主题 " + def.label + " 的物品 " + it.type + "（通路 L" + (it.lane + 1) +
                  "）没有画在它的世界坐标上（" + Math.round(cx) + "," + Math.round(cy) + "）");
      });

      // ③ 通路：每条通路 x 处都要有"纵向贯穿、横向很窄"的绘制
      stat.lanes = 0;
      for (let i = 0; i < Config.laneCount; i++) {
        const lx = s(Config.laneXs[i]);
        const hit = shapes.some(function (sh) {
          return Hh(sh.box) >= fieldH * 0.5 &&
                 W(sh.box) <= Config.laneSpacing * vp.scale * 0.5 &&
                 contains(sh.box, lx, fieldY0 + fieldH / 2, 1.5);
        });
        if (hit) stat.lanes++;
        else fail("主题 " + def.label + " 的通路 L" + (i + 1) + " 没有在 x=" + Config.laneXs[i] + " 处纵向贯穿");
      }

      // ④ 桥：每座桥要跨在它连接的两条通路上，且纵向落在桥位
      stat.bridges = 0;
      scene.bridges.forEach(function (b) {
        const bx0 = s(Config.laneXs[b.lanes[0]]), bx1 = s(Config.laneXs[b.lanes[1]]);
        const by = sy(b.y);
        const hit = shapes.some(function (sh) {
          if (Math.abs(sh.box[0] - bx0) > 5 || Math.abs(sh.box[2] - bx1) > 5) return false;
          if (!contains(sh.box, (bx0 + bx1) / 2, by, 2)) return false;
          return Hh(sh.box) <= Config.bridgeWidth * vp.scale * 3;
        });
        if (hit) stat.bridges++;
        else fail("主题 " + def.label + " 的桥（L" + (b.lanes[0] + 1) + "-L" + (b.lanes[1] + 1) +
                  " y=" + b.y + "）没有画在正确的跨距/桥位上");
      });

      // ⑤ 仓库：场地底部之下、每条通路正下方都要有仓库绘制
      stat.warehouses = 0;
      stat.warehouseIcons = 0;
      for (let i = 0; i < Config.laneCount; i++) {
        const lx = s(Config.laneXs[i]);
        const hit = shapes.some(function (sh) {
          return sh.box[1] >= fieldY1 - 3 && W(sh.box) <= m.warehouseWidth * vp.scale * 1.6 &&
                 W(sh.box) >= m.warehouseWidth * vp.scale * 0.4 &&
                 contains(sh.box, lx, fieldY1 + m.warehouseHeight * vp.scale * 0.5, 3);
        });
        if (hit) stat.warehouses++;
        else fail("主题 " + def.label + " 的仓库 L" + (i + 1) + " 没有画在场地底部正下方");

        // ⑤b 仓库内的目标形状：必须有"图标大小"的绘制落在印面/罐体中心附近。
        //     这一条专门防"形状被画到世界原点"这类坐标系错误（曾在水墨主题出现：
        //     glyphInkPath 忽略 x/y，五个目标形状全叠在场地左上角，印面里空空如也）。
        const whCy = fieldY1 + m.warehouseHeight * vp.scale * 0.5;
        const wantW = m.warehouseIconRadius * vp.scale * 2;
        const icon = shapes.some(function (sh) {
          const bw = W(sh.box), bh = Hh(sh.box);
          if (bw < wantW * 0.45 || bw > wantW * 1.7) return false;
          if (bh < wantW * 0.35 || bh > wantW * 1.9) return false;
          if (sh.box[1] < fieldY1 - 3) return false;
          const cx = (sh.box[0] + sh.box[2]) / 2, cy = (sh.box[1] + sh.box[3]) / 2;
          return Math.abs(cx - lx) <= 3 * vp.scale && Math.abs(cy - whCy) <= m.warehouseHeight * vp.scale * 0.6;
        });
        if (icon) stat.warehouseIcons++;
        else fail("主题 " + def.label + " 的仓库 L" + (i + 1) + " 内没有目标形状图标（印面/罐体里是空的）");
      }

      // ⑥ 建桥预览：给出 hover 候选后，候选位置必须出现"跨两通路"的绘制
      const cand = { laneA: 1, laneB: 2, y: 280, legal: true };
      ctx.shapes.length = 0;
      ctx.record = true;
      Render.draw(scene, ctx, vp, { bridgeId: null, candidate: cand }, 1234);
      ctx.record = false;
      const gx0 = s(Config.laneXs[1]), gx1 = s(Config.laneXs[2]), gy = sy(cand.y);
      stat.ghost = ctx.shapes.some(function (sh) {
        return W(sh.box) >= (gx1 - gx0) * 0.6 && contains(sh.box, (gx0 + gx1) / 2, gy, 4) &&
               Math.abs(sh.box[1] - gy) <= Config.bridgeWidth * vp.scale * 1.5;
      });
      if (!stat.ghost) fail("主题 " + def.label + " 的建桥预览没有画在候选位置（y=" + cand.y + "）");

      layout.push(stat);
    });
    ThemeUI.setMode("auto");
  })();

  // ---- 主题资源体检：生命图标 + CSS 变量闭环 ----
  ids.forEach(function (id) {
    const def = Theme.definitions[id];
    const svg = def.livesIcon || "";
    if (!/<svg/i.test(svg) || !/viewBox/i.test(svg)) fail("主题 " + def.label + " 的生命图标不是合法内联 SVG");
    if (/<filter|\sid\s*=/.test(svg)) fail("主题 " + def.label + " 的生命图标里含 filter/id（重复 id 会互相干扰）");
    if (!def.preview || !def.preview.bg || !Array.isArray(def.preview.dots)) {
      fail("主题 " + def.label + " 缺少 preview 预览数据（主题卡片会没有缩略图）");
    }
  });

  const cssAudit = (function () {
    const files = ["css/style.css", "css/themes.css"];
    const used = new Set();
    const declared = new Set();
    files.forEach(function (rel) {
      const p = path.join(ROOT, rel);
      if (!fs.existsSync(p)) { fail("缺少样式文件：" + rel); return; }
      const css = fs.readFileSync(p, "utf8");
      let m;
      const reUse = /var\(\s*(--[\w-]+)/g;
      while ((m = reUse.exec(css))) used.add(m[1]);
      const reDecl = /^\s*(--[\w-]+)\s*:/gm;
      while ((m = reDecl.exec(css))) declared.add(m[1]);
    });
    // JS 里用 setProperty("--x", ...) 动态写入的变量（如生命碎裂的 --dx/--dy）也算有来源
    const dynamic = new Set();
    ["js/main.js", "js/theme-ui.js", "js/render.js", "js/gfx.js"].forEach(function (rel) {
      const p = path.join(ROOT, rel);
      if (!fs.existsSync(p)) return;
      const code = fs.readFileSync(p, "utf8");
      let m;
      const re = /setProperty\(\s*["'](--[\w-]+)["']/g;
      while ((m = re.exec(code))) dynamic.add(m[1]);
    });
    const injected = new Set(Object.keys(Theme.CSS_VAR_MAP));
    const missing = Array.from(used).filter(function (v) {
      return !declared.has(v) && !injected.has(v) && !dynamic.has(v);
    });
    const dead = Array.from(injected).filter(function (v) { return !used.has(v); });
    if (missing.length) fail("样式里用到但没有任何来源的 CSS 变量：" + missing.join(", "));
    if (dead.length) fail("主题注入了样式表未使用的 CSS 变量（应清理或真正用上）：" + dead.join(", "));
    return { used: used.size, declared: declared.size, injected: injected.size, dynamic: dynamic.size, missing: missing.length, dead: dead.length };
  })();

  // ---- 静态一致性：HTML 里的 id / script 与 JS 引用是否对得上 ----
  // 桩件对任何 getElementById 都会返回元素，因此"JS 引用了 HTML 里不存在的 id"
  // 这类低级错误必须在静态层面查（真实浏览器里它会直接抛错）。
  (function staticConsistency() {
    const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
    const htmlIds = new Set();
    let m;
    const reId = /\sid\s*=\s*"([^"]+)"/g;
    while ((m = reId.exec(html))) htmlIds.add(m[1]);

    const jsFiles = ["js/main.js", "js/theme-ui.js", "js/input.js", "js/theme.js", "js/render.js"];
    jsFiles.forEach(function (rel) {
      const code = fs.readFileSync(path.join(ROOT, rel), "utf8");
      const reGet = /getElementById\(\s*"([^"]+)"\s*\)/g;
      let g;
      while ((g = reGet.exec(code))) {
        if (!htmlIds.has(g[1])) fail(rel + " 引用了 index.html 中不存在的 id：" + g[1]);
      }
    });

    // script 顺序必须与测试一致（否则测试就不是在测真实页面）
    const scripts = [];
    const reSrc = /<script\s+src="([^"]+)"><\/script>/g;
    while ((m = reSrc.exec(html))) scripts.push(m[1]);
    scripts.forEach(function (src) {
      if (!fs.existsSync(path.join(ROOT, src))) fail("index.html 引用了不存在的脚本：" + src);
    });
    if (scripts.join(",") !== SCRIPTS.join(",")) {
      fail("index.html 的脚本顺序与冒烟测试的加载顺序不一致：\n     html: " + scripts.join(" → ") +
           "\n     test: " + SCRIPTS.join(" → "));
    }
    note("index.html 脚本顺序与测试一致（" + scripts.length + " 个），id 引用全部存在（共 " + htmlIds.size + " 个 id）");

    // 样式表结构自检：手写 CSS 少一个大括号会让整块皮肤静默失效
    ["css/style.css", "css/themes.css"].forEach(function (rel) {
      const p = path.join(ROOT, rel);
      if (!fs.existsSync(p)) return;
      const css = fs.readFileSync(p, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");   // 去注释
      const counts = {
        "{": (css.match(/\{/g) || []).length, "}": (css.match(/\}/g) || []).length,
        "(": (css.match(/\(/g) || []).length, ")": (css.match(/\)/g) || []).length,
      };
      if (counts["{"] !== counts["}"]) fail(rel + " 花括号不配对：{ " + counts["{"] + " 个，} " + counts["}"] + " 个");
      if (counts["("] !== counts[")"]) fail(rel + " 圆括号不配对：" + counts["("] + " / " + counts[")"]);
      // 属性值里出现未闭合的 var(--x 也会静默失效
      const badVar = css.match(/var\(\s*--[\w-]+\s*[,)]/g) || [];
      const openVar = (css.match(/var\(/g) || []).length;
      if (badVar.length !== openVar) fail(rel + " 存在未闭合的 var()：" + openVar + " 处 var( 中仅 " + badVar.length + " 处闭合");

      // 面板装饰的负偏移：.panel 是 overflow 容器，负偏移的伪元素会产生 2px 可滚动溢出
      // → 开始/暂停/设置/结算面板冒出滚动条（实际发生过，这里防回归）。
      const reRule = /([^{}]+)\{([^{}]*)\}/g;
      let r;
      while ((r = reRule.exec(css))) {
        const sel = r[1].trim();
        if (!/\.panel::(before|after)/.test(sel)) continue;
        const reNeg = /(left|right|top|bottom)\s*:\s*-\s*[\d.]+/g;
        let n;
        while ((n = reNeg.exec(r[2]))) {
          fail(rel + " 中 " + sel + " 使用了负偏移（" + n[0].trim() +
               "）：.panel 是 overflow 容器，这会在面板里产生滚动条");
        }
      }
    });

    // 预览沙盒页：脚本必须存在，且它引用的 id 也得存在
    const pv = fs.readFileSync(path.join(ROOT, "tools/preview.html"), "utf8");
    const pvIds = new Set();
    const rePvId = /\sid\s*=\s*"([^"]+)"/g;
    while ((m = rePvId.exec(pv))) pvIds.add(m[1]);
    const rePvSrc = /<script\s+src="([^"]+)"><\/script>/g;
    while ((m = rePvSrc.exec(pv))) {
      const rel = m[1].replace(/^\.\.\//, "").replace(/^/, "");
      const p = path.join(ROOT, "tools", m[1]);
      if (!fs.existsSync(p)) fail("tools/preview.html 引用了不存在的脚本：" + m[1]);
    }
    ["tools/preview.js", "tools/selfcheck.js"].forEach(function (rel) {
      const code = fs.readFileSync(path.join(ROOT, rel), "utf8");
      const reGet = /getElementById\(\s*"([^"]+)"\s*\)/g;
      let g;
      while ((g = reGet.exec(code))) {
        if (!pvIds.has(g[1])) fail(rel + " 引用了 tools/preview.html 中不存在的 id：" + g[1]);
      }
    });
  })();

  // ---- 绘制开销画像：每个钩子"一帧"要花多少次绘制调用 ----
  // 目的：把"流畅度"变成可比较的数字（主题新增美术时能立刻看出谁在拖后腿）。
  const cost = [];
  (function costProfile() {
    const vp = { cssW: 1280, cssH: 820, dpr: 1, scale: scale, offsetX: offsetX, offsetY: offsetY };
    const scene = Logic.createInitialState();
    Logic.applyIntent(scene, { kind: "build", laneA: 1, laneB: 2, y: 200 });
    for (let i = 0; i < 6; i++) {
      const t = Config.types[i % Config.types.length];
      scene.items.push({
        id: i, type: t, lane: i % Config.laneCount, y: 40 + i * 60, x: Config.laneXs[i % Config.laneCount],
        target: Config.typeTarget[t], onBridge: null, crossDir: 0,
      });
    }
    const G = Render.geometry(vp, 1000);
    const snap = function () { return Object.assign({}, ctx.calls); };
    /** 一段绘制前后的"加权开销"差（权重见 COST：光栅化远贵于路径构造） */
    const costOf = function (before) {
      let sum = 0;
      for (const k in ctx.calls) {
        const d = ctx.calls[k] - (before[k] || 0);
        if (d > 0) sum += d * ctx.__weigh(k);
      }
      return sum;
    };
    ids.forEach(function (id) {
      ThemeUI.setMode(id);
      const HHH = Render.hooks();
      const measure = function (fn, times) {
        const n = times || 1;
        const b = snap();
        for (let k = 0; k < n; k++) fn();
        return Math.round(costOf(b) / n);
      };
      const one = {
        theme: id,
        field: measure(function () { HHH.field(ctx, G); }),
        decor: HHH.decor ? measure(function () { HHH.decor(ctx, G); }) : 0,
        lane: measure(function () { HHH.lane(ctx, 0, G); }),
        bridge: measure(function () { HHH.bridge(ctx, scene.bridges[0], G, false); }),
        warehouse: measure(function () { HHH.warehouse(ctx, 0, G); }),
        item: measure(function () { HHH.item(ctx, scene.items[0], G); }),
        overlay: HHH.overlay ? measure(function () { HHH.overlay(ctx, G); }) : 0,
        screenOverlay: HHH.screenOverlay ? measure(function () { HHH.screenOverlay(ctx, vp, G); }) : 0,
        fx: measure(function () {
          ["build", "flash", "shake", "deliver", "damage"].forEach(function (t, i) {
            HHH.fx(ctx, t, { x1: 10, x2: 70, y: 100, x: 40, ok: i % 2 === 0 }, 0.7, 0.3, G, vp);
          });
        }, 5),
      };
      // 估算"一帧"：场地+装饰+5 通路+仓库+若干桥+场上物品+叠加层
      const items = scene.items.length;
      one.frameEstimate = one.field + one.decor + one.lane * Config.laneCount +
        one.warehouse * Config.laneCount + one.bridge * scene.bridges.length +
        one.item * items + one.overlay + one.screenOverlay + one.fx;
      cost.push(one);
    });
    ThemeUI.setMode("auto");
  })();

  // ---- 自动模式：DIFF → 主题轮换（逻辑信号 → 外观映射） ----
  ThemeUI.setMode("auto");
  const cycle = [];
  for (let d = 1; d <= 7; d++) cycle.push(Theme.resolveName("auto", d));
  const expectedCycle = [ids[0], ids[1], ids[2], ids[0], ids[1], ids[2], ids[0]];
  if (cycle.join(",") !== expectedCycle.join(",")) {
    fail("自动轮换顺序不正确：" + cycle.join(" → ") + "（期望 " + expectedCycle.join(" → ") + "）");
  }
  note("自动轮换顺序：" + cycle.join(" → "));

  // ---- 配色可读性量化核对（用 Gfx.contrast 自查）----
  // 判定口径说明：
  //   · 文字类：WCAG 对比度是硬指标（正文 ≥ 4.5 / 次级 ≥ 3.0）；
  //   · 物品类：物品通常带描边/发光/投影（各主题自行保证轮廓），
  //     因此这里只把"填充色 vs 场地"作为下限体检（≥ 1.45，防同色隐形），
  //     真正的可读性由 tools/selfcheck.js 在真实画布像素上测量（边缘对比 + 存在性）；
  //   · 通路/装饰类：属于弱装饰，用半透明叠加后的实色对比度核对（≥ 1.12）。
  const contrastReport = [];
  ids.forEach(function (id) {
    const def = Theme.definitions[id];
    const p = def.palette;
    const over = function (c) { return Gfx.over(c, p.field); };   // 半透明色压到场地上的实色

    const items = Object.keys(p.itemColors).map(function (k) {
      return { what: "物品 " + k, v: Gfx.contrast(p.itemColors[k], p.field) };
    });
    const itemMin = items.reduce(function (a, b) { return a.v <= b.v ? a : b; });

    // 五类物品两两可区分：色相相隔 ≥30° 或 亮度对比 ≥1.6。
    // 形状是主语义、颜色是辅助线索，但若两条线索都不成立，玩家就得靠数形状去猜。
    const hsl = function (hex) {
      const c = Gfx.parse(hex);
      const r = c.r / 255, g = c.g / 255, b = c.b / 255;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
      let h = 0;
      if (d !== 0) {
        if (mx === r) h = 60 * (((g - b) / d) % 6);
        else if (mx === g) h = 60 * ((b - r) / d + 2);
        else h = 60 * ((r - g) / d + 4);
      }
      return (h + 360) % 360;
    };
    const keys = Object.keys(p.itemColors);
    let worstPair = null;
    for (let a = 0; a < keys.length; a++) {
      for (let b = a + 1; b < keys.length; b++) {
        const ca = p.itemColors[keys[a]], cb = p.itemColors[keys[b]];
        let dh = Math.abs(hsl(ca) - hsl(cb));
        if (dh > 180) dh = 360 - dh;
        const dc = Gfx.contrast(ca, cb);
        const ok = dh >= 30 || dc >= 1.6;
        const sep = Math.max(dh / 30, dc / 1.6);
        if (!worstPair || sep < worstPair.sep) {
          worstPair = { sep: sep, pair: keys[a] + "/" + keys[b], dh: dh, dc: dc, ok: ok };
        }
        if (!ok) {
          fail("主题 " + def.label + " 的物品 " + keys[a] + " 与 " + keys[b] +
               " 难以区分：色相差 " + dh.toFixed(0) + "°、亮度对比 " + dc.toFixed(2) +
               "（要求色相 ≥30° 或 亮度 ≥1.6）");
        }
      }
    }
    const textRow = { what: "HUD 文字", v: Gfx.contrast(p.text, p.panel) };
    const midRow = { what: "面板次级文字", v: Gfx.contrast(p.textMid, p.panel) };
    const laneRow = { what: "通路边缘线 vs 场地", v: Gfx.contrast(over(p.laneEdge), p.field) };
    const bridgeRow = { what: "桥 vs 场地", v: Gfx.contrast(p.bridgeBody, p.field) };

    contrastReport.push({ id: id, label: def.label, itemMin: itemMin, textRow: textRow, midRow: midRow, laneRow: laneRow, bridgeRow: bridgeRow, worstPair: worstPair });

    if (itemMin.v < 1.45) {
      fail("主题 " + def.label + " 物品填充色与场地过于接近：" + itemMin.what + " 对比度 " + itemMin.v.toFixed(2) + "（要求 ≥ 1.45）");
    }
    if (textRow.v < 4.5) {
      fail("主题 " + def.label + " HUD 文字对比度不足：" + textRow.v.toFixed(2) + "（要求 ≥ 4.5）");
    }
    if (midRow.v < 3.0) {
      fail("主题 " + def.label + " 面板次级文字对比度不足：" + midRow.v.toFixed(2) + "（要求 ≥ 3.0）");
    }
    if (laneRow.v < 1.12) {
      fail("主题 " + def.label + " 通路边缘线几乎不可见：" + laneRow.v.toFixed(2) + "（要求 ≥ 1.12）");
    }
    if (bridgeRow.v < 1.12) {
      fail("主题 " + def.label + " 桥与场地几乎同色：" + bridgeRow.v.toFixed(2) + "（要求 ≥ 1.12）");
    }
  });

  // ---- 画面自检脚本的自检（tools/selfcheck.js 本身能否跑通并给出结论）----
  // 说明：selfcheck.js 需要在浏览器里回读像素才能工作，本测试无法替代它；
  //       但至少要在 Node 里证明它"跑得通、并且真的会报警"：
  //       喂它一张"什么都没画"的空白画布，它必须给出 pass=false 与失败项。
  (function selfCheckHarness() {
    const W = 320, H = 480;
    const page = Theme.definitions[ids[0]].palette.page;
    const c = Gfx.parse(page);
    const data = new Uint8ClampedArray(W * H * 4);
    for (let i = 0; i < W * H; i++) {
      data[i * 4] = c.r; data[i * 4 + 1] = c.g; data[i * 4 + 2] = c.b; data[i * 4 + 3] = 255;
    }
    const canvas = dom.registry["game-canvas"];
    canvas.width = W; canvas.height = H;
    ctx.getImageData = function () { return { data: data, width: W, height: H }; };

    const st = Logic.createInitialState();
    Logic.applyIntent(st, { kind: "build", laneA: 0, laneB: 1, y: 100 });
    st.items.push({ id: 0, type: "A", lane: 0, y: 50, x: Config.laneXs[0], target: 0, onBridge: null, crossDir: 0 });

    const pre = dom.document.createElement("pre");
    pre.id = "selfcheck";
    const fakeWindow = {
      __preview: {
        vp: { cssW: W, cssH: H, dpr: 1, scale: 1, offsetX: 30, offsetY: 15 },
        state: st, scene: "play", hover: null, theme: ids[0],
      },
      setTimeout: function (fn) { fn(); return 0; },   // 立即执行，别等 700ms
    };
    const sandbox2 = {
      window: fakeWindow,
      document: {
        getElementById: function (id) { return id === "game-canvas" ? canvas : (id === "selfcheck" ? pre : null); },
        createElement: function () { return pre; },
        body: { appendChild: function () {} },
      },
      Theme: Theme, Config: Config, Gfx: Gfx,
      JSON: JSON, Set: Set, Math: Math, Array: Array, Object: Object, Number: Number, String: String,
    };
    sandbox2.globalThis = sandbox2;
    let ok = true, detail = "";
    try {
      vm.runInContext(fs.readFileSync(path.join(ROOT, "tools/selfcheck.js"), "utf8"),
        vm.createContext(sandbox2), { filename: "tools/selfcheck.js" });
      const out = JSON.parse(pre.textContent);
      if (!out || typeof out !== "object") { ok = false; detail = "没有产出可解析的 JSON"; }
      else if (out.pass !== false) { ok = false; detail = "空白画布竟然被判为通过（阈值失效）"; }
      else if (!Array.isArray(out.failures) || out.failures.length === 0) { ok = false; detail = "空白画布没有报出任何失败项"; }
      else detail = "空白画布报出 " + out.failures.length + " 项失败（例如：" + out.failures[0] + "）";
    } catch (e) {
      ok = false; detail = "执行抛错：" + (e && e.message);
    }
    if (!ok) fail("tools/selfcheck.js 自检未通过：" + detail);
    else note("tools/selfcheck.js 可用：" + detail);
    // 恢复真实的桩件尺寸
    canvas.width = 1280; canvas.height = 820;
  })();

  // ---- 结果输出 ----
  console.log("=========== 无头冒烟测试 ===========");
  console.log("脚本加载：" + SCRIPTS.length + " 个文件（顺序与 index.html 一致）");
  console.log("主循环：真实执行 " + (8 + 120 + 1200 + 40 * themeIds.length) + " 帧，累计 Canvas 调用 " + ctx.ops + " 次");
  console.log("\n-- 逐主题渲染 --");
  perTheme.forEach(function (t) {
    console.log(
      "  " + String(t.mode).padEnd(6) + "→ 实际主题 " + String(t.applied).padEnd(6) +
      " 40 帧调用 " + String(t.ops).padStart(6) + " 次，用到 " +
      String(t.colors).padStart(4) + " 种颜色，" + t.callKinds + " 类绘制指令"
    );
  });
  console.log("\n-- 重开流程（Game Over → 再来一局）--");
  restart.forEach(function (r) {
    console.log("  跑 " + r.framesToOver + " 帧进入 Game Over；生命图标：" +
      "开局 " + r.atStart + " → Game Over " + r.atOver +
      " → 重开后 " + r.afterRestart + " → 再掉一条命 " + r.afterOneHit);
  });

  console.log("\n-- 配色对比度（WCAG 比值，越大越清晰）--");
  contrastReport.forEach(function (c) {
    console.log("  " + c.label +
      "：物品最低 " + c.itemMin.v.toFixed(2) + "（" + c.itemMin.what + "）" +
      "，HUD 文字 " + c.textRow.v.toFixed(2) +
      "，次级文字 " + c.midRow.v.toFixed(2) +
      "，通路边缘 " + c.laneRow.v.toFixed(2) +
      "，桥 " + c.bridgeRow.v.toFixed(2) +
      "，最接近的一对物品 " + c.worstPair.pair + "（色相 " + c.worstPair.dh.toFixed(0) +
      "° / 亮度 " + c.worstPair.dc.toFixed(2) + "）");
  });
  console.log("\n-- 几何落点核对（记录每次 fill/stroke 的屏幕包围盒后核对位置）--");
  layout.forEach(function (l) {
    console.log("  " + Theme.definitions[l.theme].label +
      "：场地 " + (l.field ? "✓" : "✗") +
      "，通路 " + l.lanes + "/" + Config.laneCount +
      "，桥 " + l.bridges + "/3" +
      "，物品 " + l.items + "/5" +
      "，仓库 " + l.warehouses + "/" + Config.laneCount + "（含图标 " + l.warehouseIcons + "/" + Config.laneCount + "）" +
      "，建桥预览 " + (l.ghost ? "✓" : "✗") +
      "（本次绘制 " + l.shapes + " 个形状）");
  });
  console.log("\n-- 每题绘制开销画像（加权：一次光栅化 ≈ 10~12，一次路径构造 ≈ 1）--");
  console.log("  主题      场地  装饰 通路×5 仓库×5  桥 物品×6 叠加层  特效 → 估算一帧");
  cost.forEach(function (c) {
    console.log("  " + Theme.definitions[c.theme].label.padEnd(6) +
      String(c.field).padStart(7) + String(c.decor).padStart(6) +
      String(c.lane * Config.laneCount).padStart(8) + String(c.warehouse * Config.laneCount).padStart(8) +
      String(c.bridge).padStart(5) + String(c.item * 6).padStart(8) +
      String(c.overlay + c.screenOverlay).padStart(8) + String(c.fx).padStart(6) +
      " → " + String(c.frameEstimate).padStart(8));
  });

  console.log("\n-- CSS 变量闭环 --");
  console.log("  样式表使用 " + cssAudit.used + " 个变量；声明于 :root " + cssAudit.declared +
    " 个、主题注入 " + cssAudit.injected + " 个、JS 动态写入 " + cssAudit.dynamic +
    " 个；无来源 " + cssAudit.missing + " 个，注入但未使用 " + cssAudit.dead + " 个");

  console.log("\n-- 核心规则回归（" + rules.filter(function (r) { return r.ok; }).length + "/" + rules.length + " 通过）--");
  rules.forEach(function (r) {
    console.log("  " + (r.ok ? "✓" : "✗") + " " + r.name + (r.ok ? "" : "  ← " + r.detail));
  });
  if (notes.length) {
    console.log("\n-- 备注 --");
    notes.forEach(function (n) { console.log("  · " + n); });
  }

  return report();
}

function report() {
  if (problems.length) {
    console.log("\n-- 失败项（" + problems.length + "）--");
    problems.forEach(function (p, i) { console.log("  " + (i + 1) + ". " + p); });
    console.log("\n结果：失败");
    process.exitCode = 1;
  } else {
    console.log("\n结果：全部通过 ✓");
    process.exitCode = 0;
  }
  return problems.length;
}

main();
