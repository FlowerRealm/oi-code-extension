### 项目认识与技术要点

本扩展旨在为 OI 选手提供一致、可靠的本地开发体验：通过容器将编译与运行彻底与宿主机隔离，避免“装编译器/环境不一致/路径权限”等问题，侧边栏聚焦题目信息管理与操作流，测试体系保障核心功能的稳定性。

### 架构概览
- extension.ts：
  - 激活扩展、注册命令与视图
  - 统一调用 runSingleInDocker，将运行入口（单测/对拍）都指向容器
  - 侧边栏 OI-Code 的 WebviewViewProvider：题目信息、限制与操作（运行/对拍）
- dockerManager.ts：
  - 动态选择官方镜像（gcc:13、python:3.11）
  - run：拼装 docker run 限制参数（CPU/内存/PIDs/网络），并处理 stdout/stderr 与超限标志
  - 临时写挂载位于 `~/.oi-code-tests/tmp`，避免桌面版共享路径问题
- docker/install.ts：
  - 统一静默安装/启动 Docker 的策略（Win/Mac），并轮询 docker info 直至就绪

### 运行细节
- C/C++：容器内执行 gcc/g++，应用 opt/std 设置后编译；可执行文件放置临时可写目录运行
- Python：容器内 python3 直接运行
- 资源限制：
  - timedOut：超时标志
  - memoryExceeded：137 等退出码判定
  - spaceExceeded：stderr 关键字

### 题目工程与 UI
- 结构：`ProblemFolder/main.ext`、`config/problem.json`、`statement.md`、`samples.txt`
- 新建题目：`oicode.createProblem` 生成骨架与语言模板，并支持“复用上次根目录/手动选择”
- 侧边栏：输入题目名称、URL、题面（Markdown 可编辑）、时间/内存限制、样例；下方选择 O2、语言标准；底部按钮运行/对拍/从文件导入样例

### 测试策略
- 使用 @vscode/test-electron 启动 VS Code 测试宿主
- 用例先通过 `oicode.createProblem` 创建题目，再执行 `oicode.runCode`/`oicode.runPairCheck`
- 测试日志输出到 `test-output.log`，便于 CI 与本地排查

### 关键决策
- 全量容器化：对拍及单测全部走容器，消除本地差异
- 放弃自建镜像：直接使用官方语言镜像，降低构建与维护成本
- 路径策略：临时写挂载使用用户目录，避免 Desktop 的共享路径限制
- 返回模型：`runCode` 返回执行结果对象，由外层判断对错/展示

### 后续可拓展点
- 题库集成（如链接远端 OJ，抓取题目元数据）
- 评测配置模板与多用例管理
- 更细粒度的资源限制/沙箱策略（seccomp、AppArmor）
- 评测报告可视化与历史记录


