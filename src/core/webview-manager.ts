import * as vscode from 'vscode';
import { getTheme, postWebviewMessage, getWebviewContent } from '../utils/webview-utils';
import { PairCheckManager } from './pair-check-manager';
import { ProblemManager } from './problem-manager';

export class WebViewManager {
    private static instance: WebViewManager;
    private context: vscode.ExtensionContext | undefined;
    private pairCheckManager: PairCheckManager;
    private problemManager: ProblemManager;

    private constructor() {
        this.pairCheckManager = PairCheckManager.getInstance();
        this.problemManager = ProblemManager.getInstance();
    }

    public static getInstance(): WebViewManager {
        if (!WebViewManager.instance) {
            WebViewManager.instance = new WebViewManager();
        }
        return WebViewManager.instance;
    }

    public setContext(context: vscode.ExtensionContext) {
        this.context = context;
        this.pairCheckManager.setContext(context);
        this.problemManager.setContext(context);
    }

    public getPairCheckViewProvider() {
        return {
            resolveWebviewView: (
                webviewView: vscode.WebviewView,
                context: vscode.WebviewViewResolveContext,
                token: vscode.CancellationToken
            ) => {
                if (!this.context) {
                    throw new Error('Context not initialized');
                }
                this.pairCheckManager.resolveWebviewView(webviewView, this.context, context, token);
            }
        };
    }

    public getProblemViewProvider() {
        return this.problemManager.getProblemViewProvider();
    }

    public showSettingsPage() {
        this.createWebviewPanel('oiCodeSettings', 'OI-Code Settings', 'settings.html');
    }

    public showCompletionPage() {
        this.createWebviewPanel('oiCodeCompletion', 'OI-Code Setup Complete', 'completion.html');
    }

    public showWelcomePage() {
        this.createWebviewPanel('oiCodeWelcome', 'Welcome to OI-Code', 'init.html');
    }

    private createWebviewPanel(viewType: string, title: string, htmlFile: string) {
        if (!this.context) {
            throw new Error('Context not initialized');
        }

        const panel = vscode.window.createWebviewPanel(viewType, title, vscode.ViewColumn.One, {
            enableScripts: true,
            retainContextWhenHidden: true
        });

        this.getWebviewContent(htmlFile).then(html => (panel.webview.html = html));

        const themeListener = vscode.window.onDidChangeActiveColorTheme(e => {
            postWebviewMessage(panel, 'set-theme', { theme: getTheme(e.kind) });
        });

        panel.onDidDispose(() => {
            themeListener.dispose();
        });
    }

    private async getWebviewContent(fileName: string): Promise<string> {
        if (!this.context) {
            throw new Error('Context not initialized');
        }
        return getWebviewContent(this.context, fileName);
    }
}
