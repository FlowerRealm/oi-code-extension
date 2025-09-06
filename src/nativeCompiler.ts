/* ---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *-------------------------------------------------------------------------------------------- */

import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { spawn, exec } from 'child_process';

/**
 * Compiler information interface
 */
export interface CompilerInfo {
    path: string;
    name: string;
    type: 'clang' | 'clang++' | 'gcc' | 'g++' | 'msvc' | 'apple-clang';
    version: string;
    supportedStandards: string[];
    is64Bit: boolean;
    priority: number;
}

/**
 * Compiler detection result
 */
export interface CompilerDetectionResult {
    success: boolean;
    compilers: CompilerInfo[];
    recommended?: CompilerInfo;
    error?: string;
    suggestions: string[];
}

/**
 * LLVM installation result
 */
export interface LLVMInstallResult {
    success: boolean;
    message: string;
    installedPath?: string;
    restartRequired?: boolean;
    nextSteps?: string[];
}

/**
 * Native compilation execution engine
 */
export class NativeCompilerManager {
    private static outputChannel: vscode.OutputChannel | null = null;
    private static cachedCompilers: CompilerDetectionResult | null = null;
    private static readonly CACHE_KEY = 'oicode.cachedCompilers';
    private static readonly CACHE_VERSION = '1.0';

    /**
     * Filter suitable compilers based on language
     * @param languageId Language ID ('c' or 'cpp')
     * @param compilers Compiler list
     * @returns Filtered compiler list
     */
    public static filterSuitableCompilers(languageId: 'c' | 'cpp', compilers: CompilerInfo[]): CompilerInfo[] {
        return compilers.filter(c =>
            languageId === 'c'
                ? c.type === 'clang' || c.type === 'apple-clang' || c.type === 'gcc' || c.type === 'msvc'
                : c.type === 'clang++' || c.type === 'apple-clang' || c.type === 'g++' || c.type === 'msvc'
        );
    }

    /**
     * Get output channel
     */
    public static getOutputChannel(): vscode.OutputChannel {
        if (!this.outputChannel) {
            this.outputChannel = vscode.window.createOutputChannel('OI-Code Native Compiler');
        }
        return this.outputChannel;
    }

    /**
     * Load cached compiler information from global state
     */
    private static async loadCachedCompilers(
        context: vscode.ExtensionContext
    ): Promise<CompilerDetectionResult | null> {
        try {
            const cached = context.globalState.get<string>(this.CACHE_KEY);
            if (!cached) {
                return null;
            }

            const parsed = JSON.parse(cached);

            // Check cache version
            if (parsed.version !== this.CACHE_VERSION) {
                console.log('[CompilerCache] Cache version mismatch, ignoring');
                return null;
            }

            // Check cache time (24 hours expiration)
            const cacheTime = new Date(parsed.timestamp);
            const now = new Date();
            const hoursDiff = (now.getTime() - cacheTime.getTime()) / (1000 * 60 * 60);

            if (hoursDiff > 24) {
                console.log('[CompilerCache] Cache expired, ignoring');
                return null;
            }

            console.log('[CompilerCache] Using cached compiler information from', cacheTime.toISOString());
            return {
                success: true,
                compilers: parsed.compilers,
                recommended: parsed.recommended,
                suggestions: parsed.suggestions || []
            };
        } catch (error) {
            console.log('[CompilerCache] Failed to load cached compilers:', error);
            return null;
        }
    }

    /**
     * Save compiler information to global state
     */
    private static async saveCachedCompilers(
        context: vscode.ExtensionContext,
        result: CompilerDetectionResult
    ): Promise<void> {
        try {
            const cacheData = {
                version: this.CACHE_VERSION,
                timestamp: new Date().toISOString(),
                compilers: result.compilers,
                recommended: result.recommended,
                suggestions: result.suggestions || []
            };

            await context.globalState.update(this.CACHE_KEY, JSON.stringify(cacheData));
            console.log('[CompilerCache] Saved compiler information to cache');
        } catch (error) {
            console.log('[CompilerCache] Failed to save cached compilers:', error);
        }
    }

    /**
     * Clear compiler cache
     */
    public static async clearCachedCompilers(context: vscode.ExtensionContext): Promise<void> {
        try {
            await context.globalState.update(this.CACHE_KEY, undefined);
            this.cachedCompilers = null;
            console.log('[CompilerCache] Cleared compiler cache');
        } catch (error) {
            console.log('[CompilerCache] Failed to clear compiler cache:', error);
        }
    }

    /**
     * Force rescan compilers
     */
    public static async forceRescanCompilers(context: vscode.ExtensionContext): Promise<CompilerDetectionResult> {
        console.log('[CompilerCache] Forcing compiler rescan...');
        await this.clearCachedCompilers(context);
        return await this.detectCompilers(context, true);
    }

    /**
     * Detect available compilers in the system
     */
    public static async detectCompilers(
        context?: vscode.ExtensionContext,
        forceRescan: boolean = false
    ): Promise<CompilerDetectionResult> {
        const output = this.getOutputChannel();

        // If there is memory cache and not forcing rescan, return directly
        if (!forceRescan && this.cachedCompilers) {
            console.log('[CompilerCache] Using in-memory cached compiler information');
            return this.cachedCompilers;
        }

        // Try to load cache from global state
        if (!forceRescan && context) {
            const cached = await this.loadCachedCompilers(context);
            if (cached) {
                this.cachedCompilers = cached;
                console.log('[CompilerCache] Using cached compiler information from global state');
                return cached;
            }
        }

        output.clear();
        output.appendLine('=== Detecting Available Compilers ===');
        output.show(true);

        try {
            const compilers: CompilerInfo[] = [];

            // Detect compilers based on platform
            if (process.platform === 'win32') {
                compilers.push(...(await this.detectWindowsCompilers()));
            } else if (process.platform === 'darwin') {
                compilers.push(...(await this.detectMacOSCompilers()));
            } else if (process.platform === 'linux') {
                compilers.push(...(await this.detectLinuxCompilers()));
            }

            // Sort by priority
            compilers.sort((a, b) => b.priority - a.priority);

            // Select recommended compiler
            const recommended = compilers.length > 0 ? compilers[0] : undefined;

            // Generate suggestions
            const suggestions = this.generateSuggestions(compilers);

            output.appendLine(`Detected ${compilers.length} 个编译器:`);
            compilers.forEach(compiler => {
                const bitInfo = compiler.is64Bit ? '64-bit' : '32-bit';
                output.appendLine(
                    `  - ${compiler.name} (${compiler.type}) v${compiler.version} [${bitInfo}]`
                );
            });

            if (recommended) {
                output.appendLine(`Recommended compiler: ${recommended.name}`);
            }

            const result = {
                success: true,
                compilers,
                recommended,
                suggestions
            };

            // Cache results
            this.cachedCompilers = result;
            if (context) {
                await this.saveCachedCompilers(context, result);
            }

            return result;
        } catch (error: any) {
            const errorMsg = `Compiler detection failed: ${error.message}`;
            output.appendLine(errorMsg);

            return {
                success: false,
                compilers: [],
                error: errorMsg,
                suggestions: [
                    'Please ensure C/C++ compilers are installed',
                    'Windows: Install LLVM or MinGW',
                    'macOS: Install Xcode Command Line Tools',
                    'Linux: Install gcc or clang'
                ]
            };
        }
    }

    /**
     * Detect Windows platform compilers
     */
    private static async detectWindowsCompilers(): Promise<CompilerInfo[]> {
        const compilers: CompilerInfo[] = [];
        const checked = new Set<string>();

        // 1. First search for compilers in system PATH
        const pathCompilers = await this.searchCompilersInPATH(['clang', 'clang++', 'gcc', 'g++', 'cc', 'c++']);
        for (const compiler of pathCompilers) {
            if (!checked.has(compiler.toLowerCase())) {
                checked.add(compiler.toLowerCase());
                const compilerInfo = await this.testCompiler(compiler);
                if (compilerInfo) {
                    compilers.push(compilerInfo);
                }
            }
        }

        // 2. Search common installation directories
        const searchDirs = [
            'C:\\Program Files\\LLVM\\bin',
            'C:\\Program Files (x86)\\LLVM\\bin',
            'C:\\LLVM\\bin',
            'C:\\mingw64\\bin',
            'C:\\msys64\\mingw64\\bin',
            'C:\\msys64\\usr\\bin',
            'C:\\TDM-GCC-64\\bin',
            'C:\\cygwin64\\bin',
            'C:\\Tools\\mingw64\\bin',
            `${process.env['LOCALAPPDATA']}\\Programs\\LLVM\\bin`,
            `${process.env['ProgramFiles']}\\LLVM\\bin`,
            `${process.env['ProgramFiles(x86)']}\\LLVM\\bin`
        ];

        for (const dir of searchDirs) {
            const dirCompilers = await this.searchCompilersInDirectory(dir, ['clang', 'clang++', 'gcc', 'g++']);
            for (const compiler of dirCompilers) {
                if (!checked.has(compiler.toLowerCase())) {
                    checked.add(compiler.toLowerCase());
                    const compilerInfo = await this.testCompiler(compiler);
                    if (compilerInfo) {
                        compilers.push(compilerInfo);
                    }
                }
            }
        }

        // 3. Search for MSVC compilers
        const msvcCompilers = await this.findMSVCCompilers();
        for (const compiler of msvcCompilers) {
            if (!checked.has(compiler.toLowerCase())) {
                checked.add(compiler.toLowerCase());
                const compilerInfo = await this.testCompiler(compiler);
                if (compilerInfo) {
                    compilers.push(compilerInfo);
                }
            }
        }

        // 4. Scan entire system drive (optional, may be slow)
        if (compilers.length === 0) {
            const systemCompilers = await this.scanSystemForCompilers([
                'clang.exe',
                'clang++.exe',
                'gcc.exe',
                'g++.exe'
            ]);
            for (const compiler of systemCompilers) {
                if (!checked.has(compiler.toLowerCase())) {
                    checked.add(compiler.toLowerCase());
                    const compilerInfo = await this.testCompiler(compiler);
                    if (compilerInfo) {
                        compilers.push(compilerInfo);
                    }
                }
            }
        }

        return compilers;
    }

    /**
     * Detect macOS platform compilers
     */
    private static async detectMacOSCompilers(): Promise<CompilerInfo[]> {
        const compilers: CompilerInfo[] = [];
        const checked = new Set<string>();

        // 1. First search for compilers in system PATH
        const pathCompilers = await this.searchCompilersInPATH(['clang', 'clang++', 'gcc', 'g++', 'cc', 'c++']);
        for (const compiler of pathCompilers) {
            if (!checked.has(compiler.toLowerCase())) {
                checked.add(compiler.toLowerCase());
                const compilerInfo = await this.testCompiler(compiler);
                if (compilerInfo) {
                    compilers.push(compilerInfo);
                }
            }
        }

        // 2. Search common installation directories
        const searchDirs = [
            '/usr/bin',
            '/usr/local/bin',
            '/opt/local/bin', // MacPorts
            '/usr/local/opt/llvm/bin', // Homebrew Intel
            '/opt/homebrew/opt/llvm/bin', // Homebrew Apple Silicon
            '/opt/homebrew/bin',
            '/usr/local/opt/gcc/bin',
            '/opt/homebrew/opt/gcc/bin',
            '/Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin',
            '/Applications/Xcode.app/Contents/Developer/usr/bin'
        ];

        for (const dir of searchDirs) {
            const dirCompilers = await this.searchCompilersInDirectory(dir, ['clang', 'clang++', 'gcc', 'g++']);
            for (const compiler of dirCompilers) {
                if (!checked.has(compiler.toLowerCase())) {
                    checked.add(compiler.toLowerCase());
                    const compilerInfo = await this.testCompiler(compiler);
                    if (compilerInfo) {
                        compilers.push(compilerInfo);
                    }
                }
            }
        }

        // 3. Search for Xcode installed compilers
        const xcodeDirs = await this.findXcodeCompilerDirectories();
        for (const dir of xcodeDirs) {
            const dirCompilers = await this.searchCompilersInDirectory(dir, ['clang', 'clang++']);
            for (const compiler of dirCompilers) {
                if (!checked.has(compiler.toLowerCase())) {
                    checked.add(compiler.toLowerCase());
                    const compilerInfo = await this.testCompiler(compiler);
                    if (compilerInfo) {
                        compilers.push(compilerInfo);
                    }
                }
            }
        }

        // 4. If no compilers found, scan entire system (use with caution)
        if (compilers.length === 0) {
            const systemCompilers = await this.scanSystemForCompilers(['clang', 'clang++', 'gcc', 'g++']);
            for (const compiler of systemCompilers) {
                if (!checked.has(compiler.toLowerCase())) {
                    checked.add(compiler.toLowerCase());
                    const compilerInfo = await this.testCompiler(compiler);
                    if (compilerInfo) {
                        compilers.push(compilerInfo);
                    }
                }
            }
        }

        return compilers;
    }

    /**
     * Detect Linux platform compilers
     */
    private static async detectLinuxCompilers(): Promise<CompilerInfo[]> {
        const compilers: CompilerInfo[] = [];
        const checked = new Set<string>();

        // 1. First search for compilers in system PATH
        const pathCompilers = await this.searchCompilersInPATH(['clang', 'clang++', 'gcc', 'g++', 'cc', 'c++']);
        for (const compiler of pathCompilers) {
            if (!checked.has(compiler.toLowerCase())) {
                checked.add(compiler.toLowerCase());
                const compilerInfo = await this.testCompiler(compiler);
                if (compilerInfo) {
                    compilers.push(compilerInfo);
                }
            }
        }

        // 2. Search common installation directories
        const searchDirs = [
            '/usr/bin',
            '/bin',
            '/usr/local/bin',
            '/opt/local/bin',
            '/opt/bin',
            '/usr/clang/bin',
            '/usr/llvm/bin',
            '/opt/llvm/bin',
            '/usr/local/llvm/bin',
            '/snap/bin', // Snap packages
            '/flatpak/bin' // Flatpak packages
        ];

        for (const dir of searchDirs) {
            const dirCompilers = await this.searchCompilersInDirectory(dir, ['clang', 'clang++', 'gcc', 'g++']);
            for (const compiler of dirCompilers) {
                if (!checked.has(compiler.toLowerCase())) {
                    checked.add(compiler.toLowerCase());
                    const compilerInfo = await this.testCompiler(compiler);
                    if (compilerInfo) {
                        compilers.push(compilerInfo);
                    }
                }
            }
        }

        // 3. 搜索LLVM版本化安装
        const llvmVersions = await this.findLLVMVersionInstallations();
        for (const dir of llvmVersions) {
            const dirCompilers = await this.searchCompilersInDirectory(dir, ['clang', 'clang++']);
            for (const compiler of dirCompilers) {
                if (!checked.has(compiler.toLowerCase())) {
                    checked.add(compiler.toLowerCase());
                    const compilerInfo = await this.testCompiler(compiler);
                    if (compilerInfo) {
                        compilers.push(compilerInfo);
                    }
                }
            }
        }

        // 4. 搜索GCC版本化安装
        const gccVersions = await this.findGCCVersionInstallations();
        for (const dir of gccVersions) {
            const dirCompilers = await this.searchCompilersInDirectory(dir, ['gcc', 'g++']);
            for (const compiler of dirCompilers) {
                if (!checked.has(compiler.toLowerCase())) {
                    checked.add(compiler.toLowerCase());
                    const compilerInfo = await this.testCompiler(compiler);
                    if (compilerInfo) {
                        compilers.push(compilerInfo);
                    }
                }
            }
        }

        // 5. 如果没有找到编译器，扫描整个系统（谨慎使用）
        if (compilers.length === 0) {
            const systemCompilers = await this.scanSystemForCompilers(['clang', 'clang++', 'gcc', 'g++']);
            for (const compiler of systemCompilers) {
                if (!checked.has(compiler.toLowerCase())) {
                    checked.add(compiler.toLowerCase());
                    const compilerInfo = await this.testCompiler(compiler);
                    if (compilerInfo) {
                        compilers.push(compilerInfo);
                    }
                }
            }
        }

        return compilers;
    }

    /**
     * Find MSVC compilers
     */
    private static async findMSVCCompilers(): Promise<string[]> {
        try {
            // Use vswhere to find Visual Studio installation
            const vswherePath = path.join(
                process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
                'Microsoft Visual Studio\\Installer\\vswhere.exe'
            );

            if (!(await this.fileExists(vswherePath))) {
                return [];
            }

            const { stdout } = await this.executeCommand(vswherePath, [
                '-latest',
                '-products',
                '*',
                '-requires',
                'Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
                '-property',
                'installationPath'
            ]);

            const installPath = stdout.trim();
            if (!installPath) {
                return [];
            }

            // MSVC compilers are usually in the VC/Tools/MSVC directory under the installation path
            const msvcBasePath = path.join(installPath, 'VC', 'Tools', 'MSVC');
            const results: string[] = [];

            try {
                // First read MSVC version directories
                const versions = await fs.readdir(msvcBasePath);

                for (const version of versions) {
                    // Check compiler paths in each version directory
                    const hostPaths = [
                        path.join(msvcBasePath, version, 'bin', 'Hostx64', 'x64', 'cl.exe'),
                        path.join(msvcBasePath, version, 'bin', 'Hostx86', 'x86', 'cl.exe')
                    ];

                    for (const compilerPath of hostPaths) {
                        try {
                            await fs.access(compilerPath);
                            results.push(compilerPath);
                        } catch {
                            // Compiler does not exist, skip
                        }
                    }
                }
            } catch {
                // MSVC directory does not exist, skip
            }

            return results;
        } catch {
            return [];
        }
    }

    /**
     * Resolve full path
     */
    private static async resolveFullPath(command: string): Promise<string | null> {
        try {
            if (path.isAbsolute(command)) {
                return (await this.fileExists(command)) ? command : null;
            }

            // Search in PATH
            const { stdout } = await this.executeCommand(process.platform === 'win32' ? 'where' : 'which', [command]);
            return stdout.trim() || null;
        } catch {
            return null;
        }
    }

    /**
     * Test compiler
     */
    private static async testCompiler(compilerPath: string): Promise<CompilerInfo | null> {
        try {
            const outputChannel = this.getOutputChannel();
            outputChannel.appendLine(`Testing compiler: ${compilerPath}`);
            const { stdout, stderr } = await this.executeCommand(compilerPath, ['--version']);
            const versionOutput = stdout + stderr;

            // Parse compiler information
            const type = this.determineCompilerType(compilerPath, versionOutput);
            const version = this.parseVersion(versionOutput);
            const supportedStandards = this.getSupportedStandards(type, version);
            const is64Bit = await this.is64BitCompiler(compilerPath);

            // Calculate priority
            const priority = this.calculatePriority(type, version, compilerPath);

            // Generate friendly name
            const name = this.generateCompilerName(type, version, compilerPath);

            return {
                path: compilerPath,
                name,
                type,
                version,
                supportedStandards,
                is64Bit,
                priority
            };
        } catch (error) {
            const outputChannel = this.getOutputChannel();
            outputChannel.appendLine(`Compiler test failed for ${compilerPath}: ${error}`);
            return null;
        }
    }

    /**
     * Determine compiler type
     */
    private static determineCompilerType(
        compilerPath: string,
        versionOutput: string
    ): 'clang' | 'clang++' | 'gcc' | 'g++' | 'msvc' | 'apple-clang' {
        const path = compilerPath.toLowerCase();
        const output = versionOutput.toLowerCase();

        if (path.includes('cl.exe') || output.includes('microsoft')) {
            return 'msvc';
        }

        if (output.includes('apple clang') || output.includes('apple llvm')) {
            return 'apple-clang';
        }

        // Check C++ compiler
        if (path.includes('clang++') || (path.includes('clang') && path.includes('++'))) {
            return 'clang++';
        }

        if (path.includes('g++')) {
            return 'g++';
        }

        // Check C compiler
        if (path.includes('clang') || output.includes('clang')) {
            return 'clang';
        }

        if (path.includes('gcc') || output.includes('gcc')) {
            return 'gcc';
        }

        return 'clang'; // default
    }

    /**
     * Parse version number
     */
    private static parseVersion(versionOutput: string): string {
        // Match version number patterns
        const patterns = [
            /(\d+\.\d+\.\d+)/, // x.y.z
            /(\d+\.\d+)/, // x.y
            /version (\d+\.\d+\.\d+)/,
            /version (\d+\.\d+)/
        ];

        for (const pattern of patterns) {
            const match = versionOutput.match(pattern);
            if (match) {
                return match[1];
            }
        }

        return 'unknown';
    }

    /**
     * Get supported C++ standards
     */
    private static getSupportedStandards(type: string, version: string): string[] {
        const standards = ['c89', 'c99', 'c11', 'c17'];
        const cppStandards = ['c++98', 'c++11', 'c++14', 'c++17'];

        const majorVersion = parseInt(version.split('.')[0], 10) || 0;

        if (type === 'clang' || type === 'clang++' || type === 'apple-clang') {
            if (majorVersion >= 6) cppStandards.push('c++20');
            if (majorVersion >= 12) cppStandards.push('c++23');
        } else if (type === 'gcc' || type === 'g++') {
            if (majorVersion >= 8) cppStandards.push('c++20');
            if (majorVersion >= 11) cppStandards.push('c++23');
        } else if (type === 'msvc') {
            if (majorVersion >= 19) cppStandards.push('c++20');
            if (majorVersion >= 20) cppStandards.push('c++23');
        }

        return [...standards, ...cppStandards];
    }

    /**
     * Check if compiler is 64-bit
     */
    private static async is64BitCompiler(compilerPath: string): Promise<boolean> {
        try {
            const { stdout } = await this.executeCommand(compilerPath, ['-dumpmachine']);
            return stdout.includes('64') || stdout.includes('x86_64') || stdout.includes('amd64');
        } catch {
            // Return true by default, modern systems are mostly 64-bit
            return true;
        }
    }

    /**
     * Calculate compiler priority
     */
    private static calculatePriority(type: string, version: string, path: string): number {
        let priority = 0;

        // Compiler type priority
        switch (type) {
            case 'clang':
                priority += 100;
                break;
            case 'apple-clang':
                priority += 90;
                break;
            case 'gcc':
                priority += 80;
                break;
            case 'msvc':
                priority += 70;
                break;
        }

        // Version priority
        const majorVersion = parseInt(version.split('.')[0], 10) || 0;
        priority += majorVersion * 10;

        // Installation path priority
        if (path.includes('Program Files')) {
            priority += 5; // Official installation
        }

        return priority;
    }

    /**
     * Generate compiler friendly name
     */
    private static generateCompilerName(type: string, version: string, path: string): string {
        const nameMap: { [key: string]: string } = {
            clang: 'Clang',
            'clang++': 'Clang++',
            'apple-clang': 'Apple Clang',
            gcc: 'GCC',
            'g++': 'G++',
            msvc: 'MSVC'
        };

        const baseName = nameMap[type] || type.toUpperCase();
        const versionStr = version !== 'unknown' ? ` ${version}` : '';

        // Add special identifiers
        let suffix = '';
        if (path.includes('mingw')) suffix = ' (MinGW)';
        else if (path.includes('msys')) suffix = ' (MSYS)';
        else if (path.includes('TDM')) suffix = ' (TDM-GCC)';

        return `${baseName}${versionStr}${suffix}`;
    }

    /**
     * Generate suggestions
     */
    private static generateSuggestions(compilers: CompilerInfo[]): string[] {
        const suggestions: string[] = [];

        if (compilers.length === 0) {
            suggestions.push('No C/C++ compilers detected');
            suggestions.push('Please install LLVM, GCC, or MSVC compilers');
            suggestions.push('Windows users recommend installing LLVM: https://llvm.org/');
        } else {
            const has64Bit = compilers.some(c => c.is64Bit);
            const hasModern = compilers.some(c => {
                const major = parseInt(c.version.split('.')[0], 10) || 0;
                return major >= 6;
            });

            if (!has64Bit) {
                suggestions.push('Recommend using 64-bit compiler for better performance');
            }

            if (!hasModern) {
                suggestions.push('Recommend using newer compiler versions to support C++17/20 standards');
            }

            const clangCompilers = compilers.filter(c => c.type === 'clang' || c.type === 'apple-clang');
            if (clangCompilers.length > 0) {
                suggestions.push('Recommend using Clang compiler for better compatibility');
            }
        }

        return suggestions;
    }

    /**
     * Install LLVM
     */
    public static async installLLVM(): Promise<LLVMInstallResult> {
        const output = this.getOutputChannel();
        output.clear();
        output.appendLine('=== LLVM Installation Wizard ===');
        output.show(true);

        const platform = process.platform;
        const choice = await vscode.window.showInformationMessage(
            'LLVM compiler installation detected, select installation method:',
            { modal: true },
            'Automatic Installation (Recommended)',
            'Show Installation Guide',
            '跳过'
        );

        if (!choice || choice === '跳过') {
            return {
                success: false,
                message: 'User skipped LLVM installation',
                nextSteps: ['Can manually install compiler later']
            };
        }

        if (choice === 'Show Installation Guide') {
            return this.showInstallationGuide();
        }

        if (choice === 'Automatic Installation (Recommended)') {
            return this.installLLVMAutomatically(platform);
        }

        return {
            success: false,
            message: 'No installation method selected'
        };
    }

    /**
     * Show installation guide
     */
    private static async showInstallationGuide(): Promise<LLVMInstallResult> {
        const platform = process.platform;
        let guide = '';

        if (platform === 'win32') {
            guide = `# Windows LLVM Installation Guide

## Method 1: Official Installer (Recommended)
1. 访问 https://releases.llvm.org/download.html
2. 下载最新的LLVM二进制文件 (LLVM-X.Y.Z-win64.exe)
3. 运行安装程序，使用默认设置
4. 安装完成后重启VS Code

## Method 2: Package Manager
Using Chocolatey (requires administrator privileges):
\`\`\`bash
choco install llvm
\`\`\`

## Method 3: Manual Configuration
1. 下载LLVM并解压到 C:\\LLVM
2. 添加 C:\\LLVM\\bin 到系统PATH环境变量
3. 重启VS Code

## Verify Installation
Run in command line:
\`\`\`bash
clang --version
clang++ --version
\`\`\``;
        } else if (platform === 'darwin') {
            guide = `# macOS LLVM Installation Guide

## Method 1: Homebrew (Recommended)
\`\`\`bash
brew install llvm
\`\`\`

## Method 2: Xcode Command Line Tools
\`\`\`bash
xcode-select --install
\`\`\`

## Method 3: Official Installer
1. 访问 https://releases.llvm.org/download.html
2. 下载macOS版本的LLVM
3. 按照说明进行安装

## 验证安装
在终端中运行:
\`\`\`bash
clang --version
clang++ --version
\`\`\``;
        } else {
            guide = `# Linux LLVM Installation Guide

## Ubuntu/Debian
\`\`\`bash
sudo apt update
sudo apt install clang clang++ lldb
\`\`\`

## Fedora/CentOS/RHEL
\`\`\`bash
sudo dnf install clang clang++ lldb
\`\`\`

## Arch Linux
\`\`\`bash
sudo pacman -S clang lldb
\`\`\`

## Universal Binaries
1. 访问 https://releases.llvm.org/download.html
2. 下载对应发行版的预编译二进制文件
3. 解压并添加到PATH

## 验证安装
在终端中运行:
\`\`\`bash
clang --version
clang++ --version
\`\`\``;
        }

        // Show guide in new document
        const doc = await vscode.workspace.openTextDocument({
            content: guide,
            language: 'markdown'
        });
        await vscode.window.showTextDocument(doc);

        return {
            success: false,
            message: 'Installation guide displayed',
            nextSteps: [
                'Follow the steps in the guide to install LLVM',
                'Restart VS Code after installation',
                'Run compiler detection command to verify installation'
            ]
        };
    }

    /**
     * Automatically install LLVM
     */
    private static async installLLVMAutomatically(platform: string): Promise<LLVMInstallResult> {
        try {
            if (platform === 'win32') {
                return await this.installLLVMWindows();
            } else if (platform === 'darwin') {
                return await this.installLLVMMacOS();
            } else {
                return await this.installLLVMLinux();
            }
        } catch (error: any) {
            return {
                success: false,
                message: `Automatic installation failed: ${error.message}`,
                nextSteps: ['Please try manual installation or view installation guide']
            };
        }
    }

    /**
     * Windows LLVM automatic installation
     */
    private static async installLLVMWindows(): Promise<LLVMInstallResult> {
        const output = this.getOutputChannel();
        output.appendLine('Starting Windows LLVM automatic installation...');

        // Check if LLVM already exists
        const existing = await this.detectWindowsCompilers();
        if (existing.some(c => c.type === 'clang')) {
            return {
                success: true,
                message: 'LLVM already installed',
                nextSteps: ['Can use existing LLVM compiler directly']
            };
        }

        // Create PowerShell installation script
        const installScript = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

Write-Host "Downloading LLVM installer..."

# Get latest LLVM version from GitHub API
try {
    $Response = Invoke-RestMethod -Uri "https://api.github.com/repos/llvm/llvm-project/releases/latest" -UseBasicParsing
    $Version = $Response.tag_name -replace 'llvmorg-', ''
    Write-Host "Latest LLVM version: $Version"
} catch {
    Write-Host "Failed to fetch latest version, using fallback version 18.1.8"
    $Version = "18.1.8"
}

$Url = "https://github.com/llvm/llvm-project/releases/download/llvmorg-$Version/LLVM-$Version-win64.exe"
$Installer = "$env:TEMP\\llvm-installer.exe"

Invoke-WebRequest -Uri $Url -OutFile $Installer -UseBasicParsing

Write-Host "Installing LLVM..."
Start-Process -FilePath $Installer -ArgumentList '/S' -Wait

# Add LLVM to system PATH
try {
    $llvmBinPath = "C:\\Program Files\\LLVM\\bin"
    $machinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
    if ($machinePath -notlike "*$llvmBinPath*") {
        $newPath = "$machinePath;$llvmBinPath"
        [Environment]::SetEnvironmentVariable("Path", $newPath, "Machine")
        Write-Host "LLVM bin directory added to system PATH."
    } else {
        Write-Host "LLVM bin directory already in system PATH."
    }
} catch {
    Write-Warning "Failed to add LLVM to PATH. Please add C:\\Program Files\\LLVM\\bin to your PATH manually."
}

Write-Host "LLVM installation completed!"
Write-Host "Please restart VS Code to use LLVM compiler"

# Cleanup
Remove-Item $Installer -ErrorAction SilentlyContinue
`;

        // Save script to temporary file
        const scriptPath = path.join(os.tmpdir(), 'install-llvm.ps1');
        await fs.writeFile(scriptPath, installScript, 'utf8');

        // Run with administrator privileges
        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: 'Installing LLVM...',
                cancellable: false
            },
            async progress => {
                progress.report({ message: 'Downloading and installing LLVM...' });

                const powershellCommand = `Start-Process powershell -ArgumentList '-ExecutionPolicy Bypass -File "${scriptPath}"' -Verb RunAs -Wait`;
                await this.executeCommand('powershell', [
                    '-Command',
                    powershellCommand
                ]);
            }
        );

        // Clean up script file
        try {
            await fs.unlink(scriptPath);
        } catch {
            // Ignore cleanup errors
        }

        return {
            success: true,
            message: 'LLVM installer started',
            restartRequired: true,
            nextSteps: ['Please complete LLVM installation wizard', '重启VS Code', '运行编译器检测验证安装']
        };
    }

    /**
     * macOS LLVM automatic installation
     */
    private static async installLLVMMacOS(): Promise<LLVMInstallResult> {
        const output = this.getOutputChannel();
        output.appendLine('Starting macOS LLVM automatic installation...');

        // Check Homebrew
        try {
            await this.executeCommand('brew', ['--version']);
        } catch {
            return {
                success: false,
                message: 'Homebrew is required to install LLVM',
                nextSteps: [
                    'Please install Homebrew first:',
                    '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"',
                    'Then run LLVM installation again'
                ]
            };
        }

        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: 'Installing LLVM...',
                cancellable: false
            },
            async progress => {
                progress.report({ message: 'Installing LLVM via Homebrew...' });

                await this.executeCommand('brew', ['install', 'llvm']);
            }
        );

        return {
            success: true,
            message: 'LLVM installation completed',
            restartRequired: true,
            nextSteps: ['重启VS Code', '运行编译器检测验证安装']
        };
    }

    /**
     * Linux LLVM automatic installation
     */
    private static async installLLVMLinux(): Promise<LLVMInstallResult> {
        const output = this.getOutputChannel();
        output.appendLine('Starting Linux LLVM automatic installation...');

        // Detect package manager
        let packageManager = '';
        try {
            await this.executeCommand('apt', ['--version']);
            packageManager = 'apt';
        } catch {
            try {
                await this.executeCommand('dnf', ['--version']);
                packageManager = 'dnf';
            } catch {
                try {
                    await this.executeCommand('pacman', ['--version']);
                    packageManager = 'pacman';
                } catch {
                    return {
                        success: false,
                        message: 'Unable to detect supported package manager',
                        nextSteps: [
                            'Please manually install LLVM: sudo apt install clang clang++ lldb (Ubuntu/Debian)',
                            'Or refer to installation guide for installation'
                        ]
                    };
                }
            }
        }

        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: 'Installing LLVM...',
                cancellable: false
            },
            async progress => {
                progress.report({ message: `Installing LLVM using ${packageManager}...` });

                switch (packageManager) {
                    case 'apt':
                        await this.executeCommand('sudo', ['apt', 'update']);
                        await this.executeCommand('sudo', ['apt', 'install', '-y', 'clang', 'clang++', 'lldb']);
                        break;
                    case 'dnf':
                        await this.executeCommand('sudo', ['dnf', 'install', '-y', 'clang', 'clang++', 'lldb']);
                        break;
                    case 'pacman':
                        await this.executeCommand('sudo', ['pacman', '-S', '--noconfirm', 'clang', 'lldb']);
                        break;
                }
            }
        );

        return {
            success: true,
            message: 'LLVM installation completed',
            nextSteps: ['重启VS Code', '运行编译器检测验证安装']
        };
    }

    /**
     * Compile and run code
     */
    public static async compileAndRun(options: {
        sourcePath: string;
        language: 'c' | 'cpp';
        compiler: CompilerInfo;
        input: string;
        timeLimit: number;
        memoryLimit: number;
    }): Promise<{
        stdout: string;
        stderr: string;
        timedOut?: boolean;
        memoryExceeded?: boolean;
        spaceExceeded?: boolean;
    }> {
        const output = this.getOutputChannel();
        output.appendLine(`=== Compiling and running ${options.language} code ===`);
        output.appendLine(`Source file: ${options.sourcePath}`);
        output.appendLine(`Compiler: ${options.compiler.name}`);

        try {
            // Create temporary directory
            const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'oi-code-compile-'));
            const sourceFileName = path.basename(options.sourcePath);
            const tempSourcePath = path.join(tempDir, sourceFileName);
            const executableName = process.platform === 'win32' ? 'program.exe' : 'program';
            const executablePath = path.join(tempDir, executableName);

            // Copy source file to temporary directory
            await fs.copyFile(options.sourcePath, tempSourcePath);

            // Build compilation command
            const compileArgs = this.getCompilerArgs(
                options.compiler,
                options.language,
                tempSourcePath,
                executablePath
            );

            output.appendLine(`Compilation command: ${options.compiler.path} ${compileArgs.join(' ')}`);

            // Compile
            const compileResult = await this.executeWithTimeout({
                command: options.compiler.path,
                args: compileArgs,
                cwd: tempDir,
                timeout: options.timeLimit * 1000,
                input: '',
                memoryLimit: options.memoryLimit
            });

            if (compileResult.exitCode !== 0) {
                output.appendLine(`Compilation failed: ${compileResult.stderr}`);
                return {
                    stdout: '',
                    stderr: compileResult.stderr,
                    timedOut: compileResult.timedOut,
                    spaceExceeded: compileResult.spaceExceeded
                };
            }

            output.appendLine('Compilation successful, starting execution...');
            output.appendLine(`Compilation output: ${compileResult.stdout}`);
            output.appendLine(`Compilation errors: ${compileResult.stderr}`);

            // Ensure executable file has execute permissions
            if (process.platform !== 'win32') {
                try {
                    await fs.chmod(executablePath, '755');
                    output.appendLine(`Execute permissions set: ${executablePath}`);
                } catch (error) {
                    output.appendLine(`Failed to set execute permissions: ${error}`);
                }
            }

            // Check if executable file exists
            try {
                await fs.access(executablePath, fs.constants.F_OK | fs.constants.X_OK);
                output.appendLine(`Executable file verification successful: ${executablePath}`);
            } catch (error) {
                output.appendLine(`Executable file verification failed: ${error}`);
            }

            // Run program
            output.appendLine(`Execution command: ${executablePath}`);
            output.appendLine(`Execution input: "${options.input}"`);

            const runResult = await this.executeWithTimeout({
                command: executablePath,
                args: [],
                cwd: tempDir,
                timeout: options.timeLimit * 1000,
                input: options.input,
                memoryLimit: options.memoryLimit
            });

            output.appendLine(`Execution result - Exit code: ${runResult.exitCode}`);
            output.appendLine(`Execution result - Standard output: "${runResult.stdout}"`);
            output.appendLine(`Execution result - Standard error: "${runResult.stderr}"`);

            // Clean up temporary files
            try {
                await fs.rm(tempDir, { recursive: true, force: true });
            } catch (error) {
                output.appendLine(`Failed to clean up temporary files: ${error}`);
            }

            output.appendLine('Execution completed');
            return {
                stdout: runResult.stdout,
                stderr: runResult.stderr,
                timedOut: runResult.timedOut,
                memoryExceeded: runResult.memoryExceeded,
                spaceExceeded: runResult.spaceExceeded
            };
        } catch (error: any) {
            output.appendLine(`Compilation and execution failed: ${error.message}`);
            return {
                stdout: '',
                stderr: error.message,
                timedOut: false,
                memoryExceeded: false,
                spaceExceeded: false
            };
        }
    }

    /**
     * Get compiler arguments
     */
    private static getCompilerArgs(
        compiler: CompilerInfo,
        language: 'c' | 'cpp',
        sourcePath: string,
        outputPath: string
    ): string[] {
        const config = vscode.workspace.getConfiguration('oicode');
        const optimizationLevel = config.get<string>('compile.opt', 'O2');
        let languageStandard = config.get<string>('compile.std', 'c++17');

        const args = [];

        // For newer Clang versions, use compatible standards
        if (compiler.type === 'clang' || compiler.type === 'apple-clang') {
            const majorVersion = parseInt(compiler.version.split('.')[0], 10) || 0;
            if (majorVersion >= 20 && languageStandard === 'c++17') {
                // Clang 20+ may have compatibility issues with c++17, downgrade to c++14
                // This is a temporary workaround due to some changes in C++17 standard library implementation in Clang 20+
                // Note: This issue was found in Clang 20.x versions, specifically表现为某些C++17标准库特性编译失败
                // This temporary workaround ensures backward compatibility
                this.getOutputChannel().appendLine(
                    `[WARN] Forcing C++ standard to 'c++14' for Clang ${compiler.version} due to known compatibility issues with c++17. This can be overridden in settings.`
                );
                languageStandard = 'c++14';
            }
        }

        // Basic compilation parameters
        if (compiler.type === 'msvc') {
            args.push(`/${optimizationLevel}`);
            if (language === 'cpp') {
                args.push(`/std:${languageStandard}`);
            }
            args.push(`/Fe:${outputPath}`);
        } else {
            args.push(`-${optimizationLevel}`);
            if (language === 'cpp') {
                args.push(`-std=${languageStandard}`);
            }
            args.push('-o', outputPath);

            // For Apple Clang, need to explicitly link C++ standard library
            if (compiler.type === 'apple-clang' && language === 'cpp') {
                args.push('-lc++');
            }
        }

        args.push(sourcePath);
        return args;
    }

    /**
     * Check if disk space is sufficient
     * @param directory Directory to check
     * @param requiredSpaceMB Minimum required space (MB)
     * @returns Whether disk space is sufficient
     */
    private static async checkDiskSpace(directory: string, requiredSpaceMB: number = 100): Promise<boolean> {
        try {
            const util = require('util');
            const execAsync = util.promisify(exec);

            if (process.platform === 'win32') {
                // Windows: Use wmic command
                const command = `wmic logicaldisk where "DeviceID='${directory.charAt(0)}:'" get FreeSpace /value`;
                const { stdout } = await execAsync(command);
                const match = stdout.match(/FreeSpace=(\d+)/);
                if (match) {
                    const freeSpaceBytes = parseInt(match[1], 10);
                    const freeSpaceMB = freeSpaceBytes / (1024 * 1024);
                    return freeSpaceMB >= requiredSpaceMB;
                }
            } else {
                // Unix: Use df command
                const command = `df -k "${directory}" | tail -1 | awk '{print $4}'`;
                const { stdout } = await execAsync(command);
                const freeSpaceKB = parseInt(stdout.trim(), 10);
                const freeSpaceMB = freeSpaceKB / 1024;
                return freeSpaceMB >= requiredSpaceMB;
            }

            return true; // If unable to get disk space information, default to sufficient
        } catch {
            return true; // Default to sufficient when check fails
        }
    }

    /**
     * Execute command with timeout
     */
    private static async executeWithTimeout(options: {
        command: string;
        args: string[];
        cwd: string;
        timeout: number;
        input: string;
        memoryLimit?: number; // Memory limit (MB)
    }): Promise<{
        exitCode: number;
        stdout: string;
        stderr: string;
        timedOut?: boolean;
        memoryExceeded?: boolean;
        spaceExceeded?: boolean;
    }> {
        return new Promise(resolve => {
            (async () => {
                let child: any;
                let memoryExceeded = false;
                let spaceExceeded = false;
                let memoryCheckInterval: NodeJS.Timeout | null = null;

                // Check disk space
                const hasEnoughSpace = await this.checkDiskSpace(options.cwd);
                if (!hasEnoughSpace) {
                    spaceExceeded = true;
                    resolve({
                        exitCode: -1,
                        stdout: '',
                        stderr: 'No space left on device',
                        spaceExceeded: true
                    });
                    return;
                }

                // If memory limit is set and on Unix system, use ulimit
                if (options.memoryLimit && process.platform !== 'win32') {
                    const memoryKB = options.memoryLimit * 1024; // 转换为KB
                    // The script first tries to set the limit. If it fails, the command will not be executed due to `&&`.
                    // This is safer than swallowing errors.
                    const shellScript = `ulimit -v ${memoryKB} && ulimit -d ${memoryKB} && exec "$@"`;

                    child = spawn('sh', ['-c', shellScript, 'sh', options.command, ...options.args], {
                        cwd: options.cwd,
                        stdio: ['pipe', 'pipe', 'pipe']
                    });
                } else {
                    // Windows or no memory limit case
                    child = spawn(options.command, options.args, {
                        cwd: options.cwd,
                        stdio: ['pipe', 'pipe', 'pipe']
                    });

                    // For Windows, use polling to check memory usage
                    // TODO: Future improvement - Use Windows Job Objects for more efficient memory limit enforcement
                    // Job Objects provide OS-level resource management without polling overhead
                    // See design document LLVM_NATIVE_ANALYSIS.md for implementation details
                    if (options.memoryLimit && process.platform === 'win32') {
                        memoryCheckInterval = setInterval(async () => {
                            try {
                                // Use wmic command to get process memory usage
                                const memoryCheckCommand = `wmic process where ProcessId=${child.pid} get WorkingSetSize /value`;

                                exec(memoryCheckCommand, (error: any, stdout: string) => {
                                    if (!error && stdout) {
                                        const memoryMatch = stdout.match(/WorkingSetSize=(\d+)/);
                                        if (memoryMatch) {
                                            const memoryBytes = parseInt(memoryMatch[1], 10);
                                            const memoryMB = memoryBytes / (1024 * 1024);

                                            if (options.memoryLimit && memoryMB > options.memoryLimit) {
                                                memoryExceeded = true;
                                                child.kill('SIGKILL');
                                                if (memoryCheckInterval) {
                                                    clearInterval(memoryCheckInterval);
                                                    memoryCheckInterval = null;
                                                }
                                            }
                                        }
                                    }
                                });
                            } catch (error) {
                                // Ignore memory check errors, continue polling
                            }
                        }, 200); // Check every 200ms - balance between responsiveness and performance

                        // Clean up memory check timer
                        child.on('close', () => {
                            if (memoryCheckInterval) {
                                clearInterval(memoryCheckInterval);
                            }
                        });
                    }
                }

                let stdout = '';
                let stderr = '';
                let timedOut = false;

                const timeout = setTimeout(() => {
                    timedOut = true;
                    child.kill('SIGKILL');
                }, options.timeout);

                child.stdout?.on('data', (data: Buffer | string) => {
                    stdout += data.toString();
                });

                child.stderr?.on('data', (data: Buffer | string) => {
                    stderr += data.toString();
                });

                child.on('close', (code: number | null, signal: string | null) => {
                    clearTimeout(timeout);

                    // Check if terminated due to memory limit
                    if (process.platform !== 'win32' && options.memoryLimit) {
                        // On Unix systems, if process is killed by SIGKILL and not timed out, it might be due to memory limit
                        if (signal === 'SIGKILL' && !timedOut) {
                            memoryExceeded = true;
                        }
                    }

                    resolve({
                        exitCode: code ?? -1,
                        stdout,
                        stderr,
                        timedOut,
                        memoryExceeded,
                        spaceExceeded
                    });
                });

                child.on('error', (error: Error) => {
                    clearTimeout(timeout);
                    // 清理内存检查定时器
                    if (memoryCheckInterval) {
                        clearInterval(memoryCheckInterval);
                    }
                    resolve({
                        exitCode: -1,
                        stdout: '',
                        stderr: error.message,
                        timedOut: false,
                        memoryExceeded: false,
                        spaceExceeded: false
                    });
                });

                if (options.input) {
                    child.stdin?.write(options.input);
                }
                child.stdin?.end();
            })();
        });
    }

    /**
     * 执行命令
     */
    private static async executeCommand(command: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
        return new Promise((resolve, reject) => {
            const child = spawn(command, args, { stdio: 'pipe' });
            let stdout = '';
            let stderr = '';

            // Set 10 second timeout to prevent command from hanging
            const timeout = setTimeout(() => {
                child.kill('SIGKILL');
                reject(new Error(`Command timed out: ${command} ${args.join(' ')}`));
            }, 10000);

            child.stdout.on('data', data => {
                stdout += data.toString();
            });

            child.stderr.on('data', data => {
                stderr += data.toString();
            });

            child.on('close', code => {
                clearTimeout(timeout);
                if (code === 0) {
                    resolve({ stdout, stderr });
                } else {
                    reject(new Error(`Command failed with exit code ${code}: ${stderr}`));
                }
            });

            child.on('error', error => {
                clearTimeout(timeout);
                reject(error);
            });
        });
    }

    /**
     * Search for compilers in system PATH
     */
    private static async searchCompilersInPATH(compilerNames: string[]): Promise<string[]> {
        const foundCompilers: string[] = [];
        const pathEnv = process.env.PATH || '';
        const pathSeparator = process.platform === 'win32' ? ';' : ':';
        const searchPaths = pathEnv.split(pathSeparator);

        for (const compilerName of compilerNames) {
            for (const searchPath of searchPaths) {
                const compilerPath = path.join(searchPath, compilerName + (process.platform === 'win32' ? '.exe' : ''));
                if (await this.fileExists(compilerPath)) {
                    foundCompilers.push(compilerPath);
                    break; // Stop searching this compiler once found
                }
            }
        }

        return foundCompilers;
    }

    /**
     * Search for compilers in specified directory
     */
    private static async searchCompilersInDirectory(directory: string, compilerNames: string[]): Promise<string[]> {
        const foundCompilers: string[] = [];

        try {
            const entries = await fs.readdir(directory);
            for (const entry of entries) {
                const entryPath = path.join(directory, entry);
                try {
                    const stat = await fs.stat(entryPath);
                    if (stat.isFile()) {
                        // Check if it's the compiler we're looking for
                        const entryName = entry.toLowerCase();
                        for (const compilerName of compilerNames) {
                            const targetName =
                                compilerName.toLowerCase() + (process.platform === 'win32' ? '.exe' : '');
                            if (entryName === targetName || entryName === compilerName.toLowerCase()) {
                                foundCompilers.push(entryPath);
                                break;
                            }
                        }
                    }
                } catch {
                    // Ignore inaccessible files
                }
            }
        } catch {
            // Ignore inaccessible directories
        }

        return foundCompilers;
    }

    /**
     * Find Xcode compiler directories
     */
    private static async findXcodeCompilerDirectories(): Promise<string[]> {
        const directories: string[] = [];

        try {
            // Find Xcode applications
            const xcodePaths = [
                '/Applications/Xcode.app',
                '/Applications/Xcode-beta.app',
                `${process.env.HOME}/Applications/Xcode.app`
            ];

            for (const xcodePath of xcodePaths) {
                const toolchainPath = path.join(
                    xcodePath,
                    'Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin'
                );
                const developerPath = path.join(xcodePath, 'Contents/Developer/usr/bin');
                const platformsPath = path.join(xcodePath, 'Contents/Developer/Platforms');

                if (await this.fileExists(toolchainPath)) {
                    directories.push(toolchainPath);
                }
                if (await this.fileExists(developerPath)) {
                    directories.push(developerPath);
                }

                // Search for compilers on different platforms
                if (await this.fileExists(platformsPath)) {
                    try {
                        const platforms = await fs.readdir(platformsPath);
                        for (const platform of platforms) {
                            const platformBinPath = path.join(platformsPath, platform, 'Developer/usr/bin');
                            if (await this.fileExists(platformBinPath)) {
                                directories.push(platformBinPath);
                            }
                        }
                    } catch {
                        // Ignore inaccessible platform directories
                    }
                }
            }
        } catch {
            // Ignore Xcode search errors
        }

        return directories;
    }

    /**
     * Find LLVM versioned installations
     */
    private static async findLLVMVersionInstallations(): Promise<string[]> {
        const directories: string[] = [];

        try {
            // Search for common LLVM installation locations
            const searchPatterns = [
                '/usr/lib/llvm-*',
                '/opt/llvm-*',
                '/usr/local/llvm-*',
                '/home/*/.local/llvm-*',
                '/usr/local/opt/llvm@*', // Homebrew
                '/opt/homebrew/opt/llvm@*' // Homebrew Apple Silicon
            ];

            for (const pattern of searchPatterns) {
                try {
                    const { stdout } = await this.executeCommand('find', [
                        '/usr',
                        '/opt',
                        '/home',
                        '-maxdepth',
                        '3',
                        '-name',
                        pattern,
                        '-type',
                        'd',
                        '2>/dev/null'
                    ]);
                    const dirs = stdout
                        .trim()
                        .split('\n')
                        .filter(dir => dir.length > 0);
                    for (const dir of dirs) {
                        const binPath = path.join(dir, 'bin');
                        if (await this.fileExists(binPath)) {
                            directories.push(binPath);
                        }
                    }
                } catch {
                    // Ignore find command errors
                }
            }

            // Search for versioned compilers in /usr/bin
            try {
                const { stdout } = await this.executeCommand('find', [
                    '/usr/bin',
                    '-name',
                    'clang-[0-9]*',
                    '-o',
                    '-name',
                    'clang++-[0-9]*',
                    '2>/dev/null'
                ]);
                const compilers = stdout
                    .trim()
                    .split('\n')
                    .filter(compiler => compiler.length > 0);
                for (const compiler of compilers) {
                    const dir = path.dirname(compiler);
                    if (!directories.includes(dir)) {
                        directories.push(dir);
                    }
                }
            } catch {
                // 忽略find命令错误
            }
        } catch {
            // Ignore LLVM search errors
        }

        return directories;
    }

    /**
     * Find GCC versioned installations
     */
    private static async findGCCVersionInstallations(): Promise<string[]> {
        const directories: string[] = [];

        try {
            // Search for common GCC installation locations
            const searchPatterns = ['/usr/gcc-*', '/opt/gcc-*', '/usr/local/gcc-*', '/home/*/.local/gcc-*'];

            for (const pattern of searchPatterns) {
                try {
                    const { stdout } = await this.executeCommand('find', [
                        '/usr',
                        '/opt',
                        '/home',
                        '-maxdepth',
                        '3',
                        '-name',
                        pattern,
                        '-type',
                        'd',
                        '2>/dev/null'
                    ]);
                    const dirs = stdout
                        .trim()
                        .split('\n')
                        .filter(dir => dir.length > 0);
                    for (const dir of dirs) {
                        const binPath = path.join(dir, 'bin');
                        if (await this.fileExists(binPath)) {
                            directories.push(binPath);
                        }
                    }
                } catch {
                    // Ignore find command errors
                }
            }

            // Search for versioned compilers in /usr/bin
            try {
                const { stdout } = await this.executeCommand('find', [
                    '/usr/bin',
                    '-name',
                    'gcc-[0-9]*',
                    '-o',
                    '-name',
                    'g++-[0-9]*',
                    '2>/dev/null'
                ]);
                const compilers = stdout
                    .trim()
                    .split('\n')
                    .filter(compiler => compiler.length > 0);
                for (const compiler of compilers) {
                    const dir = path.dirname(compiler);
                    if (!directories.includes(dir)) {
                        directories.push(dir);
                    }
                }
            } catch {
                // 忽略find命令错误
            }
        } catch {
            // Ignore GCC search errors
        }

        return directories;
    }

    /**
     * Scan entire system for compilers (use with caution, may be slow)
     */
    private static async scanSystemForCompilers(compilerNames: string[]): Promise<string[]> {
        const foundCompilers: string[] = [];
        const output = this.getOutputChannel();

        output.appendLine('Starting full system compiler scan (this may take some time)...');

        try {
            // Build find command
            const namePatterns = compilerNames.map(name => `-name "${name}"`).join(' -o ');
            const searchCommand =
                process.platform === 'win32'
                    ? `where /R C:\\ ${compilerNames.join(' ')} 2>nul`
                    : `find / -type f \\( ${namePatterns} \\) 2>/dev/null | head -50`; // Limit result count

            const { stdout } = await this.executeCommand(process.platform === 'win32' ? 'cmd' : 'sh', [
                process.platform === 'win32' ? '/c' : '-c',
                searchCommand
            ]);

            const lines = stdout
                .trim()
                .split('\n')
                .filter(line => line.length > 0);
            for (const line of lines) {
                const compilerPath = line.trim();
                if (await this.fileExists(compilerPath)) {
                    foundCompilers.push(compilerPath);
                    output.appendLine(`Found compiler: ${compilerPath}`);
                }
            }

            output.appendLine(`Full system scan completed, found ${foundCompilers.length} compilers`);
        } catch (error: any) {
            output.appendLine(`Full system scan failed: ${error.message}`);
        }

        return foundCompilers;
    }

    /**
     * Check if file exists
     */
    private static async fileExists(filePath: string): Promise<boolean> {
        try {
            await fs.access(filePath);
            return true;
        } catch {
            return false;
        }
    }
}
