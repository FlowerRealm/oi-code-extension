import * as vscode from 'vscode';
import { AdvancedBaseManager } from './advanced-base-manager';

export abstract class BaseManager extends AdvancedBaseManager {
    protected constructor() {
        super();
    }

    protected async showErrorWithDetails(
        error: unknown,
        message: string,
        detailsAction: string = 'View Details'
    ): Promise<void> {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const choice = await vscode.window.showErrorMessage(`${message}: ${errorMessage}`, detailsAction);
        if (choice === detailsAction) {
            this.showInfo(errorMessage);
        }
    }
}
