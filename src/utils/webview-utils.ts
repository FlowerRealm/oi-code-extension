import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';

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

export function postWebviewMessage(
    panel: vscode.WebviewPanel | vscode.WebviewView,
    command: string,
    data: Record<string, unknown> = {}
) {
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

/**
 * Load HTML content from file
 */
export async function loadHtmlContent(context: vscode.ExtensionContext, fileName: string): Promise<string> {
    const filePath = path.join(context.extensionPath, 'webview', fileName);
    try {
        const content = await fs.readFile(filePath, 'utf-8');
        return content;
    } catch (error) {
        console.error(`Failed to load HTML file ${fileName}:`, error);
        return `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Error Loading Page</title>
</head>
<body>
    <h1>Error Loading Page</h1>
    <p>Failed to load ${fileName}. Please check the extension logs.</p>
</body>
</html>`;
    }
}

export async function getWebviewContent(context: vscode.ExtensionContext, fileName: string): Promise<string> {
    const filePath = vscode.Uri.file(path.join(context.extensionPath, 'out', fileName));
    try {
        const content = await vscode.workspace.fs.readFile(filePath);
        return content.toString();
    } catch (e) {
        console.error(`Failed to read ${fileName}`, e);
        return `<h1>Error: Could not load page.</h1><p>${e}</p>`;
    }
}
