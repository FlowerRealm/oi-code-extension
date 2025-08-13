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

// Base dir for test-created problems
const TEST_BASE_DIR = path.join(os.homedir(), '.oi-code-tests', 'problems-ut');

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
    vscode.window.showInformationMessage('Start all tests.');

    // Helper to set VS Code configuration for tests
    async function setConfiguration(section: string, value: any) {
        const config = vscode.workspace.getConfiguration();
        await config.update(section, value, vscode.ConfigurationTarget.Global);
    }

    test('showSettingsPage command should create a webview panel', async function () {
        this.timeout(5000); // Increase timeout for UI operations
        // It can take a moment for the command to be registered
        await new Promise(resolve => setTimeout(resolve, 1000));

        await vscode.commands.executeCommand('oi-code.showSettingsPage');

        // Wait for the panel to be created
        await new Promise(resolve => setTimeout(resolve, 500));

        const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab;
        assert.ok(activeTab, "No active tab found after executing command");

        const isWebview = activeTab.input instanceof vscode.TabInputWebview;
        assert.ok(isWebview, "The active tab is not a webview panel");

        assert.strictEqual(activeTab.label, 'OI-Code 设置', "Webview panel title is incorrect");
    });

    test('Docker initialization and code execution', async function () {
        this.timeout(60000); // Increase timeout for Docker operations

        // 1. Initialize Docker
        vscode.window.showInformationMessage('Initializing Docker...');
        await vscode.commands.executeCommand('oicode.initializeEnvironment');
        vscode.window.showInformationMessage('Docker initialized.');

        // 2. 使用 Docker 侧的默认编译器配置，无需本地配置
        vscode.window.showInformationMessage('Using Docker-side compilers (no local toolchain configuration).');

        try {
            // 3. Test C code execution
            vscode.window.showInformationMessage('Testing C code...');
            const cCode = `#include <stdio.h>\nint main() { printf(\"Hello, C!\\n\"); return 0; }`;
            const createdC = await createProblemAndOpen('UT-C-Hello', 'c', cCode);
            const resC: any = await vscode.commands.executeCommand('oicode.runCode', '');
            assert.ok(resC, 'oicode.runCode should return a result');
            assert.ok(typeof resC.output === 'string');
            await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
            await cleanupDir(path.dirname(createdC.sourcePath));

            // 4. Test C++ code execution
            vscode.window.showInformationMessage('Testing C++ code...');
            const cppCode = `#include <iostream>\nint main() { std::cout << \"Hello, C++!\\n\"; return 0; }`;
            const createdCpp = await createProblemAndOpen('UT-CPP-Hello', 'cpp', cppCode);
            const resCpp: any = await vscode.commands.executeCommand('oicode.runCode', '');
            assert.ok(resCpp && typeof resCpp.output === 'string');
            await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
            await cleanupDir(path.dirname(createdCpp.sourcePath));

            // 5. Test Python code execution
            vscode.window.showInformationMessage('Testing Python code...');
            const pythonCode = `print(\"Hello, Python!\")`;
            const createdPy = await createProblemAndOpen('UT-PY-Hello', 'python', pythonCode);
            const resPy: any = await vscode.commands.executeCommand('oicode.runCode', '');
            assert.ok(resPy && typeof resPy.output === 'string');
            await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
            await cleanupDir(path.dirname(createdPy.sourcePath));

        } catch (error) {
            vscode.window.showErrorMessage(`Test failed: ${error}`);
            assert.fail(`Test failed: ${error}`);
        }
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
            const lang = (ext === 'py' ? 'python' : ext) as 'c' | 'cpp' | 'python';
            const left = await createProblemAndOpen(`UT-${ext}-REC`, lang, codeLeft);
            const right = await createProblemAndOpen(`UT-${ext}-DP`, lang, codeRight);
            const leftDoc = await vscode.workspace.openTextDocument(left.uri);
            const rightDoc = await vscode.workspace.openTextDocument(right.uri);
            await vscode.window.showTextDocument(leftDoc, { viewColumn: vscode.ViewColumn.One });
            await vscode.window.showTextDocument(rightDoc, { viewColumn: vscode.ViewColumn.Beside });
            return { leftDir: path.dirname(left.sourcePath), rightDir: path.dirname(right.sourcePath) };
        }

        const cRec = `#include <stdio.h>\nlong long C(int n){ if(n<=1) return 1; long long s=0; for(int i=0;i<n;i++) s+=C(i)*C(n-1-i); return s;}\nint main(){ int n; if(scanf("%d",&n)!=1) return 0; printf("%lld\n", C(n)); }`;
        const cDp = `#include <stdio.h>\nlong long C[40];\nint main(){ int n; if(scanf("%d",&n)!=1) return 0; C[0]=C[1]=1; for(int i=2;i<=n;i++){ C[i]=0; for(int j=0;j<i;j++) C[i]+=C[j]*C[i-1-j]; } printf("%lld\n", C[n]); }`;

        const cppRec = `#include <bits/stdc++.h>\nusing namespace std; long long C(long long n){ if(n<=1) return 1; long long s=0; for(long long i=0;i<n;i++) s+=C(i)*C(n-1-i); return s;} int main(){ long long n; if(!(cin>>n)) return 0; cout<<C(n)<<"\n"; }`;
        const cppDp = `#include <bits/stdc++.h>\nusing namespace std; long long C[40]; int main(){ long long n; if(!(cin>>n)) return 0; C[0]=C[1]=1; for(int i=2;i<=n;i++){ C[i]=0; for(int j=0;j<i;j++) C[i]+=C[j]*C[i-1-j]; } cout<<C[n]<<"\n"; }`;

        const pyRec = `import sys\nsys.setrecursionlimit(10000)\nfrom functools import lru_cache\n@lru_cache(None)\ndef C(n):\n    if n<=1: return 1\n    return sum(C(i)*C(n-1-i) for i in range(n))\nprint(C(int(sys.stdin.readline().strip() or 0)))`;
        const pyDp = `import sys\nN=int(sys.stdin.readline().strip() or 0)\nC=[0]* (N+2)\nC[0]=1\nif N>=1: C[1]=1\nfor i in range(2,N+1):\n    s=0\n    for j in range(i):\n        s+=C[j]*C[i-1-j]\n    C[i]=s\nprint(C[N])`;

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
