/**
 * 刷怪肉鸽图鉴：目录数据动态加载与图鉴面板 UI。
 */
import { el } from '../../utils/dom.js';
import { highlightNumbers } from './helpers.js';
import { openBuffDetail, openMonsterDetail } from './detail-modal.js';
import { TALENTS, getMeta, talentLevel, upgradeTalent } from './meta.js';
import { REACTIONS } from './elements.js';
import { scheduleUpload } from './server-save.js';

const CATALOG_API = '/api/survivors/catalog';

export async function loadCatalog() {
  const res = await fetch(CATALOG_API, { cache: 'no-store' });
  if (!res.ok) throw new Error(`图鉴目录接口返回 ${res.status}`);
  const dirs = await res.json();
  const importDir = (dir, files) => Promise.all((files || []).map(async (file) => {
    try {
      const mod = await import(`./${dir}/${file}`);
      return mod.default || null;
    } catch (err) {
      console.warn(`[survivors] 读取 ${dir}/${file} 失败`, err);
      return null;
    }
  }));
  const [buffs, monsters] = await Promise.all([
    importDir('buffs', dirs.buffs),
    importDir('monsters', dirs.monsters),
  ]);
  return {
    buffs: buffs.filter((b) => b && b.id).sort((a, b) => (a.order || 0) - (b.order || 0)),
    monsters: monsters.filter((m) => m && m.id).sort((a, b) => (a.order || 0) - (b.order || 0)),
  };
}

/**
 * @param {Object} deps
 * @param {Object} deps.state - 对局状态（读取 upgradeStacks）
 * @param {Function} deps.formatTime - 时间格式化
 * @param {Function} deps.showOverlay - 覆盖层渲染
 * @param {Function} deps.getBuffs - 取强化列表
 * @param {Function} deps.getMonsters - 取怪物列表
 * @param {Function} deps.onClose - 关闭时通知外部
 */
export function createCatalog({ state, formatTime, showOverlay, getBuffs, getMonsters, onClose }) {
  let tab = 'buffs';
  let back = null;

  function tabBtn(id, label) {
    return el('button', {
      class: `sv-catalog-tab${tab === id ? ' active' : ''}`,
      type: 'button',
      onClick: () => open(id, back),
    }, label);
  }

  function buffCard(buff) {
    const stacks = state.upgradeStacks[buff.id] || 0;
    const max = buff.max || 1;
    const openDetail = () => openBuffDetail(buff, { stacks });
    return el('div', {
      class: 'sv-catalog-card sv-catalog-card--detail',
      role: 'button',
      tabIndex: 0,
      title: '查看详情',
      onClick: openDetail,
      onKeydown: (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        openDetail();
      },
    }, [
      el('div', { class: 'sv-catalog-card-head' }, [
        el('span', { class: 'sv-catalog-icon' }, buff.icon),
        el('span', { class: 'sv-catalog-name' }, buff.name),
        buff.element || buff.reaction
          ? el('span', { class: 'sv-catalog-tag', style: { color: buff.color, borderColor: buff.color } },
            buff.element || buff.reactionName || '反应')
          : null,
        el('span', { class: 'sv-catalog-tag' }, `上限 ${max} 层`),
        buff.requireText
          ? el('span', { class: 'sv-catalog-tag' }, buff.requireText)
          : null,
      ]),
      el('p', { class: 'sv-catalog-desc' }, ...highlightNumbers(buff.desc)),
      el('p', { class: 'sv-catalog-desc sv-catalog-detail' }, ...highlightNumbers(buff.detail || '')),
      el('div', { class: 'sv-catalog-stats' }, [
        stacks > 0 ? el('span', { class: 'sv-catalog-stat' }, ...highlightNumbers(`本局 ${stacks} / ${max} 层`)) : null,
        typeof buff.effect === 'function'
          ? el('span', { class: 'sv-catalog-stat' }, ...highlightNumbers(stacks > 0
            ? `当前 ${buff.effect(stacks)}`
            : `1 层 ${buff.effect(1)}`))
          : null,
      ]),
    ]);
  }

  /** 局外天赋卡：游戏内也能用模态框加点，升级立即写入本地存档 */
  function talentCard(talent) {
    const meta = getMeta();
    const lv = talentLevel(talent.id);
    const maxed = lv >= talent.max;
    const cost = maxed ? 0 : talent.cost(lv);
    return el('div', { class: 'sv-catalog-card' }, [
      el('div', { class: 'sv-catalog-card-head' }, [
        el('span', { class: 'sv-catalog-icon' }, talent.icon),
        el('span', { class: 'sv-catalog-name' }, talent.name),
        el('span', { class: 'sv-catalog-tag' }, `Lv.${lv}/${talent.max}`),
      ]),
      el('p', { class: 'sv-catalog-desc' }, ...highlightNumbers(lv > 0 ? talent.desc(lv) : `解锁后：${talent.desc(1)}`)),
      maxed
        ? el('p', { class: 'sv-catalog-desc sv-catalog-detail' }, '已达到上限')
        : el('p', { class: 'sv-catalog-desc sv-catalog-detail' }, ...highlightNumbers(`下一级：${talent.desc(lv + 1)}`)),
      maxed
        ? el('span', { class: 'sv-catalog-stat' }, '已满级')
        : el('button', {
          class: 'btn btn-primary',
          type: 'button',
          disabled: meta.points < cost,
          onClick: () => {
            if (upgradeTalent(talent.id).ok) {
              scheduleUpload();
              open('talents', back);
            }
          },
        }, `升级 · ${cost} 点`),
    ]);
  }

  // 强化图鉴顶部的玩家属性总览：基础值来自开局快照，当前值由各 buff 层数修正得到
  function baseStatsPanel() {
    const p = state.player;
    // 只在真正的对局中展示；开始页 / 结算页的 player 可能是上一局残留
    if (!p || !p.base || state.mode !== 'playing') return null;
    const b = p.base || p;
    const fmt = (v, digits = 0) => Number(Number(v).toFixed(digits));
    const rate = (interval) => `${(1 / interval).toFixed(2)}/s`;
    const rows = [
      ['❤️ 生命上限', fmt(b.maxHp), fmt(p.maxHp)],
      ['⚔️ 攻击力', fmt(b.atk, 1), fmt(p.atk, 1)],
      ['🛡️ 防御力', fmt(b.def), fmt(p.def)],
      ['👟 移速', fmt(b.speed), fmt(p.speed)],
      ['✨ 元素精通', fmt(b.em), fmt(p.em)],
      ['⏱️ 攻速', rate(b.attackInterval), rate(p.attackInterval)],
      ['🎯 弹丸', b.projectiles, p.projectiles],
      ['🏹 穿透', b.pierce, p.pierce],
      ['🧲 拾取', fmt(b.pickup), fmt(p.pickup)],
      ['🔵 护盾上限', fmt(b.maxHp * b.shieldPct), fmt(p.shieldMax)],
    ];
    return el('div', { class: 'sv-catalog-base' }, [
      el('div', { class: 'sv-catalog-base-title' }, '玩家基础属性 → 当前（子弹与 buff 都按基础值计算）'),
      el('div', { class: 'sv-catalog-base-grid' }, rows.map(([label, from, to]) => el('span', { class: 'sv-catalog-base-item' }, [
        el('span', { class: 'sv-catalog-base-label' }, label),
        el('span', { class: 'sv-catalog-base-from' }, ...highlightNumbers(String(from))),
        el('span', { class: 'sv-catalog-base-arrow' }, '→'),
        el('span', { class: 'sv-catalog-base-to' }, ...highlightNumbers(String(to))),
      ]))),
    ]);
  }

  function monsterCard(monster) {    const s = monster.stats || {};
    let unlock = '特殊召唤';
    if (monster.spawnable) unlock = monster.unlockAt ? `${formatTime(monster.unlockAt)} 后出现` : '开局出现';
    else if (monster.boss) unlock = `每 ${monster.spawnInterval} 秒出现`;
    const openDetail = () => openMonsterDetail(monster);
    return el('div', {
      class: 'sv-catalog-card sv-catalog-card--detail',
      role: 'button',
      tabIndex: 0,
      title: '查看详情',
      onClick: openDetail,
      onKeydown: (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        openDetail();
      },
    }, [
      el('div', { class: 'sv-catalog-card-head' }, [
        el('span', { class: 'sv-catalog-swatch', style: { background: s.color || '#94a3b8' } }),
        el('span', { class: 'sv-catalog-name' }, monster.name),
        el('span', { class: 'sv-catalog-tag' }, unlock),
      ]),
      el('p', { class: 'sv-catalog-desc' }, ...highlightNumbers(monster.desc)),
      el('div', { class: 'sv-catalog-stats' }, [
        el('span', { class: 'sv-catalog-stat' }, ...highlightNumbers(`❤ 生命 ${s.hp}`)),
        el('span', { class: 'sv-catalog-stat' }, ...highlightNumbers(`👣 速度 ${s.speed}`)),
        el('span', { class: 'sv-catalog-stat' }, ...highlightNumbers(`⚔ 伤害 ${s.dmg}`)),
        el('span', { class: 'sv-catalog-stat' }, ...highlightNumbers(`⭐ 经验 ${s.xp}`)),
      ]),
    ]);
  }

  function open(nextTab = 'buffs', nextBack) {
    tab = nextTab;
    back = nextBack;
    const isTalents = tab === 'talents';
    const isElements = tab === 'elements';
    const isMonsters = tab === 'monsters';
    const buffs = getBuffs();
    const elements = buffs.filter((b) => b.element);
    const reactionBuffs = buffs.filter((b) => b.reaction);
    const normalBuffs = buffs.filter((b) => !b.element && !b.reaction);
    const monsters = getMonsters();
    const items = isTalents
      ? TALENTS
      : (isMonsters ? monsters : (isElements ? elements : normalBuffs));
    const icon = isTalents ? '🌟' : (isMonsters ? '👾' : (isElements ? '⚛️' : '📖'));
    const title = isTalents ? '局外天赋' : (isMonsters ? '怪物图鉴' : (isElements ? '元素图鉴' : '强化图鉴'));
    let sub = `共 ${normalBuffs.length} 种强化 · 每张卡对应 buffs/ 下的一个文件`;
    if (isMonsters) sub = `共 ${monsters.length} 种怪物 · 数值为初始值，会随对局时间成长`;
    if (isElements) sub = `基础元素弹 ${elements.length} 种 · 反应 buff ${reactionBuffs.length} 种 · 元素反应 ${Object.values(REACTIONS).map((r) => r.name).join(' / ')}`;
    if (isTalents) sub = `可用天赋点 🌟${getMeta().points} · 每局结算发放，升级后下一局开局生效`;
    const cardList = (list) => el('div', { class: 'sv-catalog-grid' }, list.map((item) => {
      if (isTalents) return talentCard(item);
      return isMonsters ? monsterCard(item) : buffCard(item);
    }));
    showOverlay(el('div', { class: 'sv-panel sv-panel-catalog' }, [
      el('div', { class: 'sv-panel-icon' }, icon),
      el('h2', { class: 'sv-panel-title' }, title),
      el('p', { class: 'sv-panel-sub' }, sub),
      el('div', { class: 'sv-catalog-tabs' }, [
        tabBtn('talents', '🌟 天赋'),
        tabBtn('buffs', '📖 强化'),
        tabBtn('elements', '⚛️ 元素'),
        tabBtn('monsters', '👾 怪物'),
      ]),
      tab === 'buffs'
        ? el('div', { class: 'sv-catalog-buffs' }, [baseStatsPanel(), cardList(items)])
        : (isElements
          ? el('div', { class: 'sv-catalog-scroll' }, [
            el('p', { class: 'sv-catalog-sec' }, `基础元素弹 · ${elements.length} 种`),
            cardList(elements),
            el('p', { class: 'sv-catalog-sec' }, `反应 buff · ${reactionBuffs.length} 种`),
            reactionBuffs.length
              ? cardList(reactionBuffs)
              : el('p', { class: 'sv-catalog-desc' }, '同时拥有两种相关元素弹后，升级时会出现对应的反应强化。'),
          ])
          : cardList(items)),
      el('div', { class: 'sv-panel-actions' }, [
        el('button', { class: 'btn btn-secondary', type: 'button', onClick: close }, '返回'),
      ]),
    ]));
  }

  function close() {
    onClose();
    back();
  }

  return { open, close };
}
