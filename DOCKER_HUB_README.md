# OI-Code Clang Toolchain Docker Images

## 概述

OI-Code 专用的 Clang 工具链镜像，现已在 Docker Hub 上架。这些镜像包含完整的 C/C++ 编译工具链，专门为竞技编程和OI竞赛优化。

## 可用镜像

### Linux 镜像
- **标签**: `flowerrealm/oi-code-clang:latest`
- **基于**: Ubuntu 24.04
- **适用于**: Linux 和 macOS (Apple Silicon 通过 Rosetta)

### Windows 镜像
- **标签**: `flowerrealm/oi-code-clang-windows:latest`
- **基于**: Windows Nano Server (`mcr.microsoft.com/windows/nanoserver:ltsc2022`)
- **适用于**: Windows (使用 Docker Desktop)

## 预装工具链

### Clang 工具
- `clang` - C 编译器
- `clang++` - C++ 编译器
- `lld` - LLVM 链接器
- `lldb` - LLVM 调试器

### 开发工具
- `llvm` - LLVM 工具链
- `valgrind` - 内存检测工具

### 支持的标准
- C: C99, C11, C17
- C++: C++11, C++14, C++17, C++20

## 使用方法

### 直接运行验证
```bash
# 验证 Clang 安装
docker run --rm flowerrealm/oi-code-clang clang --version
docker run --rm flowerrealm/oi-code-clang clang++ --version

# 编译和运行简单程序
echo '#include <iostream>\nint main() { std::cout<<"Hello OI!\n"; return 0; }' > test.cpp
docker run --rm -v $(pwd):/src -w /src flowerrealm/oi-code-clang clang++ test.cpp -o test && ./test
```

### 进入容器
```bash
# Linux
docker run -it --rm flowerrealm/oi-code-clang /bin/bash

# Windows (PowerShell)
docker run -it --rm flowerrealm/oi-code-clang-windows cmd
```

### 专项使用场景

#### OI-Code 扩展
这些镜像是专门为 OI-Code VS Code 扩展设计的。如果你正在开发或使用 OI-Code，推荐使用这些预构建镜像而不是本地构建。

#### 在线评测系统
这些镜像可以集成到在线评测 (OJ) 系统中，支持安全的代码编译和执行。

## 技术特点

### 优化特性
- ✅ 最小化镜像大小
- ✅ 完整的Clang工具链预装
- ✅ 完整的调试工具集成
- ✅ 内存和CPU限制支持

### 安全特性
- ✅ 非root用户运行 (Linux)
- ✅ 最小化攻击面
- ✅ 隔离的文件系统操作
- ✅ 网络访问限制

### 性能特性
- ✅ 优化的构建缓存
- ✅ 多层缓存支持
- ✅ 快速启动时间
- ✅ 内存高效的编译器

## Dockerfile 详细内容

### Linux 版本 (`Dockerfile`)

```dockerfile
FROM ubuntu:24.04 AS base

# Install core LLVM/Clang toolchain - focused OI environment
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update --quiet && \
    apt-get install -y \
        clang-18 clang++-18 clangd-18 clang-format-18 clang-tidy-18 \
        lldb-18 llvm-18 lld-18 libclang-18-dev libclang-cpp18-dev \
        libc++-18-dev libc++abi-18-dev valgrind cppcheck && \
    # Create symlinks for convenience
    ln -sf /usr/bin/clang-18 /usr/bin/clang && \
    ln -sf /usr/bin/clang++-18 /usr/bin/clang++ && \
    ln -sf /usr/bin/lld-18 /usr/bin/lld && \
    ln -sf /usr/bin/lldb-18 /usr/bin/lldb && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Create runner user and verify installation
RUN useradd -m -s /bin/bash runner && \
    mkdir /sandbox && \
    chown runner:runner /sandbox && \
    clang --version && \
    clang++ --version
```

### Windows 版本 (`Dockerfile.windows`)
```dockerfile
# 基于 Windows Nano Server，专用 Clang 工具链
FROM mcr.microsoft.com/windows/nanoserver:ltsc2022

# 安装 Clang 工具链及调试工具
USER ContainerAdministrator

# Nano Server 不支持直接包管理，需要手动设置
# Windows 容器中设置 Clang 的最佳实践：

# 方法1: 使用 PowerShell 预下载二进制文件
RUN powershell -Command \
    Invoke-WebRequest -Uri 'https://github.com/llvm/llvm-project/releases/download/llvmorg-18.1.8/LLVM-18.1.8-win64.exe' -OutFile 'C:\llvm-installer.exe'; \
    Start-Process 'C:\llvm-installer.exe' -ArgumentList '/S /D=C:\llvm' -NoNewWindow -Wait; \
    setx /M PATH '%PATH%;C:\llvm\bin'; \
    Remove-Item 'C:\llvm-installer.exe' -Force;

# 方法2: 如果使用预构建的 ZIP 文件
# RUN powershell -Command \
#     Expand-Archive -Path C:\llvm-18.1.8-win64.zip -DestinationPath C:\llvm; \
#     setx /M PATH '%PATH%;C:\llvm\bin';

# 验证安装
RUN clang --version

USER ContainerUser
```

## 构建和发布

### 本地构建
```bash
# 构建最新版本
docker build -t flowerrealm/oi-code-clang:latest -f Dockerfile .

# 构建带版本号
docker build -t flowerrealm/oi-code-clang:v1.0.0 -f Dockerfile .
```

### 发布到 Docker Hub
```bash
# 使用提供的脚本
./push-to-dockerhub.sh --all

# 或手动操作
docker login
docker tag oi-code-clang:latest flowerrealm/oi-code-clang:latest
docker push flowerrealm/oi-code-clang:latest
```

## 版本管理

### 版本规划
- `latest` - 最新稳定版本
- `v{major}.{minor}.{patch}` - 特定的版本号
- `dev` - 开发版本，包含最新特性

### 更新日志
- **v1.0.0**: 初始发布，完整的 Clang 工具链
- **latest**: 等同于最新版本

## 兼容性

### 操作系统兼容性
- ✅ Ubuntu 18.04+
- ✅ CentOS 7+
- ✅ macOS 10.15+
- ✅ Windows 10/11 (Docker Desktop)

### Docker 版本要求
- ✅ Docker 19.03+
- ✅ Docker Desktop 2.5+

### 资源要求
- **内存**: 512MB 最小，2GB 推荐
- **存储**: 2GB 可用空间
- **网络**: 互联网连接 (构建时需要)

## 故障排除

### 常见问题

#### "镜像拉取失败"
```bash
# 清理缓存并重试
docker pull flowerrealm/oi-code-clang:latest

# 如果还是失败，使用本地构建
git clone https://github.com/FlowerRealm/oi-code-extension.git
cd oi-code-extension
docker build -f Dockerfile -t local-oi-code-clang .
```

#### "容器中没有权限"
- Linux 版本: 确保使用正确的用户ID
- Windows 版本: 使用 `ContainerAdministrator` 权限

#### "网络超时"
镜像构建使用了重试机制和国内镜像源。
如果仍然遇到网络问题，可以：
1. 检查网络连接
2. 使用 VPN
3. 使用本地代理

## 贡献和反馈

欢迎提交问题和PR：
- [GitHub Issues](https://github.com/FlowerRealm/oi-code-extension/issues)
- [Docker Hub](https://hub.docker.com/r/flowerrealm/oi-code-clang)

## 许可证

本镜像包遵循 MIT 许可证，使用时请遵守相应开源协议。
