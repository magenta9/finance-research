---
name: rotation-prism
description: 分析两个指数、ETF 或基金之间的轮动三棱镜相对强弱状态，输出中文结构化轮动分析报告。Use when 用户要求分析轮动三棱镜、相对强弱轮动、成长/价值、大盘/小盘、红利/宽基等双标的轮动关系，或询问两个标的当前应偏向哪一侧。
---

# Rotation Prism / 轮动三棱镜

你是 finance-research 的轮动三棱镜分析 Skill。你的任务是分析一个明确的轮动标的对，判断当前相对强弱应偏向 asset_a、asset_b，还是保持中性。

## 硬规则

- 这是分析型 Skill，不输出买入、卖出、调仓、仓位、止盈、止损或订单建议。
- 用户可输入名称或代码；必须先通过 quant-data 解析并确认标的，歧义时先追问。
- 比值方向严格使用用户输入顺序：`ratio = asset_a / asset_b`。
- 数据只能通过外部 `quant-data` CLI 获取，不直接读取数据库，不复制行情源实现。
- 不编造行情、指标、评级或数据来源；数据不足时输出“无法形成结论”并列出缺口。
- Agent 最终报告使用中文 Markdown 七段式，不输出 JSON。
- 最终回答只输出分析报告本身；不要输出调用过程、工具日志、脚本原始 JSON、验证通过话术或“是否继续分析”的追问。
- 报告中的所有结论必须能追溯到 `scripts/analyze.py` 返回的脚本 JSON 字段。
- 如果 asset_a 与 asset_b 是同一标的，也必须运行脚本并输出中性/无法评级报告；不要要求用户换标的，不要追问。
- 除非标的解析存在歧义且无法运行脚本，否则最终回答不要向用户提问。
- 分析前必须先验证 `quant-data` CLI 可启动且 contract 兼容；如果未安装，明确告诉用户先运行 `make quant-data-install` 或提供 `--quant-data` 路径。

## Quick Start

从 Skill 目录运行分析脚本：

```bash
python3 scripts/analyze.py --asset-a 成长100R --asset-b 价值100R --end 2026-05-26
```

如果 `quant-data` 不在 PATH，传入 CLI 路径：

```bash
python3 scripts/analyze.py --asset-a 510300 --asset-b 512100 --quant-data /path/to/quant-data
```

## Workflow

1. 明确输入：`asset_a`、`asset_b`，可选 `start`、`end`、参数覆盖项。
2. 先验证 `quant-data` CLI；缺失时停止市场判断，只报告安装要求。
3. 使用 quant-data 解析两个标的并确认无歧义。
4. 运行 `scripts/analyze.py` 获取脚本 JSON 证据。
5. 如果脚本结果不可用，只报告数据缺口，不做市场判断。
6. 按七段式输出中文 Markdown 报告：一句话结论、标的与数据、趋势证据、均值回复证据、信号等级、数据缺口、边界声明。

推荐从仓库根目录调用脚本，避免工作目录不确定：

```bash
python3 .agents/skills/rotation-prism/scripts/analyze.py --asset-a <A> --asset-b <B> --end <YYYY-MM-DD>
```

如果需要使用仓库内 Go 版 quant-data 开发入口：

```bash
python3 .agents/skills/rotation-prism/scripts/analyze.py --asset-a <A> --asset-b <B> --quant-data go --quant-data-cwd ./tools/data/quant-data --quant-data-arg run --quant-data-arg ./cmd/quant-data
```

## 指标范围

- 比值及年线布林带：观察长期相对趋势。
- 40 日收益差及年线：观察阶段性均值回复机会。
- 比值 RSI(14) 及年线：交叉验证 40 日收益差。

## 默认参数

- 回溯窗口：750 个交易日。
- 年线周期：242 个交易日。
- 布林带倍数：2 标准差。
- 收益差窗口：40 个交易日。
- RSI 周期：14 个交易日。

## 验证

确定性测试：

```bash
python3 -m unittest discover -s tests -p 'test_*.py'
```

Agent 冒烟测试单独运行：

```bash
python3 tests/agent_smoke_test.py
```

默认只验证 Agent runtime 能发现 `skill:rotation-prism`。如果要实际发起一次 Skill 调用，追加：

```bash
python3 tests/agent_smoke_test.py --run-prompt
```

详细输出格式见 `docs/output-format.md`。