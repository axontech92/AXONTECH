// ══════════════════════════════════════════
//  js/db.js - Capa de Datos (Compatibilidad + Futuro IndexedDB)
//  Por ahora usa localStorage para mantener compatibilidad total
// ══════════════════════════════════════════

// ══════════════════════════════════════════
//  FUNCIONES DE DATOS (usando localStorage por compatibilidad)
// ══════════════════════════════════════════

const getGestores   = () => JSON.parse(localStorage.getItem('axon_gestores')   || '[]');
const saveGestores  = v  => localStorage.setItem('axon_gestores',  JSON.stringify(v));

const getVales      = () => JSON.parse(localStorage.getItem('axon_vales')      || '[]');
const saveVales     = v  => localStorage.setItem('axon_vales',     JSON.stringify(v));

const getMensajeros = () => JSON.parse(localStorage.getItem('axon_mensajeros') || '[]');
const saveMensajeros= v  => localStorage.setItem('axon_mensajeros',JSON.stringify(v));

const getProductos  = () => JSON.parse(localStorage.getItem('axon_productos')  || '[]');
const saveProductos = v  => localStorage.setItem('axon_productos', JSON.stringify(v));

const getCategorias = () => JSON.parse(localStorage.getItem('axon_categorias') || '[]');
const saveCategorias= v  => localStorage.setItem('axon_categorias',JSON.stringify(v));

const getConfig     = () => JSON.parse(localStorage.getItem('axon_config')     || '{}');
const saveConfig    = v  => { 
  if (typeof adminActive !== 'undefined' && !adminActive) { 
    if (typeof showToast === 'function') showToast('Solo administradores'); 
    return; 
  } 
  localStorage.setItem('axon_config', JSON.stringify(v)); 
};

const getNotifs     = () => JSON.parse(localStorage.getItem('axon_notifs')     || '[]');
const saveNotifs    = v  => localStorage.setItem('axon_notifs',    JSON.stringify(v));

// ══════════════════════════════════════════
//  FUNCIONES DE PARCHEO
// ══════════════════════════════════════════

function patchVale(id, changes) {
  if (typeof adminActive !== 'undefined' && !adminActive) { 
    if (typeof showToast === 'function') showToast('Solo administradores'); 
    return; 
  }
  const all = getVales(); 
  const i = all.findIndex(v => v.id === id);
  if (i !== -1) {
    all[i] = { ...all[i], ...changes };
    saveVales(all);
  }
}

function patchProducto(id, changes) {
  if (typeof adminActive !== 'undefined' && !adminActive) { 
    if (typeof showToast === 'function') showToast('Solo administradores'); 
    return; 
  }
  const all = getProductos(); 
  const i = all.findIndex(p => p.id === id);
  if (i !== -1) {
    all[i] = { ...all[i], ...changes };
    saveProductos(all);
  }
}

// ══════════════════════════════════════════
//  FUNCIONES AUXILIARES
// ══════════════════════════════════════════

function getNextValeNum() {
  const cfg = getConfig();
  const n = (cfg.nextValeNum || 1);
  saveConfig({ ...cfg, nextValeNum: n + 1 });
  return n;
}

// ══════════════════════════════════════════
//  PREPARACIÓN PARA MIGRACIÓN FUTURA A INDEXEDDB
// ══════════════════════════════════════════

// Estas funciones están listas para cuando queramos migrar a IndexedDB
// Por ahora no hacen nada (solo placeholders)

async function initDataLayer() {
  console.log('%c[DB] Usando localStorage (modo compatibilidad)', 'color:#64748b');
  // En el futuro aquí iría: await initDB(); await migrateFromLocalStorage();
}

async function migrateFromLocalStorage() {
  console.log('%c[DB] Migración a IndexedDB pendiente', 'color:#64748b');
}

window.initDataLayer = initDataLayer;
window.migrateFromLocalStorage = migrateFromLocalStorage;