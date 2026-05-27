# 0002. Restore Desktop Tool as an Isolated Context

## 状态

Accepted

## 背景

仓库此前决定以 production Agent Skill 和保留工具为主要组织单元，并默认不重新引入旧桌面应用栈。

现在需要把 QuantDesk 桌面版迁移回当前项目，并提供可运行的 desktop 工具。源项目是完整的本地优先图形桌面工作台，包含桌面壳、渲染界面、共享契约、本地运行时、Python sidecar、contracts 和打包流程。把这些内容恢复到仓库根部会改写当前仓库的 skill-first 结构；只迁移为 Agent Skill 又会丢失桌面工作台本身。

## 决策

QuantDesk 桌面版作为隔离的 **Desktop Tool** 迁移到 `tools/desktop/quantdesk/`。

该目录可以保留桌面工具自身需要的 Electron、React、pnpm workspace、`packages/*`、sidecar、contracts、脚本和打包配置。仓库根部继续保持 skill-first 结构，不恢复根级桌面 monorepo。

桌面工具采用混合运行时：Go `quant-data` CLI 接管 search、price series、FX rates 和 external data status；Python sidecar 继续承载首版仍缺口较大的非行情研究、计算兜底和桌面 runtime 能力。

桌面工具不再把外部价格和 FX 结果镜像写入自己的 SQLite 缓存。桌面本地存储只拥有用户工作区数据；外部行情数据通过 CLI-backed **Data Access Interface** 读取。

桌面首版移除原有显式行情同步和缓存状态 UI。外部数据在用户触发搜索、分析或组合准备时按需读取。

桌面首版不提供 provider credential editor。Provider configuration 继续由 `quant-data` 管理；桌面只读取兼容性、配置和 maintenance error 状态，并在触发数据请求的位置呈现诊断。

组合生成需要完整的 **Calculation Price Series**。当任一用户已选标的缺少完整计算序列、返回 degraded/unavailable 数据质量，或存在阻断性 maintenance error 时，桌面首版阻断组合生成并展示逐标的诊断，不自动剔除标的后继续优化。

桌面保留 QuantDesk 的 Pi runtime/UI 作为本地会话壳，包括流式对话、附件、风险确认、诊断和工具调用记录。生产级金融分析能力优先来自当前仓库 `.agents/skills` 和共享工具，不在桌面目录内复制或分叉已有 production Skill。

仓库根 Makefile 暴露 desktop 代理入口：install、dev、test、build 和 package。根 `make test` 不默认包含 desktop 检查；desktop 验证由显式 desktop targets 执行。

根 Makefile 目标采用点号命名空间整理。Go 行情 CLI 使用 `data.*`，策略检查使用 `strategy.*`，批处理检查使用 `jobs.*`，桌面工具使用 `desktop.*`。保留传统 `make test` 作为 retained-stack 总检查入口；其他旧的具体目标不保留别名。

桌面运行时只通过进程 `PATH` 查找 `quant-data`。应用壳正常启动，但进入主工作台前执行阻断性 health check；如果找不到 CLI、contract 不兼容，或 `quant-data status` 报告 `data.providerConfiguration.ready: false`，用户停留在类似登录页的设置阻断门，不能进入后续主功能。

`quant-data status` 作为启动门诊断命令返回 provider configuration 状态。配置缺失或不安全时，`status` envelope 仍为 `ok: true`，但在 `data.providerConfiguration` 中返回 `ready: false`、`code` 和 `message`，由桌面决定阻断。

迁移按三阶段执行：先迁入干净桌面源码并接入根 Makefile；再接入 `quant-data` search/prices/fx/status、移除同步缓存 UI 并改造 portfolio preparation；最后保留 Pi 会话壳并接当前仓库 Skills/CLI。

## 后果

- 桌面版可以作为完整工具回到当前项目。
- 桌面栈的依赖、构建和验证边界被限制在 `tools/desktop/quantdesk/`。
- 根目录仍以 Agent Skill、保留 CLI 和策略工具为主要组织方式。
- 后续 Makefile 可以增加 desktop 相关入口，但不应要求根目录成为 pnpm workspace。
- 迁移实现需要重写 QuantDesk 现有价格同步、缓存状态和 portfolio preparation 路径，使其从 `quant-data` 读取外部数据，而不是依赖桌面 SQLite 外部数据缓存。
- 桌面 UI 需要在懒加载路径中直接呈现 provider configuration、maintenance error、timeout 和 data quality 问题，而不能依赖原同步面板解释这些状态。
- Provider 凭据不会进入桌面偏好或桌面用户工作区数据；配置修复仍发生在 `quant-data` 的配置边界内。
- Portfolio preparation 的首版行为更保守：数据缺口会阻断生成，而不是隐式改变用户选择的资产集合。
- 桌面目录会承载 Agent 会话体验和 runtime shell，但不成为生产级 Skill 的 canonical 所有者。
- Desktop 工具可从仓库根部启动和验证，但不会改变现有默认 retained-stack test 语义。
- Makefile 的具体工具入口会迁移到点号命名空间，相关 README、AGENTS 和 Skill 文档必须同步更新。
- 三阶段迁移让桌面目录、数据边界和 Agent 边界分别验证，避免一次性迁移失败时无法定位问题。
- 桌面打包不内置 `quant-data` 二进制；用户环境必须先提供 contract-compatible CLI 和可用 provider configuration。macOS GUI app 的 PATH 差异会表现为进入主工作台前的阻断状态。
- `quant-data status` contract 需要扩展 provider configuration diagnostics，并用测试 fixture 固化。
