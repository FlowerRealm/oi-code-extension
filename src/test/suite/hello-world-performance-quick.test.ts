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
        console.log('[Compiler Check] Testing actual compiler functionality for quick performance tests...');

        // Test with a simple C program that should produce predictable output
        const testCode = '#include <stdio.h>\nint main() { printf("test_output"); return 0; }';

        // Create a temporary test file
        const testDir = path.join(TEST_BASE_DIR, 'compiler-test-perf-quick');
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

describe('Hello World Performance Tests (Quick)', () => {
    // Hello World code templates
    const helloWorldCode = {
        c: '#include <stdio.h>\nint main() { printf("Hello, World!\\n"); return 0; }',
        cpp: '#include <iostream>\nint main() { std::cout << "Hello, World!" << std::endl; return 0; }'
    };

    test('should compile and run Hello World 5 times efficiently (quick test)', async function () {
        this.timeout(60000); // 1 minute timeout for 5 iterations

        const compilersAvailableForTest = await areCompilersAvailable();
        if (!compilersAvailableForTest) {
            console.log('[Performance Test] Compilers not available, skipping Hello World performance test');
            this.skip();
            return;
        }

        const iterationCount = 5; // Reduced for quick testing
        const languages: ('c' | 'cpp')[] = ['c', 'cpp'];
        const results = {
            totalIterations: iterationCount * languages.length,
            successfulRuns: 0,
            failedRuns: 0,
            totalTime: 0,
            averageTime: 0,
            languageStats: {} as Record<string, { count: number; totalTime: number; averageTime: number }>
        };

        console.log(`[Performance Test] Starting ${iterationCount} Hello World iterations per language (quick test)...`);

        for (const lang of languages) {
            const langResults = { count: 0, totalTime: 0, averageTime: 0 };

            for (let i = 1; i <= iterationCount; i++) {
                const startTime = Date.now();

                try {
                    const created = await createProblemAndOpen(`UT-Hello-Quick-${lang}-${i}`, lang, helloWorldCode[lang]);

                    const res: any = await vscode.commands.executeCommand('oicode.runCode', '');
                    const endTime = Date.now();
                    const executionTime = endTime - startTime;

                    if (res && res.output && res.output.includes('Hello, World!') && !res.error) {
                        results.successfulRuns++;
                        langResults.count++;
                        langResults.totalTime += executionTime;
                        results.totalTime += executionTime;

                        console.log(`[Performance Test] ${lang} iteration ${i}/${iterationCount}: ${executionTime}ms`);
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

        console.log('[Performance Test] Hello World Performance Results (Quick):');
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

        // Reasonable performance threshold
        assert.ok(results.averageTime < 2000, `Average execution time should be under 2 seconds, was ${results.averageTime.toFixed(2)}ms`);

        // Each language should have consistent performance
        for (const [lang, stats] of Object.entries(results.languageStats)) {
            assert.strictEqual(stats.count, iterationCount, `All ${iterationCount} ${lang.toUpperCase()} iterations should succeed`);
            assert.ok(stats.averageTime < 2000, `${lang.toUpperCase()} average time should be under 2 seconds`);
        }
    });

    test('should perform pair check 3 times efficiently (quick test)', async function () {
        this.timeout(120000); // 2 minutes timeout for 3 pair check iterations

        const compilersAvailableForTest = await areCompilersAvailable();
        if (!compilersAvailableForTest) {
            console.log('[Performance Test] Compilers not available, skipping pair check performance test');
            this.skip();
            return;
        }

        const iterationCount = 3; // Reduced for quick testing
        const languages: ('c' | 'cpp')[] = ['c', 'cpp'];
        const results = {
            totalIterations: iterationCount * languages.length,
            successfulChecks: 0,
            failedChecks: 0,
            totalTime: 0,
            averageTime: 0,
            languageStats: {} as Record<string, { count: number; totalTime: number; averageTime: number }>
        };

        console.log(`[Performance Test] Starting ${iterationCount} pair check iterations per language (quick test)...`);

        for (const lang of languages) {
            const langResults = { count: 0, totalTime: 0, averageTime: 0 };

            for (let i = 1; i <= iterationCount; i++) {
                const startTime = Date.now();

                try {
                    // Create problem with simple implementation
                    const created = await createProblemAndOpen(`UT-PairCheck-Quick-${lang}-${i}`, lang, helloWorldCode[lang]);

                    // For pair check, we need to create an alternative implementation
                    const altCode = lang === 'c'
                        ? '#include <stdio.h>\nint main() { printf("Hello, World!\\n"); return 0; }'
                        : '#include <iostream>\nint main() { std::cout << "Hello, World!" << std::endl; return 0; }';

                    const altFileName = `main_alternative.${lang}`;
                    const altPath = path.join(created.problemDir, altFileName);
                    await fs.writeFile(altPath, altCode);

                    // Perform pair check
                    const pairCheckResult: any = await vscode.commands.executeCommand('oicode.startPairCheck');
                    const endTime = Date.now();
                    const executionTime = endTime - startTime;

                    if (pairCheckResult && pairCheckResult.success) {
                        results.successfulChecks++;
                        langResults.count++;
                        langResults.totalTime += executionTime;
                        results.totalTime += executionTime;

                        console.log(`[Performance Test] ${lang} pair check iteration ${i}/${iterationCount}: ${executionTime}ms`);
                    } else {
                        results.failedChecks++;
                        console.warn(`[Performance Test] ${lang} pair check iteration ${i} failed:`, pairCheckResult);
                    }

                    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
                    await cleanupDir(created.problemDir);
                } catch (error) {
                    results.failedChecks++;
                    console.error(`[Performance Test] ${lang} pair check iteration ${i} error:`, error);
                }
            }

            langResults.averageTime = langResults.count > 0 ? langResults.totalTime / langResults.count : 0;
            results.languageStats[lang] = langResults;
        }

        results.averageTime = results.totalTime / results.successfulChecks;

        console.log('[Performance Test] Pair Check Performance Results (Quick):');
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

        // Pair check performance threshold
        assert.ok(results.averageTime < 5000, `Average pair check time should be under 5 seconds, was ${results.averageTime.toFixed(2)}ms`);

        // Each language should have consistent performance
        for (const [lang, stats] of Object.entries(results.languageStats)) {
            assert.strictEqual(stats.count, iterationCount, `All ${iterationCount} ${lang.toUpperCase()} pair checks should succeed`);
            assert.ok(stats.averageTime < 5000, `${lang.toUpperCase()} pair check average time should be under 5 seconds`);
        }
    });
});
