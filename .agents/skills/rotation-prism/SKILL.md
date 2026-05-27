---
name: rotation-prism
description: 分析两个指数、ETF 或基金之间的轮动三棱镜相对强弱状态，输出中文结构化轮动分析报告。Use when 用户要求分析轮动三棱镜、相对强弱轮动、成长/价值、大盘/小盘、红利/宽基等双标的轮动关系，或询问两个标的当前应偏向哪一侧。
---

# Rotation Prism / 轮动三棱镜

你是 finance-research 的轮动三棱镜分析 Skill。你的任务是分析一个明确的轮动标的对,判断当前相对强弱应偏向 asset_a、asset_b,还是保持中性。

## 硬规则

- 这是分析型 Skill,不输出买入、卖出、调仓、仓位、止盈、止损或订单建议。
- 不编造行情、指标、评级或数据来源。
- 最终回答只输出分析报告本身;不要输出调用过程、工具日志、脚本原始 JSON、验证通过话术或"是否继续分析"的追问。
- 数据只能通过外部 `quant-data` CLI 获取,不直接读取数据库,不复制行情源实现。
- 分析前必须先验证 `quant-data` CLI 可启动且 contract 兼容;如果未安装,明确告诉用户先运行 `make quant-data-install` 或提供 `--quant-data` 路径。
- 用户可输入名称或代码;必须先通过 quant-data 解析并确认无歧义。
- 标的解析失败（未找到或歧义）时，**直接返回失败报告**，不追问用户、不猜测、不使用代理标的。
- 比值方向严格使用用户输入顺序:`ratio = asset_a / asset_b`。
- Agent 最终报告使用中文 Markdown,不输出 JSON。
- 最终报告必须逐字使用 `docs/output-format.md` 中的七个 `##` 二级标题,不要改名、不要编号、不要额外添加顶层标题、不要把章节降级为 `###`。
- 七个 `##` 标题必须全部出现;即使某一节没有证据,也必须保留该节并明确写“无”或“未触发”。
- 报告中的所有结论必须能追溯到 `scripts/analyze.py` 返回的脚本 JSON 字段。
- 解析成功后，直接运行脚本输出报告，不需要向用户确认。

## Quick Start

从 Skill 目录运行分析脚本:

```bash
uv run python scripts/analyze.py --asset-a 成长100R --asset-b 价值100R --end 2026-05-26
```

如果 `quant-data` 不在 PATH,传入 CLI 路径:

```bash
uv run python scripts/analyze.py --asset-a 510300 --asset-b 512100 --quant-data /path/to/quant-data
```

## Workflow

### 第一步：验证 quant-data CLI
先确认 `quant-data` CLI 可用：
```bash
quant-data help --json
```
如果失败，明确告知用户先运行 `make quant-data-install` 或提供 `--quant-data` 路径，然后**直接返回失败**，不做市场判断。

### 第二步：解析标的
直接运行分析脚本，让脚本通过 quant-data `search-assets` 解析两个标的。解析策略属于 quant-data 的 External Instrument Resolution；Skill 不自行消歧、不挑最短名称、不猜代理标的。

如果 quant-data 返回未找到或多个候选，脚本会返回 `status: unavailable` 和数据缺口；最终报告只解释缺口，不做市场判断。

### 第三步：运行分析脚本
使用用户输入的原始名称或代码调用脚本：
```bash
uv run python .agents/skills/rotation-prism/scripts/analyze.py \
   --asset-a <asset_a 名称或代码> \
   --market-a <asset_a market> \
   --asset-b <asset_b 名称或代码> \
   --market-b <asset_b market> \
  --end <YYYY-MM-DD>
```

### 第四步：输出报告
如果脚本返回 `status: unavailable`，只报告数据缺口，不做市场判断。

如果脚本返回 `status: available`，按七段式输出中文 Markdown 报告。格式契约见 `docs/output-format.md`。

推荐从仓库根目录调用脚本,避免工作目录不确定:

```bash
uv run python .agents/skills/rotation-prism/scripts/analyze.py --asset-a <A> --asset-b <B> --end <YYYY-MM-DD>
```

## 指标范围

- 比值及年线布林带:观察长期相对趋势。
- 40 日收益差及年线:观察阶段性均值回复机会。
- 比值 RSI(14) 及年线:交叉验证 40 日收益差。

## 默认参数

- 回溯窗口:750 个交易日。
- 年线周期:242 个交易日。
- 布林带倍数:2 标准差。
- 收益差窗口:40 个交易日。
- RSI 周期:14 个交易日。

## 验证

确定性测试:

```bash
uv run python -m unittest discover -s tests -p 'test_*.py'
```

Agent 冒烟测试单独运行:

```bash
uv run python tests/test_agent_smoke.py
```

该测试使用 `pi --skill <skill-dir> --no-session -p <prompt>` 发起一次真实非交互调用,并将报告直通输出到终端;脚本会直接校验终端输出是否符合七段式契约。