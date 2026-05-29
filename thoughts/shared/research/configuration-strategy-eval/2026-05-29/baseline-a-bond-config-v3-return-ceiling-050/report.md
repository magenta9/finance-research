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
| max_diversification | 56.7356 | 49.7859 | 57.8134 | 61.5296 | 56.5178 | 540 | 0 |
| erc | 50.4365 | 43.9207 | 51.2251 | 55.3749 | 50.3358 | 540 | 0 |
| inverse_volatility | 43.5639 | 37.544 | 43.5813 | 49.5489 | 43.5487 | 540 | 0 |

Final score formula: `0.5 * p50Score + 0.25 * p10Score + 0.25 * p90Score`.
Single-case score formula: expected return 20%, Sharpe 40%, max drawdown 24%, volatility 16%.
