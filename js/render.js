"use strict";

/**
 * ============================================================
 * render.js —— 渲染管线（主题无关）
 *
 * 职责边界（严格）：
 *   1) 维护"世界坐标 → 屏幕坐标"变换（§14）；
 *   2) 按固定顺序调用主题钩子，并把几何与主题资源打包成 G 传给钩子；
 *   3) 提供一套"中性兜底"绘制（只用 Theme 的语义 token，不写死任何主题配色）；
 *   4) 管理纯视觉特效队列（生命周期与游戏规则无关）。
 *
 * 本文件不含任何游戏规则、不含任何主题专属配色，
 * 新增主题无需修改本文件。
 *
 * ---- 主题钩子契约（全部可选，缺省走 Render.defaultHooks）----
 *   field(ctx, G)                  场地底板（必须铺满 0,0,G.w,G.h）
 *   decor(ctx, G)                  场地装饰（在通路之下，可动画）
 *   lane(ctx, i, G)                第 i 条通路（x = G.laneX(i)，纵向 0..G.h）
 *   bridge(ctx, b, G, hovered)     单座桥（b = { id, lanes:[a,b], y }）
 *   ghost(ctx, c, G)               建桥预览（c = { laneA, laneB, y, legal }）
 *   warehouse(ctx, i, G)           第 i 座仓库（y 从 G.h 开始）
 *   item(ctx, item, G)             单个物品（item = { type, lane, x, y, ... }）
 *   overlay(ctx, G)                世界空间最上层（暗角 / 扫描线 / 纸纹…）
 *   fx(ctx, type, fx, a, G)        特效：build|flash|shake|deliver|damage
 *   laneLabel(ctx, i, screenX, G)  屏幕空间通路标签 L1..L5
 *   screenOverlay(ctx, vp, G)      屏幕空间最上层（颗粒 / 光晕…）
 * ============================================================
 */

const Render = {};

/* ---- 像素特效队列（仅视觉反馈，短促，不影响游戏节奏）---- */
Render.effects = [];

Render.addEffect = function (fx) {
  fx.t0 = performance.now();
  Render.effects.push(fx);
};

Render.clearEffects = function () { Render.effects.length = 0; };

/**
 * 组装几何 + 主题资源，作为钩子的统一上下文 G。
 * 钩子只能通过 G 与 Theme.get() 获取视觉参数，不得读取 state 之外的逻辑量。
 */
Render.geometry = function (vp, now) {
  const def = Theme.get();
  const lanes = Config.laneXs;
  return {
    w: Config.worldWidth,
    h: Config.laneLength,
    lanes: lanes,
    laneCount: Config.laneCount,
    bridgeWidth: Config.bridgeWidth,
    laneHalf: def.metrics.laneHalf,
    m: def.metrics,
    p: def.palette,
    font: def.font,
    anim: def.anim,
    dark: def.mode !== "light",
    t: now / 1000,
    laneX: function (i) { return lanes[i]; },
    bridgeTop: function (b) { return b.y - Config.bridgeWidth / 2; },
    bridgeBottom: function (b) { return b.y + Config.bridgeWidth / 2; },
  };
};

/**
 * 解析当前生效的钩子表（主题钩子覆盖兜底钩子）。
 * 按主题 id 缓存，避免逐帧创建对象。
 */
Render._hookCache = { id: null, hooks: null };
Render.hooks = function () {
  const def = Theme.get();
  if (!def) return Render.defaultHooks;
  if (Render._hookCache.id !== def.id) {
    Render._hookCache = {
      id: def.id,
      hooks: Object.assign({}, Render.defaultHooks, def.hooks || {}),
    };
  }
  return Render._hookCache.hooks;
};

/* ============================================================
 * 主绘制流程
 * ============================================================ */

Render.draw = function (state, ctx, vp, hover, now) {
  const G = Render.geometry(vp, now);
  const H = Render.hooks();
  const P = G.p;

  // ---- 屏幕空间：清屏（画布外区域）----
  ctx.setTransform(vp.dpr, 0, 0, vp.dpr, 0, 0);
  ctx.fillStyle = P.page;
  ctx.fillRect(0, 0, vp.cssW, vp.cssH);

  // ---- 世界空间 ----
  ctx.setTransform(vp.dpr * vp.scale, 0, 0, vp.dpr * vp.scale,
                   vp.dpr * vp.offsetX, vp.dpr * vp.offsetY);

  H.field(ctx, G);
  if (H.decor) H.decor(ctx, G);

  for (let i = 0; i < G.laneCount; i++) H.lane(ctx, i, G);

  for (let i = 0; i < state.bridges.length; i++) {
    const b = state.bridges[i];
    H.bridge(ctx, b, G, !!(hover && hover.bridgeId === b.id));
  }

  if (hover && !hover.bridgeId && hover.candidate) H.ghost(ctx, hover.candidate, G);

  for (let i = 0; i < G.laneCount; i++) H.warehouse(ctx, i, G);

  for (let i = 0; i < state.items.length; i++) H.item(ctx, state.items[i], G);

  Render.drawEffects(ctx, G, H, now);

  if (H.overlay) H.overlay(ctx, G);

  // ---- 屏幕空间：通路标签 + 屏幕级特效 ----
  ctx.setTransform(vp.dpr, 0, 0, vp.dpr, 0, 0);
  for (let i = 0; i < G.laneCount; i++) {
    const sx = vp.offsetX + G.laneX(i) * vp.scale;
    (H.laneLabel || Render.defaultHooks.laneLabel)(ctx, i, sx, vp.offsetY - 12, G);
  }
  Render.drawScreenEffects(ctx, vp, G, H, now);
  if (H.screenOverlay) H.screenOverlay(ctx, vp, G);
};

/* ============================================================
 * 特效通道
 * ============================================================ */

/** 世界空间特效（建桥 / 拆桥 / 禁拆抖动 / 投递反馈） */
Render.drawEffects = function (ctx, G, H, now) {
  for (let i = Render.effects.length - 1; i >= 0; i--) {
    const fx = Render.effects[i];
    if (fx.type === "damage") continue;          // 掉血走屏幕空间通道
    const age = (now - fx.t0) / 1000;
    if (age > fx.dur) { Render.effects.splice(i, 1); continue; }
    H.fx(ctx, fx.type, fx, 1 - age / fx.dur, age / fx.dur, G);
  }
};

/** 屏幕空间特效（掉血全屏反馈） */
Render.drawScreenEffects = function (ctx, vp, G, H, now) {
  for (let i = Render.effects.length - 1; i >= 0; i--) {
    const fx = Render.effects[i];
    if (fx.type !== "damage") continue;
    const age = (now - fx.t0) / 1000;
    if (age > fx.dur) { Render.effects.splice(i, 1); continue; }
    H.fx(ctx, "damage", fx, 1 - age / fx.dur, age / fx.dur, G, vp);
  }
};

/* ============================================================
 * 兜底绘制（只用语义 token，任何主题缺钩子时仍然协调可读）
 * ============================================================ */

/** 以 (x,y) 为中心绘制物品形状（几何语义全主题一致：方/三角/圆/星/菱） */
Render.glyph = function (ctx, type, r, x, y, rot) {
  Gfx.glyphPath(ctx, type, r, x, y, rot);
};

/** 默认物品绘制：形状 + 该类型专属色 */
Render.drawItemShape = function (ctx, type, r, x, y, color, outline) {
  Render.glyph(ctx, type, r, x, y, 0);
  ctx.fillStyle = color;
  ctx.fill();
  if (outline) {
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = outline;
    ctx.stroke();
  }
};

Render.defaultHooks = {
  /** 场地底板：底色 + 极淡点阵 + 边框 */
  field: function (ctx, G) {
    const P = G.p;
    ctx.fillStyle = Gfx.linearGradient(ctx, "field:" + Theme.current, 0, 0, 0, G.h,
      [[0, P.field], [1, P.fieldAlt]]);
    ctx.fillRect(0, 0, G.w, G.h);
    ctx.fillStyle = P.grid;
    for (let gx = 8; gx < G.w; gx += 16) {
      for (let gy = 8; gy < G.h; gy += 16) ctx.fillRect(gx, gy, 2, 2);
    }
    ctx.strokeStyle = P.gridStroke;
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, G.w - 1, G.h - 1);
  },

  /** 通路：明暗交替条纹 + 两侧边缘线 */
  lane: function (ctx, i, G) {
    const P = G.p;
    const x = G.laneX(i);
    const half = G.m.laneHalf;
    const seg = G.m.laneSegment;
    for (let y = 0; y < G.h; y += seg * 2) {
      ctx.fillStyle = P.laneA;
      ctx.fillRect(x - half, y, half * 2, seg);
      ctx.fillStyle = P.laneB;
      ctx.fillRect(x - half, y + seg, half * 2, Math.min(seg, G.h - (y + seg)));
    }
    ctx.fillStyle = P.laneEdge;
    ctx.fillRect(x - half, 0, 1, G.h);
    ctx.fillRect(x + half - 1, 0, 1, G.h);
  },

  /** 桥：桥体 + 顶/底明暗线 + 两端立柱 + 悬停四角高亮 */
  bridge: function (ctx, b, G, hovered) {
    const P = G.p;
    const x1 = G.laneX(b.lanes[0]);
    const x2 = G.laneX(b.lanes[1]);
    const top = G.bridgeTop(b);
    const w = G.bridgeWidth;
    ctx.fillStyle = hovered ? Gfx.shade(P.bridgeBody, 0.12) : P.bridgeBody;
    ctx.fillRect(x1, top, x2 - x1, w);
    ctx.fillStyle = hovered ? P.bridgeEdge : P.bridgeTop;
    ctx.fillRect(x1, top, x2 - x1, 2);
    ctx.fillStyle = P.bridgeBottom;
    ctx.fillRect(x1, top + w - 2, x2 - x1, 2);
    ctx.fillStyle = P.bridgeTop;
    ctx.fillRect(x1, top, 3, w);
    ctx.fillRect(x2 - 3, top, 3, w);
    if (hovered) {
      ctx.fillStyle = P.bridgeEdge;
      ctx.fillRect(x1, top, 2, 2);
      ctx.fillRect(x2 - 2, top, 2, 2);
      ctx.fillRect(x1, top + w - 2, 2, 2);
      ctx.fillRect(x2 - 2, top + w - 2, 2, 2);
    }
  },

  /** 建桥预览：合法 → 主题"可建"色；非法 → 主题"不可建"色 */
  ghost: function (ctx, c, G) {
    const P = G.p;
    const x1 = G.laneX(c.laneA);
    const x2 = G.laneX(c.laneB);
    const top = c.y - G.bridgeWidth / 2;
    if (top < 0 || top + G.bridgeWidth > G.h) return;
    ctx.fillStyle = c.legal ? Gfx.rgba(P.fx.ghostOk, 0.3) : Gfx.rgba(P.fx.ghostBad, 0.18);
    ctx.fillRect(x1, top, x2 - x1, G.bridgeWidth);
    ctx.fillStyle = c.legal ? Gfx.rgba(P.fx.ghostOkLine, 0.55) : Gfx.rgba(P.fx.ghostBadLine, 0.34);
    ctx.fillRect(x1, top, x2 - x1, 2);
    ctx.fillRect(x1, top + G.bridgeWidth - 2, x2 - x1, 2);
  },

  /** 仓库：外框 + 目标物品形状（商店/仓库语义与物品一一对应） */
  warehouse: function (ctx, i, G) {
    const P = G.p;
    const m = G.m;
    const x = G.laneX(i);
    const w = m.warehouseWidth, h = m.warehouseHeight;
    const y0 = G.h;
    Gfx.roundRect(ctx, x - w / 2, y0, w, h, Math.min(4, h / 3));
    ctx.fillStyle = P.warehouseFill;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = P.warehouseFrame;
    ctx.stroke();
    Render.drawItemShape(ctx, Config.laneWarehouse[i], m.warehouseIconRadius,
                         x, y0 + h / 2, P.itemColors[Config.laneWarehouse[i]], null);
  },

  /** 物品：形状 + 类型色（不标注字母，靠形状 + 颜色区分） */
  item: function (ctx, item, G) {
    Render.drawItemShape(ctx, item.type, G.m.itemRadius, item.x, item.y,
                         G.p.itemColors[item.type] || G.p.text, null);
  },

  /** 特效兜底：只用语义 token 的低调反馈 */
  fx: function (ctx, type, fx, a, prog, G) {
    const P = G.p;
    if (type === "build") {
      const w = G.bridgeWidth;
      const h = Math.min(w, (prog / 0.6) * w);
      ctx.fillStyle = Gfx.rgba(P.fx.build, a * 0.9);
      ctx.fillRect(fx.x1, fx.y - h / 2, fx.x2 - fx.x1, h);
    } else if (type === "flash") {
      ctx.fillStyle = Gfx.rgba(P.fx.flash, a * 0.85);
      ctx.fillRect(fx.x1, fx.y - G.bridgeWidth / 2, fx.x2 - fx.x1, G.bridgeWidth);
    } else if (type === "shake") {
      const dx = Math.sin(prog * 40) * 3 * a;
      ctx.fillStyle = Gfx.rgba(P.fx.shake, a * 0.5);
      ctx.fillRect(fx.x1 + dx, fx.y - G.bridgeWidth / 2, fx.x2 - fx.x1, G.bridgeWidth);
    } else if (type === "deliver") {
      const y = fx.y - prog * 26;
      if (fx.ok) {
        ctx.fillStyle = Gfx.rgba(P.fx.plusText, Math.min(1, a * 2));
        ctx.font = G.font.canvas;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("+1", fx.x, y);
        ctx.fillStyle = Gfx.rgba(P.fx.plusParticle, a);
        const pts = [[-14, -6], [12, -10], [0, -18]];
        for (let k = 0; k < pts.length; k++) ctx.fillRect(fx.x + pts[k][0], y + pts[k][1], 3, 3);
      } else {
        const dx = Math.sin(prog * 40) * 3 * a;
        ctx.fillStyle = Gfx.rgba(P.fx.wrong, a * 0.45);
        ctx.fillRect(fx.x - 20 + dx, fx.y, 40, 16);
      }
    }
  },

  /** 通路标签 L1..L5（屏幕空间，跟随主题字体与颜色） */
  laneLabel: function (ctx, i, sx, sy, G) {
    ctx.font = G.font.canvas;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = G.p.textDim;
    ctx.fillText("L" + (i + 1), sx, sy);
  },
};

/* ---- 兜底 fx 的 damage 分支（需要 vp，单独挂载以保持签名清晰）---- */
Render.defaultHooks.fx = (function (base) {
  return function (ctx, type, fx, a, prog, G, vp) {
    if (type === "damage") {
      const P = G.p;
      ctx.fillStyle = Gfx.rgba(P.fx.damageOverlay, a * 0.26);
      ctx.fillRect(0, 0, vp.cssW, vp.cssH);
      ctx.fillStyle = Gfx.rgba(P.fx.damageFrame, a * 0.8);
      const f = 4;
      ctx.fillRect(0, 0, vp.cssW, f);
      ctx.fillRect(0, vp.cssH - f, vp.cssW, f);
      ctx.fillRect(0, 0, f, vp.cssH);
      ctx.fillRect(vp.cssW - f, 0, f, vp.cssH);
      return;
    }
    return base(ctx, type, fx, a, prog, G);
  };
})(Render.defaultHooks.fx);
