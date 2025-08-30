# OI-Code multi-platform Clang container optimized for competitive programming
FROM ubuntu:24.04

# Prevent interactive prompts during package installation
ENV DEBIAN_FRONTEND=noninteractive

# Install essential build tools and libraries
RUN apt-get update --quiet && \
    apt-get install -y --no-install-recommends \
    # Core C/C++ development tools
    clang-18 \
    clang++-18 \
    gcc \
    g++ \
    libc6-dev \
    libc++-18-dev \
    libc++abi-18-dev \
    libstdc++-13-dev \
    # Development utilities
    cmake \
    lldb-18 \
    valgrind \
    cppcheck \
    # Code formatting and analysis
    clang-format-18 \
    clang-tidy-18 \
    # Essential libraries for competitive coding
    libboost-dev \
    libgmp-dev \
    libmpfr-dev \
    # System tools
    procps \
    lsof \
    && \
    # Create symlinks for convenience and compatibility
    ln -sf /usr/bin/clang-18 /usr/bin/clang && \
    ln -sf /usr/bin/clang++-18 /usr/bin/clang++ && \
    ln -sf /usr/bin/lld-18 /usr/bin/lld && \
    ln -sf /usr/bin/lldb-18 /usr/bin/lldb && \
    ln -sf /usr/bin/clang-format-18 /usr/bin/clang-format && \
    # Create runner user with proper permissions
    useradd -m -s /bin/bash runner && \
    mkdir -p /sandbox && \
    chown -R runner:runner /sandbox && \
    # Clean up package cache to reduce image size
    apt-get autoremove -y && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/* && \
    # Verify installations
    clang --version && \
    clang++ --version

# Switch to non-privileged user for security
USER runner
WORKDIR /sandbox

# Health check for container monitoring
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD clang --version > /dev/null || exit 1

# Default entrypoint that can run both interactive and non-interactive
ENTRYPOINT ["/bin/bash", "-lc"]

# Build command:
# docker build -t oi-code-clang:latest .
