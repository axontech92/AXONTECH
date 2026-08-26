// Ejecuta el alta de dueños y el corte REALES de app.js.
const fs=require('fs');
const JS=fs.readFileSync('/home/user/AXONTECH/app.js','utf8');
function ex(n){const i=JS.search(new RegExp('function\\s+'+n+'\\s*\\('));if(i<0)throw new Error('falta '+n);let p=0,d=false;for(let j=i;j<JS.length;j++){const c=JS[j];if(c==='{'){p++;d=true;}else if(c==='}'){p--;if(d&&p===0)return JS.slice(i,j+1);}}}

const els={}; const mk=id=>(els[id]={id,innerHTML:'',value:'',style:{},classList:{_s:new Set(),add(c){this._s.add(c)},remove(c){this._s.delete(c)},contains(c){return this._s.has(c)}}});
['duenosAviso','duenosResumen','duenosLista','duenosDateFrom','duenosDateTo','duenoModal','duenoModalBody','duenoModalTitle','duenoModalSub','duenosPagarCard','duenosPagarCount','duenosListaCount'].forEach(mk);
global.document={getElementById:id=>els[id]||null,querySelectorAll:()=>[]};
global.localStorage={_d:{},getItem(k){return this._d[k]||null;},setItem(k,v){this._d[k]=v;}};
global._safeSetLS=(k,v)=>localStorage.setItem(k,v);
global.setSB=()=>{}; global.showToast=()=>{}; global.maybeAutoSync=()=>{};
global.escapeHTML=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;');
global.localDay=ts=>String(new Date(ts).toISOString()).slice(0,10);
global._rebajaVale=v=>v._rebaja?{rebajaTxt:'x'}:null;
global.valeNumStr=v=>'#'+v.id;
const prods={
 1:{id:1,name:'TV',    precio:'$200 USD', comision:'$10 USD'},
 2:{id:2,name:'Ventil',precio:'$50 USD',  comision:'$5 USD'},
 3:{id:3,name:'Olla',  precio:'8000 MN',  comision:'400 MN'},
 4:{id:4,name:'Cable', precio:'$10 USD',  comision:'$1 USD'},
};
global.getProductos=()=>Object.values(prods);
global.productoOf=id=>prods[id]||null;
global.esValeDeLaTienda=v=>v.gestorId===0||v.gestorId==='0';
const gestores={11:{id:11,name:'Ana'},12:{id:12,name:'Luis'}};
global.gestorOf=id=>gestores[id]||null;
global.getValeCommissionParts=v=>{let usd=0,mn=0;
  (v.valeProductos||[]).forEach(({id,qty})=>{const p=prods[id];if(!p||!p.comision)return;
    const n=parseFloat(p.comision.replace(/[^0-9.]/g,''))||0;
    if(/MN|CUP/i.test(p.comision))mn+=n*qty;else usd+=n*qty;});
  return {totalUSD:usd,totalMN:mn,parts:[]};};
const V=(id,gid,items,extra)=>Object.assign({id,gestorId:gid,status:'confirmed',
  ts:'2026-08-26T12:00:00Z',cliente:'Cli'+id,valeProductos:items},extra||{});
let vales=[
  V(1,11,[{id:1,qty:1}]),                 // Ana: TV Pedro    $200 / com $10
  V(2,12,[{id:2,qty:2}]),                 // Luis: 2 Ventil Pedro $100 / com $10
  V(3,11,[{id:3,qty:1}]),                 // Ana: Olla María  8000 MN / com 400 MN
  V(4,0, [{id:1,qty:1}]),                 // TIENDA: TV Pedro $200 / SIN comisión
  V(5,11,[{id:1,qty:1},{id:3,qty:1}]),    // vale con DOS dueños
  V(6,11,[{id:4,qty:1}]),                 // producto sin dueño
];
global.getVales=()=>vales;

const code="const IS_ADMIN=true;\n"
 +"const _SIN_DUENO='__tienda__';\n"
 +"const _claveDueno = n => String(n||'').trim().toLowerCase().replace(/\\s+/g,' ');\n"
 +"let _duenosCache=null,_duenosDirty=true;\n"
 +ex('_normalizarDocDuenos')+'\n'+ex('getDuenosDoc')+'\n'+ex('_guardarDuenos')+'\n'
 +ex('listaDuenos')+'\n'
 +"const duenoPorId = id => getDuenosDoc().lista.find(d=>d.id===Number(id))||null;\n"
 +"const duenoIdDe = pid => { const v=getDuenosDoc().asig[String(pid)]; return v==null?null:Number(v); };\n"
 +ex('addDueno')+'\n'+ex('renameDueno')+'\n'+ex('removeDueno')+'\n'+ex('setDuenoProducto')+'\n'+ex('productosDeDueno')+'\n'
 +ex('parsePrecioNum')+'\n'+ex('_montoMonedas')+'\n'+ex('_fmtDosMonedas')+'\n'
 +ex('_lineasPorDueno')+'\n'+ex('_valesDelCorte')+'\n'+ex('renderDuenos')+'\n'
 +ex('openDuenoModal')+'\n'+ex('closeDuenoModal')+'\n'+ex('renderDuenoModal')+'\n'
 +"let _duenoModalId=null;\n"
 +"return {addDueno,renameDueno,removeDueno,setDuenoProducto,listaDuenos,duenoIdDe,duenoPorId,getDuenosDoc,_lineasPorDueno,renderDuenos,openDuenoModal,renderDuenoModal,productosDeDueno};";
const api=new Function(code)();

console.log('── ALTA DE DUEÑOS ──────────────────────────');
const pedro=api.addDueno('Pedro'), maria=api.addDueno('María');
console.log('agregados        :', api.listaDuenos().map(d=>d.id+':'+d.nombre).join(' · '));
api.addDueno('  pedro  ');
console.log('no duplica       :', api.listaDuenos().length===2?'✅ siguen 2':'❌ '+api.listaDuenos().length);
api.setDuenoProducto(1,pedro.id); api.setDuenoProducto(2,pedro.id); api.setDuenoProducto(3,maria.id);
console.log('producto 1 es de :', api.duenoPorId(api.duenoIdDe(1)).nombre);
console.log('producto 4 (sin) :', api.duenoIdDe(4)===null?'✅ de la tienda':'❌');

console.log('\n── MIGRACIÓN DEL FORMATO VIEJO ─────────────');
localStorage.setItem('axon_duenos',JSON.stringify({'1':'Pedro','2':'pedro','3':'María'}));
const api2=new Function(code)();
console.log('doc viejo → lista:', api2.listaDuenos().map(d=>d.nombre).join(' · '), api2.listaDuenos().length===2?'✅ 2 dueños':'❌');
console.log('"Pedro" y "pedro" son el mismo :', api2.duenoIdDe(1)===api2.duenoIdDe(2)?'✅ sí':'❌ no');

console.log('\n── EL CORTE ────────────────────────────────');
localStorage.setItem('axon_duenos',JSON.stringify({lista:[{id:1,nombre:'Pedro'},{id:2,nombre:'María'}],asig:{'1':1,'2':1,'3':2}}));
const api3=new Function(code)();
els.duenosDateFrom.value='2026-08-26'; els.duenosDateTo.value='2026-08-26';
api3.renderDuenos();
const t=s=>els[s].innerHTML.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
console.log('RESUMEN :', t('duenosResumen'));
const {porDueno}=api3._lineasPorDueno(vales);
const P=porDueno.get('1'), M=porDueno.get('2'), T=porDueno.get('__tienda__');
console.log('\nPedro   vendido USD 700 / MN 0 :', P.ventaUSD===700&&P.ventaMN===0?'✅':'❌ '+P.ventaUSD+'/'+P.ventaMN);
console.log('Pedro   comisión USD 30 / MN 0 :', P.comUSD===30&&P.comMN===0?'✅':'❌ '+P.comUSD+'/'+P.comMN);
console.log('María   vendido USD 0 / MN 16000:', M.ventaUSD===0&&M.ventaMN===16000?'✅':'❌ '+M.ventaUSD+'/'+M.ventaMN);
console.log('María   comisión USD 0 / MN 800 :', M.comUSD===0&&M.comMN===800?'✅':'❌ '+M.comUSD+'/'+M.comMN);
console.log('¿se mezclaron las monedas?      :', (P.ventaMN||M.ventaUSD)?'❌ SÍ':'✅ no, cada una por su lado');
console.log('venta de la tienda sin comisión :', P.lineas.find(l=>l.esTienda).comUSD===0?'✅':'❌');

console.log('\n── EL MODAL DE UN DUEÑO ────────────────────');
api3.openDuenoModal('2');
console.log('título   :', els.duenoModalTitle.textContent);
console.log('subtítulo:', els.duenoModalSub.textContent);
const cuerpo=els.duenoModalBody.innerHTML;
console.log('sale "Debe pagar" con Ana :', /Comisiones que debe pagar[\s\S]*Ana[\s\S]*400 MN/.test(cuerpo.replace(/<[^>]+>/g,' '))?'✅':'❌');
console.log('lista sus vales           :', (cuerpo.match(/#\d/g)||[]).join(',')||'(ninguno)');
console.log('el importe NO va en USD   :', /\$/.test(cuerpo.replace(/[^$]*Vales/,''))?'❌ hay $':'✅ solo MN');

console.log('\n── BORRAR UN DUEÑO ─────────────────────────');
console.log('productos de Pedro antes :', api3.productosDeDueno(1).length);
api3.removeDueno(1);
console.log('tras borrarlo, productos quedan sin dueño :', api3.duenoIdDe(1)===null&&api3.duenoIdDe(2)===null?'✅ sí':'❌');
console.log('el producto sigue en el catálogo         :', productoOf(1)?'✅ sí':'❌ se borró');
console.log('María sigue                              :', api3.listaDuenos().map(d=>d.nombre).join(',')||'(ninguno)');
