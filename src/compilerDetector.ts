/* ---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *-------------------------------------------------------------------------------------------- */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import { CompilerInfo, CompilerDetectionResult } from './types';

import { ProcessRunner } from './processRunner';

/**
 * Handles cross-platform compiler detection
 */
export class CompilerDetector {
    private static outputChannel: vscode.OutputChannel | null = null;

    /**
     * Get or create output channel
     */
    public static getOutputChannel(): vscode.OutputChannel {
        if (!this.outputChannel) {
            this.outputChannel = vscode.window.createOutputChannel('OI-Code Compiler Detector');
        }
        return this.outputChannel;
    }

    /**
     * Detect compilers based on platform
     */
    public static async detectCompilers(performDeepScan: boolean = false): Promise<CompilerDetectionResult> {
        const platform = process.platform;
        const compilers: CompilerInfo[] = [];

        this.getOutputChannel().appendLine(`[CompilerDetector] Detecting compilers for platform: ${platform}`);

        try {
            if (platform === 'win32') {
                const windowsCompilers = await this.detectWindowsCompilers(performDeepScan);
                compilers.push(...windowsCompilers);
            } else if (platform === 'darwin') {
                const macosCompilers = await this.detectMacOSCompilers(performDeepScan);
                compilers.push(...macosCompilers);
            } else if (platform === 'linux') {
                const linuxCompilers = await this.detectLinuxCompilers(performDeepScan);
                compilers.push(...linuxCompilers);
            }

            // Sort by priority
            compilers.sort((a, b) => b.priority - a.priority);

            const result: CompilerDetectionResult = {
                success: true,
                compilers,
                recommended: compilers.length > 0 ? compilers[0] : undefined,
                suggestions: this.generateSuggestions(compilers)
            };

            this.getOutputChannel().appendLine(`[CompilerDetector] Found ${compilers.length} compilers`);
            return result;
        } catch (error: any) {
            const errorResult: CompilerDetectionResult = {
                success: false,
                compilers: [],
                error: error.message,
                suggestions: [
                    'Make sure C/C++ compilers are installed',
                    'Check that compiler directories are in PATH',
                    'Try running compiler setup command'
                ]
            };

            this.getOutputChannel().appendLine(`[CompilerDetector] Detection failed: ${error.message}`);
            return errorResult;
        }
    }

    /**
     * Detect Windows compilers
     */
    private static async detectWindowsCompilers(performDeepScan: boolean = false): Promise<CompilerInfo[]> {
        const compilers: CompilerInfo[] = [];
        const checked = new Set<string>();

        // Search for common Windows compilers
        const searchPaths = [
            ...(process.env.PATH ? process.env.PATH.split(path.delimiter) : []),
            process.env['ProgramFiles'] || '',
            process.env['ProgramFiles(x86)'] || '',
            'C:\\LLVM\\bin',
            'C:\\MinGW\\bin',
            'C:\\msys64\\mingw64\\bin',
            'C:\\msys64\\ucrt64\\bin',
            'C:\\msys64\\clang64\\bin'
        ].filter(Boolean);

        const compilerNames = ['clang.exe', 'clang++.exe', 'gcc.exe', 'g++.exe'];

        for (const searchPath of searchPaths) {
            if (await ProcessRunner.fileExists(searchPath)) {
                const foundCompilers = await this.searchCompilersInDirectory(searchPath, compilerNames);
                for (const compilerPath of foundCompilers) {
                    if (!checked.has(compilerPath)) {
                        checked.add(compilerPath);
                        const compiler = await this.testCompiler(compilerPath);
                        if (compiler) {
                            compilers.push(compiler);
                        }
                    }
                }
            }
        }

        // Look for MSVC compilers
        try {
            const msvcPaths = await this.findMSVCCompilers();
            for (const msvcPath of msvcPaths) {
                if (!checked.has(msvcPath)) {
                    checked.add(msvcPath);
                    const compiler = await this.testCompiler(msvcPath);
                    if (compiler) {
                        compilers.push(compiler);
                    }
                }
            }
        } catch (error) {
            this.getOutputChannel().appendLine(`[CompilerDetector] MSVC detection failed: ${error}`);
        }

        // Deep scan if requested
        if (performDeepScan) {
            const deepScanCompilers = await this.scanSystemForCompilers(compilerNames);
            for (const compilerPath of deepScanCompilers) {
                if (!checked.has(compilerPath)) {
                    checked.add(compilerPath);
                    const compiler = await this.testCompiler(compilerPath);
                    if (compiler) {
                        compilers.push(compiler);
                    }
                }
            }
        }

        return compilers;
    }

    /**
     * Detect macOS compilers
     */
    private static async detectMacOSCompilers(performDeepScan: boolean = false): Promise<CompilerInfo[]> {
        const compilers: CompilerInfo[] = [];
        const checked = new Set<string>();

        // Search PATH first
        const compilerNames = ['clang', 'clang++', 'gcc', 'g++'];
        const pathCompilers = await this.searchCompilersInPATH(compilerNames);

        for (const compilerPath of pathCompilers) {
            if (!checked.has(compilerPath)) {
                checked.add(compilerPath);
                const compiler = await this.testCompiler(compilerPath);
                if (compiler) {
                    compilers.push(compiler);
                }
            }
        }

        // Look for Xcode compilers
        try {
            const xcodePaths = await this.findXcodeCompilerDirectories();
            for (const xcodePath of xcodePaths) {
                const foundCompilers = await this.searchCompilersInDirectory(xcodePath, compilerNames);
                for (const compilerPath of foundCompilers) {
                    if (!checked.has(compilerPath)) {
                        checked.add(compilerPath);
                        const compiler = await this.testCompiler(compilerPath);
                        if (compiler) {
                            compilers.push(compiler);
                        }
                    }
                }
            }
        } catch (error) {
            this.getOutputChannel().appendLine(`[CompilerDetector] Xcode detection failed: ${error}`);
        }

        // Look for Homebrew installations
        try {
            const homebrewPaths = ['/usr/local/bin', '/opt/homebrew/bin', '/opt/local/bin'];

            for (const brewPath of homebrewPaths) {
                if (await ProcessRunner.fileExists(brewPath)) {
                    const foundCompilers = await this.searchCompilersInDirectory(brewPath, compilerNames);
                    for (const compilerPath of foundCompilers) {
                        if (!checked.has(compilerPath)) {
                            checked.add(compilerPath);
                            const compiler = await this.testCompiler(compilerPath);
                            if (compiler) {
                                compilers.push(compiler);
                            }
                        }
                    }
                }
            }
        } catch (error) {
            this.getOutputChannel().appendLine(`[CompilerDetector] Homebrew detection failed: ${error}`);
        }

        // Deep scan if requested
        if (performDeepScan) {
            const deepScanCompilers = await this.scanSystemForCompilers(compilerNames);
            for (const compilerPath of deepScanCompilers) {
                if (!checked.has(compilerPath)) {
                    checked.add(compilerPath);
                    const compiler = await this.testCompiler(compilerPath);
                    if (compiler) {
                        compilers.push(compiler);
                    }
                }
            }
        }

        return compilers;
    }

    /**
     * Detect Linux compilers
     */
    private static async detectLinuxCompilers(performDeepScan: boolean = false): Promise<CompilerInfo[]> {
        const compilers: CompilerInfo[] = [];
        const checked = new Set<string>();

        // Search PATH first
        const compilerNames = ['clang', 'clang++', 'gcc', 'g++', 'cc', 'c++'];
        const pathCompilers = await this.searchCompilersInPATH(compilerNames);

        for (const compilerPath of pathCompilers) {
            if (!checked.has(compilerPath)) {
                checked.add(compilerPath);
                const compiler = await this.testCompiler(compilerPath);
                if (compiler) {
                    compilers.push(compiler);
                }
            }
        }

        // Look for common Linux compiler paths
        const commonPaths = ['/usr/bin', '/usr/local/bin', '/opt/bin', '/opt/local/bin', '/bin'];

        for (const searchPath of commonPaths) {
            if (await ProcessRunner.fileExists(searchPath)) {
                const foundCompilers = await this.searchCompilersInDirectory(searchPath, compilerNames);
                for (const compilerPath of foundCompilers) {
                    if (!checked.has(compilerPath)) {
                        checked.add(compilerPath);
                        const compiler = await this.testCompiler(compilerPath);
                        if (compiler) {
                            compilers.push(compiler);
                        }
                    }
                }
            }
        }

        // Look for version-specific installations
        try {
            const versionPaths = await this.findLLVMVersionInstallations();
            const gccPaths = await this.findGCCVersionInstallations();

            for (const versionPath of [...versionPaths, ...gccPaths]) {
                if (await ProcessRunner.fileExists(versionPath)) {
                    const foundCompilers = await this.searchCompilersInDirectory(versionPath, compilerNames);
                    for (const compilerPath of foundCompilers) {
                        if (!checked.has(compilerPath)) {
                            checked.add(compilerPath);
                            const compiler = await this.testCompiler(compilerPath);
                            if (compiler) {
                                compilers.push(compiler);
                            }
                        }
                    }
                }
            }
        } catch (error) {
            this.getOutputChannel().appendLine(`[CompilerDetector] Version-specific detection failed: ${error}`);
        }

        // Deep scan if requested
        if (performDeepScan) {
            const deepScanCompilers = await this.scanSystemForCompilers(compilerNames);
            for (const compilerPath of deepScanCompilers) {
                if (!checked.has(compilerPath)) {
                    checked.add(compilerPath);
                    const compiler = await this.testCompiler(compilerPath);
                    if (compiler) {
                        compilers.push(compiler);
                    }
                }
            }
        }

        return compilers;
    }

    /**
     * Test a specific compiler
     */
    private static async testCompiler(compilerPath: string): Promise<CompilerInfo | null> {
        try {
            const outputChannel = this.getOutputChannel();
            outputChannel.appendLine(`[CompilerDetector] Testing compiler: ${compilerPath}`);

            // Check if file exists and is executable
            try {
                await fs.access(compilerPath, fs.constants.F_OK | fs.constants.X_OK);
            } catch {
                return null;
            }

            // Get version information
            const result = await ProcessRunner.executeCommand(compilerPath, ['--version']);
            const versionOutput = result.stdout || result.stderr;

            if (!versionOutput) {
                return null;
            }

            // Determine compiler type
            const type = this.determineCompilerType(compilerPath, versionOutput);
            const version = this.parseVersion(versionOutput);
            const supportedStandards = this.getSupportedStandards(type, version);
            const is64Bit = await this.is64BitCompiler(compilerPath);
            const priority = this.calculatePriority(type, version, compilerPath);
            const name = this.generateCompilerName(type, version, compilerPath);

            const compilerInfo: CompilerInfo = {
                path: compilerPath,
                name,
                type,
                version,
                supportedStandards,
                is64Bit,
                priority
            };

            outputChannel.appendLine(`[CompilerDetector] Found compiler: ${name} (${type} ${version})`);
            return compilerInfo;
        } catch (error) {
            this.getOutputChannel().appendLine(`[CompilerDetector] Failed to test compiler ${compilerPath}: ${error}`);
            return null;
        }
    }

    /**
     * Search for compilers in PATH
     */
    private static async searchCompilersInPATH(compilerNames: string[]): Promise<string[]> {
        const foundCompilers: string[] = [];
        const pathEnv = process.env.PATH || '';
        const paths = pathEnv.split(path.delimiter);

        for (const compilerName of compilerNames) {
            for (const searchPath of paths) {
                const compilerPath = path.join(searchPath, compilerName);
                if (await ProcessRunner.fileExists(compilerPath)) {
                    foundCompilers.push(compilerPath);
                }
            }
        }

        return foundCompilers;
    }

    /**
     * Search for compilers in a specific directory
     */
    private static async searchCompilersInDirectory(directory: string, compilerNames: string[]): Promise<string[]> {
        const foundCompilers: string[] = [];

        try {
            const files = await fs.readdir(directory);
            for (const file of files) {
                if (compilerNames.includes(file)) {
                    const fullPath = path.join(directory, file);
                    if (await ProcessRunner.fileExists(fullPath)) {
                        foundCompilers.push(fullPath);
                    }
                }
            }
        } catch (error) {
            // Directory might not exist or be accessible
        }

        return foundCompilers;
    }

    /**
     * Find MSVC compilers using vswhere
     */
    private static async findMSVCCompilers(): Promise<string[]> {
        const compilers: string[] = [];

        try {
            const vswherePath = path.join(
                process.env['ProgramFiles(x86)'] || '',
                'Microsoft Visual Studio',
                'Installer',
                'vswhere.exe'
            );

            if (!(await ProcessRunner.fileExists(vswherePath))) {
                return compilers;
            }

            const result = await ProcessRunner.executeCommand(vswherePath, [
                '-latest',
                '-products',
                '*',
                '-requires',
                'Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
                '-property',
                'installationPath'
            ]);

            const installPath = result.stdout.trim();
            if (installPath) {
                const msvcPaths = [
                    path.join(installPath, 'VC', 'Tools', 'MSVC'),
                    path.join(installPath, 'VC', 'Auxiliary', 'Build')
                ];

                for (const msvcPath of msvcPaths) {
                    if (await ProcessRunner.fileExists(msvcPath)) {
                        // Look for cl.exe in subdirectories
                        const clPath = path.join(msvcPath, 'bin', 'Hostx64', 'x64', 'cl.exe');
                        if (await ProcessRunner.fileExists(clPath)) {
                            compilers.push(clPath);
                        }
                    }
                }
            }
        } catch (error) {
            this.getOutputChannel().appendLine(`[CompilerDetector] vswhere execution failed: ${error}`);
        }

        return compilers;
    }

    /**
     * Find Xcode compiler directories
     */
    private static async findXcodeCompilerDirectories(): Promise<string[]> {
        const directories: string[] = [];

        try {
            // Look for Xcode command line tools
            const result = await ProcessRunner.executeCommand('xcode-select', ['-p']);
            const xcodePath = result.stdout.trim();

            if (xcodePath && (await ProcessRunner.fileExists(xcodePath))) {
                directories.push(
                    path.join(xcodePath, 'Toolchains', 'XcodeDefault.xctoolchain', 'usr', 'bin'),
                    path.join(xcodePath, 'usr', 'bin')
                );
            }

            // Look for Xcode installations
            const xcodeApplications = ['/Applications/Xcode.app', '/Applications/Xcode-beta.app'];

            for (const xcodeApp of xcodeApplications) {
                if (await ProcessRunner.fileExists(xcodeApp)) {
                    directories.push(
                        path.join(
                            xcodeApp,
                            'Contents',
                            'Developer',
                            'Toolchains',
                            'XcodeDefault.xctoolchain',
                            'usr',
                            'bin'
                        ),
                        path.join(xcodeApp, 'Contents', 'Developer', 'usr', 'bin')
                    );
                }
            }
        } catch (error) {
            // xcode-select might not be available
        }

        return directories;
    }

    /**
     * Find LLVM version installations
     */
    private static async findLLVMVersionInstallations(): Promise<string[]> {
        const directories: string[] = [];

        try {
            // Look for version-specific LLVM installations
            const commonPrefixes = ['/usr/lib/llvm-', '/opt/llvm-', '/usr/local/llvm-'];

            for (const prefix of commonPrefixes) {
                const parentDir = path.dirname(prefix);
                if (await ProcessRunner.fileExists(parentDir)) {
                    const files = await fs.readdir(parentDir);
                    for (const file of files) {
                        if (file.startsWith('llvm-')) {
                            const versionPath = path.join(parentDir, file, 'bin');
                            if (await ProcessRunner.fileExists(versionPath)) {
                                directories.push(versionPath);
                            }
                        }
                    }
                }
            }
        } catch (error) {
            // Ignore errors
        }

        return directories;
    }

    /**
     * Find GCC version installations
     */
    private static async findGCCVersionInstallations(): Promise<string[]> {
        const directories: string[] = [];

        try {
            // Look for version-specific GCC installations
            const gccPatterns = ['/usr/bin/gcc-*', '/usr/bin/g++-*', '/usr/local/bin/gcc-*', '/usr/local/bin/g++-*'];

            for (const pattern of gccPatterns) {
                const searchDir = path.dirname(pattern);
                const baseName = path.basename(pattern);
                const result = await ProcessRunner.executeCommand('find', [searchDir, '-name', baseName]);
                const lines = result.stdout.split('\n').filter(line => line.trim());
                directories.push(...lines.map(line => path.dirname(line)));
            }
        } catch (error) {
            // Ignore errors
        }

        return directories;
    }

    /**
     * Deep scan system for compilers
     */
    private static async scanSystemForCompilers(compilerNames: string[]): Promise<string[]> {
        const foundCompilers: string[] = [];
        const outputChannel = this.getOutputChannel();

        outputChannel.appendLine('[CompilerDetector] Performing deep system scan for compilers...');

        // Search common installation directories
        const searchDirectories = [
            '/usr',
            '/usr/local',
            '/opt',
            '/home',
            'C:\\',
            'C:\\Program Files',
            'C:\\Program Files (x86)'
        ];

        for (const searchDir of searchDirectories) {
            if (await ProcessRunner.fileExists(searchDir)) {
                try {
                    let result;
                    if (process.platform === 'win32') {
                        // Using 'where' on Windows. Note: This can be slow on large drives.
                        result = await ProcessRunner.executeCommand('where', ['/r', searchDir, compilerNames[0]]);
                    } else {
                        result = await ProcessRunner.executeCommand('find', [searchDir, '-name', compilerNames[0]]);
                    }
                    const lines = result.stdout.split('\n').filter(line => line.trim());
                    foundCompilers.push(...lines);
                } catch (error) {
                    // Skip directories that can't be searched
                }
            }
        }

        return foundCompilers;
    }

    /**
     * Determine compiler type from path and version output
     */
    private static determineCompilerType(
        compilerPath: string,
        versionOutput: string
    ): 'clang' | 'clang++' | 'gcc' | 'g++' | 'msvc' | 'apple-clang' {
        const filename = path.basename(compilerPath).toLowerCase();

        if (filename.includes('cl.exe')) {
            return 'msvc';
        }

        if (filename.includes('clang++')) {
            return 'clang++';
        }

        if (filename.includes('clang')) {
            if (versionOutput.includes('Apple')) {
                return 'apple-clang';
            }
            return 'clang';
        }

        if (filename.includes('g++')) {
            return 'g++';
        }

        if (filename.includes('gcc') || filename.includes('cc')) {
            return 'gcc';
        }

        // Fallback: check version output
        if (versionOutput.includes('clang')) {
            return versionOutput.includes('Apple') ? 'apple-clang' : 'clang';
        }

        if (versionOutput.includes('GCC') || versionOutput.includes('gcc')) {
            return filename.includes('++') ? 'g++' : 'gcc';
        }

        return 'clang'; // Default fallback
    }

    /**
     * Parse version from version output
     */
    private static parseVersion(versionOutput: string): string {
        const patterns = [/(\d+\.\d+\.\d+)/, /version (\d+\.\d+\.\d+)/, /(\d+\.\d+)/, /version (\d+\.\d+)/];

        for (const pattern of patterns) {
            const match = versionOutput.match(pattern);
            if (match) {
                return match[1];
            }
        }

        return 'unknown';
    }

    /**
     * Get supported standards for compiler type and version
     */
    private static getSupportedStandards(type: string, version: string): string[] {
        const standards = ['c89', 'c99', 'c11', 'c17'];
        const cppStandards = ['c++98', 'c++11', 'c++14', 'c++17'];

        if (type === 'clang' || type === 'apple-clang') {
            const majorVersion = parseInt(version.split('.')[0]);
            if (majorVersion >= 9) {
                cppStandards.push('c++20');
            }
        } else if (type === 'gcc') {
            const majorVersion = parseInt(version.split('.')[0]);
            if (majorVersion >= 11) {
                cppStandards.push('c++20');
            }
        }

        return type.includes('++') ? cppStandards : standards;
    }

    /**
     * Check if compiler is 64-bit
     */
    private static async is64BitCompiler(compilerPath: string): Promise<boolean> {
        try {
            const { stdout } = await ProcessRunner.executeCommand(compilerPath, ['-dumpmachine']);
            return stdout.includes('64') || stdout.includes('x86_64') || stdout.includes('amd64');
        } catch {
            return true; // Assume 64-bit if we can't determine
        }
    }

    /**
     * Calculate priority for compiler selection
     */
    private static calculatePriority(type: string, version: string, _path: string): number {
        let priority = 0;

        // Type-based priority
        const typePriority: { [key: string]: number } = {
            clang: 100,
            'clang++': 100,
            'apple-clang': 90,
            gcc: 80,
            'g++': 80,
            msvc: 70
        };

        priority += typePriority[type] || 0;

        // Version-based priority (newer versions get higher priority)
        const versionMatch = version.match(/(\d+)/);
        if (versionMatch) {
            priority += parseInt(versionMatch[1]) * 10;
        }

        // Path-based priority (system paths get lower priority)
        if (_path.includes('/usr/bin') || _path.includes('C:\\Windows')) {
            priority -= 20;
        }

        return priority;
    }

    /**
     * Generate compiler name
     */
    private static generateCompilerName(type: string, version: string, _path: string): string {
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
        return `${baseName}${versionStr}`;
    }

    /**
     * Generate suggestions based on detected compilers
     */
    private static generateSuggestions(compilers: CompilerInfo[]): string[] {
        const suggestions: string[] = [];

        if (compilers.length === 0) {
            suggestions.push('Install a C/C++ compiler (LLVM, GCC, or MSVC)');
            suggestions.push('Ensure compiler directories are in PATH');
            suggestions.push('Run the compiler setup command for automatic installation');
        } else if (compilers.every(c => c.type === 'msvc')) {
            suggestions.push('Consider installing LLVM/Clang for better cross-platform compatibility');
        } else if (compilers.every(c => c.type === 'gcc')) {
            suggestions.push('Consider installing Clang for better standards compliance');
        }

        return suggestions;
    }
}
