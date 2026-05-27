# Desktop Context

This context covers local-first graphical finance workspaces under `tools/desktop/`.

## Language

**Desktop Tool**:
A local-first graphical finance workspace for asset pool management, portfolio analysis, and agent-assisted investment research.
_Avoid_: Agent Skill, CLI-only tool, market data provider

**Desktop Workspace**:
The isolated workspace that owns the **Desktop Tool** user experience, local app workflow, and desktop-specific user records.
_Avoid_: Repository root workspace, shared Data Access Interface, external data store

## Relationships

- A **Desktop Tool** may consume the **Data Access Interface** for **External Data**.
- A **Desktop Tool** may own **User Workspace Data** created through graphical workflows.
- A **Desktop Tool** does not own **External Data** or **Provider Routing**.
- A **Desktop Tool** reads search results, price series, FX rates, and external data status through the **Data Access Interface**.
- A **Desktop Tool** may present **Provider Configuration** diagnostics, but it does not own provider credentials or provider routing policy.
- A **Desktop Tool** may host an agent conversation experience, while production analysis capabilities remain owned by Agent Skills and shared tools.
- A **Desktop Workspace** keeps desktop-specific build, package, and runtime boundaries separate from the repository root.
