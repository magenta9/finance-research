import type { Asset } from '../domain';

export interface AssetInput extends Asset {
    metadata: Record<string, unknown>;
}

export interface StoredAsset extends AssetInput {
    createdAt: string;
    updatedAt: string;
}