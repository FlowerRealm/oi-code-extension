# OI-Code Project Insights

[![中文文档](https://img.shields.io/badge/项目洞察-中文-red.svg)](i18n/chinese/PROJECT_INSIGHTS.md)

## Project Overview and Technical Highlights

This extension aims to provide OI competitors with a consistent and reliable local development experience: by using native system compilers with automatic detection and installation, avoiding issues like "compiler installation/environment inconsistency/path permissions," with the sidebar focusing on problem information management and operational workflow, and the testing system ensuring core functionality stability.

## Architecture Overview

- **extension.ts**:
  - Activates the extension, registers commands and views
  - Unified call to NativeCompilerManager, directing all execution entries (unit tests/pair checking) to native compilers
  - Sidebar OI-Code WebviewViewProvider: problem information, restrictions, and operations (run/pair check)
  - Command registration: `oicode.runCode`, `oicode.runPairCheck`, `oicode.createProblem`, etc.

- **nativeCompiler.ts**:
  - Cross-platform native compiler detection and management (Windows/macOS/Linux)
  - Automatic compiler prioritization and fallback mechanisms
  - Support for Clang, GCC, MSVC, and Apple Clang compilers
  - **Performance Optimization**: Native compilation provides 3-5x performance improvement over containerized solutions

- **Compiler Installation**:
  - Automatic LLVM installation when no compilers are detected
  - Platform-specific installation methods (Homebrew, apt, dnf, pacman, Windows installer)
  - One-click compiler setup with progress tracking and validation

## Runtime Details

- **C/C++**: Execute with native system compilers (Clang/GCC/MSVC), compile after applying opt/std settings; executable files placed in temporary directory for execution

- **Resource Restrictions**:
  - timedOut: timeout flag with process termination
  - memoryExceeded: platform-specific memory limiting (ulimit on Unix, polling on Windows)
  - spaceExceeded: file system quota monitoring
- **Security**: Process sandboxing with proper resource limits and temporary file cleanup

## Problem Engineering and UI

- **Structure**: `ProblemFolder/main.ext`, `config/problem.json`, `statement.md`, `samples.txt`
- **Create New Problem**: `oicode.createProblem` generates framework and language templates, supports "reuse last root directory/manual selection"
- **Sidebar**: Enter problem name, URL, problem statement (Markdown editable), time/memory limits, samples; select O2, language standard below; run/compare/import samples from file buttons at bottom

## Testing Strategy

- Use @vscode/test-electron to launch VS Code test host
- Test cases first create problems through `oicode.createProblem`, then execute `oicode.runCode`/`oicode.runPairCheck`
- **Cross-platform Compatibility**:
  - Compiler availability detection: automatically skip tests when no compilers are available
  - File cleanup retry mechanism: solving Windows file lock issues
  - Catalan number algorithm testing: validating recursive and dynamic programming implementations
- Test logs output to `test-output.log`, for easy CI and local debugging

## Key Decisions

- **Native Compilation**: All pair checking and unit testing run with native system compilers, providing consistent execution across platforms
- **No External Dependencies**: Directly use system compilers, reducing build and maintenance costs
- **Path Strategy**: Temporary directories use user directory, avoiding Desktop shared path restrictions
- **Return Model**: `runCode` returns execution result object, handled by outer layer for correctness display
- **Error Handling**: Unified error logging and user-friendly error messages
- **Testing System**: Comprehensive test coverage, ensuring cross-platform compatibility

## Latest Improvements

### 🔒 Critical Security Fixes (2025-09-07)
1. **XSS Vulnerability Fix**: Fixed critical client-side XSS in WebView HTML content handling
   - **Issue**: Direct `innerHTML` assignment without sanitization in `webview/pair-check.html`
   - **Solution**: Implemented `escapeHtml()` and `setSafeHtml()` functions for safe content handling
   - **Impact**: Prevents malicious code execution in WebView panels

2. **Promise Handling Improvement**: Fixed unhandled Promise in extension activation
   - **Issue**: "Fire-and-forget" Promise pattern in `src/core/extension.ts`
   - **Solution**: Converted to async/await with proper error handling
   - **Impact**: Prevents silent failures during extension startup

3. **Architecture Refactoring**: Eliminated circular dependencies and code duplication
   - **Issue**: Circular dependency between commands.ts and extension.ts
   - **Solution**: Created dedicated `src/utils/compiler-utils.ts` module
   - **Impact**: Improved architecture and maintainability

4. **Type Safety Enhancement**: Replaced `any` types with specific types
   - **Files**: Multiple core files updated
   - **Solution**: `any` → `unknown` and `Record<string, unknown>`
   - **Impact**: Better TypeScript type safety and error handling

### Previous Improvements

#### Native Compiler Optimization
1. **Performance Improvement**: Native compilation provides 3-5x performance improvement over containerized solutions
2. **Resource Management**: Platform-specific resource limiting with proper cleanup and timeout handling
3. **Fallback Mechanism**: Automatic compiler fallback when preferred compilers are unavailable
4. **Installation Support**: One-click compiler installation with automatic detection and validation

#### Security Improvements
1. **Shell Injection Protection**: Refactor code to avoid shell injection risks
2. **Input Processing**: Use secure stdin method for input passing
3. **Resource Restrictions**: Strictly enforce CPU, memory, and process number limits

#### Code Quality Improvement
1. **Error Handling**: Improve error handling mechanisms, avoid unhandled Promise rejections
2. **Code Refactoring**: Eliminate duplicate code, improve maintainability
3. **Type Safety**: Improve TypeScript type definitions
4. **Internationalization**: Translate all Chinese comments to English, improve code readability
5. **Documentation Enhancement**: Unify English comment format, improve code documentation quality
6. **Editor Event Optimization**: Integrate duplicate editor listener logic

### User Experience Optimization
1. **Editor Content Loading**: Use polling mechanism to ensure editor content fully loads
2. **Output Processing**: Use stdout directly instead of temporary files
3. **Cleanup Optimization**: Improve temporary file cleanup logic, avoid deleting user data

### Project Structure Optimization
1. **Build Product Management**: Clean up incorrect build artifacts and fix .gitignore configuration
2. **Directory Structure Normalization**: Ensure build files in correct location (out/ directory)
3. **Code Organization**: Optimize file structure and constant definitions

## Technical Implementation Details

### Native Compiler Architecture
```typescript
interface CompilerInfo {
    name: string;
    path: string;
    type: 'clang' | 'gcc' | 'msvc' | 'apple-clang';
    version: string;
    is64Bit: boolean;
    priority: number;
}

interface NativeCompilerManager {
    compilers: CompilerInfo[];
    isInitialized: boolean;
}
```

The native compiler system works as follows:
1. Auto-detect available system compilers on extension activation
2. Prioritize compilers based on type and version
3. Implement automatic installation when no compilers are found
4. Support cross-platform compilation with proper resource limiting

### Secure Input Processing
```typescript
// Use secure stdin method for input passing
if (input) {
    childProcess.stdin.write(input);
    childProcess.stdin.end();
}
```

### Resource Cleanup Optimization
```typescript
// Clean up temporary files and processes
private static async _cleanupTempFiles(tempDir: string): Promise<void>
private static async _terminateProcess(process: ChildProcess): Promise<void>
```

## Future Extensibility

- Problem database integration (connect to remote OJ, fetch problem metadata)
- Evaluation configuration templates and multi-case management
- More fine-grained resource restrictions/sandbox strategies (seccomp, AppArmor)
- Evaluation report visualization and history records
- Multi-language support (Java, Go, Rust, etc.)
- Online evaluation integration
