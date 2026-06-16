// ══════════════════════════════════════════
//  js/core.js - Lógica de Negocio Central (AXONTECH)
//  Aquí viven las reglas del negocio, no la UI
// ══════════════════════════════════════════

// ══════════════════════════════════════════
//  HELPERS DE NEGOCIO
// ══════════════════════════════════════════

const pendingCount = async () => {
  const vales = await getVales();
  return vales.filter(v => v.status === 'pending').length;
};

const pendingOf = async (gId) => {
  const vales = await getVales();
  return vales.filter(v => v.gestorId === gId && v.status === 'pending').length;
};

const todayValesOf = async (gId) => {
  const vales = await getVales();
  const today = new Date().toDateString();
  return vales.filter(v => v.gestorId === gId && new Date(v.ts).toDateString() === today);
};

// ══════════════════════════════════════════
//  CREACIÓN Y GESTIÓN DE VALES
// ══════════════════════════════════════════

async function createVale(gestorId, productos, cliente = '', notes = '') {
  const cfg = await getConfig();
  const valeNum = getNextValeNumSync(cfg); // Necesitamos ajustar esto

  const vale = {
    id: Date.now(),
    valeNum,
    gestorId,
    productos: productos.map(p => ({ ...p })),
    cliente: cliente.trim(),
    notes: notes.trim(),
    status: 'pending',
    ts: new Date().toISOString(),
    total: productos.reduce((sum, p) => sum + (p.price * p.qty), 0)
  };

  const allVales = await getVales();
  allVales.unshift(vale);
  await saveVales(allVales);

  return vale;
}

// Nota: getNextValeNum necesita ser adaptado porque usa saveConfig
function getNextValeNumSync(cfg) {
  const n = cfg.nextValeNum || 1;
  const newCfg = { ...cfg, nextValeNum: n + 1 };
  // Guardamos de forma asíncrona (el caller debe manejar el await)
  saveConfig(newCfg).catch(console.error);
  return n;
}

async function assignValeToMensajero(valeId, mensajeroId) {
  await patchVale(valeId, {
    mensajeroId,
    status: 'assigned',
    assignedAt: new Date().toISOString()
  });
}

async function confirmSale(valeId, finalTotal = null) {
  const vale = await getById('vales', valeId);
  if (!vale) return null;

  const update = {
    status: 'confirmed',
    confirmedAt: new Date().toISOString()
  };

  if (finalTotal !== null) {
    update.total = finalTotal;
  }

  await patchVale(valeId, update);

  // Descontar stock
  for (const item of vale.productos) {
    await patchProducto(item.id, {
      stock: Math.max(0, (item.stock || 0) - item.qty)
    });
  }

  return update;
}

// ══════════════════════════════════════════
//  PRODUCTOS Y STOCK
// ══════════════════════════════════════════

async function updateProductStock(productId, newStock) {
  await patchProducto(productId, { stock: Math.max(0, newStock) });
}

async function addProduct(product) {
  const productos = await getProductos();
  product.id = Date.now();
  productos.push(product);
  await saveProductos(productos);
  return product;
}

// ══════════════════════════════════════════
//  COMISIONES Y PUNTOS (ejemplo)
// ══════════════════════════════════════════

async function calculateCommission(vale) {
  // Lógica de comisión (puedes personalizarla)
  const cfg = await getConfig();
  const rate = cfg.commissionRate || 0.10; // 10% por defecto
  return Math.round(vale.total * rate);
}

// ══════════════════════════════════════════
//  RANKING
// ══════════════════════════════════════════

async function getRanking() {
  const gestores = await getGestores();
  const vales = await getVales();

  const ranking = gestores.map(g => {
    const gestorVales = vales.filter(v => v.gestorId === g.id && v.status === 'confirmed');
    const points = gestorVales.reduce((sum, v) => sum + (v.total || 0), 0);
    return { ...g, points };
  });

  return ranking.sort((a, b) => b.points - a.points);
}

// Exportar funciones importantes
window.createVale = createVale;
window.assignValeToMensajero = assignValeToMensajero;
window.confirmSale = confirmSale;
window.getRanking = getRanking;