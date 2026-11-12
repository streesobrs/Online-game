/**
 * 客户端功能开关
 * 目前只有「测试功能」：开启后商城显示抽奖入口、个人资料显示「每日」签到与任务。
 * 状态保存在本地浏览器，仅影响界面可见性。
 */
const TEST_MODE_KEY = 'yg.testMode';

export function isTestMode() {
  try {
    return localStorage.getItem(TEST_MODE_KEY) === '1';
  } catch (err) {
    return false;
  }
}

export function setTestMode(enabled) {
  try {
    if (enabled) localStorage.setItem(TEST_MODE_KEY, '1');
    else localStorage.removeItem(TEST_MODE_KEY);
  } catch (err) {
    /* 隐私模式下可能不可写，忽略 */
  }
}
