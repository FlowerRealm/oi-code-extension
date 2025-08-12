FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && \
    apt-get install -y build-essential openjdk-17-jdk python3 ca-certificates procps coreutils busybox && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

RUN useradd -m runner
WORKDIR /sandbox
USER runner

ENTRYPOINT ["/bin/bash", "-lc"]
