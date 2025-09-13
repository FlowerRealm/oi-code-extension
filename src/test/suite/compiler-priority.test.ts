/* ---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *-------------------------------------------------------------------------------------------- */

import * as assert from 'assert';
import { describe, it } from 'mocha';
require('mocha');

import { CompilerDetector } from '../../compilers/detector/compilerDetector';

describe('CompilerPriorityIntegration', () => {
    describe('Real-World Priority Scenarios', () => {
        it('should handle realistic compiler selection scenarios', () => {
            const realisticCompilers = [
                {
                    path: '/usr/bin/clang-19',
                    name: 'Clang 19.1.0',
                    type: 'clang',
                    version: '19.1.0',
                    supportedStandards: ['c++17', 'c++20'],
                    is64Bit: true,
                    priority: 0 // Will be calculated
                },
                {
                    path: '/usr/bin/clang-18',
                    name: 'Clang 18.1.0',
                    type: 'clang',
                    version: '18.1.0',
                    supportedStandards: ['c++17', 'c++20'],
                    is64Bit: true,
                    priority: 0
                },
                {
                    path: '/usr/bin/gcc-13',
                    name: 'GCC 13.2.0',
                    type: 'gcc',
                    version: '13.2.0',
                    supportedStandards: ['c++17'],
                    is64Bit: true,
                    priority: 0
                },
                {
                    path: '/usr/bin/gcc-14',
                    name: 'GCC 14.1.0',
                    type: 'gcc',
                    version: '14.1.0',
                    supportedStandards: ['c++17', 'c++20'],
                    is64Bit: true,
                    priority: 0
                },
                {
                    path: '/usr/local/clang-19/bin/clang',
                    name: 'Clang 19.1.0',
                    type: 'clang',
                    version: '19.1.0',
                    supportedStandards: ['c++17', 'c++20'],
                    is64Bit: true,
                    priority: 0
                }
            ];

            // Calculate priorities for all compilers
            realisticCompilers.forEach(compiler => {
                compiler.priority = (CompilerDetector as any).calculatePriority(
                    compiler.type,
                    compiler.version,
                    compiler.path
                );
            });

            // Sort by priority (highest first)
            realisticCompilers.sort((a, b) => b.priority - a.priority);

            // Verify expected order
            assert.ok(realisticCompilers[0].priority >= realisticCompilers[1].priority,
                'Compilers should be sorted by priority');

            // User-installed clang should beat system clang of same version
            const userClang = realisticCompilers.find(c => c.path.includes('/usr/local'));
            const systemClang = realisticCompilers.find(c => c.path === '/usr/bin/clang-19');

            if (userClang && systemClang) {
                assert.ok(userClang.priority > systemClang.priority,
                    'User-installed clang should beat system clang');
            }
        });

        it('should handle edge case scenarios', () => {
            const edgeCaseScenarios = [
                {
                    description: 'Very old but user-installed vs new system compiler',
                    oldUser: { type: 'clang', version: '3.9.0', path: '/home/user/clang-3.9/bin/clang' },
                    newSystem: { type: 'gcc', version: '14.1.0', path: '/usr/bin/gcc' }
                },
                {
                    description: 'Same compiler type, different versions, same location',
                    oldVersion: { type: 'clang', version: '16.0.0', path: '/usr/bin/clang' },
                    newVersion: { type: 'clang', version: '19.1.0', path: '/usr/bin/clang' }
                },
                {
                    description: 'Different types, same version, different locations',
                    userGcc: { type: 'gcc', version: '13.2.0', path: '/home/user/gcc/bin/gcc' },
                    systemClang: { type: 'clang', version: '13.2.0', path: '/usr/bin/clang' }
                }
            ];

            edgeCaseScenarios.forEach(scenario => {
                const priorities = Object.entries(scenario).filter(([key]) => key !== 'description')
                    .map(([key, config]) => ({
                        name: key,
                        priority: (CompilerDetector as any).calculatePriority(
                            config.type,
                            config.version,
                            config.path
                        )
                    }));

                priorities.sort((a, b) => b.priority - a.priority);

                assert.ok(priorities.length > 0,
                    `Scenario should have valid priorities: ${scenario.description}`);

                // Verify all priorities are numbers
                priorities.forEach(p => {
                    assert.strictEqual(typeof p.priority, 'number',
                        `Priority should be a number for ${p.name}`);
                });
            });
        });

        it('should handle boundary values correctly', () => {
            const boundaryTests = [
                {
                    description: 'Minimum version number',
                    config: { type: 'clang', version: '0.1.0', path: '/usr/bin/clang' },
                    expectedPriority: 100 + 0 * 10 - 20 // -20 for system path
                },
                {
                    description: 'Very high version number',
                    config: { type: 'clang', version: '999.999.999', path: '/usr/bin/clang' },
                    expectedPriority: 100 + 999 * 10 - 20 // -20 for system path
                },
                {
                    description: 'Version with leading zeros',
                    config: { type: 'clang', version: '001.002.003', path: '/usr/bin/clang' },
                    expectedPriority: 100 + 1 * 10 - 20 // -20 for system path
                },
                {
                    description: 'Version with multiple dots',
                    config: { type: 'clang', version: '19.1.0.1', path: '/usr/bin/clang' },
                    expectedPriority: 100 + 19 * 10 - 20 // -20 for system path
                }
            ];

            boundaryTests.forEach(test => {
                const priority = (CompilerDetector as any).calculatePriority(
                    test.config.type,
                    test.config.version,
                    test.config.path
                );

                assert.strictEqual(priority, test.expectedPriority,
                    `Wrong priority for ${test.description}`);
            });
        });
    });

    describe('Priority Algorithm Robustness', () => {
        it('should handle invalid inputs gracefully', () => {
            const invalidInputs = [
                { type: null, version: '19.1.0', path: '/usr/bin/clang' },
                { type: undefined, version: '19.1.0', path: '/usr/bin/clang' },
                { type: 'clang', version: null, path: '/usr/bin/clang' },
                { type: 'clang', version: undefined, path: '/usr/bin/clang' },
                { type: 'clang', version: '19.1.0', path: null },
                { type: 'clang', version: '19.1.0', path: undefined },
                { type: '', version: '', path: '' },
                { type: '  ', version: '  ', path: '  ' }
            ];

            invalidInputs.forEach(input => {
                try {
                    const priority = (CompilerDetector as any).calculatePriority(
                        input.type as any,
                        input.version as any,
                        input.path as any
                    );

                    // Should not throw and should return a number
                    assert.strictEqual(typeof priority, 'number',
                        `Priority should be a number for invalid input: ${JSON.stringify(input)}`);
                } catch (error) {
                    // If it throws, that's acceptable for truly invalid input
                    assert.ok(error instanceof Error, `Should throw Error for invalid input: ${JSON.stringify(input)}`);
                }
            });
        });

        it('should handle extreme path scenarios', () => {
            const extremePaths = [
                { path: '/usr/bin/clang', description: 'Normal Unix path' },
                { path: 'C:\\Windows\\clang.exe', description: 'Windows path' },
                { path: '/a/very/long/path/that/exceeds/normal/lengths/for/compiler/executables/clang',
                    description: 'Very long path' },
                { path: './relative/path/clang', description: 'Relative path' },
                { path: '~/user/clang', description: 'Home directory path' },
                { path: 'clang', description: 'Just filename' },
                { path: '', description: 'Empty path' },
                { path: ' ', description: 'Whitespace path' }
            ];

            extremePaths.forEach(({ path, description }) => {
                try {
                    const priority = (CompilerDetector as any).calculatePriority(
                        'clang',
                        '19.1.0',
                        path
                    );

                    assert.strictEqual(typeof priority, 'number',
                        `Priority should be a number for ${description}`);
                } catch (error) {
                    assert.fail(`Should not throw for ${description}: ${error}`);
                }
            });
        });
    });

    describe('Priority Consistency', () => {
        it('should produce consistent results for identical inputs', () => {
            const testInput = { type: 'clang', version: '19.1.0', path: '/usr/bin/clang' };
            const iterations = 100;

            const priorities = Array(iterations).fill(0).map(() =>
                (CompilerDetector as any).calculatePriority(
                    testInput.type,
                    testInput.version,
                    testInput.path
                )
            );

            // All priorities should be identical
            const firstPriority = priorities[0];
            priorities.forEach((priority, index) => {
                assert.strictEqual(priority, firstPriority,
                    `Priority should be consistent across iterations (iteration ${index})`);
            });
        });

        it('should handle type comparison consistency', () => {
            const compilerTypes = ['clang', 'clang++', 'apple-clang', 'gcc', 'g++', 'msvc'];
            const version = '19.1.0';
            const path = '/usr/bin/compiler';

            const priorities = compilerTypes.map(type => ({
                type,
                priority: (CompilerDetector as any).calculatePriority(type, version, path)
            }));

            // Priorities should follow expected hierarchy
            const clangPriority = priorities.find(p => p.type === 'clang')?.priority;
            const gccPriority = priorities.find(p => p.type === 'gcc')?.priority;
            const msvcPriority = priorities.find(p => p.type === 'msvc')?.priority;

            assert.ok(clangPriority! > gccPriority!, 'Clang should have higher priority than GCC');
            assert.ok(gccPriority! > msvcPriority!, 'GCC should have higher priority than MSVC');
            assert.ok(clangPriority! > msvcPriority!, 'Clang should have higher priority than MSVC');
        });

        it('should handle version comparison consistency', () => {
            const versions = ['15.0.0', '16.0.0', '17.0.0', '18.0.0', '19.0.0'];
            const type = 'clang';
            const path = '/usr/bin/clang';

            const priorities = versions.map(version => ({
                version,
                priority: (CompilerDetector as any).calculatePriority(type, version, path)
            }));

            // Priorities should increase with version
            for (let i = 1; i < priorities.length; i++) {
                assert.ok(priorities[i].priority > priorities[i - 1].priority,
                    `Version ${priorities[i].version} should have higher priority than ${priorities[i - 1].version}`);
            }
        });
    });

    describe('Priority Algorithm Performance', () => {
        it('should handle large numbers of calculations efficiently', () => {
            const iterations = 10000;
            const startTime = process.hrtime();

            for (let i = 0; i < iterations; i++) {
                (CompilerDetector as any).calculatePriority('clang', '19.1.0', '/usr/bin/clang');
            }

            const endTime = process.hrtime(startTime);
            const duration = endTime[0] * 1000 + endTime[1] / 1000000; // Convert to milliseconds

            // Should complete in reasonable time (less than 100ms for 10,000 iterations)
            assert.ok(duration < 100,
                `Priority calculation should be efficient: ${duration}ms for ${iterations} iterations`);
        });

        it('should have consistent memory usage', () => {
            const initialMemory = process.memoryUsage();
            const iterations = 1000;

            for (let i = 0; i < iterations; i++) {
                (CompilerDetector as any).calculatePriority('clang', '19.1.0', '/usr/bin/clang');
            }

            const finalMemory = process.memoryUsage();
            const memoryIncrease = finalMemory.heapUsed - initialMemory.heapUsed;

            // Memory increase should be minimal (less than 1MB)
            assert.ok(memoryIncrease < 1024 * 1024,
                `Memory usage should be stable: ${memoryIncrease} bytes increase`);
        });
    });
});
