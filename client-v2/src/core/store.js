/**
 * 集中状态管理（轻量 Store）
 *
 * 核心能力：集中存储、订阅/取消订阅、批量更新。
 * 状态变更时自动通知订阅者，视图通过 subscribe 响应更新。
 */

class Store {
  constructor() {
    this.state = {
      // 用户
      user: null,
      token: null,

      // 连接
      socketConnected: false,

      // 视图
      currentView: 'lobby',        // 当前视图 ID
      currentGame: null,           // 当前游戏 ID
      currentLayout: 'topnav',     // 当前布局

      // 大厅
      matching: false,             // 是否正在匹配
      currentRoom: null,           // 当前房间

      // 在线状态
      onlineCount: 0,
      onlinePlayers: [],           // 在线玩家列表

      // 游戏
      activeGames: [],             // 进行中的对局列表

      // 主题
      currentTheme: 'default',
    };
    /** @type {Map<string, Set<Function>>} */
    this.listeners = new Map();
  }

  /**
   * 读取状态
   * @param {string} key - 状态键名
   * @returns {*} 状态值
   */
  get(key) {
    return this.state[key];
  }

  /**
   * 更新状态并通知订阅者
   * @param {string} key - 状态键名
   * @param {*} value - 新值
   */
  set(key, value) {
    if (this.state[key] === value) return;  // 相同值不更新
    this.state[key] = value;
    this._notify(key, value);
  }

  /**
   * 批量更新
   * @param {Object} patch - { key: value, ... }
   */
  patch(patch) {
    Object.entries(patch).forEach(([key, value]) => this.set(key, value));
  }

  /**
   * 订阅某个 key 的变化
   * @param {string} key - 状态键名
   * @param {Function} fn - 回调函数，接收新值
   * @returns {Function} 取消订阅函数
   */
  subscribe(key, fn) {
    if (!this.listeners.has(key)) {
      this.listeners.set(key, new Set());
    }
    this.listeners.get(key).add(fn);
    // 立即触发一次，让订阅者拿到当前值
    fn(this.state[key]);
    return () => this.listeners.get(key).delete(fn);
  }

  /**
   * 通知指定 key 的订阅者
   * @param {string} key
   * @param {*} value
   */
  _notify(key, value) {
    const fns = this.listeners.get(key);
    if (fns) fns.forEach((fn) => fn(value));
  }
}

/** 全局唯一实例 */
export const store = new Store();
