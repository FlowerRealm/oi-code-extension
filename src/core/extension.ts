import * as vscode from 'vscode';
import { PairCheckManager } from './pair-check-manager';
import { ProblemManager } from './problem-manager';
import { CommandManager } from './commands';
import { WebViewManager } from './webview-manager';
import { NativeCompilerManager } from '../native';

export async function activate(context: vscode.ExtensionContext) {
    try {
        console.log('OI-Code extension is now active!');
        console.log('Extension path:', context.extensionPath);

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

        const pairCheckManager = PairCheckManager.getInstance();
        const problemManager = ProblemManager.getInstance();
        const commandManager = CommandManager.getInstance();
        const webviewManager = WebViewManager.getInstance();

        pairCheckManager.setContext(context);
        problemManager.setContext(context);
        commandManager.setContext(context);
        webviewManager.setContext(context);

        context.subscriptions.push(
            vscode.window.registerWebviewViewProvider('oicode.problemView', webviewManager.getProblemViewProvider())
        );

        context.subscriptions.push(
            vscode.window.registerWebviewViewProvider('oicode.pairCheckView', webviewManager.getPairCheckViewProvider())
        );

        context.subscriptions.push(
            vscode.commands.registerCommand('oicode.createProblem', payload => {
                return problemManager.createProblem(payload);
            })
        );

        context.subscriptions.push(
            vscode.commands.registerCommand('oicode.runCode', (testInput, options) => {
                return commandManager.runCode(testInput, options);
            })
        );

        context.subscriptions.push(
            vscode.commands.registerCommand('oicode.startPairCheck', () => {
                return pairCheckManager.startPairCheck();
            })
        );

        context.subscriptions.push(
            vscode.commands.registerCommand('oicode.runPairCheck', (testInput, options) => {
                return pairCheckManager.runPairCheck(context, testInput, options);
            })
        );

        context.subscriptions.push(
            vscode.commands.registerCommand('oicode.initializeEnvironment', () => {
                return commandManager.initializeEnvironment();
            })
        );

        context.subscriptions.push(
            vscode.commands.registerCommand('oicode.rescanCompilers', () => {
                return commandManager.rescanCompilers();
            })
        );

        context.subscriptions.push(
            vscode.commands.registerCommand('oicode.setupCompiler', () => {
                return commandManager.setupCompiler();
            })
        );

        context.subscriptions.push(
            vscode.commands.registerCommand('oicode.deepScanCompilers', () => {
                return commandManager.deepScanCompilers();
            })
        );

        context.subscriptions.push(
            vscode.commands.registerCommand('oi-code.showSettingsPage', () => {
                return webviewManager.showSettingsPage();
            })
        );

        context.subscriptions.push(
            vscode.commands.registerCommand('oi-code.showCompletionPage', () => {
                return webviewManager.showCompletionPage();
            })
        );

        context.subscriptions.push(
            vscode.commands.registerCommand('oi-code.showWelcomePage', () => {
                return webviewManager.showWelcomePage();
            })
        );

        const hasLaunchedBeforeKey = 'oicode.hasLaunchedBefore';
        if (!context.globalState.get<boolean>(hasLaunchedBeforeKey)) {
            vscode.commands.executeCommand('oi-code.showWelcomePage');
            context.globalState.update(hasLaunchedBeforeKey, true);
        }

        if (context.globalState.get<boolean>('oi-code.initializationComplete')) {
            context.globalState.update('oi-code.initializationComplete', false);
            vscode.commands.executeCommand('oi-code.showCompletionPage');
        }

        console.log('OI-Code extension activation completed successfully');
    } catch (error) {
        console.error('Error activating OI-Code extension:', error);
        vscode.window.showErrorMessage(`Failed to activate OI-Code extension: ${error}`);
    }
}

export function deactivate(): Promise<void> {
    return Promise.resolve();
}
