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

- Rotation Prism / 轮动三棱镜: 一套相对强弱分析框架，用长周期趋势过滤和短周期均值回复触发，判断一组双标的中当前应偏向哪一侧。
- Rotation Analysis Skill / 轮动分析 Skill: 面向 Agent 的分析型 Skill，报告双标的分析中的偏向对象、证据、信号等级和数据缺口，不给交易执行、仓位或订单建议。
- Rotation Pair / 轮动标的对: 明确输入的双标的分析对象，表达为 asset_a 相对 asset_b，而不是系统扫描出的候选池；用户输入顺序定义比值方向，即 asset_a 除以 asset_b。
- Rotation Report / 轮动分析报告: 有固定章节、面向人阅读的结构化分析输出，不是 JSON 契约。
- Rotation Prism Facets / 轮动三棱: 轮动三棱镜的三组观察面：比值及年线布林带、40 日收益差及年线、比值 RSI 及年线。
- Rotation Signal Grade / 轮动信号等级: A/B/C 分级；A级表示长周期趋势同向且短周期均值回复触发，B级表示长周期方向明确但短周期触发不佳，C级表示长周期证据矛盾或不明但短周期出现极值。
