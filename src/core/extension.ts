import * as vscode from 'vscode';
import { PairCheckManager } from './pair-check-manager';
import { CommandManager } from './commands';
import { NativeCompilerManager } from '../native';
import { UnifiedConfigManager } from '../utils/unified-config-manager';
import { UnifiedUtils } from '../utils/unified-utils';
import { ExtensionSettings } from '../utils/extension-settings';
import { CreateProblemPayload } from '../types/types';
import { PerformanceMonitor } from '../utils/performance-monitor';
import { loadHtmlContent } from '../utils/webview-utils';

export async function activate(context: vscode.ExtensionContext) {
    await UnifiedUtils.safeExecute(
        async () => {
            console.log('OI-Code extension is now active!');
            console.log('Extension path:', context.extensionPath);

            // 初始化扩展设置
            await ExtensionSettings.initialize(context);

            await detectCompilers(context);

            const configManager = UnifiedConfigManager.getInstance();
            configManager.setContext(context);
            const managers = initializeManagers(context);

            registerWebViewProviders(context, managers.webviewManager);
            registerCommands(context, managers);
            await setupInitialPages(context, configManager);

            console.log('OI-Code extension activation completed successfully');
        },
        'Extension Activation'
    );
}

interface ExtensionManagers {
    pairCheckManager: PairCheckManager;
    problemManager: any; // Use any for stub implementations
    commandManager: CommandManager;
    webviewManager: any; // Use any for stub implementations
}

type CommandHandler = (...args: unknown[]) => unknown;
type CommandPair = [string, CommandHandler];

async function detectCompilers(context: vscode.ExtensionContext): Promise<void> {
    try {
        const result = await NativeCompilerManager.detectCompilers(context);
        if (result.success) {
            console.log(`Detected ${result.compilers.length} compilers`);
            if (result.recommended) {
                console.log(`Recommended compiler: ${result.recommended.name}`);
            }
        } else {
            console.log('Compiler detection failed:', result.errors);
        }
    } catch (error) {
        console.error('Failed to detect compilers:', error);
    }
}

// Simple stub implementations for WebViewManager dependencies
class StubProblemManager {
    async createProblem(payload: CreateProblemPayload): Promise<any> {
        const fs = require('fs/promises');
        const path = require('path');
        const os = require('os');

        const baseDir = payload.baseDir || path.join(os.homedir(), '.oi-code-tests', 'problems-ut');
        const problemDir = path.join(baseDir, payload.name);
        const sourcePath = path.join(problemDir, `main.${payload.language}`);

        await fs.mkdir(problemDir, { recursive: true });
        await fs.writeFile(sourcePath, '');

        return {
            problemDir,
            sourcePath,
            success: true
        };
    }
}

// Enhanced WebViewManager that uses actual HTML files
class EnhancedWebViewManager {
    private context: vscode.ExtensionContext;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
    }

    async showSettingsPage(): Promise<void> {
        try {
            const html = await loadHtmlContent(this.context, 'settings.html');
            const panel = vscode.window.createWebviewPanel(
                'settings',
                'OI-Code 设置',
                vscode.ViewColumn.One,
                {
                    enableScripts: true,
                    localResourceRoots: [vscode.Uri.file(this.context.extensionPath)]
                }
            );
            panel.webview.html = html;
        } catch (error) {
            console.error('Failed to show settings page:', error);
            vscode.window.showErrorMessage('无法加载设置页面');
        }
    }

    async showCompletionPage(): Promise<void> {
        try {
            const html = await loadHtmlContent(this.context, 'completion.html');
            const panel = vscode.window.createWebviewPanel(
                'completion',
                'OI-Code 初始化完成',
                vscode.ViewColumn.One,
                {
                    enableScripts: true,
                    localResourceRoots: [vscode.Uri.file(this.context.extensionPath)]
                }
            );
            panel.webview.html = html;
        } catch (error) {
            console.error('Failed to show completion page:', error);
            vscode.window.showErrorMessage('无法加载完成页面');
        }
    }

    async showWelcomePage(): Promise<void> {
        try {
            const html = await loadHtmlContent(this.context, 'init.html');
            const panel = vscode.window.createWebviewPanel(
                'welcome',
                'OI-Code 欢迎页面',
                vscode.ViewColumn.One,
                {
                    enableScripts: true,
                    localResourceRoots: [vscode.Uri.file(this.context.extensionPath)]
                }
            );
            panel.webview.html = html;
        } catch (error) {
            console.error('Failed to show welcome page:', error);
            vscode.window.showErrorMessage('无法加载欢迎页面');
        }
    }

    getProblemViewProvider(): vscode.WebviewViewProvider {
        return {
            resolveWebviewView: async (webviewView: vscode.WebviewView) => {
                try {
                    const html = await loadHtmlContent(this.context, 'problem.html');
                    webviewView.webview.html = html;
                } catch (error) {
                    console.error('Failed to load problem view:', error);
                    webviewView.webview.html = '<html><body><h1>无法加载题目页面</h1></body></html>';
                }
            }
        };
    }

    getPairCheckViewProvider(): vscode.WebviewViewProvider {
        return {
            resolveWebviewView: async (webviewView: vscode.WebviewView) => {
                try {
                    const html = await loadHtmlContent(this.context, 'pair-check.html');
                    webviewView.webview.html = html;
                } catch (error) {
                    console.error('Failed to load pair check view:', error);
                    webviewView.webview.html = '<html><body><h1>无法加载对拍页面</h1></body></html>';
                }
            }
        };
    }
}

function initializeManagers(context: vscode.ExtensionContext): ExtensionManagers {
    // Initialize managers that can be created without dependencies
    const commandManager = CommandManager.getInstance();
    const pairCheckManager = PairCheckManager.getInstance();

    // Set context for managers that need it
    commandManager.setContext(context);
    pairCheckManager.setContext(context);

    // Create enhanced webview manager that loads actual HTML files
    const problemManager = new StubProblemManager();
    const webviewManager = new EnhancedWebViewManager(context);

    const managers: ExtensionManagers = {
        pairCheckManager,
        problemManager,
        commandManager,
        webviewManager
    };

    return managers;
}

function registerWebViewProviders(context: vscode.ExtensionContext, webviewManager: EnhancedWebViewManager): void {
    try {
        context.subscriptions.push(
            vscode.window.registerWebviewViewProvider('oicode.problemView', webviewManager.getProblemViewProvider())
        );
        context.subscriptions.push(
            vscode.window.registerWebviewViewProvider('oicode.pairCheckView', webviewManager.getPairCheckViewProvider())
        );
    } catch (error) {
        console.warn('Failed to register WebView providers:', error);
    }
}

function registerCommands(context: vscode.ExtensionContext, managers: ExtensionManagers): void {
    const commands: CommandPair[] = [
        // Problem management
        ['oicode.createProblem', payload => managers.problemManager.createProblem(payload as CreateProblemPayload)],

        // Code execution
        ['oicode.runCode', (testInput, options) =>
            managers.commandManager.runCode(
                testInput as string | undefined,
                options as { timeLimit?: number; memoryLimit?: number } | undefined
            )
        ],

        // Pair check
        ['oicode.startPairCheck', () => managers.pairCheckManager.startPairCheck()],
        ['oicode.runPairCheck', (testInput, options) =>
            managers.pairCheckManager.runPairCheck(
                context,
                testInput as string | undefined,
                options as { timeLimit?: number; memoryLimit?: number } | undefined
            )
        ],

        // Compiler management
        ['oicode.initializeEnvironment', () => managers.commandManager.initializeEnvironment()],
        ['oicode.rescanCompilers', () => managers.commandManager.rescanCompilers()],
        ['oicode.setupCompiler', () => managers.commandManager.setupCompiler()],
        ['oicode.setupCCompiler', () => managers.commandManager.setupCCompiler()],
        ['oicode.setupCppCompiler', () => managers.commandManager.setupCppCompiler()],
        ['oicode.deepScanCompilers', () => managers.commandManager.deepScanCompilers()],

        // WebView pages
        ['oi-code.showSettingsPage', () => managers.webviewManager.showSettingsPage()],
        ['oi-code.showCompletionPage', () => managers.webviewManager.showCompletionPage()],
        ['oi-code.showWelcomePage', () => managers.webviewManager.showWelcomePage()],

        // Performance monitoring
        ['oicode.showPerformanceReport', () => {
            const monitor = PerformanceMonitor.getInstance();
            monitor.showReport();
        }],
        ['oicode.clearPerformanceMetrics', () => {
            const monitor = PerformanceMonitor.getInstance();
            monitor.clear();
            vscode.window.showInformationMessage('Performance metrics cleared');
        }],
        ['oicode.exportPerformanceMetrics', () => {
            const monitor = PerformanceMonitor.getInstance();
            const metrics = monitor.exportMetrics();
            vscode.workspace.openTextDocument({ content: metrics, language: 'json' })
                .then(doc => vscode.window.showTextDocument(doc));
        }]
    ];

    // Register all commands
    commands.forEach(([command, handler]) => {
        try {
            const disposable = vscode.commands.registerCommand(command, handler);
            context.subscriptions.push(disposable);
        } catch (error) {
            console.warn(`Failed to register command ${command}:`, error);
        }
    });
}

async function setupInitialPages(context: vscode.ExtensionContext, configManager: UnifiedConfigManager): Promise<void> {
    const isInitialized = ExtensionSettings.isInitialized();
    const hasLaunchedBefore = configManager.getGlobalState<boolean>('hasLaunchedBefore');

    // 检查是否需要初始化
    if (!isInitialized) {
        // 显示初始化面板
        await vscode.commands.executeCommand('oi-code.showWelcomePage');
    } else {
        // 已经初始化过，显示完成页面或其他适当的页面
        await vscode.commands.executeCommand('oi-code.showCompletionPage');
    }

    // 首次启动显示欢迎页面
    if (!hasLaunchedBefore) {
        await configManager.updateGlobalState('hasLaunchedBefore', true);
    }
}

export function deactivate(): Promise<void> {
    return Promise.resolve();
}
