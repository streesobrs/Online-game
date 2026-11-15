/** 护盾：优先吸收伤害，脱战后自动回复 */
export default {
  id: 'shield',
  icon: '🔵',
  name: '护盾',
  desc: '获得可自动回复的护盾',
  detail: '每层提供 30 点护盾上限和每秒 6 点回复；受到伤害后停止回复 2 秒。护盾耗尽后才会扣血。',
  max: 5,
  order: 61,
  aoe: false,
  effect(lv) {
    return `护盾 ${30 * lv} · 回复 ${6 * lv}/s`;
  },
  apply(p) {
    p.shieldMax += 30;
    p.shieldRegen += 6;
    p.shield = Math.min(p.shieldMax, p.shield + 30);
  },
  update(dt, p) {
    if (p.shieldCd > 0) {
      p.shieldCd = Math.max(0, p.shieldCd - dt);
      return;
    }
    if (p.shield < p.shieldMax) {
      p.shield = Math.min(p.shieldMax, p.shield + p.shieldRegen * dt);
    }
  },
};
