/**
 * 全局事件总线（Pub/Sub）
 *
 * 用于模块间解耦通信：
 * - socket 层将 socket 事件统一转为 eventBus 事件（如 'game:update'）
 * - 业务模块只订阅 eventBus 事件，不直接接触 socket
 *
 * 事件命名规范：namespace:event（如 'lobby:matchFound'）
 */

class EventBus {
  constructor() {
    /** @type {Map<string, Set<Function>>} */
    this.listeners = new Map();
  }

  /**
   * 订阅事件
   * @param {string} event - 事件名（namespace:event）
   * @param {Function} fn - 回调函数，接收事件数据
   * @returns {Function} 取消订阅函数
   */
  on(event, fn) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event).add(fn);
    return () => this.off(event, fn);
  }

  /**
   * 取消订阅
   * @param {string} event - 事件名
   * @param {Function} fn - 订阅时的回调函数
   */
  off(event, fn) {
    const fns = this.listeners.get(event);
    if (fns) fns.delete(fn);
  }

  /**
   * 触发事件
   * @param {string} event - 事件名
   * @param {*} data - 事件数据
   */
  emit(event, data) {
    const fns = this.listeners.get(event);
    if (!fns) return;
    fns.forEach((fn) => {
      try {
        fn(data);
      } catch (err) {
        console.error(`[EventBus] 事件处理器异常: ${event}`, err);
      }
    });
  }

  /**
   * 订阅一次性事件（触发后自动取消订阅）
   * @param {string} event - 事件名
   * @param {Function} fn - 回调函数
   * @returns {Function} 取消订阅函数
   */
  once(event, fn) {
    const off = this.on(event, (data) => {
      off();
      fn(data);
    });
    return off;
  }

  /**
   * 移除指定事件的全部监听器
   * @param {string} event - 事件名
   */
  removeAll(event) {
    this.listeners.delete(event);
  }
}

/** 全局唯一实例 */
export const eventBus = new EventBus();
