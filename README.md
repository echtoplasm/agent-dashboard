# Agent Dashboard

A self-hosted web dashboard for launching, monitoring, and governing AI coding
agents (Claude Code and OpenAI Codex CLI), built to run in a homelab.

> **Status:** Phase 1 (foundation) is complete: monorepo, database schema,
> migrations and seeds, health endpoint, minimal web app and CI. Agent and
> skill management, auth and run execution come in later phases.

## Repository layout

```
apps/api           Express + Knex backend
  knexfile.ts      Migration/seed config (owner role)
  src/config/      Environment loading and validation
  src/db/          Knex client, migrations/, seeds/, db-cli.ts
  src/modules/     One folder per domain (routes → service → repository)
  test/            Integration test helpers
apps/web           React + Vite frontend
packages/shared    Zod schemas and types shared by api and web
infra/postgres/    Database bootstrap script (roles and databases)
docs/decisions.md  Design decisions and the reasons for them
```

## Requirements

- Node.js 24 (`nvm use` picks it up from `.nvmrc`)
- Docker with Compose v2
- `openssl`, for generating local passwords

## Getting started

1. **Install dependencies.**

   ```sh
   npm install
   ```

2. **Create `.env` with real passwords.** `.env` is gitignored. Copy the
   example, then replace every `change-me`. Each of the two role passwords
   appears twice, once in its own variable and once inside the URLs.

   ```sh
   cp .env.example .env
   chmod 600 .env
   openssl rand -base64 24 | tr -d '/+='   # run once per password
   ```

3. **Start Postgres.** On first start, the container creates the
   `agent_dashboard_owner` and `agent_dashboard_app` roles plus the
   `agent_dashboard` and `agent_dashboard_test` databases. It listens on
   `127.0.0.1:5434` by default (`POSTGRES_HOST_PORT`).

   ```sh
   docker compose up -d --wait
   ```

4. **Apply migrations and seeds.**

   ```sh
   npm run db:migrate
   npm run db:seed
   ```

5. **Run the API and web app** in two terminals.

   ```sh
   npm run dev:api   # http://127.0.0.1:3000/api/health
   npm run dev:web   # http://127.0.0.1:5173
   ```

## Scripts

Run from the repository root.

| Script                                                        | What it does                                                        |
| ------------------------------------------------------------- | ------------------------------------------------------------------- |
| `npm run dev:api`                                             | API with auto-reload (`tsx watch`)                                  |
| `npm run dev:web`                                             | Vite dev server, proxying `/api` to the API                         |
| `npm run db:migrate`                                          | Apply pending migrations (as the owner role)                        |
| `npm run db:rollback`                                         | Roll back the last batch. Add `-- --all` to roll back everything    |
| `npm run db:seed`                                             | Run seeds. Development sample data only when `NODE_ENV=development` |
| `npm run db:make-migration -w @agent-dashboard/api -- <name>` | Create a migration from the stub                                    |
| `npm run lint`                                                | ESLint with type-aware rules                                        |
| `npm run format` / `format:check`                             | Prettier                                                            |
| `npm run typecheck`                                           | `tsc --noEmit` in every workspace                                   |
| `npm test`                                                    | All unit and integration tests                                      |
| `npm run build`                                               | Build every workspace                                               |

## Testing

- Unit tests live next to the code as `*.test.ts` and need nothing running.
- Integration tests are named `*.integration.test.ts` and run against the
  `agent_dashboard_test` database using `TEST_DATABASE_URL` and
  `TEST_MIGRATION_DATABASE_URL`. They reset that database, so never point
  those variables at the dev database.

```sh
npm run test:unit -w @agent-dashboard/api
npm run test:integration -w @agent-dashboard/api
```

## Database roles

The API never connects as the role that owns the schema:

| Role                    | Used by                                      | Can do                                                       |
| ----------------------- | -------------------------------------------- | ------------------------------------------------------------ |
| `agent_dashboard_owner` | migrations, seeds (`MIGRATION_DATABASE_URL`) | owns every table                                             |
| `agent_dashboard_app`   | the API (`DATABASE_URL`)                     | only the per-table grants in migrations; no DDL, no TRUNCATE |

`skill_versions`, `run_events` and `audit_log` are immutable, enforced by
database triggers that the app role cannot disable. See D-005 and D-009 in
[docs/decisions.md](docs/decisions.md).

## Security notes

- Every secret lives in `.env` or in CI secrets, never in code. CI runs
  gitleaks over the full history.
- The Postgres port is bound to localhost only.
- Sandboxed agent runs will authenticate with API keys injected at launch,
  never with host CLI logins (`~/.claude`, `~/.codex`). See D-010.

## Troubleshooting

- **Changed the init script or the role passwords?** The init script only
  runs on an empty data volume. To recreate the volume (this deletes local
  data): `docker compose down -v && docker compose up -d --wait`.
- **Port 5434 in use?** Set `POSTGRES_HOST_PORT` in `.env` and update the
  ports in the four database URLs to match.
