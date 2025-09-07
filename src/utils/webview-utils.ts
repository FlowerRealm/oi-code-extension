import * as vscode from 'vscode';

export function htmlEscape(str: string): string {
    return str.replace(/[&<>"'/]/g, match => {
        const escape: { [key: string]: string } = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;',
            '/': '&#x2F;'
        };
        return escape[match];
    });
}

export function postWebviewMessage(panel: vscode.WebviewPanel, command: string, data: any = {}) {
    try {
        panel.webview.postMessage({ command, ...data });
    } catch (e) {
        console.error(`Failed to post message '${command}' to webview:`, e);
    }
}

export function getTheme(kind: vscode.ColorThemeKind): string {
    return kind === vscode.ColorThemeKind.Dark || kind === vscode.ColorThemeKind.HighContrast ? 'dark' : 'light';
}

export function getLanguageIdFromEditor(editor: vscode.TextEditor): 'c' | 'cpp' {
    const langId = editor.document.languageId;
    if (langId === 'c' || langId === 'cpp') {
        return langId;
    }
    throw new Error(`Unsupported language: ${langId}`);
}

export function toSafeName(input: string): string {
    const s = input || 'unnamed';
    return s.replace(/[^\w-.]+/g, '_').slice(0, 64);
}

export function normalizeOutput(output: string): string {
    return output.replace(/\r\n/g, '\n').trimEnd();
}
