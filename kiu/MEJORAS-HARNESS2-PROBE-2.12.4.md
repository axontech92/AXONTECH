# KIU 2.12.4 — comparación de variante de enrutamiento

## Cambio evaluado
La variante candidata amplía la detección de peticiones explícitas de búsqueda para aceptar fórmulas de cortesía delante del verbo: «Por favor, busca…», «¿Puedes investigar…?» y «Oye, googlea…». Antes el detector solo reconocía la petición al principio exacto del texto.

## Probe
La matriz ahora contiene 24 casos, incluyendo tres peticiones explícitas con prefijo y una consulta conceptual de programación. Se comprueba el resultado de ruta y la traza de metadatos sin almacenar el texto de la consulta.

## Alcance y límites
Es una comparación determinista de enrutamiento sobre casos fijos; no mide la verdad o calidad de las respuestas del modelo. No se ejecutan modelos remotos ni se requiere API. Las pruebas de Node no sustituyen la compilación Android ni las pruebas en el teléfono.

## Comandos
- `node --test tests/harness2-probe.test.mjs`
- `node --test tests/*.test.mjs`
