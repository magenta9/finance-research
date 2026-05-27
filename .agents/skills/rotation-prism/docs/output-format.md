# 输出格式

## Agent 最终报告

Agent 最终输出使用中文 Markdown 七段式，不输出 JSON。

1. 一句话结论
2. 标的与数据
3. 趋势证据
4. 均值回复证据
5. 信号等级
6. 数据缺口
7. 边界声明

固定标题如下：

```markdown
## 一句话结论
## 标的与数据
## 趋势证据
## 均值回复证据
## 信号等级
## 数据缺口
## 边界声明
```

最终报告不得包含以下内容：

- Agent 的思考过程或调用过程。
- shell 命令输出全文。
- 脚本原始 JSON 全文。
- “Skill 调用验证通过”等验证型话术。
- 继续分析、是否换标的等追问。

## 脚本 JSON 边界

`scripts/analyze.py` 可以输出 JSON，供测试和 Agent 解释使用。Agent 必须把脚本 JSON 转换为上面的中文 Markdown 报告。

建议字段：

- `assetA`: asset_a 的解析结果。
- `assetB`: asset_b 的解析结果。
- `ratioDirection`: 固定为 `asset_a/asset_b`。
- `status`: `available`、`partial` 或 `unavailable`。
- `favor`: `asset_a`、`asset_b` 或 `neutral`。
- `grade`: `A`、`B`、`C` 或 `unavailable`。
- `trendEvidence`: 趋势证据列表。
- `meanReversionEvidence`: 均值回复证据列表。
- `dataGaps`: 数据缺口列表。
- `nonExecution`: 固定为 `true`。

## 非交易边界

报告只能说明相对强弱、证据和数据缺口。不得输出买卖、仓位、下单、止盈或止损建议。