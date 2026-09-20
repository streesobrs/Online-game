/**
 * 闯关模式关卡配置（开发方案 4.2 / 4.3）
 *
 * 30 关 = 3 章 × 10 关，章节按棋盘形态递进：
 * - 第 1 章：标准矩形，尺寸逐步变大，目标为得分 / 收集
 * - 第 2 章：异形（菱形 / 十字 / 环形 / 心形 / 阶梯 / 沙漏 / 蝴蝶结 / 三角 / 城堡 / 花朵），加入障碍
 * - 第 3 章：分仓多区域与混合形态，三类目标混用
 *
 * 数值标定方式（改目标值前先读这段）：
 * 元素种类数按棋盘形态分档，是主要的难度杠杆：
 * - 第 1 章 5 色（完整矩形，行 / 列贯通，连锁够用）
 * - 第 2 / 3 章 4 色（挖洞 / 分仓棋盘）：碎格子棋盘没有完整行列可借力，
 *   颜色一多就频繁出现「全盘无可行步 → 只能靠系统洗牌」的局面。
 *   实测 6 色时第 2 / 3 章有 6 关平均每 60 步要洗 3~7 次牌，降到 4 色后基本归零。
 * 每关目标值来自「贪心策略批量模拟」的三星线中位可达量乘以章节系数：
 * - 三星线 = moves × (1 - STAR_RULES.threeStarRemainRatio)
 * - 第 1 章 ×0.55（宽松）→ 第 2 章 ×0.7 → 第 3 章 ×0.85（吃紧）
 * - 多目标关卡每个目标再乘 0.9（双目标）/ 0.8（三目标），抵消同时达成的额外压力
 * 第 2 / 3 章由 6 色降 4 色时，目标值按「同策略下 4 色 / 6 色达成量之比」折算，
 * 保持原有难度手感（4 色连锁更长，达成量普遍涨 1.5~4 倍，目标同步上调）。
 * 调整棋盘尺寸 / 步数 / 颜色数后必须重新模拟，否则目标会重新变得不可达。
 *
 * 每关的 payload 都是纯数据（可 JSON 序列化），满足 UGC-ready 约束（4.5）：
 * 将来 UGC 关卡只是换一个数据来源，引擎入口汇合成同一种形态。
 * 新增 / 修改关卡后必须跑 `node client-v2/tests/match3-engine.test.js`，
 * 其中的「关卡配置」用例会用 validateLevel 逐关校验。
 */

/** 棋盘遮罩：1 = 可玩，0 = 洞（字符串数组便于手工设计关卡时阅读） */
const MASK = {
  /** 菱形 9×9 */
  diamond: [
    '000010000',
    '000111000',
    '001111100',
    '011111110',
    '111111111',
    '011111110',
    '001111100',
    '000111000',
    '000010000',
  ],
  /** 十字 9×9 */
  cross: [
    '001111100',
    '001111100',
    '111111111',
    '111111111',
    '111111111',
    '111111111',
    '111111111',
    '001111100',
    '001111100',
  ],
  /** 环形 9×9 */
  ring: [
    '111111111',
    '111111111',
    '110000011',
    '110000011',
    '110000011',
    '110000011',
    '110000011',
    '111111111',
    '111111111',
  ],
  /** 心形 9×9 */
  heart: [
    '011000110',
    '111101111',
    '111111111',
    '111111111',
    '111111111',
    '011111110',
    '001111100',
    '000111000',
    '000010000',
  ],
  /** 阶梯 10×9 */
  stair: [
    '111111111',
    '011111110',
    '001111100',
    '000111000',
    '000010000',
    '000010000',
    '000111000',
    '001111100',
    '011111110',
    '111111111',
  ],
  /** 沙漏 9×9 */
  hourglass: [
    '111111111',
    '111111111',
    '011111110',
    '001111100',
    '000111000',
    '001111100',
    '011111110',
    '111111111',
    '111111111',
  ],
  /** 蝴蝶结 9×9 */
  bowtie: [
    '111111111',
    '111111111',
    '111000111',
    '110000011',
    '100000001',
    '110000011',
    '111000111',
    '111111111',
    '111111111',
  ],
  /** 三角 10×9 */
  triangle: [
    '000010000',
    '000111000',
    '000111000',
    '001111100',
    '001111100',
    '011111110',
    '011111110',
    '111111111',
    '111111111',
    '111111111',
  ],
  /** 城堡 10×9 */
  castle: [
    '111101111',
    '111101111',
    '111111111',
    '111111111',
    '011111110',
    '011111110',
    '011111110',
    '011111110',
    '011111110',
    '011111110',
  ],
  /** 花朵 9×9 */
  flower: [
    '001111100',
    '011111110',
    '111111111',
    '111111111',
    '111111111',
    '111111111',
    '111111111',
    '011111110',
    '001111100',
  ],
  /** 左右双仓 10×9 */
  twinLR: [
    '111011100',
    '111011100',
    '111011100',
    '111011100',
    '111011100',
    '111011100',
    '111011100',
    '111011100',
    '111011100',
    '111011100',
  ],
  /** 上下双仓 10×9 */
  twinTB: [
    '111111111',
    '111111111',
    '111111111',
    '111111111',
    '000000000',
    '111111111',
    '111111111',
    '111111111',
    '111111111',
    '111111111',
  ],
  /** 四仓 10×9 */
  quad: [
    '111110111',
    '111110111',
    '111110111',
    '111110111',
    '000000000',
    '111110111',
    '111110111',
    '111110111',
    '111110111',
    '111110111',
  ],
  /** 三仓（上中下）10×9 */
  triple: [
    '111111111',
    '111111111',
    '111111111',
    '000000000',
    '111111111',
    '111111111',
    '111111111',
    '000000000',
    '111111111',
    '111111111',
  ],
  /**
   * 环形 + 中央岛 10×9
   * 注意：中央 3×3 岛（第 3~5 行、第 3~5 列）四周都是洞，与环形主体互不相通，
   * 是个只能自我消化的孤立小区。不要把障碍放在岛上，否则几乎打不掉。
   */
  ringIsland: [
    '111111111',
    '111111111',
    '110000011',
    '110111011',
    '110111011',
    '110111011',
    '110000011',
    '111111111',
    '111111111',
    '111111111',
  ],
  /** 十字 + 分仓 9×9 */
  crossSplit: [
    '001111100',
    '001111100',
    '111111111',
    '111111111',
    '000000000',
    '111111111',
    '111111111',
    '001111100',
    '001111100',
  ],
  /** 综合（异形 + 分仓）10×9 */
  mixed: [
    '111111111',
    '111000111',
    '111000111',
    '111111111',
    '000000000',
    '111111111',
    '111000111',
    '111000111',
    '111111111',
    '111111111',
  ],
};

/** 章节（关卡列表 UI 按此分组，开发方案 4.4） */
export const CHAPTERS = [
  { id: 1, name: '第 1 章 · 糖果镇', desc: '标准矩形，尺寸逐步变大' },
  { id: 2, name: '第 2 章 · 异形花园', desc: '挖洞棋盘与障碍登场' },
  { id: 3, name: '第 3 章 · 分仓工坊', desc: '多区域棋盘与三类目标混用' },
];

/** 障碍快捷构造 */
const ice = (r, c, hp) => ({ r, c, kind: 'ice', ...(hp ? { hp } : {}) });
const lock = (r, c) => ({ r, c, kind: 'lock' });
const stone = (r, c, hp) => ({ r, c, kind: 'stone', ...(hp ? { hp } : {}) });

export const LEVELS = [
  // ===== 第 1 章：标准矩形，尺寸逐步变大（5 色，目标宽松） =====
  {
    id: 1, chapter: 1, name: '初入糖果镇',
    rows: 8, cols: 8, mask: null, colors: 5, moves: 20,
    goals: [{ type: 'score', target: 1800 }], starScore: 5900, schemaVersion: 1,
  },
  {
    id: 2, chapter: 1, name: '红色的味道',
    rows: 8, cols: 8, mask: null, colors: 5, moves: 20,
    goals: [{ type: 'collect', color: 1, target: 10 }], starScore: 5900, schemaVersion: 1,
  },
  {
    id: 3, chapter: 1, name: '甜度升级',
    rows: 8, cols: 8, mask: null, colors: 5, moves: 18,
    goals: [{ type: 'score', target: 1700 }], starScore: 5300, schemaVersion: 1,
  },
  {
    id: 4, chapter: 1, name: '蓝色的雨',
    rows: 9, cols: 8, mask: null, colors: 5, moves: 20,
    goals: [{ type: 'collect', color: 2, target: 11 }], starScore: 6200, schemaVersion: 1,
  },
  {
    id: 5, chapter: 1, name: '多一味',
    rows: 9, cols: 8, mask: null, colors: 5, moves: 20,
    goals: [{ type: 'score', target: 2100 }], starScore: 6200, schemaVersion: 1,
  },
  {
    id: 6, chapter: 1, name: '青草与蜜糖',
    rows: 9, cols: 9, mask: null, colors: 5, moves: 20,
    goals: [{ type: 'collect', color: 3, target: 12 }], starScore: 6700, schemaVersion: 1,
  },
  {
    id: 7, chapter: 1, name: '双重任务',
    rows: 9, cols: 9, mask: null, colors: 5, moves: 18,
    goals: [{ type: 'score', target: 1900 }, { type: 'collect', color: 4, target: 9 }],
    starScore: 6000, schemaVersion: 1,
  },
  {
    id: 8, chapter: 1, name: '紫色的诱惑',
    rows: 10, cols: 9, mask: null, colors: 5, moves: 20,
    goals: [{ type: 'collect', color: 5, target: 12 }], starScore: 7900, schemaVersion: 1,
  },
  {
    id: 9, chapter: 1, name: '糖厂深处',
    rows: 10, cols: 9, mask: null, colors: 5, moves: 18,
    goals: [{ type: 'score', target: 2400 }], starScore: 7100, schemaVersion: 1,
  },
  {
    id: 10, chapter: 1, name: '糖果镇的考试',
    rows: 10, cols: 9, mask: null, colors: 5, moves: 18,
    goals: [
      { type: 'score', target: 1900 },
      { type: 'collect', color: 1, target: 10 },
      { type: 'collect', color: 2, target: 10 },
    ],
    starScore: 7100, schemaVersion: 1,
  },

  // ===== 第 2 章：异形棋盘 + 障碍（4 色） =====
  {
    id: 11, chapter: 2, name: '菱形花园',
    rows: 9, cols: 9, mask: MASK.diamond, colors: 4, moves: 22,
    goals: [{ type: 'score', target: 3600 }, { type: 'collect', color: 2, target: 33 }],
    starScore: 3700, schemaVersion: 1,
  },
  {
    id: 12, chapter: 2, name: '冰封的十字',
    rows: 9, cols: 9, mask: MASK.cross, colors: 4, moves: 22,
    goals: [{ type: 'clearBlockers', target: 3 }],
    blockers: [ice(3, 3), ice(3, 4), ice(3, 5), ice(5, 3), ice(5, 4), ice(5, 5)],
    starScore: 3900, schemaVersion: 1,
  },
  {
    id: 13, chapter: 2, name: '环形锁链',
    rows: 9, cols: 9, mask: MASK.ring, colors: 4, moves: 22,
    goals: [{ type: 'score', target: 2200 }, { type: 'clearBlockers', target: 2 }],
    blockers: [lock(0, 4), lock(8, 4), lock(4, 0), lock(4, 1), lock(4, 7), lock(4, 8)],
    starScore: 3200, schemaVersion: 1,
  },
  {
    id: 14, chapter: 2, name: '心之收集',
    rows: 9, cols: 9, mask: MASK.heart, colors: 4, moves: 22,
    goals: [{ type: 'collect', color: 1, target: 33 }], starScore: 3600, schemaVersion: 1,
  },
  {
    id: 15, chapter: 2, name: '石阶上的石头',
    rows: 10, cols: 9, mask: MASK.stair, colors: 4, moves: 24,
    goals: [{ type: 'score', target: 2300 }, { type: 'clearBlockers', target: 4 }],
    blockers: [
      stone(0, 4), stone(1, 4), stone(2, 4), stone(4, 4),
      stone(5, 4), stone(7, 4), stone(8, 4), stone(9, 4),
    ],
    starScore: 3800, schemaVersion: 1,
  },
  {
    id: 16, chapter: 2, name: '沙漏与青草',
    rows: 9, cols: 9, mask: MASK.hourglass, colors: 4, moves: 22,
    goals: [{ type: 'collect', color: 3, target: 19 }, { type: 'clearBlockers', target: 4 }],
    blockers: [ice(0, 4), ice(1, 4), ice(4, 3), ice(4, 4), ice(7, 4), ice(8, 4)],
    starScore: 3600, schemaVersion: 1,
  },
  {
    id: 17, chapter: 2, name: '蝴蝶结的双翼',
    rows: 9, cols: 9, mask: MASK.bowtie, colors: 4, moves: 24,
    goals: [{ type: 'score', target: 2100 }], starScore: 3300, schemaVersion: 1,
  },
  {
    id: 18, chapter: 2, name: '三角冰塔',
    rows: 10, cols: 9, mask: MASK.triangle, colors: 4, moves: 24,
    goals: [{ type: 'clearBlockers', target: 5 }],
    blockers: [
      ice(0, 4), ice(1, 3), ice(1, 4), ice(1, 5),
      stone(3, 3), stone(3, 4), stone(3, 5),
      stone(5, 3), stone(5, 4), stone(5, 5),
    ],
    starScore: 4300, schemaVersion: 1,
  },
  {
    id: 19, chapter: 2, name: '城堡守卫',
    rows: 10, cols: 9, mask: MASK.castle, colors: 4, moves: 24,
    goals: [{ type: 'score', target: 5500 }, { type: 'collect', color: 1, target: 30 }],
    blockers: [lock(0, 3), lock(1, 3), lock(4, 1), lock(4, 7), lock(9, 1), lock(9, 7)],
    starScore: 4400, schemaVersion: 1,
  },
  {
    id: 20, chapter: 2, name: '花朵与冰霜',
    rows: 9, cols: 9, mask: MASK.flower, colors: 4, moves: 26,
    goals: [{ type: 'score', target: 7500 }, { type: 'clearBlockers', target: 8 }],
    blockers: [
      ice(2, 2), ice(2, 3), ice(2, 4), ice(2, 5), ice(2, 6),
      ice(6, 2), ice(6, 3), ice(6, 4), ice(6, 5), ice(6, 6),
      stone(4, 0), stone(4, 4),
    ],
    starScore: 4800, schemaVersion: 1,
  },

  // ===== 第 3 章：分仓多区域 + 混合形态（4 色，目标吃紧） =====
  {
    id: 21, chapter: 3, name: '左右工坊',
    rows: 10, cols: 9, mask: MASK.twinLR, colors: 4, moves: 24,
    goals: [{ type: 'score', target: 2900 }], starScore: 3400, schemaVersion: 1,
  },
  {
    id: 22, chapter: 3, name: '上下两仓',
    rows: 10, cols: 9, mask: MASK.twinTB, colors: 4, moves: 24,
    goals: [
      { type: 'collect', color: 2, target: 33 },
      { type: 'collect', color: 4, target: 20 },
    ],
    starScore: 3900, schemaVersion: 1,
  },
  {
    id: 23, chapter: 3, name: '四仓清障',
    rows: 10, cols: 9, mask: MASK.quad, colors: 4, moves: 26,
    goals: [{ type: 'clearBlockers', target: 5 }],
    blockers: [
      ice(0, 2), ice(1, 2), ice(2, 2), ice(3, 2),
      ice(5, 2), ice(6, 2), ice(7, 2), ice(8, 2),
      stone(0, 7), stone(2, 7), stone(5, 7), stone(7, 7),
    ],
    starScore: 4100, schemaVersion: 1,
  },
  {
    id: 24, chapter: 3, name: '三仓分拣',
    rows: 10, cols: 9, mask: MASK.triple, colors: 4, moves: 26,
    goals: [{ type: 'score', target: 3000 }, { type: 'collect', color: 3, target: 19 }],
    starScore: 3900, schemaVersion: 1,
  },
  {
    id: 25, chapter: 3, name: '环中孤岛',
    rows: 10, cols: 9, mask: MASK.ringIsland, colors: 4, moves: 28,
    goals: [{ type: 'collect', color: 1, target: 18 }, { type: 'clearBlockers', target: 4 }],
    blockers: [
      ice(0, 4), ice(9, 4), ice(1, 3), ice(1, 5),
      stone(2, 0), stone(2, 8), stone(6, 0), stone(6, 8),
    ],
    starScore: 4000, schemaVersion: 1,
  },
  {
    id: 26, chapter: 3, name: '菱形冻土',
    rows: 9, cols: 9, mask: MASK.diamond, colors: 4, moves: 26,
    goals: [{ type: 'score', target: 5100 }, { type: 'clearBlockers', target: 11 }],
    blockers: [
      ice(1, 4), ice(2, 3), ice(2, 4), ice(2, 5),
      ice(3, 2), ice(3, 3), ice(3, 5), ice(3, 6),
      stone(4, 0), stone(4, 4), stone(4, 8), stone(3, 4),
    ],
    starScore: 4700, schemaVersion: 1,
  },
  {
    id: 27, chapter: 3, name: '十字分仓',
    rows: 9, cols: 9, mask: MASK.crossSplit, colors: 4, moves: 26,
    goals: [{ type: 'collect', color: 2, target: 17 }, { type: 'clearBlockers', target: 6 }],
    blockers: [
      lock(0, 4), lock(1, 4), lock(3, 4), lock(5, 4),
      lock(6, 4), lock(8, 4), stone(2, 0), stone(2, 8),
    ],
    starScore: 4100, schemaVersion: 1,
  },
  {
    id: 28, chapter: 3, name: '石阶工坊',
    rows: 10, cols: 9, mask: MASK.stair, colors: 4, moves: 28,
    goals: [{ type: 'score', target: 3400 }, { type: 'clearBlockers', target: 4 }],
    blockers: [
      stone(0, 4), stone(2, 4), stone(4, 4), stone(5, 4), stone(7, 4),
      stone(9, 4), ice(1, 3), ice(1, 5), ice(8, 3), ice(8, 5),
    ],
    starScore: 4300, schemaVersion: 1,
  },
  {
    id: 29, chapter: 3, name: '花朵炼狱',
    rows: 9, cols: 9, mask: MASK.flower, colors: 4, moves: 30,
    goals: [{ type: 'clearBlockers', target: 8 }, { type: 'collect', color: 2, target: 29 }],
    blockers: [
      stone(2, 2), stone(2, 3), stone(2, 4), stone(2, 5), stone(2, 6),
      stone(6, 2), stone(6, 3), stone(6, 4), stone(6, 5), stone(6, 6),
      ice(4, 0), ice(4, 2), ice(4, 6), ice(4, 8),
    ],
    starScore: 5700, schemaVersion: 1,
  },
  {
    id: 30, chapter: 3, name: '糖果工坊总检',
    rows: 10, cols: 9, mask: MASK.mixed, colors: 4, moves: 30,
    goals: [
      { type: 'score', target: 2900 },
      { type: 'collect', color: 1, target: 23 },
      { type: 'clearBlockers', target: 5 },
    ],
    blockers: [
      ice(0, 2), ice(0, 4), ice(0, 6),
      ice(3, 2), ice(3, 4), ice(3, 6),
      stone(5, 2), stone(5, 4), stone(5, 6),
      stone(8, 2), stone(8, 4), stone(8, 6),
      lock(1, 0), lock(6, 0),
    ],
    starScore: 4600, schemaVersion: 1,
  },
];

/** 取某一章的全部关卡 */
export function levelsOfChapter(chapterId) {
  return LEVELS.filter((level) => level.chapter === chapterId);
}

/** 按关号取关卡 */
export function getLevel(id) {
  return LEVELS.find((level) => level.id === id) || null;
}

/** 总关数（解锁与进度判定用） */
export const LEVEL_COUNT = LEVELS.length;
