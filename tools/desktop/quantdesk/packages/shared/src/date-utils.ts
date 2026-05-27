export const formatUtcDate = (date: Date) => date.toISOString().slice(0, 10);

export const shiftUtcDateByDays = (baseDate: Date, days: number) => {
    const nextDate = new Date(baseDate);
    nextDate.setUTCDate(nextDate.getUTCDate() + days);
    return formatUtcDate(nextDate);
};

export const shiftIsoDateByDays = (isoDate: string, days: number) => {
    const nextDate = new Date(`${isoDate}T00:00:00.000Z`);
    nextDate.setUTCDate(nextDate.getUTCDate() + days);
    return formatUtcDate(nextDate);
};

export const normalizeIsoDateString = (value?: string | null) => {
    if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return null;
    }

    const parsed = new Date(`${value}T00:00:00.000Z`);
    return Number.isNaN(parsed.getTime()) ? null : value;
};