# Design Decisions

A running log of significant design decisions and the reasoning behind them.
Newest entries go at the bottom of each phase section. When a decision is
reversed, add a new entry that references the old one rather than editing it.

## Phase 1: Foundation

### D-001: TypeScript 6.0, not 7.0

TypeScript 7 (the native port) is the current `latest` release, but
`typescript-eslint` only supports `<6.1`. We pin `~6.0` so type-aware linting
works, and will move to 7 once `typescript-eslint` supports it.

### D-002: ES modules, `as const` objects instead of `enum`

Every package is `"type": "module"` and compiles with `erasableSyntaxOnly`.
That rules out TypeScript `enum`, so fixed value sets are `as const` arrays or
objects in `packages/shared`. Zod schemas build directly on them
(`z.enum(RUN_STATUSES)`), so the type, the runtime validator and the list of
allowed values come from one definition.

### D-003: Shared package resolved from source via a `source` export condition

`@agent-dashboard/shared` exports `./src/index.ts` under a custom `source`
condition and `./dist` otherwise. TypeScript (`customConditions`), Vite, Vitest
and `tsx` all opt into `source`, so development and tests never need a build
step for the shared package. Production builds use the compiled `dist` output.

### D-004: Permissions manifests are strict, versioned and default-deny

`SkillPermissionsManifestSchema` rejects unknown keys and fills every omitted
section with the most restrictive value. A typo like `allowedHost` fails
validation instead of silently granting nothing (or, worse, being read by a
future enforcement layer). `manifestVersion` lets the format evolve without
guessing which shape a stored manifest uses.

### D-005: Separate owner and app database roles

Postgres has two application roles, created by
`infra/postgres/init/01-create-roles-and-databases.sh`:

- `agent_dashboard_owner` owns the databases and the `public` schema and runs
  migrations and seeds (`MIGRATION_DATABASE_URL`).
- `agent_dashboard_app` is what the API connects as (`DATABASE_URL`). It can
  use the schema but not create objects in it, and it only holds the table
  privileges each migration grants explicitly.

Only a table's owner can `ALTER TABLE ... DISABLE TRIGGER`, and `TRUNCATE`
skips row-level triggers, so the app role is never the owner and never gets
`TRUNCATE`. That means a compromised or buggy API cannot bypass the
immutability triggers on `skill_versions` and `audit_log`. Neither role is a
superuser; the superuser password is only used to bootstrap the container.

Grants are explicit per table in migrations rather than via
`ALTER DEFAULT PRIVILEGES`, so each table's access is visible in the migration
that creates it and new tables start with no app access.

The Compose port is bound to `127.0.0.1` so the database is not reachable from
the LAN.

### D-006: Migration CLI wraps Knex's programmatic API

`npm run db:*` calls `apps/api/src/db/db-cli.ts` (run with `tsx`) rather than
the stock `knex` binary. The stock CLI's TypeScript and ESM loading depends on
which loader is installed and on `npm_package_type`. Our wrapper uses the same
validated config and `tsx` loader as the API, and it always connects as the
owner role. `knexfile.ts` still has a default export so the stock CLI can be
used for debugging.

### D-007: int8 columns are parsed as JavaScript numbers

`pg` returns `bigint` (OID 20) as a string to avoid precision loss above
`Number.MAX_SAFE_INTEGER` (about 9 × 10^15). We register a parser that
converts int8 to `number` and throws `UnsafeIntegerError` if a value doesn't
fit, so precision is never lost silently.

This is safe at our scale. Money is stored as integer micro-USD, so the safe
limit is about $9 billion per value. Token counts and `bigserial` ids
(`run_events`, `audit_log`) won't come anywhere near 9 × 10^15 for a homelab.
In exchange, repositories and the API deal in plain numbers instead of strings
or `BigInt`, which also serialize cleanly to JSON. This also covers
`count(*)`, which Postgres returns as int8.

### D-008: Money is stored as integer micro-USD

Costs use `bigint` columns holding millionths of a dollar
(`cost_micro_usd`). Floating-point types can't represent amounts like $0.1
exactly, and `numeric` would come back from `pg` as a string. Provider prices
per token are quoted at fractions of a cent, so micro-dollar resolution keeps
per-event costs exact enough to sum.

### D-009: Schema conventions

- **Ids** are `uuid` defaulting to Postgres 18's built-in `uuidv7()`. The ids
  are ordered by creation time, which keeps B-tree inserts cheap and makes ids
  roughly sortable. Log tables (`run_events`, `audit_log`) use
  `bigint GENERATED ALWAYS AS IDENTITY` instead, which needs no separate
  sequence grant for the app role.
- **Fixed value sets** (run status, user role) are `text` columns with
  `CHECK ... IN (...)` constraints rather than native Postgres enums, which
  are awkward to change in migrations. Each migration writes out its own copy
  of the values so it keeps meaning the same thing if `packages/shared`
  changes. An integration test fails if the database values and the shared
  lists drift apart. Provider slugs only have a format check, so adding a
  provider needs no schema change.
- **Soft deletes**: agents, skills and sandbox profiles have `archived_at`
  and are never deleted, because runs and assignments reference them. Their
  names and slugs are unique only among active rows (partial unique indexes
  `WHERE archived_at IS NULL`), so a name can be reused after archiving.
- **Immutability**: `skill_versions`, `run_events` and `audit_log` have
  `reject_modification()` triggers for UPDATE and TRUNCATE, and also for
  DELETE on `audit_log`. These fire for every role. The app role also lacks
  the grants for those operations (D-005).
- **An agent can hold at most one version of each skill.**
  `agent_skill_assignments` stores `skill_id` next to `skill_version_id`
  with a two-column foreign key to `skill_versions (id, skill_id)`, so the
  uniqueness rule cannot be undermined by a mismatched pair.
- **Sandbox profiles mirror the permissions manifest**:
  `is_network_allowed`, `allowed_network_hosts`, `writable_paths` and
  `allowed_commands` line up with the manifest's sections, so checking that a
  skill's manifest fits within a profile is a field-by-field comparison.
- **Migration helpers are frozen.** Migrations that already ran import
  `migration-helpers.ts`, so a helper's behaviour must never change. Add a
  new helper instead.
- **Avoid `?` in SQL passed through Knex**, including regexes in CHECK
  constraints, because Knex treats it as a placeholder. Write `{0,1}` instead.

### D-010: Sandboxes never use host CLI credentials

Sandboxed runs authenticate with provider API keys injected into the
container at launch from secret configuration. They never read
`~/.claude`, `~/.codex` or any other credential store on the API host, even
though the developer's CLIs are logged in there for local testing. Adapters
will point each CLI at an isolated config home inside the sandbox (for
example `CODEX_HOME`) so a host login cannot be picked up by accident. Keys
are never stored in Postgres and are removed from run events before they are
logged.

### D-011: Seeds insert only what is missing

Base seeds (providers, the `locked-down` sandbox profile) run in every
environment. Development seeds (a sample skill and agent) run only when
`NODE_ENV=development`. Every seed skips rows that already exist rather than
overwriting them, so re-seeding never undoes an admin's changes.
`sortDirsSeparately` keeps base seeds running before development seeds.

### D-012: Dependency injection through factory functions

Modules expose `create*` factory functions (`createHealthRepository`,
`createHealthService`, `createHealthRouter`) that take their dependencies as
arguments, and `createApp` wires them together. No module reads globals or
opens its own connection, so tests can substitute stubs or a test database
without any mocking library. `server.ts` is the only file that reads
`process.env` and opens real connections.

### D-013: The health endpoint is the only unauthenticated route

`GET /api/health` returns 200 or 503 and reports only up/down per
dependency. Errors are logged on the server but never included in the
response, since anyone who can reach the API can call this route.

### D-014: CI pipeline

GitHub Actions runs three independent jobs on every push and pull request:

- **checks**: lint, Prettier check, typecheck, unit and integration tests
  against a Postgres 18 service container (bootstrapped with the same init
  script as Docker Compose, so CI exercises the owner/app role split), and a
  build.
- **dependency-audit**: `npm audit --audit-level=high`.
- **secret-scan**: gitleaks over the full git history. The repository is
  public, so a leaked secret is exposed immediately. It runs a pinned
  gitleaks release binary, verified against its SHA-256 checksum, rather than
  `gitleaks-action`. The action only scans the pushed commit range, and it
  failed on this repository's first push. Dependabot doesn't track the binary
  pin, so bump `GITLEAKS_VERSION` and `GITLEAKS_SHA256` by hand.

Third-party actions are pinned to full commit SHAs, with the version in a
comment, because tags can be moved to point at different code. Dependabot
opens weekly PRs for both npm packages and action pins. The workflow token
is limited to `contents: read`, and checkout does not persist credentials.

## Phase 2: Registry, auth and audit

### D-015: Services reach the database only through `DataAccess`

`createDataAccess(database)` gives services two things: `repositories`
for reads, and `runInTransaction(work)`, which hands `work` a fresh set of
repositories bound to one transaction. Services never import Knex.
Every state change and its audit entry are written in the same transaction,
so an audit entry can never describe a change that was rolled back, and no
change can commit without its audit entry.

Repositories accept either the pool or a transaction (`DatabaseExecutor`)
and return API-shaped camelCase objects with ISO timestamp strings. Unique
violations are turned into `ConflictError` inside the repository, so services
never inspect Postgres error codes.

### D-016: Passwords hashed with Node's built-in scrypt

Passwords use `crypto.scrypt` (N=2^15, r=8, p=1, about 32 MiB per hash)
rather than the `argon2` package. scrypt is also memory-hard, needs no native
build step, and adds no dependency. Hashes are stored as
`scrypt$N$r$p$salt$hash`, so the cost can be raised later and old hashes
still verify. Login for an unknown username runs a verification against a
throwaway hash, so response time doesn't reveal which usernames exist.

The first admin is created with `npm run users:create-admin`. No default
credentials are ever seeded. The command runs as the app role and its
`user.created` audit entry has no actor.
