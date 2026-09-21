/**
 * 闯关模式（开发方案 4.1 / 4.4 / 8）
 *
 * - 步数制：每关固定步数，用完即结算
 * - 三类目标：得分达标 / 收集指定颜色 / 清除障碍
 * - 目标全部达成不自动结算：此刻锁定星级（按达成时的剩余步数），
 *   剩余步数可以继续用出去刷分，也可以随时点「提前结算」收下成绩
 * - 星级：通关后按「达成目标那一刻」的剩余步数占比给 2 / 3 星（阈值在 config.js 的 STAR_RULES）
 *
 * 进度：服务端为唯一真相，match3_progress 下发后写入本地缓存
 * （match3Progress = { maxLevel, stars }，仅供离线时展示与解锁判断）。
 * 本地通关不再自行解锁下一关——服务端 maxLevel 才是解锁依据（开发方案 9.4），
 * 否则本地进度会跑在服务端前面，被判「跳关」后永远追不上。
 */
import { COLOR_NAMES, STAR_RULES, STORAGE_KEYS } from './config.js';
import { CHAPTERS, LEVEL_COUNT, getLevel, levelsOfChapter } from './levels.js';
import { createMatch3Board } from './board.js';
import { showScoreDetails } from './scoreDetails.js';
import {
  estimateExp,
  onProgress,
  onResult,
  reportEnd,
  reportStart,
  requestProgress,
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

/** 闯关进度缓存 { maxLevel, stars }，由服务端进度刷新 */
export function loadProgress() {
  const saved = readStore(STORAGE_KEYS.progress);
  return {
    maxLevel: saved?.maxLevel || 1,
    stars: saved?.stars && typeof saved.stars === 'object' ? saved.stars : {},
  };
}

/** 累计星数 */
export function totalStars(progress) {
  return Object.values(progress.stars).reduce((sum, n) => sum + n, 0);
}

/** 关卡是否解锁（第 1 关始终开放，其余要求上一关已通关） */
export function isUnlocked(levelId, progress) {
  return levelId <= Math.max(1, progress.maxLevel);
}

/** 通关后按剩余步数占比判星（开发方案 4.1） */
export function starsFor(level, movesLeft) {
  const ratio = level.moves > 0 ? movesLeft / level.moves : 0;
  if (ratio >= STAR_RULES.threeStarRemainRatio) return 3;
  if (ratio >= STAR_RULES.twoStarRemainRatio) return 2;
  return 1;
}

/** 目标文案 */
export function goalLabel(goal) {
  if (goal.type === 'score') return `得分达到 ${goal.target}`;
  if (goal.type === 'collect') return `收集 ${COLOR_NAMES[goal.color] || goal.color}色 ${goal.target} 个`;
  return `清除障碍 ${goal.target} 个`;
}

/** 目标当前进度（info 为 board 的 onUpdate 参数） */
export function goalProgress(level, info) {
  return level.goals.map((goal) => {
    if (goal.type === 'score') return { goal, current: info.score, done: info.score >= goal.target };
    if (goal.type === 'collect') {
      const current = info.collected[goal.color] || 0;
      return { goal, current, done: current >= goal.target };
    }
    return { goal, current: info.blockersCleared, done: info.blockersCleared >= goal.target };
  });
}

/**
 * 渲染闯关模式（关卡列表 → 对局）
 * @param {HTMLElement} container - 内容容器
 * @param {{onExit:Function}} options - onExit 返回模式选择
 * @returns {Function} cleanup 函数
 */
export function renderLevelMode(container, { onExit }) {
  let board = null;
  let viewing = 'list'; // 服务端进度到达时，只有停在列表才刷新，避免打断对局
  let refreshExp = null; // 对局中：奖励配置到达后重刷「预计经验」（列表态为 null）

  function disposeBoard() {
    refreshExp = null;
    if (board) {
      board.destroy();
      board = null;
    }
  }

  function head(title, sub) {
    return el(
      'div',
      { class: 'm3-head' },
      el('h2', { class: 'm3-title' }, title),
      el('p', { class: 'm3-sub' }, sub),
    );
  }

  // ---- 关卡列表（按章节分组的网格，开发方案 4.4）----
  function renderList() {
    viewing = 'list';
    disposeBoard();
    const progress = loadProgress();

    const sections = CHAPTERS.map((chapter) => {
      const levels = levelsOfChapter(chapter.id);
      const grid = el(
        'div',
        { class: 'm3-level-grid' },
        levels.map((level) => {
          const unlocked = isUnlocked(level.id, progress);
          const stars = progress.stars[level.id] || 0;
          return el(
            'button',
            {
              class: `m3-level${unlocked ? '' : ' m3-level--locked'}`,
              disabled: !unlocked,
              onClick: () => {
                if (unlocked) renderPlay(level);
              },
            },
            el('span', { class: 'm3-level-id' }, unlocked ? String(level.id) : '🔒'),
            el('span', { class: 'm3-level-name' }, level.name),
            el('span', { class: 'm3-level-stars' }, stars ? '★'.repeat(stars) : '☆'.repeat(3)),
          );
        }),
      );
      return el(
        'section',
        { class: 'm3-chapter' },
        el(
          'div',
          { class: 'm3-chapter-head' },
          el('span', { class: 'm3-chapter-name' }, chapter.name),
          el('span', { class: 'm3-chapter-desc' }, chapter.desc),
        ),
        grid,
      );
    });

    container.replaceChildren(
      head(
        '🍭 闯关模式',
        `已通关 ${Math.max(0, progress.maxLevel - 1)} / ${LEVEL_COUNT} 关 · 累计 ${totalStars(progress)} ★`,
      ),
      el('div', { class: 'm3-chapters' }, sections),
      el(
        'div',
        { class: 'm3-actions' },
        el('button', { class: 'm3-btn m3-btn--ghost', onClick: () => onExit() }, '返回选择'),
      ),
    );
  }

  // ---- 对局 ----
  function renderPlay(level) {
    viewing = 'play';
    disposeBoard();
    let finished = false;
    // 目标全部达成后不自动结算：记下达成那一刻的剩余步数（星级依据），
    // 剩余步数可以继续用出去刷分，也可以随时点「提前结算」
    let achieved = false;
    let achievedMovesLeft = 0;
    const startedAt = Date.now();
    reportStart({ mode: 'level', level: level.id });

    const scoreEl = el('span', { class: 'm3-hud-value' }, '0');
    const gainedEl = el('span', { class: 'm3-hud-value m3-hud-value--gain' }, '+0');
    const liveEl = el('span', { class: 'm3-hud-value m3-hud-value--combo' }, '—');
    const cascadeEl = el('span', { class: 'm3-hud-value' }, '0');
    const movesEl = el('span', { class: 'm3-hud-value' }, String(level.moves));
    const expEl = el('span', { class: 'm3-hud-value' }, '—');
    const expItem = el('span', { class: 'm3-hud-item m3-hidden' }, '预计经验', expEl);
    const goalList = el('div', { class: 'm3-goals' });
    const achievedEl = el('div', { class: 'm3-achieved m3-hidden' });
    const host = el('div', { class: 'm3-board-host' });

    const detailBtn = el(
      'button',
      {
        class: 'm3-btn m3-btn--ghost',
        onClick: () => showScoreDetails({ ...board.getState(), goals: level.goals }),
      },
      '积分详情',
    );
    const settleBtn = el(
      'button',
      {
        class: 'm3-btn m3-btn--settle',
        disabled: true,
        onClick: () => {
          if (achieved && !finished) showResult(true, board.getState());
        },
      },
      '提前结算',
    );

    container.replaceChildren(
      head(`${level.name}`, `第 ${level.id} 关 · ${level.rows}×${level.cols} · ${level.colors} 色`),
      el(
        'div',
        { class: 'm3-hud' },
        el('span', { class: 'm3-hud-item' }, '分数', scoreEl),
        el('span', { class: 'm3-hud-item' }, '本步得分', gainedEl),
        el('span', { class: 'm3-hud-item' }, '连消', liveEl),
        el('span', { class: 'm3-hud-item' }, '最高连锁', cascadeEl),
        el('span', { class: 'm3-hud-item' }, '剩余步数', movesEl),
        expItem,
      ),
      goalList,
      achievedEl,
      host,
      el(
        'div',
        { class: 'm3-actions' },
        settleBtn,
        detailBtn,
        el('button', { class: 'm3-btn m3-btn--ghost', onClick: () => renderPlay(level) }, '重开'),
        el('button', { class: 'm3-btn m3-btn--ghost', onClick: () => renderList() }, '返回列表'),
      ),
    );

    /** 目标进度条 */
    function paintGoals(info) {
      goalList.replaceChildren(
        ...goalProgress(level, info).map(({ goal, current, done }) =>
          el(
            'div',
            { class: `m3-goal${done ? ' m3-goal--done' : ''}` },
            el('span', { class: 'm3-goal-text' }, goalLabel(goal)),
            el(
              'span',
              { class: 'm3-goal-count' },
              `${Math.min(current, goal.target)} / ${goal.target}`,
            ),
          ),
        ),
      );
    }

    /** 预计经验：奖励配置由服务端下发，未获取到（未登录 / 离线）时整项隐藏 */
    function paintExp(info) {
      const stars = achieved ? starsFor(level, achievedMovesLeft) : 0;
      const exp = estimateExp({ mode: 'level', score: info.score, stars });
      expItem.classList.toggle('m3-hidden', exp == null);
      if (exp != null) {
        expEl.textContent = `+${exp}`;
        expItem.title = stars
          ? `基础 + 分数换算 + ${stars}★加成（以服务端结算为准）`
          : '基础 + 分数换算（星级加成在目标达成后计入，以服务端结算为准）';
      }
    }

    /** 目标全部达成：锁定星级、开放「提前结算」，但**不**结束对局 */
    function markAchieved(info) {
      achieved = true;
      achievedMovesLeft = info.movesLeft;
      const stars = starsFor(level, achievedMovesLeft);
      paintExp(info); // 星级已锁定，预计经验可以带上星级加成
      settleBtn.disabled = false;
      achievedEl.classList.remove('m3-hidden');
      achievedEl.replaceChildren(
        el(
          'span',
          { class: 'm3-achieved-title' },
          `✅ 目标达成 · 星级已锁定 ${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}`,
        ),
        el(
          'span',
          { class: 'm3-achieved-desc' },
          `剩余 ${info.movesLeft} 步可继续消除刷分，或点「提前结算」收下成绩`,
        ),
      );
      toast.success('目标达成！星级已锁定');
    }

    /** 结算浮层：success 为是否通关 */
    function showResult(success, info) {
      finished = true;
      settleBtn.disabled = true;
      board.lock();
      // 星级按「目标达成那一刻」的剩余步数算，达成后继续用掉的步数不再影响星级
      const stars = success ? starsFor(level, achieved ? achievedMovesLeft : info.movesLeft) : 0;
      const nextLevel = success ? getLevel(level.id + 1) : null;

      // 进度、经验、解锁都由服务端结算（match3:result），本地不自行推进
      const reported = reportEnd({
        mode: 'level',
        level: level.id,
        score: info.score,
        maxCombo: info.maxCascade,
        moves: info.moves,
        durationMs: Date.now() - startedAt,
        cleared: info.cleared,
        stars,
      });
      if (!reported) toast.info('未连接服务端，本局不计入进度与经验');

      host.appendChild(
        el(
          'div',
          { class: 'm3-result' },
          el('div', { class: 'm3-result-title' }, success ? '通关！' : '步数用尽'),
          el('div', { class: 'm3-result-stars' }, success ? '★'.repeat(stars) + '☆'.repeat(3 - stars) : ''),
          el('div', { class: 'm3-result-line' }, `得分 ${info.score} · 最高连锁 ${info.maxCascade}`),
          el(
            'div',
            { class: 'm3-result-line' },
            success
              ? `达成时剩余 ${achievedMovesLeft} 步（星级依据）· 共用 ${info.moves} 步`
              : `共用 ${info.moves} 步`,
          ),
          el(
            'div',
            { class: 'm3-actions' },
            success && nextLevel
              ? el(
                'button',
                {
                  class: 'm3-btn',
                  onClick: () => {
                    // 解锁以服务端结算为准：被反刷分拦下或未连接时进度不会前进，这里就不再放行
                    if (!isUnlocked(nextLevel.id, loadProgress())) {
                      toast.info('本局成绩未被服务端记录，下一关尚未解锁');
                      return;
                    }
                    renderPlay(nextLevel);
                  },
                },
                '下一关',
              )
              : null,
            el('button', { class: 'm3-btn', onClick: () => renderPlay(level) }, '再来一次'),
            el(
              'button',
              {
                class: 'm3-btn m3-btn--ghost',
                onClick: () => showScoreDetails({ ...info, goals: level.goals }),
              },
              '积分详情',
            ),
            el('button', { class: 'm3-btn m3-btn--ghost', onClick: () => renderList() }, '返回列表'),
          ),
        ),
      );
    }

    board = createMatch3Board(host, {
      payload: level,
      onStep({ cascade, gained }) {
        liveEl.textContent = `×${cascade}`;
        gainedEl.textContent = `+${gained}`;
      },
      onUpdate(info) {
        scoreEl.textContent = String(info.score);
        cascadeEl.textContent = String(info.maxCascade);
        movesEl.textContent = String(Math.max(0, info.movesLeft));
        if (info.gained != null) gainedEl.textContent = `+${info.gained}`;
        paintGoals(info);
        paintExp(info);
        if (info.shuffled) toast.info('无可消除，已自动洗牌');
        if (!finished && !achieved && goalProgress(level, info).every((item) => item.done)) {
          markAchieved(info);
        }
      },
      onGameOver(info) {
        if (!finished) showResult(achieved, info);
      },
    });

    paintGoals({ score: 0, collected: {}, blockersCleared: 0 });
    paintExp({ score: 0 });
    refreshExp = () => paintExp(board.getState());
  }

  renderList();

  // 拉取服务端进度：到达后写入本地缓存并刷新列表（对局中不打断）；奖励配置到达后补显预计经验
  const offProgress = onProgress(() => {
    if (viewing === 'list') renderList();
    else refreshExp?.();
  });
  // 结算回执：解锁与星数由服务端推进，回执到达后刷新列表（停在结算浮层时不动）
  const offResult = onResult(() => {
    if (viewing === 'list') renderList();
  });
  requestProgress();

  return () => {
    offProgress();
    offResult();
    disposeBoard();
    container.replaceChildren();
  };
}
