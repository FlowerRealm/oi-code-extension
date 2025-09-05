# OI-Code multi-platform Clang container optimized for competitive programming
# Supports both AMD64 and ARM64 architectures
FROM ubuntu:24.04

# Prevent interactive prompts during package installation
ENV DEBIAN_FRONTEND=noninteractive

# Detect architecture for architecture-specific optimizations
ARG TARGETARCH
ENV TARGETARCH=${TARGETARCH}

# Update package lists and install core system packages
RUN apt-get update --quiet && \
    apt-get install -y --no-install-recommends \
    # Core system utilities
    ca-certificates \
    wget \
    curl \
    git \
    && \
    # Clean up package cache
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Install Clang development tools and runtime libraries
RUN apt-get update --quiet && \
    apt-get install -y --no-install-recommends \
    # Core C/C++ development tools (Clang-only for consistency)
    clang-18 \
    clang++-18 \
    # Essential runtime libraries
    libc6-dev \
    libc++-18-dev \
    libc++abi-18-dev \
    libstdc++-13-dev \
    # Memory debugging tool
    valgrind \
    && \
    # Create essential symlinks only
    ln -sf /usr/bin/clang-18 /usr/bin/clang && \
    ln -sf /usr/bin/clang++-18 /usr/bin/clang++ && \
    # Clean up package cache
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Install competitive programming libraries and debugging tools
RUN apt-get update --quiet && \
    apt-get install -y --no-install-recommends \
    # Essential libraries for competitive coding
    libboost-dev \
    libgmp-dev \
    libmpfr-dev \
    # LLVM debugging tools for all architectures
    lldb-18 \
    && \
    # Clean up package cache
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Create runner user and setup sandbox environment
RUN useradd -m -s /bin/bash runner && \
    mkdir -p /sandbox && \
    chown -R runner:runner /sandbox

# Verify installations and architecture-specific setup
RUN echo "Verifying installations for $TARGETARCH architecture:" && \
    clang --version && \
    clang++ --version && \
    echo "Architecture verification complete"

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