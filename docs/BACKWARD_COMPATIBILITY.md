# OI-Code Extension 向后兼容性说明

## 概述

OI-Code 扩展致力于保持良好的向后兼容性，确保现有用户的代码和配置在升级到新版本时能够继续正常工作。本文档详细说明了版本间的兼容性承诺、已知的不兼容变更以及迁移指南。

## 版本兼容性承诺

### 支持的版本

- **当前版本**: v1.2.0
- **兼容支持**: v1.0.0 及以上版本
- **废弃警告**: v0.x 版本已不再支持

### 升级路径

```
v1.0.0 → v1.1.0 → v1.2.0
  ✓         ✓         ✓
```

所有从 v1.0.0 开始的版本都可以直接升级到最新版本。

## API 兼容性

### 稳定的 API

以下 API 保持稳定，不会有破坏性变更：

#### 核心命令
```typescript
// 这些命令的签名和行为保持不变
vscode.commands.executeCommand('oicode.createProblem', payload);
vscode.commands.executeCommand('oicode.runCode', testInput?, options?);
vscode.commands.executeCommand('oicode.runPairCheck', testInput?, options?);
vscode.commands.executeCommand('oicode.setupCompiler');
vscode.commands.executeCommand('oicode.rescanCompilers');
```

#### 配置项
```typescript
// 所有现有配置项保持兼容
const config = vscode.workspace.getConfiguration('oicode');
config.get<string>('compile.opt');        // 'O0', 'O1', 'O2', 'O3'
config.get<string>('compile.std');        // 'c++17', 'c++14', 'c++11'
config.get<number>('run.timeLimit');     // 默认时间限制
config.get<number>('run.memoryLimit');   // 默认内存限制
```

### 新增 API

v1.1.0 新增的 API（可选使用）：

```typescript
// 性能监控 API（v1.1.0+）
import { PerformanceMonitor } from './src/utils/performance-monitor';
const monitor = PerformanceMonitor.getInstance();

// 深度编译器扫描（v1.1.0+）
vscode.commands.executeCommand('oicode.deepScanCompilers');
```

v1.2.0 新增的 API（可选使用）：

```typescript
// 性能报告命令（v1.2.0+）
vscode.commands.executeCommand('oicode.showPerformanceReport');
vscode.commands.executeCommand('oicode.clearPerformanceMetrics');
vscode.commands.executeCommand('oicode.exportPerformanceMetrics');
```

## 配置兼容性

### 保持兼容的配置

所有现有配置项在升级后继续有效：

```json
{
    "oicode.compile.opt": "O2",
    "oicode.compile.std": "c++17",
    "oicode.run.timeLimit": 5,
    "oicode.run.memoryLimit": 512
}
```

### 新增配置项

新版本增加的配置项都有默认值，不会影响现有配置：

```json
{
    // v1.1.0 新增（可选）
    "oicode.compile.autoDowngradeClang20": true,
    "oicode.compile.disableStackProtector": false,
    
    // v1.2.0 新增（可选）
    "oicode.debug.enableSanitizers": false,
    "oicode.debug.verboseLogging": false
}
```

## 文件格式兼容性

### 题目目录结构

现有的题目目录结构完全兼容：

```
problem-name/
├── main.cpp          # 源代码文件
├── main.c            # C 源代码文件（可选）
├── description.md    # 题目描述（可选）
└── .oicode-problem   # 题目元数据
```

### 元数据格式

`.oicode-problem` 文件格式保持兼容：

```json
{
    "name": "题目名称",
    "language": "cpp",
    "created": "2024-01-01T00:00:00.000Z",
    "modified": "2024-01-01T00:00:00.000Z"
}
```

v1.1.0+ 版本会自动添加新字段，但不影响现有功能：

```json
{
    // 原有字段保持不变
    "name": "题目名称",
    "language": "cpp",
    "created": "2024-01-01T00:00:00.000Z",
    "modified": "2024-01-01T00:00:00.000Z",
    
    // v1.1.0+ 自动添加的字段
    "version": "1.1.0",
    "settings": {
        "compiler": "auto",
        "optimization": "O2"
    }
}
```

## 编译器兼容性

### 支持的编译器

所有现有编译器继续支持：

- **GCC**: 4.8+
- **Clang**: 3.9+
- **MSVC**: 2017+
- **Apple Clang**: 9.0+

### 编译器检测改进

v1.1.0+ 改进了编译器检测算法，但不影响现有配置：

```typescript
// v1.0.0 检测方式（仍支持）
const compilers = await CompilerDetector.detectCompilers();

// v1.1.0+ 增强检测（可选）
const enhancedCompilers = await CompilerDetector.detectCompilers(true);
```

## WebView 兼容性

### 界面布局

所有 WebView 界面保持向后兼容：

- **题目管理界面**: 布局和功能不变
- **设置界面**: 新增选项放在现有选项之后
- **对拍界面**: 增强的 diff 显示不影响原有功能

### 消息格式

WebView 和扩展之间的消息格式保持兼容：

```typescript
// 发送到 WebView 的消息格式不变
webviewPanel.webview.postMessage({
    type: 'compilerList',
    data: compilers
});

// 从 WebView 接收的消息格式不变
webviewPanel.webview.onDidReceiveMessage(async (message) => {
    if (message.command === 'selectCompiler') {
        // 处理逻辑不变
    }
});
```

## 已知的不兼容变更

### v1.0.0 → v1.1.0

**变更**: 编译器优先级算法优化
- **影响**: 可能会选择不同的编译器作为默认选项
- **原因**: 提高编译器选择的智能化程度
- **解决方案**: 用户可以在设置中手动指定首选编译器

```typescript
// v1.1.0 之前：简单的版本比较
if (versionA > versionB) return 1;

// v1.1.0+：综合优先级计算
const priorityA = calculatePriority(compilerA);
const priorityB = calculatePriority(compilerB);
return priorityA - priorityB;
```

### v1.1.0 → v1.2.0

**变更**: WebView 安全增强
- **影响**: 自定义 WebView 内容可能需要调整
- **原因**: 防止 XSS 漏洞
- **解决方案**: 使用提供的 `escapeHtml()` 和 `setSafeHtml()` 函数

```typescript
// v1.2.0 之前：直接使用 innerHTML
element.innerHTML = userContent;

// v1.2.0+：使用安全的 HTML 处理
element.innerHTML = escapeHtml(userContent);
// 或者
setSafeHtml(element, userContent);
```

## 迁移指南

### 从 v1.0.0 升级到 v1.1.0+

1. **备份配置**（可选但推荐）
   ```bash
   # 导出当前配置
   code --list-extensions | grep oicode
   ```

2. **更新扩展**
   ```bash
   # 通过 VS Code 扩展市场更新
   # 或者手动安装新版本
   ```

3. **验证功能**
   ```typescript
   // 测试基本功能
   await vscode.commands.executeCommand('oicode.runCode', 'test');
   ```

4. **检查编译器**（可选）
   ```typescript
   // 重新检测编译器
   await vscode.commands.executeCommand('oicode.rescanCompilers');
   ```

### 从 v0.x 升级到 v1.0.0+

由于 v0.x 版本已不再支持，建议：

1. **导出现有题目**
   ```bash
   # 备份题目目录
   cp -r ~/.oi-code ~/oi-code-backup
   ```

2. **全新安装**
   ```bash
   # 卸载旧版本
   code --uninstall-extension oicode.oi-code
   
   # 安装新版本
   code --install-extension oicode.oi-code
   ```

3. **迁移题目**
   ```bash
   # 将备份的题目复制到新位置
   cp -r ~/oi-code-backup/problems/* ~/.oi-code/problems/
   ```

## 废弃功能

### 计划废弃的功能

以下功能将在未来版本中废弃，并提供迁移路径：

1. **旧的命令格式**（计划 v2.0 废弃）
   ```typescript
   // 旧格式（仍支持但建议迁移）
   vscode.commands.executeCommand('oicode.compileAndRun');
   
   // 新格式
   vscode.commands.executeCommand('oicode.runCode');
   ```

2. **配置文件格式**（计划 v2.0 废弃）
   ```json
   // 旧格式（仍支持）
   {
       "compiler": "g++",
       "options": "-O2"
   }
   
   // 新格式
   {
       "oicode.compile.opt": "O2",
       "oicode.compile.std": "c++17"
   }
   ```

## 故障排除

### 常见升级问题

1. **配置不生效**
   ```typescript
   // 解决方案：重置配置
   await vscode.workspace.getConfiguration('oicode').update('', undefined, true);
   ```

2. **编译器检测失败**
   ```typescript
   // 解决方案：重新扫描
   await vscode.commands.executeCommand('oicode.deepScanCompilers');
   ```

3. **WebView 显示异常**
   ```typescript
   // 解决方案：重启 WebView
   webviewPanel.dispose();
   // 重新创建面板
   ```

### 回滚指南

如果新版本出现问题，可以回滚到之前版本：

1. **卸载当前版本**
   ```bash
   code --uninstall-extension oicode.oi-code
   ```

2. **安装指定版本**
   ```bash
   # 从 VSIX 文件安装
   code --install-extension oi-code-1.1.0.vsix
   ```

3. **恢复配置**
   ```typescript
   // 从备份恢复配置
   const backupConfig = require('./config-backup.json');
   const config = vscode.workspace.getConfiguration('oicode');
   for (const [key, value] of Object.entries(backupConfig)) {
       await config.update(key, value, true);
   }
   ```

## 测试兼容性

### 兼容性测试清单

- [ ] 所有现有配置项继续有效
- [ ] 现有题目可以正常打开和运行
- [ ] 所有 API 命令返回预期结果
- [ ] WebView 界面显示正常
- [ ] 编译器检测和选择功能正常
- [ ] 对拍功能结果一致
- [ ] 性能监控功能可选启用

### 自动化测试

扩展包含全面的兼容性测试：

```typescript
// tests/compatibility/compatibility.test.ts
suite('Backward Compatibility', () => {
    test('Configuration compatibility', () => {
        // 测试配置兼容性
    });
    
    test('API compatibility', () => {
        // 测试 API 兼容性
    });
    
    test('File format compatibility', () => {
        // 测试文件格式兼容性
    });
});
```

## 反馈和支持

### 报告兼容性问题

如果发现兼容性问题，请提供以下信息：

1. **版本信息**
   ```typescript
   console.log('OI-Code Version:', vscode.extensions.getExtension('oicode.oi-code')?.packageJSON.version);
   console.log('VS Code Version:', vscode.version);
   ```

2. **复现步骤**
   ```typescript
   // 详细的问题复现步骤
   ```

3. **预期 vs 实际行为**
   ```typescript
   // 预期结果和实际结果的对比
   ```

### 获取支持

- **GitHub Issues**: [https://github.com/your-repo/oicode/issues](https://github.com/your-repo/oicode/issues)
- **文档**: [https://github.com/your-repo/oicode/docs](https://github.com/your-repo/oicode/docs)
- **讨论**: [https://github.com/your-repo/oicode/discussions](https://github.com/your-repo/oicode/discussions)

## 未来兼容性承诺

### 兼容性政策

1. **主版本号**（如 v1.x → v2.x）: 可能包含破坏性变更，但会提供迁移指南
2. **次版本号**（如 v1.1 → v1.2）: 只添加新功能，保持向后兼容
3. **修订版本号**（如 v1.1.1 → v1.1.2）: 只修复错误，完全兼容

### 废弃政策

1. **提前通知**: 破坏性变更将在新版本发布前至少 3 个月公告
2. **迁移路径**: 为废弃功能提供明确的迁移方案
3. **过渡期**: 废弃功能将在至少 2 个次要版本中保持可用
4. **文档支持**: 提供详细的迁移文档和工具

---

通过遵循这些向后兼容性承诺，OI-Code 扩展确保用户可以安心升级到新版本，同时享受持续的改进和新功能。