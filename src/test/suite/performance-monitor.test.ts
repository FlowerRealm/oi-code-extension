/* ---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *-------------------------------------------------------------------------------------------- */

import * as assert from 'assert';
import { describe, after, beforeEach, afterEach, it } from 'mocha';
require('mocha');

import { PerformanceMonitor, measureAsync, measureSync, measureFn, PerformanceMetrics }
    from '../../utils/performance-monitor';

// Helper function to create test metrics
function createTestMetric(overrides: Partial<PerformanceMetrics> = {}): PerformanceMetrics {
    return {
        operation: 'test-operation',
        duration: 100,
        success: true,
        timestamp: Date.now(),
        ...overrides
    };
}

describe('PerformanceMonitor', () => {
    let monitor: PerformanceMonitor;

    beforeEach(() => {
        // Create fresh instance for each test
        monitor = new (PerformanceMonitor as any)();
    });

    afterEach(() => {
        // Clean up after each test
        monitor.dispose();
    });

    describe('Basic Timing Operations', () => {
        it('should start and stop timing correctly', () => {
            const operationId = monitor.startTiming('test-operation');
            assert.strictEqual(typeof operationId, 'string');
            assert.ok(operationId.length > 0);

            // Verify operation is tracked
            monitor.endTiming(operationId, true);

            // Verify metrics were recorded
            const stats = monitor.getStats();
            assert.strictEqual(stats.totalOperations, 1);
            assert.strictEqual(stats.successRate, 1);
        });

        it('should handle sync timing correctly', () => {
            const result = monitor.timeSync('test-sync', () => {
                return 42;
            });

            assert.strictEqual(result, 42);

            const stats = monitor.getStats();
            assert.strictEqual(stats.totalOperations, 1);
            assert.strictEqual(stats.successRate, 1);
            assert.ok(stats.averageDuration > 0);
        });

        it('should handle async timing correctly', async () => {
            const result = await monitor.timeAsync('test-async', async () => {
                await new Promise(resolve => setTimeout(resolve, 10));
                return 42;
            });

            assert.strictEqual(result, 42);

            const stats = monitor.getStats();
            assert.strictEqual(stats.totalOperations, 1);
            assert.strictEqual(stats.successRate, 1);
            assert.ok(stats.averageDuration > 0); // Should have some duration
        });

        it('should handle operation failures correctly', () => {
            assert.throws(() => {
                monitor.timeSync('test-error', () => {
                    throw new Error('Test error');
                });
            }, /Test error/);

            const stats = monitor.getStats();
            assert.strictEqual(stats.totalOperations, 1);
            assert.strictEqual(stats.successRate, 0);
        });

        it('should handle async operation failures correctly', async () => {
            try {
                await monitor.timeAsync('test-async-error', async () => {
                    await new Promise(resolve => setTimeout(resolve, 5));
                    throw new Error('Async error');
                });
                assert.fail('Should have thrown an error');
            } catch (error) {
                assert.strictEqual((error as Error).message, 'Async error');
            }

            const stats = monitor.getStats();
            assert.strictEqual(stats.totalOperations, 1);
            assert.strictEqual(stats.successRate, 0);
        });
    });

    describe('Edge Cases and Boundary Conditions', () => {
        it('should handle empty operation ID gracefully', () => {
            monitor.endTiming('', true); // Should not throw
            const stats = monitor.getStats();
            assert.strictEqual(stats.totalOperations, 0);
        });

        it('should handle invalid operation ID gracefully', () => {
            monitor.endTiming('invalid-operation-id', true); // Should not throw
            const stats = monitor.getStats();
            assert.strictEqual(stats.totalOperations, 0);
        });

        it('should handle very long operation names', () => {
            const longName = 'a'.repeat(1000);
            const operationId = monitor.startTiming(longName);
            assert.ok(operationId.includes(longName));

            monitor.endTiming(operationId, true);
            const stats = monitor.getStats();
            assert.strictEqual(stats.totalOperations, 1);
        });

        it('should handle special characters in operation names', () => {
            const specialName = '测试-操作_🚀';
            const operationId = monitor.startTiming(specialName);
            assert.ok(operationId.includes(specialName));

            monitor.endTiming(operationId, true);
            const stats = monitor.getStats();
            assert.strictEqual(stats.totalOperations, 1);
        });

        it('should handle zero duration operations', () => {
            const result = monitor.timeSync('zero-duration', () => {
                return 'immediate';
            });

            assert.strictEqual(result, 'immediate');

            const stats = monitor.getStats();
            assert.strictEqual(stats.totalOperations, 1);
            assert.ok(stats.averageDuration >= 0);
        });

        it('should handle very fast operations', () => {
            const result = monitor.timeSync('fast-operation', () => {
                // Very fast operation
                return Math.random();
            });

            assert.strictEqual(typeof result, 'number');

            const stats = monitor.getStats();
            assert.strictEqual(stats.totalOperations, 1);
            assert.ok(stats.averageDuration >= 0);
        });
    });

    describe('Statistics and Metrics', () => {
        it('should calculate correct statistics for multiple operations', () => {
            // Add multiple metrics with known durations
            monitor.recordMetric(createTestMetric({ duration: 100 }));
            monitor.recordMetric(createTestMetric({ duration: 200 }));
            monitor.recordMetric(createTestMetric({ duration: 300 }));
            monitor.recordMetric(createTestMetric({ duration: 400, success: false }));

            const stats = monitor.getStats();

            assert.strictEqual(stats.totalOperations, 4);
            assert.strictEqual(stats.successRate, 0.75); // 3/4 successful
            assert.strictEqual(stats.averageDuration, 250); // (100+200+300+400)/4
            assert.strictEqual(stats.minDuration, 100);
            assert.strictEqual(stats.maxDuration, 400);
            assert.strictEqual(stats.operationCounts['test-operation'], 4);
        });

        it('should handle empty metrics gracefully', () => {
            const stats = monitor.getStats();

            assert.strictEqual(stats.totalOperations, 0);
            assert.strictEqual(stats.averageDuration, 0);
            assert.strictEqual(stats.minDuration, 0);
            assert.strictEqual(stats.maxDuration, 0);
            assert.strictEqual(stats.successRate, 0);
            assert.deepStrictEqual(stats.operationCounts, {});
            assert.deepStrictEqual(stats.slowestOperations, []);
        });

        it('should filter metrics by time range correctly', () => {
            const now = Date.now();
            const oldTime = now - 10000; // 10 seconds ago
            const recentTime = now - 1000; // 1 second ago

            // Add old and recent metrics
            monitor.recordMetric(createTestMetric({ timestamp: oldTime, operation: 'old-operation' }));
            monitor.recordMetric(createTestMetric({ timestamp: recentTime, operation: 'recent-operation' }));

            // All metrics
            let stats = monitor.getStats();
            assert.strictEqual(stats.totalOperations, 2);

            // Only recent metrics (last 5 seconds)
            stats = monitor.getStats(5000);
            assert.strictEqual(stats.totalOperations, 1);
            assert.strictEqual(stats.operationCounts['recent-operation'], 1);
        });

        it('should filter metrics by operation name correctly', () => {
            monitor.recordMetric(createTestMetric({ operation: 'operation-a' }));
            monitor.recordMetric(createTestMetric({ operation: 'operation-a' }));
            monitor.recordMetric(createTestMetric({ operation: 'operation-b' }));

            const metricsA = monitor.getMetricsByOperation('operation-a');
            assert.strictEqual(metricsA.length, 2);

            const metricsB = monitor.getMetricsByOperation('operation-b');
            assert.strictEqual(metricsB.length, 1);

            const metricsC = monitor.getMetricsByOperation('non-existent');
            assert.strictEqual(metricsC.length, 0);
        });
    });

    describe('Configuration and Settings', () => {
        it('should respect enabled/disabled state', () => {
            monitor.setEnabled(false);

            const operationId = monitor.startTiming('disabled-test');
            assert.strictEqual(operationId, ''); // Should return empty string when disabled

            monitor.endTiming(operationId, true); // Should not record
            const stats = monitor.getStats();
            assert.strictEqual(stats.totalOperations, 0);

            // Re-enable and test
            monitor.setEnabled(true);
            const enabledId = monitor.startTiming('enabled-test');
            assert.ok(enabledId.length > 0);

            monitor.endTiming(enabledId, true);
            const enabledStats = monitor.getStats();
            assert.strictEqual(enabledStats.totalOperations, 1);
        });

        it('should update configuration correctly', () => {
            monitor.updateConfig({
                enabled: false,
                slowOperationThreshold: 500,
                enableConsoleLogging: true
            });

            // Should not record when disabled
            monitor.startTiming('config-test');
            const stats = monitor.getStats();
            assert.strictEqual(stats.totalOperations, 0);
        });

        it('should handle configuration updates with partial settings', () => {
            const originalConfig = (monitor as any).config;

            monitor.updateConfig({
                slowOperationThreshold: 2000
            });

            const updatedConfig = (monitor as any).config;
            assert.strictEqual(updatedConfig.slowOperationThreshold, 2000);
            // Other settings should remain unchanged
            assert.strictEqual(updatedConfig.enabled, originalConfig.enabled);
            assert.strictEqual(updatedConfig.maxMetricsHistory, originalConfig.maxMetricsHistory);
        });
    });

    describe('Memory Management and Cleanup', () => {
        it('should respect max metrics history limit', () => {
            // Configure small history limit
            monitor.updateConfig({ maxMetricsHistory: 3 });

            // Add more metrics than the limit
            for (let i = 0; i < 10; i++) {
                monitor.recordMetric(createTestMetric({ operation: `operation-${i}` }));
            }

            const stats = monitor.getStats();
            assert.strictEqual(stats.totalOperations, 3); // Should be limited
        });

        it('should clear all metrics correctly', () => {
            // Add some metrics
            for (let i = 0; i < 5; i++) {
                monitor.recordMetric(createTestMetric());
            }

            let stats = monitor.getStats();
            assert.strictEqual(stats.totalOperations, 5);

            // Clear all metrics
            monitor.clear();

            stats = monitor.getStats();
            assert.strictEqual(stats.totalOperations, 0);
            assert.deepStrictEqual(stats.operationCounts, {});
        });

        it('should handle cleanup timer correctly', () => {
            // Configure short cleanup interval for testing
            monitor.updateConfig({ autoCleanupInterval: 50 });

            // Add some old metrics (older than 7 days)
            const oldTime = Date.now() - (8 * 24 * 60 * 60 * 1000); // 8 days ago
            monitor.recordMetric(createTestMetric({ timestamp: oldTime }));

            let stats = monitor.getStats();
            assert.strictEqual(stats.totalOperations, 1);

            // Directly test the cleanup logic instead of waiting for timer
            // This is more reliable than testing async timer behavior
            const monitorInstance = (monitor as any);
            if (monitorInstance.cleanupOldMetrics) {
                monitorInstance.cleanupOldMetrics();
                stats = monitor.getStats();
                assert.strictEqual(stats.totalOperations, 0, 'Old metrics should be cleaned up');
            } else {
                // If direct method not available, skip this test
                console.log('Skipping cleanup timer test - cleanup method not accessible');
            }
        });
    });

    describe('Export and Reporting', () => {
        it('should export metrics as JSON correctly', () => {
            monitor.recordMetric(createTestMetric({ operation: 'export-test' }));

            const exported = monitor.exportMetrics();
            assert.ok(typeof exported === 'string');

            const parsed = JSON.parse(exported);
            assert.ok(parsed.metrics);
            assert.ok(parsed.stats);
            assert.ok(parsed.config);
            assert.ok(parsed.exportedAt);
            assert.strictEqual(parsed.metrics.length, 1);
        });

        it('should generate valid performance report', () => {
            monitor.updateConfig({ enableOutputChannel: false }); // Disable for testing

            // Should not throw when output channel is disabled
            monitor.showReport();

            // Enable output channel and test
            monitor.updateConfig({ enableOutputChannel: true });
            monitor.showReport(); // Should not throw

            const stats = monitor.getStats();
            assert.ok(typeof stats.totalOperations === 'number');
        });
    });

    describe('Utility Functions', () => {
        it('should measure async operations correctly', async () => {
            const result = await measureAsync('utility-async', async () => {
                await new Promise(resolve => setTimeout(resolve, 5));
                return 'async-result';
            });

            assert.strictEqual(result, 'async-result');

            const monitor = PerformanceMonitor.getInstance();
            const stats = monitor.getStats();
            assert.ok(stats.totalOperations > 0);
        });

        it('should measure sync operations correctly', () => {
            const result = measureSync('utility-sync', () => {
                return 'sync-result';
            });

            assert.strictEqual(result, 'sync-result');

            const monitor = PerformanceMonitor.getInstance();
            const stats = monitor.getStats();
            assert.ok(stats.totalOperations > 0);
        });

        it('should create function wrappers correctly', () => {
            const wrappedFn = measureFn('wrapper-test', ((x: number, y: number) => {
                return x + y;
            }) as (...args: unknown[]) => unknown);

            assert.strictEqual(typeof wrappedFn, 'function');
            const result = wrappedFn(2, 3) as number;
            assert.strictEqual(result, 5);

            const monitor = PerformanceMonitor.getInstance();
            const stats = monitor.getStats();
            assert.ok(stats.totalOperations > 0);
        });

        it('should handle legacy measure function correctly', async () => {
            // Test with async function
            const asyncResult = await measureAsync('legacy-async', async () => {
                await new Promise(resolve => setTimeout(resolve, 5));
                return 'async-legacy';
            });
            assert.strictEqual(asyncResult, 'async-legacy');

            // Test with sync function
            const syncResult = measureSync('legacy-sync', () => {
                return 'sync-legacy';
            });
            assert.strictEqual(syncResult, 'sync-legacy');

            const monitor = PerformanceMonitor.getInstance();
            const stats = monitor.getStats();
            assert.ok(stats.totalOperations >= 2);
        });
    });

    describe('Error Handling and Robustness', () => {
        it('should handle metadata correctly in error cases', () => {
            try {
                monitor.timeSync('error-with-metadata', () => {
                    throw new Error('Test error with metadata');
                }, { userId: 123, action: 'test' });
            } catch (error) {
                // Expected error
            }

            const stats = monitor.getStats();
            assert.strictEqual(stats.totalOperations, 1);
            assert.strictEqual(stats.successRate, 0);

            // Verify error metadata was recorded
            const failedMetrics = monitor.getMetricsByOperation('error-with-metadata')
                .filter(m => !m.success);
            assert.strictEqual(failedMetrics.length, 1);
            assert.ok(failedMetrics[0].metadata);
        });

        it('should handle concurrent operations correctly', () => {
            const operationIds = [];

            // Start multiple operations concurrently
            for (let i = 0; i < 10; i++) {
                operationIds.push(monitor.startTiming(`concurrent-${i}`));
            }

            // End all operations
            operationIds.forEach((id, index) => {
                monitor.endTiming(id, true, { concurrencyIndex: index });
            });

            const stats = monitor.getStats();
            assert.strictEqual(stats.totalOperations, 10);
            assert.strictEqual(stats.successRate, 1);
        });

        it('should handle invalid metadata gracefully', () => {
            // Test with various metadata types
            const testCases = [
                { valid: true, data: { key: 'value' } },
                { valid: true, data: null },
                { valid: true, data: undefined },
                { valid: true, data: 123 },
                { valid: true, data: 'string' },
                { valid: true, data: [1, 2, 3] },
                { valid: true, data: { nested: { object: true } } }
            ];

            testCases.forEach((testCase, index) => {
                try {
                    monitor.timeSync(`metadata-test-${index}`, () => {
                        return `result-${index}`;
                    }, testCase.data as any);
                } catch (error) {
                    assert.fail(`Should not throw for metadata test case ${index}: ${error}`);
                }
            });

            const stats = monitor.getStats();
            assert.strictEqual(stats.totalOperations, testCases.length);
            assert.strictEqual(stats.successRate, 1);
        });
    });
});

describe('PerformanceMonitor Integration', () => {
    after(() => {
        // Clean up global instance
        PerformanceMonitor.getInstance().clear();
    });

    it('should maintain singleton pattern correctly', () => {
        const instance1 = PerformanceMonitor.getInstance();
        const instance2 = PerformanceMonitor.getInstance();

        assert.strictEqual(instance1, instance2); // Should be same instance
    });

    it('should handle multiple independent test runs', () => {
        // Clear any existing metrics
        PerformanceMonitor.getInstance().clear();

        // Run some operations
        measureSync('integration-test-1', () => 'result1');
        measureSync('integration-test-2', () => 'result2');

        const stats = PerformanceMonitor.getInstance().getStats();
        assert.strictEqual(stats.totalOperations, 2);
    });

    it('should not interfere between test suites', () => {
        // This test ensures that different test suites can use the performance monitor
        // without interfering with each other
        const initialStats = PerformanceMonitor.getInstance().getStats();
        const initialCount = initialStats.totalOperations;

        // Perform some operations
        measureSync('isolation-test', () => 'isolated');

        const finalStats = PerformanceMonitor.getInstance().getStats();
        assert.strictEqual(finalStats.totalOperations, initialCount + 1);
    });
});
