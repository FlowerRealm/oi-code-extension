# Multi-stage build for OI-Code Clang++ container
FROM ubuntu:24.04 AS base

# Install Clang++ toolchain with complete debugging tools
ENV DEBIAN_FRONTEND=noninteractive

# Use official Ubuntu sources for maximum compatibility
# Ubuntu 24.04 uses 'noble' codename
RUN rm -f /etc/apt/sources.list.d/ubuntu.sources && \
    echo "deb http://archive.ubuntu.com/ubuntu/ noble main restricted universe multiverse" > /etc/apt/sources.list && \
    echo "deb http://archive.ubuntu.com/ubuntu/ noble-updates main restricted universe multiverse" >> /etc/apt/sources.list && \
    echo "deb http://security.ubuntu.com/ubuntu/ noble-security main restricted universe multiverse" >> /etc/apt/sources.list

# Install core LLVM/Clang toolchain - focused OI environment
RUN apt-get update --quiet && \
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
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Verify Clang installation
RUN clang --version && clang++ --version

# Create runner user with proper permissions
FROM base AS runner
RUN useradd -m -s /bin/bash runner && \
    mkdir /sandbox && \
    chown runner:runner /sandbox

USER runner
WORKDIR /sandbox

ENTRYPOINT ["/bin/bash", "-lc"]

# Build command:
# docker build -t oi-code-clang:latest .
