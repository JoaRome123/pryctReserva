/* Arma la carpeta "www" que Capacitor empaqueta dentro del APK.
   Solo copia lo que necesita el navegador: interfaz, estilos, lógica y SQLite.
   Quedan afuera datos.sqlite, respaldos, iniciar.bat, README y node_modules. */

import { cp, mkdir, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = dirname(dirname(fileURLToPath(import.meta.url)));
const destino = join(raiz, 'www');

const archivos = ['index.html', 'favicon.svg'];
const carpetas = ['css', 'js', 'vendor'];

await rm(destino, { recursive: true, force: true });
await mkdir(destino, { recursive: true });

for (const archivo of archivos) {
  await cp(join(raiz, archivo), join(destino, archivo));
}

for (const carpeta of carpetas) {
  await cp(join(raiz, carpeta), join(destino, carpeta), { recursive: true });
}

// Comprobaciones mínimas: el motor de SQLite tiene que viajar en el APK.
const obligatorios = [
  'index.html',
  'css/estilos.css',
  'js/db.js',
  'js/app.js',
  'js/exportar.js',
  'js/nativo.js',
  'vendor/exceljs.min.js',
  'vendor/sql-wasm.js',
  'vendor/sql-wasm.wasm',
  'vendor/sqlite-wasm-base64.js'
];

const faltantes = [];
for (const ruta of obligatorios) {
  try {
    const info = await stat(join(destino, ruta));
    if (!info.isFile() || info.size === 0) faltantes.push(ruta);
  } catch {
    faltantes.push(ruta);
  }
}

if (faltantes.length) {
  console.error('Faltan archivos para empaquetar la app:\n  ' + faltantes.join('\n  '));
  process.exit(1);
}

console.log('Carpeta www lista para Capacitor.');
