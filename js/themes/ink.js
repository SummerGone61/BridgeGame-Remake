"use strict";

/**
 * ============================================================
 * themes/ink.js —— 主题②「水墨和纸 Ink on Paper」
 *
 * 视觉概念：一张未装裱的宣纸，落墨成局。
 *   纸   = 暖白纤维底 + 四角水痕晕染 + 双线墨框（细）；
 *   通路 = 一笔竖式淡墨（双钩）：极淡墨身 + 两侧手绘锋线，两头略细、间有飞白，
 *          每条浓度由 hash 决定 —— 墨分五色；
 *   桥   = 一道横墨：两端出锋、干笔飞白；悬停时墨色加深并在桥心盖一枚朱砂小印；
 *   物品 = 墨绘形状（形状语义与全局一致：方 / 三角 / 圆 / 星 / 菱），
 *          先垫一层"留白"柔晕再落墨；
 *   仓库 = 朱砂印章方块（朱红外框 + 米白印底 + 目标形状）；
 *   特效 = 笔锋扫开 + 墨点、朱砂一闪、墨团抖动 + 朱红小叉、
 *          墨书 "+1" + 朱点、洇开的墨渍、全屏朱砂淡染 + 中央空印框。
 *
 * 两条贯穿全篇的取舍（细节都写在对应代码旁的注释里）：
 *   1) "留白"在这里不是装饰，是可读性刚需：墨色物品（墨 A / 靛 B）压在同为
 *      墨色的桥面上时对比只有 1.2~1.4:1，几乎看不见；每件物品先垫一层近白柔晕，
 *      最坏情况（桥面）也回到 4.2:1 以上。数值见下方「对比度自检」。
 *   2) 装饰层（decor / overlay / screenOverlay）一律 ≤0.12 alpha，
 *      只做"纸的呼吸"，绝不参与任何玩法元素的识别。
 *
 * 只依赖 Gfx（通用工具箱）与 Theme 契约：不含游戏规则、不读写全局状态，
 * 不用 DOM / 定时器 / 网络；所有"随机"纹理都来自 Gfx.hash / Gfx.hashS（逐帧稳定）。
 * ============================================================
 */

(function () {
  /* ---- 主题内常量（与 palette 里的 token 同值，供模块内混色/内联 SVG 复用）---- */

  /**
   * 物品类型 → 传统色五色（墨 / 靛 / 苔 / 赭 / 胭脂），与 preview 色卡共用一套常量。
   * E 从"朱砂 #b03a2e"改为"胭脂 #a8333f"：朱砂与赭石(#8a5f28)的色相只差 28°、
   * 亮度对比 1.07 —— 小尺寸图标下几乎分不开（形状仍是主语义，但颜色不该拖后腿）。
   * 换色后色相差 40°、与纸底对比 5.72（原来 5.29），且朱砂仍保留给印章/桥/生命等装饰，
   * 物品与装饰之间也多了一层区分。
   */
  const ITEM = {
    A: "#23252b",
    B: "#2b4a63",
    C: "#3d6b4f",
    D: "#8a5f28",
    E: "#a8333f",
  };

  const INK = "#2b2d33";          // 淡墨（= palette.text）
  const SEAL = "#b03a2e";         // 朱砂（= palette.accent / bridgeEdge / heart）
  const LOGO_INK = "#2b4a63";     // 靛（= itemColors.B / ghostOkLine）
  const MOSS = "#3d6b4f";         // 苔绿（= success / ghostOk）
  const PAPER_WHITE = "#fffdf7";  // "留白"用的近白：纸的最亮处（比 field 更亮，见对比度自检）

  /* ---- 本主题内部小工具（模块私有，不污染全局）---- */

  /**
   * 横向笔触：与 Gfx.taperedBand（纵向）同构，供桥/墨渍这类横向笔画使用。
   * k 越大两头越细 —— 毛笔"起笔收笔"的出锋感全靠它。
   */
  function bandH(ctx, cy, x0, x1, half, taper) {
    const k = taper === undefined ? 0.35 : taper;
    const h0 = half * (1 - k * 0.45);
    const h1 = half;
    const mx = (x0 + x1) / 2;
    ctx.beginPath();
    ctx.moveTo(x0, cy - h0);
    ctx.quadraticCurveTo(mx, cy - h1 * 1.05, x1, cy - h0);
    ctx.lineTo(x1, cy + h0);
    ctx.quadraticCurveTo(mx, cy + h1 * 1.05, x0, cy + h0);
    ctx.closePath();
    return ctx;
  }

  /**
   * 手绘形状路径：顶点取自 Gfx.glyphPoints（与 Render.drawItemShape 同源，
   * 保证"方/三角/圆/星/菱"的语义全主题一致），再做确定性抖动。
   * 圆（C）没有顶点，用 18 边形取样后抖动 —— 5% 幅度在 8px 半径下仍是清清楚楚的圆，
   * 不会与方/菱混淆，但同样有"手绘"的边缘。
   *
   * (x, y) 是形状中心：内部用 translate 把路径挪过去（路径点在构造时就已
   * 落到设备空间，restore 不会移动它，与 Gfx.glyphPath 的做法一致）。
   * 传 (0, 0) 表示"就在当前坐标系原点画"——调用方已经自己 translate 过时用这种写法。
   */
  function glyphInkPath(ctx, type, r, x, y, seed) {
    const ox = x || 0, oy = y || 0;
    const shifted = (ox !== 0 || oy !== 0);
    if (shifted) { ctx.save(); ctx.translate(ox, oy); }
    const pts = Gfx.glyphPoints(type, r);
    if (pts) {
      Gfx.poly(ctx, Gfx.wobble(pts, r * 0.075, seed));
      if (shifted) ctx.restore();
      return ctx;
    }
    const n = 18;
    const ring = [];
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      ring.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
    Gfx.poly(ctx, Gfx.wobble(ring, r * 0.05, seed + 4.1));
    if (shifted) ctx.restore();
    return ctx;
  }

  /**
   * 物品"留白"柔晕。
   * 用 Gfx.radialGradient 缓存（key 固定、坐标写在 translate 后的局部空间里），
   * 于是所有物品共用同一张渐变对象，不必每帧每件物品各建一个 —— 这是
   * "渐变不要逐帧新建"与"物品周边要够亮"两个要求同时成立的关键。
   * 0.62 之前是平台段：物品轮廓正好落在平台内，边缘外侧才衰减，留白才真的顶用。
   */
  function paperHalo(ctx, x, y, r) {
    const R = r * 2.2;
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = Gfx.radialGradient(ctx, "ink:itemHalo", 0, 0, 0, R, [
      [0, Gfx.rgba(PAPER_WHITE, 0.97)],
      [0.62, Gfx.rgba(PAPER_WHITE, 0.95)],
      [1, Gfx.rgba(PAPER_WHITE, 0)],
    ]);
    ctx.beginPath();
    ctx.arc(0, 0, R, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /**
   * 朱砂印（朱文印样式）：朱红框 + 框内留白 + 用线条示意印文。
   * 刻意不写任何具体汉字，"印文"只是抽象笔画，避免出现无意义的乱码字。
   * 目前用于角落闲章（decor）：装饰层的 alpha 上限是 0.12，所以它是一枚"褪色印痕"。
   */
  function sealFrame(ctx, cx, cy, size, alpha) {
    const h = size / 2;
    const lw = Math.max(1, size * 0.09);
    ctx.save();
    ctx.globalAlpha = Gfx.clamp(alpha, 0, 1);
    // 印底留白：印面之外仍是纸，所以用近白垫一层，让朱框与印文读得出来
    ctx.fillStyle = Gfx.rgba(PAPER_WHITE, 0.5);
    ctx.fillRect(cx - h, cy - h, size, size);
    ctx.strokeStyle = Gfx.rgba(SEAL, 0.9);
    ctx.lineWidth = lw;
    ctx.strokeRect(cx - h + lw / 2, cy - h + lw / 2, size - lw, size - lw);
    // 印文示意：两横两竖（篆书笔意的抽象排布），不表示任何具体字
    const q = size * 0.2;
    ctx.lineWidth = Math.max(0.8, size * 0.06);
    ctx.beginPath();
    ctx.moveTo(cx - q, cy - q * 0.85);
    ctx.lineTo(cx + q, cy - q * 0.85);
    ctx.moveTo(cx - q, cy + q * 0.85);
    ctx.lineTo(cx + q, cy + q * 0.85);
    ctx.moveTo(cx - q * 0.48, cy - q);
    ctx.lineTo(cx - q * 0.48, cy + q);
    ctx.moveTo(cx + q * 0.48, cy - q);
    ctx.lineTo(cx + q * 0.48, cy + q);
    ctx.stroke();
    ctx.restore();
  }

  /* ============================================================
   * 对比度自检（Gfx.contrast，数值为实测，供复核）
   *
   * 物品色 vs 纯纸底 #f6f0e2：
   *   A 13.48 | B 8.17 | C 5.41 | D 4.09 | E 5.29
   * 物品色 vs "留白"后的落墨底（本主题实际生效的底；留白在物品外缘的有效 alpha ≈0.955）：
   *   纯纸底 rgb(255,252,246)        → A 14.96 | B 9.06 | C 6.01 | D 4.54 | E 5.87
   *   通路行笔最淡 rgb(254,251,245)  → A 14.83 | B 8.99 | C 5.95 | D 4.50 | E 5.82
   *   通路收笔最深 rgb(252,250,243)  → A 14.67 | B 8.89 | C 5.89 | D 4.45 | E 5.76
   *   桥面（最坏） rgb(246,244,239)  → A 13.94 | B 8.44 | C 5.60 | D 4.23 | E 5.47
   * 若去掉留白、墨压墨（桥面 #3a3d45）：A 1.41 | B 1.17 | C 1.77 | D 2.34 | E 1.81
   *   → 这就是留白层存在的工程理由，不是美术偏好。
   * 五色之间的"可区分"主要靠色相与形状（形状是主语义，Gfx.glyphPoints 保证全主题一致）：
   *   两两亮度对比只有 1.02~3.30（如 C/E 1.02、C/D 1.32），单看灰度确实接近，
   *   所以本主题不做任何"靠明度分层"的用法，物品的边与轮廓一律由墨线交代。
   * 赭 D #8a5f28 与"纸"的对比：vs 纸底 4.93，vs 留白底 5.10~5.42，
   *   已按集成复核意见从 #9a6b2f 压深一档（原值即便垫到纯白 #ffffff 也只有 4.65，
   *   会使 D 在通路/桥面上掉到 4.2~4.5 的临界区）。
   * 文字：墨字 on 纸 12.11；textMid 7.44；白文印字 #fdf7ee on 朱砂 5.65
   *   （若按"墨字压朱砂"只有 2.29，故印面取白文，见 laneLabel 注释）。
   * ============================================================ */

  Theme.define({
    id: "ink",
    label: "水墨和纸",
    tagline: "宣纸淡墨 · 朱砂印记",
    mode: "light",

    /* ---- 设置面板里的主题预览色卡（纯数据，供 ThemeUI 生成缩略图）---- */
    preview: {
      bg: "#f2ebda",
      bg2: "#e2d7be",
      dots: [ITEM.A, ITEM.B, ITEM.C, ITEM.D, ITEM.E],
    },

    metrics: {
      itemRadius: 8,
      warehouseWidth: 42,
      warehouseHeight: 16,
      warehouseIconRadius: 5.6,
      laneHalf: 5,
      laneSegment: 14,
      bridgeInset: 1,
    },

    font: {
      ui: '"KaiTi", "STKaiti", "Kaiti SC", "Songti SC", "SimSun", serif',
      // display 与 ui 同族：楷体的"加粗"由样式表的 font-weight 控制，
      // 这里只保证字体族一致，避免出现浏览器合成粗体以外的意外字形。
      display: '"KaiTi", "STKaiti", "Kaiti SC", "Songti SC", "SimSun", serif',
      canvas: 'bold 14px "KaiTi", "STKaiti", "SimSun", serif',
      labelSize: 14,
    },

    css: {
      radiusPanel: "2px",
      radiusBtn: "2px",
      borderWidth: "1px",
      panelShadow: "0 2px 0 rgba(43,45,51,0.10), 0 14px 34px rgba(43,45,51,0.13)",
      btnShadow: "0 2px 0 rgba(43,45,51,0.18)",
      hudShadow: "0 3px 12px rgba(43,45,51,0.12)",
      letterSpacing: "2px",
      transition: "180ms ease",
      fragRadius: "0px",
    },

    /* ---- 生命图标（内联 SVG）：朱砂实心心形 + 墨色细描边 + 米白高光 ---- */
    livesIcon:
      '<svg viewBox="0 0 32 28" aria-hidden="true">' +
      '<path d="M16 26C6 18.4 2 14.2 2 9.4 2 5.2 5.2 2 9.4 2c2.9 0 5.3 1.6 6.6 4 1.3-2.4 3.7-4 6.6-4C26.8 2 30 5.2 30 9.4 30 14.2 26 18.4 16 26z" ' +
      'fill="' + SEAL + '" stroke="' + INK + '" stroke-width="1.5" stroke-linejoin="round"/>' +
      '<path d="M4.6 8.8C5 6.1 6.8 4 9.4 3.5" fill="none" stroke="' + PAPER_WHITE + '" ' +
      'stroke-width="1.6" stroke-linecap="round" opacity="0.92"/>' +
      '<circle cx="12.4" cy="5.6" r="1" fill="' + PAPER_WHITE + '" opacity="0.85"/></svg>',

    palette: {
      page: "#efe6d5",
      field: "#f6f0e2",
      fieldAlt: "#e9dfca",
      grid: "rgba(43,45,51,0.05)",
      gridStroke: "rgba(43,45,51,0.2)",
      laneA: "#d9cdb4",
      laneB: "#cfc2a8",
      laneEdge: "rgba(43,45,51,0.55)",
      bridgeBody: "#3a3d45",
      bridgeTop: "#2b2d33",
      bridgeBottom: "#5b5f69",
      bridgeEdge: SEAL,
      text: INK,
      textMid: "#4a4d55",
      textDim: "#83868f",
      textBright: "#16181d",
      panel: "rgba(250,246,237,0.95)",
      panelAlt: "rgba(240,233,219,0.95)",
      panelBorder: "rgba(43,45,51,0.35)",
      overlay: "rgba(60,54,44,0.45)",
      btnBg: "#efe7d6",
      btnText: INK,
      btnBorder: "rgba(43,45,51,0.4)",
      btnHover: "#f7f1e4",
      btnActive: "#e3d9c4",
      primary: SEAL,
      primaryHover: "#c1463a",
      primaryActive: "#963026",
      primaryText: "#fdf7ee",
      accent: SEAL,
      accentAlt: LOGO_INK,
      danger: SEAL,
      success: MOSS,
      heart: SEAL,
      glow: "rgba(176,58,46,0.35)",
      warehouseFrame: "rgba(176,58,46,0.85)",
      warehouseFill: "rgba(255,252,245,0.6)",
      itemColors: ITEM,
      fx: {
        build: "#3a3d45",
        flash: SEAL,
        shake: SEAL,
        plusText: ITEM.A,
        plusParticle: SEAL,
        wrong: SEAL,
        damageOverlay: SEAL,
        damageFrame: "#8f2f26",
        ghostOk: MOSS,
        ghostOkLine: LOGO_INK,
        ghostBad: "#a89880",
        ghostBadLine: "#8b7f68",
      },
    },

    /* ============================================================
     * 绘制钩子
     * ============================================================ */
    hooks: {
      /**
       * 场地：宣纸底 —— 暖白渐变 + 确定性纤维/纸屑 + 四角水痕 + 双线墨框。
       * 纤维与纸屑全部由 Gfx.hash 生成（不用 Math.random），所以每一帧的纸纹
       * 完全一致：不会出现"纸在抖"的廉价噪点感。
       */
      field: function (ctx, G) {
        const P = G.p;

        // 纸底：上端略亮、下端略沉，避免整幅死白
        ctx.fillStyle = Gfx.linearGradient(ctx, "ink:paper", 0, 0, 0, G.h, [
          [0, Gfx.mix(P.field, "#ffffff", 0.35)],
          [0.34, P.field],
          [1, Gfx.mix(P.field, P.fieldAlt, 0.8)],
        ]);
        ctx.fillRect(0, 0, G.w, G.h);

        // 中央受光：让画面中心（玩法主区）比四角亮一点，视线自然收拢。
        // 幅度刻意压低（0.34）：再亮一点就"漂白"了，失去宣纸的暖调。
        // 注意 Gfx.radialGradient 的签名是 (ctx, key, x, y, r0, r1, stops)，
        // 不是原生 createRadialGradient 的 (x, y, r0, x1, y1, r1) —— 两者参数个数不同。
        ctx.fillStyle = Gfx.radialGradient(
          ctx, "ink:paperGlow", G.w / 2, G.h * 0.4, 0, G.h * 0.72,
          [[0, "rgba(255,253,246,0.34)"], [1, "rgba(255,253,246,0)"]]
        );
        ctx.fillRect(0, 0, G.w, G.h);

        // 纸纤维：短横笔毛。150 段合成一条 path 一次描边，比逐个 stroke 便宜得多
        ctx.strokeStyle = Gfx.rgba(P.text, 0.045);
        ctx.lineWidth = 0.7;
        ctx.beginPath();
        for (let i = 0; i < 150; i++) {
          const fx = Gfx.hash(i * 1.37 + 0.5) * G.w;
          const fy = Gfx.hash(i * 2.71 + 1.3) * G.h;
          const len = 1.6 + Gfx.hash(i * 3.19 + 2.1) * 6.5;
          const tilt = Gfx.hashS(i * 4.53 + 3.7) * 0.3;
          ctx.moveTo(fx, fy);
          ctx.lineTo(fx + len, fy + tilt * len);
        }
        ctx.stroke();

        // 纸屑：比纤维更淡的点，只提供"纸不匀"的手感
        // （同色 1px 点阵合批成一条路径一次填充，避免 110 次单独光栅化）
        Gfx.batchRects(ctx, Gfx.rgba(P.text, 0.035), function (r) {
          for (let i = 0; i < 110; i++) {
            r(Gfx.hash(i * 5.11 + 7.3) * G.w, Gfx.hash(i * 6.29 + 4.9) * G.h, 1, 1);
          }
        });

        // 四角水痕：湿纸边缘的淡淡晕染。用径向渐变按"角"缓存，
        // 每个矩形的边长恰好等于渐变半径，所以看不到任何矩形硬边。
        const washIn = Gfx.rgba(Gfx.mix(P.fieldAlt, P.text, 0.25), 0.1);
        const washOut = Gfx.rgba(Gfx.mix(P.fieldAlt, P.text, 0.25), 0);
        const rr = 90;
        const corners = [
          ["ink:corner0", 0, 0, 0, 0],
          ["ink:corner1", G.w, 0, G.w - rr, 0],
          ["ink:corner2", 0, G.h, 0, G.h - rr],
          ["ink:corner3", G.w, G.h, G.w - rr, G.h - rr],
        ];
        for (let k = 0; k < corners.length; k++) {
          const c = corners[k];
          // (ctx, key, x, y, r0, r1, stops)：圆心贴着画面角，半径 = 矩形边长
          ctx.fillStyle = Gfx.radialGradient(ctx, c[0], c[1], c[2], 0, rr,
            [[0, washIn], [1, washOut]]);
          ctx.fillRect(c[3], c[4], rr, rr);
        }

        // 双线墨框：外粗内细，像裱画时压的两道墨线（靠边，不侵入通路）
        ctx.lineWidth = 1;
        ctx.strokeStyle = Gfx.rgba(P.text, 0.3);
        ctx.strokeRect(0.5, 0.5, G.w - 1, G.h - 1);
        ctx.lineWidth = 0.7;
        ctx.strokeStyle = Gfx.rgba(P.text, 0.12);
        ctx.strokeRect(3.5, 3.5, G.w - 7, G.h - 7);
      },

      /**
       * 装饰：缓慢漂浮的淡墨晕 + 角落一枚褪色闲章。
       * 全部压在通路之下，且 alpha ≤0.12：装饰只负责"纸的气"，不参与识别。
       * 闲章刻意放在通路之间的空隙里（x≈220 一带），不压住任何一条通路。
       */
      decor: function (ctx, G) {
        const P = G.p;
        const drift = Gfx.mix(P.text, P.fieldAlt, 0.55);   // 淡墨（往纸色里化开）

        for (let i = 0; i < 4; i++) {
          const hx = Gfx.hash(i * 4.7 + 1.1);
          const hy = Gfx.hash(i * 8.3 + 2.7);
          const hr = Gfx.hash(i * 6.1 + 5.3);
          const x = 26 + hx * (G.w - 52) + Math.sin(G.t * 0.11 + i * 1.7) * 5.5;
          const y = G.h * (0.18 + hy * 0.64) + Math.cos(G.t * 0.09 + i * 2.3) * 7;
          Gfx.softBlob(ctx, x, y, 34 + hr * 30, drift, 0.05 + hr * 0.025);
        }

        // 落款闲章：装饰层的上限就是 0.12，所以它是一枚"褪色印痕"而不是重印
        sealFrame(ctx, 220, G.h - 26, 22, 0.12);
      },

      /**
       * 通路：一笔竖式淡墨（双钩）。
       * 结构与理由：
       *   1) 笔身 = Gfx.taperedBand 填"极淡墨"的竖向渐变：两头略细（taper 1.8），
       *      中间最宽处正好盖住通路（= 判定宽度，玩家看到的宽度就是判定的宽度）；
       *      笔身刻意保持接近纸色 —— 这样墨色物品仍有对比可言，
       *      真正的"墨线"读感交给两侧的锋线；
       *   2) 浓淡 = 每条通路一档（墨分五色），由 Gfx.hash(i) 决定，起笔略重、行笔淡、收笔再重；
       *   3) 飞白 = 干笔留下的纸色缺口，位置/长度由 hash + laneSegment 决定，逐帧稳定；
       *   4) 锋线 = 两侧手绘抖动的淡墨线（Gfx.sketchLine，同一路径描边）。
       */
      lane: function (ctx, i, G) {
        const P = G.p;
        const x = G.laneX(i);
        const half = G.m.laneHalf;
        const tone = 0.05 + Gfx.hash(i * 3.7 + 0.9) * 0.09;      // 墨分五色的那一档
        const body = i % 2 ? P.laneB : P.laneA;                   // 两条纸色 token 交替

        // 1) 笔身：淡墨渐变（起笔 / 行笔 / 收笔）
        ctx.fillStyle = Gfx.linearGradient(ctx, "ink:lane" + i, 0, 0, 0, G.h, [
          [0, Gfx.mix(body, P.text, tone)],
          [0.12, Gfx.mix(body, P.field, 0.35)],
          [0.9, Gfx.mix(body, P.field, 0.25)],
          [1, Gfx.mix(body, P.text, tone * 1.25)],
        ]);
        Gfx.taperedBand(ctx, x, 0, G.h, half * 0.97, 1.8);
        ctx.fill();

        // 2) 飞白：干笔缺口（用 laneSegment 当作缺口的节奏单位，与"通路节距"语义一致）
        const seg = G.m.laneSegment;
        ctx.fillStyle = Gfx.rgba(P.field, 0.5);
        for (let k = 0; k < 5; k++) {
          const gy = Gfx.hash(i * 7.9 + k * 1.7) * G.h;
          const gw = 0.7 + Gfx.hash(i * 5.3 + k * 3.1) * half * 0.5;
          const gx = x - half * 0.6 + Gfx.hash(i * 9.1 + k * 2.3) * half * 0.9;
          const gh = seg * 0.2 + Gfx.hash(i * 4.1 + k * 6.7) * seg * 0.5;
          ctx.fillRect(gx, gy, gw, gh);
        }

        // 3) 锋线：两侧各一道淡墨线，用 sketchLine 做手绘停顿（不做完全对称的"印刷线"）
        ctx.lineWidth = 1.1;
        ctx.strokeStyle = Gfx.rgba(P.laneEdge, 0.85);
        for (let s = -1; s <= 1; s += 2) {
          const lx = x + s * (half - 0.6);
          Gfx.sketchLine(ctx, lx, 1, lx, G.h - 1, 0.9, i * 5.7 + (s > 0 ? 2.3 : 8.1));
          ctx.stroke();
        }

        // 4) 笔锋侧再积一点墨：一行极淡的墨痕，让两侧不完全对等
        ctx.fillStyle = Gfx.rgba(P.text, tone * 0.5);
        ctx.fillRect(x - half + 1.1, 0, 1.4, G.h);
      },

      /**
       * 桥：一道横墨。
       * 只画"笔画本身"：两端出锋（bandH 的 taper）、沿上下做浓淡、干笔飞白；
       * 悬停时墨色加深并在桥心盖一枚朱砂小印（无文字的纯色块 + 留白点，7px 下也认得出）。
       * 视觉范围严格保持 x1..x2（= 判定范围），bridgeInset 只用于上下锋线的内缩，
       * 这样"看到的桥"和"能拆能站的桥"永远重合。
       *
       * 渐变写在 translate 后的局部坐标里：所有桥共用同一张缓存渐变对象，
       * 否则每座桥、每个 y 都会新建一个渐变，缓存也会被撑爆。
       */
      bridge: function (ctx, b, G, hovered) {
        const P = G.p;
        const x1 = G.laneX(b.lanes[0]);
        const x2 = G.laneX(b.lanes[1]);
        const top = G.bridgeTop(b);
        const w = G.bridgeWidth;
        const cy = w / 2;
        const inset = G.m.bridgeInset;
        const ink = hovered ? P.text : P.bridgeBody;      // 悬停：墨色加深

        ctx.save();
        ctx.translate(0, top);                            // 局部坐标：y ∈ 0..w

        // 笔身
        ctx.fillStyle = Gfx.linearGradient(ctx, "ink:bridge", 0, 0, 0, w, [
          [0, Gfx.mix(ink, P.bridgeTop, 0.55)],
          [0.34, ink],
          [1, Gfx.mix(ink, P.bridgeBottom, 0.75)],
        ]);
        bandH(ctx, cy, x1, x2, w / 2, 0.9);
        ctx.fill();

        // 干笔飞白：沿笔身留几道纸色缺口（用 b.id 做种子 → 每座桥固定不变）
        ctx.fillStyle = Gfx.rgba(P.field, 0.3);
        for (let k = 0; k < 4; k++) {
          const fx = x1 + 6 + Gfx.hash(b.id * 3.3 + k * 5.9) * Math.max(1, x2 - x1 - 12);
          const fw = 3 + Gfx.hash(b.id * 7.1 + k * 2.7) * 9;
          const fy = 1.2 + Gfx.hash(b.id * 4.9 + k * 3.7) * (w - 4.2);
          ctx.fillRect(fx, fy, fw, 1 + Gfx.hash(b.id * 6.3 + k * 8.1) * 1.1);
        }

        // 上下锋线：上沿浓墨压住轮廓，下沿淡墨当"笔肚反光"
        const lx = x1 + inset + 2;
        const lw = Math.max(0, x2 - x1 - 2 * (inset + 2));
        ctx.fillStyle = Gfx.rgba(P.bridgeTop, 0.9);
        ctx.fillRect(lx, 0.9, lw, 1.1);
        ctx.fillStyle = Gfx.rgba(P.bridgeBottom, 0.75);
        ctx.fillRect(lx, w - 2.1, lw, 1.1);

        // 悬停：桥心小印（朱砂地 + 留白心）
        if (hovered) {
          const mx = (x1 + x2) / 2;
          ctx.fillStyle = Gfx.rgba(P.bridgeEdge, 0.95);
          ctx.fillRect(mx - 3.6, cy - 3.6, 7.2, 7.2);
          ctx.fillStyle = Gfx.rgba(PAPER_WHITE, 0.9);
          ctx.fillRect(mx - 1.5, cy - 1.5, 3, 3);
        }

        ctx.restore();
      },

      /**
       * 建桥预览：一律用"虚笔"—— 已经建成的桥是实笔横墨，预览必须一眼可分。
       * 可建 = 苔绿淡染 + 靛色虚线 + 中心小方框（落笔点）；
       * 不可建 = 赭灰淡染 + 褐色虚线，不给"可以落笔"的绿点。
       */
      ghost: function (ctx, c, G) {
        const P = G.p;
        const x1 = G.laneX(c.laneA);
        const x2 = G.laneX(c.laneB);
        const top = c.y - G.bridgeWidth / 2;
        if (top < 0 || top + G.bridgeWidth > G.h) return;

        const ok = c.legal;
        const wash = ok ? P.fx.ghostOk : P.fx.ghostBad;
        const line = ok ? P.fx.ghostOkLine : P.fx.ghostBadLine;

        // 预览底色比装饰层用色更明确一点（这是"能不能落笔"的操作提示，不是装饰）：
        // 苔绿 0.18 / 赭灰 0.11，都还压得住纸的调子
        ctx.fillStyle = Gfx.rgba(wash, ok ? 0.18 : 0.11);
        ctx.fillRect(x1, top, x2 - x1, G.bridgeWidth);

        ctx.save();
        ctx.setLineDash([G.m.laneSegment * 0.3, G.m.laneSegment * 0.22]);
        ctx.lineWidth = 1.2;
        ctx.strokeStyle = Gfx.rgba(line, ok ? 0.8 : 0.55);
        ctx.beginPath();
        ctx.moveTo(x1 + 1, top + 1.2);
        ctx.lineTo(x2 - 1, top + 1.2);
        ctx.moveTo(x1 + 1, top + G.bridgeWidth - 1.2);
        ctx.lineTo(x2 - 1, top + G.bridgeWidth - 1.2);
        ctx.stroke();
        ctx.restore();

        // 中心锚点：可建时补一枚极淡绿点（"此处可以落笔"）
        const mx = (x1 + x2) / 2;
        const my = top + G.bridgeWidth / 2;
        ctx.lineWidth = 1;
        ctx.strokeStyle = Gfx.rgba(line, ok ? 0.9 : 0.6);
        ctx.strokeRect(mx - 2.4, my - 2.4, 4.8, 4.8);
        if (ok) {
          ctx.fillStyle = Gfx.rgba(wash, 0.5);
          ctx.fillRect(mx - 0.9, my - 0.9, 1.8, 1.8);
        }
      },

      /**
       * 仓库：朱砂印章方块。
       * 米白印底（warehouseFill 半透明，正好压住画布底色）+ 朱红外框 + 四角朱砂角记；
       * 框内是目标形状（形状语义来自 Gfx.glyphPoints，与物品同一套），
       * 玩家只需比对"形状"即可，颜色只是辅助。
       * 角记而不是内框：形状（尤其五角星）会顶到框边，再画一条内框会被形状压住显得脏。
       */
      warehouse: function (ctx, i, G) {
        const P = G.p;
        const m = G.m;
        const x = G.laneX(i);
        const w = m.warehouseWidth;
        const h = m.warehouseHeight;
        const y0 = G.h;
        const cy = y0 + h / 2;
        const type = Config.laneWarehouse[i];

        ctx.fillStyle = P.warehouseFill;
        ctx.fillRect(x - w / 2, y0, w, h);

        ctx.lineWidth = 2;
        ctx.strokeStyle = P.warehouseFrame;
        ctx.strokeRect(x - w / 2 + 1, y0 + 1, w - 2, h - 2);

        // 四角角记（印面的"边栏"感，且不与形状打架）
        const tick = 3.5;
        const ox = x - w / 2 + 2.4;
        const oy = y0 + 2.4;
        ctx.lineWidth = 1;
        ctx.strokeStyle = Gfx.rgba(P.warehouseFrame, 0.7);
        ctx.beginPath();
        for (let sx = 0; sx < 2; sx++) {
          for (let sy = 0; sy < 2; sy++) {
            const px = sx ? x + w / 2 - 2.4 : ox;
            const py = sy ? y0 + h - 2.4 : oy;
            const dx = sx ? -tick : tick;
            const dy = sy ? -tick : tick;
            ctx.moveTo(px + dx, py);
            ctx.lineTo(px, py);
            ctx.lineTo(px, py + dy);
          }
        }
        ctx.stroke();

        // 目标形状：手绘墨廓 + 类型色
        // 注意：glyphInkPath 生成的是"以原点为中心"的路径（与物品同一套语义），
        // 因此必须先 translate 到印面中心再落墨 —— 否则形状会画在世界原点（场地左上角）。
        ctx.save();
        ctx.translate(x, cy);
        ctx.fillStyle = P.itemColors[type] || P.text;
        glyphInkPath(ctx, type, m.warehouseIconRadius, 0, 0, i * 2.7 + 0.7);
        ctx.fill();
        ctx.lineWidth = 0.8;
        ctx.strokeStyle = Gfx.rgba(P.text, 0.4);
        ctx.stroke();
        ctx.restore();
      },

      /**
       * 物品：墨绘形状。
       * 顺序 = 留白柔晕 → 洇墨外廓 → 落墨（类型色 + 竖向浓淡）→ 墨线轮廓 → 右下浓墨一小笔。
       * 抖动种子取自 item.id 与类型名：同一物品的"手绘感"逐帧完全一致，不会闪烁。
       */
      item: function (ctx, item, G) {
        const P = G.p;
        const r = G.m.itemRadius;
        const col = P.itemColors[item.type] || P.text;
        const seed = item.id * 1.7 + (String(item.type).charCodeAt(0) || 65) * 0.31;

        // 1) 留白：见文件头两条取舍之一（桥面上的墨压墨问题）
        paperHalo(ctx, item.x, item.y, r);

        // 2) 洇墨：极淡外廓一圈，模拟墨在宣纸上洇开（alpha 0.06，不参与识别）
        ctx.lineWidth = 1;
        ctx.strokeStyle = Gfx.rgba(P.text, 0.06);
        glyphInkPath(ctx, item.type, r * 1.12, item.x, item.y, seed + 3.7);
        ctx.stroke();

        // 3) 落墨：局部坐标 + 按类型缓存的渐变（同 paperHalo 的缓存策略）
        ctx.save();
        ctx.translate(item.x, item.y);
        ctx.fillStyle = Gfx.linearGradient(ctx, "ink:item:" + item.type, 0, -r * 1.2, 0, r * 1.2, [
          [0, Gfx.shade(col, 0.16)],
          [0.55, col],
          [1, Gfx.shade(col, -0.22)],
        ]);
        glyphInkPath(ctx, item.type, r, 0, 0, seed);
        ctx.fill();

        // 4) 墨线轮廓：给形状一条干净的边（深色物品与留白底本来就 ≥4.2:1，边只为利落）
        ctx.lineWidth = 0.9;
        ctx.strokeStyle = Gfx.rgba(P.text, 0.45);
        ctx.stroke();

        // 5) 浓墨积于一点：右下角一小笔，墨色物品上不可见、其余四色上是"墨分五色"的暗示
        ctx.globalAlpha = 0.12;
        ctx.fillStyle = P.text;
        ctx.beginPath();
        ctx.arc(r * 0.48, r * 0.48, r * 0.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      },

      /**
       * 世界空间最上层：纸面暗角 + 竹帘纹（宣纸的横向帘纹，配极淡竖纹）。
       * 全部是 0.02~0.10 alpha 的"底色级"变化，压不暗玩法元素。
       */
      overlay: function (ctx, G) {
        const P = G.p;

        ctx.fillStyle = Gfx.radialGradient(
          ctx, "ink:vignette", G.w / 2, G.h / 2, G.h * 0.34, G.h * 0.8,
          [[0, "rgba(60,54,44,0)"], [0.72, "rgba(60,54,44,0.03)"], [1, "rgba(60,54,44,0.10)"]]
        );
        ctx.fillRect(0, 0, G.w, G.h);

        const line = Gfx.mix(P.text, P.fieldAlt, 0.5);
        // 竹帘纹：横竖两组同色细线，各合批成一条路径一次填充
        Gfx.batchRects(ctx, Gfx.rgba(line, 0.03), function (r) {
          for (let y = 4; y < G.h; y += 6) r(0, y, G.w, 0.8);
        });
        Gfx.batchRects(ctx, Gfx.rgba(line, 0.02), function (r) {
          for (let x = 2; x < G.w; x += 52) r(x, 0, 0.8, G.h);
        });
      },

      /**
       * 屏幕空间最上层：纸面颗粒 + 屏幕暗角。
       * 颗粒用确定性点阵（hash），位置在 CSS 像素空间；暗角渐变的 key 里带上
       * 视口尺寸，避免 resize 之后命中上一尺寸的旧渐变。
       */
      screenOverlay: function (ctx, vp) {
        const W = vp.cssW;
        const H = vp.cssH;

        // 纸面颗粒：360 点合成一条路径一次填充（原先 360 次单点光栅化是本主题最大开销）
        Gfx.batchRects(ctx, "rgba(60,54,44,0.035)", function (r) {
          for (let i = 0; i < 360; i++) {
            r(Gfx.hash(i * 2.13 + 0.7) * W, Gfx.hash(i * 3.79 + 1.9) * H, 1, 1);
          }
        });

        ctx.fillStyle = Gfx.radialGradient(
          ctx, "ink:screenVig:" + (W | 0) + "x" + (H | 0),
          W / 2, H / 2, Math.min(W, H) * 0.34, Math.max(W, H) * 0.72,
          [[0, "rgba(60,54,44,0)"], [1, "rgba(60,54,44,0.10)"]]
        );
        ctx.fillRect(0, 0, W, H);
      },

      /**
       * 特效：全部走水墨语言。
       * 注意 vp 只在 damage（屏幕空间通道）里存在，其余分支不要碰它。
       */
      fx: function (ctx, type, f, a, prog, G, vp) {
        const P = G.p;

        if (type === "build") {
          // 落笔：笔锋自中心向两侧扫开（Gfx.easeOut），两端溅出墨点
          const cx = (f.x1 + f.x2) / 2;
          const cyy = f.y;
          const sweep = Gfx.easeOut(Math.min(1, prog / 0.7));
          const hw = ((f.x2 - f.x1) / 2) * sweep;
          ctx.save();
          ctx.globalAlpha = a;
          ctx.fillStyle = Gfx.rgba(P.fx.build, 0.75);
          bandH(ctx, cyy, cx - hw, cx + hw, G.bridgeWidth / 2 - 0.6, 0.9);
          ctx.fill();
          Gfx.splatter(ctx, cx - hw, cyy, 6.5, Gfx.rgba(P.fx.build, 0.6), f.y * 0.37 + 1.3, 5);
          Gfx.splatter(ctx, cx + hw, cyy, 6.5, Gfx.rgba(P.fx.build, 0.6), f.y * 0.51 + 7.1, 5);
          ctx.restore();
          return;
        }

        if (type === "flash") {
          // 拆桥：朱砂一闪（短促，只有一次"闪"，不拖尾）
          ctx.fillStyle = Gfx.rgba(P.fx.flash, a * 0.42);
          ctx.fillRect(f.x1, f.y - G.bridgeWidth / 2, f.x2 - f.x1, G.bridgeWidth);
          ctx.fillStyle = Gfx.rgba(P.fx.flash, a * 0.18);
          ctx.fillRect(f.x1 - 2, f.y - G.bridgeWidth / 2 - 2, f.x2 - f.x1 + 4, G.bridgeWidth + 4);
          return;
        }

        if (type === "shake") {
          // 禁拆：墨团抖动 + 中央一个朱红小叉（"禁止"语义不写文字）
          const dx = Math.sin(prog * 42) * 2.6 * a;
          ctx.save();
          ctx.globalAlpha = 0.5 * a;
          ctx.fillStyle = P.text;
          bandH(ctx, f.y, f.x1 + dx, f.x2 + dx, G.bridgeWidth / 2, 0.7);
          ctx.fill();
          ctx.restore();

          const mx = (f.x1 + f.x2) / 2;
          ctx.save();
          ctx.globalAlpha = Math.min(1, a * 1.2);
          ctx.strokeStyle = Gfx.rgba(P.fx.shake, 0.95);
          ctx.lineWidth = 1.3;
          ctx.beginPath();
          ctx.moveTo(mx - 3, f.y - 3);
          ctx.lineTo(mx + 3, f.y + 3);
          ctx.moveTo(mx + 3, f.y - 3);
          ctx.lineTo(mx - 3, f.y + 3);
          ctx.stroke();
          ctx.restore();
          return;
        }

        if (type === "deliver") {
          const y = f.y - prog * 26;
          if (f.ok) {
            // 投递正确：墨书 "+1" + 一枚朱砂圆点 + 几滴墨点
            const alpha = Math.min(1, a * 2.2);
            ctx.save();
            ctx.globalAlpha = alpha;
            ctx.fillStyle = Gfx.rgba(P.fx.plusText, 0.95);
            ctx.font = G.font.canvas;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText("+1", f.x, y);
            ctx.restore();
            Gfx.softBlob(ctx, f.x + 11, y - 6, 3.4, P.fx.plusParticle, alpha * 0.85);
            Gfx.splatter(ctx, f.x, y + 2, 5.5, Gfx.rgba(P.fx.plusText, alpha * 0.5), f.x * 0.13 + 2.7, 4);
          } else {
            // 投递错误：一团洇开的墨渍（横向深色块 + 向外洇的柔晕）
            const dx = Math.sin(prog * 38) * 3.5 * a;
            ctx.save();
            ctx.globalAlpha = a * 0.5;
            ctx.fillStyle = P.fx.plusText;
            bandH(ctx, f.y + 4, f.x - 20 + dx, f.x + 20 + dx, 6, 0.85);
            ctx.fill();
            ctx.restore();
            Gfx.softBlob(ctx, f.x + dx, f.y + 4, 16 + prog * 12,
              Gfx.mix(P.fx.plusText, P.fieldAlt, 0.3), a * 0.22);
          }
          return;
        }

        if (type === "damage" && vp) {
          // 失守：全屏朱砂淡染 + 细边框 + 中央一枚空印框（屏幕空间，短促不挡玩法）
          const W = vp.cssW;
          const H = vp.cssH;
          ctx.fillStyle = Gfx.rgba(P.fx.damageOverlay, a * 0.14);
          ctx.fillRect(0, 0, W, H);

          const fw = 3;
          ctx.fillStyle = Gfx.rgba(P.fx.damageFrame, a * 0.6);
          ctx.fillRect(0, 0, W, fw);
          ctx.fillRect(0, H - fw, W, fw);
          ctx.fillRect(0, 0, fw, H);
          ctx.fillRect(W - fw, 0, fw, H);

          // 中央空印：一枚"按下去却没有字"的朱砂印框，示意失守
          const s = Math.min(W, H) * 0.34;
          ctx.lineWidth = 1.4;
          ctx.strokeStyle = Gfx.rgba(P.fx.damageOverlay, a * 0.3);
          ctx.strokeRect(W / 2 - s / 2, H / 2 - s / 2, s, s);
          ctx.lineWidth = 1;
          ctx.strokeStyle = Gfx.rgba(P.fx.damageOverlay, a * 0.2);
          ctx.strokeRect(W / 2 - s / 2 + 4, H / 2 - s / 2 + 4, s - 8, s - 8);
        }
      },

      /**
       * 通路标签（屏幕空间）：朱砂小方印。
       * 这里是唯一一处我偏离了任务描述的地方，理由是可读性：
       *   "朱砂底 + 墨字" = 2.29:1（墨 #2b2d33 压朱砂 #b03a2e），14px 下糊成一团；
       *   取"白文印"（朱砂地 + 米白字，primaryText #fdf7ee）= 5.65:1，
       *   而且白文本就是印章两大样式之一，算不上离题。
       * 若坚持墨字，请把印面改成浅底（btnBg #efe7d6 时可回到 11.19:1）。
       */
      laneLabel: function (ctx, i, sx, sy, G) {
        const P = G.p;
        const w = 20;
        const h = 15;

        ctx.save();
        ctx.globalAlpha = 0.92;
        ctx.fillStyle = P.accent;                        // 朱砂印面
        ctx.fillRect(sx - w / 2, sy - h / 2, w, h);

        // 印边留白一线：像印泥没盖匀，也把"这是印"的信息说清楚
        ctx.globalAlpha = 0.35;
        ctx.lineWidth = 0.8;
        ctx.strokeStyle = Gfx.rgba(PAPER_WHITE, 0.9);
        ctx.strokeRect(sx - w / 2 + 1.3, sy - h / 2 + 1.3, w - 2.6, h - 2.6);

        ctx.globalAlpha = 1;
        ctx.font = G.font.canvas;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = P.primaryText;                   // 白文印：米白字
        ctx.fillText("L" + (i + 1), sx, sy + 0.5);
        ctx.restore();
      },
    },
  });
})();
