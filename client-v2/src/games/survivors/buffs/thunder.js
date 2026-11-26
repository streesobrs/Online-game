/** 雷光弹：每轮额外发射雷属性弹 */
import {
  ELEMENT_DURATION, ELEMENT_RADIUS_BASE, ELEMENT_RADIUS_PER_LEVEL, ELEMENT_SHOT_RATIO,
} from '../elements.js';
import { skillDamage } from '../combat.js';

const SHOTS_PER_LEVEL = 1;
const MAX_LEVEL = 5;
const DAMAGE_PCT = Math.round(ELEMENT_SHOT_RATIO * 100);
const RADIUS_AT_LEVEL_1 = ELEMENT_RADIUS_BASE + ELEMENT_RADIUS_PER_LEVEL;

export default {
  id: 'thunder',
  icon: '⚡',
  name: '雷光弹',
  desc: `每轮额外发射 ${SHOTS_PER_LEVEL} 枚雷属性弹`,
  detail: `每层让每轮射击多出 ${SHOTS_PER_LEVEL} 枚雷光弹，造成 ${DAMAGE_PCT}% 伤害。命中时对周围 ${RADIUS_AT_LEVEL_1} 半径范围挂雷元素（每层 +${ELEMENT_RADIUS_PER_LEVEL} 半径），持续 ${ELEMENT_DURATION} 秒；与水元素接触触发「感电」，连接附近头顶带水/雷的敌人一同受到伤害；与火元素触发「超载」范围爆炸，与冰元素触发「超导」。`,
  max: MAX_LEVEL,
  order: 51,
  aoe: false,
  element: 'thunder',
  color: '#facc15',
  effect(lv) {
    return `额外 ${SHOTS_PER_LEVEL * lv} 枚雷光弹 · ${DAMAGE_PCT}% 伤害 · 挂雷半径 ${ELEMENT_RADIUS_BASE + ELEMENT_RADIUS_PER_LEVEL * lv}`;
  },
  apply(p) {
    p.thunderLevel += 1;
  },
  buildShots(v, p) {
    const lv = p.thunderLevel;
    const count = lv * SHOTS_PER_LEVEL;
    for (let i = 0; i < count; i += 1) {
      const angle = v.base + (count === 1 ? 0 : (i - (count - 1) / 2) * 0.2);
      v.shots.push({
        x: p.x + Math.cos(angle) * (p.r + 6),
        y: p.y + Math.sin(angle) * (p.r + 6),
        angle,
        speed: p.projectileSpeed * 1.05,
        damage: skillDamage(p, { atkPct: v.damageScale * ELEMENT_SHOT_RATIO }),
        r: 4,
        life: 1.3,
        element: 'thunder',
        elementRadius: ELEMENT_RADIUS_BASE + ELEMENT_RADIUS_PER_LEVEL * lv,
        elementDuration: ELEMENT_DURATION,
        color: '#facc15',
      });
    }
  },
};
