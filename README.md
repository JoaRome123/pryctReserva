# Mesa & Evento — Reservas del restaurante

Aplicación para administrar **clientes**, **reservas de mesas** y **eventos** de un restaurante.

Los datos se guardan en una base de datos **SQLite real** que funciona dentro del navegador
(SQLite compilado a WebAssembly). No hace falta instalar nada.

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

---

## Copias de seguridad

Los datos viven en el navegador. Para no depender de eso:

- **Exportar**: descarga un archivo `mesa-y-evento-AAAA-MM-DD.sqlite` con toda la base.
- **Importar**: reemplaza la base actual por el contenido de un archivo `.sqlite` exportado antes.

El archivo exportado se puede abrir con cualquier herramienta de SQLite (DB Browser for SQLite,
DBeaver, etc.).

> **Importante:** usá la aplicación en una sola pestaña a la vez. Si la abrís en dos pestañas,
> cada una trabaja con su propia copia en memoria y la última que guarde reemplaza a la otra.

---

## Estructura del proyecto

```
Proyecto predeterminado/
├── index.html                 Interfaz
├── css/estilos.css            Estilos
├── js/db.js                   Base de datos SQLite, validaciones y respaldo
├── js/app.js                  Lógica de la interfaz
├── vendor/
│   ├── sql-wasm.js            Motor SQLite para el navegador
│   ├── sql-wasm.wasm          Binario de SQLite
│   └── sqlite-wasm-base64.js  Binario incrustado (permite abrir sin servidor)
├── iniciar.bat                Inicia el servidor local y abre el navegador
├── iniciar.ps1                Servidor local (PowerShell)
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
```

La relación es **un cliente → muchas reservas**. La clave foránea `ON DELETE RESTRICT` impide
borrar clientes con reservas, y la app lo explica antes de intentarlo.

---

## Validaciones incluidas

- Nombre y apellido: solo letras, espacios, puntos, apóstrofes y guiones.
- Teléfono: mínimo 6 dígitos, permite `+`, espacios, paréntesis, puntos y guiones.
- Documento: 4 a 20 caracteres alfanuméricos, único (sin distinguir mayúsculas).
- Al menos un cliente por reserva.
- Fecha y hora válidas; al crear, no se permiten fechas pasadas.
- Personas: número entero entre 1 y 500.
- Tipo y estado restringidos por la propia base de datos (`CHECK`).

---

## Datos de ejemplo

Si la base está vacía, en la pantalla de reservas aparece el botón **“Cargar datos de ejemplo”**.
Agrega 5 clientes y 6 reservas para probar la aplicación; se pueden eliminar uno por uno.
