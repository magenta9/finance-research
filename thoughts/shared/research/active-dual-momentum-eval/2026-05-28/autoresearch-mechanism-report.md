# Active Dual Momentum 机制级 Auto Research 研究报告

日期：2026-05-28

## 1. 研究问题

本轮研究目标不是调参，而是在 Active Dual Momentum V1 的框架上寻找更好的策略机制，提升跨市场风险调整收益和尾部稳定性。

研究约束：

- 行情数据必须走 `quant-data get-price-series`，不直接访问 SQLite。
- 不把长短动量周期、topK、sleeve 权重作为主要优化对象。
- 机制实验需要通过机械 Eval，而不是主观判断。
- 评价方向为 higher is better。

## 2. Eval 方法

### 2.1 样本设计

Eval 使用显式资产池，共 89 个候选资产；在 full Eval 的覆盖检查中，满足 5 年窗口和 warmup 约束的候选资产为 49 个。

抽样框架：

- 篮子规模：5、10、20 个标的
- 回测窗口：1 年、2 年、3 年、5 年
- 每个 size/window 组合样本数：50
- Full Eval case 数：600
- 随机种子：20260528
- 回测结束日：2026-05-27

### 2.2 评分函数

单 case 评分沿用 Eval harness 的综合分：

- Sharpe：50%
- 最大回撤：30%
- 波动率：20%

Auto Research 在 summary 层使用：

```text
combinedScore = 0.7 * meanScore + 0.3 * p10Score
```

进入 full confirmation 的门槛按你的修订放宽为：

- `meanScore >= baseline meanScore * 0.9`
- `p10Score >= baseline p10Score * 0.9`
- 在满足安全垫后，优先选择 `combinedScore` 更高、机制更简单的候选

### 2.3 Full Baseline

ADM V1 baseline 配置：

- absoluteMomentumFilter: true
- longLookbackWeeks: 25
- shortLookbackWeeks: 10
- topK: 4
- sleeveWeights: long 0.5 / short 0.5
- transactionCostBps: 0
- slippageBps: 0

Full baseline 结果：

| 指标 | ADM V1 baseline |
|---|---:|
| caseCount | 600 |
| successCount | 600 |
| failureCount | 0 |
| meanScore | 58.5533 |
| p10Score | 27.2775 |
| p50Score | 57.0239 |
| p90Score | 91.9164 |
| combinedScore | 49.1706 |

## 3. Auto Research 过程

| 轮次 | 机制 | Budget mean | Budget p10 | 结论 |
|---|---|---:|---:|---|
| 1 | sleeve 内按逆波动率分配权重 | 59.9703 | 30.8001 | 二线候选，尾部低于原 baseline 但高于 90% 门槛 |
| 1r | 50% 等权 + 50% 逆波动率 | 58.0859 | 28.9276 | 二线候选，尾部低于原 baseline 但高于 90% 门槛 |
| 2 | 短长周期方向冲突时转现金 | 55.6904 | 25.5576 | discard，尾部显著恶化 |
| 3 | 组合级回撤熔断降仓 | 55.1610 | 26.6318 | discard，错过修复段，尾部未改善 |
| 4 | 市场宽度恶化时降仓 | 52.8449 | 22.1548 | discard，均值和尾部都变差 |
| 5 | long sleeve 不承担 futures 长周期空头 | 57.8644 | 30.2848 | 二线候选，尾部低于原 baseline 但高于 90% 门槛 |
| 5r | futures 负动量全部转现金 | 56.9955 | 28.0330 | discard，尾部仍偏弱 |
| 6 | sleeve 入选标的按资产类别设上限 | 61.5761 | 24.2506 | discard，均值高但尾部严重恶化 |
| 7 | 常设 20% cash buffer | 61.2313 | 34.3947 | keep candidate |
| 7i | 隔离验证：仅保留 20% cash buffer | 60.6981 | 32.0725 | keep candidate |
| 8 | 20% cash buffer + sleeve 内逆波动权重 | 64.4694 | 37.1067 | keep candidate，full Eval 通过 |
| 9 | best + long-sleeve futures trend filter | 65.2284 | 38.7577 | keep candidate，full Eval 通过 |

关键观察：逆波动权重单独使用时会改善均值但尾部不够稳；20% cash buffer 单独使用时已经能改善尾部；把二者叠加后，现金缓冲压住整体风险，逆波动权重再降低高波动标的的组合冲击。进一步叠加 long-sleeve futures trend filter 后，长周期 sleeve 不再承担负趋势期货空头，空头表达更多留给短周期 sleeve，full Eval 继续改善。

## 4. 最终机制

最终保留机制：常设 20% cash buffer + sleeve 内逆波动权重 + long-sleeve futures trend filter。

实现方式：

- ADM 的标的选择、futures 语义、绝对动量过滤保持不变。
- short sleeve 与 long sleeve 正常选择候选。
- 每个 sleeve 内，对入选标的计算 lookback 区间内的实现波动率。
- sleeve 权重按 `1 / realizedVolatility` 分配。
- futures 在 short sleeve 中仍可按绝对动量表达多空；但在 long sleeve 中，负动量 futures 不再进入空头仓位，而是转为现金。
- short/long sleeves 合并后，实际持仓权重统一乘以 0.8。
- 缩减出来的 20% 暴露计入现金权重。

这个机制改变的是风险预算、组合暴露和 futures 信号职责分工，不是动量周期参数。

## 5. Full Eval 结论

| 指标 | ADM V1 baseline | 20% cash buffer | cash + inverse vol | final best | 相对 baseline 变化 |
|---|---:|---:|---:|---:|---:|
| caseCount | 600 | 600 | 600 | 600 | 0 |
| successCount | 600 | 600 | 600 | 600 | 0 |
| failureCount | 0 | 0 | 0 | 0 | 0 |
| meanScore | 58.5533 | 63.2808 | 67.0347 | 67.5640 | +9.0107 |
| p10Score | 27.2775 | 33.1089 | 38.0058 | 39.9569 | +12.6794 |
| p50Score | 57.0239 | 62.5091 | 66.8327 | 68.0753 | +11.0514 |
| p90Score | 91.9164 | 93.5335 | 93.5667 | 93.5811 | +1.6647 |
| combinedScore | 49.1706 | 54.2292 | 58.3260 | 59.2819 | +10.1113 |

研究结论：最终 best 机制在 full Eval 上明显优于 ADM V1，也优于 cash buffer-only 和 cash + inverse vol 两个中间版本。它同时提升 meanScore 与 p10Score，说明不是只优化平均表现，而是在弱样本上也有改善。

相对 cash buffer-only：

- meanScore 进一步提升 4.2832
- p10Score 进一步提升 6.8480
- combinedScore 进一步提升 5.0527

## 6. 验证结果

已执行 guard：

- Eval harness unit tests：6 tests passed
- `make strategy.test`：13 tests passed
- QuantDesk ADM rules vitest：5 tests passed
- Eval harness 直接 SQLite 检查：仅 README 中存在否定说明，代码未直接访问 SQLite

最终保留提交：

- `b0c0bea experiment(adm): isolate cash buffer mechanism`
- `c33e071 experiment(adm): keep isolated cash buffer`
- `a5d5f84 experiment(adm): combine cash buffer and inverse volatility`
- `0d4a812 experiment(adm): add futures trend filter to best`

## 7. 局限与后续建议

本轮结论基于当前 quant-data 可覆盖资产、当前评分函数和固定随机种子。它支持 final best 机制进入下一阶段，但还不是最终产品默认参数结论。

建议后续：

1. 使用不同随机种子重复 full Eval，确认不是样本路径偶然性。
2. 对剩余二线候选补跑 full Eval：50/50 逆波动权重，以及与 final best 的组合版本。
3. 加入交易成本和滑点敏感性测试。
4. 在产品层把 cash buffer 和 sleeve weighting 做成可配置机制，而不是硬编码。
5. 对 drawdown attribution 做二次复盘，确认改善来自波动/回撤压缩，而不是评分函数偏差。
6. 将 full Eval raw rows 改为可压缩归档或只保留 summary，避免研究证据文件过大。

## 8. 证据文件

- Iteration log: `autoresearch-mechanism-results.tsv`
- Budget confirmation: `autoresearch-iter08-cash-inv-vol/score-summary.json`
- Previous full confirmation: `autoresearch-full-cash-inv-vol-20260528/score-summary.json`
- Final full confirmation: `autoresearch-full-best-futures-trend-filter-20260528/score-summary.json`
- Eval plan: `autoresearch-full-best-futures-trend-filter-20260528/eval-plan.json`
