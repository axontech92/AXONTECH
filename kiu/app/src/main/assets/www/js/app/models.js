/* app/models.js — módulo de app.js (tanda 4 · sección 3-a). descargas persistentes de modelos (HTTP Range) + importar GGUF desde el teléfono.
 * Cargado como script clásico en orden por index.html; los símbolos
 * compartidos viven en window para que los módulos se lean entre sí
 * igual que dentro del app.js original. */
(function () {
  'use strict';

  /* v2.8.0: la descarga y la importación son trabajo pesado: encienden la capa
     'job' y la apagan solas cuando terminan. Antes solo hacían KiuAvatar.set('work')
     y se quedaban en engranaje para siempre si el trabajo moría. */
  function KS() { return window.KiuState || null; }
  function jobOn(state) { var k = KS(); if (k) k.set('job', state); }
  function jobOff(flashState, ms) { var k = KS(); if (!k) return; k.clear('job'); if (flashState) k.flash('flash', flashState, ms || 2600); }
  function jobErr(state, ms) { var k = KS(); if (!k) return; k.clear('job'); k.warn(state, ms || 3200); }
  /* sin ningún modelo en el teléfono: el bot lo dice de verdad, no de adivinada */
  function resting() {
    var k = KS(); if (!k) return;
    if (k.layer('job')) return;                       /* hay trabajo en curso: no tocar el reposo */
    var any = false;
    for (var m in S.dl.done) if (Object.prototype.hasOwnProperty.call(S.dl.done, m)) { any = true; break; }
    k.set('rest', any ? 'Inactivo' : 'Sin modelo');
  }

  /* ================= v1.7.0: DESCARGAS DE MODELOS (persistente) ================= */
  var Mod = {
    jobs: {},
    timer: null,
    files: [],
    done: function (name) { return !!S.dl.done[name]; },
    fileByName: function (name) {
      for (var i = 0; i < this.files.length; i++) if (this.files[i].n === name) return this.files[i];
      return null;
    },
    /* La verdad la tiene el disco: sincroniza archivos reales con el estado guardado */
    sync: function (cb) {
      var res = rawBridge('dlList');
      this.files = (res && jparse(res, [])) || [];
      var ch = false;
      /* v1.9.1: purgar GGUF corruptos (descargas viejas truncadas) — el puente
         informa g:true/false (magia GGUF). Sin esto el motor nunca los carga. */
      this._purged = this._purged || {};
      for (var b = 0; b < this.files.length; b++) {
        var fb = this.files[b];
        if (fb.g === false && /\.gguf$/i.test(fb.n) && !this._purged[fb.n]) {
          this._purged[fb.n] = true;
          if (S.dl.done[fb.n]) { delete S.dl.done[fb.n]; ch = true; }
          try { rawBridge('dlDel', [fb.n]); } catch (eD) { }
          try { App.toast('Encontré un modelo dañado de una descarga vieja: lo borré. Descargalo de nuevo y va a bajar bien.'); } catch (eT) { }
        }
      }
      for (var i = 0; i < this.files.length; i++) {
        var f = this.files[i];
        if (f.n.slice(-5) === '.part') continue;
        if (f.g === false) continue; /* corrupto: no marcarlo como descargado */
        if (!S.dl.done[f.n]) { S.dl.done[f.n] = { ts: Date.now(), b: f.b }; ch = true; }
      }
      for (var k in S.dl.done) {
        if (!Object.prototype.hasOwnProperty.call(S.dl.done, k)) continue;
        if (!this.fileByName(k)) { delete S.dl.done[k]; ch = true; }
      }
      if (ch) saveS();
      if (cb) cb();
    },
    /* v2.11.0 · avisa antes de una descarga pesada si conviene esperar: datos móviles,
       batería baja sin cargador o teléfono caliente. Devuelve el texto del aviso, o ''. */
    guard: function (item) {
      var w = [];
      try { if (window.Sys && Sys.refresh) Sys.refresh(); } catch (e) { }
      var d = (window.Sys && Sys.d) || {};
      var c = modCatByFile(item.f) || item;
      var gb = c.gb || 0;
      var cn = (typeof navigator !== 'undefined') ? navigator.connection : null;
      if (gb >= 0.3 && cn && cn.type === 'cellular') {
        w.push('Estás con datos móviles y este modelo pesa ' + (gb < 1 ? Math.round(gb * 1024) + ' MB' : gb.toFixed(1).replace('.', ',') + ' GB') + '.');
      }
      if (d.bat && d.bat < 15 && !d.charging) w.push('La batería está al ' + d.bat + '% y no está cargando: una descarga larga puede cortarse.');
      if (d.temp && d.temp >= 42) w.push('El teléfono está caliente (' + Math.round(d.temp) + ' °C): conviene esperar a que se enfríe.');
      return w.join(' ');
    },
    start: function (item, skipGuard) {
      var self = this;
      bcrumb('descarga: ' + item.f);
      if (!rawBridge('dlStart2', ['', '', '', ''])) { App.toast('Las descargas funcionan en la app del teléfono'); return; }
      if (this.done(item.f) && this.fileByName(item.f)) { App.toast('Ya está descargado ✓'); App.renderModels(); return; }
      if (!skipGuard) {
        var aviso = this.guard(item);
        if (aviso) {
          App.confirm('Antes de bajar', aviso + ' ¿Bajar igual?', function () { self.start(item, true); }, { okLabel: 'Bajar igual', danger: false });
          return;
        }
      }
      var cat0 = modCatByFile(item.f);
      /* v2.4.0 (sección 1): el catálogo trae el SHA-256 oficial (Hugging Face);
         Java lo verifica al terminar y borra lo que no coincida. */
      var res = jparse(rawBridge('dlStart2', [item.u, item.f, '', (cat0 && cat0.sha) || '']) || '{}', {});
      if (!res.id) {
        var de = res.err || res.st || 'sin datos';
        App.toast('Descarga no iniciada: ' + de + (de.indexOf('espacio') >= 0 || de.indexOf('space') >= 0 ? '' : ' · revisá conexión e intentá de nuevo'));
        return;
      }
      if (res.path && res.path.indexOf('/') >= 0) S.dl.dir = res.path.slice(0, res.path.lastIndexOf('/'));
      /* v2.0: recordar desde dónde se reanuda (para «reanudando desde X%») */
      var pb0 = 0;
      for (var pf = 0; pf < this.files.length; pf++) if (this.files[pf].n === item.f + '.part') { pb0 = this.files[pf].b || 0; break; }
      this.jobs[res.id] = { st: 'queued', got: 0, total: 0, name: item.f, re: pb0 };
      App.toast('Descargando ' + item.n + '…');
      jobOn('Descargando');
      this.poll();
      App.renderModels();
    },
    poll: function () {
      var self = this;
      if (this.timer) return;
      this.timer = setInterval(function () {
        var ids = Object.keys(self.jobs);
        if (!ids.length) { clearInterval(self.timer); self.timer = null; self.sync(function () { App.renderModels(); resting(); }); return; }
        for (var t = 0; t < ids.length; t++) {
          var j = ids[t];
          var st = jparse(rawBridge('dlStatus', [j]) || '{}', {});
          /* v2.10.1 · LA BARRA APARECIA Y DESAPARECIA. Java informa «downloading» y
             «cancelled»; este bucle solo conocia «run» y «cancel». Con la descarga en
             marcha el estado no coincidia con nada, caia al final del bucle y el trabajo
             se borraba de la lista: la tarjeta volvia a «Descargar» mientras Java seguia
             bajando. Se normalizan los nombres al entrar. */
          if (st.st === 'downloading') st.st = 'run';
          else if (st.st === 'cancelled') st.st = 'cancel';
          var job = self.jobs[j];
          if (!job) continue;
          /* v1.9.1: "done" con menos bytes que el total = truncado → tratarlo como error */
          if (st.st === 'done' && st.total > 0 && (st.got || 0) < st.total) {
            job.st = 'err'; job.err = 'conexion cortada al final: queda guardado y se reanuda';
          }
          if (st.st === 'run' || st.st === 'queued') {
            job.st = st.st;
            job.got = st.got || 0;
            job.total = st.total || 0;
            /* Redibujar la lista entera cada 0,9 s reemplazaba los botones Pausar y
               Cancelar entre el toque y el soltar, y el toque se perdia. Solo se
               reconstruye cuando cambia el estado; el resto actualiza en sitio. */
            if (job._shown !== job.st || !App.paintDl(j, job)) {
              job._shown = job.st;
              App.renderModels();
            }
            continue;
          }
          job.st = st.st || 'err';
          job.err = st.err || '';
          var item = modCatByFile(job.name);
          if (job.st === 'done') {
            /* v2.4.0: guardamos el SHA calculado y si el catálogo lo verificó */
            S.dl.done[job.name] = { ts: Date.now(), b: st.got || 0 };
            if (st.sha256) S.dl.done[job.name].sha = st.sha256;
            if (st.verified) S.dl.done[job.name].v = true;
            saveS();
            App.toast('¡Modelo descargado!' + (st.verified ? ' SHA-256 verificado ✓' : '') + ' Toca «Cargar» para usarlo');
            jobOff('Descargado', 3000);
            resting();   /* ya hay un modelo más: el reposo deja de ser 'Sin modelo' */
            if (item && item.eng === 'kiu' && S.kiu.auto) Kiu.load(job.name, null, true);
            App.addActivity('notas', 'Descargué el modelo ' + (item ? item.n : job.name));
          } else if (job.st === 'cancel') {
              jobOff('Cancelado', 2000);
            App.toast('Descarga cancelada · lo que bajó queda guardado para reanudar');
          } else if (job.st === 'err') {
            /* v1.8.0: reintentar solo, reanudando desde donde quedó (.part) */
            var msg = job.err || 'red';
            var diskFull = /space|espacio|No space|ENOSPC/i.test(msg);
            var corrupt = /corrupt|danad|dañad/i.test(msg);
            job.tries = (job.tries || 0) + 1;
            delete Mod.jobs[j];
            if (diskFull) {
              var freeG = Mod.free() ? Mod.gb(Mod.free()) : '0 MB';
              App.toast('No hay espacio libre suficiente (libres: ' + freeG + '). Liberá espacio y tocá «Descargar»: sigue donde quedó.');
              jobErr('Error de descarga', 3000);
            } else if (corrupt) {
              /* v1.9.1: el archivo venía dañado y el motor ya lo borró */
              job.tries = 0;
              App.toast('El archivo bajó dañado y ya lo limpié. Tocá «Descargar»: ahora baja verificado (GGUF) y con reintentos.');
              jobErr('Error de descarga', 3000);
            } else if (job.tries <= 6 && item) {
              var delay = job.tries === 1 ? 3000 : 8000;
              App.toast('Se cortó la descarga · reanudando automáticamente (' + job.tries + '/6)…');
              setTimeout(function () { self.start(item); }, delay);
            } else {
              App.toast('Descarga fallida: ' + msg.slice(0, 60) + ' · tocá «Descargar» de nuevo y sigue donde quedó (no empieza de cero)');
              jobErr('Error de descarga', 3200);
            }
            App.renderModels();
            continue;
          }
          delete self.jobs[j];
          App.renderModels();
        }
      }, 900);
    },
    cancel: function (id) { rawBridge('dlCancel', [id]); },
    del: function (name) {
      var self = this;
      App.confirm('Borrar modelo', 'Se libera ' + this.gb((S.dl.done[name] || {}).b || 0) + ' de espacio. ' + (MODCAT.some(function (m) { return m.f === name; }) ? 'Podés descargarlo de nuevo cuando quieras.' : 'Tendrás que importarlo de nuevo si lo querés usar.'), function () {
        rawBridge('dlDel', [name]);
        delete S.dl.done[name];
        saveS();
        if (S.kiu.name === name) Kiu.unload();
        self.sync(function () { App.toast('Modelo borrado'); App.renderModels(); resting(); });
      });
    },
    gb: function (b) {
      if (!b || b < 1048576) return '0 MB';
      var g = b / 1073741824;
      return g >= 1 ? g.toFixed(1).replace('.', ',') + ' GB' : Math.round(b / 1048576) + ' MB';
    },
    free: function () { return rawBridge('dlFree') || 0; },
    hasKiu: function () {
      var n = 0;
      for (var k in S.dl.done) if (Object.prototype.hasOwnProperty.call(S.dl.done, k) && modCatByFile(k) && modCatByFile(k).eng === 'kiu') n++;
      return n;
    }
  };

  /* ================= v1.7.2: IMPORTAR GGUF DESDE EL TELÉFONO ================= */
  var Imp = {
    timer: null,
    since: 0,
    st: null,
    supported: function () { return !!(BR && BR.importModel && BR.impStatus); },
    start: function () {
      if (!this.supported()) { App.toast('Importar funciona en la app del teléfono (Kiu 2.4.0 o más nueva)'); return; }
      bcrumb('importar gguf');
      jobOn('Importando');
      rawBridge('importModel');
      this.since = Date.now();
      this.poll();
    },
    poll: function () {
      var self = this;
      if (this.timer) return;
      this.timer = setInterval(function () {
        var st = jparse(rawBridge('impStatus') || '{}', {});
        self.st = st;
        if (st.st === 'run') { self.since = Date.now(); App.renderImp(); return; }
        if (st.st === 'cancelled') { self.stop(); jobOff('Cancelado', 2000); App.toast('Importación cancelada'); return; }
        if (st.st === 'done') {
          self.stop();
          Mod.sync(function () {
            App.toast('Modelo importado ✓ ' + (st.name || ''));
            jobOff('Descargado', 3000);
            resting();
            App.addActivity('notas', 'Importé el modelo ' + (st.name || ''));
            if (S.kiu.auto && st.name && !S.kiu.ok && modKind(st.name) === 'text') Kiu.load(st.name, null, true);
            App.renderModels();
            try { if (document.getElementById('prov-list')) App.renderProviders(); } catch (e1) { }
          });
          return;
        }
        if (st.st === 'err') { self.stop(); jobErr('Error de descarga', 3000); App.toast('No pude importar: ' + (st.err || 'error')); try { App.copyText('No pude importar: ' + (st.err || 'error')); } catch (e) {} return; }
        if (Date.now() - self.since > 180000) self.stop();
      }, 700);
    },
    cancel: function () { /* v2.7.4 */
      try { rawBridge('importCancel'); } catch (e) { }
    },
    stop: function () {
      if (this.timer) clearInterval(this.timer);
      this.timer = null;
      this.st = null;
      App.renderImp();
    }
  };

  /* exports del módulo (cross-módulo vía window) */
  window.Mod = Mod;
  window.Imp = Imp;
})();
