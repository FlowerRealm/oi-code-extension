# OI-Code Project Insights

## Project Overview and Technical Highlights

This extension aims to provide OI competitors with a consistent and reliable local development experience: by completely isolating compilation and execution from the host system through containers, avoiding issues like "compiler installation/environment inconsistency/path permissions," with the sidebar focusing on problem information management and operational workflow, and the testing system ensuring core functionality stability.

## Architecture Overview

- **extension.ts**:
  - Activate extension, register commands and views
  - Unified call to runSingleInDocker, directing all execution entries (unit tests/pair checks) to containers
  - Sidebar OI-Code's WebviewViewProvider: Problem information, constraints and operations (run/pair check)
  - Command registration: `oicode.runCode`, `oicode.runPairCheck`, `oicode.createProblem`, etc.

- **dockerManager.ts**:
  - Dynamic selection of official images (gcc:13, python:3.11)
  - run: Assemble docker run limit parameters (CPU/memory/PIDs/network), and handle stdout/stderr and timeout flags
  - Temporary write mount located at `~/.oi-code-tests/tmp`, avoiding desktop shared path issues
  - **Container Pool Optimization**: Reuse Docker containers to improve performance and reduce container startup overhead

- **docker/install.ts**:
  - Unified silent installation/startup strategy for Docker (Win/Mac/Linux), with polling of docker info until ready
  - Support for package managers (winget/choco/brew/apt/pacman) and manual installation
  - Unified error logging mechanism

## Execution Details

- **C/C++**: Execute gcc/g++ within container, compile after applying opt/std settings; executable files placed in temporary writable directory
- **Python**: Execute python3 directly within container
- **Resource Limits**:
  - timedOut: Timeout flag
  - memoryExceeded: Determined by exit codes like 137
  - spaceExceeded: stderr keywords
- **Error Handling**: Unified error logging and user-friendly error messages

## Problem Management and UI

- **Structure**: `ProblemFolder/main.ext`, `config/problem.json`, `statement.md`, `samples.txt`
- **Create Problem**: `oicode.createProblem` generates skeleton and language templates, supports "reuse last root directory/manual selection"
- **Sidebar**: Input problem name, URL, statement (Markdown editable), time/memory limits, examples; selection of O2, language standard below; run/pair check/file import sample buttons at bottom

## Testing Strategy

- Use @vscode/test-electron to launch VS Code test host
- Test cases first create problems through `oicode.createProblem`, then execute `oicode.runCode`/`oicode.runPairCheck`
- **Cross-platform Compatibility**:
  - Docker availability detection: Automatically skip Docker-dependent tests
  - File cleanup retry mechanism: Solve Windows file locking issues
  - Catalan number algorithm testing: Validate recursive vs. dynamic programming implementations
- Test logs output to `test-output.log` for CI and local troubleshooting

## Key Decisions

- **Full Containerization**: All pair checks and unit tests run in containers to eliminate local differences
- **Abandon Custom Images**: Directly use official language images to reduce build and maintenance costs
- **Path Strategy**: Use user directory for temporary write mounts to avoid Desktop shared path restrictions
- **Return Model**: `runCode` returns execution result object, outer layer determines correctness/display
- **Error Handling**: Unified error logging and user-friendly error messages
- **Testing System**: Comprehensive test coverage ensuring cross-platform compatibility

## Latest Improvements

### Container Pool Optimization
1. **Performance Improvement**: Significantly reduce container startup time through container pool reuse
2. **Resource Management**: Implement container health checking, timeout cleanup, and automatic restart mechanisms
3. **Fallback Mechanism**: Automatically fall back to traditional mode when container pool encounters issues
4. **Cache Mounting**: Support Docker Volumes mounting for improved file copy efficiency

### Security Improvements
1. **Shell Injection Protection**: Refactor code to avoid shell injection risks
2. **Input Handling**: Use secure stdin method for input passing
3. **Resource Limits**: Strictly enforce CPU, memory, and process limits

### Code Quality Enhancement
1. **Error Handling**: Improve error handling mechanisms to avoid unhandled Promise rejections
2. **Code Refactoring**: Eliminate duplicate code to improve maintainability
3. **Type Safety**: Improve TypeScript type definitions
4. **Internationalization**: Translate all Chinese comments to English to improve code readability
5. **Documentation Improvement**: Standardize English comment format and improve code documentation quality
6. **Editor Event Optimization**: Consolidate duplicate editor listener logic

### User Experience Optimization
1. **Editor Content Loading**: Use polling mechanism to ensure editor content is fully loaded
2. **Output Processing**: Use stdout directly instead of temporary files
3. **Cleanup Optimization**: Improve Docker resource cleanup logic to avoid user data deletion

### Project Structure Optimization
1. **Build Artifact Management**: Clean up erroneous build artifacts and fix .gitignore configuration
2. **Directory Structure Standardization**: Ensure build files are in correct location (out/ directory)
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

The container pool works in the following ways:
1. Pre-start containers when extension is activated
2. Maintain one active container per language
3. Implement health checks and timeout cleanup
4. Support automatic fallback to non-pool mode

### Secure Input Handling
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

## Future Extensibility Points

- Problem database integration (connecting to remote OJs, scraping problem metadata)
- Problem configuration templates and multi-case management
- More fine-grained resource limits/sandbox strategies (seccomp, AppArmor)
- Problem report visualization and history records
- Multi-language support (Java, Go, Rust, etc.)
- Online problem evaluation integration
