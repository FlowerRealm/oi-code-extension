/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


import { spawn } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import * as vscode from 'vscode';

import { Installer } from './docker/install';
import { OI_CODE_TEST_TMP_PATH } from './constants';

// Docker inspect output interface definitions
interface DockerMount {
    Type: string;
    Source: string;
    Destination: string;
    Mode?: string;
    RW?: boolean;
    Propagation?: string;
}

interface DockerContainerState {
    Status: string;
    Running: boolean;
    Paused: boolean;
    Restarting: boolean;
    OOMKilled: boolean;
    Dead: boolean;
    Pid?: number;
    ExitCode?: number;
    Error?: string;
    StartedAt: string;
    FinishedAt: string;
}

interface DockerContainerConfig {
    Image: string;
    Labels: Record<string, string>;
    Env?: string[];
    Cmd?: string[];
    WorkingDir?: string;
}

interface DockerContainerInfo {
    Id: string;
    Name: string;
    Image: string;
    State: DockerContainerState;
    Config: DockerContainerConfig;
    Mounts: DockerMount[];
    NetworkSettings?: {
        Networks?: Record<string, any>;
    };
}

// Container pool management interfaces
interface DockerContainer {
    containerId: string;
    languageId: string;
    image: string;
    isReady: boolean;
    lastUsed: number;
    hasCacheMount?: boolean;
}

interface ContainerPool {
    containers: Map<string, DockerContainer>;
    isActive: boolean;
}

// Container pool configuration
const CONTAINER_POOL_CONFIG = {
    maxIdleTime: 30 * 60 * 1000, // Auto cleanup after 30 minutes of inactivity
    healthCheckInterval: 5 * 60 * 1000, // Health check every 5 minutes
    supportedLanguages: ['c', 'cpp'] as const,
};

/**
 * Docker Manager - handles Docker environment setup, container execution,
 * and resource management for the OI extension.
 */
export class DockerManager {
    // Extension context for getting path reliably
    private static extensionContext: vscode.ExtensionContext | null = null;

    // Static getter for extension path
    private static get extensionPath(): string {
        if (!this.extensionContext) {
            throw new Error('DockerManager not initialized with extension context');
        }
        return this.extensionContext.extensionPath;
    }

    /**
     * Initialize DockerManager with extension context
     */
    public static initialize(context: vscode.ExtensionContext): void {
        this.extensionContext = context;
        console.log('[DockerManager] Initialized with extension path:', this.extensionPath);
    }

    // Container pool instance
    public static containerPool: ContainerPool = {
        containers: new Map(),
        isActive: false
    };

    // Health check timer
    private static healthCheckTimer: NodeJS.Timeout | null = null;

    // Global lock for Docker operations to prevent race conditions
    private static dockerOperationLocks = new Map<string, Promise<void>>();
    private static imagePullProgress = new Map<string, boolean>();

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
            vscode.window.showWarningMessage(
                'Docker installation failed. Please check the output logs for details and manually install Docker if needed.',
                'View Output'
            ).then(selection => {
                if (selection === 'View Output') {
                    vscode.commands.executeCommand('workbench.action.outputChannel.toggle', 'OI-Code Docker Install');
                }
            });
        }

        // Verify Docker is working
        const isDockerWorking = await this.checkDockerWorking();
        if (!isDockerWorking) {
            throw new Error('Docker is not available or not working properly');
        }

        // Wait for crucial images to be available
        await this.ensureCriticalImagesAreAvailable();
    }

    /**
     * Ensure critical Docker images are available and pulled
     */
    private static async ensureCriticalImagesAreAvailable(): Promise<void> {
        const criticalImages = ['flowerrealm/oi-code-clang:latest'];

        console.log('[DockerManager] Checking critical Docker images...');

        for (const image of criticalImages) {
            // Delegate to unified image ensuring logic to avoid duplication
            await this.ensureClangImageExists(image, os.platform());
        }

        console.log('[DockerManager] All critical images are available');
    }

    /**
     * Check if image is available locally
     */
    private static async checkImageAvailableLocally(image: string): Promise<boolean> {
        return new Promise<boolean>((resolve) => {
            const inspectProcess = spawn('docker', ['inspect', image], { stdio: 'ignore' });
            inspectProcess.on('close', (code) => {
                resolve(code === 0);
            });
            inspectProcess.on('error', () => {
                resolve(false);
            });
        });
    }

    /**
     * Pull image with progress monitoring
     */
    private static async pullImageWithProgress(image: string): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            const outputChannel = vscode.window.createOutputChannel('OI-Code Docker Pull');
            outputChannel.show(true);
            outputChannel.appendLine(`[${new Date().toISOString()}] Pulling Docker image: ${image}`);

            const pullProcess = spawn('docker', ['pull', image], { stdio: 'pipe' });

            pullProcess.stdout.on('data', (data) => {
                const output = data.toString().trim();
                outputChannel.appendLine(`[Pull] ${output}`);
            });

            pullProcess.stderr.on('data', (data) => {
                const output = data.toString().trim();
                outputChannel.appendLine(`[Pull Error] ${output}`);
            });

            pullProcess.on('close', (code) => {
                if (code === 0) {
                    outputChannel.appendLine(`[${new Date().toISOString()}] Successfully pulled: ${image}`);
                    resolve();
                } else {
                    const error = new Error(`Failed to pull image ${image} with exit code ${code}`);
                    outputChannel.appendLine(`[${new Date().toISOString()}] Failed to pull: ${image}`);
                    reject(error);
                }
            });

            pullProcess.on('error', (error) => {
                outputChannel.appendLine(`[${new Date().toISOString()}] Error pulling ${image}: ${error.message}`);
                reject(error);
            });

            // Set timeout for pull operation
            setTimeout(() => {
                pullProcess.kill('SIGKILL');
                const timeoutError = new Error(`Pull operation for ${image} timed out after 15 minutes`);
                outputChannel.appendLine(`[${new Date().toISOString()}] Timeout: ${image}`);
                reject(timeoutError);
            }, 15 * 60 * 1000); // 15 minutes
        });
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

        // If container pool is active, use it first
        // Container pool containers can have dynamic memory limits
        if (this.containerPool.isActive) {
            try {
                return await this.runWithContainerPool(options);
            } catch (err) {
                console.warn(`[DockerManager] Running with container pool failed, falling back to non-pool mode: ${err}`);
                return this.runWithoutContainerPool(options);
            }
        }

        // Otherwise use the original implementation (including custom memory limits)
        return this.runWithoutContainerPool(options);
    }

    /**
     * Run command using container pool
     */
    private static async runWithContainerPool(options: {
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
        const { sourceDir, command, input, memoryLimit, languageId, timeLimit } = options;

        // Pool containers are pre-set to 512MB memory
        // If requested memory exceeds 512MB, use temporary container
        if (parseInt(memoryLimit) > 512) {
            console.log(`[DockerManager] Requested memory ${memoryLimit}MB exceeds pool limit (512MB), using temporary container`);
            return this.runWithoutContainerPool(options);
        }

        // For requests ≤512MB, use container pool
        // Actual program memory is limited via cgroup inside container
        console.log(`[DockerManager] Using container pool with 512MB container limit (program limit: ${memoryLimit}MB)`);

        // Get container for language
        const container = await this.getContainerForLanguage(languageId);

        try {
            // Use cache mount for efficient file synchronization
            const hasCacheMount = container.hasCacheMount ?? false;
            if (hasCacheMount) {
                // Efficient file sync: operate directly on host cache directory
                await this.syncFilesToCacheMount(sourceDir, languageId);
                console.log(`[DockerManager] Using cache mount for container ${container.containerId}`);
            } else {
                // Fallback to original file sync logic
                await this.copyFilesToContainer(sourceDir, container.containerId, false);
                console.log(`[DockerManager] Using direct copy for container ${container.containerId}`);
            }

            // Execute command using pipe format
            const outputChannel = vscode.window.createOutputChannel('OI-Code Docker');
            outputChannel.show(true);

            // Build pipe command - use safe parameter passing to avoid shell injection
            // Pass commands as array instead of string concatenation
            // Detect Windows containers and use appropriate shell
            const isWindowsContainer = container.image.includes('windows') || container.image.includes('nanoserver');
            const shellCmd = isWindowsContainer ? ['cmd', '/S', '/C'] : ['bash', '-c'];
            const dockerExecArgs = ['exec', '-i', container.containerId, ...shellCmd, `cd /tmp/source && ${command}`];
            const dockerProcess = spawn('docker', dockerExecArgs);

            let stdout = '';
            let stderr = '';
            let timedOut = false;

            dockerProcess.stdout.on('data', (data) => {
                const text = data.toString();
                stdout += text;
                outputChannel.appendLine(`[pipe stdout] ${text.trimEnd()}`);
            });

            dockerProcess.stderr.on('data', (data) => {
                const text = data.toString();
                stderr += text;
                outputChannel.appendLine(`[pipe stderr] ${text.trimEnd()}`);
            });

            // Pass input via stdin if provided
            if (input) {
                dockerProcess.stdin.write(input);
            }
            dockerProcess.stdin.end();

            // Hard timeout: kill process if time limit exceeded
            const killTimer = setTimeout(() => {
                console.warn(`[DockerManager] Timeout exceeded, killing process`);
                dockerProcess.kill('SIGTERM');
                timedOut = true;
            }, (timeLimit + 1) * 1000);

            return new Promise((resolve) => {
                dockerProcess.on('close', async (pipeCode) => {
                    clearTimeout(killTimer);

                    // Use pipe output directly, no additional retrieval needed
                    const memoryExceeded = !timedOut && (pipeCode === 137 || /Out of memory|Killed process/m.test(stderr));
                    const spaceExceeded = /No space left on device|disk quota exceeded/i.test(stderr);
                    resolve({ stdout, stderr, timedOut, memoryExceeded, spaceExceeded });
                    outputChannel.appendLine(`[DockerManager] pipe exit code=${pipeCode}`);
                });

                dockerProcess.on('error', async (err) => {
                    clearTimeout(killTimer);
                    resolve({ stdout: '', stderr: `Failed to execute pipe command: ${err.message}`, timedOut: false, memoryExceeded: false, spaceExceeded: false });
                    outputChannel.appendLine(`[DockerManager] pipe error: ${err.message}`);
                });
            });
        } catch (err) {
            throw err;
        }
    }

    /**
     * Force remove all oi-container containers
     */
    private static async forceRemoveOiContainers(): Promise<void> {
        try {
            // Find all oi-container containers by name
            const findProcess = spawn('docker', ['ps', '-a', '-q', '--filter', 'name=oi-container*']);
            let containerIds = '';

            findProcess.stdout.on('data', (data) => {
                containerIds += data.toString();
            });

            const findCode: number = await new Promise<number>((resolve) => {
                findProcess.on('close', resolve);
                findProcess.on('error', () => resolve(-1));
            });

            if (findCode !== 0) {
                console.warn(`[DockerManager] Failed to find oi-containers: ${findCode}`);
                return;
            }

            const ids = containerIds.trim().split('\n').filter(id => id);
            if (ids.length === 0) {
                console.log('[DockerManager] No oi-containers found to remove');
                return;
            }

            console.log(`[DockerManager] Force removing ${ids.length} oi-container(s)`);
            const rmProcess = spawn('docker', ['rm', '-f', ...ids]);
            const rmCode: number = await new Promise<number>((resolve) => {
                rmProcess.on('close', resolve);
                rmProcess.on('error', () => resolve(-1));
            });

            console.log(`[DockerManager] Force removed oi-containers with code: ${rmCode}`);
        } catch (error) {
            console.warn(`[DockerManager] Error force removing oi-containers: ${error}`);
        }
    }



    /**
     * Efficient file synchronization: operate directly on host cache directory
     */
    private static async syncFilesToCacheMount(sourceDir: string, languageId: string): Promise<void> {
        console.log(`[DockerManager] Syncing files from ${sourceDir} to cache mount for ${languageId}`);

        // Get cache directory path, create separate subdirectories for each language
        const homedir = os.homedir();
        const cacheDir = path.join(homedir, '.cache', 'oi-code', languageId);

        try {
            // Check if source directory exists
            await fs.access(sourceDir);

            // Ensure cache directory exists
            await fs.mkdir(cacheDir, { recursive: true });

            // Clear cache directory
            try {
                const entries = await fs.readdir(cacheDir);
                for (const entry of entries) {
                    await fs.rm(path.join(cacheDir, entry), { recursive: true, force: true });
                }
            } catch (error: any) {
                console.warn(`[DockerManager] Failed to clean cache directory: ${error}`);
                throw new Error(`Failed to clean cache directory: ${error}`);
            }

            // Copy files from source directory to cache directory
            await this.copyDirectoryRecursive(sourceDir, cacheDir);
            console.log(`[DockerManager] Files synced to cache mount successfully for ${languageId}`);
        } catch (error) {
            console.warn(`[DockerManager] Failed to sync files to cache mount: ${error}`);
            throw new Error(`Failed to sync files to cache mount: ${error}`);
        }
    }

    /**
     * Recursively copy directory
     */
    private static async copyDirectoryRecursive(source: string, destination: string): Promise<void> {
        const entries = await fs.readdir(source, { withFileTypes: true });

        for (const entry of entries) {
            const sourcePath = path.join(source, entry.name);
            const destPath = path.join(destination, entry.name);

            if (entry.isDirectory()) {
                await fs.mkdir(destPath, { recursive: true });
                await this.copyDirectoryRecursive(sourcePath, destPath);
            } else if (entry.isFile()) {
                await fs.copyFile(sourcePath, destPath);
            }
        }
    }

    /**
     * Copy files to container
     */
    private static async copyFilesToContainer(sourceDir: string, containerId: string, useCache: boolean = false): Promise<void> {
        const targetDescription = useCache ? '/tmp/source in container' : 'container';
        const logMessage = `[DockerManager] Copying files from ${sourceDir} to ${targetDescription} ${containerId}`;
        console.log(logMessage);

        return new Promise((resolve, reject) => {
            // First clean target directory
            const cleanProcess = spawn('docker', ['exec', containerId, 'bash', '-c', 'rm -rf /tmp/source/*']);
            cleanProcess.on('close', (cleanCode) => {
                if (cleanCode === 0) {
                    // Then copy source directory content to target directory
                    const cpProcess = spawn('docker', ['cp', `${sourceDir}/.`, `${containerId}:/tmp/source/`]);
                    cpProcess.on('close', (code) => {
                        if (code === 0) {
                            console.log(`[DockerManager] Files copied to ${targetDescription} successfully`);
                            resolve();
                        } else {
                            reject(new Error(`Failed to copy files to ${targetDescription}: ${code}`));
                        }
                    });
                    cpProcess.on('error', (err) => {
                        reject(new Error(`Failed to copy files to ${targetDescription}: ${err.message}`));
                    });
                } else {
                    reject(new Error(`Failed to clean ${targetDescription}: ${cleanCode}`));
                }
            });
            cleanProcess.on('error', (err) => {
                reject(new Error(`Failed to clean ${targetDescription}: ${err.message}`));
            });
        });
    }

    /**
     * Run without container pool (original implementation)
     */
    private static async runWithoutContainerPool(options: {
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
        const { sourceDir, command, input, memoryLimit, languageId, timeLimit } = options;

        // Create temporary directory for output
        await fs.mkdir(OI_CODE_TEST_TMP_PATH, { recursive: true });
        const tempDir = await fs.mkdtemp(path.join(OI_CODE_TEST_TMP_PATH, 'oi-run-'));
        const image = this.selectImageForCommand(languageId);

        // Ensure Clang image exists before running the container
        await this.ensureClangImageExists(image, os.platform());

        const containerName = `oi-task-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

        // Build docker run parameters, use secure stdin method to pass input
        const dockerArgs = [
            'run',
            '--rm',
            '-i',
            '--name', containerName,
            '--network=none'
        ];

        // Add platform-specific parameters
        const platformArgs = this._getPlatformSpecificRunArgs(memoryLimit);
        dockerArgs.push(...platformArgs);

        // Windows doesn't support read-only mounts, add conditionally
        const isWindows = os.platform() === 'win32';
        if (!isWindows) {
            dockerArgs.push('--read-only');
        }

        // Mount source directory as read-only (Windows also supports this)
        dockerArgs.push('-v', `${sourceDir}:/tmp/source:ro`);
        // Mount temporary directory as writable for compilation output
        dockerArgs.push('-v', `${tempDir}:/tmp:rw`);

        // Add image and command
        dockerArgs.push(image, 'bash', '-c', `cd /tmp/source && ${command}`);

        const outputChannel = vscode.window.createOutputChannel('OI-Code Docker');
        outputChannel.show(true);
        return new Promise((resolve) => {
            outputChannel.appendLine(`[DockerManager] docker ${dockerArgs.join(' ')}`);
            const dockerProcess = spawn('docker', dockerArgs);

            let stdout = '';
            let stderr = '';
            let timedOut = false;

            dockerProcess.stdout.on('data', (data) => {
                const text = data.toString();
                stdout += text;
                outputChannel.appendLine(`[stdout] ${text.trimEnd()}`);
            });
            dockerProcess.stderr.on('data', (data) => {
                const text = data.toString();
                stderr += text;
                outputChannel.appendLine(`[stderr] ${text.trimEnd()}`);
            });

            // Pass input via stdin if provided
            if (input) {
                dockerProcess.stdin.write(input);
            }
            dockerProcess.stdin.end();

            // Hard timeout: kill process if time limit exceeded
            const killTimer = setTimeout(() => {
                console.warn(`[DockerManager] Timeout exceeded, killing container ${containerName}`);
                spawn('docker', ['kill', containerName]).on('close', () => { /* noop */ });
                timedOut = true;
            }, (timeLimit + 1) * 1000);

            dockerProcess.on('close', async (code) => {
                clearTimeout(killTimer);

                await fs.rm(tempDir, { recursive: true, force: true }); // Clean up temporary directory

                // Auto cleanup Docker resources - only cleanup test-related containers
                try {
                    await this.cleanupTestContainers();
                } catch (cleanupError) {
                    console.warn(`[DockerManager] Failed to cleanup test containers: ${cleanupError}`);
                }

                const memoryExceeded = !timedOut && (code === 137 || /Out of memory|Killed process/m.test(stderr));
                const spaceExceeded = /No space left on device|disk quota exceeded/i.test(stderr);
                resolve({ stdout, stderr, timedOut, memoryExceeded, spaceExceeded });
                outputChannel.appendLine(`[DockerManager] exit code=${code}`);
            });

            dockerProcess.on('error', async (err) => {
                clearTimeout(killTimer);
                await fs.rm(tempDir, { recursive: true, force: true }); // Clean up temporary directory

                // Auto cleanup Docker resources
                try {
                    await this.cleanupTestContainers();
                } catch (cleanupError) {
                    console.warn(`[DockerManager] Failed to cleanup test containers: ${cleanupError}`);
                }

                resolve({ stdout: '', stderr: `Failed to execute docker command: ${err.message}`, timedOut: false, memoryExceeded: false, spaceExceeded: false });
                outputChannel.appendLine(`[DockerManager] error: ${err.message}`);
            });
        });
    }



    /**
     * Ensure Clang image exists, try to pull from Docker Hub if not available locally
     */
    private static async ensureClangImageExists(imageName: string, platform: NodeJS.Platform): Promise<void> {
        // Use a static flag to prevent concurrent operations on the same image
        if (this.imageBuildPromises.has(imageName)) {
            console.log(`[DockerManager] Operation already in progress for ${imageName}, waiting...`);
            return this.imageBuildPromises.get(imageName)!;
        }

        const handleResolve = () => {
            this.imageBuildPromises.delete(imageName);
        };

        const failWith = (reason: string): never => {
            this.imageBuildPromises.delete(imageName);
            const guidance = [
                `Image '${imageName}' is not available locally and could not be pulled.`,
                `Reason: ${reason}`,
                `Actions:`,
                `  - Verify the image exists and is public on Docker Hub: docker pull ${imageName}`,
                `  - Ensure you are logged in if the image is private (docker login)`,
                `  - Optionally set 'oicode.docker.compilers' to a valid oi-code image tag if you use a pinned version`,
                `  - Ensure Docker is logged in if the image is private`,
            ].join('\n');
            throw new Error(guidance);
        };

        return new Promise(async (resolve, reject) => {
            const checkImage = spawn('docker', ['images', '-q', imageName]);
            let imageId = '';

            checkImage.stdout.on('data', (data) => {
                imageId += data.toString().trim();
            });

            checkImage.on('close', async (code) => {
                if (code === 0 && imageId) {
                    // Image exists locally
                    console.log(`[DockerManager] Clang image ${imageName} found and ready`);
                    handleResolve();
                    resolve();
                    return;
                }

                // Image doesn't exist, try pulling, with a single retry on failure
                console.log(`[DockerManager] Clang image ${imageName} not found locally, attempting to pull from Docker Hub...`);

                const attemptPull = async (): Promise<void> => {
                    const pullPromise = this.pullImageFromDockerHub(imageName);
                    this.imageBuildPromises.set(imageName, pullPromise);
                    await pullPromise;

                    // Recheck to ensure image is indeed available
                    const available = await this.checkImageAvailableLocally(imageName);
                    if (!available) {
                        throw new Error('Image pull completed but image not found locally');
                    }
                };

                try {
                    await attemptPull();
                    console.log(`[DockerManager] Successfully pulled Clang image ${imageName} from Docker Hub`);
                    handleResolve();
                    resolve();
                } catch (pullError1: any) {
                    console.warn(`[DockerManager] Pull attempt 1 failed for ${imageName}: ${pullError1?.message || pullError1}`);
                    // Backoff and retry once
                    await new Promise(r => setTimeout(r, 2000));
                    try {
                        await attemptPull();
                        console.log(`[DockerManager] Successfully pulled Clang image ${imageName} after retry`);
                        handleResolve();
                        resolve();
                    } catch (pullError2: any) {
                        const reason = pullError2?.message || pullError1?.message || String(pullError2 || pullError1);
                        try {
                            // Final sanity check: maybe image appeared meanwhile
                            const available = await this.checkImageAvailableLocally(imageName);
                            if (available) {
                                console.log(`[DockerManager] Image ${imageName} became available after failures`);
                                handleResolve();
                                resolve();
                                return;
                            }
                        } catch {
                            // ignore
                        }
                        reject(failWith(reason));
                    }
                }
            });

            checkImage.on('error', (err) => {
                reject(failWith(`Failed to check local images: ${err.message}`));
            });
        });
    }

    // Static map to track ongoing image pulls/builds
    private static imageBuildPromises: Map<string, Promise<void>> = new Map();

    /**
     * Pull image from Docker Hub with retries and exponential backoff
     */
    private static async pullImageFromDockerHub(imageName: string): Promise<void> {
        const maxAttempts = 4;
        const baseDelayMs = 2000;

        const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

        let lastError: any = null;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            console.log(`[DockerManager] Pulling image ${imageName} (attempt ${attempt}/${maxAttempts})`);

            let exitCode: number | null = null;
            let stderr = '';
            let stdout = '';

            await new Promise<void>((resolve) => {
                const proc = spawn('docker', ['pull', imageName]);
                proc.stdout.on('data', (d) => { stdout += d.toString(); });
                proc.stderr.on('data', (d) => { stderr += d.toString(); });
                proc.on('close', (code) => { exitCode = code; resolve(); });
                proc.on('error', (err) => { lastError = err; resolve(); });
            });

            if (exitCode === 0) {
                const available = await this.checkImageAvailableLocally(imageName);
                if (available) {
                    console.log(`[DockerManager] Image ${imageName} pulled and verified locally`);
                    return;
                }
                lastError = new Error(`Image pull reported success but image not found locally. stdout=${stdout}`);
            } else {
                lastError = new Error(`docker pull exited with code ${exitCode}. stderr=${stderr || '(empty)'} stdout=${stdout || '(empty)'}`);
            }

            if (attempt < maxAttempts) {
                const delay = baseDelayMs * Math.pow(2, attempt - 1);
                console.warn(`[DockerManager] Pull failed for ${imageName}, retrying after ${delay}ms`);
                await sleep(delay);
            }
        }

        throw lastError || new Error(`Failed to pull ${imageName}`);
    }

    /**
     * Inspect and adopt a single container
     */
    private static async inspectAndAdoptContainer(containerName: string): Promise<DockerContainer | null> {
        return new Promise((resolve) => {
            const inspectProcess = spawn('docker', ['inspect', containerName]);
            let stdout = '';
            let stderr = '';

            inspectProcess.stdout.on('data', (data) => {
                stdout += data.toString();
            });

            inspectProcess.stderr.on('data', (data) => {
                stderr += data.toString();
            });

            inspectProcess.on('close', (code) => {
                if (code !== 0) {
                    console.warn(`[DockerManager] Failed to inspect container ${containerName}: ${stderr}`);
                    resolve(null);
                    return;
                }

                try {
                    const info: DockerContainerInfo[] = JSON.parse(stdout);
                    if (!info || info.length === 0) {
                        resolve(null);
                        return;
                    }

                    const containerInfo = info[0];
                    const state = containerInfo.State;

                    // Check if container is running
                    if (state.Status !== 'running') {
                        console.log(`[DockerManager] Container ${containerName} is not running (status: ${state.Status})`);
                        resolve(null);
                        return;
                    }

                    // Get language ID from container labels
                    const languageId = containerInfo.Config.Labels?.['oi-code.language'];
                    if (!languageId) {
                        console.log(`[DockerManager] Cannot determine language from container labels: ${containerName}`);
                        resolve(null);
                        return;
                    }
                    if (!CONTAINER_POOL_CONFIG.supportedLanguages.includes(languageId as any)) {
                        console.log(`[DockerManager] Unsupported language: ${languageId}`);
                        resolve(null);
                        return;
                    }

                    // Check if container for this language already exists
                    if (this.containerPool.containers.has(languageId)) {
                        console.log(`[DockerManager] Already have a container for ${languageId}, skipping ${containerName}`);
                        resolve(null);
                        return;
                    }

                    // Check if container has cache mount
                    const hasCacheMount = containerInfo.Mounts?.some((mount: DockerMount) =>
                        mount.Destination === '/tmp/source' && mount.Type === 'bind'
                    ) || false;

                    // Create container object and add to pool
                    const container: DockerContainer = {
                        containerId: containerName,
                        languageId,
                        image: containerInfo.Config.Image,
                        isReady: true,
                        lastUsed: Date.now(),
                        hasCacheMount
                    };

                    this.containerPool.containers.set(languageId, container);
                    resolve(container);

                } catch (error) {
                    console.warn(`[DockerManager] Failed to parse container info for ${containerName}:`, error);
                    resolve(null);
                }
            });

            inspectProcess.on('error', (err) => {
                console.warn(`[DockerManager] Error inspecting container ${containerName}:`, err);
                resolve(null);
            });
        });
    }

    /**
     * Clean up unhealthy containers
     */
    private static async cleanupUnhealthyContainer(containerName: string): Promise<void> {
        try {
            console.log(`[DockerManager] Cleaning up unhealthy container: ${containerName}`);
            await new Promise<void>((resolve) => {
                const rmProcess = spawn('docker', ['rm', '-f', containerName]);
                rmProcess.on('close', (code) => {
                    if (code === 0) {
                        console.log(`[DockerManager] Successfully removed unhealthy container: ${containerName}`);
                    } else {
                        console.warn(`[DockerManager] Failed to remove unhealthy container ${containerName}: ${code}`);
                    }
                    resolve();
                });
                rmProcess.on('error', (err) => {
                    console.warn(`[DockerManager] Error removing unhealthy container ${containerName}:`, err);
                    resolve();
                });
            });
        } catch (error) {
            console.warn(`[DockerManager] Error during cleanup of ${containerName}:`, error);
        }
    }

    /**
     * Initialize container pool, called when extension activates
     */
    public static async initializeContainerPool(): Promise<void> {
        if (this.containerPool.isActive) {
            console.log('[DockerManager] Container pool already initialized');
            return;
        }

        console.log('[DockerManager] Initializing container pool...');
        this.containerPool.isActive = true;

        // First try to adopt existing healthy containers
        await this.adoptExistingContainers();

        // Pre-start containers for supported languages, ensure one container per language
        for (const language of CONTAINER_POOL_CONFIG.supportedLanguages) {
            try {
                // Check if container for this language already exists
                const existingContainer = this.containerPool.containers.get(language);
                if (!existingContainer || !existingContainer.isReady) {
                    console.log(`[DockerManager] Starting container for ${language} (no existing ready container)`);
                    await this.startContainerForLanguage(language);
                } else {
                    console.log(`[DockerManager] Container for ${language} already exists and is ready`);
                }
            } catch (error) {
                console.error(`[DockerManager] Failed to start container for ${language}:`, error);
            }
        }

        // Start health check timer
        this.startHealthCheck();

        console.log('[DockerManager] Container pool initialized');
        console.log(`[DockerManager] Active containers: ${this.containerPool.containers.size}`);
    }

    /**
     * Clean up container pool, called when extension deactivates
     */
    public static async cleanupContainerPool(): Promise<void> {
        if (!this.containerPool.isActive) {
            return;
        }

        console.log('[DockerManager] Cleaning up container pool...');

        // Stop health check
        if (this.healthCheckTimer) {
            clearInterval(this.healthCheckTimer);
            this.healthCheckTimer = null;
        }

        // Stop all containers in the pool
        const stopPromises: Promise<void>[] = [];
        for (const [languageId, container] of this.containerPool.containers) {
            if (container.isReady) {
                stopPromises.push(this.stopContainer(container));
            }
        }

        await Promise.all(stopPromises);
        this.containerPool.containers.clear();
        this.containerPool.isActive = false;

        console.log('[DockerManager] Container pool cleaned up');
    }

    /**
     * Comprehensive cleanup of all Docker resources (containers, images, networks) - optimized version
     */
    public static async cleanupAllDockerResources(): Promise<void> {
        console.log('[DockerManager] Starting comprehensive Docker cleanup...');

        try {
            // Force remove all oi-container containers (scan and kill directly)
            // This covers cleanup for both container pool containers
            console.log('[DockerManager] Force removing all oi-container containers...');
            await this.forceRemoveOiContainers();

            // Only remove images created by oi-code, preserve base images
            // Note: No longer removing gcc:13 base images
            console.log('[DockerManager] Skipping base image removal to preserve Docker Hub images...');

            // Skip Docker system prune to avoid user data loss
            console.log('[DockerManager] Skipping system prune to avoid user data loss...');

            console.log('[DockerManager] Docker cleanup completed successfully');
        } catch (error) {
            console.warn('[DockerManager] Error during Docker cleanup:', error);
            // Continue even if cleanup fails, don't affect other operations
        }
    }

    /**
     * Get Docker resource statistics
     */
    public static async getDockerStats(): Promise<{ containers: number; images: number; containerNames: string[] }> {
        return new Promise((resolve) => {
            // Get container count
            const psProcess = spawn('docker', ['ps', '-a', '-q']);
            let containerIds = '';
            psProcess.stdout.on('data', (data) => {
                containerIds += data.toString();
            });

            // Get image count
            const imagesProcess = spawn('docker', ['images', '-q']);
            let imageIds = '';
            imagesProcess.stdout.on('data', (data) => {
                imageIds += data.toString();
            });

            // Get container names
            const namesProcess = spawn('docker', ['ps', '-a', '--format', '{{.Names}}']);
            let containerNames = '';
            namesProcess.stdout.on('data', (data) => {
                containerNames += data.toString();
            });

            const allProcesses = [psProcess, imagesProcess, namesProcess];
            let completed = 0;

            allProcesses.forEach(process => {
                process.on('close', () => {
                    completed++;
                    if (completed === allProcesses.length) {
                        resolve({
                            containers: containerIds.trim().split('\n').filter(id => id).length,
                            images: imageIds.trim().split('\n').filter(id => id).length,
                            containerNames: containerNames.trim().split('\n').filter(name => name)
                        });
                    }
                });
            });
        });
    }

    private static async startContainerForLanguage(languageId: string): Promise<DockerContainer> {
        const image = this.selectImageForCommand(languageId);
        const platform = os.platform();

        // Ensure Clang image exists and is ready before starting container
        await this.ensureClangImageExists(image, platform);

        const containerName = `oi-container-${languageId}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

        console.log(`[DockerManager] Starting container for ${languageId} using ${image}`);
        console.log(`[DockerManager] Container pool:`, this.containerPool.containers.size);

        // Get user home directory path, cross-platform compatible, create separate subdirectory for each language
        const homedir = os.homedir();
        const cacheDir = path.join(homedir, '.cache', 'oi-code', languageId);

        // Ensure cache directory exists
        try {
            await fs.mkdir(cacheDir, { recursive: true });
            console.log(`[DockerManager] Using cache directory: ${cacheDir}`);
        } catch (error) {
            console.warn(`[DockerManager] Failed to create cache directory: ${error}, using temporary directory`);
            return this.startContainerWithoutMount(languageId, image, containerName);
        }

        // Create and start container, pre-set necessary directories and permissions, mount cache directory
        const createArgs = [
            'run',
            '-d', // Background execution
            '--name', containerName,
            '--label', `oi-code.language=${languageId}`, // Add language label
            '--network=none'
        ];

        // Add platform-specific parameters
        const platformArgs = this._getPlatformSpecificCreateArgs();
        createArgs.push(...platformArgs);

        // Add interactive mode and mount options
        createArgs.push('-i');
        createArgs.push('-v', `${cacheDir}:/tmp/source:rw`); // Mount directly to /tmp/source
        createArgs.push(image);
        createArgs.push('bash', '-c', 'mkdir -p /tmp/source && chmod 755 /tmp/source && while true; do sleep 3600; done'); // Keep container running and create necessary directories, set permissions

        return new Promise((resolve, reject) => {
            const dockerProcess = spawn('docker', createArgs);
            let stderr = '';

            dockerProcess.stderr.on('data', (data) => {
                stderr += data.toString();
            });

            dockerProcess.on('close', (code) => {
                if (code === 0) {
                    console.log(`[DockerManager] Container ${containerName} started for ${languageId}`);
                    const container: DockerContainer = {
                        containerId: containerName,
                        languageId,
                        image,
                        isReady: true,
                        lastUsed: Date.now(),
                        hasCacheMount: true // Record that cache mount is used
                    };

                    this.containerPool.containers.set(languageId, container);
                    resolve(container);
                } else {
                    reject(new Error(`Failed to start container for ${languageId}: ${stderr}`));
                }
            });

            dockerProcess.on('error', (err) => {
                reject(new Error(`Failed to start container for ${languageId}: ${err.message}`));
            });
        });
    }

    /**
     * Start container without mount (fallback option)
     */
    private static async startContainerWithoutMount(languageId: string, image: string, containerName: string): Promise<DockerContainer> {
        console.log(`[DockerManager] Starting container for ${languageId} without mount using ${image}`);

        const createArgs = [
            'run',
            '-d', // Background execution
            '--name', containerName,
            '--label', `oi-code.language=${languageId}`, // Add language label
            '--network=none'
        ];

        // Add platform-specific parameters
        const platformArgs = this._getPlatformSpecificCreateArgs();
        createArgs.push(...platformArgs);

        // Add interactive mode and command
        createArgs.push('-i');
        createArgs.push(image);
        createArgs.push('bash', '-c', 'mkdir -p /tmp/source && chmod 755 /tmp/source && while true; do sleep 3600; done'); // Keep container running and create necessary directories, set permissions

        return new Promise((resolve, reject) => {
            const dockerProcess = spawn('docker', createArgs);
            let stderr = '';

            dockerProcess.stderr.on('data', (data) => {
                stderr += data.toString();
            });

            dockerProcess.on('close', (code) => {
                if (code === 0) {
                    console.log(`[DockerManager] Container ${containerName} started for ${languageId} (without mount)`);
                    const container: DockerContainer = {
                        containerId: containerName,
                        languageId,
                        image,
                        isReady: true,
                        lastUsed: Date.now(),
                        hasCacheMount: false // Record that cache mount is not used
                    };

                    this.containerPool.containers.set(languageId, container);
                    resolve(container);
                } else {
                    reject(new Error(`Failed to start container for ${languageId}: ${stderr}`));
                }
            });

            dockerProcess.on('error', (err) => {
                reject(new Error(`Failed to start container for ${languageId}: ${err.message}`));
            });
        });
    }

    /**
     * Stop container
     */
    private static async stopContainer(container: DockerContainer): Promise<void> {
        return new Promise((resolve) => {
            console.log(`[DockerManager] Stopping container ${container.containerId}`);
            const stopProcess = spawn('docker', ['stop', container.containerId]);

            stopProcess.on('close', () => {
                console.log(`[DockerManager] Container ${container.containerId} stopped`);
                resolve();
            });

            stopProcess.on('error', () => {
                // Continue cleanup even if error occurs
                console.warn(`[DockerManager] Error stopping container ${container.containerId}, continuing cleanup`);
                resolve();
            });
        });
    }

    /**
     * Start health check timer
     */
    private static startHealthCheck(): void {
        if (this.healthCheckTimer) {
            clearInterval(this.healthCheckTimer);
        }

        this.healthCheckTimer = setInterval(() => {
            this.performHealthCheck();
        }, CONTAINER_POOL_CONFIG.healthCheckInterval);
    }

    /**
     * Perform health check
     */
    private static async performHealthCheck(): Promise<void> {
        if (!this.containerPool.isActive) {
            return;
        }

        console.log('[DockerManager] Performing health check');

        const now = Date.now();
        const cleanupPromises: Promise<void>[] = [];

        // Check if containers are still healthy
        for (const [languageId, container] of this.containerPool.containers) {
            // Check if container timed out from inactivity
            if (now - container.lastUsed > CONTAINER_POOL_CONFIG.maxIdleTime) {
                console.log(`[DockerManager] Container for ${languageId} timed out, restarting`);
                cleanupPromises.push(this.restartContainer(container));
                continue;
            }

            // Check if container is still running
            try {
                const inspectProcess = spawn('docker', ['inspect', container.containerId]);
                let stdout = '';
                let stderr = '';

                inspectProcess.stdout.on('data', (data) => {
                    stdout += data.toString();
                });

                inspectProcess.stderr.on('data', (data) => {
                    stderr += data.toString();
                });

                await new Promise((resolve) => {
                    inspectProcess.on('close', resolve);
                });

                const info: DockerContainerInfo[] = JSON.parse(stdout);
                if (!info[0] || info[0].State?.Running !== true) {
                    console.log(`[DockerManager] Container ${container.containerId} not running, restarting`);
                    cleanupPromises.push(this.restartContainer(container));
                }
            } catch (error) {
                console.warn(`[DockerManager] Failed to inspect container ${container.containerId}:`, error);
                cleanupPromises.push(this.restartContainer(container));
            }
        }

        await Promise.all(cleanupPromises);
    }

    /**
     * Restart container
     */
    private static async restartContainer(container: DockerContainer): Promise<void> {
        try {
            await this.stopContainer(container);
            this.containerPool.containers.delete(container.languageId);
        } catch (error) {
            console.warn(`[DockerManager] Failed to stop container ${container.containerId}:`, error);
        }

        try {
            await this.startContainerForLanguage(container.languageId);
        } catch (error) {
            console.error(`[DockerManager] Failed to restart container for ${container.languageId}:`, error);
        }
    }

    /**
     * Get available container for specified language
     */
    private static async getContainerForLanguage(languageId: string): Promise<DockerContainer> {
        if (!this.containerPool.isActive) {
            throw new Error('Container pool is not active');
        }

        let container = this.containerPool.containers.get(languageId);

        // If no container exists or it's not ready, create a new one
        if (!container || !container.isReady) {
            console.log(`[DockerManager] No ready container for ${languageId}, creating new one`);
            // Clean up any existing old container first
            if (container) {
                try {
                    await this.stopContainer(container);
                } catch (error) {
                    console.warn(`[DockerManager] Failed to stop old container ${container.containerId}:`, error);
                }
            }
            try {
                container = await this.startContainerForLanguage(languageId);
            } catch (error: any) {
                console.error(`[DockerManager] Failed to start container for ${languageId}:`, error);
                // If container startup fails, fall back to non-pool mode
                console.log(`[DockerManager] Falling back to non-pool mode for ${languageId}`);
                throw new Error(`Failed to start container for ${languageId}: ${error.message}`);
            }
        }

        // At this point we must have a container
        return container!;
    }

    /**
     * Adopt existing healthy containers to avoid resource leaks
     */
    private static async adoptExistingContainers(): Promise<void> {
        console.log('[DockerManager] Scanning for existing oi-container containers...');
        try {
            const psProcess = spawn('docker', ['ps', '-a', '--filter', 'name=oi-container*', '--format', '{{.Names}}']);
            let containerNames = '';

            psProcess.stdout.on('data', (data) => {
                containerNames += data.toString();
            });

            await new Promise<void>((resolve, reject) => {
                psProcess.on('close', (code) => {
                    if (code === 0) resolve();
                    else reject(new Error(`Failed to list containers: ${code}`));
                });
                psProcess.on('error', (err) => reject(new Error(`Error listing containers: ${err.message}`)));
            });

            const names = containerNames.trim().split('\n').filter(name => name);
            if (names.length === 0) {
                console.log('[DockerManager] No existing oi-container containers found');
                return;
            }

            console.log(`[DockerManager] Found ${names.length} existing containers: ${names.join(', ')}`);

            for (const name of names) {
                try {
                    const adopted = await this.inspectAndAdoptContainer(name);
                    if (adopted) {
                        console.log(`[DockerManager] Adopted ${name} for ${adopted.languageId}`);
                    } else {
                        console.log(`[DockerManager] ${name} is not healthy, cleaning up`);
                        await this.cleanupUnhealthyContainer(name);
                    }
                } catch (e) {
                    console.warn(`[DockerManager] Failed to adopt ${name}:`, e);
                    await this.cleanupUnhealthyContainer(name);
                }
            }
        } catch (error) {
            console.warn('[DockerManager] Error during container adoption:', error);
        }
    }

    /**
     * Get platform-specific Docker run arguments
     * @param memoryLimit Memory limit (MB)
     * @returns Docker parameter array
     */
    private static _getPlatformSpecificRunArgs(memoryLimit: string): string[] {
        const platform = os.platform();
        const args: string[] = [];

        if (platform === 'win32') {
            // Windows Docker - simplified configuration
            args.push('--memory=' + memoryLimit + 'm');
        } else if (platform === 'darwin') {
            // macOS Docker Desktop
            args.push('--memory=' + memoryLimit + 'm');
            args.push('--cpus=1.0');
            args.push('--pids-limit=64');
        } else {
            // Linux Docker
            args.push('--memory=' + memoryLimit + 'm');
            args.push('--memory-swap=' + memoryLimit + 'm');
            args.push('--cpus=1.0');
            args.push('--pids-limit=64');
        }

        return args;
    }

    /**
     * Get platform-specific container creation arguments
     * @param memoryLimit Memory limit (MB), default 512MB for container pool compatibility
     * @returns Docker parameter array
     */
    private static _getPlatformSpecificCreateArgs(memoryLimit: string = '512'): string[] {
        const platform = os.platform();
        const args: string[] = [];

        if (platform === 'win32') {
            // Windows Docker - simplified configuration
            args.push('--memory=' + memoryLimit + 'm');
        } else if (platform === 'darwin') {
            // macOS Docker Desktop
            args.push('--memory=' + memoryLimit + 'm');
            args.push('--cpus=1.0');
            args.push('--pids-limit=64');
        } else {
            // Linux Docker
            args.push('--memory=' + memoryLimit + 'm');
            args.push('--memory-swap=' + memoryLimit + 'm');
            args.push('--cpus=1.0');
            args.push('--pids-limit=64');
        }

        return args;
    }

    /**
     * 获取合适的Docker镜像，支持多平台检测和回退机制
     * @param languageId 编程语言ID
     * @returns Docker镜像名称
     */
    private static selectImageForCommand(languageId: string): string {
        const platform = os.platform();
        const host = os.hostname();
        console.log(`[DockerManager] 检测到的平台: ${platform}, 主机: ${host}`);

        // 读取用户配置的编译器设置
        const config = vscode.workspace.getConfiguration();
        const compilers = config.get<any>('oicode.docker.compilers') || {};

        // 优先使用用户配置的镜像
        if (compilers[languageId]) {
            console.log(`[DockerManager] 使用用户配置的镜像: ${compilers[languageId]} for ${languageId}`);
            return compilers[languageId];
        }

        // 根据操作系统和语言选择合适的镜像
        let selectedImage = 'flowerrealm/oi-code-clang:latest';

        // 检查是否为受支持的平台和语言
        if (platform === 'win32' || platform === 'darwin') {
            // Windows和macOS使用Linux镜像（Docker Desktop支持）
            console.log(`[DockerManager] ${platform}平台使用Linux镜像`);
        } else if (platform === 'linux') {
            // Linux本地环境
            console.log(`[DockerManager] Linux平台使用原生镜像`);
        } else {
            // 其他平台回退到Linux镜像
            console.log(`[DockerManager] 不支持的平台 ${platform}，回退到Linux镜像`);
        }

        // 可以在这里添加更多复杂的镜像选择逻辑
        // 比如根据硬件架构选择不同版本的镜像
        const arch = os.arch();
        console.log(`[DockerManager] 检测到的硬件架构: ${arch}`);

        console.log(`[DockerManager] 选择的镜像: ${selectedImage} for ${languageId} on ${platform}`);

        return selectedImage;
    }

    /**
     * Clean up test-related containers (non-container pool containers)
     */
    private static async cleanupTestContainers(): Promise<void> {
        try {
            console.log('[DockerManager] Cleaning up test containers...');

            // Get all containers
            const psProcess = spawn('docker', ['ps', '-a', '-q', '--filter', 'name=oi-task-']);
            let containerIds = '';
            psProcess.stdout.on('data', (data) => {
                containerIds += data.toString();
            });

            await new Promise<void>((resolve, reject) => {
                psProcess.on('close', (code) => {
                    if (code === 0) {
                        const ids = containerIds.trim().split('\n').filter(id => id);
                        if (ids.length > 0) {
                            console.log(`[DockerManager] Found ${ids.length} test containers to cleanup`);
                            // Batch delete containers
                            const rmProcess = spawn('docker', ['rm', '-f', ...ids]);
                            rmProcess.on('close', (rmCode) => {
                                console.log(`[DockerManager] Test containers cleanup completed with code: ${rmCode}`);
                                resolve();
                            });
                            rmProcess.on('error', (err) => {
                                console.warn(`[DockerManager] Error cleaning up test containers: ${err.message}`);
                                resolve();
                            });
                        } else {
                            console.log('[DockerManager] No test containers found to cleanup');
                            resolve();
                        }
                    } else {
                        console.warn(`[DockerManager] Failed to list test containers: ${code}`);
                        resolve();
                    }
                });
                psProcess.on('error', (err) => {
                    console.warn(`[DockerManager] Error listing test containers: ${err.message}`);
                    resolve();
                });
            });
        } catch (error) {
            console.warn('[DockerManager] Error during test container cleanup:', error);
        }
    }
}
