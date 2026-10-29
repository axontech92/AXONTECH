#!/usr/bin/env python3
"""Diagnóstico de SOLO LECTURA del incidente del 29/10. Repo público: no imprime
nombres, teléfonos ni clientes; solo ids, fechas, estados y cuentas."""
import json, re, os, urllib.request, collections
js = open('app.js', encoding='utf-8').read(40000)
URL = re.search(r"SUPABASE_URL\s*=\s*'([^']+)'", js).group(1) + '/rest/v1'
KEY = re.search(r"SUPABASE_KEY\s*=\s*'([^']+)'", js).group(1)
out = []
def p(*a): out.append(' '.join(str(x) for x in a))
def get(path, rng=None):
    h = {'apikey': KEY, 'Authorization': 'Bearer ' + KEY, 'Accept': 'application/json'}
    if rng: h['Range'] = rng; h['Range-Unit'] = 'items'
    with urllib.request.urlopen(urllib.request.Request(URL + path, headers=h), timeout=60) as r:
        return json.loads(r.read().decode('utf-8', 'replace'))
def todo(path):
    filas, i = [], 0
    while True:
        lote = get(path, f'{i}-{i+999}')
        filas += lote
        if len(lote) < 1000: return filas
        i += 1000
try:
    v = todo('/vales?select=id,updated_at,ts:data->>ts,st:data->>status,g:data->>gestorId,num:data->>valeNum,sd:data->>stockDecremented,rev:data->>rev,nested:data->>cliente&order=id')
    p('VALES filas:', len(v))
    viejo = [x for x in v if x.get('nested') is None and x.get('ts') is None]
    p('filas formato antiguo (sin ts propio):', len(viejo), [x['id'] for x in viejo][:20])
    porDia = collections.Counter((x.get('ts') or '????')[:10] for x in v)
    p('\nVales por FECHA DE VENTA (data.ts):')
    for d, n in sorted(porDia.items()): p(' ', d, n)
    porUpd = collections.Counter((x.get('updated_at') or '????')[:13] for x in v)
    p('\nFilas por ÚLTIMA ESCRITURA (updated_at, por hora UTC), últimas 40:')
    for d, n in sorted(porUpd.items())[-40:]: p(' ', d, n)
    p('\nEstados:', dict(collections.Counter(x.get('st') for x in v)))
    rec = [x for x in v if (x.get('ts') or '') >= '2026-10-23']
    p('\nVales con fecha >= 2026-10-23:', len(rec))
    for x in rec[:200]: p('  id', x['id'], 'num', x.get('num'), 'ts', x.get('ts'), 'st', x.get('st'), 'upd', x.get('updated_at'))
    p('\nRango de ids:', v[0]['id'] if v else None, '…', v[-1]['id'] if v else None)
except Exception as e: p('ERROR vales:', e)
for t in ['productos', 'gestores', 'mensajeros', 'categorias']:
    try:
        f = todo(f'/{t}?select=id,updated_at')
        u = sorted(x.get('updated_at') or '' for x in f)
        p(f'\n{t.upper()}: {len(f)} filas · última escritura {u[-1] if u else None} · escritas desde 29/10: {sum(1 for x in u if x >= "2026-10-29")}')
    except Exception as e: p('ERROR', t, e)
try:
    m = get('/meta?select=name,updated_at&order=updated_at.desc')
    p('\nMETA (documentos):'); [p(' ', x['name'], x['updated_at']) for x in m]
except Exception as e: p('ERROR meta:', e)
try:
    b = get('/backups?select=name,updated_at&order=updated_at.desc&limit=50')
    p('\nBACKUPS en la nube:', len(b)); [p(' ', x['name'], x['updated_at']) for x in b]
except Exception as e: p('ERROR backups:', e)
try:
    l = get('/meta?select=data&name=eq.vales_borrados')
    d = (l[0]['data'] if l else {}) or {}
    vivas = {k: v for k, v in d.items() if v}
    p('\nLÁPIDAS (vales borrados a propósito):', len(vivas), 'fechas', sorted(set(str(x)[:10] for x in vivas.values()))[-15:])
except Exception as e: p('ERROR lapidas:', e)
for fn in ['vale_eventos?select=op&limit=1', 'rpc/x_no_existe']:
    pass
try:
    e = get('/vale_eventos?select=op,vale_id,creado&order=creado.desc&limit=30')
    p('\nVALE_EVENTOS (migración v143 ejecutada):', len(e)); [p(' ', x['vale_id'], x['creado']) for x in e]
except Exception as ex: p('\nvale_eventos: no existe (migración v143 NO ejecutada)', ex)
open('diag_incidente.txt', 'w', encoding='utf-8').write('\n'.join(out) + '\n')
print('\n'.join(out))
