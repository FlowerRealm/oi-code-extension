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
                    dockerInstallOutput.appendLine(`macOS ${isArm64 ? 'ARM64' : 'Intel'} architecture detected`);

                    // Check if Homebrew is available first
                    if (!this.isCommandAvailable('brew')) {
                        dockerInstallOutput.appendLine('Homebrew not found. Installing Homebrew first...');
                        try {
                            // Install Homebrew for macOS
                            const installBrewCmd = isArm64
                                ? '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"'
                                : '/usr/bin/ruby -e "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/master/install)"';

                            const installProcess = cp.execSync(installBrewCmd, {
                                stdio: 'inherit',
                                timeout: 300000 // 5 minutes
                            });
                            dockerInstallOutput.appendLine('Homebrew installed successfully');
                        } catch (error: any) {
                            dockerInstallOutput.appendLine(`Failed to install Homebrew: ${error.message}`);
                            throw new Error(`Failed to install Homebrew: ${error.message}`);
                        }
                    }

                    // Check if Docker Desktop CLI is already available in PATH
                    let dockerCliAvailable = this.isCommandAvailable('docker');

                    // Check for Docker Desktop application
                    progress.report({ message: 'Checking Docker Desktop installation...' });
                    const dockerPaths = [
                        '/Applications/Docker.app',
                        `${os.homedir()}/Applications/Docker.app`,
                        '/opt/homebrew/bin/docker', // ARM64 Homebrew
                        '/usr/local/bin/docker' // Intel Homebrew
                    ];

                    let dockerInstalled = dockerCliAvailable;
                    let dockerPath = '';

                    // Check for installed Docker application
                    for (const path of dockerPaths) {
                        if (fs.existsSync(path) || (path.includes('/bin/docker') && this.isCommandAvailable('docker'))) {
                            dockerInstalled = true;
                            dockerPath = path;
                            dockerInstallOutput.appendLine(`Found Docker at: ${path}`);
                            break;
                        }
                    }

                    // If Docker is not available, install it
                    if (!dockerInstalled) {
                        dockerInstallOutput.appendLine('Docker not found. Installing Docker Desktop...');
                        progress.report({ message: 'Installing Docker Desktop...' });

                        try {
                            // Install Docker Desktop using Homebrew (works for both Intel and ARM64)
                            dockerInstallOutput.appendLine('Running: brew install --cask --no-quarantine docker');
                            const installResult = cp.execSync('brew install --cask --no-quarantine docker', {
                                stdio: ['ignore', 'pipe', 'pipe'],
                                timeout: 900000, // 15 minute timeout for Docker Desktop installation
                                maxBuffer: 1024 * 1024,
                                env: { ...process.env, HOMEBREW_NO_AUTO_UPDATE: '1' }
                            });

                            if (installResult) {
                                dockerInstallOutput.appendLine('Docker Desktop installed successfully');
                                dockerPath = '/Applications/Docker.app';
                                dockerInstalled = true;
                            } else {
                                throw new Error('brew install command failed');
                            }
                        } catch (error: any) {
                            dockerInstallOutput.appendLine(`Failed to install Docker Desktop: ${error.message}`);

                            // Fallback: Try direct download for ARM64
                            if (isArm64) {
                                try {
                                    dockerInstallOutput.appendLine('Attempting ARM64 fallback installation...');
                                    const downloadUrl = 'https://desktop.docker.com/mac/main/arm64/Docker.dmg';
                                    const dmgPath = '/tmp/Docker.dmg';
                                    const mountPath = '/Volumes/Docker';

                                    // Download and mount DMG
                                    cp.execSync(`curl -L -o ${dmgPath} ${downloadUrl}`, { stdio: 'inherit' });
                                    cp.execSync(`hdiutil attach ${dmgPath} -mountpoint ${mountPath} -nobrowse`, { stdio: 'inherit' });

                                    // Copy Docker app
                                    cp.execSync(`cp -r "${mountPath}/Docker.app" /Applications/`, { stdio: 'inherit' });

                                    // Unmount and cleanup
                                    cp.execSync(`hdiutil detach ${mountPath}`, { stdio: 'inherit' });
                                    cp.execSync(`rm ${dmgPath}`, { stdio: 'inherit' });

                                    dockerInstallOutput.appendLine('Docker Desktop installed via DMG fallback');
                                    dockerPath = '/Applications/Docker.app';
                                    dockerInstalled = true;

                                } catch (fallbackError: any) {
                                    dockerInstallOutput.appendLine(`ARM64 fallback installation failed: ${fallbackError.message}`);
                                    throw new Error(`Docker installation failed on macOS ARM64: ${error.message}`);
                                }
                            } else {
                                throw new Error(`Docker installation failed: ${error.message}`);
                            }
                        }
                    }

                    // Launch Docker Desktop (critical for CI environments)
                    if (dockerInstalled) {
                        progress.report({ message: 'Starting Docker Desktop...' });
                        try {
                            // Launch Docker Desktop (works for both ARM64 and Intel)
                            dockerInstallOutput.appendLine(`Launching Docker Desktop from: ${dockerPath || '/Applications/Docker.app'}`);

                            // Try multiple launch methods for CI stability
                            const launchMethods = [
                                () => cp.execSync('open -a Docker', { stdio: 'ignore', timeout: 5000 }),
                                () => cp.execSync('open -j -g -a Docker', { stdio: 'ignore', timeout: 5000 }),
                                () => cp.spawn('open', ['-j', '-g', '-a', 'Docker'], { detached: true, stdio: 'ignore' })
                            ];

                            let launched = false;
                            for (let i = 0; i < launchMethods.length && !launched; i++) {
                                try {
                                    launchMethods[i]();
                                    launched = true;
                                    dockerInstallOutput.appendLine(`Docker Desktop launched successfully (method ${i + 1})`);
                                } catch (launchError: any) {
                                    dockerInstallOutput.appendLine(`Launch method ${i + 1} failed: ${launchError.message}`);
                                }
                            }

                            if (!launched) {
                                dockerInstallOutput.appendLine('All Docker launch methods failed, but continuing...');
                            }

                            // Wait longer for Docker daemon to start in CI
                            dockerInstallOutput.appendLine('Waiting for Docker daemon to start...');
                            const waitTime = launched ? 20000 : 15000; // Wait longer if we launched it
                            await new Promise(resolve => setTimeout(resolve, waitTime));

                        } catch (error: any) {
                            dockerInstallOutput.appendLine(`Failed to start Docker Desktop: ${error.message}`);
                            // Don't throw here - let the waitForDockerReady handle timeout
                        }
                    } else {
                        dockerInstallOutput.appendLine('Docker installation was unsuccessful');
                        throw new Error('Docker installation failed - no Docker installation found or completed');
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
