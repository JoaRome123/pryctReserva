/* ============================================================
   Mesa & Evento — exportación a Excel (.xlsx)

   Genera planillas reales con ExcelJS (vendor/exceljs.min.js).
   Se usa igual en la app de escritorio (descarga del navegador)
   y en el APK de Android (guardar o compartir con el sistema).

   Recibe los datos ya preparados por js/app.js y devuelve los
   bytes del archivo para que la interfaz decida cómo guardarlos.
   ============================================================ */

(function () {
  'use strict';

  const VERDE = 'FF1F4030';
  const VERDE_OSCURO = 'FF163023';
  const VERDE_CLARO = 'FFEEF4EE';
  const CREMA = 'FFFAF6EE';
  const TINTA = 'FF2E332D';
  const TINTA_SUAVE = 'FF687368';
  const BORDE = 'FFD9DFD6';
  const BLANCO = 'FFFFFFFF';

  const FUENTE = 'Calibri';
  const FUENTE_TITULO = 'Georgia';
  const FORMATO_DINERO = '"$" #,##0.00';
  const FORMATO_ENTERO = '#,##0';
  const FORMATO_FECHA_HORA = 'dd/mm/yyyy hh:mm';
  const FORMATO_FECHA = 'dd/mm/yyyy';

  function motor() {
    if (!window.ExcelJS) {
      throw new Error('No se pudo cargar el generador de Excel (vendor/exceljs.min.js).');
    }
    return window.ExcelJS;
  }

  /* ExcelJS convierte el instante UTC de un Date a número de serie de Excel.
     Para que la planilla muestre la misma hora local que la app, armamos un
     Date cuyos componentes UTC sean los de la fecha local (hora de pared). */
  function fechaDesdeTexto(valor) {
    if (valor instanceof Date && !isNaN(valor.getTime())) {
      return new Date(Date.UTC(
        valor.getFullYear(),
        valor.getMonth(),
        valor.getDate(),
        valor.getHours(),
        valor.getMinutes(),
        valor.getSeconds()
      ));
    }
    const texto = String(valor == null ? '' : valor).trim();
    if (!texto) return null;
    const partes = texto.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/);
    if (!partes) return null;
    const fecha = new Date(Date.UTC(
      Number(partes[1]),
      Number(partes[2]) - 1,
      Number(partes[3]),
      Number(partes[4] || 0),
      Number(partes[5] || 0),
      Number(partes[6] || 0)
    ));
    return isNaN(fecha.getTime()) ? null : fecha;
  }

  function altoEstimado(columnas, valores) {
    let lineas = 1;
    columnas.forEach(function (columna, indice) {
      if (columna.tipo !== 'texto' || columna.envolver === false) return;
      const texto = valores[indice] == null ? '' : String(valores[indice]);
      const porLinea = Math.max(8, Math.round((columna.ancho || 16) * 1.05));
      lineas = Math.max(lineas, Math.ceil(texto.length / porLinea));
    });
    return Math.min(78, Math.max(20, lineas * 13 + 7));
  }

  function crearLibro(nombreHoja, titulo, subtitulo, generado, cantidadColumnas) {
    const ExcelJS = motor();
    const columnasTitulo = Math.max(1, Number(cantidadColumnas) || 1);
    const libro = new ExcelJS.Workbook();
    libro.creator = 'Mesa & Evento';
    libro.lastModifiedBy = 'Mesa & Evento';
    libro.created = new Date();
    libro.modified = new Date();
    libro.title = titulo + ' — Mesa & Evento';
    libro.description = 'Planilla generada por Mesa & Evento.';

    const hoja = libro.addWorksheet(nombreHoja, {
      properties: { defaultRowHeight: 18 },
      views: [{ state: 'frozen', ySplit: 3 }],
      pageSetup: {
        orientation: 'landscape',
        paperSize: 9,
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
        horizontalCentered: true,
        printTitlesRow: '3:3',
        margins: { left: 0.35, right: 0.35, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 }
      }
    });

    const marca = generado ? ' · Generado el ' + generado : '';
    hoja.mergeCells(1, 1, 1, columnasTitulo);
    const celdaTitulo = hoja.getCell(1, 1);
    celdaTitulo.value = titulo;
    celdaTitulo.font = { name: FUENTE_TITULO, size: 18, bold: true, color: { argb: VERDE } };
    celdaTitulo.alignment = { vertical: 'middle', horizontal: 'left' };
    hoja.getRow(1).height = 32;

    hoja.mergeCells(2, 1, 2, columnasTitulo);
    const celdaSubtitulo = hoja.getCell(2, 1);
    celdaSubtitulo.value = subtitulo + marca;
    celdaSubtitulo.font = { name: FUENTE, size: 10, italic: true, color: { argb: TINTA_SUAVE } };
    celdaSubtitulo.alignment = { vertical: 'middle', horizontal: 'left' };
    hoja.getRow(2).height = 20;

    return { libro: libro, hoja: hoja };
  }

  function escribirEncabezados(hoja, columnas) {
    const fila = hoja.getRow(3);
    fila.height = 27;
    columnas.forEach(function (columna, indice) {
      const celda = fila.getCell(indice + 1);
      celda.value = columna.titulo;
      celda.font = { name: FUENTE, size: 10, bold: true, color: { argb: BLANCO } };
      celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: VERDE } };
      celda.alignment = {
        vertical: 'middle',
        horizontal: columna.tipo === 'texto' ? 'left' : columna.tipo === 'fecha' ? 'center' : 'right',
        wrapText: true
      };
      celda.border = { bottom: { style: 'thin', color: { argb: VERDE_OSCURO } } };
    });
  }

  function escribirFila(hoja, numero, columnas, valores, opciones) {
    const op = opciones || {};
    const fila = hoja.getRow(numero);
    fila.height = op.alto || altoEstimado(columnas, valores);

    columnas.forEach(function (columna, indice) {
      const celda = fila.getCell(indice + 1);
      const valor = valores[indice];

      if (columna.tipo === 'dinero' || columna.tipo === 'entero') {
        const numeroValor = Number(valor);
        celda.value = Number.isFinite(numeroValor) ? numeroValor : 0;
        celda.numFmt = columna.tipo === 'dinero' ? FORMATO_DINERO : FORMATO_ENTERO;
      } else if (columna.tipo === 'fecha') {
        const fecha = fechaDesdeTexto(valor);
        celda.value = fecha || '—';
        if (fecha) celda.numFmt = columna.soloFecha ? FORMATO_FECHA : FORMATO_FECHA_HORA;
      } else {
        celda.value = valor == null || valor === '' ? '—' : String(valor);
      }

      celda.font = {
        name: FUENTE,
        size: 10.5,
        color: { argb: op.color || TINTA },
        bold: Boolean(op.negrita || columna.fuerte)
      };
      celda.alignment = {
        vertical: 'middle',
        horizontal: columna.tipo === 'texto' ? 'left' : columna.tipo === 'fecha' ? 'center' : 'right',
        wrapText: columna.tipo === 'texto' && columna.envolver !== false
      };
      celda.border = {
        bottom: op.bordeInferior || { style: 'hair', color: { argb: BORDE } }
      };
      if (op.fondo) {
        celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: op.fondo } };
      }
    });

    return fila;
  }

  function escribirFilaTotal(hoja, numero, columnas, etiqueta, valores, opciones) {
    const op = opciones || {};
    const fila = hoja.getRow(numero);
    fila.height = op.alto || 24;

    columnas.forEach(function (columna, indice) {
      const celda = fila.getCell(indice + 1);
      celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: op.fondo || VERDE_CLARO } };
      celda.font = { name: FUENTE, size: 10.5, bold: true, color: { argb: op.color || TINTA } };
      celda.alignment = {
        vertical: 'middle',
        horizontal: columna.tipo === 'texto' ? 'left' : 'right'
      };
      celda.border = {
        top: { style: 'medium', color: { argb: op.borde || BORDE } },
        bottom: { style: 'thin', color: { argb: op.borde || BORDE } }
      };
    });

    if (op.unirHasta && op.unirHasta > 1) {
      hoja.mergeCells(numero, 1, numero, op.unirHasta);
    }
    const primera = hoja.getCell(numero, 1);
    primera.value = etiqueta;
    primera.font = { name: FUENTE, size: 10.5, bold: true, color: { argb: op.color || TINTA } };
    primera.alignment = { vertical: 'middle', horizontal: 'left' };

    const desde = op.unirHasta && op.unirHasta > 1 ? op.unirHasta : 0;
    (valores || []).forEach(function (valor, indice) {
      const columna = columnas[desde + indice];
      if (!columna) return;
      const celda = hoja.getCell(numero, desde + indice + 1);
      if (columna.tipo === 'dinero' || columna.tipo === 'entero') {
        const numeroValor = Number(valor);
        celda.value = Number.isFinite(numeroValor) ? numeroValor : 0;
        celda.numFmt = columna.tipo === 'dinero' ? FORMATO_DINERO : FORMATO_ENTERO;
      } else {
        celda.value = valor;
      }
    });

    return fila;
  }

  async function bytesDelLibro(libro) {
    const buffer = await libro.xlsx.writeBuffer();
    return buffer instanceof Uint8Array ? new Uint8Array(buffer) : new Uint8Array(buffer);
  }

  /* ---------- Reservas ---------- */

  async function reservas(datos) {
    const info = datos || {};
    const filas = info.filas || [];
    const columnas = [
      { titulo: 'Cliente', ancho: 34, tipo: 'texto' },
      { titulo: 'Reservado para', ancho: 19, tipo: 'fecha', soloFecha: true },
      { titulo: 'Tipo', ancho: 10, tipo: 'texto' },
      { titulo: 'Personas', ancho: 10, tipo: 'entero' },
      { titulo: 'Combos', ancho: 9, tipo: 'entero' },
      { titulo: 'Total combos', ancho: 15, tipo: 'dinero' },
      { titulo: 'Mesa / evento', ancho: 22, tipo: 'texto' },
      { titulo: 'Notas', ancho: 32, tipo: 'texto' },
      { titulo: 'Estado', ancho: 12, tipo: 'texto' },
      { titulo: 'Pago', ancho: 38, tipo: 'texto' }
    ];

    const creado = crearLibro('Reservas', 'Reservas', info.resumen || 'Todas las reservas', info.generado, columnas.length);
    const hoja = creado.hoja;
    hoja.columns = columnas.map(function (columna) { return { width: columna.ancho }; });

    escribirEncabezados(hoja, columnas);

    const totales = { personas: 0, combos: 0, combosTotal: 0 };
    let numero = 4;

    filas.forEach(function (reserva, indice) {
      escribirFila(hoja, numero, columnas, [
        reserva.cliente,
        reserva.fecha,
        reserva.tipo,
        reserva.personas,
        reserva.combos,
        reserva.combosTotal,
        reserva.detalle,
        reserva.notas,
        reserva.estado,
        reserva.pago
      ], {
        fondo: indice % 2 === 1 ? 'FFF7FAF6' : null
      });

      totales.personas += Number(reserva.personas || 0);
      totales.combos += Number(reserva.combos || 0);
      totales.combosTotal += Number(reserva.combosTotal || 0);
      numero += 1;
    });

    escribirFilaTotal(
      hoja,
      numero,
      columnas,
      'Total · ' + filas.length + (filas.length === 1 ? ' reserva' : ' reservas'),
      [totales.personas, totales.combos, totales.combosTotal, '', '', '', ''],
      { unirHasta: 3, fondo: VERDE_CLARO }
    );

    if (filas.length) {
      hoja.autoFilter = {
        from: { row: 3, column: 1 },
        to: { row: 3 + filas.length, column: columnas.length }
      };
    }

    return bytesDelLibro(creado.libro);
  }

  /* ---------- Pagos ---------- */

  async function pagos(datos) {
    const info = datos || {};
    const grupos = info.grupos || [];
    const totales = info.totales || { cantidad: 0, transferencia: 0, efectivo: 0, total: 0 };
    const columnas = [
      { titulo: 'Fecha del pago', ancho: 19, tipo: 'fecha' },
      { titulo: 'Cliente', ancho: 30, tipo: 'texto' },
      { titulo: 'Reserva', ancho: 19, tipo: 'fecha', soloFecha: true },
      { titulo: 'Tipo', ancho: 10, tipo: 'texto' },
      { titulo: 'Personas', ancho: 10, tipo: 'entero' },
      { titulo: 'Combos', ancho: 38, tipo: 'texto' },
      { titulo: 'Transferencia', ancho: 16, tipo: 'dinero' },
      { titulo: 'Efectivo', ancho: 14, tipo: 'dinero' },
      { titulo: 'Total', ancho: 15, tipo: 'dinero' }
    ];

    const creado = crearLibro('Pagos', 'Pagos', info.resumen || 'Todos los pagos registrados', info.generado, columnas.length);
    const hoja = creado.hoja;
    hoja.columns = columnas.map(function (columna) { return { width: columna.ancho }; });

    escribirEncabezados(hoja, columnas);

    let numero = 4;
    let totalCantidad = 0;
    let totalTransferencia = 0;
    let totalEfectivo = 0;
    let totalGeneral = 0;

    grupos.forEach(function (grupo) {
      hoja.mergeCells(numero, 1, numero, columnas.length);
      const titulo = hoja.getCell(numero, 1);
      const cantidad = (grupo.pagos || []).length;
      titulo.value = (grupo.titulo || grupo.dia || '') + ' · ' + cantidad +
        (cantidad === 1 ? ' reserva pagada' : ' reservas pagadas');
      titulo.font = { name: FUENTE, size: 11, bold: true, color: { argb: VERDE_OSCURO } };
      titulo.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: VERDE_CLARO } };
      titulo.alignment = { vertical: 'middle', horizontal: 'left' };
      hoja.getRow(numero).height = 23;
      numero += 1;

      (grupo.pagos || []).forEach(function (pago, indice) {
        escribirFila(hoja, numero, columnas, [
          pago.fecha,
          pago.cliente,
          pago.reserva,
          pago.tipo,
          pago.personas,
          pago.combos,
          pago.transferencia,
          pago.efectivo,
          pago.total
        ], {
          fondo: indice % 2 === 1 ? 'FFF7FAF6' : null
        });
        numero += 1;
      });

      escribirFilaTotal(hoja, numero, columnas, 'Total del día', [
        grupo.transferencia,
        grupo.efectivo,
        grupo.total
      ], { unirHasta: 6, fondo: CREMA, borde: 'FFCFC3AD' });
      numero += 1;

      // Espacio en blanco entre un día y el siguiente.
      hoja.getRow(numero).height = 8;
      numero += 1;

      totalCantidad += cantidad;
      totalTransferencia += Number(grupo.transferencia || 0);
      totalEfectivo += Number(grupo.efectivo || 0);
      totalGeneral += Number(grupo.total || 0);
    });

    if (grupos.length) {
      escribirFilaTotal(hoja, numero, columnas,
        'Total general · ' + (Number(totales.cantidad) || totalCantidad) + ' reservas pagadas',
        [
          Number(totales.transferencia) || totalTransferencia,
          Number(totales.efectivo) || totalEfectivo,
          Number(totales.total) || totalGeneral
        ],
        { unirHasta: 6, fondo: VERDE, color: BLANCO, borde: VERDE_OSCURO, alto: 27 }
      );
    }

    return bytesDelLibro(creado.libro);
  }

  window.EXPORTAR = {
    disponible: function () { return Boolean(window.ExcelJS); },
    reservas: reservas,
    pagos: pagos
  };
})();
