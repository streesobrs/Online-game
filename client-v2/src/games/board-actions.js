/**
 * 对局道具与提示工具（补齐 v1 悔棋/提示的库存逻辑）
 * 复刻 v1 requestUndo / requestHint：
 * - 库存检查：直接次数 + 道具卡折算（悔棋卡 1 张 = 3 次，提示卡 1 张 = 5 次）
 * - 直接次数不足但有道具卡 → 自动消耗（game_use_item），服务端回 game_item_used 后重试请求
 * - 通用提示标记：在棋盘格子上高亮推荐落子位置（gobang/go 通用）
 */
import { eventBus } from '../core/eventBus.js';
import { emit } from '../core/socket.js';
import { toast } from '../components/toast.js';
import { api } from '../core/api.js';

// 待重试动作（道具卡使用成功后执行）
let pendingAction = null;

// 道具卡生效回执：成功后执行待重试动作（此时库存已更新为直接次数）
eventBus.on('game:itemUsed', (data) => {
  if (!data) return;
  if (!data.success) {
    toast.error(`❌ 使用道具失败：${data.message || '未知错误'}`);
    pendingAction = null;
    return;
  }
  const act = pendingAction;
  pendingAction = null;
  if (act && act.itemId === data.itemId && typeof act.onReady === 'function') {
    const isUndo = data.itemId === 'item_undo';
    toast.success(`✅ ${isUndo ? '悔棋卡' : '提示卡'}已生效`);
    act.onReady();
  }
});

/** 获取服务端权威库存（{undoCount, hintCount, items}） */
async function getInventory() {
  const userId = localStorage.getItem('currentAccountId');
  if (!userId) return {};
  try {
    const res = await api.shop.getInventory(userId);
    return res?.inventory || {};
  } catch (err) {
    console.warn('[v2] 获取对局道具库存失败:', err);
    return {};
  }
}

/**
 * 悔棋入口（对齐 v1 requestUndo）
 * @param {Function} onReady - 库存充足时直接发起悔棋（emit undo_request）
 */
export async function requestUndo(onReady) {
  const inv = await getInventory();
  const undoCount = inv.undoCount || 0;
  const itemUndoCount = (inv.items?.item_undo || 0) * 3;
  if (undoCount + itemUndoCount <= 0) {
    toast.warn('⏪ 悔棋次数不足，请前往商城购买悔棋卡');
    return;
  }
  if (undoCount <= 0) {
    pendingAction = { itemId: 'item_undo', onReady };
    emit('game_use_item', { itemId: 'item_undo' });
    toast.info('⏪ 正在使用悔棋卡...');
    return;
  }
  onReady();
}

/**
 * 提示入口（对齐 v1 requestHint）
 * @param {Function} onReady - 库存充足时直接发起提示（emit request_hint）
 */
export async function requestHint(onReady) {
  const inv = await getInventory();
  const hintCount = inv.hintCount || 0;
  const itemHintCount = (inv.items?.item_hint || 0) * 5;
  if (hintCount + itemHintCount <= 0) {
    toast.warn('💡 提示次数不足，请前往商城购买提示卡');
    return;
  }
  if (hintCount <= 0) {
    pendingAction = { itemId: 'item_hint', onReady };
    emit('game_use_item', { itemId: 'item_hint' });
    toast.info('💡 正在使用提示卡...');
    return;
  }
  onReady();
}

/**
 * 清除棋盘上的提示标记（落子时调用）
 * @param {HTMLElement} boardEl - 棋盘根元素
 */
export function clearHintMarkers(boardEl) {
  if (!boardEl) return;
  boardEl.querySelectorAll('.hint-marker').forEach((m) => m.remove());
  boardEl.querySelectorAll('.hint-highlight').forEach((c) => c.classList.remove('hint-highlight'));
}

/** 在格子上挂提示标记 */
function placeMarker(cell, cls, text) {
  if (!cell) return;
  cell.classList.add('hint-highlight');
  const marker = document.createElement('div');
  marker.className = cls;
  marker.textContent = text;
  marker.style.pointerEvents = 'none';
  cell.appendChild(marker);
}

/**
 * 在棋盘上高亮推荐位置
 * @param {HTMLElement} boardEl - 棋盘根元素
 * @param {{r: number, c: number}|{fromR: number, fromC: number, toR: number, toC: number}} move
 *        gobang/go 传 {r, c}；象棋传 {fromR, fromC, toR, toC}（起点 📤 + 目标 💡）
 * @param {string} [label='💡'] - 目标标记文案
 */
export function showHintMarker(boardEl, move, label = '💡') {
  clearHintMarkers(boardEl);
  if (!boardEl || !move) return;
  // 象棋走法：起点 + 目标
  if (move.toR != null && move.toC != null) {
    placeMarker(boardEl.querySelector(`[data-r="${move.fromR}"][data-c="${move.fromC}"]`), 'hint-marker hint-marker-small', '📤');
    placeMarker(boardEl.querySelector(`[data-r="${move.toR}"][data-c="${move.toC}"]`), 'hint-marker', label);
    return;
  }
  // 落子点（gobang/go）
  if (move.r != null && move.c != null) {
    placeMarker(boardEl.querySelector(`[data-r="${move.r}"][data-c="${move.c}"]`), 'hint-marker', label);
  }
}
