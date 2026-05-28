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

## 33. 最终结论

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

## 34. 证据路径

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
- 迭代日志：`thoughts/shared/research/active-dual-momentum-eval/2026-05-28/autoresearch-mechanism-results.tsv`

## 35. 后续建议

下一轮机制研究可以优先围绕第 63 轮继续做三类验证：

- 在标准 cases 上评估交易成本和滑点压力。
- 用不同 random seed 做 out-of-sample robustness check。
- 单独研究现金缓冲是固定 25% 更好，还是由下行风险质量动态决定。
