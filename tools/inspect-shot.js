"use strict";

/**
 * ============================================================
 * tools/inspect-shot.js —— 截图定量体检（Node，无第三方依赖）
 *
 * 为什么需要它：本工具链要验证"外观做得对不对"，
 * 而最可靠的自动化手段不是肉眼看图，而是把 PNG 解出来做量化分析：
 *   · 主色分布      → 主题色是否真的上了屏、有没有大面积糊成一色
 *   · 结构对比图    → 通路/桥/物品/面板是否落在预期位置（ASCII 结构图）
 *   · 色类分布图    → 五类物品是否各自可辨（不同色类是否真的出现）
 *   · 明细率        → 画面是否有内容（防止"全空白/全黑"式渲染失败）
 *
 * 用法：
 *   node tools/inspect-shot.js shot.png
 *   node tools/inspect-shot.js shot.png --map 110
 *   node tools/inspect-shot.js shot.png --zoom 400,120,320,240
 * ============================================================
 */

const fs = require("fs");
const zlib = require("zlib");

/* ============================================================
 * 一、PNG 解码（8bit，colorType 0/2/4/6，非隔行）
 * ============================================================ */
function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error("不是 PNG 文件");
  let pos = 8;
  let ihdr = null;
  const idat = [];
  let palette = null;
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    const data = buf.slice(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      ihdr = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        bitDepth: data[8],
        colorType: data[9],
        compression: data[10],
        filter: data[11],
        interlace: data[12],
      };
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "PLTE") {
      palette = data;
    } else if (type === "IEND") {
      break;
    }
    pos += 12 + len;
  }
  if (!ihdr) throw new Error("缺少 IHDR");
  if (ihdr.interlace !== 0) throw new Error("暂不支持隔行 PNG");
  if (ihdr.bitDepth !== 8) throw new Error("暂不支持 " + ihdr.bitDepth + " 位深");

  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ihdr.colorType];
  if (!channels) throw new Error("不支持的 colorType: " + ihdr.colorType);

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = ihdr.width * channels;
  const out = Buffer.alloc(ihdr.height * stride);
  let prev = Buffer.alloc(stride);
  let rp = 0;
  for (let y = 0; y < ihdr.height; y++) {
    const filter = raw[rp++];
    const line = raw.slice(rp, rp + stride);
    rp += stride;
    const cur = Buffer.alloc(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? cur[x - channels] : 0;
      const b = prev[x];
      const c = x >= channels ? prev[x - channels] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      cur[x] = v & 255;
    }
    cur.copy(out, y * stride);
    prev = cur;
  }

  // 统一成 RGBA 取样函数
  const get = function (x, y) {
    const o = y * stride + x * channels;
    if (ihdr.colorType === 6) return [out[o], out[o + 1], out[o + 2], out[o + 3]];
    if (ihdr.colorType === 2) return [out[o], out[o + 1], out[o + 2], 255];
    if (ihdr.colorType === 4) return [out[o], out[o], out[o], out[o + 1]];
    if (ihdr.colorType === 0) return [out[o], out[o], out[o], 255];
    const p = out[o] * 3;
    return [palette[p], palette[p + 1], palette[p + 2], 255];
  };
  return { width: ihdr.width, height: ihdr.height, get: get };
}

/* ============================================================
 * 二、颜色分析
 * ============================================================ */
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
    else if (max === g) h = ((b - r) / d + 2) * 60;
    else h = ((r - g) / d + 4) * 60;
  }
  return { h: h, s: s, l: l };
}

/** 色类字母：用于在 ASCII 图里区分"哪里是什么颜色" */
function hueClass(r, g, b) {
  const c = rgbToHsl(r, g, b);
  if (c.l >= 0.94 && c.s <= 0.25) return "W";           // 近白
  if (c.l <= 0.10) return "K";                          // 近黑
  if (c.s <= 0.16) return c.l > 0.66 ? "w" : (c.l > 0.33 ? "g" : "k");   // 灰阶
  const h = c.h;
  if (h < 20 || h >= 340) return "R";
  if (h < 45) return "O";
  if (h < 70) return "Y";
  if (h < 165) return "G";
  if (h < 200) return "C";
  if (h < 265) return "B";
  if (h < 300) return "P";
  return "M";
}

function lum(r, g, b) {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/* ============================================================
 * 三、主流程
 * ============================================================ */
function main() {
  const args = process.argv.slice(2);
  if (!args.length) {
    console.log("用法：node tools/inspect-shot.js <png> [--map 110] [--zoom x,y,w,h]");
    process.exitCode = 1;
    return;
  }
  const file = args[0];
  let mapW = 104;
  let zoom = null;
  for (let i = 1; i < args.length; i++) {
    if (args[i] === "--map") mapW = parseInt(args[++i], 10) || 104;
    else if (args[i] === "--zoom") {
      const p = args[++i].split(",").map(Number);
      zoom = { x: p[0], y: p[1], w: p[2], h: p[3] };
    }
  }

  const img = decodePng(fs.readFileSync(file));
  const region = zoom
    ? { x: zoom.x, y: zoom.y, w: zoom.w, h: zoom.h }
    : { x: 0, y: 0, w: img.width, h: img.height };

  /* ---- 全图统计 ---- */
  const hist = new Map();
  let sumL = 0, n = 0;
  const step = Math.max(1, Math.floor(Math.min(img.width, img.height) / 600));
  for (let y = 0; y < img.height; y += step) {
    for (let x = 0; x < img.width; x += step) {
      const p = img.get(x, y);
      const key = ((p[0] >> 3) << 10) | ((p[1] >> 3) << 5) | (p[2] >> 3);
      hist.set(key, (hist.get(key) || 0) + 1);
      sumL += lum(p[0], p[1], p[2]);
      n++;
    }
  }
  const top = Array.from(hist.entries()).sort(function (a, b) { return b[1] - a[1]; }).slice(0, 10);
  const meanL = sumL / n;

  console.log("文件：" + file);
  console.log("尺寸：" + img.width + "×" + img.height + "，平均亮度 " + meanL.toFixed(3));
  console.log("主色（占比）：");
  top.forEach(function (e) {
    const k = e[0];
    const r = ((k >> 10) & 31) << 3, g = ((k >> 5) & 31) << 3, b = (k & 31) << 3;
    const hx = "#" + [r, g, b].map(function (v) { return v.toString(16).padStart(2, "0"); }).join("");
    console.log("  " + hx + "  " + (100 * e[1] / n).toFixed(2) + "%  类 " + hueClass(r, g, b));
  });

  /* ---- 采样成字符网格 ---- */
  const cols = mapW;
  const rows = Math.max(8, Math.round((region.h / region.w) * cols * 0.5));
  const cw = region.w / cols, ch = region.h / rows;

  const cellsLum = [];
  const cellsCls = [];
  const clsCount = new Map();

  for (let ry = 0; ry < rows; ry++) {
    const lrow = [], crow = [];
    for (let rx = 0; rx < cols; rx++) {
      const x0 = Math.floor(region.x + rx * cw), x1 = Math.max(x0 + 1, Math.floor(region.x + (rx + 1) * cw));
      const y0 = Math.floor(region.y + ry * ch), y1 = Math.max(y0 + 1, Math.floor(region.y + (ry + 1) * ch));
      let r = 0, g = 0, b = 0, cnt = 0;
      for (let y = y0; y < y1 && y < img.height; y += 1) {
        for (let x = x0; x < x1 && x < img.width; x += 1) {
          const p = img.get(x, y);
          r += p[0]; g += p[1]; b += p[2]; cnt++;
        }
      }
      if (!cnt) cnt = 1;
      r = Math.round(r / cnt); g = Math.round(g / cnt); b = Math.round(b / cnt);
      lrow.push(lum(r, g, b));
      const c = hueClass(r, g, b);
      crow.push(c);
      clsCount.set(c, (clsCount.get(c) || 0) + 1);
    }
    cellsLum.push(lrow);
    cellsCls.push(crow);
  }

  const ramp = " .:-=+*#%@";   // 暗 → 亮

  console.log("\n结构图（亮度，暗→亮：" + ramp.trim() + "；每格为一块平均色）");
  console.log("+" + "-".repeat(cols) + "+");
  cellsLum.forEach(function (row) {
    let s = "|";
    row.forEach(function (v) {
      const i = Math.min(ramp.length - 1, Math.max(0, Math.round(v * (ramp.length - 1))));
      s += ramp[i];
    });
    console.log(s + "|");
  });
  console.log("+" + "-".repeat(cols) + "+");

  console.log("\n色类图（W 近白 / K 近黑 / w,g,k 灰阶 / R,O,Y,G,C,B,P,M 彩色的色相段）");
  console.log("+" + "-".repeat(cols) + "+");
  cellsCls.forEach(function (row) {
    console.log("|" + row.join("") + "|");
  });
  console.log("+" + "-".repeat(cols) + "+");

  const total = rows * cols;
  const sorted = Array.from(clsCount.entries()).sort(function (a, b) { return b[1] - a[1]; });
  console.log("\n色类占比：" + sorted.map(function (e) {
    return e[0] + " " + (100 * e[1] / total).toFixed(1) + "%";
  }).join("  "));

  const dominant = sorted[0];
  console.log("明细率（非主色块的占比，越高说明画面越有内容）：" +
    (100 - 100 * dominant[1] / total).toFixed(1) + "%");
}

main();
