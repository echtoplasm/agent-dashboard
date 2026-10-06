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
