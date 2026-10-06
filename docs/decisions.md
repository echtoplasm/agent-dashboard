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
