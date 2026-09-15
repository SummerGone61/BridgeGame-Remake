"use strict";

/**
 * ============================================================
 * main.js —— 装配层：画布、视口、输入、HUD、UI 流程、主循环
 *
 * v11（外观重构）：
 *   - 逻辑层（config.js / logic.js）与输入层（input.js）保持零改动；
 *   - 一切外观交给外观层：主题注册表（theme.js）+ 主题定义（themes/*.js）
 *     + 渲染管线（render.js）+ 主题 UI（theme-ui.js）；
 *   - 本文件只负责"装配与流程"：视口、事件、HUD 文本、暂停/设置/结算流程；
 *   - 主题选择器由 ThemeUI 依据注册表动态生成（新增主题不改 HTML）；
 *   - 唯一的逻辑→外观信号：Logic.diffLevel(state)（难度档位），
 *     交给 ThemeUI.notifyDiff() 决定是否换肤（仅"自动"模式响应）。
 *
 * 主循环：requestAnimationFrame + 固定时间步长（1/120s）
 * ============================================================
 */

const Main = {};

Main.BEST_KEY = "conveyorBridgeBestScore_v1";

Main.boot = function () {
  const canvas = document.getElementById("game-canvas");
  const ctx = canvas.getContext("2d");

  const hud = {
    // 状态信息
    score: document.getElementById("score"),
    best: document.getElementById("best"),
    lives: document.getElementById("lives"),
    diff: document.getElementById("diff"),
    hudTopRow: document.getElementById("hudTopRow"),
    livesStat: document.getElementById("livesStat"),
    // 按钮
    settingsBtn: document.getElementById("settingsBtn"),
    pauseBtn: document.getElementById("pauseBtn"),
    resumeBtn: document.getElementById("resumeBtn"),
    restartBtn: document.getElementById("restartBtn"),
    startBtn: document.getElementById("startBtn"),
    startSettingsBtn: document.getElementById("startSettingsBtn"),
    settingsCloseBtn: document.getElementById("settingsCloseBtn"),
    gameoverSettingsBtn: document.getElementById("gameoverSettingsBtn"),
    // 覆盖层
    startOverlay: document.getElementById("startOverlay"),
    settingsOverlay: document.getElementById("settingsOverlay"),
    pauseOverlay: document.getElementById("pauseOverlay"),
    gameOverOverlay: document.getElementById("gameOverOverlay"),
    finalScore: document.getElementById("finalScore"),
    finalBest: document.getElementById("finalBest"),
    // 设置面板内的控件
    speedSlider: document.getElementById("speedSlider"),
    spawnSlider: document.getElementById("spawnSlider"),
    speedVal: document.getElementById("speedVal"),
    spawnVal: document.getElementById("spawnVal"),
    themePicker: document.getElementById("themePicker"),
    themeNote: document.getElementById("themeNote"),
    themeTagText: document.getElementById("themeTagText"),
  };
  const hudRoot = document.getElementById("hud");

  let state = Logic.createInitialState();
  let best = Main.loadBest();
  let overShown = false;
  let gameStarted = false;        // 开始界面点「开始」前不运行游戏
  let settingsReturn = null;      // 设置面板从哪打开："game" | "start" | "gameover"
  let clickGuardUntil = 0;        // 触屏：覆盖层关闭后短暂屏蔽画布点击，防穿透

  // 速度倍率（v04 滑轨，即时生效；只改倍率，不改难度曲线）
  const settings = { speedFactor: 1, spawnFactor: 1 };
  hud.speedSlider.addEventListener("input", function () {
    settings.speedFactor = parseFloat(hud.speedSlider.value) || 1;
    hud.speedVal.textContent = "×" + settings.speedFactor.toFixed(2);
  });
  hud.spawnSlider.addEventListener("input", function () {
    settings.spawnFactor = parseFloat(hud.spawnSlider.value) || 1;
    hud.spawnVal.textContent = "×" + settings.spawnFactor.toFixed(2);
  });

  /* ---- 外观：主题选择器（数据驱动的界面，新增主题无需改 HTML）---- */
  ThemeUI.mount(hud.themePicker, {
    note: hud.themeNote,
    // 外观层需要的唯一逻辑信号：难度档位（不读分数/时间，规则不外泄）
    getDiff: function () { return Logic.diffLevel(state); },
  });

  // HUD 上的当前主题标签（自动模式下随难度变化而更新）
  function paintThemeTag() {
    const d = Theme.get();
    if (d) hud.themeTagText.textContent = "主题 · " + d.label;
  }
  Theme.onChange(paintThemeTag);
  paintThemeTag();

  // 生命图标：数量与图标外观都由外观层负责，装配层只传"当前生命值"
  const lives = ThemeUI.mountLives(hud.lives, 5);
  lives.set(state.lives);

  // 视口：世界坐标 → 屏幕坐标（等比例缩放 + 居中，§14）
  const vp = { cssW: 0, cssH: 0, dpr: 1, scale: 1, offsetX: 0, offsetY: 0 };
  const BOTTOM_INSET = 90;   // 底部占位：仓库终端 + 右下说明框

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const cssW = window.innerWidth;
    const cssH = window.innerHeight;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    canvas.style.width = cssW + "px";
    canvas.style.height = cssH + "px";
    // 动态测量 HUD 实际高度，保证游戏区不被任何 UI 元素遮挡（v09 响应式）
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

  // 输入（§30：点击两相邻通路之间 → 建桥；点击桥 → 拆桥）
  Input.attach(canvas,
    function () { return vp; },
    function () { return state; },
    {
      onClickWorld: function (x, y) {
        if (!gameStarted || state.paused || state.gameOver) return;
        if (Input.isTouch && performance.now() < clickGuardUntil) return;   // 防点击穿透
        const anim = Theme.animOf();
        const b = Logic.bridgeAtPoint(state, x, y);
        if (b) {
          const ok = Logic.applyIntent(state, { kind: "delete", bridgeId: b.id });
          const x1 = Config.laneXs[b.lanes[0]];
          const x2 = Config.laneXs[b.lanes[1]];
          if (!ok && Logic.hasItemOnBridge(state, b.id)) {
            Render.addEffect({ type: "shake", dur: anim.shake, x1: x1, x2: x2, y: b.y });   // 禁拆抖动
          } else if (ok) {
            Render.addEffect({ type: "flash", dur: anim.flash, x1: x1, x2: x2, y: b.y });
          }
        } else {
          const c = Logic.buildCandidate(state, x, y);
          if (c && Logic.applyIntent(state, { kind: "build", laneA: c.laneA, laneB: c.laneB, y: c.y })) {
            Render.addEffect({
              type: "build", dur: anim.build,
              x1: Config.laneXs[c.laneA], x2: Config.laneXs[c.laneB], y: c.y,
            });
          }
        }
        // 点击后刷新悬停信息（桌面端；触屏端悬停恒为 null）
        if (!Input.isTouch) Input.hover = Input.computeHover(state, x, y);
      },
    });

  function suppressCanvasClicks(ms) {
    if (Input.isTouch) clickGuardUntil = performance.now() + ms;
  }

  /* ---- 设置面板（开始界面 / 游戏中 / 结算界面复用同一组件）---- */
  function openSettings(from) {
    settingsReturn = from;
    hud.settingsOverlay.classList.remove("hidden");
    if (from === "game") {
      state.paused = true;               // 进入设置自动暂停
      hud.pauseBtn.textContent = "继续";
    }
  }
  function closeSettings() {
    hud.settingsOverlay.classList.add("hidden");
    const ret = settingsReturn;
    settingsReturn = null;
    if (ret === "game") {
      state.paused = false;              // 关闭设置自动继续
      hud.pauseBtn.textContent = "暂停";
    }
    suppressCanvasClicks(250);
  }

  function togglePause() {
    if (!gameStarted || state.gameOver) return;
    if (!hud.settingsOverlay.classList.contains("hidden")) { closeSettings(); return; }
    state.paused = !state.paused;
    hud.pauseOverlay.classList.toggle("hidden", !state.paused);
    hud.pauseBtn.textContent = state.paused ? "继续" : "暂停";
  }

  /* ---- 新开局（开始界面「开始」与结算界面「再来一局」共用）---- */
  function beginRun() {
    state = Logic.createInitialState();
    overShown = false;
    Render.clearEffects();
    gameStarted = true;
    state.paused = false;
    // 生命图标：set() 是"计数 + DOM 显隐"的唯一权威入口，
    // 因此重开一局（0/残血 → 5）会在这里把五颗心全部显示回来。
    lives.set(state.lives);
    hud.gameOverOverlay.classList.add("hidden");
    hud.pauseOverlay.classList.add("hidden");
    hud.settingsOverlay.classList.add("hidden");
    settingsReturn = null;
    hud.pauseBtn.textContent = "暂停";
    suppressCanvasClicks(250);
  }
  function startGame() {
    hud.startOverlay.classList.add("hidden");
    beginRun();
  }

  // 事件绑定
  hud.pauseBtn.addEventListener("click", togglePause);
  hud.resumeBtn.addEventListener("click", togglePause);
  hud.restartBtn.addEventListener("click", beginRun);
  hud.settingsBtn.addEventListener("click", function () {
    if (gameStarted && !state.gameOver) openSettings("game");
  });
  hud.startSettingsBtn.addEventListener("click", function () { openSettings("start"); });
  hud.gameoverSettingsBtn.addEventListener("click", function () { openSettings("gameover"); });
  hud.settingsCloseBtn.addEventListener("click", closeSettings);
  // 点击设置面板背景亦可关闭
  hud.settingsOverlay.addEventListener("click", function (e) {
    if (e.target === hud.settingsOverlay) closeSettings();
  });
  hud.startBtn.addEventListener("click", startGame);

  // 键盘：P/Esc 暂停（设置打开时先关闭设置），R 重开
  window.addEventListener("keydown", function (e) {
    const k = (e.key || "").toLowerCase();
    const settingsOpen = !hud.settingsOverlay.classList.contains("hidden");
    if (k === "p" || k === "escape") {
      if (settingsOpen) closeSettings();
      else togglePause();
    } else if (k === "r") {
      if (gameStarted && !settingsOpen) beginRun();
    }
  });

  let prevDiff = Logic.diffLevel(state);

  function updateHUD() {
    hud.score.textContent = state.score;
    hud.best.textContent = best;

    // 生命：数量变化时更新图标（消耗的图标由外观层返回位置，用于碎裂动画）
    if (state.lives !== lives.getShown()) {
      const lostRect = lives.set(state.lives);
      if (lostRect) Main.shatterHeart(lostRect);
    }

    // LIVES 行宽与 SCORE/BEST/DIFF 行视觉等宽（v09）
    const w1 = hud.hudTopRow ? hud.hudTopRow.offsetWidth : 0;
    if (w1 > 0 && hud.livesStat && Math.abs(hud.livesStat.offsetWidth - w1) > 1) {
      hud.livesStat.style.width = w1 + "px";
    }

    // 难度档位（§28 + v03：每得 15 分提高一档，开局第 1 档）
    const diff = Logic.diffLevel(state);
    hud.diff.textContent = "Lv." + diff;
    // §9.6 视觉信号：DIFF 变化 → 交给外观层决定是否换肤（仅"自动"模式响应）
    if (diff !== prevDiff) {
      prevDiff = diff;
      ThemeUI.notifyDiff();
    }
    if (state.gameOver && !overShown) {
      overShown = true;
      if (state.score > best) {
        best = state.score;
        Main.saveBest(best);
      }
      hud.finalScore.textContent = state.score;
      hud.finalBest.textContent = best;
      hud.gameOverOverlay.classList.remove("hidden");
    }
  }

  // ---- 固定时间步长主循环 ----
  const STEP = 1 / 120;
  let acc = 0;
  let last = performance.now();

  function frame(now) {
    const dtReal = Math.min((now - last) / 1000, 0.25);
    last = now;
    if (gameStarted && !state.paused && !state.gameOver) {
      acc += dtReal;
      let guard = 0;
      while (acc >= STEP && guard < 60) {
        // 投递检测：本步消失的物品即完成投递（触发 +1 / 错误 视觉反馈）
        const before = new Map(state.items.map(it => [it.id, it]));
        Logic.update(state, STEP, settings);
        for (const it of state.items) before.delete(it.id);
        const anim = Theme.animOf();
        before.forEach(function (it) {
          Render.addEffect({
            type: "deliver", dur: anim.deliver,
            x: Config.laneXs[it.lane],
            y: Config.laneLength,
            ok: it.lane === it.target,
          });
          if (it.lane !== it.target) {
            Render.addEffect({ type: "damage", dur: anim.damage });   // 全屏掉血反馈
          }
        });
        acc -= STEP;
        guard++;
      }
    }
    Render.draw(state, ctx, vp, Input.hover, performance.now());
    updateHUD();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
};

Main.loadBest = function () {
  try { return parseInt(localStorage.getItem(Main.BEST_KEY), 10) || 0; }
  catch (e) { return 0; }
};

Main.saveBest = function (v) {
  try { localStorage.setItem(Main.BEST_KEY, String(v)); } catch (e) { /* 忽略 */ }
};

/**
 * 生命图标碎裂动画：在指定矩形位置生成若干碎片，向外飞散并淡出。
 * 仅视觉表现，不影响任何游戏逻辑；碎片颜色/圆角跟随当前主题（CSS 变量）。
 */
Main.shatterHeart = function (rect) {
  if (!rect) return;
  const wrap = document.createElement("div");
  wrap.className = "heart-shatter";
  wrap.style.left = (rect.left + rect.width / 2) + "px";
  wrap.style.top = (rect.top + rect.height / 2) + "px";
  const frags = 6;
  for (let i = 0; i < frags; i++) {
    const s = document.createElement("span");
    s.className = "heart-frag";
    const dx = ((i - (frags - 1) / 2) * 16) + (i % 2 ? 8 : -8);
    const dy = -8 - (i % 3) * 14;
    s.style.setProperty("--dx", dx + "px");
    s.style.setProperty("--dy", dy + "px");
    s.style.animationDelay = (i * 0.02).toFixed(2) + "s";
    wrap.appendChild(s);
  }
  document.body.appendChild(wrap);
  window.setTimeout(function () { wrap.remove(); }, 520);
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", Main.boot);
} else {
  Main.boot();
}
