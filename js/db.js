/* ============================================================
   Mesa & Evento — capa de datos
   SQLite real en el navegador (sql.js) con guardado automático
   en IndexedDB (o localStorage como respaldo).
   ============================================================ */

(function () {
  'use strict';

  const IDB_NOMBRE = 'mesa-y-evento';
  const IDB_VERSION = 1;
  const IDB_STORE = 'base-de-datos';
  const IDB_CLAVE = 'sqlite';
  const LS_CLAVE = 'mesa-y-evento:sqlite';
  const LS_PENDIENTE = 'mesa-y-evento:pendiente';

  const API = '/api';
  const MOTIVO_IMPORTAR = 'importar';

  const TIPOS = ['mesa', 'evento'];
  const ESTADOS = ['pendiente', 'confirmada', 'cancelada'];

  const ESQUEMA = `
    CREATE TABLE IF NOT EXISTS clientes (
      id_cliente INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre     TEXT NOT NULL,
      apellido   TEXT NOT NULL,
      telefono   TEXT NOT NULL,
      documento  TEXT NOT NULL COLLATE NOCASE UNIQUE,
      creado_en  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS reservas (
      id_reserva   INTEGER PRIMARY KEY AUTOINCREMENT,
      id_cliente   INTEGER NOT NULL,
      creada_en    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      fecha_reserva TEXT NOT NULL,
      tipo         TEXT NOT NULL CHECK (tipo IN ('mesa', 'evento')),
      personas     INTEGER NOT NULL CHECK (personas BETWEEN 1 AND 500),
      detalle      TEXT NOT NULL DEFAULT '',
      estado       TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'confirmada', 'cancelada')),
      notas        TEXT NOT NULL DEFAULT '',
      FOREIGN KEY (id_cliente) REFERENCES clientes (id_cliente)
        ON UPDATE CASCADE ON DELETE RESTRICT
    );

    CREATE INDEX IF NOT EXISTS idx_reservas_cliente ON reservas (id_cliente);
    CREATE INDEX IF NOT EXISTS idx_reservas_fecha   ON reservas (fecha_reserva);

    CREATE TABLE IF NOT EXISTS combos (
      id_combo  INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre    TEXT NOT NULL COLLATE NOCASE UNIQUE,
      contenido TEXT NOT NULL DEFAULT '',
      precio    REAL NOT NULL CHECK (precio >= 0),
      creado_en TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS reserva_combos (
      id_reserva      INTEGER NOT NULL,
      id_combo        INTEGER NOT NULL,
      cantidad        INTEGER NOT NULL CHECK (cantidad BETWEEN 1 AND 500),
      precio_unitario REAL NOT NULL CHECK (precio_unitario >= 0),
      PRIMARY KEY (id_reserva, id_combo),
      FOREIGN KEY (id_reserva) REFERENCES reservas (id_reserva) ON DELETE CASCADE,
      FOREIGN KEY (id_combo) REFERENCES combos (id_combo)
        ON UPDATE CASCADE ON DELETE RESTRICT
    );

    CREATE INDEX IF NOT EXISTS idx_reserva_combos_combo ON reserva_combos (id_combo);

    CREATE TABLE IF NOT EXISTS pagos (
      id_pago             INTEGER PRIMARY KEY AUTOINCREMENT,
      id_reserva          INTEGER NOT NULL UNIQUE,
      fecha_pago          TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      monto_transferencia REAL NOT NULL DEFAULT 0 CHECK (monto_transferencia >= 0),
      monto_efectivo      REAL NOT NULL DEFAULT 0 CHECK (monto_efectivo >= 0),
      FOREIGN KEY (id_reserva) REFERENCES reservas (id_reserva) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_pagos_fecha ON pagos (fecha_pago);
  `;

  let SQL = null;
  let db = null;
  let almacen = 'memoria'; // 'servidor' | 'indexeddb' | 'local' | 'memoria'
  let idb = null;
  let temporizador = null;
  let guardando = null;
  let sucio = false;
  let inicializada = false;
  let advertenciaInicio = null;
  let revision = null;      // ETag del archivo datos.sqlite
  let conflicto = false;    // otra pestaña guardó cambios
  let rutaArchivo = null;   // ruta del archivo informada por el servidor
  let necesitaVolcado = false; // la copia del navegador todavía no está en disco

  /* ---------- utilidades ---------- */

  function limpiar(texto) {
    return String(texto ?? '').trim().replace(/\s+/g, ' ');
  }

  function nroCliente(id) {
    return '#' + String(id).padStart(4, '0');
  }

  function redondearPrecio(valor) {
    const numero = Number(valor);
    if (!Number.isFinite(numero)) return NaN;
    return Math.round((numero + Number.EPSILON) * 100) / 100;
  }

  function base64ABytes(b64) {
    const binario = atob(b64);
    const bytes = new Uint8Array(binario.length);
    for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
    return bytes;
  }

  function bytesABase64(bytes) {
    let binario = '';
    const trozo = 0x8000;
    for (let i = 0; i < bytes.length; i += trozo) {
      binario += String.fromCharCode.apply(null, bytes.subarray(i, i + trozo));
    }
    return btoa(binario);
  }

  function conTiempo(promesa, ms) {
    return Promise.race([
      promesa,
      new Promise(function (_, rechazar) {
        setTimeout(function () { rechazar(new Error('Tiempo de espera agotado')); }, ms);
      })
    ]);
  }

  async function pedir(url, opciones, ms) {
    const control = new AbortController();
    const reloj = setTimeout(function () { control.abort(); }, ms);
    try {
      return await fetch(url, Object.assign({ cache: 'no-store', signal: control.signal }, opciones || {}));
    } finally {
      clearTimeout(reloj);
    }
  }

  function notificar(detalle) {
    document.dispatchEvent(new CustomEvent('db:guardado', { detail: detalle }));
  }

  /* ---------- almacenamiento ---------- */

  function abrirIDB() {
    return new Promise(function (resolve, reject) {
      let solicitud;
      try {
        solicitud = indexedDB.open(IDB_NOMBRE, IDB_VERSION);
      } catch (error) {
        reject(error);
        return;
      }
      solicitud.onupgradeneeded = function () {
        const base = solicitud.result;
        if (!base.objectStoreNames.contains(IDB_STORE)) base.createObjectStore(IDB_STORE);
      };
      solicitud.onsuccess = function () { resolve(solicitud.result); };
      solicitud.onerror = function () { reject(solicitud.error || new Error('No se pudo abrir IndexedDB')); };
      solicitud.onblocked = function () { reject(new Error('IndexedDB bloqueado')); };
    });
  }

  function leerIDB() {
    return new Promise(function (resolve, reject) {
      const tx = idb.transaction(IDB_STORE, 'readonly');
      const solicitud = tx.objectStore(IDB_STORE).get(IDB_CLAVE);
      solicitud.onsuccess = function () { resolve(solicitud.result || null); };
      solicitud.onerror = function () { reject(solicitud.error); };
    });
  }

  function escribirIDB(bytes) {
    return new Promise(function (resolve, reject) {
      const tx = idb.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(bytes, IDB_CLAVE);
      tx.oncomplete = function () { resolve(); };
      tx.onerror = function () { reject(tx.error); };
      tx.onabort = function () { reject(tx.error || new Error('Guardado cancelado')); };
    });
  }

  async function elegirAlmacen() {
    try {
      const respuesta = await pedir(API + '/estado', { headers: { Accept: 'application/json' } }, 1500);
      if (respuesta.ok) {
        const datos = await respuesta.json();
        if (datos && datos.ruta) rutaArchivo = datos.ruta;
        if (datos && datos.etag) revision = datos.etag;
        almacen = 'servidor';
        return;
      }
    } catch (error) {
      // Sin servidor local: seguimos con el almacenamiento del navegador.
    }
    await elegirAlmacenNavegador();
  }

  async function elegirAlmacenNavegador() {
    try {
      idb = await conTiempo(abrirIDB(), 2500);
      almacen = 'indexeddb';
      return;
    } catch (error) {
      idb = null;
    }
    try {
      if (!window.localStorage) throw new Error('sin localStorage');
      localStorage.setItem(LS_CLAVE + ':prueba', '1');
      localStorage.removeItem(LS_CLAVE + ':prueba');
      almacen = 'local';
    } catch (error) {
      almacen = 'memoria';
    }
  }

  function normalizarBytes(valor) {
    if (!valor) return null;
    if (valor instanceof Uint8Array) return valor;
    if (valor instanceof ArrayBuffer) return new Uint8Array(valor);
    if (valor && valor.buffer) return new Uint8Array(valor.buffer, valor.byteOffset, valor.byteLength);
    return null;
  }

  function hayCambiosPendientes() {
    try { return Boolean(localStorage.getItem(LS_PENDIENTE)); } catch (error) { return false; }
  }

  function marcarCambiosPendientes() {
    try { localStorage.setItem(LS_PENDIENTE, String(Date.now())); } catch (error) { }
  }

  function limpiarCambiosPendientes() {
    try { localStorage.removeItem(LS_PENDIENTE); } catch (error) { }
  }

  async function leerGuardado() {
    if (almacen === 'servidor' && !conflicto) {
      try {
        const respuesta = await pedir(API + '/db', {}, 4000);
        if (respuesta.status === 404) {
          // El archivo todavía no existe: migramos la copia del navegador, si hay.
          necesitaVolcado = true;
          return await leerGuardadoNavegador();
        }
        if (!respuesta.ok) throw new Error('El servidor respondió ' + respuesta.status);
        revision = respuesta.headers.get('ETag') || revision;

        // Si se guardó en el navegador mientras el servidor estaba caído,
        // esa copia es más nueva que el archivo.
        if (hayCambiosPendientes()) {
          const espejo = await leerGuardadoNavegador();
          if (espejo && espejo.length) {
            necesitaVolcado = true;
            return espejo;
          }
        }

        const buffer = await respuesta.arrayBuffer();
        return new Uint8Array(buffer);
      } catch (error) {
        console.warn('No se pudo leer datos.sqlite; se usa la copia del navegador:', error);
        await elegirAlmacenNavegador();
      }
    }
    return await leerGuardadoNavegador();
  }

  async function leerGuardadoNavegador() {
    try {
      if (!idb) {
        try { idb = await conTiempo(abrirIDB(), 2500); } catch (error) { idb = null; }
      }
      if (idb) {
        const valor = await conTiempo(leerIDB(), 3500);
        const bytes = normalizarBytes(valor);
        if (bytes) return bytes;
      }
      if (window.localStorage) {
        const texto = localStorage.getItem(LS_CLAVE);
        if (texto) return base64ABytes(texto);
      }
    } catch (error) {
      console.warn('No se pudo leer la base guardada en el navegador:', error);
    }
    return null;
  }

  async function guardarEspejo(bytes) {
    try {
      if (!idb) {
        try { idb = await conTiempo(abrirIDB(), 2500); } catch (error) { idb = null; }
      }
      if (idb) {
        await conTiempo(escribirIDB(bytes), 5000);
        return;
      }
      if (window.localStorage) localStorage.setItem(LS_CLAVE, bytesABase64(bytes));
    } catch (error) {
      console.warn('No se pudo actualizar la copia de respaldo en el navegador:', error);
    }
  }

  async function pasarAAlmacenNavegador(bytes) {
    marcarCambiosPendientes();
    await guardarEspejo(bytes);
    if (idb) { almacen = 'indexeddb'; return; }
    try {
      if (!window.localStorage) throw new Error('sin localStorage');
      localStorage.setItem(LS_CLAVE + ':prueba', '1');
      localStorage.removeItem(LS_CLAVE + ':prueba');
      almacen = 'local';
    } catch (error) {
      almacen = 'memoria';
    }
  }

  async function escribirGuardado(bytes, motivo) {
    if (almacen === 'servidor') {
      const cabeceras = { 'Content-Type': 'application/octet-stream' };
      if (revision) cabeceras['If-Match'] = revision;
      if (motivo) cabeceras['X-Motivo'] = motivo;

      const respuesta = await pedir(API + '/db', {
        method: 'POST',
        headers: cabeceras,
        body: bytes
      }, 8000);

      if (respuesta.status === 412) {
        const error = new Error('Otra pestaña guardó cambios en la base de datos.');
        error.conflicto = true;
        throw error;
      }
      if (!respuesta.ok) {
        let detalle = '';
        try { detalle = await respuesta.text(); } catch (error) { }
        throw new Error('El servidor no pudo guardar datos.sqlite (' + respuesta.status + ').' +
          (detalle ? ' ' + detalle : ''));
      }

      const etag = respuesta.headers.get('ETag');
      if (etag) revision = etag;
      limpiarCambiosPendientes();
      await guardarEspejo(bytes);
      return;
    }
    if (almacen === 'indexeddb') {
      await conTiempo(escribirIDB(bytes), 5000);
      marcarCambiosPendientes();
      return;
    }
    if (almacen === 'local') {
      localStorage.setItem(LS_CLAVE, bytesABase64(bytes));
      marcarCambiosPendientes();
      return;
    }
    throw new Error('Este navegador no permite guardar datos.');
  }

  function exportarBytes() {
    // sql.js cierra y reabre la conexión al exportar: hay que reactivar las claves foráneas.
    const bytes = db.export();
    try { db.run('PRAGMA foreign_keys = ON;'); } catch (error) { }
    return bytes;
  }

  function programarGuardado(motivo) {
    sucio = true;
    if (temporizador) clearTimeout(temporizador);
    temporizador = setTimeout(function () {
      temporizador = null;
      guardarAhora(motivo);
    }, 250);
  }

  function guardarAhora(motivo) {
    if (!db) return Promise.resolve();
    if (conflicto) return Promise.resolve();
    if (temporizador) {
      clearTimeout(temporizador);
      temporizador = null;
    }
    if (!guardando) {
      guardando = (async function () {
        try {
          do {
            sucio = false;
            const bytes = exportarBytes();
            await escribirGuardado(bytes, motivo);
            notificar({ ok: true, almacen: almacen });
          } while (sucio);
        } catch (error) {
          if (error && error.conflicto) {
            conflicto = true;
            notificar({ ok: false, almacen: almacen, conflicto: true, error: error });
            document.dispatchEvent(new CustomEvent('db:conflicto', {
              detail: { error: error, ruta: rutaArchivo }
            }));
            return;
          }
          if (almacen === 'servidor') {
            // El archivo no se pudo escribir: conservamos los datos en el navegador.
            await pasarAAlmacenNavegador(exportarBytes());
            notificar({ ok: false, almacen: almacen, servidor: true, error: error });
            return;
          }
          if (almacen !== 'memoria') almacen = 'memoria';
          notificar({ ok: false, almacen: almacen, error: error });
        } finally {
          guardando = null;
        }
      })();
    }
    return guardando;
  }

  /* ---------- SQL ---------- */

  function filas(sql, parametros) {
    if (!db) throw new Error('La base de datos todavía no está lista.');
    const sentencia = db.prepare(sql);
    try {
      sentencia.bind(parametros || []);
      const resultado = [];
      while (sentencia.step()) resultado.push(sentencia.getAsObject());
      return resultado;
    } finally {
      sentencia.free();
    }
  }

  function fila(sql, parametros) {
    return filas(sql, parametros)[0] || null;
  }

  function ejecutar(sql, parametros) {
    db.run(sql, parametros || []);
    programarGuardado();
  }

  function ultimoId() {
    const resultado = fila('SELECT last_insert_rowid() AS id');
    return resultado ? Number(resultado.id) : 0;
  }

  function aplicarEsquema(instancia) {
    (instancia || db).exec(ESQUEMA);
  }

  /* ---------- validaciones ---------- */

  const RE_NOMBRE = /^[\p{L}][\p{L}\s'.-]{0,59}$/u;
  const RE_DOCUMENTO = /^[A-Z0-9][A-Z0-9.\-]{3,19}$/;
  const RE_TELEFONO = /^[0-9+()\s.\-]{6,25}$/;

  function validarCliente(datos) {
    const nombre = limpiar(datos.nombre);
    const apellido = limpiar(datos.apellido);
    const telefono = limpiar(datos.telefono);
    const documento = String(datos.documento ?? '').replace(/\s+/g, '').toUpperCase();

    if (!nombre) throw new Error('Ingresá el nombre del cliente.');
    if (!RE_NOMBRE.test(nombre)) throw new Error('El nombre solo puede contener letras, espacios, puntos, apóstrofes y guiones.');
    if (!apellido) throw new Error('Ingresá el apellido del cliente.');
    if (!RE_NOMBRE.test(apellido)) throw new Error('El apellido solo puede contener letras, espacios, puntos, apóstrofes y guiones.');

    const digitos = telefono.replace(/\D/g, '');
    if (!telefono) throw new Error('Ingresá el teléfono del cliente.');
    if (!RE_TELEFONO.test(telefono) || digitos.length < 6) {
      throw new Error('Ingresá un teléfono válido: solo números, espacios, paréntesis, puntos o guiones (mínimo 6 dígitos).');
    }

    if (!documento) throw new Error('Ingresá el número de documento del cliente.');
    if (!RE_DOCUMENTO.test(documento)) {
      throw new Error('El número de documento debe tener entre 4 y 20 caracteres (letras, números, puntos o guiones), sin espacios.');
    }

    return { nombre: nombre, apellido: apellido, telefono: telefono, documento: documento };
  }

  function validarReserva(datos) {
    const idCliente = Number(datos.id_cliente);
    if (!Number.isInteger(idCliente) || idCliente <= 0) throw new Error('Seleccioná un cliente para la reserva.');
    if (!fila('SELECT id_cliente FROM clientes WHERE id_cliente = ?', [idCliente])) {
      throw new Error('El cliente seleccionado ya no existe. Actualizá la lista e intentá de nuevo.');
    }

    const fecha = String(datos.fecha_reserva ?? '').trim();
    const partes = fecha.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
    if (!partes) throw new Error('Elegí una fecha y hora válidas para la reserva.');
    const anio = Number(partes[1]);
    const mes = Number(partes[2]);
    const dia = Number(partes[3]);
    const hora = Number(partes[4]);
    const minuto = Number(partes[5]);
    const fechaObj = new Date(anio, mes - 1, dia, hora, minuto);
    if (
      Number.isNaN(fechaObj.getTime()) ||
      fechaObj.getFullYear() !== anio ||
      fechaObj.getMonth() !== mes - 1 ||
      fechaObj.getDate() !== dia ||
      fechaObj.getHours() !== hora ||
      fechaObj.getMinutes() !== minuto
    ) {
      throw new Error('La fecha y hora ingresadas no son válidas.');
    }

    const personas = Number(datos.personas);
    if (!Number.isInteger(personas) || personas < 1 || personas > 500) {
      throw new Error('La cantidad de personas debe ser un número entero entre 1 y 500.');
    }

    const tipo = String(datos.tipo ?? '').toLowerCase();
    if (TIPOS.indexOf(tipo) === -1) throw new Error('Elegí si la reserva es de mesa o de evento.');

    const estado = String(datos.estado ?? 'pendiente').toLowerCase();
    if (ESTADOS.indexOf(estado) === -1) throw new Error('El estado de la reserva no es válido.');

    const detalle = limpiar(datos.detalle).slice(0, 80);
    const notas = limpiar(datos.notas).slice(0, 500);

    return {
      id_cliente: idCliente,
      fecha_reserva: partes[1] + '-' + partes[2] + '-' + partes[3] + 'T' + partes[4] + ':' + partes[5],
      tipo: tipo,
      personas: personas,
      detalle: detalle,
      estado: estado,
      notas: notas
    };
  }

  /* ---------- combos ---------- */

  const PRECIO_MAXIMO = 10000000;

  function validarCombo(datos) {
    const nombre = limpiar(datos && datos.nombre).slice(0, 60);
    const contenido = limpiar(datos && datos.contenido).slice(0, 200);
    const precio = redondearPrecio(datos && datos.precio);

    if (!nombre) throw new Error('Ingresá el nombre del combo.');
    if (nombre.length < 2) throw new Error('El nombre del combo debe tener al menos 2 caracteres.');
    if (/[\u0000-\u001f\u007f]/.test(nombre)) throw new Error('El nombre del combo tiene caracteres no permitidos.');

    if (!Number.isFinite(precio)) throw new Error('Ingresá el precio del combo.');
    if (precio < 0) throw new Error('El precio del combo no puede ser negativo.');
    if (precio > PRECIO_MAXIMO) throw new Error('El precio del combo supera el máximo permitido.');

    return { nombre: nombre, contenido: contenido, precio: precio };
  }

  function listarCombos(busqueda) {
    const texto = limpiar(busqueda).toLowerCase();
    const parametros = [];
    let donde = '';
    if (texto) {
      const patron = '%' + texto + '%';
      donde = "WHERE (LOWER(c.nombre) LIKE ? OR LOWER(c.contenido) LIKE ?)";
      parametros.push(patron, patron);
    }
    return filas(`
      SELECT
        c.*,
        (SELECT COUNT(*) FROM reserva_combos rc WHERE rc.id_combo = c.id_combo) AS usos
      FROM combos c
      ${donde}
      ORDER BY c.nombre COLLATE NOCASE
    `, parametros);
  }

  function obtenerCombo(id) {
    return fila('SELECT * FROM combos WHERE id_combo = ?', [Number(id)]);
  }

  function contarReservasConCombo(id) {
    const resultado = fila('SELECT COUNT(*) AS n FROM reserva_combos WHERE id_combo = ?', [Number(id)]);
    return resultado ? Number(resultado.n) : 0;
  }

  function crearCombo(datos) {
    const limpio = validarCombo(datos);
    const existente = fila('SELECT id_combo FROM combos WHERE nombre = ? COLLATE NOCASE', [limpio.nombre]);
    if (existente) {
      throw new Error('Ya existe un combo llamado “' + limpio.nombre + '”. Elegí otro nombre.');
    }
    ejecutar(
      'INSERT INTO combos (nombre, contenido, precio) VALUES (?, ?, ?)',
      [limpio.nombre, limpio.contenido, limpio.precio]
    );
    return ultimoId();
  }

  function actualizarCombo(id, datos) {
    const numero = Number(id);
    if (!obtenerCombo(numero)) throw new Error('El combo ya no existe.');
    const limpio = validarCombo(datos);
    const existente = fila('SELECT id_combo FROM combos WHERE nombre = ? COLLATE NOCASE AND id_combo <> ?', [limpio.nombre, numero]);
    if (existente) {
      throw new Error('Ya existe un combo llamado “' + limpio.nombre + '”. Elegí otro nombre.');
    }
    ejecutar(
      'UPDATE combos SET nombre = ?, contenido = ?, precio = ? WHERE id_combo = ?',
      [limpio.nombre, limpio.contenido, limpio.precio, numero]
    );
    return numero;
  }

  function eliminarCombo(id) {
    const numero = Number(id);
    if (!obtenerCombo(numero)) throw new Error('El combo ya no existe.');
    const total = contarReservasConCombo(numero);
    if (total > 0) {
      throw new Error(
        'Este combo aparece en ' + total + ' reserva' + (total === 1 ? '' : 's') +
        '. Quitalo de esas reservas antes de eliminarlo (podés editar el combo para marcarlo de otra forma).'
      );
    }
    ejecutar('DELETE FROM combos WHERE id_combo = ?', [numero]);
  }

  function validarCombosReserva(items) {
    const origen = Array.isArray(items) ? items : [];
    const limpios = [];
    const vistos = Object.create(null);

    for (let i = 0; i < origen.length; i++) {
      const item = origen[i] || {};
      const idCombo = Number(item.id_combo);
      if (!Number.isInteger(idCombo) || idCombo <= 0) {
        throw new Error('Hay un combo inválido en la reserva. Quitalo y agregalo de nuevo.');
      }
      if (vistos[idCombo]) {
        throw new Error('El mismo combo está repetido en la reserva. Usá una sola línea y aumentá la cantidad.');
      }
      vistos[idCombo] = true;

      const combo = fila('SELECT id_combo, precio FROM combos WHERE id_combo = ?', [idCombo]);
      if (!combo) throw new Error('Uno de los combos de la reserva ya no existe. Actualizá la lista e intentá de nuevo.');

      const cantidad = Number(item.cantidad);
      if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > 500) {
        throw new Error('La cantidad de cada combo debe ser un número entero entre 1 y 500.');
      }

      const sinPrecio = item.precio_unitario === undefined || item.precio_unitario === null || item.precio_unitario === '';
      const precio = sinPrecio ? Number(combo.precio) : redondearPrecio(item.precio_unitario);
      if (!Number.isFinite(precio) || precio < 0 || precio > PRECIO_MAXIMO) {
        throw new Error('El precio por unidad de un combo no es válido.');
      }

      limpios.push({ id_combo: idCombo, cantidad: cantidad, precio_unitario: precio });
    }

    return limpios;
  }

  function guardarCombosDeReserva(idReserva, combos) {
    db.run('DELETE FROM reserva_combos WHERE id_reserva = ?', [Number(idReserva)]);
    for (let i = 0; i < combos.length; i++) {
      const combo = combos[i];
      db.run(
        'INSERT INTO reserva_combos (id_reserva, id_combo, cantidad, precio_unitario) VALUES (?, ?, ?, ?)',
        [Number(idReserva), combo.id_combo, combo.cantidad, combo.precio_unitario]
      );
    }
  }

  function combosDeReserva(id) {
    return filas(`
      SELECT rc.id_combo, rc.cantidad, rc.precio_unitario, c.nombre, c.contenido
      FROM reserva_combos rc
      JOIN combos c ON c.id_combo = rc.id_combo
      WHERE rc.id_reserva = ?
      ORDER BY c.nombre COLLATE NOCASE
    `, [Number(id)]);
  }

  /* ---------- clientes ---------- */

  function listarClientes(busqueda) {
    const texto = limpiar(busqueda).toLowerCase();
    const parametros = [];
    let donde = '';
    if (texto) {
      const patron = '%' + texto + '%';
      donde = `WHERE (
        LOWER(c.nombre || ' ' || c.apellido) LIKE ?
        OR LOWER(c.apellido || ', ' || c.nombre) LIKE ?
        OR LOWER(c.documento) LIKE ?
        OR c.telefono LIKE ?
        OR CAST(c.id_cliente AS TEXT) LIKE ?
      )`;
      parametros.push(patron, patron, patron, patron, patron);
    }
    return filas(`
      SELECT
        c.*,
        COUNT(r.id_reserva) AS total_reservas,
        COALESCE(SUM(CASE WHEN r.estado <> 'cancelada' AND datetime(r.fecha_reserva) >= datetime('now','localtime') THEN 1 ELSE 0 END), 0) AS proximas
      FROM clientes c
      LEFT JOIN reservas r ON r.id_cliente = c.id_cliente
      ${donde}
      GROUP BY c.id_cliente
      ORDER BY c.apellido COLLATE NOCASE, c.nombre COLLATE NOCASE, c.id_cliente
    `, parametros);
  }

  function obtenerCliente(id) {
    return fila('SELECT * FROM clientes WHERE id_cliente = ?', [Number(id)]);
  }

  function crearCliente(datos) {
    const limpio = validarCliente(datos);
    const existente = fila('SELECT id_cliente FROM clientes WHERE documento = ?', [limpio.documento]);
    if (existente) {
      throw new Error('El documento ' + limpio.documento + ' ya está registrado por el cliente ' + nroCliente(existente.id_cliente) + '.');
    }
    ejecutar(
      'INSERT INTO clientes (nombre, apellido, telefono, documento) VALUES (?, ?, ?, ?)',
      [limpio.nombre, limpio.apellido, limpio.telefono, limpio.documento]
    );
    return ultimoId();
  }

  function actualizarCliente(id, datos) {
    const numero = Number(id);
    if (!obtenerCliente(numero)) throw new Error('El cliente ya no existe.');
    const limpio = validarCliente(datos);
    const existente = fila('SELECT id_cliente FROM clientes WHERE documento = ? AND id_cliente <> ?', [limpio.documento, numero]);
    if (existente) {
      throw new Error('El documento ' + limpio.documento + ' ya está registrado por el cliente ' + nroCliente(existente.id_cliente) + '.');
    }
    ejecutar(
      'UPDATE clientes SET nombre = ?, apellido = ?, telefono = ?, documento = ? WHERE id_cliente = ?',
      [limpio.nombre, limpio.apellido, limpio.telefono, limpio.documento, numero]
    );
    return numero;
  }

  function contarReservasDeCliente(id) {
    const resultado = fila('SELECT COUNT(*) AS n FROM reservas WHERE id_cliente = ?', [Number(id)]);
    return resultado ? Number(resultado.n) : 0;
  }

  function eliminarCliente(id) {
    const numero = Number(id);
    if (!obtenerCliente(numero)) throw new Error('El cliente ya no existe.');
    const total = contarReservasDeCliente(numero);
    if (total > 0) {
      throw new Error(
        'El cliente ' + nroCliente(numero) + ' tiene ' + total + ' reserva' + (total === 1 ? '' : 's') +
        ' asociada' + (total === 1 ? '' : 's') + '. Eliminá o reasigná esas reservas antes de borrar la ficha.'
      );
    }
    ejecutar('DELETE FROM clientes WHERE id_cliente = ?', [numero]);
  }

  /* ---------- reservas ---------- */

  function listarReservas(opciones) {
    const op = opciones || {};
    const condiciones = [];
    const parametros = [];

    if (op.idCliente) {
      condiciones.push('r.id_cliente = ?');
      parametros.push(Number(op.idCliente));
    }
    if (op.tipo) {
      condiciones.push('r.tipo = ?');
      parametros.push(op.tipo);
    }
    if (op.estado) {
      condiciones.push('r.estado = ?');
      parametros.push(op.estado);
    }
    if (op.fecha === 'proximas') condiciones.push("datetime(r.fecha_reserva) >= datetime('now','localtime')");
    if (op.fecha === 'hoy') condiciones.push("date(r.fecha_reserva) = date('now','localtime')");
    if (op.fecha === 'pasadas') condiciones.push("datetime(r.fecha_reserva) < datetime('now','localtime')");

    const texto = limpiar(op.busqueda).toLowerCase();
    if (texto) {
      const patron = '%' + texto + '%';
      condiciones.push(`(
        LOWER(c.nombre || ' ' || c.apellido) LIKE ?
        OR LOWER(c.apellido || ', ' || c.nombre) LIKE ?
        OR LOWER(c.documento) LIKE ?
        OR c.telefono LIKE ?
        OR CAST(c.id_cliente AS TEXT) LIKE ?
        OR LOWER(COALESCE(r.detalle, '')) LIKE ?
        OR LOWER(COALESCE(r.notas, '')) LIKE ?
      )`);
      parametros.push(patron, patron, patron, patron, patron, patron, patron);
    }

    const donde = condiciones.length ? 'WHERE ' + condiciones.join(' AND ') : '';

    return filas(`
      SELECT
        r.*,
        c.nombre,
        c.apellido,
        c.telefono,
        c.documento,
        (SELECT COALESCE(SUM(rc.cantidad), 0)
           FROM reserva_combos rc WHERE rc.id_reserva = r.id_reserva) AS combos_cantidad,
        (SELECT COALESCE(SUM(rc.cantidad * rc.precio_unitario), 0)
           FROM reserva_combos rc WHERE rc.id_reserva = r.id_reserva) AS combos_total,
        (SELECT p.id_pago FROM pagos p WHERE p.id_reserva = r.id_reserva) AS id_pago,
        (SELECT p.fecha_pago FROM pagos p WHERE p.id_reserva = r.id_reserva) AS pago_fecha,
        (SELECT p.monto_transferencia FROM pagos p WHERE p.id_reserva = r.id_reserva) AS pago_transferencia,
        (SELECT p.monto_efectivo FROM pagos p WHERE p.id_reserva = r.id_reserva) AS pago_efectivo,
        (SELECT p.monto_transferencia + p.monto_efectivo FROM pagos p WHERE p.id_reserva = r.id_reserva) AS pago_total,
        (SELECT GROUP_CONCAT(t.linea, ' · ')
           FROM (
             SELECT rc.cantidad || '× ' || cb.nombre AS linea
             FROM reserva_combos rc
             JOIN combos cb ON cb.id_combo = rc.id_combo
             WHERE rc.id_reserva = r.id_reserva
             ORDER BY cb.nombre COLLATE NOCASE
           ) t) AS combos_detalle
      FROM reservas r
      JOIN clientes c ON c.id_cliente = r.id_cliente
      ${donde}
      ORDER BY
        CASE
          WHEN r.estado = 'cancelada' THEN 2
          WHEN datetime(r.fecha_reserva) < datetime('now','localtime') THEN 1
          ELSE 0
        END,
        CASE WHEN datetime(r.fecha_reserva) < datetime('now','localtime') THEN r.fecha_reserva END DESC,
        r.fecha_reserva ASC
    `, parametros);
  }

  function contarReservas() {
    const resultado = fila('SELECT COUNT(*) AS n FROM reservas');
    return resultado ? Number(resultado.n) : 0;
  }

  function estadisticas() {
    const resultado = fila(`
      SELECT
        (SELECT COUNT(*) FROM reservas
          WHERE estado <> 'cancelada' AND datetime(fecha_reserva) >= datetime('now','localtime')) AS proximas,
        (SELECT COALESCE(SUM(personas), 0) FROM reservas
          WHERE estado <> 'cancelada' AND datetime(fecha_reserva) >= datetime('now','localtime')) AS comensales,
        (SELECT COUNT(*) FROM reservas
          WHERE tipo = 'evento' AND estado <> 'cancelada' AND datetime(fecha_reserva) >= datetime('now','localtime')) AS eventos,
        (SELECT COUNT(*) FROM clientes) AS clientes,
        (SELECT COUNT(*) FROM reservas) AS reservas,
        (SELECT COUNT(*) FROM combos) AS combos,
        (SELECT COUNT(*) FROM pagos) AS pagos,
        (SELECT COALESCE(SUM(rc.cantidad), 0) FROM reserva_combos rc
           JOIN reservas r ON r.id_reserva = rc.id_reserva
          WHERE r.estado <> 'cancelada' AND datetime(r.fecha_reserva) >= datetime('now','localtime')) AS combos_proximos
    `) || {};
    return {
      proximas: Number(resultado.proximas || 0),
      comensales: Number(resultado.comensales || 0),
      eventos: Number(resultado.eventos || 0),
      clientes: Number(resultado.clientes || 0),
      reservas: Number(resultado.reservas || 0),
      combos: Number(resultado.combos || 0),
      pagos: Number(resultado.pagos || 0),
      combos_proximos: Number(resultado.combos_proximos || 0)
    };
  }

  function crearReserva(datos) {
    const limpio = validarReserva(datos);
    const combos = validarCombosReserva(datos && datos.combos);

    db.run('BEGIN');
    try {
      db.run(
        `INSERT INTO reservas (id_cliente, fecha_reserva, tipo, personas, detalle, estado, notas, creada_en)
         VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now','localtime'))`,
        [limpio.id_cliente, limpio.fecha_reserva, limpio.tipo, limpio.personas, limpio.detalle, limpio.estado, limpio.notas]
      );
      const id = ultimoId();
      guardarCombosDeReserva(id, combos);
      db.run('COMMIT');
      programarGuardado();
      return id;
    } catch (error) {
      db.run('ROLLBACK');
      throw error;
    }
  }

  function actualizarReserva(id, datos) {
    const numero = Number(id);
    if (!fila('SELECT id_reserva FROM reservas WHERE id_reserva = ?', [numero])) {
      throw new Error('La reserva ya no existe.');
    }
    const limpio = validarReserva(datos);
    const cambiaCombos = Boolean(datos) && Array.isArray(datos.combos);
    const combos = cambiaCombos ? validarCombosReserva(datos.combos) : null;

    const pago = fila('SELECT monto_transferencia, monto_efectivo FROM pagos WHERE id_reserva = ?', [numero]);
    if (pago) {
      const totalPago = redondearPrecio(Number(pago.monto_transferencia) + Number(pago.monto_efectivo));
      const totalNuevo = combos
        ? redondearPrecio(combos.reduce(function (suma, combo) {
          return suma + (Number(combo.cantidad) * Number(combo.precio_unitario));
        }, 0))
        : totalCombosDeReserva(numero);
      if (Math.abs(totalPago - totalNuevo) > 0.009) {
        throw new Error(
          'La reserva está pagada por ' + montoTexto(totalPago) + ' y los combos nuevos suman ' + montoTexto(totalNuevo) +
          '. Para cambiar los combos, primero quitá o ajustá el pago.'
        );
      }
    }

    db.run('BEGIN');
    try {
      db.run(
        `UPDATE reservas SET id_cliente = ?, fecha_reserva = ?, tipo = ?, personas = ?, detalle = ?, estado = ?, notas = ?
         WHERE id_reserva = ?`,
        [limpio.id_cliente, limpio.fecha_reserva, limpio.tipo, limpio.personas, limpio.detalle, limpio.estado, limpio.notas, numero]
      );
      if (cambiaCombos) guardarCombosDeReserva(numero, combos);
      db.run('COMMIT');
      programarGuardado();
      return numero;
    } catch (error) {
      db.run('ROLLBACK');
      throw error;
    }
  }

  function eliminarReserva(id) {
    ejecutar('DELETE FROM reservas WHERE id_reserva = ?', [Number(id)]);
  }

  /* ---------- pagos ---------- */

  function montoTexto(valor) {
    const numero = Number(valor);
    return '$' + (Number.isFinite(numero) ? numero : 0).toLocaleString('es-AR', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2
    });
  }

  function totalCombosDeReserva(idReserva) {
    const resultado = fila(
      'SELECT COALESCE(SUM(cantidad * precio_unitario), 0) AS total FROM reserva_combos WHERE id_reserva = ?',
      [Number(idReserva)]
    );
    return redondearPrecio(resultado ? resultado.total : 0);
  }

  function validarPagoReserva(idReserva, datos) {
    const numero = Number(idReserva);
    if (!Number.isInteger(numero) || numero <= 0 || !fila('SELECT id_reserva FROM reservas WHERE id_reserva = ?', [numero])) {
      throw new Error('La reserva del pago ya no existe. Actualizá la lista e intentá de nuevo.');
    }

    const fecha = String((datos && datos.fecha_pago) ?? '').trim();
    const partes = fecha.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
    if (!partes) throw new Error('Elegí una fecha y hora válidas para el pago.');
    const fechaObj = new Date(Number(partes[1]), Number(partes[2]) - 1, Number(partes[3]), Number(partes[4]), Number(partes[5]));
    if (
      Number.isNaN(fechaObj.getTime()) ||
      fechaObj.getFullYear() !== Number(partes[1]) ||
      fechaObj.getMonth() !== Number(partes[2]) - 1 ||
      fechaObj.getDate() !== Number(partes[3]) ||
      fechaObj.getHours() !== Number(partes[4]) ||
      fechaObj.getMinutes() !== Number(partes[5])
    ) {
      throw new Error('La fecha y hora del pago no son válidas.');
    }

    const transferencia = redondearPrecio(datos && datos.monto_transferencia);
    if (!Number.isFinite(transferencia) || transferencia < 0) {
      throw new Error('El monto entregado en transferencia no es válido.');
    }
    if (transferencia > PRECIO_MAXIMO) throw new Error('El monto en transferencia supera el máximo permitido.');

    const efectivo = redondearPrecio(datos && datos.monto_efectivo);
    if (!Number.isFinite(efectivo) || efectivo < 0) {
      throw new Error('El monto entregado en efectivo no es válido.');
    }
    if (efectivo > PRECIO_MAXIMO) throw new Error('El monto en efectivo supera el máximo permitido.');

    const totalReserva = totalCombosDeReserva(numero);
    const totalPago = redondearPrecio(transferencia + efectivo);
    if (Math.abs(totalPago - totalReserva) > 0.009) {
      throw new Error(
        'Los montos entregados suman ' + montoTexto(totalPago) +
        ', pero el total de combos de la reserva es ' + montoTexto(totalReserva) +
        '. Ajustá los montos para que coincidan.'
      );
    }

    return {
      fecha_pago: partes[1] + '-' + partes[2] + '-' + partes[3] + 'T' + partes[4] + ':' + partes[5],
      monto_transferencia: transferencia,
      monto_efectivo: efectivo
    };
  }

  function pagoDeReserva(idReserva) {
    return fila(`
      SELECT
        p.*,
        (p.monto_transferencia + p.monto_efectivo) AS total
      FROM pagos p
      WHERE p.id_reserva = ?
    `, [Number(idReserva)]);
  }

  function guardarPagoReserva(idReserva, datos) {
    const numero = Number(idReserva);
    const limpio = validarPagoReserva(numero, datos);
    const existente = fila('SELECT id_pago FROM pagos WHERE id_reserva = ?', [numero]);

    if (existente) {
      ejecutar(
        `UPDATE pagos SET fecha_pago = ?, monto_transferencia = ?, monto_efectivo = ? WHERE id_reserva = ?`,
        [limpio.fecha_pago, limpio.monto_transferencia, limpio.monto_efectivo, numero]
      );
      return Number(existente.id_pago);
    }

    ejecutar(
      `INSERT INTO pagos (id_reserva, fecha_pago, monto_transferencia, monto_efectivo)
       VALUES (?, ?, ?, ?)`,
      [numero, limpio.fecha_pago, limpio.monto_transferencia, limpio.monto_efectivo]
    );
    return ultimoId();
  }

  function eliminarPagoReserva(idReserva) {
    const numero = Number(idReserva);
    if (!fila('SELECT id_pago FROM pagos WHERE id_reserva = ?', [numero])) {
      throw new Error('La reserva no tiene un pago registrado.');
    }
    ejecutar('DELETE FROM pagos WHERE id_reserva = ?', [numero]);
  }

  function listarPagos() {
    return filas(`
      SELECT
        p.*,
        (p.monto_transferencia + p.monto_efectivo) AS total,
        substr(p.fecha_pago, 1, 10) AS fecha_dia,
        r.fecha_reserva,
        r.tipo,
        r.personas,
        r.detalle,
        r.estado,
        r.id_cliente,
        c.nombre,
        c.apellido,
        c.documento,
        (SELECT COALESCE(SUM(rc.cantidad), 0)
           FROM reserva_combos rc WHERE rc.id_reserva = r.id_reserva) AS combos_cantidad,
        (SELECT COALESCE(SUM(rc.cantidad * rc.precio_unitario), 0)
           FROM reserva_combos rc WHERE rc.id_reserva = r.id_reserva) AS combos_total
      FROM pagos p
      JOIN reservas r ON r.id_reserva = p.id_reserva
      JOIN clientes c ON c.id_cliente = r.id_cliente
      ORDER BY date(p.fecha_pago) DESC, p.fecha_pago DESC, p.id_pago DESC
    `);
  }

  function estadisticasPagos() {
    const resultado = fila(`
      SELECT
        COUNT(*) AS reservas,
        COALESCE(SUM(monto_transferencia), 0) AS transferencia,
        COALESCE(SUM(monto_efectivo), 0) AS efectivo,
        COALESCE(SUM(monto_transferencia + monto_efectivo), 0) AS total
      FROM pagos
    `) || {};
    return {
      reservas: Number(resultado.reservas || 0),
      transferencia: Number(resultado.transferencia || 0),
      efectivo: Number(resultado.efectivo || 0),
      total: Number(resultado.total || 0)
    };
  }

  /* ---------- datos de ejemplo ---------- */

  function fechaLocalISO(fecha) {
    const p = function (n) { return String(n).padStart(2, '0'); };
    return fecha.getFullYear() + '-' + p(fecha.getMonth() + 1) + '-' + p(fecha.getDate()) +
      'T' + p(fecha.getHours()) + ':' + p(fecha.getMinutes());
  }

  function cargarEjemplo() {
    if (estadisticas().clientes > 0) throw new Error('Ya hay clientes registrados, así que no se cargaron los datos de ejemplo.');

    const hoy = new Date();
    const proxima = function (dias, hora, minutos) {
      const fecha = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate(), hora, minutos || 0, 0, 0);
      fecha.setDate(fecha.getDate() + dias);
      return fechaLocalISO(fecha);
    };

    const clientes = [
      ['Lucía', 'Fernández', '+54 9 11 5632-8841', '30111222'],
      ['Martín', 'Gómez', '+54 9 11 4478-1290', '32444555'],
      ['Sofía', 'Martínez', '+54 9 11 6120-7734', '35667788'],
      ['Julián', 'Pereyra', '+54 9 11 3988-5512', '28990123'],
      ['Valentina', 'Ríos', '+54 9 11 5544-9021', '37123456']
    ];

    const combos = [
      ['Combo Andino', 'Milanesa de ternera, papas rústicas y gaseosa', 9800],
      ['Combo del Huerto', 'Lasagna de verduras, ensalada y agua saborizada', 8600],
      ['Combo Parrilla', 'Asado, chorizo, provoleta y gaseosa', 12500],
      ['Combo Infantil', 'Milanesa con papas fritas, jugo y postre', 6200],
      ['Combo Café', 'Café doble, medialunas y jugo de naranja', 4200]
    ];

    const reservas = [
      [0, proxima(0, 21, 0), 'mesa', 4, 'Mesa 7', 'confirmada', 'Cumpleaños: preparar una vela.', [[0, 4]]],
      [1, proxima(1, 20, 30), 'mesa', 2, 'Mesa 3', 'pendiente', '', [[1, 2]]],
      [2, proxima(2, 19, 0), 'evento', 30, 'Aniversario de la empresa Andina', 'confirmada', 'Proyector y micrófono.', [[2, 30]]],
      [0, proxima(5, 13, 0), 'mesa', 6, 'Mesa 12', 'pendiente', 'Dos vegetarianos.', [[1, 4], [3, 2]]],
      [3, proxima(8, 21, 30), 'evento', 18, 'Despedida de soltero', 'pendiente', '', [[2, 18]]],
      [4, proxima(-3, 20, 0), 'mesa', 2, 'Mesa 5', 'confirmada', '', [[4, 2]]]
    ];

    db.run('BEGIN');
    try {
      const idsClientes = [];
      for (let i = 0; i < clientes.length; i++) {
        db.run(
          'INSERT INTO clientes (nombre, apellido, telefono, documento) VALUES (?, ?, ?, ?)',
          clientes[i]
        );
        idsClientes.push(ultimoId());
      }

      const idsCombos = [];
      if (estadisticas().combos === 0) {
        for (let i = 0; i < combos.length; i++) {
          db.run('INSERT INTO combos (nombre, contenido, precio) VALUES (?, ?, ?)', combos[i]);
          idsCombos.push(ultimoId());
        }
      } else {
        filas('SELECT id_combo FROM combos ORDER BY id_combo').forEach(function (combo) {
          idsCombos.push(Number(combo.id_combo));
        });
      }

      for (let j = 0; j < reservas.length; j++) {
        const reserva = reservas[j];
        db.run(
          `INSERT INTO reservas (id_cliente, fecha_reserva, tipo, personas, detalle, estado, notas, creada_en)
           VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now','localtime'))`,
          [idsClientes[reserva[0]], reserva[1], reserva[2], reserva[3], reserva[4], reserva[5], reserva[6]]
        );
        const idReserva = ultimoId();
        const asignados = reserva[7] || [];
        for (let k = 0; k < asignados.length; k++) {
          const idCombo = idsCombos[asignados[k][0]];
          if (!idCombo) continue;
          const detalleCombo = fila('SELECT precio FROM combos WHERE id_combo = ?', [idCombo]);
          db.run(
            'INSERT INTO reserva_combos (id_reserva, id_combo, cantidad, precio_unitario) VALUES (?, ?, ?, ?)',
            [idReserva, idCombo, asignados[k][1], detalleCombo ? Number(detalleCombo.precio) : 0]
          );
        }
      }
      db.run('COMMIT');
    } catch (error) {
      db.run('ROLLBACK');
      throw error;
    }
    programarGuardado();
  }

  /* ---------- importar / exportar ---------- */

  function exportar() {
    if (!db) throw new Error('La base de datos todavía no está lista.');
    return exportarBytes();
  }

  function validarEstructura(instancia) {
    const columnasDe = function (tabla) {
      const resultado = instancia.exec("PRAGMA table_info('" + tabla + "')");
      if (!resultado.length) return [];
      return resultado[0].values.map(function (fila) { return fila[1]; });
    };
    const clientes = columnasDe('clientes');
    const reservas = columnasDe('reservas');
    const faltanClientes = ['id_cliente', 'nombre', 'apellido', 'telefono', 'documento'].filter(function (c) {
      return clientes.indexOf(c) === -1;
    });
    const faltanReservas = ['id_reserva', 'id_cliente', 'creada_en', 'fecha_reserva', 'tipo', 'personas', 'detalle', 'estado', 'notas'].filter(function (c) {
      return reservas.indexOf(c) === -1;
    });
    if (faltanClientes.length || faltanReservas.length) {
      throw new Error('La base de datos no tiene la estructura esperada (faltan las tablas o columnas de clientes y reservas).');
    }
  }

  async function importar(bytes) {
    if (!bytes || bytes.length < 100) throw new Error('El archivo está vacío o no es una base de datos de SQLite.');
    const cabecera = String.fromCharCode.apply(null, bytes.subarray(0, 15));
    if (cabecera !== 'SQLite format 3') {
      throw new Error('El archivo no parece ser una base de datos SQLite válida.');
    }

    let instancia;
    try {
      instancia = new SQL.Database(bytes);
    } catch (error) {
      throw new Error('No se pudo leer el archivo como una base de datos SQLite.');
    }

    try {
      validarEstructura(instancia);
      instancia.run('PRAGMA foreign_keys = ON;');
      instancia.exec(ESQUEMA);
    } catch (error) {
      instancia.close();
      throw error;
    }

    if (db) db.close();
    db = instancia;
    advertenciaInicio = null;
    conflicto = false;
    programarGuardado();
    await guardarAhora(MOTIVO_IMPORTAR);
  }

  /* ---------- inicialización ---------- */

  async function init() {
    if (inicializada) return;

    if (typeof window.initSqlJs !== 'function') {
      throw new Error('No se pudo cargar el motor de SQLite. Verificá que la carpeta "vendor" esté completa.');
    }
    if (!window.__SQLITE_WASM_BASE64) {
      throw new Error('No se encontró el archivo de SQLite. Verificá que exista "vendor/sqlite-wasm-base64.js".');
    }

    SQL = await window.initSqlJs({ wasmBinary: base64ABytes(window.__SQLITE_WASM_BASE64) });

    await elegirAlmacen();
    const guardado = await leerGuardado();

    if (guardado && guardado.length) {
      try {
        const instancia = new SQL.Database(guardado);
        instancia.run('PRAGMA foreign_keys = ON;');
        instancia.exec(ESQUEMA);
        db = instancia;
      } catch (error) {
        console.error('La base guardada no se pudo abrir:', error);
        advertenciaInicio = 'La copia guardada en este navegador estaba dañada y se creó una base nueva. Si tenías un archivo exportado, podés importarlo.';
        db = new SQL.Database();
        db.run('PRAGMA foreign_keys = ON;');
        aplicarEsquema();
        await guardarAhora();
      }
    } else {
      db = new SQL.Database();
      db.run('PRAGMA foreign_keys = ON;');
      aplicarEsquema();
      await guardarAhora();
    }

    if (necesitaVolcado) {
      necesitaVolcado = false;
      await guardarAhora();
    }

    inicializada = true;
  }

  function estadoAlmacen() {
    return almacen;
  }

  function hayConflicto() {
    return conflicto;
  }

  function rutaDatos() {
    return rutaArchivo;
  }

  /* ---------- API pública ---------- */

  window.DB = {
    init: init,
    estadoAlmacen: estadoAlmacen,
    hayConflicto: hayConflicto,
    rutaDatos: rutaDatos,
    advertenciaInicio: function () { return advertenciaInicio; },

    guardarAhora: guardarAhora,

    listarClientes: listarClientes,
    obtenerCliente: obtenerCliente,
    crearCliente: crearCliente,
    actualizarCliente: actualizarCliente,
    eliminarCliente: eliminarCliente,
    contarReservasDeCliente: contarReservasDeCliente,

    listarReservas: listarReservas,
    contarReservas: contarReservas,
    crearReserva: crearReserva,
    actualizarReserva: actualizarReserva,
    eliminarReserva: eliminarReserva,
    combosDeReserva: combosDeReserva,

    totalCombosDeReserva: totalCombosDeReserva,
    pagoDeReserva: pagoDeReserva,
    guardarPagoReserva: guardarPagoReserva,
    eliminarPagoReserva: eliminarPagoReserva,
    listarPagos: listarPagos,
    estadisticasPagos: estadisticasPagos,

    listarCombos: listarCombos,
    obtenerCombo: obtenerCombo,
    crearCombo: crearCombo,
    actualizarCombo: actualizarCombo,
    eliminarCombo: eliminarCombo,
    contarReservasConCombo: contarReservasConCombo,

    estadisticas: estadisticas,
    cargarEjemplo: cargarEjemplo,

    exportar: exportar,
    importar: importar
  };
})();
