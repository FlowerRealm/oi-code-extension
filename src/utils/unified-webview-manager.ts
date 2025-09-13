import * as vscode from 'vscode';
import { AdvancedBaseManager } from '../core/advanced-base-manager';
import { WebViewMessage } from '../types';

export interface MessageHandler {
    handle(message: WebViewMessage, panel: vscode.WebviewPanel): Promise<void>;
}

export class UnifiedWebViewManager extends AdvancedBaseManager {
    private static instance: UnifiedWebViewManager;
    private messageHandlers: Map<string, MessageHandler> = new Map();
    private activePanels: Map<string, vscode.WebviewPanel> = new Map();

    private constructor() {
        super();
    }

    public static getInstance(): UnifiedWebViewManager {
        if (!UnifiedWebViewManager.instance) {
            UnifiedWebViewManager.instance = new UnifiedWebViewManager();
        }
        return UnifiedWebViewManager.instance;
    }

    public registerMessageHandler(command: string, handler: MessageHandler): void {
        this.messageHandlers.set(command, handler);
    }

    public createPanel(options: {
        viewType: string;
        title: string;
        htmlContent: string;
        key?: string;
    }): vscode.WebviewPanel {
        const panel = vscode.window.createWebviewPanel(options.viewType, options.title, vscode.ViewColumn.One, {
            enableScripts: true,
            localResourceRoots: [this.getContext().extensionUri]
        });

        panel.webview.html = options.htmlContent;

        const panelKey = options.key || options.viewType;
        this.activePanels.set(panelKey, panel);

        panel.onDidDispose(() => {
            this.activePanels.delete(panelKey);
        });

        panel.webview.onDidReceiveMessage(async (message: WebViewMessage) => {
            await this.handleMessage(message, panel);
        });

        return panel;
    }

    private async handleMessage(message: WebViewMessage, panel: vscode.WebviewPanel): Promise<void> {
        const handler = this.messageHandlers.get(message.command);
        if (handler) {
            try {
                await handler.handle(message, panel);
            } catch (error) {
                this.handleError(error, `Failed to handle message: ${message.command}`);
            }
        }
    }

    public getPanel(key: string): vscode.WebviewPanel | undefined {
        return this.activePanels.get(key);
    }

    public dispose(): void {
        this.activePanels.forEach(panel => panel.dispose());
        this.activePanels.clear();
        this.messageHandlers.clear();
    }
}

export abstract class BaseMessageHandler implements MessageHandler {
    protected webViewManager: UnifiedWebViewManager;

    constructor() {
        this.webViewManager = UnifiedWebViewManager.getInstance();
    }

    abstract handle(message: WebViewMessage, panel: vscode.WebviewPanel): Promise<void>;

    protected postMessage(panel: vscode.WebviewPanel, message: Record<string, any>): void {
        panel.webview.postMessage(message);
    }

    protected showInfo(message: string): void {
        vscode.window.showInformationMessage(message);
    }

    protected showError(message: string): void {
        vscode.window.showErrorMessage(message);
    }
}
