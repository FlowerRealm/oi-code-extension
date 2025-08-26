"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DockerManager = void 0;
const child_process_1 = require("child_process");
const fs = __importStar(require("fs/promises"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const vscode = __importStar(require("vscode"));
const install_1 = require("./docker/install");
const IMAGE_NAME = 'oi-runner:stable';
/**
 * Manages the Docker environment, including building the image, running containers,
 * and monitoring submissions for the OI extension.
 */
class DockerManager {
    /**
     * Ensures the 'oi-runner:stable' Docker image exists, building it if necessary.
     * It will show progress in a VS Code terminal.
     * @returns A promise that resolves when the image is confirmed to be ready.
     */
    static ensureImage(projectRootPath) {
        return __awaiter(this, void 0, void 0, function* () {
            return new Promise((resolve, reject) => {
                const check = (0, child_process_1.spawn)('docker', ['image', 'inspect', IMAGE_NAME], { stdio: 'ignore' });
                check.on('close', (code) => __awaiter(this, void 0, void 0, function* () {
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
                        const buildProcess = (0, child_process_1.spawn)('docker', ['build', '-t', IMAGE_NAME, '-f', path.join(projectRootPath, 'Dockerfile'), '.'], { cwd: projectRootPath });
                        buildProcess.stdout.on('data', data => outputChannel.append(data.toString()));
                        buildProcess.stderr.on('data', data => outputChannel.append(data.toString()));
                        buildProcess.on('close', (buildCode) => __awaiter(this, void 0, void 0, function* () {
                            if (buildCode === 0) {
                                vscode.window.showInformationMessage(`Successfully built '${IMAGE_NAME}'.`);
                                outputChannel.appendLine(`\nSuccessfully built image '${IMAGE_NAME}'.`);
                                resolve();
                            }
                            else {
                                const errorMsg = `Failed to build Docker image. Exit code: ${buildCode}. Check output channel for details.`;
                                vscode.window.showErrorMessage(errorMsg);
                                outputChannel.appendLine(`\nERROR: ${errorMsg}`);
                                reject(new Error(errorMsg));
                            }
                        }));
                        buildProcess.on('error', (err) => {
                            vscode.window.showErrorMessage(`Failed to start Docker build process: ${err.message}`);
                            reject(err);
                        });
                    }
                    catch (err) {
                        const errorMsg = `An error occurred while preparing the Docker build: ${err.message}`;
                        vscode.window.showErrorMessage(errorMsg);
                        console.error(errorMsg);
                        reject(new Error(errorMsg));
                    }
                }));
                check.on('error', (err) => {
                    const installCommand = install_1.Installer.getInstallCommand();
                    let errorMessage = `Failed to run 'docker'. Is Docker installed and running? Error: ${err.message}`;
                    if (installCommand) {
                        errorMessage += `\n\n${installCommand.message}`;
                        vscode.window.showErrorMessage(errorMessage, 'Run in Terminal' // Button text
                        ).then(selection => {
                            if (selection === 'Run in Terminal') {
                                const terminal = vscode.window.createTerminal('Docker Installer');
                                terminal.show();
                                if (installCommand.isUrl) {
                                    vscode.env.openExternal(vscode.Uri.parse(installCommand.command));
                                    terminal.sendText(`echo "Opening browser to: ${installCommand.command}"`);
                                }
                                else {
                                    terminal.sendText(installCommand.command);
                                }
                            }
                        });
                    }
                    else {
                        vscode.window.showErrorMessage(errorMessage);
                    }
                    console.error(errorMessage);
                    reject(new Error(errorMessage));
                });
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
    static run(options) {
        return __awaiter(this, void 0, void 0, function* () {
            // Ensure the image is ready before running.
            yield this.ensureImage(options.projectRootPath);
            const { sourceDir, command, input, memoryLimit } = options;
            // Create a temporary directory on the host for writable output (e.g., compiled binary)
            const tempDir = yield fs.mkdtemp(path.join(os.tmpdir(), 'oi-run-'));
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
                const dockerProcess = (0, child_process_1.spawn)('docker', args);
                let stdout = '';
                let stderr = '';
                dockerProcess.stdout.on('data', (data) => stdout += data.toString());
                dockerProcess.stderr.on('data', (data) => stderr += data.toString());
                // TODO: Implement hard timeout with 'docker kill'
                // TODO: Implement real-time monitoring with 'docker stats' for MLE detection
                dockerProcess.on('close', (code) => __awaiter(this, void 0, void 0, function* () {
                    yield fs.rm(tempDir, { recursive: true, force: true }); // Cleanup
                    if (stderr.includes('command not found')) {
                        resolve({ verdict: 'COMPILE_ERROR', output: stdout, error: stderr });
                    }
                    else if (code === 124) {
                        resolve({ verdict: 'TLE', output: stdout, error: stderr });
                    }
                    else if (code !== 0) {
                        resolve({ verdict: 'RE', output: stdout, error: stderr });
                    }
                    else {
                        resolve({ verdict: 'AC', output: stdout, error: stderr });
                    }
                }));
                dockerProcess.on('error', (err) => __awaiter(this, void 0, void 0, function* () {
                    yield fs.rm(tempDir, { recursive: true, force: true }); // Cleanup
                    resolve({ verdict: 'SYSTEM_ERROR', output: '', error: `Failed to start Docker: ${err.message}` });
                }));
                // Provide input to the process
                if (input) {
                    dockerProcess.stdin.write(input);
                }
                dockerProcess.stdin.end();
            });
        });
    }
}
exports.DockerManager = DockerManager;
//# sourceMappingURL=dockerManager.js.map