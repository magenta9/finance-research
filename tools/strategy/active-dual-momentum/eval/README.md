# Active Dual Momentum Eval

This directory contains a repeatable evaluation harness for QuantDesk Active Dual Momentum experiments.

All market data reads go through the user-installed `quant-data` CLI. The eval harness does not open `quant-data` or QuantDesk SQLite stores directly.

The first phase builds a fixed baseline eval set:

- basket sizes: 5, 10, 20 assets
- windows: 1, 2, 3, 5 years
- samples per size/window: 50
- sampling: random draw, then reject baskets that violate conflict groups
- score: Sharpe 50%, max drawdown 30%, volatility 20%

Run a smoke check from `tools/strategy/active-dual-momentum`:

```sh
python3 eval/run_eval.py --dry-run --limit 1
```

Run the baseline:

```sh
python3 eval/run_eval.py --sizes 5,10,20 --windows 1,2,3,5 --samples-per-size 50 --seed 20260528
```

Outputs are written under `thoughts/shared/research/active-dual-momentum-eval/<date>/<run-id>/`.