import * as path from 'path';
import * as vscode from 'vscode';

/**
 * Decides which file extension a project uses, without looking at the contents
 * of the file being created. This module knows nothing about renaming or about
 * the UI: it answers one question, "what language is this folder written in?".
 */

/** Directories that never carry useful evidence about the project language. */
const IGNORED_DIRECTORY_NAMES: ReadonlySet<string> = new Set([
    'node_modules',
    '.git',
    '.svn',
    '.hg',
    'out',
    'dist',
    'build',
    'bin',
    'obj',
    'target',
    'vendor',
    'venv',
    '.venv',
    'env',
    '__pycache__',
    '.next',
    '.nuxt',
    'coverage',
    '.vscode-test',
    // Editor and IDE metadata: full of .json and .xml that describe the tools,
    // not the project's language.
    '.vscode',
    '.vs',
    '.idea',
    '.settings',
    '.gradle',
    '.cache',
    '.pytest_cache',
    '.mypy_cache',
    // Compiler output directories.
    'Debug',
    'Release',
    'x64',
    'cmake-build-debug',
    'cmake-build-release'
]);

/**
 * Extensions that accompany a primary source file instead of being one. A C
 * project holds as many .h files as .c files, so counting them in the same
 * bucket produces a permanent tie and no answer at all. The same applies to
 * .hpp next to .cpp, or .pyi next to .py.
 */
const COMPANION_EXTENSIONS: ReadonlySet<string> = new Set([
    '.h',
    '.hpp',
    '.hh',
    '.hxx',
    '.inc',
    '.pyi'
]);

/**
 * Build output: never evidence of anything, so it is not counted at all.
 * Compiling a C program on Windows leaves .exe, .obj, .pdb and .ilk next to
 * the single .c file; counting those produces a tie that blocks every answer.
 */
const ARTIFACT_EXTENSIONS: ReadonlySet<string> = new Set([
    '.o',
    '.obj',
    '.a',
    '.so',
    '.dll',
    '.dylib',
    '.exe',
    '.out',
    '.bin',
    '.elf',
    '.lib',
    '.exp',
    '.pdb',
    '.ilk',
    '.idb',
    '.pch',
    '.gch',
    '.su',
    '.class',
    '.jar',
    '.pyc',
    '.pyo',
    '.map'
]);

/**
 * Extensions that describe configuration or documentation rather than the
 * language a project is written in. They are counted only as a last resort,
 * otherwise a repository full of .json and .md would always win.
 */
const WEAK_EXTENSIONS: ReadonlySet<string> = new Set([
    '.json',
    '.md',
    '.txt',
    '.yml',
    '.yaml',
    '.lock',
    '.log',
    '.cfg',
    '.ini',
    '.toml',
    '.xml',
    '.csv',
    '.svg',
    '.map'
]);

/** Guards against pathological directory nesting while walking upwards. */
const MAX_WALK_DEPTH = 12;

/**
 * How deep the search for evidence goes below each level. Two levels covers
 * the common layouts: sources in src/, and course-style trees where every
 * exercise gets its own folder inside a chapter folder.
 */
const MAX_SUBDIRECTORY_DEPTH = 2;

/**
 * Total directory reads allowed per level, across all depths. Bounds the cost
 * on large repositories, where the walk would otherwise be unpredictable.
 */
const MAX_DIRECTORY_READS = 48;

/**
 * Build systems shared by C and C++. They identify the family but not the
 * language, so the choice between .c and .cpp is made from the sources found
 * nearby, defaulting to .c when there are none yet.
 */
const C_FAMILY_BUILD_FILES: readonly string[] = [
    'Makefile',
    'makefile',
    'GNUmakefile',
    'CMakeLists.txt',
    'meson.build',
    'configure.ac',
    'Kbuild'
];

/** Presence of any of these means the C-family project is C++. */
const CPP_EXTENSIONS: ReadonlySet<string> = new Set(['.cpp', '.cc', '.cxx', '.hpp', '.hh', '.hxx']);

/** Only well-formed extensions may leave this module. */
const SAFE_EXTENSION_PATTERN = /^\.[A-Za-z0-9]+$/;

/** File names that identify a project's language on their own. */
export const MARKER_FILE_NAMES: readonly string[] = [
    'package.json',
    'tsconfig.json',
    'requirements.txt',
    'pyproject.toml',
    'Pipfile',
    'setup.py',
    'Cargo.toml',
    'go.mod',
    'composer.json',
    'Gemfile',
    'Package.swift',
    'pom.xml',
    'build.gradle',
    'build.gradle.kts',
    ...C_FAMILY_BUILD_FILES
];

/** Cached answer per folder URI; cleared when a marker file changes. */
const folderCache = new Map<string, string | undefined>();

/** What a single folder (plus its immediate subdirectories) tells us. */
interface FolderEvidence {
    /** Names of the files in the folder itself; subdirectories do not vote. */
    readonly fileNames: ReadonlySet<string>;
    /** Extensions of real source files. */
    readonly strong: Map<string, number>;
    /** Headers and stubs that always accompany a source file. */
    readonly companion: Map<string, number>;
    /** Configuration and documentation. */
    readonly weak: Map<string, number>;
}

export function clearProjectLanguageCache(): void {
    folderCache.clear();
}

/**
 * True when any segment of `relativePath` is a directory we refuse to touch.
 * Used by the caller to ignore files created inside node_modules and friends.
 */
export function isInsideIgnoredDirectory(relativePath: string): boolean {
    return relativePath
        .split(/[\\/]/)
        .some((segment) => IGNORED_DIRECTORY_NAMES.has(segment));
}

/**
 * Marker files, in order of confidence. `package.json` is checked last on
 * purpose: it turns up incidentally in projects written in other languages
 * (tooling, linters, docs sites), whereas Cargo.toml or go.mod never do.
 */
function extensionFromMarkers(fileNames: ReadonlySet<string>, evidence: FolderEvidence): string | undefined {
    if (fileNames.has('Cargo.toml')) {
        return '.rs';
    }
    if (fileNames.has('go.mod')) {
        return '.go';
    }
    if (fileNames.has('Package.swift')) {
        return '.swift';
    }
    if (fileNames.has('pom.xml') || fileNames.has('build.gradle') || fileNames.has('build.gradle.kts')) {
        return '.java';
    }
    if (fileNames.has('composer.json')) {
        return '.php';
    }
    if (fileNames.has('Gemfile')) {
        return '.rb';
    }
    for (const name of fileNames) {
        if (name.endsWith('.csproj') || name.endsWith('.sln')) {
            return '.cs';
        }
    }
    if (
        fileNames.has('requirements.txt') ||
        fileNames.has('pyproject.toml') ||
        fileNames.has('Pipfile') ||
        fileNames.has('setup.py')
    ) {
        return '.py';
    }
    if (fileNames.has('package.json')) {
        // A TypeScript project is a JavaScript project with tsconfig.json.
        return fileNames.has('tsconfig.json') ? '.ts' : '.js';
    }
    // Checked last of all: these build systems say "C or C++" but not which,
    // so the sources seen nearby settle it. A brand new project with nothing
    // but a Makefile defaults to C.
    if (C_FAMILY_BUILD_FILES.some((name) => fileNames.has(name))) {
        for (const extension of CPP_EXTENSIONS) {
            if ((evidence.strong.get(extension) ?? 0) > 0 || (evidence.companion.get(extension) ?? 0) > 0) {
                return '.cpp';
            }
        }
        return '.c';
    }
    return undefined;
}

/** Returns the single most frequent extension, or undefined when it is a tie. */
function pickWinner(counts: ReadonlyMap<string, number>): string | undefined {
    let winner: string | undefined;
    let best = 0;
    let tied = false;

    for (const [extension, count] of counts) {
        if (count > best) {
            winner = extension;
            best = count;
            tied = false;
        } else if (count === best) {
            tied = true;
        }
    }

    // An ambiguous folder yields nothing so the walk continues to the parent,
    // which usually has a marker file and a clear answer.
    return tied ? undefined : winner;
}

/** Adds every file of `entries` to the three buckets of `evidence`. */
function countInto(evidence: FolderEvidence, entries: ReadonlyArray<[string, vscode.FileType]>): void {
    for (const [name, type] of entries) {
        if (type !== vscode.FileType.File || name.startsWith('.')) {
            continue;
        }
        const extension = path.extname(name).toLowerCase();
        if (!SAFE_EXTENSION_PATTERN.test(extension) || ARTIFACT_EXTENSIONS.has(extension)) {
            continue;
        }
        const bucket = WEAK_EXTENSIONS.has(extension)
            ? evidence.weak
            : COMPANION_EXTENSIONS.has(extension)
                ? evidence.companion
                : evidence.strong;
        bucket.set(extension, (bucket.get(extension) ?? 0) + 1);
    }
}

/**
 * Picks from the strongest non-empty bucket. A tie inside that bucket returns
 * nothing on purpose: the folder is genuinely ambiguous and the walk should
 * continue upwards rather than fall back to weaker evidence here.
 */
function extensionFromFrequency(evidence: FolderEvidence): string | undefined {
    if (evidence.strong.size > 0) {
        return pickWinner(evidence.strong);
    }
    if (evidence.companion.size > 0) {
        return pickWinner(evidence.companion);
    }
    return pickWinner(evidence.weak);
}

/**
 * Collects the evidence of one folder. Files of the immediate subdirectories
 * are counted too, because a project root often holds only a Makefile and a
 * README while the sources live in src/.
 */
async function gatherEvidence(
    folder: vscode.Uri,
    log: (message: string) => void
): Promise<FolderEvidence | undefined> {
    let entries: Array<[string, vscode.FileType]>;
    try {
        entries = await vscode.workspace.fs.readDirectory(folder);
    } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        log(`Could not read '${folder.fsPath}': ${detail}`);
        return undefined;
    }

    const evidence: FolderEvidence = {
        fileNames: new Set(
            entries.filter(([, type]) => type === vscode.FileType.File).map(([name]) => name)
        ),
        strong: new Map(),
        companion: new Map(),
        weak: new Map()
    };

    countInto(evidence, entries);

    // Breadth-first sweep of the subtree, bounded by depth and by a read
    // budget so a large repository cannot make this expensive.
    let frontier: vscode.Uri[] = collectSubdirectories(folder, entries);
    let reads = 0;

    for (let depth = 0; depth < MAX_SUBDIRECTORY_DEPTH && frontier.length > 0; depth++) {
        const next: vscode.Uri[] = [];

        for (const child of frontier) {
            if (reads >= MAX_DIRECTORY_READS) {
                break;
            }
            reads++;
            try {
                const childEntries = await vscode.workspace.fs.readDirectory(child);
                countInto(evidence, childEntries);
                next.push(...collectSubdirectories(child, childEntries));
            } catch {
                // An unreadable subdirectory is simply no evidence.
            }
        }

        frontier = next;
    }

    return evidence;
}

/** Readable, non-ignored subdirectories of a folder. */
function collectSubdirectories(
    folder: vscode.Uri,
    entries: ReadonlyArray<[string, vscode.FileType]>
): vscode.Uri[] {
    return entries
        .filter(([name, type]) => type === vscode.FileType.Directory && !IGNORED_DIRECTORY_NAMES.has(name))
        .map(([name]) => vscode.Uri.joinPath(folder, name));
}

/** Answer for a single folder: markers first, then extension frequency. */
async function extensionForFolder(
    folder: vscode.Uri,
    log: (message: string) => void
): Promise<string | undefined> {
    const cacheKey = folder.toString();
    if (folderCache.has(cacheKey)) {
        return folderCache.get(cacheKey);
    }

    const evidence = await gatherEvidence(folder, log);
    if (evidence === undefined) {
        folderCache.set(cacheKey, undefined);
        return undefined;
    }

    const fromMarkers = extensionFromMarkers(evidence.fileNames, evidence);
    if (fromMarkers !== undefined) {
        log(`Marker file in '${folder.fsPath}' resolves to '${fromMarkers}'.`);
        folderCache.set(cacheKey, fromMarkers);
        return fromMarkers;
    }

    const fromFrequency = extensionFromFrequency(evidence);
    if (fromFrequency !== undefined) {
        log(`Most frequent extension around '${folder.fsPath}' is '${fromFrequency}'.`);
    }
    folderCache.set(cacheKey, fromFrequency);
    return fromFrequency;
}

function isWithin(child: vscode.Uri, parent: vscode.Uri): boolean {
    const childPath = child.path.replace(/\/+$/, '').toLowerCase();
    const parentPath = parent.path.replace(/\/+$/, '').toLowerCase();
    return childPath === parentPath || childPath.startsWith(`${parentPath}/`);
}

/**
 * Walks from `startFolder` up to `workspaceRoot` and returns the extension of
 * the first level that yields an answer. Walking upwards is what makes
 * monorepos work: 'backend/utils/nuevo' resolves to '.py' from backend's
 * requirements.txt even when the repository root holds a package.json.
 */
export async function detectProjectExtension(
    startFolder: vscode.Uri,
    workspaceRoot: vscode.Uri,
    log: (message: string) => void
): Promise<string | undefined> {
    let current = startFolder;

    for (let depth = 0; depth < MAX_WALK_DEPTH; depth++) {
        if (!isWithin(current, workspaceRoot)) {
            return undefined;
        }

        const found = await extensionForFolder(current, log);
        if (found !== undefined) {
            return found;
        }

        if (current.path.replace(/\/+$/, '').toLowerCase() === workspaceRoot.path.replace(/\/+$/, '').toLowerCase()) {
            return undefined;
        }

        const parent = vscode.Uri.joinPath(current, '..');
        if (parent.path === current.path) {
            return undefined;
        }
        current = parent;
    }

    log(`Stopped walking after ${MAX_WALK_DEPTH} levels from '${startFolder.fsPath}'.`);
    return undefined;
}
