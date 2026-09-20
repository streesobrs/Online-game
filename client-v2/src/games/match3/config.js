/**
 * 消消乐玩法配置（开发方案 6.4）
 * 本文件是客户端游戏层数值的唯一来源：逻辑代码中不得出现魔法数字
 *
 * 三层配置边界（不要跨层乱放）：
 * - 本文件             客户端游戏层参数：影响玩法与表现，随客户端版本发布
 * - levels.js          单关数值：棋盘尺寸、mask、步数、目标、障碍、星级阈值
 * - server/config.js   服务端参数：经验奖励、反刷分阈值（客户端不持有）
 */

/** 棋盘尺寸限制（与 server/config.js 的 levelLimits.match3 对应） */
export const BOARD_LIMITS = {
  minRows: 8,
  maxRows: 12,
  minCols: 8,
  maxCols: 10,
  maxCells: 120,
};

/** 元素种类限制 */
export const COLOR_LIMITS = {
  min: 5,
  max: 8,
  default: 6,
};

/** 颜色名称（关卡目标与 HUD 文案用，顺序与 styles.css 的 .m3-c1 ~ .m3-c8 对应） */
export const COLOR_NAMES = {
  1: '红',
  2: '蓝',
  3: '绿',
  4: '黄',
  5: '紫',
  6: '橙',
  7: '青',
  8: '粉',
};

/**
 * 障碍物（开发方案 4.1 目标类型 ③）
 * 三种障碍共用一套规则，只有 hp 与表现不同；hp 可在关卡里逐格覆盖
 */
export const BLOCKERS = {
  ice: { hp: 2, label: '❄️', name: '冰块' },
  lock: { hp: 1, label: '🔒', name: '锁链' },
  stone: { hp: 3, label: '🪨', name: '石头' },
};

/** 障碍受击规则 */
export const BLOCKER_RULES = {
  damageAdjacent: true,       // 相邻格被消除时也造成伤害
  damagePerHit: 1,            // 每次命中扣减的 hp
};

/** 障碍种类（校验用） */
export const BLOCKER_KINDS = Object.keys(BLOCKERS);

/** 特殊元素标识 */
export const SPECIAL = {
  ROW: 'row',
  COL: 'col',
  BOMB: 'bomb',
  RAINBOW: 'rainbow',
};

/** 匹配形态：普通 3 连不生成特殊元素 */
export const SHAPE = {
  NORMAL: 'normal',
  ROW: SPECIAL.ROW,
  COL: SPECIAL.COL,
  BOMB: SPECIAL.BOMB,
  RAINBOW: SPECIAL.RAINBOW,
};

/** 匹配规则 */
export const MATCH_RULES = {
  minRunLength: 3,            // 触发消除的最短连线
  stripedRunLength: 4,        // 直线 4 连 → 条状
  rainbowRunLength: 5,        // 直线 5 连 → 彩球
  rainbowColor: null,         // 彩球不持有颜色，不参与同色匹配
  maxInitialFixRounds: 64,    // 初始棋盘消除现成三连的最大轮次
};

/** 特殊元素触发规则 */
export const SPECIAL_RULES = {
  maxTriggerChain: 64,        // 级联触发上限，防止递归失控（开发方案 3.5）
  bombRadius: 1,              // 炸弹半径，1 → 3×3
};

/** 计分规则 */
export const SCORE = {
  perTile: 30,                // 每消除一个方块的基准分
  cascadeStep: 0.5,           // 连锁倍率步长：第 n 连锁 = 1 + step × (n - 1)
  cascadeMax: 5,              // 连锁倍率上限
  blockerBonus: 40,           // 击碎一个障碍的额外分
  specialBonus: {             // 触发特殊元素的额外分
    row: 30,
    col: 30,
    bomb: 50,
    rainbow: 80,
  },
};

/** 闯关模式星级判定（开发方案 4.1）：剩余步数占比决定 2 / 3 星 */
export const STAR_RULES = {
  threeStarRemainRatio: 0.4,
  twoStarRemainRatio: 0.1,
};

/** 无尽模式难度分档：按累计分数提升元素种类（开发方案 5.2） */
export const ENDLESS_TIERS = [
  { minScore: 0, colors: 4 },
  { minScore: 50000, colors: 5 },
  { minScore: 150000, colors: 6 },
  { minScore: 200000, colors: 7 },
  { minScore: 300000, colors: 8 },
];

/**
 * 颜色数得分倍率（**仅无尽模式启用**）
 *
 * 颜色越少越容易连锁。实测每步平均得分（8×8 标准盘、随机选可行步、每档 24 局）：
 *   4色 730 / 5色 314 / 6色 180 / 7色 141 / 8色 131
 * 这个差值极不对称——少 2 色得分高 4 倍，多 2 色只低 27%。
 * 不归一的话，4 色阶段会几步冲过升档门槛，一进 8 色分数几乎不涨。
 *
 * 倍率按上表反向补偿，让「每步有效得分」随颜色数递增（365 → 377 → 396 → 451 → 498），
 * 做到"颜色越多越难连锁，但每分越值钱"。
 *
 * 整体量级由「门槛 ÷ 目标时长」定：ENDLESS_TIERS 的门槛共 30 万分，要压在 25 分钟
 * （每步约 2 秒 → 约 750 步）内走完，各档有效得分就得落在 350 ~ 500 区间。
 * 门槛若调整，这里要跟着等比改，否则时长会跟着变。
 * 累计耗时：到 5 色约 4.6 分钟、6 色约 13.4 分钟、7 色约 17.6 分钟、8 色约 25 分钟。
 *
 * 闯关模式不启用：关卡颜色数由 levels.js 逐关指定，30 关目标值已按真实得分标定。
 */
export const COLOR_SCORE_MULTIPLIER = {
  4: 0.5,
  5: 1.2,
  6: 2.2,
  7: 3.2,
  8: 3.8,
};

/** 取某颜色数对应的得分倍率（表外颜色数按 1 处理，即不缩放） */
export function colorScoreMultiplier(colors) {
  return COLOR_SCORE_MULTIPLIER[colors] || 1;
}

/** 无尽模式棋盘：固定标准矩形，保证所有玩家面对同一棋盘（开发方案 5.1） */
export const ENDLESS = {
  rows: 8,
  cols: 8,
  type: 'endless',
};

/**
 * 无尽三色模式（开发方案 5.5）：主打爽快感，不做难度曲线
 *
 * - 固定 3 色，**不随分数升档**：靠「连锁越来越长」而不是颜色数制造难度
 * - 不启用颜色数得分倍率（colorScaling=false）：分数就是最原始的爽感，不缩放
 * - 成绩与标准无尽完全隔离（独立榜单、独立经验、独立反刷分上限），
 *   否则每步得分高一个量级会把标准无尽榜与 highScore 成就顶满
 *
 * colors=3 低于 COLOR_LIMITS.min（那是关卡校验的下限，防止关卡设计得太容易连锁），
 * 这里是有意为之：本模式的全部卖点就是「怎么消都能连锁」。
 * 实测每步均分：3 色约 16,600，4 色约 2,400（8×8、人类水平走子）
 */
export const ENDLESS3 = {
  rows: 8,
  cols: 8,
  colors: 3,
  type: 'endless3',
};

/** 本地存档键（开发方案 8） */
export const STORAGE_KEYS = {
  progress: 'match3Progress',
  best: 'match3Best',
  session: 'match3Session',
  bestEndless3: 'match3BestEndless3',
  sessionEndless3: 'match3SessionEndless3',
};

/** 洗牌规则 */
export const SHUFFLE = {
  maxAttempts: 8,             // 区域洗牌 / 初始生成的最大重试次数
  minPlayableRatio: 0.3,      // mask 至少保留的可玩格子比例
};

/** 表现参数（毫秒），统一在此调整手感 */
export const ANIM = {
  swap: 150,
  clear: 200,
  fall: 250,
  refill: 120,
};

/** 棋盘布局（异形棋盘用绝对定位，不依赖统一 grid 布局） */
export const LAYOUT = {
  cellSize: 48,
  dragThreshold: 12,          // 拖拽多少像素后判定为一次交换操作
};
