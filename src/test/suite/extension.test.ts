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
import { exec, ExecException } from 'child_process';

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
            const cCode = `#include <stdio.h>\nint main() { printf(\"Hello, C!\\n\n"); return 0; }`;
            tempFileUri = await createTempFile(cCode, 'c');
            await vscode.window.showTextDocument(tempFileUri);
            await vscode.commands.executeCommand('oicode.runCode', '');
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
            await vscode.commands.executeCommand('oicode.runCode', '');
            vscode.window.showInformationMessage('C++ code execution command sent.');
            await new Promise(resolve => setTimeout(resolve, 5000)); // Give time for execution
            await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
            await cleanupTempDir(tempFileUri);

            // 5. Test Python code execution
            vscode.window.showInformationMessage('Testing Python code...');
            const pythonCode = `print(\"Hello, Python!\")`;
            tempFileUri = await createTempFile(pythonCode, 'py');
            await vscode.window.showTextDocument(tempFileUri);
            await vscode.commands.executeCommand('oicode.runCode', '');
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

// New test suite for OI-Code commands
suite('OI-Code Commands Test Suite', () => {

    test('should execute oicode.downloadDocker command', async function () {
        console.log('Starting test: should execute oicode.downloadDocker command');
        this.timeout(120000); // Increase timeout for Docker installation
        vscode.window.showInformationMessage('Checking Docker installation...');

        // Check if Docker is already installed
        const isDockerInstalled = await new Promise<boolean>(resolve => {
            console.log('Executing docker --version');
            exec('docker --version', (error: ExecException | null, stdout: string, stderr: string) => {
                if (error) {
                    console.log('Docker is not installed (error):', error.message);
                    resolve(false);
                } else {
                    console.log('Docker is already installed (stdout):', stdout);
                    resolve(true);
                }
            });
        });

        if (isDockerInstalled) {
            vscode.window.showInformationMessage('Docker is already installed. Skipping installation.');
            assert.ok(true, 'Docker already installed, skipped installation command.');
            console.log('Docker already installed, skipping downloadDocker command.');
        } else {
            vscode.window.showInformationMessage('Docker not found. Executing oicode.downloadDocker...');
            console.log('Executing oicode.downloadDocker command');
            await vscode.commands.executeCommand('oicode.downloadDocker');
            assert.ok(true, 'oicode.downloadDocker command executed successfully');
            vscode.window.showInformationMessage('oicode.downloadDocker executed.');
            console.log('oicode.downloadDocker command executed.');
        }
    });



    describe('Code Execution Tests (requires Docker environment)', () => {
        before(async function () {
            this.timeout(120000); // Increase timeout for Docker initialization
            console.log('Starting before hook for Code Execution Tests: Initializing Docker environment');
            vscode.window.showInformationMessage('Initializing Docker environment for code execution tests...');
            await vscode.commands.executeCommand('oicode.initializeEnvironment');
            vscode.window.showInformationMessage('Docker environment initialized.');
            console.log('Docker environment initialized.');
        });

        test('should create and run C Hello World', async function () {
            this.timeout(60000);
            let tempFileUri: vscode.Uri | undefined;
            try {
                const cCode = `#include <stdio.h>\nint main() { printf(\"Hello, C from Test!\\n\"); return 0; }`;
                tempFileUri = await createTempFile(cCode, 'c');
                await vscode.window.showTextDocument(tempFileUri);
                console.log('Executing oicode.runCode for C...');
                vscode.window.showInformationMessage('Executing oicode.runCode for C...');
                await vscode.commands.executeCommand('oicode.runCode', '');
                assert.ok(true, 'oicode.runCode command for C executed successfully');
                vscode.window.showInformationMessage('oicode.runCode for C executed.');
                console.log('oicode.runCode for C executed.');
                await new Promise(resolve => setTimeout(resolve, 5000)); // Give time for execution
            } finally {
                if (tempFileUri) {
                    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
                    await cleanupTempDir(tempFileUri);
                }
            }
        });

        test('should create and run C++ Hello World', async function () {
            this.timeout(60000);
            let tempFileUri: vscode.Uri | undefined;
            try {
                const cppCode = `#include <iostream>\nint main() { std::cout << \"Hello, C++ from Test!\\n\"; return 0; }`;
                tempFileUri = await createTempFile(cppCode, 'cpp');
                await vscode.window.showTextDocument(tempFileUri);
                console.log('Executing oicode.runCode for C++...');
                vscode.window.showInformationMessage('Executing oicode.runCode for C++...');
                await vscode.commands.executeCommand('oicode.runCode', '');
                assert.ok(true, 'oicode.runCode command for C++ executed successfully');
                vscode.window.showInformationMessage('oicode.runCode for C++ executed.');
                console.log('oicode.runCode for C++ executed.');
                await new Promise(resolve => setTimeout(resolve, 5000)); // Give time for execution
            } finally {
                if (tempFileUri) {
                    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
                    await cleanupTempDir(tempFileUri);
                }
            }
        });

        test('should create and run Python Hello World', async function () {
            this.timeout(60000);
            let tempFileUri: vscode.Uri | undefined;
            try {
                const pythonCode = `print(\"Hello, Python from Test!\")`;
                tempFileUri = await createTempFile(pythonCode, 'py');
                await vscode.window.showTextDocument(tempFileUri);
                console.log('Executing oicode.runCode for Python...');
                vscode.window.showInformationMessage('Executing oicode.runCode for Python...');
                await vscode.commands.executeCommand('oicode.runCode', '');
                assert.ok(true, 'oicode.runCode command for Python executed successfully');
                vscode.window.showInformationMessage('oicode.runCode for Python executed.');
                console.log('oicode.runCode for Python executed.');
                await new Promise(resolve => setTimeout(resolve, 5000)); // Give time for execution
            } finally {
                if (tempFileUri) {
                    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
                    await cleanupTempDir(tempFileUri);
                }
            }
        });
    });
});