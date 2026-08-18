// 好友系统（MVP）：好友申请 / 同意 / 拒绝 / 删除 / 列表
// 数据存储于 data/friendships.json（普通集合，数组结构）
const dataStore = require('../utils/dataStore');
const logger = require('../utils/logger');

const COLLECTION = 'friendships';

class FriendsManager {
  constructor() {
    this.userManager = null;   // 注入：查询在线状态
    this.accountManager = null; // 注入：查询账号公开信息
    // 写操作串行队列，避免并发读改写造成数据丢失
    this._chain = Promise.resolve();
  }

  _serialize(fn) {
    const run = this._chain.then(() => fn(), () => fn());
    this._chain = run.catch(() => {});
    return run;
  }

  async _all() {
    return (await dataStore.read(COLLECTION)) || [];
  }

  async _save(list) {
    await dataStore.write(COLLECTION, list);
  }

  // 双方规范化键：与顺序无关
  _key(a, b) {
    return [String(a), String(b)].sort().join('|');
  }

  // 批量获取玩家公开信息（accountId -> {accountId, nickname, level, lastLogin}）
  async _batchInfo(ids) {
    const map = {};
    const set = new Set(ids.map(String));
    if (!set.size) return map;
    const accounts = await dataStore.read('accounts');
    for (const acc of accounts) {
      const accId = acc && acc.account && acc.account.id;
      if (accId && set.has(String(accId))) {
        const { level } = this.accountManager.calculateLevelAndExp(acc.account.exp || 0);
        map[String(accId)] = {
          accountId: accId,
          nickname: acc.account.nickname || acc.username || `玩家${String(accId).slice(0, 4)}`,
          level,
          lastLogin: acc.account.lastLogin || null,
        };
      }
    }
    return map;
  }

  // 单个玩家公开信息
  async _info(accountId) {
    const map = await this._batchInfo([accountId]);
    return map[String(accountId)] || null;
  }

  /**
   * 获取好友状态
   * @returns {Promise<{friends: Array, pendingIn: Array, pendingOut: Array}>}
   *  friends:   已互为好友的玩家公开信息
   *  pendingIn: 收到的待处理申请（{from, createdAt}）
   *  pendingOut: 已发出待对方同意的 accountId 列表
   */
  async getFriendState(accountId) {
    const id = String(accountId);
    const list = await this._all();
    const mine = list.filter((f) => f.a === id || f.b === id);
    const friends = [];
    const pendingIn = [];
    const pendingOut = [];
    for (const f of mine) {
      const partner = f.a === id ? f.b : f.a;
      if (f.status === 'accepted') {
        friends.push(partner);
      } else if (f.requester !== id) {
        pendingIn.push({ from: partner, createdAt: f.createdAt });
      } else {
        pendingOut.push(partner);
      }
    }
    const allIds = [...new Set([...friends, ...pendingIn.map((p) => p.from), ...pendingOut])];
    const info = await this._batchInfo(allIds);
    return {
      friends: friends.map((fid) => info[String(fid)]).filter(Boolean),
      pendingIn: pendingIn
        .map((p) => ({ from: info[String(p.from)] || null, createdAt: p.createdAt }))
        .filter((p) => p.from),
      pendingOut,
    };
  }

  /**
   * 发起好友申请
   * 若对方已申请过自己，则自动互为好友
   */
  async request(requesterId, targetId) {
    requesterId = String(requesterId);
    targetId = String(targetId);
    if (requesterId === targetId) return { success: false, message: '不能添加自己为好友' };

    // 目标账号必须存在
    const target = await dataStore.findOne('accounts', { 'account.id': targetId });
    if (!target) return { success: false, message: '对方不存在' };

    return this._serialize(async () => {
      const list = await this._all();
      const key = this._key(requesterId, targetId);
      const existing = list.find((f) => f.key === key);
      if (existing) {
        if (existing.status === 'accepted') return { success: false, message: '你们已经是好友了' };
        if (existing.requester === requesterId) return { success: false, message: '已发送过好友申请，请等待对方同意' };
        // 对方先申请过自己：直接互为好友
        existing.status = 'accepted';
        existing.respondedAt = Date.now();
        existing.responder = requesterId;
        await this._save(list);
        const requesterInfo = await this._info(requesterId);
        return {
          success: true,
          autoAccepted: true,
          message: `对方已申请过你，已自动互为好友`,
          fromNickname: requesterInfo ? requesterInfo.nickname : null,
          createdAt: existing.createdAt,
        };
      }
      list.push({
        id: Date.now().toString(36) + Math.random().toString(36).substr(2, 6),
        key,
        a: [requesterId, targetId].sort()[0],
        b: [requesterId, targetId].sort()[1],
        status: 'pending',
        requester: requesterId,
        createdAt: Date.now(),
      });
      await this._save(list);
      const requesterInfo = await this._info(requesterId);
      return {
        success: true,
        autoAccepted: false,
        message: '好友申请已发送',
        fromNickname: requesterInfo ? requesterInfo.nickname : null,
        createdAt: Date.now(),
      };
    });
  }

  /**
   * 同意 / 拒绝好友申请
   * @param {string} userId - 当前操作者
   * @param {string} requesterId - 申请发起者
   * @param {boolean} accept
   */
  async respond(userId, requesterId, accept) {
    userId = String(userId);
    requesterId = String(requesterId);
    return this._serialize(async () => {
      const list = await this._all();
      const key = this._key(userId, requesterId);
      const idx = list.findIndex(
        (f) => f.key === key && f.status === 'pending' && f.requester === requesterId
      );
      if (idx === -1) return { success: false, message: '好友申请不存在或已处理' };

      if (!accept) {
        list.splice(idx, 1);
        await this._save(list);
        return { success: true, message: '已拒绝该好友申请' };
      }

      list[idx].status = 'accepted';
      list[idx].respondedAt = Date.now();
      list[idx].responder = userId;
      await this._save(list);
      const responderInfo = await this._info(userId);
      return {
        success: true,
        message: '已添加好友',
        responderNickname: responderInfo ? responderInfo.nickname : null,
      };
    });
  }

  /** 删除好友（删除双方关系记录） */
  async remove(accountId, friendId) {
    accountId = String(accountId);
    friendId = String(friendId);
    return this._serialize(async () => {
      const list = await this._all();
      const key = this._key(accountId, friendId);
      const idx = list.findIndex((f) => f.key === key && f.status === 'accepted');
      if (idx === -1) return { success: false, message: '你们还不是好友' };
      list.splice(idx, 1);
      await this._save(list);
      return { success: true, message: '已删除好友' };
    });
  }
}

module.exports = FriendsManager;
