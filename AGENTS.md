# AGENTS.md

## Principles
**非常非常重要，是当前项目任何操作都需要遵守的原则，如果不遵守会导致严重后果**
- 所有对用户可见的回复末尾都必须加 🐶，包括 commentary 进度更新和 final 最终回复。
- 只要准备结束当前回合并发送 final，就必须先调用 askQuestions，询问用户是“继续后续步骤”还是“结束工作”。
- askQuestions 默认必须支持输入框。实现上，不要把 allowFreeformInput 设为 false；即使提供了选项，也要允许用户直接输入补充内容。
- 只有在用户明确要求“只能二选一 / 只能固定选项 / 不要输入框”时，askQuestions 才能关闭输入框。
- 结束前这次 askQuestions 必须同时提供固定选项和输入框；不能只给选项不给输入框。
- 结束前这次 askQuestions 的 message 要明确提示：用户也可以直接在输入框里补充自己的下一步要求。
- 发送 final 前必须完成自检：
	1. 已调用 askQuestions，并且已经收到用户选择。
	2. 本次 askQuestions 保留了输入框，除非用户明确要求纯选项。
	3. 当前这条 final 回复的最后一个字符是 🐶。
- 如果上面三条任一未满足，不允许发送 final。
- 这几条不是建议，而是阻塞规则。即使当前任务只是解释原因、同步状态、道歉、确认完成，也同样适用。

## Tool Repository
- 当前仓库围绕生产级 Agent Skill 和保留的金融工具组织，不再回到旧桌面应用栈。
- 除非用户明确批准新方案，不要重新引入 Electron、React、pnpm workspace、TypeScript monorepo 或 `packages/*` 基础设施。
- 生产级 Agent Skill 可以在 `.agents/skills/<skill-id>/` 下自包含，包含迁移所需的脚本、fixture、验证驱动和支撑文档。
- 自包含 Agent Skill 不需要登记到仓库级工具目录。
- `tools/` 仍可用于保留在仓库中的工具和共享基础设施，但不再是 skill-owned 实现的强制位置。
- 当 Skill 拥有可执行行为时，它的 `SKILL.md` 必须声明入口、数据依赖、输出契约和验证流程。

## Go
- `tools/data/quant-data/` 是保留在本仓库中的 Go 行情数据 CLI。
- 修改 Go 代码、Go 使用的契约或 provider policy 行为后，运行 `make quant-data-test` 或 `cd tools/data/quant-data && go test ./...`。
- 除非另行批准迁移，保持 provider policy discovery 兼容 `tools/data/quant-data/contracts/market-data-policy.json`。

## Python
- 保留在仓库中的策略实现放在 `tools/strategy/<tool-id>/`。
- 当可迁移性是主要目标时，skill-owned 策略实现放在 `.agents/skills/<skill-id>/scripts/`。
- 定时或批处理包装仍放在 `tools/jobs/`。
- 如果 Skill 需要独立于本仓库迁移，Agent Skill 可以包含生产级脚本。
- 轻量验证和包装优先使用 Python 标准库，除非有明确理由引入依赖。

## Verification
- 修改 skill-owned 脚本、fixture 或输出契约后，按对应生产级 Skill 的 `SKILL.md` 声明的验证流程执行。
- 当 Skill 需要验证 Agent runtime 能发现并调用它时，验证名称统一使用 `agent smoke`，不要绑定到具体 SDK 或供应商名称。
- 需要人工验证 Skill 是否能被 Agent 正常调用时，优先使用 `pi --skill <skill-path> --no-session -p '<prompt>'` 做非交互验证，并在报告中说明实际输出是否符合 Skill 的输出契约。
- 修改期货趋势观察 Python 代码后，运行 `make strategy-test`。
- 报告保留栈清理工作完成前，运行 `make test`。

## Agent skills

### Issue tracker

Issues live as markdown files under `.scratch/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Uses default triage labels (needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix). See `docs/agents/triage-labels.md`.

### Domain docs

Multi-context layout with CONTEXT-MAP.md at the root. See `docs/agents/domain.md`.
