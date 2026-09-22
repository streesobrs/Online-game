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
import { COLOR_NAMES, ROGUE, STORAGE_KEYS } from './config.js';
import { PERKS, QUEST_REWARDS, createBonus, floorOptions, goalOf, questFor, rollPerks } from './perks.js';
import { createMatch3Board } from './board.js';
import { createRng } from './rng.js';
import { showScoreDetails } from './scoreDetails.js';
import {
  estimateExp, finishedSession, loadLocalSession, onProgress, pushSession,
  reportEnd, reportStart, requestProgress, saveLocalSession,
} from './sync.js';
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
  // 同色磁石：锁色前（三选一卡片上的预览）显示为「随机一色」
  if (bonus.weightMult > 1) {
    const name = bonus.weightColor > 0 ? `${COLOR_NAMES[bonus.weightColor]}色` : '随机一色';
    rows.push({ key: 'magnet', label: '同色磁石', value: `${name} ×${bonus.weightMult}` });
  }
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
  let elapsedMs = 0;       // 已累计的游玩时长（本轮之前的），配合 startedAt 得到总时长
  let runRng = null;
  let floorCleared = false;
  let refreshExp = null;
  let quest = null;        // 本层局内任务（perks.js 的 questFor），只在当层有效
  let perkModal = null;    // 三选一的模态框（盖在已达标的盘面上，见 renderPerkChoice）

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

  function teardown() {
    refreshExp = null;
    closePerkModal();
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
   * @param {'floor'|'perk'} phase floor=层内对局中；perk=本层已达标、正在三选一
   * @param {Array} [offered] phase=perk 的三个候选（存 id，恢复时不重掷）
   */
  function toSession(phase, offered) {
    return {
      mode: ROGUE.type,
      phase,
      floor,
      bonus: { ...bonus, specials: { ...bonus.specials } },
      picks: { ...picks },
      baseScore,
      maxCombo,
      totalMoves,
      totalCleared,
      runRngState: runRng ? runRng.getState() : null,
      elapsedMs: runElapsed(),
      shufflesLeft,
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
      // phase=perk 也要存盘面：三选一是模态框，背后要摆出刚达标那一层（锁住不再消耗步数）
      board: board ? board.getSnapshot() : null,
      ts: Date.now(),
    };
  }

  /**
   * 落一次暂存：本地每次都写（刷新即续），云端按节流推
   * @param {'floor'|'perk'} phase
   * @param {Array} [offered]
   * @param {boolean} [force] 换层 / 三选一这类关键节点立即推云，不等节流
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
    finished = false;
    bonus = createBonus();
    picks = {};
    pickedPerks = [];
    floor = 1;
    baseScore = 0;
    maxCombo = 0;
    totalMoves = 0;
    totalCleared = 0;
    elapsedMs = 0;
    startedAt = Date.now();
    runRng = createRng(Date.now() % 2147483647);
    reportStart({ mode: ROGUE.type });
    mountFloor();
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
    baseScore = session.baseScore || 0;
    maxCombo = session.maxCombo || 0;
    totalMoves = session.totalMoves || 0;
    totalCleared = session.totalCleared || 0;
    shufflesLeft = session.shufflesLeft || 0;
    elapsedMs = session.elapsedMs || 0;
    startedAt = Date.now();
    runRng = createRng(1);
    if (Number.isFinite(session.runRngState)) runRng.setState(session.runRngState);

    reportStart({ mode: ROGUE.type });
    toast.info(`🎲 继续上一轮：第 ${floor} 层`);

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

  // ---- 层内对局 ----
  /**
   * @param {object} [restore] 层内暂存（续玩时传入）：本层棋盘、任务进度、剩余洗牌都从它还原
   */
  function mountFloor(restore = null) {
    disposeBoard();
    floorCleared = false;
    const goal = goalOf(floor, bonus);
    const opts = floorOptions(bonus, floor);
    shufflesLeft = restore ? (restore.shufflesLeft || 0) : bonus.shuffles;
    // 续玩时不重掷任务：重掷会白吃一次随机序列，进度也对不上存档
    quest = restore ? restoreQuest(restore.quest) : questFor(floor, bonus, runRng);

    const floorEl = el('span', { class: 'm3-side-value' }, `第 ${floor} 层`);
    const goalEl = el('span', { class: 'm3-side-value' }, String(goal));
    const progressEl = el('span', { class: 'm3-side-value' }, '0');
    const movesEl = el('span', { class: 'm3-side-value' }, String(opts.moves));
    // 达标进度条：得分与目标拆成两行后，两者的关系靠这条显示
    const goalFill = el('span', { class: 'm3-goalbar-fill' });
    const goalBarEl = el('span', { class: 'm3-goalbar' }, goalFill);
    const goalPctEl = el('span', { class: 'm3-side-pct' }, '0%');
    const scoreEl = el('span', { class: 'm3-hud-value' }, String(baseScore));
    const comboEl = el('span', { class: 'm3-hud-value' }, String(maxCombo));
    const expEl = el('span', { class: 'm3-hud-value' }, '—');
    const expItem = el('span', { class: 'm3-hud-item m3-hidden' }, '预计经验', expEl);
    const questEl = el('span', { class: 'm3-goal m3-quest' });

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

    /** 任务达成：奖励当场生效（加步 / 本层得分翻倍 / 就地注入特殊元素） */
    function grantQuestReward() {
      quest.done = true;
      quest.reward.apply(board, opts);
      paintQuest();
      toast.success(`${quest.reward.icon} 任务达成：${quest.reward.name} · ${quest.reward.desc}`);
    }

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
    const perkListEl = renderPerkList();
    // 数据面板单独留引用：免死消耗后要就地刷新（层内唯一会变的加成）
    let statsEl = renderStats(bonus, floor, '本轮加成');
    const paintStats = () => {
      const next = renderStats(bonus, floor, '本轮加成');
      statsEl.replaceWith(next);
      statsEl = next;
    };

    /** 侧栏一行：左标签 + 右数值（数值节点由外层持有，便于就地刷新） */
    const sideRow = (label, valueNode) => el(
      'div',
      { class: 'm3-side-row' },
      el('span', { class: 'm3-side-label' }, label),
      valueNode,
    );

    // 左侧数据面板：本层进度 / 本轮加成 / 已获祝福。
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
          sideRow('本层目标', goalEl),
          sideRow('剩余步数', movesEl),
        ),
        el('div', { class: 'm3-side-bar' }, goalBarEl, goalPctEl),
        questEl,
      ),
      statsEl,
      el(
        'div',
        { class: 'm3-side-block' },
        el('div', { class: 'm3-side-title' }, '已获祝福'),
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
        { class: 'm3-rogue-shell' },
        side,
        el(
          'div',
          { class: 'm3-main' },
          el(
            'div',
            { class: 'm3-head' },
            el('h2', { class: 'm3-title' }, '🎲 肉鸽试炼'),
            el('p', { class: 'm3-sub' }, '限冲层 · 每层三选一祝福'),
          ),
          hud,
          host,
          actions,
        ),
      ),
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

    /** 本层达标进度：进度条 + 百分比（达标后条与数字都转绿，和过关一致） */
    function paintGoal(score) {
      const pct = goal > 0 ? Math.min(100, (score / goal) * 100) : 0;
      const done = score >= goal;
      goalFill.style.width = `${pct}%`;
      goalPctEl.textContent = `${Math.floor(pct)}%`;
      goalBarEl.classList.toggle('m3-goalbar--done', done);
      goalPctEl.classList.toggle('m3-side-pct--done', done);
    }

    function onUpdate(info) {
      progressEl.textContent = String(info.score);
      movesEl.textContent = String(info.movesLeft);
      scoreEl.textContent = String(baseScore + info.score);
      comboEl.textContent = String(Math.max(maxCombo, info.maxCascade));
      paintGoal(info.score);
      paintExp();

      // 局内任务：进度取本层累计消除的各颜色数（新棋盘从 0 起算，无需另记基线）
      if (quest && !quest.done) {
        const got = info.collected[quest.color] || 0;
        if (got !== quest.progress) {
          quest.progress = got;
          paintQuest();
        }
        if (got >= quest.need) grantQuestReward();
      }

      if (!floorCleared && info.score >= goal) onFloorCleared();
      // 本层刚达标时，onFloorCleared 已经落下 phase='perk' 的暂存，这里不能再用 'floor' 覆盖它；
      // 局内任务奖励会改动棋盘（加步 / 注入特殊元素 / 改倍率），所以其余情况在最后统一落一次
      if (!floorCleared) persistSession('floor');
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

    // 续玩时用存档里的种子与棋盘快照：随机序列与局面都接着上次走
    const savedBoard = restore?.board || null;
    board = createMatch3Board(host, {
      payload: { ...opts, id: null },
      seed: savedBoard && Number.isFinite(savedBoard.seed) ? savedBoard.seed : Date.now() % 2147483647,
      snapshot: savedBoard,
      onUpdate,
      onGameOver,
    });

    // 续玩出来的局面要把侧栏与任务条按当前状态补画一遍（board 初始化不会回调 onUpdate）
    if (savedBoard) {
      const info = board.getState();
      progressEl.textContent = String(info.score);
      movesEl.textContent = String(info.movesLeft);
      scoreEl.textContent = String(baseScore + info.score);
      comboEl.textContent = String(Math.max(maxCombo, info.maxCascade));
      paintGoal(info.score);
      if (quest && !quest.done) quest.progress = info.collected[quest.color] || 0;
    } else {
      paintGoal(0); // 新一层：进度条归零，避免沿用上一层留下的宽度
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
          { class: 'm3-perks-chip', title: `${perk.name}：${perk.desc}` },
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
          { class: 'm3-side-perk', title: perk.desc },
          el('span', { class: 'm3-side-perk-icon' }, perk.icon),
          el('span', { class: 'm3-side-perk-name' }, perk.name),
          el('span', { class: 'm3-side-perk-count' }, `×${n}`),
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

  /** 三选一卡片（模态框内横排三张，窄屏由 CSS 折成竖排） */
  function perkCard(perk) {
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
  }

  /**
   * 层间三选一：以模态框盖在刚达标的那层盘面上（盘面已 lock，仍可见）
   *
   * 原来是整页替换 —— 界面被清空重排，玩家刚打完的盘面与左栏数据瞬间消失，
   * 选完又要重建一次。改成模态框后，背景保留当前局面，选完直接进下一层。
   */
  function renderPerkChoice(offered) {
    closePerkModal(); // 防重入：连点 / 重复 resume 都只留一层

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
          `累计 ${baseScore} 分 · 选中的祝福从第 ${floor + 1} 层开始生效`,
        ),
      ),
      el('div', { class: 'm3-perks' }, ...offered.map(perkCard)),
      el(
        'div',
        { class: 'm3-perk-dialog-foot' },
        el('span', { class: 'm3-perk-dialog-hint' }, '点卡片即选中，选完自动进入下一层'),
        el('button', { class: 'm3-btn m3-btn--ghost', onClick: () => onExit() }, '返回选择'),
      ),
    );

    perkModal = el('div', { class: 'm3-perk-modal' }, dialog);
    container.append(perkModal);

    // 三选一也是一次暂存点：刷新后回到同样的三个候选（而不是重掷一手），
    // 且存档里带上刚达标的盘面，续玩时模态框背后摆的是同一局
    persistSession('perk', offered, true);
  }

  function choosePerk(perk) {
    picks[perk.id] = (picks[perk.id] || 0) + 1;
    pickedPerks.push(perk);
    // 传 runRng 给需要入局随机的祝福（「同色磁石」用它锁定一种颜色）
    perk.apply(bonus, runRng);
    floor += 1;
    closePerkModal();
    mountFloor();
  }

  // ---- 本轮结束 ----
  function finishRun() {
    if (finished || !board) return;
    finished = true;
    const info = board.getState();
    const score = baseScore + info.score;
    const durationMs = runElapsed();
    maxCombo = Math.max(maxCombo, info.maxCascade);
    totalMoves += info.moves;
    totalCleared += info.cleared;
    board.lock();

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

  // 有未结算的一轮就直接接着打：刷新、换设备回来都落在同一个入口上
  // （云端那份由 mergeRemoteProgress 在收到服务端进度时并进本地，菜单上的续玩提示同源）
  const saved = loadLocalSession(ROGUE.type);
  if (saved) resumeRun(saved);
  else startRun();

  // 拉取服务端最佳成绩（合并后本地记录才是准的）；奖励配置到达后补显预计经验
  const offProgress = onProgress(() => refreshExp?.());
  requestProgress();

  return () => {
    offProgress();
    teardown();
  };
}
