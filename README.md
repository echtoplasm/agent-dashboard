# Agent Dashboard

A self-hosted web dashboard for launching, monitoring, and governing AI coding
agents (Claude Code and OpenAI Codex CLI), built to run in a homelab.

> **Status:** Phase 2 (registry) is complete. You can sign in, manage users,
> agents, skills and immutable skill versions, assign skills to agents
> within their sandbox profile's limits, and review the audit log. Running
> agents comes in Phase 3.

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

5. **Create the first admin.** There are no default credentials. You'll be
   asked for a password (at least 12 characters).

   ```sh
   npm run users:create-admin -- --username alice
   ```

6. **Run the API and web app** in two terminals, then open
   http://127.0.0.1:5173 and sign in.

   ```sh
   npm run dev:api   # http://127.0.0.1:3000/api/health
   npm run dev:web   # http://127.0.0.1:5173
   ```

   Open the app at the address Vite prints. State-changing requests are
   only accepted from the origins in `APP_ORIGINS`, which defaults to
   `http://127.0.0.1:5173` and `http://localhost:5173` in development.

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
| `npm run users:create-admin -- --username <name>`             | Create an admin (add `--password-stdin` to pipe the password in)    |
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

## Roles and permissions

| Action                                       | viewer | operator | admin |
| -------------------------------------------- | :----: | :------: | :---: |
| View agents, skills, profiles, providers     |   ✓    |    ✓     |   ✓   |
| Read the audit log                           |        |    ✓     |   ✓   |
| Manage agents, skills, versions, assignments |        |    ✓     |   ✓   |
| Manage users, providers, sandbox profiles    |        |          |   ✓   |

A skill can only be assigned to an agent if it supports the agent's provider
and its permissions manifest fits within the agent's sandbox profile. The
same rules are re-checked whenever an agent, profile or skill changes (D-021).

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

- Sessions are server-side; the browser holds only a random token in an
  HttpOnly, SameSite=Strict cookie, and only its hash is stored (D-017).
- State-changing requests must come from an allowed origin and use JSON
  (D-018). Login and the whole API are rate limited per IP (D-019).
- Every change is written to the append-only audit log in the same
  transaction as the change itself (D-015).
- Published skill files are read-only on disk and hash-verified on every
  read (D-020).
- Every secret lives in `.env` or in CI secrets, never in code. CI runs
  gitleaks over the full history.
- The Postgres port is bound to localhost only.
- Sandboxed agent runs will authenticate with API keys injected at launch,
  never with host CLI logins (`~/.claude`, `~/.codex`). See D-010.

## Configuration

All settings are environment variables, validated at startup (see
`.env.example`). Besides the database URLs:

| Variable            | Default                          | Purpose                                             |
| ------------------- | -------------------------------- | --------------------------------------------------- |
| `APP_ORIGINS`       | Vite dev origins (required prod) | Origins allowed to make state-changing requests     |
| `TRUST_PROXY_HOPS`  | `0`                              | Reverse proxies in front of the API, for client IPs |
| `SKILL_STORAGE_DIR` | `<repo>/data/skills`             | Where published skill files are stored              |
| `API_PORT`          | `3000`                           | API port                                            |
| `LOG_LEVEL`         | `info`                           | pino log level                                      |

## Troubleshooting

- **Changed the init script or the role passwords?** The init script only
  runs on an empty data volume. To recreate the volume (this deletes local
  data): `docker compose down -v && docker compose up -d --wait`.
- **Port 5434 in use?** Set `POSTGRES_HOST_PORT` in `.env` and update the
  ports in the four database URLs to match.
