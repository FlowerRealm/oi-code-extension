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
import { OI_CODE_TEST_BASE_PATH, OI_CODE_TEST_TMP_PATH } from './constants';

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
    // Prefer configured docker compilers; fallback to sane defaults
    const config = vscode.workspace.getConfiguration();
    const compilers = config.get<any>('oicode.docker.compilers') || {};
    const defaultOpt = config.get<string>('oicode.compile.opt');
    const defaultStd = config.get<string>('oicode.compile.std');

    // Helper function to apply compiler options
    function applyCompilerOptions(args: string[], options?: { opt?: string; std?: string }): string[] {
        let result = [...args];

        const effOpt = options?.opt || defaultOpt;
        if (effOpt) {
            result = result.map(a => /^-O[0-3]$/.test(a) ? `-${effOpt}` : a);
            if (!result.some(a => /^-O[0-3]$/.test(a))) result.push(`-${effOpt}`);
        }

        const effStd = options?.std || defaultStd;
        if (effStd) {
            result = result.map(a => a.startsWith('-std=') ? `-std=${effStd}` : a);
            if (!result.some(a => a.startsWith('-std='))) result.push(`-std=${effStd}`);
        }

        return result;
    }

    let command: string;
    if (languageId === 'python') {
        const py = compilers.python || { command: 'python3', args: ['/sandbox/${sourceFile}'] };
        const args = (py.args as string[]).map(a => a.replace(/\$\{sourceFile\}/g, sourceFileName));
        command = [py.command as string, ...args].join(' ');
    } else if (languageId === 'cpp') {
        const cpp = compilers.cpp || { command: 'g++', args: ['/sandbox/${sourceFile}', '-o', '/tmp/a.out', '-O2', '-std=c++17'] };
        let args = (cpp.args as string[]).map(a => a.replace(/\$\{sourceFile\}/g, sourceFileName));
        args = applyCompilerOptions(args, options);
        command = [cpp.command as string, ...args, '&&', '/tmp/a.out'].join(' ');
    } else {
        const c = compilers.c || { command: 'gcc', args: ['/sandbox/${sourceFile}', '-o', '/tmp/a.out', '-O2'] };
        let args = (c.args as string[]).map(a => a.replace(/\$\{sourceFile\}/g, sourceFileName));
        args = applyCompilerOptions(args, options);
        command = [c.command as string, ...args, '&&', '/tmp/a.out'].join(' ');
    }

    const result = await DockerManager.run({
        sourceDir,
        command,
        input,
        memoryLimit: '512',
        projectRootPath,
        languageId,
        timeLimit: 10
    });
    return {
        stdout: result.stdout,
        stderr: result.stderr,
        timedOut: result.timedOut,
        memoryExceeded: result.memoryExceeded,
        spaceExceeded: result.spaceExceeded
    };
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
                    await fs.promises.mkdir(OI_CODE_TEST_BASE_PATH, { recursive: true });
                    const tempDir = await fs.promises.mkdtemp(path.join(OI_CODE_TEST_BASE_PATH, 'pair-'));
                    const file1Path = path.join(tempDir, `code1.${langId}`);
                    const file2Path = path.join(tempDir, `code2.${langId}`);
                    await fs.promises.writeFile(file1Path, editor1.document.getText());
                    await fs.promises.writeFile(file2Path, editor2.document.getText());

                    const ext = langId === 'python' ? 'py' : langId;
                    const [result1, result2] = await Promise.all([
                        runSingleInDocker(this._context.extensionPath, tempDir, langId as any, `code1.${ext}`, message.input).catch((e: any) => ({ stdout: '', stderr: e.message })),
                        runSingleInDocker(this._context.extensionPath, tempDir, langId as any, `code2.${ext}`, message.input).catch((e: any) => ({ stdout: '', stderr: e.message }))
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

export function activate(context: vscode.ExtensionContext) {
    try {
        console.log('OI-Code extension is now active!');
        console.log('Extension path:', context.extensionPath);

        // Register WebviewView providers
        console.log('PairCheckViewProvider will be registered later');


        // Sidebar: Problem view (inputs, statement editor, limits, options, actions)
        context.subscriptions.push(vscode.window.registerWebviewViewProvider('oicode.problemView', {
            resolveWebviewView(webviewView: vscode.WebviewView) {
                webviewView.webview.options = { enableScripts: true, localResourceRoots: [context.extensionUri] };
                webviewView.webview.html = `<!DOCTYPE html>
<html lang="zh-cn"><head><meta charset="utf-8"/>
<style>
body { font-family: var(--vscode-font-family); padding:8px; }
.row { margin-bottom:8px; }
label { display:block; margin-bottom:4px; }
input[type=text], textarea, select { width:100%; box-sizing:border-box; }
.actions { display:flex; gap:8px; margin-top:8px; }
.inline { display:flex; gap:8px; }
.half { flex:1; }
</style></head>
<body>
  <div class="row"><label>题目名称</label><input id="name" type="text" placeholder="如：CF1234A"/></div>
  <div class="row"><label>题目 URL</label><input id="url" type="text" placeholder="https://..."/></div>
  <div class="row"><label>题面 (Markdown)</label><textarea id="statement" rows="8" placeholder="在此粘贴/编辑题面...\n支持 Markdown"></textarea></div>
  <div class="inline">
    <div class="half"><label>时间限制(秒)</label><input id="timeLimit" type="text" value="5"/></div>
    <div class="half"><label>内存限制(MB)</label><input id="memoryLimit" type="text" value="256"/></div>
  </div>
  <div class="row"><label>样例输入</label><textarea id="samples" rows="6" placeholder="每个用例之间用空行或分隔符"></textarea>
    <button id="loadSamples">从文件读取样例</button>
  </div>
  <div class="inline">
    <div class="half"><label>优化选项</label>
      <select id="opt">
        <option value="O2" selected>O2</option>
        <option value="O0">O0</option>
        <option value="O3">O3</option>
      </select>
    </div>
    <div class="half"><label>语言标准</label>
      <select id="std">
        <option value="c++17" selected>C++17</option>
        <option value="c++14">C++14</option>
        <option value="c++11">C++11</option>
        <option value="c11">C11</option>
      </select>
    </div>
  </div>
  <div class="actions">
    <button id="run">运行</button>
    <button id="pair">对拍</button>
  </div>
  <script>
    const vscode = acquireVsCodeApi();
    function getModel(){
      return {
        name: document.getElementById('name').value,
        url: document.getElementById('url').value,
        statement: document.getElementById('statement').value,
        timeLimit: Number(document.getElementById('timeLimit').value)||5,
        memoryLimit: Number(document.getElementById('memoryLimit').value)||256,
        samples: document.getElementById('samples').value,
        opt: document.getElementById('opt').value,
        std: document.getElementById('std').value
      };
    }
    document.getElementById('run').addEventListener('click', ()=>{
      vscode.postMessage({ cmd:'run', ...getModel() });
    });
    document.getElementById('pair').addEventListener('click', ()=>{
      vscode.postMessage({ cmd:'pair', ...getModel() });
    });
    document.getElementById('loadSamples').addEventListener('click', ()=>{
      vscode.postMessage({ cmd:'loadSamples' });
    });
  </script>
</body></html>`;

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
                    const langId = active.document.languageId as 'c' | 'cpp' | 'python';
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
                            await vscode.commands.executeCommand('oicode.runCode', m.samples || '');
                        } catch (e: any) {
                            vscode.window.showErrorMessage(e.message || String(e));
                        }
                    } else if (m.cmd === 'pair') {
                        await vscode.commands.executeCommand('oicode.runPairCheck', m.samples || '');
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
                    // Template source
                    const sourcePath = path.join(problemDir, `main.${ext}`);
                    try {
                        await fs.promises.access(sourcePath);
                    } catch {
                        const tpl = langId === 'c'
                            ? '#include <stdio.h>\nint main(){ /* TODO */ return 0; }\n'
                            : langId === 'cpp'
                                ? '#include <bits/stdc++.h>\nusing namespace std; int main(){ /* TODO */ return 0; }\n'
                                : 'print("TODO")\n';
                        await fs.promises.writeFile(sourcePath, tpl, 'utf8');
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
        context.subscriptions.push(vscode.commands.registerCommand('oicode.runPairCheck', async (testInput?: string) => {
            const editors = vscode.window.visibleTextEditors.filter(e => !e.document.isUntitled && (e.document.languageId === 'cpp' || e.document.languageId === 'python' || e.document.languageId === 'c'));
            if (editors.length < 2) {
                vscode.window.showErrorMessage('需要打开至少两个C/C++/Python代码文件才能进行对拍。');
                return { error: 'NEED_TWO_EDITORS' };
            }
            const [editor1, editor2] = editors.sort((a, b) => (a.viewColumn || 0) - (b.viewColumn || 0));
            const langId = editor1.document.languageId;
            if (editor2.document.languageId !== langId) {
                vscode.window.showErrorMessage('两个代码文件的语言类型必须相同。');
                return { error: 'LANG_MISMATCH' };
            }
            // const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oi-code-'));
            await fs.promises.mkdir(OI_CODE_TEST_TMP_PATH, { recursive: true });
            const tempDir = await fs.promises.mkdtemp(path.join(OI_CODE_TEST_TMP_PATH, 'oi-code-'));
            try {
                const ext = langId === 'python' ? 'py' : langId;
                const file1Path = path.join(tempDir, `code1.${ext}`);
                const file2Path = path.join(tempDir, `code2.${ext}`);
                await fs.promises.writeFile(file1Path, editor1.document.getText());
                await fs.promises.writeFile(file2Path, editor2.document.getText());

                const input = testInput ?? '';
                const [result1, result2] = await Promise.all([
                    runSingleInDocker(context.extensionPath, tempDir, langId as any, `code1.${ext}`, input).catch((e: any) => ({ stdout: '', stderr: e.message })),
                    runSingleInDocker(context.extensionPath, tempDir, langId as any, `code2.${ext}`, input).catch((e: any) => ({ stdout: '', stderr: e.message }))
                ]);

                const output1 = (result1 as any).stderr ? `ERROR:\n${(result1 as any).stderr}` : (result1 as any).stdout;
                const output2 = (result2 as any).stderr ? `ERROR:\n${(result2 as any).stderr}` : (result2 as any).stdout;
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

        context.subscriptions.push(vscode.commands.registerCommand('oicode.runCode', async (testInput?: string) => {
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
            // Placeholder values for time and memory limits
            const timeLimit = 5; // seconds
            const memoryLimit = 256; // MB
            return vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `正在运行 ${sourceFile}...`,
                cancellable: false
            }, async (progress) => {
                progress.report({ increment: 0, message: 'Preparing container...' });
                try {
                    const result = await runSingleInDocker(
                        (vscode.extensions.getExtension('oi-code')?.extensionPath || ''),
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

        console.log('OI-Code extension activation completed successfully');
    } catch (error) {
        console.error('Error activating OI-Code extension:', error);
        vscode.window.showErrorMessage(`Failed to activate OI-Code extension: ${error}`);
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
