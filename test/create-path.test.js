// Exercises the CREATION path (project-language detection) of the real
// compiled extension against a fake monorepo tree.
const path = require('path');
const Module = require('module');

const PROJECT = path.join(__dirname, '..');
const ROOT = 'C:\\proyecto';

// dir -> { files: [...], dirs: [...] }
const TREE = {
  'C:\\proyecto': { files: ['package.json', 'tsconfig.json', 'README.md'], dirs: ['backend', 'frontend', 'docs', 'mixto', 'suelto'] },
  'C:\\proyecto\\backend': { files: ['requirements.txt'], dirs: ['utils'] },
  'C:\\proyecto\\backend\\utils': { files: ['a.py', 'b.py', 'c.py', 'test.py'], dirs: [] },
  'C:\\proyecto\\frontend': { files: ['package.json', 'tsconfig.json', 'app.ts'], dirs: [] },
  'C:\\proyecto\\docs': { files: ['guia.md', 'api.md', 'faq.md'], dirs: [] },
  'C:\\proyecto\\mixto': { files: ['uno.py', 'dos.js'], dirs: [] },
  'C:\\proyecto\\suelto': { files: ['s1.rb', 's2.rb', 's3.rb'], dirs: [] }
};

const FileType = { Unknown: 0, File: 1, Directory: 2, SymbolicLink: 64 };

class FakeUri {
  constructor(scheme, p) { this.scheme = scheme; this.path = p; }
  get fsPath() { return this.path.replace(/^\//, '').replace(/\//g, '\\'); }
  toString() { return `${this.scheme}://${this.path}`; }
}
const uriOf = (winPath) => new FakeUri('file', '/' + winPath.replace(/\\/g, '/'));

const events = [];
const renames = [];
let undoAnswer = undefined;
let createHandlers = [];
let onDidCreateFilesHandler = null;
let configStore = {};
let quickPickAnswer = undefined;
const quickPicks = [];

const vscode = {
  l10n: { t: (message, ...args) => String(message).replace(/\{(\d+)\}/g, (_, i) => args[i]) },
  FileType,
  Uri: {
    joinPath(base, ...segments) { return new FakeUri(base.scheme, path.posix.join(base.path, ...segments)); }
  },
  window: {
    activeTextEditor: undefined,
    createOutputChannel() { return { appendLine: (m) => events.push(`LOG ${m.replace(/^\[[^\]]+\] /, '')}`), dispose() {} }; },
    showInformationMessage(message, ...buttons) {
      events.push(`INFO ${message}`);
      return Promise.resolve(buttons.length ? undoAnswer : undefined);
    },
    showWarningMessage(m) { events.push(`WARN ${m}`); return Promise.resolve(undefined); },
    showErrorMessage(m) { events.push(`ERROR ${m}`); return Promise.resolve(undefined); },
    showQuickPick(items, options) {
      quickPicks.push({ items, options });
      events.push(`QUICKPICK ${options?.placeHolder ?? ''}`);
      const picked = quickPickAnswer === undefined
        ? undefined
        : items.find((i) => i.value === quickPickAnswer);
      return Promise.resolve(picked);
    }
  },
  ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
  workspace: {
    textDocuments: [],
    workspaceFolders: [{ uri: uriOf(ROOT), name: 'proyecto', index: 0 }],
    getConfiguration() {
      return {
        get(key, fallback) { return configStore[key] ?? fallback; },
        async update(key, value) { configStore[key] = value; }
      };
    },
    onDidOpenTextDocument() { return { dispose() {} }; },
    onDidCreateFiles(handler) { onDidCreateFilesHandler = handler; return { dispose() {} }; },
    createFileSystemWatcher() {
      return {
        onDidCreate(handler) { createHandlers.push(handler); return { dispose() {} }; },
        onDidChange() { return { dispose() {} }; },
        onDidDelete() { return { dispose() {} }; },
        dispose() {}
      };
    },
    getWorkspaceFolder(uri) {
      return uri.fsPath.toLowerCase().startsWith(ROOT.toLowerCase())
        ? { uri: uriOf(ROOT), name: 'proyecto', index: 0 }
        : undefined;
    },
    fs: {
      async readDirectory(uri) {
        const node = TREE[uri.fsPath];
        if (!node) { throw new Error('FileNotFound'); }
        return [
          ...node.files.map((n) => [n, FileType.File]),
          ...node.dirs.map((n) => [n, FileType.Directory])
        ];
      },
      async stat(uri) {
        const p = uri.fsPath;
        if (TREE[p]) { return { type: FileType.Directory, size: 0, ctime: 0, mtime: 0 }; }
        const parent = TREE[path.dirname(p)];
        if (parent && parent.files.includes(path.basename(p))) {
          return { type: FileType.File, size: 0, ctime: 0, mtime: 0 };
        }
        throw new Error('FileNotFound');
      },
      async rename(from, to) {
        renames.push({ from: from.fsPath, to: to.fsPath });
        events.push(`RENAME ${path.basename(from.fsPath)} -> ${path.basename(to.fsPath)}`);
      }
    }
  },
  commands: { registerCommand() { return { dispose() {} }; } }
};

const originalLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'vscode') { return vscode; }
  return originalLoad.call(this, request, ...rest);
};

const extension = require(path.join(PROJECT, 'out', 'extension.js'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function createScenario(title, winPath, { isDir = false, undo = undefined, expect } = {}) {
  events.length = 0;
  renames.length = 0;
  quickPicks.length = 0;
  undoAnswer = undo;
  createHandlers = [];
  configStore = {};
  quickPickAnswer = undefined;

  // Register the file in the fake tree so stat() sees a real file.
  const parent = TREE[path.dirname(winPath)];
  const base = path.basename(winPath);
  if (isDir) { TREE[winPath] = { files: [], dirs: [] }; if (parent) { parent.dirs.push(base); } }
  else if (parent && !parent.files.includes(base)) { parent.files.push(base); }

  const context = { subscriptions: [] };
  extension.activate(context);
  for (const handler of createHandlers) { handler(uriOf(winPath)); }
  await sleep(700);

  const got = renames.length ? path.basename(renames[0].to) : null;
  const ok = got === (expect ?? null);
  console.log(`${ok ? 'OK  ' : 'FAIL'}  ${title}`);
  console.log(`        crear ${winPath.replace(ROOT, '<root>')}  =>  ${got ?? 'sin cambios'}   (esperado ${expect ?? 'sin cambios'})`);
  if (!ok) { for (const e of events) { console.log(`        ${e}`); } }

  extension.deactivate();
  // Roll back the fake tree.
  if (isDir) { delete TREE[winPath]; if (parent) { parent.dirs = parent.dirs.filter((d) => d !== base); } }
  else if (parent) { parent.files = parent.files.filter((f) => f !== base); }
  return ok;
}

(async () => {
  const results = [];
  results.push(await createScenario('Monorepo: subcarpeta Python gana a la raiz TypeScript',
    `${ROOT}\\backend\\utils\\nuevo`, { expect: 'nuevo.py' }));

  results.push(await createScenario('Monorepo: backend/ con requirements.txt',
    `${ROOT}\\backend\\nuevo`, { expect: 'nuevo.py' }));

  results.push(await createScenario('Monorepo: frontend/ con package.json + tsconfig.json',
    `${ROOT}\\frontend\\nuevo`, { expect: 'nuevo.ts' }));

  results.push(await createScenario('Raiz: package.json + tsconfig.json',
    `${ROOT}\\nuevo`, { expect: 'nuevo.ts' }));

  results.push(await createScenario('Sin marcadores: gana la extension mas frecuente (.rb)',
    `${ROOT}\\suelto\\nuevo`, { expect: 'nuevo.rb' }));

  results.push(await createScenario('Solo documentacion: extensiones debiles como ultimo recurso',
    `${ROOT}\\docs\\nuevo`, { expect: 'nuevo.md' }));

  results.push(await createScenario('Empate 1 .py / 1 .js: sube a la raiz y usa su marcador',
    `${ROOT}\\mixto\\nuevo`, { expect: 'nuevo.ts' }));

  results.push(await createScenario('Nombre protegido: README no se toca',
    `${ROOT}\\backend\\README`, { expect: null }));

  results.push(await createScenario('Nombre protegido: Dockerfile no se toca',
    `${ROOT}\\backend\\Dockerfile`, { expect: null }));

  results.push(await createScenario('Se crea una CARPETA, no un archivo',
    `${ROOT}\\backend\\nuevacarpeta`, { isDir: true, expect: null }));

  results.push(await createScenario('Archivo con extension ya puesta',
    `${ROOT}\\backend\\script.py`, { expect: null }));

  results.push(await createScenario('Dotfile',
    `${ROOT}\\backend\\.env`, { expect: null }));

  results.push(await createScenario('Separador con coma: se delega al camino con confirmacion',
    `${ROOT}\\backend\\funcion_bool,py`, { expect: null }));

  results.push(await createScenario('El destino ya existe: no sobrescribe',
    `${ROOT}\\backend\\utils\\test`, { expect: null }));

  results.push(await createScenario('Dentro de node_modules: ignorado',
    `${ROOT}\\node_modules\\paquete`, { expect: null }));

  results.push(await createScenario('Fuera del workspace',
    'C:\\otro\\nuevo', { expect: null }));

  const failed = results.filter((r) => !r).length;
  console.log(failed === 0 ? `\nTODOS OK (${results.length} escenarios)` : `\n${failed} FALLIDO(S) de ${results.length}`);
  process.exit(failed === 0 ? 0 : 1);
})();
