// Elección de lenguaje por carpeta: clave, herencia por ancestro, escritura
// en settings.json, y las preguntas al crear carpetas vacías.
const path = require('path');
const Module = require('module');

const PROJECT = path.join(__dirname, '..');
const ROOT = 'C:\\Curso C';
const FileType = { Unknown: 0, File: 1, Directory: 2, SymbolicLink: 64 };

let TREE = {};
let configStore = {};
let updateCalls = [];
let quickPickAnswer;
let quickPicks = [];
let createHandlers = [];
const events = [];
const renames = [];

class FakeUri {
  constructor(scheme, p) { this.scheme = scheme; this.path = p; }
  get fsPath() { return this.path.replace(/^\//, '').replace(/\//g, '\\'); }
  toString() { return `${this.scheme}://${this.path}`; }
}
const uriOf = (w) => new FakeUri('file', '/' + w.replace(/\\/g, '/'));

const vscode = {
  l10n: { t: (message, ...args) => String(message).replace(/\{(\d+)\}/g, (_, i) => args[i]) },
  FileType,
  ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
  Uri: { joinPath: (b, ...s) => new FakeUri(b.scheme, path.posix.join(b.path, ...s)) },
  window: {
    activeTextEditor: undefined,
    createOutputChannel() { return { appendLine: (m) => events.push(m.replace(/^\[[^\]]+\] /, '')), dispose() {} }; },
    showInformationMessage() { return Promise.resolve(undefined); },
    showWarningMessage() { return Promise.resolve(undefined); },
    showErrorMessage(m) { events.push(`ERROR ${m}`); return Promise.resolve(undefined); },
    showQuickPick(items, options) {
      quickPicks.push({ items, options });
      const picked = quickPickAnswer === undefined ? undefined : items.find((i) => i.value === quickPickAnswer);
      return Promise.resolve(picked);
    }
  },
  workspace: {
    textDocuments: [],
    workspaceFolders: [{ uri: uriOf(ROOT), name: 'Curso C', index: 0 }],
    getConfiguration() {
      return {
        get: (key, fallback) => configStore[key] ?? fallback,
        update: async (key, value, target) => { updateCalls.push({ key, value, target }); configStore[key] = value; }
      };
    },
    onDidOpenTextDocument() { return { dispose() {} }; },
    onDidCreateFiles() { return { dispose() {} }; },
    createFileSystemWatcher() {
      return {
        onDidCreate(h) { createHandlers.push(h); return { dispose() {} }; },
        onDidChange() { return { dispose() {} }; },
        onDidDelete() { return { dispose() {} }; },
        dispose() {}
      };
    },
    getWorkspaceFolder(uri) {
      return uri.fsPath.toLowerCase().startsWith(ROOT.toLowerCase())
        ? { uri: uriOf(ROOT), name: 'Curso C', index: 0 }
        : undefined;
    },
    fs: {
      async readDirectory(uri) {
        const node = TREE[uri.fsPath];
        if (!node) { throw new Error('FileNotFound'); }
        return [
          ...(node.files ?? []).map((n) => [n, FileType.File]),
          ...(node.dirs ?? []).map((n) => [n, FileType.Directory])
        ];
      },
      async stat(uri) {
        const p = uri.fsPath;
        if (TREE[p]) { return { type: FileType.Directory, size: 0, ctime: 0, mtime: 0 }; }
        const parent = TREE[path.dirname(p)];
        if (parent && (parent.files ?? []).includes(path.basename(p))) {
          return { type: FileType.File, size: 0, ctime: 0, mtime: 0 };
        }
        throw new Error('FileNotFound');
      },
      async rename(from, to) { renames.push({ from: from.fsPath, to: to.fsPath }); }
    }
  },
  commands: { registerCommand() { return { dispose() {} }; } }
};

const originalLoad = Module._load;
Module._load = function (r, ...rest) { return r === 'vscode' ? vscode : originalLoad.call(this, r, ...rest); };

const extension = require(path.join(PROJECT, 'out', 'extension.js'));
const folderLanguage = require(path.join(PROJECT, 'out', 'folderLanguage.js'));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;

function check(title, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failed++;
    console.log(`FAIL  ${title}`);
    console.log(`        => ${JSON.stringify(actual)}   (esperado ${JSON.stringify(expected)})`);
  }
}

/** Curso C con un ejercicio ya hecho, para que la deteccion encuentre .c */
function cursoTree() {
  return {
    'C:\\Curso C': { files: [], dirs: ['02-Variables'] },
    'C:\\Curso C\\02-Variables': { files: [], dirs: ['variables'] },
    'C:\\Curso C\\02-Variables\\variables': { files: ['variables.c'] }
  };
}

async function runScenario({ tree, config = {}, answer, created, isDir = true }) {
  TREE = tree;
  configStore = { ...config };
  updateCalls = [];
  quickPicks = [];
  quickPickAnswer = answer;
  createHandlers = [];
  events.length = 0;
  renames.length = 0;

  if (created) {
    const parent = TREE[path.dirname(created)];
    const base = path.basename(created);
    if (isDir) { TREE[created] = { files: [], dirs: [] }; if (parent) { (parent.dirs ??= []).push(base); } }
    else if (parent) { (parent.files ??= []).push(base); }
  }

  const context = { subscriptions: [] };
  extension.activate(context);
  if (created) { for (const h of createHandlers) { h(uriOf(created)); } }
  await sleep(700);
  extension.deactivate();
}

(async () => {
  console.log('== Eleccion de lenguaje por carpeta ==');

  // --- funciones del modulo ---
  check('folderKey de la raiz', folderLanguage.folderKey(uriOf(ROOT), uriOf(ROOT)), '.');
  check('folderKey normaliza los separadores de Windows',
    folderLanguage.folderKey(uriOf(ROOT), uriOf(`${ROOT}\\02-Variables\\ejercicio`)), '02-Variables/ejercicio');

  configStore = { folderLanguages: { '.': '.c', '02-Variables/ejercicio_python': '.py' } };
  check('lee la clave exacta',
    folderLanguage.readFolderLanguage(uriOf(ROOT), uriOf(`${ROOT}\\02-Variables\\ejercicio_python`)), '.py');
  check('hereda del ancestro mas cercano',
    folderLanguage.readFolderLanguage(uriOf(ROOT), uriOf(`${ROOT}\\02-Variables\\ejercicio_python\\sub`)), '.py');
  check('cae en la raiz cuando no hay nada mas concreto',
    folderLanguage.readFolderLanguage(uriOf(ROOT), uriOf(`${ROOT}\\03-Otro`)), '.c');
  check('lee la raiz',
    folderLanguage.readFolderLanguage(uriOf(ROOT), uriOf(ROOT)), '.c');

  configStore = { folderLanguages: {} };
  check('sin nada guardado devuelve undefined',
    folderLanguage.readFolderLanguage(uriOf(ROOT), uriOf(`${ROOT}\\x`)), undefined);

  configStore = { folderLanguages: { '.': '.c' } };
  updateCalls = [];
  await folderLanguage.writeFolderLanguage(uriOf(ROOT), uriOf(`${ROOT}\\a\\b`), '.py');
  check('escribe conservando las claves previas',
    updateCalls[0].value, { '.': '.c', 'a/b': '.py' });
  check('escribe en el ambito WorkspaceFolder', updateCalls[0].target, 3);

  // --- integracion ---
  await runScenario({ tree: cursoTree(), created: 'C:\\Curso C\\02-Variables\\nuevo_ejercicio', answer: '.py' });
  check('pregunta al crear carpeta vacia aunque deduzca el lenguaje', quickPicks.length, 1);
  check('la opcion detectada va primera',
    quickPicks[0]?.items[0]?.value, '.c');
  check('incluye la opcion de deteccion automatica',
    quickPicks[0]?.items.at(-1)?.value, 'auto');
  check('guarda la respuesta bajo la clave de la carpeta',
    updateCalls[0]?.value, { '02-Variables/nuevo_ejercicio': '.py' });

  await runScenario({ tree: cursoTree(), created: 'C:\\Curso C\\02-Variables\\nuevo_ejercicio' });
  check('Escape no guarda nada', updateCalls.length, 0);

  await runScenario({
    tree: cursoTree(),
    config: { folderLanguages: { '.': '.c' } },
    created: 'C:\\Curso C\\02-Variables\\nuevo_ejercicio',
    answer: '.py'
  });
  check('no pregunta si ya hereda una respuesta explicita', quickPicks.length, 0);

  const conArchivo = cursoTree();
  conArchivo['C:\\Curso C\\02-Variables\\ejercicio_python'] = { files: [], dirs: [] };
  conArchivo['C:\\Curso C\\02-Variables'].dirs.push('ejercicio_python');
  await runScenario({
    tree: conArchivo,
    config: { folderLanguages: { '02-Variables/ejercicio_python': '.py' } },
    created: 'C:\\Curso C\\02-Variables\\ejercicio_python\\script',
    isDir: false
  });
  check('la eleccion guardada gana a la deteccion al crear un archivo',
    renames.length ? path.basename(renames[0].to) : null, 'script.py');

  await runScenario({
    tree: cursoTree(),
    config: { folderLanguages: { '.': 'auto' } },
    created: 'C:\\Curso C\\02-Variables\\variables\\nuevo',
    isDir: false
  });
  check("'auto' vuelve a la deteccion automatica",
    renames.length ? path.basename(renames[0].to) : null, 'nuevo.c');

  console.log(failed === 0 ? 'OK    todos los casos' : `${failed} fallido(s)`);
  process.exit(failed === 0 ? 0 : 1);
})();
