# Active Dual Momentum Eval

This directory now forwards to the unified Strategy Eval harness.

Preferred entry:

```sh
python3 tools/strategy/eval/run_strategy_eval.py --config tools/strategy/eval/config/adm-eval-run.json --dry-run --limit 1
```

The preset config uses conflict-group basket sampling, ADM strategy mix, and ADM scoring profile. Strategy execution is injected through QuantDesk `defaultAllocationStrategyRegistry`.

Legacy command:

```sh
python3 eval/run_eval.py --dry-run --limit 1
```

Outputs are written under `thoughts/shared/research/active-dual-momentum-eval/<date>/<run-id>/` when using the ADM preset output root.
