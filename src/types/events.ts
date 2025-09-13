/* ---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *-------------------------------------------------------------------------------------------- */

// Import event types from models to avoid duplication
import type {
    ExtensionEvent,
    Disposable
} from './models';

// Re-export ExtensionEvent for backward compatibility
export type {
    ExtensionEvent,
    PairCheckErrorEvent,
    PairCheckStartedEvent,
    PairCheckCompletedEvent,
    PairCheckBatchStartedEvent,
    PairCheckBatchCompletedEvent,
    PairCheckSessionCreatedEvent,
    PairCheckSessionEndedEvent,
    EventHandlerErrorEvent
} from './models';

/**
 * Event handler function type
 */
export type EventHandler<T extends ExtensionEvent = ExtensionEvent> = (event: T) => void | Promise<void>;

/**
 * Event listener options
 */
export interface EventListenerOptions {
  once?: boolean;
  priority?: number;
  filter?: (event: ExtensionEvent) => boolean;
}

/**
 * Event subscription
 */
export interface EventSubscription {
  id: string;
  eventType: string;
  handler: EventHandler;
  options: EventListenerOptions;
  isActive: boolean;
}

/**
 * Event bus interface
 */
export interface EventBus {
  /**
   * Register event listener
   */
  on<T extends ExtensionEvent>(
    eventType: T['type'],
    handler: EventHandler<T>,
    options?: EventListenerOptions
  ): Disposable;

  /**
   * Register one-time event listener
   */
  once<T extends ExtensionEvent>(
    eventType: T['type'],
    handler: EventHandler<T>,
    options?: EventListenerOptions
  ): void;

  /**
   * Emit event
   */
  emit<T extends ExtensionEvent>(event: T): Promise<void>;

  /**
   * Remove event listener
   */
  off<T extends ExtensionEvent>(
    eventType: T['type'],
    handler: EventHandler<T>
  ): void;

  /**
   * Remove all listeners for event type
   */
  removeAllListeners(eventType: string): void;

  /**
   * Get event statistics
   */
  getStats(): Promise<EventStats>;
}

/**
 * Event store interface
 */
export interface EventStore {
  /**
   * Store event
   */
  store<T extends ExtensionEvent>(event: T): Promise<void>;

  /**
   * Get events by type
   */
  getEvents<T extends ExtensionEvent>(
    eventType: T['type']
  ): Promise<T[]>;

  /**
   * Get recent events
   */
  getRecentEvents(limit?: number): Promise<ExtensionEvent[]>;

  /**
   * Clear events
   */
  clear(): Promise<void>;

  /**
   * Get event statistics
   */
  getStats(): Promise<EventStoreStats>;
}

/**
 * Event scheduler interface
 */
export interface EventScheduler {
  /**
   * Schedule delayed event
   */
  schedule<T extends ExtensionEvent>(event: T, delay: number): Promise<void>;

  /**
   * Schedule recurring event
   */
  scheduleRecurring<T extends ExtensionEvent>(
    event: T,
    interval: number
  ): Disposable;

  /**
   * Cancel scheduled event
   */
  cancel(eventId: string): boolean;

  /**
   * Get scheduled events
   */
  getScheduledEvents(): ScheduledEvent[];
}

/**
 * Event query options
 */
export interface EventQueryOptions {
  limit?: number;
  offset?: number;
  startTime?: Date;
  endTime?: Date;
  filter?: (event: ExtensionEvent) => boolean;
  sortBy?: 'timestamp' | 'type' | 'source';
  sortOrder?: 'asc' | 'desc';
}

/**
 * Event clear options
 */
export interface EventClearOptions {
  before?: Date;
  after?: Date;
  types?: string[];
  keepLast?: number;
}

/**
 * Event statistics
 */
export interface EventStats {
  totalEvents: number;
  eventsByType: Record<string, number>;
  averageProcessingTime: number;
  lastEventTime: Date | null;
  subscriptionsByType: Record<string, number>;
}

/**
 * Event store statistics
 */
export interface EventStoreStats extends EventStats {
  oldestEventTime: Date | null;
  newestEventTime: Date | null;
  storageSize: number;
}

/**
 * Scheduled event
 */
export interface ScheduledEvent {
  id: string;
  event: ExtensionEvent;
  scheduledTime: Date;
  interval?: number;
  isActive: boolean;
}

// Import ValidationResult from models to avoid duplication
import type { ValidationResult } from './models';

// Re-export for backward compatibility
export type { ValidationResult };

/**
 * Event pipeline interface
 */
export interface EventPipeline {
  /**
   * Process event through pipeline
   */
  process<T extends ExtensionEvent>(event: T): Promise<T>;

  /**
   * Add processor to pipeline
   */
  addProcessor(processor: EventProcessor): void;

  /**
   * Remove processor from pipeline
   */
  removeProcessor(processor: EventProcessor): void;
}

/**
 * Event history interface
 */
export interface EventHistory {
  /**
   * Get event history
   */
  getEvents(options?: EventQueryOptions): Promise<ExtensionEvent[]>;

  /**
   * Get event history (alias for getEvents)
   */
  getHistory(options?: EventQueryOptions): Promise<ExtensionEvent[]>;

  /**
   * Get recent events
   */
  getRecentEvents(limit?: number): Promise<ExtensionEvent[]>;

  /**
   * Add event to history
   */
  addToHistory(event: ExtensionEvent): Promise<void>;

  /**
   * Clear history
   */
  clearHistory(): Promise<void>;
}

/**
 * Event metrics collector interface
 */
export interface EventMetricsCollector {
  /**
   * Record event metric
   */
  recordMetric(eventType: string, processingTime: number): void;

  /**
   * Get metrics
   */
  getMetrics(): EventMetrics;

  /**
   * Reset metrics
   */
  reset(): void;

  /**
   * Record timing metric
   */
  recordTiming(eventType: string, operation: string, duration: number): void;

  /**
   * Increment counter
   */
  incrementCounter(eventType: string, counterName: string, value?: number): void;
}

/**
 * Event metrics
 */
export interface EventMetrics {
  totalEvents: number;
  averageProcessingTime: number;
  eventsByType: Record<string, number>;
  slowestEvents: Array<{
    eventType: string;
    processingTime: number;
    timestamp: Date;
  }>;
}

/**
 * Event diagnostics interface
 */
export interface EventDiagnostics {
  /**
   * Run diagnostics
   */
  runDiagnostics(): Promise<EventDiagnosticResult>;

  /**
   * Get system health
   */
  getSystemHealth(): Promise<EventSystemHealth>;
}

/**
 * Event diagnostic result
 */
export interface EventDiagnosticResult {
  healthy: boolean;
  issues: DiagnosticIssue[];
  recommendations: string[];
}

/**
 * Diagnostic issue
 */
export interface DiagnosticIssue {
  type: 'warning' | 'error' | 'info';
  component: string;
  message: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
}

/**
 * Event system health
 */
export interface EventSystemHealth {
  overall: 'healthy' | 'degraded' | 'unhealthy';
  components: Record<string, 'healthy' | 'degraded' | 'unhealthy'>;
  metrics: EventMetrics;
}

/**
 * Event configuration
 */
export interface EventConfig {
  enableMetrics: boolean;
  enableDiagnostics: boolean;
  maxHistorySize: number;
  processingTimeout: number;
  enablePipeline: boolean;
  enableScheduler: boolean;
  storeConfig: {
    maxSize: number;
    retentionPeriod: number;
    compressionEnabled: boolean;
  };
}

/**
 * Event serializer interface
 */
export interface EventSerializer {
  /**
   * Serialize event to string
   */
  serialize<T extends ExtensionEvent>(event: T): string;

  /**
   * Deserialize event from string
   */
  deserialize<T extends ExtensionEvent>(data: string): T;

  /**
   * Get supported event types
   */
  getSupportedTypes(): string[];
}

/**
 * Event processor interface
 */
export interface EventProcessor {
  /**
   * Process event
   */
  process<T extends ExtensionEvent>(event: T): Promise<T>;

  /**
   * Check if processor can handle event type
   */
  canHandle(eventType: string): boolean;

  /**
   * Get processor priority (higher number = higher priority)
   */
  getPriority(): number;

  /**
   * Get processor name
   */
  getName(): string;
}

/**
 * Event middleware interface
 */
export interface EventMiddleware {
  /**
   * Process event middleware
   */
  use<T extends ExtensionEvent>(event: T, next: () => Promise<T>): Promise<T>;

  /**
   * Get middleware name
   */
  getName(): string;
}

/**
 * Event validator interface
 */
export interface EventValidator {
  /**
   * Validate event
   */
  validate<T extends ExtensionEvent>(event: T): ValidationResult;

  /**
   * Add validation rule
   */
  addRule(rule: (event: ExtensionEvent) => ValidationResult): void;

  /**
   * Remove validation rule
   */
  removeRule(rule: (event: ExtensionEvent) => ValidationResult): void;
}

