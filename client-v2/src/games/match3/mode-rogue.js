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
 * 本模式**不做局内续存**：肉鸽一轮是一段连续的 run，刷新即视为放弃（无尽模式才需要续玩）。
 */
import { ROGUE, STORAGE_KEYS } from './config.js';
import { createBonus, floorOptions, goalOf, rollPerks } from './perks.js';
import { createMatch3Board } from './board.js';
import { createRng } from './rng.js';
import { showScoreDetails } from './scoreDetails.js';
import { estimateExp, onProgress, reportEnd, reportStart, requestProgress } from './sync.js';
import { el } from '../../utils/dom.js';
import { toast } from '../../components/toast.js';

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

/** 复制一份加成（specials 是嵌套对象，必须深拷贝一层） */
function cloneBonus(bonus) {
  return { ...bonus, specials: { ...bonus.specials } };
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
function bonusStats(bonus, floor) {
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
  return rows;
}

/** bonusStats → Map，便于按 key 比较「选祝福前 / 后」 */
function statsMap(bonus, floor) {
  return new Map(bonusStats(bonus, floor).map((row) => [row.key, row]));
}

/** 加成数据条（悬浮在棋盘上方，随祝福变化即时刷新） */
function renderStats(bonus, floor, title) {
  return el(
    'div',
    { class: 'm3-stats-block' },
    el('span', { class: 'm3-stats-title' }, title),
    el(
      'div',
      { class: 'm3-stats' },
      ...bonusStats(bonus, floor).map((row) =>
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
  let baseScore = 0;       // 本层之前的累计总分
  let maxCombo = 0;
  let totalMoves = 0;
  let totalCleared = 0;
  let shufflesLeft = 0;    // 本层剩余免费洗牌次数
  let startedAt = 0;
  let runRng = null;
  let floorCleared = false;
  let refreshExp = null;

  function disposeBoard() {
    if (board) {
      board.destroy();
      board = null;
    }
  }

  function teardown() {
    refreshExp = null;
    disposeBoard();
  }

  /** 本层已得分（board 每层重建，所以棋盘上的分数就是本层分数） */
  function floorScore() {
    return board ? board.getState().score : 0;
  }

  function totalScore() {
    return baseScore + floorScore();
  }

  // ---- 开新一轮 ----
  function startRun() {
    teardown();
    finished = false;
    bonus = createBonus();
    picks = {};
    pickedPerks = [];
    floor = 1;
    baseScore = 0;
    maxCombo = 0;
    totalMoves = 0;
    totalCleared = 0;
    startedAt = Date.now();
    runRng = createRng(Date.now() % 2147483647);
    reportStart({ mode: ROGUE.type });
    mountFloor();
  }

  // ---- 层内对局 ----
  function mountFloor() {
    disposeBoard();
    floorCleared = false;
    const goal = goalOf(floor, bonus);
    const opts = floorOptions(bonus, floor);
    shufflesLeft = bonus.shuffles;

    const floorEl = el('span', { class: 'm3-hud-value' }, `第 ${floor} 层`);
    const goalEl = el('span', { class: 'm3-hud-value' }, String(goal));
    const progressEl = el('span', { class: 'm3-hud-value' }, '0');
    const movesEl = el('span', { class: 'm3-hud-value' }, String(opts.moves));
    const scoreEl = el('span', { class: 'm3-hud-value' }, String(baseScore));
    const comboEl = el('span', { class: 'm3-hud-value' }, String(maxCombo));
    const expEl = el('span', { class: 'm3-hud-value' }, '—');
    const expItem = el('span', { class: 'm3-hud-item m3-hidden' }, '预计经验', expEl);
    const goalChip = el('span', { class: 'm3-goal' }, '本层得分 ', progressEl, ' / ', goalEl);

    const hud = el(
      'div',
      { class: 'm3-hud' },
      el('span', { class: 'm3-hud-item' }, '层数', floorEl),
      el('span', { class: 'm3-hud-item' }, '步数', movesEl),
      el('span', { class: 'm3-hud-item' }, '总分', scoreEl),
      el('span', { class: 'm3-hud-item' }, '最高连锁', comboEl),
      expItem,
    );

    const shuffleBtn = bonus.shuffles > 0
      ? el(
        'button',
        { class: 'm3-btn m3-btn--ghost', onClick: () => onShuffle() },
        `免费洗牌 ×${shufflesLeft}`,
      )
      : null;

    const actions = el(
      'div',
      { class: 'm3-actions' },
      shuffleBtn,
      el(
        'button',
        { class: 'm3-btn m3-btn--ghost', onClick: () => showScoreDetails(board ? board.getState() : {}) },
        '积分详情',
      ),
      el('button', { class: 'm3-btn m3-btn--ghost', onClick: () => onExit() }, '返回选择'),
    );

    const host = el('div', { class: 'm3-board-host' });
    const perkStrip = renderPerkStrip();
    // 数据面板单独留引用：免死消耗后要就地刷新（层内唯一会变的加成）
    let statsEl = renderStats(bonus, floor, '本轮加成');
    const paintStats = () => {
      const next = renderStats(bonus, floor, '本轮加成');
      statsEl.replaceWith(next);
      statsEl = next;
    };

    container.replaceChildren(
      el(
        'div',
        { class: 'm3-head' },
        el('h2', { class: 'm3-title' }, '🎲 肉鸽试炼'),
        el('p', { class: 'm3-sub' }, '限步冲层 · 每层三选一祝福'),
      ),
      hud,
      el('div', { class: 'm3-goals' }, goalChip),
      statsEl,
      perkStrip,
      host,
      actions,
    );

    /** 预计经验：按本轮累计总分估算（奖励配置未下发时整项隐藏） */
    function paintExp() {
      const exp = estimateExp({ mode: ROGUE.type, score: totalScore() });
      expItem.classList.toggle('m3-hidden', exp == null);
      if (exp != null) {
        expEl.textContent = `+${exp}`;
        expItem.title = '基础 + 分数换算（以服务端结算为准）';
      }
    }

    function onUpdate(info) {
      progressEl.textContent = String(info.score);
      movesEl.textContent = String(info.movesLeft);
      scoreEl.textContent = String(baseScore + info.score);
      comboEl.textContent = String(Math.max(maxCombo, info.maxCascade));
      goalChip.classList.toggle('m3-goal--done', info.score >= goal);
      paintExp();

      if (!floorCleared && info.score >= goal) onFloorCleared();
    }

    function onGameOver(info) {
      if (finished || floorCleared || info.score >= goal) return;
      if (bonus.shields > 0) {
        bonus.shields -= 1;
        toast.info(`🛡 免死金牌生效，补 ${ROGUE.shieldMoves} 步`);
        board.addMoves(ROGUE.shieldMoves);
        paintStats();
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

    board = createMatch3Board(host, {
      payload: { ...opts, id: null },
      seed: Date.now() % 2147483647,
      onUpdate,
      onGameOver,
    });

    paintExp();
    refreshExp = paintExp;
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
          { class: 'm3-perks-chip', title: `${perk.name}：${perk.desc}` },
          `${perk.icon}${perk.name}${n > 1 ? ` ×${n}` : ''}`,
        )),
    );
  }

  // ---- 过关：三选一祝福 ----
  function onFloorCleared() {
    floorCleared = true;
    board.lock(); // 达标即锁盘，本层不再消耗步数
    const info = board.getState();
    baseScore += info.score;
    maxCombo = Math.max(maxCombo, info.maxCascade);
    totalMoves += info.moves;
    totalCleared += info.cleared;

    const offered = rollPerks(runRng, picks);
    if (offered.length === 0) {
      // 祝福全部叠满：没有可选项就不再打断节奏，直接进下一层
      floor += 1;
      mountFloor();
      return;
    }
    renderPerkChoice(offered);
  }

  /** 选中某祝福后，下一层相对本层的数值变化（本层 → 下一层的实际值，含层数成长） */
  function perkDelta(perk) {
    const before = statsMap(bonus, floor);
    const preview = cloneBonus(bonus);
    perk.apply(preview);
    const after = statsMap(preview, floor + 1);
    const lines = [];
    for (const [key, row] of after) {
      const prev = before.get(key);
      if (!prev) lines.push(`${row.label} ${row.value}`);
      else if (prev.value !== row.value) lines.push(`${row.label} ${prev.value} → ${row.value}`);
    }
    return lines;
  }

  function renderPerkChoice(offered) {
    const cards = offered.map((perk) => {
      const owned = picks[perk.id] || 0;
      return el(
        'button',
        { class: 'm3-perk', onClick: () => choosePerk(perk) },
        el('span', { class: 'm3-perk-icon' }, perk.icon),
        el('span', { class: 'm3-perk-name' }, perk.name),
        el('span', { class: 'm3-perk-desc' }, perk.desc),
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
    });

    container.replaceChildren(
      el(
        'div',
        { class: 'm3-head' },
        el('h2', { class: 'm3-title' }, '🎁 选择祝福'),
        el('p', { class: 'm3-sub' }, `第 ${floor} 层达成 · 累计 ${baseScore} 分`),
      ),
      renderStats(bonus, floor, '当前加成（对照卡片上「下一层」的变化）'),
      el('div', { class: 'm3-perks' }, ...cards),
      el(
        'div',
        { class: 'm3-actions' },
        el('button', { class: 'm3-btn m3-btn--ghost', onClick: () => onExit() }, '返回选择'),
      ),
    );
  }

  function choosePerk(perk) {
    picks[perk.id] = (picks[perk.id] || 0) + 1;
    pickedPerks.push(perk);
    perk.apply(bonus);
    floor += 1;
    mountFloor();
  }

  // ---- 本轮结束 ----
  function finishRun() {
    if (finished || !board) return;
    finished = true;
    const info = board.getState();
    const score = baseScore + info.score;
    const durationMs = Date.now() - startedAt;
    maxCombo = Math.max(maxCombo, info.maxCascade);
    totalMoves += info.moves;
    totalCleared += info.cleared;
    board.lock();

    reportEnd({
      mode: ROGUE.type,
      floor,
      score,
      maxCombo,
      moves: totalMoves,
      durationMs,
      cleared: totalCleared,
      stars: 0,
    });

    const before = loadRogueBest();
    writeStore(STORAGE_KEYS.rogueBest, {
      maxFloor: Math.max(before.maxFloor, floor),
      highScore: Math.max(before.highScore, score),
    });
    if (floor > before.maxFloor) toast.success(`新的最深记录：第 ${floor} 层！`);
    else if (score > before.highScore) toast.success('新的最高总分！');

    container.replaceChildren(
      el(
        'div',
        { class: 'm3-head' },
        el('h2', { class: 'm3-title' }, '💀 本轮结束'),
        el('p', { class: 'm3-sub' }, `步数耗尽，止步第 ${floor} 层`),
      ),
      el(
        'div',
        { class: 'm3-result m3-result--inline' },
        el('div', { class: 'm3-result-title' }, `到达第 ${floor} 层`),
        el('div', { class: 'm3-result-line' }, `本轮总分 ${score} · 最高连锁 ${maxCombo}`),
        el('div', { class: 'm3-result-line' }, `累计消除 ${totalCleared} 个 · 用时 ${formatDuration(durationMs)}`),
        el('div', { class: 'm3-result-line' }, `祝福 ${pickedPerks.length} 张`),
        renderPerkStrip(),
        el(
          'div',
          { class: 'm3-result-line' },
          `历史最佳 第 ${Math.max(before.maxFloor, floor)} 层 · ${Math.max(before.highScore, score)} 分`,
        ),
        renderStats(bonus, floor, '终局参数（未达标那一层的开局数值）'),
      ),
      el(
        'div',
        { class: 'm3-actions' },
        el('button', { class: 'm3-btn', onClick: () => startRun() }, '再来一轮'),
        el(
          'button',
          {
            class: 'm3-btn m3-btn--ghost',
            onClick: () => showScoreDetails(info),
          },
          '积分详情',
        ),
        el('button', { class: 'm3-btn m3-btn--ghost', onClick: () => onExit() }, '返回选择'),
      ),
    );
  }

  startRun();

  // 拉取服务端最佳成绩（合并后本地记录才是准的）；奖励配置到达后补显预计经验
  const offProgress = onProgress(() => refreshExp?.());
  requestProgress();

  return () => {
    offProgress();
    teardown();
  };
}
