/** 爆裂弹：弹丸命中时产生范围溅射 */
export default {
  id: 'splash',
  icon: '💥',
  name: '爆裂弹',
  desc: '弹丸命中时溅射周围敌人',
  detail: '初始对命中点周围 48 半径造成 40% 伤害；每层 +18 半径、+15% 溅射比例，比例最高 90%。',
  max: 6,
  order: 110,
  aoe: true,
  effect(lv) {
    const radius = Math.min(96, 48 + 18 * lv);
    const ratio = Math.round(Math.min(0.9, 0.4 + 0.15 * lv) * 100);
    return `溅射半径 ${radius} · ${ratio}% 伤害`;
  },
  apply(p) {
    p.splashRadius = Math.min(96, (p.splashRadius || 48) + 18);
    p.splashRatio = Math.min(0.9, (p.splashRatio || 0.4) + 0.15);
  },
  // 弹丸命中时在命中点溅射
  onHit(enemy, pr, p, api) {
    if (p.splashRadius <= 0) return;
    api.explodeAt(pr.x, pr.y, p.splashRadius, pr.damage * p.splashRatio, enemy.id);
  },
};
