/** 爆裂弹：弹丸命中时产生范围溅射 */
import { skillDamage } from '../combat.js';

const RADIUS_BASE = 48;
const RADIUS_PER_LEVEL = 18;
const RADIUS_MAX = 96;
const DAMAGE_RATIO_BASE = 0.4;
const DAMAGE_RATIO_PER_LEVEL = 0.12;
const DAMAGE_RATIO_MAX = 0.9;
const MAX_LEVEL = 6;

export default {
  id: 'splash',
  icon: '💥',
  name: '爆裂弹',
  desc: '弹丸命中时溅射周围敌人',
  detail: `初始对命中点周围 ${RADIUS_BASE} 半径造成攻击力 ${Math.round(DAMAGE_RATIO_BASE * 100)}% 的伤害；每层 +${RADIUS_PER_LEVEL} 半径（上限 ${RADIUS_MAX}）、+${Math.round(DAMAGE_RATIO_PER_LEVEL * 100)}% 攻击力倍率（最高 ${Math.round(DAMAGE_RATIO_MAX * 100)}%）。`,
  max: MAX_LEVEL,
  order: 110,
  aoe: true,
  effect(lv) {
    const radius = Math.min(RADIUS_MAX, RADIUS_BASE + RADIUS_PER_LEVEL * lv);
    const ratio = Math.min(DAMAGE_RATIO_MAX, DAMAGE_RATIO_BASE + DAMAGE_RATIO_PER_LEVEL * lv);
    return `溅射半径 ${radius} · ${Math.round(ratio * 100)}% 攻击力`;
  },
  apply(p) {
    p.splashLevel += 1;
    p.splashRadius = Math.min(RADIUS_MAX, RADIUS_BASE + RADIUS_PER_LEVEL * p.splashLevel);
    p.splashRatio = Math.min(DAMAGE_RATIO_MAX, DAMAGE_RATIO_BASE + DAMAGE_RATIO_PER_LEVEL * p.splashLevel);
  },
  // 弹丸命中时在命中点溅射
  onHit(enemy, pr, p, api) {
    if (p.splashRadius <= 0) return;
    api.explodeAt(pr.x, pr.y, p.splashRadius, skillDamage(p, { atkPct: p.splashRatio }), enemy.id);
  },
};
