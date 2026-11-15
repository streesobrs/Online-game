/** 连击：每次射击后追加一轮齐射 */
export default {
  id: 'combo',
  icon: '⚡',
  name: '连击',
  desc: '开火后追加一轮齐射',
  detail: '主武器每次开火后 0.12 秒追加一轮齐射，伤害为原来的 65%；每层多追加一轮。',
  max: 4,
  order: 30,
  aoe: false,
  effect(lv) {
    return `追加 ${lv} 轮 · ${Math.round(0.65 * 100)}% 伤害`;
  },
  apply(p) {
    p.comboLevel += 1;
  },
  // 主武器开火后排队追加齐射
  afterAttack(p, s) {
    if (p.comboLevel <= 0) return;
    s.comboPending = p.comboLevel;
    s.comboTimer = 0.12;
  },
  update(dt, p, s, api) {
    if (!s.comboPending) return;
    s.comboTimer -= dt;
    if (s.comboTimer > 0) return;
    api.fireVolley(0.65);
    s.comboPending -= 1;
    s.comboTimer = 0.1;
  },
};
