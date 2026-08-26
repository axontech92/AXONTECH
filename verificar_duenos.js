// Ejecuta _lineasPorDueno y renderDuenos REALES de app.js.
const fs=require('fs');
const JS=fs.readFileSync('/home/user/AXONTECH/app.js','utf8');
function ex(n){const i=JS.search(new RegExp('function\\s+'+n+'\\s*\\('));if(i<0)throw new Error('falta '+n);let p=0,d=false;for(let j=i;j<JS.length;j++){const c=JS[j];if(c==='{'){p++;d=true;}else if(c==='}'){p--;if(d&&p===0)return JS.slice(i,j+1);}}}

const els={}; const mk=id=>(els[id]={id,innerHTML:'',value:'',style:{}});
['duenosAviso','duenosResumen','duenosLista','duenosDateFrom','duenosDateTo'].forEach(mk);
global.document={getElementById:id=>els[id]||null};
global.localStorage={_d:{},getItem(k){return this._d[k]||null;},setItem(k,v){this._d[k]=v;}};
global.escapeHTML=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;');
global.localDay=ts=>String(new Date(ts).toISOString()).slice(0,10);
global.tasaUSDFinal=()=>400;
global._rebajaVale=v=>v._rebaja?{rebajaTxt:'x'}:null;
global.valeNumStr=v=>'#'+v.id;

// Catálogo: 1 y 2 son de Pedro, 3 de María, 4 es tuyo (sin dueño)
const prods={
 1:{id:1,name:'TV',      precio:'$200 USD', comision:'$10 USD'},
 2:{id:2,name:'Ventil',  precio:'$50 USD',  comision:'$5 USD'},
 3:{id:3,name:'Olla',    precio:'8000 MN',  comision:'400 MN'},
 4:{id:4,name:'Cable',   precio:'$10 USD',  comision:'$1 USD'},
 5:{id:5,name:'Sin precio',precio:'',       comision:''},
};
global.productoOf=id=>prods[id]||null;
const duenos={'1':'Pedro','2':'Pedro','3':'María','5':'Pedro'};
global.getDuenos=()=>duenos;
global.esValeDeLaTienda=v=>v.gestorId===0||v.gestorId==='0';
const gestores={11:{id:11,name:'Ana'},12:{id:12,name:'Luis'}};
global.gestorOf=id=>gestores[id]||null;

const V=(id,gid,items,extra)=>Object.assign({id,gestorId:gid,status:'confirmed',
  ts:'2026-08-26T12:00:00Z',valeProductos:items},extra||{});
let vales=[
  V(1,11,[{id:1,qty:1}]),                       // Ana vende TV de Pedro     $200 / com $10
  V(2,12,[{id:2,qty:2}]),                       // Luis vende 2 Ventil Pedro $100 / com $10
  V(3,11,[{id:3,qty:1}]),                       // Ana vende Olla María   8000MN=$20 / com 400MN=$1
  V(4,0, [{id:1,qty:1}]),                       // LA TIENDA vende TV Pedro  $200 / SIN comisión
  V(5,11,[{id:1,qty:1},{id:3,qty:1}]),          // un vale con DOS dueños
  V(6,11,[{id:4,qty:1}]),                       // producto tuyo
  V(7,11,[{id:5,qty:1}]),                       // producto sin precio
  V(8,11,[{id:2,qty:1}],{_rebaja:true}),        // vale con rebaja
  V(9,11,[{id:1,qty:1}],{ts:'2026-07-01T12:00:00Z'}), // fuera de fecha
  Object.assign(V(10,11,[{id:1,qty:1}]),{status:'pending'}),   // no confirmado
];
global.getVales=()=>vales;
global.getValeCommissionParts=v=>{
  let usd=0,mn=0;
  (v.valeProductos||[]).forEach(({id,qty})=>{const p=prods[id];if(!p||!p.comision)return;
    const n=parseFloat(p.comision.replace(/[^0-9.]/g,''))||0;
    if(/MN|CUP/i.test(p.comision))mn+=n*qty;else usd+=n*qty;});
  return {totalUSD:usd,totalMN:mn,parts:[]};
};

const code=ex('parsePrecioNum')+'\n'+ex('_montoMonedas')+'\n'+ex('_aUSD')+'\n'
  +"const _fmtUSD = n => (n===null||n===undefined||!isFinite(n))?'—':(n<0?'−':'')+'$'+Math.abs(n).toLocaleString('es-ES',{maximumFractionDigits:2});\n"
  +"const _SIN_DUENO='__tienda__';\nconst _claveDueno = n => String(n||'').trim().toLowerCase().replace(/\\s+/g,' ');\n"
  +"const duenoDe = pid => String(getDuenos()[String(pid)] || '');\n"
  +ex('_lineasPorDueno')+'\n'+ex('renderDuenos')+'\n'
  +'return {_lineasPorDueno,renderDuenos};';
const api=new Function(code)();

els.duenosDateFrom.value='2026-08-26'; els.duenosDateTo.value='2026-08-26';
api.renderDuenos();

const txt=s=>els[s].innerHTML.replace(/<[^>]+>/g,'|').replace(/\|+/g,' | ').replace(/\s+/g,' ').trim();
console.log('── RESUMEN ─────────────────────────────────');
console.log(txt('duenosResumen').slice(0,200));
console.log('\n── POR DUEÑO ───────────────────────────────');
els.duenosLista.innerHTML.split('margin-bottom:14px').slice(1).forEach(b=>{
  const cab=(b.match(/>([🏪🧑‍💼][^<]*)</)||[])[1]||'?';
  const nums=(b.match(/vendido[\s\S]*?queda[^<]*<b[^>]*>([^<]*)</)||[]);
  const linea=b.slice(0,900).replace(/<[^>]+>/g,'|').replace(/\|+/g,' ').replace(/\s+/g,' ');
  console.log('  '+cab.trim());
  console.log('     '+linea.match(/vendido [^·]*· comisiones [^·]*· queda [^ ]*/)?.[0]);
  const debe=b.match(/Debe pagar a:([\s\S]*?)<\/div>/);
  if(debe)console.log('     paga a: '+debe[1].replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim());
});
console.log('\n── COMPROBACIONES ──────────────────────────');
const {porDueno}=api._lineasPorDueno(vales.filter(v=>v.status==='confirmed'&&v.ts.startsWith('2026-08-26')));
const p=porDueno.get('pedro'), m=porDueno.get('maría'), t=porDueno.get('__tienda__');
const suma=(g,k)=>g.lineas.reduce((s,l)=>s+l[k],0);
// Pedro, a mano: TV 200 + Ventil×2 100 + TV tienda 200 + TV del vale mixto 200
//                + sin-precio 0 + Ventil con rebaja 50  = 750
// comisiones:      10  +  10          +   0 (tienda)   +  10  + 0 + 5 = 35
console.log('Pedro vendido  $750 esperado :', suma(p,'venta')===750?'✅ $750':'❌ $'+suma(p,'venta'));
console.log('Pedro comisión  $35 esperado :', suma(p,'comision')===35?'✅ $35':'❌ $'+suma(p,'comision'));
console.log('María vendido   $40 esperado :', suma(m,'venta')===40?'✅ $40':'❌ $'+suma(m,'venta'));
console.log('venta de la TIENDA sin comisión:', p.lineas.find(l=>l.esTienda).comision===0?'✅ 0':'❌');
console.log('el vale mixto se parte en dos :', p.lineas.filter(l=>l.valeId===5).length===1&&m.lineas.filter(l=>l.valeId===5).length===1?'✅ sí':'❌ no');
console.log('claves del mapa               :', JSON.stringify([...porDueno.keys()]));
console.log('producto sin dueño va aparte  :', t&&t.propia?'✅ "Mercancía de la tienda"':'❌ t='+JSON.stringify(t));
console.log('vale de julio excluido        :', !p.lineas.some(l=>l.valeId===9)?'✅ sí':'❌ se coló');
console.log('vale pendiente excluido       :', !p.lineas.some(l=>l.valeId===10)?'✅ sí':'❌ se coló');
console.log('avisa de rebaja y sin precio  :', /rebaja/.test(els.duenosAviso.innerHTML)&&/sin precio/.test(els.duenosAviso.innerHTML)?'✅ sí':'❌');
