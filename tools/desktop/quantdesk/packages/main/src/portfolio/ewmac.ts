import type { EwmacRuleConfig } from '@quantdesk/shared';

export interface EwmacParams {
    cap?: number;
    fast: number;
    scalar: number;
    slow: number;
    volatilitySpan?: number;
}

export interface EwmacForecastSeries {
    forecast: number[];
    rule: string;
}

export interface EwmacFamilyInput {
    cap?: number;
    forecastDiversificationMultiplier?: number;
    prices: number[];
    rules?: EwmacRuleConfig[];
    volatilitySpan?: number;
}

export interface EwmacFamilyForecast {
    forecast: number[];
    forecastDiversificationMultiplier: number;
    rules: NormalizedEwmacRule[];
    ruleForecasts: EwmacForecastSeries[];
}

export interface NormalizedEwmacRule {
    enabled: boolean;
    fast: number;
    scalar: number;
    slow: number;
    weight: number;
}

const defaultForecastCap = 20;
const defaultVolatilitySpan = 32;

export const defaultEwmacRules: NormalizedEwmacRule[] = [
    { enabled: true, fast: 2, scalar: 10.6, slow: 8, weight: 1 },
    { enabled: true, fast: 4, scalar: 7.5, slow: 16, weight: 1 },
    { enabled: true, fast: 8, scalar: 5.3, slow: 32, weight: 1 },
    { enabled: true, fast: 16, scalar: 3.75, slow: 64, weight: 1 },
    { enabled: true, fast: 32, scalar: 2.65, slow: 128, weight: 1 },
    { enabled: true, fast: 64, scalar: 1.87, slow: 256, weight: 1 },
];

export const forecastDiversificationMultiplierForRuleCount = (ruleCount: number) => {
    if (ruleCount <= 1) {
        return 1;
    }

    if (ruleCount === 2) {
        return 1.1;
    }

    if (ruleCount === 3) {
        return 1.2;
    }

    return 1.35;
};

const clamp = (value: number, min: number, max: number) =>
    Math.min(max, Math.max(min, value));

const isPositiveFinite = (value: number) => Number.isFinite(value) && value > 0;

export const computeEwma = (values: number[], span: number) => {
    if (values.length === 0) {
        return [];
    }

    const alpha = 2 / (span + 1);
    const output = [values[0]];

    for (let index = 1; index < values.length; index += 1) {
        output.push(alpha * values[index] + (1 - alpha) * output[index - 1]);
    }

    return output;
};

export const computeAbsolutePriceVolatility = (
    prices: number[],
    volatilitySpan = defaultVolatilitySpan,
) => {
    if (prices.length === 0) {
        return [];
    }

    const squaredDiffs = prices.map((price, index) => {
        if (index === 0) {
            return 0;
        }

        return (price - prices[index - 1]) ** 2;
    });
    const variance = computeEwma(squaredDiffs, volatilitySpan);

    return variance.map((value) => Math.sqrt(Math.max(value, 0)));
};

export const normalizeEwmacRules = (
    rules: EwmacRuleConfig[] = defaultEwmacRules,
): NormalizedEwmacRule[] => rules
    .map((rule) => {
        const defaultRule = defaultEwmacRules.find((candidate) => candidate.fast === rule.fast);

        return {
            enabled: rule.enabled ?? defaultRule?.enabled ?? true,
            fast: rule.fast,
            scalar: rule.scalar ?? defaultRule?.scalar ?? 1,
            slow: rule.slow ?? defaultRule?.slow ?? rule.fast * 4,
            weight: rule.weight ?? 1,
        };
    })
    .filter((rule) => isPositiveFinite(rule.fast)
        && isPositiveFinite(rule.slow)
        && rule.slow > rule.fast
        && isPositiveFinite(rule.scalar)
        && Number.isFinite(rule.weight)
        && rule.weight > 0
        && rule.enabled);

export const buildEwmacRuleName = (fast: number, slow: number) => `ewmac_${fast}_${slow}`;

export const computeEwmac = (
    prices: number[],
    params: EwmacParams,
): EwmacForecastSeries => {
    const cap = params.cap ?? defaultForecastCap;
    const emaFast = computeEwma(prices, params.fast);
    const emaSlow = computeEwma(prices, params.slow);
    const priceVolatility = computeAbsolutePriceVolatility(prices, params.volatilitySpan);
    const forecast = prices.map((_price, index) => {
        const volatility = priceVolatility[index];

        if (!isPositiveFinite(volatility)) {
            return 0;
        }

        const raw = (emaFast[index] ?? 0) - (emaSlow[index] ?? 0);
        const scaled = params.scalar * raw / volatility;

        return clamp(scaled, -cap, cap);
    });

    return {
        forecast,
        rule: buildEwmacRuleName(params.fast, params.slow),
    };
};

export const computeEwmacFamily = ({
    cap = defaultForecastCap,
    forecastDiversificationMultiplier,
    prices,
    rules,
    volatilitySpan = defaultVolatilitySpan,
}: EwmacFamilyInput): EwmacFamilyForecast => {
    const normalizedRules = normalizeEwmacRules(rules);
    const ruleForecasts = normalizedRules.map((rule) => computeEwmac(prices, {
        cap,
        fast: rule.fast,
        scalar: rule.scalar,
        slow: rule.slow,
        volatilitySpan,
    }));
    const totalWeight = normalizedRules.reduce((sum, rule) => sum + rule.weight, 0);
    const fdm = forecastDiversificationMultiplier
        ?? forecastDiversificationMultiplierForRuleCount(normalizedRules.length);
    const forecast = prices.map((_price, priceIndex) => {
        if (ruleForecasts.length === 0 || totalWeight <= 0) {
            return 0;
        }

        const weightedForecast = ruleForecasts.reduce(
            (sum, series, ruleIndex) => sum + (series.forecast[priceIndex] ?? 0) * normalizedRules[ruleIndex].weight,
            0,
        ) / totalWeight;

        return clamp(weightedForecast * fdm, -cap, cap);
    });

    return {
        forecast,
        forecastDiversificationMultiplier: fdm,
        ruleForecasts,
        rules: normalizedRules,
    };
};