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

/**
 * 元素种类限制
 *
 * min 为 4：碎格子（有洞 / 分仓）棋盘因为没有完整行可借力，
 * 颜色一多就频繁出现「无可行步 → 只能靠系统洗牌」，
 * 关卡颜色数上限因此压到 4 色（见 levels.js 第 2 / 3 章）。
 */
export const COLOR_LIMITS = {
  min: 4,
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

/**
 * 肉鸽试炼（娱乐玩法，开发方案 5.6）
 *
 * 与两种无尽玩法的根本区别：**这是一局多层的 run**，不是单盘长跑。
 * - 每层重新生成 8×8 标准盘，限步内本层得分达标即过关，步数随层数缓慢增长
 * - 过关后从祝福池（perks.js）三选一，祝福在本轮内累计，层数越高目标分越高
 * - 步数耗尽仍未达标即本轮结束，结算「到达层数 + 本轮总分」（可用「免死金牌」祝福抵消一次）
 *
 * 目标分 = baseGoal × goalGrowth^(层数-1) × (1 + perkGoalWeight × (层数-1)) × (1 - 目标减免)
 * 本层步数 = movesPerFloor + 祝福加成 + floor((层数-1) / movesPerFloorStep)
 *
 * **层数成长来源**：棋盘参数只由祝福决定，祝福一旦叠满，每层能打出的分数就固定了。
 * 若没有随层数增长的来源，目标分指数曲线迟早越过这条「可达分平台」，run 必然在固定层数猝死，
 * 且后期分数横盘（实测：无层数成长时 4 色 ×2.07 的 build 从第 10 层起稳定在 2 万上下，
 * 第 15 层目标 46,776 直接打不动）。因此每 movesPerFloorStep 层多发 1 步，
 * 让可达分随层数线性上涨（实测第 1 层 1,545 → 第 20 层 163,974），玩家能持续看到分数变高。
 *
 * 数值由 tests/match3-rogue-balance.mjs 的模拟标定（8×8 随机走子、每层 3 次采样取中位、理性三选一）：
 * 16 次 run 的到达层数为 中位 22 · p25 21 · 最低 17 · 无首层翻车，达成率全程落在 1.2~6.9 倍；
 * 模拟用的是随机走子，真人水平会再高几层。改本组数值前先重跑该脚本，否则「能打几层」会跟着漂。
 */
export const ROGUE = {
  type: 'rogue',
  rows: 8,
  cols: 8,
  colors: 6,            // 基准元素种类；「极简主义」祝福在此基础上下调，下限 minColors
  minColors: 4,         // 颜色数下限：4 色以下（3 色）每步得分会暴涨约 10 倍，留给无尽三色
  movesPerFloor: 10,    // 每层基准步数（「补给包」祝福与层数成长都在这之上叠加）
  movesPerFloorStep: 2, // 层数成长来源：每 N 层多发 1 步
  baseGoal: 900,        // 第 1 层目标分（6 色 10 步的中位分约 1750，首层几乎必过）
  goalGrowth: 1.33,     // 每层目标分的增长系数（配合层数成长祝福：倍率随深度线性上涨，目标指数上涨，两者在 28 层上下交汇）
  perkGoalWeight: 0.1,  // 每层额外提高目标分的比例（与层数挂钩）
  perkChoices: 3,       // 每次过关给出几个祝福备选
  friendlyPicks: 2,     // 前几次三选一只出成长类祝福，避免开局连出保命牌导致第 2 层就翻车
  shieldMoves: 3,       // 「免死金牌」生效时补的步数
  magnetMult: 1.7,      // 「同色磁石」每叠一层的出现权重倍率（权重数组见 perks.js 的 floorOptions）
  // 标定（tests/match3-rogue-balance.mjs，10 步中位分）：
  //   6 色 ×1=1755 ×1.7=1935 ×2.9=2205 ×4=3080（温和）
  //   4 色 ×1=6155 ×1.7=7670 ×2.9=12075 ×4=20145（越过 ×3 后连锁密度突变，收益非线性起飞）
  // 叠满上限（max 2）×1.7² = ×2.89 正好卡在爆发点之前：既是「改了机制」的强牌，又不会让盘面一色独大到自动连
  /**
   * 局内任务（肉鸽专属机制，见 perks.js 的 questFor / QUEST_REWARDS）
   * 每层随机给一个「收集某颜色 N 个」的目标，**不设失败惩罚**，达成即当场发放一个改机制的奖励；
   * 它的定位是给层内制造一个额外的决策焦点（要不要为了它换一种消法），而不是加难度
   */
  quest: {
    fromFloor: 2,       // 从第几层开始出任务（第 1 层步数少、还没祝福，给不出决策空间）
    baseNeed: 16,       // 第 1 层的收集目标数
    // 每层目标数的增长系数。模拟里「实际能收到的个数」按约 ×1.11/层上涨，
    // needGrowth 取 1.12（略高于它）：前期轻松达成，约第 27 层起追不上，
    // 全程达成率约 60%——正好是「想拿就得主动换一种消法」的强度
    needGrowth: 1.12,
    movesReward: 5,     // 「补给」奖励：立即追加步数
    frenzyMult: 2,      // 「狂暴」奖励：本层剩余步数内的得分倍率
    specialsReward: 2,  // 「爆破」奖励：场上随机变成条状的个数
  },
};

/** 本地存档键（开发方案 8） */
export const STORAGE_KEYS = {
  progress: 'match3Progress',
  best: 'match3Best',
  session: 'match3Session',
  bestEndless3: 'match3BestEndless3',
  sessionEndless3: 'match3SessionEndless3',
  rogueBest: 'match3BestRogue',   // 肉鸽试炼最佳：{ maxFloor, highScore }
  rogueSession: 'match3SessionRogue', // 肉鸽试炼未结算的一轮（5.6 的暂存）
};

/**
 * 局内暂存与云同步（开发方案 5.4 / 8）
 *
 * 暂存 = 「未结算的一局」。本地每次状态变化都覆盖写（刷新即续），
 * 云端按下面的节奏收一份，于是换设备 / 清缓存后仍能接着打。
 */
export const SESSION = {
  cloudPushMs: 15000,     // 云端上传的最小间隔：局内每次连锁都会回调，只能按节奏推，不能跟着写
  maxAgeMs: 7 * 24 * 60 * 60 * 1000, // 与 server/config.js 的 match3Session.maxAgeMs 一致：更旧的暂存不再提示续玩
};

/**
 * 玩法 key → 本地暂存键
 *
 * 云端 `sessions` 按同一套 key 分档（见 sync.js 的 pushSession 与 server.js 的
 * match3_save_session），所以两边永远对得上，不需要各维护一份映射。
 */
export const SESSION_KEYS = {
  [ENDLESS.type]: STORAGE_KEYS.session,
  [ENDLESS3.type]: STORAGE_KEYS.sessionEndless3,
  [ROGUE.type]: STORAGE_KEYS.rogueSession,
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
