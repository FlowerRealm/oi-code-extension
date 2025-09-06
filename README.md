# OI-Code

[![中文文档](https://img.shields.io/badge/文档-中文-red.svg)](i18n/chinese/README.md)
[![English Documentation](https://img.shields.io/badge/English-Documentation-blue.svg)](README.md)

OI-Code is a Visual Studio Code extension designed for competitive programmers and students, helping them practice coding problems. It provides a simplified workflow for writing, compiling, running, and testing code with high-performance native LLVM compiler support.

## Features

- **Native LLVM Compiler Support**: High-performance local compilation using system LLVM/GCC compilers (3-5x faster performance improvement).
- **Automatic Compiler Detection**: Intelligently discovers and prioritizes available compilers on your system.
- **Cross-Platform Support**: Works seamlessly on Windows, macOS, and Linux with automatic compiler installation.
- **Language Support**: Efficient support for C and C++ compilation and execution.
- **Problem Management**: Create and organize coding problems with their metadata.
- **Pair Check Feature**: Compare outputs of two different implementations (e.g., brute force vs. optimized solutions).
- **Resource Limits**: Enforce time and memory limits for fair evaluation.
- **Webview Integration**: Rich UI for problem descriptions and settings.
- **Compiler Installation**: One-click automatic LLVM installation when no compilers are detected.

## System Requirements

- **LLVM/GCC Compiler**: Clang, GCC, or other C/C++ compilers (automatically installed if missing)
- Visual Studio Code 1.60.0 or higher.

## Installation

1. Install this extension from the VS Code Marketplace.
2. On first use, the extension will automatically detect and configure available compilers.
3. If no compilers are found, it will offer to install LLVM automatically.

## Usage

### Running Code

1. Open a C or C++ file in VS Code.
2. Use the command palette (`Ctrl+Shift+P`) and run `OI-Code: Run Code`.
3. Enter input for the program when prompted.
4. View the output in the new panel.

### Compiler Setup

1. Use `OI-Code: Setup Compiler` to check compiler availability.
2. If no compilers are detected, choose to install LLVM automatically.
3. The extension supports multiple compiler versions and will prioritize the best available option.

### Pair Check Feature

1. Open two implementations of the same problem in VS Code.
2. Use the command palette (`Ctrl+Shift+P`) and run `OI-Code: Run Pair Check`.
3. Enter test input when prompted.
4. Compare outputs side by side with highlighted differences.

### Problem Management

1. Use `OI-Code: Create Problem` to create a new problem structure.
2. Fill in problem details in the sidebar view.
3. Save and run your solution directly from the problem view.

## Extension Settings

This extension provides the following settings:

- `oicode.compile.opt`: Default optimization level for C/C++ compilation (O0-O3).
- `oicode.compile.std`: Default C++ standard for compilation (c++17, c++14, c++11, c11, c99).

## Architecture

### Native Compiler System
The extension has been completely redesigned to use native LLVM/GCC compilers with a modular architecture:

- **Compiler Detection**: Scans system PATH and common installation directories for available compilers
- **Multi-Platform Support**: Automatic detection and configuration for Windows (MSVC/MinGW/LLVM), macOS (Xcode/LLVM), and Linux (GCC/LLVM)
- **Performance**: 3-5x faster execution compared to traditional solutions
- **Resource Efficiency**: Lower memory usage and faster startup times
- **Fallback Mechanism**: Graceful handling of missing compilers with automatic installation

### Supported Compilers
- **LLVM/Clang**: clang, clang++ (preferred for performance)
- **GCC**: gcc, g++ (fallback option)
- **MSVC**: cl.exe (Windows only, for C++ development)
- **Apple Clang**: Xcode bundled compilers (macOS only)

## Version Notes

### 0.0.3 - Native LLVM Implementation
- **Complete Architecture Overhaul**: Implemented modular compiler management system
- **Performance Improvement**: 3-5x faster execution and reduced resource usage
- **Automatic Compiler Detection**: Intelligent discovery and prioritization of system compilers
- **Cross-Platform Support**: Enhanced Windows, macOS, and Linux compatibility
- **One-Click Installation**: Automatic LLVM installation when no compilers are detected
- **Improved Error Handling**: Better error messages and fallback mechanisms

### 0.0.2
- **Internationalized Code Comments**: All Chinese comments have been translated to English for better code readability
- **Code Structure Optimization**: Clean up redundant code, consolidate duplicate logic, improve error handling
- **Project Structure Standardization**: Fix build artifact locations to ensure correct directory structure
- **Documentation Enhancement**: Update project documentation to reflect recent improvements
- **Build System Improvements**: Clean build artifacts and optimize .gitignore configuration

### 0.0.1
- Initial version of OI-Code with basic functionality.

## Contributing

For detailed information on how to contribute to this project, see [CONTRIBUTING.md](CONTRIBUTING.md).

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
