/** 愈灵：躲在怪群后方持续治疗，阵亡后掉落可拾取的血包 */
const HEAL_RADIUS = 150;
const HEAL_PCT = 0.12;
const HEAL_INTERVAL = 3.2;
// 与玩家保持的安全距离：太近会把治疗送到玩家脸上
const SAFE_DIST = 200;
// 寻找怪群的半径，越大越容易跟到队友
const GROUP_RADIUS = 280;

export default {
  id: 'healer',
  name: '愈灵',
  desc: `每 ${HEAL_INTERVAL} 秒为周围 ${HEAL_RADIUS} 范围内的怪物恢复 ${HEAL_PCT * 100}% 最大生命；会主动远离玩家，贴着怪群后方行动，阵亡后掉落可以被玩家拾取的血包。`,
  order: 45,
  spawnable: true,
  unlockAt: 180,
  weight: 5,
  stats: { shape: 'shooter', color: '#4ade80', r: 12, hp: 34, speed: 66, dmg: 6, xp: 4 },

  // 走位：远离玩家 + 靠向附近怪群；同时周期性治疗周围怪物
  update(e, dx, dy, dist, dt, api) {
    const p = api.state.player;

    // 找到附近怪群的质心（不统计自己与其它愈灵，避免几只愈灵互相绕圈）
    let cx = 0;
    let cy = 0;
    let count = 0;
    for (const other of api.state.enemies) {
      if (other === e || other.dead || other.type === 'healer') continue;
      if ((other.x - e.x) ** 2 + (other.y - e.y) ** 2 > GROUP_RADIUS * GROUP_RADIUS) continue;
      cx += other.x;
      cy += other.y;
      count += 1;
    }

    let tx;
    let ty;
    if (count > 0) {
      cx /= count;
      cy /= count;
      // 目标点取怪群质心，但不允许比安全距离更靠近玩家
      const pdx = cx - p.x;
      const pdy = cy - p.y;
      const pdist = Math.hypot(pdx, pdy) || 1;
      if (pdist < SAFE_DIST) {
        tx = p.x + (pdx / pdist) * SAFE_DIST;
        ty = p.y + (pdy / pdist) * SAFE_DIST;
      } else {
        tx = cx;
        ty = cy;
      }
    } else {
      // 没有队友时，沿远离玩家的方向游走
      const pdist = dist || 1;
      tx = p.x - (dx / pdist) * SAFE_DIST;
      ty = p.y - (dy / pdist) * SAFE_DIST;
    }

    const mdx = tx - e.x;
    const mdy = ty - e.y;
    const mdist = Math.hypot(mdx, mdy);
    if (mdist > 6) api.moveEnemy(e, mdx, mdy, mdist, dt, 1);
    api.clampToArena(e, 24);

    if (e.healCd == null) e.healCd = HEAL_INTERVAL * 0.6;
    e.healCd -= dt;
    if (e.healCd > 0) return;
    e.healCd = HEAL_INTERVAL;

    let healed = 0;
    for (const other of api.state.enemies) {
      if (other.dead || other === e || other.hp >= other.maxHp) continue;
      if ((other.x - e.x) ** 2 + (other.y - e.y) ** 2 > HEAL_RADIUS * HEAL_RADIUS) continue;
      other.hp = Math.min(other.maxHp, other.hp + other.maxHp * HEAL_PCT);
      api.spawnParticles(other.x, other.y, '#4ade80', 3, 70);
      healed += 1;
    }
    if (healed > 0) api.spawnParticles(e.x, e.y, '#4ade80', 8, 130);
  },

  // 阵亡掉落血包，玩家靠近即可拾取回血
  onDeath(e, api) {
    api.spawnHealthPack(e.x, e.y);
    api.spawnParticles(e.x, e.y, '#4ade80', 14, 170);
  },
};
