/* ---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *-------------------------------------------------------------------------------------------- */

import * as assert from 'assert';
import { describe, before } from 'mocha';
require('mocha');

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';

// Base dir for test-created problems
const TEST_BASE_DIR = path.join(os.homedir(), '.oi-code-tests', 'problems-ut');

// Helper function for OI-style output comparison: ignore trailing whitespace and normalize line endings
function normalizeOutput(output: string): string {
    return output.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
}

// Helper: create a problem via command, inject code, and open it
async function createProblemAndOpen(
    name: string,
    language: 'c' | 'cpp',
    code: string
): Promise<{ problemDir: string; sourcePath: string; uri: vscode.Uri }> {
    await fs.mkdir(TEST_BASE_DIR, { recursive: true });
    const res: any = await vscode.commands.executeCommand('oicode.createProblem', {
        name,
        language,
        baseDir: TEST_BASE_DIR
    });
    if (!res || res.error) {
        throw new Error(`failed to create problem: ${res?.error || 'unknown'}`);
    }
    await fs.writeFile(res.sourcePath, code);
    const uri = vscode.Uri.file(res.sourcePath);
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc);
    return { problemDir: res.problemDir, sourcePath: res.sourcePath, uri };
}

// Helper to clean up a directory with retry logic for Windows
async function cleanupDir(dir: string, maxRetries = 3) {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            await fs.rm(dir, { recursive: true, force: true });
            return;
        } catch (error) {
            if (attempt === maxRetries - 1) {
                console.warn(`Failed to cleanup directory ${dir} after ${maxRetries} attempts:`, error);
            } else {
                await new Promise(resolve => setTimeout(resolve, 100 * (attempt + 1)));
            }
        }
    }
}

// Helper: Check if compilers are available using the same logic as other tests
async function areCompilersAvailable(): Promise<boolean> {
    try {
        console.log('[Compiler Check] Testing actual compiler functionality for performance tests...');

        // Test with a simple C program that should produce predictable output
        const testCode = '#include <stdio.h>\nint main() { printf("test_output"); return 0; }';

        // Create a temporary test file
        const testDir = path.join(TEST_BASE_DIR, 'compiler-test-perf');
        await fs.mkdir(testDir, { recursive: true });
        const testFile = path.join(testDir, 'test.c');
        await fs.writeFile(testFile, testCode);

        // Open the file and try to run it
        const uri = vscode.Uri.file(testFile);
        const doc = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(doc);

        const result: any = await vscode.commands.executeCommand('oicode.runCode', '');

        // Clean up
        await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
        await cleanupDir(testDir);

        // More lenient check: if we get any result object back, consider compilers available
        return result && typeof result === 'object';
    } catch {
        return false;
    }
}

describe('Hello World Performance Tests', () => {
    // Hello World code templates
    const helloWorldCode = {
        c: '#include <stdio.h>\nint main() { printf("Hello, World!\\n"); return 0; }',
        cpp: '#include <iostream>\nint main() { std::cout << "Hello, World!" << std::endl; return 0; }'
    };

    // Simple pair check code (both implementations should produce same output)
    const pairCheckCode = {
        simple: `#include <stdio.h>
int main() {
    int x = 42;
    printf("Answer: %d\\n", x);
    return 0;
}`,
        alternative: `#include <stdio.h>
int main() {
    int x = 40 + 2;
    printf("Answer: %d\\n", x);
    return 0;
}`
    };

    test('should compile and run Hello World 50 times efficiently', async function () {
        this.timeout(180000); // 3 minutes timeout for 50 iterations

        const compilersAvailableForTest = await areCompilersAvailable();
        if (!compilersAvailableForTest) {
            console.log('[Performance Test] Compilers not available, skipping Hello World performance test');
            this.skip();
            return;
        }

        const iterationCount = 50;
        const languages: ('c' | 'cpp')[] = ['c', 'cpp'];
        const results = {
            totalIterations: iterationCount * languages.length,
            successfulRuns: 0,
            failedRuns: 0,
            totalTime: 0,
            averageTime: 0,
            languageStats: {} as Record<string, { count: number; totalTime: number; averageTime: number }>
        };

        console.log(`[Performance Test] Starting ${iterationCount} Hello World iterations per language...`);

        for (const lang of languages) {
            const langResults = { count: 0, totalTime: 0, averageTime: 0 };

            for (let i = 1; i <= iterationCount; i++) {
                const startTime = Date.now();

                try {
                    const created = await createProblemAndOpen(`UT-Hello-Perf-${lang}-${i}`, lang, helloWorldCode[lang]);

                    const res: any = await vscode.commands.executeCommand('oicode.runCode', '');
                    const endTime = Date.now();
                    const executionTime = endTime - startTime;

                    if (res && res.output && res.output.includes('Hello, World!') && !res.error) {
                        results.successfulRuns++;
                        langResults.count++;
                        langResults.totalTime += executionTime;
                        results.totalTime += executionTime;

                        if (i % 10 === 0) {
                            console.log(`[Performance Test] ${lang} iteration ${i}/${iterationCount}: ${executionTime}ms`);
                        }
                    } else {
                        results.failedRuns++;
                        console.warn(`[Performance Test] ${lang} iteration ${i} failed:`, res);
                    }

                    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
                    await cleanupDir(created.problemDir);
                } catch (error) {
                    results.failedRuns++;
                    console.error(`[Performance Test] ${lang} iteration ${i} error:`, error);
                }
            }

            langResults.averageTime = langResults.count > 0 ? langResults.totalTime / langResults.count : 0;
            results.languageStats[lang] = langResults;
        }

        results.averageTime = results.totalTime / results.successfulRuns;

        console.log('[Performance Test] Hello World Performance Results:');
        console.log(`  Total iterations: ${results.totalIterations}`);
        console.log(`  Successful runs: ${results.successfulRuns}`);
        console.log(`  Failed runs: ${results.failedRuns}`);
        console.log(`  Total time: ${results.totalTime}ms`);
        console.log(`  Average time per run: ${results.averageTime.toFixed(2)}ms`);

        for (const [lang, stats] of Object.entries(results.languageStats)) {
            console.log(`  ${lang.toUpperCase()}: ${stats.count}/${iterationCount} successful, avg ${stats.averageTime.toFixed(2)}ms`);
        }

        // Assert performance requirements
        assert.strictEqual(results.failedRuns, 0, `All ${results.totalIterations} Hello World runs should succeed`);
        assert.ok(results.successfulRuns === results.totalIterations, 'All iterations should complete successfully');

        // Reasonable performance threshold (should be much faster in practice)
        assert.ok(results.averageTime < 1000, `Average execution time should be under 1 second, was ${results.averageTime.toFixed(2)}ms`);

        // Each language should have consistent performance
        for (const [lang, stats] of Object.entries(results.languageStats)) {
            assert.strictEqual(stats.count, iterationCount, `All ${iterationCount} ${lang.toUpperCase()} iterations should succeed`);
            assert.ok(stats.averageTime < 1000, `${lang.toUpperCase()} average time should be under 1 second`);
        }
    });

    test('should perform pair check 50 times efficiently', async function () {
        this.timeout(300000); // 5 minutes timeout for pair check iterations

        const compilersAvailableForTest = await areCompilersAvailable();
        if (!compilersAvailableForTest) {
            console.log('[Performance Test] Compilers not available, skipping pair check performance test');
            this.skip();
            return;
        }

        const iterationCount = 50;
        const languages: ('c' | 'cpp')[] = ['c', 'cpp'];
        const results = {
            totalIterations: iterationCount * languages.length,
            successfulChecks: 0,
            failedChecks: 0,
            totalTime: 0,
            averageTime: 0,
            languageStats: {} as Record<string, { count: number; totalTime: number; averageTime: number }>
        };

        console.log(`[Performance Test] Starting ${iterationCount} pair check iterations per language...`);

        for (const lang of languages) {
            const langResults = { count: 0, totalTime: 0, averageTime: 0 };

            for (let i = 1; i <= iterationCount; i++) {
                const startTime = Date.now();

                try {
                    // Create problem with simple implementation
                    const created = await createProblemAndOpen(`UT-PairCheck-Perf-${lang}-${i}`, lang, pairCheckCode.simple);

                    // Save the simple implementation path
                    const simplePath = created.sourcePath;
                    const problemDir = created.problemDir;

                    // Create alternative implementation file
                    const altFileName = `main_alternative.${lang}`;
                    const altPath = path.join(problemDir, altFileName);
                    await fs.writeFile(altPath, pairCheckCode.alternative);

                    // Perform pair check
                    const pairCheckResult: any = await vscode.commands.executeCommand('oicode.startPairCheck');
                    const endTime = Date.now();
                    const executionTime = endTime - startTime;

                    if (pairCheckResult && pairCheckResult.success) {
                        results.successfulChecks++;
                        langResults.count++;
                        langResults.totalTime += executionTime;
                        results.totalTime += executionTime;

                        if (i % 10 === 0) {
                            console.log(`[Performance Test] ${lang} pair check iteration ${i}/${iterationCount}: ${executionTime}ms`);
                        }
                    } else {
                        results.failedChecks++;
                        console.warn(`[Performance Test] ${lang} pair check iteration ${i} failed:`, pairCheckResult);
                    }

                    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
                    await cleanupDir(problemDir);
                } catch (error) {
                    results.failedChecks++;
                    console.error(`[Performance Test] ${lang} pair check iteration ${i} error:`, error);
                }
            }

            langResults.averageTime = langResults.count > 0 ? langResults.totalTime / langResults.count : 0;
            results.languageStats[lang] = langResults;
        }

        results.averageTime = results.totalTime / results.successfulChecks;

        console.log('[Performance Test] Pair Check Performance Results:');
        console.log(`  Total iterations: ${results.totalIterations}`);
        console.log(`  Successful checks: ${results.successfulChecks}`);
        console.log(`  Failed checks: ${results.failedChecks}`);
        console.log(`  Total time: ${results.totalTime}ms`);
        console.log(`  Average time per check: ${results.averageTime.toFixed(2)}ms`);

        for (const [lang, stats] of Object.entries(results.languageStats)) {
            console.log(`  ${lang.toUpperCase()}: ${stats.count}/${iterationCount} successful, avg ${stats.averageTime.toFixed(2)}ms`);
        }

        // Assert performance requirements
        assert.strictEqual(results.failedChecks, 0, `All ${results.totalIterations} pair checks should succeed`);
        assert.ok(results.successfulChecks === results.totalIterations, 'All pair check iterations should complete successfully');

        // Pair check might be slower due to additional processing, but should still be reasonable
        assert.ok(results.averageTime < 3000, `Average pair check time should be under 3 seconds, was ${results.averageTime.toFixed(2)}ms`);

        // Each language should have consistent performance
        for (const [lang, stats] of Object.entries(results.languageStats)) {
            assert.strictEqual(stats.count, iterationCount, `All ${iterationCount} ${lang.toUpperCase()} pair checks should succeed`);
            assert.ok(stats.averageTime < 3000, `${lang.toUpperCase()} pair check average time should be under 3 seconds`);
        }
    });

    test('should demonstrate performance consistency across multiple runs', async function () {
        this.timeout(60000); // 1 minute for quick consistency check

        const compilersAvailableForTest = await areCompilersAvailable();
        if (!compilersAvailableForTest) {
            console.log('[Performance Test] Compilers not available, skipping consistency test');
            this.skip();
            return;
        }

        const quickIterations = 5; // Smaller number for quick consistency check
        const executionTimes: number[] = [];

        console.log('[Performance Test] Running quick consistency check...');

        for (let i = 1; i <= quickIterations; i++) {
            const startTime = Date.now();

            try {
                const created = await createProblemAndOpen(`UT-Consistency-${i}`, 'c', helloWorldCode.c);
                await vscode.commands.executeCommand('oicode.runCode', '');
                const endTime = Date.now();

                executionTimes.push(endTime - startTime);

                await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
                await cleanupDir(created.problemDir);
            } catch (error) {
                console.error(`[Performance Test] Consistency check ${i} failed:`, error);
                // Don't fail the test, just note the inconsistency
            }
        }

        if (executionTimes.length >= 3) {
            const averageTime = executionTimes.reduce((a, b) => a + b, 0) / executionTimes.length;
            const maxTime = Math.max(...executionTimes);
            const minTime = Math.min(...executionTimes);
            const variance = maxTime - minTime;

            console.log(`[Performance Test] Consistency Results (${executionTimes.length} runs):`);
            console.log(`  Average: ${averageTime.toFixed(2)}ms`);
            console.log(`  Min: ${minTime.toFixed(2)}ms`);
            console.log(`  Max: ${maxTime.toFixed(2)}ms`);
            console.log(`  Variance: ${variance.toFixed(2)}ms`);

            // Performance should be reasonably consistent (variance should be reasonable)
            assert.ok(variance < averageTime * 2, `Execution time variance (${variance}ms) should be reasonable compared to average (${averageTime.toFixed(2)}ms)`);
        }
    });
});
