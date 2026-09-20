/**
 * 闯关模式（开发方案 4.1 / 4.4 / 8）
 *
 * - 步数制：每关固定步数，用完即结算
 * - 三类目标：得分达标 / 收集指定颜色 / 清除障碍
 * - 目标全部达成不自动结算：此刻锁定星级（按达成时的剩余步数），
 *   剩余步数可以继续用出去刷分，也可以随时点「提前结算」收下成绩
 * - 星级：通关后按「达成目标那一刻」的剩余步数占比给 2 / 3 星（阈值在 config.js 的 STAR_RULES）
 *
 * 进度：localStorage 的 match3Progress = { maxLevel, stars: { 关号: 星数 } }
 * 服务端只做存档 / 经验 / 榜单，进度按「服务端为准 + 本地 max 合并」同步（开发方案 5.4）
 */
import { COLOR_NAMES, STAR_RULES, STORAGE_KEYS } from './config.js';
import { CHAPTERS, LEVEL_COUNT, getLevel, levelsOfChapter } from './levels.js';
import { createMatch3Board } from './board.js';
import { showScoreDetails } from './scoreDetails.js';
import { onProgress, reportEnd, reportStart, requestProgress } from './sync.js';
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
    // 隐私模式 / 容量满：进度存不下不影响本局
  }
}

/** 本地闯关进度 { maxLevel, stars } */
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

/** 记录通关：解锁下一关 + 星级取历史最好 */
function recordClear(levelId, stars) {
  const progress = loadProgress();
  const next = {
    maxLevel: Math.max(progress.maxLevel, Math.min(levelId + 1, LEVEL_COUNT)),
    stars: { ...progress.stars, [levelId]: Math.max(progress.stars[levelId] || 0, stars) },
  };
  writeStore(STORAGE_KEYS.progress, next);
  return next;
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

  function disposeBoard() {
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
    const cascadeEl = el('span', { class: 'm3-hud-value' }, '0');
    const movesEl = el('span', { class: 'm3-hud-value' }, String(level.moves));
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
        el('span', { class: 'm3-hud-item' }, '最高连锁', cascadeEl),
        el('span', { class: 'm3-hud-item' }, '剩余步数', movesEl),
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

    /** 目标全部达成：锁定星级、开放「提前结算」，但**不**结束对局 */
    function markAchieved(info) {
      achieved = true;
      achievedMovesLeft = info.movesLeft;
      const stars = starsFor(level, achievedMovesLeft);
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
      if (success) recordClear(level.id, stars);
      const nextLevel = success ? getLevel(level.id + 1) : null;

      reportEnd({
        mode: 'level',
        level: level.id,
        score: info.score,
        maxCombo: info.maxCascade,
        moves: info.moves,
        durationMs: Date.now() - startedAt,
        cleared: info.cleared,
        stars,
      });

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
              ? el('button', { class: 'm3-btn', onClick: () => renderPlay(nextLevel) }, '下一关')
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
      onUpdate(info) {
        scoreEl.textContent = String(info.score);
        cascadeEl.textContent = String(info.maxCascade);
        movesEl.textContent = String(Math.max(0, info.movesLeft));
        paintGoals(info);
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
  }

  renderList();

  // 拉取服务端进度：到达后合并进本地存档，并刷新列表（对局中不打断）
  const offProgress = onProgress(() => {
    if (viewing === 'list') renderList();
  });
  requestProgress();

  return () => {
    offProgress();
    disposeBoard();
    container.replaceChildren();
  };
}
