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

                console.log(`Docker image '${IMAGE_NAME}' not found. Proceeding with build.`);
                vscode.window.showInformationMessage(`Building Docker image '${IMAGE_NAME}'. This may take a few minutes...`);

                try {
                    const outputChannel = vscode.window.createOutputChannel('OI-Code Docker Build');
                    outputChannel.show();
                    outputChannel.appendLine(`Starting build for ${IMAGE_NAME} from ${path.join(projectRootPath, 'Dockerfile')}...\n`);

                    const buildProcess = spawn('docker', ['build', '-t', IMAGE_NAME, '-f', path.join(projectRootPath, 'Dockerfile'), '.'], { cwd: projectRootPath });

                    buildProcess.stdout.on('data', data => outputChannel.append(data.toString()));
                    buildProcess.stderr.on('data', data => outputChannel.append(data.toString()));

                    buildProcess.on('close', async (buildCode) => {
                        if (buildCode === 0) {
                            vscode.window.showInformationMessage(`Successfully built '${IMAGE_NAME}'.`);
                            outputChannel.appendLine(`\nSuccessfully built image '${IMAGE_NAME}'.`);
                            resolve();
                        } else {
                            const errorMsg = `Failed to build Docker image. Exit code: ${buildCode}. Check output channel for details.`;
                            vscode.window.showErrorMessage(errorMsg);
                            outputChannel.appendLine(`\nERROR: ${errorMsg}`);
                            reject(new Error(errorMsg));
                        }
                    });

                    buildProcess.on('error', (err) => {
                        vscode.window.showErrorMessage(`Failed to start Docker build process: ${err.message}`);
                        reject(err);
                    });

                } catch (err: any) {
                    const errorMsg = `An error occurred while preparing the Docker build: ${err.message}`;
                    vscode.window.showErrorMessage(errorMsg);
                    console.error(errorMsg);
                    reject(new Error(errorMsg));
                }
            });

            check.on('error', (err) => {
                const installCommand = Installer.getInstallCommand();
                let errorMessage = `Failed to run 'docker'. Is Docker installed and running? Error: ${err.message}`;

                if (installCommand) {
                    errorMessage += `\n\n${installCommand.message}`;
                    vscode.window.showErrorMessage(
                        errorMessage,
                        'Run in Terminal' // Button text
                    ).then(selection => {
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
    }): Promise<{ verdict: string; output: string; error: string }> {
        // Ensure the image is ready before running.
        await this.ensureImage(options.projectRootPath);

        const { sourceDir, command, input, memoryLimit } = options;

        // Create a temporary directory on the host for writable output (e.g., compiled binary)
        const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'oi-run-'));
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
            IMAGE_NAME,
            'bash', '-c', command
        ];

        return new Promise((resolve) => {
            const dockerProcess = spawn('docker', args);

            let stdout = '';
            let stderr = '';

            dockerProcess.stdout.on('data', (data) => stdout += data.toString());
            dockerProcess.stderr.on('data', (data) => stderr += data.toString());

            // TODO: Implement hard timeout with 'docker kill'
            // TODO: Implement real-time monitoring with 'docker stats' for MLE detection

            dockerProcess.on('close', async (code) => {
                await fs.rm(tempDir, { recursive: true, force: true }); // Cleanup

                if (stderr.includes('command not found')) {
                    resolve({ verdict: 'COMPILE_ERROR', output: stdout, error: stderr });
                } else if (code === 124) {
                    resolve({ verdict: 'TLE', output: stdout, error: stderr });
                } else if (code !== 0) {
                    resolve({ verdict: 'RE', output: stdout, error: stderr });
                } else {
                    resolve({ verdict: 'AC', output: stdout, error: stderr });
                }
            });

            dockerProcess.on('error', async (err) => {
                await fs.rm(tempDir, { recursive: true, force: true }); // Cleanup
                resolve({ verdict: 'SYSTEM_ERROR', output: '', error: `Failed to start Docker: ${err.message}` });
            });

            // Provide input to the process
            if (input) {
                dockerProcess.stdin.write(input);
            }
            dockerProcess.stdin.end();
        });
    }
}
