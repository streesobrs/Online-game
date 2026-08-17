/**
 * 全局系统事件监听（补齐 v1 客户端缺失的收尾事件）
 * - 维护模式：notice / scheduled / countdown / blocked / kick（顶部横幅 + toast）
 * - 版本检查：version_check（版本不兼容提示）
 * - 管理员消息：admin_message（toast 广播，与 system_broadcast 一致）
 * - 游戏警告：game_warning（toast 提示）
 * - 挂机警告：inactive_warning（warning/critical 分级 toast）
 * - 管理员强制重置：game_reset（toast + 返回游戏大厅）
 *
 * socket.js 仅做事件名映射，本模块在应用启动时注册一次监听。
 */
import { eventBus } from './eventBus.js';
import { store } from './store.js';
import { el } from '../utils/dom.js';
import { toast } from '../components/toast.js';
import { go } from './router.js';
import { socket, emit } from './socket.js';

let bannerEl = null;        // 维护中横幅
let scheduleEl = null;      // 维护预告横幅
let countdownTimer = null;
let scheduleTimer = null;
let styleInjected = false;
// 经验/升级动画状态（会话内跟踪，对齐 v1 lastExp/lastLevel）
let lastExp = null;
let lastLevel = null;

const SYSTEM_STYLE = `
.system-banner{position:fixed;top:0;left:0;right:0;z-index:9999;padding:10px 16px;color:#fff;font-size:13px;display:flex;align-items:center;justify-content:center;gap:8px;box-shadow:0 2px 10px rgba(0,0,0,.25);cursor:pointer}
.system-banner--maintenance{background:linear-gradient(90deg,#dc2626,#ef4444,#dc2626);background-size:200% 100%;animation:system-shimmer 3s linear infinite}
.system-banner--schedule{background:linear-gradient(90deg,#b45309,#d97706,#b45309);background-size:200% 100%;animation:system-shimmer 3s linear infinite}
.system-banner--urgent{background:linear-gradient(90deg,#dc2626,#ef4444,#dc2626);background-size:200% 100%;animation:system-shimmer 1.5s linear infinite}
@keyframes system-shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}
.exp-animation{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);font-size:32px;font-weight:bold;color:#4299e1;text-shadow:0 0 20px rgba(66,153,225,.5);pointer-events:none;z-index:9999;animation:system-exp-float 2s ease-out forwards}
@keyframes system-exp-float{0%{opacity:0;transform:translate(-50%,-40%) scale(.8)}20%{opacity:1;transform:translate(-50%,-50%) scale(1.05)}60%{opacity:1;transform:translate(-50%,-55%) scale(1)}100%{opacity:0;transform:translate(-50%,-75%) scale(.95)}}
.levelup-animation{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:#fff;padding:40px;border-radius:20px;box-shadow:0 10px 40px rgba(0,0,0,.3);text-align:center;z-index:9999;animation:system-levelup-pop .5s ease-out}
@keyframes system-levelup-pop{from{transform:translate(-50%,-50%) scale(.7);opacity:0}to{transform:translate(-50%,-50%) scale(1);opacity:1}}
@keyframes system-levelup-fade{to{opacity:0;transform:translate(-50%,-50%) scale(.9)}}
`;

// ========== 经验 / 升级动画（对齐 v1 showExpAnimation / showLevelUpAnimation）==========
function showExpAnimation(expGained) {
  const div = el('div', { class: 'exp-animation' }, `+${expGained} EXP`);
  document.body.appendChild(div);
  setTimeout(() => div.remove(), 2000);
}

function showLevelUpAnimation(oldLevel, newLevel) {
  const div = el('div', { class: 'levelup-animation' }, [
    el('div', { style: 'font-size:48px;margin-bottom:10px;' }, '🎉'),
    el('div', { style: 'font-size:36px;font-weight:bold;color:#f6ad55;' }, '升级啦！'),
    el('div', { style: 'font-size:24px;margin-top:10px;color:#4a5568;' }, `Lv.${oldLevel} → Lv.${newLevel}`),
  ]);
  document.body.appendChild(div);
  setTimeout(() => {
    div.style.animation = 'system-levelup-fade 0.5s ease-out forwards';
    setTimeout(() => div.remove(), 500);
  }, 3000);
}

function ensureStyle() {
  if (styleInjected) return;
  styleInjected = true;
  const style = document.createElement('style');
  style.textContent = SYSTEM_STYLE;
  document.head.appendChild(style);
}

function formatMinutes(min) {
  if (min <= 0) return '即将开始';
  if (min >= 60) {
    const h = Math.floor(min / 60);
    const m = min % 60;
    return m > 0 ? `${h}小时${m}分钟` : `${h}小时`;
  }
  return `${min}分钟`;
}

function formatRemaining(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}分${s % 60}秒` : `${s}秒`;
}

/** 创建顶部固定横幅（点击可关闭） */
function createBanner() {
  ensureStyle();
  const textEl = el('span', {});
  const banner = el('div', { class: 'system-banner', style: 'display:none;' }, [textEl]);
  banner.addEventListener('click', () => hideBanners());
  banner.textEl = textEl;
  document.body.appendChild(banner);
  return banner;
}

function hideBanners() {
  if (bannerEl) bannerEl.style.display = 'none';
  if (scheduleEl) scheduleEl.style.display = 'none';
  if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
  if (scheduleTimer) { clearInterval(scheduleTimer); scheduleTimer = null; }
}

/** 维护中横幅（含倒计时） */
function showMaintenanceBanner(data = {}) {
  bannerEl = bannerEl || createBanner();
  const message = data.message || '系统维护中，请稍后再试';
  const endTime = data.endTime || 0;
  bannerEl.textEl.textContent = message;
  bannerEl.className = 'system-banner system-banner--maintenance';
  bannerEl.style.display = 'flex';

  if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
  if (endTime > Date.now()) {
    const tick = () => {
      const remaining = endTime - Date.now();
      if (remaining <= 0) {
        bannerEl.textEl.textContent = `${message}（即将完成）`;
        clearInterval(countdownTimer);
        countdownTimer = null;
        return;
      }
      bannerEl.textEl.textContent = `${message}（剩余 ${formatRemaining(remaining)}）`;
    };
    tick();
    countdownTimer = setInterval(tick, 1000);
  }
}

function hideMaintenanceBanner() {
  if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
  if (bannerEl) bannerEl.style.display = 'none';
}

/** 维护预告横幅 */
function showScheduleBanner(data = {}) {
  scheduleEl = scheduleEl || (() => {
    ensureStyle();
    const text = el('span', {});
    const banner = el('div', { class: 'system-banner', style: 'display:none;' }, [text]);
    banner.addEventListener('click', hideBanners);
    banner.textEl = text;
    document.body.appendChild(banner);
    return banner;
  })();
  const message = data.message || '系统即将维护';
  const noticeMinutes = data.noticeMinutes || 0;
  const startTime = data.startTime || 0;
  scheduleEl.textEl.textContent = `⏰ 系统即将维护：${message}，预计${formatMinutes(noticeMinutes)}后开始`;
  scheduleEl.className = 'system-banner system-banner--schedule';
  scheduleEl.style.display = 'flex';

  if (scheduleTimer) { clearInterval(scheduleTimer); scheduleTimer = null; }
  if (startTime > Date.now()) {
    const tick = () => {
      const remaining = startTime - Date.now();
      if (remaining <= 0) {
        scheduleEl.textEl.textContent = `⏰ 系统即将维护：${message}（维护开始）`;
        clearInterval(scheduleTimer);
        scheduleTimer = null;
        return;
      }
      scheduleEl.textEl.textContent = `⏰ 系统即将维护：${message}（${formatRemaining(remaining)}后开始）`;
    };
    tick();
    scheduleTimer = setInterval(tick, 1000);
  }
}

function hideScheduleBanner() {
  if (scheduleTimer) { clearInterval(scheduleTimer); scheduleTimer = null; }
  if (scheduleEl) scheduleEl.style.display = 'none';
}

/** 维护被拦截操作文案映射（对齐 v1） */
const BLOCKED_ACTION_MAP = {
  game: '游戏功能暂时不可用',
  match: '匹配功能暂时不可用',
  chat: '聊天功能暂时不可用',
  shop: '商城功能暂时不可用',
  purchase: '购买功能暂时不可用',
  mail: '邮件功能暂时不可用',
  register: '注册功能暂时不可用',
  profile: '资料修改暂时不可用',
};

/**
 * 初始化全局系统事件监听（应用启动时调用一次）
 */
export function initSystemEvents() {
  // 维护模式通知
  eventBus.on('system:maintenanceNotice', (data) => {
    if (!data) return;
    if (data.enabled) {
      showMaintenanceBanner(data);
      if (data.message) toast.show(`🔧 系统维护：${data.message}`);
    } else {
      hideMaintenanceBanner();
      hideScheduleBanner();
      toast.success('✅ 系统维护已结束，所有功能已恢复');
    }
  });

  // 维护预告
  eventBus.on('system:maintenanceScheduled', (data) => {
    if (!data) return;
    if (data.cancelled) {
      hideScheduleBanner();
      toast.info('维护计划已取消');
      return;
    }
    showScheduleBanner(data);
    if (data.message) toast.show(`⏰ 系统将于${formatMinutes(data.noticeMinutes || 0)}后进入维护：${data.message}`);
  });

  // 维护倒计时更新
  eventBus.on('system:maintenanceCountdown', (data) => {
    if (!data) return;
    if (scheduleEl) {
      scheduleEl.textEl.textContent = `⏰ 系统即将维护：${data.message || ''}，${formatMinutes(data.remainingMinutes || 0)}后开始`;
      // 最后 1 分钟红色急促警告
      if (data.remainingMinutes <= 1) scheduleEl.className = 'system-banner system-banner--urgent';
    }
  });

  // 维护期间操作被拦截
  eventBus.on('system:maintenanceBlocked', (data) => {
    if (!data) return;
    const actionName = BLOCKED_ACTION_MAP[data.blockedAction] || '该功能暂时不可用';
    let msg = data.message || `系统维护中，${actionName}`;
    if (data.endTime && data.endTime > Date.now()) {
      msg += `（预计${Math.ceil((data.endTime - Date.now()) / 60000)}分钟后恢复）`;
    }
    toast.show(msg, 'warn', 4000);
  });

  // 维护被踢出
  eventBus.on('system:maintenanceKick', (data) => {
    if (!data) return;
    if (data.message) toast.show(`🔧 系统维护：${data.message}`);
    setTimeout(() => {
      if (socket.connected) socket.disconnect();
    }, 2000);
  });

  // 版本检查
  eventBus.on('system:versionCheck', (data) => {
    if (!data) return;
    if (!data.compatible) {
      toast.error(`版本不兼容：${data.reason || ''}，请更新您的客户端或服务端`);
    } else if (data.warning) {
      console.warn('[v2] 版本警告:', data.warning);
    }
  });

  // 管理员消息
  eventBus.on('system:adminMessage', (data) => {
    if (data?.message) toast.show(data.message);
  });

  // 游戏警告
  eventBus.on('game:warning', (data) => {
    if (data?.message) toast.warn(`⚠️ ${data.message}`);
  });

  // 挂机警告（warning 10 秒 / critical 15 秒，对齐 v1）
  eventBus.on('game:inactiveWarning', (data) => {
    if (!data?.message) return;
    if (data.level === 'warning') toast.show(data.message, 'warn', 10000);
    else if (data.level === 'critical') toast.show(data.message, 'error', 15000);
    else toast.warn(data.message);
  });

  // 管理员强制重置 → 返回游戏大厅
  eventBus.on('game:resetDone', (data) => {
    if (data?.message) toast.show(`🔄 ${data.message}`);
    else toast.show('🔄 游戏已被管理员重置');
    go('games');
  });

  // 经验获得提示（v1 exp_gained → expResult）
  eventBus.on('user:expGained', (data) => {
    const r = data?.expResult;
    if (!r) return;
    const bonus = r.bonusExp || 0;
    const base = r.baseExp || 0;
    const total = r.finalExp || (base + bonus);
    let msg = `✨ 获得 ${total} 经验值`;
    if (bonus > 0 && r.eventLabel) msg += `（基础 ${base} + ${r.eventLabel} 额外 ${bonus}）`;
    else if (bonus > 0) msg += `（基础 ${base} + 额外 ${bonus}）`;
    toast.show(msg, 'success');
  });

  // 新邮件通知（v1 mail_received）
  eventBus.on('user:mailReceived', (data) => {
    if (data?.mail) toast.show('📬 收到新邮件：' + (data.mail.title || '新邮件'), 'success');
  });

  // 账号更新 → 经验/升级动画 + 刷新 store（对齐 v1 account_updated；账号栏订阅 store.user 自动刷新）
  eventBus.on('user:accountUpdated', (data) => {
    if (!data?.account) return;
    const accountData = data.account.account || data.account;
    const newExp = accountData?.profile?.exp || 0;
    const newLevel = accountData?.profile?.level || 1;
    if (lastExp !== null && newExp > lastExp) showExpAnimation(newExp - lastExp);
    if (lastLevel !== null && newLevel > lastLevel) showLevelUpAnimation(lastLevel, newLevel);
    lastExp = newExp;
    lastLevel = newLevel;
    store.set('user', { ...data, account: data.account, stats: data.account.stats || {} });
  });

  // 悔棋扣除反馈（服务端悔棋成功后发送，对齐 v1 undo_deduct）
  eventBus.on('game:undoDeduct', (data) => {
    if (data?.success) toast.info('⏪ 已扣除一次悔棋次数');
  });

  // 提示扣除反馈（成功在这里提示；失败由各对局模块提示，避免重复）
  eventBus.on('game:hintDeduct', (data) => {
    if (data?.success) {
      const remain = data.hintCount != null ? `（剩余${data.hintCount}次）` : '';
      toast.info(`💡 已扣除一次提示次数${remain}`);
    }
  });

  // 在线状态上报（对齐 v1 initUserStatus / window.onunload）
  eventBus.on('socket:connect', () => {
    if (!localStorage.getItem('userToken')) return;
    emit('user_status', { status: 'online', game: store.get('currentGame') || null });
  });
  window.addEventListener('beforeunload', () => {
    if (!localStorage.getItem('userToken')) return;
    if (socket.connected) socket.emit('user_status', { status: 'offline', game: store.get('currentGame') || null });
  });
}
