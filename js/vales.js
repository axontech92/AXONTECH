// ══════════════════════════════════════════
//  js/vales.js - Lógica de Vales
//  Extraído desde app.js
// ══════════════════════════════════════════

// ══════════════════════════════════════════
//  CREAR VALE (Gestor)
// ══════════════════════════════════════════
async function createValeFromForm() {
  if (!activeGestorId) {
    showToast('Selecciona tu nombre primero');
    return;
  }

  const REQUIRED = ['vf-cliente', 'vf-telefono', 'vf-direccion', 'vf-articulo', 'vf-total'];
  const fVal = id => (document.getElementById(id)?.value || '').trim();

  if (REQUIRED.some(id => !fVal(id))) {
    showToast('Completa los campos obligatorios (*)');
    return;
  }

  const g = (await getGestores()).find(x => x.id === activeGestorId);
  const cfg = await getConfig();

  const vale = {
    id: Date.now(),
    valeNum: getNextValeNumSync(cfg),
    gestorId: activeGestorId,
    ts: new Date().toISOString(),
    cliente: fVal('vf-cliente'),
    telefono: fVal('vf-telefono'),
    direccion: fVal('vf-direccion'),
    mensajeria: fVal('vf-mensajeria'),
    articulo: fVal('vf-articulo'),
    precioUSD: fVal('vf-precioUSD'),
    precioCUP: fVal('vf-precioCUP'),
    vuelto: fVal('vf-vuelto'),
    total: fVal('vf-total'),
    garantia: fVal('vf-garantia'),
    valeProductos: currentValeProductos || [],
    valeText: buildValeText(),
    status: 'pending',
    mensajeroId: null,
    confirmedTs: null,
    isNew: true,
    adminNotes: '',
  };

  const all = await getVales();
  all.push(vale);
  await saveVales(all);

  resetForm();
  renderGestores();
  renderMyVales();
  updateAdminBadge();

  playSound('vale');
  maybeAutoSync();

  sendBrowserNotif('AXONTECH – Nuevo vale', `${g?.name || 'Gestor'} envió un vale para ${vale.cliente}`);
  showToast('Vale enviado al administrador ✓');

  if (adminActive) {
    const _nbt = document.getElementById('notifBannerText');
    if (_nbt) _nbt.textContent = `${g?.name || 'Gestor'} acaba de enviar un vale`;
    const _nb = document.getElementById('notifBanner');
    if (_nb) _nb.classList.add('show');
    renderAdminGestores();
    renderInbox();
  }
}

// ══════════════════════════════════════════
//  ASIGNAR VALE A MENSAJERO
// ══════════════════════════════════════════
async function assignValeToMensajero(valeId, mensajeroId) {
  await patchVale(valeId, {
    status: 'assigned',
    mensajeroId: mensajeroId
  });

  const v = (await getVales()).find(x => x.id === valeId);
  const m = (await getMensajeros()).find(x => x.id === mensajeroId);

  if (v) {
    addNotif('vale_assigned', v.cliente || 'Tu cliente', null, m?.name || '', v.gestorId);
  }

  renderAdminGestores();
  renderInbox();
  renderValeDetail();
  renderMyVales();
  renderConfirmados();
  renderPendienteCobro();
  updateMensajeroBadge();

  showToast(`Asignado a ${m?.name || 'mensajero'} ✓`);
}

// ══════════════════════════════════════════
//  CONFIRMAR VENTA (Admin)
// ══════════════════════════════════════════
async function confirmSale(id, paymentStatus, skipConfirm) {
  if (!skipConfirm) {
    const v = (await getVales()).find(x => x.id === id);
    if (!v) return;

    const title = paymentStatus === 'confirmed'
      ? '¿Confirmar venta cobrada?'
      : '¿Confirmar — cobro pendiente?';
    const sub = paymentStatus === 'confirmed' ? `${v.cliente || ''} · ${v.total || ''}` : `${v.cliente || ''}`;

    showConfirmAction(
      title,
      sub,
      paymentStatus === 'confirmed' ? 'Confirmar cobrada' : 'Confirmar pendiente',
      'btn-blue',
      () => confirmSale(id, paymentStatus, true)
    );
    return;
  }

  const v = (await getVales()).find(x => x.id === id);
  if (!v) return;

  // Descontar stock + notificaciones
  for (const { id: pid, qty } of (v.valeProductos || [])) {
    const prod = productoOf ? productoOf(pid) : null;
    if (!prod) continue;

    const oldStock = prod.stock || 0;
    const newStock = Math.max(0, oldStock - qty);

    await patchProducto(pid, { stock: newStock });

    addNotif('sale_product', prod.name, pid, `${qty}|${newStock}`, v.gestorId);

    if (newStock === 0 && oldStock > 0) {
      addNotif('out_of_stock', prod.name, pid, 'stock agotado');
    } else if (newStock > 0 && newStock <= 3 && oldStock > 3) {
      addNotif('low_stock', prod.name, pid, `quedan ${newStock}`);
    }
  }

  addNotif('vale_confirmed', v.cliente || 'Cliente', null, `Total: ${v.total || ''}`, v.gestorId);

  await patchVale(id, {
    status: paymentStatus,
    confirmedTs: new Date().toISOString()
  });

  // Invalidar caches
  if (typeof gestoresTabDirty !== 'undefined') gestoresTabDirty = true;
  if (typeof statsTabDirty !== 'undefined') statsTabDirty = true;
  if (typeof rankingCache !== 'undefined') rankingCache = null;

  playSound('confirm');

  renderAdminGestores();
  renderInbox();
  renderValeDetail();
  renderMyVales();
  renderConfirmados();
  renderPendienteCobro();
  renderPendingCobroSection();
  renderMensajeroVales();
  renderProductGrid();
  renderGestorRanking();

  if (typeof currentAdminTab !== 'undefined' && currentAdminTab === 'gestores') {
    renderComisiones();
  }

  checkGoalReached(v.gestorId, id);
  maybeAutoSync();

  showToast(
    paymentStatus === 'confirmed'
      ? 'Venta confirmada y cobrada ✅'
      : 'Venta confirmada — cobro pendiente ⏳'
  );
}

// ══════════════════════════════════════════
//  MARCAR COMO PAGADO
// ══════════════════════════════════════════
async function markAsPaid(id, skipConfirm) {
  if (!skipConfirm) {
    const v = (await getVales()).find(x => x.id === id);
    if (!v) return;

    showConfirmAction(
      '¿Registrar cobro recibido?',
      `${v.cliente || ''} · ${v.total || ''}`,
      'Registrar cobro',
      'btn-green',
      () => markAsPaid(id, true)
    );
    return;
  }

  await patchVale(id, {
    status: 'confirmed',
    confirmedTs: new Date().toISOString()
  });

  if (typeof gestoresTabDirty !== 'undefined') gestoresTabDirty = true;
  if (typeof statsTabDirty !== 'undefined') statsTabDirty = true;
  if (typeof rankingCache !== 'undefined') rankingCache = null;

  renderAdminGestores();
  renderInbox();
  renderValeDetail();
  renderMyVales();
  renderConfirmados();
  renderPendienteCobro();
  renderPendingCobroSection();
  renderMensajeroVales();
  renderMensajeroSelector();
  updateMensajeroBadge();
  renderGestorRanking();

  if (typeof currentAdminTab !== 'undefined' && currentAdminTab === 'gestores') {
    renderComisiones();
  }

  const v = (await getVales()).find(x => x.id === id);
  checkGoalReached(v?.gestorId, id);
  maybeAutoSync();

  showToast('Cobro registrado ✅');
}

// ══════════════════════════════════════════
//  MARCAR ENTREGA (Mensajero)
// ══════════════════════════════════════════
async function mensajeroEntrega(id) {
  await patchVale(id, {
    status: 'delivered',
    deliveredTs: new Date().toISOString()
  });

  renderAdminGestores();
  renderInbox();
  renderValeDetail();
  renderMyVales();
  renderPendienteCobro();
  renderMensajeroVales();
  updateAdminBadge();
  updateMensajeroBadge();

  showToast('Marcado como entregado 🛵');
}

// ══════════════════════════════════════════
//  CANCELAR / ELIMINAR VALE
// ══════════════════════════════════════════
async function cancelVale(id) {
  const v = (await getVales()).find(x => x.id === id);
  if (!v || v.status !== 'pending') {
    showToast('No se puede cancelar este vale');
    return;
  }

  showConfirmAction(
    '¿Cancelar este vale?',
    `${v.cliente || ''} · ${v.articulo || ''}`,
    'Sí, cancelar',
    'btn-red',
    async () => {
      const all = (await getVales()).filter(x => x.id !== id);
      await saveVales(all);

      if (selectedValeId === id) selectedValeId = null;

      showToast('Vale cancelado');
      renderAdminGestores();
      renderInbox();
      renderValeDetail();
      renderMyVales();
      maybeAutoSync();
    }
  );
}

async function adminDeleteVale(id) {
  const v = (await getVales()).find(x => x.id === id);
  if (!v) return;

  showConfirmAction(
    '¿Eliminar este vale?',
    `${v.cliente || ''} · ${v.articulo || ''}`,
    'Eliminar',
    'btn-red',
    async () => {
      const all = (await getVales()).filter(x => x.id !== id);
      await saveVales(all);

      if (selectedValeId === id) selectedValeId = null;

      showToast('Vale eliminado');
      renderAdminGestores();
      renderInbox();
      renderValeDetail();
      renderMyVales();
      maybeAutoSync();
    }
  );
}

// Exportar funciones principales
window.createValeFromForm = createValeFromForm;
window.assignValeToMensajero = assignValeToMensajero;
window.confirmSale = confirmSale;
window.markAsPaid = markAsPaid;
window.mensajeroEntrega = mensajeroEntrega;
window.cancelVale = cancelVale;
window.adminDeleteVale = adminDeleteVale;