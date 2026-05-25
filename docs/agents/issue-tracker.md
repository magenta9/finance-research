# Issue Tracker

Issues are tracked as markdown files under `.scratch/` in this repository.

## Format

```
.scratch/
  <feature-name>/
    0001-feature-name.md
    0002-another-issue.md
```

## Frontmatter

Each issue file should include YAML frontmatter:

```yaml
---
title: Issue title
status: needs-triage
created: 2026-05-25
---
```

## Workflow

1. Create a new `.scratch/<feature>/<number>-<slug>.md` file
2. Set the initial `status` to `needs-triage`
3. Use the triage labels in `docs/agents/triage-labels.md`
4. Move files between folders to change status
