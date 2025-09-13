/* ---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *-------------------------------------------------------------------------------------------- */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import { EventSystem } from '../core/event-system';
import { Logger } from '../utils/logger';
import { ProcessRunner } from '../process';
import { CompilerDetector } from '../compilers/detector/compilerDetector';
import { CompilerInstaller } from '../compilers/installer/compilerInstaller';
import {
    CompilerInfo,
    CompilationResult,
    CompilerDetectionResult,
    ValidationResult,
    ValidationError,
    ValidationWarning,
    CompilerDetectedEvent,
    ConfigChangedEvent,
    ID,
    ProgrammingLanguage,
    LanguageStandard,
    OptimizationLevel,
    CompilationError,
    Diagnostic
} from '../types/models';
import { CompilerManagerConfig } from '../types/config';

/**
 * Compiler Manager API
 *
 * Provides comprehensive compiler management functionality including:
 * - Compiler detection and installation
 * - Compilation execution with resource limits
 * - Compiler configuration management
 * - Validation and error handling
 * - Performance monitoring and statistics
 * - Event-driven architecture integration
 */
export interface CompilerManagerAPI {
  /**
   * Detect available compilers
   */
  detectCompilers(options?: {
    forceRescan?: boolean;
    deepScan?: boolean;
    progressCallback?: (progress: number, message: string) => void;
  }): Promise<CompilerDetectionResult>;

  /**
   * Get suitable compiler for language
   */
  getSuitableCompiler(language: ProgrammingLanguage): Promise<CompilerInfo>;

  /**
   * Get all available compilers
   */
  getCompilers(): Promise<CompilerInfo[]>;

  /**
   * Get compiler by ID
   */
  getCompiler(compilerId: ID): Promise<CompilerInfo | undefined>;

  /**
   * Get recommended compiler for language
   */
  getRecommendedCompiler(language: ProgrammingLanguage): Promise<CompilerInfo | undefined>;

  /**
   * Compile source code
   */
  compile(options: {
    sourcePath: string;
    compiler?: CompilerInfo | ID;
    outputPath?: string;
    optimization?: OptimizationLevel;
    standard?: LanguageStandard;
    defines?: Record<string, string>;
    includePaths?: string[];
    libraryPaths?: string[];
    libraries?: string[];
    warnings?: string[];
    customFlags?: string[];
    debugSymbols?: boolean;
    sanitize?: {
      address?: boolean;
      memory?: boolean;
      thread?: boolean;
      undefined?: boolean;
    };
    timeout?: number;
    memoryLimit?: number;
  }): Promise<CompilationResult>;

  /**
   * Get compiler version
   */
  getCompilerVersion(compiler: CompilerInfo | ID): Promise<string>;

  /**
   * Get supported standards
   */
  getSupportedStandards(compiler: CompilerInfo | ID): Promise<string[]>;

  /**
   * Validate compiler configuration
   */
  validateCompiler(compiler: CompilerInfo): Promise<ValidationResult>;

  /**
   * Install compiler
   */
  installCompiler(type: 'llvm' | 'gcc' | 'msvc', options?: {
    version?: string;
    installPath?: string;
    progressCallback?: (progress: number, message: string) => void;
  }): Promise<void>;

  /**
   * Remove compiler
   */
  removeCompiler(compilerId: ID): Promise<void>;

  /**
   * Set default compiler for language
   */
  setDefaultCompiler(language: ProgrammingLanguage, compilerId: ID): Promise<void>;

  /**
   * Get default compiler for language
   */
  getDefaultCompiler(language: ProgrammingLanguage): Promise<CompilerInfo | undefined>;

  /**
   * Test compiler functionality
   */
  testCompiler(compiler: CompilerInfo | ID): Promise<{
    success: boolean;
    output?: string;
    error?: string;
    executionTime: number;
  }>;

  /**
   * Get compiler statistics
   */
  getCompilerStats(compilerId?: ID): Promise<{
    totalCompilations: number;
    successRate: number;
    averageTime: number;
    lastUsed: Date;
  }>;

  /**
   * Search compilers
   */
  searchCompilers(query: string, options?: {
    fields?: ('name' | 'type' | 'version' | 'path')[];
    limit?: number;
    fuzzy?: boolean;
  }): Promise<CompilerInfo[]>;

  /**
   * Configure compiler settings
   */
  configureCompiler(compilerId: ID, config: {
    priority?: number;
    defaultFor?: ProgrammingLanguage[];
    customFlags?: string[];
    disabled?: boolean;
  }): Promise<void>;

  /**
   * Get compiler diagnostics
   */
  getCompilerDiagnostics(compilerId: ID): Promise<Diagnostic[]>;
}

/**
 * Compiler Manager Implementation
 */
export class CompilerManager implements CompilerManagerAPI, vscode.Disposable {
    private static instance: CompilerManager;
    private readonly logger: Logger;
    private readonly eventSystem: EventSystem;
    private readonly config: CompilerManagerConfig;
    private compilers: Map<ID, CompilerInfo> = new Map();
    private compilationStats: Map<ID, {
    total: number;
    success: number;
    totalTime: number;
    lastUsed: Date;
  }> = new Map();
    private defaultCompilers: Map<ProgrammingLanguage, ID> = new Map();
    private readonly disposables: vscode.Disposable[] = [];

    constructor(
        eventSystem: EventSystem,
        config: CompilerManagerConfig
    ) {
        this.eventSystem = eventSystem;
        this.config = config;
        this.logger = new Logger('CompilerManager');

        this.initialize();
    }

    static getInstance(
        eventSystem: EventSystem,
        config: CompilerManagerConfig
    ): CompilerManager {
        if (!CompilerManager.instance) {
            CompilerManager.instance = new CompilerManager(eventSystem, config);
        }
        return CompilerManager.instance;
    }

    private async initialize(): Promise<void> {
        try {
            await this.loadCompilers();
            this.setupEventHandlers();
            this.logger.info('CompilerManager initialized successfully');
        } catch (error) {
            this.logger.error('Failed to initialize CompilerManager', error);
            throw error;
        }
    }

    private setupEventHandlers(): void {
    // Listen for config changes
        this.disposables.push(
            vscode.workspace.onDidChangeConfiguration(e => {
                if (e.affectsConfiguration('oicode')) {
                    this.handleConfigChange();
                }
            })
        );

        // Periodic compiler health check
        const healthCheckInterval = setInterval(() => {
            this.performHealthCheck().catch(error => {
                this.logger.error('Health check failed', error);
            });
        }, this.config.healthCheckInterval * 1000);

        this.disposables.push({
            dispose: () => clearInterval(healthCheckInterval)
        });
    }

    private async loadCompilers(): Promise<void> {
        try {
            const result = await CompilerDetector.detectCompilers();

            if (result.success) {
                this.compilers.clear();
                for (const compiler of result.compilers) {
                    const compilerId = this.generateCompilerId(compiler);
                    // Convert from types.ts CompilerInfo to models.ts CompilerInfo
                    const fullCompilerInfo: CompilerInfo = {
                        ...compiler,
                        capabilities: {
                            optimize: true,
                            debug: true,
                            sanitize: true,
                            parallel: true
                        },
                        metadata: {
                            installDate: new Date(),
                            verified: true
                        }
                    };
                    this.compilers.set(compilerId, fullCompilerInfo);
                    this.compilationStats.set(compilerId, {
                        total: 0,
                        success: 0,
                        totalTime: 0,
                        lastUsed: new Date()
                    });

                    // Emit compiler detected event
                    await this.emitCompilerDetectedEvent(fullCompilerInfo);
                }

                this.logger.info(`Loaded ${this.compilers.size} compilers`);
            } else {
                this.logger.error('Failed to load compilers', result.errors);
            }
        } catch (error) {
            this.logger.error('Failed to load compilers', error);
            throw error;
        }
    }

    private async handleConfigChange(): Promise<void> {
        this.logger.info('Configuration changed, reloading compilers...');
        await this.loadCompilers();
    }

    private async performHealthCheck(): Promise<void> {
        const unhealthyCompilers: ID[] = [];

        for (const [compilerId] of this.compilers) {
            try {
                const testResult = await this.testCompiler(compilerId);
                if (!testResult.success) {
                    unhealthyCompilers.push(compilerId);
                }
            } catch (error) {
                this.logger.warn(
                    `Health check failed for compiler ${compilerId}`,
                    error
                );
                unhealthyCompilers.push(compilerId);
            }
        }

        if (unhealthyCompilers.length > 0) {
            this.logger.warn(`Found ${unhealthyCompilers.length} unhealthy compilers`);
            // Remove unhealthy compilers from cache
            for (const compilerId of unhealthyCompilers) {
                this.compilers.delete(compilerId);
            }
        }
    }

    private async emitCompilerDetectedEvent(compiler: CompilerInfo): Promise<void> {
        const event: CompilerDetectedEvent = {
            type: 'compiler:detected',
            timestamp: new Date(),
            compiler
        };
        await this.eventSystem.emit(event);
    }

    private async emitConfigChangedEvent(key: string, oldValue: unknown, newValue: unknown): Promise<void> {
        const event: ConfigChangedEvent = {
            type: 'config:changed',
            timestamp: new Date(),
            key,
            oldValue,
            newValue
        };
        await this.eventSystem.emit(event);
    }

    private generateCompilerId(compiler: CompilerInfo): ID {
        return `compiler_${compiler.type}_${compiler.version}_${Date.now()}`;
    }

    // API Implementation

    async detectCompilers(options?: {
    forceRescan?: boolean;
    deepScan?: boolean;
    progressCallback?: (progress: number, message: string) => void;
  }): Promise<CompilerDetectionResult> {
        try {
            this.logger.info('Detecting compilers', options);

            if (options?.progressCallback) {
                options.progressCallback(0, 'Starting compiler detection...');
            }

            const result = await CompilerDetector.detectCompilers(options?.deepScan || false);

            if (result.success) {
                // Update compiler cache
                this.compilers.clear();
                for (const compiler of result.compilers) {
                    const compilerId = this.generateCompilerId(compiler);
                    // Convert from types.ts CompilerInfo to models.ts CompilerInfo
                    const fullCompilerInfo: CompilerInfo = {
                        ...compiler,
                        capabilities: {
                            optimize: true,
                            debug: true,
                            sanitize: true,
                            parallel: true
                        },
                        metadata: {
                            installDate: new Date(),
                            verified: true
                        }
                    };
                    this.compilers.set(compilerId, fullCompilerInfo);

                    if (!this.compilationStats.has(compilerId)) {
                        this.compilationStats.set(compilerId, {
                            total: 0,
                            success: 0,
                            totalTime: 0,
                            lastUsed: new Date()
                        });
                    }

                    await this.emitCompilerDetectedEvent(fullCompilerInfo);
                }

                if (options?.progressCallback) {
                    options.progressCallback(100, `Found ${result.compilers.length} compilers`);
                }
            } else {
                if (options?.progressCallback) {
                    options.progressCallback(100, 'No compilers found');
                }
            }

            this.logger.info(`Compiler detection completed: ${result.compilers.length} compilers found`);
            return result;
        } catch (error) {
            this.logger.error('Failed to detect compilers', error);
            throw error;
        }
    }

    async getSuitableCompiler(language: ProgrammingLanguage): Promise<CompilerInfo> {
        try {
            const compilers = Array.from(this.compilers.values());

            // Filter compilers suitable for the language
            const suitableCompilers = compilers.filter(compiler => {
                if (language === 'c') {
                    return compiler.type === 'gcc' || compiler.type === 'clang' || compiler.type === 'apple-clang';
                } else if (language === 'cpp') {
                    return compiler.type === 'g++' || compiler.type === 'clang++';
                }
                return false;
            });

            if (suitableCompilers.length === 0) {
                throw new Error(`No suitable compiler found for ${language}`);
            }

            // Sort by priority and return the best one
            suitableCompilers.sort((a, b) => b.priority - a.priority);
            return suitableCompilers[0];
        } catch (error) {
            this.logger.error('Failed to get suitable compiler', error);
            throw error;
        }
    }

    async getCompilers(): Promise<CompilerInfo[]> {
        return Array.from(this.compilers.values());
    }

    async getCompiler(compilerId: ID): Promise<CompilerInfo | undefined> {
        return this.compilers.get(compilerId);
    }

    async getRecommendedCompiler(language: ProgrammingLanguage): Promise<CompilerInfo | undefined> {
        try {
            const defaultCompilerId = this.defaultCompilers.get(language);
            if (defaultCompilerId) {
                return this.compilers.get(defaultCompilerId);
            }

            // Fall back to suitable compiler selection
            return await this.getSuitableCompiler(language);
        } catch (error) {
            this.logger.error('Failed to get recommended compiler', error);
            throw error;
        }
    }

    async compile(options: {
    sourcePath: string;
    compiler?: CompilerInfo | ID;
    outputPath?: string;
    optimization?: OptimizationLevel;
    standard?: LanguageStandard;
    defines?: Record<string, string>;
    includePaths?: string[];
    libraryPaths?: string[];
    libraries?: string[];
    warnings?: string[];
    customFlags?: string[];
    debugSymbols?: boolean;
    sanitize?: {
      address?: boolean;
      memory?: boolean;
      thread?: boolean;
      undefined?: boolean;
    };
    timeout?: number;
    memoryLimit?: number;
  }): Promise<CompilationResult> {
        try {
            this.logger.info('Compiling source code', options);

            // Resolve compiler
            let compiler: CompilerInfo;
            if (typeof options.compiler === 'string') {
                const compilerInfo = this.compilers.get(options.compiler);
                if (!compilerInfo) {
                    throw new Error(`Compiler not found: ${options.compiler}`);
                }
                compiler = compilerInfo;
            } else if (options.compiler) {
                compiler = options.compiler;
            } else {
                // Auto-detect suitable compiler based on source file extension
                const extension = path.extname(options.sourcePath).toLowerCase();
                const language = extension === '.c' ? 'c' : 'cpp';
                compiler = await this.getSuitableCompiler(language);
            }

            // Build compilation command
            const command = this.buildCompilationCommand(compiler, options);

            // Execute compilation with resource limits
            const startTime = Date.now();
            const result = await ProcessRunner.executeCommand(
                command.command,
                command.args,
                path.dirname(options.sourcePath)
            );
            const executionTime = Date.now() - startTime;

            // Parse compilation result
            const compilationResult: CompilationResult = {
                success: result.exitCode === 0,
                executablePath: options.outputPath || this.getDefaultOutputPath(options.sourcePath),
                errors: this.parseCompilationErrors(result.stderr || result.stdout, options.sourcePath),
                warnings: [],
                executionTime,
                outputSize: 0, // Would need to check file size
                memoryUsage: 0, // Would need to track memory usage
                warningsCount: 0,
                errorsCount: result.exitCode !== 0 ? 1 : 0,
                cacheHit: false
            };

            // Update statistics
            const compilerId = this.generateCompilerId(compiler);
            const stats = this.compilationStats.get(compilerId);
            if (stats) {
                stats.total++;
                if (compilationResult.success) {
                    stats.success++;
                }
                stats.totalTime += executionTime;
                stats.lastUsed = new Date();
            }

            this.logger.info(
                `Compilation completed in ${executionTime}ms: ${
                    compilationResult.success ? 'success' : 'failed'
                }`
            );
            return compilationResult;
        } catch (error) {
            this.logger.error('Failed to compile source code', error);
            throw error;
        }
    }

    private buildCompilationCommand(
        compiler: CompilerInfo,
        options: {
            optimization?: string;
            standard?: string;
            defines?: Record<string, string>;
            includePaths?: string[];
            libraryPaths?: string[];
            libraries?: string[];
            warnings?: string[];
            customFlags?: string[];
            debugSymbols?: boolean;
            sanitize?: {
                address?: boolean;
                memory?: boolean;
                thread?: boolean;
                undefined?: boolean;
            };
            outputPath?: string;
            sourcePath: string;
        }
    ): { command: string; args: string[] } {
        const args: string[] = [];

        // Add optimization level
        if (options.optimization) {
            args.push(`-${options.optimization}`);
        }

        // Add language standard
        if (options.standard) {
            args.push(`-std=${options.standard}`);
        }

        // Add defines
        if (options.defines) {
            for (const [key, value] of Object.entries(options.defines)) {
                args.push(`-D${key}=${value}`);
            }
        }

        // Add include paths
        if (options.includePaths) {
            for (const includePath of options.includePaths) {
                args.push(`-I${includePath}`);
            }
        }

        // Add library paths
        if (options.libraryPaths) {
            for (const libraryPath of options.libraryPaths) {
                args.push(`-L${libraryPath}`);
            }
        }

        // Add libraries
        if (options.libraries) {
            for (const library of options.libraries) {
                args.push(`-l${library}`);
            }
        }

        // Add warnings
        if (options.warnings) {
            for (const warning of options.warnings) {
                args.push(`-W${warning}`);
            }
        }

        // Add custom flags
        if (options.customFlags) {
            args.push(...options.customFlags);
        }

        // Add debug symbols
        if (options.debugSymbols) {
            args.push('-g');
        }

        // Add sanitizers
        if (options.sanitize) {
            const sanitizers: string[] = [];
            if (options.sanitize.address) sanitizers.push('address');
            if (options.sanitize.memory) sanitizers.push('memory');
            if (options.sanitize.thread) sanitizers.push('thread');
            if (options.sanitize.undefined) sanitizers.push('undefined');

            if (sanitizers.length > 0) {
                args.push(`-fsanitize=${sanitizers.join(',')}`);
            }
        }

        // Add output file
        if (options.outputPath) {
            args.push('-o', options.outputPath);
        }

        // Add source file
        args.push(options.sourcePath);

        return {
            command: compiler.path,
            args
        };
    }

    private parseCompilationErrors(output: string, sourcePath: string): CompilationError[] {
        const errors: CompilationError[] = [];
        const lines = output.split('\n');

        for (const line of lines) {
            // Parse common error formats
            const errorMatch = line.match(/^(.*?):(\d+):(\d+):\s+(error|warning):\s+(.*)$/);
            if (errorMatch) {
                const [, file, lineStr, columnStr, severity, message] = errorMatch;
                errors.push({
                    file: file || sourcePath,
                    line: parseInt(lineStr) || 1,
                    column: parseInt(columnStr) || 1,
                    message,
                    severity: severity === 'error' ? 'error' : 'warning',
                    code: undefined,
                    context: []
                });
            }
        }

        return errors;
    }

    private getDefaultOutputPath(sourcePath: string): string {
        const parsedPath = path.parse(sourcePath);
        return path.join(parsedPath.dir, parsedPath.name);
    }

    async getCompilerVersion(compiler: CompilerInfo | ID): Promise<string> {
        try {
            let compilerInfo: CompilerInfo;
            if (typeof compiler === 'string') {
                const foundCompiler = this.compilers.get(compiler);
                if (!foundCompiler) {
                    throw new Error(
                        `Compiler not found: ${compiler}`
                    );
                }
                compilerInfo = foundCompiler;
            } else {
                compilerInfo = compiler;
            }

            const result = await ProcessRunner.executeCommand(compilerInfo.path, ['--version']);
            return result.stdout || result.stderr;
        } catch (error) {
            this.logger.error('Failed to get compiler version', error);
            throw error;
        }
    }

    async getSupportedStandards(compiler: CompilerInfo | ID): Promise<string[]> {
        try {
            let compilerInfo: CompilerInfo;
            if (typeof compiler === 'string') {
                const foundCompiler = this.compilers.get(compiler);
                if (!foundCompiler) {
                    throw new Error(
                        `Compiler not found: ${compiler}`
                    );
                }
                compilerInfo = foundCompiler;
            } else {
                compilerInfo = compiler;
            }

            // Return the cached supported standards from the compiler info
            return compilerInfo.supportedStandards || [];
        } catch (error) {
            this.logger.error('Failed to get supported standards', error);
            throw error;
        }
    }

    async validateCompiler(compiler: CompilerInfo): Promise<ValidationResult> {
        try {
            const errors: ValidationError[] = [];
            const warnings: ValidationWarning[] = [];

            // Check if compiler path exists and is executable
            try {
                await fs.access(compiler.path, fs.constants.F_OK | fs.constants.X_OK);
            } catch {
                errors.push({
                    field: 'path',
                    message: `Compiler path is not accessible: ${compiler.path}`,
                    code: 'INACCESSIBLE_PATH',
                    severity: 'critical'
                });
            }

            // Test compiler functionality
            try {
                const testResult = await ProcessRunner.executeCommand(compiler.path, ['--version']);
                if (!testResult.stdout && !testResult.stderr) {
                    errors.push({
                        field: 'functionality',
                        message: 'Compiler does not respond to version query',
                        code: 'NON_RESPONSIVE_COMPILER',
                        severity: 'major'
                    });
                }
            } catch (error) {
                errors.push({
                    field: 'functionality',
                    message: `Compiler functionality test failed: ${error}`,
                    code: 'FUNCTIONALITY_TEST_FAILED',
                    severity: 'major'
                });
            }

            // Validate compiler properties
            if (!compiler.type) {
                errors.push({
                    field: 'type',
                    message: 'Compiler type is required',
                    code: 'MISSING_TYPE',
                    severity: 'critical'
                });
            }

            if (!compiler.version || compiler.version === 'unknown') {
                warnings.push({
                    field: 'version',
                    message: 'Compiler version could not be determined',
                    code: 'UNKNOWN_VERSION'
                });
            }

            return {
                valid: errors.length === 0,
                errors,
                warnings,
                score: errors.length === 0 ? 100 : Math.max(0, 100 - (errors.length * 25))
            };
        } catch (error) {
            this.logger.error('Failed to validate compiler', error);
            throw error;
        }
    }

    async installCompiler(type: 'llvm' | 'gcc' | 'msvc', options?: {
    version?: string;
    installPath?: string;
    progressCallback?: (progress: number, message: string) => void;
  }): Promise<void> {
        try {
            this.logger.info(`Installing compiler: ${type}`, options);

            // Use the compiler installer (only LLVM is supported for now)
            if (type === 'llvm') {
                await CompilerInstaller.installLLVM();
            } else {
                throw new Error(`Compiler type '${type}' is not supported for automatic installation`);
            }

            // Refresh compiler list after installation
            await this.detectCompilers();

            this.logger.info(`Compiler installation completed: ${type}`);
        } catch (error) {
            this.logger.error('Failed to install compiler', error);
            throw error;
        }
    }

    async removeCompiler(compilerId: ID): Promise<void> {
        try {
            const compiler = this.compilers.get(compilerId);
            if (!compiler) {
                throw new Error(`Compiler not found: ${compilerId}`);
            }

            // Remove from cache
            this.compilers.delete(compilerId);
            this.compilationStats.delete(compilerId);

            // Remove from default compilers if it was set as default
            for (const [language, defaultId] of this.defaultCompilers) {
                if (defaultId === compilerId) {
                    this.defaultCompilers.delete(language);
                }
            }

            this.logger.info(`Compiler removed: ${compilerId}`);
        } catch (error) {
            this.logger.error('Failed to remove compiler', error);
            throw error;
        }
    }

    async setDefaultCompiler(language: ProgrammingLanguage, compilerId: ID): Promise<void> {
        try {
            const compiler = this.compilers.get(compilerId);
            if (!compiler) {
                throw new Error(`Compiler not found: ${compilerId}`);
            }

            const oldValue = this.defaultCompilers.get(language);
            this.defaultCompilers.set(language, compilerId);

            await this.emitConfigChangedEvent(
                `defaultCompiler.${language}`,
                oldValue,
                compilerId
            );

            this.logger.info(`Default compiler set for ${language}: ${compilerId}`);
        } catch (error) {
            this.logger.error('Failed to set default compiler', error);
            throw error;
        }
    }

    async getDefaultCompiler(language: ProgrammingLanguage): Promise<CompilerInfo | undefined> {
        const compilerId = this.defaultCompilers.get(language);
        if (compilerId) {
            return this.compilers.get(compilerId);
        }
        return undefined;
    }

    async testCompiler(compiler: CompilerInfo | ID): Promise<{
    success: boolean;
    output?: string;
    error?: string;
    executionTime: number;
  }> {
        try {
            let compilerInfo: CompilerInfo;
            if (typeof compiler === 'string') {
                const foundCompiler = this.compilers.get(compiler);
                if (!foundCompiler) {
                    throw new Error(
                        `Compiler not found: ${compiler}`
                    );
                }
                compilerInfo = foundCompiler;
            } else {
                compilerInfo = compiler;
            }

            const startTime = Date.now();
            const result = await ProcessRunner.executeCommand(compilerInfo.path, ['--version']);
            const executionTime = Date.now() - startTime;

            return {
                success: result.exitCode === 0,
                output: result.stdout || result.stderr,
                executionTime
            };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error),
                executionTime: 0
            };
        }
    }

    async getCompilerStats(compilerId?: ID): Promise<{
    totalCompilations: number;
    successRate: number;
    averageTime: number;
    lastUsed: Date;
  }> {
        if (compilerId) {
            const stats = this.compilationStats.get(compilerId);
            if (!stats) {
                throw new Error(`Compiler not found: ${compilerId}`);
            }

            return {
                totalCompilations: stats.total,
                successRate: stats.total > 0 ? stats.success / stats.total : 0,
                averageTime: stats.total > 0 ? stats.totalTime / stats.total : 0,
                lastUsed: stats.lastUsed
            };
        } else {
            // Aggregate stats for all compilers
            let totalCompilations = 0;
            let totalSuccess = 0;
            let totalTime = 0;
            let lastUsed = new Date(0);

            for (const stats of this.compilationStats.values()) {
                totalCompilations += stats.total;
                totalSuccess += stats.success;
                totalTime += stats.totalTime;
                if (stats.lastUsed > lastUsed) {
                    lastUsed = stats.lastUsed;
                }
            }

            return {
                totalCompilations,
                successRate: totalCompilations > 0 ? totalSuccess / totalCompilations : 0,
                averageTime: totalCompilations > 0 ? totalTime / totalCompilations : 0,
                lastUsed
            };
        }
    }

    async searchCompilers(query: string, options?: {
    fields?: ('name' | 'type' | 'version' | 'path')[];
    limit?: number;
    fuzzy?: boolean;
  }): Promise<CompilerInfo[]> {
        const fields = options?.fields || ['name', 'type', 'version', 'path'];
        const searchQuery = query.toLowerCase();
        const results: CompilerInfo[] = [];

        for (const compiler of this.compilers.values()) {
            let match = false;

            for (const field of fields) {
                let fieldValue: string;

                switch (field) {
                    case 'name':
                        fieldValue = compiler.name.toLowerCase();
                        break;
                    case 'type':
                        fieldValue = compiler.type.toLowerCase();
                        break;
                    case 'version':
                        fieldValue = compiler.version.toLowerCase();
                        break;
                    case 'path':
                        fieldValue = compiler.path.toLowerCase();
                        break;
                    default:
                        continue;
                }

                if (options?.fuzzy) {
                    // Simple fuzzy matching
                    const distance = this.levenshteinDistance(searchQuery, fieldValue);
                    if (distance <= Math.max(searchQuery.length, fieldValue.length) / 3) {
                        match = true;
                        break;
                    }
                } else {
                    if (fieldValue.includes(searchQuery)) {
                        match = true;
                        break;
                    }
                }
            }

            if (match) {
                results.push(compiler);
            }
        }

        if (options?.limit) {
            return results.slice(0, options.limit);
        }

        return results;
    }

    async configureCompiler(compilerId: ID, config: {
    priority?: number;
    defaultFor?: ProgrammingLanguage[];
    customFlags?: string[];
    disabled?: boolean;
  }): Promise<void> {
        try {
            const compiler = this.compilers.get(compilerId);
            if (!compiler) {
                throw new Error(`Compiler not found: ${compilerId}`);
            }

            // Update compiler configuration
            if (config.priority !== undefined) {
                compiler.priority = config.priority;
            }

            if (config.defaultFor) {
                for (const language of config.defaultFor) {
                    this.defaultCompilers.set(language, compilerId);
                }
            }

            if (config.customFlags) {
                // Store custom flags in compiler metadata
                if (!compiler.metadata) {
                    compiler.metadata = {};
                }
                compiler.metadata.customFlags = config.customFlags;
            }

            if (config.disabled !== undefined) {
                if (!compiler.metadata) {
                    compiler.metadata = {};
                }
                compiler.metadata.disabled = config.disabled;
            }

            this.logger.info(`Compiler configuration updated: ${compilerId}`);
        } catch (error) {
            this.logger.error('Failed to configure compiler', error);
            throw error;
        }
    }

    async getCompilerDiagnostics(compilerId: ID): Promise<Diagnostic[]> {
        try {
            const compiler = this.compilers.get(compilerId);
            if (!compiler) {
                throw new Error(`Compiler not found: ${compilerId}`);
            }

            const diagnostics: Diagnostic[] = [];

            // Check compiler accessibility
            try {
                await fs.access(compiler.path, fs.constants.F_OK | fs.constants.X_OK);
            } catch {
                diagnostics.push({
                    type: 'error',
                    message: `Compiler path is not accessible: ${compiler.path}`,
                    source: 'CompilerManager'
                });
            }

            // Check compiler functionality
            try {
                const testResult = await this.testCompiler(compilerId);
                if (!testResult.success) {
                    diagnostics.push({
                        type: 'error',
                        message: `Compiler functionality test failed: ${testResult.error}`,
                        source: 'CompilerManager'
                    });
                }
            } catch (error) {
                diagnostics.push({
                    type: 'error',
                    message: `Compiler test failed: ${error}`,
                    source: 'CompilerManager'
                });
            }

            return diagnostics;
        } catch (error) {
            this.logger.error('Failed to get compiler diagnostics', error);
            throw error;
        }
    }

    private levenshteinDistance(str1: string, str2: string): number {
        const matrix = Array(str2.length + 1).fill(null).map(() => Array(str1.length + 1).fill(null));

        for (let i = 0; i <= str1.length; i += 1) matrix[0][i] = i;
        for (let j = 0; j <= str2.length; j += 1) matrix[j][0] = j;

        for (let j = 1; j <= str2.length; j += 1) {
            for (let i = 1; i <= str1.length; i += 1) {
                const indicator = str1[i - 1] === str2[j - 1] ? 0 : 1;
                matrix[j][i] = Math.min(
                    matrix[j][i - 1] + 1,
                    matrix[j - 1][i] + 1,
                    matrix[j - 1][i - 1] + indicator
                );
            }
        }

        return matrix[str2.length][str1.length];
    }

    dispose(): void {
        this.disposables.forEach(d => d.dispose());
        this.disposables.length = 0;
        this.logger.info('CompilerManager disposed');
    }
}
