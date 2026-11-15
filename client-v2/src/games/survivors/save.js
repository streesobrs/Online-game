/**
 * 战局存档：把当前局内状态写入 localStorage，刷新或临时离开后可继续。
 * 只保存可序列化的运行时数据，粒子/特效等纯表现层内容不存。
 */
const KEY = 'survivorsRun';
const VERSION = 1;

/**
 * 保存当前战局（仅 playing 状态）
 * @param {object} state - 游戏状态
 */
export function saveRun(state) {
  if (!state || state.mode !== 'playing') return;
  try {
    const payload = {
      v: VERSION,
      savedAt: Date.now(),
      time: state.time,
      kills: state.kills,
      level: state.level,
      xp: state.xp,
      xpNeeded: state.xpNeeded,
      pendingLevels: state.pendingLevels,
      player: state.player,
      enemies: state.enemies.filter((e) => !e.dead),
      projectiles: state.projectiles.filter((pr) => !pr.dead).map((pr) => ({ ...pr, hit: [...pr.hit] })),
      enemyShots: state.enemyShots.filter((s) => !s.dead),
      gems: state.gems,
      upgradeStacks: state.upgradeStacks,
      attackTimer: state.attackTimer,
      comboTimer: state.comboTimer,
      comboPending: state.comboPending,
      spawnTimer: state.spawnTimer,
      bossTimer: state.bossTimer,
      bossCount: state.bossCount,
      wave: state.wave,
      hurtCd: state.hurtCd,
      novaTimer: state.novaTimer,
      nextEnemyId: state.nextEnemyId,
    };
    localStorage.setItem(KEY, JSON.stringify(payload));
  } catch (e) {
    // 隐私模式 / 超出配额时静默失败，不影响游戏
  }
}

/**
 * 读取存档；无效或版本不匹配时清除并返回 null
 * @returns {object|null}
 */
export function loadRun() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const run = JSON.parse(raw);
    if (
      !run || run.v !== VERSION
      || !Number.isFinite(run.time)
      || !run.player
      || !Array.isArray(run.enemies)
    ) {
      clearRun();
      return null;
    }
    return {
      ...run,
      projectiles: (run.projectiles || []).map((pr) => ({ ...pr, hit: new Set(pr.hit || []) })),
      enemyShots: run.enemyShots || [],
      gems: run.gems || [],
      upgradeStacks: run.upgradeStacks || {},
    };
  } catch (e) {
    clearRun();
    return null;
  }
}

export function clearRun() {
  try {
    localStorage.removeItem(KEY);
  } catch (e) {
    // 忽略
  }
}
