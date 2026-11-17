/**
 * 刷怪肉鸽渲染层：画布自适应与全部 Canvas 绘制（只读 state，不改游戏状态）。
 */

const ELEMENT_ICONS = { fire: '🔥', thunder: '⚡', ice: '❄️', water: '💧' };
const ELEMENT_COLORS = { fire: '#ff6b3d', thunder: '#facc15', ice: '#7dd3fc', water: '#3b82f6' };

export function createRenderer({ canvas, ctx, state, W, H }) {
  let bgGradient = null;

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
    // 上限 2560，避免 4K + 高 DPR 时像素量过大导致掉帧
    const bw = Math.max(1, Math.min(2560, Math.round(cssW * dpr)));
    const bh = Math.max(1, Math.round(bw * (cssH / cssW)));
    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw;
      canvas.height = bh;
    }
    ctx.setTransform(bw / W, 0, 0, bh / H, 0, 0);
  }

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
    ctx.shadowBlur = 12;
    for (const pr of state.projectiles) {
      const color = pr.color || '#ffe066';
      ctx.shadowColor = color;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(pr.x, pr.y, pr.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawEnemyShots() {
    ctx.save();
    ctx.shadowBlur = state.enemyShots.length < 80 ? 12 : 0;
    for (const s of state.enemyShots) {
      ctx.shadowColor = s.color;
      ctx.fillStyle = s.color;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawEnemies() {
    for (const e of state.enemies) {
      ctx.save();
      ctx.fillStyle = e.flash > 0 ? '#ffffff' : e.color;
      ctx.shadowColor = e.color;
      // 怪潮很大时关闭普通怪的发光，避免掉帧
      ctx.shadowBlur = e.boss ? 24 : (state.enemies.length < 160 ? 8 : 0);

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
      } else if (e.shape === 'charger') {
        ctx.translate(e.x, e.y);
        ctx.rotate(Math.atan2(state.player.y - e.y, state.player.x - e.x) + Math.PI / 2);
        ctx.beginPath();
        ctx.moveTo(0, -e.r);
        ctx.lineTo(e.r, 0);
        ctx.lineTo(0, e.r);
        ctx.lineTo(-e.r, 0);
        ctx.closePath();
        ctx.fill();
        if (e.mode === 'windup') {
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
        ctx.rotate(state.time * 0.9);
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
        ctx.arc(e.x, e.y, e.r + 3 + Math.sin(state.time * (e.fuse > 0 ? 30 : 6)) * 2, 0, Math.PI * 2);
        ctx.stroke();
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

      // 元素附着标记：显示在怪物头顶
      if (e.element && ELEMENT_ICONS[e.element]) {
        ctx.save();
        ctx.font = '11px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = ELEMENT_COLORS[e.element] || '#ffffff';
        ctx.shadowColor = 'rgba(0, 0, 0, 0.85)';
        ctx.shadowBlur = 3;
        ctx.fillText(ELEMENT_ICONS[e.element], e.x, e.y - e.r - 9);
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
    for (const n of state.novas) {
      const t = 1 - n.life / n.maxLife;
      ctx.save();
      ctx.globalAlpha = Math.max(0, n.life / n.maxLife) * 0.85;
      ctx.strokeStyle = '#67e8f9';
      ctx.lineWidth = 3;
      ctx.shadowColor = '#22d3ee';
      ctx.shadowBlur = 16;
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r + (n.maxR - n.r) * t, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    for (const ex of state.explosions) {
      const t = 1 - ex.life / ex.maxLife;
      ctx.save();
      ctx.globalAlpha = Math.max(0, ex.life / ex.maxLife) * 0.7;
      ctx.fillStyle = '#ffb703';
      ctx.beginPath();
      ctx.arc(ex.x, ex.y, ex.r + (ex.maxR - ex.r) * t, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    ctx.globalAlpha = 1;
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
    drawWaveBanner();
    drawGems();
    drawProjectiles();
    drawEnemies();
    drawEnemyShots();
    drawEffects();
    drawPlayer();
    drawParticles();
    ctx.restore();

    if (state.flash > 0) {
      ctx.fillStyle = `rgba(255, 70, 70, ${state.flash * 0.28})`;
      ctx.fillRect(0, 0, W, H);
    }
  }

  return { resizeCanvas, render };
}
