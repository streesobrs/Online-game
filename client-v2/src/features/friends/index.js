/**
 * 好友系统（MVP）— 独立页 #/friends
 * - 模块级共享状态：好友列表 / 收到的申请 / 已发出的申请，供聊天页（加好友按钮）与好友页共用
 * - 实时通知：friend:request / friend:accepted 由模块级监听，应用启动即生效
 */
import { eventBus } from '../../core/eventBus.js';
import { store } from '../../core/store.js';
import { api } from '../../core/api.js';
import { el, viewRoot } from '../../utils/dom.js';
import { toast } from '../../components/toast.js';
import { avatarNode } from '../../utils/avatar.js';
import { showUserCard } from '../../components/userCard.js';
import { getOnlineUsers, subscribeOnlineUsers, sendChallenge } from '../online-players/index.js';
import { getUiPrefs, setUiPrefs } from '../../core/prefs.js';
import { go } from '../../core/router.js';

// ===== 模块级状态（常驻，跨视图保留）=====
let state = { friends: [], pendingIn: [], pendingOut: [] };
const views = new Set();          // 订阅视图（渲染回调）
const friendIds = new Set();      // 已是好友
const requestedIds = new Set();   // 已发申请待同意

/** 当前登录账号 id：优先取 store（登录瞬间即可用），回退到本地存储 */
const myId = () => {
  const user = store.get('user');
  const inner = user?.account?.account || user?.account;
  return inner?.id || localStorage.getItem('currentAccountId');
};

export function subscribeFriends(fn) {
  views.add(fn);
  return () => views.delete(fn);
}

function refresh() {
  // 待处理申请数写入 store：导航红点等全局 UI 据此显示提醒
  store.set('friendRequestCount', state.pendingIn.length);
  views.forEach((fn) => fn());
}

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
  // 「好友申请弹窗提示」可在设置页关闭（红点仍会亮）
  if (getUiPrefs().friendToast) {
    toast.info(`${data.fromNickname || '有人'} 向你发送了好友申请`);
  }
  loadFriends();
});

eventBus.on('friend:accepted', (data) => {
  toast.success(`${data.withNickname || '对方'} 已同意你的好友申请`);
  loadFriends();
});

// ===== 好友上线提醒（可在好友页关闭）=====
// 记录已知在线集合，用于区分「新上线」与「本来就在线」，避免重复提示
let knownOnline = null;

function isOnlineNotifyOn() {
  return getUiPrefs().friendOnline !== false;
}

eventBus.on('user:onlineUsers', (list) => {
  knownOnline = new Set((Array.isArray(list) ? list : []).map((u) => String(u.accountId)));
});

eventBus.on('user:status', (data) => {
  const key = data && data.accountId != null ? String(data.accountId) : '';
  if (!key) return;
  if (data.status === 'offline') {
    if (knownOnline) knownOnline.delete(key);
    return;
  }
  if (!knownOnline) knownOnline = new Set();
  if (knownOnline.has(key)) return;
  knownOnline.add(key);
  // 只提示好友，且尊重关闭开关
  if (!friendIds.has(key) || !isOnlineNotifyOn()) return;
  const onlineUser = getOnlineUsers().find((u) => String(u.accountId) === key);
  const name = state.friends.find((f) => String(f.accountId) === key)?.nickname
    || onlineUser?.nickname
    || '好友';
  toast.info(`${name} 上线了`);
});

// 登录（含自动登录）后立即拉取一次：离线期间收到的申请也能显示红点；
// 登出则清空本地状态，避免把上一个账号的申请数带给下一个人
store.subscribe('user', (user) => {
  if (user) {
    loadFriends();
    return;
  }
  state = { friends: [], pendingIn: [], pendingOut: [] };
  friendIds.clear();
  requestedIds.clear();
  refresh();
});

/** 打开与某人的私信（跳转聊天页并自动打开该会话） */
function openChat(targetId, nickname) {
  eventBus.emit('chat:openPrivate', { targetId, nickname });
  go('chat');
}

/** 游戏类型中文名 */
const GAME_NAMES = {
  gobang: '五子棋',
  go: '围棋',
  'chinese-chess': '象棋',
  snake: '贪吃蛇',
  match3: '消消乐',
};

/** 支持观战的游戏类型（与观战页保持一致） */
const SPECTATEABLE = new Set(['gobang', 'go', 'chinese-chess']);

/** 相对时间（离线好友最后在线） */
function relativeTime(ts) {
  const t = Number(ts) || 0;
  if (!t) return '';
  const diff = Date.now() - t;
  if (diff < 60 * 1000) return '刚刚';
  if (diff < 60 * 60 * 1000) return `${Math.floor(diff / 60000)} 分钟前`;
  if (diff < 24 * 60 * 60 * 1000) return `${Math.floor(diff / 3600000)} 小时前`;
  if (diff < 30 * 24 * 60 * 60 * 1000) return `${Math.floor(diff / 86400000)} 天前`;
  const d = new Date(t);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

/** 在线状态标签（离线时附带最后在线时间） */
function statusText(onlineUser, lastSeen) {
  if (!onlineUser) {
    const rel = relativeTime(lastSeen);
    return rel ? `离线 · ${rel}在线` : '离线';
  }
  const gameName = GAME_NAMES[onlineUser.gameType];
  if (onlineUser.status === 'playing') return gameName ? `游戏中 · ${gameName}` : '游戏中';
  if (onlineUser.status === 'waiting') return gameName ? `等待中 · ${gameName}` : '等待中';
  if (onlineUser.status === 'spectating') return '观战中';
  return '在线';
}

/** 从好友列表直接观战：跳转观战页并自动加入对方当前对局 */
function spectateFriend(accountId) {
  store.set('spectate.autoJoin', { accountId: String(accountId) });
  go('spectate');
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
  const notifyBtn = el('button', {
    class: 'friends-notify-toggle' + (isOnlineNotifyOn() ? ' on' : ''),
    onClick: () => {
      const next = !isOnlineNotifyOn();
      setUiPrefs({ friendOnline: next });
      notifyBtn.classList.toggle('on', next);
      notifyBtn.textContent = next ? '🔔 上线提醒已开' : '🔕 上线提醒已关';
      if (next) toast.success('已开启好友上线提醒');
      else toast.info('已关闭好友上线提醒');
    },
  }, isOnlineNotifyOn() ? '🔔 上线提醒已开' : '🔕 上线提醒已关');

  container.append(el('div', { class: 'friends-page' }, [
    el('div', { class: 'friends-page-head' }, [
      el('div', { class: 'friends-page-title' }, '💛 好友'),
      notifyBtn,
    ]),
    el('div', { class: 'friends-section-title' }, '📨 好友申请'),
    requestBox,
    el('div', { class: 'friends-section-title' }, '👥 我的好友'),
    el('div', { class: 'friends-section-note' }, '离线好友也可私信，消息在其上线后可查看'),
    listBox,
  ]));

  // 在线快照 + 行索引：状态变化时只更新对应行，避免整表重绘
  const onlineMap = new Map();
  const rowMap = new Map(); // key -> { f, row, meta, actions }

  function friendActionNodes(f, name, onlineUser) {
    const nodes = [
      el('button', { class: 'friends-btn primary', onClick: () => openChat(f.accountId, name) }, '💬 私信'),
    ];
    if (onlineUser) {
      nodes.push(el('button', { class: 'friends-btn primary', onClick: () => sendChallenge(f.accountId) }, '⚔️ 挑战'));
      if (onlineUser.status === 'playing' && SPECTATEABLE.has(onlineUser.gameType)) {
        nodes.push(el('button', { class: 'friends-btn primary', onClick: () => spectateFriend(f.accountId) }, '👁️ 观战'));
      }
    }
    nodes.push(el('button', { class: 'friends-btn danger', onClick: () => removeFriend(f.accountId) }, '✕ 删除'));
    return nodes;
  }

  function updateRow(key) {
    const entry = rowMap.get(key);
    if (!entry) return;
    const onlineUser = onlineMap.get(key);
    const name = entry.f.nickname || `玩家${key.slice(0, 4)}`;
    entry.row.classList.toggle('offline', !onlineUser);
    entry.meta.textContent = `Lv.${entry.f.level || 1} · ${statusText(onlineUser, entry.f.lastSeen)}`;
    entry.actions.innerHTML = '';
    entry.actions.append(...friendActionNodes(entry.f, name, onlineUser));
  }

  function buildRow(f) {
    const key = String(f.accountId);
    const name = f.nickname || `玩家${key.slice(0, 4)}`;
    const meta = el('div', { class: 'friends-meta' });
    const actions = el('div', { class: 'friends-actions' });
    const row = el('div', { class: 'friends-row' }, [
      avatarNode(f.accountId, 32),
      el('div', { class: 'friends-info' }, [
        el('button', { class: 'friends-name', onClick: () => showUserCard(f.accountId) }, name),
        meta,
      ]),
      actions,
    ]);
    rowMap.set(key, { f, row, meta, actions });
    updateRow(key);
    return row;
  }

  /** 按「在线优先 + 等级」重排已有行（移动节点，保留事件监听） */
  function reorderRows() {
    [...rowMap.entries()]
      .sort(([ka, a], [kb, b]) => {
        const oa = onlineMap.has(ka) ? 1 : 0;
        const ob = onlineMap.has(kb) ? 1 : 0;
        return ob - oa || (b.f.level || 0) - (a.f.level || 0);
      })
      .forEach(([, entry]) => listBox.append(entry.row));
  }

  function renderRequests() {
    requestBox.innerHTML = '';
    const pending = getPendingIn();
    if (!pending.length) {
      requestBox.append(el('div', { class: 'friends-empty' }, '暂无待处理的好友申请'));
      return;
    }
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

  function rebuildList() {
    rowMap.clear();
    onlineMap.clear();
    getOnlineUsers().forEach((u) => onlineMap.set(String(u.accountId), u));
    listBox.innerHTML = '';

    const friends = getFriends();
    if (!friends.length) {
      listBox.append(el('div', { class: 'friends-empty' }, '还没有好友，去聊天页的玩家列表添加吧'));
      return;
    }
    const frag = document.createDocumentFragment();
    [...friends]
      .sort((x, y) => {
        const ox = onlineMap.has(String(x.accountId)) ? 1 : 0;
        const oy = onlineMap.has(String(y.accountId)) ? 1 : 0;
        return oy - ox || (y.level || 0) - (x.level || 0);
      })
      .forEach((f) => frag.append(buildRow(f)));
    listBox.append(frag);
  }

  /**
   * @param {{type?: string, accountId?: string, status?: string}} [patch]
   * 在线状态增量（type=status）只更新对应好友行；其余情况整表重绘
   */
  function render(patch) {
    if (patch && patch.type === 'status') {
      const key = String(patch.accountId);
      // 非好友的状态变化不影响本页
      if (!rowMap.has(key)) return;
      const entry = rowMap.get(key);
      if (patch.status === 'offline') {
        onlineMap.delete(key);
        // 服务端 lastSeen 在断开时刷新为当前时间，这里用本地时间近似
        entry.f.lastSeen = Date.now();
      } else {
        const fresh = getOnlineUsers().find((u) => String(u.accountId) === key);
        if (fresh) onlineMap.set(key, fresh);
      }
      updateRow(key);
      reorderRows();
      return;
    }
    renderRequests();
    rebuildList();
  }

  render();
  loadFriends(); // 拉取最新好友状态（完成后通过订阅刷新）
  const unsubscribe = subscribeFriends(render);
  const unsubscribeOnline = subscribeOnlineUsers(render); // 在线状态实时变化 → 只更新对应好友行

  return () => {
    unsubscribe();
    unsubscribeOnline();
    container.innerHTML = '';
  };
}
