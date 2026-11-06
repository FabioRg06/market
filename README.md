# Market — control de minibar del hotel

Dos partes:

| Carpeta   | Qué es | Dónde corre |
|-----------|--------|-------------|
| `app/`    | App React Native (Expo) con las dos vistas: **Revisión** (teléfonos) y **Recepción** (computador/tablet). | Android, iOS y navegador |
| `server/` | Servidor de recepción: base de datos central SQLite + API de sincronización. También sirve la vista web de recepción. | El computador de recepción |

## Cómo funciona sin internet

```
 Teléfono (revisor)                          Computador de recepción
 ┌──────────────────────┐   wifi del hotel    ┌──────────────────────────┐
 │ SQLite en el teléfono│ ──── /api/sync ───▶ │ server/ (SQLite central) │
 │ (todo se guarda aquí)│ ◀── lo nuevo ────── │ http://<ip-del-pc>:4000  │
 └──────────────────────┘                     └──────────────────────────┘
```

- Cada revisión, consumo, cambio de inventario y "surtida" se guarda **primero en el teléfono** (SQLite, como las bases internas de Android). No hace falta conexión para trabajar.
- Cuando el teléfono alcanza el servidor (al recuperar la red, cada 20 s y después de cada cambio), **envía lo pendiente y descarga lo nuevo** automáticamente. La barra de arriba muestra cuántos registros faltan por enviar.
- No necesita internet de verdad: basta con que el teléfono y el computador estén en la **misma red wifi/local** del hotel.
- Reenviar no duplica nada (cada registro tiene un id único) y si dos dispositivos editan lo mismo gana el cambio más reciente.

## Estados de una habitación

**Surtida → Por revisar → Revisada → Surtida**

1. Al empezar el día todas están **surtidas**.
2. Recepción carga el **Excel de salidas** (columnas: Habitación y, si las hay, Huésped, Vuelo y Tipo). Esas habitaciones quedan **por revisar**, con su huésped y hora de vuelo.
3. Quien revisa entra, marca lo consumido (o **Sin consumo**) y termina: queda **revisada**, mostrando lo que falta reponer.
4. Se mantiene revisada hasta que la **surten**; entonces vuelve a **surtida**.

Sobre una habitación revisada se puede:
- **Confirmar que no consumió nada** (obligatorio cuando quedó sin consumo, después de que el huésped se va).
- **Agregar consumo**: el huésped sigue en la habitación.
- **Reportar novedad**: el consumo se encontró cuando el huésped ya se había ido.

## Tipos de habitación

| Código | Tipo | Color |
|---|---|---|
| CM | Con minibar | verde |
| SS | Solo seco (mecato) | amarillo |
| SM | Sin minibar | naranja |
| PR | Provisional | rojo |
| VIP | VIP | negro |

Hay un **inventario global** (todo lo que ofrece Market, con foto y precio) y cada tipo define qué lleva su minibar. Se edita en Recepción → *Inventario*.

## Vista de recepción (computador)

- *Habitaciones*: resumen (por revisar, revisadas, novedades, surtidas, por reponer) y la cuadrícula; cada habitación abre un panel lateral con huésped, tipo, lo pendiente como factura y el historial.
- *Reporte del día*: revisadas, sin revisar, surtidas y falta surtir; se descarga para Excel.
- *Inventario*: global y por tipo; las fotos se suben tocando la imagen del producto.
- *Bloques*: código y nombre de cada bloque (los rangos de habitaciones son fijos, en `app/src/catalog.json`).
- Se actualiza sola cada 15 segundos.

## Puesta en marcha

Requisitos: Node.js 22.13 o superior.

### 1. Servidor en el computador de recepción

```bash
cd server
npm install
npm start
```

Al iniciar muestra las direcciones, por ejemplo:

```
  En este computador:  http://localhost:4000
  Para los teléfonos:  http://192.168.1.10:4000
```

El catálogo es fijo y está en `app/src/catalog.json` (lo usan la app y el servidor):
700 habitaciones en 7 bloques (Bloque 1: 101–200 … Bloque 7: 701–800) y los 13 productos
del minibar con su precio y cantidad estándar. Como viene dentro de la app, una tablet puede
revisar aunque nunca se haya conectado al servidor. La base queda en `server/data/market.db`:
**haz copia de ese archivo** para respaldar.

Datos de prueba (huéspedes, vuelos y revisiones de hoy y ayer) y borrado:

```bash
npm run demo
```
```bash
npm run reset
```

Dejar el hotel como al empezar el día (todo surtido y algunas habitaciones por revisar al azar, sin borrar el historial):

```bash
npm run inicio-dia
```

Las fotos de los productos se guardan en la base (`server/data/market.db`), no en el repositorio: en una instalación nueva se suben desde Recepción → *Inventario*.

### 2. Vista de recepción

```bash
cd app
npm install
npm run build:web
```

Luego abre `http://localhost:4000` en el computador de recepción (el servidor la sirve). Se puede dejar como acceso directo o "Instalar como aplicación" desde Chrome/Edge.

### 3. App de los teléfonos

Para probar rápido con Expo Go:

```bash
cd app
npm start
```

Escanea el QR con el teléfono, elige **Revisar habitaciones**, entra a **Ajustes** y escribe tu nombre y la dirección "Para los teléfonos" que mostró el servidor.

Para instalarla de verdad (APK de Android / iOS) se usa EAS Build:

```bash
npx eas build -p android --profile preview
```

> Nota Android: el servidor usa `http://` en la red local. Si una build de producción bloquea el tráfico sin cifrar, agrega `expo-build-properties` con `android.usesCleartextTraffic: true`.

## Estructura del código

```
app/
  App.tsx                         elección de vista y navegación
  src/local/db.native.ts          base SQLite del teléfono (tablas + consultas)
  src/local/db.ts                 versión web (sin base local)
  src/local/sync.ts               sincronización automática
  src/screens/inspector/          vista de revisión
  src/screens/reception/          vista de recepción
server/
  src/db.js                       esquema de la base central
  src/sync.js                     recibir/enviar cambios a los teléfonos
  src/reception.js                consultas de recepción y catálogo
  src/index.js                    API HTTP
```
