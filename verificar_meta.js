// Ejecuta checkGoalReached / getGestorPoints / getTop3Ranked REALES de app.js
// sobre una secuencia de ventas. No simula la lógica: la corre.
const fs=require('fs');
const JS=fs.readFileSync('/home/user/AXONTECH/app.js','utf8');
function ex(n){const i=JS.search(new RegExp('function\\s+'+n+'\\s*\\('));if(i<0)throw new Error('falta '+n);let p=0,d=false;for(let j=i;j<JS.length;j++){const c=JS[j];if(c==='{'){p++;d=true;}else if(c==='}'){p--;if(d&&p===0)return JS.slice(i,j+1);}}}

const META=10;
const prods={9:{id:9,name:'Router',puntos:4}, 8:{id:8,name:'TV',puntos:25}};
let gestores=[{id:101,name:'Ana',initials:'A',color:'#111'},{id:102,name:'Luis',initials:'L',color:'#222'}];
let vales=[];
global.getConfig=()=>({metaPuntos:META});
global.getVales=()=>vales;
global.getGestores=()=>gestores;
global.gestorOf=id=>gestores.find(g=>g.id===id)||null;
global.productoOf=id=>prods[id]||null;
let guardado=[];
global.guardarGestores=(lista,ids)=>{gestores=lista;guardado.push(ids);};
global.addNotif=(t,n,p,extra,gid)=>{avisos.push({t,gid,extra});};
global.renderGestorRanking=()=>{};
let animaciones=[], avisos=[];
global.launchEpicGlowPulse=(g,pts)=>{animaciones.push(g.id);};
global.gestoresTabDirty=false; global.rankingCache=null;

const api=new Function("let gestoresTabDirty=false,rankingCache=null;\n"
  +ex('getGestorPointsTotal')+'\n'+ex('getGestorPoints')+'\n'+ex('checkGoalReached')+'\n'+ex('getTop3Ranked')+'\n'
  +'return {getGestorPoints,getGestorPointsTotal,checkGoalReached,getTop3Ranked};')();

function vender(gid,prod,n){
  for(let i=0;i<(n||1);i++){
    const id=Date.now()+Math.floor(vales.length*7+i);
    vales.push({id,gestorId:gid,status:'confirmed',valeProductos:[{id:prod,qty:1}]});
    api.checkGoalReached(gid,id);
  }
}

console.log(`Meta = ${META} pts · cada venta de Router da 4 pts\n`);
console.log('venta   puntos (ciclo)   total de siempre   metas   ¿animación?');
for(let i=1;i<=6;i++){
  const antes=animaciones.length;
  vender(101,9,1);
  const g=api.getGestorPoints(101), t=api.getGestorPointsTotal(101);
  const m=gestores.find(x=>x.id===101).metasLogradas||0;
  console.log(`  ${String(i).padEnd(6)} ${String(g).padStart(8)}${g>=META?' (≥meta)':'        '} ${String(t).padStart(12)} ${String(m).padStart(9)}      ${animaciones.length>antes?'✅ sí':'—'}`);
}
console.log(`\nanimaciones en 6 ventas : ${animaciones.length}  (antes: 1, y nunca más)`);
console.log(`metas logradas          : ${gestores.find(x=>x.id===101).metasLogradas}`);
console.log(`avisos al gestor        : ${avisos.filter(a=>a.t==='meta_alcanzada').length} de tipo meta_alcanzada`);
console.log(`se subió solo su ficha  : ${JSON.stringify(guardado[0])}`);

console.log('\n── el sobrante no se pierde ──');
vales=[]; gestores=[{id:101,name:'Ana',initials:'A',color:'#111'}]; animaciones=[];
vender(101,8,1);   // una venta de 25 pts con meta 10
const g=gestores[0];
console.log(`venta de 25 pts con meta 10 → cierra ${g.metasLogradas} ciclos, canjea ${g.puntosCanjeados}`);
console.log(`puntos del ciclo nuevo: ${api.getGestorPoints(101)}   ← 25 − 20, el resto se queda`);
console.log(`¿queda por debajo de la meta?`, api.getGestorPoints(101)<META?'✅ sí':'❌ NO');

console.log('\n── el ranking usa los puntos del ciclo ──');
vales=[]; gestores=[{id:101,name:'Ana',initials:'A',color:'#111',puntosCanjeados:100,metasLogradas:10},
                    {id:102,name:'Luis',initials:'L',color:'#222'}];
vender(101,9,1);           // Ana: 104 de siempre, 4 del ciclo
vender(102,9,2);           // Luis: 8 de siempre, 8 del ciclo
const top=api.getTop3Ranked();
console.log('  de siempre → Ana '+api.getGestorPointsTotal(101)+', Luis '+api.getGestorPointsTotal(102));
console.log('  del ciclo  → '+top.map(t=>t.name+' '+t.pts).join(' · '));
console.log('  gana quien va mejor ESTE ciclo:', top[0].name==='Luis'?'✅ Luis':'❌ '+top[0].name);
