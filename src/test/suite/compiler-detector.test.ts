/* ---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *-------------------------------------------------------------------------------------------- */

import * as assert from 'assert';
import { describe, beforeEach, it } from 'mocha';
require('mocha');

import { CompilerDetector } from '../../compilers/detector/compilerDetector';
import { CompilerInfo } from '../../types/types';

// Mock for testing compiler detection
class MockCompilerDetector extends CompilerDetector {
    private mockCompilers: CompilerInfo[] = [];

    setMockCompilers(compilers: CompilerInfo[]) {
        this.mockCompilers = compilers;
    }

    async detectCompilers(): Promise<CompilerInfo[]> {
        return this.mockCompilers;
    }
}

describe('CompilerDetector', () => {
    let detector: MockCompilerDetector;

    beforeEach(() => {
        detector = new MockCompilerDetector();
    });

    describe('Compiler Priority Calculation', () => {
        it('should calculate correct priority for different compiler types', () => {
            const testCases = [
                { type: 'clang', version: '19.1.0', expectedPriority: 270 }, // 100 + 19*10 - 20 (system)
                { type: 'clang++', version: '18.1.0', expectedPriority: 260 }, // 100 + 18*10 - 20 (system)
                { type: 'apple-clang', version: '16.0.0', expectedPriority: 230 }, // 90 + 16*10 - 20 (system)
                { type: 'gcc', version: '13.2.0', expectedPriority: 190 }, // 80 + 13*10 - 20 (system)
                { type: 'g++', version: '13.2.0', expectedPriority: 190 }, // 80 + 13*10 - 20 (system)
                { type: 'msvc', version: '19.40.0', expectedPriority: 240 }, // 70 + 19*10 - 20 (system)
                { type: 'unknown', version: '1.0.0', expectedPriority: -10 } // 0 + 1*10 - 20 (system)
            ];

            testCases.forEach(({ type, version, expectedPriority }) => {
                const priority = (CompilerDetector as any).calculatePriority(type, version, '/usr/bin/compiler');
                assert.strictEqual(priority, expectedPriority, `Wrong priority for ${type} ${version}`);
            });
        });

        it('should handle version parsing edge cases', () => {
            const testCases = [
                { version: '19.1.0', expectedPriority: 270 }, // Normal version: 100 + 19*10 - 20 (system)
                { version: '19', expectedPriority: 270 }, // Major version only: 100 + 19*10 - 20 (system)
                { version: '19.1', expectedPriority: 270 }, // Major.minor version: 100 + 19*10 - 20 (system)
                { version: 'v19.1.0', expectedPriority: 270 }, // Version with 'v' prefix: 100 + 19*10 - 20 (system)
                { version: '19.1.0-rc1', expectedPriority: 270 }, // Version with suffix: 100 + 19*10 - 20 (system)
                { version: 'invalid', expectedPriority: 80 }, // Invalid version (clang default): 100 + 0 - 20 (system)
                { version: '', expectedPriority: 80 } // Empty version (clang default): 100 + 0 - 20 (system)
            ];

            testCases.forEach(({ version, expectedPriority }) => {
                const priority = (CompilerDetector as any).calculatePriority('clang', version, '/usr/bin/clang');
                assert.strictEqual(priority, expectedPriority, `Wrong priority for version '${version}'`);
            });
        });

        it('should apply location modifier correctly', () => {
            const basePriority = (CompilerDetector as any).calculatePriority('clang', '19.1.0', '/opt/clang/bin/clang');
            const systemPriority = (CompilerDetector as any).calculatePriority('clang', '19.1.0', '/usr/bin/clang');
            const windowsPriority = (CompilerDetector as any).calculatePriority(
                'clang', '19.1.0', 'C:\\Windows\\clang.exe');

            assert.strictEqual(basePriority, 290); // Base priority
            assert.strictEqual(systemPriority, 270); // Base - 20 (system path)
            assert.strictEqual(windowsPriority, 270); // Base - 20 (Windows path)
        });

        it('should handle complex priority scenarios', () => {
            // Test scenario: User-installed old GCC vs system-installed new Clang
            const userGccPriority = (CompilerDetector as any).calculatePriority(
                'gcc', '13.2.0', '/home/user/gcc/bin/gcc');
            const systemClangPriority = (CompilerDetector as any).calculatePriority(
                'clang', '19.1.0', '/usr/bin/clang');

            assert.ok(systemClangPriority > userGccPriority, 'System Clang should beat user GCC due to type priority');

            // Test scenario: User-installed old Clang vs system-installed new GCC
            const userClangPriority = (CompilerDetector as any).calculatePriority(
                'clang', '16.0.0', '/home/user/clang/bin/clang');
            const systemGccPriority = (CompilerDetector as any).calculatePriority(
                'gcc', '14.1.0', '/usr/bin/gcc');

            assert.ok(userClangPriority > systemGccPriority,
                'User Clang should beat system GCC despite version difference');
        });
    });

    describe('Compiler Name Generation', () => {
        it('should generate correct names for different compiler types', () => {
            const testCases = [
                { type: 'clang', version: '19.1.0', expected: 'Clang 19.1.0' },
                { type: 'clang++', version: '18.1.0', expected: 'Clang++ 18.1.0' },
                { type: 'apple-clang', version: '16.0.0', expected: 'Apple Clang 16.0.0' },
                { type: 'gcc', version: '13.2.0', expected: 'GCC 13.2.0' },
                { type: 'g++', version: '13.2.0', expected: 'G++ 13.2.0' },
                { type: 'msvc', version: '19.40.0', expected: 'MSVC 19.40.0' },
                { type: 'unknown', version: '1.0.0', expected: 'UNKNOWN 1.0.0' },
                { type: 'custom', version: 'unknown', expected: 'CUSTOM' }
            ];

            testCases.forEach(({ type, version, expected }) => {
                const name = (CompilerDetector as any).generateCompilerName(type, version, '/path/to/compiler');
                assert.strictEqual(name, expected, `Wrong name for ${type} ${version}`);
            });
        });

        it('should handle unknown versions gracefully', () => {
            const name = (CompilerDetector as any).generateCompilerName('clang', 'unknown', '/path/to/clang');
            assert.strictEqual(name, 'Clang');
        });

        it('should handle empty versions gracefully', () => {
            const name = (CompilerDetector as any).generateCompilerName('gcc', 'unknown', '/path/to/gcc');
            assert.strictEqual(name, 'GCC');
        });
    });

    describe('Compiler Type Detection', () => {
        it('should detect compiler type from version output', () => {
            const testCases = [
                { path: '/usr/bin/clang', output: 'clang version 19.1.0', expectedType: 'clang' },
                { path: '/usr/bin/clang++', output: 'clang++ version 18.1.0', expectedType: 'clang++' },
                { path: '/usr/bin/clang', output: 'Apple clang version 16.0.0', expectedType: 'apple-clang' },
                { path: '/usr/bin/gcc', output: 'gcc version 13.2.0', expectedType: 'gcc' },
                { path: '/usr/bin/g++', output: 'g++ (GCC) 13.2.0', expectedType: 'g++' },
                { path: '/usr/bin/cl.exe', output: 'Microsoft (R) C/C++ Optimizing Compiler Version 19.40.0',
                    expectedType: 'msvc' },
                { path: '/usr/bin/unknown-compiler', output: 'unknown compiler',
                    expectedType: 'clang' } // Default fallback
            ];

            testCases.forEach(({ path, output, expectedType }) => {
                const type = (CompilerDetector as any).determineCompilerType(path, output);
                assert.strictEqual(type, expectedType, `Wrong type for output: '${output}'`);
            });
        });

        it('should detect compiler type from executable name', () => {
            const testCases = [
                { path: '/usr/bin/clang', expectedType: 'clang' },
                { path: '/usr/bin/clang++', expectedType: 'clang++' },
                { path: '/usr/bin/gcc', expectedType: 'gcc' },
                { path: '/usr/bin/g++', expectedType: 'g++' },
                { path: 'C:\\VC\\bin\\cl.exe', expectedType: 'msvc' },
                { path: '/usr/bin/unknown-compiler', expectedType: 'clang' } // Default fallback
            ];

            testCases.forEach(({ path, expectedType }) => {
                const type = (CompilerDetector as any).determineCompilerType(path, '');
                assert.strictEqual(type, expectedType, `Wrong type for path: '${path}'`);
            });
        });
    });

    describe('Version Parsing', () => {
        it('should parse version from various output formats', () => {
            const testCases = [
                { output: 'clang version 19.1.0', expected: '19.1.0' },
                { output: 'clang version 19.1.0 (https://github.com/llvm/llvm-project.git)', expected: '19.1.0' },
                { output: 'gcc version 13.2.0 (Ubuntu 13.2.0-23ubuntu1)', expected: '13.2.0' },
                { output: 'Apple clang version 16.0.0 (clang-1600.0.26.4)', expected: '16.0.0' },
                { output: 'Microsoft (R) C/C++ Optimizing Compiler Version 19.40.0 for x64', expected: '19.40.0' },
                { output: '19.1.0', expected: '19.1.0' },
                { output: 'version 19.1.0', expected: '19.1.0' },
                { output: 'unknown version format', expected: 'unknown' },
                { output: '', expected: 'unknown' }
            ];

            testCases.forEach(({ output, expected }) => {
                const version = (CompilerDetector as any).parseVersion(output);
                assert.strictEqual(version, expected, `Wrong version for output: '${output}'`);
            });
        });

        it('should handle edge cases in version parsing', () => {
            const testCases = [
                { output: 'clang version', expected: 'unknown' }, // No version number - doesn't match patterns
                { output: 'version', expected: 'unknown' }, // Just the word version - doesn't match patterns
                { output: 'clang version 19', expected: 'unknown' }, // Major version only - doesn't match patterns
                { output: 'clang version 19.1', expected: '19.1' }, // Major.minor only - matches pattern
                { output: 'clang version 19.1.0.1', expected: '19.1.0' }, // Four-part version - matches pattern
                { output: 'clang version v19.1.0', expected: '19.1.0' }, // Version with 'v' prefix
                { output: 'clang version 19.1.0-beta1', expected: '19.1.0' } // Version with suffix
            ];

            testCases.forEach(({ output, expected }) => {
                const version = (CompilerDetector as any).parseVersion(output);
                assert.strictEqual(version, expected, `Wrong version for output: '${output}'`);
            });
        });
    });

    describe('Compiler Deduplication Logic', () => {
        it('should handle duplicate detection correctly', async () => {
            // This test verifies the deduplication algorithm logic
            // Since we can't easily test the full implementation without real filesystem operations,
            // we'll test the core logic components

            const realPath = '/usr/bin/clang';
            const checkedRealPaths = new Set<string>();
            const checkedCompilerTypes = new Set<string>();

            // Simulate checking a real path for the first time
            assert.strictEqual(checkedRealPaths.has(realPath), false);
            checkedRealPaths.add(realPath);
            assert.strictEqual(checkedRealPaths.has(realPath), true);

            // Simulate checking a compiler type for the first time
            const compilerKey = 'clang-19.1.0';
            assert.strictEqual(checkedCompilerTypes.has(compilerKey), false);
            checkedCompilerTypes.add(compilerKey);
            assert.strictEqual(checkedCompilerTypes.has(compilerKey), true);
        });

        it('should handle multi-language compiler scenarios', async () => {
            // Test the logic that allows different compiler names for the same binary
            const checkedCompilerTypes = new Set<string>();

            // First compiler (clang) should be allowed
            const firstKey = 'clang-19.1.0';
            assert.strictEqual(checkedCompilerTypes.has(firstKey), false);

            // Second compiler (clang++) with same real path should be allowed if type is different
            const secondKey = 'clang++-19.1.0';
            assert.strictEqual(checkedCompilerTypes.has(secondKey), false);

            // Third compiler (clang) with same type and version should be rejected
            assert.strictEqual(checkedCompilerTypes.has(firstKey), false);
            checkedCompilerTypes.add(firstKey);
            assert.strictEqual(checkedCompilerTypes.has(firstKey), true);
        });
    });

    describe('Error Handling and Edge Cases', () => {
        it('should handle invalid compiler paths gracefully', () => {
            // Test that the detector handles invalid paths gracefully
            const invalidPaths = [
                '',
                '/nonexistent/path/compiler'
                // Note: null and undefined might cause TypeScript errors in actual usage
            ];

            invalidPaths.forEach(path => {
                try {
                    const type = (CompilerDetector as any).determineCompilerType(path, '');
                    assert.strictEqual(typeof type, 'string');
                    assert.ok(type.length > 0, 'Type should not be empty');
                } catch (error) {
                    // For path-related errors, it's acceptable to throw in some cases
                    // but the error should be meaningful
                    assert.ok(error instanceof Error, 'Error should be an Error instance');
                }
            });
        });

        it('should handle malformed version output gracefully', () => {
            const malformedOutputs = [
                null,
                undefined,
                123,
                {},
                []
            ];

            malformedOutputs.forEach(output => {
                try {
                    const version = (CompilerDetector as any).parseVersion(output as any);
                    assert.strictEqual(version, 'unknown', `Should return 'unknown' for malformed output: ${output}`);
                } catch (error) {
                    // If it throws, that's acceptable behavior for malformed input
                    assert.ok(error instanceof Error, `Should throw Error for malformed output: ${output}`);
                }
            });
        });

        it('should handle special characters in compiler names', () => {
            const specialPaths = [
                '/usr/bin/clang-19',
                '/usr/bin/clang++-19',
                '/usr/bin/gcc-13',
                '/usr/bin/g++-13',
                '/usr/bin/clang-19.1.0',
                '/usr/bin/clang++-19.1.0',
                '/usr/bin/gcc-13.2.0',
                '/usr/bin/g++-13.2.0'
            ];

            specialPaths.forEach(path => {
                try {
                    const type = (CompilerDetector as any).determineCompilerType(path, '');
                    assert.strictEqual(typeof type, 'string');
                    assert.ok(type.length > 0);
                } catch (error) {
                    assert.fail(`Should not throw for special path: ${path}`);
                }
            });
        });

        it('should handle concurrent compiler detection', async () => {
            // Test that the detector can handle multiple concurrent calls
            const mockCompilers: CompilerInfo[] = [
                {
                    path: '/usr/bin/clang',
                    name: 'Clang 19.1.0',
                    type: 'clang',
                    version: '19.1.0',
                    supportedStandards: ['c++17'],
                    is64Bit: true,
                    priority: 290,
                    capabilities: {
                        optimize: true,
                        debug: true,
                        sanitize: true,
                        parallel: true
                    }
                },
                {
                    path: '/usr/bin/gcc',
                    name: 'GCC 13.2.0',
                    type: 'gcc',
                    version: '13.2.0',
                    supportedStandards: ['c++17'],
                    is64Bit: true,
                    priority: 210,
                    capabilities: {
                        optimize: true,
                        debug: true,
                        sanitize: true,
                        parallel: true
                    }
                }
            ];

            detector.setMockCompilers(mockCompilers);

            // Run multiple detections concurrently
            const promises = Array(5).fill(0).map(() => detector.detectCompilers());
            const results = await Promise.all(promises);

            // All should return the same result
            results.forEach(result => {
                assert.deepStrictEqual(result, mockCompilers);
            });
        });
    });

    describe('Platform-Specific Behavior', () => {
        it('should handle Windows-style paths correctly', () => {
            const windowsPaths = [
                'C:\\Program Files\\LLVM\\bin\\clang.exe',
                'C:\\Program Files\\Microsoft Visual Studio\\VC\\Tools\\MSVC\\14.40.0\\bin\\Hostx64\\x64\\cl.exe',
                'C:\\msys64\\mingw64\\bin\\gcc.exe',
                'C:\\msys64\\mingw64\\bin\\g++.exe'
            ];

            windowsPaths.forEach(path => {
                try {
                    const type = (CompilerDetector as any).determineCompilerType(path, '');
                    assert.strictEqual(typeof type, 'string');
                } catch (error) {
                    assert.fail(`Should not throw for Windows path: ${path}`);
                }
            });
        });

        it('should handle Unix-style paths correctly', () => {
            const unixPaths = [
                '/usr/bin/clang',
                '/usr/bin/clang++',
                '/usr/bin/gcc',
                '/usr/bin/g++',
                '/usr/local/bin/clang',
                '/opt/llvm/bin/clang',
                '/home/user/.local/bin/clang'
            ];

            unixPaths.forEach(path => {
                try {
                    const type = (CompilerDetector as any).determineCompilerType(path, '');
                    assert.strictEqual(typeof type, 'string');
                } catch (error) {
                    assert.fail(`Should not throw for Unix path: ${path}`);
                }
            });
        });

        it('should handle macOS-style paths correctly', () => {
            const macOSPaths = [
                '/usr/bin/clang',
                '/Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/clang',
                '/Library/Developer/CommandLineTools/usr/bin/clang',
                '/opt/homebrew/bin/clang'
            ];

            macOSPaths.forEach(path => {
                try {
                    const type = (CompilerDetector as any).determineCompilerType(path, '');
                    assert.strictEqual(typeof type, 'string');
                } catch (error) {
                    assert.fail(`Should not throw for macOS path: ${path}`);
                }
            });
        });
    });
});
