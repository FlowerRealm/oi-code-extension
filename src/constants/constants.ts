import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';

/**
 * Directory paths
 */
export const OI_CODE_TEST_DIR = '.oi-code-tests';
export const OI_CODE_TEST_BASE_PATH = path.join(os.homedir(), OI_CODE_TEST_DIR);
export const OI_CODE_TEST_TMP_PATH = path.join(OI_CODE_TEST_BASE_PATH, 'tmp');
export const OI_CODE_PROBLEM_PATH = path.join(OI_CODE_TEST_BASE_PATH, 'problems');

/**
 * Default execution limits
 */
export const DEFAULT_TIME_LIMIT = 20; // seconds
export const DEFAULT_MEMORY_LIMIT = 512; // MB
export const DEFAULT_PAIR_CHECK_TIME_LIMIT = 20; // seconds
export const DEFAULT_PAIR_CHECK_MEMORY_LIMIT = 512; // MB
export const DEFAULT_SINGLE_RUN_TIME_LIMIT = 5; // seconds - for single code execution

/**
 * Compiler settings
 */
export const DEFAULT_OPTIMIZATION_LEVEL = 'O0';
export const DEFAULT_CPP_STANDARD = 'c++17';
export const DEFAULT_C_STANDARD = 'c17';

/**
 * WebView and UI settings
 */
export const WEBVIEW_VIEW_COLUMN = vscode.ViewColumn.One;
export const OUTPUT_VIEW_COLUMN = vscode.ViewColumn.Two;

/**
 * Timeouts and delays
 */
export const COMMAND_TIMEOUT = 30000; // 30 seconds
export const DEBOUNCE_DELAY = 500; // 500ms
export const MESSAGE_DELAY = 2000; // 2 seconds

/**
 * Language mappings
 */
export const LANGUAGE_MAPPING: Record<string, 'c' | 'cpp'> = {
    c: 'c',
    cpp: 'cpp',
    cxx: 'cpp',
    cc: 'cpp'
};

/**
 * Error messages
 */
export const ERROR_MESSAGES = {
    CONTEXT_NOT_INITIALIZED: 'Context not initialized',
    NO_ACTIVE_EDITOR: 'No active editor found',
    COMPILER_DETECTION_FAILED: 'Compiler detection failed',
    COMPILATION_FAILED: 'Compilation failed',
    EXECUTION_TIMEOUT: 'Execution timeout',
    MEMORY_LIMIT_EXCEEDED: 'Memory limit exceeded'
} as const;
