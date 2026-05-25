# Context Map

This repository uses a multi-context layout for domain documentation.

| Context | Path | Description |
|---------|------|-------------|
| quant-data | `tools/data/quant-data/CONTEXT.md` | Go CLI data acquisition tool |
| strategy | `tools/strategy/CONTEXT.md` | Reusable strategy implementations |
| jobs | `tools/jobs/CONTEXT.md` | Scheduled and batch wrappers |

## Consumer Rules

Skills reading domain language follow this order:

1. Look for `CONTEXT-MAP.md` at the repository root
2. If found, follow the context paths listed above
3. If a specific context's `CONTEXT.md` is missing, skip that context
4. If `CONTEXT-MAP.md` is not found, fall back to root `CONTEXT.md` (single-context mode)

## Adding a New Context

1. Create a directory under `tools/` (e.g., `tools/new-context/`)
2. Create `CONTEXT.md` with that context's domain language
3. Create `docs/adr/` for architectural decisions specific to that context
4. Update this map with the new context entry
