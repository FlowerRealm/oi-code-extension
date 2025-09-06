/* ---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *-------------------------------------------------------------------------------------------- */

/**
 * Compiler information interface
 */
export interface CompilerInfo {
    path: string;
    name: string;
    type: 'clang' | 'clang++' | 'gcc' | 'g++' | 'msvc' | 'apple-clang';
    version: string;
    supportedStandards: string[];
    is64Bit: boolean;
    priority: number;
}

/**
 * Compiler detection result
 */
export interface CompilerDetectionResult {
    success: boolean;
    compilers: CompilerInfo[];
    recommended?: CompilerInfo;
    error?: string;
    suggestions: string[];
    cacheVersion?: string;
    cachedAt?: number;
}

/**
 * LLVM installation result
 */
export interface LLVMInstallResult {
    success: boolean;
    message: string;
    installedPath?: string;
    restartRequired?: boolean;
    nextSteps?: string[];
    suggestions?: string[];
}
