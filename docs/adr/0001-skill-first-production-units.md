# 0001. Skill-First Production Units

## 状态

Accepted

## 背景

仓库过去把 `tools/catalog.yaml` 作为可复用金融工具的权威清单。`.agents/skills/` 下的 Agent Skill 预期只是 `tools/` 中 canonical 实现的薄适配层。

现在项目需要生产级 Agent Skill 能够独立于本仓库迁移。如果强制所有 skill-owned 脚本都放在 `tools/` 下，会增加迁移成本，并把一个 Skill 的说明、脚本、fixture 和验证驱动拆散到不同目录。

## 决策

生产级 Agent Skill 可以在 `.agents/skills/<skill-id>/` 下自包含。自包含 Skill 可以拥有脚本、fixture、验证驱动和支撑文档。

移除仓库级工具目录。自包含生产级 Skill 不需要登记到中央 catalog。每个 Skill 的 `SKILL.md` 负责声明入口、数据依赖、输出契约和验证流程。

当 Skill 需要验证 Agent runtime 能发现并调用它时，使用通用术语 `agent smoke`，不把验证名称绑定到某个具体 SDK 或供应商实现。

`tools/` 目录仍可用于保留的共享基础设施和仓库拥有的工具，例如 `quant-data`，但它不再是 skill-owned 实现的强制位置。

## 后果

- Skill 更容易作为完整包迁移。
- 不再通过中央 catalog 做仓库级发现。
- 验证从 catalog metadata 转移到 Skill 本地流程。
- 当某些基础设施明确要保留在仓库中时，仍可以放在 `tools/` 下。