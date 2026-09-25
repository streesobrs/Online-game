/**
 * 存档迁移与完整性校验（开发方案 4.7）
 *
 * 纯函数、无 DOM、无网络：node 测试与标定脚本直接 import。
 *
 * 三条铁律（文档 4.7.4）：
 * 1. 新增字段缺 key → 填**深拷贝**默认值；已有 key 一律不覆盖
 * 2. 废弃字段不删只登记（config.DEPRECATED），到 removeAfter 才发清理迁移
 * 3. 每步 up 必须幂等、纯数据；迁移只在加载旧档时跑一次，写出立即盖当前版本号
 *
 * 版本三向判定（meta / session 同一套）：
 * 相等直用；旧版链式迁移；高版本（回滚）不迁移不报错——session 放弃续玩写墓碑，
 * meta 的未知 key 由归一化层收进 _ext 透传袋（见 meta.js normalizeMeta）。
 */
import { ROGUE_META, SESSION_SCHEMA_VER, SIGNED_FIELDS } from '../config/config.js';
import { synthLinearMap } from '../rogue/mapgen.js';

/** 当前局外存档版本（权威随服务端下发；未下发时用客户端镜像） */
export const CURRENT_META_VER = ROGUE_META.saveVer;
/** 当前局内 session 版本（离线可判，常量在客户端） */
export const CURRENT_SESSION_VER = SESSION_SCHEMA_VER;

/** JSON 兼容纯数据的深拷贝（存档里不允许出现函数 / Date / undefined 以外的非 JSON 值） */
export function deepClone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

// ---- 轻量哈希（定位是损坏检测，不是防作弊，文档 4.7.5）----

/** FNV-1a 32 位 → 8 位十六进制字符串（无第三方依赖） */
export function fnv1a(str) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 1) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * canonical JSON：对象 key 固定按字典序排序（数组保序、undefined 字段跳过）。
 * 同一数据无论怎么 parse / 重排 key，签名字节都一致
 */
export function canonicalStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(',')}]`;
  const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalStringify(value[k])}`).join(',')}}`;
}

/** 取档内实际存在的白名单字段组成签名载荷（缺失字段不补，保持验算稳定） */
export function signFields(obj, fields) {
  const payload = {};
  for (const key of fields) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) payload[key] = obj[key];
  }
  return fnv1a(canonicalStringify(payload));
}

/**
 * 校验存档签名
 * @returns {'ok'|'bad'|'unsigned'}
 *   unsigned = 旧档本来就没签名（v1 灰度期零误伤，不判损坏）；
 *   按档内版本取白名单，未知版本（如未来档回到老代码）也按 unsigned 处理
 */
export function checkSignature(obj, fieldTable, sigKey) {
  if (!obj || typeof obj !== 'object' || !obj[sigKey]) return 'unsigned';
  const ver = obj.sessionVer ?? obj.saveVer ?? obj.version ?? 1;
  const fields = fieldTable[ver];
  if (!fields) return 'unsigned';
  return signFields(obj, fields) === obj[sigKey] ? 'ok' : 'bad';
}

/** 给局外 meta 盖签名（签名字段表按档内版本取；返回新对象，不改原档） */
export function sealMeta(meta) {
  const ver = meta?.saveVer ?? CURRENT_META_VER;
  const fields = SIGNED_FIELDS.meta[ver] || SIGNED_FIELDS.meta[CURRENT_META_VER];
  return { ...meta, _ck: signFields(meta, fields) };
}

/** 给局内 session 盖当前版本号与签名（返回新对象，不改原档） */
export function sealSession(session) {
  const signed = { ...session, sessionVer: CURRENT_SESSION_VER };
  return { ...signed, sig: signFields(signed, SIGNED_FIELDS.session[CURRENT_SESSION_VER]) };
}

// ---- 迁移链 ----

/**
 * 局外 meta 迁移（只增不改不删，幂等）
 *
 * v1 → v2（P0）：字段结构没有破坏性变更，差异仅是版本号改名（version → saveVer）；
 * 旧 version 不删（DEPRECATED 登记，读时 saveVer = raw.saveVer ?? raw.version ?? 1）。
 * 角色 / 遗物 / 进阶等字段随对应阶段（P1+）再走新的迁移步，本步不提前造字段。
 */
export const META_MIGRATIONS = [
  {
    from: 1,
    to: 2,
    up(saved) {
      saved.saveVer = 2;
      return saved;
    },
  },
];

/**
 * 局内 session 迁移
 *
 * v1 → v2（P0）：旧「线性第 N 层」结构没有地图。按 floor 合成一张等价单链地图
 * （mapgen.synthLinearMap：每排单节点、10/20/30 仍是 Boss），只存纯数据状态，
 * 不重掷 runRng（续玩随机序列接着走，沿用旧纪律）；地形 / 目标留空，
 * 由 mode-rogue 回退成旧版「8×8 满盘 + 单一分数目标」，保证旧棋盘快照语义不变。
 */
export const SESSION_MIGRATIONS = [
  {
    from: 1,
    to: 2,
    up(saved) {
      const floor = Math.max(1, Math.floor(saved.floor) || 1);
      const linear = synthLinearMap(floor);
      const mapStates = Object.fromEntries(
        linear.nodes.filter((n) => n.state !== 'locked').map((n) => [n.id, n.state]),
      );
      const current = linear.nodes.find((n) => n.state === 'open');
      return {
        ...saved,
        sessionVer: 2,
        mapSeed: null,      // null = 合成线性图（非随机地图，无 seed 可重建）
        mapParams: null,
        mapStates,
        nodeId: current ? current.id : 'n0',
        terrain: null,
        goals: null,
      };
    },
  },
  /**
   * v2 → v3（开发方案 3.3 胜利闭环）：追加四个字段，老档一律按「尚未进入该机制」补默认：
   * victory=false、bossKills=0、endless=false、boss=null（不覆盖档上已有值）。
   * 纯数据补齐、幂等，不重建地图、不重掷 runRng。
   */
  {
    from: 2,
    to: 3,
    up(saved) {
      const out = { ...saved, sessionVer: 3 };
      if (out.victory === undefined) out.victory = false;
      if (out.bossKills === undefined) out.bossKills = 0;
      if (out.endless === undefined) out.endless = false;
      if (out.boss === undefined) out.boss = null;
      return out;
    },
  },
  /**
   * v3 → v4（开发方案 3.4 / 3.5 / 3.6 局内金币、遗物、篝火升级、商店封禁）：
   * 老档一律按「本轮还没进过事件 / 商店、没有遗物」补默认，**不覆盖档上已有值**：
   * coins=0、relics=[]、upgradedPerkIds=[]、bannedPerkIds=[]。
   * 数组补空数组而不是 undefined：下游（遗物槽 / rollPerks 过滤）只判 length，
   * 留 undefined 会在老档续玩路径上多出一层判空。
   * 纯数据补齐、幂等，不重建地图、不重掷 runRng。
   */
  {
    from: 3,
    to: 4,
    up(saved) {
      const out = { ...saved, sessionVer: 4 };
      if (out.coins === undefined) out.coins = 0;
      if (!Array.isArray(out.relics)) out.relics = [];
      if (!Array.isArray(out.upgradedPerkIds)) out.upgradedPerkIds = [];
      if (!Array.isArray(out.bannedPerkIds)) out.bannedPerkIds = [];
      return out;
    },
  },
];

/**
 * 迁移入口
 *
 * @param {object|null} raw 原始存档
 * @param {object} opts
 * @param {number} opts.current 当前代码支持的版本
 * @param {Array<{from:number,to:number,up:Function}>} opts.migrations 迁移链
 * @param {object} [opts.defaults] 新档 / 坏档兜底形状（深拷贝，多份存档不共享引用）
 * @param {string} [opts.versionKey='saveVer'] 版本字段名
 * @param {string|null} [opts.legacyVersionKey=null] 旧版本字段别名（meta 的 version）
 * @returns {{ver:number, data:object, future:boolean, fresh:boolean}}
 *   future=true 表示存档版本高于当前（回滚场景）：不迁移、不报错，data 原样返回
 */
export function migrateSave(raw, {
  current,
  migrations,
  defaults = {},
  versionKey = 'saveVer',
  legacyVersionKey = null,
}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      ver: current,
      data: { ...deepClone(defaults), [versionKey]: current },
      future: false,
      fresh: true,
    };
  }

  let ver = Math.floor(Number(raw[versionKey]));
  if (!Number.isInteger(ver) || ver < 1) {
    const legacy = legacyVersionKey ? Math.floor(Number(raw[legacyVersionKey])) : NaN;
    ver = Number.isInteger(legacy) && legacy >= 1 ? legacy : 1;
  }

  // 回滚：高版本档不迁移、不报错（meta 未知 key 由归一化层收进 _ext；session 上层写墓碑）
  if (ver > current) return { ver, data: raw, future: true, fresh: false };

  let data = deepClone(raw);
  for (const step of migrations) {
    if (step.from >= ver && step.to <= current) data = step.up(data) ?? data;
  }
  // 顶层缺 key 补深拷贝默认（嵌套补齐由各 up 负责，默认表只兜顶层）
  for (const [key, value] of Object.entries(defaults)) {
    if (data[key] === undefined) data[key] = deepClone(value);
  }
  data[versionKey] = current;
  return { ver: current, data, future: false, fresh: false };
}

/** meta 迁移便捷封装（含 v1 version 别名） */
export function migrateMeta(raw, current = CURRENT_META_VER) {
  return migrateSave(raw, {
    current,
    migrations: META_MIGRATIONS,
    versionKey: 'saveVer',
    legacyVersionKey: 'version',
  });
}

/** session 迁移便捷封装（无版本字段视为 1） */
export function migrateSession(raw, current = CURRENT_SESSION_VER) {
  return migrateSave(raw, {
    current,
    migrations: SESSION_MIGRATIONS,
    versionKey: 'sessionVer',
    legacyVersionKey: null,
  });
}
