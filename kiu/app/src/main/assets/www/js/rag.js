/* rag.js — v3.1.0 (tanda 8): RAG LOCAL de Kiu sobre IndexedDB + Web Worker
 * Leé tus PDFs / notas / .txt y Kiu los usa para responder.
 * - 100% local: los documentos NUNCA salen del teléfono
 * - Persistencia en IndexedDB (fallback localStorage si no hay IDB)
 * - Ranking BM25 (k1=1,4 · b=0,75) con IDF propio del corpus
 * - NUEVO tanda 8: la fragmentación de texto y el cálculo de similitud
 *   corren en un Web Worker (js/rag-worker.js, mismo patrón que pdf.js),
 *   así procesar documentos grandes NO congela la UI ni las animaciones.
 *   El núcleo matemático (KiuRagCore) es UN solo archivo compartido entre
 *   el hilo principal y el worker; sin worker, todo queda como antes.
 * - Migración única: el 'nexo_rag' viejo se pasa a IDB en el primer arranque
 * - Los PDFs se procesan con pdf.js (se descarga solo al agregar el primero)
 * API pública intacta: RAG.on / docs / search(q,k) / addFile / del / toggle /
 * stats / render / init  (+ exportAll / importAll, y nuevos hits / searchAsync /
 * ctxFor para los módulos que prefieren async o resultados estructurados).
 */
(function () {
  'use strict';

  var MAX = 8000000;        // caracteres totales guardados (~8 MB; antes 0,8 MB)

  /* núcleo compartido (rag-worker.js también vive en el hilo principal) */
  var CORE = (typeof window !== 'undefined' && window.KiuRagCore) || null;

  function rStore(k, v) {
    try {
      if (arguments.length > 1) { localStorage.setItem(k, JSON.stringify(v)); return true; }
      var s = localStorage.getItem(k);
      return s ? JSON.parse(s) : null;
    } catch (e) { return null; }
  }

  /* ================= almacenamiento: IndexedDB con fallback ================= */
  var HAS_IDB = false;
  try { HAS_IDB = typeof indexedDB !== 'undefined' && !!indexedDB.open; } catch (e0) { HAS_IDB = false; }

  function idbOpen(cb) {
    try {
      var req = indexedDB.open('kiu-rag', 1);
      req.onupgradeneeded = function (ev) {
        var db = ev.target.result;
        if (!db.objectStoreNames.contains('docs')) db.createObjectStore('docs', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('chunks')) db.createObjectStore('chunks', { keyPath: 'key' });
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'k' });
      };
      req.onsuccess = function (ev) { cb(null, ev.target.result); };
      req.onerror = function () { cb('no pude abrir IndexedDB'); };
      req.onblocked = function () { cb('IndexedDB bloqueada'); };
    } catch (e) { cb('IndexedDB no disponible'); }
  }
  function idbWrite(db, stores, fn, cb) {
    try {
      var tx = db.transaction(stores, 'readwrite');
      fn(tx);
      tx.oncomplete = function () { cb(null); };
      tx.onerror = function () { cb(tx.error && tx.error.message || 'error de escritura'); };
      tx.onabort = function () { cb('escritura abortada'); };
    } catch (e) { cb(String(e && e.message || e)); }
  }
  function idbGetAll(db, store, cb) {
    try {
      var tx = db.transaction([store], 'readonly');
      var st = tx.objectStore(store);
      var req = st.getAll ? st.getAll() : null;
      if (req) {
        req.onsuccess = function () { cb(null, req.result || []); };
        req.onerror = function () { cb('error de lectura'); };
      } else {
        /* getAll no existe (WebView muy viejo): cursor */
        var out = [];
        var cur = st.openCursor();
        cur.onsuccess = function (ev) {
          var c = ev.target.result;
          if (c) { out.push(c.value); c.continue(); }
          else cb(null, out);
        };
        cur.onerror = function () { cb('error de lectura'); };
      }
    } catch (e) { cb(String(e && e.message || e)); }
  }

  /* ================= índice en memoria =================
   * rows: [{ doc, ci, text, tf, len }] — text vive en RAM para poder inyectar
   * el fragmento al prompt sin esperas; tf/len precalculados al indexar.
   * La matemática (tf/BM25) vive en KiuRagCore (rag-worker.js).             */
  var RAG = {
    on: false,
    docs: [],            // [{id,name,ext,ts,n}] (meta; el texto vive en rows/IDB)
    _rows: [],           // filas del índice
    _df: {},             // document frequency por término
    _N: 0,               // cantidad de filas
    _len: 0,             // suma de longitudes (para avgLen)
    _bytes: 0,           // caracteres guardados
    _mode: HAS_IDB ? 'idb' : 'ls',
    _db: null,
    _wk: null,           // Web Worker (o null si no está disponible)
    _wkSeq: 0,           // ids de mensajes
    _wkWait: {},         // callbacks pendientes por id
    _wkDead: false,      // el worker falló: no reintentar

    /* ---------- tokenización / fragmentación (delegado al núcleo) ---------- */
    tok: function (s) { return CORE ? CORE.tok(s) : []; },
    chunk: function (text) { return CORE ? CORE.chunk(text) : []; },

    /* filas desde fragmentos: tf precalculado una sola vez */
    _mkRows: function (docId, chunks) {
      return CORE ? CORE.mkRows(docId, chunks) : [];
    },
    _addRows: function (rows) {
      for (var i = 0; i < rows.length; i++) {
        var r = rows[i];
        this._rows.push(r);
        this._N++;
        this._len += r.len;
        this._bytes += r.text.length;
        for (var w in r.tf) if (Object.prototype.hasOwnProperty.call(r.tf, w)) this._df[w] = (this._df[w] || 0) + 1;
      }
    },
    _dropDoc: function (docId) {
      var keep = [], removed = [];
      for (var i = 0; i < this._rows.length; i++) {
        if (this._rows[i].doc === docId) removed.push(this._rows[i]);
        else keep.push(this._rows[i]);
      }
      this._rows = keep;
      for (var r = 0; r < removed.length; r++) {
        this._N--;
        this._len -= removed[r].len;
        this._bytes -= removed[r].text.length;
        for (var w in removed[r].tf) {
          if (Object.prototype.hasOwnProperty.call(removed[r].tf, w)) {
            this._df[w]--;
            if (this._df[w] <= 0) delete this._df[w];
          }
        }
      }
      return removed.length;
    },

    /* ================= Web Worker (tanda 8) =================
     * Espeja el índice (sin textos) y resuelve búsqueda/preparación fuera
     * del hilo de la UI. Si no hay Worker (VM de tests, WebView vetusto),
     * todo cae a las rutas síncronas de siempre. */
    _wkMsg: function (payload, cb) {
      var wk = this._wk;
      if (!wk || this._wkDead) { cb(null); return; }
      var id = 'm' + (++this._wkSeq);
      this._wkWait[id] = cb;
      try { wk.postMessage({ id: id, op: payload.op, docId: payload.docId, text: payload.text, chunks: payload.chunks, rows: payload.rows, q: payload.q, k: payload.k }); }
      catch (e) { delete this._wkWait[id]; this._wkDead = true; this._wk = null; cb(null); }
    },
    _wkRecv: function (data) {
      var cb = data && data.id ? this._wkWait[data.id] : null;
      if (data && data.id) delete this._wkWait[data.id];
      if (!cb) return;
      if (!data || data.ok === false) cb(null);
      else cb(data);
    },
    _wkBoot: function () {
      if (this._wk || this._wkDead) return;
      if (typeof Worker === 'undefined') return;
      try {
        var wk = new Worker('js/rag-worker.js');
        var self = this;
        wk.onerror = function () { self._wkDead = true; self._wk = null; };
        wk.onmessage = function (ev) { try { self._wkRecv(ev.data); } catch (e) { } };
        this._wk = wk;
      } catch (e) { this._wk = null; }
    },
    /* manda el espejo del índice (filas sin texto) al worker */
    _syncWorker: function () {
      if (!this._wk || this._wkDead) return;
      var rows = [];
      for (var i = 0; i < this._rows.length; i++) {
        var r = this._rows[i];
        rows.push({ key: r.key, doc: r.doc, ci: r.ci, tf: r.tf, len: r.len });
      }
      this._wkMsg({ op: 'sync', rows: rows }, function () { });
    },

    /* ---------- búsqueda BM25 ----------
     * Síncrona (compatibilidad total con lo que ya existía): usa el índice
     * local. Con worker vivo, searchAsync hace el mismo cálculo fuera de la
     * UI; search() queda como ruta instantánea y de respaldo.             */
    search: function (q, k) {
      try {
        if (!this.on || !this.docs.length || !CORE) return null;
        var hits = this.hits(q, k || 3);
        if (!hits.length) return null;
        var out = [];
        for (var i = 0; i < hits.length; i++) {
          var h = hits[i];
          out.push('[' + h.name + ' · parte ' + (h.ci + 1) + ']\n' + h.text.slice(0, 420));
        }
        return out.join('\n\n---\n\n');
      } catch (e) { return null; }
    },
    /* NUEVO v2.7: resultados estructurados (los consumía react.js pero
     * search devolvía un string — descontrato corregido). */
    hits: function (q, k) {
      try {
        if (!this.on || !this.docs.length || !CORE || !this._N) return [];
        var top = (CORE.scoreHybrid || CORE.score)(q, this._rows, this._df, this._N, this._len, k || 3);
        if (!top.length) return [];
        var byKey = {};
        for (var i = 0; i < this._rows.length; i++) byKey[this._rows[i].key] = this._rows[i];
        var out = [];
        for (var j = 0; j < top.length; j++) {
          var row = byKey[top[j].key];
          if (!row) continue;
          var doc = this.docById(row.doc);
          if (!doc) continue;
          out.push({ key: row.key, doc: row.doc, name: doc.name, ci: row.ci, text: row.text, s: top[j].s });
        }
        return out;
      } catch (e) { return []; }
    },
    /* NUEVO v2.7: búsqueda en el Web Worker (no congela la UI). cb(str|null)
     * con el MISMO formato que search(). Si el worker no está, responde al
     * toque con la ruta síncrona. Con guardia de tiempo por si el worker
     * se cuelga: 2 s y contesta con el índice local. */
    searchAsync: function (q, k, cb) {
      var self = this;
      // Si hay un proveedor de embeddings locales real instalado, se usa para
      // reranking semántico. Sin modelo/proveedor, se conserva exactamente la
      // ruta híbrida anterior (sin red ni dependencia adicional).
      var localEmb = (typeof window !== 'undefined' && window.KiuLocalEmbeddings) || null;
      if (localEmb && localEmb.isReady && localEmb.isReady() && typeof Promise !== 'undefined') {
        localEmb.rank(q, this._rows, CORE, k || 3).then(function (hits) {
          var byKey = {};
          for (var i = 0; i < self._rows.length; i++) byKey[self._rows[i].key] = self._rows[i];
          var out = [];
          for (var j = 0; j < hits.length; j++) {
            var row = byKey[hits[j].key];
            if (!row) continue;
            var doc = self.docById(row.doc);
            if (doc) out.push('[' + doc.name + ' · parte ' + (row.ci + 1) + ']\n' + row.text.slice(0, 420));
          }
          cb(out.length ? out.join('\n\n---\n\n') : self.search(q, k));
        }).catch(function () { cb(self.search(q, k)); });
        return;
      }
      if (!this._wk || this._wkDead) { cb(this.search(q, k)); return; }
      var done = false;
      var finish = function (v) { if (!done) { done = true; cb(v); } };
      var to = setTimeout(function () { finish(self.search(q, k)); }, 2000);
      this._wkMsg({ op: 'search', q: q, k: k || 3 }, function (d) {
        clearTimeout(to);
        if (done) return;
        var hits = (d && d.hits) || [];
        if (!hits.length) { finish(null); return; }
        var byKey = {};
        for (var i = 0; i < self._rows.length; i++) byKey[self._rows[i].key] = self._rows[i];
        var out = [];
        for (var m = 0; m < hits.length; m++) {
          var row = byKey[hits[m].key];
          if (!row) continue;
          var doc = self.docById(row.doc);
          if (!doc) continue;
          out.push('[' + doc.name + ' · parte ' + (row.ci + 1) + ']\n' + row.text.slice(0, 420));
        }
        finish(out.length ? out.join('\n\n---\n\n') : null);
      });
    },
    /* NUEVO v2.7: contexto de documentos listo para inyectar en el prompt.
     * Usado por app-ui (kiuReply / apiStream) para no bloquear la UI. */
    ctxFor: function (q, k, cb) {
      if (!this.on || !this.docs.length) { cb(null); return; }
      this.searchAsync(q, k, cb);
    },
    docById: function (id) {
      for (var i = 0; i < this.docs.length; i++) if (this.docs[i].id === id) return this.docs[i];
      return null;
    },

    /* ---------- persistencia ---------- */
    load: function (cb) {
      var self = this;
      this._wkBoot();
      var done = function () { self._syncWorker(); if (cb) cb(); };
      if (!HAS_IDB) {
        /* modo localStorage (igual al v1, con BM25 en memoria) */
        var d = rStore('nexo_rag');
        if (d && typeof d === 'object') {
          this.docs = d.docs || [];
          this.on = !!d.on;
          var all = [];
          for (var i = 0; i < this.docs.length; i++) {
            var doc = this.docs[i];
            if (!doc.chunks) continue;
            all = all.concat(this._mkRows(doc.id, doc.chunks));
            doc.n = doc.chunks.length;
          }
          this._addRows(all);
        }
        this._mode = 'ls';
        done();
        return;
      }
      idbOpen(function (err, db) {
        if (err || !db) { self._mode = 'ls'; self._loadLs(); done(); return; }
        self._db = db;
        var finish = function () {
          idbGetAll(db, 'meta', function (e2, metas) {
            var st = null;
            for (var i = 0; i < (metas || []).length; i++) if (metas[i].k === 'state') st = metas[i];
            if (st) self.on = !!st.on;
            done();
          });
        };
        idbGetAll(db, 'docs', function (e1, docs) {
          idbGetAll(db, 'chunks', function (e2, chunks) {
            if ((e1 || e2) || !(docs || []).length) {
              /* primera vez con IDB: ¿hay datos del formato viejo para migrar? */
              self._migrateOld(function (migrated) {
                if (migrated) finish();
                else { self.docs = []; finish(); }
              });
              return;
            }
            self.docs = docs || [];
            self._addRows(chunks || []);
            finish();
          });
        });
      });
    },
    _loadLs: function () {
      var d = rStore('nexo_rag');
      if (d && typeof d === 'object') {
        this.docs = d.docs || [];
        this.on = !!d.on;
        var all = [];
        for (var i = 0; i < this.docs.length; i++) {
          var doc = this.docs[i];
          if (!doc.chunks) continue;
          all = all.concat(this._mkRows(doc.id, doc.chunks));
          doc.n = doc.chunks.length;
        }
        this._addRows(all);
      }
      this._mode = 'ls';
    },
    /* migra el 'nexo_rag' de localStorage hacia IDB (una sola vez) */
    _migrateOld: function (cb) {
      var self = this;
      var old = rStore('nexo_rag');
      if (!old || !old.docs || !old.docs.length) { cb(false); return; }
      var docs = [], rows = [];
      for (var i = 0; i < old.docs.length; i++) {
        var d0 = old.docs[i];
        if (!d0.chunks || !d0.chunks.length) continue;
        var id = d0.id || ('d' + Date.now() + '_' + i);
        docs.push({ id: id, name: d0.name, ext: d0.ext || 'txt', ts: d0.ts || Date.now(), n: d0.chunks.length });
        rows = rows.concat(this._mkRows(id, d0.chunks));
      }
      if (!docs.length) { cb(false); return; }
      var db = this._db;
      idbWrite(db, ['docs', 'chunks', 'meta'], function (tx) {
        var sd = tx.objectStore('docs'), sc = tx.objectStore('chunks'), sm = tx.objectStore('meta');
        for (var a = 0; a < docs.length; a++) sd.put(docs[a]);
        for (var b = 0; b < rows.length; b++) sc.put(rows[b]);
        sm.put({ k: 'state', on: !!old.on });
      }, function (err) {
        if (err) { cb(false); return; }
        self.docs = docs;
        self.on = !!old.on;
        self._addRows(rows);
        try { localStorage.removeItem('nexo_rag'); } catch (eR) { }
        cb(true);
      });
    },
    save: function (cb) {
      var self = this;
      if (this._mode !== 'idb' || !this._db) {
        /* modo ls: serializa con los textos dentro (formato viejo) */
        var docs = [];
        for (var i = 0; i < this.docs.length; i++) {
          var d0 = this.docs[i];
          var chunks = [];
          for (var j = 0; j < this._rows.length; j++) if (this._rows[j].doc === d0.id) chunks.push(this._rows[j].text);
          var copy = {};
          for (var kk in d0) if (Object.prototype.hasOwnProperty.call(d0, kk)) copy[kk] = d0[kk];
          copy.chunks = chunks;
          docs.push(copy);
        }
        rStore('nexo_rag', { docs: docs, on: this.on });
        if (cb) cb(null);
        return;
      }
      idbWrite(this._db, ['meta'], function (tx) {
        tx.objectStore('meta').put({ k: 'state', on: self.on });
      }, function (err) { if (cb) cb(err); });
    },

    /* ---------- alta / baja de documentos ---------- */
    _overCap: function (addChars) {
      return this._bytes + addChars > MAX;
    },
    addText: function (name, ext, text, cb) {
      var self = this;
      if (!CORE) { cb('Núcleo RAG no disponible'); return; }
      /* tanda 8: la fragmentación + tf corre en el worker si hay (un doc de
       * 30 MB ya no congela el hilo de la UI); si no, ruta síncrona igual a v3 */
      var id = 'd' + Date.now() + '_' + Math.floor(Math.random() * 1e6).toString(36); /* v2.7.4: dos archivos en el mismo ms chocaban */
      var mk = function (chunks) {
        var rows = self._mkRows(id, chunks);
        return { rows: rows, bytes: rows.reduce(function (a, r) { return a + r.text.length; }, 0) };
      };
      var proceed = function (chunks) {
        if (!chunks.length) { cb('No encontré texto útil en ' + name); return; }
        var built = mk(chunks);
        var rows = built.rows, add = built.bytes;
        if (self._overCap(add)) { cb('Memoria de documentos llena (' + Math.round(self._bytes / 1048576) + ' MB de ~8 MB): borrá alguno y volvé a probar'); return; }
        var doc = { id: id, name: String(name || 'documento').replace(/\.[^.]+$/, ''), ext: ext || 'txt', ts: Date.now(), n: chunks.length };
        var finish = function (err) {
          if (err) { cb(err); return; }
          self.docs.push(doc);
          self._addRows(rows);
          self._syncWorker();
          cb(null, doc, rows.length);
        };
        if (self._mode === 'idb' && self._db) {
          idbWrite(self._db, ['docs', 'chunks', 'meta'], function (tx) {
            tx.objectStore('docs').put(doc);
            for (var b = 0; b < rows.length; b++) tx.objectStore('chunks').put(rows[b]);
          }, finish);
        } else finish(null);
      };
      if (this._wk && !this._wkDead) {
        this._wkMsg({ op: 'prep', docId: id, text: String(text || '') }, function (d) {
          proceed((d && d.chunks) || []);
        });
      } else {
        proceed(this.chunk(text));
      }
    },
    del: function (id) {
      var self = this;
      for (var i = 0; i < this.docs.length; i++) if (this.docs[i].id === id) { this.docs.splice(i, 1); break; }
      this._dropDoc(id);
      this._syncWorker();
      if (this._mode === 'idb' && this._db) {
        idbWrite(this._db, ['docs', 'chunks'], function (tx) {
          tx.objectStore('docs').delete(id);
          /* borra todos los chunks del doc: rango por prefijo id# */
          var st = tx.objectStore('chunks');
          try {
            var range = IDBKeyRange.bound(id + '#', id + '#\uffff', false, false);
            var cur = st.openCursor(range);
            cur.onsuccess = function (ev) {
              var c = ev.target.result;
              if (c) { c.delete(); c.continue(); }
            };
          } catch (e0) { }
        }, function () { self.render(); });
      } else {
        this.save();
        this.render();
      }
    },
    toggle: function (v) {
      var self = this;
      this.on = !!v;
      this.save(function () { });
      this.render();
      /* v2.8.0: la capa 'rag' queda pegada en el estado real (activo o apagado),
         no es un aviso de 2,5 s: 'RAG apagado' era uno de los estados que nunca
         se veían porque solo se pintaba un instante. */
      var k0 = window.KiuState;
      if (k0) { k0.set('rag', this.on ? 'RAG activo' : 'RAG apagado'); k0.flash('flash', this.on ? 'RAG activo' : 'RAG apagado', 2500); }
      App.toast(this.on ? 'RAG activado: Kiu leerá tus documentos' : 'RAG desactivado');
      if (this._mode === 'idb' && this._db) {
        idbWrite(this._db, ['meta'], function (tx) {
          tx.objectStore('meta').put({ k: 'state', on: self.on });
        }, function () { });
      }
    },

    /* ---------- copia de seguridad (SAF, tanda 4) ---------- */
    exportAll: function (cb) {
      var self = this;
      var chunks = [];
      for (var i = 0; i < this._rows.length; i++) chunks.push({ doc: this._rows[i].doc, ci: this._rows[i].ci, text: this._rows[i].text });
      cb({ v: 3, on: this.on, mode: this._mode, docs: this.docs, chunks: chunks });
    },
    importAll: function (data, cb) {
      var self = this;
      try {
        if (!data || data.v !== 3 || !Array.isArray(data.docs)) { cb('copia no reconocida'); return; }
        var docs = data.docs, rows = [];
        for (var i = 0; i < docs.length; i++) {
          var d0 = docs[i];
          if (!d0.id) { cb('copia dañada (doc sin id)'); return; }
          rows = rows.concat(this._mkRows(d0.id, (d0.chunks && d0.chunks.length) ? d0.chunks : []));
        }
        /* los chunks vienen aparte (formato exportAll): respétalos si existen */
        if (Array.isArray(data.chunks) && data.chunks.length) {
          rows = CORE ? CORE.mkRows('', data.chunks.map(function (c) { return c.text; })) : [];
          /* re-key con el doc/ci originales de la copia */
          for (var c = 0; c < data.chunks.length && c < rows.length; c++) {
            rows[c].key = data.chunks[c].doc + '#' + data.chunks[c].ci;
            rows[c].doc = data.chunks[c].doc;
            rows[c].ci = data.chunks[c].ci;
          }
          for (var d2 = 0; d2 < docs.length; d2++) docs[d2].n = 0;
          for (var r2 = 0; r2 < rows.length; r2++) {
            for (var d3 = 0; d3 < docs.length; d3++) if (docs[d3].id === rows[r2].doc) docs[d3].n++;
          }
        }
        var finish = function (err) {
          if (err) { cb(err); return; }
          self.docs = docs;
          self._rows = [];
          self._df = {};
          self._N = 0; self._len = 0; self._bytes = 0;
          self._addRows(rows);
          self._syncWorker();
          cb(null, { docs: docs.length, chunks: rows.length });
        };
        if (this._mode === 'idb' && this._db) {
          idbWrite(this._db, ['docs', 'chunks', 'meta'], function (tx) {
            var sd = tx.objectStore('docs'), sc = tx.objectStore('chunks'), sm = tx.objectStore('meta');
            sd.clear(); sc.clear();
            for (var a = 0; a < docs.length; a++) sd.put(docs[a]);
            for (var b = 0; b < rows.length; b++) sc.put(rows[b]);
            sm.put({ k: 'state', on: !!data.on });
          }, finish);
        } else finish(null);
      } catch (e) { cb(String(e && e.message || e)); }
    },

    stats: function () {
      return { docs: this.docs.length, chunks: this._N, bytes: this._bytes, mode: this._mode, max: MAX, worker: !!(this._wk && !this._wkDead) };
    },

    /* ---------- carga de archivos ---------- */
    _script: function (src, cb) {
      var s = document.createElement('script');
      s.src = src;
      s.onload = function () { cb(null); };
      s.onerror = function () { cb('error cargando ' + src); };
      document.head.appendChild(s);
    },
    ensurePdf: function (cb) {
      if (window.pdfjsLib) return cb(null);
      var self = this;
      this._script('js/vendor/pdf.min.js', function (e1) {
        if (e1) return cb(e1);
        self._script('js/vendor/pdf.worker.min.js', function (e2) {
          try {
            if (window.pdfjsLib.GlobalWorkerOptions) window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'js/vendor/pdf.worker.min.js';
          } catch (e3) { }
          cb(window.pdfjsLib ? null : 'pdf.js no disponible');
        });
      });
    },
    _readPdf: function (file, cb) {
      var self = this;
      this.ensurePdf(function (err) {
        if (err) { cb(null, 'No pude cargar el lector de PDFs (¿sin almacenamiento?): ' + err); return; }
        var fr = new FileReader();
        fr.onload = function () {
          try {
            window.pdfjsLib.getDocument({ data: new Uint8Array(fr.result), isEvalSupported: false }).promise.then(function (pdf) {
              var pages = [], done = 0;
              var cap = Math.min(pdf.numPages, 60);
              for (var p = 1; p <= cap; p++) {
                (function (pn) {
                  pdf.getPage(pn).then(function (page) {
                    return page.getTextContent();
                  }).then(function (tc) {
                    var line = '';
                    for (var it = 0; it < tc.items.length; it++) line += tc.items[it].str + ' ';
                    pages[pn - 1] = '\n\n' + line.trim();
                    done++;
                    if (done === cap) cb(pages.join(' '), null);
                  }).catch(function () { done++; if (done === cap) cb(pages.join(' '), null); });
                })(p);
              }
            }).catch(function (e) { cb(null, 'PDF ilegible: ' + (e && e.message ? e.message : 'error')); });
          } catch (e2) { cb(null, 'PDF ilegible: ' + e2.message); }
        };
        fr.onerror = function () { cb(null, 'No pude leer el archivo'); };
        fr.readAsArrayBuffer(file);
      });
    },
    addFile: function (file) {
      var self = this;
      if (!file) return;
      var isPdf = /\.pdf$/i.test(file.name);
      var isTxt = /\.(txt|md|markdown|csv|log|json)$/i.test(file.name);
      if (!isPdf && !isTxt) { App.toast('Formato no soportado: usá PDF, TXT, MD, CSV o JSON'); return; }
      if (file.size > 30 * 1048576) { App.toast('Archivo muy grande (máx 30 MB)'); return; }
      App.toast('Leyendo ' + file.name + '…');
      var k1 = window.KiuState;
      if (k1) k1.set('rag', 'Indexando');
      var fin = function (text, err) {
        if (err) { App.toast(err); return; }
        self.addText(file.name, isPdf ? 'pdf' : 'txt', String(text || ''), function (err2, doc, n) {
          if (err2) { App.toast(err2); return; }
          self.render();
          if (k1) { k1.set('rag', 'RAG activo'); k1.flash('flash', 'RAG activo', 2500); }
          App.toast('Documentos: ' + doc.name + ' indexado (' + n + ' fragmentos)');
        });
      };
      if (isPdf) this._readPdf(file, fin);
      else {
        var fr = new FileReader();
        fr.onload = function () { fin(String(fr.result || ''), null); };
        fr.onerror = function () { fin(null, 'No pude leer el archivo'); };
        fr.readAsText(file, 'utf-8');
      }
    },

    /* ---------- UI (dentro de Memoria) ---------- */
    esc: function (s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); },
    render: function () {
      var host = document.getElementById('rag-card');
      if (!host) return;
      var st = this.stats();
      var mb = (st.bytes / 1048576);
      var h = '';
      h += '<div style="display:flex;align-items:center;gap:10px;margin:18px 2px 8px">';
      h += '<span class="ic" style="font-size:20px;color:#7c5cff">📄</span>';
      h += '<div style="flex:1"><strong style="font-size:15px">Documentos (RAG)</strong>';
      h += '<div style="font-size:12px;opacity:.65">PDFs y notas que Kiu lee para responder mejor · hasta ~8 MB</div></div>';
      h += '<button id="rag-toggle" type="button" style="border:0;border-radius:20px;padding:6px 14px;font-weight:600;font-size:12px;cursor:pointer;' + (this.on ? 'background:#7c5cff;color:#fff' : 'background:rgba(127,127,127,.18);color:inherit') + '">' + (this.on ? 'ACTIVO' : 'APAGADO') + '</button>';
      h += '</div>';
      h += '<button id="rag-add" type="button" class="btn-ghost full" style="justify-content:center;margin:2px 0 10px">＋ Agregar PDF / nota (.pdf .txt .md .csv)</button>';
      h += '<input type="file" id="rag-file" accept=".pdf,.txt,.md,.markdown,.csv,.log,.json" style="display:none">';
      h += '<div style="font-size:12px;opacity:.7;margin:0 2px 6px">' + (st.docs
        ? st.docs + ' documento' + (st.docs > 1 ? 's' : '') + ' · ' + st.chunks + ' fragmentos · ' + (mb >= 0.1 ? mb.toFixed(1).replace('.', ',') + ' MB' : Math.round(st.bytes) + ' caracteres') + ' · 100% local'
        : 'Todavía no hay documentos. Agregá uno y preguntale cosas sobre él.') + '</div>';
      if (this.docs.length) {
        h += '<div class="list" style="margin:4px 0 12px">';
        for (var i = 0; i < this.docs.length; i++) {
          var d = this.docs[i];
          h += '<div style="display:flex;align-items:center;gap:10px;padding:9px 4px;border-bottom:1px solid rgba(127,127,127,.15)">';
          h += '<div style="flex:1;min-width:0"><div style="font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + this.esc(d.name) + '</div>';
          h += '<div style="font-size:11px;opacity:.6">' + (d.n || 0) + ' fragmentos · ' + (d.ext || 'txt') + '</div></div>';
          h += '<button class="rag-del" data-id="' + d.id + '" type="button" style="border:0;background:rgba(255,80,80,.12);color:#ff5a5a;border-radius:14px;padding:5px 12px;font-size:11px;font-weight:700;cursor:pointer">Borrar</button>';
          h += '</div>';
        }
        h += '</div>';
      }
      host.innerHTML = h;

      var tg = document.getElementById('rag-toggle');
      if (tg) tg.addEventListener('click', function () { RAG.toggle(!RAG.on); });
      var add = document.getElementById('rag-add');
      if (add) add.addEventListener('click', function () { var f = document.getElementById('rag-file'); if (f) f.click(); });
      var fi = document.getElementById('rag-file');
      if (fi) fi.addEventListener('change', function () {
        if (this.files && this.files[0]) RAG.addFile(this.files[0]);
        this.value = '';
      });
      var dels = host.querySelectorAll('.rag-del');
      for (var j = 0; j < dels.length; j++) {
        (function (btn) {
          btn.addEventListener('click', function () { RAG.del(btn.getAttribute('data-id')); });
        })(dels[j]);
      }
    },
    init: function () {
      var self = this;
      this.load(function () {
        self.render();
        setTimeout(function () { self.render(); }, 600);
      });
    }
  };

  window.RAG = RAG;
  try { RAG.init(); } catch (e) { }
})();
