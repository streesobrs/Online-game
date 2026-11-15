/** 连锁爆裂：怪物死亡时爆炸 */
export default {
  id: 'explode',
  icon: '☄️',
  name: '连锁爆裂',
  desc: '怪物死亡时爆炸波及周围',
  detail: '小怪死亡时以自身最大生命的 30% 爆炸，每层 +15% 伤害、+18 半径；最多连锁 3 层。',
  max: 6,
  order: 130,
  aoe: true,
  effect(lv) {
    return `爆炸 ${Math.round((0.3 + 0.15 * lv) * 100)}% 最大生命 · 半径 ${55 + 18 * lv}`;
  },
  apply(p) {
    p.explodeLevel += 1;
  },
  // 小怪死亡时以自身最大生命爆炸，可连锁但限制层数，避免无限递归
  onKill(enemy, p, s, api, depth) {
    if (enemy.boss || p.explodeLevel <= 0 || depth >= 3) return;
    const lv = p.explodeLevel;
    const radius = 55 + 18 * lv;
    const dmg = enemy.maxHp * (0.3 + 0.15 * lv);
    api.explodeAt(enemy.x, enemy.y, radius, dmg, enemy.id, depth);
  },
};
