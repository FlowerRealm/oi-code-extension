# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Build and Development
```bash
npm run compile          # Build in development mode
npm run watch           # Watch mode for development
npm run package         # Production build
npm run lint            # Run ESLint
npm test                # Run all tests
npm run test:log       # Run tests with output logging
```

### Testing
```bash
npm test                # Full test suite
npm run compile && tsc -p ./src/test/tsconfig.json && node ./out/test/runTest.js  # Manual test execution
```

## Architecture Overview

### Core Components

**NativeCompilerManager** (`src/native/manager/nativeCompilerManager.ts`): Central native compiler operations hub
- Manages compiler detection, prioritization, and execution
- Handles secure compilation with resource limits and timeout enforcement
- Implements automatic LLVM installation when no compilers are available
- Supports C/C++ compilation and execution with system compilers
- Fixed critical exit code handling bug (prevents `0 || -1` issue)

**Compiler Detection Architecture** (`src/compilers/detector/compilerDetector.ts`):
- System-wide PATH scanning for available compilers
- Platform-specific detection (Windows: MSVC/MinGW/LLVM, macOS: Xcode/LLVM, Linux: GCC/LLVM)
- Intelligent compiler prioritization based on version and type
- Fallback mechanisms when preferred compilers are unavailable
- Automatic permission handling for executable binaries

**WebView Integration** (`src/core/webview-manager.ts` and `src/utils/webview-utils.ts`):
- Multiple HTML panels for problem management, settings, and pair checking
- Uses `postWebviewMessage()` for communication with extension
- Theme-aware rendering (dark/light support)
- Rich diff visualization for pair check results
- Centralized HTML content loading utilities
- **Security**: XSS-safe HTML content handling with `escapeHtml()` and `setSafeHtml()` functions

**Compiler Utilities** (`src/utils/compiler-utils.ts`):
- Centralized compiler selection logic to avoid circular dependencies
- Safe compiler detection with automatic fallback and error handling
- Modular architecture for better maintainability
- Backward compatibility through re-exports from main extension entry point

### Extension Entry Point

**Main Extension** (`src/core/extension.ts`):
- **Async activation**: Uses `export async function activate()` for proper Promise handling
- Central activation point with comprehensive error handling
- Commands: `oicode.createProblem`, `oicode.runCode`, `oicode.startPairCheck`, `oicode.setupCompiler`
- WebView panels for problem view and pair check view
- Integration with VS Code activity bar and panel containers
- Secure input handling and HTML escaping
- Automatic compiler detection on extension activation with proper await handling
- Backward compatibility through `src/extension.ts` re-exports
- **Type Safety**: Strict TypeScript typing with `unknown` instead of `any` for error handling

### Native Compiler Integration

**Compiler Detection** (`src/compilers/detector/compilerDetector.ts`):
- Cross-platform compiler discovery (Windows, macOS, Linux)
- Support for multiple compiler types: Clang, GCC, MSVC, Apple Clang
- Version parsing and compiler capability assessment
- Automatic fallback to system package managers for installation

**Automatic Installation**:
- One-click LLVM installation when no compilers detected
- Platform-specific installation methods (Homebrew, apt, dnf, pacman, Windows installer)
- Progress tracking and user feedback during installation
- Post-installation validation and configuration

### Configuration System

**Settings**:
- `oicode.compile.opt`: Optimization level (O0-O3)
- `oicode.compile.std`: C++ standard (c++17/c++14/c++11/c11/c99)

**Constants** (`src/constants/constants.ts`):
- Test directory: `~/.oi-code-tests/tmp`
- Problem management base paths

### Test Architecture

**Test Suite** (`src/test/suite/`):
- Mocha-based testing with VS Code API integration
- Strict validation tests with actual compilation/execution verification
- Helper functions for problem creation and testing
- Test problems stored in `~/.oi-code-tests/problems-ut`
- Comprehensive error handling and timeout detection tests

## Key Features

### Pair Check System
- Compares two implementations (brute force vs optimized)
- Side-by-side output with highlighted differences
- Input injection and result validation
- Catalan number sequence validation for algorithmic correctness

### Problem Management
- Structured problem directories with metadata
- Language-specific template generation
- WebView-based problem description editor

### Security and Performance
- **XSS Prevention**: WebView content sanitized using `escapeHtml()` and `setSafeHtml()` functions
- **Type Safety**: Strict TypeScript typing with `unknown` and `Record<string, unknown>` instead of `any`
- **Error Handling**: Comprehensive error handling with proper type checking using `instanceof Error`
- Native process execution with proper resource limits
- Time and memory constraints enforcement
- Secure input sanitization to prevent injection
- Temporary file cleanup and sandboxing
- 3-5x performance improvement over traditional solutions

## Build System

**Webpack Configuration** (`webpack.config.js`):
- CommonJS2 library target for VS Code extension
- Copies WebView HTML files to output
- Source maps for debugging
- Excludes vscode module from bundling

**TypeScript** (`tsconfig.json`):
- ES6 target with CommonJS modules
- Strict type checking enabled
- OutDir: `/out`

## Development Workflow and Best Practices

### Git Workflow
```bash
# 开发工作流程
npm test                    # 始终先运行测试确保功能正常
npm run lint               # 运行代码检查
git add .                  # 添加所有修改
git commit -m "描述性提交信息"  # 创建详细提交
git push origin <branch-name>  # 🔄 立即推送到远程仓库
```

**重要**: 每次提交后必须立即推送到远程仓库，保持分支同步。

### 代码质量检查清单
- [ ] 运行 `npm test` - 确保所有测试通过
- [ ] 运行 `npm run lint` - 确保代码符合规范（无错误，警告数量可控）
- [ ] 检查 TypeScript 编译错误
- [ ] 验证功能完整性
- [ ] **安全检查**: WebView 内容使用安全的 HTML 处理函数
- [ ] **类型检查**: 避免使用 `any` 类型，优先使用 `unknown` 或具体类型
- [ ] **Promise 处理**: 使用 async/await 而非 "fire-and-forget" 模式
- [ ] **循环依赖**: 确保模块间没有循环导入
- [ ] 提交信息清晰描述更改内容

### 代码审查响应
- 优先处理标记为 "high" 的问题
- 及时修复架构和可维护性问题
- 保持代码整洁和一致性
- 添加适当的注释和文档

## Recent Improvements (2025-09-07)

### 🔒 Critical Security and Architecture Fixes

#### **High Priority Security Vulnerability Fixes**
1. **XSS Security Vulnerability**: Fixed critical client-side XSS in WebView HTML content
   - **Location**: `webview/pair-check.html:82-83` (CodeQL identified)
   - **Issue**: Direct `innerHTML` assignment without sanitization
   - **Fix**: Implemented `escapeHtml()` and `setSafeHtml()` functions
   - **Impact**: Prevents malicious code execution in WebView panels

2. **Promise Handling Issue**: Fixed unhandled Promise in extension activation
   - **Location**: `src/core/extension.ts:13-26`
   - **Issue**: "Fire-and-forget" Promise pattern
   - **Fix**: Converted to async/await with proper error handling
   - **Impact**: Prevents silent failures during extension startup

#### **Code Quality Improvements**
3. **Code Deduplication**: Refactored WebViewManager
   - **Location**: `src/core/webview-manager.ts:49-112`
   - **Issue**: Duplicate panel creation logic in three methods
   - **Fix**: Extracted `createWebviewPanel()` helper function
   - **Impact**: Reduced code duplication from 60+ lines to 15 lines

4. **Circular Dependency Resolution**: Fixed module import cycles
   - **Issue**: getSuitableCompiler creating circular dependency between commands.ts and extension.ts
   - **Fix**: Created dedicated `src/utils/compiler-utils.ts` module
   - **Impact**: Improved architecture and maintainability

5. **Type Safety Enhancement**: Replaced `any` types with specific types
   - **Files**: `src/core/commands.ts`, `src/native/manager/nativeCompilerManager.ts`, `src/utils/webview-utils.ts`
   - **Fix**: `any` → `unknown` and `Record<string, unknown>`
   - **Impact**: Better TypeScript type safety and error handling

#### **Previous Improvements (2025-09-06)**
6. **Clang 20+ Compatibility**: Added configurable auto-downgrade from C++17 to C++14
   - New setting: `oicode.compile.autoDowngradeClang20` (default: true)
   - User can disable via settings if needed

7. **Windows Memory Limit Enhancement**: 
   - Replaced wmic with PowerShell for better reliability
   - Implemented adaptive polling (checks more frequently near limits)
   - Reduced check interval from 200ms to 100ms
   - Added timeout protection for memory check commands

8. **WebView API Compliance**: Fixed `resolveWebviewView` method signatures
   - Added missing `_context` and `_token` parameters
   - Ensures compatibility with VS Code API contract

9. **Test Infrastructure**: Optimized `normalizeOutput` function
   - Fixed operation order: replace line endings first, then trim
   - Ensures proper output comparison

10. **Code Architecture**: Refactored compiler workaround logic
    - Extracted `applyCompilerWorkarounds` helper function
    - Improved maintainability and extensibility
    - Better separation of concerns

11. **System Compatibility**: Increased command timeout
    - Extended `executeCommand` timeout from 10s to 30s
    - Better reliability on slow systems or under heavy load

12. **Documentation**: Enhanced Windows Job Objects TODO
    - Detailed current implementation limitations
    - Specific implementation guidance and required APIs
    - Clear benefits of native OS-level enforcement

## Important Development Notes

- **Native System Compilers**: This extension now uses native system compilers
- **Compiler Dependencies**: C/C++ compilers (LLVM/GCC) are required but automatically installed if missing
- **Cross-Platform**: The extension works on Windows, macOS, and Linux with appropriate compiler support
- **Performance**: Native compilation provides significant performance benefits
- **Testing**: Always run `npm test` before committing to ensure all functionality works correctly
- **Exit Code Handling**: Be careful with JavaScript falsy values when handling process exit codes
- **Use Chinese**: Please communicate with me in Chinese during development.

### 🔒 Security Requirements
- **WebView Safety**: All HTML content must be sanitized using `escapeHtml()` and `setSafeHtml()` functions
- **XSS Prevention**: Never use direct `innerHTML` assignment with user-provided content
- **Type Safety**: Use `unknown` instead of `any` for error handling, with proper `instanceof` checks

### 🏗️ Architecture Guidelines
- **Module Dependencies**: Avoid circular dependencies by creating utility modules for shared functions
- **Promise Handling**: Use async/await pattern instead of "fire-and-forget" Promises
- **Code Deduplication**: Extract common functionality into reusable helper functions
- **Error Handling**: Implement comprehensive error handling with type-safe patterns

## Common Issues and Solutions

### Compiler Detection Issues
- Run `oicode.setupCompiler` to manually trigger compiler detection
- Check system PATH and ensure compilers are properly installed
- On Windows, ensure LLVM/MinGW is in PATH or installed via Visual Studio

### Test Failures
- Verify C/C++ compilers are available on the system
- Check that compiler executables have proper permissions
- Review test output for specific compilation or execution errors

### Performance Optimization
- Native compilation is already optimized, but ensure system has sufficient resources
- Compiler caching and process management are handled automatically
- Large outputs may still cause performance issues in the output panel

### 🔧 Security Best Practices
- **WebView Content**: Always use `setSafeHtml()` instead of direct `innerHTML` assignment
- **Error Handling**: Use `unknown` type with `instanceof Error` checks for better type safety
- **Input Validation**: Sanitize all user inputs before processing or displaying
- **Module Architecture**: Keep modules independent to avoid circular dependencies
- **Async Patterns**: Prefer async/await over Promise chains for better error handling