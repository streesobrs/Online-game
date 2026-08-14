/**
 * Socket.io 客户端封装
 * socket.io 通过 <script src="/socket.io/socket.io.js"> 全局引入（挂到 window.io）。
 * 职责：
 * 1. 建立连接并监听连接状态（更新 store + 转发 eventBus）
 * 2. 将 socket 接收事件统一转为 eventBus 事件（业务模块不直接接触 socket）
 * 3. 提供 emit() 统一发送方法（事件名与 v1 一致）
 *
 * 事件映射依据：开发文档附录 A（v1 完整 Socket 事件清单）。
 */
import { eventBus } from './eventBus.js';
import { store } from './store.js';

const io = window.io;

// 连接配置与 v1 一致（不传 token 到 query，token 通过 client_connect 事件发送）
export const socket = io({
  transports: ['websocket', 'polling'],
  autoConnect: true,
  reconnection: true,
  reconnectionAttempts: 5,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  timeout: 20000,
});

// ===== 连接状态 =====
// 客户端版本号：与 v1 一致从 /version（服务端 version.json）动态获取（主版本必须与服务端一致）
let clientVersion = '1.6.0';
fetch('/version')
  .then((r) => r.json())
  .then((d) => {
    if (d && d.version) clientVersion = d.version;
  })
  .catch(() => { });

socket.on('connect', () => {
  store.set('socketConnected', true);
  console.log('[Socket] 已连接');
  // 对齐 v1：发送 client_connect（含版本号与 token），
  // 服务端 handleUserConnection 据此绑定账号并置 status='online'，
  // 已登录则回发 login_result（自动登录），这是匹配等操作的前置条件。
  socket.emit('client_connect', {
    clientVersion,
    token: localStorage.getItem('userToken') || 'none',
  });
  eventBus.emit('socket:connect');
});

socket.on('disconnect', () => {
  store.set('socketConnected', false);
  console.warn('[Socket] 连接断开');
  eventBus.emit('socket:disconnect');
});

socket.on('reconnect', () => {
  console.log('[Socket] 重连成功');
  eventBus.emit('socket:reconnect');
});

socket.on('reconnect_attempt', (attemptNumber) => {
  eventBus.emit('socket:reconnectAttempt', attemptNumber);
});

socket.on('reconnect_failed', () => {
  console.warn('[Socket] 重连失败');
  eventBus.emit('socket:reconnectFailed');
});

// ===== 业务事件分发（socket.on → eventBus.emit）=====
const EVENT_MAP = {
  // 版本
  version_check: 'system:versionCheck',

  // 用户与账号
  user_connected: 'user:connected',
  online_users: 'user:onlineUsers',
  user_status: 'user:status',
  account_info: 'user:accountInfo',
  account_action_result: 'user:accountActionResult',
  account_updated: 'user:accountUpdated',
  login_result: 'user:loginResult',
  exp_gained: 'user:expGained',
  mail_received: 'user:mailReceived',

  // 大厅与匹配
  match_success: 'lobby:matchSuccess',
  match_timeout: 'lobby:matchTimeout',
  return_lobby: 'lobby:return',
  opponent_left: 'lobby:opponentLeft',
  challenge_received: 'lobby:challengeReceived',
  challenge_sent: 'lobby:challengeSent',
  challenge_accepted: 'lobby:challengeAccepted',
  challenge_rejected: 'lobby:challengeRejected',

  // 游戏对战（棋类）
  move: 'game:move',
  game_ended: 'game:ended',
  reset: 'game:reset',
  reset_accepted: 'game:resetAccepted',
  reset_rejected: 'game:resetRejected',
  reset_request: 'game:resetRequest',
  reset_request_timeout: 'game:resetRequestTimeout',
  game_reset: 'game:resetDone',
  game_message: 'game:message',
  game_warning: 'game:warning',
  game_replay: 'game:replay',
  inactive_warning: 'game:inactiveWarning',
  undo_request: 'game:undoRequest',
  undo_request_sent: 'game:undoRequestSent',
  undo_accepted: 'game:undoAccepted',
  undo_rejected: 'game:undoRejected',
  undo_deduct: 'game:undoDeduct',
  game_item_used: 'game:itemUsed',
  hint_result: 'game:hintResult',
  hint_deduct: 'game:hintDeduct',

  // 贪吃蛇专属
  snake_match_found: 'snake:matchFound',
  snake_match_cancelled: 'snake:matchCancelled',
  snake_opponent_update: 'snake:opponentUpdate',
  snake_game_over: 'snake:gameOver',
  snake_food_sync: 'snake:foodSync',
  snake_full_state_sync: 'snake:fullStateSync',

  // AI 对战
  ai_game_start: 'ai:gameStart',
  ai_move_result: 'ai:moveResult',
  ai_game_end: 'ai:gameEnd',

  // 聊天
  chat_message: 'chat:message',
  chat_error: 'chat:error',
  chat_history: 'chat:history',

  // 成就与排行
  achievements_unlocked: 'achievement:unlocked',
  achievements_list: 'achievement:list',
  leaderboard: 'leaderboard:update',
  my_rank: 'leaderboard:myRank',
  game_history: 'history:update',

  // 观战
  spectate_list: 'spectate:list',
  spectate_joined: 'spectate:joined',

  // 系统与维护
  error: 'system:error',
  system_broadcast: 'system:broadcast',
  admin_message: 'system:adminMessage',
  maintenance_notice: 'system:maintenanceNotice',
  maintenance_scheduled: 'system:maintenanceScheduled',
  maintenance_countdown: 'system:maintenanceCountdown',
  maintenance_blocked: 'system:maintenanceBlocked',
  maintenance_kick: 'system:maintenanceKick',
};

Object.entries(EVENT_MAP).forEach(([socketEvent, busEvent]) => {
  socket.on(socketEvent, (data) => {
    eventBus.emit(busEvent, data);
  });
});

/**
 * 主动发送 socket 事件
 * @param {string} event - 事件名（与 v1 一致，见附录 A）
 * @param {*} [data] - 数据
 */
export function emit(event, data) {
  if (socket.connected) {
    socket.emit(event, data);
  } else {
    console.warn('[Socket] 未连接，事件已丢弃:', event);
  }
}
