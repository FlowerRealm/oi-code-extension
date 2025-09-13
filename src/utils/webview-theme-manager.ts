import * as vscode from 'vscode';

export class WebViewThemeManager {
    private static instance: WebViewThemeManager;

    private constructor() {}

    public static getInstance(): WebViewThemeManager {
        if (!WebViewThemeManager.instance) {
            WebViewThemeManager.instance = new WebViewThemeManager();
        }
        return WebViewThemeManager.instance;
    }

    public getCurrentTheme(): 'light' | 'dark' {
        const config = vscode.workspace.getConfiguration();
        const theme = config.get<string>('workbench.colorTheme');

        if (theme && theme.toLowerCase().includes('dark')) {
            return 'dark';
        }
        return 'light';
    }

    public applyThemeToHtml(html: string): string {
        const theme = this.getCurrentTheme();
        return html.replace('data-theme="light"', `data-theme="${theme}"`);
    }

    public getThemeStyles(): string {
        const theme = this.getCurrentTheme();

        if (theme === 'dark') {
            return `
                :root {
                    --background-primary: #1a1a1a;
                    --background-secondary: #2d2d2d;
                    --background-tertiary: #404040;
                    --text-primary: #e4e4e4;
                    --text-secondary: #b0b0b0;
                    --text-muted: #808080;
                    --border-color: #404040;
                    --accent-color: #4d9fff;
                    --accent-hover: #6bb1ff;
                    --success-color: #34ce57;
                    --success-hover: #2fb94e;
                }
            `;
        } else {
            return `
                :root {
                    --background-primary: #ffffff;
                    --background-secondary: #f8f9fa;
                    --background-tertiary: #e9ecef;
                    --text-primary: #212529;
                    --text-secondary: #6c757d;
                    --text-muted: #adb5bd;
                    --border-color: #dee2e6;
                    --accent-color: #0066cc;
                    --accent-hover: #0052a3;
                    --success-color: #28a745;
                    --success-hover: #218838;
                }
            `;
        }
    }

    public setupThemeHandling(webview: vscode.Webview): void {
        const theme = this.getCurrentTheme();
        webview.postMessage({ command: 'set-theme', theme });
    }
}
