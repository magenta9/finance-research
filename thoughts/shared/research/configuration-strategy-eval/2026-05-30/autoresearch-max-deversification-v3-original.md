# Max Deversification V3 (Original Strategy Restart)

## Baseline

- Baseline strategy: `max_diversification`
- Baseline source: `autoresearch-max-deversification-v3-original-baseline`
- Baseline scores: mean `47.9010`, P10 `36.1619`, P50 `50.7101`, P90 `55.7887`, final `48.3427`
- Keep rule: every summary score must be at least 80% of baseline and finalScore must improve current best.
- Current best retained strategy: `max_diversification_research_v1`
- Current best source: `autoresearch-max-deversification-v3-original-iter6-absolute-momentum`
- Current best config: `{"maxSingleWeight": 0.4, "minCorrelation": 0.05, "volatilityPower": 0.25, "absoluteMomentumLookbackDaysList": [50, 125, 252], "absoluteMomentumMinPositiveCount": 2, "absoluteMomentumThreshold": 0}`
- Current best scores: mean `56.3460`, P10 `39.8174`, P50 `59.6956`, P90 `66.8721`, final `56.5202`
- Consecutive non-improving iterations: `0` after iteration 6
- Stop rule: stop after `20` consecutive non-improving iterations.

## Framework Snapshot

- Basket sizes: `5, 10, 15, 20`
- Scoring weights: expected return `0.30`, Sharpe `0.40`, max drawdown `0.15`, volatility `0.15`
- Expected return score bounds: `0%` to `50%`

## Current Research Process Rules

- Run one mechanism per iteration.
- Before selecting each mechanism, run a web-search pass for evidence-backed directions.
- Prefer mechanism-level candidates over narrow parameter sweeps.
- If finalScore does not beat current best, discard and increment non-improving counter.
- If finalScore beats current best and passes floor checks, keep and commit exactly one commit.

## Iterations

| Iteration | Mechanism | Config | Mean | P10 | P50 | P90 | Final | Decision | Commit |
| ---: | --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| 1 | Single asset cap | `{"maxSingleWeight": 0.4}` | 48.1693 | 37.0844 | 50.8764 | 55.8054 | 48.6606 | Kept: improved over original baseline | - |
| 2 | Minimum correlation floor | `{"maxSingleWeight": 0.4, "minCorrelation": 0.05}` | 48.4315 | 37.4230 | 51.2174 | 55.9770 | 48.9587 | Kept: improved over iteration 1 current best | - |
| 3 | Diagonal loading | `{"maxSingleWeight": 0.4, "minCorrelation": 0.05, "diagonalLoad": 0.1}` | 48.1838 | 37.3447 | 50.8465 | 55.5677 | 48.6514 | Discarded: final below current best baseline `48.9587` | - |
| 4 | Volatility-managed weighting | `{"maxSingleWeight": 0.4, "minCorrelation": 0.05, "volatilityPower": 0.25}` | 49.1494 | 39.2904 | 51.7073 | 56.3774 | 49.7706 | Kept: improved over iteration 2 current best | - |
| 5 | Diagonal loading on new best | `{"maxSingleWeight": 0.4, "minCorrelation": 0.05, "volatilityPower": 0.25, "diagonalLoad": 0.05}` | 49.1368 | 38.9524 | 51.6135 | 56.3141 | 49.6234 | Discarded: final below current best baseline `49.7706` | - |
| 6 | Absolute momentum filter | `{"maxSingleWeight": 0.4, "minCorrelation": 0.05, "volatilityPower": 0.25, "absoluteMomentumLookbackDaysList": [50, 125, 252], "absoluteMomentumMinPositiveCount": 2, "absoluteMomentumThreshold": 0}` | 56.3460 | 39.8174 | 59.6956 | 66.8721 | 56.5202 | Kept: improved over iteration 4 current best | pending |
