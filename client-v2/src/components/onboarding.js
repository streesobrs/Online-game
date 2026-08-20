/**
 * 引导引擎（v2）
 * 遮罩高亮 + 气泡讲解，支持多套引导：
 * - 主引导（startOnboardingIfNeeded）：首次登录后的大厅 → 各功能页旅程
 * - 场景引导（startTour）：首次进入对局 / 商城 / 邮件 / 资产 / 观战时的小引导
 *
 * 步骤目标支持：
 * - selector：CSS 选择器
 * - find：函数返回目标元素（如按按钮文本查找）
 * - view：进入该步骤前自动跳转到对应路由
 * - before：同视图内渲染前执行的钩子（如切换 Tab）
 */
import { el } from '../utils/dom.js';

const DONE_KEY = 'v2_onboarding_done';

/* ===== 主引导步骤（首次登录 → 大厅/好友/排行榜/资料/快捷键） ===== */
const MAIN_STEPS = [
  {
    view: 'games',
    selector: '.games-mode-tabs',
    icon: '🎮',
    title: '对战模式',
    text: '这里是模式切换按钮。点「联机对战」实时匹配真人玩家，点「AI 对战」和电脑练手。当前默认联机对战。',
  },
  {
    view: 'games',
    selector: '.games-game-card',
    icon: '♟️',
    title: '选择游戏',
    text: '点左侧任一游戏卡片即可选定：🔴 五子棋 · ⚪ 围棋 · 🟥 象棋 · 🐍 贪吃蛇。卡片高亮表示已选中。',
  },
  {
    view: 'games',
    selector: '.games-action-row .btn',
    icon: '🚀',
    title: '开始对战',
    text: '选定游戏后点这个「开始匹配」按钮：联机模式进入匹配队列，匹配到对手自动开局；AI 模式直接开始人机对局。',
  },
  {
    view: 'games',
    selector: '.account-bar',
    icon: '👤',
    title: '顶部账号栏',
    text: '显示你的头像、昵称、等级和经验。点头像进入个人资料（战绩 / 资产 / 邮件 / 成就 / 商城 / 主题），旁边按钮可切换主题、退出登录。',
  },
  {
    view: 'games',
    selector: '.float-dock-btn',
    icon: '💬',
    title: '聊天悬浮坞',
    text: '悬浮聊天入口，点开面板：① 频道聊天畅聊；② 私信支持离线好友（上线可查）；③ 在线玩家可加好友、挑战；④ 点头像可看对方主页。',
  },
  {
    view: 'friends',
    selector: '.friends-box',
    icon: '💛',
    title: '好友系统',
    text: '上方是「好友申请」区，别人加你就在这里，点「同意 / 拒绝」处理；下方「我的好友」可一键私信、挑战或删除。离线好友也能私信，上线后可查看。',
  },
  {
    view: 'leaderboard',
    selector: '.leaderboard-controls',
    icon: '🏆',
    title: '排行榜',
    text: '这里切换排行类型（总分 / 胜场 / 连胜等）。列表展示全服排名与胜率，「我的排名」卡片实时显示你的名次和战绩。',
  },
  {
    view: 'profile',
    selector: '.profile-page',
    icon: '📄',
    title: '个人资料',
    text: '这是你的个人主页：左侧是账号信息（头像 / 昵称 / 等级 / 经验 / 资产）；右侧 Tab 可查看资料概览、头像装扮、对战历史、邮箱、资产明细、等级奖励、成就、商城、主题。点右上角「资料」按钮也能进来。',
  },
  {
    view: 'profile',
    selector: '.profile-shortcut-list',
    before: openShortcutsTab,
    icon: '⌨️',
    title: '快捷键',
    text: '这里整理了全部快捷键：G 游戏大厅 · H 好友 · 1-4 快速选游戏 · T 联机对战 · A AI 对战 · Enter 开始匹配。熟记后操作更顺手！',
  },
];

/** 跳转个人资料后切换到「快捷键」Tab（before 钩子） */
function openShortcutsTab() {
  const tabs = document.querySelectorAll('.profile-tab');
  for (const t of tabs) {
    if (t.textContent.includes('快捷键')) { t.click(); break; }
  }
}

/* ===== 场景引导步骤 ===== */

/** 首次进入对局：落子 / 悔棋提示 / 认输退出 */
const GAME_TOUR_STEPS = [
  {
    icon: '🖱️',
    title: '棋盘对战',
    find: () => document.querySelector('.games-play-area'),
    text: '这就是对局区。点棋盘交叉点落子（象棋拖拽或点击走子），双方轮流；轮到你时回合提示会高亮。',
  },
  {
    icon: '⏪',
    title: '悔棋与提示',
    find: () => findBtn('悔棋'),
    text: '「⏪ 悔棋」撤销上一步：联机需对方同意，AI 对局直接生效；「💡 提示」为你推荐一步好棋（消耗提示次数）。',
  },
  {
    icon: '🏳️',
    title: '认输与退出',
    find: () => findBtn('认输', '退出'),
    text: '「🏳️ 认输」结束本局并按规则结算；也可以「退出」返回大厅。对局结束记得查看结果与经验奖励。',
  },
];

/** 首次进入邮件 Tab：列表 / 领取 */
const MAIL_TOUR_STEPS = [
  {
    icon: '📬',
    title: '邮件列表',
    find: () => document.querySelector('.profile-mail-layout'),
    text: '左侧是邮件列表（支持未读 / 全部筛选），未读邮件有高亮标识；点任意邮件在右侧查看详情。',
  },
  {
    icon: '🎁',
    title: '领取奖励',
    find: () => document.querySelector('.profile-mail-btn.primary, .profile-mail-action'),
    text: '带奖励的邮件点「领取」即可入账（星钻 / 经验 / 道具）；顶部「一键领取」可批量收件，领取后可在资产明细查到记录。',
  },
];

/** 首次进入商城 Tab：余额 / 分类 / 购买 */
const SHOP_TOUR_STEPS = [
  {
    icon: '💎',
    title: '星钻余额',
    find: () => document.querySelector('.shop-balance'),
    text: '顶部显示你的星钻余额。星钻通过对战胜利、邮件奖励、成就等获得，可在商城消费。',
  },
  {
    icon: '🛍️',
    title: '商品分类',
    find: () => document.querySelector('.shop-tabs'),
    text: '这里是商品分类（道具 / 皮肤 / 主题 / 会员等），切换分类浏览对应商品。',
  },
  {
    icon: '🛒',
    title: '购买商品',
    find: () => document.querySelector('.shop-card'),
    text: '商品卡展示价格与说明，点「购买」消耗星钻入账；道具可在背包 / 库存中查看使用。',
  },
];

/** 首次进入资产明细 Tab：记录 / 来源 */
const ASSETS_TOUR_STEPS = [
  {
    icon: '📊',
    title: '资产记录',
    find: () => document.querySelector('.profile-tx-layout'),
    text: '左侧为资产记录列表（星钻 / 经验可切换），右侧显示详情。每条都标注来源（邮箱 / 对局 / 成就 / 系统等）。',
  },
  {
    icon: '🔍',
    title: '查看来源',
    find: () => document.querySelector('.profile-tx-side-item'),
    text: '点任意记录查看完整详情：来源、数量与发生时间。所有星钻 / 经验变动都能追溯，不怕对不上账。',
  },
];

/** 首次进入观战页：列表 / 进入观战 */
const SPECTATE_TOUR_STEPS = [
  {
    icon: '👁️',
    title: '观战列表',
    find: () => document.querySelector('.spectate-list'),
    text: '这里列出当前正在进行的对局：游戏类型、玩家与实时观看人数。',
  },
  {
    icon: '🔴',
    title: '进入观战',
    find: () => document.querySelector('.spectate-card'),
    text: '点任意对局卡片即可实时观战，观看高手对弈、学习棋路与战术。',
  },
];

/** 按按钮文本查找元素（对局工具栏等无统一 class 的场景） */
function findBtn(...texts) {
  return [...document.querySelectorAll('button')].find((b) => texts.some((t) => b.textContent.includes(t)));
}

/* ===== 引擎状态 ===== */
let active = false;
let mask = null;
let pop = null;
let targetEl = null;
let stepIndex = 0;
let resizeHandler = null;
let currentSteps = [];
let onFinish = null;

/* ===== 公共 API ===== */

/** 是否已完成主引导 */
export function isOnboardingDone() {
  return localStorage.getItem(DONE_KEY) === '1';
}

/** 标记主引导完成 */
export function markOnboardingDone() {
  localStorage.setItem(DONE_KEY, '1');
}

/** 重置主引导完成标记（用于手动重看） */
export function resetOnboarding() {
  localStorage.removeItem(DONE_KEY);
}

/** 首次登录自动触发主引导（目标元素存在才启动） */
export function startOnboardingIfNeeded() {
  if (active || isOnboardingDone()) return;
  const first = document.querySelector(MAIN_STEPS[0].selector);
  if (!first) return;
  startOnboarding();
}

/** 强制开始主引导 */
export function startOnboarding() {
  startGuide(MAIN_STEPS, () => {
    markOnboardingDone();
    // 完成/跳过主引导后回到游戏大厅
    if (window.location.hash && window.location.hash !== '#/games') {
      window.location.hash = '#/games';
    }
  });
}

/**
 * 场景引导：首次触发后记录标记（v2_tour_<key>），之后不再打扰。
 * 若已有其他引导在运行则本次不触发（也不标记，下次进入仍可触发）。
 */
export function startTour(key, steps) {
  if (active) return;
  const flag = `v2_tour_${key}`;
  if (localStorage.getItem(flag) === '1') return;
  localStorage.setItem(flag, '1');
  startGuide(steps, null);
}

/** 首次进入对局触发 */
export function startGameTour() { startTour('game', GAME_TOUR_STEPS); }

/** 首次进入邮件 Tab 触发 */
export function startMailTour() { startTour('mail', MAIL_TOUR_STEPS); }

/** 首次进入商城 Tab 触发 */
export function startShopTour() { startTour('shop', SHOP_TOUR_STEPS); }

/** 首次进入资产明细 Tab 触发 */
export function startAssetsTour() { startTour('assets', ASSETS_TOUR_STEPS); }

/** 首次进入观战页触发 */
export function startSpectateTour() { startTour('spectate', SPECTATE_TOUR_STEPS); }

/* ===== 引擎实现 ===== */

/** 启动一套引导 */
function startGuide(steps, finishCb) {
  if (active) return;
  active = true;
  currentSteps = steps;
  onFinish = finishCb;
  stepIndex = 0;

  mask = el('div', { class: 'onboarding-mask' });
  pop = el('div', { class: 'onboarding-pop' });
  document.body.append(mask, pop);

  mask.addEventListener('click', (e) => {
    if (e.target === mask) finish();
  });

  resizeHandler = () => showStep(stepIndex);
  window.addEventListener('resize', resizeHandler);

  showStep(0);
}

/** 解析步骤目标元素（selector 或 find） */
function resolveTarget(step) {
  if (step.find) return step.find();
  if (step.selector) return document.querySelector(step.selector);
  return null;
}

/** 渲染当前步骤（若需要跳转视图，先跳转再渲染） */
function showStep(i) {
  const step = currentSteps[i];
  if (!step) { finish(); return; }
  stepIndex = i;

  clearHighlight();

  // 需要跳转到其他视图时，等目标出现后再高亮（兼容懒加载路由）
  if (step.view && window.location.hash !== `#/${step.view}`) {
    window.location.hash = `#/${step.view}`;
    if (step.before) {
      // 先等页面 Tab 渲染，执行 before 动作（如切换到指定 Tab），再等目标出现
      waitFor({ selector: '.profile-tab' }, () => {
        if (!active) return;
        step.before();
        waitFor(step, () => { if (active) renderStep(step); });
      });
      return;
    }
    if (step.selector || step.find) {
      waitFor(step, () => { if (active) renderStep(step); });
    } else {
      setTimeout(() => { if (active) renderStep(step); }, 300);
    }
    return;
  }
  // 已在目标视图：有 before 则先执行（如同视图内切换 Tab），再渲染
  if (step.before) step.before();
  renderStep(step);
}

/** 轮询等待步骤目标出现（最多 2s），超时仍渲染（renderStep 会自行跳过缺失目标） */
function waitFor(step, cb, tries = 10) {
  if (resolveTarget(step)) { cb(); return; }
  if (tries <= 0) { cb(); return; }
  setTimeout(() => waitFor(step, cb, tries - 1), 200);
}

/** 高亮目标 + 渲染气泡 */
function renderStep(step) {
  // 高亮目标（fixed/sticky 元素不强制改定位，避免破坏原有布局）
  if (step.selector || step.find) {
    targetEl = resolveTarget(step);
    if (!targetEl) {
      // 目标缺失（如对应模式无该按钮）：跳过该步骤
      next();
      return;
    }
    targetEl.scrollIntoView({ block: 'center', behavior: 'smooth' });
    const pos = getComputedStyle(targetEl).position;
    if (pos !== 'fixed' && pos !== 'sticky') {
      targetEl._onbPos = pos;
      targetEl.style.position = 'relative';
    }
    targetEl.classList.add('onboarding-target');
  }

  // 气泡内容
  pop.innerHTML = '';
  pop.append(
    el('div', { class: 'onboarding-pop-head' }, [
      el('span', { class: 'onboarding-pop-icon' }, step.icon),
      el('div', { class: 'onboarding-pop-title' }, `${stepIndex + 1}/${currentSteps.length} ${step.title}`),
    ]),
    el('div', { class: 'onboarding-pop-text' }, step.text),
    el('div', { class: 'onboarding-pop-actions' }, [
      el('button', { class: 'onboarding-pop-skip', onClick: finish }, '跳过'),
      el('div', { class: 'onboarding-pop-nav' }, [
        stepIndex > 0 ? el('button', { class: 'onboarding-pop-btn ghost', onClick: () => showStep(stepIndex - 1) }, '上一步') : null,
        el('button', {
          class: 'onboarding-pop-btn',
          onClick: () => (stepIndex < currentSteps.length - 1 ? next() : finish()),
        }, stepIndex < currentSteps.length - 1 ? '下一步' : '完成'),
      ]),
    ]),
  );

  positionPop();
}

/** 气泡定位：有目标时跟随目标下方/上方（带指向箭头），无目标时居中 */
function positionPop() {
  if (!pop) return;
  const pw = 320;
  const ph = pop.offsetHeight || 190;
  pop.classList.remove('arrow-up', 'arrow-down');

  if (!targetEl) {
    pop.style.top = `${Math.max(12, (window.innerHeight - ph) / 2)}px`;
    pop.style.left = `${Math.max(12, (window.innerWidth - pw) / 2)}px`;
    return;
  }

  const rect = targetEl.getBoundingClientRect();
  let top = rect.bottom + 16;
  let below = true;
  if (top + ph > window.innerHeight - 12) {
    top = Math.max(12, rect.top - ph - 16);
    below = false;
  }
  const left = Math.min(Math.max(12, rect.left + rect.width / 2 - pw / 2), window.innerWidth - pw - 12);
  pop.style.top = `${Math.max(12, top)}px`;
  pop.style.left = `${left}px`;
  pop.classList.add(below ? 'arrow-up' : 'arrow-down');
}

/** 进入下一步 */
function next() {
  if (stepIndex < currentSteps.length - 1) showStep(stepIndex + 1);
  else finish();
}

/** 清理高亮 */
function clearHighlight() {
  if (targetEl) {
    targetEl.classList.remove('onboarding-target');
    if (targetEl._onbPos) {
      targetEl.style.position = targetEl._onbPos;
      delete targetEl._onbPos;
    }
    targetEl = null;
  }
}

/** 结束引导 */
function finish() {
  if (!active) return;
  active = false;
  clearHighlight();
  if (mask) mask.remove();
  if (pop) pop.remove();
  mask = null;
  pop = null;
  if (resizeHandler) {
    window.removeEventListener('resize', resizeHandler);
    resizeHandler = null;
  }
  const cb = onFinish;
  onFinish = null;
  currentSteps = [];
  if (cb) cb();
}
