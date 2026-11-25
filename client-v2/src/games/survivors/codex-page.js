/**
 * 刷怪肉鸽 · 图鉴与养成（站点级整页，路由 #/survivor-codex）
 *
 * 把局外天赋与三张图鉴（强化 / 元素 / 怪物）提取成外置整页，供网站侧访问：
 * 大厅侧栏、移动端抽屉导航都能进入；游戏内则继续用 catalog.js 的模态框查看同一份内容。
 * 外观复用消消乐图鉴整页（#/codex）的 m3-codex 外壳：顶部返回 + 标题、吸顶分页、方卡。
 *
 * 数据来源：
 * - 天赋：meta.js（localStorage）
 * - 强化 / 元素 / 怪物：catalog.js → 服务端目录接口 + 动态 import buffs/ 与 monsters/
 */
import { el, viewRoot } from '../../utils/dom.js';
import { go } from '../../core/router.js';
import { store } from '../../core/store.js';
import { eventBus } from '../../core/eventBus.js';
import { loadCatalog } from './catalog.js';
import { formatTime, highlightNumbers } from './helpers.js';
import { REACTIONS } from './elements.js';
import {
  TALENTS, getMeta, talentLevel, upgradeTalent, totalTalentLevels,
} from './meta.js';
import { scheduleUpload } from './server-save.js';

/** 分页：天赋 + 三类图鉴 */
const TABS = [
  { id: 'talents', icon: '🌟', label: '天赋' },
  { id: 'buffs', icon: '📖', label: '强化' },
  { id: 'elements', icon: '⚛️', label: '元素' },
  { id: 'monsters', icon: '👾', label: '怪物' },
];

/** 天赋分组（只影响展示顺序，升级逻辑仍以 meta.js 的 TALENTS 为准） */
const GROUPS = [
  { title: '🛡 生存', ids: ['vitality', 'regen', 'guard'] },
  { title: '⚔️ 战斗', ids: ['power', 'swift'] },
  { title: '📈 成长', ids: ['magnet', 'scholar', 'fortune'] },
];

/** 一小节：标题 + 说明 + 卡片列表 */
function section(title, hint, items, listClass = ' m3-codex-list--perks') {
  return el(
    'div',
    { class: 'm3-codex-sec' },
    el('div', { class: 'm3-codex-sec-title' }, title),
    hint ? el('p', { class: 'm3-codex-sub' }, hint) : null,
    el('div', { class: `m3-codex-list${listClass}` }, ...items),
  );
}

/** 当前挂载的整页 cleanup（同路由重进时先收掉上一个实例） */
let activeCleanup = null;

/**
 * 渲染图鉴与养成整页
 * @param {HTMLElement} [container] - 内容容器（默认 #view-root）
 * @returns {Function} cleanup
 */
export function renderSurvivorCodexPage(container = viewRoot()) {
  if (typeof activeCleanup === 'function') activeCleanup();

  const host = el('div', { class: 'm3-codex' });
  let closed = false;
  let tab = store.get('survivor.codex.tab') || 'talents';
  store.set('survivor.codex.tab', null);
  if (!TABS.some((t) => t.id === tab)) tab = 'talents';
  // 返回目标在挂载时取一次并清掉，避免下次从顶部导航直接进入时还沿用旧的来源页
  const backId = store.get('survivor.codex.back') || 'games';
  store.set('survivor.codex.back', null);
  const backToPrev = () => go(backId);

  /** 图鉴数据（异步加载，天赋页不依赖它） */
  let buffs = [];
  let monsters = [];
  let loaded = false;
  let loadError = null;

  const totalTalentMax = TALENTS.reduce((sum, t) => sum + t.max, 0);

  /** 当前点数下能否升级 */
  function canUpgrade(talent, points) {
    const lv = talentLevel(talent.id);
    return lv < talent.max && points >= talent.cost(lv);
  }

  function buy(talent) {
    if (upgradeTalent(talent.id).ok) {
      scheduleUpload();
      paint();
    }
  }

  /** 天赋卡：等级 / 当前效果 / 下一级 / 进度条 / 升级按钮 */
  function talentTile(talent, points) {
    const lv = talentLevel(talent.id);
    const maxed = lv >= talent.max;
    const cost = maxed ? 0 : talent.cost(lv);
    const cls = [
      'm3-codex-tile',
      'm3-codex-item--common',
      maxed ? 'm3-codex-tile--maxed' : null,
      lv <= 0 ? 'm3-codex-item--locked' : null,
    ].filter(Boolean).join(' ');

    return el(
      'div',
      { class: cls },
      el(
        'div',
        { class: 'm3-codex-tile-head' },
        el('span', { class: 'm3-codex-icon' }, talent.icon),
        el('span', { class: 'm3-codex-tile-name' }, talent.name),
        el('span', { class: 'm3-codex-lv' }, `Lv.${lv}/${talent.max}`),
      ),
      el(
        'div',
        { class: 'm3-codex-tile-body' },
        el('div', { class: 'm3-codex-desc' }, ...highlightNumbers(lv > 0 ? talent.desc(lv) : `解锁后：${talent.desc(1)}`)),
        maxed
          ? el('div', { class: 'm3-codex-next' }, '已达到上限')
          : el('div', { class: 'm3-codex-next' }, ...highlightNumbers(`下一级 Lv.${lv + 1}：${talent.desc(lv + 1)}`)),
        el(
          'span',
          { class: 'm3-codex-bar' },
          el('span', {
            class: 'm3-codex-bar-fill',
            style: `width:${Math.round((lv / talent.max) * 100)}%`,
          }),
        ),
      ),
      el(
        'div',
        { class: 'm3-codex-tile-foot' },
        maxed
          ? el('span', { class: 'm3-codex-buy m3-codex-buy--max' }, '已满级')
          : el(
            'button',
            {
              class: 'm3-codex-buy',
              type: 'button',
              disabled: points < cost,
              onClick: () => buy(talent),
            },
            `升级 · ${cost} 点`,
          ),
      ),
    );
  }

  /** 强化 / 元素卡 */
  function buffTile(buff) {
    return el(
      'div',
      { class: 'm3-codex-tile' },
      el(
        'div',
        { class: 'm3-codex-tile-head' },
        el('span', { class: 'm3-codex-icon' }, buff.icon || '📖'),
        el('span', { class: 'm3-codex-tile-name' }, buff.name),
        buff.element || buff.reaction
          ? el('span', { class: 'm3-codex-limit', style: { color: buff.color } },
            buff.element || buff.reactionName || '反应')
          : null,
        el('span', { class: 'm3-codex-lv' }, `上限 ${buff.max || 1} 层`),
      ),
      el(
        'div',
        { class: 'm3-codex-tile-body' },
        el('div', { class: 'm3-codex-desc' }, ...highlightNumbers(buff.desc)),
        buff.detail ? el('div', { class: 'm3-codex-meta' }, ...highlightNumbers(buff.detail)) : null,
        buff.requireText ? el('div', { class: 'm3-codex-meta' }, buff.requireText) : null,
        typeof buff.effect === 'function'
          ? el('div', { class: 'm3-codex-next' }, ...highlightNumbers(`1 层：${buff.effect(1)}`))
          : null,
      ),
    );
  }

  /** 怪物卡：颜色块 + 出现时机 + 初始数值 */
  function monsterTile(monster) {
    const s = monster.stats || {};
    let unlock = '特殊召唤';
    if (monster.spawnable) unlock = monster.unlockAt ? `${formatTime(monster.unlockAt)} 后出现` : '开局出现';
    else if (monster.boss) unlock = `每 ${monster.spawnInterval} 秒出现`;
    return el(
      'div',
      { class: 'm3-codex-tile' },
      el(
        'div',
        { class: 'm3-codex-tile-head' },
        el(
          'span',
          { class: 'm3-codex-icon' },
          el('span', { class: 'sv-codex-swatch', style: { background: s.color || '#94a3b8' } }),
        ),
        el('span', { class: 'm3-codex-tile-name' }, monster.name),
        el('span', { class: 'm3-codex-limit' }, unlock),
      ),
      el(
        'div',
        { class: 'm3-codex-tile-body' },
        el('div', { class: 'm3-codex-desc' }, ...highlightNumbers(monster.desc)),
        el(
          'div',
          { class: 'm3-codex-meta' },
          ...highlightNumbers(`❤ 生命 ${s.hp} · 👣 速度 ${s.speed} · ⚔ 伤害 ${s.dmg} · ⭐ 经验 ${s.xp}`),
        ),
      ),
    );
  }

  /** 顶部总览：天赋点余额 + 三类图鉴条目数 + 养成度 */
  function summary(meta) {
    const totalLv = totalTalentLevels();
    const maxed = TALENTS.filter((t) => talentLevel(t.id) >= t.max).length;
    const pct = Math.round((totalLv / totalTalentMax) * 100);
    const ready = loaded && !loadError;
    const elements = ready ? buffs.filter((b) => b.element).length : null;
    const reactions = ready ? buffs.filter((b) => b.reaction).length : null;
    const normalBuffs = ready ? buffs.filter((b) => !b.element && !b.reaction).length : null;
    const count = (n) => (n === null ? '…' : String(n));
    return el(
      'div',
      { class: 'm3-codex-top' },
      el(
        'div',
        { class: 'm3-codex-toprow' },
        el('span', { class: 'm3-codex-essence' }, '🌟 ', el('b', {}, String(meta.points))),
        el('span', { class: 'm3-codex-toplabel' }, '可用天赋点'),
        el('span', { class: 'm3-codex-topitem' }, `累计获得 🌟${meta.earned}`),
        el('span', { class: 'm3-codex-topitem' }, `📖 强化 ${count(normalBuffs)}`),
        el('span', { class: 'm3-codex-topitem' }, `⚛️ 元素 ${count(elements)}`),
        el('span', { class: 'm3-codex-topitem' }, `⚡ 反应 ${count(reactions)}`),
        el('span', { class: 'm3-codex-topitem' }, `👾 怪物 ${count(ready ? monsters.length : null)}`),
      ),
      el(
        'div',
        { class: 'm3-codex-overview' },
        el(
          'div',
          { class: 'm3-codex-overview-head' },
          el('span', { class: 'm3-codex-overview-title' }, `天赋养成度 · 满级 ${maxed}/${TALENTS.length} 条`),
          el('span', { class: 'm3-codex-overview-pct' }, `${pct}%`),
        ),
        el(
          'span',
          { class: 'm3-codex-bar m3-codex-bar--overview' },
          el('span', { class: 'm3-codex-bar-fill', style: `width:${pct}%` }),
        ),
      ),
      el(
        'p',
        { class: 'm3-codex-sub' },
        '天赋点每局结算发放，升级立即保存、下一局开局生效；图鉴数据直接读取 buffs/ 与 monsters/ 下的单文件。',
      ),
    );
  }

  /** 下划线式分页（天赋页签带「可升级」数量胶囊） */
  function tabBar(meta) {
    const buyable = TALENTS.filter((t) => canUpgrade(t, meta.points)).length;
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
          onClick: () => {
            if (tab === t.id) return;
            tab = t.id;
            paint();
            window.scrollTo({ top: 0 });
          },
        },
        el('span', { class: 'm3-codex-tab-icon', 'aria-hidden': 'true' }, t.icon),
        el('span', { class: 'm3-codex-tab-label' }, t.label),
        t.id === 'talents' && buyable > 0
          ? el('span', { class: 'm3-codex-tab-dot', title: `${buyable} 条天赋可升级` }, String(buyable))
          : null,
      )),
    );
  }

  function paneHead(title, hint) {
    return el(
      'div',
      { class: 'm3-codex-pane-head' },
      el(
        'div',
        { class: 'm3-codex-pane-text' },
        el('h3', { class: 'm3-codex-pane-title' }, title),
        hint ? el('p', { class: 'm3-codex-pane-hint' }, hint) : null,
      ),
    );
  }

  /** 当前分页内容 */
  function tabBody(meta) {
    if (tab === 'talents') {
      const groups = GROUPS.map((group) => {
        const items = group.ids
          .map((id) => TALENTS.find((t) => t.id === id))
          .filter(Boolean);
        if (items.length === 0) return null;
        const spent = items.reduce((sum, t) => sum + talentLevel(t.id), 0);
        const cap = items.reduce((sum, t) => sum + t.max, 0);
        return section(
          `${group.title} · ${spent}/${cap} 级`,
          null,
          items.map((t) => talentTile(t, meta.points)),
        );
      }).filter(Boolean);
      return el(
        'div',
        { class: 'm3-codex-pane' },
        paneHead(
          '🌟 局外天赋',
          `已投入 ${totalTalentLevels()}/${totalTalentMax} 级 · 天赋点跨局保留，下一局开局写入角色属性`,
        ),
        ...groups,
      );
    }

    if (loadError) {
      return el(
        'div',
        { class: 'm3-codex-pane' },
        paneHead('📖 图鉴', '图鉴数据来自服务端目录接口'),
        el('p', { class: 'm3-codex-empty' }, `图鉴数据加载失败：${loadError.message || loadError}`),
      );
    }

    if (!loaded) {
      return el(
        'div',
        { class: 'm3-codex-pane' },
        paneHead('📖 图鉴', '正在读取 buffs/ 与 monsters/ 目录…'),
        el('p', { class: 'm3-codex-empty' }, '加载中…'),
      );
    }

    if (tab === 'elements') {
      const shots = buffs.filter((b) => b.element);
      const reactions = buffs.filter((b) => b.reaction);
      return el(
        'div',
        { class: 'm3-codex-pane' },
        paneHead('⚛️ 元素图鉴', `基础元素弹 ${shots.length} 种 · 反应 buff ${reactions.length} 种 · 感电基础倍率 ×${REACTIONS.electro.baseMultiplier}`),
        section(`基础元素弹 · ${shots.length} 种`, '命中时对周围范围挂元素', shots.map(buffTile)),
        section(`反应 buff · ${reactions.length} 种`, '拥有水与雷元素弹后，升级时出现，强化感电反应', reactions.map(buffTile)),
      );
    }

    if (tab === 'monsters') {
      return el(
        'div',
        { class: 'm3-codex-pane' },
        paneHead('👾 怪物图鉴', `共 ${monsters.length} 种怪物 · 数值为初始值，会随对局时间成长`),
        section(`怪物 · ${monsters.length} 种`, null, monsters.map(monsterTile)),
      );
    }

    const items = buffs.filter((b) => !b.element);
    return el(
      'div',
      { class: 'm3-codex-pane' },
      paneHead('📖 强化图鉴', `共 ${items.length} 种强化 · 每张卡对应 buffs/ 下的一个文件`),
      section(`强化 · ${items.length} 种`, null, items.map(buffTile)),
    );
  }

  function paint() {
    const meta = getMeta();
    host.replaceChildren(summary(meta), tabBar(meta), tabBody(meta));
  }

  const page = el(
    'div',
    { class: 'm3-codex-page' },
    el(
      'div',
      { class: 'm3-codex-page-head' },
      el('button', { class: 'm3-codex-back', type: 'button', onClick: backToPrev }, '← 返回'),
      el('h2', { class: 'm3-codex-page-title' }, '📖 刷怪肉鸽 · 图鉴与养成'),
    ),
    el('div', { class: 'm3-codex-page-body' }, host),
  );

  paint();
  container.replaceChildren(page);

  function cleanup() {
    if (closed) return;
    closed = true;
    offRoute();
    page.remove();
    if (activeCleanup === cleanup) activeCleanup = null;
  }

  // 路由层不会回收视图的 cleanup（见 core/activity.js 注释），离开本页时自己退订
  const offRoute = eventBus.on('route:change', (id) => {
    if (id !== 'survivor-codex') cleanup();
  });
  activeCleanup = cleanup;

  loadCatalog()
    .then((data) => {
      if (closed) return;
      buffs = data.buffs;
      monsters = data.monsters;
      loaded = true;
      paint();
    })
    .catch((err) => {
      if (closed) return;
      loadError = err;
      loaded = true;
      paint();
    });

  return cleanup;
}
