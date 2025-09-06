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
                // Windows: Install Docker CLI and guide users to set up Docker Desktop with WSL 2
                return {
                    command: 'powershell -Command "Set-ExecutionPolicy Bypass -Scope Process -Force; [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072; iex ((New-Object System.Net.WebClient).DownloadString(\'https://community.chocolatey.org/install.ps1\')); choco install -y docker-cli"',
                    message: 'Installing Docker CLI via Chocolatey. Please install Docker Desktop and enable WSL 2 integration.'
                };

            case 'darwin': // macOS
                if (this.isBrewInstalled()) {
                    return {
                        command: 'brew install docker docker-compose docker-machine colima',
                        message: 'Installing Docker CLI and Colima via Homebrew...'
                    };
                } else {
                    return {
                        command: 'echo "Installing Homebrew first..." && /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)" && brew install docker docker-compose docker-machine colima',
                        message: 'Installing Homebrew and Docker CLI with Colima...'
                    };
                }

            case 'linux': {
                const distro = this.getLinuxDistro();
                switch (distro) {
                    case 'ubuntu':
                    case 'debian':
                        return {
                            command: 'sudo apt-get update && sudo apt-get install -y docker.io docker-compose containerd',
                            message: 'Installing Docker CLI and Docker Compose via apt-get...'
                        };
                    case 'arch':
                        return {
                            command: 'sudo pacman -Syu --noconfirm docker docker-compose',
                            message: 'Installing Docker CLI and Docker Compose via pacman...'
                        };
                    case 'fedora':
                        return {
                            command: 'sudo dnf install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin',
                            message: 'Installing Docker CLI and Docker Compose via dnf...'
                        };
                    default:
                        return {
                            command: 'curl -fsSL https://get.docker.com -o get-docker.sh && sh get-docker.sh',
                            message: 'Installing Docker CLI via official script...'
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
            title: 'Preparing Docker CLI environment...',
            cancellable: false
        }, async (progress) => {
            dockerInstallOutput.appendLine('Starting Docker CLI installation...');
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
                    progress.report({ message: 'Installing Docker CLI on Windows...' });

                    // Install Chocolatey if not available
                    if (!this.isCommandAvailable('choco')) {
                        dockerInstallOutput.appendLine('Installing Chocolatey package manager...');
                        await run('powershell', [
                            '-Command',
                            'Set-ExecutionPolicy Bypass -Scope Process -Force; [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072; iex ((New-Object System.Net.WebClient).DownloadString(\'https://community.chocolatey.org/install.ps1\'))'
                        ]);
                    }

                    // Install Docker CLI only
                    dockerInstallOutput.appendLine('Installing Docker CLI...');
                    await run('choco', ['install', '-y', 'docker-cli']);

                    // Guide users to install Docker Desktop with WSL 2
                    dockerInstallOutput.appendLine('');
                    dockerInstallOutput.appendLine('IMPORTANT: Please install Docker Desktop from https://www.docker.com/products/docker-desktop');
                    dockerInstallOutput.appendLine('1. Run the installer with default settings');
                    dockerInstallOutput.appendLine('2. Enable WSL 2 integration in Docker Desktop settings');
                    dockerInstallOutput.appendLine('3. Restart Docker Desktop after enabling WSL 2');
                    dockerInstallOutput.appendLine('4. Verify Docker is working with: docker --version');
                    dockerInstallOutput.appendLine('');

                } else if (platform === 'darwin') {
                    progress.report({ message: 'Installing Docker CLI on macOS...' });

                    // Install Homebrew if not available
                    if (!this.isCommandAvailable('brew')) {
                        dockerInstallOutput.appendLine('Installing Homebrew...');
                        await run('/bin/bash', ['-c', '"$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"']);

                        // Add Homebrew to PATH for both Apple Silicon and Intel Macs
                        try {
                            const homebrewPath = cp.execSync('echo "$(brew --prefix)/bin"', { encoding: 'utf8' }).trim();
                            process.env.PATH = `${homebrewPath}:${process.env.PATH}`;
                            dockerInstallOutput.appendLine(`Added Homebrew to PATH: ${homebrewPath}`);
                        } catch (pathError) {
                            dockerInstallOutput.appendLine('Could not determine Homebrew path, continuing...');
                        }
                    }

                    // Install Docker CLI and Docker Compose
                    dockerInstallOutput.appendLine('Installing Docker CLI and Docker Compose...');
                    await run('brew', ['install', 'docker', 'docker-compose']);

                    // Install Colima (Docker Desktop alternative)
                    dockerInstallOutput.appendLine('Installing Colima...');
                    await run('brew', ['install', 'colima']);

                    // Start Colima (Docker runtime)
                    dockerInstallOutput.appendLine('Starting Colima Docker runtime...');
                    try {
                        const colimaStatus = cp.execSync('colima status', { encoding: 'utf8', stdio: 'pipe' }).trim();
                        dockerInstallOutput.appendLine(`Colima status: ${colimaStatus}`);

                        if (colimaStatus.includes('running')) {
                            dockerInstallOutput.appendLine('Colima already running');
                        } else {
                            dockerInstallOutput.appendLine('Starting Colima...');
                            await run('colima', ['start', '--memory', '4', '--cpu', '2']);
                        }
                    } catch (statusError) {
                        dockerInstallOutput.appendLine('Colima not running, starting...');
                        await run('colima', ['start', '--memory', '4', '--cpu', '2']);
                    }

                    // Setup Docker environment
                    dockerInstallOutput.appendLine('Setting up Docker environment...');
                    try {
                        // Get Docker context from colima
                        const dockerContext = cp.execSync('docker context ls', { encoding: 'utf8' });
                        dockerInstallOutput.appendLine(`Docker contexts:\n${dockerContext}`);

                        // Use colima context
                        await run('docker', ['context', 'use', 'colima']);
                        dockerInstallOutput.appendLine('Docker context set to colima');

                        // Test Docker connection
                        const dockerVersion = cp.execSync('docker --version', { encoding: 'utf8' }).trim();
                        dockerInstallOutput.appendLine(`Docker version: ${dockerVersion}`);

                        const dockerInfo = cp.execSync('docker info', { encoding: 'utf8', stdio: 'pipe' }).trim();
                        dockerInstallOutput.appendLine(`Docker info: ${dockerInfo}`);

                    } catch (envError: any) {
                        dockerInstallOutput.appendLine(`Docker environment setup warning: ${envError.message}`);
                        // Try alternative approach
                        dockerInstallOutput.appendLine('Trying alternative Docker setup...');

                        // Set DOCKER_HOST environment variable
                        process.env.DOCKER_HOST = `unix://${os.homedir()}/.colima/default/docker.sock`;

                        // Test Docker connection again
                        try {
                            const testResult = cp.execSync('docker ps', { encoding: 'utf8', stdio: 'pipe' }).trim();
                            dockerInstallOutput.appendLine('Docker connection test successful');
                        } catch (testError: any) {
                            dockerInstallOutput.appendLine(`Docker connection test failed: ${testError.message}`);
                        }
                    }
                } else if (platform === 'linux') {
                    progress.report({ message: 'Installing Docker CLI on Linux...' });
                    const distro = this.getLinuxDistro();

                    // Install Docker CLI based on distribution
                    if (distro === 'ubuntu' || distro === 'debian') {
                        dockerInstallOutput.appendLine('Updating package lists...');
                        await run('sudo', ['apt-get', 'update', '-q']);
                        dockerInstallOutput.appendLine('Installing Docker CLI...');
                        await run('sudo', ['apt-get', 'install', '-y', 'docker.io', 'docker-compose', 'containerd']);
                    } else if (distro === 'arch') {
                        await run('sudo', ['pacman', '-Syu', '--noconfirm', 'docker', 'docker-compose']);
                    } else if (distro === 'fedora') {
                        await run('sudo', ['dnf', 'install', '-y', 'docker-ce', 'docker-ce-cli', 'containerd.io', 'docker-compose-plugin']);
                    } else {
                        // Use official Docker install script for other distributions
                        dockerInstallOutput.appendLine('Using official Docker install script...');
                        await run('bash', ['-c', 'curl -fsSL https://get.docker.com -o get-docker.sh && sh get-docker.sh']);
                    }

                    // Start and enable Docker service
                    progress.report({ message: 'Starting Docker service...' });
                    dockerInstallOutput.appendLine('Enabling Docker service...');
                    await run('sudo', ['systemctl', 'enable', 'docker']);

                    dockerInstallOutput.appendLine('Starting Docker service...');
                    await run('sudo', ['systemctl', 'start', 'docker']);

                    // Add current user to docker group
                    try {
                        const currentUser = cp.execSync('whoami', { encoding: 'utf8' }).trim();
                        dockerInstallOutput.appendLine(`Adding user ${currentUser} to docker group...`);
                        await run('sudo', ['usermod', '-aG', 'docker', currentUser]);
                        dockerInstallOutput.appendLine('Note: You may need to log out and log back in for group changes to take effect');
                    } catch (groupError: any) {
                        dockerInstallOutput.appendLine(`Warning: Could not add user to docker group: ${groupError.message}`);
                    }
                }

                progress.report({ message: 'Waiting for Docker to be ready...' });
                await this.waitForDockerReady();
                dockerInstallOutput.appendLine('Docker CLI is ready.');

            } catch (e: any) {
                dockerInstallOutput.appendLine(`Docker CLI installation failed: ${e?.message || String(e)}`);
                throw e;
            }
        });
    }
}
