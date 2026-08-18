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
import { api } from '../../core/api.js';

// ===== 模块级状态（常驻，跨视图保留）=====
const users = new Map(); // String(accountId) -> {accountId, nickname, status, gameType, level}
let allPlayers = null;   // 全部玩家快照（含离线）：[{accountId, nickname, level, lastLogin}]
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
  views.forEach((fn) => fn());
}

/**
 * 获取在线用户快照（供聊天页等模块复用）
 * @returns {Array<Object>} 在线用户数组
 */
export function getOnlineUsers() {
  return Array.from(users.values());
}

/**
 * 订阅在线用户变化（数据更新时调用 fn）
 * @param {Function} fn - 渲染回调
 * @returns {Function} 取消订阅
 */
export function subscribeOnlineUsers(fn) {
  views.add(fn);
  return () => views.delete(fn);
}

/**
 * 拉取全部玩家公开信息（含离线），用于离线私信等场景
 * 加载完成后会刷新所有已订阅视图
 */
export async function loadAllPlayers() {
  try {
    const res = await api.users.all();
    allPlayers = (Array.isArray(res?.data) ? res.data : []).map((p) => ({
      accountId: p.accountId,
      nickname: p.nickname,
      level: p.level || 1,
      lastLogin: p.lastLogin || null,
    }));
  } catch (err) {
    allPlayers = allPlayers || [];
  }
  refresh();
}

/**
 * 获取全部玩家（在线在前，离线在后），离线项带 status:'offline'
 * @returns {Array<Object>}
 */
export function getAllPlayers() {
  const online = Array.from(users.values());
  const onlineKeys = new Set(online.map((u) => String(u.accountId)));
  const offline = (allPlayers || [])
    .filter((p) => !onlineKeys.has(String(p.accountId)))
    .map((p) => ({ ...p, status: 'offline' }));
  return [...online, ...offline];
}

/** 判断某玩家当前是否在线 */
export function isPlayerOnline(accountId) {
  return users.has(String(accountId));
}

// ===== 挑战 =====
/** 发起挑战（供聊天页/悬浮坞等复用） */
export function sendChallenge(accountId) {
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

// ===== 浮动面板已合并进悬浮坞（见 features/chat/index.js initFloatingChat）=====
