# OI-Code multi-platform Clang container optimized for competitive programming
# Supports both AMD64 and ARM64 architectures
FROM ubuntu:24.04

# Prevent interactive prompts during package installation
ENV DEBIAN_FRONTEND=noninteractive

# Detect architecture for architecture-specific optimizations
ARG TARGETARCH
ENV TARGETARCH=${TARGETARCH}

# Install minimal build tools and libraries for competitive programming
RUN echo "Building for architecture: $TARGETARCH" && \
    apt-get update --quiet && \
    apt-get install -y --no-install-recommends \
    # Core C/C++ development tools (Clang-only for consistency)
    clang-18 \
    clang++-18 \
    # Essential runtime libraries
    libc6-dev \
    libc++-18-dev \
    libc++abi-18-dev \
    libstdc++-13-dev \
    # Essential libraries for competitive coding
    libboost-dev \
    libgmp-dev \
    libmpfr-dev \
    # Minimal system tools (only coreutils already implied)
    && \
    # Create essential symlinks only
    ln -sf /usr/bin/clang-18 /usr/bin/clang && \
    ln -sf /usr/bin/clang++-18 /usr/bin/clang++ && \
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