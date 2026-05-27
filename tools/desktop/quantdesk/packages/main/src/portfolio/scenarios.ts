import type { AllocationAssetWeight, ScenarioAnalysis } from '@quantdesk/shared';

const scenarioShocks: Array<{
    drawdownMultiplier: number;
    name: string;
    riskFactors: string[];
    shocks: Record<AllocationAssetWeight['assetClass'], number>;
}> = [
        {
            drawdownMultiplier: 1.2,
            name: '利率上升',
            riskFactors: ['duration', 'real yields'],
            shocks: {
                alternative: -0.03,
                cash: 0.01,
                commodity: 0.02,
                equity: -0.05,
                fixed_income: -0.08,
            },
        },
        {
            drawdownMultiplier: 1.6,
            name: '股市暴跌',
            riskFactors: ['equity beta', 'liquidity'],
            shocks: {
                alternative: -0.07,
                cash: 0.01,
                commodity: -0.02,
                equity: -0.18,
                fixed_income: 0.03,
            },
        },
        {
            drawdownMultiplier: 1.25,
            name: '通胀飙升',
            riskFactors: ['inflation beta', 'commodity sensitivity'],
            shocks: {
                alternative: -0.02,
                cash: 0.01,
                commodity: 0.09,
                equity: -0.04,
                fixed_income: -0.1,
            },
        },
        {
            drawdownMultiplier: 1.35,
            name: '经济衰退',
            riskFactors: ['growth beta', 'credit spread'],
            shocks: {
                alternative: -0.05,
                cash: 0.015,
                commodity: -0.06,
                equity: -0.14,
                fixed_income: 0.05,
            },
        },
        {
            drawdownMultiplier: 0.9,
            name: '温和增长',
            riskFactors: ['balanced growth', 'risk appetite'],
            shocks: {
                alternative: 0.03,
                cash: 0.002,
                commodity: 0.02,
                equity: 0.08,
                fixed_income: 0.01,
            },
        },
    ];

export const buildScenarioAnalysis = (allocations: AllocationAssetWeight[]): ScenarioAnalysis[] =>
    scenarioShocks.map((scenario) => {
        const estimatedReturn = allocations.reduce(
            (sum, allocation) => sum + allocation.weight * scenario.shocks[allocation.assetClass],
            0,
        );

        return {
            estimatedDrawdown: Math.abs(estimatedReturn) * scenario.drawdownMultiplier,
            estimatedReturn,
            name: scenario.name,
            riskFactors: scenario.riskFactors,
        };
    });