// Arma la carpeta "Market" para el PC de recepción: Node portátil + servidor + vista de
// recepción ya compilada + un .bat que lo levanta todo y abre el navegador. Al final la
// comprime en release/Market-PC.zip, lista para enviar.
//
// Uso (desde la carpeta market/):
//   cd app && npm run build:web && cd ..
//   node scripts/empaquetar-pc.mjs
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const release = path.join(root, 'release');
const out = path.join(release, 'Market');
const zip = path.join(release, 'Market-PC.zip');

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 13)) throw new Error('Hace falta Node 22.13 o más nuevo para empaquetar.');
if (!fs.existsSync(path.join(root, 'app', 'dist', 'index.html')))
  throw new Error('Falta la vista de recepción compilada: corre "npm run build:web" en app/.');
if (!fs.existsSync(path.join(root, 'server', 'node_modules', 'express')))
  throw new Error('Faltan las librerías del servidor: corre "npm install" en server/.');

console.log('Limpiando release/ …');
fs.rmSync(release, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

const copy = (from, to, filter) => fs.cpSync(path.join(root, from), path.join(out, to), { recursive: true, filter });

console.log(`Copiando Node ${process.version} …`);
fs.mkdirSync(path.join(out, 'node'));
fs.copyFileSync(process.execPath, path.join(out, 'node', 'node.exe'));

console.log('Copiando el servidor …');
copy('server/src', 'server/src');
copy('server/package.json', 'server/package.json');
copy('server/node_modules', 'server/node_modules');
// La base de datos no se copia: se crea limpia la primera vez que se abre.

console.log('Copiando la vista de recepción …');
copy('app/dist', 'app/dist');
// El servidor crea los bloques, habitaciones y productos desde este catálogo.
copy('app/src/catalog.json', 'app/src/catalog.json');

// Los .bat van en ASCII con saltos de línea de Windows.
const bat = (lines) => lines.join('\r\n') + '\r\n';

fs.writeFileSync(
  path.join(out, 'Iniciar Market.bat'),
  bat([
    '@echo off',
    'title Market',
    'cd /d "%~dp0"',
    'rem Si el servidor ya esta corriendo, solo se abre el navegador.',
    'node\\node.exe -e "fetch(\'http://localhost:4000/api/health\').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"',
    'if errorlevel 1 (',
    '  echo Iniciando el servidor de Market...',
    '  start "Market - servidor (no cerrar)" /min node\\node.exe --no-warnings server\\src\\index.js',
    '  node\\node.exe -e "let n=0;const t=()=>fetch(\'http://localhost:4000/api/health\').then(()=>process.exit(0),()=>++n>40?process.exit(1):setTimeout(t,250));t()"',
    ')',
    'start "" "http://localhost:4000/?rol=recepcion"',
  ])
);

fs.writeFileSync(
  path.join(out, 'Detener Market.bat'),
  bat([
    '@echo off',
    'taskkill /fi "WINDOWTITLE eq Market - servidor (no cerrar)*" /t /f >nul 2>&1',
    'echo Market se detuvo.',
    'ping -n 3 127.0.0.1 >nul',
  ])
);

// Excel de ejemplo para probar la carga de salidas.
const require = createRequire(path.join(root, 'server', 'package.json'));
const XLSX = require('xlsx');
const sample = [
  ['Habitación', 'Huésped', 'Hora de vuelo', 'Trabajador', 'Doble ciclo', 'Pendiente por salir'],
  ['C104', 'Laura Gómez', '10:30', '', '', ''],
  ['C117', 'Andrés Restrepo', '12:15', '', 'X', ''],
  ['C205', 'Camila Ríos', '14:00', '', '', ''],
  ['C312', 'John Miller', '06:45', '', '', 'X'],
  ['K105', 'Valentina Cruz', '16:30', '', '', ''],
  ['K210', 'Santiago Mejía', '09:15', '', '', ''],
  ['L201', 'Sofía Herrera', '11:00', '', '', ''],
  ['L306', 'Mateo Vargas', '18:00', '', '', ''],
  ['BW126', 'Isabella Torres', '13:45', '', '', ''],
  ['BW239', 'Daniel Ortiz', '17:30', '', 'X', ''],
  ['BW352', 'Mariana López', '10:00', '', '', ''],
  ['BW460', 'Felipe Castro', '19:30', '', '', ''],
  ['R733', 'Emma Wilson', '15:45', '', '', ''],
  ['R829', 'Juan Pablo Ruiz', '21:00', '', '', ''],
];
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sample), 'Salidas');
XLSX.writeFile(wb, path.join(out, 'Ejemplo de salidas.xlsx'));

fs.writeFileSync(
  path.join(out, 'LEEME.txt'),
  '﻿' +
    [
      'MARKET · Recepción',
      '',
      'Cómo abrirlo',
      '  1. Doble clic en "Iniciar Market.bat".',
      '     Se abre una ventana minimizada (el servidor) y el navegador con la vista de recepción.',
      '  2. La primera vez, Windows puede preguntar si Node.js puede usar la red: elige "Permitir".',
      '     Así las tablets de la misma red encuentran este PC solas.',
      '',
      'Cómo cerrarlo',
      '  Doble clic en "Detener Market.bat" (o cierra la ventana "Market - servidor").',
      '',
      'Para probar',
      '  En Habitaciones, botón "Cargar salidas (Excel)", elige "Ejemplo de salidas.xlsx".',
      '  Esas habitaciones quedan "por revisar".',
      '',
      'Datos',
      '  Todo se guarda en la carpeta server\\data (se crea sola la primera vez).',
      '  Para empezar de cero, cierra Market y borra esa carpeta.',
      '',
      'No hace falta instalar nada: Node ya viene en la carpeta "node".',
    ].join('\r\n') +
    '\r\n'
);

console.log('Comprimiendo Market-PC.zip …');
execFileSync(
  'powershell.exe',
  ['-NoProfile', '-Command', `Compress-Archive -Path '${out}' -DestinationPath '${zip}' -CompressionLevel Optimal`],
  { stdio: 'inherit' }
);
const mb = (fs.statSync(zip).size / 1024 / 1024).toFixed(1);
console.log(`Listo: release/Market-PC.zip (${mb} MB)`);
