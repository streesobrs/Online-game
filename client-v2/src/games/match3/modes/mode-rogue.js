/**
 * 肉鸽试炼（娱乐玩法，开发方案 5.6）
 *
 * 一轮 run 由若干「层」组成：
 * - 每层重新生成 8×8 标准盘，限步（默认 10 步），限步内本层得分达标即过关
 * - 过关立刻从祝福池三选一（perks.js），祝福在本轮内累计并影响后续每层的开局参数
 * - 步数耗尽仍未达标即本轮结束；持有「免死金牌」时会补步继续本层
 * - 结算上报 mode='rogue'（服务端单独记「最高层 / 最高分」，不并进无尽榜与跨模式累计）
 *
 * 本文件只做渲染与状态机，数值与推导全在 perks.js / config.js，保证标定脚本能复用同一套公式。
 * 一轮 run 会做局内暂存（本地 + 云端）：刷新、换设备都能接着打，见 persistSession。
 */
import { COLOR_NAMES, ROGUE, ROGUE_BOSSES, ROGUE_GOLD, ROGUE_RELIC, STORAGE_KEYS } from '../config/config.js';
import {
  PERKS, QUEST_REWARDS, createBonus, descOf, floorOptions, goalOf, questFor, rollPerks,
} from '../rogue/perks.js';
import { essenceForRun, applyMetaBuffs, mechanicCfg, mechanicOn, perkLevel, unlockedSet } from '../rogue/meta.js';
import { createMatch3Board } from '../ui/board.js';
import { createRng } from '../engine/rng.js';
import { showScoreDetails } from '../ui/scoreDetails.js';
import { showPerkCodex } from '../rogue/codex.js';
import {
  ALL_ENABLED, advanceTo, completeNode, generateMap, hasOpenNode, MAP_DEPTH, NODE, NODE_META,
  synthLinearMap,
} from '../rogue/mapgen.js';
import { renderMapScreen } from '../ui/map-view.js';
import { floorGoals, rogueBiome, terrainFor } from '../rogue/floor-types.js';
import { MASKS } from '../config/levels.js';
import { allGoalsDone, goalProgress, goalShort } from '../engine/goals.js';
import { createRunState } from '../rogue/run-state.js';
import { bossAt, createBossState, crossedPhases } from '../rogue/boss.js';
// 局内经济与遗物（开发方案 3.4 / 3.5 / 3.6）：三个模块都是纯逻辑，这里只负责接线与渲染
import {
  buildRelicHooks, grantOnAcquire, RELICS, relicById, relicRollExtras, rollRelic, rollRelicChoices,
} from '../rogue/relics.js';
import { applyChoice, availableChoices, rollEvent } from '../rogue/events.js';
import { buyItem, priceOf, refreshShelf, removePerk, rollShelf, shelfWithPrices } from '../rogue/shop.js';
import {
  estimateExp, finishedSession, getRogueMeta, loadLocalSession, onProgress, onResult, onRogueMeta,
  pushSession, reportEnd, reportStart, requestProgress, saveLocalSession,
} from '../save/sync.js';
import { el } from '../../../utils/dom.js';
import { toast } from '../../../components/toast.js';

function readStore(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeStore(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 隐私模式 / 容量满：存不下不影响本轮
  }
}

/** 稀有度中文名（遗物 / 商店卡片展示用；与 config.ROGUE_META.rarities.label 同口径） */
const RARITY_LABEL = { common: '普通', rare: '稀有', epic: '史诗' };

/** 本轮的历史最佳 { maxFloor, highScore } */
export function loadRogueBest() {
  const saved = readStore(STORAGE_KEYS.rogueBest);
  return { maxFloor: saved?.maxFloor || 0, highScore: saved?.highScore || 0 };
}

/** 毫秒 → mm:ss */
function formatDuration(ms) {
  const total = Math.floor(ms / 1000);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * 无尽深渊的「伪区域」（开发方案 3.3：通关后 31+ 层）
 * 结构对齐 ROGUE_BIOMES 元素，只用于标题 / 配色；31+ 层不再走区域障碍表
 */
const ABYSS_BIOME = { id: 'abyss', name: '无尽深渊', icon: '🌀', from: MAP_DEPTH + 1, to: Infinity };

/** 复制一份加成（specials 是嵌套对象，必须深拷贝一层） */
function cloneBonus(bonus) {
  return { ...bonus, specials: { ...bonus.specials } };
}

/** 地形 → 存档纯数据（mask 不存，恢复时按 shapeName 从共享形态表取） */
function serializeTerrain(t) {
  if (!t) return null;
  return {
    rows: t.rows,
    cols: t.cols,
    shapeName: t.shapeName || null,
    blockers: t.blockers,
    playableRatio: t.playableRatio,
    biome: t.biome,
  };
}

/** 存档 → 地形（mask 按形态名还原；形态表改版导致名字消失时退化为满盘，不崩） */
function restoreTerrain(saved) {
  if (!saved) return null;
  return {
    rows: saved.rows,
    cols: saved.cols,
    shapeName: saved.shapeName || null,
    mask: saved.shapeName ? MASKS[saved.shapeName] || null : null,
    blockers: Array.isArray(saved.blockers) ? saved.blockers : [],
    playableRatio: saved.playableRatio ?? 1,
    biome: saved.biome || null,
  };
}

/**
 * 本轮加成 → 面板数值
 *
 * 与 `floorOptions` / `goalOf` 同源：面板显示的就是该层真正会用到的开局参数，
 * 不另立一套口径，否则玩家看到的数会与实际结算对不上。
 * @param {object} bonus - 本轮加成
 * @param {number} floor - 层号（起手步数含层数成长，必须传对）
 * @returns {Array<{key:string, label:string, value:string}>}
 */
function bonusStats(bonus, floor, rewinds = 0) {
  const opts = floorOptions(bonus, floor);
  const rows = [
    { key: 'moves', label: '起手步数', value: `${opts.moves} 步` },
    { key: 'colors', label: '元素种类', value: `${opts.colors} 色` },
    { key: 'mult', label: '得分倍率', value: `×${opts.scoreMult.toFixed(2)}` },
  ];
  if (bonus.goalCut > 0) {
    rows.push({ key: 'goalCut', label: '目标分', value: `−${Math.round(bonus.goalCut * 100)}%` });
  }
  const specials = [];
  if (bonus.specials.row > 0) specials.push(`🧨${bonus.specials.row}`);
  if (bonus.specials.bomb > 0) specials.push(`💣${bonus.specials.bomb}`);
  if (bonus.specials.rainbow > 0) specials.push(`🌈${bonus.specials.rainbow}`);
  if (specials.length > 0) rows.push({ key: 'specials', label: '开局附赠', value: specials.join(' ') });
  if (bonus.shields > 0) rows.push({ key: 'shields', label: '免死', value: `×${bonus.shields}` });
  if (bonus.shuffles > 0) rows.push({ key: 'shuffles', label: '免费洗牌', value: `×${bonus.shuffles}` });
  // 同色磁石：锁色前（三选一卡片上的预览）显示为「随机一色」
  if (bonus.weightMult > 1) {
    const name = bonus.weightColor > 0 ? `${COLOR_NAMES[bonus.weightColor]}色` : '随机一色';
    rows.push({ key: 'magnet', label: '同色磁石', value: `${name} ×${bonus.weightMult}` });
  }
  // 「时光倒流」是机制节点给的一次性重打机会，攒着不用就浪费了——摆出来让玩家看得见
  if (rewinds > 0) rows.push({ key: 'rewind', label: '时光倒流', value: `×${rewinds}` });
  return rows;
}

/** bonusStats → Map，便于按 key 比较「选祝福前 / 后」 */
function statsMap(bonus, floor, rewinds = 0) {
  return new Map(bonusStats(bonus, floor, rewinds).map((row) => [row.key, row]));
}

/** 加成数据条（悬浮在棋盘上方，随祝福变化即时刷新） */
function renderStats(bonus, floor, title, rewinds = 0) {
  return el(
    'div',
    { class: 'm3-stats-block' },
    el('span', { class: 'm3-stats-title' }, title),
    el(
      'div',
      { class: 'm3-stats' },
      ...bonusStats(bonus, floor, rewinds).map((row) =>
        el(
          'span',
          { class: 'm3-stat' },
          el('span', { class: 'm3-stat-label' }, row.label),
          el('span', { class: 'm3-stat-value' }, row.value),
        )),
    ),
  );
}

/**
 * 渲染肉鸽试炼
 * @param {HTMLElement} container - 内容容器
 * @param {{onExit:Function}} options - onExit 返回娱乐菜单
 * @returns {Function} cleanup 函数
 */
export function renderRogue(container, { onExit }) {
  let board = null;
  let finished = false;

  // ---- 本轮 run 的全部状态 ----
  let bonus = createBonus();
  let picks = {};          // { 祝福id: 已选次数 }，用于三选一抽取与叠加上限
  let pickedPerks = [];    // 已选祝福对象，按获得顺序
  let floor = 1;
  let map = null;        // 本轮节点图（mapgen.generateMap；同 seed + 同参数可重建，故只存 seed/参数/节点状态）
  let nodeId = null;     // 当前所在 / 刚完成的节点 id（深度即 floor，所有层数曲线继续用 floor）
  let terrain = null;    // 本层地形（floor-types.terrainFor；进层时掷一次，续玩不重掷）
  let goals = [];        // 本层硬目标（floor-types.floorGoals，支持多目标）
  let baseScore = 0;       // 本层之前的累计总分
  let maxCombo = 0;
  let totalMoves = 0;
  let totalCleared = 0;
  let questsDone = 0;      // 本轮达成的局内任务数（只作养成存档的统计字段，见 reportEnd）
  let shufflesLeft = 0;    // 本层剩余免费洗牌次数
  let rewindsLeft = 0;     // 「时光倒流」机制：本轮剩余的重打次数（0 = 没解锁 / 已用完）
  let extraPicks = 0;      // 「先手规划」机制：第 1 层过关后还要多抽几次
  let rewinding = false;   // 「时光倒流」正在重建本层：挡住这期间重复触发的结束判定
  let startedAt = 0;
  let elapsedMs = 0;       // 已累计的游玩时长（本轮之前的），配合 startedAt 得到总时长
  let runRng = null;
  let floorCleared = false;
  let refreshExp = null;
  let paintMeta = () => { }; // 重画「精华」行（局外养成随服务端下发 / 解锁后变化），由 mountFloor 赋值
  let gainEl = null;        // 结算页的「本轮精华」行，收到服务端回执后就地改成准确值
  let quest = null;        // 本层局内任务（perks.js 的 questFor），只在当层有效
  let perkModal = null;    // 三选一的模态框（盖在已达标的盘面上，见 renderPerkChoice）
  let nodeModal = null;    // 非战斗节点（事件 / 宝藏 / 篝火 / 商店）的模态框，盖在地图屏上
  // ---- 胜利闭环（开发方案 3.3）----
  let bossKills = 0;       // 本轮已击败的 Boss 数（0-3，通关上报用）
  let boss = null;         // 当前 Boss 层运行时状态（boss.js），非 Boss 层 / 层间为 null
  let endless = false;     // 是否已在通关后进入无尽深渊（31+ 层）
  let victory = false;     // 已击败最终 Boss（无论是否继续深渊，结算均按通关）
  // ---- 局内经济与遗物（开发方案 3.4 / 3.5 / 3.6）----
  let coins = 0;                 // 局内金币：本轮有效，终局清零、不上报服务端
  let relics = [];               // 本轮持有的遗物 id（每件最多 1 个）
  let upgradedPerkIds = [];      // 篝火「锻造」临时升级的祝福 id（只活在本轮）
  let bannedPerkIds = [];        // 商店封禁的祝福 id（rollPerks 抽牌时过滤）
  // ---- 遗物 hook 运行时（开发方案 3.5）----
  let relicUsed = {};                  // 本层各遗物的触发计数（每层开局清空，不写档）
  let relicHooks = buildRelicHooks([]); // 持有遗物编译出的 hook 集合（relics 一变就重建）
  let inRelicUpdate = false;            // onUpdate 内再改棋盘会重入回调，用闸挡一层
  // ---- 商店 / 篝火的局内瞬态（开发方案 3.6 / 3.7）----
  let nextFloorMoves = 0;         // 商店「+N 步」：只在下一层生效，进层时消费（不写档，见 mountFloor 注释）
  let shopShelf = null;           // 当前商店的货架（已售出状态挂在格位上）
  let shopRefreshUsed = 0;        // 本次商店已刷新次数
  let perkRerollsLeft = 0;        // 商店买来的「三选一重随」次数（本轮有效，不进 session，见 4.4）
  let perkRerollFree = 0;         // 遗物「重随代币」给的免费重随（每次三选一各自结算，不进档）
  // 侧栏刷新钩子：由 mountFloor 各自赋值，局外其它地方调用时是空操作
  let paintCoins = () => { };
  let paintRelics = () => { };
  // 「本轮加成」面板的刷新钩子：遗物 / 事件 / 商店改了 bonus 后要在盘面之外也能就地重画
  let paintStatsRef = () => { };

  /** 重建遗物 hook（relics 变化后调用一次，避免在每步热路径上重复编译） */
  function refreshRelicHooks() {
    relicHooks = buildRelicHooks(relics);
  }

  /** 遗物 hook 的 ctx（棋盘现场传入 board；层间场合传 null） */
  function relicCtx(boardRef = null) {
    return { board: boardRef, bonus, floor, used: relicUsed, rng: runRng, toast };
  }

  /**
   * 加金币（**唯一入口**：过关掉落 / 事件 / 商店买卖全走它，保证倍率与下限口径一致）
   * 遗物「金矿脉 / 守财奴」的 goldMult 只作用于**正向获取**，扣费与返利按原值走，
   * 否则「买得越多金币越多」这种荒谬经济会立刻出现。下限夹 0，永不为负。
   */
  function addCoins(n) {
    const delta = Math.round(n || 0);
    const scaled = delta > 0 ? Math.round(delta * relicHooks.mods.goldMult) : delta;
    coins = Math.max(0, coins + scaled);
    paintCoins();
    return coins;
  }

  /** 本层任务 / 过关掉落的金币（走同一入口） */
  function gainGold(n) {
    if (!(n > 0)) return 0;
    const before = coins;
    addCoins(n);
    return coins - before;
  }

  /**
   * 授予一件遗物（事件 / 宝藏 / Boss 宝箱 / 商店的唯一出口）
   * @param {string|object|null} spec - 'random' | { rarity } | { id } | null（等同 random）
   * @returns {string|null} 授予的遗物 id；池子抽空 / 已拥有时返回 null（不报错）
   */
  function grantRelic(spec) {
    let relic = null;
    if (typeof spec === 'string' && spec !== 'random') relic = relicById(spec);
    else if (spec && typeof spec === 'object' && spec.id) relic = relicById(spec.id);
    else relic = rollRelic(runRng, relics, spec && typeof spec === 'object' && spec.rarity ? { rarity: spec.rarity } : {});
    if (!relic || relics.includes(relic.id)) return null;
    relics.push(relic.id);
    refreshRelicHooks();
    // once 类效果在获得时立刻结算；perFloor 类等下一层开局的 onFloorStart 重放
    grantOnAcquire(relic.id, { bonus, toast });
    paintStatsRef();
    paintRelics();
    toast.success(`${relic.icon} 获得遗物：${relic.name}`);
    return relic.id;
  }

  /**
   * 立即授予一张祝福（事件 / 商店买祝福的唯一出口）：进 picks、当场生效、进本轮三选池
   * @param {object} opts - { id }（指定）或 { rarity } / { minRarity }（从已解锁且未叠满的池里随机）
   * @returns {object|null} 该祝福定义；无可授时返回 null
   */
  function grantPerk(opts = {}) {
    const allowed = unlockedSet(getRogueMeta());
    const rank = { common: 0, rare: 1, epic: 2 };
    const eligible = (perk) => allowed.has(perk.id)
      && !bannedPerkIds.includes(perk.id)
      && (picks[perk.id] || 0) < perk.max
      && (!opts.rarity || perk.rarity === opts.rarity)
      && (!opts.minRarity || (rank[perk.rarity] ?? 0) >= (rank[opts.minRarity] ?? 0));
    let perk = null;
    if (opts.id) {
      perk = PERKS.find((p) => p.id === opts.id) || null;
      if (perk && !eligible(perk)) perk = null;
    } else {
      const pool = PERKS.filter(eligible);
      perk = pool.length > 0 ? pool[runRng.int(pool.length)] : null;
    }
    if (!perk) return null;
    picks[perk.id] = (picks[perk.id] || 0) + 1;
    pickedPerks.push(perk);
    perk.apply(bonus, { lv: levelOf(perk), rng: runRng });
    paintStatsRef();
    return perk;
  }

  /** 商店封禁一条祝福（rollPerks 会过滤掉） */
  function banPerk(id) {
    if (typeof id === 'string' && !bannedPerkIds.includes(id)) bannedPerkIds.push(id);
  }

  /** 封禁时把这轮已拿过的该祝福一并清掉（数字与展示都要跟着走） */
  function removePerkFromRun(id) {
    delete picks[id];
    for (let i = pickedPerks.length - 1; i >= 0; i -= 1) {
      if (pickedPerks[i].id === id) pickedPerks.splice(i, 1);
    }
    const at = upgradedPerkIds.indexOf(id);
    if (at >= 0) upgradedPerkIds.splice(at, 1);
    paintStatsRef();
  }

  /** 事件 / 商店共用的 ctx：所有改动 run 状态的动作都从这里进，模块侧不直接碰闭包变量 */
  function runCtx(extra = {}) {
    return {
      rng: runRng,
      floor,
      depth: floor,
      bonus,
      picks,
      getCoins: () => coins,
      addCoins,
      getRelics: () => [...relics],
      hasRelic: (id) => relics.includes(id),
      grantRelic,
      grantPerk,
      addMoves: (n) => {
        bonus.moves += Math.round(n || 0);
        paintStatsRef();
      },
      addMovesNextFloor: (n) => { nextFloorMoves += Math.max(0, Math.round(n || 0)); },
      addShield: (n) => {
        bonus.shields = Math.max(0, bonus.shields + Math.round(n || 0));
        paintStatsRef();
      },
      addReroll: (n) => { perkRerollsLeft += Math.max(0, Math.round(n || 0)); },
      banPerk,
      removePerk: removePerkFromRun,
      removeRelic: (id) => {
        const at = relics.indexOf(id);
        if (at < 0) return false;
        relics.splice(at, 1);
        refreshRelicHooks();
        paintRelics();
        return true;
      },
      toast,
      ...extra,
    };
  }

  /**
   * 本层三选一的候选：张数 = 基础 3 + 遗物「宽幅选择」的额外选项，
   * 保底稀有度（精英 rare / Boss epic）与封禁过滤都从这一处走，避免多处口径漂移
   */
  function rollChoicesFor(minRarity = null) {
    const extra = relicRollExtras(relics).extraChoices;
    return rollPerks(
      runRng, picks, unlockedSet(getRogueMeta()),
      { minRarity, choices: ROGUE.perkChoices + extra, banned: bannedPerkIds },
    );
  }

  /**
   * 某条祝福的**本局生效等级**（开发方案 3.7 的篝火「锻造」不改这里）
   *
   * 局外等级由 perkLevel 决定；篝火「锻造」的语义是「该祝福效果再叠一层」（重跑一次 apply），
   * 而不是「临时 +1 级」——后者要按 add/mult 分类算增量，容易与已有的累加口径打架。
   * 因此锻造过的祝福记在 upgradedPerkIds 里只作展示标记（⚒️），不改本函数。
   */
  function levelOf(perk) {
    return perkLevel(getRogueMeta(), perk.id);
  }

  function disposeBoard() {
    if (board) {
      board.destroy();
      board = null;
    }
  }

  /** 关掉三选一模态框（选完祝福 / 离开模式 / 重开一轮时都要收干净） */
  function closePerkModal() {
    if (!perkModal) return;
    perkModal.remove();
    perkModal = null;
  }

  /** 关掉非战斗节点模态框（离开模式 / 重开一轮 / 节点办完时都要收干净） */
  function closeNodeModal() {
    if (!nodeModal) return;
    nodeModal.remove();
    nodeModal = null;
  }

  function teardown() {
    refreshExp = null;
    // 精华行 / 侧栏随盘面一起被换掉，先摘掉引用，避免服务端下发或遗物钩子往已脱离文档的节点上写
    paintMeta = () => { };
    paintCoins = () => { };
    paintRelics = () => { };
    paintStatsRef = () => { };
    closePerkModal();
    closeNodeModal();
    disposeBoard();
  }

  /** 本层已得分（board 每层重建，所以棋盘上的分数就是本层分数） */
  function floorScore() {
    return board ? board.getState().score : 0;
  }

  function totalScore() {
    return baseScore + floorScore();
  }

  // ---- 本轮 run 的暂存（开发方案 5.4 / 8）----

  /** 本轮已游玩时长：跨刷新 / 跨设备续玩时不把挂机时间算进去 */
  function runElapsed() {
    return elapsedMs + (Date.now() - startedAt);
  }

  /** 由 picks 还原已获祝福（祝福对象带 apply 函数，存不了，只存 id 与次数） */
  function rebuildPickedPerks() {
    pickedPerks = [];
    for (const [id, n] of Object.entries(picks)) {
      const perk = PERKS.find((item) => item.id === id);
      if (!perk) continue; // 祝福池改版后旧存档里的陌生 id：跳过而不是崩
      for (let k = 0; k < n; k += 1) pickedPerks.push(perk);
    }
  }

  /** 本层任务的存档 → 运行时对象（奖励对象按 id 找回来） */
  function restoreQuest(saved) {
    if (!saved) return null;
    const reward = QUEST_REWARDS.find((item) => item.id === saved.rewardId);
    return reward ? { ...saved, reward } : null;
  }

  /**
   * 把本轮 run 序列化成纯数据（可存本地、可传云端）
   *
   * 只存「再算一遍就能还原」的东西：祝福存 id 计数、棋盘存 board 快照、
   * 随机数存内部状态（恢复后随机序列接着走，不重掷）。
   * 地图不整张存：mapSeed + 生成参数可逐节点重建，只额外存各节点 state（选路结果）；
   * 本层地形与目标是进层时消耗 runRng 掷出来的，原样存下，续玩不重掷（否则随机序列错位）。
   * @param {'map'|'floor'|'perk'} phase map=层间选路；floor=层内对局中；perk=本层已达标、正在三选一
   * @param {Array} [offered] phase=perk 的三个候选（存 id，恢复时不重掷）
   */
  function toSession(phase, offered) {
    return {
      mode: ROGUE.type,
      phase,
      floor,
      // ---- 胜利闭环（开发方案 3.3）----
      victory,
      bossKills,
      endless,
      // Boss 层运行时（血条目标与已触发阶段）；非 Boss 层为 null
      boss: boss ? { id: boss.id, target: boss.target, fired: [...boss.fired] } : null,
      // ---- 局内经济与遗物（开发方案 3.4 / 3.5 / 3.6，session v4）----
      // 金币与遗物都只存 session：终局不上报服务端、不参与发奖（4.3「局内过程不上报」），
      // 但要进签名（config.SIGNED_FIELDS.session[4]）——不发奖 ≠ 允许本地改档刷 build
      coins: Math.max(0, Math.floor(coins || 0)),
      relics: [...relics],
      upgradedPerkIds: [...upgradedPerkIds],
      bannedPerkIds: [...bannedPerkIds],
      bonus: { ...bonus, specials: { ...bonus.specials } },
      picks: { ...picks },
      baseScore,
      maxCombo,
      totalMoves,
      totalCleared,
      questsDone,
      runRngState: runRng ? runRng.getState() : null,
      elapsedMs: runElapsed(),
      shufflesLeft,
      rewindsLeft,
      extraPicks,
      // ---- 地图状态机（开发方案 3.1）----
      mapSeed: map ? map.seed : null,
      // 只存影响生成结果的参数；enabled 集合随版本扩展，存 id 列表恢复时转回 Set
      mapParams: map?.params
        ? {
          newPlayer: !!map.params.newPlayer,
          eliteBonus: map.params.eliteBonus || 0,
          eventPerBiome: map.params.eventPerBiome ?? 2,
          treasureChance: map.params.treasureChance ?? 0.5,
          enabled: Array.isArray(map.params.enabled) ? map.params.enabled : null,
        }
        : null,
      // 只存非 locked 的节点状态（locked 是生成默认值），存档体积小
      mapStates: map
        ? Object.fromEntries(map.nodes.filter((n) => n.state !== 'locked').map((n) => [n.id, n.state]))
        : null,
      nodeId,
      // phase=map 时没有「本层」，两者为 null；floor/perk 时带上，续玩不重掷
      terrain: phase === 'map' ? null : serializeTerrain(terrain),
      goals: phase === 'map' ? null : goals,
      quest: quest
        ? {
          color: quest.color,
          need: quest.need,
          rewardId: quest.reward.id,
          progress: quest.progress,
          done: quest.done,
        }
        : null,
      offered: offered ? offered.map((perk) => perk.id) : null,
      // phase=perk 也要存盘面：三选一是模态框，背后要摆出刚达标那一层（锁住不再消耗步数）；
      // phase=map 时棋盘已销毁
      board: phase !== 'map' && board ? board.getSnapshot() : null,
      ts: Date.now(),
    };
  }

  /**
   * 落一次暂存：本地每次都写（刷新即续），云端按节流推
   * @param {'map'|'floor'|'perk'} phase
   * @param {Array} [offered]
   * @param {boolean} [force] 换层 / 三选一 / 选路这类关键节点立即推云，不等节流
   */
  function persistSession(phase, offered, force = false) {
    if (finished) return;
    const session = toSession(phase, offered);
    saveLocalSession(ROGUE.type, session);
    pushSession(ROGUE.type, session, { force });
  }

  // ---- 开新一轮 ----
  function startRun() {
    teardown();
    // run 容器统一从纯工厂复位（4.7.3：唯一构造点，禁止继承上轮任何 run 字段；
    // 静态守卫见 tests/match3-run-state.test.js，新增字段必须两边都登记）
    const f = createRunState();
    finished = f.finished;
    victory = f.victory;
    bonus = f.bonus;
    picks = f.picks;
    pickedPerks = f.pickedPerks;
    floor = f.floor;
    map = f.map;
    nodeId = f.nodeId;
    terrain = f.terrain;
    goals = f.goals;
    quest = f.quest;
    baseScore = f.baseScore;
    maxCombo = f.maxCombo;
    totalMoves = f.totalMoves;
    totalCleared = f.totalCleared;
    questsDone = f.questsDone;
    shufflesLeft = f.shufflesLeft;
    rewindsLeft = f.rewindsLeft;
    extraPicks = f.extraPicks;
    coins = f.coins;
    relics = f.relics;
    upgradedPerkIds = f.upgradedPerkIds;
    bannedPerkIds = f.bannedPerkIds;
    rewinding = f.rewinding;
    floorCleared = f.floorCleared;
    startedAt = f.startedAt;
    elapsedMs = f.elapsedMs;
    runRng = f.runRng;
    bossKills = f.bossKills;
    boss = f.boss;
    endless = f.endless;
    // ---- 局内瞬态（不进 run 容器）：startRun 是唯一构造点，这里也必须逐项归零 ----
    // 否则「上一轮逛到一半的商店货架 / 没花掉的下一层步数 / 没用的重随券」会漏进新一轮
    relicUsed = {};          // 遗物每层触发计数
    inRelicUpdate = false;   // 遗物 onUpdate 重入闸
    nextFloorMoves = 0;      // 商店「下一层 +N 步」
    shopShelf = null;        // 当前商店货架
    shopRefreshUsed = 0;     // 本次商店已刷新次数
    perkRerollsLeft = 0;     // 商店买来的三选一重随次数
    perkRerollFree = 0;      // 遗物给的免费重随
    clearedRarity = null;
    pendingRelicChest = false;
    // relics 已复位为空，遗物 hook 必须跟着重建，否则会带着上一轮编译出的 hook 跑
    refreshRelicHooks();
    // 共鸣树里「局内生效」的节点加成在这里一次性灌进来（跨轮常驻，一轮中间不会变）：
    // 起始补给 / 开箱彩球 / 常驻护盾 / 常驻洗牌走 apply，先手规划只改第 1 层的步数倍率
    applyMetaBuffs(bonus, getRogueMeta());
    rewindsLeft = mechanicOn(getRogueMeta(), 'rewind') ? mechanicCfg().rewind.retriesPerRun : 0;
    gainEl = null;
    elapsedMs = 0;
    startedAt = Date.now();
    runRng = createRng(Date.now() % 2147483647);
    // 地图在一切消耗随机序列的操作之前生成，保证「同 seed + 同参数 = 同一张图」。
    // P2-P4 上线后放行全部节点类型（事件 / 商店 / 宝藏 / 篝火，见 mapgen 的 ALL_ENABLED）；
    // 从没通过第 1 层的账号走新手保护（不出精英），打过一层后恢复正常配额
    map = generateMap(runRng, { newPlayer: loadRogueBest().maxFloor < 1, enabled: ALL_ENABLED });
    nodeId = map.start[0];
    terrain = null;
    goals = [];
    // 起点不产生对局：直接视为完成，打开第一排让玩家选第一个节点
    completeNode(map, nodeId);
    reportStart({ mode: ROGUE.type });
    mountMap();
  }

  /**
   * 从暂存接着打（刷新 / 换设备后进来）
   * @param {object} session 本地暂存（本地那份已经是「本地与云端取最新」的结果）
   */
  function resumeRun(session) {
    teardown();
    finished = false;
    // 与 createBonus 合并：祝福池改版（新增字段）后旧存档仍可读，缺的字段落回默认值
    const fresh = createBonus();
    bonus = {
      ...fresh,
      ...session.bonus,
      specials: { ...fresh.specials, ...(session.bonus?.specials || {}) },
    };
    picks = { ...(session.picks || {}) };
    rebuildPickedPerks();
    floor = Math.max(1, session.floor || 1);
    // 胜利闭环字段：旧档（v2）没有，落回默认值（未通关 / 0 击败 / 非深渊）
    victory = !!session.victory;
    bossKills = Math.max(0, Math.min(3, Math.floor(session.bossKills || 0)));
    endless = !!session.endless;
    boss = null;
    baseScore = session.baseScore || 0;
    maxCombo = session.maxCombo || 0;
    totalMoves = session.totalMoves || 0;
    totalCleared = session.totalCleared || 0;
    questsDone = session.questsDone || 0;
    shufflesLeft = session.shufflesLeft || 0;
    // 机制资源也要接着存档走，否则刷新一次「时光倒流」就白送了 / 「连抽」被打断
    rewindsLeft = Math.max(0, Math.floor(session.rewindsLeft || 0));
    extraPicks = Math.max(0, Math.floor(session.extraPicks || 0));
    // 局内经济与遗物（session v4）：旧档（v3 及以前）没有这四个字段，落回默认值
    coins = Math.max(0, Math.floor(session.coins || 0));
    relics = Array.isArray(session.relics)
      ? session.relics.filter((id) => typeof id === 'string' && RELICS.some((r) => r.id === id))
      : [];
    upgradedPerkIds = Array.isArray(session.upgradedPerkIds)
      ? session.upgradedPerkIds.filter((id) => PERKS.some((p) => p.id === id))
      : [];
    bannedPerkIds = Array.isArray(session.bannedPerkIds)
      ? session.bannedPerkIds.filter((id) => PERKS.some((p) => p.id === id))
      : [];
    // ---- 局内瞬态：续存里没有这类字段，一律回到初始值（它们不进 session）----
    relicUsed = {};
    inRelicUpdate = false;
    nextFloorMoves = 0;
    shopShelf = null;
    shopRefreshUsed = 0;
    perkRerollsLeft = 0;
    perkRerollFree = 0;
    clearedRarity = null;
    pendingRelicChest = false;
    refreshRelicHooks(); // 还原出的 relics 要立刻编译成 hook，否则续玩后遗物不生效
    elapsedMs = session.elapsedMs || 0;
    startedAt = Date.now();
    runRng = createRng(1);
    if (Number.isFinite(session.runRngState)) runRng.setState(session.runRngState);

    // ---- 重建节点图 ----
    if (session.mapSeed != null && session.mapParams) {
      // v2：seed + 参数逐节点重建，再覆盖选路结果（state 不参与随机序列，覆盖不影响复现）
      const params = { ...session.mapParams };
      if (Array.isArray(params.enabled)) params.enabled = new Set(params.enabled);
      map = generateMap(createRng(session.mapSeed), params);
      for (const [id, state] of Object.entries(session.mapStates || {})) {
        const node = map.byId.get(id);
        if (node && ['locked', 'open', 'done'].includes(state)) node.state = state;
      }
      nodeId = session.nodeId && map.byId.has(session.nodeId) ? session.nodeId : map.start[0];
    } else {
      // v1 旧档：loadLocalSession 的迁移器已按 floor 合成等价单链（10/20/30 仍是 Boss），
      // 这里用同一纯函数再确定性地重建一遍并应用存档状态；存档缺状态时才本地兜底定位
      map = synthLinearMap(floor);
      for (const [id, state] of Object.entries(session.mapStates || {})) {
        const node = map.byId.get(id);
        if (node && ['locked', 'open', 'done'].includes(state)) node.state = state;
      }
      nodeId = session.nodeId && map.byId.has(session.nodeId)
        ? session.nodeId
        : (map.nodes.find((n) => n.state === 'open')?.id || map.start[0]);
    }
    // 无尽深渊不占地图节点：nodeId 保持 null，mountFloor 用虚拟节点接 31+ 层
    if (endless) nodeId = null;
    // 本层地形 / 目标：存档里有就原样恢复；v1 旧档没有 → mountFloor 内回退成旧版满盘 score 关
    terrain = restoreTerrain(session.terrain);
    goals = Array.isArray(session.goals) ? session.goals : [];

    reportStart({ mode: ROGUE.type });
    toast.info(`🎲 继续上一轮：第 ${floor} 层`);

    if (session.phase === 'map') {
      // 上次停在层间选路
      mountMap();
      return;
    }

    if (session.phase === 'perk') {
      // 上次停在「本层已达标、正在三选一」：按存档里的 id 还原同样的三个候选，不重掷
      const offered = (session.offered || [])
        .map((id) => PERKS.find((perk) => perk.id === id))
        .filter(Boolean);
      if (offered.length > 0) {
        // 先把刚达标那一层的盘面摆回来并锁住，模态框再盖在它上面（顺序不能反：
        // mountFloor 会 replaceChildren，先挂模态框会被它冲掉）
        mountFloor(session);
        if (board) board.lock();
        renderPerkChoice(offered);
        return;
      }
    }
    mountFloor(session);
  }

  // ---- 地图选路 ----
  /** 层间地图屏：三选一结束（或开新 run / phase=map 续玩）后进入 */
  function mountMap() {
    disposeBoard();
    terrain = null;
    goals = [];
    quest = null;
    paintMeta = () => { };

    // 最终 Boss 已过且没有任何可选节点：进胜利结算页（给「领取 / 继续深渊」二选一）；
    // 理论上无开放节点又未通关的状态不该出现，兜底走死亡结算
    if (!hasOpenNode(map)) {
      if (victory) winRun();
      else finishRun();
      return;
    }

    const curDepth = nodeId ? map.byId.get(nodeId)?.depth ?? 0 : 0;
    const biome = rogueBiome(Math.max(1, curDepth + 1));
    const progressText = curDepth > 0
      ? `已通过第 ${curDepth} 层 · 下一区域：${biome.icon} ${biome.name}`
      : `选择第一个节点开始 · ${biome.icon} ${biome.name}`;
    const topEl = el(
      'div',
      { class: 'm3-map-summary' },
      renderStats(bonus, Math.max(1, curDepth), '本轮加成', rewindsLeft),
      el('div', { class: 'm3-map-progress' }, progressText),
    );

    const view = renderMapScreen(map, {
      topEl,
      onExit: () => onExit(),
      onPickNode: (toId) => enterNode(toId),
    });
    container.replaceChildren(view.el);
    view.focus();

    // 选路是天然同步点：立即落本地 + 推云端（刷新后回到地图，而不是上一层盘面）
    persistSession('map', null, true);
  }

  /** 玩家在地图上点了某个可选节点：锁定本层分叉并进入对局 / 非战斗节点 */
  function enterNode(toId) {
    if (!advanceTo(map, nodeId, toId)) return;
    const node = map.byId.get(toId);
    nodeId = toId;
    floor = node.depth;
    // 非战斗节点（开发方案 3.4 / 3.6 / 3.7）没有盘面：直接弹节点 UI，办完回地图
    if (node.type === NODE.EVENT || node.type === NODE.SHOP
      || node.type === NODE.TREASURE || node.type === NODE.REST) {
      mountSpecialNode(node);
      return;
    }
    mountFloor();
  }

  /**
   * 当前所在节点：地图节点优先；通关后的无尽深渊没有地图节点，
   * 用只含 depth/type 的虚拟战斗节点接 31+ 层（terrainFor / floorGoals 只需这两个字段）
   */
  function currentNode() {
    if (map && nodeId && map.byId && map.byId.has(nodeId)) return map.byId.get(nodeId);
    if (endless) return { id: `abyss${floor}`, depth: floor, type: NODE.BATTLE, biome: 'abyss' };
    return null;
  }

  // ---- 非战斗节点：事件 / 宝藏 / 篝火 / 商店（开发方案 3.4 / 3.6 / 3.7）----

  /** 战斗层过关的金币掉落（精英 / Boss 额外加档；无尽深渊的虚拟节点按普通战斗算） */
  function rollBattleGold(type) {
    let gold = runRng.range(ROGUE_GOLD.perBattle[0], ROGUE_GOLD.perBattle[1]);
    if (type === NODE.ELITE) gold += ROGUE_GOLD.perElite;
    if (type === NODE.BOSS) gold += ROGUE_GOLD.perBoss;
    return gold;
  }

  /** 遗物卡片：传 onClick 就是可点选（Boss 宝箱），不传就是纯展示（宝藏 / 商店） */
  function relicCard(def, onClick = null) {
    const children = [
      el('span', { class: 'm3-perk-icon' }, def.icon),
      el(
        'span',
        { class: 'm3-perk-namerow' },
        el('span', { class: 'm3-perk-name' }, def.name),
        el('span', { class: 'm3-perk-lv' }, RARITY_LABEL[def.rarity] || def.rarity),
      ),
      el('span', { class: 'm3-perk-desc' }, def.desc),
    ];
    return onClick
      ? el('button', { class: 'm3-perk m3-relic-card', onClick }, ...children)
      : el('div', { class: 'm3-perk m3-relic-card' }, ...children);
  }

  /** 通用节点模态框外壳：标题 + 副标题 + 主体 + 底部按钮（复用三选一的弹窗外框样式） */
  function openNodeModal({ icon, title, sub, body, foot }) {
    closeNodeModal();
    nodeModal = el(
      'div',
      { class: 'm3-perk-modal' },
      el(
        'div',
        { class: 'm3-perk-dialog m3-node-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
        el(
          'div',
          { class: 'm3-perk-dialog-head' },
          el('h3', { class: 'm3-perk-dialog-title' }, `${icon} ${title}`),
          sub ? el('p', { class: 'm3-perk-dialog-sub' }, sub) : null,
        ),
        body,
        foot || null,
      ),
    );
    container.append(nodeModal);
  }

  /** 非战斗节点办完：标记节点完成、收起模态、回地图（金币 / 遗物 / 加成随之落一次暂存） */
  function finishNode() {
    closeNodeModal();
    shopShelf = null; // 下次进商店重新掷货架
    if (map && nodeId) completeNode(map, nodeId);
    mountMap();
  }

  /** 非战斗节点分派（地图上点到的 EVENT / SHOP / TREASURE / REST） */
  function mountSpecialNode(node) {
    if (node.type === NODE.EVENT) mountEventNode();
    else if (node.type === NODE.TREASURE) mountTreasureNode();
    else if (node.type === NODE.REST) mountRestNode();
    else if (node.type === NODE.SHOP) mountShopNode();
    else finishNode();
  }

  /** Boss 遗物宝箱：三选一（开发方案 3.5）；池子抽空则跳过，不空过 */
  function showRelicChest() {
    const choices = rollRelicChoices(runRng, relics, ROGUE_RELIC.choices);
    if (choices.length === 0) {
      toast.info('遗物已集齐，宝箱是空的');
      gotoMapAfterNode();
      return;
    }
    const body = el(
      'div',
      { class: 'm3-node-body' },
      el('p', { class: 'm3-event-text' }, 'Boss 的宝箱里躺着几件遗物，挑一件带走：'),
      el(
        'div',
        { class: 'm3-relic-choices' },
        ...choices.map((def) => relicCard(def, () => {
          grantRelic({ id: def.id });
          closeNodeModal();
          gotoMapAfterNode();
        })),
      ),
    );
    openNodeModal({ icon: '🎁', title: 'Boss 遗物宝箱', sub: '遗物只在本轮有效，且不进三选一池', body });
  }

  /** 随机事件（开发方案 3.4）：抽一张卡 → 铺可用选项 → 结算并展示结果文案 */
  function mountEventNode() {
    const event = rollEvent(runRng, { depth: floor, coins, relics: [...relics], picks });
    if (!event) {
      toast.info('这一层没有可用事件');
      finishNode();
      return;
    }
    const body = el('div', { class: 'm3-node-body' });
    const showResult = (text) => {
      paintCoins();
      paintRelics();
      body.replaceChildren(
        el('p', { class: 'm3-event-text m3-event-result' }, text || '（无事发生）'),
        el(
          'div',
          { class: 'm3-node-choices' },
          el('button', { class: 'm3-btn', onClick: () => finishNode() }, '继续 →'),
        ),
      );
    };
    // when(state) 读的是当前快照，铺选项时按最新金币 / 遗物过滤
    const choices = availableChoices(event, { depth: floor, coins, relics: [...relics], picks });
    body.append(
      el('p', { class: 'm3-event-text' }, event.text),
      el(
        'div',
        { class: 'm3-node-choices' },
        ...choices.map((choice) => {
          const idx = event.choices.indexOf(choice);
          return el(
            'button',
            { class: 'm3-btn m3-btn--ghost m3-node-choice', onClick: () => showResult(applyChoice(event, idx, runCtx()).text) },
            choice.text,
          );
        }),
      ),
    );
    openNodeModal({ icon: event.icon || '❓', title: '随机事件', sub: `第 ${floor} 层 · 问号房`, body });
  }

  /** 宝藏（开发方案 3.7）：白拿一件随机遗物；遗物集齐回落到祝福，仍抽不到就给金币 */
  function mountTreasureNode() {
    const relic = rollRelic(runRng, relics);
    const body = el('div', { class: 'm3-node-body' });
    if (relic) {
      grantRelic({ id: relic.id });
      body.replaceChildren(
        el('p', { class: 'm3-event-text' }, '宝箱里是一件遗物：'),
        el('div', { class: 'm3-relic-choices' }, relicCard(relic)),
      );
    } else {
      const perk = grantPerk({});
      if (perk) {
        body.replaceChildren(
          el('p', { class: 'm3-event-text' },
            `遗物已集齐，宝箱换成了一张祝福：${perk.icon}${perk.name} —— ${descOf(perk, levelOf(perk))}`),
        );
      } else {
        const gold = gainGold(ROGUE_GOLD.perBattle[1]);
        body.replaceChildren(el('p', { class: 'm3-event-text' }, `宝箱里只有金币：+${gold} 🪙`));
      }
    }
    openNodeModal({
      icon: '💎',
      title: '宝藏',
      sub: `第 ${floor} 层 · 白拿一件遗物（只在本轮有效）`,
      body,
      foot: el(
        'div',
        { class: 'm3-perk-dialog-foot' },
        el('span', { class: 'm3-perk-dialog-hint' }, '遗物不进三选一池，每件最多持有 1 个'),
        el(
          'div',
          { class: 'm3-perk-dialog-btns' },
          el('button', { class: 'm3-btn', onClick: () => finishNode() }, '收下 →'),
        ),
      ),
    });
  }

  /** 篝火（开发方案 3.7）：休整（免死 +1）或锻造（把一张祝福的效果再叠一层） */
  function mountRestNode() {
    // 可锻造的祝福：本轮已获的去重列表（锻造不占该祝福的叠加上限，所以不看 max）
    const forgeable = [];
    const seen = new Set();
    for (const perk of pickedPerks) {
      if (seen.has(perk.id)) continue;
      seen.add(perk.id);
      forgeable.push(perk);
    }

    const body = el(
      'div',
      { class: 'm3-node-body' },
      el('p', { class: 'm3-event-text' }, '篝火还在烧。歇一歇，或者把一件东西重新淬一遍：'),
      el(
        'div',
        { class: 'm3-node-choices' },
        el(
          'button',
          {
            class: 'm3-btn m3-btn--ghost m3-node-choice',
            onClick: () => {
              bonus.shields = Math.max(0, bonus.shields + 1);
              paintStatsRef();
              toast.success('🔥 休整：免死次数 +1');
              finishNode();
            },
          },
          '🔥 休整：免死次数 +1（下一层容错）',
        ),
        el(
          'button',
          {
            class: 'm3-btn m3-btn--ghost m3-node-choice',
            disabled: forgeable.length === 0,
            onClick: () => openForge(forgeable),
          },
          forgeable.length > 0 ? '⚒️ 锻造：把一张祝福的效果再叠一层' : '⚒️ 锻造：本轮还没有祝福',
        ),
        el('button', { class: 'm3-btn m3-btn--ghost m3-node-choice', onClick: () => finishNode() }, '离开篝火'),
      ),
    );

    // 锻造：重跑该祝福的 apply（等价于「再叠一层」），并记进 upgradedPerkIds 作展示标记
    function openForge(list) {
      openNodeModal({
        icon: '⚒️',
        title: '锻造哪一张',
        sub: '效果再叠一层（不占该祝福的叠加上限，只在本轮有效）',
        body: el(
          'div',
          { class: 'm3-node-body' },
          el(
            'div',
            { class: 'm3-node-choices' },
            ...list.map((perk) => el(
              'button',
              {
                class: 'm3-btn m3-btn--ghost m3-node-choice',
                onClick: () => {
                  perk.apply(bonus, { lv: levelOf(perk), rng: runRng });
                  if (!upgradedPerkIds.includes(perk.id)) upgradedPerkIds.push(perk.id);
                  paintStatsRef();
                  toast.success(`⚒️ 锻造：${perk.icon}${perk.name} 的效果再叠了一层`);
                  finishNode();
                },
              },
              `${perk.icon}${perk.name} ×${picks[perk.id] || 1}`,
            )),
            el('button', { class: 'm3-btn m3-btn--ghost m3-node-choice', onClick: () => mountRestNode() }, '← 返回'),
          ),
        ),
      });
    }

    openNodeModal({ icon: '🔥', title: '篝火', sub: `第 ${floor} 层 · 只在本轮生效`, body });
  }

  /** 商店（开发方案 3.6）：货架铺格 / 购买 / 刷新 / 移除；金币只在本轮有效 */
  function mountShopNode() {
    if (!shopShelf) {
      shopRefreshUsed = 0;
      shopShelf = rollShelf(
        runRng,
        {
          depth: floor,
          coins,
          picks,
          relics: [...relics],
          bannedPerkIds: [...bannedPerkIds],
          // 与三选一池同口径：只卖已解锁（lv>0）的祝福，否则 grantPerk 会拒收
          allowedPerkIds: [...unlockedSet(getRogueMeta())],
          removedThisRun: bannedPerkIds.length,
        },
        {},
      );
    }
    renderShop();
  }

  /** 遗物对商店价格的修正（折扣 / 涨价，已夹到 5 折下限） */
  function shopMods() {
    return { shopDiscount: relicHooks.mods.shopDiscount };
  }

  function renderShop() {
    const mods = shopMods();
    const shelf = shelfWithPrices(shopShelf, mods);
    const refreshCost = Math.max(1, Math.round(ROGUE_GOLD.refreshCost * mods.shopDiscount));
    const canRefresh = shopRefreshUsed < ROGUE_GOLD.refreshMax;
    const body = el(
      'div',
      { class: 'm3-node-body' },
      el(
        'div',
        { class: 'm3-shop-bar' },
        el('span', { class: 'm3-shop-coins' }, `🪙 ${coins}`),
        el('span', { class: 'm3-shop-hint' }, '金币只在本轮有效，终局清零、不兑换精华'),
      ),
      el('div', { class: 'm3-shop-grid' }, ...shelf.map((item) => shopCell(item, mods))),
    );
    openNodeModal({
      icon: '🛒',
      title: '商店',
      sub: `第 ${floor} 层 · 区域 Boss 前的补给点`,
      body,
      foot: el(
        'div',
        { class: 'm3-perk-dialog-foot' },
        el('span', { class: 'm3-perk-dialog-hint' }, `刷新 ${shopRefreshUsed}/${ROGUE_GOLD.refreshMax} · 每次 ${refreshCost} 🪙`),
        el(
          'div',
          { class: 'm3-perk-dialog-btns' },
          el('button', { class: 'm3-btn m3-btn--ghost', disabled: !canRefresh, onClick: () => onShopRefresh() }, '🔄 刷新货架'),
          el('button', { class: 'm3-btn', onClick: () => finishNode() }, '离开商店 →'),
        ),
      ),
    });
  }

  /** 商店一格：图标 + 名称 + 说明 + 价格按钮 */
  function shopCell(item, mods) {
    const price = priceOf(item, mods);
    const perk = item.kind === 'perk' ? PERKS.find((p) => p.id === item.perkId) : null;
    const relic = item.kind === 'relic' && item.relicId ? relicById(item.relicId) : null;
    let icon = '🎁';
    let name = '商品';
    let desc = '';
    if (item.kind === 'perk') {
      icon = perk ? perk.icon : '🎁';
      name = perk ? perk.name : item.perkId;
      desc = perk ? descOf(perk, levelOf(perk)) : '';
    } else if (item.kind === 'relic') {
      icon = item.random ? '❔' : (relic ? relic.icon : '🎁');
      name = item.random ? '神秘遗物' : (relic ? relic.name : item.relicId);
      desc = item.random ? '购买时随机开出一件遗物；开空则半价返还' : (relic ? relic.desc : '');
    } else if (item.kind === 'service') {
      icon = item.service === 'moves' ? '🥾' : (item.service === 'shield' ? '🛡' : '🎲');
      name = item.service === 'moves' ? `下一层 +${ROGUE_GOLD.movesAmount} 步`
        : (item.service === 'shield' ? '免死 +1' : '三选一重随 +1');
    } else if (item.kind === 'remove') {
      icon = '🗑️';
      name = '移除一条祝福';
      desc = `封禁本轮一条不要的祝福，返还 ${ROGUE_GOLD.removeRefund} 🪙`;
    }
    const suffix = item.kind === 'relic' && item.rarity ? `（${RARITY_LABEL[item.rarity] || item.rarity}）` : '';
    return el(
      'div',
      { class: `m3-shop-item${item.sold ? ' m3-shop-item--sold' : ''}` },
      el('span', { class: 'm3-shop-icon' }, icon),
      el('span', { class: 'm3-shop-name' }, `${name}${suffix}`),
      desc ? el('span', { class: 'm3-shop-desc' }, desc) : null,
      el(
        'button',
        { class: 'm3-btn m3-btn--ghost m3-shop-buy', disabled: item.sold === true, onClick: () => onShopBuy(item) },
        item.sold ? '已售出' : `${price} 🪙`,
      ),
    );
  }

  function onShopBuy(item) {
    if (item.kind === 'remove') {
      openRemovePicker(item);
      return;
    }
    const res = buyItem(runCtx(), item, shopMods());
    if (!res.ok) {
      toast.info(res.text);
      return;
    }
    toast.success(res.text);
    renderShop(); // 重绘货架：售出状态与金币余额都要就地刷新
  }

  /** 移除服务：先选一条要封禁的祝福（开发方案 3.6 的「删牌」等价物） */
  function openRemovePicker(item) {
    const options = Object.keys(picks)
      .filter((id) => (picks[id] || 0) > 0)
      .map((id) => PERKS.find((p) => p.id === id))
      .filter(Boolean);
    const body = el(
      'div',
      { class: 'm3-node-body' },
      el(
        'div',
        { class: 'm3-node-choices' },
        options.length === 0
          ? el('span', { class: 'm3-perk-dialog-hint' }, '本轮还没有可以移除的祝福')
          : options.map((perk) => el(
            'button',
            {
              class: 'm3-btn m3-btn--ghost m3-node-choice',
              onClick: () => {
                const res = removePerk(runCtx(), perk.id, shopMods());
                if (!res.ok) {
                  toast.info(res.text);
                  return;
                }
                toast.success(res.text);
                item.sold = true;
                renderShop();
              },
            },
            `${perk.icon}${perk.name} ×${picks[perk.id]}`,
          )),
        el('button', { class: 'm3-btn m3-btn--ghost m3-node-choice', onClick: () => renderShop() }, '← 返回商店'),
      ),
    );
    openNodeModal({
      icon: '🗑️',
      title: '移除一条祝福',
      sub: `花费 ${priceOf({ kind: 'remove' }, shopMods())} 🪙，返还 ${ROGUE_GOLD.removeRefund} 🪙`,
      body,
    });
  }

  function onShopRefresh() {
    const refreshState = { used: shopRefreshUsed };
    const res = refreshShelf(
      runRng,
      {
        coins,
        picks,
        relics: [...relics],
        bannedPerkIds: [...bannedPerkIds],
        allowedPerkIds: [...unlockedSet(getRogueMeta())],
      },
      refreshState,
      shopMods(),
    );
    if (!res.ok) {
      toast.info(res.text);
      return;
    }
    // refreshShelf 只改它拿到的临时 state；金币统一以 addCoins 为唯一入口，这里同步真实扣减
    addCoins(-res.spent);
    shopRefreshUsed = refreshState.used;
    shopShelf = res.items;
    renderShop();
  }

  // ---- 层内对局 ----
  /**
   * @param {object} [restore] 层内暂存（续玩时传入）：本层棋盘、任务进度、剩余洗牌都从它还原
   * @param {boolean} [rerollLayer=true] 「时光倒流」重打本层时传 false：
   *   地形与硬目标保持不变（同一层），只重建棋盘；新进入节点 / 续玩都按默认值走
   */
  function mountFloor(restore = null, rerollLayer = true) {
    disposeBoard();
    floorCleared = false;
    rewinding = false;
    const node = currentNode();

    // ---- 遗物每层开局（开发方案 3.5）----
    // perFloor 类 grant 在这里重放（各自的写法保证幂等，所以续玩重放不会叠数值）；
    // 触发计数 relicUsed 只在本层有效，进层即清零
    relicUsed = {};
    relicHooks.onFloorStart(relicCtx(null));
    // 商店「+N 步」只作用于下一层：进层时消费一次并清零（瞬态，不写档；刷新会丢，属于已知取舍）
    const carryMoves = nextFloorMoves;
    nextFloorMoves = 0;

    // ---- 本层地形与硬目标（开发方案 3.2）----
    if (restore) {
      // 续玩：地形 / 目标以存档为准，不重掷（重掷会白吃随机序列，局面也会对不上）
      terrain = restore.terrain ? restoreTerrain(restore.terrain) : terrain || null;
      if (Array.isArray(restore.goals) && restore.goals.length > 0) goals = restore.goals;
      // v1 旧档没有这两个字段：旧版就是 8×8 满盘 + 单一分数目标，目标值必须与存档盘面同源
      if (goals.length === 0) goals = [{ type: 'score', target: goalOf(floor, bonus) }];
    } else if (rerollLayer || !terrain || goals.length === 0) {
      // 新进入节点：地形与目标都由 runRng 当场掷出（同 seed 可复现）
      terrain = terrainFor(node, runRng);
      const probe = floorOptions(bonus, floor, terrain);
      goals = floorGoals(node, bonus, runRng, { colors: probe.colors, terrain });
    }
    const opts = floorOptions(bonus, floor, terrain);
    if (carryMoves > 0) opts.moves += carryMoves; // 商店买来的「下一层 +N 步」并入本层起手步数
    shufflesLeft = restore ? (restore.shufflesLeft || 0) : bonus.shuffles;
    // 续玩时不重掷任务：重掷会白吃一次随机序列，进度也对不上存档
    quest = restore ? restoreQuest(restore.quest) : questFor(floor, bonus, runRng);

    // ---- Boss 运行时（开发方案 3.3）----
    // 新进入：状态与 goals[0].target 同源（bossHpTarget）；续玩：以存档里的血量 / 阶段为准；
    // 时光倒流重打同一 Boss 层（rerollLayer=false 且无 restore）：重建满血状态
    const bossDef = node?.type === NODE.BOSS ? bossAt(node.depth) : null;
    if (bossDef) {
      if (restore?.boss && ROGUE_BOSSES[restore.boss.id] && Number.isFinite(restore.boss.target)) {
        boss = {
          id: restore.boss.id,
          target: Math.max(1, Math.floor(restore.boss.target)),
          fired: Array.isArray(restore.boss.fired) ? [...restore.boss.fired] : [],
        };
      } else {
        boss = createBossState(bossDef, bonus);
      }
    } else {
      boss = null;
    }

    const nodeMeta = NODE_META[node?.type] || NODE_META[NODE.BATTLE];
    const biome = endless ? ABYSS_BIOME : rogueBiome(floor);
    const biomeText = endless
      ? `第 ${floor} 层 · ${biome.icon}${biome.name}`
      : `${biome.icon} ${biome.name} · 第 ${biome.from}-${biome.to} 层`;
    // 非普通节点显示节点类型（精英/Boss），普通层显示当前区域名（文档第五章：进新区域换视觉）
    const floorText = !endless && node?.type && node.type !== NODE.BATTLE
      ? `第 ${floor} 层 · ${nodeMeta.icon}${nodeMeta.name}`
      : `第 ${floor} 层 · ${biome.icon}${biome.name}`;
    const floorEl = el('span', { class: 'm3-side-value' }, floorText);
    const progressEl = el('span', { class: 'm3-side-value' }, '0');
    const movesEl = el('span', { class: 'm3-side-value' }, String(opts.moves));
    // 多目标列表：每个目标一行（短文案 + 当前/目标），全部达成才过关
    const goalsBox = el('div', { class: 'm3-rogue-goals' });
    // 分数目标额外给一条进度条（纯条件目标层没有分数目标，不显示）
    const scoreGoal = goals.find((g) => g.type === 'score') || null;
    const goalFill = el('span', { class: 'm3-goalbar-fill' });
    const goalBarEl = el('span', { class: 'm3-goalbar' }, goalFill);
    const goalPctEl = el('span', { class: 'm3-side-pct' }, '0%');
    // Boss 层血条就是唯一目标，侧栏的普通分数条 / 目标行让位给它（避免同屏两条同义进度）
    const scoreBar = scoreGoal && !boss ? el('div', { class: 'm3-side-bar' }, goalBarEl, goalPctEl) : null;
    if (boss) goalsBox.classList.add('m3-hidden');
    const scoreEl = el('span', { class: 'm3-hud-value' }, String(baseScore));
    const comboEl = el('span', { class: 'm3-hud-value' }, String(maxCombo));
    const expEl = el('span', { class: 'm3-hud-value' }, '—');
    const expItem = el('span', { class: 'm3-hud-item m3-hidden' }, '预计经验', expEl);
    const questEl = el('span', { class: 'm3-goal m3-quest' });

    // ---- 金币与遗物（开发方案 3.5 / 3.6）：只在本轮有效，终局清零、不进局外存档 ----
    const coinsEl = el('span', { class: 'm3-side-value' }, String(coins));
    const relicsEl = el('div', { class: 'm3-relic-slots' });
    paintCoins = () => { coinsEl.textContent = String(coins); };
    paintRelics = () => {
      relicsEl.replaceChildren(
        ...Array.from({ length: ROGUE_RELIC.slotMax }, (_, i) => {
          const def = relics[i] ? relicById(relics[i]) : null;
          return def
            ? el(
              'span',
              { class: 'm3-relic m3-relic--on', title: `${def.name}（${RARITY_LABEL[def.rarity] || def.rarity}）\n${def.desc}` },
              def.icon,
            )
            : el('span', { class: 'm3-relic' }, '·');
        }),
        relics.length > ROGUE_RELIC.slotMax
          ? el('span', { class: 'm3-relic-more' }, `+${relics.length - ROGUE_RELIC.slotMax}`)
          : null,
      );
    };
    paintCoins();
    paintRelics();

    /** 局内任务条：进行中显示「收集什么 / 差多少 / 能拿什么」，达成后改成奖励说明 */
    function paintQuest() {
      if (!quest) {
        questEl.classList.add('m3-hidden');
        return;
      }
      const { reward } = quest;
      questEl.classList.remove('m3-hidden');
      questEl.classList.toggle('m3-quest--done', quest.done);
      if (quest.done) {
        questEl.replaceChildren(
          el('span', {}, `✅ ${reward.icon} ${reward.name}`),
          el('span', { class: 'm3-quest-reward' }, reward.desc),
        );
        return;
      }
      questEl.replaceChildren(
        el('span', { class: 'm3-quest-title' }, '📜 收集'),
        el('i', { class: `m3-swatch m3-c${quest.color}` }),
        el('span', {}, `${COLOR_NAMES[quest.color]}色 ×${quest.need}`),
        el('span', { class: 'm3-quest-progress' }, `${quest.progress}/${quest.need}`),
        el('span', { class: 'm3-quest-reward' }, `→ ${reward.icon}${reward.name}`),
      );
    }

    /** 任务达成：奖励当场生效（加步 / 本层得分翻倍 / 就地注入特殊元素），另发局内金币 */
    function grantQuestReward() {
      quest.done = true;
      questsDone += 1;
      quest.reward.apply(board, opts);
      const gold = gainGold(ROGUE_GOLD.perQuest); // 达成层内任务的局内金币（开发方案 3.6）
      paintQuest();
      toast.success(`${quest.reward.icon} 任务达成：${quest.reward.name} · ${quest.reward.desc}${gold > 0 ? ` · +${gold} 🪙` : ''}`);
    }

    const shuffleBtn = bonus.shuffles > 0
      ? el(
        'button',
        { class: 'm3-btn m3-btn--ghost', onClick: () => onShuffle() },
        `免费洗牌 ×${shufflesLeft}`,
      )
      : null;

    // 无尽深渊里随时可以「见好就收」：撤离按通关结算（奖励在最终 Boss 倒下时已锁定）
    const retreatBtn = endless
      ? el('button', { class: 'm3-btn m3-btn--ghost', onClick: () => finishRun() }, '🌀 撤离深渊（结算）')
      : null;

    const actions = el(
      'div',
      { class: 'm3-actions' },
      shuffleBtn,
      retreatBtn,
      el(
        'button',
        { class: 'm3-btn m3-btn--ghost', onClick: () => showScoreDetails(board ? board.getState() : {}) },
        '积分详情',
      ),
      el('button', { class: 'm3-btn m3-btn--ghost', onClick: () => onExit() }, '返回选择'),
    );

    const host = el('div', { class: 'm3-board-host' });

    // ---- Boss 血条（开发方案 3.3）：名称 + 剩余血量 + 阶段横幅，挂在棋盘正上方 ----
    let bossUi = null;
    let bossPrevDamage = 0;
    let bossPhaseTimer = null;
    if (boss && bossDef) {
      const fill = el('span', { class: 'm3-boss-fill' });
      const num = el('span', { class: 'm3-boss-hp-num' });
      const phase = el('p', { class: 'm3-boss-phase m3-hidden' });
      const bar = el(
        'div',
        { class: 'm3-bossbar' },
        el('div', { class: 'm3-boss-head' }, el('span', { class: 'm3-boss-name' }), num),
        el('span', { class: 'm3-boss-track' }, fill),
        phase,
      );
      bossUi = { bar, fill, num, phase, name: bar.querySelector('.m3-boss-name') };
    }

    /** 刷新 Boss 血条；跨阶段阈值时弹一次性横幅（P1 只做演出，机关效果留 P1.x） */
    function paintBoss(info) {
      if (!boss || !bossUi) return;
      const def = ROGUE_BOSSES[boss.id];
      const damage = Math.min(info.score, boss.target);
      const remain = boss.target - damage;
      const pct = boss.target > 0 ? Math.max(0, (remain / boss.target) * 100) : 0;
      bossUi.fill.style.width = `${pct}%`;
      bossUi.name.textContent = `${def.icon} ${def.name}`;
      bossUi.num.textContent = `❤ ${remain}/${boss.target}`;
      bossUi.bar.classList.toggle('m3-bossbar--low', remain / boss.target <= 1 / 3);
      const crossed = crossedPhases(def, boss, bossPrevDamage, info.score);
      for (const p of crossed) {
        toast.info(`${def.icon} ${p.icon} ${p.text}`);
        bossUi.phase.textContent = `${p.icon} ${p.text}`;
        bossUi.phase.classList.remove('m3-hidden');
        clearTimeout(bossPhaseTimer);
        bossPhaseTimer = setTimeout(() => bossUi?.phase.classList.add('m3-hidden'), 2800);
      }
      bossPrevDamage = info.score;
    }
    const perkListEl = renderPerkList();
    // 数据面板单独留引用：免死 / 时光倒流消耗后要就地刷新（层内会变的加成）
    let statsEl = renderStats(bonus, floor, '本轮加成', rewindsLeft);
    const paintStats = () => {
      const next = renderStats(bonus, floor, '本轮加成', rewindsLeft);
      statsEl.replaceWith(next);
      statsEl = next;
    };
    paintStatsRef = paintStats;

    /** 侧栏一行：左标签 + 右数值（数值节点由外层持有，便于就地刷新） */
    const sideRow = (label, valueNode) => el(
      'div',
      { class: 'm3-side-row' },
      el('span', { class: 'm3-side-label' }, label),
      valueNode,
    );

    // 精华（局外养成）：余额由服务端下发，这里只是读出来显示；
    // 「本轮可得」按当前层数预览，层间多看一眼就能知道「再深一层多拿多少」
    const essenceEl = el('span', { class: 'm3-side-value' }, String(getRogueMeta().essence));
    const earnEl = el('span', { class: 'm3-side-value' }, `+${essenceForRun(floor, getRogueMeta(), { win: victory })}`);
    paintMeta = () => {
      essenceEl.textContent = String(getRogueMeta().essence);
      earnEl.textContent = `+${essenceForRun(floor, getRogueMeta(), { win: victory })}`;
    };
    paintMeta();

    // 左侧数据面板：本层进度 / 本轮加成 / 精华 / 已获祝福。
    // 这些数都随本轮成长，原来横排在棋盘上方只能挤成一行小标签，
    // 既放不下「本层得分 / 目标」的进度关系，也看不出祝福叠了几层
    const side = el(
      'aside',
      { class: 'm3-side' },
      el(
        'div',
        { class: 'm3-side-block' },
        el('div', { class: 'm3-side-title' }, '本层进度'),
        el(
          'div',
          { class: 'm3-side-rows' },
          sideRow('层数', floorEl),
          sideRow('本层得分', progressEl),
          sideRow('剩余步数', movesEl),
        ),
        goalsBox,
        scoreBar,
        questEl,
      ),
      statsEl,
      el(
        'div',
        { class: 'm3-side-block' },
        el(
          'div',
          { class: 'm3-side-titlerow' },
          el('div', { class: 'm3-side-title' }, '✦ 精华'),
          // 局内也能开养成面板：看到余额后顺手解锁一张，下一轮立刻生效
          el('button', { class: 'm3-side-link', onClick: () => showPerkCodex(picks) }, '养成'),
        ),
        el(
          'div',
          { class: 'm3-side-rows' },
          sideRow('余额', essenceEl),
          sideRow('本轮可得', earnEl),
        ),
      ),
      el(
        'div',
        { class: 'm3-side-block' },
        el(
          'div',
          { class: 'm3-side-titlerow' },
          el('div', { class: 'm3-side-title' }, '🪙 金币与遗物'),
        ),
        el(
          'div',
          { class: 'm3-side-rows' },
          sideRow('金币', coinsEl),
        ),
        relicsEl,
      ),
      el(
        'div',
        { class: 'm3-side-block' },
        el(
          'div',
          { class: 'm3-side-titlerow' },
          el('div', { class: 'm3-side-title' }, '已获祝福'),
          el('button', { class: 'm3-side-link', onClick: () => showPerkCodex(picks) }, '图鉴'),
        ),
        perkListEl,
      ),
    );

    // 棋盘上方只留「整轮累计」的读数；本层相关的数都在侧栏，避免两处显示同一件事
    const hud = el(
      'div',
      { class: 'm3-hud' },
      el('span', { class: 'm3-hud-item' }, '本轮总分', scoreEl),
      el('span', { class: 'm3-hud-item' }, '最高连锁', comboEl),
      expItem,
    );

    // 标题 / HUD / 棋盘 / 按钮全部落在同一列里：四者共用一个竖轴，
    // 否则标题居中于整页、棋盘居中于剩余空间、按钮又居中于整页，三条中心线错开就显乱
    container.replaceChildren(
      el(
        'div',
        { class: `m3-rogue-shell m3-biome--${biome.id}` },
        side,
        el(
          'div',
          { class: 'm3-main' },
          el(
            'div',
            { class: 'm3-head' },
            el('h2', { class: 'm3-title' }, '🎲 肉鸽试炼'),
            el('p', { class: 'm3-sub' }, biomeText),
          ),
          hud,
          bossUi?.bar || null,
          host,
          actions,
        ),
      ),
    );

    /** 预计经验：按本轮到达层数估算，再乘局外「经验共鸣」（奖励配置未下发时整项隐藏） */
    function paintExp() {
      const exp = estimateExp({ mode: ROGUE.type, score: totalScore(), floor });
      expItem.classList.toggle('m3-hidden', exp == null);
      if (exp != null) {
        expEl.textContent = `+${exp}`;
        expItem.title = '按到达层数换算 × 局外「经验共鸣」（以服务端结算为准）';
      }
    }

    /**
     * 本层目标进度：多目标列表逐行刷新；若存在分数目标，同步刷分数进度条。
     * 目标语义全部来自 goals.js（与闯关模式同源），这里只做渲染
     */
    function paintLayerGoals(info) {
      goalsBox.replaceChildren(
        ...goalProgress(goals, info).map(({ goal: item, current, done }) => {
          const target = item.target || 0;
          return el(
            'div',
            { class: `m3-goal${done ? ' m3-goal--done' : ''}` },
            el('span', { class: 'm3-goal-text' }, goalShort(item)),
            el('span', { class: 'm3-rogue-goal-num' }, `${Math.min(current, target)}/${target}`),
          );
        }),
      );
      if (scoreGoal) {
        const pct = scoreGoal.target > 0 ? Math.min(100, (info.score / scoreGoal.target) * 100) : 0;
        goalFill.style.width = `${pct}%`;
        goalPctEl.textContent = `${Math.floor(pct)}%`;
        goalBarEl.classList.toggle('m3-goalbar--done', info.score >= scoreGoal.target);
        goalPctEl.classList.toggle('m3-side-pct--done', info.score >= scoreGoal.target);
      }
    }

    function onUpdate(info) {
      progressEl.textContent = String(info.score);
      movesEl.textContent = String(info.movesLeft);
      scoreEl.textContent = String(baseScore + info.score);
      comboEl.textContent = String(Math.max(maxCombo, info.maxCascade));
      paintLayerGoals(info);
      paintBoss(info);
      paintExp();

      // 遗物 onUpdate（开发方案 3.5）：可能改棋盘（加步 / 注入特殊元素 / 改倍率），
      // 改了会从 board 内部再回调一次 onUpdate，用 inRelicUpdate 挡一层防止无限重入
      if (!inRelicUpdate) {
        inRelicUpdate = true;
        try {
          relicHooks.onUpdate(relicCtx(board), info);
        } finally {
          inRelicUpdate = false;
        }
      }

      // 局内任务：进度取本层累计消除的各颜色数（新棋盘从 0 起算，无需另记基线）
      if (quest && !quest.done) {
        const got = info.collected[quest.color] || 0;
        if (got !== quest.progress) {
          quest.progress = got;
          paintQuest();
        }
        if (got >= quest.need) grantQuestReward();
      }

      // 过关：本层全部硬目标达成（分数 / 收集 / 清障的任意组合）
      if (!floorCleared && allGoalsDone(goals, info)) onFloorCleared();
      // 本层刚达标时，onFloorCleared 已经落下 phase='perk' 的暂存，这里不能再用 'floor' 覆盖它；
      // 局内任务奖励会改动棋盘（加步 / 注入特殊元素 / 改倍率），所以其余情况在最后统一落一次
      if (!floorCleared) persistSession('floor');
    }

    function onGameOver(info) {
      if (finished || floorCleared || rewinding || allGoalsDone(goals, info)) return;
      if (bonus.shields > 0) {
        bonus.shields -= 1;
        toast.info(`🛡 免死金牌生效，补 ${ROGUE.shieldMoves} 步`);
        board.addMoves(ROGUE.shieldMoves);
        paintStats();
        return;
      }
      // 「时光倒流」机制：本轮还留着次数时把这层整个重打一遍（新盘面、满步数，不判结束）。
      // 必须推迟到当前回调栈之外再重建棋盘——onGameOver 是从 board 内部回调出来的，
      // 就地 mountFloor → disposeBoard 会把正在执行的棋盘对象拆掉。
      // rerollLayer=false：同一节点的地形与硬目标不变，只是换个新盘面重打
      if (rewindsLeft > 0) {
        rewindsLeft -= 1;
        rewinding = true;
        toast.info(`⏳ 时光倒流：第 ${floor} 层重打（还剩 ${rewindsLeft} 次）`);
        paintStats();
        setTimeout(() => {
          if (!finished) mountFloor(null, false);
        }, 0);
        return;
      }
      finishRun();
    }

    async function onShuffle() {
      if (!board || shufflesLeft <= 0 || floorCleared) return;
      const ok = await board.shuffle();
      if (!ok) return;
      shufflesLeft -= 1;
      shuffleBtn.textContent = shufflesLeft > 0 ? `免费洗牌 ×${shufflesLeft}` : '洗牌已用完';
      shuffleBtn.disabled = shufflesLeft <= 0;
    }

    // 续玩时用存档里的种子与棋盘快照：随机序列与局面都接着上次走
    const savedBoard = restore?.board || null;
    /** 每次走子后（连锁逐层）：把遗物 onStep 分发给持有遗物（开发方案 3.5） */
    function onStep(step) {
      if (relics.length > 0) relicHooks.onStep(relicCtx(board), step);
    }
    board = createMatch3Board(host, {
      payload: { ...opts, id: null },
      seed: savedBoard && Number.isFinite(savedBoard.seed) ? savedBoard.seed : Date.now() % 2147483647,
      snapshot: savedBoard,
      onUpdate,
      onStep,
      onGameOver,
    });

    // 续玩出来的局面要把侧栏与任务条按当前状态补画一遍（board 初始化不会回调 onUpdate）
    if (savedBoard) {
      const info = board.getState();
      progressEl.textContent = String(info.score);
      movesEl.textContent = String(info.movesLeft);
      scoreEl.textContent = String(baseScore + info.score);
      comboEl.textContent = String(Math.max(maxCombo, info.maxCascade));
      paintLayerGoals(info);
      // Boss 续玩：先把阶段基线对齐当前伤害，已触发过的阶段不会因刷新重播
      bossPrevDamage = info.score;
      paintBoss(info);
      if (quest && !quest.done) quest.progress = info.collected[quest.color] || 0;
    } else {
      paintLayerGoals({ score: 0, collected: {}, blockersCleared: 0 }); // 新一层：目标与进度条归零
      paintBoss({ score: 0 });
    }

    paintExp();
    paintQuest();
    refreshExp = paintExp;
    persistSession('floor', null, true); // 进层是天然同步点：立即落本地 + 推云端
  }

  /** 已获祝福：图标 + 叠加层数，鼠标悬停看效果 */
  function renderPerkStrip() {
    if (pickedPerks.length === 0) {
      return el('div', { class: 'm3-perks-strip m3-hidden' });
    }
    const counts = new Map();
    for (const perk of pickedPerks) counts.set(perk, (counts.get(perk) || 0) + 1);
    return el(
      'div',
      { class: 'm3-perks-strip' },
      ...Array.from(counts.entries()).map(([perk, n]) =>
        el(
          'span',
          { class: 'm3-perks-chip', title: `${perk.name} Lv.${levelOf(perk)}：${descOf(perk, levelOf(perk))}` },
          `${perk.icon}${perk.name}${n > 1 ? ` ×${n}` : ''}`,
        )),
    );
  }

  /**
   * 侧栏的「已获祝福」：图标 + 名称 + 叠了几层，悬停看效果
   *
   * 与 renderPerkStrip 的区别是这里要竖排在窄栏里，且能看到祝福名字
   * （结算界面仍用横排的 strip，那里宽度足够）。
   */
  function renderPerkList() {
    if (pickedPerks.length === 0) {
      return el('div', { class: 'm3-side-empty' }, '过一层拿一张，加成会一直留到本轮结束');
    }
    const counts = new Map();
    for (const perk of pickedPerks) counts.set(perk, (counts.get(perk) || 0) + 1);
    return el(
      'div',
      { class: 'm3-side-perks' },
      ...Array.from(counts.entries()).map(([perk, n]) =>
        el(
          'div',
          { class: 'm3-side-perk', title: `${perk.name} Lv.${levelOf(perk)}：${descOf(perk, levelOf(perk))}` },
          el('span', { class: 'm3-side-perk-icon' }, perk.icon),
          el('span', { class: 'm3-side-perk-name' }, perk.name),
          el('span', { class: 'm3-side-perk-count' }, `×${n}`),
        )),
    );
  }

  // ---- 过关：三选一祝福 ----
  /** 本层三选一的稀有度保底（精英 rare / Boss epic，开发方案 3.3）；普通层 / 深渊层为 null */
  let clearedRarity = null;
  /** Boss 倒下后还要开一次遗物宝箱（开发方案 3.5）：祝福选完再弹，选完才回地图 */
  let pendingRelicChest = false;

  function onFloorCleared() {
    floorCleared = true;
    board.lock(); // 达标即锁盘，本层不再消耗步数
    const info = board.getState();
    baseScore += info.score;
    maxCombo = Math.max(maxCombo, info.maxCascade);
    totalMoves += info.moves;
    totalCleared += info.cleared;

    const node = currentNode();

    // 局内金币掉落（开发方案 3.6）：战斗层按区间，精英 / Boss 额外加档；
    // 提前达标时剩余步数再折一笔（有上限，防高倍率 build 靠「一步一层」刷钱）。金币只在本轮有效
    const drop = rollBattleGold(node?.type);
    const refund = info.movesLeft > 0
      ? Math.min(
        ROGUE_GOLD.moveRefundMax,
        Math.round(info.movesLeft * ROGUE_GOLD.moveRefund * relicHooks.mods.moveRefundMult),
      )
      : 0;
    const earned = gainGold(drop + refund);
    if (earned > 0) {
      toast.success(`🪙 +${earned} 金币（过关 ${drop}${refund > 0 ? ` · 余步折算 ${refund}` : ''}）`);
    }

    // Boss 击败：计数 +1（最终上报 0-3）；第 30 层倒下 = 本轮通关，胜利页在回地图时弹出
    if (node?.type === NODE.BOSS) {
      const def = bossAt(node.depth);
      bossKills = Math.min(3, bossKills + 1);
      if (def?.depth === MAP_DEPTH) victory = true;
      pendingRelicChest = true; // 祝福选完再开遗物宝箱（开发方案 3.5）
      toast.success(`👑 击败 ${def?.icon || ''}${def?.name || 'Boss'}！`);
    }

    // 「先手规划」机制：第 1 层过关后连抽 2 次（多拿一张）。只在第 1 层给——
    // 它的定位是「抢跑」，越往后给越接近纯白送，就不再是机制而是数值了
    if (floor === 1 && mechanicOn(getRogueMeta(), 'planning')) {
      extraPicks = Math.max(extraPicks, mechanicCfg().planning.firstFloorPicks - 1);
    }

    // 奖励更厚（开发方案 3.3）：精英保底稀有祝福，Boss 保底史诗祝福；
    // 候选张数与封禁过滤统一走 rollChoicesFor（遗物「宽幅选择」会多加张数，开发方案 3.5）
    clearedRarity = node?.type === NODE.ELITE
      ? 'rare'
      : node?.type === NODE.BOSS
        ? (bossAt(node.depth)?.rewardRarity || 'epic')
        : null;

    // 只在**已解锁**的祝福里抽（局外养成决定池子）：没解锁过的不会出现在三选一里，
    // 所以「集齐祝福」是有实际收益的目标，而不只是图鉴里的一个数字
    const offered = rollChoicesFor(clearedRarity);
    if (offered.length === 0) {
      // 已解锁的祝福全部叠满：没有可选项就不再打断节奏，直接去下一层
      extraPicks = 0;
      gotoMapAfterNode();
      return;
    }
    renderPerkChoice(offered);
  }

  /** 祝福流程结束后的统一去向：标记当前节点完成、收起模态、进入下一层 */
  function gotoMapAfterNode() {
    closePerkModal();
    clearedRarity = null;
    // Boss 遗物宝箱（开发方案 3.5）：祝福选完先开箱，选完（或池空）才真正离开本节点
    if (pendingRelicChest) {
      pendingRelicChest = false;
      showRelicChest();
      return;
    }
    // 无尽深渊不经过地图：层数 +1 直接打下一层虚拟节点（31+ 无上限）
    if (endless) {
      floor += 1;
      mountFloor();
      return;
    }
    completeNode(map, nodeId);
    mountMap();
  }

  /** 选中某祝福后，下一层相对本层的数值变化（本层 → 下一层的实际值，含层数成长） */
  function perkDelta(perk) {
    const lv = levelOf(perk);
    const before = statsMap(bonus, floor, rewindsLeft);
    const preview = cloneBonus(bonus);
    // 预览不传 rng：「同色磁石」锁色是选中时才发生的副作用，预览只体现倍率变化
    perk.apply(preview, { lv });
    const after = statsMap(preview, floor + 1, rewindsLeft);
    const lines = [];
    for (const [key, row] of after) {
      const prev = before.get(key);
      if (!prev) lines.push(`${row.label} ${row.value}`);
      else if (prev.value !== row.value) lines.push(`${row.label} ${prev.value} → ${row.value}`);
    }
    return lines;
  }

  /** 三选一卡片（模态框内横排三张，窄屏由 CSS 折成竖排） */
  function perkCard(perk) {
    const owned = picks[perk.id] || 0;
    const lv = levelOf(perk);
    return el(
      'button',
      { class: 'm3-perk', onClick: () => choosePerk(perk) },
      el('span', { class: 'm3-perk-icon' }, perk.icon),
      el(
        'span',
        { class: 'm3-perk-namerow' },
        el('span', { class: 'm3-perk-name' }, perk.name),
        // 卡片上的等级来自局外养成：升级后同一张牌在本轮更强，这是解锁与升级的直接回报
        el('span', { class: 'm3-perk-lv' }, `Lv.${lv}`),
      ),
      el('span', { class: 'm3-perk-desc' }, descOf(perk, lv)),
      el(
        'span',
        { class: 'm3-perk-delta' },
        el(
          'span',
          {
            class: 'm3-perk-delta-title',
            title: `含层数成长：每 ${ROGUE.movesPerFloorStep} 层起手步数 +1`,
          },
          '下一层实际生效',
        ),
        ...perkDelta(perk).map((line) => el('span', { class: 'm3-perk-delta-item' }, line)),
      ),
      el(
        'span',
        { class: 'm3-perk-own' },
        owned > 0 ? `已持有 ×${owned}（上限 ${perk.max}）` : `上限 ${perk.max} 次`,
      ),
    );
  }

  /**
   * 层间三选一：以模态框盖在刚达标的那层盘面上（盘面已 lock，仍可见）
   *
   * 原来是整页替换 —— 界面被清空重排，玩家刚打完的盘面与左栏数据瞬间消失，
   * 选完又要重建一次。改成模态框后，背景保留当前局面，选完直接进下一层。
   */
  function renderPerkChoice(offered, isReroll = false) {
    closePerkModal(); // 防重入：连点 / 重复 resume 都只留一层
    // 遗物「重随代币」的重随额度按「每次三选一」重置；重随引起的重绘不重置（否则等于无限次）
    if (!isReroll) perkRerollFree = Math.max(0, relicHooks.mods.rerolls);
    const rerollLeft = perkRerollFree + perkRerollsLeft;

    const dialog = el(
      'div',
      { class: 'm3-perk-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': '选择祝福' },
      el(
        'div',
        { class: 'm3-perk-dialog-head' },
        el('h3', { class: 'm3-perk-dialog-title' }, `🎁 第 ${floor} 层达成 · 选一张祝福`),
        el(
          'p',
          { class: 'm3-perk-dialog-sub' },
          `累计 ${baseScore} 分 · 选中的祝福从第 ${floor + 1} 层开始生效`
          + (extraPicks > 0 ? ` · 🎁 先手规划：本层还能连选 ${extraPicks + 1} 张` : ''),
        ),
      ),
      el('div', { class: 'm3-perks' }, ...offered.map(perkCard)),
      el(
        'div',
        { class: 'm3-perk-dialog-foot' },
        el('span', { class: 'm3-perk-dialog-hint' }, '点卡片即选中，选完自动进入下一层'),
        el(
          'div',
          { class: 'm3-perk-dialog-btns' },
          // 重随：遗物「重随代币」每次白送，商店买的可累积（开发方案 3.5 / 3.6）
          rerollLeft > 0
            ? el('button', { class: 'm3-btn m3-btn--ghost', onClick: () => onRerollChoice() }, `🎲 重随（${rerollLeft}）`)
            : null,
          // 只出 3 张，看不到池子里还有什么；这里给一个不用退出对局就能查的入口
          el('button', { class: 'm3-btn m3-btn--ghost', onClick: () => showPerkCodex(picks) }, '📖 图鉴'),
          el('button', { class: 'm3-btn m3-btn--ghost', onClick: () => onExit() }, '返回选择'),
        ),
      ),
    );

    perkModal = el('div', { class: 'm3-perk-modal' }, dialog);
    container.append(perkModal);

    // 三选一也是一次暂存点：刷新后回到同样的三个候选（而不是重掷一手），
    // 且存档里带上刚达标的盘面，续玩时模态框背后摆的是同一局
    persistSession('perk', offered, true);
  }

  /** 三选一重随：优先消耗遗物白送的那次，再消耗商店买的（池子空则不动额度） */
  function onRerollChoice() {
    if (perkRerollFree + perkRerollsLeft <= 0) return;
    const again = rollChoicesFor(clearedRarity);
    if (again.length === 0) {
      toast.info('祝福池已抽空，无法重随');
      return;
    }
    if (perkRerollFree > 0) perkRerollFree -= 1;
    else perkRerollsLeft -= 1;
    renderPerkChoice(again, true);
  }

  function choosePerk(perk) {
    picks[perk.id] = (picks[perk.id] || 0) + 1;
    pickedPerks.push(perk);
    // ctx 里带两样东西：局外等级（决定这张牌这一轮有多强）与 runRng
    // （「同色磁石」要用它锁定一种颜色）。两者缺一都会静默降级成 lv1 / 不锁色
    perk.apply(bonus, { lv: levelOf(perk), rng: runRng });
    // 「先手规划」还欠一张：原地再抽一次，层数不动（这一层已经过关了，只是多拿一张牌）
    if (extraPicks > 0) {
      extraPicks -= 1;
      const again = rollChoicesFor(clearedRarity);
      if (again.length > 0) {
        renderPerkChoice(again);
        return;
      }
    }
    // 祝福全部选完：当前节点完成，回地图让玩家在下一排分叉里选路
    gotoMapAfterNode();
  }

  // ---- 通关：胜利结算页（开发方案 3.3）----
  /** 路线概览：已完成节点里精英 / Boss 的计数 + 本轮遗物件数 */
  function routeSummary() {
    if (!map) return '';
    let elite = 0;
    let boss = 0;
    for (const n of map.nodes) {
      if (n.state !== 'done') continue;
      if (n.type === NODE.ELITE) elite += 1;
      if (n.type === NODE.BOSS) boss += 1;
    }
    return `⚔️ 精英 ${elite} 个 · 👑 Boss ${boss}/3 · 💎 遗物 ${relics.length} 件`;
  }

  /**
   * 最终 Boss 倒下后的胜利结算页（不写墓碑 / 不上报：玩家可能选择继续深渊，
   * 真正结算统一在 finishRun 发生，保证一局只上报一次、通关奖励只发一次）
   */
  function winRun() {
    disposeBoard();
    terrain = null;
    goals = [];
    quest = null;
    boss = null;
    paintMeta = () => { };

    container.replaceChildren(
      el(
        'div',
        { class: 'm3-head m3-win-head' },
        el('h2', { class: 'm3-title' }, '🏆 通关！'),
        el('p', { class: 'm3-sub' }, `击败${ROGUE_BOSSES.core_titan.icon}${ROGUE_BOSSES.core_titan.name}，完成 30 层试炼`),
      ),
      el(
        'div',
        { class: 'm3-result m3-result--inline' },
        el('div', { class: 'm3-result-line' }, `⏱ 总用时 ${formatDuration(runElapsed())}`),
        el('div', { class: 'm3-result-line' }, `本轮总分 ${baseScore} · 最高连锁 ${maxCombo}`),
        el('div', { class: 'm3-result-line' }, routeSummary()),
        el('div', { class: 'm3-result-line' }, `Build：祝福 ${pickedPerks.length} 张`),
        renderPerkStrip(),
        el(
          'p',
          { class: 'm3-win-hint' },
          '通关精华在「结束本轮」时一次性结算；继续深渊只有少量衰减增量（服务端封顶）',
        ),
      ),
      el(
        'div',
        { class: 'm3-actions' },
        el('button', { class: 'm3-btn', onClick: () => finishRun() }, '✦ 领取奖励，结束本轮'),
        el('button', { class: 'm3-btn m3-btn--abyss', onClick: () => enterEndless() }, '🌀 继续深入无尽深渊'),
        el('button', { class: 'm3-btn m3-btn--ghost', onClick: () => onExit() }, '返回选择'),
      ),
    );
  }

  /** 从胜利页踏入无尽深渊：31 层起虚拟节点连战，无地图、无上限 */
  function enterEndless() {
    if (finished || !victory) return;
    endless = true;
    floor = MAP_DEPTH + 1;
    nodeId = null;
    terrain = null;
    goals = [];
    boss = null;
    toast.info('🌀 踏入无尽深渊：31 层起，难度无上限，随时可撤离结算');
    mountFloor();
  }

  // ---- 本轮结束 ----
  function finishRun() {
    if (finished) return;
    finished = true;
    // 到这里的路径：步数耗尽（board 还在，胜利与否看 victory）/ 胜利页点「领取结束」/
    // 深渊中战死或主动撤离（board 视情况而定）。通关标记在最终 Boss 倒下时已置位
    const info = board ? board.getState() : null;
    const won = victory;
    const score = baseScore + (info ? info.score : 0);
    const durationMs = runElapsed();
    if (info) {
      maxCombo = Math.max(maxCombo, info.maxCascade);
      totalMoves += info.moves;
      totalCleared += info.cleared;
      board.lock();
    }
    // 侧栏（含精华行 / 金币 / 遗物槽 / 本轮加成）马上要被结算页替换掉，先摘掉重画回调
    paintMeta = () => { };
    paintCoins = () => { };
    paintRelics = () => { };
    paintStatsRef = () => { };

    // 本轮结束：本地写墓碑占位，并把墓碑推上云端（详见 sync.js 的 finishedSession）。
    // 只删本地是不够的——离线结算时清除推不上去，下次进来会把打完的局又同步回来
    const tomb = finishedSession(ROGUE.type);
    saveLocalSession(ROGUE.type, tomb);
    pushSession(ROGUE.type, tomb, { force: true });

    reportEnd({
      mode: ROGUE.type,
      floor,
      score,
      maxCombo,
      moves: totalMoves,
      durationMs,
      cleared: totalCleared,
      stars: 0,
      // 胜利闭环（开发方案 3.3）：是否通关 + 三个 Boss 的击败数 + 是否进过深渊
      win: won,
      bossKills,
      endless,
      // 本轮选到的祝福次数与达成的局内任务数：服务端只记进养成存档的统计字段（不参与发放），
      // 但「记录全」能支撑以后基于它做的功能（如常用 build 统计）
      picks,
      questsDone,
    });

    const before = loadRogueBest();
    writeStore(STORAGE_KEYS.rogueBest, {
      maxFloor: Math.max(before.maxFloor, floor),
      highScore: Math.max(before.highScore, score),
    });
    if (floor > before.maxFloor) toast.success(`新的最深记录：第 ${floor} 层！`);
    else if (score > before.highScore) toast.success('新的最高总分！');

    // 本轮精华：先按同一公式就地算一个（离线也能看到收益），服务端回执到达后改成权威值。
    // 通关含固定 winBonus；深渊层基础部分封在 30 层 + 衰减增量（与服务端同公式）
    gainEl = el(
      'div',
      { class: 'm3-result-line m3-result-essence' },
      essenceLine(essenceForRun(floor, getRogueMeta(), { win: won })),
    );

    container.replaceChildren(
      el(
        'div',
        { class: 'm3-head' },
        el('h2', { class: 'm3-title' }, won ? '🏆 通关' : '💀 本轮结束'),
        el(
          'p',
          { class: 'm3-sub' },
          won
            ? (endless ? `从无尽深渊撤离，抵达第 ${floor} 层` : `击败最终 Boss，抵达第 ${floor} 层`)
            : (endless ? `倒在无尽深渊第 ${floor} 层（通关奖励仍可领取）` : `步数耗尽，止步第 ${floor} 层`),
        ),
      ),
      el(
        'div',
        { class: 'm3-result m3-result--inline' },
        el('div', { class: 'm3-result-title' }, `到达第 ${floor} 层${endless ? '（无尽深渊）' : ''}`),
        el('div', { class: 'm3-result-line' }, `本轮总分 ${score} · 最高连锁 ${maxCombo}`),
        el('div', { class: 'm3-result-line' }, `累计消除 ${totalCleared} 个 · 用时 ${formatDuration(durationMs)}`),
        won ? el('div', { class: 'm3-result-line' }, `👑 Boss 击败 ${bossKills}/3`) : null,
        el('div', { class: 'm3-result-line' }, `祝福 ${pickedPerks.length} 张 · 💎 遗物 ${relics.length} 件`),
        el('div', { class: 'm3-result-line' }, `🪙 局内金币 ${coins}（终局清零，不上报、不兑换精华）`),
        renderPerkStrip(),
        gainEl,
        el(
          'div',
          { class: 'm3-result-line' },
          `历史最佳 第 ${Math.max(before.maxFloor, floor)} 层 · ${Math.max(before.highScore, score)} 分`,
        ),
        renderStats(bonus, floor, won ? '终局加成（最终 Boss 层）' : '终局参数（未达标那一层的开局数值）'),
      ),
      el(
        'div',
        { class: 'm3-actions' },
        el('button', { class: 'm3-btn', onClick: () => startRun() }, '再来一轮'),
        // 结算是最想花精华的时点：直接给一个去解锁 / 升级的入口
        el('button', { class: 'm3-btn', onClick: () => showPerkCodex() }, '📖 图鉴与养成'),
        // 通关时盘面已随地图流程销毁，没有可展示的积分明细
        info
          ? el(
            'button',
            { class: 'm3-btn m3-btn--ghost', onClick: () => showScoreDetails(info) },
            '积分详情',
          )
          : null,
        el('button', { class: 'm3-btn m3-btn--ghost', onClick: () => onExit() }, '返回选择'),
      ),
    );
  }

  /** 结算页的精华行文案 */
  function essenceLine(gain) {
    return `✦ 本轮精华 +${gain}（按到达层数结算，可在图鉴里解锁 / 升级祝福与局外增益）`;
  }

  // 有未结算的一轮就直接接着打：刷新、换设备回来都落在同一个入口上
  // （云端那份由 mergeRemoteProgress 在收到服务端进度时并进本地，菜单上的续玩提示同源）
  const saved = loadLocalSession(ROGUE.type);
  if (saved) resumeRun(saved);
  else startRun();

  // 拉取服务端最佳成绩（合并后本地记录才是准的）；奖励配置到达后补显预计经验
  const offProgress = onProgress(() => refreshExp?.());
  // 精华余额与祝福等级：进模式拉一次进度、局内解锁一张、里程碑领取，都会触发重画
  const offMeta = onRogueMeta(() => paintMeta());
  // 本轮结算回执：精华按到达层数在服务端算，回来后把结算页那行换成权威值 + 最新余额
  const offResult = onResult((data) => {
    const rogue = data?.progress?.rogue;
    if (!gainEl || !rogue || typeof rogue.essenceGain !== 'number') return;
    gainEl.textContent = `✦ 本轮精华 +${rogue.essenceGain} · 当前余额 ${getRogueMeta().essence}`
      + '（可在图鉴里解锁 / 升级祝福与局外增益）';
  });
  requestProgress();

  return () => {
    offProgress();
    offMeta();
    offResult();
    teardown();
  };
}
