/**
 * 围棋联机对局控制器（任务 3.1.3）
 * 匹配成功后进入对局房间：
 * - 落子同步：本地 tryPlace 提子后 emit('move', { r, c, game: 'go' })，订阅 game:move 本地提子渲染对手落子
 * - 提子/自杀/打劫在客户端本地处理（服务端 executeGoMove 只落子，checkGoWin 恒 false，与 v1 一致）
 * - 终局：棋盘填满 ≥95% 或双方均无合法手 → game_result { result:'win', reason:'棋盘填满' }（v1 同款）
 * - 认输：game_result { result:'resign' }（服务端无 resign 事件，走 handleGameResult，与五子棋一致）
 *
 * 协议与 v1 一致（见附录 A）：
 * - 匹配成功 match_success → { gameId, opponentId, color }（color: 1 黑 / 2 白）
 * - 落子 socket.emit('move', { r, c, game: 'go' })；服务端转发对手 move 事件（含 from/color）
 * - 游戏结束服务端广播 game_ended → { gameId, result, winner, reason, ... }
 */
import { createBoard, BLACK, WHITE, EMPTY } from './board.js';
import { tryPlace, countScore } from './rules.js';
import { emit } from '../../core/socket.js';
import { eventBus } from '../../core/eventBus.js';
import { el } from '../../utils/dom.js';
import { toast } from '../../components/toast.js';
import { modal } from '../../components/modal.js';
import { go } from '../../core/router.js';

let activeMatch = null;

/** 当前是否有进行中的对局 */
export function isMatchActive() {
  return !!activeMatch;
}

/** 当前账号 ID（与 v1 一致：localStorage currentAccountId） */
function currentAccountId() {
  return localStorage.getItem('currentAccountId');
}

/**
 * 开始围棋联机对局（匹配成功时调用）
 * @param {HTMLElement} container - 内容容器（#view-root）
 * @param {{ gameId: string, opponentId: string|number, color: number, opponentNickname?: string }} matchData
 * @returns {Object} 对局句柄（含 cleanup）
 */
export function startMatch(container, matchData) {
  cleanupMatch(); // 清理旧对局

  const { gameId, opponentId, color, opponentNickname, opponentName } = matchData;
  const me = color === WHITE ? WHITE : BLACK; // 1 黑 / 2 白
  let gameOver = false;
  let gameStart = Date.now();
  let timerHandle = null;
  let koPosition = null; // 打劫位置
  let koColor = null;    // 被禁落子方（被提子颜色，与 v1 gameState.koColor 一致）

  // ---- 信息栏 ----
  const turnEl = el('span', { class: 'go-info-tag' });
  const oppEl = el('span', { class: 'go-info-tag' });
  const timerEl = el('span', { class: 'go-info-tag' });
  const resignBtn = el('button', { class: 'btn btn-secondary', style: 'padding:4px 12px;font-size:13px;' }, '🏳️ 认输');
  const leaveBtn = el('button', { class: 'btn btn-secondary', style: 'margin-left:auto;padding:4px 12px;font-size:13px;' }, '返回大厅');

  function updateTurn() {
    const name = board.turn === BLACK ? '黑棋' : '白棋';
    const mine = board.turn === me;
    turnEl.textContent = mine ? `● 我的回合（${name}）` : `○ 对方回合（${name}）`;
    turnEl.style.color = mine ? 'var(--theme-accent)' : 'inherit';
    turnEl.style.fontWeight = mine ? 'bold' : 'normal';
  }

  function updateTimer() {
    const s = Math.floor((Date.now() - gameStart) / 1000);
    timerEl.textContent = `⏱ ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  oppEl.textContent = `👤 对手：${opponentNickname || opponentName || opponentId || '未知'}`;

  /** 打劫检查（与 v1 isKo 一致：上一手只提一子形成的劫位，对方不能立即回提） */
  function isKo(r, c, color) {
    return !!(koPosition && koPosition.r === r && koPosition.c === c && koColor === color);
  }

  /** 落子流程（自己与对手共用）：打劫检查 → tryPlace（落子+提对方+自杀检查）→ 增量渲染 → 更新劫位 */
  function applyMove(r, c, color) {
    if (isKo(r, c, color)) return { ok: false, ko: true };
    const res = tryPlace(board.board, r, c, color);
    if (!res.ok) return { ok: false, suicide: true };

    res.captured.forEach((s) => board.removeStone(s.r, s.c));
    board.place(r, c, color);

    if (res.captured.length === 1) {
      koPosition = { r: res.captured[0].r, c: res.captured[0].c };
      koColor = 3 - color;
    } else {
      koPosition = null;
      koColor = null;
    }
    return { ok: true, captured: res.captured };
  }

  // ---- 棋盘（对局模式：onPlace 由控制器接管）----
  const boardEl = document.createElement('div');
  const board = createBoard(boardEl, {
    onPlace: (r, c) => {
      if (gameOver) return;
      if (board.turn !== me) { toast.warn('还没轮到你落子'); return; }
      const mv = applyMove(r, c, me);
      if (!mv.ok) {
        if (mv.ko) toast.warn('❌ 打劫，不能立即回提');
        else toast.warn('该位置无法落子（自杀或已占用）');
        return;
      }
      emit('move', { r, c, game: 'go' }); // 发送落子
      board.turn = 3 - me; // 切换到对方回合
      updateTurn();
      if (mv.captured.length > 0) toast.info(`⚫⚪ 提子 ${mv.captured.length} 颗`);
      checkGoEnd();
    },
  });
  board.turn = BLACK; // 黑先（服务端约定 1 黑先行）

  container.innerHTML = '';
  container.append(infoBar(), boardEl);

  function infoBar() {
    const bar = el('div', {
      class: 'go-match-info',
      style: 'display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:10px;max-width:762px;width:100%;',
    }, [turnEl, oppEl, timerEl, resignBtn, leaveBtn]);
    return bar;
  }

  // ---- 终局判定（与 v1 checkGoWin 一致：填满 ≥95% 或双方均无合法手）----
  function hasValidMove(color) {
    for (let r = 0; r < board.size; r++) {
      for (let c = 0; c < board.size; c++) {
        if (board.board[r][c] === EMPTY && tryPlace(board.board, r, c, color).ok) {
          return true; // tryPlace 不可变，不污染当前棋盘
        }
      }
    }
    return false;
  }

  function checkGoEnd() {
    let filled = 0;
    for (let r = 0; r < board.size; r++) {
      for (let c = 0; c < board.size; c++) {
        if (board.board[r][c] !== EMPTY) filled++;
      }
    }
    if (filled >= board.size * board.size * 0.95) return finishGo('win');
    if (!hasValidMove(BLACK) && !hasValidMove(WHITE)) return finishGo('win');
  }

  function finishGo(result) {
    if (gameOver) return;
    gameOver = true;
    if (timerHandle) clearInterval(timerHandle);
    emit('game_result', { result, reason: '棋盘填满' });
    toast.success('棋盘已满/无合法落子！等待结果确认…');
    showScoreModal(); // 本地点目展示（复刻 v1 showGameResult）
  }

  /** 点目弹窗（复刻 v1 showGameResult：黑/白分数、子数、领地、贴目 7.5、胜负差） */
  function showScoreModal() {
    const score = countScore(board.board);
    const winner = score.black > score.white ? '黑棋' : '白棋';
    const diff = Math.abs(score.black - score.white).toFixed(1);

    const card = (name, total, stones, terr, komiText, dark) => {
      const style = dark
        ? 'background:#212529;color:#fff;padding:12px 16px;border-radius:8px;flex:1;text-align:center;'
        : 'background:#fff;color:#212529;padding:12px 16px;border-radius:8px;border:2px solid #ced4da;flex:1;text-align:center;';
      return el('div', { style }, [
        el('div', { style: 'font-size:15px;font-weight:bold;' }, name),
        el('div', { style: 'font-size:28px;font-weight:bold;margin:6px 0;' }, total.toFixed(1)),
        el('div', { style: 'font-size:13px;opacity:.85;' }, `子数：${stones}`),
        el('div', { style: 'font-size:13px;opacity:.85;' }, `领地：${terr.toFixed(1)}`),
        ...(komiText ? [el('div', { style: 'font-size:12px;opacity:.7;margin-top:4px;' }, komiText)] : []),
      ]);
    };

    const content = el('div', { style: 'text-align:center;' }, [
      el('h2', { style: 'margin:0 0 14px;' }, `${winner}获胜！`),
      el('div', { style: 'display:flex;gap:12px;margin-bottom:14px;' }, [
        card('黑棋', score.black, score.blackStones, score.black - score.blackStones, null, true),
        card('白棋', score.white, score.whiteStones, score.white - score.whiteStones, '贴目：7.5', false),
      ]),
      el('div', { style: 'font-size:16px;font-weight:bold;' }, `胜负差：${diff}子`),
    ]);

    modal.show({
      title: '🏁 游戏结束 - 数子结果',
      content,
      confirmText: '返回大厅',
      showCancel: false,
      onConfirm: () => {
        // 通知服务端释放用户状态（否则停留 playing，无法再次匹配）
        emit('return_lobby');
        go('lobby');
      },
    });
  }

  // ---- socket 事件 ----
  const offs = [];

  // 对手落子
  offs.push(eventBus.on('game:move', (data) => {
    if (gameOver) return;
    if (data.game && data.game !== 'go') return;
    if (data.from != null && String(data.from) === String(currentAccountId())) return; // 防御性过滤
    if (data.r == null || data.c == null) return;
    if (board.board[data.r]?.[data.c] !== EMPTY) return; // 位置已占用（服务端只落子，双方本地提子应一致）

    const color = data.color === WHITE ? WHITE : BLACK;
    const mv = applyMove(data.r, data.c, color);
    if (!mv.ok) return; // 对方合法落子理论上不应出现，防御性跳过
    board.turn = me; // 轮到我了
    updateTurn();
    if (mv.captured.length > 0) toast.info(`⚫⚪ 对方提子 ${mv.captured.length} 颗`);
    checkGoEnd();
  }));

  // 游戏结束
  offs.push(eventBus.on('game:ended', (data) => {
    if (gameId != null && data.gameId != null && String(data.gameId) !== String(gameId)) return;
    if (gameOver) return;
    gameOver = true;
    if (timerHandle) clearInterval(timerHandle);

    const myId = currentAccountId();
    let msg;
    if (data.result === 'win') {
      msg = String(data.winner) === String(myId) ? '🎉 你获胜了！' : '😢 你输了！';
    } else if (data.result === 'draw') {
      msg = '🤝 平局！';
    } else if (data.result === 'resign') {
      msg = String(data.winner) === String(myId) ? '🎉 对方认输，你获胜了！' : '😢 你认输了！';
    } else if (data.result === 'timeout') {
      msg = '⏰ 游戏超时！';
    } else {
      msg = '🛑 游戏已结束';
    }

    modal.show({
      title: '游戏结束',
      content: msg,
      confirmText: '返回大厅',
      showCancel: false,
      onConfirm: () => {
        // 通知服务端释放用户状态（否则停留 playing，无法再次匹配）
        emit('return_lobby');
        go('lobby');
      },
    });
  }));

  // 对手离开
  offs.push(eventBus.on('lobby:opponentLeft', (data) => {
    if (gameOver) return;
    gameOver = true;
    if (timerHandle) clearInterval(timerHandle);
    const reason = data?.reason;
    const msg = reason === 'resign'
      ? '🎉 对方已认输，你获胜了！'
      : (data?.nickname ? `对方（${data.nickname}）已离开游戏` : '对方已离开游戏');
    modal.show({
      title: '游戏结束',
      content: msg,
      confirmText: '返回大厅',
      showCancel: false,
      onConfirm: () => {
        emit('return_lobby');
        go('lobby');
      },
    });
  }));

  // 认输（与五子棋一致：服务端无 resign 事件，走 game_result）
  resignBtn.addEventListener('click', () => {
    if (gameOver) { toast.warn('游戏已结束'); return; }
    modal.show({
      title: '认输',
      content: '确定要认输吗？',
      confirmText: '认输',
      showCancel: true,
      onConfirm: () => {
        emit('game_result', { result: 'resign', reason: '主动认输' });
        toast.info('🏳️ 已认输，等待结果…');
      },
    });
  });

  // 返回大厅
  leaveBtn.addEventListener('click', () => {
    if (gameOver) { emit('return_lobby'); go('lobby'); return; }
    modal.show({
      title: '返回大厅',
      content: '确定要退出当前对局吗？',
      confirmText: '退出',
      showCancel: true,
      onConfirm: () => {
        emit('return_lobby');
        go('lobby');
      },
    });
  });

  // 启动计时器
  updateTurn();
  updateTimer();
  timerHandle = setInterval(updateTimer, 1000);

  activeMatch = {
    container,
    board,
    gameId,
    opponentId,
    me,
    get gameOver() { return gameOver; },
    cleanup() {
      offs.forEach((off) => off());
      if (timerHandle) clearInterval(timerHandle);
      container.innerHTML = '';
      board.destroy();
    },
  };

  return activeMatch;
}

/** 清理当前对局（含切换视图/重新匹配时） */
export function cleanupMatch() {
  if (activeMatch) {
    activeMatch.cleanup();
    activeMatch = null;
  }
}
