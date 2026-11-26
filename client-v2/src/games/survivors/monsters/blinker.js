/** 闪现者：绕到玩家身后现身，短暂蓄力后直线突刺，沿途留下残影 */
const AMBUSH_INTERVAL = 3.6;
const BLINK_MIN = 150;
const BLINK_MAX = 210;
const WINDUP_TIME = 0.7;
const DASH_TIME = 0.26;
const DASH_SPEED_MULT = 4.2;

export default {
  id: 'blinker',
  name: '闪现者',
  desc: `会绕到玩家身后闪烁现身，短暂蓄力（紫色预警线）后沿预警方向高速突刺，沿途留下残影；看到预警要及时横向走位。`,
  order: 78,
  spawnable: true,
  unlockAt: 390,
  weight: 5,
  stats: { shape: 'circle', color: '#e879f9', r: 10, hp: 46, speed: 104, dmg: 9, xp: 4 },

  // 追击 → 绕后闪烁 → 蓄力预警 → 直线突刺
  update(e, dx, dy, dist, dt, api) {
    if (e.mode === 'dash') {
      e.timer -= dt;
      e.x += e.dashVx * dt;
      e.y += e.dashVy * dt;
      if (Math.random() < 0.7) api.spawnParticles(e.x, e.y, '#e879f9', 1, 34);
      if (e.timer <= 0) {
        e.mode = 'chase';
        e.blinkCd = AMBUSH_INTERVAL;
      }
      return;
    }

    if (e.mode === 'windup') {
      e.timer -= dt;
      if (e.timer <= 0) {
        // 沿预警方向突刺而不是追着玩家转向：玩家看到预警可以横向躲开
        e.dashVx = Math.cos(e.aimAngle) * e.speed * DASH_SPEED_MULT;
        e.dashVy = Math.sin(e.aimAngle) * e.speed * DASH_SPEED_MULT;
        e.mode = 'dash';
        e.timer = DASH_TIME;
        api.spawnParticles(e.x, e.y, '#e879f9', 10, 190);
      }
      return;
    }

    // 普通追击：略微加速贴近
    api.moveEnemy(e, dx, dy, dist, dt, 1.1);
    if (e.blinkCd == null) e.blinkCd = AMBUSH_INTERVAL * 0.5;
    e.blinkCd -= dt;
    if (e.blinkCd > 0) return;

    // 绕到玩家身后露头：玩家朝向反方向 + 一点随机偏移
    const p = api.state.player;
    const behind = (p.face || 0) + Math.PI + api.rand(-0.55, 0.55);
    const radius = api.rand(BLINK_MIN, BLINK_MAX);
    api.spawnParticles(e.x, e.y, '#e879f9', 10, 170);
    e.x = p.x + Math.cos(behind) * radius;
    e.y = p.y + Math.sin(behind) * radius;
    api.clampToArena(e, 20);
    api.spawnParticles(e.x, e.y, '#e879f9', 12, 190);
    e.mode = 'windup';
    e.timer = WINDUP_TIME;
    e.aimAngle = Math.atan2(p.y - e.y, p.x - e.x);
  },
};
