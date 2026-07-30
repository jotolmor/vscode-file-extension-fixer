import * as path from 'path';
import * as vscode from 'vscode';
import {
    clearProjectLanguageCache,
    detectProjectExtension,
    isInsideIgnoredDirectory,
    MARKER_FILE_NAMES
} from './projectLanguage';
import {
    AUTOMATIC,
    folderKey,
    LANGUAGE_CHOICES,
    readFolderLanguage,
    writeFolderLanguage
} from './folderLanguage';

/**
 * VS Code needs a moment after `onDidOpenTextDocument` to settle on the final
 * languageId (content-based detection and the `files.associations` setting are
 * applied asynchronously). Inspecting the document too early yields
 * 'plaintext' for files that will actually be detected as Python, JSON, etc.
 */
const LANGUAGE_DETECTION_DELAY_MS = 500;

/**
 * Maps a VS Code languageId to the file extension it should carry on disk.
 * The leading dot is part of the value so the mapping stays explicit.
 * 'dockerfile' is intentionally absent: it is handled as a special case
 * because the canonical name is `Dockerfile`, with no extension at all.
 */
const LANGUAGE_EXTENSION_MAP: Readonly<Record<string, string>> = {
    typescript: '.ts',
    typescriptreact: '.tsx',
    javascript: '.js',
    javascriptreact: '.jsx',
    python: '.py',
    php: '.php',
    java: '.java',
    csharp: '.cs',
    cpp: '.cpp',
    c: '.c',
    html: '.html',
    css: '.css',
    scss: '.scss',
    less: '.less',
    json: '.json',
    jsonc: '.json',
    yaml: '.yml',
    markdown: '.md',
    shellscript: '.sh',
    powershell: '.ps1',
    sql: '.sql',
    rust: '.rs',
    go: '.go',
    ruby: '.rb',
    swift: '.swift',
    kotlin: '.kt',
    xml: '.xml',
    lua: '.lua',
    perl: '.pl',
    r: '.r',
    vue: '.vue',
    ini: '.ini',
    toml: '.toml'
};

/** languageId used by Docker files; renamed to DOCKERFILE_TARGET_NAME. */
const DOCKERFILE_LANGUAGE_ID = 'dockerfile';
const DOCKERFILE_TARGET_NAME = 'Dockerfile';

/**
 * Languages that carry no reliable extension information. 'plaintext' is the
 * fallback VS Code assigns when detection fails, so acting on it would rename
 * arbitrary files to '.txt' against the user's intent.
 */
const IGNORED_LANGUAGE_IDS: ReadonlySet<string> = new Set([
    'plaintext',
    'log',
    'binary',
    'code-text-binary'
]);

/**
 * Document URI schemes that never map to a real, renameable workspace file
 * (diff views, SCM previews, output panes, in-memory buffers...).
 */
const RENAMEABLE_SCHEMES: ReadonlySet<string> = new Set(['file', 'vscode-remote']);

/** Only alphanumeric characters and dots are accepted in a computed extension. */
const SAFE_EXTENSION_PATTERN = /^\.[A-Za-z0-9]+(\.[A-Za-z0-9]+)*$/;

/**
 * Extensions the separator repair is allowed to reconstruct. Derived from the
 * language map so both stay in sync, plus a few common non-source extensions.
 * The whitelist is what keeps 'informe,final' from becoming 'informe.final'.
 */
const KNOWN_EXTENSIONS: ReadonlySet<string> = new Set<string>([
    ...Object.values(LANGUAGE_EXTENSION_MAP).map((extension) => extension.slice(1)),
    'txt',
    'csv',
    'tsv',
    'log',
    'env',
    'cfg',
    'conf',
    'bat',
    'cmd',
    'h',
    'hpp',
    'cxx',
    'cc',
    'mjs',
    'cjs',
    'mts',
    'cts',
    'yaml',
    'htm',
    'sass',
    'svg',
    'txt'
]);

/**
 * A name such as 'funcion_bool,py' where the extension dot was mistyped. On
 * Spanish keyboard layouts the numeric keypad decimal key emits ',', so this
 * is a frequent typo. ';' is included because it shares the same physical key
 * region. The capture group is the intended extension.
 */
const SEPARATOR_TYPO_PATTERN = /^(.+)[,;]([A-Za-z0-9]{1,10})$/;

/**
 * A name such as 'funcion_bool,py.py', produced when a correct extension was
 * appended on top of a mistyped one. The backreference forces both tokens to
 * be the same extension, so 'notas,v2.md' is left alone.
 */
const DUPLICATED_SEPARATOR_TYPO_PATTERN = /^(.+)[,;]([A-Za-z0-9]{1,10})\.\2$/i;

/**
 * Grace period after a file is created, before the project-language rename is
 * applied. Editors and tools create short-lived probe files without extensions
 * (vim writes a '4913' file to test writability); waiting and re-checking that
 * the file still exists filters them out.
 */
const CREATION_SETTLE_DELAY_MS = 300;

/**
 * Extensionless file names that are conventional and must never gain an
 * extension. Without this list, creating a README in a Python project would
 * produce 'README.py'. Compared case-insensitively.
 */
const PROTECTED_BASE_NAMES: ReadonlySet<string> = new Set([
    'readme',
    'license',
    'licence',
    'copying',
    'changelog',
    'contributing',
    'authors',
    'notice',
    'version',
    'install',
    'todo',
    'makefile',
    'dockerfile',
    'containerfile',
    'procfile',
    'codeowners',
    'jenkinsfile',
    'vagrantfile',
    'brewfile',
    'gemfile',
    'rakefile'
]);

/** Output channel shared by every log call; created in `activate`. */
let outputChannel: vscode.OutputChannel | undefined;

/**
 * URIs already handled in this session (either renamed, skipped or declined).
 * Prevents the automatic listener from re-prompting for the same file every
 * time the editor is reopened or the document is re-parsed.
 */
const processedUris = new Set<string>();

/** Pending detection timers, cleared on deactivate to avoid leaking callbacks. */
const pendingTimers = new Set<ReturnType<typeof setTimeout>>();

function log(message: string): void {
    const timestamp = new Date().toISOString();
    outputChannel?.appendLine(`[${timestamp}] ${message}`);
}

/**
 * Rejects anything that could escape the containing directory or inject path
 * separators. The extension value comes from our own constant map, so this is
 * defence in depth rather than input sanitisation.
 */
function isSafeExtension(extension: string): boolean {
    if (extension.includes('..') || extension.includes('/') || extension.includes('\\')) {
        return false;
    }
    return SAFE_EXTENSION_PATTERN.test(extension);
}

/**
 * Same traversal guarantees as `isSafeExtension`, applied to a bare file name.
 * Accented letters and spaces are allowed on purpose: they are legitimate in
 * file names and rejecting them would break real-world renames. What must be
 * impossible is escaping the parent directory or injecting reserved characters.
 */
function isSafeFileName(fileName: string): boolean {
    if (fileName.length === 0 || fileName === '.' || fileName === '..') {
        return false;
    }
    if (fileName.includes('..') || fileName.includes('/') || fileName.includes('\\')) {
        return false;
    }
    // Reject control characters without embedding any in the source, then the
    // characters reserved by the Windows filesystem.
    for (let index = 0; index < fileName.length; index++) {
        if (fileName.charCodeAt(index) < 32) {
            return false;
        }
    }
    return !/[<>:"|?*]/.test(fileName);
}

/**
 * Detects a file name whose extension separator was mistyped and returns the
 * corrected name, or undefined when the name looks intentional.
 *
 * This check runs before the languageId logic on purpose: VS Code cannot infer
 * a language from 'funcion_bool,py' by name, so it often reports 'plaintext'
 * and the language-based path would never fire. The intent is in the name.
 */
export function findSeparatorTypoFix(currentName: string): string | undefined {
    // Checked first: 'name,py.py' also matches the single-typo pattern, and
    // collapsing it to 'name.py' is the better repair.
    const duplicated = DUPLICATED_SEPARATOR_TYPO_PATTERN.exec(currentName);
    if (duplicated) {
        const [, base, extension] = duplicated;
        if (KNOWN_EXTENSIONS.has(extension.toLowerCase())) {
            return `${base}.${extension}`;
        }
    }

    const single = SEPARATOR_TYPO_PATTERN.exec(currentName);
    if (single) {
        const [, base, extension] = single;
        if (KNOWN_EXTENSIONS.has(extension.toLowerCase())) {
            return `${base}.${extension}`;
        }
    }

    return undefined;
}

async function uriExists(uri: vscode.Uri): Promise<boolean> {
    try {
        await vscode.workspace.fs.stat(uri);
        return true;
    } catch {
        // `stat` throws FileNotFound when the target is free; that is the
        // expected happy path here.
        return false;
    }
}

/**
 * Stricter than `uriExists`: the file watcher reports directories too, and
 * renaming a newly created folder would be destructive.
 */
async function isExistingFile(uri: vscode.Uri): Promise<boolean> {
    try {
        const stat = await vscode.workspace.fs.stat(uri);
        return stat.type === vscode.FileType.File;
    } catch {
        return false;
    }
}

/**
 * Performs the rename and keeps the URI bookkeeping consistent. The
 * destination is registered before the operation because creating it fires the
 * file watcher, which would otherwise process the result all over again.
 */
async function applyRename(
    sourceUri: vscode.Uri,
    targetUri: vscode.Uri,
    currentName: string,
    targetName: string
): Promise<boolean> {
    const targetKey = targetUri.toString();
    processedUris.add(targetKey);
    try {
        await vscode.workspace.fs.rename(sourceUri, targetUri, { overwrite: false });
        log(`Renamed: '${currentName}' -> '${targetName}'.`);
        return true;
    } catch (error) {
        processedUris.delete(targetKey);
        const detail = error instanceof Error ? error.message : String(error);
        log(`Rename failed for '${currentName}' -> '${targetName}': ${detail}`);
        void vscode.window.showErrorMessage(`No se pudo renombrar '${currentName}': ${detail}`);
        return false;
    }
}

/**
 * Reports a blocking condition. In manual mode the user asked for the action
 * explicitly, so silence would look like a broken command; in automatic mode
 * only the output channel is touched to keep the experience non-intrusive.
 */
function report(message: string, manual: boolean, severity: 'info' | 'warning' = 'info'): void {
    log(message);
    if (!manual) {
        return;
    }
    if (severity === 'warning') {
        void vscode.window.showWarningMessage(message);
    } else {
        void vscode.window.showInformationMessage(message);
    }
}

/**
 * Core logic: decide whether `document` should be renamed, ask the user and
 * perform the rename through the URI-based filesystem API.
 *
 * @param manual true when triggered by the `extension.fixFileExtension` command.
 */
async function detectAndFix(document: vscode.TextDocument, manual: boolean): Promise<void> {
    const uriKey = document.uri.toString();

    // (a) Untitled documents have no path on disk; there is nothing to rename.
    if (document.isUntitled) {
        report('Skipped: the document is untitled (not saved to disk yet).', manual);
        return;
    }

    if (!RENAMEABLE_SCHEMES.has(document.uri.scheme)) {
        report(`Skipped: unsupported URI scheme '${document.uri.scheme}'.`, manual);
        return;
    }

    // Restrict every filesystem operation to the user's active workspace.
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
    if (!workspaceFolder) {
        report('Skipped: the file is outside the active workspace.', manual, 'warning');
        return;
    }

    if (!manual && processedUris.has(uriKey)) {
        return;
    }

    const currentName = path.basename(document.fileName);

    let targetName: string;
    /** Shown to the user in the confirmation dialog. */
    let reasonLabel: string;
    /** Written to the output channel. */
    let reasonLog: string;

    // Checked before everything else: a mistyped separator such as
    // 'funcion_bool,py' hides the real extension from path.extname AND from
    // VS Code's language detection, so neither of the branches below would
    // ever fire for it.
    const separatorFix = findSeparatorTypoFix(currentName);
    if (separatorFix !== undefined) {
        targetName = separatorFix;
        reasonLabel = 'Separador de extensión incorrecto.';
        reasonLog = 'malformed extension separator';
    } else {
        // (b) A file that already has an extension is left alone. Dotfiles such
        // as '.gitignore' report an empty extname but must not be touched.
        const currentExtension = path.extname(document.fileName);
        if (currentExtension !== '') {
            processedUris.add(uriKey);
            report(`Skipped: '${currentName}' already has the extension '${currentExtension}'.`, manual);
            return;
        }
        if (currentName.startsWith('.')) {
            processedUris.add(uriKey);
            report(`Skipped: '${currentName}' is a dotfile and is left untouched.`, manual);
            return;
        }

        const languageId = document.languageId;

        // (c) Unknown or deliberately ignored languages produce no rename.
        if (IGNORED_LANGUAGE_IDS.has(languageId)) {
            processedUris.add(uriKey);
            log(`Skipped: '${currentName}' resolved to the ignored language '${languageId}'.`);
            if (manual) {
                void vscode.window.showInformationMessage(
                    `No se puede deducir la extensión de '${currentName}': VS Code lo detecta como '${languageId}'.`
                );
            }
            return;
        }

        // (e) Special case: Docker files are named 'Dockerfile', no extension.
        if (languageId === DOCKERFILE_LANGUAGE_ID) {
            targetName = DOCKERFILE_TARGET_NAME;
        } else {
            const extension = LANGUAGE_EXTENSION_MAP[languageId];
            if (extension === undefined) {
                processedUris.add(uriKey);
                log(`Skipped: language '${languageId}' is not present in LANGUAGE_EXTENSION_MAP.`);
                if (manual) {
                    void vscode.window.showInformationMessage(
                        `El lenguaje '${languageId}' no está en el mapa de extensiones de la extensión.`
                    );
                }
                return;
            }
            if (!isSafeExtension(extension)) {
                report(`Aborted: unsafe extension value '${extension}' for language '${languageId}'.`, manual, 'warning');
                return;
            }
            targetName = `${currentName}${extension}`;
        }

        reasonLabel = `Lenguaje detectado: ${languageId}.`;
        reasonLog = `languageId: ${languageId}`;
    }

    if (!isSafeFileName(targetName)) {
        report(`Aborted: unsafe target file name '${targetName}'.`, manual, 'warning');
        return;
    }

    if (targetName === currentName) {
        processedUris.add(uriKey);
        report(`Skipped: '${currentName}' already has the correct name.`, manual);
        return;
    }

    // Renaming a file with unsaved changes can desynchronise the editor buffer
    // from disk, so the user is asked to save first instead.
    if (document.isDirty) {
        report(`Skipped: '${currentName}' has unsaved changes. Save it and run the command again.`, manual, 'warning');
        return;
    }

    // Build the destination URI from the parent URI so the operation stays
    // valid on WSL, Remote SSH and Dev Containers (no fsPath manipulation).
    const parentUri = vscode.Uri.joinPath(document.uri, '..');
    const targetUri = vscode.Uri.joinPath(parentUri, targetName);

    // (d) Never overwrite an existing file.
    if (await uriExists(targetUri)) {
        processedUris.add(uriKey);
        log(`Aborted: target '${targetName}' already exists; nothing was overwritten.`);
        void vscode.window.showWarningMessage(
            `No se renombró '${currentName}': ya existe un archivo llamado '${targetName}'.`
        );
        return;
    }

    // Mark before prompting so a declined proposal is not shown again on every
    // reopen of the same document during this session.
    processedUris.add(uriKey);

    log(`Proposing rename: '${currentName}' -> '${targetName}' (${reasonLog}).`);

    const RENAME = 'Renombrar';
    const CANCEL = 'Cancelar';
    const choice = await vscode.window.showInformationMessage(
        `${reasonLabel} ¿Renombrar '${currentName}' a '${targetName}'?`,
        RENAME,
        CANCEL
    );

    if (choice !== RENAME) {
        log(`Cancelled by user: '${currentName}' was left unchanged.`);
        return;
    }

    if (await applyRename(document.uri, targetUri, currentName, targetName)) {
        void vscode.window.showInformationMessage(`Archivo renombrado a '${targetName}'.`);
    }
}

/**
 * Automatic path for freshly created files. A new empty file has no content to
 * detect a language from, so the project itself decides the extension.
 */
async function handleCreatedFile(uri: vscode.Uri): Promise<void> {
    const uriKey = uri.toString();
    if (processedUris.has(uriKey) || !RENAMEABLE_SCHEMES.has(uri.scheme)) {
        return;
    }

    const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
    if (!workspaceFolder) {
        return;
    }

    const currentName = path.basename(uri.fsPath);
    if (path.extname(currentName) !== '' || currentName.startsWith('.')) {
        return;
    }

    if (PROTECTED_BASE_NAMES.has(currentName.toLowerCase())) {
        processedUris.add(uriKey);
        log(`Skipped on create: '${currentName}' is a conventional extensionless file.`);
        return;
    }

    if (isInsideIgnoredDirectory(path.relative(workspaceFolder.uri.fsPath, uri.fsPath))) {
        return;
    }

    // A mistyped separator expresses an explicit intent and its repair is
    // confirmed with the user, so it belongs to the open-document path.
    if (findSeparatorTypoFix(currentName) !== undefined) {
        log(`Deferred on create: '${currentName}' looks like a separator typo.`);
        return;
    }

    // The watcher also reports directories, and editors create short-lived
    // probe files. Both are filtered out by requiring an existing regular file.
    if (!(await isExistingFile(uri))) {
        log(`Skipped on create: '${currentName}' is not an existing regular file.`);
        return;
    }

    const parentUri = vscode.Uri.joinPath(uri, '..');
    const extension = await resolveFolderExtension(workspaceFolder, parentUri);
    if (extension === undefined) {
        processedUris.add(uriKey);
        log(`Skipped on create: could not determine the project language for '${currentName}'.`);
        return;
    }
    if (!isSafeExtension(extension)) {
        log(`Aborted on create: unsafe extension '${extension}'.`);
        return;
    }

    const targetName = `${currentName}${extension}`;
    if (!isSafeFileName(targetName)) {
        log(`Aborted on create: unsafe target name '${targetName}'.`);
        return;
    }

    const targetUri = vscode.Uri.joinPath(parentUri, targetName);
    if (await uriExists(targetUri)) {
        processedUris.add(uriKey);
        log(`Skipped on create: '${targetName}' already exists; nothing was overwritten.`);
        return;
    }

    // Marked before renaming: undoing recreates this URI and the watcher would
    // otherwise process it a second time.
    processedUris.add(uriKey);
    log(`Auto-renaming on create: '${currentName}' -> '${targetName}' (project language).`);

    if (!(await applyRename(uri, targetUri, currentName, targetName))) {
        return;
    }

    // No confirmation is asked before renaming, so undo is the safety net.
    const UNDO = 'Deshacer';
    const choice = await vscode.window.showInformationMessage(
        `Renombrado a '${targetName}' según el lenguaje del proyecto.`,
        UNDO
    );
    if (choice !== UNDO) {
        return;
    }

    try {
        await vscode.workspace.fs.rename(targetUri, uri, { overwrite: false });
        log(`Undone: '${targetName}' -> '${currentName}'.`);
    } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        log(`Undo failed for '${targetName}': ${detail}`);
        void vscode.window.showErrorMessage(`No se pudo deshacer el renombrado: ${detail}`);
    }
}

/**
 * Extension for a folder: an explicit choice stored in the project's settings
 * always wins over inspection of the files, which is the whole point of asking.
 */
async function resolveFolderExtension(
    workspaceFolder: vscode.WorkspaceFolder,
    folder: vscode.Uri
): Promise<string | undefined> {
    const stored = readFolderLanguage(workspaceFolder.uri, folder);
    if (stored !== undefined && stored !== AUTOMATIC) {
        if (isSafeExtension(stored)) {
            log(`Stored choice for '${folderKey(workspaceFolder.uri, folder)}' is '${stored}'.`);
            return stored;
        }
        log(`Ignored stored choice '${stored}': not a valid extension.`);
    }
    return detectProjectExtension(folder, workspaceFolder.uri, log);
}

/** Folders whose picker has already been shown or dismissed this session. */
const askedFolders = new Set<string>();

/**
 * Shows the language picker for `folder` and stores the answer. The detected
 * extension, when there is one, is offered first so the common case is a
 * single keystroke.
 */
async function askFolderLanguage(
    workspaceFolder: vscode.WorkspaceFolder,
    folder: vscode.Uri,
    reason: string
): Promise<void> {
    const key = folder.toString();
    if (askedFolders.has(key)) {
        return;
    }
    askedFolders.add(key);

    const detected = await detectProjectExtension(folder, workspaceFolder.uri, log);

    interface Item extends vscode.QuickPickItem {
        readonly value: string;
    }

    const items: Item[] = [];
    if (detected !== undefined) {
        const match = LANGUAGE_CHOICES.find((choice) => choice.extension === detected);
        items.push({
            label: match ? match.label : detected,
            description: `${detected} · detectado en el proyecto`,
            value: detected
        });
    }
    for (const choice of LANGUAGE_CHOICES) {
        if (choice.extension !== detected) {
            items.push({ label: choice.label, description: choice.extension, value: choice.extension });
        }
    }
    items.push({
        label: 'Detectar automáticamente',
        description: 'no volver a preguntar en esta carpeta',
        value: AUTOMATIC
    });

    const label = folderKey(workspaceFolder.uri, folder);
    const picked = await vscode.window.showQuickPick(items, {
        title: `File Extension Fixer · ${label}`,
        placeHolder: `¿Qué lenguaje vas a usar en '${label}'?`,
        matchOnDescription: true
    });

    if (!picked) {
        log(`Language picker dismissed for '${label}' (${reason}); nothing stored.`);
        return;
    }

    try {
        await writeFolderLanguage(workspaceFolder.uri, folder, picked.value);
        log(`Stored '${picked.value}' for '${label}' (${reason}).`);
    } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        log(`Could not store the language for '${label}': ${detail}`);
        void vscode.window.showErrorMessage(`No se pudo guardar el lenguaje de '${label}': ${detail}`);
    }
}

/**
 * A newly created folder that is still empty is a new project or exercise, so
 * the user is asked which language it will hold. Asking here, instead of on the
 * first file, is what makes the answer available before anything is created.
 */
async function handleCreatedFolder(
    uri: vscode.Uri,
    workspaceFolder: vscode.WorkspaceFolder
): Promise<void> {
    const name = path.basename(uri.fsPath);
    if (name.startsWith('.') || isInsideIgnoredDirectory(path.relative(workspaceFolder.uri.fsPath, uri.fsPath))) {
        return;
    }

    let entries: Array<[string, vscode.FileType]>;
    try {
        entries = await vscode.workspace.fs.readDirectory(uri);
    } catch {
        return;
    }
    if (entries.length > 0) {
        log(`Skipped on create: folder '${name}' is not empty.`);
        return;
    }

    if (readFolderLanguage(workspaceFolder.uri, uri) !== undefined) {
        // An ancestor already answered; asking again would be noise.
        const stored = readFolderLanguage(workspaceFolder.uri, uri);
        log(`Folder '${name}' already inherits '${stored}'; not asking.`);
        return;
    }

    await askFolderLanguage(workspaceFolder, uri, 'new empty folder');
}

/** Dispatches a newly created URI to the file or the folder handler. */
async function handleCreatedEntry(uri: vscode.Uri): Promise<void> {
    if (processedUris.has(uri.toString()) || !RENAMEABLE_SCHEMES.has(uri.scheme)) {
        return;
    }

    const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
    if (!workspaceFolder) {
        return;
    }

    let type: vscode.FileType;
    try {
        type = (await vscode.workspace.fs.stat(uri)).type;
    } catch {
        // Created and removed again before the delay elapsed.
        return;
    }

    if (type === vscode.FileType.Directory) {
        await handleCreatedFolder(uri, workspaceFolder);
        return;
    }
    if (type === vscode.FileType.File) {
        await handleCreatedFile(uri);
    }
}

/** Queues the handling of a newly created URI. */
function scheduleCreationHandling(uri: vscode.Uri): void {
    if (processedUris.has(uri.toString()) || !RENAMEABLE_SCHEMES.has(uri.scheme)) {
        return;
    }

    const timer = setTimeout(() => {
        pendingTimers.delete(timer);
        void handleCreatedEntry(uri).catch((error: unknown) => {
            const detail = error instanceof Error ? error.message : String(error);
            log(`Unexpected error while handling created entry '${uri.fsPath}': ${detail}`);
        });
    }, CREATION_SETTLE_DELAY_MS);

    pendingTimers.add(timer);
}

/**
 * On startup, a workspace folder with no stored choice and no detectable
 * language is a project that is just starting, so the picker is shown once.
 */
async function askOnProjectStart(): Promise<void> {
    for (const workspaceFolder of vscode.workspace.workspaceFolders ?? []) {
        if (readFolderLanguage(workspaceFolder.uri, workspaceFolder.uri) !== undefined) {
            continue;
        }
        const detected = await detectProjectExtension(workspaceFolder.uri, workspaceFolder.uri, log);
        if (detected !== undefined) {
            continue;
        }
        await askFolderLanguage(workspaceFolder, workspaceFolder.uri, 'project start');
    }
}

/** Queues a delayed inspection for a document opened by the editor. */
function scheduleDetection(document: vscode.TextDocument): void {
    if (document.isUntitled || !RENAMEABLE_SCHEMES.has(document.uri.scheme)) {
        return;
    }
    if (processedUris.has(document.uri.toString())) {
        return;
    }

    const timer = setTimeout(() => {
        pendingTimers.delete(timer);
        void detectAndFix(document, false).catch((error: unknown) => {
            const detail = error instanceof Error ? error.message : String(error);
            log(`Unexpected error while inspecting '${document.fileName}': ${detail}`);
        });
    }, LANGUAGE_DETECTION_DELAY_MS);

    pendingTimers.add(timer);
}

export function activate(context: vscode.ExtensionContext): void {
    outputChannel = vscode.window.createOutputChannel('File Extension Fixer');
    context.subscriptions.push(outputChannel);
    log('File Extension Fixer activated.');

    // Automatic path: every document opened from now on.
    context.subscriptions.push(
        vscode.workspace.onDidOpenTextDocument((document) => {
            scheduleDetection(document);
        })
    );

    // Documents already open when the extension activates never fire
    // onDidOpenTextDocument, so they are inspected once at startup.
    for (const document of vscode.workspace.textDocuments) {
        scheduleDetection(document);
    }

    // Files created through the VS Code explorer or the extension API.
    context.subscriptions.push(
        vscode.workspace.onDidCreateFiles((event) => {
            for (const uri of event.files) {
                scheduleCreationHandling(uri);
            }
        })
    );

    // Files created outside VS Code (terminal, scripts, generators) never fire
    // onDidCreateFiles, so a watcher is needed to cover them.
    const fileWatcher = vscode.workspace.createFileSystemWatcher('**/*', false, true, true);
    context.subscriptions.push(
        fileWatcher,
        fileWatcher.onDidCreate((uri) => {
            scheduleCreationHandling(uri);
        })
    );

    // Adding, changing or removing a manifest changes the detected language,
    // so the per-folder cache is dropped whenever one of them moves.
    const markerWatcher = vscode.workspace.createFileSystemWatcher(`**/{${MARKER_FILE_NAMES.join(',')}}`);
    context.subscriptions.push(
        markerWatcher,
        markerWatcher.onDidCreate(() => clearProjectLanguageCache()),
        markerWatcher.onDidChange(() => clearProjectLanguageCache()),
        markerWatcher.onDidDelete(() => clearProjectLanguageCache())
    );

    // A project that is just starting has nothing to inspect, so ask once.
    void askOnProjectStart().catch((error: unknown) => {
        const detail = error instanceof Error ? error.message : String(error);
        log(`Could not ask for the project language on startup: ${detail}`);
    });

    // Lets the user set or correct the choice without editing settings.json.
    context.subscriptions.push(
        vscode.commands.registerCommand('extension.setFolderLanguage', async () => {
            const editor = vscode.window.activeTextEditor;
            const target = editor
                ? vscode.Uri.joinPath(editor.document.uri, '..')
                : vscode.workspace.workspaceFolders?.[0]?.uri;
            if (!target) {
                void vscode.window.showWarningMessage('No hay ninguna carpeta abierta.');
                return;
            }
            const workspaceFolder = vscode.workspace.getWorkspaceFolder(target);
            if (!workspaceFolder) {
                void vscode.window.showWarningMessage('La carpeta está fuera del workspace.');
                return;
            }
            // The command is explicit, so a previous answer must not block it.
            askedFolders.delete(target.toString());
            await askFolderLanguage(workspaceFolder, target, 'manual command');
        })
    );

    // Manual fallback: works on the active editor at any time.
    context.subscriptions.push(
        vscode.commands.registerCommand('extension.fixFileExtension', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                void vscode.window.showWarningMessage('No hay ningún editor activo.');
                log('Manual command invoked without an active editor.');
                return;
            }
            log(`Manual command invoked for '${editor.document.fileName}'.`);
            try {
                await detectAndFix(editor.document, true);
            } catch (error) {
                const detail = error instanceof Error ? error.message : String(error);
                log(`Manual command failed: ${detail}`);
                void vscode.window.showErrorMessage(`File Extension Fixer: ${detail}`);
            }
        })
    );

    // Timers outlive their scheduling scope; clear them on shutdown.
    context.subscriptions.push({
        dispose: () => {
            for (const timer of pendingTimers) {
                clearTimeout(timer);
            }
            pendingTimers.clear();
        }
    });
}

export function deactivate(): void {
    for (const timer of pendingTimers) {
        clearTimeout(timer);
    }
    pendingTimers.clear();
    processedUris.clear();
    askedFolders.clear();
    clearProjectLanguageCache();
    log('File Extension Fixer deactivated.');
    outputChannel = undefined;
}
