import { EventSystem, EventSystemManager } from './event-system';
import {
    PerformanceMonitor,
    PerformanceMetrics,
    PerformanceReport,
    PerformanceAlert,
    AlertThreshold,
    PerformanceSummary,
    PerformanceReportEvent,
    ResourceUsage
} from '../types/models';
import { PerformanceConfig as ConfigPerformanceConfig } from '../types/config';
import { Disposable } from '../types/models';

/**
 * Performance Monitor implementation
 * Monitors extension performance, resource usage, and provides metrics
 */
export class PerformanceMonitorImpl implements PerformanceMonitor, Disposable {
    private static instance: PerformanceMonitorImpl;
    private config: ConfigPerformanceConfig;
    private disposables: Disposable[] = [];
    private eventSystem: EventSystem;
    private metrics: PerformanceMetrics;
    private alertThresholds: Map<string, AlertThreshold> = new Map();
    private activeMonitors: Map<string, NodeJS.Timer> = new Map();
    private resourceUsageHistory: ResourceUsage[] = [];
    private startTimes: Map<string, number> = new Map();
    private counters: Map<string, number> = new Map();
    private gauges: Map<string, number> = new Map();

    private constructor(config: Partial<ConfigPerformanceConfig> = {}) {
        this.eventSystem = EventSystemManager.getInstance();
        this.config = this.mergeConfig(config);
        this.metrics = this.initializeMetrics();
        this.setupDefaultThresholds();
        this.startPeriodicMonitoring();
    }

    static getInstance(config?: Partial<ConfigPerformanceConfig>): PerformanceMonitorImpl {
        if (!PerformanceMonitorImpl.instance) {
            PerformanceMonitorImpl.instance = new PerformanceMonitorImpl(config);
        }
        return PerformanceMonitorImpl.instance;
    }

    private mergeConfig(config: Partial<ConfigPerformanceConfig>): ConfigPerformanceConfig {
        return {
            enableMonitoring: config.enableMonitoring !== false,
            samplingInterval: config.samplingInterval || 1000,
            maxHistorySize: config.maxHistorySize || 1000,
            enableAlerts: config.enableAlerts ?? false,
            enableResourceMonitoring: config.enableResourceMonitoring ?? false,
            enableEventMonitoring: config.enableEventMonitoring ?? false,
            enableWebViewMonitoring: config.enableWebViewMonitoring ?? false,
            enableTestMonitoring: config.enableTestMonitoring ?? false,
            enableCompilerMonitoring: config.enableCompilerMonitoring ?? false,
            enableDetailedMetrics: config.enableDetailedMetrics ?? false,
            enableProfiling: config.enableProfiling ?? false,
            reportInterval: config.reportInterval ?? 60000,
            alertCooldownPeriod: config.alertCooldownPeriod ?? 30000,
            memoryThreshold: config.memoryThreshold ?? 512 * 1024 * 1024, // 512MB
            cpuThreshold: config.cpuThreshold ?? 80, // 80%
            eventRateThreshold: config.eventRateThreshold ?? 100, // 100 events/sec
            responseTimeThreshold: config.responseTimeThreshold ?? 1000, // 1 sec
            errorRateThreshold: config.errorRateThreshold ?? 0.1, // 10%
            alertThresholds: config.alertThresholds ?? {
                memoryUsage: 1024,
                cpuUsage: 80,
                executionTime: 30000,
                eventRate: 100,
                errorRate: 0.1
            }
        };
    }

    private initializeMetrics(): PerformanceMetrics {
        return {
            timestamp: new Date(),
            system: {
                uptime: 0,
                memoryUsage: 0,
                cpuUsage: 0,
                eventLoopDelay: 0,
                activeHandles: 0,
                activeRequests: 0
            },
            extension: {
                activationTime: 0,
                commandExecutions: 0,
                webViewSessions: 0,
                activeUsers: 0,
                errorCount: 0,
                startTime: new Date(),
                activeSessions: 0,
                totalEventsProcessed: 0,
                averageEventProcessingTime: 0,
                errorRate: 0,
                cacheHitRate: 0,
                apiCallCount: 0,
                averageApiResponseTime: 0
            },
            extensionMetrics: {
                activationTime: 0,
                commandExecutions: 0,
                webViewSessions: 0,
                activeUsers: 0,
                errorCount: 0,
                startTime: new Date(),
                activeSessions: 0,
                totalEventsProcessed: 0,
                averageEventProcessingTime: 0,
                errorRate: 0,
                cacheHitRate: 0,
                apiCallCount: 0,
                averageApiResponseTime: 0
            },
            webViewMetrics: {
                activePanels: 0,
                averageResponseTime: 0,
                messageCount: 0,
                errorRate: 0,
                memoryUsage: 0
            },
            webviews: {
                activePanels: 0,
                averageResponseTime: 0,
                messageCount: 0,
                errorRate: 0,
                memoryUsage: 0
            },
            testMetrics: {
                totalTests: 0,
                passRate: 0,
                averageExecutionTime: 0,
                memoryUsage: 0,
                errorRate: 0,
                totalExecuted: 0,
                successRate: 0
            },
            tests: {
                totalTests: 0,
                passRate: 0,
                averageExecutionTime: 0,
                memoryUsage: 0,
                errorRate: 0,
                totalExecuted: 0,
                successRate: 0
            },
            pairCheck: {
                totalChecks: 0,
                totalExecuted: 0,
                successRate: 0,
                averageTime: 0,
                throughput: 0,
                executionTime: 0,
                memoryUsage: 0,
                diffRate: 0,
                averageExecutionTime: 0,
                comparisonAccuracy: 0
            },
            pairCheckMetrics: {
                totalChecks: 0,
                totalExecuted: 0,
                successRate: 0,
                averageTime: 0,
                throughput: 0,
                executionTime: 0,
                memoryUsage: 0,
                diffRate: 0,
                averageExecutionTime: 0,
                comparisonAccuracy: 0
            },
            compilerMetrics: {
                totalCompilations: 0,
                successRate: 0,
                averageCompilationTime: 0,
                cacheHitRate: 0,
                errorRate: 0,
                detectionTime: 0,
                compilationTime: 0
            },
            compilers: {
                totalCompilations: 0,
                successRate: 0,
                averageCompilationTime: 0,
                cacheHitRate: 0,
                errorRate: 0,
                detectionTime: 0,
                compilationTime: 0
            },
            eventMetrics: {
                totalEvents: 0,
                eventsPerSecond: 0,
                averageProcessingTime: 0,
                errorRate: 0,
                eventTypes: {}
            },
            events: {
                totalEvents: 0,
                eventsPerSecond: 0,
                averageProcessingTime: 0,
                errorRate: 0,
                eventTypes: {}
            }
        };
    }

    private setupDefaultThresholds(): void {
        this.alertThresholds.set('memory', {
            type: 'memory',
            warning: 256 * 1024 * 1024, // 256MB
            critical: 512 * 1024 * 1024, // 512MB
            cooldown: 30000
        });

        this.alertThresholds.set('cpu', {
            type: 'cpu',
            warning: 70, // 70%
            critical: 90, // 90%
            cooldown: 30000
        });

        this.alertThresholds.set('responseTime', {
            type: 'responseTime',
            warning: 2000, // 2 sec
            critical: 5000, // 5 sec
            cooldown: 30000
        });

        this.alertThresholds.set('errorRate', {
            type: 'errorRate',
            warning: 0.05, // 5%
            critical: 0.1, // 10%
            cooldown: 60000
        });

        this.alertThresholds.set('eventRate', {
            type: 'eventRate',
            warning: 50, // 50 events/sec
            critical: 100, // 100 events/sec
            cooldown: 30000
        });
    }

    /**
   * Start monitoring a specific operation
   */
    async startMonitoring(operation: string): Promise<void> {
        this.startTimes.set(operation, Date.now());
    }

    /**
   * Stop monitoring and record duration
   */
    async endMonitoring(operation: string): Promise<void> {
        const startTime = this.startTimes.get(operation);
        if (startTime) {
            const duration = Date.now() - startTime;
            this.recordMetric('operation_duration', duration);
            this.startTimes.delete(operation);
        }
    }

    /**
   * Record a custom metric
   */
    async recordMetric(name: string, value: number): Promise<void> {
        this.gauges.set(name, value);

        // Update specific metrics based on name
        if (name.startsWith('test_')) {
            this.updateTestMetrics(name, value);
        } else if (name.startsWith('paircheck_')) {
            this.updatePairCheckMetrics(name, value);
        } else if (name.startsWith('compiler_')) {
            this.updateCompilerMetrics(name, value);
        } else if (name.startsWith('webview_')) {
            this.updateWebViewMetrics(name, value);
        } else if (name.startsWith('event_')) {
            this.updateEventMetrics(name, value);
        }
    }

    /**
   * Increment a counter
   */
    async incrementCounter(name: string, value?: number): Promise<void> {
        const current = this.counters.get(name) || 0;
        this.counters.set(name, current + (value || 1));
    }

    /**
   * Get current metrics
   */
    async getCurrentMetrics(): Promise<PerformanceMetrics> {
        await this.collectSystemMetrics();
        return { ...this.metrics };
    }

    /**
   * Get performance report
   */
    async getPerformanceReport(options?: {
    timeRange?: { start: Date; end: Date };
    includeMetrics?: string[];
    format?: 'json' | 'csv' | 'html';
  }): Promise<PerformanceReport> {
        const summary = this.generateSummary();
        const report: PerformanceReport = {
            id: `perf-report-${Date.now()}`,
            timestamp: new Date(),
            duration: (options?.timeRange?.end || new Date()).getTime() -
                    (options?.timeRange?.start || new Date(Date.now() - 3600000)).getTime(),
            metrics: { ...this.metrics },
            alerts: this.getActiveAlerts(),
            recommendations: this.generateRecommendations(),
            summary
        };

        return report;
    }

    /**
   * Check performance against thresholds
   */
    async checkThresholds(): Promise<PerformanceAlert[]> {
        const alerts: PerformanceAlert[] = [];

        // Check memory usage
        const memoryUsage = this.metrics.system.memoryUsage;
        const memoryThreshold = this.alertThresholds.get('memory');
        if (memoryThreshold && memoryUsage > memoryThreshold.warning) {
            alerts.push({
                type: memoryUsage > memoryThreshold.critical ? 'critical' : 'warning',
                category: 'memory',
                metric: 'memoryUsage',
                message: `High memory usage: ${this.formatBytes(memoryUsage)}`,
                value: memoryUsage,
                threshold: memoryThreshold.warning,
                timestamp: new Date(),
                severity: memoryUsage > memoryThreshold.critical ? 'critical' : 'warning'
            });
        }

        // Check CPU usage
        const cpuUsage = this.metrics.system.cpuUsage;
        const cpuThreshold = this.alertThresholds.get('cpu');
        if (cpuThreshold && cpuUsage > cpuThreshold.warning) {
            alerts.push({
                type: cpuUsage > cpuThreshold.critical ? 'critical' : 'warning',
                category: 'cpu',
                metric: 'cpuUsage',
                message: `High CPU usage: ${cpuUsage.toFixed(1)}%`,
                value: cpuUsage,
                threshold: cpuThreshold.warning,
                timestamp: new Date(),
                severity: cpuUsage > cpuThreshold.critical ? 'critical' : 'warning'
            });
        }

        // Check error rate
        const errorRate = this.metrics.extension.errorRate || 0;
        const errorThreshold = this.alertThresholds.get('errorRate');
        if (errorThreshold && errorRate > errorThreshold.warning) {
            alerts.push({
                type: errorRate > errorThreshold.critical ? 'critical' : 'warning',
                category: 'errorRate',
                metric: 'errorRate',
                message: `High error rate: ${(errorRate * 100).toFixed(1)}%`,
                value: errorRate,
                threshold: errorThreshold.warning,
                timestamp: new Date(),
                severity: errorRate > errorThreshold.critical ? 'critical' : 'warning'
            });
        }

        return alerts;
    }

    /**
   * Get resource usage history
   */
    async getResourceUsageHistory(options?: {
    timeRange?: { start: Date; end: Date };
    limit?: number;
  }): Promise<ResourceUsage[]> {
        let history = [...this.resourceUsageHistory];

        if (options?.timeRange) {
            history = history.filter(
                usage => usage.timestamp >= options.timeRange!.start && usage.timestamp <= options.timeRange!.end
            );
        }

        if (options?.limit) {
            history = history.slice(-options.limit);
        }

        return history;
    }

    /**
   * Configure performance monitoring
   */
    async configureMonitoring(config: Partial<ConfigPerformanceConfig>): Promise<void> {
        this.config = this.mergeConfig(config);
        this.restartMonitoring();
    }

    /**
   * Export performance data
   */
    async exportPerformanceData(format: 'json' | 'csv' | 'html'): Promise<string> {
        const report = await this.getPerformanceReport();

        switch (format) {
            case 'json':
                return JSON.stringify(report, null, 2);

            case 'csv':
                return this.exportToCsv(report);

            case 'html':
                return this.exportToHtml(report);

            default:
                throw new Error(`Unsupported export format: ${format}`);
        }
    }

    /**
   * Get performance alerts
   */
    async getPerformanceAlerts(): Promise<PerformanceAlert[]> {
        return this.getActiveAlerts();
    }

    /**
   * Clear performance data
   */
    async clearPerformanceData(options?: { olderThan?: Date }): Promise<void> {
        if (options?.olderThan !== undefined) {
            this.resourceUsageHistory = this.resourceUsageHistory.filter(
                usage => usage.timestamp >= options.olderThan!
            );
        } else {
            this.resourceUsageHistory = [];
            this.metrics = this.initializeMetrics();
            this.counters.clear();
            this.gauges.clear();
            this.startTimes.clear();
        }
    }

    /**
   * Start performance profiling
   */
    async startProfiling(operation: string): Promise<void> {
        if (!this.config.enableProfiling) {
            throw new Error('Profiling is not enabled');
        }

        this.startTimes.set(`profile_${operation}`, Date.now());
        console.log(`Started profiling: ${operation}`);
    }

    /**
   * Stop performance profiling
   */
    async stopProfiling(operation: string): Promise<PerformanceReport> {
        if (!this.config.enableProfiling) {
            throw new Error('Profiling is not enabled');
        }

        const startTime = this.startTimes.get(`profile_${operation}`);
        if (!startTime) {
            throw new Error(`No active profiling session for: ${operation}`);
        }

        const duration = Date.now() - startTime;
        this.startTimes.delete(`profile_${operation}`);

        console.log(`Stopped profiling: ${operation} (${duration}ms)`);

        return await this.getPerformanceReport({
            timeRange: { start: new Date(startTime), end: new Date() }
        });
    }

    /**
   * Dispose of resources
   */
    dispose(): void {
        this.disposables.forEach(disposable => disposable.dispose());
        this.disposables = [];
        this.activeMonitors.forEach(timer => clearInterval(timer));
        this.activeMonitors.clear();
        this.alertThresholds.clear();
        this.resourceUsageHistory = [];
        this.counters.clear();
        this.gauges.clear();
        this.startTimes.clear();
    }

    // Private helper methods

    private startPeriodicMonitoring(): void {
        if (!this.config.enableMonitoring) return;

        // System metrics monitoring
        const systemMonitor = setInterval(() => {
            this.collectSystemMetrics();
            this.checkThresholds();
        }, this.config.samplingInterval);

        this.activeMonitors.set('system', systemMonitor);

        // Report generation
        const reportMonitor = setInterval(() => {
            this.generatePeriodicReport();
        }, this.config.reportInterval);

        this.activeMonitors.set('report', reportMonitor);
    }

    private restartMonitoring(): void {
        this.activeMonitors.forEach(timer => clearInterval(timer));
        this.activeMonitors.clear();
        this.startPeriodicMonitoring();
    }

    private async collectSystemMetrics(): Promise<void> {
        try {
            const memUsage = process.memoryUsage();
            const cpuUsage = process.cpuUsage();

            this.metrics.system.memoryUsage = memUsage.heapUsed;
            this.metrics.system.uptime = process.uptime();
            this.metrics.system.activeHandles = (process as any).getActiveHandlesInfo ?
                (process as any).getActiveHandlesInfo().length : 0;
            this.metrics.system.activeRequests = (process as any).getActiveRequestsInfo ?
                (process as any).getActiveRequestsInfo().length : 0;

            // Calculate CPU usage percentage
            const totalCpuTime = cpuUsage.user + cpuUsage.system;
            const cpuPercentage = (totalCpuTime / (process.uptime() * 1000)) * 100;
            this.metrics.system.cpuUsage = cpuPercentage;

            // Record resource usage history
            this.resourceUsageHistory.push({
                timestamp: new Date(),
                memoryUsage: memUsage.heapUsed,
                cpuUsage: cpuPercentage,
                diskUsage: 0,
                networkUsage: 0,
                eventLoopDelay: this.metrics.system.eventLoopDelay
            });

            // Limit history size
            if (this.resourceUsageHistory.length > this.config.maxHistorySize) {
                this.resourceUsageHistory = this.resourceUsageHistory.slice(-this.config.maxHistorySize);
            }
        } catch (error) {
            console.error('Error collecting system metrics:', error);
        }
    }

    private updateTestMetrics(name: string, value: number): void {
        if (name === 'test_execution_time') {
            this.metrics.tests.averageExecutionTime =
        (this.metrics.tests.averageExecutionTime * (this.metrics.tests.totalExecuted - 1) + value) /
        this.metrics.tests.totalExecuted;
        } else if (name === 'test_success') {
            this.metrics.tests.successRate =
        (this.metrics.tests.successRate * (this.metrics.tests.totalExecuted - 1) + 1) /
        this.metrics.tests.totalExecuted;
        }
    }

    private updatePairCheckMetrics(name: string, value: number): void {
        if (name === 'paircheck_execution_time') {
            this.metrics.pairCheck.averageExecutionTime = value;
        } else if (name === 'paircheck_accuracy') {
            this.metrics.pairCheck.comparisonAccuracy = value;
        }
    }

    private updateCompilerMetrics(name: string, value: number): void {
        if (name === 'compiler_detection_time') {
            this.metrics.compilers.detectionTime = value;
        } else if (name === 'compiler_compilation_time') {
            this.metrics.compilers.compilationTime = value;
        }
    }

    private updateWebViewMetrics(name: string, value: number): void {
        if (name === 'webview_response_time') {
            this.metrics.webviews.averageResponseTime = value;
        } else if (name === 'webview_memory_usage') {
            this.metrics.webviews.memoryUsage = value;
        }
    }

    private updateEventMetrics(name: string, value: number): void {
        if (name === 'event_processing_time') {
            this.metrics.events.averageProcessingTime = value;
        } else if (name === 'event_count') {
            this.metrics.events.totalEvents = value;
        }
    }

    private generateSummary(): PerformanceSummary {
        return {
            overallHealth: this.calculateOverallHealth(),
            criticalAlerts: this.getActiveAlerts().filter(alert => alert.severity === 'critical').length,
            warningAlerts: this.getActiveAlerts().filter(alert => alert.severity === 'warning').length,
            averageResponseTime: this.metrics.extension.averageApiResponseTime || 0,
            uptime: this.metrics.system.uptime,
            totalEventsProcessed: this.metrics.extension.totalEventsProcessed || 0,
            memoryUsage: this.metrics.system.memoryUsage,
            cpuUsage: this.metrics.system.cpuUsage
        };
    }

    private calculateOverallHealth(): 'good' | 'warning' | 'critical' {
        const alerts = this.getActiveAlerts();
        const criticalAlerts = alerts.filter(alert => alert.severity === 'critical').length;
        const warningAlerts = alerts.filter(alert => alert.severity === 'warning').length;

        if (criticalAlerts > 0) return 'critical';
        if (warningAlerts > 2) return 'warning';
        if (warningAlerts > 0) return 'warning';
        return 'good';
    }

    private getActiveAlerts(): PerformanceAlert[] {
        const alerts: PerformanceAlert[] = [];

        // Check current metrics against thresholds
        this.alertThresholds.forEach((threshold, type) => {
            let currentValue = 0;

            switch (type) {
                case 'memory':
                    currentValue = this.metrics.system.memoryUsage;
                    break;
                case 'cpu':
                    currentValue = this.metrics.system.cpuUsage;
                    break;
                case 'errorRate':
                    currentValue = this.metrics.extension.errorRate || 0;
                    break;
            }

            if (currentValue > threshold.warning) {
                alerts.push({
                    type: currentValue > threshold.critical ? 'critical' : 'warning',
                    category: 'performance',
                    metric: type,
                    severity: currentValue > threshold.critical ? 'critical' : 'warning',
                    message: `${type} threshold exceeded: ${currentValue} > ${threshold.warning}`,
                    value: currentValue,
                    threshold: threshold.warning,
                    timestamp: new Date()
                });
            }
        });

        return alerts;
    }

    private generateRecommendations(): string[] {
        const recommendations: string[] = [];
        const alerts = this.getActiveAlerts();

        alerts.forEach(alert => {
            switch (alert.category) {
                case 'memory':
                    recommendations.push('Consider reducing memory usage or increasing available memory');
                    break;
                case 'cpu':
                    recommendations.push('High CPU usage detected. Consider optimizing operations');
                    break;
                case 'errorRate':
                    recommendations.push('High error rate detected. Review error logs and fix issues');
                    break;
                case 'responseTime':
                    recommendations.push('Slow response times detected. Consider optimizing API calls');
                    break;
            }
        });

        return recommendations;
    }

    private getSystemInfo(): any {
        return {
            platform: process.platform,
            arch: process.arch,
            nodeVersion: process.version,
            memoryTotal: this.formatBytes(process.memoryUsage().heapTotal),
            uptime: this.formatDuration(process.uptime())
        };
    }

    private async generatePeriodicReport(): Promise<void> {
        if (!this.config.enableMonitoring) return;

        const report = await this.getPerformanceReport();
        console.log('Performance Report:', report);

        // Emit performance report event
        const event: PerformanceReportEvent = {
            type: 'performance:report',
            timestamp: new Date(),
            report
        };
        this.eventSystem.emit(event);
    }

    private exportToCsv(report: PerformanceReport): string {
        const rows = [
            ['Metric', 'Value', 'Timestamp'],
            ['Memory Usage',
                this.formatBytes(report.metrics.system.memoryUsage),
                report.timestamp.toISOString()],
            ['CPU Usage',
                `${report.metrics.system.cpuUsage.toFixed(1)}%`,
                report.timestamp.toISOString()],
            ['Error Rate',
                `${((report.metrics.extension.errorRate ?? 0) * 100).toFixed(1)}%`,
                report.timestamp.toISOString()],
            ['Average Response Time',
                `${(report.metrics.extension.averageApiResponseTime ?? 0)}ms`,
                report.timestamp.toISOString()],
            ['Total Events',
                (report.metrics.extension.totalEventsProcessed ?? 0).toString(),
                report.timestamp.toISOString()]
        ];

        return rows.map(row => row.join(',')).join('\n');
    }

    private exportToHtml(report: PerformanceReport): string {
        return `
<!DOCTYPE html>
<html>
<head>
    <title>Performance Report</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .metric { margin: 10px 0; padding: 10px; border: 1px solid #ddd; }
        .warning { background-color: #fff3cd; }
        .critical { background-color: #f8d7da; }
        .good { background-color: #d4edda; }
        table { width: 100%; border-collapse: collapse; }
        th, td { padding: 8px; text-align: left; border-bottom: 1px solid #ddd; }
    </style>
</head>
<body>
    <h1>Performance Report</h1>
    <p>Generated: ${report.timestamp.toISOString()}</p>
    
    <div class="metric ${report.summary.overallHealth}">
        <h2>Overall Health: ${report.summary.overallHealth.toUpperCase()}</h2>
    </div>

    <h2>System Metrics</h2>
    <table>
        <tr><th>Metric</th><th>Value</th></tr>
        <tr><td>Memory Usage</td><td>${this.formatBytes(report.metrics.system.memoryUsage)}</td></tr>
        <tr><td>CPU Usage</td><td>${report.metrics.system.cpuUsage.toFixed(1)}%</td></tr>
        <tr><td>Uptime</td><td>${this.formatDuration(report.metrics.system.uptime)}</td></tr>
    </table>

    <h2>Extension Metrics</h2>
    <table>
        <tr><th>Metric</th><th>Value</th></tr>
        <tr><td>Total Events</td><td>${report.metrics.extension.totalEventsProcessed ?? 0}</td></tr>
        <tr><td>Error Rate</td><td>${((report.metrics.extension.errorRate ?? 0) * 100).toFixed(1)}%</td></tr>
        <tr><td>Average Response Time</td><td>${report.metrics.extension.averageApiResponseTime ?? 0}ms</td></tr>
    </table>

    <h2>Alerts</h2>
    ${report.alerts.map(alert => `
        <div class="metric ${alert.severity}">
            <strong>${alert.severity.toUpperCase()}</strong>: ${alert.message}
        </div>
    `).join('')}
</body>
</html>
    `;
    }

    private formatBytes(bytes: number): string {
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        if (bytes === 0) return '0 Bytes';
        const i = Math.floor(Math.log(bytes) / Math.log(1024));
        return `${Math.round(bytes / Math.pow(1024, i) * 100) / 100} ${sizes[i]}`;
    }

    private formatDuration(seconds: number): string {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const remainingSeconds = Math.floor(seconds % 60);

        if (hours > 0) {
            return `${hours}h ${minutes}m ${remainingSeconds}s`;
        } else if (minutes > 0) {
            return `${minutes}m ${remainingSeconds}s`;
        } else {
            return `${remainingSeconds}s`;
        }
    }

    // Interface implementations
    async stopMonitoring(): Promise<void> {
        this.activeMonitors.forEach((timer, key) => {
            clearInterval(timer);
            this.activeMonitors.delete(key);
        });
    }

    getMetrics(): PerformanceMetrics {
        return { ...this.metrics };
    }

    async generateReport(): Promise<PerformanceReport> {
        return this.getPerformanceReport();
    }
}
