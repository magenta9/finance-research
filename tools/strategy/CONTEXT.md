# Strategy Context

本上下文覆盖 `tools/strategy/` 下保留在仓库中的策略实现，以及与策略型 Skill 共享的领域语言。

## 领域术语

跨上下文共享术语见根目录 `CONTEXT-MAP.md`。

## 本上下文术语

**Active Dual Momentum GTAA**:
跨资产类别的双周期动量轮动策略，由 Short Momentum Sleeve（10 周）和 Long Momentum Sleeve（25 周）各 50% 权重组成，每个 sleeve 在候选池中按动量强度选择 Top K 标的。

**Dual Momentum（双动量）**:
组合 "相对动量"（池内排名选强弱）和 "绝对动量"（趋势过滤，只持有动量为正的标的）的框架，由 Gary Antonacci 提出。

**Sleeve（子策略）**:
Dual Momentum 策略中按不同回看周期独立运行的子组合；两个 sleeve 结果按固定权重合并。

**Momentum（动量 / RoC）**:
Rate of Change，计算公式为 `price[t] / price[t - lookbackWeeks] - 1`；用于对候选标的排序并选择 Top K。

**Absolute Momentum Filter（绝对动量过滤器）**:
只持有动量（RoC）大于零的入选标的；动量小于等于零的标的仓位进入现金（ETF）或被排除（期货）。

**Direction（方向）**:
期货持仓的多空方向，由 RoC 的符号决定：RoC > 0 → 做多；RoC < 0 → 做空；RoC = 0 → 平仓。

**Position Weight（持仓权重）**:
始终为正数，代表名义敞口比例（与 "signed weight" 不同，不携带方向信息）。

**Short Sleeve**: 双动量中回看周期较短的子策略，默认 10 周。

**Long Sleeve**: 双动量中回看周期较长的子策略，默认 25 周。

**Top K**: 每个 sleeve 在候选池中选择的标的数量，Short 和 Long 必须相等（可配置 3～5）。

**Nominal Equal Weight（名义等权）**:
期货和 ETF 在同一池子中按名义敞口等权分配，不按保证金或风险平价归一。组合总名义敞口可能超过 100%，杠杆率作为诊断指标报告。

**Mixed Pool（混合池）**:
ETF 和期货放在同一个候选池中统一做动量排序，不按资产类型分区排名。

**Cash Weight（现金权重）**:
ETF 被绝对动量过滤器排除时进入现金；现金不参与收益分配（默认为零），仅在持仓记录中展示占比。

**Reversal（反向切换）**:
期货从做多切换到做空，或从做空切换到做多；在回测中视为一笔平仓加一笔开仓，换手率和交易成本各计一次。

**Strategy Eval Framework（策略评价框架）**:
面向多个 Allocation Strategy 的离线评价框架，通过 `tools/strategy/allocation-engine` 的 `defaultAllocationStrategyRegistry` 注入策略执行；Python 入口为 `tools/strategy/eval/run_strategy_eval.py`，TS dispatch 为 `generic_eval_runner.ts`。候选资产、case 生成、评分和报告由 eval harness 负责，策略算法留在 allocation-engine registry；QuantDesk Desktop 作为同一 registry 的消费者。

**Eval Strategy Adapter（评价策略适配器）**:
eval 层的 TS 适配模块，将 `EvalRunRequest` 中的 case 与配置转换为 `StrategyExecutionContext`，调用 `AllocationStrategyHandler.run()`，再投影为统一 `EvalResultRow`。

**Desktop Asset Universe Snapshot（桌面资产池快照）**:
从当前 Desktop Tool 本地资产池导出的可复现标的清单，用作 Strategy Eval Framework 的候选资产输入；它反映导出时用户维护后的资产集合，而不是代码内置默认种子包。

**A+Bond Eval Universe（A 股与债券评价资产池）**:
Strategy Eval Framework 的首个候选资产范围，由 Desktop Asset Universe Snapshot 中 market 为 A 和 BOND 的标的组成，用于随机抽取 5、10、15、20 个标的的组合。

**EvalRunRequest（评价运行请求）**:
一次 eval 运行的统一输入契约，包含 assets、cases、pricesBySymbol、strategyRuns、defaultConstraints。

**Scoring Profile（评分配置）**:
eval 层的可配置评分口径，定义 metrics 权重、归一化 bounds、final score 分位权重，以及是否要求全部 case 成功才可比较。

**Configuration Strategy Eval（配置策略评价）**:
Strategy Eval Framework 的首个评价范围，覆盖 Desktop Tool 中的三种 Configuration Strategy：ERC、Inverse Volatility 和 Max Diversification；不包含 EWMAC Trend Following 或 Active Dual Momentum GTAA。

**Eval Final Score（评价最终得分）**:
Strategy Eval Framework 对一组 case 分数的汇总得分，默认公式为 `0.5 * p50Score + 0.25 * p10Score + 0.25 * p90Score`，其中 p90Score 表示 90% 分位值而不是最高 10% 样本均值。

**Eval Cell（评价单元）**:
Strategy Eval Framework 中由一个策略、一个标的数量、一个时间窗口和一个调仓频率共同定义的评价切片；A+Bond Configuration Strategy Eval 首版每个 Eval Cell 抽取 20 个唯一组合。

**Eval Case Score（单次评价分数）**:
Strategy Eval Framework 对单个回测 case 的分数，由 `ScoringProfile` 定义；Configuration 默认 expected return 40%、Sharpe 40%、最大回撤 10%、波动 10%，ADM preset 默认 Sharpe 50%、最大回撤 30%、波动 20%。

**Configuration Strategy Baseline（配置策略基准）**:
Configuration Strategy Eval 为 ERC、Inverse Volatility 和 Max Diversification 分别生成的基准结果；报告可以提供全局排行榜，但后续策略优化优先与同一策略自己的 baseline 比较。

**Eval Price Data Source（评价行情来源）**:
Strategy Eval Framework 的回测价格序列来源保持为 quant-data CLI；Desktop Asset Universe Snapshot 只提供候选资产清单，不作为行情缓存读取入口。

- Rotation Prism / 轮动三棱镜: 一套相对强弱分析框架，用长周期趋势过滤和短周期均值回复触发，判断一组双标的中当前应偏向哪一侧。
- Rotation Analysis Skill / 轮动分析 Skill: 面向 Agent 的分析型 Skill，报告双标的分析中的偏向对象、证据、信号等级和数据缺口，不给交易执行、仓位或订单建议。
- Rotation Pair / 轮动标的对: 明确输入的双标的分析对象，表达为 asset_a 相对 asset_b，而不是系统扫描出的候选池；用户输入顺序定义比值方向，即 asset_a 除以 asset_b。
- Rotation Report / 轮动分析报告: 有固定章节、面向人阅读的结构化分析输出，不是 JSON 契约。
- Rotation Prism Facets / 轮动三棱: 轮动三棱镜的三组观察面：比值及年线布林带、40 日收益差及年线、比值 RSI 及年线。
- Rotation Signal Grade / 轮动信号等级: A/B/C 分级；A级表示长周期趋势同向且短周期均值回复触发，B级表示长周期方向明确但短周期触发不佳，C级表示长周期证据矛盾或不明但短周期出现极值。
