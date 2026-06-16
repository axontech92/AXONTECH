// ══════════════════════════════════════════
//  js/notifications.js - Sistema de Notificaciones
//  Extraído desde app.js
// ══════════════════════════════════════════

const LOW_STOCK_THRESHOLD = 3;

// ══════════════════════════════════════════
//  AÑADIR NOTIFICACIÓN
// ══════════════════════════════════════════
function addNotif(type, productName, productId, extra, gestorId) {
  getNotifs().then(notifs => {
    notifs.unshift({
      id: Date.now(),
      type,
      productName,
      productId,
      ts: new Date().toISOString(),
      read: false,
      extra: extra || '',
      gestorId: gestorId || null
    });

    if (notifs.length > 50) notifs.splice(50);

    saveNotifs(notifs);
    renderGestorNotifs();
  });
}

// ══════════════════════════════════════════
//  RENDERIZAR NOTIFICACIONES DEL GESTOR
// ══════════════════════════════════════════
async function renderGestorNotifs() {
  const notifs = await getNotifs();
  const cutoff = Date.now() - 72 * 60 * 60 * 1000;

  const recent = notifs.filter(n => {
    if (new Date(n.ts).getTime() <= cutoff) return false;
    if (['vale_confirmed', 'sale_product', 'vale_assigned'].includes(n.type) &&
        n.gestorId && activeGestorId && n.gestorId !== activeGestorId) {
      return false;
    }
    return true;
  });

  const sec = document.getElementById('gestorNotifsSection');
  if (!sec) return;

  if (!recent.length) {
    sec.style.display = 'none';
    return;
  }

  sec.style.display = 'block';

  const unread = recent.filter(n => !n.read).length;
  const badge = document.getElementById('notifUnreadBadge');
  if (badge) {
    badge.textContent = unread;
    badge.style.display = unread ? 'inline-block' : 'none';
  }

  const icons = {
    new_product: '✨',
    out_of_stock: '❌',
    low_stock: '⚠️',
    restocked: '✅',
    vale_confirmed: '🎉',
    sale_product: '🛒',
    vale_assigned: '🛵'
  };

  document.getElementById('gestorNotifsList').innerHTML = recent.map(n => {
    const icon = icons[n.type] || '📢';
    const age = timeAgo(n.ts);

    const typeClass = n.type === 'out_of_stock' ? 'agotado'
                    : n.type === 'low_stock' ? 'low'
                    : n.type === 'restocked' ? 'restocked'
                    : ['vale_confirmed', 'sale_product', 'vale_assigned'].includes(n.type) ? 'ok'
                    : '';

    const cls = !n.read ? 'unread' : `type-${typeClass}`;

    let msg = '';

    if (n.type === 'sale_product') {
      const parts = (n.extra || '').split('|');
      const qty = parseInt(parts[0]) || 1;
      const left = parseInt(parts[1]);
      msg = `<b>Se vendió${qty > 1 ? ` <span style="color:var(--blue);font-weight:800;">${qty}</span>` : ''}</b> ${n.productName}${!isNaN(left) ? ` — quedan <b style="color:${left === 0 ? 'var(--red)' : left <= LOW_STOCK_THRESHOLD ? 'var(--yellow)' : 'var(--green)'};">${left}</b>` : ''}`;
    } else if (n.type === 'vale_assigned') {
      msg = `🛵 Tu venta está con el mensajero`;
    } else if (n.type === 'vale_confirmed') {
      msg = `<b>¡Venta completada! ✅</b> · ${n.productName}${n.extra ? ` <span style="color:var(--gray-400);font-size:10px;">(${n.extra})</span>` : ''}`;
    } else if (n.type === 'out_of_stock') {
      msg = `<b>Agotado:</b> ${n.productName}`;
    } else if (n.type === 'low_stock') {
      msg = `<b>Stock bajo:</b> ${n.productName} <span style="color:var(--yellow);">(${n.extra})</span>`;
    } else if (n.type === 'restocked') {
      msg = `<b>Repuesto:</b> ${n.productName} <span style="color:var(--green);">(${n.extra})</span>`;
    } else if (n.type === 'new_product') {
      msg = `<b>Nuevo producto:</b> ${n.productName}${n.extra ? ` · ${n.extra}` : ''}`;
    } else {
      msg = `${n.productName}${n.extra ? ` (${n.extra})` : ''}`;
    }

    return `<div class="gnotif-item ${cls}" onclick="markNotifRead(${n.id})">
      <span class="gnotif-icon">${icon}</span>
      <div class="gnotif-text" style="line-height:1.5;">${msg}</div>
      <span class="gnotif-time">${age}</span>
    </div>`;
  }).join('');
}

// ══════════════════════════════════════════
//  MARCAR NOTIFICACIÓN COMO LEÍDA
// ══════════════════════════════════════════
async function markNotifRead(id) {
  const notifs = await getNotifs();
  const n = notifs.find(x => x.id === id);
  if (n) {
    n.read = true;
    await saveNotifs(notifs);
    renderGestorNotifs();
  }
}

// ══════════════════════════════════════════
//  LIMPIAR TODAS LAS NOTIFICACIONES
// ══════════════════════════════════════════
async function clearGestorNotifs() {
  await saveNotifs([]);
  renderGestorNotifs();
}

// Hacer funciones disponibles globalmente
window.addNotif = addNotif;
window.renderGestorNotifs = renderGestorNotifs;
window.markNotifRead = markNotifRead;
window.clearGestorNotifs = clearGestorNotifs;