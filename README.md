### OI-Code VS Code 扩展

面向 OI（信息学竞赛）的 VS Code 扩展，提供统一容器环境下的编译运行、对拍（Duipai）与题目管理。支持 C / C++ / Python。

### 功能
- 统一容器运行环境，避免本机差异
- 语言支持：C、C++、Python
- 对拍：同一输入对比两份程序输出
- 侧边栏 OI-Code：题目信息、题面（Markdown）、限制与样例；一键运行/对拍；从文件导入样例
- 新建题目：生成工程骨架与语言模板
- 自动 Docker 安装支持（Windows/macOS/Linux）
- 智能错误处理和日志记录

### 安装与构建
- 先决条件：Node.js 16+、VS Code、Docker
- 安装依赖并编译：
```bash
npm install
npm run compile
```
- 运行测试（日志输出到 test-output.log）：
```bash
npm run test:log
```

### 主要命令
- `oicode.createProblem`：新建题目（可复用/选择题目根目录）
- `oicode.runCode`：在容器内编译/运行当前源文件，返回执行结果
- `oicode.runPairCheck`：两份代码对拍并返回比较结果
- `oicode.initializeEnvironment`：初始化 Docker 环境
- `oicode.downloadDocker`：下载并安装 Docker
- `oi-code.showSettingsPage`：显示设置页面
- `oicode.startPairCheck`：启动对拍功能

### 配置项（全局）
- `oicode.compile.opt`：优化等级（默认 O2）
- `oicode.compile.std`：语言标准（如 c++17）
- `oicode.docker.compilers`：Docker 编译器配置

时间/内存限制等作为题目参数在侧边栏设置，并在运行时传入。

### 运行模型
- 自动选择官方镜像（如 gcc:13、python:3.11）
- 受限容器：CPU/内存/PIDs/网络受控；源码只读挂载；临时可写挂载位于 `~/.oi-code-tests/tmp`
- 返回结果字段：output、error、timedOut、memoryExceeded、spaceExceeded
- 智能错误处理：统一的错误日志记录和用户友好的错误消息

### 目录结构
```
oi-code/
  src/
    ├── extension.ts          # 扩展入口和命令注册
    ├── dockerManager.ts      # Docker 容器管理
    ├── docker/
    │   ├── install.ts        # Docker 安装和启动
    │   └── runner.ts         # 容器运行器
    ├── commands/             # 命令实现
    ├── config/               # 配置管理
    ├── problem/              # 题目处理
    ├── test/                 # 测试套件
    ├── utils/                # 工具函数
    └── constants.ts          # 常量定义
  webview/                   # Webview UI 资源
  docs/                      # 项目文档
  README.md                  # 说明文档
  package.json               # 项目配置
```

### 测试体系
- 使用 @vscode/test-electron 启动 VS Code 测试宿主
- 全面的测试覆盖：扩展激活、UI 功能、代码执行、对拍功能
- 跨平台兼容：Windows、Linux、macOS
- Docker 可用性检测：自动跳过需要 Docker 的测试
- 文件清理重试机制：解决 Windows 文件锁定问题
- Catalan 数算法测试：验证递归和动态规划实现

### 常见问题
- **无法连接容器**：请确认 Docker 已启动
- **首次运行缓慢**：镜像首次拉取受网络影响
- **macOS Docker 安装**：运行 `oicode.downloadDocker` 自动安装
- **Windows 文件锁定**：测试使用重试机制解决文件清理问题
- **测试失败**：检查 Docker 可用性，查看 test-output.log 日志

### 开发说明
- 使用 TypeScript 开发，编译到 JavaScript
- Webpack 构建系统
- ESLint 代码规范
- Mocha 测试框架
- 支持 VS Code 1.80+

### 贡献指南
1. Fork 项目
2. 创建功能分支：`git checkout -b feature/AmazingFeature`
3. 提交更改：`git commit -m 'Add some AmazingFeature'`
4. 推送到分支：`git push origin feature/AmazingFeature`
5. 提交 Pull Request

### 许可证
本项目采用 MIT 许可证 - 查看 [LICENSE](LICENSE) 文件了解详情。


