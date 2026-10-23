/**
 * 祝福图鉴 = 局外养成面板（肉鸽试炼，开发方案 5.7）
 *
 * 它同时承担两件事：
 * 1. **看**：三选一每次只出 3 张，玩家看不到池子里还有什么；这里把 perks.js 的
 *    PERKS / META_BUFFS / QUEST_REWARDS 与 relics.js 的 RELICS 原样铺开
 *    （数据源就是同一份常量，加一条不用改本文件）
 * 2. **花**：打 run 攒的「精华 ✦」在这里花掉——解锁新祝福（进三选一池）、
 *    升级已有祝福（提升单张效果）、解锁升级局外增益（跨轮常驻）、领取收集里程碑
 *
 * 分两层：**局外增益**跨轮常驻、不进三选一；**祝福 / 遗物**是局内的，一轮结束清空。
 * 遗物只做「看」（不靠精华购买，也不进三选一池），见下方 relicSections。
 *
 * 数值推导全在 meta.js（等级上限、费用、里程碑判定、余额），本文件只管渲染与发起请求。
 * 所有改动都要经服务端：`upgradeRoguePerk` / `claimRogueMilestone` / `claimAllRogueMilestones` 只发 id 出去，
 * 扣费与校验都在服务端做，回执带回最新存档 → sync.js 广播 → 这里重画。
 *
 * 外框分两种：局内（对局中查池子）用 components/modal 的模态框；局外（娱乐菜单 / 结算页 /
 * 站点路由 #/codex）用整页——同一份内容，codexPanel 只产出内容节点与生命周期，外壳各自套。
 */
import { ROGUE } from '../config/config.js';
import { META_BUFFS, PERKS, QUEST_REWARDS, descOf, valueAt } from './perks.js';
import { relicsByRarity } from './relics.js';
import { CHARACTERS, characterMastery, unlockProgress } from './characters.js';
import {
  buffFactor, claimableCount, collectionSummary, itemLevel, maxLevelOf, milestoneReward, milestoneState,
  nextStep, rarityOf, requiresMet, rogueCfg,
} from './meta.js';
import {
  claimAllRogueMilestones, claimRogueMilestone, getRogueMeta, onRogueMeta, upgradeRoguePerk,
} from '../save/sync.js';
import { el } from '../../../utils/dom.js';
import { modal } from '../../../components/modal.js';
import { toast } from '../../../components/toast.js';

/**
 * 某条养成项「现在生效的效果」一句话摘要
 * - mult 曲线（经验 / 精华共鸣）：是倍率
 * - add 曲线（起始补给 / 常驻护盾等）：是加量
 * - 机制节点没有曲线，改的是规则，摘要交给 desc
 */
function effectText(entry, lv) {
  if (entry.kind === 'mechanic') return '改规则 · 一次性解锁';
  const v = valueAt(entry, Math.max(1, lv));
  return entry.scales?.kind === 'mult' ? `当前倍率 ×${v}` : `当前加成 +${v}`;
}

/** 前置节点名字（用于「需先解锁 XX」的提示） */
function prevName(entry) {
  const prev = META_BUFFS.find((b) => b.id === (entry.requires || [])[0]);
  return prev ? prev.name : '前置优势';
}

/**
 * 一条只读图鉴卡（遗物 / 任务共用）：固定规格的方卡，标题常驻、描述区可滚动
 * @param {object} entry - 任务奖励 / 遗物（icon、name、desc 必填）
 * @param {string|null} limit - 右上角小标签（遗物流派 / 上限说明）
 */
function item(entry, limit) {
  return el(
    'div',
    { class: 'm3-codex-tile' },
    el(
      'div',
      { class: 'm3-codex-tile-head' },
      el('span', { class: 'm3-codex-icon' }, entry.icon),
      el('span', { class: 'm3-codex-tile-name' }, entry.name),
      limit ? el('span', { class: 'm3-codex-limit' }, limit) : null,
    ),
    el(
      'div',
      { class: 'm3-codex-tile-body' },
      el('div', { class: 'm3-codex-desc' }, entry.desc),
    ),
  );
}

/** 一小节：标题 + 说明 + 条目列表（listClass 可把列表切成两列网格，用于遗物 / 任务图鉴） */
function section(title, hint, items, listClass = '') {
  return el(
    'div',
    { class: 'm3-codex-sec' },
    el('div', { class: 'm3-codex-sec-title' }, title),
    hint ? el('p', { class: 'm3-codex-sub' }, hint) : null,
    el('div', { class: `m3-codex-list${listClass}` }, ...items),
  );
}

/**
 * 分页标题：统一「标题 + 一句说明 + 右侧主操作」的层级
 * 六个分页都用它开头，切换时视线落点一致；主操作（如一键领取）固定在右上角，不用往下找。
 */
function paneHead(title, hint, action = null) {
  return el(
    'div',
    { class: 'm3-codex-pane-head' },
    el(
      'div',
      { class: 'm3-codex-pane-text' },
      el('h3', { class: 'm3-codex-pane-title' }, title),
      hint ? el('p', { class: 'm3-codex-pane-hint' }, hint) : null,
    ),
    action ? el('div', { class: 'm3-codex-pane-action' }, action) : null,
  );
}

/**
 * 图鉴面板的**内容 + 生命周期**（不含外壳）
 *
 * 局内（对局中查池子）与局外（娱乐菜单 / 结算页 / 站点路由）共用这一份内容，
 * 外壳分别见 showPerkCodex（模态框）与 renderCodexPage（整页）。
 *
 * 面板里发起的解锁 / 升级 / 领奖都由服务端处理，回执回来后 `onRogueMeta` 触发重画，
 * 所以这里的按钮**只负责发起**，不自己改本地数据。
 *
 * @param {Record<string, number>} [picks] - 本轮已选祝福 { 祝福id: 次数 }；不在对局中则不传
 * @returns {{ host: HTMLElement, stop: Function }} host 为面板根节点；stop 退订
 *          （外壳移除后必须调用，否则下次服务端下发会写进已移除的节点）
 */
export function codexPanel(picks = null) {
  const host = el('div', { class: 'm3-codex' });
  let closed = false;
  let off = null;
  /**
   * 当前分页：内容太多（共鸣树 / 27 条里程碑 / 15 张祝福 / 20 件遗物 / 任务奖励），
   * 全铺在一个滚动流里要翻很久，按「养成 / 领奖 / 图鉴」拆成六页。
   * 对局中打开（带 picks）多半是想查三选一池，默认落在祝福页。
   */
  let tab = picks ? 'perks' : 'tree';
  /** 祝福列表筛选：全部 / 可购买 / 已解锁 / 未解锁（只影响展示，不影响抽取） */
  let perkFilter = 'all';

  const TABS = [
    { id: 'tree', icon: '🌳', label: '养成' },
    { id: 'ms', icon: '🏅', label: '里程' },
    { id: 'perks', icon: '✨', label: '祝福' },
    { id: 'relics', icon: '🎁', label: '遗物' },
    { id: 'chars', icon: '🧩', label: '角色' },
    { id: 'quest', icon: '📜', label: '任务' },
  ];

  /** 里程碑分组（按 kind 归类，定义顺序即组内顺序；组配置只影响展示，服务端不看） */
  const MS_GROUPS = [
    { title: '🎴 祝福收集', kinds: ['unlocked', 'maxed', 'all'] },
    { title: '🌳 共鸣树', kinds: ['buffs'] },
    { title: '🧩 角色与熟练度', kinds: ['chars', 'mastery'] },
    { title: '🌀 进阶挑战', kinds: ['ascension'] },
    { title: '🏔 历练挑战', kinds: ['runs', 'floor', 'quests', 'wins', 'boss', 'picks'] },
  ];

  /** 祝福筛选按钮 */
  const PERK_FILTERS = [
    { id: 'all', label: '全部' },
    { id: 'buyable', label: '可购买' },
    { id: 'owned', label: '已解锁' },
    { id: 'locked', label: '未解锁' },
  ];

  /** 角色熟练度称号（纯荣誉展示，不接强度；与 characters.js 的 MASTERY_TIERS 档位对齐） */
  const MASTERY_TITLE = ['见习', '新秀', '老手', '大师'];

  /** 三条流派的列头文案（只影响展示；节点归属以 perks.js 的 tree.col 为准） */
  const TREE_PATHS = [
    { name: '经济', hint: '放大每轮结算' },
    { name: '开局', hint: '起手更顺' },
    { name: '保命', hint: '兜住翻车' },
  ];

  /** 关掉面板时退订：否则下次服务端下发还会往已移除的节点上写 */
  function stop() {
    closed = true;
    if (off) off();
    off = null;
  }

  /** 解锁 / 升级：客户端只发 id，花费与上限由服务端判定（这里先做一次友好提示） */
  function buy(entry) {
    const meta = getRogueMeta();
    const step = nextStep(meta, entry);
    if (!step) return;
    if (meta.essence < step.cost) {
      toast.info(`精华不足，还差 ${step.cost - meta.essence} ✦`);
      return;
    }
    if (!upgradeRoguePerk(entry.id)) toast.info('未连接服务器，稍后再试');
  }

  /** 领取里程碑奖励 */
  function claim(ms) {
    if (!ms.done || ms.claimed) return;
    if (!claimRogueMilestone(ms.id)) toast.info('未连接服务器，稍后再试');
  }

  /**
   * 一张养成卡的详情区：当前效果 + 下一级 + 等级条 + 备注
   * 完整大卡（共鸣树选中节点）与祝福紧凑行的展开区共用这一段，保证两处口径一致
   */
  function perkDetailParts(entry, meta, lv, max, step, isBuff, isMechanic) {
    return [
      // 当前效果：未解锁时按 lv1 展示（即「解锁后是什么样」）
      el(
        'div',
        { class: 'm3-codex-desc' },
        lv > 0 ? descOf(entry, lv) : `解锁后：${descOf(entry, 1)}`,
      ),
      step && step.kind === 'upgrade'
        ? el(
          'div',
          { class: 'm3-codex-next' },
          `下一级 Lv.${step.nextLv}：${descOf(entry, step.nextLv)}`,
        )
        : null,
      // 机制节点只有一层，等级条没有意义，省掉
      isMechanic
        ? null
        : el(
          'span',
          { class: 'm3-codex-bar' },
          el('span', {
            class: 'm3-codex-bar-fill',
            style: `width:${Math.round((lv / max) * 100)}%`,
          }),
        ),
      el(
        'div',
        { class: 'm3-codex-meta' },
        isBuff
          // 共鸣树节点：跨轮常驻、不进三选一池，所以没有「本轮上限」与被选次数的统计
          ? `跨轮常驻 · 不在三选一池里 · ${effectText(entry, lv)}`
          : `本轮上限 ${entry.max} 张 · 单次效果 ${valueAt(entry, Math.max(1, lv))}`
          + (meta.perks?.[entry.id]?.picks ? ` · 累计选过 ${meta.perks[entry.id].picks} 次` : ''),
      ),
    ];
  }

  /** 购买按钮或「已满级 / 需前置」状态标签（完整卡与紧凑行共用） */
  function buyControl(entry, meta, step, ready, isMechanic) {
    return !step
      ? el('span', { class: 'm3-codex-buy m3-codex-buy--max' }, isMechanic ? '已解锁' : '已满级')
      : !ready
        ? el(
          'span',
          { class: 'm3-codex-buy m3-codex-buy--max', title: `需先解锁 ${prevName(entry)}` },
          '前置未解锁',
        )
        : el(
          'button',
          {
            class: 'm3-codex-buy',
            type: 'button',
            disabled: meta.essence < step.cost,
            onClick: () => buy(entry),
          },
          `${step.kind === 'unlock' ? '解锁' : `升到 Lv.${step.nextLv}`} ✦${step.cost}`,
        );
  }

  /**
   * 祝福卡：固定规格的方卡，标题行常驻、效果区可滚动、操作固定在底部
   * 15 张全部直接铺开，不折叠——与养成页的节点保持同一套阅读顺序
   */
  function perkTile(entry, meta) {
    const lv = itemLevel(meta, entry);
    const max = maxLevelOf(entry);
    const step = nextStep(meta, entry);
    const isBuff = entry.scope === 'buff';
    const isMechanic = entry.kind === 'mechanic';
    const ready = requiresMet(meta, entry);

    const cls = [
      'm3-codex-tile', 'm3-codex-tile--perk',
      `m3-codex-item--${entry.rarity}`,
      lv <= 0 ? 'm3-codex-item--locked' : null,
    ].filter(Boolean).join(' ');

    return el(
      'div',
      { class: cls },
      el(
        'div',
        { class: 'm3-codex-tile-head' },
        el('span', { class: 'm3-codex-icon' }, lv > 0 || ready ? entry.icon : '🔒'),
        el('span', { class: 'm3-codex-tile-name' }, entry.name),
        el('span', { class: `m3-codex-fam m3-codex-fam--${entry.rarity}` }, rarityOf(entry).label || entry.rarity),
        isMechanic
          ? el('span', { class: 'm3-codex-lv' }, lv > 0 ? '已点亮' : '未点亮')
          : el('span', { class: 'm3-codex-lv' }, `Lv.${lv}/${max}`),
        picks && picks[entry.id] > 0
          ? el('span', { class: 'm3-codex-owned' }, `本轮 ×${picks[entry.id]}`)
          : null,
      ),
      el(
        'div',
        { class: 'm3-codex-tile-body' },
        ...perkDetailParts(entry, meta, lv, max, step, isBuff, isMechanic),
      ),
      el('div', { class: 'm3-codex-tile-foot' }, buyControl(entry, meta, step, ready, isMechanic)),
    );
  }

  /**
   * 流派里的一级：名称 + 等级常驻一行，下面直接展示效果、进度与购买按钮。
   * 不折叠、不点开；三列统一高度，超出部分在列内滚动。
   * 三种状态各有一套观感：已点亮 / 可解锁 / 前置未满足（压暗 + 锁）
   */
  function treeStep(entry, meta) {
    const lv = itemLevel(meta, entry);
    const max = maxLevelOf(entry);
    const step = nextStep(meta, entry);
    const isMechanic = entry.kind === 'mechanic';
    const ready = requiresMet(meta, entry);
    const cls = ['m3-tree-step'];
    if (lv > 0) cls.push('m3-tree-step--on');
    else if (!ready) cls.push('m3-tree-step--blocked');

    return el(
      'div',
      { class: cls.join(' ') },
      el(
        'div',
        { class: 'm3-tree-step-head' },
        el('span', { class: 'm3-tree-mark', 'aria-hidden': 'true' }, ready ? entry.icon : '🔒'),
        el(
          'span',
          { class: 'm3-tree-step-main' },
          el('span', { class: 'm3-tree-step-name' }, entry.name),
          el(
            'span',
            { class: 'm3-tree-step-lv' },
            isMechanic ? (lv > 0 ? '已点亮' : '机制') : `Lv.${lv}/${max}`,
          ),
        ),
      ),
      el(
        'div',
        { class: 'm3-tree-step-body' },
        ...perkDetailParts(entry, meta, lv, max, step, true, isMechanic),
        el('div', { class: 'm3-tree-step-action' }, buyControl(entry, meta, step, ready, isMechanic)),
      ),
    );
  }

  /** 一条里程碑：名称 + 奖励 + 进度条 + 右侧领取按钮（单行两行高，27 条扫起来不累） */
  function milestoneRow(ms, meta) {
    // 「丰收闭环」会把奖励翻倍，这里显示的必须是真正会到账的数（服务端同口径）
    const reward = milestoneReward(ms, meta);
    const have = Math.min(ms.have, ms.need);
    const pct = ms.need > 0 ? Math.round((have / ms.need) * 100) : 100;
    return el(
      'div',
      { class: `m3-codex-item m3-codex-ms${ms.claimed ? ' m3-codex-ms--claimed' : ''}${ms.done && !ms.claimed ? ' m3-codex-ms--ready' : ''}` },
      el('span', { class: 'm3-codex-icon' }, ms.claimed ? '✅' : (ms.done ? '🏅' : '🎯')),
      el(
        'div',
        { class: 'm3-codex-main' },
        el(
          'div',
          { class: 'm3-codex-head' },
          el('span', { class: 'm3-codex-name' }, ms.name),
          el('span', { class: 'm3-codex-reward' }, `✦${reward}`),
        ),
        el(
          'span',
          { class: 'm3-codex-bar m3-codex-bar--ms' },
          el('span', { class: 'm3-codex-bar-fill', style: `width:${pct}%` }),
        ),
      ),
      ms.done && !ms.claimed
        ? el('button', { class: 'm3-codex-buy m3-codex-buy--ready', type: 'button', onClick: () => claim(ms) }, '领取')
        : el('span', { class: 'm3-codex-buy m3-codex-buy--max' }, ms.claimed ? '已领取' : `${have}/${ms.need}`),
    );
  }

  /**
   * 三条流派各占一列卡片，节点按 1→2→3 纵向排列（连线由 CSS 画）
   *
   * 每一级都把效果、进度与购买按钮直接铺开，不折叠、不点开——
   * 版面与其余分页一致，宽屏也不会出现「左边一大片、右边一小块」的失衡。
   * 加节点只改 perks.js 的 `tree` 坐标，列数按数据里的最大 col 现算。
   */
  function treeSection(meta) {
    const cols = Math.max(...META_BUFFS.map((b) => b.tree.col)) + 1;
    const branches = Array.from({ length: cols }, (_, col) => ({
      path: TREE_PATHS[col] || { name: `流派 ${col + 1}`, hint: '' },
      nodes: META_BUFFS
        .filter((b) => b.tree.col === col)
        .sort((a, b) => a.tree.row - b.tree.row),
    }));

    return el(
      'div',
      { class: 'm3-tree-paths' },
      ...branches.map(({ path, nodes }) => {
        const lit = nodes.filter((n) => itemLevel(meta, n) > 0).length;
        return el(
          'div',
          { class: 'm3-tree-branch' },
          el(
            'div',
            { class: 'm3-tree-branch-head' },
            el('span', { class: 'm3-tree-branch-name' }, path.name),
            el('span', { class: 'm3-tree-branch-hint' }, path.hint),
            el('span', { class: 'm3-tree-branch-lit' }, `${lit}/${nodes.length}`),
          ),
          el(
            'div',
            { class: 'm3-tree-branch-list' },
            ...nodes.map((entry) => treeStep(entry, meta)),
          ),
        );
      }),
    );
  }

  /** 一条收集度指标：名称 / 进度 / 一行小字 + 进度条（顶部总览四宫格共用） */
  function metric(label, have, total, note) {
    const pct = total > 0 ? Math.round((have / total) * 100) : 100;
    return el(
      'div',
      { class: 'm3-codex-metric' },
      el(
        'div',
        { class: 'm3-codex-metric-head' },
        el('span', { class: 'm3-codex-metric-label' }, label),
        el('span', { class: 'm3-codex-metric-value' }, `${have}/${total}`),
      ),
      el(
        'span',
        { class: 'm3-codex-bar' },
        el('span', { class: 'm3-codex-bar-fill', style: `width:${pct}%` }),
      ),
      note ? el('span', { class: 'm3-codex-metric-note' }, note) : null,
    );
  }

  /** 顶部：精华余额 + 收集总览 + 关键统计（每个分页都常驻，花钱时随时看得到余额） */
  function summary(meta) {
    const cfg = rogueCfg();
    const view = collectionSummary(meta);
    const stats = meta.stats || {};
    const pct = Math.round(view.ratio * 100);
    // 底薪 + 平方曲线的纯基础值（不含共鸣 / 丰收），用来解释「打几层大概拿多少」
    const baseOf = (floor) => Math.floor((floor * floor) / cfg.essenceDivisor)
      + floor * (cfg.depthEssencePerFloor || 0);
    return el(
      'div',
      { class: 'm3-codex-top' },
      el(
        'div',
        { class: 'm3-codex-toprow' },
        el('span', { class: 'm3-codex-essence' }, '✦ ', el('b', {}, String(meta.essence))),
        el('span', { class: 'm3-codex-toplabel' }, '精华余额'),
        el('span', { class: 'm3-codex-topitem' }, `累计获得 ✦${meta.essenceEarned}`),
        el('span', { class: 'm3-codex-topitem' }, `出战 ${stats.runs || 0} 轮`),
        el('span', { class: 'm3-codex-topitem' }, `最深 ${stats.bestFloor || 0} 层`),
        // 结算倍率的当前值：把「买了到底多拿多少」直接摆在最上面
        ...META_BUFFS.filter((buff) => buff.scales?.kind === 'mult').map(
          (buff) => el('span', { class: 'm3-codex-topitem' }, `${buff.icon} ×${buffFactor(meta, buff.id)}`),
        ),
      ),
      el(
        'div',
        { class: 'm3-codex-overview' },
        el(
          'div',
          { class: 'm3-codex-overview-head' },
          el('span', { class: 'm3-codex-overview-title' }, '图鉴完成度'),
          el('span', { class: 'm3-codex-overview-pct' }, `${pct}%`),
        ),
        el(
          'span',
          { class: 'm3-codex-bar m3-codex-bar--overview' },
          el('span', { class: 'm3-codex-bar-fill', style: `width:${pct}%` }),
        ),
        el(
          'div',
          { class: 'm3-codex-metrics' },
          metric('🎴 祝福', view.perksUnlocked, view.perksTotal, `满级 ${view.perksMaxed}`),
          metric('🌳 共鸣树', view.buffsOn, view.buffsTotal, `机制节点同样计入`),
          metric('🧩 角色', view.charsOn, view.charsTotal, `熟练合计 Lv.${view.mastery}`),
          metric(
            '🏅 里程碑',
            view.milestonesClaimed,
            view.milestonesTotal,
            view.claimable > 0 ? `可领 ${view.claimable} 项` : '全部已处理',
          ),
        ),
      ),
      el(
        'p',
        { class: 'm3-codex-sub' },
        `精华按每轮到达层数结算：每层 1 点底薪 + 层数平方（第 10 层 ${baseOf(10)} · 20 层 ${baseOf(20)} · 30 层 ${baseOf(30)}，未计共鸣加成）。`,
      ),
    );
  }

  /** 遗物流派的中文名（与 relics.js 的 group 同口径，仅用于图鉴展示） */
  const RELIC_GROUP_LABEL = {
    chain: '连锁流', special: '特殊元素流', economy: '经济流', survival: '生存流',
  };

  /**
   * 遗物图鉴（开发方案 3.5 / 4.2）：**只读**分区
   *
   * 遗物是「玩法引擎」，不能靠精华买、也不进三选一池（那是祝福的位置），
   * 所以这里只按稀有度铺开条目，让玩家知道宝箱 / Boss / 事件里可能开出什么。
   * 稀有度顺序与祝福分区一致（普通 → 稀有 → 史诗），说明里点出「每轮最多 1 件」的硬边界。
   */
  function relicSections() {
    const cfg = rogueCfg().rarities;
    const byRarity = relicsByRarity();
    return ['common', 'rare', 'epic']
      .filter((key) => byRarity[key] && byRarity[key].length > 0)
      .map((key) => {
        const label = cfg[key]?.label || key;
        return section(
          `${label} · ${byRarity[key].length} 件`,
          null,
          byRarity[key].map((relic) => item(relic, RELIC_GROUP_LABEL[relic.group] || '遗物')),
          ' m3-codex-list--relics',
        );
      });
  }

  /** 角色图鉴（开发方案 3.8，P5）：只读 + 解锁进度 + 各角色战绩；角色只是玩法入口，不用精华买强度 */
  function charRow(ch, stats, own) {
    const prog = unlockProgress(ch, stats);
    const unlocked = !prog || prog.done;
    // 熟练度（纯展示：按该角色累计出战轮数分级，不接强度；对应成就徽章门槛 15 轮）
    const mast = characterMastery(own);
    const statsText = own && own.runs
      ? `出战 ${own.runs} · 最深 ${own.bestFloor || 0} · 通关 ${own.wins || 0}`
      : '尚未出战';
    const nextText = mast.next === null ? '熟练已满级' : `距下一档还差 ${mast.next - mast.runs} 轮`;
    // 未解锁时进度条改看「解锁条件」，已解锁时看熟练度，两种状态都有一致的进度反馈
    const pct = unlocked
      ? Math.round(mast.progress * 100)
      : Math.round((Math.min(prog.have, prog.need) / prog.need) * 100);
    return el(
      'div',
      { class: `m3-codex-tile m3-codex-tile--char${unlocked ? '' : ' m3-codex-item--locked'}` },
      el(
        'div',
        { class: 'm3-codex-tile-head' },
        el('span', { class: 'm3-codex-icon' }, unlocked ? ch.icon : '🔒'),
        el('span', { class: 'm3-codex-tile-name' }, ch.name),
        el('span', { class: 'm3-codex-limit' }, ch.style),
        // 熟练度称号：与 MASTERY_TIERS 的档位一一对应，满级用最高档配色
        unlocked
          ? el(
            'span',
            { class: `m3-codex-mastery m3-codex-mastery--${mast.level}` },
            `${MASTERY_TITLE[mast.level] || MASTERY_TITLE[0]} Lv.${mast.level}`,
          )
          : null,
      ),
      el(
        'div',
        { class: 'm3-codex-tile-body' },
        el('div', { class: 'm3-codex-desc' }, ch.desc),
        el(
          'div',
          { class: 'm3-codex-meta' },
          unlocked ? `${statsText} · ${nextText}` : `🔒 ${prog.label}（${prog.have}/${prog.need}）`,
        ),
        el(
          'span',
          { class: 'm3-codex-bar m3-codex-bar--mastery' },
          el('span', { class: 'm3-codex-bar-fill', style: `width:${pct}%` }),
        ),
      ),
    );
  }

  function charSections(meta) {
    const stats = meta.stats || {};
    const cs = meta.charStats || {};
    // 标题已在 paneHead，这里直接铺列表，不再套一层「全部角色」小节
    return el(
      'div',
      { class: 'm3-codex-list m3-codex-list--chars' },
      ...CHARACTERS.map((ch) => charRow(ch, stats, cs[ch.id])),
    );
  }

  /** 祝福筛选谓词（只影响本页展示，不影响三选一抽取） */
  function perkMatch(perk, meta) {
    const lv = itemLevel(meta, perk);
    if (perkFilter === 'buyable') return requiresMet(meta, perk) && !!nextStep(meta, perk);
    if (perkFilter === 'owned') return lv > 0;
    if (perkFilter === 'locked') return lv <= 0;
    return true;
  }

  /**
   * 组内排序：把「现在最可能点的」排前面
   * 已解锁可升级 → 未解锁但前置已满足 → 已满级 → 前置未满足
   */
  function perkRank(perk, meta) {
    const lv = itemLevel(meta, perk);
    const step = nextStep(meta, perk);
    if (lv > 0 && step) return 0;
    if (lv <= 0 && step && requiresMet(meta, perk)) return 1;
    if (!step) return 2;
    return 3;
  }

  /** 祝福筛选栏：四个胶囊 + 各档数量（数量按当前存档实时算） */
  function perkFilterBar(meta) {
    const counts = { all: PERKS.length, buyable: 0, owned: 0, locked: 0 };
    for (const perk of PERKS) {
      if (requiresMet(meta, perk) && nextStep(meta, perk)) counts.buyable += 1;
      if (itemLevel(meta, perk) > 0) counts.owned += 1;
      else counts.locked += 1;
    }
    return el(
      'div',
      { class: 'm3-codex-filters', role: 'toolbar', 'aria-label': '祝福筛选' },
      ...PERK_FILTERS.map((f) => el(
        'button',
        {
          class: `m3-codex-filter${perkFilter === f.id ? ' m3-codex-filter--on' : ''}`,
          type: 'button',
          'aria-pressed': perkFilter === f.id ? 'true' : 'false',
          onClick: () => {
            if (perkFilter === f.id) return;
            perkFilter = f.id;
            paint();
          },
        },
        f.label,
        el('span', { class: 'm3-codex-filter-count' }, String(counts[f.id])),
      )),
    );
  }

  /** 按稀有度分组（普通 → 稀有 → 史诗），组标题带上该档上限、费用与收集进度；条目用紧凑行 */
  function raritySections(meta) {
    const cfg = rogueCfg().rarities;
    const order = ['common', 'rare', 'epic'].filter((key) => cfg[key]);
    return order.map((key) => {
      const all = PERKS.filter((perk) => perk.rarity === key);
      if (all.length === 0) return null;
      const perks = all
        .filter((perk) => perkMatch(perk, meta))
        .sort((a, b) => perkRank(a, meta) - perkRank(b, meta));
      if (perks.length === 0) return null;
      const rar = cfg[key];
      // 组内若有祝福单独封顶（如极简主义受 4 色下限约束只有 2 级），标题别只写稀有度上限造成误解
      const caps = [...new Set(all.map((perk) => maxLevelOf(perk)))];
      const capText = caps.length === 1
        ? `Lv.${rar.maxLevel}`
        : `Lv.${rar.maxLevel}（个别祝福单独封顶，见条目）`;
      const owned = all.filter((perk) => itemLevel(meta, perk) > 0).length;
      const maxed = all.filter((perk) => itemLevel(meta, perk) >= maxLevelOf(perk)).length;
      return section(
        `${rar.label || key} · ${owned}/${all.length} 已解锁 · ${maxed} 满级（上限 ${capText}）`,
        null,
        perks.map((perk) => perkTile(perk, meta)),
        ' m3-codex-list--perks',
      );
    }).filter(Boolean);
  }

  /** 切换分页：重画并把滚动位归零（否则新页会停在上一页滚到的位置）；
      模态外壳滚 .modal__body，整页外壳直接滚窗口 */
  function switchTab(id) {
    if (tab === id) return;
    tab = id;
    paint();
    const scroller = host.closest('.modal__body');
    if (scroller) scroller.scrollTo({ top: 0 });
    else window.scrollTo({ top: 0 });
  }

  /**
   * 分页标签：下划线式导航
   * 六个带边框的等宽卡片并排会显得又碎又乱，这里改成「透明文字 + 选中下划线」，
   * 可领里程碑的计数也从浮动角标改成贴着文字的胶囊，不压到相邻分页。
   */
  function tabBar(meta) {
    const ready = claimableCount(meta);
    return el(
      'div',
      { class: 'm3-codex-tabs', role: 'tablist' },
      ...TABS.map((t) => el(
        'button',
        {
          class: `m3-codex-tab${tab === t.id ? ' m3-codex-tab--on' : ''}`,
          type: 'button',
          role: 'tab',
          'aria-selected': tab === t.id ? 'true' : 'false',
          onClick: () => switchTab(t.id),
        },
        el('span', { class: 'm3-codex-tab-icon', 'aria-hidden': 'true' }, t.icon),
        el('span', { class: 'm3-codex-tab-label' }, t.label),
        t.id === 'ms' && ready > 0
          ? el('span', { class: 'm3-codex-tab-dot', title: `${ready} 项里程碑可领` }, String(ready))
          : null,
      )),
    );
  }

  /** 当前分页的主体内容（每页都以 paneHead 开头，保证切换后标题 / 说明 / 主操作的位置一致） */
  function tabBody(meta) {
    const view = collectionSummary(meta);
    if (tab === 'perks') {
      const sections = raritySections(meta);
      const filterLabel = PERK_FILTERS.find((f) => f.id === perkFilter)?.label || '当前筛选';
      return el(
        'div',
        { class: 'm3-codex-pane' },
        paneHead(
          '✨ 祝福',
          `已解锁 ${view.perksUnlocked}/${view.perksTotal} · 满级 ${view.perksMaxed} · 筛选只影响展示，不改变三选一池`,
        ),
        perkFilterBar(meta),
        ...(sections.length > 0
          ? sections
          : [el('p', { class: 'm3-codex-empty' }, `「${filterLabel}」下没有符合条件的祝福，换个筛选看看。`)]),
      );
    }
    if (tab === 'relics') {
      return el(
        'div',
        { class: 'm3-codex-pane' },
        paneHead('🎁 遗物', '每轮每件最多持有 1 个 · 只从宝藏 / Boss / 事件 / 商店获得'),
        ...relicSections(),
      );
    }
    if (tab === 'chars') {
      return el(
        'div',
        { class: 'm3-codex-pane' },
        paneHead(
          '🧩 角色',
          `已解锁 ${view.charsOn}/${view.charsTotal} · 熟练合计 Lv.${view.mastery} · 解锁靠战绩，不用精华购买`,
        ),
        charSections(meta),
      );
    }
    if (tab === 'quest') {
      return el(
        'div',
        { class: 'm3-codex-pane' },
        paneHead(
          '📜 局内任务',
          `第 ${ROGUE.quest.fromFloor} 层起每层随机派一个收集任务 · 无失败惩罚 · 达成即当场生效`,
        ),
        section(
          `奖励池 · ${QUEST_REWARDS.length} 种`,
          null,
          QUEST_REWARDS.map((reward) => item(reward, null)),
          ' m3-codex-list--quest',
        ),
      );
    }
    if (tab === 'ms') {
      // 里程碑单独一页：按「祝福收集 / 共鸣树 / 角色 / 进阶 / 历练」分组
      const states = milestoneState(meta);
      const pending = states.filter((ms) => ms.done && !ms.claimed);
      const reward = pending.reduce((sum, ms) => sum + milestoneReward(ms, meta), 0);
      const claimed = states.length - pending.length;
      return el(
        'div',
        { class: 'm3-codex-pane' },
        paneHead(
          '🏅 里程碑',
          `共 ${states.length} 项 · 已领取 ${claimed} 项 · 点亮「丰收闭环」后奖励 ×2`,
          pending.length > 0
            ? el(
              'button',
              {
                class: 'm3-codex-claimall',
                type: 'button',
                onClick: () => {
                  if (!claimAllRogueMilestones()) toast.info('未连接服务器，稍后再试');
                },
              },
              `一键领取 ${pending.length} 项 · ✦${reward}`,
            )
            : null,
        ),
        ...MS_GROUPS.map((group) => {
          const rows = states.filter((ms) => group.kinds.includes(ms.kind));
          if (rows.length === 0) return null;
          const done = rows.filter((ms) => ms.claimed).length;
          return section(
            `${group.title} · ${done}/${rows.length}`,
            null,
            rows.map((ms) => milestoneRow(ms, meta)),
            ' m3-codex-list--ms',
          );
        }).filter(Boolean),
      );
    }
    // 默认页：只有共鸣树（局外养成主线）；里程碑领奖已拆到「里程」页
    const on = META_BUFFS.filter((buff) => itemLevel(meta, buff) > 0).length;
    return el(
      'div',
      { class: 'm3-codex-pane' },
      paneHead(
        '🌳 共鸣树',
        `已点亮 ${on}/${META_BUFFS.length} · 三条流派逐级点亮：前两格是数值优势，末端是机制节点`,
      ),
      treeSection(meta),
    );
  }

  /** 重画整块内容（服务端每次下发存档都会调一次） */
  function paint() {
    const meta = getRogueMeta();
    host.replaceChildren(
      summary(meta),
      tabBar(meta),
      tabBody(meta),
    );
  }

  paint();
  off = onRogueMeta(() => {
    if (!closed) paint();
  });

  return { host, stop };
}

/**
 * 打开图鉴（**局内**入口：对局左栏 / 三选一模态框）
 *
 * 对局中用模态框更合适：不打断盘面，关掉就回到同一局面（此时盘面已 lock）。
 * 带 picks 时能看到本轮已经拿到几张。
 *
 * @param {Record<string, number>} [picks] - 本轮已选祝福 { 祝福id: 次数 }
 */
export function showPerkCodex(picks = null) {
  const { host, stop } = codexPanel(picks);
  const overlay = modal.show({
    title: '📖 图鉴与养成',
    showCancel: false,
    confirmText: '关闭',
    onConfirm: stop,
    onCancel: stop,
    content: host,
  });

  // 图鉴条目比普通弹窗宽（每行都要塞下效果与按钮），借宿主节点放宽 max-width
  overlay?.classList.add('modal-overlay--codex');
}

/**
 * 渲染图鉴**整页**（局外入口：娱乐菜单 / 结算页 / 站点路由 #/codex）
 *
 * 与模态框的区别：局外没有「盘面」可回，用整页才不会把图鉴挤成滚动小窗。
 * 顶部是「← 返回 + 标题」，内容包进卡片（吸顶分页栏才有底色可贴）。
 *
 * @param {HTMLElement} container - 挂载容器（会被整页替换）
 * @param {Object} [options]
 * @param {Record<string, number>} [options.picks] - 本轮已选祝福；局外一般不传
 * @param {string} [options.title='📖 图鉴与养成'] - 页面标题
 * @param {Function} [options.onExit] - 点「返回」的回调（由调用方决定回到哪一屏）
 * @returns {Function} cleanup：退订 + 摘除页面（调用方在切走前调用）
 */
export function renderCodexPage(container, { picks = null, title = '📖 图鉴与养成', onExit } = {}) {
  const panel = codexPanel(picks);
  const page = el(
    'div',
    { class: 'm3-codex-page' },
    el(
      'div',
      { class: 'm3-codex-page-head' },
      onExit
        ? el('button', { class: 'm3-codex-back', type: 'button', onClick: () => onExit() }, '← 返回')
        : null,
      el('h2', { class: 'm3-codex-page-title' }, title),
    ),
    el('div', { class: 'm3-codex-page-body' }, panel.host),
  );
  container.replaceChildren(page);
  return () => {
    panel.stop();
    page.remove();
  };
}
