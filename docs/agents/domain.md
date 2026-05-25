# Domain Docs

This repository uses a multi-context layout for domain documentation.

## Layout

| Context | Path | Description |
|---------|------|-------------|
| quant-data | `tools/data/quant-data/CONTEXT.md` | Go CLI data acquisition |
| strategy | `tools/strategy/CONTEXT.md` | Reusable strategy tools |
| jobs | `tools/jobs/CONTEXT.md` | Scheduled/batch wrappers |

## Context Map

See `CONTEXT-MAP.md` at the repository root for the authoritative context map.

## Consumer Rules

Skills reading domain language follow this order:

1. Look for `CONTEXT-MAP.md` at the repository root
2. If found, follow the context paths listed above
3. If a specific context's `CONTEXT.md` is missing, skip that context
4. If `CONTEXT-MAP.md` is not found, fall back to root `CONTEXT.md` (single-context mode)

## Adding Domain Terms

1. Identify which context the term belongs to
2. Add the term to that context's `CONTEXT.md`
3. For cross-cutting terms, add them to all relevant contexts
4. Update `CONTEXT-MAP.md` if creating a new context
