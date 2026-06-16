// ══════════════════════════════════════════
//  js/ranking.js - Sistema de Ranking de Gestores
//  Extraído desde app.js
// ══════════════════════════════════════════

// Cache de ranking (para no recalcular cada segundo)
let rankingCache = null;

// ══════════════════════════════════════════
//  RENDERIZAR RANKING DE GESTORES
// ══════════════════════════════════════════
async function renderGestorRanking() {
  const c = document.getElementById('rankingList');
  if (!c) return;

  const gestores = await getGestores();
  if (!gestores.length) {
    c.innerHTML = '<div class="es"><div class="es-text">Sin gestores configurados</div></div>';
    return;
  }

  const cfg = await getConfig();
  const meta = cfg.metaPuntos || 0;

  // Usar cache si es reciente (< 15 segundos)
  if (rankingCache && (Date.now() - rankingCache.ts < 15000)) {
    c.innerHTML = rankingCache.html;
    return;
  }

  const vales = (await getVales()).filter(v =>
    ['confirmed', 'pending_payment'].includes(v.status)
  );

  // Calcular puntos por gestor
  const ranked = gestores.map(g => {
    const pts = vales
      .filter(v => v.gestorId === g.id)
      .reduce((sum, v) =>
        sum + (v.valeProductos || []).reduce((s, p) => {
          const pr = productoOf ? productoOf(p.id) : null;
          return s + (pr ? pr.puntos * p.qty : 0);
        }, 0), 0
      );
    return { ...g, pts };
  }).sort((a, b) => b.pts - a.pts);

  const medals = ['🥇', '🥈', '🥉'];
  const barGradients = [
    'linear-gradient(90deg,#F59E0B,#EF4444)',
    'linear-gradient(90deg,#94A3B8,#64748B)',
    'linear-gradient(90deg,#cd7f32,#b36200)',
    'linear-gradient(90deg,#00b4d8,#0284c7)',
    'linear-gradient(90deg,#6366f1,#818cf8)',
    'linear-gradient(90deg,#ec4899,#f472b6)',
  ];

  const maxRef = meta > 0 ? meta : Math.max(ranked[0]?.pts || 1, 1);

  let html = '';

  // Mostrar meta si está configurada
  if (meta > 0) {
    const reached = ranked.filter(g => g.pts >= meta).length;
    html += `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;padding-bottom:10px;border-bottom:1px solid var(--gray-200);">
      <span style="font-size:11px;font-weight:700;color:var(--gray-400);text-transform:uppercase;letter-spacing:.5px;">🎯 Meta: ${meta} pts</span>
      <span style="font-size:11px;font-weight:600;color:${reached > 0 ? 'var(--green)' : 'var(--gray-400)'};">${reached}/${ranked.length} alcanzaron</span>
    </div>`;
  }

  // Generar filas del ranking
  html += ranked.map((g, i) => {
    const pct = maxRef > 0 ? Math.min(100, Math.round((g.pts / maxRef) * 100)) : 0;
    const reached = meta > 0 && g.pts >= meta;
    const grad = reached
      ? 'linear-gradient(90deg,var(--green),#10B981)'
      : barGradients[Math.min(i, barGradients.length - 1)];
    const pos = reached ? '🏆' : (medals[i] || `${i + 1}.`);
    const hint = meta > 0
      ? (reached
          ? `<span style="color:var(--green);">¡Meta alcanzada! 🎉</span>`
          : `faltan <b>${meta - g.pts} pts</b> para la meta`)
      : (g.pts > 0 ? `${pct}% del líder` : 'Aún sin puntos');

    return `<div class="rank-row">
      <div class="rank-pos">${pos}</div>
      <div style="flex:1;min-width:0;">
        <div style="display:flex;align-items:center;gap:8px;">
          <div class="g-avatar" style="background:${g.color};width:28px;height:28px;font-size:10px;flex-shrink:0;">${g.initials}</div>
          <span class="rank-name">${g.name}</span>
          <span class="rank-pts" style="${reached ? 'color:var(--green);' : ''}">${g.pts} pts</span>
        </div>
        <div class="rank-bar-wrap"><div class="rank-bar" style="width:${pct}%;background:${grad};"></div></div>
        <div class="rank-hint">${hint}</div>
      </div>
    </div>`;
  }).join('');

  c.innerHTML = html;

  // Guardar en cache
  rankingCache = { html, ts: Date.now() };
}

// ══════════════════════════════════════════
//  CONFETTI Y CELEBRACIÓN DE META
// ══════════════════════════════════════════
function launchConfetti() {
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:fixed;inset:0;z-index:499;pointer-events:none;';
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');

  const colors = ['#00b4d8', '#F59E0B', '#10B981', '#EF4444', '#7C3AED', '#F97316', '#EC4899', '#ffffff'];
  const particles = Array.from({ length: 160 }, () => ({
    x: Math.random() * canvas.width,
    y: -20 - Math.random() * canvas.height * 0.6,
    w: 6 + Math.random() * 10,
    h: 3 + Math.random() * 5,
    color: colors[Math.floor(Math.random() * colors.length)],
    vx: (Math.random() - 0.5) * 4,
    vy: 1.5 + Math.random() * 4,
    rot: Math.random() * Math.PI * 2,
    vrot: (Math.random() - 0.5) * 0.18,
    shape: Math.random() > 0.6 ? 'circle' : 'rect',
  }));

  let frame;
  const start = Date.now();

  (function animate() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const elapsed = Date.now() - start;
    const alpha = elapsed > 2800 ? Math.max(0, 1 - (elapsed - 2800) / 900) : 1;

    particles.forEach(p => {
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vrot;
      p.vy += 0.06;

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      if (p.shape === 'circle') {
        ctx.beginPath();
        ctx.arc(0, 0, p.w / 2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      }
      ctx.restore();
    });

    if (elapsed < 3700) {
      frame = requestAnimationFrame(animate);
    } else {
      canvas.remove();
    }
  })();

  setTimeout(() => {
    cancelAnimationFrame(frame);
    if (canvas.parentNode) canvas.remove();
  }, 4200);
}

function showGoalBanner(g, pts) {
  const old = document.getElementById('goalBanner');
  if (old) old.remove();

  const el = document.createElement('div');
  el.id = 'goalBanner';
  el.innerHTML = `
    <div style="font-size:32px;flex-shrink:0;">🏆</div>
    <div style="flex:1;min-width:0;">
      <div style="font-size:15px;font-weight:900;letter-spacing:.5px;text-shadow:0 1px 4px rgba(0,0,0,.3);">¡META ALCANZADA!</div>
      <div style="font-size:13px;opacity:.9;margin-top:2px;">${g.name} llegó a <b>${pts} puntos ⭐</b> — ¡Felicidades!</div>
    </div>
    <div style="background:${g.color};width:42px;height:42px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:13px;flex-shrink:0;border:2px solid rgba(255,255,255,.4);">${g.initials}</div>
    <button onclick="dismissGoalBanner()" style="background:rgba(255,255,255,.18);border:none;color:white;border-radius:50%;width:26px;height:26px;cursor:pointer;font-size:16px;line-height:1;display:flex;align-items:center;justify-content:center;flex-shrink:0;padding:0;">×</button>`;

  document.body.appendChild(el);
  setTimeout(() => dismissGoalBanner(), 6000);
}

function dismissGoalBanner() {
  const el = document.getElementById('goalBanner');
  if (!el) return;
  el.classList.add('hide');
  setTimeout(() => el.remove(), 370);
}

// ══════════════════════════════════════════
//  VERIFICAR SI SE ALCANZÓ LA META
// ══════════════════════════════════════════
async function checkGoalReached(gestorId, currentValeId) {
  const cfg = await getConfig();
  const meta = cfg.metaPuntos;
  if (!meta || !gestorId) return;

  const g = (await getGestores()).find(x => x.id === gestorId);
  if (!g) return;

  const vales = (await getVales()).filter(v =>
    v.gestorId === gestorId && ['confirmed', 'pending_payment'].includes(v.status)
  );

  const pts = vales.reduce((sum, v) =>
    sum + (v.valeProductos || []).reduce((s, p) => {
      const pr = productoOf ? productoOf(p.id) : null;
      return s + (pr ? pr.puntos * p.qty : 0);
    }, 0), 0
  );

  if (pts >= meta) {
    const prev = vales
      .filter(v => v.id !== currentValeId)
      .reduce((sum, v) =>
        sum + (v.valeProductos || []).reduce((s, p) => {
          const pr = productoOf ? productoOf(p.id) : null;
          return s + (pr ? pr.puntos * p.qty : 0);
        }, 0), 0
      );

    if (prev < meta) {
      launchConfetti();
      showGoalBanner(g, pts);
    }
  }
}

// Exportar funciones
window.renderGestorRanking = renderGestorRanking;
window.checkGoalReached = checkGoalReached;
window.launchConfetti = launchConfetti;