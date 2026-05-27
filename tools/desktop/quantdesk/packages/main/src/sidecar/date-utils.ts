import { formatUtcDate, normalizeIsoDateString, shiftIsoDateByDays } from '@quantdesk/shared/date-utils';

export const nextIsoDate = (date: string) => shiftIsoDateByDays(date, 1);

export const isoDayGap = (laterDate: string, earlierDate: string) => {
    const later = Date.parse(`${laterDate}T00:00:00.000Z`);
    const earlier = Date.parse(`${earlierDate}T00:00:00.000Z`);
    return Math.max(0, Math.round((later - earlier) / 86_400_000));
};

export const currentIsoDate = () => formatUtcDate(new Date());

export const isWeekendIsoDate = (date: string) => {
    const day = new Date(`${date}T00:00:00.000Z`).getUTCDay();
    return day === 0 || day === 6;
};

export const allIsoDatesMatch = (
    startDate: string,
    endDate: string,
    predicate: (date: string) => boolean,
) => {
    if (startDate > endDate) {
        return true;
    }

    let cursor = startDate;
    while (cursor <= endDate) {
        if (!predicate(cursor)) {
            return false;
        }
        cursor = nextIsoDate(cursor);
    }
    return true;
};

export const normalizeMetadataDate = (value: unknown) => {
    if (typeof value !== 'string') {
        return null;
    }

    return normalizeIsoDateString(value);
};