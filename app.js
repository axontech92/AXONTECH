// ══════════════════════════════════════════
//  PAGE CONTEXT
// ══════════════════════════════════════════
const IS_ADMIN = document.body.dataset.page === 'admin';

// ══════════════════════════════════════════
//  SECURITY UTILS
// ══════════════════════════════════════════
function escapeHTML(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ══════════════════════════════════════════
//  FIREBASE SETUP & DATA LAYER
// ══════════════════════════════════════════
const firebaseConfig = {
  apiKey: "AIzaSyBIyvayDYLYDFy4qrbTkYnrTmxfvxvLnlU",
  authDomain: "axontech.firebaseapp.com",
  databaseURL: "https://axontech-default-rtdb.firebaseio.com",
  projectId: "axontech",
  storageBucket: "axontech.firebasestorage.app",
  messagingSenderId: "780537360829",
  appId: "1:780537360829:web:87b7f971337d6a8b5d22d4"
};
firebase.initializeApp(firebaseConfig);
const db = firebase.database();
let isSyncingFromFirebase = false;

const setFB = (path, v) => {
  if(!isSyncingFromFirebase) db.ref(path).set(v).catch(e => console.error("Firebase err:", e));
};

const getGestores   = () => JSON.parse(localStorage.getItem('axon_gestores')   || '[]');
const saveGestores  = v  => { localStorage.setItem('axon_gestores',  JSON.stringify(v)); setFB('gestores', v); };

const getVales      = () => JSON.parse(localStorage.getItem('axon_vales')      || '[]');
// Remove auto-sync of ALL vales to prevent race conditions. Vales will be synced individually.
const saveVales     = v  => { localStorage.setItem('axon_vales',     JSON.stringify(v)); };

const getMensajeros = () => JSON.parse(localStorage.getItem('axon_mensajeros') || '[]');
const saveMensajeros= v  => { localStorage.setItem('axon_mensajeros',JSON.stringify(v)); setFB('mensajeros', v); };

const getProductos  = () => JSON.parse(localStorage.getItem('axon_productos')  || '[]');
const saveProductos = v  => { localStorage.setItem('axon_productos', JSON.stringify(v)); setFB('productos', v); };

const getCategorias = () => JSON.parse(localStorage.getItem('axon_categorias') || '[]');
const saveCategorias= v  => { localStorage.setItem('axon_categorias',JSON.stringify(v)); setFB('categorias', v); };

const getConfig     = () => JSON.parse(localStorage.getItem('axon_config')     || '{}');
const saveConfig    = v  => { localStorage.setItem('axon_config',    JSON.stringify(v)); setFB('config', v); };

const getNotifs     = () => JSON.parse(localStorage.getItem('axon_notifs')     || '[]');
const saveNotifs    = v  => { localStorage.setItem('axon_notifs',    JSON.stringify(v)); setFB('notifs', v); };

let gestorValesListener = null;
let firstLoadVales = true;
function listenToMyVales(gId) {
  if (gestorValesListener) db.ref(`vales/${activeGestorId}`).off('value', gestorValesListener);
  firstLoadVales = true;
  gestorValesListener = db.ref(`vales/${gId}`).on('value', snap => {
    isSyncingFromFirebase = true;
    const val = snap.val();
    if (val) {
      const newVales = Object.values(val);
      newVales.sort((a,b) => new Date(b.ts) - new Date(a.ts));
      
      if (!firstLoadVales) {
        const oldVales = getVales();
        newVales.forEach(nv => {
          const ov = oldVales.find(x => x.id === nv.id);
          if (ov && ov.status !== nv.status) {
            const prodNames = (nv.valeProductos||[]).map(p => p.qty > 1 ? `${p.qty}x ${p.name}` : p.name).join(', ');
            
            if (nv.status === 'assigned') {
              sendBrowserNotif('Venta en camino 🛵', '...');
              playSound('confirm');
            } else if (nv.status === 'delivered') {
              sendBrowserNotif('Venta entregada 🎉', prodNames);
              playSound('confirm');
            } else if (nv.status === 'confirmed') {
              let amtStr = '';
              if(typeof getValeCommissionParts === 'function'){
                const cp = getValeCommissionParts(nv);
                if(cp.total !== null && cp.total > 0) {
                   amtStr = cp.currency === 'MN' ? ` por ${Math.round(cp.total)} MN` : ` por ${cp.total.toFixed(2)} USD`;
                }
              }
              sendBrowserNotif('Venta cobrada 💰', `${prodNames}${amtStr}`);
              playSound('confirm');
            }
          }
        });
      }
      localStorage.setItem('axon_vales', JSON.stringify(newVales));
    }
    firstLoadVales = false;
    isSyncingFromFirebase = false;
    refreshUI();
  });
}

// Custom Firebase Vale individual operations
function fbAddVale(v) { if(!isSyncingFromFirebase) db.ref(`vales/${v.gestorId}/${v.id}`).set(v); }
function fbUpdateVale(v, changes) { if(!isSyncingFromFirebase) db.ref(`vales/${v.gestorId}/${v.id}`).update(changes); }
function fbRemoveVale(v) { if(!isSyncingFromFirebase) db.ref(`vales/${v.gestorId}/${v.id}`).remove(); }

function refreshUI() {
  if(IS_ADMIN) {
    if(typeof renderAdminGestoresList === 'function') renderAdminGestoresList();
    if(typeof renderAdminGestores === 'function') renderAdminGestores();
    if(typeof renderInbox === 'function') 
    if(typeof renderMensajeros === 'function') renderMensajeros();
    if(typeof renderProductGrid === 'function') renderProductGrid();
    if(typeof renderStockCategorias === 'function') renderStockCategorias();
    if(typeof renderConfirmados === 'function') renderConfirmados();
    if(typeof renderPendienteCobro === 'function') renderPendienteCobro();
    if(typeof renderPendingCobroSection === 'function') renderPendingCobroSection();
    if(typeof renderMensajeroVales === 'function') renderMensajeroVales();
    if(typeof renderMensajeroSelector === 'function') renderMensajeroSelector();
    if(typeof renderComisiones === 'function' && typeof currentAdminTab !== 'undefined' && currentAdminTab === 'gestores') renderComisiones();
    if(typeof updateAdminBadge === 'function') updateAdminBadge();
    if(typeof updateMensajeroBadge === 'function') updateMensajeroBadge();
    if(typeof renderValeDetail === 'function' && typeof selectedValeId !== 'undefined' && selectedValeId) renderValeDetail();
  } else {
    if(typeof renderGestores === 'function') renderGestores();
    if(typeof renderGestorNotifs === 'function') renderGestorNotifs();
    if(typeof renderMyVales === 'function') renderMyVales();
    if(typeof renderGestorRanking === 'function') renderGestorRanking();
    if(typeof renderGestorCatalog === 'function') {
       if(document.getElementById('gestorCatalogModal')?.classList.contains('show')) {
           renderGestorCatalog();
       }
    }
  }
}



// Base Listeners (Everything except vales)
['gestores', 'mensajeros', 'productos', 'categorias', 'config', 'notifs', 'ranking_summary'].forEach(node => {
  db.ref(node).on('value', snap => {
    isSyncingFromFirebase = true;
    const val = snap.val();
    
    if (val) {
      let parsedVal = val;
      if (node !== 'config' && typeof val === 'object' && !Array.isArray(val)) {
        parsedVal = Object.values(val);
      }
      localStorage.setItem('axon_'+node, JSON.stringify(parsedVal));
    }
    
    isSyncingFromFirebase = false;
    refreshUI();
  });
});

// Vales Listeners
if (IS_ADMIN) {
  // Admin listens to ALL vales from all gestores
  db.ref('vales').on('value', snap => {
    isSyncingFromFirebase = true;
    const val = snap.val();
    
    if (val) {
      let flatVales = [];
      Object.values(val).forEach(gVales => {
        if(gVales) flatVales.push(...Object.values(gVales));
      });
      flatVales.sort((a,b) => new Date(b.ts) - new Date(a.ts));
      localStorage.setItem('axon_vales', JSON.stringify(flatVales));
      
      // Push ranking summary for Gestores
      const gestores = getGestores();
      const summary = gestores.map(g => {
        const pts = flatVales.filter(v=>v.gestorId===g.id&&['confirmed','pending_payment'].includes(v.status))
          .reduce((sum,v)=>sum+(v.valeProductos||[]).reduce((s,p)=>{const pr=productoOf(p.id);return s+(pr?pr.puntos*p.qty:0);},0),0);
        return { id: g.id, pts };
      });
      db.ref('ranking_summary').set(summary);
    }
    
    isSyncingFromFirebase = false;
    refreshUI();
  });
}

// Initialize empty Firebase from local if Admin
if (IS_ADMIN) {
  setTimeout(() => {
    db.ref('.info/connected').once('value').then(() => {
      db.ref('gestores').once('value').then(s => {
        if (!s.val()) {
           const lGestores = getGestores();
           if(lGestores.length > 0) {
             console.log("Pushing initial data to Firebase...");
             setFB('gestores', lGestores);
             setFB('mensajeros', getMensajeros());
             setFB('productos', getProductos());
             setFB('categorias', getCategorias());
             setFB('config', getConfig());
             const localVales = getVales();
             const valesObj = {};
             localVales.forEach(v => {
               if(!valesObj[v.gestorId]) valesObj[v.gestorId] = {};
               valesObj[v.gestorId][v.id] = v;
             });
             db.ref('vales').set(valesObj);
           }
        }
      });
    });
  }, 1500);
}



// ══════════════════════════════════════════
//  STATE
// ══════════════════════════════════════════
let activeGestorId    = null;
let activeMensajeroId = null;
let adminActive       = false;
let selectedValeId    = null;
let inboxFilter       = 'pending';
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
// nowDateTime was added below in earlier step, skipping it here to avoid duplication.
const pendingCount= () => getVales().filter(v=>v.status==='pending').length;
const pendingOf   = gId=> getVales().filter(v=>v.gestorId===gId&&v.status==='pending').length;
const todayValesOf= gId=> getVales().filter(v=>v.gestorId===gId&&new Date(v.ts).toDateString()===todayStr());

// ══════════════════════════════════════════
//  AUTH
// ══════════════════════════════════════════
function checkPass(input) {
  return btoa(input)===(localStorage.getItem('axon_admin_hash')||btoa('axon2024'));
}
function changePass() {
  const np = document.getElementById('newPassInput').value.trim();
  if (!np||np.length<4){showToast('Mínimo 4 caracteres');return;}
  localStorage.setItem('axon_admin_hash',btoa(np));
  document.getElementById('newPassInput').value='';
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
    (tones[type]||tones.login).forEach(t=>{const o=ac.createOscillator();o.type='sine';o.frequency.value=t[0];o.connect(g);o.start(ac.currentTime+t[1]);o.stop(ac.currentTime+t[1]+0.2);});
  } catch(e){}
}


function patchVale(id, changes) {
  const all = getVales(); const i = all.findIndex(v=>v.id===id);
  if (i!==-1){
    all[i]={...all[i],...changes};
    saveVales(all);
    if(typeof fbUpdateVale === 'function') fbUpdateVale(all[i], changes);
  }
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

function openNotifsModal() {
  const gId = activeGestorId ? activeGestorId : 'global';
  const notifs = getNotifs();
  if (notifs.length > 0) {
    localStorage.setItem('axon_viewed_id_' + gId, notifs[0].id);
  }
  renderGestorNotifs();
  document.getElementById('notifsModal').classList.add('show');
}
function closeNotifsModal() {
  document.getElementById('notifsModal').classList.remove('show');
}
function clearGestorNotifs() {
  const gId = activeGestorId ? activeGestorId : 'global';
  const notifs = getNotifs();
  if (notifs.length > 0) {
    localStorage.setItem('axon_cleared_id_' + gId, notifs[0].id);
  }
  renderGestorNotifs();
  closeNotifsModal();
}
function renderGestorNotifs() {
  const notifs = getNotifs();
  const gId = activeGestorId ? activeGestorId : 'global';
  const viewedId = parseInt(localStorage.getItem('axon_viewed_id_' + gId) || '0');
  const clearedId = parseInt(localStorage.getItem('axon_cleared_id_' + gId) || '0');

  // Find indexes
  const viewedIdx = notifs.findIndex(n => n.id === viewedId);
  const clearedIdx = notifs.findIndex(n => n.id === clearedId);
  
  // Slicing arrays
  const visibleNotifs = clearedIdx !== -1 ? notifs.slice(0, clearedIdx) : notifs;

  // Global Notifs
  const globalNotifs = visibleNotifs.filter(n => !['vale_confirmed', 'vale_assigned'].includes(n.type));
  
  // Personal Notifs (never cleared by the global clear button)
  const personalNotifs = notifs.filter(n => {
    return ['vale_confirmed', 'vale_assigned'].includes(n.type) && activeGestorId && n.gestorId === activeGestorId;
  });

  const sec = document.getElementById('gestorNotifsSection');
  const personalSec = document.getElementById('gestorPersonalNotifsSection');
  
  const icons = {new_product:'✨',out_of_stock:'❌',low_stock:'⚠️',restocked:'✅',vale_confirmed:'🎉',sale_product:'🛒',vale_assigned:'🛵'};
  
  const renderItem = (n, isPersonal) => {
    const icon=icons[n.type]||'📢';
    const age=timeAgo(n.ts);
    const typeClass=n.type==='out_of_stock'?'agotado':n.type==='low_stock'?'low':n.type==='restocked'?'restocked':['vale_confirmed','sale_product','vale_assigned'].includes(n.type)?'ok':'';
    
    // Unread logic
    const nIdx = notifs.findIndex(x => x.id === n.id);
    const isUnread = !isPersonal && (viewedIdx === -1 || nIdx < viewedIdx);
    const cls=isUnread?'unread':`type-${typeClass}`;
    
    let msg='';
    if(n.type==='sale_product'){
      const parts=(n.extra||'').split('|');
      const qty=parseInt(parts[0])||1;
      const left=parseInt(parts[1]);
      msg=`<b>Se vendió${qty>1?` <span style="color:var(--blue);font-weight:800;">${qty}</span>`:``}</b> ${n.productName}${!isNaN(left)?` — quedan <b style="color:${left===0?'var(--red)':left<=LOW_STOCK_THRESHOLD?'var(--yellow)':'var(--green)'};">${left}</b>`:``}`;
    } else if(n.type==='vale_assigned'){
      msg=`🛵 Tu venta está con el mensajero`;
    } else if(n.type==='vale_confirmed'){
      msg=`<b>¡Venta completada! ✅</b> · ${n.productName}${n.extra?` <span style="color:var(--gray-400);font-size:10px;">(${n.extra})</span>`:``}`;
    } else if(n.type==='out_of_stock'){
      msg=`<b>Agotado:</b> ${n.productName}`;
    } else if(n.type==='low_stock'){
      msg=`<b>Stock bajo:</b> ${n.productName} <span style="color:var(--yellow);">(${n.extra})</span>`;
    } else if(n.type==='restocked'){
      msg=`<b>Repuesto:</b> ${n.productName} <span style="color:var(--green);">(${n.extra})</span>`;
    } else if(n.type==='new_product'){
      msg=`<b>Nuevo producto:</b> ${n.productName}${n.extra?` · ${n.extra}`:``}`;
    } else {
      msg=`${n.productName}${n.extra?` (${n.extra})`:``}`;
    }
    return `<div class="notif-item ${cls}">
      <div class="notif-icon">${icon}</div>
      <div class="notif-body">
        <div class="notif-text">${msg}</div>
        <div class="notif-time">${age}</div>
      </div>
    </div>`;
  };

  if(sec) {
    const unread = globalNotifs.filter(n => {
       const idx = notifs.findIndex(x => x.id === n.id);
       return viewedIdx === -1 || idx < viewedIdx;
    }).length;
    const badge = document.getElementById('notifUnreadBadge');
    if(badge){badge.textContent=unread;badge.style.display=unread?'inline-block':'none';}
    
    if(!globalNotifs.length) {
      document.getElementById('gestorNotifsList').innerHTML = '<div class="es" style="padding:10px;"><div class="es-text">No hay alertas recientes.</div></div>';
    } else {
      document.getElementById('gestorNotifsList').innerHTML = globalNotifs.map(n => renderItem(n, false)).join('');
    }
  }

  if(personalSec) {
    if(!personalNotifs.length || !activeGestorId) {
      personalSec.style.display='none';
    } else {
      personalSec.style.display='block';
      document.getElementById('gestorPersonalNotifsList').innerHTML = personalNotifs.map(n => renderItem(n, true)).join('');
    }
  }
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
function nowDateTime() {
  const d=new Date();
  return `${d.getDate()}/${d.getMonth()+1}/${d.getFullYear()} ${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`;
}

function updateDate() {
  const hd=document.getElementById('headerDate');
  if(hd)hd.textContent=new Date().toLocaleDateString('es-ES',{weekday:'short',day:'numeric',month:'short'});
  const fEl=document.getElementById('vf-fecha');
  if(fEl)fEl.value=nowDateTime();
}
function requestNotifPermission() {
  if('Notification' in window) {
    Notification.requestPermission().then(p => {
       if(p === 'granted') {
          showToast('Notificaciones activadas ✓');
          if (!IS_ADMIN && activeGestorId) {
             doSelectGestor(activeGestorId);
          }
       } else {
          showToast('Permiso denegado por el navegador');
       }
    });
  } else {
    showToast('Este navegador no soporta notificaciones push');
  }
}
function sendBrowserNotif(title,body) {
  if('Notification' in window && Notification.permission==='granted'){
    if ('serviceWorker' in navigator && navigator.serviceWorker.ready) {
      navigator.serviceWorker.ready.then(reg => {
        reg.showNotification(title, {body, icon: './iconos/icon-192.png'});
      }).catch(() => {
        new Notification(title,{body, icon: './iconos/icon-192.png'});
      });
    } else {
      new Notification(title,{body, icon: './iconos/icon-192.png'});
    }
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
  if(tab==='vales'){renderAdminGestores();renderMensajeros();renderConfirmados();renderPendienteCobro();}
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
  if(!c) return;
  if(!gestores.length){c.innerHTML='<div class="es"><div class="es-icon">👤</div><div class="es-text">El admin aún no ha configurado gestores</div></div>';return;}
  c.innerHTML=gestores.map(g=>{
    const act=g.id===activeGestorId;
    return `<div class="g-item ${act?'active':''}" onclick="selectGestor(${g.id})">
      <div class="g-avatar" style="background:${g.color}">${escapeHTML(g.initials)}</div>
      <div class="g-name">${escapeHTML(g.name)}</div>
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
  listenToMyVales(id);
  activeGestorId=id;const g=gestorOf(id);
  document.getElementById('bannerAvatar').textContent=g.initials;
  document.getElementById('bannerAvatar').style.background=g.color;
  document.getElementById('bannerLbl').textContent='HOLA, ESTÁS EN TU ÁREA';
  document.getElementById('bannerName').textContent=g.name;

    const perms = ('Notification' in window && Notification.permission);
    let nBtn = '';
    if(perms === 'default' || perms === 'denied') {
      nBtn = `<button type="button" onclick="requestNotifPermission()" style="background:rgba(239,68,68,.1);border:1px solid var(--red);color:var(--red);border-radius:6px;font-size:10px;padding:3px 8px;font-weight:700;margin-top:6px;cursor:pointer;">🔔 Activar alertas push</button>`;
    }
  document.getElementById('bannerName').innerHTML = g.name + (nBtn ? '<br>'+nBtn : '');
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
  const val=document.getElementById('gestorPassInput').value.trim().toUpperCase();
  const g=gestorOf(pendingGestorId);if(!g)return;
  const sysPass = (g.password || '').trim().toUpperCase();
  if(val === sysPass){
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

let mensajeroManagerExpanded = false;
function toggleMensajeroManager() {
  mensajeroManagerExpanded = !mensajeroManagerExpanded;
  document.getElementById('mensajeroManagerSection').style.display = mensajeroManagerExpanded ? 'block' : 'none';
  if(mensajeroManagerExpanded) renderMensajerosEditList();
}

function renderMensajerosEditList() {
  const c = document.getElementById('mensajerosEditList');
  if(!c) return;
  const list = getMensajeros();
  if(!list.length) { c.innerHTML = '<div style="font-size:12px;color:var(--text-muted);">Sin mensajeros registrados</div>'; return; }
  c.innerHTML = list.map(m => {
    return `<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 10px;background:var(--surface);border:1px solid var(--border);border-radius:8px;margin-bottom:6px;">
      <span style="font-size:13px;font-weight:700;">${m.name}</span>
      <div style="display:flex;gap:6px;">
         <button class="btn btn-ghost btn-sm" style="padding:4px 8px;font-size:11px;" onclick="openEditMensajeroModal(${m.id})">✏️</button>
         <button class="btn btn-ghost btn-sm" style="padding:4px 8px;font-size:11px;color:var(--red);" onclick="removeMensajero(${m.id})">🗑️</button>
      </div>
    </div>`;
  }).join('');
}

function renderMensajeroSelector() {
  const c=document.getElementById('mensajeroSelectorList');if(!c)return;
  const list=getMensajeros();
  const vales=getVales();
  if(!list.length){c.innerHTML='<div class="es" style="grid-column:1/-1;padding:4px 0;"><div class="es-text" style="font-size:12px;">Sin mensajeros registrados</div></div>';return;}
  c.innerHTML=list.map(m=>{
    const assigned=vales.filter(v=>v.mensajeroId===m.id&&v.status==='assigned').length;
    const act=m.id===activeMensajeroId;
    const ini = m.name.charAt(0).toUpperCase();
    const color = GESTOR_COLORS[m.id % GESTOR_COLORS.length] || '#7C3AED';
    return `<div class="m-card ${act?'active':''}" onclick="selectMensajero(${m.id})" style="display:flex;align-items:center;gap:12px;padding:12px 14px;text-align:left;border:1px solid ${act?'var(--blue)':'var(--border)'};background:${act?'var(--blue-lt)':'var(--surface)'};">
      <div style="width:40px;height:40px;border-radius:50%;background:${color};color:white;display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:700;flex-shrink:0;">${ini}</div>
      <div style="flex:1;">
        <div style="font-size:15px;font-weight:700;color:var(--text);margin-bottom:2px;">${m.name} ${act?'<span style="color:var(--blue);font-size:12px;margin-left:4px;">✓</span>':''}</div>
        <div style="font-size:12px;color:var(--orange);font-weight:600;">${assigned} entregas</div>
      </div>
    </div>`;
  }).join('');
  if(mensajeroManagerExpanded) renderMensajerosEditList();
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
  const np=genPassword().trim().toUpperCase();list[i].password=np;saveGestores(list);
  gestoresTabDirty=true;
  renderAdminGestoresList();showToast(`Nueva clave: ${np}`);
}
function removeGestor(id) {
  const g = gestorOf(id);
  if (!g) return;
  const hasVales = getVales().some(v=>v.gestorId===id);
  const sub = hasVales ? 'Tiene vales registrados. Si lo borras, quedarán huérfanos.' : 'El gestor será borrado del sistema.';
  showConfirmAction('¿Eliminar a ' + g.name + '?', sub, 'Eliminar', 'btn-red', () => {
    const newList = getGestores().filter(x=>x.id!==id);
    // Overwrite in Local AND Firebase specifically
    saveGestores(newList);
    if (!isSyncingFromFirebase) {
       db.ref('gestores').set(newList);
    }
    gestoresTabDirty=true;rankingCache=null;
    renderAdminGestoresList();renderGestores();renderAdminGestores();
    if(typeof renderComisiones === 'function') renderComisiones();
    showToast('Gestor eliminado ✓');
  });
}

function openGestorValeModal(id) {
  const v = getVales().find(x=>x.id===id); if(!v) return;
  const sMap={
    delivered:{label:'Entregado',color:'#7C3AED',icon:'📦'},
    confirmed:{label:'Venta confirmada ✅',color:'var(--green)',icon:'✅'}
  };
  const s = sMap[v.status]||{label:v.status,color:'var(--gray-400)',icon:'•'};
  const content = `
    <div style="font-size:16px;font-weight:800;color:var(--blue-dk);margin-bottom:12px;">${valeNumStr(v)} ${v.cliente}</div>
    <div style="margin-bottom:6px;"><b>📱 Teléfono:</b> ${v.telefono||'—'}</div>
    <div style="margin-bottom:6px;"><b>📍 Dirección:</b> ${v.direccion||'—'}</div>
    <div style="margin-bottom:6px;"><b>📦 Artículo:</b> ${v.articulo||'—'}</div>
    <div style="margin-bottom:6px;"><b>💰 Total:</b> ${v.total||'—'}</div>
    <div style="margin-bottom:12px;"><b>⚙️ Garantía:</b> ${v.garantia||'—'}</div>
    <div style="padding:10px;background:var(--surface2);border-radius:8px;border:1px solid var(--border);font-weight:700;color:${s.color};text-align:center;">
      ${s.icon} ${s.label}
    </div>
  `;
  document.getElementById('gestorValeModalContent').innerHTML = content;
  document.getElementById('gestorValeModal').classList.add('show');
}

function cancelVale(id) {
  const v=getVales().find(x=>x.id===id);
  if(!v||v.status!=='pending'){showToast('No se puede cancelar este vale');return;}
  showConfirmAction('¿Cancelar este vale?',`${v.cliente||''} · ${v.articulo||''}`,'Sí, cancelar','btn-red',()=>{
    const v_del = getVales().find(x=>x.id===id);
    saveVales(getVales().filter(x=>x.id!==id));
    if(v_del) fbRemoveVale(v_del);
    if(selectedValeId===id)selectedValeId=null;
    showToast('Vale cancelado');
    renderAdminGestores();renderValeDetail();renderMyVales();maybeAutoSync();
  });
}

function adminDeleteVale(id) {
  const v=getVales().find(x=>x.id===id);if(!v)return;
  if(v.status==='confirmed'){showToast('Revertir la confirmación antes de eliminar');return;}
  showConfirmAction('¿Eliminar este vale?',`${v.cliente||''} · ${v.articulo||''}`,'Eliminar','btn-red',()=>{
    const v_del = getVales().find(x=>x.id===id);
    saveVales(getVales().filter(x=>x.id!==id));
    if(v_del) fbRemoveVale(v_del);
    if(selectedValeId===id)selectedValeId=null;
    showToast('Vale eliminado');
    renderAdminGestores();renderValeDetail();renderMyVales();maybeAutoSync();
  });
}

// ══════════════════════════════════════════
//  VALE FORM
// ══════════════════════════════════════════
const REQUIRED=['vf-cliente','vf-telefono','vf-direccion','vf-articulo','vf-total'];
const fVal = id => (document.getElementById(id)?.value||'').trim();

function calcAutoTotal() {
  const pUSD = document.getElementById('vf-precioUSD')?.value || '';
  const pMN = document.getElementById('vf-precioMN')?.value || '';
  const mens = document.getElementById('vf-mensajeria')?.value || '';
  
  let usdTotal = 0;
  let mnTotal = 0;
  
  const addVal = (str) => {
    const s = str.toUpperCase();
    const num = parsePrecioNum(s);
    if(num === 0) return;
    if(s.includes('MN') || s.includes('CUP')) mnTotal += num;
    else if(s.includes('USD') || s.includes('ZELLE')) usdTotal += num;
    else if(s.includes('$')) usdTotal += num;
    else {
      if(num > 500) mnTotal += num;
      else usdTotal += num;
    }
  };
  
  addVal(pUSD);
  addVal(pMN);
  addVal(mens);
  
  let out = [];
  if(usdTotal > 0) out.push(`$${usdTotal} USD`);
  if(mnTotal > 0) out.push(`${mnTotal} MN`);
  
  const totalInput = document.getElementById('vf-total');
  if(out.length > 0 && totalInput) {
    totalInput.value = out.join(' + ');
  } else if (totalInput && !pUSD && !pMN && !mens) {
    totalInput.value = '';
  }
}

function onFormInput() {
  const activeId = document.activeElement?.id;
  if(['vf-mensajeria', 'vf-precioUSD', 'vf-precioMN'].includes(activeId)) {
    calcAutoTotal();
  }
  const allFilled=!!activeGestorId&&REQUIRED.every(id=>fVal(id).length>0);
  const btn=document.getElementById('sendValeBtn');if(btn)btn.disabled=!allFilled;
  const anyFilled=REQUIRED.some(id=>fVal(id).length>0)||['vf-mensajeria','vf-precioUSD','vf-precioMN','vf-vuelto','vf-garantia'].some(id=>fVal(id).length>0);
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
    `🔸Precio MN: ${fVal('vf-precioMN')}`,
    `🔸 Vuelto: ${fVal('vf-vuelto')}`,
    `🔸 Total a pagar: ${fVal('vf-total')}`, '',
    `*Garantía: ${fVal('vf-garantia')}`,
    `*Fecha y hora de Venta: ${fVal('vf-fecha')||nowDateTime()}`, '',
    '🧭Dirección de la tienda:','* Amistad #313% San Rafael y San José, Centro Habana.','',
    '🚨ATENCIÓN🚨','•   Horarios de atención al cliente:','    8:00am - 8:00pm.',
    '* Solo aceptamos hasta cinco billetes de 1 USD por compra.',
    '* Los pagos en MN deben ser con denominación de 50 en adelante.',
    '* Solo se aceptan billetes en buen estado (ni rotos ni manchados)'].join('\n');
}

function openTicketModal() {
  const g = gestorOf(activeGestorId);
  document.getElementById('tk-gestor').textContent = g ? g.name : '';
  document.getElementById('tk-cliente').textContent = fVal('vf-cliente') || 'Sin nombre';
  document.getElementById('tk-articulo').textContent = fVal('vf-articulo') || 'Sin artículo';
  document.getElementById('tk-total').textContent = fVal('vf-total') || '—';
  
  document.getElementById('ticketModal').classList.add('show');
}


async function shareTicketImage() {
  if (typeof html2canvas === 'undefined') {
    showToast('Cargando creador de imágenes, intenta de nuevo...');
    return;
  }
  const ticketEl = document.getElementById('ticketVisual');
  showToast('Generando imagen...');
  
  try {
    const canvas = await html2canvas(ticketEl, { scale: 2, useCORS: true, backgroundColor: '#ffffff' });
    canvas.toBlob(async (blob) => {
      const file = new File([blob], 'ticket_axontech.png', { type: 'image/png' });
      
      // Check if mobile sharing is supported
      if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({
            title: 'Ticket de Recogida',
            text: 'Muestra esta imagen al llegar a la tienda.',
            files: [file]
          });
        } catch(e) {
          // If user cancels or it fails, fallback to download
          if(e.name !== 'AbortError') {
             downloadBlob(blob, 'ticket_axontech.png');
          }
        }
      } else {
        // Fallback for PC or unsupported browsers
        downloadBlob(blob, 'ticket_axontech.png');
        showToast('Imagen descargada ✓');
      }
    }, 'image/png');
  } catch (e) {
    console.error(e);
    showToast('Error al generar la imagen');
  }
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function copyTicketText() {
  const g = gestorOf(activeGestorId);
  const text = `🏪 *TICKET DE RECOGIDA - AXONTECH* 🏪
-----------------------------------
👤 *Atendido por:* ${g ? g.name : ''}
👤 *Cliente:* ${fVal('vf-cliente') || 'Sin nombre'}
📦 *Artículo:* ${fVal('vf-articulo') || 'Sin artículo'}
💰 *Total a pagar:* ${fVal('vf-total') || '—'}
-----------------------------------
📍 *Dirección de Tienda:* 
Amistad #313 % San Rafael y San José, Centro Habana.

⚠️ *Importante:* Por favor, muestre este mensaje en el mostrador al llegar a la tienda para que le entreguen su pedido rápidamente y se le asigne la venta a su promotor.`;

  navigator.clipboard.writeText(text).then(() => showToast('¡Texto del Ticket copiado! ✓')).catch(() => showToast('Error al copiar'));
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
   'vf-precioUSD','vf-precioMN','vf-vuelto','vf-total','vf-garantia'].forEach(id=>{
     const el=document.getElementById(id);if(el)el.value='';
   });
  currentValeProductos=[];selectedProductsUI=[];
  renderSelectedProductsUI();
  
  const btn=document.getElementById('sendValeBtn');
  if(btn) {
    btn.disabled=true;
    btn.textContent='📤 Enviar';
    btn.classList.replace('btn-green', 'btn-blue');
  }
  document.getElementById('previewCard').style.display='none';
  showToast('Formulario limpio ✨');
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
    precioUSD:fVal('vf-precioUSD'),precioMN:fVal('vf-precioMN'),
    vuelto:fVal('vf-vuelto'),total:fVal('vf-total'),garantia:fVal('vf-garantia'),
    valeProductos:currentValeProductos,valeText:buildValeText(),
    status:'pending',mensajeroId:null,confirmedTs:null,isNew:true,adminNotes:'',
  };
  const all=getVales();all.push(vale);saveVales(all);
  if(typeof fbAddVale === 'function') fbAddVale(vale);
  
  // Transform Send button to Sent state, DO NOT CLEAR FORM YET
  const btn=document.getElementById('sendValeBtn');
  if(btn) {
    btn.disabled=true;
    btn.textContent='¡Enviado! ✓';
    btn.classList.replace('btn-blue', 'btn-green');
  }
  
  renderGestores();renderMyVales();updateAdminBadge();
  playSound('vale');
  sendBrowserNotif('AXONTECH – Nuevo vale',`${g.name} envió un vale para ${vale.cliente}`);
  showToast('Vale enviado al administrador ✓');

  if(adminActive){
    const _nbt=document.getElementById('notifBannerText'); if(_nbt)_nbt.textContent=`${g.name} acaba de enviar un vale`;
    const _nb=document.getElementById('notifBanner'); if(_nb)_nb.classList.add('show');
    renderAdminGestores();
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
  if(!c) return;
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
  if(!c) return;
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
    if(p.precio.includes('MN'))cur='MN';
  });
  if(total>0){
    const fmt=`$${total} ${cur}`;
    if(cur==='MN'){document.getElementById('vf-precioMN').value=fmt;document.getElementById('vf-precioUSD').value='';}else{document.getElementById('vf-precioUSD').value=fmt;document.getElementById('vf-precioMN').value='';}
    calcAutoTotal();
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
  if(!c) return;
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
  if(!c) return;
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
  if(!c) return;
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
   const isMN=com.toUpperCase().includes('MN');
   const num=parseFloat(com.replace(/[^0-9.]/g,''))||'';
   document.getElementById('pm-comision-amount').value=num;
   document.getElementById('pm-comision-currency').value=isMN?'MN':'USD';}
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
    comision:(()=>{const amt=parseFloat(document.getElementById('pm-comision-amount').value);const cur=document.getElementById('pm-comision-currency').value;return amt>0?(cur==='MN'?`${amt} MN`:`$${amt} USD`):''})(),
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
  renderProductGrid();renderStockCategorias();showToast('Producto eliminado');
}


function venderDirecto(id) {
  const p=productoOf(id);if(!p)return;
  const q = prompt(`¿Cuántas unidades de ${p.name} se vendieron directamente en la tienda?`, '1');
  if(q === null) return;
  const qty = parseInt(q);
  if(isNaN(qty) || qty <= 0) return showToast('Cantidad inválida');
  if(qty > (p.stock||0)) return showToast('Stock insuficiente');
  
  // Deduct stock
  const newStock = p.stock - qty;
  patchProducto(id, {stock: newStock});
  
  if(newStock===0 && p.stock>0) addNotif('out_of_stock',p.name,id,'stock agotado');
  else if(newStock>0 && newStock<=LOW_STOCK_THRESHOLD && p.stock>LOW_STOCK_THRESHOLD) addNotif('low_stock',p.name,id,`quedan ${newStock}`);
  
  // Create vale record for stats
  const vale={
    id:Date.now(),valeNum:getNextValeNum(),gestorId:'admin',ts:new Date().toISOString(),
    cliente:'Venta Directa en Tienda',telefono:'',direccion:'Tienda Física',
    mensajeria:'',articulo:`${p.name} x${qty}`,
    precioUSD:p.precio,precioMN:'',
    vuelto:'',total:'Venta Local',garantia:p.garantia||'',
    valeProductos:[{id:p.id,name:p.name,qty}],valeText:'Venta en tienda',
    status:'confirmed',mensajeroId:null,confirmedTs:new Date().toISOString(),isNew:false,adminNotes:'Venta directa sin gestor',
    commissionPaid:true,commissionPaidTs:new Date().toISOString()
  };
  const all=getVales();all.push(vale);saveVales(all);
  if(typeof fbAddVale === 'function') {
     db.ref(`vales/admin/${vale.id}`).set(vale);
  }
  
  renderProductGrid();
  statsTabDirty=true;
  showToast('Venta directa registrada ✓');
}
function adjustStock(id) {
  const p=productoOf(id);if(!p)return;
  const n=prompt(`Stock actual: ${p.stock||0}
Nuevo stock:`,p.stock||0);
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
    { id:2001, gestorId:1, ts:h(0.5),  cliente:'Roberto Silva',   telefono:'55551234', direccion:'Calle 23 #456, Vedado',       mensajeria:'$2 USD',  articulo:'iPhone 15 Pro x1',    precioUSD:'$950 USD', precioMN:'',        vuelto:'',      total:'$950 USD',  garantia:'6 meses', valeProductos:[{id:100,name:'iPhone 15 Pro',qty:1}],    valeText:'', status:'pending',         mensajeroId:null, confirmedTs:null,  isNew:true  },
    { id:2002, gestorId:2, ts:h(1.2),  cliente:'María Torres',    telefono:'55559876', direccion:'Av 5ta #88 e/8 y 10',         mensajeria:'Gratis',  articulo:'AirPods Pro 2 x2',    precioUSD:'$360 USD', precioMN:'',        vuelto:'',      total:'$360 USD',  garantia:'3 meses', valeProductos:[{id:102,name:'AirPods Pro 2',qty:2}],    valeText:'', status:'assigned',        mensajeroId:50,   confirmedTs:null,  deliveredTs:null,  isNew:false },
    { id:2007, gestorId:3, ts:h(1.8),  cliente:'Diana Vázquez',   telefono:'55552468', direccion:'Neptuno #89, Centro Habana',   mensajeria:'$2 USD',  articulo:'Laptop HP Victus x1', precioUSD:'$680 USD', precioMN:'',        vuelto:'',      total:'$680 USD',  garantia:'12 meses',valeProductos:[{id:104,name:'Laptop HP Victus',qty:1}],  valeText:'', status:'delivered',       mensajeroId:51,   confirmedTs:null,  deliveredTs:h(0.3),isNew:false },
    { id:2003, gestorId:1, ts:h(2.0),  cliente:'Luis Pérez',      telefono:'55554321', direccion:'Obispo #12, Habana Vieja',    mensajeria:'$1 USD',  articulo:'Funda iPhone 15 x3',  precioUSD:'$45 USD',  precioMN:'4050 MN',vuelto:'0',     total:'$45 USD',   garantia:'',         valeProductos:[{id:103,name:'Funda iPhone 15',qty:3}],  valeText:'', status:'confirmed',       mensajeroId:51,   confirmedTs:h(0.8),isNew:false },
    { id:2004, gestorId:3, ts:h(3.1),  cliente:'Carmen Díaz',     telefono:'55557890', direccion:'23 y 12 #234, Vedado',        mensajeria:'$2 USD',  articulo:'Samsung Galaxy S24 x1',precioUSD:'$780 USD',precioMN:'',        vuelto:'',      total:'$780 USD',  garantia:'6 meses', valeProductos:[{id:101,name:'Samsung Galaxy S24',qty:1}],valeText:'', status:'pending_payment', mensajeroId:50,   confirmedTs:null,  isNew:false },
    { id:2005, gestorId:4, ts:h(4.5),  cliente:'Oscar Fernández', telefono:'55553456', direccion:'Línea #78 esq L',             mensajeria:'$3 USD',  articulo:'Laptop HP Victus x1', precioUSD:'$680 USD', precioMN:'',        vuelto:'',      total:'$680 USD',  garantia:'12 meses',valeProductos:[{id:104,name:'Laptop HP Victus',qty:1}],  valeText:'', status:'pending',         mensajeroId:null, confirmedTs:null,  isNew:true  },
    { id:2006, gestorId:2, ts:h(5.0),  cliente:'Yolanda Cruz',    telefono:'55558765', direccion:'Reina #302, Centro Habana',   mensajeria:'Gratis',  articulo:'iPhone 15 Pro x1',    precioUSD:'$950 USD', precioMN:'',        vuelto:'',      total:'$950 USD',  garantia:'6 meses', valeProductos:[{id:100,name:'iPhone 15 Pro',qty:1}],    valeText:'', status:'confirmed',       mensajeroId:51,   confirmedTs:h(3.0),isNew:false },
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
    `🔸Precio MN: ${v.precioMN}`,`🔸 Vuelto: ${v.vuelto}`,`🔸 Total a pagar: ${v.total}`,'',
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
  if(!c) return;
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
        if((p.precio||'').includes('MN'))currency='MN';
      } else {
        parts.push({label,com});computable=false;
      }
    } else {
      const num=parsePrecioNum(com);
      if(num>0){total+=num*qty;parts.push({label,com:`${com}${qty>1?` ×${qty}`:''}`});}
      else{parts.push({label,com});computable=false;}
      if(com.includes('MN'))currency='MN';
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
    let gtUSD=0,gtMN=0,gtAllComputed=true;
    pending.forEach(v=>{const r=getValeCommissionParts(v);if(r.total===null){gtAllComputed=false;}else{if(r.currency==='MN')gtMN+=r.total;else gtUSD+=r.total;}});
    const gtBadgeParts=[];if(gtUSD>0)gtBadgeParts.push(`$${gtUSD.toFixed(2)} USD`);if(gtMN>0)gtBadgeParts.push(`${Math.round(gtMN)} MN`);
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
      let sumUSD=0,sumMN=0,canSum=true;
      pending.forEach(v=>{const r=getValeCommissionParts(v);if(r.total===null){canSum=false;}else{if(r.currency==='MN')sumMN+=r.total;else sumUSD+=r.total;}});
      const sumParts=[];if(sumUSD>0)sumParts.push(`$${sumUSD.toFixed(2)} USD`);if(sumMN>0)sumParts.push(`${Math.round(sumMN)} MN`);
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
            <button class="btn btn-ghost btn-sm" style="font-size:10px;padding:3px 8px;margin-top:4px;color:var(--orange);" onclick="unpayCommission(${v.id},event)">↩ Revertir</button>
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
  
  const sumStr = localStorage.getItem('axon_ranking_summary');
  let summary = [];
  if (sumStr) {
    summary = JSON.parse(sumStr);
  } else {
    // fallback if no summary
    const vales=getVales().filter(v=>['confirmed','pending_payment'].includes(v.status));
    summary = gestores.map(g=>{
      const pts=vales.filter(v=>v.gestorId===g.id).reduce((sum,v)=>
        sum+(v.valeProductos||[]).reduce((s,p)=>{const pr=productoOf(p.id);return s+(pr?pr.puntos*p.qty:0);},0),0);
      return {id: g.id, pts};
    });
  }

  const ranked=gestores.map(g=>{
    const s = summary.find(x => x.id === g.id);
    return {...g, pts: s ? s.pts : 0};
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
      if (subcat && !desc.includes(subcat)) desc = `[${subcat}]
${desc}`;
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
  if(!confirm(`¿Importar datos desde \"${file.name}\"?\nEsto reemplazará todos los datos locales actuales.`)){input.value='';return;}
  const reader=new FileReader();
  reader.onload=e=>{
    try {
      const data=JSON.parse(e.target.result);
      if(data.gestores)saveGestores(data.gestores);
      if(data.mensajeros)saveMensajeros(data.mensajeros);
      if(data.productos)saveProductos(data.productos);
      if(data.categorias)saveCategorias(data.categorias);
      if(data.vales) {
        saveVales(data.vales);
        const obj = {};
        data.vales.forEach(v => {
           if(!obj[v.gestorId]) obj[v.gestorId] = {};
           obj[v.gestorId][v.id] = v;
        });
        db.ref('vales').set(obj);
      }
      if(data.notifs)saveNotifs(data.notifs);
      // Reload UI
      activeGestorId=null;activeMensajeroId=null;selectedValeId=null;adminGestorFilter=null;
      expandedCatalogId=null;activeComisionGestorId=null;
      rankingCache=null;gestoresTabDirty=true;statsTabDirty=true;
      renderGestores();renderGestorRanking();renderGestorNotifs();
      renderAdminGestores();renderValeDetail();
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
  cfg.ghPath=document.getElementById('gh-path').value.trim()||'data.json';
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
  if(path)path.value=cfg.ghPath||'data.json';
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
    if(data.vales) {
        saveVales(data.vales);
        const obj = {};
        data.vales.forEach(v => {
           if(!obj[v.gestorId]) obj[v.gestorId] = {};
           obj[v.gestorId][v.id] = v;
        });
        db.ref('vales').set(obj);
      }
    if(statusEl)statusEl.innerHTML='<span style="color:var(--green);">✓ Datos restaurados desde GitHub</span>';
    activeGestorId=null;activeMensajeroId=null;selectedValeId=null;adminGestorFilter=null;
    renderGestores();renderGestorRanking();renderAdminGestores();
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

function factoryResetVales() {
  showConfirmAction('¿BORRAR TODOS LOS VALES?', 'Esta acción no se puede deshacer y vaciará el historial.', 'Sí, borrar todo', 'btn-red', () => {
    saveVales([]);
    if (!isSyncingFromFirebase) {
       db.ref('vales').remove();
    }
    showToast('Todos los vales eliminados');
    selectedValeId=null;
    refreshUI();
  });
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
  btn.onclick = () => { const cb = confirmActionCb; closeConfirmAction(); cb && cb(); };
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
  renderAdminGestores();renderValeDetail();
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
  if(!c) return;
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
//  INITIAL DATA LOAD & GESTOR PULL
// ══════════════════════════════════════════



async function loadInitialData() {
  if (getGestores().length === 0 && getProductos().length === 0) {
    try {
      const res = await fetch('./data.json?t=' + Date.now());
      if (res.ok) {
        const data = await res.json();
        // Skip Firebase save during initial local fallback load
        isSyncingFromFirebase = true;
        if (data.gestores) localStorage.setItem('axon_gestores', JSON.stringify(data.gestores));
        if (data.mensajeros) localStorage.setItem('axon_mensajeros', JSON.stringify(data.mensajeros));
        if (data.productos) localStorage.setItem('axon_productos', JSON.stringify(data.productos));
        if (data.categorias) localStorage.setItem('axon_categorias', JSON.stringify(data.categorias));
        if (data.vales) localStorage.setItem('axon_vales', JSON.stringify(data.vales));
        isSyncingFromFirebase = false;
        
        // Let the Admin UI know data is loaded to draw the password modal immediately
      }
    } catch(e) {}
  }
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
  
  if (adminActive) {
    activateAdminMode();
  } else {
    openPassModal();
  }
}
init();
