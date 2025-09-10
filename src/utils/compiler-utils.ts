import * as vscode from 'vscode';
import { NativeCompilerManager } from '../native';
import { CompilerInfo } from '../types';

/**
 * Public function: Detect and select suitable compiler
 * @param context VS Code extension context
 * @param languageId Language ID ('c' or 'cpp')
 * @returns Returns selected compiler information, throws error if no suitable compiler found
 */
export async function getSuitableCompiler(
    context: vscode.ExtensionContext,
    languageId: 'c' | 'cpp'
): Promise<CompilerInfo> {
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

/**
 * Detect compilers with progress reporting
 * @param context VS Code extension context
 * @param title Progress title
 * @param forceRescan Whether to force rescan
 * @param deepScan Whether to perform deep scan
 * @param successMessage Optional success message
 */
export async function detectCompilersWithProgress(
    context: vscode.ExtensionContext,
    title: string,
    forceRescan: boolean = false,
    _deepScan: boolean = false,
    successMessage?: string
): Promise<void> {
    return await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title,
            cancellable: false
        },
        async progress => {
            progress.report({ increment: 0 });

            const result = forceRescan
                ? await NativeCompilerManager.forceRescanCompilers(context)
                : await NativeCompilerManager.detectCompilers(context);

            progress.report({ increment: 100 });

            if (result.success && result.compilers.length > 0) {
                const message = successMessage || 'Compiler detection complete!';
                vscode.window.showInformationMessage(message);
            } else {
                vscode.window.showWarningMessage('No available compilers detected');
            }
        }
    );
}

/**
 * Setup compiler with language filter
 * @param context VS Code extension context
 * @param options Setup options
 */
export async function setupLanguageCompiler(context: vscode.ExtensionContext, language: 'c' | 'cpp'): Promise<void> {
    const languageName = language === 'c' ? 'C' : 'C++';
    const title = `选择${languageName}编译器`;
    const placeholder = `检测到${languageName}编译器，请选择要使用的编译器`;

    const languageFilter = (compiler: CompilerInfo) => {
        if (language === 'c') {
            return compiler.type === 'gcc' || compiler.type === 'clang' || compiler.type === 'apple-clang';
        } else {
            return compiler.type === 'g++' || compiler.type === 'clang++';
        }
    };

    try {
        const result = await NativeCompilerManager.detectCompilers(context);

        if (result.success && result.compilers.length > 0) {
            // Debug: Show all detected compilers
            console.log('[DEBUG] All detected compilers:');
            result.compilers.forEach(compiler => {
                console.log(`[DEBUG] - ${compiler.name} (${compiler.type}) at ${compiler.path}`);
            });

            const compilers = result.compilers.filter(languageFilter);

            // Debug: Show filtered compilers
            console.log(`[DEBUG] Filtered ${languageName} compilers:`);
            compilers.forEach(compiler => {
                console.log(`[DEBUG] - ${compiler.name} (${compiler.type}) at ${compiler.path}`);
            });

            if (compilers.length === 0) {
                vscode.window.showWarningMessage(`No ${languageName} compilers found`);
                return;
            }

            const compilerOptions = compilers.map(compiler => ({
                label: `${compiler.name} ${compiler.version}`,
                description: compiler.path,
                detail: compiler === result.recommended ? '推荐编译器' : undefined,
                compiler
            }));

            const selected = await vscode.window.showQuickPick(compilerOptions, {
                title,
                placeHolder: placeholder,
                canPickMany: false
            });

            if (selected && selected.compiler) {
                vscode.window.showInformationMessage(`已选择编译器: ${selected.label}`);
            }
        } else {
            const choice = await vscode.window.showInformationMessage(
                'No C/C++ compilers detected. Would you like to install LLVM?',
                { modal: true },
                'Install LLVM'
            );

            if (choice === 'Install LLVM') {
                const installResult = await NativeCompilerManager.installLLVM();
                if (installResult.success) {
                    vscode.window.showInformationMessage(installResult.message);
                } else {
                    vscode.window.showErrorMessage(installResult.message);
                }
            }
        }
    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(`Compiler setup failed: ${errorMessage}`);
    }
}
