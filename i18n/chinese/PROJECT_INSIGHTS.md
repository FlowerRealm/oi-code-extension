# OI-Code 项目洞察

[![中文文档](https://img.shields.io/badge/项目洞察-中文-red.svg)](i18n/chinese/PROJECT_INSIGHTS.md)
[![English Documentation](https://img.shields.io/badge/Project-Insights-blue.svg)](../../docs/PROJECT_INSIGHTS.md)

## 项目认识与技术要点

本扩展旨在为 OI 选手提供一致、可靠的本地开发体验：通过容器将编译与运行彻底与宿主机隔离，避免"装编译器/环境不一致/路径权限"等问题，侧边栏聚焦题目信息管理与操作流，测试体系保障核心功能的稳定性。

## 架构概览

- **extension.ts**：
  - 激活扩展、注册命令与视图
  - 统一调用 runSingleInDocker，将运行入口（单测/对拍）都指向容器
  - 侧边栏 OI-Code 的 WebviewViewProvider：题目信息、限制与操作（运行/对拍）
  - 命令注册：`oicode.runCode`、`oicode.runPairCheck`、`oicode.createProblem` 等

- **nativeCompiler.ts**：
  - 跨平台原生编译器检测和管理（Windows/macOS/Linux）
  - 自动编译器优先级和回退机制
  - 支持 Clang、GCC、MSVC 和 Apple Clang 编译器
  - **性能优化**：原生编译比容器化解决方案提供 3-5 倍的性能提升

- **编译器安装**：
  - 当未检测到编译器时自动安装 LLVM
  - 平台特定的安装方法（Homebrew、apt、dnf、pacman、Windows 安装程序）
  - 一键编译器设置，带有进度跟踪和验证

## 运行细节

- **C/C++**：使用原生系统编译器（Clang/GCC/MSVC）执行，应用 opt/std 设置后编译；可执行文件放置在临时目录中执行

- **资源限制**：
  - timedOut：超时标志，带有进程终止
  - memoryExceeded：平台特定的内存限制（Unix 上使用 ulimit，Windows 上使用轮询）
  - spaceExceeded：文件系统配额监控
- **安全性**：进程沙箱化，带有适当的资源限制和临时文件清理

## 题目工程与 UI

- **结构**：`ProblemFolder/main.ext`、`config/problem.json`、`statement.md`、`samples.txt`
- **新建题目**：`oicode.createProblem` 生成骨架与语言模板，并支持"复用上次根目录/手动选择"
- **侧边栏**：输入题目名称、URL、题面（Markdown 可编辑）、时间/内存限制、样例；下方选择 O2、语言标准；底部按钮运行/对拍/从文件导入样例

## 测试策略

- 使用 @vscode/test-electron 启动 VS Code 测试宿主
- 用例先通过 `oicode.createProblem` 创建题目，再执行 `oicode.runCode`/`oicode.runPairCheck`
- **跨平台兼容**：
  - 编译器可用性检测：当没有编译器可用时自动跳过测试
  - 文件清理重试机制：解决 Windows 文件锁定问题
  - Catalan 数算法测试：验证递归和动态规划实现
- 测试日志输出到 `test-output.log`，便于 CI 与本地排查

## 关键决策

- **原生编译**：使用系统原生编译器，提供更好的性能和用户体验
- **自动检测**：智能检测和配置可用编译器，支持多种编译器类型
- **自动安装**：当没有编译器时提供一键 LLVM 安装功能
- **跨平台支持**：统一支持 Windows、macOS 和 Linux 平台
- **资源限制**：实现平台特定的资源限制机制
- **错误处理**：统一的错误日志记录和用户友好的错误消息
- **测试体系**：全面的测试覆盖，确保跨平台兼容性

## 最新改进

### 原生编译器架构
1. **性能提升**：原生编译比容器化解决方案提供 3-5 倍的性能提升
2. **资源管理**：实现智能编译器检测、缓存和优先级管理
3. **自动安装**：一键 LLVM 安装，支持所有主要平台
4. **兼容性**：支持 Clang、GCC、MSVC 和 Apple Clang 编译器

### 安全性改进
1. **进程沙箱化**：适当的资源限制和临时文件清理
2. **校验验证**：LLVM 安装器下载时进行完整性校验
3. **内存限制**：Windows 上改进的内存监控机制

### 代码质量提升
1. **错误处理**：完善错误处理机制，避免未处理的 Promise 拒绝
2. **代码重构**：消除重复代码，提高可维护性
3. **类型安全**：改进 TypeScript 类型定义
4. **代码规范**：统一代码风格，改善代码文档质量

### 用户体验优化
1. **编译器设置**：改进编译器检测和设置流程
2. **输出处理**：直接使用 stdout 而不是临时文件
3. **清理优化**：改进临时文件清理逻辑，避免删除用户数据

### 项目结构优化
1. **构建产物管理**：清理错误的编译产物并修复.gitignore配置
2. **目录结构规范**：确保构建文件在正确位置（out/目录）
3. **代码组织**：优化文件结构和常量定义

## 技术实现细节

### 容器池架构
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

容器池通过以下方式工作：
1. 在扩展激活时预启动容器
2. 为每种语言维护一个活动容器
3. 实现健康检查和超时清理
4. 支持自动回退到非池模式

### 安全输入处理
```typescript
// 使用安全的 stdin 方式传递输入
if (input) {
    dockerProcess.stdin.write(input);
    dockerProcess.stdin.end();
}
```

### 资源清理优化
```typescript
// 批量停止和删除容器
private static async _stopContainers(containerIds: string[]): Promise<void>
private static async _removeContainers(containerIds: string[]): Promise<void>
```

## 后续可拓展点

- 题库集成（如链接远端 OJ，抓取题目元数据）
- 评测配置模板与多用例管理
- 更细粒度的资源限制/沙箱策略（seccomp、AppArmor）
- 评测报告可视化与历史记录
- 多语言支持（Java、Go、Rust 等）
- 在线评测集成
