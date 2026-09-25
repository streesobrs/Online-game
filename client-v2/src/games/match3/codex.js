/**
 * 祝福图鉴 = 局外养成面板（肉鸽试炼，开发方案 5.7）
 *
 * 它同时承担两件事：
 * 1. **看**：三选一每次只出 3 张，玩家看不到池子里还有什么；这里把 perks.js 的
 *    PERKS / META_BUFFS / QUEST_REWARDS 原样铺开（数据源就是同一份常量，加一条不用改本文件）
 * 2. **花**：打 run 攒的「精华 ✦」在这里花掉——解锁新祝福（进三选一池）、
 *    升级已有祝福（提升单张效果）、解锁升级局外增益（跨轮常驻）、领取收集里程碑
 *
 * 分两层：**局外增益**跨轮常驻、不进三选一；**祝福**是局内的，一轮结束清空。
 *
 * 数值推导全在 meta.js（等级上限、费用、里程碑判定、余额），本文件只管渲染与发起请求。
 * 所有改动都要经服务端：`upgradeRoguePerk` / `claimRogueMilestone` 只发 id 出去，
 * 扣费与校验都在服务端做，回执带回最新存档 → sync.js 广播 → 这里重画。
 *
 * 外框复用 components/modal（与「积分详情」同一套），所以这里只负责产出内容节点。
 */
import { ROGUE } from './config.js';
import { META_BUFFS, PERKS, QUEST_REWARDS, descOf, valueAt } from './perks.js';
import {
  buffFactor, claimableCount, itemLevel, maxLevelOf, milestoneReward, milestoneState,
  nextStep, poolProgress, rarityOf, requiresMet, rogueCfg,
} from './meta.js';
import { claimRogueMilestone, getRogueMeta, onRogueMeta, upgradeRoguePerk } from './sync.js';
import { el } from '../../utils/dom.js';
import { modal } from '../../components/modal.js';
import { toast } from '../../components/toast.js';

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
 * 一条图鉴记录（任务奖励用；祝福的记录带等级与按钮，见 perkRow）
 * @param {object} entry - 任务奖励（icon、name、desc 必填）
 * @param {string|null} limit - 上限说明
 */
function item(entry, limit) {
  return el(
    'div',
    { class: 'm3-codex-item' },
    el('span', { class: 'm3-codex-icon' }, entry.icon),
    el(
      'div',
      { class: 'm3-codex-main' },
      el(
        'div',
        { class: 'm3-codex-head' },
        el('span', { class: 'm3-codex-name' }, entry.name),
        limit ? el('span', { class: 'm3-codex-limit' }, limit) : null,
      ),
      el('div', { class: 'm3-codex-desc' }, entry.desc),
    ),
  );
}

/** 一小节：标题 + 说明 + 条目列表 */
function section(title, hint, items, extraClass = '') {
  return el(
    'div',
    { class: `m3-codex-sec${extraClass}` },
    el('div', { class: 'm3-codex-sec-title' }, title),
    hint ? el('p', { class: 'm3-codex-sub' }, hint) : null,
    el('div', { class: 'm3-codex-list' }, ...items),
  );
}

/**
 * 打开祝福图鉴 / 养成面板
 *
 * 三个入口共用：娱乐菜单（进对局前就能看与解锁）、对局左栏与三选一模态框（对局中查池子）。
 * 对局中打开时带 picks，能看到本轮已经拿到几张。
 *
 * 面板里发起的解锁 / 升级 / 领奖都由服务端处理，回执回来后 `onRogueMeta` 触发重画，
 * 所以这里的按钮**只负责发起**，不自己改本地数据。
 *
 * @param {Record<string, number>} [picks] - 本轮已选祝福 { 祝福id: 次数 }；不在对局中则不传
 */
export function showPerkCodex(picks = null) {
  const host = el('div', { class: 'm3-codex' });
  let closed = false;
  let off = null;
  /** 共鸣树里当前选中的节点（详情卡跟着它走） */
  let selectedId = null;

  /** 默认选中：优先挑一个「前置已满足、还没满级」的节点（玩家下一步多半就想买它） */
  function defaultSelection(meta) {
    const buyable = META_BUFFS.find((b) => requiresMet(meta, b) && itemLevel(meta, b) < maxLevelOf(b));
    return (buyable || META_BUFFS[0]).id;
  }

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
   * 一条养成项：图标 + 名字 / 稀有度 / 等级条 + 当前与下一级效果 + 解锁或升级按钮
   * 祝福与共鸣树节点共用（等级各自在 perks / buffs 里，由 itemLevel 分辨）
   */
  function perkRow(entry, meta) {
    const lv = itemLevel(meta, entry);
    const max = maxLevelOf(entry);
    const step = nextStep(meta, entry);
    const rar = rarityOf(entry);
    const isBuff = entry.scope === 'buff';
    const isMechanic = entry.kind === 'mechanic';
    // 共鸣树的连线：前置没点亮就不能买（服务端也会拦一次，这里只是提前把按钮收掉）
    const ready = requiresMet(meta, entry);
    const fam = el('span', { class: `m3-codex-fam m3-codex-fam--${entry.rarity}` }, rar.label || entry.rarity);

    const btn = !step
      ? el('span', { class: 'm3-codex-buy m3-codex-buy--max' }, isMechanic ? '已解锁' : '已满级')
      : !ready
        ? el('span', { class: 'm3-codex-buy m3-codex-buy--max' }, `需先解锁 ${prevName(entry)}`)
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

    return el(
      'div',
      { class: `m3-codex-item m3-codex-item--${entry.rarity}${lv <= 0 ? ' m3-codex-item--locked' : ''}` },
      el('span', { class: 'm3-codex-icon' }, lv > 0 || ready ? entry.icon : '🔒'),
      el(
        'div',
        { class: 'm3-codex-main' },
        el(
          'div',
          { class: 'm3-codex-head' },
          el('span', { class: 'm3-codex-name' }, entry.name),
          fam,
          isMechanic ? el('span', { class: 'm3-codex-kind' }, '机制') : null,
          // 机制节点一次性解锁，没有「几级」可言，直接给状态
          isMechanic
            ? el('span', { class: 'm3-codex-lv' }, lv > 0 ? '已点亮' : '未点亮')
            : el('span', { class: 'm3-codex-lv' }, `Lv.${lv}/${max}`),
          picks && picks[entry.id] > 0
            ? el('span', { class: 'm3-codex-owned' }, `本轮 ×${picks[entry.id]}`)
            : null,
        ),
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
      ),
      btn,
    );
  }

  /**
   * 共鸣树上的一个节点按钮（图片区 = 坐标格，连线由 CSS 画，见 styles.css）
   * 三种状态各有一套观感：已点亮 / 可解锁 / 前置未满足
   */
  function treeNode(entry, meta) {
    const lv = itemLevel(meta, entry);
    const isMechanic = entry.kind === 'mechanic';
    const ready = requiresMet(meta, entry);
    const cls = ['m3-tree-node', `m3-tree-node--${entry.rarity}`];
    if (isMechanic) cls.push('m3-tree-node--mechanic');
    if (lv > 0) cls.push('m3-tree-node--on');
    else cls.push(ready ? 'm3-tree-node--next' : 'm3-tree-node--blocked');
    if (entry.id === selectedId) cls.push('m3-tree-node--sel');

    return el(
      'button',
      {
        class: cls.join(' '),
        type: 'button',
        title: `${entry.name}：${descOf(entry, Math.max(1, lv))}`,
        onClick: () => {
          selectedId = entry.id;
          paint();
        },
      },
      el('span', { class: 'm3-tree-node-icon' }, ready ? entry.icon : '🔒'),
      el('span', { class: 'm3-tree-node-name' }, entry.name),
      el(
        'span',
        { class: 'm3-tree-node-lv' },
        isMechanic
          ? (lv > 0 ? '已点亮' : '机制')
          : `Lv.${lv}/${maxLevelOf(entry)}`,
      ),
    );
  }

  /** 一条里程碑：名称 / 进度 / 奖励 + 领取按钮 */
  function milestoneRow(ms, meta) {
    const state = ms.claimed ? '已领取' : (ms.done ? '可领取' : '未达成');
    // 「丰收闭环」会把奖励翻倍，这里显示的必须是真正会到账的数（服务端同口径）
    const reward = milestoneReward(ms, meta);
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
        el('div', { class: 'm3-codex-desc' }, `进度 ${Math.min(ms.have, ms.need)}/${ms.need} · ${state}`),
      ),
      ms.done && !ms.claimed
        ? el('button', { class: 'm3-codex-buy m3-codex-buy--ready', type: 'button', onClick: () => claim(ms) }, '领取')
        : el('span', { class: 'm3-codex-buy m3-codex-buy--max' }, state),
    );
  }

  /**
   * 共鸣树：3 条流派 × 3 层，节点按各自的 `tree` 坐标落格
   *
   * 布局与连线全部由 CSS 画（见 styles.css 的 .m3-tree-*）：根「精华 ✦」在上，
   * 三条流派各成一列往下延伸，末端是机制节点。加节点只改 perks.js 的 `tree` 坐标，
   * 这里、CSS 都不用动（列数按数据里的最大 col 现算）。
   */
  function treeSection(meta) {
    const cols = Math.max(...META_BUFFS.map((b) => b.tree.col)) + 1;
    const center = (k) => `${(((k + 0.5) / cols) * 100).toFixed(3)}%`;
    const edge = `${((0.5 / cols) * 100).toFixed(3)}%`;
    const on = META_BUFFS.filter((b) => itemLevel(meta, b.id) > 0).length;
    const sel = META_BUFFS.find((b) => b.id === selectedId) || META_BUFFS[0];

    const grid = el(
      'div',
      { class: 'm3-tree-grid', style: `grid-template-columns:repeat(${cols},1fr)` },
      el(
        'div',
        { class: 'm3-tree-rootcell' },
        el(
          'span',
          { class: 'm3-tree-rootnode' },
          el('span', { class: 'm3-tree-rooticon' }, '✦'),
          el('span', { class: 'm3-tree-rootname' }, '精华'),
        ),
      ),
      // 从根分叉到三条流派：一根横杆 + 每个流派一根下垂的短线
      el(
        'div',
        { class: 'm3-tree-fan' },
        el('span', { class: 'm3-tree-fan-bar', style: `left:${edge};right:${edge}` }),
        el('span', { class: 'm3-tree-fan-up', style: `left:${center((cols - 1) / 2)}` }),
        ...Array.from({ length: cols }, (_, k) => el('span', { class: 'm3-tree-fan-stub', style: `left:${center(k)}` })),
      ),
      ...META_BUFFS.map((entry) => el(
        'div',
        {
          class: 'm3-tree-cell',
          style: `grid-column:${entry.tree.col + 1};grid-row:${entry.tree.row + 3}`,
        },
        el('span', { class: 'm3-tree-link' }),
        treeNode(entry, meta),
      )),
    );

    return el(
      'div',
      { class: 'm3-codex-sec' },
      el('div', { class: 'm3-codex-sec-title' }, `✦ 共鸣树 · 已点亮 ${on}/${META_BUFFS.length}`),
      el(
        'p',
        { class: 'm3-codex-sub' },
        '三条流派各自从根部往下点亮，连线即前置——只能一级一级买。'
        + '前两格是数值优势（可逐级升级），末端那颗是机制节点：改的是规则而不是数值，一次性解锁。'
        + '解锁即生效，不进三选一池、也不占对局内的位置。',
      ),
      grid,
      el('div', { class: 'm3-codex-list' }, perkRow(sel, meta)),
    );
  }

  /** 顶部：精华余额 + 收集度 + 局外统计（存档记录得全，这里就把用得上的几项摆出来） */
  function summary(meta) {
    const progress = poolProgress(meta);
    const stats = meta.stats || {};
    const ready = claimableCount(meta);
    return el(
      'div',
      { class: 'm3-codex-top' },
      el(
        'div',
        { class: 'm3-codex-toprow' },
        el('span', { class: 'm3-codex-essence' }, '✦ ', el('b', {}, String(meta.essence))),
        el('span', { class: 'm3-codex-toplabel' }, '精华余额'),
      ),
      el(
        'div',
        { class: 'm3-codex-toprow' },
        el('span', { class: 'm3-codex-topitem' }, `已解锁 ${progress.unlocked}/${progress.total}`),
        el('span', { class: 'm3-codex-topitem' }, `已满级 ${progress.maxed}`),
        el('span', { class: 'm3-codex-topitem' }, `累计获得 ✦${meta.essenceEarned}`),
        el('span', { class: 'm3-codex-topitem' }, `累计花费 ✦${stats.spent || 0}`),
        el('span', { class: 'm3-codex-topitem' }, `出战 ${stats.runs || 0} 轮`),
        el('span', { class: 'm3-codex-topitem' }, `最深 ${stats.bestFloor || 0} 层`),
        // 结算倍率的当前值：把「买了到底多拿多少」直接摆在最上面
        ...META_BUFFS.filter((buff) => buff.scales?.kind === 'mult').map(
          (buff) => el('span', { class: 'm3-codex-topitem' }, `${buff.icon} ×${buffFactor(meta, buff.id)}`),
        ),
      ),
      el(
        'p',
        { class: 'm3-codex-sub' },
        '每轮按「到达层数」给精华（第 10 层 20 · 第 20 层 80 · 第 30 层 180），在图鉴里花掉：'
        + '点亮共鸣树、解锁新祝福进三选一池、升级已有祝福提升单次效果。'
        + '没解锁的祝福不会出现在三选一里，所以「集齐」是有实际收益的目标。'
        + '经验同样按到达层数换算，再乘上共鸣树里「经验共鸣」的倍率。',
      ),
      ready > 0
        ? el('p', { class: 'm3-codex-ready' }, `🏅 有 ${ready} 项里程碑奖励可领`)
        : null,
    );
  }

  /** 按稀有度分组（普通 → 稀有 → 史诗），每组的说明带上该档的等级上限与费用 */
  function raritySections(meta) {
    const cfg = rogueCfg().rarities;
    const order = ['common', 'rare', 'epic'].filter((key) => cfg[key]);
    return order.map((key) => {
      const perks = PERKS.filter((perk) => perk.rarity === key);
      if (perks.length === 0) return null;
      const rar = cfg[key];
      return section(
        `局内祝福 · ${rar.label || key}（上限 Lv.${rar.maxLevel}）`,
        `解锁 ✦${rar.unlockCost} · 升级 ✦${rar.upgradeCost} 起，每级 ×${rar.costGrowth}`,
        perks.map((perk) => perkRow(perk, meta)),
      );
    }).filter(Boolean);
  }

  /** 重画整块内容（服务端每次下发存档都会调一次） */
  function paint() {
    const meta = getRogueMeta();
    if (!selectedId) selectedId = defaultSelection(meta);
    host.replaceChildren(
      summary(meta),
      treeSection(meta),
      section(
        '🏅 收集里程碑',
        '达成后一次性领取，奖励只有精华（不掺道具券，避免养成与对局道具两套经济互相打架）',
        milestoneState(meta).map((ms) => milestoneRow(ms, meta)),
      ),
      ...raritySections(meta),
      section(
        '局内任务奖励',
        `第 ${ROGUE.quest.fromFloor} 层起每层随机派一个「收集某颜色 N 个」的任务（不设失败惩罚），达成即当场生效`,
        QUEST_REWARDS.map((reward) => item(reward, '达成即得')),
      ),
    );
  }

  paint();
  off = onRogueMeta(() => {
    if (!closed) paint();
  });

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
