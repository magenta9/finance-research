# Strategy Eval Framework

This directory contains the generic evaluation harness for QuantDesk allocation strategies.

The first runnable scope is Configuration Strategy Eval:

- universe: current Desktop asset snapshot, filtered to A + BOND markets
- strategies: ERC, Inverse Volatility, Max Diversification
- basket sizes: 5, 10, 15, 20 assets
- windows: 2, 3, 5 years
- rebalance cadences: weekly, monthly, quarterly
- samples: 20 unique baskets per size/window/cadence cell
- price data: `quant-data get-price-series`
- single-case score coefficients: expected return 0.30, Sharpe 0.40, max drawdown 0.15, volatility 0.15
- expected return score bounds: 0% to 50% annualized expected return
- final score: `0.5 * p50Score + 0.25 * p10Score + 0.25 * p90Score`

Run a dry-run smoke check from the repository root:

```sh
python3 tools/strategy/eval/run_configuration_eval.py --dry-run --limit 1
```

Run a small live smoke check:

```sh
python3 tools/strategy/eval/run_configuration_eval.py --samples-per-cell 1 --limit 1 --run-id smoke
```

Run the first full baseline:

```sh
python3 tools/strategy/eval/run_configuration_eval.py --samples-per-cell 20 --run-id baseline-a-bond-config-v1
```