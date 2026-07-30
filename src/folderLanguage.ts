import * as path from 'path';
import * as vscode from 'vscode';

/**
 * Stores and resolves the language the user picked for a folder. The choice
 * lives in the project's own .vscode/settings.json, so it is visible, editable
 * by hand and travels with the repository.
 */

const CONFIGURATION_SECTION = 'fileExtensionFixer';
const CONFIGURATION_KEY = 'folderLanguages';

/** Key used for the workspace root itself. */
export const ROOT_KEY = '.';

/** Stored instead of an extension when the user wants automatic detection. */
export const AUTOMATIC = 'auto';

/** Offered in the picker, in this order. */
export const LANGUAGE_CHOICES: ReadonlyArray<{ readonly label: string; readonly extension: string }> = [
    { label: 'C', extension: '.c' },
    { label: 'C++', extension: '.cpp' },
    { label: 'C#', extension: '.cs' },
    { label: 'Python', extension: '.py' },
    { label: 'JavaScript', extension: '.js' },
    { label: 'TypeScript', extension: '.ts' },
    { label: 'Java', extension: '.java' },
    { label: 'PHP', extension: '.php' },
    { label: 'Go', extension: '.go' },
    { label: 'Rust', extension: '.rs' },
    { label: 'Ruby', extension: '.rb' },
    { label: 'Swift', extension: '.swift' },
    { label: 'Kotlin', extension: '.kt' },
    { label: 'Shell', extension: '.sh' },
    { label: 'PowerShell', extension: '.ps1' },
    { label: 'SQL', extension: '.sql' },
    { label: 'HTML', extension: '.html' },
    { label: 'CSS', extension: '.css' },
    { label: 'Lua', extension: '.lua' },
    { label: 'R', extension: '.r' },
    { label: 'Markdown', extension: '.md' },
    { label: 'JSON', extension: '.json' },
    { label: 'YAML', extension: '.yml' },
    { label: 'XML', extension: '.xml' }
];

/**
 * Path of `folder` relative to its workspace folder, in the form stored in the
 * setting: forward slashes, and '.' for the root itself.
 */
export function folderKey(workspaceRoot: vscode.Uri, folder: vscode.Uri): string {
    const relative = path.relative(workspaceRoot.fsPath, folder.fsPath);
    if (relative === '' || relative === '.') {
        return ROOT_KEY;
    }
    return relative.split(path.sep).join('/');
}

function readMap(workspaceRoot: vscode.Uri): Record<string, string> {
    return vscode.workspace
        .getConfiguration(CONFIGURATION_SECTION, workspaceRoot)
        .get<Record<string, string>>(CONFIGURATION_KEY, {});
}

/**
 * The stored choice for `folder`, or for its closest ancestor that has one.
 * Returns undefined when neither the folder nor any ancestor was ever answered.
 */
export function readFolderLanguage(workspaceRoot: vscode.Uri, folder: vscode.Uri): string | undefined {
    const map = readMap(workspaceRoot);
    const key = folderKey(workspaceRoot, folder);

    if (key !== ROOT_KEY) {
        const segments = key.split('/');
        // Longest path first: the nearest ancestor wins.
        for (let length = segments.length; length > 0; length--) {
            const candidate = segments.slice(0, length).join('/');
            const value = map[candidate];
            if (value !== undefined) {
                return value;
            }
        }
    }

    return map[ROOT_KEY];
}

/** Writes the choice for `folder` into the workspace folder's settings.json. */
export async function writeFolderLanguage(
    workspaceRoot: vscode.Uri,
    folder: vscode.Uri,
    value: string
): Promise<void> {
    const configuration = vscode.workspace.getConfiguration(CONFIGURATION_SECTION, workspaceRoot);
    const map = { ...configuration.get<Record<string, string>>(CONFIGURATION_KEY, {}) };
    map[folderKey(workspaceRoot, folder)] = value;
    await configuration.update(CONFIGURATION_KEY, map, vscode.ConfigurationTarget.WorkspaceFolder);
}
