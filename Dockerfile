# OI-Code multi-platform Clang container optimized for competitive programming
# Supports both AMD64 and ARM64 architectures
FROM ubuntu:24.04

# Prevent interactive prompts during package installation
ENV DEBIAN_FRONTEND=noninteractive

# Detect architecture for architecture-specific optimizations
ARG TARGETARCH
ENV TARGETARCH=${TARGETARCH}

# Install essential build tools and libraries
RUN echo "Building for architecture: $TARGETARCH" && \
    apt-get update --quiet && \
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
    # Architecture-specific verification
    echo "Verifying installations for $TARGETARCH architecture:" && \
    clang --version && \
    clang++ --version && \
    echo "Architecture verification complete"

# Architecture-specific optimizations for ARM64
RUN if [ "$TARGETARCH" = "arm64" ]; then \
        echo "Applying ARM64-specific optimizations..." && \
        # Install ARM64-specific tools if available
        apt-get install -y --no-install-recommends \
            # ARM64 debugging tools
            gdb-multiarch \
            # ARM64 cross-compilation support
            gcc-arm-linux-gnueabihf \
            g++-arm-linux-gnueabihf \
            || echo "Some ARM64 tools not available, continuing..." \
        ; fi

# Switch to non-privileged user for security
USER runner
WORKDIR /sandbox

# Health check for container monitoring
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD clang --version > /dev/null || exit 1

# Architecture-aware labels
LABEL org.opencontainers.image.description="OI-Code Clang container for competitive programming - $TARGETARCH"
LABEL org.opencontainers.image.architecture="$TARGETARCH"

# Default entrypoint that can run both interactive and non-interactive
ENTRYPOINT ["/bin/bash", "-lc"]

# Multi-platform build commands:
# AMD64 build: docker build --platform linux/amd64 -t oi-code-clang:amd64 .
# ARM64 build: docker build --platform linux/arm64 -t oi-code-clang:arm64 .
# Multi-arch build: docker buildx build --platform linux/amd64,linux/arm64 -t oi-code-clang:multi .
# Local build: docker build -t oi-code-clang:latest .
