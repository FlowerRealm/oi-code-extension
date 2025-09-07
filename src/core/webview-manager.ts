import * as vscode from 'vscode';
import * as path from 'path';
import { getTheme, postWebviewMessage } from '../utils/webview-utils';
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
        if (!this.context) {
            throw new Error('Context not initialized');
        }

        const panel = vscode.window.createWebviewPanel('oiCodeSettings', 'OI-Code Settings', vscode.ViewColumn.One, {
            enableScripts: true,
            retainContextWhenHidden: true
        });

        this.getWebviewContent('settings.html').then(html => (panel.webview.html = html));

        const themeListener = vscode.window.onDidChangeActiveColorTheme(e => {
            postWebviewMessage(panel, 'set-theme', { theme: getTheme(e.kind) });
        });

        panel.onDidDispose(() => {
            themeListener.dispose();
        });
    }

    public showCompletionPage() {
        if (!this.context) {
            throw new Error('Context not initialized');
        }

        const panel = vscode.window.createWebviewPanel(
            'oiCodeCompletion',
            'OI-Code Setup Complete',
            vscode.ViewColumn.One,
            { enableScripts: true, retainContextWhenHidden: true }
        );

        this.getWebviewContent('completion.html').then(html => (panel.webview.html = html));

        const themeListener = vscode.window.onDidChangeActiveColorTheme(e => {
            postWebviewMessage(panel, 'set-theme', { theme: getTheme(e.kind) });
        });

        panel.onDidDispose(() => {
            themeListener.dispose();
        });
    }

    public showWelcomePage() {
        if (!this.context) {
            throw new Error('Context not initialized');
        }

        const panel = vscode.window.createWebviewPanel('oiCodeWelcome', 'Welcome to OI-Code', vscode.ViewColumn.One, {
            enableScripts: true,
            retainContextWhenHidden: true
        });

        this.getWebviewContent('init.html').then(html => (panel.webview.html = html));

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

        const filePath = vscode.Uri.file(path.join(this.context.extensionPath, 'out', fileName));
        try {
            const content = await vscode.workspace.fs.readFile(filePath);
            return content.toString();
        } catch (e) {
            console.error(`Failed to read ${fileName}`, e);
            return `<h1>Error: Could not load page.</h1><p>${e}</p>`;
        }
    }
}
