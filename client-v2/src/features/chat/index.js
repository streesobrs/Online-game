/**
 * 聊天模块（v2）
 * - 独立聊天页 #/chat：不区分频道，仅「大厅」全局聊天 +「私信」
 * - 常驻悬浮坞（右下角）：合并聊天窗与在线玩家，避免页面多个浮动按钮碍眼
 *
 * 架构要点：
 * 1. 消息/状态监听为模块级常驻，保证对局中（聊天视图未挂载时）消息不丢失。
 * 2. createChatView() 服务悬浮坞聊天 Tab（保留大厅/局内频道，对局中可用局内频道）；
 *    renderChat() 是独立页专用渲染，自行管理大厅/私信切换。
 */
import { eventBus } from '../../core/eventBus.js';
import { emit } from '../../core/socket.js';
import { store } from '../../core/store.js';
import { el, viewRoot } from '../../utils/dom.js';
import { toast } from '../../components/toast.js';
import { avatarNode } from '../../utils/avatar.js';
import { showUserCard } from '../../components/userCard.js';
import { getOnlineUsers, subscribeOnlineUsers, sendChallenge } from '../online-players/index.js';

const MAX_HISTORY = 100; // 每会话保留上限
const myId = localStorage.getItem('currentAccountId');

// ===== 模块级状态（常驻，跨视图保留）=====
const history = { global: [], game: [] };        // 按频道存 { userId, nickname, message, scope, timestamp }
const privateHistory = new Map();                // String(userId) -> { rawId, nickname, messages: [] }
let myStatus = 'online';                         // 自己的用户状态（online/playing/spectating）
const floatViews = new Set();                    // 悬浮坞内 createChatView 实例
const pageViews = new Set();                     // #/chat 独立页视图

/** 往频道历史推一条消息（按 messageId 去重 + 超限裁剪 + 通知浮窗） */
function pushChannelMessage(scope, msg) {
  if (msg.messageId && history[scope].some((m) => m.messageId === msg.messageId)) return;
  history[scope].push(msg);
  if (history[scope].length > MAX_HISTORY) history[scope].shift();
  floatViews.forEach((v) => { if (v.channel === scope) v.addMessage(msg); });
}

/** 全局常驻：接收聊天消息 */
eventBus.on('chat:message', (data) => {
  const scope = data.scope === 'game' ? 'game' : 'global';
  pushChannelMessage(scope, {
    messageId: data.messageId,
    userId: data.userId,
    nickname: data.nickname || '玩家',
    message: data.message,
    scope,
    timestamp: data.timestamp || Date.now(),
  });
});

/** 全局常驻：聊天历史响应（get_chat_history） */
eventBus.on('chat:history', (data) => {
  const scope = data.scope === 'game' ? 'game' : 'global';
  const list = Array.isArray(data.history) ? data.history : [];
  list.forEach((item) => {
    const msg = {
      messageId: item.messageId,
      userId: item.userId,
      nickname: item.nickname || '玩家',
      message: item.message,
      scope,
      timestamp: item.timestamp || Date.now(),
    };
    if (msg.messageId && history[scope].some((m) => m.messageId === msg.messageId)) return;
    history[scope].push(msg);
  });
  if (history[scope].length > MAX_HISTORY) history[scope].splice(0, history[scope].length - MAX_HISTORY);
  floatViews.forEach((v) => { if (v.channel === scope) v.renderHistory(); });
});

// 进入应用即加载全局聊天历史；socket 未连接时不发（连接成功后由 socket:connect 补拉）。
function loadGlobalHistory() {
  if (!store.get('socketConnected')) return;
  emit('get_chat_history', { scope: 'global' });
}
loadGlobalHistory();
eventBus.on('socket:connect', loadGlobalHistory);

// 私聊会话列表：等服务端完成身份绑定（user_connected）后再拉取。
// 不能在 socket:connect 时立即拉——client_connect 尚未完成，服务端会判定用户不存在。
function loadPrivateConversations() {
  emit('get_private_conversations');
}
eventBus.on('user:connected', loadPrivateConversations);

/** 获取（或创建）私聊会话 */
function getPrivateConv(targetId, nickname = '') {
  const key = String(targetId);
  let conv = privateHistory.get(key);
  if (!conv) {
    conv = { rawId: targetId, nickname, messages: [], lastMessage: null, historyLoaded: false };
    privateHistory.set(key, conv);
  } else if (nickname) {
    conv.nickname = nickname;
  }
  return conv;
}

/** 往私聊会话推一条消息并通知独立页 */
function pushPrivateMessage(conv, msg, partnerId) {
  if (msg.messageId && conv.messages.some((m) => m.messageId === msg.messageId)) return;
  conv.messages.push(msg);
  if (conv.messages.length > MAX_HISTORY) conv.messages.shift();
  pageViews.forEach((v) => v.onPrivateMessage(conv, partnerId));
}

/** 收到私聊消息 */
eventBus.on('chat:privateMessage', (data) => {
  const conv = getPrivateConv(data.fromUserId, data.fromNickname);
  pushPrivateMessage(conv, {
    messageId: data.messageId,
    userId: data.fromUserId,
    nickname: data.fromNickname,
    message: data.message,
    timestamp: data.timestamp || Date.now(),
  }, data.fromUserId);
});

/** 自己发出私聊的确认回执 */
eventBus.on('chat:privateMessageSent', (data) => {
  const conv = getPrivateConv(data.toUserId);
  pushPrivateMessage(conv, {
    messageId: data.messageId,
    userId: data.fromUserId,
    nickname: data.fromNickname,
    message: data.message,
    timestamp: data.timestamp || Date.now(),
  }, data.toUserId);
});

/** 服务端返回的私聊会话列表（跨刷新恢复历史会话） */
eventBus.on('chat:privateConversations', (data) => {
  const list = Array.isArray(data.conversations) ? data.conversations : [];
  list.forEach((c) => {
    const conv = getPrivateConv(c.partnerId);
    if (c.lastMessage) {
      conv.lastMessage = c.lastMessage;
      // 若尚不知对方昵称，从对方最近一条消息中提取
      if (!conv.nickname && c.lastMessage.fromUserId != null && String(c.lastMessage.fromUserId) !== String(myId)) {
        conv.nickname = c.lastMessage.fromNickname || '';
      }
    }
  });
  pageViews.forEach((v) => v.onConversations());
});

/** 服务端返回的某会话私聊历史（按 messageId 去重合并，时间排序） */
eventBus.on('chat:privateHistory', (data) => {
  const conv = getPrivateConv(data.targetUserId);
  const serverMsgs = Array.isArray(data.history) ? data.history : [];
  const seen = new Set();
  const merged = serverMsgs.map((m) => {
    if (m.messageId) seen.add(m.messageId);
    return {
      messageId: m.messageId,
      userId: m.fromUserId,
      nickname: m.fromNickname || '玩家',
      message: m.message,
      timestamp: m.timestamp || Date.now(),
    };
  });
  conv.messages.forEach((m) => {
    if (m.messageId && seen.has(m.messageId)) return;
    merged.push(m);
  });
  merged.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
  conv.messages = merged;
  if (conv.messages.length > MAX_HISTORY) conv.messages.splice(0, conv.messages.length - MAX_HISTORY);
  pageViews.forEach((v) => v.onPrivateHistory(conv, data.targetUserId));
});

/** 全局常驻：聊天错误提示（禁言/频繁/维护/对方不在线等） */
eventBus.on('chat:error', (data) => {
  console.warn('[Chat] 聊天错误:', data);
  toast.error(data?.message || '消息发送失败');
});

/** 全局常驻：系统广播 */
eventBus.on('system:broadcast', (data) => {
  if (data?.message) toast.show(data.message);
});

/** 全局常驻：自己的用户状态变化 → 更新悬浮坞局内频道可用性 */
eventBus.on('user:status', (data) => {
  if (data.accountId != null && String(data.accountId) === String(myId)) {
    myStatus = data.status || myStatus;
    floatViews.forEach((v) => v.updateChannel());
  }
});

/**
 * 创建聊天视图（面板 DOM + 交互），供悬浮坞聊天 Tab 使用（保留大厅/局内频道）
 * @returns {{ panel: HTMLElement, destroy: Function }}
 */
function createChatView() {
  let channel = 'global';

  // ---- DOM ----
  const globalBtn = el('button', { class: 'chat-channel-btn active', onClick: () => switchChannel('global') }, '🌐 大厅');
  const gameBtn = el('button', { class: 'chat-channel-btn', disabled: true, onClick: () => switchChannel('game') }, '🎮 局内');
  const selector = el('div', { class: 'chat-channel-selector' }, [globalBtn, gameBtn]);

  const messagesEl = el('div', { class: 'chat-messages' });
  const inputEl = el('input', { class: 'chat-input', placeholder: '输入消息...' });
  const sendBtn = el('button', { class: 'chat-send-btn', onClick: sendMessage }, '发送');

  // ---- 渲染 ----
  function addMessage(msg) {
    const isSelf = msg.userId != null && String(msg.userId) === String(myId);
    messagesEl.append(
      el('div', { class: `chat-message ${isSelf ? 'self' : 'other'}` }, [
        el('div', { class: 'chat-message-avatar' }, avatarNode(msg.userId, 28)),
        el('div', { class: 'chat-message-body' }, [
          el('div', { class: 'chat-sender' }, [
            el('span', { class: `chat-scope chat-scope--${channel}` }, channel === 'global' ? '大厅' : '局内'),
            el('button', {
              class: 'chat-nickname',
              onClick: () => showUserCard(msg.userId),
            }, msg.nickname),
          ]),
          el('div', { class: 'chat-text' }, msg.message),
        ]),
      ])
    );
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function renderHistory() {
    messagesEl.innerHTML = '';
    history[channel].forEach(addMessage);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  // ---- 频道 ----
  function switchChannel(next) {
    channel = next;
    globalBtn.classList.toggle('active', channel === 'global');
    gameBtn.classList.toggle('active', channel === 'game');
    renderHistory();
  }

  // 局内按钮可用性 + 自动切换频道
  function updateChannel() {
    const inGame = myStatus === 'playing' || myStatus === 'spectating';
    gameBtn.disabled = !inGame;
    if (inGame && channel !== 'game') switchChannel('game');
    else if (!inGame && channel !== 'global') switchChannel('global');
  }

  // ---- 发送 ----
  function sendMessage() {
    const message = inputEl.value.trim();
    if (!message) return;
    if (channel === 'global') emit('chat_global', { message });
    else emit('chat_game', { message });
    inputEl.value = '';
  }

  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendMessage();
  });

  const panel = el('div', { class: 'chat-panel' }, [
    el('div', { class: 'chat-title' }, '💬 聊天'),
    selector,
    messagesEl,
    el('div', { class: 'chat-input-container' }, [inputEl, sendBtn]),
  ]);
  renderHistory();
  updateChannel();

  const viewRef = { channel, addMessage, renderHistory, updateChannel };
  floatViews.add(viewRef);
  return {
    panel,
    destroy() {
      floatViews.delete(viewRef);
      panel.remove();
    },
  };
}

/**
 * 渲染独立聊天视图（路由 #/chat）
 * 双栏布局：左侧栏（私信会话 + 在线玩家）+ 右侧主区（大厅/私聊），不区分频道。
 * @param {HTMLElement} container
 * @returns {Function} cleanup
 */
export function renderChat(container = viewRoot()) {
  container.innerHTML = '';

  let currentTarget = null; // null → 大厅（全局聊天）

  // ---- 左侧栏 ----
  const convBox = el('div', { class: 'chat-sidebar-section' });
  const onlineBox = el('div', { class: 'chat-sidebar-section' });
  const sidebar = el('aside', { class: 'chat-sidebar' }, [
    el('div', { class: 'chat-sidebar-title' }, '💌 私信'),
    convBox,
    el('div', { class: 'chat-sidebar-title' }, '👥 在线玩家'),
    onlineBox,
  ]);

  // ---- 右侧主区 ----
  const backBtn = el('button', { class: 'chat-back-btn', style: { display: 'none' }, onClick: openGlobal }, '← 大厅');
  const titleEl = el('div', { class: 'chat-page-title' }, '💬 大厅聊天');
  const messagesEl = el('div', { class: 'chat-messages' });
  const inputEl = el('input', { class: 'chat-input', placeholder: '输入消息...' });
  const sendBtn = el('button', { class: 'chat-send-btn', onClick: sendCurrent }, '发送');
  inputEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendCurrent(); });

  const panel = el('div', { class: 'chat-panel' }, [
    el('div', { class: 'chat-page-header' }, [backBtn, titleEl]),
    messagesEl,
    el('div', { class: 'chat-input-container' }, [inputEl, sendBtn]),
  ]);
  const main = el('div', { class: 'chat-main' }, [panel]);
  container.append(el('div', { class: 'chat-page' }, [sidebar, main]));

  // ---- 渲染 ----
  function messageNode(msg) {
    const isSelf = msg.userId != null && String(msg.userId) === String(myId);
    return el('div', { class: `chat-message ${isSelf ? 'self' : 'other'}` }, [
      el('div', { class: 'chat-message-avatar' }, avatarNode(msg.userId, 28)),
      el('div', { class: 'chat-message-body' }, [
        el('div', { class: 'chat-sender' }, [
          el('button', { class: 'chat-nickname', onClick: () => showUserCard(msg.userId) }, msg.nickname),
        ]),
        el('div', { class: 'chat-text' }, msg.message),
      ]),
    ]);
  }

  function renderMessages(list) {
    messagesEl.innerHTML = '';
    list.forEach((m) => messagesEl.append(messageNode(m)));
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function renderConvList() {
    convBox.innerHTML = '';
    if (!privateHistory.size) {
      convBox.append(el('div', { class: 'chat-online-empty' }, '暂无会话，点右侧玩家的「私信」开始'));
      return;
    }
    privateHistory.forEach((conv) => {
      const lastMsg = conv.messages[conv.messages.length - 1] || conv.lastMessage;
      convBox.append(el('button', {
        class: `chat-conv-item${currentTarget !== null && String(currentTarget) === String(conv.rawId) ? ' active' : ''}`,
        onClick: () => openPrivate(conv.rawId, conv.nickname),
      }, [
        el('div', { class: 'chat-conv-name' }, conv.nickname || `玩家${String(conv.rawId).slice(0, 4)}`),
        el('div', { class: 'chat-conv-preview' }, lastMsg ? lastMsg.message : '暂无消息'),
      ]));
    });
  }

  function renderOnline() {
    onlineBox.innerHTML = '';
    const list = getOnlineUsers();
    if (!list.length) {
      onlineBox.append(el('div', { class: 'chat-online-empty' }, '暂无在线玩家'));
      return;
    }
    list.forEach((u) => {
      const key = String(u.accountId);
      const isMe = myId && key === String(myId);
      const name = u.nickname || `玩家${key.slice(0, 4)}`;
      const status = u.status === 'playing' ? '游戏中' : u.status === 'waiting' ? '等待中' : '在线';
      onlineBox.append(el('div', { class: 'chat-online-item' }, [
        avatarNode(u.accountId, 28),
        el('div', { class: 'chat-online-info' }, [
          el('button', { class: 'chat-online-name', onClick: () => showUserCard(u.accountId) }, `${name}${isMe ? ' (我)' : ''}`),
          el('div', { class: 'chat-online-meta' }, `Lv.${u.level || 1} · ${status}`),
        ]),
        isMe ? null : el('button', { class: 'chat-online-btn', onClick: () => openPrivate(u.accountId, name) }, '💬 私信'),
      ]));
    });
  }

  // ---- 视图切换 ----
  function openGlobal() {
    currentTarget = null;
    backBtn.style.display = 'none';
    titleEl.textContent = '💬 大厅聊天';
    inputEl.placeholder = '输入消息...';
    renderMessages(history.global);
    renderConvList();
  }

  function openPrivate(targetId, nickname) {
    currentTarget = targetId;
    const conv = getPrivateConv(targetId, nickname);
    backBtn.style.display = '';
    titleEl.textContent = `💌 与 ${conv.nickname || '玩家'} 私聊`;
    inputEl.placeholder = `私信给 ${conv.nickname || '玩家'}...`;
    renderMessages(conv.messages);
    renderConvList();
    // 首次打开会话时从服务端拉取历史
    if (!conv.historyLoaded) {
      conv.historyLoaded = true;
      emit('get_private_history', { targetUserId: targetId });
    }
  }

  // ---- 发送 ----
  function sendCurrent() {
    const message = inputEl.value.trim();
    if (!message) return;
    if (currentTarget !== null) emit('chat_private', { targetUserId: currentTarget, message });
    else emit('chat_global', { message });
    inputEl.value = '';
  }

  // ---- 订阅 ----
  const onGlobalChange = () => { if (currentTarget === null) renderMessages(history.global); };
  const offGlobalMsg = eventBus.on('chat:message', onGlobalChange);
  const offGlobalHist = eventBus.on('chat:history', onGlobalChange);

  const viewRef = {
    onPrivateMessage: (conv, partnerId) => {
      renderConvList();
      if (currentTarget !== null && String(currentTarget) === String(partnerId)) renderMessages(conv.messages);
    },
    onConversations: () => renderConvList(),
    onPrivateHistory: (conv, partnerId) => {
      renderConvList();
      if (currentTarget !== null && String(currentTarget) === String(partnerId)) renderMessages(conv.messages);
    },
  };
  pageViews.add(viewRef);

  renderOnline();
  const unsubscribeOnline = subscribeOnlineUsers(renderOnline);
  emit('get_private_conversations'); // 拉取历史会话列表，恢复刷新前的私信记录
  openGlobal();

  return () => {
    offGlobalMsg();
    offGlobalHist();
    unsubscribeOnline();
    pageViews.delete(viewRef);
    container.innerHTML = '';
  };
}

/**
 * 常驻悬浮坞（右下角单个按钮，合并聊天窗 + 在线玩家）
 * 打开后为双 Tab 面板：💬 聊天 / 👥 在线，避免页面上多个浮动按钮碍眼。
 */
export function initFloatingChat() {
  if (document.querySelector('.float-dock')) return; // 防重复挂载

  let activeTab = 'chat';
  let chatView = null;
  let onlineEl = null;
  let unsubscribeOnline = null;

  const chatTabBtn = el('button', { class: 'float-dock-tab active', onClick: () => switchTab('chat') }, '💬 聊天');
  const onlineTabBtn = el('button', { class: 'float-dock-tab', onClick: () => switchTab('online') }, '👥 在线');
  const bodyEl = el('div', { class: 'float-dock-body' });
  const panel = el('div', { class: 'float-dock-panel', style: { display: 'none' } }, [
    el('div', { class: 'float-dock-tabs' }, [chatTabBtn, onlineTabBtn]),
    bodyEl,
  ]);
  const btn = el('button', { class: 'float-dock-btn', title: '聊天 / 在线', onClick: toggle }, '💬');
  document.body.append(btn, panel);

  function switchTab(tab) {
    activeTab = tab;
    chatTabBtn.classList.toggle('active', tab === 'chat');
    onlineTabBtn.classList.toggle('active', tab === 'online');
    bodyEl.innerHTML = '';
    if (tab === 'chat') {
      if (!chatView) chatView = createChatView();
      bodyEl.append(chatView.panel);
    } else {
      bodyEl.append(getOnlineList());
    }
  }

  /** 在线玩家列表（懒创建 + 单次订阅） */
  function getOnlineList() {
    if (onlineEl) return onlineEl;
    onlineEl = el('div', { class: 'float-dock-online' });
    const render = () => {
      onlineEl.innerHTML = '';
      const list = getOnlineUsers();
      if (!list.length) {
        onlineEl.append(el('div', { class: 'online-empty' }, '暂无在线玩家'));
        return;
      }
      list.forEach((u) => {
        const key = String(u.accountId);
        const isMe = myId && key === String(myId);
        const name = u.nickname || `玩家${key.slice(0, 4)}`;
        const status = u.status === 'playing' ? '游戏中' : u.status === 'waiting' ? '等待中' : '在线';
        onlineEl.append(el('div', { class: 'online-item' }, [
          avatarNode(u.accountId, 30),
          el('div', { class: 'online-item-info' }, [
            el('button', { class: 'online-item-name', onClick: () => showUserCard(u.accountId) }, `${name}${isMe ? ' (我)' : ''}`),
            el('div', { class: 'online-item-meta' }, `Lv.${u.level || 1} · ${status}`),
          ]),
          isMe ? null : el('button', { class: 'online-item-btn', onClick: () => sendChallenge(u.accountId) }, '挑战'),
        ]));
      });
    };
    unsubscribeOnline = subscribeOnlineUsers(render);
    render();
    return onlineEl;
  }

  function toggle() {
    const visible = panel.style.display !== 'none';
    panel.style.display = visible ? 'none' : 'flex';
    btn.classList.toggle('active', !visible);
    if (!visible) switchTab(activeTab);
  }
}
