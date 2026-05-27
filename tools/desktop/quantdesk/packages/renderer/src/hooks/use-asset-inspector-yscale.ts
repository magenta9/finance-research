import { useEffect, useMemo, useState } from 'react';

import type { EffectiveDisplaySeriesMode } from '@quantdesk/shared';

import type { TimeWindow } from './use-asset-detail';

export type AssetInspectorYScale = 'linear' | 'log';

const STORAGE_PREFIX = 'asset-inspector.yscale.';

const getDefaultScale = (window: TimeWindow): AssetInspectorYScale => (
    window === '3Y' || window === '5Y' || window === 'ALL' ? 'log' : 'linear'
);

const isStoredScale = (value: string | null): value is AssetInspectorYScale =>
    value === 'linear' || value === 'log';

export const useAssetInspectorYScale = (
    assetId: string | null,
    selectedWindow: TimeWindow,
    _effectiveDisplaySeriesMode: EffectiveDisplaySeriesMode,
    displayValues: Array<number | null>,
) => {
    const [preferredScale, setPreferredScale] = useState<AssetInspectorYScale>(getDefaultScale(selectedWindow));

    useEffect(() => {
        if (!assetId) {
            setPreferredScale(getDefaultScale(selectedWindow));
            return;
        }

        const storedValue = globalThis.window.localStorage.getItem(`${STORAGE_PREFIX}${assetId}`);

        if (isStoredScale(storedValue)) {
            setPreferredScale(storedValue);
            return;
        }

        setPreferredScale(getDefaultScale(selectedWindow));
    }, [assetId, selectedWindow]);

    const logDisabledReason = useMemo(() => {
        if (displayValues.some((value) => value != null && value <= 0)) {
            return '存在非正值，无法使用对数轴。';
        }

        return null;
    }, [displayValues]);

    const yScale = logDisabledReason ? 'linear' : preferredScale;

    const updatePreferredScale = (nextScale: AssetInspectorYScale) => {
        if (!assetId) {
            setPreferredScale(nextScale);
            return;
        }

        if (nextScale === 'log' && logDisabledReason) {
            return;
        }

        setPreferredScale(nextScale);
        globalThis.window.localStorage.setItem(`${STORAGE_PREFIX}${assetId}`, nextScale);
    };

    return {
        isLogDisabled: logDisabledReason != null,
        logDisabledReason,
        setPreferredScale: updatePreferredScale,
        yScale,
    };
};