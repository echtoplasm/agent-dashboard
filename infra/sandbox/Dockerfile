# Sandbox image every agent run executes in (agent-dashboard/sandbox).
#
# It carries the agent CLIs and a few tools agents commonly need, and
# nothing else: no credentials, no config. The API starts containers from it
# as a non-root user with a read-only root filesystem, a private HOME on
# tmpfs and the run's workspace mounted at /workspace (see D-022 in
# docs/decisions.md). CLI versions are pinned so an image rebuild never
# changes the event format the adapters parse; bump them together with the
# adapter fixtures.
FROM node:25-bookworm-slim@sha256:81db02c4b671288a03915da9534dbd54f96d0e7c24d80ccc54f5b36b2e684370

ARG CLAUDE_CODE_VERSION=2.1.291
ARG CODEX_VERSION=0.160.1

RUN apt-get update \
  && apt-get install --yes --no-install-recommends bash ca-certificates git procps ripgrep \
  && rm -rf /var/lib/apt/lists/*

RUN npm install --global --no-fund --no-audit \
    "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}" \
    "@openai/codex@${CODEX_VERSION}" \
  && npm cache clean --force

# The API overrides the user with its own uid so workspace files on the host
# stay owned by the API's account; this user is the fallback for manual runs.
RUN useradd --create-home --home-dir /home/agent --uid 10001 --shell /bin/bash agent

ENV HOME=/home/agent \
    CLAUDE_CONFIG_DIR=/home/agent/.claude \
    CODEX_HOME=/home/agent/.codex \
    DISABLE_AUTOUPDATER=1 \
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1

USER agent
WORKDIR /workspace
