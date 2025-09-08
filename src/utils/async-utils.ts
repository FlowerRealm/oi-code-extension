import * as vscode from 'vscode';

export interface ProgressOptions {
    title: string;
    location?: vscode.ProgressLocation;
    cancellable?: boolean;
}

export interface ErrorHandlerOptions {
    errorMessage: string;
    progressMessage?: { message: string };
}

export class AsyncUtils {
    public static async withProgress<T>(
        options: ProgressOptions,
        callback: (progress: vscode.Progress<{ message: string; increment?: number }>) => Promise<T>,
        errorHandler?: ErrorHandlerOptions
    ): Promise<T> {
        return vscode.window.withProgress(
            {
                location: options.location || vscode.ProgressLocation.Notification,
                title: options.title,
                cancellable: options.cancellable || false
            },
            async progress => {
                try {
                    return await callback(progress);
                } catch (error: unknown) {
                    if (errorHandler?.progressMessage) {
                        progress.report(errorHandler.progressMessage);
                    }
                    if (errorHandler?.errorMessage) {
                        const errorMessage = error instanceof Error ? error.message : String(error);
                        vscode.window.showErrorMessage(`${errorHandler.errorMessage}: ${errorMessage}`);
                    }
                    throw error;
                }
            }
        );
    }

    public static async delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    public static async withTimeout<T>(
        promise: Promise<T>,
        timeoutMs: number,
        timeoutError: Error = new Error('Operation timed out')
    ): Promise<T> {
        const timeoutPromise = new Promise<never>((_, reject) => {
            setTimeout(() => reject(timeoutError), timeoutMs);
        });

        return Promise.race([promise, timeoutPromise]);
    }
}
