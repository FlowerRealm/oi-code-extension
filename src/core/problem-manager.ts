import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { getLanguageIdFromEditor, toSafeName, getWebviewContent } from '../utils/webview-utils';
import { WebViewThemeManager } from '../utils/webview-theme-manager';
import { UnifiedConfigManager } from '../utils/unified-config-manager';
import { AdvancedBaseManager } from './advanced-base-manager';
import {
    ProblemViewMessage,
    ProblemConfig,
    ProblemStructure,
    CreateProblemPayload,
    CreateProblemResult,
    LoadSamplesResult
} from '../types';

export class ProblemManager extends AdvancedBaseManager {
    private static instance: ProblemManager;
    private themeManager: WebViewThemeManager;
    private configManager: UnifiedConfigManager;

    private constructor() {
        super();
        this.themeManager = WebViewThemeManager.getInstance();
        this.configManager = UnifiedConfigManager.getInstance();
    }

    public static getInstance(): ProblemManager {
        if (!ProblemManager.instance) {
            ProblemManager.instance = new ProblemManager();
        }
        return ProblemManager.instance;
    }

    private async pickProblemsBaseDir(): Promise<string> {
        const saved = this.configManager.getGlobalState<string>('oicode.lastProblemsBaseDir');
        if (saved) {
            try {
                await fs.promises.access(saved);
                const choice = await vscode.window.showQuickPick(
                    [
                        { label: `Use previous：${saved}`, value: 'saved' },
                        { label: 'Choose again...', value: 'pick' }
                    ],
                    { placeHolder: 'Choose problem root directory' }
                );
                if (!choice) {
                    throw new Error('Problem root directory not selected');
                }
                if (choice.value === 'saved') {
                    return saved;
                }
            } catch {}
        }
        const pick = await vscode.window.showOpenDialog({
            canSelectFolders: true,
            canSelectFiles: false,
            canSelectMany: false,
            openLabel: 'Choose problem root directory'
        });
        if (!pick || !pick[0]) {
            throw new Error('Problem root directory not selected');
        }
        const baseDir = pick[0].fsPath;
        await this.configManager.updateGlobalState('oicode.lastProblemsBaseDir', baseDir);
        return baseDir;
    }

    private async ensureProblemStructure(m: ProblemViewMessage): Promise<ProblemStructure> {
        const active = vscode.window.activeTextEditor;
        if (!active) {
            throw new Error('Please open a source file in the editor first.');
        }
        const langId = getLanguageIdFromEditor(active);
        const problemName = toSafeName(m.name || '');

        const baseDir = await this.pickProblemsBaseDir();

        const problemDir = path.join(baseDir, problemName);
        const configDir = path.join(problemDir, 'config');
        await fs.promises.mkdir(problemDir, { recursive: true });
        await fs.promises.mkdir(configDir, { recursive: true });

        const sourcePath = path.join(problemDir, `main.${langId}`);
        await fs.promises.writeFile(sourcePath, active.document.getText(), 'utf8');

        const configJson: ProblemConfig = {
            name: m.name || '',
            url: m.url || '',
            timeLimit: Number(m.timeLimit) || 5,
            memoryLimit: Number(m.memoryLimit) || 256,
            opt: m.opt || '',
            std: m.std || ''
        };
        await fs.promises.writeFile(path.join(configDir, 'problem.json'), JSON.stringify(configJson, null, 2), 'utf8');
        if (m.statement) await fs.promises.writeFile(path.join(configDir, 'statement.md'), m.statement, 'utf8');
        if (m.samples) await fs.promises.writeFile(path.join(configDir, 'samples.txt'), m.samples, 'utf8');

        return { sourcePath };
    }

    private async getProblemName(payload?: CreateProblemPayload): Promise<string> {
        let name = payload?.name;
        if (!name) {
            name =
                (await vscode.window.showInputBox({
                    prompt: 'Enter problem name (will be used as folder name)',
                    placeHolder: 'e.g.: CF1234A'
                })) || '';
        }
        if (!name) {
            throw new Error('Problem name not provided');
        }
        return name.replace(/[^\w-.]+/g, '_').slice(0, 64);
    }

    private async getOrCreateBaseDir(payload?: CreateProblemPayload): Promise<string> {
        let baseDir = payload?.baseDir || this.configManager.getGlobalState<string>('oicode.lastProblemsBaseDir') || '';
        if (baseDir) {
            try {
                await fs.promises.access(baseDir);
            } catch {
                baseDir = '';
            }
        }
        if (!baseDir) {
            const pick = await vscode.window.showOpenDialog({
                canSelectFolders: true,
                canSelectFiles: false,
                canSelectMany: false,
                openLabel: 'Choose problem root directory'
            });
            if (!pick || !pick[0]) {
                throw new Error('Problem root directory not selected');
            }
            baseDir = pick[0].fsPath;
        }
        await this.configManager.updateGlobalState('oicode.lastProblemsBaseDir', baseDir);
        return baseDir;
    }

    private async getLanguageSelection(payload?: CreateProblemPayload): Promise<'c' | 'cpp'> {
        let langId = payload?.language as ('c' | 'cpp') | undefined;
        if (!langId) {
            const langPick = await vscode.window.showQuickPick(
                [
                    { label: 'C', detail: 'main.c', value: 'c' },
                    { label: 'C++', detail: 'main.cpp', value: 'cpp' }
                ],
                { placeHolder: 'Select language' }
            );
            if (!langPick) {
                throw new Error('Language not selected');
            }
            langId = langPick.value as 'c' | 'cpp';
        }
        return langId;
    }

    private async createProblemFiles(problemDir: string, langId: 'c' | 'cpp', safeName: string): Promise<string> {
        const configDir = path.join(problemDir, 'config');
        await fs.promises.mkdir(problemDir, { recursive: true });
        await fs.promises.mkdir(configDir, { recursive: true });

        const sourcePath = path.join(problemDir, `main.${langId}`);
        try {
            await fs.promises.access(sourcePath);
        } catch {
            await fs.promises.writeFile(sourcePath, '', 'utf8');
        }

        const problemJsonPath = path.join(configDir, 'problem.json');
        try {
            await fs.promises.access(problemJsonPath);
        } catch {
            await fs.promises.writeFile(
                problemJsonPath,
                JSON.stringify({ name: safeName, url: '', timeLimit: 5, memoryLimit: 256, opt: '', std: '' }, null, 2),
                'utf8'
            );
        }

        const statementPath = path.join(configDir, 'statement.md');
        try {
            await fs.promises.access(statementPath);
        } catch {
            await fs.promises.writeFile(statementPath, `# ${safeName}\n\nWrite problem statement here...\n`, 'utf8');
        }

        const samplesPath = path.join(configDir, 'samples.txt');
        try {
            await fs.promises.access(samplesPath);
        } catch {
            await fs.promises.writeFile(samplesPath, '', 'utf8');
        }

        return sourcePath;
    }

    public async createProblem(payload?: CreateProblemPayload): Promise<CreateProblemResult | undefined> {
        try {
            const safeName = await this.getProblemName(payload);
            const baseDir = await this.getOrCreateBaseDir(payload);
            const langId = await this.getLanguageSelection(payload);
            const problemDir = path.join(baseDir, safeName);
            const sourcePath = await this.createProblemFiles(problemDir, langId, safeName);

            const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(sourcePath));
            await vscode.window.showTextDocument(doc, { preview: false });
            vscode.window.showInformationMessage(`Problem created：${safeName}`);
            return { problemDir, sourcePath };
        } catch (e: unknown) {
            const errorMessage = e instanceof Error ? e.message : String(e);
            this.handleError(e, 'Failed to create problem');
            return { error: errorMessage };
        }
    }

    public async handleProblemViewMessage(m: ProblemViewMessage): Promise<LoadSamplesResult | null> {
        if (m.cmd === 'loadSamples') {
            const uris = await vscode.window.showOpenDialog({
                canSelectMany: false,
                openLabel: 'Select sample file'
            });
            if (uris && uris[0]) {
                const buf = await vscode.workspace.fs.readFile(uris[0]);
                const text = buf.toString();
                return { cmd: 'samplesLoaded', text };
            }
        } else if (m.cmd === 'run') {
            try {
                const { sourcePath } = await this.ensureProblemStructure(m);
                const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(sourcePath));
                await vscode.window.showTextDocument(doc, { preview: false });
                await vscode.commands.executeCommand('oicode.runCode', m.samples || '', {
                    timeLimit: m.timeLimit,
                    memoryLimit: m.memoryLimit
                });
            } catch (e: unknown) {
                this.handleError(e, 'Problem execution error');
            }
        } else if (m.cmd === 'pair') {
            await vscode.commands.executeCommand('oicode.runPairCheck', m.samples || '', {
                timeLimit: m.timeLimit,
                memoryLimit: m.memoryLimit
            });
        }
        return null;
    }

    public getProblemViewProvider() {
        return {
            resolveWebviewView: async (
                webviewView: vscode.WebviewView,
                _context: vscode.WebviewViewResolveContext,
                _token: vscode.CancellationToken
            ) => {
                const context = this.getContext();

                webviewView.webview.options = {
                    enableScripts: true,
                    localResourceRoots: [context.extensionUri]
                };
                webviewView.webview.html = await this.getWebviewContent('problem.html');

                // 使用统一的主题管理器
                this.themeManager.setupThemeHandling(webviewView.webview);

                webviewView.webview.onDidReceiveMessage(async (m: ProblemViewMessage) => {
                    const result = await this.handleProblemViewMessage(m);
                    if (result) {
                        webviewView.webview.postMessage(result);
                    }
                });
            }
        };
    }

    private async getWebviewContent(fileName: string): Promise<string> {
        return getWebviewContent(this.getContext(), fileName);
    }
}
