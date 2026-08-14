/**
 * 聊天模块（任务 4.1.1）
 * 复刻 v1 聊天面板：全局聊天 + 局内聊天双频道，历史切换、频道自动切换。
 * 架构要点：
 * 1. 消息/状态监听为模块级常驻（对齐 v1 单页 socket.on 全局监听），
 *    保证对局中（聊天视图未挂载时）的局内消息不丢失。
 * 2. 视图逻辑抽成 createChatView()，同时服务 #/chat 独立视图 与 常驻浮动聊天窗
 *    （initFloatingChat），两处共享同一份历史与状态。
 */
import { eventBus } from '../../core/eventBus.js';
import { emit } from '../../core/socket.js';
import { el, viewRoot } from '../../utils/dom.js';
import { toast } from '../../components/toast.js';

const MAX_HISTORY = 100; // 每频道保留上限（与 v1 一致）

// ===== 模块级状态（常驻，跨视图保留）=====
const history = { global: [], game: [] }; // 按频道存 { userId, nickname, message, scope, timestamp }
let myStatus = 'online';                 // 自己的用户状态（online/playing/spectating）
const views = new Set();                 // 所有活动聊天视图（#/chat + 浮动窗）

/** 全局常驻：接收聊天消息 → 存入历史（按 messageId 去重）；所有频道匹配的活动视图即时渲染 */
eventBus.on('chat:message', (data) => {
  const scope = data.scope === 'game' ? 'game' : 'global';
  const msg = {
    messageId: data.messageId,
    userId: data.userId,
    nickname: data.nickname || '玩家',
    message: data.message,
    scope,
    timestamp: data.timestamp || Date.now(),
  };
  if (msg.messageId && history[scope].some((m) => m.messageId === msg.messageId)) return;
  history[scope].push(msg);
  if (history[scope].length > MAX_HISTORY) history[scope].shift();
  views.forEach((v) => { if (v.channel === scope) v.addMessage(msg); });
});

/**
 * 全局常驻：聊天历史响应（get_chat_history）
 * 合并进对应频道历史（按 messageId 去重），刷新所有活动视图（任务 4.1.2）
 */
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
  views.forEach((v) => { if (v.channel === scope) v.renderHistory(); });
});

// 进入应用即加载全局聊天历史（对齐服务端 get_chat_history → chat_history）。
// 注意：socket 未连接时 emit 会丢弃事件，故连接成功后需补拉一次。
function loadGlobalHistory() {
  emit('get_chat_history', { scope: 'global' });
}
loadGlobalHistory();
eventBus.on('socket:connect', loadGlobalHistory);

/** 全局常驻：聊天错误提示（禁言/频繁/维护等） */
eventBus.on('chat:error', (data) => {
  console.warn('[Chat] 聊天错误:', data);
  toast.error(data?.message || '消息发送失败');
});

/** 全局常驻：系统广播（被禁言时的广播通知等） */
eventBus.on('system:broadcast', (data) => {
  if (data?.message) toast.show(data.message);
});

/** 全局常驻：自己的用户状态变化（匹配成功/返回大厅等）→ 更新所有视图的局内频道可用性 */
const myId = localStorage.getItem('currentAccountId');
eventBus.on('user:status', (data) => {
  if (data.accountId != null && String(data.accountId) === String(myId)) {
    myStatus = data.status || myStatus;
    views.forEach((v) => v.updateChannel());
  }
});

/**
 * 创建聊天视图（面板 DOM + 交互），供独立视图与浮动窗复用
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
        el('div', { class: 'chat-sender' }, [
          el('span', { class: `chat-scope chat-scope--${channel}` }, channel === 'global' ? '大厅' : '局内'),
          el('span', { class: 'chat-nickname' }, msg.nickname),
        ]),
        el('div', { class: 'chat-text' }, msg.message),
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

  // 局内按钮可用性 + 自动切换频道（对齐 v1 updateGameChannelButton）
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
  views.add(viewRef);
  return {
    panel,
    destroy() {
      views.delete(viewRef);
      panel.remove();
    },
  };
}

/**
 * 渲染独立聊天视图（路由 #/chat）
 * @param {HTMLElement} container
 * @returns {Function} cleanup
 */
export function renderChat(container = viewRoot()) {
  const { panel, destroy } = createChatView();
  container.innerHTML = '';
  container.append(panel);
  return () => {
    destroy();
    container.innerHTML = '';
  };
}

/**
 * 常驻浮动聊天窗（任意页面随时聊天）
 * 右下角气泡按钮，点击展开/收起；面板复用 createChatView，与 #/chat 视图共享历史与状态。
 */
export function initFloatingChat() {
  if (document.querySelector('.chat-float-btn')) return; // 防重复挂载

  let floatView = null;
  const floatPanel = el('div', { class: 'chat-float-panel', style: 'display:none;' });

  const btn = el('button', { class: 'chat-float-btn', title: '聊天', onClick: toggle }, '💬');

  function toggle() {
    // 首次打开时创建视图
    if (!floatView) {
      const created = createChatView();
      floatView = created;
      floatPanel.append(created.panel);
    }
    const visible = floatPanel.style.display !== 'none';
    floatPanel.style.display = visible ? 'none' : 'flex';
    btn.classList.toggle('active', !visible);
  }

  document.body.append(btn, floatPanel);
}
