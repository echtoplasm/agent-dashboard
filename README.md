# Agent Dashboard

A self-hosted web dashboard for launching, monitoring, and governing AI coding
agents (Claude Code and OpenAI Codex CLI), built to run in a homelab.

> **Status:** Phase 3 (runs) is complete. Operators can launch Claude Code
> and Codex agents in locked-down Docker sandboxes, watch their output live,
> cancel them, download the files they leave behind, and see tokens and
> cost per run and per agent. Budgets, runtime enforcement of skill
> permissions and a Proxmox LXC sandbox come in Phase 4.

## Repository layout

```
apps/api           Express + Knex backend
  knexfile.ts      Migration/seed config (owner role)
  src/adapters/    One adapter per agent CLI (Claude Code, Codex)
  src/cli/         create-admin and skills:import
  src/config/      Environment loading and validation
  src/db/          Knex client, migrations/, seeds/, db-cli.ts
  src/modules/     One folder per domain (routes → service → repository)
  src/sandbox/     Sandbox provider interface and the Docker implementation
  test/            Integration test helpers and the fake sandbox
apps/egress-proxy  CONNECT-only allowlisting proxy for sandbox traffic
apps/web           React + Vite frontend
packages/shared    Zod schemas and types shared by api and web
infra/postgres/    Database bootstrap script (roles and databases)
infra/sandbox/     The sandbox image agents run in
docs/decisions.md  Design decisions and the reasons for them
```

## Requirements

- Node.js 24 (`nvm use` picks it up from `.nvmrc`)
- Docker with Compose v2. The API runs agents by calling the `docker` CLI,
  so the account running the API must be able to use Docker, and must not
  be root.
- `openssl`, for generating local passwords
- An Anthropic and/or OpenAI API key, to run agents

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

3. **Start Postgres and the egress proxy.** On first start, the Postgres
   container creates the `agent_dashboard_owner` and `agent_dashboard_app`
   roles plus the `agent_dashboard` and `agent_dashboard_test` databases. It
   listens on `127.0.0.1:5434` by default (`POSTGRES_HOST_PORT`). Compose
   also builds and starts the egress proxy and creates the internal
   `agent-dashboard-sandbox` network that agent sandboxes join.

   ```sh
   docker compose up -d --wait
   ```

4. **Build the sandbox image** that agent runs execute in. It pins the
   Claude Code and Codex CLI versions the adapters were verified against.

   ```sh
   npm run sandbox:build
   ```

5. **Apply migrations and seeds.**

   ```sh
   npm run db:migrate
   npm run db:seed
   ```

6. **Create the first admin.** There are no default credentials. You'll be
   asked for a password (at least 12 characters).

   ```sh
   npm run users:create-admin -- --username alice
   ```

7. **Add provider API keys** to `.env` (`ANTHROPIC_API_KEY`,
   `OPENAI_API_KEY`). Runs of a provider without a key are refused with a 503. Keys are only ever injected into sandboxes; the API never uses your
   host `claude` or `codex` login.

8. **Run the API and web app** in two terminals, then open
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

| Script                                                           | What it does                                                        |
| ---------------------------------------------------------------- | ------------------------------------------------------------------- |
| `npm run dev:api`                                                | API with auto-reload (`tsx watch`)                                  |
| `npm run dev:web`                                                | Vite dev server, proxying `/api` to the API                         |
| `npm run db:migrate`                                             | Apply pending migrations (as the owner role)                        |
| `npm run db:rollback`                                            | Roll back the last batch. Add `-- --all` to roll back everything    |
| `npm run db:seed`                                                | Run seeds. Development sample data only when `NODE_ENV=development` |
| `npm run db:make-migration -w @agent-dashboard/api -- <name>`    | Create a migration from the stub                                    |
| `npm run users:create-admin -- --username <name>`                | Create an admin (add `--password-stdin` to pipe the password in)    |
| `npm run skills:import -- <folder> --skill <slug> --version <v>` | Publish a skill version from a local folder (see below)             |
| `npm run sandbox:build`                                          | Build the `agent-dashboard/sandbox` image                           |
| `npm run lint`                                                   | ESLint with type-aware rules                                        |
| `npm run format` / `format:check`                                | Prettier                                                            |
| `npm run typecheck`                                              | `tsc --noEmit` in every workspace                                   |
| `npm test`                                                       | All unit and integration tests                                      |
| `npm run build`                                                  | Build every workspace                                               |

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

- Run tests use a scripted fake sandbox, so they need neither Docker nor API
  keys. The Docker sandbox itself has tests against a real daemon that are
  skipped unless `RUN_DOCKER_TESTS=1`; build the image and start the egress
  proxy first:

```sh
RUN_DOCKER_TESTS=1 npm run test:unit -w @agent-dashboard/api -- src/sandbox
```

- Adapter tests replay output recorded from the pinned CLI versions
  (`apps/api/src/adapters/fixtures/`). When you bump a CLI version in
  `infra/sandbox/Dockerfile`, re-record the fixtures.

## Running agents

1. Create an agent (provider, sandbox profile, optional model) and assign
   it skills.
2. On the agent's page, enter a prompt and choose **Launch run**. Launching
   is audited and refused if the provider's key is missing, the loadout no
   longer fits the sandbox profile, a skill's files fail their hash check,
   or `MAX_CONCURRENT_RUNS` runs are already active.
3. The run page streams the agent's output live. Operators can cancel it.
   Runs that exceed the profile's maximum duration are stopped and marked
   timed out.
4. When the run ends, the files it wrote to its workspace are listed for
   download. Each run starts with an empty workspace.

Claude Code reports each run's cost. Codex only reports tokens, so its cost
is estimated from the **Model prices** page, which admins maintain; set a
model on Codex agents so a price can be found.

### Importing skills

A skill folder holds `SKILL.md` plus any scripts or references, and
optionally a `permissions.json` at its root with the permissions manifest
(without one, the skill gets no extra permissions). Create the skill in the
web app, then publish a version from the folder, either with the folder
picker on the skill's page or from the command line:

```sh
npm run skills:import -- ./skills/run-tests --skill run-tests --version 1.1.0 --changelog "Use vitest"
```

Hidden files (`.git/`, `.DS_Store`) and binary files are skipped and listed.
The CLI never follows symlinks.

## Roles and permissions

| Action                                               | viewer | operator | admin |
| ---------------------------------------------------- | :----: | :------: | :---: |
| View agents, skills, profiles, providers, runs       |   ✓    |    ✓     |   ✓   |
| Read the audit log                                   |        |    ✓     |   ✓   |
| Manage agents, skills, versions, assignments         |        |    ✓     |   ✓   |
| Launch and cancel runs                               |        |    ✓     |   ✓   |
| Manage users, providers, sandbox profiles, prices    |        |          |   ✓   |
| Delete agents that never ran, skills never published |        |          |   ✓   |

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
- Agent runs authenticate with API keys injected at launch, never with host
  CLI logins (`~/.claude`, `~/.codex`). Keys are passed to Docker by name
  only, so they never appear in a process list (D-010, D-022).
- Each run's container is non-root with a read-only root filesystem, no
  capabilities, CPU, memory and process limits, and only its workspace and
  a temporary HOME writable. Skills are mounted read-only (D-022).
- Sandboxes have no route out except the egress proxy, which allows only
  HTTPS to the provider API hosts (D-023).
- The agent CLIs' own permission prompts are off; the container is the
  security boundary (D-024).
- Agent output is redacted of the injected keys and common credential
  formats before it is stored or streamed (D-028).
- Workspace downloads never follow symlinks and are always served as
  attachments (D-022).
- The API's account can control Docker, which is equivalent to root on the
  host. Run the API on a host dedicated to it.

## Configuration

All settings are environment variables, validated at startup (see
`.env.example`). Besides the database URLs:

| Variable                   | Default                            | Purpose                                             |
| -------------------------- | ---------------------------------- | --------------------------------------------------- |
| `APP_ORIGINS`              | Vite dev origins (required prod)   | Origins allowed to make state-changing requests     |
| `TRUST_PROXY_HOPS`         | `0`                                | Reverse proxies in front of the API, for client IPs |
| `SKILL_STORAGE_DIR`        | `<repo>/data/skills`               | Where published skill files are stored              |
| `API_PORT`                 | `3000`                             | API port                                            |
| `LOG_LEVEL`                | `info`                             | pino log level                                      |
| `ANTHROPIC_API_KEY`        | unset                              | Injected into Claude Code sandboxes                 |
| `OPENAI_API_KEY`           | unset                              | Injected into Codex sandboxes                       |
| `MAX_CONCURRENT_RUNS`      | `2`                                | Most runs active at once; more are refused with 429 |
| `RUN_DATA_DIR`             | `<repo>/data/runs`                 | Run workspaces (kept) and temporary HOMEs (deleted) |
| `SANDBOX_NETWORK`          | `agent-dashboard-sandbox`          | Internal Docker network sandboxes join              |
| `SANDBOX_EGRESS_PROXY_URL` | `http://egress-proxy:3128`         | The egress proxy, as seen from that network         |
| `DOCKER_COMMAND`           | `docker`                           | Docker CLI binary                                   |
| `EGRESS_ALLOWED_HOSTS`     | `api.anthropic.com,api.openai.com` | Read by Compose: hosts the egress proxy allows      |

## Troubleshooting

- **Changed the init script or the role passwords?** The init script only
  runs on an empty data volume. To recreate the volume (this deletes local
  data): `docker compose down -v && docker compose up -d --wait`.
- **Port 5434 in use?** Set `POSTGRES_HOST_PORT` in `.env` and update the
  ports in the four database URLs to match.
- **Runs fail with "The sandbox could not start the agent"?** The message
  includes Docker's error. Usually the image isn't built
  (`npm run sandbox:build`) or the sandbox network doesn't exist
  (`docker compose up -d egress-proxy`).
- **Runs fail with network errors?** Check that the egress proxy is running
  (`docker compose logs egress-proxy`); it logs every allowed and refused
  tunnel.
- **The API was killed mid-run?** On its next start it marks those runs
  failed and removes their containers.
