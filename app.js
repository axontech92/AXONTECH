// ══════════════════════════════════════════
//  PAGE CONTEXT
// ══════════════════════════════════════════
const IS_ADMIN = document.body.dataset.page === 'admin';

// ══════════════════════════════════════════
//  DATA LAYER → ahora viene de js/db.js (IndexedDB)
// ══════════════════════════════════════════

// Las funciones getGestores, saveGestores, getVales, etc.
// ahora vienen del módulo js/db.js (IndexedDB)

// Funciones de compatibilidad que aún usan localStorage directo
// (se pueden migrar más adelante)
function getNextValeNum() {
  const cfg = getConfig();
  const n = (cfg.nextValeNum || 1);
  saveConfig({...cfg, nextValeNum: n + 1});
  return n;
}
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
      const left=parseInt(parts[1]);
      msg=`<b>Se vendió${qty>1?` <span style="color:var(--blue);font-weight:800;">${qty}</span>`:''}</b> ${n.productName}${!isNaN(left)?` — quedan <b style="color:${left===0?'var(--red)':left<=LOW_STOCK_THRESHOLD?'var(--yellow)':'var(--green)'};">${left}</b>`:''}`;
    } else if(n.type==='vale_assigned'){
      msg=`🛵 Tu venta está con el mensajero`;
    } else if(n.type==='vale_confirmed'){
      msg=`<b>¡Venta completada! ✅</b> · ${n.productName}${n.extra?` <span style="color:var(--gray-400);font-size:10px;">(${n.extra})</span>`:''}`;
    } else if(n.type==='out_of_stock'){
      msg=`<b>Agotado:</b> ${n.productName}`;
    } else if(n.type==='low_stock'){
      msg=`<b>Stock bajo:</b> ${n.productName} <span style="color:var(--yellow);">(${n.extra})</span>`;
    } else if(n.type==='restocked'){
      msg=`<b>Repuesto:</b> ${n.productName} <span style="color:var(--green);">(${n.extra})</span>`;
    } else if(n.type==='new_product'){
      msg=`<b>Nuevo producto:</b> ${n.productName}${n.extra?` · ${n.extra}`:''}`;
    } else {
      msg=`${n.productName}${n.extra?` (${n.extra})`:''}`;
    }
    return `<div class="gnotif-item ${cls}" onclick="markNotifRead(${n.id})">
      <span class="gnotif-icon">${icon}</span>
      <div class="gnotif-text" style="line-height:1.5;">${msg}</div>
      <span class="gnotif-time">${age}</span>
    </div>`;
  }).join('');
}

function markNotifRead(id) {
  const notifs = getNotifs();
  const n = notifs.find(x=>x.id===id);
  if (n) { n.read=true; saveNotifs(notifs); renderGestorNotifs(); }
}

function clearGestorNotifs() {
  saveNotifs([]); renderGestorNotifs();
}

function timeAgo(ts) {
  const diff = Date.now() - new Date(ts).getTime();
  const m = Math.floor(diff/60000);
  if (m < 1) return 'ahora';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m/60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h/24)}d`;
}

// ══════════════════════════════════════════
//  STATE
// ══════════════════════════════════════════
let activeGestorId    = null;
let activeMensajeroId = null;
let adminActive       = false;
let selectedValeId    = null;
let inboxFilter       = 'all';
let adminGestorFilter = null;
let shareTargetId     = null;
let currentAdminTab   = 'vales';
let stockCatFilter    = null;
let editingProductId  = null;
let pickerSelected    = {};   // {productId: qty}
let pickerCatFilter   = null;
let catalogCatFilter  = null;
let expandedCatalogId = null;
let selectedProductsUI= [];   // [{id,name,qty}] for current vale form
let currentValeProductos = []; // saved on sendVale
let pendingGestorId      = null;  // for gestor pass modal
let activeComisionGestorId = null; // for commissions panel
// Lazy loading flags
let gestoresTabDirty = true;
let statsTabDirty    = true;
// Ranking cache
let rankingCache = null; // {data: [...], ts: 0}
// Confirm action callback
let confirmActionCb  = null;

// ══════════════════════════════════════════
//  HELPERS
// ══════════════════════════════════════════
const GESTOR_COLORS = ['#2563EB','#7C3AED','#059669','#DC2626','#D97706','#0891B2','#BE185D','#1D4ED8'];
const gestorOf    = id => getGestores().find(g=>g.id===id);
const mensajeroOf = id => getMensajeros().find(m=>m.id===id);
const productoOf  = id => getProductos().find(p=>p.id===id);
const todayStr    = () => new Date().toDateString();
const timeStr     = ts => new Date(ts).toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit'});
const nowDateTime = () => new Date().toLocaleDateString('es-ES')+' '+new Date().toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit'});
const pendingCount= () => getVales().filter(v=>v.status==='pending').length;
const pendingOf   = gId=> getVales().filter(v=>v.gestorId===gId&&v.status==='pending').length;
const todayValesOf= gId=> getVales().filter(v=>v.gestorId===gId&&new Date(v.ts).toDateString()===todayStr());

// ══════════════════════════════════════════
//  AUTH
// ══════════════════════════════════════════
// ══════════════════════════════════════════
//  SECURE PASSWORD HASHING (SHA-256)
// ══════════════════════════════════════════
async function hashPassword(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password + 'axon_salt_2024');
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

async function checkPass(input) {
  const storedHash = localStorage.getItem('axon_admin_hash');
  const defaultHash = await hashPassword('axon2024');
  
  if (!storedHash) {
    localStorage.setItem('axon_admin_hash', defaultHash);
    return input === 'axon2024';
  }
  
  const inputHash = await hashPassword(input);
  return inputHash === storedHash;
}

async function changePass() {
  const np = document.getElementById('newPassInput').value.trim();
  if (!np || np.length < 4) {
    showToast('Mínimo 4 caracteres');
    return;
  }
  const newHash = await hashPassword(np);
  localStorage.setItem('axon_admin_hash', newHash);
  document.getElementById('newPassInput').value = '';
  showToast('Contraseña actualizada ✓');
}

// ══════════════════════════════════════════
//  SOUND
// ══════════════════════════════════════════
function playSound(type) {
  try {
    const ac=new(window.AudioContext||window.webkitAudioContext)();
    const g=ac.createGain();g.connect(ac.destination);
    g.gain.setValueAtTime(0.08,ac.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001,ac.currentTime+0.8);
    const tones={login:[[880,0],[1100,.15]],vale:[[660,0],[800,.18]],confirm:[[440,0],[660,.15],[880,.3]]};
    (tones[type]||[]).forEach(([f,d])=>{const o=ac.createOscillator();o.connect(g);o.frequency.value=f;o.start(ac.currentTime+d);o.stop(ac.currentTime+d+.18);});
  } catch(e){}
}

// ══════════════════════════════════════════
//  TOAST
// ══════════════════════════════════════════
let _tt;
function showToast(msg) {
  const t=document.getElementById('toast');
  if(!t)return;
  t.textContent=msg;t.classList.add('show');
  clearTimeout(_tt);_tt=setTimeout(()=>t.classList.remove('show'),2800);
}

// ══════════════════════════════════════════
//  DATE / NOTIFICATIONS
// ══════════════════════════════════════════
function updateDate() {
  const hd=document.getElementById('headerDate');
  if(hd)hd.textContent=new Date().toLocaleDateString('es-ES',{weekday:'short',day:'numeric',month:'short'});
  const fEl=document.getElementById('vf-fecha');
  if(fEl)fEl.value=nowDateTime();
}
function requestNotifPermission() {
  if('Notification'in window&&Notification.permission==='default')Notification.requestPermission();
}
function sendBrowserNotif(title,body) {
  if('Notification'in window&&Notification.permission==='granted'){
    new Notification(title,{body});
  }
}

// ══════════════════════════════════════════
//  MODE
// ══════════════════════════════════════════
function switchMode(mode) {
  if (mode === 'admin') {
    if (IS_ADMIN) return; // already on admin page
    if (!adminActive) { openPassModal(); return; }
    activateAdminMode();
    return;
  }
  // gestor mode
  if (IS_ADMIN) { window.location.href = './index.html'; return; }
  const lg = document.getElementById('layoutGestor');
  const la = document.getElementById('layoutAdmin');
  if (lg && la) { [lg, la].forEach(el => el.classList.remove('active')); lg.classList.add('active'); }
  const ba = document.getElementById('btnAdminAccess'); if (ba) ba.style.display = 'flex';
  const bc = document.getElementById('btnCatalogo'); if (bc) bc.style.display = 'inline-flex';
}
function activateAdminMode() {
  const la = document.getElementById('layoutAdmin');
  if (la) la.classList.add('active');
  if (!IS_ADMIN) {
    const lg = document.getElementById('layoutGestor');
    if (lg) lg.classList.remove('active');
    const ba = document.getElementById('btnAdminAccess'); if (ba) ba.style.display = 'none';
    const bc = document.getElementById('btnCatalogo'); if (bc) bc.style.display = 'none';
  }
  const al = document.getElementById('adminLabel'); if (al) al.style.display = 'flex';
  const bl = document.getElementById('btnLogout'); if (bl) bl.style.display = 'inline-flex';
  const cfg = getConfig();
  const ph = document.getElementById('adminPhoneInput'); if (ph && cfg.adminPhone) ph.value = cfg.adminPhone;
  const today = new Date().toISOString().slice(0, 10);
  const sf = document.getElementById('statsDateFrom'); if (sf) sf.value = today;
  const st = document.getElementById('statsDateTo'); if (st) st.value = today;
  const hist7 = new Date(Date.now()-7*24*60*60*1000).toISOString().slice(0, 10);
  const histFrom = document.getElementById('histDateFrom'); if (histFrom) histFrom.value = hist7;
  const histTo = document.getElementById('histDateTo'); if (histTo) histTo.value = today;
  adminTab('vales');
  updateAdminBadge();
}
function logoutAdmin() {
  adminActive = false;
  showToast('Sesión admin cerrada');
  if (IS_ADMIN) { window.location.href = './index.html'; return; }
  const al = document.getElementById('adminLabel'); if (al) al.style.display = 'none';
  const bl = document.getElementById('btnLogout'); if (bl) bl.style.display = 'none';
  switchMode('gestor');
}

// ══════════════════════════════════════════
//  ADMIN TABS
// ══════════════════════════════════════════
function adminTab(tab) {
  currentAdminTab=tab;
  ['vales','stock','gestores','stats','mensajeros','config','historial'].forEach(t=>{
    const btn=document.getElementById('anav-'+t);if(btn)btn.classList.toggle('active',t===tab);
    const pid='admin'+t.charAt(0).toUpperCase()+t.slice(1)+'Panel';
    const el=document.getElementById(pid);
    if(el){el.style.display=t===tab?(t==='vales'?'grid':'block'):'none';}
  });
  if(tab==='vales'){renderAdminGestores();renderInbox();renderMensajeros();renderConfirmados();renderPendienteCobro();}
  if(tab==='stock'){renderStockCategorias();renderProductGrid();}
  if(tab==='gestores'&&gestoresTabDirty){renderAdminGestoresList();renderComisiones();gestoresTabDirty=false;}
  if(tab==='stats'&&statsTabDirty){renderStats();statsTabDirty=false;}
  if(tab==='mensajeros'){renderMensajeroSelector();renderPendingCobroSection();renderMensajeroVales();}
  if(tab==='config'){loadGhConfigUI();}
  if(tab==='historial'){renderHistorial();}
}

// ══════════════════════════════════════════
//  BADGE
// ══════════════════════════════════════════
function updateAdminBadge() {
  const n=pendingCount();
  const b=document.getElementById('adminBadge');
  const ib=document.getElementById('inboxCountBadge');
  if(n>0){if(b){b.textContent=n;b.classList.add('show');}if(ib){ib.textContent=n;ib.style.display='inline-block';}}
  else{if(b)b.classList.remove('show');if(ib)ib.style.display='none';}
}

// ══════════════════════════════════════════
//  PASSWORD MODAL
// ══════════════════════════════════════════
function openPassModal() {
  document.getElementById('passInput').value='';
  document.getElementById('passError').style.display='none';
  document.getElementById('passModal').classList.add('show');
  setTimeout(()=>document.getElementById('passInput').focus(),100);
}
function closePassModal() {
  document.getElementById('passModal').classList.remove('show');
  if (IS_ADMIN && !adminActive) { window.location.href = './index.html'; }
}
function submitPass() {
  const val=document.getElementById('passInput').value;
  if(checkPass(val)){
    adminActive=true;closePassModal();
    const al=document.getElementById('adminLabel'); if(al) al.style.display='flex';
    const bl=document.getElementById('btnLogout'); if(bl) bl.style.display='inline-flex';
    playSound('login');requestNotifPermission();
    activateAdminMode();showToast('Bienvenido, Admin ✓');
  } else {
    document.getElementById('passError').style.display='block';
    document.getElementById('passInput').select();
  }
}

// ══════════════════════════════════════════
//  GESTOR SELECTOR
// ══════════════════════════════════════════
function renderGestores() {
  const gestores=getGestores();
  const c=document.getElementById('gestoresList');
  if(!gestores.length){c.innerHTML='<div class="es"><div class="es-icon">👤</div><div class="es-text">El admin aún no ha configurado gestores</div></div>';return;}
  c.innerHTML=gestores.map(g=>{
    const act=g.id===activeGestorId;
    return `<div class="g-item ${act?'active':''}" onclick="selectGestor(${g.id})">
      <div class="g-avatar" style="background:${g.color}">${g.initials}</div>
      <div class="g-name">${g.name}</div>
      ${act?'<span class="g-badge">✓</span>':''}
    </div>`;
  }).join('');
}
function selectGestor(id) {
  const g=gestorOf(id);if(!g)return;
  if(g.password){
    pendingGestorId=id;
    document.getElementById('gestorPassInput').value='';
    document.getElementById('gestorPassError').style.display='none';
    document.getElementById('gestorPassModalSub').textContent=`${g.name} — ingresa tu contraseña`;
    document.getElementById('gestorPassModal').classList.add('show');
    setTimeout(()=>document.getElementById('gestorPassInput').focus(),100);
  } else {
    doSelectGestor(id);
  }
}
function doSelectGestor(id) {
  activeGestorId=id;const g=gestorOf(id);
  document.getElementById('bannerAvatar').textContent=g.initials;
  document.getElementById('bannerAvatar').style.background=g.color;
  document.getElementById('bannerLbl').textContent='HOLA, ESTÁS EN TU ÁREA';
  document.getElementById('bannerName').textContent=g.name;
  document.getElementById('headerGestorName').textContent='· '+g.name;
  document.getElementById('vf-promotor').value=g.name;
  document.getElementById('mobileBackName').textContent=g.name;
  document.getElementById('gestorBanner').style.display='flex';
  document.getElementById('gestorMyValesSection').style.display='block';
  document.getElementById('layoutGestor').classList.add('has-gestor');
  renderGestores();renderMyVales();onFormInput();renderGestorNotifs();
}
function closeGestorPassModal(){
  document.getElementById('gestorPassModal').classList.remove('show');
  pendingGestorId=null;
}
function submitGestorPass() {
  const val=document.getElementById('gestorPassInput').value;
  const g=gestorOf(pendingGestorId);if(!g)return;
  if(val===g.password){
    const id=pendingGestorId;   // save before closeGestorPassModal sets it to null
    closeGestorPassModal();
    doSelectGestor(id);
  } else {
    document.getElementById('gestorPassError').style.display='block';
    document.getElementById('gestorPassInput').select();
  }
}
function changeGestor() {
  activeGestorId=null;
  document.getElementById('layoutGestor').classList.remove('has-gestor');
  document.getElementById('gestorBanner').style.display='none';
  document.getElementById('gestorMyValesSection').style.display='none';
  document.getElementById('headerGestorName').textContent='';
  document.getElementById('vf-promotor').value='';
  document.getElementById('mobileBackName').textContent='';
  renderGestores();renderMyVales();onFormInput();renderGestorNotifs();
}

// ══════════════════════════════════════════
//  MENSAJERO PANEL
// ══════════════════════════════════════════
function renderMensajeroSelector() {
  const list=getMensajeros();
  const c=document.getElementById('mensajeroSelectorList');if(!c)return;
  if(!list.length){c.innerHTML='<div style="color:var(--gray-400);font-size:12px;padding:4px 0;">Sin mensajeros registrados</div>';return;}
  const vales=getVales();
  c.innerHTML=list.map((m,idx)=>{
    const act=m.id===activeMensajeroId;
    const ini=m.name.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2);
    const assigned=vales.filter(v=>v.mensajeroId===m.id&&v.status==='assigned').length;
    const pend=vales.filter(v=>v.mensajeroId===m.id&&v.status==='pending_payment').length;
    const active=assigned+pend;
    const dotColor=pend>0?'var(--orange)':'var(--blue)';
    const badgeBg=pend>0?'var(--orange)':'var(--blue)';
    const col=GESTOR_COLORS[(idx+4)%GESTOR_COLORS.length];
    return `<div class="m-chip ${act?'active':''}" onclick="selectMensajero(${m.id})">
      <div class="g-avatar-wrap">
        <div class="g-avatar" style="background:${col};width:28px;height:28px;font-size:10px;">${ini}</div>
        ${active>0?`<span class="m-pend-dot" style="background:${dotColor};"></span>`:''}
      </div>
      <span class="m-chip-name">${m.name}</span>
      ${active>0?`<span style="background:${badgeBg};color:white;border-radius:8px;font-size:9px;font-weight:700;padding:1px 5px;margin-left:2px;">${active}</span>`:''}
    </div>`;
  }).join('');
}
function selectMensajero(id) {
  activeMensajeroId=id;
  document.getElementById('adminMensajerosPanel').classList.add('has-sel');
  document.getElementById('mensajeroChangeBtn').style.display='block';
  renderMensajeroSelector();renderMensajeroVales();
}
function changeMensajero() {
  activeMensajeroId=null;
  document.getElementById('adminMensajerosPanel').classList.remove('has-sel');
  document.getElementById('mensajeroChangeBtn').style.display='none';
  renderMensajeroSelector();renderMensajeroVales();
}
function renderMensajeroVales() {
  const c=document.getElementById('mensajeroValesList');if(!c)return;
  if(!activeMensajeroId){
    c.innerHTML='<div class="es"><div class="es-icon">🛵</div><div class="es-text">Selecciona un mensajero para ver sus entregas</div></div>';return;
  }
  const porEntregar=getVales().filter(v=>v.mensajeroId===activeMensajeroId&&v.status==='assigned').reverse();
  const entregados=getVales().filter(v=>v.mensajeroId===activeMensajeroId&&v.status==='delivered').reverse();
  const confirmadosHoy=getVales().filter(v=>v.mensajeroId===activeMensajeroId&&['confirmed','pending_payment'].includes(v.status)&&new Date(v.ts).toDateString()===todayStr()).reverse();
  let html='';
  if(!porEntregar.length&&!entregados.length&&!confirmadosHoy.length){
    html='<div class="es"><div class="es-icon">✅</div><div class="es-text">Sin entregas asignadas</div></div>';
  } else {
    if(porEntregar.length){
      html+='<div class="lbl" style="margin-top:0;">Por entregar</div>';
      html+=porEntregar.map(v=>{
        const g=gestorOf(v.gestorId);
        return `<div class="mv-card st-assigned">
          <div class="mv-head"><span class="mv-time">${timeStr(v.ts)}</span><span class="sp-assigned" style="font-size:9px;padding:2px 6px;">🛵 Asignado</span></div>
          <div class="mv-info"><b>${v.cliente||'—'}</b> · ${v.telefono||'—'}</div>
          <div style="font-size:11px;color:var(--gray-400);">📍 ${v.direccion||'Sin dirección'}</div>
          <div style="font-size:12px;font-weight:700;margin-top:3px;">💰 ${v.total||'—'}${v.vuelto?` · Vuelto: ${v.vuelto}`:''}</div>
          ${g?`<div style="font-size:11px;color:var(--gray-400);">Gestor: ${g.name}</div>`:''}
          <div style="font-size:11px;color:var(--gray-600);margin-top:3px;">📦 ${v.articulo||'—'}</div>
          <button class="btn btn-green btn-full btn-sm" style="margin-top:8px;" onclick="mensajeroEntrega(${v.id})">📦 Marcar como entregado</button>
        </div>`;
      }).join('');
    }
    if(entregados.length){
      html+='<div class="lbl" style="margin-top:16px;">Entregados · esperando confirmación admin</div>';
      html+=entregados.map(v=>{
        const g=gestorOf(v.gestorId);
        return `<div class="mv-card st-delivered">
          <div class="mv-head"><span class="mv-time">${timeStr(v.deliveredTs||v.ts)}</span><span class="sp-delivered" style="font-size:9px;padding:2px 6px;">📦 Entregado</span></div>
          <div class="mv-info"><b>${v.cliente||'—'}</b> · ${v.total||'—'}</div>
          ${g?`<div style="font-size:11px;color:var(--gray-400);">Gestor: ${g.name}</div>`:''}
          <div style="font-size:11px;color:#7C3AED;margin-top:4px;">⏳ Admin aún no confirmó la venta</div>
        </div>`;
      }).join('');
    }
    if(confirmadosHoy.length){
      html+='<div class="lbl" style="margin-top:16px;">Resumen hoy</div>';
      html+=confirmadosHoy.map(v=>{
        const g=gestorOf(v.gestorId);
        const isPend=v.status==='pending_payment';
        return `<div class="mv-card st-${isPend?'pending_payment':'confirmed'}">
          <div class="mv-head"><span class="mv-time">${timeStr(v.confirmedTs||v.ts)}</span><span style="color:${isPend?'var(--orange)':'var(--green)'};font-size:10px;font-weight:700;">${isPend?'⏳ Pend. cobro':'✅ Confirmado'}</span></div>
          <div class="mv-info"><b>${v.cliente||'—'}</b> · ${v.total||'—'}</div>
          ${g?`<div style="font-size:11px;color:var(--gray-400);">Gestor: ${g.name}</div>`:''}
        </div>`;
      }).join('');
    }
  }
  c.innerHTML=html;
}

// ══════════════════════════════════════════
//  ADMIN GESTORES MANAGEMENT
// ══════════════════════════════════════════
function genPassword() {
  const chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({length:6},()=>chars[Math.floor(Math.random()*chars.length)]).join('');
}
function addGestor() {
  const inp=document.getElementById('newGestorInput');
  const name=inp.value.trim();if(!name)return;
  const initials=name.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2);
  const list=getGestores();
  if(list.some(g=>g.name.toLowerCase()===name.toLowerCase())){showToast('Ya existe ese gestor');return;}
  const color=GESTOR_COLORS[list.length%GESTOR_COLORS.length];
  const password=genPassword();
  list.push({id:Date.now(),name,initials,color,password});
  saveGestores(list);inp.value='';
  gestoresTabDirty=true;rankingCache=null;
  renderAdminGestoresList();renderGestores();renderAdminGestores();renderGestorRanking();
  showToast(`Gestor agregado ✓ · Clave: ${password}`);
}
function resetGestorPass(id) {
  const list=getGestores();const i=list.findIndex(g=>g.id===id);if(i===-1)return;
  const np=genPassword();list[i].password=np;saveGestores(list);
  gestoresTabDirty=true;
  renderAdminGestoresList();showToast(`Nueva clave: ${np}`);
}
function removeGestor(id) {
  if(getVales().some(v=>v.gestorId===id)){showToast('Tiene vales registrados');return;}
  saveGestores(getGestores().filter(g=>g.id!==id));
  gestoresTabDirty=true;rankingCache=null;
  renderAdminGestoresList();renderGestores();renderAdminGestores();
}
function renderAdminGestoresList() {
  const list=getGestores();
  const c=document.getElementById('adminGestoresPanel-list');
  if(!list.length){c.innerHTML='<div class="es"><div class="es-icon">👥</div><div class="es-text">Sin gestores. Agrega uno arriba.</div></div>';return;}
  c.innerHTML=list.map(g=>{
    const vales=getVales().filter(v=>v.gestorId===g.id);
    const today=vales.filter(v=>new Date(v.ts).toDateString()===todayStr()).length;
    const pts=vales.filter(v=>['confirmed','pending_payment'].includes(v.status))
      .reduce((s,v)=>s+(v.valeProductos||[]).reduce((ss,p)=>{const pr=productoOf(p.id);return ss+(pr?pr.puntos*p.qty:0);},0),0);
    return `<div class="gp-card">
      <div class="g-avatar" style="background:${g.color};width:40px;height:40px;font-size:13px;flex-shrink:0;">${g.initials}</div>
      <div style="flex:1;min-width:140px;">
        <div style="font-weight:700;font-size:14px;color:var(--text);">${g.name}</div>
        <div style="font-size:11px;color:var(--text-muted);margin-top:1px;">${vales.length} vales · ${today} hoy · ⭐ ${pts} pts</div>
        <div style="display:flex;align-items:center;flex-wrap:wrap;gap:6px;margin-top:6px;">
          <span style="background:var(--gray-200);border-radius:6px;padding:3px 9px;font-family:monospace;font-weight:700;font-size:12px;letter-spacing:1.5px;color:var(--text);">🔑 ${g.password||'—'}</span>
          <button type="button" style="background:none;border:1px solid var(--blue);cursor:pointer;font-size:10px;color:var(--blue);padding:2px 7px;border-radius:4px;font-weight:600;" onclick="resetGestorPass(${g.id})">↺ Resetear</button>
          <button type="button" style="background:none;border:1px solid var(--gray-400);cursor:pointer;font-size:10px;color:var(--gray-700);padding:2px 7px;border-radius:4px;font-weight:600;" onclick="openEditGestorModal(${g.id})">✏️ Editar</button>
        </div>
      </div>
      <button type="button" class="btn btn-ghost btn-sm" style="color:var(--red);align-self:flex-start;flex-shrink:0;" onclick="removeGestor(${g.id})">Eliminar</button>
    </div>`;
  }).join('');
}
function openEditGestorModal(id) {
  const g=gestorOf(id);if(!g)return;
  document.getElementById('editGestorInput').value=g.name;
  document.getElementById('editGestorModal').dataset.gestorId=id;
  document.getElementById('editGestorModal').classList.add('show');
}
function closeEditGestorModal(){document.getElementById('editGestorModal').classList.remove('show');}
function saveEditGestor() {
  const id=parseInt(document.getElementById('editGestorModal').dataset.gestorId);
  const newName=document.getElementById('editGestorInput').value.trim();
  if(!newName){showToast('El nombre no puede estar vacío');return;}
  const list=getGestores();const i=list.findIndex(g=>g.id===id);if(i===-1)return;
  const initials=newName.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2);
  list[i]={...list[i],name:newName,initials};
  saveGestores(list);
  closeEditGestorModal();
  renderAdminGestoresList();renderGestores();renderAdminGestores();renderGestorRanking();
  showToast('Gestor actualizado ✓');
}

// ══════════════════════════════════════════
//  ADMIN GESTORES FILTER (inbox)
// ══════════════════════════════════════════
function renderAdminGestores() {
  const gestores=getGestores();
  const totalPend=pendingCount();
  document.getElementById('adminGestoresList').innerHTML=
    `<div class="ag-all ${adminGestorFilter===null?'active':''}" onclick="setGestorFilter(null)">
      <span>Todos los gestores</span>${totalPend>0?`<span class="ag-count">${totalPend}</span>`:''}
    </div>`+
    gestores.map(g=>{
      const pend=pendingOf(g.id);const todayN=todayValesOf(g.id).length;
      return `<div class="ag-item ${adminGestorFilter===g.id?'active':''}" onclick="setGestorFilter(${g.id})">
        <div class="ag-avatar" style="background:${g.color}">${g.initials}</div>
        <div><div class="ag-name">${g.name}</div><div style="font-size:10px;color:var(--gray-400);">${todayN} vale${todayN!==1?'s':''} hoy</div></div>
        ${pend>0?`<span class="ag-count">${pend}</span>`:''}
      </div>`;
    }).join('');
}
function setGestorFilter(gId){adminGestorFilter=gId;renderAdminGestores();renderInbox();}

// ══════════════════════════════════════════
//  ADMIN INBOX
// ══════════════════════════════════════════
function setFilter(f) {
  inboxFilter=f;
  ['All','Pend','Done'].forEach(x=>{const el=document.getElementById('f'+x);if(el){el.style.background='';el.style.fontWeight='';}});
  const map={all:'All',pending:'Pend',done:'Done'};
  const el=document.getElementById('f'+map[f]);if(el){el.style.background='white';el.style.fontWeight='700';}
  renderInbox();
}
function renderInbox() {
  let all=getVales().reverse();
  if(adminGestorFilter!==null)all=all.filter(v=>v.gestorId===adminGestorFilter);
  if(inboxFilter==='pending')all=all.filter(v=>v.status==='pending');
  else if(inboxFilter==='done')all=all.filter(v=>v.status!=='pending');
  const searchEl=document.getElementById('valeSearchInput');
  const searchQ=searchEl?searchEl.value.trim().toLowerCase():'';
  if(searchQ){
    all=all.filter(v=>(v.cliente||'').toLowerCase().includes(searchQ)||(v.telefono||'').toLowerCase().includes(searchQ));
    const cnt=document.getElementById('inboxSearchCount');
    if(cnt){cnt.textContent=`${all.length} resultado${all.length!==1?'s':''}`;cnt.style.display='block';}
  } else {
    const cnt=document.getElementById('inboxSearchCount');if(cnt)cnt.style.display='none';
  }
  const c=document.getElementById('inboxList');
  if(!all.length){c.innerHTML='<div class="es"><div class="es-icon">📭</div><div class="es-text">Sin vales aquí</div></div>';return;}
  const sMap={
    pending:{label:'Pendiente',cls:'sp-pending'},assigned:{label:'Con mensajero',cls:'sp-assigned'},
    delivered:{label:'Entregado',cls:'sp-delivered'},
    confirmed:{label:'Confirmado',cls:'sp-confirmed'},pending_payment:{label:'Pend. cobro',cls:'sp-pending_payment'},
  };
  c.innerHTML=all.map(v=>{
    const g=gestorOf(v.gestorId);const s=sMap[v.status]||{label:v.status,cls:''};
    const isNew=v.isNew&&v.status==='pending';const sel=v.id===selectedValeId;
    return `<div class="ic ${sel?'sel':''} ${isNew?'is-new':''}" onclick="selectVale(${v.id})">
      ${isNew?'<div class="new-dot"></div>':''}
      <div class="ic-head">
        <span class="ic-gestor">
          <span style="width:20px;height:20px;border-radius:50%;background:${g?g.color:'#888'};display:inline-flex;align-items:center;justify-content:center;color:white;font-size:9px;font-weight:700;flex-shrink:0;">${g?g.initials:'?'}</span>
          ${g?g.name:'—'}
        </span>
        <span class="ic-time">${timeStr(v.ts)}</span>
      </div>
      <div class="ic-cliente">${v.valeNum?`<span style="font-weight:800;color:var(--blue);">${valeNumStr(v)}</span> `:''}${v.cliente||'Sin nombre'}</div>
      <div class="ic-preview">${v.articulo||'Sin artículo'}</div>
      ${v.adminNotes?`<div style="background:#FFFBEB;border-radius:4px;padding:2px 6px;font-size:10px;color:var(--gray-700);margin-bottom:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">📝 ${v.adminNotes}</div>`:''}
      <div class="ic-foot">
        <span class="sp ${s.cls}">${s.label}</span>
        <span style="font-size:11px;color:var(--gray-400);">${v.total||''}</span>
      </div>
    </div>`;
  }).join('');
}
function selectVale(id) {
  selectedValeId=id;patchVale(id,{isNew:false});
  updateAdminBadge();renderAdminGestores();renderInbox();renderValeDetail();
}

// ══════════════════════════════════════════
//  VALE DETAIL
// ══════════════════════════════════════════
function renderValeDetail() {
  const v=getVales().find(x=>x.id===selectedValeId);
  const c=document.getElementById('valeDetail');
  if(!v){c.innerHTML='<div class="det-empty"><div class="det-empty-icon">📋</div><div style="font-size:13px;">Selecciona un vale de la bandeja</div></div>';return;}
  const g=gestorOf(v.gestorId);const m=v.mensajeroId?mensajeroOf(v.mensajeroId):null;
  const sMap={
    pending:{label:'Pendiente',cls:'sp-pending',icon:'🔵'},
    assigned:{label:'Con mensajero',cls:'sp-assigned',icon:'🛵'},
    confirmed:{label:'Confirmado',cls:'sp-confirmed',icon:'✅'},
    pending_payment:{label:'Pend. cobro',cls:'sp-pending_payment',icon:'⏳'},
  };
  const s=sMap[v.status]||{label:v.status,cls:'',icon:'•'};
  const pts=(v.valeProductos||[]).reduce((sum,p)=>{const pr=productoOf(p.id);return sum+(pr?pr.puntos*p.qty:0);},0);
  let actHTML='';
  if(v.status==='pending'){
    actHTML=`<button class="btn btn-blue btn-full" onclick="openShareModal(${v.id})" style="margin-bottom:8px;">📤 Compartir con mensajero</button>
    <div style="font-size:10px;color:var(--gray-400);text-align:center;margin-bottom:6px;">— o confirmar directo —</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">
      <button class="btn btn-green btn-sm btn-full" onclick="confirmSale(${v.id},'confirmed')">✅ Entregado</button>
      <button class="btn btn-sm btn-full" style="background:var(--orange);color:white;" onclick="confirmSale(${v.id},'pending_payment')">⏳ Pendiente cobro</button>
    </div>`;
  } else if(v.status==='assigned'){
    actHTML=`<div class="mensajero-row">🛵 <b>Mensajero:</b> ${m?m.name:'—'}</div>
      <div style="font-size:12px;color:var(--gray-400);margin:6px 0 10px;">Esperando que el mensajero confirme la entrega</div>
      <button class="btn btn-ghost btn-full btn-sm" onclick="mensajeroEntrega(${v.id})" style="margin-bottom:6px;">📦 Marcar entregado (admin)</button>
      <button class="btn btn-ghost btn-full btn-sm" onclick="openShareModal(${v.id})">🔄 Reenviar vale</button>`;
  } else if(v.status==='delivered'){
    actHTML=`<div style="background:rgba(124,58,237,.08);border:1px solid rgba(124,58,237,.3);border-radius:8px;padding:12px;text-align:center;margin-bottom:10px;">
      <div style="font-size:24px;margin-bottom:4px;">🛵</div>
      <div style="font-weight:700;color:#7C3AED;">Entregado por mensajero</div>
      ${m?`<div style="font-size:12px;color:var(--gray-400);">Mensajero: ${m.name}</div>`:''}
    </div>
    <button class="btn btn-green btn-full" onclick="confirmSale(${v.id},'confirmed')" style="margin-bottom:8px;">✅ Confirmar venta + Entregado</button>
    <button class="btn btn-orange btn-full" onclick="confirmSale(${v.id},'pending_payment')">⏳ Confirmar venta + Pendiente de cobro</button>`;
  } else if(v.status==='confirmed'){
    actHTML=`<div style="background:rgba(16,185,129,.08);border:1px solid rgba(16,185,129,.25);border-radius:8px;padding:14px;text-align:center;">
      <div style="font-size:26px;margin-bottom:4px;">✅</div>
      <div style="font-weight:700;color:var(--green);">Venta confirmada y cobrada</div>
      ${m?`<div style="font-size:12px;color:var(--gray-400);margin-top:2px;">Mensajero: ${m.name}</div>`:''}
      ${v.confirmedTs?`<div style="font-size:11px;color:var(--gray-400);">${new Date(v.confirmedTs).toLocaleDateString('es-ES')} ${timeStr(v.confirmedTs)}</div>`:''}
    </div>
    <button type="button" class="btn btn-ghost btn-full btn-sm" style="margin-top:6px;color:var(--orange);" onclick="revertConfirmSale(${v.id})">↩ Revertir a Entregado</button>`;
  } else if(v.status==='pending_payment'){
    actHTML=`<div style="background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.25);border-radius:8px;padding:14px;text-align:center;margin-bottom:8px;">
      <div style="font-size:26px;margin-bottom:4px;">⏳</div>
      <div style="font-weight:700;color:var(--yellow);">Pendiente de cobro</div>
      ${m?`<div style="font-size:12px;color:var(--gray-400);">Mensajero: ${m.name}</div>`:''}
    </div>
    <button class="btn btn-green btn-full" onclick="markAsPaid(${v.id})">✅ Cobrado — Registrar pago</button>`;
  }
  const numBadge=valeNumStr(v)?`<span style="font-size:15px;font-weight:900;color:var(--blue);margin-bottom:4px;display:block;">${valeNumStr(v)}</span>`:'';
  const notesHighlight=v.adminNotes?`<div style="background:#FFFBEB;border:1px solid var(--yellow);border-radius:8px;padding:7px 10px;font-size:11px;color:var(--gray-700);margin-top:5px;">📝 ${v.adminNotes}</div>`:'';
  c.innerHTML=`
    <div class="lbl" style="margin-top:0;">Detalle del Vale</div>
    <div class="card">
      ${numBadge}
      <div class="det-gestor-row">
        <div class="g-avatar" style="background:${g?g.color:'#888'};width:34px;height:34px;font-size:12px;">${g?g.initials:'?'}</div>
        <div style="flex:1;">
          <div style="font-size:14px;font-weight:700;">${g?g.name:'—'}</div>
          <div style="font-size:11px;color:var(--gray-400);">${new Date(v.ts).toLocaleDateString('es-ES')} ${timeStr(v.ts)}</div>
        </div>
        <div style="text-align:right;">
          <span class="sp ${s.cls}">${s.icon} ${s.label}</span>
          ${pts>0?`<div style="font-size:10px;color:var(--blue);font-weight:700;margin-top:3px;">⭐ ${pts} pts</div>`:''}
        </div>
      </div>
      <table style="width:100%;font-size:12px;border-collapse:collapse;">
        ${[['Cliente',v.cliente],['Teléfono',v.telefono],['Dirección',v.direccion],['Artículo',v.articulo],
           ['Precio USD',v.precioUSD],['Precio CUP',v.precioCUP],['Vuelto',v.vuelto],['Total',v.total],['Garantía',v.garantia]]
          .filter(([,val])=>val)
          .map(([k,val])=>`<tr style="border-bottom:1px solid var(--gray-100);">
            <td style="padding:6px 0;color:var(--gray-400);font-weight:600;width:80px;">${k}</td>
            <td style="padding:6px 0;font-weight:600;">${val}</td></tr>`).join('')}
      </table>
      ${notesHighlight}
    </div>
    <div class="card" style="padding:10px 14px;display:flex;gap:6px;">
      ${v.status!=='confirmed'?`<button type="button" class="btn btn-ghost btn-full btn-sm" onclick="openEditValeModal(${v.id})">✏️ Editar vale</button>`:''}
      <button type="button" class="btn btn-sm btn-full" style="background:rgba(239,68,68,.1);color:var(--red);border:none;" onclick="adminDeleteVale(${v.id})">🗑️ Eliminar vale</button>
    </div>
    ${actHTML?`<div class="card"><div class="det-actions">${actHTML}</div></div>`:''}
    <div class="card" style="padding:10px 14px;">
      <div style="font-size:10px;font-weight:700;color:var(--gray-400);letter-spacing:.5px;text-transform:uppercase;margin-bottom:6px;">📝 Notas (admin)</div>
      <textarea id="valeNotesInput" rows="2" placeholder="Añadir nota interna…" style="font-size:12px;margin-bottom:6px;">${v.adminNotes||''}</textarea>
      <button type="button" class="btn btn-ghost btn-sm btn-full" onclick="saveValeNotes(${v.id})">Guardar nota</button>
    </div>
    <div class="lbl">Vale completo</div>
    <div class="card" style="padding:10px 12px;">
      <div class="vale-preview" style="font-size:11px;">${v.valeText||''}</div>
      <button class="btn btn-ghost btn-full btn-sm" style="margin-top:8px;" onclick="navigator.clipboard.writeText(document.querySelector('#valeDetail .vale-preview').textContent).then(()=>showToast('Copiado ✓'))">📋 Copiar vale</button>
    </div>`;
}

// ══════════════════════════════════════════
//  VALE NOTES (admin)
// ══════════════════════════════════════════
function saveValeNotes(id) {
  const ta=document.getElementById('valeNotesInput');
  if(!ta)return;
  patchVale(id,{adminNotes:ta.value.trim()});
  renderInbox();renderValeDetail();
  showToast('Nota guardada ✓');
}

// ══════════════════════════════════════════
//  EDIT VALE MODAL
// ══════════════════════════════════════════
function openEditValeModal(id) {
  const v=getVales().find(x=>x.id===id);if(!v)return;
  document.getElementById('ev-cliente').value=v.cliente||'';
  document.getElementById('ev-telefono').value=v.telefono||'';
  document.getElementById('ev-direccion').value=v.direccion||'';
  document.getElementById('ev-mensajeria').value=v.mensajeria||'';
  document.getElementById('ev-total').value=v.total||'';
  document.getElementById('ev-garantia').value=v.garantia||'';
  document.getElementById('editValeModal').dataset.valeId=id;
  document.getElementById('editValeModal').classList.add('show');
}
function closeEditValeModal(){document.getElementById('editValeModal').classList.remove('show');}
function saveEditVale() {
  const id=parseInt(document.getElementById('editValeModal').dataset.valeId);
  const changes={
    cliente:document.getElementById('ev-cliente').value.trim(),
    telefono:document.getElementById('ev-telefono').value.trim(),
    direccion:document.getElementById('ev-direccion').value.trim(),
    mensajeria:document.getElementById('ev-mensajeria').value.trim(),
    total:document.getElementById('ev-total').value.trim(),
    garantia:document.getElementById('ev-garantia').value.trim(),
  };
  patchVale(id,changes);
  closeEditValeModal();
  renderInbox();renderValeDetail();
  showToast('Vale actualizado ✓');
}

// ══════════════════════════════════════════
//  SHARE MODAL
// ══════════════════════════════════════════
function openShareModal(valeId) {
  const mensajeros=getMensajeros();
  if(!mensajeros.length){showToast('Agrega mensajeros primero');return;}
  shareTargetId=valeId;
  const v=getVales().find(x=>x.id===valeId);const g=gestorOf(v.gestorId);
  document.getElementById('shareModalSub').textContent=`Vale de ${g?g.name:'—'} · ${v.cliente||'cliente'}`;
  const sel=document.getElementById('mensajeroSelect');
  sel.innerHTML=mensajeros.map(m=>`<option value="${m.id}">${m.name}</option>`).join('');
  if(v.mensajeroId)sel.value=v.mensajeroId;
  updateSharePreview();sel.onchange=updateSharePreview;
  document.getElementById('shareModal').classList.add('show');
}
function updateSharePreview() {
  const v=getVales().find(x=>x.id===shareTargetId);if(!v)return;
  const m=mensajeroOf(parseInt(document.getElementById('mensajeroSelect').value));
  document.getElementById('shareValePreview').textContent=buildShareText(v,m);
}
function buildShareText(v,m) {
  const g=gestorOf(v.gestorId);
  const numLine=valeNumStr(v)?`${valeNumStr(v)}\n`:'';
  return [numLine+'Bienvenido a "AXONTECH" 🔥','','VALE DE ENTREGA','',
    `🔸Promotor: ${g?g.name:'—'}`,`🛵Mensajero: ${m?m.name:'—'}`,'',
    `🔸 Nombre Cliente: ${v.cliente||''}`,`🔸Teléfono Cliente: ${v.telefono||''}`,
    `🔸Dirección Cliente: ${v.direccion||''}`,`🔸Mensajería/ costo: ${v.mensajeria||''}`,
    `🔸 Artículo y cantidad: ${v.articulo||''}`,`🔸 Total a pagar: ${v.total||''}`, '',
    `*Fecha: ${new Date(v.ts).toLocaleDateString('es-ES')} ${timeStr(v.ts)}`,'',
    '🧭Amistad #313% San Rafael y San José, Centro Habana.'].join('\n');
}
function shareViaWA() {
  const text=document.getElementById('shareValePreview').textContent;
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`,'_blank');
}
function closeShareModal(){document.getElementById('shareModal').classList.remove('show');shareTargetId=null;}
function copyAndAssign() {
  if(!shareTargetId)return;
  const mId=parseInt(document.getElementById('mensajeroSelect').value);
  const m=mensajeroOf(mId);
  navigator.clipboard.writeText(document.getElementById('shareValePreview').textContent).catch(()=>{});
  const vAsign=getVales().find(x=>x.id===shareTargetId);
  patchVale(shareTargetId,{status:'assigned',mensajeroId:mId});
  if(vAsign) addNotif('vale_assigned',vAsign.cliente||'Tu cliente',null,m?m.name:'',vAsign.gestorId);
  closeShareModal();selectedValeId=shareTargetId;
  renderAdminGestores();renderInbox();renderValeDetail();renderMyVales();
  renderConfirmados();renderPendienteCobro();
  updateMensajeroBadge();
  showToast(`Asignado a ${m?m.name:'mensajero'} y copiado ✓`);
}

// ══════════════════════════════════════════
//  CONFIRM / PENDING
// ══════════════════════════════════════════
// Mensajero marca entrega física — sin tocar stock
function mensajeroEntrega(id) {
  patchVale(id,{status:'delivered',deliveredTs:new Date().toISOString()});
  renderAdminGestores();renderInbox();renderValeDetail();renderMyVales();
  renderPendienteCobro();renderMensajeroVales();
  updateAdminBadge();updateMensajeroBadge();
  showToast('Marcado como entregado 🛵');
}
// Admin confirma venta: descuenta stock + notifica gestor + fija estado de cobro
function confirmSale(id, paymentStatus, skipConfirm) {
  if(!skipConfirm) {
    const v=getVales().find(x=>x.id===id);if(!v)return;
    const title=paymentStatus==='confirmed'?'¿Confirmar venta cobrada?':'¿Confirmar — cobro pendiente?';
    const sub=paymentStatus==='confirmed'?`${v.cliente||''} · ${v.total||''}`:`${v.cliente||''}`;
    showConfirmAction(title,sub,paymentStatus==='confirmed'?'Confirmar cobrada':'Confirmar pendiente','btn-blue',()=>confirmSale(id,paymentStatus,true));
    return;
  }
  const v=getVales().find(x=>x.id===id);if(!v)return;
  (v.valeProductos||[]).forEach(({id:pid,qty})=>{
    const prod=productoOf(pid);if(!prod)return;
    const oldStock=prod.stock||0;
    const newStock=Math.max(0,oldStock-qty);
    patchProducto(pid,{stock:newStock});
    // Notificación de venta por producto: "Se vendió X nombre, quedan Y"
    addNotif('sale_product',prod.name,pid,`${qty}|${newStock}`,v.gestorId);
    if(newStock===0&&oldStock>0) addNotif('out_of_stock',prod.name,pid,'stock agotado');
    else if(newStock>0&&newStock<=LOW_STOCK_THRESHOLD&&oldStock>LOW_STOCK_THRESHOLD) addNotif('low_stock',prod.name,pid,`quedan ${newStock}`);
  });
  addNotif('vale_confirmed',v.cliente||'Cliente',null,`Total: ${v.total||''}`,v.gestorId);
  patchVale(id,{status:paymentStatus,confirmedTs:new Date().toISOString()});
  gestoresTabDirty=true;statsTabDirty=true;rankingCache=null;
  playSound('confirm');
  renderAdminGestores();renderInbox();renderValeDetail();renderMyVales();
  renderConfirmados();renderPendienteCobro();renderPendingCobroSection();renderMensajeroVales();
  renderProductGrid();renderGestorRanking();
  if(currentAdminTab==='gestores'){renderComisiones();}
  checkGoalReached(v.gestorId, id);
  maybeAutoSync();
  showToast(paymentStatus==='confirmed'?'Venta confirmada y cobrada ✅':'Venta confirmada — cobro pendiente ⏳');
}
// Admin registra cobro recibido — sin tocar stock (ya se descontó al confirmar)
function markAsPaid(id, skipConfirm) {
  if(!skipConfirm) {
    const v=getVales().find(x=>x.id===id);if(!v)return;
    showConfirmAction('¿Registrar cobro recibido?',`${v.cliente||''} · ${v.total||''}`,'Registrar cobro','btn-green',()=>markAsPaid(id,true));
    return;
  }
  patchVale(id,{status:'confirmed',confirmedTs:new Date().toISOString()});
  gestoresTabDirty=true;statsTabDirty=true;rankingCache=null;
  renderAdminGestores();renderInbox();renderValeDetail();renderMyVales();
  renderConfirmados();renderPendienteCobro();renderPendingCobroSection();renderMensajeroVales();renderMensajeroSelector();updateMensajeroBadge();
  renderGestorRanking();
  if(currentAdminTab==='gestores'){renderComisiones();}
  checkGoalReached(getVales().find(x=>x.id===id)?.gestorId, id);
  maybeAutoSync();
  showToast('Cobro registrado ✅');
}

// ══════════════════════════════════════════
//  MENSAJEROS
// ══════════════════════════════════════════
function addMensajero() {
  const inp=document.getElementById('newMensajeroInput');
  const name=inp.value.trim();if(!name)return;
  const list=getMensajeros();list.push({id:Date.now(),name});saveMensajeros(list);
  inp.value='';renderMensajeros();showToast('Mensajero agregado');
}
const _nmi=document.getElementById('newMensajeroInput');if(_nmi)_nmi.addEventListener('keydown',e=>{if(e.key==='Enter')addMensajero();});
function removeMensajero(id) {
  if(getVales().some(v=>v.mensajeroId===id&&['assigned','pending_payment'].includes(v.status))){showToast('Tiene vales activos');return;}
  saveMensajeros(getMensajeros().filter(m=>m.id!==id));renderMensajeros();
}
function renderMensajeros() {
  const list=getMensajeros();const c=document.getElementById('mensajerosList');
  if(!list.length){c.innerHTML='<div class="es" style="padding:8px;"><div class="es-text">Sin mensajeros</div></div>';return;}
  c.innerHTML=list.map(m=>{
    const ini=m.name.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2);
    return `<div class="m-item"><div class="m-av">${ini}</div><div class="m-name">${m.name}</div><button class="m-del" style="font-size:13px;margin-right:4px;" onclick="openEditMensajeroModal(${m.id})" title="Editar">✏️</button><button class="m-del" onclick="removeMensajero(${m.id})">×</button></div>`;
  }).join('');
}
function openEditMensajeroModal(id) {
  const m=mensajeroOf(id);if(!m)return;
  document.getElementById('editMensajeroInput').value=m.name;
  document.getElementById('editMensajeroModal').dataset.mensajeroId=id;
  document.getElementById('editMensajeroModal').classList.add('show');
}
function closeEditMensajeroModal(){document.getElementById('editMensajeroModal').classList.remove('show');}
function saveEditMensajero() {
  const id=parseInt(document.getElementById('editMensajeroModal').dataset.mensajeroId);
  const newName=document.getElementById('editMensajeroInput').value.trim();
  if(!newName){showToast('El nombre no puede estar vacío');return;}
  const list=getMensajeros();const i=list.findIndex(m=>m.id===id);if(i===-1)return;
  list[i]={...list[i],name:newName};
  saveMensajeros(list);
  closeEditMensajeroModal();
  renderMensajeros();renderMensajeroSelector();
  showToast('Mensajero actualizado ✓');
}

// ══════════════════════════════════════════
//  CONFIRMADOS / PENDIENTES
// ══════════════════════════════════════════
function renderConfirmados() {
  const today=getVales().filter(v=>v.status==='confirmed'&&new Date(v.ts).toDateString()===todayStr()).reverse();
  const c=document.getElementById('confirmadosList');
  if(!today.length){c.innerHTML='<div class="es"><div class="es-icon">✅</div><div class="es-text">Sin confirmaciones</div></div>';return;}
  c.innerHTML=today.map(v=>{
    const g=gestorOf(v.gestorId);const m=v.mensajeroId?mensajeroOf(v.mensajeroId):null;
    return `<div class="sc sc-ok"><div class="sc-head"><span class="sc-g">${g?g.name:'—'}</span><span class="sc-t">${timeStr(v.confirmedTs||v.ts)}</span></div><div>${v.cliente||''}</div><div class="sc-m">${m?'🛵 '+m.name:''}</div><button type="button" class="btn btn-ghost btn-sm" style="margin-top:5px;font-size:10px;color:var(--orange);" onclick="revertConfirmSale(${v.id})">↩ Revertir</button></div>`;
  }).join('');
}
function renderPendienteCobro() {
  const c=document.getElementById('pendienteList');
  if(!c)return;
  const pend=getVales().filter(v=>v.status==='pending_payment').reverse();
  if(!pend.length){c.innerHTML='<div class="es"><div class="es-icon">⏳</div><div class="es-text">Sin pendientes</div></div>';return;}
  c.innerHTML=pend.map(v=>{
    const g=gestorOf(v.gestorId);const m=v.mensajeroId?mensajeroOf(v.mensajeroId):null;
    return `<div class="sc sc-pend"><div class="sc-head"><span class="sc-g">${g?g.name:'—'}</span><span class="sc-t">${timeStr(v.ts)}</span></div><div>${v.cliente||''} · ${v.total||''}</div><div class="sc-m">${m?'🛵 '+m.name:''}</div><button class="btn btn-green btn-full btn-sm" style="margin-top:7px;" onclick="markAsPaid(${v.id})">✅ Cobrado</button></div>`;
  }).join('');
}
let pendingCobroExpanded=false;
function togglePendingCobro(){pendingCobroExpanded=!pendingCobroExpanded;renderPendingCobroSection();}
function renderPendingCobroSection() {
  const c=document.getElementById('pendingCobroSection');if(!c)return;
  const pend=getVales().filter(v=>v.status==='pending_payment').reverse();
  if(!pend.length){c.innerHTML='';return;}
  const body=pendingCobroExpanded?`<div style="margin-top:8px;">${pend.map(v=>{
    const g=gestorOf(v.gestorId);const m=v.mensajeroId?mensajeroOf(v.mensajeroId):null;
    return `<div class="mv-card" style="border-left:3px solid var(--red);background:rgba(239,68,68,.05);margin-bottom:6px;">
      <div class="mv-head"><span class="mv-time">${timeStr(v.confirmedTs||v.ts)}</span><span style="color:var(--red);font-size:9px;font-weight:700;padding:2px 6px;background:rgba(239,68,68,.12);border-radius:4px;">⏳ Pend. cobro</span></div>
      <div class="mv-info"><b>${v.cliente||'—'}</b> · <span style="color:var(--red);font-weight:700;">${v.total||'—'}</span></div>
      ${g?`<div style="font-size:11px;color:var(--gray-400);">Gestor: ${g.name}</div>`:''}
      ${m?`<div style="font-size:11px;color:var(--gray-400);">🛵 ${m.name}</div>`:''}
      <button class="btn btn-green btn-full btn-sm" style="margin-top:8px;" onclick="markAsPaid(${v.id})">💵 Registrar cobro</button>
    </div>`;
  }).join('')}</div>`:'' ;
  c.innerHTML=`<div onclick="togglePendingCobro()" style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;background:rgba(239,68,68,.08);border:1.5px solid rgba(239,68,68,.3);border-radius:9px;cursor:pointer;margin-bottom:${pendingCobroExpanded?'0':'12px'};">
    <div style="display:flex;align-items:center;gap:8px;">
      <span style="font-size:16px;">⏳</span>
      <span style="font-weight:700;font-size:13px;color:var(--red);">Pendientes de cobro</span>
      <span style="background:var(--red);color:white;border-radius:10px;font-size:10px;font-weight:700;padding:1px 7px;">${pend.length}</span>
    </div>
    <span style="color:var(--red);font-size:14px;">${pendingCobroExpanded?'▲':'▼'}</span>
  </div>${body}`;
}

// ══════════════════════════════════════════
//  MY VALES (gestor)
// ══════════════════════════════════════════
function renderMyVales() {
  const c=document.getElementById('gestorMyVales');
  if(!c||!activeGestorId)return;
  const mine=todayValesOf(activeGestorId).reverse();
  if(!mine.length){c.innerHTML='<div class="es"><div class="es-icon">🧾</div><div class="es-text">Aún no has enviado vales hoy</div></div>';return;}
  const sMap={
    pending:{label:'Enviado · admin pendiente',color:'var(--blue)',icon:'🔵'},
    assigned:{label:'Con mensajero',color:'var(--orange)',icon:'🛵'},
    delivered:{label:'Entregado · esperando confirmación admin',color:'#7C3AED',icon:'📦'},
    confirmed:{label:'Venta confirmada ✅',color:'var(--green)',icon:'✅'},
    pending_payment:{label:'Pendiente de cobro',color:'var(--yellow)',icon:'⏳'},
  };
  c.innerHTML=mine.map(v=>{
    const s=sMap[v.status]||{label:v.status,color:'var(--gray-400)',icon:'•'};
    const pts=(v.valeProductos||[]).reduce((sum,p)=>{const pr=productoOf(p.id);return sum+(pr?pr.puntos*p.qty:0);},0);
    const canCancel=v.status==='pending';
    return `<div class="mv-card st-${v.status}">
      <div class="mv-head">
        <span class="mv-time">${valeNumStr(v)?`<b style="color:var(--blue);">${valeNumStr(v)}</b> `:''}${timeStr(v.ts)}</span>
        <div style="display:flex;align-items:center;gap:6px;">
          ${pts>0?`<span style="font-size:10px;color:var(--blue);font-weight:700;">⭐ ${pts} pts</span>`:''}
          ${canCancel?`<button type="button" onclick="cancelVale(${v.id})" style="background:rgba(239,68,68,.12);border:none;color:var(--red);border-radius:6px;padding:2px 8px;font-size:11px;font-weight:700;cursor:pointer;" title="Cancelar vale">✕ Cancelar</button>`:''}
        </div>
      </div>
      <div class="mv-info">${v.cliente||'—'} · ${v.articulo||'—'}</div>
      <div class="mv-foot"><span class="mv-status" style="color:${s.color}">${s.icon} ${s.label}</span></div>
    </div>`;
  }).join('');
}
function cancelVale(id) {
  const v=getVales().find(x=>x.id===id);
  if(!v||v.status!=='pending'){showToast('No se puede cancelar este vale');return;}
  showConfirmAction('¿Cancelar este vale?',`${v.cliente||''} · ${v.articulo||''}`,'Sí, cancelar','btn-red',()=>{
    saveVales(getVales().filter(x=>x.id!==id));
    if(selectedValeId===id)selectedValeId=null;
    showToast('Vale cancelado');
    renderAdminGestores();renderInbox();renderValeDetail();renderMyVales();maybeAutoSync();
  });
}

function adminDeleteVale(id) {
  const v=getVales().find(x=>x.id===id);if(!v)return;
  showConfirmAction('¿Eliminar este vale?',`${v.cliente||''} · ${v.articulo||''}`,'Eliminar','btn-red',()=>{
    saveVales(getVales().filter(x=>x.id!==id));
    if(selectedValeId===id)selectedValeId=null;
    showToast('Vale eliminado');
    renderAdminGestores();renderInbox();renderValeDetail();renderMyVales();maybeAutoSync();
  });
}

// ══════════════════════════════════════════
//  VALE FORM
// ══════════════════════════════════════════
const REQUIRED=['vf-cliente','vf-telefono','vf-direccion','vf-articulo','vf-total'];
const fVal = id => (document.getElementById(id)?.value||'').trim();

function onFormInput() {
  const allFilled=!!activeGestorId&&REQUIRED.every(id=>fVal(id).length>0);
  const btn=document.getElementById('sendValeBtn');if(btn)btn.disabled=!allFilled;
  const anyFilled=REQUIRED.some(id=>fVal(id).length>0)||['vf-mensajeria','vf-precioUSD','vf-precioCUP','vf-vuelto','vf-garantia'].some(id=>fVal(id).length>0);
  const pc=document.getElementById('previewCard');
  if(pc){
    if(activeGestorId&&anyFilled){pc.style.display='block';document.getElementById('valePreviewText').textContent=buildValeText();}
    else pc.style.display='none';
  }
}
function buildValeText() {
  const g=gestorOf(activeGestorId);
  return ['Bienvenido a "AXONTECH" 🔥','','VALE DEL GESTOR:','',
    `🔸Promotor: ${g?g.name:''}`, '',
    `🔸 Nombre Cliente: ${fVal('vf-cliente')}`,
    `🔸Teléfono Cliente: ${fVal('vf-telefono')}`,
    `🔸Dirección Cliente: ${fVal('vf-direccion')}`,
    `🔸Mensajería/ costo: ${fVal('vf-mensajeria')}`,
    `🔸 Artículo y cantidad: ${fVal('vf-articulo')}`,
    `🔸Precio USD/ zelle: ${fVal('vf-precioUSD')}`,
    `🔸Precio CUP: ${fVal('vf-precioCUP')}`,
    `🔸 Vuelto: ${fVal('vf-vuelto')}`,
    `🔸 Total a pagar: ${fVal('vf-total')}`, '',
    `*Garantía: ${fVal('vf-garantia')}`,
    `*Fecha y hora de Venta: ${fVal('vf-fecha')||nowDateTime()}`, '',
    '🧭Dirección de la tienda:','* Amistad #313% San Rafael y San José, Centro Habana.','',
    '🚨ATENCIÓN🚨','•   Horarios de atención al cliente:','    8:00am - 8:00pm.',
    '* Solo aceptamos hasta cinco billetes de 1 USD por compra.',
    '* Los pagos en CUP deben ser con denominación de 50 en adelante.',
    '* Solo se aceptan billetes en buen estado (ni rotos ni manchados)'].join('\n');
}
function copyValePreview() {
  navigator.clipboard.writeText(document.getElementById('valePreviewText').textContent)
    .then(()=>showToast('Vale copiado ✓')).catch(()=>showToast('No se pudo copiar'));
}
function shareToAdminWA() {
  const text=buildValeText();const cfg=getConfig();const phone=cfg.adminPhone||'';
  const url=phone?`https://wa.me/${phone}?text=${encodeURIComponent(text)}`:`https://wa.me/?text=${encodeURIComponent(text)}`;
  window.open(url,'_blank');
}
function saveAdminPhone() {
  const phone=document.getElementById('adminPhoneInput').value.trim();
  const cfg=getConfig();cfg.adminPhone=phone;saveConfig(cfg);showToast('Número guardado ✓');
}
function resetForm() {
  ['vf-cliente','vf-telefono','vf-direccion','vf-mensajeria','vf-articulo',
   'vf-precioUSD','vf-precioCUP','vf-vuelto','vf-total','vf-garantia'].forEach(id=>{
    const el=document.getElementById(id);if(el)el.value='';
  });
  selectedProductsUI=[];currentValeProductos=[];renderSelectedProductsUI();onFormInput();
}

// ══════════════════════════════════════════
//  SEND VALE
// ══════════════════════════════════════════
function sendVale() {
  if(!activeGestorId){showToast('Selecciona tu nombre primero');return;}
  if(REQUIRED.some(id=>!fVal(id))){showToast('Completa los campos obligatorios (*)');return;}
  const g=gestorOf(activeGestorId);
  const vale={
    id:Date.now(),valeNum:getNextValeNum(),gestorId:activeGestorId,ts:new Date().toISOString(),
    cliente:fVal('vf-cliente'),telefono:fVal('vf-telefono'),direccion:fVal('vf-direccion'),
    mensajeria:fVal('vf-mensajeria'),articulo:fVal('vf-articulo'),
    precioUSD:fVal('vf-precioUSD'),precioCUP:fVal('vf-precioCUP'),
    vuelto:fVal('vf-vuelto'),total:fVal('vf-total'),garantia:fVal('vf-garantia'),
    valeProductos:currentValeProductos,valeText:buildValeText(),
    status:'pending',mensajeroId:null,confirmedTs:null,isNew:true,adminNotes:'',
  };
  const all=getVales();all.push(vale);saveVales(all);
  resetForm();renderGestores();renderMyVales();updateAdminBadge();
  playSound('vale');maybeAutoSync();
  sendBrowserNotif('AXONTECH – Nuevo vale',`${g.name} envió un vale para ${vale.cliente}`);
  showToast('Vale enviado al administrador ✓');
  if(adminActive){
    const _nbt=document.getElementById('notifBannerText'); if(_nbt)_nbt.textContent=`${g.name} acaba de enviar un vale`;
    const _nb=document.getElementById('notifBanner'); if(_nb)_nb.classList.add('show');
    renderAdminGestores();renderInbox();
  }
}

// ══════════════════════════════════════════
//  PRODUCT PICKER (gestor)
// ══════════════════════════════════════════
function openProductPicker() {
  if(!getProductos().length){showToast('El admin aún no ha cargado productos');return;}
  pickerSelected={};
  selectedProductsUI.forEach(p=>{pickerSelected[p.id]=p.qty;});
  pickerCatFilter=null;
  document.getElementById('pickerSearch').value='';
  renderPickerCatTabs();renderPickerProducts();renderPickerSelected();
  document.getElementById('productPickerModal').classList.add('show');
}
function closeProductPicker(){document.getElementById('productPickerModal').classList.remove('show');}
function renderPickerCatTabs() {
  const cats=getCategorias();
  document.getElementById('pickerCatTabs').innerHTML=
    `<button class="pcat-tab ${pickerCatFilter===null?'active':''}" onclick="setPickerCat(null)">Todos</button>`+
    cats.map(c=>`<button class="pcat-tab ${pickerCatFilter===c.id?'active':''}" onclick="setPickerCat(${c.id})">${c.name}</button>`).join('');
}
function setPickerCat(id){pickerCatFilter=id;renderPickerCatTabs();renderPickerProducts();}
function renderPickerProducts() {
  const search=document.getElementById('pickerSearch').value.toLowerCase();
  let prods=getProductos();
  if(pickerCatFilter!==null)prods=prods.filter(p=>p.catId===pickerCatFilter);
  if(search)prods=prods.filter(p=>p.name.toLowerCase().includes(search)||(p.description||'').toLowerCase().includes(search));
  const c=document.getElementById('pickerProductGrid');
  if(!prods.length){c.innerHTML='<div style="width:100%;text-align:center;padding:20px;color:var(--gray-400);">Sin productos disponibles</div>';return;}
  c.innerHTML=prods.map(p=>{
    const qty=pickerSelected[p.id]||0;
    const oos=(p.stock||0)===0;
    return `<div class="picker-pill ${qty>0?'selected':''} ${oos?'out-of-stock':''}" style="${oos?'pointer-events:none;':''}" ${oos?'title="Producto agotado"':''}>
      <div class="picker-pill-info">
        <div class="picker-pill-name">${p.name}${oos?` <span class="oos-badge">AGOTADO</span>`:''}</div>
        ${p.precio?`<div class="picker-pill-price">${p.precio}</div>`:''}
      </div>
      <div class="picker-pill-qty" style="${oos?'pointer-events:none;':''}">
        <button ${oos?'disabled':''} onclick="pickerAdj(${p.id},-1)">−</button>
        <span>${qty}</span>
        <button ${oos?'disabled':''} onclick="pickerAdj(${p.id},1)">+</button>
      </div>
    </div>`;
  }).join('');
}
function pickerAdj(pid,delta) {
  const prod=productoOf(pid);const max=prod?prod.stock||0:999;
  const cur=pickerSelected[pid]||0;const next=Math.max(0,Math.min(max,cur+delta));
  if(next===0)delete pickerSelected[pid];else pickerSelected[pid]=next;
  renderPickerProducts();renderPickerSelected();
}
function renderPickerSelected() {
  const items=Object.entries(pickerSelected).map(([id,qty])=>({id:parseInt(id),qty}));
  const c=document.getElementById('pickerSelectedList');
  if(!items.length){c.innerHTML='<span style="color:var(--gray-400);font-size:11px;">Ningún producto seleccionado</span>';return;}
  c.innerHTML=items.map(({id,qty})=>{
    const p=productoOf(id);
    return `<span style="background:var(--blue-lt);border:1px solid var(--blue-bd);border-radius:6px;padding:3px 8px;font-size:11px;display:inline-flex;align-items:center;gap:6px;margin:2px;">
      ${p?p.name:id} × ${qty}
      <button onclick="pickerAdj(${id},-99)" style="background:none;border:none;cursor:pointer;color:var(--red);font-size:14px;line-height:1;padding:0;">×</button>
    </span>`;
  }).join('');
}
function parsePrecioNum(str) {
  if(!str)return 0;
  const m=str.replace(/,/g,'').match(/\d+(\.\d+)?/);
  return m?parseFloat(m[0]):0;
}
function confirmPickerSelection() {
  const items=Object.entries(pickerSelected).map(([id,qty])=>{
    const p=productoOf(parseInt(id));return{id:parseInt(id),name:p?p.name:id,qty};
  });
  selectedProductsUI=items;currentValeProductos=items;
  renderSelectedProductsUI();
  document.getElementById('vf-articulo').value=items.map(i=>`${i.name} x${i.qty}`).join(' / ');
  // auto-sum prices
  let total=0;let cur='USD';
  items.forEach(({id,qty})=>{
    const p=productoOf(id);if(!p||!p.precio)return;
    total+=parsePrecioNum(p.precio)*qty;
    if(p.precio.includes('CUP'))cur='CUP';
  });
  if(total>0){
    const fmt=`$${total} ${cur}`;
    document.getElementById('vf-precioUSD').value=fmt;
    document.getElementById('vf-total').value=fmt;
  }
  // auto-fill garantia from first product that has one
  if(!document.getElementById('vf-garantia').value){
    const g=items.map(({id})=>productoOf(id)?.garantia).find(Boolean);
    if(g)document.getElementById('vf-garantia').value=g;
  }
  closeProductPicker();onFormInput();
}
function renderSelectedProductsUI() {
  const c=document.getElementById('selectedProductsList');
  if(!selectedProductsUI.length){c.style.display='none';return;}
  c.style.display='block';
  c.innerHTML=selectedProductsUI.map(i=>`<span class="tag-chip">${i.name} ×${i.qty}</span>`).join('')+
    `<button class="btn btn-ghost btn-sm" style="font-size:10px;padding:2px 8px;margin-left:4px;" onclick="openProductPicker()">✏️ Editar</button>`;
}

// ══════════════════════════════════════════
//  STOCK PANEL
// ══════════════════════════════════════════
function renderStockCategorias() {
  const cats=getCategorias();
  const prods=getProductos();
  const c=document.getElementById('categoriasList');
  c.innerHTML=
    `<button type="button" class="pcat-tab ${stockCatFilter===null?'active':''}" onclick="setStockCat(null)" style="flex-shrink:0;">
      📦 Todos <span style="opacity:.7;">(${prods.length})</span>
    </button>`+
    cats.map(cat=>{
      const count=prods.filter(p=>p.catId===cat.id).length;
      return `<button type="button" class="pcat-tab ${stockCatFilter===cat.id?'active':''}" onclick="setStockCat(${cat.id})" style="flex-shrink:0;">${cat.name} <span style="opacity:.7;">(${count})</span></button>`;
    }).join('');
  // Render cat manager list if visible
  const mgr=document.getElementById('catManagerList');
  if(mgr){
    mgr.innerHTML=cats.length?cats.map(cat=>{
      const count=prods.filter(p=>p.catId===cat.id).length;
      return `<div style="display:flex;align-items:center;justify-content:space-between;padding:7px 10px;background:var(--surface);border:1px solid var(--border);border-radius:8px;margin-bottom:5px;">
        <span style="font-size:12px;font-weight:600;">${cat.name} <span style="font-size:10px;color:var(--text-muted);">(${count} producto${count!==1?'s':''})</span></span>
        <button type="button" class="btn btn-sm" style="background:rgba(239,68,68,.1);color:var(--red);border:none;font-size:11px;padding:3px 9px;" onclick="removeCategoria(${cat.id})">🗑️ Borrar</button>
      </div>`;
    }).join(''):'<div style="font-size:12px;color:var(--text-muted);padding:6px 0;">Sin categorías creadas.</div>';
  }
}
let catManagerOpen=false;
function toggleCatManager(){
  catManagerOpen=!catManagerOpen;
  document.getElementById('catManagerPanel').style.display=catManagerOpen?'block':'none';
  document.getElementById('catManagerToggle').style.background=catManagerOpen?'var(--blue-lt)':'';
  document.getElementById('catManagerToggle').style.color=catManagerOpen?'var(--blue)':'';
  if(catManagerOpen)renderStockCategorias();
}
function setStockCat(id) {
  stockCatFilter=id;renderStockCategorias();renderProductGrid();
  const cats=getCategorias();const cat=cats.find(c=>c.id===id);
  document.getElementById('stockPanelTitle').textContent=id===null?'Todos los productos':cat?cat.name:'Categoría';
}
function addCategoria() {
  const inp=document.getElementById('newCatInput');const name=inp.value.trim();if(!name)return;
  const list=getCategorias();
  if(list.some(c=>c.name.toLowerCase()===name.toLowerCase())){showToast('Ya existe');return;}
  list.push({id:Date.now(),name});saveCategorias(list);inp.value='';renderStockCategorias();showToast('Categoría agregada');
}
function removeCategoria(id) {
  if(getProductos().some(p=>p.catId===id)){showToast('Primero mueve o elimina los productos de esta categoría');return;}
  if(!confirm('¿Eliminar esta categoría?'))return;
  saveCategorias(getCategorias().filter(c=>c.id!==id));
  if(stockCatFilter===id)stockCatFilter=null;
  renderStockCategorias();renderProductGrid();
  showToast('Categoría eliminada');
}
function buildProdCard(p, cats, isAgotado) {
  const cat=cats.find(c=>c.id===p.catId);
  const stockOk=(p.stock||0)>0;
  const isLow=stockOk&&(p.stock||0)<=LOW_STOCK_THRESHOLD;
  const stockColor=isAgotado?'var(--red)':isLow?'var(--yellow)':'var(--green)';
  return `<div class="prod-card${isAgotado?' agotado':''}" style="display:flex;align-items:center;gap:10px;padding:10px 12px;">
    <div style="width:52px;height:52px;border-radius:8px;overflow:hidden;background:var(--gray-100);display:flex;align-items:center;justify-content:center;flex-shrink:0;">
      ${p.photo
        ?`<img src="${p.photo}" alt="" style="width:100%;height:100%;object-fit:cover;" onerror="this.parentElement.innerHTML='<span style=font-size:22px>📦</span>'">`
        :`<span style="font-size:22px;">📦</span>`}
    </div>
    <div style="flex:1;min-width:0;">
      <div style="display:flex;align-items:baseline;gap:5px;flex-wrap:wrap;">
        <span class="prod-name" style="margin:0;font-size:13px;">${p.name}</span>
        ${cat?`<span class="prod-cat-tag" style="font-size:9px;">${cat.name}</span>`:''}
      </div>
      <div style="display:flex;align-items:center;gap:8px;margin-top:2px;flex-wrap:wrap;">
        ${p.precio?`<span class="prod-price" style="margin:0;font-size:11px;">${p.precio}</span>`:''}
        ${p.comision?`<span style="font-size:10px;color:var(--green);font-weight:600;">💰 ${p.comision}</span>`:''}
        ${p.garantia?`<span style="font-size:10px;color:var(--gray-400);">🛡️ ${p.garantia}</span>`:''}
      </div>
    </div>
    <div style="flex-shrink:0;display:flex;flex-direction:column;align-items:flex-end;gap:5px;">
      <span style="font-size:11px;font-weight:700;color:${stockColor};">Stock: ${p.stock||0}</span>
      <div style="display:flex;gap:4px;">
        ${isAgotado
          ? `<button class="btn btn-green btn-sm" onclick="adjustStock(${p.id})" style="font-size:10px;padding:3px 7px;">📥 Reponer</button>`
          : `<button class="btn btn-ghost btn-sm" onclick="openEditProductModal(${p.id})" style="font-size:10px;padding:3px 7px;">✏️</button>
             <button class="btn btn-ghost btn-sm" onclick="adjustStock(${p.id})" style="font-size:10px;padding:3px 7px;">📥</button>`
        }
        <button class="btn btn-ghost btn-sm" style="color:var(--red);font-size:10px;padding:3px 7px;" onclick="removeProducto(${p.id})">🗑️</button>
      </div>
    </div>
  </div>`;
}

function renderProductGrid() {
  let prods=getProductos();
  if(stockCatFilter!==null)prods=prods.filter(p=>p.catId===stockCatFilter);
  const cats=getCategorias();
  const c=document.getElementById('productGrid');
  if(!prods.length){
    c.innerHTML='<div class="es"><div class="es-icon">📦</div><div class="es-text">Sin productos. Haz clic en "+ Nuevo producto".</div></div>';return;
  }
  const activos=prods.filter(p=>(p.stock||0)>0);
  const agotados=prods.filter(p=>(p.stock||0)===0);
  const grid = s => `<div style="display:flex;flex-direction:column;gap:8px;">${s}</div>`;
  let html='';
  if(activos.length){
    html+=`<div class="stock-section-header">En stock <span style="background:var(--gray-100);border-radius:20px;font-size:9px;padding:2px 7px;">${activos.length}</span></div>`;
    html+=grid(activos.map(p=>buildProdCard(p,cats,false)).join(''));
  }
  if(agotados.length){
    html+=`<div class="stock-section-header">Agotados <span class="agotado-badge">${agotados.length}</span></div>`;
    html+=grid(agotados.map(p=>buildProdCard(p,cats,true)).join(''));
  }
  c.innerHTML=html;
}

// ══════════════════════════════════════════
//  PRODUCT MODAL
// ══════════════════════════════════════════
function populateCatSelect(selectedId) {
  const cats=getCategorias();
  document.getElementById('pm-cat').innerHTML=
    `<option value="">Sin categoría</option>`+
    cats.map(c=>`<option value="${c.id}" ${c.id===selectedId?'selected':''}>${c.name}</option>`).join('');
}
function openAddProductModal() {
  editingProductId=null;
  document.getElementById('productModalTitle').textContent='📦 Nuevo Producto';
  ['pm-name','pm-desc','pm-precio','pm-foto','pm-garantia','pm-comision'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  document.getElementById('pm-comision-amount').value='';
  document.getElementById('pm-comision-currency').value='USD';
  document.getElementById('pm-stock').value='0';document.getElementById('pm-puntos').value='0';
  document.getElementById('pm-foto-file').value='';
  document.getElementById('pm-fotoPreview').innerHTML='';
  populateCatSelect(null);document.getElementById('productModal').classList.add('show');
}
function openEditProductModal(id) {
  const p=productoOf(id);if(!p)return;
  editingProductId=id;
  document.getElementById('productModalTitle').textContent='✏️ Editar Producto';
  document.getElementById('pm-name').value=p.name||'';
  document.getElementById('pm-desc').value=p.description||'';
  document.getElementById('pm-precio').value=p.precio||'';
  document.getElementById('pm-stock').value=p.stock||0;
  document.getElementById('pm-puntos').value=p.puntos||0;
  document.getElementById('pm-garantia').value=p.garantia||'';
  document.getElementById('pm-comision').value=p.comision||'';
  // Parse comision into amount + currency fields
  {const com=p.comision||'';
   const isCUP=com.toUpperCase().includes('CUP');
   const num=parseFloat(com.replace(/[^0-9.]/g,''))||'';
   document.getElementById('pm-comision-amount').value=num;
   document.getElementById('pm-comision-currency').value=isCUP?'CUP':'USD';}
  document.getElementById('pm-foto').value=p.photo||'';
  document.getElementById('pm-foto-file').value='';
  populateCatSelect(p.catId);
  document.getElementById('pm-fotoPreview').innerHTML=p.photo?`<img src="${p.photo}" style="width:100%;height:80px;object-fit:cover;border-radius:6px;" onerror="this.style.display='none'">`:'';
  document.getElementById('productModal').classList.add('show');
}
function compressImage(dataUrl, maxPx, quality, cb) {
  const img = new Image();
  img.onload = () => {
    const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
    const w = Math.round(img.width * scale);
    const h = Math.round(img.height * scale);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d').drawImage(img, 0, 0, w, h);
    cb(c.toDataURL('image/jpeg', quality));
  };
  img.src = dataUrl;
}
function handleProductPhoto(input) {
  const file=input.files[0];if(!file)return;
  const reader=new FileReader();
  reader.onload=e=>{
    compressImage(e.target.result, 600, 0.72, compressed => {
      document.getElementById('pm-foto').value=compressed;
      document.getElementById('pm-fotoPreview').innerHTML=`<img src="${compressed}" style="width:100%;height:80px;object-fit:cover;border-radius:6px;">`;
    });
  };
  reader.readAsDataURL(file);
}
function closeProductModal(){document.getElementById('productModal').classList.remove('show');editingProductId=null;}
function saveProduct() {
  const name=document.getElementById('pm-name').value.trim();if(!name){showToast('El nombre es obligatorio');return;}
  const catVal=document.getElementById('pm-cat').value;
  const prod={
    name,description:document.getElementById('pm-desc').value.trim(),
    precio:document.getElementById('pm-precio').value.trim(),
    stock:parseInt(document.getElementById('pm-stock').value)||0,
    puntos:parseInt(document.getElementById('pm-puntos').value)||0,
    garantia:document.getElementById('pm-garantia').value.trim(),
    comision:(()=>{const amt=parseFloat(document.getElementById('pm-comision-amount').value);const cur=document.getElementById('pm-comision-currency').value;return amt>0?(cur==='CUP'?`${amt} CUP`:`$${amt} USD`):''})(),
    photo:document.getElementById('pm-foto').value.trim(),
    catId:catVal?parseInt(catVal):null,
  };
  if(editingProductId){
    const old=productoOf(editingProductId);
    patchProducto(editingProductId,prod);
    if(old&&old.stock===0&&prod.stock>0) addNotif('restocked',prod.name,editingProductId,`stock: ${prod.stock}`);
    showToast('Producto actualizado ✓');
  } else {
    const newId=Date.now();
    const list=getProductos();list.push({id:newId,...prod});saveProductos(list);
    addNotif('new_product',prod.name,newId,prod.precio||'');
    showToast('Producto agregado ✓');
  }
  closeProductModal();renderProductGrid();renderStockCategorias();maybeAutoSync();
}
function removeProducto(id) {
  if(!confirm('¿Eliminar este producto?'))return;
  saveProductos(getProductos().filter(p=>p.id!==id));
  renderProductGrid();renderStockCategorias();showToast('Producto eliminado');maybeAutoSync();
}
function adjustStock(id) {
  const p=productoOf(id);if(!p)return;
  const n=prompt(`Stock actual: ${p.stock||0}\nNuevo stock:`,p.stock||0);
  if(n===null)return;const num=parseInt(n);
  if(isNaN(num)||num<0){showToast('Número inválido');return;}
  const oldStock=p.stock||0;
  patchProducto(id,{stock:num});
  if(oldStock===0&&num>0) addNotif('restocked',p.name,id,`stock: ${num}`);
  else if(num===0&&oldStock>0) addNotif('out_of_stock',p.name,id,'stock agotado');
  else if(num>0&&num<=LOW_STOCK_THRESHOLD&&oldStock>LOW_STOCK_THRESHOLD) addNotif('low_stock',p.name,id,`quedan ${num}`);
  maybeAutoSync();
  renderProductGrid();showToast('Stock actualizado ✓');
}

// ══════════════════════════════════════════
//  STATS
// ══════════════════════════════════════════
function renderStats() {
  const from=document.getElementById('statsDateFrom').value;
  const to=document.getElementById('statsDateTo').value;
  let vales=getVales();
  if(from)vales=vales.filter(v=>v.ts.slice(0,10)>=from);
  if(to)  vales=vales.filter(v=>v.ts.slice(0,10)<=to);
  const total=vales.length;
  const confirmed=vales.filter(v=>v.status==='confirmed').length;
  const pending=vales.filter(v=>v.status==='pending').length;
  const assigned=vales.filter(v=>v.status==='assigned').length;
  document.getElementById('statsSummaryRow').innerHTML=[
    {label:'Total vales',val:total,color:'var(--blue)'},
    {label:'Confirmados',val:confirmed,color:'var(--green)'},
    {label:'Con mensajero',val:assigned,color:'var(--orange)'},
    {label:'Pendientes',val:pending,color:'var(--red)'},
  ].map(({label,val,color})=>`<div class="stat-card"><div class="stat-num" style="color:${color};">${val}</div><div class="stat-lbl">${label}</div></div>`).join('');
  // By gestor
  const gestores=getGestores();
  document.getElementById('statsGestorList').innerHTML=gestores.length?
    gestores.map(g=>{
      const gv=vales.filter(v=>v.gestorId===g.id);
      const gc=gv.filter(v=>v.status==='confirmed').length;
      const pts=gv.reduce((sum,v)=>(v.valeProductos||[]).reduce((s,p)=>{const pr=productoOf(p.id);return s+(pr?pr.puntos*p.qty:0);},sum),0);
      return `<div class="card" style="display:flex;align-items:center;gap:10px;padding:10px 14px;margin-bottom:6px;">
        <div class="g-avatar" style="background:${g.color};width:32px;height:32px;font-size:11px;">${g.initials}</div>
        <div style="flex:1;">
          <div style="font-size:13px;font-weight:700;">${g.name}</div>
          <div style="font-size:11px;color:var(--gray-400);">${gv.length} vales · ${gc} confirmados${pts?` · ⭐ ${pts} pts`:''}</div>
        </div>
      </div>`;
    }).join('') :
    '<div class="es"><div class="es-text">Sin gestores configurados</div></div>';
  // By product
  const prodCount={};
  vales.forEach(v=>(v.valeProductos||[]).forEach(({id,qty})=>{
    if(!prodCount[id])prodCount[id]={qty:0,confirmados:0};
    prodCount[id].qty+=qty;
    if(v.status==='confirmed')prodCount[id].confirmados+=qty;
  }));
  const sortedProds=Object.entries(prodCount).sort(([,a],[,b])=>b.qty-a.qty);
  document.getElementById('statsProductList').innerHTML=sortedProds.length?
    sortedProds.map(([id,{qty,confirmados}])=>{
      const p=productoOf(parseInt(id));
      return `<div class="card" style="padding:10px 14px;margin-bottom:6px;">
        <div style="font-size:13px;font-weight:700;">${p?p.name:`Producto ${id}`}</div>
        <div style="font-size:11px;color:var(--gray-400);">${qty} vendidos · ${confirmados} entregados</div>
      </div>`;
    }).join('') :
    '<div class="es"><div class="es-text">Sin datos de productos en el período</div></div>';

  // ── INVENTARIO ──
  const prods=getProductos();const cats=getCategorias();
  const enStock=prods.filter(p=>(p.stock||0)>0).length;
  const agotados=prods.filter(p=>(p.stock||0)===0).length;
  const stockBajo=prods.filter(p=>(p.stock||0)>0&&(p.stock||0)<=LOW_STOCK_THRESHOLD).length;
  let valorTotal=0;
  prods.forEach(p=>{const n=parsePrecioNum(p.precio||'');if(n>0)valorTotal+=n*(p.stock||0);});
  const valorStr=valorTotal>0?`$${valorTotal.toLocaleString('es-ES',{maximumFractionDigits:0})} USD`:'—';

  document.getElementById('statsInventarioRow').innerHTML=
    [{label:'Total productos',val:prods.length,color:'var(--blue)'},
     {label:'En stock',val:enStock,color:'var(--green)'},
     {label:'Agotados',val:agotados,color:'var(--red)'},
     {label:'Stock bajo',val:stockBajo,color:'var(--yellow)'}]
    .map(({label,val,color})=>
      `<div class="stat-card"><div class="stat-num" style="color:${color};">${val}</div><div class="stat-lbl">${label}</div></div>`
    ).join('')+
    (valorTotal>0?`<div class="stat-card" style="grid-column:1/-1;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:6px;">
      <div class="stat-lbl">💰 Valor total en inventario</div>
      <div style="font-size:20px;font-weight:900;color:var(--green);">${valorStr}</div>
    </div>`:'');

  // ── POR CATEGORÍA ──
  document.getElementById('statsCatList').innerHTML=cats.length?
    cats.map(cat=>{
      const cp=prods.filter(p=>p.catId===cat.id);
      const cs=cp.filter(p=>(p.stock||0)>0).length;
      const ca=cp.filter(p=>(p.stock||0)===0).length;
      const pct=cp.length?Math.round(cs/cp.length*100):0;
      return `<div class="card" style="padding:10px 14px;margin-bottom:6px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
          <span style="font-size:13px;font-weight:700;">${cat.name}</span>
          <span style="font-size:11px;color:var(--gray-400);">${cp.length} prods</span>
        </div>
        <div style="display:flex;gap:8px;align-items:center;">
          <div style="flex:1;background:var(--gray-100);border-radius:20px;height:8px;overflow:hidden;">
            <div style="width:${pct}%;height:100%;background:var(--green);border-radius:20px;transition:width .5s;"></div>
          </div>
          <span style="font-size:10px;color:var(--green);font-weight:700;white-space:nowrap;">${cs}✓</span>
          ${ca?`<span style="font-size:10px;color:var(--red);font-weight:700;white-space:nowrap;">${ca}✗</span>`:''}
        </div>
      </div>`;
    }).join(''):
    '<div class="es"><div class="es-text">Sin categorías</div></div>';

  // ── TOP VENDIDOS (histórico total) ──
  const allConf=getVales().filter(v=>['confirmed','pending_payment'].includes(v.status));
  const soldMap={};
  allConf.forEach(v=>(v.valeProductos||[]).forEach(({id,qty})=>{soldMap[id]=(soldMap[id]||0)+qty;}));
  const topSold=Object.entries(soldMap).sort(([,a],[,b])=>b-a).slice(0,7);
  const maxSold=topSold[0]?.[1]||1;
  document.getElementById('statsTopVendidos').innerHTML=topSold.length?
    topSold.map(([id,qty])=>{
      const p=productoOf(parseInt(id));
      const pct=Math.round(qty/maxSold*100);
      return `<div class="card" style="padding:10px 14px;margin-bottom:6px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">
          <span style="font-size:12px;font-weight:700;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${p?p.name:`Prod. ${id}`}</span>
          <span style="font-size:13px;font-weight:800;color:var(--blue);margin-left:8px;white-space:nowrap;">${qty} uds</span>
        </div>
        <div style="background:var(--gray-100);border-radius:20px;height:5px;overflow:hidden;">
          <div style="width:${pct}%;height:100%;background:var(--blue);border-radius:20px;"></div>
        </div>
      </div>`;
    }).join(''):
    '<div class="es"><div class="es-text">Sin ventas confirmadas aún</div></div>';
}

// ══════════════════════════════════════════
//  DEMO MODE
// ══════════════════════════════════════════
function loadDemo() {
  if (!confirm('¿Cargar datos de demostración?\nEsto reemplazará los datos actuales.')) return;

  // Gestores
  saveGestores([
    {id:1, name:'Carlos Mendoza',  initials:'CM', color:'#2563EB'},
    {id:2, name:'Ana López',       initials:'AL', color:'#7C3AED'},
    {id:3, name:'Pedro García',    initials:'PG', color:'#059669'},
    {id:4, name:'Laura Torres',    initials:'LT', color:'#DC2626'},
  ]);

  // Categorías
  saveCategorias([
    {id:10, name:'Electrónica'},
    {id:20, name:'Accesorios'},
    {id:30, name:'Computación'},
  ]);

  // Productos
  saveProductos([
    {id:100, name:'iPhone 15 Pro',     description:'Apple 256GB Titanio',      precio:'$950 USD',  stock:5,  puntos:10, garantia:'6 meses',  comision:'$15 USD', photo:'', catId:10},
    {id:101, name:'Samsung Galaxy S24',description:'Android 256GB',            precio:'$780 USD',  stock:3,  puntos:8,  garantia:'6 meses',  comision:'$12 USD', photo:'', catId:10},
    {id:102, name:'AirPods Pro 2',     description:'Auriculares inalámbricos', precio:'$180 USD',  stock:12, puntos:5,  garantia:'3 meses',  comision:'$5 USD',  photo:'', catId:20},
    {id:103, name:'Funda iPhone 15',   description:'Silicona premium',         precio:'$15 USD',   stock:25, puntos:1,  garantia:'',         comision:'$1 USD',  photo:'', catId:20},
    {id:104, name:'Laptop HP Victus',  description:'Core i5, 16GB RAM, 512GB', precio:'$680 USD',  stock:2,  puntos:15, garantia:'12 meses', comision:'$20 USD', photo:'', catId:30},
    {id:105, name:'Cargador MagSafe',  description:'65W Original',             precio:'$45 USD',   stock:0,  puntos:2,  garantia:'3 meses',  comision:'$2 USD',  photo:'', catId:20},
    {id:106, name:'Teclado Mecánico',  description:'RGB inalámbrico',          precio:'$95 USD',   stock:0,  puntos:4,  garantia:'6 meses',  comision:'$4 USD',  photo:'', catId:30},
  ]);

  // Mensajeros
  saveMensajeros([
    {id:50, name:'Jorge Ramírez'},
    {id:51, name:'Luis Herrera'},
  ]);

  // Vales en todos los estados
  const now   = new Date();
  const h     = (n) => new Date(now.getTime() - n*60*60*1000).toISOString();

  saveVales([
    { id:2001, gestorId:1, ts:h(0.5),  cliente:'Roberto Silva',   telefono:'55551234', direccion:'Calle 23 #456, Vedado',       mensajeria:'$2 USD',  articulo:'iPhone 15 Pro x1',    precioUSD:'$950 USD', precioCUP:'',        vuelto:'',      total:'$950 USD',  garantia:'6 meses', valeProductos:[{id:100,name:'iPhone 15 Pro',qty:1}],    valeText:'', status:'pending',         mensajeroId:null, confirmedTs:null,  isNew:true  },
    { id:2002, gestorId:2, ts:h(1.2),  cliente:'María Torres',    telefono:'55559876', direccion:'Av 5ta #88 e/8 y 10',         mensajeria:'Gratis',  articulo:'AirPods Pro 2 x2',    precioUSD:'$360 USD', precioCUP:'',        vuelto:'',      total:'$360 USD',  garantia:'3 meses', valeProductos:[{id:102,name:'AirPods Pro 2',qty:2}],    valeText:'', status:'assigned',        mensajeroId:50,   confirmedTs:null,  deliveredTs:null,  isNew:false },
    { id:2007, gestorId:3, ts:h(1.8),  cliente:'Diana Vázquez',   telefono:'55552468', direccion:'Neptuno #89, Centro Habana',   mensajeria:'$2 USD',  articulo:'Laptop HP Victus x1', precioUSD:'$680 USD', precioCUP:'',        vuelto:'',      total:'$680 USD',  garantia:'12 meses',valeProductos:[{id:104,name:'Laptop HP Victus',qty:1}],  valeText:'', status:'delivered',       mensajeroId:51,   confirmedTs:null,  deliveredTs:h(0.3),isNew:false },
    { id:2003, gestorId:1, ts:h(2.0),  cliente:'Luis Pérez',      telefono:'55554321', direccion:'Obispo #12, Habana Vieja',    mensajeria:'$1 USD',  articulo:'Funda iPhone 15 x3',  precioUSD:'$45 USD',  precioCUP:'4050 CUP',vuelto:'0',     total:'$45 USD',   garantia:'',         valeProductos:[{id:103,name:'Funda iPhone 15',qty:3}],  valeText:'', status:'confirmed',       mensajeroId:51,   confirmedTs:h(0.8),isNew:false },
    { id:2004, gestorId:3, ts:h(3.1),  cliente:'Carmen Díaz',     telefono:'55557890', direccion:'23 y 12 #234, Vedado',        mensajeria:'$2 USD',  articulo:'Samsung Galaxy S24 x1',precioUSD:'$780 USD',precioCUP:'',        vuelto:'',      total:'$780 USD',  garantia:'6 meses', valeProductos:[{id:101,name:'Samsung Galaxy S24',qty:1}],valeText:'', status:'pending_payment', mensajeroId:50,   confirmedTs:null,  isNew:false },
    { id:2005, gestorId:4, ts:h(4.5),  cliente:'Oscar Fernández', telefono:'55553456', direccion:'Línea #78 esq L',             mensajeria:'$3 USD',  articulo:'Laptop HP Victus x1', precioUSD:'$680 USD', precioCUP:'',        vuelto:'',      total:'$680 USD',  garantia:'12 meses',valeProductos:[{id:104,name:'Laptop HP Victus',qty:1}],  valeText:'', status:'pending',         mensajeroId:null, confirmedTs:null,  isNew:true  },
    { id:2006, gestorId:2, ts:h(5.0),  cliente:'Yolanda Cruz',    telefono:'55558765', direccion:'Reina #302, Centro Habana',   mensajeria:'Gratis',  articulo:'iPhone 15 Pro x1',    precioUSD:'$950 USD', precioCUP:'',        vuelto:'',      total:'$950 USD',  garantia:'6 meses', valeProductos:[{id:100,name:'iPhone 15 Pro',qty:1}],    valeText:'', status:'confirmed',       mensajeroId:51,   confirmedTs:h(3.0),isNew:false },
  ]);

  // Notificaciones de ejemplo
  saveNotifs([
    {id:3001, type:'new_product',  productName:'iPhone 15 Pro',   productId:100, ts:h(0.2), read:false, extra:'$950 USD'},
    {id:3002, type:'low_stock',    productName:'Laptop HP Victus', productId:104, ts:h(1.0), read:false, extra:'quedan 2'},
    {id:3003, type:'out_of_stock', productName:'Cargador MagSafe', productId:105, ts:h(2.5), read:false, extra:'stock agotado'},
    {id:3004, type:'restocked',    productName:'Samsung Galaxy S24',productId:101,ts:h(4.0), read:true,  extra:'stock: 3'},
  ]);

  // Reload everything
  activeGestorId=null; activeMensajeroId=null; adminActive=false; selectedValeId=null;
  adminGestorFilter=null; inboxFilter='all'; selectedProductsUI=[]; currentValeProductos=[];
  rankingCache=null;gestoresTabDirty=true;statsTabDirty=true;
  const _la=document.getElementById('layoutAdmin'); if(_la)_la.classList.remove('active');
  const _lg=document.getElementById('layoutGestor'); if(_lg){_lg.classList.remove('has-gestor');_lg.classList.add('active');}
  const _ba=document.getElementById('btnAdminAccess'); if(_ba)_ba.style.display='flex';
  const _al=document.getElementById('adminLabel'); if(_al)_al.style.display='none';
  const _bl=document.getElementById('btnLogout'); if(_bl)_bl.style.display='none';
  const _hn=document.getElementById('headerGestorName'); if(_hn)_hn.textContent='';
  const _bav=document.getElementById('bannerAvatar'); if(_bav){_bav.textContent='?';_bav.style.background='var(--gray-300)';}
  const _blbl=document.getElementById('bannerLbl'); if(_blbl)_blbl.textContent='SELECCIONA TU NOMBRE';
  const _bnm=document.getElementById('bannerName'); if(_bnm)_bnm.textContent='Selecciona tu nombre →';
  resetForm();
  renderGestores();
  renderGestorNotifs();
  renderGestorRanking();
  updateAdminBadge();updateMensajeroBadge();
  showToast('🎮 Datos de demo cargados ✓ — contraseña admin: axon2024');
}

function buildDemoVale(v) {
  const g=gestorOf(v.gestorId);
  return ['Bienvenido a "AXONTECH" 🔥','','VALE DEL GESTOR:','',
    `🔸Promotor: ${g?g.name:''}`, '',
    `🔸 Nombre Cliente: ${v.cliente}`,`🔸Teléfono Cliente: ${v.telefono}`,
    `🔸Dirección Cliente: ${v.direccion}`,`🔸Mensajería/ costo: ${v.mensajeria}`,
    `🔸 Artículo y cantidad: ${v.articulo}`,`🔸Precio USD/ zelle: ${v.precioUSD}`,
    `🔸Precio CUP: ${v.precioCUP}`,`🔸 Vuelto: ${v.vuelto}`,`🔸 Total a pagar: ${v.total}`,'',
    `*Garantía: ${v.garantia}`,`*Fecha y hora de Venta: ${new Date(v.ts).toLocaleString('es-ES')}`,'',
    '🧭Dirección de la tienda:','* Amistad #313% San Rafael y San José, Centro Habana.','',
    '🚨ATENCIÓN🚨','•   Horarios de atención: 8:00am - 8:00pm.'].join('\n');
}

// ══════════════════════════════════════════
//  MENSAJERO BADGE
// ══════════════════════════════════════════
function updateMensajeroBadge() {
  const pend=getVales().filter(v=>v.status==='pending_payment').length;
  const asgn=getVales().filter(v=>v.status==='assigned').length;
  const b=document.getElementById('mensajeroBadge');
  if(!b)return;
  if(pend>0){
    b.textContent=pend;b.style.display='inline-block';
    b.style.background='var(--red)';
  } else if(asgn>0){
    b.textContent=asgn;b.style.display='inline-block';
    b.style.background='var(--green)';
  } else {
    b.style.display='none';
  }
}

// ══════════════════════════════════════════
//  GESTOR CATALOG
// ══════════════════════════════════════════
function openGestorCatalog() {
  const prods=getProductos().filter(p=>(p.stock||0)>0);
  if(!prods.length){showToast('No hay productos disponibles');return;}
  catalogCatFilter=null;expandedCatalogId=null;
  document.getElementById('catalogSearch').value='';
  renderCatalogCatTabs();renderGestorCatalog();
  document.getElementById('gestorCatalogModal').classList.add('show');
}
function toggleCatalogItem(id){expandedCatalogId=expandedCatalogId===id?null:id;renderGestorCatalog();}
function renderCatalogCatTabs() {
  const cats=getCategorias();
  document.getElementById('catalogCatTabs').innerHTML=
    `<button class="pcat-tab ${catalogCatFilter===null?'active':''}" onclick="setCatalogCat(null)">Todos</button>`+
    cats.map(c=>`<button class="pcat-tab ${catalogCatFilter===c.id?'active':''}" onclick="setCatalogCat(${c.id})">${c.name}</button>`).join('');
}
function setCatalogCat(id){catalogCatFilter=id;renderCatalogCatTabs();renderGestorCatalog();}
function renderGestorCatalog() {
  const search=document.getElementById('catalogSearch').value.toLowerCase();
  let prods=getProductos().filter(p=>(p.stock||0)>0);
  if(catalogCatFilter!==null)prods=prods.filter(p=>p.catId===catalogCatFilter);
  if(search)prods=prods.filter(p=>p.name.toLowerCase().includes(search));
  const c=document.getElementById('gestorCatalogList');
  if(!prods.length){c.innerHTML='<div class="es"><div class="es-icon">📦</div><div class="es-text">Sin productos</div></div>';return;}
  c.innerHTML=prods.map(p=>{
    const exp=expandedCatalogId===p.id;
    return `<div style="border:1px solid var(--${exp?'blue':'gray-200'});border-radius:8px;margin-bottom:6px;overflow:hidden;cursor:pointer;transition:border-color .15s;" onclick="toggleCatalogItem(${p.id})">
      <div style="display:flex;align-items:center;gap:10px;padding:8px;">
        ${p.photo?`<img src="${p.photo}" style="width:52px;height:52px;object-fit:cover;border-radius:6px;flex-shrink:0;" onerror="this.parentElement.querySelector('img').style.display='none'">`:`<div style="width:52px;height:52px;border-radius:6px;background:var(--gray-100);display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0;">📦</div>`}
        <div style="flex:1;min-width:0;">
          <div style="font-weight:700;font-size:13px;color:var(--text);">${p.name}</div>
          ${p.precio?`<div style="color:var(--blue);font-weight:700;font-size:12px;margin-top:2px;">${p.precio}</div>`:''}
        </div>
        <div style="font-size:13px;color:var(--gray-400);flex-shrink:0;margin-left:4px;">${exp?'▲':'▼'}</div>
      </div>
      ${exp?`<div style="padding:8px 12px 12px;border-top:1px solid var(--gray-200);background:var(--gray-50);">
        ${p.description?`<div style="font-size:12px;color:var(--text-muted);margin-bottom:10px;white-space:pre-line;line-height:1.5;">${p.description}</div>`:''}
        <div style="display:flex;flex-wrap:wrap;gap:5px;font-size:11px;">
          <span style="background:var(--blue-lt);color:var(--blue);padding:3px 9px;border-radius:10px;font-weight:700;">📦 Disponibles: ${p.stock}</span>
          ${p.garantia?`<span style="background:var(--gray-100);color:var(--gray-600);padding:3px 9px;border-radius:10px;">🛡️ ${p.garantia}</span>`:''}
          ${p.comision?`<span style="background:#f0fdf4;color:var(--green);padding:3px 9px;border-radius:10px;font-weight:600;">Comisión: ${p.comision}</span>`:''}
          ${p.puntos?`<span style="background:var(--blue-lt);color:var(--blue);padding:3px 9px;border-radius:10px;">⭐ ${p.puntos} pts</span>`:''}
        </div>
      </div>`:''}
    </div>`;
  }).join('');
}

// ══════════════════════════════════════════
//  COMISIONES
// ══════════════════════════════════════════
function toggleComisionGestor(id) {
  activeComisionGestorId=activeComisionGestorId===id?null:id;
  renderComisiones();
}
function getValeCommissionParts(v) {
  const items=v.valeProductos||[];
  const parts=[];let total=0;let currency='USD';let computable=true;
  items.forEach(({id,qty})=>{
    const p=productoOf(id);if(!p)return;
    const com=p.comision||'';
    if(!com)return;
    const label=`${p.name}${qty>1?` ×${qty}`:''}`;
    // Try to parse fixed amount
    const isPct=com.includes('%');
    if(isPct){
      // percentage: try to compute from precio
      const pct=parseFloat(com.replace(/[^0-9.]/g,''));
      const priceNum=parsePrecioNum(p.precio||'');
      if(!isNaN(pct)&&priceNum>0){
        const amt=Math.round(priceNum*(pct/100)*qty*100)/100;
        total+=amt;
        parts.push({label,com:`${pct}% = $${amt.toFixed(2)}`});
        if((p.precio||'').includes('CUP'))currency='CUP';
      } else {
        parts.push({label,com});computable=false;
      }
    } else {
      const num=parsePrecioNum(com);
      if(num>0){total+=num*qty;parts.push({label,com:`${com}${qty>1?` ×${qty}`:''}`});}
      else{parts.push({label,com});computable=false;}
      if(com.includes('CUP'))currency='CUP';
    }
  });
  return{parts,total:computable&&parts.length?total:null,currency};
}
function payCommission(valeId,e) {
  if(e)e.stopPropagation();
  patchVale(valeId,{commissionPaid:true,commissionPaidTs:new Date().toISOString()});
  gestoresTabDirty=true;
  renderComisiones();maybeAutoSync();
  showToast('Comisión marcada como pagada ✓');
}
function payAllCommissions(gestorId,e) {
  if(e)e.stopPropagation();
  const ts=new Date().toISOString();
  getVales().filter(v=>v.gestorId===gestorId&&!v.commissionPaid&&['confirmed','pending_payment'].includes(v.status))
    .forEach(v=>patchVale(v.id,{commissionPaid:true,commissionPaidTs:ts}));
  gestoresTabDirty=true;
  renderComisiones();maybeAutoSync();
  showToast('Todas las comisiones pagadas ✅');
}
function unpayCommission(valeId,e) {
  if(e)e.stopPropagation();
  patchVale(valeId,{commissionPaid:false,commissionPaidTs:null});
  gestoresTabDirty=true;
  renderComisiones();
}
function renderComisiones() {
  const c=document.getElementById('adminComisionesList');if(!c)return;
  const gestores=getGestores();
  if(!gestores.length){c.innerHTML='<div class="es"><div class="es-text">Sin gestores configurados</div></div>';return;}
  c.innerHTML=gestores.map(g=>{
    const allVales=getVales().filter(v=>v.gestorId===g.id&&['confirmed','pending_payment'].includes(v.status));
    const pending=allVales.filter(v=>!v.commissionPaid);
    const paid=allVales.filter(v=>v.commissionPaid);
    const isOpen=activeComisionGestorId===g.id;
    // Compute grand total for pending split by currency
    let gtUSD=0,gtCUP=0,gtAllComputed=true;
    pending.forEach(v=>{const r=getValeCommissionParts(v);if(r.total===null){gtAllComputed=false;}else{if(r.currency==='CUP')gtCUP+=r.total;else gtUSD+=r.total;}});
    const gtBadgeParts=[];if(gtUSD>0)gtBadgeParts.push(`$${gtUSD.toFixed(2)} USD`);if(gtCUP>0)gtBadgeParts.push(`${Math.round(gtCUP)} CUP`);
    const gtBadge=gtAllComputed&&gtBadgeParts.length?gtBadgeParts.join(' + '):null;
    return `<div class="card" style="padding:0;overflow:hidden;margin-bottom:8px;border-color:${isOpen?'var(--blue)':'var(--border)'};">
      <div onclick="toggleComisionGestor(${g.id})" style="display:flex;align-items:center;gap:10px;padding:12px 14px;cursor:pointer;background:${isOpen?'var(--blue-lt)':'var(--surface)'};">
        <div class="g-avatar" style="background:${g.color};width:34px;height:34px;font-size:11px;flex-shrink:0;">${g.initials}</div>
        <div style="flex:1;min-width:0;">
          <div style="font-weight:700;font-size:13px;">${g.name}</div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:1px;">
            ${pending.length>0?`<span style="color:var(--orange);font-weight:700;">${pending.length} pendiente${pending.length!==1?'s':''}</span>`:''}
            ${paid.length>0?`<span style="color:var(--green);">· ${paid.length} pagada${paid.length!==1?'s':''}</span>`:''}
            ${!pending.length&&!paid.length?'Sin comisiones por cobrar':''}
          </div>
        </div>
        ${gtBadge?`<span style="background:var(--orange);color:white;border-radius:20px;font-size:10px;font-weight:700;padding:3px 9px;white-space:nowrap;">${gtBadge}</span>`:''}
        ${pending.length>0&&!gtBadge?`<span style="background:var(--orange);color:white;border-radius:20px;font-size:10px;font-weight:700;padding:3px 9px;">${pending.length}</span>`:''}
        <span style="color:var(--gray-400);font-size:13px;flex-shrink:0;">${isOpen?'▲':'▼'}</span>
      </div>
      ${isOpen?renderComisionBody(g,pending,paid):''}
    </div>`;
  }).join('');
}
function renderComisionBody(g,pending,paid) {
  let html='<div style="border-top:1px solid var(--border);padding:12px 14px;">';
  if(!pending.length&&!paid.length){
    html+='<div class="es" style="padding:8px 0;"><div class="es-text">Sin vales confirmados con comisión</div></div>';
  } else {
    // ── PENDING ──
    if(pending.length){
      // Total summary
      let sumUSD=0,sumCUP=0,canSum=true;
      pending.forEach(v=>{const r=getValeCommissionParts(v);if(r.total===null){canSum=false;}else{if(r.currency==='CUP')sumCUP+=r.total;else sumUSD+=r.total;}});
      const sumParts=[];if(sumUSD>0)sumParts.push(`$${sumUSD.toFixed(2)} USD`);if(sumCUP>0)sumParts.push(`${Math.round(sumCUP)} CUP`);
      html+=`<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;flex-wrap:wrap;gap:6px;">
        <span style="font-size:11px;font-weight:700;color:var(--orange);text-transform:uppercase;letter-spacing:.5px;">⏳ Por pagar (${pending.length})</span>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
          ${canSum&&sumParts.length?`<span style="font-size:13px;font-weight:800;color:var(--green);">💵 ${sumParts.join(' + ')}</span>`:''}
          ${pending.length>1?`<button class="btn btn-green btn-sm" onclick="payAllCommissions(${g.id},event)">✅ Pagar todas</button>`:''}
        </div>
      </div>`;
      html+=pending.map(v=>{
        const r=getValeCommissionParts(v);
        return `<div style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:var(--surface2);border:1px solid var(--border);border-radius:9px;margin-bottom:6px;">
          <div style="flex:1;min-width:0;">
            <div style="font-size:12px;font-weight:700;color:var(--text);">${v.cliente||'—'}</div>
            <div style="font-size:10px;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${v.articulo||'—'}</div>
            <div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:4px;">
              ${r.parts.length?r.parts.map(p=>`<span style="background:rgba(16,185,129,.12);color:var(--green);border-radius:20px;padding:1px 8px;font-size:10px;font-weight:600;">${p.label}: ${p.com}</span>`).join(''):`<span style="color:var(--gray-400);font-size:10px;">Sin comisión definida</span>`}
            </div>
          </div>
          <button class="btn btn-green btn-sm" style="flex-shrink:0;" onclick="payCommission(${v.id},event)">✓ Pagar</button>
        </div>`;
      }).join('');
    }
    // ── PAID ──
    if(paid.length){
      html+=`<div style="margin-top:${pending.length?'14px':'0'};">
        <div style="font-size:10px;font-weight:700;color:var(--green);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px;">✅ Pagadas (${paid.length})</div>`;
      html+=paid.map(v=>{
        const r=getValeCommissionParts(v);
        const ts=v.commissionPaidTs?new Date(v.commissionPaidTs).toLocaleDateString('es-ES',{day:'2-digit',month:'short'})+' '+timeStr(v.commissionPaidTs):'';
        return `<div style="display:flex;align-items:center;gap:8px;padding:6px 10px;background:rgba(16,185,129,.05);border:1px solid rgba(16,185,129,.2);border-radius:8px;margin-bottom:4px;opacity:.85;">
          <div style="flex:1;min-width:0;">
            <div style="font-size:11px;font-weight:600;color:var(--text-muted);">${v.cliente||'—'}</div>
            ${r.parts.length?`<div style="display:flex;flex-wrap:wrap;gap:3px;margin-top:2px;">${r.parts.map(p=>`<span style="background:rgba(16,185,129,.1);color:var(--green);border-radius:20px;padding:1px 7px;font-size:9px;font-weight:600;">${p.com}</span>`).join('')}</div>`:''}
          </div>
          <div style="text-align:right;flex-shrink:0;">
            <div style="font-size:9px;color:var(--green);font-weight:700;">✓ Pagado</div>
            ${ts?`<div style="font-size:9px;color:var(--gray-400);">${ts}</div>`:''}
            <button style="background:none;border:none;cursor:pointer;font-size:9px;color:var(--gray-400);padding:2px 0;margin-top:2px;" onclick="unpayCommission(${v.id},event)">↩ Revertir</button>
          </div>
        </div>`;
      }).join('');
      html+='</div>';
    }
  }
  html+='</div>';
  return html;
}

// ══════════════════════════════════════════
//  GESTOR RANKING
// ══════════════════════════════════════════
function renderGestorRanking() {
  const c=document.getElementById('rankingList');if(!c)return;
  const gestores=getGestores();
  if(!gestores.length){c.innerHTML='<div class="es"><div class="es-text">Sin gestores configurados</div></div>';return;}
  const meta=getConfig().metaPuntos||0;
  if(rankingCache&&(Date.now()-rankingCache.ts<15000)){c.innerHTML=rankingCache.html;return;}
  const vales=getVales().filter(v=>['confirmed','pending_payment'].includes(v.status));
  const ranked=gestores.map(g=>{
    const pts=vales.filter(v=>v.gestorId===g.id).reduce((sum,v)=>
      sum+(v.valeProductos||[]).reduce((s,p)=>{const pr=productoOf(p.id);return s+(pr?pr.puntos*p.qty:0);},0),0);
    return{...g,pts};
  }).sort((a,b)=>b.pts-a.pts);
  const medals=['🥇','🥈','🥉'];
  const barGradients=[
    'linear-gradient(90deg,#F59E0B,#EF4444)',
    'linear-gradient(90deg,#94A3B8,#64748B)',
    'linear-gradient(90deg,#cd7f32,#b36200)',
    'linear-gradient(90deg,#00b4d8,#0284c7)',
    'linear-gradient(90deg,#6366f1,#818cf8)',
    'linear-gradient(90deg,#ec4899,#f472b6)',
  ];
  const maxRef=meta>0?meta:Math.max(ranked[0]?.pts||1,1);
  let html='';
  if(meta>0){
    const reached=ranked.filter(g=>g.pts>=meta).length;
    html+=`<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;padding-bottom:10px;border-bottom:1px solid var(--gray-200);">
      <span style="font-size:11px;font-weight:700;color:var(--gray-400);text-transform:uppercase;letter-spacing:.5px;">🎯 Meta: ${meta} pts</span>
      <span style="font-size:11px;font-weight:600;color:${reached>0?'var(--green)':'var(--gray-400)'};">${reached}/${ranked.length} alcanzaron</span>
    </div>`;
  }
  html+=ranked.map((g,i)=>{
    const pct=maxRef>0?Math.min(100,Math.round((g.pts/maxRef)*100)):0;
    const reached=meta>0&&g.pts>=meta;
    const grad=reached?'linear-gradient(90deg,var(--green),#10B981)':barGradients[Math.min(i,barGradients.length-1)];
    const pos=reached?'🏆':(medals[i]||`${i+1}.`);
    const hint=meta>0
      ?(reached?`<span style="color:var(--green);">¡Meta alcanzada! 🎉</span>`:`faltan <b>${meta-g.pts} pts</b> para la meta`)
      :(g.pts>0?`${pct}% del líder`:'Aún sin puntos');
    return `<div class="rank-row">
      <div class="rank-pos">${pos}</div>
      <div style="flex:1;min-width:0;">
        <div style="display:flex;align-items:center;gap:8px;">
          <div class="g-avatar" style="background:${g.color};width:28px;height:28px;font-size:10px;flex-shrink:0;">${g.initials}</div>
          <span class="rank-name">${g.name}</span>
          <span class="rank-pts" style="${reached?'color:var(--green);':''}">${g.pts} pts</span>
        </div>
        <div class="rank-bar-wrap"><div class="rank-bar" style="width:${pct}%;background:${grad};"></div></div>
        <div class="rank-hint">${hint}</div>
      </div>
    </div>`;
  }).join('');
  c.innerHTML=html;
  rankingCache={html,ts:Date.now()};
}

// ══════════════════════════════════════════
//  SYNC FROM TIENDAMAX FILES
// ══════════════════════════════════════════
async function syncFromTiendaMax() {
  const statusEl = document.getElementById('syncTiendaMaxStatus');
  statusEl.innerHTML = '<span style="color:var(--blue);">⏳ Cargando archivos...</span>';
  try {
    const [prodsRes, catsRes] = await Promise.all([
      fetch('./productos.json'),
      fetch('./categorias.json')
    ]);
    if (!prodsRes.ok || !catsRes.ok) throw new Error('No se encontraron los archivos');
    const tmProds = await prodsRes.json();
    const tmCats  = await catsRes.json();

    // Build categorias
    const catNames = tmCats.nombres || [];
    const catMap = {};
    const categorias = catNames.map((name, i) => {
      const id = (i + 1) * 10;
      catMap[name] = id;
      return { id, name: name.charAt(0) + name.slice(1).toLowerCase() };
    });

    // Convert productos
    const productos = tmProds.map(p => {
      const precio = p.precioActual || 0;
      const com    = p.comision    || 0;
      const catId  = catMap[p.categoria] || null;
      const subcat = p.subcategoria || '';
      let desc = p.descripcion || '';
      if (subcat && !desc.includes(subcat)) desc = `[${subcat}]\n${desc}`;
      return {
        id:          p.id,
        name:        p.nombre,
        description: desc,
        precio:      precio ? `$${precio} USD` : '',
        stock:       p.stock || 0,
        puntos:      Math.max(1, Math.round(com / 5)),
        garantia:    p.garantia || '',
        comision:    com ? `$${com} USD` : '',
        photo:       p.imagen || '',
        catId
      };
    });

    saveCategorias(categorias);
    saveProductos(productos);
    gestoresTabDirty = true; statsTabDirty = true; rankingCache = null;
    renderStockCategorias(); renderProductGrid();
    statusEl.innerHTML = `<span style="color:var(--green);">✓ ${productos.length} productos y ${categorias.length} categorías cargados</span>`;
    showToast(`✓ ${productos.length} productos importados desde TiendaMax`);
    maybeAutoSync();
  } catch(e) {
    statusEl.innerHTML = `<span style="color:var(--red);">✗ ${e.message}</span>`;
    showToast('Error al leer los archivos de TiendaMax');
  }
}

// ══════════════════════════════════════════
//  GITHUB SYNC
// ══════════════════════════════════════════
function exportData() {
  const data={
    gestores:getGestores(),mensajeros:getMensajeros(),
    productos:getProductos(),categorias:getCategorias(),
    vales:getVales(),notifs:getNotifs(),
    timestamp:new Date().toISOString(),version:1
  };
  const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;a.download=`axontech-data-${new Date().toISOString().slice(0,10)}.json`;
  document.body.appendChild(a);a.click();document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('Datos exportados ✓');
}
function importData(input) {
  const file=input.files[0];if(!file)return;
  if(!confirm(`¿Importar datos desde "${file.name}"?\nEsto reemplazará todos los datos locales actuales.`)){input.value='';return;}
  const reader=new FileReader();
  reader.onload=e=>{
    try {
      const data=JSON.parse(e.target.result);
      if(data.gestores)saveGestores(data.gestores);
      if(data.mensajeros)saveMensajeros(data.mensajeros);
      if(data.productos)saveProductos(data.productos);
      if(data.categorias)saveCategorias(data.categorias);
      if(data.vales)saveVales(data.vales);
      if(data.notifs)saveNotifs(data.notifs);
      // Reload UI
      activeGestorId=null;activeMensajeroId=null;selectedValeId=null;adminGestorFilter=null;
      expandedCatalogId=null;activeComisionGestorId=null;
      rankingCache=null;gestoresTabDirty=true;statsTabDirty=true;
      renderGestores();renderGestorRanking();renderGestorNotifs();
      renderAdminGestores();renderInbox();renderValeDetail();
      renderAdminGestoresList();renderComisiones();
      renderMensajeros();renderMensajeroSelector();
      renderStockCategorias();renderProductGrid();
      updateAdminBadge();updateMensajeroBadge();
      showToast('Datos importados correctamente ✓');
    } catch(err) {
      showToast('Error: archivo JSON inválido');
    }
    input.value='';
  };
  reader.readAsText(file);
}
function saveMetaPuntos() {
  const val=parseInt(document.getElementById('cfg-meta-puntos').value);
  if(!val||val<1){showToast('Ingresa un número válido');return;}
  const cfg=getConfig();cfg.metaPuntos=val;saveConfig(cfg);
  const s=document.getElementById('metaPuntosStatus');
  if(s)s.innerHTML=`<span style="color:var(--green);">✓ Meta fijada en ${val} pts</span>`;
  renderGestorRanking();
  showToast(`Meta fijada: ${val} puntos ⭐`);
}
function saveGhConfig() {
  const cfg=getConfig();
  cfg.ghToken=document.getElementById('gh-token').value.trim();
  cfg.ghRepo=document.getElementById('gh-repo').value.trim();
  cfg.ghPath=document.getElementById('gh-path').value.trim()||'data/axontech.json';
  cfg.ghAutoSync=document.getElementById('gh-autosync').checked;
  saveConfig(cfg);
  showToast('Configuración GitHub guardada ✓');
}
function loadGhConfigUI() {
  const cfg=getConfig();
  const tok=document.getElementById('gh-token');
  const repo=document.getElementById('gh-repo');
  const path=document.getElementById('gh-path');
  const auto=document.getElementById('gh-autosync');
  const meta=document.getElementById('cfg-meta-puntos');
  const metaStatus=document.getElementById('metaPuntosStatus');
  if(tok)tok.value=cfg.ghToken||'';
  if(repo)repo.value=cfg.ghRepo||'';
  if(path)path.value=cfg.ghPath||'data/axontech.json';
  if(auto)auto.checked=!!cfg.ghAutoSync;
  if(meta)meta.value=cfg.metaPuntos||'';
  if(metaStatus&&cfg.metaPuntos)metaStatus.innerHTML=`<span style="color:var(--green);">✓ Meta actual: ${cfg.metaPuntos} pts</span>`;
}
async function syncToGitHub(silent) {
  const cfg=getConfig();
  if(!cfg.ghToken||!cfg.ghRepo||!cfg.ghPath){if(!silent)showToast('Configura GitHub primero en ⚙️ Config');return;}
  const statusEl=document.getElementById('ghSyncStatus');
  if(statusEl&&!silent)statusEl.innerHTML='<span style="color:var(--blue);">⟳ Sincronizando...</span>';
  try {
    const data={
      gestores:getGestores(),mensajeros:getMensajeros(),
      productos:getProductos(),categorias:getCategorias(),
      vales:getVales(),timestamp:new Date().toISOString()
    };
    const json=JSON.stringify(data,null,2);
    const content=btoa(unescape(encodeURIComponent(json)));
    const parts=cfg.ghRepo.split('/');const owner=parts[0];const repo=parts.slice(1).join('/');
    const url=`https://api.github.com/repos/${owner}/${repo}/contents/${cfg.ghPath}`;
    const headers={Authorization:`token ${cfg.ghToken}`,Accept:'application/vnd.github.v3+json','Content-Type':'application/json'};
    let sha;
    try{const r=await fetch(url,{headers});if(r.ok){const j=await r.json();sha=j.sha;}}catch(e){}
    const body={message:`AXONTECH sync ${new Date().toLocaleString('es-ES')}`,content};
    if(sha)body.sha=sha;
    const res=await fetch(url,{method:'PUT',headers,body:JSON.stringify(body)});
    if(res.ok){
      const ts=new Date().toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit'});
      if(statusEl)statusEl.innerHTML=`<span style="color:var(--green);">✓ Sincronizado ${ts}</span>`;
      if(!silent)showToast('Guardado en GitHub ✓');
    } else {
      const err=await res.json().catch(()=>({}));
      if(statusEl)statusEl.innerHTML=`<span style="color:var(--red);">✗ Error ${res.status}: ${err.message||''}</span>`;
      if(!silent)showToast(`Error al sincronizar (${res.status})`);
    }
  } catch(e) {
    if(statusEl)statusEl.innerHTML=`<span style="color:var(--red);">✗ ${e.message}</span>`;
    if(!silent)showToast('Error de conexión con GitHub');
  }
}
async function loadFromGitHub() {
  const cfg=getConfig();
  if(!cfg.ghToken||!cfg.ghRepo||!cfg.ghPath){showToast('Configura GitHub primero');return;}
  if(!confirm('¿Restaurar datos desde GitHub?\nEsto reemplazará todos los datos locales.'))return;
  const statusEl=document.getElementById('ghSyncStatus');
  if(statusEl)statusEl.innerHTML='<span style="color:var(--blue);">⟳ Cargando desde GitHub...</span>';
  try {
    const parts=cfg.ghRepo.split('/');const owner=parts[0];const repo=parts.slice(1).join('/');
    const url=`https://api.github.com/repos/${owner}/${repo}/contents/${cfg.ghPath}`;
    const res=await fetch(url,{headers:{Authorization:`token ${cfg.ghToken}`,Accept:'application/vnd.github.v3+json'}});
    if(!res.ok){if(statusEl)statusEl.innerHTML=`<span style="color:var(--red);">✗ Error ${res.status}</span>`;showToast(`Error al cargar (${res.status})`);return;}
    const j=await res.json();
    const text=decodeURIComponent(escape(atob(j.content.replace(/\n/g,''))));
    const data=JSON.parse(text);
    if(data.gestores)saveGestores(data.gestores);
    if(data.mensajeros)saveMensajeros(data.mensajeros);
    if(data.productos)saveProductos(data.productos);
    if(data.categorias)saveCategorias(data.categorias);
    if(data.vales)saveVales(data.vales);
    if(statusEl)statusEl.innerHTML='<span style="color:var(--green);">✓ Datos restaurados desde GitHub</span>';
    activeGestorId=null;activeMensajeroId=null;selectedValeId=null;adminGestorFilter=null;
    renderGestores();renderGestorRanking();renderAdminGestores();renderInbox();
    renderAdminGestoresList();renderMensajeros();renderMensajeroSelector();
    renderStockCategorias();renderProductGrid();
    updateAdminBadge();updateMensajeroBadge();
    showToast('Datos restaurados desde GitHub ✓');
  } catch(e) {
    if(statusEl)statusEl.innerHTML=`<span style="color:var(--red);">✗ ${e.message}</span>`;
    showToast('Error al restaurar datos');
  }
}
async function maybeAutoSync() {
  const cfg=getConfig();
  if(cfg.ghAutoSync&&cfg.ghToken&&cfg.ghRepo&&cfg.ghPath){
    try{await syncToGitHub(true);}catch(e){}
  }
}
function changePassCfg() {
  const np=document.getElementById('newPassInputCfg').value.trim();
  if(!np||np.length<4){showToast('Mínimo 4 caracteres');return;}
  localStorage.setItem('axon_admin_hash',btoa(np));
  document.getElementById('newPassInputCfg').value='';
  showToast('Contraseña actualizada ✓');
}

// ══════════════════════════════════════════
//  GOAL CELEBRATION
// ══════════════════════════════════════════
function launchConfetti() {
  const canvas=document.createElement('canvas');
  canvas.style.cssText='position:fixed;inset:0;z-index:499;pointer-events:none;';
  canvas.width=window.innerWidth;canvas.height=window.innerHeight;
  document.body.appendChild(canvas);
  const ctx=canvas.getContext('2d');
  const colors=['#00b4d8','#F59E0B','#10B981','#EF4444','#7C3AED','#F97316','#EC4899','#ffffff'];
  const particles=Array.from({length:160},()=>({
    x:Math.random()*canvas.width,
    y:-20-Math.random()*canvas.height*.6,
    w:6+Math.random()*10,h:3+Math.random()*5,
    color:colors[Math.floor(Math.random()*colors.length)],
    vx:(Math.random()-.5)*4,
    vy:1.5+Math.random()*4,
    rot:Math.random()*Math.PI*2,
    vrot:(Math.random()-.5)*.18,
    shape:Math.random()>.6?'circle':'rect',
  }));
  let frame;const start=Date.now();
  (function animate(){
    ctx.clearRect(0,0,canvas.width,canvas.height);
    const elapsed=Date.now()-start;
    const alpha=elapsed>2800?Math.max(0,1-(elapsed-2800)/900):1;
    particles.forEach(p=>{
      p.x+=p.vx;p.y+=p.vy;p.rot+=p.vrot;p.vy+=.06;
      ctx.save();ctx.globalAlpha=alpha;
      ctx.translate(p.x,p.y);ctx.rotate(p.rot);
      ctx.fillStyle=p.color;
      if(p.shape==='circle'){ctx.beginPath();ctx.arc(0,0,p.w/2,0,Math.PI*2);ctx.fill();}
      else{ctx.fillRect(-p.w/2,-p.h/2,p.w,p.h);}
      ctx.restore();
    });
    if(elapsed<3700){frame=requestAnimationFrame(animate);}
    else{canvas.remove();}
  })();
  setTimeout(()=>{cancelAnimationFrame(frame);if(canvas.parentNode)canvas.remove();},4200);
}

function showGoalBanner(g, pts) {
  const old=document.getElementById('goalBanner');if(old)old.remove();
  const el=document.createElement('div');el.id='goalBanner';
  el.innerHTML=`
    <div style="font-size:32px;flex-shrink:0;">🏆</div>
    <div style="flex:1;min-width:0;">
      <div style="font-size:15px;font-weight:900;letter-spacing:.5px;text-shadow:0 1px 4px rgba(0,0,0,.3);">¡META ALCANZADA!</div>
      <div style="font-size:13px;opacity:.9;margin-top:2px;">${g.name} llegó a <b>${pts} puntos ⭐</b> — ¡Felicidades!</div>
    </div>
    <div style="background:${g.color};width:42px;height:42px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:13px;flex-shrink:0;border:2px solid rgba(255,255,255,.4);">${g.initials}</div>
    <button onclick="dismissGoalBanner()" style="background:rgba(255,255,255,.18);border:none;color:white;border-radius:50%;width:26px;height:26px;cursor:pointer;font-size:16px;line-height:1;display:flex;align-items:center;justify-content:center;flex-shrink:0;padding:0;">×</button>`;
  document.body.appendChild(el);
  setTimeout(()=>dismissGoalBanner(),6000);
}
function dismissGoalBanner(){
  const el=document.getElementById('goalBanner');if(!el)return;
  el.classList.add('hide');setTimeout(()=>el.remove(),370);
}

function checkGoalReached(gestorId, currentValeId) {
  const meta=getConfig().metaPuntos;if(!meta||!gestorId)return;
  const g=gestorOf(gestorId);if(!g)return;
  const vales=getVales().filter(v=>v.gestorId===gestorId&&['confirmed','pending_payment'].includes(v.status));
  const pts=vales.reduce((sum,v)=>sum+(v.valeProductos||[]).reduce((s,p)=>{const pr=productoOf(p.id);return s+(pr?pr.puntos*p.qty:0);},0),0);
  if(pts>=meta){
    // Celebrate only if THIS sale crossed the threshold (exclude current vale from prev total)
    const prev=vales.filter(v=>v.id!==currentValeId).reduce((sum,v)=>sum+(v.valeProductos||[]).reduce((s,p)=>{const pr=productoOf(p.id);return s+(pr?pr.puntos*p.qty:0);},0),0);
    if(prev<meta){launchConfetti();showGoalBanner(g,pts);}
  }
}

// ══════════════════════════════════════════
//  CONFIRM ACTION MODAL
// ══════════════════════════════════════════
function showConfirmAction(title, sub, okLabel, okClass, cb) {
  confirmActionCb = cb;
  document.getElementById('confirmActionTitle').textContent = title;
  document.getElementById('confirmActionSub').textContent = sub;
  const btn = document.getElementById('confirmActionOk');
  btn.textContent = okLabel;
  btn.className = `btn ${okClass} btn-full`;
  btn.onclick = () => { closeConfirmAction(); confirmActionCb && confirmActionCb(); };
  document.getElementById('confirmActionModal').classList.add('show');
}
function closeConfirmAction() {
  document.getElementById('confirmActionModal').classList.remove('show');
  confirmActionCb = null;
}

// ══════════════════════════════════════════
//  REVERT CONFIRMED SALE
// ══════════════════════════════════════════
function revertConfirmSale(id, skipConfirm) {
  if(!skipConfirm) {
    const v=getVales().find(x=>x.id===id);if(!v)return;
    showConfirmAction('¿Revertir venta confirmada?',`${v.cliente||''} volverá a "Entregado"`,'Revertir','btn-orange',()=>revertConfirmSale(id,true));
    return;
  }
  const v=getVales().find(x=>x.id===id);if(!v)return;
  // Restore stock for each product that was decremented when the sale was confirmed
  (v.valeProductos||[]).forEach(({id:pid,qty})=>{
    const prod=productoOf(pid);if(!prod)return;
    const restored=Math.max(0,(prod.stock||0)+qty);
    patchProducto(pid,{stock:restored});
  });
  patchVale(id,{status:'delivered',confirmedTs:null,commissionPaid:false,commissionPaidTs:null});
  gestoresTabDirty=true;statsTabDirty=true;rankingCache=null;
  renderAdminGestores();renderInbox();renderValeDetail();
  renderConfirmados();renderPendienteCobro();
  renderGestorRanking();renderProductGrid();
  if(currentAdminTab==='gestores'){renderComisiones();}
  maybeAutoSync();
  showToast('Venta revertida a "Entregado" — stock restaurado');
}

// ══════════════════════════════════════════
//  HISTORIAL
// ══════════════════════════════════════════
function renderHistorial() {
  const fromEl=document.getElementById('histDateFrom');
  const toEl=document.getElementById('histDateTo');
  const gestorEl=document.getElementById('histGestorFilter');
  const c=document.getElementById('historialList');
  if(!c)return;
  // Populate gestor filter
  const gestores=getGestores();
  const curGFilter=gestorEl?gestorEl.value:'';
  if(gestorEl){
    gestorEl.innerHTML=`<option value="">Todos los gestores</option>`+gestores.map(g=>`<option value="${g.id}">${g.name}</option>`).join('');
    gestorEl.value=curGFilter;
  }
  let vales=getVales().reverse();
  const from=fromEl?fromEl.value:'';
  const to=toEl?toEl.value:'';
  if(from)vales=vales.filter(v=>v.ts.slice(0,10)>=from);
  if(to)  vales=vales.filter(v=>v.ts.slice(0,10)<=to);
  if(curGFilter)vales=vales.filter(v=>String(v.gestorId)===curGFilter);
  if(!vales.length){c.innerHTML='<div class="es"><div class="es-icon">📭</div><div class="es-text">Sin vales en el período seleccionado</div></div>';return;}
  // Group by date
  const groups={};
  vales.forEach(v=>{
    const d=v.ts.slice(0,10);
    if(!groups[d])groups[d]=[];
    groups[d].push(v);
  });
  const sMap={
    pending:{label:'Pendiente',cls:'sp-pending'},assigned:{label:'Con mensajero',cls:'sp-assigned'},
    delivered:{label:'Entregado',cls:'sp-delivered'},
    confirmed:{label:'Confirmado',cls:'sp-confirmed'},pending_payment:{label:'Pend. cobro',cls:'sp-pending_payment'},
  };
  let html='';
  Object.keys(groups).sort((a,b)=>b.localeCompare(a)).forEach(date=>{
    const day=new Date(date+'T12:00:00').toLocaleDateString('es-ES',{weekday:'long',year:'numeric',month:'long',day:'numeric'});
    html+=`<div style="font-size:11px;font-weight:700;color:var(--gray-400);text-transform:uppercase;letter-spacing:.5px;padding:10px 0 5px;border-top:1px solid var(--border);margin-top:8px;">${day} <span style="background:var(--gray-100);border-radius:10px;padding:1px 7px;font-size:10px;">${groups[date].length}</span></div>`;
    groups[date].forEach(v=>{
      const g=gestorOf(v.gestorId);
      const s=sMap[v.status]||{label:v.status,cls:''};
      html+=`<div class="card" style="padding:8px 12px;margin-bottom:5px;cursor:pointer;display:flex;align-items:center;gap:10px;" onclick="selectValeFromHistorial(${v.id})">
        <div style="flex-shrink:0;">
          <div class="g-avatar" style="background:${g?g.color:'#888'};width:28px;height:28px;font-size:10px;">${g?g.initials:'?'}</div>
        </div>
        <div style="flex:1;min-width:0;">
          <div style="font-size:12px;font-weight:700;">${valeNumStr(v)?`<span style="color:var(--blue);">${valeNumStr(v)}</span> `:''}${v.cliente||'—'}</div>
          <div style="font-size:10px;color:var(--gray-400);">${g?g.name:'—'} · ${timeStr(v.ts)}</div>
        </div>
        <div style="text-align:right;flex-shrink:0;">
          <span class="sp ${s.cls}" style="font-size:9px;">${s.label}</span>
          <div style="font-size:11px;font-weight:700;color:var(--blue);margin-top:2px;">${v.total||''}</div>
        </div>
      </div>`;
    });
  });
  c.innerHTML=html;
}
function selectValeFromHistorial(id) {
  selectedValeId=id;
  adminTab('vales');
  setTimeout(()=>{renderValeDetail();},50);
}

// ══════════════════════════════════════════
//  THEME
// ══════════════════════════════════════════
function applyTheme(dark) {
  document.body.classList.toggle('dark', dark);
  const btn=document.getElementById('btnTheme');if(btn)btn.textContent=dark?'☀️':'🌙';
}
function toggleTheme() {
  const isDark = document.body.classList.toggle('dark');
  localStorage.setItem('axon_theme', isDark ? 'dark' : 'light');
  const btn=document.getElementById('btnTheme');if(btn)btn.textContent=isDark?'☀️':'🌙';
}

// ══════════════════════════════════════════
//  INITIAL DATA LOAD
// ══════════════════════════════════════════
async function loadInitialData() {
  if (getGestores().length || getProductos().length) return; // already has data
  try {
    const res = await fetch('./data.json');
    if (!res.ok) return;
    const data = await res.json();
    if (data.gestores  && data.gestores.length)  saveGestores(data.gestores);
    if (data.mensajeros&& data.mensajeros.length) saveMensajeros(data.mensajeros);
    if (data.productos && data.productos.length)  saveProductos(data.productos);
    if (data.categorias&& data.categorias.length) saveCategorias(data.categorias);
  } catch(e) {}
}

// ══════════════════════════════════════════
//  INIT
// ══════════════════════════════════════════
async function init() {
  applyTheme(localStorage.getItem('axon_theme')==='dark');
  updateDate();
  setInterval(updateDate, 60000);
  await loadInitialData();
  if (IS_ADMIN) {
    initAdminPage();
  } else {
    initGestorPage();
  }
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}
function initGestorPage() {
  setInterval(() => { updateAdminBadge(); renderMyVales(); renderGestorNotifs(); }, 12000);
  renderGestores();
  renderGestorNotifs();
  renderGestorRanking();
  const bc = document.getElementById('btnCatalogo');
  if (bc) bc.style.display = 'inline-flex';
  // Triple-tap on AX logo → go to admin page
  let _taps = 0, _tapTimer;
  const brandTap = document.getElementById('brandTap');
  if (brandTap) {
    brandTap.addEventListener('click', () => {
      _taps++;
      clearTimeout(_tapTimer);
      _tapTimer = setTimeout(() => { _taps = 0; }, 800);
      if (_taps >= 3) { _taps = 0; window.location.href = './admin.html'; }
    });
  }
}
function initAdminPage() {
  updateAdminBadge(); updateMensajeroBadge();
  setFilter('all');
  if (adminActive) {
    activateAdminMode();
  } else {
    openPassModal();
  }
}
init();
