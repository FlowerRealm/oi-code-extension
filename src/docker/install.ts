/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as os from 'os';
import * as cp from 'child_process';
import * as fs from 'fs';
import * as vscode from 'vscode';

// Create unified output channel
const dockerInstallOutput = vscode.window.createOutputChannel('OI-Code Docker Install');

export interface InstallCommand {
    command: string;
    message: string;
    isUrl?: boolean;
}

export class Installer {

    private static isBrewInstalled(): boolean {
        try {
            cp.execSync('which brew', { stdio: 'ignore' });
            return true;
        } catch (e) {
            return false;
        }
    }

    private static getLinuxDistro(): string {
        try {
            const osRelease = fs.readFileSync('/etc/os-release', 'utf8');
            const match = osRelease.match(/^ID=(.*)$/m);
            if (match) {
                return match[1].toLowerCase().replace(/"/g, '');
            }
        } catch (e) {
            // Fallback for older systems or if file doesn't exist
            if (fs.existsSync('/etc/debian_version')) { return 'debian'; }
            if (fs.existsSync('/etc/arch-release')) { return 'arch'; }
            if (fs.existsSync('/etc/fedora-release')) { return 'fedora'; }
        }
        return 'unknown';
    }

    public static getInstallCommand(): InstallCommand | null {
        const platform = os.platform();

        switch (platform) {
            case 'win32':
                return {
                    command: 'start https://desktop.docker.com/win/main/amd64/Docker%20Desktop%20Installer.exe',
                    message: 'Please download and run the Docker Desktop installer.',
                    isUrl: true
                };

            case 'darwin': // macOS
                if (this.isBrewInstalled()) {
                    return {
                        command: 'brew install --cask --force --no-quarantine docker',
                        message: 'Installing Docker Desktop for macOS using Homebrew...'
                    };
                } else {
                    return {
                        command: 'echo "Homebrew not found. Installing Homebrew first..." && /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)" && brew install --cask --force --no-quarantine docker',
                        message: 'Homebrew not available. Installing Homebrew and Docker Desktop automatically...'
                    };
                }

            case 'linux': {
                const distro = this.getLinuxDistro();
                switch (distro) {
                    case 'ubuntu':
                    case 'debian':
                        return {
                            command: 'sudo apt-get update && sudo apt-get install -y docker.io',
                            message: 'This will install Docker using apt-get. Sudo password will be required.'
                        };
                    case 'arch':
                        return {
                            command: 'sudo pacman -Syu --noconfirm docker',
                            message: 'This will install Docker using pacman. Sudo password will be required.'
                        };
                    case 'fedora':
                        return {
                            command: 'sudo dnf install -y dnf-plugins-core && sudo dnf config-manager --add-repo https://download.docker.com/linux/fedora/docker-ce.repo && sudo dnf install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin',
                            message: 'This will add the Docker repository and install it using dnf. Sudo password will be required.'
                        };
                    default:
                        return {
                            command: 'open https://docs.docker.com/engine/install/',
                            message: `Unsupported Linux distribution '${distro}'. Please install Docker manually.`,
                            isUrl: true
                        };
                }
            }

            default:
                return null;
        }
    }

    private static isCommandAvailable(command: string): boolean {
        try {
            const probe = process.platform === 'win32' ? `where ${command}` : `which ${command}`;
            cp.execSync(probe, { stdio: 'ignore' });
            return true;
        } catch {
            return false;
        }
    }

    private static async waitForDockerReady(timeoutMs = 300000): Promise<void> { // Increased to 5 minutes
        const start = Date.now();
        let attempts = 0;
        let lastError = '';

        dockerInstallOutput.appendLine(`Waiting for Docker to be ready (timeout: ${timeoutMs}ms)...`);

        while (Date.now() - start < timeoutMs) {
            attempts++;
            try {
                dockerInstallOutput.appendLine(`Docker readiness check #${attempts}...`);

                // First check if Docker daemon is running
                cp.execSync('docker ps', { stdio: 'ignore', timeout: 5000 });
                dockerInstallOutput.appendLine(`Docker is ready after ${attempts} attempts (${((Date.now() - start) / 1000).toFixed(1)}s)`);
                return;
            } catch (error: any) {
                lastError = error.message;
                dockerInstallOutput.appendLine(`Attempt ${attempts} failed: ${error.message}`);

                // If permission error, try to add current user to docker group (takes effect in next session)
                if (lastError.includes('permission denied') || lastError.includes('connection refused')) {
                    dockerInstallOutput.appendLine('Attempting to add current user to docker group...');
                    try {
                        const currentUser = cp.execSync('whoami', { encoding: 'utf8' }).trim();
                        cp.execSync(`sudo usermod -aG docker ${currentUser}`, { stdio: 'ignore' });
                        dockerInstallOutput.appendLine(`Added user ${currentUser} to docker group`);
                    } catch (groupError: any) {
                        dockerInstallOutput.appendLine(`Failed to add user to docker group: ${groupError.message}`);
                    }
                }

                await new Promise(r => setTimeout(r, 5000)); // Check every 5 seconds, more frequent
            }
        }
        throw new Error(`Docker failed to start after ${attempts} attempts (${((Date.now() - start) / 1000).toFixed(1)}s). Last error: ${lastError}`);
    }

    /**
     * Shows a single progress notification; avoids explicit UI guidance.
     */
    public static async ensureDockerAvailableSilently(): Promise<void> {
        // If already available, just return
        try {
            cp.execSync('docker --version', { stdio: 'ignore' });
            return;
        } catch { }

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Preparing to run environment...',
            cancellable: false
        }, async (progress) => {
            dockerInstallOutput.appendLine('Starting silent Docker installation...');
            const platform = os.platform();

            function run(cmd: string, args: string[], cwd?: string): Promise<number> {
                return new Promise((resolve) => {
                    const child = cp.spawn(cmd, args, { cwd, shell: false });
                    child.stdout.on('data', d => dockerInstallOutput.append(d.toString()));
                    child.stderr.on('data', d => dockerInstallOutput.append(d.toString()));
                    child.on('close', code => resolve(code ?? 0));
                });
            }

            try {
                if (platform === 'win32') {
                    // Prefer winget, then choco
                    if (this.isCommandAvailable('winget')) {
                        progress.report({ message: 'Installing Docker Desktop via winget (silently)...' });
                        await run('winget', ['install', '-e', '--id', 'Docker.DockerDesktop', '--silent', '--accept-package-agreements', '--accept-source-agreements']);
                    } else if (this.isCommandAvailable('choco')) {
                        progress.report({ message: 'Installing Docker Desktop via choco (silently)...' });
                        await run('choco', ['install', 'docker-desktop', '-y', '--no-progress']);
                    }
                    // Try to launch Docker Desktop
                    try {
                        // Try to start Docker Desktop from PATH first
                        cp.spawn('Docker Desktop.exe', [], { detached: true, stdio: 'ignore' });
                    } catch (error) {
                        console.error('Failed to start Docker Desktop from PATH:', error);
                        dockerInstallOutput.appendLine(`Failed to start Docker Desktop from PATH: ${(error as any)?.message || String(error)}`);
                        try {
                            // Try common installation paths
                            const commonPaths = [
                                'C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe',
                                'C:\\Program Files (x86)\\Docker\\Docker\\Docker Desktop.exe',
                                'C:\\Program Files\\Docker\\Docker Desktop\\Docker Desktop.exe',
                                'C:\\Program Files (x86)\\Docker\\Docker Desktop\\Docker Desktop.exe'
                            ];

                            let started = false;
                            for (const dockerPath of commonPaths) {
                                try {
                                    cp.spawn('cmd', ['/c', 'start', '', `"${dockerPath}"`], { detached: true, stdio: 'ignore' });
                                    started = true;
                                    dockerInstallOutput.appendLine(`Started Docker Desktop from: ${dockerPath}`);
                                    break;
                                } catch (pathError: any) {
                                    // Continue to next path
                                }
                            }

                            if (!started) {
                                throw new Error('Could not find Docker Desktop in common installation paths');
                            }
                        } catch (fallbackError: any) {
                            console.error('Failed to start Docker Desktop from fallback paths:', fallbackError);
                            dockerInstallOutput.appendLine(`Failed to start Docker Desktop from fallback paths: ${fallbackError?.message || String(fallbackError)}`);
                        }
                    }
                } else if (platform === 'darwin') {
                    const isArm64 = process.arch === 'arm64';
                    dockerInstallOutput.appendLine(`macOS ${isArm64 ? 'ARM64' : 'Intel'} 检测到 - 开始macOS Docker安装过程`);

                    // 关键步骤1: 安装Homebrew（如果没有）
                    if (!this.isCommandAvailable('brew')) {
                        dockerInstallOutput.appendLine('正在安装 Homebrew...');
                        progress.report({ message: '安装 Homebrew...' });
                        try {
                            const brewInstallCmd = isArm64
                                ? '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"'
                                : '/usr/bin/ruby -e "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/master/install)"';

                            await new Promise<void>((resolve, reject) => {
                                const brewProcess = cp.exec(brewInstallCmd, (error, stdout, stderr) => {
                                    if (error) {
                                        dockerInstallOutput.appendLine(`Homebrew 安装失败: ${error.message}`);
                                        reject(error);
                                        return;
                                    }
                                    dockerInstallOutput.appendLine('✅ Homebrew 安装成功');
                                    resolve();
                                });
                            });
                        } catch (error: any) {
                            dockerInstallOutput.appendLine(`无法安装 Homebrew: ${error.message}`);
                            // 继续尝试，在某些情况下 Homebrew 可能已经存在但检测不准确
                        }
                    }

                    // 关键步骤2: 检查并安装Docker Desktop
                    progress.report({ message: '安装 Docker Desktop...' });

                    // 检查 Docker 是否已经安装
                    const dockerPaths = [
                        '/Applications/Docker.app',
                        `${os.homedir()}/Applications/Docker.app`,
                        '/opt/homebrew/bin/docker',
                        '/usr/local/bin/docker'
                    ];

                    let dockerFound = false;
                    let dockerPath = '';

                    for (const path of dockerPaths) {
                        if (fs.existsSync(path)) {
                            dockerFound = true;
                            dockerPath = path;
                            dockerInstallOutput.appendLine(`✅ 找到 Docker 安装: ${path}`);
                            break;
                        }
                    }

                    // 如果没找到，安装 Docker Desktop
                    if (!dockerFound) {
                        dockerInstallOutput.appendLine('正在通过 Homebrew 安装 Docker Desktop...');
                        try {
                            await new Promise<void>((resolve, reject) => {
                                const installProcess = cp.exec('brew install --cask --no-quarantine docker', {
                                    timeout: 1200000 // 20分钟超时
                                }, (error, stdout, stderr) => {
                                    if (error) {
                                        dockerInstallOutput.appendLine(`Docker Desktop 安装失败: ${error.message}`);
                                        dockerInstallOutput.appendLine(`STDOUT: ${stdout}`);
                                        dockerInstallOutput.appendLine(`STDERR: ${stderr}`);
                                        reject(error);
                                        return;
                                    }
                                    dockerInstallOutput.appendLine('✅ Docker Desktop 安装成功');
                                    dockerPath = '/Applications/Docker.app';
                                    resolve();
                                });
                            });
                        } catch (error: any) {
                            dockerInstallOutput.appendLine(`🍺 Homebrew 安装失败，正在尝试直接下载...`);

                            // 备用方案：直接下载 DMG 文件
                            try {
                                dockerInstallOutput.appendLine('正在下载 Docker Desktop DMG 文件...');
                                const downloadUrl = isArm64
                                    ? 'https://desktop.docker.com/mac/main/arm64/Docker.dmg'
                                    : 'https://desktop.docker.com/mac/main/amd64/Docker.dmg';

                                const dmgPath = '/tmp/Docker.dmg';
                                const mountPath = '/Volumes/Docker';

                                // 下载 DMG
                                await new Promise<void>((resolve, reject) => {
                                    const curl = cp.exec(`curl -L -o ${dmgPath} "${downloadUrl}"`, (error) => {
                                        if (error) {
                                            reject(new Error(`下载失败: ${error.message}`));
                                            return;
                                        }
                                        dockerInstallOutput.appendLine('✅ Docker DMG 下载完成');
                                        resolve();
                                    });
                                });

                                // 挂载 DMG
                                dockerInstallOutput.appendLine('正在挂载 Docker DMG...');
                                cp.execSync(`hdiutil attach "${dmgPath}" -mountpoint "${mountPath}" -nobrowse`, { stdio: 'inherit' });

                                // 复制到应用程序
                                dockerInstallOutput.appendLine('正在安装 Docker Desktop 到应用程序...');
                                cp.execSync(`sudo cp -R "${mountPath}/Docker.app" /Applications/`, { stdio: 'inherit' });

                                // 设置权限
                                dockerInstallOutput.appendLine('设置 Docker Desktop 权限...');
                                cp.execSync('sudo chown -R $USER:admin /Applications/Docker.app', { stdio: 'inherit' });
                                cp.execSync('sudo chmod -R 755 /Applications/Docker.app', { stdio: 'inherit' });
                                cp.execSync('sudo xattr -cr /Applications/Docker.app', { stdio: 'inherit' });

                                // 卸载 DMG
                                cp.execSync(`hdiutil detach "${mountPath}"`, { stdio: 'inherit' });
                                cp.execSync(`rm "${dmgPath}"`, { stdio: 'inherit' });

                                dockerInstallOutput.appendLine('✅ Docker Desktop 通过 DMG 安装完成');
                                dockerPath = '/Applications/Docker.app';
                                dockerFound = true;

                            } catch (fallbackError: any) {
                                dockerInstallOutput.appendLine(`DMG 安装失败: ${fallbackError.message}`);
                                throw new Error(`Docker 在 macOS 上安装失败: ${error.message} 和 ${fallbackError.message}`);
                            }
                        }
                    }

                    // 关键步骤3: 启动 Docker Desktop
                    progress.report({ message: '启动 Docker Desktop...' });
                    dockerInstallOutput.appendLine('启动 Docker Desktop...');

                    let launchSuccess = false;
                    try {
                        // 尝试多种启动方式
                        const launchCommands = [
                            'open -a Docker --hide',
                            'open -j -g -a Docker',
                            `open "${dockerPath || '/Applications/Docker.app'}"`
                        ];

                        for (const cmd of launchCommands) {
                            try {
                                dockerInstallOutput.appendLine(`尝试启动命令: ${cmd}`);
                                cp.execSync(cmd, { stdio: 'ignore', timeout: 3000 });
                                launchSuccess = true;
                                dockerInstallOutput.appendLine('✅ Docker Desktop 启动成功');
                                break;
                            } catch (cmdError: any) {
                                dockerInstallOutput.appendLine(`启动方式失败: ${cmdError.message}`);
                            }
                        }

                        if (!launchSuccess) {
                            throw new Error('所有启动方式都失败了');
                        }

                        // 等待 Docker 服务启动
                        dockerInstallOutput.appendLine('等待 Docker 服务启动...');
                        const waitTime = launchSuccess ? 25000 : 20000; // 启动成功等待更长时间
                        await new Promise(resolve => setTimeout(resolve, waitTime));

                    } catch (startError: any) {
                        dockerInstallOutput.appendLine(`Docker Desktop 启动失败: ${startError.message}`);
                        dockerInstallOutput.appendLine('请手动启动 Docker Desktop，然后重试扩展安装');
                        // 不抛出错误，让等待逻辑处理
                    }

                    // 步骤4: 设置环境
                    try {
                        dockerInstallOutput.appendLine('配置 Docker 环境...');

                        // 如果之前安装了 DMG，确保在 PATH 中
                        if (dockerFound && dockerPath.includes('/Applications/')) {
                            dockerInstallOutput.appendLine('添加 Docker 到系统 PATH...');
                            const dockerBinaryPath = '/Applications/Docker.app/Contents/Resources/bin';
                            if (fs.existsSync(dockerBinaryPath)) {
                                // 这里扩展可能无法永久修改用户PATH，但在本地环境中可以使用
                                dockerInstallOutput.appendLine(`Docker 安装路径: ${dockerBinaryPath}`);
                            }
                        }
                    } catch (envError: any) {
                        dockerInstallOutput.appendLine(`环境配置警告: ${envError.message}`);
                    }

                    dockerInstallOutput.appendLine('🛠️ macOS Docker Desktop 安装流程完成');
                } else if (platform === 'linux') {
                    // Best-effort: use distro-specific commands non-interactively
                    const distro = this.getLinuxDistro();
                    progress.report({ message: `Installing Docker via ${distro} package manager...` });
                    try {
                        if (distro === 'ubuntu' || distro === 'debian') {
                            dockerInstallOutput.appendLine('Updating package lists...');
                            await run('sudo', ['apt-get', 'update', '-q']);
                            dockerInstallOutput.appendLine('Installing Docker.io package...');
                            await run('sudo', ['apt-get', 'install', '-y', 'docker.io']);
                        } else if (distro === 'arch') {
                            await run('bash', ['-lc', 'sudo pacman -Syu --noconfirm docker']);
                        } else if (distro === 'fedora') {
                            await run('bash', ['-lc', 'sudo dnf install -y dnf-plugins-core && sudo dnf config-manager --add-repo https://download.docker.com/linux/fedora/docker-ce.repo && sudo dnf install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin']);
                        }

                        // Verify installation
                        const dockerVersion = cp.execSync('docker --version', { encoding: 'utf8', stdio: 'ignore' }).trim();
                        dockerInstallOutput.appendLine(`Docker installed successfully: ${dockerVersion}`);

                    } catch (error) {
                        dockerInstallOutput.appendLine(`Failed to install Docker via package manager: ${(error as any)?.message || String(error)}`);
                        throw error;
                    }

                    // Start and enable Docker service
                    progress.report({ message: 'Starting Docker service...' });
                    try {
                        dockerInstallOutput.appendLine('Enabling Docker service...');
                        cp.execSync('sudo systemctl enable docker', { stdio: 'ignore' });

                        dockerInstallOutput.appendLine('Starting Docker service...');
                        cp.execSync('sudo systemctl start docker', { stdio: 'ignore' });

                        // Check service status
                        const serviceStatus = cp.execSync('sudo systemctl is-active docker', { encoding: 'utf8' }).trim();
                        dockerInstallOutput.appendLine(`Docker service status: ${serviceStatus}`);

                        if (serviceStatus !== 'active') {
                            throw new Error(`Docker service not active, status: ${serviceStatus}`);
                        }

                    } catch (error: any) {
                        dockerInstallOutput.appendLine(`Failed to start Docker service: ${error?.message || String(error)}`);
                        throw error;
                    }
                }

                progress.report({ message: 'Waiting for Docker to be ready...' });
                await this.waitForDockerReady();
                dockerInstallOutput.appendLine('Docker is ready.');
            } catch (e: any) {
                dockerInstallOutput.appendLine(`Silent installation failed: ${e?.message || String(e)}`);
                // Pass error to upper layer, let caller decide how to handle
                throw e;
            }
        });
    }
}
