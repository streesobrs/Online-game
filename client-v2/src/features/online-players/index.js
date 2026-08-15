/**
 * 在线玩家 + 挑战（v1 功能补齐）
 * - 模块级常驻监听 online_users（全量列表）与 user_status（增量更新），维护在线用户 Map
 * - 右下角浮动面板展示在线玩家（头像/昵称/等级/状态），点击昵称查看资料卡，点击「挑战」发起对战
 * - 挑战协议与 v1 一致：challenge_request {to, game} → 被挑战者收 challenge_received 弹窗接受/拒绝；
 *   接受后服务端随 challenge_accepted 发送 match_success / snake_match_found → 走既有对局链路
 */
import { eventBus } from '../../core/eventBus.js';
import { emit } from '../../core/socket.js';
import { store } from '../../core/store.js';
import { el } from '../../utils/dom.js';
import { modal } from '../../components/modal.js';
import { toast } from '../../components/toast.js';
import { avatarNode } from '../../utils/avatar.js';
import { showUserCard } from '../../components/userCard.js';
import { GAMES } from '../../data/navItems.js';

// ===== 模块级状态（常驻，跨视图保留）=====
const users = new Map(); // String(accountId) -> {accountId, nickname, status, gameType, level}
const views = new Set(); // 活动面板视图（render 回调）
let myId = null;

function myAccountId() {
  return store.get('user')?.account?.account?.id
    || localStorage.getItem('currentAccountId') || null;
}

// 全量列表（登录后服务端下发一次）
eventBus.on('user:onlineUsers', (list) => {
  users.clear();
  (Array.isArray(list) ? list : []).forEach((u) => users.set(String(u.accountId), u));
  myId = myAccountId();
  refresh();
});

// 增量状态（上线/下线/状态变化广播）
eventBus.on('user:status', (data) => {
  if (!data || data.accountId == null) return;
  const key = String(data.accountId);
  if (data.status === 'offline') users.delete(key);
  else users.set(key, { ...users.get(key), ...data });
  refresh();
});

function refresh() {
  views.forEach((v) => v.render());
}

// ===== 挑战 =====
function sendChallenge(accountId) {
  if (myId && String(accountId) === String(myId)) { toast.error('不能挑战自己'); return; }
  const items = GAMES.map((g) => el('button', {
    class: 'challenge-game-btn',
    onClick: () => {
      modal.close();
      emit('challenge_request', { to: accountId, game: g.id });
      toast.info('挑战已发送，等待对方回应...');
    },
  }, `${g.icon} ${g.name}`));
  modal.show({
    title: '选择挑战游戏',
    content: el('div', { class: 'challenge-game-list' }, items),
    confirmText: '取消',
    showCancel: false,
  });
}

// 被挑战者：弹窗接受/拒绝
eventBus.on('lobby:challengeReceived', (data) => {
  const gameName = GAMES.find((g) => g.id === data.game)?.name || data.game || '对战';
  modal.show({
    title: '挑战邀请',
    content: el('div', { class: 'challenge-invite' }, [
      el('p', { style: 'margin:0 0 8px;' }, '玩家'),
      el('b', {}, data.fromNickname || data.from || '对方'),
      el('p', { style: 'margin:8px 0 0;' }, `邀请您进行一场 ${gameName} 对战！`),
    ]),
    confirmText: '接受',
    cancelText: '拒绝',
    onConfirm: () => emit('challenge_response', { from: data.from, accept: true }),
    onCancel: () => emit('challenge_response', { from: data.from, accept: false }),
  });
});

// 挑战者：发送结果提示
eventBus.on('lobby:challengeSent', (data) => {
  if (data?.success) toast.success(data.message || '挑战已发出');
  else toast.error(data?.message || '挑战失败');
});

// 挑战者：对方接受（对局启动由服务端随后发送的 match_success 处理，无需额外逻辑）
eventBus.on('lobby:challengeAccepted', (data) => {
  const name = data.fromNickname || data.toNickname || '对方';
  toast.success(`✅ ${name} 接受了你的挑战！游戏开始！`);
});

// 挑战者：对方拒绝
eventBus.on('lobby:challengeRejected', (data) => {
  const name = data.fromNickname || data.toNickname || '对方';
  toast.error(`❌ ${name} 拒绝了你的挑战`);
});

// ===== 浮动面板 =====
/**
 * 挂载在线玩家浮动面板（右下角按钮，任意页面随时查看/挑战）
 */
export function initOnlinePlayers() {
  if (document.querySelector('.online-btn')) return; // 防重复挂载

  const btn = el('button', { class: 'online-btn', title: '在线玩家', onClick: toggle }, '👥 在线');
  const countEl = el('span', { class: 'online-count' }, '0');
  const header = el('div', { class: 'online-panel-header' }, [
    el('span', { class: 'online-panel-title' }, '👥 在线玩家'),
    countEl,
  ]);
  const listEl = el('div', { class: 'online-list' });
  const panelEl = el('div', { class: 'online-panel', style: { display: 'none' } }, [header, listEl]);

  function statusText(u) {
    if (u.status === 'playing') return '游戏中';
    if (u.status === 'waiting') return '等待中';
    return '在线';
  }

  function render() {
    listEl.innerHTML = '';
    countEl.textContent = String(users.size);
    if (users.size === 0) {
      listEl.append(el('div', { class: 'online-empty' }, '暂无在线玩家'));
      return;
    }
    users.forEach((u, key) => {
      const isMe = myId && key === String(myId);
      const name = u.nickname || `玩家${key.slice(0, 4)}`;
      const item = el('div', { class: 'online-item' }, [
        avatarNode(u.accountId, 30),
        el('div', { class: 'online-item-info' }, [
          el('button', {
            class: 'online-item-name',
            onClick: () => showUserCard(u.accountId),
          }, `${name}${isMe ? ' (我)' : ''}`),
          el('div', { class: 'online-item-meta' }, `Lv.${u.level || 1} · ${statusText(u)}`),
        ]),
        isMe ? null : el('button', {
          class: 'online-item-btn',
          onClick: () => sendChallenge(u.accountId),
        }, '挑战'),
      ]);
      listEl.append(item);
    });
  }

  function toggle() {
    const visible = panelEl.style.display !== 'none';
    panelEl.style.display = visible ? 'none' : 'block';
    btn.classList.toggle('active', !visible);
    if (!visible) render();
  }

  const viewRef = { render };
  views.add(viewRef);

  document.body.append(btn, panelEl);
}
