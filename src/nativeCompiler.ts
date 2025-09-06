/* ---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *-------------------------------------------------------------------------------------------- */

// Re-export interfaces and the new modular NativeCompilerManager
export {
    CompilerInfo,
    CompilerDetectionResult,
    LLVMInstallResult,
    CompilationOptions,
    CompilationResult,
    NativeCompilerManager
} from './nativeCompilerManager';

// Re-export individual components for advanced usage
export {
    CompilerCache
} from './compilerCache';

export {
    CompilerDetector
} from './compilerDetector';

export {
    CompilerInstaller
} from './compilerInstaller';

export {
    ProcessRunner,
    ProcessExecutionOptions,
    ProcessExecutionResult
} from './processRunner';
