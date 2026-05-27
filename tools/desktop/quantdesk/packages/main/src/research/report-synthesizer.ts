import type {
    ConflictRecord,
    DataProvenance,
    DecisionCard,
    ResearchReport,
    ResearchRemediationItem,
    ResearchToolExecutionArtifact,
    ResearchTaskRoute,
    ResearcherFailureArtifact,
    ResearcherOutput,
    ReviewGateResult,
} from '@quantdesk/shared';

import { buildResearchRemediationItems } from './research-remediation';

export const synthesizeResearchReport = ({
    conflicts,
    decisionCard,
    failures = [],
    generatedAt,
    gates,
    outputs,
    remediationItems,
    route,
    toolExecutions = [],
}: {
    conflicts: ConflictRecord[];
    decisionCard: DecisionCard;
    failures?: ResearcherFailureArtifact[];
    generatedAt: string;
    gates: ReviewGateResult[];
    outputs: ResearcherOutput[];
    remediationItems?: ResearchRemediationItem[];
    route: ResearchTaskRoute;
    toolExecutions?: Array<ResearchToolExecutionArtifact & { dataProvenance?: DataProvenance[] }>;
}): ResearchReport => {
    const roleOutputs = new Map(outputs.map((output) => [output.role, output]));
    const ledger = remediationItems ?? buildResearchRemediationItems({ decisionCard, failures, gates, outputs, route, toolExecutions });
    const roleFailures = new Map(failures.map((failure) => [failure.role, failure]));
    const successfulRoles = new Set(outputs.map((output) => output.role));
    const dataGaps = Array.from(new Set([
        ...decisionCard.dataGaps,
        ...outputs.flatMap((output) => output.dataGaps),
    ]));
    const gateReasons = gates.flatMap((gate) => gate.reasons);
    const coverage = [
        ...route.summonedResearchers.map((role) => {
            const output = roleOutputs.get(role);

            if (output) {
                return `${role}: 成功 - ${output.confidence} confidence, ${output.actionRecommendation}`;
            }

            const failure = roleFailures.get(role);

            return `${role}: 失败/未产出${failure ? ` - ${failure.error}` : ' - 没有结构化 researcher 输出'}`;
        }),
        ...route.notSummoned
            .filter((item) => ['allocation', 'trend', 'macro', 'fundamental', 'risk', 'factor', 'flow_sentiment', 'execution'].includes(item.role))
            .map((item) => `${item.role}: 未召唤 - ${item.reason}`),
    ];
    const hasPartialFailure = route.summonedResearchers.some((role) => !roleOutputs.has(role)) || failures.length > 0;
    const conclusion = outputs.length > 0
        ? hasPartialFailure
            ? `部分研究可读。${outputs.map((output) => `${output.role}: ${output.conclusion}`).join(' ')} 覆盖=${outputs.length}/${route.summonedResearchers.length}。`
            : outputs.length === 1
                ? outputs[0].conclusion
                : outputs.map((output) => `${output.role}: ${output.conclusion}`).join(' ')
        : 'No researcher output was produced.';
    const formatToolExecution = (execution: ResearchToolExecutionArtifact & { dataProvenance?: DataProvenance[] }) => {
        const status = execution.isError ? 'failed' : 'completed';
        const preview = execution.isError
            ? execution.errorMessage ?? 'no error message'
            : typeof execution.result === 'object' && execution.result !== null && 'summary' in execution.result && typeof execution.result.summary === 'string'
                ? execution.result.summary
                : `result fields: ${typeof execution.result === 'object' && execution.result !== null ? Object.keys(execution.result).slice(0, 4).join(', ') : String(execution.result)}`;

        const sources = execution.dataProvenance && execution.dataProvenance.length > 0
            ? ` sources=${execution.dataProvenance.map((item) => item.sourceId).join('|')}`
            : '';

        return `${execution.role}/${execution.toolName} ${status}: ${preview}${sources}`;
    };
    const toolEvidence = toolExecutions.map(formatToolExecution);
    const toolEvidenceFor = (toolNames: string[]) => toolExecutions
        .filter((execution) => successfulRoles.has(execution.role) && toolNames.includes(execution.toolName))
        .map(formatToolExecution);
    const outputEvidence = outputs.flatMap((output) => output.evidence
        .map((item) => `${output.role}/${item.label}: ${item.summary}`));
    const assetEvidence = toolEvidenceFor(['get_asset_snapshot', 'analyze_asset']);
    const portfolioEvidence = toolEvidenceFor(['get_portfolio_summary', 'get_asset_pool_summary', 'run_allocation', 'propose_rebalance']);
    const riskEvidence = toolEvidenceFor(['explain_risk']);
    const diversificationEvidence = [
        ...toolEvidenceFor(['run_allocation', 'analyze_asset', 'explain_risk']),
        ...outputs
            .filter((output) => output.edgeTypes.includes('diversification') || output.edgeTypes.includes('risk_adjusted'))
            .map((output) => `${output.role}: edge=${output.edgeTypes.join('|')}, ${output.edgeStrength}`),
    ];
    const coreEvidence = [
        `资产快照：${assetEvidence.length > 0 ? assetEvidence.join(' ') : '缺少资产级快照工具证据。'}`,
        `组合摘要：${portfolioEvidence.length > 0 ? portfolioEvidence.join(' ') : '缺少组合级工具证据。'}`,
        `风险解释：${riskEvidence.length > 0 ? riskEvidence.join(' ') : '缺少风险解释工具证据。'}`,
        `相关性/分散化证据：${diversificationEvidence.length > 0 ? Array.from(new Set(diversificationEvidence)).join(' ') : '缺少相关性或分散化证据。'}`,
        `Researcher 证据：${outputEvidence.length > 0 ? outputEvidence.join(' ') : '没有 researcher evidence 条目。'}`,
    ].join(' ');
    const gateDowngrades = gates
        .filter((gate) => gate.status !== 'pass' || gate.requiredDowngrades.length > 0)
        .map((gate) => `${gate.reviewerRole}: ${gate.status} - ${gate.verdict}${gate.requiredDowngrades.length > 0 ? `；${gate.requiredDowngrades.join('；')}` : ''}${gate.reasons.length > 0 ? `；原因=${gate.reasons.join('；')}` : ''}`);
    const downgradeReasons = [
        decisionCard.actionLevel === 'prepare' ? '动作被限制在 prepare。' : null,
        decisionCard.positionLevel === 'precise_unavailable' ? '仓位为 precise_unavailable：缺少可用风险画像或精确仓位约束。' : null,
        ledger.length > 0 ? ledger.map((item) => `${item.severity}/${item.category}: ${item.summary}${item.blocksActionAbove ? `；上限=${item.blocksActionAbove}` : ''}`).join(' ') : null,
        gateDowngrades.length > 0 ? gateDowngrades.join(' ') : null,
    ].filter((item): item is string => item !== null).join(' ') || '没有 gate 降级要求。';
    const followUpContext = [
        ...dataGaps,
        ...gateReasons,
        ...gates.flatMap((gate) => gate.requiredDowngrades),
        ...route.notSummoned.map((item) => `${item.role}: ${item.reason}`),
    ].join(' ').toLowerCase();
    const missingOutputRoles = route.summonedResearchers.filter((role) => !roleOutputs.has(role));
    const hasEtfFundamentalGap = (followUpContext.includes('asset_not_covered')
        || followUpContext.includes('issuer-style')
        || followUpContext.includes('issuer style')
        || followUpContext.includes('fundfacts'));
    const nextDataSteps = [
        ...ledger.map((item) => item.nextAction),
        ...(decisionCard.positionLevel === 'precise_unavailable' || followUpContext.includes('risk profile') || followUpContext.includes('risk_profile')
            ? ['风险画像：补齐基础币种、风险承受度、最大回撤、单标权重和单笔亏损预算。']
            : []),
        ...(followUpContext.includes('position') || followUpContext.includes('holding') || followUpContext.includes('allocation plan') || followUpContext.includes('allocation_plan') || followUpContext.includes('持仓')
            ? ['持仓/配置：补齐当前持仓、最近配置计划和可复核的组合权重。']
            : []),
        ...(followUpContext.includes('macro')
            ? ['宏观 provider：补齐宏观扫描或外部宏观数据源，并保留 provenance。']
            : []),
        ...(hasEtfFundamentalGap
            ? ['ETF/基金底层估值：接入独立指数估值数据源；不要用发行人财务接口合成 PE/PB/ROE。']
            : []),
        ...(followUpContext.includes('fundamental') && !hasEtfFundamentalGap
            ? ['基本面 provider：补齐估值、财务质量和催化剂数据源。']
            : []),
        ...(missingOutputRoles.length > 0
            ? [`失败 researcher：重跑 ${missingOutputRoles.join(', ')}，确认失败是否来自工具权限、provider 缺口或 runtime 超时。`]
            : []),
    ];
    const researcherRationale = outputs.length > 0
        ? outputs.map((output) => `${output.role}: 方向=${output.direction}, 置信度=${output.confidence}, 建议=${output.actionRecommendation}, edge=${output.edgeStrength}`).join(' | ')
        : '没有 researcher 输出。';
    const gateRationale = gates.length > 0
        ? gates.map((gate) => `${gate.reviewerRole}: ${gate.status} - ${gate.verdict}${gate.requiredDowngrades.length > 0 ? `；降级要求=${gate.requiredDowngrades.join(', ')}` : ''}`).join(' | ')
        : '没有 review gate。';
    const routeRationale = `召唤=${route.summonedResearchers.join(', ') || 'none'}；未召唤=${route.notSummoned.map((item) => `${item.role}: ${item.reason}`).join(' | ') || 'none'}`;
    const decisionRationale = `最终动作=${decisionCard.actionLevel}，仓位=${decisionCard.positionLevel}，复核触发=${decisionCard.reviewTrigger || 'none'}。`;

    return {
        conclusion,
        consensus: outputs.map((output) => `${output.role}: ${output.conclusion}`),
        dataGaps,
        decisionCard,
        disagreements: conflicts,
        generatedAt,
        notSummoned: route.notSummoned,
        promptVersionManifest: [],
        remediationItems: ledger,
        reviewerGates: gates,
        riskView: gates.find((gate) => gate.status === 'block')
            ? 'Data quality blocks aggressive action.'
            : decisionCard.positionLevel === 'precise_unavailable'
                ? 'Risk profile is missing, so precise sizing is unavailable.'
                : 'Risk profile is available and constrains position level.',
        sections: [
            {
                body: conclusion,
                title: '结论',
            },
            {
                body: coverage.length > 0 ? coverage.join(' | ') : '没有 researcher 覆盖记录。',
                title: '覆盖情况',
            },
            {
                body: coreEvidence,
                title: '核心证据',
            },
            {
                body: downgradeReasons,
                title: '降级原因',
            },
            {
                body: nextDataSteps.length > 0 ? nextDataSteps.join(' ') : '当前没有明确补数项；保持证据来源和 gate 状态可复核。',
                title: '下一步补数',
            },
            {
                body: `${decisionRationale} Researcher 依据：${researcherRationale}。Gate 约束：${gateRationale}。路由：${routeRationale}。`,
                title: '研究依据',
            },
            {
                body: conflicts.length > 0
                    ? conflicts.map((conflict) => conflict.summary).join(' ')
                    : '首轮研究没有发现重大方向性冲突。',
                title: '分歧',
            },
            {
                body: dataGaps.length > 0 ? dataGaps.join(' ') : '当前本地数据没有阻断项。',
                title: '数据缺口',
            },
            {
                body: toolEvidence.length > 0 ? toolEvidence.join(' ') : '本次研究没有记录工具执行证据。',
                title: '工具证据',
            },
        ],
        summonedResearchers: route.summonedResearchers,
        title: `Research: ${route.normalizedRequest.taskType}`,
    };
};