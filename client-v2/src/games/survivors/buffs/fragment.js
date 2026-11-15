/** 裂片：子弹命中后分裂出小碎片 */
export default {
  id: 'fragment',
  icon: '🔱',
  name: '裂片',
  desc: '子弹命中后裂成碎片继续向前飞',
  detail: '命中敌人时沿飞行方向分裂出多枚碎片，对命中目标后方的敌人造成伤害；碎片本身不会再次分裂。',
  max: 6,
  order: 35,
  aoe: true,
  effect(lv) {
    const count = 1 + lv;
    const pct = Math.round((0.35 + 0.05 * lv) * 100);
    return `${count} 枚碎片 · ${pct}% 伤害`;
  },
  apply(p) {
    p.fragmentLevel += 1;
  },
  // 命中后向飞行方向扇形分裂，碎片标记 fragment 防止无限分裂；
  // 碎片忽略父弹丸已命中的敌人，否则生成当帧就会被同一只怪吃掉，看起来像「击杀才分裂」
  onHit(enemy, pr, p, api) {
    if (p.fragmentLevel <= 0 || pr.fragment) return;
    const lv = p.fragmentLevel;
    const count = 1 + lv;
    const damage = pr.damage * (0.35 + 0.05 * lv);
    const base = Math.atan2(pr.vy, pr.vx);
    const spread = Math.min(0.9, 0.16 * count);
    for (let i = 0; i < count; i += 1) {
      const angle = base - spread + (spread * 2 * i) / (count - 1);
      api.spawnPlayerShot({
        x: pr.x,
        y: pr.y,
        angle,
        speed: p.projectileSpeed * 0.75,
        damage,
        r: 3,
        life: 0.45,
        fragment: true,
        ignoreIds: [...pr.hit],
      });
    }
  },
};
