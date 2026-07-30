// Checks the file-name repair logic against the compiled extension.
// The 'vscode' module is stubbed because it only exists inside the editor.
const path = require('path');
const Module = require('module');

const PROJECT = path.join(__dirname, '..');

const originalLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'vscode') {
    return { FileType: { Unknown: 0, File: 1, Directory: 2, SymbolicLink: 64 }, l10n: { t: (m) => m } };
  }
  return originalLoad.call(this, request, ...rest);
};

const { findSeparatorTypoFix } = require(path.join(PROJECT, 'out', 'extension.js'));

const cases = [
  ['funcion_bool,py', 'funcion_bool.py'],
  ['funcion_bool,py.py', 'funcion_bool.py'],
  ['funcion_bool,PY', 'funcion_bool.PY'],
  ['mi script,js', 'mi script.js'],
  ['año_2026,md', 'año_2026.md'],
  ['a,b,py', 'a,b.py'],
  ['Dockerfile,yml', 'Dockerfile.yml'],
  ['datos,csv', 'datos.csv'],
  ['config;json', 'config.json'],
  ['informe,final', undefined],
  ['notas,v2.md', undefined],
  ['funcion_bool.py', undefined],
  ['funcion_bool', undefined],
  ['.gitignore', undefined],
  [',py', undefined]
];

let failed = 0;
console.log('== Reparacion de nombres de archivo ==');
for (const [input, expected] of cases) {
  const actual = findSeparatorTypoFix(input);
  if (actual !== expected) {
    failed++;
    console.log(`FAIL  ${JSON.stringify(input)} -> ${JSON.stringify(actual)} (esperado ${JSON.stringify(expected)})`);
  }
}

console.log(failed === 0 ? `OK    ${cases.length}/${cases.length} casos` : `${failed} fallido(s) de ${cases.length}`);
process.exit(failed === 0 ? 0 : 1);
