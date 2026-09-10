"use strict";

/**
 * ============================================================
 * gfx.js —— 通用绘制工具箱（完全主题无关）
 *   - 只提供颜色计算 / 数学 / 路径 / 画笔工具；
 *   - 不含任何主题配色、不含任何游戏规则、不依赖 DOM；
 *   - 主题模块（js/themes/*.js）与渲染管线（js/render.js）共用本工具箱，
 *     从而保证"几何与语义一致、外观各自表达"。
 * ============================================================
 */

const Gfx = {};

/* ============================================================
 * 一、颜色工具
 * ============================================================ */

/** 解析 #rgb / #rgba / #rrggbb / #rrggbbaa / rgb() / rgba() → { r, g, b, a } */
Gfx.parse = function (c) {
  if (typeof c !== "string") return { r: 0, g: 0, b: 0, a: 1 };
  const s = c.trim();
  if (s.charAt(0) === "#") {
    let h = s.slice(1);
    if (h.length === 3 || h.length === 4) {
      h = h.split("").map(function (ch) { return ch + ch; }).join("");
    }
    const n = parseInt(h.slice(0, 6), 16);
    const a = h.length >= 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: a };
  }
  const m = s.match(/rgba?\(([^)]+)\)/i);
  if (m) {
    const p = m[1].split(/[,\s]+/).filter(Boolean).map(parseFloat);
    return { r: p[0] | 0, g: p[1] | 0, b: p[2] | 0, a: p.length > 3 ? p[3] : 1 };
  }
  return { r: 0, g: 0, b: 0, a: 1 };
};

/** 颜色 + 透明度 → "rgba(...)"（透明度过大或过小时自动裁剪） */
Gfx.rgba = function (c, a) {
  const p = Gfx.parse(c);
  const al = (a === undefined || a === null) ? p.a : Gfx.clamp(a, 0, 1);
  return "rgba(" + p.r + "," + p.g + "," + p.b + "," + Math.round(al * 1000) / 1000 + ")";
};

/** 线性插值混色，t=0 取 a，t=1 取 b */
Gfx.mix = function (a, b, t) {
  const x = Gfx.parse(a), y = Gfx.parse(b);
  const k = Gfx.clamp(t, 0, 1);
  const f = function (i) { return Math.round(x[i] + (y[i] - x[i]) * k); };
  return "rgb(" + f("r") + "," + f("g") + "," + f("b") + ")";
};

/** 明暗调整：amt > 0 向白提亮，amt < 0 向黑压暗（范围 -1 ~ 1） */
Gfx.shade = function (c, amt) {
  const p = Gfx.parse(c);
  const k = Gfx.clamp(amt, -1, 1);
  const f = function (v) {
    return Math.round(k >= 0 ? v + (255 - v) * k : v * (1 + k));
  };
  return "rgb(" + f(p.r) + "," + f(p.g) + "," + f(p.b) + ")";
};

/** alpha 合成：把半透明前景色压在背景色上，返回实色（用于对半透明色做对比度核算） */
Gfx.over = function (fg, bg) {
  const a = Gfx.parse(fg), b = Gfx.parse(bg);
  const k = Gfx.clamp(a.a, 0, 1);
  const f = function (x, y) { return Math.round(x * k + y * (1 - k)); };
  return "rgb(" + f(a.r, b.r) + "," + f(a.g, b.g) + "," + f(a.b, b.b) + ")";
};

/** 相对亮度（WCAG） */
Gfx.lum = function (c) {
  const p = Gfx.parse(c);
  const ch = [p.r, p.g, p.b].map(function (v) {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
};

/** 对比度（WCAG，1 ~ 21）。用于自检主题可读性，不参与运行时绘制决策。 */
Gfx.contrast = function (a, b) {
  const l1 = Gfx.lum(a), l2 = Gfx.lum(b);
  const hi = Math.max(l1, l2), lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
};

/** 依据背景明暗选择深/浅前景色（用于自动保证文字与图形可读） */
Gfx.readableOn = function (bg, dark, light) {
  return Gfx.lum(bg) > 0.45 ? (dark || "#111111") : (light || "#ffffff");
};

/* ============================================================
 * 二、数学与确定性伪随机
 * ============================================================ */

Gfx.clamp = function (v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); };
Gfx.lerp = function (a, b, t) { return a + (b - a) * t; };
Gfx.easeOut = function (t) { return 1 - Math.pow(1 - t, 3); };
Gfx.easeInOut = function (t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
/** 回弹缓动（黏土/糖果主题的挤压回弹） */
Gfx.easeBack = function (t, k) {
  const c = (k === undefined ? 1.7 : k);
  const p = t - 1;
  return 1 + (c + 1) * p * p * p + c * p * p;
};

/** 确定性哈希 → [0, 1)，同一输入永远同一结果（保证装饰纹理逐帧稳定） */
Gfx.hash = function (n) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};
Gfx.hash2 = function (x, y) {
  const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return s - Math.floor(s);
};
/** 确定性哈希 → [-1, 1) */
Gfx.hashS = function (n) { return Gfx.hash(n) * 2 - 1; };

/* ============================================================
 * 三、路径构建
 * ============================================================ */

/** 圆角矩形路径（不填充、不描边，由调用方决定） */
Gfx.roundRect = function (ctx, x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, Math.min(w, h) / 2));
  ctx.beginPath();
  if (rr <= 0) { ctx.rect(x, y, w, h); return ctx; }
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.arcTo(x + w, y, x + w, y + rr, rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
  ctx.lineTo(x + rr, y + h);
  ctx.arcTo(x, y + h, x, y + h - rr, rr);
  ctx.lineTo(x, y + rr);
  ctx.arcTo(x, y, x + rr, y, rr);
  ctx.closePath();
  return ctx;
};

/** 多边形路径 */
Gfx.poly = function (ctx, pts) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
  return ctx;
};

/**
 * 物品形状语义（全主题共用，保证玩法可读性一致）：
 *   A = 方形、B = 三角、C = 圆、D = 五角星、E = 菱形
 * 返回以原点为中心、外接半径 r 的多边形顶点；C（圆）返回 null。
 */
Gfx.glyphPoints = function (type, r, sides) {
  const T = String(type || "A").toUpperCase();
  if (T === "A") {
    const s = r * 0.86;
    return [[-s, -s], [s, -s], [s, s], [-s, s]];
  }
  if (T === "B") {
    const h = r * 1.1;
    return [[0, -h], [r * 0.95, h * 0.72], [-r * 0.95, h * 0.72]];
  }
  if (T === "D") {
    const pts = [];
    const n = 5;
    const inner = r * 0.46;
    for (let i = 0; i < n * 2; i++) {
      const rad = (i % 2 === 0) ? r * 1.05 : inner;
      const a = -Math.PI / 2 + (i * Math.PI) / n;
      pts.push([Math.cos(a) * rad, Math.sin(a) * rad]);
    }
    return pts;
  }
  if (T === "E") {
    const s = r * 1.02;
    return [[0, -s], [s, 0], [0, s], [-s, 0]];
  }
  return null;   // C：圆形，走 arcPath
};

/** 圆形路径（物品形状 C） */
Gfx.circlePath = function (ctx, r, cx, cy) {
  ctx.beginPath();
  ctx.arc(cx || 0, cy || 0, r, 0, Math.PI * 2);
  return ctx;
};

/** 统一的物品形状路径：以 (cx, cy) 为中心、外接半径 r、可整体旋转 rot */
Gfx.glyphPath = function (ctx, type, r, cx, cy, rot) {
  const x = cx || 0, y = cy || 0;
  ctx.save();
  ctx.translate(x, y);
  if (rot) ctx.rotate(rot);
  const pts = Gfx.glyphPoints(type, r);
  if (pts) Gfx.poly(ctx, pts);
  else Gfx.circlePath(ctx, r);
  ctx.restore();
  return ctx;
};

/**
 * 手绘抖动：对顶点做确定性扰动（同一 seed 结果稳定，不逐帧闪烁）。
 * 用于水墨/黏土等"手工感"边缘。
 */
Gfx.wobble = function (pts, amp, seed) {
  return pts.map(function (p, i) {
    const n1 = Gfx.hashS((seed || 0) * 31.7 + i * 7.3);
    const n2 = Gfx.hashS((seed || 0) * 17.3 + i * 11.9);
    return [p[0] + n1 * amp, p[1] + n2 * amp];
  });
};

/** 两点之间的手绘曲线（贝塞尔，控制点做确定性偏移） */
Gfx.sketchLine = function (ctx, x1, y1, x2, y2, amp, seed) {
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.max(1, Math.hypot(dx, dy));
  const nx = -dy / len, ny = dx / len;
  const a = amp * Gfx.hashS(seed || 1);
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.quadraticCurveTo(mx + nx * a, my + ny * a, x2, y2);
  return ctx;
};

/* ============================================================
 * 四、画笔工具（发光 / 光斑 / 喷溅 / 渐变缓存）
 * ============================================================ */

/** 在 glow 回调内绘制时附加外发光（美术表现，不影响几何） */
Gfx.glow = function (ctx, color, blur, fn) {
  ctx.save();
  ctx.shadowColor = typeof color === "string" ? color : Gfx.rgba(color, 0.9);
  ctx.shadowBlur = blur;
  fn(ctx);
  ctx.restore();
};

/** 柔和径向光斑（霓虹辉光 / 黏土高光 / 纸面晕染通用） */
Gfx.softBlob = function (ctx, x, y, r, color, alpha, inner) {
  if (r <= 0) return;
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  const a0 = alpha === undefined ? 1 : alpha;
  const core = inner === undefined ? 0 : inner;
  g.addColorStop(0, Gfx.rgba(color, a0));
  g.addColorStop(Math.max(0.001, core), Gfx.rgba(color, a0 * 0.72));
  g.addColorStop(1, Gfx.rgba(color, 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
};

/** 喷溅墨点（确定性；用于水墨/糖果点缀） */
Gfx.splatter = function (ctx, x, y, r, color, seed, count) {
  const n = count || 7;
  ctx.fillStyle = color;
  for (let i = 0; i < n; i++) {
    const a = Gfx.hash((seed || 0) + i * 3.1) * Math.PI * 2;
    const d = r * (0.3 + Gfx.hash((seed || 0) + i * 5.7) * 1.0);
    const s = Math.max(0.6, r * 0.16 * (0.4 + Gfx.hash((seed || 0) + i * 9.3)));
    ctx.beginPath();
    ctx.arc(x + Math.cos(a) * d, y + Math.sin(a) * d, s, 0, Math.PI * 2);
    ctx.fill();
  }
};

/** 竖直笔触（水墨竖线 / 糖果棒）：两侧略细的带状路径 */
Gfx.taperedBand = function (ctx, x, y0, y1, half, taper) {
  const k = taper === undefined ? 0.35 : taper;
  const h0 = half * (1 - k * 0.15), h1 = half;
  ctx.beginPath();
  ctx.moveTo(x - h0, y0);
  ctx.quadraticCurveTo(x - h1 * 1.06, (y0 + y1) / 2, x - h0, y1);
  ctx.lineTo(x + h0, y1);
  ctx.quadraticCurveTo(x + h1 * 1.06, (y0 + y1) / 2, x + h0, y0);
  ctx.closePath();
  return ctx;
};

/**
 * 批量同色矩形：把 N 次 fillRect 合成"一条路径 + 一次 fill"。
 * 用于纸纹颗粒、扫描线、刻度线这类"同色、互不重叠的小矩形阵列"：
 * 像素结果与逐个 fillRect 完全一致，但把 N 次光栅化压成 1 次
 * （中低端设备上这类装饰往往是最大的开销来源）。
 *
 * 用法：Gfx.batchRects(ctx, "rgba(0,0,0,0.06)", function (r) {
 *         for (let y = 0; y < h; y += 4) r(0, y, w, 1);
 *       });
 */
Gfx.batchRects = function (ctx, color, emit) {
  ctx.beginPath();
  emit(function (x, y, w, h) { ctx.rect(x, y, w, h); });
  ctx.fillStyle = color;
  ctx.fill();
};

/** 批量同色线段：把 N 次 moveTo/lineTo 合成一条路径后一次 stroke */
Gfx.batchLines = function (ctx, color, width, emit) {
  ctx.beginPath();
  emit(function (x1, y1, x2, y2) { ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); });
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
};

/** 线性渐变（带缓存：同一 canvas + key 复用，避免逐帧创建对象） */Gfx.linearGradient = function (ctx, key, x0, y0, x1, y1, stops) {
  const cache = Gfx._gradCache || (Gfx._gradCache = new Map());
  const hit = cache.get(key);
  if (hit && hit.ctx === ctx) return hit.g;
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  for (let i = 0; i < stops.length; i++) g.addColorStop(stops[i][0], stops[i][1]);
  if (cache.size > 64) cache.clear();
  cache.set(key, { ctx: ctx, g: g });
  return g;
};

/** 径向渐变（带缓存） */
Gfx.radialGradient = function (ctx, key, x, y, r0, r1, stops) {
  const cache = Gfx._radCache || (Gfx._radCache = new Map());
  const hit = cache.get(key);
  if (hit && hit.ctx === ctx) return hit.g;
  const g = ctx.createRadialGradient(x, y, r0, x, y, r1);
  for (let i = 0; i < stops.length; i++) g.addColorStop(stops[i][0], stops[i][1]);
  if (cache.size > 64) cache.clear();
  cache.set(key, { ctx: ctx, g: g });
  return g;
};
