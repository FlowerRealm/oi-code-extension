import * as vscode from 'vscode';
import { PairCheckManager } from './pair-check-manager';
import { ProblemManager } from './problem-manager';
import { CommandManager } from './commands';
import { WebViewManager } from './webview-manager';
import { NativeCompilerManager } from '../native';
import { UnifiedConfigManager } from '../utils/unified-config-manager';
import { UnifiedUtils } from '../utils/unified-utils';
import { ExtensionSettings } from '../utils/extension-settings';
import { CreateProblemPayload } from '../types/types';

export async function activate(context: vscode.ExtensionContext) {
    await UnifiedUtils.safeExecute(
        async () => {
            console.log('OI-Code extension is now active!');
            console.log('Extension path:', context.extensionPath);

            // 初始化扩展设置
            await ExtensionSettings.initialize(context);

            await detectCompilers(context);

            const configManager = UnifiedConfigManager.getInstance();
            const managers = initializeManagers(context);

            registerWebViewProviders(context, managers.webviewManager);
            registerCommands(context, managers);
            await setupInitialPages(context, configManager);

            console.log('OI-Code extension activation completed successfully');
        },
        'Failed to activate OI-Code extension',
        'Extension Activation'
    );
}

interface ExtensionManagers {
    pairCheckManager: PairCheckManager;
    problemManager: ProblemManager;
    commandManager: CommandManager;
    webviewManager: WebViewManager;
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
            console.log('Compiler detection failed:', result.error);
        }
    } catch (error) {
        console.error('Failed to detect compilers:', error);
    }
}

function initializeManagers(context: vscode.ExtensionContext): ExtensionManagers {
    const managers: ExtensionManagers = {
        pairCheckManager: PairCheckManager.getInstance(),
        problemManager: ProblemManager.getInstance(),
        commandManager: CommandManager.getInstance(),
        webviewManager: WebViewManager.getInstance()
    };

    Object.values(managers).forEach(manager => manager.setContext(context));
    return managers;
}

function registerWebViewProviders(context: vscode.ExtensionContext, webviewManager: WebViewManager): void {
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('oicode.problemView', webviewManager.getProblemViewProvider())
    );
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('oicode.pairCheckView', webviewManager.getPairCheckViewProvider())
    );
}

function registerCommands(context: vscode.ExtensionContext, managers: ExtensionManagers): void {
    const commandConfig: CommandPair[] = [
        ['oicode.createProblem', payload => managers.problemManager.createProblem(payload as CreateProblemPayload)],
        [
            'oicode.runCode',
            (testInput, options) =>
                managers.commandManager.runCode(
                    testInput as string | undefined,
                    options as { timeLimit?: number; memoryLimit?: number } | undefined
                )
        ],
        ['oicode.startPairCheck', () => managers.pairCheckManager.startPairCheck()],
        [
            'oicode.runPairCheck',
            (testInput, options) =>
                managers.pairCheckManager.runPairCheck(
                    context,
                    testInput as string | undefined,
                    options as { timeLimit?: number; memoryLimit?: number } | undefined
                )
        ],
        ['oicode.initializeEnvironment', () => managers.commandManager.initializeEnvironment()],
        ['oicode.rescanCompilers', () => managers.commandManager.rescanCompilers()],
        ['oicode.setupCompiler', () => managers.commandManager.setupCompiler()],
        ['oicode.setupCCompiler', () => managers.commandManager.setupCCompiler()],
        ['oicode.setupCppCompiler', () => managers.commandManager.setupCppCompiler()],
        ['oicode.deepScanCompilers', () => managers.commandManager.deepScanCompilers()],
        ['oi-code.showSettingsPage', () => managers.webviewManager.showSettingsPage()],
        ['oi-code.showCompletionPage', () => managers.webviewManager.showCompletionPage()],
        ['oi-code.showWelcomePage', () => managers.webviewManager.showWelcomePage()]
    ];

    commandConfig.forEach(([command, handler]) => {
        context.subscriptions.push(vscode.commands.registerCommand(command, handler));
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
