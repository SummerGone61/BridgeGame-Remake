"use strict";

/**
 * ============================================================
 * logic.js —— 游戏逻辑核心（纯函数，无 DOM / Canvas / 输入依赖）
 * 规则来源：《游戏设计说明书_v1.0》
 *   §3 物品质点模型、§4 同速匀速向下、§4.1 自动进桥、§4.2 桥上只水平移动、
 *   §5 桥双向、§6 仅相邻通路、§6.1 任意纵向位置、§7 桥宽 W、
 *   §8 桥纵向不重叠（同一通路对可多座）、§9 桥上有物品不可删除、
 *   §11 全局随机生成、§12 同路径连续生成约束、§17-§22 阶梯过桥案例、
 *   §25 得分、§26 生命与 Game Over、§28 分数驱动难度、§29 暂停
 * v02 范围：桥梁系统（建/拆/合法性/自动进桥/水平过桥）
 * ============================================================
 */

const Logic = {};

/**
 * 创建初始游戏状态（文档 §26：初始 5 条命，不可恢复）
 */
Logic.createInitialState = function () {
  return {
    items: [],          // { id, type, lane, y, x, target, onBridge, crossDir }
    bridges: [],        // { id, lanes: [a, b]（相邻且 a<b）, y }
    score: 0,           // 本局分数（与生命相互独立，§25）
    lives: 5,           // 生命，初始 5
    paused: false,
    gameOver: false,
    elapsed: 0,         // 累计游戏时间（暂停不计入，§29）
    nextSpawnAt: Config.spawnBaseInterval,
    itemSeq: 0,         // 物品自增 id
    bridgeSeq: 0,       // 桥自增 id
  };
};

/**
 * 难度档位（DIFF，§28）：floor(score / spawnTierScore) + 1，开局为 Lv.1。
 * 纯逻辑信号：供 HUD 显示，并作为视觉层日夜主题切换的触发信号（§3.4/§9.6）。
 * 注意：视觉层（theme/render）不得自行据此判断，只接收本层给出的信号。
 */
Logic.diffLevel = function (state) {
  return Math.floor(state.score / Config.spawnTierScore) + 1;
};

/**
 * 推进游戏一帧（固定步长 dt，单位：秒）。
 * 文档 §29：暂停时停止物品移动 / 生成 / 计时 / 状态变化。
 * 文档 §26：生命归 0 立即 Game Over，之后世界冻结。
 */
Logic.update = function (state, dt, settings) {
  if (state.paused || state.gameOver) return;

  // settings（v04 滑轨）：{ speedFactor, spawnFactor }，缺省为 1（即原始配置）
  const S = settings || { speedFactor: 1, spawnFactor: 1 };

  state.elapsed += dt;

  // ---- 生成（§11 全局随机生成器 + §12 同路径连续生成约束）----
  if (state.elapsed >= state.nextSpawnAt) {
    Logic.trySpawn(state, S);
  }

  // ---- 物品移动 ----
  const v = Config.itemSpeed * S.speedFactor;   // 有效速度（滑轨可调，所有物品仍同速）
  for (const item of state.items) {
    if (item.onBridge === null) {
      // 在通路上：匀速向下（§4）
      const prevY = item.y;
      item.y += v * dt;
      item.x = Config.laneXs[item.lane];

      // 进桥检测（§4.1）：物品自上而下进入桥的纵向范围，且桥连接当前通路 → 自动进桥
      for (const b of state.bridges) {
        if (b.lanes[0] !== item.lane && b.lanes[1] !== item.lane) continue;
        const top = b.y - Config.bridgeWidth / 2;
        if (prevY <= top && item.y >= top) {
          Logic.enterBridge(item, b);
          break;
        }
      }
    } else {
      // 在桥上：只水平移动，纵向锁定（§4.2），到达另一端后回到通路继续向下
      const b = Logic.findBridge(state, item.onBridge);
      if (!b) {
        // 防御分支（按 §9 桥上有物品时不可删除，正常不会发生）
        item.onBridge = null;
        item.crossDir = 0;
        continue;
      }
      const target = item.lane + item.crossDir;
      const targetX = Config.laneXs[target];
      item.x += item.crossDir * v * dt;
      // 浮点容差（1e-9）：补偿 x 逐帧累加的舍入误差，使"到达另一端"在恰好的步数触发
      if ((item.crossDir > 0 && item.x >= targetX - 1e-9) ||
          (item.crossDir < 0 && item.x <= targetX + 1e-9)) {
        item.lane = target;
        item.x = targetX;
        item.onBridge = null;
        item.crossDir = 0;
      }
    }
  }

  // ---- 投递（用户确认：物品进入仓库即从界面移除）----
  const kept = [];
  for (const item of state.items) {
    if (item.onBridge === null && item.y >= Config.laneLength) {
      Logic.deliver(state, item);
    } else {
      kept.push(item);
    }
  }
  state.items = kept;
};

/**
 * 物品进入桥（§4.1/§5）：
 *   - 桥没有方向，行进方向由物品所在通路决定（§5）；
 *   - 进入后纵向锁定于桥中心（§4.2：桥上只水平移动，不产生垂直位移）。
 */
Logic.enterBridge = function (item, b) {
  item.onBridge = b.id;
  item.crossDir = (b.lanes[1] === item.lane) ? -1 : 1;
  item.y = b.y;
  item.x = Config.laneXs[item.lane];
};

/**
 * 玩家意图入口：{ kind: "build", laneA, laneB, y } 或 { kind: "delete", bridgeId }
 * 系统按规则判定：合法 → 执行；不合法 → 静默不执行（§6.1）。
 */
Logic.applyIntent = function (state, intent) {
  if (!intent) return false;

  if (intent.kind === "build") {
    const { laneA, laneB, y } = intent;
    if (!Logic.canBuildAt(state, laneA, laneB, y)) return false;
    const lo = Math.min(laneA, laneB);
    const hi = Math.max(laneA, laneB);
    const bridge = { id: state.bridgeSeq++, lanes: [lo, hi], y: y };
    state.bridges.push(bridge);

    // §4.1 建桥即时生效：位于桥纵向范围内、且在被连接通路上的物品立即进桥
    // （文档 §17 Case 0 的提示：在多个物品同高处建桥会使它们同时发生路线变化）
    const top = y - Config.bridgeWidth / 2;
    const bottom = y + Config.bridgeWidth / 2;
    for (const item of state.items) {
      if (item.onBridge !== null) continue;
      if (item.lane !== lo && item.lane !== hi) continue;
      if (item.y >= top && item.y <= bottom) Logic.enterBridge(item, bridge);
    }
    return true;
  }

  if (intent.kind === "delete") {
    const idx = state.bridges.findIndex(b => b.id === intent.bridgeId);
    if (idx < 0) return false;
    if (Logic.hasItemOnBridge(state, intent.bridgeId)) return false;   // §9
    state.bridges.splice(idx, 1);
    return true;
  }

  return false;
};

/**
 * 建桥合法性（§6 仅相邻通路 / §6.1 任意纵向位置 / §7 桥宽 / §8 纵向不重叠）：
 *   - 只连接相邻通路；
 *   - 桥的纵向范围 [y-W/2, y+W/2] 必须完整落在 [0, H] 内
 *     （用户确认：贴近仓库底部的边界只要仍有容纳桥的空间即可建桥）；
 *   - 纵向不重叠约束仅作用于"共享通路"的两座桥（v03 修正，用户确认）：
 *     相邻通路对的桥（共享一条通路）不能在纵向位置重叠（§8 示例）；
 *     不共享通路的桥（不相邻通路对）互不影响，可同高度共存。
 */
Logic.canBuildAt = function (state, laneA, laneB, y) {
  if (Math.abs(laneA - laneB) !== 1) return false;
  if (y - Config.bridgeWidth / 2 < 0) return false;
  if (y + Config.bridgeWidth / 2 > Config.laneLength) return false;
  for (const b of state.bridges) {
    const sharesLane =
      b.lanes[0] === laneA || b.lanes[0] === laneB ||
      b.lanes[1] === laneA || b.lanes[1] === laneB;
    if (sharesLane && Math.abs(b.y - y) < Config.bridgeWidth) return false;
  }
  return true;
};

/** 桥上是否有物品（§9：有则不可删除） */
Logic.hasItemOnBridge = function (state, bridgeId) {
  return state.items.some(it => it.onBridge === bridgeId);
};

/** 按 id 查找桥 */
Logic.findBridge = function (state, bridgeId) {
  return state.bridges.find(b => b.id === bridgeId) || null;
};

/** 命中检测：给定世界坐标，返回命中的桥（用于点击拆桥 / 悬停高亮） */
Logic.bridgeAtPoint = function (state, wx, wy) {
  for (const b of state.bridges) {
    const x1 = Config.laneXs[b.lanes[0]];
    const x2 = Config.laneXs[b.lanes[1]];
    if (wx >= x1 && wx <= x2 &&
        wy >= b.y - Config.bridgeWidth / 2 && wy <= b.y + Config.bridgeWidth / 2) {
      return b;
    }
  }
  return null;
};

/**
 * 建桥候选：给定世界坐标，若位于某对相邻通路之间，返回建桥意图候选
 * （用于点击建桥 / 幽灵预览），否则返回 null。
 */
Logic.buildCandidate = function (state, wx, wy) {
  for (let i = 0; i < Config.laneCount - 1; i++) {
    if (wx > Config.laneXs[i] && wx < Config.laneXs[i + 1]) {
      return {
        laneA: i,
        laneB: i + 1,
        y: wy,
        legal: Logic.canBuildAt(state, i, i + 1, wy),
      };
    }
  }
  return null;
};

/**
 * 投递结算（§25/§26）：
 *   正确（当前通路 == 目标仓库）→ 得分；
 *   错误 → 生命 -1；生命归 0 → 立即 Game Over。
 */
Logic.deliver = function (state, item) {
  if (item.lane === item.target) {
    state.score += Config.scoreFor(item);   // MVP：+1 分（可扩展）
  } else {
    state.lives -= 1;
    if (state.lives <= 0) {
      state.lives = 0;
      state.gameOver = true;
    }
  }
};

/**
 * 全局随机生成器（§11）：
 *   随机选通路 → 随机选物品类型（五类等概率，各 20%）→ 在通路起点生成。
 *
 * §12 同路径连续生成约束（实现解读）：
 *   同一条通路上，生成点（y=0）与最近物品之间的纵向间隙必须 ≥ D
 *   （文档推荐安全间隔 D，且 D > W + S），否则该通路本次不生成。
 *   若所有通路都暂时不合法，则本次不生成、下帧重试（不重置计时）。
 */
Logic.trySpawn = function (state, S) {
  const s = S || { spawnFactor: 1 };
  const threshold = Config.laneSpacing;   // D
  const legalLanes = [];
  for (let lane = 0; lane < Config.laneCount; lane++) {
    let nearestY = Infinity;
    for (const item of state.items) {
      if (item.lane === lane && item.y < nearestY) nearestY = item.y;
    }
    if (nearestY >= threshold) legalLanes.push(lane);
  }
  if (legalLanes.length === 0) return;    // 暂无合法通路，本次不生成

  const lane = legalLanes[(Math.random() * legalLanes.length) | 0];
  const type = Config.types[(Math.random() * Config.types.length) | 0];
  state.items.push({
    id: state.itemSeq++,
    type: type,
    lane: lane,
    y: 0,
    x: Config.laneXs[lane],
    target: Config.typeTarget[type],      // §3.2：每个物品拥有目标仓库
    onBridge: null,
    crossDir: 0,
  });
  // §28 难度（分档曲线）÷ 生成倍率（v04 滑轨，越大越密）
  state.nextSpawnAt = state.elapsed + Config.spawnInterval(state.score) / s.spawnFactor;
};
