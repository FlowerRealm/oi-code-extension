# OI-Code Clang container based on Ubuntu 24.04
FROM ubuntu:24.04

# Install Clang++ toolchain with complete debugging tools
ENV DEBIAN_FRONTEND=noninteractive

# Setup LLVM/Clang toolchain, system configuration and user environment
RUN rm -f /etc/apt/sources.list.d/ubuntu.sources && \
    echo "deb http://archive.ubuntu.com/ubuntu/ noble main restricted universe multiverse" > /etc/apt/sources.list && \
    echo "deb http://archive.ubuntu.com/ubuntu/ noble-updates main restricted universe multiverse" >> /etc/apt/sources.list && \
    echo "deb http://security.ubuntu.com/ubuntu/ noble-security main restricted universe multiverse" >> /etc/apt/sources.list && \
    apt-get update --quiet && \
    apt-get install -y \
    clang-18 \
    clang++-18 \
    clangd-18 \
    clang-format-18 \
    clang-tidy-18 \
    lldb-18 \
    llvm-18 \
    lld-18 \
    libclang-18-dev \
    libclang-cpp18-dev \
    libc++-18-dev \
    libc++abi-18-dev \
        valgrind \
        cppcheck \
        && \
    # Create symlinks for convenience
    ln -sf /usr/bin/clang-18 /usr/bin/clang && \
    ln -sf /usr/bin/clang++-18 /usr/bin/clang++ && \
    ln -sf /usr/bin/lld-18 /usr/bin/lld && \
    ln -sf /usr/bin/lldb-18 /usr/bin/lldb && \
    # Create runner user with proper permissions and verify Clang installation
    useradd -m -s /bin/bash runner && \
    mkdir /sandbox && \
    chown runner:runner /sandbox && \
    clang --version && \
    clang++ --version && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

USER runner
WORKDIR /sandbox

ENTRYPOINT ["/bin/bash", "-lc"]

# Build command:
# docker build -t oi-code-clang:latest .
