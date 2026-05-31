# Allocation Engine

Allocation strategy registry and pure portfolio computation core, shared by Strategy Eval and QuantDesk Desktop.

## Public API

Entry: [`src/index.ts`](src/index.ts)

- `defaultAllocationStrategyRegistry`
- `resolveStrategyHandler`
- `CANONICAL_STRATEGY_IDS`, `resolveAllocationMode`, `resolveDefaultRebalanceCadence`
- `buildAllocationAnalysisInput`, `PreparedAllocationData`, `optimizeWeights`
- Handler contracts: `StrategyExecutionContext`, `AllocationStrategyHandler`, ...

## Dependencies

- **Types**: `@quantdesk/shared` (resolved via QuantDesk `tsconfig.base.json` path alias)
- **Runtime**: `ml-matrix` (symlinked from QuantDesk main package)

First-time setup:

```sh
make -C tools/strategy/allocation-engine setup
```

## Verification

```sh
make -C tools/strategy/allocation-engine test
make -C tools/strategy/eval eval.test
```

## Workflow

1. Add or change strategy handlers in `src/strategy-registry.ts` and related modules here.
2. Run Strategy Eval configs under `tools/strategy/eval/config/` to research.
3. QuantDesk Desktop consumes the same registry through thin re-exports in `packages/main/src/portfolio/`.
