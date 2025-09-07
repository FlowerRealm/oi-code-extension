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

**NativeCompilerManager** (`src/nativeCompiler.ts`): Central native compiler operations hub
- Manages compiler detection, prioritization, and execution
- Handles secure compilation with resource limits and timeout enforcement
- Implements automatic LLVM installation when no compilers are available
- Supports C/C++ compilation and execution with system compilers
- Fixed critical exit code handling bug (prevents `0 || -1` issue)

**Compiler Detection Architecture**:
- System-wide PATH scanning for available compilers
- Platform-specific detection (Windows: MSVC/MinGW/LLVM, macOS: Xcode/LLVM, Linux: GCC/LLVM)
- Intelligent compiler prioritization based on version and type
- Fallback mechanisms when preferred compilers are unavailable
- Automatic permission handling for executable binaries

**WebView Integration** (`webview/`):
- Multiple HTML panels for problem management, settings, and pair checking
- Uses `postWebviewMessage()` for communication with extension
- Theme-aware rendering (dark/light support)
- Rich diff visualization for pair check results

### Extension Entry Point

**Main Extension** (`src/extension.ts`):
- Commands: `oicode.createProblem`, `oicode.runCode`, `oicode.startPairCheck`, `oicode.setupCompiler`
- WebView panels for problem view and pair check view
- Integration with VS Code activity bar and panel containers
- Secure input handling and HTML escaping
- Automatic compiler detection on extension activation

### Native Compiler Integration

**Compiler Detection** (`src/nativeCompiler.ts`):
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

**Constants** (`src/constants.ts`):
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
- [ ] 运行 `npm run lint` - 确保代码符合规范
- [ ] 检查 TypeScript 编译错误
- [ ] 验证功能完整性
- [ ] 提交信息清晰描述更改内容

### 代码审查响应
- 优先处理标记为 "high" 的问题
- 及时修复架构和可维护性问题
- 保持代码整洁和一致性
- 添加适当的注释和文档

## Recent Improvements (2025-09-06)

### 🔄 Code Review Fixes
1. **Clang 20+ Compatibility**: Added configurable auto-downgrade from C++17 to C++14
   - New setting: `oicode.compile.autoDowngradeClang20` (default: true)
   - User can disable via settings if needed

2. **Windows Memory Limit Enhancement**: 
   - Replaced wmic with PowerShell for better reliability
   - Implemented adaptive polling (checks more frequently near limits)
   - Reduced check interval from 200ms to 100ms
   - Added timeout protection for memory check commands

3. **WebView API Compliance**: Fixed `resolveWebviewView` method signatures
   - Added missing `_context` and `_token` parameters
   - Ensures compatibility with VS Code API contract

4. **Test Infrastructure**: Optimized `normalizeOutput` function
   - Fixed operation order: replace line endings first, then trim
   - Ensures proper output comparison

5. **Code Architecture**: Refactored compiler workaround logic
   - Extracted `applyCompilerWorkarounds` helper function
   - Improved maintainability and extensibility
   - Better separation of concerns

6. **System Compatibility**: Increased command timeout
   - Extended `executeCommand` timeout from 10s to 30s
   - Better reliability on slow systems or under heavy load

7. **Documentation**: Enhanced Windows Job Objects TODO
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