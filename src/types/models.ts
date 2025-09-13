/* ---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *-------------------------------------------------------------------------------------------- */

/**
 * OI-Code Extension Core Data Models
 *
 * This file defines the core data models and interfaces used throughout the extension.
 * All models are designed with type safety, extensibility, and validation in mind.
 */

/**
 * Unique identifier type
 */
export type ID = string;

/**
 * Difficulty levels for problems
 */
export type Difficulty = 'easy' | 'medium' | 'hard';

/**
 * Test case types
 */
export type TestCaseType = 'sample' | 'normal' | 'boundary' | 'stress';

/**
 * Programming languages supported
 */
export type ProgrammingLanguage = 'c' | 'cpp';

/**
 * Compilation optimization levels
 */
export type OptimizationLevel = 'O0' | 'O1' | 'O2' | 'O3';

/**
 * Language standards
 */
export type LanguageStandard =
  | 'c11' | 'c99'
  | 'c++11' | 'c++14' | 'c++17' | 'c++20' | 'c++23';

/**
 * Execution status types
 */
export type ExecutionStatus = 'completed' | 'timeout' | 'memory_exceeded' | 'runtime_error' | 'failed';

/**
 * Comparison modes for pair checking
 */
export type ComparisonMode = 'exact' | 'ignore-space' | 'numeric' | 'custom';

/**
 * Diff types
 */
export type DiffType = 'added' | 'removed' | 'modified';

/**
 * Severity levels for diagnostics
 */
export type DiagnosticSeverity = 'error' | 'warning' | 'info';

/**
 * Problem difficulty levels with metadata
 */
export interface DifficultyInfo {
  level: Difficulty;
  color: string;
  description: string;
}

/**
 * Problem source information
 */
export interface ProblemSource {
  platform?: string;
  url?: string;
  contest?: string;
  problemId?: string;
}

/**
 * Problem metadata
 */
export interface ProblemMetadata {
  createdAt: Date;
  updatedAt: Date;
  version: number;
  author?: string;
  tags: string[];
  rating?: number;
}

/**
 * Problem constraints
 */
export interface ProblemConstraints {
  timeLimit: number;           // seconds
  memoryLimit: number;          // MB
  stackLimit?: number;          // KB
  outputLimit?: number;         // KB
  inputFileSize?: number;       // KB
  outputFileSize?: number;      // KB
  testCases?: {
    count: number;
    timeMultiplier?: number;
  };
}

/**
 * Test case definition
 */
export interface TestCase {
  id: ID;
  name: string;
  input: string;
  expectedOutput: string;
  description?: string;
  type: TestCaseType;
  isPrivate: boolean;
  timeout?: number;
  memoryLimit?: number;
  metadata: {
    createdAt: Date;
    updatedAt: Date;
    author?: string;
  };
}

/**
 * Code template for different languages
 */
export interface CodeTemplate {
  language: ProgrammingLanguage;
  fileName?: string;
  code: string;
  includes: string[];
  mainFunction: boolean;
  description?: string;
  variables?: Record<string, string>;
}

/**
 * Problem configuration
 */
export interface ProblemConfig {
  id: ID;
  name: string;
  description: string;
  difficulty: Difficulty;
  source: ProblemSource;
  metadata: ProblemMetadata;
  constraints: ProblemConstraints;
  languages: ProgrammingLanguage[];
  samples: TestCase[];
  testCases: TestCase[];
  templates: CodeTemplate[];
  customFields?: Record<string, unknown>;
}

/**
 * Enhanced problem interface
 */
export interface Problem extends ProblemConfig {
  directory: string;
  sourceFiles: {
    main: string;
    additional?: string[];
  };
  configFiles: {
    problem: string;
    statement: string;
    samples: string;
  };
  stats?: ProblemStats;
}

/**
 * Problem statistics
 */
export interface ProblemStats {
  testCases: number;
  successRate: number;
  averageTime: number;
  averageMemory: number;
  lastUsed: Date;
  runCount: number;
  passCount: number;
}

/**
 * Compiler information
 */
export interface CompilerInfo {
  path: string;
  name: string;
  type: 'clang' | 'clang++' | 'gcc' | 'g++' | 'msvc' | 'apple-clang';
  version: string;
  supportedStandards: string[];
  is64Bit: boolean;
  priority: number;
  capabilities: {
    optimize: boolean;
    debug: boolean;
    sanitize: boolean;
    parallel: boolean;
  };
  metadata?: {
    installDate?: Date;
    lastUsed?: Date;
    verified?: boolean;
    customFlags?: string[];
    disabled?: boolean;
  };
}

/**
 * Compiler detection result
 */
export interface CompilerDetectionResult {
  success: boolean;
  compilers: CompilerInfo[];
  suggestions: string[];
  errors?: string[];
  cacheVersion?: string;
  recommended?: CompilerInfo;
}

/**
 * Compilation configuration
 */
export interface CompileConfig {
  compiler: string;
  optimization: OptimizationLevel;
  standard: LanguageStandard;
  warnings: string[];
  defines: Record<string, string>;
  includePaths: string[];
  libraryPaths: string[];
  libraries: string[];
  debugSymbols: boolean;
  sanitize: {
    address?: boolean;
    memory?: boolean;
    thread?: boolean;
    undefined?: boolean;
  };
  customFlags: string[];
  outputName?: string;
}

/**
 * Runtime configuration
 */
export interface RuntimeConfig {
  timeLimit: number;
  memoryLimit: number;
  stackLimit?: number;
  outputLimit?: number;
  processLimit?: number;
  environment: Record<string, string>;
  workingDirectory?: string;
  inputRedirect?: string;
  outputRedirect?: string;
  errorRedirect?: string;
}

/**
 * Basic pair check configuration
 */
export interface BasicPairCheckConfig {
  compareMode: ComparisonMode;
  tolerance?: number;
  customComparator?: string;
  showDiff: boolean;
  maxDiffLines: number;
  ignoreBlankLines: boolean;
  ignoreTrailingWhitespace: boolean;
  ignoreLeadingWhitespace: boolean;
  ignoreCase?: boolean;
  stopOnFirstError: boolean;
  customFilters?: string[];
}

/**
 * Compilation error details
 */
export interface CompilationError {
  file: string;
  line: number;
  column: number;
  message: string;
  severity: DiagnosticSeverity;
  code?: string;
  context?: string[];
}

/**
 * Compilation result
 */
export interface CompilationResult {
  success: boolean;
  executablePath?: string;
  errors: CompilationError[];
  warnings: CompilationError[];
  executionTime: number;
  outputSize: number;
  memoryUsage: number;
  warningsCount: number;
  errorsCount: number;
  cacheHit: boolean;
}

/**
 * Execution result
 */
export interface ExecutionResult {
  success: boolean;
  exitCode: number;
  signal?: string;
  output: string;
  error: string;
  executionTime: number;
  memoryUsage: number;
  cpuUsage: number;
  status: ExecutionStatus;
  diagnostics: Diagnostic[];
  stats?: {
    peakMemory: number;
    cpuTime: number;
    systemTime: number;
  };
}

/**
 * Diagnostic information
 */
export interface Diagnostic {
  type: DiagnosticSeverity;
  message: string;
  code?: string;
  source: string;
  range?: {
    start: { line: number; column: number };
    end: { line: number; column: number };
  };
  suggestions?: Suggestion[];
}

/**
 * Suggestion for fixing issues
 */
export interface Suggestion {
  title: string;
  description: string;
  action?: () => Promise<void>;
  priority: 'low' | 'medium' | 'high';
}

/**
 * Difference information
 */
export interface DiffResult {
  type: DiffType;
  line1: number;
  line2: number;
  content1: string;
  content2: string;
  context?: {
    before: string[];
    after: string[];
  };
}

/**
 * Pair check result
 */
export interface PairCheckResult {
  id: ID;
  success: boolean;
  identical: boolean;
  result1: ExecutionResult;
  result2: ExecutionResult;
  differences: DiffResult[];
  statistics: {
    totalLines: number;
    diffLines: number;
    similarity: number;
    editDistance: number;
  };
  executionTime: number;
  input: string;
  config: PairCheckConfig;
  timestamp: Date;
  metadata?: {
    testId?: string;
    batchId?: string;
  };
}

/**
 * Test result
 */
export interface TestResult {
  id: ID;
  testCase: TestCase;
  execution: ExecutionResult;
  compilation?: CompilationResult;
  success: boolean;
  timestamp: Date;
  metadata?: {
    problemId?: string;
    sourceFile?: string;
    compiler?: string;
  };
}

/**
 * Performance analysis result
 */
export interface PerformanceAnalysis {
  testId: ID;
  metrics: {
    time: number[];
    memory: number[];
    cpu: number[];
  };
  statistics: {
    avgTime: number;
    maxTime: number;
    minTime: number;
    avgMemory: number;
    maxMemory: number;
    stdDevTime: number;
    stdDevMemory: number;
  };
  recommendations: string[];
  bottlenecks?: string[];
  timestamp: Date;
}

/**
 * Stress test result
 */
export interface StressTestResult {
  id: ID;
  iterations: number;
  passed: number;
  failed: number;
  totalTime: number;
  avgTime: number;
  maxTime: number;
  failures: StressTestFailure[];
  firstFailure?: number;
  timestamp: Date;
}

/**
 * Stress test failure details
 */
export interface StressTestFailure {
  iteration: number;
  input: string;
  expectedOutput: string;
  actualOutput: string;
  difference: string;
  executionTime: number;
}

/**
 * Test report
 */
export interface TestReport {
  id: ID;
  problemId: string;
  title: string;
  summary: {
    total: number;
    passed: number;
    failed: number;
    successRate: number;
    totalTime: number;
  };
  results: TestResult[];
  performance?: PerformanceAnalysis;
  generatedAt: Date;
  metadata?: {
    compiler?: string;
    configuration?: string;
  };
}

/**
 * Validation result
 */
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
  score: number; // 0-100
}

/**
 * Validation error
 */
export interface ValidationError {
  field: string;
  message: string;
  code: string;
  severity: 'critical' | 'major' | 'minor';
  suggestions?: string[];
}

/**
 * Validation warning
 */
export interface ValidationWarning {
  field: string;
  message: string;
  code: string;
  suggestions?: string[];
}

/**
 * Extension configuration
 */
export interface ExtensionConfig {
  compile: {
    opt: OptimizationLevel;
    std: LanguageStandard;
    autoDowngradeClang20: boolean;
    disableStackProtector: boolean;
    warnings: string[];
    defines: Record<string, string>;
  };
  run: {
    timeLimit: number;
    memoryLimit: number;
    autoOpenOutput: boolean;
    autoCleanup: boolean;
    maxOutputLines: number;
  };
  debug: {
    enable: boolean;
    level: 'minimal' | 'standard' | 'detailed';
    sanitizeAddress: boolean;
    sanitizeMemory: boolean;
    sanitizeThread: boolean;
    sanitizeUndefined: boolean;
  };
  pairCheck: {
    maxDiffLines: number;
    ignoreWhitespace: boolean;
    tolerance: number;
    autoSave: boolean;
  };
  ui: {
    theme: 'auto' | 'light' | 'dark';
    showLineNumbers: boolean;
    wordWrap: boolean;
    fontSize: number;
  };
  advanced: {
    cacheEnabled: boolean;
    cacheSize: number;
    parallelJobs: number;
    tempDirectory?: string;
  };
}

/**
 * Create problem payload
 */
export interface CreateProblemPayload {
  name?: string;
  language?: ProgrammingLanguage;
  baseDir?: string;
  template?: string;
  difficulty?: Difficulty;
  tags?: string[];
  timeLimit?: number;
  memoryLimit?: number;
}

/**
 * Install result
 */
export interface InstallResult {
  success: boolean;
  message: string;
  path?: string;
  version?: string;
  logs?: string[];
}

/**
 * Configuration suggestion
 */
export interface ConfigSuggestion {
  key: string;
  currentValue: unknown;
  suggestedValue: unknown;
  reason: string;
  priority: 'low' | 'medium' | 'high';
  impact: 'performance' | 'stability' | 'features' | 'security';
}

/**
 * Time range for queries
 */
export interface TimeRange {
  start: Date;
  end: Date;
}

/**
 * Pagination options
 */
export interface PaginationOptions {
  page: number;
  pageSize: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

/**
 * Filter options
 */
export interface FilterOptions {
  tags?: string[];
  difficulty?: Difficulty[];
  language?: ProgrammingLanguage[];
  dateRange?: TimeRange;
  status?: ExecutionStatus[];
  author?: string;
}

/**
 * Search options
 */
export interface SearchOptions {
  query: string;
  fields: string[];
  fuzzy?: boolean;
  limit?: number;
}

/**
 * Diff visualization data
 */
export interface DiffVisualization {
  html1: string;
  html2: string;
  css: string;
  stats: {
    totalLines: number;
    diffLines: number;
    additions: number;
    deletions: number;
  };
}

/**
 * Plugin market item
 */
export interface PluginMarketItem {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  rating: number;
  downloads: number;
  tags: string[];
  compatibility: string[];
  installUrl?: string;
}

/**
 * Performance metrics
 */
export interface PerformanceMetrics {
  timestamp: Date;
  system: {
    uptime: number;
    memoryUsage: number;
    cpuUsage: number;
    eventLoopDelay: number;
    activeHandles: number;
    activeRequests: number;
  };
  extension: ExtensionMetrics;
  extensionMetrics: ExtensionMetrics;
  webViewMetrics: WebViewMetrics;
  webviews: WebViewMetrics;
  testMetrics: TestMetrics;
  tests: TestMetrics;
  pairCheck: PairCheckMetrics;
  pairCheckMetrics: PairCheckMetrics;
  compilerMetrics: CompilerMetrics;
  compilers: CompilerMetrics;
  eventMetrics: EventMetrics;
  events: EventMetrics;
}

/**
 * Performance report
 */

/**
 * Performance alert
 */
export interface PerformanceAlert {
  type: 'warning' | 'critical';
  category: string;
  metric: string;
  value: number;
  threshold: number;
  message: string;
  timestamp: Date;
  severity: 'warning' | 'critical';
}

/**
 * Metric exceeded event
 */
export interface MetricExceededEvent {
  category: string;
  metric: string;
  value: number;
  threshold: number;
  timestamp: Date;
}

/**
 * Disposable interface for cleanup
 */
export interface Disposable {
  dispose(): void;
}

/**
 * Validator interface
 */
export interface Validator {
  validateCreateProblemPayload(payload: any): ValidationResult;
}

/**
 * Template generator interface
 */
export interface TemplateGenerator {
  generate(template: string, data: any): string;
}

/**
 * Event base interface
 */
export interface BaseEvent {
  type: string;
  timestamp: Date;
}

/**
 * Extension event types
 */
/**
 * Performance report event
 */
export interface PerformanceReportEvent extends BaseEvent {
  type: 'performance:report';
  report: PerformanceReport;
}

/**
 * Event handler error event
 */
export interface EventHandlerErrorEvent extends BaseEvent {
  type: 'event:handler-error';
  handlerError: {
    eventType: string;
    error: string;
    subscriptionId: string;
  };
}

export type ExtensionEvent =
  | ProblemCreatedEvent
  | ProblemUpdatedEvent
  | ProblemDeletedEvent
  | TestStartedEvent
  | TestCompletedEvent
  | TestSessionCreatedEvent
  | TestErrorEvent
  | TestBatchStartedEvent
  | TestBatchCompletedEvent
  | PairCheckStartedEvent
  | PairCheckCompletedEvent
  | ConfigChangedEvent
  | CompilerDetectedEvent
  | PerformanceAlertEvent
  | PairCheckBatchStartedEvent
  | PairCheckBatchCompletedEvent
  | PairCheckSessionCreatedEvent
  | PairCheckSessionEndedEvent
  | PairCheckErrorEvent
  | EventHandlerErrorEvent
  | PerformanceReportEvent;

/**
 * Pair check batch started event
 */
export interface PairCheckBatchStartedEvent extends BaseEvent {
  type: 'paircheck-batch-started';
  sessionId: string;
  testCount: number;
  startTime: Date;
}

/**
 * Pair check batch completed event
 */
export interface PairCheckBatchCompletedEvent extends BaseEvent {
  type: 'paircheck-batch-completed';
  sessionId: string;
  results: any[];
  endTime: Date;
  duration: number;
}

/**
 * Pair check session created event
 */
export interface PairCheckSessionCreatedEvent extends BaseEvent {
  type: 'paircheck-session-created';
  sessionId: string;
  sourcePath1: string;
  sourcePath2: string;
  config: any;
}

/**
 * Pair check session ended event
 */
export interface PairCheckSessionEndedEvent extends BaseEvent {
  type: 'paircheck-session-ended';
  sessionId: string;
  reason: 'completed' | 'error' | 'cancelled';
  endTime: Date;
}

/**
 * Pair check error event
 */
export interface PairCheckErrorEvent extends BaseEvent {
  type: 'paircheck-error';
  sessionId: string;
  error: string;
  stack?: string;
}

/**
 * Problem created event
 */
export interface ProblemCreatedEvent extends BaseEvent {
  type: 'problem:created';
  problem: Problem;
}

/**
 * Problem updated event
 */
export interface ProblemUpdatedEvent extends BaseEvent {
  type: 'problem:updated';
  problemId: string;
  changes: Partial<Problem>;
}

/**
 * Problem deleted event
 */
export interface ProblemDeletedEvent extends BaseEvent {
  type: 'problem:deleted';
  problemId: string;
}

/**
 * Test session type
 */
export interface TestSession {
  id: string;
  problemId: string;
  mode: TestExecutionMode;
  name: string;
  status: 'created' | 'running' | 'completed' | 'error' | 'cancelled';
  createdAt: Date;
  endTime?: Date;
  testFilter?: TestFilterOptions;
  executions: TestCaseExecution[];
  stats: TestSessionStats;
}

/**
 * Test execution options
 */
export interface TestExecutionOptions {
  sessionId?: string;
  problemId: string;
  testCaseId: string;
  language: ProgrammingLanguage;
  code?: string;
  sourcePath?: string;
  options?: any;
}

/**
 * Test execution result
 */
export interface TestExecutionResult {
  success: boolean;
  testCaseId: string;
  output?: string;
  expectedOutput?: string;
  error?: string;
  executionTime: number;
  memoryUsage: number;
  timestamp: Date;
  exitCode?: number;
  cpuUsage?: number;
  status?: ExecutionStatus;
  diagnostics?: any[];
}

/**
 * Test batch options
 */
export interface TestBatchOptions {
  problemId: string;
  language: ProgrammingLanguage;
  code?: string;
  testCases?: TestCase[];
  name?: string;
  concurrency?: number;
  options?: any;
  progressCallback?: TestProgressCallback;
}

/**
 * Test batch result
 */
export interface TestBatchResult {
  sessionId: string;
  problemId: string;
  startTime: Date;
  endTime?: Date;
  status: 'running' | 'completed' | 'failed';
  results: TestExecutionResult[];
  summary: any;
  error?: string;
}

/**
 * Test case execution record
 */
export interface TestCaseExecution {
  id: string;
  sessionId: string;
  testCaseId: string;
  problemId: string;
  language: ProgrammingLanguage;
  compilerId: string;
  status: 'running' | 'passed' | 'failed' | 'error' | 'cancelled';
  startTime: Date;
  endTime?: Date;
  result?: TestExecutionResult;
  options: TestExecutionOptions;
  testId?: string;
}

/**
 * Test session statistics
 */
export interface TestSessionStats {
  totalTests: number;
  passedTests: number;
  failedTests: number;
  errorTests: number;
  averageExecutionTime: number;
  totalExecutionTime: number;
  maxMemoryUsage: number;
  averageMemoryUsage: number;
  startTime: Date;
  compilersUsed: Set<string>;
  languagesUsed: Set<ProgrammingLanguage>;
}

/**
 * Test runner configuration
 */
export interface TestRunnerConfig {
  maxConcurrentTests: number;
  defaultTimeout: number;
  defaultMemoryLimit: number;
  enableCaching: boolean;
  enableProfiling: boolean;
  tempDirectory: string;
  enableDiagnostics: boolean;
  enableMetrics: boolean;
  outputDirectory: string;
}

/**
 * Test execution mode
 */
export type TestExecutionMode = 'single' | 'batch' | 'continuous';

/**
 * Test progress callback
 */
export type TestProgressCallback = (progress: {
  completed: number;
  total: number;
  current: string;
  result?: TestExecutionResult;
}) => void;

/**
 * Test filter options
 */
export interface TestFilterOptions {
  testCases?: string[];
  languages?: ProgrammingLanguage[];
  difficulty?: Difficulty[];
  tags?: string[];
}

/**
 * Test started event
 */
export interface TestStartedEvent extends BaseEvent {
  type: 'test:started';
  testId: string;
  problemId: string;
  sourcePath: string;
}

/**
 * Test completed event
 */
export interface TestCompletedEvent extends BaseEvent {
  type: 'test:completed';
  testId: string;
  result: TestResult;
}

/**
 * Test error event
 */
export interface TestErrorEvent extends BaseEvent {
  type: 'test:error';
  sessionId: string;
  executionId: string;
  testCaseId: string;
  problemId: string;
  error: string;
}

/**
 * Test session created event
 */
export interface TestSessionCreatedEvent extends BaseEvent {
  type: 'test:session:created';
  sessionId: string;
  problemId: string;
  mode: TestExecutionMode;
  name: string;
}

/**
 * Test batch started event
 */
export interface TestBatchStartedEvent extends BaseEvent {
  type: 'test:batch:started';
  sessionId: string;
  problemId: string;
  testCases: string[];
}

/**
 * Test batch completed event
 */
export interface TestBatchCompletedEvent extends BaseEvent {
  type: 'test:batch:completed';
  sessionId: string;
  problemId: string;
  results: TestExecutionResult[];
  summary: any;
}

/**
 * Pair check started event
 */
export interface PairCheckStartedEvent extends BaseEvent {
  type: 'paircheck:started';
  pairCheckId: string;
  sourcePath1: string;
  sourcePath2: string;
}

/**
 * Pair check completed event
 */
export interface PairCheckCompletedEvent extends BaseEvent {
  type: 'paircheck:completed';
  pairCheckId: string;
  result: PairCheckResult;
}

/**
 * Config changed event
 */
export interface ConfigChangedEvent extends BaseEvent {
  type: 'config:changed';
  key: string;
  oldValue: unknown;
  newValue: unknown;
}

/**
 * Compiler detected event
 */
export interface CompilerDetectedEvent extends BaseEvent {
  type: 'compiler:detected';
  compiler: CompilerInfo;
}

/**
 * Performance alert event
 */
export interface PerformanceAlertEvent extends BaseEvent {
  type: 'performance:alert';
  alert: PerformanceAlert;
}

/**
 * WebView message base
 */
export interface WebViewMessageBase {
  type: string;
  action: string;
  requestId?: string;
  timestamp?: number;
}

/**
 * WebView response
 */
export interface WebViewResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
  requestId: string;
  timestamp: number;
}

/**
 * Configuration item
 */
export interface ConfigItem {
  key: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  defaultValue: unknown;
  description: string;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  pattern?: string;
  required?: boolean;
  scope?: 'global' | 'workspace';
}

/**
 * Pair check manager API
 */
export interface PairCheckManagerAPI {
  /**
   * Start pair check session
   */
  startPairCheck(options: PairCheckOptions): Promise<PairCheckSession>;

  /**
   * Stop pair check session
   */
  stopPairCheck(sessionId: string): Promise<void>;

  /**
   * Get pair check status
   */
  getStatus(sessionId: string): Promise<PairCheckProgress>;

  /**
   * Get pair check results
   */
  getResults(sessionId: string): Promise<PairCheckResult[]>;

  /**
   * Execute pair check
   */
  executePairCheck(options: PairCheckOptions): Promise<PairCheckResult>;
}

/**
 * Pair check session
 */
export interface PairCheckSession {
  id: string;
  sourcePath1: string;
  sourcePath2: string;
  startTime: Date;
  status: 'running' | 'completed' | 'failed' | 'stopped';
  options: PairCheckOptions;
  results: PairCheckResult[];
  problemId?: string;
  name?: string;
  createdAt?: Date;
  executions?: any[];
  stats?: any;
}

/**
 * Pair check options
 */
export interface PairCheckOptions {
  inputFiles?: string[];
  timeout?: number;
  memoryLimit?: number;
  mode: PairCheckMode;
  showDiff?: boolean;
  continueOnError?: boolean;
  sessionId?: string;
  problemId?: string;
  sourcePath1?: string;
  sourcePath2?: string;
  name?: string;
  language?: string;
  testCases?: any[];
  bruteForceCode?: string;
  optimizedCode?: string;
  progressCallback?: (progress: {
    completed: number;
    total: number;
    currentTestCase: string;
    bruteForceResult: any;
    optimizedResult: any;
    diffResult: any;
  }) => void;
}

/**
 * Pair check modes
 */
export type PairCheckMode = 'single' | 'batch' | 'continuous';

/**
 * Pair check execution
 */
export interface PairCheckExecution {
  id: string;
  sessionId: string;
  inputFile: string;
  startTime: Date;
  endTime?: Date;
  status: 'pending' | 'running' | 'completed' | 'failed';
  result?: PairCheckResult;
  problemId?: string;
  language?: ProgrammingLanguage;
  bruteForceResults?: any[];
  optimizedResults?: any[];
  diffResults?: any[];
  bruteForceCode?: string;
  optimizedCode?: string;
}

/**
 * Pair check statistics
 */
export interface PairCheckStats {
  totalTests: number;
  passedTests: number;
  failedTests: number;
  averageExecutionTime: number;
  totalExecutionTime: number;
  memoryUsage: number;
}

/**
 * Pair check progress
 */
export interface PairCheckProgress {
  sessionId: string;
  current: number;
  total: number;
  status: 'running' | 'completed' | 'failed' | 'stopped';
  message?: string;
  estimatedTimeRemaining?: number;
}

/**
 * Pair check summary
 */
export interface PairCheckSummary {
  sessionId: string;
  stats: PairCheckStats;
  results: PairCheckResult[];
  startTime: Date;
  endTime?: Date;
  status: 'completed' | 'failed' | 'stopped';
}

/**
 * Comparison result
 */
export interface ComparisonResult {
  hasDifferences: boolean;
  differences: DiffItem[];
  output1: string;
  output2: string;
}

/**
 * Diff item
 */
export interface DiffItem {
  type: 'addition' | 'deletion' | 'modification';
  line1?: number;
  line2?: number;
  content1?: string;
  content2?: string;
}

/**
 * Pair check configuration
 */
export interface PairCheckConfig {
  compareMode: ComparisonMode;
  tolerance?: number;
  customComparator?: string;
  showDiff: boolean;
  maxDiffLines: number;
  ignoreBlankLines: boolean;
  ignoreTrailingWhitespace: boolean;
  ignoreLeadingWhitespace: boolean;
  ignoreCase?: boolean;
  stopOnFirstError: boolean;
  customFilters?: string[];
  defaultMode: PairCheckMode;
  defaultTimeout: number;
  defaultMemoryLimit: number;
  showDiffByDefault: boolean;
  continueOnErrorByDefault: boolean;
  maxConcurrentTests: number;
  maxConcurrentChecks?: number;
  enableDetailedDiff?: boolean;
  enableVisualization?: boolean;
  tempDirectory?: string;
  outputDirectory?: string;
  maxTestCases?: number;
  enableMetrics?: boolean;
  enableDiagnostics?: boolean;
}

/**
 * Problem manager API
 */
export interface ProblemManagerAPI {
  /**
   * Create a new problem
   */
  createProblem(payload: any): Promise<any>;

  /**
   * Get problem by ID
   */
  getProblem(problemId: string): Promise<any | undefined>;

  /**
   * List all problems
   */
  listProblems(options?: any): Promise<any[]>;

  /**
   * Update problem
   */
  updateProblem(problemId: string, updates: any): Promise<any>;

  /**
   * Delete problem
   */
  deleteProblem(problemId: string): Promise<void>;

  /**
   * Add test case to problem
   */
  addTestCase(problemId: string, testCase: any): Promise<any>;
}

/**
 * Compiler manager API
 */
export interface CompilerManagerAPI {
  /**
   * Detect compilers
   */
  detectCompilers(): Promise<any>;

  /**
   * Get compiler by ID
   */
  getCompiler(compilerId: string): Promise<any | undefined>;

  /**
   * List all compilers
   */
  listCompilers(): Promise<any[]>;

  /**
   * Set default compiler
   */
  setDefaultCompiler(compilerId: string): Promise<void>;
}

/**
 * Test runner API
 */
export interface TestRunnerAPI {
  /**
   * Run test
   */
  runTest(testConfig: any): Promise<any>;

  /**
   * Run batch tests
   */
  runBatchTests(testConfigs: any[]): Promise<any[]>;

  /**
   * Get test results
   */
  getTestResults(testId: string): Promise<any[]>;

  /**
   * Execute test
   */
  executeTest(testConfig: any): Promise<any>;
}

/**
 * Performance monitor interface
 */
export interface PerformanceMonitor {
  startMonitoring(operation?: string): Promise<void>;
  stopMonitoring(): void;
  getMetrics(): PerformanceMetrics;
  generateReport(): Promise<PerformanceReport>;
}

/**
 * Performance metrics
 */

/**
 * Performance configuration
 */
export interface PerformanceConfig {
  enableMonitoring: boolean;
  samplingInterval: number;
  alertThresholds: PerformanceThreshold;
  enableDiagnostics: boolean;
  enableProfiling: boolean;
  maxHistorySize: number;
}

/**
 * Performance report
 */
export interface PerformanceSummary {
  overallHealth: 'good' | 'warning' | 'critical';
  criticalAlerts: number;
  warningAlerts: number;
  averageResponseTime: number;
  uptime: number;
  totalEventsProcessed: number;
  memoryUsage: number;
  cpuUsage: number;
}

export interface PerformanceReport {
  id: string;
  timestamp: Date;
  duration: number;
  metrics: PerformanceMetrics;
  alerts: PerformanceAlert[];
  recommendations: string[];
  summary: PerformanceSummary;
}

/**
 * Performance threshold
 */
export interface PerformanceThreshold {
  memoryUsage: number;
  cpuUsage: number;
  executionTime: number;
  eventRate: number;
  errorRate: number;
}

export interface AlertThreshold {
  type: 'memory' | 'cpu' | 'errorRate' | 'responseTime' | 'eventRate';
  warning: number;
  critical: number;
  cooldown: number;
}

/**
 * Resource usage
 */
export interface ResourceUsage {
  memoryUsage: number;
  cpuUsage: number;
  diskUsage: number;
  networkUsage: number;
  eventLoopDelay: number;
  timestamp: Date;
}

/**
 * Event metrics
 */
export interface EventMetrics {
  totalEvents: number;
  eventsPerSecond: number;
  averageProcessingTime: number;
  errorRate: number;
  eventTypes: Record<string, number>;
}

/**
 * System metrics
 */
export interface SystemMetrics {
  memoryUsage: number;
  cpuUsage: number;
  diskUsage: number;
  uptime: number;
  processCount: number;
  eventLoopDelay: number;
}

/**
 * Extension metrics
 */
export interface ExtensionMetrics {
  activationTime: number;
  commandExecutions: number;
  webViewSessions: number;
  activeUsers: number;
  errorCount: number;
  startTime?: Date;
  activeSessions?: number;
  totalEventsProcessed?: number;
  averageEventProcessingTime?: number;
  errorRate?: number;
  cacheHitRate?: number;
  apiCallCount?: number;
  averageApiResponseTime?: number;
}

/**
 * WebView metrics
 */
export interface WebViewMetrics {
  activePanels: number;
  messageCount: number;
  averageResponseTime: number;
  errorRate: number;
  memoryUsage: number;
}

/**
 * Test metrics
 */
export interface TestMetrics {
  totalTests: number;
  passRate: number;
  averageExecutionTime: number;
  memoryUsage: number;
  errorRate: number;
  totalExecuted: number;
  successRate: number;
}

/**
 * Pair check metrics
 */
export interface PairCheckMetrics {
  totalChecks: number;
  totalExecuted: number;
  successRate: number;
  averageTime: number;
  throughput: number;
  executionTime: number;
  memoryUsage: number;
  diffRate: number;
  averageExecutionTime: number;
  comparisonAccuracy: number;
}

/**
 * Compiler metrics
 */
export interface CompilerMetrics {
  totalCompilations: number;
  successRate: number;
  averageCompilationTime: number;
  cacheHitRate: number;
  errorRate: number;
  detectionTime: number;
  compilationTime: number;
}
