/** 脉冲核心：周期性释放范围冲击波 */
import { skillDamage } from '../combat.js';

const RADIUS_BASE = 110;
const RADIUS_PER_LEVEL = 30;
const DAMAGE_RATIO_BASE = 1;
const DAMAGE_RATIO_PER_LEVEL = 0.4;
const COOLDOWN_BASE = 3.4;
const COOLDOWN_STEP = 0.5;
const COOLDOWN_MIN = 1.4;
const MAX_LEVEL = 6;

export default {
  id: 'nova',
  icon: '🌀',
  name: '脉冲核心',
  desc: '周期性释放冲击波，范围伤害',
  detail: `每 ${COOLDOWN_BASE} 秒释放一次半径 ${RADIUS_BASE} 的冲击波，造成攻击力 ${Math.round(DAMAGE_RATIO_BASE * 100)}% 的伤害；每层 +${RADIUS_PER_LEVEL} 半径、+${Math.round(DAMAGE_RATIO_PER_LEVEL * 100)}% 攻击力倍率，并缩短 ${COOLDOWN_STEP} 秒冷却（最低 ${COOLDOWN_MIN} 秒）。`,
  max: MAX_LEVEL,
  order: 120,
  aoe: true,
  effect(lv) {
    const radius = RADIUS_BASE + RADIUS_PER_LEVEL * (lv - 1);
    const ratio = Math.round((DAMAGE_RATIO_BASE + DAMAGE_RATIO_PER_LEVEL * (lv - 1)) * 100);
    const cd = Math.max(COOLDOWN_MIN, COOLDOWN_BASE - COOLDOWN_STEP * (lv - 1)).toFixed(1);
    return `半径 ${radius} · ${ratio}% 攻击力 · ${cd}s 一次`;
  },
  apply(p, s) {
    p.novaLevel += 1;
    s.novaTimer = Math.min(s.novaTimer, 1.2);
  },
  // 周期释放冲击波：伤害/范围/冷却都按层数计算
  update(dt, p, s, api) {
    if (p.novaLevel <= 0) return;
    s.novaTimer -= dt;
    if (s.novaTimer > 0) return;
    const lv = p.novaLevel;
    const radius = RADIUS_BASE + RADIUS_PER_LEVEL * (lv - 1);
    s.novaTimer = Math.max(COOLDOWN_MIN, COOLDOWN_BASE - COOLDOWN_STEP * (lv - 1));
    api.addNova(p.x, p.y, 26, radius);
    api.damageInRadius(
      p.x,
      p.y,
      radius,
      skillDamage(p, { atkPct: DAMAGE_RATIO_BASE + DAMAGE_RATIO_PER_LEVEL * (lv - 1) }),
    );
  },
};
