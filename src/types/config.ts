/**
 * Configuration types for the OI-Code extension
 */

/**
 * Extension configuration interface
 */
export interface ExtensionConfig {
  compiler: CompilerConfig;
  test: TestConfig;
  webview: WebViewConfig;
  performance: PerformanceConfig;
  debug: DebugConfig;
}

/**
 * Compiler configuration
 */
export interface CompilerConfig {
  languages: LanguageConfig[];
  defaultLanguage: string;
  autoDetect: boolean;
  installation: CompilerInstallationConfig;
}

/**
 * Language-specific configuration
 */
export interface LanguageConfig {
  language: string;
  command: string;
  args: string[];
  extensions: string[];
  compileArgs?: string[];
  runArgs?: string[];
  memoryLimit?: number;
  timeLimit?: number;
}

/**
 * Compiler installation configuration
 */
export interface CompilerInstallationConfig {
  autoInstall: boolean;
  preferredInstaller: 'apt' | 'dnf' | 'yum' | 'pacman' | 'brew' | 'choco' | 'scoop';
  fallbackToSystem: boolean;
}

/**
 * Test configuration
 */
export interface TestConfig {
  defaultTimeout: number;
  defaultMemoryLimit: number;
  maxConcurrentTests: number;
  enableCaching: boolean;
  tempDirectory: string;
  outputDirectory: string;
  cleanupOnExit: boolean;
}

/**
 * WebView configuration
 */
export interface WebViewConfig {
  enableScripts: boolean;
  enableForms: boolean;
  localResourceRoots: string[];
  port: number;
  theme: 'light' | 'dark' | 'system';
  enableAnimations: boolean;
  enableDebug: boolean;
  enableCors: boolean;
  enableCompression: boolean;
  maxMessageSize: number;
  timeout: number;
  enableMetrics: boolean;
}

/**
 * Performance configuration
 */
export interface PerformanceConfig {
  enableMonitoring: boolean;
  samplingInterval: number;
  maxHistorySize: number;
  enableAlerts: boolean;
  enableResourceMonitoring: boolean;
  enableEventMonitoring: boolean;
  enableWebViewMonitoring: boolean;
  enableTestMonitoring: boolean;
  enableCompilerMonitoring: boolean;
  enableDetailedMetrics: boolean;
  enableProfiling: boolean;
  reportInterval: number;
  alertCooldownPeriod: number;
  memoryThreshold: number;
  cpuThreshold: number;
  eventRateThreshold: number;
  responseTimeThreshold: number;
  errorRateThreshold: number;
  alertThresholds: {
    memoryUsage: number;
    cpuUsage: number;
    executionTime: number;
    eventRate: number;
    errorRate: number;
  };
}

/**
 * Debug configuration
 */
export interface DebugConfig {
  enabled: boolean;
  level: 'error' | 'warn' | 'info' | 'debug' | 'trace';
  logToFile: boolean;
  logDirectory: string;
  maxLogSize: number;
  maxLogFiles: number;
  enableConsole: boolean;
  enableRemoteDebug: boolean;
  remoteDebugPort: number;
}

/**
 * Configuration manager interface
 */
export interface ConfigManager {
  getConfig(): ExtensionConfig;
  updateConfig(updates: Partial<ExtensionConfig>): Promise<void>;
  getCompilerConfig(language: string): LanguageConfig | undefined;
  getTestConfig(): TestConfig;
  getWebViewConfig(): WebViewConfig;
  getPerformanceConfig(): PerformanceConfig;
  getDebugConfig(): DebugConfig;
  resetToDefaults(): Promise<void>;
  exportConfig(): string;
  importConfig(config: string): Promise<void>;
}

/**
 * Compiler manager configuration
 */
export interface CompilerManagerConfig {
  autoDetect: boolean;
  cacheResults: boolean;
  detectionTimeout: number;
  installation: {
    autoInstall: boolean;
    preferredInstaller: 'apt' | 'dnf' | 'yum' | 'pacman' | 'brew' | 'choco' | 'scoop';
    fallbackToSystem: boolean;
  };
  performance: {
    enableProfiling: boolean;
    enableMetrics: boolean;
    samplingInterval: number;
  };
  healthCheckInterval: number;
  defaultTimeout: number;
  defaultMemoryLimit: number;
}

/**
 * Problem manager configuration
 */
export interface ProblemManagerConfig {
  autoSave: boolean;
  backupInterval: number;
  maxBackups: number;
  templateDirectory: string;
  basePath: string;
  validation: {
    enableValidation: boolean;
    strictMode: boolean;
    customRules: string[];
  };
  importExport: {
    supportedFormats: string[];
    maxFileSize: number;
    enableCompression: boolean;
  };
  search: {
    enableIndexing: boolean;
    indexUpdateInterval: number;
    maxSearchResults: number;
  };
}

/**
 * Configuration validation result
 */
export interface ConfigValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}
