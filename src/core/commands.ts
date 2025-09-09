import * as vscode from 'vscode';
import * as path from 'path';
import { NativeCompilerManager } from '../native';
import { DEFAULT_OPTIMIZATION_LEVEL, DEFAULT_CPP_STANDARD, DEFAULT_C_STANDARD, ERROR_MESSAGES } from '../constants';
import { getSuitableCompiler, detectCompilersWithProgress, setupLanguageCompiler } from '../utils/compiler-utils';
import { UnifiedUtils } from '../utils/unified-utils';
import { BaseManager } from './base-manager';
import { Logger } from '../utils/logger';
import { UnifiedConfigManager } from '../utils/unified-config-manager';
import { AsyncUtils } from '../utils/async-utils';
import { CompilerSetupHelper } from '../utils/compiler-setup-helper';

export class CommandManager extends BaseManager {
    private static instance: CommandManager;
    protected logger!: Logger;
    protected configManager!: UnifiedConfigManager;

    private constructor() {
        super();
        this.initializeDependencies();
    }

    public static getInstance(): CommandManager {
        if (!CommandManager.instance) {
            CommandManager.instance = new CommandManager();
        }
        return CommandManager.instance;
    }

    private initializeDependencies(): void {
        this.logger = Logger.getInstance();
        this.configManager = UnifiedConfigManager.getInstance();
    }

    public async runCode(testInput?: string, options?: { timeLimit?: number; memoryLimit?: number }) {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            this.handleError(new Error(ERROR_MESSAGES.NO_ACTIVE_EDITOR), '运行代码');
            return;
        }

        const input =
            testInput ??
            (await vscode.window.showInputBox({
                prompt: 'Enter input for the program',
                placeHolder: 'Type your input here...'
            }));

        if (input === undefined) return;

        const compilerConfig = this.configManager.getCompilerConfig();
        const runConfig = this.configManager.getRunConfig();

        return AsyncUtils.withProgress(
            { title: `Running ${path.basename(editor.document.fileName)}...` },
            async progress => {
                progress.report({ increment: 0, message: 'Detecting compilers...' });

                const compiler = await getSuitableCompiler(
                    this.getContext(),
                    editor.document.languageId === 'c' ? 'c' : 'cpp'
                );
                progress.report({ increment: 50, message: `Compiling with ${compiler.type}...` });

                const result = await NativeCompilerManager.compileAndRun({
                    sourcePath: editor.document.uri.fsPath,
                    language: editor.document.languageId === 'c' ? 'c' : 'cpp',
                    compiler: compiler,
                    input: input || '',
                    timeLimit: options?.timeLimit ?? runConfig.timeLimit,
                    memoryLimit: options?.memoryLimit ?? runConfig.memoryLimit,
                    optimizationLevel: compilerConfig.optimizationLevel ?? DEFAULT_OPTIMIZATION_LEVEL,
                    standard: this.adjustStandardForLanguage(
                        compilerConfig.standard,
                        editor.document.languageId === 'c' ? 'c' : 'cpp'
                    )
                });

                progress.report({ increment: 100, message: 'Complete' });

                // Auto-open output panel if enabled
                if (runConfig.autoOpenOutput) {
                    this.showOutput(result, path.basename(editor.document.fileName));
                }

                return {
                    output: result.stdout || '',
                    error: result.stderr || '',
                    timedOut: result.timedOut || false,
                    memoryExceeded: result.memoryExceeded || false,
                    spaceExceeded: result.spaceExceeded || false
                };
            },
            { errorMessage: '运行代码时发生未知错误' }
        );
    }

    private showOutput(
        result: {
            stdout?: string;
            stderr?: string;
            timedOut?: boolean;
            memoryExceeded?: boolean;
            spaceExceeded?: boolean;
        },
        sourceFile: string
    ): void {
        const panel = vscode.window.createWebviewPanel(
            'oiCodeOutput',
            `Output for ${sourceFile}`,
            vscode.ViewColumn.Two,
            {}
        );
        panel.webview.html = this.formatOutput(result);
    }

    private formatOutput(result: {
        stdout?: string;
        stderr?: string;
        timedOut?: boolean;
        memoryExceeded?: boolean;
        spaceExceeded?: boolean;
    }): string {
        const meta: string[] = [];
        if (result.timedOut) meta.push('TimedOut');
        if (result.memoryExceeded) meta.push('MemoryExceeded');
        if (result.spaceExceeded) meta.push('SpaceExceeded');

        let content = '';
        if (meta.length) content += `<p><b>Flags:</b> ${meta.join(', ')}</p>`;
        if (result.stdout) content += `<h2>Output:</h2><pre>${UnifiedUtils.htmlEscape(result.stdout)}</pre>`;
        if (result.stderr) content += `<h2>Error:</h2><pre>${UnifiedUtils.htmlEscape(result.stderr)}</pre>`;

        return content || '<i>No output</i>';
    }

    public async initializeEnvironment() {
        await detectCompilersWithProgress(this.getContext(), 'Check Compiler Environment', false, false);
    }

    public async rescanCompilers() {
        await detectCompilersWithProgress(
            this.getContext(),
            'Rescanning compilers...',
            true,
            false,
            'Compiler rescan completed!'
        );
    }

    public async setupCompiler() {
        return await CompilerSetupHelper.setupCompiler({
            title: 'Setting up compiler',
            showProgress: true
        });
    }

    public async setupCCompiler() {
        await setupLanguageCompiler(this.getContext(), 'c');
    }

    public async setupCppCompiler() {
        await setupLanguageCompiler(this.getContext(), 'cpp');
    }

    public async deepScanCompilers() {
        await detectCompilersWithProgress(
            this.getContext(),
            'Deep Scanning for Compilers...',
            false,
            true,
            'Deep scan completed!'
        );
        NativeCompilerManager.getOutputChannel().show(true);
    }

    private adjustStandardForLanguage(standard: string | undefined, languageId: 'c' | 'cpp'): string | undefined {
        if (!standard) return undefined;

        const isCppStandard = standard.startsWith('c++');
        const isCStandard = standard.startsWith('c') && !isCppStandard;

        if (languageId === 'c' && isCppStandard) {
            return DEFAULT_C_STANDARD;
        } else if (languageId === 'cpp' && isCStandard) {
            return DEFAULT_CPP_STANDARD;
        }

        return standard;
    }
}
