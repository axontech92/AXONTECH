// ══════════════════════════════════════════
//  PAGE CONTEXT
// ══════════════════════════════════════════
const IS_ADMIN = document.body.dataset.page === 'admin';

// ══════════════════════════════════════════
//  DATA LAYER → ahora viene de js/db.js
// ══════════════════════════════════════════
// Las funciones getGestores, saveVales, patchProducto, etc.
// se definen en js/db.js (cargado antes que app.js)

// Solo mantenemos funciones que aún no están en db.js
function valeNumStr(v) {
  return v.valeNum ? 'V-' + String(v.valeNum).padStart(3,'0') : '';
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
