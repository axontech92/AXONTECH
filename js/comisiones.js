// ══════════════════════════════════════════
//  js/comisiones.js - Sistema de Comisiones
//  Extraído desde app.js
// ══════════════════════════════════════════

let activeComisionGestorId = null;

// ══════════════════════════════════════════
//  TOGGLE COMISIÓN POR GESTOR
// ══════════════════════════════════════════
function toggleComisionGestor(id) {
  activeComisionGestorId = activeComisionGestorId === id ? null : id;
  renderComisiones();
}

// ══════════════════════════════════════════
//  CALCULAR PARTES DE COMISIÓN DE UN VALE
// ══════════════════════════════════════════
function getValeCommissionParts(v) {
  const items = v.valeProductos || [];
  const parts = [];
  let total = 0;
  let currency = 'USD';
  let computable = true;

  items.forEach(({ id, qty }) => {
    const p = productoOf ? productoOf(id) : null;
    if (!p) return;

    const com = p.comision || '';
    if (!com) return;

    const label = `${p.name}${qty > 1 ? ` ×${qty}` : ''}`;
    const isPct = com.includes('%');

    if (isPct) {
      const pct = parseFloat(com.replace(/[^0-9.]/g, ''));
      const priceNum = parsePrecioNum(p.precio || '');
      if (!isNaN(pct) && priceNum > 0) {
        const amt = Math.round(priceNum * (pct / 100) * qty * 100) / 100;
        total += amt;
        parts.push({ label, com: `${pct}% = $${amt.toFixed(2)}` });
        if ((p.precio || '').includes('CUP')) currency = 'CUP';
      } else {
        parts.push({ label, com });
        computable = false;
      }
    } else {
      const num = parsePrecioNum(com);
      if (num > 0) {
        total += num * qty;
        parts.push({ label, com: `${com}${qty > 1 ? ` ×${qty}` : ''}` });
      } else {
        parts.push({ label, com });
        computable = false;
      }
      if (com.includes('CUP')) currency = 'CUP';
    }
  });

  return {
    parts,
    total: computable && parts.length ? total : null,
    currency
  };
}

// ══════════════════════════════════════════
//  PAGAR COMISIÓN INDIVIDUAL
// ══════════════════════════════════════════
async function payCommission(valeId, e) {
  if (e) e.stopPropagation();

  await patchVale(valeId, {
    commissionPaid: true,
    commissionPaidTs: new Date().toISOString()
  });

  if (typeof gestoresTabDirty !== 'undefined') gestoresTabDirty = true;

  renderComisiones();
  maybeAutoSync();
  showToast('Comisión marcada como pagada ✓');
}

// ══════════════════════════════════════════
//  PAGAR TODAS LAS COMISIONES DE UN GESTOR
// ══════════════════════════════════════════
async function payAllCommissions(gestorId, e) {
  if (e) e.stopPropagation();

  const ts = new Date().toISOString();
  const vales = (await getVales()).filter(v =>
    v.gestorId === gestorId &&
    !v.commissionPaid &&
    ['confirmed', 'pending_payment'].includes(v.status)
  );

  for (const v of vales) {
    await patchVale(v.id, {
      commissionPaid: true,
      commissionPaidTs: ts
    });
  }

  if (typeof gestoresTabDirty !== 'undefined') gestoresTabDirty = true;

  renderComisiones();
  maybeAutoSync();
  showToast('Todas las comisiones pagadas ✅');
}

// ══════════════════════════════════════════
//  REVERTIR PAGO DE COMISIÓN
// ══════════════════════════════════════════
async function unpayCommission(valeId, e) {
  if (e) e.stopPropagation();

  await patchVale(valeId, {
    commissionPaid: false,
    commissionPaidTs: null
  });

  if (typeof gestoresTabDirty !== 'undefined') gestoresTabDirty = true;

  renderComisiones();
}

// ══════════════════════════════════════════
//  RENDERIZAR LISTA DE COMISIONES
// ══════════════════════════════════════════
async function renderComisiones() {
  const c = document.getElementById('adminComisionesList');
  if (!c) return;

  const gestores = await getGestores();
  if (!gestores.length) {
    c.innerHTML = '<div class="es"><div class="es-text">Sin gestores configurados</div></div>';
    return;
  }

  let html = '';

  for (const g of gestores) {
    const allVales = (await getVales()).filter(v =>
      v.gestorId === g.id &&
      ['confirmed', 'pending_payment'].includes(v.status)
    );

    const pending = allVales.filter(v => !v.commissionPaid);
    const paid = allVales.filter(v => v.commissionPaid);
    const isOpen = activeComisionGestorId === g.id;

    // Calcular total pendiente
    let gtUSD = 0, gtCUP = 0, gtAllComputed = true;
    for (const v of pending) {
      const r = getValeCommissionParts(v);
      if (r.total === null) {
        gtAllComputed = false;
      } else {
        if (r.currency === 'CUP') gtCUP += r.total;
        else gtUSD += r.total;
      }
    }

    const gtBadgeParts = [];
    if (gtUSD > 0) gtBadgeParts.push(`$${gtUSD.toFixed(2)} USD`);
    if (gtCUP > 0) gtBadgeParts.push(`${Math.round(gtCUP)} CUP`);
    const gtBadge = gtAllComputed && gtBadgeParts.length ? gtBadgeParts.join(' + ') : null;

    html += `<div class="card" style="padding:0;overflow:hidden;margin-bottom:8px;border-color:${isOpen ? 'var(--blue)' : 'var(--border)'};">`;

    // Header
    html += `<div onclick="toggleComisionGestor(${g.id})" style="display:flex;align-items:center;gap:10px;padding:12px 14px;cursor:pointer;background:${isOpen ? 'var(--blue-lt)' : 'var(--surface)'};">`;
    html += `<div class="g-avatar" style="background:${g.color};width:34px;height:34px;font-size:11px;flex-shrink:0;">${g.initials}</div>`;
    html += `<div style="flex:1;min-width:0;">
      <div style="font-weight:700;font-size:13px;">${g.name}</div>
      <div style="font-size:11px;color:var(--text-muted);margin-top:1px;">
        ${pending.length > 0 ? `<span style="color:var(--orange);font-weight:700;">${pending.length} pendiente${pending.length !== 1 ? 's' : ''}</span>` : ''}
        ${paid.length > 0 ? `<span style="color:var(--green);">· ${paid.length} pagada${paid.length !== 1 ? 's' : ''}</span>` : ''}
        ${!pending.length && !paid.length ? 'Sin comisiones por cobrar' : ''}
      </div>
    </div>`;

    if (gtBadge) {
      html += `<span style="background:var(--orange);color:white;border-radius:20px;font-size:10px;font-weight:700;padding:3px 9px;white-space:nowrap;">${gtBadge}</span>`;
    } else if (pending.length > 0) {
      html += `<span style="background:var(--orange);color:white;border-radius:20px;font-size:10px;font-weight:700;padding:3px 9px;">${pending.length}</span>`;
    }

    html += `<span style="color:var(--gray-400);font-size:13px;flex-shrink:0;">${isOpen ? '▲' : '▼'}</span>`;
    html += `</div>`;

    // Body (si está abierto)
    if (isOpen) {
      html += await renderComisionBody(g, pending, paid);
    }

    html += `</div>`;
  }

  c.innerHTML = html;
}

// ══════════════════════════════════════════
//  RENDERIZAR CUERPO DE COMISIONES (PENDIENTES / PAGADAS)
// ══════════════════════════════════════════
async function renderComisionBody(g, pending, paid) {
  let html = '<div style="border-top:1px solid var(--border);padding:12px 14px;">';

  if (!pending.length && !paid.length) {
    html += '<div class="es" style="padding:8px 0;"><div class="es-text">Sin vales confirmados con comisión</div></div>';
  } else {
    // PENDIENTES
    if (pending.length) {
      let sumUSD = 0, sumCUP = 0, canSum = true;

      for (const v of pending) {
        const r = getValeCommissionParts(v);
        if (r.total === null) {
          canSum = false;
        } else {
          if (r.currency === 'CUP') sumCUP += r.total;
          else sumUSD += r.total;
        }
      }

      const sumParts = [];
      if (sumUSD > 0) sumParts.push(`$${sumUSD.toFixed(2)} USD`);
      if (sumCUP > 0) sumParts.push(`${Math.round(sumCUP)} CUP`);

      html += `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;flex-wrap:wrap;gap:6px;">
        <span style="font-size:11px;font-weight:700;color:var(--orange);text-transform:uppercase;letter-spacing:.5px;">⏳ Por pagar (${pending.length})</span>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
          ${canSum && sumParts.length ? `<span style="font-size:13px;font-weight:800;color:var(--green);">💵 ${sumParts.join(' + ')}</span>` : ''}
          ${pending.length > 1 ? `<button class="btn btn-green btn-sm" onclick="payAllCommissions(${g.id},event)">✅ Pagar todas</button>` : ''}
        </div>
      </div>`;

      for (const v of pending) {
        const r = getValeCommissionParts(v);
        html += `<div style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:var(--surface2);border:1px solid var(--border);border-radius:9px;margin-bottom:6px;">
          <div style="flex:1;min-width:0;">
            <div style="font-size:12px;font-weight:700;color:var(--text);">${v.cliente || '—'}</div>
            <div style="font-size:10px;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${v.articulo || '—'}</div>
            <div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:4px;">
              ${r.parts.length
                ? r.parts.map(p => `<span style="background:rgba(16,185,129,.12);color:var(--green);border-radius:20px;padding:1px 8px;font-size:10px;font-weight:600;">${p.label}: ${p.com}</span>`).join('')
                : `<span style="color:var(--gray-400);font-size:10px;">Sin comisión definida</span>`}
            </div>
          </div>
          <button class="btn btn-green btn-sm" style="flex-shrink:0;" onclick="payCommission(${v.id},event)">✓ Pagar</button>
        </div>`;
      }
    }

    // PAGADAS
    if (paid.length) {
      html += `<div style="margin-top:${pending.length ? '14px' : '0'};">
        <div style="font-size:10px;font-weight:700;color:var(--green);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px;">✅ Pagadas (${paid.length})</div>`;

      for (const v of paid) {
        const r = getValeCommissionParts(v);
        const ts = v.commissionPaidTs
          ? new Date(v.commissionPaidTs).toLocaleDateString('es-ES', { day: '2-digit', month: 'short' }) + ' ' + timeStr(v.commissionPaidTs)
          : '';

        html += `<div style="display:flex;align-items:center;gap:8px;padding:6px 10px;background:rgba(16,185,129,.05);border:1px solid rgba(16,185,129,.2);border-radius:8px;margin-bottom:4px;opacity:.85;">
          <div style="flex:1;min-width:0;">
            <div style="font-size:11px;font-weight:600;color:var(--text-muted);">${v.cliente || '—'}</div>
            ${r.parts.length ? `<div style="display:flex;flex-wrap:wrap;gap:3px;margin-top:2px;">${r.parts.map(p => `<span style="background:rgba(16,185,129,.1);color:var(--green);border-radius:20px;padding:1px 7px;font-size:9px;font-weight:600;">${p.com}</span>`).join('')}</div>` : ''}
          </div>
          <div style="text-align:right;flex-shrink:0;">
            <div style="font-size:9px;color:var(--green);font-weight:700;">✓ Pagado</div>
            ${ts ? `<div style="font-size:9px;color:var(--gray-400);">${ts}</div>` : ''}
            <button style="background:none;border:none;cursor:pointer;font-size:9px;color:var(--gray-400);padding:2px 0;margin-top:2px;" onclick="unpayCommission(${v.id},event)">↩ Revertir</button>
          </div>
        </div>`;
      }
      html += '</div>';
    }
  }

  html += '</div>';
  return html;
}

// Exportar funciones
window.toggleComisionGestor = toggleComisionGestor;
window.payCommission = payCommission;
window.payAllCommissions = payAllCommissions;
window.unpayCommission = unpayCommission;
window.renderComisiones = renderComisiones;