/* ---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *-------------------------------------------------------------------------------------------- */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
// Interface definitions moved here to avoid circular imports

/**
 * Compiler information interface
 */
export interface CompilerInfo {
    path: string;
    name: string;
    type: 'clang' | 'clang++' | 'gcc' | 'g++' | 'msvc' | 'apple-clang';
    version: string;
    supportedStandards: string[];
    is64Bit: boolean;
    priority: number;
}

/**
 * Compiler detection result
 */
export interface CompilerDetectionResult {
    success: boolean;
    compilers: CompilerInfo[];
    recommended?: CompilerInfo;
    error?: string;
    suggestions: string[];
}

/**
 * LLVM installation result
 */
export interface LLVMInstallResult {
    success: boolean;
    message: string;
    installedPath?: string;
    restartRequired?: boolean;
    nextSteps?: string[];
}

import { CompilerCache } from './compilerCache';
import { CompilerDetector } from './compilerDetector';
import { CompilerInstaller } from './compilerInstaller';
import { ProcessRunner } from './processRunner';

/**
 * Compilation and execution options
 */
export interface CompilationOptions {
    sourcePath: string;
    language: 'c' | 'cpp';
    compiler: CompilerInfo;
    input?: string;
    timeLimit?: number;
    memoryLimit?: number;
    optimizationLevel?: string;
    standard?: string;
}

/**
 * Compilation and execution result
 */
export interface CompilationResult {
    success: boolean;
    stdout: string;
    stderr: string;
    timedOut?: boolean;
    memoryExceeded?: boolean;
    spaceExceeded?: boolean;
    executionTime?: number;
}

/**
 * Refactored native compiler manager using modular components
 */
export class NativeCompilerManager {
    private static outputChannel: vscode.OutputChannel | null = null;

    /**
     * Get or create output channel
     */
    public static getOutputChannel(): vscode.OutputChannel {
        if (!this.outputChannel) {
            this.outputChannel = vscode.window.createOutputChannel('OI-Code Native Compiler');
        }
        return this.outputChannel;
    }

    /**
     * Filter compilers suitable for specific language
     */
    public static filterSuitableCompilers(languageId: 'c' | 'cpp', compilers: CompilerInfo[]): CompilerInfo[] {
        return compilers.filter(c =>
            languageId === 'c'
                ? (c.type === 'clang' || c.type === 'gcc' || c.type === 'msvc' || c.type === 'apple-clang')
                : (c.type === 'clang++' || c.type === 'g++' || c.type === 'msvc' || c.type === 'apple-clang')
        );
    }

    /**
     * Force rescan of compilers (clear cache and detect again)
     */
    public static async forceRescanCompilers(context: vscode.ExtensionContext): Promise<CompilerDetectionResult> {
        console.log('[NativeCompilerManager] Forcing compiler rescan...');
        await CompilerCache.clearCachedCompilers(context);
        return await this.detectCompilers(context, true);
    }

    /**
     * Detect compilers with caching support
     */
    public static async detectCompilers(
        context?: vscode.ExtensionContext,
        forceRescan: boolean = false,
        performDeepScan: boolean = false
    ): Promise<CompilerDetectionResult> {
        if (!context) {
            return await CompilerDetector.detectCompilers(performDeepScan);
        }

        // Try to load from cache first
        if (!forceRescan) {
            const cached = await CompilerCache.loadCachedCompilers(context);
            if (cached) {
                console.log('[NativeCompilerManager] Using cached compiler detection results');
                return cached;
            }
        }

        // Perform detection
        console.log('[NativeCompilerManager] Performing compiler detection...');
        const result = await CompilerDetector.detectCompilers(performDeepScan);

        // Cache the result
        if (context && result.success) {
            await CompilerCache.saveCachedCompilers(context, result);
        }

        return result;
    }

    /**
     * Clear cached compilers
     */
    public static async clearCachedCompilers(context: vscode.ExtensionContext): Promise<void> {
        await CompilerCache.clearCachedCompilers(context);
    }

    /**
     * Install LLVM automatically
     */
    public static async installLLVM(): Promise<LLVMInstallResult> {
        return await CompilerInstaller.installLLVM();
    }

    /**
     * Compile and run source code
     */
    public static async compileAndRun(options: CompilationOptions): Promise<CompilationResult> {
        const {
            sourcePath,
            language,
            compiler,
            input = '',
            timeLimit = 10,
            memoryLimit = 256,
            optimizationLevel = 'O0',
            standard
        } = options;

        const outputChannel = this.getOutputChannel();
        outputChannel.appendLine(`[NativeCompilerManager] Compiling ${sourcePath} with ${compiler.name}`);

        try {
            // Check if source file exists
            if (!(await ProcessRunner.fileExists(sourcePath))) {
                throw new Error(`Source file not found: ${sourcePath}`);
            }

            // Check disk space
            const sourceDir = path.dirname(sourcePath);
            if (!(await ProcessRunner.checkDiskSpace(sourceDir, 100))) {
                throw new Error('Insufficient disk space for compilation');
            }

            // Generate temporary executable path
            const tempDir = path.join(os.tmpdir(), 'oi-code');
            await fs.mkdir(tempDir, { recursive: true });
            const executableName = path.basename(sourcePath, path.extname(sourcePath));
            const executablePath = path.join(tempDir, `${executableName}-${Date.now()}${process.platform === 'win32' ? '.exe' : ''}`);

            // Get compiler arguments
            const compilerArgs = this.getCompilerArgs(compiler, language, executablePath, optimizationLevel, standard);

            // Add source file path to args
            compilerArgs.push(sourcePath);

            // Apply compiler workarounds
            const finalArgs = this.applyCompilerWorkarounds(compiler, language, compilerArgs);

            outputChannel.appendLine(`[NativeCompilerManager] Compiler args: ${finalArgs.join(' ')}`);

            // Compile the source
            const compileResult = await ProcessRunner.executeWithTimeout({
                command: compiler.path,
                args: finalArgs,
                cwd: path.dirname(sourcePath),
                timeout: 30000,
                outputChannel
            });

            if (compileResult.exitCode !== 0) {
                outputChannel.appendLine(`[NativeCompilerManager] Compilation failed: ${compileResult.stderr}`);
                return {
                    success: false,
                    stdout: compileResult.stdout,
                    stderr: compileResult.stderr,
                    timedOut: compileResult.timedOut,
                    memoryExceeded: compileResult.memoryExceeded
                };
            }

            outputChannel.appendLine('[NativeCompilerManager] Compilation successful, executing...');

            // Execute the compiled program
            const execResult = await ProcessRunner.executeWithTimeout({
                command: executablePath,
                args: [],
                cwd: path.dirname(sourcePath),
                timeout: timeLimit * 1000,
                memoryLimit: memoryLimit * 1024 * 1024,
                input,
                outputChannel
            });

            // Clean up temporary files
            try {
                await fs.unlink(executablePath);
            } catch (error) {
                outputChannel.appendLine(`[NativeCompilerManager] Failed to cleanup temporary file: ${error}`);
            }

            return {
                success: execResult.exitCode === 0,
                stdout: execResult.stdout,
                stderr: execResult.stderr,
                timedOut: execResult.timedOut,
                memoryExceeded: execResult.memoryExceeded,
                spaceExceeded: execResult.memoryExceeded, // For compatibility
                executionTime: execResult.exitCode === 0 ? undefined : undefined
            };
        } catch (error: any) {
            outputChannel.appendLine(`[NativeCompilerManager] Error: ${error.message}`);
            return {
                success: false,
                stdout: '',
                stderr: error.message,
                timedOut: false,
                memoryExceeded: false
            };
        }
    }

    /**
     * Get compiler arguments for compilation
     */
    private static getCompilerArgs(
        compiler: CompilerInfo,
        language: 'c' | 'cpp',
        outputPath: string,
        optimizationLevel: string = 'O0',
        standard?: string
    ): string[] {
        const args: string[] = [];

        // Basic compilation flags
        args.push('-o', outputPath);

        // Optimization level
        if (optimizationLevel && optimizationLevel.startsWith('O')) {
            args.push(`-${optimizationLevel}`);
        }

        // Language standard
        if (standard) {
            args.push(`-std=${standard}`);
        } else {
            // Use appropriate default standard
            if (language === 'c') {
                args.push('-std=c11');
            } else {
                args.push('-std=c++17');
            }
        }

        // Compiler-specific flags
        if (compiler.type === 'msvc') {
            // MSVC-specific flags
            args.push('/nologo');
            if (language === 'c') {
                args.push('/TC');
            } else {
                args.push('/TP');
            }
        } else {
            // GCC/Clang flags
            args.push('-Wall', '-Wextra');

            // Enable colors in output
            if (compiler.type === 'clang' || compiler.type === 'apple-clang') {
                args.push('-fcolor-diagnostics');
            }

            // Platform-specific flags
            if (process.platform === 'win32') {
                args.push('-fno-stack-protector');
            }
        }

        // Add source file path
        // Note: The source path will be added by the caller

        return args;
    }

    /**
     * Apply compiler-specific workarounds
     */
    private static applyCompilerWorkarounds(
        compiler: CompilerInfo,
        language: 'c' | 'cpp',
        args: string[]
    ): string[] {
        const config = vscode.workspace.getConfiguration('oicode.compile');

        // Handle Clang 20+ C++17 compatibility issue
        if (compiler.type === 'clang' || compiler.type === 'apple-clang') {
            const versionMatch = compiler.version.match(/^(\d+)/);
            if (versionMatch && parseInt(versionMatch[1]) >= 20) {
                const autoDowngrade = config.get<boolean>('autoDowngradeClang20', true);
                if (autoDowngrade && language === 'cpp') {
                    // Replace C++17 with C++14 for better compatibility
                    const stdIndex = args.findIndex(arg => arg.startsWith('-std=c++'));
                    if (stdIndex !== -1 && args[stdIndex].includes('c++17')) {
                        args[stdIndex] = args[stdIndex].replace('c++17', 'c++14');
                        this.getOutputChannel().appendLine(
                            '[NativeCompilerManager] Applied Clang 20+ workaround: downgraded C++17 to C++14'
                        );
                    }
                }
            }
        }

        return args;
    }
}
