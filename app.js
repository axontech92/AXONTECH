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
// Escape for HTML attribute context (also escapes single quotes)
function escapeAttr(str) {
  return escapeHTML(str);
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
let _syncCount = 0;
const isSyncingFromFirebase = () => _syncCount > 0;

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
let pickerSelected    = {};
let pickerCatFilter   = null;
let catalogCatFilter  = null;
let expandedCatalogId = null;
let adminCatalogCatFilter = null;
let selectedProductsUI= [];
let currentValeProductos = [];
let pendingGestorId      = null;
let activeComisionGestorId = null;
let gestoresTabDirty = true;
let statsTabDirty    = true;
let rankingCache = null;
let confirmActionCb  = null;
let adminGestorMenuExpanded = false;
let mensajeroManagerExpanded = false;
let pendingCobroExpanded = false;

// ══════════════════════════════════════════
//  HELPERS
// ══════════════════════════════════════════
const GESTOR_COLORS = ['#2563EB','#7C3AED','#059669','#DC2626','#D97706','#0891B2','#BE185D','#1D4ED8'];
const gestorOf    = id => getGestores().find(g=>g.id===id);
const mensajeroOf = id => getMensajeros().find(m=>m.id===id);
const productoOf  = id => getProductos().find(p=>p.id===id);
const todayStr    = () => new Date().toDateString();
const timeStr     = ts => new Date(ts).toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit'});
function nowDateTime() {
  const d=new Date();
  return `${d.getDate()}/${d.getMonth()+1}/${d.getFullYear()} ${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`;
}
function timeAgo(dateString) {
  const d=new Date(dateString);const now=new Date();const diffMs=now-d;
  const diffMins=Math.round(diffMs/60000);
  if(diffMins<1)return 'Ahora';
  if(diffMins<60)return diffMins+'m';
  const diffHours=Math.floor(diffMins/60);
  if(diffHours<24)return diffHours+'h';
  const diffDays=Math.floor(diffHours/24);
  return diffDays+'d';
}
const pendingCount= () => getVales().filter(v=>v.status==='pending').length;
const pendingOf   = gId=> getVales().filter(v=>v.gestorId===gId&&v.status==='pending').length;
const todayValesOf= gId=> getVales().filter(v=>v.gestorId===gId&&new Date(v.ts).toDateString()===todayStr());



// ══════════════════════════════════════════
//  FIREBASE WRITE QUEUE — prevents data loss from isSyncingFromFirebase flag
// ══════════════════════════════════════════
const _fbWriteQueue = [];
let _fbProcessing = false;

function _processFBQueue() {
  if (_fbProcessing || _fbWriteQueue.length === 0) return;
  _fbProcessing = true;
  const item = _fbWriteQueue.shift();
  item.retries = (item.retries || 0) + 1;
  const {path, value, method, callback} = item;
  const ref = db.ref(path);
  const op = method === 'remove' ? ref.remove() : method === 'update' ? ref.update(value) : ref.set(value);
  op.then(() => { if(callback) callback(); })
    .catch(e => {
      console.error("Firebase write error:", e);
      if (item.retries < 5) {
        const delay = Math.min(1000 * Math.pow(2, item.retries), 30000);
        setTimeout(() => { _fbWriteQueue.unshift(item); _fbProcessing = false; _processFBQueue(); }, delay);
        return;
      }
      console.error("Firebase write permanently failed:", path);
      try {
        const failed = JSON.parse(localStorage.getItem('axon_failed_writes') || '[]');
        failed.push({path, value, method, ts: new Date().toISOString()});
        localStorage.setItem('axon_failed_writes', JSON.stringify(failed));
      } catch(e2) {}
    })
    .finally(() => { _fbProcessing = false; _processFBQueue(); });
}

function _enqueueFB(path, value, method='set', callback=null) {
  _fbWriteQueue.push({path, value, method, callback});
  _processFBQueue();
}

const setFB = (path, v) => {
  _enqueueFB(path, v, 'set');
};

// ═══ In-memory cache layer ═══
let _gestoresCache = null, _gestoresDirty = true;
let _valesCache = null, _valesDirty = true;
let _mensajerosCache = null, _mensajerosDirty = true;
let _productosCache = null, _productosDirty = true;
let _categoriasCache = null, _categoriasDirty = true;
let _configCache = null, _configDirty = true;
let _notifsCache = null, _notifsDirty = true;

const getGestores   = () => { if (_gestoresDirty || !_gestoresCache) { try { _gestoresCache = JSON.parse(localStorage.getItem('axon_gestores') || '[]'); } catch(e) { _gestoresCache = []; } _gestoresDirty = false; } return _gestoresCache; };
const saveGestores  = v  => { try { localStorage.setItem('axon_gestores', JSON.stringify(v)); } catch(e) { console.error('localStorage write error:', e); } _gestoresCache = v; _gestoresDirty = false; setFB('gestores', v); };

const getVales      = () => { if (_valesDirty || !_valesCache) { try { _valesCache = JSON.parse(localStorage.getItem('axon_vales') || '[]'); } catch(e) { _valesCache = []; } _valesDirty = false; } return _valesCache; };
// Vales are synced via saveVales → _enqueueFB('vales', obj, 'set') through the write queue
// Individual fbUpdateVale was removed from patchVale to prevent race conditions
const saveVales     = v  => { try { localStorage.setItem('axon_vales', JSON.stringify(v)); } catch(e) { console.error('localStorage write error:', e); } _valesCache = v; _valesDirty = false; if (!isSyncingFromFirebase()) { _enqueueFB('vales', _valesToFirebaseObj(v), 'set'); } };

const getMensajeros = () => { if (_mensajerosDirty || !_mensajerosCache) { try { _mensajerosCache = JSON.parse(localStorage.getItem('axon_mensajeros') || '[]'); } catch(e) { _mensajerosCache = []; } _mensajerosDirty = false; } return _mensajerosCache; };
const saveMensajeros= v  => { try { localStorage.setItem('axon_mensajeros', JSON.stringify(v)); } catch(e) { console.error('localStorage write error:', e); } _mensajerosCache = v; _mensajerosDirty = false; setFB('mensajeros', v); };

const getProductos  = () => { if (_productosDirty || !_productosCache) { try { _productosCache = JSON.parse(localStorage.getItem('axon_productos') || '[]'); } catch(e) { _productosCache = []; } _productosDirty = false; } return _productosCache; };
const saveProductos = v  => { try { localStorage.setItem('axon_productos', JSON.stringify(v)); } catch(e) { console.error('localStorage write error:', e); } _productosCache = v; _productosDirty = false; setFB('productos', v); triggerAutoPublishCatalog(); };

// ══════════════════════════════════════════
//  AUTO-PUBLISH CATALOG TO GITHUB
// ══════════════════════════════════════════
let _catalogPublishTimer = null;
function triggerAutoPublishCatalog() {
  const cfg = getConfig();
  if (!cfg.ghAutoPublishCatalog || !cfg.ghToken || !cfg.ghRepo) return;
  clearTimeout(_catalogPublishTimer);
  _catalogPublishTimer = setTimeout(async () => {
    try {
      const html = buildCatalogHTML();
      if (html) await publishCatalogToGitHub(html);
    } catch(e) { console.error('Auto-publish catalog error:', e); }
  }, 5000);
}

function buildCatalogHTML() {
  const cats=getCategorias();
  const allProds=getProductos().filter(p=>(p.stock||0)>0);
  if(!allProds.length) return null;
  const cfg=getConfig();
  const waPhone=cfg.catalogPhone||cfg.adminPhone||'';
  const catColors=['#006d8a','#7c3aed','#dc2626','#059669','#d97706','#2563eb','#be185d','#475569'];
  const dateStr=new Date().toLocaleDateString('es-ES',{year:'numeric',month:'long',day:'numeric'});
  let catCardsJS='';
  if(cats.length){
    let ci=0;
    cats.forEach(cat=>{
      const prods=allProds.filter(p=>p.catId===cat.id);
      if(!prods.length)return;
      const color=catColors[ci%catColors.length];ci++;
      prods.forEach(p=>{catCardsJS+=buildCatalogCardJS(p,cat,color,waPhone);});
    });
    const noCat=allProds.filter(p=>!p.catId||!cats.find(c=>c.id===p.catId));
    if(noCat.length){
      const color=catColors[ci%catColors.length];ci++;
      noCat.forEach(p=>{catCardsJS+=buildCatalogCardJS(p,null,color,waPhone);});
    }
  } else {
    allProds.forEach(p=>{catCardsJS+=buildCatalogCardJS(p,null,'#006d8a',waPhone);});
  }
  return `<!DOCTYPE html><html lang="es"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<title>AXONTECH - Catalogo</title>
<link rel="icon" href="https://axontech92.github.io/AXONTECH/iconos/favicon-96.png">
<meta property="og:title" content="AXONTECH - Catalogo de Productos">
<meta property="og:description" content="Explora nuestros productos disponibles">
<meta property="og:type" content="website">
<style>
*{box-sizing:border-box;margin:0;padding:0;}
:root{--primary:#006d8a;--primary-dk:#004d60;--accent:#00b4d8;--bg:#f0f4f8;--card:#fff;--text:#1a1a2e;--muted:#64748b;--radius:16px;--shadow:0 4px 20px rgba(0,0,0,.08);}
body{font-family:'Segoe UI',-apple-system,BlinkMacSystemFont,system-ui,sans-serif;background:var(--bg);color:var(--text);line-height:1.5;min-height:100vh;-webkit-font-smoothing:antialiased;}
.hero{background:linear-gradient(135deg,var(--primary-dk) 0%,var(--primary) 50%,var(--accent) 100%);padding:48px 20px 36px;text-align:center;position:relative;overflow:hidden;}
.hero::before{content:'';position:absolute;top:-50%;left:-50%;width:200%;height:200%;background:radial-gradient(circle,rgba(255,255,255,.06) 0%,transparent 60%);animation:heroGlow 8s ease-in-out infinite alternate;}
@keyframes heroGlow{0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}}
.hero-logo{font-size:48px;font-weight:900;color:#fff;letter-spacing:10px;text-shadow:0 2px 20px rgba(0,0,0,.3);position:relative;z-index:1;}
.hero-sub{font-size:14px;letter-spacing:5px;color:rgba(255,255,255,.8);font-weight:300;margin-top:4px;position:relative;z-index:1;}
.hero-line{width:50px;height:3px;background:rgba(255,255,255,.4);margin:14px auto;border-radius:2px;position:relative;z-index:1;}
.hero-info{font-size:11px;color:rgba(255,255,255,.55);letter-spacing:1px;position:relative;z-index:1;}
.hero-count{display:inline-block;background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.2);border-radius:20px;padding:5px 18px;font-size:12px;color:rgba(255,255,255,.9);margin-top:12px;font-weight:600;position:relative;z-index:1;}
.nav{position:sticky;top:0;z-index:100;background:rgba(255,255,255,.92);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border-bottom:1px solid rgba(0,0,0,.06);padding:10px 16px;display:flex;gap:8px;overflow-x:auto;scrollbar-width:none;-webkit-overflow-scrolling:touch;}
.nav::-webkit-scrollbar{display:none;}
.nav-btn{padding:7px 16px;border-radius:20px;border:1.5px solid #e2e8f0;background:#fff;font-size:12px;font-weight:700;color:var(--muted);cursor:pointer;white-space:nowrap;transition:all .2s;}
.nav-btn:hover{border-color:var(--primary);color:var(--primary);}
.nav-btn.active{background:var(--primary);color:#fff;border-color:var(--primary);box-shadow:0 2px 8px rgba(0,109,138,.25);}
.container{max-width:1200px;margin:0 auto;padding:16px;}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:20px;}
.card{background:var(--card);border-radius:var(--radius);overflow:hidden;box-shadow:var(--shadow);transition:transform .25s,box-shadow .25s;position:relative;display:flex;flex-direction:column;}
.card:hover{transform:translateY(-4px);box-shadow:0 8px 30px rgba(0,0,0,.12);}
.card-img{height:220px;background:linear-gradient(145deg,#f8fafc,#eef2f7);display:flex;align-items:center;justify-content:center;overflow:hidden;position:relative;}
.card-img img{width:100%;height:100%;object-fit:cover;transition:transform .4s;}
.card:hover .card-img img{transform:scale(1.05);}
.card-img .no-img{font-size:64px;opacity:.25;}
.card-cat{position:absolute;top:12px;left:12px;color:#fff;padding:4px 12px;border-radius:8px;font-size:10px;font-weight:800;letter-spacing:.5px;text-transform:uppercase;box-shadow:0 2px 6px rgba(0,0,0,.15);}
.card-body{padding:18px 20px 20px;flex:1;display:flex;flex-direction:column;}
.card-name{font-weight:800;font-size:16px;color:var(--text);margin-bottom:6px;line-height:1.3;min-height:42px;}
.card-desc{font-size:12.5px;color:var(--muted);line-height:1.55;margin-bottom:12px;height:58px;overflow:hidden;position:relative;cursor:pointer;transition:max-height .3s ease;}
.card-desc.expanded{max-height:500px;}
.card-desc-fade{position:absolute;bottom:0;left:0;right:0;height:28px;background:linear-gradient(transparent,#fff);pointer-events:none;transition:opacity .3s;}
.card-desc.expanded+.card-desc-fade,.card-desc.expanded~.card-desc-fade{opacity:0;}
.card-price{font-weight:900;font-size:22px;color:var(--primary);margin-bottom:12px;letter-spacing:.3px;min-height:30px;}
.card-badges{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px;min-height:26px;}
.badge{padding:4px 10px;border-radius:8px;font-size:10px;font-weight:700;letter-spacing:.3px;}
.badge-garantia{background:#f0fdf4;color:#16a34a;border:1px solid #bbf7d0;}
.wa-btn{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;padding:12px;border:none;border-radius:12px;background:linear-gradient(135deg,#25d366,#128c7e);color:#fff;font-size:13px;font-weight:700;cursor:pointer;transition:all .2s;text-decoration:none;letter-spacing:.3px;margin-top:auto;}
.wa-btn:hover{transform:scale(1.02);box-shadow:0 4px 14px rgba(37,211,102,.35);}
.wa-btn:active{transform:scale(.98);}
.wa-icon{font-size:18px;}
.footer{text-align:center;padding:32px 20px;margin-top:40px;border-top:1px solid #e2e8f0;background:#fff;}
.footer-brand{font-size:14px;font-weight:900;color:var(--primary);letter-spacing:4px;margin-bottom:6px;}
.footer-addr{font-size:11px;color:var(--muted);line-height:1.6;}
.footer-gen{font-size:9px;color:#cbd5e1;margin-top:8px;}
.float-wa{position:fixed;bottom:24px;right:24px;width:56px;height:56px;border-radius:50%;background:#25d366;color:#fff;display:flex;align-items:center;justify-content:center;font-size:28px;box-shadow:0 4px 16px rgba(37,211,102,.4);cursor:pointer;z-index:999;transition:transform .2s;text-decoration:none;border:none;}
.float-wa:hover{transform:scale(1.1);}
.empty{text-align:center;padding:60px 20px;color:var(--muted);}
.empty-icon{font-size:48px;margin-bottom:12px;opacity:.5;}
.pmodal-bg{position:fixed;inset:0;z-index:2000;background:rgba(0,0,0,.55);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center;padding:16px;opacity:0;transition:opacity .25s;pointer-events:none;}
.pmodal-bg.show{opacity:1;pointer-events:auto;}
.pmodal{background:var(--card);border-radius:var(--radius);max-width:420px;width:100%;max-height:90vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,.3);transform:translateY(20px);transition:transform .25s;}
.pmodal-bg.show .pmodal{transform:translateY(0);}
.pmodal-img{width:100%;height:260px;object-fit:cover;display:block;}
.pmodal-noimg{width:100%;height:180px;display:flex;align-items:center;justify-content:center;font-size:64px;opacity:.2;background:linear-gradient(145deg,#f8fafc,#eef2f7);}
.pmodal-cat{display:inline-block;color:#fff;padding:4px 12px;border-radius:8px;font-size:10px;font-weight:800;letter-spacing:.5px;text-transform:uppercase;margin-bottom:8px;}
.pmodal-body{padding:20px 22px 24px;}
.pmodal-name{font-weight:800;font-size:20px;color:var(--text);margin-bottom:8px;line-height:1.3;}
.pmodal-desc{font-size:13.5px;color:var(--muted);line-height:1.65;margin-bottom:14px;}
.pmodal-price{font-weight:900;font-size:24px;color:var(--primary);margin-bottom:10px;}
.pmodal-badge{display:inline-block;padding:4px 12px;border-radius:8px;font-size:11px;font-weight:700;background:#f0fdf4;color:#16a34a;border:1px solid #bbf7d0;margin-bottom:16px;}
.pmodal-close{position:absolute;top:12px;right:12px;width:36px;height:36px;border-radius:50%;background:rgba(0,0,0,.45);color:#fff;border:none;font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center;z-index:5;transition:background .2s;}
.pmodal-close:hover{background:rgba(0,0,0,.7);}
@media(max-width:640px){
  .hero{padding:36px 16px 28px;}
  .hero-logo{font-size:36px;letter-spacing:6px;}
  .hero-sub{font-size:11px;letter-spacing:3px;}
  .grid{grid-template-columns:1fr;gap:16px;}
  .card-img{height:200px;}
  .container{padding:12px;}
}
@media(min-width:641px) and (max-width:1024px){
  .grid{grid-template-columns:repeat(2,1fr);}
}
</style>
</head><body>
<div class="hero">
  <div class="hero-logo">AXONTECH</div>
  <div class="hero-sub">CATALOGO DE PRODUCTOS</div>
  <div class="hero-line"></div>
  <div class="hero-info">${dateStr}</div>
  <div class="hero-count">${allProds.length} productos disponibles</div>
</div>
<div class="nav" id="catNav"></div>
<div class="container"><div class="grid" id="productGrid"></div></div>
<div class="pmodal-bg" id="pmodalBg" onclick="if(event.target===this)closeProduct()">
  <div class="pmodal" style="position:relative;">
    <button class="pmodal-close" onclick="closeProduct()">&times;</button>
    <div id="pmodalContent"></div>
  </div>
</div>
<div class="footer">
  <div class="footer-brand">AXONTECH</div>
  <div class="footer-addr">Amistad #311 % San Rafael y San Jose, Centro Habana</div>
  <div class="footer-gen">Catalogo actualizado: ${dateStr}</div>
</div>
${waPhone?`<a class="float-wa" href="https://wa.me/${waPhone}?text=${encodeURIComponent('Hola, vi el catalogo de AXONTECH y me interesa...')}" target="_blank" title="Chat por WhatsApp">&#128172;</a>`:''}
<script>
var products=[${catCardsJS}];
var catNames=[${cats.map((c,i)=>"{id:"+c.id+",name:"+JSON.stringify(c.name)+",color:'"+catColors[i%catColors.length]+"'}").join(',')}${cats.length?'':",{id:0,name:'Todos',color:'#006d8a'}"}];
var activeCat=null;
function renderNav(){
  var n=document.getElementById('catNav');
  var h='<button class="nav-btn active" onclick="filterCat(null,this)">Todos</button>';
  catNames.forEach(function(c){
    var count=products.filter(function(p){return p.catId===c.id}).length;
    if(count) h+='<button class="nav-btn" onclick="filterCat('+c.id+',this)">'+c.name+' ('+count+')</button>';
  });
  n.innerHTML=h;
}
function filterCat(id,btn){
  activeCat=id;
  document.querySelectorAll('.nav-btn').forEach(function(b){b.classList.remove('active')});
  if(btn)btn.classList.add('active');
  renderGrid();
}
function renderGrid(){
  var g=document.getElementById('productGrid');
  var filtered=activeCat!==null?products.filter(function(p){return p.catId===activeCat}):products;
  if(!filtered.length){g.innerHTML='<div class="empty"><div class="empty-icon">&#128230;</div><div>No hay productos en esta categoria</div></div>';return;}
  g.innerHTML=filtered.map(function(p){
    var s='<div class="card" onclick="openProduct('+p.id+')" style="cursor:pointer;">';
    s+='<div class="card-img">';
    if(p.photo){s+='<img src="'+p.photo+'" data-img="1" loading="lazy">';}
    s+='<div class="no-img" style="'+(p.photo?'display:none':'')+'">&#128230;</div>';
    if(p.catName){s+='<div class="card-cat" style="background:'+p.catColor+'">'+p.catName+'</div>';}
    s+='</div><div class="card-body">';
    s+='<div class="card-name">'+p.name+'</div>';
    s+='<div class="card-desc">'+(p.desc||'')+'<div class="card-desc-fade"></div></div>';
    s+='<div class="card-price">'+(p.price||'')+'</div>';
    s+='<div class="card-badges">';
    if(p.garantia){s+='<span class="badge badge-garantia">Garantia: '+p.garantia+'</span>';}
    s+='</div>';
    if(p.waLink){s+='<a class="wa-btn" href="'+p.waLink+'" target="_blank" onclick="event.stopPropagation();"><span class="wa-icon">&#128172;</span>Pedir por WhatsApp</a>';}
    else{s+='<div class="wa-btn" style="background:#cbd5e1;cursor:default;pointer-events:none;">No disponible</div>';}
    s+='</div></div>';
    return s;
  }).join('');
}
function openProduct(id){
  var p=products.find(function(x){return x.id===id});if(!p)return;
  var c=document.getElementById('pmodalContent');
  var h='';
  if(p.photo){h+='<img class="pmodal-img" src="'+p.photo+'" data-img="1"><div class="pmodal-noimg" style="display:none">&#128230;</div>';}
  else{h+='<div class="pmodal-noimg">&#128230;</div>';}
  h+='<div class="pmodal-body">';
  if(p.catName){h+='<div class="pmodal-cat" style="background:'+p.catColor+'">'+p.catName+'</div>';}
  h+='<div class="pmodal-name">'+p.name+'</div>';
  if(p.desc){h+='<div class="pmodal-desc">'+p.desc+'</div>';}
  if(p.price){h+='<div class="pmodal-price">'+p.price+'</div>';}
  if(p.garantia){h+='<div class="pmodal-badge">Garantia: '+p.garantia+'</div>';}
  if(p.waLink){h+='<a class="wa-btn" href="'+p.waLink+'" target="_blank"><span class="wa-icon">&#128172;</span>Pedir por WhatsApp</a>';}
  h+='</div>';
  c.innerHTML=h;
  document.getElementById('pmodalBg').classList.add('show');
}
function closeProduct(){document.getElementById('pmodalBg').classList.remove('show');}
document.addEventListener('error',function(e){var t=e.target;if(t.tagName==='IMG'&&t.dataset.img){t.style.display='none';if(t.nextElementSibling)t.nextElementSibling.style.display='flex';}},true);
renderNav();renderGrid();
</script>
</body></html>`;
}

const getCategorias = () => { if (_categoriasDirty || !_categoriasCache) { try { _categoriasCache = JSON.parse(localStorage.getItem('axon_categorias') || '[]'); } catch(e) { _categoriasCache = []; } _categoriasDirty = false; } return _categoriasCache; };
const saveCategorias= v  => { try { localStorage.setItem('axon_categorias', JSON.stringify(v)); } catch(e) { console.error('localStorage write error:', e); } _categoriasCache = v; _categoriasDirty = false; setFB('categorias', v); };

const getConfig     = () => { if (_configDirty || !_configCache) { try { _configCache = JSON.parse(localStorage.getItem('axon_config') || '{}'); } catch(e) { _configCache = {}; } _configDirty = false; } return _configCache; };
const saveConfig    = v  => { try { localStorage.setItem('axon_config', JSON.stringify(v)); } catch(e) { console.error('localStorage write error:', e); } _configCache = v; _configDirty = false; setFB('config', v); };

const getNotifs     = () => { if (_notifsDirty || !_notifsCache) { try { _notifsCache = JSON.parse(localStorage.getItem('axon_notifs') || '[]'); } catch(e) { _notifsCache = []; } _notifsDirty = false; } return _notifsCache; };
const saveNotifs    = v  => { try { localStorage.setItem('axon_notifs', JSON.stringify(v)); } catch(e) { console.error('localStorage write error:', e); } _notifsCache = v; _notifsDirty = false; setFB('notifs', v); };

// ══════════════════════════════════════════
//  ESTAFA (Scam Blacklist) DATA
// ══════════════════════════════════════════
let _estafaCache = null;
let _estafaDirty = true;
const getEstafa   = () => { if (_estafaDirty || !_estafaCache) { try { _estafaCache = JSON.parse(localStorage.getItem('axon_estafa') || '[]'); } catch(e) { _estafaCache = []; } _estafaDirty = false; } return _estafaCache; };
const saveEstafa  = v  => { try { localStorage.setItem('axon_estafa', JSON.stringify(v)); } catch(e) { console.error('localStorage write error:', e); } _estafaCache = v; _estafaDirty = false; setFB('estafa', v); };

function checkEstafaMatch(vale) {
  const lista = getEstafa();
  if (!lista.length) return [];
  const matches = [];
  // Normalize function: remove accents, lowercase, trim spaces
  const norm = s => (s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
  const vPhone = (vale.telefono || '').replace(/[\s\-()]/g, '');
  const vCliente = norm(vale.cliente || '');
  const vDireccion = norm(vale.direccion || '');
  const vCarnet = norm(vale.carnet || '');
  lista.forEach(e => {
    const reasons = [];
    // Phone match (exact digits only, no formatting)
    if (e.telefono && vPhone) {
      const ePhone = e.telefono.replace(/[\s\-()]/g, '');
      if (ePhone && (vPhone.includes(ePhone) || ePhone.includes(vPhone))) reasons.push('teléfono: ' + e.telefono);
    }
    // Name match (fuzzy: normalized, partial, reversed)
    if (e.nombre && vCliente) {
      const eNombre = norm(e.nombre);
      if (eNombre && vCliente) {
        // Exact normalized match
        if (vCliente === eNombre) { reasons.push('nombre: ' + e.nombre); }
        // One contains the other
        else if (vCliente.includes(eNombre) || eNombre.includes(vCliente)) { reasons.push('nombre: ' + e.nombre); }
        // Check each word of the name against each word of the entry
        else {
          const vWords = vCliente.split(/\s+/).filter(w=>w.length>2);
          const eWords = eNombre.split(/\s+/).filter(w=>w.length>2);
          let wordMatch = false;
          for(const vw of vWords){ for(const ew of eWords){ if(vw.includes(ew)||ew.includes(vw)){wordMatch=true;break;} } if(wordMatch)break; }
          if(wordMatch && vWords.length>=2 && eWords.length>=2) reasons.push('nombre similar: ' + e.nombre);
        }
      }
    }
    // Address match (fuzzy: normalized, partial)
    if (e.direccion && vDireccion) {
      const eDir = norm(e.direccion);
      if (eDir && vDireccion) {
        if (vDireccion.includes(eDir) || eDir.includes(vDireccion)) { reasons.push('dirección: ' + e.direccion); }
        else {
          const vWords = vDireccion.split(/\s+/).filter(w=>w.length>3);
          const eWords = eDir.split(/\s+/).filter(w=>w.length>3);
          let matchCount = 0;
          for(const vw of vWords){ for(const ew of eWords){ if(vw===ew||vw.includes(ew)||ew.includes(vw)){matchCount++;break;} } }
          if(matchCount >= Math.min(2, eWords.length)) reasons.push('dirección similar: ' + e.direccion);
        }
      }
    }
    // Carnet match (exact or partial)
    if (e.carnet && vCarnet) {
      const eCarnet = norm(e.carnet);
      if (eCarnet && (vCarnet.includes(eCarnet) || eCarnet.includes(vCarnet))) reasons.push('carnet: ' + e.carnet);
    }
    if (reasons.length) matches.push({ entry: e, reasons: reasons });
  });
  return matches;
}

function showEstafaAlert(vale, matches) {
  if (!matches.length) return;
  // Build detail with links to estafa entries
  let detail = matches.map(m => {
    const r = m.reasons.join(', ');
    let s = '⚠️ Coincidencia por ' + r;
    if (m.entry.nota) s += '\n   Nota: ' + m.entry.nota;
    if (m.entry.carnet) s += '\n   Carnet: ' + m.entry.carnet;
    return s;
  }).join('\n');
  // Build estafa entries HTML
  let entriesHtml = matches.map(m => {
    const e = m.entry;
    return `<div style="background:var(--surface2);border:1px solid var(--red);border-radius:10px;padding:12px;margin-bottom:8px;cursor:pointer;" onclick="document.querySelectorAll('.modal-bg[style]').forEach(el=>el.remove());adminTab('estafa');">
      <div style="font-size:13px;font-weight:800;color:var(--red);margin-bottom:4px;">🚫 ${escapeHTML(e.nombre || 'Sin nombre')}</div>
      <div style="font-size:11px;color:var(--text);display:flex;flex-wrap:wrap;gap:8px;">
        ${e.telefono?'<span>📱 '+escapeHTML(e.telefono)+'</span>':''}
        ${e.carnet?'<span>🪪 '+escapeHTML(e.carnet)+'</span>':''}
        ${e.direccion?'<span>📍 '+escapeHTML(e.direccion)+'</span>':''}
      </div>
      ${e.nota?'<div style="font-size:11px;color:var(--red);margin-top:4px;font-weight:600;">⚡ '+escapeHTML(e.nota)+'</div>':''}
      <div style="font-size:10px;color:var(--blue);margin-top:6px;font-weight:700;">👆 Toca para ir al panel de estafa</div>
    </div>`;
  }).join('');
  const overlay = document.createElement('div');
  overlay.className = 'modal-bg show';
  overlay.style.zIndex = '10001';
  const box = document.createElement('div');
  box.className = 'modal';
  box.style.cssText = 'max-width:440px;text-align:center;';
  box.innerHTML = `
    <div style="font-size:48px;margin-bottom:12px;">🚨</div>
    <div class="modal-title" style="color:var(--red);margin-bottom:8px;">¡ALERTA DE POSIBLE ESTAFA!</div>
    <div style="font-size:12px;color:var(--gray-400);margin-bottom:12px;">El vale de <b style="color:var(--text);">${escapeHTML(vale.cliente || '—')}</b> coincide con datos en la lista negra</div>
    <div style="text-align:left;max-height:250px;overflow-y:auto;margin-bottom:16px;">${entriesHtml}</div>
    <div style="font-size:11px;color:var(--gray-400);margin-bottom:12px;">Revisa los datos antes de continuar</div>
    <div class="modal-btns" style="flex-direction:column;">
      <button class="btn btn-red btn-full" onclick="this.closest('.modal-bg').remove()" style="font-weight:700;">⚠️ Entendido — Tener precaución</button>
      <button class="btn btn-ghost btn-full" onclick="this.closest('.modal-bg').remove();adminTab('estafa');" style="font-size:12px;">🚫 Ir al panel de estafa</button>
    </div>`;
  overlay.appendChild(box);
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
}

function addEstafa() {
  const tel = document.getElementById('estafaTelefono').value.trim();
  const nom = document.getElementById('estafaNombre').value.trim();
  const car = document.getElementById('estafaCarnet').value.trim();
  const dir = document.getElementById('estafaDireccion').value.trim();
  const nota = document.getElementById('estafaNota').value.trim();
  if (!tel && !nom && !dir && !car) { showToast('Agrega al menos un dato (teléfono, nombre, carnet o dirección)'); return; }
  const lista = getEstafa();
  const id = Date.now();
  lista.push({ id, telefono: tel, nombre: nom, carnet: car, direccion: dir, nota: nota, fecha: new Date().toISOString() });
  saveEstafa(lista);
  document.getElementById('estafaTelefono').value = '';
  document.getElementById('estafaNombre').value = '';
  document.getElementById('estafaCarnet').value = '';
  document.getElementById('estafaDireccion').value = '';
  document.getElementById('estafaNota').value = '';
  renderEstafaList();
  showToast('Registro de estafa agregado 🚫');
}

function deleteEstafa(id) {
  showConfirmAction('¿Borrar registro?', 'Se eliminará este registro de la lista de estafa.', 'Borrar', 'btn-red', () => {
    const lista = getEstafa().filter(e => e.id !== id);
    saveEstafa(lista);
    renderEstafaList();
    showToast('Registro eliminado');
  });
}

function renderEstafaList() {
  const c = document.getElementById('estafaList');
  if (!c) return;
  const searchEl = document.getElementById('estafaSearch');
  const search = searchEl ? searchEl.value.trim().toLowerCase() : '';
  let lista = getEstafa();
  if (search) {
    lista = lista.filter(e =>
      (e.telefono || '').toLowerCase().includes(search) ||
      (e.nombre || '').toLowerCase().includes(search) ||
      (e.carnet || '').toLowerCase().includes(search) ||
      (e.direccion || '').toLowerCase().includes(search) ||
      (e.nota || '').toLowerCase().includes(search)
    );
  }
  const countEl = document.getElementById('estafaCount');
  if (countEl) countEl.textContent = getEstafa().length;
  if (!lista.length) {
    c.innerHTML = '<div class="es"><div class="es-icon">🚫</div><div class="es-text">' + (search ? 'Sin resultados' : 'No hay registros de estafa') + '</div></div>';
    return;
  }
  let html = '';
  lista.forEach(e => {
    const fecha = e.fecha ? new Date(e.fecha).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
    html += `<div class="card" style="padding:10px 14px;margin-bottom:6px;display:flex;align-items:center;gap:12px;">
      <div style="font-size:20px;flex-shrink:0;">🚫</div>
      <div style="flex:1;min-width:0;">
        <div style="font-size:13px;font-weight:700;">${e.nombre ? escapeHTML(e.nombre) : '<span style="color:var(--gray-400);">Sin nombre</span>'}</div>
        <div style="font-size:11px;color:var(--gray-400);display:flex;flex-wrap:wrap;gap:6px;margin-top:2px;">
          ${e.telefono ? '<span>📱 ' + escapeHTML(e.telefono) + '</span>' : ''}
          ${e.carnet ? '<span>🪪 ' + escapeHTML(e.carnet) + '</span>' : ''}
          ${e.direccion ? '<span>📍 ' + escapeHTML(e.direccion) + '</span>' : ''}
        </div>
        ${e.nota ? '<div style="font-size:11px;color:var(--red);margin-top:3px;font-weight:600;">⚡ ' + escapeHTML(e.nota) + '</div>' : ''}
        ${fecha ? '<div style="font-size:9px;color:var(--gray-300);margin-top:2px;">' + fecha + '</div>' : ''}
      </div>
      <button class="btn btn-ghost btn-sm" onclick="deleteEstafa(${e.id})" style="flex-shrink:0;font-size:11px;padding:5px 8px;color:var(--red);">✕</button>
    </div>`;
  });
  c.innerHTML = html;
}

// Helper: convert vales array to Firebase nested object
function _valesToFirebaseObj(vales) {
  const obj = {};
  vales.forEach(v => {
    if (!obj[v.gestorId]) obj[v.gestorId] = {};
    obj[v.gestorId][v.id] = v;
  });
  return obj;
}

let gestorValesListener = null;
let firstLoadVales = true;
function listenToMyVales(gId) {
  if (gestorValesListener) db.ref(`vales/${activeGestorId}`).off('value', gestorValesListener);
  firstLoadVales = true;
  gestorValesListener = db.ref(`vales/${gId}`).on('value', snap => {
    _syncCount++;
    try {
      const val = snap.val();
      if (val) {
        const newVales = Object.values(val);
        newVales.sort((a,b) => new Date(b.ts) - new Date(a.ts));
        
        if (!firstLoadVales) {
          const oldVales = getVales();
          newVales.forEach(nv => {
            const ov = oldVales.find(x => x.id === nv.id);
            if (ov && ov.status !== nv.status) {
              const prodNames = (nv.valeProductos||[]).map(p => p.qty > 1 ? `${p.qty}x ${escapeHTML(p.name)}` : escapeHTML(p.name)).join(', ');
              
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
        try { localStorage.setItem('axon_vales', JSON.stringify(newVales)); _valesCache = newVales; _valesDirty = false; } catch(e) {}
      } else {
        // Firebase has no vales — clear local too
        try { localStorage.setItem('axon_vales', '[]'); _valesCache = []; _valesDirty = false; } catch(e) {}
        rankingCache = null;
        try { localStorage.removeItem('axon_ranking_summary'); } catch(e) {}
      }
      firstLoadVales = false;
    } finally {
      _syncCount--;
      refreshUI();
    }
  });
}

// Custom Firebase Vale individual operations — now using the write queue
function fbAddVale(v) { _enqueueFB(`vales/${v.gestorId}/${v.id}`, v, 'set'); }
function fbUpdateVale(v, changes) { _enqueueFB(`vales/${v.gestorId}/${v.id}`, changes, 'update'); }
function fbRemoveVale(v) { _enqueueFB(`vales/${v.gestorId}/${v.id}`, null, 'remove'); }

function refreshUI() {
  if(IS_ADMIN) {
    if(typeof renderAdminGestoresList === 'function') renderAdminGestoresList();
    if(typeof renderAdminGestores === 'function') renderAdminGestores();
    if(typeof renderInbox === 'function') renderInbox();
    if(typeof renderMensajeros === 'function') renderMensajeros();
    if(typeof renderProductGrid === 'function') renderProductGrid();
    if(typeof renderStockCategorias === 'function') renderStockCategorias();
    if(typeof renderConfirmados === 'function') renderConfirmados();
    if(typeof renderPendienteCobro === 'function') renderPendienteCobro();
    if(typeof renderPendingCobroSection === 'function') renderPendingCobroSection();
    if(typeof renderMensajeroVales === 'function') renderMensajeroVales();
    if(typeof renderMensajeroSelector === 'function') renderMensajeroSelector();
    if(typeof renderComisiones === 'function' && typeof currentAdminTab !== 'undefined' && currentAdminTab === 'gestores') renderComisiones();
    if(typeof renderAdminCatalog === 'function' && typeof currentAdminTab !== 'undefined' && currentAdminTab === 'catalog'){renderAdminCatalogCats();renderAdminCatalog();}
    if(typeof updateAdminBadge === 'function') updateAdminBadge();
    if(typeof updateMensajeroBadge === 'function') updateMensajeroBadge();
    if(typeof renderValeDetail === 'function' && typeof selectedValeId !== 'undefined' && selectedValeId) renderValeDetail();
  } else {
    if(typeof renderGestores === 'function') renderGestores();
    if(typeof renderGestorNotifs === 'function') renderGestorNotifs();
    if(typeof renderMyVales === 'function') renderMyVales();
    if(typeof renderGestorRanking === 'function') {rankingCache=null;renderGestorRanking();}
    if(typeof renderGestorCatalog === 'function') {
       if(document.getElementById('gestorCatalogModal')?.classList.contains('show')) {
           renderGestorCatalog();
       }
    }
  }
}



// Base Listeners (Everything except vales) — with try/finally to prevent isSyncingFromFirebase from sticking
['gestores', 'mensajeros', 'productos', 'categorias', 'config', 'notifs', 'estafa'].forEach(node => {
  db.ref(node).on('value', snap => {
    _syncCount++;
    try {
      const val = snap.val();
      
      // Only update local storage IF Firebase actually has data.
      if (val) {
        let parsedVal = val;
        if (node !== 'config' && typeof val === 'object' && !Array.isArray(val)) {
          parsedVal = Object.values(val);
        }
        try { localStorage.setItem('axon_'+node, JSON.stringify(parsedVal)); } catch(e) {}
        // Update in-memory cache
        if(node==='gestores'){_gestoresCache=parsedVal;_gestoresDirty=false;}
        else if(node==='mensajeros'){_mensajerosCache=parsedVal;_mensajerosDirty=false;}
        else if(node==='productos'){_productosCache=parsedVal;_productosDirty=false;}
        else if(node==='categorias'){_categoriasCache=parsedVal;_categoriasDirty=false;}
        else if(node==='config'){_configCache=parsedVal;_configDirty=false;}
        else if(node==='notifs'){_notifsCache=parsedVal;_notifsDirty=false;}
        else if(node==='estafa'){_estafaCache=parsedVal;_estafaDirty=false;}
      } else {
        const local = localStorage.getItem('axon_'+node);
        if (!local || local === '[]' || local === '{}') {
          try { localStorage.setItem('axon_'+node, node==='config'?'{}':'[]'); } catch(e) {}
        }
      }
    } finally {
      _syncCount--;
      refreshUI();
    }
  });
});

// Vales Listeners
if (IS_ADMIN) {
  // Admin listens to ALL vales from all gestores — with try/finally
  let _rankingDebounce = null;
  db.ref('vales').on('value', snap => {
    _syncCount++;
    try {
      const val = snap.val();
      
      if (val) {
        let flatVales = [];
        Object.values(val).forEach(gVales => {
          if(gVales) flatVales.push(...Object.values(gVales));
        });
        flatVales.sort((a,b) => new Date(b.ts) - new Date(a.ts));
        // Check for new vales with estafa matches before saving
        const oldVales = getVales();
        const newIds = flatVales.filter(nv => nv.isNew && !oldVales.find(ov => ov.id === nv.id));
        try { localStorage.setItem('axon_vales', JSON.stringify(flatVales)); _valesCache = flatVales; _valesDirty = false; } catch(e) {}
        // Show estafa alert for new vales that match blacklist
        newIds.forEach(nv => {
          const estafaMatches = checkEstafaMatch(nv);
          if(estafaMatches.length) setTimeout(() => showEstafaAlert(nv, estafaMatches), 300);
        });
        
        // Debounced ranking summary update
        clearTimeout(_rankingDebounce);
        _rankingDebounce = setTimeout(() => {
          const gestores = getGestores();
          const summary = gestores.map(g => {
            const pts = flatVales.filter(v=>v.gestorId===g.id&&['confirmed','pending_payment'].includes(v.status))
              .reduce((sum,v)=>sum+(v.valeProductos||[]).reduce((s,p)=>{const pr=productoOf(p.id);return s+(pr?pr.puntos*p.qty:0);},0),0);
            return { id: g.id, pts };
          });
          _enqueueFB('ranking_summary', summary, 'set');
        }, 500);
      } else {
        // Firebase has no vales — clear everything
        try { localStorage.setItem('axon_vales', '[]'); _valesCache = []; _valesDirty = false; } catch(e) {}
        rankingCache = null;
        try { localStorage.removeItem('axon_ranking_summary'); } catch(e) {}
        _enqueueFB('ranking_summary', null, 'remove');
      }
    } finally {
      _syncCount--;
      refreshUI();
    }
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




function patchVale(id, changes) {
  const all = getVales(); const i = all.findIndex(v=>v.id===id);
  if (i!==-1){
    all[i]={...all[i],...changes};
    // saveVales already writes to Firebase via _enqueueFB — no need for redundant fbUpdateVale
    // Previously, both saveVales (full 'set') and fbUpdateVale (partial 'update') were called,
    // causing race conditions where Firebase could overwrite local changes with stale data.
    saveVales(all);
  }
}
function getNextValeNum() {
  const cfg = getConfig();
  const n = (cfg.nextValeNum || 1);
  // Increment only when called — caller is responsible for ensuring vale is created
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
  // Also clear personal notifs for current gestor
  if(activeGestorId) {
    localStorage.setItem('axon_cleared_personal_' + activeGestorId, '1');
  }
  renderGestorNotifs();
  closeNotifsModal();
}
function clearSingleNotif(notifId) {
  const notifs = getNotifs();
  const idx = notifs.findIndex(n => n.id === notifId);
  if(idx !== -1) {
    notifs.splice(idx, 1);
    saveNotifs(notifs);
  }
  renderGestorNotifs();
}
function clearPersonalNotifs(gestorId) {
  if(!gestorId) return;
  localStorage.setItem('axon_cleared_personal_' + gestorId, '1');
  renderGestorNotifs();
  showToast('Alertas personales limpiadas ✓');
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
  const globalNotifs = visibleNotifs.filter(n => !['vale_confirmed', 'vale_assigned', 'ranking_top3'].includes(n.type));
  
  // Personal Notifs — check if cleared for this gestor
  const personalCleared = activeGestorId ? localStorage.getItem('axon_cleared_personal_' + activeGestorId) : null;
  const personalNotifs = notifs.filter(n => {
    return ['vale_confirmed', 'vale_assigned', 'ranking_top3'].includes(n.type) && activeGestorId && n.gestorId === activeGestorId;
  });

  const sec = document.getElementById('gestorNotifsSection');
  const personalSec = document.getElementById('gestorPersonalNotifsSection');
  
  const icons = {new_product:'✨',out_of_stock:'❌',low_stock:'⚠️',restocked:'✅',vale_confirmed:'🎉',sale_product:'🛒',vale_assigned:'🛵',ranking_top3:'🏆'};
  
  const renderItem = (n, isPersonal) => {
    const icon=icons[n.type]||'📢';
    const age=timeAgo(n.ts);
    const typeClass=n.type==='out_of_stock'?'agotado':n.type==='low_stock'?'low':n.type==='restocked'?'restocked':['vale_confirmed','sale_product','vale_assigned','ranking_top3'].includes(n.type)?'ok':'';
    
    // Unread logic
    const nIdx = notifs.findIndex(x => x.id === n.id);
    const isUnread = !isPersonal && (viewedIdx === -1 || nIdx < viewedIdx);
    const cls=isUnread?'unread':`type-${typeClass}`;
    
    // Escape all user-provided data to prevent XSS
    const safeName = escapeHTML(n.productName);
    const safeExtra = escapeHTML(n.extra||'');
    let msg='';
    if(n.type==='sale_product'){
      const parts=(n.extra||'').split('|');
      const qty=parseInt(parts[0])||1;
      const left=parseInt(parts[1]);
      msg=`<b>Se vendió${qty>1?` <span style="color:var(--blue);font-weight:800;">${qty}</span>`:``}</b> ${safeName}${!isNaN(left)?` — quedan <b style="color:${left===0?'var(--red)':left<=LOW_STOCK_THRESHOLD?'var(--yellow)':'var(--green)'};">${left}</b>`:``}`;
    } else if(n.type==='vale_assigned'){
      msg=`🛵 Tu venta está con el mensajero`;
    } else if(n.type==='vale_confirmed'){
      msg=`<b>¡Venta completada! ✅</b> · ${safeName}${safeExtra?` <span style="color:var(--gray-400);font-size:10px;">(${safeExtra})</span>`:``}`;
    } else if(n.type==='out_of_stock'){
      msg=`<b>Agotado:</b> ${safeName}`;
    } else if(n.type==='low_stock'){
      msg=`<b>Stock bajo:</b> ${safeName} <span style="color:var(--yellow);">(${safeExtra})</span>`;
    } else if(n.type==='restocked'){
      msg=`<b>Repuesto:</b> ${safeName} <span style="color:var(--green);">(${safeExtra})</span>`;
    } else if(n.type==='new_product'){
      msg=`<b>Nuevo producto:</b> ${safeName}${safeExtra?` · ${safeExtra}`:``}`;
    } else if(n.type==='ranking_top3'){
      const parts=(n.extra||'').split('|');
      const place=parts[0]||'';const pts=parts[1]||'';
      const placeNum=parseInt(parts[2])||0;
      const placeEmoji=placeNum===1?'🥇':placeNum===2?'🥈':placeNum===3?'🥉':'🏆';
      msg=`<b>${placeEmoji} ${place}</b> · ${escapeHTML(n.productName)} con <b>${pts} pts</b>`;
    } else {
      msg=`${safeName}${safeExtra?` (${safeExtra})`:``}`;
    }
    return `<div class="gnotif-item ${cls}" style="position:relative;">
      <button onclick="clearSingleNotif(${n.id})" title="Eliminar esta alerta" style="position:absolute;top:4px;right:4px;background:none;border:none;color:var(--gray-400);font-size:14px;cursor:pointer;padding:2px 4px;line-height:1;opacity:.6;" onmouseenter="this.style.opacity='1'" onmouseleave="this.style.opacity='.6'">×</button>
      <div class="gnotif-icon">${icon}</div>
      <div class="gnotif-text">${msg}</div>
      <div class="gnotif-time">${age}</div>
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
    } else if(personalCleared) {
      personalSec.style.display='none';
    } else {
      personalSec.style.display='block';
      document.getElementById('gestorPersonalNotifsList').innerHTML = 
        `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
          <span style="font-size:11px;color:var(--gray-400);">${personalNotifs.length} alerta${personalNotifs.length!==1?'s':''}</span>
          <button onclick="clearPersonalNotifs(${activeGestorId})" style="font-size:10px;padding:2px 8px;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.15);border-radius:4px;color:var(--gray-400);cursor:pointer;">Limpiar todas</button>
        </div>` +
        personalNotifs.map(n => renderItem(n, true)).join('');
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
  const cph = document.getElementById('catalogPhoneInput'); if (cph && cfg.catalogPhone) cph.value = cfg.catalogPhone;
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
  ['vales','stock','gestores','stats','mensajeros','config','historial','catalog','estafa'].forEach(t=>{
    const btn=document.getElementById('anav-'+t);if(btn)btn.classList.toggle('active',t===tab);
    const pid='admin'+t.charAt(0).toUpperCase()+t.slice(1)+'Panel';
    const el=document.getElementById(pid);
    if(el){el.style.display=t===tab?(t==='vales'?'grid':'block'):'none';}
  });
  if(tab==='vales'){renderAdminGestores();renderMensajeros();renderConfirmados();renderPendienteCobro();}
  if(tab==='stock'){renderStockCategorias();renderProductGrid();}
  if(tab==='catalog'){renderAdminCatalogCats();renderAdminCatalog();}
  if(tab==='gestores'&&gestoresTabDirty){renderAdminGestoresList();renderComisiones();gestoresTabDirty=false;}
  if(tab==='stats'&&statsTabDirty){renderStats();statsTabDirty=false;}
  if(tab==='mensajeros'){renderMensajeroSelector();renderPendingCobroSection();renderMensajeroVales();}
  if(tab==='config'){loadGhConfigUI();}
  if(tab==='historial'){renderHistorial();}
  if(tab==='estafa'){renderEstafaList();}
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
  // Use async verification for proper SHA-256 checking
  verifyPassAsync(val).then(ok => {
    if(ok){
      adminActive=true;closePassModal();
      const al=document.getElementById('adminLabel'); if(al) al.style.display='flex';
      const bl=document.getElementById('btnLogout'); if(bl) bl.style.display='inline-flex';
      playSound('login');requestNotifPermission();
      activateAdminMode();showToast('Bienvenido, Admin ✓');
    } else {
      document.getElementById('passError').style.display='block';
      document.getElementById('passInput').select();
    }
  });
}


// ══════════════════════════════════════════
//  AUTH & SOUND
// ══════════════════════════════════════════
function checkPass(input) {
  const stored = localStorage.getItem('axon_admin_hash');
  // Legacy support: if stored value looks like btoa, migrate it
  if (stored && !stored.startsWith('sha256:')) {
    // Old btoa format — check directly for backward compatibility
    if (btoa(input) === stored) {
      // Migrate to SHA-256 on next login
      _hashPass(input).then(h => localStorage.setItem('axon_admin_hash', h));
      localStorage.removeItem('axon_admin_hash_legacy');
      return true;
    }
    return false;
  }
  // SHA-256 hash — verify properly using async check
  const storedHash = stored || btoa('axon2024');
  if (storedHash.startsWith('sha256:')) {
    // We need to verify async but checkPass is sync. Use the pre-computed verification.
    // The _verifyPassAsync function handles this properly.
    const legacyHash = localStorage.getItem('axon_admin_hash_legacy');
    if (legacyHash && btoa(input) === legacyHash) {
      // Migrate: verify SHA-256 asynchronously and update
      _hashPass(input).then(h => { localStorage.setItem('axon_admin_hash', h); localStorage.removeItem('axon_admin_hash_legacy'); });
      return true;
    }
    // Synchronous fallback — compute hash comparison via stored session token
    const sessionHash = sessionStorage.getItem('axon_admin_session');
    if (sessionHash) {
      return sessionHash === storedHash;
    }
    // Last resort: do a synchronous hash check (less secure but functional)
    return false;
  }
  return btoa(input) === storedHash;
}
// Async password verification — use this for login forms
async function verifyPassAsync(input) {
  const stored = localStorage.getItem('axon_admin_hash');
  if (!stored) {
    // Default password
    const defaultHash = await _hashPass('axon2024');
    if (input === 'axon2024') {
      localStorage.setItem('axon_admin_hash', defaultHash);
      return true;
    }
    return false;
  }
  if (stored.startsWith('sha256:')) {
    const inputHash = await _hashPass(input);
    if (inputHash === stored) {
      sessionStorage.setItem('axon_admin_session', stored);
      return true;
    }
    return false;
  }
  // Legacy btoa migration
  if (btoa(input) === stored) {
    const h = await _hashPass(input);
    localStorage.setItem('axon_admin_hash', h);
    localStorage.removeItem('axon_admin_hash_legacy');
    sessionStorage.setItem('axon_admin_session', h);
    return true;
  }
  return false;
}
async function _hashPass(input) {
  const encoder = new TextEncoder();
  const data = encoder.encode(input + '_axontech_salt_2024');
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return 'sha256:' + hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}
function changePass() {
  const np = document.getElementById('newPassInput').value.trim();
  if (!np||np.length<4){showToast('Mínimo 4 caracteres');return;}
  _hashPass(np).then(h => {
    localStorage.setItem('axon_admin_hash', h);
    localStorage.setItem('axon_admin_hash_legacy', btoa(np));
    document.getElementById('newPassInput').value='';
    showToast('Contraseña actualizada ✓');
  });
}
// Shared AudioContext to prevent memory leak from creating new contexts
let _sharedAC = null;
function playSound(type) {
  try {
    if (!_sharedAC) _sharedAC = new (window.AudioContext||window.webkitAudioContext)();
    const ac = _sharedAC;
    if (ac.state === 'suspended') ac.resume();
    const g=ac.createGain();g.connect(ac.destination);
    g.gain.setValueAtTime(0.08,ac.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001,ac.currentTime+0.8);
    const tones={login:[[880,0],[1100,.15]],vale:[[660,0],[800,.18]],confirm:[[440,0],[660,.15],[880,.3]]};
    (tones[type]||tones.login).forEach(t=>{const o=ac.createOscillator();o.type='sine';o.frequency.value=t[0];o.connect(g);o.start(ac.currentTime+t[1]);o.stop(ac.currentTime+t[1]+0.2);});
  } catch(e){}
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
  document.getElementById('bannerName').innerHTML = escapeHTML(g.name) + (nBtn ? '<br>'+nBtn : '');
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
  if (gestorValesListener && activeGestorId) {
    db.ref(`vales/${activeGestorId}`).off('value', gestorValesListener);
    gestorValesListener = null;
  }
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
      <span style="font-size:13px;font-weight:700;">${escapeHTML(m.name)}</span>
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
    return `<div class="m-card ${act?'active':''}" onclick="selectMensajero(${m.id})">
      <div style="font-size:14px;font-weight:700;margin-bottom:2px;">${escapeHTML(m.name)} ${act?'<span style="color:var(--blue);">✓</span>':''}</div>
      <div style="font-size:11px;color:var(--gray-500);">${assigned} entregas</div>
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
  const pendientesCobro=getVales().filter(v=>v.mensajeroId===activeMensajeroId&&v.status==='pending_payment').reverse();
  const confirmados=getVales().filter(v=>v.mensajeroId===activeMensajeroId&&v.status==='confirmed').reverse();
  let html='';
  if(!porEntregar.length&&!entregados.length&&!pendientesCobro.length&&!confirmados.length){
    html='<div class="es"><div class="es-icon">✅</div><div class="es-text">Sin entregas asignadas</div></div>';
  } else {
    if(porEntregar.length){
      html+='<div class="lbl" style="margin-top:0;">Por entregar</div>';
      html+=porEntregar.map(v=>{
        const g=gestorOf(v.gestorId);
        return `<div class="mv-card st-assigned">
          <div class="mv-head"><span class="mv-time">${timeStr(v.ts)}</span><span class="sp-assigned" style="font-size:9px;padding:2px 6px;">🛵 Asignado</span></div>
          <div class="mv-info"><b>${escapeHTML(v.cliente||'—')}</b> · ${escapeHTML(v.telefono||'—')}</div>
          <div style="font-size:11px;color:var(--gray-400);">📍 ${escapeHTML(v.direccion||'Sin dirección')}</div>
          <div style="font-size:12px;font-weight:700;margin-top:3px;">💰 ${escapeHTML(v.total||'—')}${v.vuelto?` · Vuelto: ${escapeHTML(v.vuelto)}`:''}</div>
          ${g?`<div style="font-size:11px;color:var(--gray-400);">Gestor: ${escapeHTML(g.name)}</div>`:''}
          <div style="font-size:11px;color:var(--gray-600);margin-top:3px;">📦 ${escapeHTML(v.articulo||'—')}</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-top:8px;">
            <button class="btn btn-green btn-sm btn-full" onclick="mensajeroEntrega(${v.id})">📦 Entregado</button>
            <button class="btn btn-green btn-sm btn-full" style="background:#2563EB;color:white;" onclick="mensajeroPagadoDirecto(${v.id})">💰 Pagado</button>
          </div>
        </div>`;
      }).join('');
    }
    if(entregados.length){
      html+='<div class="lbl" style="margin-top:16px;">Entregados · esperando cobro</div>';
      html+=entregados.map(v=>{
        const g=gestorOf(v.gestorId);
        return `<div class="mv-card st-delivered">
          <div class="mv-head"><span class="mv-time">${timeStr(v.deliveredTs||v.ts)}</span><span class="sp-delivered" style="font-size:9px;padding:2px 6px;">📦 Entregado</span></div>
          <div class="mv-info"><b>${escapeHTML(v.cliente||'—')}</b> · ${escapeHTML(v.total||'—')}</div>
          ${g?`<div style="font-size:11px;color:var(--gray-400);">Gestor: ${escapeHTML(g.name)}</div>`:''}
          <button class="btn btn-green btn-sm btn-full" style="margin-top:8px;" onclick="mensajeroPagado(${v.id})">💰 Marcar como Pagado</button>
        </div>`;
      }).join('');
    }
    if(pendientesCobro.length){
      html+='<div class="lbl" style="margin-top:16px;">Pendientes de cobro</div>';
      html+=pendientesCobro.map(v=>{
        const g=gestorOf(v.gestorId);
        return `<div class="mv-card st-pending_payment">
          <div class="mv-head"><span class="mv-time">${timeStr(v.ts)}</span><span style="color:var(--orange);font-size:10px;font-weight:700;">⏳ Pend. cobro</span></div>
          <div class="mv-info"><b>${escapeHTML(v.cliente||'—')}</b> · ${escapeHTML(v.total||'—')}</div>
          ${g?`<div style="font-size:11px;color:var(--gray-400);">Gestor: ${escapeHTML(g.name)}</div>`:''}
          <div style="font-size:11px;color:var(--gray-600);margin-top:3px;">📦 ${escapeHTML(v.articulo||'—')}</div>
          <button class="btn btn-green btn-sm btn-full" style="margin-top:8px;" onclick="mensajeroPagado(${v.id})">💰 Marcar como Pagado</button>
        </div>`;
      }).join('');
    }
    if(confirmados.length){
      html+='<div class="lbl" style="margin-top:16px;">Cobrados / Completados</div>';
      html+=confirmados.map(v=>{
        const g=gestorOf(v.gestorId);
        return `<div class="mv-card st-confirmed">
          <div class="mv-head"><span class="mv-time">${timeStr(v.confirmedTs||v.ts)}</span><span style="color:var(--green);font-size:10px;font-weight:700;">✅ Pagado</span></div>
          <div class="mv-info"><b>${escapeHTML(v.cliente||'—')}</b> · ${escapeHTML(v.total||'—')}</div>
          ${g?`<div style="font-size:11px;color:var(--gray-400);">Gestor: ${escapeHTML(g.name)}</div>`:''}
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
  const arr = new Uint8Array(8);
  crypto.getRandomValues(arr);
  return Array.from(arr, x => chars[x % chars.length]).join('').slice(0, 8);
}

let gestorManagerExpanded = false;
function toggleGestorManager() {
  gestorManagerExpanded = !gestorManagerExpanded;
  const sec = document.getElementById('gestorManagerSection');
  if(sec) sec.style.display = gestorManagerExpanded ? 'block' : 'none';
  if(gestorManagerExpanded) renderAdminGestoresList();
}

function renderAdminGestoresList() {
  const list=getGestores();
  const c=document.getElementById('adminGestoresPanel-list');
  if(!c) return;
  if(!list.length){c.innerHTML='<div class="es"><div class="es-icon">👥</div><div class="es-text">Sin gestores. Agrega uno arriba.</div></div>';return;}
  c.innerHTML=list.map(g=>{
    const vales=getVales().filter(v=>v.gestorId===g.id);
    const today=vales.filter(v=>new Date(v.ts).toDateString()===todayStr()).length;
    const pts=vales.filter(v=>['confirmed','pending_payment'].includes(v.status))
      .reduce((s,v)=>s+(v.valeProductos||[]).reduce((ss,p)=>{const pr=productoOf(p.id);return ss+(pr?pr.puntos*p.qty:0);},0),0);
    return `<div class="gp-card">
      <div class="g-avatar" style="background:${g.color};width:40px;height:40px;font-size:13px;flex-shrink:0;">${escapeHTML(g.initials)}</div>
      <div style="flex:1;min-width:140px;">
        <div style="font-weight:700;font-size:14px;color:var(--text);">${escapeHTML(g.name)}</div>
        <div style="font-size:11px;color:var(--text-muted);margin-top:1px;">${vales.length} vales · ${today} hoy · ⭐ ${pts} pts</div>
        <div style="display:flex;align-items:center;flex-wrap:wrap;gap:6px;margin-top:6px;">
          <span id="gpw-${g.id}" style="background:var(--gray-200);border-radius:6px;padding:3px 9px;font-family:monospace;font-weight:700;font-size:12px;letter-spacing:1.5px;color:var(--text);cursor:pointer;" onclick="toggleGestorPass(${g.id},'${escapeHTML(g.password||'')}')" title="Click para mostrar/ocultar">🔑 ${escapeHTML(g.password||'—').replace(/./g, '•')}</span>
          <button type="button" style="background:none;border:1px solid var(--gray-400);cursor:pointer;font-size:10px;color:var(--gray-700);padding:2px 7px;border-radius:4px;font-weight:600;" onclick="copyGestorPass(${g.id},'${escapeHTML(g.password||'')}')">📋 Copiar</button>
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
  const ph=document.getElementById('editGestorPhoneInput');if(ph)ph.value=g.phone||'';
  document.getElementById('editGestorModal').dataset.gestorId=id;
  document.getElementById('editGestorModal').classList.add('show');
}
function closeEditGestorModal(){document.getElementById('editGestorModal').classList.remove('show');}
function saveEditGestor() {
  const id=parseInt(document.getElementById('editGestorModal').dataset.gestorId);
  const newName=document.getElementById('editGestorInput').value.trim();
  if(!newName){showToast('El nombre no puede estar vacío');return;}
  const list=getGestores();const i=list.findIndex(g=>g.id===id);if(i===-1)return;
  if(list.some(g=>g.id!==id&&g.name.toLowerCase()===newName.toLowerCase())){showToast('Ese nombre ya existe');return;}
  list[i].name=newName;
  list[i].initials=newName.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2);
  list[i].phone=(document.getElementById('editGestorPhoneInput')?.value||'').trim();
  saveGestores(list);
  closeEditGestorModal();
  gestoresTabDirty=true;rankingCache=null;
  renderAdminGestoresList();renderGestores();renderAdminGestores();renderGestorRanking();
  maybeAutoSync();
  showToast('Gestor editado ✓');
}

function resetGestorPass(id) {
  const list=getGestores();const i=list.findIndex(g=>g.id===id);if(i===-1)return;
  const np=genPassword().trim().toUpperCase();list[i].password=np;saveGestores(list);
  gestoresTabDirty=true;
  renderAdminGestoresList();maybeAutoSync();showToast(`Nueva clave: ${np}`);
}
function toggleGestorPass(id, pass) {
  const el=document.getElementById('gpw-'+id);if(!el)return;
  if(el.dataset.shown==='1'){
    el.textContent='🔑 '+pass.replace(/./g,'•');
    el.dataset.shown='0';
  } else {
    el.textContent='🔑 '+pass;
    el.dataset.shown='1';
  }
}
function copyGestorPass(id, pass) {
  navigator.clipboard.writeText(pass).then(()=>showToast('Contraseña copiada ✓')).catch(()=>showToast('No se pudo copiar'));
}

function removeGestor(id) {
  const g = gestorOf(id);
  if (!g) return;
  const hasVales = getVales().some(v=>v.gestorId===id);
  const sub = hasVales ? 'Tiene vales registrados. Si lo borras, quedarán huérfanos.' : 'El gestor será borrado del sistema.';
  showConfirmAction('¿Eliminar a ' + g.name + '?', sub, 'Eliminar', 'btn-red', () => {
    const newList = getGestores().filter(x=>x.id!==id);
    saveGestores(newList);
    // saveGestores already syncs to Firebase via setFB — no need for separate db.ref call
    gestoresTabDirty=true;rankingCache=null;
    renderAdminGestoresList();renderGestores();renderAdminGestores();
    if(typeof renderComisiones === 'function') renderComisiones();
    maybeAutoSync();
    showToast('Gestor eliminado ✓');
  });
}

function addGestor() {
  const inp=document.getElementById('newGestorInput');
  const name=inp.value.trim();if(!name)return;
  const phone=(document.getElementById('newGestorPhoneInput')?.value||'').trim();
  const initials=name.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2);
  const list=getGestores();
  if(list.some(g=>g.name.toLowerCase()===name.toLowerCase())){showToast('Ya existe ese gestor');return;}
  const color=GESTOR_COLORS[list.length%GESTOR_COLORS.length];
  const password=genPassword();
  list.push({id:Date.now(),name,initials,color,password,phone});
  saveGestores(list);inp.value='';
  const ph=document.getElementById('newGestorPhoneInput');if(ph)ph.value='';
  gestoresTabDirty=true;rankingCache=null;
  renderAdminGestoresList();renderGestores();renderAdminGestores();renderGestorRanking();
  maybeAutoSync();
  showToast(`Gestor agregado ✓ · Clave: ${password}`);
}
// ══════════════════════════════════════════
//  ADMIN GESTORES FILTER (inbox)
// ══════════════════════════════════════════
function renderAdminGestores() {
  const c = document.getElementById('adminGestoresList');
  if(!c) return;
  const gestores = getGestores();
  const vales = getVales();

  let html = '';
  
  // Only show gestores that have AT LEAST ONE pending vale
  const gestoresConPendientes = gestores.filter(g => {
     return vales.some(v => v.gestorId === g.id && v.status !== 'confirmed' && v.status !== 'delivered');
  });

  if(gestoresConPendientes.length === 0) {
     c.innerHTML = '<div class="es"><div class="es-icon">🎉</div><div class="es-text" style="font-weight:600;">No hay ningún vale pendiente.</div></div>';
     return;
  }

  gestoresConPendientes.forEach(g => {
    // Only fetch active (not confirmed/delivered)
    const pendingVales = vales.filter(v => v.gestorId === g.id && v.status !== 'confirmed' && v.status !== 'delivered').reverse();
    const isOpen = adminGestorFilter === g.id;

    html += `<div style="margin-bottom:8px;">
      <div style="display:flex;align-items:center;justify-content:space-between;background:var(--surface);border:1px solid ${isOpen?'var(--blue)':'var(--border)'};border-radius:10px;padding:12px 14px;cursor:pointer;font-weight:700;font-size:14px;transition:0.2s;" onclick="setGestorFilter(${isOpen ? 'null' : g.id})">
         <div style="display:flex;align-items:center;gap:12px;">
           <div class="ag-avatar" style="background:${g.color};width:32px;height:32px;font-size:12px;color:white;display:flex;align-items:center;justify-content:center;border-radius:50%;">${escapeHTML(g.initials)}</div>
           <span>${escapeHTML(g.name)}</span>
         </div>
         <div style="display:flex;align-items:center;gap:12px;">
           ${pendingVales.length > 0 ? `<span style="background:var(--red);color:white;border-radius:12px;padding:3px 9px;font-size:11px;">${pendingVales.length}</span>` : ''}
           <span style="color:var(--gray-400);font-size:12px;">${isOpen ? '▲' : '▼'}</span>
         </div>
      </div>`;

    if (isOpen) {
      html += `<div style="padding:10px 0 10px 14px; border-left:3px solid var(--blue); margin-left:16px; margin-bottom:16px;">`;
      html += pendingVales.map(v => buildInboxCard(v)).join('');
      html += `</div>`;
    }
    html += `</div>`;
  });

  c.innerHTML = html;
}

function setGestorFilter(gId){
  adminGestorFilter=gId;
  renderAdminGestores();
}

// ══════════════════════════════════════════
//  ADMIN INBOX
// ══════════════════════════════════════════
function buildInboxCard(v) {
  const sMap={
    pending:{label:'Pendiente',cls:'sp-pending'},
    assigned:{label:'Con mensajero',cls:'sp-assigned'},
    delivered:{label:'Entregado',cls:'sp-delivered'},
    pending_payment:{label:'Pend. cobro',cls:'sp-pending_payment'}
  };
  const s=sMap[v.status]||{label:v.status,cls:''};
  const isNew=v.isNew&&v.status==='pending';
  const sel=v.id===selectedValeId;
  const estafaMatch=checkEstafaMatch(v);
  const estafaBorder=estafaMatch.length?'border-left:3px solid var(--red);':'';
  const estafaTag=estafaMatch.length?'<span style="background:var(--red);color:white;border-radius:6px;padding:1px 6px;font-size:9px;font-weight:700;margin-left:4px;">🚫 ESTAFA</span>':'';
  return `<div class="ic ${sel?'sel':''} ${isNew?'is-new':''}" onclick="selectVale(${v.id})" style="${sel?'border: 1px solid var(--blue); background: var(--blue-lt);':'margin-bottom:6px;padding:10px;background:var(--surface);'}${estafaBorder}">
    ${isNew?'<div class="new-dot"></div>':''}
    <div class="ic-head" style="margin-bottom:4px;">
      <span class="ic-time">${timeStr(v.ts)}</span>
    </div>
    <div class="ic-cliente" style="font-size:13px;margin-bottom:2px;">${v.valeNum?`<span style="font-weight:800;color:var(--blue);">${valeNumStr(v)}</span> `:``}${escapeHTML(v.cliente||'Sin nombre')}${estafaTag}</div>
    <div class="ic-preview" style="font-size:11.5px;color:var(--gray-500);">${escapeHTML(v.articulo||'Sin artículo')}</div>
    ${v.adminNotes?`<div style="background:#FFFBEB;border-radius:4px;padding:2px 6px;font-size:10px;color:var(--gray-700);margin-bottom:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">📝 ${escapeHTML(v.adminNotes)}</div>`:``}
    <div class="ic-foot" style="margin-top:8px;">
      <span class="sp ${s.cls}" style="font-size:10px;">${s.label}</span>
      <span style="font-size:12px;color:var(--text);font-weight:800;">${escapeHTML(v.total||'')}</span>
    </div>
  </div>`;
}

function selectVale(id) {
  selectedValeId=id;patchVale(id,{isNew:false});
  updateAdminBadge();renderAdminGestores();renderValeDetail();
}

// ══════════════════════════════════════════
//  SHARE MODAL
// ══════════════════════════════════════════
function openShareModal(valeId) {
  const mensajeros=getMensajeros();
  if(!mensajeros.length){showToast('Agrega mensajeros primero');return;}
  shareTargetId=valeId;
  const v=getVales().find(x=>x.id===valeId);
  if(!v){showToast('Vale no encontrado');return;}
  const g=gestorOf(v.gestorId);
  document.getElementById('shareModalSub').textContent=`Vale de ${g?g.name:'—'} · ${v.cliente||'cliente'}`;
  const sel=document.getElementById('mensajeroSelect');
  sel.innerHTML=mensajeros.map(m=>`<option value="${m.id}">${escapeHTML(m.name)}</option>`).join('');
  if(v.mensajeroId)sel.value=v.mensajeroId;
  updateSharePreview();sel.onchange=updateSharePreview;
  document.getElementById('shareModal').classList.add('show');
}

function renderValeDetail() {
  const v=getVales().find(x=>x.id===selectedValeId);
  const c=document.getElementById('valeDetail');
  if(!c) return;
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
    actHTML=`<button class="btn btn-blue btn-full" onclick="openShareModal(${v.id})" style="margin-bottom:8px;">🛵 Asignar a Mensajero</button>
    <div style="font-size:10px;color:var(--gray-400);text-align:center;margin-bottom:6px;">— o confirmar directo —</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">
      <button class="btn btn-green btn-sm btn-full" onclick="confirmSale(${v.id},'confirmed')">✅ Cobrado directo</button>
      <button class="btn btn-sm btn-full" style="background:var(--orange);color:white;" onclick="confirmSale(${v.id},'pending_payment')">⏳ Entregado (Por cobrar)</button>
    </div>`;
  } else if(v.status==='assigned'){
    actHTML=`<div class="mensajero-row">🛵 <b>Mensajero:</b> ${m?escapeHTML(m.name):'—'}</div>
      <div style="font-size:12px;color:var(--gray-400);margin:6px 0 10px;">Esperando que el mensajero confirme la entrega</div>
      <button class="btn btn-ghost btn-full btn-sm" onclick="mensajeroEntrega(${v.id})" style="margin-bottom:6px;">📦 Marcar entregado (admin)</button>
      <button class="btn btn-ghost btn-full btn-sm" onclick="openShareModal(${v.id})">🔄 Reenviar vale</button>`;
  } else if(v.status==='delivered'){
    actHTML=`<div style="background:rgba(124,58,237,.08);border:1px solid rgba(124,58,237,.3);border-radius:8px;padding:12px;text-align:center;margin-bottom:10px;">
      <div style="font-size:24px;margin-bottom:4px;">🛵</div>
      <div style="font-weight:700;color:#7C3AED;">Entregado por mensajero</div>
      ${m?`<div style="font-size:12px;color:var(--gray-400);">Mensajero: ${escapeHTML(m.name)}</div>`:``}
    </div>
    <button class="btn btn-green btn-full" onclick="confirmSale(${v.id},'confirmed')" style="margin-bottom:8px;">✅ Confirmar venta + Entregado</button>
    <button class="btn btn-orange btn-full" onclick="confirmSale(${v.id},'pending_payment')">⏳ Confirmar venta + Pendiente de cobro</button>`;
  } else if(v.status==='confirmed'){
    actHTML=`<div style="background:rgba(16,185,129,.08);border:1px solid rgba(16,185,129,.25);border-radius:8px;padding:14px;text-align:center;">
      <div style="font-size:26px;margin-bottom:4px;">✅</div>
      <div style="font-weight:700;color:var(--green);">Venta Confirmada y Cobrada</div>
      ${m?`<div style="font-size:12px;color:var(--gray-400);">Entregada por: ${escapeHTML(m.name)}</div>`:``}
    </div>
    <button type="button" class="btn btn-ghost btn-full btn-sm" style="margin-top:6px;color:var(--orange);" onclick="revertConfirmSale(${v.id})">↩ Revertir venta (restaurar stock)</button>`;
  } else if(v.status==='pending_payment'){
    actHTML=`<div style="background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.25);border-radius:8px;padding:14px;text-align:center;margin-bottom:8px;">
      <div style="font-size:26px;margin-bottom:4px;">⏳</div>
      <div style="font-weight:700;color:var(--yellow);">Pendiente de cobro</div>
      ${m?`<div style="font-size:12px;color:var(--gray-400);">Mensajero: ${escapeHTML(m.name)}</div>`:``}
    </div>
    <button class="btn btn-green btn-full" onclick="markAsPaid(${v.id})">✅ Cobrado — Registrar pago</button>
    <button type="button" class="btn btn-ghost btn-full btn-sm" style="margin-top:6px;color:var(--orange);" onclick="revertConfirmSale(${v.id})">↩ Revertir venta</button>`;
  }
  const numBadge=valeNumStr(v)?`<span style="font-size:15px;font-weight:900;color:var(--blue);margin-bottom:4px;display:block;">${valeNumStr(v)}</span>`:'';
  const notesHighlight=v.adminNotes?`<div style="background:#FFFBEB;border:1px solid var(--yellow);border-radius:8px;padding:7px 10px;font-size:11px;color:var(--gray-700);margin-top:5px;">📝 ${escapeHTML(v.adminNotes)}</div>`:'';
  const estafaMatches=checkEstafaMatch(v);
  const estafaDetailHTML=estafaMatches.length?`<div style="background:rgba(239,68,68,.08);border:2px solid var(--red);border-radius:10px;padding:12px;margin-bottom:10px;">
    <div style="font-size:14px;font-weight:800;color:var(--red);margin-bottom:6px;">🚨 ALERTA DE ESTAFA</div>
    <div style="font-size:12px;color:var(--text);line-height:1.6;">${estafaMatches.map(m=>'⚠️ Coincidencia por '+m.reasons.join(', ')+(m.entry.nota?' — <i>'+escapeHTML(m.entry.nota)+'</i>':'')).join('<br>')}</div>
  </div>`:'';
  c.innerHTML=`
    <div class="lbl" style="margin-top:0;">Detalle del Vale</div>
    ${estafaDetailHTML}
    <div class="card">
      ${numBadge}
      <div class="det-gestor-row">
        <div class="g-avatar" style="background:${g?g.color:'#888'};width:34px;height:34px;font-size:12px;">${g?escapeHTML(g.initials):'?'}</div>
        <div style="flex:1;">
          <div style="font-size:14px;font-weight:700;">${g?escapeHTML(g.name):'—'}</div>
          <div style="font-size:11px;color:var(--gray-400);">${new Date(v.ts).toLocaleDateString('es-ES')} ${timeStr(v.ts)}</div>
        </div>
        <div style="text-align:right;">
          <span class="sp ${s.cls}">${s.icon} ${s.label}</span>
          ${pts>0?`<div style="font-size:10px;color:var(--blue);font-weight:700;margin-top:3px;">⭐ ${pts} pts</div>`:``}
        </div>
      </div>
      <table style="width:100%;font-size:12px;border-collapse:collapse;">
        ${[['Cliente',v.cliente],['Teléfono',v.telefono],['Dirección',v.direccion],['Artículo',v.articulo],
           ['Precio USD',v.precioUSD],['Precio MN',v.precioMN],['Vuelto',v.vuelto],['Total',v.total],['Garantía',v.garantia],['💰 Comisión gestor',v.comisionGestor]]
          .filter(([,val])=>val)
          .map(([k,val])=>`<tr style="border-bottom:1px solid var(--gray-100);">
            <td style="padding:6px 0;color:var(--gray-400);font-weight:600;width:100px;">${k}</td>
            <td style="padding:6px 0;font-weight:600;">${escapeHTML(val)}</td></tr>`).join('')}
      </table>
      ${notesHighlight}
    </div>
    <div class="card" style="padding:10px 14px;display:flex;gap:6px;">
      ${v.status!=='confirmed'?`<button type="button" class="btn btn-ghost btn-full btn-sm" onclick="openEditValeModal(${v.id})">✏️ Editar vale</button>`:``}
      <button type="button" class="btn btn-sm btn-full" style="background:rgba(239,68,68,.1);color:var(--red);border:none;" onclick="adminDeleteVale(${v.id})">🗑️ Eliminar vale</button>
    </div>
    ${actHTML?`<div class="card"><div class="det-actions">${actHTML}</div></div>`:``}
    <div class="card" style="padding:10px 14px;">
      <div style="font-size:10px;font-weight:700;color:var(--gray-400);letter-spacing:.5px;text-transform:uppercase;margin-bottom:6px;">📝 Notas (admin)</div>
      <textarea id="valeNotesInput" rows="2" placeholder="Añadir nota interna…" style="font-size:12px;margin-bottom:6px;">${escapeHTML(v.adminNotes||'')}</textarea>
      <button type="button" class="btn btn-ghost btn-sm btn-full" onclick="saveValeNotes(${v.id})">Guardar nota</button>
    </div>
    <div class="lbl">Vale completo</div>
    <div class="card" style="padding:10px 12px;">
      <div class="vale-preview" style="font-size:11px;">${escapeHTML(v.valeText||'')}</div>
      <button class="btn btn-ghost btn-full btn-sm" style="margin-top:8px;" onclick="navigator.clipboard.writeText(document.querySelector('#valeDetail .vale-preview').textContent).then(()=>showToast('Copiado ✓'))">📋 Copiar vale</button>
    </div>`;
}

function saveValeNotes(id) {
  const ta=document.getElementById('valeNotesInput');
  if(!ta)return;
  patchVale(id,{adminNotes:ta.value.trim()});
  renderAdminGestores();renderValeDetail();
  showToast('Nota guardada ✓');
}

function openEditValeModal(id) {
  const v=getVales().find(x=>x.id===id);if(!v)return;
  // Fix 5: incluir comisión del gestor en la edición del vale
  ['cliente','telefono','direccion','mensajeria','total','garantia','comisionGestor'].forEach(k=>{
    const el=document.getElementById('ev-'+k);if(el)el.value=v[k]||'';
  });
  document.getElementById('editValeModal').dataset.valeId=id;
  document.getElementById('editValeModal').classList.add('show');
}
function closeEditValeModal(){document.getElementById('editValeModal').classList.remove('show');}
function saveEditVale() {
  const id=parseInt(document.getElementById('editValeModal').dataset.valeId);
  const v=getVales().find(x=>x.id===id);if(!v)return;
  const changes={};
  ['cliente','telefono','direccion','mensajeria','total','garantia','comisionGestor'].forEach(k=>{
    const el=document.getElementById('ev-'+k);if(el)changes[k]=el.value.trim();
  });
  patchVale(id,changes);
  closeEditValeModal();
  renderAdminGestores();renderValeDetail();
  showToast('Vale editado ✓');
}

function updateSharePreview() {
  const v=getVales().find(x=>x.id===shareTargetId);if(!v)return;
  const m=mensajeroOf(parseInt(document.getElementById('mensajeroSelect').value));
  document.getElementById('shareValePreview').textContent=buildShareText(v,m);
}
function buildShareText(v,m) {
  const g=gestorOf(v.gestorId);
  const numLine=valeNumStr(v)?`${valeNumStr(v)}
`:'';
  return [numLine+'Bienvenido a "AXONTECH" 🔥','','VALE DE ENTREGA','',
    `🔸Promotor: ${g?g.name:'—'}`,`🛵Mensajero: ${m?m.name:'—'}`,'',
    `🔸 Nombre Cliente: ${v.cliente||''}`,`🔸Teléfono Cliente: ${v.telefono||''}`,
    `🔸Dirección Cliente: ${v.direccion||''}`,`🔸Mensajería/ costo: ${v.mensajeria||''}`,
    `🔸 Artículo y cantidad: ${v.articulo||''}`,`🔸 Total a pagar: ${v.total||''}`, '',
    `*Fecha: ${new Date(v.ts).toLocaleDateString('es-ES')} ${timeStr(v.ts)}`,'',
    '🧭Amistad #311 % San Rafael y San José, Centro Habana.'].join('\n');
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
  renderAdminGestores();renderValeDetail();renderMyVales();
  renderConfirmados();renderPendienteCobro();
  updateMensajeroBadge();
  showToast(`Asignado a ${m?m.name:'mensajero'} y copiado ✓`);
}

// ══════════════════════════════════════════
//  CONFIRM / PENDING
// ══════════════════════════════════════════
// Mensajero marca entrega — pasa directo a pendiente de cobro, descuenta stock, notifica gestor
function mensajeroEntrega(id) {
  const v=getVales().find(x=>x.id===id);if(!v)return;
  // Descuenta stock
  const prods=getProductos();
  let stockChanged=false;
  (v.valeProductos||[]).forEach(({id:pid,qty})=>{
    const idx=prods.findIndex(p=>p.id===pid);if(idx===-1)return;
    const oldStock=prods[idx].stock||0;
    const newStock=Math.max(0,oldStock-qty);
    prods[idx]={...prods[idx],stock:newStock};
    stockChanged=true;
    addNotif('sale_product',prods[idx].name,pid,`${qty}|${newStock}`,v.gestorId);
    if(newStock===0&&oldStock>0) addNotif('out_of_stock',prods[idx].name,pid,'stock agotado');
    else if(newStock>0&&newStock<=LOW_STOCK_THRESHOLD&&oldStock>LOW_STOCK_THRESHOLD) addNotif('low_stock',prods[idx].name,pid,`quedan ${newStock}`);
  });
  if(stockChanged) saveProductos(prods);
  // Notifica al gestor que su venta fue entregada y queda pendiente de cobro
  addNotif('vale_assigned',v.cliente||'Cliente',null,'Entregado · Pendiente de cobro',v.gestorId);
  patchVale(id,{status:'pending_payment',deliveredTs:new Date().toISOString()});
  gestoresTabDirty=true;statsTabDirty=true;rankingCache=null;
  renderAdminGestores();renderValeDetail();renderMyVales();
  renderPendienteCobro();renderMensajeroVales();renderPendingCobroSection();
  renderProductGrid();renderGestorRanking();updateAdminBadge();updateMensajeroBadge();
  maybeAutoSync();
  showToast('Entregado · Pendiente de cobro 🛵⏳');
}
// Mensajero marca como pagado directo (sin pasar por pendiente de cobro)
function mensajeroPagadoDirecto(id, skipConfirm) {
  if(!skipConfirm) {
    const v=getVales().find(x=>x.id===id);if(!v)return;
    showConfirmAction('¿Confirmar venta cobrada?',`${escapeHTML(v.cliente||'')} · ${escapeHTML(v.total||'')}`,'Confirmar cobrada','btn-green',()=>mensajeroPagadoDirecto(id,true));
    return;
  }
  const v=getVales().find(x=>x.id===id);if(!v)return;
  if(v.status==='confirmed'){showToast('Esta venta ya fue confirmada');return;}
  // Descuenta stock
  const prods=getProductos();
  let stockChanged=false;
  (v.valeProductos||[]).forEach(({id:pid,qty})=>{
    const idx=prods.findIndex(p=>p.id===pid);if(idx===-1)return;
    const oldStock=prods[idx].stock||0;
    const newStock=Math.max(0,oldStock-qty);
    prods[idx]={...prods[idx],stock:newStock};
    stockChanged=true;
    addNotif('sale_product',prods[idx].name,pid,`${qty}|${newStock}`,v.gestorId);
    if(newStock===0&&oldStock>0) addNotif('out_of_stock',prods[idx].name,pid,'stock agotado');
    else if(newStock>0&&newStock<=LOW_STOCK_THRESHOLD&&oldStock>LOW_STOCK_THRESHOLD) addNotif('low_stock',prods[idx].name,pid,`quedan ${newStock}`);
  });
  if(stockChanged) saveProductos(prods);
  addNotif('vale_confirmed',v.cliente||'Cliente',null,`Total: ${v.total||''}`,v.gestorId);
  patchVale(id,{status:'confirmed',confirmedTs:new Date().toISOString(),deliveredTs:new Date().toISOString()});
  gestoresTabDirty=true;statsTabDirty=true;rankingCache=null;
  playSound('confirm');
  renderAdminGestores();renderValeDetail();renderMyVales();
  renderPendienteCobro();renderMensajeroVales();renderPendingCobroSection();
  renderConfirmados();renderProductGrid();renderGestorRanking();
  if(currentAdminTab==='gestores'){renderComisiones();}
  if(currentAdminTab==='catalog'){renderAdminCatalogCats();renderAdminCatalog();}
  updateAdminBadge();updateMensajeroBadge();
  checkGoalReached(v.gestorId, id);
  maybeAutoSync();
  showToast('Venta cobrada ✅');
}
// Mensajero marca como pagado (entregado y cobrado)
function mensajeroPagado(id, skipConfirm) {
  if(!skipConfirm) {
    const v=getVales().find(x=>x.id===id);if(!v)return;
    showConfirmAction('¿Confirmar venta cobrada?',`${escapeHTML(v.cliente||'')} · ${escapeHTML(v.total||'')}`,'Confirmar cobrada','btn-green',()=>mensajeroPagado(id,true));
    return;
  }
  const v=getVales().find(x=>x.id===id);if(!v)return;
  if(v.status === 'confirmed') { showToast('Esta venta ya fue confirmada'); return; }
  // Discount stock if not already done
  const prods=getProductos();
  let stockChanged=false;
  (v.valeProductos||[]).forEach(({id:pid,qty})=>{
    const idx=prods.findIndex(p=>p.id===pid);if(idx===-1)return;
    const oldStock=prods[idx].stock||0;
    const newStock=Math.max(0,oldStock-qty);
    prods[idx]={...prods[idx],stock:newStock};
    stockChanged=true;
    addNotif('sale_product',prods[idx].name,pid,`${qty}|${newStock}`,v.gestorId);
    if(newStock===0&&oldStock>0) addNotif('out_of_stock',prods[idx].name,pid,'stock agotado');
    else if(newStock>0&&newStock<=LOW_STOCK_THRESHOLD&&oldStock>LOW_STOCK_THRESHOLD) addNotif('low_stock',prods[idx].name,pid,`quedan ${newStock}`);
  });
  if(stockChanged) saveProductos(prods);
  addNotif('vale_confirmed',v.cliente||'Cliente',null,`Total: ${v.total||''}`,v.gestorId);
  patchVale(id,{status:'confirmed',confirmedTs:new Date().toISOString(),deliveredTs:v.deliveredTs||new Date().toISOString()});
  gestoresTabDirty=true;statsTabDirty=true;rankingCache=null;
  playSound('confirm');
  renderAdminGestores();renderValeDetail();renderMyVales();
  renderPendienteCobro();renderMensajeroVales();renderPendingCobroSection();
  renderConfirmados();renderProductGrid();renderGestorRanking();
  if(currentAdminTab==='gestores'){renderComisiones();}
  if(currentAdminTab==='catalog'){renderAdminCatalogCats();renderAdminCatalog();}
  updateAdminBadge();updateMensajeroBadge();
  checkGoalReached(v.gestorId, id);
  maybeAutoSync();
  showToast('Venta confirmada y cobrada ✅');
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
  // Idempotency guard: prevent double stock decrement if button is double-clicked
  if(v.status === 'confirmed' || v.status === 'pending_payment') {
    showToast('Esta venta ya fue confirmada');
    return;
  }
  // Fix 1: descuento de stock garantizado
  const prods=getProductos();
  let stockChanged=false;
  (v.valeProductos||[]).forEach(({id:pid,qty})=>{
    const idx=prods.findIndex(p=>p.id===pid);if(idx===-1)return;
    const oldStock=prods[idx].stock||0;
    const newStock=Math.max(0,oldStock-qty);
    prods[idx]={...prods[idx],stock:newStock};
    stockChanged=true;
    addNotif('sale_product',prods[idx].name,pid,`${qty}|${newStock}`,v.gestorId);
    if(newStock===0&&oldStock>0) addNotif('out_of_stock',prods[idx].name,pid,'stock agotado');
    else if(newStock>0&&newStock<=LOW_STOCK_THRESHOLD&&oldStock>LOW_STOCK_THRESHOLD) addNotif('low_stock',prods[idx].name,pid,`quedan ${newStock}`);
  });
  if(stockChanged){
    saveProductos(prods);
  }
  if(paymentStatus === 'confirmed') addNotif('vale_confirmed',v.cliente||'Cliente',null,`Total: ${v.total||''}`,v.gestorId);
  patchVale(id,{status:paymentStatus,confirmedTs:new Date().toISOString()});
  gestoresTabDirty=true;statsTabDirty=true;rankingCache=null;
  playSound('confirm');
  renderAdminGestores();renderValeDetail();renderMyVales();
  renderConfirmados();renderPendienteCobro();renderPendingCobroSection();renderMensajeroVales();
  renderProductGrid();renderGestorRanking();
  if(currentAdminTab==='gestores'){renderComisiones();}
  if(currentAdminTab==='catalog'){renderAdminCatalogCats();renderAdminCatalog();}
  checkGoalReached(v.gestorId, id);
  maybeAutoSync();
  if(paymentStatus==='confirmed'){
    const gg=gestorOf(v.gestorId);
    if(gg){
      addNotif('vale_confirmed',v.cliente||'Cliente',null,`Total: ${v.total||''}`,v.gestorId);
    }
  }
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
  renderAdminGestores();renderValeDetail();renderMyVales();
  renderConfirmados();renderPendienteCobro();renderPendingCobroSection();renderMensajeroVales();renderMensajeroSelector();updateMensajeroBadge();
  renderGestorRanking();
  if(currentAdminTab==='gestores'){renderComisiones();}
  if(currentAdminTab==='catalog'){renderAdminCatalogCats();renderAdminCatalog();}
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
  inp.value='';renderMensajeros();maybeAutoSync();showToast('Mensajero agregado');
}
const _nmi=document.getElementById('newMensajeroInput');if(_nmi)_nmi.addEventListener('keydown',e=>{if(e.key==='Enter')addMensajero();});
function removeMensajero(id) {
  if(getVales().some(v=>v.mensajeroId===id&&['assigned','pending_payment'].includes(v.status))){showToast('Tiene vales activos');return;}
  saveMensajeros(getMensajeros().filter(m=>m.id!==id));renderMensajeros();maybeAutoSync();
}
function renderMensajeros() {
  const list=getMensajeros();const c=document.getElementById('mensajerosList');
  if(!c) return;
  if(!list.length){c.innerHTML='<div class="es" style="padding:8px;"><div class="es-text">Sin mensajeros</div></div>';return;}
  c.innerHTML=list.map(m=>{
    const ini=m.name.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2);
    return `<div class="m-item"><div class="m-av">${escapeHTML(ini)}</div><div class="m-name">${escapeHTML(m.name)}</div><button class="m-del" style="font-size:13px;margin-right:4px;" onclick="openEditMensajeroModal(${m.id})" title="Editar">✏️</button><button class="m-del" onclick="removeMensajero(${m.id})">×</button></div>`;
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
  maybeAutoSync();
  showToast('Mensajero actualizado ✓');
}

// ══════════════════════════════════════════
//  CONFIRMADOS / PENDIENTES
// ══════════════════════════════════════════
function renderConfirmados() {
  const today=getVales().filter(v=>v.status==='confirmed'&&new Date(v.ts).toDateString()===todayStr()).reverse();
  const c=document.getElementById('confirmadosList');
  if(!c) return;
  if(!today.length){c.innerHTML='<div class="es"><div class="es-icon">✅</div><div class="es-text">Sin confirmaciones</div></div>';return;}
  c.innerHTML=today.map(v=>{
    const g=gestorOf(v.gestorId);const m=v.mensajeroId?mensajeroOf(v.mensajeroId):null;
    return `<div class="sc sc-ok"><div class="sc-head"><span class="sc-g">${g?escapeHTML(g.name):'—'}</span><span class="sc-t">${timeStr(v.confirmedTs||v.ts)}</span></div><div>${escapeHTML(v.cliente||'')}</div><div class="sc-m">${m?'🛵 '+escapeHTML(m.name):''}</div><button type="button" class="btn btn-ghost btn-sm" style="margin-top:5px;font-size:10px;color:var(--orange);" onclick="revertConfirmSale(${v.id})">↩ Revertir venta</button></div>`;
  }).join('');
}
function renderPendienteCobro() {
  const c=document.getElementById('pendienteList');
  if(!c) return;
  const pend=getVales().filter(v=>v.status==='pending_payment').reverse();
  if(!pend.length){c.innerHTML='<div class="es"><div class="es-icon">⏳</div><div class="es-text">Sin pendientes</div></div>';return;}
  c.innerHTML=pend.map(v=>{
    const g=gestorOf(v.gestorId);const m=v.mensajeroId?mensajeroOf(v.mensajeroId):null;
    return `<div class="sc sc-pend"><div class="sc-head"><span class="sc-g">${g?escapeHTML(g.name):'—'}</span><span class="sc-t">${timeStr(v.ts)}</span></div><div>${escapeHTML(v.cliente||'')} · ${escapeHTML(v.total||'')}</div><div class="sc-m">${m?'🛵 '+escapeHTML(m.name):''}</div><div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-top:7px;"><button class="btn btn-green btn-sm btn-full" onclick="markAsPaid(${v.id})">✅ Cobrado</button><button class="btn btn-ghost btn-sm btn-full" style="color:var(--orange);" onclick="revertConfirmSale(${v.id})">↩ Revertir</button></div></div>`;
  }).join('');
}
function togglePendingCobro(){pendingCobroExpanded=!pendingCobroExpanded;renderPendingCobroSection();}
function renderPendingCobroSection() {
  const c=document.getElementById('pendingCobroSection');if(!c)return;
  const pend=getVales().filter(v=>v.status==='pending_payment').reverse();
  if(!pend.length){c.innerHTML='';return;}
  const body=pendingCobroExpanded?`<div style="margin-top:8px;">${pend.map(v=>{
    const g=gestorOf(v.gestorId);const m=v.mensajeroId?mensajeroOf(v.mensajeroId):null;
    return `<div class="mv-card" style="border-left:3px solid var(--red);background:rgba(239,68,68,.05);margin-bottom:6px;">
      <div class="mv-head"><span class="mv-time">${timeStr(v.confirmedTs||v.ts)}</span><span style="color:var(--red);font-size:9px;font-weight:700;padding:2px 6px;background:rgba(239,68,68,.12);border-radius:4px;">⏳ Pend. cobro</span></div>
      <div class="mv-info"><b>${escapeHTML(v.cliente||'—')}</b> · <span style="color:var(--red);font-weight:700;">${escapeHTML(v.total||'—')}</span></div>
      ${g?`<div style="font-size:11px;color:var(--gray-400);">Gestor: ${escapeHTML(g.name)}</div>`:''}
      ${m?`<div style="font-size:11px;color:var(--gray-400);">🛵 ${escapeHTML(m.name)}</div>`:''}
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
  const c = document.getElementById('gestorMyVales');
  const hList = document.getElementById('gestorHistorialList');
  if(!c || !hList || !activeGestorId) return;

  const mine = getVales().filter(v => v.gestorId === activeGestorId).reverse();
  const activeVales = mine.filter(v => ['pending','assigned','delivered','pending_payment'].includes(v.status));
  const historyVales = mine.filter(v => v.status === 'confirmed');

  const sMap={
    pending:{label:'Enviado · admin pendiente',color:'var(--blue)',icon:'🔵'},
    assigned:{label:'Con mensajero',color:'var(--orange)',icon:'🛵'},
    delivered:{label:'Entregado',color:'#7C3AED',icon:'📦'},
    confirmed:{label:'Venta confirmada ✅',color:'var(--green)',icon:'✅'},
    pending_payment:{label:'Pendiente de cobro',color:'var(--yellow)',icon:'⏳'},
  };

  // 1. ACTIVE VALES
  if(!activeVales.length){
    c.innerHTML='<div class="es"><div class="es-icon">🧾</div><div class="es-text">Sin vales activos</div></div>';
  } else {
    c.innerHTML=activeVales.map(v=>{
      const s=sMap[v.status]||{label:v.status,color:'var(--gray-400)',icon:'•'};
      const pts=(v.valeProductos||[]).reduce((sum,p)=>{const pr=productoOf(p.id);return sum+(pr?pr.puntos*p.qty:0);},0);
      const canCancel=v.status==='pending';
      return `<div class="mv-card st-${v.status}">
        <div class="mv-head">
          <span class="mv-time">${valeNumStr(v)?`<b style="color:var(--blue);">${valeNumStr(v)}</b> `:``}${timeStr(v.ts)}</span>
          <div style="display:flex;align-items:center;gap:6px;">
            ${pts>0?`<span style="font-size:10px;color:var(--blue);font-weight:700;">⭐ ${pts} pts</span>`:``}
            ${canCancel?`<button type="button" onclick="cancelVale(${v.id})" style="background:rgba(239,68,68,.12);border:none;color:var(--red);border-radius:6px;padding:2px 8px;font-size:11px;font-weight:700;cursor:pointer;" title="Cancelar vale">✕ Cancelar</button>`:``}
          </div>
        </div>
        <div class="mv-info">${escapeHTML(v.cliente||'—')} · ${escapeHTML(v.articulo||'—')}</div>
        <div class="mv-foot"><span class="mv-status" style="color:${s.color}">${s.icon} ${s.label}</span></div>
      </div>`;
    }).join('');
  }

  // 2. HISTORY VALES (in collapsible)
  const countEl=document.getElementById('gestorHistCount');
  const clearBtn=document.getElementById('gestorHistClearBtn');
  if(countEl) countEl.textContent=historyVales.length||'0';
  if(clearBtn) clearBtn.style.display=historyVales.length?'block':'none';
  if(!historyVales.length){
    hList.innerHTML='<div class="es"><div class="es-text">Sin historial</div></div>';
  } else {
    hList.innerHTML=historyVales.map(v=>{
      const s=sMap[v.status]||{label:v.status,color:'var(--gray-400)',icon:'•'};
      return `<div class="mv-card st-${v.status}" onclick="openGestorValeModal(${v.id})" style="cursor:pointer; opacity:0.85; border-left: 3px solid var(--gray-300);">
        <div class="mv-head">
          <span class="mv-time" style="color:var(--gray-600);"><b style="color:var(--gray-800);">${valeNumStr(v)}</b> · ${new Date(v.ts).toLocaleDateString('es-ES')} ${timeStr(v.ts)}</span>
        </div>
        <div class="mv-info" style="color:var(--text);font-weight:600;">${escapeHTML(v.cliente||'—')}</div>
        <div class="mv-info" style="font-size:11px;color:var(--text-muted);">${escapeHTML(v.articulo||'—')}</div>
        <div class="mv-foot" style="margin-top:6px;"><span class="mv-status" style="color:${s.color};font-size:10px;">${s.icon} ${s.label}</span></div>
      </div>`;
    }).join('');
  }
}
let _gestorHistOpen=false;
function toggleGestorHistorial(){
  _gestorHistOpen=!_gestorHistOpen;
  const hList=document.getElementById('gestorHistorialList');
  const arrow=document.getElementById('gestorHistArrow');
  const clearBtn=document.getElementById('gestorHistClearBtn');
  if(hList) hList.style.display=_gestorHistOpen?'block':'none';
  if(arrow) arrow.textContent=_gestorHistOpen?'▲':'▼';
  if(clearBtn&&_gestorHistOpen){const hv=getVales().filter(v=>v.gestorId===activeGestorId&&v.status==='confirmed');clearBtn.style.display=hv.length?'block':'none';}
}
function clearGestorHistory(){
  const confirmed=getVales().filter(v=>v.gestorId===activeGestorId&&v.status==='confirmed');
  if(!confirmed.length){showToast('No hay historial para limpiar');return;}
  showConfirmAction('¿Limpiar historial?',`Se eliminarán ${confirmed.length} vales completados del historial. Esta acción no se puede deshacer.`,'Limpiar','btn-red',()=>{
    const all=getVales().filter(v=>!(v.gestorId===activeGestorId&&v.status==='confirmed'));
    saveVales(all);maybeAutoSync();
    _gestorHistOpen=false;toggleGestorHistorial();toggleGestorHistorial();
    renderMyVales();showToast('Historial limpiado ✅');
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
    <div style="font-size:16px;font-weight:800;color:var(--blue-dk);margin-bottom:12px;">${valeNumStr(v)} ${escapeHTML(v.cliente)}</div>
    <div style="margin-bottom:6px;"><b>📱 Teléfono:</b> ${escapeHTML(v.telefono||'—')}</div>
    <div style="margin-bottom:6px;"><b>📍 Dirección:</b> ${escapeHTML(v.direccion||'—')}</div>
    <div style="margin-bottom:6px;"><b>📦 Artículo:</b> ${escapeHTML(v.articulo||'—')}</div>
    <div style="margin-bottom:6px;"><b>💰 Total:</b> ${escapeHTML(v.total||'—')}</div>
    <div style="margin-bottom:12px;"><b>⚙️ Garantía:</b> ${escapeHTML(v.garantia||'—')}</div>
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
  const prodLines=currentValeProductos.length
    ? currentValeProductos.map(p=>`  ×${p.qty} ${p.name}`).join('\n')
    : fVal('vf-articulo');
  return ['Bienvenido a "AXONTECH" 🔥','','VALE DEL GESTOR:','',
    `🔸Promotor: ${g?g.name:''}`, '',
    `🔸 Nombre Cliente: ${fVal('vf-cliente')}`,
    `🔸Teléfono Cliente: ${fVal('vf-telefono')}`,
    `🔸Dirección Cliente: ${fVal('vf-direccion')}`,
    `🔸Mensajería/ costo: ${fVal('vf-mensajeria')}`,
    `🔸 Artículos y cantidades:`,prodLines,
    `🔸Precio USD/ zelle: ${fVal('vf-precioUSD')}`,
    `🔸Precio MN: ${fVal('vf-precioMN')}`,
    `🔸 Vuelto: ${fVal('vf-vuelto')}`,
    `🔸 Total a pagar: ${fVal('vf-total')}`, '',
    `*Garantía: ${fVal('vf-garantia')}`,
    `*Fecha y hora de Venta: ${fVal('vf-fecha')||nowDateTime()}`, '',
    '🧭Dirección de la tienda:','* Amistad #311 % San Rafael y San José, Centro Habana.','',
    '🚨ATENCIÓN🚨','•   Horarios de atención al cliente:','    9:00am - 7:00pm.',
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
  const prodLines=currentValeProductos.length
    ? currentValeProductos.map(p=>`  ×${p.qty} ${p.name}`).join('\n')
    : (fVal('vf-articulo') || 'Sin artículo');
  const text = `🏪 *TICKET DE RECOGIDA - AXONTECH* 🏪
-----------------------------------
👤 *Atendido por:* ${g ? g.name : ''}
👤 *Cliente:* ${fVal('vf-cliente') || 'Sin nombre'}
📦 *Artículos:*
${prodLines}
💰 *Total a pagar:* ${fVal('vf-total') || '—'}
-----------------------------------
📍 *Dirección de Tienda:*
Amistad #311 % San Rafael y San José, Centro Habana.

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
function saveCatalogPhone() {
  const phone=document.getElementById('catalogPhoneInput').value.trim();
  const cfg=getConfig();cfg.catalogPhone=phone;saveConfig(cfg);showToast('Número catálogo guardado ✓');
  triggerAutoPublishCatalog();
}
function resetForm() {
  ['vf-cliente','vf-telefono','vf-direccion','vf-carnet','vf-mensajeria','vf-articulo',
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
let _isSendingVale = false;
function sendVale() {
  if(_isSendingVale) return; // Prevent double submission
  if(!activeGestorId){showToast('Selecciona tu nombre primero');return;}
  if(REQUIRED.some(id=>!fVal(id))){showToast('Completa los campos obligatorios (*)');return;}
  _isSendingVale = true;
  const btn=document.getElementById('sendValeBtn');
  if(btn){btn.disabled=true;btn.textContent='Enviando...';}
  const g=gestorOf(activeGestorId);
  const vale={
    id:Date.now(),valeNum:getNextValeNum(),gestorId:activeGestorId,ts:new Date().toISOString(),
    cliente:fVal('vf-cliente'),telefono:fVal('vf-telefono'),direccion:fVal('vf-direccion'),carnet:fVal('vf-carnet'),
    mensajeria:fVal('vf-mensajeria'),articulo:fVal('vf-articulo'),
    precioUSD:fVal('vf-precioUSD'),precioMN:fVal('vf-precioMN'),
    vuelto:fVal('vf-vuelto'),total:fVal('vf-total'),garantia:fVal('vf-garantia'),
    valeProductos:currentValeProductos,valeText:buildValeText(),
    status:'pending',mensajeroId:null,confirmedTs:null,isNew:true,adminNotes:'',
  };
  const all=getVales();all.push(vale);saveVales(all);
  if(typeof fbAddVale === 'function') fbAddVale(vale);

  renderGestores();renderMyVales();updateAdminBadge();
  playSound('vale');
  sendBrowserNotif('AXONTECH – Nuevo vale',`${g.name} envió un vale para ${vale.cliente}`);
  showToast('Vale enviado al administrador ✓');

  if(adminActive){
    const _nbt=document.getElementById('notifBannerText'); if(_nbt)_nbt.textContent=`${g.name} acaba de enviar un vale`;
    const _nb=document.getElementById('notifBanner'); if(_nb)_nb.classList.add('show');
    renderAdminGestores();
    // Check estafa blacklist when admin is active
    const estafaMatches = checkEstafaMatch(vale);
    if(estafaMatches.length) showEstafaAlert(vale, estafaMatches);
  }
  resetForm();
  _isSendingVale = false;
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
    cats.map(c=>`<button class="pcat-tab ${pickerCatFilter===c.id?'active':''}" onclick="setPickerCat(${c.id})">${escapeHTML(c.name)}</button>`).join('');
}
function setPickerCat(id){pickerCatFilter=id;renderPickerCatTabs();renderPickerProducts();}
function renderPickerProducts() {
  const search=document.getElementById('pickerSearch').value.toLowerCase();
  let prods=getProductos();
  if(pickerCatFilter!==null)prods=prods.filter(p=>p.catId===pickerCatFilter);
  if(search)prods=prods.filter(p=>p.name.toLowerCase().includes(search)||(p.description||'').toLowerCase().includes(search));
  // Sort: in-stock first, out-of-stock at the end
  prods.sort((a,b)=>{
    const aOos=(a.stock||0)===0?1:0;
    const bOos=(b.stock||0)===0?1:0;
    return aOos-bOos;
  });
  const c=document.getElementById('pickerProductGrid');
  if(!c) return;
  if(!prods.length){c.innerHTML='<div style="width:100%;text-align:center;padding:20px;color:var(--gray-400);">Sin productos disponibles</div>';return;}
  c.innerHTML=prods.map(p=>{
    const qty=pickerSelected[p.id]||0;
    const oos=(p.stock||0)===0;
    return `<div class="picker-pill ${qty>0?'selected':''} ${oos?'out-of-stock':''}" style="${oos?'pointer-events:none;':''}" ${oos?'title="Producto agotado"':''}>
      <div class="picker-pill-info">
        <div class="picker-pill-name">${escapeHTML(p.name)}${oos?` <span class="oos-badge">AGOTADO</span>`:''}</div>
        ${p.precio?`<div class="picker-pill-price">${escapeHTML(p.precio)}</div>`:''}
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
      ${p?escapeHTML(p.name):id} × ${qty}
      <button onclick="pickerAdj(${id},-99)" style="background:none;border:none;cursor:pointer;color:var(--red);font-size:14px;line-height:1;padding:0;">×</button>
    </span>`;
  }).join('');
}
function parsePrecioNum(str) {
  if(!str)return 0;
  // Sum ALL numbers found in the string, not just the first one
  const matches = str.replace(/,/g,'').match(/\d+(\.\d+)?/g);
  return matches ? matches.reduce((sum, m) => sum + parseFloat(m), 0) : 0;
}
function confirmPickerSelection() {
  const items=Object.entries(pickerSelected).map(([id,qty])=>{
    const p=productoOf(parseInt(id));return{id:parseInt(id),name:p?p.name:id,qty};
  });
  selectedProductsUI=items;currentValeProductos=items;
  renderSelectedProductsUI();
  document.getElementById('vf-articulo').value=items.map(i=>`×${i.qty} ${i.name}`).join(' / ');
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
  c.innerHTML=`<div style="display:flex;flex-direction:column;gap:5px;margin-bottom:8px;">`+
    selectedProductsUI.map(i=>`<div style="display:flex;align-items:center;gap:8px;min-width:0;">
      <span style="font-weight:800;color:var(--blue);flex-shrink:0;font-size:13px;">×${i.qty}</span>
      <span style="font-size:12px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;">${escapeHTML(i.name)}</span>
    </div>`).join('')+
    `</div><button class="btn btn-ghost btn-sm" style="font-size:10px;padding:3px 10px;" onclick="openProductPicker()">✏️ Editar selección</button>`;
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
      return `<button type="button" class="pcat-tab ${stockCatFilter===cat.id?'active':''}" onclick="setStockCat(${cat.id})" style="flex-shrink:0;">${escapeHTML(cat.name)} <span style="opacity:.7;">(${count})</span></button>`;
    }).join('');
  // Render cat manager list if visible
  const mgr=document.getElementById('catManagerList');
  if(mgr){
    mgr.innerHTML=cats.length?cats.map(cat=>{
      const count=prods.filter(p=>p.catId===cat.id).length;
      return `<div style="display:flex;align-items:center;justify-content:space-between;padding:7px 10px;background:var(--surface);border:1px solid var(--border);border-radius:8px;margin-bottom:5px;">
        <span style="font-size:12px;font-weight:600;">${escapeHTML(cat.name)} <span style="font-size:10px;color:var(--text-muted);">(${count} producto${count!==1?'s':''})</span></span>
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
  showConfirmAction('¿Eliminar esta categoría?', 'Los productos quedarán sin categoría', 'Eliminar', 'btn-red', () => {
    saveCategorias(getCategorias().filter(c=>c.id!==id));
    if(stockCatFilter===id)stockCatFilter=null;
    renderStockCategorias();renderProductGrid();
    showToast('Categoría eliminada');
  });
}
function buildProdCard(p, cats, isAgotado) {
  const cat=cats.find(c=>c.id===p.catId);
  const stockOk=(p.stock||0)>0;
  const isLow=stockOk&&(p.stock||0)<=LOW_STOCK_THRESHOLD;
  const stockColor=isAgotado?'var(--red)':isLow?'var(--yellow)':'var(--green)';
  return `<div class="prod-card${isAgotado?' agotado':''}" style="display:flex;align-items:center;gap:10px;padding:10px 12px;">
    <div style="width:52px;height:52px;border-radius:8px;overflow:hidden;background:var(--gray-100);display:flex;align-items:center;justify-content:center;flex-shrink:0;">
      ${p.photo
        ?`<img src="${escapeAttr(p.photo)}" alt="" style="width:100%;height:100%;object-fit:cover;" onerror="this.parentElement.innerHTML='<span style=font-size:22px>📦</span>'">`
        :`<span style="font-size:22px;">📦</span>`}
    </div>
    <div style="flex:1;min-width:0;">
      <div style="display:flex;align-items:baseline;gap:5px;flex-wrap:wrap;">
        <span class="prod-name" style="margin:0;font-size:13px;">${escapeHTML(p.name)}</span>
        ${cat?`<span class="prod-cat-tag" style="font-size:9px;">${escapeHTML(cat.name)}</span>`:''}
      </div>
      <div style="display:flex;align-items:center;gap:8px;margin-top:2px;flex-wrap:wrap;">
        ${p.precio?`<span class="prod-price" style="margin:0;font-size:11px;">${escapeHTML(p.precio)}</span>`:''}
        ${p.comision?`<span style="font-size:10px;color:var(--green);font-weight:600;">💰 ${escapeHTML(p.comision)}</span>`:''}
        ${p.garantia?`<span style="font-size:10px;color:var(--gray-400);">🛡️ ${escapeHTML(p.garantia)}</span>`:''}
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
    cats.map(c=>`<option value="${c.id}" ${c.id===selectedId?'selected':''}>${escapeHTML(c.name)}</option>`).join('');
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
  document.getElementById('pm-fotoPreview').innerHTML=p.photo?`<img src="${escapeAttr(p.photo)}" style="width:100%;height:80px;object-fit:cover;border-radius:6px;" onerror="this.style.display='none'">`:'';
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
  const p=productoOf(id);
  const name = p ? p.name : 'este producto';
  showConfirmAction('¿Eliminar este producto?', name, 'Eliminar', 'btn-red', () => {
    saveProductos(getProductos().filter(x=>x.id!==id));
    renderProductGrid();renderStockCategorias();showToast('Producto eliminado');
  });
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
    commissionPaid:true,commissionStatus:'cobrado',commissionPaidTs:new Date().toISOString()
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
        <div class="g-avatar" style="background:${g.color};width:32px;height:32px;font-size:11px;">${escapeHTML(g.initials)}</div>
        <div style="flex:1;">
          <div style="font-size:13px;font-weight:700;">${escapeHTML(g.name)}</div>
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
        <div style="font-size:13px;font-weight:700;">${p?escapeHTML(p.name):`Producto ${id}`}</div>
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
          <span style="font-size:13px;font-weight:700;">${escapeHTML(cat.name)}</span>
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
          <span style="font-size:12px;font-weight:700;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${p?escapeHTML(p.name):`Prod. ${id}`}</span>
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
    '🧭Dirección de la tienda:','* Amistad #311 % San Rafael y San José, Centro Habana.','',
    '🚨ATENCIÓN🚨','•   Horarios de atención: 9:00am - 7:00pm.'].join('\n');
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
    cats.map(c=>`<button class="pcat-tab ${catalogCatFilter===c.id?'active':''}" onclick="setCatalogCat(${c.id})">${escapeHTML(c.name)}</button>`).join('');
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
        ${p.photo?`<img src="${escapeAttr(p.photo)}" style="width:52px;height:52px;object-fit:cover;border-radius:6px;flex-shrink:0;" onerror="this.parentElement.querySelector('img').style.display='none'">`:`<div style="width:52px;height:52px;border-radius:6px;background:var(--gray-100);display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0;">📦</div>`}
        <div style="flex:1;min-width:0;">
          <div style="font-weight:700;font-size:13px;color:var(--text);">${escapeHTML(p.name)}</div>
          ${p.precio?`<div style="color:var(--blue);font-weight:700;font-size:12px;margin-top:2px;">${escapeHTML(p.precio)}</div>`:''}
        </div>
        <div style="font-size:13px;color:var(--gray-400);flex-shrink:0;margin-left:4px;">${exp?'▲':'▼'}</div>
      </div>
      ${exp?`<div style="padding:8px 12px 12px;border-top:1px solid var(--gray-200);background:var(--gray-50);">
        ${p.description?`<div style="font-size:12px;color:var(--text-muted);margin-bottom:10px;white-space:pre-line;line-height:1.5;">${escapeHTML(p.description)}</div>`:''}
        <div style="display:flex;flex-wrap:wrap;gap:5px;font-size:11px;">
          <span style="background:var(--blue-lt);color:var(--blue);padding:3px 9px;border-radius:10px;font-weight:700;">📦 Disponibles: ${p.stock}</span>
          ${p.garantia?`<span style="background:var(--gray-100);color:var(--gray-600);padding:3px 9px;border-radius:10px;">🛡️ ${escapeHTML(p.garantia)}</span>`:''}
          ${p.comision?`<span style="background:#f0fdf4;color:var(--green);padding:3px 9px;border-radius:10px;font-weight:600;">Comisión: ${escapeHTML(p.comision)}</span>`:''}
          ${p.puntos?`<span style="background:var(--blue-lt);color:var(--blue);padding:3px 9px;border-radius:10px;">⭐ ${p.puntos} pts</span>`:''}
        </div>
      </div>`:''}
    </div>`;
  }).join('');
}

// ══════════════════════════════════════════
//  ADMIN CATALOG (shared products, no out-of-stock, auto-updates from stock)
// ══════════════════════════════════════════
function renderAdminCatalogCats() {
  const cats=getCategorias();
  const prods=getProductos().filter(p=>(p.stock||0)>0);
  const tabEl=document.getElementById('catalogAdminCatTabs');
  if(!tabEl)return;
  tabEl.innerHTML=`<button class="pcat-tab ${adminCatalogCatFilter===null?'active':''}" onclick="setAdminCatalogCat(null)" style="flex-shrink:0;">Todos (${prods.length})</button>`+
    cats.map(c=>{
      const count=prods.filter(p=>p.catId===c.id).length;
      return count>0?`<button class="pcat-tab ${adminCatalogCatFilter===c.id?'active':''}" onclick="setAdminCatalogCat(${c.id})" style="flex-shrink:0;">${escapeHTML(c.name)} (${count})</button>`:'';
    }).join('');
}
function setAdminCatalogCat(id){adminCatalogCatFilter=id;renderAdminCatalogCats();renderAdminCatalog();}
function renderAdminCatalog() {
  const searchEl=document.getElementById('catalogAdminSearch');
  const search=searchEl?searchEl.value.toLowerCase():'';
  let prods=getProductos().filter(p=>(p.stock||0)>0);
  if(adminCatalogCatFilter!==null)prods=prods.filter(p=>p.catId===adminCatalogCatFilter);
  if(search)prods=prods.filter(p=>p.name.toLowerCase().includes(search)||(p.description||'').toLowerCase().includes(search));
  const c=document.getElementById('catalogAdminGrid');
  if(!c)return;
  if(!prods.length){c.innerHTML='<div class="es"><div class="es-icon">📦</div><div class="es-text">Sin productos disponibles</div></div>';return;}
  c.innerHTML=`<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px;">`+
    prods.map(p=>{
      const cat=getCategorias().find(c=>c.id===p.catId);
      return `<div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;overflow:hidden;transition:box-shadow .2s,transform .15s;" onmouseover="this.style.boxShadow='0 4px 14px rgba(0,0,0,.08)';this.style.transform='translateY(-2px)'" onmouseout="this.style.boxShadow='';this.style.transform=''">
        <div style="height:140px;background:var(--gray-100);display:flex;align-items:center;justify-content:center;overflow:hidden;position:relative;">
          ${p.photo?`<img src="${escapeAttr(p.photo)}" style="width:100%;height:100%;object-fit:cover;" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`:''}
          <div style="${p.photo?'display:none;':''}width:100%;height:100%;align-items:center;justify-content:center;font-size:48px;">📦</div>
          ${cat?`<span style="position:absolute;top:8px;left:8px;background:var(--blue);color:white;padding:2px 8px;border-radius:10px;font-size:9px;font-weight:700;">${escapeHTML(cat.name)}</span>`:''}
        </div>
        <div style="padding:12px;">
          <div style="font-weight:700;font-size:14px;color:var(--text);margin-bottom:4px;">${escapeHTML(p.name)}</div>
          ${p.description?`<div style="font-size:11px;color:var(--text-muted);line-height:1.4;margin-bottom:8px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">${escapeHTML(p.description)}</div>`:''}
          ${p.precio?`<div style="font-weight:800;font-size:16px;color:var(--blue);margin-bottom:6px;">${escapeHTML(p.precio)}</div>`:''}
          <div style="display:flex;flex-wrap:wrap;gap:4px;">
            ${p.garantia?`<span style="background:var(--gray-100);color:var(--gray-600);padding:2px 7px;border-radius:8px;font-size:9px;font-weight:600;">🛡️ ${escapeHTML(p.garantia)}</span>`:''}
          </div>
        </div>
      </div>`;
    }).join('')+`</div>`;
}
function shareCatalogWeb(){
  const html=buildCatalogHTML();
  if(!html){showToast('No hay productos para exportar');return;}
  const allProds=getProductos().filter(p=>(p.stock||0)>0);
  // Generate downloadable HTML file
  const blob=new Blob([html],{type:'text/html;charset=utf-8'});
  const url=URL.createObjectURL(blob);
  // Build modal using DOM to avoid template-literal issues with blob URLs
  const overlay=document.createElement('div');
  overlay.className='modal-bg show';
  overlay.style.zIndex='10000';
  const box=document.createElement('div');
  box.className='modal';
  box.style.cssText='max-width:400px;width:90%;text-align:center;';
  box.innerHTML=`
    <div style="font-size:40px;margin-bottom:12px;">🔗</div>
    <div class="modal-title" style="margin-bottom:6px;">Catálogo Generado</div>
    <div style="font-size:12.5px;color:var(--muted,#64748b);margin-bottom:20px;line-height:1.5;">${allProds.length} productos listos para compartir.</div>
    <div style="display:flex;flex-direction:column;gap:8px;" id="catalogShareBtns"></div>
    <div id="catalogPublishedLink" style="display:none;margin-top:14px;"></div>`;
  overlay.appendChild(box);
  // Publish to GitHub button
  const cfg=getConfig();
  const hasGitHub=cfg.ghToken&&cfg.ghRepo;
  if(hasGitHub){
    const ghBtn=document.createElement('button');
    ghBtn.style.cssText='display:flex;align-items:center;justify-content:center;gap:8px;width:100%;padding:13px;border:none;border-radius:12px;background:linear-gradient(135deg,#24292e,#40464d);color:white;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit;';
    ghBtn.innerHTML='☁️ Publicar en GitHub (link compartible)';
    ghBtn.onclick=async()=>{
      ghBtn.disabled=true;ghBtn.innerHTML='⏳ Publicando...';
      const publishedUrl=await publishCatalogToGitHub(html);
      if(publishedUrl){
        ghBtn.innerHTML='✅ Publicado en GitHub';
        ghBtn.style.background='var(--green)';
        const linkDiv=box.querySelector('#catalogPublishedLink');
        linkDiv.style.display='block';
        linkDiv.innerHTML=`
          <div style="font-size:11px;color:var(--gray-400);margin-bottom:6px;">Link compartible (tarda ~1 min en actualizarse):</div>
          <div style="background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:10px;font-size:12px;word-break:break-all;font-weight:600;color:var(--blue);margin-bottom:8px;">${publishedUrl}</div>
          <div style="display:flex;gap:6px;">
            <button class="btn btn-blue btn-sm" style="flex:1;" onclick="navigator.clipboard.writeText('${publishedUrl}').then(()=>showToast('Link copiado ✓'))">📋 Copiar link</button>
            <a class="btn btn-wa btn-sm" style="flex:1;text-decoration:none;display:inline-flex;align-items:center;justify-content:center;gap:4px;" href="https://wa.me/?text=${encodeURIComponent('Mira nuestro catálogo: '+publishedUrl)}" target="_blank">💬 WhatsApp</a>
          </div>`;
      } else {
        ghBtn.innerHTML='☁️ Reintentar Publicar';
        ghBtn.style.background='linear-gradient(135deg,#24292e,#40464d)';
        ghBtn.disabled=false;
      }
    };
    box.querySelector('#catalogShareBtns').appendChild(ghBtn);
  }
  // Download button
  const dlBtn=document.createElement('a');
  dlBtn.href=url;
  dlBtn.download='AXONTECH-Catalogo.html';
  dlBtn.style.cssText='display:block;padding:13px;border-radius:12px;background:linear-gradient(135deg,#006d8a,#00b4d8);color:white;font-size:14px;font-weight:700;text-decoration:none;cursor:pointer;';
  dlBtn.textContent='📥 Descargar HTML';
  // Preview button
  const pvBtn=document.createElement('button');
  pvBtn.style.cssText='padding:13px;border-radius:12px;background:var(--surface2,#f0f4f8);color:var(--text,#1a1a2e);font-size:14px;font-weight:700;border:1px solid var(--border,#e2e8f0);cursor:pointer;';
  pvBtn.textContent='👁️ Previsualizar';
  pvBtn.onclick=()=>{window.open(url,'_blank');};
  // Cancel button
  const ccBtn=document.createElement('button');
  ccBtn.style.cssText='padding:10px;border-radius:10px;background:transparent;color:var(--muted,#64748b);font-size:12px;font-weight:600;border:none;cursor:pointer;';
  ccBtn.textContent='Cerrar';
  ccBtn.onclick=()=>{overlay.remove();};
  // Close on backdrop click
  overlay.addEventListener('click',e=>{if(e.target===overlay)overlay.remove();});
  const btnsDiv=box.querySelector('#catalogShareBtns');
  btnsDiv.append(dlBtn,pvBtn,ccBtn);
  document.body.appendChild(overlay);
  // Auto-cleanup URL after 5 minutes
  setTimeout(()=>URL.revokeObjectURL(url),300000);
}
function buildCatalogCardJS(p,cat,color,waPhone){
  const pName=p.name||p.nombre||'';
  const pDesc=p.description||p.descripcion||'';
  let pPrice=p.precio||'';
  if(!pPrice && p.precioActual) pPrice = typeof p.precioActual==='number' ? '$'+p.precioActual+' USD' : p.precioActual;
  const pPhoto=p.photo||p.imagen||(p.imagenes&&p.imagenes.length?p.imagenes[0]:'')||'';
  const pGarantia=p.garantia||'';
  const esc=s=>JSON.stringify(s).replace(/<\//g,'<\\/');
  const waMsg=`Hola, me interesa el producto: ${pName}${pPrice?' - '+pPrice:''}. Esta disponible?`;
  const waLink=waPhone?`https://wa.me/${waPhone}?text=${encodeURIComponent(waMsg)}`:'';
  return `{id:${p.id},catId:${cat?cat.id:0},name:${esc(pName)},desc:${esc(pDesc)},price:${esc(pPrice)},photo:${esc(pPhoto)},catName:${esc(cat?cat.name:'')},catColor:'${color}',garantia:${esc(pGarantia)},waLink:${esc(waLink)}},`;
}

// ══════════════════════════════════════════
//  PUBLISH CATALOG TO GITHUB PAGES
// ══════════════════════════════════════════
async function publishCatalogToGitHub(htmlContent) {
  const cfg=getConfig();
  if(!cfg.ghToken||!cfg.ghRepo){showToast('Configura GitHub primero en ⚙️ Config');return null;}
  const catalogPath='catalogo.html';
  const content=btoa(unescape(encodeURIComponent(htmlContent)));
  const parts=cfg.ghRepo.split('/');const owner=parts[0];const repo=parts.slice(1).join('/');
  const url=`https://api.github.com/repos/${owner}/${repo}/contents/${catalogPath}`;
  const headers={Authorization:`token ${cfg.ghToken}`,Accept:'application/vnd.github.v3+json','Content-Type':'application/json'};
  // Get existing SHA if file exists
  let sha;
  try{const r=await fetch(url,{headers});if(r.ok){const j=await r.json();sha=j.sha;}}catch(e){}
  const body={message:`Catalogo AXONTECH ${new Date().toLocaleString('es-ES')}`,content};
  if(sha)body.sha=sha;
  const res=await fetch(url,{method:'PUT',headers,body:JSON.stringify(body)});
  if(res.ok){
    // Construct GitHub Pages URL
    const pagesUrl=`https://${owner}.github.io/${repo}/${catalogPath}`;
    return pagesUrl;
  } else {
    const err=await res.json().catch(()=>({}));
    const msg=err.message||'';
    if(res.status===401)showToast('❌ Token inválido o expirado. Genera uno nuevo en GitHub Settings → Developer settings → Personal access tokens');
    else if(res.status===404)showToast('❌ Repo no encontrado. Verifica el formato: usuario/nombre-repo');
    else if(res.status===403)showToast('❌ Sin permisos. El token necesita permiso "repo" (full control)');
    else showToast(`Error al publicar (${res.status}): ${msg}`);
    console.error('GitHub publish error:',res.status,err);
    return null;
  }
}

async function testGitHubPages() {
  const cfg=getConfig();
  const statusEl=document.getElementById('ghSyncStatus');
  if(!cfg.ghToken||!cfg.ghRepo){showToast('Configura GitHub primero');return;}
  const parts=cfg.ghRepo.split('/');const owner=parts[0];const repo=parts.slice(1).join('/');
  if(statusEl)statusEl.innerHTML='🧪 Probando conexión...';
  let results=[];
  // 1. Test repo access
  try{
    const r=await fetch(`https://api.github.com/repos/${owner}/${repo}`,{headers:{Authorization:`token ${cfg.ghToken}`,Accept:'application/vnd.github.v3+json'}});
    if(r.ok){const j=await r.json();results.push(`✅ Repo encontrado: ${j.full_name} (${j.private?'privado':'público'})`);}
    else if(r.status===401){results.push('❌ Token inválido o expirado');}
    else if(r.status===404){results.push('❌ Repo no encontrado. Verifica: '+cfg.ghRepo);}
    else{results.push(`⚠️ Repo respondió con status ${r.status}`);}
  }catch(e){results.push('❌ Error de red: '+e.message);}
  // 2. Test if catalogo.html exists in repo
  try{
    const r2=await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/catalogo.html`,{headers:{Authorization:`token ${cfg.ghToken}`,Accept:'application/vnd.github.v3+json'}});
    if(r2.ok){const j2=await r2.json();results.push(`✅ catalogo.html existe en repo (${(j2.size/1024).toFixed(1)} KB, actualizado: ${j2.updatedAt||j2.updated_at||'?'})`);}
    else{results.push('⚠️ catalogo.html NO existe en el repo. Necesitas publicar primero.');}
  }catch(e){results.push('⚠️ No se pudo verificar catalogo.html');}
  // 3. Test GitHub Pages URL
  const pagesUrl=`https://${owner}.github.io/${repo}/catalogo.html`;
  results.push(`🔗 URL del catálogo: <a href="${pagesUrl}" target="_blank" style="color:var(--blue);word-break:break-all;">${pagesUrl}</a>`);
  if(statusEl)statusEl.innerHTML=results.map(r=>`<div style="margin-bottom:3px;">${r}</div>`).join('');
}

async function publishCatalogNow() {
  const cfg=getConfig();
  const statusEl=document.getElementById('ghSyncStatus');
  if(!cfg.ghToken||!cfg.ghRepo){showToast('Configura GitHub primero');return;}
  if(statusEl)statusEl.innerHTML='☁️ Generando y publicando catálogo...';
  const html=buildCatalogHTML();
  if(!html){showToast('No hay productos con stock para publicar');if(statusEl)statusEl.innerHTML='';return;}
  const url=await publishCatalogToGitHub(html);
  if(url){
    showToast('✅ Catálogo publicado exitosamente');
    if(statusEl)statusEl.innerHTML=`✅ Publicado: <a href="${url}" target="_blank" style="color:var(--blue);word-break:break-all;">${url}</a><br><span style="font-size:10px;color:var(--gray-400);">GitHub Pages tarda ~1 min en actualizarse</span>`;
  } else {
    if(statusEl)statusEl.innerHTML='❌ Error al publicar. Revisa el token y el repo.';
  }
}
// Keep PDF export as secondary option
function exportCatalogPDF(){
  shareCatalogWeb();
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
function markCommissionEnSobre(valeId,e) {
  if(e)e.stopPropagation();
  patchVale(valeId,{commissionPaid:false,commissionStatus:'en_sobre',commissionEnSobreTs:new Date().toISOString()});
  gestoresTabDirty=true;
  renderComisiones();maybeAutoSync();
  showToast('Comisión marcada como En Sobre ✉️');
}
function markCommissionCobrado(valeId,e) {
  if(e)e.stopPropagation();
  patchVale(valeId,{commissionPaid:true,commissionStatus:'cobrado',commissionPaidTs:new Date().toISOString()});
  gestoresTabDirty=true;
  renderComisiones();maybeAutoSync();
  showToast('Comisión marcada como Cobrado 💰');
}
function payCommission(valeId,e) {
  // Legacy: kept for compatibility, now marks as cobrado
  markCommissionCobrado(valeId,e);
}
function markAllCommissionsEnSobre(gestorId,e) {
  if(e)e.stopPropagation();
  const ts=new Date().toISOString();
  getVales().filter(v=>v.gestorId===gestorId&&!v.commissionPaid&&v.commissionStatus!=='en_sobre'&&v.commissionStatus!=='cobrado'&&['confirmed','pending_payment'].includes(v.status))
    .forEach(v=>patchVale(v.id,{commissionPaid:false,commissionStatus:'en_sobre',commissionEnSobreTs:ts}));
  gestoresTabDirty=true;
  renderComisiones();maybeAutoSync();
  showToast('Todas las comisiones marcadas En Sobre ✉️');
}
function markAllCommissionsCobrado(gestorId,e) {
  if(e)e.stopPropagation();
  const ts=new Date().toISOString();
  getVales().filter(v=>v.gestorId===gestorId&&!v.commissionPaid&&['confirmed','pending_payment'].includes(v.status))
    .forEach(v=>patchVale(v.id,{commissionPaid:true,commissionStatus:'cobrado',commissionPaidTs:ts}));
  gestoresTabDirty=true;
  renderComisiones();maybeAutoSync();
  showToast('Todas las comisiones marcadas Cobrado 💰');
}
function payAllCommissions(gestorId,e) {
  // Legacy: kept for compatibility, now marks all as cobrado
  markAllCommissionsCobrado(gestorId,e);
}
function unpayCommission(valeId,e) {
  if(e)e.stopPropagation();
  patchVale(valeId,{commissionPaid:false,commissionStatus:null,commissionPaidTs:null,commissionEnSobreTs:null});
  gestoresTabDirty=true;
  renderComisiones();
}
function renderComisiones() {
  const c=document.getElementById('adminComisionesList');if(!c)return;
  const gestores=getGestores();
  if(!gestores.length){c.innerHTML='<div class="es"><div class="es-text">Sin gestores configurados</div></div>';return;}
  c.innerHTML=gestores.map(g=>{
    const allVales=getVales().filter(v=>v.gestorId===g.id&&['confirmed','pending_payment'].includes(v.status));
    // 3 states: pendientes (no status), en_sobre, cobrado
    const pendientes=allVales.filter(v=>!v.commissionPaid&&v.commissionStatus!=='en_sobre');
    const enSobre=allVales.filter(v=>v.commissionStatus==='en_sobre');
    const cobrados=allVales.filter(v=>v.commissionPaid||v.commissionStatus==='cobrado');
    const isOpen=activeComisionGestorId===g.id;
    // Compute grand total for pending + en_sobre split by currency
    const unpaid=[...pendientes,...enSobre];
    let gtUSD=0,gtMN=0,gtAllComputed=true;
    unpaid.forEach(v=>{const r=getValeCommissionParts(v);if(r.total===null){gtAllComputed=false;}else{if(r.currency==='MN')gtMN+=r.total;else gtUSD+=r.total;}});
    const gtBadgeParts=[];if(gtUSD>0)gtBadgeParts.push(`$${gtUSD.toFixed(2)} USD`);if(gtMN>0)gtBadgeParts.push(`${Math.round(gtMN)} MN`);
    const gtBadge=gtAllComputed&&gtBadgeParts.length?gtBadgeParts.join(' + '):null;
    // Summary line
    const summaryParts=[];
    if(pendientes.length)summaryParts.push(`<span style="color:var(--orange);font-weight:700;">${pendientes.length} pendiente${pendientes.length!==1?'s':''}</span>`);
    if(enSobre.length)summaryParts.push(`<span style="color:var(--yellow);font-weight:700;">✉️ ${enSobre.length} en sobre</span>`);
    if(cobrados.length)summaryParts.push(`<span style="color:var(--green);">💰 ${cobrados.length} cobrado${cobrados.length!==1?'s':''}</span>`);
    if(!summaryParts.length)summaryParts.push('Sin comisiones');
    return `<div class="card" style="padding:0;overflow:hidden;margin-bottom:8px;border-color:${isOpen?'var(--blue)':'var(--border)'};">
      <div onclick="toggleComisionGestor(${g.id})" style="display:flex;align-items:center;gap:10px;padding:12px 14px;cursor:pointer;background:${isOpen?'var(--blue-lt)':'var(--surface)'};">
        <div class="g-avatar" style="background:${g.color};width:34px;height:34px;font-size:11px;flex-shrink:0;">${escapeHTML(g.initials)}</div>
        <div style="flex:1;min-width:0;">
          <div style="font-weight:700;font-size:13px;">${escapeHTML(g.name)}</div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:1px;">
            ${summaryParts.join(' · ')}
          </div>
        </div>
        ${gtBadge?`<span style="background:var(--orange);color:white;border-radius:20px;font-size:10px;font-weight:700;padding:3px 9px;white-space:nowrap;">${gtBadge}</span>`:''}
        ${unpaid.length>0&&!gtBadge?`<span style="background:var(--orange);color:white;border-radius:20px;font-size:10px;font-weight:700;padding:3px 9px;">${unpaid.length}</span>`:''}
        <span style="color:var(--gray-400);font-size:13px;flex-shrink:0;">${isOpen?'▲':'▼'}</span>
      </div>
      ${isOpen?renderComisionBody(g,pendientes,enSobre,cobrados):''}
    </div>`;
  }).join('');
}
function renderComisionBody(g,pendientes,enSobre,cobrados) {
  let html='<div style="border-top:1px solid var(--border);padding:12px 14px;">';
  if(!pendientes.length&&!enSobre.length&&!cobrados.length){
    html+='<div class="es" style="padding:8px 0;"><div class="es-text">Sin vales confirmados con comisión</div></div>';
  } else {
    // ── PENDIENTES ──
    if(pendientes.length){
      let sumUSD=0,sumMN=0,canSum=true;
      pendientes.forEach(v=>{const r=getValeCommissionParts(v);if(r.total===null){canSum=false;}else{if(r.currency==='MN')sumMN+=r.total;else sumUSD+=r.total;}});
      const sumParts=[];if(sumUSD>0)sumParts.push(`$${sumUSD.toFixed(2)} USD`);if(sumMN>0)sumParts.push(`${Math.round(sumMN)} MN`);
      html+=`<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;flex-wrap:wrap;gap:6px;">
        <span style="font-size:11px;font-weight:700;color:var(--orange);text-transform:uppercase;letter-spacing:.5px;">⏳ Pendientes (${pendientes.length})</span>
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
          ${canSum&&sumParts.length?`<span style="font-size:13px;font-weight:800;color:var(--green);">💵 ${sumParts.join(' + ')}</span>`:''}
          ${pendientes.length>1?`<button class="btn btn-sm" style="background:var(--yellow);color:white;flex-shrink:0;" onclick="markAllCommissionsEnSobre(${g.id},event)">✉️ Todo al sobre</button>`:''}
        </div>
      </div>`;
      html+=pendientes.map(v=>{
        const r=getValeCommissionParts(v);
        return `<div style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:var(--surface2);border:1px solid var(--border);border-radius:9px;margin-bottom:6px;">
          <div style="flex:1;min-width:0;">
            <div style="font-size:12px;font-weight:700;color:var(--text);">${escapeHTML(v.cliente||'—')}</div>
            <div style="font-size:10px;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHTML(v.articulo||'—')}</div>
            <div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:4px;">
              ${r.parts.length?r.parts.map(p=>`<span style="background:rgba(16,185,129,.12);color:var(--green);border-radius:20px;padding:1px 8px;font-size:10px;font-weight:600;">${escapeHTML(p.label)}: ${escapeHTML(p.com)}</span>`).join(''):`<span style="color:var(--gray-400);font-size:10px;">Sin comisión definida</span>`}
            </div>
          </div>
          <div style="display:flex;flex-direction:column;gap:4px;flex-shrink:0;">
            <button class="btn btn-sm" style="background:var(--yellow);color:white;" onclick="markCommissionEnSobre(${v.id},event)">✉️ En sobre</button>
            <button class="btn btn-green btn-sm" onclick="markCommissionCobrado(${v.id},event)">💰 Cobrado</button>
          </div>
        </div>`;
      }).join('');
    }
    // ── EN SOBRE ──
    if(enSobre.length){
      let sumUSD=0,sumMN=0,canSum=true;
      enSobre.forEach(v=>{const r=getValeCommissionParts(v);if(r.total===null){canSum=false;}else{if(r.currency==='MN')sumMN+=r.total;else sumUSD+=r.total;}});
      const sumParts=[];if(sumUSD>0)sumParts.push(`$${sumUSD.toFixed(2)} USD`);if(sumMN>0)sumParts.push(`${Math.round(sumMN)} MN`);
      html+=`<div style="margin-top:${pendientes.length?'14px':'0'};">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;flex-wrap:wrap;gap:6px;">
          <span style="font-size:11px;font-weight:700;color:var(--yellow);text-transform:uppercase;letter-spacing:.5px;">✉️ En sobre (${enSobre.length})</span>
          <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
            ${canSum&&sumParts.length?`<span style="font-size:13px;font-weight:800;color:var(--green);">💵 ${sumParts.join(' + ')}</span>`:''}
            ${enSobre.length>1?`<button class="btn btn-green btn-sm" onclick="markAllCommissionsCobrado(${g.id},event)">💰 Cobrar todas</button>`:''}
          </div>
        </div>`;
      html+=enSobre.map(v=>{
        const r=getValeCommissionParts(v);
        const ts=v.commissionEnSobreTs?new Date(v.commissionEnSobreTs).toLocaleDateString('es-ES',{day:'2-digit',month:'short'})+' '+timeStr(v.commissionEnSobreTs):'';
        return `<div style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:rgba(245,158,11,.06);border:1px solid rgba(245,158,11,.25);border-radius:9px;margin-bottom:6px;">
          <div style="flex:1;min-width:0;">
            <div style="font-size:12px;font-weight:700;color:var(--text);">${escapeHTML(v.cliente||'—')}</div>
            <div style="font-size:10px;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHTML(v.articulo||'—')}</div>
            <div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:4px;">
              ${r.parts.length?r.parts.map(p=>`<span style="background:rgba(245,158,11,.12);color:var(--yellow);border-radius:20px;padding:1px 8px;font-size:10px;font-weight:600;">${escapeHTML(p.label)}: ${escapeHTML(p.com)}</span>`).join(''):`<span style="color:var(--gray-400);font-size:10px;">Sin comisión definida</span>`}
            </div>
          </div>
          <div style="display:flex;flex-direction:column;gap:4px;flex-shrink:0;text-align:right;">
            <span style="font-size:9px;color:var(--yellow);font-weight:700;">✉️ En sobre</span>
            ${ts?`<div style="font-size:9px;color:var(--gray-400);">${ts}</div>`:''}
            <button class="btn btn-green btn-sm" onclick="markCommissionCobrado(${v.id},event)">💰 Cobrado</button>
            <button class="btn btn-ghost btn-sm" style="font-size:10px;padding:3px 8px;color:var(--orange);" onclick="unpayCommission(${v.id},event)">↩ Pendiente</button>
          </div>
        </div>`;
      }).join('');
      html+='</div>';
    }
    // ── COBRADOS ──
    if(cobrados.length){
      html+=`<div style="margin-top:${pendientes.length||enSobre.length?'14px':'0'};">
        <div style="font-size:10px;font-weight:700;color:var(--green);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px;">💰 Cobrados (${cobrados.length})</div>`;
      html+=cobrados.map(v=>{
        const r=getValeCommissionParts(v);
        const ts=v.commissionPaidTs?new Date(v.commissionPaidTs).toLocaleDateString('es-ES',{day:'2-digit',month:'short'})+' '+timeStr(v.commissionPaidTs):'';
        return `<div style="display:flex;align-items:center;gap:8px;padding:6px 10px;background:rgba(16,185,129,.05);border:1px solid rgba(16,185,129,.2);border-radius:8px;margin-bottom:4px;opacity:.85;">
          <div style="flex:1;min-width:0;">
            <div style="font-size:11px;font-weight:600;color:var(--text-muted);">${escapeHTML(v.cliente||'—')}</div>
            ${r.parts.length?`<div style="display:flex;flex-wrap:wrap;gap:3px;margin-top:2px;">${r.parts.map(p=>`<span style="background:rgba(16,185,129,.1);color:var(--green);border-radius:20px;padding:1px 7px;font-size:9px;font-weight:600;">${escapeHTML(p.com)}</span>`).join('')}</div>`:''}
          </div>
          <div style="text-align:right;flex-shrink:0;">
            <div style="font-size:9px;color:var(--green);font-weight:700;">💰 Cobrado</div>
            ${ts?`<div style="font-size:9px;color:var(--gray-400);">${ts}</div>`:''}
            <button class="btn btn-ghost btn-sm" style="font-size:10px;padding:3px 8px;margin-top:4px;color:var(--orange);" onclick="unpayCommission(${v.id},event)">↩ Pendiente</button>
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
  const confirmedVales = getVales().filter(v=>['confirmed','pending_payment'].includes(v.status));
  // Always recalculate from actual vales to avoid stale data
  summary = gestores.map(g=>{
    const pts=confirmedVales.filter(v=>v.gestorId===g.id).reduce((sum,v)=>
      sum+(v.valeProductos||[]).reduce((s,p)=>{const pr=productoOf(p.id);return s+(pr?pr.puntos*p.qty:0);},0),0);
    return {id: g.id, pts};
  });

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
          <div class="g-avatar" style="background:${g.color};width:28px;height:28px;font-size:10px;flex-shrink:0;">${escapeHTML(g.initials)}</div>
          <span class="rank-name">${escapeHTML(g.name)}</span>
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
      expandedCatalogId=null;activeComisionGestorId=null;adminCatalogCatFilter=null;
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
  maybeAutoSync();
  showToast(`Meta fijada: ${val} puntos ⭐`);
}
function saveGhConfig() {
  const cfg=getConfig();
  cfg.ghToken=document.getElementById('gh-token').value.trim();
  cfg.ghRepo=document.getElementById('gh-repo').value.trim();
  cfg.ghPath=document.getElementById('gh-path').value.trim()||'data.json';
  cfg.ghAutoSync=document.getElementById('gh-autosync').checked;
  cfg.ghAutoPublishCatalog=document.getElementById('gh-auto-publish-catalog')?.checked||false;
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
  const autoPub=document.getElementById('gh-auto-publish-catalog');
  if(autoPub)autoPub.checked=!!cfg.ghAutoPublishCatalog;
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
    // Force Firebase delete via write queue
    _enqueueFB('vales', null, 'remove');
    // Clear ranking cache and summary so points reset to 0
    rankingCache=null;
    try { localStorage.removeItem('axon_ranking_summary'); } catch(e){}
    _enqueueFB('ranking_summary', null, 'remove');
    gestoresTabDirty=true;statsTabDirty=true;
    showToast('Todos los vales eliminados');
    selectedValeId=null;
    refreshUI();
  });
}

function changePassCfg() {
  const np=document.getElementById('newPassInputCfg').value.trim();
  if(!np||np.length<4){showToast('Mínimo 4 caracteres');return;}
  _hashPass(np).then(h => {
    localStorage.setItem('axon_admin_hash', h);
    localStorage.setItem('axon_admin_hash_legacy', btoa(np));
    document.getElementById('newPassInputCfg').value='';
    showToast('Contraseña actualizada ✓');
  });
}

// ══════════════════════════════════════════
//  GOAL CELEBRATION — EPIC GLOW PULSE
// ══════════════════════════════════════════

// Place labels and emojis
const PLACE_EMOJI=['🥇','🥈','🥉'];
const PLACE_LABEL=['¡1er Lugar!','¡2do Lugar!','¡3er Lugar!'];
const PLACE_COLOR=['#F59E0B','#94A3B8','#cd7f32'];
const PLACE_BADGE=['CAMPEÓN','SUBCAMPEÓN','TERCERO'];

// Get top 3 gestores ranked by confirmed/pending_payment points
function getTop3Ranked() {
  const gestores=getGestores();
  const confirmedVales=getVales().filter(v=>['confirmed','pending_payment'].includes(v.status));
  const ranked=gestores.map(g=>{
    const pts=confirmedVales.filter(v=>v.gestorId===g.id).reduce((sum,v)=>
      sum+(v.valeProductos||[]).reduce((s,p)=>{const pr=productoOf(p.id);return s+(pr?pr.puntos*p.qty:0);},0),0);
    return {...g,pts};
  }).sort((a,b)=>b.pts-a.pts);
  return ranked.slice(0,3);
}

// Get a specific gestor's current rank (1-based)
function getGestorRank(gestorId) {
  const gestores=getGestores();
  const confirmedVales=getVales().filter(v=>['confirmed','pending_payment'].includes(v.status));
  const ranked=gestores.map(g=>{
    const pts=confirmedVales.filter(v=>v.gestorId===g.id).reduce((sum,v)=>
      sum+(v.valeProductos||[]).reduce((s,p)=>{const pr=productoOf(p.id);return s+(pr?pr.puntos*p.qty:0);},0),0);
    return {id:g.id,pts};
  }).sort((a,b)=>b.pts-a.pts);
  const idx=ranked.findIndex(r=>r.id===gestorId);
  return idx>=0?idx+1:null;
}

// Get a specific gestor's total points
function getGestorPoints(gestorId) {
  const confirmedVales=getVales().filter(v=>v.gestorId===gestorId&&['confirmed','pending_payment'].includes(v.status));
  return confirmedVales.reduce((sum,v)=>
    sum+(v.valeProductos||[]).reduce((s,p)=>{const pr=productoOf(p.id);return s+(pr?pr.puntos*p.qty:0);},0),0);
}

// Create the glow rings background
function glowCreateRings() {
  const container=document.querySelector('.glow-rings');
  if(!container)return;
  container.innerHTML='';
  const rings=[
    {size:160,color:'#F59E0B',delay:0},
    {size:240,color:'#7C3AED',delay:.3},
    {size:320,color:'#00b4d8',delay:.6},
    {size:400,color:'#EF4444',delay:.9},
    {size:480,color:'#10B981',delay:1.2}
  ];
  rings.forEach(r=>{
    const el=document.createElement('div');
    el.className='glow-ring';
    el.style.width=r.size+'px';el.style.height=r.size+'px';
    el.style.borderColor=r.color;el.style.animationDelay=r.delay+'s';
    container.appendChild(el);
  });
}

// Celebration sound
function playCelebrationSound(){
  try{
    const ac=new(window.AudioContext||window.webkitAudioContext)();
    const notes=[523.25,659.25,783.99,1046.50];
    notes.forEach((freq,i)=>{
      const osc=ac.createOscillator();const gain=ac.createGain();
      osc.type='sine';osc.frequency.value=freq;
      gain.gain.setValueAtTime(.08,ac.currentTime+i*.12);
      gain.gain.exponentialRampToValueAtTime(.001,ac.currentTime+i*.12+.4);
      osc.connect(gain);gain.connect(ac.destination);
      osc.start(ac.currentTime+i*.12);osc.stop(ac.currentTime+i*.12+.4);
    });
  }catch(e){}
}

// Show personal ranking notification to a specific gestor
function showGestorRankNotif(gestorId, place, pts) {
  const g=gestorOf(gestorId);if(!g)return;
  const pi=Math.min(place,3)-1;
  // Remove existing rank notif
  const old=document.querySelector('.rank-notif');if(old)old.remove();
  const el=document.createElement('div');
  el.className='rank-notif';
  el.innerHTML=`
    <div class="rank-notif-icon">${PLACE_EMOJI[pi]}</div>
    <div class="rank-notif-content">
      <div class="rank-notif-place" style="color:${PLACE_COLOR[pi]}">${PLACE_LABEL[pi]}</div>
      <div class="rank-notif-text">${escapeHTML(g.name)}, ¡alcanzaste la meta!</div>
      <div class="rank-notif-pts">${pts} pts ⭐</div>
    </div>`;
  document.body.appendChild(el);
  setTimeout(()=>el.classList.add('show'),50);
  setTimeout(()=>{el.classList.remove('show');setTimeout(()=>el.remove(),600)},6000);
}

// Show ranking notification cards to ALL gestores about the top 3
function showRankNotifCards(top3) {
  top3.forEach((g,i)=>{
    const card=document.createElement('div');
    card.className='rank-notif-card';
    card.style.bottom=(20+i*90)+'px';
    card.innerHTML=`
      <div class="rank-notif-card-header">
        <div class="rank-notif-card-icon" style="background:${g.color}">${escapeHTML(g.initials)}</div>
        <div class="rank-notif-card-title" style="color:${PLACE_COLOR[i]}">${PLACE_LABEL[i]}</div>
        <div class="rank-notif-card-time">ahora</div>
      </div>
      <div class="rank-notif-card-body"><b>${escapeHTML(g.name)}</b> obtuvo <b>${PLACE_EMOJI[i]} ${PLACE_LABEL[i]}</b> con <b>${g.pts} puntos</b></div>
      <div class="rank-notif-card-place rank-place-${i+1}">${PLACE_EMOJI[i]} Puesto #${i+1}</div>`;
    document.body.appendChild(card);
    setTimeout(()=>card.classList.add('show'),(i+1)*500);
    setTimeout(()=>{card.classList.add('hide');setTimeout(()=>card.remove(),500)},7000+(i*600));
  });
}

// Send browser push notification about ranking to all devices
function sendRankingPushNotif(top3) {
  const names=top3.map((g,i)=>`${PLACE_EMOJI[i]} ${g.name} (${g.pts}pts)`).join(' | ');
  sendBrowserNotif('🏆 ¡Ranking Top 3!',names);
  // Also write to Firebase notifs for real-time sync
  top3.forEach((g,i)=>{
    addNotif('ranking_top3',g.name,null,`${PLACE_LABEL[i]}|${g.pts}|Puesto #${i+1}`,g.id);
  });
}

// EPIC GLOW PULSE — Main celebration overlay
function launchEpicGlowPulse(triggerGestor, triggerPts) {
  // Remove any existing overlay
  const existing=document.querySelector('.glow-overlay');if(existing)existing.remove();

  const top3=getTop3Ranked();
  const meta=getConfig().metaPuntos||0;

  // Build overlay HTML
  const overlay=document.createElement('div');
  overlay.className='glow-overlay';
  overlay.innerHTML=`
    <div class="glow-rings"></div>
    <button class="glow-close" onclick="closeEpicGlowPulse()">✕</button>
    <div class="glow-announcement">
      ${meta>0?`<div class="glow-meta-label">🎯 Meta: ${meta} pts</div>`:''}
      <div class="glow-title" id="glowTitle">🏆 ¡META ALCANZADA! 🏆</div>
      <div class="glow-winners-list" id="glowWinnersList">
        ${top3.map((g,i)=>`
          <div class="glow-winner-row" id="glowRow${i}" style="transition-delay:${.3+i*.25}s">
            <div class="glow-winner-place" style="color:${PLACE_COLOR[i]}">${i===0?'1°':i===1?'2°':'3°'}</div>
            <div class="glow-winner-avatar" style="background:${g.color}">${escapeHTML(g.initials)}</div>
            <div class="glow-winner-info">
              <div class="glow-winner-name">${escapeHTML(g.name)}</div>
              <div class="glow-winner-pts">${g.pts} pts${i===0&&meta>0&&g.pts>=meta?' ⭐ ¡Meta alcanzada!':''}</div>
            </div>
            <div class="glow-winner-badge glow-badge-${i+1}">${PLACE_EMOJI[i]} ${PLACE_BADGE[i]}</div>
          </div>
        `).join('')}
      </div>
    </div>`;
  document.body.appendChild(overlay);

  // Animate in
  requestAnimationFrame(()=>{
    overlay.classList.add('active');
    glowCreateRings();
    playCelebrationSound();

    // Title animation
    setTimeout(()=>{
      const title=document.getElementById('glowTitle');
      if(title)title.classList.add('show');
    },300);

    // Winner rows staggered animation
    setTimeout(()=>{
      top3.forEach((_,i)=>{
        const row=document.getElementById('glowRow'+i);
        if(row)row.classList.add('show');
      });
    },700);

    // Personal notification to the triggering gestor (on their device/view)
    if(triggerGestor){
      const rank=getGestorRank(triggerGestor.id);
      if(rank&&rank<=3){
        setTimeout(()=>showGestorRankNotif(triggerGestor.id,rank,triggerPts),1200);
      }
    }

    // Notification cards to all gestores about top 3
    setTimeout(()=>showRankNotifCards(top3),1500);

    // Push notification
    setTimeout(()=>sendRankingPushNotif(top3),1800);
  });

  // Auto-dismiss after 12 seconds
  setTimeout(()=>{if(document.querySelector('.glow-overlay.active'))closeEpicGlowPulse();},12000);
}

function closeEpicGlowPulse(){
  const overlay=document.querySelector('.glow-overlay');
  if(!overlay)return;
  overlay.classList.remove('active');
  setTimeout(()=>overlay.remove(),500);
}

// Legacy confetti kept as fallback for non-goal celebrations
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
      <div style="font-size:13px;opacity:.9;margin-top:2px;">${escapeHTML(g.name)} llegó a <b>${pts} puntos ⭐</b> — ¡Felicidades!</div>
    </div>
    <div style="background:${g.color};width:42px;height:42px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:13px;flex-shrink:0;border:2px solid rgba(255,255,255,.4);">${escapeHTML(g.initials)}</div>
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
  const pts=getGestorPoints(gestorId);
  if(pts>=meta){
    // Celebrate only if THIS sale crossed the threshold (exclude current vale from prev total)
    const vales=getVales().filter(v=>v.gestorId===gestorId&&['confirmed','pending_payment'].includes(v.status));
    const prev=vales.filter(v=>v.id!==currentValeId).reduce((sum,v)=>sum+(v.valeProductos||[]).reduce((s,p)=>{const pr=productoOf(p.id);return s+(pr?pr.puntos*p.qty:0);},0),0);
    if(prev<meta){
      // EPIC GLOW PULSE — Full-screen celebration
      launchEpicGlowPulse(g,pts);
    }
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
  const v=getVales().find(x=>x.id===id);if(!v)return;
  // Allow reverting both 'confirmed' and 'pending_payment' states
  if(v.status!=='confirmed'&&v.status!=='pending_payment'){showToast('Solo se puede revertir una venta confirmada o pendiente de cobro');return;}
  if(!skipConfirm) {
    const targetLabel=v.status==='confirmed'?'Pendiente (enviado)':'Entregado';
    showConfirmAction('¿Revertir venta?',`${v.cliente||''} volverá a "${targetLabel}" · Stock restaurado`,'Revertir','btn-orange',()=>revertConfirmSale(id,true));
    return;
  }
  // Restore stock for each product that was decremented when the sale was confirmed
  (v.valeProductos||[]).forEach(({id:pid,qty})=>{
    const prod=productoOf(pid);if(!prod)return;
    const restored=Math.max(0,(prod.stock||0)+qty);
    patchProducto(pid,{stock:restored});
  });
  // Revert to appropriate previous state:
  // - If it had a mensajero assigned and was delivered before, go back to 'delivered'
  // - Otherwise go back to 'pending' (original state)
  const prevStatus=(v.mensajeroId&&v.deliveredTs)?'delivered':'pending';
  patchVale(id,{status:prevStatus,confirmedTs:null,commissionPaid:false,commissionStatus:null,commissionPaidTs:null,commissionEnSobreTs:null});
  gestoresTabDirty=true;statsTabDirty=true;rankingCache=null;
  renderAdminGestores();renderValeDetail();
  renderConfirmados();renderPendienteCobro();
  renderGestorRanking();renderProductGrid();
  if(currentAdminTab==='gestores'){renderComisiones();}
  if(currentAdminTab==='catalog'){renderAdminCatalogCats();renderAdminCatalog();}
  maybeAutoSync();
  showToast(prevStatus==='delivered'?'Venta revertida a "Entregado" — stock restaurado':'Venta revertida a "Pendiente" — stock restaurado');
}

// ══════════════════════════════════════════
//  HISTORIAL
// ══════════════════════════════════════════
function renderHistorial() {
  const fromEl=document.getElementById('histDateFrom');
  const toEl=document.getElementById('histDateTo');
  const gestorEl=document.getElementById('histGestorFilter');
  const searchEl=document.getElementById('histSearchPhone');
  const c=document.getElementById('historialList');
  if(!c) return;
  // Populate gestor filter
  const gestores=getGestores();
  const curGFilter=gestorEl?gestorEl.value:'';
  if(gestorEl){
    gestorEl.innerHTML=`<option value="">Todos los gestores</option>`+gestores.map(g=>`<option value="${g.id}">${escapeHTML(g.name)}</option>`).join('');
    gestorEl.value=curGFilter;
  }
  let vales=getVales().reverse();
  const from=fromEl?fromEl.value:'';
  const to=toEl?toEl.value:'';
  const search=searchEl?searchEl.value.trim().toLowerCase():'';
  if(from)vales=vales.filter(v=>v.ts.slice(0,10)>=from);
  if(to)  vales=vales.filter(v=>v.ts.slice(0,10)<=to);
  if(curGFilter)vales=vales.filter(v=>String(v.gestorId)===curGFilter);
  // Search by phone, client name, or vale number
  if(search){
    vales=vales.filter(v=>{
      const phone=(v.telefono||'').toLowerCase().replace(/[\s\-()]/g,'');
      const cliente=(v.cliente||'').toLowerCase();
      const valeNum=v.valeNum?String(v.valeNum):'';
      const art=(v.articulo||'').toLowerCase();
      const searchClean=search.replace(/[\s\-()]/g,'');
      return phone.includes(searchClean)||cliente.includes(search)||valeNum.includes(search)||art.includes(search)||(valeNumStr(v).toLowerCase().includes(search));
    });
  }
  if(!vales.length){c.innerHTML='<div class="es"><div class="es-icon">📭</div><div class="es-text">'+(search?'Sin resultados para "'+escapeHTML(search)+'"':'Sin vales en el periodo seleccionado')+'</div></div>';return;}
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
      const estafaMatch=checkEstafaMatch(v);
      const estafaBorder=estafaMatch.length?'border-left:3px solid var(--red);':'';
      const estafaTag=estafaMatch.length?'<span style="background:var(--red);color:white;border-radius:6px;padding:1px 5px;font-size:8px;font-weight:700;margin-left:3px;">🚫</span>':'';
      html+=`<div class="card" style="padding:8px 12px;margin-bottom:5px;cursor:pointer;display:flex;align-items:center;gap:10px;${estafaBorder}" onclick="selectValeFromHistorial(${v.id})">
        <div style="flex-shrink:0;">
          <div class="g-avatar" style="background:${g?g.color:'#888'};width:28px;height:28px;font-size:10px;">${g?escapeHTML(g.initials):'?'}</div>
        </div>
        <div style="flex:1;min-width:0;">
          <div style="font-size:12px;font-weight:700;">${valeNumStr(v)?`<span style="color:var(--blue);">${valeNumStr(v)}</span> `:''}${escapeHTML(v.cliente||'—')}${estafaTag}</div>
          <div style="font-size:10px;color:var(--gray-400);">${v.telefono?escapeHTML(v.telefono)+' · ':''}${g?escapeHTML(g.name):'—'} · ${timeStr(v.ts)}</div>
        </div>
        <div style="text-align:right;flex-shrink:0;">
          <span class="sp ${s.cls}" style="font-size:9px;">${s.label}</span>
          <div style="font-size:11px;font-weight:700;color:var(--blue);margin-top:2px;">${escapeHTML(v.total||'')}</div>
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





async function nukeAndRebuild() {
  if(!confirm("¿Estás seguro? Esto borrará Firebase entero y cargará la base limpia.")) return;
  try {
    showToast("Descargando data.json limpio...");
    const res = await fetch('./data.json?t=' + Date.now());
    if(!res.ok) throw new Error("No se pudo leer data.json");
    const data = await res.json();
    
    showToast("Borrando Firebase completamente...");
    await db.ref('/').remove();
    
    showToast("Vaciando memoria del navegador...");
    localStorage.clear();
    
    showToast("Inyectando base de datos limpia...");
    const updates = {};
    if(data.gestores) {
       localStorage.setItem('axon_gestores', JSON.stringify(data.gestores));
       updates['gestores'] = data.gestores;
    }
    if(data.mensajeros) {
       localStorage.setItem('axon_mensajeros', JSON.stringify(data.mensajeros));
       updates['mensajeros'] = data.mensajeros;
    }
    if(data.productos) {
       localStorage.setItem('axon_productos', JSON.stringify(data.productos));
       updates['productos'] = data.productos;
    }
    if(data.categorias) {
       localStorage.setItem('axon_categorias', JSON.stringify(data.categorias));
       updates['categorias'] = data.categorias;
    }
    updates['vales'] = null; // Ensure vales are empty
    updates['notifs'] = null;
    updates['ranking_summary'] = null;
    
    await db.ref('/').update(updates);
    
    showToast("¡Listo! Recargando...");
    setTimeout(() => { window.location.href = './admin.html'; }, 1500);
  } catch(e) {
    alert("Error: " + e.message);
  }
}

async function loadInitialData() {
  if (getGestores().length === 0 && getProductos().length === 0) {
    try {
      const res = await fetch('./data.json?t=' + Date.now());
      if (res.ok) {
        const data = await res.json();
        _syncCount++;
        if (data.gestores) localStorage.setItem('axon_gestores', JSON.stringify(data.gestores));
        if (data.mensajeros) localStorage.setItem('axon_mensajeros', JSON.stringify(data.mensajeros));
        if (data.productos) localStorage.setItem('axon_productos', JSON.stringify(data.productos));
        if (data.categorias) localStorage.setItem('axon_categorias', JSON.stringify(data.categorias));
        _syncCount--;
        
        if (IS_ADMIN) {
           const localGestores = getGestores();
           if(localGestores.length > 0) {
              db.ref('gestores').set(localGestores);
              db.ref('mensajeros').set(getMensajeros());
           }
        }
      }
    } catch(e) {}
  }
}


// ══════════════════════════════════════════
//  UNSENT FORM WARNING & KEYBOARD SHORTCUTS
// ══════════════════════════════════════════
function isFormDirty() {
  if (!activeGestorId) return false;
  return REQUIRED.some(id => fVal(id).length > 0) || 
    ['vf-mensajeria','vf-precioUSD','vf-precioMN','vf-vuelto','vf-garantia'].some(id => fVal(id).length > 0);
}

// Warn before navigating away from a dirty form
window.addEventListener('beforeunload', (e) => {
  if (isFormDirty()) {
    e.preventDefault();
    e.returnValue = '';
  }
});

// Escape key closes modals
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    const openModal = document.querySelector('.modal-bg.show');
    if (openModal) openModal.classList.remove('show');
  }
});

// ══════════════════════════════════════════
//  ADMIN VALE GENERATOR
// ══════════════════════════════════════════
let adminValeProductos = [];
let adminPickerSelected = {};
let adminPickerCatFilter = null;

function openAdminValeModal() {
  const sel = document.getElementById('av-gestor');
  const gestores = getGestores();
  sel.innerHTML = '<option value="">— Seleccionar —</option>' +
    '<option value="0">👤 Admin</option>' +
    gestores.map(g => `<option value="${g.id}">${escapeHTML(g.name)}</option>`).join('');

  ['av-cliente','av-telefono','av-direccion','av-mensajeria','av-articulo',
   'av-precioUSD','av-precioMN','av-vuelto','av-total','av-garantia','av-comisionGestor'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  adminValeProductos = [];
  adminPickerSelected = {};
  const spList = document.getElementById('av-selectedProductsList');
  if (spList) spList.style.display = 'none';
  document.getElementById('av-previewCard').style.display = 'none';
  const btn = document.getElementById('av-sendBtn');
  if (btn) { btn.disabled = true; btn.textContent = '📤 Generar Vale'; }

  document.getElementById('adminValeModal').classList.add('show');
}

function closeAdminValeModal() {
  document.getElementById('adminValeModal').classList.remove('show');
}

const avVal = id => (document.getElementById(id)?.value || '').trim();

function onAdminValeInput() {
  const activeId = document.activeElement?.id;
  if (['av-mensajeria', 'av-precioUSD', 'av-precioMN'].includes(activeId)) {
    calcAdminAutoTotal();
  }
  const REQUIRED_AV = ['av-gestor','av-cliente','av-telefono','av-direccion','av-articulo','av-total'];
  const allFilled = REQUIRED_AV.every(id => avVal(id).length > 0);
  const btn = document.getElementById('av-sendBtn');
  if (btn) btn.disabled = !allFilled;

  const anyFilled = REQUIRED_AV.some(id => avVal(id).length > 0) ||
    ['av-mensajeria','av-precioUSD','av-precioMN','av-vuelto','av-garantia','av-comisionGestor'].some(id => avVal(id).length > 0);

  const pc = document.getElementById('av-previewCard');
  if (pc) {
    if (avVal('av-gestor') && anyFilled) {
      pc.style.display = 'block';
      document.getElementById('av-previewText').textContent = buildAdminValeText();
    } else {
      pc.style.display = 'none';
    }
  }
}

function calcAdminAutoTotal() {
  const pUSD = document.getElementById('av-precioUSD')?.value || '';
  const pMN = document.getElementById('av-precioMN')?.value || '';
  const mens = document.getElementById('av-mensajeria')?.value || '';
  let usdTotal = 0, mnTotal = 0;
  const addVal = (str) => {
    const s = str.toUpperCase();
    const num = parsePrecioNum(s);
    if (num === 0) return;
    if (s.includes('MN') || s.includes('CUP')) mnTotal += num;
    else if (s.includes('USD') || s.includes('ZELLE')) usdTotal += num;
    else if (s.includes('$')) usdTotal += num;
    else { if (num > 500) mnTotal += num; else usdTotal += num; }
  };
  addVal(pUSD); addVal(pMN); addVal(mens);
  let out = [];
  if (usdTotal > 0) out.push(`$${usdTotal} USD`);
  if (mnTotal > 0) out.push(`${mnTotal} MN`);
  const totalInput = document.getElementById('av-total');
  if (out.length > 0 && totalInput) { totalInput.value = out.join(' + '); }
  else if (totalInput && !pUSD && !pMN && !mens) { totalInput.value = ''; }
}

function buildAdminValeText() {
  const gId = parseInt(avVal('av-gestor'));
  const g = gestorOf(gId);
  const prodLines = adminValeProductos.length
    ? adminValeProductos.map(p => `  ×${p.qty} ${p.name}`).join('\n')
    : avVal('av-articulo');
  return ['Bienvenido a "AXONTECH" 🔥', '', 'VALE DEL GESTOR:', '',
    `🔸Promotor: ${g ? g.name : ''}`, '',
    `🔸 Nombre Cliente: ${avVal('av-cliente')}`,
    `🔸Teléfono Cliente: ${avVal('av-telefono')}`,
    `🔸Dirección Cliente: ${avVal('av-direccion')}`,
    avVal('av-carnet') ? `🪪 Carnet: ${avVal('av-carnet')}` : '',
    `🔸Mensajería/ costo: ${avVal('av-mensajeria')}`,
    `🔸 Artículos y cantidades:`, prodLines,
    `🔸Precio USD/ zelle: ${avVal('av-precioUSD')}`,
    `🔸Precio MN: ${avVal('av-precioMN')}`,
    `🔸 Vuelto: ${avVal('av-vuelto')}`,
    `🔸 Total a pagar: ${avVal('av-total')}`, '',
    `*Garantía: ${avVal('av-garantia')}`,
    `*Fecha y hora de Venta: ${nowDateTime()}`, '',
    '🧭Dirección de la tienda:', '* Amistad #311 % San Rafael y San José, Centro Habana.', '',
    '🚨ATENCIÓN🚨', '•   Horarios de atención al cliente:', '    9:00am - 7:00pm.',
    '* Solo aceptamos hasta cinco billetes de 1 USD por compra.',
    '* Los pagos en MN deben ser con denominación de 50 en adelante.',
    '* Solo se aceptan billetes en buen estado (ni rotos ni manchados)'
  ].join('\n');
}

let _isSendingAdminVale = false;
function sendAdminVale() {
  if (_isSendingAdminVale) return;
  const REQUIRED_AV = ['av-gestor','av-cliente','av-telefono','av-direccion','av-articulo','av-total'];
  if (REQUIRED_AV.some(id => !avVal(id))) { showToast('Completa los campos obligatorios (*)'); return; }
  _isSendingAdminVale = true;
  const btn = document.getElementById('av-sendBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Generando...'; }
  const gId = parseInt(avVal('av-gestor'));
  const g = gestorOf(gId);
  const vale = {
    id: Date.now(), valeNum: getNextValeNum(), gestorId: gId,
    ts: new Date().toISOString(), cliente: avVal('av-cliente'),
    telefono: avVal('av-telefono'), direccion: avVal('av-direccion'), carnet: avVal('av-carnet'),
    mensajeria: avVal('av-mensajeria'), articulo: avVal('av-articulo'),
    precioUSD: avVal('av-precioUSD'), precioMN: avVal('av-precioMN'),
    vuelto: avVal('av-vuelto'), total: avVal('av-total'),
    garantia: avVal('av-garantia'), comisionGestor: avVal('av-comisionGestor'),
    valeProductos: adminValeProductos, valeText: buildAdminValeText(),
    status: 'pending', mensajeroId: null, confirmedTs: null,
    isNew: true, adminNotes: 'Generado por Admin',
  };
  const all = getVales(); all.push(vale); saveVales(all);
  if (typeof fbAddVale === 'function') fbAddVale(vale);
  renderAdminGestores(); renderValeDetail(); updateAdminBadge();
  playSound('vale');
  showToast(`Vale ${valeNumStr(vale)} generado para ${g ? g.name : 'gestor'} ✓`);
  closeAdminValeModal();
  _isSendingAdminVale = false;
  maybeAutoSync();
}

function openAdminProductPicker() {
  if (!getProductos().length) { showToast('No hay productos cargados'); return; }
  adminPickerSelected = {};
  adminValeProductos.forEach(p => { adminPickerSelected[p.id] = p.qty; });
  adminPickerCatFilter = null;
  const searchEl = document.getElementById('av-pickerSearch');
  if (searchEl) searchEl.value = '';
  renderAdminPickerCatTabs(); renderAdminPickerProducts(); renderAdminPickerSelected();
  document.getElementById('adminProductPickerModal').classList.add('show');
}
function closeAdminProductPicker() { document.getElementById('adminProductPickerModal').classList.remove('show'); }

function renderAdminPickerCatTabs() {
  const cats = getCategorias(); const el = document.getElementById('av-pickerCatTabs');
  if (!el) return;
  el.innerHTML = `<button class="pcat-tab ${adminPickerCatFilter===null?'active':''}" onclick="setAdminPickerCat(null)">Todos</button>` +
    cats.map(c=>`<button class="pcat-tab ${adminPickerCatFilter===c.id?'active':''}" onclick="setAdminPickerCat(${c.id})">${escapeHTML(c.name)}</button>`).join('');
}
function setAdminPickerCat(id) { adminPickerCatFilter=id; renderAdminPickerCatTabs(); renderAdminPickerProducts(); }

const _apcCatColors=['#006d8a','#7c3aed','#dc2626','#059669','#d97706','#2563eb','#be185d','#475569','#0ea5e9','#f97316','#14b8a6','#84cc16'];
function _apcGetCatColor(catId){
  const cats=getCategorias(); const idx=cats.findIndex(c=>c.id===catId);
  return idx>=0?_apcCatColors[idx%_apcCatColors.length]:'#64748b';
}
function _apcGetCatName(catId){
  const c=getCategorias().find(x=>x.id===catId);
  return c?c.name:'Otro';
}

function renderAdminPickerProducts() {
  const searchEl = document.getElementById('av-pickerSearch');
  const search = searchEl ? searchEl.value.toLowerCase() : '';
  let prods = getProductos();
  if (adminPickerCatFilter!==null) prods=prods.filter(p=>p.catId===adminPickerCatFilter);
  if (search) prods=prods.filter(p=>p.name.toLowerCase().includes(search)||(p.description||'').toLowerCase().includes(search));
  const grid = document.getElementById('av-pickerProductGrid'); if(!grid)return;
  if(!prods.length){grid.innerHTML='<div style="text-align:center;padding:30px 10px;color:var(--gray-400);"><div style="font-size:32px;margin-bottom:8px;opacity:.4;">📦</div><div style="font-size:13px;">No se encontraron productos</div></div>';return;}
  grid.innerHTML = prods.map(p=>{
    const qty=adminPickerSelected[p.id]||0; const sel=qty>0;
    const catColor=_apcGetCatColor(p.catId);
    const catName=_apcGetCatName(p.catId);
    return `<div class="apcard${sel?' picked':''}">
      <div class="apcard-info">
        <div class="apcard-name"><span class="apcard-cat" style="background:${catColor}">${escapeHTML(catName)}</span>${escapeHTML(p.name)}${p.garantia?`<span class="apcard-garantia">🛡️ ${escapeHTML(p.garantia)}</span>`:''}</div>
        ${p.precio?`<div class="apcard-price">${escapeHTML(p.precio)}</div>`:''}
      </div>
      <div class="apcard-controls">
        <button class="btn-minus" onclick="event.stopPropagation();setAdminPickerQty(${p.id},-1)">−</button>
        <span class="qty-val">${qty}</span>
        <button class="btn-plus" onclick="event.stopPropagation();setAdminPickerQty(${p.id},1)">+</button>
      </div>
    </div>`;
  }).join('');
}

function toggleAdminPickerProd(pid) {
  if(adminPickerSelected[pid]){delete adminPickerSelected[pid];}else{adminPickerSelected[pid]=1;}
  renderAdminPickerProducts(); renderAdminPickerSelected();
}
function setAdminPickerQty(pid, delta) {
  let q=(adminPickerSelected[pid]||0)+delta;
  if(q<=0){delete adminPickerSelected[pid];}else{adminPickerSelected[pid]=q;}
  renderAdminPickerProducts(); renderAdminPickerSelected();
}
function renderAdminPickerSelected() {
  const el = document.getElementById('av-pickerSelectedList'); if(!el)return;
  const items = Object.entries(adminPickerSelected).map(([id,qty])=>{
    const p=productoOf(parseInt(id)); return p?{id:parseInt(id),name:p.name,qty,precio:p.precio||''}:null;
  }).filter(Boolean);
  if(!items.length){el.innerHTML='<div style="font-size:12px;color:var(--gray-400);">Ningún producto seleccionado</div>';return;}
  el.innerHTML = items.map(i=>`<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;padding:4px 8px;background:var(--blue-lt);border-radius:8px;">
    <span style="font-weight:800;color:var(--blue);min-width:18px;">${i.qty}×</span>
    <span style="flex:1;font-size:12px;font-weight:600;">${escapeHTML(i.name)}</span>
    ${i.precio?`<span style="font-size:11px;color:var(--blue);font-weight:700;">${escapeHTML(i.precio)}</span>`:''}
    <button onclick="setAdminPickerQty(${i.id},-1)" style="width:22px;height:22px;border-radius:50%;border:1px solid var(--gray-200);background:var(--surface);cursor:pointer;font-weight:700;color:var(--red);font-size:13px;display:flex;align-items:center;justify-content:center;">−</button>
    <button onclick="setAdminPickerQty(${i.id},1)" style="width:22px;height:22px;border-radius:50%;border:1px solid var(--gray-200);background:var(--surface);cursor:pointer;font-weight:700;color:var(--green);font-size:13px;display:flex;align-items:center;justify-content:center;">+</button>
  </div>`).join('');
}

function confirmAdminPickerSelection() {
  const items = Object.entries(adminPickerSelected).map(([id,qty])=>{
    const p=productoOf(parseInt(id)); return {id:parseInt(id),name:p?p.name:id,qty};
  });
  adminValeProductos = items;
  document.getElementById('av-articulo').value = items.map(i=>`×${i.qty} ${i.name}`).join(' / ');
  let total=0; let cur='USD';
  items.forEach(({id,qty})=>{ const p=productoOf(id); if(!p||!p.precio)return; total+=parsePrecioNum(p.precio)*qty; if(p.precio.includes('MN'))cur='MN'; });
  if(total>0){
    const fmt=`$${total} ${cur}`;
    if(cur==='MN'){document.getElementById('av-precioMN').value=fmt;document.getElementById('av-precioUSD').value='';}
    else{document.getElementById('av-precioUSD').value=fmt;document.getElementById('av-precioMN').value='';}
    calcAdminAutoTotal();
  }
  if(!document.getElementById('av-garantia').value){
    const g=items.map(({id})=>productoOf(id)?.garantia).find(Boolean);
    if(g)document.getElementById('av-garantia').value=g;
  }
  const spList=document.getElementById('av-selectedProductsList');
  if(spList&&items.length){
    spList.style.display='block';
    spList.innerHTML=`<div style="display:flex;flex-direction:column;gap:4px;margin-bottom:6px;">`+
      items.map(i=>`<div style="display:flex;align-items:center;gap:6px;">
        <span style="font-weight:800;color:var(--blue);font-size:12px;">×${i.qty}</span>
        <span style="font-size:11px;">${escapeHTML(i.name)}</span>
      </div>`).join('')+`</div>`;
  } else if(spList){spList.style.display='none';}
  closeAdminProductPicker(); onAdminValeInput();
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
