// Arma release/Market.exe para el PC de recepción: un solo archivo que trae adentro Node
// portátil, el servidor y la vista de recepción ya compilada (ver scripts/pc/Market.cs).
//
// Uso (desde la carpeta market/, en Windows):
//   cd app && npm run build:web && cd ..
//   node scripts/empaquetar-pc.mjs
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const release = path.join(root, 'release');
const build = path.join(release, 'build');
const out = path.join(build, 'Market');
const zip = path.join(build, 'market.zip');
const exe = path.join(release, 'Market.exe');
const csc = path.join(process.env.WINDIR ?? 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');

const [major, minor] = process.versions.node.split('.').map(Number);
if (process.platform !== 'win32') throw new Error('El .exe se arma en Windows.');
if (major < 22 || (major === 22 && minor < 13)) throw new Error('Hace falta Node 22.13 o más nuevo para empaquetar.');
if (!fs.existsSync(csc)) throw new Error(`No se encontró el compilador de C# de Windows (${csc}).`);
if (!fs.existsSync(path.join(root, 'app', 'dist', 'index.html')))
  throw new Error('Falta la vista de recepción compilada: corre "npm run build:web" en app/.');
if (!fs.existsSync(path.join(root, 'server', 'node_modules', 'express')))
  throw new Error('Faltan las librerías del servidor: corre "npm install" en server/.');

console.log('Limpiando release/ …');
fs.rmSync(release, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

const copy = (from, to) => fs.cpSync(path.join(root, from), path.join(out, to), { recursive: true });

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

console.log('Comprimiendo …');
execFileSync('powershell.exe', ['-NoProfile', '-Command', `Compress-Archive -Path '${out}' -DestinationPath '${zip}' -CompressionLevel Optimal`], {
  stdio: 'inherit',
});

console.log('Dibujando el icono …');
const ico = path.join(build, 'market.ico');
execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'scripts', 'pc', 'icono.ps1'), '-Out', ico], {
  stdio: 'inherit',
});

// La versión cambia en cada empaquetado: así Market.exe sabe cuándo reinstalar los archivos.
const version = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
const info = path.join(build, 'BuildInfo.cs');
fs.writeFileSync(info, `static class BuildInfo { public const string Version = "${version}"; }\n`);

console.log('Compilando Market.exe …');
execFileSync(
  csc,
  [
    '/nologo',
    '/target:winexe',
    '/optimize+',
    '/platform:x64',
    `/out:${exe}`,
    `/win32icon:${ico}`,
    `/resource:${zip},market.zip`,
    '/r:System.dll',
    '/r:System.Drawing.dll',
    '/r:System.Windows.Forms.dll',
    '/r:System.IO.Compression.dll',
    '/r:System.IO.Compression.FileSystem.dll',
    path.join(root, 'scripts', 'pc', 'Market.cs'),
    info,
  ],
  { stdio: 'inherit' }
);
const mb = (fs.statSync(exe).size / 1024 / 1024).toFixed(1);
console.log(`Listo: release/Market.exe (${mb} MB, versión ${version})`);
