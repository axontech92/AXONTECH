// ══════════════════════════════════════════
//  js/productos.js - Gestión de Productos y Stock
//  Extraído desde app.js
// ══════════════════════════════════════════

// ══════════════════════════════════════════
//  RENDERIZAR GRID DE PRODUCTOS (Admin)
// ══════════════════════════════════════════
async function renderProductGrid() {
  let prods = await getProductos();
  if (stockCatFilter !== null) {
    prods = prods.filter(p => p.catId === stockCatFilter);
  }

  const cats = await getCategorias();
  const c = document.getElementById('productGrid');
  if (!c) return;

  if (!prods.length) {
    c.innerHTML = '<div class="es"><div class="es-icon">📦</div><div class="es-text">Sin productos. Haz clic en "+ Nuevo producto".</div></div>';
    return;
  }

  const activos = prods.filter(p => (p.stock || 0) > 0);
  const agotados = prods.filter(p => (p.stock || 0) === 0);

  const grid = s => `<div style="display:flex;flex-direction:column;gap:8px;">${s}</div>`;
  let html = '';

  if (activos.length) {
    html += `<div class="stock-section-header">En stock <span style="background:var(--gray-100);border-radius:20px;font-size:9px;padding:2px 7px;">${activos.length}</span></div>`;
    html += grid(activos.map(p => buildProdCard(p, cats, false)).join(''));
  }
  if (agotados.length) {
    html += `<div class="stock-section-header">Agotados <span class="agotado-badge">${agotados.length}</span></div>`;
    html += grid(agotados.map(p => buildProdCard(p, cats, true)).join(''));
  }

  c.innerHTML = html;
}

// ══════════════════════════════════════════
//  CONSTRUIR TARJETA DE PRODUCTO
// ══════════════════════════════════════════
function buildProdCard(p, cats, isAgotado) {
  const cat = cats.find(c => c.id === p.catId);
  const stockOk = (p.stock || 0) > 0;
  const isLow = stockOk && (p.stock || 0) <= 3;
  const stockColor = isAgotado ? 'var(--red)' : isLow ? 'var(--yellow)' : 'var(--green)';

  return `<div class="prod-card${isAgotado ? ' agotado' : ''}" style="display:flex;align-items:center;gap:10px;padding:10px 12px;">
    <div style="width:52px;height:52px;border-radius:8px;overflow:hidden;background:var(--gray-100);display:flex;align-items:center;justify-content:center;flex-shrink:0;">
      ${p.photo
        ? `<img src="${p.photo}" alt="" style="width:100%;height:100%;object-fit:cover;" onerror="this.parentElement.innerHTML='<span style=font-size:22px>📦</span>'">`
        : `<span style="font-size:22px;">📦</span>`}
    </div>
    <div style="flex:1;min-width:0;">
      <div style="display:flex;align-items:baseline;gap:5px;flex-wrap:wrap;">
        <span class="prod-name" style="margin:0;font-size:13px;">${p.name}</span>
        ${cat ? `<span class="prod-cat-tag" style="font-size:9px;">${cat.name}</span>` : ''}
      </div>
      <div style="display:flex;align-items:center;gap:8px;margin-top:2px;flex-wrap:wrap;">
        ${p.precio ? `<span class="prod-price" style="margin:0;font-size:11px;">${p.precio}</span>` : ''}
        ${p.comision ? `<span style="font-size:10px;color:var(--green);font-weight:600;">💰 ${p.comision}</span>` : ''}
        ${p.garantia ? `<span style="font-size:10px;color:var(--gray-400);">🛡️ ${p.garantia}</span>` : ''}
      </div>
    </div>
    <div style="flex-shrink:0;display:flex;flex-direction:column;align-items:flex-end;gap:5px;">
      <span style="font-size:11px;font-weight:700;color:${stockColor};">Stock: ${p.stock || 0}</span>
      <div style="display:flex;gap:4px;">
        ${isAgotado
          ? `<button class="btn btn-green btn-sm" onclick="adjustStock(${p.id})" style="font-size:10px;padding:3px 7px;">📥 Reponer</button>`
          : `<button class="btn btn-ghost btn-sm" onclick="openEditProductModal(${p.id})" style="font-size:10px;padding:3px 7px;">✏️</button>
             <button class="btn btn-ghost btn-sm" onclick="adjustStock(${p.id})" style="font-size:10px;padding:3px 7px;">📥</button>`}
        <button class="btn btn-ghost btn-sm" style="color:var(--red);font-size:10px;padding:3px 7px;" onclick="removeProducto(${p.id})">🗑️</button>
      </div>
    </div>
  </div>`;
}

// ══════════════════════════════════════════
//  MODAL DE PRODUCTO
// ══════════════════════════════════════════
async function openAddProductModal() {
  editingProductId = null;
  document.getElementById('productModalTitle').textContent = '📦 Nuevo Producto';

  ['pm-name', 'pm-desc', 'pm-precio', 'pm-foto', 'pm-garantia', 'pm-comision'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });

  document.getElementById('pm-comision-amount').value = '';
  document.getElementById('pm-comision-currency').value = 'USD';
  document.getElementById('pm-stock').value = '0';
  document.getElementById('pm-puntos').value = '0';
  document.getElementById('pm-foto-file').value = '';
  document.getElementById('pm-fotoPreview').innerHTML = '';

  await populateCatSelect(null);
  document.getElementById('productModal').classList.add('show');
}

async function openEditProductModal(id) {
  const p = await getById('productos', id);
  if (!p) return;

  editingProductId = id;
  document.getElementById('productModalTitle').textContent = '✏️ Editar Producto';

  document.getElementById('pm-name').value = p.name || '';
  document.getElementById('pm-desc').value = p.description || '';
  document.getElementById('pm-precio').value = p.precio || '';
  document.getElementById('pm-stock').value = p.stock || 0;
  document.getElementById('pm-puntos').value = p.puntos || 0;
  document.getElementById('pm-garantia').value = p.garantia || '';
  document.getElementById('pm-comision').value = p.comision || '';

  // Parse comisión
  const com = p.comision || '';
  const isCUP = com.toUpperCase().includes('CUP');
  const num = parseFloat(com.replace(/[^0-9.]/g, '')) || '';
  document.getElementById('pm-comision-amount').value = num;
  document.getElementById('pm-comision-currency').value = isCUP ? 'CUP' : 'USD';

  document.getElementById('pm-foto').value = p.photo || '';
  document.getElementById('pm-foto-file').value = '';

  await populateCatSelect(p.catId);

  document.getElementById('pm-fotoPreview').innerHTML = p.photo
    ? `<img src="${p.photo}" style="width:100%;height:80px;object-fit:cover;border-radius:6px;" onerror="this.style.display='none'">`
    : '';

  document.getElementById('productModal').classList.add('show');
}

async function populateCatSelect(selectedId) {
  const cats = await getCategorias();
  const select = document.getElementById('pm-cat');
  if (!select) return;

  select.innerHTML = `<option value="">Sin categoría</option>` +
    cats.map(c => `<option value="${c.id}" ${c.id === selectedId ? 'selected' : ''}>${c.name}</option>`).join('');
}

// ══════════════════════════════════════════
//  GUARDAR / ELIMINAR PRODUCTO
// ══════════════════════════════════════════
async function saveProduct() {
  const name = document.getElementById('pm-name').value.trim();
  if (!name) {
    showToast('El nombre es obligatorio');
    return;
  }

  const catVal = document.getElementById('pm-cat').value;
  const amt = parseFloat(document.getElementById('pm-comision-amount').value);
  const cur = document.getElementById('pm-comision-currency').value;

  const prod = {
    name,
    description: document.getElementById('pm-desc').value.trim(),
    precio: document.getElementById('pm-precio').value.trim(),
    stock: parseInt(document.getElementById('pm-stock').value) || 0,
    puntos: parseInt(document.getElementById('pm-puntos').value) || 0,
    garantia: document.getElementById('pm-garantia').value.trim(),
    comision: amt > 0 ? (cur === 'CUP' ? `${amt} CUP` : `$${amt} USD`) : '',
    photo: document.getElementById('pm-foto').value.trim(),
    catId: catVal ? parseInt(catVal) : null,
  };

  if (editingProductId) {
    const old = await getById('productos', editingProductId);
    await patchProducto(editingProductId, prod);

    if (old && old.stock === 0 && prod.stock > 0) {
      addNotif('restocked', prod.name, editingProductId, `stock: ${prod.stock}`);
    }
    showToast('Producto actualizado ✓');
  } else {
    const newId = Date.now();
    const list = await getProductos();
    list.push({ id: newId, ...prod });
    await saveProductos(list);
    addNotif('new_product', prod.name, newId, prod.precio || '');
    showToast('Producto agregado ✓');
  }

  document.getElementById('productModal').classList.remove('show');
  editingProductId = null;

  renderProductGrid();
  renderStockCategorias();
  maybeAutoSync();
}

async function removeProducto(id) {
  if (!confirm('¿Eliminar este producto?')) return;

  const all = (await getProductos()).filter(p => p.id !== id);
  await saveProductos(all);

  renderProductGrid();
  renderStockCategorias();
  showToast('Producto eliminado');
  maybeAutoSync();
}

// ══════════════════════════════════════════
//  AJUSTAR STOCK
// ══════════════════════════════════════════
async function adjustStock(id) {
  const p = await getById('productos', id);
  if (!p) return;

  const n = prompt(`Stock actual: ${p.stock || 0}\nNuevo stock:`, p.stock || 0);
  if (n === null) return;

  const num = parseInt(n);
  if (isNaN(num) || num < 0) {
    showToast('Número inválido');
    return;
  }

  const oldStock = p.stock || 0;
  await patchProducto(id, { stock: num });

  if (oldStock === 0 && num > 0) {
    addNotif('restocked', p.name, id, `stock: ${num}`);
  } else if (num === 0 && oldStock > 0) {
    addNotif('out_of_stock', p.name, id, 'stock agotado');
  } else if (num > 0 && num <= 3 && oldStock > 3) {
    addNotif('low_stock', p.name, id, `quedan ${num}`);
  }

  maybeAutoSync();
  renderProductGrid();
  showToast('Stock actualizado ✓');
}

// ══════════════════════════════════════════
//  CATEGORÍAS
// ══════════════════════════════════════════
async function addCategoria() {
  const inp = document.getElementById('newCatInput');
  const name = inp.value.trim();
  if (!name) return;

  const list = await getCategorias();
  if (list.some(c => c.name.toLowerCase() === name.toLowerCase())) {
    showToast('Ya existe');
    return;
  }

  list.push({ id: Date.now(), name });
  await saveCategorias(list);
  inp.value = '';

  renderStockCategorias();
  showToast('Categoría agregada');
}

async function removeCategoria(id) {
  const prods = await getProductos();
  if (prods.some(p => p.catId === id)) {
    showToast('Primero mueve o elimina los productos de esta categoría');
    return;
  }

  if (!confirm('¿Eliminar esta categoría?')) return;

  const cats = (await getCategorias()).filter(c => c.id !== id);
  await saveCategorias(cats);

  if (stockCatFilter === id) stockCatFilter = null;

  renderStockCategorias();
  renderProductGrid();
  showToast('Categoría eliminada');
}

// Exportar funciones
window.renderProductGrid = renderProductGrid;
window.openAddProductModal = openAddProductModal;
window.openEditProductModal = openEditProductModal;
window.saveProduct = saveProduct;
window.removeProducto = removeProducto;
window.adjustStock = adjustStock;
window.addCategoria = addCategoria;
window.removeCategoria = removeCategoria;