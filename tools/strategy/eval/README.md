# Strategy Eval Framework

Unified offline evaluation for QuantDesk allocation strategies. Strategy execution is injected through QuantDesk `defaultAllocationStrategyRegistry`; the eval harness only orchestrates cases, price loading, scoring, and reporting.

## Entry point

```sh
python3 tools/strategy/eval/run_strategy_eval.py --dry-run --limit 1 --strategy erc
```

Live smoke:

```sh
python3 tools/strategy/eval/run_strategy_eval.py --samples-per-cell 1 --limit 1 --run-id smoke --strategy erc
```

ADM preset:

```sh
python3 tools/strategy/eval/run_strategy_eval.py --config tools/strategy/eval/config/adm-eval-run.json --dry-run --limit 1
```

## Architecture

- Python: [run_strategy_eval.py](run_strategy_eval.py) builds `EvalRunRequest`, loads `quant-data` prices, scores rows, writes artifacts.
- TypeScript: [generic_eval_runner.ts](generic_eval_runner.ts) dispatches each case/strategy pair through QuantDesk `AllocationStrategyHandler`.
- Contracts: [eval_runner_contract.ts](eval_runner_contract.ts), [eval_core/contract.py](../eval_core/contract.py).
- Shared modules: [eval_core/](../eval_core/).

**扩展新策略或新打分指标**：见 [EXTENDING.md](EXTENDING.md)。

## Output

`<output-root>/<YYYY-MM-DD>/<run-id>/`

- `cases.json`
- `eval-plan.json`
- `results.json`
- `results.tsv`
- `score-summary.json`
- `report.md`

## Deprecated entry points

- `run_configuration_eval.py` forwards to `run_strategy_eval.py`.
- `tools/strategy/active-dual-momentum/eval/run_eval.py` forwards to `run_strategy_eval.py --config config/adm-eval-run.json`.
- Legacy TS runners `configuration_eval_runner.ts` and `adm_eval_runner.ts` are superseded by `generic_eval_runner.ts`.

## Tests

From `tools/strategy/eval`:

```sh
make eval.test
```
