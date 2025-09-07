import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

type OdooManifestPaths = {
    moduleFolder: string;
    viewsPath: string;
    wizardPath: string;
    controllersPath: string;
    dataPath: string;
    securityPath: string;
    modelsPath: string;
    enabled?: boolean;
};

const MANIFEST_FILENAME = '__manifest__.py';
const DEFAULT_MANIFEST_TEMPLATE = `{
    'name': '',
    'version': '1.0',
    'depends': [],
    'data': [
    ],
    'installable': True,
    'application': True,
    'license': 'LGPL-3',
}
`;

export function activate(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        vscode.commands.registerCommand('odoo-auto-manifest-init.showSetupPanel', async () => {
            const panel = vscode.window.createWebviewPanel(
                'odooSetup',
                'Odoo Module Setup',
                vscode.ViewColumn.One,
                {
                    enableScripts: true,
                    localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')],
                }
            );

            const lastConfig = context.workspaceState.get<OdooManifestPaths>('odooManifestInitConfig');
            const htmlPath = vscode.Uri.joinPath(context.extensionUri, 'media', 'setupPanel.html');
            let html = fs.readFileSync(htmlPath.fsPath, 'utf8');
            panel.webview.html = html.replace('/*__PREFILL__*/', `
                window.prefillConfig = ${JSON.stringify(lastConfig || {})};
            `);

            panel.webview.onDidReceiveMessage(async message => {
                switch (message.command) {
                    case 'pickFolder': {
                        const uri = await vscode.window.showOpenDialog({
                            canSelectFolders: true,
                            canSelectFiles: false,
                            canSelectMany: false,
                            openLabel: 'Select folder'
                        });
                        panel.webview.postMessage({
                            command: 'folderPicked',
                            inputId: message.inputId,
                            folderPath: uri && uri.length > 0 ? uri[0].fsPath : ''
                        });
                        break;
                    }
                    case 'saveConfig': {
                        const config = message.config as OdooManifestPaths;
                        await context.workspaceState.update('odooManifestInitConfig', config);
                        vscode.window.showInformationMessage('Odoo manifest/init paths saved!');
                        panel.webview.postMessage({ command: 'saveSuccess' });
                        if (config.enabled) {
                            ensureManifestAndInit(config);
                            setupAllWatchers(context, config);
                        }
                        break;
                    }
                }
            });
        })
    );

    const savedConfig = context.workspaceState.get<OdooManifestPaths>('odooManifestInitConfig');
    if (savedConfig && savedConfig.enabled) {
        ensureManifestAndInit(savedConfig);
        setupAllWatchers(context, savedConfig);
    }
}

function ensureManifestAndInit(paths: OdooManifestPaths) {
    const manifestPath = path.join(paths.moduleFolder, MANIFEST_FILENAME);
    if (!fs.existsSync(manifestPath)) {
        fs.writeFileSync(manifestPath, DEFAULT_MANIFEST_TEMPLATE, 'utf8');
    } else {
        ensureManifestTemplate(manifestPath);
    }
    [paths.modelsPath, paths.wizardPath, paths.controllersPath].forEach(folder => {
        if (folder && !fs.existsSync(path.join(folder, '__init__.py'))) {
            fs.writeFileSync(path.join(folder, '__init__.py'), '', 'utf8');
        }
    });
}

function ensureManifestTemplate(manifestPath: string) {
    let raw = '';
    try {
        raw = fs.readFileSync(manifestPath, 'utf8');
    } catch {
        fs.writeFileSync(manifestPath, DEFAULT_MANIFEST_TEMPLATE, 'utf8');
        return;
    }
    if (!raw.trim() || !raw.includes("'data':")) {
        fs.writeFileSync(manifestPath, DEFAULT_MANIFEST_TEMPLATE, 'utf8');
        return;
    }
    const dataBlockRegex = /'data'\s*:\s*\[[\s\S]*?\]/;
    if (!dataBlockRegex.test(raw)) {
        const installableIdx = raw.indexOf("'installable'");
        if (installableIdx !== -1) {
            const before = raw.substring(0, installableIdx);
            const after = raw.substring(installableIdx);
            raw = `${before}    'data': [\n    ],\n${after}`;
            fs.writeFileSync(manifestPath, raw, 'utf8');
        }
    }
}

function setupAllWatchers(context: vscode.ExtensionContext, paths: OdooManifestPaths) {
    function setupWatcher(folder: string, group: "views" | "wizard" | "controllers" | "data" | "security") {
        if (folder) {
            const watcher = vscode.workspace.createFileSystemWatcher(
                new vscode.RelativePattern(folder, '*.xml')
            );
            watcher.onDidCreate(uri => {
                insertLineInManifest(path.join(paths.moduleFolder, MANIFEST_FILENAME), uri.fsPath, group);
            });
            watcher.onDidDelete(uri => {
                commentLineInManifest(path.join(paths.moduleFolder, MANIFEST_FILENAME), uri.fsPath, group);
            });
            context.subscriptions.push(watcher);
        }
    }
    setupWatcher(paths.viewsPath, "views");
    setupWatcher(paths.wizardPath, "wizard");
    setupWatcher(paths.dataPath, "data");
    setupWatcher(paths.securityPath, "security");

    setupPythonWatcher(paths.modelsPath);
    setupPythonWatcher(paths.wizardPath);
    setupPythonWatcher(paths.controllersPath);
}

function insertLineInManifest(
    manifestPath: string,
    filePath: string,
    group: "views" | "wizard" | "controllers" | "data" | "security"
) {
    if (!fs.existsSync(manifestPath)) {
        fs.writeFileSync(manifestPath, DEFAULT_MANIFEST_TEMPLATE, 'utf8');
    }
    fs.readFile(manifestPath, 'utf8', (err, raw) => {
        if (err) {
            vscode.window.showErrorMessage('Failed to read manifest: ' + err.message);
            return;
        }
        const relPath = path.relative(path.dirname(manifestPath), filePath).replace(/\\/g, '/');
        const lines = raw.split('\n');
        let blockStart = -1, blockEnd = -1;
        let blockKey = "'data': [";
        let prefix = group + '/';
        let indent = '';
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].includes(blockKey)) {
                blockStart = i;
                indent = lines[i].match(/^\s*/)![0] + '    ';
                continue;
            }
            if (blockStart !== -1 && lines[i].includes(']')) {
                blockEnd = i;
                break;
            }
        }
        if (blockStart === -1 || blockEnd === -1) {
            vscode.window.showErrorMessage(`Could not find block ${blockKey} in manifest.`);
            return;
        }
        let alreadyExists = false;
        let entries: { line: string, value: string, idx: number }[] = [];
        for (let i = blockStart + 1; i < blockEnd; i++) {
            const line = lines[i].trim();
            if (line.startsWith('#')) continue;
            const m = line.match(/'([^']+)'/);
            if (m) {
                if (m[1] === relPath) alreadyExists = true;
                entries.push({ line: lines[i], value: m[1], idx: i });
            }
        }
        if (alreadyExists) {
            vscode.window.showInformationMessage(`${relPath} is already present in manifest.`);
            return;
        }
        const groupEntries = entries.filter(e => e.value.startsWith(prefix) && !e.value.includes('menu_views')).sort((a, b) => a.value.localeCompare(b.value));
        const menuViewsEntries = entries.filter(e => e.value.startsWith(prefix) && e.value.includes('menu_views'));
        let insertAt = blockEnd;
        let found = false;
        for (let e of groupEntries) {
            if (e.value.localeCompare(relPath) === 1) {
                insertAt = e.idx;
                found = true;
                break;
            }
        }
        if (!found && groupEntries.length > 0) {
            if (menuViewsEntries.length > 0) {
                insertAt = menuViewsEntries[0].idx;
            } else {
                insertAt = groupEntries[groupEntries.length - 1].idx + 1;
            }
        } else if (groupEntries.length === 0 && menuViewsEntries.length > 0) {
            insertAt = menuViewsEntries[0].idx;
        }
        const newLine = `${indent}'${relPath}',`;
        lines.splice(insertAt, 0, newLine);
        fs.writeFile(manifestPath, lines.join('\n'), err2 => {
            if (err2) {
                vscode.window.showErrorMessage('Failed to update manifest: ' + err2.message);
            } else {
                vscode.window.showInformationMessage(`Added ${relPath} to manifest.`);
            }
        });
    });
}

function commentLineInManifest(
    manifestPath: string,
    filePath: string,
    group: "views" | "wizard" | "controllers" | "data" | "security"
) {
    fs.readFile(manifestPath, 'utf8', (err, raw) => {
        if (err) {
            vscode.window.showErrorMessage('Failed to read manifest for deletion: ' + err.message);
            return;
        }
        const relPath = path.relative(path.dirname(manifestPath), filePath).replace(/\\/g, '/');
        const lines = raw.split('\n');
        let found = false;
        for (let i = 0; i < lines.length; i++) {
            if (
                lines[i].includes(`'${relPath}'`) &&
                !lines[i].trim().startsWith('#')
            ) {
                lines[i] = lines[i].replace(/^(\s*)/, '$1# ');
                found = true;
            }
        }
        if (!found) {
            vscode.window.showInformationMessage(`No entry for ${relPath} found in manifest to comment out.`);
            return;
        }
        fs.writeFile(manifestPath, lines.join('\n'), err2 => {
            if (err2) {
                vscode.window.showErrorMessage('Failed to update manifest for deletion: ' + err2.message);
            } else {
                vscode.window.showInformationMessage(`Commented out ${relPath} from manifest.`);
            }
        });
    });
}

function setupPythonWatcher(folder: string) {
    if (!folder) return;
    const initFile = path.join(folder, '__init__.py');
    if (!fs.existsSync(initFile)) {
        fs.writeFileSync(initFile, '', 'utf8');
    }
    const watcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(folder, '*.py')
    );
    watcher.onDidCreate(uri => {
        const filename = path.basename(uri.fsPath);
        if (filename === '__init__.py') return;
        if (!fs.existsSync(initFile)) {
            fs.writeFileSync(initFile, '', 'utf8');
        }
        addToInit(initFile, filename.replace('.py', ''));
    });
    watcher.onDidDelete(uri => {
        const filename = path.basename(uri.fsPath);
        if (filename === '__init__.py') return;
        commentInInit(initFile, filename.replace('.py', ''));
    });
}

function addToInit(initPath: string, moduleName: string) {
    fs.readFile(initPath, 'utf8', (err, data) => {
        if (err) return;
        const importLine = `from . import ${moduleName}`;
        const lines = data.split('\n');
        if (lines.some(l => l.trim() === importLine)) return;

        const importInfos: { line: string, idx: number, mod: string }[] = [];
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trim = line.trim();
            if (trim.startsWith('from . import ') && !trim.startsWith('#')) {
                const mod = trim.slice('from . import '.length).trim();
                importInfos.push({ line: line, idx: i, mod });
            }
        }

        const sortedMods = [...importInfos.map(e => e.mod), moduleName].sort((a, b) => a.localeCompare(b));
        const newIdxInSort = sortedMods.indexOf(moduleName);

        let insertAt = lines.length;
        if (importInfos.length === 0) {
            insertAt = lines.length;
        } else if (newIdxInSort === 0) {
            insertAt = importInfos[0].idx;
        } else {
            const prevMod = sortedMods[newIdxInSort - 1];
            let prev: { line: string; idx: number; mod: string } | undefined = undefined;
            for (let i = importInfos.length - 1; i >= 0; i--) {
                if (importInfos[i].mod === prevMod) {
                    prev = importInfos[i];
                    break;
                }
            }
            insertAt = prev ? prev.idx + 1 : lines.length;
        }

        lines.splice(insertAt, 0, importLine);
        fs.writeFile(initPath, lines.join('\n'), () => {});
    });
}

function commentInInit(initPath: string, moduleName: string) {
    fs.readFile(initPath, 'utf8', (err, data) => {
        if (err) return;
        const importLine = `from . import ${moduleName}`;
        const lines = data.split('\n');
        let changed = false;
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].trim() === importLine && !lines[i].trim().startsWith('#')) {
                lines[i] = '# ' + lines[i];
                changed = true;
            }
        }
        if (changed) {
            fs.writeFile(initPath, lines.join('\n'), () => {});
        }
    });
}

export function deactivate() {}