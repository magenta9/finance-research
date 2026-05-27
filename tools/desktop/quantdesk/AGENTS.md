# AGENTS.md

## Package manager
- Use `pnpm` for all install, script, and workspace commands in this project.
- Do not use `npm` or `yarn` here.

## Lint architecture
- Architecture rules and exception policy live in `docs/lint-architecture-rules.md`.
- Keep exceptions in `packages/eslint-plugin-quantdesk/src/policy/*`; do not add ad hoc `eslint-disable` for structure rules.
- Use the shared renderer primitives before introducing new raw interactive DOM in routes or ordinary components.
