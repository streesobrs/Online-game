/** 连锁爆裂：怪物死亡时爆炸 */
const DAMAGE_RATIO_BASE = 0.3;
const DAMAGE_RATIO_PER_LEVEL = 0.15;
const RADIUS_BASE = 55;
const RADIUS_PER_LEVEL = 18;
const MAX_CHAIN = 3;
const MAX_LEVEL = 6;

export default {
  id: 'explode',
  icon: '☄️',
  name: '连锁爆裂',
  desc: '怪物死亡时爆炸波及周围',
  detail: `小怪死亡时以自身最大生命的 ${Math.round(DAMAGE_RATIO_BASE * 100)}% 爆炸，每层 +${Math.round(DAMAGE_RATIO_PER_LEVEL * 100)}% 伤害、+${RADIUS_PER_LEVEL} 半径；最多连锁 ${MAX_CHAIN} 层。`,
  max: MAX_LEVEL,
  order: 130,
  aoe: true,
  effect(lv) {
    return `爆炸 ${Math.round((DAMAGE_RATIO_BASE + DAMAGE_RATIO_PER_LEVEL * lv) * 100)}% 最大生命 · 半径 ${RADIUS_BASE + RADIUS_PER_LEVEL * lv}`;
  },
  apply(p) {
    p.explodeLevel += 1;
  },
  // 小怪死亡时以自身最大生命爆炸，可连锁但限制层数，避免无限递归
  onKill(enemy, p, s, api, depth) {
    if (enemy.boss || p.explodeLevel <= 0 || depth >= MAX_CHAIN) return;
    const lv = p.explodeLevel;
    const radius = RADIUS_BASE + RADIUS_PER_LEVEL * lv;
    const dmg = enemy.maxHp * (DAMAGE_RATIO_BASE + DAMAGE_RATIO_PER_LEVEL * lv);
    api.explodeAt(enemy.x, enemy.y, radius, dmg, enemy.id, depth);
  },
};
