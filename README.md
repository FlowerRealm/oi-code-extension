# OI-Code

[![中文文档](https://img.shields.io/badge/文档-中文-red.svg)](i18n/chinese/README.md)
[![English Documentation](https://img.shields.io/badge/English-Documentation-blue.svg)](README.md)

OI-Code is a Visual Studio Code extension designed for competitive programmers and students, helping them practice coding problems. It provides a simplified workflow for writing, compiling, running, and testing code in a controlled Docker environment.

## Features

- **Docker-based Execution**: All code runs in isolated Docker containers to ensure safety and consistency.
- **Multi-language Support**: Ready-to-use support for C, C++, and Python.
- **Problem Management**: Create and organize coding problems with their metadata.
- **Pair Check Feature**: Compare outputs of two different implementations (e.g., brute force vs. optimized solutions).
- **Resource Limits**: Enforce time and memory limits for fair evaluation.
- **Webview Integration**: Rich UI for problem descriptions and settings.
- **Container Pool Optimization**: Reuse Docker containers to improve performance and reduce execution delays.

## System Requirements

- Docker must be installed and running on the system.
- Visual Studio Code 1.60.0 or higher.

## Installation

1. Install Docker on your system.
2. Install this extension from the VS Code Marketplace.
3. The extension will automatically initialize the Docker environment on first use.

## Usage

### Running Code

1. Open a C, C++, or Python file in VS Code.
2. Use the command palette (`Ctrl+Shift+P`) and run `OI-Code: Run Code`.
3. Enter input for the program when prompted.
4. View the output in the new panel.

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

- `oicode.docker.compilers`: Customize Docker images for different languages (e.g., `{"cpp": "my-custom-gcc:latest"}`).
- `oicode.compile.opt`: Default optimization level for C/C++ compilation.
- `oicode.compile.std`: Default C++ standard for compilation.

## Performance Optimizations

### Container Pool
The latest version introduces container pool optimization to significantly improve code execution performance:
- Pre-start containers to reduce startup delays
- Intelligent container management with health checks and timeout cleanup
- Automatic fallback mechanism ensures continued functionality when container pool issues occur

### Security Improvements
- Secure input handling to prevent shell injection attacks
- Strict resource limits to prevent system resource exhaustion
- Improved error handling and logging

### Code Quality Improvements (v0.0.2)
- **Internationalized Code Comments**: All Chinese comments have been translated to English for better code readability
- **Code Structure Optimization**: Clean up redundant code, consolidate duplicate logic, improve error handling
- **Project Structure Standardization**: Fix build artifact locations to ensure correct directory structure
- **Documentation Enhancement**: Update project documentation to reflect recent improvements
- **Build System Improvements**: Clean build artifacts and optimize .gitignore configuration

## Known Issues

- Docker initialization may take some time on first run.
- Large outputs may cause performance issues in the output panel.

## Version Notes

### 0.0.1

Initial version of OI-Code with essential features.

## Contributing

For detailed information on how to contribute to this project, see [CONTRIBUTING.md](CONTRIBUTING.md).

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
