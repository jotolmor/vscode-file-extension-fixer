// Detección del lenguaje del proyecto: marcadores, frecuencia, acompañantes
// y agregación de subcarpetas, sobre árboles de proyecto simulados.
const path = require('path');
const Module = require('module');

const PROJECT = path.join(__dirname, '..');
const FileType = { Unknown: 0, File: 1, Directory: 2, SymbolicLink: 64 };

let TREE = {};

class FakeUri {
  constructor(scheme, p) { this.scheme = scheme; this.path = p; }
  get fsPath() { return this.path.replace(/^\//, '').replace(/\//g, '\\'); }
  toString() { return `${this.scheme}://${this.path}`; }
}
const uriOf = (winPath) => new FakeUri('file', '/' + winPath.replace(/\\/g, '/'));

const vscode = {
  FileType,
  Uri: { joinPath: (base, ...s) => new FakeUri(base.scheme, path.posix.join(base.path, ...s)) },
  workspace: {
    fs: {
      async readDirectory(uri) {
        const node = TREE[uri.fsPath];
        if (!node) { throw new Error('FileNotFound'); }
        return [
          ...(node.files ?? []).map((n) => [n, FileType.File]),
          ...(node.dirs ?? []).map((n) => [n, FileType.Directory])
        ];
      }
    }
  }
};

const originalLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'vscode') { return vscode; }
  return originalLoad.call(this, request, ...rest);
};

const { detectProjectExtension, clearProjectLanguageCache } = require(path.join(PROJECT, 'out', 'projectLanguage.js'));

// Cada caso: [titulo, arbol, carpeta de partida, raiz, extension esperada]
const CASES = [
  // --- C: fuentes y cabeceras compiten, el fuente debe ganar ---
  ['C: fuentes y cabeceras juntos',
    { 'R': { files: ['main.c', 'main.h', 'utils.c', 'utils.h', 'Makefile'] } }, 'R', 'R', '.c'],
  ['C: un fuente y su cabecera',
    { 'R': { files: ['main.c', 'main.h'] } }, 'R', 'R', '.c'],
  ['C: proyecto recien creado, solo Makefile y README',
    { 'R': { files: ['Makefile', 'README.md'] } }, 'R', 'R', '.c'],
  ['C: fuentes en src/, se crea en la raiz',
    {
      'R': { files: ['Makefile', 'README.md'], dirs: ['src', 'include'] },
      'R\\src': { files: ['main.c', 'io.c', 'net.c'] },
      'R\\include': { files: ['io.h', 'net.h'] }
    }, 'R', 'R', '.c'],
  ['C: solo documentacion en la raiz, fuentes en source/',
    {
      'R': { files: ['README.md', 'CONTRIBUTING.md', 'LICENSE'], dirs: ['source'] },
      'R\\source': { files: ['a.c', 'b.c', 'c.c'] }
    }, 'R', 'R', '.c'],
  ['C: solo cabeceras (carpeta include)',
    { 'R': { files: ['io.h', 'net.h'] } }, 'R', 'R', '.h'],
  ['C: los artefactos de compilacion no cuentan',
    { 'R': { files: ['main.c', 'main.o', 'utils.o', 'app.exe'] } }, 'R', 'R', '.c'],

  // --- C++ ---
  ['C++: CMakeLists con fuentes .cpp/.hpp',
    { 'R': { files: ['CMakeLists.txt', 'main.cpp', 'app.cpp', 'app.hpp'] } }, 'R', 'R', '.cpp'],
  ['C++: Makefile con un unico .cpp y su .hpp',
    { 'R': { files: ['Makefile', 'main.cpp', 'main.hpp'] } }, 'R', 'R', '.cpp'],

  // --- Resto de lenguajes por marcador ---
  ['Rust: Cargo.toml', { 'R': { files: ['Cargo.toml', 'README.md'] } }, 'R', 'R', '.rs'],
  ['Go: go.mod', { 'R': { files: ['go.mod'] } }, 'R', 'R', '.go'],
  ['Java: pom.xml', { 'R': { files: ['pom.xml'] } }, 'R', 'R', '.java'],
  ['PHP: composer.json', { 'R': { files: ['composer.json'] } }, 'R', 'R', '.php'],
  ['Ruby: Gemfile', { 'R': { files: ['Gemfile'] } }, 'R', 'R', '.rb'],
  ['Swift: Package.swift', { 'R': { files: ['Package.swift'] } }, 'R', 'R', '.swift'],
  ['C#: archivo .csproj', { 'R': { files: ['App.csproj'] } }, 'R', 'R', '.cs'],
  ['Python: requirements.txt', { 'R': { files: ['requirements.txt'] } }, 'R', 'R', '.py'],
  ['TypeScript: package.json + tsconfig.json', { 'R': { files: ['package.json', 'tsconfig.json'] } }, 'R', 'R', '.ts'],
  ['JavaScript: package.json sin tsconfig', { 'R': { files: ['package.json'] } }, 'R', 'R', '.js'],
  ['Python gana a package.json incidental',
    { 'R': { files: ['requirements.txt', 'package.json'] } }, 'R', 'R', '.py'],

  // --- Frecuencia, sin marcadores ---
  ['Shell: carpeta de scripts', { 'R': { files: ['deploy.sh', 'build.sh', 'README.md'] } }, 'R', 'R', '.sh'],
  ['SQL: solo consultas', { 'R': { files: ['a.sql', 'b.sql'] } }, 'R', 'R', '.sql'],
  ['Python: acompanantes .pyi no ganan al fuente',
    { 'R': { files: ['app.py', 'app.pyi'] } }, 'R', 'R', '.py'],
  ['Documentacion: extensiones debiles como ultimo recurso',
    { 'R': { files: ['guia.md', 'api.md'] } }, 'R', 'R', '.md'],

  // --- Recorrido hacia la raiz ---
  ['Monorepo: la subcarpeta manda sobre la raiz',
    {
      'R': { files: ['package.json', 'tsconfig.json'], dirs: ['backend'] },
      'R\\backend': { files: ['requirements.txt'], dirs: ['utils'] },
      'R\\backend\\utils': { files: ['a.py', 'b.py'] }
    }, 'R\\backend\\utils', 'R', '.py'],
  ['Empate real: sube al nivel superior',
    {
      'R': { files: ['Cargo.toml'], dirs: ['mixto'] },
      'R\\mixto': { files: ['uno.py', 'dos.js'] }
    }, 'R\\mixto', 'R', '.rs'],
  ['Sin ninguna pista: no decide',
    { 'R': { files: ['LICENSE'] } }, 'R', 'R', undefined],
  ['node_modules no aporta pruebas',
    {
      'R': { files: [], dirs: ['node_modules'] },
      'R\\node_modules': { files: ['a.js', 'b.js', 'c.js'] }
    }, 'R', 'R', undefined],

  // --- Curso de C: un ejercicio por carpeta, con artefactos de MSVC ---
  ['Curso C: subcarpeta de ejercicio nueva y vacia',
    {
      'R': { files: [], dirs: ['.vscode', '01-Introduccion', '02-Variables'] },
      'R\\.vscode': { files: ['tasks.json', 'launch.json'] },
      'R\\01-Introduccion': { files: [], dirs: ['hola_mundo'] },
      'R\\01-Introduccion\\hola_mundo': { files: ['hola_mundo.c', 'hola_mundo.exe', 'hola_mundo.pdb', 'hola_mundo.ilk', 'hola_mundo.obj'] },
      'R\\02-Variables': { files: [], dirs: ['imprimir_varias_variables', 'variables'] },
      'R\\02-Variables\\imprimir_varias_variables': { files: [] },
      'R\\02-Variables\\variables': { files: ['variables.c', 'variables.exe', 'variables.pdb', 'variables.ilk', 'variables.obj'] }
    }, 'R\\02-Variables\\imprimir_varias_variables', 'R', '.c'],
  ['Curso C: los artefactos de MSVC no empatan con el fuente',
    { 'R': { files: ['variables.c', 'variables.exe', 'variables.pdb', 'variables.ilk', 'variables.obj'] } }, 'R', 'R', '.c'],
  ['Curso C: desde la raiz, fuentes a dos niveles',
    {
      'R': { files: [], dirs: ['.vscode', '02-Variables'] },
      'R\\.vscode': { files: ['tasks.json', 'launch.json'] },
      'R\\02-Variables': { files: [], dirs: ['variables'] },
      'R\\02-Variables\\variables': { files: ['variables.c'] }
    }, 'R', 'R', '.c'],
  ['.vscode no aporta pruebas',
    {
      'R': { files: [], dirs: ['.vscode'] },
      'R\\.vscode': { files: ['tasks.json', 'launch.json', 'settings.json'] }
    }, 'R', 'R', undefined],
  ['Carpetas Debug/Release de MSVC ignoradas',
    {
      'R': { files: ['main.c'], dirs: ['Debug'] },
      'R\\Debug': { files: ['a.obj', 'b.obj', 'main.exe'] }
    }, 'R', 'R', '.c']
];

(async () => {
  let failed = 0;
  console.log('== Deteccion del lenguaje del proyecto ==');

  for (const [title, tree, from, root, expected] of CASES) {
    TREE = {};
    for (const [key, value] of Object.entries(tree)) {
      TREE[key.replace(/^R/, 'C:\\proj')] = value;
    }
    clearProjectLanguageCache();

    const actual = await detectProjectExtension(
      uriOf(from.replace(/^R/, 'C:\\proj')),
      uriOf(root.replace(/^R/, 'C:\\proj')),
      () => {}
    );

    if (actual !== expected) {
      failed++;
      console.log(`FAIL  ${title}`);
      console.log(`        => ${actual ?? 'nada'}   (esperado ${expected ?? 'nada'})`);
    }
  }

  console.log(failed === 0 ? `OK    ${CASES.length}/${CASES.length} casos` : `${failed} fallido(s) de ${CASES.length}`);
  process.exit(failed === 0 ? 0 : 1);
})();
