# OI-Code Project Insights

[![中文文档](https://img.shields.io/badge/项目洞察-中文-red.svg)](i18n/chinese/PROJECT_INSIGHTS.md)

## Project Overview and Technical Highlights

This extension aims to provide OI competitors with a consistent and reliable local development experience: by completely isolating compilation and execution from the host system through containers, avoiding issues like "compiler installation/environment inconsistency/path permissions," with the sidebar focusing on problem information management and operational workflow, and the testing system ensuring core functionality stability.

## Architecture Overview

- **extension.ts**:
  - Activates the extension, registers commands and views
  - Unified call to runSingleInDocker, directing all execution entries (unit tests/pair checking) to containers
  - Sidebar OI-Code WebviewViewProvider: problem information, restrictions, and operations (run/pair check)
  - Command registration: `oicode.runCode`, `oicode.runPairCheck`, `oicode.createProblem`, etc.

- **dockerManager.ts**:
  - Dynamically selects official images (gcc:13)
  - Run: assembles docker run restriction parameters (CPU/memory/PIDs/network), and handles stdout/stderr and timeout flags
  - Temporary write mounts located at `~/.oi-code-tests/tmp`, avoiding Desktop shared path issues
  - **Container Pool Optimization**: Reuse Docker containers for improved performance, reducing container startup overhead

- **docker/install.ts**:
  - Unified silent installation/startup strategy for Docker (Win/Mac/Linux), with polling docker info until ready
  - Support for package managers (winget/choco/brew/apt/pacman) and manual installation
  - Unified error logging mechanism

## Runtime Details

- **C/C++**: Execute gcc/g++ within container, compile after applying opt/std settings; executable files placed in temporary writable directory for execution

- **Resource Restrictions**:
  - timedOut: timeout flag
  - memoryExceeded: judged by exit codes like 137
  - spaceExceeded: stderr keywords
- **Error Handling**: Unified error logging and user-friendly error messages

## Problem Engineering and UI

- **Structure**: `ProblemFolder/main.ext`, `config/problem.json`, `statement.md`, `samples.txt`
- **Create New Problem**: `oicode.createProblem` generates framework and language templates, supports "reuse last root directory/manual selection"
- **Sidebar**: Enter problem name, URL, problem statement (Markdown editable), time/memory limits, samples; select O2, language standard below; run/compare/import samples from file buttons at bottom

## Testing Strategy

- Use @vscode/test-electron to launch VS Code test host
- Test cases first create problems through `oicode.createProblem`, then execute `oicode.runCode`/`oicode.runPairCheck`
- **Cross-platform Compatibility**:
  - Docker availability detection: automatically skip Docker-dependent tests
  - File cleanup retry mechanism: solving Windows file lock issues
  - Catalan number algorithm testing: validating recursive and dynamic programming implementations
- Test logs output to `test-output.log`, for easy CI and local debugging

## Key Decisions

- **Full Containerization**: All pair checking and unit testing run in containers, eliminating local differences
- **No Custom Images**: Directly use official language images, reducing build and maintenance costs
- **Path Strategy**: Temporary write mounts use user directory, avoiding Desktop shared path restrictions
- **Return Model**: `runCode` returns execution result object, handled by outer layer for correctness display
- **Error Handling**: Unified error logging and user-friendly error messages
- **Testing System**: Comprehensive test coverage, ensuring cross-platform compatibility

## Latest Improvements

### Container Pool Optimization
1. **Performance Improvement**: Significantly reduce container startup time through container pool reuse of Docker containers
2. **Resource Management**: Implement container health checks, timeout cleanup, and automatic restart mechanisms
3. **Fallback Mechanism**: Automatically fallback to traditional mode when container pool encounters issues
4. **Cache Mounting**: Support Docker Volumes mounting for improved file copy efficiency

### Security Improvements
1. **Shell Injection Protection**: Refactor code to avoid shell injection risks
2. **Input Processing**: Use secure stdin method for input passing
3. **Resource Restrictions**: Strictly enforce CPU, memory, and process number limits

### Code Quality Improvement
1. **Error Handling**: Improve error handling mechanisms, avoid unhandled Promise rejections
2. **Code Refactoring**: Eliminate duplicate code, improve maintainability
3. **Type Safety**: Improve TypeScript type definitions
4. **Internationalization**: Translate all Chinese comments to English, improve code readability
5. **Documentation Enhancement**: Unify English comment format, improve code documentation quality
6. **Editor Event Optimization**: Integrate duplicate editor listener logic

### User Experience Optimization
1. **Editor Content Loading**: Use polling mechanism to ensure editor content fully loads
2. **Output Processing**: Use stdout directly instead of temporary files
3. **Cleanup Optimization**: Improve Docker resource cleanup logic, avoid deleting user data

### Project Structure Optimization
1. **Build Product Management**: Clean up incorrect build artifacts and fix .gitignore configuration
2. **Directory Structure Normalization**: Ensure build files in correct location (out/ directory)
3. **Code Organization**: Optimize file structure and constant definitions

## Technical Implementation Details

### Container Pool Architecture
```typescript
interface DockerContainer {
    containerId: string;
    languageId: string;
    image: string;
    isReady: boolean;
    lastUsed: number;
}

interface ContainerPool {
    containers: Map<string, DockerContainer>;
    isActive: boolean;
}
```

The container pool works as follows:
1. Pre-start containers when extension activates
2. Maintain one active container per language
3. Implement health checks and timeout cleanup
4. Support automatic fallback to non-pool mode

### Secure Input Processing
```typescript
// Use secure stdin method for input passing
if (input) {
    dockerProcess.stdin.write(input);
    dockerProcess.stdin.end();
}
```

### Resource Cleanup Optimization
```typescript
// Batch stop and remove containers
private static async _stopContainers(containerIds: string[]): Promise<void>
private static async _removeContainers(containerIds: string[]): Promise<void>
```

## Future Extensibility

- Problem database integration (connect to remote OJ, fetch problem metadata)
- Evaluation configuration templates and multi-case management
- More fine-grained resource restrictions/sandbox strategies (seccomp, AppArmor)
- Evaluation report visualization and history records
- Multi-language support (Java, Go, Rust, etc.)
- Online evaluation integration
