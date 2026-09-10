"use strict";

/**
 * ============================================================
 * config.js —— 常量配置
 * 严格依据《游戏设计说明书_v1.0》与已确认参数：
 *   - 单次正确投递得分 = 1（保留扩展点，见 scoreFor）
 *   - 通路总长 H = 9W + 9S
 *   - 安全余量 S = 0.25W
 *   - 物品进入仓库即从界面移除；仓库底部边界只要仍有容纳桥的空间即可建桥
 * v10：视觉资产（配色/形状/尺寸/动画）已迁出至 theme.js，实现视觉与逻辑解耦。
 * ============================================================
 */

const Config = {};

// ---- 桥宽 W（世界单位，基础单位）----
// v03（用户要求）：调整为 v02 的 1/4（40 → 10）
Config.bridgeWidth = 10;

// ---- 安全余量 S = 0.25 * W（用户确认规则，随 W 缩放）----
Config.safety = 0.25 * Config.bridgeWidth;              // = 2.5

// ---- 通路总长 H（场地高度）----
// v02 中 H = 9W + 9S = 450 是 W=40 时的初始设置；本次用户只要求把桥宽改为 1/4，
// 场地尺寸与游戏节奏保持不变（H 仍为 450）。文档约束依然严格满足：
//   D > W + S（60 > 12.5）✓；H ≫ 4W + 4S（450 ≫ 50）✓（§16）
Config.laneLength = 450;

// ---- 相邻通路间距 D（横向）----
// 保持不变（60），严格满足文档 §12/§15 的 D > W + S = 12.5。
// D 同时等于"一次过桥期间其他物品的纵向位移"（桥上物品只水平移动且速度相同）。
Config.laneSpacing = 60;

// ---- 场地横向留白（随桥宽收窄，纯布局）----
Config.sideMargin = Config.bridgeWidth;                 // = 10

// ---- 通路数 / 仓库对应关系（文档 §2：L1→A ... L5→E）----
Config.laneCount = 5;
Config.laneWarehouse = ["A", "B", "C", "D", "E"];

// ---- 物品类型（文档 §3.1：五类，MVP 等概率各 20%）----
Config.types = ["A", "B", "C", "D", "E"];
Config.typeTarget = { A: 0, B: 1, C: 2, D: 3, E: 4 };   // 类型 → 目标通路（仓库）

// ---- 物品（文档 §3.2 质点 / §4 所有物品同速匀速）----
// v09（用户要求）：默认初始下落速度 = 原值 × 0.75（50 → 37.5）
Config.itemSpeed = 50 * 0.75;   // = 37.5 世界单位/秒（平衡参数，可调）

// ---- 难度梯度（文档 §28 分数驱动 + v03 用户要求：每得 15 分生成密度提高一档）----
// v09（用户要求）：默认初始生成速度 = 原值 × 0.5（速率减半 → 初始间隔 ×2：2.8 → 5.6）
// 难度递增曲线不变（档位分数 / 倍率 / 下限均保持原值）。
Config.spawnTierScore = 15;      // 每档所需分数
Config.spawnBaseInterval = 2.8 * 2;   // 开局（第 1 档）生成间隔（秒）＝ 5.6
Config.spawnMinInterval = 0.7;   // 最低生成间隔（档位下限）
Config.spawnTierFactor = 0.85;   // 每档间隔乘性倍率（平衡参数，可调）

// ---- 计分（用户确认：MVP 固定 +1；扩展点：未来附魔/特殊物品差异化计分）----
Config.scoreFor = function (/* item */) {
  return 1;
};

// ---- 生成间隔（分档难度曲线，平衡参数，可调）----
// 档位 tier = floor(score / spawnTierScore)，每进一档间隔 × spawnTierFactor，
// 下限为 spawnMinInterval。开局（tier=0）保持宽松，随得分分档递增。
Config.spawnInterval = function (score) {
  const tier = Math.floor(score / Config.spawnTierScore);
  return Math.max(Config.spawnMinInterval,
                  Config.spawnBaseInterval * Math.pow(Config.spawnTierFactor, tier));
};

// ---- 派生几何量 ----
Config.laneXs = [];
for (let i = 0; i < Config.laneCount; i++) {
  Config.laneXs.push(Config.sideMargin + i * Config.laneSpacing);  // 10,70,130,190,250
}
Config.worldWidth = Config.sideMargin * 2 + (Config.laneCount - 1) * Config.laneSpacing; // = 260
Config.worldHeight = Config.laneLength;                            // = 450

// ---- 视觉配置已迁移至 theme.js（§1 视觉与逻辑解耦）----
// 颜色 / 形状 / 尺寸 / 动画时长等视觉资产统一由 Theme 管理，
// 本文件只保留游戏规则与平衡参数，后续新增主题无需改动本文件。
