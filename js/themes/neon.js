"use strict";

/**
 * ============================================================
 * themes/neon.js —— 主题①「霓虹深海 Neon Abyss」
 *
 * 视觉概念：深海数据舱。暗色底 + 高饱和霓虹光轨，
 *   通路 = 底部发光的数据管道（能量脉冲沿管道下潜），
 *   桥   = 密封舱桥（霓虹光条 + 桥内横向能量流），
 *   物品 = 高亮霓虹晶体（形状语义与逻辑一致：方/三角/圆/星/菱），
 *   仓库 = 六边形接收舱。
 *
 * 只依赖 Gfx（通用工具箱）与 Theme 契约，不含任何游戏规则。
 * ============================================================
 */

(function () {
  /* ---- 本主题内部小工具（模块私有，不污染全局）---- */

  /** 物品类型 → 霓虹色（色相两两相隔 ≥40°，保证五类在暗底上一眼分得开） */
  const NEON = {
    A: "#38f0ff",
    B: "#ff4fd8",
    C: "#6cff9a",
    D: "#ffd23f",
    E: "#b57dff",
  };

  const CYAN = "#35f5ff";
  const MAGENTA = "#ff4fd8";

  /**
   * 前景霓虹晶体（辨识度优先的三层结构）：
   *   ① 分离环：深色同形外圈，物品互相靠近或压在同色桥/管道上时不会糊成一片；
   *   ② 底座 + 主体：类型色由亮到暗的竖向渐变，外发光刻意收敛（辉光只做氛围，
   *      不再把形状泡成一团光斑 —— 这是上一版"辨识度不足"的主因）；
   *   ③ 近白亮边 + 白芯：无论如何都能读出轮廓与"方/三角/圆/星/菱"的形状语义，
   *      同时也是本主题在暗底上 5 种类型的第二重识别线索（色相是第一重）。
   */
  function crystal(ctx, type, r, x, y, scale) {
    const col = NEON[type] || CYAN;
    const s = scale === undefined ? 1 : scale;
    const rr = r * s;

    // ① 分离环：把物品从背景（管道 / 桥 / 辉光）里"切"出来
    ctx.save();
    ctx.globalAlpha = 0.55;
    Gfx.glyphPath(ctx, type, rr * 1.42, x, y + 0.6);
    ctx.fillStyle = "#010610";
    ctx.fill();
    ctx.restore();

    // ② 底座：类型色压暗垫一圈，任何底色上都有属于自己的一块"留白"
    Gfx.glyphPath(ctx, type, rr * 1.2, x, y);
    ctx.fillStyle = Gfx.rgba(Gfx.shade(col, -0.6), 0.92);
    ctx.fill();

    // ③ 主体：外发光（收敛）+ 竖向渐变
    ctx.save();
    ctx.shadowColor = Gfx.rgba(col, 0.8);
    ctx.shadowBlur = Math.max(5, rr * 1.05);
    Gfx.glyphPath(ctx, type, rr * s, x, y);
    const g = ctx.createLinearGradient(x, y - rr, x, y + rr);
    g.addColorStop(0, Gfx.shade(col, 0.5));
    g.addColorStop(0.52, col);
    g.addColorStop(1, Gfx.shade(col, -0.3));
    ctx.fillStyle = g;
    ctx.fill();
    ctx.restore();

    // ④ 近白亮边：类型色的高亮描边，让轮廓一眼可读（替代原先 0.55 透明度的细白线）
    Gfx.glyphPath(ctx, type, rr - 0.7, x, y);
    ctx.lineWidth = Math.max(1.2, rr * 0.2);
    ctx.strokeStyle = Gfx.shade(col, 0.72);
    ctx.stroke();

    // ⑤ 白芯：同形状缩小，形状语义在饱和发光下依然清楚
    ctx.save();
    ctx.globalAlpha = 0.92;
    Gfx.glyphPath(ctx, type, rr * 0.4 * s, x, y - rr * 0.1 * s);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.restore();
  }

  /** 六边形舱体路径 */
  function hexPath(ctx, cx, cy, halfW, halfH) {
    const k = halfW * 0.34;
    ctx.beginPath();
    ctx.moveTo(cx - halfW + k, cy - halfH);
    ctx.lineTo(cx + halfW - k, cy - halfH);
    ctx.lineTo(cx + halfW, cy);
    ctx.lineTo(cx + halfW - k, cy + halfH);
    ctx.lineTo(cx - halfW + k, cy + halfH);
    ctx.lineTo(cx - halfW, cy);
    ctx.closePath();
  }

  Theme.define({
    id: "neon",
    label: "霓虹深海",
    tagline: "暗色霓虹 · 数据管道",
    mode: "dark",

    /* ---- 设置面板里的主题预览色卡（纯数据，供 ThemeUI 生成缩略图）---- */
    preview: {
      bg: "#04060f",
      bg2: "#0b2a44",
      dots: [NEON.A, NEON.B, NEON.C, NEON.D, NEON.E],
    },

    metrics: {
      itemRadius: 9,
      warehouseWidth: 44,
      warehouseHeight: 17,
      warehouseIconRadius: 5.6,
      laneHalf: 4.5,
      laneSegment: 12,
      bridgeInset: 1,
    },

    font: {
      ui: '"Bahnschrift", "Segoe UI", system-ui, sans-serif',
      display: '"Bahnschrift SemiBold", "Bahnschrift", "Segoe UI", sans-serif',
      canvas: '600 13px "Bahnschrift", "Segoe UI", sans-serif',
      labelSize: 13,
    },

    css: {
      radiusPanel: "2px",
      radiusBtn: "2px",
      borderWidth: "1px",
      panelShadow: "0 0 0 1px rgba(53,245,255,0.18), 0 0 34px rgba(53,245,255,0.16), inset 0 0 24px rgba(53,245,255,0.06)",
      btnShadow: "0 0 12px rgba(53,245,255,0.22)",
      hudShadow: "0 0 16px rgba(53,245,255,0.18)",
      letterSpacing: "1.5px",
      transition: "160ms ease",
      fragRadius: "1px",
    },

    /* ---- 生命图标（内联 SVG，颜色随主题）---- */
    livesIcon:
      '<svg viewBox="0 0 32 28" aria-hidden="true">' +
      '<path d="M16 26C6 18.4 2 14.2 2 9.4 2 5.2 5.2 2 9.4 2c2.9 0 5.3 1.6 6.6 4 1.3-2.4 3.7-4 6.6-4C26.8 2 30 5.2 30 9.4 30 14.2 26 18.4 16 26z" ' +
      'fill="#071a2e" stroke="' + CYAN + '" stroke-width="1.8"/>' +
      '<path d="M16 21.4c-6.1-4.9-8.5-7.3-8.5-10.1 0-2.3 1.9-4.2 4.2-4.2 1.7 0 3.2.9 4.3 2.6 1.1-1.7 2.6-2.6 4.3-2.6 2.3 0 4.2 1.9 4.2 4.2 0 2.8-2.4 5.2-8.5 10.1z" ' +
      'fill="' + MAGENTA + '"/></svg>',

    palette: {
      page: "#04060f",
      field: "#07182b",
      fieldAlt: "#020610",
      grid: "rgba(53,245,255,0.055)",
      gridStroke: "rgba(53,245,255,0.22)",
      laneA: "#0c2a44",
      laneB: "#082034",
      laneEdge: "rgba(53,245,255,0.42)",
      bridgeBody: "#0d2c48",
      bridgeTop: CYAN,
      bridgeBottom: "#04101d",
      bridgeEdge: "#ccfbff",
      text: "#cfe9ff",
      textMid: "#9dc4dd",
      textDim: "#6d95b2",
      textBright: "#eafbff",
      panel: "rgba(7,22,38,0.92)",
      panelAlt: "rgba(11,32,52,0.92)",
      panelBorder: "rgba(53,245,255,0.38)",
      overlay: "rgba(2,7,14,0.82)",
      btnBg: "rgba(10,32,52,0.9)",
      btnText: "#cdeeff",
      btnBorder: "rgba(53,245,255,0.32)",
      btnHover: "rgba(16,52,80,0.95)",
      btnActive: "rgba(6,22,38,0.95)",
      primary: "#12668a",
      primaryHover: "#1a86b0",
      primaryActive: "#0d4d69",
      primaryText: "#eafcff",
      accent: CYAN,
      accentAlt: MAGENTA,
      danger: "#ff5d7a",
      success: "#4ff0a8",
      heart: CYAN,
      glow: "rgba(53,245,255,0.5)",
      warehouseFrame: "rgba(53,245,255,0.72)",
      warehouseFill: "rgba(6,20,34,0.85)",
      itemColors: NEON,
      fx: {
        build: CYAN,
        flash: "#e9feff",
        shake: "#ff5d7a",
        plusText: "#b8fbff",
        plusParticle: MAGENTA,
        wrong: "#ff5d7a",
        damageOverlay: "#ff2f57",
        damageFrame: MAGENTA,
        ghostOk: CYAN,
        ghostOkLine: "#ccfbff",
        ghostBad: "#4a6b82",
        ghostBadLine: "#6d95b2",
      },
    },

    /* ============================================================
     * 绘制钩子
     * ============================================================ */
    hooks: {
      /** 场地：深渊渐变 + 水平深度网格 + 海面光带 */
      field: function (ctx, G) {
        ctx.fillStyle = Gfx.linearGradient(ctx, "neon:field", 0, 0, 0, G.h, [
          [0, "#0a2440"],
          [0.22, "#071a30"],
          [0.7, "#04101f"],
          [1, "#01060e"],
        ]);
        ctx.fillRect(0, 0, G.w, G.h);

        // 海面光带（顶部）
        ctx.fillStyle = Gfx.linearGradient(ctx, "neon:surface", 0, 0, 0, 90, [
          [0, Gfx.rgba(CYAN, 0.22)],
          [0.4, Gfx.rgba(CYAN, 0.06)],
          [1, Gfx.rgba(CYAN, 0)],
        ]);
        ctx.fillRect(0, 0, G.w, 90);

        // 水平深度网格 + 垂直基准线（同色小矩形阵列 → 各合成一条路径一次填充）
        Gfx.batchRects(ctx, Gfx.rgba(CYAN, 0.05), function (r) {
          for (let y = 20; y < G.h; y += 20) r(0, y, G.w, 1);
        });
        Gfx.batchRects(ctx, Gfx.rgba(CYAN, 0.035), function (r) {
          for (let x = 10; x < G.w; x += 20) r(x, 0, 1, G.h);
        });

        // 舱体边界
        ctx.strokeStyle = Gfx.rgba(CYAN, 0.35);
        ctx.lineWidth = 1;
        ctx.strokeRect(0.5, 0.5, G.w - 1, G.h - 1);
        ctx.strokeStyle = Gfx.rgba(CYAN, 0.12);
        ctx.strokeRect(3.5, 3.5, G.w - 7, G.h - 7);
      },

      /** 装饰：上浮气泡 + 探照光束 */
      decor: function (ctx, G) {
        // 探照光束（两束，缓慢摆动）
        for (let i = 0; i < 2; i++) {
          const sway = Math.sin(G.t * 0.18 + i * 2.1) * 26;
          const cx = (i === 0 ? G.w * 0.32 : G.w * 0.72) + sway;
          ctx.save();
          ctx.globalAlpha = 0.055;
          ctx.fillStyle = CYAN;
          ctx.beginPath();
          ctx.moveTo(cx - 10, 0);
          ctx.lineTo(cx + 10, 0);
          ctx.lineTo(cx + 52, G.h);
          ctx.lineTo(cx - 46, G.h);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        }

        // 上浮气泡（确定性分布，缓慢上升）
        const span = G.h + 60;
        for (let i = 0; i < 16; i++) {
          const hx = Gfx.hash(i * 3.3 + 1);
          const hp = Gfx.hash(i * 7.7 + 2);
          const hs = Gfx.hash(i * 5.1 + 3);
          const speed = 9 + hs * 16;
          const x = 8 + hx * (G.w - 16) + Math.sin(G.t * 0.5 + i) * 2.2;
          const y = G.h + 30 - ((hp * span + G.t * speed) % span);
          const r = 1.4 + hs * 2.6;
          ctx.strokeStyle = Gfx.rgba(CYAN, 0.16 + hs * 0.12);
          ctx.lineWidth = 0.9;
          ctx.beginPath();
          ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.stroke();
        }
      },

      /** 通路：数据管道 + 沿管下潜的能量脉冲 */
      lane: function (ctx, i, G) {
        const x = G.laneX(i);
        const half = G.m.laneHalf;
        const dim = 0.72 + (i % 2) * 0.28;

        // 管体
        ctx.fillStyle = "#061421";
        ctx.fillRect(x - half - 1, 0, half * 2 + 2, G.h);
        ctx.fillStyle = Gfx.linearGradient(ctx, "neon:lane" + i, x - half, 0, x + half, 0, [
          [0, Gfx.rgba("#0b2740", dim)],
          [0.5, Gfx.rgba("#123c5c", dim)],
          [1, Gfx.rgba("#0b2740", dim)],
        ]);
        ctx.fillRect(x - half, 0, half * 2, G.h);

        // 分段刻度（同色 → 合批一次填充）
        Gfx.batchRects(ctx, Gfx.rgba(CYAN, 0.1 * dim), function (r) {
          for (let y = 0; y < G.h; y += G.m.laneSegment) r(x - half, y, half * 2, 1);
        });

        // 中央能量芯
        ctx.fillStyle = Gfx.rgba(CYAN, 0.22 * dim);
        ctx.fillRect(x - 0.7, 0, 1.4, G.h);

        // 下潜脉冲（多枚，错相位）
        const span = G.h + 80;
        for (let k = 0; k < 2; k++) {
          const off = Gfx.hash(i * 9.1 + k * 4.7);
          const y = -40 + ((off * span + G.t * 132) % span);
          const g = ctx.createLinearGradient(x, y - 26, x, y + 26);
          g.addColorStop(0, Gfx.rgba(CYAN, 0));
          g.addColorStop(0.5, Gfx.rgba(CYAN, 0.5 * dim));
          g.addColorStop(1, Gfx.rgba(CYAN, 0));
          ctx.fillStyle = g;
          ctx.fillRect(x - half + 0.6, y - 26, half * 2 - 1.2, 52);
        }

        // 管壁亮线
        ctx.fillStyle = Gfx.rgba(CYAN, 0.34 * dim);
        ctx.fillRect(x - half, 0, 1, G.h);
        ctx.fillRect(x + half - 1, 0, 1, G.h);
      },

      /** 桥：密封舱桥（暗舱体 + 霓虹光条 + 内部横向能量流） */
      bridge: function (ctx, b, G, hovered) {
        const x1 = G.laneX(b.lanes[0]);
        const x2 = G.laneX(b.lanes[1]);
        const top = G.bridgeTop(b);
        const w = G.bridgeWidth;
        const lit = hovered ? "#e9feff" : CYAN;

        // 舱体外发光
        ctx.save();
        ctx.shadowColor = Gfx.rgba(CYAN, hovered ? 0.75 : 0.4);
        ctx.shadowBlur = hovered ? 16 : 9;
        Gfx.roundRect(ctx, x1, top, x2 - x1, w, 1.5);
        ctx.fillStyle = hovered ? "#123c5e" : "#0b2438";
        ctx.fill();
        ctx.restore();

        // 舱体面板纹理
        ctx.fillStyle = Gfx.rgba(CYAN, 0.1);
        for (let px = x1 + 4; px < x2 - 3; px += 6) ctx.fillRect(px, top + 2.5, 1, w - 5);

        // 顶部霓虹光条
        ctx.save();
        ctx.shadowColor = Gfx.rgba(lit, 0.9);
        ctx.shadowBlur = hovered ? 14 : 8;
        ctx.fillStyle = lit;
        ctx.fillRect(x1 + 1, top + 1, x2 - x1 - 2, 1.6);
        ctx.restore();
        ctx.fillStyle = Gfx.rgba(lit, 0.55);
        ctx.fillRect(x1 + 1, top + w - 1.6, x2 - x1 - 2, 1.2);

        // 内部横向能量流
        const phase = (G.t * 0.55 + (b.id % 5) * 0.19) % 1;
        const fx = x1 + 6 + phase * (x2 - x1 - 12);
        const eg = ctx.createRadialGradient(fx, top + w / 2, 0, fx, top + w / 2, 9);
        eg.addColorStop(0, Gfx.rgba(hovered ? "#ffffff" : CYAN, 0.85));
        eg.addColorStop(1, Gfx.rgba(CYAN, 0));
        ctx.fillStyle = eg;
        ctx.fillRect(x1 + 3, top, x2 - x1 - 6, w);

        // 两端立柱
        ctx.save();
        ctx.shadowColor = Gfx.rgba(CYAN, 0.8);
        ctx.shadowBlur = 8;
        ctx.fillStyle = hovered ? "#e9feff" : Gfx.rgba(CYAN, 0.95);
        ctx.fillRect(x1 - 1, top - 1.5, 3, w + 3);
        ctx.fillRect(x2 - 2, top - 1.5, 3, w + 3);
        ctx.restore();

        // 悬停：四角支架
        if (hovered) {
          ctx.strokeStyle = Gfx.rgba("#e9feff", 0.95);
          ctx.lineWidth = 1.4;
          const s = 4;
          const pts = [[x1, top], [x2, top], [x1, top + w], [x2, top + w]];
          for (let k = 0; k < pts.length; k++) {
            const sx = pts[k][0] === x1 ? 1 : -1;
            const sy = pts[k][1] === top ? 1 : -1;
            ctx.beginPath();
            ctx.moveTo(pts[k][0] + sx * s, pts[k][1]);
            ctx.lineTo(pts[k][0], pts[k][1]);
            ctx.lineTo(pts[k][0], pts[k][1] + sy * s);
            ctx.stroke();
          }
        }
      },

      /** 建桥预览：可建 → 青色虚线支架；不可建 → 暗红警示 */
      ghost: function (ctx, c, G) {
        const x1 = G.laneX(c.laneA);
        const x2 = G.laneX(c.laneB);
        const top = c.y - G.bridgeWidth / 2;
        if (top < 0 || top + G.bridgeWidth > G.h) return;
        const ok = c.legal;
        const line = ok ? Gfx.rgba(CYAN, 0.85) : Gfx.rgba("#ff5d7a", 0.6);
        ctx.fillStyle = ok ? Gfx.rgba(CYAN, 0.14) : Gfx.rgba("#ff5d7a", 0.1);
        ctx.fillRect(x1, top, x2 - x1, G.bridgeWidth);
        ctx.save();
        ctx.setLineDash([4, 3]);
        ctx.lineWidth = 1.2;
        ctx.strokeStyle = line;
        ctx.strokeRect(x1 + 0.5, top + 0.5, x2 - x1 - 1, G.bridgeWidth - 1);
        ctx.restore();
        // 中心指示
        ctx.fillStyle = line;
        ctx.fillRect((x1 + x2) / 2 - 0.6, top + G.bridgeWidth / 2 - 0.6, 1.2, 1.2);
      },

      /** 仓库：六边形接收舱 + 目标晶体 */
      warehouse: function (ctx, i, G) {
        const x = G.laneX(i);
        const w = G.m.warehouseWidth / 2;
        const h = G.m.warehouseHeight / 2;
        const cy = G.h + h;

        ctx.save();
        ctx.shadowColor = Gfx.rgba(CYAN, 0.45);
        ctx.shadowBlur = 10;
        hexPath(ctx, x, cy, w, h);
        ctx.fillStyle = Gfx.linearGradient(ctx, "neon:wh" + i, x, cy - h, x, cy + h, [
          [0, "rgba(12,42,66,0.95)"],
          [1, "rgba(5,18,32,0.95)"],
        ]);
        ctx.fill();
        ctx.restore();

        hexPath(ctx, x, cy, w, h);
        ctx.lineWidth = 1.2;
        ctx.strokeStyle = Gfx.rgba(CYAN, 0.75);
        ctx.stroke();

        // 舱口扫描线
        ctx.fillStyle = Gfx.rgba(CYAN, 0.18);
        ctx.fillRect(x - w * 0.72, cy + h * 0.52, w * 1.44, 1);

        crystal(ctx, Config.laneWarehouse[i], G.m.warehouseIconRadius, x, cy, 1);
      },

      item: function (ctx, item, G) {
        crystal(ctx, item.type, G.m.itemRadius, item.x, item.y, 1);
      },

      /** 世界空间最上层：暗角 + 极淡扫描线 */
      overlay: function (ctx, G) {
        const vg = ctx.createRadialGradient(G.w / 2, G.h / 2, G.h * 0.28, G.w / 2, G.h / 2, G.h * 0.78);
        vg.addColorStop(0, "rgba(0,0,0,0)");
        vg.addColorStop(1, "rgba(0,0,0,0.45)");
        ctx.fillStyle = vg;
        ctx.fillRect(0, 0, G.w, G.h);

        // 舱体扫描线（同色细线阵列 → 一条路径一次填充）
        Gfx.batchRects(ctx, "rgba(0,0,0,0.10)", function (r) {
          for (let y = 0; y < G.h; y += 4) r(0, y, G.w, 1);
        });
      },

      /** 屏幕空间最上层：细扫描线 + 四角支架 */
      screenOverlay: function (ctx, vp) {
        // 屏幕扫描线：273 条同色 1px 细线合批成"一条路径 + 一次填充"，
        // 视觉完全一致，但省掉 272 次全宽光栅化（原先是本主题最大的开销点）。
        Gfx.batchRects(ctx, "rgba(0,0,0,0.055)", function (r) {
          for (let y = 0; y < vp.cssH; y += 3) r(0, y, vp.cssW, 1);
        });

        ctx.strokeStyle = Gfx.rgba(CYAN, 0.3);
        ctx.lineWidth = 1.5;
        const s = 16, m = 8;
        const corners = [[m, m, 1, 1], [vp.cssW - m, m, -1, 1], [m, vp.cssH - m, 1, -1], [vp.cssW - m, vp.cssH - m, -1, -1]];
        for (let k = 0; k < corners.length; k++) {
          const c = corners[k];
          ctx.beginPath();
          ctx.moveTo(c[0] + c[2] * s, c[1]);
          ctx.lineTo(c[0], c[1]);
          ctx.lineTo(c[0], c[1] + c[3] * s);
          ctx.stroke();
        }
      },

      /** 特效：全部走霓虹语言 */
      fx: function (ctx, type, f, a, prog, G, vp) {
        if (type === "build") {
          const cx = (f.x1 + f.x2) / 2;
          const top = f.y - G.bridgeWidth / 2;
          const sweep = Gfx.easeOut(Math.min(1, prog / 0.7));
          const hw = ((f.x2 - f.x1) / 2) * sweep;
          ctx.save();
          ctx.shadowColor = Gfx.rgba(CYAN, 0.9);
          ctx.shadowBlur = 16;
          ctx.fillStyle = Gfx.rgba("#ccfbff", a * 0.8);
          ctx.fillRect(cx - hw, top + 1, hw * 2, G.bridgeWidth - 2);
          ctx.restore();
          return;
        }
        if (type === "flash") {
          ctx.save();
          ctx.shadowColor = Gfx.rgba(MAGENTA, 0.8);
          ctx.shadowBlur = 18;
          ctx.fillStyle = Gfx.rgba("#ffffff", a * 0.75);
          ctx.fillRect(f.x1, f.y - G.bridgeWidth / 2, f.x2 - f.x1, G.bridgeWidth);
          ctx.restore();
          return;
        }
        if (type === "shake") {
          const dx = Math.sin(prog * 42) * 3 * a;
          ctx.save();
          ctx.shadowColor = Gfx.rgba("#ff5d7a", 0.8);
          ctx.shadowBlur = 14;
          ctx.fillStyle = Gfx.rgba("#ff5d7a", a * 0.6);
          ctx.fillRect(f.x1 + dx, f.y - G.bridgeWidth / 2, f.x2 - f.x1, G.bridgeWidth);
          ctx.restore();
          // 锁定提示：中央叉号
          ctx.strokeStyle = Gfx.rgba("#ffffff", a * 0.7);
          ctx.lineWidth = 1.2;
          const mx = (f.x1 + f.x2) / 2, my = f.y;
          ctx.beginPath();
          ctx.moveTo(mx - 3, my - 3); ctx.lineTo(mx + 3, my + 3);
          ctx.moveTo(mx + 3, my - 3); ctx.lineTo(mx - 3, my + 3);
          ctx.stroke();
          return;
        }
        if (type === "deliver") {
          const y = f.y - prog * 30;
          if (f.ok) {
            ctx.save();
            ctx.shadowColor = Gfx.rgba(CYAN, 0.9);
            ctx.shadowBlur = 14;
            ctx.fillStyle = Gfx.rgba("#b8fbff", Math.min(1, a * 2.2));
            ctx.font = "600 14px " + G.font.ui.split(",")[0].trim() + ", sans-serif";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText("+1", f.x, y);
            ctx.restore();
            for (let k = 0; k < 4; k++) {
              const ang = (k / 4) * Math.PI * 2 + prog * 2;
              const d = 6 + prog * 16;
              ctx.fillStyle = Gfx.rgba(k % 2 ? MAGENTA : CYAN, a * 0.9);
              ctx.fillRect(f.x + Math.cos(ang) * d - 1, y + Math.sin(ang) * d - 1, 2.4, 2.4);
            }
          } else {
            const dx = Math.sin(prog * 42) * 4 * a;
            ctx.save();
            ctx.shadowColor = Gfx.rgba("#ff5d7a", 0.9);
            ctx.shadowBlur = 16;
            ctx.fillStyle = Gfx.rgba("#ff5d7a", a * 0.55);
            ctx.fillRect(f.x - 22 + dx, f.y - 2, 44, 18);
            ctx.restore();
          }
          return;
        }
        if (type === "damage") {
          ctx.fillStyle = Gfx.rgba("#ff2f57", a * 0.3);
          ctx.fillRect(0, 0, vp.cssW, vp.cssH);
          ctx.fillStyle = Gfx.rgba(MAGENTA, a * 0.85);
          const fw = 5;
          ctx.fillRect(0, 0, vp.cssW, fw);
          ctx.fillRect(0, vp.cssH - fw, vp.cssW, fw);
          ctx.fillRect(0, 0, fw, vp.cssH);
          ctx.fillRect(vp.cssW - fw, 0, fw, vp.cssH);
          // 失真切片
          ctx.fillStyle = Gfx.rgba("#ffffff", a * 0.16);
          for (let k = 0; k < 5; k++) {
            const sy = (Gfx.hash(k * 3.1 + Math.floor(prog * 6)) * vp.cssH) | 0;
            ctx.fillRect(0, sy, vp.cssW, 2 + (k % 3));
          }
        }
      },

      /** 通路标签：霓虹坐标标记 */
      laneLabel: function (ctx, i, sx, sy, G) {
        const col = Gfx.rgba(CYAN, 0.85);
        ctx.font = G.font.canvas;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = Gfx.rgba(CYAN, 0.28);
        ctx.fillRect(sx - 13, sy - 8, 26, 16);
        ctx.strokeStyle = Gfx.rgba(CYAN, 0.5);
        ctx.lineWidth = 1;
        ctx.strokeRect(sx - 13.5, sy - 8.5, 27, 17);
        ctx.fillStyle = col;
        ctx.fillText("L" + (i + 1), sx, sy + 0.5);
      },
    },
  });
})();
