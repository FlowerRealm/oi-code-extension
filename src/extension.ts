/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as path from 'path';
import * as cp from 'child_process';
import * as util from 'util';
import * as fs from 'fs';
import * as os from 'os';
import { DockerManager } from './dockerManager';
import * as Diff from 'diff';
import { Installer } from './docker/install';

const exec = util.promisify(cp.exec);

function htmlEscape(str: string): string {
    return str.replace(/[&<>"'\/]/g, (match) => {
        const escape: { [key: string]: string } = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            '\'': '&#39;',
            '/': '&#x2F;',
        };
        return escape[match];
    });
}

// Helper to safely post messages to the webview
function postWebviewMessage(panel: vscode.WebviewPanel, command: string, data: any = {}) {
    try {
        panel.webview.postMessage({ command, ...data });
    } catch (e) {
        console.error(`Failed to post message '${command}' to webview:`, e);
    }
}

interface OiCodeSettings {
    c?: { path: string };
    cpp?: { path: string };
    python?: { path: string };
    workspace?: { path: string };
}

interface InitializationTask {
    name: string;
    execute: (panel: vscode.WebviewPanel, settings: OiCodeSettings) => Promise<boolean>;
}

class CompilerScanner {
    private async executeCommand(command: string): Promise<string[]> {
        try {
            const { stdout } = await exec(command);
            return stdout.trim().split(/\r?\n/).filter(p => p.trim());
        } catch (error) {
            return [];
        }
    }

    private async getCompilerVersion(compilerPath: string): Promise<string> {
        try {
            const { stdout } = await exec(`'${compilerPath}' --version`);
            return stdout.split('\n')[0].trim();
        } catch (e) {
            return '(无法获取版本)';
        }
    }

    public async scan(): Promise<{ gcc: { path: string; version: string }[]; gpp: { path: string; version: string }[]; python: { path: string; version: string }[] }> {
        const isWindows = process.platform === 'win32';
        const cCommands = isWindows ? ['where gcc', 'where clang'] : ['which -a gcc', 'which -a clang'];
        const cppCommands = isWindows ? ['where g++', 'where clang++'] : ['which -a g++', 'which -a clang++'];
        const pythonCommands = isWindows ? ['where python', 'where python3'] : ['which -a python', 'which -a python3'];

        let allCPaths: string[] = [];
        for (const cmd of cCommands) {
            allCPaths = allCPaths.concat(await this.executeCommand(cmd));
        }
        allCPaths = [...new Set(allCPaths)]; // Deduplicate


        let allCppPaths: string[] = [];
        for (const cmd of cppCommands) {
            allCppPaths = allCppPaths.concat(await this.executeCommand(cmd));
        }
        allCppPaths = [...new Set(allCppPaths)]; // Deduplicate

        let allPythonPaths: string[] = [];
        for (const cmd of pythonCommands) {
            allPythonPaths = allPythonPaths.concat(await this.executeCommand(cmd));
        }
        allPythonPaths = [...new Set(allPythonPaths)]; // Deduplicate

        const gccWithVersions = await Promise.all(allCPaths.map(async p => ({ path: p, version: await this.getCompilerVersion(p) })));
        const gppWithVersions = await Promise.all(allCppPaths.map(async p => ({ path: p, version: await this.getCompilerVersion(p) })));
        const pythonWithVersions = await Promise.all(allPythonPaths.map(async p => ({ path: p, version: await this.getCompilerVersion(p) })));

        return { gcc: gccWithVersions, gpp: gppWithVersions, python: pythonWithVersions };
    }
}

async function configureLanguage(type: 'c' | 'cpp' | 'python', settings: OiCodeSettings, panel: vscode.WebviewPanel) {
    try {
        const scanner = new CompilerScanner();
        const quickPick = vscode.window.createQuickPick();
        quickPick.title = `配置 ${type === 'c' ? 'C' : type === 'cpp' ? 'C++' : 'Python'} 环境`;
        quickPick.placeholder = `正在扫描可用的 ${type === 'c' ? 'C' : type === 'cpp' ? 'C++' : 'Python'} ...`;
        quickPick.ignoreFocusOut = true;
        quickPick.show();

        const compilers = await scanner.scan();
        const pathsWithVersions = type === 'c' ? compilers.gcc : type === 'cpp' ? compilers.gpp : compilers.python;

        const items: vscode.QuickPickItem[] = pathsWithVersions.map(item => ({ label: `${item.version} - ${item.path}`, description: '扫描到的路径', detail: item.path }));
        items.push({ label: `手动选择 ${type === 'c' ? 'C' : type === 'cpp' ? 'C++' : 'Python'} 路径...`, iconPath: new vscode.ThemeIcon('folder-opened') });
        items.push({ label: `帮我下载并配置...`, iconPath: new vscode.ThemeIcon('cloud-download') });
        items.push({ label: '暂不配置', iconPath: new vscode.ThemeIcon('circle-slash') });

        quickPick.items = items;
        quickPick.placeholder = `请选择一个 ${type === 'c' ? 'C 编译器' : type === 'cpp' ? 'C++ 编译器' : 'Python 解释器'}`;

        return new Promise<void>((resolve) => {
            let resolved = false;
            quickPick.onDidAccept(async () => {
                if (resolved) { return; }
                resolved = true;
                const selection = quickPick.selectedItems[0];
                if (selection) {
                    if (selection.description === '扫描到的路径') {
                        settings[type] = { path: selection.detail || selection.label };
                        vscode.window.showInformationMessage(`${type} 环境已设置为: ${settings[type]?.path}`);
                    } else if (selection.label.startsWith('手动选择')) {
                        const uris = await vscode.window.showOpenDialog({ canSelectMany: false, openLabel: '选择', canSelectFiles: true, canSelectFolders: false });
                        if (uris && uris.length > 0) {
                            settings[type] = { path: uris[0].fsPath };
                            vscode.window.showInformationMessage(`${type} 环境已设置为: ${uris[0].fsPath}`);
                        }
                    } else if (selection.label.startsWith('帮我下载')) {
                        // ...
                    }
                }
                quickPick.dispose();
                resolve();
            });
            quickPick.onDidHide(() => {
                if (resolved) { return; }
                resolved = true;
                quickPick.dispose();
                resolve();
            });
        });
    } catch (e) {
        vscode.window.showErrorMessage(`配置 ${type} 环境时出错: ${e}`);
        return Promise.resolve();
    }
}

function getTheme(kind: vscode.ColorThemeKind): string {
    return (kind === vscode.ColorThemeKind.Dark || kind === vscode.ColorThemeKind.HighContrast) ? 'dark' : 'light';
}

function getPairCheckWebviewContent(webview: vscode.Webview): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>对拍</title>
    <style>
        body, html { height: 100%; margin: 0; padding: 0; overflow: hidden; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji"; color: var(--vscode-editor-foreground); background-color: var(--vscode-editor-background); }
        .container { display: flex; flex-direction: column; height: 100%; }
        .input-section { display: flex; flex-direction: column; padding: 8px; border-bottom: 1px solid var(--vscode-panel-border); }
        .input-section textarea { flex-grow: 1; width: 98%; border: 1px solid var(--vscode-input-border); background-color: var(--vscode-input-background); color: var(--vscode-input-foreground); font-family: var(--vscode-editor-font-family); }
        .input-section button { margin-top: 8px; width: 100px; border: 1px solid var(--vscode-button-border); background-color: var(--vscode-button-background); color: var(--vscode-button-foreground); }
        .input-section button:hover { background-color: var(--vscode-button-hoverBackground); }
        .output-section { flex-grow: 1; display: flex; flex-direction: row; overflow: hidden; }
        .output-box { flex: 1; padding: 8px; overflow: auto; white-space: pre-wrap; word-wrap: break-word; font-family: var(--vscode-editor-font-family); }
        #output1-container { border-right: 1px solid var(--vscode-panel-border); }
        h4 { margin-top: 0; margin-bottom: 8px; }
        .diff-added { background-color: var(--vscode-editorGutter-addedBackground); }
        .diff-removed { background-color: var(--vscode-editorGutter-deletedBackground); }
    </style>
</head>
<body>
    <div class="container">
        <div class="input-section">
            <label for="input-data">输入数据:</label>
            <textarea id="input-data" rows="5"></textarea>
            <button id="run-button">运行对拍</button>
        </div>
        <div class="output-section">
            <div id="output1-container" class="output-box"><h4>左侧代码输出</h4><div id="output1-content"></div></div>
            <div id="output2-container" class="output-box"><h4>右侧代码输出</h4><div id="output2-content"></div></div>
        </div>
    </div>
    <script>
        const vscode = acquireVsCodeApi();
        document.getElementById('run-button').addEventListener('click', () => {
            const inputData = document.getElementById('input-data').value;
            vscode.postMessage({ command: 'runPairCheck', input: inputData });
        });
        window.addEventListener('message', event => {
            const message = event.data;
            switch (message.command) {
                case 'setOutputs':
                    document.getElementById('output1-content').innerHTML = message.output1;
                    document.getElementById('output2-content').innerHTML = message.output2;
                    break;
            }
        });
    </script>
</body>
</html>`;
}

async function runCodeInSandbox(codeFilePath: string, languageId: string, input: string, tempDir: string): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
        const execPromise = (cmd: string) => util.promisify(cp.exec)(cmd, { cwd: tempDir });

        const run = (command: string, args: string[]) => {
            let stdout = '';
            let stderr = '';
            const process = cp.spawn(command, args, { cwd: tempDir });
            process.stdin.write(input);
            process.stdin.end();
            process.stdout.on('data', (data) => { stdout += data.toString(); });
            process.stderr.on('data', (data) => { stderr += data.toString(); });
            process.on('close', (code) => {
                if (code === 0) {
                    resolve({ stdout, stderr });
                } else {
                    reject(new Error(`Execution failed with code ${code}\n${stderr}`));
                }
            });
            process.on('error', (err) => reject(err));
        };

        if (languageId === 'cpp') {
            const executablePath = path.join(tempDir, 'a.out');
            execPromise(`g++ -o ${executablePath} ${codeFilePath}`)
                .then(() => run(executablePath, []))
                .catch(err => reject(err));
        } else if (languageId === 'python') {
            run('python3', [codeFilePath]);
        } else {
            reject(new Error(`Unsupported language: ${languageId}`));
        }
    });
}

function createDiffHtml(output1: string, output2: string): { html1: string; html2: string } {
    const diff = Diff.diffLines(output1, output2);
    let html1 = '';
    let html2 = '';

    diff.forEach(part => {
        const escapedValue = htmlEscape(part.value);
        if (part.added) {
            html2 += `<span class="diff-added">${escapedValue}</span>`;
        } else if (part.removed) {
            html1 += `<span class="diff-removed">${escapedValue}</span>`;
        } else {
            html1 += escapedValue;
            html2 += escapedValue;
        }
    });

    return { html1, html2 };
}

class PairCheckViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'oicode.pairCheckView';
    private _view?: vscode.WebviewView;

    constructor(private readonly _context: vscode.ExtensionContext) { }

    resolveWebviewView(webviewView: vscode.WebviewView, context: vscode.WebviewViewResolveContext, _token: vscode.CancellationToken) {
        this._view = webviewView;
        webviewView.webview.options = { enableScripts: true, localResourceRoots: [this._context.extensionUri] };
        webviewView.webview.html = getPairCheckWebviewContent(webviewView.webview);

        webviewView.webview.onDidReceiveMessage(async (message: any) => {
            if (message.command === 'runPairCheck') {
                try {
                    const editors = vscode.window.visibleTextEditors.filter(e => !e.document.isUntitled && (e.document.languageId === 'cpp' || e.document.languageId === 'python'));
                    if (editors.length < 2) {
                        vscode.window.showErrorMessage('需要打开至少两个C++/Python代码文件才能进行对拍。');
                        return;
                    }
                    const [editor1, editor2] = editors.sort((a, b) => a.viewColumn! - b.viewColumn!);
                    const langId = editor1.document.languageId;
                    if (editor2.document.languageId !== langId) {
                        vscode.window.showErrorMessage('两个代码文件的语言类型必须相同。');
                        return;
                    }

                    this.setOutputs('<i>正在运行...</i>', '<i>正在运行...</i>');
                    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oi-code-'));
                    const file1Path = path.join(tempDir, `code1.${langId}`);
                    const file2Path = path.join(tempDir, `code2.${langId}`);
                    fs.writeFileSync(file1Path, editor1.document.getText());
                    fs.writeFileSync(file2Path, editor2.document.getText());

                    const [result1, result2] = await Promise.all([
                        runCodeInSandbox(file1Path, langId, message.input, tempDir).catch(e => ({ stdout: '', stderr: e.message })),
                        runCodeInSandbox(file2Path, langId, message.input, tempDir).catch(e => ({ stdout: '', stderr: e.message }))
                    ]);

                    const output1 = result1.stderr ? `<b>错误:</b>\n${htmlEscape(result1.stderr)}` : result1.stdout;
                    const output2 = result2.stderr ? `<b>错误:</b>\n${htmlEscape(result2.stderr)}` : result2.stdout;

                    if (result1.stderr || result2.stderr) {
                        this.setOutputs(output1, output2);
                    } else if (output1 === output2) {
                        this.setOutputs('<span style="color:var(--vscode-terminal-ansiGreen);">输出一致 (Accepted)</span>', '<span style="color:var(--vscode-terminal-ansiGreen);">输出一致 (Accepted)</span>');
                    } else {
                        const { html1, html2 } = createDiffHtml(output1, output2);
                        this.setOutputs(html1, html2);
                    }

                    fs.rm(tempDir, { recursive: true, force: true }, () => { });

                } catch (e: any) {
                    vscode.window.showErrorMessage(`对拍时发生错误: ${e.message}`);
                    this.setOutputs(`<b>错误:</b>\n${htmlEscape(e.message)}`, `<b>错误:</b>\n${htmlEscape(e.message)}`);
                }
            }
        });
    }

    public setOutputs(output1: string, output2: string) {
        if (this._view) {
            this._view.show?.(true);
            this._view.webview.postMessage({ command: 'setOutputs', output1, output2 });
        }
    }
}

export function activate(context: vscode.ExtensionContext) {



    const pairCheckProvider = new PairCheckViewProvider(context);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(PairCheckViewProvider.viewType, pairCheckProvider)
    );

    context.subscriptions.push(vscode.commands.registerCommand('oi-code.showSettingsPage', () => {
        const panel = vscode.window.createWebviewPanel(
            'oiCodeSettings',
            'OI-Code 设置',
            vscode.ViewColumn.One,
            { enableScripts: true, retainContextWhenHidden: true }
        );

        getWebviewContent(context, 'settings.html').then(html => panel.webview.html = html);

        const themeListener = vscode.window.onDidChangeActiveColorTheme(e => {
            postWebviewMessage(panel, 'set-theme', { theme: getTheme(e.kind) });
        });

        panel.onDidDispose(() => {
            themeListener.dispose();
        });

        panel.webview.onDidReceiveMessage(async message => {
            // ... (omitted for brevity)
        });
    }));

    context.subscriptions.push(vscode.commands.registerCommand('oi-code.showCompletionPage', () => {
        // ... (omitted for brevity)
    }));

    context.subscriptions.push(vscode.commands.registerCommand('oi-code.showWelcomePage', () => {
        // ... (omitted for brevity)
    }));

    context.subscriptions.push(vscode.commands.registerCommand('oicode.startPairCheck', async () => {
        const activeEditor = vscode.window.activeTextEditor;
        if (!activeEditor) {
            vscode.window.showErrorMessage('请先打开一个文件再开始对拍。');
            return;
        }

        const originalDoc = activeEditor.document;

        const pairDoc = await vscode.workspace.openTextDocument({
            content: `// 在这里粘贴或编写你的对拍代码\n// 例如，一个暴力解法\n`,
            language: originalDoc.languageId
        });

        await vscode.window.showTextDocument(pairDoc, vscode.ViewColumn.Beside);

        await vscode.commands.executeCommand('oicode.pairCheckView.focus');
    }));

    context.subscriptions.push(vscode.commands.registerCommand('oicode.runCode', async (testInput?: string) => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return vscode.window.showErrorMessage('Please open a file to run.');
        }

        const document = editor.document;
        const languageId = document.languageId as 'c' | 'cpp' | 'python';
        const sourceFile = path.basename(document.fileName);

        const config = vscode.workspace.getConfiguration('oi-code.language');
        const compilerCommand = config.get<string>(`${languageId}.Command`);
        const compilerArgs = config.get<string[]>(`${languageId}.Args`);

        if (!compilerCommand) {
            return vscode.window.showErrorMessage(`Compiler command not configured for ${languageId}. Please check your settings.`);
        }

        const fullCommand = [compilerCommand, ...(compilerArgs || [])].join(' ');

        let input: string | undefined;
        if (testInput !== undefined) {
            input = testInput;
        } else {
            input = await vscode.window.showInputBox({
                prompt: 'Enter input for the program',
                placeHolder: 'Type your input here...'
            });
            if (input === undefined) {
                return; // User cancelled
            }
        }

        // Placeholder values for time and memory limits
        const timeLimit = 5; // seconds
        const memoryLimit = 256; // MB

        vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Running ${sourceFile} in Docker...`,
            cancellable: false
        }, async (progress) => {
            progress.report({ increment: 0, message: 'Preparing container...' });
            try {
                const result = await DockerManager.run({
                    projectRootPath: context.extensionPath,
                    sourceDir: path.dirname(document.uri.fsPath),
                    command: fullCommand,
                    input: input || '',
                    timeLimit: timeLimit,
                    memoryLimit: memoryLimit
                });

                progress.report({ increment: 100 });

                const panel = vscode.window.createWebviewPanel(
                    'oiCodeOutput',
                    `Output for ${sourceFile}`,
                    vscode.ViewColumn.Two,
                    {}
                );

                let content = `<h1>Verdict: ${result.verdict}</h1>`;
                if (result.output) {
                    content += `<h2>Output:</h2><pre>${htmlEscape(result.output)}</pre>`;
                }
                if (result.error) {
                    content += `<h2>Error:</h2><pre>${htmlEscape(result.error)}</pre>`;
                }
                panel.webview.html = content;

            } catch (e: any) {
                vscode.window.showErrorMessage(`An unexpected error occurred: ${e.message}`);
            }
        });
    }));

    context.subscriptions.push(vscode.commands.registerCommand('oicode.initializeEnvironment', async () => {
        vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Initializing OI-Code Environment',
            cancellable: false // Building an image cannot be cancelled easily
        }, async (progress) => {
            progress.report({ message: 'Building Docker image, this may take a while...' });
            try {
                await DockerManager.ensureImage(context.extensionPath);
                progress.report({ message: 'Docker image ready!', increment: 100 });
                vscode.window.showInformationMessage('OI-Code Docker environment is ready!');
            } catch (error: any) {
                progress.report({ message: 'Failed to initialize Environment.', increment: 100 });
                vscode.window.showErrorMessage(`Failed to initialize environment: ${error.message}`);
            }
        });
    }));

    context.subscriptions.push(vscode.commands.registerCommand('oicode.downloadDocker', async () => {
        const installCommand = Installer.getInstallCommand();
        if (installCommand) {
            vscode.window.showInformationMessage(
                installCommand.message,
                'Run in Terminal' // Button text
            ).then(selection => {
                if (selection === 'Run in Terminal') {
                    const terminal = vscode.window.createTerminal('Docker Installer');
                    terminal.show();
                    if (installCommand.isUrl) {
                        vscode.env.openExternal(vscode.Uri.parse(installCommand.command));
                        terminal.sendText(`echo "Opening browser to: ${installCommand.command}"`);
                    } else {
                        terminal.sendText(installCommand.command);
                    }
                }
            });
        } else {
            vscode.window.showErrorMessage('Could not determine Docker installation command for your system.');
        }
    }));

    const hasLaunchedBeforeKey = 'oi-ide.hasLaunchedBefore';
    if (!context.globalState.get<boolean>(hasLaunchedBeforeKey)) {
        vscode.commands.executeCommand('oi-code.showWelcomePage');
        context.globalState.update(hasLaunchedBeforeKey, true);
    }

    if (context.globalState.get<boolean>('oi-code.initializationComplete')) {
        context.globalState.update('oi-code.initializationComplete', false);
        vscode.commands.executeCommand('oi-code.showCompletionPage');
    }
}

async function getWebviewContent(context: vscode.ExtensionContext, fileName: string): Promise<string> {
    const filePath = vscode.Uri.file(path.join(context.extensionPath, 'dist', fileName));
    try {
        const content = await vscode.workspace.fs.readFile(filePath);
        return content.toString();
    } catch (e) {
        console.error(`Failed to read ${fileName}`, e);
        return `<h1>Error: Could not load page.</h1><p>${e}</p>`;
    }
}

export function deactivate() { }
