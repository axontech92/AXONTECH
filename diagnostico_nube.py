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
    js = open(os.path.join(RAIZ, 'app.js'), encoding='utf-8').read(40000)
    url = re.search(r"SUPABASE_URL\s*=\s*'([^']+)'", js)
    key = re.search(r"SUPABASE_(?:KEY|ANON_KEY)\s*=\s*'([^']+)'", js)
    if not url or not key:
        log('✗ No se encontraron SUPABASE_URL / SUPABASE_KEY en app.js')
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


def _num_de(txt):
    """Primer número de un texto tipo '$12.5 USD', '10%', '250 MN'."""
    m = re.search(r'-?\d+(?:[.,]\d+)?', str(txt or '').replace(',', '.'))
    return float(m.group(0)) if m else 0.0


def comision_de_vale(v, catalogo):
    """Replica getValeCommissionParts() de app.js.

    Lo importante no es el céntimo: es reproducir CUÁNDO la app se queda sin
    poder calcular. Si un vale lleva un producto que ya no está en el catálogo,
    la app marca la comisión como no calculable y la cuenta como cero — y ese
    cero es el que decide el orden del panel. Aquí se ve cuántos vales están así.
    """
    partes = 0
    usd = mn = 0.0
    calculable = True
    for it in (v.get('valeProductos') or []):
        p = catalogo.get(it.get('id'))
        if p is None:
            calculable = False           # producto borrado del catálogo
            partes += 1
            continue
        com = str(p.get('comision') or '')
        if not com:
            continue
        partes += 1
        qty = int(it.get('qty') or 1)
        com_up = com.upper()
        es_mn = ('MN' in com_up or 'CUP' in com_up
                 or str(p.get('comisionMoneda') or '').upper() == 'MN')
        if '%' in com:
            pct = _num_de(com)
            precio = _num_de(p.get('precio'))
            if pct and precio > 0:
                importe = round(precio * (pct / 100) * qty, 2)
                if es_mn or 'MN' in str(p.get('precio') or '').upper():
                    mn += importe
                else:
                    usd += importe
            else:
                calculable = False
        else:
            n = _num_de(com)
            if n > 0:
                if es_mn:
                    mn += n * qty
                else:
                    usd += n * qty
            else:
                calculable = False
    # La comisión congelada al crear el vale manda sobre el recálculo.
    if v.get('comFijadaUSD') is not None or v.get('comFijadaMN') is not None:
        usd = max(0.0, float(v.get('comFijadaUSD') or 0))
        mn = max(0.0, float(v.get('comFijadaMN') or 0))
        calculable = True
        if not partes:
            partes = 1
    cedida = max(0.0, float(v.get('comisionCedida') or 0))
    if cedida and calculable and partes:
        if str(v.get('comisionCedidaMoneda') or 'USD').upper() == 'MN':
            mn = max(0.0, mn - cedida)
        else:
            usd = max(0.0, usd - cedida)
    if not (calculable and partes):
        return None, None            # la app devuelve null → cuenta como 0
    return usd, mn


def revisar_orden(base, clave):
    """¿En qué orden dejaría el panel del admin a los gestores?

    Sin nombres: G1, G2… ordenados por lo que se les debe. Quien mira el panel
    reconocerá a quién corresponde cada cifra.
    """
    log('\n── orden por comisión pendiente ───────────────────────────────────')
    try:
        filas_v = pedir(base, clave, '/vales?select=data')
        filas_p = pedir(base, clave, '/productos?select=data')
    except Exception as e:
        log(f'  ✗ no se pudo leer: {e}')
        return
    catalogo = {}
    for f in filas_p:
        d = f.get('data') or {}
        if isinstance(d, dict) and d.get('id') is not None:
            catalogo[d['id']] = d
    log(f'  productos en el catálogo: {len(catalogo)}')

    vales = []
    for f in filas_v:
        d = f.get('data')
        if isinstance(d, dict) and d.get('id') is not None:
            vales.append(d)
        elif isinstance(d, dict):
            vales.extend(x for x in d.values() if isinstance(x, dict) and x.get('id') is not None)

    por_gestor = {}
    for v in vales:
        if v.get('status') != 'confirmed':
            continue
        if v.get('commissionPaid') or v.get('commissionStatus') in ('en_sobre', 'cobrado'):
            continue
        g = v.get('gestorId')
        e = por_gestor.setdefault(g, {'usd': 0.0, 'mn': 0.0, 'vales': 0, 'sin_calcular': 0})
        e['vales'] += 1
        u, m = comision_de_vale(v, catalogo)
        if u is None:
            e['sin_calcular'] += 1
        else:
            e['usd'] += u
            e['mn'] += m

    if not por_gestor:
        log('  · ningún gestor con comisión por pagar')
        return
    # El mismo criterio que _cmpComisionPendiente en app.js: USD y, a igualdad, MN.
    orden = sorted(por_gestor.values(), key=lambda e: (-e['usd'], -e['mn']))
    log('  así quedaría la lista (sin nombres, de arriba abajo):')
    for i, e in enumerate(orden, 1):
        aviso = f"  ⚠ {e['sin_calcular']} vale(s) que la app NO puede calcular → cuentan 0" if e['sin_calcular'] else ''
        log(f"    {i}. ${round(e['usd'],2)} USD + {round(e['mn'])} MN "
            f"({e['vales']} vale(s)){aviso}")
    ceros = [e for e in orden if e['usd'] == 0 and e['mn'] == 0]
    if ceros:
        log(f'  ⚠ {len(ceros)} gestor(es) con vales pendientes pero comisión 0 para el')
        log('    orden. Si en pantalla SÍ se les ve una cifra, el fallo está en que')
        log('    la app no puede recalcularla (producto borrado del catálogo).')


def revisar_fotos(base, clave):
    """Estado de las fotos de los productos EN LA NUBE.

    Escrito el 21/08/2026 después de que "Aligerar catálogo" dejara productos
    sin foto. Lo que hace falta saber es exactamente en qué estado quedó cada
    fila: si la foto sigue dentro, si quedó una ruta, o si se quedó vacía. Con
    eso se sabe si hay algo que recuperar y de dónde.
    """
    log('\n── fotos de los productos ─────────────────────────────────────────')
    try:
        filas = pedir(base, clave, '/productos?select=data')
        cfgf = pedir(base, clave, '/meta?select=data&name=eq.config')
    except Exception as e:
        log(f'  ✗ no se pudo leer: {e}')
        return
    cfg = (cfgf[0].get('data') or {}) if cfgf else {}
    log(f"  repo de GitHub configurado: {cfg.get('ghRepo', '— sin configurar —')!r}")

    b64 = rutas = vacios = 0
    lista_rutas = []
    for f in filas:
        d = f.get('data') or {}
        if not isinstance(d, dict):
            continue
        foto = d.get('photo') or d.get('imagen') or ''
        if not foto:
            vacios += 1
        elif str(foto).startswith('data:'):
            b64 += 1
        else:
            rutas += 1
            lista_rutas.append(str(foto))
    log(f'  con la foto dentro de la fila (base64): {b64}')
    log(f'  con ruta a un archivo                 : {rutas}')
    log(f'  SIN FOTO                              : {vacios}')

    # ¿Existe de verdad cada archivo al que apuntan?
    faltan = [r for r in lista_rutas
              if r.startswith('photos/') and not os.path.exists(os.path.join(RAIZ, r))]

    # Que el archivo esté en el repositorio no basta: la app lo pide por HTTP, y
    # GitHub Pages publica con retraso. Entre que la fila apunta a la ruta y que
    # el archivo se puede descargar hay una ventana en la que la foto se ve rota
    # aunque el dato esté perfecto. Esto mide esa ventana.
    sitio = os.environ.get('SITIO_URL') or (
        'https://%s.github.io/%s/' % tuple(str(cfg.get('ghRepo', '/')).split('/')[:2])
        if str(cfg.get('ghRepo', '')).count('/') == 1 else '')
    if sitio and lista_rutas:
        log(f'  comprobando descarga real desde {sitio}')
        rotas = []
        for r in lista_rutas[:120]:
            try:
                req = urllib.request.Request(sitio + r, method='HEAD',
                                             headers={'User-Agent': 'axontech-diag'})
                with urllib.request.urlopen(req, timeout=15) as resp:
                    if resp.status != 200:
                        rotas.append((r, resp.status))
            except urllib.error.HTTPError as e:
                rotas.append((r, e.code))
            except Exception as e:
                rotas.append((r, type(e).__name__))
        if rotas:
            log(f'  ⚠ {len(rotas)} foto(s) NO se pueden descargar todavía:')
            for r, c in rotas[:15]:
                log(f'      {c}  {r}')
            log('    Si son las recién movidas, es que GitHub Pages aún no las ha')
            log('    publicado. El dato está bien; es cuestión de esperar.')
        else:
            log(f'  ✓ las {len(lista_rutas)} fotos se descargan correctamente')
    if faltan:
        log(f'  ⚠ {len(faltan)} ruta(s) apuntan a un archivo que NO está en el repositorio:')
        for r in faltan[:15]:
            log(f'      {r}')
        log('    Esas son las fotos que se ven rotas.')
    else:
        log('  ✓ todas las rutas tienen su archivo en el repositorio')


def main():
    base, clave = credenciales()
    log('AXONTECH · qué hay de verdad en la nube')
    log(f'· {base}')
    revisar_config(base, clave)
    revisar_tasa(base, clave)
    revisar_comisiones(base, clave)
    revisar_orden(base, clave)
    revisar_fotos(base, clave)
    log('\nListo.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
