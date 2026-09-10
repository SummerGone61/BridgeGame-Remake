"use strict";

/**
 * ============================================================
 * theme-ui.js —— 主题相关的界面组件（外观层的 UI 部分）
 *
 * 职责：
 *   1) 依据主题注册表（Theme.order）动态生成设置面板里的"主题选择器"，
 *      新增主题无需改 HTML；
 *   2) 持有"主题模式"这一外观偏好（auto / 具体主题 id）并负责持久化；
 *   3) 把逻辑层给出的难度档位信号（DIFF）翻译成换肤动作（仅 auto 模式）；
 *   4) 生成主题化的生命图标（图标由主题提供内联 SVG）。
 *
 * 与逻辑层的关系：只读 getDiff() 这一个信号，不读分数、不读时间、不改规则。
 * ============================================================
 */

const ThemeUI = {};

/** 主题未提供图标时的兜底（保证任何情况下界面不出现空洞） */
ThemeUI.FALLBACK_LIFE =
  '<svg viewBox="0 0 32 28" aria-hidden="true">' +
  '<path d="M16 26C6 18.4 2 14.2 2 9.4 2 5.2 5.2 2 9.4 2c2.9 0 5.3 1.6 6.6 4 1.3-2.4 3.7-4 6.6-4C26.8 2 30 5.2 30 9.4 30 14.2 26 18.4 16 26z" ' +
  'fill="currentColor"/></svg>';

/* ---- 主题模式（外观偏好，唯一状态）---- */
ThemeUI.mode = "auto";
ThemeUI.getDiff = function () { return 1; };
ThemeUI.onSelect = null;

/** 当前模式解析出的实际主题名 */
ThemeUI.resolve = function () {
  return Theme.resolveName(ThemeUI.mode, ThemeUI.getDiff());
};

/** 应用当前模式对应的主题（silent：不触发洗版动画） */
ThemeUI.apply = function (silent) {
  const name = ThemeUI.resolve();
  const changed = name !== Theme.current;
  Theme.apply(name);
  if (changed && !silent) Theme.wash();
  return name;
};

/** 难度档位变化时调用（仅 auto 模式会换肤；固定模式下保持不变） */
ThemeUI.notifyDiff = function () {
  if (ThemeUI.mode !== Theme.MODE.auto) return;
  const name = ThemeUI.resolve();
  if (name !== Theme.current) {
    Theme.apply(name);
    Theme.wash();
  }
};

/** 用户在选择器中做出选择 */
ThemeUI.setMode = function (mode) {
  const valid = (mode === Theme.MODE.auto) || Theme.has(mode);
  if (!valid) return;
  const prev = Theme.current;
  ThemeUI.mode = mode;
  Theme.saveMode(mode);
  Theme.apply(ThemeUI.resolve());
  if (Theme.current !== prev) Theme.wash();
  ThemeUI.refresh();
  if (typeof ThemeUI.onSelect === "function") ThemeUI.onSelect(mode);
};

/* ============================================================
 * 主题选择器
 * ============================================================ */

/** 生成一张主题卡片的缩略色卡背景（取自主题自述的 preview 数据） */
ThemeUI.swatchStyle = function (def) {
  const pv = def.preview || {};
  const bg = pv.bg || "#1a1a1a";
  const bg2 = pv.bg2 || bg;
  return "background: linear-gradient(135deg, " + bg + " 0%, " + bg2 + " 100%);";
};

function makeCard(kind, def) {
  const card = document.createElement("button");
  card.type = "button";
  card.className = "theme-card" + (kind === "auto" ? " is-auto" : "");
  card.setAttribute("role", "radio");
  card.setAttribute("aria-checked", "false");
  card.dataset.mode = kind === "auto" ? Theme.MODE.auto : def.id;

  const swatch = document.createElement("span");
  swatch.className = "tc-swatch";

  if (kind === "auto") {
    const band = document.createElement("span");
    band.className = "tc-auto-band";
    swatch.appendChild(band);
    // 自动卡：把各主题的代表色做成小圆点，直观表达"轮换全部主题"
    Theme.order.forEach(function (id) {
      const d = Theme.definitions[id];
      const pv = (d && d.preview) || {};
      const dot = document.createElement("i");
      dot.style.background = (pv.dots && pv.dots[0]) || (d && d.palette.accent) || "#999";
      dot.title = d ? d.label : id;
      swatch.appendChild(dot);
    });
  } else {
    const pv = def.preview || {};
    swatch.setAttribute("style", ThemeUI.swatchStyle(def));
    (pv.dots || []).forEach(function (c) {
      const dot = document.createElement("i");
      dot.style.background = c;
      swatch.appendChild(dot);
    });
  }

  const nameRow = document.createElement("span");
  nameRow.className = "tc-name";
  const nameText = document.createElement("span");
  nameText.textContent = kind === "auto" ? "自动 · 跟随难度" : def.label;
  const check = document.createElement("span");
  check.className = "tc-check";
  check.textContent = "✓";
  nameRow.appendChild(nameText);
  nameRow.appendChild(check);

  const tag = document.createElement("span");
  tag.className = "tc-tag";
  tag.textContent = kind === "auto"
    ? "难度每升一档轮换一款主题"
    : (def.tagline || "");

  card.appendChild(swatch);
  card.appendChild(nameRow);
  card.appendChild(tag);

  card.addEventListener("click", function () { ThemeUI.setMode(card.dataset.mode); });
  return card;
}

/**
 * 挂载主题选择器。
 * @param {HTMLElement} container 容器（设置面板中的 #themePicker）
 * @param {object} opts { note, getDiff }
 */
ThemeUI.mount = function (container, opts) {
  opts = opts || {};
  ThemeUI.getDiff = opts.getDiff || function () { return 1; };
  ThemeUI.mode = Theme.loadMode();

  container.textContent = "";
  const cards = [];

  const autoCard = makeCard("auto", null);
  container.appendChild(autoCard);
  cards.push(autoCard);

  Theme.order.forEach(function (id) {
    const card = makeCard("theme", Theme.definitions[id]);
    container.appendChild(card);
    cards.push(card);
  });

  // 键盘左右切换（radiogroup 的常见交互）
  container.addEventListener("keydown", function (e) {
    const k = e.key;
    if (k !== "ArrowRight" && k !== "ArrowLeft" && k !== "ArrowDown" && k !== "ArrowUp") return;
    const cur = cards.findIndex(function (c) { return c.dataset.mode === ThemeUI.mode; });
    const step = (k === "ArrowRight" || k === "ArrowDown") ? 1 : -1;
    const next = cards[(cur + step + cards.length) % cards.length];
    if (next) { e.preventDefault(); next.focus(); ThemeUI.setMode(next.dataset.mode); }
  });

  ThemeUI._cards = cards;
  ThemeUI._note = opts.note || null;
  ThemeUI.refresh();

  // 初始应用（静默：进入页面不做洗版动画）
  ThemeUI.apply(true);
  return ThemeUI;
};

/** 同步选择器状态与说明文字（换肤后调用） */
ThemeUI.refresh = function () {
  const cards = ThemeUI._cards || [];
  cards.forEach(function (c) {
    c.setAttribute("aria-checked", c.dataset.mode === ThemeUI.mode ? "true" : "false");
  });
  const note = ThemeUI._note;
  if (!note) return;
  const cur = Theme.get() ? Theme.get().label : "";
  // 两种模式的说明文字都控制在一行左右（配合 CSS 的 min-height 固定两行高度），
  // 这样切换"自动/固定"时设置面板的尺寸完全不变。
  if (ThemeUI.mode === Theme.MODE.auto) {
    note.textContent = "自动：难度每升一档依次轮换 " + Theme.order.length + " 款外观，当前为「" + cur + "」。";
  } else {
    note.textContent = "已固定为「" + cur + "」：难度变化不再切换外观。";
  }
};

/* ============================================================
 * 主题化生命图标（图标由主题提供，逻辑层不参与）
 * ============================================================ */

/**
 * 在容器内生成 count 个生命图标，并返回一个控制器：
 *   set(n) → 显示前 n 个；若本次有图标被消耗，返回该图标消耗前的 DOMRect（供碎裂动画使用）。
 * 主题切换时自动替换图标外观，且保持当前存活数量。
 */
ThemeUI.mountLives = function (container, count) {
  const n = count || 5;
  const icons = [];
  container.textContent = "";
  for (let i = 0; i < n; i++) {
    const s = document.createElement("span");
    s.className = "life-icon";
    container.appendChild(s);
    icons.push(s);
  }

  let shown = n;

  function paint() {
    const def = Theme.get();
    const svg = (def && def.livesIcon) || ThemeUI.FALLBACK_LIFE;
    for (let i = 0; i < n; i++) {
      icons[i].innerHTML = svg;
      icons[i].style.display = i < shown ? "inline-block" : "none";
    }
  }
  paint();

  // 换肤时重绘图标（外观层内部自洽，不需要装配层介入）
  Theme.onChange(function () { paint(); });

  return {
    /** @returns {DOMRect|null} 被消耗的图标位置（用于碎裂动画） */
    set: function (v) {
      const want = Math.max(0, Math.min(n, v | 0));
      let lostRect = null;
      if (want < shown) {
        for (let i = shown - 1; i >= want; i--) {
          if (icons[i].style.display !== "none") lostRect = icons[i].getBoundingClientRect();
          icons[i].style.display = "none";
        }
      }
      shown = want;
      return lostRect;
    },
    /** 当前显示中的图标数量（装配层据此判断"生命是否变化"） */
    getShown: function () { return shown; },
    count: n,
  };
};
