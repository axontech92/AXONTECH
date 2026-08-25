// Ejecuta markAllCommissionsCobrado / markAllCommissionsEnSobre REALES.
const fs=require('fs');
const JS=fs.readFileSync('/home/user/AXONTECH/app.js','utf8');
function ex(n){const i=JS.search(new RegExp('function\\s+'+n+'\\s*\\('));if(i<0)throw new Error('falta '+n);let p=0,d=false;for(let j=i;j<JS.length;j++){const c=JS[j];if(c==='{'){p++;d=true;}else if(c==='}'){p--;if(d&&p===0)return JS.slice(i,j+1);}}}
let vales=[];
global.getVales=()=>vales;
global.saveVales=v=>{vales=v;};
global.renderComisiones=()=>{}; global.maybeAutoSync=()=>{};
global.showToast=m=>console.log('   toast:',m);
global.gestoresTabDirty=false;
const api=new Function("let gestoresTabDirty=false;\n"+ex('_valeGeneraComision')+'\n'+ex('_comisionesDe')+'\n'
  +ex('markAllCommissionsEnSobre')+'\n'+ex('markAllCommissionsCobrado')
  +'return {markAllCommissionsEnSobre,markAllCommissionsCobrado,_comisionesDe};')();

const reset=()=>{vales=[
  {id:1,gestorId:9,status:'confirmed',commissionStatus:'en_sobre'},
  {id:2,gestorId:9,status:'confirmed',commissionStatus:'en_sobre'},
  {id:3,gestorId:9,status:'confirmed'},                                  // pendiente
  {id:4,gestorId:9,status:'confirmed'},                                  // pendiente
  {id:5,gestorId:9,status:'confirmed',commissionPaid:true,commissionStatus:'cobrado'},
  {id:8,gestorId:7,status:'confirmed'},                                  // de OTRO gestor
];};
const foto=()=>{const r=api._comisionesDe(9);
  return `pendientes ${r.pendientes.length} · en sobre ${r.enSobre.length} · cobradas ${r.cobrados.length}`;};

reset();
console.log('estado de partida        :', foto());
console.log('\n── "💰 Cobrar las del sobre" ──');
api.markAllCommissionsCobrado(9);
console.log('después                  :', foto());
const r=api._comisionesDe(9);
console.log('¿las 2 pendientes siguen pendientes? ', r.pendientes.length===2?'✅ sí':'❌ NO — se cobraron sin pasar por el sobre');
console.log('¿quedan 3 cobradas (2+1)?            ', r.cobrados.length===3?'✅ sí':'❌ '+r.cobrados.length);
console.log('¿tocó al gestor 7?                   ', vales.find(v=>v.id===8).commissionStatus?'❌ SÍ':'✅ no');

console.log('\n── "✉️ Todo al sobre" y luego cobrar ──');
reset();
api.markAllCommissionsEnSobre(9);
console.log('tras mandar al sobre     :', foto());
api.markAllCommissionsCobrado(9);
console.log('tras cobrar el sobre     :', foto());
console.log('¿ahora sí se cobra todo? ', api._comisionesDe(9).pendientes.length===0?'✅ sí':'❌');

console.log('\n── sin nada en el sobre ──');
reset(); vales.forEach(v=>{if(v.commissionStatus==='en_sobre')v.commissionStatus=null;});
api.markAllCommissionsCobrado(9);
console.log('estado                   :', foto(), api._comisionesDe(9).cobrados.length===1?'✅ no tocó nada':'❌ cobró algo');
