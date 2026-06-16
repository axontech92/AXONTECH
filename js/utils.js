// ══════════════════════════════════════════
//  js/utils.js - Funciones auxiliares
// ══════════════════════════════════════════

const timeAgo = (ts) => {
  const diff = Date.now() - new Date(ts).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'ahora';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
};

const todayStr = () => new Date().toDateString();
const timeStr = (ts) => new Date(ts).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
const nowDateTime = () => new Date().toLocaleDateString('es-ES') + ' ' + new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });

const GESTOR_COLORS = ['#2563EB', '#7C3AED', '#059669', '#DC2626', '#D97706', '#0891B2', '#BE185D', '#1D4ED8'];

function genPassword(len = 4) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let pass = '';
  for (let i = 0; i < len; i++) {
    pass += chars[Math.floor(Math.random() * chars.length)];
  }
  return pass;
}

function showToast(msg, type = 'info') {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.className = `toast show ${type}`;
  setTimeout(() => t.classList.remove('show'), 2200);
}

function playSound(type) {
  try {
    const ac = new (window.AudioContext || window.webkitAudioContext)();
    const g = ac.createGain();
    g.connect(ac.destination);
    g.gain.setValueAtTime(0.08, ac.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.8);

    const tones = {
      login: [[880, 0], [1100, .15]],
      vale: [[660, 0], [800, .18]],
      confirm: [[440, 0], [660, .15], [880, .3]]
    };

    (tones[type] || []).forEach(([f, d]) => {
      const o = ac.createOscillator();
      o.connect(g);
      o.frequency.value = f;
      o.start(ac.currentTime + d);
      o.stop(ac.currentTime + d + .18);
    });
  } catch (e) {}
}