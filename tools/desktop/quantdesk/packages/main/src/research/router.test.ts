import { describe, expect, test } from 'vitest';

import type { ResearchDataSourceSnapshot } from '@quantdesk/shared';

import { normalizeResearchRequest } from './task-normalizer';
import { routeResearchTask } from './router';

const source = (input: Partial<ResearchDataSourceSnapshot> & Pick<ResearchDataSourceSnapshot, 'id'>): ResearchDataSourceSnapshot => ({
    id: input.id,
    kind: input.kind ?? 'local',
    label: input.label ?? input.id,
    providerIds: input.providerIds ?? [],
    qualityStatus: input.qualityStatus ?? 'pass',
    roleAffinity: input.roleAffinity ?? [],
    status: input.status ?? 'available',
    toolNames: input.toolNames ?? [],
    warnings: input.warnings ?? [],
});

describe('research router', () => {
    test('routes allocation requests to allocation, macro and risk researchers', () => {
        const normalized = normalizeResearchRequest({ query: '请给当前组合做配置和再平衡建议' });
        const route = routeResearchTask(normalized);

        expect(route.summonedResearchers).toEqual(expect.arrayContaining(['allocation', 'macro', 'risk']));
        expect(route.reviewers).toContain('data_quality');
    });

    test('adds execution and devil advocate review for high intensity requests', () => {
        const normalized = normalizeResearchRequest({ query: '我想重仓短线交易这个标的，给入场和止损' });
        const route = routeResearchTask(normalized);

        expect(route.summonedResearchers).toEqual(expect.arrayContaining(['trend', 'execution', 'risk']));
        expect(route.reviewers).toContain('devil_advocate');
    });

    test('skips researchers whose required sources are unavailable or legacy contract-only', () => {
        const normalized = normalizeResearchRequest({ query: '研究一下单股恒生科技基本面' });
        const route = routeResearchTask(normalized, {
            dataSources: [
                source({ id: 'local.daily_prices' }),
                source({ id: 'derived.price_signals' }),
                source({ id: 'local.positions', qualityStatus: 'warn', status: 'degraded' }),
                source({ id: 'local.risk_profile', qualityStatus: 'warn', status: 'degraded' }),
                source({ id: 'provider.fundamentals', kind: 'provider', qualityStatus: 'warn', status: 'contract' }),
            ],
        });

        expect(route.summonedResearchers).not.toContain('fundamental');
        expect(route.summonedResearchers).toEqual(expect.arrayContaining(['trend', 'factor', 'risk']));
        expect(route.notSummoned).toContainEqual(expect.objectContaining({
            reason: 'Required data sources for fundamental are unavailable or blocked.',
            role: 'fundamental',
        }));
    });

    test('summons provider-backed researchers when executable degraded provider coverage exists', () => {
        const normalized = normalizeResearchRequest({ query: '研究一下单股恒生科技基本面' });
        const route = routeResearchTask(normalized, {
            dataSources: [
                source({ id: 'local.daily_prices' }),
                source({ id: 'derived.price_signals' }),
                source({ id: 'local.positions', qualityStatus: 'warn', status: 'degraded' }),
                source({ id: 'local.risk_profile', qualityStatus: 'warn', status: 'degraded' }),
                source({ id: 'provider.fundamentals', kind: 'provider', qualityStatus: 'warn', status: 'degraded', toolNames: ['get_fundamental_snapshot'] }),
            ],
        });

        expect(route.summonedResearchers).toContain('fundamental');
    });
});