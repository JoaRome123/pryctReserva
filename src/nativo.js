/* ============================================================
   Mesa & Evento — puente con Android (Capacitor)

   Este archivo se compila con esbuild y queda como js/nativo.js.
   En la PC (Chrome/Edge/Firefox) no hace nada: la app sigue
   funcionando como siempre. En el APK agrega:
     · barra de estado y áreas seguras
     · botón "atrás" de Android (cierra diálogos)
     · exportar la copia .sqlite con el selector de Android
   ============================================================ */

import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { StatusBar, Style } from '@capacitor/status-bar';

const esNativo = Capacitor.isNativePlatform();
window.__ES_NATIVO__ = esNativo;

function bytesABase64(bytes) {
  let binario = '';
  const trozo = 0x8000;
  for (let i = 0; i < bytes.length; i += trozo) {
    binario += String.fromCharCode.apply(null, bytes.subarray(i, i + trozo));
  }
  return btoa(binario);
}

/* Guarda la copia en la memoria temporal de la app y abre el menú de Android
   para que el usuario elija dónde dejarla (Archivos, Drive, WhatsApp, etc.). */
async function guardarCopia(bytes, nombre) {
  const datos = bytesABase64(bytes);
  const ruta = 'respaldos/' + nombre;

  await Filesystem.writeFile({
    path: ruta,
    data: datos,
    directory: Directory.Cache,
    recursive: true
  });

  const archivo = await Filesystem.getUri({ path: ruta, directory: Directory.Cache });

  let errorCompartir = null;
  try {
    const resultado = await Share.canShare();
    if (resultado && resultado.value) {
      await Share.share({
        title: nombre,
        text: 'Copia de la base de datos de Mesa & Evento',
        url: archivo.uri,
        dialogTitle: 'Guardar o compartir la copia'
      });
      return { compartido: true };
    }
  } catch (error) {
    // Si el usuario cierra el menú de compartir, no es un error.
    if (/cancel/i.test(String((error && error.message) || ''))) throw error;
    errorCompartir = error;
  }

  // Si el teléfono no ofrece el menú de compartir, dejamos la copia en Documentos.
  try {
    const guardado = await Filesystem.writeFile({
      path: 'Mesa y Evento/' + nombre,
      data: datos,
      directory: Directory.Documents,
      recursive: true
    });
    return { compartido: false, uri: guardado.uri };
  } catch (error) {
    throw errorCompartir || error;
  }
}

function hayDialogoAbierto() {
  const abiertos = document.querySelectorAll('dialog.dialogo[open]');
  if (!abiertos.length) return false;
  abiertos[abiertos.length - 1].close();
  return true;
}

async function preparar() {
  document.documentElement.classList.add('es-nativo');

  try {
    await StatusBar.setOverlaysWebView({ overlay: false });
    await StatusBar.setBackgroundColor({ color: '#1f4030' });
    await StatusBar.setStyle({ style: Style.Dark });
  } catch (error) {
    // La barra de estado puede no estar disponible en algunos equipos.
  }

  // En Android el selector de archivos no reconoce ".sqlite" por su tipo MIME:
  // permitimos cualquier archivo y la app valida que sea una base SQLite real.
  const entrada = document.getElementById('input-importar');
  if (entrada) entrada.setAttribute('accept', '*/*');

  App.addListener('backButton', function () {
    if (hayDialogoAbierto()) return;
    App.exitApp();
  });
}

window.NATIVO = {
  activo: esNativo,
  guardarCopia: esNativo ? guardarCopia : null,
  salir: function () { App.exitApp(); }
};

if (esNativo) {
  preparar().catch(function (error) {
    console.warn('No se pudo preparar la app para Android:', error);
  });
}
