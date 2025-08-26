/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


import { spawn } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import * as vscode from 'vscode';



import { Installer, InstallCommand } from './docker/install';
import { OI_CODE_TEST_TMP_PATH } from './constants';

/**
 * Manages the Docker environment, including building the image, running containers,
 * and monitoring submissions for the OI extension.
 */
export class DockerManager {

    /**
     * Ensures Docker is available and ready for use.
     * It will show progress in a VS Code terminal.
     * @returns A promise that resolves when Docker is ready.
     */
    public static async ensureDockerIsReady(projectRootPath: string): Promise<void> {
        // Check if Docker is available
        try {
            await Installer.ensureDockerAvailableSilently();
        } catch (error) {
            console.log('Silent Docker installation failed, proceeding with manual flow');
        }

        // Verify Docker is working
        const isDockerWorking = await this.checkDockerWorking();
        if (!isDockerWorking) {
            throw new Error('Docker is not available or not working properly');
        }
    }

    private static async checkDockerWorking(): Promise<boolean> {
        return new Promise<boolean>((resolve) => {
            const check = spawn('docker', ['info'], { stdio: 'ignore' });
            check.on('close', (code) => {
                resolve(code === 0);
            });
            check.on('error', () => {
                resolve(false);
            });
        });
    }

    /**
     * Compiles and runs the user's code in a controlled Docker container.
     * @param options - The options for the execution.
     */
    /**
     * Compiles and runs the user's code in a controlled Docker container.
     * @param options The options for the execution.
     * @returns A promise that resolves with the execution result.
     */
    /**
     * Runs a command in a controlled Docker container.
     * This method is language-agnostic and executes a provided shell command.
     * @param options The options for the execution, including the command to run.
     * @returns A promise that resolves with the execution result.
     */
    public static async run(options: {
        sourceDir: string;
        command: string;
        input: string;
        memoryLimit: string;
        projectRootPath: string;
        languageId: string;
        timeLimit: number;
    }): Promise<{
        stdout: string;
        stderr: string;
        timedOut: boolean;
        memoryExceeded: boolean;
        spaceExceeded: boolean;
    }> {
        // Ensure Docker is available
        await this.ensureDockerIsReady(options.projectRootPath);

        const { sourceDir, command, input, memoryLimit, languageId, timeLimit } = options;

        // Create a temporary directory on the host for writable output (e.g., compiled binary)
        await fs.mkdir(OI_CODE_TEST_TMP_PATH, { recursive: true });
        const tempDir = await fs.mkdtemp(path.join(OI_CODE_TEST_TMP_PATH, 'oi-run-'));
        const image = this.selectImageForCommand(languageId);

        const containerName = `oi-task-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

        const args = [
            'run', '--rm', '-i',
            '--name', containerName,
            '--network=none',
            '--read-only',
            `--memory=${memoryLimit}m`,
            `--memory-swap=${memoryLimit}m`,
            '--cpus=1.0',
            '--pids-limit=64',
            '-v', `${sourceDir}:/sandbox:ro`,
            '-v', `${tempDir}:/tmp:rw`, // Mount a writable temp dir for output
            image,
            'bash', '-c', command
        ];

        const outputChannel = vscode.window.createOutputChannel('OI-Code Docker');
        outputChannel.show(true);
        return new Promise((resolve) => {
            outputChannel.appendLine(`[DockerManager] docker ${args.join(' ')}`);
            const dockerProcess = spawn('docker', args);

            let stdout = '';
            let stderr = '';
            let timedOut = false;

            dockerProcess.stdout.on('data', (data) => {
                const text = data.toString();
                stdout += text;
                outputChannel.appendLine(`[docker stdout] ${text.trimEnd()}`);
            });
            dockerProcess.stderr.on('data', (data) => {
                const text = data.toString();
                stderr += text;
                outputChannel.appendLine(`[docker stderr] ${text.trimEnd()}`);
            });

            // Hard timeout: kill container if timeLimit exceeded
            const killTimer = setTimeout(() => {
                console.warn(`[DockerManager] Timeout exceeded, killing container ${containerName}`);
                spawn('docker', ['kill', containerName]).on('close', () => { /* noop */ });
                timedOut = true;
            }, (timeLimit + 1) * 1000);

            dockerProcess.on('close', async (code) => {
                clearTimeout(killTimer);
                await fs.rm(tempDir, { recursive: true, force: true }); // Cleanup
                const memoryExceeded = code === 137 || /Out of memory|Killed process/m.test(stderr);
                const spaceExceeded = /No space left on device|disk quota exceeded/i.test(stderr);
                resolve({ stdout, stderr, timedOut, memoryExceeded, spaceExceeded });
                outputChannel.appendLine(`[DockerManager] exit code=${code}`);
            });

            dockerProcess.on('error', async (err) => {
                clearTimeout(killTimer);
                await fs.rm(tempDir, { recursive: true, force: true }); // Cleanup
                resolve({ stdout: '', stderr: `Failed to start Docker: ${err.message}`, timedOut: false, memoryExceeded: false, spaceExceeded: false });
                outputChannel.appendLine(`[DockerManager] error: ${err.message}`);
            });

            // Provide input to the process
            if (input) {
                dockerProcess.stdin.write(input);
            }
            dockerProcess.stdin.end();
        });
    }

    private static selectImageForCommand(languageId: string): string {
        switch (languageId.toLowerCase()) {
            case 'python':
                return 'python:3.11';
            case 'cpp':
            case 'c++':
                return 'gcc:13';
            case 'c':
                return 'gcc:13';
            default:
                return 'ubuntu:24.04';
        }
    }
}
