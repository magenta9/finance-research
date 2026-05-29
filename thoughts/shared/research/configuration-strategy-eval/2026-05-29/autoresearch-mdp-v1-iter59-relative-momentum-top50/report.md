# Configuration Strategy Eval

- Data source: quant-data-cli
- Universe: A, BOND (22 candidates)
- Strategies: max_diversification_research_v1
- Basket sizes: 10, 15, 20
- Windows: 2, 3, 5 years
- Cadences: weekly, monthly, quarterly
- Samples per cell: 20
- Base cases: 540
- Strategy cases: 540
- End date: 2026-05-27
- Seed: 20260528

## Leaderboard

| Strategy | Final | P10 | P50 | P90 | Mean | Success | Failure |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| max_diversification_research_v1 | 63.3915 | 44.539 | 66.3921 | 76.2428 | 63.7949 | 540 | 0 |

Final score formula: `0.5 * p50Score + 0.25 * p10Score + 0.25 * p90Score`.
Single-case score formula: Sharpe 50%, max drawdown 30%, volatility 20%.
