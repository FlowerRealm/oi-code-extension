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

// 容器池管理接口
interface DockerContainer {
    containerId: string;
    languageId: string;
    image: string;
    isReady: boolean;
    lastUsed: number;
}

interface ContainerPool {
    containers: Map<string, DockerContainer>;
    isActive: boolean;
}

// 容器池配置
const CONTAINER_POOL_CONFIG = {
    maxIdleTime: 30 * 60 * 1000, // 30分钟无使用自动清理
    healthCheckInterval: 5 * 60 * 1000, // 5分钟健康检查
    supportedLanguages: ['c', 'cpp', 'python'] as const,
};

/**
 * Manages the Docker environment, including building the image, running containers,
 * and monitoring submissions for the OI extension.
 */
export class DockerManager {
    // 容器池实例
    public static containerPool: ContainerPool = {
        containers: new Map(),
        isActive: false
    };

    // 健康检查定时器
    private static healthCheckTimer: NodeJS.Timeout | null = null;

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
                '静默安装 Docker 失败。请检查输出通道了解详情，并考虑手动安装 Docker。',
                '查看输出'
            ).then(selection => {
                if (selection === '查看输出') {
                    vscode.commands.executeCommand('workbench.action.outputChannel.toggle', 'OI-Code Docker Install');
                }
            });
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
        // 确保 Docker 可用
        await this.ensureDockerIsReady(options.projectRootPath);

        // 如果容器池已激活，则使用容器池
        if (this.containerPool.isActive) {
            try {
                return await this.runWithContainerPool(options);
            } catch (err) {
                console.warn(`[DockerManager] Running with container pool failed, falling back to non-pool mode: ${err}`);
                return this.runWithoutContainerPool(options);
            }
        }

        // 否则使用原来的实现
        return this.runWithoutContainerPool(options);
    }

    /**
     * 使用容器池运行命令
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

        // 获取容器
        const container = await this.getContainerForLanguage(languageId);

        return new Promise(async (resolve, reject) => {
            try {
                // 检查容器是否使用了.cache挂载
                const hasCacheMount = await this.checkContainerHasCacheMount(container.containerId);

                if (hasCacheMount) {
                    // 使用.cache挂载，复制文件到缓存目录
                    await this.copyFilesToContainer(sourceDir, container.containerId, true);
                    console.log(`[DockerManager] Using cache mount for container ${container.containerId}`);
                } else {
                    // 不使用挂载，直接复制文件到容器
                    await this.copyFilesToContainer(sourceDir, container.containerId, false);
                    console.log(`[DockerManager] Using direct copy for container ${container.containerId}`);
                }

                // 使用管道格式执行命令
                const outputChannel = vscode.window.createOutputChannel('OI-Code Docker');
                outputChannel.show(true);

                // 构建管道命令 - 使用文件方式处理输入
                const pipeCommand = `docker exec -i ${container.containerId} bash -c "cd /tmp/source && ${command}"`;
                const dockerProcess = spawn('bash', ['-c', pipeCommand]);

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

                // 通过stdin传递输入（如果有）
                if (input) {
                    dockerProcess.stdin.write(input);
                    dockerProcess.stdin.end();
                }

                // 硬超时：如果超过时间限制则杀死进程
                const killTimer = setTimeout(() => {
                    console.warn(`[DockerManager] Timeout exceeded, killing process`);
                    dockerProcess.kill('SIGTERM');
                    timedOut = true;
                }, (timeLimit + 1) * 1000);

                dockerProcess.on('close', async (pipeCode) => {
                    clearTimeout(killTimer);

                    // 直接使用管道的输出，不需要额外获取
                    const memoryExceeded = pipeCode === 137 || /Out of memory|Killed process/m.test(stderr);
                    const spaceExceeded = /No space left on device|disk quota exceeded/i.test(stderr);
                    resolve({ stdout, stderr, timedOut, memoryExceeded, spaceExceeded });
                    outputChannel.appendLine(`[DockerManager] pipe exit code=${pipeCode}`);
                });

                dockerProcess.on('error', async (err) => {
                    clearTimeout(killTimer);
                    resolve({ stdout: '', stderr: `Failed to execute pipe command: ${err.message}`, timedOut: false, memoryExceeded: false, spaceExceeded: false });
                    outputChannel.appendLine(`[DockerManager] pipe error: ${err.message}`);
                });
            } catch (err) {
                reject(err);
            }
        });
    }

    /**
     * 检查容器是否使用了.cache挂载
     */
    private static async checkContainerHasCacheMount(containerId: string): Promise<boolean> {
        return new Promise((resolve) => {
            const inspectProcess = spawn('docker', ['inspect', containerId]);
            let stdout = '';

            inspectProcess.stdout.on('data', (data) => {
                stdout += data.toString();
            });

            inspectProcess.on('close', (code) => {
                if (code === 0) {
                    try {
                        const info = JSON.parse(stdout);
                        const mounts = info[0].Mounts || [];
                        const hasCacheMount = mounts.some((mount: any) =>
                            mount.Destination === '/cache' || mount.Destination === '/tmp/source'
                        );
                        resolve(hasCacheMount);
                    } catch (error) {
                        resolve(false);
                    }
                } else {
                    resolve(false);
                }
            });

            inspectProcess.on('error', () => {
                resolve(false);
            });
        });
    }

    /**
     * 复制文件到容器
     */
    private static async copyFilesToContainer(sourceDir: string, containerId: string, useCache: boolean = false): Promise<void> {
        const targetDescription = useCache ? '/tmp/source in container' : 'container';
        const logMessage = `[DockerManager] Copying files from ${sourceDir} to ${targetDescription} ${containerId}`;
        console.log(logMessage);

        return new Promise((resolve, reject) => {
            // 首先清空目标目录
            const cleanProcess = spawn('docker', ['exec', containerId, 'bash', '-c', 'rm -rf /tmp/source/*']);
            cleanProcess.on('close', (cleanCode) => {
                if (cleanCode === 0) {
                    // 然后复制源目录的内容到目标目录
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
     * 不使用容器池运行命令（原始实现）
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

        // 创建临时目录用于输出
        await fs.mkdir(OI_CODE_TEST_TMP_PATH, { recursive: true });
        const tempDir = await fs.mkdtemp(path.join(OI_CODE_TEST_TMP_PATH, 'oi-run-'));
        const image = this.selectImageForCommand(languageId);

        const containerName = `oi-task-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

        // 构建docker run参数，使用安全的stdin方式传递输入
        const dockerArgs = [
            'run',
            '--rm',
            '-i',
            '--name', containerName,
            '--network=none',
            '--read-only',
            `--memory=${memoryLimit}m`,
            `--memory-swap=${memoryLimit}m`,
            '--cpus=1.0',
            '--pids-limit=64',
            // 挂载源目录为只读
            '-v', `${sourceDir}:/tmp/source:ro`,
            // 挂载临时目录为可写，用于编译产物
            '-v', `${tempDir}:/tmp:rw`,
            image,
            'bash', '-c', `cd /tmp/source && ${command}`
        ];

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

            // 通过stdin传递输入（如果有）
            if (input) {
                dockerProcess.stdin.write(input);
                dockerProcess.stdin.end();
            }

            // 硬超时：如果超过时间限制则杀死进程
            const killTimer = setTimeout(() => {
                console.warn(`[DockerManager] Timeout exceeded, killing container ${containerName}`);
                spawn('docker', ['kill', containerName]).on('close', () => { /* noop */ });
                timedOut = true;
            }, (timeLimit + 1) * 1000);

            dockerProcess.on('close', async (code) => {
                clearTimeout(killTimer);

                await fs.rm(tempDir, { recursive: true, force: true }); // 清理临时目录

                // 自动清理Docker资源 - 只清理测试相关的容器
                try {
                    await this.cleanupTestContainers();
                } catch (cleanupError) {
                    console.warn(`[DockerManager] Failed to cleanup test containers: ${cleanupError}`);
                }

                const memoryExceeded = code === 137 || /Out of memory|Killed process/m.test(stderr);
                const spaceExceeded = /No space left on device|disk quota exceeded/i.test(stderr);
                resolve({ stdout, stderr, timedOut, memoryExceeded, spaceExceeded });
                outputChannel.appendLine(`[DockerManager] exit code=${code}`);
            });

            dockerProcess.on('error', async (err) => {
                clearTimeout(killTimer);
                await fs.rm(tempDir, { recursive: true, force: true }); // 清理临时目录

                // 自动清理Docker资源
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

    private static selectImageForCommand(languageId: string): string {
        // 读取用户配置的编译器设置
        const config = vscode.workspace.getConfiguration();
        const compilers = config.get<any>('oicode.docker.compilers') || {};

        // 优先使用用户配置的镜像
        if (compilers[languageId]) {
            return compilers[languageId];
        }

        // 回退到默认镜像
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

    /**
     * 初始化容器池，在扩展激活时调用
     */
    public static async initializeContainerPool(): Promise<void> {
        if (this.containerPool.isActive) {
            console.log('[DockerManager] Container pool already initialized');
            return;
        }

        console.log('[DockerManager] Initializing container pool...');
        this.containerPool.isActive = true;

        // 为支持的语言预启动容器，确保每种语言只有一个容器
        for (const language of CONTAINER_POOL_CONFIG.supportedLanguages) {
            try {
                // 检查是否已经存在该语言的容器
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

        // 启动健康检查定时器
        this.startHealthCheck();

        console.log('[DockerManager] Container pool initialized');
        console.log(`[DockerManager] Active containers: ${this.containerPool.containers.size}`);
    }

    /**
     * 清理容器池，在扩展停用时调用
     */
    public static async cleanupContainerPool(): Promise<void> {
        if (!this.containerPool.isActive) {
            return;
        }

        console.log('[DockerManager] Cleaning up container pool...');

        // 停止健康检查
        if (this.healthCheckTimer) {
            clearInterval(this.healthCheckTimer);
            this.healthCheckTimer = null;
        }

        // 停止所有容器池中的容器
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
     * 彻底清理所有Docker资源（容器、镜像、网络等）
     */
    public static async cleanupAllDockerResources(): Promise<void> {
        console.log('[DockerManager] Starting comprehensive Docker cleanup...');

        try {
            // 1. 先停止并删除所有容器池中的容器
            console.log('[DockerManager] Stopping and removing container pool containers...');
            const containerIds: string[] = [];
            for (const container of this.containerPool.containers.values()) {
                if (container.isReady) {
                    containerIds.push(container.containerId);
                }
            }

            if (containerIds.length > 0) {
                await this._stopContainers(containerIds);
                await this._removeContainers(containerIds);
            }

            // 2. 强制删除所有oi-container容器（直接扫描并强杀）
            console.log('[DockerManager] Force removing all oi-container containers...');
            await new Promise<void>((resolve, reject) => {
                const findProcess = spawn('docker', ['ps', '-a', '-q', '--filter', 'name=oi-container']);
                let containerIds = '';

                findProcess.stdout.on('data', (data) => {
                    containerIds += data.toString();
                });

                findProcess.on('close', async (code) => {
                    if (code === 0) {
                        const ids = containerIds.trim().split('\n').filter(id => id);
                        if (ids.length > 0) {
                            console.log(`[DockerManager] Found ${ids.length} oi-container(s) to force remove`);

                            // 强制删除所有oi-container容器
                            const rmProcess = spawn('docker', ['rm', '-f', ...ids]);
                            rmProcess.on('close', (rmCode) => {
                                console.log(`[DockerManager] Force removed oi-containers with code: ${rmCode}`);
                                resolve();
                            });
                            rmProcess.on('error', (err) => {
                                console.warn(`[DockerManager] Error force removing oi-containers: ${err.message}`);
                                reject(err);
                            });
                        } else {
                            console.log('[DockerManager] No oi-containers found to remove');
                            resolve();
                        }
                    } else {
                        console.warn(`[DockerManager] Failed to find oi-containers: ${code}`);
                        reject(new Error("Failed to find oi-containers with code " + code));
                    }
                });

                findProcess.on('error', (err) => {
                    console.warn(`[DockerManager] Error finding oi-containers: ${err.message}`);
                    reject(err);
                });
            });

            // 3. 只删除oi-code创建的镜像，保留基础镜像
            // 注意：这里不再删除gcc:13和python:3.11等基础镜像
            console.log('[DockerManager] Skipping base image removal to preserve Docker Hub images...');

            // 4. 跳过Docker系统清理，避免删除用户数据
            console.log('[DockerManager] Skipping system prune to avoid user data loss...');

            console.log('[DockerManager] Docker cleanup completed successfully');
        } catch (error) {
            console.warn('[DockerManager] Error during Docker cleanup:', error);
            // 即使清理失败也继续执行，不要影响其他操作
        }
    }

    /**
     * 获取Docker资源统计信息
     */
    public static async getDockerStats(): Promise<{ containers: number; images: number; containerNames: string[] }> {
        return new Promise((resolve) => {
            // 获取容器数量
            const psProcess = spawn('docker', ['ps', '-a', '-q']);
            let containerIds = '';
            psProcess.stdout.on('data', (data) => {
                containerIds += data.toString();
            });

            // 获取镜像数量
            const imagesProcess = spawn('docker', ['images', '-q']);
            let imageIds = '';
            imagesProcess.stdout.on('data', (data) => {
                imageIds += data.toString();
            });

            // 获取容器名称
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

    /**
     * 为指定语言启动容器 - 优化版本，支持Docker Volumes挂载
     */
    private static async startContainerForLanguage(languageId: string): Promise<DockerContainer> {
        const image = this.selectImageForCommand(languageId);
        const containerName = `oi-container-${languageId}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

        console.log(`[DockerManager] Starting container for ${languageId} using ${image}`);

        // 获取用户主目录路径，多平台兼容
        const homedir = os.homedir();
        const cacheDir = path.join(homedir, '.cache', 'oi-code');

        // 确保缓存目录存在
        try {
            await fs.mkdir(cacheDir, { recursive: true });
            console.log(`[DockerManager] Using cache directory: ${cacheDir}`);
        } catch (error) {
            console.warn(`[DockerManager] Failed to create cache directory: ${error}, using temporary directory`);
            return this.startContainerWithoutMount(languageId, image, containerName);
        }

        // 创建容器并启动它，预设置必要的目录和权限，并挂载缓存目录
        const createArgs = [
            'run',
            '-d', // 后台运行
            '--name', containerName,
            '--network=none',
            '--memory=512m',
            '--memory-swap=512m',
            '--cpus=1.0',
            '--pids-limit=64',
            '-i', // 交互模式
            // 挂载缓存目录到容器内，实现文件自动同步
            '-v', `${cacheDir}:/tmp/source:rw`, // 直接挂载到/tmp/source
            image,
            'bash', '-c', 'mkdir -p /tmp && chmod 777 /tmp /tmp/source && while true; do sleep 3600; done' // 保持容器运行并创建必要目录，设置权限
        ];

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
                        lastUsed: Date.now()
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
     * 不使用挂载启动容器（备用方案）
     */
    private static async startContainerWithoutMount(languageId: string, image: string, containerName: string): Promise<DockerContainer> {
        console.log(`[DockerManager] Starting container for ${languageId} without mount using ${image}`);

        const createArgs = [
            'run',
            '-d', // 后台运行
            '--name', containerName,
            '--network=none',
            '--memory=512m',
            '--memory-swap=512m',
            '--cpus=1.0',
            '--pids-limit=64',
            '-i', // 交互模式
            image,
            'bash', '-c', 'mkdir -p /tmp/source /tmp && chmod 777 /tmp/source /tmp && while true; do sleep 3600; done' // 保持容器运行并创建必要目录，设置权限
        ];

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
                        lastUsed: Date.now()
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
     * 停止容器
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
                // 即使出错也继续清理
                console.warn(`[DockerManager] Error stopping container ${container.containerId}, continuing cleanup`);
                resolve();
            });
        });
    }

    /**
     * 执行Docker命令的辅助函数
     */
    private static async _runDockerCommand(args: string[]): Promise<void> {
        return new Promise((resolve, reject) => {
            const process = spawn('docker', args);
            process.on('close', (code) => {
                if (code === 0) {
                    resolve();
                } else {
                    reject(new Error(`Docker command failed with code ${code}: ${args.join(' ')}`));
                }
            });
            process.on('error', (err) => {
                reject(new Error(`Failed to execute docker command: ${err.message}`));
            });
        });
    }

    /**
     * 批量停止容器的辅助函数
     */
    private static async _stopContainers(containerIds: string[]): Promise<void> {
        if (containerIds.length === 0) {
            return;
        }
        await new Promise<void>((resolve) => {
            const stopProcess = spawn('docker', ['stop', ...containerIds]);
            stopProcess.on('close', () => resolve());
            stopProcess.on('error', (err) => {
                console.warn(`[DockerManager] Error stopping containers: ${err.message}`);
                resolve(); // 出错也继续，保证后续清理流程
            });
        });
    }

    /**
     * 批量删除容器的辅助函数
     */
    private static async _removeContainers(containerIds: string[]): Promise<void> {
        if (containerIds.length === 0) {
            return;
        }
        await new Promise<void>((resolve) => {
            const rmProcess = spawn('docker', ['rm', '-f', ...containerIds]);
            rmProcess.on('close', () => resolve());
            rmProcess.on('error', (err) => {
                console.warn(`[DockerManager] Error removing containers: ${err.message}`);
                resolve(); // 出错也继续，保证清理流程完整
            });
        });
    }

    /**
     * 启动健康检查定时器
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
     * 执行健康检查
     */
    private static async performHealthCheck(): Promise<void> {
        if (!this.containerPool.isActive) {
            return;
        }

        console.log('[DockerManager] Performing health check');

        const now = Date.now();
        const cleanupPromises: Promise<void>[] = [];

        // 检查容器是否仍然健康
        for (const [languageId, container] of this.containerPool.containers) {
            // 检查容器是否超时未使用
            if (now - container.lastUsed > CONTAINER_POOL_CONFIG.maxIdleTime) {
                console.log(`[DockerManager] Container for ${languageId} timed out, restarting`);
                cleanupPromises.push(this.restartContainer(container));
                continue;
            }

            // 检查容器是否仍然运行
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

                const info = JSON.parse(stdout);
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
     * 重启容器
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
     * 获取指定语言的可用容器
     */
    private static async getContainerForLanguage(languageId: string): Promise<DockerContainer> {
        if (!this.containerPool.isActive) {
            throw new Error('Container pool is not active');
        }

        let container = this.containerPool.containers.get(languageId);

        // 如果没有容器或容器不可用，则创建新容器
        if (!container || !container.isReady) {
            console.log(`[DockerManager] No ready container for ${languageId}, creating new one`);
            // 先清理可能存在的旧容器
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
                // 如果容器启动失败，回退到不使用容器池的模式
                console.log(`[DockerManager] Falling back to non-pool mode for ${languageId}`);
                throw new Error(`Failed to start container for ${languageId}: ${error.message}`);
            }
        }

        return container;
    }

    /**
     * 清理测试相关的容器（非容器池容器）
     */
    private static async cleanupTestContainers(): Promise<void> {
        try {
            console.log('[DockerManager] Cleaning up test containers...');

            // 获取所有容器
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
                            // 批量删除容器
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
