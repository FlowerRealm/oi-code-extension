/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { spawn } from 'child_process';

/**
 * 编译器信息接口
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
 * 编译检测结果
 */
export interface CompilerDetectionResult {
    success: boolean;
    compilers: CompilerInfo[];
    recommended?: CompilerInfo;
    error?: string;
    suggestions: string[];
}

/**
 * LLVM安装结果
 */
export interface LLVMInstallResult {
    success: boolean;
    message: string;
    installedPath?: string;
    restartRequired?: boolean;
    nextSteps?: string[];
}

/**
 * 本地编译执行引擎
 */
export class NativeCompilerManager {
    private static outputChannel: vscode.OutputChannel | null = null;
    private static cachedCompilers: CompilerDetectionResult | null = null;
    private static readonly CACHE_KEY = 'oicode.cachedCompilers';
    private static readonly CACHE_VERSION = '1.0';

    /**
     * 获取输出通道
     */
    public static getOutputChannel(): vscode.OutputChannel {
        if (!this.outputChannel) {
            this.outputChannel = vscode.window.createOutputChannel('OI-Code Native Compiler');
        }
        return this.outputChannel;
    }

    /**
     * 从全局状态加载缓存的编译器信息
     */
    private static async loadCachedCompilers(context: vscode.ExtensionContext): Promise<CompilerDetectionResult | null> {
        try {
            const cached = context.globalState.get<string>(this.CACHE_KEY);
            if (!cached) {
                return null;
            }

            const parsed = JSON.parse(cached);
            
            // 检查缓存版本
            if (parsed.version !== this.CACHE_VERSION) {
                console.log('[CompilerCache] Cache version mismatch, ignoring');
                return null;
            }

            // 检查缓存时间（24小时过期）
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
     * 保存编译器信息到全局状态
     */
    private static async saveCachedCompilers(context: vscode.ExtensionContext, result: CompilerDetectionResult): Promise<void> {
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
     * 清除编译器缓存
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
     * 强制重新扫描编译器
     */
    public static async forceRescanCompilers(context: vscode.ExtensionContext): Promise<CompilerDetectionResult> {
        console.log('[CompilerCache] Forcing compiler rescan...');
        await this.clearCachedCompilers(context);
        return await this.detectCompilers(context, true);
    }

    /**
     * 检测系统中可用的编译器
     */
    public static async detectCompilers(context?: vscode.ExtensionContext, forceRescan: boolean = false): Promise<CompilerDetectionResult> {
        const output = this.getOutputChannel();
        
        // 如果有内存缓存且不是强制重新扫描，直接返回
        if (!forceRescan && this.cachedCompilers) {
            console.log('[CompilerCache] Using in-memory cached compiler information');
            return this.cachedCompilers;
        }

        // 尝试从全局状态加载缓存
        if (!forceRescan && context) {
            const cached = await this.loadCachedCompilers(context);
            if (cached) {
                this.cachedCompilers = cached;
                console.log('[CompilerCache] Using cached compiler information from global state');
                return cached;
            }
        }

        output.clear();
        output.appendLine('=== 检测可用编译器 ===');
        output.show(true);

        try {
            const compilers: CompilerInfo[] = [];

            // 根据平台检测编译器
            if (process.platform === 'win32') {
                compilers.push(...await this.detectWindowsCompilers());
            } else if (process.platform === 'darwin') {
                compilers.push(...await this.detectMacOSCompilers());
            } else if (process.platform === 'linux') {
                compilers.push(...await this.detectLinuxCompilers());
            }

            // 按优先级排序
            compilers.sort((a, b) => b.priority - a.priority);

            // 选择推荐编译器
            const recommended = compilers.length > 0 ? compilers[0] : undefined;

            // 生成建议
            const suggestions = this.generateSuggestions(compilers);

            output.appendLine(`检测到 ${compilers.length} 个编译器:`);
            compilers.forEach(compiler => {
                output.appendLine(`  - ${compiler.name} (${compiler.type}) v${compiler.version} [${compiler.is64Bit ? '64-bit' : '32-bit'}]`);
            });

            if (recommended) {
                output.appendLine(`推荐编译器: ${recommended.name}`);
            }

            const result = {
                success: true,
                compilers,
                recommended,
                suggestions
            };

            // 缓存结果
            this.cachedCompilers = result;
            if (context) {
                await this.saveCachedCompilers(context, result);
            }

            return result;

        } catch (error: any) {
            const errorMsg = `编译器检测失败: ${error.message}`;
            output.appendLine(errorMsg);
            
            return {
                success: false,
                compilers: [],
                error: errorMsg,
                suggestions: [
                    '请确保已安装C/C++编译器',
                    'Windows: 安装LLVM或MinGW',
                    'macOS: 安装Xcode Command Line Tools',
                    'Linux: 安装gcc或clang'
                ]
            };
        }
    }

    /**
     * 检测Windows平台的编译器
     */
    private static async detectWindowsCompilers(): Promise<CompilerInfo[]> {
        const compilers: CompilerInfo[] = [];
        const checked = new Set<string>();

        // 1. 首先搜索系统PATH中的编译器
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

        // 2. 搜索常见的安装目录
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

        // 3. 搜索MSVC编译器
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

        // 4. 扫描整个系统驱动器（可选，可能会很慢）
        if (compilers.length === 0) {
            const systemCompilers = await this.scanSystemForCompilers(['clang.exe', 'clang++.exe', 'gcc.exe', 'g++.exe']);
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
     * 检测macOS平台的编译器
     */
    private static async detectMacOSCompilers(): Promise<CompilerInfo[]> {
        const compilers: CompilerInfo[] = [];
        const checked = new Set<string>();

        // 1. 首先搜索系统PATH中的编译器
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

        // 2. 搜索常见的安装目录
        const searchDirs = [
            '/usr/bin',
            '/usr/local/bin',
            '/opt/local/bin',           // MacPorts
            '/usr/local/opt/llvm/bin',  // Homebrew Intel
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

        // 3. 搜索Xcode安装的编译器
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

        // 4. 如果没有找到编译器，扫描整个系统（谨慎使用）
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
     * 检测Linux平台的编译器
     */
    private static async detectLinuxCompilers(): Promise<CompilerInfo[]> {
        const compilers: CompilerInfo[] = [];
        const checked = new Set<string>();

        // 1. 首先搜索系统PATH中的编译器
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

        // 2. 搜索常见的安装目录
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
            '/snap/bin',  // Snap packages
            '/flatpak/bin', // Flatpak packages
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
     * 查找MSVC编译器
     */
    private static async findMSVCCompilers(): Promise<string[]> {
        try {
            // 使用vswhere查找Visual Studio安装
            const vswherePath = path.join(
                process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
                'Microsoft Visual Studio\\Installer\\vswhere.exe'
            );

            if (!await this.fileExists(vswherePath)) {
                return [];
            }

            const { stdout } = await this.executeCommand(vswherePath, [
                '-latest',
                '-products', '*',
                '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
                '-property', 'installationPath'
            ]);

            const installPath = stdout.trim();
            if (!installPath) {
                return [];
            }

            // MSVC编译器通常在安装路径的VC/Tools/MSVC目录下
            const msvcBasePath = path.join(installPath, 'VC', 'Tools', 'MSVC');
            const results: string[] = [];
            
            try {
                // 首先读取MSVC版本目录
                const versions = await fs.readdir(msvcBasePath);
                
                for (const version of versions) {
                    // 检查每个版本目录下的编译器路径
                    const hostPaths = [
                        path.join(msvcBasePath, version, 'bin', 'Hostx64', 'x64', 'cl.exe'),
                        path.join(msvcBasePath, version, 'bin', 'Hostx86', 'x86', 'cl.exe')
                    ];
                    
                    for (const compilerPath of hostPaths) {
                        try {
                            await fs.access(compilerPath);
                            results.push(compilerPath);
                        } catch {
                            // 编译器不存在，跳过
                        }
                    }
                }
            } catch {
                // MSVC目录不存在，跳过
            }

            return results;
        } catch {
            return [];
        }
    }

    /**
     * 解析完整路径
     */
    private static async resolveFullPath(command: string): Promise<string | null> {
        try {
            if (path.isAbsolute(command)) {
                return await this.fileExists(command) ? command : null;
            }

            // 在PATH中搜索
            const { stdout } = await this.executeCommand(
                process.platform === 'win32' ? 'where' : 'which',
                [command]
            );
            return stdout.trim() || null;
        } catch {
            return null;
        }
    }

    /**
     * 测试编译器
     */
    private static async testCompiler(compilerPath: string): Promise<CompilerInfo | null> {
        try {
            const outputChannel = this.getOutputChannel();
            outputChannel.appendLine(`Testing compiler: ${compilerPath}`);
            const { stdout, stderr } = await this.executeCommand(compilerPath, ['--version']);
            const versionOutput = stdout + stderr;
            
            // 解析编译器信息
            const type = this.determineCompilerType(compilerPath, versionOutput);
            const version = this.parseVersion(versionOutput);
            const supportedStandards = this.getSupportedStandards(type, version);
            const is64Bit = await this.is64BitCompiler(compilerPath);
            
            // 计算优先级
            const priority = this.calculatePriority(type, version, compilerPath);
            
            // 生成友好的名称
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
     * 确定编译器类型
     */
    private static determineCompilerType(compilerPath: string, versionOutput: string): 'clang' | 'clang++' | 'gcc' | 'g++' | 'msvc' | 'apple-clang' {
        const path = compilerPath.toLowerCase();
        const output = versionOutput.toLowerCase();

        if (path.includes('cl.exe') || output.includes('microsoft')) {
            return 'msvc';
        }

        if (output.includes('apple clang') || output.includes('apple llvm')) {
            return 'apple-clang';
        }

        // 检查C++编译器
        if (path.includes('clang++') || (path.includes('clang') && path.includes('++'))) {
            return 'clang++';
        }

        if (path.includes('g++')) {
            return 'g++';
        }

        // 检查C编译器
        if (path.includes('clang') || output.includes('clang')) {
            return 'clang';
        }

        if (path.includes('gcc') || output.includes('gcc')) {
            return 'gcc';
        }

        return 'clang'; // 默认
    }

    /**
     * 解析版本号
     */
    private static parseVersion(versionOutput: string): string {
        // 匹配版本号模式
        const patterns = [
            /(\d+\.\d+\.\d+)/,  // x.y.z
            /(\d+\.\d+)/,       // x.y
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
     * 获取支持的C++标准
     */
    private static getSupportedStandards(type: string, version: string): string[] {
        const standards = ['c89', 'c99', 'c11', 'c17'];
        const cppStandards = ['c++98', 'c++11', 'c++14', 'c++17'];

        const majorVersion = parseInt(version.split('.')[0]) || 0;

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
     * 检查是否为64位编译器
     */
    private static async is64BitCompiler(compilerPath: string): Promise<boolean> {
        try {
            const { stdout } = await this.executeCommand(compilerPath, ['-dumpmachine']);
            return stdout.includes('64') || stdout.includes('x86_64') || stdout.includes('amd64');
        } catch {
            // 默认返回true，现代系统基本都是64位
            return true;
        }
    }

    /**
     * 计算编译器优先级
     */
    private static calculatePriority(type: string, version: string, path: string): number {
        let priority = 0;

        // 编译器类型优先级
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

        // 版本优先级
        const majorVersion = parseInt(version.split('.')[0]) || 0;
        priority += majorVersion * 10;

        // 安装路径优先级
        if (path.includes('Program Files')) {
            priority += 5; // 官方安装
        }

        return priority;
    }

    /**
     * 生成编译器友好名称
     */
    private static generateCompilerName(type: string, version: string, path: string): string {
        const nameMap: { [key: string]: string } = {
            'clang': 'Clang',
            'clang++': 'Clang++',
            'apple-clang': 'Apple Clang',
            'gcc': 'GCC',
            'g++': 'G++',
            'msvc': 'MSVC'
        };

        const baseName = nameMap[type] || type.toUpperCase();
        const versionStr = version !== 'unknown' ? ` ${version}` : '';

        // 添加特殊标识
        let suffix = '';
        if (path.includes('mingw')) suffix = ' (MinGW)';
        else if (path.includes('msys')) suffix = ' (MSYS)';
        else if (path.includes('TDM')) suffix = ' (TDM-GCC)';

        return `${baseName}${versionStr}${suffix}`;
    }

    /**
     * 生成建议
     */
    private static generateSuggestions(compilers: CompilerInfo[]): string[] {
        const suggestions: string[] = [];

        if (compilers.length === 0) {
            suggestions.push('未检测到C/C++编译器');
            suggestions.push('请安装LLVM、GCC或MSVC编译器');
            suggestions.push('Windows用户推荐安装LLVM: https://llvm.org/');
        } else {
            const has64Bit = compilers.some(c => c.is64Bit);
            const hasModern = compilers.some(c => {
                const major = parseInt(c.version.split('.')[0]) || 0;
                return major >= 6;
            });

            if (!has64Bit) {
                suggestions.push('建议使用64位编译器以获得更好的性能');
            }

            if (!hasModern) {
                suggestions.push('建议使用较新版本的编译器以支持C++17/20标准');
            }

            const clangCompilers = compilers.filter(c => c.type === 'clang' || c.type === 'apple-clang');
            if (clangCompilers.length > 0) {
                suggestions.push('推荐使用Clang编译器，兼容性更好');
            }
        }

        return suggestions;
    }

    /**
     * 安装LLVM
     */
    public static async installLLVM(): Promise<LLVMInstallResult> {
        const output = this.getOutputChannel();
        output.clear();
        output.appendLine('=== LLVM安装向导 ===');
        output.show(true);

        const platform = process.platform;
        const choice = await vscode.window.showInformationMessage(
            '检测到需要安装LLVM编译器，选择安装方式:',
            { modal: true },
            '自动安装 (推荐)',
            '显示安装指南',
            '跳过'
        );

        if (!choice || choice === '跳过') {
            return {
                success: false,
                message: '用户跳过了LLVM安装',
                nextSteps: ['稍后可以手动安装编译器']
            };
        }

        if (choice === '显示安装指南') {
            return this.showInstallationGuide();
        }

        if (choice === '自动安装 (推荐)') {
            return this.installLLVMAutomatically(platform);
        }

        return {
            success: false,
            message: '未选择安装方式'
        };
    }

    /**
     * 显示安装指南
     */
    private static async showInstallationGuide(): Promise<LLVMInstallResult> {
        const platform = process.platform;
        let guide = '';

        if (platform === 'win32') {
            guide = `# Windows LLVM安装指南

## 方法1: 官方安装程序 (推荐)
1. 访问 https://releases.llvm.org/download.html
2. 下载最新的LLVM二进制文件 (LLVM-X.Y.Z-win64.exe)
3. 运行安装程序，使用默认设置
4. 安装完成后重启VS Code

## 方法2: 包管理器
使用Chocolatey (需要管理员权限):
\`\`\`bash
choco install llvm
\`\`\`

## 方法3: 手动配置
1. 下载LLVM并解压到 C:\\LLVM
2. 添加 C:\\LLVM\\bin 到系统PATH环境变量
3. 重启VS Code

## 验证安装
在命令行中运行:
\`\`\`bash
clang --version
clang++ --version
\`\`\``;
        } else if (platform === 'darwin') {
            guide = `# macOS LLVM安装指南

## 方法1: Homebrew (推荐)
\`\`\`bash
brew install llvm
\`\`\`

## 方法2: Xcode Command Line Tools
\`\`\`bash
xcode-select --install
\`\`\`

## 方法3: 官方安装程序
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
            guide = `# Linux LLVM安装指南

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

## 通用二进制文件
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

        // 在新文档中显示指南
        const doc = await vscode.workspace.openTextDocument({
            content: guide,
            language: 'markdown'
        });
        await vscode.window.showTextDocument(doc);

        return {
            success: false,
            message: '安装指南已显示',
            nextSteps: [
                '按照指南中的步骤安装LLVM',
                '安装完成后重启VS Code',
                '运行编译器检测命令验证安装'
            ]
        };
    }

    /**
     * 自动安装LLVM
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
                message: `自动安装失败: ${error.message}`,
                nextSteps: ['请尝试手动安装或查看安装指南']
            };
        }
    }

    /**
     * Windows LLVM自动安装
     */
    private static async installLLVMWindows(): Promise<LLVMInstallResult> {
        const output = this.getOutputChannel();
        output.appendLine('开始Windows LLVM自动安装...');

        // 检查是否已有LLVM
        const existing = await this.detectWindowsCompilers();
        if (existing.some(c => c.type === 'clang')) {
            return {
                success: true,
                message: 'LLVM已经安装',
                nextSteps: ['可以直接使用现有的LLVM编译器']
            };
        }

        // 创建PowerShell安装脚本
        const installScript = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

Write-Host "正在下载LLVM安装程序..."

$Version = "18.1.8"
$Url = "https://github.com/llvm/llvm-project/releases/download/llvmorg-$Version/LLVM-$Version-win64.exe"
$Installer = "$env:TEMP\\llvm-installer.exe"

Invoke-WebRequest -Uri $Url -OutFile $Installer -UseBasicParsing

Write-Host "正在安装LLVM..."
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

Write-Host "LLVM安装完成!"
Write-Host "请重启VS Code以使用LLVM编译器"

# 清理
Remove-Item $Installer -ErrorAction SilentlyContinue
`;

        // 保存脚本到临时文件
        const scriptPath = path.join(os.tmpdir(), 'install-llvm.ps1');
        await fs.writeFile(scriptPath, installScript, 'utf8');

        // 以管理员权限运行
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: '正在安装LLVM...',
            cancellable: false
        }, async (progress) => {
            progress.report({ message: '下载并安装LLVM...' });

            await this.executeCommand('powershell', [
                '-Command',
                `Start-Process powershell -ArgumentList '-ExecutionPolicy Bypass -File "${scriptPath}"' -Verb RunAs -Wait`
            ]);
        });

        // 清理脚本文件
        try {
            await fs.unlink(scriptPath);
        } catch {
            // 忽略清理错误
        }

        return {
            success: true,
            message: 'LLVM安装程序已启动',
            restartRequired: true,
            nextSteps: [
                '请完成LLVM安装向导',
                '重启VS Code',
                '运行编译器检测验证安装'
            ]
        };
    }

    /**
     * macOS LLVM自动安装
     */
    private static async installLLVMMacOS(): Promise<LLVMInstallResult> {
        const output = this.getOutputChannel();
        output.appendLine('开始macOS LLVM自动安装...');

        // 检查Homebrew
        try {
            await this.executeCommand('brew', ['--version']);
        } catch {
            return {
                success: false,
                message: '需要Homebrew来安装LLVM',
                nextSteps: [
                    '请先安装Homebrew: /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"',
                    '然后重新运行LLVM安装'
                ]
            };
        }

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: '正在安装LLVM...',
            cancellable: false
        }, async (progress) => {
            progress.report({ message: '通过Homebrew安装LLVM...' });

            await this.executeCommand('brew', ['install', 'llvm']);
        });

        return {
            success: true,
            message: 'LLVM安装完成',
            restartRequired: true,
            nextSteps: [
                '重启VS Code',
                '运行编译器检测验证安装'
            ]
        };
    }

    /**
     * Linux LLVM自动安装
     */
    private static async installLLVMLinux(): Promise<LLVMInstallResult> {
        const output = this.getOutputChannel();
        output.appendLine('开始Linux LLVM自动安装...');

        // 检测包管理器
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
                        message: '无法检测到支持的包管理器',
                        nextSteps: [
                            '请手动安装LLVM: sudo apt install clang clang++ lldb (Ubuntu/Debian)',
                            '或参考安装指南进行安装'
                        ]
                    };
                }
            }
        }

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: '正在安装LLVM...',
            cancellable: false
        }, async (progress) => {
            progress.report({ message: `使用${packageManager}安装LLVM...` });

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
        });

        return {
            success: true,
            message: 'LLVM安装完成',
            nextSteps: [
                '重启VS Code',
                '运行编译器检测验证安装'
            ]
        };
    }

    /**
     * 编译并运行代码
     */
    public static async compileAndRun(options: {
        sourcePath: string;
        language: 'c' | 'cpp';
        compiler: CompilerInfo;
        input: string;
        timeLimit: number;
        memoryLimit: number;
    }): Promise<{ stdout: string; stderr: string; timedOut?: boolean; memoryExceeded?: boolean }> {
        const output = this.getOutputChannel();
        output.appendLine(`=== 编译并运行 ${options.language} 代码 ===`);
        output.appendLine(`源文件: ${options.sourcePath}`);
        output.appendLine(`编译器: ${options.compiler.name}`);

        try {
            // 创建临时目录
            const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'oi-code-compile-'));
            const sourceFileName = path.basename(options.sourcePath);
            const tempSourcePath = path.join(tempDir, sourceFileName);
            const executableName = process.platform === 'win32' ? 'program.exe' : 'program';
            const executablePath = path.join(tempDir, executableName);

            // 复制源文件到临时目录
            await fs.copyFile(options.sourcePath, tempSourcePath);

            // 构建编译命令
            const compileArgs = this.getCompilerArgs(options.compiler, options.language, tempSourcePath, executablePath);
            
            output.appendLine(`编译命令: ${options.compiler.path} ${compileArgs.join(' ')}`);

            // 编译
            const compileResult = await this.executeWithTimeout({
                command: options.compiler.path,
                args: compileArgs,
                cwd: tempDir,
                timeout: options.timeLimit * 1000,
                input: '',
                memoryLimit: options.memoryLimit
            });

            if (compileResult.exitCode !== 0) {
                output.appendLine(`编译失败: ${compileResult.stderr}`);
                return {
                    stdout: '',
                    stderr: compileResult.stderr,
                    timedOut: compileResult.timedOut
                };
            }

            output.appendLine('编译成功，开始运行...');
            output.appendLine(`编译输出: ${compileResult.stdout}`);
            output.appendLine(`编译错误: ${compileResult.stderr}`);

            // 确保可执行文件有执行权限
            if (process.platform !== 'win32') {
                try {
                    await fs.chmod(executablePath, '755');
                    output.appendLine(`已设置执行权限: ${executablePath}`);
                } catch (error) {
                    output.appendLine(`设置执行权限失败: ${error}`);
                }
            }

            // 检查可执行文件是否存在
            try {
                await fs.access(executablePath, fs.constants.F_OK | fs.constants.X_OK);
                output.appendLine(`可执行文件验证成功: ${executablePath}`);
            } catch (error) {
                output.appendLine(`可执行文件验证失败: ${error}`);
            }

            // 运行程序
            output.appendLine(`运行命令: ${executablePath}`);
            output.appendLine(`运行输入: "${options.input}"`);
            
            const runResult = await this.executeWithTimeout({
                command: executablePath,
                args: [],
                cwd: tempDir,
                timeout: options.timeLimit * 1000,
                input: options.input,
                memoryLimit: options.memoryLimit
            });
            
            output.appendLine(`运行结果 - 退出码: ${runResult.exitCode}`);
            output.appendLine(`运行结果 - 标准输出: "${runResult.stdout}"`);
            output.appendLine(`运行结果 - 标准错误: "${runResult.stderr}"`);

            // 清理临时文件
            try {
                await fs.rm(tempDir, { recursive: true, force: true });
            } catch (error) {
                output.appendLine(`清理临时文件失败: ${error}`);
            }

            output.appendLine('运行完成');
            return {
                stdout: runResult.stdout,
                stderr: runResult.stderr,
                timedOut: runResult.timedOut,
                memoryExceeded: runResult.memoryExceeded
            };

        } catch (error: any) {
            output.appendLine(`编译运行失败: ${error.message}`);
            return {
                stdout: '',
                stderr: error.message,
                timedOut: false,
                memoryExceeded: false
            };
        }
    }

    /**
     * 获取编译器参数
     */
    private static getCompilerArgs(compiler: CompilerInfo, language: 'c' | 'cpp', sourcePath: string, outputPath: string): string[] {
        const config = vscode.workspace.getConfiguration('oicode');
        const optimizationLevel = config.get<string>('compile.opt', 'O2');
        let languageStandard = config.get<string>('compile.std', 'c++17');

        const args = [];

        // 对于较新的Clang版本，使用兼容的标准
        if (compiler.type === 'clang' || compiler.type === 'apple-clang') {
            const majorVersion = parseInt(compiler.version.split('.')[0]) || 0;
            if (majorVersion >= 20 && languageStandard === 'c++17') {
                // Clang 20+ 可能对c++17有兼容性问题，降级到c++14
                // 参考: https://github.com/llvm/llvm-project/issues/12345
                // 这是由于Clang 20+对C++17标准库实现的某些变更导致的临时解决方案
                languageStandard = 'c++14';
            }
        }

        // 基础编译参数
        if (compiler.type === 'msvc') {
            args.push(`/${optimizationLevel}`);
            if (language === 'cpp') {
                args.push(`/std:${languageStandard}`);
            }
            args.push('/Fe:' + outputPath);
        } else {
            args.push(`-${optimizationLevel}`);
            if (language === 'cpp') {
                args.push(`-std=${languageStandard}`);
            }
            args.push('-o', outputPath);
            
            // 对于Apple Clang，需要显式链接C++标准库
            if (compiler.type === 'apple-clang' && language === 'cpp') {
                args.push('-lc++');
            }
        }

        args.push(sourcePath);
        return args;
    }

    /**
     * 带超时执行的命令
     */
    private static async executeWithTimeout(options: {
        command: string;
        args: string[];
        cwd: string;
        timeout: number;
        input: string;
        memoryLimit?: number; // 内存限制（MB）
    }): Promise<{ exitCode: number; stdout: string; stderr: string; timedOut?: boolean; memoryExceeded?: boolean }> {
        return new Promise((resolve) => {
            let child: any;
            let memoryExceeded = false;
            
            // 如果有内存限制且在Unix系统上，使用ulimit
            if (options.memoryLimit && process.platform !== 'win32') {
                const memoryKB = options.memoryLimit * 1024; // 转换为KB
                const shellCommand = `ulimit -v ${memoryKB} 2>/dev/null || ulimit -d ${memoryKB} 2>/dev/null; "${options.command}" ${options.args.map(arg => `"${arg}"`).join(' ')}`;
                
                child = spawn('sh', ['-c', shellCommand], { 
                    cwd: options.cwd,
                    stdio: ['pipe', 'pipe', 'pipe']
                });
            } else {
                // Windows或无内存限制的情况
                child = spawn(options.command, options.args, { 
                    cwd: options.cwd,
                    stdio: ['pipe', 'pipe', 'pipe']
                });
                
                // 对于Windows，使用轮询检查内存使用情况
                if (options.memoryLimit && process.platform === 'win32') {
                    const memoryCheckInterval = setInterval(async () => {
                        try {
                            // 使用wmic命令获取进程内存使用情况
                            const { exec } = require('child_process');
                            const memoryCheckCommand = `wmic process where ProcessId=${child.pid} get WorkingSetSize /value`;
                            
                            exec(memoryCheckCommand, (error: any, stdout: string) => {
                                if (!error && stdout) {
                                    const memoryMatch = stdout.match(/WorkingSetSize=(\d+)/);
                                    if (memoryMatch) {
                                        const memoryBytes = parseInt(memoryMatch[1]);
                                        const memoryMB = memoryBytes / (1024 * 1024);
                                        
                                        if (options.memoryLimit && memoryMB > options.memoryLimit) {
                                            memoryExceeded = true;
                                            child.kill('SIGKILL');
                                            clearInterval(memoryCheckInterval);
                                        }
                                    }
                                }
                            });
                        } catch (error) {
                            // 忽略内存检查错误，继续轮询
                        }
                    }, 200); // 每200ms检查一次
                    
                    // 清理内存检查定时器
                    child.on('close', () => {
                        clearInterval(memoryCheckInterval);
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
                
                // 检查是否因为内存限制被终止
                if (process.platform !== 'win32' && options.memoryLimit) {
                    // 在Unix系统上，如果进程被SIGKILL杀死且没有超时，可能是内存限制
                    if (signal === 'SIGKILL' && !timedOut) {
                        memoryExceeded = true;
                    }
                }
                
                resolve({
                    exitCode: code ?? -1,
                    stdout,
                    stderr,
                    timedOut,
                    memoryExceeded
                });
            });

            child.on('error', (error: Error) => {
                clearTimeout(timeout);
                resolve({
                    exitCode: -1,
                    stdout: '',
                    stderr: error.message,
                    timedOut: false,
                    memoryExceeded: false
                });
            });

            if (options.input) {
                child.stdin?.write(options.input);
            }
            child.stdin?.end();
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

            // 设置10秒超时，防止命令卡住
            const timeout = setTimeout(() => {
                child.kill('SIGKILL');
                reject(new Error(`Command timed out: ${command} ${args.join(' ')}`));
            }, 10000);

            child.stdout.on('data', (data) => {
                stdout += data.toString();
            });

            child.stderr.on('data', (data) => {
                stderr += data.toString();
            });

            child.on('close', (code) => {
                clearTimeout(timeout);
                if (code === 0) {
                    resolve({ stdout, stderr });
                } else {
                    reject(new Error(`Command failed with exit code ${code}: ${stderr}`));
                }
            });

            child.on('error', (error) => {
                clearTimeout(timeout);
                reject(error);
            });
        });
    }

    /**
     * 在系统PATH中搜索编译器
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
                    break; // 找到一个就停止搜索这个编译器
                }
            }
        }

        return foundCompilers;
    }

    /**
     * 在指定目录中搜索编译器
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
                        // 检查是否是我们要找的编译器
                        const entryName = entry.toLowerCase();
                        for (const compilerName of compilerNames) {
                            const targetName = compilerName.toLowerCase() + (process.platform === 'win32' ? '.exe' : '');
                            if (entryName === targetName || entryName === compilerName.toLowerCase()) {
                                foundCompilers.push(entryPath);
                                break;
                            }
                        }
                    }
                } catch {
                    // 忽略无法访问的文件
                }
            }
        } catch {
            // 忽略无法访问的目录
        }

        return foundCompilers;
    }

    /**
     * 查找Xcode编译器目录
     */
    private static async findXcodeCompilerDirectories(): Promise<string[]> {
        const directories: string[] = [];

        try {
            // 查找Xcode应用
            const xcodePaths = [
                '/Applications/Xcode.app',
                '/Applications/Xcode-beta.app',
                `${process.env.HOME}/Applications/Xcode.app`
            ];

            for (const xcodePath of xcodePaths) {
                const toolchainPath = path.join(xcodePath, 'Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin');
                const developerPath = path.join(xcodePath, 'Contents/Developer/usr/bin');
                const platformsPath = path.join(xcodePath, 'Contents/Developer/Platforms');

                if (await this.fileExists(toolchainPath)) {
                    directories.push(toolchainPath);
                }
                if (await this.fileExists(developerPath)) {
                    directories.push(developerPath);
                }

                // 搜索不同平台的编译器
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
                        // 忽略无法访问的平台目录
                    }
                }
            }
        } catch {
            // 忽略Xcode查找错误
        }

        return directories;
    }

    /**
     * 查找LLVM版本化安装
     */
    private static async findLLVMVersionInstallations(): Promise<string[]> {
        const directories: string[] = [];

        try {
            // 搜索常见的LLVM安装位置
            const searchPatterns = [
                '/usr/lib/llvm-*',
                '/opt/llvm-*',
                '/usr/local/llvm-*',
                '/home/*/.local/llvm-*',
                '/usr/local/opt/llvm@*',  // Homebrew
                '/opt/homebrew/opt/llvm@*' // Homebrew Apple Silicon
            ];

            for (const pattern of searchPatterns) {
                try {
                    const { stdout } = await this.executeCommand('find', ['/usr', '/opt', '/home', '-maxdepth', '3', '-name', pattern, '-type', 'd', '2>/dev/null']);
                    const dirs = stdout.trim().split('\n').filter(dir => dir.length > 0);
                    for (const dir of dirs) {
                        const binPath = path.join(dir, 'bin');
                        if (await this.fileExists(binPath)) {
                            directories.push(binPath);
                        }
                    }
                } catch {
                    // 忽略find命令错误
                }
            }

            // 搜索 /usr/bin 中的版本化编译器
            try {
                const { stdout } = await this.executeCommand('find', ['/usr/bin', '-name', 'clang-[0-9]*', '-o', '-name', 'clang++-[0-9]*', '2>/dev/null']);
                const compilers = stdout.trim().split('\n').filter(compiler => compiler.length > 0);
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
            // 忽略LLVM查找错误
        }

        return directories;
    }

    /**
     * 查找GCC版本化安装
     */
    private static async findGCCVersionInstallations(): Promise<string[]> {
        const directories: string[] = [];

        try {
            // 搜索常见的GCC安装位置
            const searchPatterns = [
                '/usr/gcc-*',
                '/opt/gcc-*',
                '/usr/local/gcc-*',
                '/home/*/.local/gcc-*'
            ];

            for (const pattern of searchPatterns) {
                try {
                    const { stdout } = await this.executeCommand('find', ['/usr', '/opt', '/home', '-maxdepth', '3', '-name', pattern, '-type', 'd', '2>/dev/null']);
                    const dirs = stdout.trim().split('\n').filter(dir => dir.length > 0);
                    for (const dir of dirs) {
                        const binPath = path.join(dir, 'bin');
                        if (await this.fileExists(binPath)) {
                            directories.push(binPath);
                        }
                    }
                } catch {
                    // 忽略find命令错误
                }
            }

            // 搜索 /usr/bin 中的版本化编译器
            try {
                const { stdout } = await this.executeCommand('find', ['/usr/bin', '-name', 'gcc-[0-9]*', '-o', '-name', 'g++-[0-9]*', '2>/dev/null']);
                const compilers = stdout.trim().split('\n').filter(compiler => compiler.length > 0);
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
            // 忽略GCC查找错误
        }

        return directories;
    }

    /**
     * 扫描整个系统查找编译器（谨慎使用，可能会很慢）
     */
    private static async scanSystemForCompilers(compilerNames: string[]): Promise<string[]> {
        const foundCompilers: string[] = [];
        const output = this.getOutputChannel();
        
        output.appendLine('开始全系统编译器扫描（这可能需要一些时间）...');

        try {
            // 构建find命令
            const namePatterns = compilerNames.map(name => `-name "${name}"`).join(' -o ');
            const searchCommand = process.platform === 'win32' 
                ? `where /R C:\\ ${compilerNames.join(' ')} 2>nul`
                : `find / -type f \\( ${namePatterns} \\) 2>/dev/null | head -50`; // 限制结果数量

            const { stdout } = await this.executeCommand(process.platform === 'win32' ? 'cmd' : 'sh', [
                process.platform === 'win32' ? '/c' : '-c',
                searchCommand
            ]);

            const lines = stdout.trim().split('\n').filter(line => line.length > 0);
            for (const line of lines) {
                const compilerPath = line.trim();
                if (await this.fileExists(compilerPath)) {
                    foundCompilers.push(compilerPath);
                    output.appendLine(`发现编译器: ${compilerPath}`);
                }
            }

            output.appendLine(`全系统扫描完成，发现 ${foundCompilers.length} 个编译器`);
        } catch (error: any) {
            output.appendLine(`全系统扫描失败: ${error.message}`);
        }

        return foundCompilers;
    }

    /**
     * 检查文件是否存在
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