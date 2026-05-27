import type { RebalanceCadence } from '@quantdesk/shared';

export const resolvePortfolioQuarterKey = (date: string) => {
    const month = Number.parseInt(date.slice(5, 7), 10);
    const quarter = Math.ceil(month / 3);
    return `${date.slice(0, 4)}Q${quarter}`;
};

export const resolvePortfolioWeekKey = (date: string) => {
    const cursor = new Date(`${date}T00:00:00Z`);
    const day = cursor.getUTCDay() || 7;
    cursor.setUTCDate(cursor.getUTCDate() + 4 - day);
    const yearStart = new Date(Date.UTC(cursor.getUTCFullYear(), 0, 1));
    const week = Math.ceil((((cursor.getTime() - yearStart.getTime()) / 86_400_000) + 1) / 7);
    return `${cursor.getUTCFullYear()}W${week}`;
};

export const resolvePortfolioWeekday = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay() || 7;

export const isPortfolioCadenceRebalanceDay = (
    alignedDates: string[],
    dayIndex: number,
    rebalanceCadence: RebalanceCadence,
) => {
    if (rebalanceCadence === 'none' || dayIndex >= alignedDates.length - 1) {
        return false;
    }

    const currentDate = alignedDates[dayIndex];
    const nextDate = alignedDates[dayIndex + 1];

    if (rebalanceCadence === 'weekly') {
        return resolvePortfolioWeekKey(currentDate) !== resolvePortfolioWeekKey(nextDate);
    }

    if (rebalanceCadence === 'monthly') {
        return currentDate.slice(0, 7) !== nextDate.slice(0, 7);
    }

    return resolvePortfolioQuarterKey(currentDate) !== resolvePortfolioQuarterKey(nextDate);
};

export const buildWeeklyRebalanceIndexesOnOrBeforeWeekday = ({
    dates,
    latestWeekday,
    minimumIndex,
}: {
    dates: string[];
    latestWeekday: number;
    minimumIndex: number;
}) => {
    const indexes: number[] = [];
    let currentWeek = '';
    let candidate: number | null = null;

    dates.forEach((date, index) => {
        const weekKey = resolvePortfolioWeekKey(date);

        if (currentWeek && weekKey !== currentWeek && candidate != null && candidate >= minimumIndex) {
            indexes.push(candidate);
        }

        if (weekKey !== currentWeek) {
            currentWeek = weekKey;
            candidate = null;
        }

        if (resolvePortfolioWeekday(date) <= latestWeekday) {
            candidate = index;
        }
    });

    if (candidate != null && candidate >= minimumIndex) {
        indexes.push(candidate);
    }

    return indexes;
};
