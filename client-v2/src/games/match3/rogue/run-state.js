/**
 * 肉鸽 run 级状态容器的唯一初始值工厂（开发方案 4.7.3 事故②）
 *
 * 约束：startRun() 是 run 状态的唯一构造点。每轮开始必须拿到一份全新的容器，
 * 绝不允许从上个闭包 / 存储里继承任何 run 级字段（地图 / 金币 / 遗物 / 事件状态同理，
 * 对应系统落地时把字段加进这里即可）。
 *
 * 本文件是**纯函数**（只依赖同样纯净的 perks 工厂），无 DOM / 无网络，
 * 可被 node 测试直接 import：测试用「打脏的一轮 → 再开一轮」fixture 断言
 * 新容器逐项回到初始值（tests/match3-run-state.test.js）。
 *
 * 注意：board / perkModal / gainEl / paintMeta 这类**视图引用**不属于 run 数据容器，
 * 它们由 mode-rogue 的 teardown() 负责清空，不在这里。
 */
import { createBonus } from './perks.js';

/** run 数据容器的全部字段名（mode-rogue.startRun 必须逐项从工厂结果赋值） */
export const RUN_STATE_KEYS = [
  // 终局标记
  'finished', 'victory',
  // build
  'bonus', 'picks', 'pickedPerks',
  // 地图状态机（3.1）
  'floor', 'map', 'nodeId', 'terrain', 'goals', 'quest',
  // 累计计分 / 统计
  'baseScore', 'maxCombo', 'totalMoves', 'totalCleared', 'questsDone',
  // 局内资源
  'shufflesLeft', 'rewindsLeft', 'extraPicks',
  // 局内经济与遗物（3.4 事件 / 3.5 遗物 / 3.6 商店共用，同批进 session v4）
  'coins', 'relics', 'upgradedPerkIds', 'bannedPerkIds',
  // 局内瞬态
  'rewinding', 'floorCleared', 'startedAt', 'elapsedMs', 'runRng',
  // Boss / 胜利闭环（3.3）
  'bossKills', 'boss', 'endless',
];

/**
 * 一份全新 run 的初始容器
 *
 * 每次调用都重新构建：嵌套对象 / 数组也是新引用，
 * 两份容器之间绝不共享（防止「上一轮的 picks 被下一轮看见」这类串档）。
 * @returns {Record<string, *>}
 */
export function createRunState() {
  return {
    finished: false,
    victory: false,
    bonus: createBonus(),
    picks: {},
    pickedPerks: [],
    floor: 1,
    map: null,
    nodeId: null,
    terrain: null,
    goals: [],
    quest: null,
    baseScore: 0,
    maxCombo: 0,
    totalMoves: 0,
    totalCleared: 0,
    questsDone: 0,
    shufflesLeft: 0,
    rewindsLeft: 0,
    extraPicks: 0,
    // 局内金币：只在局内有意义，终局清零、不上报服务端（4.3）
    coins: 0,
    // 本轮遗物 id（每件最多 1 个，不进三选一池）
    relics: [],
    // 篝火「锻造」临时升级的祝福 id（只活在本轮，不写局外 meta）
    upgradedPerkIds: [],
    // 商店封禁的祝福 id（rollPerks 抽牌时过滤掉）
    bannedPerkIds: [],
    rewinding: false,
    floorCleared: false,
    startedAt: 0,
    elapsedMs: 0,
    runRng: null,
    bossKills: 0,
    boss: null,       // 当前 Boss 层运行时 { id,name,icon,depth,hp,target,fired:[] }，非 Boss 层为 null
    endless: false,   // 通关后是否已进入无尽深渊（31+ 层）
  };
}
