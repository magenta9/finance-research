# Strategy Context

本上下文覆盖 `tools/strategy/` 下保留在仓库中的策略实现，以及与策略型 Skill 共享的领域语言。

## 领域术语

跨上下文共享术语见根目录 `CONTEXT-MAP.md`。

## 本上下文术语

- Rotation Prism / 轮动三棱镜: 一套相对强弱分析框架，用长周期趋势过滤和短周期均值回复触发，判断一组双标的中当前应偏向哪一侧。
- Rotation Analysis Skill / 轮动分析 Skill: 面向 Agent 的分析型 Skill，报告双标的分析中的偏向对象、证据、信号等级和数据缺口，不给交易执行、仓位或订单建议。
- Rotation Pair / 轮动标的对: 明确输入的双标的分析对象，表达为 asset_a 相对 asset_b，而不是系统扫描出的候选池；用户输入顺序定义比值方向，即 asset_a 除以 asset_b。
- Rotation Report / 轮动分析报告: 有固定章节、面向人阅读的结构化分析输出，不是 JSON 契约。
- Rotation Prism Facets / 轮动三棱: 轮动三棱镜的三组观察面：比值及年线布林带、40 日收益差及年线、比值 RSI 及年线。
- Rotation Signal Grade / 轮动信号等级: A/B/C 分级；A级表示长周期趋势同向且短周期均值回复触发，B级表示长周期方向明确但短周期触发不佳，C级表示长周期证据矛盾或不明但短周期出现极值。
