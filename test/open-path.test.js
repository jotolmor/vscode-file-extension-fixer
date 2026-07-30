// End-to-end harness: loads the REAL compiled out/extension.js with a stubbed
// vscode API, runs activate(), fires onDidOpenTextDocument and reports exactly
// what the extension did.
const path = require('path');
const Module = require('module');

const PROJECT = path.join(__dirname, '..');
const WORKSPACE = 'C:\\proyecto';

const events = [];
const rename = [];
let infoMessages = [];
let answer = 'Renombrar';
let existingFiles = new Set();

class FakeUri {
  constructor(scheme, p) { this.scheme = scheme; this.path = p; }
  get fsPath() { return this.path.replace(/^\//, '').replace(/\//g, '\\'); }
  toString() { return `${this.scheme}://${this.path}`; }
}

function uriFromWinPath(p) {
  return new FakeUri('file', '/' + p.replace(/\\/g, '/'));
}

let openHandler = null;
const commands = new Map();

const vscode = {
  l10n: { t: (message, ...args) => String(message).replace(/\{(\d+)\}/g, (_, i) => args[i]) },
  Uri: {
    joinPath(base, ...segments) {
      return new FakeUri(base.scheme, path.posix.join(base.path, ...segments));
    }
  },
  window: {
    activeTextEditor: undefined,
    createOutputChannel(name) {
      events.push(`createOutputChannel(${name})`);
      return { appendLine: (m) => events.push(`LOG ${m.replace(/^\[[^\]]+\] /, '')}`), dispose() {} };
    },
    showInformationMessage(message, ...buttons) {
      infoMessages.push(message);
      events.push(`INFO ${message}${buttons.length ? ` [${buttons.join(' | ')}]` : ''}`);
      return Promise.resolve(buttons.length ? answer : undefined);
    },
    showWarningMessage(message) { events.push(`WARN ${message}`); return Promise.resolve(undefined); },
    showErrorMessage(message) { events.push(`ERROR ${message}`); return Promise.resolve(undefined); },
    showQuickPick() { return Promise.resolve(undefined); }
  },
  FileType: { Unknown: 0, File: 1, Directory: 2, SymbolicLink: 64 },
  ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
  workspace: {
    textDocuments: [],
    workspaceFolders: [{ uri: uriFromWinPath(WORKSPACE), name: 'proyecto', index: 0 }],
    getConfiguration() { return { get: (k, d) => d, update: async () => {} }; },
    onDidOpenTextDocument(handler) { openHandler = handler; return { dispose() {} }; },
    onDidCreateFiles() { return { dispose() {} }; },
    createFileSystemWatcher() {
      return {
        onDidCreate() { return { dispose() {} }; },
        onDidChange() { return { dispose() {} }; },
        onDidDelete() { return { dispose() {} }; },
        dispose() {}
      };
    },
    getWorkspaceFolder(uri) {
      return uri.fsPath.toLowerCase().startsWith(WORKSPACE.toLowerCase())
        ? { uri, name: 'proyecto', index: 0 }
        : undefined;
    },
    fs: {
      async stat(uri) {
        if (existingFiles.has(uri.fsPath)) { return { type: 1, size: 0, ctime: 0, mtime: 0 }; }
        const error = new Error('FileNotFound');
        error.code = 'FileNotFound';
        throw error;
      },
      async rename(from, to, options) {
        rename.push({ from: from.fsPath, to: to.fsPath, options });
        events.push(`RENAME ${from.fsPath} -> ${to.fsPath}`);
      }
    }
  },
  commands: {
    registerCommand(id, callback) { commands.set(id, callback); return { dispose() {} }; }
  }
};

const originalLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'vscode') { return vscode; }
  return originalLoad.call(this, request, ...rest);
};

const extension = require(path.join(PROJECT, 'out', 'extension.js'));

function makeDoc(fileName, languageId, overrides = {}) {
  return {
    isUntitled: false,
    isDirty: false,
    languageId,
    fileName,
    uri: uriFromWinPath(fileName),
    ...overrides
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function scenario(title, doc, { manual = false, choice = 'Renombrar', existing = [], alreadyOpen = false } = {}) {
  events.length = 0;
  rename.length = 0;
  infoMessages = [];
  answer = choice;
  existingFiles = new Set(existing);

  // Simulates a document restored in a tab BEFORE the extension activates:
  // onDidOpenTextDocument never fires for it, only the startup scan sees it.
  vscode.workspace.textDocuments = alreadyOpen ? [doc] : [];

  const context = { subscriptions: [] };
  extension.activate(context);

  if (alreadyOpen) {
    await sleep(800);
  } else if (manual) {
    vscode.window.activeTextEditor = { document: doc };
    await commands.get('extension.fixFileExtension')();
  } else {
    openHandler(doc);
    await sleep(800);
  }

  console.log(`\n=== ${title} ===`);
  console.log(`    archivo: ${path.basename(doc.fileName)}  languageId: ${doc.languageId}`);
  for (const line of events) {
    if (line.startsWith('createOutputChannel') || line === 'LOG File Extension Fixer activated.') { continue; }
    console.log(`    ${line}`);
  }
  console.log(`    >>> renombrados: ${rename.length ? rename.map((r) => path.basename(r.to)).join(', ') : 'NINGUNO'}`);

  extension.deactivate();
  for (const subscription of context.subscriptions) { subscription.dispose(); }
  return { events: [...events], rename: [...rename] };
}

(async () => {
  await scenario('A. Coma en vez de punto, detectado como plaintext',
    makeDoc(`${WORKSPACE}\\funcion_bool,py`, 'plaintext'));

  await scenario('B. Sin extension, Python detectado por contenido',
    makeDoc(`${WORKSPACE}\\test`, 'python'));

  await scenario('C. Coma + extension duplicada',
    makeDoc(`${WORKSPACE}\\funcion_bool,py.py`, 'python'));

  await scenario('D. Comando manual sobre archivo con coma',
    makeDoc(`${WORKSPACE}\\funcion_bool,py`, 'plaintext'), { manual: true });

  await scenario('E. Usuario cancela',
    makeDoc(`${WORKSPACE}\\test`, 'python'), { choice: 'Cancelar' });

  await scenario('F. El destino ya existe',
    makeDoc(`${WORKSPACE}\\test`, 'python'), { existing: [`${WORKSPACE}\\test.py`] });

  await scenario('G. Archivo fuera del workspace',
    makeDoc('C:\\otro_sitio\\test', 'python'));

  await scenario('H. Archivo ya correcto',
    makeDoc(`${WORKSPACE}\\main.py`, 'python'));

  await scenario('I. Archivo YA ABIERTO al activarse la extension (tras recargar ventana)',
    makeDoc(`${WORKSPACE}\\funcion_bool,py`, 'plaintext'), { alreadyOpen: true });

  await scenario('J. Archivo abierto suelto, SIN carpeta abierta en VS Code',
    makeDoc('C:\\Users\\jorge\\Downloads\\funcion_bool,py', 'plaintext'), { alreadyOpen: true });
})();
