/* ---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *-------------------------------------------------------------------------------------------- */

import * as vscode from 'vscode';
import { ExtensionConfig } from '../types/config';

/**
 * Configuration manager for the OI-Code extension
 */
export class ConfigManager {
    private config: ExtensionConfig;
    private disposables: vscode.Disposable[] = [];

    constructor() {
        this.config = this.getDefaultConfig();
        this.setupConfigListeners();
    }

    private getDefaultConfig(): ExtensionConfig {
        return {
            compiler: {
                languages: [],
                defaultLanguage: 'cpp',
                autoDetect: true,
                installation: {
                    autoInstall: true,
                    preferredInstaller: 'apt',
                    fallbackToSystem: true
                }
            },
            test: {
                defaultTimeout: 5000,
                defaultMemoryLimit: 512,
                maxConcurrentTests: 4,
                enableCaching: true,
                tempDirectory: '/tmp/oi-code-tests',
                outputDirectory: './test-results',
                cleanupOnExit: true
            },
            webview: {
                enableScripts: true,
                enableForms: true,
                localResourceRoots: [],
                port: 3000,
                theme: 'dark',
                enableAnimations: true,
                enableDebug: false,
                enableCors: true,
                enableCompression: true,
                maxMessageSize: 1024 * 1024,
                timeout: 30000,
                enableMetrics: true
            },
            performance: {
                enableMonitoring: false,
                samplingInterval: 1000,
                maxHistorySize: 1000,
                enableAlerts: false,
                enableResourceMonitoring: false,
                enableEventMonitoring: false,
                enableWebViewMonitoring: false,
                enableTestMonitoring: false,
                enableCompilerMonitoring: false,
                enableDetailedMetrics: false,
                enableProfiling: false,
                reportInterval: 5000,
                alertCooldownPeriod: 1000,
                memoryThreshold: 1024,
                cpuThreshold: 80,
                eventRateThreshold: 100,
                responseTimeThreshold: 30000,
                errorRateThreshold: 0.1,
                alertThresholds: {
                    memoryUsage: 1024,
                    cpuUsage: 80,
                    executionTime: 30000,
                    eventRate: 100,
                    errorRate: 0.1
                }
            },
            debug: {
                enabled: true,
                level: 'info',
                logToFile: false,
                logDirectory: './logs',
                maxLogSize: 10 * 1024 * 1024,
                maxLogFiles: 5,
                enableConsole: true,
                enableRemoteDebug: false,
                remoteDebugPort: 9229
            }
        };
    }

    private setupConfigListeners(): void {
        const configChangeListener = vscode.workspace.onDidChangeConfiguration(() => {
            this.reloadConfig();
        });
        this.disposables.push(configChangeListener);
    }

    private reloadConfig(): void {
        const config = vscode.workspace.getConfiguration('oicode');
        // TODO: Implement configuration reload logic
        console.log('Configuration reloaded:', config);
    }

    getConfig(): ExtensionConfig {
        return { ...this.config };
    }

    updateConfig(updates: Partial<ExtensionConfig>): void {
        this.config = { ...this.config, ...updates };
    }

    dispose(): void {
        this.disposables.forEach(disposable => disposable.dispose());
        this.disposables = [];
    }
}
