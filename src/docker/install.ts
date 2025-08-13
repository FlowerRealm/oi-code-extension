/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as os from 'os';
import * as cp from 'child_process';
import * as fs from 'fs';
import * as vscode from 'vscode';

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
        throw new Error('等待 Docker 就绪超时');
    }

    /**
     * Attempt to install and start Docker silently (best-effort) on Win/macOS/Linux.
     * Shows a single progress notification; avoids显式引导界面。
     */
    public static async ensureDockerAvailableSilently(): Promise<void> {
        // If already available, just return
        try {
            cp.execSync('docker --version', { stdio: 'ignore' });
            return;
        } catch { }

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: '正在准备运行环境...',
            cancellable: false
        }, async (progress) => {
            const output = vscode.window.createOutputChannel('OI-Code Docker Install');
            output.appendLine('开始静默安装 Docker...');
            const platform = os.platform();

            function run(cmd: string, args: string[], cwd?: string): Promise<number> {
                return new Promise((resolve) => {
                    const child = cp.spawn(cmd, args, { cwd, shell: false });
                    child.stdout.on('data', d => output.append(d.toString()));
                    child.stderr.on('data', d => output.append(d.toString()));
                    child.on('close', code => resolve(code ?? 0));
                });
            }

            try {
                if (platform === 'win32') {
                    // Prefer winget, then choco
                    if (this.isCommandAvailable('winget')) {
                        progress.report({ message: '通过 winget 安装 Docker Desktop（静默）...' });
                        await run('winget', ['install', '-e', '--id', 'Docker.DockerDesktop', '--silent', '--accept-package-agreements', '--accept-source-agreements']);
                    } else if (this.isCommandAvailable('choco')) {
                        progress.report({ message: '通过 choco 安装 Docker Desktop（静默）...' });
                        await run('choco', ['install', 'docker-desktop', '-y', '--no-progress']);
                    }
                    // Try to launch Docker Desktop
                    try {
                        cp.spawn('cmd', ['/c', 'start', '', 'C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe'], { detached: true, stdio: 'ignore' });
                    } catch { }
                } else if (platform === 'darwin') {
                    if (this.isCommandAvailable('brew')) {
                        progress.report({ message: '通过 Homebrew 安装 Docker Desktop（静默）...' });
                        await run('brew', ['install', '--cask', 'docker']);
                    }
                    try {
                        cp.spawn('open', ['-a', 'Docker'], { detached: true, stdio: 'ignore' });
                    } catch { }
                } else if (platform === 'linux') {
                    // Best-effort: use distro-specific commands non-interactively
                    const distro = this.getLinuxDistro();
                    progress.report({ message: `通过 ${distro} 包管理器安装 Docker（静默）...` });
                    try {
                        if (distro === 'ubuntu' || distro === 'debian') {
                            await run('bash', ['-lc', 'sudo apt-get update && sudo apt-get install -y docker.io']);
                        } else if (distro === 'arch') {
                            await run('bash', ['-lc', 'sudo pacman -Syu --noconfirm docker']);
                        } else if (distro === 'fedora') {
                            await run('bash', ['-lc', 'sudo dnf install -y dnf-plugins-core && sudo dnf config-manager --add-repo https://download.docker.com/linux/fedora/docker-ce.repo && sudo dnf install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin']);
                        }
                    } catch { }
                    // Try starting docker service (if applicable)
                    try { await run('bash', ['-lc', 'sudo systemctl start docker']); } catch { }
                }

                progress.report({ message: '等待 Docker 就绪...' });
                await this.waitForDockerReady();
                output.appendLine('Docker 已就绪。');
            } catch (e: any) {
                output.appendLine(`静默安装失败：${e?.message || e}`);
                // Do not throw to avoid打断主流程；由调用方决定后续引导
                throw e;
            }
        });
    }
}
