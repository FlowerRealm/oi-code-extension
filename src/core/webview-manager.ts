import * as vscode from 'vscode';
import { EventSystem, EventSystemManager } from './event-system';
import {
    WebViewManager,
    WebViewAPI,
    WebViewMessage,
    WebViewRequest,
    WebViewResponse,
    WebViewState,
    WebViewConfig,
    WebViewTheme,
    WebViewContent,
    WebViewPanelConfig
} from '../types/webview';
import {
    ProblemManagerAPI,
    CompilerManagerAPI,
    TestRunnerAPI,
    PairCheckManagerAPI
} from '../types/models';
import { Disposable } from '../types/models';

/**
 * WebView Manager implementation
 * Manages WebView panels, communication, and content rendering
 */
export class WebViewManagerImpl implements WebViewManager, Disposable {
    private static instance: WebViewManagerImpl;
    private panels: Map<string, vscode.WebviewPanel> = new Map();
    private messageHandlers: Map<string, (message: WebViewMessage) => void> = new Map();
    private disposables: Disposable[] = [];
    private eventSystem: EventSystem;
    private config: WebViewConfig;
    private problemManager: ProblemManagerAPI;
    private compilerManager: CompilerManagerAPI;
    private testRunner: TestRunnerAPI;
    private pairCheckManager: PairCheckManagerAPI;

    private constructor(
        problemManager: ProblemManagerAPI,
        compilerManager: CompilerManagerAPI,
        testRunner: TestRunnerAPI,
        pairCheckManager: PairCheckManagerAPI,
        config: Partial<WebViewConfig> = {}
    ) {
        this.eventSystem = EventSystemManager.getInstance();
        this.problemManager = problemManager;
        this.compilerManager = compilerManager;
        this.testRunner = testRunner;
        this.pairCheckManager = pairCheckManager;
        this.config = this.mergeConfig(config);
    }

    static getInstance(
        problemManager?: ProblemManagerAPI,
        compilerManager?: CompilerManagerAPI,
        testRunner?: TestRunnerAPI,
        pairCheckManager?: PairCheckManagerAPI,
        config?: Partial<WebViewConfig>
    ): WebViewManagerImpl {
        if (!WebViewManagerImpl.instance) {
            if (!problemManager || !compilerManager || !testRunner || !pairCheckManager) {
                throw new Error('All managers are required for first initialization');
            }
            WebViewManagerImpl.instance = new WebViewManagerImpl(
                problemManager,
                compilerManager,
                testRunner,
                pairCheckManager,
                config
            );
        }
        return WebViewManagerImpl.instance;
    }

    private mergeConfig(config: Partial<WebViewConfig>): WebViewConfig {
        return {
            enableScripts: config.enableScripts !== false,
            enableForms: config.enableForms !== false,
            localResourceRoots: config.localResourceRoots || [],
            port: config.port || 3000,
            theme: config.theme || 'system',
            enableAnimations: config.enableAnimations !== false,
            enableDebug: config.enableDebug || false,
            enableCors: config.enableCors !== false,
            enableCompression: config.enableCompression !== false,
            maxMessageSize: config.maxMessageSize || 1024 * 1024, // 1MB
            timeout: config.timeout || 30000,
            enableMetrics: config.enableMetrics !== false
        };
    }

    /**
     * Create a new WebView panel
     */
    async createWebViewPanel(config: WebViewPanelConfig): Promise<vscode.WebviewPanel> {
        const panel = vscode.window.createWebviewPanel(
            config.id,
            config.title,
            config.viewColumn || vscode.ViewColumn.One,
            {
                enableScripts: this.config.enableScripts,
                localResourceRoots: this.config.localResourceRoots,
                retainContextWhenHidden: config.retainContextWhenHidden || false,
                enableFindWidget: config.enableFindWidget || true
            }
        );

        // Set up message handler
        panel.webview.onDidReceiveMessage(
            message => this.handleWebViewMessage(config.id, message),
            undefined,
            this.disposables
        );

        // Handle panel disposal
        panel.onDidDispose(() => {
            this.panels.delete(config.id);
            this.messageHandlers.delete(config.id);
        }, undefined, this.disposables);

        // Store panel
        this.panels.set(config.id, panel);

        // Set initial content
        if (config.content) {
            panel.webview.html = await this.generateWebViewContent(config.id, config.content);
        }

        return panel;
    }

    /**
     * Get a WebView panel by ID
     */
    getWebViewPanel(id: string): vscode.WebviewPanel | undefined {
        return this.panels.get(id);
    }

    /**
     * Show a WebView panel
     */
    async showWebViewPanel(id: string, viewColumn?: vscode.ViewColumn): Promise<void> {
        const panel = this.panels.get(id);
        if (!panel) {
            throw new Error(`WebView panel not found: ${id}`);
        }

        panel.reveal(viewColumn);
    }

    /**
     * Hide a WebView panel
     */
    async hideWebViewPanel(id: string): Promise<void> {
        const panel = this.panels.get(id);
        if (!panel) {
            throw new Error(`WebView panel not found: ${id}`);
        }

        panel.reveal(vscode.ViewColumn.Beside);
    }

    /**
     * Close a WebView panel
     */
    async closeWebViewPanel(id: string): Promise<void> {
        const panel = this.panels.get(id);
        if (!panel) {
            throw new Error(`WebView panel not found: ${id}`);
        }

        panel.dispose();
    }

    /**
     * List all active WebView panels
     */
    listWebViewPanels(): string[] {
        return Array.from(this.panels.keys());
    }

    /**
     * Send message to WebView
     */
    async postMessageToWebView(id: string, message: WebViewMessage): Promise<boolean> {
        const panel = this.panels.get(id);
        if (!panel) {
            return false;
        }

        return panel.webview.postMessage(message);
    }

    /**
     * Register message handler for WebView
     */
    registerWebViewMessageHandler(id: string, handler: (message: WebViewMessage) => void): void {
        this.messageHandlers.set(id, handler);
    }

    /**
     * Unregister message handler for WebView
     */
    unregisterWebViewMessageHandler(id: string): void {
        this.messageHandlers.delete(id);
    }

    /**
     * Get WebView state
     */
    async getWebViewState(id: string): Promise<WebViewState | undefined> {
        const panel = this.panels.get(id);
        if (!panel) {
            return undefined;
        }

        return {
            id,
            activePanel: null,
            panels: {},
            lastMessageTime: Date.now(),
            settings: {
                theme: 'dark',
                fontSize: 14,
                wordWrap: true
            }
        };
    }

    /**
     * Update WebView content
     */
    async updateWebViewContent(id: string, content: WebViewContent): Promise<void> {
        const panel = this.panels.get(id);
        if (!panel) {
            throw new Error(`WebView panel not found: ${id}`);
        }

        panel.webview.html = await this.generateWebViewContent(id, content);
    }

    /**
     * Get WebView theme
     */
    async getWebViewTheme(): Promise<WebViewTheme> {
        const colorTheme = vscode.window.activeColorTheme;
        return {
            type: colorTheme.kind === vscode.ColorThemeKind.Light ? 'light' : 'dark',
            colors: {
                background: this.getThemeColor(colorTheme.kind, 'background'),
                foreground: this.getThemeColor(colorTheme.kind, 'foreground'),
                primary: this.getThemeColor(colorTheme.kind, 'primary'),
                secondary: this.getThemeColor(colorTheme.kind, 'secondary'),
                accent: this.getThemeColor(colorTheme.kind, 'accent'),
                border: this.getThemeColor(colorTheme.kind, 'border'),
                error: this.getThemeColor(colorTheme.kind, 'error'),
                warning: this.getThemeColor(colorTheme.kind, 'warning'),
                success: this.getThemeColor(colorTheme.kind, 'success')
            }
        };
    }

    /**
     * Generate WebView content with theme support
     */
    async generateWebViewContent(id: string, content: WebViewContent): Promise<string> {
        const theme = await this.getWebViewTheme();
        const cspSource = this.panels.get(id)?.webview.cspSource || '';

        return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy"
          content="default-src 'none'; style-src ${cspSource}; script-src ${cspSource};">
    <title>${content.title || 'OI-Code WebView'}</title>
    <style>
        :root {
            --background-color: ${theme.colors.background};
            --foreground-color: ${theme.colors.foreground};
            --primary-color: ${theme.colors.primary};
            --secondary-color: ${theme.colors.secondary};
            --accent-color: ${theme.colors.accent};
            --border-color: ${theme.colors.border};
            --error-color: ${theme.colors.error};
            --warning-color: ${theme.colors.warning};
            --success-color: ${theme.colors.success};
        }

        body {
            background-color: var(--background-color);
            color: var(--foreground-color);
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            margin: 0;
            padding: 20px;
            line-height: 1.6;
        }

        .container {
            max-width: 1200px;
            margin: 0 auto;
        }

        .header {
            border-bottom: 1px solid var(--border-color);
            padding-bottom: 20px;
            margin-bottom: 20px;
        }

        .content {
            margin-bottom: 20px;
        }

        .status {
            padding: 10px;
            border-radius: 4px;
            margin-bottom: 10px;
        }

        .status.success {
            background-color: var(--success-color);
            color: white;
        }

        .status.error {
            background-color: var(--error-color);
            color: white;
        }

        .status.warning {
            background-color: var(--warning-color);
            color: white;
        }

        .btn {
            background-color: var(--primary-color);
            color: white;
            border: none;
            padding: 10px 20px;
            border-radius: 4px;
            cursor: pointer;
            margin-right: 10px;
        }

        .btn:hover {
            opacity: 0.8;
        }

        .btn.secondary {
            background-color: var(--secondary-color);
        }

        .form-group {
            margin-bottom: 15px;
        }

        .form-group label {
            display: block;
            margin-bottom: 5px;
            font-weight: bold;
        }

        .form-group input,
        .form-group textarea,
        .form-group select {
            width: 100%;
            padding: 8px;
            border: 1px solid var(--border-color);
            border-radius: 4px;
            background-color: var(--background-color);
            color: var(--foreground-color);
        }

        .table {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 20px;
        }

        .table th,
        .table td {
            padding: 12px;
            text-align: left;
            border-bottom: 1px solid var(--border-color);
        }

        .table th {
            background-color: var(--secondary-color);
            font-weight: bold;
        }

        .loading {
            text-align: center;
            padding: 20px;
        }

        .spinner {
            border: 4px solid var(--border-color);
            border-top: 4px solid var(--primary-color);
            border-radius: 50%;
            width: 40px;
            height: 40px;
            animation: spin 1s linear infinite;
            margin: 0 auto;
        }

        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }

        .diff-container {
            font-family: 'Courier New', monospace;
            white-space: pre-wrap;
            background-color: var(--background-color);
            border: 1px solid var(--border-color);
            border-radius: 4px;
            padding: 10px;
            margin-bottom: 10px;
        }

        .diff-added {
            background-color: rgba(0, 255, 0, 0.1);
        }

        .diff-removed {
            background-color: rgba(255, 0, 0, 0.1);
        }

        .diff-changed {
            background-color: rgba(255, 255, 0, 0.1);
        }

        ${content.styles || ''}
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>${content.title || 'OI-Code WebView'}</h1>
            <p>${content.subtitle || ''}</p>
        </div>
        
        <div class="content">
            ${content.html || ''}
        </div>
        
        <div id="status-container"></div>
        <div id="loading-container"></div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();

        // Communication with VS Code extension
        function postMessage(type, data) {
            vscode.postMessage({ type, data });
        }

        // Handle messages from VS Code extension
        window.addEventListener('message', event => {
            const message = event.data;
            
            switch (message.type) {
                case 'updateContent':
                    updateContent(message.data);
                    break;
                case 'showStatus':
                    showStatus(message.data);
                    break;
                case 'showLoading':
                    showLoading(message.data.show, message.data.message);
                    break;
                case 'showError':
                    showError(message.data);
                    break;
                case 'showSuccess':
                    showSuccess(message.data);
                    break;
                default:
                    console.log('Unknown message type:', message.type);
            }
        });

        function updateContent(data) {
            if (data.html) {
                document.querySelector('.content').innerHTML = data.html;
            }
            if (data.title) {
                document.querySelector('.header h1').textContent = data.title;
            }
        }

        function showStatus(data) {
            const container = document.getElementById('status-container');
            const statusDiv = document.createElement('div');
            statusDiv.className = \`status \${data.type}\`;
            statusDiv.textContent = data.message;
            container.appendChild(statusDiv);
            
            // Auto-remove after 5 seconds
            setTimeout(() => {
                statusDiv.remove();
            }, 5000);
        }

        function showLoading(show, message = 'Loading...') {
            const container = document.getElementById('loading-container');
            if (show) {
                container.innerHTML = \`
                    <div class="loading">
                        <div class="spinner"></div>
                        <p>\${message}</p>
                    </div>
                \`;
            } else {
                container.innerHTML = '';
            }
        }

        function showError(message) {
            showStatus({ type: 'error', message });
        }

        function showSuccess(message) {
            showStatus({ type: 'success', message });
        }

        // Form handling
        function submitForm(formId, data) {
            postMessage('formSubmit', { formId, data });
        }

        // Button actions
        function buttonClick(action, data) {
            postMessage('buttonClick', { action, data });
        }

        // Initialize
        document.addEventListener('DOMContentLoaded', () => {
            postMessage('ready', {});
        });

        ${content.scripts || ''}
    </script>
</body>
</html>
    `;
    }

    /**
     * Handle WebView messages
     */
    private async handleWebViewMessage(panelId: string, message: WebViewMessage): Promise<void> {
        // Create a generic extension event for WebView messages
        const extensionEvent: any = {
            type: 'webview-message' as any,
            source: 'webview-manager',
            timestamp: Date.now(),
            data: {
                viewType: panelId,
                message
            }
        };
        await this.eventSystem.emit(extensionEvent);

        // Call registered handler
        const handler = this.messageHandlers.get(panelId);
        if (handler) {
            handler(message);
        }

        // Handle common message types
        switch (message.type) {
            case 'ready':
                await this.handleWebViewReady(panelId);
                break;
            case 'formSubmit':
                await this.handleFormSubmit(panelId, message.data);
                break;
            case 'buttonClick':
                await this.handleButtonClick(panelId, message.data);
                break;
            case 'request':
                await this.handleWebViewRequest(panelId, message.data);
                break;
            default:
                // Unknown message type, log for debugging
                if (this.config.enableDebug) {
                    console.log(`Unknown WebView message type: ${message.type}`);
                }
        }
    }

    /**
     * Handle WebView ready event
     */
    private async handleWebViewReady(panelId: string): Promise<void> {
        const theme = await this.getWebViewTheme();
        await this.postMessageToWebView(panelId, {
            type: 'theme',
            action: 'update',
            data: theme
        });
    }

    /**
     * Handle form submission
     */
    private async handleFormSubmit(panelId: string, data: any): Promise<void> {
        // This is a placeholder for form handling
        // In a real implementation, this would:
        // 1. Validate form data
        // 2. Call appropriate API methods
        // 3. Send response back to WebView
        console.log('Form submitted:', data);
    }

    /**
     * Handle button click
     */
    private async handleButtonClick(panelId: string, data: any): Promise<void> {
        // This is a placeholder for button handling
        // In a real implementation, this would:
        // 1. Determine action from button ID
        // 2. Call appropriate API methods
        // 3. Update WebView state
        console.log('Button clicked:', data);
    }

    /**
     * Handle WebView request
     */
    private async handleWebViewRequest(panelId: string, data: WebViewRequest): Promise<void> {
        try {
            const response = await this.processWebViewRequest(data);
            await this.postMessageToWebView(panelId, {
                type: 'response',
                action: 'notify',
                data: response
            });
        } catch (error) {
            await this.postMessageToWebView(panelId, {
                type: 'error',
                action: 'notify',
                data: {
                    requestId: data.requestId,
                    error: error instanceof Error ? error.message : String(error)
                }
            });
        }
    }

    /**
     * Process WebView request
     */
    private async processWebViewRequest(request: WebViewRequest): Promise<WebViewResponse> {
        switch (request.action) {
            case 'getProblem': {
                const problem = await this.problemManager.getProblem(request.data.problemId);
                return {
                    requestId: request.requestId,
                    success: true,
                    data: problem,
                    timestamp: Date.now()
                };
            }

            case 'listProblems': {
                const problems = await this.problemManager.listProblems(request.data.options);
                return {
                    requestId: request.requestId,
                    success: true,
                    data: problems,
                    timestamp: Date.now()
                };
            }

            case 'detectCompilers': {
                const compilers = await this.compilerManager.detectCompilers();
                return {
                    requestId: request.requestId,
                    success: true,
                    data: compilers,
                    timestamp: Date.now()
                };
            }

            case 'executeTest': {
                const testResult = await this.testRunner.executeTest(request.data.options);
                return {
                    requestId: request.requestId,
                    success: true,
                    data: testResult,
                    timestamp: Date.now()
                };
            }

            case 'executePairCheck': {
                const pairCheckResult = await this.pairCheckManager.executePairCheck(request.data.options);
                return {
                    requestId: request.requestId,
                    success: true,
                    data: pairCheckResult,
                    timestamp: Date.now()
                };
            }

            default:
                throw new Error(`Unknown request action: ${request.action}`);
        }
    }

    /**
     * Get theme color
     */
    private getThemeColor(theme: vscode.ColorThemeKind, colorType: string): string {
        // This is a placeholder for theme color extraction
        // In a real implementation, this would:
        // 1. Extract colors from VS Code theme
        // 2. Return appropriate color values
        switch (colorType) {
            case 'background':
                return theme === vscode.ColorThemeKind.Light ? '#ffffff' : '#1e1e1e';
            case 'foreground':
                return theme === vscode.ColorThemeKind.Light ? '#333333' : '#cccccc';
            case 'primary':
                return '#007acc';
            case 'secondary':
                return '#6c757d';
            case 'accent':
                return '#28a745';
            case 'border':
                return theme === vscode.ColorThemeKind.Light ? '#e0e0e0' : '#333333';
            case 'error':
                return '#dc3545';
            case 'warning':
                return '#ffc107';
            case 'success':
                return '#28a745';
            default:
                return '#000000';
        }
    }

    /**
     * Get WebView content
     */
    private getWebViewContent(type: string): string {
        // Basic implementation - would need to be enhanced with actual HTML content
        return `<html><body><h1>${type} View</h1></body></html>`;
    }

    /**
     * Setup WebView message handlers
     */
    private setupWebViewMessageHandlers(webview: vscode.Webview, type: string): void {
        // Setup message handlers for the webview
        webview.onDidReceiveMessage(message => {
            this.handleMessage(type, message);
        });
    }

    /**
     * Register WebView provider
     */
    registerProvider(): vscode.Disposable {
        // Implementation would register the provider
        const disposable = {
            dispose: () => {
                // Clean up provider registration
            }
        };
        this.disposables.push(disposable);
        return disposable;
    }

    /**
     * Show WebView by type
     */
    showWebView(type: string): void {
        this.showWebViewPanel(type);
    }

    /**
     * Hide WebView by type
     */
    hideWebView(type: string): void {
        this.hideWebViewPanel(type);
    }

    /**
     * Get WebView by type
     */
    getWebView<T extends WebViewAPI>(type: string): T | undefined {
        const panel = this.panels.get(type);
        if (panel) {
            // Return a wrapper that implements WebViewAPI
            return {
                postMessage: (message: WebViewMessage) => {
                    panel.webview.postMessage(message);
                },
                onMessage: (callback: (message: WebViewMessage) => void) => {
                    const disposable = panel.webview.onDidReceiveMessage(callback);
                    this.disposables.push(disposable);
                    return disposable;
                },
                updateContent: (content: string) => {
                    panel.webview.html = content;
                },
                show: () => {
                    panel.reveal();
                },
                hide: () => {
                    // WebviewPanel doesn't have hide method, but we can implement similar behavior
                    panel.reveal(vscode.ViewColumn.Beside);
                },
                focus: () => {
                    panel.reveal(vscode.ViewColumn.Active);
                },
                refresh: () => {
                    // Implementation would refresh the content
                },
                getPanel: () => panel,
                isVisible: () => panel.visible
            } as T;
        }
        return undefined;
    }

    /**
     * Send message to WebView
     */
    postMessage(type: string, message: WebViewMessage): void {
        this.postMessageToWebView(type, message);
    }

    /**
     * Broadcast message to all WebViews
     */
    broadcast(message: WebViewMessage): void {
        for (const [, panel] of this.panels) {
            panel.webview.postMessage(message);
        }
    }

    /**
     * Handle WebView message
     */
    async handleMessage(type: string, message: WebViewMessage): Promise<void> {
        await this.handleWebViewMessage(type, message);
    }

    /**
     * Get problem view provider
     */
    getProblemViewProvider(): vscode.WebviewViewProvider {
        return {
            resolveWebviewView: (webviewView: vscode.WebviewView) => {
                webviewView.webview.html = this.getWebViewContent('problem');
                this.setupWebViewMessageHandlers(webviewView.webview, 'problem');
            }
        };
    }

    /**
     * Get pair check view provider
     */
    getPairCheckViewProvider(): vscode.WebviewViewProvider {
        return {
            resolveWebviewView: (webviewView: vscode.WebviewView) => {
                webviewView.webview.html = this.getWebViewContent('paircheck');
                this.setupWebViewMessageHandlers(webviewView.webview, 'paircheck');
            }
        };
    }

    /**
     * Show settings page
     */
    showSettingsPage(): void {
        this.showWebViewPanel('settings');
    }

    /**
     * Show completion page
     */
    showCompletionPage(): void {
        this.showWebViewPanel('completion');
    }

    /**
     * Show welcome page
     */
    showWelcomePage(): void {
        this.showWebViewPanel('welcome');
    }

    /**
     * Dispose of resources
     */
    dispose(): void {
        this.disposables.forEach(disposable => disposable.dispose());
        this.disposables = [];
        this.panels.forEach(panel => panel.dispose());
        this.panels.clear();
        this.messageHandlers.clear();
    }
}

// Re-export for backward compatibility
export { WebViewManagerImpl as WebViewManager };
