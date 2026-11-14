/**
 * 斗地主（3 人联机 + AI 补位）
 *
 * 与现有棋类大厅的关系：斗地主是 3 人房间制，走独立的 ddz_* 事件，
 * 不经过 GameManager 的 1v1 匹配，因此这里直接用 socket 监听。
 *
 * 流程：
 * 1. 进入页面 → 点「开始匹配」 → ddz_match_request
 * 2. 服务端凑满 3 人立即开局；等待 6 秒仍不足则由 AI 补位
 * 3. 叫地主 → 出牌/不出 → 一方出完手牌结算
 */
import { viewRoot, el } from '../../utils/dom.js';
import { socket, emit } from '../../core/socket.js';
import { toast } from '../../components/toast.js';
import { go } from '../../core/router.js';
import { eventBus } from '../../core/eventBus.js';
import { startGameActivity, stopGameActivity } from '../../core/activity.js';

let activeCleanup = null;

const TYPE_LABEL = {
  single: '单张', pair: '对子', triple: '三张', triple1: '三带一', triple2: '三带二',
  straight: '顺子', pairs: '连对', plane: '飞机', bomb: '炸弹', rocket: '王炸',
};

const DDZ_EVENTS = [
  'ddz_queued', 'ddz_cancelled', 'ddz_no_room', 'ddz_match_success', 'ddz_state',
  'ddz_error', 'ddz_game_over', 'ddz_left',
];

function cardEl(card, selectable, selected, onClick) {
  const node = el('button', {
    class: `ddz-card ${card.color === 'red' ? 'is-red' : ''} ${card.joker ? 'is-joker' : ''} ${selected ? 'is-selected' : ''}`,
    type: 'button',
    title: card.label,
  });
  node.innerHTML = `<span class="ddz-card-rank">${card.label}</span><span class="ddz-card-suit">${card.suit}</span>`;
  if (selectable) {
    node.addEventListener('click', () => onClick(card.id));
  } else {
    node.disabled = true;
  }
  return node;
}

function backCard() {
  const node = el('span', { class: 'ddz-card-back' });
  return node;
}

export function renderDouDiZhu(container = viewRoot()) {
  if (typeof activeCleanup === 'function') activeCleanup();
  startGameActivity();

  const wrap = el('section', { class: 'ddz-view' });
  const topbar = el('div', { class: 'ddz-topbar' });
  const backBtn = el('button', { class: 'ddz-back', type: 'button' }, '← 返回大厅');
  const title = el('div', { class: 'ddz-title' }, '🃏 斗地主');
  const tag = el('span', { class: 'ddz-tag' }, '3 人 · 支持 AI 补位');
  topbar.append(backBtn, title, tag);

  const stage = el('div', { class: 'ddz-stage' });
  wrap.append(topbar, stage);
  container.replaceChildren(wrap);

  const state = {
    view: 'idle', // idle | playing | ended
    table: null,
    selected: new Set(),
    gameOver: null,
    plays: {}, // 每家最近一次出的牌 seat -> lastPlay
  };
  let disposed = false;

  // ==================== 空闲（未在牌桌上） ====================

  function renderIdle(message) {
    state.view = 'idle';
    state.table = null;
    state.gameOver = null;
    state.plays = {};
    const box = el('div', { class: 'ddz-idle' });
    box.append(el('div', { class: 'ddz-idle-icon' }, '🃏'));
    box.append(el('h2', {}, '斗地主 · 三人对局'));
    box.append(el('p', { class: 'ddz-idle-desc' },
      '54 张牌，地主拿底牌先出，先出完手牌的一方获胜。真人不足 3 人时，等待 6 秒自动补 AI。'));
    box.append(el('p', { class: 'ddz-idle-tip' }, '匹配在游戏大厅发起，匹配成功后会自动进入牌桌'));
    if (message) box.append(el('p', { class: 'ddz-idle-tip' }, message));
    const back = el('button', { class: 'ddz-btn ddz-btn-primary ddz-start', type: 'button' }, '← 返回游戏大厅');
    back.addEventListener('click', () => go('games'));
    box.append(back);
    stage.replaceChildren(box);
  }

  // ==================== 牌桌 ====================

  function seatPanel(player, pos) {
    const panel = el('div', {
      class: `ddz-seat ddz-seat-${pos} ${player.landlord ? 'is-landlord' : ''} ${player.isAI ? 'is-ai' : ''}`,
    });
    const avatar = el('div', { class: 'ddz-avatar' }, player.isAI ? '🤖' : '👤');
    const name = el('div', { class: 'ddz-seat-name' }, player.name);
    const stack = el('div', { class: 'ddz-seat-stack' });
    const shown = Math.min(player.cards, 6);
    for (let i = 0; i < shown; i += 1) stack.append(backCard());
    const role = player.landlord ? '👑 地主' : (pos === 'left' ? '上家' : '下家');
    const count = el('div', { class: 'ddz-seat-count' }, `${role} · ${player.cards} 张`);
    panel.append(avatar, name, stack, count);
    return panel;
  }

  /** 每家的出牌区：贴在自己的座位旁，方便看清是谁出的 */
  function playZone(play, pos) {
    const zone = el('div', { class: `ddz-play-zone ddz-play-zone-${pos}` });
    if (!play || !play.cards || !play.cards.length) return zone;
    zone.append(el('div', { class: 'ddz-play-label' },
      `${play.playerName || ''} · ${TYPE_LABEL[play.type] || ''}`));
    const row = el('div', { class: 'ddz-card-row' });
    play.cards.forEach((c) => row.append(cardEl(c, false)));
    zone.append(row);
    return zone;
  }

  function renderTable() {
    const s = state.table;
    if (!s) return;
    if (state.view !== 'ended') state.view = 'playing';

    const table = el('div', { class: 'ddz-table' });

    // 对手座位：seat 相对自己左右分布
    const selfSeat = s.seat;
    const others = s.players.filter((p) => p.seat !== selfSeat);
    const rel = (p) => (p.seat - selfSeat + 3) % 3; // 1 = 下家(右), 2 = 上家(左)
    const right = others.find((p) => rel(p) === 1) || others[0];
    const left = others.find((p) => rel(p) === 2) || others[1];

    const leftWrap = el('div', { class: 'ddz-side ddz-side-left' });
    const leftPanel = left ? seatPanel(left, 'left') : null;
    if (leftPanel) leftWrap.append(leftPanel);
    if (left) leftWrap.append(playZone(state.plays[left.seat], 'left'));
    const rightWrap = el('div', { class: 'ddz-side ddz-side-right' });
    const rightPanel = right ? seatPanel(right, 'right') : null;
    if (rightPanel) rightWrap.append(rightPanel);
    if (right) rightWrap.append(playZone(state.plays[right.seat], 'right'));

    const center = el('div', { class: 'ddz-center' });

    // 底牌
    const bottomRow = el('div', { class: 'ddz-bottom-row' });
    bottomRow.append(el('span', { class: 'ddz-bottom-label' }, '底牌'));
    if (s.bottom) {
      s.bottom.forEach((c) => bottomRow.append(cardEl(c, false)));
    } else {
      bottomRow.append(backCard(), backCard(), backCard());
    }
    center.append(bottomRow);

    // 中央提示：出牌方已在自己座位旁显示，这里只保留状态提示
    const hint = el('div', { class: 'ddz-hint' });
    if (s.phase === 'bid') {
      hint.textContent = s.yourTurn ? '轮到你叫地主' : '等待其他玩家叫地主…';
    } else if (s.phase === 'play') {
      hint.textContent = s.yourTurn ? '轮到你出牌' : '等待其他玩家出牌…';
    }
    center.append(hint);

    if (s.phase === 'bid') {
      const bidInfo = el('div', { class: 'ddz-bid-info' });
      const bids = s.bids || [];
      if (bids.length) {
        const names = bids.map((b) => `${s.players[b.seat].name}:${b.call ? '叫' : '不叫'}`).join('  ');
        bidInfo.textContent = names;
      }
      center.append(bidInfo);
    }

    // 自己出的牌：贴在自己手牌上方
    center.append(playZone(state.plays[selfSeat], 'self'));

    // 自己的手牌
    const self = s.players[selfSeat];
    const selfBox = el('div', { class: 'ddz-self' });

    const handRow = el('div', { class: 'ddz-hand' });
    s.hand.forEach((c) => {
      handRow.append(cardEl(c, true, state.selected.has(c.id), (id) => {
        if (state.selected.has(id)) state.selected.delete(id);
        else state.selected.add(id);
        renderTable();
      }));
    });

    // 操作区
    const actions = el('div', { class: 'ddz-actions' });
    if (s.phase === 'bid') {
      if (s.yourTurn) {
        const callBtn = el('button', { class: 'ddz-btn ddz-btn-primary', type: 'button' }, '叫地主');
        callBtn.addEventListener('click', () => { toast.info('已叫地主'); emit('ddz_bid', { call: true }); });
        const noBtn = el('button', { class: 'ddz-btn', type: 'button' }, '不叫');
        noBtn.addEventListener('click', () => emit('ddz_bid', { call: false }));
        actions.append(noBtn, callBtn);
      } else {
        actions.append(el('span', { class: 'ddz-wait' }, '等待其他玩家叫地主…'));
      }
    } else if (s.phase === 'play') {
      const passBtn = el('button', {
        class: 'ddz-btn', type: 'button', disabled: (!s.yourTurn || !s.canPass) ? 'true' : null,
      }, '不出');
      passBtn.addEventListener('click', () => {
        state.selected.clear();
        emit('ddz_pass');
      });
      const playBtn = el('button', {
        class: 'ddz-btn ddz-btn-primary', type: 'button', disabled: (!s.yourTurn || !state.selected.size) ? 'true' : null,
      }, '出牌');
      playBtn.addEventListener('click', () => {
        if (!state.selected.size) return;
        emit('ddz_play', { cards: [...state.selected] });
        state.selected.clear();
      });
      actions.append(passBtn, playBtn);
      if (!s.yourTurn) actions.append(el('span', { class: 'ddz-wait' }, '等待其他玩家…'));
    }

    const selfHead = el('div', { class: 'ddz-self-head' });
    const me = el('div', { class: 'ddz-me' });
    me.append(el('span', { class: 'ddz-avatar is-me' }, '👤'));
    me.append(el('span', { class: 'ddz-seat-name' },
      `${self && self.landlord ? '👑 ' : ''}${self ? self.name : '我'}`));
    me.append(el('span', { class: 'ddz-seat-count' }, `${s.hand.length} 张`));
    selfHead.append(me);
    // 操作按钮放在自己手牌正上方（居中），不再挤在右下角
    selfBox.append(selfHead, actions, handRow);

    table.append(leftWrap, center, rightWrap, selfBox);
    stage.replaceChildren(table);

    // 高亮当前行动玩家
    const turnSeat = s.currentSeat;
    if (turnSeat === selfSeat) selfBox.classList.add('is-turn');
    else if (left && left.seat === turnSeat && leftPanel) leftPanel.classList.add('is-turn');
    else if (right && right.seat === turnSeat && rightPanel) rightPanel.classList.add('is-turn');

    // 结算覆盖层
    if (s.phase === 'ended' && s.winnerSeat >= 0 && state.view !== 'ended') {
      showResult({
        winnerSeat: s.winnerSeat,
        winnerName: s.players[s.winnerSeat]?.name || '',
        landlordSeat: s.landlordSeat,
        landlordWin: s.landlordWin,
        seat: selfSeat,
      });
    }
  }

  // ==================== 结算 ====================

  function showResult(info) {
    if (state.view === 'ended') return;
    state.view = 'ended';
    state.gameOver = info;
    const iAmLandlord = info.seat === info.landlordSeat;
    const iWin = iAmLandlord ? info.landlordWin : !info.landlordWin;
    const overlay = el('div', { class: 'ddz-overlay' });
    const box = el('div', { class: `ddz-result ${iWin ? 'is-win' : 'is-lose'}` });
    box.append(el('div', { class: 'ddz-result-icon' }, iWin ? '🏆' : '💤'));
    box.append(el('h2', {}, iWin ? '你赢了' : '你输了'));
    box.append(el('p', {},
      info.landlordWin ? '地主先出完了手牌' : '农民方先出完了手牌'));
    const again = el('button', { class: 'ddz-btn ddz-btn-primary', type: 'button' }, '再来一局');
    again.addEventListener('click', () => {
      emit('ddz_leave');
      renderIdle();
    });
    const back = el('button', { class: 'ddz-btn', type: 'button' }, '返回大厅');
    back.addEventListener('click', () => {
      emit('ddz_leave');
      go('games');
    });
    box.append(el('div', { class: 'ddz-result-actions' }));
    box.lastChild.append(again, back);
    overlay.append(box);
    stage.append(overlay);
  }

  // ==================== socket 事件 ====================

  const handlers = {
    ddz_queued: () => {
      // 匹配在游戏大厅完成，牌桌页不处理排队
    },
    ddz_cancelled: () => {},
    ddz_match_success: (info) => {
      toast.success('匹配成功，准备开始！');
      state.selected.clear();
      state.plays = {};
      if (info && info.roomId) emit('ddz_state_request');
    },
    ddz_state: (payload) => {
      if (!payload || !payload.roomId) return;
      if (payload.phase === 'ended' && state.view === 'ended') return;
      // 换桌或叫地主阶段：清空每家出牌记录
      if (!state.table || state.table.roomId !== payload.roomId || payload.phase === 'bid') {
        state.plays = {};
      }
      // 出牌记录：最新一手记到对应座位；新一轮（两家都不出后）清空
      if (payload.phase === 'play') {
        if (payload.lastPlay) state.plays[payload.lastPlay.seat] = payload.lastPlay;
        else state.plays = {};
      }
      state.table = payload;
      renderTable();
    },
    ddz_no_room: () => {
      if (state.view === 'playing') renderIdle('对局已结束');
    },
    ddz_error: (payload) => {
      toast.warn(payload?.message || '操作失败');
      emit('ddz_state_request');
    },
    ddz_game_over: (payload) => {
      if (!payload) return;
      showResult({ ...payload, seat: payload.seat });
    },
    ddz_left: () => {
      // 主动离开，无需额外处理
    },
  };

  DDZ_EVENTS.forEach((evt) => {
    if (handlers[evt]) socket.on(evt, handlers[evt]);
  });

  const offRoute = eventBus.on('route:change', (id) => {
    if (id !== 'doudizhu') cleanup();
  });

  const onReconnect = () => {
    if (state.view === 'playing') emit('ddz_state_request');
  };
  const offReconnect = eventBus.on('socket:reconnect', onReconnect);
  const offConnect = eventBus.on('socket:connect', onReconnect);

  function cleanup() {
    if (disposed) return;
    disposed = true;
    DDZ_EVENTS.forEach((evt) => {
      if (handlers[evt]) socket.off(evt, handlers[evt]);
    });
    offRoute();
    offReconnect();
    offConnect();
    if (stage.isConnected && wrap.isConnected && container.contains(wrap)) {
      // 仍在牌桌/匹配中就直接退出页面：通知服务端离开，由 AI 托管
      // 仍在牌桌上就退出页面：通知服务端离开，由 AI 托管
      if (state.view === 'playing') emit('ddz_leave');
      container.replaceChildren();
    }
    stopGameActivity();
    if (activeCleanup === cleanup) activeCleanup = null;
  }

  activeCleanup = cleanup;

  backBtn.addEventListener('click', () => {
    if (state.view === 'playing') emit('ddz_leave');
    go('games');
  });

  // 页内先询问服务端是否有进行中的房间（刷新/重连恢复）
  renderIdle();
  emit('ddz_state_request');

  return cleanup;
}
