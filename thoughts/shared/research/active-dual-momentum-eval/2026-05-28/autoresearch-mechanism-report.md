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

## 17. 第 74 轮顺序迭代

第 74 轮搜索方向：下行波动稀疏样本可信度收缩。

搜索依据：当前 best 高度依赖 downsideVol 排名和下行波动反比权重。第 74 轮测试当下跌样本太少时，将 downsideVol 向横截面中位下行波动收缩，避免低估风险的资产同时获得更高排名和更高权重。

Budget Eval：

| 迭代 | 机制 | meanScore | p10Score | combinedScore | 决策 |
|---|---|---:|---:|---:|---|
| 74 | 下行波动可信度收缩 | 74.2147 | 49.8005 | 66.8904 | discard |

结论：第 74 轮低于当前 budget baseline（mean 74.6236 / p10 50.6345 / combined 67.4269），不进入 full confirmation，不 commit。实验代码已回滚，仅保留 Eval 证据。连续未改进计数：1。

## 18. 第 75 轮顺序迭代

第 75 轮搜索方向：双周期同向确认过滤。

搜索依据：在趋势切换期，10 周与 25 周动量可能互相冲突。第 75 轮测试不改变任何周期，只要求每个 sleeve 已选仓位的方向被另一条既有动量周期确认；不确认则转现金。

Budget Eval：

| 迭代 | 机制 | meanScore | p10Score | combinedScore | 决策 |
|---|---|---:|---:|---:|---|
| 75 | 双周期同向确认过滤 | 72.8361 | 49.2996 | 65.7751 | discard |

结论：第 75 轮显著低于当前 budget baseline（mean 74.6236 / p10 50.6345 / combined 67.4269），不进入 full confirmation，不 commit。实验代码已回滚，仅保留 Eval 证据。连续未改进计数：2。

## 19. 第 76 轮顺序迭代

第 76 轮搜索方向：双 sleeve 共识仓位释放 standing cash buffer。

搜索依据：如果同一资产同时被 10 周和 25 周 sleeve 选中且合并后为多头，可能代表更高趋势置信度。第 76 轮测试仅对这类 `source: both` 多头释放 standing cash buffer，但保留组合下行波动 overlay。

Budget Eval：

| 迭代 | 机制 | meanScore | p10Score | combinedScore | 决策 |
|---|---|---:|---:|---:|---|
| 76 | 共识仓位释放 standing cash | 68.6486 | 42.4591 | 60.7918 | discard |

结论：第 76 轮显著低于当前 budget baseline，说明当前 Eval 中释放 standing cash buffer 会明显破坏第 68/73 轮形成的防守结构。不进入 full confirmation，不 commit。实验代码已回滚，仅保留 Eval 证据。连续未改进计数：3。

## 20. 第 77 轮顺序迭代

第 77 轮搜索方向：双 sleeve 同标的去重，不把同一趋势证据重复加杠杆。

搜索依据：10 周和 25 周 sleeve 不是两份完全独立的风险预算。同一资产被两个 sleeve 同向选中时，当前 merge 会把两份权重相加，等于重复计算同一个趋势证据。第 77 轮测试相反方向：同向重复预算不加仓，而是只保留较大权重，较小重复权重转为现金。

Budget Eval：

| 迭代 | 机制 | meanScore | p10Score | combinedScore | 决策 |
|---|---|---:|---:|---:|---|
| 77 | 同标的同向 sleeve 预算去重 | 81.9641 | 60.6761 | 75.5777 | 进入 full confirmation |

Full confirmation：

| 指标 | 第 77 轮机制 |
|---|---:|
| caseCount | 600 |
| successCount | 600 |
| failureCount | 0 |
| meanScore | 84.0880 |
| p10Score | 65.9341 |
| p50Score | 87.8353 |
| p90Score | 96.5418 |
| combinedScore | 78.6418 |

结论：第 77 轮显著高于第 73 轮默认机制 full baseline（mean 76.8599 / p10 56.0802 / combined 70.6260），提升为当前默认机制并 commit。连续未改进计数重置为 0。

## 21. 第 78 轮顺序迭代

第 78 轮搜索方向：同标的重复 sleeve 槽位向下递补。

搜索依据：第 77 轮证明同标的同向重复预算转现金有效。第 78 轮测试是否应把重复的 sleeve 槽位递补给下一个合格候选，以保留分散化趋势机会；若找不到递补，再退回第 77 轮转现金。

Budget Eval：

| 迭代 | 机制 | meanScore | p10Score | combinedScore | 决策 |
|---|---|---:|---:|---:|---|
| 78 | 重复 sleeve 槽位递补 | 80.3057 | 57.2828 | 73.3988 | discard |

结论：第 78 轮低于当前 budget baseline（mean 81.9641 / p10 60.6761 / combined 75.5777），说明第 77 轮中重复预算转现金优于向下递补次级候选。不进入 full confirmation，不 commit。实验代码已回滚，仅保留 Eval 证据。连续未改进计数：1。

## 22. 第 79 轮顺序迭代

第 79 轮搜索方向：风险退出后的预算冷却。

搜索依据：第 78 轮说明退出或重复释放出来的预算不应急着递补给次级候选。第 79 轮将这个逻辑扩展到调仓路径：当旧仓位消失或反向时，释放出来的风险预算本轮优先进入现金，不立刻喂给新开仓或增配仓。

Budget Eval：

| 迭代 | 机制 | meanScore | p10Score | combinedScore | 决策 |
|---|---|---:|---:|---:|---|
| 79 | 风险退出预算冷却 | 82.3529 | 64.0293 | 76.8558 | 进入 full confirmation |

Full confirmation：

| 指标 | 第 79 轮机制 |
|---|---:|
| caseCount | 600 |
| successCount | 600 |
| failureCount | 0 |
| meanScore | 84.7084 |
| p10Score | 66.1378 |
| p50Score | 88.8499 |
| p90Score | 96.7642 |
| combinedScore | 79.1372 |

结论：第 79 轮高于第 77 轮默认机制 full baseline（mean 84.0880 / p10 65.9341 / combined 78.6418），提升为当前默认机制并 commit。连续未改进计数重置为 0。

## 23. 评分函数重算基线

从第 80 轮开始，Eval 评分函数将 `sharpeCeiling` 从 1.0 调整为 2.0，其他配置不变。这个改动会降低高 Sharpe 样本的饱和速度，因此第 80 轮之后的分数只与新基线比较，不再与第 79 轮之前的旧评分分数直接比较。

新 budget baseline：

| 指标 | 当前默认机制 |
|---|---:|
| caseCount | 60 |
| successCount | 60 |
| failureCount | 0 |
| meanScore | 71.9568 |
| p10Score | 54.1614 |
| p50Score | 67.4219 |
| p90Score | 95.6739 |
| combinedScore | 66.6182 |

新 full baseline：

| 指标 | 当前默认机制 |
|---|---:|
| caseCount | 600 |
| successCount | 600 |
| failureCount | 0 |
| meanScore | 68.9448 |
| p10Score | 51.3899 |
| p50Score | 66.8944 |
| p90Score | 92.3321 |
| combinedScore | 63.6783 |

后续 budget 闸门同步使用用户指定的保护条件：meanScore 不低于当前 baseline 的 90%，p10Score 不低于当前 baseline 的 90%，且 combinedScore 高于当前 baseline。

## 24. 第 80 轮顺序迭代

第 80 轮搜索方向：跨资产多空抵消预算现金化。

搜索依据：第 77 和第 79 轮都指向同一个机制事实：低置信度或重复释放出来的风险预算更适合现金化。第 80 轮把这个逻辑推到组合层，当合并后同时存在多头与空头 gross exposure 时，将 `min(longGross, shortGross)` 对应的双边抵消预算按方向内权重比例同步削减，并把释放出来的名义风险预算转入现金，保留组合净方向但降低互相抵消的 gross exposure。

Budget Eval：

| 迭代 | 机制 | meanScore | p10Score | combinedScore | 决策 |
|---|---|---:|---:|---:|---|
| 80 | 跨多空抵消预算现金化 | 72.7483 | 54.8798 | 67.3877 | 进入 full confirmation |

Full confirmation：

| 指标 | 第 80 轮机制 |
|---|---:|
| caseCount | 600 |
| successCount | 600 |
| failureCount | 0 |
| meanScore | 74.9330 |
| p10Score | 55.8955 |
| p50Score | 73.2058 |
| p90Score | 96.5617 |
| combinedScore | 69.2218 |

结论：第 80 轮高于 Sharpe ceiling 2 新 full baseline（mean 68.9448 / p10 51.3899 / combined 63.6783），提升为当前默认机制并 commit。连续未改进计数重置为 0。

## 25. 第 81 轮顺序迭代

第 81 轮搜索方向：高相关同向风险预算去重并现金化。

搜索依据：第 77、79、80 轮持续证明“重复或低效率预算转现金”有效。第 81 轮处理另一类重复预算：不同标的名义分散，但在近期窗口内高度同向相关，实际可能是同一个风险因子的重复暴露。机制只在组合后处理层识别同方向高相关连通簇，将簇内 gross exposure 压缩到最大单仓权重，其余预算转现金。

Budget Eval：

| 迭代 | 机制 | meanScore | p10Score | combinedScore | 决策 |
|---|---|---:|---:|---:|---|
| 81 | 高相关同向预算去重 | 75.3479 | 55.2229 | 69.3104 | 进入 full confirmation |

Full confirmation：

| 指标 | 第 81 轮候选 | 第 81 轮默认路径 |
|---|---:|---:|
| caseCount | 600 | 600 |
| successCount | 600 | 600 |
| failureCount | 0 | 0 |
| meanScore | 75.6414 | 77.2767 |
| p10Score | 58.1620 | 58.9542 |
| p50Score | 73.7084 | 76.3414 |
| p90Score | 96.9836 | 96.9758 |
| combinedScore | 70.3976 | 71.7800 |

结论：第 81 轮候选 full 高于第 80 轮 full baseline（mean 74.9330 / p10 55.8955 / combined 69.2218），默认路径复核进一步提高到 combined 71.7800，因此提升为当前默认机制并 commit。连续未改进计数重置为 0。

## 26. 第 82 轮顺序迭代

第 82 轮搜索方向：方向感知 adverse volatility。

搜索依据：当前默认的 `downsideVolatility` 对多头风险定义合理，但对空头方向可能符号错配。第 82 轮测试空头侧使用 upside volatility 作为 adverse risk，多头仍使用 downside volatility；该方向不改变长短动量周期、候选补位、现金 buffer 或组合后处理机制。

Budget Eval：

| 迭代 | 机制 | meanScore | p10Score | combinedScore | 决策 |
|---|---|---:|---:|---:|---|
| 82 | 方向感知 adverse volatility | 75.5798 | 54.8533 | 69.3619 | 进入 full confirmation |

Full confirmation：

| 指标 | 第 82 轮机制 |
|---|---:|
| caseCount | 600 |
| successCount | 600 |
| failureCount | 0 |
| meanScore | 73.8113 |
| p10Score | 54.5244 |
| p50Score | 72.8180 |
| p90Score | 96.6174 |
| combinedScore | 68.0252 |

结论：第 82 轮 budget 小幅通过，但 full confirmation 低于第 81 轮当前默认机制 full baseline（mean 77.2767 / p10 58.9542 / combined 71.7800）。不提升默认机制，不 commit。实验代码已回滚，仅保留 Eval 证据。连续未改进计数：1。

## 27. 第 83 轮顺序迭代

第 83 轮搜索方向：相关性极性约束的跨多空抵消现金化。

搜索依据：第 80 轮的跨多空抵消现金化有效，但无条件压缩所有反向 gross exposure 可能过度防守。第 83 轮测试只对正相关的反向 long/short 持仓做抵消现金化，保留低相关或负相关反向持仓作为潜在分散来源。

Budget Eval：

| 迭代 | 机制 | meanScore | p10Score | combinedScore | 决策 |
|---|---|---:|---:|---:|---|
| 83 | 相关性极性约束跨多空抵消 | 75.3420 | 55.5105 | 69.3925 | 进入 full confirmation |

Full confirmation：

| 指标 | 第 83 轮机制 |
|---|---:|
| caseCount | 600 |
| successCount | 600 |
| failureCount | 0 |
| meanScore | 77.2543 |
| p10Score | 58.9250 |
| p50Score | 76.3169 |
| p90Score | 96.9758 |
| combinedScore | 71.7555 |

结论：第 83 轮 full confirmation 非常接近当前默认机制，但 combinedScore 仍低于第 81 轮 full baseline（71.7555 < 71.7800）。不提升默认机制，不 commit。实验代码已回滚，仅保留 Eval 证据。连续未改进计数：2。

## 28. 第 84 轮顺序迭代

第 84 轮搜索方向：新入选仓位一轮 probation cash。

搜索依据：第 79 轮风险退出预算冷却有效，说明调仓换手时释放出来的预算不宜立即再部署。第 84 轮从入场端测试同类思想：新入选或翻向仓位先观察一个 rebalance 周期，若下一轮仍同向入选才允许进入。

Budget Eval：

| 迭代 | 机制 | meanScore | p10Score | combinedScore | 决策 |
|---|---|---:|---:|---:|---|
| 84 | 新仓一轮 probation cash | 74.0907 | 50.6755 | 67.0661 | discard |

结论：修正后的第 84 轮低于当前 budget baseline（mean 75.3479 / p10 55.2229 / combined 69.3104），不进入 full confirmation，不 commit。实验代码已回滚，仅保留 Eval 证据。连续未改进计数：3。

## 29. 第 85 轮顺序迭代

第 85 轮搜索方向：高相关同向持仓替换，而不是现金化。

搜索依据：第 81 轮高相关同向预算去重有效，但直接现金化可能压低 mean/p50。第 85 轮测试在 sleeve 选择阶段跳过与已选同向候选高度相关的标的，并尝试顺延选择下一个低相关候选，目标是在保留风险去重的同时减少现金化。

Budget Eval：

| 迭代 | 机制 | meanScore | p10Score | combinedScore | 决策 |
|---|---|---:|---:|---:|---|
| 85 | 高相关同向候选顺延替换 | 76.3431 | 52.7740 | 69.2724 | discard |

结论：第 85 轮 meanScore 提升，但 p10Score 明显低于当前 baseline，combinedScore 也略低于当前 budget baseline（69.2724 < 69.3104）。不进入 full confirmation，不 commit。实验代码已回滚，仅保留 Eval 证据。连续未改进计数：4。

## 30. 第 86 轮顺序迭代

第 86 轮搜索方向：高相关同向簇代表资产保留。

搜索依据：第 81 轮证明高相关同向预算现金化有效，但按比例保留簇内所有碎片仓位可能留下多个同质表达。第 86 轮测试只保留高相关簇内当前权重最大的代表资产，簇内其余预算继续现金化。

Budget Eval：

| 迭代 | 机制 | meanScore | p10Score | combinedScore | 决策 |
|---|---|---:|---:|---:|---|
| 86 | 高相关簇代表资产保留 | 76.3154 | 55.0343 | 69.9311 | 进入 full confirmation |

Full confirmation：

| 指标 | 第 86 轮机制 |
|---|---:|
| caseCount | 600 |
| successCount | 600 |
| failureCount | 0 |
| meanScore | 78.2198 |
| p10Score | 58.7312 |
| p50Score | 77.4412 |
| p90Score | 97.1941 |
| combinedScore | 72.3732 |

结论：第 86 轮 full confirmation 高于第 81 轮当前默认机制 full baseline（combined 72.3732 > 71.7800），且 meanScore 提升。p10Score 略低于第 81 轮但满足 90% 保护条件，因此提升为当前默认机制并 commit。连续未改进计数重置为 0。

## 31. 第 87 轮顺序迭代

第 87 轮搜索方向：高相关同向簇内按风险调整动量选择代表资产。

搜索依据：第 86 轮证明高相关簇只保留一个代表有效，但最大权重代表偏向当前风险模型最防守的表达。第 87 轮测试在保持簇预算现金化不变的前提下，将代表选择改为簇内风险调整动量最高者。

Budget Eval：

| 迭代 | 机制 | meanScore | p10Score | combinedScore | 决策 |
|---|---|---:|---:|---:|---|
| 87 | 簇内风险调整动量代表 | 72.8972 | 51.0020 | 66.3286 | discard |

结论：第 87 轮显著低于当前 budget baseline（mean 76.3154 / p10 55.0343 / combined 69.9311），说明第 86 轮保留最大权重代表优于改选风险调整动量代表。不进入 full confirmation，不 commit。实验代码已回滚，仅保留 Eval 证据。连续未改进计数：1。

## 32. 第 88 轮顺序迭代

第 88 轮搜索方向：部分减仓预算冷却为现金。

搜索依据：第 79 轮只冷却完全退出或翻向释放的预算。第 88 轮补上另一个预算来源：同方向持仓仍保留但目标权重下降时，释放出来的部分减仓预算不立刻再部署给其他增仓，而是先进入现金。

Budget Eval：

| 迭代 | 机制 | meanScore | p10Score | combinedScore | 决策 |
|---|---|---:|---:|---:|---|
| 88 | 部分减仓预算冷却 | 76.4591 | 55.4206 | 70.1475 | 进入 full confirmation |

Full confirmation：

| 指标 | 第 88 轮机制 |
|---|---:|
| caseCount | 600 |
| successCount | 600 |
| failureCount | 0 |
| meanScore | 78.3425 |
| p10Score | 59.0348 |
| p50Score | 77.6323 |
| p90Score | 97.3012 |
| combinedScore | 72.5502 |

结论：第 88 轮 full confirmation 的 mean、p10、combined 均高于第 86 轮当前默认机制 full baseline（78.2198 / 58.7312 / 72.3732），提升为当前默认机制并 commit。连续未改进计数重置为 0。

## 33. 第 89 轮顺序迭代

第 89 轮搜索方向：趋势路径效率现金闸门。

搜索依据：当前默认机制已大量现金化重复、冲突和低效率预算，但候选选择阶段仍可能把单次跳变后横盘的伪趋势纳入组合。第 89 轮测试在 sleeve 入选后，用 lookback 区间的路径效率区分平滑趋势和折返噪声；若入选候选的路径效率低于本 sleeve 入选候选中位数，且不是第一名，则将该仓位转为现金。

Budget Eval：

| 迭代 | 机制 | meanScore | p10Score | combinedScore | 决策 |
|---|---|---:|---:|---:|---|
| 89 | 趋势路径效率现金闸门 | 73.7038 | 48.6656 | 66.1923 | discard |

结论：第 89 轮显著低于当前 budget baseline（mean 76.4591 / p10 55.4206 / combined 70.1475），说明在当前默认机制上继续按路径效率现金化候选会过度防守，尤其伤害 p10Score。不进入 full confirmation，不 commit。实验代码已回滚，仅保留 Eval 证据。连续未改进计数：1。

## 34. 第 90 轮顺序迭代

第 90 轮搜索方向：高相关簇代表资产的 incumbent stickiness。

搜索依据：第 86 轮证明高相关同向簇只保留一个代表资产有效，但代表资产如果在簇内频繁切换，可能更多反映横截面噪声而不是风险因子变化。第 90 轮测试在上一期同方向持仓仍属于当前高相关簇时，优先保留 incumbent 作为代表，否则沿用当前最大权重代表逻辑。

Budget Eval：

| 迭代 | 机制 | meanScore | p10Score | combinedScore | 决策 |
|---|---|---:|---:|---:|---|
| 90 | 高相关簇 incumbent 代表 | 71.9775 | 51.0758 | 65.7070 | discard |

结论：第 90 轮低于当前 budget baseline（mean 76.4591 / p10 55.4206 / combined 70.1475），说明在当前默认机制下保留上一期簇代表会拖慢有效切换，不如继续使用当前最大权重代表。不进入 full confirmation，不 commit。实验代码已回滚，仅保留 Eval 证据。连续未改进计数：2。

## 35. 第 91 轮顺序迭代

第 91 轮搜索方向：部分减仓后的再加仓冷却。

搜索依据：第 88 轮证明同方向部分减仓释放的预算不宜立即再部署。第 91 轮进一步测试：上一轮刚被同向部分减仓的老仓位，如果下一轮目标权重又要加回，则先保留上一轮实际权重，把 top-up 部分转现金，避免一降一加的横截面噪声。

Budget Eval：

| 迭代 | 机制 | meanScore | p10Score | combinedScore | 决策 |
|---|---|---:|---:|---:|---|
| 91 | 部分减仓后回补冷却 | 76.8025 | 55.3883 | 70.3782 | 进入 full confirmation |

Full confirmation：

| 指标 | 第 91 轮机制 |
|---|---:|
| caseCount | 600 |
| successCount | 600 |
| failureCount | 0 |
| meanScore | 74.9219 |
| p10Score | 53.9241 |
| p50Score | 74.0195 |
| p90Score | 96.9342 |
| combinedScore | 68.6226 |

结论：第 91 轮 budget 小幅通过，但 full confirmation 明显低于当前 full baseline（mean 78.3425 / p10 59.0348 / combined 72.5502）。不提升默认机制，不 commit。实验代码已回滚，仅保留 Eval 证据。连续未改进计数：3。

## 36. 第 92 轮顺序迭代

第 92 轮搜索方向：下行波动余量释放固定现金。

搜索依据：当前默认机制擅长把重复、冲突和降风险预算转为现金，但固定 25% cash buffer 可能在组合下行波动较低时过度防守。第 92 轮测试在组合下行波动低于已有 target 时释放一部分固定现金，高波动时仍保持原有防守。

Budget Eval：

| 迭代 | 机制 | meanScore | p10Score | combinedScore | 决策 |
|---|---|---:|---:|---:|---|
| 92 | 下行波动余量释放现金 | 74.6685 | 53.6808 | 68.3722 | discard |

结论：第 92 轮低于当前 budget baseline（mean 76.4591 / p10 55.4206 / combined 70.1475），说明当前 25% cash buffer 仍是有效防守结构；用低下行波动作为释放信号会增加暴露并伤害尾部稳定。不进入 full confirmation，不 commit。实验代码已回滚，仅保留 Eval 证据。连续未改进计数：4。

## 37. 第 93 轮顺序迭代

第 93 轮搜索方向：risk-exit / risk-trim 冷却先于跨多空抵消。

搜索依据：当前默认顺序先做跨多空 gross 抵消，再做退出与减仓预算冷却。第 93 轮测试调仓顺序是否影响预算归因：先将退出和减仓释放的预算冷却为现金，再压缩剩余的跨多空抵消 gross exposure。

Budget Eval：

| 迭代 | 机制 | meanScore | p10Score | combinedScore | 决策 |
|---|---|---:|---:|---:|---|
| 93 | 冷却先于多空抵消 | 76.3337 | 55.8221 | 70.1802 | 进入 full confirmation |

Full confirmation：

| 指标 | 第 93 轮机制 |
|---|---:|
| caseCount | 600 |
| successCount | 600 |
| failureCount | 0 |
| meanScore | 75.6902 |
| p10Score | 56.6885 |
| p50Score | 74.7826 |
| p90Score | 96.1847 |
| combinedScore | 69.9897 |

结论：第 93 轮 budget 小幅通过，但 full confirmation 低于当前 full baseline（mean 78.3425 / p10 59.0348 / combined 72.5502）。当前默认“先多空抵消、后风险冷却”的顺序更稳。不提升默认机制，不 commit。实验代码已回滚，仅保留 Eval 证据。连续未改进计数：5。

## 38. 第 94 轮顺序迭代

第 94 轮搜索方向：关闭第 88 轮部分减仓预算冷却的消融验证。

搜索依据：第 88 轮是最近一次成功提升，但 full 增益较小；第 89-93 轮新增机制连续失败后，有必要验证第 88 轮机制在当前完整栈中是否仍有独立贡献。第 94 轮只关闭 `riskTrimRedeploymentCooldown`，其余默认机制保持不变。

Budget Eval：

| 迭代 | 机制 | meanScore | p10Score | combinedScore | 决策 |
|---|---|---:|---:|---:|---|
| 94 | 关闭部分减仓预算冷却 | 76.3154 | 55.0343 | 69.9311 | discard |

结论：第 94 轮低于当前 budget baseline（mean 76.4591 / p10 55.4206 / combined 70.1475），说明第 88 轮的部分减仓预算冷却在当前机制栈中仍有独立贡献，应继续保留。不进入 full confirmation，不 commit。实验候选已移除，仅保留 Eval 证据。连续未改进计数：6。

## 39. 第 95 轮顺序迭代

第 95 轮搜索方向：关闭高相关同向簇代表资产保留的消融验证。

搜索依据：第 86 轮的代表资产机制和第 81 轮的相关预算去重语义接近；在第 88 轮 partial trim cooldown 加入后，需要验证代表资产层是否仍有独立贡献。第 95 轮只关闭 `correlatedSameDirectionClusterRepresentative`，保留相关预算去重和其余默认机制。

Budget Eval：

| 迭代 | 机制 | meanScore | p10Score | combinedScore | 决策 |
|---|---|---:|---:|---:|---|
| 95 | 关闭高相关簇代表资产 | 75.4260 | 55.0409 | 69.3105 | discard |

结论：第 95 轮低于当前 budget baseline（mean 76.4591 / p10 55.4206 / combined 70.1475），说明第 86 轮代表资产保留仍有独立贡献，关闭后会留下更多高相关碎片仓位并拖累 combinedScore。不进入 full confirmation，不 commit。实验候选已移除，仅保留 Eval 证据。连续未改进计数：7。

## 40. 第 96 轮顺序迭代

第 96 轮搜索方向：关闭高相关同向预算去重的消融验证。

搜索依据：第 95 轮证明簇代表资产保留仍有价值后，第 96 轮验证更底层的相关预算去重是否仍不可替代。该实验只关闭 `correlatedSameDirectionBudgetDedup`，保留其余默认机制。

Budget Eval：

| 迭代 | 机制 | meanScore | p10Score | combinedScore | 决策 |
|---|---|---:|---:|---:|---|
| 96 | 关闭高相关同向预算去重 | 72.8619 | 55.4491 | 67.6381 | discard |

结论：第 96 轮 meanScore 和 combinedScore 显著低于当前 budget baseline（mean 76.4591 / p10 55.4206 / combined 70.1475），说明相关预算去重是当前机制栈的必要底座，不能只靠簇代表资产或后续冷却替代。不进入 full confirmation，不 commit。实验候选已移除，仅保留 Eval 证据。连续未改进计数：8。

## 41. 第 97 轮顺序迭代

第 97 轮搜索方向：关闭跨多空抵消预算现金化的消融验证。

搜索依据：第 93 轮验证了风险冷却与跨多空抵消的顺序，但没有验证 `crossSignOffsetCash` 本身在当前完整栈中是否仍有独立贡献。第 97 轮只关闭该机制，其余默认机制保持不变。

Budget Eval：

| 迭代 | 机制 | meanScore | p10Score | combinedScore | 决策 |
|---|---|---:|---:|---:|---|
| 97 | 关闭跨多空抵消现金化 | 75.5619 | 54.4444 | 69.2266 | discard |

结论：第 97 轮低于当前 budget baseline（mean 76.4591 / p10 55.4206 / combined 70.1475），说明跨多空抵消预算现金化仍能降低低效率 gross exposure。关闭后 p10 和 combined 均回落。不进入 full confirmation，不 commit。实验候选已移除，仅保留 Eval 证据。连续未改进计数：9。

## 42. 第 98 轮顺序迭代

第 98 轮搜索方向：关闭风险退出预算冷却的消融验证。

搜索依据：第 94 轮证明部分减仓预算冷却仍有贡献后，第 98 轮验证第 79 轮的完全退出或翻向预算冷却是否仍是当前完整栈的必要组件。该实验只关闭 `riskExitRedeploymentCooldown`。

Budget Eval：

| 迭代 | 机制 | meanScore | p10Score | combinedScore | 决策 |
|---|---|---:|---:|---:|---|
| 98 | 关闭风险退出预算冷却 | 75.9003 | 53.3844 | 69.1455 | discard |

结论：第 98 轮低于当前 budget baseline（mean 76.4591 / p10 55.4206 / combined 70.1475），尤其 p10Score 明显回落，说明退出或翻向释放出的预算继续需要先冷却为现金。不进入 full confirmation，不 commit。实验候选已移除，仅保留 Eval 证据。连续未改进计数：10。

## 43. 第 99 轮顺序迭代

第 99 轮搜索方向：关闭同资产双 sleeve 预算去重的消融验证。

搜索依据：第 94-98 轮已确认后段现金化/冷却机制仍有贡献。第 99 轮验证更早的同资产双 sleeve 预算去重是否仍是必要底座。该实验只关闭 `deduplicateSameAssetSleeveBudget`。

Budget Eval：

| 迭代 | 机制 | meanScore | p10Score | combinedScore | 决策 |
|---|---|---:|---:|---:|---|
| 99 | 关闭同资产双 sleeve 去重 | 66.6527 | 47.9151 | 61.0314 | discard |

结论：第 99 轮显著低于当前 budget baseline（mean 76.4591 / p10 55.4206 / combined 70.1475），说明 10 周与 25 周同时选中同一资产时，重复预算必须转现金，后段相关去重和冷却机制无法完全补救该底层重复暴露。不进入 full confirmation，不 commit。实验候选已移除，仅保留 Eval 证据。连续未改进计数：11。

## 44. 第 100 轮顺序迭代

第 100 轮搜索方向：关闭 netted residual cash return 的现金口径审计。

搜索依据：第 94-99 轮证明核心结构不能轻易拆除后，第 100 轮检查当前 best 是否依赖 residual cash 的 fully funded 计息口径。该实验只关闭 `nettedResidualCashReturn`，保留显式 cash return。

Budget Eval：

| 迭代 | 机制 | meanScore | p10Score | combinedScore | 决策 |
|---|---|---:|---:|---:|---|
| 100 | 关闭 residual cash 计息 | 76.3860 | 55.4206 | 70.0964 | discard |

结论：第 100 轮非常接近但仍低于当前 budget baseline（combined 70.0964 < 70.1475），说明 residual cash 计息贡献很小但为正；当前第 88 轮 best 不是主要依赖该现金口径获得提升。不进入 full confirmation，不 commit。实验候选已移除，仅保留 Eval 证据。连续未改进计数：12。

## 45. 第 101 轮顺序迭代

第 101 轮搜索方向：关闭全部现金收益入账的口径消融。

搜索依据：第 100 轮只关闭 residual cash 计息后结果几乎贴近基线，第 101 轮进一步验证显式现金无风险收益是否是当前完整机制栈的重要收益假设。该实验设置 `cashReturnMode = zero`，其余默认机制保持不变。

Budget Eval：

| 迭代 | 机制 | meanScore | p10Score | combinedScore | 决策 |
|---|---|---:|---:|---:|---|
| 101 | 关闭现金收益入账 | 71.9347 | 48.7886 | 64.9909 | discard |

结论：第 101 轮显著低于当前 budget baseline（mean 76.4591 / p10 55.4206 / combined 70.1475），说明当前大量现金化机制必须把现金视为有收益资产，现金收益入账是当前策略口径的必要组成。不进入 full confirmation，不 commit。实验候选已移除，仅保留 Eval 证据。连续未改进计数：13。

## 46. 第 102 轮顺序迭代

第 102 轮搜索方向：关闭组合下行波动目标 overlay 的消融验证。

搜索依据：第 63 轮引入的组合下行波动目标 overlay 是早期有效机制，但在后续多层去重、现金化和冷却加入后，可能存在边际冗余。第 102 轮只关闭 `portfolioDownsideVolTarget`，其余默认机制保持不变。

Budget Eval：

| 迭代 | 机制 | meanScore | p10Score | combinedScore | 决策 |
|---|---|---:|---:|---:|---|
| 102 | 关闭组合下行波动目标 | 76.3397 | 55.5929 | 70.1157 | discard |

结论：第 102 轮 p10Score 略高，但 meanScore 和 combinedScore 低于当前 budget baseline（combined 70.1157 < 70.1475），说明组合下行波动目标 overlay 的边际贡献很小但仍为正。不进入 full confirmation，不 commit。实验候选已移除，仅保留 Eval 证据。连续未改进计数：14。

## 47. 第 103 轮顺序迭代

第 103 轮搜索方向：关闭固定 25% standing cash buffer 的消融验证。

搜索依据：第 100-102 轮确认现金收益、residual cash 和组合下行波动 overlay 均有正贡献后，第 103 轮验证固定现金底仓是否仍不可替代。该实验设置 `cashBufferMultiplier = 1.0`，即取消默认 25% 固定现金缓冲。

Budget Eval：

| 迭代 | 机制 | meanScore | p10Score | combinedScore | 决策 |
|---|---|---:|---:|---:|---|
| 103 | 关闭固定现金缓冲 | 72.4996 | 50.2368 | 65.8208 | discard |

结论：第 103 轮显著低于当前 budget baseline（mean 76.4591 / p10 55.4206 / combined 70.1475），说明固定 25% standing cash buffer 仍是当前机制栈的核心防守件，动态去重、冷却和组合风险 overlay 无法替代其底仓作用。不进入 full confirmation，不 commit。实验候选已移除，仅保留 Eval 证据。连续未改进计数：15。

## 48. 第 104 轮顺序迭代

第 104 轮搜索方向：将 inverse downside-vol sleeve 权重消融为 equal weight。

搜索依据：第 62 轮引入下行波动反比权重后提升明显，但在当前完整机制栈中还需要验证其独立贡献。第 104 轮只设置 `riskMode = equalWeight`，其余默认机制保持不变。

Budget Eval：

| 迭代 | 机制 | meanScore | p10Score | combinedScore | 决策 |
|---|---|---:|---:|---:|---|
| 104 | 等权替代下行波动反比权重 | 70.1188 | 42.8297 | 61.9321 | discard |

结论：第 104 轮显著低于当前 budget baseline（mean 76.4591 / p10 55.4206 / combined 70.1475），尤其 p10Score 大幅回落，说明 inverse downside-volatility weighting 仍是当前机制栈的重要风险分配组件。不进入 full confirmation，不 commit。实验候选已移除，仅保留 Eval 证据。连续未改进计数：16。

## 49. 第 105 轮顺序迭代

第 105 轮搜索方向：将 downside-risk adjusted rank 消融为原始动量排序。

搜索依据：第 104 轮证明风险权重层不可替代后，第 105 轮验证候选排序层的下行风险调整是否仍有独立贡献。该实验只设置 `rankMode = default`，其余默认机制保持不变。

Budget Eval：

| 迭代 | 机制 | meanScore | p10Score | combinedScore | 决策 |
|---|---|---:|---:|---:|---|
| 105 | 原始动量排序替代下行风险排序 | 74.4555 | 52.4598 | 67.8568 | discard |

结论：第 105 轮低于当前 budget baseline（mean 76.4591 / p10 55.4206 / combined 70.1475），说明排序层的 downside-risk adjustment 与权重层的 inverse downside-volatility 不是冗余关系，二者共同改善候选质量与尾部稳定。不进入 full confirmation，不 commit。实验候选已移除，仅保留 Eval 证据。连续未改进计数：17。

## 50. 第 106 轮顺序迭代

第 106 轮搜索方向：用 drawdown penalty rank 替代 downside-risk adjusted rank。

搜索依据：第 105 轮 raw momentum rank 失败后，第 106 轮测试另一种趋势质量排序：保留动量信号，但用 lookback 最大回撤惩罚候选，而不是用 downside volatility 做分母。

Budget Eval：

| 迭代 | 机制 | meanScore | p10Score | combinedScore | 决策 |
|---|---|---:|---:|---:|---|
| 106 | 回撤惩罚排序 | 74.1498 | 51.4548 | 67.3413 | discard |

结论：第 106 轮低于当前 budget baseline（mean 76.4591 / p10 55.4206 / combined 70.1475），说明在当前机制栈中，downside volatility 比最大回撤更适合作为候选排序的风险质量度量。不进入 full confirmation，不 commit。连续未改进计数：18。

## 51. 第 107 轮顺序迭代

第 107 轮搜索方向：用 realized-vol risk-adjusted rank 替代 downside-risk adjusted rank。

搜索依据：第 105 轮 raw momentum rank 和第 106 轮 drawdown penalty rank 均失败后，第 107 轮保留“动量除以风险”的结构，但把 downside volatility 换成 total realized volatility。

Budget Eval：

| 迭代 | 机制 | meanScore | p10Score | combinedScore | 决策 |
|---|---|---:|---:|---:|---|
| 107 | realized-vol risk-adjusted rank | 74.6490 | 50.7886 | 67.4909 | discard |

结论：第 107 轮低于当前 budget baseline（mean 76.4591 / p10 55.4206 / combined 70.1475），说明排序层用 total realized volatility 会过度惩罚上行波动并弱化尾部稳定，仍不如 downside volatility 排序。不进入 full confirmation，不 commit。连续未改进计数：19。

## 52. 第 108 轮顺序迭代

第 108 轮搜索方向：小幅目标权重变化保持带。

搜索依据：第 105-107 轮连续证明排序口径替换不是有效方向，最后一轮转向执行噪声抑制：当目标权重变化小于固定候选带宽时，保持旧仓位，避免微小权重抖动触发换仓、减仓和冷却链条。

Budget Eval：

| 迭代 | 机制 | meanScore | p10Score | combinedScore | 决策 |
|---|---|---:|---:|---:|---|
| 108 | 小幅变化保持带 | 76.3988 | 53.2939 | 69.4673 | discard |

结论：第 108 轮低于当前 budget baseline（mean 76.4591 / p10 55.4206 / combined 70.1475），尤其 p10Score 明显回落，说明在当前第 88 轮机制栈下，额外忽略小幅调仓会延迟有效风险调整。不进入 full confirmation，不 commit。连续未改进计数：20，达到停止条件。

## 53. 停止条件与当前基线

从第 89 轮到第 108 轮，连续 20 次顺序迭代均未发现高于第 88 轮 baseline 的机制。按用户设定的停止条件，当前 autoresearch 循环停止。

当前保留基线仍为第 88 轮：

| Eval | meanScore | p10Score | p50Score | p90Score | combinedScore |
|---|---:|---:|---:|---:|---:|
| Budget | 76.4591 | 55.4206 | 74.0059 | 97.1192 | 70.1475 |
| Full | 78.3425 | 59.0348 | 77.6323 | 97.3012 | 72.5502 |

第 89-108 轮的主要结论：

- 继续新增现金闸门、簇代表切换、回补冷却、现金释放或调仓顺序改造，均没有超过第 88 轮。
- 逐项消融表明第 88 轮当前机制栈中的关键组件大多仍有独立贡献，尤其同资产 sleeve 去重、相关预算去重、固定现金缓冲、现金收益入账、下行风险排序和下行波动反比权重。
- 少数边际较小但仍为正的组件包括 residual cash return 和组合下行波动目标 overlay；二者 budget 结果接近基线但没有超过基线。

## 54. 最终结论

当前推荐保留的新机制为：

1. 保留上一版 best 中的 long-sleeve futures trend filter。
2. 将候选排序从原始动量改为 `momentum / downsideVolatility`。
3. 将 sleeve 权重从 inverse realized volatility 改为 inverse downside volatility。
4. 将 standing cash buffer 从 20% 提高到 25%。
5. 增加组合层下行波动目标化覆盖：合并后的 signed portfolio 近期下行波动过高时，进一步降低总风险暴露并转为现金。
6. 对现金权重按 base currency 无风险利率入账，默认使用 `riskFreeRates`。
7. 净额化后按 fully funded 口径将 residual capital 视为现金，并纳入现金收益路径。
8. 当两个 sleeve 同向选中同一资产时，只保留较大 sleeve 权重，重复预算转现金，避免把同一趋势证据重复加杠杆。
9. 旧仓位退出或反向时，将对应退出预算在本轮调仓先冷却为现金，避免立即再部署给新开仓或增配仓。
10. 当组合层同时持有多头和空头 gross exposure 时，压缩互相抵消的双边预算并转入现金，保留净方向但降低低效率 gross exposure。
11. 同方向持仓若在近期窗口内高度相关，将相关簇预算压缩到最大单仓权重，其余预算转现金，降低伪分散暴露。
12. 对高相关同向簇只保留当前最大权重代表资产，簇内其余碎片仓位继续现金化，减少同质仓位残留。
13. 同方向部分减仓释放出的预算也先冷却为现金，避免降风险信号被立刻再部署成横截面追涨。

相对 ADM V1 baseline：

| 指标 | 改善 |
|---|---:|
| meanScore | +26.1551 |
| p10Score | +38.8603 |
| combinedScore | +29.9666 |

相对第 77 轮 best：

| 指标 | 改善 |
|---|---:|
| meanScore | +0.6204 |
| p10Score | +0.2037 |
| combinedScore | +0.4954 |

Sharpe ceiling 2 新评分口径下，第 88 轮相对重算 full baseline：

| 指标 | 改善 |
|---|---:|
| meanScore | +9.3977 |
| p10Score | +7.6449 |
| combinedScore | +8.8719 |

研究解释：

- 下行波动调整排序比单纯追逐动量更能区分“上涨但回撤质量差”的标的，尤其提升 p10 tail cases。
- 下行波动反比权重进一步把风险预算从左尾更差的标的移开，full Eval 中 p10 从 48.8738 提高到 51.1093。
- 组合层下行波动目标化覆盖把风险控制从单资产推进到真实合并组合路径，full Eval 中 p10 从 51.1093 提高到 52.4746。
- 现金收益入账不改变风险暴露，但把高现金状态下的机会成本纳入收益路径，full Eval 中 p10 从 52.4746 提高到 56.0719。
- 净额 residual cash 入账进一步修正 fully funded 资本口径，提升幅度很小，但 full Eval 的 mean、p10 和 combined 均高于第 68 轮。
- 同标的同向 sleeve 预算去重是第 77 轮最大新增改善，说明当前 ADM 的 10 周和 25 周共识更适合作为确认信号，而不是重复加仓信号。
- 风险退出预算冷却进一步验证了“释放出来的预算先现金化”优于立即再部署，full Eval 的 mean、p10 和 combined 均继续改善。
- 跨多空抵消预算现金化说明低净敞口不需要依赖高双边 gross exposure 实现；在新评分口径下，它显著改善 mean、p10 和 combined。
- 高相关同向预算去重进一步降低了伪分散风险，在默认 full Eval 中把 p10Score 从 55.8955 提升到 58.9542。
- 高相关簇代表资产保留提升了 meanScore 和 combinedScore，说明第 81 轮的相关簇保留方式仍有碎片化拖累。
- 部分减仓预算冷却继续提升了 mean、p10 和 combined，说明“降风险释放的预算先现金化”不仅适用于退出，也适用于同向减仓。
- 25% 现金缓冲进一步降低跨品种随机篮子中的尾部暴露，同时没有牺牲 meanScore。
- 单独的小幅变化保持带在非标准抽样中表现很好，但标准 full confirmation 不如第 45 轮稳健，因此没有进入最终默认机制。

## 55. 证据路径

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
- 第 74 轮 budget Eval：`thoughts/shared/research/active-dual-momentum-eval/2026-05-28/autoresearch-iter74-downside-vol-credibility-shrink-budget/`
- 第 75 轮 budget Eval：`thoughts/shared/research/active-dual-momentum-eval/2026-05-28/autoresearch-iter75-dual-horizon-direction-confirm-budget/`
- 第 76 轮 budget Eval：`thoughts/shared/research/active-dual-momentum-eval/2026-05-28/autoresearch-iter76-consensus-standing-cash-release-budget/`
- 第 77 轮 budget Eval：`thoughts/shared/research/active-dual-momentum-eval/2026-05-28/autoresearch-iter77-deduplicate-same-asset-sleeve-budget/`
- 第 77 轮 full confirmation：`thoughts/shared/research/active-dual-momentum-eval/2026-05-28/autoresearch-full-iter77-deduplicate-same-asset-sleeve-budget/`
- 第 77 轮默认机制 full Eval：`thoughts/shared/research/active-dual-momentum-eval/2026-05-28/autoresearch-full-final-default-iter77-deduplicate-same-asset-sleeve-budget/`
- 第 78 轮 budget Eval：`thoughts/shared/research/active-dual-momentum-eval/2026-05-28/autoresearch-iter78-replace-duplicate-sleeve-slots-budget/`
- 第 79 轮 budget Eval：`thoughts/shared/research/active-dual-momentum-eval/2026-05-28/autoresearch-iter79-risk-exit-redeployment-cooldown-budget/`
- 第 79 轮 full confirmation：`thoughts/shared/research/active-dual-momentum-eval/2026-05-28/autoresearch-full-iter79-risk-exit-redeployment-cooldown/`
- 第 79 轮默认机制 full Eval：`thoughts/shared/research/active-dual-momentum-eval/2026-05-28/autoresearch-full-final-default-iter79-risk-exit-redeployment-cooldown/`
- Sharpe ceiling 2 新 budget baseline：`thoughts/shared/research/active-dual-momentum-eval/2026-05-28/autoresearch-baseline-iter79-sharpe-ceiling-2-budget/`
- Sharpe ceiling 2 新 full baseline：`thoughts/shared/research/active-dual-momentum-eval/2026-05-28/autoresearch-baseline-iter79-sharpe-ceiling-2-full/`
- 第 80 轮 budget Eval：`thoughts/shared/research/active-dual-momentum-eval/2026-05-28/autoresearch-iter80-cross-sign-offset-cash-budget/`
- 第 80 轮 full confirmation：`thoughts/shared/research/active-dual-momentum-eval/2026-05-28/autoresearch-full-iter80-cross-sign-offset-cash/`
- 第 80 轮默认机制 full Eval：`thoughts/shared/research/active-dual-momentum-eval/2026-05-28/autoresearch-full-final-default-iter80-cross-sign-offset-cash/`
- 第 81 轮 budget Eval：`thoughts/shared/research/active-dual-momentum-eval/2026-05-28/autoresearch-iter81-correlated-same-direction-budget-dedup-budget/`
- 第 81 轮 full confirmation：`thoughts/shared/research/active-dual-momentum-eval/2026-05-28/autoresearch-full-iter81-correlated-same-direction-budget-dedup/`
- 第 81 轮默认机制 budget Eval：`thoughts/shared/research/active-dual-momentum-eval/2026-05-28/autoresearch-baseline-final-default-iter81-correlated-same-direction-budget-dedup/`
- 第 81 轮默认机制 full Eval：`thoughts/shared/research/active-dual-momentum-eval/2026-05-28/autoresearch-full-final-default-iter81-correlated-same-direction-budget-dedup/`
- 第 82 轮 budget Eval：`thoughts/shared/research/active-dual-momentum-eval/2026-05-28/autoresearch-iter82-direction-aware-adverse-volatility-budget/`
- 第 82 轮 full confirmation：`thoughts/shared/research/active-dual-momentum-eval/2026-05-28/autoresearch-full-iter82-direction-aware-adverse-volatility/`
- 第 83 轮 budget Eval：`thoughts/shared/research/active-dual-momentum-eval/2026-05-28/autoresearch-iter83-correlation-aware-cross-sign-offset-budget/`
- 第 83 轮 full confirmation：`thoughts/shared/research/active-dual-momentum-eval/2026-05-28/autoresearch-full-iter83-correlation-aware-cross-sign-offset/`
- 第 84 轮 budget Eval：`thoughts/shared/research/active-dual-momentum-eval/2026-05-28/autoresearch-iter84-entry-probation-cash-budget/`
- 第 85 轮 budget Eval：`thoughts/shared/research/active-dual-momentum-eval/2026-05-28/autoresearch-iter85-correlation-diversified-replacement-budget/`
- 第 86 轮 budget Eval：`thoughts/shared/research/active-dual-momentum-eval/2026-05-28/autoresearch-iter86-correlated-same-direction-cluster-representative-budget/`
- 第 86 轮 full confirmation：`thoughts/shared/research/active-dual-momentum-eval/2026-05-28/autoresearch-full-iter86-correlated-same-direction-cluster-representative/`
- 第 86 轮默认机制 budget Eval：`thoughts/shared/research/active-dual-momentum-eval/2026-05-28/autoresearch-baseline-final-default-iter86-correlated-same-direction-cluster-representative-rerun/`
- 第 86 轮默认机制 full Eval：`thoughts/shared/research/active-dual-momentum-eval/2026-05-28/autoresearch-full-final-default-iter86-correlated-same-direction-cluster-representative/`
- 第 87 轮 budget Eval：`thoughts/shared/research/active-dual-momentum-eval/2026-05-28/autoresearch-iter87-correlated-cluster-risk-adjusted-representative-budget/`
- 第 88 轮 budget Eval：`thoughts/shared/research/active-dual-momentum-eval/2026-05-28/autoresearch-iter88-risk-trim-redeployment-cooldown-budget/`
- 第 88 轮 full confirmation：`thoughts/shared/research/active-dual-momentum-eval/2026-05-28/autoresearch-full-iter88-risk-trim-redeployment-cooldown/`
- 第 88 轮默认机制 budget Eval：`thoughts/shared/research/active-dual-momentum-eval/2026-05-28/autoresearch-baseline-final-default-iter88-risk-trim-redeployment-cooldown/`
- 第 88 轮默认机制 full Eval：`thoughts/shared/research/active-dual-momentum-eval/2026-05-28/autoresearch-full-final-default-iter88-risk-trim-redeployment-cooldown-rerun/`
- 第 89 轮 budget Eval：`thoughts/shared/research/active-dual-momentum-eval/2026-05-28/autoresearch-iter89-trend-efficiency-cash-gate-budget/`
- 第 90 轮 budget Eval：`thoughts/shared/research/active-dual-momentum-eval/2026-05-28/autoresearch-iter90-correlated-cluster-incumbent-representative-budget/`
- 第 91 轮 budget Eval：`thoughts/shared/research/active-dual-momentum-eval/2026-05-28/autoresearch-iter91-risk-trim-reentry-cooldown-budget/`
- 第 91 轮 full confirmation：`thoughts/shared/research/active-dual-momentum-eval/2026-05-28/autoresearch-full-iter91-risk-trim-reentry-cooldown/`
- 第 92 轮 budget Eval：`thoughts/shared/research/active-dual-momentum-eval/2026-05-28/autoresearch-iter92-downside-vol-headroom-cash-release-budget/`
- 第 93 轮 budget Eval：`thoughts/shared/research/active-dual-momentum-eval/2026-05-28/autoresearch-iter93-risk-cooldown-before-cross-sign-offset-budget/`
- 第 93 轮 full confirmation：`thoughts/shared/research/active-dual-momentum-eval/2026-05-28/autoresearch-full-iter93-risk-cooldown-before-cross-sign-offset/`
- 第 94 轮 budget Eval：`thoughts/shared/research/active-dual-momentum-eval/2026-05-29/autoresearch-iter94-ablate-risk-trim-redeployment-cooldown-budget/`
- 第 95 轮 budget Eval：`thoughts/shared/research/active-dual-momentum-eval/2026-05-29/autoresearch-iter95-ablate-correlated-cluster-representative-budget/`
- 第 96 轮 budget Eval：`thoughts/shared/research/active-dual-momentum-eval/2026-05-29/autoresearch-iter96-ablate-correlated-same-direction-budget-dedup-budget/`
- 第 97 轮 budget Eval：`thoughts/shared/research/active-dual-momentum-eval/2026-05-29/autoresearch-iter97-ablate-cross-sign-offset-cash-budget/`
- 第 98 轮 budget Eval：`thoughts/shared/research/active-dual-momentum-eval/2026-05-29/autoresearch-iter98-ablate-risk-exit-redeployment-cooldown-budget/`
- 第 99 轮 budget Eval：`thoughts/shared/research/active-dual-momentum-eval/2026-05-29/autoresearch-iter99-ablate-deduplicate-same-asset-sleeve-budget-budget/`
- 第 100 轮 budget Eval：`thoughts/shared/research/active-dual-momentum-eval/2026-05-29/autoresearch-iter100-ablate-netted-residual-cash-return-budget/`
- 第 101 轮 budget Eval：`thoughts/shared/research/active-dual-momentum-eval/2026-05-29/autoresearch-iter101-ablate-cash-return-accrual-budget/`
- 第 102 轮 budget Eval：`thoughts/shared/research/active-dual-momentum-eval/2026-05-29/autoresearch-iter102-ablate-portfolio-downside-vol-target-budget/`
- 第 103 轮 budget Eval：`thoughts/shared/research/active-dual-momentum-eval/2026-05-29/autoresearch-iter103-ablate-standing-cash-buffer-budget/`
- 第 104 轮 budget Eval：`thoughts/shared/research/active-dual-momentum-eval/2026-05-29/autoresearch-iter104-ablate-inverse-downside-vol-weights-to-equal-budget/`
- 第 105 轮 budget Eval：`thoughts/shared/research/active-dual-momentum-eval/2026-05-29/autoresearch-iter105-ablate-downside-risk-rank-to-default-budget/`
- 第 106 轮 budget Eval：`thoughts/shared/research/active-dual-momentum-eval/2026-05-29/autoresearch-iter106-drawdown-penalty-rank-budget/`
- 第 107 轮 budget Eval：`thoughts/shared/research/active-dual-momentum-eval/2026-05-29/autoresearch-iter107-risk-adjusted-rank-budget/`
- 第 108 轮 budget Eval：`thoughts/shared/research/active-dual-momentum-eval/2026-05-29/autoresearch-iter108-small-change-hold-band-budget/`
- 迭代日志：`thoughts/shared/research/active-dual-momentum-eval/2026-05-28/autoresearch-mechanism-results.tsv`

## 56. 后续建议

下一轮机制研究可以优先围绕第 63 轮继续做三类验证：

- 在标准 cases 上评估交易成本和滑点压力。
- 用不同 random seed 做 out-of-sample robustness check。
- 单独研究现金缓冲是固定 25% 更好，还是由下行风险质量动态决定。
