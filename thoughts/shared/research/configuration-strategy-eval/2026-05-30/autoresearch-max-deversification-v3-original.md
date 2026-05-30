# Max Deversification V3 (Original Strategy Restart)

## Baseline

- Baseline strategy: `max_diversification`
- Baseline source: `autoresearch-max-deversification-v3-original-baseline`
- Baseline scores: mean `47.9010`, P10 `36.1619`, P50 `50.7101`, P90 `55.7887`, final `48.3427`
- Keep rule: every summary score must be at least 80% of baseline and finalScore must improve current best.
- Current best retained strategy: `max_diversification_research_v1`
- Current best source: `autoresearch-max-deversification-v3-original-iter59-equity-028`
- Current best config: see `tools/strategy/eval/config/max-diversification-research-v1.json`
- Current best scores: mean `65.6312` (iter 59 run), final `65.6312`
- Consecutive non-improving iterations: `20` after iteration 81; **autoresearch stop rule triggered** on 2026-05-30 session.
- Progress note: original `max_diversification` baseline final `48.3427` → current best `65.6312` (+17.29 points, +35.8%).
- Progress note: iterations 6-31 executed on 2026-05-30 session; original baseline final `48.3427` to current best `58.4562` (+10.11 points).
- Stop rule: stop after `20` consecutive non-improving iterations.

## Framework Snapshot

- Basket sizes: `5, 10, 15, 20`
- Scoring weights: expected return `0.30`, Sharpe `0.40`, max drawdown `0.15`, volatility `0.15`
- Expected return score bounds: `0%` to `50%`

## Current Research Process Rules

- Run one mechanism per iteration.
- Before selecting each mechanism, run a web-search pass for evidence-backed directions.
- Iteration 32 web direction: Ang & Bekaert (2004) correlation-regime allocation; implement average-pairwise-correlation cash scaling (`correlationAwareCashFloor` / `correlationAwareCashScale`). Result: final `58.4562` ties current best; mechanism commit reverted.
- Iteration 33 web direction: Ledoit & Wolf constant-correlation shrink (`covarianceShrinkTarget: constant_correlation`). Result: final `53.3495`; discarded without commit.
- Iteration 34 web direction: HRP overlay (`hrpOverlayBlend: 0.5`, López de Prado 2016). Result: final `58.3006`; discarded without commit.
- Iteration 35 web direction: Marchenko–Pastur RMT denoising (López de Prado 2020). Result: final `59.0287`; kept.
- Next mechanism shortlist: risk-parity blend guardrail, expected-return tilt with floor, correlation-regime cash (re-test with new stack).
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
| 6 | Absolute momentum filter | `{"maxSingleWeight": 0.4, "minCorrelation": 0.05, "volatilityPower": 0.25, "absoluteMomentumLookbackDaysList": [50, 125, 252], "absoluteMomentumMinPositiveCount": 2, "absoluteMomentumThreshold": 0}` | 56.3460 | 39.8174 | 59.6956 | 66.8721 | 56.5202 | Kept: improved over iteration 4 current best | `1cb57ae` |
| 7 | Defensive cash reserve + momentum breadth scaling | `{"maxSingleWeight": 0.4, "minCorrelation": 0.05, "volatilityPower": 0.25, "absoluteMomentumLookbackDaysList": [50, 125, 252], "absoluteMomentumMinPositiveCount": 2, "absoluteMomentumThreshold": 0, "cashReserve": 0.25, "momentumBreadthCashScale": 1.25}` | 58.1556 | 47.3315 | 59.8223 | 65.4086 | 58.0962 | Kept: improved over iteration 6 current best | `d89cf56` |
| 8 | Cash reserve 0.30 | `{"maxSingleWeight": 0.4, "minCorrelation": 0.05, "volatilityPower": 0.25, "absoluteMomentumLookbackDaysList": [50, 125, 252], "absoluteMomentumMinPositiveCount": 2, "absoluteMomentumThreshold": 0, "cashReserve": 0.30, "momentumBreadthCashScale": 1.25}` | 58.1766 | 47.3315 | 59.8223 | 65.3836 | 58.0899 | Discarded: final below current best baseline `58.0962` | - |
| 9 | Volatility power 0 | `{"maxSingleWeight": 0.4, "minCorrelation": 0.05, "volatilityPower": 0, "absoluteMomentumLookbackDaysList": [50, 125, 252], "absoluteMomentumMinPositiveCount": 2, "absoluteMomentumThreshold": 0, "cashReserve": 0.25, "momentumBreadthCashScale": 1.25}` | 57.9832 | 47.3135 | 59.4843 | 65.4201 | 57.9256 | Discarded: final below current best baseline `58.0962` | - |
| 10 | Diagonal loading 0.15 | `{"maxSingleWeight": 0.4, "minCorrelation": 0.05, "volatilityPower": 0.25, "diagonalLoad": 0.15, "absoluteMomentumLookbackDaysList": [50, 125, 252], "absoluteMomentumMinPositiveCount": 2, "absoluteMomentumThreshold": 0, "cashReserve": 0.25, "momentumBreadthCashScale": 1.25}` | 58.0378 | 47.3315 | 59.7974 | 65.0462 | 57.9931 | Discarded: final below current best baseline `58.0962` | - |
| 11 | Momentum lookbacks 50/150/300 | `{"maxSingleWeight": 0.4, "minCorrelation": 0.05, "volatilityPower": 0.25, "absoluteMomentumLookbackDaysList": [50, 150, 300], "absoluteMomentumMinPositiveCount": 2, "absoluteMomentumThreshold": 0, "cashReserve": 0.25, "momentumBreadthCashScale": 1.25}` | 58.2770 | 47.9911 | 59.7741 | 65.3685 | 58.2270 | Kept: improved over iteration 7 current best | `d665b8c` |
| 12-18 | Parameter probes (cash 0.30, vol power 0, diagonal load, etc.) | — | — | — | — | — | Discarded | - |
| 13 | Cash reserve 0.20 | see iter 11 + `cashReserve: 0.20` | 58.2417 | 47.9911 | 59.7741 | 65.3685 | 58.2339 | Kept | `ba48ef6` |
| 20 | Momentum breadth scale 1.5 | see iter 13 + `momentumBreadthCashScale: 1.5` | 58.2843 | 47.9911 | 59.7741 | 65.3685 | 58.2362 | Kept | `96cfb4c` |
| 25 | Momentum breadth scale 2.0 | see iter 13 + `momentumBreadthCashScale: 2.0` | 58.3341 | 48.5025 | 59.9496 | 65.4231 | 58.2866 | Kept (session) | - |
| 29 | Single asset cap 0.45 | see iter 13 + `maxSingleWeight: 0.45` | 58.4203 | 48.5025 | 59.9496 | 65.4231 | 58.3721 | Kept (session) | - |
| 31 | Combined breadth 2.0 + cap 0.45 | current best config | 58.5658 | 48.5025 | 59.9496 | 65.4231 | 58.4562 | Kept: verified combined stack | `87b6364` |
