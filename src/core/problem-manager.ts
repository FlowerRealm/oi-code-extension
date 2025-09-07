import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { getLanguageIdFromEditor, toSafeName, getWebviewContent } from '../utils/webview-utils';

export class ProblemManager {
    private static instance: ProblemManager;
    private context: vscode.ExtensionContext | undefined;

    private constructor() {}

    public static getInstance(): ProblemManager {
        if (!ProblemManager.instance) {
            ProblemManager.instance = new ProblemManager();
        }
        return ProblemManager.instance;
    }

    public setContext(context: vscode.ExtensionContext) {
        this.context = context;
    }

    private async pickProblemsBaseDir(): Promise<string> {
        if (!this.context) {
            throw new Error('Context not initialized');
        }

        const saved = this.context.globalState.get<string>('oicode.lastProblemsBaseDir');
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
        this.context.globalState.update('oicode.lastProblemsBaseDir', baseDir);
        return baseDir;
    }

    private async ensureProblemStructure(m: any): Promise<{ sourcePath: string }> {
        if (!this.context) {
            throw new Error('Context not initialized');
        }

        const active = vscode.window.activeTextEditor;
        if (!active) {
            throw new Error('Please open a source file in the editor first.');
        }
        const langId = getLanguageIdFromEditor(active);
        const problemName = toSafeName(m.name);

        const baseDir = await this.pickProblemsBaseDir();

        const problemDir = path.join(baseDir, problemName);
        const configDir = path.join(problemDir, 'config');
        await fs.promises.mkdir(problemDir, { recursive: true });
        await fs.promises.mkdir(configDir, { recursive: true });

        const sourcePath = path.join(problemDir, `main.${langId}`);
        await fs.promises.writeFile(sourcePath, active.document.getText(), 'utf8');

        const configJson = {
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

    public async createProblem(payload?: { name?: string; language?: 'c' | 'cpp'; baseDir?: string }) {
        if (!this.context) {
            throw new Error('Context not initialized');
        }

        try {
            let name = payload?.name;
            if (!name) {
                name =
                    (await vscode.window.showInputBox({
                        prompt: 'Enter problem name (will be used as folder name)',
                        placeHolder: 'e.g.: CF1234A'
                    })) || '';
            }
            if (!name) {
                return;
            }
            const safe = name.replace(/[^\w-.]+/g, '_').slice(0, 64);

            let baseDir = payload?.baseDir || this.context.globalState.get<string>('oicode.lastProblemsBaseDir');
            if (baseDir) {
                try {
                    await fs.promises.access(baseDir);
                } catch {
                    baseDir = undefined;
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
                    return;
                }
                baseDir = pick[0].fsPath;
            }
            this.context.globalState.update('oicode.lastProblemsBaseDir', baseDir);

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
                    return;
                }
                langId = langPick.value as 'c' | 'cpp';
            }
            if (langId) {
                const ext = langId;
                const problemDir = path.join(baseDir, safe);
                const configDir = path.join(problemDir, 'config');
                await fs.promises.mkdir(problemDir, { recursive: true });
                await fs.promises.mkdir(configDir, { recursive: true });

                const sourcePath = path.join(problemDir, `main.${ext}`);
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
                        JSON.stringify(
                            { name: safe, url: '', timeLimit: 5, memoryLimit: 256, opt: '', std: '' },
                            null,
                            2
                        ),
                        'utf8'
                    );
                }
                const statementPath = path.join(configDir, 'statement.md');
                try {
                    await fs.promises.access(statementPath);
                } catch {
                    await fs.promises.writeFile(
                        statementPath,
                        `# ${safe}\n\nWrite problem statement here...\n`,
                        'utf8'
                    );
                }
                const samplesPath = path.join(configDir, 'samples.txt');
                try {
                    await fs.promises.access(samplesPath);
                } catch {
                    await fs.promises.writeFile(samplesPath, '', 'utf8');
                }

                const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(sourcePath));
                await vscode.window.showTextDocument(doc, { preview: false });
                vscode.window.showInformationMessage(`Problem created：${safe}`);
                return { problemDir, sourcePath };
            }
        } catch (e: any) {
            vscode.window.showErrorMessage(`Failed to create problem：${e.message || e}`);
            return { error: e?.message || String(e) };
        }
    }

    public async handleProblemViewMessage(m: any) {
        if (!this.context) {
            throw new Error('Context not initialized');
        }

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
            } catch (e: any) {
                vscode.window.showErrorMessage(e.message || String(e));
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
                if (!this.context) {
                    throw new Error('Context not initialized');
                }

                webviewView.webview.options = {
                    enableScripts: true,
                    localResourceRoots: [this.context.extensionUri]
                };
                webviewView.webview.html = await this.getWebviewContent('problem.html');

                webviewView.webview.onDidReceiveMessage(async (m: any) => {
                    const result = await this.handleProblemViewMessage(m);
                    if (result) {
                        webviewView.webview.postMessage(result);
                    }
                });
            }
        };
    }

    private async getWebviewContent(fileName: string): Promise<string> {
        if (!this.context) {
            throw new Error('Context not initialized');
        }
        return getWebviewContent(this.context, fileName);
    }
}
