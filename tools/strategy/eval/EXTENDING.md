# Strategy Eval 扩展指南

本文说明在统一 Eval 框架下，如何 **新增评分指标**、**接入新策略** 并 **跑 eval**。

## 架构速览

```
run_strategy_eval.py          # Python：case 生成、拉行情、打分、写报告
    ↓ EvalRunRequest (JSON)
generic_eval_runner.ts        # TS：按 case × strategy 调度
    ↓ StrategyExecutionContext
defaultAllocationStrategyRegistry   # allocation-engine：策略算法唯一来源
    ↓ AllocationResult.portfolioMetrics
ScoringProfile                # Python：case 分数与汇总
```

原则：

- **策略逻辑** 只加在 [`tools/strategy/allocation-engine`](../../allocation-engine)，eval 不复制算法。
- **打分指标** 只改 `ScoringProfile`（JSON 配置），eval 从 `metrics` 字段读取。
- **实验网格**（universe / basket / window / cadence）只改 eval run config。

---

## 一、新增一个 Eval 分数指标

### 1. 确认指标来源

当前 case 分数只使用 TS runner 返回的 `EvalResultRow.metrics`，其字段来自 QuantDesk `AllocationResult.portfolioMetrics`：

| 字段 | 含义 |
|------|------|
| `expectedReturn` | 年化预期收益 |
| `sharpeRatio` | Sharpe |
| `maxDrawdown` | 最大回撤 |
| `volatility` | 年化波动 |

若新指标 **已在 `portfolioMetrics` 或 `metadata` 中**，只需改 Python 打分配置。

若新指标 **不在上述结构中**，需要两步：

1. 在 `eval_result_projector.ts` 的 `projectAllocationResult()` 里，从 `result.diagnostics` 或策略专属字段投影到 `metadata`。
2. 扩展 `eval_core/scoring.py` 的 `score_result()`，支持从 `row["metadata"]` 读取（当前仅读 `metrics`）。

### 2. 修改 ScoringProfile（推荐路径）

编辑 run config（例如 [`config/eval-run-defaults.json`](config/eval-run-defaults.json)）中的 `scoringProfile.metrics`：

```json
{
  "key": "sharpeRatio",
  "weight": 0.3,
  "direction": "higher_better",
  "floor": -0.5,
  "ceiling": 2.0
}
```

字段说明：

| 字段 | 说明 |
|------|------|
| `key` | `metrics` 中的键名（Sharpe 可用 `sharpeRatio`） |
| `weight` | 权重；会自动归一化 |
| `direction` | `higher_better` 或 `lower_better` |
| `floor` / `ceiling` | 线性归一化区间；`lower_better` 时 `ceiling` 表示“越差”的上界 |

汇总分由 `finalScore` 控制（默认 `0.5×p50 + 0.25×p10 + 0.25×p90`）。

`requireAllCasesSucceeded: true` 时，任一 case 失败则整组不可比（`scoreComparable: false`）。

### 3. 验证

```sh
cd tools/strategy/eval
python3 -m unittest discover -s ../eval_core -p '*_test.py'
python3 run_strategy_eval.py --dry-run --limit 1 --strategy erc
```

---

## 二、接入一个新策略

### 1. 在 allocation-engine 注册策略（必须）

在 [`tools/strategy/allocation-engine/src/strategy-registry.ts`](../../allocation-engine/src/strategy-registry.ts) 中：

1. 在 `@quantdesk/shared` 的 `AllocationStrategy` 类型里增加新 `strategyId`（若尚未存在）。
2. 实现 `AllocationStrategyHandler`（`run(context) -> StrategyExecutionResult`）。
3. 挂到 `defaultAllocationStrategyRegistry`：

```typescript
export const defaultAllocationStrategyRegistry: AllocationStrategyRegistry = {
    // ...
    my_new_strategy: myNewStrategyHandler,
};
```

4. 补充 `allocation-engine` 单测（例如 `strategy-registry.test.ts` 或 handler 单测）。
5. QuantDesk Desktop 通过 `packages/main/src/portfolio/` 下的 re-export 自动获得同一 registry。

Eval **不会**自动发现未注册的策略；registry 是 allocation-engine、eval 与 desktop 的共享策略源。

### 2. 在 eval 侧声明 strategyId

更新 [`eval_core/contract.py`](../eval_core/contract.py) 与 [`eval_runner_contract.ts`](eval_runner_contract.ts) 中的 `CANONICAL_STRATEGY_IDS`（用于 CLI 校验）。

在 run config 的 `strategyRuns` 中增加一项：

```json
{
  "strategyId": "my_new_strategy",
  "strategyMix": {
    "activeDualMomentum": { }
  },
  "constraints": null,
  "extraResultFields": ["calmarRatio"]
}
```

- `strategyMix`：传给 `AllocationStrategyHandler` 的配置，结构见 `AllocationStrategyMix`。
- `constraints`：可选，覆盖 `defaultConstraints`。
- `extraResultFields`：从 diagnostics 投影到 TSV/`metadata` 的额外字段。

若新策略需要特殊 `mode` 或默认 `rebalanceCadence`，改 [`eval_runner_contract.ts`](eval_runner_contract.ts) 中的 `resolveAllocationMode()` / `resolveRebalanceCadence()`。

### 3. 准备 eval 配置

可复制 [`config/all-strategies-smoke.json`](config/all-strategies-smoke.json) 作为模板，调整：

| 块 | 用途 |
|----|------|
| `universe` / `markets` | 候选资产池 |
| `caseGenerator` | basket 抽样方式（`unique_basket` / `conflict_group`） |
| `pricePolicy` | quant-data 拉价策略 |
| `defaultConstraints` | 组合约束 |
| `strategyRuns` | 要跑的策略及 mix |
| `scoringProfile` | 打分口径 |

---

## 三、怎么跑 Eval

### 统一入口

```sh
# 使用默认 Configuration 预设
python3 tools/strategy/eval/run_strategy_eval.py --dry-run --limit 1 --strategy erc

# 使用自定义 config（多策略）
python3 tools/strategy/eval/run_strategy_eval.py \
  --config tools/strategy/eval/config/all-strategies-smoke.json \
  --limit 1 \
  --run-id my-experiment

# CLI 指定多个策略（mix 来自 config 里同名 strategyRuns，否则为空）
python3 tools/strategy/eval/run_strategy_eval.py \
  --strategy erc \
  --strategy my_new_strategy \
  --samples-per-cell 1 \
  --limit 5 \
  --run-id erc-vs-new
```

### 输出目录

`<outputRoot>/<YYYY-MM-DD>/<run-id>/`

| 文件 | 内容 |
|------|------|
| `cases.json` | 生成的 eval cases |
| `eval-plan.json` | 运行计划 |
| `results.json` / `results.tsv` | 逐 case × strategy 结果与分数 |
| `score-summary.json` | 按策略汇总与 leaderboard |
| `report.md` | 可读报告 |

### 六策略 smoke 参考

已提供 [`config/all-strategies-smoke.json`](config/all-strategies-smoke.json)，覆盖 registry 中全部 6 个策略：

```sh
python3 tools/strategy/eval/run_strategy_eval.py \
  --config tools/strategy/eval/config/all-strategies-smoke.json \
  --limit 1 \
  --run-id all-strategies-smoke
```

2026-05-31 验证结果：6/6 `status: ok`，输出见  
`thoughts/shared/research/strategy-eval/2026-05-31/all-strategies-smoke/`。

### 测试

```sh
cd tools/strategy/eval
make eval.test
```

---

## 四、常见扩展场景

### 场景 A：只换打分，不换策略

改 `scoringProfile` → 直接 `--config` 或改 defaults → 重跑 `run_strategy_eval.py`。

### 场景 B：新策略 + 沿用现有 metrics

1. allocation-engine registry 注册 handler  
2. config 的 `strategyRuns` 加一项  
3. `CANONICAL_STRATEGY_IDS` 加 id  
4. 跑 eval

### 场景 C：新策略 + 新指标（如 Calmar）

1. 确保 handler 的 `AllocationResult` 或 diagnostics 能产出该值  
2. `extraResultFields` 列出字段名  
3. 必要时改 `eval_result_projector.ts` 和 `scoring.py` 读取 `metadata`  
4. `scoringProfile.metrics` 增加对应 `key`

### 场景 D：ADM 式 conflict-group 抽样

使用 [`config/adm-eval-run.json`](config/adm-eval-run.json)：

- `caseGenerator.mode: "conflict_group"`
- `conflictGroupsPath` 指向冲突组 JSON
- `strategyRuns` 仅 ADM + 对应 `strategyMix`

---

## 五、不要做的事

- 不要在 `configuration_eval_runner.ts` / `adm_eval_runner.ts` 里加新策略（已 deprecated）。
- 不要在 eval Python 里复制优化/回测逻辑；应走 registry handler。
- 不要假设 eval 分数与旧 baseline 可比；换 handler 或 scoring 后应重新建立 baseline。

---

## 六、相关文件索引

| 用途 | 路径 |
|------|------|
| Python 入口 | [`run_strategy_eval.py`](run_strategy_eval.py) |
| TS runner | [`generic_eval_runner.ts`](generic_eval_runner.ts) |
| 策略适配 | [`eval_strategy_adapter.ts`](eval_strategy_adapter.ts) |
| 结果投影 | [`eval_result_projector.ts`](eval_result_projector.ts) |
| 数据准备 | [`eval_preparation.ts`](eval_preparation.ts) |
| 契约 | [`eval_runner_contract.ts`](eval_runner_contract.ts), [`eval_core/contract.py`](../eval_core/contract.py) |
| 打分 | [`eval_core/scoring.py`](../eval_core/scoring.py) |
| allocation-engine registry | [`strategy-registry.ts`](../../allocation-engine/src/strategy-registry.ts) |
