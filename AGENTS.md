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
- This repository is now organized around reusable finance tools, not the old desktop app stack.
- Do not reintroduce Electron, React, pnpm workspace, TypeScript monorepo, or `packages/*` infrastructure unless the user explicitly approves a new plan.
- Register reusable tools in `tools/catalog.yaml`. Each entry must declare `id`, `category`, `stage`, `runtime`, `entrypoints`, `inputs`, `outputs`, `dependsOn`, and `verification`.
- Valid categories are `data`, `strategy`, and `job`. Valid stages are `development`, `production`, `mature`, and `deprecated`.

## Go
- `tools/data/quant-data/` is the canonical Go data acquisition CLI.
- Run `make quant-data-test` or `cd tools/data/quant-data && go test ./...` after changing Go code, contracts used by Go, or provider policy behavior.
- Keep provider policy discovery compatible with `tools/data/quant-data/contracts/market-data-policy.json` unless a separate migration is approved.

## Python
- Put reusable strategy implementation under `tools/strategy/<tool-id>/`.
- Put scheduled or batch wrappers under `tools/jobs/`.
- Keep `.agents/skills/**` as Agent-facing adapters. Do not put reusable strategy logic there when it can live under `tools/strategy/`.
- Prefer Python standard library for lightweight validation and wrappers unless a dependency is clearly justified.

## Verification
- Use `make tool-catalog-check` after editing `tools/catalog.yaml` or moving tool entrypoints.
- Use `make strategy-test` after changing futures trend observation Python code.
- Use `make test` for retained-stack verification before reporting cleanup work as complete.

## Agent skills

### Issue tracker

Issues live as markdown files under `.scratch/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Uses default triage labels (needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix). See `docs/agents/triage-labels.md`.

### Domain docs

Multi-context layout with CONTEXT-MAP.md at the root. See `docs/agents/domain.md`.
