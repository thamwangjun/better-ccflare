# Coding Conventions

**Analysis Date:** 2026-05-04

## Naming Patterns

**Files:**
- Source files: `kebab-case.ts` — e.g., `proxy-operations.ts`, `response-processor.ts`, `cache-body-store.ts`
- Repository files: `kebab-case.repository.ts` — e.g., `account.repository.ts`, `stats.repository.ts`
- Test files: `kebab-case.test.ts` — co-located with source or inside `__tests__/` subdirectory
- Worker files: `kebab-case.worker.ts` — e.g., `post-processor.worker.ts`, `vacuum-worker.ts`

**Functions:**
- All functions use `camelCase` — e.g., `levenshteinDistance`, `proxyWithAccount`, `parseRateLimit`
- Async functions are prefixed/suffixed by role, not by `async` — e.g., `fetchNanoGPTPricingData`, `handleProxyError`
- Factory functions use `make` prefix in test files — e.g., `makeAccount()`, `makeProxyContext()`, `makeRequestMeta()`

**Variables:**
- `camelCase` for all local variables and parameters
- `SCREAMING_SNAKE_CASE` for module-level constants — e.g., `ERROR_MESSAGES`, `TEST_DB_PATH`
- DB column names remain `snake_case` (matching SQLite schema) — e.g., `rate_limited_until`, `session_start`

**Types:**
- Interfaces: `PascalCase` — e.g., `UsageWindowData`, `AccountResponse`, `ProxyContext`
- Type aliases: `PascalCase` — e.g., `FullUsageData`, `LogFormat`
- Enums: `PascalCase` name, `SCREAMING_SNAKE_CASE` members — e.g., `LogLevel.DEBUG`, `LogLevel.INFO`
- Classes: `PascalCase` — e.g., `DatabaseOperations`, `BunSqlAdapter`, `AccountRepository`
- Error classes: `PascalCase` suffixed with `Error` — e.g., `AuthError`, `ProviderError`, `RateLimitError`

## Code Style

**Formatter:** Biome 2.4.10 (`biome.json`)

**Key settings:**
- Indent style: **tabs** (not spaces)
- Quote style: **double quotes** for JavaScript/TypeScript strings
- Scope: `apps/**` and `packages/**` only
- CSS modules: disabled; Tailwind directives: enabled

**Linter:** Biome with `recommended` rule set enabled. Run with:
```bash
bunx --bun biome check --write --unsafe .
```

**Format command:**
```bash
bunx biome format --write .
```

**After any code change, always run all three:**
```bash
bun run lint && bun run typecheck && bun run format
```

## TypeScript Configuration

**Strictness:** Full `strict: true` (all strict checks enabled)

**Key settings from `tsconfig.json`:**
- `target: "esnext"`, `module: "esnext"`, `moduleResolution: "bundler"`
- `noEmit: true` — compilation is type-checking only; Bun handles execution
- `allowImportingTsExtensions: true` — `.ts` extensions allowed in import paths
- `forceConsistentCasingInFileNames: true`
- `resolveJsonModule: true`
- `types: ["bun-types"]` — Bun runtime types used globally
- `jsx: "react-jsx"` — React JSX transform used for dashboard

**Test files excluded from typecheck** — `**/__tests__` and `**/*.test.ts` are in `tsconfig.json` `exclude`.

## Import Organization

**Order (enforced by Biome `organizeImports: "on"`):**
1. Node built-ins with `node:` prefix — e.g., `import crypto from "node:crypto"`, `import { join } from "node:path"`
2. Workspace packages via `@better-ccflare/*` aliases — e.g., `import { Logger } from "@better-ccflare/logger"`
3. Local relative imports — e.g., `import { ERROR_MESSAGES } from "./proxy-types"`

**Path Aliases (from `tsconfig.json`):**
- `@better-ccflare/*` → `./packages/*/src` — use for all cross-package imports; never use relative `../../` across package boundaries
- `@better-ccflare/server` → `./apps/server/src/server.ts`
- `@better-ccflare/dashboard-web/dist/*` → `./packages/dashboard-web/dist/*`

**Barrel Files:**
- Every package exposes a `src/index.ts` that re-exports its public API surface
- Internal modules use named exports (not `export default`)
- Barrel files use both `export { ... } from "./module"` (selective) and `export * from "./module"` (full re-export)

**Type-only imports:**
- Use `import type { ... }` for pure type imports — enforced by convention across the codebase
  ```typescript
  import type { Account, RequestMeta } from "@better-ccflare/types";
  import type { DatabaseOperations } from "@better-ccflare/database";
  ```

## Error Handling

**Custom error hierarchy (`packages/core/src/errors.ts`):**
- `AppError` (abstract base) → extends `Error`, carries `code`, `statusCode`, `context`, `timestamp`
- Domain subclasses: `AuthError` (401), `TokenRefreshError`, `RateLimitError`, `ValidationError`, `ProviderError`, `OAuthError`
- Use typed error classes instead of raw `new Error()` wherever possible

**Patterns:**
- Catch errors and re-throw as domain errors:
  ```typescript
  } catch (error) {
      logError(error, log);
      throw new ProviderError("message", { context });
  }
  ```
- Silent catch (`} catch { }`) is used when a fallback path handles the failure — avoid for errors that should propagate
- Error serialization via `.toJSON()` on `AppError` for HTTP responses
- `logError(error, log)` utility used for standardized error logging before re-throwing

## Logging

**Framework:** Custom `Logger` class from `@better-ccflare/logger`

**Instantiation pattern (per module):**
```typescript
import { Logger } from "@better-ccflare/logger";
const log = new Logger("ModuleName");
```

**Levels:** `DEBUG`, `INFO`, `WARN`, `ERROR` (via `LogLevel` enum)

**Behavior:**
- Console output is silenced unless `BETTER_CCFLARE_DEBUG` env var is set or level is DEBUG
- Logs are emitted to a `logBus` EventEmitter for SSE streaming to the dashboard
- Do not use `console.log`/`console.error` directly in application code — use the `Logger` class

## Comments

**When to Comment:**
- Module-level JSDoc blocks for public classes and exported functions with non-obvious behavior
- Inline comments for non-obvious logic or intentional workarounds
- Section dividers using `// ─────────────────────` in long test files to separate describe blocks

**JSDoc:**
- Used selectively for exported functions with `@throws`, `@param`, or complex return shapes
- Not applied uniformly — focus on places where a reader would need context

## Function Design

**Size:** Functions can be long when logic is intrinsically complex (e.g., `proxyWithAccount` in `proxy-operations.ts` is 360+ lines). No enforced line limit, but single-responsibility is preferred.

**Parameters:** Prefer option objects for 3+ parameters; use function overloads sparingly.

**Return Values:**
- Async functions return `Promise<T>` — never mix sync/async signatures
- Functions returning result shapes use typed interfaces, not untyped objects

## Module Design

**Exports:**
- All public APIs exported from `src/index.ts` barrel
- Internal helpers stay unexported unless tests or other packages require them
- No `export default` — use named exports exclusively

**Commit Message Conventions (from CLAUDE.md):**
- `feat:` / `add:` / `new:` — new features (triggers changelog "Features" section)
- `fix:` / `bug:` / `resolve:` — bug fixes
- `security:` / `vulnerabilit:` / `redact:` / `ReDoS:` — security changes
- `improve:` / `enhance:` / `update:` / `refactor:` — improvements and refactors
- NEVER bump version in commits — handled by automated release system
- Use `git add <specific-files>` not `git add .` to avoid committing `inline-worker.ts`

---

*Convention analysis: 2026-05-04*
