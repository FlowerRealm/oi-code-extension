import * as vscode from 'vscode';

export class UiUtils {
    static showError(message: string, options?: vscode.MessageOptions): Thenable<string | undefined> {
        return vscode.window.showErrorMessage(message, options || {});
    }

    static showInfo(message: string, options?: vscode.MessageOptions): Thenable<string | undefined> {
        return vscode.window.showInformationMessage(message, options || {});
    }

    static showWarning(message: string, options?: vscode.MessageOptions): Thenable<string | undefined> {
        return vscode.window.showWarningMessage(message, options || {});
    }

    static async showConfirmation(message: string, modal: boolean = false): Promise<boolean> {
        const result = await vscode.window.showWarningMessage(message, { modal }, 'Yes', 'No');
        return result === 'Yes';
    }

    static showInputBox(options: vscode.InputBoxOptions): Thenable<string | undefined> {
        return vscode.window.showInputBox(options);
    }

    static showQuickPick<T extends vscode.QuickPickItem>(
        items: T[],
        options: vscode.QuickPickOptions
    ): Thenable<T | undefined> {
        return vscode.window.showQuickPick(items, options);
    }

    static showOpenDialog(options: vscode.OpenDialogOptions): Thenable<vscode.Uri[] | undefined> {
        return vscode.window.showOpenDialog(options);
    }
}
