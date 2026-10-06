# Agent Dashboard

A self-hosted web dashboard for launching, monitoring, and governing AI coding
agents (Claude Code and OpenAI Codex CLI), built to run in a homelab.

> Status: Phase 1 (foundation) in progress.

## Repository layout

```
apps/api         Express + Knex backend
apps/web         React + Vite frontend
packages/shared  Zod schemas and types shared by api and web
docs/            Design decisions
```

## Requirements

- Node.js 24 (`nvm use` reads `.nvmrc`)
- Docker with Compose
