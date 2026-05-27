import type { PortfolioPathPoint } from '@quantdesk/shared';

export interface PortfolioPathDrawdownSegment {
    drawdown: number;
    endIndex: number;
    id: string;
    peakDate: string;
    peakEquity: number;
    startIndex: number;
    troughDate: string;
    troughEquity: number;
}

export interface PortfolioPathDrawdownPoint extends PortfolioPathPoint {
    drawdownEquity: number | null;
    drawdownPeakDate: string | null;
    drawdownPeakEquity: number | null;
    drawdownRatio: number | null;
    drawdownSegmentId: string | null;
    drawdownStartDate: string | null;
    drawdownTroughDate: string | null;
    drawdownTroughEquity: number | null;
}

interface DrawdownState {
    peakIndex: number;
    peakPoint: PortfolioPathPoint;
    troughIndex: number;
    troughPoint: PortfolioPathPoint;
}

const drawdownThreshold = 0.05;

const annotatePoint = (point: PortfolioPathPoint): PortfolioPathDrawdownPoint => ({
    ...point,
    drawdownEquity: null,
    drawdownPeakDate: null,
    drawdownPeakEquity: null,
    drawdownRatio: null,
    drawdownSegmentId: null,
    drawdownStartDate: null,
    drawdownTroughDate: null,
    drawdownTroughEquity: null,
});

const createDrawdownSegment = (
    state: DrawdownState,
    segmentIndex: number,
): PortfolioPathDrawdownSegment => ({
    drawdown: 1 - (state.troughPoint.equity / state.peakPoint.equity),
    endIndex: state.troughIndex,
    id: `drawdown-${segmentIndex}`,
    peakDate: state.peakPoint.date,
    peakEquity: state.peakPoint.equity,
    startIndex: state.peakIndex,
    troughDate: state.troughPoint.date,
    troughEquity: state.troughPoint.equity,
});

export const buildPortfolioPathDrawdownSeries = (portfolioPath: PortfolioPathPoint[]) => {
    const series = portfolioPath.map((point) => annotatePoint(point));
    const segments: PortfolioPathDrawdownSegment[] = [];

    if (portfolioPath.length < 2) {
        return { segments, series };
    }

    let state: DrawdownState = {
        peakIndex: 0,
        peakPoint: portfolioPath[0],
        troughIndex: 0,
        troughPoint: portfolioPath[0],
    };

    const flushSegment = () => {
        if (state.troughIndex <= state.peakIndex) {
            return;
        }

        if (state.troughPoint.equity >= state.peakPoint.equity) {
            return;
        }

        const segment = createDrawdownSegment(state, segments.length + 1);

        if (segment.drawdown < drawdownThreshold) {
            return;
        }

        segments.push(segment);

        for (let index = state.peakIndex; index <= state.troughIndex; index += 1) {
            series[index] = {
                ...series[index],
                drawdownEquity: portfolioPath[index].equity,
                drawdownPeakDate: segment.peakDate,
                drawdownPeakEquity: segment.peakEquity,
                drawdownRatio: segment.drawdown,
                drawdownSegmentId: segment.id,
                drawdownStartDate: segment.peakDate,
                drawdownTroughDate: segment.troughDate,
                drawdownTroughEquity: segment.troughEquity,
            };
        }
    };

    for (let index = 1; index < portfolioPath.length; index += 1) {
        const point = portfolioPath[index];

        if (point.equity > state.peakPoint.equity) {
            flushSegment();

            state = {
                peakIndex: index,
                peakPoint: point,
                troughIndex: index,
                troughPoint: point,
            };

            continue;
        }

        if (point.equity < state.troughPoint.equity) {
            state = {
                ...state,
                troughIndex: index,
                troughPoint: point,
            };
        }
    }

    flushSegment();

    return {
        segments,
        series,
    };
};