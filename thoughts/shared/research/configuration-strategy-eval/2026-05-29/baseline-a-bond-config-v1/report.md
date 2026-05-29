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
| max_diversification | 66.7434 | 58.4854 | 67.9602 | 72.568 | 66.6628 | 540 | 0 |
| erc | 59.0 | 51.2972 | 59.9184 | 64.866 | 59.0136 | 540 | 0 |
| inverse_volatility | 50.8069 | 44.0208 | 50.7614 | 57.684 | 50.7491 | 540 | 0 |

Final score formula: `0.5 * p50Score + 0.25 * p10Score + 0.25 * p90Score`.
Single-case score formula: Sharpe 50%, max drawdown 30%, volatility 20%.
