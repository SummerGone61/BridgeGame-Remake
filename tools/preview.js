"use strict";

/**
 * ============================================================
 * tools/preview.js —— 预览沙盒的驱动脚本（开发工具，不进入正式页面）
 *
 * 作用：用确定性场景把外观层的每一处都"铺满"，方便截图核对：
 *   play      游戏进行中：多座桥 + 各通路物品 + 桥上物品 + 建桥预览 + 特效
 *   start     开始界面
 *   settings  设置面板（含主题选择器）
 *   over      结算界面
 *
 * 用法：preview.html?theme=neon|ink|clay&scene=play
 * ============================================================
 */

(function () {
  const params = new URLSearchParams(window.location.search);
  const themeId = params.get("theme") || "neon";
  const scene = params.get("scene") || "play";

  const canvas = document.getElementById("game-canvas");
  const ctx = canvas.getContext("2d");
  const hudRoot = document.getElementById("hud");

  /* ---- 视口：与 main.js 完全一致的换算 ---- */
  const vp = { cssW: 0, cssH: 0, dpr: 1, scale: 1, offsetX: 0, offsetY: 0 };
  const BOTTOM_INSET = 90;
  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const cssW = window.innerWidth, cssH = window.innerHeight;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    canvas.style.width = cssW + "px";
    canvas.style.height = cssH + "px";
    const hudH = hudRoot ? hudRoot.offsetHeight : 104;
    const hudInset = hudH + 24;
    const availW = cssW - 16;
    const availH = cssH - hudInset - BOTTOM_INSET - 8;
    const scale = Math.min(availW / Config.worldWidth, availH / Config.worldHeight);
    vp.cssW = cssW; vp.cssH = cssH; vp.dpr = dpr; vp.scale = scale;
    vp.offsetX = (cssW - Config.worldWidth * scale) / 2;
    vp.offsetY = hudInset + (availH - Config.worldHeight * scale) / 2;
  }
  window.addEventListener("resize", resize);
  resize();

  /* ---- 外观：主题 + 生命图标 + 主题选择器 ---- */
  Theme.apply(themeId);
  const picker = document.getElementById("themePicker");
  ThemeUI.mount(picker, {
    note: document.getElementById("themeNote"),
    getDiff: function () { return 3; },
  });

  const lives = ThemeUI.mountLives(document.getElementById("lives"), 5);
  lives.set(scene === "over" ? 1 : (scene === "play" ? 4 : 5));

  const tagText = document.getElementById("themeTagText");
  function paintTag() {
    const d = Theme.get();
    if (d) tagText.textContent = "主题 · " + d.label;
  }
  Theme.onChange(paintTag);
  paintTag();

  /* ---- 确定性场景 ---- */
  const state = Logic.createInitialState();
  state.score = 37;
  state.lives = scene === "over" ? 1 : (scene === "play" ? 4 : 5);

  // 桥：用真实规则接口建造（保证画面与规则一致）
  Logic.applyIntent(state, { kind: "build", laneA: 0, laneB: 1, y: 70 });
  Logic.applyIntent(state, { kind: "build", laneA: 1, laneB: 2, y: 190 });
  Logic.applyIntent(state, { kind: "build", laneA: 2, laneB: 3, y: 130 });
  Logic.applyIntent(state, { kind: "build", laneA: 3, laneB: 4, y: 250 });
  Logic.applyIntent(state, { kind: "build", laneA: 0, laneB: 1, y: 340 });

  // 物品：覆盖五种类型 + 各通路，其中一件正在桥上
  const plan = [
    { type: "A", lane: 0, y: 22 },
    { type: "B", lane: 1, y: 118 },
    { type: "C", lane: 2, y: 62 },
    { type: "D", lane: 3, y: 196 },
    { type: "E", lane: 4, y: 96 },
    { type: "B", lane: 4, y: 300 },
    { type: "A", lane: 2, y: 384 },
    { type: "C", lane: 0, y: 240 },
  ];
  plan.forEach(function (p, i) {
    state.items.push({
      id: i, type: p.type, lane: p.lane, y: p.y, x: Config.laneXs[p.lane],
      target: Config.typeTarget[p.type], onBridge: null, crossDir: 0,
    });
  });
  // 桥上物品（横向移动中，用于核对桥上的绘制层叠关系）
  const onBridgeItem = {
    id: 100, type: "E", lane: 1, y: 70, x: Config.laneXs[1] + 26,
    target: 4, onBridge: state.bridges[0].id, crossDir: 1,
  };
  state.items.push(onBridgeItem);

  // 悬停：建桥预览（合法）
  const hover = {
    bridgeId: null,
    candidate: { laneA: 1, laneB: 2, y: 300, legal: true, },
  };

  // 特效：让建桥/投递反馈也出现在截图里（把 t0 往前挪一点制造"进行中"）
  const now0 = performance.now();
  Render.addEffect({ type: "build", dur: 0.18, x1: Config.laneXs[3], x2: Config.laneXs[4], y: 250 });
  Render.addEffect({ type: "deliver", dur: 0.7, x: Config.laneXs[2], y: Config.laneLength, ok: true });
  Render.addEffect({ type: "deliver", dur: 0.7, x: Config.laneXs[4], y: Config.laneLength, ok: false });
  Render.effects.forEach(function (fx, i) { fx.t0 = now0 - 60 - i * 90; });

  /* ---- 界面状态 ---- */
  const overlays = {
    start: document.getElementById("startOverlay"),
    settings: document.getElementById("settingsOverlay"),
    over: document.getElementById("gameOverOverlay"),
  };
  Object.keys(overlays).forEach(function (k) {
    overlays[k].classList.toggle("hidden", k !== scene);
  });
  if (scene === "over") {
    document.getElementById("finalScore").textContent = "37";
    document.getElementById("finalBest").textContent = "128";
  }
  document.getElementById("score").textContent = state.score;
  document.getElementById("best").textContent = "128";
  document.getElementById("diff").textContent = "Lv." + Logic.diffLevel(state);

  // LIVES 行宽与第一行对齐（与 main.js 相同的视觉对齐逻辑）
  function alignLives() {
    const w1 = document.getElementById("hudTopRow").offsetWidth;
    const st = document.getElementById("livesStat");
    if (w1 > 0 && st) st.style.width = w1 + "px";
  }
  alignLives();
  window.addEventListener("resize", alignLives);

  /* ---- 渲染循环（复用正式渲染管线）---- */
  // 暴露给 tools/selfcheck.js：在真实像素上做定量体检（仅开发工具使用）
  window.__preview = { vp: vp, state: state, scene: scene, hover: hover, theme: themeId };

  /**
   * 可选性能基准（?bench=1）：同步跑若干帧，量一帧的绘制耗时。
   * 只用于开发期核对各主题的开销量级（浅色主题的"实心暗层"手法绘制指令更多）。
   * 结果写进 <pre id="bench">，供 --dump-dom 抓取。
   */
  if (params.get("bench") === "1") {
    const warm = 5, runs = 20;
    for (let i = 0; i < warm; i++) Render.draw(state, ctx, vp, hover, 1000 + i * 16);
    const t0 = performance.now();
    for (let i = 0; i < runs; i++) Render.draw(state, ctx, vp, hover, 2000 + i * 16);
    const ms = (performance.now() - t0) / runs;
    const pre = document.createElement("pre");
    pre.id = "bench";
    pre.textContent = JSON.stringify({
      theme: themeId,
      msPerDraw: +ms.toFixed(3),
      fps60Budget: +(ms / 16.7).toFixed(3),
      canvas: canvas.width + "x" + canvas.height,
    });
    document.body.appendChild(pre);
  }

  function frame(now) {
    // 只渲染：不调用 Logic.update，保证场景恒定，便于逐主题对比外观差异
    Render.draw(state, ctx, vp, scene === "play" ? hover : null, now);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // 供截图工具判断"已渲染完成"
  window.__previewReady = true;
})();
