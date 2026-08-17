#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
AXONTECH · Lector de la tasa informal del dólar

Esto NO se ejecuta en el teléfono: lo lanza GitHub Actions cada pocas horas
(.github/workflows/tasa-usd.yml) y deja el resultado en `tasa.json`, al lado de
`version.json`. La app se lo baja de su propia dirección.

¿Por qué dar este rodeo en vez de que el móvil consulte la web de tasas?
Porque el navegador solo deja LEER otra web si esa web lo autoriza (CORS), y una
tienda o un periódico normalmente no lo hacen: la petición se corta en el propio
teléfono. Aquí corremos en un servidor de GitHub, donde esa restricción no
existe, no hay bloqueos de país y la clave —si se usa— vive en los secretos del
repositorio y no dentro de una página pública.

Se prueban varias fuentes en orden y se deja escrito en el registro qué contestó
cada una. Si ninguna sirve, NO se escribe nada: la app sigue enseñando el último
valor bueno con su fecha, que es mejor que un dato inventado.
"""

import json
import os
import re
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone

# Rango de cordura. La tasa informal cubana se mueve en cientos de CUP; si algo
# devuelve 0.0091 (la conversión al revés) o 99999, es que hemos leído mal.
# 17/08/2026: la banda era 20-5000 y por ahí se coló un 116 —el precio de un
# artículo de la tienda— que se publicó como si fuera la tasa. Un rango tan
# ancho no filtra nada. Se puede ajustar sin tocar código con las variables
# TASA_MIN / TASA_MAX del repositorio.
TASA_MIN = float(os.environ.get('TASA_MIN') or 250)
TASA_MAX = float(os.environ.get('TASA_MAX') or 2500)

# ── El freno de verdad: el anclaje al último valor conocido ──────────────────
# Ninguna regla sobre el formato de la página va a cubrir todos los casos: hoy
# es un precio junto a "USD", mañana será otra cosa. Lo que SÍ se sabe siempre
# es que una tasa real no salta de 665 a 116 de un día para otro. Así que se
# compara con lo último publicado y se rechaza lo que se aleje demasiado.
# La banda se ensancha con la antigüedad del ancla (si llevamos días sin poder
# leer, el mercado ha tenido tiempo de moverse) y se ignora si el ancla es muy
# vieja. TASA_FORZAR=1 la salta del todo, que es como se reancla a mano tras un
# movimiento de verdad.
BANDA_BASE = 0.25          # 25 % de salto permitido con el ancla recién puesta
BANDA_POR_DIA = 0.08       # se ensancha un 8 % por cada día de antigüedad
BANDA_TOPE = 0.60
ANCLA_CADUCA_DIAS = 30

SALIDA = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'tasa.json')
TIMEOUT = 25
UA = ('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) '
      'Chrome/124.0 Safari/537.36')

# Las claves donde estas webs suelen meter el número, en orden de preferencia:
# la mediana es la cifra que elToque publica como tasa del día.
# Ojo con lo que se mete aquí: 'price' estaba en la lista y es justo la clave que
# usa una tienda para el precio de un artículo. Si un día la API deja de traer
# 'median', caeríamos en 'price' sin enterarnos — el mismo error que en el HTML,
# pero en JSON.
CLAVES_VALOR = ('median', 'mediana', 'tasa', 'rate', 'value', 'avg', 'close', 'last')
CONTENEDORES = ('tasas', 'rates', 'x_rates', 'data', 'result', 'results', 'items')


def log(msg):
    print(msg, flush=True)


def _num(v):
    """Devuelve el número si está dentro del rango razonable, o None."""
    if isinstance(v, bool):
        return None
    if isinstance(v, str):
        v = v.strip().replace(',', '.')
        if not re.fullmatch(r'-?\d+(\.\d+)?', v):
            return None
        v = float(v)
    if isinstance(v, (int, float)) and TASA_MIN <= float(v) <= TASA_MAX:
        return float(v)
    return None


def _valor_de_moneda(o):
    if not isinstance(o, dict):
        return None
    for k in CLAVES_VALOR:
        n = _num(o.get(k))
        if n:
            return n
    return None


def extraer_de_json(j, prof=0):
    """Busca el valor del USD sin dar por hecho una estructura exacta.

    Estas webs cambian de formato sin avisar. Casar una forma concreta
    significaría romperse en silencio el día del cambio; buscar por las claves
    donde suele venir y validar el rango, no.
    """
    if j is None or prof > 6:
        return None
    if isinstance(j, list):
        # El dato más reciente suele ir al final.
        for item in reversed(j):
            v = extraer_de_json(item, prof + 1)
            if v:
                return v
        return None
    if not isinstance(j, dict):
        return None
    cur = str(j.get('currency') or j.get('cur') or j.get('moneda') or '').upper()
    if cur == 'USD':
        v = _valor_de_moneda(j)
        if v:
            return v
    for k in ('USD', 'usd', 'Usd'):
        if k in j:
            n = _num(j[k])
            if n:
                return n
            if isinstance(j[k], dict):
                # Ya sabemos que este objeto ES el del dólar: el número que lleve
                # dentro vale aunque no vuelva a etiquetarse como USD.
                v = _valor_de_moneda(j[k]) or extraer_de_json(j[k], prof + 1)
                if v:
                    return v
    for k in CONTENEDORES:
        if j.get(k) is not None:
            v = extraer_de_json(j[k], prof + 1)
            if v:
                return v
    return None


def extraer_de_html(html):
    """Saca la tasa de una página normal, y cuenta lo que ve.

    Leer HTML es frágil por naturaleza: cualquier rediseño lo rompe. Por eso no
    se busca un hueco fijo sino números en rango cerca de las palabras del
    dólar, y se imprime el contexto de cada candidato — así, el día que falle,
    el registro de Actions dice exactamente qué había en la página en vez de
    dejarnos a ciegas.
    """
    texto = re.sub(r'<script\b.*?</script>|<style\b.*?</style>', ' ', html,
                   flags=re.S | re.I)
    texto = re.sub(r'<[^>]+>', ' ', texto)
    texto = re.sub(r'&nbsp;?', ' ', texto)
    texto = re.sub(r'\s+', ' ', texto)

    candidatos = []
    for m in re.finditer(r'\bUSD\b|\bd[oó]lar(?:es)?\b|\bMLC\b', texto, flags=re.I):
        marca = m.group(0).upper()
        ventana = texto[max(0, m.start() - 90): m.end() + 90]
        for num in re.finditer(r'\b(\d{2,4}(?:[.,]\d{1,2})?)\b', ventana):
            n = _num(num.group(1))
            if n:
                candidatos.append((marca, n, ventana.strip()))

    if not candidatos:
        log('      · no se encontró ningún número de tasa en la página')
        return None

    for marca, n, ctx in candidatos[:6]:
        log(f'      · candidato {n} (junto a "{marca}"): …{ctx[:140]}…')

    # El dólar manda: si hay candidatos junto a USD/dólar se ignoran los de MLC,
    # que es otra moneda y otra tasa.
    del_dolar = [c for c in candidatos if c[0] != 'MLC']
    usar = del_dolar or candidatos
    if not del_dolar:
        log('      ⚠ solo había números junto a MLC — se descartan, no es la tasa del dólar')
        return None
    return usar[0][1]


def pedir(url, headers=None):
    req = urllib.request.Request(url, headers={'User-Agent': UA, **(headers or {})})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
        cuerpo = r.read().decode('utf-8', 'replace')
        return r.status, cuerpo


def leer_ancla():
    """Lee el último valor conocido y su timestamp de tasa.json."""
    try:
        with open(SALIDA, 'r', encoding='utf-8') as f:
            datos = json.load(f)
        valor = datos.get('valor')
        ts = datos.get('ts', 0)
        # Solo usamos el ancla si es un número válido y tiene timestamp.
        if isinstance(valor, (int, float)) and valor > 0 and ts > 0:
            return valor, ts
    except Exception:
        pass
    return None, None


def calcular_banda(valor_ancla, ts_ancla):
    """Calcula el rango aceptable relativo al ancla usando band-clamping.

    - Empieza con BANDA_BASE (25 % de movimiento)
    - Se ensancha BANDA_POR_DIA (8 %) por cada día de antigüedad
    - Topa en BANDA_TOPE (60 % máximo)
    - Si el ancla es más vieja que ANCLA_CADUCA_DIAS, retorna None (ancla inútil)
    """
    ahora_ts = int(datetime.now(timezone.utc).timestamp() * 1000)
    dias_transcurridos = (ahora_ts - ts_ancla) / (1000 * 60 * 60 * 24)

    if dias_transcurridos > ANCLA_CADUCA_DIAS:
        log(f'      · ancla expirada ({dias_transcurridos:.1f} días): se ignora')
        return None

    # Banda = base + (8% por día), tope en 60%
    banda = BANDA_BASE + (dias_transcurridos * BANDA_POR_DIA)
    banda = min(banda, BANDA_TOPE)

    margen = valor_ancla * banda
    minimo = valor_ancla - margen
    maximo = valor_ancla + margen

    return minimo, maximo, banda


def validar_con_ancla(valor, valor_ancla, ts_ancla):
    """Valida un valor contra el ancla.

    Retorna True si:
    - No hay ancla válida (primera vez o expirada)
    - El valor está dentro de la banda permitida
    - TASA_FORZAR=1 (permite override manual)
    """
    if valor_ancla is None:
        log('      · sin ancla anterior: valor aceptado')
        return True

    if os.environ.get('TASA_FORZAR') == '1':
        log('      · TASA_FORZAR=1: banda saltada')
        return True

    banda_resultado = calcular_banda(valor_ancla, ts_ancla)
    if banda_resultado is None:
        log('      · ancla expirada, valor aceptado')
        return True

    minimo, maximo, banda_pct = banda_resultado

    if minimo <= valor <= maximo:
        pct_cambio = abs(valor - valor_ancla) / valor_ancla * 100
        log(f'      · dentro de banda ({banda_pct*100:.0f}%, cambio {pct_cambio:.1f}%): aceptado')
        return True

    pct_cambio = abs(valor - valor_ancla) / valor_ancla * 100
    log(f'      ✗ FUERA de banda ({banda_pct*100:.0f}%, cambio {pct_cambio:.1f}%): rechazado')
    log(f'        ancla={valor_ancla}, nuevo={valor}, rango=[{minimo:.0f}, {maximo:.0f}]')
    return False


def fuentes():
    hoy = datetime.now(timezone.utc).strftime('%Y-%m-%d')
    lista = []
    clave = os.environ.get('ELTOQUE_API_KEY', '').strip()
    if clave:
        lista.append((
            'elToque (API oficial)',
            f'https://tasas.eltoque.com/v1/trmi?date_from={hoy}%2000:00:01&date_to={hoy}%2023:59:01',
            {'Authorization': 'Bearer ' + clave},
            'json',
        ))
    else:
        log('· Sin ELTOQUE_API_KEY en los secretos del repositorio: se salta la API oficial.')
    lista.append(('elToque (espejo)',
                  'https://api.cambiocuba.money/api/v1/x-rates-by-date-range-history?trmi=true&cur=USD&period=1',
                  None, 'json'))
    lista.append(('elToque (espejo)',
                  'https://api.cambiocuba.money/api/v1/x-rates', None, 'json'))
    extra = os.environ.get('TASA_URL_EXTRA', '').strip()
    if extra:
        lista.append(('fuente propia', extra, None, 'auto'))
    # Última reserva: la web de la tienda. Va al final a propósito — casi seguro
    # saca su número de elToque, así que ir al original evita un intermediario.
    lista.append(('tiendamax.org', 'https://tiendamax.org/', None, 'html'))
    return lista


def main():
    log('AXONTECH · buscando la tasa del dólar')
    for nombre, url, headers, tipo in fuentes():
        log(f'· {nombre}: {url}')
        try:
            estado, cuerpo = pedir(url, headers)
        except urllib.error.HTTPError as e:
            log(f'    ✗ HTTP {e.code}')
            continue
        except Exception as e:
            log(f'    ✗ {type(e).__name__}: {e}')
            continue
        log(f'    → HTTP {estado}, {len(cuerpo)} bytes')

        valor = None
        if tipo in ('json', 'auto'):
            try:
                valor = extraer_de_json(json.loads(cuerpo))
            except Exception as e:
                if tipo == 'json':
                    log(f'    ✗ no es JSON válido: {e}')
                    log(f'      primeros 200 caracteres: {cuerpo[:200]!r}')
        if valor is None and tipo in ('html', 'auto'):
            valor = extraer_de_html(cuerpo)

        if valor:
            valor_redondeado = round(valor, 2)
            # Validar contra el ancla antes de escribir
            valor_ancla, ts_ancla = leer_ancla()
            if not validar_con_ancla(valor_redondeado, valor_ancla, ts_ancla):
                log(f'    ✗ valor rechazado por band-clamping (ancla={valor_ancla})')
                continue

            datos = {
                'valor': valor_redondeado,
                'fuente': nombre,
                'ts': int(datetime.now(timezone.utc).timestamp() * 1000),
                'actualizado': datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC'),
            }
            with open(SALIDA, 'w', encoding='utf-8') as f:
                json.dump(datos, f, ensure_ascii=False, indent=2)
                f.write('\n')
            log(f'✅ Tasa encontrada: {datos["valor"]} CUP por 1 USD ({nombre})')
            return 0
        log('    ✗ respondió, pero no se pudo leer la tasa')

    # Sin dato bueno no se toca el archivo: la app seguirá enseñando el último
    # valor conocido con su fecha en naranja, que avisa de que está viejo.
    log('⚠ Ninguna fuente dio un valor válido. No se toca tasa.json.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
