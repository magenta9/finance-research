# Desktop Context

This context covers local-first graphical finance workspaces under `tools/desktop/`.

## Language

**Desktop Tool**:
A local-first graphical finance workspace for asset pool management, portfolio analysis, and agent-assisted investment research.
_Avoid_: Agent Skill, CLI-only tool, market data provider

**Desktop Workspace**:
The isolated workspace that owns the **Desktop Tool** user experience, local app workflow, and desktop-specific user records.
_Avoid_: Repository root workspace, shared Data Access Interface, external data store

**Allocation Strategy**:
A concrete, runnable portfolio construction choice selected before choosing assets, parameters, or calculating results. In the desktop UI, an **Allocation Strategy** is one of the three **Configuration Strategies** or the **EWMAC Trend Following** strategy.
_Avoid_: Allocation mode, strategy mix, sleeve toggle, strategy family

**Allocation Strategy Identity**:
The user-visible identity of the selected **Allocation Strategy** across the desktop workflow, saved plans, exports, and calculation results.
_Avoid_: Optimizer mode, internal sleeve configuration

**Configuration Strategy**:
An **Allocation Strategy** that constructs target portfolio weights from cross-asset risk or diversification characteristics.
_Avoid_: Trend strategy, overlay, signal sleeve

**Trend Strategy**:
An **Allocation Strategy** that constructs target exposure from trend-following signals and is mutually exclusive with **Configuration Strategies** at the top-level strategy choice.
_Avoid_: Configuration strategy add-on, optional trend sleeve, mixed strategy

**EWMAC Trend Following**:
The current concrete **Trend Strategy** available as a top-level **Allocation Strategy**.
_Avoid_: Generic trend strategy, MA trend strategy, momentum strategy

**Strategy Runtime Parameters**:
The parameters required by a specific **Allocation Strategy** after assets are selected. They are determined by the concrete strategy, not by whether the strategy belongs to the **Configuration Strategy** or **Trend Strategy** family.
_Avoid_: Generic configuration-class parameters, generic trend-class parameters

**Strategy Mixing**:
Combining a **Configuration Strategy** with a partial **Trend Strategy** sleeve in one allocation run. **Strategy Mixing** is not part of the desktop allocation workflow.
_Avoid_: Partial trend-following sleeve, configuration-plus-trend overlay

## Relationships

- A **Desktop Tool** may consume the **Data Access Interface** for **External Data**.
- A **Desktop Tool** may own **User Workspace Data** created through graphical workflows.
- A **Desktop Tool** does not own **External Data** or **Provider Routing**.
- A **Desktop Tool** reads search results, price series, FX rates, and external data status through the **Data Access Interface**.
- A **Desktop Tool** may present **Provider Configuration** diagnostics, but it does not own provider credentials or provider routing policy.
- A **Desktop Tool** may host an agent conversation experience, while production analysis capabilities remain owned by Agent Skills and shared tools.
- A **Desktop Workspace** keeps desktop-specific build, package, and runtime boundaries separate from the repository root.
