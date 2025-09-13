import * as vscode from 'vscode';

export abstract class AdvancedBaseManager {
    protected context!: vscode.ExtensionContext;

    protected constructor() {}

    public setContext(context: vscode.ExtensionContext): void {
        this.context = context;
    }

    protected getContext(): vscode.ExtensionContext {
        if (!this.context) {
            throw new Error('Context not initialized');
        }
        return this.context;
    }

    protected handleError(error: unknown, message: string): void {
        const errorMessage = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(`${message}: ${errorMessage}`);
    }

    protected showInfo(message: string): void {
        vscode.window.showInformationMessage(message);
    }

    protected showWarning(message: string): void {
        vscode.window.showWarningMessage(message);
    }

    protected async showConfirmation(message: string, modal: boolean = false): Promise<boolean> {
        const result = await vscode.window.showWarningMessage(message, { modal }, '是', '否');
        return result === '是';
    }
}
