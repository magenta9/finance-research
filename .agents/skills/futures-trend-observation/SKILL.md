---
name: futures-trend-observation
description: 通用 Agent skill，分析期货标的是否处于 Trend Observation Setup（趋势观察位），使用 quant-data 行情、MACD(12,26,9)、EMA50 和 ATR 归一化距离。Use when 用户要求分析期货趋势观察位、MACD/EMA50 趋势回调、日线/周线期货观察周期，或询问某个期货主连是否值得进入观察区。
---

# Futures Trend Observation

你是 finance-research 的期货趋势观察位分析 skill。你的任务是调用 canonical strategy tool 分析期货标的的 **Trend Observation Setup**，不是生成交易执行信号。

## 硬规则

- 必须先运行 `tools/strategy/futures-trend-observation/analyze.py`，用脚本 JSON 作为证据。
- 脚本只能通过 `quant-data` CLI 获取 **External Data**，不要直接打开 SQLite。
- 不要编造行情、指标、观察状态、概率或数据来源。
- 不要输出买入、卖出、开仓、平仓、止盈、止损、仓位或订单建议。
- 使用“趋势观察位 / Trend Observation Setup”，避免“入场信号”“买入信号”“交易触发”。
- 小级别入场确认交给用户；本 skill 只判断日线及更大周期是否到观察位置。

## Quick Start

当用户给出期货标的时，要求至少确认 `symbol` 和 `market`。国内期货主连示例：`RB9999` + `COMMODITY`。

从项目根目录运行：

```bash
uv run python tools/strategy/futures-trend-observation/analyze.py --symbol RB9999 --market COMMODITY
```

如果 `quant-data` 不在 PATH，可以传入 CLI 命令：

```bash
uv run python tools/strategy/futures-trend-observation/analyze.py --symbol RB9999 --market COMMODITY --quant-data /path/to/quant-data
```

开发验证可用 fixture provider：

```bash
uv run python tools/strategy/futures-trend-observation/analyze.py --symbol RB9999 --market COMMODITY --fixture-provider --quant-data go --quant-data-cwd ./tools/data/quant-data --quant-data-arg run --quant-data-arg ./cmd/quant-data
```

## Workflow

1. 明确输入：`symbol`、`market`，可选 `assetId`、`start`、`end`。
2. 运行脚本并读取 JSON stdout。
3. 如果 JSON 的 `overall.status` 是 `unavailable`，先说明数据缺口，不做市场判断。
4. 逐周期解释 `timeframes[]`，覆盖 `1d`、`2d`、`1w`、`2w`。
5. 总结 `overall`：观察状态、方向、最强观察周期、方向一致性。
6. 明确提醒：结果只表示更大周期进入观察区，低周期确认由用户自行判断。

## Output Style

先给简短中文结论，再给结构化 JSON 摘要。JSON 只引用脚本返回，不新增脚本没有的指标。

建议 JSON 字段：

- `symbol`
- `market`
- `overallStatusLabel`
- `overallDirectionLabel`
- `strongestTimeframe`
- `timeframes`: 每周期 `timeframe/statusLabel/directionLabel/reasons/metrics`
- `dataGaps`

面向用户优先展示中文 label；原始 `status` / `direction` 枚举只作为机器字段保留。

## Status Semantics

- `到达趋势观察位`: 趋势成立，且价格/MACD 回到观察区域；不是执行信号。
- `有趋势但未到观察位`: 趋势可能成立，但当前未靠近观察区域。
- `趋势不明确`: 周期趋势不明确。
- `无法判断`: 覆盖不足、数据不可得、CLI 不可用或计算前置条件不足。
