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
- Budget Eval：每个 size/window 组合 5 个样本，共 60 cases
- Full Eval：每个 size/window 组合 50 个样本，共 600 cases
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

### 2.3 审计修正

继续 50 轮时，初版 sweep 直接调用了 `eval_lib.generate_cases`，抽样 seed 分配与标准 `run_eval.py` 不一致。该批结果保留为原始证据，但不纳入最终结论。

已修正 `run_mechanism_research.py`，复用 `run_eval.generate_eval_cases`，并重跑 50 个机制候选。最终确认只采用标准 case 生成规则下的 budget/full Eval。

## 3. 对照基准

### 3.1 ADM V1 baseline

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

### 3.2 上一版 best

上一版机制为：20% standing cash buffer + inverse-volatility sleeve weighting + long-sleeve futures trend filter。

| 指标 | 上一版 best |
|---|---:|
| caseCount | 600 |
| successCount | 600 |
| failureCount | 0 |
| meanScore | 67.5640 |
| p10Score | 39.9569 |
| p50Score | 68.0753 |
| p90Score | 93.5811 |
| combinedScore | 59.2819 |

## 4. 继续 50 轮机制研究

本轮新增了研究专用 mechanism sweep runner，用同一批 quant-data 行情和同一套标准 cases 评估候选机制，避免 50 次重复拉取行情。

候选机制覆盖：

- 动量排序机制：风险调整排序、下行风险调整排序、回撤惩罚、动量斜率、期货正趋势偏置。
- 权重机制：下行波动反比权重、平方根反波动权重、等权对照。
- 风险处理机制：期货空头确认、期货空头半仓、ETF 高位确认、近期冲击转现金、低分差转现金、衰减惩罚、单仓上限、分步调仓、小幅变化保持带、现金缓冲调整。
- 组合机制：上述单机制与高优先级机制组合。

标准 case budget sweep 的最佳候选：

| 迭代 | 机制 | meanScore | p10Score | combinedScore | 决策 |
|---|---|---:|---:|---:|---|
| 45 | 下行波动调整排序 + 25% 现金缓冲 | 70.5477 | 44.1610 | 62.6317 | 进入 full confirmation |

Full confirmation：

| 指标 | 第 45 轮机制 |
|---|---:|
| caseCount | 600 |
| successCount | 600 |
| failureCount | 0 |
| meanScore | 72.7632 |
| p10Score | 48.8738 |
| p50Score | 75.1751 |
| p90Score | 94.2882 |
| combinedScore | 65.5964 |

## 5. 追加 20 轮逐轮检索研究

按新的执行要求，追加 20 轮“先检索方向，再落地机制，再跑 Eval 验证”的循环。检索方向来自 dual momentum、trend following、volatility-managed portfolios、managed futures、rebalancing friction 等机制研究，优先测试能改善 p10/tail robustness 的机制。

当前默认机制的 60-case budget baseline：

| 指标 | 当前默认 baseline |
|---|---:|
| caseCount | 60 |
| successCount | 60 |
| failureCount | 0 |
| meanScore | 70.6348 |
| p10Score | 41.8233 |
| p50Score | 71.3773 |
| p90Score | 93.2878 |
| combinedScore | 61.9914 |

20 轮 budget 中最强候选为第 62 轮：将 sleeve 权重从全波动反比改为下行波动反比。

| 迭代 | 机制 | meanScore | p10Score | combinedScore | 决策 |
|---|---|---:|---:|---:|---|
| 62 | 下行波动调整排序 + 下行波动反比权重 + 25% 现金缓冲 | 71.4550 | 43.6283 | 63.1070 | 进入 full confirmation |

Full confirmation：

| 指标 | 第 62 轮机制 |
|---|---:|
| caseCount | 600 |
| successCount | 600 |
| failureCount | 0 |
| meanScore | 73.4557 |
| p10Score | 51.1093 |
| p50Score | 75.6471 |
| p90Score | 94.2375 |
| combinedScore | 66.7518 |

## 6. 第 63 轮顺序迭代

按你的修正，本轮开始改为严格顺序迭代：每轮先搜索一个方向，只尝试这一个方向，保存 Eval 结果；只有提升 baseline 才 commit。

第 63 轮搜索方向：组合层下行波动目标化覆盖。

搜索依据：当前 best 已经完成单资产层面的下行风险排序和下行风险分权，下一步应检查合并后的 signed portfolio 是否进入高下行波动状态。该方向来自 volatility-managed portfolios 的思想：高波动状态下降低风险暴露，目标是改善 p10 和回撤/波动评分。实现上不加杠杆，只在合并组合的近期下行波动超过固定目标时把额外风险转为现金。

Budget Eval：

| 迭代 | 机制 | meanScore | p10Score | combinedScore | 决策 |
|---|---|---:|---:|---:|---|
| 63 | 组合层下行波动目标化覆盖 | 73.4590 | 45.7774 | 65.1545 | 进入 full confirmation |

Full confirmation：

| 指标 | 第 63 轮机制 |
|---|---:|
| caseCount | 600 |
| successCount | 600 |
| failureCount | 0 |
| meanScore | 74.4075 |
| p10Score | 52.4746 |
| p50Score | 77.1963 |
| p90Score | 94.2375 |
| combinedScore | 67.8276 |

## 7. 第 64 轮顺序迭代

第 64 轮搜索方向：组合下行贡献选择性 haircut。

搜索依据：第 63 轮的组合层下行波动目标化使用统一缩放，可能同时降低拖累仓位和对冲仓位。第 64 轮尝试只对组合下跌日贡献更大的仓位施加更多 haircut，低贡献仓位保留更多基础暴露，不反向放大。

Budget Eval：

| 迭代 | 机制 | meanScore | p10Score | combinedScore | 决策 |
|---|---|---:|---:|---:|---|
| 64 | 组合下行贡献选择性 haircut | 72.1610 | 43.9813 | 63.7071 | discard |

结论：第 64 轮低于当前 budget baseline（mean 73.4590 / p10 45.7774 / combined 65.1545），不进入 full confirmation，不 commit。实验代码已回滚，仅保留 Eval 证据。

## 8. 第 65 轮顺序迭代

第 65 轮搜索方向：组合下行亏损广度覆盖。

搜索依据：第 64 轮逐仓贡献 haircut 失败后，继续沿组合层状态识别，但避免选择性惩罚单仓。该机制统计组合下跌日亏损是否集中在少数仓位；若集中度过高，则在第 63 轮统一降风险基础上再统一降低暴露。

Budget Eval：

| 迭代 | 机制 | meanScore | p10Score | combinedScore | 决策 |
|---|---|---:|---:|---:|---|
| 65 | 组合下行亏损广度覆盖 | 72.2378 | 43.5691 | 63.6372 | discard |

结论：第 65 轮仍低于当前 budget baseline（mean 73.4590 / p10 45.7774 / combined 65.1545），不进入 full confirmation，不 commit。第 64/65 两轮共同说明，在第 63 轮之后继续叠加“下跌来源惩罚”会损伤当前 Eval。

## 9. 第 66 轮顺序迭代

第 66 轮搜索方向：近期动量反向衰减覆盖。

搜索依据：第 64/65 轮说明继续做组合下跌贡献和集中度惩罚会伤害当前组合，因此第 66 轮回到信号质量层，尝试削减长周期动量仍强但近期动量已经反向的 stale momentum 仓位。

Budget Eval：

| 迭代 | 机制 | meanScore | p10Score | combinedScore | 决策 |
|---|---|---:|---:|---:|---|
| 66 | 近期动量反向衰减覆盖 | 72.3358 | 46.4217 | 64.5616 | discard |

结论：第 66 轮 p10 高于当前 budget baseline，但 meanScore 下滑导致 combinedScore 低于 baseline（65.1545），不进入 full confirmation，不 commit。

## 10. 第 67 轮顺序迭代

第 67 轮搜索方向：组合签名相关性压力门控。

搜索依据：第 64/65 轮显示继续追踪下跌贡献和集中度会拖累，第 67 轮改为观察 signed positions 的相关性压力，只有相关性上升且最近组合收益为负时才统一轻微降暴露。

Budget Eval：

| 迭代 | 机制 | meanScore | p10Score | combinedScore | 决策 |
|---|---|---:|---:|---:|---|
| 67 | 组合签名相关性压力门控 | 72.2384 | 45.1597 | 64.1148 | discard |

结论：第 67 轮低于当前 budget baseline（mean 73.4590 / p10 45.7774 / combined 65.1545），不进入 full confirmation，不 commit。第 64-67 轮共同显示，在第 63 轮之后继续叠加风险削减类 overlay 的边际收益不足。

## 11. 第 68 轮顺序迭代

第 68 轮搜索方向：现金缓冲收益入账。

搜索依据：第 63 轮 best 之后继续增加风险削减类 overlay 的效果变差，因此第 68 轮改为非降风险机制：不改变仓位，只让已经存在的现金权重按 base currency 无风险利率获得低波动收益。该方向修正的是现金机会成本建模，而不是参数优化。

Budget Eval：

| 迭代 | 机制 | meanScore | p10Score | combinedScore | 决策 |
|---|---|---:|---:|---:|---|
| 68 | 现金缓冲收益入账 | 74.5776 | 50.5527 | 67.3701 | 进入 full confirmation |

Full confirmation：

| 指标 | 第 68 轮机制 |
|---|---:|
| caseCount | 600 |
| successCount | 600 |
| failureCount | 0 |
| meanScore | 76.8205 |
| p10Score | 56.0719 |
| p50Score | 80.4666 |
| p90Score | 94.5625 |
| combinedScore | 70.5959 |

## 12. 第 69 轮顺序迭代

第 69 轮搜索方向：持仓保留式排名迟滞。

搜索依据：第 68 轮之后，策略已经有较强的现金和风险控制机制。第 69 轮不继续降风险，而是测试横截面选择的路径依赖：当排名只在最弱 slot 附近洗牌时，优先保留仍满足基础动量和期货方向过滤的上期持仓，以减少 whipsaw 和换手噪声。

Budget Eval：

| 迭代 | 机制 | meanScore | p10Score | combinedScore | 决策 |
|---|---|---:|---:|---:|---|
| 69 | 持仓保留式排名迟滞 | 75.1859 | 49.0773 | 67.3533 | discard |

结论：第 69 轮 meanScore 高于第 68 轮 budget baseline，但 p10Score 从 50.5527 降至 49.0773，combinedScore 也略低于当前 budget baseline 67.3701。不进入 full confirmation，不 commit。实验代码已回滚，仅保留 Eval 证据。

## 13. 第 70 轮顺序迭代

第 70 轮搜索方向：风险预算复用式 overlay 现金再分配。

搜索依据：第 63 轮组合下行波动目标化会把高风险状态下的暴露转为现金。第 70 轮测试一个不改变选股和周期的后处理：当 overlay 触发时，把被释放风险预算的一半回配给当前持仓中仍为正动量、低下行波动的多头资产，试图减少现金拖累。

Budget Eval：

| 迭代 | 机制 | meanScore | p10Score | combinedScore | 决策 |
|---|---|---:|---:|---:|---|
| 70 | 风险预算复用式 overlay 现金再分配 | 74.1313 | 49.5062 | 66.7438 | discard |

结论：第 70 轮 meanScore、p10Score、combinedScore 均低于第 68 轮 budget baseline（74.5776 / 50.5527 / 67.3701），说明当前 Eval 下 overlay 释放出来的风险预算继续保留为现金更稳。不进入 full confirmation，不 commit。实验代码已回滚，仅保留 Eval 证据。

## 14. 第 71 轮顺序迭代

第 71 轮搜索方向：期货抵押品收益入账。

搜索依据：第 68 轮已经对显式现金权重按 base currency 无风险利率入账，但期货价格路径可能仍只反映价格收益。第 71 轮测试期货多空名义仓位背后的抵押现金收益是否也应进入收益路径。该方向不改变选股、排序、周期、权重和 overlay，只修正期货收益口径。

Budget Eval：

| 迭代 | 机制 | meanScore | p10Score | combinedScore | 决策 |
|---|---|---:|---:|---:|---|
| 71 | 期货抵押品收益入账 | 75.0740 | 51.6794 | 68.0556 | 进入 full confirmation |

Full confirmation：

| 指标 | 第 71 轮机制 |
|---|---:|
| caseCount | 600 |
| successCount | 600 |
| failureCount | 0 |
| meanScore | 76.2422 |
| p10Score | 54.2613 |
| p50Score | 79.8384 |
| p90Score | 94.7995 |
| combinedScore | 69.6479 |

结论：第 71 轮 budget 通过，但 full confirmation 低于第 68 轮默认机制 full baseline（mean 76.8205 / p10 56.0719 / combined 70.5959）。不提升默认机制，不 commit。实验代码已回滚，仅保留 Eval 证据。

## 15. 第 72 轮顺序迭代

第 72 轮搜索方向：现金机会成本调整的 excess-momentum 选择门槛。

搜索依据：第 68 轮证明现金不是零收益资产，因此信号端也可以把现金收益视为机会成本。第 72 轮测试将排名和多头过滤从原始动量改为超额动量（lookback momentum 减同区间 base currency cash return），避免持有跑不赢现金的弱正动量风险资产。

Budget Eval：

| 迭代 | 机制 | meanScore | p10Score | combinedScore | 决策 |
|---|---|---:|---:|---:|---|
| 72 | 现金机会成本 excess-momentum 门槛 | 74.3826 | 50.3066 | 67.1598 | discard |

结论：第 72 轮低于当前 budget baseline（mean 74.5776 / p10 50.5527 / combined 67.3701），不进入 full confirmation，不 commit。实验代码已回滚，仅保留 Eval 证据。连续未改进计数：4。

## 16. 第 73 轮顺序迭代

第 73 轮搜索方向：净额抵消后的 residual cash 入账。

搜索依据：当前默认机制已经对显式现金权重入账无风险收益，但 short sleeve 与 long sleeve 净额抵消后降低的实际名义持仓，按 fully funded 口径也应成为现金。该方向不改变信号、排序、权重和风险 overlay，只修正净额化后的剩余资本收益归属。

Budget Eval：

| 迭代 | 机制 | meanScore | p10Score | combinedScore | 决策 |
|---|---|---:|---:|---:|---|
| 73 | 净额 residual cash 入账 | 74.6236 | 50.6345 | 67.4269 | 进入 full confirmation |

Full confirmation：

| 指标 | 第 73 轮机制 |
|---|---:|
| caseCount | 600 |
| successCount | 600 |
| failureCount | 0 |
| meanScore | 76.8599 |
| p10Score | 56.0802 |
| p50Score | 80.4665 |
| p90Score | 94.5625 |
| combinedScore | 70.6260 |

结论：第 73 轮 full confirmation 小幅高于第 68 轮默认机制 full baseline（mean 76.8205 / p10 56.0719 / combined 70.5959），因此提升为当前默认机制并 commit。连续未改进计数重置为 0。

## 17. 最终结论

当前推荐保留的新机制为：

1. 保留上一版 best 中的 long-sleeve futures trend filter。
2. 将候选排序从原始动量改为 `momentum / downsideVolatility`。
3. 将 sleeve 权重从 inverse realized volatility 改为 inverse downside volatility。
4. 将 standing cash buffer 从 20% 提高到 25%。
5. 增加组合层下行波动目标化覆盖：合并后的 signed portfolio 近期下行波动过高时，进一步降低总风险暴露并转为现金。
6. 对现金权重按 base currency 无风险利率入账，默认使用 `riskFreeRates`。
7. 净额化后按 fully funded 口径将 residual capital 视为现金，并纳入现金收益路径。

相对 ADM V1 baseline：

| 指标 | 改善 |
|---|---:|
| meanScore | +18.3066 |
| p10Score | +28.8027 |
| combinedScore | +21.4554 |

相对第 68 轮 best：

| 指标 | 改善 |
|---|---:|
| meanScore | +0.0394 |
| p10Score | +0.0083 |
| combinedScore | +0.0301 |

研究解释：

- 下行波动调整排序比单纯追逐动量更能区分“上涨但回撤质量差”的标的，尤其提升 p10 tail cases。
- 下行波动反比权重进一步把风险预算从左尾更差的标的移开，full Eval 中 p10 从 48.8738 提高到 51.1093。
- 组合层下行波动目标化覆盖把风险控制从单资产推进到真实合并组合路径，full Eval 中 p10 从 51.1093 提高到 52.4746。
- 现金收益入账不改变风险暴露，但把高现金状态下的机会成本纳入收益路径，full Eval 中 p10 从 52.4746 提高到 56.0719。
- 净额 residual cash 入账进一步修正 fully funded 资本口径，提升幅度很小，但 full Eval 的 mean、p10 和 combined 均高于第 68 轮。
- 25% 现金缓冲进一步降低跨品种随机篮子中的尾部暴露，同时没有牺牲 meanScore。
- 单独的小幅变化保持带在非标准抽样中表现很好，但标准 full confirmation 不如第 45 轮稳健，因此没有进入最终默认机制。

## 18. 证据路径

- 标准 50 轮 budget sweep：`thoughts/shared/research/active-dual-momentum-eval/2026-05-28/autoresearch-iter11-60-mechanism-sweep-standard-cases/`
- 第 45 轮 full confirmation：`thoughts/shared/research/active-dual-momentum-eval/2026-05-28/autoresearch-full-iter45-downside-risk-larger-cash-standard-cases/`
- 默认机制 full Eval：`thoughts/shared/research/active-dual-momentum-eval/2026-05-28/autoresearch-full-final-default-downside-risk-25cash/`
- 追加 20 轮 budget sweep：`thoughts/shared/research/active-dual-momentum-eval/2026-05-28/autoresearch-iter62-81-searched-directions-budget/`
- 第 62 轮 full confirmation：`thoughts/shared/research/active-dual-momentum-eval/2026-05-28/autoresearch-full-iter62-default-downside-rank-risk-weight/`
- 第 63 轮 budget Eval：`thoughts/shared/research/active-dual-momentum-eval/2026-05-28/autoresearch-iter63-portfolio-downside-vol-target-budget/`
- 第 63 轮 full confirmation：`thoughts/shared/research/active-dual-momentum-eval/2026-05-28/autoresearch-full-iter63-portfolio-downside-vol-target/`
- 第 63 轮默认机制 full Eval：`thoughts/shared/research/active-dual-momentum-eval/2026-05-28/autoresearch-full-final-default-iter63-portfolio-downside-vol-target/`
- 第 64 轮 budget Eval：`thoughts/shared/research/active-dual-momentum-eval/2026-05-28/autoresearch-iter64-portfolio-downside-contribution-budget/`
- 第 65 轮 budget Eval：`thoughts/shared/research/active-dual-momentum-eval/2026-05-28/autoresearch-iter65-portfolio-downside-breadth-budget/`
- 第 66 轮 budget Eval：`thoughts/shared/research/active-dual-momentum-eval/2026-05-28/autoresearch-iter66-decay-penalty-budget/`
- 第 67 轮 budget Eval：`thoughts/shared/research/active-dual-momentum-eval/2026-05-28/autoresearch-iter67-portfolio-correlation-stress-budget/`
- 第 68 轮 budget Eval：`thoughts/shared/research/active-dual-momentum-eval/2026-05-28/autoresearch-iter68-cash-risk-free-return-budget/`
- 第 68 轮 full confirmation：`thoughts/shared/research/active-dual-momentum-eval/2026-05-28/autoresearch-full-iter68-cash-risk-free-return/`
- 第 68 轮默认机制 full Eval：`thoughts/shared/research/active-dual-momentum-eval/2026-05-28/autoresearch-full-final-default-iter68-cash-risk-free-return/`
- 第 69 轮 budget Eval：`thoughts/shared/research/active-dual-momentum-eval/2026-05-28/autoresearch-iter69-incumbent-selection-hysteresis-budget/`
- 第 70 轮 budget Eval：`thoughts/shared/research/active-dual-momentum-eval/2026-05-28/autoresearch-iter70-portfolio-risk-budget-reuse-budget/`
- 第 71 轮 budget Eval：`thoughts/shared/research/active-dual-momentum-eval/2026-05-28/autoresearch-iter71-futures-collateral-return-budget/`
- 第 71 轮 full confirmation：`thoughts/shared/research/active-dual-momentum-eval/2026-05-28/autoresearch-full-iter71-futures-collateral-return/`
- 第 72 轮 budget Eval：`thoughts/shared/research/active-dual-momentum-eval/2026-05-28/autoresearch-iter72-excess-cash-hurdle-rank-budget/`
- 第 73 轮 budget Eval：`thoughts/shared/research/active-dual-momentum-eval/2026-05-28/autoresearch-iter73-netted-residual-cash-return-budget/`
- 第 73 轮 full confirmation：`thoughts/shared/research/active-dual-momentum-eval/2026-05-28/autoresearch-full-iter73-netted-residual-cash-return/`
- 第 73 轮默认机制 full Eval：`thoughts/shared/research/active-dual-momentum-eval/2026-05-28/autoresearch-full-final-default-iter73-netted-residual-cash-return/`
- 迭代日志：`thoughts/shared/research/active-dual-momentum-eval/2026-05-28/autoresearch-mechanism-results.tsv`

## 19. 后续建议

下一轮机制研究可以优先围绕第 63 轮继续做三类验证：

- 在标准 cases 上评估交易成本和滑点压力。
- 用不同 random seed 做 out-of-sample robustness check。
- 单独研究现金缓冲是固定 25% 更好，还是由下行风险质量动态决定。
