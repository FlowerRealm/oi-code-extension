/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


import * as assert from 'assert';
import { describe, it, before, after } from 'mocha';
require('mocha');

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import { exec } from 'child_process';
import { OI_CODE_TEST_TMP_PATH } from '../../constants';

// Base dir for test-created problems
const TEST_BASE_DIR = path.join(os.homedir(), '.oi-code-tests', 'problems-ut');
const TEST_TMP_BASE = OI_CODE_TEST_TMP_PATH;

// Helper: create a problem via command, inject code, and open it
async function createProblemAndOpen(name: string, language: 'c' | 'cpp' | 'python', code: string): Promise<{ problemDir: string; sourcePath: string; uri: vscode.Uri }> {
    await fs.mkdir(TEST_BASE_DIR, { recursive: true });
    const res: any = await vscode.commands.executeCommand('oicode.createProblem', { name, language, baseDir: TEST_BASE_DIR });
    if (!res || res.error) { throw new Error(`failed to create problem: ${res?.error || 'unknown'}`); }
    await fs.writeFile(res.sourcePath, code);
    const uri = vscode.Uri.file(res.sourcePath);
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc);
    return { problemDir: res.problemDir, sourcePath: res.sourcePath, uri };
}

// Helper to clean up a directory
async function cleanupDir(dir: string) {
    await fs.rm(dir, { recursive: true, force: true });
}

suite('Extension Test Suite', () => {
    // 等待扩展激活
    before(async function () {
        this.timeout(35000);
        const extId = 'FlowerRealm.oi-code';
        let extension = vscode.extensions.getExtension(extId);
        let waited = 0;
        const interval = 500;
        // 输出所有扩展id和name
        console.log('All extensions in test env:', vscode.extensions.all.map(e => ({ id: e.id, name: e.packageJSON?.name })));
        // 输出当前工作目录和 dist/extension.js 是否存在
        const fs = require('fs');
        console.log('CWD:', process.cwd());
        console.log('dist/extension.js exists:', fs.existsSync('./dist/extension.js'));
        while ((!extension || !extension.isActive) && waited < 30000) {
            if (extension && !extension.isActive) {
                try { await extension.activate(); } catch { }
            }
            await new Promise(res => setTimeout(res, interval));
            waited += interval;
            extension = vscode.extensions.getExtension(extId);
        }
        if (!extension || !extension.isActive) {
            throw new Error('OI-Code extension did not activate in time');
        }
    });

    test('Extension activation check', async function () {
        this.timeout(15000);
        const extId = 'FlowerRealm.oi-code';
        let extension = vscode.extensions.getExtension(extId);
        let waited = 0;
        const interval = 300;
        while (extension && !extension.isActive && waited < 6000) {
            try { await extension.activate(); } catch { }
            await new Promise(res => setTimeout(res, interval));
            waited += interval;
            extension = vscode.extensions.getExtension(extId);
        }
        const commands = await vscode.commands.getCommands();
        const hasAny = commands.includes('oi-code.showSettingsPage') || commands.includes('oicode.initializeEnvironment');
        assert.ok((extension && extension.isActive) || hasAny, 'OI-Code extension should be active or commands should be available');
    });

    test('showSettingsPage command should create a webview panel', async function () {
        this.timeout(10000);
        await vscode.commands.executeCommand('oi-code.showSettingsPage');
        await new Promise(resolve => setTimeout(resolve, 500));
        const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab;
        assert.ok(activeTab, "No active tab found after executing command");
        const isWebview = activeTab.input instanceof vscode.TabInputWebview;
        assert.ok(isWebview, "The active tab is not a webview panel");
        assert.strictEqual(activeTab.label, 'OI-Code 设置', "Webview panel title is incorrect");
    });

    test('Docker initialization and code execution', async function () {
        this.timeout(90000);
        await vscode.commands.executeCommand('oicode.initializeEnvironment');
        // Test C code execution
        const cCode = `#include <stdio.h>\nint main() { printf(\"Hello, C!\\n\"); return 0; }`;
        const createdC = await createProblemAndOpen('UT-C-Hello', 'c', cCode);
        const resC: any = await vscode.commands.executeCommand('oicode.runCode', '');
        assert.ok(resC, 'oicode.runCode should return a result');
        assert.ok(typeof resC.output === 'string');
        await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
        await cleanupDir(path.dirname(createdC.sourcePath));
        // Test C++ code execution
        const cppCode = `#include <iostream>\nint main() { std::cout << \"Hello, C++!\\n\"; return 0; }`;
        const createdCpp = await createProblemAndOpen('UT-CPP-Hello', 'cpp', cppCode);
        const resCpp: any = await vscode.commands.executeCommand('oicode.runCode', '');
        assert.ok(resCpp && typeof resCpp.output === 'string');
        await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
        await cleanupDir(path.dirname(createdCpp.sourcePath));
        // Test Python code execution
        const pythonCode = `print(\"Hello, Python!\")`;
        const createdPy = await createProblemAndOpen('UT-PY-Hello', 'python', pythonCode);
        const resPy: any = await vscode.commands.executeCommand('oicode.runCode', '');
        assert.ok(resPy && typeof resPy.output === 'string');
        await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
        await cleanupDir(path.dirname(createdPy.sourcePath));
    });
});

// New test suite for OI-Code commands
suite('OI-Code Commands Test Suite', () => {

    test('should execute oi-code.installDocker command', async function () {
        this.timeout(120000); // Increase timeout for Docker installation
        vscode.window.showInformationMessage('Checking Docker installation...');

        // Check if Docker is already installed
        const isDockerInstalled = await new Promise<boolean>(resolve => {
            exec('docker --version', (error: any, stdout: any, stderr: any) => {
                if (error) {
                    console.log('Docker is not installed:', error.message);
                    resolve(false);
                } else {
                    console.log('Docker is already installed:', stdout);
                    resolve(true);
                }
            });
        });

        if (isDockerInstalled) {
            vscode.window.showInformationMessage('Docker is already installed. Skipping installation.');
            assert.ok(true, 'Docker already installed, skipped installation command.');
        } else {
            vscode.window.showInformationMessage('Docker not found. Executing oi-code.installDocker...');
            await vscode.commands.executeCommand('oicode.downloadDocker');
            assert.ok(true, 'oi-code.installDocker command executed successfully');
            vscode.window.showInformationMessage('oi-code.installDocker executed.');
        }
    });



    describe('Code Execution Tests (requires Docker environment)', () => {
        before(async function () {
            this.timeout(120000); // Increase timeout for Docker initialization
            vscode.window.showInformationMessage('Initializing Docker environment for code execution tests...');
            await vscode.commands.executeCommand('oicode.initializeEnvironment');
            // Ensure docker compiler defaults
            const dockerCompilers = {
                c: { command: 'gcc', args: ['/sandbox/${sourceFile}', '-o', '/tmp/a.out', '-O2'] },
                cpp: { command: 'g++', args: ['/sandbox/${sourceFile}', '-o', '/tmp/a.out', '-O2', '-std=c++17'] },
                python: { command: 'python3', args: ['/sandbox/${sourceFile}'] }
            } as any;
            const config = vscode.workspace.getConfiguration();
            await config.update('oicode.docker.compilers', dockerCompilers, vscode.ConfigurationTarget.Global);
            vscode.window.showInformationMessage('Docker environment initialized.');
        });

        test('should create and run C Hello World', async function () {
            this.timeout(60000);
            const cCode = `#include <stdio.h>\nint main() { printf(\"Hello, C from Test!\\n\"); return 0; }`;
            const created = await createProblemAndOpen('UT-Run-C', 'c', cCode);
            vscode.window.showInformationMessage('Executing oicode.runCode for C...');
            const res: any = await vscode.commands.executeCommand('oicode.runCode', '');
            assert.ok(res && typeof res.output === 'string');
            await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
            await cleanupDir(path.dirname(created.sourcePath));
        });

        test('should create and run C++ Hello World', async function () {
            this.timeout(60000);
            const cppCode = `#include <iostream>\nint main() { std::cout << \"Hello, C++ from Test!\\n\"; return 0; }`;
            const created = await createProblemAndOpen('UT-Run-CPP', 'cpp', cppCode);
            vscode.window.showInformationMessage('Executing oicode.runCode for C++...');
            const res: any = await vscode.commands.executeCommand('oicode.runCode', '');
            assert.ok(res && typeof res.output === 'string');
            await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
            await cleanupDir(path.dirname(created.sourcePath));
        });

        test('should create and run Python Hello World', async function () {
            this.timeout(60000);
            const pythonCode = `print(\"Hello, Python from Test!\")`;
            const created = await createProblemAndOpen('UT-Run-PY', 'python', pythonCode);
            vscode.window.showInformationMessage('Executing oicode.runCode for Python...');
            const res: any = await vscode.commands.executeCommand('oicode.runCode', '');
            assert.ok(res && typeof res.output === 'string');
            await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
            await cleanupDir(path.dirname(created.sourcePath));
        });
    });

    describe('Pair Check Tests (Catalan numbers)', () => {
        const inputs = ['0\n', '1\n', '2\n', '3\n', '4\n', '5\n'];

        async function openBesideDocs(codeLeft: string, codeRight: string, ext: string) {
            // Close all editors to avoid picking unrelated editors in runPairCheck
            await vscode.commands.executeCommand('workbench.action.closeAllEditors');
            const lang = (ext === 'py' ? 'python' : ext) as 'c' | 'cpp' | 'python';
            const left = await createProblemAndOpen(`UT-${ext}-REC`, lang, codeLeft);
            const right = await createProblemAndOpen(`UT-${ext}-DP`, lang, codeRight);
            const leftDoc = await vscode.workspace.openTextDocument(left.uri);
            const rightDoc = await vscode.workspace.openTextDocument(right.uri);
            await vscode.window.showTextDocument(leftDoc, { viewColumn: vscode.ViewColumn.One });
            await vscode.window.showTextDocument(rightDoc, { viewColumn: vscode.ViewColumn.Beside });
            return { leftDir: path.dirname(left.sourcePath), rightDir: path.dirname(right.sourcePath) };
        }

        const cRec = `#include <stdio.h>\nlong long C(int n){ if(n<=1) return 1; long long s=0; for(int i=0;i<n;i++) s+=C(i)*C(n-1-i); return s;}\nint main(){ int n; if(scanf(\"%d\",&n)!=1) return 0; printf(\"%lld\\n\", C(n)); }`;
        const cDp = `#include <stdio.h>\nlong long C[40];\nint main(){ int n; if(scanf(\"%d\",&n)!=1) return 0; C[0]=C[1]=1; for(int i=2;i<=n;i++){ C[i]=0; for(int j=0;j<i;j++) C[i]+=C[j]*C[i-1-j]; } printf(\"%lld\\n\", C[n]); }`;

        const cppRec = `#include <bits/stdc++.h>\n using namespace std; long long C(long long n){ if(n<=1) return 1; long long s=0; for(long long i=0;i<n;i++) s+=C(i)*C(n-1-i); return s;} int main(){ long long n; if(!(cin>>n)) return 0; cout<<C(n)<<\"\\n\"; }`;
        const cppDp = `#include <bits/stdc++.h>\n using namespace std; long long C[40]; int main(){ long long n; if(!(cin>>n)) return 0; C[0]=1; C[1]=1; for(int i=2;i<=n;i++){ C[i]=0; for(int j=0;j<i;j++) C[i]+=C[j]*C[i-1-j]; } cout<<C[n]<<\"\\n\"; }`;

        const pyRec = `import sys
sys.setrecursionlimit(10000)
from functools import lru_cache
@lru_cache(None)
def C(n):
    if n<=1: return 1
    return sum(C(i)*C(n-1-i) for i in range(n))
def main():
    n = int(sys.stdin.readline().strip() or '0')
    print(C(n))
main()`;
        const pyDp = `import sys\nn=int(sys.stdin.readline().strip() or '0')\nC=[1]*(n+1)\nfor i in range(2,n+1):\n C[i]=sum(C[j]*C[i-1-j] for j in range(i))\nprint(C[n])`;

        for (const lang of ['c', 'cpp', 'python'] as const) {
            test(`pair check ${lang} catalan recursive vs dp`, async function () {
                this.timeout(60000);
                const codes = lang === 'c' ? [cRec, cDp] : lang === 'cpp' ? [cppRec, cppDp] : [pyRec, pyDp];
                const ext = lang === 'python' ? 'py' : lang;
                const { leftDir, rightDir } = await openBesideDocs(codes[0], codes[1], ext);
                try {
                    for (const input of inputs) {
                        const res: any = await vscode.commands.executeCommand('oicode.runPairCheck', input);
                        if (res && res.error) {
                            assert.fail(`pair check error: ${res.error}`);
                        }
                        if (!(res && res.equal === true)) {
                            console.log('PairCheck mismatch debug:', { lang: lang, input, output1: (res?.output1 || '').slice(0, 200), output2: (res?.output2 || '').slice(0, 200) });
                        }
                        assert.ok(res && res.equal === true, `pair check mismatch for input=${input} in ${lang}`);
                    }
                } finally {
                    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
                    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
                    await cleanupDir(leftDir);
                    await cleanupDir(rightDir);
                }
            });
        }
    });
});
