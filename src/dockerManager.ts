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

const IMAGE_NAME = 'oi-runner:stable';

/**
 * Manages the Docker environment, including building the image, running containers,
 * and monitoring submissions for the OI extension.
 */
export class DockerManager {

    /**
     * Ensures the 'oi-runner:stable' Docker image exists, building it if necessary.
     * It will show progress in a VS Code terminal.
     * @returns A promise that resolves when the image is confirmed to be ready.
     */
    public static async ensureImage(projectRootPath: string): Promise<void> {
        // Check if image already exists
        if (await this.checkImageExists()) {
            console.log(`Docker image '${IMAGE_NAME}' already exists.`);
            return;
        }

        // Try silent installation/startup if Docker is not available
        try {
            await Installer.ensureDockerAvailableSilently();
        } catch (error) {
            console.log('Silent Docker installation failed, proceeding with manual flow');
        }

        // Check again after installation attempt
        if (await this.checkImageExists()) {
            console.log(`Docker image '${IMAGE_NAME}' found after installation.`);
            return;
        }

        // Build image if not found
        await this.buildImage(projectRootPath);
    }

    private static async checkImageExists(): Promise<boolean> {
        return new Promise<boolean>((resolve) => {
            const check = spawn('docker', ['image', 'inspect', IMAGE_NAME], { stdio: 'ignore' });
            check.on('close', (code) => {
                resolve(code === 0);
            });
            check.on('error', () => {
                resolve(false);
            });
        });
    }

    private static async buildImage(projectRootPath: string): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            console.log(`Docker image '${IMAGE_NAME}' not found. Proceeding with build.`);
            vscode.window.showInformationMessage(`Building Docker image '${IMAGE_NAME}'. This may take a few minutes...`);

            try {
                const outputChannel = vscode.window.createOutputChannel('OI-Code Docker Build');
                outputChannel.show();
                outputChannel.appendLine(`Starting build for ${IMAGE_NAME}...\n`);

                const buildProcess = spawn('docker', ['build', '-t', IMAGE_NAME, '-f', path.join(projectRootPath, 'Dockerfile'), '.'], { cwd: projectRootPath });

                buildProcess.stdout.on('data', data => outputChannel.append(data.toString()));
                buildProcess.stderr.on('data', data => outputChannel.append(data.toString()));

                buildProcess.on('close', (buildCode) => {
                    if (buildCode === 0) {
                        outputChannel.appendLine(`\nSuccessfully built image '${IMAGE_NAME}'.`);
                        resolve();
                    } else {
                        const errorMsg = `Failed to build Docker image. Exit code: ${buildCode}. Check output channel for details.`;
                        outputChannel.appendLine(`\nERROR: ${errorMsg}`);
                        reject(new Error(errorMsg));
                    }
                });

                buildProcess.on('error', (err) => {
                    const errorMsg = `Failed to start Docker build: ${err.message}`;
                    outputChannel.appendLine(`\nERROR: ${errorMsg}`);
                    reject(new Error(errorMsg));
                });
            } catch (e) {
                reject(e as any);
            }
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
        projectRootPath: string; // New: Project root path for ensureImage
        sourceDir: string;      // Directory containing source code, mounted read-only at /sandbox
        command: string;        // The full shell command to execute inside the container
        input: string;
        timeLimit: number;      // in seconds, for soft timeout
        memoryLimit: number;    // in megabytes
    }): Promise<{ output: string; error: string; timedOut: boolean; memoryExceeded: boolean; spaceExceeded: boolean }> {
        // Ensure the image is ready before running.
        await this.ensureImage(options.projectRootPath);

        const { sourceDir, command, input, memoryLimit } = options;

        const image = this.selectImageForCommand(command);

        // Create a writable dir under user's home to avoid Docker Desktop file-sharing issues
        const sharedBaseDir = path.join(os.homedir(), '.oi-code-tests', 'tmp');
        await fs.mkdir(sharedBaseDir, { recursive: true });
        const tempDir = await fs.mkdtemp(path.join(sharedBaseDir, 'oi-run-'));
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
            }, (options.timeLimit + 1) * 1000);

            dockerProcess.on('close', async (code) => {
                clearTimeout(killTimer);
                await fs.rm(tempDir, { recursive: true, force: true }); // Cleanup
                const memoryExceeded = code === 137 || /Out of memory|Killed process/m.test(stderr);
                const spaceExceeded = /No space left on device|disk quota exceeded/i.test(stderr);
                resolve({ output: stdout, error: stderr, timedOut, memoryExceeded, spaceExceeded });
                outputChannel.appendLine(`[DockerManager] exit code=${code}`);
            });

            dockerProcess.on('error', async (err) => {
                clearTimeout(killTimer);
                await fs.rm(tempDir, { recursive: true, force: true }); // Cleanup
                resolve({ output: '', error: `Failed to start Docker: ${err.message}`, timedOut: false, memoryExceeded: false, spaceExceeded: false });
                outputChannel.appendLine(`[DockerManager] error: ${err.message}`);
            });

            // Provide input to the process
            if (input) {
                dockerProcess.stdin.write(input);
            }
            dockerProcess.stdin.end();
        });
    }

    private static selectImageForCommand(command: string): string {
        const cmd = command.toLowerCase();
        if (cmd.includes('python')) return 'python:3.11';
        if (cmd.includes('g++') || cmd.includes('gcc')) return 'gcc:13';
        return 'ubuntu:24.04';
    }
}
