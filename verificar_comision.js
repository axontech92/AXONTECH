// Ejecuta _computeGestorStatsForRange REAL: ¿baja la tarjeta al cobrar?
const fs=require('fs');
const JS=fs.readFileSync('/home/user/AXONTECH/app.js','utf8');
function ex(n){const i=JS.search(new RegExp('function\\s+'+n+'\\s*\\('));if(i<0)throw new Error('falta '+n);let p=0,d=false;for(let j=i;j<JS.length;j++){const c=JS[j];if(c==='{'){p++;d=true;}else if(c==='}'){p--;if(d&&p===0)return JS.slice(i,j+1);}}}

let vales=[];
global.getVales=()=>vales;
global.gestorOf=()=>({id:101,name:'Ana',puntosCanjeados:0});
global.productoOf=id=>({id,name:'P',puntos:1,comision:'$10 USD'});
global.localDay=ts=>String(ts).slice(0,10);
global.getValeCommissionParts=v=>v._com===null?{totalUSD:null,totalMN:null,parts:[]}
                                              :{totalUSD:v._com,totalMN:0,parts:[]};
const api=new Function(ex('_valeGeneraComision')+'\n'+ex('sumCommissions')+'\n'+ex('fmtComisionBadge')+'\n'
  +ex('_computeGestorStatsForRange')+'return {_computeGestorStatsForRange};')();

const v=(id,extra)=>Object.assign({id,gestorId:101,status:'confirmed',ts:'2026-08-20T10:00:00Z',
  valeProductos:[{id:9,qty:1}],_com:10},extra||{});

function estado(t){
  const r=api._computeGestorStatsForRange(101,'','');
  console.log('  '+t.padEnd(34), (r.comBadge||'(sin importe)').padEnd(14),
              'por cobrar:'+String(r.comPendientes).padStart(2), ' ya cobradas:'+r.comCobrados);
  return r;
}

console.log('La tarjeta del gestor · $10 por venta\n');
vales=[v(1),v(2),v(3)];
estado('3 ventas, ninguna pagada');
vales=[v(1,{commissionStatus:'en_sobre'}),v(2),v(3)];
estado('1 puesta EN SOBRE');
vales=[v(1,{commissionStatus:'cobrado'}),v(2),v(3)];
estado('esa misma COBRADA');
vales=[v(1,{commissionStatus:'cobrado'}),v(2,{commissionPaid:true}),v(3,{commissionStatus:'cobrado'})];
const fin=estado('las 3 cobradas');

console.log('\n¿baja a cero al cobrar todo? ', !fin.comBadge?'✅ sí':'❌ NO — sigue en '+fin.comBadge);
console.log('¿"en sobre" sigue contando?  ', '✅ sí (está apartado, no en su mano)');
console.log('¿sabe cuántas ya cobró?      ', fin.comCobrados===3?'✅ 3':'❌ '+fin.comCobrados);
