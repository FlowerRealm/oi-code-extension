/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';

suite('Extension Test Suite', () => {
    vscode.window.showInformationMessage('Start all tests.');

    // Helper to set VS Code configuration for tests
    async function setConfiguration(section: string, value: any) {
        const config = vscode.workspace.getConfiguration();
        await config.update(section, value, vscode.ConfigurationTarget.Global);
    }

    // Helper to create a temporary file
    async function createTempFile(content: string, extension: string): Promise<vscode.Uri> {
        const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'oicode-test-'));
        const filePath = path.join(tempDir, `testfile.${extension}`);
        await fs.writeFile(filePath, content);
        return vscode.Uri.file(filePath);
    }

    // Helper to clean up temporary directory
    async function cleanupTempDir(uri: vscode.Uri) {
        const dir = path.dirname(uri.fsPath);
        await fs.rm(dir, { recursive: true, force: true });
    }

    test('showSettingsPage command should create a webview panel', async () => {
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
        await vscode.commands.executeCommand('oicode.initializeDocker');
        vscode.window.showInformationMessage('Docker initialized.');

        // 2. Set up compiler configurations for the test
        vscode.window.showInformationMessage('Setting up compiler configurations...');
        await setConfiguration('oi-code.language.c.Command', 'gcc');
        await setConfiguration('oi-code.language.c.Args', ['/sandbox/testfile.c', '-o', '/tmp/a.out']);
        await setConfiguration('oi-code.language.cpp.Command', 'g++');
        await setConfiguration('oi-code.language.cpp.Args', ['/sandbox/testfile.cpp', '-o', '/tmp/a.out', '-std=c++17']);
        await setConfiguration('oi-code.language.python.Command', 'python3');
        await setConfiguration('oi-code.language.python.Args', ['/sandbox/testfile.py']);
        vscode.window.showInformationMessage('Compiler configurations set.');

        let tempFileUri: vscode.Uri | undefined;

        try {
            // 3. Test C code execution
            vscode.window.showInformationMessage('Testing C code...');
            const cCode = `#include <stdio.h>\nint main() { printf(\"Hello, C!\\n\"); return 0; }`;
            tempFileUri = await createTempFile(cCode, 'c');
            await vscode.window.showTextDocument(tempFileUri);
            await vscode.commands.executeCommand('oicode.runCode');
            // For now, we can only assert that the command ran without error.
            // A more robust test would capture and assert the output in the webview panel.
            vscode.window.showInformationMessage('C code execution command sent.');
            await new Promise(resolve => setTimeout(resolve, 5000)); // Give time for execution
            await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
            await cleanupTempDir(tempFileUri);

            // 4. Test C++ code execution
            vscode.window.showInformationMessage('Testing C++ code...');
            const cppCode = `#include <iostream>\nint main() { std::cout << \"Hello, C++!\\n\"; return 0; }`;
            tempFileUri = await createTempFile(cppCode, 'cpp');
            await vscode.window.showTextDocument(tempFileUri);
            await vscode.commands.executeCommand('oicode.runCode');
            vscode.window.showInformationMessage('C++ code execution command sent.');
            await new Promise(resolve => setTimeout(resolve, 5000)); // Give time for execution
            await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
            await cleanupTempDir(tempFileUri);

            // 5. Test Python code execution
            vscode.window.showInformationMessage('Testing Python code...');
            const pythonCode = `print(\"Hello, Python!\")`;
            tempFileUri = await createTempFile(pythonCode, 'py');
            await vscode.window.showTextDocument(tempFileUri);
            await vscode.commands.executeCommand('oicode.runCode');
            vscode.window.showInformationMessage('Python code execution command sent.');
            await new Promise(resolve => setTimeout(resolve, 5000)); // Give time for execution
            await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
            await cleanupTempDir(tempFileUri);

        } catch (error) {
            vscode.window.showErrorMessage(`Test failed: ${error}`);
            if (tempFileUri) {
                await cleanupTempDir(tempFileUri);
            }
            assert.fail(`Test failed: ${error}`);
        }
    });
});
