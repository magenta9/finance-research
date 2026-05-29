# Max Diversification Research Variant Autoresearch

## Baseline

- Baseline strategy: `max_diversification`
- Baseline source: `baseline-a-bond-config-v1`
- Baseline scores: mean `66.6628`, P10 `58.4854`, P50 `67.9602`, P90 `72.5680`, final `66.7434`
- Keep rule: every summary score must be at least 80% of the original baseline and finalScore must improve the current best baseline.
- Current best retained strategy: `max_diversification_research_v1`
- Current best config: `{"volatilityPower": 0, "minCorrelation": 0.08, "diagonalLoad": 0.15, "maxSingleWeight": 0.6, "cashReserve": 0.3, "absoluteMomentumLookbackDaysList": [50, 125, 252], "absoluteMomentumMinPositiveCount": 2, "absoluteMomentumThreshold": 0, "momentumBreadthCashScale": 1.25}`
- Current best scores: mean `87.5155`, P10 `78.0461`, P50 `88.7598`, P90 `93.7216`, final `87.3218`
- Consecutive non-improving iterations: `0` after iteration 68
- Parameter limit reached: `momentumBreadthCashScale` has 5 attempts after iteration 66; do not tune it again.

## Current Research Process Rules

- Before choosing the next mechanism, run a web search pass for evidence-backed optimization directions.
- Prefer mechanism-level candidates over narrow numeric sweeps.
- From iteration 52 onward, tune any single parameter no more than 5 times before switching mechanism.
- Current web search shortlist: fixed cash reserve, absolute momentum pre-filter, downside volatility/CVaR filtering, structural covariance regularization, risk contribution cap.

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
| 17 | Minimum correlation floor | `{"volatilityPower": 0, "minCorrelation": 0.07}` | 68.6715 | 60.3455 | 70.0390 | 74.6027 | 68.7566 | Discarded: final below current best | - |
| 18 | Minimum correlation floor | `{"volatilityPower": 0, "minCorrelation": 0.065}` | 68.6826 | 60.3391 | 70.0674 | 74.5831 | 68.7643 | Discarded: final below current best | - |
| 19 | Minimum correlation floor | `{"volatilityPower": 0, "minCorrelation": 0.055}` | 68.6890 | 60.3379 | 70.1113 | 74.6288 | 68.7973 | Discarded: final below current best | - |
| 20 | Minimum correlation floor | `{"volatilityPower": 0, "minCorrelation": 0.058}` | 68.6903 | 60.3732 | 70.0947 | 74.6353 | 68.7995 | Discarded: final below current best | - |
| 21 | Minimum correlation floor | `{"volatilityPower": 0, "minCorrelation": 0.061}` | 68.6878 | 60.3884 | 70.1256 | 74.6338 | 68.8183 | Discarded: final below current best | - |
| 22 | Minimum correlation floor | `{"volatilityPower": 0, "minCorrelation": 0.0605}` | 68.6883 | 60.3967 | 70.1336 | 74.6351 | 68.8247 | Kept: improved current best | pending |
| 23 | Minimum correlation floor | `{"volatilityPower": 0, "minCorrelation": 0.06075}` | 68.6880 | 60.3925 | 70.1296 | 74.6351 | 68.8217 | Discarded: final below current best | - |
| 24 | Minimum correlation floor | `{"volatilityPower": 0, "minCorrelation": 0.06025}` | 68.6886 | 60.3997 | 70.1292 | 74.6352 | 68.8233 | Discarded: final below current best | - |
| 25 | Diagonal loading | `{"volatilityPower": 0, "minCorrelation": 0.0605, "diagonalLoad": 0.05}` | 68.7631 | 60.3410 | 70.2330 | 74.7119 | 68.8797 | Kept: improved current best | pending |
| 26 | Diagonal loading | `{"volatilityPower": 0, "minCorrelation": 0.0605, "diagonalLoad": 0.1}` | 68.7894 | 60.4932 | 70.2969 | 74.7834 | 68.9676 | Kept: improved current best | pending |
| 27 | Diagonal loading | `{"volatilityPower": 0, "minCorrelation": 0.0605, "diagonalLoad": 0.2}` | 68.7370 | 60.5583 | 70.2179 | 74.8604 | 68.9636 | Discarded: final below current best | - |
| 28 | Diagonal loading | `{"volatilityPower": 0, "minCorrelation": 0.0605, "diagonalLoad": 0.15}` | 68.7782 | 60.5370 | 70.2629 | 74.8146 | 68.9694 | Kept: improved current best | pending |
| 29 | Diagonal loading | `{"volatilityPower": 0, "minCorrelation": 0.0605, "diagonalLoad": 0.175}` | 68.7614 | 60.5581 | 70.2452 | 74.8266 | 68.9688 | Discarded: final below current best | - |
| 30 | Diagonal loading | `{"volatilityPower": 0, "minCorrelation": 0.0605, "diagonalLoad": 0.125}` | 68.7879 | 60.5068 | 70.2825 | 74.8073 | 68.9698 | Kept: improved current best | pending |
| 31 | Diagonal loading | `{"volatilityPower": 0, "minCorrelation": 0.0605, "diagonalLoad": 0.1125}` | 68.7898 | 60.5410 | 70.2860 | 74.7938 | 68.9767 | Kept: improved current best | pending |
| 32 | Diagonal loading | `{"volatilityPower": 0, "minCorrelation": 0.0605, "diagonalLoad": 0.10625}` | 68.7899 | 60.5224 | 70.2851 | 74.7875 | 68.9700 | Discarded: final below current best | - |
| 33 | Diagonal loading | `{"volatilityPower": 0, "minCorrelation": 0.0605, "diagonalLoad": 0.11875}` | 68.7891 | 60.5205 | 70.2865 | 74.8058 | 68.9748 | Discarded: final below current best | - |
| 34 | Single asset cap | `{"volatilityPower": 0, "minCorrelation": 0.0605, "diagonalLoad": 0.1125, "maxSingleWeight": 0.3}` | 68.2842 | 59.6532 | 69.8740 | 74.0818 | 68.3708 | Discarded: final below current best | - |
| 35 | Single asset cap | `{"volatilityPower": 0, "minCorrelation": 0.0605, "diagonalLoad": 0.1125, "maxSingleWeight": 0.4}` | 69.1172 | 61.1911 | 70.3853 | 75.1192 | 69.2702 | Kept: improved current best | pending |
| 36 | Single asset cap | `{"volatilityPower": 0, "minCorrelation": 0.0605, "diagonalLoad": 0.1125, "maxSingleWeight": 0.45}` | 69.3286 | 61.5134 | 70.6473 | 75.1392 | 69.4868 | Kept: improved current best | pending |
| 37 | Single asset cap | `{"volatilityPower": 0, "minCorrelation": 0.0605, "diagonalLoad": 0.1125, "maxSingleWeight": 0.5}` | 69.4570 | 61.7275 | 70.8639 | 75.3468 | 69.7005 | Kept: improved current best | pending |
| 38 | Single asset cap | `{"volatilityPower": 0, "minCorrelation": 0.0605, "diagonalLoad": 0.1125, "maxSingleWeight": 0.6}` | 69.5517 | 61.7919 | 71.0419 | 75.3468 | 69.8056 | Kept: improved current best | pending |
| 39 | Single asset cap | `{"volatilityPower": 0, "minCorrelation": 0.0605, "diagonalLoad": 0.1125, "maxSingleWeight": 0.8}` | 69.5565 | 61.7919 | 71.0419 | 75.3468 | 69.8056 | Discarded: final tied current best, not higher | - |
| 40 | Single asset cap | `{"volatilityPower": 0, "minCorrelation": 0.0605, "diagonalLoad": 0.1125, "maxSingleWeight": 0.7}` | 69.5565 | 61.7919 | 71.0419 | 75.3468 | 69.8056 | Discarded: final tied current best, not higher | - |
| 41 | Single asset cap | `{"volatilityPower": 0, "minCorrelation": 0.0605, "diagonalLoad": 0.1125, "maxSingleWeight": 0.55}` | 69.5208 | 61.7919 | 71.0419 | 75.3468 | 69.8056 | Discarded: final tied current best, not higher | - |
| 42 | Minimum correlation floor | `{"volatilityPower": 0, "minCorrelation": 0.05, "diagonalLoad": 0.1125, "maxSingleWeight": 0.6}` | 69.5079 | 61.6064 | 70.9029 | 75.1824 | 69.6487 | Discarded: final below current best | - |
| 43 | Minimum correlation floor | `{"volatilityPower": 0, "minCorrelation": 0.07, "diagonalLoad": 0.1125, "maxSingleWeight": 0.6}` | 69.5521 | 61.9336 | 71.0895 | 75.4256 | 69.8845 | Kept: improved current best | pending |
| 44 | Minimum correlation floor | `{"volatilityPower": 0, "minCorrelation": 0.08, "diagonalLoad": 0.1125, "maxSingleWeight": 0.6}` | 69.5154 | 61.9673 | 71.0664 | 75.4905 | 69.8976 | Kept: improved current best | pending |
| 45 | Minimum correlation floor | `{"volatilityPower": 0, "minCorrelation": 0.1, "diagonalLoad": 0.1125, "maxSingleWeight": 0.6}` | 69.4022 | 61.8771 | 70.8109 | 75.6305 | 69.7823 | Discarded: final below current best | - |
| 46 | Minimum correlation floor | `{"volatilityPower": 0, "minCorrelation": 0.09, "diagonalLoad": 0.1125, "maxSingleWeight": 0.6}` | 69.4674 | 61.9235 | 70.9740 | 75.6295 | 69.8752 | Discarded: final below current best | - |
| 47 | Minimum correlation floor | `{"volatilityPower": 0, "minCorrelation": 0.075, "diagonalLoad": 0.1125, "maxSingleWeight": 0.6}` | 69.5362 | 61.9369 | 71.1127 | 75.4075 | 69.8924 | Discarded: final below current best | - |
| 48 | Minimum correlation floor | `{"volatilityPower": 0, "minCorrelation": 0.082, "diagonalLoad": 0.1125, "maxSingleWeight": 0.6}` | 69.5074 | 61.9595 | 71.0376 | 75.5375 | 69.8930 | Discarded: final below current best | - |
| 49 | Diagonal loading | `{"volatilityPower": 0, "minCorrelation": 0.08, "diagonalLoad": 0.1, "maxSingleWeight": 0.6}` | 69.5144 | 61.9510 | 71.0686 | 75.4987 | 69.8967 | Discarded: final below current best | - |
| 50 | Diagonal loading | `{"volatilityPower": 0, "minCorrelation": 0.08, "diagonalLoad": 0.125, "maxSingleWeight": 0.6}` | 69.5147 | 61.9817 | 71.0752 | 75.5132 | 69.9113 | Kept: final improved and all scores above 80% floor | `b0492a6` |
| 51 | Diagonal loading | `{"volatilityPower": 0, "minCorrelation": 0.08, "diagonalLoad": 0.15, "maxSingleWeight": 0.6}` | 69.5075 | 61.9820 | 71.0674 | 75.5300 | 69.9117 | Kept: final improved and all scores above 80% floor | `44f46c8` |
| 52 | Cash reserve | `{"volatilityPower": 0, "minCorrelation": 0.08, "diagonalLoad": 0.15, "maxSingleWeight": 0.6, "cashReserve": 0.2}` | 71.6194 | 64.8035 | 72.8972 | 77.1525 | 71.9376 | Kept: final improved and all scores above 80% floor | `bba4529` |
| 53 | Cash reserve | `{"volatilityPower": 0, "minCorrelation": 0.08, "diagonalLoad": 0.15, "maxSingleWeight": 0.6, "cashReserve": 0.25}` | 72.1496 | 65.5302 | 73.3918 | 77.5599 | 72.4684 | Kept: final improved and all scores above 80% floor | `51b1dcf` |
| 54 | Absolute momentum pre-filter | `{"volatilityPower": 0, "minCorrelation": 0.08, "diagonalLoad": 0.15, "maxSingleWeight": 0.6, "cashReserve": 0.25, "absoluteMomentumLookbackDays": 252, "absoluteMomentumThreshold": 0}` | 74.3063 | 65.2213 | 75.4239 | 81.1640 | 74.3083 | Kept: final improved and all scores above 80% floor | `03d2b61` |
| 55 | CVaR95 tail-risk pre-filter | `{"volatilityPower": 0, "minCorrelation": 0.08, "diagonalLoad": 0.15, "maxSingleWeight": 0.6, "cashReserve": 0.25, "absoluteMomentumLookbackDays": 252, "absoluteMomentumThreshold": 0, "cvarTailProbability": 0.05, "cvarExcludeFraction": 0.25}` | 74.2119 | 64.9307 | 75.3500 | 81.3629 | 74.2484 | Discarded: final below current best; candidate code reverted | - |
| 56 | Downside covariance | `{"volatilityPower": 0, "minCorrelation": 0.08, "diagonalLoad": 0.15, "maxSingleWeight": 0.6, "cashReserve": 0.25, "absoluteMomentumLookbackDays": 252, "absoluteMomentumThreshold": 0, "downsideCovariance": true}` | 73.0567 | 63.9830 | 75.1401 | 80.2496 | 73.6282 | Discarded: final below current best; candidate code reverted | - |
| 57 | Covariance shrinkage | `{"volatilityPower": 0, "minCorrelation": 0.08, "diagonalLoad": 0.15, "maxSingleWeight": 0.6, "cashReserve": 0.25, "absoluteMomentumLookbackDays": 252, "absoluteMomentumThreshold": 0, "covarianceShrinkage": 0.2}` | 73.8276 | 64.9920 | 74.7261 | 80.6422 | 73.7716 | Discarded: final below current best | - |
| 58 | Inverse volatility blend | `{"volatilityPower": 0, "minCorrelation": 0.08, "diagonalLoad": 0.15, "maxSingleWeight": 0.6, "cashReserve": 0.25, "absoluteMomentumLookbackDays": 252, "absoluteMomentumThreshold": 0, "inverseVolatilityBlend": 0.3}` | 70.5616 | 62.3374 | 72.1339 | 76.1783 | 70.6959 | Discarded: final below current best; candidate code reverted | - |
| 59 | Relative momentum Top 50% | `{"volatilityPower": 0, "minCorrelation": 0.08, "diagonalLoad": 0.15, "maxSingleWeight": 0.6, "cashReserve": 0.25, "absoluteMomentumLookbackDays": 252, "absoluteMomentumThreshold": 0, "relativeMomentumTopFraction": 0.5}` | 63.7949 | 44.5390 | 66.3921 | 76.2428 | 63.3915 | Discarded: final below current best and P10 below 80% floor; candidate code reverted | - |
| 60 | Momentum breadth dynamic cash | `{"volatilityPower": 0, "minCorrelation": 0.08, "diagonalLoad": 0.15, "maxSingleWeight": 0.6, "cashReserve": 0.25, "absoluteMomentumLookbackDays": 252, "absoluteMomentumThreshold": 0, "momentumBreadthCashScale": 0.25}` | 75.4616 | 66.4891 | 76.3108 | 82.1280 | 75.3097 | Kept: final improved and all scores above 80% floor | `dc53f10` |
| 61 | Multi-horizon absolute momentum | `{"volatilityPower": 0, "minCorrelation": 0.08, "diagonalLoad": 0.15, "maxSingleWeight": 0.6, "cashReserve": 0.25, "absoluteMomentumLookbackDaysList": [50, 125, 252], "absoluteMomentumMinPositiveCount": 2, "absoluteMomentumThreshold": 0, "momentumBreadthCashScale": 0.25}` | 79.1731 | 67.0189 | 81.0170 | 87.1932 | 79.0615 | Kept: final improved and all scores above 80% floor | `9d7c390` |
| 62 | EWMA covariance | `{"volatilityPower": 0, "minCorrelation": 0.08, "diagonalLoad": 0.15, "maxSingleWeight": 0.6, "cashReserve": 0.25, "absoluteMomentumLookbackDaysList": [50, 125, 252], "absoluteMomentumMinPositiveCount": 2, "absoluteMomentumThreshold": 0, "momentumBreadthCashScale": 0.25, "ewmaCovariance": true}` | 77.8063 | 65.8664 | 80.3961 | 85.5925 | 78.0628 | Discarded: final below current best; candidate code reverted | - |
| 63 | Momentum breadth dynamic cash | `{"volatilityPower": 0, "minCorrelation": 0.08, "diagonalLoad": 0.15, "maxSingleWeight": 0.6, "cashReserve": 0.25, "absoluteMomentumLookbackDaysList": [50, 125, 252], "absoluteMomentumMinPositiveCount": 2, "absoluteMomentumThreshold": 0, "momentumBreadthCashScale": 0.5}` | 81.4737 | 70.4716 | 82.9263 | 88.9165 | 81.3102 | Kept: final improved and all scores above 80% floor | `35ee095` |
| 64 | Momentum breadth dynamic cash | `{"volatilityPower": 0, "minCorrelation": 0.08, "diagonalLoad": 0.15, "maxSingleWeight": 0.6, "cashReserve": 0.25, "absoluteMomentumLookbackDaysList": [50, 125, 252], "absoluteMomentumMinPositiveCount": 2, "absoluteMomentumThreshold": 0, "momentumBreadthCashScale": 0.75}` | 83.8027 | 74.3794 | 85.0313 | 90.5670 | 83.7523 | Kept: final improved and all scores above 80% floor | `bfad7d3` |
| 65 | Momentum breadth dynamic cash | `{"volatilityPower": 0, "minCorrelation": 0.08, "diagonalLoad": 0.15, "maxSingleWeight": 0.6, "cashReserve": 0.25, "absoluteMomentumLookbackDaysList": [50, 125, 252], "absoluteMomentumMinPositiveCount": 2, "absoluteMomentumThreshold": 0, "momentumBreadthCashScale": 1.0}` | 86.0486 | 77.5229 | 87.3854 | 92.5949 | 86.2221 | Kept: final improved and all scores above 80% floor | `282cb0b` |
| 66 | Momentum breadth dynamic cash | `{"volatilityPower": 0, "minCorrelation": 0.08, "diagonalLoad": 0.15, "maxSingleWeight": 0.6, "cashReserve": 0.25, "absoluteMomentumLookbackDaysList": [50, 125, 252], "absoluteMomentumMinPositiveCount": 2, "absoluteMomentumThreshold": 0, "momentumBreadthCashScale": 1.25}` | 87.3392 | 78.0461 | 88.4695 | 93.5686 | 87.1384 | Kept: final improved and all scores above 80% floor; parameter limit reached for momentumBreadthCashScale | `3389798` |
| 67 | Risk contribution cap | `{"volatilityPower": 0, "minCorrelation": 0.08, "diagonalLoad": 0.15, "maxSingleWeight": 0.6, "cashReserve": 0.25, "absoluteMomentumLookbackDaysList": [50, 125, 252], "absoluteMomentumMinPositiveCount": 2, "absoluteMomentumThreshold": 0, "momentumBreadthCashScale": 1.25, "riskContributionCap": 0.35}` | 86.1780 | 77.4343 | 87.7175 | 92.7213 | 86.3976 | Discarded: final below current best; candidate code reverted | - |
| 68 | Base cash reserve | `{"volatilityPower": 0, "minCorrelation": 0.08, "diagonalLoad": 0.15, "maxSingleWeight": 0.6, "cashReserve": 0.3, "absoluteMomentumLookbackDaysList": [50, 125, 252], "absoluteMomentumMinPositiveCount": 2, "absoluteMomentumThreshold": 0, "momentumBreadthCashScale": 1.25}` | 87.5155 | 78.0461 | 88.7598 | 93.7216 | 87.3218 | Kept: final improved and all scores above 80% floor | pending |

## Continuation Rule

Continue one mechanism per iteration. Stop only after 10 consecutive iterations fail to improve the current best finalScore while meeting the 80% floor rule. From iteration 52 onward, do a web search pass before selecting a new mechanism and do not tune any single parameter more than 5 times.
