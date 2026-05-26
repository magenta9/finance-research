# rotation-prism

`rotation-prism` 是一个自包含的生产级 Agent Skill 包，用于分析两个指数、ETF 或基金之间的轮动三棱镜相对强弱状态。

## 包结构

- `SKILL.md`: Agent 触发说明、硬规则和工作流。
- `scripts/analyze.py`: 确定性分析入口，输出脚本 JSON。
- `tests/test_analyze.py`: 不依赖 Agent runtime 的确定性测试。
- `tests/agent_smoke_test.py`: 单独运行的 agent smoke 验证入口。
- `docs/output-format.md`: Agent 最终报告格式和脚本 JSON 边界。
- `examples/`: 示例输入和示例报告。

## 外部依赖

- `quant-data` CLI：用于标的解析和日频价格获取。
- Agent runtime：仅 agent smoke 需要。

## 验证

确定性测试：

```bash
python3 -m unittest discover -s tests -p 'test_*.py'
```

agent smoke：

```bash
python3 tests/agent_smoke_test.py
```

默认只验证 Agent runtime 能发现 `skill:rotation-prism`。实际发起调用：

```bash
python3 tests/agent_smoke_test.py --run-prompt
```

`scripts/analyze.py` 已实现 quant-data 调用边界、三棱指标计算、A/B/C 信号评级和数据缺口输出。`tests/agent_smoke_test.py` 使用 Pi RPC 作为当前 transport，但验证名称统一叫 agent smoke。