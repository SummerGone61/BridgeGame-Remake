"use strict";

/**
 * ============================================================
 * tools/selfcheck.js —— 画面自检（在真实浏览器里测量真实像素）
 *
 * 为什么需要它：配色表里的对比度只是"设计意图"，
 * 真正的可读性要看画布上画出来的像素。本脚本在预览页里
 * 等渲染稳定后，用 getImageData 回读画布，在**已知世界坐标**处采样：
 *   · 每个物品：中心像素 vs 正下方背景（物品是否从底上"跳出来"）
 *               纵向扫描的最亮/最暗对比（是否有清晰的边缘/描边层次）
 *   · 通路：通路中心 vs 通路间隙（通路是否可辨）
 *   · 桥：桥中心 vs 桥下 25px 的场地（桥是否可辨）
 *   · 场地：去重色数、与页面底色的差异占比（是否真的渲染了内容）
 *
 * 结果以 JSON 写入 <pre id="selfcheck">，由 tools/capture-shots.ps1 抓取归档。
 * 该脚本只在 tools/preview.html 里加载，正式页面不含任何调试代码。
 * ============================================================
 */

(function () {
  const WAIT_MS = 700;          // 等动画铺开（虚拟时间下也会正常推进）

  function contrast(rgbA, rgbB) {
    const L = function (c) {
      const f = function (v) {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
      };
      return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
    };
    const l1 = L(rgbA), l2 = L(rgbB);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  }

  function lumOf(c) {
    const f = function (v) {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
  }

  function run() {
    const info = window.__preview;
    if (!info) return finish({ error: "预览上下文未就绪（window.__preview 缺失）" });

    const canvas = document.getElementById("game-canvas");
    const ctx = canvas.getContext("2d");
    const vp = info.vp;
    const state = info.state;
    const def = Theme.get();

    let img;
    try {
      img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    } catch (e) {
      return finish({ error: "读取画布像素失败：" + e.message });
    }
    const W = img.width, H = img.height, D = img.data;

    function px(x, y) {
      const xi = Math.round(x), yi = Math.round(y);
      if (xi < 0 || yi < 0 || xi >= W || yi >= H) return null;
      const o = (yi * W + xi) * 4;
      return [D[o], D[o + 1], D[o + 2]];
    }
    /** 3×3 均值采样，抵抗单像素噪声（描边/纹理） */
    function patch(x, y, r) {
      const k = r === undefined ? 1 : r;
      let n = 0, s = [0, 0, 0];
      for (let dy = -k; dy <= k; dy++) {
        for (let dx = -k; dx <= k; dx++) {
          const c = px(x + dx, y + dy);
          if (!c) continue;
          s[0] += c[0]; s[1] += c[1]; s[2] += c[2]; n++;
        }
      }
      if (!n) return null;
      return [Math.round(s[0] / n), Math.round(s[1] / n), Math.round(s[2] / n)];
    }
    const hex = function (c) {
      return "#" + c.map(function (v) { return v.toString(16).padStart(2, "0"); }).join("");
    };

    /* ---- 世界坐标 → 画布像素 ---- */
    const sx = function (wx) { return vp.offsetX + wx * vp.scale; };
    const sy = function (wy) { return vp.offsetY + wy * vp.scale; };

    const report = {
      theme: def ? def.id : "?",
      label: def ? def.label : "?",
      mode: def ? def.mode : "?",
      scene: info.scene,
      canvas: { w: W, h: H, dpr: vp.dpr, scale: +vp.scale.toFixed(4) },
      items: [],
      lanes: null,
      bridges: [],
      field: null,
      failures: [],
    };
    const bad = function (msg) { report.failures.push(msg); };

    /* ---- 物品：中心 / 正下方背景 / 纵向扫描层次 ---- */
    const seen = {};
    state.items.forEach(function (it) {
      if (seen[it.type]) return;                 // 每类取第一个作为代表
      seen[it.type] = true;
      const cx = sx(it.x), cy = sy(it.y);
      const r = def.metrics.itemRadius * vp.scale;
      const inside = patch(cx, cy, 1);
      const behind = patch(cx, cy + r * 1.9, 1);

      // 纵向扫描：从物品上方 1.8r 到下方 1.8r，取最亮与最暗
      let maxL = -1, minL = 2, maxC = null, minC = null;
      for (let d = -1.8 * r; d <= 1.8 * r; d += 0.5) {
        const c = patch(cx, cy + d, 0);
        if (!c) continue;
        const l = lumOf(c);
        if (l > maxL) { maxL = l; maxC = c; }
        if (l < minL) { minL = l; minC = c; }
      }

      const rec = {
        type: it.type,
        onBridge: it.onBridge !== null,
        inside: inside ? hex(inside) : null,
        behind: behind ? hex(behind) : null,
        vsBehind: (inside && behind) ? +contrast(inside, behind).toFixed(2) : null,
        edgeRange: (maxC && minC) ? +contrast(maxC, minC).toFixed(2) : null,
        edgeColors: (maxC && minC) ? [hex(minC), hex(maxC)] : null,
      };
      report.items.push(rec);

      if (!inside) bad("物品 " + it.type + " 采样越界");
      else if (rec.vsBehind !== null && rec.vsBehind < 1.15) {
        bad("物品 " + it.type + " 与背景对比过低（" + rec.vsBehind + "），可能糊在一起");
      }
      if (rec.edgeRange !== null && rec.edgeRange < 1.8) {
        bad("物品 " + it.type + " 边缘层次不足（纵向明暗对比 " + rec.edgeRange + "），轮廓不够清晰");
      }
    });

    /* ---- 通路 vs 间隙 ---- */
    const laneMidY = sy(Config.laneLength * 0.45);
    const laneX = sx(Config.laneXs[2]);
    const gapX = sx((Config.laneXs[2] + Config.laneXs[3]) / 2);
    const laneC = patch(laneX, laneMidY, 1);
    const gapC = patch(gapX, laneMidY, 1);
    report.lanes = {
      lane: laneC ? hex(laneC) : null,
      gap: gapC ? hex(gapC) : null,
      contrast: (laneC && gapC) ? +contrast(laneC, gapC).toFixed(2) : null,
    };
    if (report.lanes.contrast !== null && report.lanes.contrast < 1.03) {
      bad("通路与间隙几乎同色（" + report.lanes.contrast + "），通路不可辨");
    }

    /* ---- 桥 vs 桥下场地 ---- */
    state.bridges.slice(0, 3).forEach(function (b) {
      const bx = sx((Config.laneXs[b.lanes[0]] + Config.laneXs[b.lanes[1]]) / 2);
      const by = sy(b.y);
      const on = patch(bx, by, 1);
      const off = patch(bx, by + Config.bridgeWidth * vp.scale * 2.4, 1);
      const rec = {
        y: b.y,
        on: on ? hex(on) : null,
        off: off ? hex(off) : null,
        contrast: (on && off) ? +contrast(on, off).toFixed(2) : null,
      };
      report.bridges.push(rec);
      if (rec.contrast !== null && rec.contrast < 1.05) {
        bad("桥与场地几乎同色（第 " + b.y + " 号桥，对比 " + rec.contrast + "）");
      }
    });

    /* ---- 场地：去重色数 + 与页面底色的差异占比 ---- */
    const pageC = Gfx.parse(def.palette.page);
    const pageHex = hex([pageC.r, pageC.g, pageC.b]);
    let distinct = new Set();
    let nonPage = 0, total = 0;
    const x0 = Math.round(vp.offsetX), x1 = Math.round(vp.offsetX + Config.worldWidth * vp.scale);
    const y0 = Math.round(vp.offsetY), y1 = Math.round(vp.offsetY + Config.laneLength * vp.scale);
    for (let y = y0; y < y1; y += 2) {
      for (let x = x0; x < x1; x += 2) {
        const c = px(x, y);
        if (!c) continue;
        distinct.add(((c[0] >> 4) << 8) | ((c[1] >> 4) << 4) | (c[2] >> 4));
        const d = Math.abs(c[0] - pageC.r) + Math.abs(c[1] - pageC.g) + Math.abs(c[2] - pageC.b);
        if (d > 24) nonPage++;
        total++;
      }
    }
    report.field = {
      rect: [x0, y0, x1 - x0, y1 - y0],
      distinctColors: distinct.size,
      nonPageRatio: total ? +(nonPage / total).toFixed(3) : 0,
      pageColor: pageHex,
    };
    if (distinct.size < 16) bad("场地内去重色数仅 " + distinct.size + "，画面可能过分单调或未正确渲染");

    /* ---- 结论 ---- */
    report.pass = report.failures.length === 0;
    finish(report);
  }

  function finish(report) {
    // 清理成 --dump-dom 友好：不含 & < > 等会被 HTML 序列化转义的字符
    const json = JSON.stringify(report, null, 1).replace(/[&<>]/g, " ");
    const pre = document.createElement("pre");
    pre.id = "selfcheck";
    pre.textContent = json;
    document.body.appendChild(pre);
    document.title = "selfcheck:" + (report && report.pass ? "PASS" : "FAIL");
  }

  window.setTimeout(run, WAIT_MS);
})();
