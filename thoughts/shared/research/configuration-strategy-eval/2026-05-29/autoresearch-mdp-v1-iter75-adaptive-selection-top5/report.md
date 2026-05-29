# Configuration Strategy Eval

- Data source: quant-data-cli
- Universe: A, BOND (21 candidates)
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
| max_diversification_research_v1 | 67.8517 | 62.4559 | 67.3215 | 74.3078 | 68.0063 | 540 | 0 |

Final score formula: `0.5 * p50Score + 0.25 * p10Score + 0.25 * p90Score`.
Single-case score formula: expected return 20%, Sharpe 40%, max drawdown 24%, volatility 16%.
