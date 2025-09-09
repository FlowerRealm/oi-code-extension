import * as vscode from 'vscode';
import { getTheme, postWebviewMessage } from '../utils/webview-utils';
import { PairCheckManager } from './pair-check-manager';
import { ProblemManager } from './problem-manager';
import { BaseManager } from './base-manager';
import { UnifiedWebViewManager } from '../utils/unified-webview-manager';
import { UnifiedConfigManager } from '../utils/unified-config-manager';
import { WebViewThemeManager } from '../utils/webview-theme-manager';
import { UnifiedUtils } from '../utils/unified-utils';
import { NativeCompilerManager } from '../native/manager/nativeCompilerManager';
import { CompilerInfo } from '../types/types';

export class WebViewManager extends BaseManager {
    private static instance: WebViewManager;
    private webviewManager: UnifiedWebViewManager;
    private configManager: UnifiedConfigManager;
    private themeManager: WebViewThemeManager;
    private pairCheckManager!: PairCheckManager;
    private problemManager!: ProblemManager;

    private constructor() {
        super();
        this.webviewManager = UnifiedWebViewManager.getInstance();
        this.configManager = UnifiedConfigManager.getInstance();
        this.themeManager = WebViewThemeManager.getInstance();
        this.initializeDependencies();
    }

    public static getInstance(): WebViewManager {
        if (!WebViewManager.instance) {
            WebViewManager.instance = new WebViewManager();
        }
        return WebViewManager.instance;
    }

    private initializeDependencies(): void {
        this.pairCheckManager = PairCheckManager.getInstance();
        this.problemManager = ProblemManager.getInstance();
    }

    public setContext(context: vscode.ExtensionContext) {
        super.setContext(context);
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

    public async showSettingsPage() {
        if (!this.context) {
            throw new Error('Context not initialized');
        }

        this.webviewManager.setContext(this.context);
        const panel = this.webviewManager.createPanel({
            viewType: 'oiCodeSettings',
            title: 'OI-Code Settings',
            htmlContent: await this.getSettingsHtmlContent(),
            key: 'settings'
        });

        // 注册消息处理器
        panel.webview.onDidReceiveMessage(async (message: Record<string, unknown>) => {
            await this.handleWebviewMessage(message, panel);
        });
    }

    public async showCompletionPage() {
        if (!this.context) {
            throw new Error('Context not initialized');
        }

        this.webviewManager.setContext(this.context);
        const panel = this.webviewManager.createPanel({
            viewType: 'oiCodeCompletion',
            title: 'OI-Code Setup Complete',
            htmlContent: await this.getCompletionHtmlContent(),
            key: 'completion'
        });

        // 注册消息处理器
        panel.webview.onDidReceiveMessage(async (message: Record<string, unknown>) => {
            await this.handleWebviewMessage(message, panel);
        });
    }

    public async showWelcomePage() {
        if (!this.context) {
            throw new Error('Context not initialized');
        }

        this.webviewManager.setContext(this.context);
        const panel = this.webviewManager.createPanel({
            viewType: 'oiCodeWelcome',
            title: 'Welcome to OI-Code',
            htmlContent: await this.getWelcomeHtmlContent(),
            key: 'welcome'
        });

        // 注册消息处理器
        panel.webview.onDidReceiveMessage(async (message: Record<string, unknown>) => {
            await this.handleWebviewMessage(message, panel);
        });
    }

    private async getSettingsHtmlContent(): Promise<string> {
        if (!this.context) {
            throw new Error('Context not initialized');
        }

        const htmlPath = vscode.Uri.joinPath(this.context.extensionUri, 'webview', 'settings.html');
        const htmlContent = await vscode.workspace.fs.readFile(htmlPath);
        return htmlContent.toString();
    }

    private async getCompletionHtmlContent(): Promise<string> {
        if (!this.context) {
            throw new Error('Context not initialized');
        }

        const htmlPath = vscode.Uri.joinPath(this.context.extensionUri, 'webview', 'completion.html');
        const htmlContent = await vscode.workspace.fs.readFile(htmlPath);
        return htmlContent.toString();
    }

    private async getWelcomeHtmlContent(): Promise<string> {
        if (!this.context) {
            throw new Error('Context not initialized');
        }

        const htmlPath = vscode.Uri.joinPath(this.context.extensionUri, 'webview', 'init.html');
        const htmlContent = await vscode.workspace.fs.readFile(htmlPath);
        return htmlContent.toString();
    }

    private async handleWebviewMessage(message: Record<string, unknown>, panel: vscode.WebviewPanel): Promise<void> {
        const command = message.command as string;

        try {
            switch (command) {
                case 'get-theme': {
                    const currentTheme = getTheme(vscode.window.activeColorTheme.kind);
                    postWebviewMessage(panel, 'set-theme', { theme: currentTheme });
                    break;
                }

                case 'getSettings': {
                    const settingsData = await this.loadSettingsData();
                    postWebviewMessage(panel, 'loadSettings', { data: settingsData });
                    break;
                }

                case 'saveSetting': {
                    const settingId = message.id as string;
                    if (settingId) {
                        await this.saveSetting(settingId, message.value);
                    }
                    break;
                }

                case 'executeApi': {
                    const apiCommand = message.id as string;
                    if (apiCommand) {
                        await vscode.commands.executeCommand(apiCommand);
                    }
                    break;
                }

                case 'select-theme':
                    await vscode.commands.executeCommand('workbench.action.selectTheme');
                    break;

                case 'select-folder': {
                    const folderUri = await UnifiedUtils.showOpenDialog({
                        canSelectFolders: true,
                        canSelectMany: false,
                        title: '选择工作区文件夹'
                    });
                    if (folderUri && folderUri[0]) {
                        postWebviewMessage(panel, 'workspace-selected', {
                            path: folderUri[0].fsPath
                        });
                    }
                    break;
                }

                case 'configure-languages': {
                    const languages = (message.languages as string[]) || [];
                    if (languages.length > 0) {
                        // 不再直接调用setup命令，而是等待用户在编译器检查步骤中确认
                        setTimeout(() => {
                            postWebviewMessage(panel, 'go-to-step', { step: 2 });
                        }, 2000);
                    }
                    break;
                }

                case 'check-compilers': {
                    const languages = (message.languages as string[]) || [];
                    if (languages.length > 0 && this.context) {
                        await this.checkCompilers(panel, languages);
                    }
                    break;
                }

                case 'install-compiler': {
                    const type = message.type as string;
                    const languages = (message.languages as string[]) || [];
                    if (languages.length > 0) {
                        await this.installCompiler(panel, type, languages);
                    }
                    break;
                }

                case 'skip-compiler-install':
                    console.log('跳过编译器安装...');
                    setTimeout(() => {
                        panel.dispose();
                        UnifiedUtils.showInfo('已跳过编译器安装，您可以在稍后通过命令面板重新配置');
                    }, 1000);
                    break;

                case 'initialize': {
                    console.log('初始化环境...');
                    const settings = message.settings as {
                        languages?: string[];
                        compilers?: Record<string, number>;
                        workspace?: string;
                        theme?: string;
                    };
                    await this.saveInitializationSettings(settings);
                    setTimeout(() => {
                        panel.dispose();
                        UnifiedUtils.showInfo('环境初始化完成！');
                    }, 2000);
                    break;
                }

                case 'close':
                    panel.dispose();
                    break;

                case 'continue-config':
                    panel.dispose();
                    await vscode.commands.executeCommand('oi-code.showSettingsPage');
                    break;
            }
        } catch (error) {
            UnifiedUtils.showError(
                `WebView message handling failed: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }

    private async saveInitializationSettings(settings: {
        languages?: string[];
        compilers?: Record<string, number>;
        workspace?: string;
        theme?: string;
    }): Promise<void> {
        if (!this.context) {
            throw new Error('Context not initialized');
        }

        try {
            const config = vscode.workspace.getConfiguration();

            // 保存编译器设置 - 映射到实际的配置项
            if (settings.compilers && typeof settings.compilers === 'object') {
                if (settings.compilers.c !== undefined) {
                    await config.update(
                        'oicode.language.c.command',
                        settings.compilers.c,
                        vscode.ConfigurationTarget.Global
                    );
                }
                if (settings.compilers.cpp !== undefined) {
                    await config.update(
                        'oicode.language.cpp.command',
                        settings.compilers.cpp,
                        vscode.ConfigurationTarget.Global
                    );
                }
            }

            // 保存工作区设置 - 暂时跳过，因为没有对应的配置项
            if (settings.workspace && settings.workspace !== '尚未选择工作区') {
                console.log('工作区设置:', settings.workspace);
                // 注意：这里没有对应的配置项，暂时跳过
            }

            // 保存主题设置 - 暂时跳过，因为没有对应的配置项
            if (settings.theme) {
                console.log('主题设置:', settings.theme);
                // 注意：这里没有对应的配置项，暂时跳过
            }

            // 语言设置暂时跳过，因为没有对应的配置项
            if (settings.languages && Array.isArray(settings.languages)) {
                console.log('语言设置:', settings.languages);
                // 注意：这里没有对应的配置项，暂时跳过
            }

            console.log('初始化设置已保存到 settings.json:', settings);
            UnifiedUtils.showInfo('环境初始化完成！设置已保存。');
        } catch (error) {
            console.error('保存初始化设置失败:', error);
            UnifiedUtils.showError(`保存初始化设置失败: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private async loadSettingsData(): Promise<Record<string, unknown[]>> {
        if (!this.context) {
            throw new Error('Context not initialized');
        }

        try {
            const schemaPath = vscode.Uri.joinPath(this.context.extensionUri, 'webview', 'settings-schema.json');
            const schemaContent = await vscode.workspace.fs.readFile(schemaPath);
            const schema = JSON.parse(schemaContent.toString());

            const settingsData: Record<string, unknown[]> = {};
            const config = vscode.workspace.getConfiguration();

            for (const category of Object.keys(schema)) {
                const settings = await Promise.all(
                    schema[category].map(async (setting: Record<string, unknown>) => {
                        let value = setting.value; // 默认值

                        if (setting.vscode_setting_id) {
                            const configValue = config.get(setting.vscode_setting_id as string);

                            // 如果配置项在 VS Code settings.json 中存在，使用实际值
                            // 如果不存在，使用默认值（schema 中的 value）
                            if (configValue !== undefined) {
                                value = configValue;
                            }

                            // 对于不存在的配置项，如果还没有在 VS Code 中设置，则初始化
                            if (configValue === undefined && setting.vscode_setting_id) {
                                // 检查是否是 VS Code 的内置设置（如 editor.formatOnSave）
                                if (setting.vscode_setting_id.toString().startsWith('editor.')) {
                                    // VS Code 内置设置，不需要初始化，使用默认值
                                    value = setting.value;
                                } else {
                                    // 扩展的私有设置，初始化到 VS Code 配置中
                                    try {
                                        await this.configManager.set(setting.vscode_setting_id as string, value);
                                        console.log(`初始化设置项: ${setting.vscode_setting_id} = ${value}`);
                                    } catch (initError) {
                                        console.warn(`初始化设置项失败 ${setting.vscode_setting_id}:`, initError);
                                        // 初始化失败时使用默认值
                                        value = setting.value;
                                    }
                                }
                            }
                        }

                        return {
                            name: setting.name,
                            description: setting.description,
                            value,
                            vscodeSettingId: setting.vscode_setting_id,
                            vscodeApi: setting.vscode_api,
                            type: this.getSettingType(setting, value),
                            options: setting.options || []
                        };
                    })
                );

                settingsData[category] = settings;
            }

            return settingsData;
        } catch (error) {
            console.error('加载设置数据失败:', error);
            return {
                'IDE 配置': [
                    {
                        name: '加载失败',
                        description: '无法加载设置数据',
                        value: '',
                        vscodeSettingId: '',
                        type: 'text'
                    }
                ]
            };
        }
    }

    private async saveSetting(settingId: string, value: unknown): Promise<void> {
        try {
            console.log(`保存设置: ${settingId} = ${value}`);
            await this.configManager.set(settingId, value);
            UnifiedUtils.showInfo('设置已保存');
        } catch (error) {
            console.error(`保存设置失败 ${settingId}:`, error);
            UnifiedUtils.showError(`保存设置失败: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private getSettingType(setting: Record<string, unknown>, _value: unknown): string {
        if (setting.type === 'search' || setting.type === 'fill') {
            return 'text';
        }
        if (setting.type === 'api') {
            return 'button';
        }
        if (setting.type === 'select') {
            return 'select';
        }
        if (setting.type === 'number') {
            return 'number';
        }
        if (
            setting.type === 'fill' &&
            setting.vscode_setting_id &&
            (setting.vscode_setting_id as string).includes('args')
        ) {
            return 'text'; // 数组类型在界面上显示为文本
        }
        if (
            setting.type === '' &&
            setting.vscode_setting_id &&
            (setting.vscode_setting_id as string).includes('formatOnSave')
        ) {
            return 'boolean';
        }
        return (setting.type as string) || 'text';
    }

    private async checkCompilers(panel: vscode.WebviewPanel, languages: string[]): Promise<void> {
        if (!this.context) return;

        try {
            // 报告扫描开始
            this.reportScanProgress(panel, 0, '开始扫描编译器...');

            // 模拟扫描进度
            await this.simulateScanProgress(panel);

            // 执行真实的编译器检测
            this.reportScanProgress(panel, 50, '正在检测系统编译器...');

            const detectionResult = await NativeCompilerManager.detectCompilers(this.context, true);

            this.reportScanProgress(panel, 80, '正在分析编译器信息...');

            // 根据用户选择的语言过滤编译器
            const filteredCompilers = this.filterCompilersByLanguage(detectionResult.compilers, languages);

            const result = {
                success: detectionResult.success,
                compilers: filteredCompilers.map(compiler => ({
                    name: compiler.name,
                    version: compiler.version,
                    path: compiler.path
                })),
                suggestions: detectionResult.suggestions
            };

            this.reportScanProgress(panel, 95, '正在完成扫描...');

            // 延迟一点让用户看到完成状态
            setTimeout(() => {
                postWebviewMessage(panel, 'compiler-check-result', { result });
            }, 500);
        } catch (error) {
            console.error('编译器检查失败:', error);
            postWebviewMessage(panel, 'compiler-check-result', {
                result: {
                    success: false,
                    compilers: [],
                    suggestions: []
                }
            });
        }
    }

    private async simulateScanProgress(panel: vscode.WebviewPanel): Promise<void> {
        return new Promise(resolve => {
            let progress = 0;
            const interval = setInterval(() => {
                progress += 10;
                if (progress <= 40) {
                    postWebviewMessage(panel, 'scan-progress', {
                        progress,
                        message: this.getScanMessage(progress)
                    });
                } else {
                    clearInterval(interval);
                    resolve();
                }
            }, 200);
        });
    }

    private getScanMessage(progress: number): string {
        if (progress < 20) return '正在初始化扫描...';
        if (progress < 40) return '正在搜索编译器路径...';
        return '正在分析编译器...';
    }

    private reportScanProgress(panel: vscode.WebviewPanel, progress: number, message: string): void {
        postWebviewMessage(panel, 'scan-progress', { progress, message });
    }

    private async installCompiler(panel: vscode.WebviewPanel, type: string, _languages: string[]): Promise<void> {
        try {
            if (type === 'llvm') {
                const installResult = await NativeCompilerManager.installLLVM();

                if (installResult.success) {
                    postWebviewMessage(panel, 'compiler-install-complete', {
                        message: installResult.message
                    });
                } else {
                    postWebviewMessage(panel, 'compiler-install-error', {
                        message: installResult.message
                    });
                }
            } else {
                postWebviewMessage(panel, 'compiler-install-error', {
                    message: `不支持的编译器类型: ${type}`
                });
            }
        } catch (error) {
            console.error('编译器安装失败:', error);
            postWebviewMessage(panel, 'compiler-install-error', {
                message: `安装失败: ${error instanceof Error ? error.message : String(error)}`
            });
        }
    }

    private filterCompilersByLanguage(compilers: CompilerInfo[], languages: string[]): CompilerInfo[] {
        return compilers.filter(compiler => {
            const compilerName = compiler.name.toLowerCase();

            if (languages.includes('c') && languages.includes('cpp')) {
                // 如果选择了C和C++，显示所有编译器
                return true;
            } else if (languages.includes('c')) {
                // 只选择C编译器
                return (
                    (compilerName.includes('gcc') && !compilerName.includes('g++')) ||
                    (compilerName.includes('clang') && !compilerName.includes('clang++')) ||
                    (compilerName.includes('cc') && !compilerName.includes('g++'))
                );
            } else if (languages.includes('cpp')) {
                // 只选择C++编译器
                return (
                    compilerName.includes('g++') || compilerName.includes('clang++') || compilerName.includes('cl.exe')
                );
            }

            return false;
        });
    }
}
