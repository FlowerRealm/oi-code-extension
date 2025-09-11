import * as vscode from 'vscode';

/**
 * 统一的工具函数集合
 */
export class UnifiedUtils {
    /**
     * HTML转义函数
     */
    static htmlEscape(text: string): string {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    /**
     * 显示信息消息
     */
    static showInfo(message: string, options?: vscode.MessageOptions): Thenable<string | undefined> {
        return vscode.window.showInformationMessage(message, options || {});
    }

    /**
     * 显示错误消息
     */
    static showError(message: string, options?: vscode.MessageOptions): Thenable<string | undefined> {
        return vscode.window.showErrorMessage(message, options || {});
    }

    /**
     * 显示警告消息
     */
    static showWarning(message: string, options?: vscode.MessageOptions): Thenable<string | undefined> {
        return vscode.window.showWarningMessage(message, options || {});
    }

    /**
     * 统一错误处理
     */
    static handleError(error: unknown, context: string = 'Operation'): void {
        this.showError(`${context} failed: ${error instanceof Error ? error.message : String(error)}`);
        console.error(`[${context}] Error:`, error);
    }

    /**
     * 安全执行函数
     */
    static async safeExecute<T>(
        fn: () => Promise<T>,
        _errorMessage: string = 'Operation failed',
        context: string = 'Operation'
    ): Promise<T | undefined> {
        try {
            return await fn();
        } catch (error) {
            this.handleError(error, context);
            return undefined;
        }
    }

    /**
     * 显示确认对话框
     */
    static async showConfirmation(message: string, modal: boolean = false): Promise<boolean> {
        const result = await vscode.window.showWarningMessage(message, { modal }, '是', '否');
        return result === '是';
    }

    /**
     * 显示输入框
     */
    static showInputBox(options: vscode.InputBoxOptions): Thenable<string | undefined> {
        return vscode.window.showInputBox(options);
    }

    /**
     * 显示快速选择框
     */
    static showQuickPick<T extends vscode.QuickPickItem>(
        items: T[],
        options: vscode.QuickPickOptions
    ): Thenable<T | undefined> {
        return vscode.window.showQuickPick(items, options);
    }

    /**
     * 显示文件选择对话框
     */
    static showOpenDialog(options: vscode.OpenDialogOptions): Thenable<vscode.Uri[] | undefined> {
        return vscode.window.showOpenDialog(options);
    }

    /**
     * 处理错误并显示详细信息
     */
    static async showErrorWithDetails(
        error: unknown,
        message: string,
        detailsAction: string = '查看详情'
    ): Promise<void> {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const choice = await vscode.window.showErrorMessage(`${message}: ${errorMessage}`, detailsAction);
        if (choice === detailsAction) {
            this.showInfo(errorMessage);
        }
    }

    /**
     * 规范化输出（用于OI风格比较）
     */
    static normalizeOutput(output: string): string {
        return output.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
    }

    /**
     * 延迟执行
     */
    static delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * 重试函数
     */
    static async retry<T>(fn: () => Promise<T>, maxAttempts: number = 3, delayMs: number = 1000): Promise<T> {
        let lastError: Error;

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                return await fn();
            } catch (error) {
                lastError = error instanceof Error ? error : new Error(String(error));
                if (attempt < maxAttempts) {
                    await this.delay(delayMs);
                }
            }
        }

        throw lastError!;
    }

    /**
     * 创建进度报告
     */
    static async withProgress<T>(
        options: { title: string; cancellable?: boolean },
        task: (progress: vscode.Progress<{ message?: string; increment?: number }>) => Promise<T>
    ): Promise<T> {
        return vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: options.title,
                cancellable: options.cancellable ?? false
            },
            task
        );
    }

    /**
     * 安全的JSON解析
     */
    static safeJsonParse<T>(text: string, defaultValue: T): T {
        try {
            return JSON.parse(text) as T;
        } catch {
            return defaultValue;
        }
    }

    /**
     * 检查路径是否存在
     */
    static async pathExists(path: string): Promise<boolean> {
        try {
            await vscode.workspace.fs.readFile(vscode.Uri.file(path));
            return true;
        } catch {
            return false;
        }
    }

    /**
     * 读取文件内容
     */
    static async readFile(path: string): Promise<string> {
        const uri = vscode.Uri.file(path);
        const content = await vscode.workspace.fs.readFile(uri);
        return Buffer.from(content).toString('utf8');
    }

    /**
     * 写入文件内容
     */
    static async writeFile(path: string, content: string): Promise<void> {
        const uri = vscode.Uri.file(path);
        await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf8'));
    }

    /**
     * 创建目录
     */
    static async createDirectory(path: string): Promise<void> {
        const uri = vscode.Uri.file(path);
        await vscode.workspace.fs.createDirectory(uri);
    }

    /**
     * 删除文件或目录
     */
    static async delete(path: string, recursive?: boolean): Promise<void> {
        const uri = vscode.Uri.file(path);
        await vscode.workspace.fs.delete(uri, { recursive });
    }
}
