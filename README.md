# finance-research

个人金融研究工具仓库，当前围绕生产级 Agent Skill，以及保留的数据、策略和任务入口组织。

## 目录结构

- `.agents/skills/`: 生产级 Agent Skill。可迁移性重要时，Skill 可以自包含脚本、fixture、验证驱动和支撑文档。
- `tools/data/quant-data/`: 外部行情数据获取和 provider policy 处理的 Go CLI。
- `tools/strategy/futures-trend-observation/`: 期货趋势观察位分析器、agent 批处理驱动、报告生成器、测试和合约列表。
- `tools/jobs/`: 用于定时或手动运行的稳定批处理入口。
- `tools/data/quant-data/contracts/`: quant-data 拥有的 CLI schema、fixture 和 provider policy contract。
- `docs/quant-data-cli.md` 和 `tools/data/quant-data/docs/adr/`: 保留的 quant-data 文档和决策记录。

## 验证

```bash
make quant-data-test
make strategy-test
make job-smoke
```

运行保留栈的全部检查：

```bash
make test
```

## 本地 Agent 配置

确定性工具不需要 Agent 凭证即可运行，但 Agent 报告 runner 在调用模型前需要本地 `pi --mode rpc` 配置。

默认本地 user-data 目录是：

```text
.finance-research/pi-agent/config/
```

在本地创建这些文件：

- `.finance-research/pi-agent/config/settings.json`: 默认 provider/model，例如 `defaultProvider` 和 `defaultModel`。
- `.finance-research/pi-agent/config/auth.json`: 本地 Agent runtime 使用的 provider 凭证。

这些文件通过 `.gitignore` 有意排除。不要提交凭证、session 日志或工具调用状态。

如果你已经有其他可用的 Agent 配置，可以把其中的 `auth.json` 和 `settings.json` 复制到 `.finance-research/pi-agent/config/`，或在运行时传入其他位置：

```bash
python3 tools/strategy/futures-trend-observation/pi_agent_futures_trend_observation_report.py --user-data-dir /path/to/user-data
```
