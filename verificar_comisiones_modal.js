// ¿Se actualiza la lista de gestores SIN recargar la página?
const { chromium }=require('playwright');
const http=require('http'), fs=require('fs'), path=require('path');
const RAIZ='/home/user/AXONTECH';
const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json'};
const srv=http.createServer((q,r)=>{const p=path.join(RAIZ,decodeURIComponent(q.url.split('?')[0]));
  if(!fs.existsSync(p)||fs.statSync(p).isDirectory()){r.writeHead(404);return r.end();}
  r.writeHead(200,{'Content-Type':MIME[path.extname(p)]||'text/plain'});r.end(fs.readFileSync(p));});

(async()=>{
  await new Promise(r=>srv.listen(0,'127.0.0.1',r));
  const nav=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
  const ctx=await nav.newContext();
  await ctx.route('**/*',r=>r.request().url().includes('127.0.0.1')?r.continue():r.fulfill({status:200,body:'[]'}));
  const pag=await ctx.newPage();
  const err=[]; pag.on('pageerror',e=>err.push(String(e.message).slice(0,150)));
  await pag.goto(`http://127.0.0.1:${srv.address().port}/admin.html`,{waitUntil:'domcontentloaded'});
  await pag.waitForTimeout(2500);

  const r=await pag.evaluate(()=>{
    try{clearInterval(_restPollTimer);}catch(e){}
    saveGestores([{id:1,name:'Ana',initials:'A',color:'#111'},
                  {id:2,name:'Beto',initials:'B',color:'#222'},
                  {id:3,name:'Cris',initials:'C',color:'#333'}]);
    saveProductos([{id:9,name:'P',puntos:1,comision:'$10 USD',precio:'$50 USD',stock:9}]);
    const mk=(id,gid)=>({id,gestorId:gid,status:'confirmed',ts:'2026-08-20T10:00:00Z',
                         cliente:'C'+id,articulo:'P',valeProductos:[{id:9,qty:1}]});
    saveVales([mk(1,1), mk(2,2),mk(3,2),mk(4,2), mk(5,3),mk(6,3)]);
    adminTab('gestores'); renderAdminGestoresList();
    const orden=()=>[...document.querySelectorAll('#adminGestoresPanel-list .gp-card')]
      .map(c=>c.dataset.gestorId);
    // Lo que enseña la fila de comisiones de Beto en la lista de detrás
    const chapaBeto=()=>{const c=document.querySelector('.gp-card[data-gestor-id="2"] .gp-card-com');
      return c?c.textContent.replace(/\s+/g,' ').trim():'(sin tarjeta)';};
    const out={ordenInicial:orden(), chapa0:chapaBeto()};
    toggleComisionGestor(2);
    // Cobrar una de Beto
    document.querySelector('#comisionesModalBody button[onclick^="markCommissionCobrado"]').click();
    out.chapa1=chapaBeto();
    out.orden1=orden();
    // Ahora REVERTIR esa misma ("↩ Pendiente")
    const rev=document.querySelector('#comisionesModalBody button[onclick^="unpayCommission"]');
    out.hayBotonRevertir=!!rev;
    if(rev) rev.click();
    out.chapa2=chapaBeto();
    out.orden2=orden();
    out.modalAbierto=document.getElementById('comisionesGestorModal').classList.contains('show');
    closeComisionesModal();
    out.ordenAlCerrar=orden();
    return out;
  });
  console.log('orden inicial                 :', r.ordenInicial.join(' · '));
  console.log('chapa de Beto en la lista     :', r.chapa0);
  console.log('\n── se cobra una desde el modal ──');
  console.log('chapa de Beto AHORA           :', r.chapa1);
  console.log('¿se actualizó sola?           :', r.chapa1!==r.chapa0?'✅ sí, sin recargar':'❌ NO — hay que recargar');
  console.log('¿la lista se movió?           :', JSON.stringify(r.orden1)===JSON.stringify(r.ordenInicial)?'✅ no':'❌ se reordenó');
  console.log('\n── se REVIERTE (↩ Pendiente) ──');
  console.log('¿existe el botón revertir?    :', r.hayBotonRevertir?'✅ sí':'❌ no');
  console.log('chapa de Beto AHORA           :', r.chapa2);
  console.log('¿volvió a lo de antes?        :', r.chapa2===r.chapa0?'✅ sí':'❌ quedó en "'+r.chapa2+'"');
  console.log('¿la lista se movió?           :', JSON.stringify(r.orden2)===JSON.stringify(r.ordenInicial)?'✅ no':'❌ se reordenó');
  console.log('¿el modal sigue abierto?      :', r.modalAbierto?'✅ sí':'❌ se cerró');
  console.log('orden al cerrar               :', r.ordenAlCerrar.join(' · '));
  if(err.length) console.log('\nerrores:', [...new Set(err)].slice(0,3).join(' | '));
  await nav.close(); srv.close();
})().catch(e=>{console.error(e);process.exit(1);});
