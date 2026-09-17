/**
 * 用户资料卡（功能补齐）
 * 通过 GET /api/profile/:accountId 获取用户资料，modal 展示头像/昵称/等级/战绩/货币。
 * 供聊天消息头像点击、在线玩家头像点击等处复用。
 */
import { modal } from './modal.js';
import { el } from '../utils/dom.js';
import { api } from '../core/api.js';
import { avatarEl, fetchAvatarData } from '../utils/avatar.js';
import { goPlayer } from '../features/player/index.js';

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
      const profile2 = data.profile || {};
      const levelHidden = profile2.level == null;
      const stats = data.stats;
      const currency = data.currency;

      body.innerHTML = '';
      const bioText = (profile2.bio || '').trim();
      const bioEl = bioText
        ? el('div', { class: 'user-card-bio' }, bioText)
        : null;

      // 等级行：如果等级被隐藏，显示占位
      const levelMeta = levelHidden
        ? '🔒 等级私密'
        : `Lv.${profile2.level ?? 1} · ${profile2.exp ?? 0} EXP`;

      // 战绩行：stats 或 currency 为 null 时显示隐藏占位
      const statsChildren = [];
      if (stats != null) {
        statsChildren.push(el('span', {}, `🏆 胜 ${stats.totalWins ?? 0}`));
        statsChildren.push(el('span', {}, `⚔️ 局 ${stats.totalGames ?? 0}`));
      }
      if (currency != null) {
        statsChildren.push(el('span', {}, `💎 ${currency}`));
      }
      if (statsChildren.length === 0) {
        statsChildren.push(el('span', {}, '🔒 该用户隐藏了资料'));
      }

      body.append(
        avatarEl(avData?.cosmetics, avData?.cosmeticConfig, 64),
        el('div', { class: 'user-card-name' }, nickname),
        el('div', { class: 'user-card-meta' }, levelMeta),
        ...(bioEl ? [bioEl] : []),
        el('div', { class: 'user-card-stats' }, statsChildren),
        // 查看他人主页（部分公开数据）
        el('div', { class: 'user-card-footer' }, [
          el('button', { class: 'user-card-profile-btn', onClick: () => { modal.close(); goPlayer(userId); } }, '查看主页 ›'),
        ]),
      );
    })
    .catch(() => { body.textContent = '加载失败'; });
}
