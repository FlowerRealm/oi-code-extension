/* ---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *-------------------------------------------------------------------------------------------- */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as Diff from 'diff';
import { NativeCompilerManager, CompilerInfo } from './nativeCompiler';
import {
    DEFAULT_MEMORY_LIMIT,
    DEFAULT_PAIR_CHECK_TIME_LIMIT,
    DEFAULT_PAIR_CHECK_MEMORY_LIMIT,
    DEFAULT_SINGLE_RUN_TIME_LIMIT,
    OI_CODE_TEST_BASE_PATH,
    OI_CODE_TEST_TMP_PATH
} from './constants';

/**
 * Public function: Detect and select suitable compiler
 * @param context VS Code extension context
 * @param languageId Language ID ('c' or 'cpp')
 * @returns Returns selected compiler information, throws error if no suitable compiler found
 */
async function getSuitableCompiler(context: vscode.ExtensionContext, languageId: 'c' | 'cpp'): Promise<CompilerInfo> {
    // Detect available compilers
    let compilerResult = await NativeCompilerManager.detectCompilers(context);
    if (!compilerResult.success || compilerResult.compilers.length === 0) {
        const choice = await vscode.window.showErrorMessage(
            'No C/C++ compilers found. Please set up a compiler to proceed.',
            'Setup Compiler'
        );
        if (choice === 'Setup Compiler') {
            await vscode.commands.executeCommand('oicode.setupCompiler');
            // After setup, re-detect compilers to see if installation was successful
            compilerResult = await NativeCompilerManager.forceRescanCompilers(context);
        }

        if (!compilerResult.success || compilerResult.compilers.length === 0) {
            NativeCompilerManager.getOutputChannel().appendLine(
                `Compiler detection failed. Suggestions: ${compilerResult.suggestions.join(', ')}`
            );
            throw new Error('No compilers available. Please set up a compiler first.');
        }
    }

    // Select suitable compiler for the language
    const suitableCompilers = NativeCompilerManager.filterSuitableCompilers(languageId, compilerResult.compilers);

    if (suitableCompilers.length === 0) {
        throw new Error(`No suitable compiler found for ${languageId}`);
    }

    return suitableCompilers[0];
}

function htmlEscape(str: string): string {
    return str.replace(/[&<>"'/]/g, match => {
        const escape: { [key: string]: string } = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;',
            '/': '&#x2F;'
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

function getTheme(kind: vscode.ColorThemeKind): string {
    return kind === vscode.ColorThemeKind.Dark || kind === vscode.ColorThemeKind.HighContrast ? 'dark' : 'light';
}

function getPairCheckWebviewContent(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Pair Check</title>
    <style>
        body, html {
            height: 100%;
            margin: 0;
            padding: 0;
            overflow: hidden;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
                "Helvetica Neue", Arial, "Noto Sans", sans-serif,
                "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol",
                "Noto Color Emoji";
            color: var(--vscode-editor-foreground);
            background-color: var(--vscode-editor-background);
        }
        .container { display: flex; flex-direction: column; height: 100%; }
        .input-section {
            display: flex;
            flex-direction: column;
            padding: 8px;
            border-bottom: 1px solid var(--vscode-panel-border);
        }
        .input-section textarea {
            flex-grow: 1;
            width: 98%;
            border: 1px solid var(--vscode-input-border);
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            font-family: var(--vscode-editor-font-family);
        }
        .input-section button {
            margin-top: 8px;
            width: 100px;
            border: 1px solid var(--vscode-button-border);
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }
        .input-section button:hover { background-color: var(--vscode-button-hoverBackground); }
        .output-section { flex-grow: 1; display: flex; flex-direction: row; overflow: hidden; }
        .output-box {
            flex: 1;
            padding: 8px;
            overflow: auto;
            white-space: pre-wrap;
            word-wrap: break-word;
            font-family: var(--vscode-editor-font-family);
        }
        #output1-container { border-right: 1px solid var(--vscode-panel-border); }
        h4 { margin-top: 0; margin-bottom: 8px; }
        .diff-added { background-color: var(--vscode-editorGutter-addedBackground); }
        .diff-removed { background-color: var(--vscode-editorGutter-deletedBackground); }
    </style>
</head>
<body>
    <div class="container">
        <div class="input-section">
            <label for="input-data">Input data:</label>
            <textarea id="input-data" rows="5"></textarea>
            <button id="run-button">Run Pair Check</button>
        </div>
        <div class="output-section">
            <div id="output1-container" class="output-box">
                <h4>Left Code Output</h4>
                <div id="output1-content"></div>
            </div>
            <div id="output2-container" class="output-box">
                <h4>Right Code Output</h4>
                <div id="output2-content"></div>
            </div>
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

async function runPairWithNativeCompilers(
    context: vscode.ExtensionContext,
    sourcePath1: string,
    sourcePath2: string,
    languageId: 'c' | 'cpp',
    input: string,
    options?: { timeLimit?: number; memoryLimit?: number }
): Promise<{
    result1: { stdout: string; stderr: string; timedOut?: boolean; memoryExceeded?: boolean; spaceExceeded?: boolean };
    result2: { stdout: string; stderr: string; timedOut?: boolean; memoryExceeded?: boolean; spaceExceeded?: boolean };
}> {
    // Use public function to get suitable compiler
    const compiler = await getSuitableCompiler(context, languageId);
    const timeLimit = options?.timeLimit ?? DEFAULT_PAIR_CHECK_TIME_LIMIT;
    const memoryLimit = options?.memoryLimit ?? DEFAULT_PAIR_CHECK_MEMORY_LIMIT;

    // Run both programs in parallel
    const [result1, result2] = await Promise.all([
        NativeCompilerManager.compileAndRun({
            sourcePath: sourcePath1,
            language: languageId,
            compiler: compiler,
            input: input,
            timeLimit,
            memoryLimit
        }),
        NativeCompilerManager.compileAndRun({
            sourcePath: sourcePath2,
            language: languageId,
            compiler: compiler,
            input: input,
            timeLimit,
            memoryLimit
        })
    ]);

    return { result1, result2 };
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

function getLanguageIdFromEditor(editor: vscode.TextEditor): 'c' | 'cpp' {
    const langId = editor.document.languageId;
    if (langId === 'c' || langId === 'cpp') {
        return langId;
    }
    throw new Error(`Unsupported language: ${langId}`);
}

class PairCheckViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'oicode.pairCheckView';
    private _view?: vscode.WebviewView;

    constructor(private readonly _context: vscode.ExtensionContext) {}

    resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ) {
        this._view = webviewView;
        webviewView.webview.options = { enableScripts: true, localResourceRoots: [this._context.extensionUri] };
        webviewView.webview.html = getPairCheckWebviewContent();

        webviewView.webview.onDidReceiveMessage(async (message: any) => {
            if (message.command === 'runPairCheck') {
                try {
                    const editors = vscode.window.visibleTextEditors.filter(
                        e =>
                            !e.document.isUntitled && (e.document.languageId === 'c' || e.document.languageId === 'cpp')
                    );
                    if (editors.length < 2) {
                        vscode.window.showErrorMessage(
                            'Need to open at least two C/C++ code files to perform pair check.'
                        );
                        return;
                    }
                    const [editor1, editor2] = editors.sort((a, b) => a.viewColumn! - b.viewColumn!);
                    const langId = getLanguageIdFromEditor(editor1);
                    if (editor2.document.languageId !== langId) {
                        vscode.window.showErrorMessage('Both code files must have the same language type.');
                        return;
                    }

                    this.setOutputs('<i>Running...</i>', '<i>Running...</i>');
                    await fs.promises.mkdir(OI_CODE_TEST_BASE_PATH, { recursive: true });
                    const tempDir = await fs.promises.mkdtemp(path.join(OI_CODE_TEST_BASE_PATH, 'pair-'));

                    // Define file extensions with proper language extensions
                    const file1Path = path.join(tempDir, `code1.${langId}`);
                    const file2Path = path.join(tempDir, `code2.${langId}`);
                    await fs.promises.writeFile(file1Path, editor1.document.getText());
                    await fs.promises.writeFile(file2Path, editor2.document.getText());

                    // Use native compilers for pair check
                    const pairResult = await runPairWithNativeCompilers(
                        this._context,
                        file1Path,
                        file2Path,
                        langId,
                        message.input,
                        { timeLimit: DEFAULT_PAIR_CHECK_TIME_LIMIT, memoryLimit: DEFAULT_PAIR_CHECK_MEMORY_LIMIT }
                    );
                    const result1 = pairResult.result1;
                    const result2 = pairResult.result2;

                    const output1 = result1.stderr ? `<b>Error:</b>\n${htmlEscape(result1.stderr)}` : result1.stdout;
                    const output2 = result2.stderr ? `<b>Error:</b>\n${htmlEscape(result2.stderr)}` : result2.stdout;

                    if (result1.stderr || result2.stderr) {
                        this.setOutputs(output1, output2);
                    } else if (output1 === output2) {
                        this.setOutputs(
                            '<span style="color:var(--vscode-terminal-ansiGreen);">Output matches (Accepted)</span>',
                            '<span style="color:var(--vscode-terminal-ansiGreen);">Output matches (Accepted)</span>'
                        );
                    } else {
                        const { html1, html2 } = createDiffHtml(output1, output2);
                        this.setOutputs(html1, html2);
                    }

                    await fs.promises.rm(tempDir, { recursive: true, force: true });
                } catch (e: any) {
                    vscode.window.showErrorMessage(`Pair check error: ${e.message}`);
                    this.setOutputs(
                        `<b>Error:</b>\n${htmlEscape(e.message)}`,
                        `<b>Error:</b>\n${htmlEscape(e.message)}`
                    );
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
    try {
        console.log('OI-Code extension is now active!');
        console.log('Extension path:', context.extensionPath);

        // Initialize compiler manager
        NativeCompilerManager.detectCompilers(context)
            .then(result => {
                if (result.success) {
                    console.log(`Detected ${result.compilers.length} compilers`);
                    if (result.recommended) {
                        console.log(`Recommended compiler: ${result.recommended.name}`);
                    }
                } else {
                    console.log('Compiler detection failed:', result.error);
                }
            })
            .catch(error => {
                console.error('Failed to detect compilers:', error);
            });

        // Register WebviewView providers
        console.log('PairCheckViewProvider will be registered later');

        // Sidebar: Problem view (inputs, statement editor, limits, options, actions)
        context.subscriptions.push(
            vscode.window.registerWebviewViewProvider('oicode.problemView', {
                async resolveWebviewView(
                    webviewView: vscode.WebviewView,
                    _context: vscode.WebviewViewResolveContext,
                    _token: vscode.CancellationToken
                ) {
                    webviewView.webview.options = {
                        enableScripts: true,
                        localResourceRoots: [context.extensionUri]
                    };
                    webviewView.webview.html = await getWebviewContent(context, 'problem.html');

                    function toSafeName(input: string): string {
                        const s = input || 'unnamed';
                        return s.replace(/[^\w-.]+/g, '_').slice(0, 64);
                    }

                    async function pickProblemsBaseDir(): Promise<string> {
                        const saved = context.globalState.get<string>('oicode.lastProblemsBaseDir');
                        if (saved) {
                            try {
                                await fs.promises.access(saved);
                                const choice = await vscode.window.showQuickPick(
                                    [
                                        { label: `Use previous：${saved}`, value: 'saved' },
                                        { label: 'Choose again...', value: 'pick' }
                                    ],
                                    { placeHolder: 'Choose problem root directory' }
                                );
                                if (!choice) {
                                    throw new Error('Problem root directory not selected');
                                }
                                if (choice.value === 'saved') {
                                    return saved;
                                }
                            } catch {}
                        }
                        const pick = await vscode.window.showOpenDialog({
                            canSelectFolders: true,
                            canSelectFiles: false,
                            canSelectMany: false,
                            openLabel: 'Choose problem root directory'
                        });
                        if (!pick || !pick[0]) {
                            throw new Error('Problem root directory not selected');
                        }
                        const baseDir = pick[0].fsPath;
                        context.globalState.update('oicode.lastProblemsBaseDir', baseDir);
                        return baseDir;
                    }

                    async function ensureProblemStructure(m: any): Promise<{ sourcePath: string }> {
                        const active = vscode.window.activeTextEditor;
                        if (!active) {
                            throw new Error('Please open a source file in the editor first.');
                        }
                        const langId = getLanguageIdFromEditor(active);
                        const problemName = toSafeName(m.name);

                        const baseDir = await pickProblemsBaseDir();

                        const problemDir = path.join(baseDir, problemName);
                        const configDir = path.join(problemDir, 'config');
                        await fs.promises.mkdir(problemDir, { recursive: true });
                        await fs.promises.mkdir(configDir, { recursive: true });

                        // Write source file
                        const sourcePath = path.join(problemDir, `main.${langId}`);
                        await fs.promises.writeFile(sourcePath, active.document.getText(), 'utf8');

                        // Write config files
                        const configJson = {
                            name: m.name || '',
                            url: m.url || '',
                            timeLimit: Number(m.timeLimit) || 5,
                            memoryLimit: Number(m.memoryLimit) || 256,
                            opt: m.opt || '',
                            std: m.std || ''
                        };
                        await fs.promises.writeFile(
                            path.join(configDir, 'problem.json'),
                            JSON.stringify(configJson, null, 2),
                            'utf8'
                        );
                        if (m.statement)
                            await fs.promises.writeFile(path.join(configDir, 'statement.md'), m.statement, 'utf8');
                        if (m.samples)
                            await fs.promises.writeFile(path.join(configDir, 'samples.txt'), m.samples, 'utf8');

                        return { sourcePath };
                    }

                    webviewView.webview.onDidReceiveMessage(async (m: any) => {
                        if (m.cmd === 'loadSamples') {
                            const uris = await vscode.window.showOpenDialog({
                                canSelectMany: false,
                                openLabel: 'Select sample file'
                            });
                            if (uris && uris[0]) {
                                const buf = await vscode.workspace.fs.readFile(uris[0]);
                                const text = buf.toString();
                                webviewView.webview.postMessage({ cmd: 'samplesLoaded', text });
                            }
                        } else if (m.cmd === 'run') {
                            try {
                                const { sourcePath } = await ensureProblemStructure(m);
                                const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(sourcePath));
                                await vscode.window.showTextDocument(doc, { preview: false });
                                await vscode.commands.executeCommand('oicode.runCode', m.samples || '', {
                                    timeLimit: m.timeLimit,
                                    memoryLimit: m.memoryLimit
                                });
                            } catch (e: any) {
                                vscode.window.showErrorMessage(e.message || String(e));
                            }
                        } else if (m.cmd === 'pair') {
                            await vscode.commands.executeCommand('oicode.runPairCheck', m.samples || '', {
                                timeLimit: m.timeLimit,
                                memoryLimit: m.memoryLimit
                            });
                        }
                    });
                }
            })
        );

        // Command: create a new problem skeleton by name
        context.subscriptions.push(
            vscode.commands.registerCommand(
                'oicode.createProblem',
                async (payload?: { name?: string; language?: 'c' | 'cpp'; baseDir?: string }) => {
                    try {
                        let name = payload?.name;
                        if (!name) {
                            name =
                                (await vscode.window.showInputBox({
                                    prompt: 'Enter problem name (will be used as folder name)',
                                    placeHolder: 'e.g.: CF1234A'
                                })) || '';
                        }
                        if (!name) {
                            return;
                        }
                        const safe = name.replace(/[^\w-.]+/g, '_').slice(0, 64);

                        let baseDir = payload?.baseDir || context.globalState.get<string>('oicode.lastProblemsBaseDir');
                        if (baseDir) {
                            try {
                                await fs.promises.access(baseDir);
                            } catch {
                                baseDir = undefined;
                            }
                        }
                        if (!baseDir) {
                            const pick = await vscode.window.showOpenDialog({
                                canSelectFolders: true,
                                canSelectFiles: false,
                                canSelectMany: false,
                                openLabel: 'Choose problem root directory'
                            });
                            if (!pick || !pick[0]) {
                                return;
                            }
                            baseDir = pick[0].fsPath;
                        }
                        context.globalState.update('oicode.lastProblemsBaseDir', baseDir);

                        let langId = payload?.language as ('c' | 'cpp') | undefined;
                        if (!langId) {
                            const langPick = await vscode.window.showQuickPick(
                                [
                                    { label: 'C', detail: 'main.c', value: 'c' },
                                    { label: 'C++', detail: 'main.cpp', value: 'cpp' }
                                ],
                                { placeHolder: 'Select language' }
                            );
                            if (!langPick) {
                                return;
                            }
                            langId = langPick.value as 'c' | 'cpp';
                        }
                        if (langId) {
                            const ext = langId;
                            const problemDir = path.join(baseDir, safe);
                            const configDir = path.join(problemDir, 'config');
                            await fs.promises.mkdir(problemDir, { recursive: true });
                            await fs.promises.mkdir(configDir, { recursive: true });
                            // Template source - Use empty file instead of template code
                            const sourcePath = path.join(problemDir, `main.${ext}`);
                            try {
                                await fs.promises.access(sourcePath);
                            } catch {
                                // Create empty file and let user write code themselves
                                await fs.promises.writeFile(sourcePath, '', 'utf8');
                            }
                            // Default config
                            const problemJsonPath = path.join(configDir, 'problem.json');
                            try {
                                await fs.promises.access(problemJsonPath);
                            } catch {
                                await fs.promises.writeFile(
                                    problemJsonPath,
                                    JSON.stringify(
                                        { name: safe, url: '', timeLimit: 5, memoryLimit: 256, opt: '', std: '' },
                                        null,
                                        2
                                    ),
                                    'utf8'
                                );
                            }
                            const statementPath = path.join(configDir, 'statement.md');
                            try {
                                await fs.promises.access(statementPath);
                            } catch {
                                await fs.promises.writeFile(
                                    statementPath,
                                    `# ${safe}\n\nWrite problem statement here...\n`,
                                    'utf8'
                                );
                            }
                            const samplesPath = path.join(configDir, 'samples.txt');
                            try {
                                await fs.promises.access(samplesPath);
                            } catch {
                                await fs.promises.writeFile(samplesPath, '', 'utf8');
                            }

                            const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(sourcePath));
                            await vscode.window.showTextDocument(doc, { preview: false });
                            vscode.window.showInformationMessage(`Problem created：${safe}`);
                            return { problemDir, sourcePath };
                        }
                    } catch (e: any) {
                        vscode.window.showErrorMessage(`Failed to create problem：${e.message || e}`);
                        return { error: e?.message || String(e) };
                    }
                }
            )
        );

        const pairCheckProvider = new PairCheckViewProvider(context);
        context.subscriptions.push(
            vscode.window.registerWebviewViewProvider(PairCheckViewProvider.viewType, pairCheckProvider)
        );

        context.subscriptions.push(
            vscode.commands.registerCommand('oi-code.showSettingsPage', () => {
                const panel = vscode.window.createWebviewPanel(
                    'oiCodeSettings',
                    'OI-Code Settings',
                    vscode.ViewColumn.One,
                    { enableScripts: true, retainContextWhenHidden: true }
                );

                getWebviewContent(context, 'settings.html').then(html => (panel.webview.html = html));

                const themeListener = vscode.window.onDidChangeActiveColorTheme(e => {
                    postWebviewMessage(panel, 'set-theme', { theme: getTheme(e.kind) });
                });

                panel.onDidDispose(() => {
                    themeListener.dispose();
                });
            })
        );

        context.subscriptions.push(
            vscode.commands.registerCommand('oi-code.showCompletionPage', () => {
                // ... (omitted for brevity)
            })
        );

        context.subscriptions.push(
            vscode.commands.registerCommand('oi-code.showWelcomePage', () => {
                // ... (omitted for brevity)
            })
        );

        context.subscriptions.push(
            vscode.commands.registerCommand('oicode.startPairCheck', async () => {
                const activeEditor = vscode.window.activeTextEditor;
                if (!activeEditor) {
                    vscode.window.showErrorMessage('Please open a file first to start pair check.');
                    return;
                }

                const originalDoc = activeEditor.document;

                const pairDoc = await vscode.workspace.openTextDocument({
                    content: '// Place or write your pair check code here\n// For example, a brute force solution\n',
                    language: originalDoc.languageId
                });

                await vscode.window.showTextDocument(pairDoc, vscode.ViewColumn.Beside);

                await vscode.commands.executeCommand('oicode.pairCheckView.focus');
            })
        );

        // Programmatic pair-check command for tests and headless execution
        context.subscriptions.push(
            vscode.commands.registerCommand(
                'oicode.runPairCheck',
                async (testInput?: string, options?: { timeLimit?: number; memoryLimit?: number }) => {
                    const editors = vscode.window.visibleTextEditors.filter(
                        e =>
                            !e.document.isUntitled && (e.document.languageId === 'cpp' || e.document.languageId === 'c')
                    );
                    if (editors.length < 2) {
                        vscode.window.showErrorMessage(
                            'Need to open at least two C/C++ code files to perform pair check.'
                        );
                        return { error: 'NEED_TWO_EDITORS' };
                    }
                    const [editor1, editor2] = editors.sort((a, b) => (a.viewColumn || 0) - (b.viewColumn || 0));
                    const langId = getLanguageIdFromEditor(editor1);
                    if (editor2.document.languageId !== langId) {
                        vscode.window.showErrorMessage('Both code files must have the same language type.');
                        return { error: 'LANG_MISMATCH' };
                    }

                    // Wait for editor content to load completely (using more reliable mechanism)
                    let attempts = 0;
                    const maxAttempts = 10;
                    const checkInterval = 200; // Check every 200ms

                    while (attempts < maxAttempts) {
                        const editor1Content = editor1.document.getText();
                        const editor2Content = editor2.document.getText();
                        if (editor1Content.length > 0 && editor2Content.length > 0) {
                            break; // Content loaded successfully
                        }
                        attempts++;
                        await new Promise(resolve => setTimeout(resolve, checkInterval));
                    }

                    // Final check
                    const finalEditor1Content = editor1.document.getText();
                    const finalEditor2Content = editor2.document.getText();
                    if (finalEditor1Content.length === 0 || finalEditor2Content.length === 0) {
                        vscode.window.showErrorMessage('Editor content load timeout, please try again later.');
                        return { error: 'EDITOR_CONTENT_LOAD_TIMEOUT' };
                    }

                    // const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oi-code-'));
                    await fs.promises.mkdir(OI_CODE_TEST_TMP_PATH, { recursive: true });
                    const tempDir = await fs.promises.mkdtemp(path.join(OI_CODE_TEST_TMP_PATH, 'oi-code-'));
                    try {
                        const file1Path = path.join(tempDir, `code1.${langId}`);
                        const file2Path = path.join(tempDir, `code2.${langId}`);
                        await fs.promises.writeFile(file1Path, finalEditor1Content);
                        await fs.promises.writeFile(file2Path, finalEditor2Content);

                        const input = testInput ?? '';
                        // Use provided options or fallback to defaults
                        const timeLimit = options?.timeLimit ?? DEFAULT_PAIR_CHECK_TIME_LIMIT; // seconds

                        // Use native compilers for pair check
                        const pairResult = await runPairWithNativeCompilers(
                            context,
                            file1Path,
                            file2Path,
                            langId,
                            input,
                            { timeLimit, memoryLimit: DEFAULT_PAIR_CHECK_MEMORY_LIMIT }
                        );
                        const result1 = pairResult.result1;
                        const result2 = pairResult.result2;

                        const toDisplay = (r: any) => {
                            if (r.timedOut) return 'TIMEOUT';
                            if (r.memoryExceeded) return 'MEMORY_EXCEEDED';
                            if (r.spaceExceeded) return 'SPACE_EXCEEDED';
                            return r.stderr ? `ERROR:\n${r.stderr}` : r.stdout;
                        };
                        const output1 = toDisplay(result1 as any);
                        const output2 = toDisplay(result2 as any);
                        const norm = (s: string) => s.replace(/\r\n/g, '\n').trimEnd();
                        const equal = norm(output1) === norm(output2);
                        // Update panel view if present
                        pairCheckProvider.setOutputs(htmlEscape(output1), htmlEscape(output2));
                        return { output1, output2, equal };
                    } catch (e: any) {
                        vscode.window.showErrorMessage(`Pair check execution error: ${e.message}`);
                        return { error: e.message };
                    } finally {
                        await fs.promises.rm(tempDir, { recursive: true, force: true });
                    }
                }
            )
        );

        context.subscriptions.push(
            vscode.commands.registerCommand(
                'oicode.runCode',
                async (testInput?: string, options?: { timeLimit?: number; memoryLimit?: number }) => {
                    const editor = vscode.window.activeTextEditor;
                    if (!editor) {
                        return vscode.window.showErrorMessage('Please open a file to run.');
                    }
                    const document = editor.document;
                    const languageId = document.languageId as 'c' | 'cpp';
                    const sourceFile = path.basename(document.fileName);
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
                    // Use provided options or fallback to defaults
                    const timeLimit = options?.timeLimit ?? DEFAULT_SINGLE_RUN_TIME_LIMIT; // seconds
                    const memoryLimit = options?.memoryLimit ?? DEFAULT_MEMORY_LIMIT; // MB

                    return vscode.window.withProgress(
                        {
                            location: vscode.ProgressLocation.Notification,
                            title: `Running ${sourceFile}...`,
                            cancellable: false
                        },
                        async progress => {
                            progress.report({ increment: 0, message: 'Detecting compilers...' });
                            try {
                                // Use public function to get suitable compiler
                                const compiler = await getSuitableCompiler(context, languageId);
                                progress.report({ increment: 50, message: `Compiling with ${compiler.type}...` });

                                // Execute with native compiler
                                const result = await NativeCompilerManager.compileAndRun({
                                    sourcePath: document.uri.fsPath,
                                    language: languageId,
                                    compiler: compiler,
                                    input: input || '',
                                    timeLimit,
                                    memoryLimit
                                });

                                progress.report({ increment: 100 });
                                const panel = vscode.window.createWebviewPanel(
                                    'oiCodeOutput',
                                    `Output for ${sourceFile}`,
                                    vscode.ViewColumn.Two,
                                    {}
                                );
                                const meta: string[] = [];
                                if (result.timedOut) meta.push('TimedOut');
                                if (result.memoryExceeded) meta.push('MemoryExceeded');
                                if (result.spaceExceeded) meta.push('SpaceExceeded');
                                let content = '';
                                if (meta.length) content += `<p><b>Flags:</b> ${meta.join(', ')}</p>`;
                                if (result.stdout) content += `<h2>Output:</h2><pre>${htmlEscape(result.stdout)}</pre>`;
                                if (result.stderr) content += `<h2>Error:</h2><pre>${htmlEscape(result.stderr)}</pre>`;
                                panel.webview.html = content || '<i>No output</i>';

                                // Return in the format expected by tests
                                return {
                                    output: result.stdout,
                                    error: result.stderr,
                                    timedOut: result.timedOut,
                                    memoryExceeded: result.memoryExceeded,
                                    spaceExceeded: result.spaceExceeded
                                };
                            } catch (e: any) {
                                vscode.window.showErrorMessage(`An unexpected error occurred: ${e.message}`);
                                throw e;
                            }
                        }
                    );
                }
            )
        );

        context.subscriptions.push(
            vscode.commands.registerCommand('oicode.initializeEnvironment', async () => {
                vscode.window.withProgress(
                    {
                        location: vscode.ProgressLocation.Notification,
                        title: 'Check Compiler Environment',
                        cancellable: false
                    },
                    async progress => {
                        progress.report({ message: 'Detecting compilers...' });
                        try {
                            const result = await NativeCompilerManager.detectCompilers(context);

                            if (result.success && result.compilers.length > 0) {
                                progress.report({ message: 'Compiler detection complete!', increment: 100 });
                                const compilerCount = result.compilers.length;
                                const recommendedName = result.recommended?.name;
                                const message =
                                    'OI-Code environment ready! Detected ' +
                                    `${compilerCount} compilers, recommended: ${recommendedName}`;
                                vscode.window.showInformationMessage(message);
                            } else {
                                progress.report({ message: 'Need to install compiler...' });
                                const choice = await vscode.window.showInformationMessage(
                                    'No C/C++ compilers detected. Would you like to install LLVM?',
                                    { modal: true },
                                    'Install LLVM',
                                    'View Help'
                                );

                                if (choice === 'Install LLVM') {
                                    const installResult = await NativeCompilerManager.installLLVM();
                                    if (installResult.success) {
                                        vscode.window.showInformationMessage(
                                            'LLVM installation completed! Please restart VS Code.'
                                        );
                                    }
                                }
                            }
                        } catch (error: any) {
                            progress.report({ message: 'Compiler detection failed.' });
                            vscode.window.showErrorMessage(
                                `Compiler environment initialization failed: ${error.message}`
                            );
                        }
                    }
                );
            })
        );

        context.subscriptions.push(
            vscode.commands.registerCommand('oicode.rescanCompilers', async () => {
                try {
                    vscode.window.withProgress(
                        {
                            location: vscode.ProgressLocation.Notification,
                            title: 'Rescanning compilers...',
                            cancellable: false
                        },
                        async progress => {
                            progress.report({ message: 'Rescanning compilers...' });
                            try {
                                const result = await NativeCompilerManager.forceRescanCompilers(context);
                                progress.report({ message: 'Rescan completed!', increment: 100 });

                                if (result.success && result.compilers.length > 0) {
                                    const rescanCount = result.compilers.length;
                                    const rescanRecommended = result.recommended?.name;
                                    const rescanMessage =
                                        'Compiler rescan completed! Detected ' +
                                        `${rescanCount} compilers, recommended: ${rescanRecommended}`;
                                    vscode.window.showInformationMessage(rescanMessage);
                                } else {
                                    vscode.window.showWarningMessage('No available compilers detected');
                                }
                            } catch (error: any) {
                                progress.report({ message: 'Rescan failed' });
                                vscode.window.showErrorMessage(`Compiler rescan failed: ${error.message}`);
                            }
                        }
                    );
                } catch (error: any) {
                    vscode.window.showErrorMessage(`Compiler rescan failed: ${error.message}`);
                }
            })
        );

        context.subscriptions.push(
            vscode.commands.registerCommand('oicode.setupCompiler', async () => {
                try {
                    const result = await NativeCompilerManager.detectCompilers(context);

                    if (result.success && result.compilers.length > 0) {
                        const detectedMessage =
                            `Detected ${result.compilers.length} compilers. ` +
                            `Recommended: ${result.recommended?.name || 'first compiler'}`;
                        vscode.window.showInformationMessage(detectedMessage);
                    } else {
                        const choice = await vscode.window.showInformationMessage(
                            'No C/C++ compilers detected. Do you want to install LLVM?',
                            { modal: true },
                            'Install LLVM',
                            'View Detection Details',
                            'Deep Scan'
                        );

                        if (choice === 'Install LLVM') {
                            const installResult = await NativeCompilerManager.installLLVM();
                            if (installResult.success) {
                                vscode.window.showInformationMessage(installResult.message);
                            } else {
                                vscode.window
                                    .showErrorMessage(installResult.message, 'View Details')
                                    .then(selection => {
                                        if (selection === 'View Details') {
                                            NativeCompilerManager.getOutputChannel().show(true);
                                        }
                                    });
                            }
                        } else if (choice === 'View Detection Details') {
                            NativeCompilerManager.getOutputChannel().show(true);
                        } else if (choice === 'Deep Scan') {
                            await vscode.commands.executeCommand('oicode.deepScanCompilers');
                        }
                    }
                } catch (error: any) {
                    vscode.window.showErrorMessage(`Compiler setup failed: ${error.message}`);
                }
            })
        );

        // Register deep scan command
        context.subscriptions.push(
            vscode.commands.registerCommand('oicode.deepScanCompilers', async () => {
                try {
                    await vscode.window.withProgress(
                        {
                            location: vscode.ProgressLocation.Notification,
                            title: 'Deep Scanning for Compilers...',
                            cancellable: true
                        },
                        async (progress, token) => {
                            progress.report({ message: 'Performing deep system scan for compilers...' });

                            const result = await NativeCompilerManager.detectCompilers(context, true, true);

                            if (token.isCancellationRequested) {
                                return;
                            }

                            if (result.success && result.compilers.length > 0) {
                                const detectedMessage =
                                    `Deep scan found ${result.compilers.length} compilers. ` +
                                    `Recommended: ${result.recommended?.name || 'first compiler'}`;
                                vscode.window.showInformationMessage(detectedMessage);
                            } else {
                                vscode.window.showInformationMessage(
                                    'Deep scan completed. No additional compilers found.'
                                );
                            }

                            // Show detection details
                            NativeCompilerManager.getOutputChannel().show(true);
                        }
                    );
                } catch (error: any) {
                    vscode.window.showErrorMessage(`Deep scan failed: ${error.message}`);
                }
            })
        );

        const hasLaunchedBeforeKey = 'oicode.hasLaunchedBefore';
        if (!context.globalState.get<boolean>(hasLaunchedBeforeKey)) {
            vscode.commands.executeCommand('oi-code.showWelcomePage');
            context.globalState.update(hasLaunchedBeforeKey, true);
        }

        if (context.globalState.get<boolean>('oi-code.initializationComplete')) {
            context.globalState.update('oi-code.initializationComplete', false);
            vscode.commands.executeCommand('oi-code.showCompletionPage');
        }

        console.log('OI-Code extension activation completed successfully');
    } catch (error) {
        console.error('Error activating OI-Code extension:', error);
        vscode.window.showErrorMessage(`Failed to activate OI-Code extension: ${error}`);
    }
}

async function getWebviewContent(context: vscode.ExtensionContext, fileName: string): Promise<string> {
    const filePath = vscode.Uri.file(path.join(context.extensionPath, 'out', fileName));
    try {
        const content = await vscode.workspace.fs.readFile(filePath);
        return content.toString();
    } catch (e) {
        console.error(`Failed to read ${fileName}`, e);
        return `<h1>Error: Could not load page.</h1><p>${e}</p>`;
    }
}

export function deactivate(): Promise<void> {
    // Cleanup any temporary files or resources
    return Promise.resolve();
}
