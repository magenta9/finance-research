# Configuration Strategy Eval

- Data source: quant-data-cli
- Universe: A, BOND (22 candidates)
- Strategies: erc, inverse_volatility, max_diversification
- Basket sizes: 10, 15, 20
- Windows: 2, 3, 5 years
- Cadences: weekly, monthly, quarterly
- Samples per cell: 20
- Base cases: 540
- Strategy cases: 1620
- End date: 2026-05-27
- Seed: 20260528

## Leaderboard

| Strategy | Final | P10 | P50 | P90 | Mean | Success | Failure |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| max_diversification | 61.5712 | 53.6278 | 62.8766 | 66.9038 | 61.2992 | 540 | 0 |
| erc | 55.2764 | 47.7036 | 56.1073 | 61.1872 | 55.0231 | 540 | 0 |
| inverse_volatility | 48.0979 | 41.0995 | 48.0827 | 55.1265 | 47.9728 | 540 | 0 |

Final score formula: `0.5 * p50Score + 0.25 * p10Score + 0.25 * p90Score`.
Single-case score formula: expected return 20%, Sharpe 40%, max drawdown 24%, volatility 16%.
