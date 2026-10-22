/**
 * 设置页（#/settings）
 *
 * 布局：左侧分类导航 + 右侧只渲染当前分类，避免所有设置项堆成一长条。
 * 分类：
 * - 🎨 外观：动画效果、界面密度
 * - 🧩 界面：导航栏与账号入口、启动页、悬浮与提醒（聊天坞 / 好友红点 / 好友申请提示）
 * - 🎮 对局：棋盘最后一步标记
 * - ⌨ 快捷键：全部快捷键与自定义键位
 * - 👤 账号：密码、隐私、退出登录
 * - 🔗 更多：个人资料、重放新手指引、恢复默认
 *
 * 页面本身无状态：所有开关都直接读写 localStorage（layouts/mode.js + core/prefs.js），
 * 改动即时生效，重新进入页面也能读回当前值。
 */
import { el } from '../../utils/dom.js';
import { toast } from '../../components/toast.js';
import { modal } from '../../components/modal.js';
import { go } from '../../core/router.js';
import * as auth from '../../core/auth.js';
import { api } from '../../core/api.js';
import { buildNavPrefsPanel, switchRow, selectRow } from '../../components/navPrefs.js';
import { buildPrivacyRows, mergePrivacy } from '../../components/privacyPanel.js';
import { buildShortcutEditor } from '../../components/shortcutEditor.js';
import { setNavPrefs } from '../../layouts/mode.js';
import { store } from '../../core/store.js';
import {
  START_PAGE_OPTIONS, ANIM_SPEED_OPTIONS, DENSITY_OPTIONS,
  TOAST_POSITION_OPTIONS, TOAST_DIRECTION_OPTIONS, TOAST_DURATION_OPTIONS,
  getUiPrefs, setUiPrefs, resetUiPrefs,
} from '../../core/prefs.js';
import { startOnboarding, resetOnboarding, resetAllTours } from '../../components/onboarding.js';

/** 分区外壳 */
function section(title, hint, children) {
  return el('section', { class: 'settings-section panel' }, [
    el('h2', { class: 'panel-title' }, title),
    hint ? el('p', { class: 'settings-hint' }, hint) : null,
    ...children,
  ]);
}

/** 启动页单选卡片 */
function choiceCard({ icon, name, active, onSelect }) {
  return el('button', {
    class: 'settings-choice' + (active ? ' active' : ''),
    onClick: onSelect,
  }, [
    el('span', { class: 'settings-choice-icon' }, icon),
    el('span', { class: 'settings-choice-name' }, name),
    el('span', { class: 'settings-choice-check' }, active ? '✓' : ''),
  ]);
}

/** 跳转类入口按钮 */
function linkButton(icon, label, onClick) {
  return el('button', { class: 'settings-link', onClick }, [
    el('span', { class: 'settings-link-icon' }, icon),
    el('span', { class: 'settings-link-label' }, label),
    el('span', { class: 'settings-link-arrow' }, '›'),
  ]);
}

/** 修改 / 设置密码弹窗（与个人资料页行为一致） */
async function openPasswordModal() {
  const userId = localStorage.getItem('currentAccountId') || '';
  let hasPassword = false;
  try {
    const res = await api.profile.get(userId);
    hasPassword = !!res?.account?.hasPassword;
  } catch (err) {
    toast.error('读取账号信息失败');
    return;
  }

  const oldEl = el('input', { type: 'password', class: 'input', placeholder: '当前密码' });
  const newEl = el('input', { type: 'password', class: 'input', placeholder: '新密码（至少6位）' });
  const new2El = el('input', { type: 'password', class: 'input', placeholder: '再次输入新密码' });
  const inputs = hasPassword ? [oldEl, newEl, new2El] : [newEl, new2El];
  inputs.forEach((i) => { i.style.width = '100%'; i.style.marginBottom = '10px'; });

  const show = () => modal.show({
    title: hasPassword ? '🔑 修改密码' : '🔑 设置密码',
    content: el('div', { style: 'padding:4px 0;' }, inputs),
    confirmText: '确认',
    showCancel: true,
    cancelText: '取消',
    onConfirm: () => {
      if (hasPassword && !oldEl.value.trim()) { toast.warn('请输入当前密码'); show(); return; }
      const p = newEl.value;
      if (p.length < 6) { toast.warn('新密码至少6位'); show(); return; }
      if (p !== new2El.value) { toast.warn('两次密码输入不一致'); show(); return; }
      if (hasPassword) auth.changePassword(oldEl.value, p);
      else auth.setPassword(p);
      toast.info('正在提交...');
    },
  });
  show();
}

/**
 * 隐私设置内嵌分区：渲染后异步从服务端拉最新值
 * （服务端字段过滤依赖这些开关，所以每次进入都以服务端为准）
 */
function buildPrivacySection() {
  const host = el('div', { class: 'settings-privacy' }, [
    el('div', { class: 'settings-hint' }, '⏳ 读取隐私设置...'),
  ]);
  const userId = localStorage.getItem('currentAccountId') || '';
  (async () => {
    let serverPrivacy = {};
    try {
      const res = await api.profile.get(userId);
      serverPrivacy = res?.privacy || {};
    } catch (err) { /* 拉取失败就用默认值，至少能改 */ }
    const toggles = mergePrivacy(serverPrivacy);
    host.innerHTML = '';
    host.append(
      el('p', { class: 'settings-hint' },
        '关闭后，其他用户查看你的主页 / 资料卡时看不到对应信息。'),
      el('div', { class: 'privacy-rows' }, buildPrivacyRows(toggles)),
      el('button', {
        class: 'btn-primary settings-save',
        onClick: () => {
          auth.updateProfile({ privacy: { ...toggles } });
          toast.info('隐私设置已保存');
        },
      }, '保存隐私设置'),
    );
  })();
  return section('🛡️ 隐私设置', null, [host]);
}

/** 当前登录账号是否为管理员（后台入口只对管理员显示） */
function isAdminAccount() {
  const user = store.get('user');
  const inner = user?.account?.account || user?.account || null;
  return !!inner?.isAdmin;
}

/**
 * 渲染设置页
 * @param {HTMLElement} container - #view-root
 */
export function renderSettings(container) {
  // 当前分类：默认「外观」；旧路由 #/shortcuts 会通过 settings.initTab 指定初始分类
  let activeTab = 'appearance';
  const initTab = store.get('settings.initTab');
  if (initTab) {
    activeTab = initTab;
    store.set('settings.initTab', null); // 已消费，避免下次进入仍停在该分类
  }
  // 快捷键采集监听：切换分类时必须解绑，否则会拦下全站按键
  let editorCleanup = null;

  /** 分类定义：每个分类返回自己的 section 列表 */
  const categories = [
    {
      id: 'appearance',
      icon: '🎨',
      label: '外观',
      build: (prefs) => [
        section('✨ 动画', '动画总开关与播放速率，改动立即生效。', [
          el('div', { class: 'nav-prefs' }, [
            switchRow({
              name: '启用动画',
              hint: '关闭后所有过渡与循环动画立即停止（低配设备更省电）',
              checked: prefs.animEnabled,
              onChange: (v) => {
                setUiPrefs({ animEnabled: v });
                toast.success(v ? '已启用动画' : '已关闭动画');
              },
            }),
            selectRow({
              name: '动画速率',
              hint: '过渡与动画的播放速度：2x 更快，0.5x 更慢',
              options: ANIM_SPEED_OPTIONS,
              value: String(prefs.animSpeed),
              onChange: (v) => setUiPrefs({ animSpeed: parseFloat(v) }),
            }),
            selectRow({
              name: '界面密度',
              hint: '紧凑会缩小面板内边距，一屏显示更多内容',
              options: DENSITY_OPTIONS,
              value: prefs.density,
              onChange: (v) => setUiPrefs({ density: v }),
            }),
          ]),
        ]),
        section('💬 提示条', '界面上浮动提示（保存成功、奖励到账等）的位置与时长。', [
          el('div', { class: 'nav-prefs' }, [
            selectRow({
              name: '显示位置',
              hint: '提示条从屏幕的哪个角 / 边出现',
              options: TOAST_POSITION_OPTIONS,
              value: prefs.toastPosition,
              onChange: (v) => {
                setUiPrefs({ toastPosition: v });
                toast.info('提示条位置已更新');
              },
            }),
            selectRow({
              name: '弹出方向',
              hint: '自动 = 从所在的边滑入（顶部向下、底部向上）',
              options: TOAST_DIRECTION_OPTIONS,
              value: prefs.toastDirection,
              onChange: (v) => {
                setUiPrefs({ toastDirection: v });
                toast.info('提示条弹出方向已更新');
              },
            }),
            selectRow({
              name: '停留时长',
              hint: '每条提示自动消失前停留多久',
              options: TOAST_DURATION_OPTIONS,
              value: String(prefs.toastDuration),
              onChange: (v) => setUiPrefs({ toastDuration: parseInt(v, 10) }),
            }),
          ]),
        ]),
      ],
    },
    {
      id: 'interface',
      icon: '🧩',
      label: '界面',
      build: (prefs) => [
        section('🧩 导航与入口', '导航栏与账号入口的显示方式，拨动即时生效。',
          [buildNavPrefsPanel()]),
        section('🚪 启动页', '直接打开站点（没有 #/xxx）时落在哪一页。', [
          el('div', { class: 'settings-choices' },
            START_PAGE_OPTIONS.map((opt) => choiceCard({
              icon: opt.icon,
              name: opt.name,
              active: prefs.startPage === opt.id,
              onSelect: () => {
                setUiPrefs({ startPage: opt.id });
                render();
                toast.success(`启动页已设为「${opt.name}」`);
              },
            }))),
        ]),
        section('💬 悬浮与提醒', '页面角落的常驻组件，按需保留。', [
          switchRow({
            name: '悬浮聊天坞',
            hint: '右下角的聊天 / 在线按钮；关闭后仍可从导航栏「聊天」进入',
            checked: prefs.floatChat,
            onChange: (v) => setUiPrefs({ floatChat: v }),
          }),
          switchRow({
            name: '好友申请红点',
            hint: '导航栏「好友」上的待处理申请数字角标',
            checked: prefs.friendBadge,
            onChange: (v) => setUiPrefs({ friendBadge: v }),
          }),
          switchRow({
            name: '好友申请弹窗提示',
            hint: '收到好友申请时在右下角弹出提示条',
            checked: prefs.friendToast,
            onChange: (v) => setUiPrefs({ friendToast: v }),
          }),
        ]),
      ],
    },
    {
      id: 'game',
      icon: '🎮',
      label: '对局',
      build: (prefs) => [
        section('🎮 棋盘提示', '棋盘上的辅助标记，关闭不影响走子规则。', [
          switchRow({
            name: '最后一步标记',
            hint: '在上一手落点显示标记（五子棋 / 围棋 / 象棋）',
            checked: prefs.lastMove,
            onChange: (v) => {
              setUiPrefs({ lastMove: v });
              toast.success(v ? '已显示最后一步标记' : '已隐藏最后一步标记');
            },
          }),
        ]),
      ],
    },
    {
      id: 'shortcuts',
      icon: '⌨',
      label: '快捷键',
      build: () => {
        const editor = buildShortcutEditor();
        editorCleanup = editor.destroy;
        return [
          section('⌨ 快捷键', '全部快捷键与自定义键位，改动会随账号同步。', [editor.el]),
        ];
      },
    },
    {
      id: 'account',
      icon: '👤',
      label: '账号',
      build: () => [
        section('👤 账号与安全', null, [
          el('div', { class: 'settings-links' }, [
            linkButton('🔑', '修改 / 设置密码', () => { openPasswordModal(); }),
            el('button', {
              class: 'settings-link danger',
              onClick: () => {
                modal.show({
                  title: '退出登录',
                  content: '退出后需要重新输入账号密码或游客登录。',
                  confirmText: '退出登录',
                  onConfirm: () => auth.logout(),
                });
              },
            }, [
              el('span', { class: 'settings-link-icon' }, '🚪'),
              el('span', { class: 'settings-link-label' }, '退出登录'),
              el('span', { class: 'settings-link-arrow' }, '›'),
            ]),
          ]),
        ]),
        buildPrivacySection(),
      ],
    },
    {
      id: 'more',
      icon: '🔗',
      label: '更多',
      build: () => [
        section('🔗 更多入口', null, [
          el('div', { class: 'settings-links' }, [
            linkButton('👤', '个人资料', () => go('profile')),
            // 仅管理员可见：后台管理入口（身份需先在后台提权）
            isAdminAccount()
              ? linkButton('🛠️', '后台管理', () => go('admin'))
              : null,
            linkButton('🧭', '重放新手指引', () => {
              resetOnboarding();
              resetAllTours();
              go('games');
              setTimeout(() => startOnboarding(), 500);
            }),
            linkButton('♻️', '恢复默认设置', () => {
              modal.show({
                title: '♻️ 恢复默认设置',
                content: '将把「外观 / 界面 / 对局」恢复为默认值，主题、快捷键、账号数据不受影响。',
                confirmText: '恢复默认',
                onConfirm: () => {
                  // 导航：顶部导航栏开启、账号入口 = 全局抽屉（mode.js 默认值）
                  setNavPrefs({ topbar: true, account: 'drawer' });
                  resetUiPrefs();
                  render();
                  toast.success('已恢复默认设置');
                },
              });
            }),
          ]),
        ]),
      ],
    },
  ];

  const nav = el('nav', { class: 'settings-nav' });
  const content = el('div', { class: 'settings-content' });
  const body = el('div', { class: 'settings-layout' }, [nav, content]);

  function render() {
    const prefs = getUiPrefs();
    const current = categories.find((c) => c.id === activeTab) || categories[0];

    nav.innerHTML = '';
    categories.forEach((cat) => {
      nav.appendChild(el('button', {
        class: 'settings-nav-item' + (cat.id === current.id ? ' active' : ''),
        onClick: () => {
          activeTab = cat.id;
          render();
        },
      }, [
        el('span', { class: 'settings-nav-icon' }, cat.icon),
        el('span', { class: 'settings-nav-label' }, cat.label),
      ]));
    });

    content.innerHTML = '';
    // 上一个分类可能是快捷键编辑器：先解绑采集监听
    if (editorCleanup) {
      editorCleanup();
      editorCleanup = null;
    }
    content.append(...current.build(prefs));
  }

  render();
  container.innerHTML = '';
  container.appendChild(el('div', { class: 'settings-page' }, body));
  return () => {
    // 离开设置页时同样要解绑快捷键采集
    if (editorCleanup) { editorCleanup(); editorCleanup = null; }
    body.innerHTML = '';
  };
}
