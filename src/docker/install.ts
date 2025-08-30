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
                    // Check if Homebrew is available first
                    if (!this.isCommandAvailable('brew')) {
                        dockerInstallOutput.appendLine('Homebrew not found. For macOS, Docker must be installed manually.');
                        dockerInstallOutput.appendLine('Please install Docker Desktop from: https://desktop.docker.com/mac/main/amd64/Docker.dmg');
                        throw new Error('Homebrew not available for Docker installation');
                    }

                    // Check if Docker Desktop is already installed
                    progress.report({ message: 'Checking Docker Desktop installation...' });
                    const dockerPaths = [
                        '/Applications/Docker.app',
                        `${os.homedir()}/Applications/Docker.app`,
                        '/Volumes/Docker/Docker.app' // Installation location
                    ];

                    let dockerInstalled = false;
                    let dockerPath = '';

                    for (const path of dockerPaths) {
                        if (fs.existsSync(path)) {
                            dockerInstalled = true;
                            dockerPath = path;
                            dockerInstallOutput.appendLine(`Found Docker Desktop at: ${path}`);
                            break;
                        }
                    }

                    // If Docker is not installed, install it via Homebrew
                    if (!dockerInstalled) {
                        progress.report({ message: 'Installing Docker Desktop via Homebrew...' });
                        dockerInstallOutput.appendLine('Installing Docker Desktop via Homebrew...');

                        try {
                            const installResult = cp.spawnSync('brew', ['install', '--cask', 'docker'], {
                                stdio: ['ignore', 'pipe', 'pipe'],
                                timeout: 600000, // 10 minute timeout for installation
                                maxBuffer: 1024 * 1024
                            });

                            if (installResult.status === 0) {
                                dockerInstallOutput.appendLine('Docker Desktop installed successfully via Homebrew');
                                dockerPath = '/Applications/Docker.app';
                            } else {
                                const errorMsg = installResult.stderr?.toString() || 'Unknown error';
                                const stdoutMsg = installResult.stdout?.toString() || '';

                                dockerInstallOutput.appendLine(`Homebrew installation failed: ${errorMsg}`);
                                if (stdoutMsg) {
                                    dockerInstallOutput.appendLine(`Installation output: ${stdoutMsg}`);
                                }
                                console.warn('Homebrew Docker installation failed');
                                throw new Error(`Failed to install Docker Desktop: ${errorMsg}`);
                            }
                        } catch (error: any) {
                            console.error('Failed to install Docker via Homebrew:', error);
                            dockerInstallOutput.appendLine(`Failed to install Docker via Homebrew: ${error?.message || String(error)}`);
                            throw error;
                        }
                    }

                    // Launch Docker Desktop if we have a path or just installed it
                    progress.report({ message: 'Starting Docker Desktop...' });
                    try {
                        const launchPath = dockerPath || '/Applications/Docker.app';

                        if (fs.existsSync(launchPath)) {
                            dockerInstallOutput.appendLine(`Attempting to start Docker Desktop from: ${launchPath}`);
                            cp.spawn('open', ['-j', '-g', '-a', 'Docker'], { detached: true, stdio: 'ignore' });

                            // Wait a bit for it to start
                            dockerInstallOutput.appendLine('Docker Desktop launched. Waiting for daemon to be ready...');
                            await new Promise(resolve => setTimeout(resolve, 10000));
                        } else {
                            dockerInstallOutput.appendLine('Docker Desktop app not found after installation');
                            throw new Error('Docker Desktop app not found after installation');
                        }
                    } catch (error: any) {
                        if (error.code === 'ENOENT') {
                            dockerInstallOutput.appendLine('Docker Desktop launch failed. Please start it manually.');
                        } else {
                            console.error('Failed to start Docker Desktop on macOS:', error);
                            dockerInstallOutput.appendLine(`Failed to start Docker Desktop: ${error?.message || String(error)}`);
                        }
                        throw error;
                    }
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
