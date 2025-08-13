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
        return new Promise<void>((resolve, reject) => {
            const check = spawn('docker', ['image', 'inspect', IMAGE_NAME], { stdio: 'ignore' });

            check.on('close', async (code) => {
                if (code === 0) {
                    console.log(`Docker image '${IMAGE_NAME}' already exists.`);
                    return resolve();
                }

                // Skip building custom image in transparent mode; we'll use official images per language
                console.log(`Docker image '${IMAGE_NAME}' not found. Using official language images dynamically.`);
                resolve();
            });

            check.on('error', async (err) => {
                // Try silent installation / startup
                try {
                    await Installer.ensureDockerAvailableSilently();
                    // Retry check
                    const recheck = spawn('docker', ['image', 'inspect', IMAGE_NAME], { stdio: 'ignore' });
                    recheck.on('close', async (code2) => {
                        if (code2 === 0) { resolve(); } else {
                            // Fall back to build path
                            console.log(`Docker running after install. Proceeding with build.`);
                            // Trigger close handler path by simulating not found image
                            const notFound = spawn('bash', ['-lc', 'false']);
                            notFound.on('close', () => {
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
                                        if (buildCode === 0) { resolve(); }
                                        else { reject(new Error('Failed to build Docker image.')); }
                                    });
                                } catch (e) { reject(e as any); }
                            });
                        }
                    });
                    return;
                } catch { }

                // Fallback: original guided flow
                const installCommand = Installer.getInstallCommand();
                let errorMessage = `Failed to run 'docker'. Is Docker installed and running? Error: ${err.message}`;
                if (installCommand) {
                    errorMessage += `\n\n${installCommand.message}`;
                    vscode.window.showErrorMessage(errorMessage, 'Run in Terminal').then(selection => {
                        if (selection === 'Run in Terminal') {
                            const terminal = vscode.window.createTerminal('Docker Installer');
                            terminal.show();
                            if (installCommand.isUrl) {
                                vscode.env.openExternal(vscode.Uri.parse(installCommand.command));
                                terminal.sendText(`echo "Opening browser to: ${installCommand.command}"`);
                            } else {
                                terminal.sendText(installCommand.command);
                            }
                        }
                    });
                } else {
                    vscode.window.showErrorMessage(errorMessage);
                }
                console.error(errorMessage);
                reject(new Error(errorMessage));
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

        return new Promise((resolve) => {
            console.log(`[DockerManager] docker ${args.join(' ')}`);
            const dockerProcess = spawn('docker', args);

            let stdout = '';
            let stderr = '';
            let timedOut = false;

            dockerProcess.stdout.on('data', (data) => {
                const text = data.toString();
                stdout += text;
                console.log(`[docker stdout] ${text.trimEnd()}`);
            });
            dockerProcess.stderr.on('data', (data) => {
                const text = data.toString();
                stderr += text;
                console.error(`[docker stderr] ${text.trimEnd()}`);
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
                console.log(`[DockerManager] exit code=${code}`);
            });

            dockerProcess.on('error', async (err) => {
                clearTimeout(killTimer);
                await fs.rm(tempDir, { recursive: true, force: true }); // Cleanup
                resolve({ output: '', error: `Failed to start Docker: ${err.message}`, timedOut: false, memoryExceeded: false, spaceExceeded: false });
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
