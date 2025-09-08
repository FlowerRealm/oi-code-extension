/* ---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *-------------------------------------------------------------------------------------------- */

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
    cacheVersion?: string;
    cachedAt?: number;
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
    suggestions?: string[];
}

/**
 * Compiler configuration
 */
export interface CompilerConfig {
    optimizationLevel?: string;
    standard?: string;
}

/**
 * Extension configuration
 */
export interface ExtensionConfig {
    compile: CompilerConfig;
    autoDowngradeClang20: boolean;
}

/**
 * WebView message interface
 */
export interface WebViewMessage {
    command: string;
    [key: string]: any;
}

/**
 * Problem view message interface
 */
export interface ProblemViewMessage {
    cmd: 'loadSamples' | 'run' | 'pair';
    name?: string;
    url?: string;
    timeLimit?: number;
    memoryLimit?: number;
    opt?: string;
    std?: string;
    statement?: string;
    samples?: string;
}

/**
 * Problem configuration
 */
export interface ProblemConfig {
    name: string;
    url: string;
    timeLimit: number;
    memoryLimit: number;
    opt: string;
    std: string;
}

/**
 * Problem structure
 */
export interface ProblemStructure {
    sourcePath: string;
}

/**
 * Create problem payload
 */
export interface CreateProblemPayload {
    name?: string;
    language?: 'c' | 'cpp';
    baseDir?: string;
}

/**
 * Create problem result
 */
export interface CreateProblemResult {
    problemDir?: string;
    sourcePath?: string;
    error?: string;
}

/**
 * Load samples result
 */
export interface LoadSamplesResult {
    cmd: 'samplesLoaded';
    text: string;
}

/**
 * Command handler interface
 */
export interface CommandHandler {
    execute(...args: any[]): Promise<any>;
}

/**
 * Command definition interface
 */
export interface CommandDefinition {
    id: string;
    handler: CommandHandler;
    description?: string;
    category?: string;
}

/**
 * Execution result interface
 */
export interface ExecutionResult {
    output: string;
    error: string;
    timedOut: boolean;
    memoryExceeded: boolean;
    spaceExceeded: boolean;
}

/**
 * Pair check result interface
 */
export interface PairCheckResult {
    output1: string;
    output2: string;
    equal: boolean;
    error?: string;
}

/**
 * Manager dependencies interface
 */
export interface ManagerDependencies {
    logger?: any;
    configManager?: any;
    webViewManager?: any;
    problemManager?: any;
    pairCheckManager?: any;
}

/**
 * Config section interface
 */
export interface ConfigSection {
    [key: string]: any;
}

/**
 * WebView theme handler interface
 */
export interface WebViewThemeHandler {
    setTheme(theme: string): void;
    dispose(): void;
}

/**
 * Type guards
 */
export function isWebViewMessage(obj: any): obj is WebViewMessage {
    return obj && typeof obj.command === 'string';
}

export function isProblemViewMessage(obj: any): obj is ProblemViewMessage {
    return obj && typeof obj.cmd === 'string' && ['loadSamples', 'run', 'pair'].includes(obj.cmd);
}

export function isExecutionResult(obj: any): obj is ExecutionResult {
    return (
        obj &&
        typeof obj.output === 'string' &&
        typeof obj.error === 'string' &&
        typeof obj.timedOut === 'boolean' &&
        typeof obj.memoryExceeded === 'boolean' &&
        typeof obj.spaceExceeded === 'boolean'
    );
}
