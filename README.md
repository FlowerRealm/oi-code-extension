### OI-Code VS Code 扩展

面向 OI（信息学竞赛）的 VS Code 扩展，提供统一容器环境下的编译运行、对拍（Duipai）与题目管理。支持 C / C++ / Python。

### 功能
- 统一容器运行环境，避免本机差异
- 语言支持：C、C++、Python
- 对拍：同一输入对比两份程序输出
- 侧边栏 OI-Code：题目信息、题面（Markdown）、限制与样例；一键运行/对拍；从文件导入样例
- 新建题目：生成工程骨架与语言模板

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
- oicode.createProblem：新建题目（可复用/选择题目根目录）
- oicode.runCode：在容器内编译/运行当前源文件，返回执行结果
- oicode.runPairCheck：两份代码对拍并返回比较结果

### 配置项（全局）
- oicode.compile.opt：优化等级（默认 O2）
- oicode.compile.std：语言标准（如 c++17）

时间/内存限制等作为题目参数在侧边栏设置，并在运行时传入。

### 运行模型
- 自动选择官方镜像（如 gcc:13、python:3.11）
- 受限容器：CPU/内存/PIDs/网络受控；源码只读挂载；临时可写挂载位于 `~/.oi-code-tests/tmp`
- 返回结果字段：output、error、timedOut、memoryExceeded、spaceExceeded

### 目录结构（节选）
```
oi-code/
  src/
    extension.ts
    dockerManager.ts
    docker/install.ts
    test/
  webview/
  README.md
  package.json
```

### 常见问题
- 无法连接容器：请确认 Docker 已启动
- 首次运行缓慢：镜像首次拉取受网络影响


