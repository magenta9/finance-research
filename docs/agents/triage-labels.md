# Triage Labels

This repo uses local markdown files with frontmatter for triage state.

## Default Labels

| Label | Description |
|-------|-------------|
| `needs-triage` | Maintainer needs to evaluate |
| `needs-info` | Waiting on reporter |
| `ready-for-agent` | Fully specified, AFK-ready (an agent can pick it up with no human context) |
| `ready-for-human` | Needs human implementation |
| `wontfix` | Will not be actioned |

## Frontmatter

```yaml
---
title: Issue title
status: needs-triage
created: 2026-05-25
---
```

## Status Transitions

```
needs-triage → needs-info (if more info needed)
needs-triage → ready-for-agent (if fully specified)
needs-triage → ready-for-human (if human implementation needed)
needs-triage → wontfix (if won't be actioned)
needs-info → needs-triage (when info provided)
ready-for-agent → (work completed)
ready-for-human → (work completed)
```
