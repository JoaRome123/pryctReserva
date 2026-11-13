/* ============================================================
   Mesa & Evento — interfaz
   ============================================================ */

(function () {
  'use strict';

  const $ = function (selector, raiz) { return (raiz || document).querySelector(selector); };
  const $$ = function (selector, raiz) { return Array.prototype.slice.call((raiz || document).querySelectorAll(selector)); };

  const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

  const estado = {
    vista: 'reservas',
    busquedaReservas: '',
    tipo: '',
    estadoReserva: '',
    fecha: '',
    idCliente: null,
    nombreClienteFiltro: '',
    busquedaClientes: '',
    busquedaCombos: '',
    editandoCliente: null,
    editandoReserva: null,
    editandoCombo: null,
    clienteDesdeReserva: false,
    comboDesdeReserva: false,
    combosReserva: [],
    reservaPago: null,
    pagoEditando: null,
    totalPago: 0,
    ultimoAlmacen: null
  };

  let reservasActuales = [];
  let clientesActuales = [];
  let combosActuales = [];
  let pagosActuales = [];
  let accionConfirmar = null;
  let temporizadorBusqueda = null;
  let temporizadorCombos = null;

  /* ---------- inicio ---------- */

  document.addEventListener('DOMContentLoaded', iniciar);

  async function iniciar() {
    conectarEventos();

    if (!window.DB) {
      mostrarErrorFatal(new Error('No se pudo cargar el módulo de datos (js/db.js).'));
      return;
    }

    try {
      await DB.init();
      const aviso = DB.advertenciaInicio();
      if (aviso) mostrarToast(aviso, 'error', 9000);
      actualizarEstadoAlmacen();
      refrescarTodo();
    } catch (error) {
      console.error(error);
      mostrarErrorFatal(error);
    }
  }

  function mostrarErrorFatal(error) {
    const contenido = $('.contenido');
    contenido.replaceChildren();
    const caja = crear('div', 'panel');
    caja.style.padding = '40px 28px';
    caja.style.textAlign = 'center';

    const circulo = crear('div', 'vacio-icono');
    circulo.style.margin = '0 auto 18px';
    circulo.appendChild(icono('alerta'));

    caja.appendChild(circulo);
    const titulo = crear('h2', '', 'No se pudo iniciar la aplicación');
    titulo.style.fontFamily = 'var(--serif)';
    titulo.style.fontSize = '24px';
    caja.appendChild(titulo);
    const texto = crear('p', '', error && error.message ? error.message : 'Ocurrió un error inesperado.');
    texto.style.margin = '8px auto 0';
    texto.style.maxWidth = '560px';
    texto.style.color = 'var(--tinta-suave)';
    caja.appendChild(texto);
    const ayuda = crear('p', '', 'Si abriste index.html directamente, probá iniciar la app con iniciar.bat. Si el problema continúa, verificá que las carpetas js y vendor estén completas.');
    ayuda.style.margin = '10px auto 0';
    ayuda.style.maxWidth = '560px';
    ayuda.style.fontSize = '13px';
    ayuda.style.color = 'var(--tinta-tenue)';
    caja.appendChild(ayuda);

    contenido.appendChild(caja);
  }

  /* ---------- eventos ---------- */

  function conectarEventos() {
    $$('.pestana').forEach(function (boton) {
      boton.addEventListener('click', function () { cambiarVista(boton.dataset.vista); });
    });

    $('#btn-nueva-reserva').addEventListener('click', function () { abrirReserva(null); });
    $('#btn-vacio-nueva').addEventListener('click', function () { abrirReserva(null); });
    $('#btn-nuevo-cliente').addEventListener('click', function () { abrirCliente(null); });
    $('#btn-vacio-nuevo-cliente').addEventListener('click', function () { abrirCliente(null); });
    $('#btn-cargar-ejemplo').addEventListener('click', pedirCargarEjemplo);

    $('#btn-nuevo-combo').addEventListener('click', function () { abrirCombo(null); });
    $('#btn-vacio-nuevo-combo').addEventListener('click', function () { abrirCombo(null); });
    $('#btn-vacio-limpiar-combos').addEventListener('click', function () {
      estado.busquedaCombos = '';
      $('#buscar-combos').value = '';
      renderCombos();
      $('#buscar-combos').focus();
    });

    $('#btn-combo-desde-reserva').addEventListener('click', function () {
      estado.comboDesdeReserva = true;
      abrirCombo(null);
    });

    $('#btn-agregar-combo').addEventListener('click', agregarComboAReserva);
    $('#re-combo-cantidad').addEventListener('keydown', function (evento) {
      if (evento.key === 'Enter') {
        evento.preventDefault();
        agregarComboAReserva();
      }
    });
    $('#lista-combos-reserva').addEventListener('click', accionLineaCombo);
    $('#lista-combos-reserva').addEventListener('input', accionLineaCombo);
    $('#re-personas').addEventListener('input', actualizarSugerenciaCombos);

    $('#buscar-combos').addEventListener('input', function (evento) {
      estado.busquedaCombos = evento.target.value;
      clearTimeout(temporizadorCombos);
      temporizadorCombos = setTimeout(renderCombos, 160);
    });

    $('#form-combo').addEventListener('submit', guardarCombo);
    $('#cuerpo-combos').addEventListener('click', accionCombo);

    $('#btn-pagos-ir-reservas').addEventListener('click', function () { cambiarVista('reservas'); });
    $('#btn-vacio-ir-reservas').addEventListener('click', function () { cambiarVista('reservas'); });
    $('#form-pago').addEventListener('submit', guardarPago);
    $('#lista-pagos').addEventListener('click', accionPago);
    $('#btn-quitar-pago').addEventListener('click', pedirQuitarPagoDesdeDialogo);
    $$('input[name="pa-forma"]').forEach(function (radio) {
      radio.addEventListener('change', aplicarFormaPago);
    });
    $('#pa-transferencia').addEventListener('input', actualizarTotalesPago);
    $('#pa-efectivo').addEventListener('input', actualizarTotalesPago);

    $('#btn-cliente-desde-reserva').addEventListener('click', function () {
      estado.clienteDesdeReserva = true;
      abrirCliente(null);
    });

    $('#buscar-reservas').addEventListener('input', function (evento) {
      estado.busquedaReservas = evento.target.value;
      clearTimeout(temporizadorBusqueda);
      temporizadorBusqueda = setTimeout(renderReservas, 160);
    });

    $('#filtro-tipo').addEventListener('change', function (evento) {
      estado.tipo = evento.target.value;
      renderReservas();
    });
    $('#filtro-estado').addEventListener('change', function (evento) {
      estado.estadoReserva = evento.target.value;
      renderReservas();
    });
    $('#filtro-fecha').addEventListener('change', function (evento) {
      estado.fecha = evento.target.value;
      renderReservas();
    });

    $('#limpiar-filtros').addEventListener('click', limpiarFiltrosReservas);
    $('#btn-vacio-limpiar').addEventListener('click', limpiarFiltrosReservas);
    $('#quitar-chip-cliente').addEventListener('click', limpiarFiltrosReservas);

    $('#buscar-clientes').addEventListener('input', function (evento) {
      estado.busquedaClientes = evento.target.value;
      clearTimeout(temporizadorBusqueda);
      temporizadorBusqueda = setTimeout(renderClientes, 160);
    });
    $('#btn-vacio-limpiar-clientes').addEventListener('click', function () {
      estado.busquedaClientes = '';
      $('#buscar-clientes').value = '';
      renderClientes();
      $('#buscar-clientes').focus();
    });

    $('#form-cliente').addEventListener('submit', guardarCliente);
    $('#form-reserva').addEventListener('submit', guardarReserva);

    $$('input[name="re-tipo"]').forEach(function (radio) {
      radio.addEventListener('change', actualizarDetalleTipo);
    });

    $('#cuerpo-reservas').addEventListener('click', accionReserva);
    $('#cuerpo-clientes').addEventListener('click', accionCliente);

    $$('[data-cerrar]').forEach(function (boton) {
      boton.addEventListener('click', function () {
        const dialogo = boton.closest('dialog');
        if (dialogo) dialogo.close();
      });
    });

    $('#confirmar-cancelar').addEventListener('click', function () {
      accionConfirmar = null;
      $('#dlg-confirmar').close();
    });
    $('#confirmar-aceptar').addEventListener('click', function () {
      const accion = accionConfirmar;
      accionConfirmar = null;
      $('#dlg-confirmar').close();
      if (!accion) return;
      Promise.resolve()
        .then(accion)
        .catch(function (error) {
          mostrarToast(error && error.message ? error.message : 'No se pudo completar la acción.', 'error', 6000);
        });
    });

    $('#dlg-cliente').addEventListener('close', function () {
      estado.clienteDesdeReserva = false;
      estado.editandoCliente = null;
    });
    $('#dlg-reserva').addEventListener('close', function () {
      estado.editandoReserva = null;
      estado.combosReserva = [];
    });
    $('#dlg-combo').addEventListener('close', function () {
      estado.comboDesdeReserva = false;
      estado.editandoCombo = null;
    });
    $('#dlg-pago').addEventListener('close', function () {
      estado.reservaPago = null;
      estado.pagoEditando = null;
      estado.totalPago = 0;
    });

    $$('dialog.dialogo').forEach(function (dialogo) {
      dialogo.addEventListener('click', function (evento) {
        if (evento.target === dialogo) dialogo.close();
      });
    });

    $('#btn-exportar').addEventListener('click', exportarBase);
    $('#btn-importar').addEventListener('click', function () { $('#input-importar').click(); });
    $('#input-importar').addEventListener('change', importarBase);

    document.addEventListener('db:guardado', function (evento) {
      actualizarEstadoAlmacen();
      const detalle = evento.detail || {};
      if (!detalle.ok && !detalle.conflicto && detalle.almacen !== 'memoria') {
        const mensaje = detalle.servidor
          ? 'No se pudo escribir datos.sqlite. Los cambios quedaron guardados en este navegador; revisá que iniciar.bat siga abierto.'
          : 'No se pudieron guardar los datos en este navegador. Usá “Exportar” para conservar una copia.';
        mostrarToast(mensaje, 'error', 9000);
      }
      estado.ultimoAlmacen = detalle.almacen || null;
    });

    document.addEventListener('db:conflicto', manejarConflicto);

    window.addEventListener('pagehide', function () {
      if (window.DB) DB.guardarAhora();
    });
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden' && window.DB) DB.guardarAhora();
    });

    $$('#form-cliente input, #form-reserva input, #form-reserva select, #form-reserva textarea, #form-combo input, #form-combo textarea, #form-pago input').forEach(function (campo) {
      campo.addEventListener('input', function () {
        campo.classList.remove('invalido');
        campo.removeAttribute('aria-invalid');
      });
      campo.addEventListener('change', function () {
        campo.classList.remove('invalido');
        campo.removeAttribute('aria-invalid');
      });
    });
  }

  /* ---------- navegación ---------- */

  function cambiarVista(vista) {
    estado.vista = vista;
    $$('.pestana').forEach(function (boton) {
      const activa = boton.dataset.vista === vista;
      boton.classList.toggle('activa', activa);
      boton.setAttribute('aria-selected', activa ? 'true' : 'false');
    });
    $('#vista-reservas').hidden = vista !== 'reservas';
    $('#vista-pagos').hidden = vista !== 'pagos';
    $('#vista-clientes').hidden = vista !== 'clientes';
    $('#vista-combos').hidden = vista !== 'combos';
    window.scrollTo(0, 0);
  }

  /* ---------- refresco general ---------- */

  function refrescarTodo() {
    const estadisticas = DB.estadisticas();
    $('#stat-proximas').textContent = estadisticas.proximas;
    $('#stat-comensales').textContent = estadisticas.comensales;
    $('#stat-eventos').textContent = estadisticas.eventos;
    $('#stat-clientes').textContent = estadisticas.clientes;
    $('#contador-reservas').textContent = estadisticas.reservas;
    $('#contador-pagos').textContent = estadisticas.pagos;
    $('#contador-clientes').textContent = estadisticas.clientes;
    $('#contador-combos').textContent = estadisticas.combos;

    renderReservas();
    renderPagos();
    renderClientes();
    renderCombos();
    actualizarEstadoAlmacen();
  }

  function actualizarEstadoAlmacen() {
    if (!window.DB) return;
    const almacen = DB.estadoAlmacen();
    const chip = $('#estado-db');
    const texto = $('#estado-db-texto');
    const aviso = $('#aviso-almacenamiento');
    const avisoConflicto = $('#aviso-conflicto');
    const conflicto = Boolean(DB.hayConflicto && DB.hayConflicto());
    const ruta = DB.rutaDatos && DB.rutaDatos();

    if (avisoConflicto) avisoConflicto.hidden = !conflicto;

    if (conflicto) {
      chip.classList.add('advertencia');
      chip.title = 'Otra pestaña guardó cambios en la base de datos.';
      texto.textContent = 'Conflicto';
      aviso.hidden = true;
      return;
    }

    if (almacen === 'servidor') {
      chip.classList.remove('advertencia');
      chip.title = ruta
        ? 'Los datos se guardan automáticamente en ' + ruta + '.'
        : 'Los datos se guardan automáticamente en datos.sqlite.';
      texto.textContent = 'Guardado en disco';
      aviso.hidden = true;
      return;
    }

    if (almacen === 'indexeddb' || almacen === 'local') {
      chip.classList.remove('advertencia');
      chip.title = 'Los datos se guardan automáticamente en este navegador.';
      texto.textContent = 'Guardado local';
      aviso.hidden = true;
      return;
    }

    chip.classList.add('advertencia');
    chip.title = 'Este navegador no permite guardar los datos de forma automática.';
    texto.textContent = 'Solo memoria';
    aviso.hidden = false;
  }

  let avisoConflictoMostrado = false;

  function manejarConflicto() {
    actualizarEstadoAlmacen();
    if (avisoConflictoMostrado) return;
    avisoConflictoMostrado = true;
    abrirConfirmacion({
      titulo: 'La base cambió en otra pestaña',
      mensaje: 'Otra pestaña guardó cambios en datos.sqlite. Para no pisarlos, esta pestaña dejó de guardar. ' +
        'Si querés conservar lo que hiciste acá, usá “Exportar” y después recargá la página.',
      textoAceptar: 'Recargar',
      peligro: false,
      alAceptar: function () { window.location.reload(); }
    });
  }

  /* ---------- filtros ---------- */

  function hayFiltrosReservas() {
    return Boolean(
      estado.busquedaReservas || estado.tipo || estado.estadoReserva ||
      estado.fecha || estado.idCliente
    );
  }

  function limpiarFiltrosReservas() {
    estado.busquedaReservas = '';
    estado.tipo = '';
    estado.estadoReserva = '';
    estado.fecha = '';
    estado.idCliente = null;
    estado.nombreClienteFiltro = '';
    $('#buscar-reservas').value = '';
    $('#filtro-tipo').value = '';
    $('#filtro-estado').value = '';
    $('#filtro-fecha').value = '';
    renderReservas();
  }

  /* ---------- tabla de reservas ---------- */

  function renderReservas() {
    if (!window.DB) return;

    reservasActuales = DB.listarReservas({
      busqueda: estado.busquedaReservas,
      tipo: estado.tipo,
      estado: estado.estadoReserva,
      fecha: estado.fecha,
      idCliente: estado.idCliente
    });

    const cuerpo = $('#cuerpo-reservas');
    cuerpo.replaceChildren();

    const tabla = $('#tabla-reservas');
    const vacio = $('#vacio-reservas');
    const conFiltros = hayFiltrosReservas();

    if (reservasActuales.length === 0) {
      tabla.hidden = true;
      vacio.hidden = false;

      if (DB.contarReservas() === 0 && !conFiltros) {
        $('#vacio-reservas-titulo').textContent = 'Todavía no hay reservas';
        $('#vacio-reservas-texto').textContent = 'Registrá la primera reserva de mesa o evento y quedará asociada a un cliente.';
        $('#vacio-reservas-acciones').hidden = false;
        $('#btn-vacio-limpiar').hidden = true;
      } else {
        $('#vacio-reservas-titulo').textContent = 'No hay reservas con estos filtros';
        $('#vacio-reservas-texto').textContent = 'Probá con otra búsqueda, otro tipo de reserva u otra fecha.';
        $('#vacio-reservas-acciones').hidden = true;
        $('#btn-vacio-limpiar').hidden = false;
      }
    } else {
      tabla.hidden = false;
      vacio.hidden = true;
      reservasActuales.forEach(function (reserva) {
        cuerpo.appendChild(crearFilaReserva(reserva));
      });
    }

    $('#limpiar-filtros').hidden = !conFiltros;

    const chip = $('#chip-cliente');
    if (estado.idCliente) {
      const cliente = DB.obtenerCliente(estado.idCliente);
      estado.nombreClienteFiltro = cliente ? cliente.apellido + ', ' + cliente.nombre : '';
      $('#chip-cliente-nombre').textContent = estado.nombreClienteFiltro || 'cliente seleccionado';
      chip.hidden = false;
    } else {
      chip.hidden = true;
    }
  }

  function crearFilaReserva(reserva) {
    const fila = document.createElement('tr');
    const fecha = parseFechaHora(reserva.fecha_reserva) || new Date();
    const creada = parseFechaHora(reserva.creada_en);
    const cancelada = reserva.estado === 'cancelada';
    const pasada = fecha.getTime() < Date.now();
    if (pasada || cancelada) fila.classList.add('reserva-pasada');

    /* cliente */
    const celdaCliente = document.createElement('td');
    const cajaCliente = crear('div', 'celda-cliente');
    cajaCliente.appendChild(crear('div', 'avatar' + (reserva.tipo === 'evento' ? ' evento' : ''), iniciales(reserva.nombre, reserva.apellido)));
    const columna = crear('div', 'celda-cliente-texto');
    columna.appendChild(crear('span', 'nombre-cliente', reserva.apellido + ', ' + reserva.nombre));
    columna.appendChild(crear('span', 'meta', numeroCliente(reserva.id_cliente) + ' · DNI ' + reserva.documento));
    cajaCliente.appendChild(columna);
    celdaCliente.appendChild(cajaCliente);

    /* fecha */
    const celdaFecha = document.createElement('td');
    const cajaFecha = crear('div', 'celda-fecha');
    cajaFecha.title = 'Reservada para el ' + fechaCorta(fecha) + ' a las ' + horaCorta(fecha) +
      (creada ? ' · Registrada el ' + fechaCorta(creada) + ' a las ' + horaCorta(creada) : '');
    cajaFecha.appendChild(crear('span', 'fecha-principal', fechaCorta(fecha) + ' · ' + horaCorta(fecha)));
    const detalleFecha = crear('span', 'fecha-detalle');
    detalleFecha.appendChild(crear('span', 'badge numero', etiquetaRelativa(fecha)));
    if (creada) detalleFecha.appendChild(crear('span', '', 'registrada el ' + fechaCorta(creada)));
    cajaFecha.appendChild(detalleFecha);
    celdaFecha.appendChild(cajaFecha);

    /* tipo */
    const celdaTipo = document.createElement('td');
    celdaTipo.appendChild(crear(
      'span',
      'badge ' + (reserva.tipo === 'evento' ? 'tipo-evento' : 'tipo-mesa'),
      reserva.tipo === 'evento' ? 'Evento' : 'Mesa'
    ));

    /* personas */
    const celdaPersonas = document.createElement('td');
    celdaPersonas.className = 'num';
    const personas = crear('span', 'personas');
    personas.appendChild(icono('usuarios'));
    personas.appendChild(crear('span', '', String(reserva.personas)));
    celdaPersonas.appendChild(personas);

    /* combos */
    const celdaCombos = document.createElement('td');
    celdaCombos.className = 'num';
    const cantidadCombos = Number(reserva.combos_cantidad || 0);
    if (cantidadCombos > 0) {
      const cajaCombos = crear('div', 'celda-combos');
      cajaCombos.title = (reserva.combos_detalle || '') +
        ' · Total ' + dinero(reserva.combos_total);
      cajaCombos.appendChild(crear('span', 'dato-fuerte', cantidadCombos + (cantidadCombos === 1 ? ' combo' : ' combos')));
      cajaCombos.appendChild(crear('span', 'meta dato-dinero', dinero(reserva.combos_total)));
      celdaCombos.appendChild(cajaCombos);
    } else {
      celdaCombos.appendChild(crear('span', 'meta', '—'));
    }

    /* detalle */
    const celdaDetalle = document.createElement('td');
    const cajaDetalle = crear('div', 'detalle-reserva');
    if (reserva.detalle) {
      cajaDetalle.appendChild(crear('span', '', reserva.detalle));
    } else {
      cajaDetalle.appendChild(crear('span', 'meta', '—'));
    }
    if (reserva.notas) {
      const nota = crear('span', 'nota-corta', reserva.notas);
      nota.title = reserva.notas;
      cajaDetalle.appendChild(nota);
    }
    celdaDetalle.appendChild(cajaDetalle);

    /* estado */
    const celdaEstado = document.createElement('td');
    celdaEstado.appendChild(crear('span', 'badge estado-' + reserva.estado, capitalizar(reserva.estado)));

    /* pago */
    const celdaPago = document.createElement('td');
    const cajaPago = crear('div', 'celda-pago');
    if (reserva.id_pago) {
      cajaPago.appendChild(crear('span', 'badge pago-pagada', 'Pagada'));
      const partesPago = [];
      if (Number(reserva.pago_transferencia) > 0) partesPago.push('Transf. ' + dinero(reserva.pago_transferencia));
      if (Number(reserva.pago_efectivo) > 0) partesPago.push('Efectivo ' + dinero(reserva.pago_efectivo));
      if (partesPago.length) cajaPago.appendChild(crear('span', 'meta', partesPago.join(' · ')));
      const fechaPago = parseFechaHora(reserva.pago_fecha);
      if (fechaPago) cajaPago.title = 'Pagada el ' + fechaCorta(fechaPago) + ' a las ' + horaCorta(fechaPago);
    } else {
      cajaPago.appendChild(crear('span', 'badge pago-sin', 'Sin pagar'));
    }
    celdaPago.appendChild(cajaPago);

    /* acciones */
    const celdaAcciones = document.createElement('td');
    celdaAcciones.className = 'col-acciones';
    const acciones = crear('div', 'acciones-fila');
    acciones.appendChild(botonIcono('dinero', reserva.id_pago ? 'Editar pago' : 'Registrar pago', 'pagar', reserva.id_reserva, false));
    acciones.appendChild(botonIcono('editar', 'Editar reserva', 'editar', reserva.id_reserva, false));
    acciones.appendChild(botonIcono('eliminar', 'Eliminar reserva', 'eliminar', reserva.id_reserva, true));
    celdaAcciones.appendChild(acciones);

    fila.append(celdaCliente, celdaFecha, celdaTipo, celdaPersonas, celdaCombos, celdaDetalle, celdaEstado, celdaPago, celdaAcciones);
    return fila;
  }

  function accionReserva(evento) {
    const boton = evento.target.closest('button[data-accion]');
    if (!boton) return;
    const reserva = reservasActuales.filter(function (r) {
      return r.id_reserva === Number(boton.dataset.id);
    })[0];
    if (!reserva) return;

    if (boton.dataset.accion === 'editar') abrirReserva(reserva);
    if (boton.dataset.accion === 'eliminar') pedirEliminarReserva(reserva);
    if (boton.dataset.accion === 'pagar') abrirPago(reserva);
  }

  /* ---------- tabla de clientes ---------- */

  function renderClientes() {
    if (!window.DB) return;

    clientesActuales = DB.listarClientes(estado.busquedaClientes);

    const cuerpo = $('#cuerpo-clientes');
    cuerpo.replaceChildren();

    const tabla = $('#tabla-clientes');
    const vacio = $('#vacio-clientes');
    const buscando = Boolean(estado.busquedaClientes.trim());

    if (buscando) {
      $('#resultado-clientes').textContent = clientesActuales.length + (clientesActuales.length === 1 ? ' resultado' : ' resultados');
    } else {
      $('#resultado-clientes').textContent = clientesActuales.length + (clientesActuales.length === 1 ? ' cliente' : ' clientes');
    }

    if (clientesActuales.length === 0) {
      tabla.hidden = true;
      vacio.hidden = false;
      $('#vacio-clientes-acciones').hidden = buscando;
      $('#btn-vacio-limpiar-clientes').hidden = !buscando;

      if (buscando) {
        $('#vacio-clientes-titulo').textContent = 'No se encontraron clientes';
        $('#vacio-clientes-texto').textContent = 'Probá con otro nombre, documento, teléfono o número de cliente.';
      } else {
        $('#vacio-clientes-titulo').textContent = 'Todavía no hay clientes';
        $('#vacio-clientes-texto').textContent = 'Registrá a la primera persona con su nombre, teléfono y documento. El número de cliente se asigna solo.';
      }
    } else {
      tabla.hidden = false;
      vacio.hidden = true;
      clientesActuales.forEach(function (cliente) {
        cuerpo.appendChild(crearFilaCliente(cliente));
      });
    }
  }

  function crearFilaCliente(cliente) {
    const fila = document.createElement('tr');
    const creado = parseFechaHora(cliente.creado_en);

    const celdaNumero = document.createElement('td');
    celdaNumero.appendChild(crear('span', 'badge numero', numeroCliente(cliente.id_cliente)));

    const celdaCliente = document.createElement('td');
    const caja = crear('div', 'celda-cliente');
    caja.appendChild(crear('div', 'avatar', iniciales(cliente.nombre, cliente.apellido)));
    const columna = crear('div', 'celda-cliente-texto');
    columna.appendChild(crear('span', 'nombre-cliente', cliente.apellido + ', ' + cliente.nombre));
    columna.appendChild(crear('span', 'meta', creado ? 'Registrado el ' + fechaCorta(creado) : ''));
    caja.appendChild(columna);
    celdaCliente.appendChild(caja);

    const celdaTelefono = document.createElement('td');
    const telefono = document.createElement('a');
    telefono.className = 'telefono';
    telefono.href = 'tel:' + cliente.telefono.replace(/[^\d+]/g, '');
    telefono.textContent = cliente.telefono;
    celdaTelefono.appendChild(telefono);

    const celdaDocumento = document.createElement('td');
    celdaDocumento.textContent = cliente.documento;

    const celdaReservas = document.createElement('td');
    celdaReservas.className = 'num';
    const cajaReservas = crear('div', 'celda-fecha');
    if (Number(cliente.total_reservas) > 0) {
      cajaReservas.appendChild(crear('span', 'fecha-principal', String(cliente.total_reservas)));
      const proximas = Number(cliente.proximas);
      cajaReservas.appendChild(crear('span', 'meta', proximas === 1 ? '1 próxima' : proximas + ' próximas'));
    } else {
      cajaReservas.appendChild(crear('span', 'meta', '—'));
    }
    celdaReservas.appendChild(cajaReservas);

    const celdaAcciones = document.createElement('td');
    celdaAcciones.className = 'col-acciones';
    const acciones = crear('div', 'acciones-fila');
    acciones.appendChild(botonIcono('calendario', 'Ver sus reservas', 'ver', cliente.id_cliente, false));
    acciones.appendChild(botonIcono('editar', 'Editar cliente', 'editar', cliente.id_cliente, false));
    acciones.appendChild(botonIcono('eliminar', 'Eliminar cliente', 'eliminar', cliente.id_cliente, true));
    celdaAcciones.appendChild(acciones);

    fila.append(celdaNumero, celdaCliente, celdaTelefono, celdaDocumento, celdaReservas, celdaAcciones);
    return fila;
  }

  function accionCliente(evento) {
    const boton = evento.target.closest('button[data-accion]');
    if (!boton) return;
    const cliente = clientesActuales.filter(function (c) {
      return c.id_cliente === Number(boton.dataset.id);
    })[0];
    if (!cliente) return;

    if (boton.dataset.accion === 'editar') abrirCliente(cliente);
    if (boton.dataset.accion === 'ver') verReservasDeCliente(cliente);
    if (boton.dataset.accion === 'eliminar') pedirEliminarCliente(cliente);
  }

  function verReservasDeCliente(cliente) {
    estado.idCliente = cliente.id_cliente;
    estado.nombreClienteFiltro = cliente.apellido + ', ' + cliente.nombre;
    estado.busquedaReservas = '';
    estado.tipo = '';
    estado.estadoReserva = '';
    estado.fecha = '';
    $('#buscar-reservas').value = '';
    $('#filtro-tipo').value = '';
    $('#filtro-estado').value = '';
    $('#filtro-fecha').value = '';
    cambiarVista('reservas');
    renderReservas();
    $('#vista-reservas').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ---------- tabla de combos ---------- */

  function renderCombos() {
    if (!window.DB) return;

    combosActuales = DB.listarCombos(estado.busquedaCombos);

    const cuerpo = $('#cuerpo-combos');
    cuerpo.replaceChildren();

    const tabla = $('#tabla-combos');
    const vacio = $('#vacio-combos');
    const buscando = Boolean(String(estado.busquedaCombos || '').trim());

    $('#resultado-combos').textContent = combosActuales.length + (combosActuales.length === 1 ? ' combo' : ' combos');

    if (combosActuales.length === 0) {
      tabla.hidden = true;
      vacio.hidden = false;
      $('#vacio-combos-acciones').hidden = buscando;
      $('#btn-vacio-limpiar-combos').hidden = !buscando;

      if (buscando) {
        $('#vacio-combos-titulo').textContent = 'No se encontraron combos';
        $('#vacio-combos-texto').textContent = 'Probá con otro nombre o con parte de lo que incluye el combo.';
      } else {
        $('#vacio-combos-titulo').textContent = 'Todavía no hay combos';
        $('#vacio-combos-texto').textContent = 'Creá el primer combo con su nombre, lo que incluye y el precio por unidad. Después vas a poder sumarlo a cualquier reserva.';
      }
    } else {
      tabla.hidden = false;
      vacio.hidden = true;
      combosActuales.forEach(function (combo) {
        cuerpo.appendChild(crearFilaCombo(combo));
      });
    }
  }

  function crearFilaCombo(combo) {
    const fila = document.createElement('tr');

    const celdaNombre = document.createElement('td');
    const caja = crear('div', 'celda-combo');
    caja.appendChild(crear('span', 'nombre-cliente', combo.nombre));
    caja.appendChild(crear('span', 'meta', 'Combo #' + combo.id_combo));
    celdaNombre.appendChild(caja);

    const celdaContenido = document.createElement('td');
    if (combo.contenido) {
      const incluye = crear('span', 'incluye-combo', combo.contenido);
      incluye.title = combo.contenido;
      celdaContenido.appendChild(incluye);
    } else {
      celdaContenido.appendChild(crear('span', 'meta', '—'));
    }

    const celdaPrecio = document.createElement('td');
    celdaPrecio.className = 'num';
    celdaPrecio.appendChild(crear('span', 'dato-dinero', dinero(combo.precio)));

    const celdaUsos = document.createElement('td');
    celdaUsos.className = 'num';
    const usos = Number(combo.usos || 0);
    celdaUsos.appendChild(crear('span', usos > 0 ? 'dato-fuerte' : 'meta', usos > 0 ? String(usos) : '—'));

    const celdaAcciones = document.createElement('td');
    celdaAcciones.className = 'col-acciones';
    const acciones = crear('div', 'acciones-fila');
    acciones.appendChild(botonIcono('editar', 'Editar combo', 'editar', combo.id_combo, false));
    acciones.appendChild(botonIcono('eliminar', 'Eliminar combo', 'eliminar', combo.id_combo, true));
    celdaAcciones.appendChild(acciones);

    fila.append(celdaNombre, celdaContenido, celdaPrecio, celdaUsos, celdaAcciones);
    return fila;
  }

  function accionCombo(evento) {
    const boton = evento.target.closest('button[data-accion]');
    if (!boton) return;
    const combo = combosActuales.filter(function (c) {
      return c.id_combo === Number(boton.dataset.id);
    })[0];
    if (!combo) return;

    if (boton.dataset.accion === 'editar') abrirCombo(combo);
    if (boton.dataset.accion === 'eliminar') pedirEliminarCombo(combo);
  }

  /* ---------- diálogo combo ---------- */

  function abrirCombo(combo) {
    estado.editandoCombo = combo || null;
    const formulario = $('#form-combo');
    formulario.reset();
    $$('.invalido', formulario).forEach(function (campo) {
      campo.classList.remove('invalido');
      campo.removeAttribute('aria-invalid');
    });
    ocultarError($('#error-combo'));

    if (combo) {
      $('#titulo-combo').textContent = 'Editar combo';
      $('#subtitulo-combo').textContent = 'Los cambios de precio solo afectan a las reservas nuevas.';
      $('#btn-guardar-combo').textContent = 'Guardar cambios';
      $('#co-nombre').value = combo.nombre;
      $('#co-precio').value = numeroEditable(combo.precio);
      $('#co-contenido').value = combo.contenido || '';
    } else {
      $('#titulo-combo').textContent = 'Nuevo combo';
      $('#subtitulo-combo').textContent = 'Agregá una comida que se pueda sumar a las reservas.';
      $('#btn-guardar-combo').textContent = 'Guardar combo';
    }

    $('#dlg-combo').showModal();
    setTimeout(function () { $('#co-nombre').focus(); }, 30);
  }

  function guardarCombo(evento) {
    evento.preventDefault();
    const error = $('#error-combo');
    ocultarError(error);

    const nombre = $('#co-nombre').value;
    const precioTexto = $('#co-precio').value;

    if (!String(nombre).trim()) return fallarCampo('#co-nombre', error, 'Ingresá el nombre del combo.');
    if (!String(precioTexto).trim()) return fallarCampo('#co-precio', error, 'Ingresá el precio del combo.');

    const precio = parsearPrecio(precioTexto);
    if (!Number.isFinite(precio) || precio < 0) {
      return fallarCampo('#co-precio', error, 'Ingresá un precio válido, por ejemplo 9800 o 9.800,50.');
    }

    const datos = {
      nombre: nombre,
      precio: precio,
      contenido: $('#co-contenido').value
    };

    const veniaDeReserva = estado.comboDesdeReserva;
    const eraEdicion = Boolean(estado.editandoCombo);
    let id = null;

    try {
      if (estado.editandoCombo) id = DB.actualizarCombo(estado.editandoCombo.id_combo, datos);
      else id = DB.crearCombo(datos);
    } catch (excepcion) {
      mostrarError(error, excepcion.message);
      return;
    }

    $('#dlg-combo').close();
    refrescarTodo();
    mostrarToast(eraEdicion ? 'Combo actualizado correctamente.' : 'Combo creado correctamente.');

    if (veniaDeReserva && $('#dlg-reserva').open) {
      const combo = DB.obtenerCombo(id);
      if (combo) {
        agregarComboALista(combo, Number($('#re-personas').value));
        mostrarToast('Combo “' + combo.nombre + '” agregado a la reserva.', 'info');
      }
      cargarSelectCombos();
    }
  }

  function pedirEliminarCombo(combo) {
    const usos = DB.contarReservasConCombo(combo.id_combo);
    if (usos > 0) {
      abrirConfirmacion({
        titulo: 'No se puede eliminar',
        mensaje: 'El combo “' + combo.nombre + '” aparece en ' + usos + ' reserva' + (usos === 1 ? '' : 's') +
          '. Quitalo de esas reservas antes de eliminarlo.',
        soloCerrar: true
      });
      return;
    }

    abrirConfirmacion({
      titulo: 'Eliminar combo',
      mensaje: 'Se eliminará el combo “' + combo.nombre + '”. Esta acción no se puede deshacer.',
      textoAceptar: 'Eliminar combo',
      alAceptar: function () {
        DB.eliminarCombo(combo.id_combo);
        refrescarTodo();
        mostrarToast('Combo eliminado.', 'info');
      }
    });
  }

  /* ---------- combos dentro de la reserva ---------- */

  function cargarSelectCombos() {
    const select = $('#re-combo');
    const cantidad = $('#re-combo-cantidad');
    const agregar = $('#btn-agregar-combo');
    select.replaceChildren();

    const combos = DB.listarCombos('');
    if (combos.length === 0) {
      select.appendChild(new Option('No hay combos cargados', ''));
      select.disabled = true;
      cantidad.disabled = true;
      agregar.disabled = true;
      $('#ayuda-combos').textContent = 'Todavía no hay combos cargados. Usá “Nuevo combo” para crear el primero.';
      return;
    }

    select.disabled = false;
    cantidad.disabled = false;
    agregar.disabled = false;

    combos.forEach(function (combo) {
      const yaEsta = estado.combosReserva.some(function (item) { return item.id_combo === Number(combo.id_combo); });
      select.appendChild(new Option(
        combo.nombre + ' — ' + dinero(combo.precio) + ' c/u' + (yaEsta ? ' (ya agregado)' : ''),
        String(combo.id_combo)
      ));
    });

    actualizarSugerenciaCombos();
  }

  function actualizarSugerenciaCombos() {
    const personas = Number($('#re-personas').value);
    const sugerida = Number.isInteger(personas) && personas >= 1 && personas <= 500 ? personas : 1;
    const campo = $('#re-combo-cantidad');
    if (campo && !campo.disabled) campo.value = String(sugerida);
    if (!$('#re-combo').disabled) {
      $('#ayuda-combos').textContent = 'Los combos se cobran por unidad. Sugerido: 1 por comensal (' + sugerida + ').';
    }
  }

  function agregarComboAReserva() {
    const select = $('#re-combo');
    const id = Number(select.value);
    if (!id) {
      mostrarToast('Elegí un combo para agregar.', 'error');
      return;
    }

    const combo = DB.obtenerCombo(id);
    if (!combo) {
      mostrarToast('Ese combo ya no existe. Actualizá la lista.', 'error');
      cargarSelectCombos();
      return;
    }

    if (estado.combosReserva.some(function (item) { return item.id_combo === id; })) {
      mostrarToast('Ese combo ya está en la reserva. Cambiá la cantidad en la lista.', 'info');
      return;
    }

    agregarComboALista(combo, Number($('#re-combo-cantidad').value));
    cargarSelectCombos();
  }

  function agregarComboALista(combo, cantidad) {
    const numero = limitarCantidad(Number(cantidad));
    estado.combosReserva.push({
      id_combo: Number(combo.id_combo),
      nombre: combo.nombre,
      cantidad: numero,
      precio_unitario: Number(combo.precio)
    });
    renderCombosReserva();
  }

  function renderCombosReserva() {
    const contenedor = $('#lista-combos-reserva');
    contenedor.replaceChildren();

    if (estado.combosReserva.length === 0) {
      contenedor.appendChild(crear('p', 'sin-combos', 'Todavía no agregaste combos a esta reserva.'));
    } else {
      estado.combosReserva.forEach(function (item) {
        contenedor.appendChild(crearLineaCombo(item));
      });
    }

    actualizarTotalesCombos();
  }

  function crearLineaCombo(item) {
    const linea = crear('div', 'linea-combo');
    linea.dataset.id = item.id_combo;

    const info = crear('div', 'linea-combo-info');
    info.appendChild(crear('span', 'nombre-combo', item.nombre));
    info.appendChild(crear('span', 'meta', dinero(item.precio_unitario) + ' por unidad'));
    linea.appendChild(info);

    const escalon = crear('div', 'escalon');
    const menos = crear('button', '', '−');
    menos.type = 'button';
    menos.dataset.paso = '-1';
    menos.setAttribute('aria-label', 'Quitar una unidad de ' + item.nombre);
    const campo = document.createElement('input');
    campo.type = 'number';
    campo.min = '1';
    campo.max = '500';
    campo.step = '1';
    campo.value = String(item.cantidad);
    campo.dataset.cantidad = '1';
    campo.setAttribute('aria-label', 'Cantidad de ' + item.nombre);
    const mas = crear('button', '', '+');
    mas.type = 'button';
    mas.dataset.paso = '1';
    mas.setAttribute('aria-label', 'Agregar una unidad de ' + item.nombre);
    escalon.append(menos, campo, mas);
    linea.appendChild(escalon);

    linea.appendChild(crear('span', 'linea-combo-subtotal', dinero(item.cantidad * item.precio_unitario)));

    const quitar = botonIcono('eliminar', 'Quitar combo de la reserva', 'quitar', item.id_combo, true);
    linea.appendChild(quitar);

    return linea;
  }

  function accionLineaCombo(evento) {
    const linea = evento.target.closest('.linea-combo');
    if (!linea) return;
    const id = Number(linea.dataset.id);
    const item = estado.combosReserva.filter(function (combo) { return combo.id_combo === id; })[0];
    if (!item) return;

    const paso = evento.target.closest('[data-paso]');
    if (paso) {
      item.cantidad = limitarCantidad(item.cantidad + Number(paso.dataset.paso));
      renderCombosReserva();
      return;
    }

    if (evento.target.closest('[data-accion="quitar"]')) {
      estado.combosReserva = estado.combosReserva.filter(function (combo) { return combo.id_combo !== id; });
      renderCombosReserva();
      cargarSelectCombos();
      return;
    }

    const campo = evento.target.closest('input[data-cantidad]');
    if (!campo) return;

    if (evento.type === 'input') {
      const valor = Number(campo.value);
      if (Number.isInteger(valor) && valor >= 1 && valor <= 500) {
        item.cantidad = valor;
        actualizarTotalesCombos();
      }
      return;
    }

    item.cantidad = limitarCantidad(Number(campo.value));
    renderCombosReserva();
  }

  function actualizarTotalesCombos() {
    estado.combosReserva.forEach(function (item) {
      const linea = document.querySelector('.linea-combo[data-id="' + item.id_combo + '"]');
      if (!linea) return;
      const subtotal = $('.linea-combo-subtotal', linea);
      if (subtotal) subtotal.textContent = dinero(item.cantidad * item.precio_unitario);
    });

    const total = totalCombosReserva();
    $('#total-combos').hidden = estado.combosReserva.length === 0;
    $('#total-combos-valor').textContent = dinero(total);
  }

  function totalCombosReserva() {
    const total = estado.combosReserva.reduce(function (suma, item) {
      return suma + (Number(item.cantidad) * Number(item.precio_unitario));
    }, 0);
    return Math.round((total + Number.EPSILON) * 100) / 100;
  }

  function limitarCantidad(valor) {
    const numero = Number(valor);
    if (!Number.isFinite(numero)) return 1;
    return Math.min(500, Math.max(1, Math.round(numero)));
  }

  /* ---------- diálogo cliente ---------- */

  function abrirCliente(cliente) {
    estado.editandoCliente = cliente || null;
    const formulario = $('#form-cliente');
    formulario.reset();
    $$('.invalido', formulario).forEach(function (campo) {
      campo.classList.remove('invalido');
      campo.removeAttribute('aria-invalid');
    });
    ocultarError($('#error-cliente'));

    if (cliente) {
      $('#titulo-cliente').textContent = 'Editar cliente';
      $('#subtitulo-cliente').textContent = 'Actualizá los datos de contacto o el documento.';
      $('#btn-guardar-cliente').textContent = 'Guardar cambios';
      $('#cl-nombre').value = cliente.nombre;
      $('#cl-apellido').value = cliente.apellido;
      $('#cl-telefono').value = cliente.telefono;
      $('#cl-documento').value = cliente.documento;
      const creado = parseFechaHora(cliente.creado_en);
      $('#nota-numero-cliente').textContent = 'Cliente ' + numeroCliente(cliente.id_cliente) +
        (creado ? ' · registrado el ' + fechaCorta(creado) : '') + '. El número no cambia.';
    } else {
      $('#titulo-cliente').textContent = 'Nuevo cliente';
      $('#subtitulo-cliente').textContent = 'Los datos quedan guardados para futuras reservas.';
      $('#btn-guardar-cliente').textContent = 'Guardar cliente';
      $('#nota-numero-cliente').textContent = 'El número de cliente se asigna automáticamente y es único.';
    }

    $('#dlg-cliente').showModal();
    setTimeout(function () { $('#cl-nombre').focus(); }, 30);
  }

  function guardarCliente(evento) {
    evento.preventDefault();
    const error = $('#error-cliente');
    ocultarError(error);

    const datos = {
      nombre: $('#cl-nombre').value,
      apellido: $('#cl-apellido').value,
      telefono: $('#cl-telefono').value,
      documento: $('#cl-documento').value
    };

    if (!datos.nombre.trim()) return fallarCampo('#cl-nombre', error, 'Ingresá el nombre del cliente.');
    if (!datos.apellido.trim()) return fallarCampo('#cl-apellido', error, 'Ingresá el apellido del cliente.');
    if (!datos.telefono.trim()) return fallarCampo('#cl-telefono', error, 'Ingresá el teléfono del cliente.');
    if (!datos.documento.trim()) return fallarCampo('#cl-documento', error, 'Ingresá el número de documento.');

    const veniaDeReserva = estado.clienteDesdeReserva;
    const eraEdicion = Boolean(estado.editandoCliente);
    let id = null;

    try {
      if (estado.editandoCliente) {
        id = DB.actualizarCliente(estado.editandoCliente.id_cliente, datos);
      } else {
        id = DB.crearCliente(datos);
      }
    } catch (excepcion) {
      mostrarError(error, excepcion.message);
      return;
    }

    $('#dlg-cliente').close();
    refrescarTodo();
    mostrarToast(eraEdicion ? 'Cliente actualizado correctamente.' : 'Cliente ' + numeroCliente(id) + ' registrado correctamente.');

    if (veniaDeReserva && $('#dlg-reserva').open) {
      cargarSelectClientes(id);
      mostrarToast('Cliente ' + numeroCliente(id) + ' seleccionado en la reserva.', 'info');
    }
  }

  function pedirEliminarCliente(cliente) {
    const total = DB.contarReservasDeCliente(cliente.id_cliente);
    if (total > 0) {
      abrirConfirmacion({
        titulo: 'No se puede eliminar',
        mensaje: cliente.apellido + ', ' + cliente.nombre + ' tiene ' + total + ' reserva' + (total === 1 ? '' : 's') +
          ' asociada' + (total === 1 ? '' : 's') + '. Eliminá o reasigná esas reservas antes de borrar la ficha.',
        soloCerrar: true
      });
      return;
    }

    abrirConfirmacion({
      titulo: 'Eliminar cliente',
      mensaje: 'Se eliminará la ficha de ' + cliente.apellido + ', ' + cliente.nombre + ' (' + numeroCliente(cliente.id_cliente) + '). Esta acción no se puede deshacer.',
      textoAceptar: 'Eliminar cliente',
      alAceptar: function () {
        DB.eliminarCliente(cliente.id_cliente);
        if (estado.idCliente === cliente.id_cliente) {
          estado.idCliente = null;
          estado.nombreClienteFiltro = '';
        }
        refrescarTodo();
        mostrarToast('Cliente eliminado.', 'info');
      }
    });
  }

  /* ---------- diálogo reserva ---------- */

  function abrirReserva(reserva) {
    estado.editandoReserva = reserva || null;
    const formulario = $('#form-reserva');
    formulario.reset();
    $$('.invalido', formulario).forEach(function (campo) {
      campo.classList.remove('invalido');
      campo.removeAttribute('aria-invalid');
    });
    ocultarError($('#error-reserva'));

    cargarSelectClientes(reserva ? reserva.id_cliente : null);

    const hayClientes = DB.estadisticas().clientes > 0;
    if (!hayClientes) {
      $('#ayuda-cliente').textContent = 'Todavía no hay clientes registrados. Usá “Nuevo cliente” para crear la ficha y continuar.';
    } else {
      $('#ayuda-cliente').textContent = 'Si el cliente no está registrado, creá su ficha sin salir de este formulario.';
    }

    if (reserva) {
      $('#titulo-reserva').textContent = 'Editar reserva';
      $('#subtitulo-reserva').textContent = 'Modificá la fecha, el tipo o los datos del cliente asignado.';
      $('#btn-guardar-reserva').textContent = 'Guardar cambios';

      const fecha = parseFechaHora(reserva.fecha_reserva);
      $('#re-fecha').value = fecha ? fechaParaInput(fecha) : '';
      $('#re-fecha').removeAttribute('min');
      $('#re-personas').value = reserva.personas;

      const radio = formulario.querySelector('input[name="re-tipo"][value="' + reserva.tipo + '"]');
      if (radio) radio.checked = true;

      $('#re-detalle').value = reserva.detalle || '';
      $('#re-estado').value = reserva.estado;
      $('#re-notas').value = reserva.notas || '';

      const creada = parseFechaHora(reserva.creada_en);
      $('#nota-registro span').textContent = creada
        ? 'Reserva registrada el ' + fechaCorta(creada) + ' a las ' + horaCorta(creada) + '.'
        : 'La fecha de registro se guardó automáticamente.';
    } else {
      $('#titulo-reserva').textContent = 'Nueva reserva';
      $('#subtitulo-reserva').textContent = 'Asociá una mesa o un evento a un cliente.';
      $('#btn-guardar-reserva').textContent = 'Guardar reserva';

      $('#re-fecha').value = fechaParaInput(proximaFechaSugerida());
      $('#re-fecha').min = fechaParaInput(new Date());
      $('#re-personas').value = 2;
      $('#re-estado').value = 'pendiente';
      $('#nota-registro span').textContent = 'La fecha de registro se completa automáticamente al guardar.';
    }

    estado.combosReserva = (reserva ? DB.combosDeReserva(reserva.id_reserva) : []).map(function (combo) {
      return {
        id_combo: Number(combo.id_combo),
        nombre: combo.nombre,
        cantidad: Number(combo.cantidad),
        precio_unitario: Number(combo.precio_unitario)
      };
    });
    cargarSelectCombos();
    renderCombosReserva();
    actualizarSugerenciaCombos();

    actualizarDetalleTipo();
    $('#dlg-reserva').showModal();

    setTimeout(function () {
      if (!hayClientes) $('#btn-cliente-desde-reserva').focus();
      else $('#re-cliente').focus();
    }, 30);
  }

  function cargarSelectClientes(seleccionado) {
    const select = $('#re-cliente');
    select.replaceChildren();
    select.appendChild(new Option('Seleccioná un cliente…', ''));

    DB.listarClientes('').forEach(function (cliente) {
      const texto = numeroCliente(cliente.id_cliente) + ' · ' + cliente.apellido + ', ' + cliente.nombre +
        ' — DNI ' + cliente.documento;
      select.appendChild(new Option(texto, String(cliente.id_cliente)));
    });

    if (seleccionado !== null && seleccionado !== undefined && seleccionado !== '') {
      const valor = String(seleccionado);
      const existe = Array.prototype.some.call(select.options, function (opcion) { return opcion.value === valor; });
      select.value = existe ? valor : '';
    }
  }

  function actualizarDetalleTipo() {
    const marcado = $('#form-reserva').querySelector('input[name="re-tipo"]:checked');
    const tipo = marcado ? marcado.value : 'mesa';
    const etiqueta = $('#label-detalle');
    const campo = $('#re-detalle');

    if (tipo === 'evento') {
      etiqueta.textContent = 'Nombre del evento (opcional)';
      campo.placeholder = 'Ej.: Aniversario de la empresa';
    } else {
      etiqueta.textContent = 'Mesa asignada (opcional)';
      campo.placeholder = 'Ej.: Mesa 7';
    }
  }

  function guardarReserva(evento) {
    evento.preventDefault();
    const formulario = $('#form-reserva');
    const error = $('#error-reserva');
    ocultarError(error);

    const esEdicion = Boolean(estado.editandoReserva);
    const idCliente = Number($('#re-cliente').value);
    const fechaTexto = $('#re-fecha').value;
    const personas = Number($('#re-personas').value);
    const marcado = formulario.querySelector('input[name="re-tipo"]:checked');

    if (!idCliente) return fallarCampo('#re-cliente', error, 'Seleccioná un cliente para la reserva.');
    if (!fechaTexto) return fallarCampo('#re-fecha', error, 'Elegí la fecha y hora de la reserva.');

    const fecha = parseFechaHora(fechaTexto);
    if (!fecha) return fallarCampo('#re-fecha', error, 'La fecha y hora ingresadas no son válidas.');
    if (!esEdicion && fecha.getTime() < Date.now() - 60000) {
      return fallarCampo('#re-fecha', error, 'La fecha de la reserva no puede ser anterior a este momento.');
    }

    if (!Number.isInteger(personas) || personas < 1 || personas > 500) {
      return fallarCampo('#re-personas', error, 'La cantidad de personas debe ser un número entero entre 1 y 500.');
    }

    const datos = {
      id_cliente: idCliente,
      fecha_reserva: fechaTexto,
      tipo: marcado ? marcado.value : 'mesa',
      personas: personas,
      detalle: $('#re-detalle').value,
      estado: $('#re-estado').value,
      notas: $('#re-notas').value,
      combos: estado.combosReserva.map(function (item) {
        return {
          id_combo: item.id_combo,
          cantidad: item.cantidad,
          precio_unitario: item.precio_unitario
        };
      })
    };

    try {
      if (esEdicion) DB.actualizarReserva(estado.editandoReserva.id_reserva, datos);
      else DB.crearReserva(datos);
    } catch (excepcion) {
      mostrarError(error, excepcion.message);
      return;
    }

    $('#dlg-reserva').close();
    refrescarTodo();
    mostrarToast(esEdicion ? 'Reserva actualizada correctamente.' : 'Reserva guardada correctamente.');
  }

  function pedirEliminarReserva(reserva) {
    const fecha = parseFechaHora(reserva.fecha_reserva);
    abrirConfirmacion({
      titulo: 'Eliminar reserva',
      mensaje: 'Se eliminará la reserva de ' + reserva.nombre + ' ' + reserva.apellido +
        (fecha ? ' para el ' + fechaCorta(fecha) + ' a las ' + horaCorta(fecha) : '') +
        '. Esta acción no se puede deshacer.',
      textoAceptar: 'Eliminar reserva',
      alAceptar: function () {
        DB.eliminarReserva(reserva.id_reserva);
        refrescarTodo();
        mostrarToast('Reserva eliminada.', 'info');
      }
    });
  }

  /* ---------- pagos ---------- */

  function redondearMonto(valor) {
    const numero = Number(valor);
    return Number.isFinite(numero) ? Math.round((numero + Number.EPSILON) * 100) / 100 : NaN;
  }

  function montoEntrada(selector) {
    const texto = String($(selector).value || '').trim();
    if (!texto) return 0;
    return parsearPrecio(texto);
  }

  function renderPagos() {
    if (!window.DB) return;

    pagosActuales = DB.listarPagos();
    const totales = DB.estadisticasPagos();
    $('#pago-stat-total').textContent = dinero(totales.total);
    $('#pago-stat-transferencia').textContent = dinero(totales.transferencia);
    $('#pago-stat-efectivo').textContent = dinero(totales.efectivo);
    $('#pago-stat-reservas').textContent = String(totales.reservas);

    const contenedor = $('#lista-pagos');
    contenedor.replaceChildren();
    $('#vacio-pagos').hidden = pagosActuales.length > 0;

    if (pagosActuales.length === 0) return;

    const grupos = [];
    const porDia = new Map();

    pagosActuales.forEach(function (pago) {
      const dia = pago.fecha_dia || String(pago.fecha_pago || '').slice(0, 10);
      if (!porDia.has(dia)) {
        const grupo = { dia: dia, pagos: [], transferencia: 0, efectivo: 0, total: 0 };
        porDia.set(dia, grupo);
        grupos.push(grupo);
      }
      const grupo = porDia.get(dia);
      grupo.pagos.push(pago);
      grupo.transferencia = redondearMonto(grupo.transferencia + Number(pago.monto_transferencia || 0));
      grupo.efectivo = redondearMonto(grupo.efectivo + Number(pago.monto_efectivo || 0));
      grupo.total = redondearMonto(grupo.total + Number(pago.total || 0));
    });

    grupos.forEach(function (grupo) {
      contenedor.appendChild(crearGrupoPagos(grupo));
    });
  }

  function crearGrupoPagos(grupo) {
    const fecha = parseFechaHora(grupo.dia);
    const panel = crear('section', 'panel panel-grupo-pagos');

    const cabecera = crear('div', 'cabecera-grupo-pagos');
    const info = crear('div', 'grupo-pagos-info');
    const lineaFecha = crear('div', 'grupo-pagos-fecha');
    lineaFecha.appendChild(crear('h3', '', fecha ? fechaCorta(fecha) : grupo.dia));
    if (fecha) lineaFecha.appendChild(crear('span', 'badge numero', etiquetaRelativa(fecha)));
    info.appendChild(lineaFecha);
    info.appendChild(crear('span', 'meta', grupo.pagos.length + (grupo.pagos.length === 1 ? ' reserva pagada' : ' reservas pagadas')));
    cabecera.appendChild(info);

    const totales = crear('div', 'grupo-pagos-totales');
    agregarMiniTotal(totales, 'Transferencia', dinero(grupo.transferencia), false);
    agregarMiniTotal(totales, 'Efectivo', dinero(grupo.efectivo), false);
    agregarMiniTotal(totales, 'Total', dinero(grupo.total), true);
    cabecera.appendChild(totales);
    panel.appendChild(cabecera);

    const envoltura = crear('div', 'tabla-envoltura');
    const tabla = document.createElement('table');
    tabla.className = 'tabla tabla-pagos';

    const thead = document.createElement('thead');
    const filaTitulos = document.createElement('tr');
    ['Fecha', 'Combos', 'Transferencia', 'Efectivo', 'Total'].forEach(function (titulo, indice) {
      const th = document.createElement('th');
      if (indice > 1) th.className = 'num';
      th.textContent = titulo;
      filaTitulos.appendChild(th);
    });
    const thAcciones = document.createElement('th');
    thAcciones.className = 'col-acciones';
    thAcciones.appendChild(crear('span', 'solo-lectores', 'Acciones'));
    filaTitulos.appendChild(thAcciones);
    thead.appendChild(filaTitulos);
    tabla.appendChild(thead);

    const tbody = document.createElement('tbody');
    grupo.pagos.forEach(function (pago) {
      tbody.appendChild(crearFilaPago(pago));
    });
    tabla.appendChild(tbody);

    const tfoot = document.createElement('tfoot');
    const filaPie = document.createElement('tr');
    const etiqueta = crear('td', '', 'Total del día');
    etiqueta.colSpan = 2;
    filaPie.appendChild(etiqueta);
    filaPie.appendChild(celdaMonto(grupo.transferencia));
    filaPie.appendChild(celdaMonto(grupo.efectivo));
    filaPie.appendChild(celdaMonto(grupo.total, 'pago-total'));
    const pieAcciones = document.createElement('td');
    pieAcciones.className = 'col-acciones';
    filaPie.appendChild(pieAcciones);
    tfoot.appendChild(filaPie);
    tabla.appendChild(tfoot);

    envoltura.appendChild(tabla);
    panel.appendChild(envoltura);
    return panel;
  }

  function agregarMiniTotal(caja, etiqueta, valor, fuerte) {
    const item = crear('div', 'mini-total' + (fuerte ? ' fuerte' : ''));
    item.appendChild(crear('span', 'mini-total-etiqueta', etiqueta));
    item.appendChild(crear('strong', '', valor));
    caja.appendChild(item);
  }

  function celdaMonto(valor, clase) {
    const celda = crear('td', 'num');
    celda.appendChild(crear('span', clase || 'dato-fuerte', dinero(valor)));
    return celda;
  }

  function crearFilaPago(pago) {
    const fila = document.createElement('tr');
    const fechaPago = parseFechaHora(pago.fecha_pago);
    const fechaReserva = parseFechaHora(pago.fecha_reserva);

    const celdaFecha = document.createElement('td');
    const cajaFecha = crear('div', 'celda-fecha');
    cajaFecha.appendChild(crear('span', 'fecha-principal', fechaPago
      ? fechaCorta(fechaPago) + ' · ' + horaCorta(fechaPago)
      : '—'));
    if (fechaReserva) {
      cajaFecha.appendChild(crear('span', 'meta', 'Reserva: ' + fechaCorta(fechaReserva) + ' · ' + horaCorta(fechaReserva)));
    }
    celdaFecha.appendChild(cajaFecha);

    const celdaCombos = document.createElement('td');
    const cajaCombos = crear('div', 'celda-pago-combos');
    const lineaCliente = crear('div', 'pago-cliente');
    lineaCliente.appendChild(crear('span', 'nombre-cliente', pago.apellido + ', ' + pago.nombre));
    const detalleCliente = [numeroCliente(pago.id_cliente), pago.tipo === 'evento' ? 'Evento' : 'Mesa'];
    if (pago.detalle) detalleCliente.push(pago.detalle);
    lineaCliente.appendChild(crear('span', 'meta', detalleCliente.join(' · ')));
    cajaCombos.appendChild(lineaCliente);

    const combos = DB.combosDeReserva(pago.id_reserva);
    if (combos.length) {
      combos.forEach(function (combo) {
        const linea = crear('div', 'pago-combo-linea');
        linea.appendChild(crear('span', 'pago-combo-cantidad', combo.cantidad + '×'));
        linea.appendChild(crear('span', 'pago-combo-nombre', combo.nombre));
        linea.appendChild(crear('span', 'meta pago-combo-precio', dinero(combo.precio_unitario) + ' c/u'));
        linea.title = combo.cantidad + ' × ' + combo.nombre + ' — ' + dinero(combo.precio_unitario) + ' por unidad';
        cajaCombos.appendChild(linea);
      });
    } else {
      cajaCombos.appendChild(crear('span', 'meta', 'Sin combos cargados'));
    }
    celdaCombos.appendChild(cajaCombos);

    const transferencia = Number(pago.monto_transferencia || 0);
    const efectivo = Number(pago.monto_efectivo || 0);
    const total = Number(pago.total || (transferencia + efectivo));

    const celdaTransferencia = crear('td', 'num');
    celdaTransferencia.appendChild(crear('span', transferencia > 0 ? 'dato-dinero' : 'meta', transferencia > 0 ? dinero(transferencia) : '—'));

    const celdaEfectivo = crear('td', 'num');
    celdaEfectivo.appendChild(crear('span', efectivo > 0 ? 'dato-dinero' : 'meta', efectivo > 0 ? dinero(efectivo) : '—'));

    const celdaTotal = crear('td', 'num');
    celdaTotal.appendChild(crear('span', 'pago-total', dinero(total)));

    const celdaAcciones = crear('td', 'col-acciones');
    const acciones = crear('div', 'acciones-fila');
    acciones.appendChild(botonIcono('editar', 'Editar pago', 'editar', pago.id_reserva, false));
    acciones.appendChild(botonIcono('eliminar', 'Quitar pago', 'eliminar', pago.id_reserva, true));
    celdaAcciones.appendChild(acciones);

    fila.append(celdaFecha, celdaCombos, celdaTransferencia, celdaEfectivo, celdaTotal, celdaAcciones);
    return fila;
  }

  function accionPago(evento) {
    const boton = evento.target.closest('button[data-accion]');
    if (!boton) return;
    const pago = pagosActuales.filter(function (p) {
      return Number(p.id_reserva) === Number(boton.dataset.id);
    })[0];
    if (!pago) return;

    if (boton.dataset.accion === 'editar') abrirPago(pago);
    if (boton.dataset.accion === 'eliminar') pedirQuitarPago(pago);
  }

  function abrirPago(reserva) {
    if (!reserva || !reserva.id_reserva) return;

    estado.reservaPago = reserva;
    const pago = DB.pagoDeReserva(reserva.id_reserva);
    estado.pagoEditando = pago || null;

    const combos = DB.combosDeReserva(reserva.id_reserva);
    const total = redondearMonto(combos.reduce(function (suma, combo) {
      return suma + (Number(combo.cantidad) * Number(combo.precio_unitario));
    }, 0));
    estado.totalPago = Number.isFinite(total) ? total : 0;

    const formulario = $('#form-pago');
    formulario.reset();
    $$('.invalido', formulario).forEach(function (campo) {
      campo.classList.remove('invalido');
      campo.removeAttribute('aria-invalid');
    });
    ocultarError($('#error-pago'));

    renderResumenPago(reserva, combos, estado.totalPago);

    if (pago) {
      $('#titulo-pago').textContent = 'Editar pago';
      $('#subtitulo-pago').textContent = 'Modificá la fecha o cómo se repartió el dinero entregado.';
      $('#btn-guardar-pago').textContent = 'Guardar cambios';
      $('#pa-fecha').value = fechaPagoParaInput(pago.fecha_pago);
      $('#pa-transferencia').value = numeroEditable(pago.monto_transferencia);
      $('#pa-efectivo').value = numeroEditable(pago.monto_efectivo);
      $('#btn-quitar-pago').hidden = false;

      const transferencia = Number(pago.monto_transferencia || 0);
      const efectivo = Number(pago.monto_efectivo || 0);
      const forma = transferencia > 0 && efectivo > 0 ? 'mixto' : efectivo > 0 ? 'efectivo' : 'transferencia';
      const radio = formulario.querySelector('input[name="pa-forma"][value="' + forma + '"]');
      if (radio) radio.checked = true;
    } else {
      $('#titulo-pago').textContent = 'Registrar pago';
      $('#subtitulo-pago').textContent = 'Marcá la reserva como pagada e indicá cómo se entregó el dinero.';
      $('#btn-guardar-pago').textContent = 'Guardar pago';
      $('#pa-fecha').value = fechaParaInput(new Date());
      $('#pa-transferencia').value = numeroEditable(estado.totalPago);
      $('#pa-efectivo').value = '0';
      $('#btn-quitar-pago').hidden = true;
      const radio = formulario.querySelector('input[name="pa-forma"][value="transferencia"]');
      if (radio) radio.checked = true;
    }

    actualizarTotalesPago();
    $('#dlg-pago').showModal();

    setTimeout(function () {
      if (!$('#pa-fecha').value) $('#pa-fecha').focus();
      else $('#pa-transferencia').focus();
    }, 30);
  }

  function renderResumenPago(reserva, combos, total) {
    const caja = $('#resumen-pago');
    caja.replaceChildren();

    const cabecera = crear('div', 'resumen-pago-cab');
    const cliente = crear('div', 'resumen-pago-cliente');
    cliente.appendChild(crear('span', 'nombre-cliente', reserva.apellido + ', ' + reserva.nombre));
    const detalles = [numeroCliente(reserva.id_cliente)];
    const fechaReserva = parseFechaHora(reserva.fecha_reserva);
    if (fechaReserva) detalles.push('Reserva del ' + fechaCorta(fechaReserva) + ' · ' + horaCorta(fechaReserva));
    if (reserva.detalle) detalles.push(reserva.detalle);
    cliente.appendChild(crear('span', 'meta', detalles.join(' · ')));
    cabecera.appendChild(cliente);
    cabecera.appendChild(crear('span', 'badge ' + (reserva.tipo === 'evento' ? 'tipo-evento' : 'tipo-mesa'), reserva.tipo === 'evento' ? 'Evento' : 'Mesa'));
    caja.appendChild(cabecera);

    const lista = crear('div', 'resumen-pago-combos');
    if (combos.length) {
      combos.forEach(function (combo) {
        const linea = crear('div', 'resumen-pago-linea');
        const info = crear('div', 'resumen-pago-linea-info');
        info.appendChild(crear('span', 'nombre-combo', combo.nombre));
        info.appendChild(crear('span', 'meta', combo.cantidad + ' × ' + dinero(combo.precio_unitario) + ' por unidad'));
        linea.appendChild(info);
        linea.appendChild(crear('span', 'dato-fuerte', dinero(combo.cantidad * combo.precio_unitario)));
        lista.appendChild(linea);
      });
    } else {
      lista.appendChild(crear('p', 'sin-combos', 'Esta reserva no tiene combos cargados.'));
    }
    caja.appendChild(lista);

    const pie = crear('div', 'total-combos');
    pie.appendChild(crear('span', '', 'Total de la reserva'));
    pie.appendChild(crear('strong', '', dinero(total)));
    caja.appendChild(pie);
  }

  function aplicarFormaPago() {
    const formulario = $('#form-pago');
    const marcado = formulario.querySelector('input[name="pa-forma"]:checked');
    const forma = marcado ? marcado.value : 'transferencia';
    const total = Number(estado.totalPago || 0);

    if (forma === 'transferencia') {
      $('#pa-transferencia').value = numeroEditable(total);
      $('#pa-efectivo').value = '0';
    } else if (forma === 'efectivo') {
      $('#pa-transferencia').value = '0';
      $('#pa-efectivo').value = numeroEditable(total);
    } else {
      const transferencia = montoEntrada('#pa-transferencia');
      const efectivo = montoEntrada('#pa-efectivo');
      const suma = Number.isFinite(transferencia) && Number.isFinite(efectivo) ? transferencia + efectivo : NaN;
      if (transferencia <= 0 || efectivo <= 0 || !Number.isFinite(suma) || Math.abs(suma - total) > 0.009) {
        const mitad = redondearMonto(total / 2);
        $('#pa-transferencia').value = numeroEditable(mitad);
        $('#pa-efectivo').value = numeroEditable(redondearMonto(total - mitad));
      }
    }

    actualizarTotalesPago();
  }

  function actualizarTotalesPago() {
    const transferencia = montoEntrada('#pa-transferencia');
    const efectivo = montoEntrada('#pa-efectivo');
    const montoTransferencia = Number.isFinite(transferencia) ? transferencia : 0;
    const montoEfectivo = Number.isFinite(efectivo) ? efectivo : 0;
    const totalPago = redondearMonto(montoTransferencia + montoEfectivo);
    const totalReserva = Number(estado.totalPago || 0);

    $('#total-pago-valor').textContent = dinero(totalPago);

    const ayuda = $('#ayuda-pago');
    ayuda.classList.remove('ok', 'alerta');
    const diferencia = redondearMonto(totalReserva - totalPago);

    if (Math.abs(diferencia) < 0.009) {
      ayuda.textContent = totalReserva > 0
        ? 'Pago completo: coincide con el total de la reserva.'
        : 'Esta reserva no tiene combos cargados (total $0).';
      ayuda.classList.add('ok');
    } else if (diferencia > 0) {
      ayuda.textContent = 'Falta ' + dinero(diferencia) + ' para completar el total de ' + dinero(totalReserva) + '.';
      ayuda.classList.add('alerta');
    } else {
      ayuda.textContent = 'Los montos superan el total de la reserva por ' + dinero(-diferencia) + '.';
      ayuda.classList.add('alerta');
    }
  }

  function guardarPago(evento) {
    evento.preventDefault();
    const error = $('#error-pago');
    ocultarError(error);

    const reserva = estado.reservaPago;
    if (!reserva) {
      mostrarError(error, 'No se encontró la reserva del pago.');
      return;
    }

    const fechaTexto = $('#pa-fecha').value;
    if (!fechaTexto) return fallarCampo('#pa-fecha', error, 'Elegí la fecha y hora del pago.');

    const transferencia = montoEntrada('#pa-transferencia');
    if (!Number.isFinite(transferencia) || transferencia < 0) {
      return fallarCampo('#pa-transferencia', error, 'Ingresá un monto válido para la transferencia, por ejemplo 9800 o 9.800,50.');
    }
    const efectivo = montoEntrada('#pa-efectivo');
    if (!Number.isFinite(efectivo) || efectivo < 0) {
      return fallarCampo('#pa-efectivo', error, 'Ingresá un monto válido para el efectivo, por ejemplo 9800 o 9.800,50.');
    }

    const montoTransferencia = redondearMonto(transferencia);
    const montoEfectivo = redondearMonto(efectivo);
    const totalPago = redondearMonto(montoTransferencia + montoEfectivo);
    const totalReserva = Number(estado.totalPago || 0);
    if (Math.abs(totalPago - totalReserva) > 0.009) {
      mostrarError(error, 'Los montos entregados deben sumar exactamente el total de la reserva (' + dinero(totalReserva) + ').');
      return;
    }

    const eraEdicion = Boolean(estado.pagoEditando);
    try {
      DB.guardarPagoReserva(reserva.id_reserva, {
        fecha_pago: fechaTexto,
        monto_transferencia: montoTransferencia,
        monto_efectivo: montoEfectivo
      });
    } catch (excepcion) {
      mostrarError(error, excepcion.message);
      return;
    }

    $('#dlg-pago').close();
    refrescarTodo();
    mostrarToast(eraEdicion ? 'Pago actualizado correctamente.' : 'Pago registrado. La reserva quedó marcada como pagada.');
  }

  function fechaPagoParaInput(valor) {
    const fecha = parseFechaHora(valor);
    return fecha ? fechaParaInput(fecha) : fechaParaInput(new Date());
  }

  function pedirQuitarPagoDesdeDialogo() {
    const reserva = estado.reservaPago;
    if (!reserva) return;
    if ($('#dlg-pago').open) $('#dlg-pago').close();
    pedirQuitarPago(reserva);
  }

  function pedirQuitarPago(reserva) {
    const fecha = parseFechaHora(reserva.fecha_reserva);
    abrirConfirmacion({
      titulo: 'Quitar pago',
      mensaje: 'La reserva de ' + reserva.nombre + ' ' + reserva.apellido +
        (fecha ? ' para el ' + fechaCorta(fecha) + ' a las ' + horaCorta(fecha) : '') +
        ' dejará de figurar como pagada. Los datos de la reserva se conservan.',
      textoAceptar: 'Quitar pago',
      alAceptar: function () {
        DB.eliminarPagoReserva(reserva.id_reserva);
        refrescarTodo();
        mostrarToast('Pago eliminado. La reserva vuelve a quedar sin pagar.', 'info');
      }
    });
  }

  /* ---------- datos de ejemplo ---------- */

  function pedirCargarEjemplo() {
    abrirConfirmacion({
      titulo: 'Cargar datos de ejemplo',
      mensaje: 'Se agregarán 5 clientes, 6 reservas y 5 combos de muestra para que veas cómo funciona la app. Después podés eliminarlos uno por uno.',
      textoAceptar: 'Cargar ejemplo',
      peligro: false,
      alAceptar: function () {
        DB.cargarEjemplo();
        refrescarTodo();
        mostrarToast('Datos de ejemplo cargados.');
      }
    });
  }

  /* ---------- confirmaciones ---------- */

  function abrirConfirmacion(opciones) {
    const dialogo = $('#dlg-confirmar');
    const aceptar = $('#confirmar-aceptar');
    const cancelar = $('#confirmar-cancelar');
    const iconoConfirmar = $('#confirmar-icono');

    $('#confirmar-titulo').textContent = opciones.titulo;
    $('#confirmar-mensaje').textContent = opciones.mensaje;
    iconoConfirmar.classList.toggle('info', Boolean(opciones.soloCerrar || opciones.peligro === false));

    if (opciones.soloCerrar) {
      aceptar.hidden = true;
      cancelar.textContent = 'Entendido';
      accionConfirmar = null;
    } else {
      aceptar.hidden = false;
      aceptar.textContent = opciones.textoAceptar || 'Eliminar';
      aceptar.className = 'btn ' + (opciones.peligro === false ? 'btn-primario' : 'btn-peligro');
      cancelar.textContent = 'Cancelar';
      accionConfirmar = opciones.alAceptar || null;
    }

    if (dialogo.open) dialogo.close();
    dialogo.showModal();
  }

  /* ---------- exportar e importar ---------- */

  function exportarBase() {
    try {
      const bytes = DB.exportar();
      const blob = new Blob([bytes], { type: 'application/x-sqlite3' });
      const url = URL.createObjectURL(blob);
      const enlace = document.createElement('a');
      enlace.href = url;
      enlace.download = 'mesa-y-evento-' + fechaArchivo(new Date()) + '.sqlite';
      document.body.appendChild(enlace);
      enlace.click();
      enlace.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
      mostrarToast('Copia de la base de datos descargada.');
    } catch (error) {
      mostrarToast(error && error.message ? error.message : 'No se pudo exportar la base de datos.', 'error', 6000);
    }
  }

  async function importarBase(evento) {
    const archivo = evento.target.files && evento.target.files[0];
    evento.target.value = '';
    if (!archivo) return;

    let bytes;
    try {
      bytes = new Uint8Array(await archivo.arrayBuffer());
    } catch (error) {
      mostrarToast('No se pudo leer el archivo seleccionado.', 'error');
      return;
    }

    abrirConfirmacion({
      titulo: 'Restaurar base de datos',
      mensaje: 'Se reemplazarán los clientes y reservas actuales por los del archivo “' + archivo.name +
        '”. Te recomendamos exportar una copia antes de continuar.',
      textoAceptar: 'Restaurar',
      alAceptar: async function () {
        await DB.importar(bytes);
        limpiarFiltrosReservas();
        estado.busquedaClientes = '';
        $('#buscar-clientes').value = '';
        refrescarTodo();
        mostrarToast('Base de datos restaurada correctamente.');
      }
    });
  }

  /* ---------- helpers de interfaz ---------- */

  function crear(etiqueta, clase, texto) {
    const elemento = document.createElement(etiqueta);
    if (clase) elemento.className = clase;
    if (texto !== undefined && texto !== null) elemento.textContent = texto;
    return elemento;
  }

  function icono(nombre) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'icono');
    const uso = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    uso.setAttribute('href', '#i-' + nombre);
    svg.appendChild(uso);
    return svg;
  }

  function botonIcono(nombre, titulo, accion, id, peligro) {
    const boton = document.createElement('button');
    boton.type = 'button';
    boton.className = 'btn-icono' + (peligro ? ' peligro' : '');
    boton.dataset.accion = accion;
    boton.dataset.id = id;
    boton.title = titulo;
    boton.setAttribute('aria-label', titulo);
    boton.appendChild(icono(nombre));
    return boton;
  }

  function mostrarError(elemento, mensaje) {
    elemento.textContent = mensaje;
    elemento.hidden = false;
  }

  function ocultarError(elemento) {
    elemento.hidden = true;
    elemento.textContent = '';
  }

  function fallarCampo(selector, cajaError, mensaje) {
    const campo = $(selector);
    if (campo) {
      campo.classList.add('invalido');
      campo.setAttribute('aria-invalid', 'true');
      campo.focus();
    }
    mostrarError(cajaError, mensaje);
  }

  function mostrarToast(mensaje, tipo, duracion) {
    const caja = $('#toasts');
    const clase = tipo === 'error' ? 'error' : tipo === 'info' ? 'info' : '';
    const aviso = crear('div', 'toast' + (clase ? ' ' + clase : ''));
    aviso.appendChild(icono(tipo === 'error' ? 'alerta' : tipo === 'info' ? 'chispa' : 'check'));
    aviso.appendChild(crear('span', '', mensaje));

    while (caja.children.length >= 3) caja.firstElementChild.remove();
    caja.appendChild(aviso);

    const tiempo = duracion || 3600;
    setTimeout(function () {
      aviso.classList.add('saliendo');
      setTimeout(function () { aviso.remove(); }, 220);
    }, tiempo);
  }

  /* ---------- helpers de fecha y texto ---------- */

  function numeroCliente(id) {
    return '#' + String(id).padStart(4, '0');
  }

  const FORMATO_DINERO = new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  });

  const FORMATO_NUMERO = new Intl.NumberFormat('es-AR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  });

  function dinero(valor) {
    const numero = Number(valor);
    return FORMATO_DINERO.format(Number.isFinite(numero) ? numero : 0);
  }

  function numeroEditable(valor) {
    const numero = Number(valor);
    return FORMATO_NUMERO.format(Number.isFinite(numero) ? numero : 0);
  }

  function parsearPrecio(texto) {
    let limpio = String(texto || '').replace(/[^\d.,-]/g, '').trim();
    if (!limpio) return NaN;

    const ultimaComa = limpio.lastIndexOf(',');
    const ultimoPunto = limpio.lastIndexOf('.');

    if (ultimaComa > -1 && ultimoPunto > -1) {
      if (ultimaComa > ultimoPunto) limpio = limpio.replace(/\./g, '').replace(/,/g, '.');
      else limpio = limpio.replace(/,/g, '');
    } else if (ultimaComa > -1) {
      // 9.800,50 ya se resolvió arriba; acá solo hay comas.
      const partes = limpio.split(',');
      limpio = partes.length === 2 && partes[1].length <= 2
        ? partes[0] + '.' + partes[1]
        : limpio.replace(/,/g, '');
    } else if (ultimoPunto > -1) {
      const partes = limpio.split('.');
      // "9.800" se interpreta como miles; "9800.50" como decimales.
      limpio = partes.length > 2 || partes[partes.length - 1].length === 3
        ? limpio.replace(/\./g, '')
        : limpio;
    }

    const numero = Number(limpio);
    return Number.isFinite(numero) ? numero : NaN;
  }

  function iniciales(nombre, apellido) {
    const limpiar = function (texto) {
      return String(texto || '').charAt(0).toUpperCase();
    };
    return (limpiar(nombre) + limpiar(apellido)) || '?';
  }

  function capitalizar(texto) {
    const valor = String(texto || '');
    return valor.charAt(0).toUpperCase() + valor.slice(1);
  }

  function dosDigitos(numero) {
    return String(numero).padStart(2, '0');
  }

  function parseFechaHora(valor) {
    if (!valor) return null;
    const texto = String(valor).trim();
    let partes = texto.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/);
    if (partes) {
      return new Date(Number(partes[1]), Number(partes[2]) - 1, Number(partes[3]), Number(partes[4]), Number(partes[5]), Number(partes[6] || 0));
    }
    partes = texto.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (partes) return new Date(Number(partes[1]), Number(partes[2]) - 1, Number(partes[3]));
    return null;
  }

  function fechaCorta(fecha) {
    return fecha.getDate() + ' ' + MESES[fecha.getMonth()] + ' ' + fecha.getFullYear();
  }

  function horaCorta(fecha) {
    return dosDigitos(fecha.getHours()) + ':' + dosDigitos(fecha.getMinutes());
  }

  function etiquetaRelativa(fecha) {
    const ahora = new Date();
    const hoy = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate());
    const dia = new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate());
    const diferencia = Math.round((dia.getTime() - hoy.getTime()) / 86400000);
    if (diferencia === 0) return 'Hoy';
    if (diferencia === 1) return 'Mañana';
    if (diferencia === -1) return 'Ayer';
    if (diferencia > 1) return 'En ' + diferencia + ' días';
    return 'Hace ' + Math.abs(diferencia) + ' días';
  }

  function fechaParaInput(fecha) {
    return fecha.getFullYear() + '-' + dosDigitos(fecha.getMonth() + 1) + '-' + dosDigitos(fecha.getDate()) +
      'T' + dosDigitos(fecha.getHours()) + ':' + dosDigitos(fecha.getMinutes());
  }

  function fechaArchivo(fecha) {
    return fecha.getFullYear() + '-' + dosDigitos(fecha.getMonth() + 1) + '-' + dosDigitos(fecha.getDate());
  }

  function proximaFechaSugerida() {
    const fecha = new Date();
    fecha.setSeconds(0, 0);
    fecha.setMinutes(fecha.getMinutes() + 120);
    fecha.setMinutes(Math.ceil(fecha.getMinutes() / 30) * 30);
    return fecha;
  }
})();
