/**
 * 图鉴详情预览引擎：直接运行真实的 buff / 怪物模块，而不是手写近似动画。
 *
 * 战斗管线与 index.js 保持一致（来源行号）：
 * spawnEnemy 865 / spawnBoss 899 / spawnParticles 967 / nearestEnemy 986 /
 * spawnProjectile 1002 / fireVolley 1025 / autoAttack 1055 / explodeAt 1077 /
 * hurtPlayer 1088 / spawnEnemyShot 1121 / moveEnemy 1136 / damageEnemy 1163 /
 * buffApi 1213 / monsterApi 1240 / updateBuffs 1258 / 主循环 1264-1443。
 *
 * 与对局的差异只有一个：世界缩小到 480×360，玩家是无限生命的演示靶，
 * 死亡/升级/存档都不结算。弹道数量、爆炸半径、连锁、元素反应、治疗、召唤
 * 全部由真实模块和战斗公式决定。
 */
import { PLAYER_BASE, BASE_SHOT, snapshotBaseStats, deriveStats } from './base.js';
import {
  skillDamage, damageTakenZone, defenseMitigation,
} from './combat.js';
import {
  ELEMENT_INFO, ELEMENT_DURATION, applyElementHit, applyElementAoe, applyShatter,
  ICE_SLOW_FACTOR,
} from './elements.js';
import { SHIELD_HIT_CD } from './buffs/shield.js';
import shardMonster from './monsters/shard.js';

import buffDamage from './buffs/damage.js';
import buffHp from './buffs/hp.js';
import buffArmor from './buffs/armor.js';
import buffRegen from './buffs/regen.js';
import buffLifesteal from './buffs/lifesteal.js';
import buffSpeed from './buffs/speed.js';
import buffPickup from './buffs/pickup.js';
import buffShield from './buffs/shield.js';
import buffRate from './buffs/rate.js';
import buffMulti from './buffs/multi.js';
import buffProjSpeed from './buffs/projspeed.js';
import buffPierce from './buffs/pierce.js';
import buffCombo from './buffs/combo.js';
import buffFire from './buffs/fire.js';
import buffIce from './buffs/ice.js';
import buffThunder from './buffs/thunder.js';
import buffWater from './buffs/water.js';
import buffSplash from './buffs/splash.js';
import buffFragment from './buffs/fragment.js';
import buffNova from './buffs/nova.js';
import buffThorns from './buffs/thorns.js';
import buffExplode from './buffs/explode.js';
import buffElectroChain from './buffs/electro-chain.js';
import buffElectroStorm from './buffs/electro-storm.js';
import buffElectroAmp from './buffs/electro-amp.js';

export const PREVIEW_W = 480;
export const PREVIEW_H = 360;
const PX = PREVIEW_W / 2;
const PY = PREVIEW_H - 74;
const TAU = Math.PI * 2;
const DUMMY_HP = 100000;

const BUFF_MODULES = new Map([
  buffDamage, buffHp, buffArmor, buffRegen, buffLifesteal, buffSpeed, buffPickup, buffShield,
  buffRate, buffMulti, buffProjSpeed, buffPierce, buffCombo, buffFire, buffIce, buffThunder,
  buffWater, buffSplash, buffFragment, buffNova, buffThorns, buffExplode,
  buffElectroChain, buffElectroStorm, buffElectroAmp,
].map((buff) => [buff.id, buff]));

/** 纯属性类强化：画布显示真实数值面板，不画战斗光效 */
const STAT_BUFFS = new Set([
  'hp', 'armor', 'shield', 'regen', 'lifesteal', 'speed', 'pickup',
]);

const REACTION_BUFFS = new Set(['electrochain', 'electrostorm', 'electroamp']);
const REACTION_PREREQ_LEVEL = 2;
const THORNS_PREREQ_LEVEL = 2;

/** 元素弹类强化：靶子放在挂元素半径内 */
const ELEMENT_BUFFS = new Set(['fire', 'ice', 'thunder', 'water']);

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function rand(min, max) {
  return min + Math.random() * (max - min);
}

function createPlayer() {
  const p = { ...PLAYER_BASE, base: snapshotBaseStats(PLAYER_BASE), x: PX, y: PY, face: -Math.PI / 2 };
  deriveStats(p);
  p.hp = p.maxHp;
  p.shield = Math.min(p.shield || 0, p.shieldMax);
  return p;
}

function createWorld(player) {
  const w = {
    time: 0,
    level: 1,
    bossCount: 0,
    player,
    enemies: [],
    projectiles: [],
    enemyShots: [],
    particles: [],
    novas: [],
    explosions: [],
    lightningArcs: [],
    gems: [],
    healthPacks: [],
    floaters: [],
    attackTimer: 0.35,
    comboTimer: 0,
    comboPending: 0,
    novaTimer: 2.5,
    thornsCd: 0,
    reactionCd: 0,
    hurtCd: 0,
    flash: 0,
    shake: 0,
    dmgAccum: 0,
    kills: 0,
    nextEnemyId: 1,
    simBuffs: [],
    statBase: null,
    // 属性面板 / 场景导演用的计时器
    statTimer: 0,
    clusterTimer: 0,
    thornsTriggerTimer: 1.2,
    executeTimer: 3,
    respawnTimer: 0,
    respawnArmed: false,
    primary: null,
    monsterMap: new Map(),
  };
  w.buffApi = createBuffApi(w);
  w.monsterApi = createMonsterApi(w);
  return w;
}

// ---------------- 真实战斗函数（与 index.js 一致） ----------------

function nearestEnemy(w) {
  const p = w.player;
  let best = null;
  let bestD2 = 800 * 800;
  for (const e of w.enemies) {
    if (e.dead) continue;
    const d2 = (e.x - p.x) ** 2 + (e.y - p.y) ** 2;
    if (d2 < bestD2) {
      bestD2 = d2;
      best = e;
    }
  }
  return best;
}

function spawnProjectile(w, spec) {
  if (w.projectiles.length > 300) return;
  const {
    x, y, angle, speed, damage,
  } = spec;
  w.projectiles.push({
    x,
    y,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    r: spec.r ?? 4.5,
    damage,
    pierceLeft: spec.pierce ?? 0,
    hit: new Set(spec.ignoreIds || []),
    life: spec.life ?? 1.5,
    dead: false,
    element: spec.element || 'physical',
    elementRadius: spec.elementRadius || 0,
    elementDuration: spec.elementDuration || ELEMENT_DURATION,
    color: spec.color || '',
    fragment: spec.fragment || false,
  });
}

function fireVolley(w, damageScale = 1) {
  const target = nearestEnemy(w);
  if (!target) return false;
  const p = w.player;
  const base = Math.atan2(target.y - p.y, target.x - p.x);
  const n = p.projectiles;
  const spread = n > 1 ? Math.min(BASE_SHOT.spreadMax, BASE_SHOT.spreadStep * (n - 1)) : 0;
  const volley = { base, damageScale, shots: [] };
  for (let i = 0; i < n; i += 1) {
    const angle = n === 1 ? base : base - spread + (spread * 2 * i) / (n - 1);
    volley.shots.push({
      x: p.x + Math.cos(angle) * (p.r + BASE_SHOT.muzzle),
      y: p.y + Math.sin(angle) * (p.r + BASE_SHOT.muzzle),
      angle,
      speed: p.projectileSpeed,
      damage: skillDamage(p, { atkPct: damageScale }),
      r: BASE_SHOT.r,
      pierce: p.pierce,
      life: BASE_SHOT.life,
      element: 'physical',
    });
  }
  for (const buff of w.simBuffs) {
    if (typeof buff.buildShots === 'function') buff.buildShots(volley, p, w);
  }
  for (const shot of volley.shots) spawnProjectile(w, shot);
  return true;
}

function autoAttack(w, dt) {
  w.attackTimer -= dt;
  if (w.attackTimer > 0) return;
  if (!nearestEnemy(w)) {
    w.attackTimer = 0;
    return;
  }
  const p = w.player;
  w.attackTimer = p.attackInterval;
  fireVolley(w, 1);
  for (const buff of w.simBuffs) {
    if (typeof buff.afterAttack === 'function') buff.afterAttack(p, w, w.buffApi);
  }
}

function spawnParticles(w, x, y, color, count, speed) {
  if (w.particles.length > 300) return;
  for (let i = 0; i < count; i += 1) {
    const a = Math.random() * TAU;
    const v = rand(speed * 0.35, speed);
    w.particles.push({
      x,
      y,
      vx: Math.cos(a) * v,
      vy: Math.sin(a) * v,
      life: rand(0.25, 0.55),
      maxLife: 0.55,
      r: rand(1.5, 3.4),
      color,
    });
  }
}

function addExplosionVisual(w, x, y, radius) {
  if (w.explosions.length >= 40) return;
  w.explosions.push({
    x, y, r: radius * 0.35, maxR: radius, life: 0.28, maxLife: 0.28,
  });
}

function addFloater(w, x, y, text, color) {
  if (w.floaters.length >= 80) return;
  w.floaters.push({
    x: x + rand(-6, 6),
    y,
    vy: -34,
    life: 0.72,
    maxLife: 0.72,
    text: String(text),
    color: color || '#fde68a',
  });
}

function damageEnemy(w, enemy, damage, depth = 0) {
  const final = enemy.vulnTimer > 0 ? damage * (1 + (enemy.vulnBonus || 0)) : damage;
  w.dmgAccum += Math.min(final, enemy.hp);
  enemy.hp -= final;
  enemy.flash = 0.12;
  addFloater(w, enemy.x, enemy.y - enemy.r - 4, Math.round(final));
  spawnParticles(w, enemy.x, enemy.y, '#ffd93d', 3, 130);
  if (enemy.hp > 0 || enemy.dead) return;

  enemy.dead = true;
  w.kills += 1;
  const p = w.player;
  if (p.lifesteal > 0) p.hp = Math.min(p.maxHp, p.hp + p.lifesteal);
  spawnParticles(w, enemy.x, enemy.y, enemy.color, enemy.boss ? 26 : 10, enemy.boss ? 280 : 170);

  const monster = w.monsterMap.get(enemy.type);
  if (monster && typeof monster.onDeath === 'function') monster.onDeath(enemy, w.monsterApi);
  for (const buff of w.simBuffs) {
    if (typeof buff.onKill === 'function') buff.onKill(enemy, p, w, w.buffApi, depth);
  }
}

function explodeAt(w, x, y, radius, damage, excludeId, depth = 0) {
  if (damage <= 0) return;
  addExplosionVisual(w, x, y, radius);
  spawnParticles(w, x, y, '#ffb703', 8, 210);
  for (const e of w.enemies) {
    if (e.dead || e.id === excludeId) continue;
    const rr = radius + e.r;
    if ((e.x - x) ** 2 + (e.y - y) ** 2 <= rr * rr) damageEnemy(w, e, damage, depth + 1);
  }
}

function hurtPlayer(w, amount) {
  if (w.hurtCd > 0) return false;
  w.hurtCd = 0.4;
  const p = w.player;
  const capped = Math.min(amount, p.maxHp * 0.3);
  let final = Math.max(1, capped * damageTakenZone(p.def));
  let absorbed = 0;
  if (p.shield > 0) {
    absorbed = Math.min(p.shield, final);
    p.shield -= absorbed;
    final -= absorbed;
    p.shieldCd = SHIELD_HIT_CD;
  }
  if (final > 0) p.hp -= final;
  w.flash = 1;
  w.shake = 0.3;
  spawnParticles(w, p.x, p.y, absorbed > 0 ? '#7dd3fc' : '#ff6b6b', 6, 190);

  const info = { amount, absorbed, hpDamage: Math.max(0, final) };
  for (const buff of w.simBuffs) {
    if (typeof buff.onHurt === 'function') buff.onHurt(p, w, info, w.buffApi);
  }
  return false;
}

function spawnEnemyShot(w, x, y, angle, speed, damage, color) {
  if (w.enemyShots.length >= 160) return;
  w.enemyShots.push({
    x,
    y,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    r: 5,
    damage,
    color: color || '#fb7185',
    life: 4,
    dead: false,
  });
}

function moveEnemy(w, e, dx, dy, dist, dt, speedMul = 1) {
  if (e.freezeTimer > 0) return;
  e.x += (dx / dist) * e.speed * speedMul * dt;
  e.y += (dy / dist) * e.speed * speedMul * dt;
}

function spawnEnemy(w, typeId, atX, atY) {
  const monster = w.monsterMap.get(typeId) || shardMonster;
  const tpl = monster.stats || {};
  const enemy = {
    id: w.nextEnemyId++,
    type: monster.id,
    shape: tpl.shape || 'circle',
    color: tpl.color || '#94a3b8',
    x: atX == null ? PX : atX,
    y: atY == null ? 90 : atY,
    r: tpl.r || 12,
    hp: Math.round(tpl.hp || 20),
    maxHp: Math.round(tpl.hp || 20),
    speed: tpl.speed || 70,
    dmg: tpl.dmg || 8,
    xp: tpl.xp || 0,
    mode: 'chase',
    timer: 0,
    shootCd: rand(1.2, 2.4),
    fuse: 0,
    boss: !!monster.boss,
    hitCd: 0,
    flash: 0,
    dead: false,
  };
  w.enemies.push(enemy);
  return enemy;
}

function createBuffApi(w) {
  return {
    addNova(x, y, innerR, maxR, color) {
      w.novas.push({
        x, y, r: innerR, maxR, life: 0.5, maxLife: 0.5, color,
      });
    },
    damageInRadius(x, y, radius, damage) {
      for (const e of w.enemies) {
        if (e.dead) continue;
        const rr = radius + e.r;
        if ((e.x - x) ** 2 + (e.y - y) ** 2 <= rr * rr) damageEnemy(w, e, damage);
      }
    },
    damageEnemy(enemy, damage, depth = 0) {
      damageEnemy(w, enemy, damage, depth);
    },
    explodeAt(x, y, radius, damage, excludeId, depth = 0) {
      explodeAt(w, x, y, radius, damage, excludeId, depth);
    },
    fireVolley(damageScale = 1) {
      return fireVolley(w, damageScale);
    },
    spawnPlayerShot(spec) {
      spawnProjectile(w, spec);
    },
    spawnParticles(x, y, color, count, speed) {
      spawnParticles(w, x, y, color, count, speed);
    },
  };
}

function createMonsterApi(w) {
  return {
    state: w,
    rand,
    moveEnemy(e, dx, dy, dist, dt, speedMul = 1) {
      moveEnemy(w, e, dx, dy, dist, dt, speedMul);
    },
    spawnEnemy(typeId, x, y) {
      return spawnEnemy(w, typeId, x, y);
    },
    spawnEnemyShot(x, y, angle, speed, damage, color) {
      spawnEnemyShot(w, x, y, angle, speed, damage, color);
    },
    spawnParticles(x, y, color, count, speed) {
      spawnParticles(w, x, y, color, count, speed);
    },
    addExplosionVisual(x, y, radius) {
      addExplosionVisual(w, x, y, radius);
    },
    hurtPlayer(amount) {
      return hurtPlayer(w, amount);
    },
    spawnHealthPack(x, y) {
      w.healthPacks.push({ x, y, r: 9, bob: Math.random() * 6, dead: false });
    },
    shake(v) {
      w.shake = Math.max(w.shake, v);
    },
    clampToArena(e, margin = 40) {
      e.x = Math.max(-margin, Math.min(PREVIEW_W + margin, e.x));
      e.y = Math.max(-margin, Math.min(PREVIEW_H + margin, e.y));
    },
  };
}

// ---------------- 场景构建 ----------------

function applyBuff(w, buff, times) {
  for (let i = 0; i < times; i += 1) buff.apply(w.player, w);
  deriveStats(w.player);
}

function addBuff(w, buff, times) {
  if (!buff || times <= 0) return;
  if (!w.simBuffs.includes(buff)) w.simBuffs.push(buff);
  applyBuff(w, buff, times);
}

function spawnDummy(w, dx, dy, options = {}) {
  const hp = options.hp ?? DUMMY_HP;
  const enemy = {
    id: w.nextEnemyId++,
    type: options.type || 'basic',
    shape: options.shape || 'circle',
    color: options.color || '#ff7b7b',
    x: PX + dx,
    y: PY + dy,
    r: options.r || 11,
    hp,
    maxHp: options.maxHp ?? hp,
    speed: 0,
    dmg: 0,
    xp: 0,
    mode: 'chase',
    timer: 0,
    shootCd: 99,
    fuse: 0,
    boss: false,
    hitCd: 0,
    flash: 0,
    dead: false,
    dummy: true,
    ally: !!options.ally,
    showHp: !!options.showHp,
  };
  w.enemies.push(enemy);
  return enemy;
}

function spawnExplodeCluster(w) {
  const spots = [
    [-32, -185], [0, -200], [32, -185], [-16, -160], [16, -160],
  ];
  for (const [dx, dy] of spots) spawnDummy(w, dx, dy, { hp: 8, maxHp: 26 });
}

function buildBuffScenario(buff, level) {
  const player = createPlayer();
  const w = createWorld(player);
  w.statBase = createPlayer();

  if (REACTION_BUFFS.has(buff.id)) {
    addBuff(w, BUFF_MODULES.get('water'), REACTION_PREREQ_LEVEL);
    addBuff(w, BUFF_MODULES.get('thunder'), REACTION_PREREQ_LEVEL);
  }
  if (buff.id === 'thorns') {
    addBuff(w, BUFF_MODULES.get('shield'), THORNS_PREREQ_LEVEL);
  }
  addBuff(w, buff, level);

  if (STAT_BUFFS.has(buff.id)) {
    // 演示起始状态：把血量/护盾放在接近满值的位置，真实回复速度才看得见
    if (buff.id === 'regen') player.hp = Math.max(1, player.maxHp - 6);
    if (buff.id === 'lifesteal') player.hp = Math.max(1, player.maxHp - Math.max(2, player.lifesteal * 4));
    if (buff.id === 'shield') player.shield = player.shieldMax * 0.35;
    if (buff.id === 'pickup') {
      for (let i = 0; i < 6; i += 1) {
        const a = rand(0, TAU);
        const r = player.pickup * rand(0.8, 1);
        w.gems.push({ x: PX + Math.cos(a) * r, y: PY + Math.sin(a) * r, value: 1, r: 5, bob: rand(0, 6) });
      }
    }
    return w;
  }

  if (buff.id === 'pierce') {
    for (const dy of [-205, -145, -85]) spawnDummy(w, 0, dy, { r: 12 });
  } else if (ELEMENT_BUFFS.has(buff.id)) {
    for (const [dx, dy] of [[-28, -185], [28, -185], [0, -160], [0, -210]]) spawnDummy(w, dx, dy);
  } else if (buff.id === 'splash') {
    for (const [dx, dy] of [[-42, -185], [0, -205], [42, -185], [-20, -160], [20, -160]]) spawnDummy(w, dx, dy);
  } else if (buff.id === 'fragment') {
    for (const [dx, dy] of [[-45, -190], [45, -190], [-45, -145], [0, -125], [45, -145]]) spawnDummy(w, dx, dy);
  } else if (buff.id === 'nova') {
    const radius = 110 + 30 * (level - 1);
    for (const deg of [-140, -110, -70, -40]) {
      const a = (deg * Math.PI) / 180;
      spawnDummy(w, Math.cos(a) * radius * 0.78, Math.sin(a) * radius * 0.78);
    }
  } else if (buff.id === 'explode') {
    spawnExplodeCluster(w);
    w.clusterTimer = 2.4;
  } else if (REACTION_BUFFS.has(buff.id)) {
    for (const center of [[-90, -170], [90, -170], [0, -215]]) {
      for (let i = 0; i < 3; i += 1) {
        spawnDummy(w, center[0] + rand(-16, 16), center[1] + rand(-16, 16), { r: 10 });
      }
    }
  } else if (buff.id === 'thorns') {
    for (const deg of [-150, -115, -65, -30]) {
      const a = (deg * Math.PI) / 180;
      spawnDummy(w, Math.cos(a) * 62, Math.sin(a) * 62, { r: 10 });
    }
  } else {
    // 中间那只离玩家最近，自动索敌会优先打它；两侧依次后撤，避免总是锁定最边上的怪
    for (const [dx, dy] of [[-110, -230], [-55, -215], [0, -195], [55, -215], [110, -230]]) {
      spawnDummy(w, dx, dy);
    }
  }
  return w;
}

function buffNote(buff) {
  if (REACTION_BUFFS.has(buff.id)) return `含 水 Lv.${REACTION_PREREQ_LEVEL} / 雷 Lv.${REACTION_PREREQ_LEVEL} 前置`;
  if (buff.id === 'thorns') return `含 护盾 Lv.${THORNS_PREREQ_LEVEL} 前置`;
  return '';
}

function buildMonsterScenario(monster) {
  const player = createPlayer();
  player.maxHp = 9999;
  player.hp = 9999;
  const w = createWorld(player);
  w.monsterMap.set(monster.id, monster);
  w.monsterMap.set('shard', shardMonster);
  w.player.face = -Math.PI / 2;

  const start = {
    bomber: { x: PX, y: 170 },
    healer: { x: PX, y: 100 },
    summoner: { x: PX, y: 80 },
  }[monster.id] || { x: PX, y: 60 };

  const primary = spawnEnemy(w, monster.id, start.x, start.y);
  primary.primary = true;
  if (primary.boss) primary.shootCd = 1.4;
  // 闪现者演示：缩短第一次闪烁的等待，进详情页很快能看到「绕后 → 预警 → 突刺」
  if (monster.id === 'blinker') primary.blinkCd = 0.7;
  w.primary = primary;

  if (monster.id === 'healer') {
    spawnDummy(w, 60, -126, { ally: true, showHp: true, hp: 12, maxHp: 34 });
    spawnDummy(w, -60, -136, { ally: true, showHp: true, hp: 10, maxHp: 34 });
  }
  return w;
}

// ---------------- 更新 ----------------

function updateProjectiles(w, dt) {
  const p = w.player;
  for (const pr of w.projectiles) {
    if (pr.dead) continue;
    pr.x += pr.vx * dt;
    pr.y += pr.vy * dt;
    pr.life -= dt;
    if (pr.life <= 0 || pr.x < -20 || pr.x > PREVIEW_W + 20 || pr.y < -20 || pr.y > PREVIEW_H + 20) {
      pr.dead = true;
      continue;
    }
    for (const e of w.enemies) {
      if (e.dead || pr.hit.has(e.id)) continue;
      const rr = pr.r + e.r;
      if ((pr.x - e.x) ** 2 + (pr.y - e.y) ** 2 <= rr * rr) {
        pr.hit.add(e.id);
        damageEnemy(w, e, pr.damage);
        if (pr.element === 'physical') applyShatter(e, w, p, w.buffApi);
        if (pr.element && pr.element !== 'physical') {
          applyElementHit(e, pr.element, w, p, w.buffApi, pr.elementDuration, pr.damage);
          if (pr.elementRadius > 0) {
            applyElementAoe(w, p, w.buffApi, pr.x, pr.y, pr.elementRadius, pr.element, pr.elementDuration, e.id);
          }
        }
        for (const buff of w.simBuffs) {
          if (typeof buff.onHit === 'function') buff.onHit(e, pr, p, w.buffApi);
        }
        if (pr.pierceLeft <= 0) {
          pr.dead = true;
          break;
        }
        pr.pierceLeft -= 1;
      }
    }
  }
}

function updateEnemyShots(w, dt) {
  const p = w.player;
  for (const s of w.enemyShots) {
    if (s.dead) continue;
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    s.life -= dt;
    if (s.life <= 0 || s.x < -30 || s.x > PREVIEW_W + 30 || s.y < -30 || s.y > PREVIEW_H + 30) {
      s.dead = true;
      continue;
    }
    const rr = s.r + p.r;
    if ((s.x - p.x) ** 2 + (s.y - p.y) ** 2 <= rr * rr) {
      s.dead = true;
      spawnParticles(w, s.x, s.y, s.color, 5, 150);
      hurtPlayer(w, s.damage);
    }
  }
}

function decayEnemyTimers(w, dt) {
  for (const e of w.enemies) {
    if (e.dead) continue;
    e.hitCd = Math.max(0, e.hitCd - dt);
    e.flash = Math.max(0, e.flash - dt);
    if (e.elementTimer > 0) {
      e.elementTimer -= dt;
      if (e.elementTimer <= 0) e.element = '';
    }
    if (e.reactCd > 0) e.reactCd = Math.max(0, e.reactCd - dt);
    if (e.freezeTimer > 0) {
      e.freezeTimer = Math.max(0, e.freezeTimer - dt);
      if (e.freezeTimer <= 0) e.freezeAngle = 0;
    }
    if (e.vulnTimer > 0) e.vulnTimer = Math.max(0, e.vulnTimer - dt);
  }
}

function updateEffects(w, dt) {
  for (const pt of w.particles) {
    pt.x += pt.vx * dt;
    pt.y += pt.vy * dt;
    pt.vx *= 0.94;
    pt.vy *= 0.94;
    pt.life -= dt;
  }
  for (const n of w.novas) n.life -= dt;
  for (const ex of w.explosions) ex.life -= dt;
  for (const arc of w.lightningArcs) arc.life -= dt;
  for (const f of w.floaters) {
    f.y += f.vy * dt;
    f.vy *= 0.94;
    f.life -= dt;
  }
}

function filterWorld(w) {
  w.enemies = w.enemies.filter((e) => !e.dead);
  w.projectiles = w.projectiles.filter((pr) => !pr.dead);
  w.enemyShots = w.enemyShots.filter((s) => !s.dead);
  w.particles = w.particles.filter((pt) => pt.life > 0);
  w.novas = w.novas.filter((n) => n.life > 0);
  w.explosions = w.explosions.filter((ex) => ex.life > 0);
  w.lightningArcs = w.lightningArcs.filter((arc) => arc.life > 0);
  w.gems = w.gems.filter((g) => !g.collected);
  w.floaters = w.floaters.filter((f) => f.life > 0);
  w.healthPacks = w.healthPacks.filter((h) => !h.dead);
}

function updateStatScene(w, buff, dt) {
  const p = w.player;
  w.statTimer += dt;
  switch (buff.id) {
    case 'regen':
      p.hp = Math.min(p.maxHp, p.hp + p.regen * dt);
      if (p.hp >= p.maxHp && w.statTimer > 2) {
        p.hp = Math.max(1, p.maxHp - 6);
        w.statTimer = 0;
      }
      break;
    case 'hp':
      p.hp = p.maxHp;
      break;
    case 'shield': {
      if (typeof buffShield.update === 'function') buffShield.update(dt, p, w, w.buffApi);
      if (w.statTimer > 5) {
        w.statTimer = 0;
        const before = p.hp;
        hurtPlayer(w, 5);
        p.hp = Math.max(before, p.maxHp);
      }
      break;
    }
    case 'lifesteal':
      if (p.hp >= p.maxHp) {
        if (w.statTimer > 1) {
          p.hp = Math.max(1, p.maxHp - Math.max(2, p.lifesteal * 4));
          w.statTimer = 0;
        }
      } else if (w.statTimer > 0.8) {
        w.statTimer = 0;
        p.hp = Math.min(p.maxHp, p.hp + p.lifesteal);
      }
      break;
    case 'pickup':
      updatePickupGems(w, dt);
      break;
    default:
      break;
  }
  w.hurtCd = Math.max(0, w.hurtCd - dt);
  w.flash = Math.max(0, w.flash - dt * 2.2);
  w.shake = Math.max(0, w.shake - dt * 2.5);
  updateEffects(w, dt);
  filterWorld(w);
}

function updatePickupGems(w, dt) {
  const p = w.player;
  for (const g of w.gems) {
    if (g.collected) continue;
    const dx = p.x - g.x;
    const dy = p.y - g.y;
    const dist = Math.hypot(dx, dy) || 1;
    const step = 420 * dt;
    if (dist <= step) {
      g.collected = true;
      const a = rand(0, TAU);
      const r = p.pickup * rand(0.72, 0.98);
      w.gems.push({ x: p.x + Math.cos(a) * r, y: p.y + Math.sin(a) * r, value: 1, r: 5, bob: rand(0, 6) });
    } else {
      g.x += (dx / dist) * step;
      g.y += (dy / dist) * step;
    }
  }
}

function updateHealthPacks(w, dt) {
  const p = w.player;
  for (const h of w.healthPacks) {
    if (h.dead) continue;
    const dx = p.x - h.x;
    const dy = p.y - h.y;
    const dist = Math.hypot(dx, dy) || 1;
    // 预览里玩家固定不动，血包自动飘向玩家以展示「掉落 → 拾取回血」
    const step = 120 * dt;
    if (dist <= step + p.r) {
      h.dead = true;
      spawnParticles(w, h.x, h.y, '#4ade80', 14, 170);
      addFloater(w, p.x, p.y - p.r - 10, '+15% HP', '#4ade80');
    } else {
      h.x += (dx / dist) * step;
      h.y += (dy / dist) * step;
    }
  }
}

function updateBuffWorld(w, buff, dt) {
  w.time += dt;
  w.hurtCd = Math.max(0, w.hurtCd - dt);
  w.reactionCd = Math.max(0, w.reactionCd - dt);
  w.flash = Math.max(0, w.flash - dt * 2.2);
  w.shake = Math.max(0, w.shake - dt * 2.5);

  if (STAT_BUFFS.has(buff.id)) {
    updateStatScene(w, buff, dt);
    return;
  }

  if (buff.id === 'explode') {
    w.clusterTimer -= dt;
    const alive = w.enemies.filter((e) => !e.dead).length;
    if (w.clusterTimer <= 0 || alive === 0) {
      w.enemies = [];
      spawnExplodeCluster(w);
      w.clusterTimer = 2.4;
    }
  }
  if (buff.id === 'thorns') {
    w.thornsTriggerTimer -= dt;
    if (w.thornsTriggerTimer <= 0) {
      w.thornsTriggerTimer = 1.5;
      hurtPlayer(w, 12);
      w.player.hp = w.player.maxHp;
    }
  }

  autoAttack(w, dt);
  for (const item of w.simBuffs) {
    if (typeof item.update === 'function') item.update(dt, w.player, w, w.buffApi);
  }
  decayEnemyTimers(w, dt);
  updateProjectiles(w, dt);
  updateEnemyShots(w, dt);
  updateEffects(w, dt);
  filterWorld(w);
}

function updateMonsterWorld(w, monster, dt) {
  w.time += dt;
  w.hurtCd = Math.max(0, w.hurtCd - dt);
  w.flash = Math.max(0, w.flash - dt * 2.2);
  w.shake = Math.max(0, w.shake - dt * 2.5);
  const p = w.player;

  if (monster.id === 'splitter' || monster.id === 'healer') {
    w.executeTimer -= dt;
    if (w.executeTimer <= 0 && w.primary && !w.primary.dead) {
      w.executeTimer = monster.id === 'healer' ? 4.5 : 3.5;
      damageEnemy(w, w.primary, w.primary.maxHp + 1);
    }
  }

  for (const e of w.enemies) {
    if (e.dead) continue;
    e.hitCd = Math.max(0, e.hitCd - dt);
    e.flash = Math.max(0, e.flash - dt);
    if (e.elementTimer > 0) {
      e.elementTimer -= dt;
      if (e.elementTimer <= 0) e.element = '';
    }
    if (e.reactCd > 0) e.reactCd = Math.max(0, e.reactCd - dt);
    if (e.freezeTimer > 0) {
      e.freezeTimer = Math.max(0, e.freezeTimer - dt);
      if (e.freezeTimer <= 0) e.freezeAngle = 0;
    }
    if (e.vulnTimer > 0) e.vulnTimer = Math.max(0, e.vulnTimer - dt);
    if (e.ally) continue;
    if (e.freezeTimer > 0) continue;

    const dx = p.x - e.x;
    const dy = p.y - e.y;
    const dist = Math.hypot(dx, dy) || 1;
    const iceSlow = e.element === 'ice' ? ICE_SLOW_FACTOR : 1;
    const rawSpeed = e.speed;
    if (iceSlow !== 1) e.speed = rawSpeed * iceSlow;
    const template = w.monsterMap.get(e.type);
    if (template && typeof template.update === 'function') {
      template.update(e, dx, dy, dist, dt, w.monsterApi);
    } else {
      moveEnemy(w, e, dx, dy, dist, dt, 1);
    }
    if (iceSlow !== 1) e.speed = rawSpeed;
    // 预览是一块固定的小场地，把怪物限制在可见范围内（正式对局由玩家走位维持距离）
    e.x = clamp(e.x, 24, PREVIEW_W - 24);
    e.y = clamp(e.y, 24, PREVIEW_H - 24);
    if (e.dead) continue;

    const touchDist = Math.hypot(p.x - e.x, p.y - e.y) || 1;
    if (touchDist < e.r + p.r && e.hitCd <= 0) {
      e.hitCd = e.boss ? 0.55 : 0.8;
      hurtPlayer(w, e.dmg);
    }
  }

  updateEnemyShots(w, dt);
  updateHealthPacks(w, dt);
  updateEffects(w, dt);

  if (w.primary && w.primary.dead) {
    if (!w.respawnArmed) {
      w.respawnArmed = true;
      w.respawnTimer = 1.2;
    }
    w.respawnTimer -= dt;
    if (w.respawnTimer <= 0) {
      const start = {
        bomber: { x: PX, y: 170 },
        healer: { x: PX, y: 100 },
        summoner: { x: PX, y: 80 },
      }[monster.id] || { x: PX, y: 60 };
      const next = spawnEnemy(w, monster.id, start.x, start.y);
      next.primary = true;
      if (next.boss) next.shootCd = 1.4;
      w.primary = next;
      w.respawnArmed = false;
      if (monster.id === 'splitter') w.executeTimer = 3.5;
      if (monster.id === 'healer') w.executeTimer = 4.5;
      if (monster.id === 'blinker') next.blinkCd = 0.7;
    }
  }

  filterWorld(w);
  p.hp = p.maxHp;
}

// ---------------- 渲染 ----------------

function drawStage(ctx, t) {
  const bg = ctx.createLinearGradient(0, 0, 0, PREVIEW_H);
  bg.addColorStop(0, '#101a30');
  bg.addColorStop(1, '#080c17');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, PREVIEW_W, PREVIEW_H);

  ctx.strokeStyle = 'rgba(110, 150, 220, 0.1)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 24; x < PREVIEW_W; x += 48) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, PREVIEW_H);
  }
  for (let y = 24; y < PREVIEW_H; y += 48) {
    ctx.moveTo(0, y);
    ctx.lineTo(PREVIEW_W, y);
  }
  ctx.stroke();

  for (let i = 0; i < 14; i += 1) {
    const x = (i * 83 + t * 7) % PREVIEW_W;
    const y = (i * 53) % PREVIEW_H;
    ctx.globalAlpha = 0.1 + 0.08 * Math.sin(t * 1.6 + i);
    ctx.fillStyle = '#93c5fd';
    ctx.fillRect(x, y, 2, 2);
  }
  ctx.globalAlpha = 1;
}

function drawPlayer(ctx, p) {
  ctx.save();
  ctx.shadowColor = '#5eead4';
  ctx.shadowBlur = 18;
  ctx.fillStyle = '#5eead4';
  ctx.beginPath();
  ctx.arc(p.x, p.y, p.r, 0, TAU);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#0b1220';
  ctx.beginPath();
  ctx.arc(p.x, p.y, p.r * 0.55, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#5eead4';
  ctx.beginPath();
  ctx.arc(p.x + Math.cos(p.face) * p.r * 0.62, p.y + Math.sin(p.face) * p.r * 0.62, 3.4, 0, TAU);
  ctx.fill();
  ctx.restore();
}

function drawEnemy(ctx, w, e) {
  const t = w.time;
  ctx.save();
  ctx.fillStyle = e.flash > 0 ? '#ffffff' : e.color;
  if (e.boss) {
    ctx.shadowColor = e.color;
    ctx.shadowBlur = 24;
  }

  const frozen = e.freezeTimer > 0;
  const animTime = frozen ? 0 : t;
  const aim = frozen
    ? (e.freezeAngle || 0)
    : Math.atan2(w.player.y - e.y, w.player.x - e.x);

  if (e.shape === 'triangle') {
    ctx.translate(e.x, e.y);
    ctx.rotate(aim + Math.PI / 2);
    ctx.beginPath();
    ctx.moveTo(0, -e.r);
    ctx.lineTo(e.r * 0.85, e.r * 0.8);
    ctx.lineTo(-e.r * 0.85, e.r * 0.8);
    ctx.closePath();
    ctx.fill();
  } else if (e.shape === 'square') {
    ctx.translate(e.x, e.y);
    ctx.rotate(Math.PI / 4 + animTime * 1.2);
    ctx.fillRect(-e.r * 0.78, -e.r * 0.78, e.r * 1.56, e.r * 1.56);
  } else if (e.shape === 'charger') {
    ctx.translate(e.x, e.y);
    ctx.rotate(aim + Math.PI / 2);
    ctx.beginPath();
    ctx.moveTo(0, -e.r);
    ctx.lineTo(e.r, 0);
    ctx.lineTo(0, e.r);
    ctx.lineTo(-e.r, 0);
    ctx.closePath();
    ctx.fill();
    if (e.mode === 'windup' && !frozen) {
      ctx.shadowBlur = 0;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, e.r + 5 + Math.sin(t * 30) * 2, 0, TAU);
      ctx.stroke();
    }
  } else if (e.shape === 'shooter') {
    ctx.beginPath();
    ctx.arc(e.x, e.y, e.r, 0, TAU);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.75)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(e.x, e.y, e.r * 0.55, 0, TAU);
    ctx.stroke();
  } else if (e.shape === 'splitter') {
    ctx.translate(e.x, e.y);
    ctx.rotate(animTime * 0.9);
    ctx.fillRect(-e.r * 0.75, -e.r * 0.75, e.r * 1.5, e.r * 1.5);
  } else if (e.shape === 'bomber') {
    if (e.fuse > 0) ctx.fillStyle = '#f87171';
    ctx.beginPath();
    ctx.arc(e.x, e.y, e.r, 0, TAU);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = e.fuse > 0 ? 'rgba(255, 255, 255, 0.95)' : 'rgba(255, 237, 213, 0.7)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(e.x, e.y, e.r + 3 + Math.sin(animTime * (e.fuse > 0 ? 30 : 6)) * 2, 0, TAU);
    ctx.stroke();
  } else if (e.boss) {
    ctx.beginPath();
    ctx.arc(e.x, e.y, e.r, 0, TAU);
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.65)';
    ctx.beginPath();
    if (frozen) ctx.arc(e.x, e.y, e.r + 7, 0, TAU);
    else ctx.arc(e.x, e.y, e.r + 7 + Math.sin(t * 5) * 2, 0, TAU);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.arc(e.x, e.y, e.r, 0, TAU);
    ctx.fill();
  }
  ctx.restore();

  // 闪现者蓄力预警：沿突刺方向画虚线，提示玩家横向躲开
  if (e.mode === 'windup' && e.aimAngle != null && !frozen) {
    ctx.save();
    ctx.strokeStyle = 'rgba(232, 121, 249, 0.85)';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 6]);
    ctx.globalAlpha = 0.55 + Math.sin(t * 24) * 0.3;
    ctx.beginPath();
    ctx.moveTo(e.x, e.y);
    ctx.lineTo(e.x + Math.cos(e.aimAngle) * 120, e.y + Math.sin(e.aimAngle) * 120);
    ctx.stroke();
    ctx.restore();
  }

  if (e.element && ELEMENT_INFO[e.element]) {
    ctx.save();
    ctx.font = '13px "Segoe UI Emoji", "Apple Color Emoji", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(ELEMENT_INFO[e.element].icon, e.x, e.y - e.r - 10);
    ctx.restore();
  }

  if (frozen) {
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = '#7dd3fc';
    ctx.beginPath();
    ctx.arc(e.x, e.y, e.r + 2, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 0.95;
    ctx.strokeStyle = '#e0f2fe';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(e.x, e.y, e.r + 2, 0, TAU);
    ctx.stroke();
    ctx.restore();
  }
  if (e.vulnTimer > 0) {
    ctx.save();
    ctx.globalAlpha = 0.75;
    ctx.strokeStyle = '#c4b5fd';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.arc(e.x, e.y, e.r + 6, 0, TAU);
    ctx.stroke();
    ctx.restore();
  }

  if (e.boss || e.type === 'tank' || (e.showHp && e.ally)) {
    const bw = Math.max(24, e.r * 2);
    const ratio = Math.max(0, Math.min(1, e.hp / e.maxHp));
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.fillRect(e.x - bw / 2, e.y - e.r - 12, bw, 5);
    ctx.fillStyle = e.boss ? '#ff4d6d' : (e.ally ? '#4ade80' : '#a78bfa');
    ctx.fillRect(e.x - bw / 2, e.y - e.r - 12, bw * ratio, 5);
  }
}

function drawHealthPacks(ctx, w) {
  if (!w.healthPacks.length) return;
  const pulse = 1 + Math.sin(w.time * 5) * 0.08;
  for (const h of w.healthPacks) {
    if (h.dead) continue;
    ctx.save();
    ctx.translate(h.x, h.y + Math.sin(w.time * 3 + h.bob) * 2);
    ctx.shadowColor = '#4ade80';
    ctx.shadowBlur = 14;
    ctx.fillStyle = 'rgba(20, 83, 45, 0.85)';
    ctx.beginPath();
    ctx.arc(0, 0, h.r * pulse, 0, TAU);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = '#4ade80';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, h.r * pulse, 0, TAU);
    ctx.stroke();
    ctx.fillStyle = '#4ade80';
    const s = h.r * 0.55;
    ctx.fillRect(-s * 0.34, -s, s * 0.68, s * 2);
    ctx.fillRect(-s, -s * 0.34, s * 2, s * 0.68);
    ctx.restore();
  }
}

function drawFloaters(ctx, w) {
  if (!w.floaters.length) return;
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 13px "Segoe UI", system-ui, sans-serif';
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(8, 12, 23, 0.85)';
  for (const f of w.floaters) {
    ctx.globalAlpha = Math.max(0, Math.min(1, f.life / f.maxLife));
    ctx.strokeText(f.text, f.x, f.y);
    ctx.fillStyle = f.color;
    ctx.fillText(f.text, f.x, f.y);
  }
  ctx.restore();
}

function drawProjectiles(ctx, w) {
  for (const pr of w.projectiles) {
    const color = pr.color || '#5eead4';
    ctx.save();
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.arc(pr.x, pr.y, pr.r, 0, TAU);
    ctx.fill();
    ctx.restore();
  }
}

function drawEnemyShots(ctx, w) {
  for (const s of w.enemyShots) {
    ctx.save();
    ctx.fillStyle = s.color;
    ctx.shadowColor = s.color;
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r, 0, TAU);
    ctx.fill();
    ctx.restore();
  }
}

function drawParticles(ctx, w) {
  for (const pt of w.particles) {
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, pt.life / pt.maxLife));
    ctx.fillStyle = pt.color;
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, pt.r, 0, TAU);
    ctx.fill();
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}

function drawEffects(ctx, w) {
  if (w.novas.length) {
    ctx.save();
    for (const n of w.novas) {
      const alpha = n.life / n.maxLife;
      const p = 1 - alpha;
      const r = n.r + (n.maxR - n.r) * p;
      ctx.globalAlpha = alpha * 0.85;
      ctx.strokeStyle = n.color || '#67e8f9';
      ctx.lineWidth = 3;
      ctx.shadowColor = n.color || '#67e8f9';
      ctx.shadowBlur = w.novas.length <= 8 ? 16 : 0;
      ctx.beginPath();
      ctx.arc(n.x, n.y, r, 0, TAU);
      ctx.stroke();
    }
    ctx.restore();
  }
  if (w.explosions.length) {
    ctx.save();
    for (const ex of w.explosions) {
      const alpha = ex.life / ex.maxLife;
      const p = 1 - alpha;
      const r = ex.r + (ex.maxR - ex.r) * p;
      ctx.globalAlpha = alpha * 0.7;
      ctx.fillStyle = '#ffb703';
      ctx.beginPath();
      ctx.arc(ex.x, ex.y, r, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}

function drawArcs(ctx, w) {
  const arcs = w.lightningArcs;
  if (!arcs.length) return;
  let alpha = 0;
  for (const arc of arcs) alpha = Math.max(alpha, arc.life);
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.globalAlpha = clamp(alpha / 0.24, 0, 1);
  ctx.beginPath();
  for (const arc of arcs) {
    if (!arc.points || arc.points.length < 2) continue;
    ctx.moveTo(arc.points[0].x, arc.points[0].y);
    for (let i = 1; i < arc.points.length; i += 1) {
      ctx.lineTo(arc.points[i].x, arc.points[i].y);
    }
  }
  ctx.strokeStyle = 'rgba(250, 204, 21, 0.6)';
  ctx.lineWidth = 4.5;
  ctx.shadowColor = '#facc15';
  ctx.shadowBlur = arcs.length <= 8 ? 14 : 0;
  ctx.stroke();
  ctx.strokeStyle = '#fffbe6';
  ctx.lineWidth = 1.6;
  ctx.shadowBlur = 0;
  ctx.stroke();
  ctx.restore();
  ctx.globalAlpha = 1;
}

function drawBar(ctx, x, y, width, height, ratio, color, alpha = 1) {
  ctx.save();
  ctx.globalAlpha = 0.35 * alpha;
  ctx.fillStyle = '#0b1220';
  ctx.fillRect(x, y, width, height);
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.fillRect(x, y, width * clamp(ratio, 0, 1), height);
  ctx.globalAlpha = 0.5;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, width - 1, height - 1);
  ctx.restore();
}

function fmt(v) {
  const n = Number(v) || 0;
  if (Math.abs(n) >= 1000) return String(Math.round(n));
  if (Math.abs(n) >= 100) return n.toFixed(0);
  return String(Number(n.toFixed(1)));
}

function pct(v) {
  return `${(Number(v) * 100).toFixed(1)}%`;
}

function buildStatRows(buff, base, p) {
  const rows = [];
  const push = (label, b, c, formatter = fmt) => {
    rows.push({ label, base: formatter(b), cur: formatter(c) });
  };
  switch (buff.id) {
    case 'hp':
      push('生命上限', base.maxHp, p.maxHp);
      push('护盾上限', base.shieldMax, p.shieldMax);
      break;
    case 'armor':
      push('防御力', base.def, p.def);
      push('减伤比例', defenseMitigation(base.def), defenseMitigation(p.def), pct);
      push('承受伤害', damageTakenZone(base.def), damageTakenZone(p.def), pct);
      break;
    case 'shield':
      push('护盾上限', base.shieldMax, p.shieldMax);
      push('每秒回复', base.shieldRegen, p.shieldRegen);
      break;
    case 'regen':
      push('每秒回复', base.regen, p.regen);
      break;
    case 'lifesteal':
      push('击杀回复', base.lifesteal, p.lifesteal);
      break;
    case 'speed':
      push('移动速度', base.speed, p.speed);
      break;
    case 'pickup':
      push('拾取范围', base.pickup, p.pickup);
      break;
    default:
      break;
  }
  return rows;
}

function drawRows(ctx, rows) {
  if (!rows.length) return;
  ctx.save();
  ctx.font = '12px system-ui, "Microsoft YaHei", sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(148, 163, 184, 0.9)';
  ctx.textAlign = 'left';
  ctx.fillText('真实数值', 44, 104);
  ctx.textAlign = 'right';
  ctx.fillText('基础', 300, 104);
  ctx.fillText('当前', 436, 104);

  rows.forEach((row, i) => {
    const y = 130 + i * 26;
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(226, 232, 240, 0.92)';
    ctx.font = '13px system-ui, "Microsoft YaHei", sans-serif';
    ctx.fillText(row.label, 44, y);
    ctx.textAlign = 'right';
    ctx.font = '13px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.fillStyle = 'rgba(148, 163, 184, 0.85)';
    ctx.fillText(row.base, 300, y);
    ctx.fillStyle = '#5eead4';
    ctx.fillText(row.cur, 436, y);
    ctx.fillStyle = 'rgba(148, 163, 184, 0.5)';
    ctx.fillText('→', 336, y);
  });
  ctx.restore();
}

function drawSpeedScene(ctx, w) {
  const p = w.player;
  const base = w.statBase;
  const lanes = [
    { y: 196, speed: base.speed, color: 'rgba(148, 163, 184, 0.8)', label: '基础' },
    { y: 236, speed: p.speed, color: '#5eead4', label: '当前' },
  ];
  for (const lane of lanes) {
    ctx.save();
    ctx.strokeStyle = 'rgba(110, 150, 220, 0.25)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(44, lane.y);
    ctx.lineTo(436, lane.y);
    ctx.stroke();
    const span = 392;
    const x = 44 + ((w.time * lane.speed * 0.32) % span);
    ctx.fillStyle = lane.color;
    ctx.beginPath();
    ctx.arc(x, lane.y, 7, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 0.55;
    ctx.fillRect(x - 16, lane.y - 2, 16, 4);
    ctx.restore();
    ctx.save();
    ctx.fillStyle = lane.color;
    ctx.font = '12px system-ui, "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(`${lane.label} ${Math.round(lane.speed)}`, 432, lane.y - 14);
    ctx.restore();
  }
}

function drawPickupScene(ctx, w) {
  const p = w.player;
  const base = w.statBase;
  ctx.save();
  ctx.setLineDash([5, 5]);
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.5)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(p.x, p.y, base.pickup, 0, TAU);
  ctx.stroke();
  ctx.setLineDash([3, 6]);
  ctx.strokeStyle = '#a78bfa';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(p.x, p.y, p.pickup, 0, TAU);
  ctx.stroke();
  ctx.restore();

  for (const g of w.gems) {
    ctx.save();
    ctx.translate(g.x, g.y);
    ctx.rotate(w.time * 2);
    ctx.fillStyle = '#a78bfa';
    ctx.shadowColor = '#a78bfa';
    ctx.shadowBlur = 8;
    ctx.fillRect(-4, -4, 8, 8);
    ctx.restore();
  }
}

function drawStatScene(ctx, w, buff) {
  drawStage(ctx, w.time);
  drawPlayer(ctx, w.player);
  const p = w.player;
  const base = w.statBase;

  if (buff.id === 'hp' || buff.id === 'regen' || buff.id === 'shield' || buff.id === 'lifesteal') {
    drawBar(ctx, 44, 30, 392, 16, p.hp / p.maxHp, '#4ade80');
    ctx.save();
    ctx.fillStyle = 'rgba(226, 232, 240, 0.92)';
    ctx.font = '12px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`HP ${Math.ceil(p.hp)} / ${Math.round(p.maxHp)}`, 48, 38);
    ctx.restore();
    if (p.shieldMax > 0) {
      drawBar(ctx, 44, 52, 392, 10, p.shield / p.shieldMax, '#7dd3fc');
      ctx.save();
      ctx.fillStyle = 'rgba(226, 232, 240, 0.9)';
      ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace';
      ctx.textAlign = 'left';
      ctx.fillText(`护盾 ${Math.ceil(p.shield)} / ${Math.round(p.shieldMax)}`, 48, 57);
      ctx.restore();
    }
  }

  if (buff.id === 'speed') drawSpeedScene(ctx, w);
  if (buff.id === 'pickup') drawPickupScene(ctx, w);

  drawRows(ctx, buildStatRows(buff, base, p));
}

function drawBuffWorld(ctx, w, buff) {
  drawStage(ctx, w.time);
  if (STAT_BUFFS.has(buff.id)) {
    drawStatScene(ctx, w, buff);
    return;
  }
  drawPlayer(ctx, w.player);
  for (const e of w.enemies) {
    if (!e.dead) drawEnemy(ctx, w, e);
  }
  drawProjectiles(ctx, w);
  drawEnemyShots(ctx, w);
  drawParticles(ctx, w);
  drawEffects(ctx, w);
  drawArcs(ctx, w);
  drawFloaters(ctx, w);
}

function drawMonsterWorld(ctx, w) {
  drawStage(ctx, w.time);
  drawHealthPacks(ctx, w);
  drawPlayer(ctx, w.player);
  for (const e of w.enemies) {
    if (!e.dead) drawEnemy(ctx, w, e);
  }
  drawEnemyShots(ctx, w);
  drawParticles(ctx, w);
  drawEffects(ctx, w);
  drawArcs(ctx, w);
  drawFloaters(ctx, w);
}

// ---------------- 对外入口 ----------------

export function createPreview({ kind, item }) {
  let world;
  let level = 1;

  const rebuild = (lv) => {
    level = clamp(lv, 1, Math.max(1, item.max || 1));
    world = buildBuffScenario(item, level);
  };

  if (kind === 'monster') {
    world = buildMonsterScenario(item);
  } else {
    rebuild(1);
  }

  return {
    note: kind === 'monster' ? '' : buffNote(item),
    setLevel(lv) {
      if (kind !== 'buff') return;
      rebuild(lv);
    },
    update(dt) {
      const step = clamp(Number(dt) || 0, 0, 0.05);
      if (step <= 0) return;
      if (kind === 'monster') updateMonsterWorld(world, item, step);
      else updateBuffWorld(world, item, step);
    },
    draw(ctx) {
      if (kind === 'monster') drawMonsterWorld(ctx, world);
      else drawBuffWorld(ctx, world, item);
    },
    get level() {
      return level;
    },
  };
}
