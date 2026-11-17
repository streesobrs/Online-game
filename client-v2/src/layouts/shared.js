/**
 * 导航组件共用逻辑（顶部导航 / 全局抽屉 / 移动端标签栏）
 */
import { store } from '../core/store.js';

/** 当前登录账号是否为管理员（账号数据在 store.user.account.account 上） */
export function isAdminAccount() {
  const user = store.get('user');
  const inner = user?.account?.account || user?.account || null;
  return !!inner?.isAdmin;
}
