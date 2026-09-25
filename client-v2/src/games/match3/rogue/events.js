/**
 * 随机事件（问号房）数据 + 抽取 / 结算纯函数（开发方案 3.4，P2）
 *
 * 谁消费它：
 * - mode-rogue 的「事件卡」UI（EVENT 节点）：rollEvent 抽事件 → availableChoices 铺选项
 *   → 玩家点选后 applyChoice 执行，返回的结果文案直接进结果弹窗；
 * - tests/match3-events.test.js（标定脚本）：复用同一套抽取 / 过滤逻辑，
 *   保证「文档里的数值」与「跑起来的数值」不会漂。
 *
 * 为什么事件只扰动、不判死（文档 3.4 硬约束「坏结果不能直接判死」）：
 * 肉鸽事件是给 build 制造扰动的问号房，不是「随机删档」。消消乐里没有血量，
 * 代价只能落在三类资源上——步数 / 护盾 / 局内金币与遗物（3.6）。因此本文件设了硬闸：
 * - 单次事件最多扣 MAX_MOVE_LOSS(=4) 步，且 bonus.moves 不会被压到「下一层打不动」的下限以下；
 * - 护盾 / 金币的扣减各自夹在 ≥0，永远不会出现负数资源；
 * - 没有任何选项会清空 build、删档或重置整轮。
 * 于是最坏情况也仅是「下一层难打一点」，玩家手里永远还有下一步可走。
 *
 * 纯逻辑：不碰 DOM、不 import 遗物模块（遗物一律走 ctx.grantRelic 回调），
 * 随机一律走调用方注入的 ctx.rng（禁止使用内置随机源，保证可复现、可标定）。
 */

import { ROGUE } from '../config/config.js';

/**
 * 事件池在无尽深渊段（31+ 层）依然开放的上限深度（开发方案 3.4：事件按深度加权，不关池）
 * 各事件的 maxDepth 只用于「温和的浅层事件不退场」，不代表事件系统的深度上限。
 */
export const EVENT_DEPTH_MAX = 40;

/** 单次事件最多扣的步数（文档 3.4 硬约束：坏结果只能扰动，不能判死） */
const MAX_MOVE_LOSS = 4;

/**
 * bonus.moves 的下限
 * 每层基准步数是 ROGUE.movesPerFloor(=10)，扣到这一步，下一层仍有 6 步可打，
 * 绝不会出现「下一层零步无法进行」的死局。
 */
const MIN_BONUS_MOVES = 6 - ROGUE.movesPerFloor; // = −4

/**
 * 扣下一层起手步数（唯一入口：所有「步数代价」都必须走这里）
 * 双保险：单次最多 MAX_MOVE_LOSS 步，且 bonus.moves 不低于 MIN_BONUS_MOVES。
 * @param {object} ctx - 事件上下文
 * @param {number} n - 期望扣减的步数（正数；超过上限会被夹住）
 * @returns {number} 实际扣掉的步数
 */
function loseMoves(ctx, n) {
  const bonus = ctx.bonus || {};
  const want = Math.min(MAX_MOVE_LOSS, Math.max(0, Math.floor(n) || 0));
  const cur = Number(bonus.moves) || 0;
  const next = Math.max(MIN_BONUS_MOVES, cur - want);
  const paid = cur - next;
  if (paid > 0) ctx.addMoves(-paid);
  return paid;
}

/**
 * 扣护盾（夹在 ≥0，没有护盾时返回 0，由选项自己决定降级方案）
 * @returns {number} 实际扣掉的护盾数
 */
function loseShield(ctx, n = 1) {
  const bonus = ctx.bonus || {};
  const cur = Number(bonus.shields) || 0;
  const paid = Math.min(cur, Math.max(0, Math.floor(n) || 0));
  if (paid > 0) ctx.addShield(-paid);
  return paid;
}

/**
 * 「离开 / 无事发生」类选项的判定
 * 事件卡 UI 与 availableChoices 的兜底回退共用；按文案惯用词识别，
 * 因此所有事件都必须写一条文案以「离开」开头的选项。
 * @param {object} choice - 选项
 */
const LEAVE_RE = /离开|无事发生|走开|旁观|绕开/;
export function isLeaveChoice(choice) {
  return !!choice && typeof choice.text === 'string' && LEAVE_RE.test(choice.text);
}

/**
 * 事件表（本批 14 条，文档目标 20–30 条，后续按同构数据热更式追加）
 *
 * 字段：
 * - `id`       唯一标识
 * - `icon`     emoji 插画位（与文案分离，便于 UI 单独排版）
 * - `weight`   同深度候选内的加权抽取权重
 * - `minDepth` 出现的最小层数：浅层事件温和，赌博类重事件只在 11 层后才进池
 * - `maxDepth` 可选，出现的最深层数（用于让温和事件在深层退场）
 * - `text`     情境描写（20–40 字，肉鸽味）
 * - `choices`  2–3 个选项，恒含一条「离开」；每项 `{ text, when?(state), apply(ctx), resultText? }`
 *
 * 选项四类齐备：确定增益（付代价换祝福 / 遗物 / 金币）、赌博（走 ctx.rng.next()）、
 * 零和（牺牲一项换另一项）、离开。代价资源覆盖步数 / 护盾 / 金币 / 遗物。
 */
export const EVENTS = [
  // ---- 浅层：温和的补给与休整（minDepth 1–3）----
  {
    id: 'quiet_camp',
    icon: '⛺',
    weight: 12,
    minDepth: 1,
    maxDepth: 8,
    text: '一处背风的营地，火堆还温着，前主人走得匆忙。',
    choices: [
      {
        text: '烤会儿火（下一层起手 +2 步）',
        apply(ctx) { ctx.addMoves(2); return '浑身暖透，你的脚步轻快了些。'; },
      },
      {
        text: '翻出旧护具（+1 护盾）',
        apply(ctx) { ctx.addShield(1); return '护具虽旧，关键时刻能顶上一下。'; },
      },
      { text: '离开', apply: () => '你没动营地里的东西，悄悄走了。' },
    ],
  },
  {
    id: 'mossy_spring',
    icon: '💧',
    weight: 11,
    minDepth: 2,
    text: '石缝里涌出一眼苔泉，水色发绿，回声很深。',
    choices: [
      {
        text: '饮一口（下一层起手 +3 步）',
        apply(ctx) { ctx.addMoves(3); return '泉水清冽，你脚下生风。'; },
      },
      {
        text: '花 15 金币灌满水袋（+1 护盾）',
        when: (s) => s.coins >= 15,
        apply(ctx) { ctx.addCoins(-15); ctx.addShield(1); return '水袋沉甸甸的，你多了条后路。'; },
      },
      { text: '离开', apply: () => '你盯着水面看了会儿，转身离开。' },
    ],
  },
  {
    id: 'lost_caravan',
    icon: '🎒',
    weight: 10,
    minDepth: 2,
    text: '一支迷路的商队拦住去路，愿用货物换你的「脚力」。',
    choices: [
      {
        text: '用下一层 −3 步，换 1 件随机遗物',
        apply(ctx) {
          loseMoves(ctx, 3);
          const id = ctx.grantRelic('random');
          return id ? `商人塞给你一件遗物：${id}。` : '商队的箱子全空了，你白走一趟。';
        },
      },
      {
        text: '花 40 金币买一张随机祝福',
        when: (s) => s.coins >= 40,
        apply(ctx) {
          ctx.addCoins(-40);
          const perk = ctx.grantPerk({ rarity: 'common' });
          return perk ? '商人念了句好话，你身上亮起一层暖光。' : '商人收了钱，却摊手说没货了。';
        },
      },
      { text: '离开', apply: () => '你摆摆手，绕开商队继续赶路。' },
    ],
  },
  {
    id: 'starving_dog',
    icon: '🐕',
    weight: 11,
    minDepth: 3,
    text: '一只瘦狗守着一小堆亮晶晶的东西，喉咙里低吼。',
    choices: [
      {
        text: '丢给它 10 金币',
        when: (s) => s.coins >= 10,
        apply(ctx) {
          ctx.addCoins(-10);
          ctx.addShield(1);
          return '它叼起硬币，回头看你一眼，像是允诺了什么。';
        },
      },
      {
        text: '抢走宝物（+30 金币，下一层 −3 步）',
        apply(ctx) {
          ctx.addCoins(30);
          loseMoves(ctx, 3);
          return '你抢到了宝物，小腿却被咬了一口。';
        },
      },
      { text: '离开', apply: () => '你慢慢后退，让狗守住它的破烂宝贝。' },
    ],
  },

  // ---- 中层：赌博与零和开始出现（minDepth 4–8）----
  {
    id: 'gambler_den',
    icon: '🎲',
    weight: 9,
    minDepth: 4,
    text: '半塌的赌坊里还有人掷骰，赌注是「下几步的路」。',
    choices: [
      {
        text: '押 20 金币赌一把',
        when: (s) => s.coins >= 20,
        apply(ctx) {
          ctx.addCoins(-20);
          if (ctx.rng.next() < 0.5) {
            ctx.addCoins(45);
            return '骰子翻红，你赢回 45 枚金币。';
          }
          loseMoves(ctx, 2);
          return '骰子翻白，桌上记下你两步的账。';
        },
      },
      {
        text: '押 1 次护盾换 25 金币（没有护盾则改为 −2 步）',
        apply(ctx) {
          if (loseShield(ctx, 1) > 0) {
            ctx.addCoins(25);
            return '庄家收走你的护符，数了 25 枚金币给你。';
          }
          loseMoves(ctx, 2);
          ctx.addCoins(25);
          return '你没有护符可押，只好用两步换这 25 枚金币。';
        },
      },
      { text: '离开', apply: () => '你不喜欢骰子落桌的声音，转身出了门。' },
    ],
  },
  {
    id: 'echoing_chest',
    icon: '🧰',
    weight: 9,
    minDepth: 5,
    maxDepth: 20,
    text: '一只上了年纪的箱子，锁孔里传出细微的呼吸声。',
    choices: [
      {
        text: '打开它（随机：遗物 或 金币）',
        apply(ctx) {
          if (ctx.rng.next() < 0.6) {
            const id = ctx.grantRelic('random');
            return id ? `箱底躺着一件遗物：${id}。` : '箱子是空的，只剩回声。';
          }
          ctx.addCoins(15);
          return '箱里没有宝贝，只翻出 15 枚旧金币。';
        },
      },
      {
        text: '砸开它（+25 金币，下一层 −2 步）',
        apply(ctx) {
          ctx.addCoins(25);
          loseMoves(ctx, 2);
          return '你砸碎了箱子，也惊动了地底的东西。';
        },
      },
      { text: '离开', apply: () => '你没碰箱子——那呼吸声太有节奏了。' },
    ],
  },
  {
    id: 'shattered_shrine',
    icon: '🏛',
    weight: 8,
    minDepth: 6,
    text: '一座破碎的神龛，供台上还摆着半枚护符。',
    choices: [
      {
        text: '献上 1 次护盾求稀有祝福（无护盾则 −2 步）',
        apply(ctx) {
          if (loseShield(ctx, 1) === 0) loseMoves(ctx, 2);
          ctx.grantPerk({ minRarity: 'rare' });
          return '护符碎裂、神龛低震，它勉强应了你的请求。';
        },
      },
      {
        text: '刮走香灰（+12 金币）',
        apply(ctx) { ctx.addCoins(12); return '香灰里混着碎银，你收进兜里。'; },
      },
      { text: '离开', apply: () => '你对神龛行了一礼，退到门外。' },
    ],
  },
  {
    id: 'bone_dice',
    icon: '🦴',
    weight: 8,
    minDepth: 7,
    text: '地上散着几枚骨骰，风一吹就自己滚了两圈。',
    choices: [
      {
        text: '掷出骨骰（赢 +4 步，输 −2 步）',
        apply(ctx) {
          if (ctx.rng.next() < 0.55) {
            ctx.addMoves(4);
            return '骨骰停在「进」字上，你多了 4 步。';
          }
          loseMoves(ctx, 2);
          return '骨骰停在「退」字上，你丢了两步。';
        },
      },
      { text: '离开', apply: () => '你抬脚跨过骨骰，没有去捡。' },
    ],
  },
  {
    id: 'merchant_of_debts',
    icon: '💰',
    weight: 7,
    minDepth: 8,
    text: '一位只收现钱的商人，货架上锁着几个会动的盒子。',
    choices: [
      {
        text: '花 70 金币，买一件稀有遗物',
        when: (s) => s.coins >= 70,
        apply(ctx) {
          ctx.addCoins(-70);
          const id = ctx.grantRelic({ rarity: 'rare' });
          return id ? `盒子打开，一件稀罕物：${id}。` : '商人收了钱，盒子却是空的。';
        },
      },
      {
        text: '花 30 金币，买一件随机遗物',
        when: (s) => s.coins >= 30,
        apply(ctx) {
          ctx.addCoins(-30);
          const id = ctx.grantRelic('random');
          return id ? `你挑了个盒子，得到：${id}。` : '盒子里只有一张欠条。';
        },
      },
      { text: '离开', apply: () => '你摸了摸空钱袋，走开了。' },
    ],
  },

  // ---- 深层：高风险赌博与遗物零和（minDepth 9+）----
  {
    id: 'mirror_pool',
    icon: '🪞',
    weight: 6,
    minDepth: 9,
    text: '一洼静水映出你的脸，可它比你先眨了眼。',
    choices: [
      {
        text: '俯身照一照（随机：+1 护盾 或 −3 步）',
        apply(ctx) {
          if (ctx.rng.next() < 0.5) {
            ctx.addShield(1);
            return '水里的你先笑了，你莫名多了份底气。';
          }
          loseMoves(ctx, 3);
          return '水里的你转身离去，你觉得自己慢了下来。';
        },
      },
      { text: '离开', apply: () => '你避开那洼水，快步走开。' },
    ],
  },
  {
    id: 'carrion_pit',
    icon: '🕳',
    weight: 7,
    minDepth: 10,
    text: '坑底堆着旅人的旧行囊，气味比深渊还重。',
    choices: [
      {
        text: '趟过坑底（+35 金币，下一层 −4 步）',
        apply(ctx) {
          ctx.addCoins(35);
          loseMoves(ctx, 4);
          return '你捞起钱袋，鞋底却被什么东西拽了一下。';
        },
      },
      {
        text: '花 12 金币请向导绕路',
        when: (s) => s.coins >= 12,
        apply(ctx) {
          ctx.addCoins(-12);
          ctx.addMoves(2);
          return '向导带你绕过腐臭，还替你省下些力气。';
        },
      },
      { text: '离开', apply: () => '你捂住口鼻，从坑边远远绕开。' },
    ],
  },
  {
    id: 'cursed_altar',
    icon: '🗿',
    weight: 8,
    minDepth: 11,
    text: '一座滴着黑油的祭坛，碑上刻着「以退换进」。',
    choices: [
      {
        text: '献祭（有护盾则 −1，否则下一层 −4 步），七成得稀有祝福',
        apply(ctx) {
          if (loseShield(ctx, 1) === 0) loseMoves(ctx, 4);
          if (ctx.rng.next() < 0.7) {
            const perk = ctx.grantPerk({ rarity: 'rare' });
            return perk ? '祭坛低语，你掌心里多了一张稀有的牌。' : '祭坛低语，却什么也没给你。';
          }
          ctx.addCoins(-15);
          return '祭坛吐出一口浊气，你的钱袋轻了 15 枚。';
        },
      },
      {
        text: '砸了祭坛，取走供品（+25 金币）',
        apply(ctx) { ctx.addCoins(25); return '你砸碎石碑，抓走供台上的 25 枚金币。'; },
      },
      { text: '离开', apply: () => '你没敢碰那层黑油，退了回去。' },
    ],
  },
  {
    id: 'cracked_idol',
    icon: '🧿',
    weight: 6,
    minDepth: 12,
    text: '一尊裂开的神像，胸口嵌着一枚还在转的齿轮。',
    choices: [
      {
        text: '交出一件遗物，换一张稀有祝福',
        when: (s) => (s.relics || []).length > 0,
        apply(ctx) {
          const ids = ctx.getRelics();
          const id = ids && ids.length ? ids[ids.length - 1] : null;
          // 遗物的真正移除由遗物模块（P3）负责；冻结的 ctx 未声明 removeRelic，
          // 故用 typeof 兜底降级为等价金币代价，保证任何调用方下都不崩、代价仍成立
          if (id && typeof ctx.removeRelic === 'function') ctx.removeRelic(id);
          else ctx.addCoins(-20);
          ctx.grantPerk({ minRarity: 'rare' });
          return '齿轮咬合转了一圈，你的行囊轻了，牌面却亮了。';
        },
      },
      {
        text: '花 20 金币供奉（+1 护盾）',
        when: (s) => s.coins >= 20,
        apply(ctx) {
          ctx.addCoins(-20);
          ctx.addShield(1);
          return '神像眼中闪过一线光，你身上多了层护佑。';
        },
      },
      { text: '离开', apply: () => '你盯着那枚齿轮看了很久，最终没有伸手。' },
    ],
  },
  {
    id: 'whispering_obelisk',
    icon: '🪨',
    weight: 6,
    minDepth: 13,
    text: '方尖碑上浮动着别人的名字，念出来会怎样？',
    choices: [
      {
        text: '轻声念出其中一个名字',
        apply(ctx) {
          if (ctx.rng.next() < 0.45) {
            const perk = ctx.grantPerk({ rarity: 'epic' });
            return perk ? '碑面亮起一瞬，你握住了某种更沉的东西。' : '碑面光滑如初，什么也没发生。';
          }
          loseMoves(ctx, 4);
          ctx.addCoins(-10);
          return '名字的主人回头看了你一眼，你掉了 4 步与 10 枚金币。';
        },
      },
      {
        text: '花 25 金币拓下碑文（下一层 +2 步）',
        when: (s) => s.coins >= 25,
        apply(ctx) {
          ctx.addCoins(-25);
          ctx.addMoves(2);
          return '碑文拓在纸上，读起来竟像一份路书。';
        },
      },
      { text: '离开', apply: () => '你假装没看见那些名字，加快脚步。' },
    ],
  },
];

/**
 * 按深度过滤后加权抽 1 个事件
 *
 * 过滤规则：`minDepth <= depth`，且存在 `maxDepth` 时 `depth <= maxDepth`。
 * 加权：同候选内按 `weight` 抽（相对权重），随机只走传入的 rng，保证同 seed 可复现。
 * @param {object} rng - rng.js 发生器（必须有 next()）
 * @param {{depth:number, coins:number, relics:string[], picks:object}} state - run 快照
 * @returns {object|null} 抽中的事件；无可用事件时返回 null（不抛错）
 */
export function rollEvent(rng, state = {}) {
  const depth = Number(state.depth) || 0;
  const pool = EVENTS.filter(
    (e) => e.minDepth <= depth && (e.maxDepth == null || depth <= e.maxDepth),
  );
  if (pool.length === 0) return null;

  const weightOf = (e) => Math.max(0, Number(e.weight) || 0);
  const total = pool.reduce((sum, e) => sum + weightOf(e), 0);
  // 权重全为 0 的极端情况：退化成等概率首项，而不是除零 / 空转
  if (total <= 0) return pool[0];

  let roll = rng.next() * total;
  for (const e of pool) {
    roll -= weightOf(e);
    if (roll < 0) return e;
  }
  return pool[pool.length - 1]; // 浮点误差兜底
}

/**
 * 事件在当前 run 状态下「可用」的选项
 *
 * `when` 为空视为可用；`when(state)` 抛错时按不可用处理，且绝不让整体崩掉
 * （事件数据是热更内容，一条写坏的 when 不该拖垮整张事件卡）。
 * 保证至少返回 1 项：全部被过滤时回退到「离开」项；事件本身没有 leave 项时回退到第一项。
 * @param {object} event - EVENTS 里的条目
 * @param {object} state - run 快照（when 的入参）
 * @returns {Array} 可用选项（原始引用，UI 直接铺卡片）
 */
export function availableChoices(event, state = {}) {
  const choices = (event && event.choices) || [];
  if (choices.length === 0) return [];
  const ok = choices.filter((c) => {
    if (typeof c.when !== 'function') return true;
    try {
      return !!c.when(state);
    } catch {
      return false;
    }
  });
  if (ok.length > 0) return ok;
  const leave = choices.find(isLeaveChoice);
  return [leave || choices[0]];
}

/**
 * 执行某个选项，返回结果文案
 *
 * `apply(ctx)` 可以返回字符串作为结果文案；不返回（或返回空串）时用选项自带的
 * `resultText` 兜底。index 非法 / 选项没有 apply 时返回 `{ ok:false, text:'' }`，不抛错。
 * @param {object} event - EVENTS 里的条目
 * @param {number} index - 选项下标
 * @param {object} ctx - 事件上下文（见文件头 ctx 接口说明，由调用方实现）
 * @returns {{ok:boolean, text:string}}
 */
export function applyChoice(event, index, ctx) {
  const choices = (event && event.choices) || [];
  const choice = Number.isInteger(index) ? choices[index] : undefined;
  if (!choice || typeof choice.apply !== 'function') return { ok: false, text: '' };
  const out = choice.apply(ctx);
  const text = typeof out === 'string' && out.length > 0 ? out : (choice.resultText || '');
  return { ok: true, text };
}
