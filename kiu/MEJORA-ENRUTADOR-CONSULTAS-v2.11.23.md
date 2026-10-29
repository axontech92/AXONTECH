# KIU v2.11.23 — Enrutador de consultas

## Cambios
- Las preguntas generales como «¿qué es…?» y «¿quién es…?» ya no se envían automáticamente a búsqueda web. Se dejan para el modelo seleccionado, incluido el modelo local.
- La búsqueda web se reserva para solicitudes explícitas de búsqueda/investigación y temas que suelen cambiar (noticias recientes, precios, cotizaciones, versiones actuales, clima y resultados en vivo).
- El mensaje de fallo del motor local ya no aconseja activar una API como única forma de conversar. Indica que el motor local no generó respuesta y pide comprobar que el modelo esté cargado.
- Versión Android incrementada a 2.11.23 (versionCode 73).

## Verificación
- `node --check` en los dos archivos JS modificados: correcto.
- `node --test tests/*.test.mjs`: 390 aprobadas, 0 fallidas.
- No se pudo compilar ni instalar la APK en este entorno; por tanto, no se afirma que haya sido probada en un dispositivo.

## Límites
El enrutador distingue intención general de necesidad de información actual mediante reglas ligeras; no valida por sí mismo la veracidad de resultados web ni elimina todos los posibles problemas del motor nativo.
