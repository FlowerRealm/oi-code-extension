import { EventSystem, EventSystemManager } from './event-system';
import { ProblemManager, ProblemManagerAPI } from './problem-manager'; // eslint-disable-line
import { CompilerManager, CompilerManagerAPI } from './compiler-manager'; // eslint-disable-line
import { TestRunner, TestRunnerAPI } from './test-runner'; // eslint-disable-line
import {
    PairCheckManagerAPI,
    PairCheckSession,
    PairCheckOptions,
    PairCheckResult,
    PairCheckExecution,
    PairCheckStats,
    PairCheckConfig,
    PairCheckProgress,
    PairCheckSummary, // eslint-disable-line @typescript-eslint/no-unused-vars
    DiffResult
} from '../types/models';
import {
    PairCheckStartedEvent,
    PairCheckCompletedEvent,
    PairCheckBatchStartedEvent,
    PairCheckBatchCompletedEvent,
    PairCheckSessionCreatedEvent,
    PairCheckSessionEndedEvent,
    PairCheckErrorEvent
} from '../types/events';
import { Disposable } from '../types/models';
import { ID, ProgrammingLanguage, TestCase } from '../types/models';

/**
 * Pair Check Manager implementation
 * Manages pair check operations, comparing two implementations
 */
export class PairCheckManager implements PairCheckManagerAPI, Disposable {
    private static instance: PairCheckManager;
    private config: PairCheckConfig;
    private activeSessions: Map<string, PairCheckSession> = new Map();
    private disposables: Disposable[] = [];
    private eventSystem: EventSystem;
    private problemManager: ProblemManagerAPI;
    private compilerManager: CompilerManagerAPI;
    private testRunner: TestRunnerAPI;

    private constructor(
        problemManager: ProblemManagerAPI,
        compilerManager: CompilerManagerAPI,
        testRunner: TestRunnerAPI,
        config: Partial<PairCheckConfig> = {}
    ) {
        this.eventSystem = EventSystemManager.getInstance();
        this.problemManager = problemManager;
        this.compilerManager = compilerManager;
        this.testRunner = testRunner;
        this.config = this.mergeConfig(config);
    }

    static getInstance(
        problemManager?: ProblemManagerAPI,
        compilerManager?: CompilerManagerAPI,
        testRunner?: TestRunnerAPI,
        config?: Partial<PairCheckConfig>
    ): PairCheckManager {
        if (!PairCheckManager.instance) {
            if (!problemManager || !compilerManager || !testRunner) {
                throw new Error('ProblemManager, CompilerManager, and TestRunner are required for ' +
                    'first initialization');
            }
            PairCheckManager.instance = new PairCheckManager(problemManager, compilerManager, testRunner, config);
        }
        return PairCheckManager.instance;
    }

    private mergeConfig(config: Partial<PairCheckConfig>): PairCheckConfig {
        return {
            compareMode: config.compareMode || 'exact',
            tolerance: config.tolerance,
            customComparator: config.customComparator,
            showDiff: config.showDiff !== false,
            maxDiffLines: config.maxDiffLines || 100,
            ignoreBlankLines: config.ignoreBlankLines !== false,
            ignoreTrailingWhitespace: config.ignoreTrailingWhitespace !== false,
            ignoreLeadingWhitespace: config.ignoreLeadingWhitespace !== false,
            ignoreCase: config.ignoreCase,
            stopOnFirstError: config.stopOnFirstError !== false,
            customFilters: config.customFilters,
            defaultMode: config.defaultMode || 'single',
            defaultTimeout: config.defaultTimeout || 10000,
            defaultMemoryLimit: config.defaultMemoryLimit || 512,
            showDiffByDefault: config.showDiffByDefault !== false,
            continueOnErrorByDefault: config.continueOnErrorByDefault !== false,
            maxConcurrentTests: config.maxConcurrentTests || 4,
            maxConcurrentChecks: config.maxConcurrentChecks || 4,
            enableDetailedDiff: config.enableDetailedDiff !== false,
            enableVisualization: config.enableVisualization !== false,
            tempDirectory: config.tempDirectory || '/tmp/oi-code-paircheck',
            outputDirectory: config.outputDirectory || './paircheck-results',
            maxTestCases: config.maxTestCases || 100,
            enableMetrics: config.enableMetrics !== false,
            enableDiagnostics: config.enableDiagnostics !== false
        };
    }

    /**
   * Create a new pair check session
   */
    async createPairCheckSession(options: PairCheckOptions): Promise<PairCheckSession> {
        const sessionId = this.generateSessionId();
        const session: PairCheckSession = {
            id: sessionId,
            sourcePath1: options.sourcePath1 || '',
            sourcePath2: options.sourcePath2 || '',
            startTime: new Date(),
            status: 'running',
            options: options,
            results: [],
            problemId: options.problemId,
            name: options.name,
            createdAt: new Date(),
            executions: [],
            stats: this.initializeStats()
        };

        this.activeSessions.set(sessionId, session);

        // Emit session created event
        const event: PairCheckSessionCreatedEvent = {
            type: 'paircheck-session-created',
            timestamp: new Date(),
            sessionId,
            sourcePath1: options.sourcePath1 || '',
            sourcePath2: options.sourcePath2 || '',
            config: options
        };
        await this.eventSystem.emit(event);

        return session;
    }

    /**
   * Get a pair check session by ID
   */
    async getPairCheckSession(sessionId: string): Promise<PairCheckSession | undefined> {
        return this.activeSessions.get(sessionId);
    }

    /**
   * List active pair check sessions
   */
    async listPairCheckSessions(): Promise<PairCheckSession[]> {
        return Array.from(this.activeSessions.values());
    }

    /**
   * Execute pair check between two implementations
   */
    async executePairCheck(options: PairCheckOptions): Promise<PairCheckResult> {
        const sessionId = options.sessionId;
        const session = sessionId ? await this.getPairCheckSession(sessionId) : undefined;

        if (sessionId && !session) {
            throw new Error(`Pair check session not found: ${sessionId}`);
        }

        // Get problem if problemId is provided
        if (options.problemId) {
            const problem = await this.problemManager.getProblem(options.problemId);
            if (!problem) {
                throw new Error(`Problem not found: ${options.problemId}`);
            }
        }

        // Create pair check execution record
        const execution: PairCheckExecution = {
            id: this.generateExecutionId(),
            sessionId: sessionId || 'single',
            inputFile: options.inputFiles?.[0] || '',
            problemId: options.problemId,
            status: 'running',
            startTime: new Date(),
            bruteForceResults: [],
            optimizedResults: [],
            diffResults: []
        };

        if (session && session.executions) {
            session.executions.push(execution);
            session.status = 'running';
        }

        // Emit pair check started event
        const startEvent: PairCheckStartedEvent = {
            type: 'paircheck:started',
            timestamp: new Date(),
            pairCheckId: execution.id,
            sourcePath1: options.sourcePath1 || '',
            sourcePath2: options.sourcePath2 || ''
        };
        await this.eventSystem.emit(startEvent);

        try {
            // Execute the pair check
            const result = await this.performPairCheck(execution, options);

            // Update execution record
            execution.status = result.success ? 'completed' : 'failed';
            execution.endTime = new Date();
            execution.result = result;

            // Update session stats
            if (session) {
                this.updateSessionStats(session, execution);
            }

            // Emit pair check completed event
            const completeEvent: PairCheckCompletedEvent = {
                type: 'paircheck:completed',
                timestamp: new Date(),
                pairCheckId: execution.id,
                result: result
            };
            await this.eventSystem.emit(completeEvent);

            return result;
        } catch (error) {
            // Handle execution error
            const errorResult: PairCheckResult = {
                id: '',
                success: false,
                identical: false,
                result1: {
                    success: false,
                    exitCode: -1,
                    output: '',
                    error: error instanceof Error ? error.message : String(error),
                    executionTime: 0,
                    memoryUsage: 0,
                    cpuUsage: 0,
                    status: 'failed',
                    diagnostics: []
                },
                result2: {
                    success: false,
                    exitCode: -1,
                    output: '',
                    error: error instanceof Error ? error.message : String(error),
                    executionTime: 0,
                    memoryUsage: 0,
                    cpuUsage: 0,
                    status: 'failed',
                    diagnostics: []
                },
                differences: [],
                statistics: {
                    totalLines: 0,
                    diffLines: 0,
                    similarity: 0,
                    editDistance: 0
                },
                executionTime: 0,
                input: '',
                config: this.config,
                timestamp: new Date()
            };

            execution.status = 'failed';
            execution.endTime = new Date();
            execution.result = errorResult;

            // Emit pair check error event
            const errorEvent: PairCheckErrorEvent = {
                type: 'paircheck-error',
                timestamp: new Date(),
                sessionId: sessionId || 'single',
                error: error instanceof Error ? error.message : String(error)
            };
            await this.eventSystem.emit(errorEvent);

            return errorResult;
        }
    }

    /**
   * Execute batch pair check
   */
    async executeBatchPairCheck(options: {
    sessionId: string;
    problemId: ID;
    language: ProgrammingLanguage;
    bruteForceCode: string;
    optimizedCode: string;
    testCases: TestCase[];
    concurrency?: number;
    progressCallback?: (progress: PairCheckProgress) => void;
  }): Promise<PairCheckResult> {
        const session = await this.getPairCheckSession(options.sessionId);
        if (!session) {
            throw new Error(`Pair check session not found: ${options.sessionId}`);
        }

        const pairCheckOptions: PairCheckOptions = {
            sessionId: options.sessionId,
            problemId: options.problemId,
            language: options.language,
            bruteForceCode: options.bruteForceCode,
            optimizedCode: options.optimizedCode,
            testCases: options.testCases,
            timeout: this.config.defaultTimeout,
            memoryLimit: this.config.defaultMemoryLimit,
            mode: 'single'
        };

        // Emit batch started event
        const batchStartEvent: PairCheckBatchStartedEvent = {
            type: 'paircheck-batch-started',
            timestamp: new Date(),
            sessionId: options.sessionId,
            testCount: options.testCases.length,
            startTime: new Date()
        };
        await this.eventSystem.emit(batchStartEvent);

        try {
            // Execute pair check
            const result = await this.executePairCheck(pairCheckOptions);

            // Update session status
            session.status = 'completed';

            // Emit batch completed event
            const batchCompleteEvent: PairCheckBatchCompletedEvent = {
                type: 'paircheck-batch-completed',
                timestamp: new Date(),
                sessionId: options.sessionId,
                results: [result],
                endTime: new Date(),
                duration: 0
            };
            await this.eventSystem.emit(batchCompleteEvent);

            return result;
        } catch (error) {
            session.status = 'failed';

            throw error;
        }
    }

    /**
   * Generate test cases for pair check
   */
    async generateTestCases(options: {
    problemId: ID;
    count?: number;
    difficulty?: 'easy' | 'medium' | 'hard';
    seed?: number;
  }): Promise<TestCase[]> {
        const problem = await this.problemManager.getProblem(options.problemId);
        if (!problem) {
            throw new Error(`Problem not found: ${options.problemId}`);
        }

        // This is a placeholder for test case generation
        // In a real implementation, this would use various strategies:
        // - Random generation within constraints
        // - Edge case generation
        // - Pattern-based generation
        // - Fuzz testing

        const count = options.count || 10;
        const testCases: TestCase[] = [];

        for (let i = 0; i < count; i++) {
            const testCase: TestCase = {
                id: this.generateTestCaseId(),
                name: `Generated Test Case ${i + 1}`,
                input: `Generated input ${i + 1}`,
                expectedOutput: `Expected output ${i + 1}`,
                description: `Generated test case ${i + 1}`,
                type: 'normal',
                isPrivate: false,
                timeout: this.config.defaultTimeout,
                memoryLimit: this.config.defaultMemoryLimit,
                metadata: {
                    createdAt: new Date(),
                    updatedAt: new Date()
                }
            };
            testCases.push(testCase);
        }

        return testCases;
    }

    /**
   * Cancel a pair check session
   */
    async cancelPairCheckSession(sessionId: string): Promise<void> {
        const session = this.activeSessions.get(sessionId);
        if (!session) {
            throw new Error(`Pair check session not found: ${sessionId}`);
        }

        session.status = 'stopped';

        // Mark running executions as cancelled
        if (session.executions) {
            session.executions
                .filter(exec => exec.status === 'running')
                .forEach(exec => {
                    exec.status = 'failed';
                    exec.endTime = new Date();
                });
        }

        // Emit session ended event
        const event: PairCheckSessionEndedEvent = {
            type: 'paircheck-session-ended',
            timestamp: new Date(),
            sessionId,
            reason: 'cancelled',
            endTime: new Date()
        };
        await this.eventSystem.emit(event);
    }

    /**
   * Get pair check session statistics
   */
    async getPairCheckSessionStats(sessionId: string): Promise<PairCheckStats> {
        const session = this.activeSessions.get(sessionId);
        if (!session) {
            throw new Error(`Pair check session not found: ${sessionId}`);
        }

        return session.stats;
    }

    /**
   * Get pair check configuration
   */
    async getPairCheckConfig(): Promise<PairCheckConfig> {
        return { ...this.config };
    }

    /**
   * Update pair check configuration
   */
    async updatePairCheckConfig(config: Partial<PairCheckConfig>): Promise<void> {
        this.config = this.mergeConfig(config);
    }

    /**
   * Start pair check session
   */
    async startPairCheck(options: PairCheckOptions): Promise<PairCheckSession> {
        return await this.createPairCheckSession(options);
    }

    /**
   * Stop pair check session
   */
    async stopPairCheck(sessionId: string): Promise<void> {
        await this.cancelPairCheckSession(sessionId);
    }

    /**
   * Get pair check status
   */
    async getStatus(sessionId: string): Promise<PairCheckProgress> {
        const session = await this.getPairCheckSession(sessionId);
        if (!session) {
            throw new Error(`Session not found: ${sessionId}`);
        }
        return {
            sessionId,
            current: (session.stats?.passedTests || 0) + (session.stats?.failedTests || 0),
            total: session.stats?.totalTests || 0,
            status: session.status,
            message: session.status === 'failed' ? 'Error occurred' : undefined
        };
    }

    /**
   * Get pair check results
   */
    async getResults(sessionId: string): Promise<PairCheckResult[]> {
        const session = await this.getPairCheckSession(sessionId);
        if (!session) {
            throw new Error(`Session not found: ${sessionId}`);
        }
        return session.executions?.map(exec => exec.result).filter(result => result !== undefined) || [];
    }

    /**
   * Clean up pair check sessions
   */
    async cleanupPairCheckSessions(options?: { olderThan?: Date; status?: string[] }): Promise<void> {
        const sessionsToRemove: string[] = [];

        for (const [sessionId, session] of this.activeSessions) {
            let shouldRemove = false;

            if (options?.olderThan && session.createdAt && session.createdAt < options.olderThan) {
                shouldRemove = true;
            }

            if (options?.status && options.status.includes(session.status)) {
                shouldRemove = true;
            }

            if (shouldRemove) {
                sessionsToRemove.push(sessionId);
            }
        }

        sessionsToRemove.forEach(sessionId => {
            this.activeSessions.delete(sessionId);
        });
    }

    /**
   * Generate diff visualization data
   */
    async generateDiffVisualization(diffResults: DiffResult[]): Promise<any> {
        if (!this.config.enableVisualization) {
            throw new Error('Visualization is not enabled');
        }

        // This is a placeholder for diff visualization generation
        // In a real implementation, this would create:
        // - HTML diff views
        // - Side-by-side comparisons
        // - Highlighted differences
        // - Statistical charts

        return {
            type: 'diff-visualization',
            data: diffResults,
            generated: new Date()
        };
    }

    /**
   * Export pair check results
   */
    async exportPairCheckResults(sessionId: string, format: 'json' | 'csv' | 'html'): Promise< string> {
        const session = this.activeSessions.get(sessionId);
        if (!session) {
            throw new Error(`Pair check session not found: ${sessionId}`);
        }

        switch (format) {
            case 'json':
                return JSON.stringify(session, null, 2);

            case 'csv':
                return this.exportToCsv(session);

            case 'html':
                return this.exportToHtml(session);

            default:
                throw new Error(`Unsupported export format: ${format}`);
        }
    }

    /**
   * Dispose of resources
   */
    dispose(): void {
        this.disposables.forEach(disposable => disposable.dispose());
        this.disposables = [];
        this.activeSessions.clear();
    }

    // Private helper methods

    private generateSessionId(): string {
        return `paircheck_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    private generatePairCheckId(): string {
        return `paircheck_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    private generateExecutionId(): string {
        return `paircheck_exec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    private generateTestCaseId(): string {
        return `testcase_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    private initializeStats(): PairCheckStats {
        return {
            totalTests: 0,
            passedTests: 0,
            failedTests: 0,
            averageExecutionTime: 0,
            totalExecutionTime: 0,
            memoryUsage: 0
        };
    }

    private async performPairCheck(
        execution: PairCheckExecution,
        options: PairCheckOptions
    ): Promise<PairCheckResult> {
        const startTime = Date.now();
        const bruteForceResults: any[] = [];
        const optimizedResults: any[] = [];
        const diffResults: DiffResult[] = [];

        try {
            const testCases = options.testCases || [];
            const concurrency = Math.min(4, testCases.length);

            // Execute both implementations on each test case
            for (let i = 0; i < testCases.length; i += concurrency) {
                const batch = testCases.slice(i, i + concurrency);
                const batchPromises = batch.map(async (testCase) => {
                    // Execute brute force implementation
                    const bruteForceResult = await this.executeImplementation(
                        execution.bruteForceCode || '',
                        testCase,
            (options.language || 'cpp') as ProgrammingLanguage,
            'brute-force'
                    );

                    // Execute optimized implementation
                    const optimizedResult = await this.executeImplementation(
                        execution.optimizedCode || '',
                        testCase,
            (options.language || 'cpp') as ProgrammingLanguage,
            'optimized'
                    );

                    // Compare results
                    const diffResult = this.compareResults(bruteForceResult, optimizedResult);

                    bruteForceResults.push(bruteForceResult);
                    optimizedResults.push(optimizedResult);
                    diffResults.push(diffResult);

                    // Report progress
                    if (options.progressCallback) {
                        options.progressCallback({
                            completed: i + batch.indexOf(testCase) + 1,
                            total: testCases.length,
                            currentTestCase: testCase.id,
                            bruteForceResult,
                            optimizedResult,
                            diffResult
                        });
                    }

                    return { bruteForceResult, optimizedResult, diffResult };
                });

                await Promise.all(batchPromises);
            }

            // Calculate summary statistics
            const summary = this.calculatePairCheckSummary(bruteForceResults, optimizedResults);

            // Create a simplified PairCheckResult for batch execution
            const batchResult: PairCheckResult = {
                id: this.generatePairCheckId(),
                success: true,
                identical: summary.failedTests === 0,
                result1: {
                    success: true,
                    exitCode: 0,
                    signal: undefined,
                    output: 'Batch execution completed',
                    error: '',
                    executionTime: Date.now() - startTime,
                    memoryUsage: 0,
                    cpuUsage: 0,
                    status: 'completed',
                    diagnostics: []
                },
                result2: {
                    success: true,
                    exitCode: 0,
                    signal: undefined,
                    output: 'Batch execution completed',
                    error: '',
                    executionTime: Date.now() - startTime,
                    memoryUsage: 0,
                    cpuUsage: 0,
                    status: 'completed',
                    diagnostics: []
                },
                differences: diffResults,
                statistics: {
                    totalLines: 0,
                    diffLines: 0,
                    similarity: summary.failedTests === 0 ? 1 : 0,
                    editDistance: 0
                },
                executionTime: Date.now() - startTime,
                input: 'batch execution',
                config: this.config,
                timestamp: new Date(),
                metadata: {
                    batchId: execution.id,
                    testId: 'batch'
                }
            };

            return batchResult;
        } catch (error) {
            const errorResult: PairCheckResult = {
                id: this.generatePairCheckId(),
                success: false,
                identical: false,
                result1: {
                    success: false,
                    exitCode: 1,
                    signal: undefined,
                    output: '',
                    error: error instanceof Error ? error.message : String(error),
                    executionTime: Date.now() - startTime,
                    memoryUsage: 0,
                    cpuUsage: 0,
                    status: 'failed',
                    diagnostics: []
                },
                result2: {
                    success: false,
                    exitCode: 1,
                    signal: undefined,
                    output: '',
                    error: error instanceof Error ? error.message : String(error),
                    executionTime: Date.now() - startTime,
                    memoryUsage: 0,
                    cpuUsage: 0,
                    status: 'failed',
                    diagnostics: []
                },
                differences: [],
                statistics: {
                    totalLines: 0,
                    diffLines: 0,
                    similarity: 0,
                    editDistance: 0
                },
                executionTime: Date.now() - startTime,
                input: 'batch execution',
                config: this.config,
                timestamp: new Date(),
                metadata: {
                    batchId: execution.id,
                    testId: 'batch'
                }
            };

            return errorResult;
        }
    }

    private async executeImplementation(
        code: string,
        testCase: TestCase,
        language: ProgrammingLanguage,
        implementationType: 'brute-force' | 'optimized'
    ): Promise<any> {
    // This is a placeholder for actual implementation execution
    // In a real implementation, this would:
    // 1. Compile the code
    // 2. Run with test case input
    // 3. Collect output and metrics
    // 4. Handle timeouts and errors

        await new Promise(resolve => setTimeout(resolve, 100 + Math.random() * 200));

        return {
            testCaseId: testCase.id,
            output: `Output for ${testCase.id}`,
            executionTime: Math.floor(Math.random() * 1000) + 100,
            memoryUsage: Math.floor(Math.random() * 100) + 50,
            success: true,
            implementationType
        };
    }

    private compareResults(
        bruteForceResult: any,
        optimizedResult: any
    ): any {
        const output1 = bruteForceResult.output || '';
        const output2 = optimizedResult.output || '';
        const outputMatches = output1 === output2;

        return {
            hasDifferences: !outputMatches,
            differences: outputMatches ? [] : [{
                type: 'modification',
                content1: output1,
                content2: output2
            }],
            output1,
            output2
        };
    }

    private calculatePairCheckSummary(
        bruteForceResults: any[],
        optimizedResults: any[]
    ): any {
        const totalTests = bruteForceResults.length;
        const passedTests = bruteForceResults.filter((_, i) =>
            bruteForceResults[i].output === optimizedResults[i].output
        ).length;
        const failedTests = totalTests - passedTests;

        const totalBruteForceTime = bruteForceResults.reduce((sum, r) => sum + r.executionTime, 0);
        const totalOptimizedTime = optimizedResults.reduce((sum, r) => sum + r.executionTime, 0);
        const totalExecutionTime = totalBruteForceTime + totalOptimizedTime;
        const averageExecutionTime = totalTests > 0 ? totalExecutionTime / (totalTests * 2) : 0;

        return {
            totalTests,
            passedTests,
            failedTests,
            averageExecutionTime,
            totalExecutionTime
        };
    }

    private updateSessionStats(session: PairCheckSession, execution: PairCheckExecution): void {
        if (!execution.result) return;

        session.stats.totalChecks++;

        if (execution.result.success) {
            session.stats.passedChecks++;
        } else {
            session.stats.failedChecks++;
        }

        // Update execution time stats
        if (execution.result.executionTime) {
            session.stats.totalExecutionTime += execution.result.executionTime;
            session.stats.averageExecutionTime = session.stats.totalExecutionTime / session.stats.totalChecks;
        }

        // Track individual implementation times (simplified for current PairCheckResult structure)
        if (execution.result.executionTime) {
            session.stats.totalBruteForceTime += execution.result.executionTime / 2;
            session.stats.totalOptimizedTime += execution.result.executionTime / 2;
        }

        // Update memory usage stats (simplified)
        session.stats.maxMemoryUsage = Math.max(session.stats.maxMemoryUsage,
            execution.result.result1.memoryUsage, execution.result.result2.memoryUsage);

        if (execution.language) {
            session.stats.languagesUsed.add(execution.language);
        }
    }

    private exportToCsv(session: PairCheckSession): string {
    // This is a placeholder for CSV export
        const headers = ['Execution ID', 'Status', 'Start Time', 'End Time', 'Problem ID', 'Language'];
        const rows = (session.executions || []).map(exec => [
            exec.id,
            exec.status,
            exec.startTime.toISOString(),
            exec.endTime?.toISOString() || '',
            exec.problemId,
            exec.language
        ]);

        return [headers, ...rows].map(row => row.join(',')).join('\n');
    }

    private exportToHtml(session: PairCheckSession): string {
    // This is a placeholder for HTML export
        return `
<!DOCTYPE html>
<html>
<head>
    <title>Pair Check Results - ${session.name}</title>
</head>
<body>
    <h1>Pair Check Results</h1>
    <h2>${session.name}</h2>
    <p>Problem ID: ${session.problemId}</p>
    <p>Status: ${session.status}</p>
    <p>Created: ${session.createdAt?.toISOString() || 'Unknown'}</p>
    <p>Total Executions: ${(session.executions || []).length}</p>
</body>
</html>
    `;
    }
}
