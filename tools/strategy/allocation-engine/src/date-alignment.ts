export const formatIsoDate = (date: Date) => date.toISOString().slice(0, 10);

export const shiftIsoDateByMonths = (endDate: string, months: number) => {
    const cursor = new Date(`${endDate}T00:00:00Z`);
    cursor.setUTCMonth(cursor.getUTCMonth() - months);
    return formatIsoDate(cursor);
};
