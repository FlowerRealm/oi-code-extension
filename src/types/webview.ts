/* ---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *-------------------------------------------------------------------------------------------- */

import * as vscode from 'vscode';
import {
    Problem,
    TestCase,
    TestResult,
    PairCheckResult,
    ExtensionConfig,
    CompilerInfo,
    ValidationResult,
    DiffVisualization,
    WebViewMessageBase
} from './models';

/**
 * WebView response type
 */
export interface WebViewResponse<T = any> {
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
 * WebView message types
 */
export type WebViewMessage =
  | ProblemViewMessage
  | PairCheckViewMessage
  | SettingsViewMessage
  | ExtensionViewMessage
  | SystemViewMessage;

/**
 * System WebView message (for internal system messages)
 */
export interface SystemViewMessage extends WebViewMessageBase {
  type: 'theme' | 'response' | 'error' | 'status' | 'notification' | 'ready' | 'formSubmit' | 'buttonClick' | 'request';
  action: 'update' | 'notify' | 'show' | 'hide' | 'submit' | 'click';
  payload?: {
    theme?: string;
    error?: string;
    requestId?: string;
    message?: string;
    status?: string;
  };
  data?: any;
}

/**
 * Problem WebView message
 */
export interface ProblemViewMessage extends WebViewMessageBase {
  type: 'problem';
  action:
    | 'create' | 'load' | 'save' | 'update' | 'delete'
    | 'import' | 'export' | 'validate' | 'run' | 'add-testcase'
    | 'update-testcase' | 'delete-testcase' | 'generate-template';
  payload?: {
    problem?: Problem;
    problemId?: string;
    testCase?: TestCase;
    format?: string;
    template?: string;
    language?: string;
    config?: any;
  };
}

/**
 * Pair check WebView message
 */
export interface PairCheckViewMessage extends WebViewMessageBase {
  type: 'paircheck';
  action:
    | 'start' | 'stop' | 'batch' | 'history' | 'export'
    | 'config' | 'update-status' | 'show-diff' | 'clear-results';
  payload?: {
    sourcePath1?: string;
    sourcePath2?: string;
    input?: string;
    testCases?: TestCase[];
    config?: any;
    pairCheckId?: string;
    result?: PairCheckResult;
  };
}

/**
 * Settings WebView message
 */
export interface SettingsViewMessage extends WebViewMessageBase {
  type: 'settings';
  action:
    | 'get' | 'set' | 'reset' | 'validate' | 'import'
    | 'export' | 'detect-compilers' | 'get-suggestions';
  payload?: {
    key?: string;
    value?: unknown;
    config?: ExtensionConfig;
    format?: string;
    path?: string;
  };
}

/**
 * Extension WebView message
 */
export interface ExtensionViewMessage extends WebViewMessageBase {
  type: 'extension';
  action:
    | 'get-info' | 'get-stats' | 'get-history'
    | 'clear-cache' | 'restart' | 'diagnostics';
  payload?: {
    [key: string]: unknown;
  };
}

/**
 * WebView base interface
 */
export interface WebViewAPI {
  /**
   * Send message to WebView
   */
  postMessage(message: WebViewMessage): void;

  /**
   * Listen to WebView messages
   */
  onMessage(callback: (message: WebViewMessage) => void): vscode.Disposable;

  /**
   * Update WebView content
   */
  updateContent(content: string): void;

  /**
   * Show WebView
   */
  show(): void;

  /**
   * Hide WebView
   */
  hide(): void;

  /**
   * Focus WebView
   */
  focus(): void;

  /**
   * Refresh WebView
   */
  refresh(): void;

  /**
   * Get WebView panel
   */
  getPanel(): vscode.WebviewPanel | undefined;

  /**
   * Check if WebView is visible
   */
  isVisible(): boolean;
}

/**
 * Problem WebView API
 */
export interface ProblemViewAPI extends WebViewAPI {
  /**
   * Update problem information
   */
  updateProblem(problem: Problem): void;

  /**
   * Update test cases
   */
  updateTestCases(testCases: TestCase[]): void;

  /**
   * Update compilation config
   */
  updateCompileConfig(config: any): void;

  /**
   * Show validation errors
   */
  showValidationErrors(errors: any[]): void;

  /**
   * Show execution result
   */
  showExecutionResult(result: TestResult): void;

  /**
   * Show save status
   */
  showSaveStatus(status: 'saving' | 'saved' | 'error', message?: string): void;

  /**
   * Update problem stats
   */
  updateProblemStats(stats: any): void;
}

/**
 * Pair check WebView API
 */
export interface PairCheckViewAPI extends WebViewAPI {
  /**
   * Update pair check status
   */
  updatePairCheckStatus(status: 'idle' | 'running' | 'completed' | 'error'): void;

  /**
   * Update pair check result
   */
  updatePairCheckResult(result: PairCheckResult): void;

  /**
   * Update progress information
   */
  updateProgress(current: number, total: number, message?: string): void;

  /**
   * Show difference visualization
   */
  showDiffVisualization(diff: DiffVisualization): void;

  /**
   * Update history records
   */
  updateHistory(history: PairCheckResult[]): void;

  /**
   * Show input data
   */
  showInputData(input: string): void;

  /**
   * Clear results
   */
  clearResults(): void;
}

/**
 * Settings WebView API
 */
export interface SettingsViewAPI extends WebViewAPI {
  /**
   * Update configuration display
   */
  updateConfig(config: ExtensionConfig): void;

  /**
   * Show validation result
   */
  showValidationResult(result: ValidationResult): void;

  /**
   * Update compiler list
   */
  updateCompilerList(compilers: CompilerInfo[]): void;

  /**
   * Show configuration suggestions
   */
  showConfigSuggestions(suggestions: any[]): void;

  /**
   * Update scan status
   */
  updateScanStatus(status: 'scanning' | 'completed' | 'error', message?: string): void;

  /**
   * Show import/export status
   */
  showTransferStatus(status: 'importing' | 'exporting' | 'completed' | 'error', message?: string): void;
}

/**
 * WebView provider interface
 */
export interface WebViewProvider<T extends WebViewAPI> {
  /**
   * Get view type
   */
  viewType: string;

  /**
   * Get view title
   */
  title: string;

  /**
   * Create WebView panel
   */
  createPanel(): T;

  /**
   * Restore WebView panel
   */
  restorePanel(panel: vscode.WebviewPanel): T;

  /**
   * Get HTML content
   */
  getHtmlContent(): string;

  /**
   * Handle WebView messages
   */
  handleMessage(message: WebViewMessage): Promise<void>;

  /**
   * Handle panel disposal
   */
  onDispose?(): void;
}

/**
 * WebView manager interface
 */
export interface WebViewManager {
  /**
   * Register WebView provider
   */
  registerProvider<T extends WebViewAPI>(provider: WebViewProvider<T>): vscode.Disposable;

  /**
   * Show WebView by type
   */
  showWebView(type: string): void;

  /**
   * Hide WebView by type
   */
  hideWebView(type: string): void;

  /**
   * Get WebView by type
   */
  getWebView<T extends WebViewAPI>(type: string): T | undefined;

  /**
   * Send message to WebView
   */
  postMessage(type: string, message: WebViewMessage): void;

  /**
   * Broadcast message to all WebViews
   */
  broadcast(message: WebViewMessage): void;

  /**
   * Handle WebView message
   */
  handleMessage(type: string, message: WebViewMessage): Promise<void>;

  /**
   * Dispose all WebViews
   */
  dispose(): void;

  /**
   * Get problem view provider
   */
  getProblemViewProvider(): vscode.WebviewViewProvider;

  /**
   * Get pair check view provider
   */
  getPairCheckViewProvider(): vscode.WebviewViewProvider;
}

/**
 * WebView message handler
 */
export interface WebViewMessageHandler {
  /**
   * Handle message
   */
  handleMessage(message: WebViewMessage): Promise<WebViewResponse>;

  /**
   * Validate message
   */
  validateMessage(message: WebViewMessage): boolean;

  /**
   * Get supported message types
   */
  getSupportedTypes(): string[];
}

/**
 * WebView state
 */
export interface WebViewState {
  id?: string;
  activePanel: string | null;
  panels: Record<string, {
    visible?: boolean;
    panel: vscode.WebviewPanel;
    api: WebViewAPI;
  }>;
  lastMessageTime: number;
  settings: {
    theme: string;
    fontSize: number;
    wordWrap: boolean;
  };
}

/**
 * WebView event
 */
export interface WebViewEvent {
  type: 'panel-created' | 'panel-disposed' | 'message-received' | 'message-sent';
  viewType: string;
  timestamp: number;
  data?: any;
}

/**
 * WebView utilities
 */
export interface WebViewUtils {
  /**
   * Escape HTML content
   */
  escapeHtml(content: string): string;

  /**
   * Set safe HTML content
   */
  setSafeHtml(element: HTMLElement, content: string): void;

  /**
   * Create diff HTML
   */
  createDiffHtml(output1: string, output2: string): { html1: string; html2: string };

  /**
   * Format execution time
   */
  formatExecutionTime(time: number): string;

  /**
   * Format memory usage
   */
  formatMemoryUsage(memory: number): string;

  /**
   * Get theme CSS
   */
  getThemeCss(): string;

  /**
   * Create status badge HTML
   */
  createStatusBadge(status: string, message?: string): string;

  /**
   * Create progress bar HTML
   */
  createProgressBar(current: number, total: number, message?: string): string;
}

/**
 * WebView configuration
 */
export interface WebViewConfig {
  enableScripts: boolean;
  enableForms: boolean;
  enableDebug: boolean;
  localResourceRoots: readonly vscode.Uri[];
  portMapping?: vscode.WebviewPanelOptions;
  port?: number;
  theme?: string;
  enableAnimations?: boolean;
  enableCors?: boolean;
  enableCompression?: boolean;
  maxMessageSize?: number;
  timeout?: number;
  enableMetrics?: boolean;
}

/**
 * WebView response builder
 */
export class WebViewResponseBuilder {
    /**
   * Create success response
   */
    static success<T>(data: T, requestId: string): WebViewResponse<T> {
        return {
            success: true,
            data,
            requestId,
            timestamp: Date.now()
        };
    }

    /**
   * Create error response
   */
    static error(
        code: string,
        message: string,
        requestId: string,
        details?: unknown
    ): WebViewResponse {
        return {
            success: false,
            error: { code, message, details },
            requestId,
            timestamp: Date.now()
        };
    }

    /**
   * Create validation error response
   */
    static validationError(
        errors: any[],
        requestId: string
    ): WebViewResponse {
        return this.error('VALIDATION_ERROR', 'Validation failed', requestId, { errors });
    }

    /**
   * Create not found response
   */
    static notFound(message: string, requestId: string): WebViewResponse {
        return this.error('NOT_FOUND', message, requestId);
    }

    /**
   * Create permission denied response
   */
    static permissionDenied(message: string, requestId: string): WebViewResponse {
        return this.error('PERMISSION_DENIED', message, requestId);
    }

    /**
   * Create internal error response
   */
    static internalError(message: string, requestId: string, details?: unknown): WebViewResponse {
        return this.error('INTERNAL_ERROR', message, requestId, details);
    }
}

/**
 * WebView message validator
 */
export class WebViewMessageValidator {
    /**
   * Validate message structure
   */
    static validate(message: WebViewMessage): boolean {
        return !!(
            message &&
      typeof message === 'object' &&
      message.type &&
      message.action &&
      typeof message.type === 'string' &&
      typeof message.action === 'string'
        );
    }

    /**
   * Validate problem view message
   */
    static validateProblemViewMessage(message: ProblemViewMessage): boolean {
        if (!this.validate(message)) return false;
        if (message.type !== 'problem') return false;

        const validActions = [
            'create', 'load', 'save', 'update', 'delete',
            'import', 'export', 'validate', 'run', 'add-testcase',
            'update-testcase', 'delete-testcase', 'generate-template'
        ];

        return validActions.includes(message.action);
    }

    /**
   * Validate pair check view message
   */
    static validatePairCheckViewMessage(message: PairCheckViewMessage): boolean {
        if (!this.validate(message)) return false;
        if (message.type !== 'paircheck') return false;

        const validActions = [
            'start', 'stop', 'batch', 'history', 'export',
            'config', 'update-status', 'show-diff', 'clear-results'
        ];

        return validActions.includes(message.action);
    }

    /**
   * Validate settings view message
   */
    static validateSettingsViewMessage(message: SettingsViewMessage): boolean {
        if (!this.validate(message)) return false;
        if (message.type !== 'settings') return false;

        const validActions = [
            'get', 'set', 'reset', 'validate', 'import',
            'export', 'detect-compilers', 'get-suggestions'
        ];

        return validActions.includes(message.action);
    }
}

/**
 * WebView request type
 */
export interface WebViewRequest {
  type: string;
  action: string;
  data: any;
  requestId: string;
  timestamp: number;
}

/**
 * WebView message type
 */
export type WebViewMessageType = 'form-submit' | 'button-click' | 'ready' | 'request' | 'response';

/**
 * WebView communication protocol
 */
export interface WebViewCommunicationProtocol {
  sendMessage(message: WebViewMessage): Promise<boolean>;
  onMessage(callback: (message: WebViewMessage) => void): Disposable;
  updateContent(content: string): void;
  show(): void;
  hide(): void;
  focus(): void;
  refresh(): void;
}

/**
 * WebView theme
 */
export interface WebViewTheme {
  type: 'light' | 'dark';
  colors: {
    background: string;
    foreground: string;
    primary: string;
    secondary: string;
    accent: string;
    border: string;
    error: string;
    warning: string;
    success: string;
  };
}

/**
 * WebView content
 */
export interface WebViewContent {
  html: string;
  scripts?: string[];
  styles?: string[];
  title?: string;
  subtitle?: string;
}

/**
 * WebView panel configuration
 */
export interface WebViewPanelConfig {
  id: string;
  title: string;
  viewType: string;
  viewColumn?: vscode.ViewColumn;
  showOptions?: {
    preserveFocus?: boolean;
    viewColumn?: vscode.ViewColumn;
  };
  content?: WebViewContent;
  localResourceRoots?: readonly vscode.Uri[];
  enableScripts?: boolean;
  enableForms?: boolean;
  retainContextWhenHidden?: boolean;
  enableFindWidget?: boolean;
}

