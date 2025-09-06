/* ---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *-------------------------------------------------------------------------------------------- */

// Re-export interfaces and the new modular NativeCompilerManager
export { CompilationOptions, CompilationResult, NativeCompilerManager } from './nativeCompilerManager';

// Re-export types from types.ts
export { CompilerInfo, CompilerDetectionResult, LLVMInstallResult } from './types';

// Re-export individual components for advanced usage
export { CompilerCache } from './compilerCache';

export { CompilerDetector } from './compilerDetector';

export { CompilerInstaller } from './compilerInstaller';

export { ProcessRunner, ProcessExecutionOptions, ProcessExecutionResult } from './processRunner';
