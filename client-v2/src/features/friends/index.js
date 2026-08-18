/**
 * 好友系统（MVP）— 独立页 #/friends
 * - 模块级共享状态：好友列表 / 收到的申请 / 已发出的申请，供聊天页（加好友按钮）与好友页共用
 * - 实时通知：friend:request / friend:accepted 由模块级监听，应用启动即生效
 */
import { eventBus } from '../../core/eventBus.js';
import { api } from '../../core/api.js';
import { el, viewRoot } from '../../utils/dom.js';
import { toast } from '../../components/toast.js';
import { avatarNode } from '../../utils/avatar.js';
import { showUserCard } from '../../components/userCard.js';
import { getOnlineUsers, subscribeOnlineUsers, sendChallenge } from '../online-players/index.js';
import { go } from '../../core/router.js';

// ===== 模块级状态（常驻，跨视图保留）=====
let state = { friends: [], pendingIn: [], pendingOut: [] };
const views = new Set();          // 订阅视图（渲染回调）
const friendIds = new Set();      // 已是好友
const requestedIds = new Set();   // 已发申请待同意

const myId = () => localStorage.getItem('currentAccountId');

export function subscribeFriends(fn) {
  views.add(fn);
  return () => views.delete(fn);
}

function refresh() { views.forEach((fn) => fn()); }

/** 拉取好友状态并通知所有视图 */
export async function loadFriends() {
  try {
    const res = await api.friends.get(myId());
    const data = res?.data;
    if (!data) return;
    state = {
      friends: Array.isArray(data.friends) ? data.friends : [],
      pendingIn: Array.isArray(data.pendingIn) ? data.pendingIn : [],
      pendingOut: Array.isArray(data.pendingOut) ? data.pendingOut : [],
    };
    friendIds.clear();
    requestedIds.clear();
    state.friends.forEach((f) => friendIds.add(String(f.accountId)));
    state.pendingOut.forEach((id) => requestedIds.add(String(id)));
    refresh();
  } catch (err) { /* 忽略 */ }
}

export function getFriends() { return state.friends; }
export function getPendingIn() { return state.pendingIn; }
export function isFriend(accountId) { return friendIds.has(String(accountId)); }
/** 是否已发出过申请（待对方同意） */
export function isRequested(accountId) { return requestedIds.has(String(accountId)); }

/** 发起好友申请 */
export async function requestFriend(accountId, nickname) {
  const res = await api.friends.request(myId(), accountId);
  if (res?.success) {
    toast.success(res.autoAccepted ? `你和${nickname}已经是好友了` : `已向${nickname}发送好友申请`);
    loadFriends();
  } else {
    toast.error(res?.message || '操作失败');
  }
}

/** 同意/拒绝好友申请 */
export async function respondFriend(fromUserId, accept) {
  const res = await api.friends.respond(myId(), fromUserId, accept);
  if (res?.success) {
    toast.success(res.message || (accept ? '已添加好友' : '已拒绝'));
    loadFriends();
  } else {
    toast.error(res?.message || '操作失败');
  }
}

/** 删除好友 */
export async function removeFriend(friendId) {
  if (!confirm('确定删除该好友吗？')) return;
  const res = await api.friends.remove(myId(), friendId);
  if (res?.success) {
    toast.info('已删除好友');
    loadFriends();
  } else {
    toast.error(res?.message || '删除失败');
  }
}

// ===== 实时通知（模块加载即生效，聊天页静态引入保证启动即监听）=====
eventBus.on('friend:request', (data) => {
  toast.info(`${data.fromNickname || '有人'} 向你发送了好友申请`);
  loadFriends();
});

eventBus.on('friend:accepted', (data) => {
  toast.success(`${data.withNickname || '对方'} 已同意你的好友申请`);
  loadFriends();
});

/** 打开与某人的私信（跳转聊天页并自动打开该会话） */
function openChat(targetId, nickname) {
  eventBus.emit('chat:openPrivate', { targetId, nickname });
  go('chat');
}

/** 在线状态标签 */
function statusText(onlineUser) {
  if (!onlineUser) return '离线';
  if (onlineUser.status === 'playing') return '游戏中';
  if (onlineUser.status === 'waiting') return '等待中';
  return '在线';
}

/**
 * 渲染独立好友页（路由 #/friends）
 * @param {HTMLElement} container
 * @returns {Function} cleanup
 */
export function renderFriends(container = viewRoot()) {
  container.innerHTML = '';

  const requestBox = el('div', { class: 'friends-box' });
  const listBox = el('div', { class: 'friends-box' });
  container.append(el('div', { class: 'friends-page' }, [
    el('div', { class: 'friends-page-title' }, '💛 好友'),
    el('div', { class: 'friends-section-title' }, '📨 好友申请'),
    requestBox,
    el('div', { class: 'friends-section-title' }, '👥 我的好友'),
    el('div', { class: 'friends-section-note' }, '离线好友也可私信，消息在其上线后可查看'),
    listBox,
  ]));

  function render() {
    requestBox.innerHTML = '';
    listBox.innerHTML = '';

    // 待处理申请
    const pending = getPendingIn();
    if (!pending.length) {
      requestBox.append(el('div', { class: 'friends-empty' }, '暂无待处理的好友申请'));
    } else {
      pending.forEach((req) => {
        const info = req.from || {};
        const name = info.nickname || '玩家';
        requestBox.append(el('div', { class: 'friends-row' }, [
          avatarNode(info.accountId, 32),
          el('div', { class: 'friends-info' }, [
            el('button', { class: 'friends-name', onClick: () => showUserCard(info.accountId) }, name),
            el('div', { class: 'friends-meta' }, `Lv.${info.level || 1} · 想加你为好友`),
          ]),
          el('div', { class: 'friends-actions' }, [
            el('button', { class: 'friends-btn accept', onClick: () => respondFriend(info.accountId, true) }, '同意'),
            el('button', { class: 'friends-btn reject', onClick: () => respondFriend(info.accountId, false) }, '拒绝'),
          ]),
        ]));
      });
    }

    // 好友列表
    const friends = getFriends();
    if (!friends.length) {
      listBox.append(el('div', { class: 'friends-empty' }, '还没有好友，去聊天页的玩家列表添加吧'));
      return;
    }
    const onlineMap = new Map(getOnlineUsers().map((u) => [String(u.accountId), u]));
    const list = [...friends].sort((x, y) => {
      const ox = onlineMap.has(String(x.accountId)) ? 1 : 0;
      const oy = onlineMap.has(String(y.accountId)) ? 1 : 0;
      return oy - ox || (y.level || 0) - (x.level || 0);
    });
    list.forEach((f) => {
      const key = String(f.accountId);
      const onlineUser = onlineMap.get(key);
      const name = f.nickname || `玩家${key.slice(0, 4)}`;
      listBox.append(el('div', { class: 'friends-row' + (onlineUser ? '' : ' offline') }, [
        avatarNode(f.accountId, 32),
        el('div', { class: 'friends-info' }, [
          el('button', { class: 'friends-name', onClick: () => showUserCard(f.accountId) }, name),
          el('div', { class: 'friends-meta' }, `Lv.${f.level || 1} · ${statusText(onlineUser)}`),
        ]),
        el('div', { class: 'friends-actions' }, [
          el('button', { class: 'friends-btn primary', onClick: () => openChat(f.accountId, name) }, '💬 私信'),
          onlineUser ? el('button', { class: 'friends-btn primary', onClick: () => sendChallenge(f.accountId) }, '⚔️ 挑战') : null,
          el('button', { class: 'friends-btn danger', onClick: () => removeFriend(f.accountId) }, '✕ 删除'),
        ]),
      ]));
    });
  }

  render();
  loadFriends(); // 拉取最新好友状态（完成后通过订阅刷新）
  const unsubscribe = subscribeFriends(render);
  const unsubscribeOnline = subscribeOnlineUsers(render); // 在线状态实时变化 → 刷新好友状态

  return () => {
    unsubscribe();
    unsubscribeOnline();
    container.innerHTML = '';
  };
}
