"use strict";

/**
 * ============================================================
 * themes/clay.js —— 主题③「糖果黏土 Candy Clay」
 *
 * 视觉概念：一整块粉色黏土板上的糖果流水线。
 *   场地 = 奶油粉 → 薰衣草紫的柔和渐变黏土板（四边内阴影 + 糖果彩针）；
 *   通路 = 粉/蓝交替的糖果胶条（斜向旋纹 + 左侧白色高光 + 右侧暗边 + 两端圆头）；
 *   桥   = 厚实的糖果黏土条（底部厚边 + 顶部白色高光条 + 悬停"鼓起来"）；
 *   物品 = 黏土糖块（形状语义与逻辑一致：方 / 三角 / 圆 / 星 / 菱）；
 *   仓库 = 糖果罐（玻璃罐体 + 白色罐口厚边 + 罐内目标形状）。
 *
 * 手法要点（为什么这么做）：
 *   1) claymorphism 的立体感来自"厚描边 + 偏移实心暗层 + 大圆角"，
 *      而不是 shadowBlur：浅色主题下模糊阴影会发灰发脏，实心暗层像素稳定、更像黏土。
 *      因此本主题完全不用 shadowBlur（改动前 grep 计数为 0），一律用"偏移的暗色同形形状"做投影。
 *   2) 所有"随机"纹理（彩针 / 纸屑 / 星光 / 装饰分布）一律取自 Gfx.hash / Gfx.hash2，
 *      同一输入永远同一结果 → 逐帧稳定，不会闪烁抖动。
 *   3) 渐变全部走 Gfx.linearGradient / Gfx.radialGradient 的缓存：
 *      - 通路渐变坐标与 i 有关 → key 里带 i；
 *      - 桥的竖向渐变需要跟随桥位纵向平移，若把坐标写进 key，每个桥位都会新建一个
 *        渐变对象（缓存立刻被冲掉）。因此桥内部用 ctx.translate 把桥顶挪到局部 y=0，
 *        渐变坐标固定为 0..h，一个 key 服务所有桥（渐变按绘制时的 CTM 解释）。
 *   4) 装饰层（decor）透明度全部 ≤ 0.14，且只画在"通路之间的空隙"里，
 *      绝不遮挡或混淆物品 / 通路 / 桥。
 *
 * 对比度自检（Gfx.contrast，见文件内 outlineOf）：物品可能压在通路（粉/蓝）、
 *   场地（奶油白/浅紫）或桥上（粉 #ffb3cd）——其中"桥面 + 最外层暗角薄纱"的合成色
 *   是它可能落到的最暗底色。运行时逐类型自查（-0.45 起，必要时继续压暗），
 *   实测描边与最坏底色的对比度最小 4.68（D 天蓝），全部 ≥ 4.5；明细见 outlineOf 注释。
 *
 * 只依赖 Gfx（通用工具箱）、Config（几何常量）与 Theme 契约，不含任何游戏规则。
 * ============================================================
 */

(function () {
  /* ============================================================
   * 一、模块私有常量（配色取自糖果粉彩色，和 def.palette 一一对应）
   * ============================================================ */

  /** 物品/仓库糖果色：A 粉 B 柠 C 薄荷 D 天蓝 E 葡萄 */
  const CANDY = {
    A: "#ff8fab",
    B: "#ffc75f",
    C: "#7ee0a6",
    D: "#6ec6ff",
    E: "#b892ff",
  };

  /** 顺序表（彩针 / 纸屑 / 标签圆点按序取色，避免每次新建数组） */
  const CANDY_LIST = [CANDY.A, CANDY.B, CANDY.C, CANDY.D, CANDY.E];

  const LANE_PINK = "#ffd9e8";      // 糖果棒（通路）交替色之一
  const LANE_BLUE = "#d9ecff";      // 糖果棒（通路）交替色之二
  const BRIDGE_BODY = "#ffb3cd";    // 桥体（草莓牛奶）
  const BRIDGE_BOTTOM = "#e08aac";  // 桥底厚边（深一号粉）
  const BRIDGE_TOP = "#ffffff";     // 桥顶高光条
  const FIELD_CREAM = "#fff9fd";    // 场地奶油白
  const FIELD_ALT = "#f2f0ff";      // 场地薰衣草紫
  const CLAY_SHADOW = "#c69acd";    // 黏土硬阴影的紫粉色（偏移实心暗层统一用它）
  const VIGNETTE_TINT = "#966eaa";  // 暗角薄纱的紫（压在所有物品之上，最深处 ≤0.13）

  /* ============================================================
   * 二、模块私有小工具（不污染全局）
   * ============================================================ */

  /**
   * 物品描边色：以 spec 建议的 Gfx.shade(color, -0.45) 为起点，
   * 若与"最坏底色"对比度不足 4.5 则继续压暗（步长 0.05，最深 -0.70）。
   *
   * 为什么需要自适应：糖果粉彩色本身很亮，-0.45 的深色对柠檬黄/薄荷绿/天蓝
   * 不足以在粉色通路与粉色桥上立住轮廓（实测主要底色下的对比度会掉到 2.9~4.3）。
   * 最坏底色取"物品可能落到的最暗面"= 桥面 #ffb3cd，并叠加最外层那一层
   * 极淡暗角薄纱（rgba(150,110,170,0.13) 的合成色 rgb(241,170,200)），
   * 保证即使压上 overlay 也仍然达标。
   *
   * 实测（用 Gfx.contrast 复算，node 已验证）：
   *   A 粉   -0.60 → #663944   纱后桥面 5.07 / 桥面 5.63 / 粉通路 7.32 / 奶油底 9.05
   *   B 柠   -0.65 → #594621   纱后桥面 4.88 / 桥面 5.42 / 粉通路 7.04 / 奶油底 8.71
   *   C 薄荷 -0.65 → #2c4e3a   纱后桥面 5.02 / 桥面 5.57 / 粉通路 7.24 / 奶油底 8.96
   *   D 天蓝 -0.60 → #2c4f66   纱后桥面 4.68 / 桥面 5.20 / 粉通路 6.76 / 奶油底 8.36
   *   E 葡萄 -0.55 → #534273   纱后桥面 4.73 / 桥面 5.25 / 粉通路 6.82 / 奶油底 8.44
   * 全部 ≥ 4.5（WCAG AA），最小值为 D 的 4.68（纱后桥面）。
   */
  const OUTLINE_CACHE = {};   // 颜色 → 描边色（懒计算 + 记忆化，避免逐帧重算）

  function outlineOf(color) {
    const hit = OUTLINE_CACHE[color];
    if (hit) return hit;
    // 物品可能落到的底色：两条通路、场地两端、桥面，
    // 以及"桥面 + 最外层暗角薄纱"的合成色（overlay 压在所有物品之上）
    const backs = [LANE_PINK, LANE_BLUE, "#ffe3f2", FIELD_CREAM, FIELD_ALT, BRIDGE_BODY,
                   Gfx.mix(BRIDGE_BODY, VIGNETTE_TINT, 0.13)];
    let pick = Gfx.shade(color, -0.70);
    for (let k = 9; k <= 14; k++) {
      const c = Gfx.shade(color, -k * 0.05);   // -0.45 → -0.70
      let ok = true;
      for (let b = 0; b < backs.length; b++) {
        if (Gfx.contrast(c, backs[b]) < 4.5) { ok = false; break; }
      }
      if (ok) { pick = c; break; }
    }
    OUTLINE_CACHE[color] = pick;
    return pick;
  }

  /**
   * 椭圆路径（用 translate/rotate/scale + arc 实现，避免依赖 ctx.ellipse）。
   * 路径在构造时即被变换到设备空间，故 restore 之后路径仍然可用。
   */
  function ellipsePath(ctx, x, y, rx, ry, rot) {
    ctx.save();
    ctx.translate(x, y);
    if (rot) ctx.rotate(rot);
    ctx.scale(rx, ry);
    ctx.beginPath();
    ctx.arc(0, 0, 1, 0, Math.PI * 2);
    ctx.restore();
    return ctx;
  }

  /** 四角星光（两点短十字 + 内凹控制点，屏幕空间星光用） */
  function sparklePath(ctx, x, y, r) {
    const k = r * 0.20;
    ctx.beginPath();
    ctx.moveTo(x, y - r);
    ctx.quadraticCurveTo(x + k, y - k, x + r, y);
    ctx.quadraticCurveTo(x + k, y + k, x, y + r);
    ctx.quadraticCurveTo(x - k, y + k, x - r, y);
    ctx.quadraticCurveTo(x - k, y - k, x, y - r);
    ctx.closePath();
    return ctx;
  }

  /**
   * 圆角条 + 可选描边（黏土零件的高频组合）。
   * 描边路径内缩半个线宽：厚描边不会溢出到形状之外，边缘永远干净。
   */
  function clayBar(ctx, x, y, w, h, r, fill, stroke, lw) {
    Gfx.roundRect(ctx, x, y, w, h, r);
    ctx.fillStyle = fill;
    ctx.fill();
    if (stroke && lw > 0) {
      Gfx.roundRect(ctx, x + lw / 2, y + lw / 2, w - lw, h - lw, Math.max(0, r - lw / 2));
      ctx.save();
      ctx.lineJoin = "round";
      ctx.lineWidth = lw;
      ctx.strokeStyle = stroke;
      ctx.stroke();
      ctx.restore();
    }
    return ctx;
  }

  /** 一条"软边内阴影"薄带（四边内阴影复用；渐变缓存 key 由调用方给） */
  function innerEdge(ctx, key, x0, y0, x1, y1, x, y, w, h) {
    ctx.fillStyle = Gfx.linearGradient(ctx, key, x0, y0, x1, y1, [
      [0, Gfx.rgba(CLAY_SHADOW, 0.20)],
      [1, Gfx.rgba(CLAY_SHADOW, 0)],
    ]);
    ctx.fillRect(x, y, w, h);
  }

  /**
   * 黏土糖块：形状语义与逻辑完全一致（方/三角/圆/星/菱）。
   * 三层结构（顺序即绘制顺序）：
   *   ① 偏移 1.5 的深色同形投影（"硬阴影层"，略淡；再补一层更远更淡的做柔和过渡）
   *   ② 自身色填充 + 同色系深色描边（线宽约 2，保证浅底可读性）
   *   ③ 左上的白色小高光（内缩 ~1/3 的小椭圆，透明度 0.75）
   */
  function candyBlock(ctx, type, r, cx, cy, color, withShadow) {
    if (withShadow !== false) {
      ctx.save();
      ctx.globalAlpha = 0.20;
      Gfx.glyphPath(ctx, type, r * 1.0, cx, cy + 1.5);
      ctx.fillStyle = Gfx.shade(color, -0.62);
      ctx.fill();
      ctx.globalAlpha = 0.10;   // 第二层更远更淡 → 不靠 shadowBlur 也能"柔"
      Gfx.glyphPath(ctx, type, r * 1.06, cx, cy + 2.6);
      ctx.fill();
      ctx.restore();
    }

    Gfx.glyphPath(ctx, type, r, cx, cy);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.save();
    ctx.lineJoin = "round";
    ctx.lineWidth = Math.max(1.4, Math.min(2, r * 0.26));   // 物品 r=9 → 2
    ctx.strokeStyle = outlineOf(color);
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = 0.75;
    ellipsePath(ctx, cx - r * 0.32, cy - r * 0.36, r * 0.30, r * 0.19, -0.55);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.restore();
  }

  /** 云朵：三圆 + 一条圆角底边（底部对齐，像一个圆头长条） */
  function cloud(ctx, cx, cy, s, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = "#ffffff";
    Gfx.roundRect(ctx, cx - s * 1.1, cy, s * 2.2, s * 0.62, s * 0.31);
    ctx.fill();
    Gfx.circlePath(ctx, s * 0.62, cx - s * 0.42, cy + s * 0.04);
    ctx.fill();
    Gfx.circlePath(ctx, s * 0.80, cx + s * 0.38, cy - s * 0.10);
    ctx.fill();
    ctx.restore();
  }

  /* ============================================================
   * 三、主题定义
   * ============================================================ */

  Theme.define({
    id: "clay",
    label: "糖果黏土",
    tagline: "柔和黏土 · 糖果色",
    mode: "light",

    /* ---- 设置面板里的主题预览色卡（纯数据，供 ThemeUI 生成缩略图）---- */
    preview: {
      bg: "#ffeef7",
      bg2: "#e4f4ff",
      dots: [CANDY.A, CANDY.B, CANDY.C, CANDY.D, CANDY.E],
    },

    metrics: {
      itemRadius: 9,
      warehouseWidth: 44,
      warehouseHeight: 17,
      warehouseIconRadius: 6,
      laneHalf: 5,
      laneSegment: 12,
      bridgeInset: 1,
    },

    font: {
      ui: '"Nunito", "Comic Sans MS", "Segoe UI Rounded", "Segoe UI", system-ui, sans-serif',
      display: '"Nunito", "Segoe UI Rounded", "Comic Sans MS", "Segoe UI", system-ui, sans-serif',
      canvas: 'bold 14px "Nunito", "Comic Sans MS", "Segoe UI", sans-serif',
      labelSize: 14,
    },

    css: {
      radiusPanel: "22px",
      radiusBtn: "999px",
      borderWidth: "3px",
      panelShadow: "0 10px 0 rgba(224,186,220,0.55), 0 22px 44px rgba(180,140,200,0.24)",
      btnShadow: "0 5px 0 rgba(206,160,190,0.6)",
      hudShadow: "0 6px 0 rgba(228,196,222,0.5)",
      letterSpacing: "0.5px",
      transition: "180ms ease",
      fragRadius: "999px",
    },

    /**
     * 动画时长（可选覆盖）：黏土的"挤压回弹"需要一点时间才读得出来，
     * 因此整体比默认略慢一档（build 的 easeBack 过冲、deliver 的糖屑飘散尤其明显）。
     */
    anim: {
      build: 0.30,
      flash: 0.22,
      shake: 0.34,
      deliver: 0.9,
      damage: 0.55,
    },

    /* ---- 生命图标（内联 SVG）：亮粉黏土心 = 主体 + 深粉描边 + 左上高光 + 右下深粉阴影 ---- */
    livesIcon:
      '<svg viewBox="0 0 32 28" aria-hidden="true">' +
      /* 右下深粉阴影：同形路径向右下偏移一点，只露出一条"厚度" */
      '<path transform="translate(1.1,1.1)" d="M16 26C6 18.4 2 14.2 2 9.4 2 5.2 5.2 2 9.4 2c2.9 0 5.3 1.6 6.6 4 1.3-2.4 3.7-4 6.6-4C26.8 2 30 5.2 30 9.4 30 14.2 26 18.4 16 26z" ' +
      'fill="none" stroke="#e2648a" stroke-width="2.6" stroke-linejoin="round" opacity="0.5"/>' +
      /* 主体：亮粉填充 + 深一号描边 */
      '<path d="M16 26C6 18.4 2 14.2 2 9.4 2 5.2 5.2 2 9.4 2c2.9 0 5.3 1.6 6.6 4 1.3-2.4 3.7-4 6.6-4C26.8 2 30 5.2 30 9.4 30 14.2 26 18.4 16 26z" ' +
      'fill="#ff8fab" stroke="#e2648a" stroke-width="2" stroke-linejoin="round"/>' +
      /* 左上白色高光 */
      '<ellipse cx="10.6" cy="9.2" rx="3.2" ry="2.1" transform="rotate(-30 10.6 9.2)" fill="#ffffff" opacity="0.85"/>' +
      '</svg>',

    palette: {
      page: "#ffeef7",
      field: FIELD_CREAM,
      fieldAlt: FIELD_ALT,
      laneA: LANE_PINK,
      laneB: LANE_BLUE,
      laneEdge: "rgba(226,150,180,0.75)",
      bridgeBody: BRIDGE_BODY,
      bridgeTop: BRIDGE_TOP,
      bridgeBottom: BRIDGE_BOTTOM,
      bridgeEdge: "#ffffff",
      text: "#4a3b57",
      textMid: "#6d5b7d",
      textDim: "#9c8bab",
      textBright: "#332545",
      panel: "rgba(255,255,255,0.94)",
      panelAlt: "rgba(255,244,250,0.94)",
      panelBorder: "rgba(214,180,220,0.85)",
      overlay: "rgba(122,92,140,0.42)",
      btnBg: "#ffffff",
      btnText: "#4a3b57",
      btnBorder: "rgba(214,180,220,0.9)",
      btnHover: "#fff4fb",
      btnActive: "#f6e6f2",
      primary: "#ff8fab",
      primaryHover: "#ffa3ba",
      primaryActive: "#ef7698",
      primaryText: "#ffffff",
      accent: "#ff8fab",
      accentAlt: "#7ee0a6",
      danger: "#ff6b81",
      success: "#4fd18b",
      heart: "#ff8fab",
      glow: "rgba(255,143,171,0.4)",
      warehouseFrame: "rgba(214,150,190,0.95)",
      warehouseFill: "rgba(255,255,255,0.75)",
      itemColors: CANDY,
      fx: {
        build: "#ffffff",
        flash: "#ff8fab",
        shake: "#ff6b81",
        plusText: "#ff6b9a",
        plusParticle: "#ffc75f",
        wrong: "#ff6b81",
        damageOverlay: "#ff6b81",
        damageFrame: "#ff8fab",
        ghostOk: "#7ee0a6",
        ghostOkLine: "#4fd18b",
        ghostBad: "#c9bcd4",
        ghostBadLine: "#a898b8",
      },
    },

    /* ============================================================
     * 绘制钩子
     * ============================================================ */
    hooks: {
      /** 场地：黏土板（粉紫渐变 + 糖果彩针 + 四边内阴影 + 白色内嵌边） */
      field: function (ctx, G) {
        // ① 底板：粉 → 奶油白 → 薰衣草紫，像一块被顶光打亮的黏土板
        ctx.fillStyle = Gfx.linearGradient(ctx, "clay:field:" + G.h, 0, 0, 0, G.h, [
          [0, "#ffe3f2"],
          [0.34, FIELD_CREAM],
          [1, FIELD_ALT],
        ]);
        ctx.fillRect(0, 0, G.w, G.h);

        // ② 糖果彩针：确定性散布的小圆角短条（alpha ≤ 0.14，只做质感，绝不抢物品）
        for (let i = 0; i < 36; i++) {
          const x = Gfx.hash2(i * 1.7, 3.1) * G.w;
          const y = Gfx.hash2(5.3, i * 2.9) * G.h;
          const rot = (Gfx.hash(i * 4.7 + 0.3) - 0.5) * 2.2;
          const len = 6.5 + Gfx.hash(i * 8.3 + 1.1) * 5.5;
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(rot);
          ctx.globalAlpha = 0.09 + Gfx.hash(i * 6.1 + 2.2) * 0.05;
          Gfx.roundRect(ctx, -len / 2, -1.05, len, 2.1, 1.05);
          ctx.fillStyle = CANDY_LIST[i % CANDY_LIST.length];
          ctx.fill();
          ctx.restore();
        }

        // ③ 四边内阴影（软边）：用四条渐变薄带替代 shadowBlur，像素稳定且不脏
        const eg = 26;
        innerEdge(ctx, "clay:inTop:" + G.h, 0, 0, 0, eg, 0, 0, G.w, eg);
        innerEdge(ctx, "clay:inBot:" + G.h, 0, G.h, 0, G.h - eg, 0, G.h - eg, G.w, eg);
        innerEdge(ctx, "clay:inLeft:" + G.h, 0, 0, eg, 0, 0, 0, eg, G.h);
        innerEdge(ctx, "clay:inRight:" + G.h, G.w, 0, G.w - eg, 0, G.w - eg, 0, eg, G.h);

        // ④ 内嵌白色边 + 一道粉紫细线：强化"这是一块黏土板"的容器感
        Gfx.roundRect(ctx, 3, 3, G.w - 6, G.h - 6, 16);
        ctx.lineWidth = 3;
        ctx.strokeStyle = "rgba(255,255,255,0.85)";
        ctx.stroke();
        Gfx.roundRect(ctx, 5.2, 5.2, G.w - 10.4, G.h - 10.4, 14);
        ctx.lineWidth = 1.4;
        ctx.strokeStyle = "rgba(214,160,205,0.40)";
        ctx.stroke();
      },

      /** 装饰：缓缓上下浮动的软糖圆 + 云朵（只画在通路之间，透明度 ≤ 0.14） */
      decor: function (ctx, G) {
        // ① 软糖圆：x 落在两条通路的中点（40 / 100 / 160 / 220），避开物品行进线
        for (let i = 0; i < 6; i++) {
          const gap = i % 4;
          const jitter = (Gfx.hash(i * 3.7 + 1) - 0.5) * 18;
          const x = 40 + gap * 60 + jitter;
          const base = 60 + Gfx.hash(i * 5.9 + 2) * (G.h - 130);
          const y = base + Math.sin(G.t * 0.55 + i * 1.7) * 7;   // 缓慢上下浮动
          const r = 9 + Gfx.hash(i * 7.1 + 3) * 8;
          const col = CANDY_LIST[(i + 2) % CANDY_LIST.length];
          ctx.save();
          ctx.globalAlpha = 0.10 + Gfx.hash(i * 2.3 + 0.5) * 0.035;
          Gfx.circlePath(ctx, r, x, y);
          ctx.fillStyle = col;
          ctx.fill();
          Gfx.circlePath(ctx, r, x, y);
          ctx.lineWidth = 2.2;
          ctx.strokeStyle = Gfx.shade(col, 0.45);   // 浅色描边（不是深描边）→ 不会被误读成物品
          ctx.stroke();
          ctx.globalAlpha *= 0.7;
          ellipsePath(ctx, x - r * 0.34, y - r * 0.36, r * 0.30, r * 0.19, -0.5);
          ctx.fillStyle = "#ffffff";
          ctx.fill();
          ctx.restore();
        }

        // ② 云朵：顶部两朵 + 底部一朵，纯白低透明（在通路之下，不干扰判读）
        cloud(ctx, G.w * 0.20, 40 + Math.sin(G.t * 0.4) * 3, 22, 0.11);
        cloud(ctx, G.w * 0.76, 76 + Math.sin(G.t * 0.34 + 1.4) * 3, 17, 0.09);
        cloud(ctx, G.w * 0.52, G.h - 88 + Math.sin(G.t * 0.3 + 2.6) * 4, 14, 0.08);
      },

      /** 通路：糖果胶条（大圆角竖向长条 + 斜向旋纹 + 左高光 / 右暗边） */
      lane: function (ctx, i, G) {
        const x = G.laneX(i);
        const half = G.m.laneHalf;        // 5：通路半宽
        const seg = G.m.laneSegment;      // 12：糖果旋纹节距
        const base = (i % 2 === 0) ? LANE_PINK : LANE_BLUE;   // 粉 / 蓝交替
        const deep = Gfx.shade(base, -0.30);

        // ① 右侧硬阴影层：偏移的实心同形（比 shadowBlur 更像黏土，也更省）
        Gfx.roundRect(ctx, x - half + 1.6, 2.0, half * 2, G.h, half);
        ctx.fillStyle = Gfx.rgba(CLAY_SHADOW, 0.16);
        ctx.fill();

        // ② 胶条主体：横向渐变（左受光 → 右压深），两端圆头由 r = half 天然给出
        Gfx.roundRect(ctx, x - half, 0, half * 2, G.h, half);
        ctx.fillStyle = Gfx.linearGradient(ctx, "clay:lane" + i, x - half, 0, x + half, 0, [
          [0, Gfx.shade(base, 0.30)],
          [0.42, base],
          [1, deep],
        ]);
        ctx.fill();

        // ③ 糖果旋纹：斜向条纹，clip 在胶条内 → 两端圆头保持干净
        //    性能取舍：全部白色条纹合成"一条路径 + 一次 fill"，深色衬线同理。
        //    条纹彼此不重叠（节距 seg=12 > 衬线总厚 bw+0.9=3.9），合批与逐条
        //    绘制的结果逐像素一致，但把每帧几十次光栅化压成 2 次，
        //    在中低端手机上这条通路目前是开销最大的一处。
        ctx.save();
        Gfx.roundRect(ctx, x - half, 0, half * 2, G.h, half);
        ctx.clip();
        const slant = 7;
        const bw = 3.0;
        ctx.beginPath();
        for (let y = -seg - slant; y < G.h + seg; y += seg) {
          ctx.moveTo(x - half, y);
          ctx.lineTo(x + half, y - slant);
          ctx.lineTo(x + half, y - slant + bw);
          ctx.lineTo(x - half, y + bw);
          ctx.closePath();
        }
        ctx.fillStyle = "rgba(255,255,255,0.50)";
        ctx.fill();
        // 条纹下缘的深色细线：让"糖纹"有厚度，而不是白线贴在平面上（同样合批）
        ctx.beginPath();
        for (let y = -seg - slant; y < G.h + seg; y += seg) {
          ctx.moveTo(x - half, y + bw);
          ctx.lineTo(x + half, y - slant + bw);
          ctx.lineTo(x + half, y - slant + bw + 0.9);
          ctx.lineTo(x - half, y + bw + 0.9);
          ctx.closePath();
        }
        ctx.fillStyle = Gfx.rgba(deep, 0.30);
        ctx.fill();
        ctx.restore();

        // ④ 左侧白色高光条 / 右侧暗边（胶条的体积感）
        clayBar(ctx, x - half + 0.7, 1.6, 1.7, G.h - 3.2, 0.85, "rgba(255,255,255,0.62)", null, 0);
        clayBar(ctx, x + half - 2.4, 1.6, 1.7, G.h - 3.2, 0.85, Gfx.rgba(deep, 0.5), null, 0);

        // ⑤ 厚实描边：黏土风格的骨架（内缩半个线宽，保证线不被裁掉）
        Gfx.roundRect(ctx, x - half + 0.7, 0.7, half * 2 - 1.4, G.h - 1.4, half - 0.7);
        ctx.lineWidth = 1.4;
        ctx.strokeStyle = G.p.laneEdge;
        ctx.stroke();
      },

      /** 桥：厚实黏土横条（底部厚边 + 顶部白色高光 + 悬停鼓起） */
      bridge: function (ctx, b, G, hovered) {
        const x1 = G.laneX(b.lanes[0]);
        const x2 = G.laneX(b.lanes[1]);
        const len = x2 - x1;
        const w = G.bridgeWidth;                       // 10
        // 悬停时"鼓起来"：高度视觉 ×1.15，中心不变（纯视觉，判定仍用 Config.bridgeWidth）
        const h = hovered ? w * 1.15 : w;
        const top = G.bridgeTop(b) - (h - w) / 2;
        const r = h / 2;                               // 大圆角 = 桥宽的一半
        const body = hovered ? Gfx.shade(BRIDGE_BODY, 0.10) : BRIDGE_BODY;

        ctx.save();
        ctx.translate(0, top);                         // 之后 y 都是"相对桥顶"的局部坐标
        // （渐变坐标固定为 0..h，key 不带坐标 → 一个 key 服务所有桥位）

        // ① 底部厚边：偏移的深粉实心圆角条，露在下方做出厚度
        Gfx.roundRect(ctx, x1 + 1.2, h * 0.30, len, h * 0.86, r);
        ctx.fillStyle = Gfx.rgba(Gfx.shade(BRIDGE_BOTTOM, -0.20), 0.50);
        ctx.fill();

        // ② 桥体：竖向渐变（上受光 / 下压深）
        Gfx.roundRect(ctx, x1, 0, len, h * 0.92, r * 0.92);
        ctx.fillStyle = Gfx.linearGradient(ctx, "clay:bridge" + (hovered ? ":h" : ""),
          0, 0, 0, h, [
            [0, Gfx.shade(body, 0.34)],
            [0.45, body],
            [1, BRIDGE_BOTTOM],
          ]);
        ctx.fill();

        // ③ 顶部白色高光条（黏土的上缘反光）
        Gfx.roundRect(ctx, x1 + h * 0.34, h * 0.13, len - h * 0.68, h * 0.20, h * 0.10);
        ctx.fillStyle = Gfx.rgba(BRIDGE_TOP, hovered ? 0.95 : 0.80);
        ctx.fill();

        // ④ 白色厚描边（悬停更亮更实）
        Gfx.roundRect(ctx, x1 + 0.8, 0.8, len - 1.6, h * 0.92 - 1.6, Math.max(0, r * 0.92 - 0.8));
        ctx.lineWidth = 1.6;
        ctx.strokeStyle = Gfx.rgba(G.p.bridgeEdge, hovered ? 1 : 0.85);
        ctx.stroke();

        // ⑤ 两端与通路的"接缝"（白色竖条）：黏土零件拼上去的接痕
        clayBar(ctx, x1 - 0.6, h * 0.06, 1.6, h * 0.82, 0.8, Gfx.rgba("#ffffff", 0.75), null, 0);
        clayBar(ctx, x2 - 1.0, h * 0.06, 1.6, h * 0.82, 0.8, Gfx.rgba("#ffffff", 0.75), null, 0);

        // ⑥ 悬停附加：两端小糖点（"可以点我"的提示）
        if (hovered) {
          ctx.globalAlpha = 0.9;
          Gfx.circlePath(ctx, h * 0.13, x1 + h * 0.24, h * 0.52);
          ctx.fillStyle = "#ffffff";
          ctx.fill();
          Gfx.circlePath(ctx, h * 0.13, x2 - h * 0.24, h * 0.52);
          ctx.fill();
        }
        ctx.restore();
      },

      /** 建桥预览：可建 → 半透明绿色圆角条 + 白色虚线；不可建 → 灰紫圆角条 */
      ghost: function (ctx, c, G) {
        const x1 = G.laneX(c.laneA);
        const x2 = G.laneX(c.laneB);
        const w = G.bridgeWidth;
        const top = c.y - w / 2;
        if (top < 0 || top + w > G.h) return;     // 越界不画（与兜底实现一致）

        const ok = c.legal;
        const fill = ok ? G.p.fx.ghostOk : G.p.fx.ghostBad;
        const line = ok ? G.p.fx.ghostOkLine : G.p.fx.ghostBadLine;
        const h = ok ? w * 0.94 : w * 0.86;       // 不可建时更"扁"，做出被压住的感觉
        const t = c.y - h / 2;

        Gfx.roundRect(ctx, x1, t, x2 - x1, h, h / 2);
        ctx.fillStyle = Gfx.rgba(fill, ok ? 0.30 : 0.22);
        ctx.fill();

        // 白色虚线：像一条"将要黏上去"的黏土条
        ctx.save();
        ctx.setLineDash([5, 3.5]);
        ctx.lineWidth = 1.4;
        ctx.strokeStyle = ok ? Gfx.rgba("#ffffff", 0.95) : Gfx.rgba(line, 0.55);
        Gfx.roundRect(ctx, x1 + 0.8, t + 0.8, x2 - x1 - 1.6, h - 1.6, Math.max(0, h / 2 - 0.8));
        ctx.stroke();
        ctx.restore();

        // 中线微光：提示这里就是桥位
        clayBar(ctx, x1 + 2.5, c.y - 0.5, x2 - x1 - 5, 1, 0.5, Gfx.rgba(line, ok ? 0.45 : 0.30), null, 0);
      },

      /** 仓库：糖果罐（罐体 + 白色罐口厚边 + 罐内的目标形状） */
      warehouse: function (ctx, i, G) {
        const x = G.laneX(i);
        const w = G.m.warehouseWidth;             // 44
        const h = G.m.warehouseHeight;            // 17
        const y0 = G.h;
        const r = h * 0.42;
        const frame = G.p.warehouseFrame;

        // ① 罐体投影：偏移的实心暗层（黏土硬阴影）
        Gfx.roundRect(ctx, x - w / 2 + 1.2, y0 + 1.8, w, h, r);
        ctx.fillStyle = "rgba(198,150,190,0.30)";
        ctx.fill();

        // ② 罐体：白玻璃 → 淡草莓奶（近不透明，保证罐内图标始终可读）
        Gfx.roundRect(ctx, x - w / 2, y0, w, h, r);
        ctx.fillStyle = Gfx.linearGradient(ctx, "clay:jar", 0, y0, 0, y0 + h, [
          [0, "rgba(255,255,255,0.97)"],
          [0.58, "rgba(255,243,250,0.95)"],
          [1, "rgba(255,214,234,0.94)"],
        ]);
        ctx.fill();

        // ③ 罐体描边（厚实黏土边）
        Gfx.roundRect(ctx, x - w / 2 + 1.3, y0 + 1.3, w - 2.6, h - 2.6, r - 1.3);
        ctx.lineWidth = 2.6;
        ctx.strokeStyle = frame;
        ctx.stroke();

        // ④ 左侧玻璃高光（画在图标之下，避免糊住形状）
        clayBar(ctx, x - w * 0.36, y0 + 6.2, 2.0, h * 0.42, 1.0, "rgba(255,255,255,0.85)", null, 0);

        // ⑤ 罐口厚边（白色高光）：窄窄一条压在罐口，仅与三角尖端有 ≤0.2 的重叠
        Gfx.roundRect(ctx, x - w / 2 - 1.6, y0 + 0.7, w + 3.2, 3.4, 1.7);
        ctx.fillStyle = "rgba(255,255,255,0.96)";
        ctx.fill();
        ctx.save();
        ctx.lineJoin = "round";
        ctx.lineWidth = 2;
        ctx.strokeStyle = frame;
        ctx.stroke();
        ctx.restore();

        // ⑥ 罐内目标形状：与物品同一套糖果色与形状语义（L1→A … L5→E）
        const type = Config.laneWarehouse[i];
        const col = G.p.itemColors[type] || CANDY.A;
        candyBlock(ctx, type, G.m.warehouseIconRadius, x, y0 + h * 0.60, col, false);
      },

      /** 物品：黏土糖块（形状 + 自身色 + 深色描边 + 偏移投影 + 左上高光；不标字母） */
      item: function (ctx, item, G) {
        const col = G.p.itemColors[item.type] || CANDY.A;
        candyBlock(ctx, item.type, G.m.itemRadius, item.x, item.y, col, true);
      },

      /** 世界空间最上层：极淡暗角 + 顶部一点点糖霜（别发灰，保持通透） */
      overlay: function (ctx, G) {
        // 内半径给得很大 → 中央完全干净，只把最外圈轻轻压一点（最深 ~0.10，仍是粉紫不是灰）
        ctx.fillStyle = Gfx.radialGradient(ctx, "clay:vignette:" + G.w + "x" + G.h,
          G.w / 2, G.h / 2, G.h * 0.30, G.h * 0.64, [
            [0, Gfx.rgba(VIGNETTE_TINT, 0)],
            [1, Gfx.rgba(VIGNETTE_TINT, 0.13)],
          ]);
        ctx.fillRect(0, 0, G.w, G.h);

        ctx.fillStyle = Gfx.linearGradient(ctx, "clay:frost:" + G.h, 0, 0, 0, 40, [
          [0, "rgba(255,255,255,0.10)"],
          [1, "rgba(255,255,255,0)"],
        ]);
        ctx.fillRect(0, 0, G.w, 40);
      },

      /** 特效：build / flash / shake / deliver / damage，全部走"黏土挤压回弹"语言 */
      fx: function (ctx, type, f, a, prog, G, vp) {
        if (type === "build") {
          // 挤压回弹：宽度由中心弹出并轻微过冲，同时"刚拍上去"时更胖，随后压回
          const cx = (f.x1 + f.x2) / 2;
          const half = (f.x2 - f.x1) / 2;
          const w = G.bridgeWidth;
          const t = Gfx.clamp(prog / 0.62, 0, 1);
          const hw = Math.max(0.6, half * Gfx.easeBack(t, 2.0));
          const h = w * 0.96 * (1 + 0.30 * (1 - t));
          const top = f.y - h / 2;

          Gfx.roundRect(ctx, cx - hw, top, hw * 2, h, h / 2);
          ctx.fillStyle = Gfx.rgba(G.p.fx.build, a * 0.85);
          ctx.fill();
          ctx.save();
          ctx.lineJoin = "round";
          ctx.lineWidth = 1.6;
          ctx.strokeStyle = Gfx.rgba("#ffffff", a * 0.9);
          ctx.stroke();
          ctx.restore();

          // 白色高光从左扫到右
          const sx = cx - hw + 2 * hw * Gfx.easeOut(t);
          clayBar(ctx, sx - 3, top + h * 0.16, 6, h * 0.32, 3,
            Gfx.rgba("#ffffff", a * 0.70 * (1 - t * 0.35)), null, 0);
          return;
        }

        if (type === "flash") {
          const top = f.y - G.bridgeWidth / 2;
          // 粉白一闪：外圈粉色晕 + 内部纯白（都不用 shadowBlur）
          Gfx.roundRect(ctx, f.x1 - 1.5, top - 1.5, f.x2 - f.x1 + 3, G.bridgeWidth + 3,
            (G.bridgeWidth + 3) / 2);
          ctx.fillStyle = Gfx.rgba(G.p.fx.flash, a * 0.30);
          ctx.fill();
          Gfx.roundRect(ctx, f.x1, top, f.x2 - f.x1, G.bridgeWidth, G.bridgeWidth / 2);
          ctx.fillStyle = Gfx.rgba("#ffffff", a * 0.80);
          ctx.fill();
          return;
        }

        if (type === "shake") {
          // 果冻抖动：整条桥左右 sin 衰减，纵向与高度也轻微跟着晃（"捏住一块软糖"）
          const dx = Math.sin(prog * 46) * 3.6 * a;
          const dy = Math.sin(prog * 58 + 1.3) * 1.1 * a;
          const w = G.bridgeWidth * (1 + 0.10 * Math.sin(prog * 52));
          const cy = f.y + dy;
          Gfx.roundRect(ctx, f.x1 + dx, cy - w / 2, f.x2 - f.x1, w, w / 2);
          ctx.fillStyle = Gfx.rgba(G.p.fx.shake, a * 0.42);
          ctx.fill();
          ctx.save();
          ctx.lineJoin = "round";
          ctx.lineWidth = 1.8;
          ctx.strokeStyle = Gfx.rgba(Gfx.shade(G.p.fx.shake, -0.25), a * 0.85);
          ctx.stroke();
          ctx.restore();
          // 两端小糖点：像"卡住了"的提示
          ctx.save();
          ctx.globalAlpha = a * 0.9;
          Gfx.circlePath(ctx, 1.5, f.x1 + 3.2 + dx, cy);
          ctx.fillStyle = G.p.fx.shake;
          ctx.fill();
          Gfx.circlePath(ctx, 1.5, f.x2 - 3.2 + dx, cy);
          ctx.fill();
          ctx.restore();
          return;
        }

        if (type === "deliver") {
          const y = f.y - Gfx.easeOut(Gfx.clamp(prog, 0, 1)) * 34;
          if (f.ok) {
            // 圆润 "+1"：深色描边 + 糖果色填充，保证在任何浅底上都读得清
            ctx.save();
            ctx.font = G.font.canvas;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.lineJoin = "round";
            ctx.lineWidth = 3.2;
            ctx.strokeStyle = Gfx.rgba(Gfx.shade(G.p.fx.plusText, -0.55), Math.min(1, a * 2));
            ctx.strokeText("+1", f.x, y);
            ctx.fillStyle = Gfx.rgba(G.p.fx.plusText, Math.min(1, a * 2.4));
            ctx.fillText("+1", f.x, y);
            ctx.restore();

            // 彩色纸屑：确定性角度 + 轻微重力下坠（不逐帧闪烁）
            for (let k = 0; k < 6; k++) {
              const seed = k * 5.3 + 1.7;
              const ang = Gfx.hash(seed) * Math.PI * 2;
              const d = (12 + Gfx.hash(seed + 0.7) * 16) * prog;
              const px = f.x + Math.cos(ang) * d;
              const py = y + Math.sin(ang) * d * 0.8 + prog * prog * 26;
              const sz = 2.2 + Gfx.hash(seed + 2.1) * 1.6;
              ctx.save();
              ctx.translate(px, py);
              ctx.rotate(prog * (3 + Gfx.hash(seed + 1.3) * 4));
              ctx.globalAlpha = a * 0.95;
              Gfx.roundRect(ctx, -sz / 2, -sz / 2, sz, sz, sz * 0.32);
              ctx.fillStyle = CANDY_LIST[k % CANDY_LIST.length];
              ctx.fill();
              ctx.restore();
            }

            // 上浮的小气泡（糖果罐里冒出来的一颗）
            Gfx.circlePath(ctx, 3.0 + prog * 1.4, f.x + 7, y + 9 - prog * 12);
            ctx.fillStyle = Gfx.rgba("#ffffff", a * 0.55);
            ctx.fill();
            ctx.lineWidth = 1;
            ctx.strokeStyle = Gfx.rgba(G.p.fx.plusParticle, a * 0.65);
            ctx.stroke();
          } else {
            // 投错：灰色圆角团"噗"一下散开
            const rad = 6 + prog * 16;
            ctx.save();
            ctx.globalAlpha = a * 0.55;
            for (let k = 0; k < 5; k++) {
              const ang = (k / 5) * Math.PI * 2 + prog * 1.6;
              const dd = 2 + prog * 12;
              Gfx.roundRect(ctx,
                f.x + Math.cos(ang) * dd - rad * 0.34,
                f.y - 3 + Math.sin(ang) * dd * 0.6 - rad * 0.34,
                rad * 0.68, rad * 0.68, rad * 0.30);
              ctx.fillStyle = (k % 2) ? G.p.fx.ghostBad : Gfx.shade(G.p.fx.ghostBad, -0.12);
              ctx.fill();
            }
            ctx.restore();
          }
          return;
        }

        if (type === "damage") {
          // 全屏粉色淡染 + 圆角粗边框（屏幕空间，用 vp 的 CSS 尺寸）
          const W = (vp && vp.cssW) || G.w;
          const H = (vp && vp.cssH) || G.h;
          ctx.fillStyle = Gfx.rgba(G.p.fx.damageOverlay, a * 0.20);
          ctx.fillRect(0, 0, W, H);

          const inset = 7;
          const fw = 6;
          ctx.save();
          ctx.lineJoin = "round";
          ctx.lineWidth = fw;
          ctx.strokeStyle = Gfx.rgba(G.p.fx.damageFrame, a * 0.90);
          Gfx.roundRect(ctx, inset, inset, W - inset * 2, H - inset * 2, 18);
          ctx.stroke();
          ctx.restore();

          // 四角碎糖：掉血时画面边缘"掉渣"
          ctx.save();
          ctx.globalAlpha = a * 0.85;
          for (let k = 0; k < 4; k++) {
            const cx = (k % 2 === 0) ? inset + 16 : W - inset - 16;
            const cy = (k < 2 ? inset + 16 : H - inset - 16);
            Gfx.roundRect(ctx, cx - 3, cy - 3, 6, 6, 2);
            ctx.fillStyle = CANDY_LIST[k % CANDY_LIST.length];
            ctx.fill();
          }
          ctx.restore();
        }
      },

      /** 通路标签：糖果药丸底 + 深紫字 "L1".."L5"（屏幕空间） */
      laneLabel: function (ctx, i, sx, sy, G) {
        const w = 34;
        const h = 18;
        const r = 9;

        // 胶囊的硬阴影 + 白色药丸底 + 粉紫描边
        clayBar(ctx, sx - w / 2 + 0.8, sy - h / 2 + 1.6, w, h, r,
          "rgba(206,160,200,0.32)", null, 0);
        clayBar(ctx, sx - w / 2, sy - h / 2, w, h, r,
          "rgba(255,255,255,0.94)", G.p.panelBorder, 1.6);
        // 药丸上缘高光
        clayBar(ctx, sx - w / 2 + 3.4, sy - h / 2 + 2.2, w - 6.8, 3.2, 1.6,
          "rgba(255,255,255,0.90)", null, 0);
        // 左侧糖果圆点：与 L1→A … L5→E 的仓库目标一一对应
        Gfx.circlePath(ctx, 2.4, sx - w / 2 + 6.0, sy + 0.4);
        ctx.fillStyle = CANDY_LIST[i % CANDY_LIST.length];
        ctx.fill();
        ctx.lineWidth = 1;
        ctx.strokeStyle = outlineOf(CANDY_LIST[i % CANDY_LIST.length]);
        ctx.stroke();

        ctx.font = G.font.canvas;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = G.p.textBright;
        ctx.fillText("L" + (i + 1), sx + 2.6, sy + 0.5);
      },

      /** 屏幕空间最上层：极淡暗角 + 少量确定性星光（缓慢呼吸） */
      screenOverlay: function (ctx, vp, G) {
        const W = vp.cssW;
        const H = vp.cssH;

        ctx.fillStyle = Gfx.radialGradient(ctx, "clay:screen:" + W + "x" + H,
          W / 2, H / 2, Math.min(W, H) * 0.45, Math.max(W, H) * 0.80, [
            [0, Gfx.rgba(VIGNETTE_TINT, 0)],
            [1, Gfx.rgba(VIGNETTE_TINT, 0.10)],
          ]);
        ctx.fillRect(0, 0, W, H);

        for (let k = 0; k < 12; k++) {
          const x = Gfx.hash(k * 2.7 + 1) * W;
          const y = Gfx.hash(k * 4.1 + 5) * H;
          const ph = Gfx.hash(k * 6.3 + 9) * 6.28;
          const tw = 0.5 + 0.5 * Math.sin(G.t * 0.7 + ph);   // 呼吸
          const r = (1.6 + Gfx.hash(k * 8.9 + 3) * 2.4) * (0.7 + tw * 0.5);
          sparklePath(ctx, x, y, r);
          ctx.fillStyle = Gfx.rgba("#ffffff", 0.06 + tw * 0.12);
          ctx.fill();
        }
      },
    },
  });
})();
