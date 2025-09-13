/* ---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *-------------------------------------------------------------------------------------------- */

import {
    ExtensionEvent,
    Disposable,
    EventHandlerErrorEvent
} from '../types/models';
import {
    EventBus,
    EventStore,
    EventPipeline,
    EventScheduler,
    EventHistory,
    EventMetricsCollector,
    EventDiagnostics,
    EventConfig,
    EventSubscription,
    EventProcessor,
    EventQueryOptions,
    EventClearOptions,
    EventStoreStats,
    EventMiddleware,
    EventHandler,
    EventListenerOptions,
    ScheduledEvent,
    EventStats,
    EventValidator,
    EventSerializer,
    EventDiagnosticResult,
    DiagnosticIssue,
    EventSystemHealth,
    EventMetrics
} from '../types/events';

/**
 * Event System Implementation
 *
 * This module provides a comprehensive event system for the OI-Code extension,
 * supporting event emission, handling, storage, and processing.
 */
export class EventSystem implements EventBus, Disposable {
    private static instance: EventSystem;
    private subscriptions: Map<string, EventSubscription[]> = new Map();
    private store: EventStore;
    private pipeline: EventPipeline;
    private scheduler: EventScheduler;
    private history: EventHistory;
    private metrics: EventMetricsCollector;
    private diagnostics: EventDiagnostics;
    private validator: EventValidator;
    private serializer: EventSerializer;
    private middleware: EventMiddleware[] = [];
    private config: EventConfig;
    private isDisposed: boolean = false;

    private constructor(config: EventConfig = EventSystem.getDefaultConfig()) {
        this.config = config;
        this.store = new InMemoryEventStore(config);
        this.pipeline = new EventPipelineImpl();
        this.scheduler = new EventSchedulerImpl();
        this.history = new InMemoryEventHistory(config);
        this.metrics = new EventMetricsCollectorImpl();
        this.diagnostics = new EventDiagnosticsImpl();
        this.validator = new EventValidatorImpl();
        this.serializer = new EventSerializerImpl();

        this.setupMiddleware();
    }

    public static getInstance(config?: EventConfig): EventSystem {
        if (!EventSystem.instance) {
            EventSystem.instance = new EventSystem(config);
        }
        return EventSystem.instance;
    }

    public static getDefaultConfig(): EventConfig {
        return {
            maxHistorySize: 1000,
            processingTimeout: 5000,
            enableMetrics: true,
            enableDiagnostics: true,
            enablePipeline: true,
            enableScheduler: true,
            storeConfig: {
                maxSize: 5000,
                retentionPeriod: 30,
                compressionEnabled: false
            }
        };
    }

    /**
   * Register event listener
   */
    public on<T extends ExtensionEvent>(
        eventType: T['type'],
        handler: EventHandler<T>,
        options?: EventListenerOptions
    ): Disposable {
        if (this.isDisposed) {
            throw new Error('EventSystem has been disposed');
        }

        const subscription: EventSubscription = {
            id: this.generateSubscriptionId(),
            eventType,
            handler: handler as EventHandler,
            options: options ? { ...options } : {},
            isActive: true
        };

        if (!this.subscriptions.has(eventType)) {
            this.subscriptions.set(eventType, []);
        }

    this.subscriptions.get(eventType)!.push(subscription);

    return {
        dispose: () => {
            this.off(eventType, handler as EventHandler);
        }
    };
    }

    /**
   * Register one-time event listener
   */
    public once<T extends ExtensionEvent>(
        eventType: T['type'],
        handler: EventHandler<T>,
        options?: EventListenerOptions
    ): void {
        const onceHandler: EventHandler<T> = (event) => {
            this.off(eventType, onceHandler);
            handler(event);
        };

        this.on(eventType, onceHandler, { ...options, once: true });
    }

    /**
   * Emit event
   */
    public async emit<T extends ExtensionEvent>(event: T): Promise<void> {
        if (this.isDisposed) {
            return;
        }

        const startTime = Date.now();

        try {
            // Validate event
            const validationResult = this.validator.validate(event);
            if (!validationResult.valid) {
                console.warn(`Invalid event ${event.type}:`, validationResult.errors);
                return;
            }

            // Set timestamp if not set
            if (!event.timestamp) {
                event.timestamp = new Date();
            }

            // Store event if store config is available
            if (this.config.storeConfig) {
                await this.store.store(event);
            }

            // Add to history
            await this.history.addToHistory(event);

            // Process through middleware
            await this.processThroughMiddleware(event);

            // Process through pipeline
            await this.pipeline.process(event);

            // Get handlers for this event type
            const handlers = this.getHandlersForEvent(event.type);

            // Execute handlers
            const promises = handlers.map(async (subscription) => {
                if (!subscription.isActive) return;

                try {
                    // Apply filter if provided
                    if (subscription.options.filter && !subscription.options.filter(event)) {
                        return;
                    }

                    await subscription.handler(event);
                } catch (error) {
                    console.error(`Error in event handler for ${event.type}:`, error);

                    // Emit error event
                    await this.emit({
                        type: 'event:handler-error',
                        timestamp: new Date(),
                        handlerError: {
                            eventType: event.type,
                            error: error instanceof Error ? error.message : String(error),
                            subscriptionId: subscription.id
                        }
                    } as EventHandlerErrorEvent);
                }
            });

            await Promise.allSettled(promises);

            // Record metrics if enabled
            if (this.config.enableMetrics) {
                const processingTime = Date.now() - startTime;
                this.metrics.recordTiming(event.type, 'processing', processingTime);
                this.metrics.incrementCounter(event.type, 'emitted');
            }
        } catch (error) {
            console.error(`Error emitting event ${event.type}:`, error);

            // Record error metrics
            if (this.config.enableMetrics) {
                this.metrics.incrementCounter(event.type, 'errors');
            }
        }
    }

    /**
   * Remove event listener
   */
    public off<T extends ExtensionEvent>(eventType: T['type'], handler: EventHandler<T>): void {
        const handlers = this.subscriptions.get(eventType);
        if (!handlers) return;

        const index = handlers.findIndex(sub => sub.handler === handler);
        if (index !== -1) {
            handlers.splice(index, 1);

            if (handlers.length === 0) {
                this.subscriptions.delete(eventType);
            }
        }
    }

    /**
   * Get all subscriptions
   */
    public getSubscriptions(): EventSubscription[] {
        const allSubscriptions: EventSubscription[] = [];
        for (const handlers of this.subscriptions.values()) {
            allSubscriptions.push(...handlers);
        }
        return allSubscriptions;
    }

    /**
   * Remove all listeners for event type
   */
    public removeAllListeners(eventType: string): void {
        this.subscriptions.delete(eventType);
    }

    /**
   * Clear all subscriptions
   */
    public clear(): void {
        this.subscriptions.clear();
    }

    /**
   * Get event statistics
   */
    public async getStats(): Promise<EventStats> {
        const history = await this.history.getHistory();
        const totalEvents = history.length;
        const eventsByType: Record<string, number> = {};

        for (const [eventType, handlers] of this.subscriptions) {
            eventsByType[eventType] = handlers.length;
        }

        const lastEventTime = null; // TODO: Implement async last event tracking

        return {
            totalEvents,
            eventsByType,
            averageProcessingTime: this.metrics.getMetrics().averageProcessingTime,
            lastEventTime,
            subscriptionsByType: eventsByType
        };
    }

    /**
   * Get store reference
   */
    public getStore(): EventStore {
        return this.store;
    }

    /**
   * Get pipeline reference
   */
    public getPipeline(): EventPipeline {
        return this.pipeline;
    }

    /**
   * Get scheduler reference
   */
    public getScheduler(): EventScheduler {
        return this.scheduler;
    }

    /**
   * Get history reference
   */
    public getHistory(): EventHistory {
        return this.history;
    }

    /**
   * Get metrics reference
   */
    public getMetrics(): EventMetricsCollector {
        return this.metrics;
    }

    /**
   * Get diagnostics reference
   */
    public getDiagnostics(): EventDiagnostics {
        return this.diagnostics;
    }

    /**
   * Update configuration
   */
    public updateConfig(config: Partial<EventConfig>): void {
        this.config = { ...this.config, ...config };
    }

    /**
   * Add middleware
   */
    public addMiddleware(middleware: EventMiddleware): void {
        this.middleware.push(middleware);
    }

    /**
   * Dispose event system
   */
    public async dispose(): Promise<void> {
        this.isDisposed = true;
        // Clear all subscriptions
        this.subscriptions.clear();
        await this.history.clearHistory();
        this.metrics.reset();
    }

    private getHandlersForEvent(eventType: string): EventSubscription[] {
        const handlers = this.subscriptions.get(eventType) || [];

        // Sort by priority if specified
        return handlers.sort((a, b) => {
            const priorityA = a.options.priority || 0;
            const priorityB = b.options.priority || 0;
            return priorityB - priorityA;
        });
    }

    private generateSubscriptionId(): string {
        return `sub_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    private async processThroughMiddleware(event: ExtensionEvent): Promise<void> {
        let processedEvent = event;

        for (const middleware of this.middleware) {
            processedEvent = await middleware.use(processedEvent, async () => {
                return processedEvent;
            });
        }
    }

    private setupMiddleware(): void {
    // Add logging middleware
        this.addMiddleware({
            use: async (event, next) => {
                if (this.config.enableDiagnostics) {
                    console.log(`[Event] ${event.type}`, event);
                }
                return await next();
            },
            getName() {
                return 'logging';
            }
        });

        // Add timing middleware
        this.addMiddleware({
            use: async (event, next) => {
                const startTime = Date.now();
                const result = await next();
                const duration = Date.now() - startTime;

                if (this.config.enableMetrics) {
                    this.metrics.recordTiming(event.type, 'middleware', duration);
                }
                return result;
            },
            getName() {
                return 'timing';
            }
        });
    }
}

/**
 * In-memory event store implementation
 */
class InMemoryEventStore implements EventStore {
    private events: ExtensionEvent[] = [];
    private maxSize: number;
    private retentionPeriod: number;

    constructor(config: EventConfig) {
        this.maxSize = config.storeConfig?.maxSize || 5000;
        this.retentionPeriod = config.storeConfig?.retentionPeriod || 30;
    }

    public async store(event: ExtensionEvent): Promise<void> {
        this.events.push(event);

        // Enforce size limit
        if (this.events.length > this.maxSize) {
            this.events = this.events.slice(-this.maxSize);
        }

        // Clean old events
        await this.cleanup();
    }

    public async getEvents<T extends ExtensionEvent>(
        eventType: T['type']
    ): Promise<T[]> {
        return this.events
            .filter(e => e.type === eventType)
            .map(e => e as T) as T[];
    }

    public async getRecentEvents(limit?: number): Promise<ExtensionEvent[]> {
        const recent = this.events.slice(-(limit ?? 50));
        return recent.reverse();
    }

    public async clear(options?: EventClearOptions): Promise<void> {
        if (!options) {
            this.events = [];
            return;
        }

        if (options.before) {
            this.events = this.events.filter(e => e.timestamp > options.before!);
        }

        if (options.types && options.types.length > 0) {
            this.events = this.events.filter(e => !options.types!.includes(e.type));
        }

        if (options.keepLast && options.keepLast > 0) {
            this.events = this.events.slice(-options.keepLast);
        }
    }

    public async getStats(): Promise<EventStoreStats> {
        const oldestEvent = this.events[0];
        const newestEvent = this.events[this.events.length - 1];

        const eventsByType: Record<string, number> = {};
        for (const event of this.events) {
            eventsByType[event.type] = (eventsByType[event.type] || 0) + 1;
        }

        return {
            totalEvents: this.events.length,
            eventsByType,
            averageProcessingTime: 0, // Not tracked in this implementation
            lastEventTime: newestEvent?.timestamp || null,
            subscriptionsByType: {}, // Not tracked in this implementation
            oldestEventTime: oldestEvent?.timestamp || null,
            newestEventTime: newestEvent?.timestamp || null,
            storageSize: JSON.stringify(this.events).length
        };
    }

    private async cleanup(): Promise<void> {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - this.retentionPeriod);

        this.events = this.events.filter(e => e.timestamp > cutoffDate);
    }
}

/**
 * Event pipeline implementation
 */
class EventPipelineImpl implements EventPipeline {
    private processors: EventProcessor[] = [];

    public addProcessor(processor: EventProcessor): void {
        this.processors.push(processor);
    }

    public removeProcessor(processor: EventProcessor): void {
        const index = this.processors.indexOf(processor);
        if (index !== -1) {
            this.processors.splice(index, 1);
        }
    }

    public async process<T extends ExtensionEvent>(event: T): Promise<T> {
        const applicableProcessors = this.processors
            .filter(p => p.canHandle(event.type))
            .sort((a, b) => b.getPriority() - a.getPriority());

        for (const processor of applicableProcessors) {
            try {
                await processor.process(event);
            } catch (error) {
                console.error(`Error in event processor ${processor.constructor.name}:`, error);
            }
        }
        return event;
    }

    public getProcessors(): EventProcessor[] {
        return [...this.processors];
    }
}

/**
 * Event scheduler implementation
 */
class EventSchedulerImpl implements EventScheduler {
    private scheduledEvents: Map<string, ScheduledEvent> = new Map();
    private cleanupInterval?: NodeJS.Timeout;

    constructor() {
        this.startCleanupTimer();
    }

    public async schedule<T extends ExtensionEvent>(event: T, delay: number): Promise<void> {
        return new Promise((resolve) => {
            const executeAt = new Date(Date.now() + delay);
            const id = this.generateEventId();

            const scheduledEvent: ScheduledEvent = {
                id,
                event,
                scheduledTime: executeAt,
                isActive: true
            };

            this.scheduledEvents.set(id, scheduledEvent);

            const timeout = setTimeout(async () => {
                try {
                    await EventSystem.getInstance().emit(event);
                    resolve();
                } finally {
                    this.scheduledEvents.delete(id);
                }
            }, delay);

            (scheduledEvent as any).timeout = timeout;
        });
    }

    public scheduleRecurring<T extends ExtensionEvent>(event: T, interval: number): Disposable {
        const id = this.generateEventId();

        const executeEvent = async () => {
            try {
                await EventSystem.getInstance().emit(event);
            } catch (error) {
                console.error(`Error in recurring event ${event.type}:`, error);
            }
        };

        const intervalId = setInterval(executeEvent, interval);

        const scheduledEvent: ScheduledEvent = {
            id,
            event,
            scheduledTime: new Date(),
            interval,
            isActive: true
        };

        this.scheduledEvents.set(id, scheduledEvent);

        return {
            dispose: () => {
                clearInterval(intervalId);
                this.scheduledEvents.delete(id);
            }
        };
    }

    public cancel(eventId: string): boolean {
        const scheduledEvent = this.scheduledEvents.get(eventId);
        if (!scheduledEvent) {
            return false;
        }

        if (!scheduledEvent.interval) {
            clearTimeout((scheduledEvent as any).timeout);
        }

        this.scheduledEvents.delete(eventId);
        return true;
    }

    public getScheduledEvents(): ScheduledEvent[] {
        return Array.from(this.scheduledEvents.values());
    }

    public clear(): void {
        for (const event of this.scheduledEvents.values()) {
            if (!event.interval) {
                clearTimeout((event as any).timeout);
            }
        }
        this.scheduledEvents.clear();
    }

    private generateEventId(): string {
        return `sched_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    private startCleanupTimer(): void {
        this.cleanupInterval = setInterval(() => {
            const now = Date.now();
            for (const [id, event] of this.scheduledEvents.entries()) {
                if (!event.interval && event.scheduledTime.getTime() < now - 60000) {
                    this.cancel(id);
                }
            }
        }, 60000); // Clean up every minute
    }
}

/**
 * In-memory event history implementation
 */
class InMemoryEventHistory implements EventHistory {
    private entries: any[] = [];
    private maxSize: number;

    constructor(config: EventConfig) {
        this.maxSize = config.maxHistorySize || 1000;
    }

    public async addToHistory(event: ExtensionEvent): Promise<void> {
        const entry = {
            id: this.generateEntryId(),
            event,
            timestamp: new Date(),
            processed: false
        };

        this.entries.push(entry);

        if (this.entries.length > this.maxSize) {
            this.entries = this.entries.slice(-this.maxSize);
        }
    }

    public async getEvents(options?: EventQueryOptions): Promise<ExtensionEvent[]> {
        let history = [...this.entries];

        if (options?.filter) {
            history = history.filter(options.filter);
        }

        if (options?.sortBy) {
            history.sort((a, b) => {
                const aValue = a[options.sortBy!];
                const bValue = b[options.sortBy!];
                const order = options.sortOrder === 'desc' ? -1 : 1;
                return (aValue > bValue ? 1 : -1) * order;
            });
        }

        if (options?.limit) {
            const start = options.offset || 0;
            const end = start + options.limit;
            history = history.slice(start, end);
        }

        return history.map(entry => entry.event);
    }

    public search(query: any): any[] {
        return this.entries.filter(entry => {
            if (query.eventType && entry.event.type !== query.eventType) {
                return false;
            }

            if (query.timeRange) {
                const timestamp = entry.event.timestamp;
                if (timestamp < query.timeRange.start || timestamp > query.timeRange.end) {
                    return false;
                }
            }

            if (query.success !== undefined && entry.processed !== query.success) {
                return false;
            }

            if (query.search) {
                const eventStr = JSON.stringify(entry.event).toLowerCase();
                if (!eventStr.includes(query.search.toLowerCase())) {
                    return false;
                }
            }

            return true;
        });
    }

    public async clearHistory(): Promise<void> {
        this.entries = [];
    }

    public async getHistory(options?: EventQueryOptions): Promise<ExtensionEvent[]> {
        return this.getEvents(options);
    }

    public async getRecentEvents(limit?: number): Promise<ExtensionEvent[]> {
        const recent = this.entries.slice(-(limit ?? 10));
        return recent.map(entry => entry.event);
    }

    public getStats(): any {
        const totalEntries = this.entries.length;
        const entriesByType: Record<string, number> = {};
        let totalProcessingTime = 0;
        let processedCount = 0;

        for (const entry of this.entries) {
            entriesByType[entry.event.type] = (entriesByType[entry.event.type] || 0) + 1;

            if (entry.processingTime) {
                totalProcessingTime += entry.processingTime;
                processedCount++;
            }
        }

        const oldestEntry = this.entries[0];
        const newestEntry = this.entries[this.entries.length - 1];

        return {
            totalEntries,
            entriesByType,
            successRate: processedCount > 0 ? processedCount / totalEntries : 0,
            averageProcessingTime: processedCount > 0 ? totalProcessingTime / processedCount : 0,
            oldestEntry: oldestEntry?.timestamp,
            newestEntry: newestEntry?.timestamp
        };
    }

    private generateEntryId(): string {
        return `hist_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
}

/**
 * Event metrics collector implementation
 */
class EventMetricsCollectorImpl implements EventMetricsCollector {
    private metrics: any = {
        counters: {},
        timings: {},
        gauges: {},
        timestamps: {}
    };

    public recordMetric(eventType: string, processingTime: number): void {
        const key = `${eventType}.processingTime`;
        this.metrics.gauges[key] = processingTime;
        this.metrics.timestamps[key] = new Date();
    }

    public incrementCounter(eventType: string, counterName: string, value: number = 1): void {
        const key = `${eventType}.${counterName}`;
        this.metrics.counters[key] = (this.metrics.counters[key] || 0) + value;
    }

    public recordTiming(eventType: string, operation: string, duration: number): void {
        const key = `${eventType}.${operation}`;

        if (!this.metrics.timings[key]) {
            this.metrics.timings[key] = {
                count: 0,
                total: 0,
                average: 0,
                min: Infinity,
                max: 0
            };
        }

        const timing = this.metrics.timings[key];
        timing.count++;
        timing.total += duration;
        timing.average = timing.total / timing.count;
        timing.min = Math.min(timing.min, duration);
        timing.max = Math.max(timing.max, duration);
    }

    public getMetrics(eventType?: string): any {
        if (!eventType) {
            return { ...this.metrics };
        }

        const result: any = {
            counters: {},
            timings: {},
            gauges: {},
            timestamps: {}
        };

        const prefix = `${eventType}.`;

        for (const [key, value] of Object.entries(this.metrics.counters)) {
            if (key.startsWith(prefix)) {
                result.counters[key] = value;
            }
        }

        for (const [key, value] of Object.entries(this.metrics.timings)) {
            if (key.startsWith(prefix)) {
                result.timings[key] = value;
            }
        }

        for (const [key, value] of Object.entries(this.metrics.gauges)) {
            if (key.startsWith(prefix)) {
                result.gauges[key] = value;
            }
        }

        for (const [key, value] of Object.entries(this.metrics.timestamps)) {
            if (key.startsWith(prefix)) {
                result.timestamps[key] = value;
            }
        }

        return result;
    }

    public reset(eventType?: string): void {
        if (!eventType) {
            this.metrics = {
                counters: {},
                timings: {},
                gauges: {},
                timestamps: {}
            };
            return;
        }

        const prefix = `${eventType}.`;

        // Remove metrics for this event type
        for (const key of Object.keys(this.metrics.counters)) {
            if (key.startsWith(prefix)) {
                delete this.metrics.counters[key];
            }
        }

        for (const key of Object.keys(this.metrics.timings)) {
            if (key.startsWith(prefix)) {
                delete this.metrics.timings[key];
            }
        }

        for (const key of Object.keys(this.metrics.gauges)) {
            if (key.startsWith(prefix)) {
                delete this.metrics.gauges[key];
            }
        }

        for (const key of Object.keys(this.metrics.timestamps)) {
            if (key.startsWith(prefix)) {
                delete this.metrics.timestamps[key];
            }
        }
    }

    public export(): any {
        return {
            timestamp: new Date(),
            metrics: this.getMetrics(),
            summary: {
                totalEvents: (Object.values(this.metrics.counters) as number[]).reduce((a, b) => a + b, 0),
                averageProcessingTime: this.calculateAverageProcessingTime(),
                errorRate: this.calculateErrorRate()
            }
        };
    }

    private calculateAverageProcessingTime(): number {
        const processingTimes = Object.values(this.metrics.timings)
            .map((t: any) => t.average)
            .filter(time => time > 0);

        return processingTimes.length > 0
            ? processingTimes.reduce((a, b) => a + b, 0) / processingTimes.length
            : 0;
    }

    private calculateErrorRate(): number {
        const totalEvents = (Object.values(this.metrics.counters) as number[])
            .reduce((a, b) => a + b, 0);
        const totalErrors = this.metrics.counters['*.errors'] || 0;

        return totalEvents > 0 ? totalErrors / totalEvents : 0;
    }
}

/**
 * Event diagnostics implementation
 */
class EventDiagnosticsImpl implements EventDiagnostics {
    public async collectDiagnostics(): Promise<any> {
        const eventSystem = EventSystem.getInstance();
        const stats = await eventSystem.getStats();
        const metrics = eventSystem.getMetrics().getMetrics();

        return {
            systemInfo: {
                uptime: process.uptime() * 1000,
                memoryUsage: process.memoryUsage(),
                eventLoopDelay: this.measureEventLoopDelay()
            },
            eventStats: stats,
            subscriptionStats: {
                totalSubscriptions: eventSystem.getSubscriptions().length,
                subscriptionsByType: stats.eventsByType
            },
            performanceMetrics: {
                throughput: {
                    eventsPerSecond: this.calculateEventsPerSecond(),
                    peakEventsPerSecond: this.calculatePeakEventsPerSecond()
                },
                latency: {
                    average: this.calculateAverageLatency(metrics),
                    p95: this.calculateP95Latency(),
                    p99: this.calculateP99Latency(),
                    max: this.calculateMaxLatency(metrics)
                },
                errorRate: this.calculateErrorRate(metrics),
                queueSize: 0, // TODO: Implement queue size tracking
                processingTime: {
                    average: stats.averageProcessingTime,
                    p95: this.calculateP95ProcessingTime(),
                    p99: this.calculateP99ProcessingTime()
                }
            },
            recommendations: this.generateRecommendations(stats, metrics)
        };
    }

    public async healthCheck(): Promise<any> {
        const diagnostics = await this.collectDiagnostics();
        const checks: any[] = [];

        // Check memory usage
        const memoryUsage = diagnostics.systemInfo.memoryUsage;
        const memoryScore = this.calculateMemoryScore(memoryUsage);
        checks.push({
            name: 'Memory Usage',
            status: memoryScore > 0.8 ? 'critical' : memoryScore > 0.6 ? 'warning' : 'healthy',
            score: memoryScore,
            message: `Memory usage: ${Math.round(memoryUsage.heapUsed / 1024 / 1024)}MB`,
            details: memoryUsage
        });

        // Check event processing time
        const avgProcessingTime = diagnostics.eventStats.averageProcessingTime;
        const processingScore = this.calculateProcessingScore(avgProcessingTime);
        checks.push({
            name: 'Event Processing',
            status: processingScore > 0.8 ? 'critical' : processingScore > 0.6 ? 'warning' : 'healthy',
            score: processingScore,
            message: `Average processing time: ${avgProcessingTime.toFixed(2)}ms`,
            details: { avgProcessingTime }
        });

        // Check error rate
        const errorRate = diagnostics.performanceMetrics.errorRate;
        const errorScore = 1 - errorRate;
        checks.push({
            name: 'Error Rate',
            status: errorScore > 0.9 ? 'healthy' : errorScore > 0.7 ? 'warning' : 'critical',
            score: errorScore,
            message: `Error rate: ${(errorRate * 100).toFixed(2)}%`,
            details: { errorRate }
        });

        const overallScore = checks.reduce((sum, check) => sum + check.score, 0) / checks.length;
        const issues = this.generateHealthIssues(checks);

        return {
            healthy: overallScore > 0.8,
            checks,
            overallScore,
            issues
        };
    }

    public async runDiagnostics(): Promise<EventDiagnosticResult> {
        const diagnostics = await this.collectDiagnostics();
        const healthCheck = await this.healthCheck();

        // Convert health check issues to DiagnosticIssue format
        const issues: DiagnosticIssue[] = [];

        // Add health check issues
        healthCheck.issues.forEach((issue: any) => {
            issues.push({
                type: issue.severity === 'critical' ? 'error' : 'warning',
                component: issue.category,
                message: issue.message,
                severity: issue.severity
            });
        });

        // Add performance-based issues
        if (diagnostics.eventStats.averageProcessingTime > 100) {
            issues.push({
                type: 'warning',
                component: 'EventBus',
                message: `High average processing time: ${diagnostics.eventStats.averageProcessingTime}ms`,
                severity: 'medium'
            });
        }

        if (diagnostics.performanceMetrics.errorRate > 0.05) {
            issues.push({
                type: 'warning',
                component: 'EventSystem',
                message: `High error rate: ${(diagnostics.performanceMetrics.errorRate * 100).toFixed(2)}%`,
                severity: 'high'
            });
        }

        // Generate recommendations
        const recommendations: string[] = [];

        if (healthCheck.overallScore < 0.8) {
            recommendations.push('System performance is degraded. Consider optimizing event handlers.');
        }

        if (diagnostics.eventStats.averageProcessingTime > 100) {
            recommendations.push('Optimize event processing to reduce latency.');
        }

        if (diagnostics.performanceMetrics.errorRate > 0.05) {
            recommendations.push('Review and improve error handling in event processors.');
        }

        // Add general recommendations
        recommendations.push('Monitor system memory usage and event processing metrics.');
        recommendations.push('Consider implementing event batching for high-frequency events.');

        return {
            healthy: healthCheck.healthy,
            issues,
            recommendations
        };
    }

    public async getSystemHealth(): Promise<EventSystemHealth> {
        const healthCheck = await this.healthCheck();
        const diagnostics = await this.collectDiagnostics();

        // Determine overall health status
        let overall: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
        if (healthCheck.overallScore < 0.5) {
            overall = 'unhealthy';
        } else if (healthCheck.overallScore < 0.8) {
            overall = 'degraded';
        }

        // Determine component health
        const components: Record<string, 'healthy' | 'degraded' | 'unhealthy'> = {};

        // EventBus health
        const eventBusScore = healthCheck.checks.find((c: any) => c.name === 'Event Processing')?.score || 1;
        components.eventBus = eventBusScore > 0.8 ? 'healthy' : eventBusScore > 0.6 ? 'degraded' : 'unhealthy';

        // EventStore health (based on memory usage)
        const memoryScore = healthCheck.checks.find((c: any) => c.name === 'Memory Usage')?.score || 1;
        components.eventStore = memoryScore > 0.8 ? 'healthy' : memoryScore > 0.6 ? 'degraded' : 'unhealthy';

        // EventPipeline health (assume healthy for now)
        components.eventPipeline = 'healthy';

        // EventScheduler health (assume healthy for now)
        components.eventScheduler = 'healthy';

        // MetricsCollector health
        const errorScore = healthCheck.checks.find((c: any) => c.name === 'Error Rate')?.score || 1;
        components.metricsCollector = errorScore > 0.9 ? 'healthy' : errorScore > 0.7 ? 'degraded' : 'unhealthy';

        // Create EventMetrics from available data
        const eventMetrics: EventMetrics = {
            totalEvents: diagnostics.eventStats.totalEvents,
            averageProcessingTime: diagnostics.eventStats.averageProcessingTime,
            eventsByType: diagnostics.eventStats.eventsByType,
            slowestEvents: [] // Would need to be implemented with tracking
        };

        return {
            overall,
            components,
            metrics: eventMetrics
        };
    }

    public async getPerformanceMetrics(): Promise<any> {
        const eventSystem = EventSystem.getInstance();
        const metrics = eventSystem.getMetrics().getMetrics();
        const stats = await eventSystem.getStats();

        return {
            throughput: {
                eventsPerSecond: this.calculateEventsPerSecond(),
                peakEventsPerSecond: this.calculatePeakEventsPerSecond()
            },
            latency: {
                average: this.calculateAverageLatency(metrics),
                p95: this.calculateP95Latency(),
                p99: this.calculateP99Latency(),
                max: this.calculateMaxLatency(metrics)
            },
            errorRate: this.calculateErrorRate(metrics),
            queueSize: 0, // TODO: Implement queue size tracking
            processingTime: {
                average: stats.averageProcessingTime,
                p95: this.calculateP95ProcessingTime(),
                p99: this.calculateP99ProcessingTime()
            }
        };
    }

    private measureEventLoopDelay(): Promise<number> {
        const start = Date.now();

        // Use setImmediate to measure event loop delay
        return new Promise((resolve) => {
            setImmediate(() => {
                resolve(Date.now() - start);
            });
        });
    }

    private calculateEventsPerSecond(): number {
    // This would need to be implemented with time-based tracking
        return 0;
    }

    private calculatePeakEventsPerSecond(): number {
    // This would need to be implemented with time-based tracking
        return 0;
    }

    private calculateAverageLatency(metrics: any): number {
        const processingTimes = Object.values(metrics.timings || {})
            .map((t: any) => t.average)
            .filter(time => time > 0);

        return processingTimes.length > 0
            ? processingTimes.reduce((a, b) => a + b, 0) / processingTimes.length
            : 0;
    }

    private calculateP95Latency(): number {
    // This would need to be implemented with percentile calculation
        return 0;
    }

    private calculateP99Latency(): number {
    // This would need to be implemented with percentile calculation
        return 0;
    }

    private calculateMaxLatency(metrics: any): number {
        const processingTimes = Object.values(metrics.timings || {})
            .map((t: any) => t.max)
            .filter(time => time > 0);

        return processingTimes.length > 0 ? Math.max(...processingTimes) : 0;
    }

    private calculateP95ProcessingTime(): number {
    // This would need to be implemented with percentile calculation
        return 0;
    }

    private calculateP99ProcessingTime(): number {
    // This would need to be implemented with percentile calculation
        return 0;
    }

    private calculateErrorRate(metrics: any): number {
        const totalEvents = (Object.values(metrics.counters || {}) as number[])
            .reduce((a, b) => a + b, 0);
        const totalErrors = metrics.counters['*.errors'] || 0;

        return totalEvents > 0 ? totalErrors / totalEvents : 0;
    }

    private calculateMemoryScore(memoryUsage: any): number {
        const heapUsedMB = memoryUsage.heapUsed / 1024 / 1024;
        const heapTotalMB = memoryUsage.heapTotal / 1024 / 1024;

        return 1 - (heapUsedMB / heapTotalMB);
    }

    private calculateProcessingScore(avgProcessingTime: number): number {
    // Score decreases as processing time increases
        return Math.max(0, 1 - (avgProcessingTime / 1000)); // 1 second = 0 score
    }

    private generateRecommendations(stats: any, metrics: any): string[] {
        const recommendations: string[] = [];

        if (stats.averageProcessingTime > 100) {
            recommendations.push('Consider optimizing event handlers to reduce processing time');
        }

        if (Object.keys(stats.eventsByType).length > 50) {
            recommendations.push('Consider consolidating similar event types to reduce complexity');
        }

        const errorRate = this.calculateErrorRate(metrics);
        if (errorRate > 0.1) {
            recommendations.push('High error rate detected. Review error handling in event handlers');
        }

        return recommendations;
    }

    private generateHealthIssues(checks: any[]): any[] {
        const issues: any[] = [];

        for (const check of checks) {
            if (check.status === 'critical') {
                issues.push({
                    severity: 'critical',
                    category: check.name,
                    message: check.message,
                    recommendation: `Immediate attention required for ${check.name}`,
                    impact: 'System stability may be compromised'
                });
            } else if (check.status === 'warning') {
                issues.push({
                    severity: 'medium',
                    category: check.name,
                    message: check.message,
                    recommendation: `Monitor ${check.name} for further degradation`,
                    impact: 'Performance may be affected'
                });
            }
        }

        return issues;
    }
}

/**
 * Event validator implementation
 */
class EventValidatorImpl implements EventValidator {
    public validate(event: ExtensionEvent): any {
        const errors: any[] = [];

        // Check basic structure
        if (!event.type) {
            errors.push({
                field: 'type',
                message: 'Event type is required',
                code: 'MISSING_TYPE'
            });
        }

        if (!event.timestamp) {
            errors.push({
                field: 'timestamp',
                message: 'Event timestamp is required',
                code: 'MISSING_TIMESTAMP'
            });
        }

        // Validate timestamp format
        if (event.timestamp && !(event.timestamp instanceof Date)) {
            errors.push({
                field: 'timestamp',
                message: 'Event timestamp must be a Date object',
                code: 'INVALID_TIMESTAMP_FORMAT'
            });
        }

        return {
            valid: errors.length === 0,
            errors
        };
    }

    public validateData<T>(eventType: string, data: T): any {
    // Basic validation - can be extended with schema validation
        const errors: any[] = [];

        if (!data) {
            errors.push({
                field: 'data',
                message: 'Event data is required',
                code: 'MISSING_DATA'
            });
        }

        return {
            valid: errors.length === 0,
            errors
        };
    }

    public getSchema(): any {
    // Return basic schema - can be extended with detailed schemas
        return {
            type: 'object',
            properties: {
                type: { type: 'string' },
                timestamp: { type: 'string', format: 'date-time' }
            },
            required: ['type', 'timestamp']
        };
    }

    public addRule(): void {
    // Store validation rules - would need to implement rule storage
    // For now, this is a placeholder implementation
    }

    public removeRule(): void {
    // Remove validation rules - would need to implement rule storage
    // For now, this is a placeholder implementation
    }
}

/**
 * Event serializer implementation
 */
class EventSerializerImpl implements EventSerializer {
    public serialize(event: ExtensionEvent): string {
        return JSON.stringify({
            ...event,
            timestamp: event.timestamp instanceof Date ? event.timestamp.toISOString() : event.timestamp
        });
    }

    public deserialize<T extends ExtensionEvent>(data: string): T {
        const parsed = JSON.parse(data);

        return {
            ...parsed,
            timestamp: new Date(parsed.timestamp)
        } as T;
    }

    public getSupportedFormats(): string[] {
        return ['json'];
    }

    public getSupportedTypes(): string[] {
        return [
            'problem:created',
            'problem:updated',
            'problem:deleted',
            'test:started',
            'test:completed',
            'paircheck:started',
            'paircheck:completed',
            'config:changed',
            'compiler:detected',
            'performance:alert'
        ];
    }
}

// Export EventSystem as EventSystemManager for backward compatibility
export { EventSystem as EventSystemManager };
