import { describe, expect, test } from 'vitest';

import type { DataProvenance, DecisionCard, ResearchTaskRoute, ResearchToolExecutionArtifact, ResearcherFailureArtifact, ResearcherOutput, ReviewGateResult } from '@quantdesk/shared';

import { synthesizeResearchReport } from './report-synthesizer';

const route: ResearchTaskRoute = {
    normalizedRequest: {
        actionIntensity: 'medium',
        actionIntent: 'prepare',
        assetClassHint: 'equity',
        assetScope: 'single_asset',
        assetType: 'US',
        dataNeeds: ['local_daily_prices'],
        riskLevel: 'medium',
        taskType: 'single_asset',
        timeHorizon: 'weeks_to_months',
    },
    notSummoned: [{ reason: 'macro signals are not required for this single-asset request', role: 'macro' }],
    reviewers: ['data_quality'],
    summonedResearchers: ['trend'],
};

const output: ResearcherOutput = {
    actionRecommendation: 'prepare',
    assumptions: ['price history is sufficient'],
    confidence: 'medium',
    conclusion: '纳斯达克趋势偏强，但需要等待回撤后的执行条件。',
    dataGaps: ['fundamental provider degraded'],
    dataProvenance: [],
    direction: 'bullish',
    edgeStrength: 'medium',
    edgeTypes: ['information'],
    evidence: [],
    invalidationConditions: ['跌破 20 日均线'],
    needsSecondReview: false,
    payoffGrade: 'medium',
    requestId: 'request-1',
    risks: ['估值回撤'],
    role: 'trend',
    timeHorizon: 'weeks_to_months',
    winRateGrade: 'medium',
};

const gate: ReviewGateResult = {
    dataProvenance: [],
    reasons: ['fundamental provider is degraded'],
    reasonCodes: ['provider_source_unavailable'],
    requiredDowngrades: ['Keep action at prepare until provider evidence is available.'],
    reviewerRole: 'data_quality',
    status: 'warn',
    verdict: '数据覆盖不足，不能升级到 build。',
};

const decisionCard: DecisionCard = {
    actionLevel: 'prepare',
    dataGaps: ['fundamental provider degraded'],
    edgeType: 'information',
    entryConditions: ['回撤后企稳'],
    invalidation: ['跌破 20 日均线'],
    payoffGrade: 'medium',
    positionLevel: 'small',
    reviewTrigger: 'data quality warn',
    takeProfitOrExit: ['趋势破坏退出'],
    timeHorizon: 'weeks_to_months',
    winRateGrade: 'medium',
};

describe('synthesizeResearchReport', () => {
    test('adds an explicit rationale section tying researchers, gates, route, and final action together', () => {
        const report = synthesizeResearchReport({
            conflicts: [],
            decisionCard,
            generatedAt: '2026-04-28T00:00:00.000Z',
            gates: [gate],
            outputs: [output],
            route,
            toolExecutions: [],
        });

        const rationale = report.sections.find((section) => section.title === '研究依据');

        expect(rationale?.body).toContain('最终动作=prepare');
        expect(rationale?.body).toContain('trend: 方向=bullish');
        expect(rationale?.body).toContain('data_quality: warn');
        expect(rationale?.body).toContain('降级要求=Keep action at prepare');
        expect(rationale?.body).toContain('macro: macro signals are not required');
    });

    test('keeps allocation reports readable when some researchers fail but risk tool evidence exists', () => {
        const provenance: DataProvenance = {
            fetchedAt: '2026-04-28T00:00:00.000Z',
            qualityStatus: 'pass',
            sourceId: 'price-cache:local',
            warnings: [],
        };
        const allocationRoute: ResearchTaskRoute = {
            normalizedRequest: {
                actionIntensity: 'medium',
                actionIntent: 'rebalance',
                assetClassHint: 'equity',
                assetScope: 'portfolio',
                assetType: 'mixed',
                dataNeeds: ['local_daily_prices', 'portfolio_positions', 'risk_profile'],
                riskLevel: 'medium',
                taskType: 'allocation',
                timeHorizon: 'weeks_to_months',
            },
            notSummoned: [{
                reason: 'Required data sources for fundamental are unavailable or blocked.',
                role: 'fundamental',
            }],
            reviewers: ['data_quality'],
            summonedResearchers: ['allocation', 'macro', 'risk'],
        };
        const riskOutput: ResearcherOutput = {
            actionRecommendation: 'prepare',
            assumptions: ['Only risk researcher survived this run.'],
            confidence: 'medium',
            conclusion: '风险证据仍可读：两个 ETF 需要用资产快照、组合摘要和风险解释复核。',
            dataGaps: [
                'Risk profile is missing; precise position sizing must stay unavailable.',
                'Portfolio has no local positions for this scope.',
            ],
            dataProvenance: [provenance],
            direction: 'mixed',
            edgeStrength: 'medium',
            edgeTypes: ['diversification', 'risk_adjusted'],
            evidence: [{
                label: 'diversification evidence',
                provenance: [provenance],
                summary: '两个 ETF 的收益、波动和相关性需要用本地价格缓存复核。',
            }],
            invalidationConditions: ['Risk profile remains missing.'],
            needsSecondReview: false,
            payoffGrade: 'medium',
            requestId: 'request-allocation',
            risks: ['Risk budget unavailable.'],
            role: 'risk',
            timeHorizon: 'weeks_to_months',
            winRateGrade: 'medium',
        };
        const partialFailureGate: ReviewGateResult = {
            dataProvenance: [],
            reasons: [
                'allocation researcher failed: Agent researcher attempted unauthorized tool: get_asset_snapshot',
                'macro researcher failed: macro provider timed out',
                'Risk profile is missing; precise position sizing must stay unavailable.',
                'Portfolio has no local positions for this scope.',
            ],
            reasonCodes: ['researcher_runtime_failure', 'researcher_runtime_failure', 'risk_profile_missing'],
            requiredDowngrades: [
                'Downgrade action intensity until failed researcher roles are rerun.',
                'Set position level to precise_unavailable or none.',
            ],
            reviewerRole: 'data_quality',
            status: 'warn',
            verdict: 'Partial researcher failure requires action downgrade and follow-up review.',
        };
        const partialDecisionCard: DecisionCard = {
            ...decisionCard,
            actionLevel: 'prepare',
            dataGaps: partialFailureGate.reasons,
            edgeType: 'diversification',
            positionLevel: 'precise_unavailable',
            reviewTrigger: 'partial researcher failure',
        };
        const failures: ResearcherFailureArtifact[] = [
            {
                error: 'Agent researcher attempted unauthorized tool: get_asset_snapshot',
                failedAt: '2026-04-28T00:00:04.000Z',
                recovered: false,
                requestId: 'request-allocation',
                role: 'allocation',
                runtimeMode: 'pi',
            },
            {
                error: 'macro provider timed out',
                failedAt: '2026-04-28T00:00:05.000Z',
                recovered: false,
                requestId: 'request-allocation',
                role: 'macro',
                runtimeMode: 'pi',
            },
        ];
        const toolExecutions: Array<ResearchToolExecutionArtifact & { dataProvenance: DataProvenance[] }> = [
            {
                args: { symbol: '159915' },
                completedAt: '2026-04-28T00:00:00.500Z',
                dataProvenance: [{ ...provenance, sourceId: 'asset:159915' }],
                partialResults: [],
                result: { summary: '失败 allocation run 里的资产快照，不应进入核心证据。' },
                role: 'allocation',
                runId: 'run-failed',
                sessionId: 'session-failed',
                startedAt: '2026-04-28T00:00:00.000Z',
                toolCallId: 'tool-failed-asset',
                toolName: 'get_asset_snapshot',
            },
            {
                args: { symbol: '513180' },
                completedAt: '2026-04-28T00:00:01.000Z',
                dataProvenance: [{ ...provenance, sourceId: 'asset:513180' }],
                partialResults: [],
                result: { summary: '513180 快照：近一月收益 5%，波动中等。' },
                role: 'risk',
                runId: 'run-1',
                sessionId: 'session-1',
                startedAt: '2026-04-28T00:00:00.000Z',
                toolCallId: 'tool-asset',
                toolName: 'get_asset_snapshot',
            },
            {
                args: {},
                completedAt: '2026-04-28T00:00:02.000Z',
                dataProvenance: [{ ...provenance, sourceId: 'positions:default' }],
                partialResults: [],
                result: { summary: '组合摘要：当前没有本地持仓，最近配置缺失。' },
                role: 'risk',
                runId: 'run-1',
                sessionId: 'session-1',
                startedAt: '2026-04-28T00:00:00.000Z',
                toolCallId: 'tool-portfolio',
                toolName: 'get_portfolio_summary',
            },
            {
                args: {},
                completedAt: '2026-04-28T00:00:03.000Z',
                dataProvenance: [{ ...provenance, sourceId: 'allocation:latest' }],
                partialResults: [],
                result: { summary: '风险解释：集中度和相关性证据不足，需补齐风险画像。' },
                role: 'risk',
                runId: 'run-1',
                sessionId: 'session-1',
                startedAt: '2026-04-28T00:00:00.000Z',
                toolCallId: 'tool-risk',
                toolName: 'explain_risk',
            },
        ];

        const report = synthesizeResearchReport({
            conflicts: [],
            decisionCard: partialDecisionCard,
            failures,
            generatedAt: '2026-04-28T00:00:00.000Z',
            gates: [partialFailureGate],
            outputs: [riskOutput],
            route: allocationRoute,
            toolExecutions,
        });
        const sectionBody = (title: string) => report.sections.find((section) => section.title === title)?.body ?? '';

        expect(report.conclusion).toContain('risk: 风险证据仍可读');
        expect(sectionBody('覆盖情况')).toContain('allocation: 失败/未产出');
        expect(sectionBody('覆盖情况')).toContain('macro: 失败/未产出 - macro provider timed out');
        expect(sectionBody('核心证据')).toContain('资产快照');
        expect(sectionBody('核心证据')).toContain('risk/get_asset_snapshot completed');
        expect(sectionBody('核心证据')).not.toContain('allocation/get_asset_snapshot completed');
        expect(sectionBody('核心证据')).toContain('组合摘要');
        expect(sectionBody('核心证据')).toContain('risk/get_portfolio_summary completed');
        expect(sectionBody('核心证据')).toContain('风险解释');
        expect(sectionBody('核心证据')).toContain('risk/explain_risk completed');
        expect(sectionBody('核心证据')).toContain('相关性/分散化证据');
        expect(sectionBody('降级原因')).toContain('prepare');
        expect(sectionBody('降级原因')).toContain('precise_unavailable');
        expect(sectionBody('降级原因')).toContain('data_quality: warn');
        expect(sectionBody('下一步补数')).toContain('风险画像');
        expect(sectionBody('下一步补数')).toContain('持仓');
        expect(sectionBody('下一步补数')).toContain('宏观 provider');
        expect(sectionBody('下一步补数')).toContain('基本面 provider');
        expect(sectionBody('下一步补数')).toContain('失败 researcher');
    });
});