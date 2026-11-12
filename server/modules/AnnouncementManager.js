const logger = require('../utils/logger');
const dataStore = require('../utils/dataStore');

const COLLECTION = 'announcements';

/** 公告类型（与前端展示文案保持一致） */
const TYPES = ['notice', 'update', 'event', 'maintenance'];

/** 弹窗策略：none 不弹 / once 一次性 / interval 周期弹一次 / always 有效期内常驻 */
const POPUP_MODES = ['none', 'once', 'interval', 'always'];

class AnnouncementManager {
  constructor() {
    this.operationLogger = null;
  }

  /** 是否已过期（expiresAt 为 0 / 空表示永不过期） */
  _isExpired(announcement, now = Date.now()) {
    return !!announcement.expiresAt && announcement.expiresAt <= now;
  }

  /** 排序：置顶优先，其次按发布时间倒序 */
  _sort(list) {
    return list.sort((a, b) => {
      const pinDiff = (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0);
      if (pinDiff !== 0) return pinDiff;
      return (b.createdAt || 0) - (a.createdAt || 0);
    });
  }

  /**
   * 获取公告列表
   * @param {Object} [options]
   * @param {boolean} [options.includeExpired=false] 是否包含已过期公告（后台管理用）
   */
  async list(options = {}) {
    try {
      const announcements = await dataStore.read(COLLECTION);
      const now = Date.now();
      const filtered = options.includeExpired
        ? announcements
        : announcements.filter((a) => !this._isExpired(a, now));
      // 不向客户端暴露各账号的弹窗已读记录
      return this._sort(filtered).map(({ popupSeen, ...rest }) => rest);
    } catch (err) {
      logger.error('获取公告列表失败', { error: err.message });
      return [];
    }
  }

  /**
   * 获取当前账号需要弹窗的公告
   * - once：从未弹过
   * - interval：距上次弹窗超过配置间隔
   * - always：有效期内每次都弹
   */
  async getPopupFor(accountId) {
    try {
      const announcements = await dataStore.read(COLLECTION);
      const now = Date.now();
      const result = announcements.filter((a) => {
        if (this._isExpired(a, now)) return false;
        if (!POPUP_MODES.includes(a.popupMode) || a.popupMode === 'none') return false;
        if (a.popupMode === 'always') return true;
        const lastShownAt = a.popupSeen?.[accountId] || 0;
        if (a.popupMode === 'once') return !lastShownAt;
        const intervalHours = Math.max(1, Number(a.popupIntervalHours) || 24);
        return !lastShownAt || now - lastShownAt >= intervalHours * 3600 * 1000;
      });
      return this._sort(result).map(({ popupSeen, ...rest }) => rest);
    } catch (err) {
      logger.error('获取弹窗公告失败', { error: err.message });
      return [];
    }
  }

  /** 记录某账号已看过弹窗公告 */
  async ackPopup(id, accountId) {
    if (!accountId) return { success: false, message: '缺少账号信息' };
    try {
      const list = await dataStore.read(COLLECTION);
      const item = list.find((a) => a.id === id);
      if (!item) return { success: false, message: '公告不存在' };
      item.popupSeen = { ...(item.popupSeen || {}), [accountId]: Date.now() };
      await dataStore.write(COLLECTION, list);
      return { success: true };
    } catch (err) {
      logger.error('记录弹窗已读失败', { id, error: err.message });
      return { success: false, message: '记录失败' };
    }
  }

  /** 获取单条公告 */
  async get(id) {
    const list = await dataStore.read(COLLECTION);
    return list.find((a) => a.id === id) || null;
  }

  _normalizePayload(data = {}) {
    const title = String(data.title || '').trim();
    const content = String(data.content || '').trim();
    const type = TYPES.includes(data.type) ? data.type : 'notice';
    const pinned = !!data.pinned;
    const expiresAt = Number(data.expiresAt) > 0 ? Number(data.expiresAt) : 0;
    const popupMode = POPUP_MODES.includes(data.popupMode) ? data.popupMode : 'none';
    const popupIntervalHours = Math.max(1, Number(data.popupIntervalHours) || 24);
    return { title, content, type, pinned, expiresAt, popupMode, popupIntervalHours };
  }

  /** 发布公告 */
  async create(data, operator = {}) {
    const { title, content, type, pinned, expiresAt, popupMode, popupIntervalHours }
      = this._normalizePayload(data);
    if (!title || !content) {
      return { success: false, message: '标题和内容不能为空' };
    }

    try {
      const announcement = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
        title,
        content,
        type,
        pinned,
        expiresAt,
        popupMode,
        popupIntervalHours,
        popupSeen: {},
        authorId: operator.accountId || '',
        authorName: operator.username || '管理员',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      await dataStore.add(COLLECTION, announcement);
      logger.info('公告已发布', { id: announcement.id, title });

      if (this.operationLogger) {
        this.operationLogger.getAdminAction(
          operator.accountId || '',
          operator.username || '管理员',
          'announcement_create',
          announcement.id,
          title,
          { type, pinned }
        );
      }

      return { success: true, announcement };
    } catch (err) {
      logger.error('发布公告失败', { error: err.message });
      return { success: false, message: '发布失败' };
    }
  }

  /** 编辑公告 */
  async update(id, data, operator = {}) {
    try {
      const list = await dataStore.read(COLLECTION);
      const index = list.findIndex((a) => a.id === id);
      if (index === -1) return { success: false, message: '公告不存在' };

      const merged = this._normalizePayload({ ...list[index], ...data });
      if (!merged.title || !merged.content) {
        return { success: false, message: '标题和内容不能为空' };
      }

      list[index] = {
        ...list[index],
        ...merged,
        updatedAt: Date.now(),
      };
      await dataStore.write(COLLECTION, list);
      logger.info('公告已更新', { id });

      if (this.operationLogger) {
        this.operationLogger.getAdminAction(
          operator.accountId || '',
          operator.username || '管理员',
          'announcement_update',
          id,
          merged.title,
          { type: merged.type, pinned: merged.pinned }
        );
      }

      return { success: true, announcement: list[index] };
    } catch (err) {
      logger.error('更新公告失败', { id, error: err.message });
      return { success: false, message: '更新失败' };
    }
  }

  /** 删除公告 */
  async remove(id, operator = {}) {
    try {
      const list = await dataStore.read(COLLECTION);
      const target = list.find((a) => a.id === id);
      if (!target) return { success: false, message: '公告不存在' };

      await dataStore.write(COLLECTION, list.filter((a) => a.id !== id));
      logger.info('公告已删除', { id });

      if (this.operationLogger) {
        this.operationLogger.getAdminAction(
          operator.accountId || '',
          operator.username || '管理员',
          'announcement_delete',
          id,
          target.title || ''
        );
      }

      return { success: true };
    } catch (err) {
      logger.error('删除公告失败', { id, error: err.message });
      return { success: false, message: '删除失败' };
    }
  }
}

module.exports = new AnnouncementManager();
