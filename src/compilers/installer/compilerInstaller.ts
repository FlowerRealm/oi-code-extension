/* ---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *-------------------------------------------------------------------------------------------- */

import * as vscode from 'vscode';
import * as os from 'os';
import * as https from 'https';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { ProcessRunner } from '../../process';
import { LLVMInstallResult } from '../../types';

/**
 * Handles automatic LLVM installation for different platforms
 */
export class CompilerInstaller {
    private static outputChannel: vscode.OutputChannel | null = null;

    /**
     * Get or create output channel
     */
    public static getOutputChannel(): vscode.OutputChannel {
        if (!this.outputChannel) {
            this.outputChannel = vscode.window.createOutputChannel('OI-Code Compiler Installer');
        }
        return this.outputChannel;
    }

    /**
     * Install LLVM automatically based on platform
     */
    public static async installLLVM(): Promise<LLVMInstallResult> {
        const output = this.getOutputChannel();
        output.clear();
        output.appendLine('[CompilerInstaller] Starting LLVM installation...');

        const platform = process.platform;
        output.appendLine(`[CompilerInstaller] Detected platform: ${platform}`);

        return await this.installLLVMAutomatically(platform);
    }

    /**
     * Install LLVM for specific platform
     */
    private static async installLLVMAutomatically(platform: string): Promise<LLVMInstallResult> {
        try {
            switch (platform) {
                case 'win32':
                    return await this.installLLVMWindows();
                case 'darwin':
                    return await this.installLLVMMacOS();
                case 'linux':
                    return await this.installLLVMLinux();
                default:
                    return await this.showInstallationGuide();
            }
        } catch (error: any) {
            const errorResult: LLVMInstallResult = {
                success: false,
                message: `Installation failed: ${error.message}`
            };
            this.getOutputChannel().appendLine(`[CompilerInstaller] Installation failed: ${error.message}`);
            return errorResult;
        }
    }

    /**
     * Install LLVM on Windows
     */
    private static async installLLVMWindows(): Promise<LLVMInstallResult> {
        const output = this.getOutputChannel();
        output.appendLine('[CompilerInstaller] Starting Windows LLVM automatic installation...');

        try {
            // Check if LLVM is already installed
            const llvmPaths = ['C:\\Program Files\\LLVM\\bin', 'C:\\LLVM\\bin'];

            for (const llvmPath of llvmPaths) {
                if (await ProcessRunner.fileExists(llvmPath)) {
                    output.appendLine(`[CompilerInstaller] LLVM already found at: ${llvmPath}`);
                    return {
                        success: true,
                        message: 'LLVM is already installed on your system.',
                        installedPath: llvmPath,
                        suggestions: ['Restart VS Code to complete the setup']
                    };
                }
            }

            // Get latest LLVM version
            output.appendLine('[CompilerInstaller] Getting latest LLVM version...');
            const latestVersion = await this.getLatestLLVMVersion();
            const baseUrl = 'https://github.com/llvm/llvm-project/releases/download';
            const installerUrl = `${baseUrl}/llvmorg-${latestVersion}/LLVM-${latestVersion}-win64.exe`;
            const installerPath = `${os.tmpdir()}/LLVM-${latestVersion}-win64.exe`;

            // Download checksum first
            output.appendLine('[CompilerInstaller] Downloading checksum for verification...');
            const expectedChecksum = await this.getLLVMChecksum(latestVersion);

            // Show download progress
            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: 'Downloading LLVM Installer...',
                    cancellable: true
                },
                async (progress, _token) => {
                    try {
                        return new Promise<void>((resolve, reject) => {
                            const file = fs.createWriteStream(installerPath);
                            https
                                .get(installerUrl, (response: any) => {
                                    const totalSize = parseInt(response.headers['content-length'] || '0');
                                    let downloadedSize = 0;

                                    response.on('data', (chunk: any) => {
                                        downloadedSize += chunk.length;
                                        const percent = totalSize > 0 ? (downloadedSize / totalSize) * 100 : 0;
                                        progress.report({ increment: percent, message: `${Math.round(percent)}%` });
                                    });

                                    response.pipe(file);
                                    file.on('finish', () => {
                                        file.close();
                                        resolve();
                                    });
                                })
                                .on('error', reject);
                        });
                    } catch (error: any) {
                        throw new Error(`Failed to download LLVM installer: ${error.message}`);
                    }
                }
            );

            // Verify checksum
            output.appendLine('[CompilerInstaller] Verifying installer integrity...');
            const isValid = await this.verifyFileChecksum(installerPath, expectedChecksum);

            if (!isValid) {
                // Clean up the corrupted file
                if (fs.existsSync(installerPath)) {
                    fs.unlinkSync(installerPath);
                }
                throw new Error(
                    'Installer integrity check failed. The downloaded file may be corrupted or tampered with.'
                );
            }

            output.appendLine('[CompilerInstaller] Installer integrity verified successfully.');

            // Run installer
            output.appendLine('[CompilerInstaller] Running LLVM installer...');
            const installResult = await ProcessRunner.executeWithTimeout({
                command: installerPath,
                args: ['/S', '/D=C:\\LLVM'],
                timeout: 300000 // 5 minutes
            });

            if (installResult.exitCode === 0) {
                output.appendLine('[CompilerInstaller] LLVM installation completed successfully');
                return {
                    success: true,
                    message: 'LLVM has been successfully installed. Please restart VS Code to complete the setup.',
                    installedPath: 'C:\\LLVM\\bin',
                    restartRequired: true,
                    nextSteps: ['Restart VS Code', 'Add C:\\LLVM\\bin to PATH if not already added']
                };
            } else {
                throw new Error(`Installer failed with exit code: ${installResult.exitCode}`);
            }
        } catch (error: any) {
            output.appendLine(`[CompilerInstaller] Windows installation failed: ${error.message}`);
            return {
                success: false,
                message: `Failed to install LLVM on Windows: ${error.message}`,
                nextSteps: ['Download LLVM manually from https://llvm.org/', 'Install and add to PATH']
            };
        }
    }

    /**
     * Install LLVM on macOS
     */
    private static async installLLVMMacOS(): Promise<LLVMInstallResult> {
        const output = this.getOutputChannel();
        output.appendLine('[CompilerInstaller] Starting macOS LLVM automatic installation...');

        try {
            // Check if Homebrew is installed
            const homebrewCheck = await ProcessRunner.executeCommand('which', ['brew']);
            if (homebrewCheck.exitCode !== 0) {
                output.appendLine('[CompilerInstaller] Homebrew not found, installing Homebrew first...');

                // Install Homebrew automatically
                const homebrewResult = await ProcessRunner.executeWithTimeout({
                    command: '/bin/bash',
                    args: ['-c', '$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)'],
                    timeout: 600000 // 10 minutes
                });

                if (homebrewResult.exitCode !== 0) {
                    throw new Error('Failed to install Homebrew');
                }
            }

            // Check if LLVM is already installed via Homebrew
            const llvmCheck = await ProcessRunner.executeCommand('brew', ['list', 'llvm']);
            if (llvmCheck.exitCode === 0) {
                output.appendLine('[CompilerInstaller] LLVM is already installed via Homebrew');
                return {
                    success: true,
                    message: 'LLVM is already installed via Homebrew.',
                    installedPath: '/usr/local/opt/llvm/bin',
                    nextSteps: ['Add /usr/local/opt/llvm/bin to PATH if not already added']
                };
            }

            // Install LLVM via Homebrew
            output.appendLine('[CompilerInstaller] Installing LLVM via Homebrew...');
            const installResult = await ProcessRunner.executeWithTimeout({
                command: 'brew',
                args: ['install', 'llvm'],
                timeout: 600000 // 10 minutes
            });

            if (installResult.exitCode === 0) {
                output.appendLine('[CompilerInstaller] LLVM installation completed successfully');
                return {
                    success: true,
                    message: 'LLVM has been successfully installed via Homebrew.',
                    installedPath: '/usr/local/opt/llvm/bin',
                    nextSteps: [
                        'Add /usr/local/opt/llvm/bin to your PATH',
                        'Run: echo \'export PATH="/usr/local/opt/llvm/bin:$PATH"\' >> ~/.zshrc',
                        'Restart your terminal'
                    ]
                };
            } else {
                throw new Error(`Homebrew install failed with exit code: ${installResult.exitCode}`);
            }
        } catch (error: any) {
            output.appendLine(`[CompilerInstaller] macOS installation failed: ${error.message}`);
            return {
                success: false,
                message: `Failed to install LLVM on macOS: ${error.message}`,
                nextSteps: [
                    'Install Homebrew: /bin/bash -c "$(curl -fsSL ' +
                        'https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"',
                    'Install LLVM: brew install llvm',
                    'Add to PATH: export PATH="/usr/local/opt/llvm/bin:$PATH"'
                ]
            };
        }
    }

    /**
     * Install LLVM on Linux
     */
    private static async installLLVMLinux(): Promise<LLVMInstallResult> {
        const output = this.getOutputChannel();
        output.appendLine('[CompilerInstaller] Starting Linux LLVM automatic installation...');

        try {
            // Detect package manager
            let packageManager: string;
            let installCommand: string[];

            // Check for apt (Debian/Ubuntu)
            const aptCheck = await ProcessRunner.executeCommand('which', ['apt']);
            if (aptCheck.exitCode === 0) {
                packageManager = 'apt';
                installCommand = ['sudo', 'apt', 'update', '&&', 'sudo', 'apt', 'install', '-y', 'clang', 'lld'];
                // Check for dnf (Fedora)
            } else if (await ProcessRunner.executeCommand('which', ['dnf']).then(r => r.exitCode === 0)) {
                packageManager = 'dnf';
                installCommand = ['sudo', 'dnf', 'install', '-y', 'clang', 'lld'];
                // Check for pacman (Arch)
            } else if (await ProcessRunner.executeCommand('which', ['pacman']).then(r => r.exitCode === 0)) {
                packageManager = 'pacman';
                installCommand = ['sudo', 'pacman', '-S', '--noconfirm', 'clang', 'lld'];
                // Check for zypper (openSUSE)
            } else if (await ProcessRunner.executeCommand('which', ['zypper']).then(r => r.exitCode === 0)) {
                packageManager = 'zypper';
                installCommand = ['sudo', 'zypper', 'install', '-y', 'clang', 'lld'];
            } else {
                throw new Error('No supported package manager found');
            }

            output.appendLine(`[CompilerInstaller] Using package manager: ${packageManager}`);

            // Instead of running sudo commands directly, show a dialog with the command
            const command = installCommand.join(' ');
            const choice = await vscode.window.showInformationMessage(
                'To install LLVM, run this command in your terminal:',
                { modal: true },
                'Copy Command',
                'Open Terminal',
                'Cancel'
            );

            if (choice === 'Copy Command') {
                await vscode.env.clipboard.writeText(command);
                await vscode.window.showInformationMessage(
                    'Command copied to clipboard. Paste it in your terminal and run it.'
                );
            } else if (choice === 'Open Terminal') {
                const terminal = vscode.window.createTerminal('LLVM Installation');
                terminal.sendText(command);
                terminal.show();
            }

            return {
                success: false,
                message: `Please run the installation command manually: ${command}`,
                restartRequired: true,
                nextSteps: [
                    'Run the command in your terminal',
                    'After installation, restart VS Code',
                    'Verify installation with: clang --version'
                ]
            };
        } catch (error: any) {
            output.appendLine(`[CompilerInstaller] Linux installation failed: ${error.message}`);
            return {
                success: false,
                message: `Failed to install LLVM on Linux: ${error.message}`,
                nextSteps: [
                    'Install manually using your package manager:',
                    'Debian/Ubuntu: sudo apt install clang lld',
                    'Fedora: sudo dnf install clang lld',
                    'Arch: sudo pacman -S clang lld',
                    'openSUSE: sudo zypper install clang lld'
                ]
            };
        }
    }

    /**
     * Show installation guide for manual installation
     */
    private static async showInstallationGuide(): Promise<LLVMInstallResult> {
        const platform = process.platform;
        let guide = '';

        switch (platform) {
            case 'win32':
                guide = `
# Windows LLVM Installation Guide

## Option 1: Download Installer (Recommended)
1. Visit https://llvm.org/builds/
2. Download the latest LLVM installer for Windows
3. Run the installer with default settings
4. Add LLVM to your PATH if not already done

## Option 2: Winget
Open PowerShell as Administrator and run:
\`\`\`powershell
winget install LLVM.LLVM
\`\`\`

## Option 3: Chocolatey
\`\`\`powershell
choco install llvm
\`\`\`

After installation, restart VS Code and run compiler detection again.
`;
                break;

            case 'darwin':
                guide = `
# macOS LLVM Installation Guide

## Option 1: Homebrew (Recommended)
\`\`\`bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
brew install llvm
\`\`\`

## Option 2: MacPorts
\`\`\`bash
sudo port install clang
\`\`\`

## Option 3: Xcode Command Line Tools
\`\`\`bash
xcode-select --install
\`\`\`

After installation, add to your PATH:
\`\`\`bash
echo 'export PATH="/usr/local/opt/llvm/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
\`\`\`
`;
                break;

            case 'linux':
                guide = `
# Linux LLVM Installation Guide

## Debian/Ubuntu
\`\`\`bash
sudo apt update
sudo apt install clang lld
\`\`\`

## Fedora
\`\`\`bash
sudo dnf install clang lld
\`\`\`

## Arch Linux
\`\`\`bash
sudo pacman -S clang lld
\`\`\`

## openSUSE
\`\`\`bash
sudo zypper install clang lld
\`\`\`

## Generic (from source)
\`\`\`bash
wget https://github.com/llvm/llvm-project/releases/download/llvmorg-16.0.0/llvm-16.0.0.src.tar.xz
tar -xf llvm-16.0.0.src.tar.xz
cd llvm-16.0.0.src
mkdir build && cd build
cmake .. -DCMAKE_BUILD_TYPE=Release
make -j$(nproc)
sudo make install
\`\`\`
`;
                break;

            default:
                guide = `
# LLVM Installation Guide

Please visit https://llvm.org/docs/GettingStarted.html for platform-specific installation instructions.

Common installation methods:
- Package manager (apt, dnf, pacman, brew, etc.)
- Download pre-built binaries from llvm.org
- Build from source
`;
                break;
        }

        // Show guide in a new document
        const doc = await vscode.workspace.openTextDocument({
            content: guide,
            language: 'markdown'
        });
        await vscode.window.showTextDocument(doc);

        return {
            success: false,
            message: 'Please follow the installation guide in the opened document.',
            nextSteps: ['Follow the installation steps', 'Restart VS Code after installation']
        };
    }

    /**
     * Get SHA256 checksum for LLVM installer
     */
    private static async getLLVMChecksum(version: string): Promise<string> {
        try {
            return new Promise<string>((resolve, reject) => {
                const options = {
                    hostname: 'github.com',
                    path: `/llvm/llvm-project/releases/download/llvmorg-${version}/LLVM-${version}-win64.exe.sha256`,
                    method: 'GET',
                    headers: {
                        'User-Agent': 'OI-Code-VSCode-Extension'
                    }
                };

                const req = https.request(options, (res: any) => {
                    let data = '';

                    res.on('data', (chunk: any) => {
                        data += chunk;
                    });

                    res.on('end', () => {
                        if (res.statusCode === 200) {
                            const checksum = data.trim().split(' ')[0];
                            resolve(checksum);
                        } else {
                            reject(new Error(`Failed to download checksum: ${res.statusCode}`));
                        }
                    });
                });

                req.on('error', (error: any) => {
                    reject(error);
                });

                req.setTimeout(10000, () => {
                    req.destroy();
                    reject(new Error('Checksum download timeout'));
                });

                req.end();
            });
        } catch (error) {
            throw new Error(`Failed to get LLVM checksum: ${error}`);
        }
    }

    /**
     * Verify file checksum
     */
    private static async verifyFileChecksum(filePath: string, expectedChecksum: string): Promise<boolean> {
        return new Promise<boolean>((resolve, reject) => {
            const hash = crypto.createHash('sha256');
            const stream = fs.createReadStream(filePath);

            stream.on('data', (chunk: any) => {
                hash.update(chunk);
            });

            stream.on('end', () => {
                const actualChecksum = hash.digest('hex');
                resolve(actualChecksum.toLowerCase() === expectedChecksum.toLowerCase());
            });

            stream.on('error', (error: any) => {
                reject(error);
            });
        });
    }

    /**
     * Get the latest stable LLVM version from GitHub API
     */
    private static async getLatestLLVMVersion(): Promise<string> {
        try {
            // Use imported https module

            return new Promise<string>((resolve, reject) => {
                const options = {
                    hostname: 'api.github.com',
                    path: '/repos/llvm/llvm-project/releases/latest',
                    method: 'GET',
                    headers: {
                        'User-Agent': 'OI-Code-VSCode-Extension',
                        Accept: 'application/vnd.github.v3+json'
                    }
                };

                const req = https.request(options, (res: any) => {
                    let data = '';

                    res.on('data', (chunk: any) => {
                        data += chunk;
                    });

                    res.on('end', () => {
                        if (res.statusCode === 200) {
                            try {
                                const release = JSON.parse(data);
                                const tagName = release.tag_name;
                                const version = tagName.replace('llvmorg-', '');
                                resolve(version);
                            } catch (error) {
                                reject(new Error('Failed to parse GitHub API response'));
                            }
                        } else {
                            reject(new Error(`GitHub API returned status ${res.statusCode}`));
                        }
                    });
                });

                req.on('error', (error: any) => {
                    reject(error);
                });

                req.setTimeout(10000, () => {
                    req.destroy();
                    reject(new Error('GitHub API request timeout'));
                });

                req.end();
            });
        } catch (error) {
            // Fallback to version 16.0.0 if API fails
            console.warn('[CompilerInstaller] Failed to get latest LLVM version, using fallback:', error);
            return '16.0.0';
        }
    }
}
