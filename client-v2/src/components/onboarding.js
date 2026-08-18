/**
 * 登录后新手引导（v2）
 * 遮罩高亮 + 气泡提示，依次介绍游戏大厅 / 顶部账号栏 / 悬浮聊天坞等核心入口。
 * 首次登录（localStorage v2_onboarding_done 标记）触发，可随时跳过。
 */
import { el } from '../utils/dom.js';

const DONE_KEY = 'v2_onboarding_done';

/** 引导步骤：
 * - view：目标路由（进入该步骤前自动跳转过去，再高亮讲解）
 * - selector：精确到具体按钮/控件；为空表示无目标（气泡居中显示，如快捷键介绍）
 */
const STEPS = [
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

let active = false;
let mask = null;
let pop = null;
let targetEl = null;
let stepIndex = 0;
let resizeHandler = null;

/** 是否已完成引导 */
export function isOnboardingDone() {
  return localStorage.getItem(DONE_KEY) === '1';
}

/** 标记引导完成 */
export function markOnboardingDone() {
  localStorage.setItem(DONE_KEY, '1');
}

/** 重置引导完成标记（用于手动重看） */
export function resetOnboarding() {
  localStorage.removeItem(DONE_KEY);
}

/** 首次登录自动触发（目标元素存在才启动） */
export function startOnboardingIfNeeded() {
  if (active || isOnboardingDone()) return;
  const first = document.querySelector(STEPS[0].selector);
  if (!first) return;
  startOnboarding();
}

/** 强制开始引导 */
export function startOnboarding() {
  if (active) return;
  active = true;
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

/** 渲染当前引导步骤（若步骤需要跳转视图，先跳转再渲染） */
function showStep(i) {
  const step = STEPS[i];
  if (!step) { finish(); return; }
  stepIndex = i;

  clearHighlight();

  // 需要跳转到其他视图时，等目标元素出现后再高亮（兼容懒加载路由）
  if (step.view && window.location.hash !== `#/${step.view}`) {
    window.location.hash = `#/${step.view}`;
    if (step.before) {
      // 先等页面 Tab 渲染，执行 before 动作（如切换到指定 Tab），再等目标出现
      waitFor('.profile-tab', () => {
        if (!active) return;
        step.before();
        if (step.selector) waitFor(step.selector, () => { if (active) renderStep(step); });
        else renderStep(step);
      });
      return;
    }
    if (step.selector) {
      waitFor(step.selector, () => { if (active) renderStep(step); });
    } else {
      setTimeout(() => { if (active) renderStep(step); }, 300);
    }
    return;
  }
  // 已在目标视图：有 before 则先执行（如同视图内切换 Tab），再渲染
  if (step.before) step.before();
  renderStep(step);
}

/** 轮询等待选择器对应元素出现（最多 2s），超时仍渲染（renderStep 会自行跳过缺失目标） */
function waitFor(selector, cb, tries = 10) {
  if (document.querySelector(selector)) { cb(); return; }
  if (tries <= 0) { cb(); return; }
  setTimeout(() => waitFor(selector, cb, tries - 1), 200);
}

/** 高亮目标 + 渲染气泡 */
function renderStep(step) {
  // 高亮目标（fixed/sticky 元素不强制改定位，避免破坏原有布局）
  if (step.selector) {
    targetEl = document.querySelector(step.selector);
    if (!targetEl) {
      // 目标缺失（如已离开对应页面）：跳过该步骤
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
      el('div', { class: 'onboarding-pop-title' }, `${stepIndex + 1}/${STEPS.length} ${step.title}`),
    ]),
    el('div', { class: 'onboarding-pop-text' }, step.text),
    el('div', { class: 'onboarding-pop-actions' }, [
      el('button', { class: 'onboarding-pop-skip', onClick: finish }, '跳过'),
      el('div', { class: 'onboarding-pop-nav' }, [
        stepIndex > 0 ? el('button', { class: 'onboarding-pop-btn ghost', onClick: () => showStep(stepIndex - 1) }, '上一步') : null,
        el('button', {
          class: 'onboarding-pop-btn',
          onClick: () => (stepIndex < STEPS.length - 1 ? next() : finish()),
        }, stepIndex < STEPS.length - 1 ? '下一步' : '完成'),
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
  if (stepIndex < STEPS.length - 1) showStep(stepIndex + 1);
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
  markOnboardingDone();
  // 完成/跳过引导后回到游戏大厅
  if (window.location.hash && window.location.hash !== '#/games') {
    window.location.hash = '#/games';
  }
}
