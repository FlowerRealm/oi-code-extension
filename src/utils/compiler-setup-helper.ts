import * as vscode from 'vscode';
import { NativeCompilerManager } from '../native/manager/nativeCompilerManager';
import { UnifiedUtils } from './unified-utils';
import { UnifiedConfigManager } from './unified-config-manager';
import { Logger } from './logger';

export interface CompilerSetupOptions {
    title?: string;
    showProgress?: boolean;
    force?: boolean;
}

export class CompilerSetupHelper {
    private static logger = Logger.getInstance();
    private static configManager = UnifiedConfigManager.getInstance();

    public static async setupCompiler(options: CompilerSetupOptions = {}): Promise<boolean> {
        const { title = 'Setting up compiler', showProgress = true, force = false } = options;

        try {
            if (showProgress) {
                return await UnifiedUtils.withProgress({ title, cancellable: false }, async progress => {
                    progress.report({ message: 'Initializing...' });
                    return await this.doSetupCompiler(force, progress);
                });
            } else {
                return await this.doSetupCompiler(force);
            }
        } catch (error) {
            this.logger.error('Failed to setup compiler:', error);
            UnifiedUtils.handleError(error, 'Compiler setup');
            return false;
        }
    }

    private static async doSetupCompiler(
        force: boolean,
        progress?: vscode.Progress<{ message?: string; increment?: number }>
    ): Promise<boolean> {
        if (progress) {
            progress.report({ message: 'Detecting compilers...' });
        }

        const detectionResult = await NativeCompilerManager.detectCompilers();

        if (detectionResult.compilers.length > 0 && !force) {
            if (progress) {
                progress.report({ message: 'Compilers already detected', increment: 100 });
            }
            return true;
        }

        if (progress) {
            progress.report({ message: 'No compilers found, installing LLVM...' });
        }

        const installResult = await NativeCompilerManager.installLLVM();

        if (installResult.success) {
            if (progress) {
                progress.report({ message: 'LLVM installed successfully', increment: 100 });
            }
            return true;
        } else {
            throw new Error('Failed to install LLVM automatically');
        }
    }

    public static async detectCompilersWithProgress(): Promise<void> {
        await UnifiedUtils.withProgress({ title: 'Detecting compilers', cancellable: false }, async progress => {
            progress.report({ message: 'Scanning system for compilers...' });

            const detectionResult = await NativeCompilerManager.detectCompilers();

            progress.report({
                message: `Found ${detectionResult.compilers.length} compiler(s)`,
                increment: 100
            });

            if (detectionResult.compilers.length === 0) {
                const shouldInstall = await UnifiedUtils.showConfirmation(
                    'No compilers found. Would you like to install LLVM automatically?'
                );

                if (shouldInstall) {
                    await this.setupCompiler({
                        title: 'Installing LLVM',
                        showProgress: true
                    });
                }
            }
        });
    }
}
