/** 连击：每次射击后追加一轮齐射 */
const VOLLEY_DELAY = 0.12;
const DAMAGE_RATIO = 0.65;
const DAMAGE_PCT = Math.round(DAMAGE_RATIO * 100);
const MAX_LEVEL = 4;

export default {
  id: 'combo',
  icon: '⚡',
  name: '连击',
  desc: '开火后追加一轮齐射',
  detail: `主武器每次开火后 ${VOLLEY_DELAY} 秒追加一轮齐射，伤害为攻击力的 ${DAMAGE_PCT}%；每层多追加一轮。`,
  max: MAX_LEVEL,
  order: 30,
  aoe: false,
  effect(lv) {
    return `追加 ${lv} 轮 · ${DAMAGE_PCT}% 攻击力`;
  },
  apply(p) {
    p.comboLevel += 1;
  },
  // 主武器开火后排队追加齐射
  afterAttack(p, s) {
    if (p.comboLevel <= 0) return;
    s.comboPending = p.comboLevel;
    s.comboTimer = VOLLEY_DELAY;
  },
  update(dt, p, s, api) {
    if (!s.comboPending) return;
    s.comboTimer -= dt;
    if (s.comboTimer > 0) return;
    api.fireVolley(DAMAGE_RATIO);
    s.comboPending -= 1;
    s.comboTimer = 0.1;
  },
};
