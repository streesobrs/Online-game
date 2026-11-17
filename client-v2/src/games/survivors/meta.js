/**
 * 局外天赋（跨局养成）
 *
 * - 天赋点通过每局结算获得，存活时间 / 击杀 / Boss 数都计入
 * - 等级与点数存在 localStorage，开局时把加成写进玩家属性
 * - 每条天赋一个定义（图标 / 上限 / 费用 /  эффект 文案 / apply），面板按 TALENTS 自动排列
 */
const META_KEY = 'survivorsMeta';

export const TALENTS = [
  {
    id: 'vitality',
    icon: '❤️',
    name: '强健',
    max: 5,
    cost: (lv) => lv + 1,
    desc: (lv) => `生命上限 +${20 * lv}`,
    apply(p, lv) {
      p.maxHp += 20 * lv;
    },
  },
  {
    id: 'power',
    icon: '🗡',
    name: '凶暴',
    max: 5,
    cost: (lv) => lv + 1,
    desc: (lv) => `伤害 +${6 * lv}%`,
    apply(p, lv) {
      p.damage *= 1 + 0.06 * lv;
    },
  },
  {
    id: 'swift',
    icon: '👟',
    name: '疾行',
    max: 5,
    cost: (lv) => lv + 1,
    desc: (lv) => `移速 +${4 * lv}%`,
    apply(p, lv) {
      p.speed *= 1 + 0.04 * lv;
    },
  },
  {
    id: 'magnet',
    icon: '🧲',
    name: '磁力',
    max: 5,
    cost: (lv) => lv + 1,
    desc: (lv) => `拾取范围 +${15 * lv}%`,
    apply(p, lv) {
      p.pickup *= 1 + 0.15 * lv;
    },
  },
  {
    id: 'regen',
    icon: '🌿',
    name: '再生',
    max: 5,
    cost: (lv) => lv + 1,
    desc: (lv) => `每秒回血 +${(0.3 * lv).toFixed(1)}`,
    apply(p, lv) {
      p.regen += 0.3 * lv;
    },
  },
  {
    id: 'scholar',
    icon: '📘',
    name: '博学',
    max: 5,
    cost: (lv) => lv + 1,
    desc: (lv) => `经验获取 +${8 * lv}%`,
    apply(p, lv) {
      p.xpGain = 1 + 0.08 * lv;
    },
  },
  {
    id: 'guard',
    icon: '🔵',
    name: '护心',
    max: 4,
    cost: (lv) => lv + 1,
    desc: (lv) => `起始护盾 ${15 * lv} · 回复 ${lv}/s`,
    apply(p, lv) {
      p.shieldMax += 15 * lv;
      p.shield += 15 * lv;
      p.shieldRegen += lv;
    },
  },
  {
    id: 'fortune',
    icon: '💰',
    name: '财富',
    max: 3,
    cost: (lv) => lv + 1,
    desc: (lv) => `结算天赋点 +${12 * lv}%`,
  },
];

function clampInt(value, lo, hi) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}

export function emptyMeta() {
  return { points: 0, earned: 0, talents: {} };
}

export function normalizeMeta(raw) {
  const out = emptyMeta();
  if (!raw || typeof raw !== 'object') return out;
  out.points = Math.max(0, Math.floor(Number(raw.points) || 0));
  out.earned = Math.max(out.points, Math.floor(Number(raw.earned) || 0));
  for (const talent of TALENTS) {
    const lv = clampInt(raw.talents?.[talent.id], 0, talent.max);
    if (lv > 0) out.talents[talent.id] = lv;
  }
  return out;
}

function loadMeta() {
  try {
    return normalizeMeta(JSON.parse(localStorage.getItem(META_KEY) || 'null'));
  } catch (e) {
    return emptyMeta();
  }
}

let meta = loadMeta();

function persist() {
  try {
    localStorage.setItem(META_KEY, JSON.stringify(meta));
  } catch (e) {
    // 隐私模式忽略，本次局内仍可继续用
  }
}

export function getMeta() {
  return meta;
}

/** 用云存档覆盖本地养成数据（登录后同步用），返回归一化后的 meta */
export function setMeta(raw) {
  meta = normalizeMeta(raw);
  persist();
  return meta;
}

export function talentLevel(id) {
  return meta.talents[id] || 0;
}

export function totalTalentLevels() {
  return Object.values(meta.talents).reduce((sum, lv) => sum + lv, 0);
}

/**
 * 升一级天赋
 * @returns {{ok:boolean, message:string}}
 */
export function upgradeTalent(id) {
  const talent = TALENTS.find((t) => t.id === id);
  if (!talent) return { ok: false, message: '天赋不存在' };
  const lv = talentLevel(id);
  if (lv >= talent.max) return { ok: false, message: '已满级' };
  const cost = talent.cost(lv);
  if (meta.points < cost) return { ok: false, message: `天赋点不足（需要 ${cost}）` };
  meta.points -= cost;
  meta.talents[id] = lv + 1;
  persist();
  return { ok: true, message: `${talent.name} 提升到 Lv.${lv + 1}` };
}

/**
 * 一局结束发放天赋点
 * 基础：每分钟 +1、每 500 击杀 +1、每 2 个 Boss +1；「财富」天赋按比例放大
 */
export function grantRunPoints({ time = 0, kills = 0, bossCount = 0 } = {}) {
  const base = Math.floor(time / 60) + Math.floor(kills / 500) + Math.floor(bossCount / 2);
  if (base <= 0) return { gained: 0, meta };
  const mult = 1 + 0.12 * talentLevel('fortune');
  const gained = Math.max(1, Math.floor(base * mult));
  meta.points += gained;
  meta.earned += gained;
  persist();
  return { gained, meta };
}

/** 把已解锁的天赋加成写入玩家属性（开局调用一次） */
export function applyTalents(player) {
  for (const talent of TALENTS) {
    const lv = talentLevel(talent.id);
    if (lv > 0 && typeof talent.apply === 'function') talent.apply(player, lv);
  }
  player.hp = player.maxHp;
}
