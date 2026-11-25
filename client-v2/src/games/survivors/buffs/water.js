/** 水流弹：每轮额外发射水属性弹 */
import {
  ELEMENT_DURATION, ELEMENT_RADIUS_BASE, ELEMENT_RADIUS_PER_LEVEL, ELEMENT_SHOT_RATIO,
} from '../elements.js';
import { skillDamage } from '../combat.js';

const SHOTS_PER_LEVEL = 1;
const MAX_LEVEL = 5;
const DAMAGE_PCT = Math.round(ELEMENT_SHOT_RATIO * 100);
const RADIUS_AT_LEVEL_1 = ELEMENT_RADIUS_BASE + ELEMENT_RADIUS_PER_LEVEL;

export default {
  id: 'water',
  icon: '💧',
  name: '水流弹',
  desc: `每轮额外发射 ${SHOTS_PER_LEVEL} 枚水属性弹`,
  detail: `每层让每轮射击多出 ${SHOTS_PER_LEVEL} 枚水流弹，造成 ${DAMAGE_PCT}% 伤害。命中时对周围 ${RADIUS_AT_LEVEL_1} 半径范围挂水元素（每层 +${ELEMENT_RADIUS_PER_LEVEL} 半径），持续 ${ELEMENT_DURATION} 秒；与雷元素接触触发「感电」，连锁附近带水/雷的敌人一同受伤。`,
  max: MAX_LEVEL,
  order: 53,
  aoe: false,
  element: 'water',
  color: '#3b82f6',
  effect(lv) {
    return `额外 ${SHOTS_PER_LEVEL * lv} 枚水流弹 · ${DAMAGE_PCT}% 伤害 · 挂水半径 ${ELEMENT_RADIUS_BASE + ELEMENT_RADIUS_PER_LEVEL * lv}`;
  },
  apply(p) {
    p.waterLevel += 1;
  },
  buildShots(v, p) {
    const lv = p.waterLevel;
    const count = lv * SHOTS_PER_LEVEL;
    for (let i = 0; i < count; i += 1) {
      const angle = v.base + (count === 1 ? 0 : (i - (count - 1) / 2) * 0.2);
      v.shots.push({
        x: p.x + Math.cos(angle) * (p.r + 6),
        y: p.y + Math.sin(angle) * (p.r + 6),
        angle,
        speed: p.projectileSpeed * 0.9,
        damage: skillDamage(p, { atkPct: v.damageScale * ELEMENT_SHOT_RATIO }),
        r: 4,
        life: 1.5,
        element: 'water',
        elementRadius: ELEMENT_RADIUS_BASE + ELEMENT_RADIUS_PER_LEVEL * lv,
        elementDuration: ELEMENT_DURATION,
        color: '#3b82f6',
      });
    }
  },
};
