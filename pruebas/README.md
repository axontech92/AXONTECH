# Pruebas

Recorren la app de verdad en un navegador: se llena el formulario, se toca el
botón y se mira qué pasó. No hay copias de la lógica — si la app cambia, la
prueba lo nota.

    NODE_PATH=$(npm root -g) node pruebas/recorrido_vale.js

(playwright está instalado en global, no en el proyecto; de ahí el NODE_PATH.)

Para pasarlas todas:

    for f in pruebas/*.js; do printf "%-32s " "$(basename $f)"; \
      NODE_PATH=$(npm root -g) node "$f" 2>&1 | tail -1; done

| Archivo | Qué recorre |
|---|---|
| `recorrido_vale.js`   | El ciclo entero de un vale: el gestor lo llena y lo manda, el admin lo ve y lo asigna, el mensajero entrega, se cobra, se revierte. Comprueba stock, comisión y puntos en cada paso. |
| `recorrido_dinero.js` | Rebaja del admin, comisión cedida, corte de dueños, ganancia, y que USD y MN no se sumen nunca. |
| `recorrido_bordes.js` | Dobles toques, productos borrados, cantidades absurdas, vales unidos, vales sin productos, cancelar, sin conexión. |
| `recorrido_stock.js`  | Alta y edición de productos, ventana de stock, merma, reservas, buscador, borrar un producto ya vendido. |
| `recorrido_sync.js`   | Dos teléfonos contra una Supabase de mentira: el gestor manda sin cobertura, vuelve la red, el admin confirma y revierte, y la nube contesta vacío por un fallo. |
| `prueba_cinco_fallos.js` | Los cinco fallos reportados el 15/09 (texto de WhatsApp, moneda de la comisión, stock excedido, reversión). |
| `prueba_tasa_de_5.js` | La tasa siempre acaba en 0 o en 5, con el pico subiendo a partir de 3. |
| `prueba_ajuste_por_linea.js` | El gestor baja su comisión en un producto y el admin rebaja el precio de otro, cada uno en su moneda. Cuentas y las dos pantallas. |
| `prueba_cobrar_y_directas.js` | Que el vale diga siempre lo que se le cobra al cliente (con rebaja, sin ella y con las monedas cruzadas), y el apartado de ventas directas del admin: no avisa a nadie y NO toca el stock del producto de catálogo (esa mercancía nunca vivió en el almacén). |
| `prueba_directas_en_la_nube.js` | Que una venta directa (y el deshacerla) viaje de verdad a la nube — no solo al teléfono que la registró — y que el producto de catálogo elegido no cambie de stock en ningún lado: ni local, ni en la nube, ni en un segundo teléfono. |
| `prueba_forma_de_pago.js` | Cómo pagó el cliente: USD por defecto, Zelle 1 a 1, euro con la tasa de elToque, MN calculado solo a la tasa de todos (con +ajuste, de 5 en 5); MN a mano respetado; tasas congeladas; congelado al confirmar; sube a la nube; caja por método en Estadísticas. |
| `prueba_comision_admin_y_ticket.js` | El admin baja la comisión del gestor línea a línea desde "Editar vale" (antes era texto que nadie leía), y el ticket del cliente en la app del gestor refleja el descuento por línea. |
| `prueba_clave_gestor_nuevo.js` | Reportado el 19/09: "creé un gestor y la clave que le doy dice que es incorrecta". El hash/verificación en sí está bien (probado); lo que sí era real es que crear o resetear una clave capturaba la lista de gestores ANTES del hash asíncrono (PBKDF2) y podía pisar un cambio ajeno llegado mientras tanto. |

## Cosas que hay que saber para escribir pruebas aquí

- **`data.json`** es la foto que el repositorio lleva para sembrar un teléfono
  nuevo: ~100 productos y 52 gestores reales. Si la prueba no la neutraliza,
  aterriza a mitad y pisa el escenario. Ver `recorrido_sync.js`.
- **El gestor no escribe la tabla `vales`**: manda su vale por el RPC
  `upsert_vale_from_gestor`, que fusiona en el servidor y preserva los campos
  del admin. Una nube de mentira tiene que implementarlo o parecerá que el vale
  no sube.
- **El stock tampoco se escribe con un número absoluto**: va por
  `rpc/aplicar_delta_stock` ("quita 2"), para que dos teléfonos vendiendo a la
  vez no se pisen.
- **La tasa** sale de `tasa.json` (que el servidor de pruebas sirve de verdad) o
  del config. Para probar "sin tasa" hay que limpiar también `axon_tasa_usd`.
- **`_LOCAL_WINS_WINDOW_MS`**: durante 60 s desde su último cambio local, el
  teléfono defiende su versión del vale frente a la nube. Una reversión del
  admin puede tardar hasta ese minuto en verse en el teléfono del gestor.
- **Un vale `pending` no aparta stock por sí solo.** Reserva si lleva
  `reservado:true` o si ya está `assigned` con mensajero (`_valeReservaActiva`).
  Una prueba que dé por hecho que un vale pendiente reserva medirá el stock
  disponible mal.
