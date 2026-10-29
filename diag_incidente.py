#!/usr/bin/env python3
"""Diagnóstico de SOLO LECTURA (2): productos y avisos. Sin datos personales."""
import json, re, urllib.request
js = open('app.js', encoding='utf-8').read(40000)
URL = re.search(r"SUPABASE_URL\s*=\s*'([^']+)'", js).group(1) + '/rest/v1'
KEY = re.search(r"SUPABASE_KEY\s*=\s*'([^']+)'", js).group(1)
def get(path):
    h = {'apikey': KEY, 'Authorization': 'Bearer ' + KEY, 'Accept': 'application/json'}
    with urllib.request.urlopen(urllib.request.Request(URL + path, headers=h), timeout=60) as r:
        return json.loads(r.read().decode('utf-8', 'replace'))
prods = get('/productos?select=id,updated_at,stock:data->>stock,precio:data->>precio,name:data->>name&order=id')
json.dump(prods, open('diag_productos.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=0)
cats = get('/categorias?select=id,updated_at,data&order=id')
json.dump(cats, open('diag_categorias.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=0)
n = get('/meta?select=data&name=eq.notifs')
lst = (n[0]['data'] if n else []) or []
tipos = {}
for x in (lst if isinstance(lst, list) else []):
    k = (x or {}).get('type'); tipos[k] = tipos.get(k, 0) + 1
fechas = sorted(str((x or {}).get('ts', ''))[:10] for x in (lst if isinstance(lst, list) else []))
open('diag_incidente.txt', 'w').write(f"notifs: {len(lst)} tipos {tipos} fechas {fechas[:1]}..{fechas[-1:]}\nproductos: {len(prods)} categorias: {len(cats)}\n")
