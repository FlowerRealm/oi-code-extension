/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { DockerManager } from './dockerManager';
import * as Diff from 'diff';
import { Installer } from './docker/install';
import { OI_CODE_TEST_BASE_PATH, OI_CODE_TEST_TMP_PATH } from './constants';

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

async function runSingleInDocker(
    projectRootPath: string,
    sourceDir: string,
    languageId: 'c' | 'cpp' | 'python',
    sourceFileName: string,
    input: string,
    options?: { opt?: string; std?: string; timeLimit?: number; memoryLimit?: number }
): Promise<{ stdout: string; stderr: string; timedOut?: boolean; memoryExceeded?: boolean; spaceExceeded?: boolean }> {
    // 生成唯一的可执行文件名，避免冲突
    const baseName = path.parse(sourceFileName).name;
    const uniqueId = Math.random().toString(36).slice(2, 7);
    const executableName = `/tmp/${baseName}_${uniqueId}.out`;

    // 构建完整的源文件路径
    const sourceFilePath = `/tmp/source/${sourceFileName}`;

    // 构建编译命令 - 使用安全的参数传递方式避免shell注入
    let compileCommand: string;
    if (languageId === 'python') {
        // Python不需要编译，直接运行
        compileCommand = '';
    } else {
        // 获取编译器选项
        const config = vscode.workspace.getConfiguration();
        const defaultOpt = config.get<string>('oicode.compile.opt') || '2';
        const defaultStd = config.get<string>('oicode.compile.std') || 'c++17';

        const effOpt = (options?.opt || defaultOpt).replace(/^O/, '');
        // 确保优化级别是有效的
        const validOptLevels = ['0', '1', '2', '3', 'g', 's', 'z', 'fast'];
        const finalOpt = validOptLevels.includes(effOpt) ? effOpt : '2';
        const effStd = options?.std || defaultStd;

        // 验证路径安全性 - 防止路径遍历攻击
        if (sourceFilePath.includes('..') || executableName.includes('..')) {
            throw new Error('Invalid file path: path traversal detected');
        }

        if (languageId === 'cpp') {
            compileCommand = `g++ "${sourceFilePath}" -o "${executableName}" -O${finalOpt} -std=${effStd}`;
        } else {
            compileCommand = `gcc "${sourceFilePath}" -o "${executableName}" -O${finalOpt}`;
        }
    }

    // 构建运行命令 - 使用安全的参数传递方式
    let runCommand: string;
    if (languageId === 'python') {
        runCommand = `python3 "${sourceFilePath}"`;
    } else {
        runCommand = `"${executableName}"`;
    }

    // 组合完整的命令：编译 + 运行
    let fullCommand: string;
    if (languageId === 'python') {
        fullCommand = runCommand;
    } else {
        // 使用 trap 命令确保临时编译产物能被可靠清理，即使在进程被意外终止时也能执行
        // 使用双引号包围路径以防止shell注入
        fullCommand = `trap "rm -f \\"${executableName}\\"" EXIT; ${compileCommand} && ${runCommand}`;
    }

    // 添加调试信息
    console.log(`[RunSingleInDocker] Language: ${languageId}, Source file: ${sourceFileName}`);
    console.log(`[RunSingleInDocker] Executable name: ${executableName}`);
    console.log(`[RunSingleInDocker] Source file path: ${sourceFilePath}`);
    console.log(`[RunSingleInDocker] Command: ${fullCommand}`);

    // 直接使用编译和运行命令，不需要额外的文件复制，因为 dockerManager 会处理文件复制
    const result = await DockerManager.run({
        sourceDir,
        command: fullCommand,
        input,
        memoryLimit: (options?.memoryLimit ? String(options.memoryLimit) : '512'),
        projectRootPath,
        languageId,
        timeLimit: options?.timeLimit ?? 10
    });
    return {
        stdout: result.stdout,
        stderr: result.stderr,
        timedOut: result.timedOut,
        memoryExceeded: result.memoryExceeded,
        spaceExceeded: result.spaceExceeded
    };
}

/**
 * 在两个独立的容器中分别运行两个代码文件，避免复杂的输出解析
 */
async function runPairInSeparateContainers(
    projectRootPath: string,
    sourceDir: string,
    languageId: 'c' | 'cpp' | 'python',
    sourceFileName1: string,
    sourceFileName2: string,
    input: string,
    options?: { opt?: string; std?: string; timeLimit?: number; memoryLimit?: number }
): Promise<{
    result1: { stdout: string; stderr: string; timedOut?: boolean; memoryExceeded?: boolean; spaceExceeded?: boolean };
    result2: { stdout: string; stderr: string; timedOut?: boolean; memoryExceeded?: boolean; spaceExceeded?: boolean };
}> {
    // 并行运行两个程序，每个程序使用独立的容器
    const [result1, result2] = await Promise.all([
        runSingleInDocker(
            projectRootPath,
            sourceDir,
            languageId,
            sourceFileName1,
            input,
            options
        ),
        runSingleInDocker(
            projectRootPath,
            sourceDir,
            languageId,
            sourceFileName2,
            input,
            options
        )
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

function getLanguageIdFromEditor(editor: vscode.TextEditor): 'c' | 'cpp' | 'python' {
    const langId = editor.document.languageId;
    if (langId === 'c' || langId === 'cpp' || langId === 'python') {
        return langId;
    }
    throw new Error(`不支持的语言: ${langId}`);
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
                    const editors = vscode.window.visibleTextEditors.filter(e => !e.document.isUntitled && (e.document.languageId === 'c' || e.document.languageId === 'cpp' || e.document.languageId === 'python'));
                    if (editors.length < 2) {
                        vscode.window.showErrorMessage('需要打开至少两个C/C++/Python代码文件才能进行对拍。');
                        return;
                    }
                    const [editor1, editor2] = editors.sort((a, b) => a.viewColumn! - b.viewColumn!);
                    const langId = getLanguageIdFromEditor(editor1);
                    if (langId !== 'c' && langId !== 'cpp' && langId !== 'python') {
                        vscode.window.showErrorMessage(`对拍不支持语言: ${langId}`);
                        return;
                    }
                    if (editor2.document.languageId !== langId) {
                        vscode.window.showErrorMessage('两个代码文件的语言类型必须相同。');
                        return;
                    }

                    this.setOutputs('<i>正在运行...</i>', '<i>正在运行...</i>');
                    await fs.promises.mkdir(OI_CODE_TEST_BASE_PATH, { recursive: true });
                    const tempDir = await fs.promises.mkdtemp(path.join(OI_CODE_TEST_BASE_PATH, 'pair-'));

                    // 定义文件扩展名，确保与 Docker 传递的文件名一致
                    const ext = langId === 'python' ? 'py' : langId;
                    const file1Path = path.join(tempDir, `code1.${ext}`);
                    const file2Path = path.join(tempDir, `code2.${ext}`);
                    await fs.promises.writeFile(file1Path, editor1.document.getText());
                    await fs.promises.writeFile(file2Path, editor2.document.getText());

                    // 优化对拍：使用独立的容器运行，避免复杂的输出解析
                    const pairResult = await runPairInSeparateContainers(
                        this._context.extensionPath,
                        tempDir,
                        langId,
                        `code1.${ext}`,
                        `code2.${ext}`,
                        message.input,
                        { timeLimit: 20, memoryLimit: 512 }
                    );
                    const result1 = pairResult.result1;
                    const result2 = pairResult.result2;

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

                    await fs.promises.rm(tempDir, { recursive: true, force: true });

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

/**
 * 设置编辑器事件监听器，实现按需容器管理
 */
function setupEditorEventListeners(context: vscode.ExtensionContext): void {
    console.log('[EditorEventListeners] Setting up editor event listeners for on-demand container management');

    // 监听编辑器打开事件
    const onDidOpenTextDocument = vscode.workspace.onDidOpenTextDocument((document) => {
        if (!document.isUntitled) {
            const languageId = document.languageId;
            if (languageId === 'c' || languageId === 'cpp' || languageId === 'python') {
                console.log(`[EditorEventListeners] Document opened with language: ${languageId}`);
                // 容器池管理由 DockerManager.initializeContainerPool() 处理，无需额外操作
            }
        }
    });

    // 监听编辑器关闭事件
    const onDidCloseTextDocument = vscode.workspace.onDidCloseTextDocument((document) => {
        if (!document.isUntitled) {
            const languageId = document.languageId;
            if (languageId === 'c' || languageId === 'cpp' || languageId === 'python') {
                console.log(`[EditorEventListeners] Document closed with language: ${languageId}`);
                // 容器池管理由 DockerManager 的健康检查机制处理，无需额外操作
            }
        }
    });

    // 监听活动编辑器变化
    const onDidChangeActiveTextEditor = vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor && !editor.document.isUntitled) {
            const languageId = editor.document.languageId;
            if (languageId === 'c' || languageId === 'cpp' || languageId === 'python') {
                console.log(`[EditorEventListeners] Active editor changed to language: ${languageId}`);
                // 容器池管理由 DockerManager 的健康检查机制处理，无需额外操作
            }
        }
    });

    // 将所有监听器添加到上下文订阅中，确保在扩展停用时正确清理
    context.subscriptions.push(onDidOpenTextDocument);
    context.subscriptions.push(onDidCloseTextDocument);
    context.subscriptions.push(onDidChangeActiveTextEditor);

    console.log('[EditorEventListeners] Editor event listeners setup completed');
}

export function activate(context: vscode.ExtensionContext) {
    try {
        console.log('OI-Code extension is now active!');
        console.log('Extension path:', context.extensionPath);

        // 初始化容器池
        DockerManager.initializeContainerPool().catch(error => {
            console.error('Failed to initialize container pool:', error);
        });

        // 设置编辑器事件监听器，实现按需容器管理
        setupEditorEventListeners(context);

        // Register WebviewView providers
        console.log('PairCheckViewProvider will be registered later');


        // Sidebar: Problem view (inputs, statement editor, limits, options, actions)
        context.subscriptions.push(vscode.window.registerWebviewViewProvider('oicode.problemView', {
            async resolveWebviewView(webviewView: vscode.WebviewView) {
                webviewView.webview.options = { enableScripts: true, localResourceRoots: [context.extensionUri] };
                webviewView.webview.html = await getWebviewContent(context, 'problem.html');

                function toSafeName(input: string): string {
                    const s = input || 'unnamed';
                    return s.replace(/[^\w\-\.]+/g, '_').slice(0, 64);
                }

                async function pickProblemsBaseDir(): Promise<string> {
                    const saved = context.globalState.get<string>('oicode.lastProblemsBaseDir');
                    if (saved) {
                        try {
                            await fs.promises.access(saved);
                            const choice = await vscode.window.showQuickPick([
                                { label: `使用上次：${saved}`, value: 'saved' },
                                { label: '重新选择...', value: 'pick' }
                            ], { placeHolder: '选择题目根目录' });
                            if (!choice) { throw new Error('未选择题目根目录'); }
                            if (choice.value === 'saved') { return saved; }
                        } catch { }
                    }
                    const pick = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, canSelectMany: false, openLabel: '选择题目根目录' });
                    if (!pick || !pick[0]) { throw new Error('未选择题目根目录'); }
                    const baseDir = pick[0].fsPath;
                    context.globalState.update('oicode.lastProblemsBaseDir', baseDir);
                    return baseDir;
                }

                async function ensureProblemStructure(m: any): Promise<{ sourcePath: string }> {
                    const active = vscode.window.activeTextEditor;
                    if (!active) { throw new Error('请先在编辑器中打开源文件。'); }
                    const langId = getLanguageIdFromEditor(active);
                    const ext = langId === 'python' ? 'py' : langId;
                    const problemName = toSafeName(m.name);

                    const baseDir = await pickProblemsBaseDir();

                    const problemDir = path.join(baseDir, problemName);
                    const configDir = path.join(problemDir, 'config');
                    await fs.promises.mkdir(problemDir, { recursive: true });
                    await fs.promises.mkdir(configDir, { recursive: true });

                    // Write source file
                    const sourcePath = path.join(problemDir, `main.${ext}`);
                    await fs.promises.writeFile(sourcePath, active.document.getText(), 'utf8');

                    // Write config files
                    const configJson = {
                        name: m.name || '',
                        url: m.url || '',
                        timeLimit: Number(m.timeLimit) || 5,
                        memoryLimit: Number(m.memoryLimit) || 256,
                        opt: m.opt || '',
                        std: m.std || '',
                    };
                    await fs.promises.writeFile(path.join(configDir, 'problem.json'), JSON.stringify(configJson, null, 2), 'utf8');
                    if (m.statement) await fs.promises.writeFile(path.join(configDir, 'statement.md'), m.statement, 'utf8');
                    if (m.samples) await fs.promises.writeFile(path.join(configDir, 'samples.txt'), m.samples, 'utf8');

                    return { sourcePath };
                }

                webviewView.webview.onDidReceiveMessage(async (m: any) => {
                    if (m.cmd === 'loadSamples') {
                        const uris = await vscode.window.showOpenDialog({ canSelectMany: false, openLabel: '选择样例文件' });
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
                            await vscode.commands.executeCommand('oicode.runCode', m.samples || '', { timeLimit: m.timeLimit, memoryLimit: m.memoryLimit });
                        } catch (e: any) {
                            vscode.window.showErrorMessage(e.message || String(e));
                        }
                    } else if (m.cmd === 'pair') {
                        await vscode.commands.executeCommand('oicode.runPairCheck', m.samples || '', { timeLimit: m.timeLimit, memoryLimit: m.memoryLimit });
                    }
                });
            }
        }));

        // Command: create a new problem skeleton by name
        context.subscriptions.push(vscode.commands.registerCommand('oicode.createProblem', async (payload?: { name?: string; language?: 'c' | 'cpp' | 'python'; baseDir?: string }) => {
            try {
                let name = payload?.name;
                if (!name) {
                    name = await vscode.window.showInputBox({ prompt: '输入题目名称（将作为文件夹名）', placeHolder: '如：CF1234A' }) || '';
                }
                if (!name) { return; }
                const safe = name.replace(/[^\w\-\.]+/g, '_').slice(0, 64);

                let baseDir = payload?.baseDir || context.globalState.get<string>('oicode.lastProblemsBaseDir');
                if (baseDir) {
                    try {
                        await fs.promises.access(baseDir);
                    } catch {
                        baseDir = undefined;
                    }
                }
                if (!baseDir) {
                    const pick = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, canSelectMany: false, openLabel: '选择题目根目录' });
                    if (!pick || !pick[0]) { return; }
                    baseDir = pick[0].fsPath;
                }
                context.globalState.update('oicode.lastProblemsBaseDir', baseDir);

                let langId = payload?.language as ('c' | 'cpp' | 'python') | undefined;
                if (!langId) {
                    const langPick = await vscode.window.showQuickPick([
                        { label: 'C', detail: 'main.c', value: 'c' },
                        { label: 'C++', detail: 'main.cpp', value: 'cpp' },
                        { label: 'Python', detail: 'main.py', value: 'python' }
                    ], { placeHolder: '选择语言' });
                    if (!langPick) { return; }
                    langId = langPick.value as 'c' | 'cpp' | 'python';
                }
                if (langId) {
                    const ext = langId === 'python' ? 'py' : langId;
                    const problemDir = path.join(baseDir, safe);
                    const configDir = path.join(problemDir, 'config');
                    await fs.promises.mkdir(problemDir, { recursive: true });
                    await fs.promises.mkdir(configDir, { recursive: true });
                    // Template source - 使用空文件而不是模板代码
                    const sourcePath = path.join(problemDir, `main.${ext}`);
                    try {
                        await fs.promises.access(sourcePath);
                    } catch {
                        // 创建空文件，让用户自己编写代码
                        await fs.promises.writeFile(sourcePath, '', 'utf8');
                    }
                    // Default config
                    const problemJsonPath = path.join(configDir, 'problem.json');
                    try {
                        await fs.promises.access(problemJsonPath);
                    } catch {
                        await fs.promises.writeFile(problemJsonPath, JSON.stringify({ name: safe, url: '', timeLimit: 5, memoryLimit: 256, opt: '', std: '' }, null, 2), 'utf8');
                    }
                    const statementPath = path.join(configDir, 'statement.md');
                    try {
                        await fs.promises.access(statementPath);
                    } catch {
                        await fs.promises.writeFile(statementPath, `# ${safe}\n\n在此编写题面...\n`, 'utf8');
                    }
                    const samplesPath = path.join(configDir, 'samples.txt');
                    try {
                        await fs.promises.access(samplesPath);
                    } catch {
                        await fs.promises.writeFile(samplesPath, '', 'utf8');
                    }

                    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(sourcePath));
                    await vscode.window.showTextDocument(doc, { preview: false });
                    vscode.window.showInformationMessage(`已创建题目：${safe}`);
                    return { problemDir, sourcePath };
                }
            } catch (e: any) {
                vscode.window.showErrorMessage(`新建题目失败：${e.message || e}`);
                return { error: e?.message || String(e) };
            }
        }));

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

        // Programmatic pair-check command for tests and headless execution
        context.subscriptions.push(vscode.commands.registerCommand('oicode.runPairCheck', async (testInput?: string, options?: { timeLimit?: number; memoryLimit?: number }) => {
            const editors = vscode.window.visibleTextEditors.filter(e => !e.document.isUntitled && (e.document.languageId === 'cpp' || e.document.languageId === 'python' || e.document.languageId === 'c'));
            if (editors.length < 2) {
                vscode.window.showErrorMessage('需要打开至少两个C/C++/Python代码文件才能进行对拍。');
                return { error: 'NEED_TWO_EDITORS' };
            }
            const [editor1, editor2] = editors.sort((a, b) => (a.viewColumn || 0) - (b.viewColumn || 0));
            const langId = getLanguageIdFromEditor(editor1);
            if (editor2.document.languageId !== langId) {
                vscode.window.showErrorMessage('两个代码文件的语言类型必须相同。');
                return { error: 'LANG_MISMATCH' };
            }

            // 等待编辑器内容完全加载（使用更可靠的机制）
            let attempts = 0;
            const maxAttempts = 10;
            const checkInterval = 200; // 200ms检查一次

            while (attempts < maxAttempts) {
                const editor1Content = editor1.document.getText();
                const editor2Content = editor2.document.getText();
                if (editor1Content.length > 0 && editor2Content.length > 0) {
                    break; // 内容已加载完成
                }
                attempts++;
                await new Promise(resolve => setTimeout(resolve, checkInterval));
            }

            // 最终检查
            const finalEditor1Content = editor1.document.getText();
            const finalEditor2Content = editor2.document.getText();
            if (finalEditor1Content.length === 0 || finalEditor2Content.length === 0) {
                vscode.window.showErrorMessage('编辑器内容加载超时，请稍后再试。');
                return { error: 'EDITOR_CONTENT_LOAD_TIMEOUT' };
            }

            // const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oi-code-'));
            await fs.promises.mkdir(OI_CODE_TEST_TMP_PATH, { recursive: true });
            const tempDir = await fs.promises.mkdtemp(path.join(OI_CODE_TEST_TMP_PATH, 'oi-code-'));
            try {
                const ext = langId === 'python' ? 'py' : langId;
                const file1Path = path.join(tempDir, `code1.${ext}`);
                const file2Path = path.join(tempDir, `code2.${ext}`);
                await fs.promises.writeFile(file1Path, finalEditor1Content);
                await fs.promises.writeFile(file2Path, finalEditor2Content);

                const input = testInput ?? '';
                // Use provided options or fallback to defaults
                const timeLimit = options?.timeLimit ?? 20; // seconds

                // 优化对拍：使用独立的容器运行，避免复杂的输出解析
                const pairResult = await runPairInSeparateContainers(
                    context.extensionPath,
                    tempDir,
                    langId,
                    `code1.${ext}`,
                    `code2.${ext}`,
                    input,
                    { timeLimit, memoryLimit: 512 }
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
                vscode.window.showErrorMessage(`对拍执行错误: ${e.message}`);
                return { error: e.message };
            } finally {
                await fs.promises.rm(tempDir, { recursive: true, force: true });
            }
        }));

        context.subscriptions.push(vscode.commands.registerCommand('oicode.runCode', async (testInput?: string, options?: { timeLimit?: number; memoryLimit?: number }) => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                return vscode.window.showErrorMessage('Please open a file to run.');
            }
            const document = editor.document;
            const languageId = document.languageId as 'c' | 'cpp' | 'python';
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
            const timeLimit = options?.timeLimit ?? 5; // seconds
            const memoryLimit = options?.memoryLimit ?? 512; // MB (use 512MB to enable container pool)
            return vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `正在运行 ${sourceFile}...`,
                cancellable: false
            }, async (progress) => {
                progress.report({ increment: 0, message: 'Preparing container...' });
                try {
                    const result = await runSingleInDocker(
                        context.extensionPath,
                        path.dirname(document.uri.fsPath),
                        languageId,
                        sourceFile,
                        input || '',
                        { timeLimit, memoryLimit }
                    );
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
                    // Return in the format expected by tests: { output, error, ... }
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
                    await DockerManager.ensureDockerIsReady(context.extensionPath);
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
    // 彻底清理所有Docker资源，包括删除容器
    return DockerManager.cleanupAllDockerResources().catch(error => {
        console.error('Failed to cleanup all Docker resources:', error);
    });
}
