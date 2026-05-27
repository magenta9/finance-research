import type {
    ResearchDataSourceSnapshot,
    NormalizedResearchRequest,
    ResearchRole,
    ResearchTaskRoute,
    ReviewerRole,
} from '@quantdesk/shared';

import { allResearchRoles, allReviewerRoles } from './roles';

const uniq = <T,>(values: T[]) => Array.from(new Set(values));

const requiredSourceGroupsByRole: Partial<Record<ResearchRole, string[][]>> = {
    allocation: [['local.positions', 'local.allocation_plan']],
    execution: [['local.positions', 'local.allocation_plan']],
    factor: [['derived.price_signals']],
    flow_sentiment: [['provider.flow_sentiment']],
    fundamental: [['provider.fundamentals']],
    macro: [['tool.macro_scan']],
    risk: [['local.daily_prices', 'local.positions', 'local.risk_profile']],
    trend: [['local.daily_prices', 'derived.price_signals']],
};

const sourceSupportsResearch = (source: ResearchDataSourceSnapshot) => source.status !== 'contract'
    && source.status !== 'unavailable'
    && source.qualityStatus !== 'block';

const roleHasSourceCoverage = (role: ResearchRole, dataSources?: ResearchDataSourceSnapshot[]) => {
    if (!dataSources) {
        return true;
    }

    const requiredSourceGroups = requiredSourceGroupsByRole[role] ?? [];

    if (requiredSourceGroups.length === 0) {
        return true;
    }

    return requiredSourceGroups.every((sourceGroup) => dataSources
        .some((source) => sourceGroup.includes(source.id) && sourceSupportsResearch(source)));
};

export interface RouteResearchTaskOptions {
    dataSources?: ResearchDataSourceSnapshot[];
}

export const routeResearchTask = (
    normalizedRequest: NormalizedResearchRequest,
    options: RouteResearchTaskOptions = {},
): ResearchTaskRoute => {
    const researchers: ResearchRole[] = [];
    const reviewers: ReviewerRole[] = ['data_quality'];

    if (normalizedRequest.taskType === 'allocation' || normalizedRequest.assetScope === 'portfolio') {
        researchers.push('allocation', 'macro', 'risk');
    }

    if (normalizedRequest.taskType === 'short_term_trade') {
        researchers.push('trend', 'flow_sentiment', 'execution', 'risk');
    }

    if (normalizedRequest.taskType === 'single_asset') {
        researchers.push('fundamental', 'trend', 'factor', 'risk');
    }

    if (normalizedRequest.taskType === 'macro') {
        researchers.push('macro', 'risk', 'allocation');
    }

    if (researchers.length === 0) {
        researchers.push('trend', 'risk');
    }

    if (normalizedRequest.actionIntensity === 'high' || normalizedRequest.riskLevel === 'high') {
        researchers.push('execution');
        reviewers.push('devil_advocate');
    }

    const requestedResearchers = uniq(researchers);
    const dataSourceSkippedResearchers = requestedResearchers
        .filter((role) => !roleHasSourceCoverage(role, options.dataSources));
    const summonedResearchers = requestedResearchers
        .filter((role) => !dataSourceSkippedResearchers.includes(role));
    const summonedReviewers = uniq(reviewers);

    return {
        normalizedRequest,
        notSummoned: [
            ...allResearchRoles
                .filter((role) => !summonedResearchers.includes(role))
                .map((role) => ({
                    role,
                    reason: dataSourceSkippedResearchers.includes(role)
                        ? `Required data sources for ${role} are unavailable or blocked.`
                        : `Request routed to ${normalizedRequest.taskType}; ${role} was not required for first-pass coverage.`,
                })),
            ...allReviewerRoles
                .filter((role) => !summonedReviewers.includes(role))
                .map((role) => ({ role, reason: `${role} is only summoned when uncertainty, high intensity, or gate policy requires it.` })),
        ],
        reviewers: summonedReviewers,
        summonedResearchers,
    };
};