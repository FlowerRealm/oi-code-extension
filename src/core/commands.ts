import * as vscode from 'vscode';
import * as path from 'path';
import { NativeCompilerManager } from '../native';
import { CompilerInfo } from '../types';
import { DEFAULT_MEMORY_LIMIT, DEFAULT_SINGLE_RUN_TIME_LIMIT } from '../constants';
import {
    htmlEscape,
    postWebviewMessage,
    getTheme,
    getLanguageIdFromEditor,
    getWebviewContent
} from '../utils/webview-utils';
import { getSuitableCompiler } from '../extension';

export class CommandManager {
    private static instance: CommandManager;
    private context: vscode.ExtensionContext | undefined;

    private constructor() {}

    public static getInstance(): CommandManager {
        if (!CommandManager.instance) {
            CommandManager.instance = new CommandManager();
        }
        return CommandManager.instance;
    }

    public setContext(context: vscode.ExtensionContext) {
        this.context = context;
    }

    private async getSuitableCompiler(languageId: 'c' | 'cpp'): Promise<CompilerInfo> {
        if (!this.context) {
            throw new Error('Context not initialized');
        }
        return getSuitableCompiler(this.context, languageId);
    }

    public async runCode(testInput?: string, options?: { timeLimit?: number; memoryLimit?: number }) {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return vscode.window.showErrorMessage('Please open a file to run.');
        }
        const document = editor.document;
        const languageId = getLanguageIdFromEditor(editor);
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
                return;
            }
        }
        const timeLimit = options?.timeLimit ?? DEFAULT_SINGLE_RUN_TIME_LIMIT;
        const memoryLimit = options?.memoryLimit ?? DEFAULT_MEMORY_LIMIT;

        return vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: `Running ${sourceFile}...`,
                cancellable: false
            },
            async progress => {
                progress.report({ increment: 0, message: 'Detecting compilers...' });
                try {
                    const config = vscode.workspace.getConfiguration('oicode');
                    const optimizationLevel = config.get<string>('compile.opt');
                    let standard = config.get<string>('compile.std');

                    if (standard) {
                        const isCppStandard = standard.startsWith('c++');
                        const isCStandard = standard.startsWith('c') && !isCppStandard;

                        if (languageId === 'c' && isCppStandard) {
                            standard = 'c17';
                        } else if (languageId === 'cpp' && isCStandard) {
                            standard = 'c++17';
                        }
                    }

                    const compiler = await this.getSuitableCompiler(languageId);
                    progress.report({ increment: 50, message: `Compiling with ${compiler.type}...` });

                    const result = await NativeCompilerManager.compileAndRun({
                        sourcePath: document.uri.fsPath,
                        language: languageId,
                        compiler: compiler,
                        input: input || '',
                        timeLimit,
                        memoryLimit,
                        optimizationLevel,
                        standard
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

    public async initializeEnvironment() {
        if (!this.context) {
            throw new Error('Context not initialized');
        }

        vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: 'Check Compiler Environment',
                cancellable: false
            },
            async progress => {
                progress.report({ message: 'Detecting compilers...' });
                try {
                    const result = await NativeCompilerManager.detectCompilers(this.context!);

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
                    vscode.window.showErrorMessage(`Compiler environment initialization failed: ${error.message}`);
                }
            }
        );
    }

    public async rescanCompilers() {
        if (!this.context) {
            throw new Error('Context not initialized');
        }

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
                        const result = await NativeCompilerManager.forceRescanCompilers(this.context!);
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
    }

    public async setupCompiler() {
        if (!this.context) {
            throw new Error('Context not initialized');
        }

        try {
            const result = await NativeCompilerManager.detectCompilers(this.context);

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
                        if (installResult.restartRequired) {
                            const restartChoice = await vscode.window.showInformationMessage(
                                'Compiler installation completed. Restart VS Code to detect the new compiler.',
                                { modal: true },
                                'Restart Now',
                                'Restart Later'
                            );
                            if (restartChoice === 'Restart Now') {
                                vscode.commands.executeCommand('workbench.action.reloadWindow');
                            }
                        }
                    } else {
                        vscode.window.showErrorMessage(installResult.message, 'View Details').then(selection => {
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
    }

    public async deepScanCompilers() {
        if (!this.context) {
            throw new Error('Context not initialized');
        }

        try {
            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: 'Deep Scanning for Compilers...',
                    cancellable: true
                },
                async (progress, token) => {
                    progress.report({ message: 'Performing deep system scan for compilers...' });

                    const result = await NativeCompilerManager.detectCompilers(this.context, true, true);

                    if (token.isCancellationRequested) {
                        return;
                    }

                    if (result.success && result.compilers.length > 0) {
                        const detectedMessage =
                            `Deep scan found ${result.compilers.length} compilers. ` +
                            `Recommended: ${result.recommended?.name || 'first compiler'}`;
                        vscode.window.showInformationMessage(detectedMessage);
                    } else {
                        vscode.window.showInformationMessage('Deep scan completed. No additional compilers found.');
                    }

                    NativeCompilerManager.getOutputChannel().show(true);
                }
            );
        } catch (error: any) {
            vscode.window.showErrorMessage(`Deep scan failed: ${error.message}`);
        }
    }

    public showSettingsPage() {
        if (!this.context) {
            throw new Error('Context not initialized');
        }

        const panel = vscode.window.createWebviewPanel('oiCodeSettings', 'OI-Code Settings', vscode.ViewColumn.One, {
            enableScripts: true,
            retainContextWhenHidden: true
        });

        this.getWebviewContent('settings.html').then(html => (panel.webview.html = html));

        const themeListener = vscode.window.onDidChangeActiveColorTheme(e => {
            postWebviewMessage(panel, 'set-theme', { theme: getTheme(e.kind) });
        });

        panel.onDidDispose(() => {
            themeListener.dispose();
        });
    }

    private async getWebviewContent(fileName: string): Promise<string> {
        if (!this.context) {
            throw new Error('Context not initialized');
        }
        return getWebviewContent(this.context, fileName);
    }
}
