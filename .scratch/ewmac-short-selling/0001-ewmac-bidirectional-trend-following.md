---
title: EWMAC 趋势跟随添加做空能力
status: ready-for-agent
created: 2026-05-27
---

## Problem Statement

当前 EWMAC 趋势跟随策略只支持做多（long-only）。当 EWMAC forecast 为负值时，策略选择平仓而非开空。这导致在下跌趋势中无法获取趋势收益，限制了策略的盈利潜力。用户需要双向（多空）趋势跟随能力。

## Solution

在 EWMAC 趋势跟随策略中引入对称的多空信号处理。当 `allowShort=true`（默认）时，负 forecast 产生空头仓位，与正 forecast 的多头仓位对称计入总规则槽位，总暴露度受 `sleeveWeight` 上限约束。当 `allowShort=false` 时，退化为现有的单向做多行为。

## User Stories

1. 作为量化研究员，我希望 EWMAC 策略在下跌趋势中能开空仓，从而在双向趋势行情中均能获取趋势收益
2. 作为组合管理者，我希望通过 `allowShort` 开关控制策略是否允许做空，以适应不同风险偏好的组合
3. 作为回测分析师，我希望交易记录（trades）中能区分开多、开空、平多、平空四种操作，便于分析策略的多空行为
4. 作为风险管理者，我希望诊断数据中能区分多头规则数和空头规则数，从而评估策略在多空方向上的暴露情况
5. 作为 UI 用户，我希望交易行为表格中能清晰显示多空方向和仓位数值的正负，以快速了解当前持仓状态
6. 作为开发者，我希望现有单向做多逻辑在 `allowShort=false` 时完全兼容，无需维护两套代码路径

## Implementation Decisions

### 1. 类型定义（`domain.ts`）

**Trade action 枚举扩展**

将 `AllocationTrade.action` 从二元枚举扩展为四元枚举：

```ts
// 之前
action: 'buy' | 'sell';

// 之后
action: 'open_long' | 'close_long' | 'open_short' | 'close_short';
```

四种 action 的触发条件（transition 语义）：

| fromWeight | toWeight | action | reason 示例 |
|---|---|---|---|
| 0 | 正数 | `open_long` | `'趋势规则转多，开多仓'` |
| 正数 | 0 | `close_long` | `'趋势规则转空，平多仓'` |
| 0 | 负数 | `open_short` | `'趋势规则转空，开空仓'` |
| 负数 | 0 | `close_short` | `'趋势规则转多，平空仓'` |

**`TrendFollowingStrategyConfig` 新增字段**

```ts
TrendFollowingStrategyConfig {
  allowShort?: boolean;  // 默认 true
  // 现有字段不变
  enabled: boolean;
  sleeveWeight: number;
  assetIds?: string[];
  forecastCap?: number;
  forecastDiversificationMultiplier?: number;
  rules?: EwmacRuleConfig[];
  volatilitySpan?: number;
}
```

**`TrendFollowingSimulationResult` 新增字段**

```ts
TrendFollowingSimulationResult {
  allowShort: boolean;  // 新增，透传配置值
  // 现有字段不变
  assetIds: string[];
  assetDiagnostics: TrendFollowingAssetDiagnostics[];
  ...
}
```

**`TrendFollowingAssetDiagnostics` 新增字段**

```ts
TrendFollowingAssetDiagnostics {
  activeLongRules: number;   // 新增，正向激活规则数
  activeShortRules: number;  // 新增，负向激活规则数
  activeRuleCount: number;   // 保持 = activeLongRules + activeShortRules（总激活规则数）
  // 现有字段不变
  assetId: string;
  latestForecast: number;
  latestPositionWeight: number;  // 可正（多头）可负（空头）
  symbol: string;
}
```

### 2. 核心对称计数逻辑（`trend-following.ts`）

**规则激活计数改为双向**

```ts
// 之前：只数正 forecast
const countActiveRules = (family, forecastIndex) =>
  family.ruleForecasts.reduce(
    (count, rf) => count + ((rf.forecast[forecastIndex] ?? 0) > 0 ? 1 : 0),
    0,
  );

// 之后：同时统计长/空
const countLongRules = (family, forecastIndex) =>
  family.ruleForecasts.reduce(
    (count, rf) => count + ((rf.forecast[forecastIndex] ?? 0) > 0 ? 1 : 0),
    0,
  );

const countShortRules = (family, forecastIndex) =>
  family.ruleForecasts.reduce(
    (count, rf) => count + ((rf.forecast[forecastIndex] ?? 0) < 0 ? 1 : 0),
    0,
  );

const countActiveRules = (family, forecastIndex) =>
  countLongRules(family, forecastIndex) + countShortRules(family, forecastIndex);
```

**仓位权重计算（对称 + 上限约束）**

```ts
// 品种 i 在 t 时刻的仓位：
//   longWeight_i(t)  =  (activeLongRules_i(t)  / totalRuleSlots) * sleeveWeight
//   shortWeight_i(t) = -(activeShortRules_i(t) / totalRuleSlots) * sleeveWeight
// 总暴露度：|longWeight| + |shortWeight| = (activeLongRules + activeShortRules) / totalRuleSlots * sleeveWeight
//                           ≤ (totalRuleSlots) / totalRuleSlots * sleeveWeight = sleeveWeight ✓

// 当 allowShort=false 时：
//   longWeight_i(t)  =  (activeLongRules_i(t) / totalRuleSlots) * sleeveWeight
//   shortWeight_i(t) = 0
//   activeShortRules 完全忽略
```

**`allowShort` 分支逻辑**

在 `buildSlotWeights` 中根据 `allowShort` 决定：
- `allowShort=true`：longWeight = (长规则数/总槽位)×sleeveWeight，shortWeight = -(短规则数/总槽位)×sleeveWeight
- `allowShort=false`：longWeight = (长规则数/总槽位)×sleeveWeight，shortWeight = 0

### 3. 日收益计算

```ts
// 每日组合收益：
//   r_t = Σ_i exposure_i(t-1) * (price_i(t) / price_i(t-1) - 1)
//   其中 exposure_i = positionWeight_i（可正可负）
// 多头正贡献，空头负贡献，方向由 positionWeight 的符号决定
```

### 4. `TrendFollowingSimulationResult` 返回值

新增 `allowShort` 字段透传配置值。新增 `activeLongRules` 和 `activeShortRules` 字段，`activeRuleCount` 语义改为长+空总数（E1 决策）。

### 5. UI 渲染（`trade-behavior-section.tsx`）

Trade 表格的"方向"列扩展为四态：

| action | 颜色 | 标签 |
|---|---|---|
| `open_long` | 绿色 `#3f7a4a` | 开多 |
| `close_long` | 红色 `#9f3a29` | 平多 |
| `open_short` | 红色 `#9f3a29` | 开空 |
| `close_short` | 绿色 `#3f7a4a` | 平空 |

`fromWeight` / `toWeight` 列显示带符号百分比（如 `+25.0%` 或 `-12.5%`）。

## Testing Decisions

### 测试范围

测试关注外部行为（forecast 信号→仓位→收益），不测试内部实现细节（如具体函数签名）。

### 1. `trend-following.test.ts`

**新增测试用例：**

- **对称计数**：构造正/负 forecast 交替的品种，验证 `activeLongRules`、`activeShortRules`、`activeRuleCount` 是否正确
- **`allowShort=false` 退化**：同一组数据在 `allowShort=false` 时，空头规则被忽略，仓位结果与现有单向逻辑一致
- **四态 action**：验证从 0→正、正→0、0→负、负→0 四种转换分别产生 `open_long`、`close_long`、`open_short`、`close_short`
- **仓位上限**：验证多空总暴露不超过 `sleeveWeight`
- **`allowShort` 透传**：验证返回结果中 `allowShort` 字段与配置一致

### 2. `visualization-panel.test.tsx`

更新 fixture 中的 `action` 字段，使用四态枚举而非二态 `'buy'/'sell'`。

### 3. 现有测试兼容性

`allowShort` 默认为 `true`，现有测试中不显式设置 `allowShort` 的用例应自然覆盖做空场景。若有仅测试做多的用例，需显式设置 `allowShort=false`。

## Out of Scope

- 配置策略（ERC、反波动率、最大分散化）的做空支持
- `AllocationConstraints.allowShort` 的重整
- 优化器（optimizer.ts）的负权重支持
- `sleeveWeight` 作为暴露上限的移除（保留，语义不变）
- 新的策略配置文件或 API 端点
- 下单执行层（execution layer）的做空逻辑

## Further Notes

### 决策树摘要

| 编号 | 决策点 | 选择 |
|---|---|---|
| 1 | 做空仓位权重计算方式 | A - 对称计数 |
| 2 | 多空总暴露上限 | sleeveWeight 上限（总暴露 ≤ sleeveWeight） |
| 3 | 方向切换 trade action | C1 - 单笔反向操作 |
| 4 | Trade reason 表达 | G2 - 详细说明（转多/转空 + 开仓/平仓） |
| 5 | `allowShort` 开关 | 新增，默认 true |
| 6 | 诊断数据拆分 | D1 - `activeLongRules` + `activeShortRules` + `activeRuleCount`（总数） |
| 7 | `activeRuleCount` 语义 | E1 - 长+空总数 |
| 8 | Action 类型范围 | 全局替换为四态 `open_long/close_long/open_short/close_short` |
| 9 | 实施范围 | 仅 EWMAC，其他配置策略暂不变 |

### 文件改动清单

| 文件 | 改动 |
|---|---|
| `packages/shared/src/types/domain.ts` | `AllocationTrade.action` 四态、`TrendFollowingStrategyConfig` 新增 `allowShort`、`TrendFollowingAssetDiagnostics` 新增字段、`TrendFollowingSimulationResult` 新增 `allowShort` |
| `packages/main/src/portfolio/trend-following.ts` | 对称计数逻辑、`allowShort` 分支、四态 action 构建 |
| `packages/main/src/portfolio/trend-following.test.ts` | 新增做空场景测试用例 |
| `packages/renderer/src/components/allocation/trade-behavior-section.tsx` | 四态 action 渲染（颜色+标签） |
| `packages/renderer/src/components/allocation/visualization-panel.test.tsx` | 测试 fixture 更新 |
