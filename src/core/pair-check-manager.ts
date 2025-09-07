import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as Diff from 'diff';
import { NativeCompilerManager } from '../native';
import { CompilerInfo } from '../types';
import { DEFAULT_PAIR_CHECK_TIME_LIMIT, DEFAULT_PAIR_CHECK_MEMORY_LIMIT, OI_CODE_TEST_BASE_PATH } from '../constants';
import { htmlEscape, getLanguageIdFromEditor, normalizeOutput } from '../utils/webview-utils';

export class PairCheckManager {
    private static instance: PairCheckManager;
    private _view?: vscode.WebviewView;
    private context: vscode.ExtensionContext | undefined;

    private constructor() {}

    public static getInstance(): PairCheckManager {
        if (!PairCheckManager.instance) {
            PairCheckManager.instance = new PairCheckManager();
        }
        return PairCheckManager.instance;
    }

    public setContext(context: vscode.ExtensionContext) {
        this.context = context;
    }

    public getWebViewContent(): string {
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

    private async getSuitableCompiler(
        context: vscode.ExtensionContext,
        languageId: 'c' | 'cpp'
    ): Promise<CompilerInfo> {
        let compilerResult = await NativeCompilerManager.detectCompilers(context);
        if (!compilerResult.success || compilerResult.compilers.length === 0) {
            const choice = await vscode.window.showErrorMessage(
                'No C/C++ compilers found. Please set up a compiler to proceed.',
                'Setup Compiler'
            );
            if (choice === 'Setup Compiler') {
                await vscode.commands.executeCommand('oicode.setupCompiler');
                compilerResult = await NativeCompilerManager.forceRescanCompilers(context);
            }

            if (!compilerResult.success || compilerResult.compilers.length === 0) {
                NativeCompilerManager.getOutputChannel().appendLine(
                    `Compiler detection failed. Suggestions: ${compilerResult.suggestions.join(', ')}`
                );
                throw new Error('No compilers available. Please set up a compiler first.');
            }
        }

        const suitableCompilers = NativeCompilerManager.filterSuitableCompilers(languageId, compilerResult.compilers);
        if (suitableCompilers.length === 0) {
            throw new Error(`No suitable compiler found for ${languageId}`);
        }

        return suitableCompilers[0];
    }

    private async runPairWithNativeCompilers(
        context: vscode.ExtensionContext,
        sourcePath1: string,
        sourcePath2: string,
        languageId: 'c' | 'cpp',
        input: string,
        options?: { timeLimit?: number; memoryLimit?: number }
    ): Promise<{
        result1: {
            stdout: string;
            stderr: string;
            timedOut?: boolean;
            memoryExceeded?: boolean;
            spaceExceeded?: boolean;
        };
        result2: {
            stdout: string;
            stderr: string;
            timedOut?: boolean;
            memoryExceeded?: boolean;
            spaceExceeded?: boolean;
        };
    }> {
        const compiler = await this.getSuitableCompiler(context, languageId);
        const timeLimit = options?.timeLimit ?? DEFAULT_PAIR_CHECK_TIME_LIMIT;
        const memoryLimit = options?.memoryLimit ?? DEFAULT_PAIR_CHECK_MEMORY_LIMIT;

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

    private createDiffHtml(output1: string, output2: string): { html1: string; html2: string } {
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

    public setOutputs(output1: string, output2: string) {
        if (this._view) {
            this._view.show?.(true);
            this._view.webview.postMessage({ command: 'setOutputs', output1, output2 });
        }
    }

    public async runPairCheck(
        context: vscode.ExtensionContext,
        testInput?: string,
        options?: { timeLimit?: number; memoryLimit?: number }
    ) {
        const editors = vscode.window.visibleTextEditors.filter(
            e => !e.document.isUntitled && (e.document.languageId === 'cpp' || e.document.languageId === 'c')
        );
        if (editors.length < 2) {
            vscode.window.showErrorMessage('Need to open at least two C/C++ code files to perform pair check.');
            return { error: 'NEED_TWO_EDITORS' };
        }
        const [editor1, editor2] = editors.sort((a, b) => (a.viewColumn || 0) - (b.viewColumn || 0));
        const langId = getLanguageIdFromEditor(editor1);
        if (editor2.document.languageId !== langId) {
            vscode.window.showErrorMessage('Both code files must have the same language type.');
            return { error: 'LANG_MISMATCH' };
        }

        let attempts = 0;
        const maxAttempts = 10;
        const checkInterval = 200;

        while (attempts < maxAttempts) {
            const editor1Content = editor1.document.getText();
            const editor2Content = editor2.document.getText();
            if (editor1Content.length > 0 && editor2Content.length > 0) {
                break;
            }
            attempts++;
            await new Promise(resolve => setTimeout(resolve, checkInterval));
        }

        const finalEditor1Content = editor1.document.getText();
        const finalEditor2Content = editor2.document.getText();
        if (finalEditor1Content.length === 0 || finalEditor2Content.length === 0) {
            vscode.window.showErrorMessage('Editor content load timeout, please try again later.');
            return { error: 'EDITOR_CONTENT_LOAD_TIMEOUT' };
        }

        await fs.promises.mkdir(OI_CODE_TEST_BASE_PATH, { recursive: true });
        const tempDir = await fs.promises.mkdtemp(path.join(OI_CODE_TEST_BASE_PATH, 'pair-'));
        try {
            const file1Path = path.join(tempDir, `code1.${langId}`);
            const file2Path = path.join(tempDir, `code2.${langId}`);
            await fs.promises.writeFile(file1Path, finalEditor1Content);
            await fs.promises.writeFile(file2Path, finalEditor2Content);

            const input = testInput ?? '';
            const timeLimit = options?.timeLimit ?? DEFAULT_PAIR_CHECK_TIME_LIMIT;

            const pairResult = await this.runPairWithNativeCompilers(context, file1Path, file2Path, langId, input, {
                timeLimit,
                memoryLimit: DEFAULT_PAIR_CHECK_MEMORY_LIMIT
            });
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
            const equal = normalizeOutput(output1) === normalizeOutput(output2);

            this.setOutputs(htmlEscape(output1), htmlEscape(output2));
            return { output1, output2, equal };
        } catch (e: any) {
            vscode.window.showErrorMessage(`Pair check execution error: ${e.message}`);
            return { error: e.message };
        } finally {
            await fs.promises.rm(tempDir, { recursive: true, force: true });
        }
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.ExtensionContext,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ) {
        this._view = webviewView;
        webviewView.webview.options = { enableScripts: true, localResourceRoots: [context.extensionUri] };
        webviewView.webview.html = this.getWebViewContent();

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

                    const file1Path = path.join(tempDir, `code1.${langId}`);
                    const file2Path = path.join(tempDir, `code2.${langId}`);
                    await fs.promises.writeFile(file1Path, editor1.document.getText());
                    await fs.promises.writeFile(file2Path, editor2.document.getText());

                    const pairResult = await this.runPairWithNativeCompilers(
                        context,
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
                        const { html1, html2 } = this.createDiffHtml(output1, output2);
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

    public startPairCheck() {
        const activeEditor = vscode.window.activeTextEditor;
        if (!activeEditor) {
            vscode.window.showErrorMessage('Please open a file first to start pair check.');
            return;
        }

        const originalDoc = activeEditor.document;

        vscode.workspace
            .openTextDocument({
                content: '// Place or write your pair check code here\n// For example, a brute force solution\n',
                language: originalDoc.languageId
            })
            .then(pairDoc => {
                vscode.window.showTextDocument(pairDoc, vscode.ViewColumn.Beside);
                vscode.commands.executeCommand('oicode.pairCheckView.focus');
            });
    }
}
