/* ============ NEXO TOOLS - Herramientas offline ============ */
window.KiuTools = (function () {
  'use strict';

  var timerState = { running: false, end: 0, left: 0, raf: null };

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function beep(times) {
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      var ctx = new Ctx();
      var n = times || 3;
      for (var i = 0; i < n; i++) {
        var o = ctx.createOscillator(), g = ctx.createGain();
        o.type = 'sine'; o.frequency.value = 880;
        o.connect(g); g.connect(ctx.destination);
        var t0 = ctx.currentTime + i * 0.45;
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(0.35, t0 + 0.04);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.35);
        o.start(t0); o.stop(t0 + 0.4);
      }
      setTimeout(function () { ctx.close(); }, n * 500 + 400);
    } catch (e) { }
    if (window.KiuApp) { KiuApp.vibrate([350, 180, 350]); }
  }

  /* ---------- Definición de herramientas ---------- */
  var TOOLS = [
    { id: 'calc', name: 'Calculadora', desc: 'Cuentas al toque', ic: 'calc', color: 'ti-blue', open: openCalc },
    { id: 'notas', name: 'Notas', desc: 'Apuntes rápidos', ic: 'note', color: 'ti-yellow', open: openNotas },
    { id: 'timer', name: 'Temporizador', desc: 'Cuenta regresiva', ic: 'timer', color: 'ti-orange', open: openTimer },
    { id: 'linterna', name: 'Linterna', desc: 'Flash real del teléfono', ic: 'flash', color: 'ti-gray', open: openLinterna },
    { id: 'pass', name: 'Contraseñas', desc: 'Claves seguras', ic: 'key', color: 'ti-green', open: openPass },
    { id: 'decide', name: 'Decisor', desc: 'Sí o no al azar', ic: 'dice', color: 'ti-pink', open: openDecide },
    { id: 'conv', name: 'Conversor', desc: 'Unidades y grados', ic: 'conv', color: 'ti-cyan', open: openConv },
    { id: 'propina', name: 'Propina', desc: 'Dividir la cuenta', ic: 'receipt', color: 'ti-green', open: openPropina },
    { id: 'desc', name: 'Descuento', desc: 'Precio final', ic: 'percent', color: 'ti-red', open: openDesc },
    { id: 'imc', name: 'IMC', desc: 'Índice de masa', ic: 'pulse', color: 'ti-cyan', open: openImc },
    { id: 'count', name: 'Contador', desc: 'Contá lo que quieras', ic: 'count', color: 'ti-purple', open: openCount },
    { id: 'share', name: 'Compartir', desc: 'Enviar texto a apps', ic: 'share', color: 'ti-red', open: openShare }
  ];

  /* ---------- Calculadora ---------- */
  var calcExpr = '';
  function openCalc() {
    var html =
      '<div class="calc-screen"><div class="cs-hist" id="cs-hist"></div><div class="cs-cur" id="cs-cur">0</div></div>' +
      '<div class="calc-grid">' +
      ['C', '( )', '%', '÷', '7', '8', '9', '×', '4', '5', '6', '-', '1', '2', '3', '+', '0', '.', 'DEL', '=']
        .map(function (k) {
          var cls = k === '=' ? 'eq' : ('÷×-+%'.indexOf(k) >= 0 ? 'op' : '');
          return '<button class="' + cls + '" data-k="' + k + '">' + k + '</button>';
        }).join('') +
      '</div>';
    var body = window.KiuApp.modal('Calculadora', html);
    if (!body) return;
    body.addEventListener('click', function (ev) {
      var b = ev.target.closest('button[data-k]');
      if (!b) return;
      pressKey(b.getAttribute('data-k'));
    });
  }
  function pressKey(k) {
    var cur = document.getElementById('cs-cur');
    var hist = document.getElementById('cs-hist');
    if (!cur) return;
    if (k === 'C') { calcExpr = ''; hist.textContent = ''; }
    else if (k === 'DEL') { calcExpr = calcExpr.slice(0, -1); }
    else if (k === '( )') {
      var opens = (calcExpr.match(/\(/g) || []).length;
      var closes = (calcExpr.match(/\)/g) || []).length;
      calcExpr += (opens > closes && /[\d)]$/.test(calcExpr)) ? ')' : '(';
    }
    else if (k === '=') {
      var v = calcEval(calcExpr);
      if (v !== null) {
        hist.textContent = calcExpr + ' =';
        calcExpr = String(v);
      } else { hist.textContent = 'Cuenta inválida'; }
    }
    else {
      calcExpr += k;
    }
    cur.textContent = calcExpr || '0';
  }
  /* v2.7.4: el botón % hacía MÓDULO ("50%" daba "Cuenta inválida"). Ahora es porcentaje como en una
     calculadora normal: 200+10% = 220, 200-10% = 180, 50% = 0,5, 200*10% = 20. */
  function pctExpand(e) {
    var m = e.match(/^(.+)([+\-])\s*(\d+(?:\.\d+)?)%$/);
    if (m) e = '(' + m[1] + ')' + m[2] + '((' + m[1] + ')*' + m[3] + '/100)';
    return e.replace(/(\d+(?:\.\d+)?)%/g, '($1/100)');
  }
  function calcEval(expr) {
    var e = expr.replace(/×/g, '*').replace(/÷/g, '/').replace(/,/g, '.');
    if (!/^[\d+\-*/().%\s]*$/.test(e)) return null;
    e = pctExpand(e.replace(/\s+/g, ''));
    if (e.indexOf('%') >= 0) return null;
    try {
      var val = Function('"use strict"; return (' + e + ')')();
      if (typeof val !== 'number' || !isFinite(val)) return null;
      return Math.round(val * 1000000) / 1000000;
    } catch (err) { return null; }
  }

  /* ---------- Notas rápidas ---------- */
  function openNotas() {
    var html =
      '<textarea id="tool-note" class="tool-textarea" placeholder="Escribí tu nota acá..."></textarea>' +
      '<button class="btn-primary full" id="note-save" style="margin-top:12px">Guardar nota</button>' +
      '<div id="notes-mini" style="margin-top:14px"></div>';
    var body = window.KiuApp.modal('Notas rápidas', html);
    if (!body) return;
    renderMiniNotes(body.querySelector('#notes-mini'));
    body.querySelector('#note-save').addEventListener('click', function () {
      var ta = body.querySelector('#tool-note');
      var txt = ta.value.trim();
      if (!txt) { window.KiuApp.toast('Escribí algo primero'); return; }
      if (window.KiuMem) KiuMem.addNota(txt);
      ta.value = '';
      renderMiniNotes(body.querySelector('#notes-mini'));
      window.KiuApp.toast('Nota guardada');
    });
  }
  function renderMiniNotes(el) {
    if (!el) return;
    var notas = window.KiuMem ? KiuMem.list('notas').slice(0, 5) : [];
    if (!notas.length) { el.innerHTML = '<p class="set-hint small">Todavía no hay notas guardadas.</p>'; return; }
    el.innerHTML = notas.map(function (n) {
      return '<div class="list-row"><div class="list-txt"><strong>' + esc(n.text) + '</strong><span>' + n.date + '</span></div></div>';
    }).join('');
  }

  /* ---------- Temporizador ---------- */
  function openTimer(presetSecs) {
    var html =
      '<div class="timer-display" id="tm-disp">00:00</div>' +
      '<div class="conv-row" style="justify-content:center">' +
      '<input id="tm-min" class="tool-input" type="number" min="0" max="360" value="5" style="width:90px;text-align:center">' +
      '<span style="font-weight:700">min</span>' +
      '<input id="tm-sec" class="tool-input" type="number" min="0" max="59" value="0" style="width:90px;text-align:center">' +
      '<span style="font-weight:700">seg</span>' +
      '</div>' +
      '<button class="btn-primary full" id="tm-start">Arrancar</button>' +
      '<button class="btn-ghost full" id="tm-stop" style="margin-top:10px;justify-content:center;display:none">Detener</button>';
    var body = window.KiuApp.modal('Temporizador', html);
    if (!body) return;
    body.querySelector('#tm-start').addEventListener('click', function () {
      var mins = parseInt(body.querySelector('#tm-min').value, 10) || 0;
      var secs = parseInt(body.querySelector('#tm-sec').value, 10) || 0;
      startTimer(mins * 60 + secs, body);
    });
    body.querySelector('#tm-stop').addEventListener('click', function () { stopTimer(body); });
    if (presetSecs) startTimer(presetSecs, body);
    else if (timerState.running) tick(body, true);
  }
  function startTimer(secs, body) {
    if (!secs || secs <= 0) { window.KiuApp.toast('Poné un tiempo válido'); return; }
    timerState.running = true;
    timerState.end = Date.now() + secs * 1000;
    if (window.KiuState) KiuState.set('flash', 'Temporizador nativo');
    if (body) {
      body.querySelector('#tm-stop').style.display = 'flex';
      body.querySelector('#tm-start').style.display = 'none';
    }
    tick(body, false);
  }
  function stopTimer(body) {
    timerState.running = false;
    if (timerState.raf) clearTimeout(timerState.raf);
    if (window.KiuState) KiuState.clear('flash');
    if (body) {
      var d = body.querySelector('#tm-disp');
      if (d) d.textContent = '00:00';
      var st = body.querySelector('#tm-stop'), sa = body.querySelector('#tm-start');
      if (st) st.style.display = 'none';
      if (sa) sa.style.display = 'block';
    }
    window.KiuApp.toast('Temporizador detenido');
  }
  function tick(body, keep) {
    if (!timerState.running) return;
    var left = Math.max(0, Math.round((timerState.end - Date.now()) / 1000));
    var el = document.getElementById('tm-disp');
    var mm = Math.floor(left / 60), ss = left % 60;
    var txt = String(mm).padStart(2, '0') + ':' + String(ss).padStart(2, '0');
    if (el) el.textContent = txt;
    document.title = timerState.running ? txt + ' · Kiu' : 'Kiu';
    if (left <= 0) {
      timerState.running = false;
      beep(3);
      if (window.KiuState) KiuState.flash('flash', 'Disparado', 2600);
      window.KiuApp.toast('Se terminó el tiempo');
      if (window.KiuApp) KiuApp.speak('Se terminó el tiempo');
      var st = document.querySelector('#tm-stop'), sa = document.querySelector('#tm-start');
      if (st) st.style.display = 'none';
      if (sa) sa.style.display = 'block';
      return;
    }
    timerState.raf = setTimeout(function () { tick(document.getElementById('tm-disp') ? document : null, true); }, 500);
  }

  /* ---------- Linterna (flash real + pantalla) ---------- */
  function openLinterna() {
    var fl = document.getElementById('flashlight');
    fl.classList.remove('hidden');
    if (window.KiuApp) {
      KiuApp.torch(true);
      KiuApp.keepOn(true);
      KiuApp.bright(true);
    }
  }
  function closeLinterna() {
    var fl = document.getElementById('flashlight');
    fl.classList.add('hidden');
    if (window.KiuApp) {
      KiuApp.torch(false);
      KiuApp.keepOn(false);
      KiuApp.bright(false);
    }
  }

  /* ---------- Contraseñas ---------- */
  function openPass() {
    var html =
      '<div class="pw-out" id="pw-out">--------</div>' +
      '<div class="set-row col"><div><strong>Largo: <span id="pw-len-l">16</span> caracteres</strong></div>' +
      '<input type="range" id="pw-len" min="8" max="32" value="16"></div>' +
      '<div class="set-row"><div><strong>Incluir símbolos</strong><span>! # $ % &amp; * ?</span></div>' +
      '<button class="toggle on" id="pw-sym"></button></div>' +
      '<button class="btn-primary full" id="pw-gen" style="margin-top:12px">Generar</button>' +
      '<button class="btn-ghost full" id="pw-copy" style="margin-top:10px;justify-content:center;display:none">Copiar clave</button>';
    var body = window.KiuApp.modal('Contraseñas', html);
    if (!body) return;
    var current = '';
    function gen() {
      var len = parseInt(body.querySelector('#pw-len').value, 10);
      body.querySelector('#pw-len-l').textContent = len;
      var sym = body.querySelector('#pw-sym').classList.contains('on');
      current = KiuBrain.genPass(len, !sym); /* v2.7.3: longitud exacta y aleatoriedad criptografica con o sin simbolos */
      body.querySelector('#pw-out').textContent = current;
      body.querySelector('#pw-copy').style.display = 'flex';
    }
    body.querySelector('#pw-gen').addEventListener('click', gen);
    body.querySelector('#pw-len').addEventListener('input', function () {
      body.querySelector('#pw-len-l').textContent = body.querySelector('#pw-len').value;
    });
    body.querySelector('#pw-sym').addEventListener('click', function () {
      body.querySelector('#pw-sym').classList.toggle('on');
    });
    body.querySelector('#pw-copy').addEventListener('click', function () {
      window.KiuApp.copyText(current);
      window.KiuApp.toast('Clave copiada');
    });
    gen();
  }

  /* ---------- Decisor ---------- */
  function openDecide() {
    var html =
      '<p class="set-hint" style="text-align:center;margin:4px 0 10px">Tirá la moneda digital cuando no te decidas.</p>' +
      '<div class="big-num" id="dc-res">?</div>' +
      '<button class="btn-primary full decide-btn" id="dc-go">Decidir</button>';
    var body = window.KiuApp.modal('Decisor', html);
    if (!body) return;
    body.querySelector('#dc-go').addEventListener('click', function () {
      var opts = ['SÍ', 'NO', 'SÍ', 'NO', 'Dale', 'Esperá'];
      var r = opts[Math.floor(Math.random() * opts.length)];
      var el = body.querySelector('#dc-res');
      var n = 0;
      var iv = setInterval(function () {
        el.textContent = opts[Math.floor(Math.random() * opts.length)];
        n++;
        if (n > 9) {
          clearInterval(iv);
          el.textContent = r;
          window.KiuApp.vibrate(60);
        }
      }, 70);
    });
  }

  /* ---------- Conversor ---------- */
  var UNITS = {
    km: { n: 'Kilómetros', f: 1000 }, mi: { n: 'Millas', f: 1609.34 },
    m: { n: 'Metros', f: 1 }, ft: { n: 'Pies', f: 0.3048 },
    kg: { n: 'Kilogramos', f: 1 }, lb: { n: 'Libras', f: 0.453592 },
    l: { n: 'Litros', f: 1 }, gal: { n: 'Galones', f: 3.78541 }
  };
  function openConv() {
    var opts =
      '<option value="km-mi">km a millas</option>' +
      '<option value="mi-km">millas a km</option>' +
      '<option value="m-ft">metros a pies</option>' +
      '<option value="ft-m">pies a metros</option>' +
      '<option value="kg-lb">kg a libras</option>' +
      '<option value="lb-kg">libras a kg</option>' +
      '<option value="l-gal">litros a galones</option>' +
      '<option value="gal-l">galones a litros</option>' +
      '<option value="c-f">°C a °F</option>' +
      '<option value="f-c">°F a °C</option>';
    var html =
      '<div class="conv-row"><input id="cv-in" class="tool-input" type="number" value="1">' +
      '<select id="cv-unit">' + opts + '</select></div>' +
      '<div style="text-align:center" class="conv-eq">=</div>' +
      '<div class="calc-screen" style="margin-top:10px"><div class="cs-cur" id="cv-out">-</div></div>';
    var body = window.KiuApp.modal('Conversor', html);
    if (!body) return;
    function calc() {
      var v = parseFloat(body.querySelector('#cv-in').value) || 0;
      var u = body.querySelector('#cv-unit').value;
      var from = u.split('-')[0], to = u.split('-')[1];
      var res;
      if (from === 'c') res = v * 9 / 5 + 32;
      else if (from === 'f') res = (v - 32) * 5 / 9;
      else res = v * UNITS[from].f / UNITS[to].f;
      res = Math.round(res * 1000) / 1000;
      var suf = (to === 'c' || to === 'f') ? ' °' + to.toUpperCase() : ' ' + UNITS[to].n;
      body.querySelector('#cv-out').textContent = String(res).replace('.', ',') + suf;
    }
    body.querySelector('#cv-in').addEventListener('input', calc);
    body.querySelector('#cv-unit').addEventListener('change', calc);
    calc();
  }

  /* ---------- Propina ---------- */
  function openPropina() {
    var html =
      '<label class="api-fields"><span style="color:var(--dim);font-size:12px;font-weight:600">Total de la cuenta ($)</span>' +
      '<input id="pt-total" class="tool-input" type="number" inputmode="decimal" placeholder="Ej: 24500"></label>' +
      '<div class="set-row col"><div><strong>Propina</strong></div>' +
      '<div class="preset-row" id="pt-pct">' +
      '<button class="chip-btn" data-p="0">0%</button>' +
      '<button class="chip-btn active" data-p="10">10%</button>' +
      '<button class="chip-btn" data-p="15">15%</button>' +
      '<button class="chip-btn" data-p="20">20%</button></div></div>' +
      '<label class="api-fields"><span style="color:var(--dim);font-size:12px;font-weight:600">Personas</span>' +
      '<input id="pt-ppl" class="tool-input" type="number" min="1" value="1"></label>' +
      '<div class="calc-screen" style="margin-top:12px"><div class="cs-hist" id="pt-hist">Total con propina</div><div class="cs-cur" id="pt-out">-</div></div>' +
      '<div class="calc-screen" style="margin-top:8px"><div class="cs-hist">Cada uno paga</div><div class="cs-cur" id="pt-each">-</div></div>';
    var body = window.KiuApp.modal('Propina', html);
    if (!body) return;
    var pct = 10;
    function calc() {
      var tot = parseFloat(body.querySelector('#pt-total').value) || 0;
      var ppl = Math.max(1, parseInt(body.querySelector('#pt-ppl').value, 10) || 1);
      var conP = tot * (1 + pct / 100);
      body.querySelector('#pt-out').textContent = '$ ' + conP.toLocaleString('es-AR', { maximumFractionDigits: 0 });
      body.querySelector('#pt-each').textContent = '$ ' + (conP / ppl).toLocaleString('es-AR', { maximumFractionDigits: 0 });
      body.querySelector('#pt-hist').textContent = 'Total con ' + pct + '% de propina';
    }
    body.querySelector('#pt-pct').addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-p]');
      if (!b) return;
      var bs = body.querySelectorAll('#pt-pct .chip-btn');
      for (var i = 0; i < bs.length; i++) bs[i].classList.remove('active');
      b.classList.add('active');
      pct = parseInt(b.getAttribute('data-p'), 10);
      calc();
    });
    body.querySelector('#pt-total').addEventListener('input', calc);
    body.querySelector('#pt-ppl').addEventListener('input', calc);
    calc();
  }

  /* ---------- Descuento ---------- */
  function openDesc() {
    var html =
      '<label class="api-fields"><span style="color:var(--dim);font-size:12px;font-weight:600">Precio original ($)</span>' +
      '<input id="ds-price" class="tool-input" type="number" inputmode="decimal" placeholder="Ej: 8900"></label>' +
      '<label class="api-fields"><span style="color:var(--dim);font-size:12px;font-weight:600">Descuento (%)</span>' +
      '<input id="ds-pct" class="tool-input" type="number" inputmode="decimal" value="25"></label>' +
      '<div class="calc-screen" style="margin-top:12px"><div class="cs-hist" id="ds-hist">Pagás</div><div class="cs-cur" id="ds-out">-</div></div>' +
      '<div class="calc-screen" style="margin-top:8px"><div class="cs-hist">Ahorrás</div><div class="cs-cur" id="ds-save">-</div></div>';
    var body = window.KiuApp.modal('Descuento', html);
    if (!body) return;
    function calc() {
      var p = parseFloat(body.querySelector('#ds-price').value) || 0;
      var d = parseFloat(body.querySelector('#ds-pct').value) || 0;
      var save = p * d / 100;
      body.querySelector('#ds-out').textContent = '$ ' + (p - save).toLocaleString('es-AR', { maximumFractionDigits: 0 });
      body.querySelector('#ds-save').textContent = '$ ' + save.toLocaleString('es-AR', { maximumFractionDigits: 0 });
      body.querySelector('#ds-hist').textContent = 'Pagás con ' + d + '% off';
    }
    body.querySelector('#ds-price').addEventListener('input', calc);
    body.querySelector('#ds-pct').addEventListener('input', calc);
    calc();
  }

  /* ---------- IMC ---------- */
  function openImc() {
    var html =
      '<label class="api-fields"><span style="color:var(--dim);font-size:12px;font-weight:600">Peso (kg)</span>' +
      '<input id="im-w" class="tool-input" type="number" inputmode="decimal" placeholder="Ej: 74"></label>' +
      '<label class="api-fields"><span style="color:var(--dim);font-size:12px;font-weight:600">Altura (cm)</span>' +
      '<input id="im-h" class="tool-input" type="number" inputmode="decimal" placeholder="Ej: 172"></label>' +
      '<div class="calc-screen" style="margin-top:12px"><div class="cs-hist" id="im-cat">Tu IMC</div><div class="cs-cur" id="im-out">-</div></div>';
    var body = window.KiuApp.modal('IMC', html);
    if (!body) return;
    function calc() {
      var w = parseFloat(body.querySelector('#im-w').value) || 0;
      var h = (parseFloat(body.querySelector('#im-h').value) || 0) / 100;
      if (w > 0 && h > 0.5) {
        var imc = w / (h * h);
        var cat = imc < 18.5 ? 'Bajo peso' : imc < 25 ? 'Peso saludable' : imc < 30 ? 'Sobrepeso' : 'Obesidad';
        body.querySelector('#im-out').textContent = (Math.round(imc * 10) / 10).toString().replace('.', ',');
        body.querySelector('#im-cat').textContent = cat + ' · tu IMC';
      }
    }
    body.querySelector('#im-w').addEventListener('input', calc);
    body.querySelector('#im-h').addEventListener('input', calc);
  }

  /* ---------- Contador ---------- */
  function openCount() {
    var html =
      '<div class="big-num" id="ct-n">0</div>' +
      '<div style="display:flex;gap:10px">' +
      '<button class="btn-ghost" id="ct-less" style="flex:1;justify-content:center;font-size:22px">-</button>' +
      '<button class="btn-primary" id="ct-more" style="flex:2;font-size:22px">Sumar</button>' +
      '</div>' +
      '<button class="btn-ghost full" id="ct-reset" style="margin-top:10px;justify-content:center">Reiniciar</button>';
    var body = window.KiuApp.modal('Contador', html);
    if (!body) return;
    var n = 0;
    function upd() { body.querySelector('#ct-n').textContent = n; }
    body.querySelector('#ct-more').addEventListener('click', function () { n++; upd(); window.KiuApp.vibrate(25); });
    body.querySelector('#ct-less').addEventListener('click', function () { if (n > 0) n--; upd(); });
    body.querySelector('#ct-reset').addEventListener('click', function () { n = 0; upd(); });
  }

  /* ---------- Compartir ---------- */
  function openShare() {
    var html =
      '<textarea id="sh-txt" class="tool-textarea" placeholder="Pegá o escribí el texto para compartir..."></textarea>' +
      '<button class="btn-primary full" id="sh-go" style="margin-top:12px">Abrir para compartir</button>';
    var body = window.KiuApp.modal('Compartir', html);
    if (!body) return;
    body.querySelector('#sh-go').addEventListener('click', function () {
      var t = body.querySelector('#sh-txt').value.trim();
      if (!t) { window.KiuApp.toast('Escribí algo primero'); return; }
      window.KiuApp.shareText(t);
    });
  }

  /* ---------- API pública ---------- */
  return {
    TOOLS: TOOLS,
    startTimer: function (secs) { openTimer(secs); },
    closeLinterna: closeLinterna,
    calcEval: calcEval /* expuesto para tests */
  };
})();
