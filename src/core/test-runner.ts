import { EventSystem, EventSystemManager } from './event-system';
import { ProblemManager, ProblemManagerAPI } from './problem-manager'; // eslint-disable-line
import { CompilerManager, CompilerManagerAPI } from './compiler-manager'; // eslint-disable-line
import {
    TestRunnerAPI,
    TestSession,
    TestExecutionOptions,
    TestExecutionResult,
    TestBatchOptions,
    TestBatchResult,
    TestCaseExecution,
    TestSessionStats,
    TestRunnerConfig,
    TestExecutionMode,
    FilterOptions
} from '../types/models';
import {
    TestStartedEvent,
    TestCompletedEvent,
    TestSessionCreatedEvent,
    TestErrorEvent,
    TestBatchStartedEvent,
    TestBatchCompletedEvent
} from '../types/models';
import { Disposable } from '../types/models';
import { ID, TestCase } from '../types/models';

/**
 * Test Runner implementation
 * Manages test execution, sessions, and batch operations
 */
export class TestRunner implements TestRunnerAPI, Disposable {
    private static instance: TestRunner;
    private config: TestRunnerConfig;
    private activeSessions: Map<string, TestSession> = new Map();
    private disposables: Disposable[] = [];
    private eventSystem: EventSystem;
    private problemManager: ProblemManagerAPI;
    private compilerManager: CompilerManagerAPI;

    private constructor(
        problemManager: ProblemManagerAPI,
        compilerManager: CompilerManagerAPI,
        config: Partial<TestRunnerConfig> = {}
    ) {
        this.eventSystem = EventSystemManager.getInstance();
        this.problemManager = problemManager;
        this.compilerManager = compilerManager;
        this.config = this.mergeConfig(config);
    }

    static getInstance(
        problemManager?: ProblemManagerAPI,
        compilerManager?: CompilerManagerAPI,
        config?: Partial<TestRunnerConfig>
    ): TestRunner {
        if (!TestRunner.instance) {
            if (!problemManager || !compilerManager) {
                throw new Error('ProblemManager and CompilerManager are required for first initialization');
            }
            TestRunner.instance = new TestRunner(problemManager, compilerManager, config);
        }
        return TestRunner.instance;
    }

    private mergeConfig(config: Partial<TestRunnerConfig>): TestRunnerConfig {
        return {
            maxConcurrentTests: config.maxConcurrentTests || 4,
            defaultTimeout: config.defaultTimeout || 5000,
            defaultMemoryLimit: config.defaultMemoryLimit || 512,
            enableCaching: config.enableCaching !== false,
            enableProfiling: config.enableProfiling || false,
            tempDirectory: config.tempDirectory || '/tmp/oi-code-tests',
            enableDiagnostics: config.enableDiagnostics !== false,
            enableMetrics: config.enableMetrics !== false,
            outputDirectory: config.outputDirectory || './test-results'
        };
    }

    /**
   * Create a new test session
   */
    async createTestSession(options: {
    problemId: ID;
    mode: TestExecutionMode;
    name?: string;
    testFilter?: FilterOptions;
  }): Promise<TestSession> {
        const problem = await this.problemManager.getProblem(options.problemId);
        if (!problem) {
            throw new Error(`Problem not found: ${options.problemId}`);
        }

        const sessionId = this.generateSessionId();
        const session: TestSession = {
            id: sessionId,
            problemId: options.problemId,
            mode: options.mode,
            name: options.name || `Test Session ${new Date().toISOString()}`,
            status: 'created',
            createdAt: new Date(),
            testFilter: options.testFilter,
            executions: [],
            stats: this.initializeStats()
        };

        this.activeSessions.set(sessionId, session);

        // Emit session created event
        const event: TestSessionCreatedEvent = {
            type: 'test:session:created',
            timestamp: new Date(),
            sessionId,
            problemId: options.problemId,
            mode: options.mode,
            name: session.name
        };
        await this.eventSystem.emit(event);

        return session;
    }

    /**
   * Get a test session by ID
   */
    async getTestSession(sessionId: string): Promise<TestSession | undefined> {
        return this.activeSessions.get(sessionId);
    }

    /**
   * List active test sessions
   */
    async listTestSessions(): Promise<TestSession[]> {
        return Array.from(this.activeSessions.values());
    }

    /**
   * Execute a single test case
   */
    async executeTest(options: TestExecutionOptions): Promise<TestExecutionResult> {
        const sessionId = options.sessionId;
        const session = sessionId ? await this.getTestSession(sessionId) : undefined;

        if (sessionId && !session) {
            throw new Error(`Test session not found: ${sessionId}`);
        }

        // Get problem and compiler
        const problem = await this.problemManager.getProblem(options.problemId);
        if (!problem) {
            throw new Error(`Problem not found: ${options.problemId}`);
        }

        const compiler = await this.compilerManager.getSuitableCompiler(options.language);
        if (!compiler) {
            throw new Error(`No suitable compiler found for: ${options.language}`);
        }

        // Create test execution record
        const execution: TestCaseExecution = {
            id: this.generateExecutionId(),
            sessionId: sessionId || 'single',
            testCaseId: options.testCaseId,
            problemId: options.problemId,
            language: options.language,
            compilerId: compiler.path,
            status: 'running',
            startTime: new Date(),
            options
        };

        if (session) {
            session.executions.push(execution);
            session.status = 'running';
        }

        // Emit test started event
        const startEvent: TestStartedEvent = {
            type: 'test:started',
            timestamp: new Date(),
            testId: execution.id,
            problemId: options.problemId,
            sourcePath: options.sourcePath || ''
        };
        await this.eventSystem.emit(startEvent);

        try {
            // Execute the test
            const result = await this.performTestExecution(execution, compiler, options);

            // Update execution record
            execution.status = result.success ? 'passed' : 'failed';
            execution.endTime = new Date();
            execution.result = result;

            // Update session stats
            if (session) {
                this.updateSessionStats(session, execution);
            }

            // Emit test completed event
            const completeEvent: TestCompletedEvent = {
                type: 'test:completed',
                timestamp: new Date(),
                testId: execution.id,
                result: {
                    id: execution.id,
                    testCase: { id: options.testCaseId } as TestCase,
                    execution: {
                        success: result.success,
                        exitCode: 0,
                        output: result.output || '',
                        error: result.error || '',
                        executionTime: result.executionTime,
                        memoryUsage: result.memoryUsage,
                        cpuUsage: 0,
                        status: 'completed',
                        diagnostics: []
                    },
                    success: result.success,
                    timestamp: new Date(),
                    metadata: {
                        problemId: options.problemId,
                        sourceFile: options.sourcePath,
                        compiler: compiler.path
                    }
                }
            };
            await this.eventSystem.emit(completeEvent);

            return result;
        } catch (error) {
            // Handle execution error
            const errorResult: TestExecutionResult = {
                success: false,
                testCaseId: options.testCaseId,
                error: error instanceof Error ? error.message : String(error),
                executionTime: 0,
                memoryUsage: 0,
                timestamp: new Date()
            };

            execution.status = 'error';
            execution.endTime = new Date();
            execution.result = errorResult;

            // Emit test error event
            const errorEvent: TestErrorEvent = {
                type: 'test:error',
                timestamp: new Date(),
                sessionId: sessionId || 'single',
                executionId: execution.id,
                testCaseId: options.testCaseId,
                problemId: options.problemId,
                error: error instanceof Error ? error.message : String(error)
            };
            await this.eventSystem.emit(errorEvent);

            return errorResult;
        }
    }

    /**
   * Execute batch tests
   */
    async executeBatchTests(options: TestBatchOptions): Promise<TestBatchResult> {
        const session = await this.createTestSession({
            problemId: options.problemId,
            mode: 'batch',
            name: options.name
        });

        const batchResult: TestBatchResult = {
            sessionId: session.id,
            problemId: options.problemId,
            startTime: new Date(),
            status: 'running',
            results: [],
            summary: this.initializeBatchSummary()
        };

        // Emit batch started event
        const batchStartEvent: TestBatchStartedEvent = {
            type: 'test:batch:started',
            timestamp: new Date(),
            sessionId: session.id,
            problemId: options.problemId,
            testCases: options.testCases?.map(tc => tc.id) || []
        };
        await this.eventSystem.emit(batchStartEvent);

        try {
            // Get test cases to execute
            const testCases = options.testCases || [];
            const totalTests = testCases.length;

            // Execute tests in parallel with concurrency limit
            const concurrency = Math.min(options.concurrency || this.config.maxConcurrentTests, totalTests);
            const results: TestExecutionResult[] = [];

            for (let i = 0; i < testCases.length; i += concurrency) {
                const batch = testCases.slice(i, i + concurrency);
                const batchPromises = batch.map(async (testCase: TestCase) => {
                    const result = await this.executeTest({
                        sessionId: session.id,
                        problemId: options.problemId,
                        testCaseId: testCase.id,
                        language: options.language,
                        code: options.code,
                        options: options.options
                    });

                    // Update progress
                    if (options.progressCallback) {
                        options.progressCallback({
                            completed: i + batch.indexOf(testCase) + 1,
                            total: totalTests,
                            current: testCase.id,
                            result
                        });
                    }

                    return result;
                });

                const batchResults = await Promise.all(batchPromises);
                results.push(...batchResults);
            }

            // Update batch result
            batchResult.results = results;
            batchResult.endTime = new Date();
            batchResult.status = 'completed';
            batchResult.summary = this.calculateBatchSummary(results);

            // Update session
            session.status = 'completed';
            session.endTime = new Date();

            // Emit batch completed event
            const batchCompleteEvent: TestBatchCompletedEvent = {
                type: 'test:batch:completed',
                timestamp: new Date(),
                sessionId: session.id,
                problemId: options.problemId,
                results: results,
                summary: batchResult.summary
            };
            await this.eventSystem.emit(batchCompleteEvent);

            return batchResult;
        } catch (error) {
            batchResult.status = 'failed';
            batchResult.endTime = new Date();
            batchResult.error = error instanceof Error ? error.message : String(error);

            session.status = 'error';
            session.endTime = new Date();

            throw error;
        }
    }

    /**
   * Cancel a test session
   */
    async cancelTestSession(sessionId: string): Promise<void> {
        const session = this.activeSessions.get(sessionId);
        if (!session) {
            throw new Error(`Test session not found: ${sessionId}`);
        }

        session.status = 'cancelled';

        // Mark running executions as cancelled
        if (session.executions) {
            session.executions
                .filter((exec: TestCaseExecution) => exec.status === 'running')
                .forEach((exec: TestCaseExecution) => {
                    exec.status = 'cancelled';
                    exec.endTime = new Date();
                });
        }
    }

    /**
   * Get test session statistics
   */
    async getTestSessionStats(sessionId: string): Promise<TestSessionStats> {
        const session = this.activeSessions.get(sessionId);
        if (!session) {
            throw new Error(`Test session not found: ${sessionId}`);
        }

        return session.stats;
    }

    /**
   * Get test runner configuration
   */
    async getTestRunnerConfig(): Promise<TestRunnerConfig> {
        return { ...this.config };
    }

    /**
   * Update test runner configuration
   */
    async updateTestRunnerConfig(config: Partial<TestRunnerConfig>): Promise<void> {
        this.config = this.mergeConfig(config);
    }

    /**
   * Clean up test sessions
   */
    async cleanupTestSessions(options?: { olderThan?: Date; status?: string[] }): Promise<void> {
        const sessionsToRemove: string[] = [];

        for (const [sessionId, session] of this.activeSessions) {
            let shouldRemove = false;

            if (options?.olderThan && session.createdAt < options.olderThan) {
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
   * Dispose of resources
   */
    dispose(): void {
        this.disposables.forEach(disposable => disposable.dispose());
        this.disposables = [];
        this.activeSessions.clear();
    }

    // Private helper methods

    private generateSessionId(): string {
        return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    private generateExecutionId(): string {
        return `exec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    private initializeStats(): TestSessionStats {
        return {
            totalTests: 0,
            passedTests: 0,
            failedTests: 0,
            errorTests: 0,
            averageExecutionTime: 0,
            totalExecutionTime: 0,
            maxMemoryUsage: 0,
            averageMemoryUsage: 0,
            startTime: new Date(),
            compilersUsed: new Set(),
            languagesUsed: new Set()
        };
    }

    private initializeBatchSummary() {
        return {
            total: 0,
            passed: 0,
            failed: 0,
            error: 0,
            executionTime: 0,
            averageExecutionTime: 0,
            memoryUsage: 0,
            averageMemoryUsage: 0
        };
    }

    private async performTestExecution(
        execution: TestCaseExecution,
        compiler: any,
        options: TestExecutionOptions
    ): Promise<TestExecutionResult> {
    // This is a placeholder for actual test execution
    // In a real implementation, this would:
    // 1. Compile the code
    // 2. Run the test with input/output comparison
    // 3. Collect execution metrics
    // 4. Handle timeouts and memory limits

        const startTime = Date.now();

        try {
            // Simulate test execution
            await new Promise(resolve => setTimeout(resolve, 100));

            const executionTime = Date.now() - startTime;

            return {
                success: true,
                testCaseId: options.testCaseId,
                output: 'Test execution successful',
                expectedOutput: 'Expected output',
                executionTime,
                memoryUsage: Math.floor(Math.random() * 100) + 50,
                timestamp: new Date()
            };
        } catch (error) {
            return {
                success: false,
                testCaseId: options.testCaseId,
                error: error instanceof Error ? error.message : String(error),
                executionTime: Date.now() - startTime,
                memoryUsage: 0,
                timestamp: new Date()
            };
        }
    }

    private updateSessionStats(session: TestSession, execution: TestCaseExecution): void {
        if (!execution.result) return;

        session.stats.totalTests++;

        if (execution.result.success) {
            session.stats.passedTests++;
        } else {
            session.stats.failedTests++;
        }

        if (execution.status === 'error') {
            session.stats.errorTests++;
        }

        // Update execution time stats
        if (execution.result.executionTime) {
            session.stats.totalExecutionTime += execution.result.executionTime;
            session.stats.averageExecutionTime = session.stats.totalExecutionTime / session.stats.totalTests;
        }

        // Update memory usage stats
        if (execution.result.memoryUsage) {
            session.stats.maxMemoryUsage = Math.max(session.stats.maxMemoryUsage, execution.result.memoryUsage);
            session.stats.averageMemoryUsage =
                    (session.stats.averageMemoryUsage * (session.stats.totalTests - 1) +
                    execution.result.memoryUsage) / session.stats.totalTests;
        }

        // Track compilers and languages
        if (execution.compilerId) {
            session.stats.compilersUsed.add(execution.compilerId);
        }
        session.stats.languagesUsed.add(execution.language);
    }

    private calculateBatchSummary(results: TestExecutionResult[]): any {
        const summary = this.initializeBatchSummary();
        summary.total = results.length;

        results.forEach(result => {
            if (result.success) {
                summary.passed++;
            } else {
                summary.failed++;
            }

            if (result.error) {
                summary.error++;
            }

            if (result.executionTime) {
                summary.executionTime += result.executionTime;
            }

            if (result.memoryUsage) {
                summary.memoryUsage += result.memoryUsage;
            }
        });

        summary.averageExecutionTime = summary.total > 0 ? summary.executionTime / summary.total : 0;
        summary.averageMemoryUsage = summary.total > 0 ? summary.memoryUsage / summary.total : 0;

        return summary;
    }

    /**
   * Run test (API implementation)
   */
    async runTest(testConfig: any): Promise<any> {
        return this.executeTest(testConfig);
    }

    /**
   * Run batch tests (API implementation)
   */
    async runBatchTests(testConfigs: any[]): Promise<any[]> {
        const results: any[] = [];

        for (const config of testConfigs) {
            try {
                const result = await this.executeTest(config);
                results.push(result);
            } catch (error) {
                results.push({
                    success: false,
                    error: error instanceof Error ? error.message : String(error)
                });
            }
        }

        return results;
    }

    /**
   * Get test results (API implementation)
   */
    async getTestResults(testId: string): Promise<any[]> {
        const results: any[] = [];

        for (const session of this.activeSessions.values()) {
            if (session.executions) {
                for (const execution of session.executions) {
                    if (execution.testId === testId && execution.result) {
                        results.push(execution.result);
                    }
                }
            }
        }

        return results;
    }
}

// Export TestRunner as TestRunnerAPI for backward compatibility
export { TestRunner as TestRunnerAPI };
