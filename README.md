# Mesa & Evento — Reservas del restaurante

Aplicación para administrar **clientes**, **reservas de mesas** y **eventos** de un restaurante,
con **combos de comida** que se pueden sumar a cada reserva.

Los datos se guardan en una base de datos **SQLite real** dentro de un archivo local,
`datos.sqlite`, que crea la propia aplicación. El motor de SQLite (compilado a WebAssembly)
funciona dentro del navegador y el servidor local se encarga de escribir el archivo en disco.
No hace falta instalar nada.

---

## Cómo abrir la aplicación

1. Hacé doble clic en **`iniciar.bat`**.
2. Se abre una ventana de consola y, automáticamente, el navegador en la aplicación.
3. Para cerrarla, presioná `Ctrl + C` en la ventana de consola.

También podés abrir `index.html` con doble clic, pero algunos navegadores no permiten guardar
datos cuando la página se abre como archivo local. En ese caso la app muestra un aviso y
conviene usar `iniciar.bat`.

> Requisitos: Windows y un navegador actualizado (Chrome, Edge o Firefox).
> No se necesita Python, Node, Java ni conexión a Internet.

---

## Qué se puede hacer

### Clientes

- Registrar **nombre**, **apellido**, **teléfono** y **número de documento**.
- El sistema asigna automáticamente un **número único de cliente** (`#0001`, `#0002`, …) que no cambia nunca.
- El documento no se puede repetir: si ya existe, la app indica qué cliente lo tiene.
- Buscar clientes por nombre, apellido, documento, teléfono o número de cliente.
- Editar los datos de un cliente.
- Ver todas las reservas de un cliente con un clic.
- Eliminar un cliente **solo si no tiene reservas** (para no dejar reservas huérfanas).

### Reservas

Cada reserva guarda sus propios datos:

| Dato | Descripción |
| --- | --- |
| Cliente | Cliente al que está asignada la reserva |
| Fecha de creación | Se registra automáticamente al crear la reserva |
| Fecha de la reserva | Día y hora para la que se reserva |
| Tipo | **Mesa** o **Evento** |
| Personas | Cantidad de comensales |
| Mesa / evento | Número de mesa o nombre del evento (opcional) |
| Estado | Pendiente, confirmada o cancelada |
| Notas | Alergias, decoración, pedidos especiales, etc. (opcional) |

- Las reservas próximas aparecen primero; las pasadas y canceladas quedan atenuadas al final.
- Se pueden filtrar por tipo, estado y fecha, y buscar por cliente, documento, mesa o evento.
- Al crear una reserva se puede **registrar un cliente nuevo sin salir del formulario**.

### Resumen

La pantalla de reservas muestra: reservas próximas, comensales esperados, eventos próximos y
clientes registrados.

### Combos

Un combo es una comida con precio por unidad que después se suma a las reservas.

- Registrar **nombre**, **qué incluye** y **precio por unidad**.
- Buscar combos por nombre o por su contenido.
- Editar el nombre, el contenido y el precio.
- Eliminar un combo **solo si no está en ninguna reserva**, para no romper reservas viejas.

Dentro de una reserva se elige el combo y la **cantidad** que se va a consumir (la app sugiere
1 por comensal, pero se puede cambiar). La reserva muestra, por cada combo:

| Dato | Descripción |
| --- | --- |
| Nombre | Nombre del combo |
| Cantidad | Unidades que se van a consumir |
| Precio por unidad | Precio del combo en el momento de cargar la reserva |
| Subtotal | Cantidad × precio por unidad |
| Total de combos | Suma de todos los combos de la reserva |

El precio se guarda **por reserva**: si después actualizás el precio del combo, las reservas
anteriores conservan el precio con el que se cargaron. En la tabla de reservas se ve la
cantidad de combos y el total; al editar la reserva se ve el detalle completo.

### Pagos

Cada reserva se puede marcar como **pagada** desde la tabla de reservas, con el botón de dinero
de la columna de acciones. El pago admite tres formas:

- **Transferencia**: todo el dinero se registra como transferencia.
- **Efectivo**: todo el dinero se registra en efectivo.
- **Mixto (parcialidades)**: se reparte el total entre transferencia y efectivo; por ejemplo,
  una parte por transferencia y el finiquito en efectivo.

El pago se guarda con su propia **fecha y hora**, que puede ser distinta a la fecha de la
reserva. Los importes entregados deben sumar exactamente el total de combos de la reserva.

La sección **Pagos** muestra lo cobrado con tarjetas de resumen y una **tabla por cada fecha
de pago**. Cada tabla incluye el detalle de la reserva pagada:

| Dato | Descripción |
| --- | --- |
| Fecha | Fecha y hora en que se registró el pago (y debajo, la fecha de la reserva) |
| Combos | Cliente y detalle de cada combo: cantidad × nombre, con el precio por unidad |
| Transferencia | Dinero entregado por transferencia |
| Efectivo | Dinero entregado en efectivo |
| Total | Suma de transferencia + efectivo |

Cada tabla muestra además el **total del día** para transferencia, efectivo y total general.
Desde la sección Pagos se puede editar o quitar un pago; al quitarlo, la reserva vuelve a
figurar como **sin pagar**. Si una reserva está pagada, no se pueden cambiar sus combos hasta
quitar o ajustar el pago, para que el detalle del pago y el total de la reserva coincidan.

---

## Dónde viven los datos y copias de seguridad

La base de datos es un archivo SQLite normal, **`datos.sqlite`**, que se crea al lado de
`iniciar.bat`. Se guarda automáticamente después de cada cambio, sin apretar ningún botón, y
se puede abrir con cualquier herramienta de SQLite (DB Browser for SQLite, DBeaver, `sqlite3`).

```
pryctReserva\
├── datos.sqlite          Base de datos (se crea sola)
├── respaldos\
│   ├── diarios\          Una copia por día, se conservan 90
│   ├── recientes\        Una cada 15 minutos, se conservan 60
│   └── importaciones\    Copia previa a cada restauración, se conservan 20
```

- Las copias se crean **antes** de escribir y solo si el contenido cambió.
- La copia diaria guarda el estado con el que cerró el día anterior.
- Mientras la app está abierta, además, se mantiene una copia en el navegador (IndexedDB) como
  respaldo inmediato. Si el servidor local se cierra por error, la app avisa y sigue guardando
  ahí hasta que vuelvas a abrirla con `iniciar.bat`.

### Exportar e importar

- **Exportar**: descarga un archivo `mesa-y-evento-AAAA-MM-DD.sqlite` con toda la base.
- **Importar**: reemplaza la base actual por el contenido de un archivo `.sqlite`. Antes de
  reemplazarla se guarda una copia automática en `respaldos\importaciones`.

Para restaurar un respaldo, usá **Importar** y elegí el archivo correspondiente de la carpeta
`respaldos`. No hace falta copiar archivos a mano.

> **Una sola pestaña a la vez.** Si abrís la app en dos pestañas, la segunda que intente guardar
> recibe un aviso de conflicto y deja de escribir para no pisar los cambios de la otra. Recargá
> la página para continuar desde la versión más reciente.

### Abrir sin el servidor

Si abrís `index.html` con doble clic, la app funciona pero guarda solo en el navegador
(IndexedDB), como antes. El archivo `datos.sqlite` y los respaldos automáticos requieren
`iniciar.bat`.

---

## Estructura del proyecto

```
pryctReserva/
├── index.html                 Interfaz
├── css/estilos.css            Estilos
├── js/db.js                   Base de datos SQLite, validaciones y respaldo
├── js/app.js                  Lógica de la interfaz
├── vendor/
│   ├── sql-wasm.js            Motor SQLite para el navegador
│   ├── sql-wasm.wasm          Binario de SQLite
│   └── sqlite-wasm-base64.js  Binario incrustado (permite abrir sin servidor)
├── iniciar.bat                Inicia el servidor local y abre el navegador
├── iniciar.ps1                Servidor local: archivos, API de guardado y respaldos
├── datos.sqlite               Base de datos (se crea sola)
├── respaldos/                 Copias automáticas (se crea sola)
└── README.md
```

---

## Modelo de datos

```sql
CREATE TABLE clientes (
  id_cliente INTEGER PRIMARY KEY AUTOINCREMENT,  -- número único de cliente
  nombre     TEXT NOT NULL,
  apellido   TEXT NOT NULL,
  telefono   TEXT NOT NULL,
  documento  TEXT NOT NULL COLLATE NOCASE UNIQUE,
  creado_en  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE reservas (
  id_reserva    INTEGER PRIMARY KEY AUTOINCREMENT,
  id_cliente    INTEGER NOT NULL,                -- cliente asignado
  creada_en     TEXT NOT NULL DEFAULT (datetime('now','localtime')), -- fecha en que se hizo
  fecha_reserva TEXT NOT NULL,                   -- fecha para la que se reserva
  tipo          TEXT NOT NULL CHECK (tipo IN ('mesa', 'evento')),
  personas      INTEGER NOT NULL CHECK (personas BETWEEN 1 AND 500),
  detalle       TEXT NOT NULL DEFAULT '',        -- mesa asignada o nombre del evento
  estado        TEXT NOT NULL DEFAULT 'pendiente'
                CHECK (estado IN ('pendiente', 'confirmada', 'cancelada')),
  notas         TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (id_cliente) REFERENCES clientes (id_cliente)
    ON UPDATE CASCADE ON DELETE RESTRICT
);

CREATE INDEX idx_reservas_cliente ON reservas (id_cliente);
CREATE INDEX idx_reservas_fecha   ON reservas (fecha_reserva);

CREATE TABLE combos (
  id_combo  INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre    TEXT NOT NULL COLLATE NOCASE UNIQUE,
  contenido TEXT NOT NULL DEFAULT '',          -- comida que incluye
  precio    REAL NOT NULL CHECK (precio >= 0), -- precio por unidad
  creado_en TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE reserva_combos (
  id_reserva      INTEGER NOT NULL,
  id_combo        INTEGER NOT NULL,
  cantidad        INTEGER NOT NULL CHECK (cantidad BETWEEN 1 AND 500),
  precio_unitario REAL NOT NULL CHECK (precio_unitario >= 0),
  PRIMARY KEY (id_reserva, id_combo),
  FOREIGN KEY (id_reserva) REFERENCES reservas (id_reserva) ON DELETE CASCADE,
  FOREIGN KEY (id_combo) REFERENCES combos (id_combo)
    ON UPDATE CASCADE ON DELETE RESTRICT
);

CREATE INDEX idx_reserva_combos_combo ON reserva_combos (id_combo);

CREATE TABLE pagos (
  id_pago             INTEGER PRIMARY KEY AUTOINCREMENT,
  id_reserva          INTEGER NOT NULL UNIQUE,
  fecha_pago          TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  monto_transferencia REAL NOT NULL DEFAULT 0 CHECK (monto_transferencia >= 0),
  monto_efectivo      REAL NOT NULL DEFAULT 0 CHECK (monto_efectivo >= 0),
  FOREIGN KEY (id_reserva) REFERENCES reservas (id_reserva) ON DELETE CASCADE
);

CREATE INDEX idx_pagos_fecha ON pagos (fecha_pago);
```

La relación es **un cliente → muchas reservas** y **muchas reservas ↔ muchos combos** (cada
línea de `reserva_combos` guarda la cantidad y el precio unitario de ese momento). La clave
foránea `ON DELETE RESTRICT` impide borrar clientes con reservas y combos usados en reservas;
al borrar una reserva se borran sus líneas de combos y su pago (`ON DELETE CASCADE`). La app
explica estos casos antes de intentarlo. Cada reserva tiene como máximo un pago, que guarda
cuánto se entregó por transferencia y cuánto en efectivo.

---

## Validaciones incluidas

- Nombre y apellido: solo letras, espacios, puntos, apóstrofes y guiones.
- Teléfono: mínimo 6 dígitos, permite `+`, espacios, paréntesis, puntos y guiones.
- Documento: 4 a 20 caracteres alfanuméricos, único (sin distinguir mayúsculas).
- Al menos un cliente por reserva.
- Fecha y hora válidas; al crear, no se permiten fechas pasadas.
- Personas: número entero entre 1 y 500.
- Tipo y estado restringidos por la propia base de datos (`CHECK`).
- Combo: nombre obligatorio (2 a 60 caracteres) y único sin distinguir mayúsculas.
- Precio del combo: número mayor o igual a 0, con hasta 2 decimales.
- Cantidad de cada combo en una reserva: entero entre 1 y 500; no se puede repetir el mismo combo.
- El precio unitario de la reserva se guarda con la reserva y no cambia si después se edita el combo.
- Montos de pago: números mayores o iguales a 0; transferencia + efectivo debe coincidir con el total de combos.
- Un pago por reserva, con fecha y hora válidas. Al borrar la reserva se borra su pago.

---

## Datos de ejemplo

Si la base está vacía, en la pantalla de reservas aparece el botón **“Cargar datos de ejemplo”**.
Agrega 5 clientes, 6 reservas y 5 combos (con combos asignados a varias reservas) para probar la
aplicación; se pueden eliminar uno por uno.
