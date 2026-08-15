/**
 * 用户资料卡（功能补齐）
 * 通过 GET /api/profile/:accountId 获取用户资料，modal 展示头像/昵称/等级/战绩/货币。
 * 供聊天消息头像点击、在线玩家头像点击等处复用。
 */
import { modal } from './modal.js';
import { el } from '../utils/dom.js';
import { api } from '../core/api.js';
import { avatarEl, fetchAvatarData } from '../utils/avatar.js';

/**
 * 展示用户资料卡
 * @param {string} userId - 目标用户 accountId
 */
export function showUserCard(userId) {
  if (!userId) return;
  const body = el('div', { class: 'user-card-body' }, '加载中...');
  modal.show({
    title: '用户信息',
    content: body,
    confirmText: '关闭',
    showCancel: false,
  });

  Promise.all([api.profile.get(userId), fetchAvatarData(userId)])
    .then(([profile, avData]) => {
      const data = profile?.success ? profile.data : null;
      if (!data) { body.textContent = '未获取到该用户信息'; return; }
      const acc = data.account || {};
      const nickname = acc.nickname || acc.username || '玩家';
      const level = data.profile?.level ?? 1;
      const exp = data.profile?.exp ?? 0;
      const stats = data.stats || {};
      const currency = data.currency || 0;

      body.innerHTML = '';
      body.append(
        avatarEl(avData?.cosmetics, avData?.cosmeticConfig, 64),
        el('div', { class: 'user-card-name' }, nickname),
        el('div', { class: 'user-card-meta' }, `Lv.${level} · ${exp} EXP`),
        el('div', { class: 'user-card-stats' }, [
          el('span', {}, `🏆 胜 ${stats.totalWins ?? 0}`),
          el('span', {}, `⚔️ 局 ${stats.totalGames ?? 0}`),
          el('span', {}, `💎 ${currency}`),
        ]),
      );
    })
    .catch(() => { body.textContent = '加载失败'; });
}
