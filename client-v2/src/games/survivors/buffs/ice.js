/** 寒冰弹：每轮额外发射冰属性弹 */
import {
  ELEMENT_DURATION, ELEMENT_RADIUS_BASE, ELEMENT_RADIUS_PER_LEVEL, ELEMENT_SHOT_RATIO,
} from '../elements.js';
import { skillDamage } from '../combat.js';

const SHOTS_PER_LEVEL = 1;
const MAX_LEVEL = 5;
const DAMAGE_PCT = Math.round(ELEMENT_SHOT_RATIO * 100);
const RADIUS_AT_LEVEL_1 = ELEMENT_RADIUS_BASE + ELEMENT_RADIUS_PER_LEVEL;

export default {
  id: 'ice',
  icon: '❄️',
  name: '寒冰弹',
  desc: `每轮额外发射 ${SHOTS_PER_LEVEL} 枚冰属性弹`,
  detail: `每层让每轮射击多出 ${SHOTS_PER_LEVEL} 枚寒冰弹，造成 ${DAMAGE_PCT}% 伤害。命中时对周围 ${RADIUS_AT_LEVEL_1} 半径范围挂冰元素（每层 +${ELEMENT_RADIUS_PER_LEVEL} 半径），持续 ${ELEMENT_DURATION} 秒。`,
  max: MAX_LEVEL,
  order: 52,
  aoe: false,
  element: 'ice',
  color: '#7dd3fc',
  effect(lv) {
    return `额外 ${SHOTS_PER_LEVEL * lv} 枚寒冰弹 · ${DAMAGE_PCT}% 伤害 · 挂冰半径 ${ELEMENT_RADIUS_BASE + ELEMENT_RADIUS_PER_LEVEL * lv}`;
  },
  apply(p) {
    p.iceLevel += 1;
  },
  buildShots(v, p) {
    const lv = p.iceLevel;
    const count = lv * SHOTS_PER_LEVEL;
    for (let i = 0; i < count; i += 1) {
      const angle = v.base + (count === 1 ? 0 : (i - (count - 1) / 2) * 0.2);
      v.shots.push({
        x: p.x + Math.cos(angle) * (p.r + 6),
        y: p.y + Math.sin(angle) * (p.r + 6),
        angle,
        speed: p.projectileSpeed * 0.85,
        damage: skillDamage(p, { atkPct: v.damageScale * ELEMENT_SHOT_RATIO }),
        r: 4,
        life: 1.5,
        element: 'ice',
        elementRadius: ELEMENT_RADIUS_BASE + ELEMENT_RADIUS_PER_LEVEL * lv,
        elementDuration: ELEMENT_DURATION,
        color: '#7dd3fc',
      });
    }
  },
};
