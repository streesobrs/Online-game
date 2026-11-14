/**
 * 刷怪肉鸽（幸存者 like）· 测试版 Demo
 *
 * 定位：游戏大厅「单机试玩」入口，先验证「自动攻击 + 怪潮 + 升级三选一」的手感。
 * 技术：Canvas 2D + requestAnimationFrame，不依赖服务端、不依赖外部素材。
 *
 * 玩法：
 * - WASD / 方向键移动，鼠标或手指在画面上拖拽也可以移动
 * - 武器自动索敌射击；击杀怪物掉落经验，靠近自动拾取
 * - 经验攒满升级，暂停并三选一强化（伤害/攻速/多重射击/移速…）
 * - 每 90 秒出现一个 Boss；生命归零结算，最佳成绩保存在 localStorage
 */
import { viewRoot, el } from '../../utils/dom.js';
import { go } from '../../core/router.js';
import { eventBus } from '../../core/eventBus.js';
import { startGameActivity, stopGameActivity } from '../../core/activity.js';

let activeCleanup = null;

const W = 960;
const H = 600;
const BOSS_INTERVAL = 90; // 秒

const PLAYER_BASE = {
  x: W / 2,
  y: H / 2,
  r: 15,
  hp: 100,
  maxHp: 100,
  speed: 235,
  damage: 14,
  attackInterval: 0.55,
  projectiles: 1,
  projectileSpeed: 560,
  pierce: 0,
  pickup: 80,
  regen: 0,
  lifesteal: 0,
  face: -Math.PI / 2,
};

/** 升级池：每次升级随机抽 3 个不重复的强化 */
const UPGRADES = [
  { id: 'damage', icon: '🗡', name: '锋利', desc: '伤害 +30%', apply: (p) => { p.damage *= 1.3; } },
  { id: 'rate', icon: '⚡', name: '连射', desc: '攻速 +20%', apply: (p) => { p.attackInterval *= 0.8; } },
  { id: 'multi', icon: '🎯', name: '多重射击', desc: '弹丸 +1', apply: (p) => { p.projectiles += 1; } },
  { id: 'speed', icon: '👟', name: '疾行', desc: '移速 +12%', apply: (p) => { p.speed *= 1.12; } },
  { id: 'hp', icon: '❤️', name: '强健', desc: '生命上限 +25 并回满', apply: (p) => { p.maxHp += 25; p.hp = p.maxHp; } },
  { id: 'pickup', icon: '🧲', name: '磁力', desc: '拾取范围 +45%', apply: (p) => { p.pickup *= 1.45; } },
  { id: 'pierce', icon: '🏹', name: '穿透', desc: '弹丸穿透 +1', apply: (p) => { p.pierce += 1; } },
  { id: 'regen', icon: '🌿', name: '回复', desc: '每秒回血 +1', apply: (p) => { p.regen += 1; } },
  { id: 'lifesteal', icon: '🩸', name: '吸血', desc: '击杀回血 +1', apply: (p) => { p.lifesteal += 1; } },
  { id: 'projspeed', icon: '💨', name: '弹速', desc: '弹丸速度 +25%', apply: (p) => { p.projectileSpeed *= 1.25; } },
];

/** 怪物模板（血量/速度随对局时间成长） */
const ENEMY_TEMPLATES = {
  basic: { shape: 'circle', color: '#ff7b7b', r: 11, hp: 20, speed: 78, dmg: 8, xp: 1 },
  fast: { shape: 'triangle', color: '#ffd93d', r: 9, hp: 12, speed: 150, dmg: 6, xp: 1 },
  tank: { shape: 'square', color: '#a78bfa', r: 19, hp: 95, speed: 52, dmg: 14, xp: 3 },
};

const BEST_KEY = 'survivorsBest';

function loadBest() {
  try {
    const raw = JSON.parse(localStorage.getItem(BEST_KEY) || '{}');
    return {
      time: Number(raw.time) || 0,
      kills: Number(raw.kills) || 0,
    };
  } catch (e) {
    return { time: 0, kills: 0 };
  }
}

function saveBest(best) {
  try {
    localStorage.setItem(BEST_KEY, JSON.stringify(best));
  } catch (e) {
    // 隐私模式下 localStorage 不可写，忽略即可
  }
}

function formatTime(sec) {
  const total = Math.max(0, Math.floor(sec));
  const m = String(Math.floor(total / 60)).padStart(2, '0');
  const s = String(total % 60).padStart(2, '0');
  return `${m}:${s}`;
}

function rand(min, max) {
  return min + Math.random() * (max - min);
}

/**
 * 渲染刷怪肉鸽视图
 * @param {HTMLElement} [container] - 内容容器（默认 #view-root）
 * @returns {Function} cleanup 函数
 */
export function renderSurvivors(container = viewRoot()) {
  // 路由不会调用视图返回的 cleanup，重复进入时先销毁上一实例
  if (typeof activeCleanup === 'function') activeCleanup();
  startGameActivity();

  const state = {
    mode: 'idle', // idle | playing | dead
    paused: false,
    pausedByLevelUp: false,
    time: 0,
    kills: 0,
    level: 1,
    xp: 0,
    xpNeeded: 9,
    pendingLevels: 0,
    player: { ...PLAYER_BASE },
    enemies: [],
    projectiles: [],
    gems: [],
    particles: [],
    attackTimer: 0.35,
    spawnTimer: 0.6,
    bossTimer: BOSS_INTERVAL,
    bossCount: 0,
    nextEnemyId: 1,
    flash: 0,
    shake: 0,
    last: performance.now(),
    raf: 0,
    best: loadBest(),
    drag: { x: 0, y: 0 },
  };

  // ---- DOM ----
  const canvas = el('canvas', { class: 'sv-canvas', width: W, height: H });
  const ctx = canvas.getContext('2d');

  const hpFill = el('div', { class: 'sv-bar-fill sv-hp-fill' });
  const hpText = el('span', { class: 'sv-bar-text' }, '100 / 100');
  const xpFill = el('div', { class: 'sv-bar-fill sv-xp-fill' });
  const timeEl = el('span', { class: 'sv-hud-time' }, '00:00');
  const lvEl = el('span', { class: 'sv-hud-chip' }, 'Lv.1');
  const killEl = el('span', { class: 'sv-hud-chip' }, '💀 0');

  const hud = el('div', { class: 'sv-hud' }, [
    el('div', { class: 'sv-hud-bars' }, [
      el('div', { class: 'sv-bar sv-bar-hp' }, [hpFill, hpText]),
      el('div', { class: 'sv-bar sv-bar-xp' }, [xpFill]),
    ]),
    el('div', { class: 'sv-hud-mid' }, [timeEl]),
    el('div', { class: 'sv-hud-right' }, [lvEl, killEl]),
  ]);

  const overlay = el('div', { class: 'sv-overlay' });
  const stage = el('div', { class: 'sv-stage' }, [canvas, hud, overlay]);

  const backBtn = el('button', { class: 'sv-back-btn', type: 'button' }, '← 返回大厅');
  backBtn.addEventListener('click', () => go('games'));

  const wrap = el('section', { class: 'sv-view' }, [
    el('div', { class: 'sv-head' }, [
      backBtn,
      el('span', { class: 'sv-title' }, '⚔️ 刷怪肉鸽'),
      el('span', { class: 'sv-beta' }, '测试版 DEMO'),
    ]),
    stage,
    el('p', { class: 'sv-foot' }, 'WASD / 方向键移动，或按住画面拖拽移动 · 武器自动攻击 · Esc 暂停'),
  ]);

  container.replaceChildren(wrap);

  // ---- HUD ----
  function updateHud() {
    const p = state.player;
    const hpPct = Math.max(0, Math.min(1, p.hp / p.maxHp));
    hpFill.style.width = `${(hpPct * 100).toFixed(1)}%`;
    hpText.textContent = `${Math.max(0, Math.ceil(p.hp))} / ${Math.round(p.maxHp)}`;
    const xpPct = Math.max(0, Math.min(1, state.xp / state.xpNeeded));
    xpFill.style.width = `${(xpPct * 100).toFixed(1)}%`;
    timeEl.textContent = formatTime(state.time);
    lvEl.textContent = `Lv.${state.level}`;
    killEl.textContent = `💀 ${state.kills}`;
  }

  // ---- 覆盖层：开始 / 升级 / 结算 ----
  function showOverlay(node) {
    overlay.replaceChildren(node);
    overlay.classList.add('show');
  }

  function hideOverlay() {
    overlay.classList.remove('show');
    overlay.replaceChildren();
  }

  function showStart() {
    state.paused = true;
    showOverlay(el('div', { class: 'sv-panel sv-panel-start' }, [
      el('div', { class: 'sv-panel-icon' }, '⚔️'),
      el('h2', { class: 'sv-panel-title' }, '刷怪肉鸽'),
      el('p', { class: 'sv-panel-sub' }, '幸存者 like · 测试版 Demo'),
      el('p', { class: 'sv-panel-desc' }, '武器自动索敌攻击。WASD / 方向键移动，手机或鼠标按住画面拖拽也能移动。'),
      el('p', { class: 'sv-panel-desc' }, '击杀怪物拾取经验，升级时三选一强化；每 90 秒出现一个 Boss。'),
      el('div', { class: 'sv-best' }, [
        el('span', {}, `🏆 最佳存活 ${formatTime(state.best.time)}`),
        el('span', {}, `💀 最高击杀 ${state.best.kills}`),
      ]),
      el('button', { class: 'btn btn-primary sv-big-btn', type: 'button', onClick: startGame }, '开始试玩'),
    ]));
  }

  function showGameOver() {
    const bestTime = Math.max(state.best.time, state.time);
    const bestKills = Math.max(state.best.kills, state.kills);
    const newRecord = state.time > state.best.time || state.kills > state.best.kills;
    state.best = { time: bestTime, kills: bestKills };
    saveBest(state.best);

    showOverlay(el('div', { class: 'sv-panel' }, [
      el('div', { class: 'sv-panel-icon' }, '💀'),
      el('h2', { class: 'sv-panel-title' }, `你撑了 ${formatTime(state.time)}`),
      el('p', { class: 'sv-panel-sub' }, newRecord ? '🎉 新纪录！' : '再接再厉'),
      el('div', { class: 'sv-result' }, [
        el('div', {}, [el('strong', {}, String(state.kills)), el('span', {}, '击杀')]),
        el('div', {}, [el('strong', {}, `Lv.${state.level}`), el('span', {}, '等级')]),
        el('div', {}, [el('strong', {}, formatTime(state.best.time)), el('span', {}, '最佳存活')]),
      ]),
      el('div', { class: 'sv-panel-actions' }, [
        el('button', { class: 'btn btn-primary', type: 'button', onClick: startGame }, '再来一局'),
        el('button', { class: 'btn btn-secondary', type: 'button', onClick: () => go('games') }, '返回大厅'),
      ]),
    ]));
  }

  function pickUpgrades(count) {
    const pool = UPGRADES.slice();
    const picks = [];
    while (picks.length < count && pool.length) {
      picks.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
    }
    return picks;
  }

  function openLevelUp() {
    state.paused = true;
    state.pausedByLevelUp = true;
    const picks = pickUpgrades(3);
    const cards = picks.map((u, i) => el('button', {
      class: 'sv-upgrade',
      type: 'button',
      onClick: () => chooseUpgrade(u),
    }, [
      el('span', { class: 'sv-upgrade-key' }, String(i + 1)),
      el('span', { class: 'sv-upgrade-icon' }, u.icon),
      el('span', { class: 'sv-upgrade-name' }, u.name),
      el('span', { class: 'sv-upgrade-desc' }, u.desc),
    ]));

    showOverlay(el('div', { class: 'sv-panel' }, [
      el('div', { class: 'sv-panel-icon' }, '⬆️'),
      el('h2', { class: 'sv-panel-title' }, `升级！Lv.${state.level}`),
      el('p', { class: 'sv-panel-sub' }, state.pendingLevels > 1
        ? `还有 ${state.pendingLevels - 1} 次升级`
        : '选择一项强化（按 1 / 2 / 3 也可选择）'),
      el('div', { class: 'sv-upgrades' }, cards),
    ]));
  }

  function chooseUpgrade(upgrade) {
    upgrade.apply(state.player);
    state.pendingLevels -= 1;
    updateHud();
    if (state.pendingLevels > 0) {
      openLevelUp();
      return;
    }
    hideOverlay();
    state.paused = false;
    state.pausedByLevelUp = false;
    state.last = performance.now();
  }

  // ---- 经验 / 升级 ----
  function gainXp(value) {
    state.xp += value;
    while (state.xp >= state.xpNeeded) {
      state.xp -= state.xpNeeded;
      state.level += 1;
      state.pendingLevels += 1;
      state.xpNeeded = 6 + state.level * 3;
    }
    if (state.pendingLevels > 0 && !state.paused) openLevelUp();
  }

  // ---- 局内生成 ----
  function spawnPos() {
    const edge = Math.floor(Math.random() * 4);
    if (edge === 0) return { x: rand(-40, -12), y: rand(0, H) };
    if (edge === 1) return { x: rand(W + 12, W + 40), y: rand(0, H) };
    if (edge === 2) return { x: rand(0, W), y: rand(-40, -12) };
    return { x: rand(0, W), y: rand(H + 12, H + 40) };
  }

  function spawnEnemy(typeId) {
    const tpl = ENEMY_TEMPLATES[typeId] || ENEMY_TEMPLATES.basic;
    const pos = spawnPos();
    const hpScale = 1 + state.time / 75;
    const speedScale = 1 + Math.min(0.6, state.time / 300);
    const hp = Math.round(tpl.hp * hpScale);
    state.enemies.push({
      id: state.nextEnemyId++,
      type: typeId,
      shape: tpl.shape,
      color: tpl.color,
      x: pos.x,
      y: pos.y,
      r: tpl.r,
      hp,
      maxHp: hp,
      speed: tpl.speed * speedScale,
      dmg: tpl.dmg,
      xp: tpl.xp,
      boss: false,
      hitCd: 0,
      flash: 0,
      dead: false,
    });
  }

  function spawnBoss() {
    const pos = spawnPos();
    const hp = Math.round(650 * (1 + state.bossCount * 0.9));
    state.bossCount += 1;
    state.enemies.push({
      id: state.nextEnemyId++,
      type: 'boss',
      shape: 'boss',
      color: '#ff4d6d',
      x: pos.x,
      y: pos.y,
      r: 34,
      hp,
      maxHp: hp,
      speed: 55,
      dmg: 24,
      xp: 0,
      boss: true,
      hitCd: 0,
      flash: 0,
      dead: false,
    });
    state.shake = 0.3;
  }

  function randomEnemyType() {
    const t = state.time;
    const r = Math.random();
    if (t > 55 && r < 0.16) return 'tank';
    if (t > 25 && r < 0.45) return 'fast';
    return 'basic';
  }

  function updateSpawn(dt) {
    if (state.time >= state.bossTimer) {
      state.bossTimer += BOSS_INTERVAL;
      spawnBoss();
    }
    if (state.enemies.length >= 220) return;
    state.spawnTimer -= dt;
    if (state.spawnTimer > 0) return;
    state.spawnTimer = Math.max(0.35, 0.95 - state.time * 0.004);
    const count = Math.min(3, 1 + Math.floor(state.time / 70));
    for (let i = 0; i < count; i += 1) spawnEnemy(randomEnemyType());
  }

  // ---- 特效 ----
  function spawnParticles(x, y, color, count, speed) {
    if (state.particles.length > 260) return;
    for (let i = 0; i < count; i += 1) {
      const a = Math.random() * Math.PI * 2;
      const v = rand(speed * 0.35, speed);
      state.particles.push({
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

  // ---- 战斗 ----
  function nearestEnemy() {
    const p = state.player;
    let best = null;
    let bestD2 = 800 * 800;
    for (const e of state.enemies) {
      if (e.dead) continue;
      const d2 = (e.x - p.x) ** 2 + (e.y - p.y) ** 2;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = e;
      }
    }
    return best;
  }

  function autoAttack(dt) {
    state.attackTimer -= dt;
    if (state.attackTimer > 0) return;
    const target = nearestEnemy();
    if (!target) {
      state.attackTimer = 0;
      return;
    }
    const p = state.player;
    state.attackTimer = p.attackInterval;
    const base = Math.atan2(target.y - p.y, target.x - p.x);
    const n = p.projectiles;
    const spread = n > 1 ? Math.min(0.5, 0.2 * (n - 1)) : 0;
    for (let i = 0; i < n; i += 1) {
      const angle = n === 1 ? base : base - spread + (spread * 2 * i) / (n - 1);
      state.projectiles.push({
        x: p.x + Math.cos(angle) * (p.r + 6),
        y: p.y + Math.sin(angle) * (p.r + 6),
        vx: Math.cos(angle) * p.projectileSpeed,
        vy: Math.sin(angle) * p.projectileSpeed,
        r: 4.5,
        damage: p.damage,
        pierceLeft: p.pierce,
        hit: new Set(),
        life: 1.5,
        dead: false,
      });
    }
  }

  function damageEnemy(enemy, damage) {
    enemy.hp -= damage;
    enemy.flash = 0.12;
    spawnParticles(enemy.x, enemy.y, '#ffd93d', 3, 130);
    if (enemy.hp > 0 || enemy.dead) return;

    enemy.dead = true;
    state.kills += 1;
    if (state.player.lifesteal > 0) {
      state.player.hp = Math.min(state.player.maxHp, state.player.hp + state.player.lifesteal);
    }
    spawnParticles(enemy.x, enemy.y, enemy.color, enemy.boss ? 26 : 10, enemy.boss ? 280 : 170);

    if (enemy.boss) {
      for (let i = 0; i < 10; i += 1) {
        const a = (i / 10) * Math.PI * 2;
        state.gems.push({
          x: enemy.x + Math.cos(a) * 26,
          y: enemy.y + Math.sin(a) * 26,
          value: 4,
          r: 5,
          bob: Math.random() * 6,
        });
      }
      state.shake = 0.45;
    } else {
      state.gems.push({
        x: enemy.x,
        y: enemy.y,
        value: enemy.xp,
        r: 5,
        bob: Math.random() * 6,
      });
    }
  }

  // ---- 主更新 ----
  function update(dt) {
    state.time += dt;
    state.flash = Math.max(0, state.flash - dt * 2.2);
    state.shake = Math.max(0, state.shake - dt * 2.5);

    const p = state.player;

    // 移动（键盘 + 拖拽，任一方向输入合并后归一化）
    let mx = state.drag.x;
    let my = state.drag.y;
    if (keys.has('up')) my -= 1;
    if (keys.has('down')) my += 1;
    if (keys.has('left')) mx -= 1;
    if (keys.has('right')) mx += 1;
    const len = Math.hypot(mx, my);
    if (len > 0.01) {
      const nx = mx / Math.max(1, len);
      const ny = my / Math.max(1, len);
      p.x += nx * p.speed * dt;
      p.y += ny * p.speed * dt;
      p.face = Math.atan2(ny, nx);
      p.x = Math.max(p.r, Math.min(W - p.r, p.x));
      p.y = Math.max(p.r, Math.min(H - p.r, p.y));
    }

    if (p.regen > 0) p.hp = Math.min(p.maxHp, p.hp + p.regen * dt);

    autoAttack(dt);
    updateSpawn(dt);

    // 怪物追踪 + 接触伤害
    for (const e of state.enemies) {
      if (e.dead) continue;
      e.hitCd = Math.max(0, e.hitCd - dt);
      e.flash = Math.max(0, e.flash - dt);
      const dx = p.x - e.x;
      const dy = p.y - e.y;
      const dist = Math.hypot(dx, dy) || 1;
      e.x += (dx / dist) * e.speed * dt;
      e.y += (dy / dist) * e.speed * dt;
      if (dist < e.r + p.r && e.hitCd <= 0) {
        e.hitCd = e.boss ? 0.55 : 0.8;
        p.hp -= e.dmg;
        state.flash = 1;
        state.shake = 0.3;
        spawnParticles(p.x, p.y, '#ff6b6b', 6, 190);
        if (p.hp <= 0) {
          p.hp = 0;
          updateHud();
          gameOver();
          return;
        }
      }
    }

    // 弹丸
    for (const pr of state.projectiles) {
      if (pr.dead) continue;
      pr.x += pr.vx * dt;
      pr.y += pr.vy * dt;
      pr.life -= dt;
      if (pr.life <= 0 || pr.x < -20 || pr.x > W + 20 || pr.y < -20 || pr.y > H + 20) {
        pr.dead = true;
        continue;
      }
      for (const e of state.enemies) {
        if (e.dead || pr.hit.has(e.id)) continue;
        const rr = pr.r + e.r;
        if ((pr.x - e.x) ** 2 + (pr.y - e.y) ** 2 <= rr * rr) {
          pr.hit.add(e.id);
          damageEnemy(e, pr.damage);
          if (pr.pierceLeft <= 0) {
            pr.dead = true;
            break;
          }
          pr.pierceLeft -= 1;
        }
      }
    }

    // 经验宝石：进入拾取范围后飞向玩家
    for (const g of state.gems) {
      const dx = p.x - g.x;
      const dy = p.y - g.y;
      const dist = Math.hypot(dx, dy) || 1;
      if (dist < p.pickup) {
        const step = 420 * dt;
        if (dist <= step) {
          g.dead = true;
          gainXp(g.value);
        } else {
          g.x += (dx / dist) * step;
          g.y += (dy / dist) * step;
        }
      }
    }

    // 粒子
    for (const pt of state.particles) {
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
      pt.vx *= 0.94;
      pt.vy *= 0.94;
      pt.life -= dt;
    }

    state.enemies = state.enemies.filter((e) => !e.dead);
    state.projectiles = state.projectiles.filter((pr) => !pr.dead);
    state.gems = state.gems.filter((g) => !g.dead);
    state.particles = state.particles.filter((pt) => pt.life > 0);
  }

  // ---- 绘制 ----
  let bgGradient = null;

  function drawGrid() {
    ctx.strokeStyle = 'rgba(120, 150, 220, 0.08)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= W; x += 48) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
      ctx.stroke();
    }
    for (let y = 0; y <= H; y += 48) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }
  }

  function drawGems() {
    for (const g of state.gems) {
      const pulse = 1 + Math.sin(state.time * 4 + g.bob) * 0.12;
      ctx.save();
      ctx.translate(g.x, g.y);
      ctx.rotate(state.time * 2 + g.bob);
      ctx.shadowColor = '#7cf5c4';
      ctx.shadowBlur = 10;
      ctx.fillStyle = '#7cf5c4';
      const s = g.r * pulse;
      ctx.fillRect(-s, -s, s * 2, s * 2);
      ctx.restore();
    }
  }

  function drawProjectiles() {
    ctx.save();
    ctx.shadowColor = '#ffe066';
    ctx.shadowBlur = 12;
    ctx.fillStyle = '#ffe066';
    for (const pr of state.projectiles) {
      ctx.beginPath();
      ctx.arc(pr.x, pr.y, pr.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawEnemies() {
    for (const e of state.enemies) {
      ctx.save();
      ctx.fillStyle = e.flash > 0 ? '#ffffff' : e.color;
      ctx.shadowColor = e.color;
      ctx.shadowBlur = e.boss ? 24 : 8;

      if (e.shape === 'triangle') {
        ctx.translate(e.x, e.y);
        ctx.rotate(Math.atan2(state.player.y - e.y, state.player.x - e.x) + Math.PI / 2);
        ctx.beginPath();
        ctx.moveTo(0, -e.r);
        ctx.lineTo(e.r * 0.85, e.r * 0.8);
        ctx.lineTo(-e.r * 0.85, e.r * 0.8);
        ctx.closePath();
        ctx.fill();
      } else if (e.shape === 'square') {
        ctx.translate(e.x, e.y);
        ctx.rotate(Math.PI / 4 + state.time * 1.2);
        ctx.fillRect(-e.r * 0.78, -e.r * 0.78, e.r * 1.56, e.r * 1.56);
      } else if (e.boss) {
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.65)';
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.r + 7 + Math.sin(state.time * 5) * 2, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      if (e.boss || e.type === 'tank') {
        const bw = e.r * 2;
        const pct = Math.max(0, e.hp / e.maxHp);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
        ctx.fillRect(e.x - bw / 2, e.y - e.r - 12, bw, 5);
        ctx.fillStyle = e.boss ? '#ff4d6d' : '#a78bfa';
        ctx.fillRect(e.x - bw / 2, e.y - e.r - 12, bw * pct, 5);
      }
    }
  }

  function drawPlayer() {
    const p = state.player;
    ctx.save();
    ctx.shadowColor = '#5eead4';
    ctx.shadowBlur = 18;
    ctx.fillStyle = '#5eead4';
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#0b1220';
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r * 0.55, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#5eead4';
    ctx.beginPath();
    ctx.arc(p.x + Math.cos(p.face) * p.r * 0.62, p.y + Math.sin(p.face) * p.r * 0.62, 3.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawParticles() {
    for (const pt of state.particles) {
      ctx.globalAlpha = Math.max(0, pt.life / pt.maxLife);
      ctx.fillStyle = pt.color;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, pt.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function render() {
    const shake = state.shake > 0 ? state.shake * 16 : 0;
    ctx.save();
    if (shake > 0) {
      ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    }

    if (!bgGradient) {
      bgGradient = ctx.createRadialGradient(W / 2, H / 2, 60, W / 2, H / 2, W * 0.68);
      bgGradient.addColorStop(0, '#1b2038');
      bgGradient.addColorStop(1, '#0d101d');
    }
    ctx.fillStyle = bgGradient;
    ctx.fillRect(-24, -24, W + 48, H + 48);

    drawGrid();
    drawGems();
    drawProjectiles();
    drawEnemies();
    drawPlayer();
    drawParticles();
    ctx.restore();

    if (state.flash > 0) {
      ctx.fillStyle = `rgba(255, 70, 70, ${state.flash * 0.28})`;
      ctx.fillRect(0, 0, W, H);
    }
  }

  // ---- 开局 / 结算 ----
  function startGame() {
    hideOverlay();
    state.mode = 'playing';
    state.paused = false;
    state.pausedByLevelUp = false;
    state.time = 0;
    state.kills = 0;
    state.level = 1;
    state.xp = 0;
    state.xpNeeded = 9;
    state.pendingLevels = 0;
    state.player = { ...PLAYER_BASE };
    state.enemies = [];
    state.projectiles = [];
    state.gems = [];
    state.particles = [];
    state.attackTimer = 0.35;
    state.spawnTimer = 0.6;
    state.bossTimer = BOSS_INTERVAL;
    state.bossCount = 0;
    state.flash = 0;
    state.shake = 0;
    state.drag = { x: 0, y: 0 };
    keys.clear();
    state.last = performance.now();
    updateHud();
  }

  function gameOver() {
    state.mode = 'dead';
    state.paused = true;
    showGameOver();
  }

  // ---- 输入 ----
  const keys = new Set();
  const KEY_MAP = {
    arrowup: 'up', w: 'up',
    arrowdown: 'down', s: 'down',
    arrowleft: 'left', a: 'left',
    arrowright: 'right', d: 'right',
  };

  function onKeydown(e) {
    const key = e.key.toLowerCase();
    if (state.mode === 'playing' && !state.paused && KEY_MAP[key]) {
      e.preventDefault();
      e.stopPropagation();
      keys.add(KEY_MAP[key]);
      return;
    }
    if (state.mode === 'playing' && state.paused && /^[1-3]$/.test(key)) {
      const btn = overlay.querySelectorAll('.sv-upgrade')[Number(key) - 1];
      if (btn) {
        e.preventDefault();
        btn.click();
      }
      return;
    }
    if (key === 'escape' && state.mode === 'playing') {
      e.preventDefault();
      if (state.pausedByLevelUp) return; // 升级选择必须选一项
      if (state.paused) choosePauseResume();
      else pauseGame();
      return;
    }
    if (key === 'enter' && state.mode !== 'playing') {
      e.preventDefault();
      startGame();
    }
  }

  function onKeyup(e) {
    const dir = KEY_MAP[e.key.toLowerCase()];
    if (dir) {
      keys.delete(dir);
      e.stopPropagation();
    }
  }

  // Esc 暂停：复用升级层外壳，但不发强化，只提供继续/重开
  function pauseGame() {
    if (state.pausedByLevelUp) return; // 升级选择中不允许用暂停跳过
    state.paused = true;
    showOverlay(el('div', { class: 'sv-panel' }, [
      el('div', { class: 'sv-panel-icon' }, '⏸'),
      el('h2', { class: 'sv-panel-title' }, '已暂停'),
      el('p', { class: 'sv-panel-sub' }, `存活 ${formatTime(state.time)} · 击杀 ${state.kills}`),
      el('div', { class: 'sv-panel-actions' }, [
        el('button', { class: 'btn btn-primary', type: 'button', onClick: choosePauseResume }, '继续游戏'),
        el('button', { class: 'btn btn-secondary', type: 'button', onClick: () => go('games') }, '返回大厅'),
      ]),
    ]));
  }

  function choosePauseResume() {
    hideOverlay();
    state.paused = false;
    state.last = performance.now();
  }

  // 拖拽移动（鼠标 / 触摸通用）
  let dragStart = null;
  function onPointerDown(e) {
    if (state.mode !== 'playing' || state.paused) return;
    dragStart = { x: e.clientX, y: e.clientY };
    canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId);
  }
  function onPointerMove(e) {
    if (!dragStart) return;
    const dx = e.clientX - dragStart.x;
    const dy = e.clientY - dragStart.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 10) {
      state.drag = { x: 0, y: 0 };
      return;
    }
    state.drag = { x: dx / dist, y: dy / dist };
  }
  function onPointerUp() {
    dragStart = null;
    state.drag = { x: 0, y: 0 };
  }

  // ---- 主循环 ----
  function loop(now) {
    state.raf = requestAnimationFrame(loop);
    if (document.hidden) {
      state.last = now;
      return;
    }
    const dt = Math.min(0.04, Math.max(0, (now - state.last) / 1000));
    state.last = now;
    if (state.mode === 'playing' && !state.paused) {
      update(dt);
      updateHud();
    }
    render();
  }

  // ---- 事件绑定 ----
  document.addEventListener('keydown', onKeydown);
  document.addEventListener('keyup', onKeyup);
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);

  updateHud();
  showStart();
  state.raf = requestAnimationFrame(loop);

  let disposed = false;
  function cleanupSurvivors() {
    if (disposed) return;
    disposed = true;
    offRoute();
    cancelAnimationFrame(state.raf);
    document.removeEventListener('keydown', onKeydown);
    document.removeEventListener('keyup', onKeyup);
    canvas.removeEventListener('pointerdown', onPointerDown);
    canvas.removeEventListener('pointermove', onPointerMove);
    canvas.removeEventListener('pointerup', onPointerUp);
    canvas.removeEventListener('pointercancel', onPointerUp);
    stopGameActivity();
    // 仅当容器仍由本视图占用时清空，避免抹掉路由刚渲染的新页面
    if (wrap.isConnected && container.contains(wrap)) container.replaceChildren();
    if (activeCleanup === cleanupSurvivors) activeCleanup = null;
  }

  // 路由离开时兜底销毁（router 不会调用视图返回的 cleanup）
  const offRoute = eventBus.on('route:change', (id) => {
    if (id !== 'survivors') cleanupSurvivors();
  });
  activeCleanup = cleanupSurvivors;
  return cleanupSurvivors;
}
