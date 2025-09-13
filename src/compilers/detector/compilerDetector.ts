/* ---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *-------------------------------------------------------------------------------------------- */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import { CompilerInfo, CompilerDetectionResult } from '../../types';

import { ProcessRunner } from '../../process';
import { measure } from '../../utils/performance-monitor';

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
     *
     * ## Algorithm Overview
     * This is the main entry point for compiler detection. It implements a hierarchical,
     * platform-specific detection strategy with global deduplication to ensure we find
     * the best available compilers without duplicates.
     *
     * ## Complexity Analysis
     * - **Time Complexity**: O(n + m) where n is number of search paths and m is detected compilers
     *   - Platform detection: O(1)
     *   - Path scanning: O(n) where n is search paths (typically < 100)
     *   - Compiler testing: O(m) where m is found compilers (typically < 20)
     *   - Deduplication: O(m) using hash sets/maps
     *   - Sorting: O(m log m) where m is final compiler count (typically < 10)
     * - **Space Complexity**: O(m) for storing compiler info and deduplication sets
     * - **Practical Performance**: Typically completes in 100-500ms on modern systems
     *
     * ## Detection Strategy
     * 1. **Platform Detection**: Determine OS-specific detection approach
     * 2. **Hierarchical Search**: Multiple search strategies in priority order:
     *    - PATH environment scanning (highest priority)
     *    - Platform-specific locations (Xcode, MSVC, Homebrew)
     *    - Deep system scanning (if requested)
     * 3. **Global Deduplication**: Ensure only best compiler per type-version
     * 4. **Priority Sorting**: Final result sorted by calculated priority
     *
     * ## Design Decisions
     * - **Global Deduplication Sets**: Shared across platform detection to prevent
     *   cross-platform duplicates (e.g., WSL and Windows compilers)
     * - **Hierarchical Search**: Faster PATH scanning first, expensive deep scan last
     * - **Priority-based Selection**: Automatic best compiler selection without configuration
     * - **Error Resilience**: Individual failures don't stop entire detection process
     */
    public static async detectCompilers(performDeepScan: boolean = false): Promise<CompilerDetectionResult> {
        return measure('compilerDetection', async () => {
            const platform = process.platform;
            const compilers: CompilerInfo[] = [];

            this.getOutputChannel().appendLine(`[CompilerDetector] Detecting compilers for platform: ${platform}`);

            // Create global deduplication sets
            const globalCheckedRealPaths = new Set<string>();
            const globalCheckedCompilerTypes = new Map<string, { path: string; priority: number }>();

            try {
                if (platform === 'win32') {
                    const windowsCompilers = await this.detectWindowsCompilers(
                        performDeepScan,
                        globalCheckedRealPaths,
                        globalCheckedCompilerTypes
                    );
                    compilers.push(...windowsCompilers);
                } else if (platform === 'darwin') {
                    const macosCompilers = await this.detectMacOSCompilers(
                        performDeepScan,
                        globalCheckedRealPaths,
                        globalCheckedCompilerTypes
                    );
                    compilers.push(...macosCompilers);
                } else if (platform === 'linux') {
                    const linuxCompilers = await this.detectLinuxCompilers(
                        performDeepScan,
                        globalCheckedRealPaths,
                        globalCheckedCompilerTypes
                    );
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

                this.getOutputChannel().appendLine(
                    `[CompilerDetector] Found ${compilers.length} compilers after global deduplication`
                );
                return result;
            } catch (error: unknown) {
                const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
                const errorResult: CompilerDetectionResult = {
                    success: false,
                    compilers: [],
                    errors: [errorMessage],
                    suggestions: [
                        'Make sure C/C++ compilers are installed',
                        'Check that compiler directories are in PATH',
                        'Try running compiler setup command'
                    ]
                };

                this.getOutputChannel().appendLine(`[CompilerDetector] Detection failed: ${errorMessage}`);
                return errorResult;
            }
        }, { performDeepScan });
    }

    /**
     * Detect Windows compilers
     */
    private static async detectWindowsCompilers(
        performDeepScan: boolean = false,
        globalCheckedRealPaths: Set<string> = new Set(),
        globalCheckedCompilerTypes: Map<string, { path: string; priority: number }> = new Map()
    ): Promise<CompilerInfo[]> {
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
                        const compiler = await this.testCompiler(
                            compilerPath,
                            globalCheckedRealPaths,
                            globalCheckedCompilerTypes
                        );
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
                    const compiler = await this.testCompiler(
                        msvcPath,
                        globalCheckedRealPaths,
                        globalCheckedCompilerTypes
                    );
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
                    const compiler = await this.testCompiler(
                        compilerPath,
                        globalCheckedRealPaths,
                        globalCheckedCompilerTypes
                    );
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
    private static async detectMacOSCompilers(
        performDeepScan: boolean = false,
        globalCheckedRealPaths: Set<string> = new Set(),
        globalCheckedCompilerTypes: Map<string, { path: string; priority: number }> = new Map()
    ): Promise<CompilerInfo[]> {
        const compilers: CompilerInfo[] = [];
        const checked = new Set<string>();

        // Search PATH first
        const compilerNames = ['clang', 'clang++', 'gcc', 'g++'];
        const pathCompilers = await this.searchCompilersInPATH(compilerNames);

        for (const compilerPath of pathCompilers) {
            if (!checked.has(compilerPath)) {
                checked.add(compilerPath);
                const compiler = await this.testCompiler(
                    compilerPath,
                    globalCheckedRealPaths,
                    globalCheckedCompilerTypes
                );
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
                        const compiler = await this.testCompiler(
                            compilerPath,
                            globalCheckedRealPaths,
                            globalCheckedCompilerTypes
                        );
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
                            const compiler = await this.testCompiler(
                                compilerPath,
                                globalCheckedRealPaths,
                                globalCheckedCompilerTypes
                            );
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
                    const compiler = await this.testCompiler(
                        compilerPath,
                        globalCheckedRealPaths,
                        globalCheckedCompilerTypes
                    );
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
    private static async detectLinuxCompilers(
        performDeepScan: boolean = false,
        globalCheckedRealPaths: Set<string> = new Set(),
        globalCheckedCompilerTypes: Map<string, { path: string; priority: number }> = new Map()
    ): Promise<CompilerInfo[]> {
        const compilers: CompilerInfo[] = [];
        const checked = new Set<string>();

        // Search PATH first
        const compilerNames = ['clang', 'clang++', 'gcc', 'g++', 'cc', 'c++'];
        const pathCompilers = await this.searchCompilersInPATH(compilerNames);

        for (const compilerPath of pathCompilers) {
            if (!checked.has(compilerPath)) {
                checked.add(compilerPath);
                const compiler = await this.testCompiler(
                    compilerPath,
                    globalCheckedRealPaths,
                    globalCheckedCompilerTypes
                );
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
                        const compiler = await this.testCompiler(
                            compilerPath,
                            globalCheckedRealPaths,
                            globalCheckedCompilerTypes
                        );
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
                            const compiler = await this.testCompiler(
                                compilerPath,
                                globalCheckedRealPaths,
                                globalCheckedCompilerTypes
                            );
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
                    const compiler = await this.testCompiler(
                        compilerPath,
                        globalCheckedRealPaths,
                        globalCheckedCompilerTypes
                    );
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
    private static async testCompiler(
        compilerPath: string,
        checkedRealPaths: Set<string>,
        checkedCompilerTypes: Map<string, { path: string; priority: number }>
    ): Promise<CompilerInfo | null> {
        return measure('compilerTest', async () => {
            try {
                const outputChannel = this.getOutputChannel();
                outputChannel.appendLine(`[CompilerDetector] Testing compiler: ${compilerPath}`);

                // Check if file exists and is executable
                try {
                    await fs.access(compilerPath, fs.constants.F_OK | fs.constants.X_OK);
                } catch {
                    return null;
                }

                // Get the real path to avoid duplicates from symlinks
                let realPath: string;
                try {
                    realPath = await fs.realpath(compilerPath);
                } catch {
                    realPath = compilerPath;
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

                /**
                 * ## Compiler Deduplication Algorithm
                 *
                 * This sophisticated algorithm ensures optimal compiler selection while handling
                 * complex real-world scenarios:
                 *
                 * ### Core Strategy
                 * 1. **Symlink Resolution**: Use real path to detect identical binaries
                 * 2. **Type-Version Fingerprinting**: Unique key `${type}-${version}` for identification
                 * 3. **Multi-Language Support**: Allow same binary with different names (clang vs clang++)
                 *
                 * ### Algorithm Steps
                 *
                 * **Step 1**: Real Path Check
                 * - Resolve symlinks to actual binary location
                 * - Prevents duplicate entries from multiple symlink paths
                 *
                 * **Step 2**: Type-Version Uniqueness
                 * - Create fingerprint: `${compilerType}-${versionString}`
                 * - Skip if exact same compiler already registered
                 *
                 * **Step 3**: Multi-Language Compiler Handling
                 * - Allow different names for same binary (e.g., clang, clang++, clang-cpp)
                 * - Each name serves different language purposes
                 *
                 * ### Complexity Analysis
                 * - **Time Complexity**: O(n) where n = number of compiler candidates
                 * - **Space Complexity**: O(m) where m = unique compiler binaries
                 * - **Optimization**: Hash-based lookups for O(1) duplicate detection
                 *
                 * ### Edge Cases Handled
                 * - Symlinks to same binary ✓
                 * - Multi-language compilers ✓
                 * - Version conflicts ✓
                 * - Broken symlinks ✓
                 * - Permission issues ✓
                 */

                // Check if we've already processed this real path to handle symlinks
                if (checkedRealPaths.has(realPath)) {
                    // If we already have the same compiler type and version, skip this duplicate
                    // This prevents redundant entries when multiple symlinks point to the same binary
                    const currentKey = `${type}-${version}`;
                    if (checkedCompilerTypes.has(currentKey)) {
                        outputChannel.appendLine(
                            `[CompilerDetector] Skipping duplicate compiler: ${compilerPath} (${type}) -> ${realPath}`
                        );
                        return null;
                    }

                    // Allow different compiler names with same realpath (like clang vs clang++)
                    // This is valid because a single compiler binary can serve multiple languages
                    outputChannel.appendLine(
                        `[CompilerDetector] Allowing additional compiler: ${compilerPath} (${type}) -> ${realPath}`
                    );
                }
                checkedRealPaths.add(realPath);

                // Create a unique key for this compiler type and version
                // This key is used to identify functionally equivalent compilers
                const compilerKey = `${type}-${version}`;

                // Calculate priority for this compiler using our weighted scoring system
                const priority = this.calculatePriority(type, version, compilerPath);

                // Priority-based deduplication: Keep only the highest priority compiler
                // for each unique type-version combination. This ensures users get the best
                // available compiler automatically without manual configuration.
                if (checkedCompilerTypes.has(compilerKey)) {
                    const existing = checkedCompilerTypes.get(compilerKey)!;
                    if (priority <= existing.priority) {
                    // Skip lower priority compiler - we already have a better one
                        outputChannel.appendLine(
                            `[CompilerDetector] Skipping lower priority compiler: ${compilerPath} ` +
                            `(priority: ${priority}, existing: ${existing.path} with priority: ${existing.priority})`
                        );
                        return null;
                    } else {
                    // Replace the existing one with this higher priority compiler
                    // This ensures we always use the best available compiler for each type-version combination
                        outputChannel.appendLine(
                            `[CompilerDetector] Replacing lower priority compiler: ${existing.path} with ` +
                            `${compilerPath} (priority: ${priority} > ${existing.priority})`
                        );

                        // Remove the old compiler from our real paths tracking to prevent conflicts
                        // This is critical for maintaining accurate deduplication state
                        try {
                        // Try to get the real path of the old compiler for proper cleanup
                            const oldRealPath = await fs.realpath(existing.path);
                            checkedRealPaths.delete(oldRealPath);
                        } catch {
                        // If realpath fails (e.g., file doesn't exist or permissions issue),
                        // fall back to using the original path. This ensures we don't leave
                        // orphaned entries in our tracking set.
                            checkedRealPaths.delete(existing.path);
                        }
                    }
                }
                checkedCompilerTypes.set(compilerKey, { path: compilerPath, priority });

                const supportedStandards = this.getSupportedStandards(type, version);
                const is64Bit = await this.is64BitCompiler(compilerPath);
                const name = this.generateCompilerName(type, version);

                const compilerInfo: CompilerInfo = {
                    path: compilerPath,
                    name,
                    type,
                    version,
                    supportedStandards,
                    is64Bit,
                    priority,
                    capabilities: {
                        optimize: true,
                        debug: true,
                        sanitize: true,
                        parallel: true
                    }
                };

                outputChannel.appendLine(
                    `[CompilerDetector] Found compiler: ${name} (${type} ${version}) at ${compilerPath} ` +
                    `(real: ${realPath}, priority: ${priority})`
                );

                // Add debug info for C vs C++ compilers
                if (type === 'clang' || type === 'gcc') {
                    outputChannel.appendLine(`[CompilerDetector] *** C COMPILER DETECTED: ${name} ***`);
                } else if (type === 'clang++' || type === 'g++') {
                    outputChannel.appendLine(`[CompilerDetector] *** C++ COMPILER DETECTED: ${name} ***`);
                }
                return compilerInfo;
            } catch (error) {
                this.getOutputChannel().appendLine(
                    `[CompilerDetector] Failed to test compiler ${compilerPath}: ${error}`
                );
                return null;
            }
        }, { compilerPath });
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

        if (filename.includes('g++') || filename === 'c++') {
            return 'g++';
        }

        if (filename.includes('gcc') || filename.includes('cc')) {
            return 'gcc';
        }

        // Fallback: check version output
        if (versionOutput.includes('clang')) {
            return versionOutput.includes('Apple') ? 'apple-clang' : 'clang';
        }

        if (
            versionOutput.includes('GCC') ||
            versionOutput.includes('gcc') ||
            versionOutput.includes('Ubuntu') ||
            versionOutput.includes('Copyright (C)')
        ) {
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
        const majorVersion = parseInt(version.split('.')[0]);

        if (type.includes('clang')) {
            // Covers clang, clang++, apple-clang
            if (majorVersion >= 9) {
                cppStandards.push('c++20');
            }
            if (majorVersion >= 17) {
                cppStandards.push('c++23');
            }
        } else if (type.includes('gcc')) {
            // Covers gcc, g++
            if (majorVersion >= 11) {
                cppStandards.push('c++20');
            }
            if (majorVersion >= 13) {
                cppStandards.push('c++23');
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
     *
     * ## Algorithm Overview
     * This algorithm implements a weighted scoring system to select the optimal compiler
     * when multiple compilers of the same type and version are available. The selection
     * is based on multiple factors including compiler family, version recency, and installation location.
     *
     * ## Complexity Analysis
     * - **Time Complexity**: O(1) - Constant time operation
     * - **Space Complexity**: O(1) - No additional space allocation
     * - **Cache Efficiency**: Excellent - all operations are in-memory
     *
     * ## Scoring Algorithm
     *
     * ### Base Type Priority (0-100 points)
     * - Clang/Clang++: 100 points (best standards compliance, diagnostics)
     * - Apple Clang: 90 points (excellent but potentially delayed updates)
     * - GCC/G++: 80 points (reliable, widely used)
     * - MSVC: 70 points (Windows-specific, good but less portable)
     *
     * ### Version Bonus (0-90+ points)
     * - Formula: `major_version * 10`
     * - Rationale: Newer versions have better optimizations, standards support, and bug fixes
     * - Example: Clang 19 gets 190 points total (100 + 19*10)
     *
     * ### Location Penalty (-20 points)
     * - Applied to system-wide compilers in /usr/bin or C:\Windows
     * - Rationale: User-installed compilers are typically more up-to-date and configurable
     * - Prevents preferring outdated system compilers over newer user installations
     *
     * ## Design Decisions
     *
     * ### Why Weighted Scoring?
     * - **Flexibility**: Easy to adjust individual factors without affecting overall logic
     * - **Transparency**: Clear reasoning for compiler selection
     * - **Extensibility**: Simple to add new criteria (e.g., compilation speed, features)
     *
     * ### Why Prioritize Clang?
     * - **Better Error Messages**: More helpful diagnostics for OI contestants
     * - **Standards Compliance**: Better C++11/14/17 support
     * - **Performance**: Often generates faster code
     * - **Cross-Platform**: Consistent behavior across OSes
     *
     * ### Version Number Handling
     * - Uses major version only for simplicity and stability
     * - Ignores minor/patch versions to avoid频繁切换
     * - Assumes major versions represent significant improvements
     *
     * ## Example Scenarios
     *
     * Scenario 1: Clang 18.1.0 vs GCC 13.2.0
     * - Clang: 100 + 18*10 = 280
     * - GCC: 80 + 13*10 = 210
     * - Winner: Clang (better type + newer version)
     *
     * Scenario 2: System Clang 16.0.0 vs User Clang 16.0.0
     * - System: 100 + 16*10 - 20 = 240
     * - User: 100 + 16*10 = 260
     * - Winner: User installation (location preference)
     *
     * @param type - Compiler type identifier (clang, gcc, msvc, etc.)
     * @param version - Compiler version string (e.g., "19.1.1")
     * @param path - Compiler installation path
     * @returns Priority score (higher values indicate preferred compilers)
     *
     * @see CompilerInfo for the structure that uses this priority
     * @see detectCompilers for the overall detection process
     */
    private static calculatePriority(type: string, version: string, path: string): number {
        let priority = 0;

        // Type-based priority: Clang-family compilers get highest priority
        // due to better standards compliance and error messages
        const typePriority: { [key: string]: number } = {
            clang: 100, // Modern Clang - highest priority
            'clang++': 100, // Clang C++ - same priority
            'apple-clang': 90, // Apple's Clang - slightly lower due to potential delays
            gcc: 80, // GCC - reliable but sometimes slower
            'g++': 80, // GCC C++ - same priority
            msvc: 70 // MSVC - lowest priority, Windows-specific
        };

        priority += typePriority[type] || 0;

        // Version-based priority: Newer versions get significant bonus
        // This ensures users get the latest features and bug fixes
        // Major version number * 10 means v19 >> v18 by 10 points
        const versionMatch = version.match(/(\d+)/);
        if (versionMatch) {
            priority += parseInt(versionMatch[1]) * 10;
        }

        // Path-based priority: System compilers get lower priority
        // This prefers user-installed compilers over system ones
        // System compilers might be outdated or have restricted functionality
        if (path.includes('/usr/bin') || path.includes('C:\\Windows')) {
            priority -= 20;
        }

        return priority;
    }

    /**
     * Generate compiler name
     */
    private static generateCompilerName(type: string, version: string): string {
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
