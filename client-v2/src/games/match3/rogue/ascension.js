/**
 * 进阶难度 Ascension（开发方案 3.10，P6）
 *
 * 给通关玩家持续追求：首次在进阶 0 击败第 30 层 Boss → 解锁进阶 1，以此类推。
 * 每一级是**一条作用于现有公式的修正**，全部数据驱动、叠在既有推导上
 * （goalOf 的目标系数 / floorOptions 的步数 / floorGoals 的精英系数 / boss 血量 / 商店价格），
 * 只影响难度，不掉新强度（避免与 meta 付费混淆）；奖励是专属徽章 + 更高精华系数。
 *
 * 实现上分两类，减少签名改动：
 * - 直接写进本轮 `bonus` 的（moves / goalMult / colorFloor）：由 floorOptions / goalOf 自然读到，
 *   无需改任何函数签名；
 * - 需要额外入参的（eliteBonus 给 mapgen、eliteMult 给 floorGoals、bossMult 给 boss、shopMult 给商店）：
 *   通过 `asc` 对象在调用点显式传入。
 *
 * 纯数据 + 纯函数，可被标定脚本与单测直接 import。
 */
import { ROGUE_META } from '../config/config.js';

/** 首发开放到进阶 10（文档目标 0–15，首期先到 10）；上限取自 config，与服务端同源 */
export const MAX_ASCENSION = ROGUE_META.ascension?.max ?? 10;

/**
 * 进阶修正表：每级一条，可独立理解
 * - goalMult：乘到 goalOf 的目标系数上（所有分数目标 + Boss 血量同源放大）
 * - moves：每层起手步数增减（负数）
 * - eliteBonus：每区域精英额外数量（mapgen 上限 1）
 * - eliteMult：精英层分数目标额外系数
 * - bossMult：Boss 血量额外系数
 * - shopMult：商店价格系数
 * - colorFloor：元素种类下限抬升（压缩「降色 build」的空间）
 */
export const ASCENSIONS = [
    { lv: 1, desc: '所有目标分 +5%', mod: { goalMult: 1.05 } },
    { lv: 2, desc: '每层起手 −1 步', mod: { moves: -1 } },
    { lv: 3, desc: '精英层每区域 +1', mod: { eliteBonus: 1 } },
    { lv: 4, desc: '商店价格 +20%', mod: { shopMult: 1.2 } },
    { lv: 5, desc: 'Boss 血量 +15%', mod: { bossMult: 1.15 } },
    { lv: 6, desc: '所有目标分再 +5%', mod: { goalMult: 1.05 } },
    { lv: 7, desc: '每层起手再 −1 步', mod: { moves: -1 } },
    { lv: 8, desc: '精英目标分 +10%', mod: { eliteMult: 1.1 } },
    { lv: 9, desc: '所有目标分再 +10%', mod: { goalMult: 1.1 } },
    { lv: 10, desc: '元素种类下限 +1（最低 5 色）', mod: { colorFloor: 5 } },
];

/** 进阶 0 的「无修正」基线（未解锁 / 未选择时用它，与旧版逐位一致） */
const BASE_MODS = {
    goalMult: 1,
    moves: 0,
    eliteBonus: 0,
    eliteMult: 1,
    bossMult: 1,
    shopMult: 1,
    colorFloor: 0,
};

/**
 * 把 1..lv 级的修正合并成一份 `mods`（每级一条叠加）
 * @param {number} lv - 选择的进阶等级（0 = 无修正）
 * @returns {typeof BASE_MODS}
 */
export function ascMods(lv = 0) {
    const n = Math.max(0, Math.min(MAX_ASCENSION, Math.floor(lv) || 0));
    const out = { ...BASE_MODS };
    for (const entry of ASCENSIONS) {
        if (entry.lv > n) break;
        const m = entry.mod;
        if (Number.isFinite(m.goalMult)) out.goalMult *= m.goalMult;
        if (Number.isFinite(m.moves)) out.moves += m.moves;
        if (Number.isFinite(m.eliteBonus)) out.eliteBonus = Math.max(out.eliteBonus, m.eliteBonus);
        if (Number.isFinite(m.eliteMult)) out.eliteMult *= m.eliteMult;
        if (Number.isFinite(m.bossMult)) out.bossMult *= m.bossMult;
        if (Number.isFinite(m.shopMult)) out.shopMult *= m.shopMult;
        if (Number.isFinite(m.colorFloor)) out.colorFloor = Math.max(out.colorFloor, m.colorFloor);
    }
    return out;
}

/**
 * 把「直接进 bonus」的那部分修正写进本轮加成
 * （moves / goalMult / colorFloor；其余通过 asc 对象在调用点使用）
 * @param {object} bonus - createBonus() 的结果（就地修改）
 * @param {object} asc - ascMods 的结果
 */
export function applyAscension(bonus, asc) {
    if (!asc) return;
    bonus.moves += asc.moves || 0;
    bonus.goalMult = (bonus.goalMult || 1) * (asc.goalMult || 1);
    bonus.colorFloor = Math.max(bonus.colorFloor || 0, asc.colorFloor || 0);
}

/**
 * 进阶的通关精华系数（越高进阶奖励越高，设上限，防「打高进阶刷精华」）
 * 与服务端 ascensionEssenceMult 同口径，两端手工同步。
 * @param {number} lv
 * @returns {number} 倍率（进阶 0 = 1）
 */
export function ascensionEssenceMult(lv = 0) {
    const n = Math.max(0, Math.min(MAX_ASCENSION, Math.floor(lv) || 0));
    const per = ROGUE_META.ascension?.essenceMultPerLevel ?? 0.05;
    const cap = ROGUE_META.ascension?.essenceMultCap ?? 1.5;
    return Math.min(cap, 1 + per * n);
}

/**
 * 选择某进阶前必须已解锁：最高已解锁进阶 = meta.ascension.max（服务端权威下发）
 * 选择范围是 0..max（不能跳级选到未解锁的高阶）。
 * @param {object} meta - 养成存档
 * @param {number} lv
 * @returns {boolean}
 */
export function ascensionUnlocked(meta, lv) {
    const max = Math.max(0, Math.floor(meta?.ascension?.max || 0));
    return lv >= 0 && lv <= max;
}

/** 一段简短的进阶说明（卡片副标题 / 结算页用） */
export function ascensionLabel(lv) {
    const n = Math.max(0, Math.min(MAX_ASCENSION, Math.floor(lv) || 0));
    if (n === 0) return '标准难度';
    return `进阶 ${n}`;
}

/** 某进阶相对上一级的修正说明（选择 UI 逐条展示「这一级加了什么」） */
export function ascensionDelta(lv) {
    const n = Math.max(1, Math.min(MAX_ASCENSION, Math.floor(lv) || 1));
    return ASCENSIONS.filter((e) => e.lv <= n).map((e) => `Lv.${e.lv} ${e.desc}`);
}
