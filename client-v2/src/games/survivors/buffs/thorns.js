/** 反伤冲击波：受击时向周围释放冲击波，需先获得护盾 */
import { skillDamage } from '../combat.js';

const RADIUS_BASE = 90;
const RADIUS_PER_LEVEL = 20;
const DAMAGE_RATIO_BASE = 0.5;
const DAMAGE_RATIO_PER_LEVEL = 0.15;
const COOLDOWN = 1;
const MAX_LEVEL = 5;

export default {
  id: 'thorns',
  icon: '💥',
  name: '反伤冲击波',
  desc: '受击时释放冲击波反击',
  detail: `护盾解锁后才会出现在强化池。受到伤害时向周围释放冲击波，造成防御力 ${Math.round(DAMAGE_RATIO_BASE * 100)}% 的伤害，冷却 ${COOLDOWN} 秒。`,
  max: MAX_LEVEL,
  order: 62,
  aoe: true,
  requireText: '需先获得护盾',
  requires(p) {
    return p.shieldMax > 0;
  },
  effect(lv) {
    return `半径 ${RADIUS_BASE + RADIUS_PER_LEVEL * lv} · ${Math.round((DAMAGE_RATIO_BASE + DAMAGE_RATIO_PER_LEVEL * lv) * 100)}% 防御力`;
  },
  apply(p) {
    p.thornsLevel += 1;
  },
  update(dt, p, s) {
    if (s.thornsCd > 0) s.thornsCd = Math.max(0, s.thornsCd - dt);
  },
  onHurt(p, s, info, api) {
    const lv = p.thornsLevel;
    if (lv <= 0 || s.thornsCd > 0) return;
    s.thornsCd = COOLDOWN;
    const radius = RADIUS_BASE + RADIUS_PER_LEVEL * lv;
    api.addNova(p.x, p.y, 50, radius);
    api.damageInRadius(
      p.x,
      p.y,
      radius,
      skillDamage(p, { defPct: DAMAGE_RATIO_BASE + DAMAGE_RATIO_PER_LEVEL * lv }),
    );
  },
};
