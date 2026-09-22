/**
 * 对局活跃续期
 *
 * 服务端按「长时间无操作」判定挂机并踢下线（config.session.inactiveWarningTime /
 * game.inactivityTimeout）。但单机 / 本地判定的玩法（消消乐、AI 对战等）在对局中
 * 可能长时间不与服务端通信，玩家实际一直在操作却被判挂机，
 * 被踢后对局结算上报随之丢失（match3_game_end / ai_game_result 等静默失败）。
 *
 * 进入对局期间由本模块定时上报轻量活跃信号续期会话，退出对局立即停止。
 */
import { eventBus } from './eventBus.js';
import { emit } from './socket.js';

// 心跳间隔：需明显小于服务端 inactiveWarningTime（15 分钟），留足抖动余量
const HEARTBEAT_INTERVAL = 5 * 60 * 1000;

// 对局只可能发生在这两个视图内（消消乐是独立路由，其余玩法都在统一大厅内）
const GAME_VIEWS = new Set(['games', 'match3']);

let active = false;
let timer = null;

/** 进入对局：立即续期一次，之后定时心跳 */
export function startGameActivity() {
  if (active) return;
  active = true;
  emit('user_activity');
  timer = setInterval(() => emit('user_activity'), HEARTBEAT_INTERVAL);
}

/** 退出对局：停止心跳 */
export function stopGameActivity() {
  if (!active) return;
  active = false;
  clearInterval(timer);
  timer = null;
}

// 路由视图的 cleanup 不会被路由调用（见 main.js 的 lazyView），
// 离开游戏视图时在这里兜底停止，避免心跳常驻。
eventBus.on('route:change', (id) => {
  if (!GAME_VIEWS.has(id)) stopGameActivity();
});
