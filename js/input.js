"use strict";

/**
 * ============================================================
 * input.js —— 输入层：屏幕坐标 → 世界坐标 → 交互意图
 * 文档 §31：核心逻辑不与鼠标输入绑定，未来接入 Touch 只需替换本层
 * （统一 Bridge Interaction）。
 *
 * v02：点击两相邻通路之间 → 建桥；点击已有桥 → 拆桥（§30）。
 * 悬停信息（Input.hover）供渲染层做高亮与幽灵预览（仅视觉）。
 * v09（移动端）：触屏设备跳过悬停/光标计算（手机端无需悬停反馈，
 * 且可避免点击时幽灵预览闪现造成的闪烁）；点击（tap → click）映射不变。
 * ============================================================
 */

const Input = {};

/** 是否触屏设备（用于禁用悬停反馈与光标样式） */
Input.isTouch = (typeof window !== "undefined") &&
  (("ontouchstart" in window) || (navigator.maxTouchPoints > 0));

/** 悬停信息：{ bridgeId, candidate }；由 mousemove 更新，渲染层读取（触屏设备恒为 null） */
Input.hover = null;

/**
 * 绑定画布输入事件。
 * @param {HTMLCanvasElement} canvas
 * @param {() => object} getViewport  返回当前视口 { scale, offsetX, offsetY }
 * @param {() => object} getState     返回当前游戏状态
 * @param {object} handlers           { onClickWorld(x, y) }
 */
Input.attach = function (canvas, getViewport, getState, handlers) {
  if (!Input.isTouch) {
    canvas.addEventListener("mousemove", function (e) {
      const vp = getViewport();
      const p = Input.toWorld(e, canvas, vp);
      Input.hover = Input.computeHover(getState(), p.x, p.y);
      canvas.style.cursor =
        (Input.hover.bridgeId ||
         (Input.hover.candidate && Input.hover.candidate.legal)) ? "pointer" : "default";
    });

    canvas.addEventListener("mouseleave", function () {
      Input.hover = null;
      canvas.style.cursor = "default";
    });
  }

  // 点击/触摸：tap 在移动端浏览器中会触发 click，映射保持一致
  canvas.addEventListener("click", function (e) {
    const vp = getViewport();
    const p = Input.toWorld(e, canvas, vp);
    if (handlers.onClickWorld) handlers.onClickWorld(p.x, p.y);
  });
};

/** 屏幕坐标 → 世界坐标（渲染的逆变换） */
Input.toWorld = function (e, canvas, vp) {
  const rect = canvas.getBoundingClientRect();
  const sx = e.clientX - rect.left;
  const sy = e.clientY - rect.top;
  return {
    x: (sx - vp.offsetX) / vp.scale,
    y: (sy - vp.offsetY) / vp.scale,
  };
};

/** 计算悬停信息：优先命中桥（可拆），否则是建桥候选位置 */
Input.computeHover = function (state, wx, wy) {
  const b = Logic.bridgeAtPoint(state, wx, wy);
  if (b) return { bridgeId: b.id, candidate: null };
  const c = Logic.buildCandidate(state, wx, wy);
  return { bridgeId: null, candidate: c };
};
