import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as Diff from 'diff';
import { NativeCompilerManager } from '../native';
import { CompilerInfo } from '../types';
import { DEFAULT_PAIR_CHECK_TIME_LIMIT, DEFAULT_PAIR_CHECK_MEMORY_LIMIT, OI_CODE_TEST_BASE_PATH } from '../constants';
import { htmlEscape, getLanguageIdFromEditor, normalizeOutput, getWebviewContent } from '../utils/webview-utils';
import { getSuitableCompiler } from '../extension';

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

    private async getSuitableCompiler(
        context: vscode.ExtensionContext,
        languageId: 'c' | 'cpp'
    ): Promise<CompilerInfo> {
        return getSuitableCompiler(context, languageId);
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

    private async executePairCheck(
        context: vscode.ExtensionContext,
        editor1: vscode.TextEditor,
        editor2: vscode.TextEditor,
        input: string,
        options?: { timeLimit?: number; memoryLimit?: number }
    ) {
        const langId = getLanguageIdFromEditor(editor1);
        if (editor2.document.languageId !== langId) {
            throw new Error('Both code files must have the same language type.');
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
            throw new Error('Editor content load timeout, please try again later.');
        }

        await fs.promises.mkdir(OI_CODE_TEST_BASE_PATH, { recursive: true });
        const tempDir = await fs.promises.mkdtemp(path.join(OI_CODE_TEST_BASE_PATH, 'pair-'));
        try {
            const file1Path = path.join(tempDir, `code1.${langId}`);
            const file2Path = path.join(tempDir, `code2.${langId}`);
            await fs.promises.writeFile(file1Path, finalEditor1Content);
            await fs.promises.writeFile(file2Path, finalEditor2Content);

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

            return { output1, output2, equal };
        } finally {
            await fs.promises.rm(tempDir, { recursive: true, force: true });
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

        try {
            const input = testInput ?? '';
            const result = await this.executePairCheck(context, editor1, editor2, input, options);
            this.setOutputs(htmlEscape(result.output1), htmlEscape(result.output2));
            return result;
        } catch (e: any) {
            vscode.window.showErrorMessage(`Pair check execution error: ${e.message}`);
            return { error: e.message };
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
        getWebviewContent(context, 'pair-check.html').then(html => {
            if (this._view) {
                this._view.webview.html = html;
            }
        });

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

                    this.setOutputs('<i>Running...</i>', '<i>Running...</i>');

                    const result = await this.executePairCheck(context, editor1, editor2, message.input, {
                        timeLimit: DEFAULT_PAIR_CHECK_TIME_LIMIT,
                        memoryLimit: DEFAULT_PAIR_CHECK_MEMORY_LIMIT
                    });

                    const output1 = result.output1.includes('ERROR:')
                        ? `<b>Error:</b>\n${htmlEscape(result.output1.replace('ERROR:\n', ''))}`
                        : result.output1;
                    const output2 = result.output2.includes('ERROR:')
                        ? `<b>Error:</b>\n${htmlEscape(result.output2.replace('ERROR:\n', ''))}`
                        : result.output2;

                    if (result.output1.includes('ERROR') || result.output2.includes('ERROR')) {
                        this.setOutputs(output1, output2);
                    } else if (result.equal) {
                        this.setOutputs(
                            '<span style="color:var(--vscode-terminal-ansiGreen);">Output matches (Accepted)</span>',
                            '<span style="color:var(--vscode-terminal-ansiGreen);">Output matches (Accepted)</span>'
                        );
                    } else {
                        const { html1, html2 } = this.createDiffHtml(result.output1, result.output2);
                        this.setOutputs(html1, html2);
                    }
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
