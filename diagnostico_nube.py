#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
AXONTECH · Qué hay de verdad en la nube

Se lanza a mano desde Actions (botón "Revisar la nube") cuando algo no cuadra
entre lo que enseña un teléfono y lo que debería. Mirar el código dice lo que
DEBERÍA pasar; esto dice lo que HAY.

Nació el 17/08/2026: los gestores veían la tasa sin el margen y no había forma
de saber, desde fuera, si el margen estaba en la nube y no llegaba, o si
directamente ya no estaba. Dos arreglos distintos según la respuesta.

⚠ Este repositorio es PÚBLICO y los registros de Actions también. Aquí NO se
imprime nada personal: ni nombres, ni teléfonos, ni clientes, ni direcciones.
Solo cuentas, claves presentes y los números de la tasa. Si algún día hace falta
mirar un dato con nombre, se mira desde el panel de Supabase, no desde aquí.
"""

import json
import os
import re
import sys
import urllib.error
import urllib.request

RAIZ = os.path.dirname(os.path.abspath(__file__))
TIMEOUT = 25


def log(m):
    print(m, flush=True)


def credenciales():
    """Saca la dirección y la clave pública del propio app.js.

    La clave `anon` de Supabase viaja dentro de la app que se descarga cualquier
    navegador: no es un secreto y por eso no hace falta guardarla en Actions.
    Leerla de app.js evita además que este script y la app se desincronicen.
    """
    js = open(os.path.join(RAIZ, 'app.js'), encoding='utf-8').read(20000)
    url = re.search(r"SUPABASE_URL\s*=\s*'([^']+)'", js)
    key = re.search(r"SUPABASE_ANON_KEY\s*=\s*'([^']+)'", js)
    if not url or not key:
        log('✗ No se encontraron SUPABASE_URL / SUPABASE_ANON_KEY en app.js')
        sys.exit(1)
    return url.group(1) + '/rest/v1', key.group(1)


def pedir(base, clave, ruta):
    req = urllib.request.Request(base + ruta, headers={
        'apikey': clave, 'Authorization': 'Bearer ' + clave, 'Accept': 'application/json'})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
        return json.loads(r.read().decode('utf-8', 'replace'))


def revisar_config(base, clave):
    log('\n── config compartido (meta/config) ────────────────────────────────')
    try:
        filas = pedir(base, clave, '/meta?select=data&name=eq.config')
    except Exception as e:
        log(f'  ✗ no se pudo leer: {e}')
        return
    if not filas:
        log('  ⚠ NO EXISTE la fila. Ningún teléfono tiene config compartido.')
        return
    d = filas[0].get('data') or {}
    if not isinstance(d, dict):
        log(f'  ⚠ el documento no es un objeto, es {type(d).__name__}')
        return
    log(f'  claves presentes ({len(d)}): {", ".join(sorted(d.keys())) or "NINGUNA"}')
    # Solo los valores de la tasa: lo demás puede llevar teléfonos.
    for k in ('tasaMargen', 'tasaUSD', 'tasaUSDTs', 'tasaUSDFuente'):
        log(f'    · {k}: {d.get(k, "— AUSENTE —")!r}')
    if 'tasaMargen' not in d:
        log('  → El margen NO está en la nube: por eso los gestores ven la tasa pelada.')
        if list(d.keys()) == ['nextValeNum']:
            log('    Y el documento tiene SOLO nextValeNum: alguien lo arrasó al crear')
            log('    un vale. Un teléfono sin actualizar sigue haciéndolo.')
    else:
        log('  → El margen SÍ está en la nube. Si un gestor no lo ve, el problema')
        log('    está en su teléfono (no se ha bajado el config o no se ha actualizado).')


def revisar_tasa(base, clave):
    log('\n── documento propio de la tasa (meta/tasa) ────────────────────────')
    try:
        filas = pedir(base, clave, '/meta?select=data&name=eq.tasa')
    except Exception as e:
        log(f'  ✗ no se pudo leer: {e}')
        return
    if not filas:
        log('  · todavía no existe (lo crea el admin al guardar la tasa o el margen)')
        return
    log(f'  {filas[0].get("data")!r}')


def revisar_comisiones(base, clave):
    """¿Tienen los vales con qué calcular una comisión?

    Si el panel del admin no se reordena "por comisión pendiente", hay dos
    explicaciones muy distintas: que el orden no se aplique, o que todas las
    comisiones salgan 0 y no haya nada que ordenar. Esto distingue una de otra.
    """
    log('\n── vales y comisiones ─────────────────────────────────────────────')
    try:
        filas = pedir(base, clave, '/vales?select=data')
    except Exception as e:
        log(f'  ✗ no se pudo leer: {e}')
        return
    vales = []
    for f in filas:
        d = f.get('data')
        if isinstance(d, dict) and d.get('id') is not None:
            vales.append(d)
        elif isinstance(d, dict):
            # Formato viejo: una fila por gestor con los vales dentro.
            for v in d.values():
                if isinstance(v, dict) and v.get('id') is not None:
                    vales.append(v)
    log(f'  vales en total: {len(vales)}')
    confirmados = [v for v in vales if v.get('status') == 'confirmed']
    pendientes = [v for v in confirmados
                  if not v.get('commissionPaid')
                  and v.get('commissionStatus') not in ('en_sobre', 'cobrado')]
    log(f'  confirmados: {len(confirmados)} · con comisión por pagar: {len(pendientes)}')

    con_fijada = [v for v in pendientes
                  if v.get('comFijadaUSD') is not None or v.get('comFijadaMN') is not None]
    con_productos = [v for v in pendientes if v.get('valeProductos')]
    log(f'    · con la comisión congelada al crearlos: {len(con_fijada)}')
    log(f'    · con productos (se recalcula del catálogo): {len(con_productos)}')

    total_usd = sum(float(v.get('comFijadaUSD') or 0) for v in con_fijada)
    total_mn = sum(float(v.get('comFijadaMN') or 0) for v in con_fijada)
    log(f'    · suma de las congeladas: {round(total_usd, 2)} USD + {round(total_mn)} MN')

    # Cuántos gestores DISTINTOS tienen algo pendiente. Sin ids ni nombres: solo
    # el número, que es lo que decide si un orden "por comisión" cambia algo.
    gestores = {v.get('gestorId') for v in pendientes if v.get('gestorId') is not None}
    log(f'  gestores distintos con comisión por pagar: {len(gestores)}')
    if len(gestores) <= 1:
        log('  → Con 0 o 1 gestor pendiente, ordenar por comisión no puede cambiar')
        log('    el orden de la lista. No sería un fallo del orden.')

    sin_datos = [v for v in pendientes if not v.get('valeProductos') and
                 v.get('comFijadaUSD') is None and v.get('comFijadaMN') is None]
    if sin_datos:
        log(f'  ⚠ {len(sin_datos)} vale(s) sin productos ni comisión congelada:')
        log('    de esos no se puede sacar ninguna cifra, así que cuentan como 0.')


def main():
    base, clave = credenciales()
    log('AXONTECH · qué hay de verdad en la nube')
    log(f'· {base}')
    revisar_config(base, clave)
    revisar_tasa(base, clave)
    revisar_comisiones(base, clave)
    log('\nListo.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
