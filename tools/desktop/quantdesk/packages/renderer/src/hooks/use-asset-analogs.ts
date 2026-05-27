import { useEffect, useMemo, useRef, useState } from 'react';

import type {
    PriceAnalogWindow,
    PricePatternAnalog,
    PricePatternAnalogSearchResult,
} from '@quantdesk/shared';

import { apiClient } from '../lib/api-client';
import type { TimeWindow } from './use-asset-detail';

export const isPriceAnalogWindow = (window: TimeWindow): window is PriceAnalogWindow => (
    window === '3M' || window === '6M' || window === '1Y'
);

interface UseAssetAnalogsInput {
    assetId: string | null;
    endDate: string | null;
    startDate: string | null;
    window: TimeWindow;
}

export const useAssetAnalogs = ({
    assetId,
    endDate,
    startDate,
    window,
}: UseAssetAnalogsInput) => {
    const [result, setResult] = useState<PricePatternAnalogSearchResult | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [selectedAnalogIds, setSelectedAnalogIds] = useState<string[]>([]);
    const activeRequestRef = useRef(0);
    const enabled = Boolean(assetId && startDate && endDate && isPriceAnalogWindow(window));

    useEffect(() => {
        const requestId = ++activeRequestRef.current;

        if (!enabled || !assetId || !startDate || !endDate || !isPriceAnalogWindow(window)) {
            setResult(null);
            setError(null);
            setIsLoading(false);
            setSelectedAnalogIds([]);
            return;
        }

        setIsLoading(true);
        setError(null);
        setSelectedAnalogIds([]);

        void apiClient.data.searchPricePatternAnalogs({
            assetId,
            endDate,
            limit: 10,
            startDate,
            window,
        }).then((response) => {
            if (requestId !== activeRequestRef.current) {
                return;
            }

            setResult(response);
            setIsLoading(false);
        }).catch((requestError) => {
            if (requestId !== activeRequestRef.current) {
                return;
            }

            setError(requestError instanceof Error ? requestError.message : 'Analog 检索失败');
            setIsLoading(false);
        });
    }, [assetId, enabled, endDate, startDate, window]);

    useEffect(() => {
        if (!result) {
            setSelectedAnalogIds([]);
            return;
        }

        const availableIds = new Set(result.results.map((analog) => analog.id));
        setSelectedAnalogIds((currentIds) => currentIds.filter((id) => availableIds.has(id)));
    }, [result]);

    const selectedAnalogs = useMemo<PricePatternAnalog[]>(() => {
        if (!result || selectedAnalogIds.length === 0) {
            return [];
        }

        const selectedIds = new Set(selectedAnalogIds);
        return result.results.filter((analog) => selectedIds.has(analog.id));
    }, [result, selectedAnalogIds]);

    const toggleAnalogSelection = (analogId: string) => {
        setSelectedAnalogIds((currentIds) => (
            currentIds.includes(analogId)
                ? currentIds.filter((id) => id !== analogId)
                : [...currentIds, analogId]
        ));
    };

    return {
        enabled,
        error,
        isLoading,
        result,
        selectedAnalogIds,
        selectedAnalogs,
        toggleAnalogSelection,
    };
};