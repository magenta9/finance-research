---
title: "Active Dual Momentum GTAA 策略回测"
status: needs-triage
created: 2026-05-27
labels:
  - dual-momentum-gtaa
  - strategy-backtest
---

## Problem Statement

QuantDesk 当前缺少一个面向"规则型轮动策略"的标准化回测工作流。用户只能查看单标的或组合指标，无法验证"某个标的池是否适合动量轮动"。资产配置引擎偏静态配置，无法表达"每周根据趋势切换资产"的动态策略。用户需要比较不同参数（10 周 vs 25 周、Top 3 vs Top 5、是否启用绝对动量过滤），但目前没有统一入口。

本次扩展在原有 PRD 基础上新增：支持 **ETF 与期货混合池**，期货可做多可做空，动量用绝对值排序，权重始终为正数且显式带方向字段。

## Solution

QuantDesk 新增「Active Dual Momentum GTAA 策略回测」能力。用户可以从本地标的池中选择 ETF 和/或期货资产，配置双动量策略参数，系统基于历史价格序列生成周度调仓结果，并输出收益率、夏普比率、最大回撤、Calmar、波动率、换手率等关键指标。

核心目标：把一个规则清晰、可复现、可对比的跨资产动量框架接入 QuantDesk，让用户能够快速回答：**如果我在这些标的上运行「相对动量 + 绝对动量过滤 + 双周期融合」策略，历史上表现如何？**

### 一句话定义

**Active Dual Momentum GTAA 策略回测器** 是 QuantDesk 内的一个规则型策略模块：用户选择标的池（ETF + 期货）→ 配置动量参数 → 运行历史回测 → 查看调仓、净值和风险收益指标。

### 功能边界

首版定位为 **研究与回测工具**，不是自动交易系统，不直接生成真实交易订单，也不承诺未来收益预测。

## User Stories

### 策略研究用户

1. 作为用户，我可以从本地标的池选择一组 ETF / 期货作为策略候选池，系统自动识别资产类型。
2. 作为用户，我可以使用默认 Active Dual Momentum GTAA 参数（10 周 / 25 周、Top 3、周度再平衡、绝对动量过滤）一键运行回测。
3. 作为用户，我可以修改 lookback、Top K、手续费、滑点等参数，再次运行并比较结果。
4. 作为用户，我可以看到策略净值曲线与等权基准曲线。
5. 作为用户，我可以看到年化收益、年化波动、夏普、最大回撤、Calmar、胜率、换手率等指标。
6. 作为用户，我可以查看每个再平衡日选择了哪些标的、各自名义敞口权重和多空方向是多少、哪些仓位进入现金。
7. 作为用户，我可以导出回测结果为 CSV 或保存为策略实验记录。

### 风控用户

8. 作为用户，我可以看到最大回撤发生区间。
9. 作为用户，我可以看到策略在不同年份的收益。
10. 作为用户，我可以看到现金仓位占比和平均风险暴露。
11. 作为用户，我可以看到期货名义敞口和净敞口，作为杠杆率诊断。
12. 作为用户，我可以看到交易成本对结果的影响。
13. 作为用户，我可以看到数据覆盖不足、样本太短、标的过少等风险提示。

### Pi / Agent 用户

14. 作为 Pi 用户，我可以用自然语言请求："用这些标的跑一下双动量 GTAA"。
15. Pi 调用同一策略回测接口，拿到结构化结果。
16. Pi 的回答必须基于结构化指标和回测结果，不凭空生成收益结论。
17. Pi 能解释策略参数、表现来源和主要风险。

### 开发者

18. 作为开发者，策略逻辑封装为独立 domain module，不绑定 UI。
19. 作为开发者，回测引擎、指标计算、调仓记录生成分别可测。
20. 作为开发者，UI 与 Pi 使用同一结构化请求/响应契约。
21. 作为开发者，首版复用本地价格缓存，不重新实现行情系统。

## Implementation Decisions

### 1. 双 Sleeve 结构

策略由两个子策略组成，各 50% 权重，独立运行后合并：

| 子策略 | 回看窗口 | Top K |
|--------|---------|-------|
| Short Sleeve | 10 周 | Top K（可配置 3～5，两个 sleeve 共享同一 K 值） |
| Long Sleeve | 25 周 | Top K（同上） |

每个子策略内部：
1. 在每个再平衡日，计算所有候选标的过去 `lookbackWeeks` 的 RoC。
2. **混合池统一排序**：ETF 和期货在同一池子里按动量强度统一排名，不分区。
3. 按 RoC 绝对值（期货）或 RoC（ETF）从高到低排序。
4. 选择前 `topK` 个标的。
5. 按绝对动量过滤器处理（见下节）。
6. 子策略内等权分配。
7. 两个子策略结果按 50% / 50% 合并。
8. 同一标的同时被两个 sleeve 选中时，权重相加。
9. 每个再平衡周期持有到下一个再平衡日。

### 2. 动量计算规则

```typescript
momentum = price[t] / price[t - lookbackWeeks] - 1
```

- `t` 是再平衡日。
- `lookbackWeeks` 以周度价格序列计算。
- 必须有完整 lookback 数据，否则该标的该期不可参与。
- 动量排序规则：

| 资产类型 | 排序依据 | 方向决定 |
|---------|---------|---------|
| ETF | RoC（原始值） | RoC > 0 → 做多；RoC ≤ 0 → 现金 |
| 期货 | \|RoC\|（绝对值） | RoC > 0 → 做多；RoC < 0 → 做空；RoC = 0 → 平仓 |

期货永远不会被过滤成现金（除非 RoC = 0，此时视为平仓）。

### 3. 绝对动量过滤器（分离逻辑）

ETF 和期货的过滤器行为完全分离：

**ETF 过滤器**：
- RoC > 0 → 持有
- RoC ≤ 0 → 该仓位进入现金（cashWeight）

**期货符号过滤器**：
- RoC > 0 → 做多
- RoC < 0 → 做空
- RoC = 0 → 平仓（0 持仓，不进现金）

### 4. 权重模型

**名义等权**：期货和 ETF 在同一池子里按名义敞口等权分配。组合总名义敞口可能超过 100%，杠杆率作为诊断指标报告。

**权重数据结构**：
```typescript
interface PositionWeight {
  weight: number;      // 始终为正数，名义敞口比例
  direction: 'long' | 'short';
}
```

**组合总权重不强制归一**：
- ETF 权重 + 期货多头权重 + 期货空头权重（正值）可能超过 100%
- 诊断指标报告：总名义敞口（权重绝对值之和）、净敞口（权重代数和）

**现金处理**：
- 现金权重不参与收益分配（默认 cashReturn = 0）
- 现金仅来自 ETF 被过滤器排除时
- 期货没有现金等价物

### 5. 再平衡规则

- 频率：每周（周三收盘价生成下期持仓）
- 周三无价格：使用该周周三之前最近一个交易日价格
- 持仓从下一个交易日生效（无未来函数）
- 收益计算：`portfolioReturn[t] = Σ weight_i[t-1] × direction_i × assetReturn_i[t]`

### 6. 交易成本

每次再平衡：
```typescript
turnover = Σ |newWeight_i - oldWeight_i|
transactionCost = turnover × transactionCostBps / 10000
slippageCost = turnover × slippageBps / 10000
netReturn = grossReturn - transactionCost - slippageCost
```

**期货反转处理**：期货从做多切换到做空，或从做空切换到做多，视为一笔平仓加一笔开仓，换手率和交易成本各计一次。

### 7. 数据契约

#### 请求接口

```typescript
interface ActiveDualMomentumBacktestRequest {
  assetIds: string[]
  startDate?: string
  endDate?: string
  benchmark?: BenchmarkConfig

  strategyParams: {
    rebalanceFrequency: 'weekly' | 'monthly'  // 首版固定 weekly
    rebalanceWeekday?: 'Wednesday'
    shortLookbackWeeks: number    // 默认 10
    longLookbackWeeks: number     // 默认 25
    topK: number                 // 默认 3，可配置 3～5
    sleeveWeights: { short: number; long: number }  // 默认各 0.5
    absoluteMomentumFilter: boolean  // 默认 true
    cashReturnMode: 'zero' | 'cash_asset'
    cashAssetId?: string
  }

  costParams: {
    transactionCostBps: number  // 默认 0
    slippageBps: number         // 默认 0
  }

  outputOptions?: {
    includeSleeveResults?: boolean
    includeTradeList?: boolean
    includeDailyHoldings?: boolean
  }
}
```

#### 响应接口（关键字段）

```typescript
interface RebalanceRecord {
  date: string
  holdings: Array<{
    assetId: string
    symbol: string
    weight: number              // 始终正数，名义敞口
    direction: 'long' | 'short' // 显式方向
    source: 'short' | 'long' | 'both'
    shortMomentum?: number
    longMomentum?: number
  }>
  cashWeight: number
  selectedButFiltered: Array<{
    assetId: string
    symbol: string
    reason: 'NEGATIVE_MOMENTUM'
    momentum: number
  }>
}

interface TradeRecord {
  date: string
  assetId: string
  symbol: string
  direction: 'long' | 'short'
  fromWeight: number   // 始终正数
  toWeight: number    // 始终正数
  deltaWeight: number  // 始终正数（开仓量）
  estimatedCost: number
}
```

### 8. 模块拆分

| 模块 | 职责 |
|------|------|
| StrategyConfigValidator | 校验参数、标的数量、日期区间、成本设置 |
| PriceMatrixBuilder | 从本地缓存读取 adjusted close，生成对齐后的价格矩阵 |
| RebalanceCalendarBuilder | 生成周度再平衡日历 |
| MomentumSignalEngine | 计算 short / long lookback 动量，ETF / 期货分别处理 |
| DualMomentumAllocator | 执行 Top K 选择、绝对动量过滤、sleeve 权重合并 |
| BacktestSimulator | 根据持仓序列生成每日净值、成本、交易记录 |
| PerformanceMetricsCalculator | 计算收益、波动、夏普、回撤、Calmar、胜率、换手率 |
| BenchmarkEngine | 生成等权 / 单标的 / 自定义基准净值 |
| ResultDiagnosticsEngine | 生成数据覆盖、杠杆率、风险提示 |
| StrategyBacktestFacade | 对 UI 和 Pi 暴露统一入口 |

### 9. 现有代码存量改造

本次改动连带改造现有代码中的权重表示，统一数据结构：

| 文件 | 改动内容 |
|------|---------|
| `statistics.ts` | `computeRiskContributions`、`portfolioReturn` 等函数支持带方向字段的持仓权重 |
| `trend-following.ts` | `positionWeights` 从 signed weight 改为 `{ weight: number, direction: 'long' | 'short' }`；`buildSlotWeights` 输出正权重，方向由 forecast 符号决定 |
| `allocation-result-assembler.ts` | `effectiveWeights` 改为数组形式的带方向持仓；传递给下游的数据结构加 `direction` 字段 |
| `domain.ts`（shared） | `AllocationAssetWeight.weight` 始终为正；新增 `direction: 'long' \| 'short'` 字段；`AllocationTrade` 相关字段同样处理 |

### 10. 默认参数

| 参数 | 默认值 | 说明 |
|------|-------|------|
| rebalanceFrequency | weekly | 固定周三 |
| shortLookbackWeeks | 10 | |
| longLookbackWeeks | 25 | |
| topK | 3 | 可配置 3～5 |
| absoluteMomentumFilter | true | |
| cashReturnMode | zero | |
| transactionCostBps | 0 | UI 必须允许输入 |
| slippageBps | 0 | UI 必须允许输入 |

### 11. 降级与错误状态

- **ok**：至少 3 个合格标的，回测区间覆盖至少 2 年，所有核心指标可计算
- **degraded**：部分标的历史数据不足；回测区间少于 2 年；部分再平衡日存在缺失价格
- **unavailable**：合格标的少于 3 个；最大 lookback 后可回测区间少于 26 周；没有可用价格数据；参数非法

### 12. 期货 Roll 处理

用户使用主连合约，价格序列已处理好（roll 由 quant-data 或用户提供方在入仓前完成）。回测引擎直接使用传入的连续价格序列，不处理 roll 逻辑。

## Testing Decisions

### Domain 模块测试

| 测试对象 | 验收点 |
|---------|--------|
| MomentumSignalEngine | 给定固定价格序列，ETF RoC 和期货 \|RoC\| 计算正确；排序结果正确 |
| AbsoluteMomentumFilter | ETF 负 RoC 入现金；期货负 RoC 出做空方向 |
| DirectionAssignment | RoC > 0 → long；RoC < 0 → short；RoC = 0 → 平仓 |
| SleeveMerge | 同一标的被 short/long 同时选中时权重正确相加 |
| BacktestSimulator | 持仓从下一个交易日生效，无未来函数；期货反转计两次换手 |
| CostModel | 换手率和成本扣减正确；反转时交易成本 × 2 |
| MetricsCalculator | 收益、波动、夏普、回撤与基准实现一致 |
| PositiveWeightInvariant | 所有输出中 `weight >= 0`；方向由 `direction` 字段承载 |
| BenchmarkEngine | 等权基准再平衡逻辑正确 |
| Diagnostics | 覆盖不足、样本过短、Top K 非法、杠杆率超限等警告正确 |

### 存量回归测试

| 测试对象 | 验收点 |
|---------|--------|
| `trend-following.test.ts` | 现有测试全部通过；双向持仓方向正确；position weight 为正 |
| `optimizer.test.ts` | ERC / inverse_volatility 优化器测试通过 |
| `statistics.test.ts` | `computeRiskContributions` 在新增 direction 字段后仍正确 |

### 端到端测试

- Pi 调用 `runActiveDualMomentumBacktest`，验证响应结构和降级状态
- Pi 不把历史回测结果表述为未来收益承诺

## Out of Scope

首版不做：

- 自动下单
- 实盘信号推送
- 高频或日内回测
- 杠杆、融资、融券（保证金比例假设不固化进回测引擎）
- 复杂税务计算
- 组合优化器联动（自动根据策略结果做风险平价）
- 跨数据源实时补全全市场标的
- 机器学习参数优化
- 多策略组合调度
- Monthly 再平衡（首版固定 weekly）
- 跨币种汇率转换（要求同币种标的池）
- 现金代理标的收益曲线（首版固定 cashReturn = 0）
- Walk-forward 参数稳定性测试
- 滚动 Sharpe / 滚动回撤 / 滚动胜率

## Further Notes

### 与 rotation-prism 的关系

轮动三棱镜（Rotation Prism）是面向 Agent 的**分析型** Skill，报告双标的中当前应偏向哪一侧，不给交易执行、仓位或订单建议。

Active Dual Momentum GTAA 是**规则型回测** Skill，用户给定标的池和参数，系统生成历史回测结果。

两者使用相同的 quant-data 价格源，但服务于不同目的：一个侧重信号解读，一个侧重绩效验证。

### 期货主连数据来源

本次策略支持期货主连作为输入，假设 price 数据在进入回测引擎前已完成 roll 处理（由 quant-data 或数据提供方完成）。回测引擎不做合约切换逻辑。

### 杠杆率监控

名义等权设计下，组合总名义敞口可能超过 100%（尤其是期货和 ETF 混合池）。诊断指标中必须显式报告 `totalNominalExposure` 和 `netExposure`，供用户判断杠杆率是否可接受。

### 权重正值不变量

本次改造的核心不变量：**所有对外暴露的 `weight` 字段必须为正数，方向由 `direction` 字段显式承载**。这一约束适用于所有新旧策略模块。
