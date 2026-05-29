# Max Diversification Research Variant Autoresearch

## Baseline

- Baseline strategy: `max_diversification`
- Baseline source: `baseline-a-bond-config-v1`
- Baseline scores: mean `66.6628`, P10 `58.4854`, P50 `67.9602`, P90 `72.5680`, final `66.7434`
- Keep rule: every summary score must be at least 80% of the original baseline and finalScore must improve the current best baseline.
- Current best retained strategy: `max_diversification_research_v1`
- Current best config: `{"volatilityPower": 0, "minCorrelation": 0.06}`
- Current best scores: mean `68.6888`, P10 `60.3968`, P50 `70.1233`, P90 `74.6352`, final `68.8196`
- Consecutive non-improving iterations: `0` after iteration 16

## Iterations

| Iteration | Mechanism | Config | Mean | P10 | P50 | P90 | Final | Decision | Commit |
| ---: | --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| 1 | Single asset cap | `{"maxSingleWeight": 0.3}` | 66.4385 | 57.6401 | 67.8449 | 72.5422 | 66.4680 | Discarded: final below original baseline | - |
| 2 | Single asset cap | `{"maxSingleWeight": 0.25}` | 65.9569 | 56.7507 | 67.6696 | 72.3058 | 66.0989 | Discarded: final below original baseline | - |
| 3 | Volatility vector power | `{"volatilityPower": 0.75}` | 67.6631 | 59.6380 | 69.0199 | 73.4796 | 67.7894 | Kept: improved original baseline | `a721530` |
| 4 | Volatility vector power | `{"volatilityPower": 0.5}` | 68.1885 | 59.9335 | 69.4390 | 74.0526 | 68.2160 | Kept: improved current best | `920f5e3` |
| 5 | Volatility vector power | `{"volatilityPower": 0.25}` | 68.4425 | 60.2715 | 69.7564 | 74.3369 | 68.5303 | Kept: improved current best | `6c40719` |
| 6 | Volatility vector power | `{"volatilityPower": 0}` | 68.4442 | 60.0689 | 69.8902 | 74.5586 | 68.6020 | Kept: improved current best | `bc59d9b` |
| 7 | Volatility vector power | `{"volatilityPower": -0.25}` | 68.3366 | 59.4846 | 69.8191 | 74.8061 | 68.4822 | Discarded: final below current best | - |
| 8 | Volatility vector power | `{"volatilityPower": 0.1}` | 68.4693 | 60.1610 | 69.8655 | 74.4877 | 68.5949 | Discarded: final below current best | - |
| 9 | Volatility vector power | `{"volatilityPower": -0.1}` | 68.4015 | 59.7645 | 69.7736 | 74.5391 | 68.4627 | Discarded: final below current best | - |
| 10 | Volatility vector power | `{"volatilityPower": 0.05}` | 68.4595 | 60.1177 | 69.8704 | 74.5076 | 68.5915 | Discarded: final below current best | - |
| 11 | Covariance shrinkage | `{"volatilityPower": 0, "covarianceShrinkage": 0.1}` | 68.3812 | 60.0585 | 69.7636 | 74.5593 | 68.5362 | Discarded: final below current best | - |
| 12 | Minimum correlation floor | `{"volatilityPower": 0, "minCorrelation": 0.05}` | 68.6771 | 60.2793 | 70.1126 | 74.5988 | 68.7758 | Kept: improved current best | pending |
| 13 | Minimum correlation floor | `{"volatilityPower": 0, "minCorrelation": 0.1}` | 68.4368 | 60.1505 | 69.6856 | 74.5899 | 68.5279 | Discarded: final below current best | - |
| 14 | Minimum correlation floor | `{"volatilityPower": 0, "minCorrelation": 0.025}` | 68.4455 | 60.0178 | 69.9263 | 74.2907 | 68.5403 | Discarded: final below current best | - |
| 15 | Minimum correlation floor | `{"volatilityPower": 0, "minCorrelation": 0.04}` | 68.6238 | 60.2752 | 69.9756 | 74.4838 | 68.6775 | Discarded: final below current best | - |
| 16 | Minimum correlation floor | `{"volatilityPower": 0, "minCorrelation": 0.06}` | 68.6888 | 60.3968 | 70.1233 | 74.6352 | 68.8196 | Kept: improved current best | pending |

## Continuation Rule

Continue one mechanism per iteration. Stop only after 10 consecutive iterations fail to improve the current best finalScore while meeting the 80% floor rule.
