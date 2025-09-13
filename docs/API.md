# OI-Code Extension API Documentation

## Overview

OI-Code 是一个为信息学竞赛(OI)选手设计的VS Code扩展，提供C/C++代码编译、执行和测试功能。本文档详细描述了扩展的API接口和使用方法。

## Core APIs

### 1. Compiler Detection API

#### `detectCompilers(performDeepScan?: boolean): Promise<CompilerDetectionResult>`

检测系统中可用的C/C++编译器。

**Parameters:**
- `performDeepScan` (optional): 是否执行深度系统扫描，默认为 `false`

**Returns:** `Promise<CompilerDetectionResult>`

**Example:**
```typescript
import { CompilerDetector } from './src/compilers/detector/compilerDetector';

// 基本检测
const result = await CompilerDetector.detectCompilers();
console.log(`Found ${result.compilers.length} compilers`);
console.log(`Recommended: ${result.recommended?.name}`);

// 深度检测
const deepResult = await CompilerDetector.detectCompilers(true);
```

**Response Structure:**
```typescript
interface CompilerDetectionResult {
    success: boolean;
    compilers: CompilerInfo[];
    recommended?: CompilerInfo;
    error?: string;
    suggestions: string[];
}
```

### 2. Code Execution API

#### `runCode(testInput?: string, options?: ExecutionOptions): Promise<ExecutionResult>`

编译并执行当前打开的C/C++代码。

**Parameters:**
- `testInput` (optional): 程序的输入数据
- `options` (optional): 执行选项
  - `timeLimit`: 时间限制（秒）
  - `memoryLimit`: 内存限制（MB）

**Returns:** `Promise<ExecutionResult>`

**Example:**
```typescript
// 基本执行
const result = await vscode.commands.executeCommand('oicode.runCode');
console.log('Output:', result.output);
console.log('Error:', result.error);

// 带输入和限制的执行
const resultWithInput = await vscode.commands.executeCommand(
    'oicode.runCode',
    '5\n3\n', // 输入数据
    { timeLimit: 2, memoryLimit: 128 }
);
```

**Response Structure:**
```typescript
interface ExecutionResult {
    output: string;
    error: string;
    timedOut: boolean;
    memoryExceeded: boolean;
    spaceExceeded: boolean;
}
```

### 3. Pair Check API

#### `runPairCheck(testInput?: string, options?: ExecutionOptions): Promise<PairCheckResult>`

执行对拍测试，比较两个算法实现的输出结果。

**Parameters:**
- `testInput` (optional): 测试输入数据
- `options` (optional): 执行选项

**Returns:** `Promise<PairCheckResult>`

**Example:**
```typescript
// 基本对拍
const pairResult = await vscode.commands.executeCommand('oicode.runPairCheck', '10\n20\n');
console.log('Outputs equal:', pairResult.equal);
console.log('Output 1:', pairResult.output1);
console.log('Output 2:', pairResult.output2);

// 带限制的对拍
const limitedPairResult = await vscode.commands.executeCommand(
    'oicode.runPairCheck',
    '100\n',
    { timeLimit: 5, memoryLimit: 256 }
);
```

**Response Structure:**
```typescript
interface PairCheckResult {
    output1: string;
    output2: string;
    equal: boolean;
    error?: string;
}
```

### 4. Problem Management API

#### `createProblem(payload: CreateProblemPayload): Promise<CreateProblemResult>`

创建新的OI题目项目。

**Parameters:**
- `payload`: 题目创建参数
  - `name`: 题目名称
  - `language`: 编程语言 ('c' | 'cpp')
  - `baseDir`: 基础目录（可选）

**Returns:** `Promise<CreateProblemResult>`

**Example:**
```typescript
const problemResult = await vscode.commands.executeCommand('oicode.createProblem', {
    name: 'Test Problem',
    language: 'cpp',
    baseDir: '/path/to/problems'
});
console.log('Created at:', problemResult.problemDir);
console.log('Source file:', problemResult.sourcePath);
```

### 5. Performance Monitoring API

#### `PerformanceMonitor` Class

性能监控类，用于跟踪扩展操作的性能指标。

**Example:**
```typescript
import { PerformanceMonitor, measure } from './src/utils/performance-monitor';

// 获取监控实例
const monitor = PerformanceMonitor.getInstance();

// 手动测量操作
const operationId = monitor.startTiming('myOperation');
try {
    // 执行操作
    const result = await someExpensiveOperation();
    monitor.endTiming(operationId, true);
} catch (error) {
    monitor.endTiming(operationId, false, { error: error.message });
}

// 使用辅助函数自动测量
const result = await measure('autoOperation', async () => {
    return await someExpensiveOperation();
});

// 获取性能统计
const stats = monitor.getStats();
console.log('Average duration:', stats.averageDuration);
console.log('Success rate:', stats.successRate);

// 显示性能报告
monitor.showReport();
```

**Configuration Options:**
```typescript
const config = {
    enabled: true,
    slowOperationThreshold: 1000, // 1 second
    maxMetricsHistory: 1000,
    autoCleanupInterval: 300000, // 5 minutes
    enableConsoleLogging: false,
    enableOutputChannel: true
};
monitor.updateConfig(config);
```

## Advanced Usage Examples

### 1. Automated Testing Pipeline

```typescript
import * as vscode from 'vscode';

async function runAutomatedTests() {
    // 创建题目
    const problem = await vscode.commands.executeCommand('oicode.createProblem', {
        name: 'Automated Test',
        language: 'cpp'
    });

    // 准备测试用例
    const testCases = [
        { input: '5\n', expected: '120\n' },
        { input: '10\n', expected: '3628800\n' },
        { input: '0\n', expected: '1\n' }
    ];

    // 运行测试
    for (const testCase of testCases) {
        const result = await vscode.commands.executeCommand('oicode.runCode', testCase.input);
        
        if (result.error) {
            console.error(`Test failed: ${result.error}`);
            continue;
        }

        if (result.output.trim() === testCase.expected.trim()) {
            console.log(`✓ Test passed for input: ${testCase.input.trim()}`);
        } else {
            console.error(`✗ Test failed. Expected: ${testCase.expected}, Got: ${result.output}`);
        }
    }
}
```

### 2. Custom Compiler Workflow

```typescript
import { CompilerDetector } from './src/compilers/detector/compilerDetector';

async function customCompilerWorkflow() {
    // 检测编译器
    const detectionResult = await CompilerDetector.detectCompilers(true);
    
    if (!detectionResult.success) {
        console.error('Compiler detection failed:', detectionResult.error);
        return;
    }

    // 选择特定编译器
    const clangCompilers = detectionResult.compilers.filter(c => c.type === 'clang');
    if (clangCompilers.length === 0) {
        console.log('No Clang compilers found');
        return;
    }

    // 使用首选Clang编译器
    const selectedCompiler = clangCompilers[0];
    console.log(`Using compiler: ${selectedCompiler.name}`);
    
    // 执行编译和运行
    const result = await vscode.commands.executeCommand('oicode.runCode', 'test input');
    
    // 分析结果
    if (result.timedOut) {
        console.log('Execution timed out');
    } else if (result.memoryExceeded) {
        console.log('Memory limit exceeded');
    } else {
        console.log('Execution completed successfully');
        console.log('Output:', result.output);
    }
}
```

### 3. Pair Check for Algorithm Validation

```typescript
async function validateAlgorithm() {
    // 测试用例
    const testInputs = [
        '1\n',     // 边界情况
        '100\n',   // 正常情况
        '1000\n',  // 大数测试
        'abc\n'    // 异常输入
    ];

    console.log('Starting pair check validation...\n');

    for (const input of testInputs) {
        console.log(`Testing input: "${input.trim()}"`);
        
        try {
            const result = await vscode.commands.executeCommand('oicode.runPairCheck', input);
            
            if (result.error) {
                console.error(`  Error: ${result.error}`);
                continue;
            }

            if (result.equal) {
                console.log(`  ✓ Outputs match: ${result.output1.trim()}`);
            } else {
                console.log(`  ✗ Outputs differ:`);
                console.log(`    Algorithm 1: ${result.output1.trim()}`);
                console.log(`    Algorithm 2: ${result.output2.trim()}`);
            }
        } catch (error) {
            console.error(`  Failed to execute pair check: ${error}`);
        }
    }
}
```

### 4. Performance Monitoring Integration

```typescript
import { PerformanceMonitor } from './src/utils/performance-monitor';

async function monitoredWorkflow() {
    const monitor = PerformanceMonitor.getInstance();
    
    // 启用详细日志
    monitor.updateConfig({
        enabled: true,
        slowOperationThreshold: 500,
        enableConsoleLogging: true
    });

    console.log('Starting monitored workflow...');

    // 监控的操作序列
    await measure('compilerDetection', async () => {
        return await vscode.commands.executeCommand('oicode.rescanCompilers');
    });

    await measure('problemCreation', async () => {
        return await vscode.commands.executeCommand('oicode.createProblem', {
            name: 'Monitored Problem',
            language: 'cpp'
        });
    });

    await measure('codeExecution', async () => {
        return await vscode.commands.executeCommand('oicode.runCode', 'test input');
    });

    // 显示性能报告
    console.log('\n=== Performance Report ===');
    const stats = monitor.getStats();
    console.log(`Total operations: ${stats.totalOperations}`);
    console.log(`Average duration: ${stats.averageDuration.toFixed(2)}ms`);
    console.log(`Success rate: ${(stats.successRate * 100).toFixed(1)}%`);
    
    monitor.showReport();
}
```

## Error Handling

### Common Error Patterns

```typescript
async function robustExecution() {
    try {
        // 检查编译器可用性
        const detectionResult = await CompilerDetector.detectCompilers();
        if (!detectionResult.success || detectionResult.compilers.length === 0) {
            throw new Error('No compilers available');
        }

        // 执行代码
        const result = await vscode.commands.executeCommand('oicode.runCode', 'test input');
        
        if (result.timedOut) {
            console.warn('Execution timed out - consider increasing time limit');
        }
        
        if (result.memoryExceeded) {
            console.warn('Memory limit exceeded - consider optimizing memory usage');
        }

        return result;
        
    } catch (error) {
        console.error('Execution failed:', error);
        
        // 提供修复建议
        if (error.message.includes('No compilers available')) {
            console.log('Suggestion: Run oicode.setupCompiler to install compilers');
        } else if (error.message.includes('timeout')) {
            console.log('Suggestion: Increase time limit in settings');
        }
        
        throw error; // 重新抛出错误供上层处理
    }
}
```

## Configuration

### Extension Settings

```typescript
// 获取扩展配置
const config = vscode.workspace.getConfiguration('oicode');

// 编译设置
const optimizationLevel = config.get<string>('compile.opt'); // 'O0', 'O1', 'O2', 'O3'
const cppStandard = config.get<string>('compile.std'); // 'c++11', 'c++14', 'c++17'

// 运行设置
const timeLimit = config.get<number>('run.timeLimit'); // 默认时间限制
const memoryLimit = config.get<number>('run.memoryLimit'); // 默认内存限制

// 更新设置
await config.update('compile.opt', 'O2', true);
```

## Commands Reference

### Available Commands

| Command | Description | Parameters |
|---------|-------------|------------|
| `oicode.createProblem` | 创建新题目 | `CreateProblemPayload` |
| `oicode.runCode` | 执行代码 | `testInput?: string`, `options?: ExecutionOptions` |
| `oicode.runPairCheck` | 执行对拍 | `testInput?: string`, `options?: ExecutionOptions` |
| `oicode.setupCompiler` | 设置编译器 | - |
| `oicode.rescanCompilers` | 重新扫描编译器 | - |
| `oicode.deepScanCompilers` | 深度扫描编译器 | - |
| `oicode.showPerformanceReport` | 显示性能报告 | - |
| `oicode.clearPerformanceMetrics` | 清除性能指标 | - |
| `oicode.exportPerformanceMetrics` | 导出性能指标 | - |

### Command Execution Examples

```typescript
// 通过命令面板执行
await vscode.commands.executeCommand('oicode.setupCompiler');

// 带参数执行
await vscode.commands.executeCommand('oicode.runCode', '5\n3\n', {
    timeLimit: 3,
    memoryLimit: 512
});

// 获取所有可用命令
const allCommands = await vscode.commands.getCommands();
const oiCodeCommands = allCommands.filter(cmd => cmd.startsWith('oicode.'));
console.log('Available OI-Code commands:', oiCodeCommands);
```

## Best Practices

### 1. Error Handling
- 始终检查操作结果的成功状态
- 处理超时和内存限制异常
- 提供有意义的错误信息给用户

### 2. Performance Considerations
- 使用性能监控识别瓶颈
- 避免频繁的编译器检测
- 合理设置时间和内存限制

### 3. Resource Management
- 及时清理临时文件
- 正确处理异步操作的取消
- 避免内存泄漏

### 4. Testing Strategy
- 使用对拍验证算法正确性
- 测试边界条件和异常输入
- 自动化回归测试

## Troubleshooting

### Common Issues

**编译器检测失败**
```typescript
// 诊断步骤
const result = await CompilerDetector.detectCompilers(true);
if (!result.success) {
    console.error('Detection failed:', result.error);
    console.log('Suggestions:', result.suggestions);
}
```

**执行超时**
```typescript
// 检查和调整时间限制
const config = vscode.workspace.getConfiguration('oicode');
await config.update('run.timeLimit', 10, true); // 增加到10秒
```

**内存不足**
```typescript
// 优化内存使用或增加限制
await config.update('run.memoryLimit', 1024, true); // 增加到1GB
```

## Version History

### v1.0.0
- 初始版本发布
- 基本的编译和执行功能
- 对拍测试支持

### v1.1.0
- 添加性能监控系统
- 增强错误处理
- 改进编译器检测算法

### v1.2.0
- 添加边界条件测试
- 完善API文档
- 增加WebView安全特性

## Contributing

请参考 [CONTRIBUTING.md](../CONTRIBUTING.md) 了解如何参与项目开发。

## License

MIT License - 详见 [LICENSE](../LICENSE) 文件。