/*!
 * kiu-avatar.js — Avatar animado de Kiu (37 estados, SVG + CSS, sin dependencias).
 * Se aísla con Shadow DOM: no choca con app.css ni con avatar.js.
 *
 *   <div id="kiu-avatar"></div>
 *   <script src="js/kiu-avatar.js"></script>
 *   <script>
 *     const av = KiuAvatar.mount('#kiu-avatar', {size: 160});
 *     av.set('thinking');        // alias corto
 *     av.set('Descargando');     // o nombre exacto del estado
 *   </script>
 *
 * API: KiuAvatar.mount(el|selector, {size, state}) -> {set, get, pause, resume, destroy}
 *      KiuAvatar.states  -> lista de los 37 estados
 *      KiuAvatar.alias   -> alias cortos (idle, thinking, speaking, ...)
 *
 * v2.8.0: quién manda sobre el estado. kiu-avatar.js SOLO pinta. El estado lo
 * decide KiuState (js/kiu-estados.js), por capas y prioridad, a partir de eventos
 * explícitos. KiuAvatar.set/hold/flash quedan como API de pintado; para cambiar el
 * estado del bot hay que hablar con KiuState.
 */
(function(global){
'use strict';
var CSS=".bot{position:relative;width:190px;height:209px;margin:2px auto 10px;--c1:#ffb08a;--c2:#f0603f;--gl:#ffe9a8}\n.bot svg{width:100%;height:100%;overflow:visible;filter:drop-shadow(0 8px 14px color-mix(in srgb,var(--c2) 35%,transparent))}\n.bot .la{--s:1;transform-origin:38px 124px}.bot .ra{--s:-1;transform-origin:162px 124px}\n.bot .ant{transform-origin:100px 44px}.bot .bd{transform-origin:100px 199px}\n.bot .bulb,.bot .eye,.bot .mo,.bot .sp,.bot .pl{transform-box:fill-box;transform-origin:center}\n.bot .bulb{filter:drop-shadow(0 0 6px var(--gl))}\n.bot .eye{animation:bl 4.5s infinite}\n.bot{transform-origin:100px 205px}\n/* cuerpo */\n.b-fl{animation:fl 4s ease-in-out infinite}.b-nd{animation:nd 1.2s ease-in-out infinite}.b-sw{animation:sw 2s ease-in-out infinite}.b-sd{animation:sd 2.4s ease-in-out infinite}\n.b-tk{animation:tk 1s steps(1) infinite}.b-bn{animation:bn .8s ease-out infinite}.b-wk{animation:wk .5s ease-in-out infinite}.b-tr{animation:tr .12s linear infinite}\n.b-bw{animation:bw 2s ease-in-out infinite}.b-jp{animation:jp 1s ease-out infinite}.b-sh{animation:sh 1.6s infinite}.b-no{animation:no .5s ease-in-out infinite}\n.b-ro{animation:ro 2.2s ease-in-out infinite}.b-sq{animation:sq 3s ease-in-out infinite}.b-sk{animation:sk 4s ease-in-out infinite}.b-hp{animation:hp .6s ease-out infinite}\n.b-tw{animation:tw 2.4s ease-in-out infinite}.b-pu{animation:pu 1s ease-in-out infinite}.b-br{animation:br 3.5s ease-in-out infinite}.b-ds{animation:ds .7s ease-in-out infinite}\n.b-jt{animation:jt .2s linear infinite}.b-zg{animation:zg 1.2s ease-in-out infinite}.b-ld{animation:ld 3s ease-in-out infinite}.b-ls{animation:ls 3s ease-in-out infinite}\n.b-vb{animation:vb .08s linear infinite}.b-tb{animation:tb .45s ease-in-out infinite alternate}.b-cr{animation:cr 1.2s ease-in-out infinite}.b-rb{animation:rb 2.4s ease-out infinite}\n@keyframes fl{50%{transform:translateY(calc(var(--u,1)*-6px))}}@keyframes nd{50%{transform:translateY(calc(var(--u,1)*3px)) rotate(3deg)}}@keyframes sw{25%{transform:translateX(calc(var(--u,1)*-4px)) rotate(-2deg)}75%{transform:translateX(calc(var(--u,1)*4px)) rotate(2deg)}}\n@keyframes sd{50%{transform:translateX(calc(var(--u,1)*12px))}0%,100%{transform:translateX(calc(var(--u,1)*-12px))}}@keyframes tk{0%{transform:rotate(-5deg)}50%{transform:rotate(5deg)}}\n@keyframes bn{50%{transform:translateY(calc(var(--u,1)*-12px))}}@keyframes wk{25%{transform:rotate(-6deg)}75%{transform:rotate(6deg)}}@keyframes tr{50%{transform:translateX(calc(var(--u,1)*1.4px))}}\n@keyframes bw{50%{transform:rotate(7deg) scaleY(.97)}}@keyframes jp{30%{transform:translateY(calc(var(--u,1)*-24px)) scale(.95,1.08)}60%{transform:translateY(0) scale(1.06,.94)}}\n@keyframes sh{5%{transform:translateX(calc(var(--u,1)*-7px))}15%{transform:translateX(calc(var(--u,1)*7px))}25%{transform:translateX(calc(var(--u,1)*-5px))}35%{transform:translateX(calc(var(--u,1)*5px))}45%{transform:none}}\n@keyframes no{25%{transform:rotate(-8deg)}75%{transform:rotate(8deg)}}@keyframes ro{25%{transform:rotate(-10deg)}75%{transform:rotate(10deg)}}\n@keyframes sq{50%{transform:scale(1.05,.92)}}@keyframes sk{30%,70%{transform:translateY(calc(var(--u,1)*8px)) scale(1.03,.94)}}@keyframes hp{40%{transform:translateY(calc(var(--u,1)*-7px))}}\n@keyframes tw{40%{transform:scaleX(-1)}50%{transform:scaleX(-1)}90%{transform:scaleX(1)}}@keyframes pu{50%{transform:scale(1.05)}}@keyframes br{50%{transform:scale(1.02,.985)}}\n@keyframes ds{25%{transform:rotate(-7deg) translateY(calc(var(--u,1)*-5px))}75%{transform:rotate(7deg) translateY(calc(var(--u,1)*-5px))}}@keyframes jt{25%{transform:translate(calc(var(--u,1)*2px),calc(var(--u,1)*-1px))}75%{transform:translate(calc(var(--u,1)*-2px),calc(var(--u,1)*1px))}}\n@keyframes zg{25%{transform:translateX(calc(var(--u,1)*9px)) rotate(5deg)}75%{transform:translateX(calc(var(--u,1)*-9px)) rotate(-5deg)}}@keyframes ld{50%{transform:translateY(calc(var(--u,1)*-3px)) scale(1.04)}}\n@keyframes ls{0%,100%{transform:rotate(6deg)}50%{transform:rotate(6deg) scale(1.03)}}@keyframes vb{50%{transform:translate(calc(var(--u,1)*3px),calc(var(--u,1)*-2px)) rotate(3deg)}}\n@keyframes tb{to{transform:translateY(calc(var(--u,1)*-4px)) rotate(1.5deg)}}@keyframes cr{50%{transform:scale(.96) rotate(-3deg)}}@keyframes rb{0%{transform:scaleY(.6)}40%{transform:scaleY(1.07)}60%,100%{transform:none}}\n/* bot pequeno (<60px, esquina/chat/perfil): el cuerpo se queda en su sitio y solo flota suave;\n   el estado se lee por cara, brazos, antena y objeto, no por desplazamientos laterales */\n.bot.mini.b-sd,.bot.mini.b-sw,.bot.mini.b-zg,.bot.mini.b-sh,.bot.mini.b-tr,.bot.mini.b-jt,.bot.mini.b-vb,.bot.mini.b-wk,.bot.mini.b-tb,.bot.mini.b-no,.bot.mini.b-ro,.bot.mini.b-tk,.bot.mini.b-ds,.bot.mini.b-tw{animation:fl 4s ease-in-out infinite}\n/* brazos */\n.A-wv{animation:aw 1.5s ease-in-out infinite}.A-up{transform:rotate(calc(var(--s)*130deg))}.A-ch{animation:ac .5s ease-in-out infinite alternate}.A-pt{transform:rotate(calc(var(--s)*75deg))}\n.A-ea{transform:rotate(calc(var(--s)*150deg))}.A-ty{animation:at .25s ease-in-out infinite alternate}.A-fp{animation:af .3s ease-in-out infinite alternate}.A-lf{animation:al 1.6s ease-in-out infinite}\n.A-sg{animation:as 1s ease-in-out infinite}.A-st{transform:rotate(calc(var(--s)*105deg))}.A-no{animation:an .45s ease-in-out infinite alternate}.A-gs{animation:ag .6s ease-in-out infinite alternate}\n.ra[class*=A-]{animation-delay:.15s}\n@keyframes aw{0%,100%{transform:rotate(calc(var(--s)*30deg))}50%{transform:rotate(calc(var(--s)*75deg))}}@keyframes ac{from{transform:rotate(calc(var(--s)*110deg))}to{transform:rotate(calc(var(--s)*145deg))}}\n@keyframes at{from{transform:rotate(calc(var(--s)*8deg))}to{transform:rotate(calc(var(--s)*24deg))}}@keyframes af{from{transform:rotate(calc(var(--s)*10deg))}to{transform:rotate(calc(var(--s)*65deg))}}\n@keyframes al{0%,100%{transform:rotate(calc(var(--s)*20deg))}50%{transform:rotate(calc(var(--s)*115deg))}}@keyframes as{50%{transform:rotate(calc(var(--s)*62deg))}0%,100%{transform:rotate(calc(var(--s)*55deg))}}\n@keyframes an{from{transform:rotate(calc(var(--s)*40deg))}to{transform:rotate(calc(var(--s)*75deg))}}@keyframes ag{from{transform:rotate(calc(var(--s)*25deg))}to{transform:rotate(calc(var(--s)*60deg))}}\n/* antena */\n.a-tl{animation:tl 1.6s ease-in-out infinite}.a-up .bulb{transform:scale(1.3)}.a-dr{transform:rotate(-40deg)}.a-dr .bulb{opacity:.45}.a-wg{animation:wg .3s ease-in-out infinite alternate}\n.a-pl .bulb{animation:bp .7s ease-in-out infinite alternate}.a-sp{animation:tl 1s ease-in-out infinite}.a-sp .bulb{animation:bp .4s ease-in-out infinite alternate}\n@keyframes tl{50%{transform:rotate(14deg)}}@keyframes wg{from{transform:rotate(-12deg)}to{transform:rotate(12deg)}}@keyframes bp{to{transform:scale(1.35);opacity:.6}}\n/* cara */\n.ey-scan{animation:es 1.4s ease-in-out infinite alternate}.ey-tick{animation:et 1s steps(1) infinite}\n.sp{animation:sn 2.4s linear infinite}.pl{animation:bp .8s ease-in-out infinite alternate}.mo{animation:tk2 .3s ease-in-out infinite alternate}\n@keyframes bl{0%,92%,100%{transform:scaleY(1)}96%{transform:scaleY(.1)}}@keyframes es{from{transform:translateX(-6px)}to{transform:translateX(6px)}}\n@keyframes et{0%{transform:translateX(-5px)}50%{transform:translateX(5px)}}@keyframes sn{to{transform:rotate(360deg)}}@keyframes tk2{to{transform:scaleY(.3)}}\n.dp{animation:dp 1.4s ease-in infinite}@keyframes dp{0%{transform:translateY(0);opacity:1}100%{transform:translateY(16px);opacity:0}}\n.dt{animation:dt 1s infinite}.dt.d2{animation-delay:.2s}.dt.d3{animation-delay:.4s}@keyframes dt{40%{transform:translateY(-4px)}}\n/* objetos (fx) */\n#fx *{transform-box:fill-box}\n#fx.m-spin{transform-origin:center;transform-box:fill-box;animation:sn 2.4s linear infinite}#fx.m-pulse{transform-box:fill-box;transform-origin:center;animation:bp .8s ease-in-out infinite alternate}\n#fx.m-bob{animation:fl 2s ease-in-out infinite}#fx.m-blink{animation:fd .9s steps(1) infinite}#fx.m-shake{animation:wg .15s linear infinite alternate}\n#fx.m-pop{transform-box:fill-box;transform-origin:center;animation:pp 1.6s ease-out infinite}#fx.m-ring{transform-box:fill-box;transform-origin:50% 0;animation:rn2 .3s ease-in-out infinite alternate}\n#fx.m-glow{animation:gl 1.6s ease-in-out infinite}#fx.m-fade{animation:fd2 2s ease-in-out infinite}\n@keyframes pp{0%{transform:scale(0)}25%{transform:scale(1.15)}40%,100%{transform:scale(1)}}@keyframes fd{50%{opacity:.15}}@keyframes fd2{50%{opacity:.35}}\n@keyframes rn2{from{transform:rotate(-14deg)}to{transform:rotate(14deg)}}@keyframes gl{50%{filter:drop-shadow(0 0 8px var(--gl))}}\n.ap{animation:ap 2s infinite}@keyframes ap{0%,100%{opacity:0;transform:translateY(-8px)}30%,80%{opacity:1;transform:none}}\n.gw{transform-origin:left center;animation:gw 2s ease-in-out infinite}@keyframes gw{0%{transform:scaleX(0)}60%,100%{transform:scaleX(1)}}\n.dn{animation:dn 1.2s ease-in infinite}@keyframes dn{0%{transform:translateY(-4px);opacity:0}30%{opacity:1}100%{transform:translateY(12px);opacity:0}}\n.sl{animation:sl 2s ease-in-out infinite}@keyframes sl{0%{transform:translateX(34px);opacity:0}30%{opacity:1}100%{transform:translateX(-36px);opacity:0}}\n.rs{animation:rs 2.4s ease-out infinite}@keyframes rs{0%{transform:translateY(24px);opacity:0}30%{opacity:1}100%{transform:translateY(-34px);opacity:0}}\n.rg{transform-origin:center;animation:rg 1.8s ease-out infinite}@keyframes rg{0%{transform:scale(.7);opacity:.9}100%{transform:scale(1.35);opacity:0}}\n.sa{animation:sa 1.2s ease-out infinite}@keyframes sa{0%{opacity:0;transform:translateX(-6px)}40%{opacity:1}100%{opacity:0;transform:translateX(10px)}}\n.mg{animation:mg 1.8s ease-in-out infinite alternate}@keyframes mg{from{transform:translate(-16px,-10px)}to{transform:translate(8px,6px)}}\n.cd{animation:cd 4s linear infinite}@keyframes cd{to{stroke-dashoffset:100}}\n.rn{transform-box:view-box;transform-origin:100px 112px;animation:sn 3s linear infinite}\n.bk{animation:fd .5s steps(1) infinite}\n.wv{opacity:0;animation:wv 1.5s infinite;transform-origin:center}.wv.b{animation-delay:.6s}@keyframes wv{0%{opacity:.9;transform:scale(.9)}100%{opacity:0;transform:scale(1.25)}}\n\n:host{display:inline-block;line-height:0}\n:host([paused]) *{animation-play-state:paused!important}\n@media (prefers-reduced-motion:reduce){.bot,.bot *,#fx *{animation:none!important}}\n";
var SVG="<svg viewBox=\"0 0 200 220\" aria-label=\"Kiu\">\n<defs><radialGradient id=\"kbg__ID__\" cx=\".35\" cy=\".25\" r=\".95\"><stop offset=\"0\" style=\"stop-color:var(--c1)\"/><stop offset=\"1\" style=\"stop-color:var(--c2)\"/></radialGradient></defs>\n<ellipse cx=\"100\" cy=\"209\" rx=\"50\" ry=\"7\" fill=\"#000\" opacity=\".16\"/>\n<ellipse cx=\"76\" cy=\"198\" rx=\"17\" ry=\"9\" style=\"fill:var(--c2)\"/><ellipse cx=\"124\" cy=\"198\" rx=\"17\" ry=\"9\" style=\"fill:var(--c2)\"/>\n<g id=\"ant\" class=\"ant\"><line x1=\"100\" y1=\"44\" x2=\"100\" y2=\"22\" style=\"stroke:var(--c2)\" stroke-width=\"4\" stroke-linecap=\"round\"/><circle class=\"bulb\" cx=\"100\" cy=\"15\" r=\"8\" style=\"fill:var(--gl)\"/><circle cx=\"97\" cy=\"12\" r=\"2.5\" fill=\"#fff\" opacity=\".8\"/></g>\n<g id=\"la\" class=\"la\"><ellipse cx=\"25\" cy=\"142\" rx=\"11\" ry=\"18\" transform=\"rotate(18 25 142)\" fill=\"url(#kbg__ID__)\"/></g>\n<g id=\"ra\" class=\"ra\"><ellipse cx=\"175\" cy=\"142\" rx=\"11\" ry=\"18\" transform=\"rotate(-18 175 142)\" fill=\"url(#kbg__ID__)\"/></g>\n<g class=\"bd\"><path d=\"M100 40C150 40 173 82 169 128 166 172 137 199 100 199 63 199 34 172 31 128 27 82 50 40 100 40Z\" fill=\"url(#kbg__ID__)\"/>\n<ellipse cx=\"68\" cy=\"68\" rx=\"22\" ry=\"11\" transform=\"rotate(-30 68 68)\" fill=\"#fff\" opacity=\".35\"/>\n<rect x=\"44\" y=\"76\" width=\"112\" height=\"82\" rx=\"38\" fill=\"#2a1830\"/><rect x=\"48\" y=\"79\" width=\"104\" height=\"14\" rx=\"7\" fill=\"#fff\" opacity=\".07\"/>\n<ellipse cx=\"62\" cy=\"130\" rx=\"8\" ry=\"5\" fill=\"#ff9db0\" opacity=\".55\"/><ellipse cx=\"138\" cy=\"130\" rx=\"8\" ry=\"5\" fill=\"#ff9db0\" opacity=\".55\"/>\n<g id=\"eyes\" style=\"color:#fff1dc\" stroke=\"currentColor\"></g><g id=\"mouth\" style=\"color:#fff1dc\" stroke=\"currentColor\"></g></g>\n<g id=\"fx\"></g></svg>";
const PAL={co:['#ffb08a','#f0603f','#ffe9a8'],sl:['#d9bfb6','#9a7a80','#ffe9a8'],am:['#ffd37a','#ee8a1c','#fff0a0'],te:['#8fe0d3','#2a9d8f','#d6fff6'],re:['#ff9a90','#d6402f','#ff6b5e'],gr:['#a4ecb8','#2fae68','#e3ffe9'],vi:['#c4b0ff','#6d4fe0','#efe6ff'],bl:['#9ccaff','#2f7fe0','#e1f0ff']};
const SS=w=>'fill="none" stroke="var(--c2)" stroke-width="'+w+'" stroke-linecap="round" stroke-linejoin="round"',S=SS(3),P='fill="var(--c1)" stroke="var(--c2)" stroke-width="2.5" stroke-linejoin="round"';
const AT='stroke-width="4" fill="none" stroke-linecap="round"';
const OV=(x,y,rx,ry)=>'<ellipse class="eye" cx="'+x+'" cy="'+y+'" rx="'+rx+'" ry="'+ry+'" fill="currentColor" stroke="none"/><circle cx="'+(x+3)+'" cy="'+(y-4)+'" r="2.4" fill="#2a1830" stroke="none"/>';
const E2=(a,b,y,rx,ry)=>OV(a,y,rx,ry)+OV(b,y,rx,ry);
const LID=(x)=>'<rect x="'+(x-9)+'" y="94" width="18" height="12" fill="#2a1830" stroke="none"/>';
const ST=(x,y)=>'<g transform="translate('+x+','+y+')"><path class="pl" d="M0-10Q1.5-1.5 10 0 1.5 1.5 0 10-1.5 1.5-10 0-1.5-1.5 0-10Z" fill="currentColor" stroke="none"/></g>';
const SPI=x=>'<g class="sp"><circle cx="'+x+'" cy="108" r="8" '+AT+' stroke-dasharray="30 14"/><circle cx="'+x+'" cy="108" r="3.5" '+AT+' stroke-dasharray="12 10"/></g>';
const EY={round:E2(80,120,108,7,10),big:E2(80,120,106,9,13),up:E2(84,124,102,6.5,9),down:E2(80,120,113,7,9),lft:E2(72,112,108,7,10),rgt:E2(88,128,108,7,10),
half:E2(80,120,110,7,10)+LID(80)+LID(120),closed:'<path d="M70 108Q80 116 90 108M110 108Q120 116 130 108" '+AT+'/>',
x:'<path d="M72 100L88 116M88 100L72 116M112 100L128 116M128 100L112 116" '+AT+'/>',happy:'<path d="M70 114Q80 98 90 114M110 114Q120 98 130 114" '+AT+'/>',
spiral:SPI(80)+SPI(120),star:ST(80,108)+ST(120,108),squint:'<path d="M72 98L88 108L72 118M128 98L112 108L128 118" '+AT+'/>',
sad:E2(80,120,110,7,10)+'<path class="dp" d="M72 120Q76 128 72 130Q68 128 72 120Z" fill="#9ad4ff" stroke="none"/>',
worried:E2(80,120,110,7,10)+'<path d="M70 94L90 99M130 94L110 99" '+AT+'/>',scan:E2(80,120,108,7,10),tick:E2(80,120,108,7,10)};
const MO={smile:'<path d="M91 132Q100 141 109 132" '+AT+'/>',flat:'<path d="M92 135H108" '+AT+'/>',o:'<ellipse cx="100" cy="135" rx="5" ry="6" fill="currentColor" stroke="none"/>',
talk:'<ellipse class="mo" cx="100" cy="136" rx="9" ry="7" fill="currentColor" stroke="none"/>',frown:'<path d="M90 141Q100 131 110 141" '+AT+'/>',
grin:'<path d="M88 130Q100 148 112 130Z" fill="currentColor" stroke-linejoin="round" stroke-width="3"/>',
dots:'<circle class="dt" cx="90" cy="135" r="2.8" fill="currentColor" stroke="none"/><circle class="dt d2" cx="100" cy="135" r="2.8" fill="currentColor" stroke="none"/><circle class="dt d3" cx="110" cy="135" r="2.8" fill="currentColor" stroke="none"/>',
wavy:'<path d="M88 136Q94 130 100 136T112 136" '+AT+'/>'};
const GG=(x,y,s)=>'<g transform="translate('+x+','+y+')">'+s+'</g>';
const BUB='<path '+P+' d="M8 2H32Q40 2 40 10V20Q40 28 32 28H20L12 36V28H8Q0 28 0 20V10Q0 2 8 2Z"/>';
const BELL='<path '+P+' d="M20 2Q8 2 8 16Q8 26 2 32H38Q32 26 32 16Q32 2 20 2Z"/><circle '+P+' cx="20" cy="36" r="4"/>';
const MIC='<rect '+P+' x="13" y="0" width="14" height="24" rx="7"/><path '+S+' d="M6 18Q6 32 20 32Q34 32 34 18M20 32V40"/>';
const DOC='<path '+P+' d="M0 0H18L26 8V32H0Z"/><path '+S+' d="M5 14H20M5 21H20M5 28H15"/>';
const FX={
bubble:['bob',GG(140,6,BUB+'<circle class="dt" cx="12" cy="15" r="3" fill="var(--c2)"/><circle class="dt d2" cx="20" cy="15" r="3" fill="var(--c2)"/><circle class="dt d3" cx="28" cy="15" r="3" fill="var(--c2)"/>')],
mic:['pulse',GG(140,4,MIC)],
layers:['',GG(140,6,[0,12,24].map((y,i)=>'<rect class="ap" style="animation-delay:'+i*.35+'s" '+P+' x="0" y="'+y+'" width="36" height="8" rx="4"/>').join(''))],
checklist:['',GG(138,4,'<rect '+P+' x="0" y="0" width="36" height="42" rx="5"/>'+[10,22,34].map((y,i)=>'<path class="ap" style="animation-delay:'+i*.45+'s" '+S+' d="M6 '+y+'l3 3 5-6M20 '+y+'H30"/>').join(''))],
gear:['spin',GG(150,10,'<circle '+SS(7)+' cx="16" cy="16" r="10" stroke-dasharray="4.2 4.2"/><circle '+P+' cx="16" cy="16" r="7"/><circle cx="16" cy="16" r="2.5" fill="var(--gl)"/>')],
route:['',GG(140,6,'<path '+S+' d="M4 34L20 6L36 34Z" stroke-dasharray="3 5"/><circle '+P+' cx="4" cy="34" r="4"/><circle '+P+' cx="20" cy="6" r="4"/><circle '+P+' cx="36" cy="34" r="4"/><circle r="3.5" fill="var(--gl)" stroke="var(--c2)"><animateMotion dur="1.6s" repeatCount="indefinite" path="M4 34L20 6L36 34Z"/></circle>')],
stream:['',GG(138,6,[[0,40],[14,30],[28,36]].map((q,i)=>'<rect class="gw" style="animation-delay:'+i*.4+'s" '+P+' x="0" y="'+q[0]+'" width="'+q[1]+'" height="6" rx="3"/>').join(''))],
pause:['blink',GG(145,8,'<rect '+P+' x="0" y="0" width="10" height="30" rx="3"/><rect '+P+' x="18" y="0" width="10" height="30" rx="3"/>')],
ok:['pop',GG(138,6,BUB+'<path '+S+' d="M11 15l6 6 12-12"/>')],
stop:['pop',GG(142,6,'<path d="M11 0H25L36 11V25L25 36H11L0 25V11Z" fill="#ff7b6b" stroke="var(--c2)" stroke-width="2.5" stroke-linejoin="round"/><rect x="11" y="11" width="14" height="14" rx="2" fill="#fff"/>')],
bang:['blink',GG(142,4,'<path '+P+' d="M18 2L36 34H0Z"/><path '+S+' d="M18 14V22"/><circle cx="18" cy="28" r="1.8" fill="var(--c2)"/>')],
nosign:['pulse',GG(140,4,'<rect '+P+' x="10" y="10" width="20" height="20" rx="4"/><circle '+S+' cx="20" cy="20" r="19"/><path '+S+' d="M7 33L33 7"/>')],
cloud:['bob',GG(136,6,'<path '+P+' d="M12 30Q0 30 2 20Q4 12 14 14Q16 2 28 4Q40 6 38 18Q48 20 44 30Z"/><path '+S+' d="M23 28V16M18 20L23 15L28 20"/>')],
empty:['bob',GG(142,6,'<rect '+S+' x="0" y="4" width="34" height="30" rx="5" stroke-dasharray="4 5"/><path '+S+' d="M13 14Q13 9 17 9Q22 9 22 14Q22 18 17 20V23"/><circle cx="17" cy="28" r="1.6" fill="var(--c2)"/>')],
dl:['',GG(142,4,'<path class="dn" '+S+' d="M17 0V16M9 10L17 18L25 10"/><rect '+S+' x="0" y="32" width="34" height="7" rx="3.5"/><rect class="gw" '+P+' x="0" y="32" width="34" height="7" rx="3.5"/>')],
dlerr:['shake',GG(142,4,'<path '+S+' d="M17 0V12M9 14L17 22L25 14"/><path '+S+' d="M4 32L30 40M30 32L4 40" style="stroke:#d6402f"/>')],
boxok:['pop',GG(140,6,'<path '+P+' d="M2 12L20 4L38 12V32L20 40L2 32Z"/><path '+S+' d="M2 12L20 20L38 12M20 20V40"/><circle cx="34" cy="8" r="9" fill="var(--gl)" stroke="var(--c2)" stroke-width="2.5"/><path '+SS(2.5)+' d="M30 8l3 3 5-6"/>')],
filein:['',GG(130,10,'<g class="sl">'+DOC+'</g>')],
ring:['','<circle class="rn" cx="100" cy="112" r="90" '+S+' stroke-dasharray="80 490"/>'],
bolt:['pulse',GG(144,6,'<path '+P+' d="M20 0L4 22H16L12 40L32 16H20Z" style="fill:var(--gl)"/>')],
sweat:['',GG(150,30,'<path class="dp" d="M6 0Q14 12 6 16Q-2 12 6 0Z" fill="#9ad4ff" stroke="var(--c2)" stroke-width="2"/><path class="dp" style="animation-delay:.6s" d="M30 8Q38 20 30 24Q22 20 30 8Z" fill="#9ad4ff" stroke="var(--c2)" stroke-width="2"/>')],
bubbles:['',[[150,60,5],[160,40,3.5],[140,28,4]].map((q,i)=>'<circle class="rs" style="animation-delay:'+i*.6+'s" cx="'+q[0]+'" cy="'+q[1]+'" r="'+q[2]+'" '+SS(2)+'/>').join('')],
mute:['',GG(142,4,'<g opacity=".85">'+MIC+'</g><path '+S+' d="M2 4L38 38" style="stroke:#d6402f"/>')],
radar:['',[0,.6,1.2].map(d=>'<circle class="rg" style="animation-delay:'+d+'s" cx="100" cy="112" r="70" '+SS(2.5)+'/>').join('')],
waves:['','<path class="wv" '+S+' d="M12 82Q0 112 12 142"/><path class="wv b" '+S+' d="M-2 70Q-20 112 -2 154"/><path class="wv" '+S+' d="M188 82Q200 112 188 142"/><path class="wv b" '+S+' d="M202 70Q220 112 202 154"/>'],
speech:['',GG(152,112,[0,1,2].map(i=>'<path class="sa" style="animation-delay:'+i*.25+'s" '+S+' d="M'+i*10+' '+(-i*6)+'Q'+(8+i*14)+' 10 '+i*10+' '+(20+i*12)+'"/>').join(''))],
headset:['','<path '+SS(7)+' d="M32 100A68 68 0 0 1 168 100"/><rect '+P+' x="22" y="90" width="14" height="36" rx="7"/><rect '+P+' x="164" y="90" width="14" height="36" rx="7"/><path '+S+' d="M170 126Q166 152 128 152"/>'+GG(150,6,'<path class="sp" '+S+' d="M26 12A12 12 0 1 1 12 6M12 0V6H18"/>')],
lockbell:['shake',GG(136,6,'<g transform="scale(.9)">'+BELL+'</g><g transform="translate(20,20)"><rect x="0" y="8" width="20" height="16" rx="3" fill="#ff7b6b" stroke="var(--c2)" stroke-width="2.5"/><path '+S+' d="M4 8V4Q4 -2 10 -2Q16 -2 16 4V8"/></g>')],
clock:['',GG(140,6,'<circle '+P+' cx="20" cy="20" r="18"/><g class="sp"><path '+S+' d="M20 7V20"/><path d="M20 20V33" stroke="none" fill="none"/></g><g class="sp" style="animation-duration:12s"><path '+S+' d="M20 12V20"/><path d="M20 20V28" stroke="none" fill="none"/></g>')],
bell:['ring',GG(140,6,BELL)+'<path class="bk" '+S+' d="M136 14Q130 24 136 34M184 14Q190 24 184 34"/>'],
bellx:['fade',GG(140,6,'<g opacity=".6">'+BELL+'</g>')+'<path '+S+' d="M148 8L178 40M178 8L148 40" style="stroke:#d6402f"/>'],
power:['spin',GG(142,6,'<path '+S+' d="M34 20A14 14 0 1 1 28 8M28 0V9H37"/>')],
timer:['',GG(142,6,'<rect '+P+' x="14" y="-4" width="12" height="5" rx="2"/><circle '+P+' cx="20" cy="24" r="16"/><circle class="cd" pathLength="100" cx="20" cy="24" r="9" fill="none" stroke="var(--gl)" stroke-width="8" stroke-dasharray="100"/>')],
docoff:['',GG(142,6,'<g opacity=".55"><path '+S+' d="M0 0H20L30 10V40H0Z" stroke-dasharray="4 5"/><path '+S+' d="M7 20H23M7 28H23"/></g>')],
magni:['',GG(130,10,DOC+'<g class="mg"><circle cx="22" cy="22" r="9" fill="var(--gl)" fill-opacity=".5" stroke="var(--c2)" stroke-width="3"/><path '+S+' d="M29 29L38 38"/></g>')],
book:['glow',GG(138,8,'<path '+P+' d="M4 6Q14 0 22 6Q30 0 40 6V34Q30 28 22 34Q14 28 4 34Z"/><path '+S+' d="M22 6V34"/>')+'<path class="bk" d="M180 4l2.5 6 6 2.5-6 2.5-2.5 6-2.5-6-6-2.5 6-2.5z" fill="var(--gl)" stroke="var(--c2)" stroke-width="1.5"/>']};
// estado: [paleta, ojos, boca, cuerpo, brazoIzq, brazoDer, antena, objeto]
const C={
'Inactivo':['co','round','smile','fl','dn','wv','tl',''],
'Entrada':['co','down','flat','nd','ty','ty','no','bubble'],
'Dictando':['te','big','o','sw','dn','ea','tl','mic'],
'Armando prompt':['vi','scan','flat','sd','dn','lf','pl','layers'],
'Reglas offline':['bl','squint','smile','ld','dn','pt','no','checklist'],
'Acción del dispositivo':['am','round','grin','bn','dn','pt','pl','gear'],
'Enrutando':['bl','scan','dots','wk','pt','pt','wg','route'],
'Generando':['am','up','dots','tr','fp','fp','pl','stream'],
'Proveedor en pausa':['sl','half','wavy','bw','sg','sg','dr','pause'],
'Respuesta lista':['gr','happy','grin','jp','ch','ch','up','ok'],
'Detenido':['re','round','flat','st','dn','st','dn','stop'],
'Error':['re','x','frown','sh','dn','dn','dr','bang'],
'Motor no soportado':['sl','spiral','wavy','no','sg','sg','wg','nosign'],
'Usar nube/Ollama':['bl','round','smile','ro','dn','pt','up','cloud'],
'Sin modelo':['sl','half','flat','sq','dn','dn','dr','empty'],
'Descargando':['bl','down','o','hp','fp','fp','pl','dl'],
'Error de descarga':['re','sad','frown','sk','dn','dn','dr','dlerr'],
'Descargado':['gr','happy','smile','tw','dn','ch','up','boxok'],
'Importando':['vi','lft','o','zg','pt','dn','tl','filein'],
'Cargando':['am','up','dots','pu','lf','lf','sp','ring'],
'Cargado':['gr','star','grin','hp','dn','up','up','bolt'],
'Ocupado':['am','spiral','wavy','jt','fp','fp','wg','sweat'],
'Liberado':['te','closed','o','ld','dn','dn','dr','bubbles'],
'Reposo de voz':['sl','round','flat','br','dn','dn','no','mute'],
'Palabra de activación':['te','scan','flat','cr','dn','dn','up','radar'],
'Escuchando':['te','big','o','ls','ea','dn','tl','waves'],
'Hablando':['co','round','talk','tb','dn','gs','pl','speech'],
'Manos libres':['co','happy','talk','ds','wv','wv','wg','headset'],
'Sin permiso de alarma exacta':['re','worried','wavy','jt','dn','sg','dr','lockbell'],
'Programado':['co','rgt','smile','ls','dn','pt','tl','clock'],
'Disparado':['am','big','o','vb','ch','ch','wg','bell'],
'Cancelado':['sl','closed','flat','ro','no','no','dr','bellx'],
'Reprogramado al reiniciar':['bl','round','o','rb','up','up','wg','power'],
'Temporizador nativo':['am','tick','flat','tk','dn','pt','pl','timer'],
'RAG apagado':['sl','half','flat','br','dn','dn','dr','docoff'],
'Indexando':['vi','scan','flat','wk','dn','lf','pl','magni'],
'RAG activo':['vi','star','smile','fl','dn','up','pl','book']};

var ALIAS={idle:'Inactivo',typing:'Entrada',dictating:'Dictando',building:'Armando prompt',rules:'Reglas offline',action:'Acción del dispositivo',
routing:'Enrutando',thinking:'Generando',generating:'Generando',paused:'Proveedor en pausa',reply:'Respuesta lista',done:'Respuesta lista',stopped:'Detenido',error:'Error',
unsupported:'Motor no soportado',cloud:'Usar nube/Ollama',nomodel:'Sin modelo',sleep:'Sin modelo',download:'Descargando',downloading:'Descargando',downloadError:'Error de descarga',
downloaded:'Descargado',importing:'Importando',loading:'Cargando',loaded:'Cargado',busy:'Ocupado',released:'Liberado',muted:'Reposo de voz',wake:'Palabra de activación',
listening:'Escuchando',speaking:'Hablando',handsfree:'Manos libres',noalarm:'Sin permiso de alarma exacta',scheduled:'Programado',ringing:'Disparado',canceled:'Cancelado',
rebooted:'Reprogramado al reiniciar',timer:'Temporizador nativo',ragoff:'RAG apagado',indexing:'Indexando',rag:'RAG activo'};
var uid=0;
function resolve(n){return C[n]?n:(ALIAS[n]&&C[ALIAS[n]]?ALIAS[n]:'Inactivo');}
/* v2.8.1: el CSS es la UNICA fuente del tamaño del hueco (`[data-avatar]{width:
   var(--kav-s)}` en app.css). Antes el tamaño vivía duplicado —una vez en el
   `--kav-s` que el CSS declaraba y nadie leía, otra en estos números fijos acá— y
   los dos se contradecían: el host del chat medía 0x0 (caja sin dimensionar) y caía
   al id, 64 px, que se comían el título de al lado. */
function declaredSize(host){
  try{
    var v=host.ownerDocument&&host.ownerDocument.defaultView
      ?host.ownerDocument.defaultView.getComputedStyle(host).getPropertyValue('--kav-s'):'';
    var n=parseFloat(v);
    if(n>=24&&n<=400)return Math.round(n);
  }catch(e){}
  return 0;
}
/* Tamaño del bot según el hueco real. Si la pantalla está oculta el rect mide 0x0
   (todavía no hay layout), así que se lee el valor declarado en el CSS: el bot
   aparece con su tamaño correcto en vez de con el de emergencia. */
function fitSize(host){
  var r=host.getBoundingClientRect(),s=0;
  if(r&&r.width>=24&&r.height>=24)s=Math.round(Math.min(r.width,r.height)*0.95);
  if(!s){var d=declaredSize(host);s=Math.round((d||64)*0.95);}
  /* piso en 30 (no en 54): los huecos chicos del chat y de la esquina son de
     44 y 40 px, y un piso de 54 los desbordaba otra vez. */
  return Math.max(30,Math.min(200,s));
}
function mount(target,opts){
  if(!target){ /* llamada vieja sin argumentos (KiuAvatar.mount()): montar todos los [data-avatar] */
    var els=document.querySelectorAll('[data-avatar]');
    for(var j=0;j<els.length;j++){if(!els[j].getAttribute('data-kiu-mounted')){try{mount(els[j],{});}catch(e){}}}
    return undefined;
  }
  opts=opts||{};
  var host=typeof target==='string'?document.querySelector(target):target;
  if(!host)throw new Error('KiuAvatar: no se encontró el contenedor');
  var root;
  try{ root=host.shadowRoot||host.attachShadow({mode:'open'}); }
  catch(err){ /* p.ej. <button>: attachShadow no esta permitido -> se usa un hijo como host del Shadow DOM */
    var inner=null,kids=host.children;
    for(var q0=0;q0<kids.length;q0++){if(kids[q0].className==='kiu-shadow-host'){inner=kids[q0];break;}}
    if(!inner){inner=document.createElement('span');inner.className='kiu-shadow-host';inner.style.cssText='display:block;pointer-events:none';host.appendChild(inner);}
    root=inner.shadowRoot||inner.attachShadow({mode:'open'});
  }
  root.innerHTML='<style>'+CSS+'</style><div class="bot" id="bot">'+SVG.replace(/__ID__/g,++uid)+'</div>';
  var size=opts.size||fitSize(host),bt=root.querySelector('.bot');bt.style.width=size+'px';bt.style.height=Math.round(size*209/190)+'px';bt.style.setProperty('--u',(size/190).toFixed(3));
  var q=function(s){return root.querySelector(s);},cur='Inactivo';
  /* v2.8.0: antes cada set() reescribía el SVG entero (ojos, boca, brazos, antena,
     objeto y className), y eso reiniciaba TODAS las animaciones del bot aunque no
     hubieran cambiado: un parpadeo al cambiar de estado, una respiración que
     arrancaba de cero. Ahora se guarda qué se pintó por última vez y solo se toca
     la parte que de verdad cambió. El className del cuerpo se reasigna solo si es
     distinto, porque tocarlo reinicia la animación del cuerpo. */
  var lastBody='', lastEye='', lastMouth='', lastArmL='', lastArmR='', lastAnt='', lastFx='', lastFxCls='', lastPal='';
  function set(name){
    name=resolve(name);cur=name;var c=C[name],p=PAL[c[0]];
    var body='bot b-'+c[3]+(size<60?' mini':'');
    if(body!==lastBody){bt.className=body;lastBody=body;}
    var pal=c[0];
    if(pal!==lastPal){
      bt.style.setProperty('--c1',p[0]);bt.style.setProperty('--c2',p[1]);bt.style.setProperty('--gl',p[2]);
      lastPal=pal;
    }
    if(c[1]!==lastEye){var e=q('#eyes');e.setAttribute('class','ey-'+c[1]);e.innerHTML=EY[c[1]];lastEye=c[1];}
    if(c[2]!==lastMouth){q('#mouth').innerHTML=MO[c[2]];lastMouth=c[2];}
    if(c[4]!==lastArmL){q('#la').setAttribute('class','la A-'+c[4]);lastArmL=c[4];}
    if(c[5]!==lastArmR){q('#ra').setAttribute('class','ra A-'+c[5]);lastArmR=c[5];}
    if(c[6]!==lastAnt){q('#ant').setAttribute('class','ant a-'+c[6]);lastAnt=c[6];}
    if(c[7]!==lastFx){
      var f=FX[c[7]]||['',''],x=q('#fx');
      x.innerHTML=f[1];
      var fc=f[0]?'m-'+f[0]:'';
      if(fc!==lastFxCls){x.setAttribute('class',fc);lastFxCls=fc;}
      lastFx=c[7];
    }
    if(host.getAttribute('data-kiu-state')!==name) host.setAttribute('data-kiu-state',name);
    return name;
  }
  function vis(){if(document.hidden)host.setAttribute('paused','');else if(!host.__manualPause)host.removeAttribute('paused');}
  document.addEventListener('visibilitychange',vis);
  set(opts.state||'Inactivo');
  host.setAttribute('data-kiu-mounted','1');host.__kiuSize=size;
  var inst={set:set,get:function(){return cur;},
    resize:function(px){if(!px||px<30)return;size=Math.round(px);host.__kiuSize=size;bt.classList.toggle('mini',size<60);lastBody='';bt.style.width=size+'px';bt.style.height=Math.round(size*209/190)+'px';bt.style.setProperty('--u',(size/190).toFixed(3));},
    pause:function(){host.__manualPause=true;host.setAttribute('paused','');},
    resume:function(){host.__manualPause=false;host.removeAttribute('paused');},
    destroy:function(){document.removeEventListener('visibilitychange',vis);root.innerHTML='';host.removeAttribute('data-kiu-mounted');
      for(var i=0;i<defs.length;i++){if(defs[i].host===host){defs.splice(i,1);break;}}}};
  defs.push({host:host,av:inst});
  return inst;
}
/* ---------- registro multi-instancia + compat con la API vieja (avatar.js) ----------
   app.js / tools.js / brain.js llamaban KiuAvatar.set('work'), .flash('error',2200),
   .state()==='speak' y .pick(text). Esa capa traduce los nombres viejos al mapa de
   37 estados y repinta TODOS los bots montados a la vez.

   v2.8.0 — los alias apuntaban al estado equivocado y por eso el bot se movía raro:
     think  → 'Armando prompt'   (lupa armando capas) en vez de 'Generando'
     work   → 'Acción del dispositivo' (engranaje) que se veía al CARGAR o DESCARGAR
     search → 'Indexando' (lupa sobre un documento) en una búsqueda web
     create → 'RAG activo' (el libro) al pedir un poema
   Ahora: think/create/search → 'Generando'/'Enrutando' (lo que de verdad está
   haciendo) y work → 'Cargando'. La acción en el teléfono se sigue pidiendo con
   'alert' / 'action', que sí significan eso. */
var defs=[];
var OLD2NEW={idle:'Inactivo',listen:'Escuchando',think:'Generando',speak:'Hablando',happy:'Respuesta lista',alert:'Acción del dispositivo',error:'Error',timer:'Temporizador nativo',work:'Cargando',create:'Generando',search:'Enrutando',code:'Reglas offline',focus:'Reglas offline'};
var NEW2OLD={'Hablando':'speak','Escuchando':'listen','Dictando':'listen','Temporizador nativo':'timer','Indexando':'search','Enrutando':'search','Armando prompt':'think','Generando':'think','Cargando':'work','Descargando':'work','Acción del dispositivo':'work','Respuesta lista':'happy','Error':'error','Sin permiso de alarma exacta':'alert','RAG activo':'create','Reglas offline':'code'};
var cur='Inactivo',ft=null;
function gresolve(n){return resolve(OLD2NEW[n]||n);}
/* v2.8.0: el estado base ya no vive en kiu-avatar.js. Lo decide KiuState (js/kiu-estados.js)
   con prioridades; acá solo se pinta. */
function paintAll(n){for(var i=0;i<defs.length;i++){try{defs[i].av.set(n);}catch(e){}}}
function gset(n){cur=gresolve(n);paintAll(cur);return cur;}
function gflash(n,ms){if(ft){clearTimeout(ft);ft=null;}gset(n);ft=setTimeout(function(){ft=null;paintAll(cur);},ms||1800);}
function ghold(n){if(ft){clearTimeout(ft);ft=null;}gset(n);}
function greset(){ghold('Inactivo');}
/* v2.8.0: state() devuelve el NOMBRE EXACTO del estado del mapa (37), no el alias
   viejo de 13: 'Hablando', 'Generando', 'Sin modelo'… KiuState.get() manda, y
   KiuState ya pinta por KiuAvatar.set(), así que KiuAvatar.state() lo refleja. */
function gstate(){
  if (global.KiuState && typeof global.KiuState.get==='function') { try { var s=global.KiuState.get(); if(s) return s; } catch(e){} }
  return cur;
}
/* vista de los 13 nombres viejos, para lo que todavía Compare con ellos */
function gstateOld(){return NEW2OLD[gstate()]||'idle';}
function pick(text){
  var t=(text||'').toLowerCase();
  if(/program|c[oó]digo|script|html|javascript|python|\bbug\b/.test(t))return 'Reglas offline';
  if(/concentr|enfoc|\bfoco\b|pomodoro|estudiar/.test(t))return 'Reglas offline';
  if(/investig|busca|averigu|qu[eé] es |qui[eé]n es|significa|cu[aá]nt[oa]s? /.test(t))return 'Enrutando';
  return 'Enrutando';
}
global.KiuAvatar={
  mount:mount,fitSize:fitSize,declaredSize:declaredSize,mounted:function(){return defs;},
  states:Object.keys(C),alias:ALIAS,oldAlias:OLD2NEW,
  set:gset,flash:gflash,hold:ghold,reset:greset,state:gstate,oldState:gstateOld,pick:pick,
  render:function(el,name){for(var i=0;i<defs.length;i++){if(defs[i].host===el){defs[i].av.set(gresolve(name));return;}}mount(el).set(gresolve(name));}
};
})(window);
