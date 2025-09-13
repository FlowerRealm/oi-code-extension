# CLAUDE.md

本文件为 Claude Code (claude.ai/code) 在此代码库中工作时提供指导。

## 开发命令

### 构建和开发
```bash
npm run compile          # 开发模式构建
npm run watch           # 开发监视模式
npm run package         # 生产构建
npm run lint            # 运行 ESLint
npm test                # 运行所有测试
npm run test:log       # 运行测试并输出日志
```

### 测试
```bash
npm test                # 完整测试套件
npm run compile && tsc -p ./src/test/tsconfig.json && node ./out/test/runTest.js  # 手动执行测试
```

## 架构概览

### 核心组件

**NativeCompilerManager** (`src/native/manager/nativeCompilerManager.ts`): 原生编译器操作中心
- 管理编译器检测、优先级排序和执行
- 处理安全编译，包含资源限制和超时强制
- 在没有可用编译器时实现自动LLVM安装
- 支持使用系统编译器进行C/C++编译和执行
- 修复了关键的退出码处理bug（防止 `0 || -1` 问题）

**编译器检测架构** (`src/compilers/detector/compilerDetector.ts`):
- 系统级PATH扫描可用编译器
- 平台特定检测（Windows: MSVC/MinGW/LLVM, macOS: Xcode/LLVM, Linux: GCC/LLVM）
- 基于版本和类型的智能编译器优先级排序
- 首选编译器不可用时的回退机制
- 可执行二进制文件的自动权限处理

**WebView集成** (`src/core/webview-manager.ts` 和 `src/utils/webview-utils.ts`):
- 题目管理、设置和对拍的多个HTML面板
- 使用 `postWebviewMessage()` 与扩展通信
- 主题感知渲染（深色/浅色支持）
- 对拍结果的丰富diff可视化
- 集中化HTML内容加载工具
- **安全**: 使用 `escapeHtml()` 和 `setSafeHtml()` 函数进行XSS安全的HTML内容处理

**编译器工具** (`src/utils/compiler-utils.ts`):
- 集中化编译器选择逻辑，避免循环依赖
- 安全的编译器检测，带有自动回退和错误处理
- 模块化架构，提高可维护性
- 通过主扩展入口点的重新导出保持向后兼容性

### 扩展入口点

**主扩展** (`src/core/extension.ts`):
- **异步激活**: 使用 `export async function activate()` 进行正确的Promise处理
- 集中激活点，包含全面的错误处理
- 命令: `oicode.createProblem`, `oicode.runCode`, `oicode.startPairCheck`, `oicode.setupCompiler`, `oicode.initializeEnvironment`, `oicode.rescanCompilers`, `oicode.deepScanCompilers`
- 题目视图和对拍视图的WebView面板
- 与VS Code活动栏和面板容器的集成
- 安全输入处理和HTML转义
- 扩展激活时的自动编译器检测，带有正确的await处理
- 通过 `src/extension.ts` 重新导出保持向后兼容性
- **类型安全**: 严格的TypeScript类型检查，错误处理使用 `unknown` 而非 `any`

### 原生编译器集成

**编译器检测** (`src/compilers/detector/compilerDetector.ts`):
- 跨平台编译器发现（Windows、macOS、Linux）
- 支持多种编译器类型：Clang、GCC、MSVC、Apple Clang
- 版本解析和编译器能力评估
- 自动回退到系统包管理器进行安装

**自动安装**:
- 检测不到编译器时一键安装LLVM
- 平台特定安装方法（Homebrew、apt、dnf、pacman、Windows安装程序）
- 安装过程中的进度跟踪和用户反馈
- 安装后验证和配置

### 配置系统

**设置**:
- `oicode.compile.opt`: 优化等级 (O0-O3)
- `oicode.compile.std`: C++标准 (c++17/c++14/c++11/c11/c99)
- `oicode.compile.autoDowngradeClang20`: 自动降级Clang 20+的C++17到C++14
- `oicode.compile.disableStackProtector`: 在Windows上禁用堆栈保护器
- `oicode.run.timeLimit`: 程序执行时间限制（秒）
- `oicode.run.memoryLimit`: 程序执行内存限制（MB）
- `oicode.debug.*`: 各种调试和sanitizer选项

**常量** (`src/constants/constants.ts`):
- 测试目录: `~/.oi-code-tests/tmp`
- 题目管理基础路径

### 测试架构

**测试套件** (`src/test/suite/`):
- 基于Mocha的测试，集成VS Code API
- 严格验证测试，包含实际编译/执行验证
- 题目创建和测试的辅助函数
- 测试题目存储在 `~/.oi-code-tests/problems-ut`
- 全面的错误处理和超时检测测试

## 关键功能

### 对拍系统
- 比较两个实现（暴力算法 vs 优化算法）
- 并排输出，高亮显示差异
- 输入注入和结果验证
- 卡塔兰数序列验证算法正确性

### 题目管理
- 结构化题目目录，包含元数据
- 语言特定模板生成
- 基于WebView的题目描述编辑器

### 安全和性能
- **XSS防护**: WebView内容使用 `escapeHtml()` 和 `setSafeHtml()` 函数进行清理
- **类型安全**: 严格的TypeScript类型检查，使用 `unknown` 和 `Record<string, unknown>` 替代 `any`
- **错误处理**: 全面的错误处理，使用 `instanceof Error` 进行正确的类型检查
- 带有适当资源限制的原生进程执行
- 时间和内存约束强制
- 安全输入清理，防止注入
- 临时文件清理和沙箱化
- 比传统解决方案性能提升3-5倍

## 构建系统

**Webpack配置** (`webpack.config.js`):
- VS Code扩展的CommonJS2库目标
- 将WebView HTML文件复制到输出
- 调试源映射
- 从打包中排除vscode模块

**TypeScript** (`tsconfig.json`):
- ES6目标，CommonJS模块
- 启用严格类型检查
- 输出目录: `/out`

**包脚本**:
- `npm test`: 运行包含编译的全面测试套件
- `npm run lint`: ESLint代码检查，集成prettier
- `npm run compile`: 使用webpack进行开发构建
- `npm run package`: 生产构建，隐藏源映射
- `npm run watch`: 开发监视模式，支持实时编码

## 开发工作流程和最佳实践

### Git工作流程
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
- [ ] 检查TypeScript编译错误
- [ ] 验证功能完整性
- [ ] **安全检查**: WebView内容使用安全的HTML处理函数
- [ ] **类型检查**: 避免使用 `any` 类型，优先使用 `unknown` 或具体类型
- [ ] **Promise处理**: 使用 async/await 而非 "fire-and-forget" 模式
- [ ] **循环依赖**: 确保模块间没有循环导入
- [ ] 提交信息清晰描述更改内容

### 代码审查响应
- 优先处理标记为 "high" 的问题
- 及时修复架构和可维护性问题
- 保持代码整洁和一致性
- 添加适当的注释和文档

## 重要开发说明

- **原生系统编译器**: 此扩展现在使用原生系统编译器
- **编译器依赖**: 需要C/C++编译器（LLVM/GCC），但缺失时会自动安装
- **跨平台**: 扩展在Windows、macOS和Linux上工作，具有适当的编译器支持
- **性能**: 原生编译提供显著的性能优势
- **测试**: 提交前始终运行 `npm test` 确保所有功能正常工作
- **退出码处理**: 处理进程退出码时小心JavaScript假值
- **使用中文**: 请在开发期间用中文与我交流。
- **当前分支**: 正在 `refactor/ui-rewrite` 分支上进行UI和架构改进。

### 🔒 安全要求
- **WebView安全**: 所有HTML内容必须使用 `escapeHtml()` 和 `setSafeHtml()` 函数进行清理
- **XSS防护**: 切勿对用户提供的内容使用直接 `innerHTML` 赋值
- **类型安全**: 错误处理使用 `unknown` 而非 `any`，并进行适当的 `instanceof` 检查

### 🏗️ 架构指导原则
- **模块依赖**: 通过为共享函数创建工具模块避免循环依赖
- **Promise处理**: 使用async/await模式而非 "fire-and-forget" Promise
- **代码重复消除**: 将通用功能提取到可重用的辅助函数中
- **错误处理**: 实现具有类型安全模式的全面错误处理

## 常见问题和解决方案

### 编译器检测问题
- 运行 `oicode.setupCompiler` 手动触发编译器检测
- 检查系统PATH并确保编译器正确安装
- 在Windows上，确保LLVM/MinGW在PATH中或通过Visual Studio安装

### 测试失败
- 验证系统上有可用的C/C++编译器
- 检查编译器可执行文件是否具有适当权限
- 查看测试输出以了解特定的编译或执行错误

### 性能优化
- 原生编译已经优化，但确保系统有足够资源
- 编译器缓存和进程管理自动处理
- 大输出仍可能导致输出面板性能问题

### 🔧 安全最佳实践
- **WebView内容**: 始终使用 `setSafeHtml()` 而非直接 `innerHTML` 赋值
- **错误处理**: 使用 `unknown` 类型和 `instanceof Error` 检查以获得更好的类型安全
- **输入验证**: 处理或显示前清理所有用户输入
- **模块架构**: 保持模块独立以避免循环依赖
- **异步模式**: 优先使用async/await而非Promise链以获得更好的错误处理
- 永远使用英文编写注释
- 不允许跳过ESlint的检查, 遇到问题应该修复
- 每添加一个vscode设置项时, 首先评估这是不是必要的, 如果这必要, 添加进你需要的代码, package.json, webview下的设置列表, 修正claude.md与其余文档
- 你应该永远修复问题, 就算你认为这不是你导致的, 你也应该修复他
- 这个项目只支持C, C++两种语言, 不支持更多
- 不使用的变量应该删除, 而不是使用下划线前缀保留