/* Genera los PNG de ícono y splash para Android a partir del mismo dibujo
   de cubiertos que usa favicon.svg. Correr con: npm run iconos */

import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = dirname(dirname(fileURLToPath(import.meta.url)));
const carpeta = join(raiz, 'assets');
await mkdir(carpeta, { recursive: true });

const VERDE = '#1f4030';
const CREMA = '#f6f2e7';

const cubiertos = (color) => `
  <g fill="none" stroke="${color}" stroke-width="1.15" stroke-linecap="round" stroke-linejoin="round" transform="translate(3.4 3.4) scale(.72)">
    <path d="M4 2v7a3 3 0 0 0 3 3v10M7 2v7M10 2v7a3 3 0 0 1-3 3M17 2c-1.7 0-3 2.5-3 5.5S15.3 13 17 13v9"/>
  </g>`;

function svgIcono({ fondo, redondeado }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="1024" height="1024">
    <rect width="24" height="24" ${redondeado ? 'rx="5"' : ''} fill="${fondo}"/>
    ${cubiertos(CREMA)}
  </svg>`;
}

function svgSplash({ fondo, color }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="2732" height="2732">
    <rect width="24" height="24" fill="${fondo}"/>
    <g transform="translate(12 12) scale(2.6) translate(-12 -12)">${cubiertos(color)}</g>
  </svg>`;
}

const trabajos = [
  ['icon.png', svgIcono({ fondo: VERDE, redondeado: true })],
  ['icon-only.png', svgIcono({ fondo: VERDE, redondeado: true })],
  ['icon-foreground.png', `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="1024" height="1024">${cubiertos(CREMA)}</svg>`],
  ['icon-background.png', `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="1024" height="1024"><rect width="24" height="24" fill="${VERDE}"/></svg>`],
  ['splash.png', svgSplash({ fondo: '#f6f2ea', color: VERDE })],
  ['splash-dark.png', svgSplash({ fondo: VERDE, color: CREMA })]
];

for (const [nombre, svg] of trabajos) {
  await sharp(Buffer.from(svg)).png().toFile(join(carpeta, nombre));
  console.log('assets/' + nombre);
}
