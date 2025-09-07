/* ---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *-------------------------------------------------------------------------------------------- */

// Re-export the core extension functionality
export { activate, deactivate } from './core/extension';

// Keep backward compatibility for external modules
import * as vscode from 'vscode';
import { NativeCompilerManager } from './native';
import { CompilerInfo } from './types';

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
