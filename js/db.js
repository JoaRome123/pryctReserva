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
            const bytes = db.export();
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
            await pasarAAlmacenNavegador(db.export());
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
        c.documento
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
        (SELECT COUNT(*) FROM reservas) AS reservas
    `) || {};
    return {
      proximas: Number(resultado.proximas || 0),
      comensales: Number(resultado.comensales || 0),
      eventos: Number(resultado.eventos || 0),
      clientes: Number(resultado.clientes || 0),
      reservas: Number(resultado.reservas || 0)
    };
  }

  function crearReserva(datos) {
    const limpio = validarReserva(datos);
    ejecutar(
      `INSERT INTO reservas (id_cliente, fecha_reserva, tipo, personas, detalle, estado, notas, creada_en)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now','localtime'))`,
      [limpio.id_cliente, limpio.fecha_reserva, limpio.tipo, limpio.personas, limpio.detalle, limpio.estado, limpio.notas]
    );
    return ultimoId();
  }

  function actualizarReserva(id, datos) {
    const numero = Number(id);
    if (!fila('SELECT id_reserva FROM reservas WHERE id_reserva = ?', [numero])) {
      throw new Error('La reserva ya no existe.');
    }
    const limpio = validarReserva(datos);
    ejecutar(
      `UPDATE reservas SET id_cliente = ?, fecha_reserva = ?, tipo = ?, personas = ?, detalle = ?, estado = ?, notas = ?
       WHERE id_reserva = ?`,
      [limpio.id_cliente, limpio.fecha_reserva, limpio.tipo, limpio.personas, limpio.detalle, limpio.estado, limpio.notas, numero]
    );
    return numero;
  }

  function eliminarReserva(id) {
    ejecutar('DELETE FROM reservas WHERE id_reserva = ?', [Number(id)]);
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

    db.run('BEGIN TRANSACTION');
    try {
      for (let i = 0; i < clientes.length; i++) {
        db.run(
          'INSERT INTO clientes (nombre, apellido, telefono, documento) VALUES (?, ?, ?, ?)',
          clientes[i]
        );
      }

      const reservas = [
        [1, proxima(0, 21, 0), 'mesa', 4, 'Mesa 7', 'confirmada', 'Cumpleaños: preparar una vela.'],
        [2, proxima(1, 20, 30), 'mesa', 2, 'Mesa 3', 'pendiente', ''],
        [3, proxima(2, 19, 0), 'evento', 30, 'Aniversario de la empresa Andina', 'confirmada', 'Proyector y micrófono.'],
        [1, proxima(5, 13, 0), 'mesa', 6, 'Mesa 12', 'pendiente', 'Dos vegetarianos.'],
        [4, proxima(8, 21, 30), 'evento', 18, 'Despedida de soltero', 'pendiente', ''],
        [5, proxima(-3, 20, 0), 'mesa', 2, 'Mesa 5', 'confirmada', '']
      ];
      for (let j = 0; j < reservas.length; j++) {
        db.run(
          `INSERT INTO reservas (id_cliente, fecha_reserva, tipo, personas, detalle, estado, notas, creada_en)
           VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now','localtime'))`,
          reservas[j]
        );
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
    return db.export();
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

    estadisticas: estadisticas,
    cargarEjemplo: cargarEjemplo,

    exportar: exportar,
    importar: importar
  };
})();
