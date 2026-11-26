/**
 * 刷怪肉鸽渲染层：画布自适应与全部 Canvas 绘制（只读 state，不改游戏状态）。
 */

const ELEMENT_ICONS = { fire: '🔥', thunder: '⚡', ice: '❄️', water: '💧' };

// 元素图标预渲染成小贴图：emoji 每帧 fillText 的栅格化开销很高，
// 元素版本下几乎每只怪都带元素，逐个绘制会直接拖垮帧率，这里只栅格化一次。
const ICON_SPRITE_SIZE = 32;
const ICON_DRAW_SIZE = 14;
const iconSprites = new Map();

function getElementSprite(element) {
  let sprite = iconSprites.get(element);
  if (sprite) return sprite;
  const icon = ELEMENT_ICONS[element];
  if (!icon) return null;
  sprite = document.createElement('canvas');
  sprite.width = ICON_SPRITE_SIZE;
  sprite.height = ICON_SPRITE_SIZE;
  const g = sprite.getContext('2d');
  g.font = `${Math.round(ICON_SPRITE_SIZE * 0.72)}px system-ui, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(icon, ICON_SPRITE_SIZE / 2, ICON_SPRITE_SIZE / 2 + 1);
  iconSprites.set(element, sprite);
  return sprite;
}

export function createRenderer({ canvas, ctx, state, W, H }) {
  let bgCanvas = null;
  // 渲染分辨率倍率：像素填充是最大的开销来源，帧率不足时由主循环调低。
  // 下限保证画布像素不少于 CSS 像素（1:1），再低就会被放大变糊。
  let quality = 1;

  function minQuality() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    return Math.min(1, 1 / dpr);
  }

  // 自适应布局：在舞台可用的宽高内按 16:10 取最大内接尺寸，写回 .sv-arena，
  // 画布再铺满 arena。用 clientWidth/clientHeight 而非 getBoundingClientRect：
  // 强制横屏时容器被 rotate(90deg)，rect 会返回旋转后的外接矩形（宽高互换）
  function resizeCanvas() {
    const arena = canvas.parentElement;
    const stage = arena ? arena.parentElement : null;
    const availW = (stage && stage.clientWidth) || W;
    const availH = (stage && stage.clientHeight) || H;
    const scale = Math.min(availW / W, availH / H) || 1;
    const cssW = Math.max(1, Math.floor(W * scale));
    const cssH = Math.max(1, Math.floor(H * scale));
    if (arena) {
      arena.style.width = `${cssW}px`;
      arena.style.height = `${cssH}px`;
    }
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    // 上限由设置控制（默认 2560，移动端 1600），避免 4K + 高 DPR 时像素量过大导致掉帧
    const cap = (state.settings && state.settings.canvasCap) || 2560;
    const bw = Math.max(1, Math.min(cap, Math.round(cssW * dpr * quality)));
    const bh = Math.max(1, Math.round(bw * (cssH / cssW)));
    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw;
      canvas.height = bh;
    }
    ctx.setTransform(bw / W, 0, 0, bh / H, 0, 0);
    buildBackground();
    // 暂停时主循环不绘制，窗口尺寸变化后需要手动补一帧，避免画布空白
    if (state.paused) render();
  }

  function setQuality(next) {
    // 具体下限由主循环按画质模式决定，这里只做安全钳制
    const q = Math.max(0.4, Math.min(1, next));
    if (Math.abs(q - quality) < 0.02) return;
    quality = q;
    resizeCanvas();
  }

  // 背景（渐变 + 网格）是静态的：预渲染到离屏画布，每帧只做一次整图拷贝，
  // 避免每帧对整块画布逐像素计算径向渐变与几十条网格线
  function buildBackground() {
    const bc = document.createElement('canvas');
    bc.width = canvas.width;
    bc.height = canvas.height;
    const g = bc.getContext('2d');
    g.setTransform(bc.width / W, 0, 0, bc.height / H, 0, 0);
    const grad = g.createRadialGradient(W / 2, H / 2, 60, W / 2, H / 2, W * 0.68);
    grad.addColorStop(0, '#1b2038');
    grad.addColorStop(1, '#0d101d');
    g.fillStyle = grad;
    // 多画 24 单位余量，屏幕抖动时不会露出边缘
    g.fillRect(-24, -24, W + 48, H + 48);
    const bg = (state.settings && state.settings.background) || 'grid';
    if (bg === 'stars') {
      // 固定种子的伪随机星点：重建背景时图案保持一致，且绘制成本只在重建时发生
      let seed = 20261125;
      const rnd = () => {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        return seed / 0x7fffffff;
      };
      for (let i = 0; i < 160; i += 1) {
        const x = rnd() * W;
        const y = rnd() * H;
        const r = 0.6 + rnd() * 1.5;
        g.fillStyle = `rgba(190, 214, 255, ${(0.08 + rnd() * 0.2).toFixed(3)})`;
        g.beginPath();
        g.arc(x, y, r, 0, Math.PI * 2);
        g.fill();
      }
    } else if (bg === 'grid') {
      g.strokeStyle = 'rgba(120, 150, 220, 0.08)';
      g.lineWidth = 1;
      g.beginPath();
      for (let x = 0; x <= W; x += 48) {
        g.moveTo(x, 0);
        g.lineTo(x, H);
      }
      for (let y = 0; y <= H; y += 48) {
        g.moveTo(0, y);
        g.lineTo(W, y);
      }
      g.stroke();
    }
    bgCanvas = bc;
  }

  function drawGems() {
    const gems = state.gems;
    if (!gems.length) return;
    const glowOn = !state.settings || state.settings.gemGlow !== false;
    // 经验球很多时批量绘制：只做少量整体填充，保留呼吸感与辉光，
    // 但不逐颗 shadowBlur，否则几百颗球会直接把帧率拖垮
    if (gems.length > 24) {
      ctx.save();
      ctx.fillStyle = '#7cf5c4';
      // 伪辉光：整体放大一圈、低透明度铺底，替代逐颗阴影
      if (glowOn) {
        ctx.globalAlpha = 0.14;
        ctx.beginPath();
        for (const g of gems) {
          const s = g.r * 1.7;
          ctx.rect(g.x - s, g.y - s, s * 2, s * 2);
        }
        ctx.fill();
      }
      // 按 bob 分成 3 组错相位呼吸，每组只填充一次
      for (let phase = 0; phase < 3; phase += 1) {
        const pulse = 1 + Math.sin(state.time * 4 + phase * 2.09) * 0.1;
        ctx.globalAlpha = phase === 0 ? 1 : 0.88;
        ctx.beginPath();
        for (const g of gems) {
          if ((((g.bob / 6) * 3) | 0) !== phase) continue;
          const s = g.r * pulse;
          ctx.rect(g.x - s, g.y - s, s * 2, s * 2);
        }
        ctx.fill();
      }
      // 少量高光宝石保留旋转发光，制造闪烁感（数量固定，开销可控）
      if (glowOn) {
        ctx.globalAlpha = 1;
        ctx.shadowColor = '#7cf5c4';
        ctx.shadowBlur = 6;
        const step = Math.max(1, Math.ceil(gems.length / 24));
        for (let i = 0; i < gems.length; i += step) {
          const g = gems[i];
          const s = g.r;
          ctx.save();
          ctx.translate(g.x, g.y);
          ctx.rotate(state.time * 2 + g.bob);
          ctx.fillRect(-s, -s, s * 2, s * 2);
          ctx.restore();
        }
      }
      ctx.restore();
      return;
    }
    for (const g of gems) {
      const pulse = 1 + Math.sin(state.time * 4 + g.bob) * 0.12;
      ctx.save();
      ctx.translate(g.x, g.y);
      ctx.rotate(state.time * 2 + g.bob);
      if (glowOn) {
        ctx.shadowColor = '#7cf5c4';
        ctx.shadowBlur = 10;
      }
      ctx.fillStyle = '#7cf5c4';
      const s = g.r * pulse;
      ctx.fillRect(-s, -s, s * 2, s * 2);
      ctx.restore();
    }
  }

  // 血包：愈灵等怪物掉落，靠近后自动吸附拾取
  function drawHealthPacks() {
    const list = state.healthPacks;
    if (!list || !list.length) return;
    const pulse = 1 + Math.sin(state.time * 5) * 0.08;
    for (const h of list) {
      if (h.dead) continue;
      ctx.save();
      ctx.translate(h.x, h.y + Math.sin(state.time * 3 + h.bob) * 2);
      ctx.shadowColor = '#4ade80';
      ctx.shadowBlur = 14;
      ctx.fillStyle = 'rgba(20, 83, 45, 0.85)';
      ctx.beginPath();
      ctx.arc(0, 0, h.r * pulse, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = '#4ade80';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, h.r * pulse, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#4ade80';
      const s = h.r * 0.55;
      ctx.fillRect(-s * 0.34, -s, s * 0.68, s * 2);
      ctx.fillRect(-s, -s * 0.34, s * 2, s * 0.68);
      ctx.restore();
    }
  }

  function drawProjectiles() {
    const list = state.projectiles;
    if (!list.length) return;
    // 按颜色分组后每种颜色只 fill 一次；弹幕多时关闭发光
    const glow = list.length < 120;
    const groups = new Map();
    for (const pr of list) {
      const color = pr.color || '#ffe066';
      let group = groups.get(color);
      if (!group) {
        group = [];
        groups.set(color, group);
      }
      group.push(pr);
    }
    ctx.save();
    for (const [color, arr] of groups) {
      ctx.fillStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = glow ? 12 : 0;
      ctx.beginPath();
      for (const pr of arr) {
        ctx.moveTo(pr.x + pr.r, pr.y);
        ctx.arc(pr.x, pr.y, pr.r, 0, Math.PI * 2);
      }
      ctx.fill();
    }
    ctx.restore();
  }

  function drawEnemyShots() {
    const list = state.enemyShots;
    if (!list.length) return;
    // 按颜色批量绘制，弹量少时才保留发光
    const glow = list.length < 80;
    const groups = new Map();
    for (const s of list) {
      const color = s.color || '#f87171';
      let group = groups.get(color);
      if (!group) {
        group = [];
        groups.set(color, group);
      }
      group.push(s);
    }
    ctx.save();
    for (const [color, arr] of groups) {
      ctx.fillStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = glow ? 12 : 0;
      ctx.beginPath();
      for (const s of arr) {
        ctx.moveTo(s.x + s.r, s.y);
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      }
      ctx.fill();
    }
    ctx.restore();
  }

  // 怪物辉光：按颜色批量铺一层放大半透明底，替代逐只 shadowBlur（阴影模糊是 Canvas 最贵的操作之一）
  function drawEnemyGlow() {
    const list = state.enemies;
    // 移动端 GPU 对大面积半透明叠加更敏感，更早关闭辉光层
    const glowLimit = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ? 100 : 220;
    if (!list.length || list.length > glowLimit) return;
    if (state.settings && state.settings.glow === false) return;
    const groups = new Map();
    for (const e of list) {
      if (e.boss) continue;
      let group = groups.get(e.color);
      if (!group) {
        group = [];
        groups.set(e.color, group);
      }
      group.push(e);
    }
    if (!groups.size) return;
    ctx.save();
    ctx.globalAlpha = 0.16;
    for (const [color, arr] of groups) {
      ctx.fillStyle = color;
      ctx.beginPath();
      for (const e of arr) {
        const r = e.r * 1.75;
        ctx.moveTo(e.x + r, e.y);
        ctx.arc(e.x, e.y, r, 0, Math.PI * 2);
      }
      ctx.fill();
    }
    ctx.restore();
  }

  // 普通圆形怪数量最多：按颜色批量绘制，几百次 fill 压成几次
  function drawPlainCircles() {
    const groups = new Map();
    for (const e of state.enemies) {
      if (e.shape !== 'circle' || e.boss || e.flash > 0) continue;
      let arr = groups.get(e.color);
      if (!arr) {
        arr = [];
        groups.set(e.color, arr);
      }
      arr.push(e);
    }
    if (!groups.size) return;
    ctx.save();
    for (const [color, arr] of groups) {
      ctx.fillStyle = color;
      ctx.beginPath();
      for (const e of arr) {
        ctx.moveTo(e.x + e.r, e.y);
        ctx.arc(e.x, e.y, e.r, 0, Math.PI * 2);
      }
      ctx.fill();
    }
    ctx.restore();
  }

  function drawEnemies() {
    for (const e of state.enemies) {
      ctx.save();
      ctx.fillStyle = e.flash > 0 ? '#ffffff' : e.color;
      if (e.boss) {
        ctx.shadowColor = e.color;
        ctx.shadowBlur = 24;
      }

      // 冻结时位置已经停住，这里再把朝向与旋转/脉冲动画一起定格，避免看起来还在动
      const frozen = e.freezeTimer > 0;
      const animTime = frozen ? 0 : state.time;
      const aim = frozen
        ? (e.freezeAngle || 0)
        : Math.atan2(state.player.y - e.y, state.player.x - e.x);

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
          ctx.arc(0, 0, e.r + 5 + Math.sin(state.time * 30) * 2, 0, Math.PI * 2);
          ctx.stroke();
        }
      } else if (e.shape === 'shooter') {
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.75)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.r * 0.55, 0, Math.PI * 2);
        ctx.stroke();
      } else if (e.shape === 'splitter') {
        ctx.translate(e.x, e.y);
        ctx.rotate(animTime * 0.9);
        ctx.fillRect(-e.r * 0.75, -e.r * 0.75, e.r * 1.5, e.r * 1.5);
      } else if (e.shape === 'bomber') {
        if (e.fuse > 0) ctx.fillStyle = '#f87171';
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = e.fuse > 0 ? 'rgba(255, 255, 255, 0.95)' : 'rgba(255, 237, 213, 0.7)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.r + 3 + Math.sin(animTime * (e.fuse > 0 ? 30 : 6)) * 2, 0, Math.PI * 2);
        ctx.stroke();
      } else if (e.boss) {
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.65)';
        ctx.beginPath();
        if (e.freezeTimer > 0) ctx.arc(e.x, e.y, e.r + 7, 0, Math.PI * 2);
        else ctx.arc(e.x, e.y, e.r + 7 + Math.sin(state.time * 5) * 2, 0, Math.PI * 2);
        ctx.stroke();
      } else if (e.shape !== 'circle' || e.flash > 0) {
        // 普通圆形怪已在 drawPlainCircles 批量画过，这里只补闪白与未知形状
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      // 闪现者蓄力预警：沿突刺方向画一条虚线，提示玩家横向躲开
      if (e.mode === 'windup' && e.aimAngle != null && !frozen) {
        ctx.save();
        ctx.strokeStyle = 'rgba(232, 121, 249, 0.85)';
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 6]);
        ctx.globalAlpha = 0.55 + Math.sin(state.time * 24) * 0.3;
        ctx.beginPath();
        ctx.moveTo(e.x, e.y);
        ctx.lineTo(e.x + Math.cos(e.aimAngle) * 120, e.y + Math.sin(e.aimAngle) * 120);
        ctx.stroke();
        ctx.restore();
      }

      // 元素附着标记：预渲染贴图，避免每帧 fillText 栅格化 emoji
      const sprite = e.element && (!state.settings || state.settings.icons !== false)
        ? getElementSprite(e.element)
        : null;
      if (sprite) {
        const iconY = e.y - e.r - 9;
        ctx.drawImage(
          sprite,
          e.x - ICON_DRAW_SIZE / 2,
          iconY - ICON_DRAW_SIZE / 2,
          ICON_DRAW_SIZE,
          ICON_DRAW_SIZE,
        );
      }

      // 冻结：冰壳覆盖；超导易伤：紫色虚线外圈
      if (e.freezeTimer > 0) {
        ctx.save();
        ctx.globalAlpha = 0.55;
        ctx.fillStyle = '#7dd3fc';
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.r + 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 0.95;
        ctx.strokeStyle = '#e0f2fe';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.r + 2, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
      if (e.vulnTimer > 0) {
        ctx.save();
        ctx.globalAlpha = 0.8;
        ctx.strokeStyle = '#a78bfa';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.r + 5, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

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

  // 感电连锁：在连接的怪物之间画闪电折线
  function drawLightning() {
    const arcs = state.lightningArcs;
    if (!arcs || !arcs.length) return;
    // 所有闪电合并为一条路径：发光描边 + 高亮描边各一次，避免逐条 shadowBlur
    let alpha = 0;
    for (const arc of arcs) {
      if (arc.life > alpha) alpha = arc.life;
    }
    const glow = arcs.length <= 8;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha / 0.24));
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
    ctx.shadowBlur = glow ? 14 : 0;
    ctx.stroke();
    ctx.strokeStyle = '#fffbe6';
    ctx.lineWidth = 1.6;
    ctx.shadowBlur = 0;
    ctx.stroke();
    ctx.restore();
    ctx.globalAlpha = 1;
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

  function drawEffects() {
    // 新星 / 爆炸都按批合并路径，一次描边/填充，避免逐个特效开 shadowBlur
    const novas = state.novas;
    if (novas.length) {
      // 不同反应的新星颜色不同（感电青色 / 超载橙色 / 融化金色 / 超导紫色 / 冻结冰蓝），按颜色分组
      const groups = new Map();
      for (const n of novas) {
        const color = n.color || '#67e8f9';
        let group = groups.get(color);
        if (!group) {
          group = [];
          groups.set(color, group);
        }
        group.push(n);
      }
      ctx.save();
      for (const [color, arr] of groups) {
        let alpha = 0;
        for (const n of arr) alpha = Math.max(alpha, n.life / n.maxLife);
        ctx.globalAlpha = alpha * 0.85;
        ctx.strokeStyle = color;
        ctx.lineWidth = 3;
        ctx.shadowColor = color;
        ctx.shadowBlur = novas.length <= 8 ? 16 : 0;
        ctx.beginPath();
        for (const n of arr) {
          const t = 1 - n.life / n.maxLife;
          const r = n.r + (n.maxR - n.r) * t;
          ctx.moveTo(n.x + r, n.y);
          ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
        }
        ctx.stroke();
      }
      ctx.restore();
    }
    const explosions = state.explosions;
    if (explosions.length) {
      let alpha = 0;
      for (const ex of explosions) alpha = Math.max(alpha, ex.life / ex.maxLife);
      ctx.save();
      ctx.globalAlpha = alpha * 0.7;
      ctx.fillStyle = '#ffb703';
      ctx.beginPath();
      for (const ex of explosions) {
        const t = 1 - ex.life / ex.maxLife;
        const r = ex.r + (ex.maxR - ex.r) * t;
        ctx.moveTo(ex.x + r, ex.y);
        ctx.arc(ex.x, ex.y, r, 0, Math.PI * 2);
      }
      ctx.fill();
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  function drawParticles() {
    const list = state.particles;
    if (!list.length) return;
    const particleSetting = (state.settings && state.settings.particles) || 'high';
    if (particleSetting === 'off') return;
    // 中/低档按固定步长抽样绘制，粒子多时能直接砍掉一半以上的填充开销
    const stride = particleSetting === 'mid' ? 2 : particleSetting === 'low' ? 3 : 1;
    // 按颜色 + 透明度分桶，每桶合成一条路径只 fill 一次，避免逐颗粒改状态
    const buckets = new Map();
    for (const pt of list) {
      const alpha = Math.max(0, pt.life / pt.maxLife);
      const q = Math.min(3, (alpha * 4) | 0);
      const key = `${pt.color}|${q}`;
      let arr = buckets.get(key);
      if (!arr) {
        arr = [];
        buckets.set(key, arr);
      }
      arr.push(pt);
    }
    ctx.save();
    for (const [key, arr] of buckets) {
      const sep = key.lastIndexOf('|');
      ctx.globalAlpha = (Number(key.slice(sep + 1)) + 0.5) / 4;
      ctx.fillStyle = key.slice(0, sep);
      ctx.beginPath();
      for (let i = 0; i < arr.length; i += stride) {
        const pt = arr[i];
        ctx.moveTo(pt.x + pt.r, pt.y);
        ctx.arc(pt.x, pt.y, pt.r, 0, Math.PI * 2);
      }
      ctx.fill();
    }
    ctx.restore();
  }

  // 波次提示文字（画布内，跟随缩放保持清晰）
  function drawWaveBanner() {
    if (state.waveBanner <= 0) return;
    ctx.save();
    ctx.globalAlpha = Math.min(1, state.waveBanner / 0.7);
    ctx.fillStyle = 'rgba(147, 197, 253, 0.92)';
    ctx.font = 'bold 26px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`第 ${state.wave} 波`, W / 2, 128);
    ctx.restore();
  }

  function render() {
    const shakeOn = !state.settings || state.settings.shake !== false;
    const shake = shakeOn && state.shake > 0 ? state.shake * 16 : 0;
    ctx.save();
    if (shake > 0) {
      ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    }

    if (bgCanvas) {
      // 背景按画布像素 1:1 拷贝，避免每帧对整张背景做缩放重采样
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(bgCanvas, 0, 0);
      ctx.restore();
    } else {
      ctx.fillStyle = '#0d101d';
      ctx.fillRect(-24, -24, W + 48, H + 48);
    }

    drawWaveBanner();
    drawHealthPacks();
    drawGems();
    drawProjectiles();
    drawEnemyGlow();
    drawPlainCircles();
    drawEnemies();
    drawLightning();
    drawEnemyShots();
    drawEffects();
    drawPlayer();
    drawParticles();
    ctx.restore();

    if (state.flash > 0 && (!state.settings || state.settings.flash !== false)) {
      ctx.fillStyle = `rgba(255, 70, 70, ${state.flash * 0.28})`;
      ctx.fillRect(0, 0, W, H);
    }
  }

  return {
    resizeCanvas,
    render,
    setQuality,
    getQuality: () => quality,
    getMinQuality: minQuality,
    refreshBackground: buildBackground,
  };
}
