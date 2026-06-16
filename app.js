// ══════════════════════════════════════════
//  PAGE CONTEXT
// ══════════════════════════════════════════
const IS_ADMIN = document.body.dataset.page === 'admin';

// ══════════════════════════════════════════
//  DATA LAYER
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
const saveConfig    = v  => localStorage.setItem('axon_config',    JSON.stringify(v));
const getNotifs     = () => JSON.parse(localStorage.getItem('axon_notifs')     || '[]');
const saveNotifs    = v  => localStorage.setItem('axon_notifs',    JSON.stringify(v));

function patchVale(id, changes) {
  const all = getVales(); const i = all.findIndex(v=>v.id===id);
  if (i!==-1){all[i]={...all[i],...changes};saveVales(all);}
}
function getNextValeNum() {
  const cfg = getConfig();
  const n = (cfg.nextValeNum || 1);
  saveConfig({...cfg, nextValeNum: n + 1});
  return n;
}
function valeNumStr(v) {
  return v.valeNum ? 'V-' + String(v.valeNum).padStart(3,'0') : '';
}
function patchProducto(id, changes) {
  const all = getProductos(); const i = all.findIndex(p=>p.id===id);
  if (i!==-1){all[i]={...all[i],...changes};saveProductos(all);}
}

// ══════════════════════════════════════════
//  NOTIFICATIONS (gestor)
// ══════════════════════════════════════════
const LOW_STOCK_THRESHOLD = 3;

function addNotif(type, productName, productId, extra, gestorId) {
  const notifs = getNotifs();
  notifs.unshift({ id:Date.now(), type, productName, productId, ts:new Date().toISOString(), read:false, extra:extra||'', gestorId:gestorId||null });
  if (notifs.length > 50) notifs.splice(50);
  saveNotifs(notifs);
  renderGestorNotifs();
}

function renderGestorNotifs() {
  const notifs = getNotifs();
  const cutoff = Date.now() - 72*60*60*1000;
  const recent = notifs.filter(n => {
    if(new Date(n.ts).getTime() <= cutoff) return false;
    if(['vale_confirmed','sale_product','vale_assigned'].includes(n.type) && n.gestorId && activeGestorId && n.gestorId !== activeGestorId) return false;
    return true;
  });
  const sec = document.getElementById('gestorNotifsSection');
  if(!sec) return;
  if(!recent.length){sec.style.display='none';return;}
  sec.style.display='block';
  const unread = recent.filter(n=>!n.read).length;
  const badge = document.getElementById('notifUnreadBadge');
  if(badge){badge.textContent=unread;badge.style.display=unread?'inline-block':'none';}
  const icons = {new_product:'✨',out_of_stock:'❌',low_stock:'⚠️',restocked:'✅',vale_confirmed:'🎉',sale_product:'🛒',vale_assigned:'🛵'};
  document.getElementById('gestorNotifsList').innerHTML = recent.map(n=>{
    const icon=icons[n.type]||'📢';
    const age=timeAgo(n.ts);
    const typeClass=n.type==='out_of_stock'?'agotado':n.type==='low_stock'?'low':n.type==='restocked'?'restocked':['vale_confirmed','sale_product','vale_assigned'].includes(n.type)?'ok':'';
    const cls=!n.read?'unread':`type-${typeClass}`;
    // Build human-readable message per type
    let msg='';
    if(n.type==='sale_product'){
      const parts=(n.extra||'').split('|');
      const qty=parseInt(parts[0])||1;
