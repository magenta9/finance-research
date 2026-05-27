# rotation-prism

`rotation-prism` 是一个自包含的生产级 Agent Skill 包，用于分析两个指数、ETF 或基金之间的轮动三棱镜相对强弱状态。

## 包结构

- `SKILL.md`: Agent 触发说明、硬规则和工作流。
- `scripts/analyze.py`: 确定性分析入口，输出脚本 JSON。
- `tests/test_analyze.py`: 不依赖 Agent runtime 的确定性测试。
- `tests/test_agent_smoke.py`: 兼作 agent smoke 入口与契约单测文件。
- `docs/output-format.md`: Agent 最终报告格式和脚本 JSON 边界。
- `examples/`: 可用于测试或演示的示例输入。

## 外部依赖

- `quant-data` CLI：用于标的解析和日频价格获取。
- Agent runtime：仅 agent smoke 需要。

## 验证

确定性测试：

```bash
uv run python -m unittest discover -s tests -p 'test_*.py'
```

agent smoke：

```bash
uv run python tests/test_agent_smoke.py
```

`scripts/analyze.py` 已实现 quant-data 调用边界、三棱指标计算、A/B/C 信号评级和数据缺口输出。`tests/test_agent_smoke.py` 使用 `pi -p` 发起真实非交互调用、把最终报告直通输出到终端，并校验输出是否严格满足七段式标题契约；同一文件也承载标题契约的单元测试。