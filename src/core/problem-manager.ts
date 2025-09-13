/* ---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *-------------------------------------------------------------------------------------------- */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import { EventSystem } from './event-system';
import { Logger } from '../utils/logger';
import { Validator } from '../utils/validator';
import { FsHelper } from '../utils/fs-helper';
import { TemplateGenerator } from '../utils/template-generator';
import { ConfigManager } from '../config/config-manager';
import {
    Problem,
    TestCase,
    TestResult,
    ProblemConfig,
    ProblemStats,
    ValidationResult,
    ValidationError,
    ProblemCreatedEvent,
    ProblemUpdatedEvent,
    ProblemDeletedEvent,
    TestStartedEvent,
    TestCompletedEvent,
    ID,
    Difficulty,
    ProgrammingLanguage,
    CreateProblemPayload,
    ValidationWarning
} from '../types/models';
import { ProblemManagerConfig } from '../types/config';

/**
 * Problem Manager API
 *
 * Provides comprehensive problem management functionality including:
 * - CRUD operations for problems
 * - Test case management
 * - Template generation
 * - Validation and error handling
 * - Statistics and reporting
 * - Event-driven architecture integration
 */
export interface ProblemManagerAPI {
  /**
   * Create a new problem
   */
  createProblem(payload: CreateProblemPayload): Promise<Problem>;

  /**
   * Get problem by ID
   */
  getProblem(problemId: ID): Promise<Problem | undefined>;

  /**
   * Get problem by directory path
   */
  getProblemByDirectory(directory: string): Promise<Problem | undefined>;

  /**
   * List all problems
   */
  listProblems(options?: {
    filter?: {
      difficulty?: Difficulty[];
      language?: ProgrammingLanguage[];
      tags?: string[];
    };
    sort?: {
      field: 'name' | 'difficulty' | 'createdAt' | 'lastUsed';
      order: 'asc' | 'desc';
    };
    pagination?: {
      page: number;
      pageSize: number;
    };
  }): Promise<Problem[]>;

  /**
   * Update problem
   */
  updateProblem(problemId: ID, updates: Partial<Problem>): Promise<Problem>;

  /**
   * Delete problem
   */
  deleteProblem(problemId: ID): Promise<void>;

  /**
   * Add test case to problem
   */
  addTestCase(problemId: ID, testCase: Omit<TestCase, 'id' | 'metadata'>): Promise<TestCase>;

  /**
   * Update test case
   */
  updateTestCase(problemId: ID, testCaseId: ID, updates: Partial<TestCase>): Promise<TestCase>;

  /**
   * Delete test case
   */
  deleteTestCase(problemId: ID, testCaseId: ID): Promise<void>;

  /**
   * Run test case
   */
  runTestCase(problemId: ID, testCaseId: ID, options?: {
    compiler?: string;
    optimization?: string;
    debug?: boolean;
  }): Promise<TestResult>;

  /**
   * Run all test cases for problem
   */
  runAllTestCases(problemId: ID, options?: {
    compiler?: string;
    optimization?: string;
    debug?: boolean;
    parallel?: boolean;
  }): Promise<TestResult[]>;

  /**
   * Generate code template
   */
  generateTemplate(problemId: ID, language: ProgrammingLanguage): Promise<string>;

  /**
   * Validate problem configuration
   */
  validateProblem(problem: Problem): Promise<ValidationResult>;

  /**
   * Export problem
   */
  exportProblem(problemId: ID, format: 'json' | 'zip'): Promise<string | Buffer>;

  /**
   * Import problem
   */
  importProblem(data: string | Buffer, format: 'json' | 'zip'): Promise<Problem>;

  /**
   * Get problem statistics
   */
  getProblemStats(problemId: ID): Promise<ProblemStats>;

  /**
   * Search problems
   */
  searchProblems(query: string, options?: {
    fields?: ('name' | 'description' | 'tags' | 'source')[];
    limit?: number;
    fuzzy?: boolean;
  }): Promise<Problem[]>;

  /**
   * Get problem templates
   */
  getProblemTemplates(problemId: ID): Promise<Record<ProgrammingLanguage, string>>;

  /**
   * Update problem templates
   */
  updateProblemTemplates(problemId: ID, templates: Record<ProgrammingLanguage, string>): Promise<void>;

  /**
   * Get recent problems
   */
  getRecentProblems(limit?: number): Promise<Problem[]>;

  /**
   * Get problem directory structure
   */
  getProblemDirectoryStructure(problemId: ID): Promise<{
    main: string;
    additional: string[];
    config: string[];
    test: string[];
  }>;
}

/**
 * Problem Manager Implementation
 */
export class ProblemManager implements ProblemManagerAPI, vscode.Disposable {
    private static instance: ProblemManager;
    private readonly logger: Logger;
    private readonly validator: Validator;
    private readonly fsHelper: typeof FsHelper;
    private readonly templateGenerator: TemplateGenerator;
    private readonly configManager: ConfigManager;
    private readonly eventSystem: EventSystem;
    private readonly config: ProblemManagerConfig;
    private problems: Map<ID, Problem> = new Map();
    private readonly disposables: vscode.Disposable[] = [];

    constructor(
        eventSystem: EventSystem,
        configManager: ConfigManager,
        config: ProblemManagerConfig
    ) {
        this.eventSystem = eventSystem;
        this.configManager = configManager;
        this.config = config;
        this.logger = new Logger('ProblemManager');
        this.validator = new Validator();
        this.fsHelper = FsHelper;
        this.templateGenerator = new TemplateGenerator();

        this.initialize();
    }

    static getInstance(
        eventSystem: EventSystem,
        configManager: ConfigManager,
        config: ProblemManagerConfig
    ): ProblemManager {
        if (!ProblemManager.instance) {
            ProblemManager.instance = new ProblemManager(eventSystem, configManager, config);
        }
        return ProblemManager.instance;
    }

    private async initialize(): Promise<void> {
        try {
            await this.loadProblems();
            this.setupEventHandlers();
            this.logger.info('ProblemManager initialized successfully');
        } catch (error) {
            this.logger.error('Failed to initialize ProblemManager', error);
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

        // Listen for file system changes
        const watcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(this.config.basePath, '**/*')
        );
        this.disposables.push(watcher);

        watcher.onDidChange(uri => this.handleFileChange(uri.fsPath));
        watcher.onDidCreate(uri => this.handleFileChange(uri.fsPath));
        watcher.onDidDelete(uri => this.handleFileChange(uri.fsPath));
    }

    private async loadProblems(): Promise<void> {
        try {
            const problemDirs = await this.fsHelper.listDirectories(this.config.basePath);

            for (const dir of problemDirs) {
                try {
                    const problem = await this.loadProblemFromDirectory(dir);
                    if (problem) {
                        this.problems.set(problem.id, problem);
                    }
                } catch (error) {
                    this.logger.warn(`Failed to load problem from ${dir}`, error);
                }
            }

            this.logger.info(`Loaded ${this.problems.size} problems`);
        } catch (error) {
            this.logger.error('Failed to load problems', error);
            throw error;
        }
    }

    private async loadProblemFromDirectory(directory: string): Promise<Problem | undefined> {
        try {
            const configPath = path.join(directory, 'problem.json');
            const configExists = await this.fsHelper.fileExists(configPath);

            if (!configExists) {
                return undefined;
            }

            const configContent = await fs.readFile(configPath, 'utf-8');
            const problemConfig: ProblemConfig = JSON.parse(configContent);

            // Convert to Problem with additional metadata
            const problem: Problem = {
                ...problemConfig,
                directory,
                sourceFiles: await this.discoverSourceFiles(directory),
                configFiles: {
                    problem: configPath,
                    statement: path.join(directory, 'statement.md'),
                    samples: path.join(directory, 'samples.json')
                },
                stats: await this.calculateProblemStats()
            };

            return problem;
        } catch (error) {
            this.logger.error(`Failed to load problem from ${directory}`, error);
            return undefined;
        }
    }

    private async discoverSourceFiles(directory: string): Promise<{
    main: string;
    additional?: string[];
  }> {
        const files = await this.fsHelper.listFiles(directory);
        const sourceFiles = files.filter(file =>
            file.endsWith('.c') || file.endsWith('.cpp')
        );

        if (sourceFiles.length === 0) {
            return { main: '' };
        }

        // Assume first source file is main
        const main = sourceFiles[0];
        const additional = sourceFiles.slice(1);

        return { main, additional: additional.length > 0 ? additional : undefined };
    }

    private async calculateProblemStats(): Promise<ProblemStats> {
    // This would be implemented to calculate actual statistics
        return {
            testCases: 0,
            successRate: 0,
            averageTime: 0,
            averageMemory: 0,
            lastUsed: new Date(),
            runCount: 0,
            passCount: 0
        };
    }

    private async handleConfigChange(): Promise<void> {
        this.logger.info('Configuration changed, reloading problems...');
        await this.loadProblems();
    }

    private async handleFileChange(filePath: string): Promise<void> {
    // Find which problem this file belongs to
        for (const [problemId, problem] of this.problems) {
            if (filePath.startsWith(problem.directory)) {
                try {
                    const updatedProblem = await this.loadProblemFromDirectory(problem.directory);
                    if (updatedProblem) {
                        this.problems.set(problemId, updatedProblem);
                        await this.emitProblemUpdatedEvent(problemId, updatedProblem);
                    }
                } catch (error) {
                    this.logger.error(`Failed to reload problem ${problemId}`, error);
                }
                break;
            }
        }
    }

    private async emitProblemCreatedEvent(problem: Problem): Promise<void> {
        const event: ProblemCreatedEvent = {
            type: 'problem:created',
            timestamp: new Date(),
            problem
        };
        await this.eventSystem.emit(event);
    }

    private async emitProblemUpdatedEvent(problemId: ID, problem: Problem): Promise<void> {
        const event: ProblemUpdatedEvent = {
            type: 'problem:updated',
            timestamp: new Date(),
            problemId,
            changes: problem
        };
        await this.eventSystem.emit(event);
    }

    private async emitProblemDeletedEvent(problemId: ID): Promise<void> {
        const event: ProblemDeletedEvent = {
            type: 'problem:deleted',
            timestamp: new Date(),
            problemId
        };
        await this.eventSystem.emit(event);
    }

    private async emitTestStartedEvent(testId: string, problemId: string, sourcePath: string): Promise<void> {
        const event: TestStartedEvent = {
            type: 'test:started',
            timestamp: new Date(),
            testId,
            problemId,
            sourcePath
        };
        await this.eventSystem.emit(event);
    }

    private async emitTestCompletedEvent(testId: string, result: TestResult): Promise<void> {
        const event: TestCompletedEvent = {
            type: 'test:completed',
            timestamp: new Date(),
            testId,
            result
        };
        await this.eventSystem.emit(event);
    }

    private generateId(): ID {
        return `problem_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    // API Implementation

    async createProblem(payload: CreateProblemPayload): Promise<Problem> {
        try {
            this.logger.info('Creating new problem', payload);

            // Validate payload
            const validation = Validator.validateCreateProblemPayload(payload);
            if (!validation.isValid) {
                throw new Error(`Invalid payload: ${validation.errors.join(', ')}`);
            }

            // Generate problem directory
            const problemDir = payload.baseDir ||
                path.join(this.config.basePath, payload.name || `problem_${Date.now()}`);
            await this.fsHelper.createDirectory(problemDir);

            // Create problem object
            const problem: Problem = {
                id: this.generateId(),
                name: payload.name || 'Untitled Problem',
                description: '',
                difficulty: payload.difficulty || 'medium',
                source: {},
                metadata: {
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    version: 1,
                    tags: payload.tags || []
                },
                constraints: {
                    timeLimit: payload.timeLimit || 1,
                    memoryLimit: payload.memoryLimit || 256
                },
                languages: payload.language ? [payload.language] : ['cpp'],
                samples: [],
                testCases: [],
                templates: [],
                directory: problemDir,
                sourceFiles: { main: '' },
                configFiles: {
                    problem: path.join(problemDir, 'problem.json'),
                    statement: path.join(problemDir, 'statement.md'),
                    samples: path.join(problemDir, 'samples.json')
                }
            };

            // Save problem configuration
            await this.saveProblemConfig(problem);

            // Generate template files if specified
            if (payload.template) {
                await this.generateTemplateFiles(problem, payload.language || 'cpp');
            }

            // Cache and emit event
            this.problems.set(problem.id, problem);
            await this.emitProblemCreatedEvent(problem);

            this.logger.info(`Problem created successfully: ${problem.id}`);
            return problem;
        } catch (error) {
            this.logger.error('Failed to create problem', error);
            throw error;
        }
    }

    async getProblem(problemId: ID): Promise<Problem | undefined> {
        return this.problems.get(problemId);
    }

    async getProblemByDirectory(directory: string): Promise<Problem | undefined> {
        for (const problem of this.problems.values()) {
            if (problem.directory === directory) {
                return problem;
            }
        }
        return undefined;
    }

    async listProblems(options?: {
    filter?: {
      difficulty?: Difficulty[];
      language?: ProgrammingLanguage[];
      tags?: string[];
    };
    sort?: {
      field: 'name' | 'difficulty' | 'createdAt' | 'lastUsed';
      order: 'asc' | 'desc';
    };
    pagination?: {
      page: number;
      pageSize: number;
    };
  }): Promise<Problem[]> {
        let problems = Array.from(this.problems.values());

        // Apply filters
        if (options?.filter) {
            problems = problems.filter(problem => {
                if (options.filter!.difficulty &&
                    !options.filter!.difficulty.includes(problem.difficulty)) {
                    return false;
                }
                if (options.filter!.language &&
                    !options.filter!.language.some(lang => problem.languages.includes(lang))) {
                    return false;
                }
                if (options.filter!.tags &&
                    !options.filter!.tags.some(tag => problem.metadata.tags.includes(tag))) {
                    return false;
                }
                return true;
            });
        }

        // Apply sorting
        if (options?.sort) {
            problems.sort((a, b) => {
                let aValue: any, bValue: any;

                switch (options.sort!.field) {
                    case 'name':
                        aValue = a.name;
                        bValue = b.name;
                        break;
                    case 'difficulty': {
                        const difficultyOrder = { 'easy': 0, 'medium': 1, 'hard': 2 };
                        aValue = difficultyOrder[a.difficulty];
                        bValue = difficultyOrder[b.difficulty];
                        break;
                    }
                    case 'createdAt':
                        aValue = a.metadata.createdAt.getTime();
                        bValue = b.metadata.createdAt.getTime();
                        break;
                    case 'lastUsed':
                        aValue = a.stats?.lastUsed?.getTime() || 0;
                        bValue = b.stats?.lastUsed?.getTime() || 0;
                        break;
                }

                if (options.sort!.order === 'asc') {
                    return aValue < bValue ? -1 : aValue > bValue ? 1 : 0;
                } else {
                    return aValue > bValue ? -1 : aValue < bValue ? 1 : 0;
                }
            });
        }

        // Apply pagination
        if (options?.pagination) {
            const { page, pageSize } = options.pagination;
            const start = (page - 1) * pageSize;
            const end = start + pageSize;
            problems = problems.slice(start, end);
        }

        return problems;
    }

    async updateProblem(problemId: ID, updates: Partial<Problem>): Promise<Problem> {
        try {
            const problem = this.problems.get(problemId);
            if (!problem) {
                throw new Error(`Problem not found: ${problemId}`);
            }

            // Apply updates
            const updatedProblem = {
                ...problem,
                ...updates,
                metadata: {
                    ...problem.metadata,
                    ...updates.metadata,
                    updatedAt: new Date(),
                    version: problem.metadata.version + 1
                }
            };

            // Validate updated problem
            const validation = await this.validateProblem(updatedProblem);
            if (!validation.valid) {
                throw new Error(`Invalid problem: ${validation.errors.map(e => e.message).join(', ')}`);
            }

            // Save updated configuration
            await this.saveProblemConfig(updatedProblem);

            // Update cache and emit event
            this.problems.set(problemId, updatedProblem);
            await this.emitProblemUpdatedEvent(problemId, updatedProblem);

            this.logger.info(`Problem updated successfully: ${problemId}`);
            return updatedProblem;
        } catch (error) {
            this.logger.error(`Failed to update problem ${problemId}`, error);
            throw error;
        }
    }

    async deleteProblem(problemId: ID): Promise<void> {
        try {
            const problem = this.problems.get(problemId);
            if (!problem) {
                throw new Error(`Problem not found: ${problemId}`);
            }

            // Delete problem directory
            await this.fsHelper.deleteDirectory(problem.directory);

            // Remove from cache and emit event
            this.problems.delete(problemId);
            await this.emitProblemDeletedEvent(problemId);

            this.logger.info(`Problem deleted successfully: ${problemId}`);
        } catch (error) {
            this.logger.error(`Failed to delete problem ${problemId}`, error);
            throw error;
        }
    }

    async addTestCase(problemId: ID, testCase: Omit<TestCase, 'id' | 'metadata'>): Promise<TestCase> {
        try {
            const problem = this.problems.get(problemId);
            if (!problem) {
                throw new Error(`Problem not found: ${problemId}`);
            }

            const newTestCase: TestCase = {
                ...testCase,
                id: this.generateId(),
                metadata: {
                    createdAt: new Date(),
                    updatedAt: new Date()
                }
            };

            problem.testCases.push(newTestCase);
            problem.metadata.updatedAt = new Date();
            problem.metadata.version++;

            await this.saveProblemConfig(problem);
            await this.emitProblemUpdatedEvent(problemId, problem);

            this.logger.info(`Test case added successfully: ${newTestCase.id}`);
            return newTestCase;
        } catch (error) {
            this.logger.error(`Failed to add test case to problem ${problemId}`, error);
            throw error;
        }
    }

    async updateTestCase(problemId: ID, testCaseId: ID, updates: Partial<TestCase>): Promise<TestCase> {
        try {
            const problem = this.problems.get(problemId);
            if (!problem) {
                throw new Error(`Problem not found: ${problemId}`);
            }

            const testCaseIndex = problem.testCases.findIndex(tc => tc.id === testCaseId);
            if (testCaseIndex === -1) {
                throw new Error(`Test case not found: ${testCaseId}`);
            }

            const updatedTestCase = {
                ...problem.testCases[testCaseIndex],
                ...updates,
                metadata: {
                    ...problem.testCases[testCaseIndex].metadata,
                    ...updates.metadata,
                    updatedAt: new Date()
                }
            };

            problem.testCases[testCaseIndex] = updatedTestCase;
            problem.metadata.updatedAt = new Date();
            problem.metadata.version++;

            await this.saveProblemConfig(problem);
            await this.emitProblemUpdatedEvent(problemId, problem);

            this.logger.info(`Test case updated successfully: ${testCaseId}`);
            return updatedTestCase;
        } catch (error) {
            this.logger.error(`Failed to update test case ${testCaseId}`, error);
            throw error;
        }
    }

    async deleteTestCase(problemId: ID, testCaseId: ID): Promise<void> {
        try {
            const problem = this.problems.get(problemId);
            if (!problem) {
                throw new Error(`Problem not found: ${problemId}`);
            }

            const testCaseIndex = problem.testCases.findIndex(tc => tc.id === testCaseId);
            if (testCaseIndex === -1) {
                throw new Error(`Test case not found: ${testCaseId}`);
            }

            problem.testCases.splice(testCaseIndex, 1);
            problem.metadata.updatedAt = new Date();
            problem.metadata.version++;

            await this.saveProblemConfig(problem);
            await this.emitProblemUpdatedEvent(problemId, problem);

            this.logger.info(`Test case deleted successfully: ${testCaseId}`);
        } catch (error) {
            this.logger.error(`Failed to delete test case ${testCaseId}`, error);
            throw error;
        }
    }

    async runTestCase(problemId: ID, testCaseId: ID, options?: {
    compiler?: string;
    optimization?: string;
    debug?: boolean;
  }): Promise<TestResult> {
        try {
            const problem = this.problems.get(problemId);
            if (!problem) {
                throw new Error(`Problem not found: ${problemId}`);
            }

            const testCase = problem.testCases.find(tc => tc.id === testCaseId);
            if (!testCase) {
                throw new Error(`Test case not found: ${testCaseId}`);
            }

            const testId = this.generateId();
            await this.emitTestStartedEvent(testId, problemId, problem.sourceFiles.main);

            // This would integrate with the test runner system
            const result: TestResult = {
                id: testId,
                testCase,
                execution: {
                    success: false,
                    exitCode: 0,
                    output: '',
                    error: '',
                    executionTime: 0,
                    memoryUsage: 0,
                    cpuUsage: 0,
                    status: 'completed',
                    diagnostics: []
                },
                success: false,
                timestamp: new Date(),
                metadata: {
                    problemId,
                    sourceFile: problem.sourceFiles.main,
                    compiler: options?.compiler || 'default'
                }
            };

            await this.emitTestCompletedEvent(testId, result);

            this.logger.info(`Test case executed successfully: ${testCaseId}`);
            return result;
        } catch (error) {
            this.logger.error(`Failed to run test case ${testCaseId}`, error);
            throw error;
        }
    }

    async runAllTestCases(problemId: ID, options?: {
    compiler?: string;
    optimization?: string;
    debug?: boolean;
    parallel?: boolean;
  }): Promise<TestResult[]> {
        try {
            const problem = this.problems.get(problemId);
            if (!problem) {
                throw new Error(`Problem not found: ${problemId}`);
            }

            const results: TestResult[] = [];

            if (options?.parallel) {
                // Run test cases in parallel
                const promises = problem.testCases.map(testCase =>
                    this.runTestCase(problemId, testCase.id, options)
                );
                results.push(...await Promise.all(promises));
            } else {
                // Run test cases sequentially
                for (const testCase of problem.testCases) {
                    const result = await this.runTestCase(problemId, testCase.id, options);
                    results.push(result);
                }
            }

            this.logger.info(`All test cases executed successfully for problem: ${problemId}`);
            return results;
        } catch (error) {
            this.logger.error(`Failed to run all test cases for problem ${problemId}`, error);
            throw error;
        }
    }

    async generateTemplate(problemId: ID, language: ProgrammingLanguage): Promise<string> {
        try {
            const problem = this.problems.get(problemId);
            if (!problem) {
                throw new Error(`Problem not found: ${problemId}`);
            }

            const template = TemplateGenerator.generate('', { problem, language });
            this.logger.info(`Template generated successfully for problem ${problemId} in ${language}`);
            return template;
        } catch (error) {
            this.logger.error(`Failed to generate template for problem ${problemId}`, error);
            throw error;
        }
    }

    async validateProblem(problem: Problem): Promise<ValidationResult> {
        try {
            const errors: ValidationError[] = [];
            const warnings: ValidationWarning[] = [];

            // Validate required fields
            if (!problem.name) {
                errors.push({
                    field: 'name',
                    message: 'Problem name is required',
                    code: 'REQUIRED_FIELD',
                    severity: 'critical'
                });
            }

            if (!problem.description) {
                warnings.push({
                    field: 'description',
                    message: 'Problem description is recommended',
                    code: 'RECOMMENDED_FIELD'
                });
            }

            if (problem.testCases.length === 0) {
                errors.push({
                    field: 'testCases',
                    message: 'At least one test case is required',
                    code: 'REQUIRED_TEST_CASES',
                    severity: 'major'
                });
            }

            // Validate test cases
            for (let i = 0; i < problem.testCases.length; i++) {
                const testCase = problem.testCases[i];
                if (!testCase.input) {
                    errors.push({
                        field: `testCases[${i}].input`,
                        message: 'Test case input is required',
                        code: 'REQUIRED_TEST_INPUT',
                        severity: 'major'
                    });
                }

                if (!testCase.expectedOutput) {
                    errors.push({
                        field: `testCases[${i}].expectedOutput`,
                        message: 'Test case expected output is required',
                        code: 'REQUIRED_TEST_OUTPUT',
                        severity: 'major'
                    });
                }
            }

            // Validate constraints
            if (problem.constraints.timeLimit <= 0) {
                errors.push({
                    field: 'constraints.timeLimit',
                    message: 'Time limit must be positive',
                    code: 'INVALID_TIME_LIMIT',
                    severity: 'major'
                });
            }

            if (problem.constraints.memoryLimit <= 0) {
                errors.push({
                    field: 'constraints.memoryLimit',
                    message: 'Memory limit must be positive',
                    code: 'INVALID_MEMORY_LIMIT',
                    severity: 'major'
                });
            }

            const score = errors.length === 0 ? 100 : Math.max(0, 100 - (errors.length * 20));

            return {
                valid: errors.length === 0,
                errors,
                warnings,
                score
            };
        } catch (error) {
            this.logger.error('Failed to validate problem', error);
            throw error;
        }
    }

    async exportProblem(problemId: ID, format: 'json' | 'zip'): Promise<string | Buffer> {
        try {
            const problem = this.problems.get(problemId);
            if (!problem) {
                throw new Error(`Problem not found: ${problemId}`);
            }

            if (format === 'json') {
                return JSON.stringify(problem, null, 2);
            } else {
                // Create zip archive
                const archiver = require('archiver')('zip', { zlib: { level: 9 } });
                const buffers: Buffer[] = [];

                archiver.on('data', (chunk: Buffer) => buffers.push(chunk));
                archiver.on('end', () => {});

                // Add problem files to archive
                archiver.append(JSON.stringify(problem, null, 2), { name: 'problem.json' });
                archiver.append(problem.description, { name: 'statement.md' });
                archiver.append(JSON.stringify(problem.testCases, null, 2), { name: 'testCases.json' });

                await archiver.finalize();
                return Buffer.concat(buffers);
            }
        } catch (error) {
            this.logger.error(`Failed to export problem ${problemId}`, error);
            throw error;
        }
    }

    async importProblem(data: string | Buffer, format: 'json' | 'zip'): Promise<Problem> {
        try {
            let problemData: any;

            if (format === 'json') {
                problemData = JSON.parse(data as string);
            } else {
                // Extract from zip
                const unzipper = require('unzipper');
                const zip = await unzipper.Open.buffer(data as Buffer);
                const problemFile = zip.files.find((file: any) => file.path === 'problem.json');

                if (!problemFile) {
                    throw new Error('problem.json not found in archive');
                }

                const content = await problemFile.buffer();
                problemData = JSON.parse(content.toString());
            }

            // Generate new ID and directory
            const problemDir = path.join(this.config.basePath, problemData.name || `imported_${Date.now()}`);
            await this.fsHelper.createDirectory(problemDir);

            const problem: Problem = {
                ...problemData,
                id: this.generateId(),
                directory: problemDir,
                sourceFiles: await this.discoverSourceFiles(problemDir),
                configFiles: {
                    problem: path.join(problemDir, 'problem.json'),
                    statement: path.join(problemDir, 'statement.md'),
                    samples: path.join(problemDir, 'samples.json')
                },
                metadata: {
                    ...problemData.metadata,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    version: 1
                }
            };

            await this.saveProblemConfig(problem);
            this.problems.set(problem.id, problem);
            await this.emitProblemCreatedEvent(problem);

            this.logger.info(`Problem imported successfully: ${problem.id}`);
            return problem;
        } catch (error) {
            this.logger.error('Failed to import problem', error);
            throw error;
        }
    }

    async getProblemStats(problemId: ID): Promise<ProblemStats> {
        const problem = this.problems.get(problemId);
        if (!problem) {
            throw new Error(`Problem not found: ${problemId}`);
        }

        return problem.stats || await this.calculateProblemStats();
    }

    async searchProblems(query: string, options?: {
    fields?: ('name' | 'description' | 'tags' | 'source')[];
    limit?: number;
    fuzzy?: boolean;
  }): Promise<Problem[]> {
        const fields = options?.fields || ['name', 'description', 'tags'];
        const searchQuery = query.toLowerCase();
        const results: Problem[] = [];

        for (const problem of this.problems.values()) {
            let match = false;

            for (const field of fields) {
                let fieldValue: string;

                switch (field) {
                    case 'name':
                        fieldValue = problem.name.toLowerCase();
                        break;
                    case 'description':
                        fieldValue = problem.description.toLowerCase();
                        break;
                    case 'tags':
                        fieldValue = problem.metadata.tags.join(' ').toLowerCase();
                        break;
                    case 'source':
                        fieldValue = problem.source.platform?.toLowerCase() || '';
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
                results.push(problem);
            }
        }

        if (options?.limit) {
            return results.slice(0, options.limit);
        }

        return results;
    }

    async getProblemTemplates(problemId: ID): Promise<Record<ProgrammingLanguage, string>> {
        const problem = this.problems.get(problemId);
        if (!problem) {
            throw new Error(`Problem not found: ${problemId}`);
        }

        const templates: Record<ProgrammingLanguage, string> = {
            c: '',
            cpp: ''
        };

        for (const language of problem.languages) {
            templates[language] = await this.generateTemplate(problemId, language);
        }

        return templates;
    }

    async updateProblemTemplates(problemId: ID, templates: Record<ProgrammingLanguage, string>): Promise<void> {
        try {
            const problem = this.problems.get(problemId);
            if (!problem) {
                throw new Error(`Problem not found: ${problemId}`);
            }

            // Update templates
            for (const [language, template] of Object.entries(templates)) {
                const templateFile = path.join(problem.directory, `template.${language}`);
                await fs.writeFile(templateFile, template, 'utf-8');
            }

            // Update problem configuration
            problem.templates = Object.entries(templates).map(([language, code]) => ({
                language: language as ProgrammingLanguage,
                code,
                includes: [],
                mainFunction: true
            }));

            problem.metadata.updatedAt = new Date();
            problem.metadata.version++;

            await this.saveProblemConfig(problem);
            await this.emitProblemUpdatedEvent(problemId, problem);

            this.logger.info(`Problem templates updated successfully: ${problemId}`);
        } catch (error) {
            this.logger.error(`Failed to update problem templates ${problemId}`, error);
            throw error;
        }
    }

    async getRecentProblems(limit: number = 10): Promise<Problem[]> {
        const problems = Array.from(this.problems.values());

        return problems
            .sort((a, b) => {
                const aTime = a.stats?.lastUsed?.getTime() || a.metadata.createdAt.getTime();
                const bTime = b.stats?.lastUsed?.getTime() || b.metadata.createdAt.getTime();
                return bTime - aTime;
            })
            .slice(0, limit);
    }

    async getProblemDirectoryStructure(problemId: ID): Promise<{
    main: string;
    additional: string[];
    config: string[];
    test: string[];
  }> {
        const problem = this.problems.get(problemId);
        if (!problem) {
            throw new Error(`Problem not found: ${problemId}`);
        }

        const files = await this.fsHelper.listFiles(problem.directory, true);

        return {
            main: problem.sourceFiles.main,
            additional: problem.sourceFiles.additional || [],
            config: files.filter(f => f.endsWith('.json') || f.endsWith('.md')),
            test: files.filter(f => f.includes('test') || f.includes('sample'))
        };
    }

    private async saveProblemConfig(problem: Problem): Promise<void> {
        const configPath = problem.configFiles.problem;
        const configData: ProblemConfig = {
            id: problem.id,
            name: problem.name,
            description: problem.description,
            difficulty: problem.difficulty,
            source: problem.source,
            metadata: problem.metadata,
            constraints: problem.constraints,
            languages: problem.languages,
            samples: problem.samples,
            testCases: problem.testCases,
            templates: problem.templates,
            customFields: problem.customFields
        };

        await fs.writeFile(configPath, JSON.stringify(configData, null, 2), 'utf-8');
    }

    private async generateTemplateFiles(problem: Problem, language: ProgrammingLanguage): Promise<void> {
        const template = await this.generateTemplate(problem.id, language);
        const extension = language === 'c' ? '.c' : '.cpp';
        const templateFile = path.join(problem.directory, `template${extension}`);

        await fs.writeFile(templateFile, template, 'utf-8');
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
        this.logger.info('ProblemManager disposed');
    }
}
