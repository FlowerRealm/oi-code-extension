/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as os from 'os';
import * as cp from 'child_process';
import * as fs from 'fs';
import * as vscode from 'vscode';

// 创建统一的输出通道
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
                        command: 'brew install --cask docker',
                        message: 'This will install Docker Desktop using Homebrew.'
                    };
                } else {
                    return {
                        command: 'open https://desktop.docker.com/mac/main/amd64/Docker.dmg',
                        message: 'Homebrew not found. Please download and install Docker manually.',
                        isUrl: true
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

    private static async waitForDockerReady(timeoutMs = 180000): Promise<void> {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
            try {
                cp.execSync('docker info', { stdio: 'ignore' });
                return;
            } catch {
                await new Promise(r => setTimeout(r, 3000));
            }
        }
        throw new Error('Waiting for Docker to be ready timeout');
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
                    if (this.isCommandAvailable('brew')) {
                        progress.report({ message: 'Installing Docker Desktop via Homebrew (silently)...' });
                        try {
                            // 尝试非交互式安装，如果失败则记录错误但不抛出
                            const result = cp.spawnSync('brew', ['install', '--cask', 'docker'], {
                                stdio: ['ignore', 'pipe', 'pipe'],
                                timeout: 300000 // 5分钟超时
                            });

                            if (result.status === 0) {
                                dockerInstallOutput.appendLine('Docker Desktop installed successfully via Homebrew');
                            } else {
                                const errorMsg = result.stderr?.toString() || 'Unknown error';
                                dockerInstallOutput.appendLine(`Homebrew installation failed: ${errorMsg}`);
                                console.warn('Homebrew Docker installation failed:', errorMsg);
                            }
                        } catch (error: any) {
                            console.error('Failed to install Docker via Homebrew:', error);
                            dockerInstallOutput.appendLine(`Failed to install Docker via Homebrew: ${error?.message || String(error)}`);
                        }
                    } else {
                        dockerInstallOutput.appendLine('Homebrew not available for Docker installation');
                    }

                    // 尝试启动Docker Desktop
                    progress.report({ message: 'Attempting to start Docker Desktop...' });
                    try {
                        // 首先检查Docker.app是否存在于标准位置
                        const standardPath = '/Applications/Docker.app';
                        const altPath = `${os.homedir()}/Applications/Docker.app`;

                        let dockerPath = standardPath;
                        if (!fs.existsSync(standardPath) && fs.existsSync(altPath)) {
                            dockerPath = altPath;
                        }

                        if (fs.existsSync(dockerPath)) {
                            cp.spawn('open', [dockerPath], { detached: true, stdio: 'ignore' });
                            dockerInstallOutput.appendLine(`Started Docker Desktop from: ${dockerPath}`);
                        } else {
                            dockerInstallOutput.appendLine('Docker Desktop application not found in standard locations');
                            // 尝试通过Spotlight查找
                            try {
                                cp.spawn('mdfind', ['-name', 'Docker.app'], { stdio: 'ignore' });
                            } catch {
                                dockerInstallOutput.appendLine('Could not search for Docker.app via Spotlight');
                            }
                        }
                    } catch (error: any) {
                        console.error('Failed to start Docker Desktop on macOS:', error);
                        dockerInstallOutput.appendLine(`Failed to start Docker Desktop on macOS: ${error?.message || String(error)}`);
                    }
                } else if (platform === 'linux') {
                    // Best-effort: use distro-specific commands non-interactively
                    const distro = this.getLinuxDistro();
                    progress.report({ message: `Installing Docker via ${distro} package manager (silently)...` });
                    try {
                        if (distro === 'ubuntu' || distro === 'debian') {
                            await run('bash', ['-lc', 'sudo apt-get update && sudo apt-get install -y docker.io']);
                        } else if (distro === 'arch') {
                            await run('bash', ['-lc', 'sudo pacman -Syu --noconfirm docker']);
                        } else if (distro === 'fedora') {
                            await run('bash', ['-lc', 'sudo dnf install -y dnf-plugins-core && sudo dnf config-manager --add-repo https://download.docker.com/linux/fedora/docker-ce.repo && sudo dnf install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin']);
                        }
                    } catch (error) {
                        dockerInstallOutput.appendLine(`Failed to install Docker via apt-get: ${(error as any)?.message || String(error)}`);
                    }
                    // Try starting docker service (if applicable)
                    try {
                        cp.execSync('sudo systemctl start docker', { stdio: 'ignore' });
                    } catch (error: any) {
                        dockerInstallOutput.appendLine(`Failed to start Docker service on Linux: ${error?.message || String(error)}`);
                    }
                }

                progress.report({ message: 'Waiting for Docker to be ready...' });
                await this.waitForDockerReady();
                dockerInstallOutput.appendLine('Docker is ready.');
            } catch (e: any) {
                dockerInstallOutput.appendLine(`Silent installation failed: ${e?.message || String(e)}`);
                // 向上层传递错误，让调用者决定如何处理
                throw e;
            }
        });
    }
}
