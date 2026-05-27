# QuantDesk Lint And Architecture Rules

## Purpose

QuantDesk now treats lint as an architecture boundary, not just a formatting pass. The local `eslint-plugin-quantdesk` package and the unique-export guard are expected to run during normal development through the existing root commands.

## Commands

- `pnpm lint`: builds the local lint plugin, runs ESLint, and checks exported top-level symbol uniqueness.
- `pnpm typecheck`: enforces `erasableSyntaxOnly` and `verbatimModuleSyntax` across all TypeScript packages.
- `pnpm test`: runs the Vitest unit suite.
- `pnpm build`: builds all workspace packages.

## Rules

### `quantdesk/no-silent-catch`

- Do not use `catch {}`.
- Do not use `.catch(() => undefined)` or other silent promise handlers.
- If an error is intentionally suppressed, route it through explicit logging or a named suppression helper that consumes the error parameter.

### `quantdesk/no-direct-sql-outside-repos`

- Direct SQL is limited to `packages/main/src/db/**`.
- IPC, service, and orchestration code must call a repository or DB helper instead of `prepare(...)` or `exec(...)` directly.

### `quantdesk/no-runtime-dynamic-import`

- Runtime `import()` is forbidden in product source.
- Toolchain config files are the only long-term exception and must stay in the policy manifest.
- Type-level `import(...)` and `typeof import(...)` remain allowed.

### `quantdesk/no-raw-interactive-elements`

- Renderer routes and ordinary components must use shared primitives instead of raw `button`, `input`, `select`, or `textarea` elements.
- Long-term raw DOM exceptions are limited to the primitive files themselves: `button.tsx`, `input.tsx`, `select.tsx`, `textarea.tsx`, and `checkbox.tsx`.

### `quantdesk/no-renderer-dev-imports`

- Renderer routes, stores, and components must not import from `packages/renderer/src/dev`.
- Bootstrap and transport helpers stay in `dev/`; feature code should go through the typed preload `window.api` boundary.
- Keep this policy in the local plugin so path aliases and re-exports are checked the same way as relative imports.

## Unique Export Guard

- Exported top-level symbols must be globally unique across `packages/**/*.{ts,tsx}`.
- If a new shared helper or component name collides with an existing export, rename it before landing the change.

## Exceptions

- Add exceptions only through the manifests in `packages/eslint-plugin-quantdesk/src/policy/*`.
- Do not add ad hoc `eslint-disable` comments for architecture rules.
- If a new primitive or toolchain file genuinely needs an exception, document the reason in the manifest entry.

## Renderer Primitive Guidance

- Extend the shared primitives before adding new page-level controls.
- Preserve existing behavior and test IDs when migrating raw controls to primitives.
- If a new interaction pattern needs a reusable wrapper, add it to `packages/renderer/src/components` and keep raw interactive DOM inside the primitive layer.

## Runtime Dependency Guidance

- Production IPC registration requires explicit runtime ports. Do not pass partial market-data or Pi runtime objects into `registerIpcHandlers`.
- Sidecar status has one source of truth: `SidecarRuntime.snapshot()`. Avoid falling back to `SidecarManager.getStatus()` from IPC code.
- Code that needs sidecar JSON-RPC should depend on the `SidecarRpc` port and call `rpc.call(...)` directly; do not reintroduce runtime gateway unions or wrapper helpers.
- Construct market-data subservices at the composition root (`createMarketDataServices` / `createMarketDataRuntimeGroup`) and pass the resulting services into `MarketDataOrchestrator`.

## Preferences Guidance

- Main-process preference keys live in `packages/main/src/preferences/preference-keys.ts`.
- Prefer `createPreferencesService(...)` for typed preference reads and PI risk-gate state; avoid scattering raw key strings through runtime code.

## Error Handling Guidance

- Suppressing an error must still leave a visible policy decision in code.
- Preferred order: recover explicitly, log with context, or call a named suppression helper.
- Anonymous swallowing is not allowed.