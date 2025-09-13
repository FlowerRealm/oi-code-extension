import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as https from 'https';
import { execSync } from 'child_process';
import * as fsStream from 'fs';
import { pipeline } from 'stream/promises';
import * as unzipper from 'unzipper';
import * as tar from 'tar';
import { IncomingMessage } from 'http';

/**
 * LLVM安装器 - 下载压缩包并解压到扩展文件夹
 */
export class LLVMInstaller {
    private static context: vscode.ExtensionContext | null = null;
    private static outputChannel: vscode.OutputChannel | null = null;

    /**
     * 初始化LLVM安装器
     */
    public static initialize(context: vscode.ExtensionContext): void {
        this.context = context;
        this.outputChannel = vscode.window.createOutputChannel('OI-Code LLVM Installer');
    }

    /**
     * 获取输出通道
     */
    public static getOutputChannel(): vscode.OutputChannel {
        if (!this.outputChannel) {
            this.outputChannel = vscode.window.createOutputChannel('OI-Code LLVM Installer');
        }
        return this.outputChannel;
    }

    /**
     * 检查LLVM是否已安装
     */
    public static async isLLVMInstalled(): Promise<boolean> {
        if (!this.context) {
            return false;
        }

        const installPath = this.getLLVMInstallPath();
        try {
            await fs.access(installPath);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * 获取LLVM安装路径
     */
    public static getLLVMInstallPath(): string {
        if (!this.context) {
            throw new Error('LLVMInstaller not initialized');
        }
        return path.join(this.context.globalStorageUri.fsPath, 'llvm');
    }

    /**
     * 获取LLVM bin目录
     */
    public static getLLVMBinPath(): string {
        return path.join(this.getLLVMInstallPath(), 'bin');
    }

    /**
     * 安装LLVM
     */
    public static async installLLVM(
        progress: vscode.Progress<{ message: string; increment: number }>
    ): Promise<boolean> {
        if (!this.context) {
            throw new Error('LLVMInstaller not initialized');
        }

        const outputChannel = this.getOutputChannel();
        outputChannel.show();
        outputChannel.appendLine('[LLVMInstaller] Starting LLVM installation...');

        try {
            const platform = process.platform;
            const architecture = process.arch;

            progress.report({ message: '确定LLVM版本和平台...', increment: 5 });

            // 获取适合的LLVM版本和下载URL
            const { version, downloadUrl } = this.getLLVMDownloadInfo(platform, architecture);
            outputChannel.appendLine(`[LLVMInstaller] Installing LLVM ${version} for ${platform}-${architecture}`);
            outputChannel.appendLine(`[LLVMInstaller] Download URL: ${downloadUrl}`);

            // 创建安装目录
            const installPath = this.getLLVMInstallPath();
            await fs.mkdir(installPath, { recursive: true });
            outputChannel.appendLine(`[LLVMInstaller] Install path: ${installPath}`);

            // 下载LLVM压缩包
            progress.report({ message: '下载LLVM压缩包...', increment: 10 });
            const archivePath = await this.downloadLLVM(downloadUrl, progress);
            outputChannel.appendLine(`[LLVMInstaller] Downloaded to: ${archivePath}`);

            // 解压LLVM
            progress.report({ message: '解压LLVM...', increment: 30 });
            await this.extractLLVM(archivePath, installPath);
            outputChannel.appendLine(`[LLVMInstaller] Extracted to: ${installPath}`);

            // 清理临时文件
            await fs.unlink(archivePath);
            outputChannel.appendLine('[LLVMInstaller] Cleaned up temporary files');

            // 验证安装
            progress.report({ message: '验证安装...', increment: 10 });
            const isValid = await this.verifyLLVMInstallation();
            if (isValid) {
                outputChannel.appendLine('[LLVMInstaller] LLVM installation completed successfully');

                // 更新扩展设置
                const { ExtensionSettings } = await import('../utils/extension-settings');
                await ExtensionSettings.setLLVMInfo({
                    installed: true,
                    version,
                    installPath
                });

                return true;
            } else {
                throw new Error('LLVM installation verification failed');
            }
        } catch (error) {
            outputChannel.appendLine(`[LLVMInstaller] Installation failed: ${error}`);
            throw error;
        }
    }

    /**
     * 获取LLVM下载信息
     */
    private static getLLVMDownloadInfo(
        platform: string,
        architecture: string
    ): { version: string; downloadUrl: string } {
        const version = '18.1.8'; // 使用稳定的LLVM版本
        const baseUrl = 'https://github.com/llvm/llvm-project/releases/download';

        switch (platform) {
            case 'win32':
                if (architecture === 'x64') {
                    return {
                        version,
                        downloadUrl: `${baseUrl}/llvmorg-${version}/LLVM-${version}-win64.exe`
                    };
                }
                break;

            case 'darwin':
                if (architecture === 'x64') {
                    return {
                        version,
                        downloadUrl: `${baseUrl}/llvmorg-${version}/clang+llvm-${version}-x86_64-apple-darwin.tar.xz`
                    };
                } else if (architecture === 'arm64') {
                    return {
                        version,
                        downloadUrl: `${baseUrl}/llvmorg-${version}/clang+llvm-${version}-arm64-apple-darwin.tar.xz`
                    };
                }
                break;

            case 'linux':
                if (architecture === 'x64') {
                    const packageName = `clang+llvm-${version}-x86_64-linux-gnu-ubuntu-22.04.tar.xz`;
                    return {
                        version,
                        downloadUrl: `${baseUrl}/llvmorg-${version}/${packageName}`
                    };
                } else if (architecture === 'arm64') {
                    return {
                        version,
                        downloadUrl: `${baseUrl}/llvmorg-${version}/clang+llvm-${version}-aarch64-linux-gnu.tar.xz`
                    };
                }
                break;
        }

        throw new Error(`Unsupported platform: ${platform}-${architecture}`);
    }

    /**
     * 下载LLVM压缩包
     */
    private static async downloadLLVM(
        url: string,
        progress: vscode.Progress<{ message: string; increment: number }>
    ): Promise<string> {
        const outputChannel = this.getOutputChannel();
        const tempDir = this.context!.globalStorageUri.fsPath;
        const fileName = path.basename(url);
        const filePath = path.join(tempDir, fileName);

        return new Promise((resolve, reject) => {
            const fileStream = fsStream.createWriteStream(filePath);
            let downloadedBytes = 0;
            let totalBytes = 0;

            const request = https.get(url, (response: IncomingMessage) => {
                if (response.statusCode !== 200) {
                    reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
                    return;
                }

                totalBytes = parseInt(response.headers['content-length'] || '0', 10);
                outputChannel.appendLine(`[LLVMInstaller] Downloading ${fileName} (${totalBytes} bytes)`);

                response.on('data', (chunk: Buffer) => {
                    downloadedBytes += chunk.length;
                    if (totalBytes > 0) {
                        const percent = Math.floor((downloadedBytes / totalBytes) * 100);
                        progress.report({
                            message: `下载LLVM... ${percent}%`,
                            increment: Math.floor(percent * 0.3)
                        });
                    }
                });

                pipeline(response, fileStream)
                    .then(() => {
                        outputChannel.appendLine(`[LLVMInstaller] Download completed: ${filePath}`);
                        resolve(filePath);
                    })
                    .catch(reject);
            });

            request.on('error', reject);
            request.setTimeout(300000, () => {
                request.destroy();
                reject(new Error('Download timeout'));
            });
        });
    }

    /**
     * 解压LLVM压缩包
     */
    private static async extractLLVM(archivePath: string, installPath: string): Promise<void> {
        const outputChannel = this.getOutputChannel();

        if (archivePath.endsWith('.zip')) {
            // 解压ZIP文件
            await pipeline(fsStream.createReadStream(archivePath), unzipper.Extract({ path: installPath }));
        } else if (archivePath.endsWith('.tar.xz') || archivePath.endsWith('.tar.gz')) {
            // 解压tar文件
            await tar.x({
                file: archivePath,
                cwd: installPath,
                strip: 1 // 移除顶层目录
            });
        } else if (archivePath.endsWith('.exe')) {
            // Windows安装程序
            outputChannel.appendLine('[LLVMInstaller] Running Windows installer...');
            execSync(`"${archivePath}" /S /D="${installPath}"`, {
                stdio: 'inherit',
                cwd: path.dirname(archivePath)
            });
        } else {
            throw new Error(`Unsupported archive format: ${archivePath}`);
        }

        outputChannel.appendLine('[LLVMInstaller] Extraction completed');
    }

    /**
     * 验证LLVM安装
     */
    private static async verifyLLVMInstallation(): Promise<boolean> {
        const binPath = this.getLLVMBinPath();
        const clangPath = path.join(binPath, 'clang');
        const clangppPath = path.join(binPath, 'clang++');

        try {
            // 检查文件是否存在
            await fs.access(clangPath);
            await fs.access(clangppPath);

            // 检查是否可执行
            await fs.access(clangPath, fs.constants.X_OK);
            await fs.access(clangppPath, fs.constants.X_OK);

            // 测试运行
            const { execSync } = require('child_process');
            const result = execSync(`"${clangPath}" --version`, {
                encoding: 'utf8',
                timeout: 10000
            });

            return result.includes('clang');
        } catch (error) {
            return false;
        }
    }

    /**
     * 卸载LLVM
     */
    public static async uninstallLLVM(): Promise<void> {
        if (!this.context) {
            throw new Error('LLVMInstaller not initialized');
        }

        const installPath = this.getLLVMInstallPath();
        const outputChannel = this.getOutputChannel();

        try {
            await fs.rm(installPath, { recursive: true, force: true });
            outputChannel.appendLine(`[LLVMInstaller] LLVM uninstalled from: ${installPath}`);

            // 更新扩展设置
            const { ExtensionSettings } = await import('../utils/extension-settings');
            await ExtensionSettings.setLLVMInfo({
                installed: false,
                version: '',
                installPath: ''
            });
        } catch (error) {
            outputChannel.appendLine(`[LLVMInstaller] Failed to uninstall LLVM: ${error}`);
            throw error;
        }
    }

    /**
     * 获取已安装的LLVM信息
     */
    public static async getLLVMInfo(): Promise<{ installed: boolean; version?: string; path?: string }> {
        if (!this.context) {
            return { installed: false };
        }

        const { ExtensionSettings } = await import('../utils/extension-settings');
        const llvmInfo = ExtensionSettings.getLLVMInfo();

        if (llvmInfo.installed && (await this.isLLVMInstalled())) {
            return {
                installed: true,
                version: llvmInfo.version as string | undefined,
                path: llvmInfo.installPath as string | undefined
            };
        }

        return { installed: false };
    }
}
