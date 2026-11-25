/**
 * 玩家基础属性、强化缩放常量与属性派生。
 *
 * 结算模型：开局先应用局外天赋，然后把数值快照到 player.base；
 * 之后每个强化只记录自己的层数，由 deriveStats 按「base × 修正(层数)」重算最终属性。
 * 所有伤害类 buff 都读取最终属性，并按攻击 / 防御 / 最大生命的百分比结算。
 */
export const PLAYER_BASE = {
  x: 480,
  y: 300,
  r: 15,
  hp: 100,
  maxHp: 100,
  atk: 20,
  def: 40,
  speed: 235,
  em: 0,
  critRate: 0.05,
  critDmg: 0.5,
  dmgBonus: 0,
  reactionBonus: 0,
  attackInterval: 0.55,
  projectiles: 1,
  projectileSpeed: 560,
  pierce: 0,
  pickup: 90,
  xpGain: 1,
  // 百分比来源：派生值 = 最大生命 × 比例
  regenPct: 0,
  lifestealPct: 0,
  shieldPct: 0,
  shieldRegenPct: 0,
  // 派生缓存（deriveStats 计算）
  regen: 0,
  lifesteal: 0,
  shield: 0,
  shieldMax: 0,
  shieldRegen: 0,
  shieldCd: 0,
  splashRadius: 0,
  splashRatio: 0,
  novaLevel: 0,
  explodeLevel: 0,
  thornsLevel: 0,
  fragmentLevel: 0,
  comboLevel: 0,
  fireLevel: 0,
  thunderLevel: 0,
  iceLevel: 0,
  waterLevel: 0,
  electroAmpLevel: 0,
  electroChainLevel: 0,
  electroStormLevel: 0,
  face: -Math.PI / 2,
  // 强化层数：最终属性 = 基础属性 × 修正(层数)
  atkLevel: 0,
  rateLevel: 0,
  multiLevel: 0,
  pierceLevel: 0,
  projSpeedLevel: 0,
  hpLevel: 0,
  speedLevel: 0,
  defLevel: 0,
  regenLevel: 0,
  lifestealLevel: 0,
  pickupLevel: 0,
  shieldLevel: 0,
  splashLevel: 0,
};

/**
 * 强化每层的缩放系数。
 * buff 文件只用它生成文案，实际结算由 deriveStats 读取同一份常量，避免文案与数值脱节。
 */
export const BUFF_SCALING = {
  atkPerLevel: 0.25,
  intervalMult: 0.87,
  hpPerLevel: 0.2,
  speedPerLevel: 0.08,
  defPerLevel: 0.4,
  regenPctPerLevel: 0.005,
  lifestealPctPerLevel: 0.004,
  pickupMult: 1.45,
  projSpeedMult: 1.25,
  emPerLevel: 40,
  shieldPctPerLevel: 0.12,
  shieldRegenPctPerLevel: 0.01,
};

/** 普通子弹的基础参数，强化只在此基础上做倍率修正 */
export const BASE_SHOT = {
  r: 4.5,
  life: 1.5,
  muzzle: 6,
  spreadStep: 0.2,
  spreadMax: 0.5,
};

/** 参与「基础 → 当前」结算与展示的属性 */
export const BASE_STAT_KEYS = [
  'maxHp', 'atk', 'def', 'speed', 'em', 'critRate', 'critDmg', 'dmgBonus', 'reactionBonus',
  'attackInterval', 'projectiles', 'projectileSpeed', 'pierce', 'pickup',
  'regenPct', 'lifestealPct', 'shieldPct', 'shieldRegenPct',
];

/**
 * 把玩家当前属性快照成基础属性（开局/读取存档时调用一次）
 * @param {object} player
 * @returns {object}
 */
export function snapshotBaseStats(player) {
  const base = {};
  for (const key of BASE_STAT_KEYS) base[key] = player[key];
  return base;
}

/**
 * 按基础属性与各强化层数重算最终属性。
 * 所有 buff 的 apply 只增加层数，然后调用这里，保证同一属性的加成不会重复叠加。
 * @param {object} player
 * @returns {object} 同一个 player
 */
export function deriveStats(player) {
  const b = player.base || player;
  const s = BUFF_SCALING;

  player.maxHp = b.maxHp * (1 + s.hpPerLevel * (player.hpLevel || 0));
  player.atk = b.atk * (1 + s.atkPerLevel * (player.atkLevel || 0));
  player.def = b.def * (1 + s.defPerLevel * (player.defLevel || 0));
  player.speed = b.speed * (1 + s.speedPerLevel * (player.speedLevel || 0));
  player.pickup = b.pickup * s.pickupMult ** (player.pickupLevel || 0);
  player.projectileSpeed = b.projectileSpeed * s.projSpeedMult ** (player.projSpeedLevel || 0);
  player.attackInterval = b.attackInterval * s.intervalMult ** (player.rateLevel || 0);
  player.projectiles = b.projectiles + (player.multiLevel || 0);
  player.pierce = b.pierce + (player.pierceLevel || 0);
  player.em = b.em + s.emPerLevel * (player.electroAmpLevel || 0);

  player.regenPct = b.regenPct + s.regenPctPerLevel * (player.regenLevel || 0);
  player.lifestealPct = b.lifestealPct + s.lifestealPctPerLevel * (player.lifestealLevel || 0);
  player.shieldPct = b.shieldPct + s.shieldPctPerLevel * (player.shieldLevel || 0);
  player.shieldRegenPct = b.shieldRegenPct + s.shieldRegenPctPerLevel * (player.shieldLevel || 0);

  player.regen = player.maxHp * player.regenPct;
  player.lifesteal = player.maxHp * player.lifestealPct;
  player.shieldMax = player.maxHp * player.shieldPct;
  player.shieldRegen = player.maxHp * player.shieldRegenPct;
  player.shield = Math.min(player.shield || 0, player.shieldMax);
  player.hp = Math.min(player.hp || 0, player.maxHp);

  return player;
}
