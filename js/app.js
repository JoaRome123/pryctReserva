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
    editandoCliente: null,
    editandoReserva: null,
    clienteDesdeReserva: false,
    ultimoAlmacen: null
  };

  let reservasActuales = [];
  let clientesActuales = [];
  let accionConfirmar = null;
  let temporizadorBusqueda = null;

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

    $$('#form-cliente input, #form-reserva input, #form-reserva select, #form-reserva textarea').forEach(function (campo) {
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
    $('#vista-clientes').hidden = vista !== 'clientes';
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
    $('#contador-clientes').textContent = estadisticas.clientes;

    renderReservas();
    renderClientes();
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

    /* acciones */
    const celdaAcciones = document.createElement('td');
    celdaAcciones.className = 'col-acciones';
    const acciones = crear('div', 'acciones-fila');
    acciones.appendChild(botonIcono('editar', 'Editar reserva', 'editar', reserva.id_reserva, false));
    acciones.appendChild(botonIcono('eliminar', 'Eliminar reserva', 'eliminar', reserva.id_reserva, true));
    celdaAcciones.appendChild(acciones);

    fila.append(celdaCliente, celdaFecha, celdaTipo, celdaPersonas, celdaDetalle, celdaEstado, celdaAcciones);
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
      notas: $('#re-notas').value
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

  /* ---------- datos de ejemplo ---------- */

  function pedirCargarEjemplo() {
    abrirConfirmacion({
      titulo: 'Cargar datos de ejemplo',
      mensaje: 'Se agregarán 5 clientes y 6 reservas de muestra para que veas cómo funciona la app. Después podés eliminarlos uno por uno.',
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
